// PowerScript value model.
//   integer / long / unsigned* / double / real -> JS number        decimal -> Dec (exact)
//   string -> string        boolean -> boolean       null -> null
//   date / time / datetime -> PBDate / PBTime / PBDateTime       blob -> Uint8Array
//   any array -> PBArray      objects -> PBObject (runtime/object.ts)

// ---------------------------------------------------------------------------------------------- exact decimal
export class Dec {
  u: bigint // unscaled value
  s: number // scale (digits after the point)
  constructor(u: bigint, s: number) {
    this.u = u
    this.s = s
  }

  static parse(text: string): Dec {
    const m = /^\s*([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?\s*$/.exec(text)
    if (!m || (m[2] === '' && (m[3] === undefined || m[3] === ''))) throw new Error('bad decimal: ' + text)
    let frac = m[3] || ''
    let u = BigInt((m[2] || '0') + frac)
    let s = frac.length
    if (m[4]) {
      const e = Number(m[4])
      if (e >= 0) {
        u *= 10n ** BigInt(Math.max(0, e - s))
        s = Math.max(0, s - e)
      } else s -= e
    }
    return new Dec(m[1] === '-' ? -u : u, s)
  }

  static of(v: number | string | bigint | Dec): Dec {
    if (v instanceof Dec) return v
    if (typeof v === 'bigint') return new Dec(v, 0)
    if (typeof v === 'string') return Dec.parse(v)
    if (Number.isInteger(v)) return new Dec(BigInt(v), 0)
    // doubles: use the shortest round-tripping decimal text, like a human reading the number
    return Dec.parse(String(v))
  }

  private static align(a: Dec, b: Dec): [bigint, bigint, number] {
    if (a.s === b.s) return [a.u, b.u, a.s]
    if (a.s > b.s) return [a.u, b.u * 10n ** BigInt(a.s - b.s), a.s]
    return [a.u * 10n ** BigInt(b.s - a.s), b.u, b.s]
  }
  add(o: Dec): Dec {
    const [x, y, s] = Dec.align(this, o)
    return new Dec(x + y, s)
  }
  sub(o: Dec): Dec {
    const [x, y, s] = Dec.align(this, o)
    return new Dec(x - y, s)
  }
  mul(o: Dec): Dec {
    return new Dec(this.u * o.u, this.s + o.s).limit()
  }
  /** division keeps up to 18 significant fraction digits (the PowerBuilder decimal limit), rounding half away from zero */
  div(o: Dec): Dec {
    if (o.u === 0n) throw new Error('division by zero')
    const extra = 18
    const num = this.u * 10n ** BigInt(extra)
    let q = num / o.u
    const r = num % o.u
    if (2n * (r < 0n ? -r : r) >= (o.u < 0n ? -o.u : o.u)) q += (num < 0n) !== (o.u < 0n) ? -1n : 1n
    return new Dec(q, this.s + extra - o.s).limit().normalize()
  }
  neg(): Dec {
    return new Dec(-this.u, this.s)
  }
  cmp(o: Dec): number {
    const [x, y] = Dec.align(this, o)
    return x < y ? -1 : x > y ? 1 : 0
  }
  isZero(): boolean {
    return this.u === 0n
  }
  limit(): Dec {
    if (this.s > 18) return this.round(18)
    return this
  }
  normalize(): Dec {
    let u = this.u
    let s = this.s
    while (s > 0 && u % 10n === 0n) {
      u /= 10n
      s--
    }
    return new Dec(u, s)
  }
  /** round half away from zero to `places` fraction digits (places may be negative) */
  round(places: number): Dec {
    if (places >= this.s) return this
    const drop = BigInt(this.s - places)
    const p = 10n ** drop
    let q = this.u / p
    const r = this.u % p
    if (2n * (r < 0n ? -r : r) >= p) q += this.u < 0n ? -1n : 1n
    return places >= 0 ? new Dec(q, places) : new Dec(q * 10n ** BigInt(-places), 0)
  }
  trunc(places: number): Dec {
    if (places >= this.s) return this
    const p = 10n ** BigInt(this.s - places)
    const q = this.u / p
    return places >= 0 ? new Dec(q, places) : new Dec(q * 10n ** BigInt(-places), 0)
  }
  toNumber(): number {
    return Number(this.toString())
  }
  toString(): string {
    const neg = this.u < 0n
    let digits = (neg ? -this.u : this.u).toString()
    if (this.s > 0) {
      digits = digits.padStart(this.s + 1, '0')
      digits = digits.slice(0, digits.length - this.s) + '.' + digits.slice(digits.length - this.s)
    }
    return (neg ? '-' : '') + digits
  }
  /** fixed string with exactly `places` digits */
  toFixed(places: number): string {
    return this.round(places).padScale(places).toString()
  }
  private padScale(places: number): Dec {
    return this.s >= places ? this : new Dec(this.u * 10n ** BigInt(places - this.s), places)
  }
  toJSON(): string {
    return this.toString()
  }
}

// ---------------------------------------------------------------------------------------------- dates
const MS_DAY = 86400000

export function daysFromCivil(y: number, m: number, d: number): number {
  // days since 1970-01-01 (proleptic Gregorian)
  y -= m <= 2 ? 1 : 0
  const era = Math.floor(y / 400)
  const yoe = y - era * 400
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy
  return era * 146097 + doe - 719468
}
export function civilFromDays(z: number): [number, number, number] {
  z += 719468
  const era = Math.floor(z / 146097)
  const doe = z - era * 146097
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365)
  const y = yoe + era * 400
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100))
  const mp = Math.floor((5 * doy + 2) / 153)
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1
  const m = mp + (mp < 10 ? 3 : -9)
  return [y + (m <= 2 ? 1 : 0), m, d]
}

