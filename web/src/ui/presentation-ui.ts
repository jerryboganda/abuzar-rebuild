import { DomUi } from './dom-ui.ts'
import type { Runtime } from '../runtime/interp.ts'
import { NWindow } from '../runtime/native/controls.ts'
import { PBObject } from '../runtime/object.ts'
import type { NDwBase } from '../runtime/native/dwctrl.ts'
import type { InterfaceMode, PresentationSession } from '../app/ui-preferences.ts'
import { validatePreferences, DEFAULT_UI_PREFERENCES } from '../app/ui-preferences.ts'
import { printDw } from './print.ts'
import { readableText } from './pb.ts'
import { printFamilies, printTemplateFor, resolvePrintPresentation } from './print-templates.ts'
import { menuCommands, menuModules, executeMenuCommand } from './menu-commands.ts'
import { PRESENTATION_CSS } from './presentation-styles.ts'
import { DESIGN_CSS } from './design-system.ts'
import { HOME_CSS, HOME_ICONS, loadHome, renderHome, homeNotes, syncHomeActions } from './ds-home.ts'
import type { HomeData, HomeAction } from './ds-home.ts'
import { inetRequest } from '../runtime/native/fiscal.ts'
import { SALE_CSS, decorateSale } from './ds-sale.ts'
import { PAGES_CSS, renderReports, renderItems, loadItems, openItemDrawer, loadItem, exportItems, printItems } from './ds-pages.ts'
import { USERS_CSS, newUsersState, loadUsers, loadRights, renderUsers } from './ds-users.ts'
import { FX_CSS, installRipple, toast, confetti } from './ds-fx.ts'
import { saveLoginFigures } from './design-boot.ts'
import type { ItemsState, ReportEntry } from './ds-pages.ts'
import { PURCHASE_CSS, PURCHASE_MENU, purchaseState, decoratePurchase, forgetPurchaseFacts } from './ds-purchase.ts'
import { containDialogFocus, messageDialog, promptDialog } from './presentation-dialogs.ts'
import type { PresentationDialog } from './presentation-dialogs.ts'
import { ModernDwView } from './modern-dwview.ts'
import type { DwView } from './dwview.ts'
import { applyModernWindow } from './modern-window.ts'
import { applyModernEntryWindow, applyModernListWindow } from './modern-entry-window.ts'
import { nativeAppearance, nativeTheme } from './native-appearance.ts'
import { ModernHeader, groupToolbar, parseFrameTitle } from './modern-header.ts'
import type { ThemeChoice } from './modern-header.ts'
import type { NativeAppearance, NativeTheme } from './native-appearance.ts'

/** Incremental Modern shell; business screens stay explicitly labelled compatibility views until migrated. */
const MOTION_KEY = 'trader.ds.motion'
/** Animations switch of the Preferences page (this workstation); Windows' reduce-motion setting applies regardless. */
function motionOff(): boolean { try { return localStorage.getItem(MOTION_KEY) === 'off' } catch { return false } }
function setMotion(off: boolean): void { try { if (off) localStorage.setItem(MOTION_KEY, 'off'); else localStorage.removeItem(MOTION_KEY) } catch { /* not stored */ } }

export class PresentationUi extends DomUi {
  private session: PresentationSession
  private shell: HTMLElement | null = null
  private settings: HTMLDialogElement
  private presentationStyle: HTMLStyleElement
  private systemTheme = matchMedia('(prefers-color-scheme: dark)')
  private cleanup = new AbortController()
  private selected: NWindow | null = null
  private tabs = new Map<NWindow, { container: HTMLElement; tab: HTMLButtonElement; changed: () => void }>()
  private executing = false
  private openModules = new Set<string>()
  private nextTab = 0
  private lastFocus = new Map<NWindow, HTMLElement>()
  private dialogs = new Set<HTMLDialogElement>()
  private modalWindows = new Map<NWindow, { element: HTMLDialogElement; focus: HTMLElement | null; activeWindow: NWindow | null; nameObserver: MutationObserver }>()
  private nextModal = 0
  private lastNativeTheme: NativeTheme | undefined
  private nativeRevision = 0
  private nativeAppearance: NativeAppearance
  private header: ModernHeader | null = null
  // Approved design: Home dashboard tab, menu path per window (breadcrumbs, current module, tab icon), notifications.
  private homeActive = true
  private homeHost: HTMLElement | null = null
  private homeBar: HTMLElement | null = null
  private homeTab: HTMLElement | null = null
  private homeData: HomeData | null = null
  private homeLoaded = 0
  private homeRendered = false
  // Approved design: Reports and Items pages open as tabs beside Home (the Home panel shows the active page).
  private page: 'home' | Page = 'home'
  private pageTabs = new Map<Page, HTMLElement>()
  private usersState = newUsersState()
  /** Connection, FBR and godown as the status bar last saw them (the header's clock and user popovers show them too). */
  private statusInfo: { serverOk: boolean | null; fbr?: boolean; godown?: string } = { serverOk: null }
  private reportState: { group?: string } = {}
  private itemsState: ItemsState = { q: '', filter: 'all', rows: [], counts: {}, anchor: null, seq: 0 }
  private itemsLoaded = false
  /** godown and FBR status for the Home subtitle (filled by the status bar's checks) */
  private homeContext: string[] = []
  private pendingPath: { path: string[]; at: number } | null = null
  private windowPaths = new Map<NWindow, string[]>()
  private freshTabs = new Set<NWindow>()
  private purchaseDirty = false
  private lastPost: { code: string; posted: boolean } | null = null

  constructor(rt: Runtime, desktop: HTMLElement, session: PresentationSession, appearance: NativeAppearance = nativeAppearance) {
    super(rt, desktop)
    this.session = session
    this.nativeAppearance = appearance
    this.presentationStyle = document.createElement('style')
    // The approved design system layers on the Modern styles (Classic never loads either).
    this.presentationStyle.textContent = PRESENTATION_CSS + DESIGN_CSS + HOME_CSS + PURCHASE_CSS + PAGES_CSS + SALE_CSS + USERS_CSS + FX_CSS
    document.head.append(this.presentationStyle)
    this.settings = this.buildSettings()
    if (session.activeMode === 'modern') {
      installRipple()
      this.shell = document.createElement('section')
      this.shell.className = 'presentation-ui'
      this.shell.setAttribute('aria-label', 'Modern workspace preview')
      this.shell.innerHTML = `<aside class="presentation-sidebar"><label>Find a command<input type="search" autocomplete="off"></label><p class="command-status" role="status"></p><div class="presentation-commands"></div></aside>
        <section class="presentation-work"><div class="presentation-tabs" role="tablist" aria-label="Open workspaces"></div><p class="presentation-compatibility">Classic compatibility layouts / Modern screen migration is in progress</p><div class="presentation-stage"></div></section>`
      this.header = this.buildHeader()
      this.shell.prepend(this.header.element)
      desktop.before(this.shell)
      this.shell.querySelector('.presentation-stage')!.append(desktop)
      const search = this.shell.querySelector('input')!
      search.addEventListener('input', () => this.refreshCommands())
      // Rights and scripts can enable or hide menu items at any time: the list is rebuilt from the live menu whenever the user turns
      // to it (focusing the search box, or pointing at the sidebar while no command in it has the focus).
      search.addEventListener('focus', () => this.refreshCommands())
      const sidebar = this.shell.querySelector('.presentation-sidebar')!
      sidebar.addEventListener('pointerenter', () => {
        if (!sidebar.contains(document.activeElement) || document.activeElement === search) this.refreshCommands()
      })
    }
    this.systemTheme.addEventListener('change', () => this.applyAppearance(), { signal: this.cleanup.signal })
    desktop.addEventListener('focusin', (event) => {
      if (this.selected && event.target instanceof HTMLElement && this.views.get(this.selected)?.el.contains(event.target)) {
        this.lastFocus.set(this.selected, event.target)
      }
    }, { signal: this.cleanup.signal })
    this.applyAppearance()
    this.refreshCommands()
    // Approved design: the Pack Purchase companion follows the window's live DataWindows.
    const companion = setInterval(() => this.decorateActive(), 400)
    this.cleanup.signal.addEventListener('abort', () => clearInterval(companion))
  }

