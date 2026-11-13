// DOM implementation of the UiHost: windows, MDI frame, menus, controls, message boxes.
import { toolbarItems, iconPos } from './toolbar.ts'
import type { Runtime, UiHost } from '../runtime/interp.ts'
import { PBObject } from '../runtime/object.ts'
import type { PBStruct } from '../runtime/object.ts'
import { NControl, NWindow } from '../runtime/native/controls.ts'
import { NDwBase } from '../runtime/native/dwctrl.ts'
import { PBArray, toNum, toStr } from '../runtime/values.ts'
import { cssFont, fontSize, mnemonicKey, pbColor, toPx, setMnemonic } from './pb.ts'
import { DwView } from './dwview.ts'
import { printDw, printPlainText } from './print.ts'
import { exportDw } from '../dw/export.ts'
import { writeFileBytes } from '../runtime/sysfiles.ts'
import { CSS } from './styles.ts'
import { keyEnum, keyFlags, shortcutCode } from './keys.ts'
import { messageButtons } from './message-buttons.ts'
import { TabSelection, tabAvailable } from './tab-selection.ts'
import { DropdownView } from './dropdown.ts'
import { NCalendar } from '../runtime/native/calendar.ts'
import { NGraph } from '../runtime/native/graph.ts'
import { renderChartSvg } from '../dw/chart.ts'
import { CalendarView } from './calendar.ts'
import { sourceTabNeighbour, sourceTabStops } from './source-tab-order.ts'

let nextTabControl = 0
let nextRadioGroup = 0

const num = (o: PBObject, k: string, d = 0): number => {
  const v = o.props.get(k)
  return typeof v === 'number' ? v : d
}
const bool = (o: PBObject, k: string, d = true): boolean => {
  const v = o.props.get(k)
  return typeof v === 'boolean' ? v : d
}
const str = (o: PBObject, k: string): string => toStr(o.props.get(k))

// the Alignment of a window control as the object file stores it: 0 left, 1 center, 2 right, 3 justify (the About window of the original shows its `alignment: 1` lines centered)
const ALIGN = ['left', 'center', 'right', 'justify']

function fontOf(o: PBObject): string {
  return cssFont({ face: str(o, 'facename') || 'Arial', size: fontSize(num(o, 'textsize', -9)), weight: num(o, 'weight', 400), italic: bool(o, 'italic', false), underline: false, strike: false })
}

/** caption with & accelerator markers */
function caption(t: string): string {
  return t.replace(/&&/g, '\u0001').replace(/&/g, '').replace(/\u0001/g, '&')
}

