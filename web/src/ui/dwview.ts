// DOM rendering of a DataWindow control: bands, rows, objects, editing.
import type { NDwBase } from '../runtime/native/dwctrl.ts'
import { argList } from '../dw/def.ts'
import { renderChart } from '../dw/chart.ts'
import { keyEnum, keyFlags, virtualKey } from './keys.ts'
import type { DwModel } from '../dw/model.ts'
import { num, splitExpr } from '../dw/def.ts'
import type { DwObject } from '../dw/def.ts'
import { compileDw, evalDw, newCtx } from '../dw/expr.ts'
import { formatValue } from '../runtime/sysfuncs.ts'
import { Dec, PBDate, PBDateTime, PBTime, toStr } from '../runtime/values.ts'
import { cssFont, draftCpi, fontSize, pbColor, toPx } from './pb.ts'
import { code39Svg, isCode39Font } from './barcode.ts'
import { readFileBytes } from '../runtime/sysfiles.ts'

const BORDER_CSS: Record<string, string> = {
  '0': 'none',
  '1': '1px solid #000;box-shadow:2px 2px 0 #000',
  '2': '1px solid #000',
  '3': '1px solid #404040',
  '4': 'none;border-bottom:1px solid #000',
  '5': '1px solid #abadb3', // lowered: a themed edit box on Windows 10/11 (measured on the login window of the original)
  '6': '1px solid;border-color:#fff #808080 #808080 #fff', // raised
  '7': '1px solid #000',
}

/** runs `f` once on the next animation frame, or soon after when the page is hidden and frames are not delivered */
function nextFrame(f: () => void): void {
  let done = false
  const once = () => {
    if (done) return
    done = true
    f()
  }
  requestAnimationFrame(once)
  setTimeout(once, 60)
}

interface FlowItem {
  band: string
  row: number
  cls: string
}

/**
 * display format of a string column: up to three sections (text; zero-length text; null) separated by `;`, `@` stands for one character of the value,
 * quoted text and other characters are literal (d_login shows `'*****';'*****'` for the password column whatever it holds)
 */
function stringFormat(v: string | null, fmt: string): string {
  const sections: string[] = []
  let cur = ''
  let q = ''
  for (const ch of fmt) {
    if (q) {
      if (ch === q) q = ''
      else cur += ch === '@' ? '' : ch
    } else if (ch === "'" || ch === '"') q = ch
    else if (ch === ';') {
      sections.push(cur)
      cur = ''
    } else cur += ch
  }
  sections.push(cur)
  const pick = v === null ? (sections[2] ?? sections[1] ?? '') : v === '' ? (sections[1] ?? '') : sections[0]
  let i = 0
  return pick.replace(/@|/g, (m) => (m === '@' ? (v ?? '')[i++] ?? '' : '@'))
}

export class DwView {
  ctl: NDwBase
  host: HTMLElement
  root: HTMLElement
  scheduled = false
  rendering = false
  again = false
  editor: HTMLElement | null = null

  constructor(ctl: NDwBase, host: HTMLElement) {
    this.ctl = ctl
    this.host = host
    this.root = document.createElement('div')
    this.root.className = 'dw'
    host.appendChild(this.root)
    this.root.addEventListener('scroll', this.onScroll)
    ctl.listeners.add(() => this.schedule())
    this.schedule()
  }

  schedule(): void {
    if (this.scheduled) return
    this.scheduled = true
    nextFrame(() => {
      this.scheduled = false
      void this.render()
    })
  }

  async render(): Promise<void> {
    if (this.rendering) {
      this.again = true
      return
    }
    this.rendering = true
    try {
      await this.ctl.ready
      const m = this.ctl.model
      if (!m) {
        this.root.textContent = ''
        return
      }
      // the scroll bars are attributes of the control (HScrollBar / VScrollBar), not of the DataWindow object; without them nothing scrolls by mouse
      if (!this.previewOn(m)) {
        this.root.style.overflowX = this.ctl.props.get('hscrollbar') === true ? 'auto' : 'hidden'
        this.root.style.overflowY = this.ctl.props.get('vscrollbar') === true ? 'auto' : 'hidden'
      }
      await this.paint(m)
    } finally {
      this.rendering = false
      if (this.again) {
        this.again = false
        this.schedule()
      }
    }
  }

  private units(m: DwModel): number {
    return num(m.def.datawindow, 'units', 0)
  }