  private decorateActive(): void {
    if (!this.shell || this.homeActive || !this.selected || this.hasModal()) return
    const view = this.views.get(this.selected)
    this.decorateReport()
    if (!view || !view.el.classList.contains('modern-entry-window')) { this.mdi?.el.querySelector('.mh-toolbar .ds-print-slip')?.remove(); return }
    this.decorateListToggle(view.el)
    const byName = (name: string) => [...view.ctlViews.keys()].find((control) => control.name === name)
    const transaction = this.rt.globals.get('sqlca') as { db?: { query(sql: string, params: unknown[]): Promise<{ rows: unknown[][] }> } } | undefined
    const ctx = {
      root: view.el,
      model: (name: string) => (byName(name) as unknown as { model?: never } | undefined)?.model ?? null,
      query: async (sql: string, params: unknown[]) => transaction?.db ? (await transaction.db.query(sql, params)).rows : [],
    }
    const creditSale = /credit/i.test(String(this.selected.props.get('title') ?? ''))
    const other = (() => {
      const root = this.commandRoot()
      const pattern = creditSale ? /^Sales \/ Cash ?Sale$/i : /^Sales \/ Credit Sale$/i
      return root ? menuCommands(root).find((command) => pattern.test(command.label)) : undefined
    })()
    const printCommand = (() => {
      const root = this.commandRoot()
      // File › Print (saves when needed, then prints) where the deployment shows it, otherwise File › Save And Post
      const all = root ? menuCommands(root, { includeDisabled: true }) : []
      const named = (pattern: RegExp) => all.find((command) => pattern.test(command.label.replace(/\s*\.{3,}\s*$/, '').trim()))
      return named(/^File \/ Print$/i) ?? named(/^File \/ Save And Post$/i)
    })()
    decorateSale(view.el, ctx.query, (stock) => this.mdi?.el.querySelector<HTMLButtonElement>(`.mh-toolbar button[data-stock="${stock}"]`) ?? null, () => this.decorateActive(),
      other ? () => void this.runCommand(other) : null, creditSale,
      { print: printCommand ? { run: () => void this.runCommand(printCommand), shortcut: printCommand.shortcut, disabled: !!printCommand.disabled, label: /print$/i.test(printCommand.label) ? 'Pay & print' : 'Save & post' } : null, fiscal: this.statusInfo.fbr !== undefined })
    const state = purchaseState(ctx, () => this.decorateActive())
    if (!state) { this.mdi?.el.querySelector('.mh-toolbar .ds-print-slip')?.remove(); return }
    if (this.purchaseDirty && !state.dirty) { forgetPurchaseFacts(); this.purchaseDirty = false; return void this.decorateActive() }
    // the approved design celebrates a posted invoice: the same invoice turning from not posted to posted
    const code = String((ctx.model('dw_detail') as { getItem(row: number, column: string): unknown } | null)?.getItem(1, 'code') ?? '')
    if (code && this.lastPost?.code === code && !this.lastPost.posted && state.posted) {
      const panel = view.el.querySelector('.ds-post')?.getBoundingClientRect()
      if (panel) confetti(panel.left + panel.width / 2, panel.top)
      toast(`Posted purchase ${code} · stock updated`)
    }
    this.lastPost = code ? { code, posted: state.posted } : null
    this.purchaseDirty = state.dirty
    const menu = (key: keyof typeof PURCHASE_MENU) => {
      const root = this.commandRoot()
      const command = root ? menuCommands(root).find((item) => PURCHASE_MENU[key].test((item.label.split(' / ').at(-1) ?? '').replace(/\s*\.{3,}\s*$/, '').trim())) : undefined
      return command ? () => void this.runCommand(command) : null
    }
    decoratePurchase(ctx, state, (stock) => this.mdi?.el.querySelector<HTMLButtonElement>(`.mh-toolbar button[data-stock="${stock}"]`) ?? null, () => this.decorateActive(), menu)
  }

  protected override shortcutsEnabled(): boolean {
    if (this.settings?.open || this.dialogs.size) return false
    const focus = document.activeElement
    // Accelerators work while the focus is in the workspace or on its tab strip; the command search box keeps its keys.
    return !this.shell || !focus || !this.shell.contains(focus) || this.desktop.contains(focus) || !!focus.closest('.presentation-tabs')
  }

  protected override menuShortcutsEnabled(): boolean { return this.session.activeMode === 'classic' ? super.menuShortcutsEnabled() : !this.hasModal() }
  /** Modern response windows are modal dialogs, which already make the rest of the workspace inert. */
  protected override responseWindowsBlockPointer(): boolean { return this.session.activeMode === 'classic' }
  /** Modern keeps a field's source colours (a colour channel, a status) but never draws unreadable text on them. */
  override controlTextColor(source: string, el: HTMLElement): string {
    return this.session.activeMode === 'modern' ? readableText(source, el.style.backgroundColor) : source
  }
  override accessibleTabs(): boolean { return this.session.activeMode === 'modern' }

  override createDwView(control: NDwBase, host: HTMLElement): DwView {
    if (this.session.activeMode === 'classic') return super.createDwView(control, host)
    const view = new ModernDwView(control, host, (dialog) => this.present(dialog))
    this.styleAppearance(view.root)
    return view
  }

  private hasModal(): boolean {
    return this.dialogs.size > 0 || [...this.views.values()].some((view) => view.modal && view.w.isOpen)
  }

  override menuItemInvoked(item: PBObject): void {
    const path: string[] = []
    for (let node: PBObject | null = item; node && node.native !== 'window'; node = node.parent) {
      const text = String(node.props.get('text') ?? '').split(/<TAB>|\t/)[0].replace(/&&/g, '\0').replace(/&/g, '').replace(/\0/g, '&').replace(/\.{3,}/g, '').trim()
      if (text) path.unshift(text)
    }
    this.pendingPath = { path: path.slice(0, -1), at: Date.now() }
  }

  override menuRendered(bar: HTMLElement): void {
    // Modern: the open-window tabs sit under the frame's menu bar and command bar, above the windows.
    const tabs = this.shell?.querySelector<HTMLElement>('.presentation-tabs')
    const mdi = bar.parentElement?.querySelector<HTMLElement>(':scope > .mdi-client')
    if (tabs && mdi && tabs.nextElementSibling !== mdi) mdi.before(tabs)
    if (this.shell && tabs && mdi && !this.homeHost) this.buildHome(tabs, mdi)
    // the user's rights are applied to the menu after sign-in: the quick actions follow the menu as it is now
    if (this.homeHost) syncHomeActions(this.homeHost, this.homeActions())
    if (!this.shell && !bar.querySelector('.appearance-trigger')) {
      const button = document.createElement('button')
      button.className = 'appearance-trigger'
      button.textContent = 'Appearance'
      button.onclick = () => this.openSettings()
      bar.append(button)
    }
    this.refreshCommands()
  }

  override createWindow(window: NWindow, options: { sheet: boolean; modal: boolean }): void {
    const focus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const activeWindow = [...this.views.values()].find((view) => view.el.classList.contains('active'))?.w ?? null
    super.createWindow(window, options)
    if (!this.shell) return
    const view = this.views.get(window)!
    const modernWindow = applyModernListWindow(view) || applyModernWindow(view) || applyModernEntryWindow(view)
    if (modernWindow) this.styleAppearance(view.el)
    if (options.modal) {
      const element = document.createElement('dialog')
      element.className = `presentation-compatibility-dialog${modernWindow ? ' presentation-modern-dialog' : ''}`
      const title = view.ttlEl
      if (title) title.id = `compatibility-dialog-${++this.nextModal}`
      const updateName = () => {
        const titled = !!title?.textContent?.trim()
        const label = titled ? title :
          view.el.querySelector<HTMLElement>('.window-field label .ctl,.window-data .surface-label')
        view.el.classList.toggle('window-untitled', !titled)
        if (label?.textContent?.trim()) {
          element.setAttribute('aria-labelledby', label.id)
          element.removeAttribute('aria-label')
        } else {
          element.setAttribute('aria-label', window.name)
          element.removeAttribute('aria-labelledby')
        }
      }
      const nameObserver = new MutationObserver(updateName)
      for (const region of [title, view.client]) if (region) {
        nameObserver.observe(region, { childList: true, characterData: true, subtree: true })
      }
      updateName()
      // A response window closes only through its scripts.  Escape reaches the window's own controls first and is then kept from the
      // browser, which can close a modal dialog on a repeated Escape even when its cancel event is prevented; a dialog closed any other
      // way while its window is still open is shown again.
      element.addEventListener('keydown', (event) => { if (event.key === 'Escape') event.preventDefault() })
      element.addEventListener('cancel', (event) => event.preventDefault())
      element.addEventListener('close', () => {
        if (element.isConnected && this.modalWindows.get(window)?.element === element) element.showModal()
      })
      containDialogFocus(element)
      element.append(view.el)
      document.body.append(element)
      this.modalWindows.set(window, { element, focus, activeWindow, nameObserver })
      this.updateTabs()
      this.refreshCommands()
      return
    }
    if (!options.sheet) return
    const container = document.createElement('div')
    container.className = 'presentation-tab'
    container.setAttribute('role', 'presentation')
    const tab = document.createElement('button')
    const id = `workspace-${++this.nextTab}`
    view.el.id = id
    view.el.setAttribute('role', 'tabpanel')
    view.el.setAttribute('aria-labelledby', `${id}-tab`)
    tab.id = `${id}-tab`
    tab.setAttribute('role', 'tab')
    tab.setAttribute('aria-controls', id)
    tab.onclick = () => {
      if (this.hasModal()) return
      this.activate(window)
      const last = this.lastFocus.get(window)
      if (last?.isConnected) last.focus()
      else view.focus()
    }
    tab.onkeydown = (event) => {
      if (this.hasModal()) return
      const windows = [...this.tabs.keys()]
      const index = windows.indexOf(window)
      const next = event.key === 'ArrowRight' ? (index + 1) % windows.length
        : event.key === 'ArrowLeft' ? (index - 1 + windows.length) % windows.length
          : event.key === 'Home' ? 0 : event.key === 'End' ? windows.length - 1 : -1
      if (next < 0) return
      event.preventDefault()
      this.activate(windows[next])
      this.tabs.get(windows[next])!.tab.focus()
    }
    const close = document.createElement('button')
    close.textContent = '\u00d7'
    close.onclick = () => {
      if (!this.hasModal()) void this.rt.closeWindow(window).catch((error) => this.rt.onError(error))
    }
    container.append(tab, close)
    this.shell.querySelector('.presentation-tabs')!.append(container)
    const changed = () => this.updateTabs()
    if (this.pendingPath && Date.now() - this.pendingPath.at < 8000) this.windowPaths.set(window, this.pendingPath.path)
    this.pendingPath = null
    this.freshTabs.add(window)
    this.tabs.set(window, { container, tab, changed })
    window.listeners.add(changed)
    this.updateTabs()
  }

