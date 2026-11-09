import type { PBObject } from '../runtime/object.ts'
import { NControl } from '../runtime/native/controls.ts'
import { toNum } from '../runtime/values.ts'

export function visibleTabPages(control: PBObject): PBObject[] {
  return [...control.children.values()].filter((page) => !page.destroyed && page.props.get('visible') !== false)
}

export function tabAvailable(control: PBObject): boolean {
  for (let item: PBObject | null = control; item; item = item.parent) {
    if (item.destroyed || item.props.get('enabled') === false || item.props.get('visible') === false) return false
  }
  return true
}

/** User transitions must wait for the original unsaved-change guard before hiding a page. */
export class TabSelection {
  busy = false
  /**
   * The page being switched to while its SelectionChanged scripts (and what they post) run. PowerBuilder processes the next
   * input only after those scripts return, so the shown page takes no input until then (a fast click and typed text would
   * otherwise run their scripts interleaved with, and be undone by, the page's own initialisation).
   */
  switching: PBObject | null = null
  private control: PBObject
  private refresh: () => void
  private beforeChange: (page: PBObject | undefined) => Promise<boolean>

  constructor(control: PBObject, refresh: () => void, beforeChange: (page: PBObject | undefined) => Promise<boolean> = async () => true) {
    this.control = control
    this.refresh = refresh
    this.beforeChange = beforeChange
  }

  async select(page: PBObject): Promise<boolean> {
    const control = this.control
    const pages = visibleTabPages(control)
    const next = pages.indexOf(page) + 1
    const old = toNum(control.props.get('selectedtab') ?? 1)
    if (this.busy || next < 1 || !tabAvailable(control) || !tabAvailable(page)) return false
    if (next === old) return true
    this.busy = true
    this.refresh()
    const current = () => {
      const currentPages = visibleTabPages(control)
      return tabAvailable(control) && tabAvailable(page) &&
        toNum(control.props.get('selectedtab') ?? 1) === old &&
        currentPages.length === pages.length && currentPages.every((item, index) => item === pages[index])
    }
    try {
      if (!(await this.beforeChange(pages[old - 1])) || !current()) return false
      const result = await control.rt.fire(control, 'selectionchanging', [old, next])
      if (toNum(result) === 1 || !current()) return false
      // Do not call pbSet: it dispatches a second, non-awaited pair of tab events.
      this.switching = page
      control.props.set('selectedtab', next)
      if (control instanceof NControl) control.changed()
      this.refresh()
      await control.rt.fire(control, 'selectionchanged', [old, next])
      await control.rt.flushPosted()
      return true
    } finally {
      this.busy = false
      this.switching = null
      this.refresh()
    }
  }
}
