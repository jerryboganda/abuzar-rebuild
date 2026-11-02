// DataWindow data model: buffers, row status, retrieve / update through the database session, find / filter / sort, groups.
import type { Runtime } from '../runtime/interp.ts'
import { coerce, cmp, Dec, DATE_ZERO, equals, PBDate, PBDateTime, PBTime, toNum } from '../runtime/values.ts'
import { fromWire, toWire } from '../runtime/wire.ts'
import type { Db, QueryResult } from '../runtime/wire.ts'
import { argList, colKind, num, splitExpr } from './def.ts'
import type { DwDef, DwObject } from './def.ts'
import { compileDw, evalDw, newCtx, reduceAgg } from './expr.ts'
import { crosstabSpec, pivot } from './crosstab.ts'
import type { EvalCtx, EvalHost } from './expr.ts'

export const NOT_MODIFIED = 0
export const DATA_MODIFIED = 1
export const NEW = 2
export const NEW_MODIFIED = 3

export interface DwRow {
  v: unknown[]
  /** values as retrieved / last updated (for the update where-clause and for resetting) */
  orig: unknown[] | null
  st: number
  /** columns changed since retrieve / last update */
  mod: Set<number>
  sel: boolean
}

export class DwBuffers {
  primary: DwRow[] = []
  filtered: DwRow[] = []
  deleted: DwRow[] = []
  version = 0
}

export interface DwTrans {
  db: Db | null
  /** error text of the last statement */
  setError(code: number, text: string): void
  setOk(rowcount: number): void
}

export interface SqlSource {
  /** translated retrieve statement of a DataWindow and its argument names ($1..$n order) */
  dw(name: string): { sql: string; params: string[]; proc?: boolean; lists?: string[] } | undefined
}

/**
 * The item lists that traderappv1.open loads once into application-wide DataStores (gd_itemsinfo,
 * gd_popup_itemsinfo, gd_itemswithalternatealias).  Every screen shares those stores instead of retrieving its own
 * copy, so a repeated retrieve of the same DataWindow with the same arguments can reuse the session result.
 * Other DataWindows are deliberately not cached: reports and entry windows expect a fresh read whenever they retrieve.
 */
const SHARED_ITEM_LIST_DWS = new Set([
  'ddd_itemmanfnames_groupgodown',
  'ddd_itemmanfnames_cat_groupgodown',
  'ddd_itemmanfnames_groupgodown_popup',
  'ddd_itemmanfnames_groupgodown_popup_aa',
])

export class DwModel implements EvalHost {
  rt: Runtime
  def!: DwDef
  /** the definition as stored; a crosstab replaces `def` with the expanded one on every retrieve */
  baseDef: DwDef
  name: string
  buf = new DwBuffers()
  colNames!: string[]
  colIdx = new Map<string, number>()
  kinds!: ReturnType<typeof colKind>[]
  /** crosstab: new column indexes of the replicated columns of each value */
  xt: number[][] = []
  computes = new Map<string, DwObject>()
  overrides = new Map<string, string>() // modify(): "object.property" -> value
  trans: DwTrans | null = null
  row = 0 // current row (1-based, 0 = none)
  col = 0
  filterText = ''
  sortText = ''
  retrieveSqlOverride: string | null = null
  sqlSource: SqlSource | null = null
  /** child data for drop-down DataWindows by column name */
  children = new Map<string, DwModel>()
  lastError = ''
  /** retrieval arguments of the last retrieve by name (nested reports and expressions refer to them) */
  args = new Map<string, unknown>()
  /** a Reset() before the next Retrieve means the caller wants current data, not the session cache */
  private retrieveDirty = false

  constructor(rt: Runtime, name: string, def: DwDef) {
    this.rt = rt
    this.baseDef = def
    this.name = name
    this.setDef(def)
    this.sortText = (def.table.sort as string | undefined) || ''
    this.filterText = (def.table.filter as string | undefined) || ''
  }