  override showWindow(window: NWindow): void {
    const modal = this.modalWindows.get(window)
    if (modal && !modal.element.open) {
      this.down.clear()
      modal.element.showModal()
    }
    super.showWindow(window)
  }

  override windowActivated(window: NWindow): void {
    if (this.tabs.has(window)) { this.selected = window; this.homeActive = false }
    this.updateTabs()
    this.refreshCommands()
  }

  private updateTabs(): void {
    const modal = this.hasModal()
    for (const [window, controls] of this.tabs) {
      const active = window === this.selected && !this.homeActive
      const title = String(window.props.get('title') || window.name)
      const module = this.windowPaths.get(window)?.[0] ?? ''
      controls.tab.replaceChildren()
      if (this.windowModified(window)) {
        const dot = document.createElement('span'); dot.className = 'ds-tab-dot'; dot.title = 'Unsaved changes'; controls.tab.append(dot)
      }
      controls.tab.insertAdjacentHTML('beforeend', `<svg class="ds-tab-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${HOME_ICONS[moduleIcon(module)]}</svg>`)
      controls.tab.append(title)
      controls.container.classList.toggle('ds-fresh', this.freshTabs.delete(window))
      controls.tab.setAttribute('aria-selected', String(active))
      controls.tab.tabIndex = active ? 0 : -1
      controls.tab.disabled = modal
      const close = controls.container.querySelector<HTMLButtonElement>('button:last-child')
      if (close) {
        close.disabled = modal
        close.setAttribute('aria-label', `Close ${controls.tab.textContent}`)
      }
      const view = this.views.get(window)
      if (view) view.el.hidden = !active
    }
    if (this.homeTab) {
      const tab = this.homeTab.querySelector<HTMLButtonElement>('[role=tab]')!
      tab.setAttribute('aria-selected', String(this.homeActive && this.page === 'home'))
      tab.tabIndex = this.homeActive && this.page === 'home' ? 0 : -1
      tab.disabled = modal
    }
    for (const [page, container] of this.pageTabs) {
      const tab = container.querySelector<HTMLButtonElement>('[role=tab]')!
      tab.setAttribute('aria-selected', String(this.homeActive && this.page === page))
      tab.tabIndex = this.homeActive && this.page === page ? 0 : -1
      for (const button of container.querySelectorAll('button')) button.disabled = modal
    }
    if (this.homeBar) {
      this.homeBar.querySelector('.mh-title')!.textContent = this.pageTitle()
      for (const button of this.homeBar.querySelectorAll<HTMLElement>('[data-ds]')) button.hidden = (button.dataset.page ?? 'home') !== this.page
    }
    if (this.homeHost) this.homeHost.setAttribute('aria-labelledby', this.page === 'home' ? 'workspace-home-tab' : `workspace-${this.page}-tab`)
    if (this.homeHost) this.homeHost.hidden = !this.homeActive
    if (this.homeBar) this.homeBar.hidden = !this.homeActive
    this.shell?.classList.toggle('ds-home-on', this.homeActive)
    if (this.homeActive) void this.showPage()
    this.syncHomeUser()
    if (this.homeHost && this.homeActive) syncHomeActions(this.homeHost, this.homeActions())
    const module = this.homeActive ? '' : (this.selected && this.windowPaths.get(this.selected)?.[0]) || ''
    this.mdi?.el.querySelectorAll<HTMLElement>('.menubar .mi').forEach((mi) => mi.classList.toggle('ds-current', !!module && mi.textContent?.trim() === module))
    this.header?.refresh()
    const heading = this.mdi?.el.querySelector<HTMLElement>('.mh-toolbar .mh-title')
    if (heading) heading.textContent = this.selected && !this.homeActive ? String(this.selected.props.get('title') || this.selected.name) : ''
    const notice = this.shell?.querySelector('.presentation-compatibility')
    if (notice) notice.textContent = this.selected && this.views.get(this.selected)?.el.classList.contains('modern-entry-window')
      ? 'Modern entry layout preview / Production workflow acceptance is pending'
      : 'Classic compatibility layouts / Modern screen migration is in progress'
  }

  override closeWindow(window: NWindow): void {
    const tab = this.tabs.get(window)
    if (tab) window.listeners.delete(tab.changed)
    const modal = this.modalWindows.get(window)
    super.closeWindow(window)
    if (modal) {
      modal.nameObserver.disconnect()
      modal.element.close()
      modal.element.remove()
      this.modalWindows.delete(window)
    }
    this.tabs.get(window)?.container.remove()
    this.tabs.delete(window)
    this.windowPaths.delete(window)
    if (!this.tabs.size) this.homeActive = true
    this.lastFocus.delete(window)
    // The window that becomes active is the most recently activated one (the top of the z-order), as in Classic, not the last tab.
    const top = <T extends PBObject>(windows: Iterable<T>): T | null => [...windows].filter((item) => this.views.has(item))
      .sort((a, b) => Number(this.views.get(b)!.el.style.zIndex || 0) - Number(this.views.get(a)!.el.style.zIndex || 0))[0] ?? null
    if (this.selected === window) {
      this.selected = top(this.tabs.keys())
      if (this.selected) this.activate(this.selected)
    }
    if (modal) {
      const remaining = [...this.modalWindows].filter(([, value]) => value.element.open).at(-1)?.[0]
      const active = remaining ?? top([...this.views.keys()].filter((item): item is NWindow => item instanceof NWindow && item !== this.mdi?.w))
        ?? this.mdi?.w
      if (active) this.activate(active)
    }
    this.updateTabs()
    this.refreshCommands()
    if (modal) this.restoreFocus(modal.focus)
  }

  /**
   * Focus after a dialog or response window closes.  As in PowerBuilder (Windows gives the focus back to the control that had it, and
   * the control's GetFocus runs), the previously focused control takes it back.  When that control is gone or disabled, the active
   * window holds the focus, so the keyboard and the accelerators stay with the workspace instead of the command search box.
   */
  private restoreFocus(previous: Element | null): void {
    if (previous instanceof HTMLElement && previous.isConnected && !previous.matches(':disabled') && previous !== document.body) {
      previous.focus()
      return
    }
    const active = [...this.views.values()].find((view) => view.el.isConnected && view.el.classList.contains('active'))
    if (active) active.el.focus({ preventScroll: true })
    else this.shell?.querySelector<HTMLElement>('.presentation-sidebar input')?.focus()
  }

  private commandRoot(): PBObject | null {
    const root = this.selected?.props.get('menuid') ?? this.mdi?.w.props.get('menuid')
    return root instanceof PBObject ? root : null
  }

  private refreshCommands(): void {
    if (!this.shell) return
    const host = this.shell.querySelector('.presentation-commands')!
    const status = this.shell.querySelector('.command-status')!
    host.replaceChildren()
    const root = this.commandRoot()
    const query = this.shell.querySelector('input')!.value.trim().toLowerCase()
    // Disabled items are listed greyed, as the menu bar shows them; check marks and accelerator text are shown as well.
    const all = root ? menuCommands(root, { includeDisabled: true }) : []
    const matches = all.filter((command) => command.label.toLowerCase().includes(query))
    const browse = !query
    const count = (list: typeof all) => list.filter((command) => !command.disabled).length
    status.textContent = browse ? `${count(all)} available commands in ${menuModules(all).length} modules` :
      matches.length > 80 ? `Showing 80 of ${matches.length} commands. Refine your search.` : `${count(matches)} available commands`
    const run = (command: (typeof all)[number], label: string) => {
      const button = document.createElement('button')
      button.className = 'presentation-command'
      if (command.checked) {
        const mark = document.createElement('span')
        mark.className = 'command-check'
        mark.setAttribute('aria-hidden', 'true')
        mark.textContent = '✓ '
        button.append(mark)
      }
      button.append(label)
      if (command.shortcut) {
        const keys = document.createElement('span')
        keys.className = 'command-shortcut'
        keys.textContent = ` ${command.shortcut}`
        button.append(keys)
      }
      if (command.checked) button.setAttribute('aria-description', 'checked')
      button.disabled = this.executing || this.hasModal() || !!command.disabled
      button.onclick = async () => {
        if (this.executing || this.hasModal() || !root) return
        this.executing = true
        host.querySelectorAll('button').forEach((item) => { item.disabled = true })
        try {
          if (root !== this.commandRoot() || !(await executeMenuCommand(this.rt, root, command))) {
            await this.messageBox('Command unavailable', 'This command is no longer available in the active workspace.', 'information!', 'ok!', 1)
          }
        } catch (error) {
          this.rt.onError(error)
        } finally {
          this.executing = false
          this.refreshCommands()
        }
      }
      return button
    }
    if (browse) {
      // Modules list only commands the live menu currently allows; opened groups survive refreshes.
      for (const module of menuModules(all)) {
        const group = document.createElement('details')
        group.className = 'presentation-module'
        group.open = this.openModules.has(module.label)
        const title = document.createElement('summary')
        title.textContent = `${module.label} (${module.commands.length})`
        group.append(title)
        const fill = () => {
          if (group.querySelector('button')) return
          for (const item of module.commands.slice(0, 200)) group.append(run(item.command, item.label))
          if (module.commands.length > 200) {
            const more = document.createElement('p')
            more.textContent = `Showing 200 of ${module.commands.length} commands. Search to find the rest.`
            group.append(more)
          }
        }
        if (group.open) fill()
        group.addEventListener('toggle', () => {
          if (group.open) { this.openModules.add(module.label); fill() } else this.openModules.delete(module.label)
        })
        host.append(group)
      }
    } else {
      for (const command of matches.slice(0, 80)) host.append(run(command, command.label))
    }
  }

