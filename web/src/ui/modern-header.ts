// Modern workspace header (approved parity exception, 2026-11-11; see docs/HANDOFF.md "Approved parity exceptions").
// Context bar (company, period, user, clock, search, theme), a grouped command bar built from the live frame toolbar, and a search
// palette over the live menu.  Every action runs the real menu item or window through the host; nothing here holds business logic.
import type { MenuCommand } from './menu-commands.ts'
import { toast } from './ds-fx.ts'

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
  /** Menu path of the active window (["Purchase"] for Pack Purchase), used for the breadcrumbs. */
  windowPath(): string[]
  /** Opens a top-level menu of the menu bar by its caption. */
  openMenu(caption: string): void
  /** Notifications for the bell (real figures from the company database). */
  notes(): { tone: 'bad' | 'warn' | 'info' | 'ok'; title: string; detail: string }[]
  openHome(): void
  toggleCommands(): void
  /** Read-only database access for the search palette and the popovers (null before the session is ready). */
  query?(): ((sql: string, params?: unknown[]) => Promise<unknown[][]>) | null
  /** Connection, FBR and godown status as the status bar shows it. */
  status?(): { serverOk: boolean | null; fbr?: boolean; godown?: string }
  /** Opens an item of the catalogue (the Items page and its card). */
  openItem?(code: number): void
  /** Opens Purchase › Purchases (the purchase invoices). */
  openPurchases?(): void
  /** The active window's toolbar commands (New, Save, Post …) for the search palette. */
  toolbarCommands?(): { label: string; shortcut?: string; disabled: boolean; run(): void }[]
}

export interface FrameTitle { company: string; period?: string; user?: string; raw: string }

/** "01.01.2022" as the approved design shows it: "01 Jan 2022" (anything else is shown as it is). */
export function formatPeriod(period: string | undefined): string {
  const m = (period ?? '').match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/)
  if (!m) return period ?? ''
  const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])
  return new Date(year, Number(m[2]) - 1, Number(m[1])).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

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
/** Buttons that keep a visible caption next to the icon, with the approved mockup's short captions (the full text stays the name). */
const LABELLED = new Map([['selectscript!', 'New'], ['save!', 'Save'], ['update!', 'Add item'], ['find!', 'List'], ['print!', 'Print'], ['dbadmin!', 'Post']])

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
/** A stock picture means what the mockup draws only when the item's own text agrees (the original reuses pictures: on report
 * windows the Post picture is "Save Report Input(s)").  Otherwise the icon comes from the item's text, never the colour bitmap. */