export class PBDate {
  n: number // days since 1970-01-01
  constructor(n: number) {
    this.n = n
  }
  static ymd(y: number, m: number, d: number): PBDate {
    return new PBDate(daysFromCivil(y, m, d))
  }
  get y(): number {
    return civilFromDays(this.n)[0]
  }
  get m(): number {
    return civilFromDays(this.n)[1]
  }
  get d(): number {
    return civilFromDays(this.n)[2]
  }
  /** day of week, 1 = Sunday */
  get dow(): number {
    return ((((this.n + 4) % 7) + 7) % 7) + 1
  }
}
export class PBTime {
  ms: number // milliseconds since midnight (microseconds are not kept)
  constructor(ms: number) {
    this.ms = ms
  }
  static hms(h: number, m: number, s: number, ms = 0): PBTime {
    return new PBTime(((h * 60 + m) * 60 + s) * 1000 + ms)
  }
  get h(): number {
    return Math.floor(this.ms / 3600000) % 24
  }
  get mi(): number {
    return Math.floor(this.ms / 60000) % 60
  }
  get s(): number {
    return Math.floor(this.ms / 1000) % 60
  }
  get frac(): number {
    return this.ms % 1000
  }
}
export class PBDateTime {
  n: number // day number
  ms: number // ms in day
  constructor(n: number, ms: number) {
    this.n = n
    this.ms = ms
  }
  get date(): PBDate {
    return new PBDate(this.n)
  }
  get time(): PBTime {
    return new PBTime(this.ms)
  }
  static fromJs(d: Date): PBDateTime {
    return new PBDateTime(daysFromCivil(d.getFullYear(), d.getMonth() + 1, d.getDate()), ((d.getHours() * 60 + d.getMinutes()) * 60 + d.getSeconds()) * 1000 + d.getMilliseconds())
  }
  total(): number {
    return this.n * MS_DAY + this.ms
  }
}
export const DATE_ZERO = PBDate.ymd(1900, 1, 1)

// ---------------------------------------------------------------------------------------------- arrays / helpers
export class PBArray {
  a: unknown[] = []
  type: string
  constructor(type: string, a: unknown[] = []) {
    this.type = type
    this.a = a
  }
}

export function isNull(v: unknown): boolean {
  return v === null || v === undefined
}

