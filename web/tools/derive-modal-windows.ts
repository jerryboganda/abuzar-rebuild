// Derives Modern layouts for modal (response) windows - criteria and argument dialogs, selection popups and simple dialogs - by instantiating each
// recovered window through the real runtime and pairing its controls by their stored geometry.  A layout is emitted only when the
// existing `windowSurfaceIssues` check and the source-position check `windowSurfacePositionIssues` pass and every visible DataWindow has
// a validated surface; everything else stays on the labelled Classic layout and is recorded with its reason in
// docs/ui-derived-modal-windows-backlog.json.  Run tools/classify-documents.ts and tools/derive-data-surfaces.ts first.
//
// usage: node tools/derive-modal-windows.ts [--check]     (run from web/)
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { Runtime } from '../src/runtime/interp.ts'
import type { PBObject } from '../src/runtime/object.ts'
import {
  EMBEDDED_NATIVES, ARTWORK_NATIVES, WINDOW_SURFACES, CRITERIA_WINDOW_SURFACES, CALCULATOR_WINDOW_SURFACES, CALENDAR_WINDOW_SURFACES,
  windowSurfaceIssues, windowSurfacePositionIssues, windowCaptionBeside, windowCaptionAbove, windowDataCaption, closedHeight,
  amongContent, frameMembers, windowContentItems,
} from '../src/ui/window-surfaces.ts'
import type { WindowSurface, ControlBox } from '../src/ui/window-surfaces.ts'
import { DATA_SURFACES, CRITERIA_DATA_SURFACES, TRANSACTION_DATA_SURFACES, dataSurfaceIssues } from '../src/ui/data-surfaces.ts'
import type { DataSurface } from '../src/ui/data-surfaces.ts'
import { deriveValidated, loadDefinitions } from './derive-data-surfaces.ts'
import { dataSurfaceByName } from '../src/ui/surface-registry.ts'
import type { DwDef } from '../src/dw/def.ts'

const here = import.meta.dirname
const ART = new Set(['bitmap', 'rectangle', 'roundrectangle', 'ellipse', 'line'])
// Evidence classes written by classify-documents.ts (docs/ui-print-classification.json); run it before this generator.
const classificationPath = resolve(here, '..', '..', 'docs', 'ui-print-classification.json')
const documents: ReadonlySet<string> = new Set(existsSync(classificationPath) ?
  ['report-or-document', 'print-target', 'registered-template'].flatMap((key) => (JSON.parse(readFileSync(classificationPath, 'utf8')).members as Record<string, string[]>)[key] ?? []) : [])
const objectsRoot = resolve(here, '..', '..', 'data', 'src', 'objects')
export const OUTPUT_TS = resolve(here, '..', 'src', 'ui', 'derived-modal-windows.ts')
export const OUTPUT_BACKLOG = resolve(here, '..', '..', 'docs', 'ui-derived-modal-windows-backlog.json')
// Entry masters use the entry-window layout; every other response window is considered here.
const ENTRY_ANCESTORS = new Set(['w_single_entry', 'w_multi_entry'])

interface ClassSource { library: string; kind: string; path: string }
export function indexClasses(): Map<string, ClassSource> {
  const index = new Map<string, ClassSource>()
  for (const library of readdirSync(objectsRoot)) {
    for (const kind of ['window', 'userobject', 'structure']) {
      const dir = resolve(objectsRoot, library, kind)
      if (!existsSync(dir)) continue
      for (const file of readdirSync(dir)) if (file.endsWith('.json')) index.set(file.slice(0, -5), { library, kind, path: resolve(dir, file) })
    }
  }
  return index
}

interface Box { name: string; native: string; control: PBObject; x: number; y: number; width: number; height: number; right: number; text: string; hidden: boolean }
const toBox = (control: PBObject): Box => {
  const n = (key: string) => Number(control.pbGet(key) ?? 0)
  return {
    name: control.name, native: control.native, control, x: n('x'), y: n('y'), width: n('width'), height: n('height'),
    right: n('x') + n('width'), text: String(control.pbGet('text') ?? ''), hidden: control.props.get('visible') === false,
  }
}
const centreY = (box: Box) => box.y + closedHeight(box) / 2
const labelText = (text: string) => text.replace(/&(?=\S)/g, '').replace(/\s+/g, ' ').replace(/\s*:\s*$/, '').trim()

