import type { WinView } from './dom-ui.ts'
import { WINDOW_SURFACES, CALCULATOR_WINDOW_SURFACES, CALENDAR_WINDOW_SURFACES, CRITERIA_WINDOW_SURFACES, windowSurfaceIssues } from './window-surfaces.ts'
import { ModernDwView } from './modern-dwview.ts'

let nextWindow = 0

/** Reflow the existing controls; their runtime objects and event bindings stay intact. */
export function applyModernWindow(view: WinView): boolean {
  const surface = [...WINDOW_SURFACES, ...CALCULATOR_WINDOW_SURFACES, ...CALENDAR_WINDOW_SURFACES, ...CRITERIA_WINDOW_SURFACES]
    .find((item) => item.name === view.w.className)
  if (!surface || !view.modal) return false
  const controls = [...view.ctlViews].map(([control]) => ({
    name: control.name, native: control.native, children: control.children.size,
  }))
  const issues = windowSurfaceIssues(controls, surface)
  const data = (surface.data ?? []).map((binding) => ({
    ...binding, view: [...view.ctlViews].find(([control]) => control.name === binding.control)?.[1],
  }))
  for (const binding of data) {
    if (!(binding.view?.dw instanceof ModernDwView)) issues.push(`Missing data presentation: ${binding.control}`)
  }
  if (issues.length) {
    console.warn(`Classic window layout retained for ${surface.name}: ${issues.join('; ')}`)
    return false
  }
  const elements = new Map([...view.ctlViews].map(([control, binding]) => [control.name, binding.el]))
  for (const element of elements.values()) if (element.tabIndex > 0) element.tabIndex = 0
  const identity = `modern-window-${++nextWindow}`
  const content = document.createElement('div')
  content.className = 'window-fields'
  const contentItems = new Map<string, HTMLElement>()
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
  }
  for (const list of surface.lists ?? []) {
    const input = elements.get(list.control)!
    const { frame, legend } = sourceFrame(list.caption)
    input.id = `${identity}-${list.control}`
    input.setAttribute('aria-labelledby', legend.id)
    const group = document.createElement('div')
    group.className = 'window-list'
    group.append(frame, input)
    content.append(group)
    contentItems.set(list.control, group)
  }
  for (const field of surface.fields) {
    const input = elements.get(field.control)!
    const text = elements.get(field.label)!
    input.id = `${identity}-${field.control}`
    text.id = `${identity}-${field.label}`
    input.setAttribute('aria-labelledby', text.id)
    const label = document.createElement('label')
    label.htmlFor = input.id
    label.append(text)
    const group = document.createElement('div')
    group.className = 'window-field'
    group.append(label, input)
    content.append(group)
    contentItems.set(field.control, group)
  }
  for (const name of surface.captions ?? []) {
    const element = elements.get(name)!
    element.classList.add('window-caption')
    content.append(element)
    contentItems.set(name, element)
  }
  for (const name of surface.calendars ?? []) {
    const binding = [...view.ctlViews].find(([control]) => control.name === name)![1]
    binding.calendar!.setModern(true)
    content.append(binding.el)
    contentItems.set(name, binding.el)
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
    }
  }
  for (const option of surface.options ?? []) {
    const element = elements.get(option.control)!
    const input = element.querySelector('input')!
    // Missing source ordering is not an explicit exclusion from Modern keyboard navigation.
    if (input.tabIndex > 0 || !view.w.children.get(option.control)!.props.has('taborder')) input.tabIndex = 0
    element.classList.add('window-option')
    content.append(element)
    contentItems.set(option.control, element)
  }
  for (const name of surface.contentOrder ?? []) content.append(contentItems.get(name)!)
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
