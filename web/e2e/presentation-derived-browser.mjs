import { Ref, Frame } from './src/runtime/interp.js'
import { DwCatalog } from './src/dw/def.js'
import { DwModel } from './src/dw/model.js'
import { PBDate, PBDateTime, PBTime } from './src/runtime/values.js'
import { entryControls } from './src/ui/modern-entry-window.js'
import { windowSurfaceIssues, entryWindowIssues } from './src/ui/window-surfaces.js'
import { modalWindowSurfaceByName } from './src/ui/window-registry.js'
import { entryWindowSurfaceByName, dataSurfaceByName } from './src/ui/surface-registry.js'
import { planLines } from './src/ui/line-plan.js'

// Generated window families.  Class metadata and DataWindow definitions are the recovered ones; no script runs, nothing is
// retrieved or saved, and rows are synthetic.  Every generated window is checked: none is sampled away.
const sleep = (ms) => new Promise((done) => setTimeout(done, ms))
// Every await that could depend on a window closing or a script finishing is bounded, so one stuck window is reported by
// name instead of hanging the whole pass.
const within = (promise, label, ms = 8000) => {
  let timer
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} did not finish within ${ms} ms`)), ms) })])
    .finally(() => clearTimeout(timer))
}
const waitFor = async (condition, label) => {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (condition()) return
    await sleep(25)
  }
  throw new Error(`Timed out waiting for ${label}`)
}
const register = (rt, classes, replace) => {
  for (const definition of classes) {
    if (rt.classes.has(definition.name) && !replace.has(definition.name)) continue
    definition.routines = new Map(Object.entries(definition.routines ?? {}).map(([owner, routines]) =>
      [owner, new Map(Object.entries(routines))]))
    rt.classes.set(definition.name, definition)
  }
}
const overlap = (view, window) => {
  const bounds = view.el.getBoundingClientRect()
  return bounds.left >= -0.5 && bounds.top >= -0.5 && bounds.right <= innerWidth + 0.5 && bounds.bottom <= innerHeight + 0.5 &&
    view.client.scrollWidth <= view.client.clientWidth + 1 && window.isOpen
}

const openModal = async (fixture, name, sheet = false) => {
  const rt = fixture.rt
  let window, failure
  const ref = new Ref(() => window, (value) => { window = value })
  ref.name = name
  const pending = sheet ? rt.sys.get('opensheet').fn(rt, [ref, fixture.frame], new Frame(null, null, 0)) :
    rt.sys.get('open').fn(rt, [ref], new Frame(null, null, 0))
  pending.catch((error) => { failure = error })
  await waitFor(() => failure || window?.isOpen && (sheet || rt.modalWaiting > 0), `${name} to open`)
  if (failure) throw failure
  return { window, pending, view: fixture.ui.views.get(window) }
}

// The pass has no database: a drop-down child DataWindow that asks to auto-retrieve must not open a Database Error dialog (it would
// block rendering), so Retrieve returns zero rows while these checks run.
const withoutDatabase = (impl) => async (...args) => {
  const original = DwModel.prototype.retrieve
  DwModel.prototype.retrieve = async function () { return 0 }
  try { return await impl(...args) } finally { DwModel.prototype.retrieve = original }
}


// Structural parity gate: the Classic phase records which controls share a row (from the real DOM geometry); the Modern phase must
// reproduce exactly those rows.  Rows are sets of control names; order within a row and the pixels are not compared.
const rowsOf = (entries) => planLines(entries.flatMap(([key, element]) => {
  if (!element || !element.getClientRects().length) return []
  const rect = element.getBoundingClientRect()
  return rect.width > 0 && rect.height > 0 ? [{ key, left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom }] : []
})).map((line) => line.map((cell) => cell.key).sort())
const compareStructure = (family, name, modern, rows, check, label) => {
  const store = (window.derivedStructure ??= {})
  const key = `${family}:${name}`
  if (!modern) { store[key] = rows; return }
  const classic = store[key]
  if (!classic) return
  const same = JSON.stringify([...classic].map((row) => row.join(',')).sort()) === JSON.stringify([...rows].map((row) => row.join(',')).sort())
  check(same, `${label}: the Modern rows equal the Classic rows (Classic ${JSON.stringify(classic)}; Modern ${JSON.stringify(rows)})`)
}

/** Response windows: the layout is accepted in Modern, absent in Classic, and every original control stays attached. */
async function checkDerivedModalWindowsImpl(fixture, check, settle, filter) {
  const source = await (await fetch('./presentation-derived-modal.json')).json()
  const names = new Set(source.surfaces.map((surface) => surface.name))
  register(fixture.rt, source.classes, names)
  const modern = fixture.session.activeMode === 'modern'
  const rt = fixture.rt
  for (const { name, sheet } of source.surfaces.filter((surface) => !filter || filter.includes(surface.name))) {
    const label = `${name}/${modern ? 'Modern' : 'Classic'}`
    let opened
    try {
      try { opened = await within(openModal(fixture, name, sheet), 'opening', 15000) } catch (error) { check(false, `${label}: opens without a script error (${error.message})`); continue }
      await settle()
      const { window, view } = opened
      const surface = modalWindowSurfaceByName(name)
      const controls = [...view.ctlViews].filter(([control]) => control.parent === window)
        .map(([control]) => ({ name: control.name, native: control.native, children: control.children.size }))
      check(view.el.classList.contains('modern-window') === modern, `${label}: the outer layout changes only in Modern`)
      check([...view.ctlViews.values()].every((binding) => view.client.contains(binding.el)), `${label}: all original control elements remain attached`)
      compareStructure('modal', name, modern, rowsOf([...surface.fields.map((field) => field.control), ...(surface.lists ?? []).map((list) => list.control)]
        .map((control) => [control, view.ctlViews.get(window.children.get(control))?.el])), check, label)
      if (modern) {
        check(!windowSurfaceIssues(controls, surface).length, `${label}: the generated layout matches the live control tree`)
        check(!!view.el.querySelector('.window-fields'), `${label}: Modern content container exists`)
        check(surface.fields.every((field) => {
          const input = view.ctlViews.get(window.children.get(field.control)).el
          const text = document.getElementById(input.getAttribute('aria-labelledby') ?? '')
          return !!text && text.textContent.trim().length > 0
        }), `${label}: every field is named by its source caption`)
        check(surface.actions.every((action) => view.el.querySelector('.window-actions')?.contains(view.ctlViews.get(window.children.get(action)).el)),
          `${label}: source actions stay in the action row`)
        if (!sheet) check(overlap(view, window), `${label}: the dialog fits the viewport without horizontal scrolling`)
        else check(view.client.scrollWidth <= view.client.clientWidth + 1, `${label}: the sheet has no horizontal scrolling`)
      }
    } catch (error) {
      check(false, `${label}: ${error.message}`)
    } finally {
      try { if (opened?.window.isOpen) await within(rt.closeWindow(opened.window), 'closing') } catch (error) { check(false, `${label}: closes (${error.message})`) }
      try { await within(Promise.resolve(opened?.pending).catch(() => {}), 'the open call settling') } catch (error) { check(false, `${label}: ${error.message}`) }
    }
  }
  // Appearance captures reuse the same fixture after the functional pass (see presentation-smoke.mjs).
  let preview
  window.closeDerivedModalPreview = async () => {
    if (preview?.window.isOpen) await within(rt.closeWindow(preview.window), 'closing preview')
    await within(Promise.resolve(preview?.pending).catch(() => {}), 'preview open call settling')
    preview = undefined
    window.derivedModalPreview = undefined
  }
  window.openDerivedModalPreview = async (name) => {
    await window.closeDerivedModalPreview()
    preview = await openModal(fixture, name)
    window.derivedModalPreview = preview
    await settle()
    return true
  }
}

const fitted = (text, definition, column) => {
  const type = definition?.table?.columns?.find((item) => item.name === column)?.type ?? ''
  const width = Number(/\((\d+)\)/.exec(type)?.[1])
  const limit = Number(definition?.objects?.find((item) => item.name === column)?.['edit.limit'])
  const widths = [width, limit].filter((value) => value > 0)
  return widths.length ? text.slice(0, Math.min(...widths)) : text
}
const synthetic = (model, row, binding, definition) => {
  for (const field of binding?.fields ?? []) {
    if (field.kind === 'computed') continue
    const kind = model.kinds[model.colIndex(field.object)]
    if (field.choice?.kind === 'checkbox') model.setItem(row, field.object, field.choice.off)
    else if (kind === 'string') model.setItem(row, field.object, field.multiline ? 'First line\r\nSecond line' : fitted('Synthetic', definition, field.object))
    else if (kind === 'number' || kind === 'decimal') model.setItem(row, field.object, '2.25')
    else if (kind === 'date') model.setItem(row, field.object, PBDate.ymd(2024, 1, 1))
    else if (kind === 'datetime') model.setItem(row, field.object, new PBDateTime(PBDate.ymd(2024, 1, 1).n, PBTime.hms(0, 0, 0).ms))
    else if (kind === 'time') model.setItem(row, field.object, PBTime.hms(0, 0, 0))
  }
}

/** Entry masters outside the standard single-entry harness (multi-entry and non-standard trees). */
async function checkDerivedEntryWindowsImpl(fixture, check, settle, filter) {
  const source = await (await fetch('./presentation-derived-entry.json')).json()
  const names = new Set(source.surfaces.map((surface) => surface.name))
  register(fixture.rt, source.classes, names)
  const modern = fixture.session.activeMode === 'modern'
  const rt = fixture.rt
  const oldCatalog = rt.dwCatalog
  const catalog = new DwCatalog(async () => undefined)
  catalog.get = async (name) => source.data[name] ? structuredClone(source.data[name]) : undefined
  rt.dwCatalog = catalog
  try {
    for (const entry of source.bindings.filter((item) => !filter || filter.includes(item.name))) {
      const surface = entryWindowSurfaceByName(entry.name)
      const label = `${entry.name}/${modern ? 'Modern' : 'Classic'}`
      let window
      try {
        const ref = new Ref(() => window, (value) => { window = value })
        ref.name = entry.name
        await within(rt.sys.get('opensheet').fn(rt, [ref, fixture.frame], new Frame(null, null, 0)), 'opening', 15000)
        const view = fixture.ui.views.get(window)
        const controls = entryControls(window)
        const control = (name) => [...controls.entries()].find(([path]) => path === name || path.endsWith('.' + name))?.[1]
        for (const item of [...entry.visible, { control: 'dw_list', ...entry.list }]) {
          const host = control(item.control)
          const binding = item.surface ?? dataSurfaceByName(item.dataobject)
          const model = new DwModel(rt, item.dataobject, structuredClone(source.data[item.dataobject]))
          for (let index = 0; index < 2; index++) {
            const row = model.insertRow(0)
            synthetic(model, row, binding, source.data[item.dataobject])
          }
          model.resetUpdate()
          host.attach(model)
        }
        control('dw_find')?.attach(new DwModel(rt, 'd_find', structuredClone(source.data.d_find)))
        await settle()
        check(controls.size === surface.controls.length && !entryWindowIssues([...controls].map(([path, c]) => ({ path, native: c.native })), surface).length,
          `${label}: the generated layout matches the live control tree`)
        check([...view.ctlViews.values()].every((binding) => view.client.contains(binding.el)), `${label}: all inherited control elements remain attached`)
        check(view.el.classList.contains('modern-entry-window') === modern, `${label}: the outer layout changes only in Modern`)
        for (const item of entry.visible) {
          const element = view.ctlViews.get(control(item.control)).el
          check(element.querySelectorAll('.modern-surface').length === (modern ? 1 : 0), `${label}/${item.control}: surface is active only in Modern`)
        }
        check(view.ctlViews.get(control('dw_list')).el.querySelectorAll('.modern-surface').length === (modern ? 1 : 0), `${label}/dw_list: list surface is active only in Modern`)
        for (const detail of surface.details.filter((item) => item.kind === 'auxiliary')) {
          check(view.ctlViews.get(control(detail.control)).el.getClientRects().length === 0, `${label}/${detail.control}: hidden companion keeps its visibility`)
        }
      } catch (error) {
        check(false, `${label}: ${error.message}`)
      } finally {
        try { if (window) await within(rt.closeWindow(window), 'closing') } catch (error) { check(false, `${label}: closes (${error.message})`) }
      }
    }
  } finally { rt.dwCatalog = oldCatalog }
}

/** Every generated global DataWindow surface renders in Modern with its recovered definition and synthetic rows. */
async function checkDerivedDataSurfacesImpl(fixture, check, settle, filter) {
  const source = await (await fetch('./presentation-derived-surfaces.json')).json()
  const rt = fixture.rt
  const modern = fixture.session.activeMode === 'modern'
  const control = fixture.sale.children.get('dw_grid')
  const original = fixture.ui.views.get(fixture.sale).ctlViews.get(control).dw
  const oldCatalog = rt.dwCatalog
  const catalog = new DwCatalog(async () => undefined)
  catalog.get = async (name) => source.data[name] ? structuredClone(source.data[name]) : undefined
  rt.dwCatalog = catalog
  try {
    for (const name of source.surfaces.filter((item) => !filter || filter.includes(item))) {
      const label = `${name}/${modern ? 'Modern' : 'Classic'}`
      const host = document.createElement('div')
      host.style.cssText = 'position:fixed;left:16px;top:16px;width:640px;height:520px;z-index:10000'
      document.body.append(host)
      let preview
      try {
        const binding = dataSurfaceByName(name)
        const owner = new control.constructor(rt, 'dw_derived_surface')
        const model = new DwModel(rt, name, structuredClone(source.data[name]))
        for (let index = 0; index < (binding.kind === 'grid' ? 3 : 1); index++) synthetic(model, model.insertRow(0), binding, source.data[name])
        model.resetUpdate()
        owner.attach(model)
        preview = new original.constructor(owner, host)
        await within(preview.render(), 'rendering')
        await settle()
        const active = !!preview.root.classList.contains('modern-surface')
        if (!modern && binding.kind === 'form') compareStructure('form', name, false, rowsOf(binding.fields.map((field) => [field.object, preview.root.querySelector(`[data-obj="${field.object}"]`)])), check, label)
        check(active === modern, `${label}: the surface is active only in Modern`)
        if (modern) {
          check(!preview.root.textContent.includes('Classic layout retained'), `${label}: the generated surface passes runtime validation`)
          // A DataWindow whose every field the definition hides (visible="0" or a constant-false visibility expression) shows
          // nothing in Classic either; only a DataWindow with a displayable field must render one.
          // A visibility expression is decided per row (here by the synthetic row), so only unconditional fields must render.
          const hidden = (object) => object?.visible === '0' || String(object?.visible ?? '').includes('\t')
          const displayable = binding.fields.some((field) => !hidden(source.data[name].objects.find((object) => object.name === field.object)))
          if (displayable) check(preview.root.querySelectorAll('[data-obj]').length > 0, `${label}: the mapped fields render`)
          if (binding.kind === 'form') compareStructure('form', name, true, rowsOf(binding.fields.map((field) => [field.object, preview.root.querySelector(`[data-obj="${field.object}"]`)])), check, label)
        }
      } catch (error) {
        check(false, `${label}: ${error.message}`)
      } finally {
        try { preview?.dispose() } catch (error) { check(false, `${label}: disposes (${error.message})`) }
        host.remove()
      }
    }
  } finally { rt.dwCatalog = oldCatalog }
}

export const checkDerivedModalWindows = withoutDatabase(checkDerivedModalWindowsImpl)

export const checkDerivedEntryWindows = withoutDatabase(checkDerivedEntryWindowsImpl)

export const checkDerivedDataSurfaces = withoutDatabase(checkDerivedDataSurfacesImpl)