export interface ModalDerivation { surface?: WindowSurface; reason?: string }
export const REVIEWED_MODAL_WINDOWS = [...WINDOW_SURFACES, ...CALCULATOR_WINDOW_SURFACES, ...CALENDAR_WINDOW_SURFACES, ...CRITERIA_WINDOW_SURFACES]
export const NOT_MODAL = 'not a dialog or sheet window'
type Resolve = (dataobject: string) => DataSurface | undefined

const SUPPORTED = new Set(['commandbutton', 'editmask', 'singlelineedit', 'statictext', 'groupbox', 'listbox', 'datawindow', 'checkbox', 'radiobutton', 'monthcalendar', 'hprogressbar', 'dropdownlistbox', 'multilineedit', 'picture', 'rectangle', ...EMBEDDED_NATIVES])

/**
 * `ancestors` holds the control geometry of each ancestor window class, nearest first: a hidden inherited control keeps the caption
 * pairing of the class that places it, as a descendant may park its unused inherited controls anywhere.
 */
/** The caption the nearest ancestor that places a hidden inherited input gives it, among the window's unused hidden captions. */
function inheritedCaption(input: Box, statics: readonly Box[], ancestors: readonly (readonly ControlBox[])[]): string | undefined {
  for (const geometry of ancestors) {
    const target = geometry.find((box) => box.name === input.name)
    if (!target) continue
    const choices = geometry.filter((box) => box.native === 'statictext' && statics.some((text) => text.name === box.name)).flatMap((text) =>
      windowCaptionBeside(text, target, geometry) ? [{ text, cost: Math.abs(text.y + text.height / 2 - (target.y + closedHeight(target) / 2)) * 10 + Math.max(0, target.x - (text.x + text.width)) }] :
        windowCaptionAbove(text, target) ? [{ text, cost: (target.y - (text.y + closedHeight(text))) * 10 + Math.abs(text.x - target.x) + 200 }] : [])
      .sort((a, b) => a.cost - b.cost)
    // The nearest ancestor that places the input decides; when it gives it no caption, none is inherited.
    return choices[0]?.text.name
  }
  return undefined
}

const STAGGERED_DIALOGS: ReadonlySet<string> = new Set(['w_arg_cust_sdate_ldate_v13', 'w_arg_customers_sdate_ldate_v7'])