  private bandHeight(m: DwModel, band: string): number {
    const b = m.def.bands as Record<string, unknown>
    const mm = /^(header|trailer)\.(\d+)$/.exec(band)
    if (mm) {
      const g = ((b.group as Record<string, unknown>[]) || []).find((x) => Number(x.level) === Number(mm[2]))
      return g ? Number(g[`${mm[1]}.height`] ?? 0) : 0
    }
    const props = b[band] as Record<string, string> | undefined
    return props ? Number(props.height ?? 0) : 0
  }

  /** objects of the definition by band, scale functions and the natural width of the layout */
  layout(m: DwModel): { sx: (v: number) => number; sy: (v: number) => number; byBand: Map<string, DwObject[]>; width: number } {
    const u = this.units(m)
    const sx = (v: number) => toPx(v, 'x', u)
    const sy = (v: number) => toPx(v, 'y', u)
    const byBand = new Map<string, DwObject[]>()
    for (const o of m.def.objects) {
      const b = o.band
      ;(byBand.get(b) || byBand.set(b, []).get(b)!).push(o)
    }
    const width = Math.max(0, ...m.def.objects.map((o) => num(o, 'x') + num(o, 'width') + (o.type === 'line' ? Math.max(num(o, 'x2'), num(o, 'x1')) - num(o, 'x') : 0)))
    return { sx, sy, byBand, width: sx(width) }
  }

  async makeBand(m: DwModel, L: ReturnType<DwView['layout']>, band: string, row: number, cls: string): Promise<HTMLElement> {
    const h = this.bandHeight(m, band)
    const el = document.createElement('div')
    el.className = 'band ' + cls
    el.style.height = L.sy(h) + 'px'
    el.style.position = 'relative'
    if (h === 0) el.style.overflow = 'hidden' // objects of a band without height are not shown (group trailers a report does not use)
    const bandProps = (m.def.bands as Record<string, Record<string, string>>)[band]
    if (bandProps?.color) el.style.background = pbColor(bandProps.color, 'transparent')
    const ctxBase = newCtx(m, 0, 'header')
    for (const o of L.byBand.get(band) || []) {
      const node = await this.object(m, o, row, band, L.sx, L.sy, ctxBase)
      if (node) el.appendChild(node)
    }
    return el
  }

  /** page header bands in order: `header`, then `header[1]`, `header[2]` ... (crosstabs have several) */
  headerBands(m: DwModel): string[] {
    const num1 = (k: string) => Number(/\d+/.exec(k)![0])
    const extra = Object.keys(m.def.bands).filter((k) => /^header\[\d+\]$/.test(k)).sort((a, b) => num1(a) - num1(b))
    return ['header', ...extra]
  }

  heightOf(m: DwModel, band: string): number {
    return this.layout(m).sy(this.bandHeight(m, band))
  }

  /** the sequence of bands of the body: group headers, detail rows, group trailers */
  private flowOf(m: DwModel): FlowItem[] {
    const levels = m.groupLevels()
    const rows = m.buf.primary
    const flow: FlowItem[] = []
    for (let i = 0; i < rows.length; i++) {
      for (const g of levels) if (this.groupStarts(m, i, levels, g.level)) flow.push({ band: `header.${g.level}`, row: i + 1, cls: 'ghdr' })
      flow.push({ band: 'detail', row: i + 1, cls: 'row' })
      for (const g of [...levels].reverse()) if (this.groupEnds(m, i, levels, g.level)) flow.push({ band: `trailer.${g.level}`, row: i + 1, cls: 'gtr' })
    }
    return flow
  }

  /** one band of the flow as an element; detail rows get their selection state and mouse handlers */
  private async flowBand(m: DwModel, L: ReturnType<DwView['layout']>, f: FlowItem, interactive: boolean): Promise<HTMLElement> {
    const el = await this.makeBand(m, L, f.band, f.row, f.cls)
    if (f.cls !== 'row') return el
    el.dataset.row = String(f.row)
    if (m.row === f.row) el.classList.add('cur')
    if (m.buf.primary[f.row - 1]?.sel) el.classList.add('sel')
    if (interactive) {
      el.addEventListener('mousedown', (ev) => void this.rowClick(m, f.row, ev))
      el.addEventListener('dblclick', () => void this.ctl.rt.fire(this.ctl, 'doubleclicked', [0, 0, f.row, null]))
    }
    return el
  }

  /** more rows than this on screen are rendered window-wise (the original draws only what is visible, too) */
  static readonly VIRTUAL_ROWS = 120

