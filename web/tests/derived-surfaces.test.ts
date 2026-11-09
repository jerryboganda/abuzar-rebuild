import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DATA_SURFACES, CRITERIA_DATA_SURFACES, TRANSACTION_DATA_SURFACES, dataSurfaceIssues } from '../src/ui/data-surfaces.ts'
import type { DataSurface } from '../src/ui/data-surfaces.ts'
import { ENTRY_WINDOW_SURFACES, entryWindowIssues, WINDOW_SURFACES, CRITERIA_WINDOW_SURFACES, windowSurfaceIssues } from '../src/ui/window-surfaces.ts'
import { DERIVED_DATA_SURFACES } from '../src/ui/derived-data-surfaces.ts'
import { DERIVED_ENTRY_WINDOW_SURFACES } from '../src/ui/derived-entry-windows.ts'
import { DERIVED_MODAL_WINDOW_SURFACES } from '../src/ui/derived-modal-windows.ts'
import { modalWindowSurfaceByName } from '../src/ui/window-registry.ts'
import { ALL_ENTRY_WINDOW_SURFACES, dataSurfaceByName, ALL_DATA_SURFACES } from '../src/ui/surface-registry.ts'
import * as dataTool from '../tools/derive-data-surfaces.ts'
import * as entryTool from '../tools/derive-entry-windows.ts'
import * as modalTool from '../tools/derive-modal-windows.ts'

const definitions = dataTool.loadDefinitions()
const dataDerivation = dataTool.deriveAll(definitions)
const stable = (value: unknown): unknown => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object' ?
  Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stable(item)])) : value
const sequence = (surface: DataSurface) => JSON.stringify(stable([surface.kind, surface.fields.map((field) => ({
  object: field.object, label: field.labelObject, kind: field.kind, choice: field.choice, multiline: field.multiline,
  suffix: field.suffixObject, named: field.labelObject ? undefined : !!field.label?.trim(),
}))]))

test('generated DataWindow surfaces and backlog match the recovered definitions', () => {
  assert.equal(dataTool.render(dataDerivation.surfaces), readFileSync(dataTool.OUTPUT_TS, 'utf8'),
    'Run node tools/derive-data-surfaces.ts from web/')
  assert.equal(dataTool.renderBacklog(definitions.size, dataDerivation.surfaces.length, dataDerivation.skipped, dataDerivation.backlog),
    readFileSync(dataTool.OUTPUT_BACKLOG, 'utf8'))
  assert.equal(DERIVED_DATA_SURFACES.length, dataDerivation.surfaces.length)
})

test('every derived DataWindow surface passes the runtime validator and never shadows a reviewed mapping', () => {
  const reviewed = dataTool.reviewedDataWindows()
  const hosted = dataTool.entryHostedDataWindows()
  const names = new Set<string>()
  for (const surface of DERIVED_DATA_SURFACES) {
    assert.ok(!names.has(surface.name), `Duplicate ${surface.name}`)
    names.add(surface.name)
    assert.ok(!reviewed.has(surface.name) && !hosted.has(surface.name), `${surface.name} must stay context-only or reviewed`)
    const definition = definitions.get(surface.name)
    assert.ok(definition, surface.name)
    assert.deepEqual(dataSurfaceIssues(definition, surface), [], surface.name)
  }
  assert.equal(ALL_DATA_SURFACES.length, new Set([...DERIVED_DATA_SURFACES, ...DATA_SURFACES].map((surface) => surface.name)).size)
  assert.equal(dataSurfaceByName('d_aginginterval'), DATA_SURFACES.find((surface) => surface.name === 'd_aginginterval'))
  assert.equal(dataSurfaceByName(DERIVED_DATA_SURFACES[0].name), DERIVED_DATA_SURFACES[0])
})

