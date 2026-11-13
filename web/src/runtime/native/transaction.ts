// Transaction object (sqlca and every user-defined transaction) and the embedded-SQL statement executor.
import { PBObject } from '../object.ts'
import type { Frame, Runtime } from '../interp.ts'
import { Ref } from '../interp.ts'
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

/** a transaction object that nothing refers to any more gives its server session back (PowerBuilder disconnects when the object is collected) */
const abandoned = new FinalizationRegistry<Db>((db) => void db.close().catch(() => undefined))

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
        if (this.db) abandoned.register(this, this.db, this.db)
      } catch (e) {
        this.setError(-1, (e as Error).message)
        return null
      }
    }
    return this.db
  }

  /** server date and time (GetDateTime(ref datetime)) */
  async n_getdatetime(ref?: unknown): Promise<number> {
    const db = await this.ensureDb()
    if (!db || !(ref instanceof Ref)) return -1
    const r = await db.query('SELECT localtimestamp(3)', [])
    await ref.set(fromWire('timestamp', r.rows[0]?.[0]))
    this.setOk(1)
    return 1
  }

  /** `destroy lt_trans`: the session goes back to the server */
  override destroy(): void {
    const d = this.db
    this.db = null
    if (d) {
      abandoned.unregister(d)
      void d.close().catch(() => undefined)
    }
    super.destroy()
  }

  async n_connect(): Promise<number> {
    const db = await this.ensureDb()
    if (!db) return -1
    this.setOk(0)
    return 1
  }
  async n_disconnect(): Promise<number> {
    if (this.db) {
      abandoned.unregister(this.db)
      await this.db.close()
    }
    this.db = null
    this.setOk(0)
    return 1
  }
  /** `DBCC CHECKDB`: a PostgreSQL catalog integrity probe that records a
   * completion row in the original DBCC_History monitor table (no problems =
   * RepairLevel null, which the integrity window filters out). */
  async n_checkdbintegrity(dbName?: unknown): Promise<number> {
    const db = await this.ensureDb()
    if (!db) return -1
    try {
      await db.query('SELECT count(*) FROM pg_catalog.pg_class', [])
      await db.query('SELECT count(*) FROM pg_catalog.pg_attribute', [])
      await db.query('SELECT count(*) FROM dbo.dbcc_history', [])
      const name = String(dbName ?? '')
      await db.exec(
        `INSERT INTO dbo.dbcc_history
           (errorid, levelid, stateid, messagetext, repairlevel, statusid, dbid, objectid, indid, fileid,
            pageid, slotid, reffileid, refpageid, refslotid, allocationid, db, object, date, rowid)
         VALUES (0, 0, 0, 'PostgreSQL integrity check completed', NULL, 0, 0, 0, 0, 0,
                 0, 0, 0, 0, 0, 0, $1, 'database', localtimestamp(3),
                 (SELECT coalesce(max(rowid), 0) + 1 FROM dbo.dbcc_history))`,
        [name],
      )
      this.setOk(0)
      return 1
    } catch (e) {
      this.setError(-1, (e as Error).message)
      return -1
    }
  }

  async n_commit(): Promise<number> {
    if (!this.db) return -1
    await this.db.commit()
    this.rt.invalidateRetrieveCache()
    this.setOk(0)
    return 1
  }
  async n_rollback(): Promise<number> {
    if (!this.db) return -1
    await this.db.rollback()
    this.rt.invalidateRetrieveCache()
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

/** the transaction of a statement that may run without one (`SQL stop` on a transaction that was never connected) */
async function optionalTransOf(rt: Runtime, f: Frame, using: string | undefined): Promise<NTransaction | null> {
  try {
    return await transOf(rt, f, using)
  } catch {
    return null
  }
}

/** embedded SQL statement of a script */
export async function executeStatement(rt: Runtime, f: Frame, st: Extract<Stmt, { k: 'sql' }>): Promise<void> {
  if (st.kind === 'disconnect') {
    // `SQL stop USING <transaction>`: a window that never connected its transaction (the data transfer window
    // closes itself before it connects) has no session to stop.  The original never reaches this because its
    // version check passes; the rebuild must not raise a null reference when it does not.
    const t = await optionalTransOf(rt, f, st.using)
    if (!t) return
    await t.n_disconnect()
    return
  }
  const t = await transOf(rt, f, st.using)
  switch (st.kind) {
    case 'connect':
      await t.n_connect()
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
  let entry = rt.sqlStmt?.(stmtKey(st.text))
  // SQL Server Agent: `Select enabled INTO :x From SysJobs Where Name = :job`.  Reading a job's enabled flag must not create it: an unknown or blank name is simply treated as disabled (the old app's SELECT did not insert either).
  const job = entry ? null : /^select\s+enabled\s+into\s+:(\S+)\s+from\s+sysjobs\s+where\s+name\s*=\s*:(\S+?)\s*;?$/i.exec(st.text.trim())
  if (job) {
    entry = { sql: 'SELECT coalesce(max(enabled), 0) AS enabled FROM dbo.sysjobs WHERE name = $1', params: [job[2]], into: [job[1]] }
  }
  if (st.kind === 'execute immediate') {
    const text = String((await hostValues(rt, f, st.hv))[0] ?? '')
    // SQL Server maintenance commands have no SQL translation: the HTTP db
    // handles `BACKUP DATABASE ...` as a pg_dump and `DBCC ...` as a
    // PostgreSQL check, so pass them through untouched.
    if (/^\s*backup\s+database\b/i.test(text)) {
      try {
        const r = await db.exec(text, [])
        rt.invalidateRetrieveCache()
        t.setOk(r.rowcount)
      } catch (e) {
        t.setError(-1, (e as Error).message)
      }
      return
    }
    const tr = rt.translateSql?.(text)
    if (!tr) {
      t.setError(-1, 'dynamic SQL cannot be translated: ' + text.slice(0, 80))
      return
    }
    try {
      const r = await db.exec(tr.sql, [])
      rt.invalidateRetrieveCache()
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
      rt.invalidateRetrieveCache()
      t.setOk(r.rowcount)
    }
  } catch (e) {
    t.setError(-1, (e as Error).message)
  }
}
