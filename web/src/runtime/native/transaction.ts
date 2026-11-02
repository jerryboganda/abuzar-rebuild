// Transaction object (sqlca and every user-defined transaction) and the embedded-SQL statement executor.
import { PBObject } from '../object.ts'
import type { Frame, Runtime } from '../interp.ts'
import type { Stmt } from '../../pbscript/ast.ts'
import { parseExpr } from '../../pbscript/parser.ts'
import { fromWire, toWire } from '../wire.ts'
import type { Db } from '../wire.ts'
import { PBRuntimeError } from '../values.ts'
import type { DwTrans } from '../../dw/model.ts'

export interface SqlEntry {
  sql: string
  /** host variable names in $1..$n order (as written in the PowerScript statement) */
  params: string[]
  /** INTO targets in column order */
  into?: string[]
  kind?: string
}

export class NTransaction extends PBObject implements DwTrans {
  db: Db | null = null
  cursors = new Map<string, { sql: string; params: unknown[]; rows?: unknown[][]; cols?: { name: string; type: string }[]; pos: number }>()

  constructor(rt: Runtime, className: string, native = 'transaction') {
    super(rt, className, native)
    for (const [n, t] of [
      ['dbms', 'string'], ['database', 'string'], ['userid', 'string'], ['dbpass', 'string'], ['logid', 'string'], ['logpass', 'string'],
      ['servername', 'string'], ['dbparm', 'string'], ['lock', 'string'], ['autocommit', 'boolean'], ['sqlcode', 'long'], ['sqlnrows', 'long'],
      ['sqldbcode', 'long'], ['sqlerrtext', 'string'], ['sqlreturndata', 'string'],
    ] as const) this.declare(n, t)
  }

  setError(code: number, text: string): void {
    this.props.set('sqlcode', code)
    this.props.set('sqldbcode', code)
    this.props.set('sqlerrtext', text)
  }
  setOk(rowcount: number): void {
    this.props.set('sqlcode', 0)
    this.props.set('sqldbcode', 0)
    this.props.set('sqlerrtext', '')
    this.props.set('sqlnrows', rowcount)
  }
  notFound(): void {
    this.props.set('sqlcode', 100)
    this.props.set('sqldbcode', 100)
    this.props.set('sqlnrows', 0)
  }

  async ensureDb(): Promise<Db | null> {
    if (this.db) return this.db
    if (this.rt.openDb) {
      try {
        this.db = await this.rt.openDb(this)
      } catch (e) {
        this.setError(-1, (e as Error).message)
        return null
      }
    }
    return this.db
  }

  async n_connect(): Promise<number> {
    const db = await this.ensureDb()
    if (!db) return -1
    this.setOk(0)
    return 1
  }
  async n_disconnect(): Promise<number> {
    if (this.db) await this.db.close()
    this.db = null
    this.setOk(0)
    return 1
  }
  async n_commit(): Promise<number> {
    if (!this.db) return -1
    await this.db.commit()
    this.setOk(0)
    return 1
  }
  async n_rollback(): Promise<number> {
    if (!this.db) return -1
    await this.db.rollback()
    this.setOk(0)
    return 1
  }

  /** stored-procedure call declared on the transaction (RPCFUNC) */
  override async pbCall(name: string, args: unknown[], rt: Runtime): Promise<unknown> {
    const own = this.findRoutines(name)
    if (own.length) return rt.runEntry(this, rt.pick(own, args.length)!, args)
    const nm = (this as unknown as Record<string, unknown>)['n_' + name]
    if (typeof nm === 'function') return (nm as (...a: unknown[]) => unknown).apply(this, args)
    if (rt.procs) return rt.procs.call(this, name, args)
    rt.noteMissing('rpc:' + name)
    return null
  }
}

/** which statement text to run: translated statements are looked up by the original (normalised) text */
export function stmtKey(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase()
}

async function hostValues(rt: Runtime, f: Frame, names: string[]): Promise<unknown[]> {
  const out: unknown[] = []
  for (const n of names) out.push(await rt.eval(parseExpr(n), f))
  return out
}

async function transOf(rt: Runtime, f: Frame, using: string | undefined): Promise<NTransaction> {
  let t: unknown
  if (using) t = await rt.eval(parseExpr(using), f)
  else t = rt.globals.get('sqlca')
  if (!(t instanceof NTransaction)) throw new PBRuntimeError('SQL statement without a transaction object')
  return t
}

/** embedded SQL statement of a script */
export async function executeStatement(rt: Runtime, f: Frame, st: Extract<Stmt, { k: 'sql' }>): Promise<void> {
  const t = await transOf(rt, f, st.using)
  switch (st.kind) {
    case 'connect':
      await t.n_connect()
      return
    case 'disconnect':
      await t.n_disconnect()
      return
    case 'commit':
      await t.n_commit()
      return
    case 'rollback':
      await t.n_rollback()
      return
  }
  const db = await t.ensureDb()
  if (!db) {
    t.setError(-1, 'not connected')
    return
  }
  const entry = rt.sqlStmt?.(stmtKey(st.text))
  if (st.kind === 'execute immediate') {
    const text = String((await hostValues(rt, f, st.hv))[0] ?? '')
    const tr = rt.translateSql?.(text)
    if (!tr) {
      t.setError(-1, 'dynamic SQL cannot be translated: ' + text.slice(0, 80))
      return
    }
    try {
      const r = await db.exec(tr.sql, [])
      t.setOk(r.rowcount)
    } catch (e) {
      t.setError(-1, (e as Error).message)
    }
    return
  }
  if (!entry) {
    rt.noteMissing('sql:' + st.kind + ':' + st.text.slice(0, 60))
    t.setError(-1, 'statement has no PostgreSQL translation')
    return
  }
  const params = (await hostValues(rt, f, entry.params)).map(toWire)
  try {
    if (st.kind === 'select' || st.kind === 'selectblob' || st.kind === 'fetch') {
      const res = await db.query(entry.sql, params)
      if (!res.rows.length) {
        t.notFound()
        return
      }
      const row = res.rows[0]
      const targets = entry.into || []
      for (let i = 0; i < targets.length; i++) {
        await rt.assign(parseExpr(targets[i]), fromWire(res.columns[i].type, row[i]), f)
      }
      t.setOk(res.rows.length)
    } else {
      const r = await db.exec(entry.sql, params)
      t.setOk(r.rowcount)
    }
  } catch (e) {
    t.setError(-1, (e as Error).message)
  }
}
