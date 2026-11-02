// Database session over the Rust server's HTTP API (see server/src/api.rs).
import type { Db, QueryResult, CallResult } from '../runtime/wire.ts'
import { askForToken, authHeaders } from '../runtime/apiauth.ts'

/** application user of the audit trail: every open session (and every later one) carries it as the setting `app.user` */
let appUser = ''
const open = new Set<HttpDb>()

export async function setAppUser(user: string): Promise<void> {
  appUser = user
  for (const d of open) await d.exec("SELECT set_config('app.user', $1, false)", [user]).catch(() => undefined)
}

export class HttpDb implements Db {
  base: string
  sid = ''
  constructor(base = '') {
    this.base = base
  }
  private async post<T>(path: string, body: unknown): Promise<T> {
    const send = () => fetch(this.base + path, { method: 'POST', headers: { 'content-type': 'application/json', ...authHeaders() }, body: JSON.stringify(body) })
    let r = await send()
    if (r.status === 401 && askForToken()) r = await send()
    const j = (await r.json()) as T & { error?: { code: string; message: string } }
    if (!r.ok || (j as { error?: unknown }).error) {
      const e = (j as { error?: { message: string; code?: string } }).error
      const err = new Error(e ? e.message : `HTTP ${r.status}`) as Error & { code?: string }
      err.code = e?.code
      throw err
    }
    return j
  }
  async open(): Promise<this> {
    const j = await this.post<{ sid: string }>('/api/session', {})
    this.sid = j.sid
    open.add(this)
    if (appUser) await this.exec("SELECT set_config('app.user', $1, false)", [appUser]).catch(() => undefined)
    return this
  }
  query(sql: string, params: unknown[]): Promise<QueryResult> {
    return this.post('/api/query', { sid: this.sid, sql, params })
  }
  exec(sql: string, params: unknown[]): Promise<{ rowcount: number }> {
    return this.post('/api/exec', { sid: this.sid, sql, params })
  }
  call(sql: string, params: unknown[]): Promise<CallResult> {
    return this.post('/api/call', { sid: this.sid, sql, params })
  }
  async commit(): Promise<void> {
    await this.post('/api/commit', { sid: this.sid })
  }
  async rollback(): Promise<void> {
    await this.post('/api/rollback', { sid: this.sid })
  }
  async close(): Promise<void> {
    open.delete(this)
    await this.post('/api/close', { sid: this.sid })
  }
}