export async function deriveModal(name: string, library: string, rt: Runtime, resolveSurface: Resolve, definitions: Map<string, DwDef>,
  ancestors: readonly (readonly ControlBox[])[] = []): Promise<ModalDerivation> {
  // Dialogs whose staggered rows the Modern grid does not reproduce (structure gate, see derive-data-surfaces.ts STAGGERED_ROWS).
  if (STAGGERED_DIALOGS.has(name)) return { reason: 'staggered rows the Modern grid does not reproduce (structure gate)' }
  let window: PBObject
  try { window = await rt.instantiate(name) } catch (error) { return { reason: `instantiate: ${(error as Error).message.slice(0, 80)}` } }
  try {
    // Response windows (3) and ordinary windows opened as sheets or dialogs (unset, 2); the MDI frame and background are never reflowed.
    const type = window.pbGet('windowtype')
    if (type !== 3 && type !== 2 && type != null) return { reason: NOT_MODAL }
    const sheet = type !== 3
    const boxes = [...window.children.values()].map(toBox)
    const unsupported = boxes.find((box) => !SUPPORTED.has(box.native) || box.control.children.size && !EMBEDDED_NATIVES.includes(box.native))
    if (unsupported) return { reason: `unsupported control: ${unsupported.native}` }
    const by = (native: string) => boxes.filter((box) => box.native === native)
    const taken = new Set<string>()
    const statics = by('statictext')
    const fields: { control: string; label?: string; name?: string }[] = []
    const inputs = [...by('editmask'), ...by('singlelineedit'), ...by('dropdownlistbox'), ...by('multilineedit')].sort((a, b) => a.y - b.y || a.x - b.x)
    const labelOfField = new Map<string, string>()
    // Globally cheapest caption-field pairs first (vertical alignment dominates), so a near caption is never taken by a farther field.  A
    // caption on the field's row must start left of it with no other control between them (that nearer control owns it); a caption stacked
    // above pays a small penalty, so a caption on the field's own row still wins.  A drop-down is one line high when closed.  Hidden
    // inherited controls pair by the same rule with hidden captions only; a hidden field without one keeps an accessible-only name.
    for (const input of inputs.filter((item) => item.hidden)) {
      const caption = inheritedCaption(input, statics.filter((text) => text.hidden && !taken.has(text.name)), ancestors)
      if (caption) { labelOfField.set(input.name, caption); taken.add(caption) }
    }
    const pairs = inputs.filter((input) => !labelOfField.has(input.name)).flatMap((input) => statics.filter((text) => text.hidden === input.hidden && !taken.has(text.name)).flatMap((text) =>
      windowCaptionBeside(text, input, boxes) ? [{ input, text, cost: Math.abs(centreY(text) - centreY(input)) * 10 + Math.max(0, input.x - text.right) }] :
        windowCaptionAbove(text, input) ? [{ input, text, cost: (input.y - (text.y + closedHeight(text))) * 10 + Math.abs(text.x - input.x) + 200 }] : []))
      .sort((a, b) => a.cost - b.cost)
    for (const pair of pairs) {
      if (labelOfField.has(pair.input.name) || taken.has(pair.text.name)) continue
      labelOfField.set(pair.input.name, pair.text.name)
      taken.add(pair.text.name)
    }
    const boxesAll = by('groupbox')
    const inside = (outer: Box, inner: Box) => inner.x >= outer.x - 8 && inner.right <= outer.right + 8 && inner.y >= outer.y - 8 && inner.y + inner.height <= outer.y + outer.height + 8
    const unnamed = new Map<string, number>()
    const fieldFields: { control: string; label?: string; name?: string }[] = []
    for (const box of inputs) {
      const label = labelOfField.get(box.name)
      if (label) { fieldFields.push({ control: box.name, label }); continue }
      // The source paints no caption: keep it unpainted and name the field from its box or its control, with its position among peers.
      const holder = boxesAll.filter((group) => inside(group, box)).sort((x, y) => x.width * x.height - y.width * y.height)[0]
      const base = holder ? labelText(holder.text) : ''
      const stem = base || box.name.replace(/^[a-z]+_/i, '').replace(/_/g, ' ')
      const count = (unnamed.get(stem) ?? 0) + 1
      unnamed.set(stem, count)
      fieldFields.push({ control: box.name, name: `${stem.charAt(0).toUpperCase()}${stem.slice(1)}${inputs.filter((peer) => !labelOfField.has(peer.name)).length > 1 ? ` ${count}` : ''}` })
    }
    fields.push(...fieldFields)
    const groupboxes = by('groupbox')
    const area = (box: Box) => box.width * box.height
    const contains = (outer: Box, inner: Box) => inner.x >= outer.x - 8 && inner.right <= outer.right + 8 && inner.y >= outer.y - 8 && inner.y + inner.height <= outer.y + outer.height + 8
    const lists: { control: string; caption?: string; label?: string; name?: string }[] = []
    const listCaptions = new Set<string>()
    const exclusive = (list: Box, box: Box) => contains(box, list) && by('listbox').filter((other) => contains(box, other)).length === 1
    for (const list of by('listbox').sort((a, b) => a.y - b.y || a.x - b.x)) {
      const holder = groupboxes.filter((box) => !listCaptions.has(box.name) && exclusive(list, box)).sort((a, b) => area(a) - area(b))[0]
      if (holder) { listCaptions.add(holder.name); lists.push({ control: list.name, caption: holder.name }); continue }
      const label = statics.filter((text) => !taken.has(text.name) && text.hidden === list.hidden && text.y + text.height <= list.y + 16 &&
        Math.min(text.right, list.right) - Math.max(text.x, list.x) > 0 && list.y - (text.y + text.height) <= 200).sort((a, b) => b.y - a.y)[0]
      if (!label) {
        // No caption in the source: an accessible-only name from the control, kept unpainted.
        lists.push({ control: list.name, name: list.name.replace(/^[a-z]+_/i, '').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()) })
        continue
      }
      taken.add(label.name)
      lists.push({ control: list.name, label: label.name })
    }
    const free = groupboxes.filter((box) => !listCaptions.has(box.name)).sort((a, b) => a.y - b.y || a.x - b.x)
    const frame = free[0]
    const frames = free.slice(1).sort((a, b) => a.y - b.y || a.x - b.x)
    const data: NonNullable<WindowSurface['data']>[number][] = []
    const dynamic: Box[] = []
    // A visible picture, drawn rectangle or progress bar is painted content (a photo, a colour key): it keeps its source position.
    // A hidden one is a passive companion a script may show.
    const auxiliary: string[] = boxes.filter((box) => ARTWORK_NATIVES.includes(box.native) && box.hidden).map((box) => box.name)
    const artwork = boxes.filter((box) => ARTWORK_NATIVES.includes(box.native) && !box.hidden).sort((a, b) => a.y - b.y || a.x - b.x).map((box) => box.name)
    // The shared price selector is bound last so a primary criteria DataWindow claims its caption first.
    for (const box of by('datawindow').sort((a, b) => Number(a.name === 'dw_price') - Number(b.name === 'dw_price') || a.y - b.y || a.x - b.x)) {
      const dataobject = String(box.control.pbGet('dataobject') ?? '').toLowerCase()
      const surface = dataobject ? resolveSurface(dataobject) : undefined
      let labels: { field: string; control: string }[] | undefined
      if (surface && surface.kind === 'form') {
        // A field named only by the surface (no label object in the DataWindow) takes the window caption beside the DataWindow, when the
        // source puts exactly one such caption per field there, with no other control between.
        const external = (field: DataSurface['fields'][number]) => (!field.labelObject || field.labelBand === 'header') && !field.suffixObject
        const labelOnly = surface.fields.filter(external)
        // A hidden inherited DataWindow takes its captions from the nearest ancestor that places it, like a hidden inherited field.
        const placing = box.hidden ? ancestors.find((geometry) => geometry.some((item) => item.name === box.name)) : undefined
        const target = placing?.find((item) => item.name === box.name)
        const beside = (placing && target ?
          placing.filter((text) => text.native === 'statictext' && statics.some((own) => own.name === text.name && own.hidden && !taken.has(own.name)) &&
            windowDataCaption(text, target, placing)).map((text) => statics.find((own) => own.name === text.name)!) :
          statics.filter((text) => !taken.has(text.name) && text.hidden === box.hidden && windowDataCaption(text, box, boxes)))
          .sort((x, y) => x.y - y.y || x.x - y.x)
        if (labelOnly.length && beside.length === labelOnly.length && labelOnly.length === surface.fields.length) {
          labels = labelOnly.map((field, index) => ({ field: field.object, control: beside[index].name }))
          for (const item of beside) taken.add(item.name)
        }
      }
      if (surface) data.push({ control: box.name, surface, ...(labels ? { labels } : {}) })
      else if (box.hidden) auxiliary.push(box.name)
      // The source assigns this DataWindow's object at run time: it keeps its original element.
      else if (!dataobject) dynamic.push(box)
      // A print, PDF or report DataWindow is exempt from structural parity (its design is redesigned separately): the window around it
      // still gets its Modern layout, and the document keeps its original element inside that frame.
      else if (documents.has(dataobject)) dynamic.push(box)
      // A DataWindow that holds only artwork (a picture holder the window script fills) or nothing at all has no field to map.
      else if (definitions.has(dataobject) && definitions.get(dataobject)!.objects.every((object) => ART.has(object.type))) dynamic.push(box)
      else return { reason: `unmapped DataWindow: ${dataobject}` }
    }
    const options = [...by('checkbox').map((box) => ({ box, native: 'checkbox' as const })), ...by('radiobutton').map((box) => ({ box, native: 'radiobutton' as const }))]
      .sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x).map(({ box, native }) => ({ control: box.name, native }))
    const calendars = by('monthcalendar').map((box) => box.name)
    const embedded = [...boxes.filter((box) => EMBEDDED_NATIVES.includes(box.native)), ...dynamic].sort((a, b) => a.y - b.y || a.x - b.x).map((box) => box.name)
    // Only the buttons of the window's own button row or column are actions; a button the source places among the content (a "...."
    // picker beside its option) keeps its position there.
    const commands = by('commandbutton').sort((a, b) => a.y - b.y || a.x - b.x)
    const actions = commands.filter((box) => box.hidden || !amongContent(box, boxes)).map((box) => box.name)
    const buttons = commands.filter((box) => !box.hidden && amongContent(box, boxes)).map((box) => box.name)
    const captions = statics.filter((text) => !fields.some((field) => field.label === text.name) && !lists.some((list) => list.label === text.name)).sort((a, b) => a.y - b.y || a.x - b.x).map((text) => text.name)
    const position = new Map(boxes.map((box) => [box.name, box]))
    const surface: WindowSurface = {
      name, library, fields, actions,
      ...(frame ? { frame: frame.name } : {}), ...(frames.length ? { frames: frames.map((f) => f.name) } : {}),
      ...(lists.length ? { lists } : {}), ...(captions.length ? { captions } : {}), ...(options.length ? { options } : {}),
      ...(calendars.length ? { calendars } : {}), ...(embedded.length ? { embedded } : {}), ...(data.length ? { data } : {}), ...(auxiliary.length ? { auxiliary } : {}),
      ...(buttons.length ? { buttons } : {}), ...(artwork.length ? { artwork } : {}),
    }
    const contentOrder = windowContentItems(surface).sort((a, b) => position.get(a)!.y - position.get(b)!.y || position.get(a)!.x - position.get(b)!.x)
    // Each groupbox keeps its caption with exactly the content it encloses in the source.
    const members = frameMembers(free.map((box) => box.name), [...contentOrder, ...(frame ? [frame.name] : [])], boxes)
    Object.assign(surface, Object.keys(members).length ? { members } : {}, { contentOrder }, sheet ? { sheet: true as const } : {})
    const issues = windowSurfaceIssues(boxes.map((box) => ({ name: box.name, native: box.native, children: 0 })), surface)
    if (issues.length) return { reason: `validation: ${issues[0].replace(/:.*$/, '')}` }
    const positions = windowSurfacePositionIssues(boxes, surface, ancestors)
    if (positions.length) return { reason: `position: ${positions[0].replace(/:.*$/, '')}` }
    for (const binding of surface.data ?? []) {
      const definition = definitions.get(binding.surface.name)
      if (!definition || dataSurfaceIssues(definition, binding.surface).length) return { reason: `invalid DataWindow surface: ${binding.surface.name}` }
    }
    return { surface }
  } finally { window.destroy() }
}

