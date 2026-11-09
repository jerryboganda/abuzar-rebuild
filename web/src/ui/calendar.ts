import { NCalendar, CALENDAR_MIN, CALENDAR_MAX, calendarMonth, calendarWeekNumber, calendarWeekStart } from '../runtime/native/calendar.ts'
import { PBDate, toNum, toStr } from '../runtime/values.ts'

let nextCalendar = 0
type CalendarMode = 'days' | 'months' | 'years'

function firstWeekday(control: NCalendar): number {
  const declared = control.props.get('firstdayofweek')
  if (typeof declared === 'string') {
    const index = ['sunday!', 'monday!', 'tuesday!', 'wednesday!', 'thursday!', 'friday!', 'saturday!'].indexOf(declared.toLowerCase())
    if (index >= 0) return index
    throw new Error(`Unsupported calendar first weekday: ${declared}`)
  }
  if (declared !== undefined) throw new Error('Unresolved numeric calendar first weekday')
  const locale = new Intl.Locale(new Intl.DateTimeFormat().resolvedOptions().locale) as Intl.Locale & {
    getWeekInfo?: () => { firstDay: number }
    weekInfo?: { firstDay: number }
  }
  const info = locale.getWeekInfo?.() ?? locale.weekInfo
  if (!info) throw new Error('Calendar locale information is unavailable in this browser')
  return info.firstDay % 7
}

function label(date: PBDate, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat(undefined, { ...options, calendar: 'gregory', timeZone: 'UTC' })
    .format(new Date(date.n * 86400000))
}

export class CalendarView {
  readonly el = document.createElement('div')
  private control: NCalendar
  private previous = document.createElement('button')
  private title = document.createElement('button')
  private next = document.createElement('button')
  private today = document.createElement('button')
  private grid = document.createElement('table')
  private heading = document.createElement('thead')
  private body = document.createElement('tbody')
  private live = document.createElement('div')
  private lifetime = new AbortController()
  private pending = Promise.resolve()
  private midnight: ReturnType<typeof setTimeout> | undefined
  private modern = false
  private mode: CalendarMode = 'days'
  private cursor: PBDate
  private selected: number
  private disposed = false
  private initialFocus = false

  constructor(control: NCalendar) {
    this.control = control
    this.cursor = control.selectedDate
    this.selected = this.cursor.n
    this.el.className = 'ctl pb-calendar'
    this.el.setAttribute('role', 'group')
    this.el.setAttribute('aria-label', toStr(control.props.get('accessiblename')) || 'Calendar')
    this.grid.id = `calendar-${++nextCalendar}`
    this.grid.setAttribute('role', 'grid')
    const header = document.createElement('div')
    header.className = 'calendar-header'
    for (const [button, direction] of [[this.previous, -1], [this.next, 1]] as const) {
      button.innerHTML = `<svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path d="${direction < 0 ? 'm8 2-4 4 4 4' : 'm4 2 4 4-4 4'}" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>`
      button.addEventListener('click', () => this.enqueue(() => this.navigate(direction)))
    }
    for (const button of [this.previous, this.title, this.next, this.today]) {
      button.type = 'button'
      button.setAttribute('aria-controls', this.grid.id)
    }
    this.title.addEventListener('click', () => {
      if (this.mode === 'years') return
      this.mode = this.mode === 'days' ? 'months' : 'years'
      this.render()
      this.focus()
    })
    this.today.className = 'calendar-today'
    this.today.addEventListener('click', () => this.enqueue(() => this.select(this.control.today)))
    this.live.className = 'calendar-announcement'
    this.live.setAttribute('role', 'status')
    this.live.setAttribute('aria-atomic', 'true')
    header.append(this.previous, this.title, this.next)
    this.grid.append(this.heading, this.body)
    this.el.append(header, this.grid, this.today, this.live)
    const signal = this.lifetime.signal
    this.grid.addEventListener('click', (event) => {
      const cell = event.target instanceof Element ? event.target.closest<HTMLElement>('[role=gridcell]') : null
      if (!cell || !this.grid.contains(cell) || cell.getAttribute('aria-disabled') === 'true') return
      cell.focus()
      const date = new PBDate(Number(cell.dataset.date)), mode = this.mode
      this.enqueue(async () => {
        if (mode === 'years') {
          this.cursor = date
          this.mode = 'months'
          this.render(true)
        } else await this.select(date)
      })
    }, { signal })
    this.grid.addEventListener('dblclick', (event) => {
      const cell = event.target instanceof Element ? event.target.closest<HTMLElement>('[role=gridcell]') : null
      if (!cell || this.mode !== 'days' || cell.getAttribute('aria-disabled') === 'true') return
      const flags = (event.shiftKey ? 1 : 0) | (event.ctrlKey ? 2 : 0), x = event.offsetX, y = event.offsetY
      this.enqueue(async () => {
        await this.control.rt.fire(this.control, 'doubleclicked', [flags, x, y])
        await this.control.rt.flushPosted()
      })
    }, { signal })
    this.grid.addEventListener('keydown', (event) => this.key(event), { signal })
    this.el.addEventListener('focusin', (event) => {
      if (!(event.relatedTarget instanceof Node) || !this.el.contains(event.relatedTarget)) {
        this.enqueue(async () => { await control.rt.fire(control, 'getfocus') })
      }
    }, { signal })
    this.el.addEventListener('focusout', (event) => {
      if (!(event.relatedTarget instanceof Node) || !this.el.contains(event.relatedTarget)) {
        this.enqueue(async () => { await control.rt.fire(control, 'losefocus') })
      }
    }, { signal })
    this.refresh()
    this.scheduleMidnight()
  }

