// Starts the application headlessly against a real server and database: opens the login window of the original, signs in with the
// first administrator of db/pg/95_bootstrap.sql, runs the code after the login and reports what went wrong on the way.
// usage: SMOKE_SERVER=http://127.0.0.1:8787 node tools/startup-check.ts <public/data dir> [user] [password]
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { createRuntime } from '../src/runtime/boot.ts'
import { JsonClassLoader } from '../src/runtime/loader.ts'
import { HttpDb } from '../src/app/httpdb.ts'
import { startApplication, DEFAULT_CONFIG } from '../src/app/startup.ts'
import type { PBObject } from '../src/runtime/object.ts'
import type { NDwBase } from '../src/runtime/native/dwctrl.ts'

const dataDir = process.argv[2]
const user = process.argv[3] || 'admin'
const pass = process.argv[4] || 'admin'
const server = process.env.SMOKE_SERVER
if (!server) throw new Error('SMOKE_SERVER is not set')
;(globalThis as { fetch: typeof fetch }).fetch = ((orig) => (u: string | URL | Request, i?: RequestInit) => orig(typeof u === 'string' && u.startsWith('/') ? server + u : u, i))(fetch)

const read = async (p: string): Promise<string | undefined> => {
  const f = join(dataDir, p)
  if (existsSync(f)) return readFileSync(f, 'utf8')
  if (existsSync(f + '.gz')) return gunzipSync(readFileSync(f + '.gz')).toString('utf8')
  return undefined
}
const names = JSON.parse((await read('names.json')) || '{}')
const sqlTables = JSON.parse((await read('sql.json')) || '{}')
const loader = new JsonClassLoader((n) => read(`classes/${n}.json`))

const boxes: string[] = []
const errors: string[] = []
const windows: string[] = []
const dialogs: string[] = []
const ui = {
  async messageBox(title: string, text: string) {
    boxes.push(`${title}: ${text}`.slice(0, 300))
    return 1
  },
  createWindow(w: PBObject) {
    windows.push(w.className)
  },
  showWindow() {},
  hideWindow() {},
  closeWindow() {},
  activate() {},
  focus() {},
} as never

const rt = await createRuntime({ loader, readData: read, sharedVars: names.sharedVars, globalTypes: names.globalTypes, stmts: sqlTables.stmt, procs: sqlTables.proc, ui, openDb: async (_t: PBObject) => await new HttpDb('').open() })
rt.dwSql = (n) => sqlTables.dw?.[n.toLowerCase()]
rt.onError = (e) => errors.push(((e as Error).message || String(e)).slice(0, 300) + ' @' + ((e as { where?: string }).where ?? ''))
rt.loopLimit = 200000

// the application waits for the login window: fill it in and press OK as soon as it exists
const started = startApplication(rt, { ...DEFAULT_CONFIG, company: '' }).then(
  (ok) => ({ ok, error: '' }),
  (e: Error) => ({ ok: false, error: (e.message || String(e)).slice(0, 400) + ' @' + ((e as { where?: string }).where ?? '') }),
)
const t0 = Date.now()
let login: PBObject | undefined
while (!login && Date.now() - t0 < 20000) {
  login = rt.windowInstances.get('w_login1')
  if (!login) await new Promise((r) => setTimeout(r, 50))
}
let result: { ok: boolean; error: string }
if (!login) result = { ok: false, error: 'the login window did not open' }
else {
  const child = (n: string) => login!.children.get(n) as PBObject | undefined
  const dw = child('dw_password') as NDwBase | undefined
  const ok = child('cb_ok')
  if (!dw || !ok) result = { ok: false, error: 'the login window has no dw_password / cb_ok' }
  else {
    await dw.ready
    await dw.n_setitem(1, 'login', user)
    await dw.n_setitem(1, 'password', pass)
    await rt.fire(ok, 'clicked', [])
    // response windows that open during the start-up (messages, dialogs) are closed like a user pressing the close button
    const closer = setInterval(() => {
      void (async () => {
        for (const [name, w] of [...rt.windowInstances.entries()]) {
          if (name === 'w_login1') continue
          const cls = await rt.getClass(name)
          if (Number(cls?.fields.find((f) => f.name === 'windowtype')?.value ?? 0) === 3) {
            dialogs.push(name)
            await rt.closeWindow(w).catch(() => undefined)
          }
        }
      })()
    }, 100)
    result = await Promise.race([started, new Promise<{ ok: boolean; error: string }>((r) => setTimeout(() => r({ ok: false, error: 'start-up did not finish in 60 s' }), 60000))])
    clearInterval(closer)
  }
}
const msg = rt.globals.get('message') as PBObject
console.log(`start-up ${result.ok ? 'completed' : 'FAILED'} ${result.error}`)
console.log(`login result ${String(msg?.props.get('doubleparm'))}  user code ${String(rt.globals.get('gl_usercode'))}`)
console.log(`windows created: ${windows.join(', ') || '-'}`)
console.log(`response windows closed during start-up: ${dialogs.join(', ') || '-'}`)
// the main menu after the rights were applied: what the administrator sees
const mainWin = rt.windowInstances.get('w_main')
const menu = mainWin?.props.get('menuid') as PBObject | undefined
if (menu) {
  let total = 0
  let shown = 0
  const walk = (m: PBObject, parentShown: boolean) => {
    for (const it of m.children.values()) {
      const vis = parentShown && it.props.get('visible') !== false
      total++
      if (vis) shown++
      walk(it, vis)
    }
  }
  walk(menu, true)
  const top = [...menu.children.values()]
  console.log(`main menu: ${shown} of ${total} items visible; top level: ${top.filter((i) => i.props.get('visible') !== false).length} of ${top.length}`)
} else console.log('main menu: the main window did not open')
console.log(`message boxes (${boxes.length}):`)
for (const b of boxes.slice(0, 20)) console.log('  ' + b)
console.log(`runtime errors (${errors.length}):`)
for (const e of errors.slice(0, 20)) console.log('  ' + e)
console.log('missing: ' + [...rt.missing.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([k, v]) => `${k}:${v}`).join('  '))
setTimeout(() => process.exit(result.ok ? 0 : 1), 200)
