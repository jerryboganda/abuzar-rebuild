import type { WinView } from './dom-ui.ts'
import { windowSurfaceIssues } from './window-surfaces.ts'
import { modalWindowSurfaceByName } from './window-registry.ts'
import { ModernDwView } from './modern-dwview.ts'
import { planGrid, applyGrid, anchoredBox } from './grid-plan.ts'
import type { GridBox } from './grid-plan.ts'

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
  for (const element of elements.values()) if (element.tabIndex > 0) element.tabIndex = 0
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
  if (surface.frame) {
    const { frame, legend } = sourceFrame(surface.frame)
    content.setAttribute('role', 'group')
    content.setAttribute('aria-labelledby', legend.id)
    // A source groupbox is a caption/frame, not a visibility container.
    content.append(frame)
  }
  for (const name of surface.frames ?? []) {
    const { frame } = sourceFrame(name)
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
    const label = document.createElement('label')
    label.htmlFor = input.id
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
    content.append(element)
    contentItems.set(name, element)
    itemControls.set(name, [name])
  }
  for (const option of surface.options ?? []) {
    const element = elements.get(option.control)!
    const input = element.querySelector('input')!
    // Missing source ordering is not an explicit exclusion from Modern keyboard navigation.
    if (input.tabIndex > 0 || !view.w.children.get(option.control)!.props.has('taborder')) input.tabIndex = 0
    element.classList.add('window-option')
    content.append(element)
    contentItems.set(option.control, element)
    itemControls.set(option.control, [option.control])
  }
  for (const name of surface.contentOrder ?? []) content.append(contentItems.get(name)!)
  arrangeGrid(view, content, contentItems, itemControls)
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
    button.onclick = () => { void view.ui.rt.closeWindow(view.w).catch((error) => view.ui.rt.onError(error)) }
    close.replaceWith(button)
  }
  return true
}

/**
 * Structural parity with the Classic dialog: the content is placed on a CSS grid derived from the source positions of its controls
 * (controls that share a row share it, a tall list beside stacked fields spans them, columns follow the source widths).  The DOM
 * order, and so the tab order, is untouched.  A window whose controls carry no usable geometry keeps the single-column flow.
 */
function arrangeGrid(view: WinView, content: HTMLElement, items: Map<string, HTMLElement>, controls: Map<string, string[]>): void {
  const read = (name: string) => {
    const control = view.w.children?.get(name)
    if (!control?.props || control.props.get('visible') === false) return null
    const box = { x: Number(control.props.get('x')), y: Number(control.props.get('y')), width: Number(control.props.get('width')), height: Number(control.props.get('height')) }
    // A drop-down's stored height includes its open list; it occupies one line when closed, as Classic paints it.
    if (/dropdown|combobox/.test(String(control.native ?? ''))) box.height = Math.min(box.height, 80)
    return Object.values(box).every(Number.isFinite) ? box : null
  }
  const boxes: GridBox[] = []
  for (const [key, names] of controls) {
    if (!items.has(key)) continue
    const asBox = (name: string): GridBox | null => {
      const part = read(name)
      return part ? { key: name, left: part.x, top: part.y, right: part.x + part.width, bottom: part.y + Math.max(1, part.height) } : null
    }
    const editor = asBox(names[0])
    if (!editor) continue
    boxes.push(anchoredBox(key, editor, names.slice(1).flatMap((name) => { const box = asBox(name); return box ? [box] : [] })))
  }
  if (boxes.length < 2) return
  // Anything the plan does not place (the window frame and its legend, groupbox captions) stays full width above the plan.
  const placed = new Set(boxes.map((box) => items.get(box.key)))
  const unplaced = ([...content.children] as HTMLElement[]).filter((child) => !placed.has(child))
  unplaced.forEach((child, index) => { child.style.gridColumn = '1 / -1'; child.style.gridRow = String(index + 1) })
  applyGrid(content, planGrid(boxes), items, unplaced.length)
}
