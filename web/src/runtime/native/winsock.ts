// Native behaviour of the recovered `n_winsock` user object.
//
// The original client talks to a local fiscal service over raw TCP and sends
// `S<invoice code>`.  A browser cannot open raw TCP, so the hop goes through the
// server's `/api/fiscal` relay.  When the service (or an older server without
// the relay) is absent, this reproduces the desktop `Connection refused` path
// and the sale continues.
import { PBObject } from '../object.ts'
import type { Runtime } from '../interp.ts'
import { authHeaders } from '../apiauth.ts'

function hostName(): string {
  try {
    return globalThis.location?.hostname || 'localhost'
  } catch {
    return 'localhost'
  }
}

interface FiscalReply {
  ok?: boolean
  response?: string
  error?: string
}

export class NWinSock extends PBObject {
  private pending: { host: string; port: number } | null = null
  private response = ''
  constructor(rt: Runtime, className: string) {
    super(rt, className, 'n_winsock')
  }
  override getNative(name: string): unknown {
    if (name === 'of_startup') return this.of_startup.bind(this)
    if (name === 'of_cleanup') return this.of_cleanup.bind(this)
    if (name === 'of_setunicode') return this.of_setunicode.bind(this)
    if (name === 'of_gethostname') return this.of_gethostname.bind(this)
    if (name === 'of_getipaddress') return this.of_getipaddress.bind(this)
    if (name === 'of_connect') return this.of_connect.bind(this)
    if (name === 'of_close') return this.of_close.bind(this)
    if (name === 'of_send') return this.of_send.bind(this)
    if (name === 'of_recv') return this.of_recv.bind(this)
    if (name === 'of_getlasterror') return this.of_getlasterror.bind(this)
    return super.getNative(name)
  }

  private async relay(data: string): Promise<FiscalReply> {
    if (!this.pending) return { ok: false, error: 'Connection refused' }
    try {
      const base = (globalThis as { __TRADER_API_BASE__?: string }).__TRADER_API_BASE__ ?? ''
      const r = await fetch(base + '/api/fiscal', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ host: this.pending.host, port: this.pending.port, data }),
      })
      if (!r.ok) return { ok: false, error: 'Connection refused' }
      return (await r.json()) as FiscalReply
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'Connection refused' }
    }
  }

  of_startup(): boolean {
    this.props.set('ib_initialized', true)
    return true
  }
  of_cleanup(): number {
    this.props.set('ib_initialized', false)
    return 0
  }
  of_setunicode(_send: unknown, _recv: unknown): number {
    return 0
  }
  of_gethostname(): string {
    return hostName()
  }
  of_getipaddress(_host: unknown): string {
    return '127.0.0.1'
  }
  async of_connect(host: unknown, port: unknown): Promise<number> {
    const h = String(host ?? '').trim()
    const p = Number(port) || 0
    this.pending = h && p ? { host: h, port: p } : null
    const r = await this.relay('')
    if (!r.ok) {
      this.props.set('is_lasterror', r.error || 'Connection refused')
      return 0
    }
    return 1
  }
  of_close(_socket: unknown): number {
    this.pending = null
    this.response = ''
    return 0
  }
  async of_send(_socket: unknown, data: unknown): Promise<boolean> {
    const r = await this.relay(String(data ?? ''))
    if (!r.ok) {
      this.props.set('is_lasterror', r.error || 'Connection refused')
      return false
    }
    this.response = String(r.response ?? '')
    return true
  }
  of_recv(_socket: unknown, _data: unknown): boolean {
    return this.response.length > 0
  }
  of_getlasterror(): string {
    return String(this.props.get('is_lasterror') ?? 'Connection refused')
  }
}
