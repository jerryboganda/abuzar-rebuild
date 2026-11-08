// Node-side fixture builder for the generated (derived) window families.  It reads only the redacted metadata under
// data/src and writes two JSON files for the browser check; no script bodies are executed and no record data is used.
//   presentation-derived-modal.json  response windows: class metadata, DataWindow definitions, surface names
//   presentation-derived-entry.json  entry masters outside the standard single-entry harness
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { DERIVED_MODAL_WINDOW_SURFACES } from '../src/ui/derived-modal-windows.ts'
import { DERIVED_DATA_SURFACES } from '../src/ui/derived-data-surfaces.ts'
import { ENTRY_WINDOW_SURFACES } from '../src/ui/window-surfaces.ts'
import { ALL_ENTRY_WINDOW_SURFACES, dataSurfaceByName } from '../src/ui/surface-registry.ts'

// Same presentation metadata the other fixtures keep: no data object, menu or item, so nothing retrieves on open.
export const metadata = (control) => ({
  name: control.name, ancestor: control.ancestor,
  fields: (control.fields ?? []).filter((field) => field.attr === '0xbc' && !['control', 'dataobject', 'menuname', 'item'].includes(field.name)),
  controls: (control.controls ?? []).map(metadata),
})

export async function indexObjects(objectsRoot) {
  const index = new Map()
  for (const library of await readdir(objectsRoot)) {
    for (const kind of ['window', 'userobject', 'structure']) {
      const dir = resolve(objectsRoot, library, kind)
      if (!existsSync(dir)) continue
      for (const file of await readdir(dir)) if (file.endsWith('.json')) index.set(file.slice(0, -5), { library, kind, path: resolve(dir, file) })
    }
  }
  return index
}

/** Window classes plus every ancestor and control class reachable through the object index. */
export async function classClosure(names, objects) {
  const classes = new Map()
  const visit = async (name) => {
    if (classes.has(name) || !objects.has(name)) return
    const found = objects.get(name)
    const definition = JSON.parse(await readFile(found.path, 'utf8'))
    classes.set(name, { ...metadata(definition), kind: found.kind, library: found.library, routines: {} })
    if (definition.ancestor) await visit(definition.ancestor)
    const walk = async (controls) => { for (const control of controls ?? []) { await visit(control.ancestor); await walk(control.controls) } }
    await walk(definition.controls)
  }
  for (const name of names) await visit(name)
  return [...classes.values()]
}

/** DataWindow name -> definition subset the runtime needs to attach a model and paint a surface. */
export async function dataWindows(names, dwRoot) {
  const index = JSON.parse(await readFile(resolve(dwRoot, '_index.json'), 'utf8'))
  const bundles = new Map()
  const data = {}
  for (const name of names) {
    const library = index[name]
    if (!library) continue
    if (!bundles.has(library)) bundles.set(library, JSON.parse(gunzipSync(await readFile(resolve(dwRoot, library + '.json.gz'))).toString('utf8')))
    const definition = bundles.get(library)[name]
    data[name] = { datawindow: definition.datawindow, bands: definition.bands, objects: definition.objects,
      table: { columns: definition.table.columns, arguments: definition.table.arguments } }
  }
  return data
}

const lookupNames = (surface) => (surface?.fields ?? []).flatMap((field) => [
  ...(field.choice?.kind === 'lookup' ? [field.choice.name] : []), ...lookupNames(field.lookup),
])

/** DataWindow names a window class assigns statically, by control name (the fixture classes drop the property). */
async function controlDataObjects(path) {
  const definition = JSON.parse(await readFile(path, 'utf8'))
  const result = {}
  const walk = (controls) => {
    for (const control of controls ?? []) {
      const value = control.fields?.find((field) => field.name === 'dataobject')?.value
      if (typeof value === 'string' && value) result[control.name] = value.toLowerCase()
      walk(control.controls)
    }
  }
  walk(definition.controls)
  return result
}

export function standardSingle(surface) {
  return surface.family === 'single' && surface.controls.length === 22 && surface.details[0]?.kind === 'form' &&
    !!surface.details[0].surface && !!surface.list &&
    surface.details.map((detail) => detail.control).sort().join() === 'dw_detail,dw_listprint,dw_print'
}

