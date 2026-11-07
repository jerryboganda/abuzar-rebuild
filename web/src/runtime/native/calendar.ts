import type { Runtime } from '../interp.ts'
import { Ref } from '../interp.ts'
import { PBDate, PBDateTime } from '../values.ts'
import { NControl } from './controls.ts'

export const CALENDAR_MIN = PBDate.ymd(1601, 1, 1).n
export const CALENDAR_MAX = PBDate.ymd(9999, 12, 31).n

function calendarDate(value: unknown): PBDate | null {
  const date = value instanceof PBDateTime ? value.date : value
  return date instanceof PBDate && Number.isInteger(date.n) && date.n >= CALENDAR_MIN && date.n <= CALENDAR_MAX ?
    new PBDate(date.n) : null
}

export function calendarMonth(date: PBDate, offset: number): PBDate {
  const month = Math.min(9999 * 12 + 11, Math.max(1601 * 12, date.y * 12 + date.m - 1 + offset))
  const year = Math.floor(month / 12), number = month % 12 + 1
  const last = PBDate.ymd(year, number + 1, 1).n - PBDate.ymd(year, number, 1).n
  return PBDate.ymd(year, number, Math.min(date.d, last))
}

export function calendarWeekStart(date: PBDate, firstDay: number): PBDate {
  return new PBDate(date.n - (date.dow - 1 - firstDay + 7) % 7)
}

export function calendarWeekNumber(date: PBDate, firstDay: number): number {
  const start = calendarWeekStart(date, firstDay)
  const year = new PBDate(start.n + 3).y
  return 1 + Math.floor((start.n - calendarWeekStart(PBDate.ymd(year, 1, 4), firstDay).n) / 7)
}

/** Single-date methods used by the source calendar; SetToday does not select a date. */
export class NCalendar extends NControl {
  private selected = PBDateTime.fromJs(new Date()).date
  private todayOverride: PBDate | null = null

  constructor(rt: Runtime, className: string) {
    super(rt, className, 'monthcalendar')
  }

  get selectedDate(): PBDate { return new PBDate(this.selected.n) }
  get today(): PBDate { return this.todayOverride ? new PBDate(this.todayOverride.n) : PBDateTime.fromJs(new Date()).date }

  async n_setselecteddate(value: unknown): Promise<number> {
    const date = calendarDate(value)
    if (!date || this.props.get('multiselect') === true) return -1
    this.selected = date
    this.changed()
    await this.rt.fire(this, 'datechanged')
    return 0
  }

  async n_getselecteddate(ref: unknown): Promise<number> {
    if (!(ref instanceof Ref)) return -2
    await ref.set(this.selectedDate)
    return this.props.get('multiselect') === true ? -1 : 0
  }

  n_settoday(value: unknown): number {
    const date = calendarDate(value)
    if (!date) return -1
    this.todayOverride = date
    this.changed()
    return 0
  }

  n_gettoday(): PBDate { return this.today }
}
