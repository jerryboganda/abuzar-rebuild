// DOM rendering of a DataWindow control: bands, rows, objects, editing.
import { NDwBase } from '../runtime/native/dwctrl.ts'
import { argList, colKind } from '../dw/def.ts'

import { renderChart } from '../dw/chart.ts'
import { keyEnum, keyFlags, virtualKey } from './keys.ts'
import { DwModel } from '../dw/model.ts'
import { num, splitExpr, splitFormatExpr } from '../dw/def.ts'
import type { DwObject } from '../dw/def.ts'
import { compileDw, evalDw, newCtx } from '../dw/expr.ts'
import { formatValue } from '../runtime/sysfuncs.ts'
import { Dec, PBDate, PBDateTime, PBTime, compareLabels, toStr } from '../runtime/values.ts'
import { cssFont, draftCpi, fontSize, pbColor, toPx, setMnemonic } from './pb.ts'
import { code39Svg, isCode39Font } from './barcode.ts'
import { readFileBytes } from '../runtime/sysfiles.ts'
import { commitDwValue, dwEditAutoSelect, dwEditText, dwMultiline, dwMultilineDomText, dwMultilineText, dwTextLimit } from '../dw/edit.ts'
import type { DwEditResult } from '../dw/edit.ts'
import { choiceProperty, choiceSignature, choiceStyle, codeTable, sameChoiceValue } from '../dw/choices.ts'
import type { DwChoiceBinding, DwChoices } from '../dw/choices.ts'
import { DwChoiceEditor } from './dw-choice-editor.ts'
import { lookupSurfaceIssues } from './data-surfaces.ts'
import type { DataSurface } from './data-surfaces.ts'

interface DwEditorSnapshot {
  row: number
  obj: string
  value: string
  start: number | null
  end: number | null
  direction?: 'forward' | 'backward' | 'none'
  scrollTop?: number
  scrollLeft?: number
  choice?: DwChoiceEditor
  focused?: boolean
  invalid?: boolean
}

