import { DomUi } from './dom-ui.ts'
import type { Runtime } from '../runtime/interp.ts'
import { NWindow } from '../runtime/native/controls.ts'
import { PBObject } from '../runtime/object.ts'
import type { NDwBase } from '../runtime/native/dwctrl.ts'
import type { InterfaceMode, PresentationSession } from '../app/ui-preferences.ts'
import { validatePreferences } from '../app/ui-preferences.ts'
import { printDw } from './print.ts'
import { readableText } from './pb.ts'
import { printFamilies, printTemplateFor, resolvePrintPresentation } from './print-templates.ts'
import { menuCommands, menuModules, executeMenuCommand } from './menu-commands.ts'
import { PRESENTATION_CSS } from './presentation-styles.ts'
import { containDialogFocus, messageDialog, promptDialog } from './presentation-dialogs.ts'
import type { PresentationDialog } from './presentation-dialogs.ts'
import { ModernDwView } from './modern-dwview.ts'
import type { DwView } from './dwview.ts'
import { applyModernWindow } from './modern-window.ts'
import { applyModernEntryWindow } from './modern-entry-window.ts'
import { nativeAppearance, nativeTheme } from './native-appearance.ts'
import type { NativeAppearance, NativeTheme } from './native-appearance.ts'

/** Incremental Modern shell; business screens stay explicitly labelled compatibility views until migrated. */
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

  constructor(rt: Runtime, desktop: HTMLElement, session: PresentationSession, appearance: NativeAppearance = nativeAppearance) {
    super(rt, desktop)
    this.session = session
    this.nativeAppearance = appearance
    this.presentationStyle = document.createElement('style')
    this.presentationStyle.textContent = PRESENTATION_CSS
    document.head.append(this.presentationStyle)
    this.settings = this.buildSettings()
    if (session.activeMode === 'modern') {
      this.shell = document.createElement('section')
      this.shell.className = 'presentation-ui'
      this.shell.setAttribute('aria-label', 'Modern workspace preview')
      this.shell.innerHTML = `<header class="presentation-header"><strong>Waseela Trader</strong><span>Modern workspace preview</span><button class="presentation-action" type="button">Appearance</button></header>
        <aside class="presentation-sidebar"><label>Find a command<input type="search" autocomplete="off"></label><p class="command-status" role="status"></p><div class="presentation-commands"></div></aside>
        <section class="presentation-work"><div class="presentation-tabs" role="tablist" aria-label="Open workspaces"></div><p class="presentation-compatibility">Classic compatibility layouts / Modern screen migration is in progress</p><div class="presentation-stage"></div></section>`
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
      this.shell.querySelector('button')!.addEventListener('click', () => this.openSettings())
    }
    this.systemTheme.addEventListener('change', () => this.applyAppearance(), { signal: this.cleanup.signal })
    desktop.addEventListener('focusin', (event) => {
      if (this.selected && event.target instanceof HTMLElement && this.views.get(this.selected)?.el.contains(event.target)) {
        this.lastFocus.set(this.selected, event.target)
      }
    }, { signal: this.cleanup.signal })
    this.applyAppearance()
    this.refreshCommands()
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

  override menuRendered(bar: HTMLElement): void {
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
    const modernWindow = applyModernWindow(view) || applyModernEntryWindow(view)
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
    if (this.tabs.has(window)) this.selected = window
    this.updateTabs()
    this.refreshCommands()
  }

  private updateTabs(): void {
    const modal = this.hasModal()
    for (const [window, controls] of this.tabs) {
      const active = window === this.selected
      controls.tab.textContent = String(window.props.get('title') || window.name)
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

  private buildSettings(): HTMLDialogElement {
    const dialog = document.createElement('dialog')
    dialog.className = 'presentation-settings'
    dialog.setAttribute('aria-labelledby', 'appearance-title')
    dialog.innerHTML = `<form><h2 id="appearance-title">Appearance</h2>
      <p>Settings belong to this workstation, application user and database. Interface changes apply at the next sign-in.</p>
      <label><span id="appearance-mode-label">Next sign-in interface</span><select name="mode" aria-labelledby="appearance-mode-label"><option value="modern">Modern</option><option value="classic">Classic</option></select></label>
      <label><span id="appearance-theme-label">Theme</span><select name="theme" aria-labelledby="appearance-theme-label"><option value="system">Windows preference</option><option value="light">Light</option><option value="dark">Dark</option></select></label>
      <label><span id="appearance-density-label">Density</span><select name="density" aria-labelledby="appearance-density-label"><option value="compact">Compact</option><option value="comfortable">Comfortable</option></select></label>
      <label><span id="appearance-size-label">Text size</span><select name="textSize" aria-labelledby="appearance-size-label"><option value="100">100%</option><option value="125">125%</option><option value="150">150%</option><option value="175">175%</option><option value="200">200%</option></select></label>
      <label><span id="appearance-print-label">Print layout</span><select name="printMode" aria-labelledby="appearance-print-label" aria-describedby="appearance-print-help"><option value="classic">Classic</option><option value="modern">Modern</option></select></label>
      <p id="appearance-print-help">Modern is available only for listed previews or approved templates. Other documents require Classic.</p>
      <fieldset class="presentation-print-families"><legend>Document layouts</legend>
        <p id="appearance-family-help">Default follows Print layout above. Choose Classic or Modern to override it for one document family. Preview templates are synthetic-checked only and are not approved for official documents.</p>
        <div class="print-family-list"></div>
      </fieldset>
      <p>Theme, density and text size apply to the Modern workspace. Compatibility forms and Classic printing retain their original presentation.</p>
      <p class="presentation-error" role="alert" hidden></p><footer><button type="button">Cancel</button><button type="submit">Save settings</button></footer></form>`
    dialog.querySelector('button[type=button]')!.addEventListener('click', () => dialog.close())
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
    this.settings.showModal()
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
    if (status) status.textContent = text
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
    if (this.shell) {
      this.shell.before(this.desktop)
      this.shell.remove()
    }
  }
}