  setModern(value: boolean): void { this.modern = value; this.refresh() }

  focus(): void {
    const target = this.grid.querySelector<HTMLElement>('[role=gridcell][data-current=true]:not([aria-disabled=true])')
    target?.focus()
    this.initialFocus = !!target && document.activeElement !== target && !this.el.getClientRects().length
  }

  shown(): void { if (this.initialFocus) this.focus() }

  settled(): Promise<void> { return this.pending }

  private enqueue(work: () => Promise<void>): void {
    this.pending = this.pending.then(async () => {
      if (!this.disposed && this.control.props.get('enabled') !== false) await work()
    }).catch((error: unknown) => this.control.rt.onError(error))
  }

  private async select(date: PBDate): Promise<void> {
    const hadFocus = this.el.contains(document.activeElement)
    this.mode = 'days'
    const result = await this.control.n_setselecteddate(date)
    if (result !== 0) throw new Error(`Calendar could not select ${toStr(date)} (status ${result})`)
    await this.control.rt.flushPosted()
    if (hadFocus && this.el.contains(document.activeElement)) this.focus()
  }

  private async navigate(direction: number): Promise<void> {
    if (this.mode === 'days') {
      await this.select(calendarMonth(this.control.selectedDate, direction * Math.max(1, toNum(this.control.props.get('scrollrate') ?? 1))))
    } else {
      this.cursor = calendarMonth(this.cursor, direction * (this.mode === 'months' ? 12 : 120))
      this.render()
    }
  }

