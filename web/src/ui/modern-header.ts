// Modern workspace header (approved parity exception, 2026-11-11; see docs/HANDOFF.md "Approved parity exceptions").
// Context bar (company, period, user, clock, search, theme), a grouped command bar built from the live frame toolbar, and a search
// palette over the live menu.  Every action runs the real menu item or window through the host; nothing here holds business logic.
import type { MenuCommand } from './menu-commands.ts'

export type ThemeChoice = 'system' | 'light' | 'dark'

export interface HeaderHost {
  /** Live menu commands of the active workspace (disabled ones included, shown greyed). */
  commands(): MenuCommand[]
  run(command: MenuCommand): Promise<void>
  windows(): { title: string; active: boolean; activate(): void }[]
  frameTitle(): string
  windowTitle(): string
  theme(): ThemeChoice
  setTheme(theme: ThemeChoice): void
  openSettings(): void
  busy(): boolean
}

export interface FrameTitle { company: string; period?: string; user?: string; raw: string }

/** The frame title the application script builds: "WASEELA  ABUZAR V2 01.01.2022 : ADMIN : 11/11/26 02:25:13 - [Sheet]". */
export function parseFrameTitle(title: string): FrameTitle {
  const raw = title.replace(/\s+-\s+\[[^\]]*\]\s*$/, '').trim()
  const parts = raw.split(/\s+:\s+/)
  const first = parts[0] ?? ''
  const period = first.match(/(\d{1,2}[./-]\d{1,2}[./-]\d{2,4})\s*$/)?.[1]
  const company = (period ? first.slice(0, first.length - period.length) : first).replace(/\s+/g, ' ').trim()
  const user = parts.length > 2 ? parts[1].trim() : undefined
  return { company: company || raw, period, user: user || undefined, raw }
}

/** Toolbar groups by the stock picture of the menu item (the same pictures on every entry window of the original). */
export const TOOLBAR_GROUPS: readonly { key: string; label: string; stocks: readonly string[] }[] = [
  { key: 'record', label: 'Record', stocks: ['selectscript!', 'save!', 'clear!'] },
  { key: 'items', label: 'Items', stocks: ['update!', 'retrieve!', 'undo!'] },
  { key: 'browse', label: '', stocks: ['vcrfirst!', 'vcrprior!', 'vcrnext!', 'vcrlast!'] },
]
/** Buttons that keep a visible caption next to the icon. */
const LABELLED = new Set(['selectscript!', 'save!', 'update!', 'find!', 'print!', 'dbadmin!'])

export function toolbarGroup(stock: string): string {
  const key = stock.toLowerCase()
  return TOOLBAR_GROUPS.find((group) => group.stocks.includes(key))?.key ?? 'output'
}

const ICONS: Record<string, string> = {
  'selectscript!': '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M12 12v6M9 15h6"/>',
  'find!': '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  'save!': '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8M7 3v5h8"/>',
  'clear!': '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  'update!': '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M12 13v5M9.5 15.5h5"/>',
  'retrieve!': '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M9.5 15.5h5"/>',
  'undo!': '<path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>',
  'vcrfirst!': '<path d="m17 18-6-6 6-6M7 6v12"/>', 'vcrprior!': '<path d="m15 18-6-6 6-6"/>',
  'vcrnext!': '<path d="m9 18 6-6-6-6"/>', 'vcrlast!': '<path d="m7 18 6-6-6-6M17 6v12"/>',
  'print!': '<path d="M6 9V3h12v6M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="7"/>',
  'preview!': '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  'dbadmin!': '<path d="M20 6 9 17l-5-5"/>',
  'exit!': '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  'regenerate5!': '<path d="M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5"/>',
  'sort!': '<path d="M7 4v16M3 16l4 4 4-4M17 20V4M13 8l4-4 4 4"/>',
}
const svg = (body: string, size = 18) =>
  `<svg class="mh-i" width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`
const GLYPH = {
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  cal: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
  auto: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>',
  panel: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>',
  win: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18"/>',
  bolt: '<path d="M13 2 3 14h9l-1 8 10-12h-9z"/>',
}

