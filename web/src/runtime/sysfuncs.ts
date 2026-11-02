// System functions of PowerScript (global functions that need no receiver).
import type { Runtime, SysFunc } from './interp.ts'
import { Ref } from './interp.ts'
import { PBObject } from './object.ts'
import {
  Dec, PBDate, PBDateTime, PBTime, PBArray, PBRuntimeError, civilFromDays, coerce, daysFromCivil, formatDate, formatNumber, formatTime, isNull, toNum, toStr, MONTHS, DAYS, cmp,
} from './values.ts'

type Fn = (rt: Runtime, a: unknown[]) => unknown | Promise<unknown>

function def(rt: Runtime, name: string, fn: Fn, refs?: number[]): void {
  const e: SysFunc = { fn: (r, a) => fn(r, a) }
  if (refs) e.refs = refs
  rt.sys.set(name, e)
}

const s = (v: unknown): string => toStr(v)
const n = (v: unknown): number => toNum(v)
const nul = (a: unknown[]): boolean => a.some((x) => x === null || x === undefined)

export function parseDate(text: string): PBDate | null {
  const t = text.trim()
  let m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/.exec(t)
  if (m) return validDate(+m[1], +m[2], +m[3])
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/.exec(t)
  if (m) return validDate(+m[3] < 100 ? 2000 + +m[3] : +m[3], +m[2], +m[1])
  return null
}
function validDate(y: number, mo: number, d: number): PBDate | null {
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null
  const dt = PBDate.ymd(y, mo, d)
  const [yy, mm, dd] = civilFromDays(dt.n)
  return yy === y && mm === mo && dd === d ? dt : null
}
export function parseTime(text: string): PBTime | null {
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2})(?:[.:](\d+))?)?\s*([AaPp][Mm])?$/.exec(text.trim())
  if (!m) return null
  let h = +m[1]
  if (m[5]) {
    const pm = m[5].toLowerCase() === 'pm'
    if (pm && h < 12) h += 12
    if (!pm && h === 12) h = 0
  }
  if (h > 23 || +m[2] > 59 || (m[3] && +m[3] > 59)) return null
  return PBTime.hms(h, +m[2], m[3] ? +m[3] : 0, m[4] ? Math.floor(+('0.' + m[4]) * 1000) : 0)
}

export function nowDateTime(): PBDateTime {
  return PBDateTime.fromJs(new Date())
}

/** string(value [, format]) */
export function formatValue(v: unknown, fmt?: string): string {
  if (v === null || v === undefined) return ''
  if (fmt !== undefined && fmt !== '') {
    if (typeof v === 'number' || v instanceof Dec) return formatNumber(v, fmt)
    if (v instanceof PBDate) return formatDate(v, fmt)
    if (v instanceof PBTime) return formatTime(v, fmt)
    if (v instanceof PBDateTime) return formatTime(v.time, formatDate(v.date, fmt))
    if (typeof v === 'string') {
      // string masks: @ = any character
      let i = 0
      return fmt.replace(/@/g, () => v[i++] ?? '')
    }
  }
  return s(v)
}

/** PowerBuilder converts the leading number of a string and ignores what follows (Integer("2,") = 2: the menu rights code relies on it); 0 without a number */
function leadingNumber(text: string): number {
  const m = /^\s*[+-]?(\d+(\.\d*)?|\.\d+)/.exec(text)
  return m ? Number(m[0]) : 0
}

