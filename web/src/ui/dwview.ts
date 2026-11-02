// DOM rendering of a DataWindow control: bands, rows, objects, editing.
import type { NDwBase } from '../runtime/native/dwctrl.ts'
import type { DwModel } from '../dw/model.ts'
import { num, splitExpr } from '../dw/def.ts'
import type { DwObject } from '../dw/def.ts'
import { compileDw, evalDw, newCtx } from '../dw/expr.ts'
import { formatValue } from '../runtime/sysfuncs.ts'
import { Dec, PBDate, PBDateTime, PBTime, toStr } from '../runtime/values.ts'
import { cssFont, fontSize, pbColor, toPx } from './pb.ts'

const BORDER_CSS: Record<string, string> = {
  '0': 'none',
  '1': '1px solid #000;box-shadow:2px 2px 0 #000',
  '2': '1px solid #000',
  '3': '1px solid #404040',
  '4': 'none;border-bottom:1px solid #000',
  '5': '1px solid;border-color:#808080 #fff #fff #808080', // lowered
  '6': '1px solid;border-color:#fff #808080 #808080 #fff', // raised
  '7': '1px solid #000',
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
    ctl.listeners.add(() => this.schedule())
    this.schedule()
  }

  schedule(): void {
    if (this.scheduled) return
    this.scheduled = true
    requestAnimationFrame(() => {
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

  private async paint(m: DwModel): Promise<void> {
    const u = this.units(m)
    const sx = (v: number) => toPx(v, 'x', u)
    const sy = (v: number) => toPx(v, 'y', u)
    const root = document.createElement('div')
    root.className = 'dw-inner'
    root.style.background = pbColor(m.def.datawindow.color, '#fff')
    const byBand = new Map<string, DwObject[]>()
    for (const o of m.def.objects) {
      const b = o.band === 'header[1]' ? 'header.1' : o.band
      ;(byBand.get(b) || byBand.set(b, []).get(b)!).push(o)
    }
    const width = Math.max(0, ...m.def.objects.map((o) => num(o, 'x') + num(o, 'width') + (o.type === 'line' ? Math.max(num(o, 'x2'), num(o, 'x1')) - num(o, 'x') : 0)))
    const inner = root
    inner.style.width = sx(width) + 'px'
    const ctxBase = newCtx(m, 0, 'header')
    const mk = async (band: string, row: number, cls: string): Promise<HTMLElement> => {
      const h = this.bandHeight(m, band)
      const el = document.createElement('div')
      el.className = 'band ' + cls
      el.style.height = sy(h) + 'px'
      el.style.position = 'relative'
      const bandProps = (m.def.bands as Record<string, Record<string, string>>)[band]
      if (bandProps?.color) el.style.background = pbColor(bandProps.color, 'transparent')
      for (const o of byBand.get(band) || []) {
        const node = await this.object(m, o, row, band, sx, sy, ctxBase)
        if (node) el.appendChild(node)
      }
      return el
    }
    if (this.bandHeight(m, 'header') > 0 || (byBand.get('header') || []).length) {
      const hdr = await mk('header', 0, 'hdr')
      hdr.style.position = 'sticky'
      hdr.style.top = '0'
      hdr.style.zIndex = '2'
      hdr.style.background = hdr.style.background || pbColor(m.def.datawindow.color, '#fff')
      inner.appendChild(hdr)
    }
    const levels = m.groupLevels()
    const rows = m.buf.primary
    for (let i = 0; i < rows.length; i++) {
      for (const g of levels) {
        if (this.groupStarts(m, i, levels, g.level)) inner.appendChild(await mk(`header.${g.level}`, i + 1, 'ghdr'))
      }
      const el = await mk('detail', i + 1, 'row')
      el.dataset.row = String(i + 1)
      if (m.row === i + 1) el.classList.add('cur')
      if (rows[i].sel) el.classList.add('sel')
      el.addEventListener('mousedown', (ev) => void this.rowClick(m, i + 1, ev))
      el.addEventListener('dblclick', () => void this.ctl.rt.fire(this.ctl, 'doubleclicked', [0, 0, i + 1, null]))
      inner.appendChild(el)
      for (const g of [...levels].reverse()) {
        if (this.groupEnds(m, i, levels, g.level)) inner.appendChild(await mk(`trailer.${g.level}`, i + 1, 'gtr'))
      }
    }
    if (this.bandHeight(m, 'summary') > 0) inner.appendChild(await mk('summary', Math.max(1, rows.length), 'sum'))
    if (this.bandHeight(m, 'footer') > 0) {
      const f = await mk('footer', Math.max(1, rows.length), 'ftr')
      f.style.position = 'sticky'
      f.style.bottom = '0'
      f.style.background = pbColor(m.def.datawindow.color, '#fff')
      inner.appendChild(f)
    }
    const scroll = this.root.scrollTop
    const left = this.root.scrollLeft
    this.root.replaceChildren(inner)
    this.root.scrollTop = scroll
    this.root.scrollLeft = left
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
      const pen = Math.max(1, Math.round(num(o, 'pen.width', 1)))
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
    if (bgMode !== '2' && bg) st.background = pbColor(bg, 'transparent')
    if (o.type === 'rectangle' || o.type === 'roundrectangle' || o.type === 'ellipse') {
      st.border = `${Math.max(1, num(o, 'pen.width', 1))}px solid ${pbColor(o['pen.color'], '#000')}`
      if (o.type !== 'rectangle') st.borderRadius = o.type === 'ellipse' ? '50%' : '8px'
      st.background = o['brush.hatch'] === '6' ? pbColor(o['brush.color'], 'transparent') : 'transparent'
      return el
    }
    if (o.type === 'bitmap') {
      const img = document.createElement('img')
      img.src = 'data/assets/' + (o.filename || '').replace(/^.*[\\/]/, '').toLowerCase()
      img.style.width = '100%'
      img.style.height = '100%'
      img.onerror = () => img.remove()
      el.appendChild(img)
      return el
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
    st.color = pbColor(await this.prop(m, o, 'color', row, band), '#000')
    const al = await this.prop(m, o, 'alignment', row, band)
    st.textAlign = al === '1' ? 'right' : al === '2' ? 'center' : al === '3' ? 'justify' : 'left'
    st.whiteSpace = o.type === 'column' || o.type === 'compute' ? 'nowrap' : 'pre'
    st.lineHeight = st.height
    st.padding = '0 2px'
    if (o.type === 'text') {
      el.textContent = (o.text ?? '').replace(/~r~n/g, '\n').replace(/~t/g, '\t')
      if (o.text && /&/.test(o.text)) el.textContent = o.text.replace(/&(.)/g, '$1')
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
      v = r && ci >= 0 ? r.v[ci] : null
    }
    el.textContent = this.display(m, o, v)
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

  private display(m: DwModel, o: DwObject, v: unknown): string {
    if (v === null || v === undefined) return ''
    // drop-down DataWindow / list: show the display value of the data value
    const codeTable = o['ddlb.useasborder'] !== undefined || o['edit.codetable'] === 'yes' ? (o['edit.values'] || '') : ''
    if (o['checkbox.on'] !== undefined) return v === o['checkbox.on'] || toStr(v) === o['checkbox.on'] ? (o['checkbox.text'] || '☑') : o['checkbox.text'] || '☐'
    void codeTable
    const fmt = splitExpr(o.format).value
    if (typeof v === 'number' || v instanceof Dec || v instanceof PBDate || v instanceof PBTime || v instanceof PBDateTime) return formatValue(v, fmt || undefined)
    return formatValue(v, fmt && fmt !== '[general]' && fmt !== '[GENERAL]' ? fmt : undefined)
  }

  private edit(m: DwModel, o: DwObject, row: number, cell: HTMLElement): void {
    if (this.editor) this.editor.remove()
    const ci = m.colIndex(o.name)
    if (ci < 0) return
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
      if (ev.key === 'Enter') {
        void this.ctl.rt.fire(this.ctl, 'ue_enterkey', [0, 0]).then(() => void commit())
      } else if (ev.key === 'Escape') {
        this.editor = null
        input.remove()
      } else void this.ctl.rt.fire(this.ctl, 'ue_dwnkey', [ev.keyCode, 0])
    })
  }
}