export function defaultValue(type: string): unknown {
  switch (type) {
    case 'integer':
    case 'long':
    case 'longlong':
    case 'unsignedinteger':
    case 'uint':
    case 'unsignedlong':
    case 'ulong':
    case 'double':
    case 'real':
    case 'byte':
      return 0
    case 'decimal':
    case 'dec':
      return new Dec(0n, 0)
    case 'string':
      return ''
    case 'boolean':
      return false
    case 'char':
      return ' '
    case 'date':
      return DATE_ZERO
    case 'time':
      return new PBTime(0)
    case 'datetime':
      return new PBDateTime(DATE_ZERO.n, 0)
    case 'blob':
      return new Uint8Array(0)
    default:
      return null // objects, any
  }
}

export const NUMERIC_TYPES = new Set(['integer', 'long', 'longlong', 'unsignedinteger', 'uint', 'unsignedlong', 'ulong', 'double', 'real', 'byte', 'decimal', 'dec'])

export function toNum(v: unknown): number {
  if (typeof v === 'number') return v
  if (v instanceof Dec) return v.toNumber()
  if (typeof v === 'boolean') return v ? 1 : 0
  if (typeof v === 'string') {
    const n = Number(v.trim())
    return Number.isNaN(n) ? 0 : n
  }
  if (v === null || v === undefined) return 0
  return Number(v as number)
}

/** coerce a value to a declared PowerScript type on assignment */
export function coerce(type: string, v: unknown): unknown {
  if (v === null || v === undefined) return null
  switch (type) {
    case 'integer':
      return wrap(Math.trunc(toNum(v)), 16, true)
    case 'long':
      return wrap(Math.trunc(toNum(v)), 32, true)
    case 'unsignedinteger':
    case 'uint':
      return wrap(Math.trunc(toNum(v)), 16, false)
    case 'unsignedlong':
    case 'ulong':
      return wrap(Math.trunc(toNum(v)), 32, false)
    case 'longlong':
      return Math.trunc(toNum(v))
    case 'byte':
      return wrap(Math.trunc(toNum(v)), 8, false)
    case 'double':
    case 'real':
      return toNum(v)
    case 'decimal':
    case 'dec':
      if (v instanceof Dec) return v
      if (typeof v === 'number') return Dec.of(v)
      if (typeof v === 'string') {
        try {
          return Dec.parse(v)
        } catch {
          return new Dec(0n, 0)
        }
      }
      return Dec.of(toNum(v))
    case 'string':
      return typeof v === 'string' ? v : toStr(v)
    case 'boolean':
      return typeof v === 'boolean' ? v : toNum(v) !== 0
    default:
      return v
  }
}

function wrap(n: number, bits: number, signed: boolean): number {
  if (!Number.isFinite(n)) return 0
  const m = 2 ** bits
  let r = ((n % m) + m) % m
  if (signed && r >= m / 2) r -= m
  return r
}

export function toStr(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'string') return v
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(Number(v.toPrecision(15)))
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE'
  if (v instanceof Dec) return v.toString()
  if (v instanceof PBDate) return formatDate(v, 'dd/mm/yyyy')
  if (v instanceof PBTime) return formatTime(v, 'hh:mm:ss')
  if (v instanceof PBDateTime) return formatDate(v.date, 'dd/mm/yyyy') + ' ' + formatTime(v.time, 'hh:mm:ss')
  return String(v)
}

// ---------------------------------------------------------------------------------------------- comparison / arithmetic
export function cmp(a: unknown, b: unknown): number {
  if (a === null || a === undefined || b === null || b === undefined) return (a ?? null) === (b ?? null) ? 0 : a === null || a === undefined ? -1 : 1
  if (a instanceof Dec || b instanceof Dec) {
    if (typeof a === 'number' || typeof b === 'number') {
      const x = toNum(a)
      const y = toNum(b)
      return x < y ? -1 : x > y ? 1 : 0
    }
    return Dec.of(a as Dec).cmp(Dec.of(b as Dec))
  }
  if (typeof a === 'number' && typeof b === 'number') return a < b ? -1 : a > b ? 1 : 0
  if (typeof a === 'string' && typeof b === 'string') {
    // PowerScript string comparison is case sensitive
    return a < b ? -1 : a > b ? 1 : 0
  }
  if (a instanceof PBDate && b instanceof PBDate) return Math.sign(a.n - b.n)
  if (a instanceof PBTime && b instanceof PBTime) return Math.sign(a.ms - b.ms)
  if (a instanceof PBDateTime && b instanceof PBDateTime) return Math.sign(a.total() - b.total())
  if (a instanceof PBDateTime && b instanceof PBDate) return Math.sign(a.total() - b.n * MS_DAY)
  if (a instanceof PBDate && b instanceof PBDateTime) return Math.sign(a.n * MS_DAY - b.total())
  if (typeof a === 'boolean' && typeof b === 'boolean') return a === b ? 0 : a ? 1 : -1
  if (typeof a === 'number' && typeof b === 'boolean') return Math.sign(a - (b ? 1 : 0))
  if (typeof a === 'boolean' && typeof b === 'number') return Math.sign((a ? 1 : 0) - b)
  if (typeof a === 'string' && typeof b === 'number') return cmp(a, String(b))
  if (typeof a === 'number' && typeof b === 'string') return cmp(String(a), b)
  return a === b ? 0 : 1
}

