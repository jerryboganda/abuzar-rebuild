// Derives Modern entry-window layouts (single/multi entry masters) by instantiating each recovered window through the real
// runtime and reading its control tree, then checks that every visible DataWindow it hosts has a validated Modern surface.
// Windows that cannot be mapped honestly stay on the labelled Classic layout and are recorded in
// docs/ui-derived-windows-backlog.json with the concrete reason.
//
// usage: node tools/derive-entry-windows.ts [--check]     (run from web/)
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { Runtime } from '../src/runtime/interp.ts'
import { entryControls } from '../src/ui/modern-entry-window.ts'
import { ENTRY_WINDOW_SURFACES, entryControlPaths, entryWindowIssues } from '../src/ui/window-surfaces.ts'
import type { EntryWindowSurface } from '../src/ui/window-surfaces.ts'
import { DATA_SURFACES, CRITERIA_DATA_SURFACES, TRANSACTION_DATA_SURFACES, dataSurfaceIssues } from '../src/ui/data-surfaces.ts'
import type { DataSurface } from '../src/ui/data-surfaces.ts'
import { derive, deriveValidated, loadDefinitions } from './derive-data-surfaces.ts'

const here = import.meta.dirname
const objectsRoot = resolve(here, '..', '..', 'data', 'src', 'objects')
export const OUTPUT_TS = resolve(here, '..', 'src', 'ui', 'derived-entry-windows.ts')
export const OUTPUT_BACKLOG = resolve(here, '..', '..', 'docs', 'ui-derived-windows-backlog.json')

interface ClassSource { library: string; kind: string; path: string }