export async function buildDerivedFixtures({ here, outDir }) {
  const dataRoot = resolve(here, '..', '..', 'data', 'src')
  const objects = await indexObjects(resolve(dataRoot, 'objects'))
  const dwRoot = resolve(dataRoot, 'dw')
  const reviewed = new Set(ENTRY_WINDOW_SURFACES.map((surface) => surface.name))
  const entrySurfaces = ALL_ENTRY_WINDOW_SURFACES.filter((surface) => !reviewed.has(surface.name) && !standardSingle(surface))
  const modalSurfaces = DERIVED_MODAL_WINDOW_SURFACES

  const modalNames = modalSurfaces.map((surface) => surface.name)
  const modalData = new Set(modalSurfaces.flatMap((surface) => (surface.data ?? []).map((binding) => binding.surface.name)))
  const modal = {
    classes: await classClosure(modalNames, objects),
    data: await dataWindows(modalData, dwRoot),
    surfaces: modalSurfaces.map((surface) => ({ name: surface.name, sheet: !!surface.sheet, data: (surface.data ?? []).map((binding) => binding.control) })),
  }
  await writeFile(resolve(outDir, 'presentation-derived-modal.json'), JSON.stringify(modal))

  const entryNames = entrySurfaces.map((surface) => surface.name)
  const bindings = []
  for (const surface of entrySurfaces) {
    const objectsOf = await controlDataObjects(objects.get(surface.name).path)
    const visible = surface.details.filter((detail) => detail.kind === 'form' || detail.kind === 'grid')
      .map((detail) => ({ control: detail.control, dataobject: objectsOf[detail.control], surface: detail.surface }))
    bindings.push({ name: surface.name, visible, list: { dataobject: objectsOf.dw_list, surface: surface.list } })
  }
  const entryData = new Set(['d_find'])
  for (const binding of bindings) {
    for (const item of [...binding.visible, binding.list]) {
      if (!item.dataobject) continue
      entryData.add(item.dataobject)
      for (const lookup of lookupNames(item.surface ?? dataSurfaceByName(item.dataobject))) entryData.add(lookup)
    }
  }
  const entry = {
    classes: await classClosure(entryNames, objects),
    data: await dataWindows(entryData, dwRoot),
    surfaces: entrySurfaces.map((surface) => ({ name: surface.name, family: surface.family, controls: surface.controls.length })),
    bindings,
  }
  await writeFile(resolve(outDir, 'presentation-derived-entry.json'), JSON.stringify(entry))
  const surfaceNames = new Set()
  for (const surface of DERIVED_DATA_SURFACES) {
    surfaceNames.add(surface.name)
    for (const lookup of lookupNames(surface)) surfaceNames.add(lookup)
  }
  await writeFile(resolve(outDir, 'presentation-derived-surfaces.json'), JSON.stringify({
    surfaces: DERIVED_DATA_SURFACES.map((surface) => surface.name), data: await dataWindows(surfaceNames, dwRoot),
  }))
  return { modal: modalNames.length, entry: entryNames.length, surfaces: DERIVED_DATA_SURFACES.length }
}

/** One generated modal window per distinct structural layout, so the appearance matrix covers every layout shape. */
export function representativeModalWindows() {
  const signature = (window) => JSON.stringify([
    window.fields.length, (window.captions ?? []).length > 0, !!window.frame, (window.frames ?? []).length > 0,
    (window.lists ?? []).map((list) => list.caption ? 'c' : 'l'), (window.options ?? []).map((option) => option.native[0]).join(''),
    (window.data ?? []).map((binding) => binding.surface.kind + binding.surface.fields.length +
      (binding.surface.fields.some((field) => field.choice) ? 'c' : '') + (binding.labels ? 'L' : '')).join(','),
    (window.calendars ?? []).length, (window.auxiliary ?? []).length > 0,
  ])
  const seen = new Map()
  // Dialog captures only; sheets are covered by the functional check.
  for (const window of DERIVED_MODAL_WINDOW_SURFACES) if (!window.sheet && !seen.has(signature(window))) seen.set(signature(window), window.name)
  return [...seen.values()]
}
