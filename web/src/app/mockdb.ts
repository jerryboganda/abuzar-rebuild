// Stand-in database for developing the UI without a server: returns plausible rows for any DataWindow.
import type { Db, QueryResult, CallResult } from '../runtime/wire.ts'
import { colKind } from '../dw/def.ts'
import type { DwDef } from '../dw/def.ts'
import type { DwCatalog } from '../dw/def.ts'

const WORDS = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Golf', 'Hotel', 'India', 'Juliet', 'Kilo', 'Lima']

export class MockDb implements Db {
  catalog: DwCatalog
  rowsPerQuery: number
  constructor(catalog: DwCatalog, rowsPerQuery = 6) {
    this.catalog = catalog
    this.rowsPerQuery = rowsPerQuery
  }
  async query(sql: string): Promise<QueryResult> {
    const name = sql.startsWith('mock:') ? sql.slice(5) : ''
    const def = name ? ((await this.catalog.get(name)) as DwDef | undefined) : undefined
    if (!def) return { columns: [], rows: [] }
    // a crosstab retrieves its source rows: the columns named in the specification, three crosstab columns over a few rows each
    const xt = def.crosstab
    const byName = new Map(def.table.columns.map((c) => [c.name.toLowerCase(), c.type]))
    const cols = xt ? (xt.sourcenames || '').split(',').map((n) => ({ name: n.trim(), type: byName.get(n.trim().toLowerCase()) ?? 'char(20)' })) : def.table.columns
    const pivotCols = new Set((xt?.columns || '').split(',').map((n) => n.trim().toLowerCase()))
    const rows: unknown[][] = []
    const count = xt ? Math.max(this.rowsPerQuery, 12) : this.rowsPerQuery
    for (let r = 0; r < count; r++) {
      rows.push(
        cols.map((c, i) => {
          if (xt && colKind(c.type) === 'string') return pivotCols.has(c.name.toLowerCase()) ? `${WORDS[r % 3]}` : `${c.name.slice(0, 6)}-${Math.floor(r / 3) + 1}`
          switch (colKind(c.type)) {
            case 'string':
              return /name|desc|title|text/i.test(c.name) ? `${WORDS[(r + i) % WORDS.length]} ${c.name}` : /^char\(1\)$/.test(c.type) ? 'Y' : `${c.name.slice(0, 6)}-${r + 1}`
            case 'decimal':
              return ((r + 1) * 125.5 + i).toFixed(2)
            case 'number':
              return r + 1 + (i === 0 ? 0 : i * 10)
            case 'datetime':
              return `2026-0${(r % 9) + 1}-1${r % 9} 10:3${r % 6}:00.000`
            case 'date':
              return `2026-0${(r % 9) + 1}-1${r % 9}`
            default:
              return null
          }
        }),
      )
    }
    return {
      columns: cols.map((c) => ({ name: c.name, type: { string: 'text', decimal: 'numeric', number: 'int4', datetime: 'timestamp', date: 'date', time: 'time', blob: 'bytea' }[colKind(c.type)] })),
      rows,
    }
  }
  async call(sql: string): Promise<CallResult> {
    const rs = await this.query(sql)
    return { columns: [], row: null, resultsets: rs.columns.length ? [{ column: 'rs1', columns: rs.columns, rows: rs.rows }] : [] }
  }
  async exec(): Promise<{ rowcount: number }> {
    return { rowcount: 1 }
  }
  async commit(): Promise<void> {}
  async rollback(): Promise<void> {}
  async close(): Promise<void> {}
}
