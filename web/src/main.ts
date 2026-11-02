// Entry point: boots the runtime and opens a window (?w=<window class>) or the application.
import { createRuntime } from './runtime/boot.ts'
import { JsonClassLoader } from './runtime/loader.ts'
import { DomUi } from './ui/dom-ui.ts'
import { MockDb } from './app/mockdb.ts'
import { HttpDb } from './app/httpdb.ts'
import type { Db } from './runtime/wire.ts'
import type { PBObject } from './runtime/object.ts'
import { Ref } from './runtime/interp.ts'
import { startApplication, DEFAULT_CONFIG } from './app/startup.ts'

/** data files; DataWindow bundles are stored gzip-compressed */
async function text(path: string): Promise<string | undefined> {
  if (/^dw\/(?!_index).*\.json$/.test(path)) {
    const r = await fetch('/data/' + path + '.gz')
    if (!r.ok || !r.body) return undefined
    return await new Response(r.body.pipeThrough(new DecompressionStream('gzip'))).text()
  }
  const r = await fetch('/data/' + path)
  return r.ok ? await r.text() : undefined
}

async function main(): Promise<void> {
  const q = new URLSearchParams(location.search)
  const names = JSON.parse((await text('names.json')) || '{}')
  const loader = new JsonClassLoader((n) => text(`classes/${n}.json`))
  const sqlTables = JSON.parse((await text('sql.json')) || '{}')
  const useMock = q.get('db') !== 'server'
  const desktop = document.getElementById('desktop') as HTMLElement
  const rt = await createRuntime({
    loader,
    readData: text,
    sharedVars: names.sharedVars,
    globalTypes: names.globalTypes,
    stmts: sqlTables.stmt,
    dwSql: sqlTables.dw,
    procs: sqlTables.proc,
    openDb: async (_t: PBObject): Promise<Db> => (useMock ? new MockDb(rt.dwCatalog!) : await new HttpDb().open()),
  })
  if (useMock) rt.dwSql = (n) => ({ sql: 'mock:' + n, params: [], proc: !!sqlTables.dw?.[n]?.proc })
  const ui = new DomUi(rt, desktop)
  rt.ui = ui
  rt.onError = (e) => {
    console.error(e)
    void ui.messageBox('Application error', e instanceof Error ? e.message : String(e), 'stopsign!', 'ok!', 1)
  }
  ;(window as unknown as { rt: unknown }).rt = rt
  if (q.get('app')) {
    try {
      await startApplication(rt, { ...DEFAULT_CONFIG, company: q.get('company') ?? '' })
    } catch (e) {
      rt.onError(e)
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