export function equals(a: unknown, b: unknown): boolean {
  if (a !== null && b !== null && typeof a === 'object' && typeof b === 'object' && !(a instanceof Dec) && !(a instanceof PBDate) && !(a instanceof PBTime) && !(a instanceof PBDateTime)) return a === b
  return cmp(a, b) === 0
}

export function add(a: unknown, b: unknown): unknown {
  if (a === null || b === null || a === undefined || b === undefined) return null
  if (typeof a === 'string' || typeof b === 'string') return toStr(a) + toStr(b)
  if (a instanceof Dec || b instanceof Dec) return typeof a === 'number' && !Number.isInteger(a) || typeof b === 'number' && !Number.isInteger(b) ? toNum(a) + toNum(b) : Dec.of(a as Dec).add(Dec.of(b as Dec))
  return toNum(a) + toNum(b)
}
export function sub(a: unknown, b: unknown): unknown {
  if (a === null || b === null || a === undefined || b === undefined) return null
  if (a instanceof Dec || b instanceof Dec) return typeof a === 'number' && !Number.isInteger(a) || typeof b === 'number' && !Number.isInteger(b) ? toNum(a) - toNum(b) : Dec.of(a as Dec).sub(Dec.of(b as Dec))
  return toNum(a) - toNum(b)
}
export function mul(a: unknown, b: unknown): unknown {
  if (a === null || b === null || a === undefined || b === undefined) return null
  if (a instanceof Dec || b instanceof Dec) return typeof a === 'number' && !Number.isInteger(a) || typeof b === 'number' && !Number.isInteger(b) ? toNum(a) * toNum(b) : Dec.of(a as Dec).mul(Dec.of(b as Dec))
  return toNum(a) * toNum(b)
}
export function div(a: unknown, b: unknown): unknown {
  if (a === null || b === null || a === undefined || b === undefined) return null
  if (toNum(b) === 0) throw new PBRuntimeError('Division by zero')
  if (a instanceof Dec || b instanceof Dec) return typeof a === 'number' && !Number.isInteger(a) || typeof b === 'number' && !Number.isInteger(b) ? toNum(a) / toNum(b) : Dec.of(a as Dec).div(Dec.of(b as Dec))
  return toNum(a) / toNum(b)
}

export class PBRuntimeError extends Error {
  where = ''
  constructor(msg: string) {
    super(msg)
    this.name = 'PBRuntimeError'
  }
}

// ---------------------------------------------------------------------------------------------- formatting
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
export { MONTHS, DAYS }

const pad = (n: number, w: number) => String(n).padStart(w, '0')

export function formatDate(d: PBDate, mask: string): string {
  const [y, m, day] = civilFromDays(d.n)
  return mask.replace(/yyyy|yy|mmmm|mmm|mm|m|dddd|ddd|dd|d/gi, (t) => {
    switch (t.toLowerCase()) {
      case 'yyyy':
        return pad(y, 4)
      case 'yy':
        return pad(y % 100, 2)
      case 'mmmm':
        return MONTHS[m - 1]
      case 'mmm':
        return MONTHS[m - 1].slice(0, 3)
      case 'mm':
        return pad(m, 2)
      case 'm':
        return String(m)
      case 'dddd':
        return DAYS[d.dow - 1]
      case 'ddd':
        return DAYS[d.dow - 1].slice(0, 3)
      case 'dd':
        return pad(day, 2)
      default:
        return String(day)
    }
  })
}