  override toolbarRendered(tool: HTMLElement): void {
    if (this.shell) groupToolbar(tool, this.selected ? String(this.selected.props.get('title') || this.selected.name) : '')
  }

  /** The Modern context bar: every action runs the live menu item or window (approved parity exception, docs/HANDOFF.md). */
  private buildHeader(): ModernHeader {
    const COLLAPSED = 'trader-modern-commands-hidden'
    const header = new ModernHeader({
      commands: () => { const root = this.commandRoot(); return root ? menuCommands(root, { includeDisabled: true }) : [] },
      run: (command) => this.runCommand(command),
      windows: () => [...this.tabs].map(([window, controls]) => ({
        title: String(window.props.get('title') || window.name), active: window === this.selected, activate: () => controls.tab.click(),
      })),
      frameTitle: () => this.mdi?.ttlEl?.textContent || String(this.mdi?.w.props.get('title') ?? ''),
      windowTitle: () => this.selected && !this.homeActive ? String(this.selected.props.get('title') || this.selected.name) : this.pageTitle(),
      windowPath: () => this.selected && !this.homeActive ? this.windowPaths.get(this.selected) ?? [] : this.page === 'home' ? [] : [PAGES[this.page].path],
      openMenu: (caption) => {
        const mi = [...this.mdi?.el.querySelectorAll<HTMLElement>('.menubar .mi') ?? []].find((item) => item.textContent?.trim() === caption)
        mi?.click()
      },
      notes: () => this.homeData ? homeNotes(this.homeData) : [],
      openHome: () => this.selectHome(),
      toggleCommands: () => toggle(),
      theme: () => this.session.preferences.theme as ThemeChoice,
      setTheme: (theme) => {
        try {
          this.session.save(validatePreferences({ ...this.session.preferences, theme }))
          this.applyAppearance(true)
        } catch (error) {
          this.rt.onError(error)
        }
      },
      openSettings: () => this.openSettings(),
      busy: () => this.executing || this.hasModal() || this.settings.open,
      query: () => this.pageQuery(),
      status: () => this.statusInfo,
      openItem: (code) => void this.openItemByCode(code),
      openPurchases: () => {
        const root = this.commandRoot()
        const command = root ? menuCommands(root).find((item) => /^Purchase \/ Purchases$/i.test(item.label)) : undefined
        if (command) void this.runCommand(command)
      },
      toolbarCommands: () => this.homeActive ? [] : [...this.mdi?.el.querySelectorAll<HTMLButtonElement>('.mh-toolbar button.tb[data-stock]') ?? []].map((button) => {
        const [label, shortcut] = (button.dataset.label || button.title || '').split('\t')
        return { label: label.trim(), shortcut: shortcut?.trim() || undefined, disabled: button.disabled, run: () => button.click() }
      }).filter((command) => command.label),
    })
    const apply = (hidden: boolean) => this.shell?.classList.toggle('mh-commands-hidden', hidden)
    // Hidden by default, as in the approved header design; the header button shows it.
    try { apply(localStorage.getItem(COLLAPSED) !== '0') } catch { apply(true) }
    const toggle = () => {
      const hidden = !this.shell?.classList.contains('mh-commands-hidden')
      apply(hidden)
      try { localStorage.setItem(COLLAPSED, hidden ? '1' : '0') } catch { /* per-session only */ }
    }
    return header
  }

  /** True when a DataWindow of the window has changes that are not saved. */
  private windowModified(window: NWindow): boolean {
    const view = this.views.get(window)
    if (!view) return false
    for (const control of view.ctlViews.keys()) {
      const model = (control as unknown as { model?: { buf?: { primary?: { s?: string }[]; deleted?: unknown[] } } }).model
      const rows = model?.buf?.primary
      if (rows?.some((row) => row.s === 'new!' || row.s === 'newmodified!' || row.s === 'datamodified!')) return true
      if (model?.buf?.deleted?.length) return true
    }
    return false
  }

  /** The Home tab, its command bar and the dashboard panel over the window area. */
  private buildHome(tabs: HTMLElement, mdi: HTMLElement): void {
    const container = document.createElement('div')
    container.className = 'presentation-tab ds-home-tab'
    container.setAttribute('role', 'presentation')
    const tab = document.createElement('button')
    tab.type = 'button'
    tab.id = 'workspace-home-tab'
    tab.setAttribute('role', 'tab')
    tab.setAttribute('aria-controls', 'workspace-home')
    tab.innerHTML = `<svg class="ds-tab-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${HOME_ICONS.chart}</svg>Home`
    tab.onclick = () => this.selectHome()
    container.append(tab)
    tabs.prepend(container)
    this.homeTab = container
    const bar = document.createElement('div')
    bar.className = 'ds-home-bar'
    bar.setAttribute('role', 'toolbar')
    bar.setAttribute('aria-label', 'Home commands')
    bar.innerHTML = `<span class="mh-title">Home</span><span class="ds-spacer"></span>
      <button type="button" class="tb" data-ds="refresh" aria-label="Refresh figures" title="Refresh figures"><svg class="mh-i" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5"/></svg></button>
      <button type="button" class="tb mh-primary" data-ds="sale"><svg class="mh-i" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${HOME_ICONS.cart}</svg><span class="mh-label">New sale</span></button>`
    bar.insertAdjacentHTML('beforeend', `<button type="button" class="tb" data-ds="items-refresh" data-page="items" aria-label="Refresh items"><svg class="mh-i" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5"/></svg><span class="mh-label">Refresh</span></button>
      <button type="button" class="tb" data-ds="items-export" data-page="items" aria-label="Export to Excel" title="Export to Excel"><svg class="mh-i" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12M7 10l5 5 5-5M5 21h14"/></svg><span class="mh-label">Export</span></button>
      <button type="button" class="tb" data-ds="items-print" data-page="items" aria-label="Print list" title="Print list"><svg class="mh-i" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9V3h12v6M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="7"/></svg><span class="mh-label">Print</span></button>
      <button type="button" class="tb mh-primary" data-ds="item-form" data-page="items"><svg class="mh-i" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${HOME_ICONS.box}</svg><span class="mh-label">New item</span></button>
      <button type="button" class="tb" data-ds="users-refresh" data-page="users" aria-label="Refresh users"><svg class="mh-i" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5"/></svg><span class="mh-label">Refresh</span></button>`)
    bar.querySelector('[data-ds=refresh]')!.addEventListener('click', () => { this.homeLoaded = 0; void this.showHome(true) })
    bar.querySelector('[data-ds=items-refresh]')!.addEventListener('click', () => { this.itemsLoaded = false; void this.showPage() })
    bar.querySelector('[data-ds=item-form]')!.addEventListener('click', () => this.itemFormCommand()?.())
    bar.querySelector('[data-ds=users-refresh]')!.addEventListener('click', () => { this.usersState = newUsersState(); this.homeHost!.dataset.page = ''; void this.showPage() })
    const listOut = async (kind: 'export' | 'print') => {
      const query = this.pageQuery()
      if (!query) return
      try {
        const count = kind === 'export' ? await exportItems(query, this.itemsState) : await printItems(query, this.itemsState, parseFrameTitle(this.mdi?.ttlEl?.textContent || '').company || 'Trader')
        toast(kind === 'export' ? `Saved ${count.toLocaleString('en-PK')} items as a spreadsheet (CSV)` : `Sent ${count.toLocaleString('en-PK')} items to the printer`, kind === 'export' ? 'dl' : 'print')
      } catch (error) { this.rt.onError(error) }
    }
    bar.querySelector('[data-ds=items-export]')!.addEventListener('click', () => void listOut('export'))
    bar.querySelector('[data-ds=items-print]')!.addEventListener('click', () => void listOut('print'))
    bar.querySelector('[data-ds=sale]')!.addEventListener('click', () => this.homeActions()[0]?.run())
    const toolbar = mdi.parentElement?.querySelector<HTMLElement>(':scope > .toolbar')
    ;(toolbar ?? tabs).after(bar)
    if (toolbar) tabs.before(bar)
    this.homeBar = bar
    const host = document.createElement('section')
    host.className = 'ds-home-host'
    host.id = 'workspace-home'
    host.setAttribute('role', 'tabpanel')
    host.setAttribute('aria-labelledby', tab.id)
    mdi.append(host)
    this.homeHost = host
    this.buildStatus(mdi)
    // The frame title carries the company, period and user; the header and the greeting follow it when the script sets it.
    const title = this.mdi?.ttlEl
    if (title) {
      const observer = new MutationObserver(() => { this.header?.refresh(); this.syncHomeUser() })
      observer.observe(title, { childList: true, characterData: true, subtree: true })
      this.cleanup.signal.addEventListener('abort', () => observer.disconnect())
    }
    this.updateTabs()
  }

