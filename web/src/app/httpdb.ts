// Database session over the Rust server's HTTP API (see server/src/lib.rs).
import type { Db, QueryResult, CallResult } from '../runtime/wire.ts'
import { askForToken, authHeaders } from '../runtime/apiauth.ts'

/** application user of the audit trail: every open session (and every later one) carries it as the setting `app.user` */
let appUser = ''
const open = new Set<HttpDb>()

export async function setAppUser(user: string): Promise<void> {
  appUser = user
  for (const d of open) await d.exec("SELECT set_config('app.user', $1, false)", [user]).catch(() => undefined)
}

interface ApiBody {
  error?: { code?: string; message: string }
}

export class HttpDb implements Db {
  base: string
  sid = ''
  constructor(base = '') {
    this.base = base
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
    const j = await this.post<{ sid: string }>('/api/session', {})
    this.sid = j.sid
    if (appUser) await this.send('/api/exec', { sid: this.sid, sql: "SELECT set_config('app.user', $1, false)", params: [appUser] })
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