  /** all bands of the report as one element (header, groups, rows, summary); `sticky` keeps header / footer in view on screen */
  async buildBody(m: DwModel, sticky: boolean, interactive: boolean): Promise<HTMLElement> {
    const L = this.layout(m)
    const sy = L.sy
    const byBand = L.byBand
    const root = document.createElement('div')
    root.className = 'dw-inner'
    root.style.background = pbColor(m.def.datawindow.color, '#fff')
    const inner = root
    inner.style.width = L.width + 'px'
    const mk = (band: string, row: number, cls: string): Promise<HTMLElement> => this.makeBand(m, L, band, row, cls)
    const background = pbColor(m.def.datawindow.color, '#fff')
    // the background band holds objects that sit behind everything (charts of graph DataWindows, watermarks, free-standing labels)
    if ((byBand.get('background') || []).length) {
      const bgBand = await mk('background', Math.max(1, m.rowCount()), 'bgl')
      bgBand.style.height = '0'
      bgBand.style.overflow = 'visible'
      inner.appendChild(bgBand)
      let bottom = 0
      for (const o of byBand.get('background')!) bottom = Math.max(bottom, sy(num(o, 'y') + num(o, 'height')))
      inner.style.minHeight = bottom + 'px'
    }
    const heads: HTMLElement[] = []
    for (const hb of this.headerBands(m)) {
      if (this.bandHeight(m, hb) > 0 || (byBand.get(hb) || []).length) heads.push(await mk(hb, 0, 'hdr'))
    }
    if (heads.length) {
      let hdr = heads[0]
      if (heads.length > 1) {
        hdr = document.createElement('div')
        hdr.append(...heads)
      }
      if (sticky) {
        hdr.style.position = 'sticky'
        hdr.style.top = '0'
        hdr.style.zIndex = '2'
        hdr.style.background = hdr.style.background || background
      }
      inner.appendChild(hdr)
    }
    const rows = m.buf.primary
    const flow = this.flowOf(m)
    if (sticky && interactive && rows.length > DwView.VIRTUAL_ROWS) {
      // only the bands around the viewport exist; the body keeps its full height so the scroll bar is right
      const heights = new Map<string, number>()
      const tops: number[] = []
      const hs: number[] = []
      let y = 0
      for (const f of flow) {
        let h = heights.get(f.band)
        if (h === undefined) heights.set(f.band, (h = sy(this.bandHeight(m, f.band))))
        tops.push(y)
        hs.push(h)
        y += h
      }
      const body = document.createElement('div')
      body.className = 'dw-body'
      body.style.cssText = `position:relative;height:${y}px`
      const rowAt = new Map<number, number>()
      flow.forEach((f, i) => f.cls === 'row' && rowAt.set(f.row, i))
      this.virt = { m, L, flow, tops, hs, body, shown: new Map(), rowAt }
      inner.appendChild(body)
    } else {
      this.virt = null
      for (const f of flow) inner.appendChild(await this.flowBand(m, L, f, interactive))
    }
    if (this.bandHeight(m, 'summary') > 0) inner.appendChild(await mk('summary', Math.max(1, rows.length), 'sum'))
    if (this.bandHeight(m, 'footer') > 0) {
      const f = await mk('footer', Math.max(1, rows.length), 'ftr')
      if (sticky) {
        f.style.position = 'sticky'
        f.style.bottom = '0'
        f.style.background = background
      }
      inner.appendChild(f)
    }
    return inner
  }

  private virt: {
    m: DwModel
    L: ReturnType<DwView['layout']>
    flow: FlowItem[]
    tops: number[]
    hs: number[]
    body: HTMLElement
    shown: Map<number, HTMLElement>
    rowAt: Map<number, number>
  } | null = null
  private fillToken = 0
  private lastRow = 0

  /** creates the bands of the visible window of a windowed body and drops the ones that left it */
  private async fillWindow(): Promise<void> {
    const v = this.virt
    if (!v) return
    const tok = ++this.fillToken
    const top = this.root.scrollTop - v.body.offsetTop
    const view = this.root.clientHeight || 600
    const lo = top - 400
    const hi = top + view + 400
    let a = 0
    let b = v.flow.length
    while (a < b) {
      const mid = (a + b) >> 1
      if (v.tops[mid] + v.hs[mid] > lo) b = mid
      else a = mid + 1
    }
    const want = new Set<number>()
    for (let i = a; i < v.flow.length && v.tops[i] < hi; i++) want.add(i)
    for (const [i, el] of v.shown) {
      if (!want.has(i)) {
        el.remove()
        v.shown.delete(i)
      }
    }
    for (const i of want) {
      if (v.shown.has(i)) continue
      const el = await this.flowBand(v.m, v.L, v.flow[i], true)
      if (tok !== this.fillToken || this.virt !== v) return
      el.style.position = 'absolute'
      el.style.top = v.tops[i] + 'px'
      el.style.left = '0'
      el.style.right = '0'
      v.body.appendChild(el)
      v.shown.set(i, el)
    }
  }

