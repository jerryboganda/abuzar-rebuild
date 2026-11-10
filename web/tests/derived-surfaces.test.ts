import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DATA_SURFACES, CRITERIA_DATA_SURFACES, TRANSACTION_DATA_SURFACES, dataSurfaceIssues, dataSurfacePositionIssues, coveredHeaderText } from '../src/ui/data-surfaces.ts'
import type { DataSurface } from '../src/ui/data-surfaces.ts'
import { ENTRY_WINDOW_SURFACES, entryWindowIssues, WINDOW_SURFACES, CRITERIA_WINDOW_SURFACES, windowSurfaceIssues } from '../src/ui/window-surfaces.ts'
import { DERIVED_DATA_SURFACES } from '../src/ui/derived-data-surfaces.ts'
import { DERIVED_SCREEN_DATA_SURFACES } from '../src/ui/derived-screen-data-surfaces.ts'
import { DERIVED_COMPATIBILITY_DATA_SURFACES } from '../src/ui/derived-compatibility-data-surfaces.ts'
import { DERIVED_ENTRY_WINDOW_SURFACES } from '../src/ui/derived-entry-windows.ts'
import { DERIVED_MODAL_WINDOW_SURFACES } from '../src/ui/derived-modal-windows.ts'
import { modalWindowSurfaceByName } from '../src/ui/window-registry.ts'
import { ALL_ENTRY_WINDOW_SURFACES, dataSurfaceByName, ALL_DATA_SURFACES } from '../src/ui/surface-registry.ts'
import * as dataTool from '../tools/derive-data-surfaces.ts'
import * as screenTool from '../tools/derive-screen-data-surfaces.ts'
import * as compatibilityTool from '../tools/derive-compatibility-data-surfaces.ts'
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
  assert.equal(ALL_DATA_SURFACES.length,
    new Set([...DERIVED_DATA_SURFACES, ...DERIVED_SCREEN_DATA_SURFACES, ...DERIVED_COMPATIBILITY_DATA_SURFACES, ...DATA_SURFACES]
      .map((surface) => surface.name)).size)
  assert.equal(dataSurfaceByName('d_aginginterval'), DATA_SURFACES.find((surface) => surface.name === 'd_aginginterval'))
  assert.equal(dataSurfaceByName(DERIVED_DATA_SURFACES[0].name), DERIVED_DATA_SURFACES[0])
})

test('generated screen surfaces cover entry-hosted DataWindows without a contextual mapping', () => {
  const outcome = screenTool.deriveScreenDataSurfaces()
  assert.equal(screenTool.render(outcome.surfaces), readFileSync(screenTool.OUTPUT_TS, 'utf8'),
    'Run node tools/derive-screen-data-surfaces.ts from web/')
  assert.equal(screenTool.renderBacklog(outcome.total, outcome.surfaces.length, outcome.backlog),
    readFileSync(screenTool.OUTPUT_BACKLOG, 'utf8'))
  assert.equal(DERIVED_SCREEN_DATA_SURFACES.length, outcome.surfaces.length)
  assert.ok(DERIVED_SCREEN_DATA_SURFACES.length >= 40)
  const names = new Set<string>()
  for (const surface of DERIVED_SCREEN_DATA_SURFACES) {
    assert.ok(!names.has(surface.name), surface.name)
    names.add(surface.name)
    const definition = definitions.get(surface.name)
    assert.ok(definition, surface.name)
    assert.deepEqual(dataSurfaceIssues(definition, surface), [], surface.name)
  }
})

test('OLE and RichText presentation styles map to true Modern surfaces', () => {
  const ole = definitions.get('d_oletest')!
  const oleSurface = dataTool.deriveValidated('d_oletest', ole).surface
  assert.ok(oleSurface)
  assert.equal(oleSurface.kind, 'form')
  assert.equal(oleSurface.sourceProcessing, 6)
  assert.deepEqual(oleSurface.embedded, ['ole_1'])
  assert.deepEqual(dataSurfaceIssues(ole, oleSurface), [])
  assert.ok(dataSurfaceIssues(ole, { ...oleSurface, embedded: ['missing'] }).includes('Unsupported embedded object: missing'))
  assert.ok(dataSurfaceIssues(ole, { ...oleSurface, embedded: undefined }).includes('No fields mapped'))
  const rich = definitions.get('d_serviceresult_comments')!
  const richSurface = dataTool.deriveValidated('d_serviceresult_comments', rich).surface
  assert.ok(richSurface)
  assert.equal(richSurface.kind, 'form')
  assert.equal(richSurface.sourceProcessing, 7)
  assert.deepEqual(richSurface.fields, [{ object: 'comments', label: 'Comments', labelHidden: true, multiline: true }])
  assert.deepEqual(dataSurfaceIssues(rich, richSurface), [])
  assert.deepEqual(dataSurfacePositionIssues(rich, richSurface), [])
})