  /** The greeting follows the signed-in user named in the frame title (set by the application script after the Home was drawn). */
  private syncHomeUser(): void {
    const heading = this.homeHost?.querySelector('.ds-hello h2')
    const user = parseFrameTitle(this.mdi?.ttlEl?.textContent || '').user
    if (heading && user && !heading.textContent?.endsWith(user)) heading.textContent = heading.textContent!.replace(/,.*$/, `, ${user}`)
  }

  /** Status bar of the approved design: the original status text, then the live server connection and the application version. */
  private buildStatus(mdi: HTMLElement): void {
    const status = mdi.parentElement?.querySelector<HTMLElement>(':scope > .status')
    if (!status || status.parentElement?.classList.contains('ds-statusbar')) return
    const bar = document.createElement('footer')
    bar.className = 'ds-statusbar'
    status.before(bar)
    const right = document.createElement('span')
    right.className = 'ds-status-right'
    const server = document.createElement('span')
    const fbr = document.createElement('span')
    const godown = document.createElement('span')
    const version = document.createElement('span')
    version.className = 'num'
    fbr.hidden = true
    godown.hidden = true
    right.append(server, fbr, godown, version)
    bar.append(status, right)
    status.setAttribute('role', 'status')
    const draw = (connected: boolean | null) => {
      this.statusInfo.serverOk = connected
      server.innerHTML = `<span class="ds-live${connected === false ? ' ds-off' : ''}" aria-hidden="true"></span>${connected === false ? 'Server not reachable' : connected ? 'Server connected' : 'Connecting…'}`
      const appVersion = Number(this.rt.globals.get('gl_appversion') ?? 0)
      const database = String(this.rt.globals.get('gs_dbname') ?? '')
      version.textContent = `${database ? `${database} · ` : ''}v2${appVersion ? ` · build ${appVersion}` : ''}`
    }
    let fiscal: boolean | null = null
    let godownCode = ''
    const check = async () => {
      const query = this.pageQuery()
      if (!query) { draw(null); return }
      try { await query('select 1'); draw(true) } catch { draw(false); return }
      // FBR IMS: only where this deployment fiscalizes (FiscalizationMethod set); the same local test address the original uses
      try {
        if (fiscal === null) fiscal = Number((await query(`SELECT prefvalue FROM dbo.softwarepreferences WHERE lower(name) = 'fiscalizationmethod'`))[0]?.[0] ?? 0) > 0
        if (fiscal) {
          const reply = await inetRequest('http://localhost:8524/api/IMSFiscal/Get', 'GET')
          fbr.hidden = false
          fbr.innerHTML = `<span class="ds-live${reply.ok ? '' : ' ds-off'}" aria-hidden="true"></span>FBR IMS: ${reply.ok ? 'online' : 'offline'}`
          this.statusInfo.fbr = reply.ok
          this.setHomeContext(1, reply.ok ? 'FBR fiscal invoicing online' : 'FBR fiscal invoicing offline')
        }
      } catch { /* the preference table is not readable: no FBR status shown */ }
      // the default godown: the DefaultGCode preference (the global gl_defaultgcode when a script has set it)
      let code = String(this.rt.globals.get('gl_defaultgcode') ?? '')
      if (!Number(code)) {
        try { code = String((await query(`SELECT prefvalue FROM dbo.softwarepreferences WHERE lower(name) = 'defaultgcode'`))[0]?.[0] ?? '').trim() } catch { code = '' }
      }
      if (code && code !== godownCode) {
        godownCode = code
        try {
          const name = String((await query('SELECT name FROM dbo.godown WHERE gcode = $1', [Number(code)]))[0]?.[0] ?? '').trim()
          godown.hidden = !name
          godown.textContent = `Godown: ${name}`
          this.statusInfo.godown = name || undefined
          if (name) this.setHomeContext(0, name)
        } catch { godown.hidden = true }
      }
    }
    draw(null)
    void check()
    const timer = setInterval(() => { if (document.visibilityState === 'visible') void check() }, 30_000)
    this.cleanup.signal.addEventListener('abort', () => clearInterval(timer))
  }

  /** Report windows (opened from the Reports menu) get the mockup's report-viewer header: a way back to the catalogue and a
   * Preview tag beside the title.  The window, its criteria dialog and its commands are the original's. */
  private decorateReport(): void {
    const bar = this.mdi?.el.querySelector<HTMLElement>('.mh-toolbar')
    if (!bar) return
    const isReport = !!this.selected && this.windowPaths.get(this.selected)?.[0] === 'Reports'
    let back = bar.querySelector<HTMLButtonElement>(':scope > .ds-rep-back')
    let pill = bar.querySelector<HTMLElement>(':scope > .ds-rep-pill')
    if (!isReport) { back?.remove(); pill?.remove(); return }
    // the report's criteria dialog docks just under this header
    document.documentElement.style.setProperty('--ds-report-top', `${Math.round(bar.getBoundingClientRect().bottom + 8)}px`)
    if (!back) {
      back = document.createElement('button')
      back.type = 'button'
      back.className = 'tb ds-rep-back'
      back.innerHTML = '<svg class="mh-i" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg><span class="mh-label">All reports</span>'
      back.addEventListener('click', () => this.openPage('reports'))
      bar.prepend(back)
    }
    if (!pill) {
      pill = document.createElement('span')
      pill.className = 'ds-rep-pill'
      pill.textContent = 'Preview'
      bar.querySelector(':scope > .mh-title')?.after(pill)
    }
  }

  /** Approved design: entry windows switch between Detail and List with one toolbar button (the tab strip is not drawn).  On the
   * Detail page it is the window's own List command; on the List page it shows Detail and selects the original Detail tab. */
  private decorateListToggle(root: HTMLElement): void {
    const tabs = root.querySelector<HTMLElement>('.entry-tabs')
    const strip = tabs?.querySelector<HTMLElement>(':scope > .strip')
    const button = [...this.mdi?.el.querySelectorAll<HTMLButtonElement>('.mh-toolbar button[data-stock="find!"]') ?? []].find((b) => b.offsetParent)
    if (!tabs || !strip || !button) { tabs?.classList.remove('ds-tabs-in-toolbar'); return }
    tabs.classList.add('ds-tabs-in-toolbar')
    const pages = [...tabs.querySelectorAll<HTMLElement>(':scope > .page')]
    const onList = pages.length === 2 && !pages[1].hidden && pages[1].offsetParent !== null
    const label = button.querySelector<HTMLElement>('.mh-label')
    const text = onList ? 'Detail' : 'List'
    if (label && label.textContent !== text) label.textContent = text
    button.setAttribute('aria-label', onList ? 'Detail view' : (button.dataset.label || 'List View').split('	')[0])
    button.classList.toggle('ds-on-list', onList)
    if (!button.dataset.dsToggle) {
      button.dataset.dsToggle = '1'
      button.addEventListener('click', (event) => {
        if (!button.classList.contains('ds-on-list')) return
        event.preventDefault()
        event.stopImmediatePropagation()
        const detail = root.querySelector<HTMLElement>('.entry-tabs > .strip > :first-child')
        detail?.click()
        setTimeout(() => this.decorateActive(), 50)
      }, true)
    }
  }

  private setHomeContext(slot: number, text: string): void {
    if (this.homeContext[slot] === text) return
    this.homeContext[slot] = text
    const span = this.homeHost?.querySelector('.ds-hello .ds-ctx')
    if (span) span.textContent = this.homeContext.filter(Boolean).map((part) => ` · ${part}`).join('')
  }

  private pageTitle(): string { return this.page === 'home' ? 'Home' : PAGES[this.page].title }