/** Ctrl chords that belong to the browser, not to the PowerBuilder application. */
const BROWSER_KEYS = new Set(['b', 'd', 'f', 'g', 'h', 'j', 'l', 'm', 'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'w'])

/** Tauri shell: the native window owns the title bar; push the app title there. */
function setNativeTitle(title: string): void {
  const invoke = (globalThis as { __TAURI_INTERNALS__?: { invoke?: (cmd: string, args: unknown) => Promise<unknown> } }).__TAURI_INTERNALS__?.invoke
  if (typeof invoke !== 'function') return
  try {
    void invoke('plugin:window|set_title', { label: 'main', value: title })
  } catch {
    // not the desktop shell
  }
}

export class DomUi implements UiHost {
  rt: Runtime
  desktop: HTMLElement
  views = new Map<PBObject, WinView>()
  mdi: WinView | null = null
  zTop = 10
  private lifetime = new AbortController()
  private style: HTMLStyleElement

  constructor(rt: Runtime, desktop: HTMLElement) {
    this.rt = rt
    this.desktop = desktop
    const st = document.createElement('style')
    this.style = st
    st.textContent = CSS
    document.head.appendChild(st)
    document.addEventListener('keydown', (e) => {
      const fkey = e.keyCode >= 112 && e.keyCode <= 123
      // The original is a desktop window: browser reload/close/new-tab/back-forward
      // defaults must never fire while an operator is entering a transaction.
      const ctrl = e.ctrlKey && !e.altKey && !e.metaKey
      if (fkey || ctrl && BROWSER_KEYS.has(e.key.toLowerCase()) ||
        e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) e.preventDefault()
      if (!this.shortcutsEnabled()) return
      const k = keyEnum(e)
      if (k) this.down.add(k)
      // PowerBuilder access keys: Alt+letter on a dialog button, a menu caption or a menu bar caption.
      if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && /^[a-z0-9]$/i.test(e.key) && this.activateMnemonic(e.key)) {
        e.preventDefault()
        return
      }
      // An open menu is keyboard-navigable (arrows, Home/End, Enter, Escape, letter mnemonics).
      if (this.navigateMenu(e)) {
        e.preventDefault()
        return
      }
      // accelerators of the menu of the active sheet: `shortcut` = virtual key + 256 (Ctrl) + 512 (Alt) + 1024 (Shift)
      if (this.menuShortcutsEnabled() && (e.ctrlKey || e.altKey || fkey || e.keyCode === 45 || e.keyCode === 46) && !(e.ctrlKey && e.altKey && e.key === 'AltGraph')) {
        if (this.mdi?.fireShortcut(shortcutCode(e))) e.preventDefault()
      }
    }, { signal: this.lifetime.signal })
    document.addEventListener('keyup', (e) => {
      const k = keyEnum(e)
      if (k) this.down.delete(k)
    }, { signal: this.lifetime.signal })
    window.addEventListener('blur', () => this.down.clear(), { signal: this.lifetime.signal })
    // A PowerBuilder response window disables every window opened before it (the frame, its menu and the sheets):
    // presses there are ignored and the keyboard stays in the response window. Releases still pass, so a drag of
    // the response window itself that ends outside it completes normally.
    for (const type of ['pointerdown', 'mousedown', 'click', 'auxclick', 'dblclick', 'contextmenu']) {
      document.addEventListener(type, (event) => {
        if (!this.blockedByResponseWindow(event.target)) return
        event.preventDefault()
        event.stopImmediatePropagation()
      }, { capture: true, signal: this.lifetime.signal })
    }
  }

  /** The open response window that disables the window under `target`, if any (only in the native presentation). */
  protected blockedByResponseWindow(target: EventTarget | null): boolean {
    if (!(target instanceof Node) || !this.responseWindowsBlockPointer()) return false
    const views = [...this.views.values()]
    let top = -1
    views.forEach((view, index) => {
      if (view.modal && !view.sheet && view.w.isOpen && view.el.isConnected && !view.el.classList.contains('hidden')) top = index
    })
    if (top < 0 || views[top].el.contains(target)) return false
    // Windows opened after the response window (its own popups and later response windows) remain usable.
    return views.slice(0, top).some((view) => view.el.contains(target)) &&
      !views.slice(top + 1).some((view) => view.el.contains(target))
  }

  protected responseWindowsBlockPointer(): boolean { return true }
  /** The colour a control's text is drawn with: its source colour in the native presentation. */
  controlTextColor(source: string, _el: HTMLElement): string { return source }
  protected shortcutsEnabled(): boolean { return true }
  /** PowerBuilder response windows and message boxes are application-modal: the frame's accelerators wait until they close. */
  protected menuShortcutsEnabled(): boolean {
    return ![...this.views.values()].some((view) => view.modal && !view.sheet && view.w.isOpen) && !this.desktop.querySelector('.msgbox')
  }
  /** Alt+letter: dialog buttons first, then the open menu, the active window, and finally the menu bar. */
  private activateMnemonic(raw: string): boolean {
    const letter = raw.toLowerCase()
    const visible = (el: HTMLElement): boolean => el.getClientRects().length > 0 && !el.classList.contains('hidden')
    for (const box of document.querySelectorAll<HTMLElement>('.msgbox')) {
      const button = [...box.querySelectorAll<HTMLButtonElement>('button')].find((b) => visible(b) && !b.disabled && b.dataset.mnemonic === letter)
      if (button) { button.click(); return true }
    }
    const open = document.querySelector<HTMLElement>('.menubar .mi.open')
    if (open) {
      const item = this.menuItems(open).find((it) => it.dataset.mnemonic === letter)
      if (item) { this.invokeMenuItem(item); return true }
    }
    const control = (win: HTMLElement): HTMLElement | null => {
      const button = [...win.querySelectorAll<HTMLButtonElement>('button')].find((b) => visible(b) && !b.disabled && b.dataset.mnemonic === letter)
      if (button) return button
      const label = [...win.querySelectorAll<HTMLElement>('label[data-mnemonic]')].find((l) => visible(l) && l.dataset.mnemonic === letter)
      const input = label?.querySelector<HTMLInputElement>('input')
      if (input && visible(input) && !input.disabled) return input
      const tab = [...win.querySelectorAll<HTMLElement>('.tabctl .t[data-mnemonic]')].find((t) => visible(t) && t.dataset.mnemonic === letter)
      return tab ?? null
    }
    const windows = [...document.querySelectorAll<HTMLElement>('.pbwin')].filter((w) => w.classList.contains('active') && visible(w))
    for (const win of windows.reverse()) {
      const target = control(win)
      if (target) { target.click(); return true }
    }
    const bar = document.querySelector<HTMLElement>('.menubar .mi[data-mnemonic="' + letter + '"]')
    if (bar && visible(bar)) { bar.click(); return true }
    for (const win of [...document.querySelectorAll<HTMLElement>('.pbwin')].reverse()) {
      if (!visible(win)) continue
      const target = control(win)
      if (target) { target.click(); return true }
    }
    return false
  }

  menuItems(top: HTMLElement): HTMLElement[] {
    const drops = [...top.querySelectorAll<HTMLElement>('.menu-drop')].filter((drop) => drop.getClientRects().length > 0)
    const drop = drops.at(-1) ?? top.querySelector<HTMLElement>(':scope > .menu-drop')
    if (!drop) return []
    return [...drop.children].filter((child): child is HTMLElement =>
      child instanceof HTMLElement && child.classList.contains('it') && !child.classList.contains('dis') && child.getClientRects().length > 0)
  }

  highlightMenuItem(item: HTMLElement): void {
    document.querySelectorAll('.menu-drop .it.hl').forEach((el) => el.classList.remove('hl'))
    item.classList.add('hl')
  }

  private invokeMenuItem(item: HTMLElement): void {
    const sub = item.querySelector<HTMLElement>(':scope > .menu-drop.sub')
    if (sub) {
      item.classList.add('sub-open')
      const first = [...sub.children].find((child): child is HTMLElement =>
        child instanceof HTMLElement && child.classList.contains('it') && !child.classList.contains('dis') && child.getClientRects().length > 0)
      if (first) this.highlightMenuItem(first)
      return
    }
    item.click()
  }

  private closeMenus(): void {
    document.querySelectorAll('.menubar .mi.open').forEach((el) => el.classList.remove('open'))
    document.querySelectorAll('.menubar .menu-drop').forEach((el) => el.remove())
  }

  /** Keyboard navigation of an open menu: the original PowerBuilder menu bar/drop-downs are fully keyboard driven. */
  private navigateMenu(e: KeyboardEvent): boolean {
    const top = document.querySelector<HTMLElement>('.menubar .mi.open')
    if (!top) return false
    if (e.ctrlKey || e.altKey || e.metaKey) return false
    const drops = [...document.querySelectorAll<HTMLElement>('.menubar .menu-drop')].filter((drop) => drop.getClientRects().length > 0)
    const drop = drops.at(-1)
    if (!drop) return false
    const items = this.menuItems(top)
    if (!items.length) return false
    const current = drop.querySelector<HTMLElement>(':scope > .it.hl') ?? items[0]
    if (!current.classList.contains('hl')) this.highlightMenuItem(current)
    const index = Math.max(0, items.indexOf(current))
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const next = e.key === 'ArrowDown' ? Math.min(items.length - 1, index + 1) : Math.max(0, index - 1)
      this.highlightMenuItem(items[next])
      return true
    }
    if (e.key === 'Home' || e.key === 'End') {
      this.highlightMenuItem(e.key === 'Home' ? items[0] : items[items.length - 1])
      return true
    }
    if (e.key === 'ArrowRight') {
      const sub = current.querySelector<HTMLElement>(':scope > .menu-drop.sub')
      if (sub) {
        this.invokeMenuItem(current)
        return true
      }
      const bars = [...document.querySelectorAll<HTMLElement>('.menubar .mi')]
      const at = bars.findIndex((bar) => bar.classList.contains('open'))
      if (at >= 0) { this.closeMenus(); bars[(at + 1) % bars.length].click() }
      return true
    }
    if (e.key === 'ArrowLeft') {
      if (drop.classList.contains('sub')) {
        const parent = drop.parentElement
        drop.parentElement?.classList.remove('sub-open')
        if (parent instanceof HTMLElement) this.highlightMenuItem(parent)
      } else {
        this.closeMenus()
      }
      return true
    }
    if (e.key === 'Escape') {
      this.closeMenus()
      return true
    }
    if (e.key === 'Enter' || e.key === ' ') {
      this.invokeMenuItem(current)
      return true
    }
    if (e.key.length === 1) {
      const letter = e.key.toLowerCase()
      const item = items.find((it) => it.dataset.mnemonic === letter)
      if (item) {
        this.highlightMenuItem(item)
        this.invokeMenuItem(item)
        return true
      }
    }
    return false
  }

  windowActivated(_window: NWindow): void {}
  menuRendered(_bar: HTMLElement): void {}
  /** A menu item was chosen in the menu bar (the Modern workspace remembers which menu opened a window). */
  menuItemInvoked(_item: PBObject): void {}
  /** Called after the frame toolbar is rebuilt (the Modern workspace groups and labels its buttons). */
  toolbarRendered(_tool: HTMLElement): void {}
  accessibleTabs(): boolean { return false }

  dispose(): void {
    if (this.views.size) throw new Error('Cannot replace presentation while a window is open.')
    this.lifetime.abort()
    this.down.clear()
    this.style.remove()
  }

  down = new Set<string>()
  keyIsDown(k: string): boolean {
    return this.down.has(k)
  }

  /** send(handle, WM_KEYDOWN, VK_TAB ...): move the focus like the Tab key */
  async sendKey(o: unknown, vk: number): Promise<void> {
    if (vk !== 9) return
    if (o instanceof NDwBase) {
      for (const wv of this.views.values()) {
        const cv = wv.ctlViews.get(o)
        if (cv?.dw) return cv.dw.tabNext(1)
      }
      return
    }
    // plain controls: the next control in tab order
    for (const wv of this.views.values()) {
      const cv = wv.ctlViews.get(o as PBObject)
      if (!cv) continue
      // A reflowed (Modern) window keeps its tab stops at tabindex 0 and the source order in data-tab.
      const reflowed = wv.el.classList.contains('modern-window') || wv.el.classList.contains('modern-entry-window')
      const all = reflowed ? sourceTabStops(wv.client, 'input,textarea,select,button').filter((e) => e.getAttribute('role') !== 'tab')
        : [...wv.client.querySelectorAll<HTMLElement>('input,textarea,select,button')]
          .filter((e) => e.tabIndex >= 0 && !e.matches(':disabled') && e.getClientRects().length > 0
            && getComputedStyle(e).visibility !== 'hidden')
      if (!reflowed) all.sort((a, b) => (a.tabIndex || Infinity) - (b.tabIndex || Infinity))
      const here = (cv.el.matches('input,textarea,select,button') ? cv.el : cv.el.querySelector('input:not([hidden]),textarea:not([hidden]),select:not([hidden]),button:not([hidden])')) as HTMLElement | null
      const i = here ? all.indexOf(here) : -1
      all[(i + 1) % Math.max(1, all.length)]?.focus()
      return
    }
  }

  createWindow(w: NWindow, opts: { sheet: boolean; modal: boolean }): void {
    const v = new WinView(this, w, opts)
    this.views.set(w, v)
    if (Number(w.props.get('windowtype')) >= 4) this.mdi = v
  }
  createDwView(control: NDwBase, host: HTMLElement): DwView { return new DwView(control, host) }
  showWindow(w: NWindow): void {
    this.views.get(w)?.show()
  }
  hideWindow(w: NWindow): void {
    this.views.get(w)?.el.classList.add('hidden')
  }
  closeWindow(w: NWindow): void {
    const v = this.views.get(w)
    v?.destroy()
    this.views.delete(w)
    if (this.mdi === v) this.mdi = null
  }
  activate(w: NWindow): void {
    this.views.get(w)?.activate()
  }
  focus(o: PBObject): void {
    if (this.holdFocus(o)) return
    const v = this.findView(o)
    v?.focus()
  }
  /** SetFocus / SelectText on a DataWindow: the current cell and its in-place editor */
  async focusDw(o: PBObject, fallback = false): Promise<boolean> {
    if (this.holdFocus(o)) return true
    const v = this.findView(o)
    if (!v?.dw) return false
    return v.dw.focusCurrent(fallback)
  }
  /**
   * Tab past the last field of the last row of a DataWindow (Shift+Tab before its first): PowerBuilder moves on to the next
   * (previous) control in the window's tab order, which the recovered Enter handlers rely on (`send(handle(dw), 256, 9, ...)`
   * in 431 DataWindow events). False when the DataWindow is not in a window or nothing else takes Tab.
   */
  tabOut(o: PBObject, dir: number): boolean {
    for (const wv of this.views.values()) {
      const cv = wv.ctlViews.get(o)
      if (!cv || !wv.client.contains(cv.el)) continue
      const next = sourceTabNeighbour(wv.client, cv.el, dir, (stop) => stop.getAttribute('role') === 'tab')
      if (!next) return false
      next.focus()
      return next.contains(document.activeElement)
    }
    return false
  }

  /** The SetFocus a script aimed into a tab page that is held while its SelectionChanged scripts run. */
  private heldFocus: PBObject | null = null
  private elementOf(o: PBObject): HTMLElement | undefined {
    for (const view of this.views.values()) {
      const element = view.ctlViews.get(o)?.el
      if (element) return element
    }
    return undefined
  }
  private holdFocus(o: PBObject): boolean {
    if (!this.elementOf(o)?.closest('[data-tab-hold]')) return false
    this.heldFocus = o
    return true
  }
  /** A held tab page takes input again: the SetFocus its scripts asked for is applied now. */
  releaseHeldFocus(page: HTMLElement): void {
    const held = this.heldFocus
    const element = held ? this.elementOf(held) : undefined
    if (!held || !element || !page.contains(element) || element.closest('[data-tab-hold]')) return
    this.heldFocus = null
    void (held instanceof NDwBase ? this.focusDw(held, true) : Promise.resolve(false))
      .then((done) => { if (!done) this.focus(held) })
      .catch((error) => this.rt.onError(error))
  }
  findView(o: PBObject): { focus(): void; dw?: DwView } | undefined {
    for (const wv of this.views.values()) {
      const cv = wv.ctlViews.get(o)
      if (cv) return {
        focus: () => {
          if (cv.calendar) { cv.calendar.focus(); return }
          const editor = cv.dw?.editor
          const tab = cv.el.querySelector<HTMLElement>(':scope > [role=tablist] > [role=tab][tabindex="0"]')
          const input = cv.el.querySelector<HTMLElement>('input:not([hidden]),textarea:not([hidden]),select:not([hidden]),button:not([hidden])')
          ;(editor?.isConnected ? editor : tab ?? input ?? cv.el).focus()
        },
        dw: cv.dw ?? undefined,
      }
    }
    return undefined
  }
  print(dw: NDwBase): Promise<boolean> {
    return printDw(dw)
  }
  /** DataWindow SaveAs: to the given file (through the file endpoint) or, without a name, as a download */
  async saveAs(dw: NDwBase, file: string, type: string, headers: boolean): Promise<boolean> {
    await dw.ready
    const m = dw.model
    if (!m) return false
    // PDF: the report goes through the print dialog ("Save as PDF"); writing a PDF file unattended needs the shell (not available yet)
    if (/^pdf!?$/i.test(type) && !file) return printDw(dw)
    const out = await exportDw(m, type || 'excel!', headers)
    if (!out) return false
    if (file) return writeFileBytes(file, out.bytes)
    const url = URL.createObjectURL(new Blob([out.bytes as BlobPart], { type: out.mime }))
    const a = document.createElement('a')
    a.href = url
    a.download = `${m.name || 'report'}.${out.ext}`
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 10000)
    return true
  }
  printText(text: string): Promise<boolean> {
    return printPlainText(text)
  }
  /** control that has the keyboard focus */
  focused(): PBObject | null {
    const el = document.activeElement as HTMLElement | null
    for (const wv of this.views.values()) for (const [obj, cv] of wv.ctlViews) if (cv.el === el || cv.el.contains(el)) return obj
    return null
  }
  setMicroHelp(_w: NWindow, t: string): void {
    const s = this.desktop.querySelector('.status') as HTMLElement | null
    if (s) s.textContent = t
  }
  selectText(object: PBObject, start: number, length: number): void {
    for (const view of this.views.values()) {
      const root = view.ctlViews.get(object)?.el
      const input = root instanceof HTMLInputElement || root instanceof HTMLTextAreaElement ? root :
        root?.querySelector<HTMLInputElement | HTMLTextAreaElement>('input:not([hidden]),textarea:not([hidden])')
      if (input && ['text', 'password', 'textarea'].includes(input.type)) {
        input.setSelectionRange(Math.max(0, start - 1), Math.max(0, start - 1) + Math.max(0, length))
        return
      }
    }
  }

  /**
   * The z-order for the window being activated. The order is renumbered (keeping it) before it reaches the frame's
   * drop-down menus (1000) and message boxes (2000), so a long session never draws windows over them.
   */
  raise(): number {
    if (this.zTop >= 800) {
      const order = [...this.views.values()].filter((view) => view.el.style.zIndex)
        .sort((a, b) => Number(a.el.style.zIndex) - Number(b.el.style.zIndex))
      this.zTop = 10
      for (const view of order) view.el.style.zIndex = String(++this.zTop)
    }
    return ++this.zTop
  }

  /** A message box and its blocker go above every window. */
  private stackAboveWindows(blocker: HTMLElement, box: HTMLElement): void {
    blocker.style.zIndex = String(Math.max(1999, this.zTop + 1))
    box.style.zIndex = String(Math.max(2000, this.zTop + 2))
  }

  /** text prompt standing in for the file dialogs of the original */
  prompt(title: string, text: string, def: string): Promise<string | null> {
    return new Promise((resolve) => {
      const bg = document.createElement('div')
      bg.className = 'modal-bg'
      const box = document.createElement('div')
      box.className = 'msgbox'
      this.stackAboveWindows(bg, box)
      box.innerHTML = '<div class="tbar" style="background:#fff"><div class="ttl"></div></div><div class="body" style="flex-direction:column"><div class="txt"></div><input style="width:100%;height:24px;border:1px solid #7a7a7a"></div><div class="btns"><button class="ok">OK</button><button class="cancel">Cancel</button></div>'
      ;(box.querySelector('.ttl') as HTMLElement).textContent = title
      ;(box.querySelector('.txt') as HTMLElement).textContent = text
      const input = box.querySelector('input') as HTMLInputElement
      input.value = def
      let closed = false
      const done = (v: string | null) => {
        if (closed) return
        closed = true
        if (bg.isConnected) bg.remove()
        if (box.isConnected) box.remove()
        resolve(v)
      }
      ;(box.querySelector('.ok') as HTMLElement).onclick = () => done(input.value)
      ;(box.querySelector('.cancel') as HTMLElement).onclick = () => done(null)
      input.onkeydown = (e) => {
        if (e.key === 'Enter') done(input.value)
        if (e.key === 'Escape') done(null)
      }
      this.desktop.appendChild(bg)
      this.desktop.appendChild(box)
      const r = this.desktop.getBoundingClientRect()
      box.style.left = Math.max(0, (r.width - 420) / 2) + 'px'
      box.style.top = Math.max(0, (r.height - 160) / 3) + 'px'
      input.focus()
    })
  }

  messageBox(title: string, text: string, icon: string, buttons: string, def: number): Promise<number> {
    return new Promise((resolve) => {
      const bg = document.createElement('div')
      bg.className = 'modal-bg'
      const box = document.createElement('div')
      box.className = 'msgbox'
      this.stackAboveWindows(bg, box)
      // the Windows 11 pictures of a message box: blue circle with ? or i, red circle with a cross, yellow triangle
      const circle = (fill: string, glyph: string) => `<svg width="32" height="32" viewBox="0 0 32 32"><circle cx="16" cy="16" r="15" fill="${fill}"/>${glyph}</svg>`
      const ic: Record<string, string> = {
        'question!': circle('#0a7fd4', '<text x="16" y="23" text-anchor="middle" font-family="Segoe UI,Arial" font-weight="700" font-size="21" fill="#fff">?</text>'),
        'information!': circle('#0a7fd4', '<text x="16" y="23" text-anchor="middle" font-family="Segoe UI,Arial" font-weight="700" font-size="21" fill="#fff">i</text>'),
        'stopsign!': circle('#e0301e', '<path d="M10.5 10.5l11 11M21.5 10.5l-11 11" stroke="#fff" stroke-width="3" stroke-linecap="round"/>'),
        'exclamation!': '<svg width="32" height="32" viewBox="0 0 32 32"><path d="M16 2.5L30 28H2z" fill="#f9c80e" stroke="#c9a000" stroke-width="1" stroke-linejoin="round"/><text x="16" y="25" text-anchor="middle" font-family="Segoe UI,Arial" font-weight="700" font-size="20" fill="#222">!</text></svg>',
      }
      box.innerHTML = `<div class="tbar" style="background:#fff"><div class="ttl"></div></div><div class="body"><div class="ico"></div><div class="txt"></div></div><div class="btns"></div>`
      ;(box.querySelector('.ttl') as HTMLElement).textContent = title
      ;(box.querySelector('.ico') as HTMLElement).innerHTML = ic[icon] ?? ''
      ;(box.querySelector('.txt') as HTMLElement).textContent = text.replace(/\r\n/g, '\n')
      const btns = box.querySelector('.btns') as HTMLElement
      const list = messageButtons(buttons)
      let closed = false
      const done = (n: number) => {
        if (closed) return
        closed = true
        if (bg.isConnected) bg.remove()
        if (box.isConnected) box.remove()
        resolve(n)
      }
      list.forEach(([label, code], i) => {
        const b = document.createElement('button')
        b.textContent = label
        const key = label.charAt(0).toLowerCase()
        if (/^[a-z0-9]$/.test(key)) b.dataset.mnemonic = key
        b.onclick = () => done(code)
        btns.appendChild(b)
        // the Windows message box focuses the first button when the default is out of range
        if (i + 1 === def || ((def < 1 || def > list.length) && i === 0)) setTimeout(() => b.focus(), 0)
      })
      // Escape answers as the Windows message box does (the same rule as the Modern dialog): Cancel, or the only button.
      const escape = list.find(([label]) => label === 'Cancel') ?? (list.length === 1 ? list[0] : undefined)
      box.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape' || !escape) return
        e.preventDefault()
        e.stopPropagation()
        done(escape[1])
      })
      this.desktop.appendChild(bg)
      this.desktop.appendChild(box)
      const r = this.desktop.getBoundingClientRect()
      box.style.left = Math.max(0, (r.width - box.offsetWidth) / 2) + 'px'
      box.style.top = Math.max(0, (r.height - box.offsetHeight) / 3) + 'px'
    })
  }
}

