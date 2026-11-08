// Database session over the Rust server's HTTP API (see server/src/lib.rs).
import type { Db, QueryResult, CallResult } from '../runtime/wire.ts'
import { askForToken, authHeaders } from '../runtime/apiauth.ts'
import { Dec } from '../runtime/values.ts'

/** application user of the audit trail: every open session (and every later one) carries it as the setting `app.user` */
let appUser = ''
const open = new Set<HttpDb>()
const SESSION_TZ = "SET TIME ZONE 'Asia/Karachi'"

export async function setAppUser(user: string): Promise<void> {
  appUser = user
  // a session setting is not a write: send it through /api/query, or every
  // session is marked dirty and the server's reaper keeps it for 8 hours
  for (const d of open) await d.query("SELECT set_config('app.user', $1, false)", [user]).catch(() => undefined)
}

interface ApiBody {
  error?: { code?: string; message: string }
}

/**
 * Parameters as the server expects them.  A PowerScript decimal travels as `{"$dec": "12.50"}` (exact text, no float rounding),
 * so the server can type it as a number where it is an operand of arithmetic (see server/src/sqlsub.rs) and keep the quoted
 * text everywhere else, as before.
 */
export function wireParams(params: readonly unknown[]): unknown[] {
  const wire = (value: unknown): unknown => value instanceof Dec ? { $dec: value.toString() } : Array.isArray(value) ? value.map(wire) : value
  return params.map(wire)
}

export class HttpDb implements Db {
  base: string
  sid = ''
  /** the PowerBuilder transaction's autocommit flag: the server keeps one connection/transaction per object */
  private autocommit: boolean
  /** concurrent requests that all see NOSESSION must share one new session */
  private reopening: Promise<void> | null = null
  constructor(base = '', autocommit = false) {
    this.base = base
    this.autocommit = autocommit
  }

  private async send(path: string, body: unknown): Promise<{ status: number; ok: boolean; json: ApiBody & Record<string, unknown> }> {
    const go = () => fetch(this.base + path, { method: 'POST', headers: { 'content-type': 'application/json', ...authHeaders() }, body: JSON.stringify(body) })
    let r = await go()
    let json = (await r.json().catch(() => ({}))) as ApiBody & Record<string, unknown>
    // 401 without a session error: the server wants its access token
    if (r.status === 401 && json.error?.code !== 'NOSESSION' && askForToken()) {
      r = await go()
      json = (await r.json().catch(() => ({}))) as ApiBody & Record<string, unknown>
    }
    return { status: r.status, ok: r.ok, json }
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    let res = await this.send(path, body)
    // the server drops idle sessions (and the oldest idle ones when it runs out of connections): open a new one and repeat the request
    if (res.json.error?.code === 'NOSESSION' && path !== '/api/session' && path !== '/api/close' && this.sid) {
      await this.reopen()
      res = await this.send(path, { ...(body as object), sid: this.sid })
    }
    if (path === '/api/close' && res.json.error?.code === 'NOSESSION') return { ok: true } as T
    if (!res.ok || res.json.error) {
      const e = res.json.error
      const err = new Error(e ? e.message : `HTTP ${res.status}`) as Error & { code?: string }
      err.code = e?.code
      throw err
    }
    return res.json as T
  }

  private async reopen(): Promise<void> {
    if (this.reopening) return this.reopening
    this.reopening = (async () => {
      const j = await this.post<{ sid: string }>('/api/session', { autocommit: this.autocommit })
      this.sid = j.sid
      await this.setSessionTimeZone()
      if (appUser) await this.send('/api/query', { sid: this.sid, sql: "SELECT set_config('app.user', $1, false)", params: [appUser] })
    })().finally(() => { this.reopening = null })
    return this.reopening
  }

  /** SQL Server ran with the installation's local timezone; sqlx forces UTC unless the session says otherwise. */
  private async setSessionTimeZone(): Promise<void> {
    await this.query(SESSION_TZ, []).catch(() => undefined)
  }

  async open(): Promise<this> {
    const j = await this.post<{ sid: string }>('/api/session', { autocommit: this.autocommit })
    this.sid = j.sid
    open.add(this)
    await this.setSessionTimeZone()
    if (appUser) await this.query("SELECT set_config('app.user', $1, false)", [appUser]).catch(() => undefined)
    return this
  }
  /** `Select enabled From SysJobs Where Name = :job` (SQL Server Agent): every job is known by name and disabled until it is enabled, see db/pg/86_jobs.sql */
  private async jobs(sql: string, params: unknown[]): Promise<string> {
    if (!/\bfrom\s+sysjobs\b/i.test(sql)) return sql
    if (typeof params[0] === 'string') await this.post('/api/exec', { sid: this.sid, sql: 'INSERT INTO dbo.sysjobs (name) VALUES ($1) ON CONFLICT DO NOTHING', params: [params[0]] })
    return sql.replace(/\bsysjobs\b/i, 'dbo.sysjobs')
  }
  async query(sql: string, params: unknown[]): Promise<QueryResult> {
    return this.post('/api/query', { sid: this.sid, sql: await this.jobs(sql, params), params: wireParams(params) })
  }
  /** `Backup Database <db> To <device> With INIT ...` (SQL Server): a pg_dump of the database into that file; the system databases have nothing to dump */
  private async backup(sql: string): Promise<boolean> {
    let m: readonly string[] | null = /^\s*backup\s+database\s+(\S+)\s+to\s+(?:disk\s*=\s*)?'([^']+)'/i.exec(sql)
    if (!m) {
      // the recovered f_getbackupdevicename() returns an unquoted device
      // name such as `<db>DBDump`, not a quoted file path
      const u = /^\s*backup\s+database\s+(\S+)\s+to\s+(?:disk\s*=\s*)?(.+?)\s+with\b/i.exec(sql)
      if (u) m = [u[0], u[1], u[2].trim().replace(/^'|'$/g, '')]
    }
    if (!m) return false
    if (/^\[?(master|msdb|model)\]?$/i.test(m[1])) return true
    let path = m[2].trim()
    if (!/^[A-Za-z]:[\\/]/.test(path) && !path.startsWith('\\\\') && !path.startsWith('/')) {
      path = 'backups/' + path.replace(/[^A-Za-z0-9._ -]/g, '_')
    }
    if (!/\.[A-Za-z0-9]{2,5}$/.test(path)) path += '.dump'
    const r = await fetch(this.base + '/api/backup', { method: 'POST', headers: { 'content-type': 'application/json', ...authHeaders() }, body: JSON.stringify({ path }) })
    const j = (await r.json().catch(() => ({}))) as { ok?: boolean; error?: string }
    if (!j.ok) throw new Error(j.error || 'Backup failed')
    return true
  }
  async exec(sql: string, params: unknown[]): Promise<{ rowcount: number }> {
    if (await this.backup(sql)) return { rowcount: 0 }
    return this.post('/api/exec', { sid: this.sid, sql, params: wireParams(params) })
  }
  call(sql: string, params: unknown[]): Promise<CallResult> {
    return this.post('/api/call', { sid: this.sid, sql, params: wireParams(params) })
  }
  async commit(): Promise<void> {
    await this.post('/api/commit', { sid: this.sid })
  }
  async rollback(): Promise<void> {
    await this.post('/api/rollback', { sid: this.sid })
    // SET TIME ZONE is transactional: a rollback restores the server's UTC default.
    await this.setSessionTimeZone()
  }
  async close(): Promise<void> {
    open.delete(this)
    await this.post('/api/close', { sid: this.sid })
  }
}