  /** Opens (or returns to) the Reports or Items page tab. */
  private openPage(page: Page): void {
    if (this.hasModal() || !this.homeTab) return
    if (!this.pageTabs.has(page)) {
      const container = document.createElement('div')
      container.className = 'presentation-tab ds-fresh'
      container.setAttribute('role', 'presentation')
      const tab = document.createElement('button')
      tab.type = 'button'
      tab.id = `workspace-${page}-tab`
      tab.setAttribute('role', 'tab')
      tab.setAttribute('aria-controls', 'workspace-home')
      const title = PAGES[page].title
      tab.innerHTML = `<svg class="ds-tab-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${HOME_ICONS[PAGES[page].icon]}</svg>${title}`
      tab.onclick = () => this.openPage(page)
      const close = document.createElement('button')
      close.type = 'button'
      close.textContent = '\u00d7'
      close.setAttribute('aria-label', `Close ${title}`)
      close.onclick = (event) => {
        event.stopPropagation()
        container.remove()
        this.pageTabs.delete(page)
        if (this.page === page) { this.page = 'home'; this.homeRendered = false }
        this.updateTabs()
      }
      container.append(tab, close)
      ;([...this.pageTabs.values()].at(-1) ?? this.homeTab).after(container)
      this.pageTabs.set(page, container)
      setTimeout(() => container.classList.remove('ds-fresh'), 700)
    }
    if (this.page !== page) this.homeRendered = false
    this.page = page
    this.homeActive = true
    this.updateTabs()
    this.pageTabs.get(page)?.querySelector<HTMLElement>('[role=tab]')?.focus()
  }

  private async showPage(): Promise<void> {
    const host = this.homeHost
    if (!host) return
    if (this.page === 'home') {
      if (host.dataset.page !== 'home') { host.dataset.page = 'home'; host.onclick = null; host.onkeydown = null; this.homeRendered = false }
      return this.showHome()
    }
    if (this.page === 'reports') {
      // Drawn again only when the menu (rights) changed: a redraw between mousedown and click would swallow the click.
      const entries = this.reportEntries()
      const signature = entries.map((entry) => `${entry.group}/${entry.label}/${entry.disabled}`).join('|')
      if (host.dataset.page !== 'reports' || host.dataset.signature !== signature || !host.querySelector('.ds-rep-grid')) {
        host.dataset.page = 'reports'
        host.dataset.signature = signature
        renderReports(host, entries, this.reportState)
      }
      return
    }
    const query = this.pageQuery()
    if (this.page === 'users') return this.showUsers(host, query)
    const draw = () => { if (this.page === 'items' && this.homeActive) renderItems(host, this.itemsState, () => { this.itemsLoaded = false; void this.showPage() }, (row) => void this.openItem(row)) }
    if (host.dataset.page !== 'items') { host.dataset.page = 'items'; draw() }
    if (!query) { host.innerHTML = '<div class="ds-home"><p class="ds-empty">Items are shown once the database session is ready.</p></div>'; return }
    if (this.itemsLoaded) return
    this.itemsLoaded = true
    try {
      await loadItems(query, this.itemsState)
      draw()
    } catch (error) {
      console.warn('Items could not be read.', error)
      this.itemsLoaded = false
      host.innerHTML = '<div class="ds-home"><p class="ds-empty">The items could not be read from the database. Use Refresh to try again.</p></div>'
    }
  }

  /** Users & rights page: the accounts and their groups' rights, read from the database. */
  private async showUsers(host: HTMLElement, query: ((sql: string, params?: unknown[]) => Promise<unknown[][]>) | null): Promise<void> {
    const command = (pattern: RegExp) => { const root = this.commandRoot(); return root ? menuCommands(root).find((item) => pattern.test(item.label.replace(/\s*\.{3,}\s*/g, ' '))) : undefined }
    const users = command(/^Manage \/ Users$/i), groups = command(/^Manage \/ Groups$/i)
    const draw = () => {
      if (this.page !== 'users' || !this.homeActive) return
      renderUsers(host, this.usersState, {
        addUser: users ? () => void this.runCommand(users) : null,
        editUsers: users ? () => void this.runCommand(users) : null,
        editRights: groups ? () => void this.runCommand(groups) : null,
        select: (code) => { this.usersState.selected = code; draw(); if (query) void loadRights(query, this.usersState).then(draw).catch(() => {}) },
      })
    }
    if (host.dataset.page !== 'users') { host.dataset.page = 'users'; draw() }
    if (!query) { host.innerHTML = '<div class="ds-home"><p class="ds-empty">Users are shown once the database session is ready.</p></div>'; return }
    if (this.usersState.loaded) return
    try {
      await loadUsers(query, this.usersState, parseFrameTitle(this.mdi?.ttlEl?.textContent || '').user ?? '')
      draw()
      await loadRights(query, this.usersState)
      draw()
    } catch (error) {
      console.warn('Users could not be read.', error)
      this.usersState.loaded = false
      host.innerHTML = '<div class="ds-home"><p class="ds-empty">The users could not be read from the database. Use Refresh to try again.</p></div>'
    }
  }

  private pageQuery(): ((sql: string, params?: unknown[]) => Promise<unknown[][]>) | null {
    const transaction = this.rt.globals.get('sqlca') as { db?: { query(sql: string, params: unknown[]): Promise<{ rows: unknown[][] }> } } | undefined
    const db = transaction?.db
    return db ? async (sql, params = []) => (await db.query(sql, params)).rows : null
  }

  /** The live Reports menu as the catalogue: each card runs the original menu item (rights as the menu bar shows them). */
  private reportEntries(): ReportEntry[] {
    const root = this.commandRoot()
    const all = root ? menuCommands(root, { includeDisabled: true }) : []
    const clean = (part: string) => part.replace(/\s*\.{3,}\s*/g, ' ').trim()
    return all.filter((command) => /^Reports \/ /i.test(command.label)).map((command) => {
      const parts = command.label.split(' / ').map(clean)
      return { group: parts.length > 2 ? parts[1] : 'General', label: parts.slice(parts.length > 2 ? 2 : 1).join(' › '), disabled: !!command.disabled, run: () => void this.runCommand(command) }
    })
  }

  private itemFormCommand(): (() => void) | null {
    const root = this.commandRoot()
    const command = root ? menuCommands(root).find((item) => /^Basic Data \/ Item ?\/ Item$/i.test(item.label.replace(/\s*\.{3,}\s*/g, ' '))) : undefined
    return command ? () => void this.runCommand(command) : null
  }

  /** The search palette's item result: the Items page with that item's card open. */
  private async openItemByCode(code: number): Promise<void> {
    const query = this.pageQuery()
    if (!query) return
    this.openPage('items')
    const row = await loadItem(query, code).catch(() => null)
    if (row) await this.openItem(row)
  }

  private async openItem(row: ItemsState['rows'][number]): Promise<void> {
    const query = this.pageQuery()
    if (!query || !this.shell) return
    await openItemDrawer(this.shell, row, query, this.itemsState.anchor, this.itemFormCommand())
  }

  private selectHome(): void {
    if (this.hasModal()) return
    if (this.page !== 'home') { this.page = 'home'; this.homeRendered = false }
    this.homeActive = true
    this.updateTabs()
    this.homeTab?.querySelector<HTMLElement>('[role=tab]')?.focus()
  }

  /** Quick actions run the live menu items (greyed when the menu does not offer them to this user). */
  private homeActions(): HomeAction[] {
    const root = this.commandRoot()
    const all = root ? menuCommands(root, { includeDisabled: true }) : []
    const find = (pattern: RegExp) => all.find((command) => pattern.test(command.label.replace(/\s*\.{3,}\s*/g, ' ')))
    const action = (label: string, hint: string, icon: string, pattern: RegExp): HomeAction => {
      const command = find(pattern)
      return { label, hint: command?.shortcut || hint, icon, disabled: !command || !!command.disabled, run: () => { if (command && !command.disabled) void this.runCommand(command) } }
    }
    return [
      action('New sale', 'Sales › Cash Sale', 'cart', /^Sales \/ Cash ?Sale$/i),
      action('Pack purchase', 'Purchase › Purchases', 'truck', /^Purchase \/ Purchases$/i),
      { ...action('Items', 'Stock, prices, expiry', 'box', /^Basic Data \/ Item ?\/ Item$/i), run: () => this.openPage('items') },
      { ...action('Reports', 'Daily, stock, sales', 'chart', /^Reports \/ /i), run: () => this.openPage('reports') },
      { ...action('Users', 'Users & rights', 'users', /^Manage \/ (Users|Groups)$/i), run: () => this.openPage('users') },
      { label: 'Settings', hint: 'Theme, size, print', icon: 'gear', run: () => this.openSettings() },
    ]
  }

  private async runCommand(command: ReturnType<typeof menuCommands>[number]): Promise<void> {
    const root = this.commandRoot()
    if (this.executing || this.hasModal() || !root) return
    this.pendingPath = { path: command.label.split(' / ').slice(0, -1).map((part) => part.replace(/\s*\.{3,}\s*/g, '').trim()).filter(Boolean), at: Date.now() }
    this.executing = true
    try {
      if (!(await executeMenuCommand(this.rt, root, command))) {
        await this.messageBox('Command unavailable', 'This command is no longer available in the active workspace.', 'information!', 'ok!', 1)
      }
    } catch (error) {
      this.rt.onError(error)
    } finally {
      this.executing = false
      this.refreshCommands()
    }
  }