export function registerSysFuncs(rt: Runtime): void {
  // ------------------------------------------------------------------ type conversion
  def(rt, 'string', (_r, a) => (a[0] === null ? null : formatValue(a[0], a.length > 1 ? s(a[1]) : undefined)))
  def(rt, 'integer', (_r, a) => (isNull(a[0]) ? null : typeof a[0] === 'string' ? coerce('integer', leadingNumber(a[0])) : coerce('integer', a[0])))
  def(rt, 'int', (_r, a) => (isNull(a[0]) ? null : Math.floor(n(a[0]))))
  def(rt, 'long', (_r, a) => (isNull(a[0]) ? null : typeof a[0] === 'string' ? coerce('long', leadingNumber(a[0])) : coerce('long', a[0])))
  def(rt, 'longlong', (_r, a) => (isNull(a[0]) ? null : Math.trunc(n(a[0]))))
  def(rt, 'double', (_r, a) => (isNull(a[0]) ? null : typeof a[0] === 'string' && !/^\s*[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?\s*$/.test(a[0]) ? 0 : n(a[0])))
  def(rt, 'real', (_r, a) => (isNull(a[0]) ? null : n(a[0])))
  def(rt, 'dec', (_r, a) => (isNull(a[0]) ? null : coerce('decimal', a[0])))
  def(rt, 'decimal', (_r, a) => (isNull(a[0]) ? null : coerce('decimal', a[0])))
  def(rt, 'char', (_r, a) => (isNull(a[0]) ? null : typeof a[0] === 'string' ? a[0].slice(0, 1) : String.fromCharCode(n(a[0]))))
  def(rt, 'asc', (_r, a) => (isNull(a[0]) ? null : s(a[0]).charCodeAt(0) || 0))
  def(rt, 'boolean', (_r, a) => (isNull(a[0]) ? null : n(a[0]) !== 0))
  def(rt, 'blob', (_r, a) => (typeof a[0] === 'string' ? new TextEncoder().encode(a[0]) : new Uint8Array(0)))

  // ------------------------------------------------------------------ tests
  def(rt, 'isnull', (_r, a) => isNull(a[0]))
  def(rt, 'setnull', async (_r, a) => {
    if (a[0] instanceof Ref) await a[0].set(null)
    return null
  }, [0])
  def(rt, 'isvalid', (_r, a) => a[0] instanceof PBObject && !a[0].destroyed)
  def(rt, 'isnumber', (_r, a) => !isNull(a[0]) && /^\s*[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?\s*$/.test(s(a[0])))
  def(rt, 'isdate', (_r, a) => !isNull(a[0]) && parseDate(s(a[0])) !== null)
  def(rt, 'istime', (_r, a) => !isNull(a[0]) && parseTime(s(a[0])) !== null)
  def(rt, 'isnumeric', (_r, a) => typeof a[0] === 'number' || a[0] instanceof Dec)
  def(rt, 'isempty', (_r, a) => a[0] instanceof PBArray && a[0].a.length === 0)

  // ------------------------------------------------------------------ strings
  def(rt, 'trim', (_r, a) => (isNull(a[0]) ? null : s(a[0]).replace(/^ +| +$/g, '')))
  def(rt, 'lefttrim', (_r, a) => (isNull(a[0]) ? null : s(a[0]).replace(/^ +/, '')))
  def(rt, 'righttrim', (_r, a) => (isNull(a[0]) ? null : s(a[0]).replace(/ +$/, '')))
  def(rt, 'upper', (_r, a) => (isNull(a[0]) ? null : s(a[0]).toUpperCase()))
  def(rt, 'lower', (_r, a) => (isNull(a[0]) ? null : s(a[0]).toLowerCase()))
  def(rt, 'len', (_r, a) => (isNull(a[0]) ? null : a[0] instanceof Uint8Array ? a[0].length : s(a[0]).length))
  def(rt, 'left', (_r, a) => (nul(a) ? null : s(a[0]).slice(0, Math.max(0, n(a[1])))))
  def(rt, 'right', (_r, a) => (nul(a) ? null : n(a[1]) <= 0 ? '' : s(a[0]).slice(-n(a[1]))))
  def(rt, 'mid', (_r, a) => {
    if (a[0] === null || a[1] === null) return null
    const start = Math.max(1, n(a[1]))
    return a.length > 2 && a[2] !== null ? s(a[0]).substr(start - 1, Math.max(0, n(a[2]))) : s(a[0]).slice(start - 1)
  })
  def(rt, 'pos', (_r, a) => {
    if (nul(a.slice(0, 2))) return null
    const from = a.length > 2 ? Math.max(1, n(a[2])) : 1
    return s(a[0]).indexOf(s(a[1]), from - 1) + 1
  })
  def(rt, 'lastpos', (_r, a) => {
    if (nul(a.slice(0, 2))) return null
    const hay = a.length > 2 ? s(a[0]).slice(0, n(a[2])) : s(a[0])
    return hay.lastIndexOf(s(a[1])) + 1
  })
  def(rt, 'space', (_r, a) => (isNull(a[0]) ? null : ' '.repeat(Math.max(0, n(a[0])))))
  def(rt, 'fill', (_r, a) => (nul(a) ? null : s(a[0]).repeat(Math.max(0, Math.ceil(n(a[1]) / Math.max(1, s(a[0]).length)))).slice(0, Math.max(0, n(a[1])))))
  def(rt, 'replace', (_r, a) => {
    if (nul(a)) return null
    const str = s(a[0])
    const start = n(a[1]) - 1
    return str.slice(0, start) + s(a[3]) + str.slice(start + n(a[2]))
  })
  def(rt, 'reverse', (_r, a) => (isNull(a[0]) ? null : [...s(a[0])].reverse().join('')))
  def(rt, 'wordcap', (_r, a) => (isNull(a[0]) ? null : s(a[0]).toLowerCase().replace(/(^|[^a-z0-9'])([a-z])/g, (_m, p, c) => p + c.toUpperCase())))
  def(rt, 'match', (_r, a) => (nul(a) ? null : new RegExp(s(a[1])).test(s(a[0]))))
  def(rt, 'compare', (_r, a) => Math.sign(cmp(s(a[0]), s(a[1]))))
  def(rt, 'stringcompare', (_r, a) => Math.sign(cmp(s(a[0]), s(a[1]))))

  // ------------------------------------------------------------------ numbers
  const roundTo = (v: unknown, places: number): unknown => {
    if (v instanceof Dec) return v.round(places)
    const d = Dec.of(n(v)).round(places)
    return d.toNumber()
  }
  def(rt, 'round', (_r, a) => (nul(a) ? null : roundTo(a[0], a.length > 1 ? n(a[1]) : 0)))
  def(rt, 'truncate', (_r, a) => {
    if (nul(a)) return null
    const places = a.length > 1 ? n(a[1]) : 0
    return a[0] instanceof Dec ? a[0].trunc(places) : Dec.of(n(a[0])).trunc(places).toNumber()
  })
  def(rt, 'ceiling', (_r, a) => (isNull(a[0]) ? null : Math.ceil(n(a[0]))))
  def(rt, 'floor', (_r, a) => (isNull(a[0]) ? null : Math.floor(n(a[0]))))
  def(rt, 'abs', (_r, a) => (isNull(a[0]) ? null : a[0] instanceof Dec ? (a[0].u < 0n ? a[0].neg() : a[0]) : Math.abs(n(a[0]))))
  def(rt, 'sign', (_r, a) => (isNull(a[0]) ? null : Math.sign(n(a[0]))))
  def(rt, 'mod', (_r, a) => (nul(a) ? null : n(a[0]) % n(a[1])))
  def(rt, 'min', (_r, a) => (nul(a) ? null : Math.min(n(a[0]), n(a[1]))))
  def(rt, 'max', (_r, a) => (nul(a) ? null : Math.max(n(a[0]), n(a[1]))))
  def(rt, 'sqrt', (_r, a) => (isNull(a[0]) ? null : Math.sqrt(n(a[0]))))
  def(rt, 'exp', (_r, a) => (isNull(a[0]) ? null : Math.exp(n(a[0]))))
  def(rt, 'log', (_r, a) => (isNull(a[0]) ? null : Math.log(n(a[0]))))
  def(rt, 'logten', (_r, a) => (isNull(a[0]) ? null : Math.log10(n(a[0]))))
  def(rt, 'sin', (_r, a) => Math.sin(n(a[0])))
  def(rt, 'cos', (_r, a) => Math.cos(n(a[0])))
  def(rt, 'tan', (_r, a) => Math.tan(n(a[0])))
  def(rt, 'pi', (_r, a) => Math.PI * (a.length ? n(a[0]) : 1))
  def(rt, 'rand', (_r, a) => 1 + Math.floor(Math.random() * Math.max(1, n(a[0]))))
  def(rt, 'randomize', () => 0)

  // ------------------------------------------------------------------ dates and times
  def(rt, 'today', () => nowDateTime().date)
  // Licensing (decision of the owner: the rebuild has no licence checks). The recovered vendor checks - the expiry check of the transaction windows
  // and the decoding of the licence key (SysTextCatalog) - are replaced: nothing expires, the key is not read.
  def(rt, 'f_islicenseexpire', () => 0)
  def(
    rt,
    'f_getlicinfo',
    async (_r, a) => {
      // (transaction, key, ref start date, ref duration, ref iteration, ref first, ref second, ref key)
      const out: unknown[] = [nowDateTime(), 1, 0, 0, 0, '']
      for (let i = 0; i < out.length; i++) if (a[i + 2] instanceof Ref) await (a[i + 2] as Ref).set(out[i])
      return 0
    },
    [2, 3, 4, 5, 6, 7],
  )
  def(rt, 'now', () => nowDateTime().time)
  def(rt, 'date', (_r, a) => {
    if (a.length >= 3) return PBDate.ymd(n(a[0]), n(a[1]), n(a[2]))
    const v = a[0]
    if (v === null || v === undefined) return null
    if (v instanceof PBDate) return v
    if (v instanceof PBDateTime) return v.date
    return parseDate(s(v))
  })
  def(rt, 'time', (_r, a) => {
    if (a.length >= 3) return PBTime.hms(n(a[0]), n(a[1]), n(a[2]))
    const v = a[0]
    if (v === null || v === undefined) return null
    if (v instanceof PBTime) return v
    if (v instanceof PBDateTime) return v.time
    return parseTime(s(v))
  })
  def(rt, 'datetime', (_r, a) => {
    const v = a[0]
    if (v === null || v === undefined) return null
    if (v instanceof PBDateTime) return v
    if (v instanceof PBDate) return new PBDateTime(v.n, a[1] instanceof PBTime ? a[1].ms : 0)
    const txt = s(v)
    const sp = txt.trim().split(/\s+/)
    const d = parseDate(sp[0])
    if (!d) return null
    const t = sp[1] ? parseTime(sp.slice(1).join(' ')) : new PBTime(0)
    return new PBDateTime(d.n, t ? t.ms : 0)
  })
  const dpart = (v: unknown): PBDate | null => (v instanceof PBDate ? v : v instanceof PBDateTime ? v.date : typeof v === 'string' ? parseDate(v) : null)
  def(rt, 'year', (_r, a) => dpart(a[0])?.y ?? null)
  def(rt, 'month', (_r, a) => dpart(a[0])?.m ?? null)
  def(rt, 'day', (_r, a) => dpart(a[0])?.d ?? null)
  def(rt, 'hour', (_r, a) => (a[0] instanceof PBTime ? a[0].h : a[0] instanceof PBDateTime ? a[0].time.h : null))
  def(rt, 'minute', (_r, a) => (a[0] instanceof PBTime ? a[0].mi : a[0] instanceof PBDateTime ? a[0].time.mi : null))
  def(rt, 'second', (_r, a) => (a[0] instanceof PBTime ? a[0].s : a[0] instanceof PBDateTime ? a[0].time.s : null))
  def(rt, 'daynumber', (_r, a) => dpart(a[0])?.dow ?? null)
  def(rt, 'dayname', (_r, a) => {
    const d = dpart(a[0])
    return d ? DAYS[d.dow - 1] : null
  })
  def(rt, 'monthname', (_r, a) => {
    const d = dpart(a[0])
    return d ? MONTHS[d.m - 1] : null
  })
  def(rt, 'daysafter', (_r, a) => {
    const x = dpart(a[0])
    const y = dpart(a[1])
    return x && y ? y.n - x.n : null
  })
  def(rt, 'relativedate', (_r, a) => {
    const d = dpart(a[0])
    return d ? new PBDate(d.n + n(a[1])) : null
  })
  def(rt, 'secondsafter', (_r, a) => (a[0] instanceof PBTime && a[1] instanceof PBTime ? Math.round((a[1].ms - a[0].ms) / 1000) : null))
  def(rt, 'relativetime', (_r, a) => (a[0] instanceof PBTime ? new PBTime((((a[0].ms + n(a[1]) * 1000) % 86400000) + 86400000) % 86400000) : null))
  def(rt, 'daysinmonth', (_r, a) => {
    const d = dpart(a[0])
    return d ? new Date(d.y, d.m, 0).getDate() : null
  })
  void daysFromCivil

  // ------------------------------------------------------------------ arrays
  def(rt, 'upperbound', (_r, a) => (a[0] instanceof PBArray ? a[0].a.length : 0))
  def(rt, 'lowerbound', () => 1)

  // ------------------------------------------------------------------ environment / misc
  def(rt, 'setpointer', () => 0)
  def(rt, 'yield', () => 1)
  def(rt, 'garbagecollect', () => 0)
  def(rt, 'handle', () => 0)
  def(rt, 'send', () => 0)
  def(rt, 'pixelstounits', (_r, a) => Math.round(n(a[0]) / (String(a[1]).startsWith('y') ? PX_PER_PBU_Y : PX_PER_PBU_X)))
  def(rt, 'unitstopixels', (_r, a) => Math.round(n(a[0]) * (String(a[1]).startsWith('y') ? PX_PER_PBU_Y : PX_PER_PBU_X)))
  def(rt, 'getenvironment', async (_r, a) => {
    if (a[0] instanceof Ref) {
      const env = await rt.instantiate('environment')
      // the screen the program runs on (windows lay themselves out from it: tab = 99 % of the screen width ...); 1366 x 768 without a display (tests)
      const scr = (globalThis as { screen?: { width: number; height: number } }).screen
      env.props.set('screenwidth', scr?.width || 1366)
      env.props.set('screenheight', scr?.height || 768)
      env.props.set('numberofcolors', 16777216)
      env.props.set('win32', true)
      env.props.set('pbmajorrevision', 12)
      env.props.set('pbminorrevision', 5)
      await a[0].set(env)
    }
    return 1
  }, [0])
  def(rt, 'messagebox', async (r, a) => {
    if (!r.ui) return 1
    r.yieldQueue() // the box waits for its answer: posted events go on meanwhile
    return r.ui.messageBox(s(a[0]), s(a[1]), a.length > 2 ? s(a[2]) : 'information!', a.length > 3 ? s(a[3]) : 'ok!', a.length > 4 ? n(a[4]) : 1)
  })
}

/** pixels per PowerBuilder unit (system font cell 6 x 13 pixels: 1 PBU = 1/32 cell width, 1/64 cell height) - calibrate against the original */
/**
 * measured on the original running on Windows 11 at 96 dpi: vertically 16/64 (Cash Sale: tab page top + 876 PBU = grid header, Login: Ok button at 808 PBU = 203 px
 * below the title bar), horizontally 7/32 (Login: window 1582 PBU = 346 px, Ok button at 306 PBU = 68 px, Cancel at 887 PBU = 195 px).
 * That is a dialog base unit of 7 x 16 pixels.
 */
export const PX_PER_PBU_X = 7 / 32
export const PX_PER_PBU_Y = 16 / 64
