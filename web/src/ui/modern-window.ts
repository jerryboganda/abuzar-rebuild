import type { WinView } from './dom-ui.ts'
import { windowSurfaceIssues, windowContentItems } from './window-surfaces.ts'
import { modalWindowSurfaceByName } from './window-registry.ts'
import { ModernDwView } from './modern-dwview.ts'
import { planGrid, applyGrid, anchoredBox, resolveAnchors } from './grid-plan.ts'
import type { GridBox } from './grid-plan.ts'
import { useSourceTabOrder } from './source-tab-order.ts'

let nextWindow = 0

/** Reflow the existing controls; their runtime objects and event bindings stay intact. */
export function applyModernWindow(view: WinView): boolean {
  const surface = modalWindowSurfaceByName(view.w.className)
  if (!surface || !(view.modal || surface.sheet && view.sheet)) return false
  // Only the window's own controls are mapped; children of an embedded container stay inside it.
  const controls = [...view.ctlViews].filter(([control]) => control.parent === view.w).map(([control]) => ({
    name: control.name, native: control.native, children: control.children.size,
  }))
  const issues = windowSurfaceIssues(controls, surface)
  const data = (surface.data ?? []).map((binding) => ({
    ...binding, view: [...view.ctlViews].find(([control]) => control.parent === view.w && control.name === binding.control)?.[1],
  }))
  for (const binding of data) {
    if (!(binding.view?.dw instanceof ModernDwView)) issues.push(`Missing data presentation: ${binding.control}`)
  }
  if (issues.length) {
    console.warn(`Classic window layout retained for ${surface.name}: ${issues.join('; ')}`)
    return false
  }
  const elements = new Map([...view.ctlViews].filter(([control]) => control.parent === view.w).map(([control, binding]) => [control.name, binding.el]))
  const identity = `modern-window-${++nextWindow}`
  const content = document.createElement('div')
  content.className = 'window-fields'
  const contentItems = new Map<string, HTMLElement>()
  // The source controls behind each content item, so the arrangement can follow their positions.
  const itemControls = new Map<string, string[]>()
  const sourceFrame = (name: string) => {
    const frame = elements.get(name)!
    frame.classList.add('window-frame')
    frame.setAttribute('role', 'presentation')
    const legend = frame.querySelector('legend')!
    legend.id = `${identity}-${name}`
    return { frame, legend }
  }
  // A groupbox with recorded members keeps its caption with exactly the content it encloses in the source (a positioned group of its
  // own); the main frame labels the whole content only when it encloses all of it, or when its members are not recorded.
  const members = surface.members ?? {}
  const holds = (frame: string): Set<string> => {
    const held = new Set<string>()
    const walk = (name: string) => { for (const member of members[name] ?? []) { held.add(member); walk(member) } }
    walk(frame)
    return held
  }
  const mainHoldsAll = !!surface.frame && windowContentItems(surface).every((item) => holds(surface.frame!).has(item))
  const containers = new Set([
    ...(surface.frame && members[surface.frame]?.length && !mainHoldsAll ? [surface.frame] : []),
    ...(surface.frames ?? []).filter((name) => members[name]?.length),
  ])
  if (surface.frame && containers.has(surface.frame)) sourceFrame(surface.frame)
  else if (surface.frame) {
    const { frame, legend } = sourceFrame(surface.frame)
    content.setAttribute('role', 'group')
    content.setAttribute('aria-labelledby', legend.id)
    // A source groupbox is a caption/frame, not a visibility container.
    content.append(frame)
  }
  for (const name of surface.frames ?? []) {
    const { frame } = sourceFrame(name)
    // A groupbox with recorded members is drawn over the area it encloses (see below); one without stays a caption above the plan.
    if (containers.has(name)) continue
    content.append(frame)
    contentItems.set(name, frame)
    // A groupbox frame encloses its fields: it is a container, not a peer on their rows, so it takes no part in the line plan.
  }
  for (const list of surface.lists ?? []) {
    const input = elements.get(list.control)!
    input.id = `${identity}-${list.control}`
    const group = document.createElement('div')
    group.className = 'window-list'
    if (list.caption) {
      const { frame, legend } = sourceFrame(list.caption)
      input.setAttribute('aria-labelledby', legend.id)
      group.append(frame, input)
    } else if (list.name) {
      input.setAttribute('aria-label', list.name)
      group.append(input)
    } else {
      const text = elements.get(list.label!)!
      text.id = `${identity}-${list.label}`
      text.classList.add('window-caption')
      input.setAttribute('aria-labelledby', text.id)
      group.append(text, input)
    }
    content.append(group)
    contentItems.set(list.control, group)
    itemControls.set(list.control, [list.control, ...(list.caption ? [list.caption] : list.label ? [list.label] : [])])
  }
  for (const field of surface.fields) {
    const input = elements.get(field.control)!
    const text = field.label ? elements.get(field.label)! : Object.assign(document.createElement('span'), {
      className: 'presentation-visually-hidden', textContent: field.name,
    })
    input.id = `${identity}-${field.control}`
    text.id = `${identity}-${field.label ?? field.control + '-name'}`
    input.setAttribute('aria-labelledby', text.id)
    // The caption names the field (aria-labelledby) but is not bound to it: clicking a caption does not move the focus (and so fires
    // no GetFocus), as in Classic.
    const label = document.createElement('label')
    label.append(text)
    const group = document.createElement('div')
    group.className = 'window-field'
    group.append(label, input)
    content.append(group)
    contentItems.set(field.control, group)
    itemControls.set(field.control, [field.control, ...(field.label ? [field.label] : [])])
  }
  for (const name of surface.captions ?? []) {
    const element = elements.get(name)!
    element.classList.add('window-caption')
    content.append(element)
    contentItems.set(name, element)
    itemControls.set(name, [name])
  }
  for (const name of surface.calendars ?? []) {
    const binding = [...view.ctlViews].find(([control]) => control.parent === view.w && control.name === name)![1]
    binding.calendar!.setModern(true)
    content.append(binding.el)
    contentItems.set(name, binding.el)
    itemControls.set(name, [name])
    view.el.classList.add('modern-calendar-window')
  }
  for (const binding of data) {
    if (binding.view?.dw instanceof ModernDwView) {
      binding.view.el.classList.add('window-data')
      binding.view.el.dataset.windowData = binding.control
      const labels = new Map((binding.labels ?? []).map((label) => {
        const element = elements.get(label.control)!
        element.id = `${identity}-${label.control}`
        return [label.field, element] as const
      }))
      binding.view.dw.useContextSurface(binding.surface, labels)
      content.append(binding.view.el)
      contentItems.set(binding.control, binding.view.el)
      itemControls.set(binding.control, [binding.control, ...(binding.labels ?? []).map((label) => label.control)])
    }
  }
  for (const name of surface.embedded ?? []) {
    const element = elements.get(name)!
    element.classList.add('window-embedded')
    // A container keeps its own children and may be larger than the dialog: it scrolls, and as a scroll region it is focusable.
    const native = [...view.ctlViews].find(([control]) => control.parent === view.w && control.name === name)?.[0].native
    if (native && ['tab', 'userobject', 'olecustomcontrol', 'richtextedit', 'listview', 'datawindow'].includes(native)) {
      element.dataset.embeddedScroll = ''
      if (element.tabIndex < 0 && !element.querySelector('a[href],button,input,select,textarea,[tabindex]:not([tabindex="-1"])')) element.tabIndex = 0
    }
    content.append(element)
    contentItems.set(name, element)
    itemControls.set(name, [name])
  }
  for (const option of surface.options ?? []) {
    const element = elements.get(option.control)!
    // An option keeps its source tab stop: one without a TabOrder is not a tab stop, as in Classic.
    element.classList.add('window-option')
    content.append(element)
    contentItems.set(option.control, element)
    itemControls.set(option.control, [option.control])
  }
  // A command button the source places among the content (a "...." picker beside its option) and visible artwork (a photo, a colour
  // key, a progress bar) keep their source position in the content.
  for (const [names, className] of [[surface.buttons ?? [], 'window-button'], [surface.artwork ?? [], 'window-artwork']] as const) {
    for (const name of names) {
      const element = elements.get(name)!
      element.classList.add(className)
      // artwork keeps its source size (the reflow rules size other controls to their cell)
      if (className === 'window-artwork') {
        if (element.style.width) element.style.setProperty('--artwork-width', element.style.width)
        if (element.style.height) element.style.setProperty('--artwork-height', element.style.height)
      }
      content.append(element)
      contentItems.set(name, element)
      itemControls.set(name, [name])
    }
  }
  const flexible = new Set([...(surface.embedded ?? []), ...data.map((binding) => binding.control)])
  for (const name of surface.contentOrder ?? []) if (contentItems.has(name)) content.append(contentItems.get(name)!)
  // Every item is placed on the one grid by its source position, groupbox members included, so a field beside a groupbox keeps its
  // row (`em_dscode` beside the date box).  A groupbox with recorded members is drawn behind them over the area it encloses, with its
  // caption on its top band.  Its caption describes each member it encloses (aria-describedby): the members keep their place in the
  // accessibility tree even when a script hides the groupbox, as Classic paints them without it.
  const areas = new Map<string, HTMLElement>()
  for (const frame of containers) {
    const element = elements.get(frame)!
    element.classList.add('window-frame-area')
    element.dataset.windowFrame = frame
    element.setAttribute('aria-hidden', 'true')
    const legend = element.querySelector('legend')!
    const held = holds(frame)
    for (const name of held) {
      const item = contentItems.get(name)
      if (!item) continue
      item.dataset.windowFrameMember = [...(item.dataset.windowFrameMember ?? '').split(' ').filter(Boolean), frame].join(' ')
      for (const target of frameDescribed(item)) {
        const described = (target.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean)
        if (!described.includes(legend.id)) target.setAttribute('aria-describedby', [...described, legend.id].join(' '))
      }
    }
    const first = ([...content.children] as HTMLElement[]).find((child) => [...held].some((name) => contentItems.get(name) === child))
    content.insertBefore(element, first ?? null)
    areas.set(frame, element)
  }
  arrangeGrid(view, content, contentItems, itemControls, flexible, areas)
  const actions = document.createElement('footer')
  actions.className = 'window-actions'
  for (const name of surface.actions) actions.append(elements.get(name)!)
  const auxiliary = (surface.auxiliary ?? []).map((name) => {
    const element = elements.get(name)!
    element.classList.add('window-auxiliary')
    return element
  })
  view.client.replaceChildren(content, actions, ...auxiliary)
  view.el.classList.add('modern-window')
  view.el.classList.toggle('modern-data-window', data.length > 0)
  const close = view.el.querySelector('.tbar .cls')
  if (close) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'cls'
    button.textContent = '\u00d7'
    button.setAttribute('aria-label', 'Close window')
    // a mouse control, as the Classic title-bar cross: no extra tab stop, and Enter in the window never closes it
    button.tabIndex = -1
    button.onclick = () => { void view.ui.rt.closeWindow(view.w).catch((error) => view.ui.rt.onError(error)) }
    close.replaceWith(button)
  }
  useSourceTabOrder(view.el, view.client, [...view.ctlViews].map(([control, binding]) => ({ element: binding.el, taborder: control.props?.get('taborder') })))
  return true
}

