// DataWindow definitions as recovered from the compiled application (see tools/build_dw_bundle.py).
// All property values are strings, exactly as PowerBuilder stores them.

export type Props = Record<string, string>

export interface DwObject extends Props {
  type: string // text | column | compute | line | rectangle | roundrectangle | ellipse | bitmap | report | graph | groupbox | button | ole | tableblob
  name: string
  band: string // header | detail | summary | footer | header.1 | trailer.1 ...
}

export interface DwColumn {
  type: string // char(30) | long | decimal(2) | datetime | date | number | ulong | blob
  name: string
  dbname?: string
  key?: string
  update?: string
  updatewhereclause?: string
  initial?: string
  [k: string]: string | undefined
}

export interface DwGroup {
  level: string
  by: { _items: string[] }
  [k: string]: unknown
}

export interface DwDef {
  release?: string
  datawindow: Props
  bands: Record<string, Props | DwGroup[]> & { group?: DwGroup[] }
  table: {
    columns: DwColumn[]
    retrieve?: string
    update?: string
    updatewhere?: string
    updatekeyinplace?: string
    arguments?: { _items: { _items: string[] }[] }
    sort?: string
    filter?: string
    [k: string]: unknown
  }
  objects: DwObject[]
  /** crosstab specification (columns / rows / values / sourcenames), processing = 4 */
  crosstab?: Props
  /** columns that suppress repeating values (lower-case names are matched) */
  sparse?: string[]
}

/** processing style (datawindow.processing) */
export const PROCESSING = ['freeform', 'grid', 'label', 'graph', 'crosstab', 'composite', 'ole', 'richtext'] as const
export type ProcessingName = (typeof PROCESSING)[number]

export function processingOf(def: DwDef): ProcessingName {
  // 0 = default/tabular/freeform (decided by the objects: tabular has header-band text), 1 = grid
  const p = Number(def.datawindow.processing ?? '0')
  return PROCESSING[p === 0 ? 0 : p] ?? 'freeform'
}

export function argList(def: DwDef): { name: string; type: string }[] {
  const items = def.table.arguments?._items || []
  return items.map((i) => ({ name: i._items[0].toLowerCase(), type: i._items[1] }))
}

/** column type -> storage kind used by the model */
export function colKind(type: string): 'string' | 'number' | 'decimal' | 'datetime' | 'date' | 'time' | 'blob' {
  const t = type.toLowerCase()
  if (t.startsWith('char') || t.startsWith('varchar') || t.startsWith('string')) return 'string'
  if (t.startsWith('decimal')) return 'decimal'
  if (t === 'datetime' || t === 'timestamp') return 'datetime'
  if (t === 'date') return 'date'
  if (t === 'time') return 'time'
  if (t === 'blob') return 'blob'
  return 'number' // long, ulong, number, int, real, double
}

export const num = (o: Props | undefined, k: string, d = 0): number => {
  const v = o?.[k]
  if (v === undefined || v === '') return d
  const n = Number(v)
  return Number.isNaN(n) ? d : n
}

/**
 * A DataWindow `format` property may be a pure expression (`"<TAB>f_SetColumnFormat('Qty')"`)
 * or a static prefix plus an expression (`"[currency]<TAB>f_SetColumnFormat('Qty')"`).
 * Unlike other properties, a tab here is always the separator; the head is not a
 * computed-field whitespace fragment.
 */
export function splitFormatExpr(v: string | undefined): { value: string; expr?: string } {
  if (v === undefined) return { value: '' }
  const i = v.search(/\t|~t/)
  if (i < 0) return { value: v }
  return { value: v.slice(0, i).trim(), expr: v.slice(v[i] === '\t' ? i + 1 : i + 2) }
}

/** property value that may carry an expression: "0<TAB>if(...)" (the compiled form of `0~tif(...)`) -> { value: '0', expr: 'if(...)' } */
export function splitExpr(v: string | undefined): { value: string; expr?: string } {
  if (v === undefined) return { value: '' }
  const i = v.search(/	|~t/)
  if (i <= 0) return { value: v }
  // Only a simple literal before the tab is the value half.  Computed fields
  // routinely contain tabs as formatting whitespace, and losing everything
  // before the first one truncates the expression.
  const head = v.slice(0, i).trim()
  if (!/^(?:-?\d+(?:\.\d+)?|yes|no|true|false|#[0-9a-f]{1,8}|rgb\s*\([^)]*\))$/i.test(head)) return { value: v }
  return { value: head, expr: v.slice(v[i] === '	' ? i + 1 : i + 2) }
}

/** Restore an identity the exporter lost: a RichText input field takes its single table column's name. */
export function recoverObjectNames(def: DwDef): DwDef {
  if (Number(def.datawindow.processing ?? 0) !== 7 || def.table.columns.length !== 1) return def
  const name = def.table.columns[0].name
  for (const object of def.objects) if (object.type === 'column' && !object.name) object.name = name
  return def
}

export class DwCatalog {
  private bundles = new Map<string, Record<string, DwDef>>()
  private index: Record<string, string> | null = null
  /** reads `<name>` relative to the data directory: returns the (already gunzipped) text, or undefined */
  read: (path: string) => Promise<string | undefined>
  constructor(read: (path: string) => Promise<string | undefined>) {
    this.read = read
  }
  async get(name: string): Promise<DwDef | undefined> {
    const key = name.toLowerCase()
    if (!this.index) {
      const t = await this.read('dw/_index.json')
      this.index = t ? (JSON.parse(t) as Record<string, string>) : {}
    }
    const lib = this.index[key]
    if (!lib) return undefined
    let b = this.bundles.get(lib)
    if (!b) {
      const t = await this.read(`dw/${lib}.json`)
      b = t ? (JSON.parse(t) as Record<string, DwDef>) : {}
      for (const definition of Object.values(b)) recoverObjectNames(definition)
      this.bundles.set(lib, b)
    }
    return b[key]
  }
}