class CtlView {
  el: HTMLElement
  obj: PBObject
  ui: DomUi
  dw: DwView | null = null
  dropdown: DropdownView | null = null
  calendar: CalendarView | null = null
  constructor(ui: DomUi, obj: PBObject, el: HTMLElement) {
    this.ui = ui
    this.obj = obj
    this.el = el
  }
}

export class WinView {
  ui: DomUi
  w: NWindow
  el: HTMLElement
  client!: HTMLElement
  ctlViews = new Map<PBObject, CtlView>()
  sheet: boolean
  modal: boolean
  mdiClient: HTMLElement | null = null
  private lifetime = new AbortController()
  private subscriptions: (() => void)[] = []
  private destroyed = false

  private watch(control: PBObject, listener: () => void): void {
    if (!(control instanceof NControl) && !(control instanceof NDwBase)) return
    control.listeners.add(listener)
    this.subscriptions.push(() => control.listeners.delete(listener))
  }

  constructor(ui: DomUi, w: NWindow, opts: { sheet: boolean; modal: boolean }) {
    this.ui = ui
    this.w = w
    this.sheet = opts.sheet
    this.modal = opts.modal
    const isMdi = Number(w.props.get('windowtype')) >= 4
    this.el = document.createElement('div')
    this.el.className = 'pbwin' + (this.sheet ? ' sheet' : '')
    this.el.dataset.win = w.name.toLowerCase()
    const W = toPx(num(w, 'width'), 'x')
    const H = toPx(num(w, 'height'), 'y')
    const s = this.el.style
    s.width = W + 'px'
    // the client area of a dialog is 0.924 of its height in units (measured: Login 1016 PBU -> 234 px, Select Format 1322 PBU -> 306 px), the title bar comes on top
    s.height = (!opts.sheet && !isMdi && bool(w, 'titlebar', true) ? Math.round(H * 0.924) + 26 : H) + 'px'
    s.left = toPx(num(w, 'x'), 'x') + 'px'
    s.top = toPx(num(w, 'y'), 'y') + 'px'
    if (isMdi) {
      s.left = '0'
      s.top = '0'
      s.width = '100%'
      s.height = '100%'
    }
    const titlebar = bool(w, 'titlebar', true)
    if (titlebar) {
      const tb = document.createElement('div')
      tb.className = 'tbar'
      tb.innerHTML = '<img class="ic" src="app-icon.png" alt=""><div class="ttl"></div><div class="cls">✕</div>'
      this.ttlEl = tb.querySelector('.ttl') as HTMLElement
      this.ttlEl.textContent = str(w, 'title')
      if (w.name.toLowerCase() === 'w_main') setNativeTitle(this.ttlEl.textContent)
      ;(tb.querySelector('.cls') as HTMLElement).onclick = () => void ui.rt.closeWindow(w)
      this.el.appendChild(tb)
      const previous = w.onProp
      const onProp = (n: string) => {
        if (n === 'title') {
          this.ttlEl!.textContent = str(w, 'title')
          if (this.sheet) ui.mdi?.refreshTitle()
          else if (isMdi) this.refreshTitle()
        }
      }
      w.onProp = onProp
      this.subscriptions.push(() => { if (w.onProp === onProp) w.onProp = previous })
      if (!isMdi) this.dragify(tb)
    }
    if (isMdi) {
      this.buildMdi()
    } else {
      this.client = document.createElement('div')
      this.client.className = 'client'
      this.client.style.background = pbColor(w.props.get('backcolor') as number, '#f0f0f0')
      this.el.appendChild(this.client)
    }
    this.renderControls(w, this.client)
    this.watch(w, () => this.syncWindow())
    const host = this.sheet && ui.mdi?.mdiClient ? ui.mdi.mdiClient : ui.desktop
    host.appendChild(this.el)
    if (modal(this)) {
      // centred like a PowerBuilder response window
      const r = host.getBoundingClientRect()
      s.left = Math.round(Math.max(0, (r.width - W) / 2)) + 'px'
      s.top = Math.round(Math.max(0, (r.height - H) / 3)) + 'px'
    }
    this.el.classList.add('hidden')
    this.el.addEventListener('mousedown', () => this.activate())
    this.el.tabIndex = -1
    this.el.addEventListener('keydown', (e) => {
      const k = keyEnum(e)
      if (!k) return
      // the window's own key event fires only when no control has the focus (as in PowerBuilder)
      if (e.target === this.el) void ui.rt.fire(this.w, 'key', [k, keyFlags(e)])
      const tag = (e.target as HTMLElement).tagName
      // default / cancel buttons
      if (k === 'keyenter!' && !e.defaultPrevented && tag !== 'TEXTAREA' && tag !== 'BUTTON' && !(e.target as HTMLElement).closest('.dw')) {
        for (const [o, cv] of this.ctlViews) if (o.native === 'commandbutton' && o.props.get('default') === true && o.props.get('enabled') !== false) (cv.el as HTMLButtonElement).click()
      } else if (k === 'keyescape!' && !e.defaultPrevented) {
        e.preventDefault()
        const dw = [...this.ctlViews.values()].find((cv) => cv.dw?.root.contains(e.target as Node))?.dw
        void (async () => {
          if (dw && !(await dw.allowsDefaultKey(e))) return
          if (!this.w.isOpen || this.w.closing || !this.el.contains(document.activeElement) ||
            dw && !dw.root.contains(document.activeElement)) return
          for (const [o, cv] of this.ctlViews) if (o.native === 'commandbutton' && o.props.get('cancel') === true && o.props.get('enabled') !== false) (cv.el as HTMLButtonElement).click()
        })().catch((error) => ui.rt.onError(error))
      }
    })
  }

