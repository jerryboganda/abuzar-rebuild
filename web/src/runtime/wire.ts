// JSON wire format between the UI runtime and the Rust server (see server/src/wire.rs).
import { Dec, PBArray, PBDate, PBDateTime, PBTime, civilFromDays } from './values.ts'

export interface ColumnInfo {
  name: string
  /** PostgreSQL type name: int2 int4 int8 float4 float8 numeric text varchar bpchar bool timestamp timestamptz date time bytea uuid ... */
  type: string
}

export interface QueryResult {
  columns: ColumnInfo[]
  rows: unknown[][]
}

export interface DbError {
  code: string // SQLSTATE
  message: string
  detail?: string
}

export interface CallResult {
  columns: ColumnInfo[]
  /** first row: status / INOUT values and the names of the opened cursors (text) */
  row: (string | null)[] | null
  resultsets: { column: string; columns: ColumnInfo[]; rows: unknown[][] }[]
}

/** one database session (the server keeps a dedicated connection and transaction state per session) */
export interface Db {
  query(sql: string, params: unknown[]): Promise<QueryResult>
  exec(sql: string, params: unknown[]): Promise<{ rowcount: number }>
  /** stored procedure call (`SELECT * FROM dbo.sp(...)`) including its result sets */
  call(sql: string, params: unknown[]): Promise<CallResult>
  commit(): Promise<void>
  rollback(): Promise<void>
  close(): Promise<void>
}

const p2 = (n: number) => String(n).padStart(2, '0')
const p3 = (n: number) => String(n).padStart(3, '0')

export function toWire(v: unknown): unknown {
  if (v === null || v === undefined) return null
  if (v instanceof Dec) return v.toString()
  if (v instanceof PBDate) {
    const [y, m, d] = civilFromDays(v.n)
    return `${String(y).padStart(4, '0')}-${p2(m)}-${p2(d)}`
  }
  if (v instanceof PBDateTime) {
    const [y, m, d] = civilFromDays(v.n)
    const t = new PBTime(v.ms)
    return `${String(y).padStart(4, '0')}-${p2(m)}-${p2(d)} ${p2(t.h)}:${p2(t.mi)}:${p2(t.s)}.${p3(t.frac)}`
  }
  if (v instanceof PBTime) return `${p2(v.h)}:${p2(v.mi)}:${p2(v.s)}.${p3(v.frac)}`
  if (v instanceof PBArray) return v.a.map(toWire)
  if (v instanceof Uint8Array) return { $b64: btoa(String.fromCharCode(...v)) }
  if (typeof v === 'boolean') return v
  return v
}

export function fromWire(type: string, v: unknown): unknown {
  if (v === null || v === undefined) return null
  switch (type) {
    case 'numeric':
    case 'decimal':
      return Dec.parse(String(v))
    case 'int2':
    case 'int4':
    case 'int8':
    case 'float4':
    case 'float8':
    case 'oid':
      return typeof v === 'number' ? v : Number(v)
    case 'date': {
      const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v))
      return m ? PBDate.ymd(+m[1], +m[2], +m[3]) : null
    }
    case 'timestamp':
    case 'timestamptz': {
      const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?/.exec(String(v))
      if (!m) return null
      return new PBDateTime(PBDate.ymd(+m[1], +m[2], +m[3]).n, PBTime.hms(+m[4], +m[5], +m[6], m[7] ? Math.floor(+('0.' + m[7]) * 1000) : 0).ms)
    }
    case 'time':
    case 'timetz': {
      const m = /^(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?/.exec(String(v))
      return m ? PBTime.hms(+m[1], +m[2], +m[3], m[4] ? Math.floor(+('0.' + m[4]) * 1000) : 0) : null
    }
    case 'bytea': {
      const o = v as { $b64?: string }
      if (o && o.$b64 !== undefined) return Uint8Array.from(atob(o.$b64), (c) => c.charCodeAt(0))
      return new Uint8Array(0)
    }
    case 'bool':
      return v === true
    default:
      return typeof v === 'string' ? v : String(v)
  }
}