  private setDef(def: DwDef): void {
    this.def = def
    this.colNames = def.table.columns.map((c) => c.name.toLowerCase())
    this.colIdx.clear()
    this.colNames.forEach((n, i) => this.colIdx.set(n, i))
    this.kinds = def.table.columns.map((c) => colKind(c.type))
    // a column object whose name is not a data column shows the column its `id` points at (copies of one column on a label)
    for (const o of def.objects) {
      const id = Number(o.id)
      if (o.type === 'column' && Number.isInteger(id) && id >= 1 && id <= this.colNames.length && !this.colIdx.has(o.name.toLowerCase())) this.colIdx.set(o.name.toLowerCase(), id - 1)
    }
    this.computes.clear()
    for (const o of def.objects) if (o.type === 'compute') this.computes.set(o.name.toLowerCase(), o)
  }

  get version(): number {
    return this.buf.version
  }
  touch(): void {
    this.buf.version++
  }

  // ---------------------------------------------------------------- columns
  /** 0-based column index of a column name / "#n" number; -1 when it is not a data column */
  colIndex(c: string | number): number {
    if (typeof c === 'number') return c >= 1 && c <= this.colNames.length ? c - 1 : -1
    const s = c.toLowerCase()
    if (s.startsWith('#')) return this.colIndex(Number(s.slice(1)))
    const i = this.colIdx.get(s)
    if (i !== undefined) return i
    // dotted names: "table.column"
    const dot = s.lastIndexOf('.')
    return dot > 0 ? this.colIdx.get(s.slice(dot + 1)) ?? -1 : -1
  }

  hasName(name: string): boolean {
    return this.colIdx.has(name) || this.computes.has(name)
  }

  defaultFor(i: number): unknown {
    const col = this.def.table.columns[i]
    // a script may set `dw.object.col.initial = ...` after the DataWindow is
    // built and before the row is inserted (Cash Sale sets the godown and
    // price type in ue_postopen, then ue_newform inserts the header row)
    const ov = this.overrides.get(`${col.name.toLowerCase()}.initial`)
    const ini = ov !== undefined ? ov : col.initial
    switch (this.kinds[i]) {
      case 'string':
        return ini !== undefined && ini !== '' && ini !== 'null' ? ini : null
      case 'number':
        return ini !== undefined && ini !== '' ? Number(ini) : null
      case 'decimal':
        return ini !== undefined && ini !== '' ? Dec.parse(ini) : null
      case 'date':
      case 'datetime':
      case 'time': {
        // the initial value `today` of a date / time column is the moment the row is inserted (the sale template's date shows 02/11/2026 11:46)
        if (ini?.trim().toLowerCase() !== 'today') return null
        const now = PBDateTime.fromJs(new Date())
        return this.kinds[i] === 'date' ? now.date : this.kinds[i] === 'time' ? now.time : now
      }
      default:
        return null
    }
  }

  coerceTo(i: number, v: unknown): unknown {
    if (v === null || v === undefined) return null
    switch (this.kinds[i]) {
      case 'string': {
        const s = typeof v === 'string' ? v : String(v)
        const m = /\((\d+)\)/.exec(this.def.table.columns[i].type)
        return m && s.length > +m[1] ? s.slice(0, +m[1]) : s
      }
      case 'number': {
        const t = this.def.table.columns[i].type.toLowerCase()
        if (t === 'long' || t === 'int' || t === 'ulong') return Math.trunc(toNum(v))
        return toNum(v)
      }
      case 'decimal': {
        const d = coerce('decimal', v) as Dec
        const m = /decimal\((\d+)\)/i.exec(this.def.table.columns[i].type)
        return m ? d.round(+m[1]) : d
      }
      case 'date':
        if (v instanceof PBDateTime) return v.date
        return v
      case 'datetime':
        if (v instanceof PBDate) return new PBDateTime(v.n, 0)
        return v
      default:
        return v
    }
  }

  // ---------------------------------------------------------------- rows
  rowCount(): number {
    return this.buf.primary.length
  }
  filteredCount(): number {
    return this.buf.filtered.length
  }
  deletedCount(): number {
    return this.buf.deleted.length
  }
  rowAt(row: number, buffer = 'primary'): DwRow | undefined {
    const list = buffer === 'filter' ? this.buf.filtered : buffer === 'delete' ? this.buf.deleted : this.buf.primary
    return list[row - 1]
  }

  newRowObject(status = NEW): DwRow {
    const v = this.colNames.map((_, i) => this.defaultFor(i))
    return { v, orig: null, st: status, mod: new Set(), sel: false }
  }