  ttlEl: HTMLElement | null = null
  private wasMax = false

  /** a sheet with `windowstate = maximized!` fills the MDI client, has no title bar of its own and shows its title in the frame's */
  private isMax(): boolean {
    const s = this.w.props.get('windowstate')
    return s === 2 || s === 'maximized!'
  }

  /** frame title: its own title, plus ` - [sheet title]` of the topmost maximized sheet (as Windows draws it) */
  refreshTitle(): void {
    if (!this.ttlEl) return
    const maxed = [...this.ui.views.values()].filter((v) => v.sheet && v.el.classList.contains('max') && v.el.isConnected && !v.el.classList.contains('hidden'))
    maxed.sort((a, b) => Number(b.el.style.zIndex || 0) - Number(a.el.style.zIndex || 0))
    this.ttlEl.textContent = str(this.w, 'title') + (maxed[0] ? ' - [' + str(maxed[0].w, 'title') + ']' : '')
    if (this.w.name.toLowerCase() === 'w_main') setNativeTitle(this.ttlEl.textContent)
  }

  private syncWindow(): void {
    const s = this.el.style
    if (this.sheet) {
      const max = this.isMax()
      this.el.classList.toggle('max', max)
      if (max !== this.wasMax) {
        this.wasMax = max
        this.ui.mdi?.refreshTitle()
        if (max) {
          // the window now has the size of the MDI client: scripts that lay out their controls on `resize` get it in PowerBuilder units
          requestAnimationFrame(() => {
            if (this.destroyed) return
            const r = this.el.getBoundingClientRect()
            if (!r.width) return
            this.w.props.set('width', r.width / toPx(1, 'x'))
            this.w.props.set('height', r.height / toPx(1, 'y'))
            void this.ui.rt.fire(this.w, 'resize', [2, this.w.props.get('width'), this.w.props.get('height')])
          })
        }
      }
    }
    const wt = Number(this.w.props.get('windowtype'))
    if (wt < 4) {
      // Windows response windows have a 3 px frame and are 4 px wider / 9 px
      // taller than the recovered PBU size (measured: Select Format 353x340
      // vs 349x331, Sale Summary format list 417x487 vs 413x478).  The client
      // area stays the same: the extra width is the 1 -> 3 px border, the
      // extra height covers the frame and the taller client inset.
      const frame = this.modal && !this.sheet && wt === 3 && bool(this.w, 'titlebar', true)
      s.left = toPx(num(this.w, 'x'), 'x') + 'px'
      s.top = toPx(num(this.w, 'y'), 'y') + 'px'
      s.width = (frame ? Math.round(toPx(num(this.w, 'width'), 'x')) + 4 : toPx(num(this.w, 'width'), 'x')) + 'px'
      s.height = (frame ? Math.round(toPx(num(this.w, 'height'), 'y')) + 9 : toPx(num(this.w, 'height'), 'y')) + 'px'
      s.borderWidth = frame ? '3px' : ''
    }
    // Response windows are centred on the screen; scripts (Interface Setting,
    // the report argument dialogs) resize themselves in Open, so centring them
    // only in the constructor leaves them at the old position.
    if (this.modal && !this.sheet) {
      const host = this.el.parentElement?.getBoundingClientRect()
      const W = parseFloat(s.width) || this.el.offsetWidth
      const H = parseFloat(s.height) || this.el.offsetHeight
      if (host && W > 0 && H > 0) {
        s.left = Math.round(Math.max(0, (host.width - W) / 2)) + 'px'
        s.top = Math.round(Math.max(0, (host.height - H) / 3)) + 'px'
      }
    }
  }

  private dragify(bar: HTMLElement): void {
    let sx = 0
    let sy = 0
    let ox = 0
    let oy = 0
    const move = (e: MouseEvent) => {
      this.el.style.left = ox + e.clientX - sx + 'px'
      this.el.style.top = oy + e.clientY - sy + 'px'
    }
    bar.addEventListener('mousedown', (e) => {
      if (this.el.classList.contains('modern-window') || (e.target as HTMLElement).classList.contains('cls')) return
      sx = e.clientX
      sy = e.clientY
      ox = this.el.offsetLeft
      oy = this.el.offsetTop
      const up = () => {
        document.removeEventListener('mousemove', move)
        document.removeEventListener('mouseup', up)
      }
      document.addEventListener('mousemove', move, { signal: this.lifetime.signal })
      document.addEventListener('mouseup', up, { signal: this.lifetime.signal })
    })
  }

  show(): void {
    this.el.classList.remove('hidden')
    this.syncWindow()
    this.activate()
    for (const control of this.ctlViews.values()) control.calendar?.shown()
    // first focus: the control the opening script gave the keyboard to
    // (SetFocus during Open records lastFocusDw); otherwise the lowest tab order
    const first = this.firstFocusable()
    if (first) setTimeout(() => {
      if (this.destroyed) return
      const a = document.activeElement
      if (!a || a === document.body || !this.client.contains(a)) {
        const last = (this.w as unknown as { lastFocusDw?: PBObject }).lastFocusDw
        if (last) void this.ui.focusDw(last)
        else first.focus()
      }
    }, 0)
    void this.ui.rt.fire(this.w, 'activate')
  }

