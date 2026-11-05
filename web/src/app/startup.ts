// Start-up sequence of the application.
//
// The original `traderappv1.open` event does three things: (1) environment work (local settings file, licence / dongle,
// session rows, schema upgrade scripts, backup health), (2) the login window `w_login1` and (3) the initialisation after login
// (preference and security data stores, item lists, report headers, ...) followed by `openwithparm(w_main, gl_usercode)`.
// Part 1 has no meaning in the rebuild (own configuration, own licensing decision, proper migrations).  Parts 2 and 3 are the
// recovered code itself: the login window is opened like the original, and the code after the login is executed from the
// decompiled `open` routine, so every preference lookup, cache and menu rule behaves as it did.
import { setAppUser } from './httpdb.ts'
import type { Runtime } from '../runtime/interp.ts'
import { Frame, HaltSignal, Ref } from '../runtime/interp.ts'
import type { Stmt } from '../pbscript/ast.ts'
import type { PBObject } from '../runtime/object.ts'

export interface AppConfig {
  /** deployment key used by `if gs_company = ...` branches of the original (print layouts, rules) */
  company: string
  server: string
  database: string
  appVersion: number
  computer: string
}

export const DEFAULT_CONFIG: AppConfig = { company: '', server: 'localhost', database: 'trader', appVersion: 0, computer: 'WORKSTATION' }

export function applyConfig(rt: Runtime, c: AppConfig): void {
  const g = rt.globals
  g.set('gs_company', c.company)
  g.set('gs_servername', c.server)
  g.set('gs_dbname', c.database)
  g.set('gs_app', 'Waseela')
  g.set('gs_appsetting', 'N')
  g.set('gs_localcomputername', c.computer)
  g.set('gs_isreportserver', 'N')
  g.set('gl_appversion', c.appVersion)
  g.set('gl_currentlanguage', 0)
}

/** statements of `traderappv1.open` that run after the login: everything from the group lookup of the logged-in user */
export async function postLoginStatements(rt: Runtime): Promise<{ decls: Stmt[]; tail: Stmt[]; idx: number } | null> {
  const cls = await rt.getClass('traderappv1')
  const open = cls?.routines.get('traderappv1')?.get('open')?.[0]
  if (!cls || !open) return null
  const at = open.body.findIndex((s) => s.k === 'sql' && s.hv.includes('gl_remotegroup'))
  if (at < 0) return null
  return { decls: open.body.filter((s) => s.k === 'decl'), tail: open.body.slice(at), idx: 0 }
}

export async function startApplication(rt: Runtime, cfg: AppConfig = DEFAULT_CONFIG): Promise<boolean> {
  applyConfig(rt, cfg)
  const app = await rt.instantiate('traderappv1')
  rt.globals.set('traderappv1', app)
  // The original open event starts with af_get_app_setting(), which reads mgmtcomp.pbd:
  // gs_company (used to pick rows from serviceheads.pbd), server/database names, limits.
  // The licence / remote-server work that follows it stays out of the rebuild, but this read
  // is what makes the deployed company key and the report-header lists behave like the original.
  if (!cfg.company) {
    try {
      await rt.callMethod(app, 'af_get_app_setting', [])
    } catch {
      // no settings file: the rebuild's own configuration and licensing apply
    }
  }
  const msg = rt.globals.get('message') as PBObject
  // login (modal): the window closes with 1 after a successful login
  const ref = new Ref(() => null, () => {})
  ref.name = 'w_login1'
  await rt.sys.get('open')!.fn(rt, [ref], undefined as never)
  if (msg.props.get('doubleparm') !== 1) return false
  const user = rt.globals.get('gl_usercode')
  if (user !== undefined && user !== null) await setAppUser(String(user)) // audit trail
  const pl = await postLoginStatements(rt)
  if (!pl) throw new Error('traderappv1.open has no post-login section')
  const open = (await rt.getClass('traderappv1'))!.routines.get('traderappv1')!.get('open')![0]
  const f = new Frame(app, open, 0)
  try {
    await rt.execBlock([...pl.decls, ...pl.tail], f)
  } catch (e) {
    if (e instanceof HaltSignal) return false
    throw e
  }
  return true
}