  private fillScheduled = false
  private onScroll = (): void => {
    if (!this.virt || this.fillScheduled) return
    this.fillScheduled = true
    nextFrame(() => {
      this.fillScheduled = false
      void this.fillWindow()
    })
  }

  /** scrolls the current row into view (ScrollToRow, SetRow, Tab into the next row ...) */
  private async revealRow(m: DwModel): Promise<void> {
    const row = m.row
    if (row < 1) return
    let top: number
    let h: number
    const v = this.virt
    if (v) {
      const i = v.rowAt.get(row)
      if (i === undefined) return
      top = v.tops[i] + v.body.offsetTop
      h = v.hs[i]
    } else {
      const el = this.root.querySelector(`.row[data-row="${row}"]`) as HTMLElement | null
      if (!el) return
      top = el.offsetTop
      h = el.offsetHeight
    }
    const view = this.root.clientHeight
    if (!view) return
    if (top < this.root.scrollTop) this.root.scrollTop = top
    else if (top + h > this.root.scrollTop + view) this.root.scrollTop = top + h - view
    if (v) await this.fillWindow()
  }

  /** `datawindow.print.preview = yes`: the report is shown page by page as it will print (report windows of the application) */
  private previewOn(m: DwModel): boolean {
    const v = (m.overrides.get('datawindow.print.preview') ?? m.def.datawindow['print.preview'] ?? '').toLowerCase()
    return v === 'yes' || v === 'true' || v === '1'
  }

  private async paintPreview(m: DwModel): Promise<void> {
    const { buildPages } = await import('./print.ts') // print.ts builds its pages with a DwView: loaded on use
    const pages = await buildPages(this.ctl)
    const zoom = Number(m.overrides.get('datawindow.print.preview.zoom') ?? m.def.datawindow['print.preview.zoom'] ?? 100) / 100
    const wrap = document.createElement('div')
    wrap.className = 'dw-preview'
    wrap.style.cssText = 'background:#808080;padding:10px;width:max-content;min-width:100%;box-sizing:border-box'
    for (const p of pages) {
      p.style.margin = '0 auto 10px'
      p.style.boxShadow = '0 0 4px #000'
      p.style.pageBreakAfter = 'auto'
      if (zoom > 0 && zoom !== 1) p.style.setProperty('zoom', String(zoom))
      wrap.appendChild(p)
    }
    this.virt = null
    this.root.replaceChildren(wrap)
  }

  private async paint(m: DwModel): Promise<void> {
    if (this.previewOn(m)) return this.paintPreview(m)
    const inner = await this.buildBody(m, true, true)
    const scroll = this.root.scrollTop
    const left = this.root.scrollLeft
    this.root.replaceChildren(inner)
    this.root.scrollTop = scroll
    this.root.scrollLeft = left
    await this.fillWindow()
    if (m.row !== this.lastRow) {
      this.lastRow = m.row
      await this.revealRow(m)
    }
  }

  private keyOf(m: DwModel, i: number, level: number, levels: { level: number; by: number[] }[]): string {
    const cols = levels.filter((g) => g.level <= level).flatMap((g) => g.by)
    return JSON.stringify(cols.map((c) => toStr(m.buf.primary[i]?.v[c])))
  }
  private groupStarts(m: DwModel, i: number, levels: { level: number; by: number[] }[], level: number): boolean {
    return i === 0 || this.keyOf(m, i, level, levels) !== this.keyOf(m, i - 1, level, levels)
  }
  private groupEnds(m: DwModel, i: number, levels: { level: number; by: number[] }[], level: number): boolean {
    return i === m.rowCount() - 1 || this.keyOf(m, i, level, levels) !== this.keyOf(m, i + 1, level, levels)
  }

