// Entry point: boots the runtime and opens a window (?w=<window class>) or the application.
import { createRuntime } from './runtime/boot.ts'
import { JsonClassLoader } from './runtime/loader.ts'
import { DomUi } from './ui/dom-ui.ts'
import { MockDb } from './app/mockdb.ts'
import { HttpDb } from './app/httpdb.ts'
import type { Db } from './runtime/wire.ts'
import type { PBObject } from './runtime/object.ts'
import { Ref } from './runtime/interp.ts'
import { authHeaders } from './runtime/apiauth.ts'
import { setApiBase } from './runtime/sysfiles.ts'
import { localeDateOrder, setDateOrder } from './runtime/values.ts'
import { startApplication, DEFAULT_CONFIG } from './app/startup.ts'
import { PresentationSession, SessionPreferenceStorage } from './app/ui-preferences.ts'
import { PresentationUi } from './ui/presentation-ui.ts'
import { startDesignBoot } from './ui/design-boot.ts'
import { nativeAppearance } from './ui/native-appearance.ts'
import { fixSqlTables } from './runtime/sql-fixes.ts'
import { autoLogin } from './app/autologin.ts'
import { buildPages } from './ui/print.ts'
import { DwView } from './ui/dwview.ts'
import type { NDwBase } from './runtime/native/dwctrl.ts'
import { NTransaction } from './runtime/native/transaction.ts'

/** Tauri shell: replace the default resource icon with the Waseela app icon. */
async function setNativeIcon(): Promise<void> {
  const invoke = (globalThis as { __TAURI_INTERNALS__?: { invoke?: (cmd: string, args: unknown) => Promise<unknown> } }).__TAURI_INTERNALS__?.invoke
  if (typeof invoke !== 'function') return
  try {
    const blob = await (await fetch('/app-icon.png')).blob()
    const bmp = await createImageBitmap(blob)
    const canvas = document.createElement('canvas')
    canvas.width = bmp.width
    canvas.height = bmp.height
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(bmp, 0, 0)
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height)
    await invoke('plugin:window|set_icon', { label: 'main', value: { rgba: Array.from(data.data), width: data.width, height: data.height } })
  } catch {
    // older shell without the command
  }
}

/** data files; DataWindow bundles are stored gzip-compressed */
async function text(path: string): Promise<string | undefined> {
  if (/^dw\/(?!_index).*\.json$/.test(path)) {
    const r = await fetch('/data/' + path + '.gz')
    if (!r.ok || !r.body) return undefined
    const type = (r.headers.get('content-type') || '').toLowerCase()
    if (type.includes('text/html')) return undefined
    return await new Response(r.body.pipeThrough(new DecompressionStream('gzip'))).text()
  }
  const r = await fetch('/data/' + path)
  if (!r.ok) return undefined
  // Tauri's asset protocol answers unknown paths with index.html (status 200);
  // treat that as a missing data file instead of parsing HTML as JSON.
  const type = (r.headers.get('content-type') || '').toLowerCase()
  if (type.includes('text/html')) return undefined
  return await r.text()
}

/**
 * The data server: the desktop shell embeds it on 127.0.0.1, the Rust server serves the page itself (same origin), a plain dev server
 * has none (the mock database is used).  `?db=mock` forces the mock, `?server=<url>` names another server.
 */
