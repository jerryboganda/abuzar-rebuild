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
  if (num(m.def.datawindow, 'processing', 0) === 5) {
    // composite: every nested report is printed on its own pages, in the order of the report objects
    const out: HTMLElement[] = []
    const parts = m.def.objects.filter((o) => o.type === 'report' && o.dataobject).sort((a, b) => num(a, 'y') - num(b, 'y'))
    const { NDwBase } = await import('../runtime/native/dwctrl.ts')
    const { DwModel } = await import('../dw/model.ts')
    const { argList } = await import('../dw/def.ts')
    const { compileDw, evalDw, newCtx } = await import('../dw/expr.ts')
    for (const o of parts) {
      const def = await ctl.rt.dwCatalog?.get(o.dataobject)
      if (!def) continue
      const child = new DwModel(ctl.rt, o.dataobject, def)
      child.trans = m.trans
      const items = ((o.nest_arguments as unknown as { _items: { _items: string[] }[] } | undefined)?._items) ?? []
      const args: unknown[] = []
      for (const it of items) args.push(await evalDw(compileDw((it._items[0] || '').trim()), newCtx(m, 1, 'detail')))
      void argList
      if (m.trans) await child.retrieve(args)
      const c = new NDwBase(ctl.rt, 'datawindow', 'datawindow')
      c.attach(child)
      out.push(...(await buildPages(c)))
    }
    return out
  }
  const L = view.layout(m)
  const ps = pageSetup(m)
  if (num(m.def.datawindow, 'processing', 0) === 2) return buildLabelPages(m, view, L, ps)
  const hdrBands = view.headerBands(m)
  const hdrH = hdrBands.reduce((s, b) => s + view.heightOf(m, b), 0)
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

  // 3. render every page; page() / pagecount() are known now.  A report wider than the paper is cut into strips of the printable
  // width and printed strip after strip (pageacross() / pagecountacross()); a few percent over the width stay on one page.
  const pages: HTMLElement[] = []
  const total = pagesFlow.length
  const usable = ps.width - ps.left - ps.right
  const across = L.width > usable * 1.05 ? Math.ceil(L.width / usable - 0.05) : 1
  m.printAcrossCount = across
  for (let s = 0; s < across; s++) {
    for (let p = 0; p < total; p++) {
      m.printPage = p + 1
      m.printPageCount = total
      m.printAcross = s + 1
      const page = document.createElement('div')
      page.className = 'page'
      page.style.cssText = `position:relative;width:${ps.width}px;height:${ps.height}px;overflow:hidden;background:${pbColor(m.def.datawindow.color, '#fff')};page-break-after:always;break-after:page`
      const inner = document.createElement('div')
      inner.style.cssText = `position:absolute;left:${ps.left}px;top:${ps.top}px;width:${L.width}px`
      if (L.byBand.has('background')) {
        const bgb = await view.makeBand(m, L, 'background', 1, 'bgl')
        bgb.style.height = '0'
        bgb.style.overflow = 'visible'
        inner.appendChild(bgb)
      }
      for (const hb of hdrBands) if (view.heightOf(m, hb) > 0) inner.appendChild(await view.makeBand(m, L, hb, 1, 'hdr'))
      for (const f of pagesFlow[p]) inner.appendChild(await view.makeBand(m, L, f.band, f.row, f.cls))
      let ft: HTMLElement | null = null
      if (ftrH > 0) {
        ft = await view.makeBand(m, L, 'footer', Math.max(1, rows.length), 'ftr')
        ft.style.cssText += `;position:absolute;left:${ps.left}px;top:${ps.height - ps.bottom - ftrH}px;width:${L.width}px`
      }
      if (across > 1) {
        // the strip: the printable window of the page onto the full-width report
        const clip = (top: number, height: number, child: HTMLElement) => {
          const c = document.createElement('div')
          c.style.cssText = `position:absolute;left:${ps.left}px;top:${top}px;width:${usable}px;height:${height}px;overflow:hidden`
          child.style.left = `${-s * usable}px`
          child.style.top = '0'
          c.appendChild(child)
          page.appendChild(c)
        }
        clip(ps.top, ps.height - ps.top - ps.bottom, inner)
        if (ft) clip(ps.height - ps.bottom - ftrH, ftrH, ft)
      } else {
        page.appendChild(inner)
        if (ft) page.appendChild(ft)
      }
      pages.push(page)
    }
  }
  m.printAcross = 1
  m.printAcrossCount = 1
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

/** label DataWindows (processing = 2): the detail band is one label; labels fill a sheet of `label.columns` x `label.rows` */
async function buildLabelPages(m: DwModel, view: DwView, L: ReturnType<DwView['layout']>, ps: PageSetup): Promise<HTMLElement[]> {
  const dw = m.def.datawindow
  const units = num(dw, 'units', 0)
  const lw = toPx(num(dw, 'label.width', 2000), 'x', units)
  const lh = toPx(num(dw, 'label.height', 1000), 'y', units)
  const cols = Math.max(1, num(dw, 'label.columns', 1))
  const rows = Math.max(1, num(dw, 'label.rows', 1))
  const gapX = toPx(num(dw, 'label.columns.spacing', 0), 'x', units)
  const gapY = toPx(num(dw, 'label.rows.spacing', 0), 'y', units)
  const topDown = dw['label.topdown'] === 'yes'
  const perSheet = cols * rows
  const count = m.rowCount()
  const pages: HTMLElement[] = []
  const total = Math.max(1, Math.ceil(count / perSheet))
  for (let p = 0; p < total; p++) {
    m.printPage = p + 1
    m.printPageCount = total
    const page = document.createElement('div')
    page.className = 'page'
    page.style.cssText = `position:relative;width:${ps.width}px;height:${ps.height}px;overflow:hidden;background:${pbColor(dw.color, '#fff')};page-break-after:always;break-after:page`
    for (let k = 0; k < perSheet; k++) {
      const row = p * perSheet + k + 1
      if (row > count) break
      const col = topDown ? Math.floor(k / rows) : k % cols
      const line = topDown ? k % rows : Math.floor(k / cols)
      const cell = document.createElement('div')
      cell.style.cssText = `position:absolute;left:${ps.left + col * (lw + gapX)}px;top:${ps.top + line * (lh + gapY)}px;width:${lw}px;height:${lh}px;overflow:hidden`
      const band = await view.makeBand(m, L, 'detail', row, 'row')
      band.style.height = `${lh}px`
      cell.appendChild(band)
      page.appendChild(cell)
    }
    pages.push(page)
  }
  m.printPage = 1
  m.printPageCount = 1
  return pages
}
