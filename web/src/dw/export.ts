// DataWindow SaveAs: the rows of a DataWindow as CSV / tab-delimited text / Excel (xlsx) / HTML / XML.
// 31 scripts export (Excel hand-over of reports, CSV files for the data-transfer windows).  Excel formats are written as xlsx whatever the
// requested generation (the original wrote BIFF); PDF needs the print engine and is delivered by the UI layer.
import { num, splitExpr } from './def.ts'
import type { DwObject } from './def.ts'
import type { DwModel } from './model.ts'
import { Dec, PBDate, PBDateTime, PBTime, toStr } from '../runtime/values.ts'

export interface Exported {
  bytes: Uint8Array
  mime: string
  ext: string
}

interface ExpCol {
  head: string
  value: (row: number) => Promise<unknown>
}

const enc = new TextEncoder()

/** header text of a column: its `<name>_t` label, else the label standing above it, else the column name */
function headingOf(m: DwModel, o: DwObject): string {
  const texts = m.def.objects.filter((t) => t.type === 'text' && /^header/.test(t.band))
  const clean = (s: string) => s.replace(/~r~n|\r?\n/g, ' ').replace(/&/g, '').trim()
  const named = texts.find((t) => t.name.toLowerCase() === o.name.toLowerCase() + '_t')
  if (named?.text) return clean(named.text)
  const above = texts.filter((t) => Math.abs(num(t, 'x') - num(o, 'x')) < 40).sort((a, b) => Math.abs(num(a, 'x') - num(o, 'x')) - Math.abs(num(b, 'x') - num(o, 'x')))[0]
  return above?.text ? clean(above.text) : o.name
}

function exportColumns(m: DwModel): ExpCol[] {
  const objs = m.def.objects
    .filter((o) => o.band === 'detail' && (o.type === 'column' || o.type === 'compute') && splitExpr(o.visible).value !== '0')
    .sort((a, b) => num(a, 'x') - num(b, 'x') || num(a, 'y') - num(b, 'y'))
  if (!objs.length) {
    return m.colNames.map((n, i) => ({ head: n, value: async (row: number) => m.getItem(row, i + 1) }))
  }
  return objs.map((o) => ({ head: headingOf(m, o), value: async (row: number) => (o.type === 'compute' ? m.evalCompute(o, row) : m.getItem(row, o.name)) }))
}

function text(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (v instanceof Dec) return v.toString()
  if (v instanceof PBDate) return toStr(v)
  if (v instanceof PBDateTime || v instanceof PBTime) return toStr(v)
  if (typeof v === 'boolean') return v ? '1' : '0'
  return toStr(v)
}

const xml = (s: string): string => s.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]!).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')