/** Rebuilds the frame toolbar's buttons into labelled groups.  The buttons themselves (and their click handlers) are kept. */
export function groupToolbar(tool: HTMLElement, title = ''): void {
  const buttons = [...tool.querySelectorAll<HTMLButtonElement>('button.tb')]
  if (!buttons.length) return
  tool.classList.add('mh-toolbar')
  const groups = new Map<string, HTMLElement>()
  const group = (key: string) => {
    let element = groups.get(key)
    if (!element) {
      element = document.createElement('div')
      element.className = `mh-group mh-group-${key}`
      const label = TOOLBAR_GROUPS.find((item) => item.key === key)?.label
      if (label) {
        const caption = document.createElement('span')
        caption.className = 'mh-group-label'
        caption.textContent = label
        element.append(caption)
      }
      groups.set(key, element)
    }
    return element
  }
  for (const button of buttons) {
    const stock = (button.dataset.stock ?? '').toLowerCase()
    const text = button.dataset.label || button.title
    button.setAttribute('aria-label', text)
    if (ICONS[stock] && !button.querySelector('.mh-i')) {
      button.querySelector('.pic')?.remove()
      button.insertAdjacentHTML('afterbegin', svg(ICONS[stock]))
    }
    if (LABELLED.has(stock) && !button.querySelector('.mh-label')) {
      const label = document.createElement('span')
      label.className = 'mh-label'
      label.textContent = text
      button.append(label)
    }
    button.classList.toggle('mh-primary', stock === 'dbadmin!')
    button.classList.toggle('mh-danger', stock === 'clear!')
    group(stock === 'exit!' ? 'exit' : toolbarGroup(stock)).append(button)
  }
  const order = ['record', 'items', 'browse', 'output', 'exit']
  const spacer = document.createElement('span')
  spacer.className = 'mh-spacer'
  const heading = document.createElement('span')
  heading.className = 'mh-title'
  heading.textContent = title
  tool.replaceChildren(heading, ...order.flatMap((key) => key === 'output' ? [spacer, ...(groups.has(key) ? [groups.get(key)!] : [])] : groups.has(key) ? [groups.get(key)!] : []))
}

interface PaletteResult { kind: 'window' | 'command' | 'setting'; title: string; detail: string; disabled?: boolean; run(): void }

/** The context bar and the search palette. */
export class ModernHeader {
  readonly element: HTMLElement
  private host: HeaderHost
  private timer: ReturnType<typeof setInterval>
  private palette: HTMLDialogElement | null = null
  private popover: HTMLElement | null = null
  private abort = new AbortController()