const MEANING: Record<string, RegExp> = { 'dbadmin!': /\bpost/i, 'selectscript!': /\bnew\b|\badd\b|\binsert/i, 'update!': /add|insert|row|item/i, 'find!': /list|find|search/i }
const TEXT_ICONS: [RegExp, string][] = [
  [/zoom ?in/i, '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5M8 11h6M11 8v6"/>'],
  [/zoom ?out/i, '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5M8 11h6"/>'],
  [/pdf/i, '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M8 15h8M8 18h5"/>'],
  [/mail/i, '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>'],
  [/excel|xls|sheet/i, '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18"/>'],
  [/save (report )?(input|filter)/i, '<path d="M6 3h12v18l-6-4-6 4z"/>'],
  [/retrieve.*(saved|filter)/i, '<path d="M6 3h12v18l-6-4-6 4z"/><path d="M10 9h4"/>'],
  [/filter/i, '<path d="M3 4h18l-7 9v6l-4 2v-8z"/>'],
  [/ruler/i, '<path d="M3 17 17 3l4 4L7 21z"/><path d="m7 13 2 2M10 10l2 2M13 7l2 2"/>'],
  [/paper|page size/i, '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/>'],
  [/orientation|portrait|landscape/i, '<rect x="4" y="8" width="16" height="12" rx="2"/><path d="M9 4h6a3 3 0 0 1 3 3"/><path d="m16 5 2 2-2 2"/>'],
  [/hide|visible|column/i, '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16M15 4v16"/>'],
  [/save ?as|export/i, '<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>'],
  [/refresh|regenerate/i, '<path d="M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5"/>'],
  [/retrieve|run\b/i, '<path d="M7 4v16l13-8z"/>'],
  [/sort/i, '<path d="M7 4v16M3 16l4 4 4-4M17 20V4M13 8l4-4 4 4"/>'],
  [/print/i, '<path d="M6 9V3h12v6M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="7"/>'],
  [/preview|view/i, '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'],
  [/delete|remove/i, '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>'],
  [/save/i, '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8M7 3v5h8"/>'],
  [/find|search/i, '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>'],
  [/calc|total/i, '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 7h8M8 12h.01M12 12h.01M16 12h.01M8 16h.01M12 16h.01M16 16h.01"/>'],
  [/close|exit/i, '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>'],
]
const fits = (stock: string, text: string) => !MEANING[stock] || MEANING[stock].test(text)
const toolIcon = (stock: string, text: string) => (ICONS[stock] && fits(stock, text) ? ICONS[stock] : TEXT_ICONS.find(([pattern]) => pattern.test(text))?.[1]) ?? null
const initials = (name: string) => name.split(/\s+/).filter(Boolean).map((word) => word[0]).join('').slice(0, 2).toUpperCase() || 'U'
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
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.9 1.9 0 0 0 3.4 0"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6M12 17h.01"/>',
  win: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="m10.8 12.2 9.2-9.2M17 6l3 3M14 9l2 2"/>',
  exit: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  box: '<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/>',
  doc: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M8 13h8M8 17h5"/>',
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
      // the approved design names the record group after the document ("Invoice" on invoice windows)
      const invoice = key === 'record' && buttons.some((button) => (button.dataset.stock ?? '').toLowerCase() === 'selectscript!' && /invoice/i.test(button.dataset.label || button.title || ''))
      const label = invoice ? 'Invoice' : TOOLBAR_GROUPS.find((item) => item.key === key)?.label
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
    const text = (button.dataset.label || button.title || '').split('\t')[0].trim()
    button.setAttribute('aria-label', text)
    const glyph = toolIcon(stock, text)
    if (glyph && !button.querySelector('.mh-i')) {
      button.querySelector('.pic')?.remove()
      button.insertAdjacentHTML('afterbegin', svg(glyph))
    }
    if (LABELLED.has(stock) && fits(stock, text) && !button.querySelector('.mh-label')) {
      const label = document.createElement('span')
      label.className = 'mh-label'
      label.textContent = LABELLED.get(stock)!
      button.append(label)
    }
    button.classList.toggle('mh-primary', stock === 'dbadmin!' && fits(stock, text))
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