  /** columns of a row a user can enter, in tab-sequence order */
  private tabColumns(m: DwModel): string[] {
    return m.def.objects
      .filter((o) => o.type === 'column' && num(o, 'tabsequence', 0) > 0 && o.visible !== '0' && o.protect !== '1')
      .sort((a, b) => num(a, 'tabsequence') - num(b, 'tabsequence'))
      .map((o) => o.name.toLowerCase())
  }

  /** Tab / Enter: next enterable cell of the row, then the first of the next row (the previous one with `dir` = -1) */
  async tabNext(dir: number): Promise<void> {
    const m = this.ctl.model
    if (!m || !m.rowCount()) return
    const cols = this.tabColumns(m)
    if (!cols.length) return
    const cur = m.col > 0 ? m.colNames[m.col - 1] : ''
    let i = cols.indexOf(cur) + dir
    let row = Math.max(1, m.row)
    if (i >= cols.length) {
      i = 0
      row++
    } else if (i < 0) {
      i = cols.length - 1
      row--
    }
    if (row > m.rowCount() || row < 1) return
    if (row !== m.row) {
      m.row = row
      await this.ctl.rt.fire(this.ctl, 'rowfocuschanged', [row])
    }
    m.col = m.colIndex(cols[i]) + 1
    await this.ctl.rt.fire(this.ctl, 'itemfocuschanged', [row, { name: cols[i] }])
    await this.paint(m)
    const cell = this.root.querySelector(`.row[data-row="${row}"] .o[data-obj="${cols[i]}"]`) as HTMLElement | null
    cell?.click()
  }

  private async rowClick(m: DwModel, row: number, ev: MouseEvent): Promise<void> {
    const target = (ev.target as HTMLElement).closest('[data-obj]') as HTMLElement | null
    const obj = target?.dataset.obj
    const changedRow = m.row !== row
    m.row = row
    if (obj) {
      const ci = m.colIndex(obj)
      if (ci >= 0) m.col = ci + 1
    }
    await this.ctl.rt.fire(this.ctl, 'clicked', [ev.offsetX, ev.offsetY, row, obj ? { name: obj } : null])
    if (changedRow) await this.ctl.rt.fire(this.ctl, 'rowfocuschanged', [row])
    this.ctl.changed()
  }

  /** evaluate an expression-carrying property of an object for a row; falls back to the static value */
  private async prop(m: DwModel, o: DwObject, key: string, row: number, band: string): Promise<string> {
    const ov = m.overrides.get(`${o.name.toLowerCase()}.${key}`)
    if (ov !== undefined) return ov
    const raw = o[key]
    if (raw === undefined) return ''
    const { value, expr } = splitExpr(raw)
    if (!expr) return value
    try {
      const v = await evalDw(compileDw(expr), newCtx(m, row, band))
      return v === null ? value : v instanceof Dec ? v.toString() : String(typeof v === 'boolean' ? (v ? 1 : 0) : v)
    } catch {
      return value
    }
  }