  constructor(host: HeaderHost) {
    this.host = host
    const header = document.createElement('header')
    header.className = 'presentation-header mh-context'
    header.innerHTML = `
      <div class="mh-brand"><span class="mh-mark" aria-hidden="true">TA</span><span><b class="mh-company"></b><span class="mh-sub"></span></span></div>
      <nav class="mh-crumbs" aria-label="Location"><strong class="mh-where"></strong></nav>
      <span class="mh-fill"></span>
      <button type="button" class="mh-search" aria-haspopup="dialog">${svg(GLYPH.search)}<span>Search screens and commands…</span><kbd>Ctrl</kbd><kbd>K</kbd></button>
      <button type="button" class="mh-chip mh-period" hidden>${svg(GLYPH.cal, 14)}<span>Period from <b></b></span></button>
      <button type="button" class="mh-chip mh-clock" aria-label="Date and time"><span class="mh-dot" aria-hidden="true"></span><b></b></button>
      <div class="mh-theme" role="group" aria-label="Colour theme">
        <button type="button" data-theme-choice="light" aria-label="Light mode" title="Light mode">${svg(GLYPH.sun, 14)}</button>
        <button type="button" data-theme-choice="system" aria-label="Match Windows theme" title="Match Windows">${svg(GLYPH.auto, 14)}</button>
        <button type="button" data-theme-choice="dark" aria-label="Dark mode" title="Dark mode">${svg(GLYPH.moon, 14)}</button>
      </div>
      <button type="button" class="mh-icon mh-commands" aria-label="Show or hide all commands" title="All commands">${svg(GLYPH.panel, 16)}</button>
      <button type="button" class="mh-icon mh-appearance" aria-label="Appearance" title="Appearance">${svg(GLYPH.gear, 16)}</button>
      <button type="button" class="mh-user" aria-haspopup="menu"><span class="mh-avatar" aria-hidden="true"></span><span class="mh-user-name"></span>${svg(GLYPH.down, 14)}</button>`
    this.element = header
    const signal = this.abort.signal
    header.querySelector('.mh-search')!.addEventListener('click', () => this.openSearch())
    header.querySelector('.mh-appearance')!.addEventListener('click', () => host.openSettings())
    // The opening click must not reach the document's click-outside handler, which would close the popover at once.
    header.querySelector('.mh-period')!.addEventListener('click', (event) => { event.stopPropagation(); this.showPeriod(event.currentTarget as HTMLElement) })
    header.querySelector('.mh-user')!.addEventListener('click', (event) => { event.stopPropagation(); this.showUser(event.currentTarget as HTMLElement) })
    header.querySelector('.mh-clock')!.addEventListener('click', (event) => { event.stopPropagation(); this.showClock(event.currentTarget as HTMLElement) })
    for (const button of header.querySelectorAll<HTMLButtonElement>('[data-theme-choice]')) {
      button.addEventListener('click', () => { host.setTheme(button.dataset.themeChoice as ThemeChoice); this.refresh() })
    }
    document.addEventListener('keydown', (event) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.key.toLowerCase() !== 'k' || host.busy()) return
      // A menu item that owns Ctrl+K keeps it.
      if (host.commands().some((command) => /^ctrl\+k$/i.test(command.shortcut ?? ''))) return
      event.preventDefault()
      this.openSearch()
    }, { signal })
    document.addEventListener('click', (event) => {
      if (this.popover && !this.popover.contains(event.target as Node)) this.closePopover()
    }, { signal })
    this.timer = setInterval(() => this.refresh(), 30_000)
    this.refresh()
  }

  /** Collapses or shows the command panel; the host owns the panel. */
  onToggleCommands(handler: () => void): void {
    this.element.querySelector('.mh-commands')!.addEventListener('click', handler)
  }

  refresh(): void {
    const title = parseFrameTitle(this.host.frameTitle())
    const q = <T extends HTMLElement>(selector: string) => this.element.querySelector<T>(selector)!
    const [name, ...rest] = (title.company || 'Trader').split(' ')
    q('.mh-company').textContent = name
    q('.mh-sub').textContent = rest.join(' ')
    q('.mh-where').textContent = this.host.windowTitle()
    const period = q<HTMLButtonElement>('.mh-period')
    period.hidden = !title.period
    period.querySelector('b')!.textContent = title.period ?? ''
    q('.mh-user-name').textContent = title.user ?? 'User'
    q('.mh-avatar').textContent = (title.user ?? 'U').slice(0, 2).toUpperCase()
    const theme = this.host.theme()
    for (const button of this.element.querySelectorAll<HTMLButtonElement>('[data-theme-choice]')) {
      button.setAttribute('aria-pressed', String(button.dataset.themeChoice === theme))
    }
    this.refreshClock()
  }

  private refreshClock(): void {
    const now = new Date()
    this.element.querySelector('.mh-clock b')!.textContent =
      `${now.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })} · ${now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`
  }

  private closePopover(): void {
    this.popover?.remove()
    this.popover = null
  }

  private openPopover(anchor: HTMLElement, build: (box: HTMLElement) => void): void {
    this.closePopover()
    if (this.host.busy()) return
    const box = document.createElement('div')
    box.className = 'mh-popover'
    box.setAttribute('role', 'menu')
    build(box)
    this.element.append(box)
    const rect = anchor.getBoundingClientRect()
    box.style.top = `${rect.bottom + 6}px`
    box.style.left = `${Math.max(8, Math.min(rect.right - box.offsetWidth, innerWidth - box.offsetWidth - 8))}px`
    box.querySelector<HTMLElement>('button')?.focus()
    box.addEventListener('keydown', (event) => { if (event.key === 'Escape') { this.closePopover(); anchor.focus() } })
    this.popover = box
  }

  private item(box: HTMLElement, label: string, action: () => void, disabled = false): void {
    const button = document.createElement('button')
    button.type = 'button'
    button.setAttribute('role', 'menuitem')
    button.textContent = label
    button.disabled = disabled
    button.addEventListener('click', (event) => { event.stopPropagation(); this.closePopover(); action() })
    box.append(button)
  }

  /** The first live command whose caption matches, so the user menu runs the application's own items. */
  private command(pattern: RegExp): MenuCommand | undefined {
    return this.host.commands().find((command) => pattern.test(command.label.split(' / ').at(-1) ?? ''))
  }

  private showUser(anchor: HTMLElement): void {
    const title = parseFrameTitle(this.host.frameTitle())
    this.openPopover(anchor, (box) => {
      const head = document.createElement('p')
      head.className = 'mh-pop-head'
      head.textContent = title.user ? `Signed in as ${title.user}` : 'Signed in'
      box.append(head)
      for (const [label, pattern] of [['Change user', /^change user$/i], ['Change password', /^change password$/i], ['Preferences', /^preferences$/i]] as const) {
        const command = this.command(pattern)
        if (command) this.item(box, label, () => void this.host.run(command), !!command.disabled)
      }
      this.item(box, 'Appearance…', () => this.host.openSettings())
      const themes = document.createElement('p')
      themes.className = 'mh-pop-head'
      themes.textContent = 'Theme'
      box.append(themes)
      for (const [choice, label] of [['light', 'Light'], ['system', 'Match Windows'], ['dark', 'Dark']] as const) {
        this.item(box, (this.host.theme() === choice ? '✓ ' : '') + label, () => { this.host.setTheme(choice); this.refresh() })
      }
      const exit = this.command(/^exit$/i)
      if (exit) this.item(box, 'Exit', () => void this.host.run(exit), !!exit.disabled)
    })
  }

  private showClock(anchor: HTMLElement): void {
    const now = new Date()
    this.openPopover(anchor, (box) => {
      const rows: [string, string][] = [
        ['Today', now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })],
        ['Time', now.toLocaleTimeString('en-GB')],
      ]
      for (const [key, value] of rows) {
        const row = document.createElement('p')
        row.className = 'mh-pop-row'
        row.innerHTML = '<span></span><b></b>'
        row.querySelector('span')!.textContent = key
        row.querySelector('b')!.textContent = value
        box.append(row)
      }
      const note = document.createElement('p')
      note.className = 'mh-pop-note'
      note.textContent = 'The clock of this computer. Invoices take the date the application sets.'
      box.append(note)
    })
  }

  private showPeriod(anchor: HTMLElement): void {
    const title = parseFrameTitle(this.host.frameTitle())
    this.openPopover(anchor, (box) => {
      const rows: [string, string][] = [['Company', title.company], ['Period from', title.period ?? '—'], ['User', title.user ?? '—']]
      for (const [key, value] of rows) {
        const row = document.createElement('p')
        row.className = 'mh-pop-row'
        row.innerHTML = '<span></span><b></b>'
        row.querySelector('span')!.textContent = key
        row.querySelector('b')!.textContent = value
        box.append(row)
      }
      const change = this.command(/last transaction date/i)
      if (change) this.item(box, 'Modify last transaction date', () => void this.host.run(change), !!change.disabled)
    })
  }

  private results(query: string): PaletteResult[] {
    const q = query.trim().toLowerCase()
    const match = (text: string) => !q || text.toLowerCase().includes(q)
    const out: PaletteResult[] = []
    for (const window of this.host.windows()) {
      if (match(window.title)) out.push({ kind: 'window', title: window.title, detail: window.active ? 'Open window · current' : 'Open window', run: () => window.activate() })
    }
    for (const command of this.host.commands()) {
      const parts = command.label.split(' / ')
      const name = parts.at(-1) ?? command.label
      if (!match(command.label)) continue
      out.push({
        kind: 'command', title: name, detail: [parts.slice(0, -1).join(' › '), command.shortcut].filter(Boolean).join(' · '),
        disabled: command.disabled, run: () => void this.host.run(command),
      })
    }
    for (const [choice, label] of [['light', 'Light mode'], ['dark', 'Dark mode'], ['system', 'Match Windows theme']] as const) {
      if (match(label) || match('theme')) out.push({ kind: 'setting', title: label, detail: 'Theme', run: () => { this.host.setTheme(choice); this.refresh() } })
    }
    if (match('appearance settings')) out.push({ kind: 'setting', title: 'Appearance settings', detail: 'Theme, density, text size, print layout', run: () => this.host.openSettings() })
    return out.slice(0, 120)
  }

  openSearch(): void {
    if (this.palette || this.host.busy()) return
    this.closePopover()
    const focus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const dialog = document.createElement('dialog')
    dialog.className = 'mh-palette'
    dialog.setAttribute('aria-label', 'Search screens and commands')
    dialog.innerHTML = `<div class="mh-q">${svg(GLYPH.search)}<input type="search" autocomplete="off" aria-label="Search screens and commands" aria-controls="mh-results" placeholder="Type a screen or command, e.g. purchases"><kbd>Esc</kbd></div>
      <div class="mh-results" id="mh-results" role="listbox"></div>
      <p class="mh-palette-foot"><span><kbd>↑</kbd> <kbd>↓</kbd> move</span><span><kbd>Enter</kbd> open</span><span>Greyed entries are not available to this user or window right now.</span></p>`
    for (const element of [this.element.closest('.presentation-ui')]) if (element instanceof HTMLElement && element.dataset.theme) dialog.dataset.theme = element.dataset.theme
    const input = dialog.querySelector('input')!
    const list = dialog.querySelector<HTMLElement>('.mh-results')!
    let hot = 0
    let results: PaletteResult[] = []
    const close = () => { dialog.close(); dialog.remove(); this.palette = null; focus?.focus() }
    const choose = (result: PaletteResult | undefined) => { if (!result || result.disabled) return; close(); result.run() }
    const render = () => {
      results = this.results(input.value)
      hot = Math.min(hot, Math.max(0, results.length - 1))
      while (results[hot]?.disabled && hot < results.length - 1) hot++
      list.replaceChildren()
      if (!results.length) {
        const empty = document.createElement('p')
        empty.className = 'mh-empty'
        empty.textContent = `Nothing matches "${input.value.trim()}". Try a menu name such as Purchases or Customer.`
        list.append(empty)
      }
      let previous = ''
      results.forEach((result, index) => {
        const group = result.kind === 'window' ? 'Open windows' : result.kind === 'command' ? 'Screens and commands' : 'Settings'
        if (group !== previous) {
          const heading = document.createElement('p')
          heading.className = 'mh-group-head'
          heading.textContent = group
          list.append(heading)
          previous = group
        }
        const option = document.createElement('button')
        option.type = 'button'
        option.setAttribute('role', 'option')
        option.setAttribute('aria-selected', String(index === hot))
        option.className = index === hot ? 'mh-hot' : ''
        option.disabled = !!result.disabled
        option.innerHTML = `<span class="mh-kind">${svg(result.kind === 'window' ? GLYPH.win : result.kind === 'command' ? GLYPH.bolt : GLYPH.gear, 14)}</span><span class="mh-text"><span></span><small></small></span>`
        option.querySelector('.mh-text span')!.textContent = result.title
        option.querySelector('small')!.textContent = result.detail
        option.addEventListener('click', () => choose(result))
        option.addEventListener('mousemove', () => { if (hot !== index) { hot = index; render() } })
        list.append(option)
      })
      list.querySelector('.mh-hot')?.scrollIntoView({ block: 'nearest' })
    }
    input.addEventListener('input', () => { hot = 0; render() })
    input.addEventListener('keydown', (event) => {
      const step = (delta: number) => {
        let next = hot
        do next += delta; while (results[next]?.disabled)
        if (next >= 0 && next < results.length) { hot = next; render() }
      }
      if (event.key === 'ArrowDown') { event.preventDefault(); step(1) }
      if (event.key === 'ArrowUp') { event.preventDefault(); step(-1) }
      if (event.key === 'Enter') { event.preventDefault(); choose(results[hot]) }
    })
    dialog.addEventListener('cancel', (event) => { event.preventDefault(); close() })
    dialog.addEventListener('click', (event) => { if (event.target === dialog) close() })
    document.body.append(dialog)
    this.palette = dialog
    dialog.showModal()
    render()
    input.focus()
  }

  dispose(): void {
    clearInterval(this.timer)
    this.abort.abort()
    this.closePopover()
    this.palette?.remove()
    this.element.remove()
  }
}