  insertRow(row: number): number {
    const r = this.newRowObject()
    const list = this.buf.primary
    const at = row <= 0 || row > list.length ? list.length : row - 1
    list.splice(at, 0, r)
    this.touch()
    this.row = at + 1
    return at + 1
  }

  deleteRow(row: number): number {
    const at = (row === 0 ? this.row : row) - 1
    const r = this.buf.primary[at]
    if (!r) return -1
    this.buf.primary.splice(at, 1)
    if (r.st !== NEW && r.st !== NEW_MODIFIED) this.buf.deleted.push(r)
    this.touch()
    if (this.row > this.buf.primary.length) this.row = this.buf.primary.length
    return 1
  }

  reset(): void {
    this.clearBuffers()
    // Reset() followed by Retrieve() is how the original refreshes a shared list (f_refreshitemlist and the windows
    // that explicitly rebuild gd_itemsinfo): that retrieve must go to the database, not answer from the session cache.
    this.retrieveDirty = true
  }

  /** clear the buffers without making the next retrieve bypass the session cache */
  private clearBuffers(): void {
    this.buf.primary = []
    this.buf.filtered = []
    this.buf.deleted = []
    this.row = 0
    this.touch()
  }

  getItem(row: number, c: string | number, buffer = 'primary'): unknown {
    const i = this.colIndex(c)
    const r = this.rowAt(row, buffer)
    if (!r || i < 0) return null
    return r.v[i]
  }

  /** value for display / expressions: data columns first, then computed fields (async) */
  async getValue(row: number, c: string | number, buffer = 'primary'): Promise<unknown> {
    const i = this.colIndex(c)
    if (i >= 0) return this.getItem(row, i + 1, buffer)
    const name = String(c).toLowerCase()
    const comp = this.computes.get(name)
    if (comp && buffer === 'primary') return this.evalCompute(comp, row)
    return null
  }

  async evalCompute(comp: DwObject, row: number): Promise<unknown> {
    const { value, expr } = splitExpr(comp.expression)
    const src = expr ?? value
    if (!src) return null
    try {
      return await evalDw(compileDw(src), newCtx(this, row, comp.band))
    } catch (e) {
      this.rt.noteMissing('dwexpr:' + (e as Error).message.slice(0, 60))
      return null
    }
  }

  setItem(row: number, c: string | number, value: unknown): number {
    const i = this.colIndex(c)
    const r = this.rowAt(row)
    if (!r || i < 0) return -1
    const v = this.coerceTo(i, value)
    const cur = r.v[i]
    if (cur === null || v === null ? cur !== v : !equals(cur, v)) {
      r.v[i] = v
      r.mod.add(i)
      if (r.st === NOT_MODIFIED) r.st = DATA_MODIFIED
      else if (r.st === NEW) r.st = NEW_MODIFIED
      this.touch()
    }
    return 1
  }

  getStatus(row: number, c: string | number | null, buffer = 'primary'): number {
    const r = this.rowAt(row, buffer)
    if (!r) return -1
    if (c === null || c === 0 || c === '') return r.st
    const i = this.colIndex(c)
    if (i < 0) return -1
    if (r.st === NEW || r.st === NEW_MODIFIED) return r.mod.has(i) ? NEW_MODIFIED : NEW
    return r.mod.has(i) ? DATA_MODIFIED : NOT_MODIFIED
  }

  setStatus(row: number, c: string | number | null, st: number, buffer = 'primary'): number {
    const r = this.rowAt(row, buffer)
    if (!r) return -1
    if (c === null || c === 0 || c === '') {
      r.st = st
      if (st === NOT_MODIFIED) r.mod.clear()
    } else {
      const i = this.colIndex(c)
      if (i < 0) return -1
      if (st === NOT_MODIFIED) r.mod.delete(i)
      else r.mod.add(i)
      if (r.mod.size === 0 && r.st === DATA_MODIFIED) r.st = NOT_MODIFIED
      else if (r.mod.size > 0 && r.st === NOT_MODIFIED) r.st = DATA_MODIFIED
    }
    return 1
  }

  modifiedCount(): number {
    return this.buf.primary.filter((r) => r.st === DATA_MODIFIED || r.st === NEW_MODIFIED).length + this.buf.deleted.length
  }