/** A runtime that instantiates recovered classes without their scripts (design-time geometry and properties only). */
export function sourceRuntime(classes: Map<string, ClassSource>): Runtime {
  return new Runtime({ load: async (className: string) => {
    const found = classes.get(className)
    if (!found) return undefined
    const definition = JSON.parse(readFileSync(found.path, 'utf8'))
    definition.routines = new Map()
    return definition
  } })
}

/** The source geometry of a window's own controls. */
export function windowGeometry(window: PBObject): ControlBox[] {
  return [...window.children.values()].map(toBox).map(({ name, native, x, y, width, height, hidden }) => ({ name, native, x, y, width, height, hidden }))
}

/** The control geometry of each ancestor window class of a class (nearest first), each instantiated once, for hidden inherited captions. */
export function ancestryOf(classes: Map<string, ClassSource>, rt: Runtime): (className: string) => Promise<ControlBox[][]> {
  const ancestorOf = (className: string): string | undefined => {
    const found = classes.get(className)
    return found ? JSON.parse(readFileSync(found.path, 'utf8')).ancestor : undefined
  }
  const geometry = new Map<string, ControlBox[] | null>()
  return async (className) => {
    const chain: ControlBox[][] = []
    for (let current = ancestorOf(className); current && classes.get(current)?.kind === 'window'; current = ancestorOf(current)) {
      if (!geometry.has(current)) {
        try {
          const instance = await rt.instantiate(current)
          geometry.set(current, windowGeometry(instance))
          instance.destroy()
        } catch { geometry.set(current, null) }
      }
      const boxes = geometry.get(current)
      if (boxes) chain.push(boxes)
    }
    return chain
  }
}