async function findServer(q: URLSearchParams): Promise<{ base: string; db: boolean } | null> {
  if (q.get('db') === 'mock') return null
  const tauri =
    !!(globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ ||
    !!(globalThis as { __TAURI__?: unknown }).__TAURI__ ||
    location.protocol === 'tauri:' ||
    /(^|\.)tauri\.localhost$/i.test(location.hostname)
  if (tauri) {
    document.body.classList.add('tauri-shell')
    void setNativeIcon()
  }
  const bases = q.get('server') ? [q.get('server')!] : q.get('db') === 'server' ? [''] : tauri ? ['http://127.0.0.1:8787'] : ['']
  for (const b of bases) {
    // The desktop shell starts its embedded server in a background task; the
    // webview can be ready before the listener is bound.  Retry instead of
    // falling back to the mock and leaving a blank window.
    const attempts = tauri ? 40 : 1
    for (let i = 0; i < attempts; i++) {
      try {
        const r = await fetch(b + '/api/health', { headers: authHeaders() })
        const type = (r.headers.get('content-type') || '').toLowerCase()
        const j = r.ok && type.includes('json') ? ((await r.json()) as { ok?: boolean; db?: boolean }) : null
        if (j?.ok) return { base: b, db: j.db !== false }
      } catch {
        // not reachable yet: next attempt
      }
      if (i + 1 < attempts) await new Promise((resolve) => setTimeout(resolve, 250))
    }
  }
  return null
}

async function main(): Promise<void> {
  const q = new URLSearchParams(location.search)
  setDateOrder(q.get('dateorder') === 'dmy' ? 'dmy' : q.get('dateorder') === 'mdy' ? 'mdy' : localeDateOrder()) // the short date of the machine (String(date), Date('3/11/2026'), [shortdate])
  const found = await findServer(q)
  const server = found ? found.base : null
  const names = JSON.parse((await text('names.json')) || '{}')
  // the index of the class files that exist: names without a file are never requested (see JsonClassLoader.known)
  let classNames: Set<string> | undefined
  try {
    const index = JSON.parse((await text('classes/_index.json')) || 'null') as Record<string, string> | null
    if (index && typeof index === 'object') classNames = new Set(Object.keys(index).map((n) => n.toLowerCase()))
  } catch {
    // unreadable index: every class is looked up on the server, as before
  }
  const loader = new JsonClassLoader((n) => text(`classes/${n}.json`), classNames)
  const sqlTables = JSON.parse((await text('sql.json')) || '{}')
  fixSqlTables(sqlTables)
  const useMock = server === null
  if (server !== null) setApiBase(server)
  const desktop = document.getElementById('desktop') as HTMLElement
  if (found && !found.db) {
    // the server runs but PostgreSQL does not answer: say what to check instead of failing inside the login window
    const box = document.createElement('div')
    box.style.cssText = 'font:14px Segoe UI,Arial,sans-serif;padding:32px;max-width:640px'
    box.innerHTML = '<h2>The database is not reachable</h2><p>The data server is running but cannot connect to PostgreSQL. Put the connection URL on the first line of <code>trader.conf</code> next to the program (for example <code>postgres://user:password@host:5432/trader</code>), or set <code>DATABASE_URL</code>, and start the program again.</p>'
    desktop.appendChild(box)
    return
  }
  const rt = await createRuntime({
    loader,
    readData: text,
    sharedVars: names.sharedVars,
    globalTypes: names.globalTypes,
    stmts: sqlTables.stmt,
    dwSql: sqlTables.dw,
    procs: sqlTables.proc,
    openDb: async (t: PBObject): Promise<Db> => (useMock ? new MockDb(rt.dwCatalog!, Number(q.get('rows')) || 6) : await new HttpDb(server ?? '', !!t.props.get('autocommit')).open()),
  })
  if (useMock) rt.dwSql = (n) => ({ sql: 'mock:' + n, params: [], proc: !!sqlTables.dw?.[n]?.proc })
  let ui: DomUi = new DomUi(rt, desktop)
  rt.ui = ui
  rt.onError = (e) => {
    console.error(e)
    void ui.messageBox('Application error', (e instanceof Error ? e.message : String(e)) + ((e as { where?: string }).where ? `
(in ${(e as { where?: string }).where})` : ''), 'stopsign!', 'ok!', 1)
  }
  void nativeAppearance.set('light').catch((cause: unknown) => rt.onError(
    new Error('The desktop window could not restore its Classic Light appearance. Restart the application to retry.', { cause }),
  ))
  ;(window as unknown as { rt: unknown }).rt = rt
  const dwName = q.get('dw') || q.get('live')
  if (dwName) {
    // development aid: lay out one DataWindow as a printed report (`dw`) or as the live control (`live`) with the mock (or server) data
    const ds = (await rt.instantiate('datastore')) as NDwBase
    ds.setNative('dataobject', dwName)
    const t = rt.globals.get('sqlca') as NTransaction
    await t.n_connect()
    await ds.n_settransobject(t)
    const args = (q.get('args') ?? '').split(',').filter(Boolean).map((a) => (/^-?\d+(\.\d+)?$/.test(a) ? Number(a) : a))
    await ds.n_retrieve(...args)
    if (q.get('live')) {
      const box = document.createElement('div')
      box.style.cssText = 'position:absolute;inset:0'
      desktop.appendChild(box)
      new DwView(ds, box)
      return
    }
    const host = document.createElement('div')
    host.style.cssText = 'position:absolute;inset:0;overflow:auto;background:#808080;padding:12px'
    for (const p of await buildPages(ds)) {
      p.style.margin = '0 auto 12px'
      p.style.boxShadow = '0 0 6px #000'
      host.appendChild(p)
    }
    desktop.appendChild(host)
    return
  }
  // with a data server the application starts by itself; `?app=0` keeps the bare desktop, `?w=` opens one window
  if (q.get('app') === '1' || (server !== null && q.get('app') !== '0' && !q.get('w'))) {
    const auto = (q.get('autologin') ?? '').split(':')
    if (auto.length === 2) void autoLogin(rt, auto[0], auto[1])
    // The approved design's sign-in screen; removed when the Modern workspace starts (or the Classic interface continues).
    const stopBoot = q.get('presentation') === '1' ? startDesignBoot() : () => {}
    try {
      await startApplication(rt, { ...DEFAULT_CONFIG, company: q.get('company') ?? '' }, q.get('presentation') === '1' ? {
        // Appearance preferences never block a sign-in: an unreadable or newer stored record, refused storage, an unidentified
        // database or a missing crypto API give this session the default appearance (kept in memory, the stored record untouched),
        // and if even that fails the Classic interface continues.
        onAuthenticated: async ({ appUser, config }) => {
          const scope = async () => {
            let database = 'mock:' + config.database
            if (!useMock) {
              const transaction = rt.globals.get('sqlca')
              if (!(transaction instanceof NTransaction) || !transaction.db) throw new Error('Appearance selection requires the signed-in database session.')
              const result = await transaction.db.query('SELECT current_database() AS database_name', [])
              const identity = result.rows[0]?.[0]
              if (typeof identity !== 'string' || !identity.trim()) throw new Error('The active database could not be identified for appearance settings.')
              database = identity
            }
            return { server: server ? new URL(server, location.href).href : location.origin, database, appUser, workstation: config.computer }
          }
          let session: PresentationSession
          try {
            session = await PresentationSession.load(localStorage, await scope())
          } catch (error) {
            console.warn('Appearance preferences are unavailable; this session uses the default appearance and saves nothing.', error)
            try {
              session = await PresentationSession.load(new SessionPreferenceStorage(), {
                server: location.origin || 'local', database: config.database || 'local', appUser: appUser || 'user', workstation: config.computer || 'local',
              })
            } catch (fallback) {
              console.warn('The Modern interface could not start; the Classic interface continues.', fallback)
              stopBoot()
              return
            }
          }
          ui.dispose()
          ui = new PresentationUi(rt, desktop, session)
          rt.ui = ui
          stopBoot()
        },
      } : {})
    } catch (e) {
      rt.onError(e)
    }
    // helpers of the browser test (web/e2e/browser-smoke.mjs)
    ;(window as unknown as Record<string, unknown>).__opensheet = async (name: string) => {
      const ref = new Ref(() => null, () => {})
      ref.name = name
      await rt.sys.get('opensheet')!.fn(rt, [ref, rt.windowInstances.get('w_main')], undefined as never)
    }
    // clicks a menu item of the main menu by its captions (`&Purchase | &Purchases`), like the user does; the browser test uses it for the screens
    ;(window as unknown as Record<string, unknown>).__menu = async (path: string) => {
      const clean = (t: unknown) => String(t ?? '').replace(/<TAB>/g, ' ').replace(/&/g, '').replace(/\s+/g, ' ').trim().toLowerCase()
      let m = rt.windowInstances.get('w_main')?.props.get('menuid') as PBObject | undefined
      for (const part of path.split(' | ')) {
        const want = clean(part)
        const kids: PBObject[] = m ? [...m.children.values()] : []
        const hit = kids.find((k) => clean(k.props.get('text')) === want && k.props.get('visible') !== false) ?? kids.find((k) => clean(k.props.get('text')).startsWith(want) && k.props.get('visible') !== false)
        if (!hit) return false
        m = hit
        if (!hit.children.size) {
          await rt.fire(hit, 'selected')
          await rt.fire(hit, 'clicked')
          return true
        }
        await rt.fire(hit, 'selected')
      }
      return false
    }
    ;(window as unknown as Record<string, unknown>).__open = async (name: string) => {
      const ref = new Ref(() => null, () => {})
      ref.name = name
      await rt.sys.get('open')!.fn(rt, [ref], undefined as never)
    }
    return
  }
  const w = q.get('w')
  if (w) {
    try {
      const ref = new Ref(() => null, () => {})
      ref.name = w
      await rt.sys.get('open')!.fn(rt, [ref], undefined as never)
    } catch (e) {
      rt.onError(e)
    }
  }
}

void main()