/** space between two columns of a grid, in DataWindow units (the engine of the original leaves 7 to 12, 9.5 on average) */
const GRID_GAP = 9

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
function nextFrame(f: () => void): () => void {
  let done = false
  const once = () => {
    if (done) return
    done = true
    cancelAnimationFrame(frame)
    clearTimeout(timer)
    f()
  }
  const frame = requestAnimationFrame(once)
  const timer = setTimeout(once, 60)
  return () => { done = true; cancelAnimationFrame(frame); clearTimeout(timer) }
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

let measureCtx: CanvasRenderingContext2D | null = null
/** width in px of a text in a CSS font */
function measure(font: string, text: string): number {
  measureCtx ??= document.createElement('canvas').getContext('2d')
  if (!measureCtx) return 0
  measureCtx.font = font
  return Math.max(...text.split('\n').map((l) => measureCtx!.measureText(l).width))
}

export class DwView {
  ctl: NDwBase
  host: HTMLElement
  root: HTMLElement
  scheduled = false
  rendering = false
  again = false
  editor: HTMLElement | null = null
  editRow = 0
  editCol = 0
  editObj = ''
  protected acceptEdit: ((navigation?: boolean) => Promise<boolean>) | null = null
  private textEditor: HTMLInputElement | HTMLTextAreaElement | null = null
  private readTextEditor: (() => string) | null = null
  private checkTextEditor: (() => Promise<boolean>) | null = null
  private recoveredDraft = false
  protected composingText: HTMLInputElement | HTMLTextAreaElement | null = null
  private syncFocusedText: (() => void) | null = null
  private releaseTextEditor: (() => void) | null = null
  private pendingEdits = new Set<Promise<boolean>>()
  private inputEvents: Promise<boolean> = Promise.resolve(true)
  private inputEventCount = 0
  private inputFailed = false
  private inputVersion = 0
  private acceptingModel: DwModel | null = null
  private releaseAcceptance: (() => void) | null = null
  private disposed = false
  protected choiceEdit: DwChoiceEditor | null = null
  protected choiceDestination: { model: DwModel; row: number; object: string | undefined; activate: boolean } | null = null
  private onChange = () => { this.bindAcceptance(this.ctl.model); this.schedule() }
  private cancelRender: (() => void) | null = null
  private cancelFill: (() => void) | null = null

  constructor(ctl: NDwBase, host: HTMLElement, observe = true) {
    this.ctl = ctl
    this.host = host
    this.root = document.createElement('div')
    this.root.className = 'dw'
    host.appendChild(this.root)
    this.root.addEventListener('scroll', this.onScroll)
    if (observe) {
      this.bindAcceptance(ctl.model)
      ctl.listeners.add(this.onChange)
      this.schedule()
    }
  }

  dispose(): void {
    this.disposed = true
    this.cancelChoice()
    this.discardInputEvents()
    this.detachTextEditor()
    this.releaseAcceptance?.()
    this.acceptEdit = null
    this.editor = null
    this.ctl.listeners.delete(this.onChange)
    this.cancelRender?.()
    this.cancelFill?.()
    this.fillToken++
    this.root.removeEventListener('scroll', this.onScroll)
    this.root.remove()
  }

  async acceptPendingEdit(): Promise<boolean> {
    if (this.disposed) return false
    while (this.pendingEdits.size) {
      if ((await Promise.all(this.pendingEdits)).some((accepted) => !accepted)) return false
    }
    if (this.disposed || this.inputFailed) return false
    const model = this.ctl.model
    return model ? await model.acceptText() !== -1 : true
  }

  protected acceptanceBusy(message = 'The current entry is still being processed. Wait for it to finish before continuing.'): void {
    console.warn(message)
  }

  protected discardInputEvents(): void {
    this.inputVersion++
    this.inputFailed = false
  }

  protected async acceptModelEdit(model: DwModel): Promise<boolean> {
    if (this.disposed || this.ctl.model !== model) return false
    if (this.inputFailed) {
      this.acceptanceBusy('The input event failed. Edit the field again or press Escape to cancel before continuing.')
      return false
    }
    if (this.pendingEdits.size) {
      this.acceptanceBusy()
      return false
    }
    return this.acceptEdit ? this.acceptEdit() : true
  }

  private bindAcceptance(model: DwModel | null): void {
    if (this.acceptingModel === model) return
    this.releaseAcceptance?.()
    this.releaseAcceptance = null
    this.acceptingModel = model
    if (!model) return
    const previous = model.acceptText
    const accept = async () => {
      if (!(await this.acceptModelEdit(model)) || this.disposed || this.ctl.model !== model) return -1
      return previous()
    }
    model.acceptText = accept
    this.releaseAcceptance = () => { if (model.acceptText === accept) model.acceptText = previous }
  }

  private async trackEdit(work: Promise<boolean>): Promise<boolean> {
    const pending = work.catch((error) => {
      this.ctl.rt.onError(error)
      return false
    })
    this.pendingEdits.add(pending)
    try {
      return await pending
    } finally {
      this.pendingEdits.delete(pending)
    }
  }

  private async commitEditValue(model: DwModel, row: number, column: number, object: DwObject, value: unknown, guard?: () => Promise<void>): Promise<DwEditResult> {
    const work = this.commitValue(model, row, column, object, value, guard).catch((error): DwEditResult => {
      this.ctl.rt.onError(error)
      return 'rejected'
    })
    await this.trackEdit(work.then((result) => result !== 'rejected'))
    return work
  }

  private inputChanged(model: DwModel, row: number, object: DwObject, text: string): void {
    const record = model.rowAt(row)
    const version = this.inputVersion
    this.inputEventCount++
    this.inputEvents = this.trackEdit(this.inputEvents.then(async () => {
      if (this.disposed || this.ctl.destroyed || version !== this.inputVersion) return true
      try {
        if (this.ctl.model !== model || model.rowAt(row) !== record || model.row !== row ||
          model.colNames[model.col - 1] !== object.name.toLowerCase()) {
          throw new Error('The record changed before its input event could run. The entry was not applied.')
        }
        await this.ctl.rt.fire(this.ctl, 'editchanged', [row, { name: object.name }, text])
        await this.ctl.rt.flushPosted()
        if (version === this.inputVersion) this.inputFailed = false
        return true
      } catch (error) {
        if (version === this.inputVersion) this.inputFailed = true
        throw error
      }
    })).finally(() => { this.inputEventCount-- })
  }

  schedule(): void {
    if (this.disposed || this.scheduled) return
    this.scheduled = true
    this.cancelRender = nextFrame(() => {
      this.scheduled = false
      void this.render()
    })
  }

  async render(): Promise<void> {
    if (this.disposed || this.recoveredDraft || this.composingText && this.editor === this.composingText) return
    if (this.rendering) {
      this.again = true
      return
    }
    this.rendering = true
    try {
      await this.ctl.ready
      if (this.disposed) return
      if (await this.retainInvalidText()) return
      const m = this.ctl.model
      if (!m) {
        this.root.textContent = ''
        return
      }
      // the scroll bars are attributes of the control (HScrollBar / VScrollBar), not of the DataWindow object; without them nothing scrolls by mouse
      this.root.style.background = pbColor(m.def.datawindow.color, '#fff')
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
    this.hiddenCols = this.gridHidden(m)
    return { sx, sy, byBand, width: sx(width - this.hiddenCols.reduce((a, h) => a + h.w, 0) + this.movedCols.reduce((a, c) => a + c.w + GRID_GAP, 0)) }
  }

  /** columns of a grid DataWindow (processing 1) that are not visible: the grid leaves them out with their headers and the columns on their right move left */
  private hiddenCols: { x: number; w: number }[] = []
  /** columns a script switched on that the grid placed behind the visible ones: their old place, width and the new left edge */
  private movedCols: { name: string; x: number; w: number; newX: number }[] = []
  private gridHidden(m: DwModel): { x: number; w: number }[] {
    this.movedCols = []
    if (num(m.def.datawindow, 'processing', 0) !== 1) return []
    const cols = m.def.objects.filter((o) => (o.type === 'column' || o.type === 'compute') && o.band === 'detail' && o.name)
    // the grid of the original keeps the columns that are visible from the start where they are; a column that is switched on later (Modify `Visible=1`, the interface
    // setting of the entry windows does it in the order of its sequence) is appended behind the last visible one - measured with the DataWindow engine of the original
    const order = cols.filter((o) => o.visible !== '0').sort((a, b) => num(a, 'x') - num(b, 'x')).map((o) => o.name.toLowerCase())
    const stay = new Set(order)
    for (const e of m.visLog) {
      const i = order.indexOf(e.name)
      if (e.on && i < 0 && cols.some((o) => o.name.toLowerCase() === e.name)) order.push(e.name)
      else if (!e.on && i >= 0) {
        order.splice(i, 1)
        stay.delete(e.name)
      }
    }
    // an override set without a logged call (the model was filled another way) decides, too
    for (const o of cols) {
      const n = o.name.toLowerCase()
      const ov = m.overrides.get(`${n}.visible`)
      if (ov === undefined) continue
      const i = order.indexOf(n)
      if (ov === '0' && i >= 0) {
        order.splice(i, 1)
        stay.delete(n)
      } else if (ov !== '0' && i < 0) order.push(n)
    }
    const byName = new Map(cols.map((o) => [o.name.toLowerCase(), o]))
    const out: { x: number; w: number }[] = []
    for (const o of cols) {
      const n = o.name.toLowerCase()
      if (!stay.has(n) || !order.includes(n)) out.push({ x: num(o, 'x'), w: num(o, 'width') })
    }
    let right = 0
    for (const n of order) {
      const o = byName.get(n)!
      if (!stay.has(n)) continue
      const shift = out.filter((h) => num(o, 'x') >= h.x + h.w - 1).reduce((a, h) => a + h.w, 0)
      right = Math.max(right, num(o, 'x') - shift + num(o, 'width'))
    }
    for (const n of order) {
      if (stay.has(n)) continue
      const o = byName.get(n)!
      const newX = right + GRID_GAP
      this.movedCols.push({ name: n, x: num(o, 'x'), w: num(o, 'width'), newX })
      right = newX + num(o, 'width')
    }
    return out
  }
  /**
   * PowerBuilder's grid hides a column's header with the column.  Compute
   * columns often have a generic header name (c_rsum -> t_4), so the header is
   * identified by its exact position, not by its name.
   */
  private headerOfHiddenColumn(o: DwObject): boolean {
    if (this.movedOf(o)) return false
    if (!this.hiddenCols.length || (o.type !== 'text' && o.type !== 'compute')) return false
    const band = String(o.band ?? '')
    // headers, footer totals and group trailers travel with the detail column
    if (!band.startsWith('header') && band !== 'footer' && !band.startsWith('trailer')) return false
    const x = num(o, 'x')
    const w = num(o, 'width')
    return this.hiddenCols.some((h) => Math.abs(h.x - x) <= 2 && Math.abs(h.w - w) <= 10)
  }
  /** horizontal shift of an object of a grid with hidden columns; null when the object belonged to a hidden column (its header, its total) */
  /** the moved column an object belongs to: the column itself, or its header / total / trailer (found by position) */
  private movedOf(o: DwObject): { x: number; newX: number } | null {
    if (!this.movedCols.length || o.type === 'line') return null
    const own = o.name ? this.movedCols.find((c) => c.name === o.name.toLowerCase() && o.band === 'detail') : undefined
    if (own) return own
    if (o.type !== 'text' && o.type !== 'compute') return null
    const band = String(o.band ?? '')
    if (!band.startsWith('header') && band !== 'footer' && !band.startsWith('trailer')) return null
    const x = num(o, 'x')
    const w = num(o, 'width')
    return this.movedCols.find((c) => Math.abs(c.x - x) <= 2 && Math.abs(c.w - w) <= 10) ?? null
  }
  private gridShift(o: DwObject): number | null {
    const mv = this.movedOf(o)
    if (mv) return num(o, 'x') - (mv.newX + (num(o, 'x') - mv.x))
    if (!this.hiddenCols.length || o.type === 'line') return 0
    const x = num(o, 'x')
    const w = num(o, 'width')
    let shift = 0
    for (const h of this.hiddenCols) {
      if (x >= h.x + h.w - 1) shift += h.w
      else if (o.type !== 'column' && w <= h.w * 1.6 + 20 && x + w / 2 >= h.x && x + w / 2 < h.x + h.w) return null // the header / total of a hidden column (its centre lies over the column)
    }
    return shift
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
      el.addEventListener('dblclick', () => void this.ctl.rt.fire(this.ctl, 'doubleclicked', [0, 0, f.row, { name: '' }]))
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
    // PowerBuilder does not print the summary band when the DataWindow has no
    // detail rows (verified against the original previews: 010 prints header
    // and column titles but no “Net Total” line, while the rebuild printed
    // “Net Total 0.00”).  The page footer still prints.
    if (rows.length > 0 && this.bandHeight(m, 'summary') > 0) inner.appendChild(await mk('summary', Math.max(1, rows.length), 'sum'))
    if (this.bandHeight(m, 'footer') > 0) {
      const f = await mk('footer', Math.max(1, rows.length), 'ftr')
      if (sticky) {
        f.style.position = 'sticky'
        f.style.bottom = '0'
        f.style.background = background
        // the footer band belongs to the bottom of the control, not to the end of the rows (the totals of the entry windows sit at the foot of the grid)
        inner.style.display = 'flex'
        inner.style.flexDirection = 'column'
        inner.style.minHeight = '100%'
        f.style.marginTop = 'auto'
        f.style.flex = 'none'
        for (const c of Array.from(inner.children)) (c as HTMLElement).style.flexShrink = '0'
      }
      inner.appendChild(f)
    }
    return inner
  }

  protected virt: {
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
        if (el.isConnected) el.remove()
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
    this.cancelFill = nextFrame(() => {
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
    // a row taller than the control (a form in a small DataWindow) shows from its top, like PowerBuilder does
    else if (top + h > this.root.scrollTop + view) this.root.scrollTop = h > view ? top : top + h - view
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
    const rulers = /^(yes|true|1)$/i.test(String(m.overrides.get('datawindow.print.preview.rulers') ?? m.def.datawindow['print.preview.rulers'] ?? ''))
    const wrap = document.createElement('div')
    wrap.className = 'dw-preview'
    wrap.style.cssText = 'background:#fff;padding:' + (rulers ? '18px 0 10px 18px' : '10px') + ';width:max-content;min-width:100%;box-sizing:border-box;position:relative'
    const z = zoom > 0 ? zoom : 1
    const units = Number(m.def.datawindow.units ?? 0)
    const margin = (k: string) => toPx(Number(m.def.datawindow['print.margin.' + k] ?? 0), 'x', units) * z
    let widest = 0
    for (const p of pages) {
      p.style.margin = '0 0 10px'
      p.style.boxShadow = rulers ? 'none' : '0 0 4px #000'
      p.style.pageBreakAfter = 'auto'
      if (z !== 1) p.style.setProperty('zoom', String(z))
      if (rulers) {
        // the print area, as the original's preview draws it (blue rectangle inside the page at the margins)
        const frame = document.createElement('div')
        frame.style.cssText = `position:absolute;left:${margin('left')}px;top:${toPx(Number(m.def.datawindow['print.margin.top'] ?? 0), 'y', units) * z}px;right:${margin('right')}px;bottom:${toPx(Number(m.def.datawindow['print.margin.bottom'] ?? 0), 'y', units) * z}px;border:1px solid #0000ff;pointer-events:none`
        p.style.position = 'relative'
        p.appendChild(frame)
      }
      widest = Math.max(widest, parseFloat(p.style.width) || p.offsetWidth || 816)
      wrap.appendChild(p)
    }
    if (rulers) {
      // rulers in inches (96 px each), 1/8 inch ticks
      const inch = 96 * z
      const tick = (dir: 'x' | 'y') => {
        const major = `repeating-linear-gradient(to ${dir === 'x' ? 'right' : 'bottom'}, #000 0 1px, transparent 1px ${inch}px)`
        const half = `repeating-linear-gradient(to ${dir === 'x' ? 'right' : 'bottom'}, #000 0 1px, transparent 1px ${inch / 2}px)`
        const minor = `repeating-linear-gradient(to ${dir === 'x' ? 'right' : 'bottom'}, #000 0 1px, transparent 1px ${inch / 8}px)`
        return dir === 'x' ? `${major} 0 100%/100% 100% no-repeat, ${half} 0 100%/100% 60% no-repeat, ${minor} 0 100%/100% 30% no-repeat` : `${major} 100% 0/100% 100% no-repeat, ${half} 100% 0/60% 100% no-repeat, ${minor} 100% 0/30% 100% no-repeat`
      }
      const top = document.createElement('div')
      top.style.cssText = `position:sticky;top:0;z-index:3;height:18px;margin:-18px 0 0 -18px;padding-left:18px;background:#f0f0f0;border-bottom:1px solid #a0a0a0;overflow:hidden;width:${Math.max(widest * z, 600)}px;box-sizing:content-box`
      top.style.backgroundImage = tick('x')
      for (let i = 1; i <= 60 && i * inch < Math.min(widest, 6000) * z; i++) {
        const n = document.createElement('span')
        n.textContent = String(i)
        n.style.cssText = `position:absolute;left:${18 + i * inch + 2}px;top:0;font:9px Segoe UI,Arial`
        top.appendChild(n)
      }
      const left = document.createElement('div')
      left.style.cssText = `position:absolute;left:0;top:18px;bottom:0;width:18px;background:#f0f0f0;border-right:1px solid #a0a0a0;z-index:2`
      left.style.backgroundImage = tick('y')
      wrap.prepend(left)
      wrap.prepend(top)
    }
    this.virt = null
    this.root.replaceChildren(wrap)
  }

  protected async paint(m: DwModel): Promise<void> {
    if (this.recoveredDraft) return
    if (this.previewOn(m)) return this.paintPreview(m)
    const inner = await this.buildBody(m, true, true)
    if (this.composingText && this.editor === this.composingText) return
    if (await this.retainInvalidText()) return
    const editor = this.takeEditor()
    const scroll = this.root.scrollTop
    const left = this.root.scrollLeft
    this.root.replaceChildren(inner)
    this.root.scrollTop = scroll
    this.root.scrollLeft = left
    await this.fillWindow()
    // a programmatic SetItem (the item list writes icode/itemname/fullcode)
    // repaints the DataWindow; the in-place editor must survive that repaint
    if (editor) this.restoreEditor(editor)
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
    if (this.disposed || this.ctl.model !== m || m.row !== row) return
    m.col = m.colIndex(cols[i]) + 1
    const column = m.col
    await this.ctl.fireItemFocus(row, cols[i])
    if (this.disposed || this.ctl.model !== m || m.row !== row || m.col !== column) return
    await this.paint(m)
    if (this.disposed || this.ctl.model !== m || m.row !== row || m.col !== column) return
    const cell = this.root.querySelector(`.row[data-row="${row}"] .o[data-obj="${cols[i]}"]`) as HTMLElement | null
    const object = m.def.objects.find((object) => object.name === cols[i])
    if (object && cell?.classList.contains('editable')) this.edit(m, object, row, cell)
  }

  private focused = false
  protected async rowClick(m: DwModel, row: number, ev: MouseEvent, source?: HTMLElement): Promise<void> {
    if (this.choiceDestination) {
      this.acceptanceBusy('Wait for the current field transition to finish before selecting another field.')
      return
    }
    const target = (source ?? ev.target as HTMLElement).closest('[data-obj]') as HTMLElement | null
    const obj = target?.dataset.obj
    const destination = m.rowAt(row)
    const leavingChoice = !!this.choiceEdit && (this.editRow !== row || this.editObj !== obj)
    const transition = leavingChoice ? { model: m, row, object: obj, activate: false } : null
    this.choiceDestination = transition
    try {
      if (leavingChoice && !(await this.choiceEdit!.accept(true))) return
      if (leavingChoice && (this.disposed || this.ctl.destroyed)) return
      if (leavingChoice && (this.ctl.model !== m || !destination || m.rowAt(row) !== destination)) {
        this.acceptanceBusy('The destination record changed while accepting the current entry. Select the destination again.')
        return
      }
      const changedRow = m.row !== row
      m.row = row
      // Mouse focus raises source GetFocus; programmatic SetFocus during open does not.
      if (!this.focused) {
        this.focused = true
        await this.ctl.rt.fire(this.ctl, 'getfocus')
      }
      if (leavingChoice && (this.disposed || this.ctl.destroyed || this.ctl.model !== m || m.row !== row || m.rowAt(row) !== destination)) return
      if (obj) {
        const ci = m.colIndex(obj)
        if (ci >= 0) m.col = ci + 1
      }
      await this.ctl.rt.fire(this.ctl, 'clicked', [ev.offsetX, ev.offsetY, row, { name: obj ?? '' }])
      if (changedRow) await this.ctl.rt.fire(this.ctl, 'rowfocuschanged', [row])
      if (leavingChoice && (this.disposed || this.ctl.destroyed || this.ctl.model !== m || m.row !== row || m.rowAt(row) !== destination)) return
      // Keep an editable cell attached until its click opens the editor.
      if (!(target?.classList.contains('editable') && !changedRow)) this.ctl.changed()
      this.choiceDestination = null
      if (leavingChoice && obj && m.row === row && m.col === m.colIndex(obj) + 1 && !this.editor) {
        const object = m.def.objects.find((object) => object.name === obj)
        const cell = this.cellOf(row, obj)
        if (object && cell?.classList.contains('editable')) this.edit(m, object, row, cell, transition!.activate)
      }
    } finally {
      if (this.choiceDestination === transition) this.choiceDestination = null
    }
  }

  protected async commitValue(m: DwModel, row: number, ci: number, o: DwObject, value: unknown, guard?: () => Promise<void>): Promise<DwEditResult> {
    return commitDwValue(this.ctl, m, row, ci, o, value, guard)
  }

  protected async canEdit(model: DwModel, object: DwObject, row: number): Promise<boolean> {
    return object.type === 'column' && this.ctl.props.get('enabled') !== false && model.colIndex(object.name) >= 0
      && (await this.prop(model, object, 'visible', row, object.band)) !== '0'
      && (await this.prop(model, object, 'protect', row, object.band)) !== '1'
      && Number(await this.prop(model, object, 'tabsequence', row, object.band)) > 0
      && !/^(yes|true|1)$/i.test(await this.prop(model, object, 'edit.readonly', row, object.band))
      && !/^(yes|true|1)$/i.test(await this.prop(model, object, 'editmask.readonly', row, object.band))
      && (!dwMultiline(object, model.kinds[model.colIndex(object.name)], model.overrides) ||
        !/^(yes|true|1)$/i.test(await this.prop(model, object, 'edit.displayonly', row, object.band)))
  }

  protected async prop(m: DwModel, o: DwObject, key: string, row: number, band: string): Promise<string> {
    const raw = m.overrides.get(`${o.name.toLowerCase()}.${key}`) ?? o[key]
    if (raw === undefined) return ''
    const { value, expr } = key === 'format' ? splitFormatExpr(raw) : splitExpr(raw)
    if (!expr) return value
    try {
      const v = await evalDw(compileDw(expr), newCtx(m, row, band))
      return v === null ? value : v instanceof Dec ? v.toString() : String(typeof v === 'boolean' ? (v ? 1 : 0) : v)
    } catch (error) {
      console.warn(`Unsupported DataWindow property: ${m.name}.${o.name}.${key}`, error)
      return value
    }
  }

  protected async object(m: DwModel, o: DwObject, row: number, band: string, sx: (v: number) => number, sy: (v: number) => number, _ctx: unknown): Promise<HTMLElement | null> {
    // a script may move or resize an object at run time (`modify("customer_city.X=14 customer_city.Y=100")`: the customer form stacks its fields from InterfaceSetting)
    const geo = ['x', 'y', 'width', 'height'].filter((k) => m.overrides.has(`${o.name.toLowerCase()}.${k}`))
    if (geo.length) o = { ...o, ...Object.fromEntries(geo.map((k) => [k, m.overrides.get(`${o.name.toLowerCase()}.${k}`)!])) } as DwObject
    if ((await this.prop(m, o, 'visible', row, band)) === '0') return null
    if (this.headerOfHiddenColumn(o)) return null
    const shift = this.gridShift(o)
    if (shift === null) return null
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
    st.left = sx(num(o, 'x') - shift) + 'px'
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
    if (o.type === 'groupbox') {
      // the themed group box: a thin rounded frame with the (bold) caption set into its top line
      const fh = Number(o['font.height'] ?? -9)
      const fpx = fontSize(fh) * (96 / 72)
      st.border = 'none'
      st.overflow = 'visible'
      st.pointerEvents = 'none'
      const frame = document.createElement('div')
      frame.style.cssText = `position:absolute;left:0;right:0;bottom:0;top:${Math.round(fpx / 2)}px;border:1px solid #dcdcdc;border-radius:4px;box-sizing:border-box`
      el.appendChild(frame)
      const text = await this.prop(m, o, 'text', row, band)
      if (text) {
        const cap = document.createElement('span')
        cap.textContent = text
        cap.style.cssText = `position:absolute;left:8px;top:0;padding:0 3px;white-space:pre;line-height:${Math.round(fpx * 1.25)}px;background:${pbColor(m.def.datawindow.color, '#f0f0f0')};font:${cssFont({ face: o['font.face'] || 'Arial', size: fontSize(fh), weight: Number(o['font.weight'] ?? 400), italic: false, underline: false, strike: false })}`
        el.appendChild(cap)
      }
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
        img.onerror = () => { if (img.isConnected) img.remove() }
        void readFileBytes(file).then((bytes) => {
          if (!bytes) { if (img.isConnected) img.remove(); return }
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
    // the text of a drop-down column stays left-aligned whatever the alignment says (sale promotion: weekday `<All Days>` and item discount `Disc. % 1` carry alignment 1)
    const dropDown = o.type === 'column' && (o['dddw.name'] !== undefined || o['ddlb.limit'] !== undefined)
    st.textAlign = dropDown ? 'left' : al === '1' ? 'right' : al === '2' ? 'center' : al === '3' ? 'justify' : 'left'
    st.whiteSpace = o.type === 'column' || o.type === 'compute' ? 'nowrap' : 'pre'
    st.lineHeight = st.height
    st.padding = '0 2px'
    if (o.type === 'text') {
      // A DataWindow text object may carry an expression after a tab
      // (`"static~texpression"`); PowerBuilder paints the value of that
      // expression, the static part only documents the design.  Thousands of
      // reports use this for titles and Dr/Cr labels.  Painting the raw text
      // showed `f_reporttitle(1)` instead of the title.
      const raw = (await this.prop(m, o, 'text', row, band)).replace(/~r~n/g, '\n')
      const tab = raw.indexOf('\t')
      let t = raw
      if (tab >= 0) {
        const src = raw.slice(tab + 1).trim()
        if (src) {
          try {
            const v = await evalDw(compileDw(src), newCtx(m, row, band))
            t = v === null || v === undefined ? '' : toStr(v)
          } catch {
            t = ''
          }
        }
      }
      setMnemonic(el, t)
      // a label wider than its box wraps at the words (the grid headers `Manufacturer Name`, `P/O Base Period (Days)` show on two lines)
      const boxW = sx(num(o, 'width')) - 4
      const boxH = sy(num(o, 'height'))
      const fpx = fontSize(fh) * (96 / 72)
      if (boxW > 8 && boxH >= fpx * 1.9 && (t.includes('\n') || t.includes('\r') || measure(st.font, t) > boxW)) {
        // explicit line breaks are kept as they are; only a single long line wraps at the words
        st.whiteSpace = t.includes('\n') || t.includes('\r') ? 'pre' : 'pre-wrap'
        st.lineHeight = `${Math.round(fpx * 1.25)}px`
        st.display = 'flex'
        st.alignItems = 'center'
        st.justifyContent = al === '1' ? 'flex-end' : al === '2' ? 'center' : 'flex-start'
      }
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
    const checkboxOn = choiceProperty(o, 'checkbox.on', m.overrides)
    if (checkboxOn !== undefined && o.type === 'column') {
      // a check box column: the Windows 11 box (blue with a white tick when on) and its text
      const on = sameChoiceValue(v, checkboxOn)
      el.textContent = ''
      const box = document.createElement('span')
      box.className = 'cbx' + (on ? ' on' : '')
      el.appendChild(box)
      const text = choiceProperty(o, 'checkbox.text', m.overrides)
      if (text) el.append(' ' + text)
      el.style.display = 'flex'
      el.style.alignItems = 'center'
      el.style.gap = '3px'
    } else el.textContent = await this.display(m, o, v, row, band)
    if (o.type === 'column') {
      // a drop-down that uses the arrow as its border shows it all the time; a spin edit mask shows its two arrows
      if (o['dddw.useasborder'] === 'yes' || o['ddlb.useasborder'] === 'yes') el.appendChild(Object.assign(document.createElement('span'), { className: 'dd-arrow' }))
      else if (o['editmask.spin'] === 'yes') el.appendChild(Object.assign(document.createElement('span'), { className: 'dd-spin' }))
      const protect = (await this.prop(m, o, 'protect', row, band)) === '1'
      const tab = Number(await this.prop(m, o, 'tabsequence', row, band))
      if (!protect && tab > 0) {
        el.classList.add('editable')
        el.addEventListener('click', () => this.edit(m, o, row, el, true))
      }
    }
    return el
  }

  /** child DataWindow of a drop-down column, retrieved on first use when the definition asks for it */
  private childLoads = new WeakMap<DwModel, { ready: Promise<void>; failed: boolean; error?: unknown }>()
  private async childOf(o: DwObject, requireSuccess = false, retry = false): Promise<DwModel | null> {
    const c = await this.ctl.n_getchild(o.name)
    if (!(c instanceof NDwBase)) return null
    await c.ready
    const cm = c.model
    if (!cm) return null
    let load = this.childLoads.get(cm)
    if (retry && load?.failed) { this.childLoads.delete(cm); load = undefined }
    if (cm.rowCount() === 0 && !load && choiceProperty(o, 'dddw.autoretrieve', this.ctl.model?.overrides) === 'yes' && argList(cm.def).length === 0) {
      const state: { ready: Promise<void>; failed: boolean; error?: unknown } = { ready: Promise.resolve(), failed: false }
      this.childLoads.set(cm, state)
      state.ready = (async () => {
        try {
          if (await c.n_retrieve() < 0) throw new Error(`The choices for ${o.name} could not be retrieved.`)
        } catch (error) {
          state.failed = true
          state.error = error
          if (!this.disposed && !this.ctl.destroyed) this.ctl.rt.onError(error)
        }
      })()
      load = state
    }
    await load?.ready
    if (requireSuccess && load?.failed) throw load.error
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
    const view = new DwView(c, document.createElement('div'), false)
    return view.buildBody(child, false, false)
  }

  /** the code table of a drop-down list box / code-table column: `Yes<tab>Y/No<tab>N/` of the table definition as [display, data] pairs */
  private codeTable(m: DwModel, o: DwObject): [string, string][] | null {
    return codeTable(m.def, o, m.overrides)
  }

  private async display(m: DwModel, o: DwObject, v: unknown, row: number, band: string): Promise<string> {
    const ct = v === null || v === undefined ? null : this.codeTable(m, o)
    if (ct) return ct.find(([, d]) => d === toStr(v))?.[0] ?? toStr(v)
    // a null value shows the row of the drop-down list whose data column is null (`<None>` of the accounts list `ddd_allaccountslist_null`)
    if ((v === null || v === undefined) && choiceProperty(o, 'dddw.name', m.overrides)) {
      const cm = await this.childOf(o)
      const dc = cm ? cm.colIndex(choiceProperty(o, 'dddw.datacolumn', m.overrides) || '') : -1
      const ds = cm ? cm.colIndex(choiceProperty(o, 'dddw.displaycolumn', m.overrides) || '') : -1
      const hit = cm && dc >= 0 && ds >= 0 ? cm.buf.primary.find((r) => r.v[dc] === null || r.v[dc] === undefined) : undefined
      if (hit && cm) return toStr(hit.v[ds])
    }
    if (v === null || v === undefined) {
      // an empty column still shows its display format when that has a section for null / zero-length text (the password columns show `*****`)
      const f = splitExpr(o.format).value
      if (f && /^\s*'[^']*'\s*;\s*'[^']*'\s*$/.test(f)) return stringFormat(null, f)
      // an empty date / time column with an edit mask shows the mask with zeros (`00/00/0000`, the sale return's expiry, the customer's licence expiry)
      const mask = o['editmask.mask']
      const ci = mask ? m.colIndex(o.name) : -1
      if (mask && ci >= 0 && ['date', 'datetime', 'time'].includes(colKind(m.def.table.columns[ci].type)) && !/am|pm|a\/p/i.test(mask)) return mask.replace(/[dmyhs]/gi, '0')
      return ''
    }
    if (choiceProperty(o, 'dddw.name', m.overrides)) {
      const cm = await this.childOf(o)
      if (cm) {
        const dc = cm.colIndex(choiceProperty(o, 'dddw.datacolumn', m.overrides) || '')
        const ds = cm.colIndex(choiceProperty(o, 'dddw.displaycolumn', m.overrides) || '')
        if (dc >= 0 && ds >= 0) {
          const hit = cm.buf.primary.find((r) => toStr(r.v[dc]) === toStr(v))
          if (hit) return toStr(hit.v[ds])
        }
      }
      return toStr(v)
    }
    const checkboxOn = choiceProperty(o, 'checkbox.on', m.overrides)
    if (checkboxOn !== undefined) {
      const on = sameChoiceValue(v, checkboxOn)
      const text = choiceProperty(o, 'checkbox.text', m.overrides)
      return (on ? '\u2611' : '\u2610') + (text ? ' ' + text : '')
    }
    // dynamic format expressions like `[currency]\tf_SetColumnFormat('Qty')`
    // must be evaluated, not shown literally
    const fmt = await this.prop(m, o, 'format', row, band)
    const mask = o['editmask.mask']
    // an edit-mask column that does not `use the format` shows its mask also when it has no focus (the pack purchase's date `dd/mm/yyyy hh:mm` carries a display format with
    // seconds, the original shows no seconds; the sale promotion's start date `[shortdate] [time]` shows `dd/mm/yyyy hh:mm:ss`)
    const ci = m.colIndex(o.name)
    const kind = ci >= 0 ? m.kinds[ci] : ''
    const maskWins = !!mask && o['editmask.useformat'] !== 'yes' && (kind === 'date' || kind === 'datetime' || kind === 'time')
    const useFmt = maskWins ? mask : fmt !== undefined && fmt !== '' ? fmt : mask && o['editmask.useformat'] !== 'yes' ? mask : ''
    // A numeric DataWindow column may hold its value as text (the editor
    // commits the typed string).  Format it as a number, or [general] shows
    // the stored scale: Qty 2.0000 instead of 2.
    if (typeof v === 'string' && (kind === 'number' || kind === 'decimal') && v.trim() !== '' && Number.isFinite(Number(v))) {
      v = kind === 'decimal' ? Dec.parse(v) : Number(v)
    }
    if (typeof v === 'number' || v instanceof Dec || v instanceof PBDate || v instanceof PBTime || v instanceof PBDateTime) return formatValue(v, useFmt || undefined)
    if ((typeof v === 'string' || v === null || v === undefined) && /['"@;]/.test(useFmt)) return stringFormat(v ?? null, useFmt)
    return formatValue(v, useFmt || undefined)
  }

  private cellOf(row: number, name: string): HTMLElement | null {
    return this.root.querySelector(`.row[data-row="${row}"] .o[data-obj="${name}"]`) as HTMLElement | null
  }

  /**
   * PowerBuilder's SetFocus / SelectText on a DataWindow put the keyboard in
   * its current cell and open the in-place editor. The item lists rely on this
   * after `id_detail.selecttext(...)`: the mouse click moves the DOM focus to
   * the list, and the detail editor has to be restored for the item to commit.
   */
  async focusCurrent(fallback = false): Promise<boolean> {
    await this.ctl.ready
    const m = this.ctl.model
    if (!m || m.row < 1 || m.row > m.rowCount() || m.col < 1) return false
    const name = m.colNames[m.col - 1]
    const o = m.def.objects.find((x) => x.type === 'column' && x.name.toLowerCase() === name)
    if (!o) return false
    let cell = this.cellOf(m.row, o.name)
    if (!cell) {
      await this.render()
      cell = this.cellOf(m.row, o.name)
    }
    if (!cell) return false
    if ((this.editor instanceof HTMLInputElement || this.editor instanceof HTMLTextAreaElement) &&
      this.editRow === m.row && this.editObj.toLowerCase() === name) {
      this.syncFocusedText?.()
      this.editor.focus()
      if (!this.choiceEdit && dwEditAutoSelect(m, o)) this.editor.select()
      return true
    }
    if (!cell.classList.contains('editable')) {
      if (!fallback) return false
      // a protected current cell (when the window comes up): the keyboard goes to the first column of the tab order that can be edited (the Purchase Order's header starts in AliasName, `Code` is read-only)
      const order = m.def.objects.filter((x) => x.type === 'column' && num(x, 'tabsequence', 0) > 0).sort((a, b) => num(a, 'tabsequence') - num(b, 'tabsequence'))
      for (const c of order) {
        const el = this.cellOf(m.row, c.name)
        const ci = m.colIndex(c.name)
        if (el && ci >= 0 && el.classList.contains('editable')) {
          m.col = ci + 1
          this.edit(m, c, m.row, el)
          return true
        }
      }
      return false
    }
    this.edit(m, o, m.row, cell)
    return true
  }

  /** state of the open in-place editor, kept across a repaint of the DataWindow */
  protected takeEditor(): DwEditorSnapshot | null {
    const e = this.editor
    if (this.choiceEdit && e === this.choiceEdit.element) return {
      row: this.editRow, obj: this.editObj, value: this.choiceEdit.read(), start: null, end: null, choice: this.choiceEdit,
      focused: document.activeElement === e,
    }
    if (!(e instanceof HTMLInputElement || e instanceof HTMLTextAreaElement)) return null
    return {
      row: this.editRow, obj: this.editObj, value: this.readTextEditor?.() ?? e.value,
      start: e.selectionStart, end: e.selectionEnd, direction: e.selectionDirection ?? undefined,
      scrollTop: e.scrollTop, scrollLeft: e.scrollLeft, focused: document.activeElement === e,
      invalid: e.getAttribute('aria-invalid') === 'true',
    }
  }

  protected restoreEditor(s: DwEditorSnapshot): void {
    const m = this.ctl.model
    if (!m || s.row < 1 || s.row > m.rowCount()) return
    const o = m.def.objects.find((x) => x.type === 'column' && x.name.toLowerCase() === s.obj.toLowerCase())
    if (!o) return
    const cell = this.cellOf(s.row, o.name)
    if (!cell) return
    if (s.choice && this.choiceEdit === s.choice) {
      this.editor = s.choice.element
      this.placeEditor(s.choice.element, cell)
      if (s.focused) s.choice.element.focus({ preventScroll: true })
      return
    }
    this.edit(m, o, s.row, cell, false, false)
    const e = this.editor
    if (!(e instanceof HTMLInputElement || e instanceof HTMLTextAreaElement)) return
    e.value = s.value
    e.dispatchEvent(new CustomEvent('dwtextchange', { detail: s.value }))
    if (s.invalid) e.setAttribute('aria-invalid', 'true')
    if (s.start !== null && s.end !== null) e.setSelectionRange(s.start, s.end, s.direction)
    e.scrollTop = s.scrollTop ?? 0
    e.scrollLeft = s.scrollLeft ?? 0
    if (s.focused !== false) e.focus({ preventScroll: true })
  }

  protected placeEditor(editor: HTMLElement, cell: HTMLElement): void {
    cell.parentElement?.appendChild(editor)
  }

  protected captureEditText(value: unknown): () => string {
    const read = this.readTextEditor
    const choice = this.choiceEdit
    return () => choice?.read() ?? read?.() ?? toStr(value)
  }

  protected detachTextEditor(): void {
    this.releaseTextEditor?.()
    this.releaseTextEditor = null
    this.textEditor = null
    this.readTextEditor = null
    this.checkTextEditor = null
    this.composingText = null
    this.syncFocusedText = null
  }

  private async retainInvalidText(): Promise<boolean> {
    const check = this.checkTextEditor, read = this.readTextEditor
    if (!check || !read || this.editor !== this.textEditor || await check() || check !== this.checkTextEditor) return false
    this.retainStaleDraft(read())
    return true
  }

  protected retainStaleDraft(value: string): void {
    if (this.disposed) return
    this.recoveredDraft = true
    this.cancelChoice()
    this.detachTextEditor()
    this.editor = null
    this.acceptEdit = async () => false
    const notice = document.createElement('div')
    notice.className = 'dw-recovery'
    const message = document.createElement('p')
    message.setAttribute('role', 'alert')
    message.textContent = 'The record or field changed. This entry was not applied and is retained for copying.'
    const label = document.createElement('label')
    label.textContent = 'Unapplied entry'
    const text = document.createElement('textarea')
    text.readOnly = true
    text.rows = 4
    text.value = value
    label.append(text)
    const discard = document.createElement('button')
    discard.type = 'button'
    discard.textContent = 'Discard unapplied entry and use current layout'
    discard.onclick = () => {
      this.discardInputEvents()
      this.recoveredDraft = false
      this.acceptEdit = null
      this.schedule()
    }
    notice.append(message, label, discard)
    this.root.replaceChildren(notice)
    text.focus()
  }

  protected restoreRejectedText(text: string): void {
    if (this.choiceEdit && this.editor === this.choiceEdit.element) {
      this.choiceEdit.element.setAttribute('aria-invalid', 'true')
      return
    }
    if (!(this.editor instanceof HTMLInputElement || this.editor instanceof HTMLTextAreaElement)) return
    this.editor.value = text
    this.editor.dispatchEvent(new CustomEvent('dwtextchange', { detail: text }))
    this.editor.setAttribute('aria-invalid', 'true')
  }

  protected cancelChoice(): void {
    this.choiceEdit?.cancel()
    this.choiceEdit = null
  }

  protected lookupSurface(_object: DwObject): DataSurface | undefined { return undefined }
  protected async browseChoices(_editor: DwChoiceEditor): Promise<number | null> {
    throw new Error('This presentation does not provide a detailed lookup browser.')
  }

  private editChoice(model: DwModel, object: DwObject, row: number, cell: HTMLElement, style: DwChoiceBinding, activate: boolean): void {
    const record = model.rowAt(row)
    const column = model.colIndex(object.name)
    const signature = choiceSignature(model.def, object, model.overrides)
    const lookup = style.kind === 'lookup' ? this.lookupSurface(object) : undefined
    const current = () => !this.disposed && !this.ctl.destroyed && this.choiceEdit === choice &&
      this.ctl.model === model && model.rowAt(row) === record
    const configured = () => current() && model.row === row && model.col === column + 1 &&
      choiceSignature(model.def, object, model.overrides) === signature
    const guard = async () => {
      if (!configured() || !(await this.canEdit(model, object, row)) || !configured()) {
        throw new Error('The record, field or choice configuration changed. The entry was not applied.')
      }
    }
    const choice = new DwChoiceEditor({
      value: model.getItem(row, column + 1),
      checkbox: style.kind === 'checkbox',
      current, guard,
      load: (retry) => this.choiceOptions(model, object, style, retry, lookup),
      details: lookup ? (editor) => this.browseChoices(editor) : undefined,
      commit: (value, check) => this.commitEditValue(model, row, column, object, value, check),
      status: (message) => this.acceptanceBusy(message),
      error: (error) => this.ctl.rt.onError(error),
      close: (restoreFocus) => {
        if (this.choiceEdit !== choice) return
        const focused = document.activeElement === choice.element || restoreFocus && document.activeElement === document.body
        this.cancelChoice()
        this.releaseTextEditor?.()
        this.releaseTextEditor = null
        if (this.editor === choice.element) this.editor = null
        choice.element.remove()
        this.acceptEdit = null
        if (focused) {
          const target = this.root.classList.contains('modern-surface') ? this.cellOf(row, object.name) : this.root
          if (target) { if (!target.hasAttribute('tabindex')) target.tabIndex = -1; target.focus({ preventScroll: true }) }
        }
        this.schedule()
      },
      next: (direction) => this.tabNext(direction),
    })
    this.choiceEdit = choice
    this.editor = choice.element
    choice.element.style.cssText = cell.style.cssText + ';z-index:5;line-height:normal'
    if (style.kind === 'checkbox') choice.element.setAttribute('aria-label', choiceProperty(object, 'checkbox.text', model.overrides) || object.name)
    this.placeEditor(choice.element, cell)
    this.acceptEdit = (navigation) => choice.accept(navigation)
    this.releaseTextEditor = this.ctl.bindTextEditor(model, row, object.name, { read: () => choice.read(), write: (text) => choice.write(text) })
    choice.element.focus()
    choice.start()
    if (activate && style.kind === 'checkbox') void choice.toggle().catch((error) => this.ctl.rt.onError(error))
  }

  private async choiceOptions(model: DwModel, object: DwObject, style: DwChoiceBinding, retry: boolean, lookup?: DataSurface): Promise<DwChoices> {
    if (style.kind === 'checkbox') {
      const items = [{ text: 'Unchecked', value: style.off }, { text: 'Checked', value: style.on }]
      return { items, validate: (choice) => {
        if (!items.some((item) => item === choice)) throw new Error('The checkbox value is no longer available.')
      } }
    }
    if (style.kind === 'list') {
      const items = (this.codeTable(model, object) ?? []).map(([text, value]) => ({ text, value }))
      if (style.sorted) items.sort((left, right) => compareLabels(left.text, right.text))
      return { items, validate: (choice) => {
        if (!items.some((item) => item === choice)) throw new Error('The selected value is no longer in this code table.')
      } }
    }
    const child = await this.ctl.n_getchild(object.name)
    if (!(child instanceof NDwBase)) throw new Error(`The lookup for ${object.name} is unavailable.`)
    const data = await this.childOf(object, true, retry)
    if (!data || child.destroyed || data !== child.model || data.name !== style.name) throw new Error(`The lookup for ${object.name} changed while loading.`)
    const key = data.colIndex(style.dataColumn), label = data.colIndex(style.displayColumn)
    if (key < 0 || label < 0) throw new Error(`The lookup for ${object.name} is missing its data or display column.`)
    const rows = [...data.buf.primary]
    const items = rows.map((record) => ({ text: toStr(record.v[label]), value: record.v[key] }))
    const choices: DwChoices = { items, validate: (choice) => {
      const index = items.indexOf(choice), record = rows[index]
      if (child.destroyed || child.model !== data || !record || !data.buf.primary.includes(record) ||
        !sameChoiceValue(record.v[key], choice.value) || toStr(record.v[label]) !== choice.text) {
        throw new Error('The selected lookup row changed. Reopen the field and choose its current value.')
      }
    } }
    if (lookup) await this.addLookupGrid(choices, data, lookup)
    return choices
  }

  private async addLookupGrid(choices: DwChoices, data: DwModel, surface: DataSurface): Promise<void> {
    const issues = lookupSurfaceIssues(data.def, surface, data.overrides)
    const fields = surface.fields.map((field) => ({
      field, object: data.def.objects.find((object) => object.name === field.object),
    }))
    const visible = fields.filter(({ field, object }) => object &&
      (data.overrides.get(`${field.object}.visible`) ?? object.visible ?? '1') !== '0')
    if (!visible.length) issues.push('No visible lookup columns')
    if (issues.length) {
      choices.gridIssue = `Detailed choices unavailable: ${issues.join('; ')}. The basic list remains available.`
      console.warn(choices.gridIssue)
      return
    }
    const definition = data.def
    const configuration = () => JSON.stringify([data.def, [...data.overrides]])
    const signature = configuration()
    const records = [...data.buf.primary]
    const columns = await Promise.all(visible.map(async ({ field, object }) => {
      const label = data.def.objects.find((object) => object.name === field.labelObject)
      const text = label ? await this.prop(data, label, 'text', 1, label.band) : field.label ?? ''
      const index = data.colIndex(field.object)
      return {
        object: object!, index, label: text.replace(/&&/g, '\0').replace(/&/g, '').replace(/\0/g, '&').trim() || field.label || field.object,
        numeric: field.numeric ?? ['number', 'decimal'].includes(data.kinds[index]),
        values: codeTable(data.def, object!, data.overrides),
      }
    }))
    const values = records.map((record) => columns.map((column) => record.v[column.index]))
    const original = choices.validate
    choices.validate = (choice) => {
      original(choice)
      const index = choices.items.indexOf(choice), record = records[index]
      if (data.def !== definition || configuration() !== signature || !record ||
        columns.some((column, at) => !sameChoiceValue(record.v[column.index], values[index][at]))) {
        throw new Error('The lookup details changed. Press Escape and reopen the field before choosing a value.')
      }
    }
    choices.grid = {
      title: surface.title,
      columns: columns.map(({ label, numeric }) => ({ label, numeric })),
      matches: (index, query) => values[index].some((value, at) => {
        const text = columns[at].values?.find(([, key]) => sameChoiceValue(key, value))?.[0] ?? toStr(value)
        return text.toLocaleLowerCase().includes(query)
      }),
      read: async (index) => {
        const choice = choices.items[index]
        if (!choice) throw new Error('The requested lookup row is no longer available.')
        choices.validate(choice)
        const row = data.buf.primary.indexOf(records[index]) + 1
        const result = await Promise.all(columns.map((column, at) =>
          this.display(data, column.object, values[index][at], row, column.object.band)))
        choices.validate(choice)
        return result
      },
    }
  }

  protected edit(m: DwModel, o: DwObject, row: number, cell: HTMLElement, activate = false, focus = true): void {
    if (this.choiceDestination) {
      const destination = this.choiceDestination
      if (destination.model === m && destination.row === row && destination.object === o.name) destination.activate ||= activate
      else this.acceptanceBusy('Wait for the current field transition to finish before selecting another field.')
      return
    }
    if (this.choiceEdit && this.editor === this.choiceEdit.element) {
      if (this.editRow === row && this.editObj === o.name) {
        this.editor.focus()
        if (activate) void this.choiceEdit.toggle().catch((error) => this.ctl.rt.onError(error))
        return
      }
      if (m.row !== row || m.col !== m.colIndex(o.name) + 1) {
        this.acceptanceBusy('Finish or cancel the current choice before moving to another field.')
        return
      }
      const destination = m.rowAt(row)
      void this.choiceEdit.accept(true).then((ok) => {
        if (!ok || this.disposed || this.ctl.model !== m || m.row !== row || m.rowAt(row) !== destination || m.col !== m.colIndex(o.name) + 1) return
        const target = this.cellOf(row, o.name)
        if (target) this.edit(m, o, row, target, activate)
      }).catch((error) => this.ctl.rt.onError(error))
      return
    }
    this.cancelChoice()
    this.detachTextEditor()
    if (this.editor) {
      const ed = this.editor
      // clearing the field before remove stops a synchronous blur handler from
      // committing/removing the same editor a second time
      this.editor = null
      if (ed.isConnected) ed.remove()
    }
    const ci = m.colIndex(o.name)
    if (ci < 0) return
    this.editRow = row
    this.editCol = ci + 1
    this.editObj = o.name
    const choice = choiceStyle(o, m.overrides)
    if (choice.kind === 'list' || choice.kind === 'lookup' || choice.kind === 'checkbox') {
      this.editChoice(m, o, row, cell, choice, activate)
      return
    }
    if (o['checkbox.on'] !== undefined) {
      const cur = toStr(m.buf.primary[row - 1]?.v[ci])
      const next = cur === o['checkbox.on'] ? o['checkbox.off'] : o['checkbox.on']
      void this.commitEditValue(m, row, ci, o, next)
      return
    }
    const ct = Object.keys(o).some((k) => k.startsWith('ddlb.')) ? this.codeTable(m, o) : null
    if (ct) {
      const sel = document.createElement('select')
      sel.className = 'dw-edit'
      sel.style.cssText = cell.style.cssText + ';z-index:5;line-height:normal'
      const cur = toStr(m.buf.primary[row - 1]?.v[ci])
      for (const [d, v] of ct) {
        const op = document.createElement('option')
        op.value = v
        op.textContent = d
        if (v === cur) op.selected = true
        sel.appendChild(op)
      }
      this.placeEditor(sel, cell)
      this.editor = sel
      sel.focus()
      const done = () => {
        if (this.editor !== sel) return
        this.editor = null
        const val = sel.value
        if (sel.isConnected) sel.remove()
        if (val !== cur) {
          void this.commitEditValue(m, row, ci, o, val)
        }

      }
      sel.addEventListener('change', done)
      sel.addEventListener('blur', done)
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
        this.placeEditor(sel, cell)
        this.editor = sel
        sel.focus()
        const done = () => {
          if (this.editor !== sel) return
          this.editor = null
          const val = sel.value
          if (sel.isConnected) sel.remove()
          if (val !== cur) {
            void this.commitEditValue(m, row, ci, o, val)
          }
        }
        sel.addEventListener('change', done)
        sel.addEventListener('blur', done)
      })
      return
    }
    const multiline = dwMultiline(o, m.kinds[ci], m.overrides)
    const input = multiline ? document.createElement('textarea') : document.createElement('input')
    input.className = 'dw-edit'
    const record = m.rowAt(row)
    const v = m.buf.primary[row - 1]?.v[ci]
    const limit = dwTextLimit(m, ci, o)
    if (limit) input.maxLength = limit
    let sourceText = toStr(v)
    input.value = sourceText
    input.style.cssText = cell.style.cssText + ';z-index:5;border:1px solid #0078d7;background:#fff'
    input.style.lineHeight = 'normal'
    if (input instanceof HTMLTextAreaElement) {
      input.style.resize = 'none'
      input.style.whiteSpace = 'pre-wrap'
      input.wrap = 'soft'
      input.rows = 4
      input.title = 'Shift+Enter adds a line. Enter keeps the form action.'
      input.setAttribute('aria-keyshortcuts', 'Shift+Enter')
    }
    this.placeEditor(input, cell)
    this.editor = input
    this.textEditor = input
    const domText = (text: string) => multiline ? dwMultilineDomText(text) : text
    const readText = () => multiline ? dwMultilineText(input.value, sourceText) : input.value
    this.readTextEditor = readText
    let storedText = sourceText
    let composing = false
    let compositionText: string | null = null
    this.syncFocusedText = () => {
      const current = toStr(m.getItem(row, ci + 1))
      if (current !== storedText) {
        storedText = current
        sourceText = current
        input.value = current
        input.dispatchEvent(new Event('dwtextchange'))
      }
    }
    const releaseText = this.ctl.bindTextEditor(m, row, o.name, {
      read: readText,
      write: (text) => {
        sourceText = dwEditText(m, ci, o, text)
        input.value = sourceText
        input.dispatchEvent(new Event('dwtextchange'))
      },
    })
    input.addEventListener('dwtextchange', (event) => {
      if (event instanceof CustomEvent && typeof event.detail === 'string') sourceText = event.detail
    })
    this.releaseTextEditor = releaseText
    const release = () => {
      if (this.textEditor === input) this.detachTextEditor()
      else releaseText()
    }
    if (focus) {
      input.focus()
      if (dwEditAutoSelect(m, o)) input.select()
    }
    const configured = () => !this.disposed && !this.ctl.destroyed && this.ctl.model === m && m.rowAt(row) === record &&
      m.def.objects.includes(o) && m.colIndex(o.name) === ci && dwMultiline(o, m.kinds[ci], m.overrides) === multiline
    const editable = async () => configured() && await this.canEdit(m, o, row) && configured()
    this.checkTextEditor = multiline ? editable : null
    const guard = async () => {
      if (!configured() || multiline && !(await editable())) {
        if (multiline) this.retainStaleDraft(readText())
        throw new Error('The text field configuration changed. The entry was not applied.')
      }
    }
    const commit = async (navigation = false): Promise<boolean> => {
      if (this.inputFailed) return false
      if (this.editor !== input) return true
      if (composing) {
        this.acceptanceBusy('Finish composing the current entry before continuing.')
        return false
      }
      this.editor = null
      const cur = v === null || v === undefined ? '' : toStr(v)
      if (input.value !== domText(cur)) input.value = dwEditText(m, ci, o, input.value)
      const text = readText()
      if (input.isConnected) input.remove()
      try {
        const result = input.value !== domText(cur) ? await this.commitEditValue(m, row, ci, o, text, guard) : 'accepted'
        if (result === 'rejected' && !this.editor && !this.disposed && this.ctl.model === m &&
          m.rowAt(row) === record && m.row === row && m.col === ci + 1) {
          const target = this.cellOf(row, o.name)
          if (target && await this.canEdit(m, o, row)) {
            this.edit(m, o, row, target)
            this.restoreRejectedText(readText())
          }
        }
        if (result === 'discarded') this.schedule()
        return result === 'accepted' || navigation && result === 'discarded'
      } finally {
        release()
      }
    }
    this.acceptEdit = commit
    const commitFromUi = (): Promise<boolean> => {
      if (!this.inputEventCount) return commit(true)
      const version = this.inputVersion
      return this.trackEdit((async () => {
        let pending: Promise<boolean>
        do {
          pending = this.inputEvents
          if (!(await pending)) return false
        } while (pending !== this.inputEvents)
        if (this.disposed || version !== this.inputVersion || this.ctl.model !== m || m.rowAt(row) !== record) return false
        if (this.editor === input) return commit(true)
        if (this.editor && this.editRow === row && this.editCol === ci + 1 && this.editObj === o.name) {
          return this.acceptEdit ? this.acceptEdit(true) : false
        }
        return !this.editor
      })())
    }
    const normalizeText = () => {
      const text = input.value
      const normalized = dwEditText(m, ci, o, text)
      if (normalized !== text) {
        const start = input.selectionStart, end = input.selectionEnd, direction = input.selectionDirection
        input.value = normalized
        if (start !== null && end !== null) input.setSelectionRange(
          dwEditText(m, ci, o, text.slice(0, start)).length,
          dwEditText(m, ci, o, text.slice(0, end)).length, direction ?? undefined)
      }
    }
    input.addEventListener('compositionstart', () => { composing = true; compositionText = null; this.composingText = input })
    input.addEventListener('compositionend', () => {
      composing = false
      if (this.composingText === input) this.composingText = null
      normalizeText()
      compositionText = input.value
      this.inputChanged(m, row, o, readText())
      this.schedule()
    })
    input.addEventListener('input', (event) => {
      if (composing || event instanceof InputEvent && event.isComposing) return
      normalizeText()
      const alreadyNotified = compositionText === input.value
      compositionText = null
      if (alreadyNotified) return
      this.inputChanged(m, row, o, readText())
    })
    input.addEventListener('blur', () => {
      queueMicrotask(() => {
        // Leaving the DataWindow is not AcceptText; its caller decides when to validate.
        if (document.activeElement instanceof Element && this.root.contains(document.activeElement)) void commitFromUi()
      })
    })
    input.addEventListener('keydown', (ev) => {
      if (!(ev instanceof KeyboardEvent) || composing || ev.isComposing) return
      const k = keyEnum(ev)
      if (ev.key === 'Escape') {
        this.editor = null
        this.acceptEdit = null
        this.discardInputEvents()
        release()
        if (input.isConnected) input.remove()
        return
      }
      if (ev.key === 'Tab') {
        ev.preventDefault()
        void commitFromUi().then((ok) => { if (ok) this.tabNext(ev.shiftKey ? -1 : 1) })
        return
      }
      if (ev.key === 'Enter') {
        if (multiline && ev.shiftKey && !ev.ctrlKey && !ev.altKey && !ev.metaKey) return
        ev.preventDefault()
        // ProcessEnter: a script on the control decides (usually it presses Tab); without one Enter moves on like Tab
        const has = this.ctl.findRoutines('ue_enterkey').length > 0
        void commitFromUi().then(async (ok) => {
          if (!ok) return
          if (has) await this.ctl.rt.fire(this.ctl, 'ue_enterkey', [])
          else await this.tabNext(1)
        })
        return
      }
      if (k) void this.ctl.rt.fire(this.ctl, 'ue_dwnkey', [k, keyFlags(ev)])
    })
  }
}