export function formatTime(t: PBTime, mask: string): string {
  const ampm = /am\/pm|a\/p/i.test(mask)
  const h12 = t.h % 12 === 0 ? 12 : t.h % 12
  return mask.replace(/hh|h|mm|m|ss|s|fff+|ffffff|am\/pm|a\/p/gi, (tok) => {
    switch (tok.toLowerCase()) {
      case 'hh':
        return pad(ampm ? h12 : t.h, 2)
      case 'h':
        return String(ampm ? h12 : t.h)
      case 'mm':
        return pad(t.mi, 2)
      case 'm':
        return String(t.mi)
      case 'ss':
        return pad(t.s, 2)
      case 's':
        return String(t.s)
      case 'am/pm':
        return t.h < 12 ? 'AM' : 'PM'
      case 'a/p':
        return t.h < 12 ? 'A' : 'P'
      default:
        return pad(t.frac, 3).padEnd(tok.length, '0').slice(0, tok.length)
    }
  })
}

/** PowerBuilder numeric display mask: #, 0, comma, point, literal text, [general], optional ;negative section */
export function formatNumber(value: number | Dec, mask: string): string {
  if (mask === '' || /^\[general\]$/i.test(mask)) {
    // [general] shows the number without the column's stored scale: 1.0000 -> 1, 12.3400 -> 12.34
    const s = value instanceof Dec ? value.toString() : toStr(value)
    return /^-?\d+\.\d+$/.test(s) ? s.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '') : s
  }
  const sections = mask.split(';')
  const neg = (value instanceof Dec ? value.u < 0n : value < 0) && sections.length > 1
  const m = neg ? sections[1] : sections[0]
  const absVal = value instanceof Dec ? (value.u < 0n ? value.neg() : value) : Dec.of(Math.abs(value))
  const pointAt = m.indexOf('.')
  const intMask = pointAt >= 0 ? m.slice(0, pointAt) : m
  const fracMask = pointAt >= 0 ? m.slice(pointAt + 1) : ''
  const fracDigits = (fracMask.match(/[#0]/g) || []).length
  const fixed = absVal.round(fracDigits).toFixed(fracDigits)
  let [ip, fp = ''] = fixed.split('.')
  // integer part
  const minInt = (intMask.match(/0/g) || []).length
  if (ip === '0' && minInt === 0) ip = ''
  ip = ip.padStart(minInt, '0')
  const group = intMask.includes(',')
  // grouping distances come from the commas of the mask: "#,##,##,##0" groups 3 then 2 (Indian), "#,##0" groups of 3
  let sizes: number[] = [3]
  if (group) {
    const tail = intMask.replace(/[^#0,]/g, '')
    const parts = tail.split(',')
    sizes = parts.slice(1).map((p) => p.length).reverse()
    if (sizes.length === 0 || sizes[0] === 0) sizes = [3]
  }
  const digitsOut: string[] = []
  const src = ip
  let pos = src.length
  let gi = 0
  while (pos > 0) {
    const size = group ? sizes[Math.min(gi, sizes.length - 1)] : src.length
    digitsOut.unshift(src.slice(Math.max(0, pos - size), pos))
    pos -= size
    gi++
  }
  const intOut = group ? digitsOut.join(',') : src
  // '#' fraction places drop trailing zeros beyond the last '0' placeholder
  const lastZero = fracMask.replace(/[^#0]/g, '').lastIndexOf('0') + 1
  const fracShown = fp.slice(0, lastZero) + fp.slice(lastZero).replace(/0+$/, '')
  const body = intOut + (fracShown.length ? '.' + fracShown : '')
  const literalPrefix = m.replace(/[#0,.].*$/s, '')
  const literalSuffix = m.replace(/^.*[#0]/s, '').replace(/[#0,.]/g, '')
  const sign = (value instanceof Dec ? value.u < 0n : value < 0) && sections.length === 1 ? '-' : ''
  return sign + literalPrefix.replace(/[#0,.]/g, '') + body + literalSuffix
}
