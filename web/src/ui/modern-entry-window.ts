import type { PBObject } from '../runtime/object.ts'
import type { WinView } from './dom-ui.ts'
import { ModernDwView } from './modern-dwview.ts'
import { entryWindowIssues } from './window-surfaces.ts'
import { dataSurfaceByName, entryWindowSurfaceByName } from './surface-registry.ts'
import { LIST_WINDOW_SURFACES } from './list-window-surfaces.ts'
import type { DataSurface } from './data-surfaces.ts'
import { planGrid, applyGrid } from './grid-plan.ts'
import { useSourceTabOrder } from './source-tab-order.ts'

export const ENTRY_FIND_SURFACE: DataSurface = {
  name: 'd_find', title: 'Find', kind: 'form', fields: [{ object: 'find', label: 'Find' }],
}

let nextEntry = 0

export function entryControls(window: PBObject): Map<string, PBObject> {
  const controls = new Map<string, PBObject>()
  const walk = (parent: PBObject, prefix: string) => {
    for (const [name, control] of parent.children) {
      const path = prefix ? `${prefix}.${name}` : name
      controls.set(path, control)
      walk(control, path)
    }
  }
  walk(window, '')
  return controls
}


const LIST_CONTROLS = ['r_1', 'gb_sort', 'gb_fliter', 'ddlb_sort', 'rb_ascending', 'rb_descending', 'ddlb_filter_column', 'ddlb_op', 'ddlb_data',
  'cb_filter', 'dw_list', 'st_find', 'st_1', 'st_2', 'dw_find', 'cb_retrieve']

/**
 * Approved design for the list windows (Groups, Employees, MR list and the other w_listview_form windows): their single List page
 * gets the same Modern layout as the List page of the entry windows (criteria, find, the list as a Modern grid).  The controls,
 * their runtime objects and events are the original ones; a window whose controls or list mapping differ keeps its layout.
 */
export function applyModernListWindow(view: WinView): boolean {
  if (!view.sheet || view.modal) return false
  const controls = entryControls(view.w)
  const tabPath = 'tab_retrieve'
  const listPath = `${tabPath}.tabpage_list`
  if (!controls.has(`${listPath}.dw_list`) || controls.has(`${tabPath}.tabpage_detail`)) return false
  if (LIST_CONTROLS.some((name) => !controls.get(`${listPath}.${name}`) || !view.ctlViews.get(controls.get(`${listPath}.${name}`)!))) return false
  const tab = view.ctlViews.get(controls.get(tabPath)!)?.el
  const pages = tab?.querySelectorAll<HTMLElement>(':scope > .page')
  const findView = view.ctlViews.get(controls.get(`${listPath}.dw_find`)!)?.dw
  const listView = view.ctlViews.get(controls.get(`${listPath}.dw_list`)!)?.dw
  const listName = String(controls.get(`${listPath}.dw_list`)!.props.get('dataobject') ?? '').toLowerCase()
  const surface = dataSurfaceByName(listName) ?? LIST_WINDOW_SURFACES.find((item) => item.name === listName)
  if (!tab || pages?.length !== 1 || !(findView instanceof ModernDwView) || !(listView instanceof ModernDwView) || !surface || surface.kind !== 'grid') {
    console.warn(`Classic list layout retained for ${view.w.className}`)
    return false
  }
  const identity = `list-window-${++nextEntry}`
  const element = (name: string) => view.ctlViews.get(controls.get(`${listPath}.${name}`)!)!.el
  for (const name of LIST_CONTROLS) {
    element(name).classList.add('entry-control')
    element(name).dataset.entryControl = `${listPath}.${name}`
  }
  useSourceTabOrder(view.el, view.client, LIST_CONTROLS.map((name) => ({ element: element(name), taborder: controls.get(`${listPath}.${name}`)!.props?.get('taborder') })))
  const group = (className: string, children: HTMLElement[]) => {
    const section = document.createElement('div')
    section.className = className
    section.append(...children)
    return section
  }
  const named = (name: string, label: string) => { const control = element(name); control.setAttribute('aria-label', label); return control }
  const criteria = (name: string, children: HTMLElement[]) => {
    const caption = element(name)
    caption.id = `${identity}-${name}`
    caption.classList.add('entry-caption')
    const section = group('entry-criteria-group', [caption, ...children])
    section.setAttribute('role', 'group')
    section.setAttribute('aria-labelledby', caption.id)
    return section
  }
  const sort = criteria('gb_sort', [named('ddlb_sort', 'Sort column'), group('entry-order', [element('rb_ascending'), element('rb_descending')])])
  const filter = criteria('gb_fliter', [
    group('entry-filter-fields', [named('ddlb_filter_column', 'Filter column'), named('ddlb_op', 'Filter operator'), named('ddlb_data', 'Filter value')]),
    group('entry-filter-actions', [element('cb_filter'), element('cb_retrieve')]),
  ])
  const findLabel = element('st_find')
  findLabel.id = `${identity}-find-label`
  const find = element('dw_find')
  find.classList.add('entry-data', 'entry-form', 'entry-find')
  const help = element('st_1')
  help.id = `${identity}-find-help`
  find.setAttribute('aria-describedby', help.id)
  const list = element('dw_list')
  list.classList.add('entry-data', 'entry-grid')
  const decoration = element('r_1')
  decoration.classList.add('entry-decoration')
  decoration.setAttribute('aria-hidden', 'true')
  pages[0].replaceChildren(group('entry-list', [group('entry-criteria', [sort, filter]), group('entry-search', [findLabel, help, find, element('st_2')]), list, decoration]))
  findView.useContextSurface(ENTRY_FIND_SURFACE, new Map([['find', findLabel]]))
  listView.useContextSurface(surface)
  tab.classList.add('entry-tabs', 'entry-control')
  tab.dataset.entryControl = tabPath
  view.el.classList.add('modern-entry-window', 'modern-list-window')
  return true
}