  private key(event: KeyboardEvent): void {
    if (event.altKey || event.metaKey || event.isComposing || this.control.props.get('enabled') === false) return
    const day = this.mode === 'days'
    if (event.key === 'Enter' && day) return
    const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' ', 'Enter']
    if (!keys.includes(event.key)) return
    event.preventDefault()
    const key = event.key, ctrl = event.ctrlKey
    this.enqueue(async () => {
      let next = this.mode === 'days' ? this.control.selectedDate : this.cursor
      if (key === ' ' || key === 'Enter') {
        if (this.mode === 'years') {
          this.mode = 'months'
          this.render(true)
        } else await this.select(next)
        return
      }
      if (this.mode === 'days') {
        if (key.startsWith('Arrow')) next = new PBDate(next.n + ({ ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[key] ?? 0))
        else if (key === 'PageUp' || key === 'PageDown') next = calendarMonth(next, key === 'PageUp' ? -1 : 1)
        else if (ctrl) {
          next = calendarMonth(next, key === 'Home' ? -1 : 1)
          next = calendarWeekStart(next, firstWeekday(this.control))
          if (key === 'End') next = new PBDate(next.n + 6)
        } else next = key === 'Home' ? PBDate.ymd(next.y, next.m, 1) : new PBDate(PBDate.ymd(next.y, next.m + 1, 1).n - 1)
        await this.select(new PBDate(Math.min(CALENDAR_MAX, Math.max(CALENDAR_MIN, next.n))))
      } else {
        const unit = this.mode === 'months' ? 1 : 12
        let offset = ({ ArrowLeft: -1, ArrowRight: 1, ArrowUp: -3, ArrowDown: 3, PageUp: -12, PageDown: 12 }[key] ?? 0) * unit
        if (this.mode === 'years' && (key === 'PageUp' || key === 'PageDown')) offset = key === 'PageUp' ? -120 : 120
        if (key === 'Home') offset = this.mode === 'months' ? 1 - next.m : (Math.floor(next.y / 10) * 10 - next.y) * 12
        if (key === 'End') offset = this.mode === 'months' ? 12 - next.m : (Math.floor(next.y / 10) * 10 + 9 - next.y) * 12
        this.cursor = calendarMonth(next, offset)
        this.render(true)
      }
    })
  }

  refresh(): void {
    if (this.disposed) return
    if (this.control.props.get('multiselect') === true) throw new Error('Calendar range selection is not implemented')
    if (this.control.selectedDate.n !== this.selected) {
      this.selected = this.control.selectedDate.n
      this.cursor = this.control.selectedDate
    }
    this.el.dataset.autosize = String(this.control.props.get('autosize') !== false)
    this.render()
  }