test('the derivation reproduces every reviewed mapping it can derive (independent calibration)', () => {
  const reviewed = new Map<string, DataSurface>()
  for (const surface of [...DATA_SURFACES, ...CRITERIA_DATA_SURFACES, ...TRANSACTION_DATA_SURFACES]) reviewed.set(surface.name, surface)
  for (const entry of ENTRY_WINDOW_SURFACES) {
    for (const detail of entry.details) if (detail.surface) reviewed.set(detail.surface.name, detail.surface)
    if (entry.list) reviewed.set(entry.list.name, entry.list)
  }
  for (const window of [...WINDOW_SURFACES, ...CRITERIA_WINDOW_SURFACES]) for (const binding of window.data ?? []) reviewed.set(binding.surface.name, binding.surface)
  let compared = 0
  const differing: string[] = []
  for (const [name, surface] of reviewed) {
    const definition = definitions.get(name)
    if (!definition) continue
    const derived = dataTool.derive(name, definition).surface
    // A grid DataWindow deliberately presented as a one-row form is a reviewed exception, not a derivable layout.
    // A one-row criteria form built on a header-captioned DataWindow is a reviewed presentation choice, not derivable from the source
    // (its header caption may sit in a band without height, which the source never paints).
    if (!derived || surface.sourceProcessing !== undefined || derived.sourceProcessing !== undefined ||
      surface.fields.some((field) => field.labelBand === 'header')) continue
    compared++
    if (sequence(derived) !== sequence(surface)) differing.push(name)
  }
  assert.ok(compared >= 200, `compared ${compared}`)
  assert.deepEqual(differing, [])
})

test('generated entry windows match the recovered window trees', async () => {
  const derived = await entryTool.deriveWindows()
  assert.equal(entryTool.render(derived.surfaces), readFileSync(entryTool.OUTPUT_TS, 'utf8'), 'Run node tools/derive-entry-windows.ts from web/')
  assert.equal(derived.surfaces.length, DERIVED_ENTRY_WINDOW_SURFACES.length)
  assert.equal(ENTRY_WINDOW_SURFACES.length + DERIVED_ENTRY_WINDOW_SURFACES.length, ALL_ENTRY_WINDOW_SURFACES.length)
  const pending = Object.values(derived.backlog).reduce((sum, names) => sum + names.length, 0)
  assert.equal(derived.total, ALL_ENTRY_WINDOW_SURFACES.length + pending)
})

test('derived entry windows only host validated DataWindow surfaces', () => {
  const reviewed = new Set(ENTRY_WINDOW_SURFACES.map((surface) => surface.name))
  const names = new Set<string>()
  for (const surface of DERIVED_ENTRY_WINDOW_SURFACES) {
    assert.ok(!reviewed.has(surface.name) && !names.has(surface.name), surface.name)
    names.add(surface.name)
    assert.deepEqual(entryWindowIssues(surface.controls, surface), [], surface.name)
    assert.ok(surface.list && surface.list.kind === 'grid' || surface.family === 'multi', `${surface.name} list`)
    const bindings = [...surface.details, ...(surface.list ? [{ control: 'dw_list', kind: 'grid' as const, surface: surface.list }] : [])]
    for (const binding of bindings) {
      if (binding.kind === 'auxiliary') continue
      const mapped = binding.surface
      if (mapped) assert.deepEqual(dataSurfaceIssues(definitions.get(mapped.name)!, mapped), [], `${surface.name}.${binding.control}`)
      assert.equal(binding.kind, mapped ? mapped.kind === 'form' ? 'form' : 'grid' : binding.kind, `${surface.name}.${binding.control}`)
    }
  }
})

const modal = await modalTool.deriveModalWindows()

test('generated modal windows and backlog match the recovered window trees', () => {
  assert.equal(modalTool.render(modal.surfaces), readFileSync(modalTool.OUTPUT_TS, 'utf8'), 'Run node tools/derive-modal-windows.ts from web/')
  assert.equal(modalTool.renderBacklog(modal.total, modal.surfaces.length, modal.backlog), readFileSync(modalTool.OUTPUT_BACKLOG, 'utf8'))
  assert.equal(DERIVED_MODAL_WINDOW_SURFACES.length, modal.surfaces.length)
  assert.deepEqual(DERIVED_MODAL_WINDOW_SURFACES.map((surface) => surface.name), modal.surfaces.map((surface) => surface.name))
})

test('derived modal windows never shadow reviewed layouts and keep unique, validated DataWindow surfaces', () => {
  const reviewed = new Set(modalTool.REVIEWED_MODAL_WINDOWS.map((surface) => surface.name))
  const names = new Set<string>()
  for (const surface of DERIVED_MODAL_WINDOW_SURFACES) {
    assert.ok(!reviewed.has(surface.name) && !names.has(surface.name), surface.name)
    names.add(surface.name)
    for (const binding of surface.data ?? []) {
      assert.deepEqual(dataSurfaceIssues(definitions.get(binding.surface.name)!, binding.surface), [], `${surface.name}.${binding.control}`)
    }
  }
  assert.equal(modalWindowSurfaceByName('w_arg_cat')?.name, 'w_arg_cat')
  assert.equal(modalWindowSurfaceByName('w_arg_sdate_ldate'), CRITERIA_WINDOW_SURFACES.find((surface) => surface.name === 'w_arg_sdate_ldate'))
})