/** Reflow reviewed entry controls without replacing their runtime objects or events. */
export function applyModernEntryWindow(view: WinView): boolean {
  const surface = entryWindowSurfaceByName(view.w.className)
  if (!surface || !view.sheet || view.modal) return false
  const controls = entryControls(view.w)
  const issues = entryWindowIssues([...controls].map(([path, control]) => ({ path, native: control.native })), surface)
  const tabPath = 'tab_retrieve'
  const detailPath = `${tabPath}.tabpage_detail`
  const listPath = `${tabPath}.tabpage_list`
  const tab = view.ctlViews.get(controls.get(tabPath)!)?.el
  const pages = tab?.querySelectorAll<HTMLElement>(':scope > .page')
  const findView = view.ctlViews.get(controls.get(`${listPath}.dw_find`)!)?.dw
  if (!tab || pages?.length !== 2 || !(findView instanceof ModernDwView)) issues.push('Missing entry presentation bindings')
  const scoped = [
    ...surface.details.flatMap((binding) => binding.surface ? [{ path: `${detailPath}.${binding.control}`, surface: binding.surface }] : []),
    ...(surface.list ? [{ path: `${listPath}.dw_list`, surface: surface.list }] : []),
  ].map((binding) => ({ ...binding, view: view.ctlViews.get(controls.get(binding.path)!)?.dw }))
  for (const binding of scoped) if (!(binding.view instanceof ModernDwView)) issues.push(`Missing data presentation: ${binding.path}`)
  for (const [path, control] of controls) {
    if (path !== detailPath && path !== listPath && !view.ctlViews.has(control)) issues.push(`Missing view: ${path}`)
  }
  if (issues.length || !tab || pages?.length !== 2 || !(findView instanceof ModernDwView)) {
    console.warn(`Classic window layout retained for ${surface.name}: ${issues.join('; ')}`)
    return false
  }
  const identity = `entry-window-${++nextEntry}`
  const element = (path: string) => view.ctlViews.get(controls.get(path)!)!.el
  for (const [path, control] of controls) {
    const binding = view.ctlViews.get(control)
    if (!binding) continue
    binding.el.classList.add('entry-control')
    binding.el.dataset.entryControl = path
  }
  // The rearranged pages keep the source tab order (dw_find before the criteria on the List page, as in Classic).
  useSourceTabOrder(view.el, view.client, [...controls].flatMap(([, control]) => {
    const binding = view.ctlViews.get(control)
    return binding ? [{ element: binding.el, taborder: control.props?.get('taborder') }] : []
  }))
  const group = (className: string, children: HTMLElement[]) => {
    const section = document.createElement('div')
    section.className = className
    section.append(...children)
    return section
  }
  const data = (path: string, kind: 'form' | 'grid' | 'auxiliary' | 'control') => {
    const host = element(path)
    host.classList.add(kind === 'control' ? 'entry-extra' : 'entry-data', `entry-${kind}`)
    return host
  }
  const named = (name: string, label: string) => {
    const control = element(`${listPath}.${name}`)
    control.setAttribute('aria-label', label)
    return control
  }
  const criteria = (name: string, children: HTMLElement[]) => {
    const caption = element(`${listPath}.${name}`)
    caption.id = `${identity}-${name}`
    caption.classList.add('entry-caption')
    const section = group('entry-criteria-group', [caption, ...children])
    section.setAttribute('role', 'group')
    section.setAttribute('aria-labelledby', caption.id)
    return section
  }
  const sort = criteria('gb_sort', [
    named('ddlb_sort', 'Sort column'),
    group('entry-order', ['rb_ascending', 'rb_descending'].map((name) => element(`${listPath}.${name}`))),
  ])
  const filter = criteria('gb_fliter', [
    group('entry-filter-fields', [
      named('ddlb_filter_column', 'Filter column'),
      named('ddlb_op', 'Filter operator'),
      named('ddlb_data', 'Filter value'),
    ]),
    group('entry-filter-actions', ['cb_filter', 'cb_retrieve'].map((name) => element(`${listPath}.${name}`))),
  ])
  const findLabel = element(`${listPath}.st_find`)
  findLabel.id = `${identity}-find-label`
  const find = data(`${listPath}.dw_find`, 'form')
  find.classList.add('entry-find')
  const help = element(`${listPath}.st_1`)
  help.id = `${identity}-find-help`
  find.setAttribute('aria-describedby', help.id)
  const search = group('entry-search', [findLabel, help, find, element(`${listPath}.st_2`)])
  const decoration = element(`${listPath}.r_1`)
  decoration.classList.add('entry-decoration')
  decoration.setAttribute('aria-hidden', 'true')
  pages[0].replaceChildren(group('entry-detail', [
    ...surface.details.map((binding) => data(`${detailPath}.${binding.control}`, binding.kind)),
  ]))
  // Approved design: every entry window's data is laid out as cards (header form, line grids, footer form); see transactionLayout.
  if (surface.details.some((binding) => binding.kind === 'form' || binding.kind === 'grid')) {
    const detail = pages[0].firstElementChild as HTMLElement
    detail.classList.add('ds-transaction')
    detail.dataset.win = view.w.name.toLowerCase()
  }
  pages[1].replaceChildren(group('entry-list', [
    group('entry-criteria', [sort, filter]), search, data(`${listPath}.dw_list`, 'grid'), decoration,
  ]))
  // Controls the standard layout has no slot for (a window with extra criteria or lookup controls on a page) are never dropped:
  // they are kept in source position order, on the source row they share, in their own page group.
  const extras = [...controls].filter(([path, control]) => {
    const binding = view.ctlViews.get(control)
    return !!binding && !view.client.contains(binding.el) && (path.startsWith(`${listPath}.`) || path.startsWith(`${detailPath}.`))
  })
  // On the List page, extras that sit above the list grid in the source (an invoice-number search on the Find row) are placed before
  // the grid, the rest after it, so the vertical order of the page is kept.
  const listTop = Number(controls.get(`${listPath}.dw_list`)?.props.get('y'))
  const listGrid = element(`${listPath}.dw_list`)
  for (const page of [listPath, detailPath]) {
    const group = (page === listPath ? pages[1] : pages[0]).firstElementChild as HTMLElement | null
    const own = extras.filter(([path]) => path.startsWith(`${page}.`))
    if (!group || !own.length) continue
    const box = (path: string, control: PBObject) => {
      // PowerBuilder stores no x or y of 0
      const at = (key: string) => { const value = control.props.get(key); return value === undefined || value === null || value === '' ? 0 : Number(value) }
      const x = at('x'), y = at('y')
      const width = Number(control.props.get('width')), height = Number(control.props.get('height'))
      return [x, y, width, height].every(Number.isFinite) ? { key: path, left: x, top: y, right: x + width, bottom: y + Math.max(1, height) } : null
    }
    const above = page === listPath && Number.isFinite(listTop)
      ? own.filter(([path, control]) => { const b = box(path, control); return !!b && b.bottom <= listTop }) : []
    for (const [part, before] of [[above, true], [own.filter((entry) => !above.includes(entry)), false]] as const) {
      if (!part.length) continue
      const container = document.createElement('div')
      container.className = 'entry-extras'
      const cells = new Map<string, HTMLElement>()
      for (const [path, control] of part) {
        const el = view.ctlViews.get(control)!.el
        container.append(el)
        cells.set(path, el)
      }
      applyGrid(container, planGrid(part.flatMap(([path, control]) => { const b = box(path, control); return b ? [b] : [] })), cells)
      if (before && listGrid.parentElement === group) group.insertBefore(container, listGrid)
      else group.append(container)
    }
  }
  findView.useContextSurface(ENTRY_FIND_SURFACE, new Map([['find', findLabel]]))
  for (const binding of scoped) if (binding.view instanceof ModernDwView) binding.view.useContextSurface(binding.surface)
  tab.classList.add('entry-tabs')
  view.el.dataset.entryFamily = surface.family
  view.el.classList.add('modern-entry-window')
  return true
}
