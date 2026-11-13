// Headless smoke run: open every window class with a mock database and report what the runtime cannot do yet.
// usage: node tools/smoke-windows.ts <public/data dir> [filter] [report.json]
import { readFileSync, existsSync, writeFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { createRuntime } from '../src/runtime/boot.ts'
import { JsonClassLoader } from '../src/runtime/loader.ts'
import { MockDb } from '../src/app/mockdb.ts'
import { HttpDb } from '../src/app/httpdb.ts'
import type { PBObject } from '../src/runtime/object.ts'
import { Ref } from '../src/runtime/interp.ts'
import { windowArgument } from '../src/app/window-arguments.ts'

const dataDir = process.argv[2]
const whereOf = (e: unknown): string => (e as { where?: string }).where || ((e as Error).stack || '').split(String.fromCharCode(10)).slice(1, 3).map((l) => l.trim().replace(/^at /, '')).join(' < ')
const filter = process.argv[3] && process.argv[3] !== '-' ? new RegExp(process.argv[3]) : null
const reportFile = process.argv[4]

const read = async (p: string): Promise<string | undefined> => {
  const f = join(dataDir, p)
  if (existsSync(f)) return readFileSync(f, 'utf8')
  if (existsSync(f + '.gz')) return gunzipSync(readFileSync(f + '.gz')).toString('utf8')
  return undefined
}

const names = JSON.parse((await read('names.json')) || '{}')
const sqlTables = JSON.parse((await read('sql.json')) || '{}')
const loader = new JsonClassLoader((n) => read(`classes/${n}.json`))
const created: unknown[] = []
const ui = {
  async messageBox() {
    return 1
  },
  createWindow(w: unknown) {
    created.push(w)
  },
  showWindow() {},
  hideWindow() {},
  closeWindow() {},
  activate() {},
  focus() {},
} as never

const server = process.env.SMOKE_SERVER
if (server) (globalThis as { fetch: typeof fetch }).fetch = ((orig) => (u: string | URL | Request, i?: RequestInit) => orig(typeof u === 'string' && u.startsWith('/') ? server + u : u, i))(fetch)
const rt = await createRuntime({ loader, readData: read, sharedVars: names.sharedVars, globalTypes: names.globalTypes, stmts: sqlTables.stmt, procs: sqlTables.proc, ui, openDb: async (_t: PBObject) => (server ? await new HttpDb('').open() : new MockDb(rt.dwCatalog!)) })
if (!server) rt.dwSql = (n) => ({ sql: 'mock:' + n, params: [] })
else rt.dwSql = (n) => sqlTables.dw?.[n.toLowerCase()]
rt.onError = () => {}
rt.loopLimit = 20000

const index = JSON.parse((await read('classes/_index.json')) || '{}') as Record<string, string>
const windows = Object.keys(index).filter((n) => n.startsWith('w_') && (!filter || filter.test(n)))
const results: { name: string; ok: boolean; error?: string; ms: number }[] = []
let late: string[] = []
process.on('unhandledRejection', (e) => late.push((e as Error).message?.slice(0, 160) ?? String(e)))
const t0 = Date.now()
// windows opened with an argument branch on Message.StringParm: a failing window is retried with the usual codes
const CANDIDATES = ['M', 'C', 'L', 'P', 'S', 'A', 'B', 'G', 'D', 'I', 'R', 'T', 'Y', '2', '0']
// A window whose close or open never settles (a modal waiting on an answer nobody gives) must not stall the whole sweep:
// every wait is bounded and the window is reported as not settled.
const bounded = <T>(promise: Promise<T>, ms: number): Promise<T | undefined> =>
  Promise.race([promise, new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), ms))])