  private async object(m: DwModel, o: DwObject, row: number, band: string, sx: (v: number) => number, sy: (v: number) => number, _ctx: unknown): Promise<HTMLElement | null> {
    if ((await this.prop(m, o, 'visible', row, band)) === '0') return null
    const el = document.createElement('div')
    el.className = 'o o-' + o.type
    el.dataset.obj = o.name
    const st = el.style
    st.position = 'absolute'
    if (o.type === 'line') {
      const x1 = num(o, 'x1')
      const y1 = num(o, 'y1')
      const x2 = num(o, 'x2')
      const y2 = num(o, 'y2')
      const w = Math.max(1, Math.abs(sx(x2) - sx(x1)))
      const h = Math.max(1, Math.abs(sy(y2) - sy(y1)))
      st.left = Math.min(sx(x1), sx(x2)) + 'px'
      st.top = Math.min(sy(y1), sy(y2)) + 'px'
      const pen = Math.max(1, Math.round(toPx(num(o, 'pen.width', 1), 'x', this.units(m))))
      const colr = pbColor(o['pen.color'], '#000')
      if (h <= 2) {
        st.width = w + 'px'
        st.borderTop = `${pen}px solid ${colr}`
      } else if (w <= 2) {
        st.height = h + 'px'
        st.borderLeft = `${pen}px solid ${colr}`
      } else {
        el.innerHTML = `<svg width="${w}" height="${h}" style="overflow:visible"><line x1="${sx(x1) - Math.min(sx(x1), sx(x2))}" y1="${sy(y1) - Math.min(sy(y1), sy(y2))}" x2="${sx(x2) - Math.min(sx(x1), sx(x2))}" y2="${sy(y2) - Math.min(sy(y1), sy(y2))}" stroke="${colr}" stroke-width="${pen}"/></svg>`
      }
      return el
    }
    st.left = sx(num(o, 'x')) + 'px'
    st.top = sy(num(o, 'y')) + 'px'
    st.width = sx(num(o, 'width')) + 'px'
    st.height = sy(num(o, 'height')) + 'px'
    st.boxSizing = 'border-box'
    st.overflow = 'hidden'
    const border = o.border ?? '0'
    const bcss = BORDER_CSS[border] ?? 'none'
    if (bcss !== 'none') st.cssText += `;border:${bcss}`
    const bgMode = o['background.mode'] ?? '1'
    const bg = await this.prop(m, o, 'background.color', row, band)
    // background.mode: 1 = transparent, 0 / 2 = opaque with the colour (the edit fields of d_login are mode 2 with white)
    if (bgMode !== '1' && bg) st.background = pbColor(bg, 'transparent')
    if (o.type === 'rectangle' || o.type === 'roundrectangle' || o.type === 'ellipse') {
      st.border = `${Math.max(1, Math.round(toPx(num(o, 'pen.width', 1), 'x', this.units(m))))}px solid ${pbColor(o['pen.color'], '#000')}`
      if (o.type !== 'rectangle') st.borderRadius = o.type === 'ellipse' ? '50%' : '8px'
      st.background = o['brush.hatch'] === '6' ? pbColor(o['brush.color'], 'transparent') : 'transparent'
      return el
    }
    if (o.type === 'bitmap') {
      // the file of the picture can be set at run time (the QR code of an invoice is written to qrcode.bmp before the report prints)
      const file = (await this.prop(m, o, 'filename', row, band)) || o.filename || ''
      const img = document.createElement('img')
      img.src = 'data/assets/' + file.replace(/^.*[\\/]/, '').toLowerCase()
      img.style.width = '100%'
      img.style.height = '100%'
      img.onerror = () => {
        img.onerror = () => img.remove()
        void readFileBytes(file).then((bytes) => {
          if (!bytes) return img.remove()
          const ext = (/\.(\w+)$/.exec(file)?.[1] ?? 'bmp').toLowerCase()
          const mime = ext === 'jpg' ? 'image/jpeg' : ext === 'ico' ? 'image/x-icon' : `image/${ext}`
          img.src = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }))
        })
      }
      el.appendChild(img)
      return el
    }
    if (o.type === 'report' && o.dataobject) {
      try {
        const body = await this.nestedReport(m, o, row, band)
        if (body) {
          el.style.overflow = 'visible'
          el.style.height = 'auto'
          el.appendChild(body)
          return el
        }
      } catch (e) {
        this.ctl.rt.noteMissing('nested:' + (e as Error).message.slice(0, 50))
      }
    }
    if (o.type === 'graph') {
      try {
        el.innerHTML = await renderChart(m, o, Math.round(sx(num(o, 'width'))), Math.round(sy(num(o, 'height'))))
        el.style.overflow = 'hidden'
        return el
      } catch (e) {
        this.ctl.rt.noteMissing('graph:' + (e as Error).message.slice(0, 50))
      }
    }
    if (o.type === 'report' || o.type === 'graph' || o.type === 'ole' || o.type === 'tableblob') {
      el.classList.add('placeholder')
      el.title = `${o.type}: ${o.dataobject || ''}`
      return el
    }
    // text-like objects
    const fh = Number(o['font.height'] ?? -10)
    st.font = cssFont({ face: o['font.face'] || 'Arial', size: fontSize(fh), weight: Number(o['font.weight'] ?? 400), italic: o['font.italic'] === '1', underline: o['font.underline'] === '1', strike: false })
    if (o['font.underline'] === '1') st.textDecoration = 'underline'
    const cpi = draftCpi(o['font.face'] || '')
    if (cpi) st.letterSpacing = `${(96 / cpi - 0.6 * fontSize(fh) * (96 / 72)).toFixed(2)}px` // fixed pitch of the dot-matrix font
    if ((o['font.face'] || '').trim().toLowerCase() === 'arial narrow') st.fontStretch = 'condensed'
    st.color = pbColor(await this.prop(m, o, 'color', row, band), '#000')
    const al = await this.prop(m, o, 'alignment', row, band)
    st.textAlign = al === '1' ? 'right' : al === '2' ? 'center' : al === '3' ? 'justify' : 'left'
    st.whiteSpace = o.type === 'column' || o.type === 'compute' ? 'nowrap' : 'pre'
    st.lineHeight = st.height
    st.padding = '0 2px'
    if (o.type === 'text') {
      // the text of a label may carry an expression after ~t ("static~texpression")
      const t = await this.prop(m, o, 'text', row, band)
      el.textContent = t.replace(/~r~n/g, '\n').replace(/&(.)/g, '$1')
      return el
    }
    if (o.type === 'button') {
      el.className += ' btn'
      el.textContent = o.text ?? ''
      return el
    }
    let v: unknown = null
    if (o.type === 'compute') v = await m.evalCompute(o, row)
    else {
      const r = m.buf.primary[row - 1]
      const ci = m.colIndex(o.name)
      v = r && ci >= 0 && !(band === 'detail' && m.suppressed(row, ci)) ? r.v[ci] : null
    }
    if (isCode39Font(o['font.face']) && v !== null && v !== undefined && toStr(v) !== '') {
      el.innerHTML = code39Svg(toStr(v), sx(num(o, 'width')) - 4, sy(num(o, 'height')) * 0.9)
      el.style.padding = '0 2px'
      return el
    }
    el.textContent = await this.display(m, o, v)
    if (o.type === 'column') {
      const protect = (await this.prop(m, o, 'protect', row, band)) === '1'
      const tab = num(o, 'tabsequence', 0)
      if (!protect && tab > 0) {
        el.classList.add('editable')
        el.addEventListener('click', () => this.edit(m, o, row, el))
      }
    }
    return el
  }

  /** child DataWindow of a drop-down column, retrieved on first use when the definition asks for it */
  private loaded = new Set<string>()
  private async childOf(o: DwObject): Promise<DwModel | null> {
    const ch = (await this.ctl.n_getchild(o.name)) as unknown
    if (typeof ch === 'number' || !ch) return null
    const c = ch as NDwBase
    await c.ready
    const cm = c.model
    if (!cm) return null
    if (cm.rowCount() === 0 && !this.loaded.has(o.name) && o['dddw.autoretrieve'] === 'yes' && argList(cm.def).length === 0) {
      this.loaded.add(o.name)
      await c.n_retrieve()
    }
    return cm
  }

  /** nested report: retrieves the child DataWindow with the arguments given in the report object and renders it in full */
  async nestedReport(m: DwModel, o: DwObject, row: number, band: string): Promise<HTMLElement | null> {
    const rt = this.ctl.rt
    const def = await rt.dwCatalog?.get(o.dataobject)
    if (!def) return null
    const child = new DwModel(rt, o.dataobject, def)
    child.trans = m.trans
    const args: unknown[] = []
    const items = ((o.nest_arguments as unknown as { _items: { _items: string[] }[] } | undefined)?._items) ?? []
    for (const it of items) {
      const src = (it._items[0] || '').trim().replace(/^"|"$/g, '')
      args.push(src ? await evalDw(compileDw(src), newCtx(m, row, band)) : null)
    }
    if (m.trans) await child.retrieve(args)
    const { NDwBase } = await import('../runtime/native/dwctrl.ts')
    const c = new NDwBase(rt, 'datawindow', 'datawindow')
    c.attach(child)
    const view = new DwView(c, document.createElement('div'))
    return view.buildBody(child, false, false)
  }

  private async display(m: DwModel, o: DwObject, v: unknown): Promise<string> {
    if (v === null || v === undefined) return ''
    if (o['dddw.name']) {
      const cm = await this.childOf(o)
      if (cm) {
        const dc = cm.colIndex(o['dddw.datacolumn'] || '')
        const ds = cm.colIndex(o['dddw.displaycolumn'] || '')
        if (dc >= 0 && ds >= 0) {
          const hit = cm.buf.primary.find((r) => toStr(r.v[dc]) === toStr(v))
          if (hit) return toStr(hit.v[ds])
        }
      }
      return toStr(v)
    }
    if (o['checkbox.on'] !== undefined) {
      const on = toStr(v) === o['checkbox.on']
      return (on ? '\u2611' : '\u2610') + (o['checkbox.text'] ? ' ' + o['checkbox.text'] : '')
    }
    const fmt = splitExpr(o.format).value
    const mask = o['editmask.mask']
    const useFmt = fmt && !/^\[general\]$/i.test(fmt) ? fmt : mask && o['editmask.useformat'] !== 'yes' ? mask : ''
    if (typeof v === 'number' || v instanceof Dec || v instanceof PBDate || v instanceof PBTime || v instanceof PBDateTime) return formatValue(v, useFmt || undefined)
    if ((typeof v === 'string' || v === null || v === undefined) && /['"@;]/.test(useFmt)) return stringFormat(v ?? null, useFmt)
    return formatValue(v, useFmt || undefined)
  }

  private edit(m: DwModel, o: DwObject, row: number, cell: HTMLElement): void {
    if (this.editor) this.editor.remove()
    const ci = m.colIndex(o.name)
    if (ci < 0) return
    if (o['checkbox.on'] !== undefined) {
      const cur = toStr(m.buf.primary[row - 1]?.v[ci])
      const next = cur === o['checkbox.on'] ? o['checkbox.off'] : o['checkbox.on']
      void this.ctl.rt.fire(this.ctl, 'itemchanged', [row, { name: o.name }, next]).then((rej) => {
        if (rej !== 1 && rej !== 2) {
          m.setItem(row, ci + 1, next)
          this.ctl.changed()
        }
      })
      return
    }
    if (o['dddw.name']) {
      void this.childOf(o).then((cm) => {
        if (!cm) return
        const dc = cm.colIndex(o['dddw.datacolumn'] || '')
        const ds = cm.colIndex(o['dddw.displaycolumn'] || '')
        const sel = document.createElement('select')
        sel.className = 'dw-edit'
        sel.style.cssText = cell.style.cssText + ';z-index:5;line-height:normal'
        const cur = toStr(m.buf.primary[row - 1]?.v[ci])
        for (const r of cm.buf.primary) {
          const op = document.createElement('option')
          op.value = toStr(r.v[dc])
          op.textContent = toStr(r.v[ds])
          if (op.value === cur) op.selected = true
          sel.appendChild(op)
        }
        cell.parentElement?.appendChild(sel)
        this.editor = sel
        sel.focus()
        const done = () => {
          if (this.editor !== sel) return
          this.editor = null
          const val = sel.value
          sel.remove()
          if (val !== cur) {
            void this.ctl.rt.fire(this.ctl, 'itemchanged', [row, { name: o.name }, val]).then((rej) => {
              if (rej !== 1 && rej !== 2) {
                m.setItem(row, ci + 1, val)
                this.ctl.changed()
              }
            })
          }
        }
        sel.addEventListener('change', done)
        sel.addEventListener('blur', done)
      })
      return
    }
    const input = document.createElement('input')
    input.className = 'dw-edit'
    const v = m.buf.primary[row - 1]?.v[ci]
    input.value = v === null || v === undefined ? '' : toStr(v)
    input.style.cssText = cell.style.cssText + ';z-index:5;border:1px solid #0078d7;background:#fff'
    input.style.lineHeight = 'normal'
    cell.parentElement?.appendChild(input)
    this.editor = input
    input.focus()
    input.select()
    const commit = async () => {
      if (this.editor !== input) return
      this.editor = null
      const text = input.value
      input.remove()
      const cur = v === null || v === undefined ? '' : toStr(v)
      if (text !== cur) {
        const rej = await this.ctl.rt.fire(this.ctl, 'itemchanged', [row, { name: o.name }, text])
        if (rej !== 1 && rej !== 2) {
          m.setItem(row, ci + 1, text)
          this.ctl.changed()
        }
      }
    }
    input.addEventListener('blur', () => void commit())
    input.addEventListener('keydown', (ev) => {
      const k = keyEnum(ev)
      if (ev.key === 'Escape') {
        this.editor = null
        input.remove()
        return
      }
      if (ev.key === 'Tab') {
        ev.preventDefault()
        void commit().then(() => this.tabNext(ev.shiftKey ? -1 : 1))
        return
      }
      if (ev.key === 'Enter') {
        ev.preventDefault()
        // ProcessEnter: a script on the control decides (usually it presses Tab); without one Enter moves on like Tab
        const has = this.ctl.findRoutines('ue_enterkey').length > 0
        void commit().then(async () => {
          if (has) await this.ctl.rt.fire(this.ctl, 'ue_enterkey', [])
          else await this.tabNext(1)
        })
        return
      }
      if (k) void this.ctl.rt.fire(this.ctl, 'ue_dwnkey', [k, keyFlags(ev)])
    })
  }
}
