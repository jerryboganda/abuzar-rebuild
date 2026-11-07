import type { PBObject } from '../runtime/object.ts'
import type { WinView } from './dom-ui.ts'
import { ModernDwView } from './modern-dwview.ts'
import { ENTRY_WINDOW_SURFACES, entryWindowIssues } from './window-surfaces.ts'
import type { DataSurface } from './data-surfaces.ts'

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

/** Reflow reviewed entry controls without replacing their runtime objects or events. */
export function applyModernEntryWindow(view: WinView): boolean {
  const surface = ENTRY_WINDOW_SURFACES.find((item) => item.name === view.w.className)
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
    for (const target of [binding.el, ...binding.el.querySelectorAll<HTMLElement>('[tabindex]')]) {
      if (target.tabIndex > 0) target.tabIndex = 0
    }
  }
  const group = (className: string, children: HTMLElement[]) => {
    const section = document.createElement('div')
    section.className = className
    section.append(...children)
    return section
  }
  const data = (path: string, kind: 'form' | 'grid' | 'auxiliary') => {
    const host = element(path)
    host.classList.add('entry-data', `entry-${kind}`)
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
  pages[1].replaceChildren(group('entry-list', [
    group('entry-criteria', [sort, filter]), search, data(`${listPath}.dw_list`, 'grid'), decoration,
  ]))
  findView.useContextSurface(ENTRY_FIND_SURFACE, new Map([['find', findLabel]]))
  for (const binding of scoped) if (binding.view instanceof ModernDwView) binding.view.useContextSurface(binding.surface)
  tab.classList.add('entry-tabs')
  view.el.dataset.entryFamily = surface.family
  view.el.classList.add('modern-entry-window')
  return true
}