  private async showHome(force = false): Promise<void> {
    const host = this.homeHost
    if (!host) return
    const user = parseFrameTitle(this.mdi?.ttlEl?.textContent || String(this.mdi?.w.props.get('title') ?? '')).user || 'there'
    const draw = (animate: boolean) => {
      if (!this.homeData) { host.innerHTML = '<div class="ds-home"><p class="ds-empty">Loading figures…</p></div>'; return }
      renderHome(host, this.homeData, user, () => this.homeActions(), () => this.openPage('reports'), animate, this.homeContext)
      this.homeRendered = true
    }
    const stale = Date.now() - this.homeLoaded > 5 * 60_000
    if (!this.homeData || stale || force) {
      if (!this.homeData) draw(false)
      const transaction = this.rt.globals.get('sqlca') as { db?: { query(sql: string, params: unknown[]): Promise<{ rows: unknown[][] }> } } | undefined
      if (!transaction?.db) { host.innerHTML = '<div class="ds-home"><p class="ds-empty">Figures are shown once the database session is ready.</p></div>'; return }
      this.homeLoaded = Date.now()
      try {
        this.homeData = await loadHome(async (sql) => (await transaction.db!.query(sql, [])).rows)
        void saveLoginFigures(async (sql) => (await transaction.db!.query(sql, [])).rows)
        draw(true)
        this.header?.refresh()
      } catch (error) {
        console.warn('Home figures could not be read.', error)
        host.innerHTML = '<div class="ds-home"><p class="ds-empty">The figures could not be read from the database. Use Refresh to try again.</p></div>'
      }
    } else if (!this.homeRendered || !host.firstElementChild) draw(false)
  }

  private buildSettings(): HTMLDialogElement {
    const dialog = document.createElement('dialog')
    dialog.className = 'presentation-settings'
    dialog.setAttribute('aria-labelledby', 'appearance-title')
    const card = (key: string, title: string, hint: string, body: string, c1: string, c2: string) =>
      `<button type="button" class="ds-tcard" data-theme-card="${key}" aria-pressed="false"><span class="ds-tprev" aria-hidden="true"><span class="h"></span><span class="b" style="background:${body}"><i style="background:${c1}"></i><i style="background:${c2}"></i><i style="background:${c2}"></i><i style="background:${c1}"></i></span></span><b>${title}</b><span class="ds-help">${hint}</span></button>`
    const seg = (name: string, label: string, options: [string, string][]) =>
      `<span class="ds-seg" role="group" aria-label="${label}">${options.map(([value, text]) => `<button type="button" data-seg="${name}" data-value="${value}" aria-pressed="false">${text}</button>`).join('')}</span>`
    // Approved design: the Preferences page of the mockup.  The named selects stay the form's values (kept for keyboard users
    // and saved exactly as before); the cards, segments and switch set them.
    dialog.innerHTML = `<form><div class="ds-set-head"><h2 id="appearance-title">Appearance</h2><span class="ds-help">Applies to this workstation, application user and database</span></div>
      <section class="ds-set-card"><div class="ds-theme-cards" role="group" aria-label="Theme">${card('light', 'Light', 'Bright rooms, daytime', '#f3f5f7', '#ffffff', '#e1f0ef')}${card('dark', 'Dark', 'Low light, less glare', '#0f1418', '#161d23', '#163331')}${card('system', 'Match Windows', 'Follows the PC setting', 'linear-gradient(90deg,#f3f5f7 50%,#0f1418 50%)', '#c9d3dc', '#4fb8b2')}</div>
      <div class="ds-set-row"><div><b>Text size</b><p>Bigger text for counters and older screens.</p></div>${seg('textSize', 'Text size', [['100', '100%'], ['125', '125%'], ['150', '150%'], ['175', '175%'], ['200', '200%']])}</div>
      <div class="ds-set-row"><div><b>Density</b><p>Compact fits more rows; comfortable gives bigger targets.</p></div>${seg('density', 'Density', [['compact', 'Compact'], ['comfortable', 'Comfortable']])}</div>
      <div class="ds-set-row"><div><b>Animations</b><p>Turn off motion if it is distracting. Windows' "reduce motion" setting is always respected.</p></div><button class="ds-switch" type="button" role="switch" aria-checked="true" aria-label="Animations" data-motion></button></div>
      <div class="ds-set-row"><div><b>Interface</b><p>Classic keeps the original look; Modern is this design. Applies at next sign-in.</p></div>${seg('mode', 'Interface', [['classic', 'Classic'], ['modern', 'Modern']])}</div>
      <div class="ds-set-row"><div><b id="appearance-print-label">Print layout</b><p id="appearance-print-help">Modern is available only for listed previews or approved templates. Other documents print Classic.</p></div><select name="printMode" aria-labelledby="appearance-print-label" aria-describedby="appearance-print-help"><option value="classic">Classic</option><option value="modern">Modern</option></select></div>
      <details class="ds-set-more"><summary>Document layouts</summary><fieldset class="presentation-print-families"><legend class="ds-sr">Document layouts</legend>
        <p id="appearance-family-help">Default follows Print layout above. Choose Classic or Modern to override it for one document family. Preview templates are synthetic-checked only and are not approved for official documents.</p>
        <div class="print-family-list"></div>
      </fieldset></details>
      <div class="ds-sr"><label><span id="appearance-mode-label">Next sign-in interface</span><select name="mode" aria-labelledby="appearance-mode-label" tabindex="-1"><option value="modern">Modern</option><option value="classic">Classic</option></select></label>
      <label><span id="appearance-theme-label">Theme</span><select name="theme" aria-labelledby="appearance-theme-label" tabindex="-1"><option value="system">Windows preference</option><option value="light">Light</option><option value="dark">Dark</option></select></label>
      <label><span id="appearance-density-label">Density</span><select name="density" aria-labelledby="appearance-density-label" tabindex="-1"><option value="compact">Compact</option><option value="comfortable">Comfortable</option></select></label>
      <label><span id="appearance-size-label">Text size</span><select name="textSize" aria-labelledby="appearance-size-label" tabindex="-1"><option value="100">100%</option><option value="125">125%</option><option value="150">150%</option><option value="175">175%</option><option value="200">200%</option></select></label></div></section>
      <section class="ds-set-card ds-set-data"><h3>Data &amp; safety</h3>
        <div class="ds-set-row" data-cmd-row="backup" hidden><div><b>Back up the database</b><p>Runs the application's own backup.</p></div><button type="button" data-run="backup">Back up now</button></div>
        <div class="ds-set-row" data-cmd-row="lasttx" hidden><div><b>Last transaction date</b><p>Changing it is in Maintenance › Modify Last Transaction Date.</p></div><button type="button" data-run="lasttx">Open</button></div>
        <p class="ds-help" data-cmd-none>Backup and the last transaction date are in the Maintenance menu.</p></section>
      <p class="presentation-error" role="alert" hidden></p><footer><button type="button" class="ds-restore" data-restore>Restore defaults</button><button type="button">Cancel</button><button type="submit">Save settings</button></footer></form>`
    const form = () => dialog.querySelector('form')!
    const sync = () => {
      const value = (name: string) => form().querySelector<HTMLSelectElement>(`select[name="${name}"]`)!.value
      for (const button of dialog.querySelectorAll<HTMLElement>('[data-theme-card]')) button.setAttribute('aria-pressed', String(button.dataset.themeCard === value('theme')))
      for (const button of dialog.querySelectorAll<HTMLElement>('[data-seg]')) button.setAttribute('aria-pressed', String(button.dataset.value === value(button.dataset.seg!)))
      dialog.querySelector('[data-motion]')!.setAttribute('aria-checked', String(!motionOff()))
    }
    dialog.addEventListener('click', (event) => {
      const target = event.target as HTMLElement
      const set = (name: string, value: string) => { const select = form().querySelector<HTMLSelectElement>(`select[name="${name}"]`)!; if (![...select.options].some((o) => o.value === value)) select.add(new Option(value, value)); select.value = value; sync() }
      const theme = target.closest<HTMLElement>('[data-theme-card]')
      if (theme) set('theme', theme.dataset.themeCard!)
      const segment = target.closest<HTMLElement>('[data-seg]')
      if (segment) set(segment.dataset.seg!, segment.dataset.value!)
      const motion = target.closest<HTMLElement>('[data-motion]')
      if (motion) motion.setAttribute('aria-checked', String(motion.getAttribute('aria-checked') !== 'true'))
      // Restore defaults of the approved design: theme, density and text size go back to the defaults and animations on (saved with Save)
      if (target.closest('[data-restore]')) {
        for (const key of ['theme', 'density', 'textSize'] as const) set(key, String(DEFAULT_UI_PREFERENCES[key]))
        dialog.querySelector('[data-motion]')!.setAttribute('aria-checked', 'true')
        toast('Default appearance restored · Save settings to keep it', 'undo')
      }
      const run = target.closest<HTMLElement>('[data-run]')
      if (run) { const command = this.settingsCommand(run.dataset.run!); if (command) { dialog.close(); void this.runCommand(command) } }
    })
    dialog.addEventListener('ds-sync', sync)
    dialog.querySelector('footer button[type=button]:not([data-restore])')!.addEventListener('click', () => dialog.close())
    containDialogFocus(dialog)
    dialog.querySelector('form')!.addEventListener('submit', (event) => {
      event.preventDefault()
      const error = dialog.querySelector<HTMLElement>('.presentation-error')!
      try {
        const values = new FormData(dialog.querySelector('form')!)
        const printFamilyValues: Record<string, InterfaceMode> = { ...this.session.preferences.printFamilies }
        for (const select of dialog.querySelectorAll<HTMLSelectElement>('select[name^="printFamily:"]')) {
          const family = select.name.slice('printFamily:'.length)
          if (select.value === '') delete printFamilyValues[family]
          else if (select.value === 'classic' || select.value === 'modern') printFamilyValues[family] = select.value
          else throw new Error('Choose a supported document layout before saving settings.')
        }
        const preferences = validatePreferences({
          version: 1, mode: values.get('mode'), theme: values.get('theme'), density: values.get('density'),
          textSize: Number(values.get('textSize')), printMode: values.get('printMode'), printFamilies: printFamilyValues,
        })
        this.session.save(preferences)
        setMotion(dialog.querySelector('[data-motion]')!.getAttribute('aria-checked') !== 'true')
        this.applyAppearance(true)
        dialog.close()
      } catch (cause) {
        error.hidden = false
        error.textContent = cause instanceof Error ? cause.message : 'Settings could not be saved.'
      }
    })
    document.body.append(dialog)
    return dialog
  }