async function tryOpen(name: string, type: number, stringparm: string): Promise<{ name: string; ok: boolean; error?: string; ms: number }> {
  const ref = new Ref(() => null, () => {})
  ref.name = name
  const start = Date.now()
  let res: { name: string; ok: boolean; error?: string; ms: number }
  try {
    const open = rt.sys.get('open')!
    const msg = rt.globals.get('message') as PBObject
    // the argument the application passes to this window (a DataWindow, or a structure that carries one)
    msg.props.set('powerobjectparm', await windowArgument(rt, name))
    msg.props.set('doubleparm', 1)
    msg.props.set('stringparm', stringparm)
    // response windows block until closed: close them as soon as they are shown
    const p = Promise.resolve(open.fn(rt, [ref], undefined as never))
    let openErr: string | null = null
    p.catch((e) => (openErr = (e as Error).message.slice(0, 120) + ' @' + whereOf(e)))
    const w = await Promise.race([
      (async () => {
        while (!rt.windowInstances.get(name)) await new Promise((r) => setTimeout(r, 1))
        return rt.windowInstances.get(name)!
      })(),
      new Promise<null>((r) => setTimeout(() => r(null), 3000)),
    ])
    if (type === 3 && w) {
      await new Promise((r) => setTimeout(r, 20))
      await bounded(rt.closeWindow(w), 3000)
    }
    await Promise.race([p, new Promise((r) => setTimeout(r, 3000))])
    await new Promise((r) => setTimeout(r, 5))
    res = openErr ? { name, ok: false, error: openErr, ms: Date.now() - start } : { name, ok: true, ms: Date.now() - start }
    const inst = rt.windowInstances.get(name)
    if (inst) await bounded(rt.closeWindow(inst).catch(() => {}), 3000)
  } catch (e) {
    res = { name, ok: false, error: (e as Error).message.slice(0, 120) + ' @' + whereOf(e), ms: Date.now() - start }
    rt.windowInstances.delete(name)
  }
  rt.depth = 0
  return res
}
let retried = 0
let rescued = 0
for (const name of windows) {
  const cls = await bounded(rt.getClass(name), 10000)
  if (!cls || cls.kind !== 'window') continue
  const type = Number(cls.fields.find((f) => f.name === 'windowtype')?.value ?? 0)
  if (process.env.SMOKE_PROGRESS) console.error(`[smoke] ${results.length}/${windows.length} ${name}`)
  // One window that never settles is reported and the sweep goes on from a clean state.
  const settle = async (stringparm: string) => (await bounded(tryOpen(name, type, stringparm), 20000)) ??
    (rt.windowInstances.delete(name), rt.depth = 0, { name, ok: false, error: 'did not settle within 20 s', ms: 20000 })
  let r = await settle('1')
  if (!r.ok && /Null object reference|expression/.test(r.error || '')) {
    retried++
    for (const sp of CANDIDATES) {
      const r2 = await settle(sp)
      if (r2.ok) {
        r = r2
        rescued++
        break
      }
    }
  }
  results.push(r)
}
console.log(`retried with other Message.StringParm codes ${retried}, opened that way ${rescued}`)
const ok = results.filter((r) => r.ok).length
console.log(`windows tried ${results.length}  opened without runtime error ${ok}  failed ${results.length - ok}  (${((Date.now() - t0) / 1000).toFixed(1)}s)`)
const errs = new Map<string, number>()
for (const r of results) if (!r.ok) errs.set(r.error!.replace(/\d+/g, 'N').slice(0, 90), (errs.get(r.error!.replace(/\d+/g, 'N').slice(0, 90)) || 0) + 1)
console.log('top errors', [...errs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12))
const missing = [...rt.missing.entries()].sort((a, b) => b[1] - a[1])
console.log('missing (top 40)', missing.slice(0, 40).map(([k, v]) => `${k}:${v}`).join('  '))
if (reportFile) writeFileSync(reportFile, JSON.stringify({ results, missing: Object.fromEntries(missing) }, null, 1))
void readdirSync
// open handles of the HTTP client would keep the process (and the CI job) alive
setTimeout(() => process.exit(0), 200)