  // ---------------------------------------------------------------- retrieve
  async retrieve(args: unknown[]): Promise<number> {
    if (!this.trans || !this.trans.db) {
      this.lastError = 'no transaction object'
      return -1
    }
    argList(this.def).forEach((a, i) => this.args.set(a.name, args[i] ?? null))
    let sql: string
    let proc = false
    let params: unknown[] = []
    if (this.retrieveSqlOverride) {
      const tr = this.rt.translateSql?.(this.retrieveSqlOverride)
      if (!tr) {
        this.lastError = 'retrieve SQL was changed at run time and cannot be translated'
        return -1
      }
      sql = tr.sql
      params = tr.params.map((p) => args[argList(this.def).findIndex((a) => a.name === p)])
    } else {
      const src = this.sqlSource?.dw(this.name) ?? this.rt.dwSql?.(this.name)
      if (!src) {
        this.lastError = `no translated SQL for DataWindow ${this.name}`
        this.rt.noteMissing('dwsql:' + this.name)
        return -1
      }
      sql = src.sql
      proc = !!src.proc
      const decl = argList(this.def)
      params = src.params.map((p) => {
        const idx = decl.findIndex((a) => a.name === p.toLowerCase())
        const v = idx >= 0 ? args[idx] : null
        return toWire(v)
      })
    }
    try {
      const wireParams = params.map(toWire)
      const cacheKey = this.retrieveCacheKey(sql, wireParams, proc)
      let res: QueryResult
      if (cacheKey && !this.retrieveDirty && this.rt.retrieveCache.has(cacheKey)) {
        // the application already holds this item list for the session (usually gd_itemsinfo): share its result
        res = this.rt.retrieveCache.get(cacheKey)!
      } else {
        if (proc) {
          const c = await this.trans.db.call(sql, wireParams)
          res = c.resultsets[0] ? { columns: c.resultsets[0].columns, rows: c.resultsets[0].rows } : { columns: [], rows: [] }
        } else res = await this.trans.db.query(sql, wireParams)
        if (cacheKey) this.rt.retrieveCache.set(cacheKey, res)
      }
      this.clearBuffers()
      this.retrieveDirty = false
      if (this.baseDef.crosstab) return await this.pivotResult(res)
      const map: number[] = this.colNames.map((_, i) => i)
      if (res.columns.length) {
        // Result columns are in the order of the DataWindow columns.  A DDDW's
        // SQL often renames a column (Name -> customer_name) while keeping the
        // same count; mapping those by name nulls the column.  Use position
        // when the counts match, and fall back to names only when they differ.
        const byName = res.columns.map((c) => this.colIdx.get(c.name.toLowerCase()) ?? -1)
        if (res.columns.length !== this.colNames.length || byName.every((x) => x >= 0)) {
          for (let k = 0; k < res.columns.length; k++) map[k] = byName[k]
        }
      }
      const rows: DwRow[] = []
      for (const raw of res.rows) {
        const v: unknown[] = this.colNames.map(() => null)
        for (let k = 0; k < raw.length; k++) {
          const ci = map[k]
          if (ci === undefined || ci < 0) continue
          v[ci] = this.coerceTo(ci, fromWire(res.columns[k].type, raw[k]))
        }
        rows.push({ v, orig: v.slice(), st: NOT_MODIFIED, mod: new Set(), sel: false })
      }
      this.buf.primary = rows
      this.trans.setOk(rows.length)
      await this.applyFilterSort()
      this.row = this.buf.primary.length ? 1 : 0
      this.touch()
      return this.buf.primary.length
    } catch (e) {
      const err = e as { code?: string; message?: string }
      this.lastError = err.message || String(e)
      this.trans.setError(-1, this.lastError)
      return -1
    }
  }

  /** key of the session cache: DataWindow + translated SQL + parameter values (only the shared item lists are cached) */
  private retrieveCacheKey(sql: string, params: unknown[], proc: boolean): string {
    const name = this.name.toLowerCase()
    if (!SHARED_ITEM_LIST_DWS.has(name)) return ''
    return `${proc ? 'call' : 'sql'}\u0000${name}\u0000${sql}\u0000${JSON.stringify(params)}`
  }