  private render(focus = false): void {
    const restore = this.grid.contains(document.activeElement)
    const active = this.mode === 'days' ? this.control.selectedDate : this.cursor
    const disabled = this.control.props.get('enabled') === false
    const first = firstWeekday(this.control)
    const weeks = this.mode === 'days' && this.control.props.get('weeknumbers') === true
    const tab = this.control.props.get('taborder')
    const tabIndex = typeof tab === 'number' && tab > 0 ? this.modern ? 0 : tab : -1
    this.grid.dataset.mode = this.mode
    this.grid.setAttribute('aria-disabled', String(disabled))
    this.title.textContent = this.mode === 'days' ? label(active, { month: 'long', year: 'numeric' }) :
      this.mode === 'months' ? String(active.y) : `${Math.floor(active.y / 10) * 10} - ${Math.floor(active.y / 10) * 10 + 9}`
    this.title.setAttribute('aria-label', this.mode === 'days' ? `Choose month: ${this.title.textContent}` :
      this.mode === 'months' ? `Choose year: ${this.title.textContent}` : this.title.textContent)
    this.grid.setAttribute('aria-label', this.title.textContent)
    this.previous.setAttribute('aria-label', this.mode === 'days' ? 'Previous month' : this.mode === 'months' ? 'Previous year' : 'Previous decade')
    this.next.setAttribute('aria-label', this.mode === 'days' ? 'Next month' : this.mode === 'months' ? 'Next year' : 'Next decade')
    // One tab stop, the selected date, in both presentations, as the Windows month calendar: the header buttons are pointer controls
    // and PageUp / PageDown (Ctrl for years) change the month from the keyboard.
    for (const button of [this.previous, this.title, this.next, this.today]) {
      button.disabled = disabled
      button.tabIndex = -1
    }
    this.title.disabled ||= this.mode === 'years'
    this.previous.disabled ||= active.y === 1601 && (this.mode !== 'days' || active.m === 1)
    this.next.disabled ||= active.y === 9999 && (this.mode !== 'days' || active.m === 12)
    this.today.hidden = this.control.props.get('todaysection') === false
    this.today.textContent = `Today: ${label(this.control.today, { day: 'numeric', month: 'long', year: 'numeric' })}`
    this.heading.replaceChildren()
    const rowCount = this.mode === 'days' ? 6 : 4
    const columns = this.mode === 'days' ? weeks ? 8 : 7 : 3
    if (this.body.rows.length !== rowCount || [...this.body.rows].some((row) => row.cells.length !== columns)) this.body.replaceChildren()
    if (this.mode === 'days') {
      const row = this.heading.insertRow()
      if (weeks) {
        const week = document.createElement('th')
        week.textContent = '#'
        week.setAttribute('aria-label', 'Week number')
        row.append(week)
      }
      for (let i = 0; i < 7; i++) {
        const day = new PBDate(PBDate.ymd(2024, 1, 7).n + (first + i) % 7)
        const cell = document.createElement('th')
        cell.scope = 'col'
        cell.textContent = label(day, { weekday: 'narrow' })
        cell.setAttribute('aria-label', label(day, { weekday: 'long' }))
        row.append(cell)
      }
      const start = calendarWeekStart(PBDate.ymd(active.y, active.m, 1), first)
      for (let r = 0; r < 6; r++) {
        const row = this.body.rows[r] ?? this.body.insertRow()
        if (weeks) {
          const week = row.cells[0] ?? document.createElement('th')
          week.scope = 'row'
          week.textContent = String(calendarWeekNumber(new PBDate(start.n + r * 7), first))
          week.setAttribute('aria-label', `Week ${week.textContent}`)
          if (!week.parentElement) row.append(week)
        }
        for (let d = 0; d < 7; d++) {
          const date = new PBDate(start.n + r * 7 + d)
          const cell = row.cells[d + (weeks ? 1 : 0)] ?? row.insertCell()
          this.cell(cell, date, String(date.d), label(date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }), date.n === active.n, tabIndex, disabled)
          cell.classList.toggle('calendar-trailing', date.m !== active.m)
          if (date.n === this.control.today.n) {
            cell.setAttribute('aria-current', 'date')
            cell.classList.toggle('calendar-today-mark', this.control.props.get('todaycircle') !== false)
          }
        }
      }
    } else {
      for (let i = 0; i < 12; i++) {
        const row = this.body.rows[Math.floor(i / 3)] ?? this.body.insertRow()
        const year = this.mode === 'months' ? active.y : Math.floor(active.y / 10) * 10 - 1 + i
        const month = this.mode === 'months' ? i + 1 : active.m
        const date = year < 1601 || year > 9999 ? PBDate.ymd(year, month, 1) :
          calendarMonth(active, (year - active.y) * 12 + month - active.m)
        const text = this.mode === 'months' ? label(date, { month: 'short' }) : String(year)
        this.cell(row.cells[i % 3] ?? row.insertCell(), date, text, this.mode === 'months' ? label(date, { month: 'long', year: 'numeric' }) : text,
          this.mode === 'months' ? i + 1 === active.m : year === active.y, tabIndex, disabled)
      }
    }
    if (restore || focus && this.el.contains(document.activeElement)) this.focus()
    if (this.live.textContent !== this.title.textContent) this.live.textContent = this.title.textContent
  }

  private cell(cell: HTMLTableCellElement, date: PBDate, text: string, accessible: string, current: boolean, order: number, disabled: boolean): void {
    cell.className = ''
    cell.removeAttribute('aria-current')
    cell.setAttribute('role', 'gridcell')
    cell.setAttribute('aria-label', accessible)
    cell.setAttribute('aria-selected', String(current))
    cell.setAttribute('aria-disabled', String(disabled || date.n < CALENDAR_MIN || date.n > CALENDAR_MAX))
    cell.dataset.date = String(date.n)
    cell.dataset.current = String(current)
    cell.textContent = text
    cell.tabIndex = !disabled && current ? order : -1
    cell.dataset.tab = String(order > 0 ? order : 9999)
  }

  private scheduleMidnight(): void {
    const now = new Date()
    const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
    this.midnight = setTimeout(() => {
      if (this.disposed) return
      this.refresh()
      this.scheduleMidnight()
    }, next.getTime() - now.getTime() + 25)
  }

  dispose(): void {
    this.disposed = true
    this.lifetime.abort()
    clearTimeout(this.midnight)
  }
}
