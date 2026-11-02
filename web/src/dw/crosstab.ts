// Crosstab DataWindows (processing = 4; 147 of them, all dynamic).  The retrieve returns the source rows; they are pivoted here:
// one row per distinct combination of the row columns, one group of value columns per distinct combination of the column
// columns.  The definition grows the way a dynamic crosstab does: objects that sit inside the horizontal zone of the repeating
// value columns are replicated once per crosstab column (a text starting with `@` shows the column value), everything to the
// right of the zone moves by the added width.
import type { Runtime } from '../runtime/interp.ts'
import { cmp, toStr } from '../runtime/values.ts'
import type { DwColumn, DwDef, DwObject } from './def.ts'
import { num } from './def.ts'
import { compileDw, evalDw, reduceAgg } from './expr.ts'
import type { EvalHost } from './expr.ts'

export interface ValueSpec {
  fn: string
  arg: string
}
export interface CrosstabSpec {
  columns: string[]
  rows: string[]
  values: ValueSpec[]
  sourceNames: string[]
}

export interface Pivot {
  def: DwDef
  rows: unknown[][]
  /** new column indexes of the replicated columns of each value (crosstabsum(n) works over valueCols[n - 1]) */
  valueCols: number[][]
}

/** split at commas outside parentheses and quotes */
function splitTop(s: string): string[] {
  const out: string[] = []
  let depth = 0
  let quote = ''
  let cur = ''
  for (const ch of s) {
    if (quote) {
      if (ch === quote) quote = ''
    } else if (ch === '"' || ch === "'") quote = ch
    else if (ch === '(') depth++
    else if (ch === ')') depth--
    if (ch === ',' && depth === 0 && !quote) {
      out.push(cur.trim())
      cur = ''
    } else cur += ch
  }
  if (cur.trim()) out.push(cur.trim())
  return out
}

export function crosstabSpec(def: DwDef): CrosstabSpec | null {
  const c = def.crosstab
  if (!c) return null
  const names = (s: string | undefined) => splitTop(s ?? '').map((x) => x.toLowerCase())
  const values = splitTop(c.values ?? '').map((t): ValueSpec => {
    const m = /^(\w+)\s*\(([\s\S]*?)\s+for\s+crosstab\s*\)$/i.exec(t)
    return m ? { fn: m[1].toLowerCase(), arg: m[2].trim() } : { fn: 'first', arg: t }
  })
  return { columns: names(c.columns), rows: names(c.rows), values, sourceNames: names(c.sourcenames) }
}