  /** crosstab: the retrieved rows are the source of the pivot; the definition is expanded to the columns found in them */
  private async pivotResult(res: QueryResult): Promise<number> {
    const spec = crosstabSpec(this.baseDef)!
    const names = res.columns.length === spec.sourceNames.length ? spec.sourceNames : res.columns.map((c) => c.name.toLowerCase())
    const src = res.rows.map((raw) => raw.map((x, k) => fromWire(res.columns[k].type, x)))
    const p = await pivot(this.rt, this.baseDef, spec, names, src)
    this.setDef(p.def)
    this.xt = p.valueCols
    this.buf.primary = p.rows.map((vals) => {
      const v = vals.map((x, i) => this.coerceTo(i, x))
      return { v, orig: v.slice(), st: NOT_MODIFIED, mod: new Set<number>(), sel: false }
    })
    this.trans?.setOk(this.buf.primary.length)
    await this.applyFilterSort()
    this.row = this.buf.primary.length ? 1 : 0
    this.touch()
    return this.buf.primary.length
  }

  crosstabAgg(name: string, n: number, row: number): unknown {
    const r = this.buf.primary[row - 1]
    const cols = this.xt[n - 1]
    if (!r || !cols) return null
    return reduceAgg(name.slice('crosstab'.length), cols.map((i) => r.v[i]).filter((v) => v !== null))
  }

  /** suppress repeating values (`sparse` columns): true when the cell repeats the value of the row above */
  suppressed(row: number, col: number): boolean {
    const sp = this.def.sparse
    if (!sp || row < 2) return false
    const at = sp.findIndex((n) => this.colIdx.get(n.toLowerCase()) === col)
    if (at < 0) return false
    const a = this.buf.primary[row - 1]
    const b = this.buf.primary[row - 2]
    if (!a || !b) return false
    // a change in an earlier sparse column starts a new run for the later ones
    for (let i = 0; i <= at; i++) {
      const c = this.colIdx.get(sp[i].toLowerCase())
      if (c === undefined) continue
      if ((a.v[c] === null) !== (b.v[c] === null) || (a.v[c] !== null && !equals(a.v[c], b.v[c]))) return false
    }
    return true
  }

  // ---------------------------------------------------------------- update
  keyCols(): number[] {
    return this.def.table.columns.map((c, i) => (c.key === 'yes' ? i : -1)).filter((i) => i >= 0)
  }
  updatableCols(): number[] {
    return this.def.table.columns.map((c, i) => (c.update === 'yes' ? i : -1)).filter((i) => i >= 0)
  }
  dbColName(i: number): string {
    const c = this.def.table.columns[i]
    const dbn = c.dbname || c.name
    return dbn.slice(dbn.lastIndexOf('.') + 1).toLowerCase()
  }

  private whereFor(row: DwRow, params: unknown[]): string {
    const mode = this.def.table.updatewhere ?? '1'
    const cols = new Set<number>(this.keyCols())
    if (mode === '1') for (const i of this.updatableCols()) if (this.def.table.columns[i].updatewhereclause !== 'no') cols.add(i)
    if (mode === '2') for (const i of row.mod) if (this.def.table.columns[i].update === 'yes') cols.add(i)
    const parts: string[] = []
    for (const i of [...cols].sort((a, b) => a - b)) {
      const old = (row.orig ?? row.v)[i]
      const n = this.dbColName(i)
      if (old === null || old === undefined) parts.push(`${quoteIdent(n)} IS NULL`)
      else {
        params.push(toWire(old))
        parts.push(`${quoteIdent(n)} = $${params.length}`)
      }
    }
    return parts.join(' AND ')
  }