export async function deriveModalWindows() {
  const classes = indexClasses()
  const definitions = loadDefinitions()
  const reviewed = new Map<string, DataSurface>()
  for (const surface of [...DATA_SURFACES, ...CRITERIA_DATA_SURFACES, ...TRANSACTION_DATA_SURFACES]) reviewed.set(surface.name, surface)
  for (const window of [...WINDOW_SURFACES, ...CALCULATOR_WINDOW_SURFACES, ...CRITERIA_WINDOW_SURFACES]) for (const binding of window.data ?? []) reviewed.set(binding.surface.name, binding.surface)
  const resolveSurface: Resolve = (dataobject) => {
    const definition = definitions.get(dataobject)
    if (!definition) return undefined
    const surface = reviewed.get(dataobject) ?? deriveValidated(dataobject, definition).surface
    return surface && !dataSurfaceIssues(definition, surface).length ? surface : undefined
  }
  const rt = sourceRuntime(classes)
  const ancestry = ancestryOf(classes, rt)
  const handNames = new Set(REVIEWED_MODAL_WINDOWS.map((surface) => surface.name))
  const surfaces: WindowSurface[] = []
  const backlog: Record<string, string[]> = {}
  let total = 0
  const results = new Map<string, ModalDerivation>()
  for (const [name, source] of [...classes].sort(([a], [b]) => a.localeCompare(b))) {
    if (source.kind !== 'window') continue
    if (ENTRY_ANCESTORS.has(JSON.parse(readFileSync(source.path, 'utf8')).ancestor)) continue
    const outcome = await deriveModal(name, source.library, rt, resolveSurface, definitions, await ancestry(name))
    if (outcome.reason === NOT_MODAL) continue
    total++
    results.set(name, outcome)
    if (handNames.has(name)) continue
    if (outcome.surface) surfaces.push(outcome.surface)
    else {
      const [category, ...detail] = outcome.reason!.split(': ')
      ;(backlog[category] ??= []).push(detail.length ? `${name}: ${detail.join(': ')}` : name)
    }
  }
  return { surfaces, backlog, total, results }
}

