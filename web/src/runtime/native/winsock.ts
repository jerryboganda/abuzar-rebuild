// Native behaviour of the recovered `n_winsock` user object.
//
// The browser cannot open raw TCP sockets.  Fiscalization method 2 talks to a
// local fiscal service; when that service is absent the original app reports
// `Fiscalization Error` and continues.  This implementation reproduces that
// outcome instead of throwing a null-object error.  of_connect returns 0 so
// the caller follows the same "no service" branch as the desktop app.
import { PBObject } from '../object.ts'
import type { Runtime } from '../interp.ts'

function hostName(): string {
  try {
    return globalThis.location?.hostname || 'localhost'
  } catch {
    return 'localhost'
  }
}

export class NWinSock extends PBObject {
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
  of_connect(_host: unknown, _port: unknown): number {
    this.props.set('is_lasterror', 'Connection refused')
    return 0
  }
  of_close(_socket: unknown): number {
    return 0
  }
  of_send(_socket: unknown, _data: unknown): boolean {
    return false
  }
  of_recv(_socket: unknown, _data: unknown): boolean {
    return false
  }
  of_getlasterror(): string {
    return String(this.props.get('is_lasterror') ?? 'Connection refused')
  }
}
