// Short-lived memory of SELECT results in the browser (see HttpDb.query).
//
// Over the internet every query is a round trip (~150 ms from the shop to the server).  Two kinds of results are remembered:
//  * any read-only SELECT, by the same session, for RECENT_MS (the login reads the same lists twice in a row);
//  * drop-down lists (QueryOptions.rememberMs, see dw/model.ts lookupDataWindows), by every session of this browser, for that long
//    (owner decision 2026-11-15: two minutes), so reopening a screen does not ask for every list again.
// A write of this browser forgets, at once, every remembered result that reads a table the write changes: the target of an
// INSERT/UPDATE/DELETE, every table a called procedure writes, and what the triggers of those tables write in turn (both read
// from the database's own catalogue, once per page).  Anything that cannot be told (dynamic SQL, a statement not understood)
// forgets everything.  Lists are not stored from a session that holds uncommitted changes, so another window never sees them.
// Another PC's change shows up here after the remembered time at the latest, as if the query had run that much earlier.
import type { QueryResult } from '../runtime/wire.ts'

export const RECENT_MS = 5000
const MAX_ENTRIES = 96

/** results whose value depends on the moment, or statements that change state, are never remembered */
const VOLATILE = /\b(set_config|nextval|setval|currval|lastval|now|getdate|sysdatetime|current_timestamp|current_date|current_time|localtimestamp|clock_timestamp|statement_timestamp|timeofday|random|newid|uuid_generate_v4|gen_random_uuid|serverdate|txid_current|pg_sleep|pg_advisory_\w*)\b|\bfor\s+(update|share)\b|\binto\b|\bsp_\w+/i

export function rememberable(sql: string): boolean {
  return /^\s*select\b/i.test(sql) && !VOLATILE.test(sql)
}

/**
 * The tables a SELECT reads.  The translated SQL names every table `dbo.<name>`; a statement with an unqualified table or a call
 * of a database function (other than the pure `tsql_*` helpers) has reads that cannot be told: undefined.
 */