test('a group-header checkbox is an interactive band field', () => {
  for (const name of ['d_postedsale_for_population', 'd_postedsale_for_proformainvoice']) {
    const definition = definitions.get(name)!
    const derived = dataTool.deriveValidated(name, definition).surface
    assert.ok(derived, name)
    assert.equal(derived.grouped, true, name)
    const band = derived.bands?.find((item) => item.band === 'header.1')!
    const checkbox = band.fields.find((field) => field.object === 'invselected')!
    assert.deepEqual(checkbox.choice, { kind: 'checkbox', on: 'Y', off: 'N' }, name)
    assert.equal(checkbox.labelHidden, true, name)
    assert.deepEqual(dataSurfaceIssues(definition, derived), [], name)
    assert.deepEqual(dataSurfacePositionIssues(definition, derived), [], name)
    const unmapped = {
      ...derived,
      bands: derived.bands!.map((item) => item.band === 'header.1'
        ? { ...item, fields: item.fields.map((field) => field.object === 'invselected' ? { ...field, choice: undefined } : field) }
        : item),
    }
    assert.ok(dataSurfaceIssues(definition, unmapped).includes('Group checkbox requires its mapped interaction: invselected'), name)
  }
})

test('visible bitmap holders derive as painted artwork, not compatibility fallbacks', () => {
  for (const [name, count] of [
    ['d_employeeimage_rowid', 1], ['d_itemimage_rowid', 1], ['d_patientimage_rowid', 1],
    ['d_qualifiedpersonimage_rowid', 1], ['d_studentimage_rowid', 1], ['d_packpicture', 15],
  ] as const) {
    const definition = definitions.get(name)!
    const derived = dataTool.deriveValidated(name, definition).surface
    assert.ok(derived, name)
    assert.equal(derived.kind, 'form', name)
    assert.equal(derived.artwork?.length, count, name)
    assert.ok(derived.artwork?.every((object) =>
      definition.objects.find((item) => item.name.toLowerCase() === object)?.type === 'bitmap'), name)
    assert.ok(!derived.decorations?.some((object) => derived.artwork!.includes(object)), name)
    assert.deepEqual(dataSurfaceIssues(definition, derived), [], name)
  }
  assert.ok(!DERIVED_COMPATIBILITY_DATA_SURFACES.some((surface) =>
    surface.name === 'd_packpicture' || surface.name.endsWith('_image_rowid')))
  const packs = definitions.get('d_packpicture')!
  const packSurface = dataTool.deriveValidated('d_packpicture', packs).surface!
  assert.ok(dataSurfaceIssues(packs, { ...packSurface, artwork: ['p_case', 'missing'] }).includes('Unsupported artwork: missing'))
  assert.ok(dataSurfaceIssues(packs, { ...packSurface, kind: 'grid' }).includes('Artwork requires a form layout'))
})

test('identical checkbox on/off values derive as read-only fixed indicators', () => {
  const hpc = definitions.get('d_mr_hpc')!
  const surface = dataTool.deriveValidated('d_mr_hpc', hpc).surface
  assert.ok(surface)
  assert.deepEqual(surface.fields.filter((field) => field.fixedCheckbox).map((field) => [field.object, field.fixedCheckbox]), [
    ['hpc_chestheavinessradiatedtojawneck', '0'],
    ['hpc_shortnessofbreathasswithvomitting', 'Y'],
  ])
  assert.ok(surface.fields.filter((field) => field.fixedCheckbox).every((field) => !field.choice))
  assert.deepEqual(dataSurfaceIssues(hpc, surface), [])
  const xray = definitions.get('d_mr_xray')!
  const xraySurface = dataTool.deriveValidated('d_mr_xray', xray).surface!
  assert.equal(xraySurface.fields.find((field) => field.object === 'findingswithinnormallimits')?.fixedCheckbox, 'Y')
  const changed = { ...xraySurface, fields: xraySurface.fields.map((field) =>
    field.object === 'findingswithinnormallimits' ? { ...field, fixedCheckbox: 'N' } : field) }
  assert.ok(dataSurfaceIssues(xray, changed).includes('Fixed checkbox binding changed: findingswithinnormallimits'))
  const editable = { ...xraySurface, fields: xraySurface.fields.map((field) =>
    field.object === 'findingswithinnormallimits' ? { ...field, choice: { kind: 'list' as const } } : field) }
  assert.ok(dataSurfaceIssues(xray, editable).some((issue) => issue.startsWith('Fixed checkbox must not map a choice')))
  assert.ok(!DERIVED_COMPATIBILITY_DATA_SURFACES.some((candidate) => candidate.name === 'd_mr_hpc' || candidate.name === 'd_mr_xray'))
})