  openSettings(): void {
    if (this.settings.open || this.hasModal()) return
    this.down.clear()
    for (const [key, value] of Object.entries(this.session.preferences)) {
      const select = this.settings.querySelector<HTMLSelectElement>(`select[name="${key}"]`)
      if (select) {
        if (![...select.options].some((option) => option.value === String(value))) select.add(new Option(`${value}%`, String(value)))
        select.value = String(value)
      }
    }
    this.renderPrintFamilies()
    this.settings.querySelector<HTMLElement>('.presentation-error')!.hidden = true
    let any = false
    for (const row of this.settings.querySelectorAll<HTMLElement>('[data-cmd-row]')) { row.hidden = !this.settingsCommand(row.dataset.cmdRow!); any ||= !row.hidden }
    this.settings.querySelector<HTMLElement>('[data-cmd-none]')!.hidden = any
    this.settings.dispatchEvent(new Event('ds-sync'))
    this.settings.showModal()
  }

  /** Menu items the Preferences page links to (shown only when the menu offers them to this user). */
  private settingsCommand(key: string): ReturnType<typeof menuCommands>[number] | undefined {
    const root = this.commandRoot()
    const pattern = key === 'backup' ? /\bback ?up\b/i : /last transaction date/i
    return root ? menuCommands(root).find((command) => pattern.test(command.label)) : undefined
  }

  private renderPrintFamilies(): void {
    const host = this.settings.querySelector<HTMLElement>('.print-family-list')!
    host.replaceChildren()
    for (const family of printFamilies()) {
      const row = document.createElement('div')
      row.className = 'print-family'
      const label = document.createElement('label')
      label.textContent = family.label
      label.htmlFor = `appearance-family-${family.id}`
      const select = document.createElement('select')
      select.id = label.htmlFor
      select.name = `printFamily:${family.id}`
      select.setAttribute('aria-describedby', 'appearance-family-help')
      select.append(new Option('Default', ''), new Option('Classic', 'classic'))
      const modern = new Option('Modern', 'modern')
      modern.disabled = family.status === 'blocked'
      select.append(modern)
      select.value = this.session.preferences.printFamilies[family.id] ?? ''
      row.append(label, select)
      if (family.status !== 'approved') {
        const note = document.createElement('p')
        note.id = `${select.id}-availability`
        note.textContent = family.status === 'blocked'
          ? `Not available: ${family.blockedReason || 'the template is blocked.'}`
          : 'Preview only; requires document-level approval before official use.'
        select.setAttribute('aria-describedby', `appearance-family-help ${note.id}`)
        row.append(note)
      }
      host.append(row)
    }
  }

  private applyAppearance(retryNative = false): void {
    this.header?.refresh()
    for (const element of [this.shell, this.settings, ...this.dialogs]) {
      if (!element) continue
      this.styleAppearance(element)
    }
    for (const window of this.views.values()) for (const control of window.ctlViews.values()) {
      if (control.dw instanceof ModernDwView) { this.styleAppearance(control.dw.root); control.dw.schedule() }
    }
    for (const window of this.views.values()) if (window.el.matches('.modern-window,.modern-entry-window')) this.styleAppearance(window.el)
    const theme = nativeTheme(this.session.activeMode, this.session.preferences.theme)
    if (theme === this.lastNativeTheme && !retryNative) return
    this.lastNativeTheme = theme
    const revision = ++this.nativeRevision
    void this.nativeAppearance.set(theme).catch((error: unknown) => {
      if (this.cleanup.signal.aborted || revision !== this.nativeRevision) {
        console.warn('A superseded desktop appearance request failed.', error)
        return
      }
      this.rt.onError(new Error('The desktop window theme could not be applied. Your workspace remains usable. Save Appearance settings again to retry.', { cause: error }))
    })
  }

  private styleAppearance(element: HTMLElement): void {
    const preferences = this.session.preferences
    element.dataset.theme = preferences.theme === 'system' ? this.systemTheme.matches ? 'dark' : 'light' : preferences.theme
    element.dataset.density = preferences.density
    element.classList.toggle('ds-no-motion', motionOff())
    element.style.setProperty('--p-scale', String(preferences.textSize / 100))
  }

  override print(control: NDwBase): Promise<boolean> {
    const definition = control.model?.name
    const template = printTemplateFor(definition)
    const requested = template ? this.session.printModeFor(template.family) : this.session.preferences.printMode
    // Preview templates belong to the opt-in Modern workspace only; a Classic-interface session prints approved templates or Classic.
    const resolved = resolvePrintPresentation(definition, requested, { preview: this.session.activeMode === 'modern' })
    if (resolved.presentation === 'modern') return printDw(control, { presentation: 'modern' })
    // A document without a usable Modern template prints exactly as in Classic: the print call never fails because of the layout
    // preference (a failed print would stop the rest of the script), and the user is told which layout was used.
    if (requested === 'modern') {
      const reason = (resolved.notice || `No Modern template is registered for ${definition || 'this document'}.`)
        .replace(/\s*Select Classic print layout\.?\s*$/, '')
      this.notify(`${reason} Printed with the Classic layout.`)
    }
    return super.print(control)
  }

  /** A non-blocking notice: the command status line of the Modern workspace, or the console in the Classic interface. */
  private notify(text: string): void {
    const status = this.shell?.querySelector<HTMLElement>('.command-status')
    if (status) { status.textContent = text; toast(text, 'print') }
    else console.warn(text)
  }

  private async present<T>(dialog: PresentationDialog<T>): Promise<T> {
    const focus = document.activeElement
    this.dialogs.add(dialog.element)
    this.down.clear()
    this.applyAppearance()
    this.updateTabs()
    this.refreshCommands()
    try {
      dialog.open()
      return await dialog.result
    } finally {
      this.dialogs.delete(dialog.element)
      this.updateTabs()
      this.refreshCommands()
      if (dialog.restoreFocus !== false && !this.dialogs.size && !this.settings.open) this.restoreFocus(focus)
    }
  }

  override messageBox(title: string, text: string, icon: string, buttons: string, defaultButton: number): Promise<number> {
    if (this.session.activeMode === 'classic') return super.messageBox(title, text, icon, buttons, defaultButton)
    return this.present(messageDialog(title, text, icon, buttons, defaultButton))
  }

  override prompt(title: string, text: string, initial: string): Promise<string | null> {
    if (this.session.activeMode === 'classic') return super.prompt(title, text, initial)
    return this.present(promptDialog(title, text, initial))
  }

  override saveAs(control: NDwBase, file: string, type: string, headers: boolean): Promise<boolean> {
    if (/^pdf!?$/i.test(type) && !file) return this.print(control)
    return super.saveAs(control, file, type, headers)
  }

  override printText(text: string): Promise<boolean> {
    // Plain-text print jobs are machine-consumed output, not a styled document
    // family.  They keep the existing Classic/plain path regardless of layout.
    return super.printText(text)
  }

  override dispose(): void {
    if (this.dialogs.size || this.modalWindows.size) throw new Error('Cannot replace presentation while a runtime dialog is open.')
    super.dispose()
    this.cleanup.abort()
    this.settings.close()
    this.settings.remove()
    this.presentationStyle.remove()
    this.header?.dispose()
    if (this.shell) {
      this.shell.before(this.desktop)
      this.shell.remove()
    }
  }
}

/** Icon of a window tab by the menu it was opened from (approved design). */
function moduleIcon(module: string): string {
  const m = module.toLowerCase()
  return m.startsWith('purchase') ? 'truck' : m.startsWith('sale') ? 'cart' : m.startsWith('report') ? 'chart' : m.startsWith('basic') || m.startsWith('item') ? 'box'
    : m.startsWith('manage') ? 'users' : m.startsWith('maint') ? 'gear' : 'doc'
}

type Page = 'reports' | 'items' | 'users'
/** The approved design's pages beside Home: title, tab icon and the menu they belong to (breadcrumbs). */
const PAGES: Record<Page, { title: string; icon: string; path: string }> = {
  reports: { title: 'Reports', icon: 'chart', path: 'Reports' },
  items: { title: 'Item', icon: 'box', path: 'Basic Data' },
  users: { title: 'Users & rights', icon: 'users', path: 'Manage' },
}
