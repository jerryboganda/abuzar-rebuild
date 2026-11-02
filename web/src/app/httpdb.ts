// Database session over the Rust server's HTTP API (see server/src/api.rs).
import type { Db, QueryResult } from '../runtime/wire.ts'

export class HttpDb implements Db {
  base: string
  sid = ''
  constructor(base = '') {
    this.base = base
  }
  private async post<T>(path: string, body: unknown): Promise<T> {
    const r = await fetch(this.base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    const j = (await r.json()) as T & { error?: { code: string; message: string } }
    if (!r.ok || (j as { error?: unknown }).error) {
      const e = (j as { error?: { message: string } }).error
      throw new Error(e ? e.message : `HTTP ${r.status}`)
    }
    return j
  }
  async open(): Promise<this> {
    const j = await this.post<{ sid: string }>('/api/session', {})
    this.sid = j.sid
    return this
  }
  query(sql: string, params: unknown[]): Promise<QueryResult> {
    return this.post('/api/query', { sid: this.sid, sql, params })
  }
  exec(sql: string, params: unknown[]): Promise<{ rowcount: number }> {
    return this.post('/api/exec', { sid: this.sid, sql, params })
  }
  async commit(): Promise<void> {
    await this.post('/api/commit', { sid: this.sid })
  }
  async rollback(): Promise<void> {
    await this.post('/api/rollback', { sid: this.sid })
  }
  async close(): Promise<void> {
    await this.post('/api/close', { sid: this.sid })
  }
}