/**
 * The elements a groupbox caption describes: a DataWindow host or embedded container itself (its content is repainted), otherwise the
 * item's controls.
 */
export function frameDescribed(item: HTMLElement): HTMLElement[] {
  if (item.matches('.window-data,.window-embedded')) return [item]
  // the item's tab stops (a drop-down's choice list and its pointer-only toggle are not)
  const focusable = 'input,select,textarea,button,[tabindex]'
  return [item, ...item.querySelectorAll<HTMLElement>(focusable)].filter((target) => target.matches(focusable) && target.tabIndex >= 0 &&
    !target.closest('.window-data,.window-embedded,[role=listbox]'))
}

/**
 * Structural parity with the Classic dialog: the content is placed on a CSS grid derived from the source positions of its controls
 * (controls that share a row share it, a tall list beside stacked fields spans them, columns follow the source widths).  The DOM
 * order, and so the tab order, is untouched.  A window whose controls carry no usable geometry keeps the single-column flow.
 */
function arrangeGrid(view: WinView, content: HTMLElement, items: ReadonlyMap<string, HTMLElement>, controls: ReadonlyMap<string, readonly string[]>,
  flexible: ReadonlySet<string>, frames: ReadonlyMap<string, HTMLElement> = new Map()): void {
  const read = (name: string) => {
    const control = view.w.children?.get(name)
    // A groupbox that holds positioned members keeps its source area even while its own caption is hidden: its members may be visible.
    if (!control?.props || control.props.get('visible') === false && !frames.has(name)) return null
    // PowerBuilder stores no x or y of 0 (the default), so a control at the window's left or top edge has none.
    const at = (key: string) => { const value = control.props.get(key); return value === undefined || value === null || value === '' ? 0 : Number(value) }
    const box = { x: at('x'), y: at('y'), width: Number(control.props.get('width')), height: Number(control.props.get('height')) }
    // A drop-down's stored height includes its open list; it occupies one line when closed, as Classic paints it.
    if (/dropdown|combobox/.test(String(control.native ?? ''))) box.height = Math.min(box.height, 80)
    return Object.values(box).every(Number.isFinite) ? box : null
  }
  const anchors: { editor: GridBox; anchored: GridBox }[] = []
  for (const [key, names] of controls) {
    if (!items.has(key)) continue
    const asBox = (name: string): GridBox | null => {
      const part = read(name)
      return part ? { key: name, left: part.x, top: part.y, right: part.x + part.width, bottom: part.y + Math.max(1, part.height) } : null
    }
    const editor = asBox(names[0])
    if (!editor) continue
    // Embedded containers and DataWindows size themselves; they add no minimum row height.
    const flex = flexible.has(key) ? { flex: true } : {}
    anchors.push({ editor: { ...editor, key, ...flex }, anchored: { ...anchoredBox(key, editor, names.slice(1).flatMap((name) => { const box = asBox(name); return box ? [box] : [] })), ...flex } })
  }
  const boxes = resolveAnchors(anchors)
  // A groupbox area is planned with its members (its edges become grid lines, its top band a row for the caption) but is not an
  // editor: it never takes a caption's place, and it overlaps the members it encloses.
  const areas = new Map<string, HTMLElement>()
  for (const [name, element] of frames) {
    const part = read(name)
    if (!part) continue
    boxes.push({ key: name, left: part.x, top: part.y, right: part.x + part.width, bottom: part.y + Math.max(1, part.height), flex: true })
    areas.set(name, element)
  }
  // One placed item has nothing to be arranged against; a groupbox around it does (a selection list inside its box).
  if (boxes.length < 2) return
  // Anything the plan does not place (the window frame and its legend, groupbox captions) stays full width above the plan.
  const placed = new Set([...boxes.map((box) => items.get(box.key)), ...areas.values()])
  const unplaced = ([...content.children] as HTMLElement[]).filter((child) => !placed.has(child))
  unplaced.forEach((child, index) => { child.style.gridColumn = '1 / -1'; child.style.gridRow = String(index + 1) })
  applyGrid(content, planGrid(boxes), new Map([...items, ...areas]), unplaced.length)
}