function indexClasses(): Map<string, ClassSource> {
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

const detailPage = 'tab_retrieve.tabpage_detail'
const listPage = 'tab_retrieve.tabpage_list'

export interface WindowDerivation { surface?: EntryWindowSurface; reason?: string }

export async function deriveWindow(
  name: string, classes: Map<string, ClassSource>,
  lookup: (dataobject: string) => { surface: DataSurface; inline: boolean } | undefined,
): Promise<WindowDerivation> {
  const source = classes.get(name)
  if (!source) return { reason: 'missing window definition' }
  const rt = new Runtime({ load: async (className: string) => {
    const found = classes.get(className)
    if (!found) return undefined
    const definition = JSON.parse(readFileSync(found.path, 'utf8'))
    definition.routines = new Map()
    return definition
  } })
  let window
  try { window = await rt.instantiate(name) } catch (error) { return { reason: `instantiate: ${(error as Error).message.slice(0, 80)}` } }
  try {
    const controls = entryControls(window)
    const paths = [...controls].map(([path, control]) => ({ path, native: control.native }))
    const placed: { detail: EntryWindowSurface['details'][number]; y: number; x: number }[] = []
    const data: string[] = []
    for (const [path, control] of controls) {
      if (!path.startsWith(`${detailPage}.`)) continue
      const controlName = path.slice(detailPage.length + 1)
      if (controlName.includes('.')) continue
      const at = { y: Number(control.pbGet('y') ?? 0), x: Number(control.pbGet('x') ?? 0) }
      // Other Detail-page controls keep their original element, in source order.
      if (control.native !== 'datawindow') { placed.push({ detail: { control: controlName, kind: 'control' }, ...at }); continue }
      // DataWindow object names are case-insensitive in the source; the definitions are keyed in lower case.
      const dataobject = String(control.pbGet('dataobject') ?? '').toLowerCase()
      if (control.props.get('visible') === false) { placed.push({ detail: { control: controlName, kind: 'auxiliary' }, ...at }); continue }
      // A DataWindow whose object is assigned at run time cannot be mapped ahead of time: it keeps its original element.
      if (!dataobject) { placed.push({ detail: { control: controlName, kind: 'control' }, ...at }); continue }
      const found = lookup(dataobject)
      if (!found) return { reason: `unmapped DataWindow: ${dataobject}` }
      placed.push({ detail: { control: controlName, kind: found.surface.kind === 'form' ? 'form' : 'grid', ...(found.inline ? { surface: found.surface } : {}) }, ...at })
      data.push(dataobject)
    }
    // Visible DataWindows keep the source reading order (top to bottom, then left to right); hidden companions follow by name.
    const details = [
      ...placed.filter((item) => item.detail.kind !== 'auxiliary').sort((a, b) => a.y - b.y || a.x - b.x),
      ...placed.filter((item) => item.detail.kind === 'auxiliary').sort((a, b) => a.detail.control.localeCompare(b.detail.control)),
    ].map((item) => item.detail)
    const listControl = controls.get(`${listPage}.dw_list`)
    const listObject = String(listControl?.pbGet('dataobject') ?? '').toLowerCase()
    const list = lookup(listObject)
    if (!listControl || !list || list.surface.kind !== 'grid') return { reason: `unmapped list DataWindow: ${listObject}` }
    const multi = classes.get(name) && controls.has(`${detailPage}.dw_itemsdetail`)
    const surface: EntryWindowSurface = {
      name, library: source.library, family: multi ? 'multi' : 'single', controls: paths, details,
      ...(list.inline ? { list: list.surface } : {}),
    }
    const issues = entryWindowIssues(paths, surface)
    if (issues.length) return { reason: `validation: ${issues[0].replace(/:.*$/, '')}` }
    return { surface }
  } finally { window.destroy() }
}

export async function deriveWindows(): Promise<{ surfaces: EntryWindowSurface[]; backlog: Record<string, string[]>; total: number; results: Map<string, WindowDerivation> }> {
  const classes = indexClasses()
  const definitions = loadDefinitions()
  const global = new Map<string, DataSurface>()
  for (const surface of [...DATA_SURFACES, ...CRITERIA_DATA_SURFACES, ...TRANSACTION_DATA_SURFACES]) global.set(surface.name, surface)
  const contextual = new Map<string, DataSurface>()
  for (const entry of ENTRY_WINDOW_SURFACES) {
    for (const detail of entry.details) if (detail.surface) contextual.set(detail.surface.name, detail.surface)
    if (entry.list) contextual.set(entry.list.name, entry.list)
  }
  // A DataWindow hosted by an entry master keeps a context-only mapping, so unrelated uses are not re-presented.
  const lookup = (dataobject: string) => {
    const def = definitions.get(dataobject)
    if (!def) return undefined
    const reviewed = global.get(dataobject)
    if (reviewed) return !dataSurfaceIssues(def, reviewed).length ? { surface: reviewed, inline: false } : undefined
    const surface = contextual.get(dataobject) ?? deriveValidated(dataobject, def).surface
    return surface && !dataSurfaceIssues(def, surface).length ? { surface, inline: true } : undefined
  }
  const hand = new Set(ENTRY_WINDOW_SURFACES.map((surface) => surface.name))
  const surfaces: EntryWindowSurface[] = []
  const backlog: Record<string, string[]> = {}
  let total = 0
  const results = new Map<string, WindowDerivation>()
  for (const [name, source] of [...classes].sort(([a], [b]) => a.localeCompare(b))) {
    if (source.kind !== 'window') continue
    const ancestor = JSON.parse(readFileSync(source.path, 'utf8')).ancestor
    if (ancestor !== 'w_single_entry' && ancestor !== 'w_multi_entry') continue
    total++
    const outcome = await deriveWindow(name, classes, lookup)
    results.set(name, outcome)
    if (hand.has(name)) continue
    if (outcome.surface) surfaces.push(outcome.surface)
    else {
      const [category, ...detail] = outcome.reason!.split(': ')
      ;(backlog[category] ??= []).push(detail.length ? `${name}: ${detail.join(': ')}` : name)
    }
  }
  return { surfaces, backlog, total, results }
}

export function render(surfaces: readonly EntryWindowSurface[]): string {
  const sameSet = (left: EntryWindowSurface['controls'], right: EntryWindowSurface['controls']) =>
    left.length === right.length && left.every((control) => right.some((other) => other.path === control.path && other.native === control.native))
  const entry = (surface: EntryWindowSurface) => {
    const detailNames = surface.details.map((detail) => detail.control)
    const standard = entryControlPaths(detailNames)
    const controls = sameSet(standard, surface.controls) ? `entryControlPaths(${JSON.stringify(detailNames)})` : JSON.stringify(surface.controls)
    return `  { name: ${JSON.stringify(surface.name)}, library: ${JSON.stringify(surface.library)}, family: ${JSON.stringify(surface.family)}, ` +
      `controls: ${controls}, details: ${JSON.stringify(surface.details)}${surface.list ? `, list: ${JSON.stringify(surface.list)}` : ''} },`
  }
  return [
    '// GENERATED by web/tools/derive-entry-windows.ts from data/src/objects. Do not edit; regenerate instead.',
    '// Control trees come from the real runtime instantiation; the layout re-validates against the live tree before use.',
    "import { entryControlPaths } from './window-surfaces.ts'",
    "import type { EntryWindowSurface } from './window-surfaces.ts'",
    '',
    'export const DERIVED_ENTRY_WINDOW_SURFACES: readonly EntryWindowSurface[] = [',
    ...surfaces.map(entry),
    ']',
    '',
  ].join('\n')
}

if (import.meta.main) {
  const { surfaces, backlog, total } = await deriveWindows()
  const pending = Object.values(backlog).reduce((sum, names) => sum + names.length, 0)
  const ts = render(surfaces)
  const json = JSON.stringify({
    note: 'Generated by web/tools/derive-entry-windows.ts. Listed windows keep the labelled Classic layout until their DataWindows or controls have a reviewed mapping.',
    entryWindows: total, handAuthored: ENTRY_WINDOW_SURFACES.length, derived: surfaces.length, pending,
    reasons: Object.fromEntries(Object.entries(backlog).sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
      .map(([reason, names]) => [reason, { count: names.length, names }])),
  }, null, 1) + '\n'
  if (process.argv.includes('--check')) {
    if (!existsSync(OUTPUT_TS) || readFileSync(OUTPUT_TS, 'utf8') !== ts || !existsSync(OUTPUT_BACKLOG) || readFileSync(OUTPUT_BACKLOG, 'utf8') !== json) {
      console.error('Derived entry windows are stale; run node tools/derive-entry-windows.ts'); process.exit(1)
    }
  } else { writeFileSync(OUTPUT_TS, ts); writeFileSync(OUTPUT_BACKLOG, json) }
  console.log(`entry windows ${total}; hand ${ENTRY_WINDOW_SURFACES.length}; derived ${surfaces.length}; pending ${pending}`)
  for (const [reason, names] of Object.entries(backlog).sort((a, b) => b[1].length - a[1].length).slice(0, 20)) console.log(`  ${names.length}\t${reason}`)
}