test('the modal derivation reproduces every reviewed layout it can derive, hidden inherited captions included', () => {
  // Hidden inherited controls take the caption pairing of the ancestor that places them, so no reviewed layout is an exception any more.
  const known = new Set<string>()
  const keys = ['fields', 'actions', 'frame', 'frames', 'lists', 'captions', 'options', 'calendars', 'auxiliary'] as const
  const normal = (value: unknown) => JSON.stringify(Array.isArray(value) ? value.map((item) => JSON.stringify(item)).sort() : value ?? null)
  let compared = 0
  const differing: string[] = []
  for (const hand of CRITERIA_WINDOW_SURFACES) {
    const derived = modal.results.get(hand.name)?.surface
    if (!derived) continue
    compared++
    const bindings = (surface: typeof hand) => JSON.stringify((surface.data ?? []).map((item) => [item.control, item.surface.name, item.labels ?? null]).sort())
    if (keys.some((key) => normal(derived[key]) !== normal(hand[key])) || bindings(derived) !== bindings(hand)) differing.push(hand.name)
  }
  assert.ok(compared >= 45, `compared ${compared}`)
  assert.deepEqual(differing.filter((name) => !known.has(name)), [])
  assert.ok(differing.length <= known.size)
})

test('list captions are exactly one of a groupbox or a source label', () => {
  const surface = DERIVED_MODAL_WINDOW_SURFACES.find((item) => item.lists?.some((list) => list.label))!
  const list = surface.lists!.find((item) => item.label)!
  const controls = [
    { name: list.control, native: 'listbox', children: 0 }, { name: list.label!, native: 'statictext', children: 0 },
    ...surface.actions.map((name) => ({ name, native: 'commandbutton', children: 0 })),
  ]
  const only = { name: 'w_probe', library: 'reports', fields: [], actions: surface.actions, lists: [list] }
  assert.deepEqual(windowSurfaceIssues(controls, only), [])
  assert.ok(windowSurfaceIssues(controls, { ...only, lists: [{ control: list.control }] }).some((issue) => issue.startsWith('A list needs exactly one caption')))
  assert.ok(windowSurfaceIssues(controls, { ...only, lists: [{ ...list, caption: 'cb_ok' }] }).some((issue) => issue.startsWith('A list needs exactly one caption')))
})

test('the entry derivation reproduces the control trees and detail order of every reviewed entry window it can derive', async () => {
  const { results } = await entryTool.deriveWindows()
  let compared = 0
  for (const hand of ENTRY_WINDOW_SURFACES) {
    const derived = results.get(hand.name)?.surface
    if (!derived) continue
    compared++
    assert.equal(derived.family, hand.family, hand.name)
    const key = (controls: typeof hand.controls) => JSON.stringify([...controls].map((control) => `${control.path}:${control.native}`).sort())
    assert.equal(key(derived.controls), key(hand.controls), hand.name)
    const visible = (details: typeof hand.details) => details.filter((detail) => detail.kind !== 'auxiliary').map((detail) => [detail.control, detail.kind])
    const hidden = (details: typeof hand.details) => details.filter((detail) => detail.kind === 'auxiliary').map((detail) => detail.control).sort()
    assert.deepEqual(visible(derived.details), visible(hand.details), hand.name)
    assert.deepEqual(hidden(derived.details), hidden(hand.details), hand.name)
  }
  assert.ok(compared >= 90, `compared ${compared}`)
})