  /** statements for all pending changes: deletes, updates, inserts (PowerBuilder order) */
  buildUpdate(): { sql: string; params: unknown[]; expect: number }[] {
    const table = this.def.table.update
    if (!table) return []
    const out: { sql: string; params: unknown[]; expect: number }[] = []
    const t = quoteIdent(table.toLowerCase())
    for (const r of this.buf.deleted) {
      const params: unknown[] = []
      out.push({ sql: `DELETE FROM ${t} WHERE ${this.whereFor(r, params)}`, params, expect: 1 })
    }
    for (const r of this.buf.primary) {
      if (r.st === DATA_MODIFIED) {
        const cols = [...r.mod].filter((i) => this.def.table.columns[i].update === 'yes').sort((a, b) => a - b)
        if (!cols.length) continue
        const params: unknown[] = []
        const sets = cols.map((i) => {
          params.push(toWire(r.v[i]))
          return `${quoteIdent(this.dbColName(i))} = $${params.length}`
        })
        out.push({ sql: `UPDATE ${t} SET ${sets.join(', ')} WHERE ${this.whereFor(r, params)}`, params, expect: 1 })
      } else if (r.st === NEW_MODIFIED) {
        const cols = this.updatableCols().filter((i) => this.def.table.columns[i].identity !== 'yes')
        const params: unknown[] = []
        const names = cols.map((i) => quoteIdent(this.dbColName(i)))
        const vals = cols.map((i) => {
          params.push(toWire(r.v[i]))
          return `$${params.length}`
        })
        out.push({ sql: `INSERT INTO ${t} (${names.join(', ')}) VALUES (${vals.join(', ')})`, params, expect: 1 })
      }
    }
    return out
  }

  async update(accept = true, resetFlag = true): Promise<number> {
    if (!this.trans || !this.trans.db) return -1
    if (accept) await this.acceptText()
    const stmts = this.buildUpdate()
    try {
      for (const s of stmts) {
        const r = await this.trans.db.exec(s.sql, s.params)
        if (r.rowcount !== s.expect) {
          this.lastError = 'row changed between retrieve and update'
          this.trans.setError(-1, this.lastError)
          return -1
        }
      }
    } catch (e) {
      this.lastError = (e as Error).message
      this.trans.setError(-1, this.lastError)
      return -1
    }
    if (resetFlag) this.resetUpdate()
    // item prices / stock / description just changed: shared item lists must be retrieved again, not taken from the cache
    this.rt.invalidateRetrieveCache()
    this.trans.setOk(stmts.length)
    return 1
  }

  resetUpdate(): void {
    this.buf.deleted = []
    for (const r of this.buf.primary) {
      r.st = NOT_MODIFIED
      r.mod.clear()
      r.orig = r.v.slice()
    }
    this.touch()
  }

  /** hook for the visual control: push the text of the cell being edited into the buffer */
  acceptText: () => Promise<number> = async () => 1

  // ---------------------------------------------------------------- find / filter / sort
  async find(expr: string, start: number, end: number): Promise<number> {
    if (!expr.trim()) return 0
    const e = compileDw(expr)
    const step = end >= start ? 1 : -1
    const memo = new Map<string, unknown>()
    for (let r = Math.max(1, start); step > 0 ? r <= Math.min(end, this.rowCount()) : r >= Math.max(end, 1); r += step) {
      const ctx: EvalCtx = { host: this, row: r, band: 'detail', memo, depth: 0 }
      const v = await evalDw(e, ctx)
      if (v === true || (typeof v === 'number' && v !== 0)) return r
    }
    return 0
  }

  setFilter(text: string): number {
    this.filterText = text
    return 1
  }
  setSort(text: string): number {
    this.sortText = text
    return 1
  }

  async applyFilterSort(): Promise<void> {
    await this.filter()
    await this.sort()
  }

  async filter(): Promise<number> {
    const all = [...this.buf.primary, ...this.buf.filtered]
    const text = this.filterText.trim()
    if (!text || /^(none|\?)$/i.test(text)) {
      this.buf.primary = all
      this.buf.filtered = []
    } else {
      let e: ReturnType<typeof compileDw>
      try {
        e = compileDw(text)
      } catch (err) {
        this.lastError = (err as Error).message // an unusable filter: Filter() reports -1
        return -1
      }
      const keep: DwRow[] = []
      const out: DwRow[] = []
      // evaluate against a temporary primary buffer holding all rows
      const savedP = this.buf.primary
      this.buf.primary = all
      const memo = new Map<string, unknown>()
      for (let i = 0; i < all.length; i++) {
        const v = await evalDw(e, { host: this, row: i + 1, band: 'detail', memo, depth: 0 })
        ;(v === true || (typeof v === 'number' && v !== 0) ? keep : out).push(all[i])
      }
      void savedP
      this.buf.primary = keep
      this.buf.filtered = out
    }
    this.touch()
    return 1
  }