export function render(surfaces: readonly WindowSurface[]): string {
  // A DataWindow surface identical to a registered global one is referenced by name; other repeated ones are declared once.
  const declared = new Map<string, string>()
  const surface = (window: WindowSurface) => {
    const text = JSON.stringify({ ...window, data: undefined })
    const data = (window.data ?? []).map((binding) => {
      const global = dataSurfaceByName(binding.surface.name)
      const rest = JSON.stringify({ control: binding.control, ...(binding.labels ? { labels: binding.labels } : {}) })
      if (global && JSON.stringify(global) === JSON.stringify(binding.surface)) return `{ ...${rest}, surface: shared(${JSON.stringify(binding.surface.name)}) }`
      const key = JSON.stringify(binding.surface)
      if (!declared.has(key)) declared.set(key, `S${declared.size + 1}`)
      return `{ ...${rest}, surface: ${declared.get(key)} }`
    })
    return `  ${text.slice(0, -1)}${window.data?.length ? `,"data":[${data.join(',')}]` : ''}},`
  }
  const rows = surfaces.map(surface)
  return [
    '// GENERATED by web/tools/derive-modal-windows.ts from data/src/objects. Do not edit; regenerate instead.',
    '// Layouts come from the real runtime instantiation; the layout re-validates against the live control tree before use.',
    "import type { WindowSurface } from './window-surfaces.ts'",
    "import type { DataSurface } from './data-surfaces.ts'",
    "import { dataSurfaceByName } from './surface-registry.ts'",
    '',
    'const shared = (name: string): DataSurface => dataSurfaceByName(name)!',
    ...[...declared].map(([text, name]) => `const ${name}: DataSurface = ${text}`),
    '',
    'export const DERIVED_MODAL_WINDOW_SURFACES: readonly WindowSurface[] = [',
    ...rows,
    ']',
    '',
  ].join('\n')
}

export function renderBacklog(total: number, derived: number, backlog: Record<string, string[]>): string {
  const pending = Object.values(backlog).reduce((sum, names) => sum + names.length, 0)
  return JSON.stringify({
    note: 'Generated by web/tools/derive-modal-windows.ts. Listed windows keep the labelled Classic layout until a reviewed mapping exists.',
    modalWindows: total, reviewed: REVIEWED_MODAL_WINDOWS.length, derived, pending,
    reasons: Object.fromEntries(Object.entries(backlog).sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
      .map(([reason, names]) => [reason, { count: names.length, names }])),
  }, null, 1) + '\n'
}

if (import.meta.main) {
  const { surfaces, backlog, total } = await deriveModalWindows()
  const ts = render(surfaces), json = renderBacklog(total, surfaces.length, backlog)
  if (process.argv.includes('--check')) {
    if (!existsSync(OUTPUT_TS) || readFileSync(OUTPUT_TS, 'utf8') !== ts || !existsSync(OUTPUT_BACKLOG) || readFileSync(OUTPUT_BACKLOG, 'utf8') !== json) {
      console.error('Derived criteria windows are stale; run node tools/derive-modal-windows.ts'); process.exit(1)
    }
  } else { writeFileSync(OUTPUT_TS, ts); writeFileSync(OUTPUT_BACKLOG, json) }
  console.log(`modal windows ${total}; reviewed ${REVIEWED_MODAL_WINDOWS.length}; derived ${surfaces.length}; pending ${Object.values(backlog).reduce((s, n) => s + n.length, 0)}`)
  for (const [reason, names] of Object.entries(backlog).sort((a, b) => b[1].length - a[1].length).slice(0, 20)) console.log(`  ${names.length}\t${reason}`)
}