  firstFocusable(): HTMLElement | null {
    const els = [...this.client.querySelectorAll<HTMLElement>('input,textarea,select,button')].filter((e) => !(e as HTMLInputElement).disabled && !e.hidden)
    els.sort((a, b) => Number(a.dataset.tab ?? 9999) - Number(b.dataset.tab ?? 9999))
    return els[0] ?? null
  }

  focus(): void {
    this.firstFocusable()?.focus()
  }

  activate(): void {
    for (const v of this.ui.views.values()) v.el.classList.remove('active')
    this.el.classList.add('active')
    if (Number(this.el.style.zIndex) !== this.ui.zTop) this.el.style.zIndex = String(this.ui.raise())
    if (this.sheet) {
      this.ui.mdi?.showMenuFor(this.w)
      this.ui.mdi?.refreshTitle()
    }
    this.ui.windowActivated(this.w)
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.lifetime.abort()
    for (const unsubscribe of this.subscriptions) unsubscribe()
    this.subscriptions = []
    for (const control of this.ctlViews.values()) {
      control.dw?.dispose()
      control.dropdown?.dispose()
      control.calendar?.dispose()
    }
    if (this.toolbarTimer) clearInterval(this.toolbarTimer)
    this.el.remove()
    if (this.sheet && this.ui.mdi) {
      // the menu of the sheet that is on top now (or the frame's)
      const rest = [...this.ui.views.values()].filter((v) => v.sheet && v !== this && v.el.isConnected).sort((a, b) => Number(b.el.style.zIndex || 0) - Number(a.el.style.zIndex || 0))
      this.ui.mdi.showMenuFor(rest[0]?.w ?? null)
      this.ui.mdi.refreshTitle()
    }
  }

  // ---------------------------------------------------------------- MDI frame
  buildMdi(): void {
    const w = this.w
    this.client = document.createElement('div')
    this.client.style.cssText = 'flex:1;display:flex;flex-direction:column;position:relative;overflow:hidden'
    this.el.appendChild(this.client)
    const menuName = str(w, 'menuname')
    const bar = document.createElement('div')
    bar.className = 'menubar'
    this.client.appendChild(bar)
    const tool = document.createElement('div')
    tool.className = 'toolbar'
    this.client.appendChild(tool)
    this.mdiClient = document.createElement('div')
    this.mdiClient.className = 'mdi-client'
    this.client.appendChild(this.mdiClient)
    const st = document.createElement('div')
    st.className = 'status'
    st.textContent = 'Ready'
    this.client.appendChild(st)
    if (menuName) void this.loadMenu(menuName, bar)
  }

  async loadMenu(name: string, bar: HTMLElement): Promise<void> {
    const rt = this.ui.rt
    const menu = await rt.instantiate(name, this.w)
    if (this.destroyed) return
    this.w.props.set('menuid', menu)
    this.frameMenu = menu
    this.shownMenu = menu
    this.menuBar = bar
    this.renderMenuBar(menu, bar)
    this.startToolbar()
  }

  /** MDI: the menu of the active sheet replaces the frame's menu bar and toolbar while the sheet is active (a sheet without a menu keeps the frame's) */
  showMenuFor(sheet: PBObject | null): void {
    if (!this.menuBar) return
    const own = sheet ? (sheet.props.get('menuid') as PBObject | undefined) : undefined
    const m = own ?? this.frameMenu
    if (!m || m === this.shownMenu) return
    this.shownMenu = m
    this.shownSheet = own ? sheet : null
    this.menuSig = ''
    this.renderMenuBar(m, this.menuBar)
    this.toolSig = ''
  }

  statusText(t: string): void {
    const st = this.client.querySelector('.status') as HTMLElement | null
    if (st) st.textContent = t
  }

  /** runs the menu item with this accelerator in the menu that is shown (enabled and visible items only) */
  fireShortcut(code: number): boolean {
    const find = (m: PBObject): PBObject | null => {
      for (const it of m.children.values()) {
        if (it.props.get('visible') === false) continue
        if (!it.children.size && Number(it.props.get('shortcut') ?? 0) === code && it.props.get('enabled') !== false) return it
        const r = find(it)
        if (r) return r
      }
      return null
    }
    const hit = this.shownMenu ? find(this.shownMenu) : null
    if (!hit) return false
    void this.ui.rt.fire(hit, 'clicked').then(() => this.ui.rt.flushPosted())
    return true
  }

  /** the toolbar follows the state of the menu items (sheets enable / disable them while the user works) */
  private frameMenu: PBObject | null = null
  private shownMenu: PBObject | null = null
  private shownSheet: PBObject | null = null
  private menuBar: HTMLElement | null = null
  private menuSig = ''
  private toolSig = ''
  private menuClickBound = false

  private startToolbar(): void {
    const tool = this.client.querySelector('.toolbar') as HTMLElement | null
    if (!tool) return
    const refresh = () => {
      const menu = this.shownMenu
      if (!menu) return
      // the rights are applied to the menu after the window opened: the bar follows visibility and captions
      const bar = [...menu.children.values()].map((i) => `${i.props.get('visible') === false ? 0 : 1}${str(i, 'text')}`).join('|')
      if (bar !== this.menuSig) {
        if (this.menuSig && this.menuBar) this.renderMenuBar(menu, this.menuBar)
        this.menuSig = bar
      }
      const items = toolbarItems(menu)
      const sig = items.map((x) => `${x.button.name}${x.button.enabled ? 1 : 0}${x.button.space ? 's' : ''}${x.button.text}`).join('|')
      if (sig === this.toolSig) return
      this.toolSig = sig
      tool.style.display = items.length ? '' : 'none' // the original's frame shows no toolbar until a sheet brings its own
      tool.replaceChildren()
      for (const { item, button } of items) {
        if (button.space) {
          const gap = document.createElement('span')
          gap.className = 'tb-gap'
          tool.appendChild(gap)
        }
        const b = document.createElement('button')
        b.className = 'tb' + (button.enabled ? '' : ' dis')
        b.title = button.text
        b.dataset.stock = button.stock.toLowerCase()
        b.dataset.label = button.text
        const pic = document.createElement('span')
        pic.className = 'pic'
        const spot = iconPos(button.stock)
        if (spot !== null) pic.style.backgroundPosition = `-${spot * 16}px 0`
        else {
          pic.classList.add('gl')
          pic.textContent = button.glyph
        }
        b.appendChild(pic)
        b.disabled = !button.enabled
        b.onclick = () => void this.ui.rt.fire(item, 'clicked').then(() => this.ui.rt.flushPosted())
        tool.appendChild(b)
      }
      // every sheet's toolbar ends with the door: it closes the sheet (seen on every window of the original)
      const sheet = this.shownSheet
      if (items.length && sheet) {
        const gap = document.createElement('span')
        gap.className = 'tb-gap'
        tool.appendChild(gap)
        const b = document.createElement('button')
        b.className = 'tb'
        b.title = 'Exit this Window'
        b.dataset.stock = 'exit!'
        b.dataset.label = 'Exit this Window'
        const pic = document.createElement('span')
        pic.className = 'pic'
        const spot = iconPos('exit!')
        if (spot !== null) pic.style.backgroundPosition = `-${spot * 16}px 0`
        b.appendChild(pic)
        b.onclick = () => void this.ui.rt.closeWindow(sheet)
        tool.appendChild(b)
      }
      this.ui.toolbarRendered(tool)
    }
    this.menuSig = [...(this.shownMenu?.children.values() ?? [])].map((i) => `${i.props.get('visible') === false ? 0 : 1}${str(i, 'text')}`).join('|')
    refresh()
    this.toolbarTimer = setInterval(refresh, 300)
  }
  private toolbarTimer: ReturnType<typeof setInterval> | undefined

  renderMenuBar(menu: PBObject, bar: HTMLElement): void {
    bar.replaceChildren()
    // the menu bar of a sheet shows its own `Item` menu right after File (measured on the original; the item array has it last, and the rights indices count it last)
    const tops = [...menu.children.values()]
    const own = tops.findIndex((t) => t.name === 'm_item')
    if (own > 1) tops.splice(1, 0, ...tops.splice(own, 1))
    for (const item of tops) {
      if (item.props.get('visible') === false) continue
      const mi = document.createElement('div')
      mi.className = 'mi'
      setMnemonic(mi, str(item, 'text'))
      mi.onmouseenter = () => this.statusText(str(item, 'microhelp') || caption(str(item, 'text')))
      mi.onmouseleave = () => this.statusText('Ready')
      mi.onclick = (e) => {
        e.stopPropagation()
        const open = bar.querySelector('.mi.open')
        if (open && open !== mi) open.classList.remove('open')
        bar.querySelectorAll('.menu-drop').forEach((d) => d.remove())
        mi.classList.toggle('open')
        if (mi.classList.contains('open')) {
          mi.appendChild(this.dropdown(item))
          const first = this.ui.menuItems(mi)[0]
          if (first) this.ui.highlightMenuItem(first)
        }
      }
      bar.appendChild(mi)
    }
    if (!this.menuClickBound) {
      this.menuClickBound = true
      document.addEventListener('click', () => {
        bar.querySelectorAll('.menu-drop').forEach((d) => d.remove())
        bar.querySelectorAll('.mi.open').forEach((d) => d.classList.remove('open'))
      }, { signal: this.lifetime.signal })
    }
    this.ui.menuRendered(bar)
  }