  /** sort spec: "col A, col D, expression A" */
  async sort(): Promise<number> {
    const spec = this.sortText.trim()
    if (!spec) return 1
    let keys: { expr: ReturnType<typeof compileDw>; desc: boolean }[]
    try {
      keys = spec.split(',').map((s) => {
        const m = /^(.*?)(?:\s+([AD]))?\s*$/i.exec(s.trim())!
        return { expr: compileDw(m[1].trim()), desc: (m[2] || 'A').toUpperCase() === 'D' }
      })
    } catch (e) {
      this.lastError = (e as Error).message // an unusable sort specification: Sort() reports -1
      return -1
    }
    const rows = this.buf.primary
    const keyed: { r: DwRow; k: unknown[] }[] = []
    const savedP = this.buf.primary
    for (let i = 0; i < rows.length; i++) {
      const k: unknown[] = []
      for (const key of keys) k.push(await evalDw(key.expr, { host: this, row: i + 1, band: 'detail', memo: new Map(), depth: 0 }))
      keyed.push({ r: rows[i], k })
    }
    void savedP
    // stable sort; null sorts first (as in PowerBuilder)
    keyed.sort((a, b) => {
      for (let j = 0; j < keys.length; j++) {
        const x = a.k[j]
        const y = b.k[j]
        let c = x === null ? (y === null ? 0 : -1) : y === null ? 1 : cmp(x, y)
        if (keys[j].desc) c = -c
        if (c !== 0) return c
      }
      return 0
    })
    this.buf.primary = keyed.map((x) => x.r)
    this.touch()
    return 1
  }

  // ---------------------------------------------------------------- EvalHost
  async colValue(name: string, ctx: EvalCtx, rel = 0): Promise<unknown> {
    const row = ctx.row + rel
    const i = this.colIdx.get(name)
    if (i !== undefined) {
      const r = this.buf.primary[row - 1]
      return r ? r.v[i] : null
    }
    if (this.args.has(name)) return this.args.get(name)
    const comp = this.computes.get(name)
    if (comp) {
      if (ctx.depth > 20) return null
      const { value, expr } = splitExpr(comp.expression)
      const src = expr ?? value
      if (!src) return null
      return evalDw(compileDw(src), { ...ctx, row, band: comp.band, depth: ctx.depth + 1 })
    }
    this.rt.noteMissing('dwname:' + name)
    return null
  }

  groupLevels(): { level: number; by: number[] }[] {
    const groups = (this.def.bands.group || []) as { level: string; by: { _items: string[] } }[]
    return groups.map((g) => ({ level: Number(g.level), by: g.by._items.map((c) => this.colIndex(c)).filter((i) => i >= 0) }))
  }

  scopeRange(ctx: EvalCtx, sc: { kind: string; n?: number } | undefined): [number, number] {
    const n = this.rowCount()
    let kind = sc?.kind
    let level = sc?.n ?? 0
    if (!kind) {
      const m = /^(?:header|trailer)\.(\d+)$/.exec(ctx.band)
      if (m) {
        kind = 'group'
        level = Number(m[1])
      } else kind = 'all'
    }
    if (kind === 'group') {
      const lv = this.groupLevels().find((g) => g.level === level) ?? this.groupLevels()[0]
      if (!lv) return [1, n]
      // a group spans consecutive rows with equal values of all `by` columns of levels up to this one
      const cols = this.groupLevels().filter((g) => g.level <= lv.level).flatMap((g) => g.by)
      const same = (a: DwRow, b: DwRow) => cols.every((i) => equals(a.v[i], b.v[i]) && (a.v[i] === null) === (b.v[i] === null))
      const rows = this.buf.primary
      let lo = Math.min(Math.max(ctx.row, 1), n)
      let hi = lo
      if (!rows[lo - 1]) return [1, n]
      while (lo > 1 && same(rows[lo - 2], rows[lo - 1])) lo--
      while (hi < n && same(rows[hi], rows[hi - 1])) hi++
      return [lo, hi]
    }
    return [1, n]
  }

  /** set by the printing code while it renders a page */
  printPage = 1
  printPageCount = 1
  printAcross = 1
  printAcrossCount = 1
  pageInfo(): { page: number; pageCount: number; across: number; acrossCount: number } {
    return { page: this.printPage, pageCount: this.printPageCount, across: this.printAcross, acrossCount: this.printAcrossCount }
  }