test('compatibility surfaces keep the original rendering for structures Modern cannot map', () => {
  const outcome = compatibilityTool.deriveCompatibilitySurfaces()
  assert.equal(compatibilityTool.render(outcome.surfaces), readFileSync(compatibilityTool.OUTPUT_TS, 'utf8'),
    'Run node tools/derive-compatibility-data-surfaces.ts from web/')
  assert.equal(compatibilityTool.renderBacklog(outcome.surfaces, outcome.missing),
    readFileSync(compatibilityTool.OUTPUT_BACKLOG, 'utf8'))
  assert.equal(outcome.missing.length, 0)
  assert.equal(DERIVED_COMPATIBILITY_DATA_SURFACES.length, outcome.surfaces.length)
  assert.deepEqual(DERIVED_COMPATIBILITY_DATA_SURFACES.map((surface) => surface.name), [])
  for (const surface of DERIVED_COMPATIBILITY_DATA_SURFACES) {
    assert.equal(surface.compatibility, true, surface.name)
    assert.deepEqual(surface.fields, [], surface.name)
    assert.deepEqual(dataSurfaceIssues(definitions.get(surface.name)!, surface), [], surface.name)
  }
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
    // An unlabelled source field keeps an accessible-only name; the derivation reuses a neighbouring caption it cannot see is not painted.
    if (!derived || surface.sourceProcessing !== undefined || derived.sourceProcessing !== undefined ||
      surface.fields.some((field) => field.labelBand === 'header' || field.labelHidden)) continue
    compared++
    if (sequence(derived) !== sequence(surface)) differing.push(name)
  }
  assert.ok(compared >= 200, `compared ${compared}`)
  assert.deepEqual(differing, [])
})

test('the derivation maps a tableblob column as a read-only image field', () => {
  const definition = definitions.get('d_doctor_detail')!
  const derived = dataTool.deriveValidated('d_doctor_detail', definition).surface
  assert.ok(derived)
  const image = derived.fields.find((field) => field.object === 'blob_1')!
  assert.equal(image.kind, 'image')
  assert.equal(image.labelObject, 't_18')
  assert.deepEqual(dataSurfaceIssues(definition, derived), [])
  assert.deepEqual(dataSurfacePositionIssues(definition, derived), [])
})

test('a background report heading maps as a header value and unlocks the appointment list', () => {
  const definition = definitions.get('d_visitappointment_for_a_period')!
  const derived = dataTool.deriveValidated('d_visitappointment_for_a_period', definition).surface
  assert.ok(derived)
  assert.deepEqual(derived.header, [{ object: 'compute_1', band: 'background' }])
  assert.deepEqual(dataSurfaceIssues(definition, derived), [])
  assert.deepEqual(dataSurfacePositionIssues(definition, derived), [])
  const appointment = DERIVED_MODAL_WINDOW_SURFACES.find((surface) => surface.name === 'w_appointtments_for_a_period')!
  assert.equal(appointment.data?.find((data) => data.control === 'dw_control')?.surface.name, 'd_visitappointment_for_a_period')
  const siblingsDefinition = definitions.get('d_student_siblings_discount')!
  const siblings = dataTool.deriveValidated('d_student_siblings_discount', siblingsDefinition).surface
  assert.ok(siblings)
  assert.deepEqual(siblings.captions, [{ object: 't_1', band: 'background' }])
  assert.equal(siblings.header, undefined)
  assert.deepEqual(dataSurfaceIssues(siblingsDefinition, siblings), [])
  assert.ok(DERIVED_MODAL_WINDOW_SURFACES.some((surface) => surface.name === 'w_student_siblings_discount'))
})