export function tablesRead(sql: string): Set<string> | undefined {
  if (/\b(?:from|join)\s+(?!dbo\.|\(|lateral\b|unnest\b|generate_series\b)[a-z_"]/i.test(sql)) return undefined
  for (const m of sql.matchAll(/\bdbo\."?(\w+)"?\s*\(/gi)) if (!/^tsql_/i.test(m[1])) return undefined
  const tables = new Set<string>()
  for (const m of sql.matchAll(/\bdbo\."?(\w+)"?(?!\w|"?\s*\()/gi)) tables.add(m[1].toLowerCase())
  return tables
}

/** the table an INSERT / UPDATE / DELETE / TRUNCATE changes; '*' when the statement is anything else that may write */
export function tableWritten(sql: string): string | '*' | null {
  const m = /^\s*(?:insert\s+into|update|delete\s+from|delete|truncate(?:\s+table)?|merge\s+into)\s+(?:only\s+)?(dbo\.)?"?(\w+)"?/i.exec(sql)
  if (m) return m[1] ? m[2].toLowerCase() : /^(?:#|tmp_|temp_|t_)/i.test(m[2]) ? null : '*'
  // temporary tables of a session are never read by a remembered list (those read dbo.<table> only)
  if (/^\s*(?:create|drop)\s+(?:(?:local\s+|global\s+)?(?:temp|temporary)\s+)?table\b/i.test(sql) && !/\bdbo\./i.test(sql)) return null
  if (/^\s*(?:set|show|select)\b/i.test(sql) && !/\binto\b/i.test(sql)) return null
  return '*'
}

interface Entry {
  until: number
  result: QueryResult
  /** undefined: reads cannot be told, forgotten by any write */
  tables?: Set<string>
}
const entries = new Map<string, Entry>()

export function recall(key: string): QueryResult | undefined {
  const e = entries.get(key)
  if (!e) return undefined
  if (Date.now() > e.until) {
    entries.delete(key)
    return undefined
  }
  return structuredClone(e.result)
}

export function remember(key: string, sql: string, result: QueryResult, ms: number): void {
  entries.delete(key)
  if (entries.size >= MAX_ENTRIES) entries.delete(entries.keys().next().value!)
  entries.set(key, { until: Date.now() + ms, result: structuredClone(result), tables: tablesRead(sql) })
}

/** forget every result that reads one of `tables` ('*': everything) */
export function forget(tables: ReadonlySet<string> | '*'): void {
  if (tables === '*') {
    entries.clear()
    return
  }
  if (!tables.size) return
  for (const [key, e] of entries) if (!e.tables || [...e.tables].some((t) => tables.has(t))) entries.delete(key)
}

export function forgetAll(): void {
  entries.clear()
}

/**
 * What procedures, functions and triggers write, read from the database's catalogue (pg_proc / pg_trigger) once per page, on the
 * first write: one query.  `run` sends a read-only query through an open session.
 */
type Run = (sql: string, params: unknown[]) => Promise<QueryResult>
interface Writes {
  tables: Set<string>
  /** database functions it calls (resolved in turn) */
  calls: string[]
  /** EXECUTE of a built statement: anything may change */
  dynamic: boolean
}
interface Catalogue {
  functions: Map<string, Writes>
  triggers: Map<string, Writes[]>
}
const WRITE_TARGETS = String.raw`(?:insert\s+into|update|delete\s+from|truncate(?:\s+table)?)\s+(?:only\s+)?(?:dbo\.)?"?(\w+)`
const CATALOGUE_SQL = String.raw`WITH f AS (SELECT p.oid, p.proname, p.prosrc FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'dbo' AND p.prolang <> 12) ` +
  `SELECT kind, key, (SELECT string_agg(DISTINCT lower(m[1]), ',') FROM regexp_matches(src, '${WRITE_TARGETS}', 'gi') AS m) AS writes, ` +
  String.raw`src ~* '\mexecute\M' AS dynamic, ` +
  String.raw`(SELECT string_agg(DISTINCT lower(x[1]), ',') FROM regexp_matches(src, 'dbo\.(\w+)\s*\(', 'gi') AS x WHERE EXISTS (SELECT 1 FROM f AS g WHERE g.proname = lower(x[1]))) AS calls ` +
  `FROM (SELECT 'f' AS kind, proname::text AS key, prosrc AS src FROM f UNION ALL ` +
  `SELECT 't', lower(c.relname), p.prosrc FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace JOIN pg_proc p ON p.oid = t.tgfoid ` +
  `WHERE n.nspname = 'dbo' AND NOT t.tgisinternal) AS s`
let catalogue: Promise<Catalogue> | null = null

const isTrue = (v: unknown) => v === true || v === 't' || v === 'true'
const list = (v: unknown) => (typeof v === 'string' && v ? v.split(',') : [])

function loadCatalogue(run: Run): Promise<Catalogue> {
  catalogue ??= run(CATALOGUE_SQL, []).then((r) => {
    const functions = new Map<string, Writes>()
    const triggers = new Map<string, Writes[]>()
    for (const [kind, key, writes, dynamic, calls] of r.rows) {
      const w: Writes = { tables: new Set(list(writes)), calls: list(calls), dynamic: isTrue(dynamic) }
      const name = String(key).toLowerCase()
      if (kind === 't') triggers.set(name, [...(triggers.get(name) ?? []), w])
      else {
        // overloads of one name: everything any of them writes
        const prev = functions.get(name)
        functions.set(name, prev ? { tables: new Set([...prev.tables, ...w.tables]), calls: [...prev.calls, ...w.calls], dynamic: prev.dynamic || w.dynamic } : w)
      }
    }
    return { functions, triggers }
  })
  catalogue.catch(() => (catalogue = null))
  return catalogue
}

/** everything that writing `tables` and running `functions` changes: their own targets, what called functions write, what triggers write */
function closure(cat: Catalogue, tables: Iterable<string>, functions: Iterable<string>): Set<string> | '*' {
  const out = new Set<string>()
  const seenFn = new Set<string>()
  const tableTodo = [...tables]
  const fnTodo = [...functions]
  while (tableTodo.length || fnTodo.length) {
    if (fnTodo.length) {
      const f = fnTodo.pop()!
      if (seenFn.has(f)) continue
      seenFn.add(f)
      const w = cat.functions.get(f)
      if (!w || w.dynamic) return '*'
      tableTodo.push(...w.tables)
      fnTodo.push(...w.calls)
      continue
    }
    const t = tableTodo.pop()!
    if (out.has(t)) continue
    out.add(t)
    for (const w of cat.triggers.get(t) ?? []) {
      if (w.dynamic) return '*'
      tableTodo.push(...w.tables)
      fnTodo.push(...w.calls)
    }
  }
  return out
}

/** the tables changed by writing `tables`, including what their triggers write in turn */
export async function withTriggers(run: Run, tables: Iterable<string>): Promise<Set<string> | '*'> {
  return closure(await loadCatalogue(run), tables, [])
}

/** the tables a call such as `SELECT * FROM dbo.sp_x(...)` changes (procedures it calls and triggers included); '*' when that cannot be told */
export async function procedureWrites(run: Run, sql: string): Promise<Set<string> | '*'> {
  const m = /\bdbo\."?(\w+)"?\s*\(/i.exec(sql)
  if (!m) return '*'
  return closure(await loadCatalogue(run), [], [m[1].toLowerCase()])
}

/** for tests */
export function resetQueryMemory(): void {
  entries.clear()
  catalogue = null
}
