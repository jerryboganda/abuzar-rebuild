/**
 * The source tab order of a reflowed (Modern) window.
 *
 * Classic expresses the TabOrder of each control as a positive tabindex.  A Modern window moves its controls into a new arrangement
 * and keeps every tab stop at tabindex 0, so the order is carried by `data-tab` (the source TabOrder, 9999 for none) and the Tab key
 * follows it: a control inside a container (a tab page, an embedded DataWindow) is ranked by its container's order first, as in
 * PowerBuilder, where Tab visits a container's controls when it reaches the container.  Tab and Shift+Tab wrap inside the window.
 */
const FOCUSABLE = 'input,textarea,select,button,a[href],[tabindex]'

function rank(element: HTMLElement, root: HTMLElement): number[] {
  const orders: number[] = []
  for (let at: HTMLElement | null = element; at && at !== root; at = at.parentElement) {
    const tab = at.dataset.tab
    if (tab) orders.unshift(Number(tab) || 9999)
  }
  return orders.length ? orders : [9999]
}

function compare(a: number[], b: number[]): number {
  for (let index = 0; index < Math.min(a.length, b.length); index++) if (a[index] !== b[index]) return a[index] - b[index]
  return a.length - b.length
}

/** The window's tab stops in source tab order (ties keep the document order). */
export function sourceTabStops(root: HTMLElement, selector = FOCUSABLE): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(selector)]
    .filter((element) => element.tabIndex >= 0 && !element.matches(':disabled') && !element.closest('[inert],[hidden]')
      && element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden')
    .map((element, index) => ({ element, index, rank: rank(element, root) }))
    .sort((a, b) => compare(a.rank, b.rank) || a.index - b.index)
    .map((entry) => entry.element)
}

/**
 * The tab stop after (`dir` 1) or before (-1) a control in the source order, outside the control itself, wrapping inside the
 * window: where Tab past the last field of a DataWindow (Shift+Tab before its first) goes. Null when nothing else takes Tab.
 */
export function sourceTabNeighbour(root: HTMLElement, control: HTMLElement, dir: number, skip: (stop: HTMLElement) => boolean = () => false): HTMLElement | null {
  const outside = sourceTabStops(root).filter((stop) => !control.contains(stop) && !skip(stop))
  if (!outside.length) return null
  // the control's place among the stops, ordered as sourceTabStops orders them: by rank, ties by document position
  const own = rank(control, root)
  const after = outside.findIndex((stop) => {
    const order = compare(rank(stop, root), own)
    return order > 0 || order === 0 && !!(control.compareDocumentPosition(stop) & Node.DOCUMENT_POSITION_FOLLOWING)
  })
  if (dir > 0) return outside[after < 0 ? 0 : after]
  return outside[((after < 0 ? outside.length : after) - 1 + outside.length) % outside.length]
}

/** Record each control's source TabOrder, flatten positive tabindex values to 0, and let Tab follow the source order. */
export function useSourceTabOrder(view: HTMLElement, client: HTMLElement, controls: Iterable<{ element: HTMLElement; taborder: unknown }>): void {
  for (const { element, taborder } of controls) {
    if (!element.dataset.tab) element.dataset.tab = String(Number(taborder) > 0 ? Number(taborder) : 9999)
  }
  for (const element of client.querySelectorAll<HTMLElement>(FOCUSABLE)) {
    if (element.tabIndex <= 0) continue
    if (!element.dataset.tab) element.dataset.tab = String(element.tabIndex)
    element.tabIndex = 0
  }
  view.addEventListener('keydown', (event) => {
    if (event.defaultPrevented || event.key !== 'Tab' || event.altKey || event.ctrlKey || event.metaKey) return
    const focus = document.activeElement
    if (!(focus instanceof HTMLElement) || !client.contains(focus)) return
    const stops = sourceTabStops(client)
    if (!stops.length) return
    let at = stops.indexOf(focus)
    if (at < 0) at = stops.findIndex((stop) => stop.contains(focus))
    event.preventDefault()
    const next = at < 0 ? (event.shiftKey ? stops.length - 1 : 0) : (at + (event.shiftKey ? -1 : 1) + stops.length) % stops.length
    stops[next].focus()
  })
}