test('a window-level graph stays embedded and the graph viewer derives', () => {
  const viewer = DERIVED_MODAL_WINDOW_SURFACES.find((surface) => surface.name === 'w_graphviewer')!
  assert.deepEqual(viewer.embedded, ['gr_mygraph'])
  assert.deepEqual(viewer.auxiliary, ['dw_hidden'])
  assert.equal(viewer.actions.length, 0)
})

test('non-visual timing controls derive the SMS center without presentation elements', () => {
  const sms = DERIVED_MODAL_WINDOW_SURFACES.find((surface) => surface.name === 'w_sms_center')!
  assert.deepEqual([...sms.nonVisual ?? []].sort(), ['timing_1', 'timing_2'])
  assert.ok(sms.embedded?.includes('tab_smscenter'))
})

test('missing and runtime-assigned DataWindows keep their original element', () => {
  const dashboard = DERIVED_MODAL_WINDOW_SURFACES.find((surface) => surface.name === 'w_dashboard')!
  assert.ok(dashboard.embedded?.includes('dw_top10items'))
  for (const name of ['w_populate_finalizedsaleorder', 'w_populate_saleinvoices']) {
    const window = DERIVED_MODAL_WINDOW_SURFACES.find((surface) => surface.name === name)!
    assert.deepEqual((window.embedded ?? []).filter((control) => control.startsWith('dw_')), ['dw_master', 'dw_detail', 'dw_footer'], name)
  }
  const deletedDue = DERIVED_ENTRY_WINDOW_SURFACES.find((surface) => surface.name === 'w_delete_due')!
  assert.equal(deletedDue.details.find((detail) => detail.control === 'dw_itemsdetail')?.kind, 'control')
})

test('a trailing group button maps to the end of its groupbox', () => {
  const definition = definitions.get('d_childserver_controlpanel')!
  const derived = dataTool.deriveValidated('d_childserver_controlpanel', definition).surface
  assert.ok(derived)
  assert.deepEqual(derived.groups?.map((group) => group.object), ['gb_1', 'gb_2'])
  assert.deepEqual(derived.buttons, [
    { object: 'b_import', before: 'lastdatasynchronization' },
    { object: 'b_sync', before: 'lastsaletransmited' },
    { object: 'b_saletrans', group: 'gb_2' },
  ])
  assert.deepEqual(dataSurfaceIssues(definition, derived), [])
  assert.deepEqual(dataSurfacePositionIssues(definition, derived), [])
  const window = DERIVED_MODAL_WINDOW_SURFACES.find((surface) => surface.name === 'w_childerserver_controlpanel')!
  assert.equal(window.data?.find((data) => data.control === 'dw_control')?.surface.name, 'd_childserver_controlpanel')
  const wrong = { ...derived, buttons: derived.buttons!.map((button) => button.object === 'b_saletrans' ? { ...button, group: 'missing' } : button) }
  assert.ok(dataSurfaceIssues(definition, wrong).includes('Unknown button group: b_saletrans'))
})

test('mixed header/detail captions derive the visit tables as grids', () => {
  for (const [name, fields] of [
    ['d_visitdiagnostics', ['compute_1', 'itemname', 'details', 'diagnosticvalue']],
    ['d_visitphysicalexam', ['compute_1', 'itemname', 'details']],
    ['d_visitsymptoms', ['compute_1', 'itemname', 'details', 'severitylevelcode', 'duration']],
  ] as const) {
    const definition = definitions.get(name)!
    const derived = dataTool.deriveValidated(name, definition).surface
    assert.ok(derived, name)
    assert.equal(derived.kind, 'grid', name)
    assert.deepEqual(derived.fields.map((field) => field.object), fields, name)
    assert.equal(derived.fields.find((field) => field.object === 'details')?.labelBand, 'detail', name)
    assert.ok(derived.fields.some((field) => field.labelBand === 'header'), name)
    assert.deepEqual(dataSurfaceIssues(definition, derived), [], name)
    assert.deepEqual(dataSurfacePositionIssues(definition, derived), [], name)
  }
  for (const name of ['w_visitdiagnostics', 'w_visitphysicalexam', 'w_visitsymptoms', 'w_visitsymptoms1']) {
    assert.ok(DERIVED_MODAL_WINDOW_SURFACES.some((surface) => surface.name === name), name)
  }
  const symptoms = DERIVED_MODAL_WINDOW_SURFACES.find((surface) => surface.name === 'w_visitsymptoms')!
  assert.equal(symptoms.data?.[0]?.surface.name, 'd_visitsymptoms')
})

