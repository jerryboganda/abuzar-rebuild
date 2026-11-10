// Native behaviour of the recovered `n_winsock` user object.
//
// In the main application a plain n_winsock is only the fiscal client (f_fiscalizesaleinvoice, f_fiscalizesrinvoice,
// f_get_googleqrcode_for_fiscalinvno): it connects to the FiscalizationApp (preferences FiscalizationMachine /
// FiscalizationAppPort), sends `S<code>` / `R<code>` / `Q<code>` and waits for the answer.  The vendor's FiscalizationApp
// works on SQL Server only, so the rebuild answers these connections itself (fiscal.ts, the listener reproduced on
// PostgreSQL) - it must never reach the vendor listener, which would fiscalize the SQL Server invoice of the same number.
// Descendants (n_smtp) talk to other services: their hop goes through the server's `/api/fiscal` TCP relay, because a
// browser cannot open raw TCP; without it they get the desktop `Connection refused` path.
import { PBObject } from '../object.ts'
import type { Runtime } from '../interp.ts'
import { Ref } from '../interp.ts'
import { authHeaders } from '../apiauth.ts'
import { fiscalListener } from './fiscal.ts'

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
  /** the fiscal client's own socket: answered by the rebuild's fiscal listener */
  private get fiscal(): boolean {
    return this.className === 'n_winsock'
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
    this.response = ''
    if (this.fiscal && this.pending) return 1
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
    if (this.fiscal && this.pending) {
      this.response = (await fiscalListener(this.rt, String(data ?? ''))) ?? ''
      return true
    }
    const r = await this.relay(String(data ?? ''))
    if (!r.ok) {
      this.props.set('is_lasterror', r.error || 'Connection refused')
      return false
    }
    this.response = String(r.response ?? '')
    return true
  }
  async of_recv(_socket: unknown, data: unknown): Promise<boolean> {
    if (!this.response.length) return false
    if (data instanceof Ref) await data.set(this.response)
    return true
  }
  of_getlasterror(): string {
    return String(this.props.get('is_lasterror') ?? 'Connection refused')
  }
}