// ---------------------------------------------------------------- zip (stored) for xlsx
const CRC = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()
export function crc32(b: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

export function zipStored(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const parts: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0
  for (const f of files) {
    const name = enc.encode(f.name)
    const crc = crc32(f.data)
    const local = new Uint8Array(30 + name.length)
    const lv = new DataView(local.buffer)
    lv.setUint32(0, 0x04034b50, true)
    lv.setUint16(4, 20, true)
    lv.setUint16(6, 0x0800, true) // UTF-8 names
    lv.setUint16(8, 0, true) // stored
    lv.setUint16(12, 0x0021, true) // 1980-01-01
    lv.setUint32(14, crc, true)
    lv.setUint32(18, f.data.length, true)
    lv.setUint32(22, f.data.length, true)
    lv.setUint16(26, name.length, true)
    local.set(name, 30)
    const cen = new Uint8Array(46 + name.length)
    const cv = new DataView(cen.buffer)
    cv.setUint32(0, 0x02014b50, true)
    cv.setUint16(4, 20, true)
    cv.setUint16(6, 20, true)
    cv.setUint16(8, 0x0800, true)
    cv.setUint16(14, 0x0021, true)
    cv.setUint32(16, crc, true)
    cv.setUint32(20, f.data.length, true)
    cv.setUint32(24, f.data.length, true)
    cv.setUint16(28, name.length, true)
    cv.setUint32(42, offset, true)
    cen.set(name, 46)
    parts.push(local, f.data)
    central.push(cen)
    offset += local.length + f.data.length
  }
  const cdSize = central.reduce((s, c) => s + c.length, 0)
  const end = new Uint8Array(22)
  const ev = new DataView(end.buffer)
  ev.setUint32(0, 0x06054b50, true)
  ev.setUint16(8, files.length, true)
  ev.setUint16(10, files.length, true)
  ev.setUint32(12, cdSize, true)
  ev.setUint32(16, offset, true)
  const all = [...parts, ...central, end]
  const out = new Uint8Array(all.reduce((s, p) => s + p.length, 0))
  let at = 0
  for (const p of all) {
    out.set(p, at)
    at += p.length
  }
  return out
}

const colLetter = (i: number): string => {
  let s = ''
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s
  return s
}

function xlsx(head: string[] | null, rows: unknown[][]): Uint8Array {
  const cell = (v: unknown, r: number, c: number): string => {
    const ref = colLetter(c) + (r + 1)
    if (v === null || v === undefined || v === '') return ''
    if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}"><v>${v}</v></c>`
    if (v instanceof Dec) return `<c r="${ref}"><v>${v.toString()}</v></c>`
    return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xml(text(v))}</t></is></c>`
  }
  const all = head ? [head, ...rows] : rows
  const sheet = all.map((row, r) => `<row r="${r + 1}">${row.map((v, c) => cell(v, r, c)).join('')}</row>`).join('')
  const files = [
    { name: '[Content_Types].xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>' },
    { name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
    { name: 'xl/workbook.xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>' },
    { name: 'xl/_rels/workbook.xml.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>' },
    { name: 'xl/worksheets/sheet1.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheet}</sheetData></worksheet>` },
  ]
  return zipStored(files.map((f) => ({ name: f.name, data: enc.encode(f.data) })))
}

const csvField = (s: string): string => (/[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s)

/** type: the SaveAsType enum value (`csv!`, `excel!` ...) */
export async function exportDw(m: DwModel, type: string, headers: boolean): Promise<Exported | null> {
  const t = type.toLowerCase().replace(/!$/, '')
  const cols = exportColumns(m)
  const head = cols.map((c) => c.head)
  const rows: unknown[][] = []
  for (let r = 1; r <= m.rowCount(); r++) rows.push(await Promise.all(cols.map((c) => c.value(r))))
  switch (t) {
    case 'csv': {
      const lines = rows.map((r) => r.map((v) => csvField(text(v))).join(','))
      if (headers) lines.unshift(head.map(csvField).join(','))
      return { bytes: enc.encode(lines.join('\r\n') + (lines.length ? '\r\n' : '')), mime: 'text/csv', ext: 'csv' }
    }
    case 'text': {
      const lines = rows.map((r) => r.map((v) => text(v).replace(/[\t\r\n]/g, ' ')).join('\t'))
      if (headers) lines.unshift(head.join('\t'))
      return { bytes: enc.encode(lines.join('\r\n') + (lines.length ? '\r\n' : '')), mime: 'text/plain', ext: 'txt' }
    }
    case 'excel':
    case 'excel5':
    case 'excel8':
    case 'xlsx':
    case 'excel12':
      return { bytes: xlsx(headers ? head : null, rows), mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ext: 'xlsx' }
    case 'html':
    case 'htmltable': {
      const tr = (cells: string[], tag: string) => `<tr>${cells.map((c) => `<${tag}>${xml(c)}</${tag}>`).join('')}</tr>`
      const body = [headers ? tr(head, 'th') : '', ...rows.map((r) => tr(r.map(text), 'td'))].join('\n')
      return { bytes: enc.encode(`<html><body><table border="1">\n${body}\n</table></body></html>`), mime: 'text/html', ext: 'html' }
    }
    case 'xml': {
      const tag = (s: string) => s.replace(/[^A-Za-z0-9_]/g, '_').replace(/^(\d)/, '_$1')
      const names = cols.map((c, i) => tag(c.head || `c${i + 1}`))
      const root = tag(m.name || 'datawindow')
      const body = rows.map((r) => `<${root}_row>${r.map((v, i) => `<${names[i]}>${xml(text(v))}</${names[i]}>`).join('')}</${root}_row>`).join('\n')
      return { bytes: enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n<${root}>\n${body}\n</${root}>`), mime: 'application/xml', ext: 'xml' }
    }
    default:
      return null
  }
}