test('the browser fixtures for the generated families carry every class, DataWindow and binding they need', async () => {
  const { mkdtempSync, rmSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { buildDerivedFixtures } = await import('../e2e/presentation-derived-fixture.mjs')
  const out = mkdtempSync(join(tmpdir(), 'derived-fixture-'))
  try {
    const counts = await buildDerivedFixtures({ here: join(import.meta.dirname, '..', 'e2e'), outDir: out })
    const modal = JSON.parse(readFileSync(join(out, 'presentation-derived-modal.json'), 'utf8'))
    const entry = JSON.parse(readFileSync(join(out, 'presentation-derived-entry.json'), 'utf8'))
    assert.equal(counts.modal, DERIVED_MODAL_WINDOW_SURFACES.length)
    assert.equal(modal.surfaces.length, DERIVED_MODAL_WINDOW_SURFACES.length)
    const modalClasses = new Set(modal.classes.map((definition: { name: string }) => definition.name))
    for (const surface of DERIVED_MODAL_WINDOW_SURFACES) {
      assert.ok(modalClasses.has(surface.name), `${surface.name} class`)
      for (const binding of surface.data ?? []) assert.ok(modal.data[binding.surface.name], `${surface.name}.${binding.control} data`)
    }
    for (const definition of modal.classes) {
      const stripped = JSON.stringify(definition)
      assert.ok(!/"dataobject"/.test(stripped), `${definition.name} must not retrieve on open`)
      assert.deepEqual(definition.routines, {})
    }
    const entryClasses = new Set(entry.classes.map((definition: { name: string }) => definition.name))
    for (const binding of entry.bindings) {
      assert.ok(entryClasses.has(binding.name), `${binding.name} class`)
      for (const item of [...binding.visible, binding.list]) {
        assert.ok(item.dataobject && entry.data[item.dataobject], `${binding.name}.${item.control} data`)
        for (const field of (item.surface ?? dataSurfaceByName(item.dataobject))?.fields ?? []) {
          if (field.choice?.kind === 'lookup') assert.ok(entry.data[field.choice.name], `${binding.name} lookup ${field.choice.name}`)
        }
      }
    }
    assert.ok(entry.data.d_find)
    const surfaces = JSON.parse(readFileSync(join(out, 'presentation-derived-surfaces.json'), 'utf8'))
    assert.equal(surfaces.surfaces.length, DERIVED_DATA_SURFACES.length)
    for (const name of surfaces.surfaces) assert.ok(surfaces.data[name], `${name} definition`)
    assert.ok(['w_multi_entry', 'u_dwstandard'].every((name) => entryClasses.has(name)))
  } finally { rmSync(out, { recursive: true, force: true }) }
})

test('embedded containers keep their own children but only an allowed native may be embedded', () => {
  const surface = DERIVED_MODAL_WINDOW_SURFACES.find((item) => item.embedded?.length)!
  assert.ok(surface, 'a generated window embeds a container')
  const name = surface.embedded![0]
  const controls = [
    { name, native: 'tab', children: 3 },
    ...surface.actions.map((action) => ({ name: action, native: 'commandbutton', children: 0 })),
  ]
  const only = { name: 'w_probe', library: 'reports', fields: [], actions: surface.actions, embedded: [name] }
  assert.deepEqual(windowSurfaceIssues(controls, only), [])
  assert.ok(windowSurfaceIssues(controls.map((control) => control.name === name ? { ...control, native: 'commandbutton' } : control), only)
    .includes(`Unsupported control: ${name}`))
  assert.ok(windowSurfaceIssues(controls, { ...only, embedded: [name, name] }).includes(`Duplicate binding: ${name}`))
  assert.ok(windowSurfaceIssues(controls, { ...only, embedded: [] }).includes(`Unmapped control: ${name}`))
})

test('an ungrouped section is allowed once and decorations must be static artwork', () => {
  const surface = DERIVED_DATA_SURFACES.find((item) => item.groups?.some((group) => group.object === ''))!
  assert.ok(surface, 'a generated form has an ungrouped section')
  const definition = definitions.get(surface.name)!
  const plain = surface.groups!.find((group) => group.object === '')!
  assert.deepEqual(dataSurfaceIssues(definition, surface), [])
  assert.ok(dataSurfaceIssues(definition, { ...surface, groups: [...surface.groups!, { object: '', fields: [] }] })
    .includes('Only one ungrouped section is allowed'))
  assert.ok(plain.fields.length > 0)
  const art = DERIVED_DATA_SURFACES.find((item) => item.decorations?.length)!
  assert.ok(art, 'a generated surface accounts for static artwork')
  const artDefinition = definitions.get(art.name)!
  assert.deepEqual(dataSurfaceIssues(artDefinition, art), [])
  assert.ok(dataSurfaceIssues(artDefinition, { ...art, decorations: [art.fields[0].object] })
    .includes(`Unsupported decoration: ${art.fields[0].object}`))
})

test('buttons, clipped objects and totals captions are validated against the source', () => {
  const withButtons = DERIVED_DATA_SURFACES.find((item) => item.buttons?.length)!
  assert.ok(withButtons, 'a generated form carries a button')
  const definition = definitions.get(withButtons.name)!
  assert.deepEqual(dataSurfaceIssues(definition, withButtons), [])
  assert.ok(dataSurfaceIssues(definition, { ...withButtons, kind: 'grid' }).includes('Buttons require a form layout'))
  assert.ok(dataSurfaceIssues(definition, { ...withButtons, buttons: [{ object: withButtons.fields[0].object }] })
    .includes(`Unsupported button: ${withButtons.fields[0].object}`))
  const withTotals = DERIVED_DATA_SURFACES.find((item) => item.bands?.some((band) => band.captions?.length))!
  assert.ok(withTotals, 'a generated grid has a totals caption')
  assert.deepEqual(dataSurfaceIssues(definitions.get(withTotals.name)!, withTotals), [])
  const hosted = DERIVED_ENTRY_WINDOW_SURFACES.flatMap((entry) => [entry.list, ...entry.details.map((detail) => detail.surface)]).find((item) => item?.name === 'd_customer_list')
  assert.ok(hosted?.decorations?.includes('area_name'), 'the clipped header column is accounted for, not mapped')
  assert.deepEqual(dataSurfaceIssues(definitions.get('d_customer_list')!, hosted!), [])
})

test('a spin setting the editor cannot honour must be acknowledged as plain editing, and only then', () => {
  const surface = DERIVED_ENTRY_WINDOW_SURFACES.flatMap((entry) => entry.details.map((detail) => detail.surface))
    .find((item) => item?.fields.some((field) => field.spinPlain))!
  assert.ok(surface, 'a generated surface acknowledges an unsupported spin')
  const definition = definitions.get(surface.name)!
  assert.deepEqual(dataSurfaceIssues(definition, surface), [])
  const field = surface.fields.find((item) => item.spinPlain)!
  assert.ok(dataSurfaceIssues(definition, { ...surface, fields: surface.fields.map(({ spinPlain, ...rest }) => rest) })
    .some((issue) => issue.startsWith(`${field.object}: `)))
  const plain = surface.fields.find((item) => !item.spinPlain)!
  assert.ok(dataSurfaceIssues(definition, { ...surface, fields: surface.fields.map((item) => item === plain ? { ...item, spinPlain: true } : item) })
    .includes(`Plain-spin acknowledgement not needed: ${plain.object}`))
})

test('generated sheet layouts are limited to ordinary windows and flagged for the sheet host', () => {
  const sheets = DERIVED_MODAL_WINDOW_SURFACES.filter((surface) => surface.sheet)
  assert.ok(sheets.length > 0)
  for (const surface of sheets) assert.ok(!['w_main', 'w_bkg'].includes(surface.name), surface.name)
  assert.equal(modalWindowSurfaceByName(sheets[0].name)?.sheet, true)
})

test('uncaptioned fields and lists carry exactly one accessible name', () => {
  const surface = DERIVED_MODAL_WINDOW_SURFACES.find((item) => item.fields.some((field) => field.name))!
  assert.ok(surface, 'a generated window names an uncaptioned field')
  const named = surface.fields.find((field) => field.name)!
  const controls = [
    { name: named.control, native: 'editmask', children: 0 },
    ...surface.actions.map((action) => ({ name: action, native: 'commandbutton', children: 0 })),
  ]
  const only = { name: 'w_probe', library: 'reports', fields: [named], actions: surface.actions }
  assert.deepEqual(windowSurfaceIssues(controls, only), [])
  assert.ok(windowSurfaceIssues(controls, { ...only, fields: [{ control: named.control }] })
    .includes(`A field needs exactly one caption or name: ${named.control}`))
  assert.ok(windowSurfaceIssues(controls, { ...only, fields: [{ ...named, label: 'st_1' }] })
    .includes(`A field needs exactly one caption or name: ${named.control}`))
})

test('a grouped grid must say so, and group bands only exist for real group levels', () => {
  const grouped = DERIVED_DATA_SURFACES.find((item) => item.grouped)
    ?? DERIVED_ENTRY_WINDOW_SURFACES.flatMap((entry) => [entry.list, ...entry.details.map((detail) => detail.surface)]).find((item) => item?.grouped)
  assert.ok(grouped, 'a generated grid maps group bands')
  const definition = definitions.get(grouped.name)!
  assert.deepEqual(dataSurfaceIssues(definition, grouped), [])
  assert.ok(dataSurfaceIssues(definition, { ...grouped, grouped: false }).includes('Grouped bands require an explicit mapping'))
  assert.ok(dataSurfaceIssues(definition, { ...grouped, bands: (grouped.bands ?? []).map((band) => band.band.includes('.') ? { ...band, band: 'header.9' as const } : band) })
    .some((issue) => issue.startsWith('Unsupported group band')))
  assert.ok(dataSurfaceIssues(definition, { ...grouped, kind: 'form' }).includes('Group bands require a grouped grid'))
})