const IDENT = /^[A-Za-z_][\w$#.]*$/

function sourceHost(rt: Runtime, names: Map<string, number>, rows: unknown[][]): EvalHost {
  return {
    rt,
    colValue: (n, ctx, rel = 0) => rows[ctx.row - 1 + rel]?.[names.get(n) ?? -1] ?? null,
    hasName: (n) => names.has(n),
    rowCount: () => rows.length,
    scopeRange: () => [1, rows.length],
    version: 0,
    pageInfo: () => ({ page: 1, pageCount: 1 }),
  }
}

const cmpNullFirst = (a: unknown, b: unknown): number => (a === null ? (b === null ? 0 : -1) : b === null ? 1 : cmp(a, b))
const keyOf = (vals: unknown[]): string => JSON.stringify(vals.map((v) => (v === null || v === undefined ? null : toStr(v))))

/** replace identifiers outside string literals */
function rewrite(src: string, map: Map<string, string>, re: RegExp): string {
  const parts = src.split(/("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/)
  return parts.map((p, i) => (i % 2 ? p : p.replace(re, (m) => map.get(m.toLowerCase()) ?? m))).join('')
}

/** expression-carrying properties: the whole `expression`, or the part after the tab of `value<TAB>expression` */
function rewriteProps(o: DwObject, map: Map<string, string>, re: RegExp): void {
  for (const k of Object.keys(o)) {
    const v = o[k]
    if (typeof v !== 'string') continue
    if (k === 'expression') o[k] = rewrite(v, map, re)
    else {
      const i = v.indexOf('\t')
      if (i >= 0) o[k] = v.slice(0, i + 1) + rewrite(v.slice(i + 1), map, re)
    }
  }
}

const left = (o: DwObject): number => (o.type === 'line' ? Math.min(num(o, 'x1'), num(o, 'x2')) : num(o, 'x'))
function moveX(o: DwObject, dx: number): void {
  if (!dx) return
  if (o.type === 'line') {
    o.x1 = String(num(o, 'x1') + dx)
    o.x2 = String(num(o, 'x2') + dx)
  } else o.x = String(num(o, 'x') + dx)
}

export async function pivot(rt: Runtime, base: DwDef, spec: CrosstabSpec, srcNames: string[], srcRows: unknown[][]): Promise<Pivot> {
  const idx = new Map<string, number>()
  srcNames.forEach((n, i) => idx.set(n.toLowerCase(), i))
  const need = (n: string): number => {
    const i = idx.get(n)
    if (i === undefined) throw new Error(`crosstab column ${n} is not in the source result`)
    return i
  }
  const rowIdx = spec.rows.map(need)
  const colIdx = spec.columns.map(need)

  // value columns of the view: table columns that are not row columns (same order as the values)
  const rowSet = new Set(spec.rows)
  const tableCols = base.table.columns
  const valCols: DwColumn[] = tableCols.filter((c) => !rowSet.has(c.name.toLowerCase()))
  const valueDef = spec.values.map((v, k): DwColumn => valCols[k] ?? { type: 'number', name: IDENT.test(v.arg) ? v.arg : `value${k + 1}` })
  const valNames = new Set(valueDef.map((c) => c.name.toLowerCase()))
  const rowCols = tableCols.filter((c) => !valNames.has(c.name.toLowerCase()))

  // value of each source row for each value expression
  const host = sourceHost(rt, idx, srcRows)
  const getters = spec.values.map((v) => {
    const i = IDENT.test(v.arg) ? idx.get(v.arg.toLowerCase()) : undefined
    if (i !== undefined) return async (r: unknown[]) => r[i] ?? null
    const e = compileDw(v.arg)
    return async (_r: unknown[], row: number) => (await evalDw(e, { host, row, band: 'detail', memo: new Map(), depth: 0 })) ?? null
  })

  const rowMap = new Map<string, { vals: unknown[]; cells: Map<string, unknown[][]> }>()
  const colMap = new Map<string, unknown[]>()
  for (let ri = 0; ri < srcRows.length; ri++) {
    const r = srcRows[ri]
    const rv = rowIdx.map((i) => r[i] ?? null)
    const cv = colIdx.map((i) => r[i] ?? null)
    const rk = keyOf(rv)
    const ck = keyOf(cv)
    let re = rowMap.get(rk)
    if (!re) rowMap.set(rk, (re = { vals: rv, cells: new Map() }))
    if (!colMap.has(ck)) colMap.set(ck, cv)
    let cell = re.cells.get(ck)
    if (!cell) re.cells.set(ck, (cell = spec.values.map(() => [])))
    for (let k = 0; k < getters.length; k++) cell[k].push(await getters[k](r, ri + 1))
  }
  const groups = [...colMap.entries()].sort((a, b) => {
    for (let i = 0; i < a[1].length; i++) {
      const c = cmpNullFirst(a[1][i], b[1][i])
      if (c) return c
    }
    return 0
  })

  // the pivoted rows
  const rowPos = rowCols.map((c) => spec.rows.indexOf(c.name.toLowerCase()))
  const valueCols: number[][] = spec.values.map(() => [])
  const newCols: DwColumn[] = [...rowCols]
  groups.forEach((_g, j) => {
    valueDef.forEach((c, k) => {
      valueCols[k].push(newCols.length)
      const { dbname: _d, ...rest } = c
      newCols.push({ ...rest, name: `${c.name}_${j + 1}` })
    })
  })
  const rows: unknown[][] = []
  for (const re of rowMap.values()) {
    const row: unknown[] = rowPos.map((p) => (p >= 0 ? re.vals[p] : null))
    for (const [ck] of groups) {
      const cell = re.cells.get(ck)
      spec.values.forEach((v, k) => {
        const vals = cell ? cell[k].filter((x) => x !== null) : []
        row.push(cell ? (v.fn === 'first' ? (vals.length ? vals[0] : null) : reduceAgg(v.fn, vals)) : null)
      })
    }
    rows.push(row)
  }

  // the definition: replicate the objects of the value zone, move the ones to its right
  const reps = base.objects.filter((o) => o.type === 'column' && valNames.has(o.name.toLowerCase()))
  const objects: DwObject[] = []
  if (!reps.length) objects.push(...base.objects.map((o) => ({ ...o })))
  else {
    const zoneStart = Math.min(...reps.map((o) => num(o, 'x')))
    const zoneEnd = Math.max(...reps.map((o) => num(o, 'x') + num(o, 'width')))
    const stride = zoneEnd - zoneStart
    const shift = (groups.length - 1) * stride
    const inZone = (o: DwObject) => o.band !== 'background' && left(o) >= zoneStart - 1 && left(o) < zoneEnd
    const named = base.objects.filter((o) => inZone(o) && (o.type === 'column' || o.type === 'compute'))
    const escaped = named.map((n) => n.name.toLowerCase().replace(/[$#.]/g, '\\$&'))
    const rewriters = groups.map((_g, j) => ({
      map: new Map(named.map((n) => [n.name.toLowerCase(), `${n.name}_${j + 1}`])),
      re: new RegExp(`\\b(${escaped.join('|')})\\b`, 'gi'),
    }))
    for (const o of base.objects) {
      if (o.band === 'background') objects.push({ ...o })
      else if (inZone(o)) {
        const dyn = o.type === 'text' && typeof o.text === 'string' && o.text.startsWith('@') ? o.text.slice(1).trim().toLowerCase() : null
        groups.forEach(([, cv], j) => {
          const c: DwObject = { ...o, name: `${o.name}_${j + 1}` }
          moveX(c, j * stride)
          if (dyn !== null) {
            const at = spec.columns.indexOf(dyn)
            c.text = at >= 0 && cv[at] !== null ? toStr(cv[at]) : ''
          } else if (named.length) rewriteProps(c, rewriters[j].map, rewriters[j].re)
          objects.push(c)
        })
      } else {
        const c = { ...o }
        if (left(o) >= zoneEnd) moveX(c, shift)
        objects.push(c)
      }
    }
  }
  const def: DwDef = { ...base, table: { ...base.table, columns: newCols }, objects }
  return { def, rows, valueCols }
}