type PaletteKind = 'window' | 'command' | 'setting' | 'action' | 'item' | 'invoice'
interface PaletteResult { kind: PaletteKind; title: string; detail: string; disabled?: boolean; run(): void }
type PaletteScope = 'all' | 'screens' | 'items' | 'invoices' | 'commands'
const SCOPES: [PaletteScope, string][] = [['all', 'All'], ['screens', 'Screens'], ['items', 'Items'], ['invoices', 'Invoices'], ['commands', 'Commands']]
const GROUPS: Record<PaletteKind, string> = { window: 'Open windows', command: 'Screens', action: 'Commands', setting: 'Commands', item: 'Items', invoice: 'Purchase invoices' }
const money = (n: number) => n.toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

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
      <button type="button" class="mh-brand" aria-label="About Trader"><span class="mh-mark" aria-hidden="true">TA</span><span><b class="mh-company"></b><span class="mh-sub"></span></span></button>
      <nav class="mh-crumbs" aria-label="You are here"></nav>
      <span class="mh-fill"></span>
      <button type="button" class="mh-search" aria-haspopup="dialog">${svg(GLYPH.search)}<span>Search screens, items, invoices…</span><kbd>Ctrl</kbd><kbd>K</kbd></button>
      <button type="button" class="mh-chip mh-period" hidden>${svg(GLYPH.cal, 14)}<span>FY from <b></b></span></button>
      <button type="button" class="mh-chip mh-clock" aria-label="Date and time"><span class="mh-dot" aria-hidden="true"></span><b></b></button>
      <div class="mh-theme" role="group" aria-label="Colour theme">
        <button type="button" data-theme-choice="light" aria-label="Light mode" title="Light mode">${svg(GLYPH.sun, 14)}</button>
        <button type="button" data-theme-choice="system" aria-label="Match Windows theme" title="Match Windows">${svg(GLYPH.auto, 14)}</button>
        <button type="button" data-theme-choice="dark" aria-label="Dark mode" title="Dark mode">${svg(GLYPH.moon, 14)}</button>
      </div>
      <button type="button" class="mh-icon mh-bell" aria-label="Notifications" aria-haspopup="dialog">${svg(GLYPH.bell, 15)}<span class="mh-badge" hidden></span></button>
      <button type="button" class="mh-icon mh-help" aria-label="Help and keyboard shortcuts">${svg(GLYPH.help, 15)}</button>
      <button type="button" class="mh-user" aria-haspopup="menu"><span class="mh-avatar" aria-hidden="true"></span><span class="mh-user-name"></span>${svg(GLYPH.down, 14)}</button>`
    this.element = header
    const signal = this.abort.signal
    header.querySelector('.mh-search')!.addEventListener('click', () => this.openSearch())
    header.querySelector('.mh-bell')!.addEventListener('click', (event) => { event.stopPropagation(); this.showNotes(event.currentTarget as HTMLElement) })
    header.querySelector('.mh-help')!.addEventListener('click', () => this.showShortcuts())
    // the brand opens the application's own About window (Help › About), as the approved design's brand button does
    header.querySelector('.mh-brand')!.addEventListener('click', () => {
      const about = this.command(/^about\b/i)
      if (about && !about.disabled && !host.busy()) void host.run(about)
    })
    header.querySelector('.mh-crumbs')!.addEventListener('click', (event) => {
      const crumb = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-crumb]')
      if (crumb) { event.stopPropagation(); host.openMenu(crumb.dataset.crumb!) }
    })
    // The opening click must not reach the document's click-outside handler, which would close the popover at once.
    header.querySelector('.mh-period')!.addEventListener('click', (event) => { event.stopPropagation(); this.showPeriod(event.currentTarget as HTMLElement) })
    header.querySelector('.mh-user')!.addEventListener('click', (event) => { event.stopPropagation(); this.showUser(event.currentTarget as HTMLElement) })
    header.querySelector('.mh-clock')!.addEventListener('click', (event) => { event.stopPropagation(); this.showClock(event.currentTarget as HTMLElement) })
    for (const button of header.querySelectorAll<HTMLButtonElement>('[data-theme-choice]')) {
      button.addEventListener('click', () => this.setTheme(button.dataset.themeChoice as ThemeChoice))
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


  refresh(): void {
    const title = parseFrameTitle(this.host.frameTitle())
    const q = <T extends HTMLElement>(selector: string) => this.element.querySelector<T>(selector)!
    const [name, ...rest] = (title.company || 'Trader').split(' ')
    q('.mh-company').textContent = name
    q('.mh-sub').textContent = rest.join(' ')
    const crumbs = q('.mh-crumbs')
    crumbs.replaceChildren()
    for (const part of this.host.windowPath()) {
      const sep = document.createElement('span'); sep.className = 'mh-sep'; sep.textContent = crumbs.childElementCount ? '›' : '/'; sep.setAttribute('aria-hidden', 'true')
      const button = document.createElement('button'); button.type = 'button'; button.className = 'mh-crumb'; button.dataset.crumb = part; button.textContent = part
      crumbs.append(sep, button)
    }
    const lead = document.createElement('span'); lead.className = 'mh-sep'; lead.setAttribute('aria-hidden', 'true'); lead.textContent = crumbs.childElementCount ? '›' : '/'
    const where = document.createElement('strong'); where.textContent = this.host.windowTitle()
    crumbs.append(lead, where)
    const period = q<HTMLButtonElement>('.mh-period')
    period.hidden = !title.period
    period.querySelector('b')!.textContent = formatPeriod(title.period)
    const notes = this.host.notes()
    const unread = this.notesSignature(notes) === this.readNotes ? 0 : notes.length
    const badge = q('.mh-badge')
    badge.hidden = !unread
    badge.textContent = String(unread)
    q('.mh-bell').setAttribute('aria-label', unread ? `Notifications, ${unread} new` : 'Notifications')
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

  /** Notifications read with "Mark all as read" (they count again when the figures change). */
  private readNotes = ''
  private notesSignature(notes: { title: string; detail: string }[]): string { return notes.map((note) => `${note.title}|${note.detail}`).join('\n') }

  private setTheme(theme: ThemeChoice): void {
    this.host.setTheme(theme)
    this.refresh()
    toast(theme === 'dark' ? 'Dark mode on' : theme === 'light' ? 'Light mode on' : 'Theme follows Windows', theme === 'dark' ? 'moon' : theme === 'light' ? 'sun' : 'auto')
  }

  private row(box: HTMLElement, key: string, value: string, tone = ''): HTMLElement {
    const row = document.createElement('p')
    row.className = 'mh-pop-row'
    row.innerHTML = '<span></span><b></b>'
    row.querySelector('span')!.textContent = key
    const b = row.querySelector('b')!
    b.textContent = value
    if (tone) b.className = tone
    box.append(row)
    return b
  }

  private title(box: HTMLElement, text: string): void {
    const head = document.createElement('p')
    head.className = 'mh-pop-title'
    head.textContent = text
    box.append(head)
  }

  private section(box: HTMLElement): HTMLElement {
    const sec = document.createElement('div')
    sec.className = 'mh-pop-sec'
    box.append(sec)
    return sec
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

  private item(box: HTMLElement, label: string, action: () => void, disabled = false, icon = '', className = ''): HTMLButtonElement {
    const button = document.createElement('button')
    button.type = 'button'
    button.setAttribute('role', 'menuitem')
    if (className) button.className = className
    if (icon) button.insertAdjacentHTML('beforeend', svg(icon, 15))
    button.append(label)
    button.disabled = disabled
    button.addEventListener('click', (event) => { event.stopPropagation(); this.closePopover(); action() })
    box.append(button)
    return button
  }

  /** The first live command whose caption matches, so the user menu runs the application's own items. */
  private command(pattern: RegExp): MenuCommand | undefined {
    return this.host.commands().find((command) => pattern.test(command.label.split(' / ').at(-1) ?? ''))
  }

  private showUser(anchor: HTMLElement): void {
    const title = parseFrameTitle(this.host.frameTitle())
    const user = title.user ?? 'User'
    this.openPopover(anchor, (box) => {
      // the approved design's head: avatar, user name, then the user's groups and the godown
      const head = document.createElement('div')
      head.className = 'mh-pop-user'
      head.innerHTML = '<span class="mh-avatar" aria-hidden="true"></span><span><b></b><small></small></span>'
      head.querySelector('.mh-avatar')!.textContent = initials(user)
      head.querySelector('b')!.textContent = user
      const sub = head.querySelector('small')!
      const godown = this.host.status?.().godown
      sub.textContent = godown ? `${godown} godown` : ''
      box.append(head)
      const query = this.host.query?.()
      if (query && title.user) {
        void query(`SELECT string_agg(g.groupname::text, ', ' ORDER BY g.groupname) FROM dbo.users u JOIN dbo.usergroups ug ON ug.usercode = u.usercode
          JOIN dbo.groups g ON g.groupcode = ug.groupcode WHERE upper(u.username) = upper($1)`, [title.user])
          .then((rows) => { sub.textContent = [String(rows[0]?.[0] ?? ''), godown ? `${godown} godown` : ''].filter(Boolean).join(' · ') }).catch(() => {})
      }
      const menu = this.section(box)
      for (const [label, pattern, icon] of [['Change user', /^change user$/i, GLYPH.user], ['Change password', /^change password$/i, GLYPH.key], ['Preferences', /^preferences$/i, GLYPH.gear]] as const) {
        const command = this.command(pattern)
        if (command) this.item(menu, label, () => void this.host.run(command), !!command.disabled, icon)
      }
      this.item(menu, 'Appearance…', () => this.host.openSettings(), false, GLYPH.auto)
      this.item(menu, 'Show or hide all commands', () => this.host.toggleCommands(), false, GLYPH.panel)
      const themes = this.section(box)
      for (const [choice, label, icon] of [['light', 'Light', GLYPH.sun], ['system', 'Match Windows', GLYPH.auto], ['dark', 'Dark', GLYPH.moon]] as const) {
        const button = this.item(themes, label, () => this.setTheme(choice), false, icon)
        if (this.host.theme() === choice) button.insertAdjacentHTML('beforeend', '<span class="mh-check">✓</span>')
      }
      const exit = this.command(/^exit$/i)
      if (exit) this.item(this.section(box), 'Exit Trader', () => void this.host.run(exit), !!exit.disabled, GLYPH.exit, 'mh-danger-item')
    })
  }

  private showClock(anchor: HTMLElement): void {
    const now = new Date()
    this.openPopover(anchor, (box) => {
      this.title(box, 'Date and time')
      this.row(box, 'Today', now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }))
      this.row(box, 'Time', now.toLocaleTimeString('en-GB'), 'num')
      const status = this.host.status?.()
      if (status) {
        this.row(box, 'Server', status.serverOk === false ? 'Not reachable' : status.serverOk ? 'Connected' : 'Connecting…', status.serverOk === false ? 'bad' : status.serverOk ? 'ok' : '')
        if (status.fbr !== undefined) this.row(box, 'FBR IMS', status.fbr ? 'Online' : 'Offline', status.fbr ? 'ok' : 'bad')
      }
    })
  }

  private showNotes(anchor: HTMLElement): void {
    const notes = this.host.notes()
    this.openPopover(anchor, (box) => {
      this.title(box, 'Notifications')
      if (!notes.length) {
        const empty = document.createElement('p'); empty.className = 'mh-pop-note'; empty.textContent = 'Nothing needs your attention.'; box.append(empty)
      }
      for (const note of notes) {
        const button = document.createElement('button')
        button.type = 'button'
        button.className = 'mh-note'
        button.innerHTML = `<span class="mh-note-dot ${note.tone}" aria-hidden="true"></span><span><b></b><small></small></span>`
        button.querySelector('b')!.textContent = note.title
        button.querySelector('small')!.textContent = note.detail
        button.addEventListener('click', (event) => { event.stopPropagation(); this.closePopover(); this.host.openHome() })
        box.append(button)
      }
      if (notes.length) {
        this.item(this.section(box), 'Mark all as read', () => {
          this.readNotes = this.notesSignature(notes)
          this.refresh()
          toast('All notifications read', 'bell')
        }, this.readNotes === this.notesSignature(notes))
      }
    })
  }

  private showShortcuts(): void {
    if (this.host.busy()) return
    const keys: [string, string][] = [['Ctrl+K', 'Search screens and commands'], ['Alt + letter', 'Open a menu (underlined letter)'], ['Arrow keys', 'Move through menus and window tabs'], ['Esc', 'Close a menu, popover or search']]
    for (const command of this.host.commands()) if (command.shortcut && !command.disabled) keys.push([command.shortcut, command.label.split(' / ').join(' › ')])
    const dialog = document.createElement('dialog')
    dialog.className = 'mh-palette mh-shortcuts'
    dialog.setAttribute('aria-labelledby', 'mh-shortcuts-title')
    const theme = this.element.closest<HTMLElement>('.presentation-ui')?.dataset.theme
    if (theme) dialog.dataset.theme = theme
    dialog.innerHTML = `<h2 id="mh-shortcuts-title">Keyboard shortcuts</h2><div class="mh-keys"></div><p class="mh-palette-foot"><button type="button" class="mh-close">Close</button></p>`
    const list = dialog.querySelector('.mh-keys')!
    for (const [key, label] of keys) {
      const k = document.createElement('kbd'); k.textContent = key
      const t = document.createElement('span'); t.textContent = label
      list.append(k, t)
    }
    const close = () => { dialog.close(); dialog.remove() }
    dialog.querySelector('.mh-close')!.addEventListener('click', close)
    dialog.addEventListener('cancel', (event) => { event.preventDefault(); close() })
    dialog.addEventListener('click', (event) => { if (event.target === dialog) close() })
    document.body.append(dialog)
    dialog.showModal()
    dialog.querySelector<HTMLButtonElement>('.mh-close')!.focus()
  }

  private showPeriod(anchor: HTMLElement): void {
    const title = parseFrameTitle(this.host.frameTitle())
    this.openPopover(anchor, (box) => {
      this.title(box, 'Financial year')
      this.row(box, 'Starts', formatPeriod(title.period) || '—')
      this.row(box, 'Company', title.company)
      const last = this.row(box, 'Last transaction date', '…')
      const query = this.host.query?.()
      if (query) {
        void query('SELECT max(lasttransdate)::date::text FROM dbo.serverdate').then((rows) => {
          const value = String(rows[0]?.[0] ?? '')
          last.textContent = value ? new Date(value + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'
        }).catch(() => { last.textContent = '—' })
      } else last.textContent = '—'
      const change = this.command(/last transaction date/i)
      if (change) this.item(this.section(box), 'Modify last transaction date', () => void this.host.run(change), !!change.disabled, GLYPH.cal)
    })
  }

  /** Menu, window and command results (synchronous); items and invoices come from the database (see `dataResults`). */
  private results(query: string, scope: PaletteScope): PaletteResult[] {
    const q = query.trim().toLowerCase()
    const match = (text: string) => !q || text.toLowerCase().includes(q)
    const want = (kind: PaletteScope) => scope === 'all' || scope === kind
    const out: PaletteResult[] = []
    if (want('screens')) {
      for (const window of this.host.windows()) {
        if (match(window.title)) out.push({ kind: 'window', title: window.title, detail: window.active ? 'Open window · current' : 'Open window', run: () => window.activate() })
      }
      const screens: PaletteResult[] = []
      for (const command of this.host.commands()) {
        const parts = command.label.split(' / ')
        const name = parts.at(-1) ?? command.label
        if (!match(command.label)) continue
        screens.push({
          kind: 'command', title: name, detail: [parts.slice(0, -1).join(' › '), command.shortcut].filter(Boolean).join(' · '),
          disabled: command.disabled, run: () => void this.host.run(command),
        })
      }
      out.push(...screens.slice(0, q || scope === 'screens' ? 120 : 5))
    }
    if (want('commands')) {
      const actions: PaletteResult[] = []
      for (const command of this.host.toolbarCommands?.() ?? []) {
        if (match(command.label)) actions.push({ kind: 'action', title: command.label, detail: command.shortcut ? `Shortcut ${command.shortcut}` : 'This window', disabled: command.disabled, run: command.run })
      }
      for (const [choice, label] of [['light', 'Light mode'], ['dark', 'Dark mode'], ['system', 'Match Windows theme']] as const) {
        if (match(label) || match('theme')) actions.push({ kind: 'setting', title: label, detail: 'Theme', run: () => this.setTheme(choice) })
      }
      if (match('keyboard shortcuts')) actions.push({ kind: 'setting', title: 'Keyboard shortcuts', detail: 'Help', run: () => this.showShortcuts() })
      if (match('appearance settings')) actions.push({ kind: 'setting', title: 'Appearance settings', detail: 'Theme, density, text size, print layout', run: () => this.host.openSettings() })
      out.push(...actions.slice(0, q || scope === 'commands' ? 40 : 3))
    }
    return out
  }

  /** Items and purchase invoices matching the query (read-only queries; empty without a query or a database session). */
  private async dataResults(query: string, scope: PaletteScope): Promise<PaletteResult[]> {
    const q = query.trim()
    const run = this.host.query?.()
    if (!q || !run) return []
    const out: PaletteResult[] = []
    const like = `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`
    const limit = scope === 'all' ? 3 : 10
    if (scope === 'all' || scope === 'items') {
      const rows = await run(`SELECT i.icode, i.name::text, coalesce(m.name::text, ''), coalesce(i.saleprice, 0) FROM dbo.item i
        LEFT JOIN dbo.manufacturer m ON m.manfcode = i.manfcode WHERE i.name ILIKE $1 OR i.icode::text = $2 ORDER BY i.name LIMIT ${limit}`, [like, q]).catch(() => [])
      for (const row of rows) {
        const code = Number(row[0])
        out.push({ kind: 'item', title: String(row[1] ?? ''), detail: [String(code), String(row[2] ?? ''), `Rs ${money(Number(row[3] ?? 0))}`].filter(Boolean).join(' · '),
          disabled: !this.host.openItem, run: () => this.host.openItem?.(code) })
      }
    }
    if (scope === 'all' || scope === 'invoices') {
      const rows = await run(`SELECT p.purinvcode, p.date::date::text, coalesce(a.name::text, ''), coalesce(p.suppinvcode::text, ''), coalesce(p.invtotal, 0), p.posted::text
        FROM dbo.purledger p LEFT JOIN dbo.accounts a ON a.acccode = p.suppcode
        WHERE p.purinvcode::text = $2 OR a.name ILIKE $1 OR p.suppinvcode ILIKE $1 ORDER BY p.date DESC LIMIT ${limit}`, [like, q]).catch(() => [])
      for (const row of rows) {
        const date = String(row[1] ?? '')
        out.push({
          kind: 'invoice', title: `Purchase ${row[0]}`,
          detail: [String(row[2] ?? ''), date ? new Date(date + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '',
            String(row[3] ?? '') && `bill ${row[3]}`, `Rs ${money(Number(row[4] ?? 0))}`, String(row[5]).toUpperCase() === 'Y' ? 'posted' : 'not posted'].filter(Boolean).join(' · '),
          disabled: !this.host.openPurchases, run: () => this.host.openPurchases?.(),
        })
      }
    }
    return out
  }

  openSearch(): void {
    if (this.palette || this.host.busy()) return
    this.closePopover()
    const focus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const dialog = document.createElement('dialog')
    dialog.className = 'mh-palette'
    dialog.setAttribute('aria-label', 'Search')
    dialog.innerHTML = `<div class="mh-q">${svg(GLYPH.search)}<input type="search" autocomplete="off" aria-label="Search screens, items, invoices and commands" aria-controls="mh-results" placeholder="Search screens, items, invoices, commands…"><kbd>Esc</kbd></div>
      <div class="mh-scopes" role="group" aria-label="Search in">${SCOPES.map(([key, label]) => `<button type="button" class="mh-scope" data-scope="${key}" aria-pressed="${key === 'all'}">${label}</button>`).join('')}</div>
      <div class="mh-results" id="mh-results" role="listbox"></div>
      <p class="mh-palette-foot"><span><kbd>↑</kbd> <kbd>↓</kbd> move</span><span><kbd>Enter</kbd> open</span><span><kbd>Tab</kbd> next filter</span><span>Greyed entries are not available to this user or window right now.</span></p>`
    for (const element of [this.element.closest('.presentation-ui')]) if (element instanceof HTMLElement && element.dataset.theme) dialog.dataset.theme = element.dataset.theme
    const input = dialog.querySelector('input')!
    const list = dialog.querySelector<HTMLElement>('.mh-results')!
    let hot = 0
    let scope: PaletteScope = 'all'
    let results: PaletteResult[] = []
    let data: PaletteResult[] = []
    let seq = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    const close = () => { clearTimeout(timer); dialog.close(); dialog.remove(); this.palette = null; focus?.focus() }
    const choose = (result: PaletteResult | undefined) => { if (!result || result.disabled) return; close(); result.run() }
    const highlight = (target: HTMLElement, text: string) => {
      const q = input.value.trim().toLowerCase()
      const at = q ? text.toLowerCase().indexOf(q) : -1
      if (at < 0) { target.textContent = text; return }
      const mark = document.createElement('mark')
      mark.textContent = text.slice(at, at + q.length)
      target.replaceChildren(text.slice(0, at), mark, text.slice(at + q.length))
    }
    const render = () => {
      const local = this.results(input.value, scope)
      // the approved design's order: commands, screens, items, invoices (open windows first)
      const rank: Record<PaletteKind, number> = { window: 0, action: 1, setting: 1, command: 2, item: 3, invoice: 4 }
      results = [...local, ...data].sort((a, b) => rank[a.kind] - rank[b.kind])
      hot = Math.min(hot, Math.max(0, results.length - 1))
      while (results[hot]?.disabled && hot < results.length - 1) hot++
      for (const button of dialog.querySelectorAll<HTMLElement>('[data-scope]')) button.setAttribute('aria-pressed', String(button.dataset.scope === scope))
      list.replaceChildren()
      if (!results.length) {
        const empty = document.createElement('p')
        empty.className = 'mh-empty'
        empty.textContent = input.value.trim() ? `Nothing matches "${input.value.trim()}". Try an item code, a supplier or a menu name.` : 'Type to search.'
        list.append(empty)
      }
      let previous = ''
      results.forEach((result, index) => {
        const group = GROUPS[result.kind]
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
        const glyph = result.kind === 'window' ? GLYPH.win : result.kind === 'command' ? GLYPH.win : result.kind === 'item' ? GLYPH.box : result.kind === 'invoice' ? GLYPH.doc : result.kind === 'setting' ? GLYPH.gear : GLYPH.bolt
        option.innerHTML = `<span class="mh-kind">${svg(glyph, 14)}</span><span class="mh-text"><span></span><small></small></span>${index === hot ? '<kbd>Enter</kbd>' : ''}`
        highlight(option.querySelector('.mh-text span')!, result.title)
        highlight(option.querySelector('small')!, result.detail)
        option.addEventListener('click', () => choose(result))
        option.addEventListener('mousemove', () => { if (hot !== index) { hot = index; render() } })
        list.append(option)
      })
      list.querySelector('.mh-hot')?.scrollIntoView({ block: 'nearest' })
    }
    const refreshData = () => {
      clearTimeout(timer)
      const mine = ++seq
      data = []
      timer = setTimeout(() => {
        void this.dataResults(input.value, scope).then((rows) => { if (mine === seq && this.palette === dialog) { data = rows; render() } })
      }, 180)
    }
    const setScope = (next: PaletteScope) => { scope = next; hot = 0; render(); refreshData() }
    dialog.querySelector('.mh-scopes')!.addEventListener('click', (event) => {
      const button = (event.target as HTMLElement).closest<HTMLElement>('[data-scope]')
      if (button) { setScope(button.dataset.scope as PaletteScope); input.focus() }
    })
    input.addEventListener('input', () => { hot = 0; render(); refreshData() })
    input.addEventListener('keydown', (event) => {
      const step = (delta: number) => {
        let next = hot
        do next += delta; while (results[next]?.disabled)
        if (next >= 0 && next < results.length) { hot = next; render() }
      }
      if (event.key === 'ArrowDown') { event.preventDefault(); step(1) }
      if (event.key === 'ArrowUp') { event.preventDefault(); step(-1) }
      if (event.key === 'Enter') { event.preventDefault(); choose(results[hot]) }
      if (event.key === 'Tab') {
        event.preventDefault()
        const keys = SCOPES.map(([key]) => key)
        setScope(keys[(keys.indexOf(scope) + (event.shiftKey ? keys.length - 1 : 1)) % keys.length])
      }
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