  dropdown(item: PBObject): HTMLElement {
    const d = document.createElement('div')
    d.className = 'menu-drop'
    void this.ui.rt.fire(item, 'selected') // lets scripts adjust items just before the menu opens
    for (const sub of item.children.values()) {
      if (sub.props.get('visible') === false) continue
      const text = str(sub, 'text')
      if (text === '-' || sub.name.startsWith('m_-')) {
        const sep = document.createElement('div')
        sep.className = 'sep'
        d.appendChild(sep)
        continue
      }
      const it = document.createElement('div')
      it.className = 'it' + (sub.props.get('enabled') === false ? ' dis' : '')
      const [rawLabel, rawHot] = text.split('	')
      const label = caption(rawLabel)
      const hot = rawHot
      const ck = document.createElement('span')
      ck.className = 'ck'
      ck.textContent = sub.props.get('checked') === true ? '✓' : ''
      const l = document.createElement('span')
      l.className = 'lb'
      setMnemonic(l, rawLabel.trim())
      if (l.dataset.mnemonic) it.dataset.mnemonic = l.dataset.mnemonic
      const r = document.createElement('span')
      r.className = sub.children.size ? 'ar' : 'hk'
      r.textContent = sub.children.size ? '' : (hot ?? '').trim()
      it.append(ck, l, r)
      it.onmouseenter = () => this.statusText(str(sub, 'microhelp') || label.trim())
      it.onmouseleave = () => this.statusText('Ready')
      if (sub.children.size) {
        const subDrop = this.dropdown(sub)
        subDrop.classList.add('sub')
        it.appendChild(subDrop)
      } else {
        it.onclick = (e) => {
          e.stopPropagation()
          if (sub.props.get('enabled') === false) return
          document.body.click()
          this.ui.menuItemInvoked(sub)
          void this.ui.rt.fire(sub, 'clicked').then(() => this.ui.rt.flushPosted())
        }
      }
      d.appendChild(it)
    }
    return d
  }

  // ---------------------------------------------------------------- controls
  renderControls(parent: PBObject, host: HTMLElement): void {
    const radioGroup = ++nextRadioGroup
    const radios: { el: HTMLInputElement; obj: PBObject }[] = []
    const groups: { name: string; x: number; y: number; w: number; h: number }[] = []
    const kids = [...parent.children.values()]
    for (const c of kids) if (c.native === 'groupbox') groups.push({ name: c.name, x: num(c, 'x'), y: num(c, 'y'), w: num(c, 'width'), h: num(c, 'height') })
    for (const c of kids) {
      const v = this.makeControl(c)
      if (!v) continue
      this.ctlViews.set(c, v)
      host.appendChild(v.el)
      if (c.native === 'radiobutton') {
        const input = v.el.querySelector('input') as HTMLInputElement
        const g = groups.find((g) => num(c, 'x') >= g.x && num(c, 'y') >= g.y && num(c, 'x') <= g.x + g.w && num(c, 'y') <= g.y + g.h)
        input.name = `rg_${radioGroup}_${g ? g.name : 'win'}`
        c.props.set('_radiogroup', input.name)
        radios.push({ el: input, obj: c })
      }
      if (c.children.size && c.native !== 'tab' && c.native !== 'datawindow') this.renderControls(c, v.el)
    }
  }

  private place(c: PBObject, el: HTMLElement): void {
    const s = el.style
    s.left = toPx(num(c, 'x'), 'x') + 'px'
    s.top = toPx(num(c, 'y'), 'y') + 'px'
    s.width = toPx(num(c, 'width'), 'x') + 'px'
    // the height of a drop-down list box includes its list; the closed control is one line (21 px at 96 dpi in the original)
    s.height = (c.native === 'dropdownlistbox' || c.native === 'dropdownpicturelistbox' ? 21 : toPx(num(c, 'height'), 'y')) + 'px'
    if (!bool(c, 'visible', true)) el.classList.add('hidden')
  }

  private style(c: PBObject, el: HTMLElement): void {
    el.style.font = fontOf(c)
    if (bool(c, 'underline', false)) el.style.textDecoration = 'underline'
    const bc = c.props.get('backcolor')
    if (typeof bc === 'number') el.style.background = pbColor(bc, 'transparent')
    this.textColor(c, el)
  }

  private textColor(c: PBObject, el: HTMLElement): void {
    const tc = c.props.get('textcolor')
    if (typeof tc === 'number') el.style.color = this.ui.controlTextColor(pbColor(tc, '#000'), el)
  }

  private borderClass(c: PBObject, el: HTMLElement): void {
    const b = num(c, 'borderstyle', 0)
    // Border defaults to on for the edit-like controls and to off for labels, check boxes, pictures ...; BorderStyle only applies while it is on
    const editLike = ['singlelineedit', 'multilineedit', 'editmask', 'listbox', 'dropdownlistbox', 'datawindow', 'datastore', 'richtextedit', 'treeview', 'listview', 'picturelistbox'].includes(c.native)
    if (!bool(c, 'border', editLike)) return
    if (b === 5) el.classList.add('lowered')
    else if (b === 6) el.classList.add('raised')
    else if (b === 2 || b === 1) el.classList.add('box')
  }