  // ---------------------------------------------------------------- misc
  describe(prop: string): string {
    const p = prop.toLowerCase()
    const ov = this.overrides.get(p)
    if (ov !== undefined) return ov
    if (p === 'datawindow.processing') return this.def.datawindow.processing ?? '0'
    if (p === 'datawindow.table.select') return this.def.table.retrieve ?? ''
    if (p === 'datawindow.table.update') return this.def.table.update ?? ''
    if (p === 'datawindow.table.sort') return this.sortText
    if (p === 'datawindow.table.filter') return this.filterText
    if (p === 'datawindow.units') return this.def.datawindow.units ?? '0'
    if (p === 'datawindow.color') return this.def.datawindow.color ?? ''
    if (p === 'datawindow.column.count') return String(this.colNames.length)
    if (p === 'datawindow.readonly') return this.overrides.get('datawindow.readonly') ?? 'no'
    // the print settings of the DataWindow object (the report window toggles the preview rulers by reading them: default no)
    if (p.startsWith('datawindow.print.')) {
      const v = this.def.datawindow[p.slice('datawindow.'.length)]
      if (v !== undefined) return v
      if (p === 'datawindow.print.preview' || p === 'datawindow.print.preview.rulers') return 'no'
    }
    const m = /^([^.]+)\.(.+)$/.exec(p)
    if (m) {
      const [, obj, attr] = m
      const ci = this.colIndex(obj)
      if (ci >= 0) {
        const col = this.def.table.columns[ci]
        if (attr === 'coltype') return col.type
        if (attr === 'name') return this.colNames[ci]
        if (attr === 'dbname') return col.dbname || col.name
        if (attr === 'id') return String(ci + 1)
        if (attr === 'key') return col.key || 'no'
        if (attr === 'update') return col.update || 'no'
        if (attr === 'initial') return col.initial ?? ''
      }
      if (attr === 'type') {
        const o = this.def.objects.find((x) => x.name.toLowerCase() === obj)
        return o ? o.type : '!'
      }
      const o = this.def.objects.find((x) => x.name.toLowerCase() === obj)
      if (o) {
        const v = o[attr]
        if (v !== undefined) return splitExpr(v).value
        if (attr === 'x' || attr === 'y' || attr === 'width' || attr === 'height') return String(num(o, attr))
        return '?'
      }
      const i = this.colIndex(obj)
      if (i >= 0 && attr === 'id') return String(i + 1)
    }
    return '!'
  }

  /** modify("col.prop=value col2.prop=value ...") - returns '' on success, the message on error like PowerBuilder */
  modify(text: string): string {
    // split on whitespace that is followed by "name.prop=" (values may be quoted and contain spaces)
    const re = /([A-Za-z_#][\w.#\[\]]*?)\s*=\s*("(?:[^"]|~")*"|'(?:[^']|~')*'|\S+)/g
    let m: RegExpExecArray | null
    while ((m = re.exec(text)) !== null) {
      let v = m[2]
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
      const key = m[1].toLowerCase()
      // `visible` and `protect` are read as 1 / 0: scripts assign booleans (`object.headerno.visible = false` arrives as `no`)
      if (/\.(visible|protect)$/.test(key)) v = /^(no|false)$/i.test(v) ? '0' : /^(yes|true)$/i.test(v) ? '1' : v
      this.overrides.set(key, v)
      if (key === 'datawindow.table.select') this.retrieveSqlOverride = v
      else if (key === 'datawindow.table.sort') this.sortText = v
      else if (key === 'datawindow.table.filter') this.filterText = v
    }
    this.touch()
    return ''
  }
}

function quoteIdent(n: string): string {
  return /^[a-z_][a-z0-9_]*$/.test(n) && !RESERVED.has(n) ? n : '"' + n.replace(/"/g, '""') + '"'
}
const RESERVED = new Set(['user', 'order', 'group', 'limit', 'offset', 'check', 'default', 'table', 'column', 'select', 'from', 'where', 'all', 'and', 'or', 'not', 'null', 'primary', 'references', 'union', 'unique', 'using', 'when', 'then', 'case', 'end', 'in', 'is', 'like', 'on', 'as', 'to', 'for', 'with', 'both', 'cast', 'do', 'else', 'false', 'true', 'fetch', 'having', 'into', 'natural', 'only', 'some', 'trailing', 'leading'])

export { DATE_ZERO, PBTime }
