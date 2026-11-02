// Report printing: paginates a DataWindow (page header on every page, footer at the page bottom, group bands, summary at the end),
// numbers the pages for `page()` / `pagecount()` and sends the result to the browser print dialog / PDF.
import type { NDwBase } from '../runtime/native/dwctrl.ts'
import type { DwModel } from '../dw/model.ts'
import { num } from '../dw/def.ts'
import { DwView } from './dwview.ts'
import { pbColor, toPx } from './pb.ts'

/** paper sizes of the Windows DEVMODE (dmPaperSize) in millimetres */
const PAPER_MM: Record<number, [number, number]> = {
  1: [215.9, 279.4], // Letter
  3: [279.4, 431.8], // Tabloid
  5: [215.9, 355.6], // Legal
  7: [184.2, 266.7], // Executive
  8: [297, 420], // A3
  9: [210, 297], // A4
  11: [148, 210], // A5
  13: [182, 257], // B5
  70: [105, 148], // A6
}
const MM = 96 / 25.4

export interface PageSetup {
  width: number // CSS pixels
  height: number
  left: number
  right: number
  top: number
  bottom: number
}

export function pageSetup(m: DwModel): PageSetup {
  const dw = m.def.datawindow
  const units = num(dw, 'units', 0)
  const code = num(dw, 'print.paper.size', 0)
  let [w, h] = PAPER_MM[code] ?? PAPER_MM[9]
  const landscape = num(dw, 'print.orientation', 0) === 1
  if (landscape) [w, h] = [h, w]
  return {
    width: w * MM,
    height: h * MM,
    left: toPx(num(dw, 'print.margin.left', 110), 'x', units),
    right: toPx(num(dw, 'print.margin.right', 110), 'x', units),
    top: toPx(num(dw, 'print.margin.top', 96), 'y', units),
    bottom: toPx(num(dw, 'print.margin.bottom', 96), 'y', units),
  }
}

interface Flow {
  band: string
  row: number
  cls: string
}

/** build the pages of a report: array of `.page` elements */
export async function buildPages(ctl: NDwBase): Promise<HTMLElement[]> {
  await ctl.ready
  const m = ctl.model
  if (!m) return []
  const view = new DwView(ctl, document.createElement('div'))
  const L = view.layout(m)
  const ps = pageSetup(m)
  const hdrH = view.heightOf(m, 'header')
  const ftrH = view.heightOf(m, 'footer')
  const body = ps.height - ps.top - ps.bottom - hdrH - ftrH
  const levels = m.groupLevels()
  const rows = m.buf.primary

  // 1. the sequence of bands that make up the body
  const flow: Flow[] = []
  const key = (i: number, level: number) => JSON.stringify(levels.filter((g) => g.level <= level).flatMap((g) => g.by).map((c) => String(rows[i]?.v[c])))
  for (let i = 0; i < rows.length; i++) {
    for (const g of levels) if (i === 0 || key(i, g.level) !== key(i - 1, g.level)) flow.push({ band: `header.${g.level}`, row: i + 1, cls: 'ghdr' })
    flow.push({ band: 'detail', row: i + 1, cls: 'row' })
    for (const g of [...levels].reverse()) if (i === rows.length - 1 || key(i, g.level) !== key(i + 1, g.level)) flow.push({ band: `trailer.${g.level}`, row: i + 1, cls: 'gtr' })
  }
  if (view.heightOf(m, 'summary') > 0) flow.push({ band: 'summary', row: Math.max(1, rows.length), cls: 'sum' })

  // 2. cut it into pages
  const pagesFlow: Flow[][] = [[]]
  let used = 0
  for (const f of flow) {
    const h = view.heightOf(m, f.band)
    if (used + h > body && pagesFlow[pagesFlow.length - 1].length) {
      pagesFlow.push([])
      used = 0
    }
    pagesFlow[pagesFlow.length - 1].push(f)
    used += h
  }

  // 3. render every page; page() / pagecount() are known now
  const pages: HTMLElement[] = []
  const total = pagesFlow.length
  for (let p = 0; p < total; p++) {
    m.printPage = p + 1
    m.printPageCount = total
    const page = document.createElement('div')
    page.className = 'page'
    page.style.cssText = `position:relative;width:${ps.width}px;height:${ps.height}px;overflow:hidden;background:${pbColor(m.def.datawindow.color, '#fff')};page-break-after:always;break-after:page`
    const inner = document.createElement('div')
    inner.style.cssText = `position:absolute;left:${ps.left}px;top:${ps.top}px;width:${L.width}px`
    if (hdrH > 0) inner.appendChild(await view.makeBand(m, L, 'header', 1, 'hdr'))
    for (const f of pagesFlow[p]) inner.appendChild(await view.makeBand(m, L, f.band, f.row, f.cls))
    page.appendChild(inner)
    if (ftrH > 0) {
      const ft = await view.makeBand(m, L, 'footer', Math.max(1, rows.length), 'ftr')
      ft.style.cssText += `;position:absolute;left:${ps.left}px;top:${ps.height - ps.bottom - ftrH}px;width:${L.width}px`
      page.appendChild(ft)
    }
    pages.push(page)
  }
  m.printPage = 1
  m.printPageCount = 1
  return pages
}

/** print a plain text job (PrintOpen / PrintSend) in a fixed-width font */
export async function printPlainText(text: string): Promise<boolean> {
  const frame = document.createElement('iframe')
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0'
  document.body.appendChild(frame)
  const doc = frame.contentDocument!
  doc.open()
  doc.write('<!doctype html><html><head><meta charset="utf-8"><style>@page{margin:10mm}pre{font:10pt "Courier New",monospace;margin:0;white-space:pre-wrap}</style></head><body><pre></pre></body></html>')
  doc.close()
  doc.querySelector('pre')!.textContent = text
  await new Promise((r) => setTimeout(r, 50))
  frame.contentWindow!.focus()
  frame.contentWindow!.print()
  setTimeout(() => frame.remove(), 60000)
  return true
}

/** open the browser print dialog (WebView2 / Chromium: also "save as PDF") for the pages of a report */
export async function printDw(ctl: NDwBase): Promise<boolean> {
  const pages = await buildPages(ctl)
  if (!pages.length || !ctl.model) return false
  const ps = pageSetup(ctl.model)
  const frame = document.createElement('iframe')
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0'
  document.body.appendChild(frame)
  const doc = frame.contentDocument!
  const css = [...document.querySelectorAll('style')].map((s) => s.textContent).join('\n')
  doc.open()
  doc.write(`<!doctype html><html><head><meta charset="utf-8"><style>${css}
@page { size: ${ps.width}px ${ps.height}px; margin: 0 }
html, body { height:auto; overflow:visible; background:#fff }
.page { box-shadow:none }
</style></head><body></body></html>`)
  doc.close()
  for (const p of pages) doc.body.appendChild(doc.importNode(p, true))
  await new Promise((r) => setTimeout(r, 50))
  frame.contentWindow!.focus()
  frame.contentWindow!.print()
  setTimeout(() => frame.remove(), 60000)
  return true
}