  makeControl(c: PBObject): CtlView | null {
    const rt = this.ui.rt
    const k = c.native
    let el: HTMLElement
    const wire = (target: HTMLElement) => {
      const order = num(c, 'taborder', 0)
      target.dataset.tab = String(order || 9999)
      target.tabIndex = order > 0 ? order : -1 // taborder 0 = not a tab stop
      // Native KeyDown and the recovered Enter event share the existing control.
      target.addEventListener('keydown', (e) => {
        const k = keyEnum(e)
        if (!k) return
        // Source Enter navigation must not also activate the window's default button.
        if (k === 'keyenter!' && (c.findRoutines('keydown').length ||
          target instanceof HTMLButtonElement && c.findRoutines('ue_enterkey').length)) e.preventDefault()
        const args = [k, keyFlags(e)]
        void rt.fire(c, 'key', args)
          .then(() => rt.fire(c, 'keydown', args))
          .then(() => rt.fire(c, 'ue_enterkey', args))
          .then(() => rt.flushPosted()).catch((error) => rt.onError(error))
      })
    }
    switch (k) {
      case 'commandbutton':
      case 'picturebutton': {
        const b = document.createElement('button')
        b.className = 'ctl' + (bool(c, 'default', false) ? ' default' : '')
        setMnemonic(b, str(c, 'text'))
        this.style(c, b)
        b.disabled = !bool(c, 'enabled', true)
        b.onclick = () => void (async () => {
          for (const control of this.ctlViews.values()) if (control.calendar) await control.calendar.settled()
          if (this.destroyed || b.disabled) return
          await rt.fire(c, 'clicked')
          await rt.flushPosted()
          await rt.flushPosted()
        })().catch((error) => rt.onError(error))
        b.onfocus = () => void rt.fire(c, 'getfocus')
        wire(b)
        el = b
        break
      }
      case 'statictext': {
        const d = document.createElement('div')
        d.className = 'ctl st'
        setMnemonic(d, str(c, 'text').replace(/\r\n/g, '\n'))
        this.style(c, d)
        d.style.textAlign = ALIGN[num(c, 'alignment', 0)] ?? 'left'
        d.style.lineHeight = 'normal'
        this.borderClass(c, d)
        d.onclick = () => void rt.fire(c, 'clicked').then(() => rt.flushPosted()).then(() => rt.flushPosted())
        el = d
        break
      }
      case 'statichyperlink': {
        // a link label: its text (the About window shows the e-mail and web address of the vendor), a click opens it
        const d = document.createElement('div')
        d.className = 'ctl st'
        d.textContent = str(c, 'text')
        this.style(c, d)
        d.style.textAlign = ALIGN[num(c, 'alignment', 0)] ?? 'left'
        d.style.lineHeight = 'normal'
        d.style.cursor = 'pointer'
        d.onclick = () => {
          const target = str(c, 'url') || str(c, 'text')
          if (target) window.open(/^[a-z]+:/i.test(target) ? target : target.includes('@') ? 'mailto:' + target : 'http://' + target, '_blank')
          void rt.fire(c, 'clicked')
        }
        el = d
        break
      }
      case 'singlelineedit':
      case 'editmask': {
        const i = document.createElement('input')
        i.className = 'ctl'
        i.value = str(c, 'text')
        this.style(c, i)
        // Border = false: the text sits on the form (the About window's company and licence lines)
        if (!bool(c, 'border', true)) i.style.border = 'none'
        i.style.textAlign = ALIGN[num(c, 'alignment', 0)] ?? 'left'
        if (bool(c, 'password', false)) i.type = 'password'
        const lim = num(c, 'limit', 0)
        if (lim > 0) i.maxLength = lim
        i.disabled = !bool(c, 'enabled', true)
        i.oninput = () => {
          c.props.set('text', i.value)
          void rt.fire(c, 'modified')
        }
        i.onfocus = () => void rt.fire(c, 'getfocus')
        i.onblur = () => void rt.fire(c, 'losefocus')
        wire(i)
        el = i
        break
      }
      case 'multilineedit': {
        const t = document.createElement('textarea')
        t.className = 'ctl'
        t.value = str(c, 'text')
        this.style(c, t)
        t.oninput = () => c.props.set('text', t.value)
        wire(t)
        el = t
        break
      }
      case 'richtextedit': {
        // the notes window edits a RichTextEdit; the runtime keeps its RTF/text
        // in `text` (PasteRTF/CopyRTF) and renders it as an editable textarea
        const t = document.createElement('textarea')
        t.className = 'ctl'
        t.value = str(c, 'text')
        this.style(c, t)
        t.readOnly = bool(c, 'displayonly', false)
        t.oninput = () => { c.props.set('text', t.value); void rt.fire(c, 'modified') }
        wire(t)
        el = t
        break
      }
      case 'checkbox':
      case 'radiobutton': {
        const l = document.createElement('label')
        l.className = 'ctl'
        this.style(c, l)
        const i = document.createElement('input')
        i.type = k === 'checkbox' ? 'checkbox' : 'radio'
        i.checked = bool(c, 'checked', false)
        i.disabled = !bool(c, 'enabled', true)
        i.onchange = () => {
          c.pbSet('checked', i.checked)
          void rt.fire(c, 'clicked').then(() => rt.flushPosted())
        }
        const sp = document.createElement('span')
        setMnemonic(sp, str(c, 'text'))
        if (k === 'radiobutton') {
          // PowerBuilder radio rows are text-top aligned; the native input's
          // default 3 px top margin plus flex centring pushed every row after
          // the focused one 3 px down (measured against the old dialog).
          l.style.alignItems = 'flex-start'
          l.style.paddingTop = '0px'
          i.style.marginTop = '2px'
          i.style.outline = 'none'
          i.addEventListener('focus', () => {
            sp.style.outline = '1px dotted #000'
            sp.style.outlineOffset = '0px'
          })
          i.addEventListener('blur', () => {
            sp.style.outline = ''
            sp.style.outlineOffset = ''
          })
        }
        if (bool(c, 'lefttext', false)) l.append(sp, i)
        else l.append(i, sp)
        wire(i)
        el = l
        break
      }
      case 'groupbox': {
        const f = document.createElement('fieldset')
        f.className = 'ctl'
        const lg = document.createElement('legend')
        setMnemonic(lg, str(c, 'text'))
        f.appendChild(lg)
        this.style(c, f)
        // a group box is only a frame and a caption: it never hides or catches the controls inside it (they come earlier in the control order)
        f.style.background = 'transparent'
        f.style.pointerEvents = 'none'
        el = f
        break
      }
      case 'monthcalendar': {
        if (!(c instanceof NCalendar)) throw new Error(`Missing native calendar: ${c.name}`)
        const calendar = new CalendarView(c)
        this.style(c, calendar.el)
        this.place(c, calendar.el)
        this.watch(c, () => {
          this.refresh(c, calendar.el)
          calendar.refresh()
        })
        const view = new CtlView(this.ui, c, calendar.el)
        view.calendar = calendar
        return view
      }
      case 'dropdownlistbox': {
        if (!(c instanceof NControl)) throw new Error(`Missing native dropdown control: ${c.name}`)
        const dropdown = new DropdownView(c)
        this.style(c, dropdown.el)
        this.place(c, dropdown.el)
        this.watch(c, () => {
          this.refresh(c, dropdown.el)
          dropdown.refresh()
        })
        const view = new CtlView(this.ui, c, dropdown.el)
        view.dropdown = dropdown
        return view
      }
      case 'listbox': {
        const s = document.createElement('select')
        s.className = 'ctl'
        s.size = 2
        this.style(c, s)
        const fill = () => {
          s.disabled = !bool(c, 'enabled', true)
          s.replaceChildren()
          const items = c.props.get('_items') as PBArray | undefined
          for (const it of items?.a ?? []) {
            const o = document.createElement('option')
            o.textContent = toStr(it)
            s.appendChild(o)
          }
          const sel = toNum(c.props.get('_selected') ?? 0)
          s.selectedIndex = sel - 1
        }
        fill()
        this.watch(c, fill)
        s.onchange = () => {
          c.props.set('_selected', s.selectedIndex + 1)
          void rt.fire(c, 'selectionchanged', [s.selectedIndex + 1])
        }
        s.onfocus = () => void rt.fire(c, 'getfocus')
        s.ondblclick = () => void rt.fire(c, 'doubleclicked', [s.selectedIndex + 1])
          .then(() => rt.flushPosted()).catch((error) => rt.onError(error))
        if (c.findRoutines('ue_keypressed').length) s.addEventListener('keydown', (event) => {
          const key = keyEnum(event)
          if (!key) return
          if (key === 'keyenter!') event.preventDefault()
          void rt.fire(c, 'ue_keypressed', [key, keyFlags(event)])
            .then(() => rt.flushPosted()).catch((error) => rt.onError(error))
        })
        wire(s)
        el = s
        break
      }
      case 'listview': {
        const d = document.createElement('div')
        d.className = 'ctl lv'
        this.style(c, d)
        const fill = () => {
          d.replaceChildren()
          const items = (c.props.get('_lvitems') as PBStruct[] | undefined) ?? []
          const pics = (c.props.get('_lvpics') as string[] | undefined) ?? []
          const sel = toNum(c.props.get('_selected') ?? 0)
          const size = Math.max(16, toNum(c.props.get('largepicturewidth') ?? 32))
          items.forEach((it, i) => {
            const cell = document.createElement('div')
            cell.className = 'lvi' + (sel === i + 1 ? ' on' : '')
            const pi = toNum(it.pbGet('pictureindex'))
            const src = pi > 0 ? pics[pi - 1] : ''
            const im = document.createElement('div')
            im.className = 'lvp'
            im.style.width = im.style.height = size + 'px'
            if (src) im.style.backgroundImage = `url("${src}")`
            const label = document.createElement('span')
            label.textContent = toStr(it.pbGet('label'))
            cell.append(im, label)
            cell.onclick = () => {
              c.props.set('_selected', i + 1)
              fill()
              void rt.fire(c, 'clicked', [i + 1])
            }
            d.appendChild(cell)
          })
        }
        fill()
        this.watch(c, fill)
        wire(d)
        el = d
        break
      }
      case 'graph': {
        // the PowerBuilder graph control: the chart is drawn from the series the scripts add
        const d = document.createElement('div')
        d.className = 'ctl graph'
        d.style.overflow = 'hidden'
        const draw = () => {
          const g = c instanceof NGraph ? c : null
          if (!g) return
          const w = Math.max(40, num(c, 'width', 200)), h = Math.max(30, num(c, 'height', 120))
          const cats: string[] = []
          for (const s of g.series) for (const p of s.points) if (!cats.includes(p.category)) cats.push(p.category)
          const series = g.series.map((s) => s.name)
          const pts = g.series.flatMap((s) => s.points.map((p) => ({ cat: p.category, series: s.name, v: p.value })))
          d.innerHTML = renderChartSvg(pts, cats, series, w, h, {
            kind: Number(g.pbGet('graphtype') ?? 7),
            title: String(g.pbGet('title') ?? ''),
            background: pbColor(Number(g.pbGet('backcolor') ?? 16777215), '#fff'),
            categoryLabel: g.category.label,
            valuesLabel: g.values.label,
          })
        }
        this.place(c, d)
        this.watch(c, draw)
        draw()
        el = d
        break
      }
      case 'datawindow':
      case 'datastore': {
        if (k === 'datastore') return null
        const d = document.createElement('div')
        d.className = 'ctl'
        d.style.overflow = 'hidden'
        this.borderClass(c, d)
        this.place(c, d)
        this.watch(c, () => this.refresh(c, d))
        const v = new CtlView(this.ui, c, d)
        v.dw = this.ui.createDwView(c as NDwBase, d)
        return v
      }
      case 'tab': {
        const accessible = this.ui.accessibleTabs()
        const t = document.createElement('div')
        t.className = 'ctl tabctl' + (accessible ? ' keyboard-tabs' : '')
        const strip = document.createElement('div')
        strip.className = 'strip'
        const id = `form-tabs-${++nextTabControl}`
        if (accessible) {
          strip.setAttribute('role', 'tablist')
          strip.setAttribute('aria-label', caption(str(c, 'text')).trim() || 'Form pages')
        }
        type TabItem = { po: PBObject; tab: HTMLElement; page: HTMLElement }
        const items: TabItem[] = []
        const visibleItems = () => items.filter((x) => !x.po.destroyed && x.po.props.get('visible') !== false)
        // in source tab order: data-tab carries TabOrder in Classic (where it equals tabindex) and in a reflowed Modern window
        const pageControls = (page: HTMLElement) => sourceTabStops(page).filter((element) => !element.matches('[aria-disabled=true]'))
        const show = (n: number) => {
          const vs = visibleItems()
          const enabled = vs.filter((item) => tabAvailable(item.po))
          const focused = enabled.find((item) => item.tab === document.activeElement)
          const entry = focused ?? enabled.find((item) => vs.indexOf(item) + 1 === n) ?? enabled[0]
          for (const it of items) {
            const at = vs.indexOf(it)
            const selected = at >= 0 && at + 1 === n
            it.tab.style.display = at < 0 ? 'none' : ''
            it.page.style.display = selected ? 'block' : 'none'
            it.tab.classList.toggle('on', selected)
            const label = it.tab.querySelector('.lb')!
            label.textContent = caption(str(it.po, 'text'))
            if (accessible) {
              it.tab.setAttribute('aria-selected', String(selected))
              it.tab.setAttribute('aria-disabled', String(!tabAvailable(it.po)))
              it.tab.tabIndex = it === entry ? 0 : -1
              it.page.hidden = !selected
              it.page.tabIndex = selected && !pageControls(it.page).length ? 0 : -1
              if (!label.textContent.trim()) it.tab.setAttribute('aria-label', it.po.name)
              else it.tab.removeAttribute('aria-label')
            }
          }
        }
        const select = (n: number) => {
          const max = Math.max(1, visibleItems().length)
          const at = Math.min(Math.max(1, n), max)
          show(at)
          c.props.set('selectedtab', at)
        }
        // PowerBuilder removes the tab of a page whose Visible is false; the
        // scripts of the entry windows use that for rights (Interface Setting
        // hides the patient/service/… tabs of modules that are not licensed).
        const sync = () => {
          if (this.destroyed) return
          const vs = visibleItems()
          const cur = Math.min(toNum(c.props.get('selectedtab') ?? 1) || 1, Math.max(1, vs.length))
          const focus = document.activeElement
          const ownedFocus = focus instanceof HTMLElement && t.contains(focus)
          show(cur)
          // The page being switched to takes no input until its SelectionChanged scripts have run (see TabSelection.switching):
          // the page and its controls, wherever a Modern layout has placed them.
          for (const item of items) {
            const hold = selection.switching === item.po
            if (hold === item.page.hasAttribute('data-tab-hold')) continue
            const within = (control: PBObject) => {
              for (let owner = control.parent; owner; owner = owner.parent) if (owner === item.po) return true
              return false
            }
            const held = [item.page, ...[...this.ctlViews].filter(([control]) => within(control)).map(([, binding]) => binding.el)
              .filter((element) => !item.page.contains(element))]
            for (const element of held) {
              element.inert = hold
              if (hold) element.dataset.tabHold = ''
              else delete element.dataset.tabHold
            }
            if (!hold) for (const element of held) this.ui.releaseHeldFocus(element)
          }
          if (accessible) {
            strip.setAttribute('aria-busy', String(selection.busy))
            if (ownedFocus && focus instanceof HTMLElement &&
              (focus.getClientRects().length === 0 || !tabAvailable(c) ||
                items.some((item) => item.tab === focus && !tabAvailable(item.po)))) {
              const entry = items.find((item) => item.tab.tabIndex === 0)
              ;(entry?.tab ?? this.el).focus()
            }
          }
        }
        const selection = new TabSelection(c, sync, async (oldPage) => {
          const panel = items.find((item) => item.po === oldPage)?.page
          for (const binding of this.ctlViews.values()) {
            if (binding.dw && panel?.contains(binding.el) && !(await binding.dw.acceptPendingEdit())) return false
          }
          return !this.destroyed
        })
        for (const po of c.children.values()) {
          const tabEl = document.createElement('div')
          tabEl.className = 't'
          // the picture of the page (a stock name such as `Table!`) and the text, which keeps its trailing blanks (they widen the tab)
          const spot = iconPos(str(po, 'picturename'))
          if (spot !== null) {
            const pic = document.createElement('span')
            pic.className = 'pic'
            pic.style.backgroundPosition = `-${spot * 16}px 0`
            tabEl.appendChild(pic)
          }
          const label = document.createElement('span')
          label.className = 'lb'
          setMnemonic(label, str(po, 'text'))
          if (label.dataset.mnemonic) tabEl.dataset.mnemonic = label.dataset.mnemonic
          tabEl.appendChild(label)
          const page = document.createElement('div')
          page.className = 'page'
          if (accessible) {
            tabEl.id = `${id}-${items.length + 1}`
            page.id = `${tabEl.id}-panel`
            tabEl.setAttribute('role', 'tab')
            tabEl.setAttribute('aria-controls', page.id)
            page.setAttribute('role', 'tabpanel')
            page.setAttribute('aria-labelledby', tabEl.id)
            page.tabIndex = 0
          }
          t.appendChild(page)
          const item: TabItem = { po, tab: tabEl, page }
          items.push(item)
          tabEl.onmousedown = (event) => { if (event.button === 0) event.preventDefault() }
          tabEl.onclick = () => {
            if (this.destroyed || !t.isConnected) return
            const focus = document.activeElement
            void selection.select(po).then((accepted) => {
              if (accepted && accessible && !this.destroyed && t.isConnected && tabAvailable(po) &&
                (document.activeElement === focus || document.activeElement === document.body)) tabEl.focus()
            }).catch((error) => rt.onError(error))
          }
          if (accessible) {
            tabEl.onfocus = () => {
              sync()
              tabEl.scrollIntoView({ block: 'nearest', inline: 'nearest' })
            }
            tabEl.onkeydown = (event) => {
              if (!tabAvailable(po)) return
              const modified = event.altKey || event.ctrlKey || event.metaKey || event.shiftKey
              const available = visibleItems().filter((entry) => tabAvailable(entry.po))
              const index = available.indexOf(item)
              const target = modified ? null : event.key === 'ArrowRight' ? available[(index + 1) % available.length]
                : event.key === 'ArrowLeft' ? available[(index - 1 + available.length) % available.length]
                  : event.key === 'Home' ? available[0] : event.key === 'End' ? available.at(-1) : null
              if (target) {
                event.preventDefault()
                event.stopPropagation()
                target.tab.focus()
              } else if (!modified && (event.key === 'Enter' || event.key === ' ')) {
                event.preventDefault()
                event.stopPropagation()
                tabEl.click()
              } else if (!modified && event.key === 'Tab') {
                const active = items.find((entry) => entry.tab.getAttribute('aria-selected') === 'true')
                if (active) {
                  event.preventDefault()
                  ;(pageControls(active.page)[0] ?? active.page).focus()
                }
              }
              const key = keyEnum(event)
              if (key) void rt.fire(c, 'key', [key, keyFlags(event)]).catch((error) => rt.onError(error))
            }
            page.addEventListener('keydown', (event) => {
              if (event.defaultPrevented || event.key !== 'Tab' || !event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return
              if (event.target !== page && event.target !== pageControls(page)[0]) return
              event.preventDefault()
              tabEl.focus()
            }, { signal: this.lifetime.signal })
          }
          strip.appendChild(tabEl)
          this.renderControls(po, page)
          this.watch(po, sync)
        }
        if (accessible) strip.addEventListener('focusout', () => queueMicrotask(sync), { signal: this.lifetime.signal })
        t.prepend(strip)
        select(toNum(c.props.get('selectedtab') ?? 1) || 1)
        // a script that sets selectedtab switches the page, too
        this.watch(c, sync)
        el = t
        break
      }
      case 'picture': {
        const img = document.createElement('img')
        img.className = 'ctl'
        img.src = 'assets/' + str(c, 'picturename').replace(/^.*[\\/]/, '').toLowerCase()
        img.onerror = () => (img.style.visibility = 'hidden')
        img.onclick = () => void rt.fire(c, 'clicked').then(() => rt.flushPosted()).then(() => rt.flushPosted())
        el = img
        break
      }
      case 'progressbar': {
        const p = document.createElement('progress')
        p.className = 'ctl'
        p.max = num(c, 'maxposition', 100)
        p.value = num(c, 'position', 0)
        this.watch(c, () => (p.value = num(c, 'position', 0)))
        el = p
        break
      }
      default: {
        // user objects, scroll bars, OLE, graph ...: a plain container
        const d = document.createElement('div')
        d.className = 'ctl'
        d.style.background = typeof c.props.get('backcolor') === 'number' ? pbColor(c.props.get('backcolor') as number, 'transparent') : 'transparent'
        el = d
      }
    }
    el.classList.add('ctl')
    this.place(c, el)
    if (!bool(c, 'enabled', true) && 'disabled' in el) (el as HTMLButtonElement).disabled = true
    this.watch(c, () => this.refresh(c, el))
    return new CtlView(this.ui, c, el)
  }

  /** property changes made by scripts (text, enabled, visible, position ...) */
  refresh(c: PBObject, el: HTMLElement): void {
    this.place(c, el)
    el.classList.toggle('hidden', !bool(c, 'visible', true))
    const dis = !bool(c, 'enabled', true)
    if ('disabled' in el) (el as HTMLButtonElement).disabled = dis
    const raw = str(c, 'text')
    const mnemonic = (target: HTMLElement, text: string) => {
      if (target.dataset.raw === text) return
      target.dataset.raw = text
      setMnemonic(target, text)
    }
    if (c.native === 'commandbutton') mnemonic(el, raw)
    else if (c.native === 'statictext') mnemonic(el, raw.replace(/\r\n/g, '\n'))
    else if (c.native === 'groupbox') {
      const legend = el.querySelector('legend')
      if (legend) mnemonic(legend, raw)
    }
    else if (c.native === 'singlelineedit' || c.native === 'editmask') {
      const i = el as HTMLInputElement
      if (i.value !== str(c, 'text')) i.value = str(c, 'text')
      if (c.native === 'editmask') {
        if (c.props.get('_invaliddata') === true) i.setAttribute('aria-invalid', 'true')
        else i.removeAttribute('aria-invalid')
      }
    } else if (c.native === 'multilineedit' || c.native === 'richtextedit') {
      const t = el as HTMLTextAreaElement
      const text = str(c, 'text')
      if (t.value !== text) t.value = text
      if (c.native === 'richtextedit') t.readOnly = bool(c, 'displayonly', false)
    } else if (c.native === 'checkbox' || c.native === 'radiobutton') {
      const i = el.querySelector('input') as HTMLInputElement
      i.checked = bool(c, 'checked', false)
      i.disabled = dis
      const sp = el.querySelector('span')
      if (sp) mnemonic(sp as HTMLElement, raw)
    }
    this.textColor(c, el)
  }
}

function modal(v: WinView): boolean {
  return v.modal
}
