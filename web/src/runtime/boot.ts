// Assembles a runtime: system functions, native classes, global variables of the application object.
import { Runtime } from './interp.ts'
import type { ClassLoader, UiHost } from './interp.ts'
import { registerSysFuncs } from './sysfuncs.ts'
import { registerWindowing } from './native/windowing.ts'
import { registerFileFuncs } from './sysfiles.ts'
import { executeStatement } from './native/transaction.ts'
import type { SqlEntry } from './native/transaction.ts'
import { PBObject } from './object.ts'
import { DwCatalog } from '../dw/def.ts'
import { defaultValue, PBArray } from './values.ts'
import type { Db } from './wire.ts'
import { ProcCaller } from './native/procs.ts'
import { translateDynamicSql } from './dynsql.ts'
import type { ProcSig } from './native/procs.ts'

/** type codes of the application's global variable table: code >> 16 is the primitive type */
const PRIM: Record<number, string> = { 1: 'integer', 2: 'long', 3: 'real', 4: 'double', 5: 'decimal', 6: 'string', 7: 'boolean', 8: 'any', 9: 'unsignedinteger', 10: 'unsignedlong', 11: 'blob', 12: 'date', 13: 'time', 14: 'datetime', 18: 'char' }

export interface BootOptions {
  loader: ClassLoader
  readData: (path: string) => Promise<string | undefined>
  ui?: UiHost
  openDb?: (t: PBObject) => Promise<Db>
  sharedVars?: Record<string, [string, number][]>
  globalTypes?: Record<string, string>
  dwSql?: Record<string, { sql: string; params: string[]; proc?: boolean }>
  stmts?: Record<string, SqlEntry>
  procs?: Record<string, ProcSig>
}

export async function createRuntime(o: BootOptions): Promise<Runtime> {
  const rt = new Runtime(o.loader)
  registerSysFuncs(rt)
  registerWindowing(rt)
  registerFileFuncs(rt)
  rt.ui = o.ui ?? null
  rt.dwCatalog = new DwCatalog(o.readData)
  rt.sql = executeStatement
  if (o.openDb) rt.openDb = o.openDb
  if (o.dwSql) {
    const t = o.dwSql
    rt.dwSql = (n) => t[n.toLowerCase()]
  }
  if (o.stmts) {
    const t = o.stmts
    rt.sqlStmt = (k) => t[k]
  }
  if (o.procs) rt.procs = new ProcCaller(o.procs)
  rt.translateSql = translateDynamicSql
  // message / error objects
  const message = new PBObject(rt, 'message', 'message')
  for (const [n, t] of [['stringparm', 'string'], ['doubleparm', 'double'], ['returnvalue', 'long'], ['number', 'long'], ['wordparm', 'long'], ['longparm', 'long'], ['handle', 'long'], ['processed', 'boolean']] as const) message.declare(n, t)
  message.declare('powerobjectparm', 'any')
  rt.globals.set('message', message)
  const error = new PBObject(rt, 'error', 'error')
  for (const [n, t] of [['number', 'integer'], ['text', 'string'], ['windowmenu', 'string'], ['object', 'string'], ['objectevent', 'string'], ['line', 'integer']] as const) error.declare(n, t)
  rt.globals.set('error', error)
  // global variables of the application object
  const vars = o.sharedVars?.traderappv1 ?? []
  for (const [name, code] of vars) {
    if (name === 'traderappv1' || rt.globals.has(name)) continue
    const prim = PRIM[code >> 16]
    const cls = o.globalTypes?.[name]
    if (prim && !cls) {
      // bit 0x2000 of the type word marks an array (gi_catlist, ga_llookuptable ...)
      if (code & 0x2000) {
        rt.globals.set(name, new PBArray(prim))
        rt.gtypes.set(name, prim + '[]')
      } else {
        rt.globals.set(name, defaultValue(prim))
        rt.gtypes.set(name, prim)
      }
    } else {
      rt.globals.set(name, null)
    }
  }
  const sqlca = await rt.instantiate(o.globalTypes?.sqlca ?? 'u_transaction')
  rt.globals.set('sqlca', sqlca)
  // global objects of the application: data stores start empty (the post-login initialisation fills them), the rest are plain instances
  for (const [name, cls] of Object.entries(o.globalTypes ?? {})) {
    if (['sqlca', 'sqlda', 'sqlsa', 'error', 'message'].includes(name)) continue
    if (cls === 'datastore' || (await rt.getClass(cls))) {
      try {
        rt.globals.set(name, await rt.instantiate(cls))
      } catch (e) {
        rt.noteMissing('global:' + name + ':' + (e as Error).message.slice(0, 40))
      }
    }
  }
  rt.sys.set('getapplication', { fn: (r) => r.globals.get('traderappv1') ?? null })
  return rt
}