test('a grid report header keeps header values, its title and the text hidden under it', () => {
  const definition = definitions.get('d_activemarkeditems')!
  const derived = dataTool.deriveValidated('d_activemarkeditems', definition).surface
  assert.ok(derived)
  assert.deepEqual(derived.header?.map((field) => field.object), [
    'compute_4', 'compute_5', 'c_companyname', 'c_address1', 'c_address2',
  ])
  assert.equal(derived.header?.[0].labelObject, 't_6')
  assert.deepEqual(derived.captions, [{ object: 't_2' }])
  assert.deepEqual(derived.decorations, ['l_1', 'l_2', 't_3'])
  assert.deepEqual(dataSurfaceIssues(definition, derived), [])
  assert.deepEqual(dataSurfacePositionIssues(definition, derived), [])
  const t3 = definition.objects.find((object) => object.name === 't_3')!
  const t2 = definition.objects.find((object) => object.name === 't_2')!
  assert.equal(coveredHeaderText(definition, t3), true)
  assert.equal(coveredHeaderText(definition, t2), false)
  assert.ok(dataSurfaceIssues(definition, { ...derived, kind: 'form' }).includes('Header values require a grid layout'))
  assert.ok(dataSurfaceIssues(definition, { ...derived, header: [{ object: 't_3' }] }).length)
  for (const name of ['w_salereturn_activeitemlist', 'w_saletemplate_saleestimates']) {
    assert.ok(DERIVED_MODAL_WINDOW_SURFACES.some((surface) => surface.name === name), name)
  }
})

test('the derivation accepts a form whose header band holds the only action buttons', () => {
  const definition = definitions.get('d_visit_footer')!
  const derived = dataTool.deriveValidated('d_visit_footer', definition).surface
  assert.ok(derived)
  assert.equal(derived.kind, 'form')
  assert.deepEqual(derived.fields, [])
  assert.deepEqual(derived.buttons?.map((button) => button.object), [
    'b_registerpatient', 'b_vitalsign', 'b_diagnosis', 'b_physicalexam', 'b_diagnostics',
    'b_rx', 'b_patienthistory', 'b_search', 'b_precaution', 'b_patientimage',
  ])
  assert.deepEqual(dataSurfaceIssues(definition, derived), [])
  assert.deepEqual(dataSurfacePositionIssues(definition, derived), [])
  const visit = DERIVED_ENTRY_WINDOW_SURFACES.find((surface) => surface.name === 'w_visit_form')!
  assert.deepEqual(visit.details.find((detail) => detail.control === 'dw_footer')?.surface, derived)
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
    assert.equal(surfaces.surfaces.length, DERIVED_DATA_SURFACES.length + DERIVED_SCREEN_DATA_SURFACES.length)
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
  const grouped = DERIVED_DATA_SURFACES.find((item) => item.grouped && item.bands?.some((band) => band.band.includes('.')))
    ?? DERIVED_ENTRY_WINDOW_SURFACES.flatMap((entry) => [entry.list, ...entry.details.map((detail) => detail.surface)])
      .find((item) => item?.grouped && item.bands?.some((band) => band.band.includes('.')))
  assert.ok(grouped, 'a generated grid maps group bands')
  const definition = definitions.get(grouped.name)!
  assert.deepEqual(dataSurfaceIssues(definition, grouped), [])
  assert.ok(dataSurfaceIssues(definition, { ...grouped, grouped: false }).includes('Grouped bands require an explicit mapping'))
  assert.ok(dataSurfaceIssues(definition, { ...grouped, bands: (grouped.bands ?? []).map((band) => band.band.includes('.') ? { ...band, band: 'header.9' as const } : band) })
    .some((issue) => issue.startsWith('Unsupported group band')))
  assert.ok(dataSurfaceIssues(definition, { ...grouped, kind: 'form' }).includes('Group bands require a grouped grid'))
})
