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
import { Dec, PBDate, PBDateTime, PBTime, compareLabels, toNum, toStr } from '../runtime/values.ts'
import { cssFont, draftCpi, fontSize, pbColor, toPx, setMnemonic } from './pb.ts'
import { code39Svg, isCode39Font } from './barcode.ts'
import { readFileBytes } from '../runtime/sysfiles.ts'
import { commitDwValue, dwEditAutoSelect, dwEditorText, dwEditText, dwMultiline, dwMultilineDomText, dwMultilineText, dwTextLimit, sameDwColumn } from '../dw/edit.ts'
import type { DwEditResult } from '../dw/edit.ts'
import { choiceProperty, choiceSignature, choiceStyle, codeTable, sameChoiceValue, radioCaption, choiceEditText } from '../dw/choices.ts'
import type { DwChoice, DwChoiceBinding, DwChoices } from '../dw/choices.ts'
import { DwChoiceEditor } from './dw-choice-editor.ts'
import { numericSpin, stepNumber } from './numeric-spin.ts'
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
  popupOpen?: boolean
  focused?: boolean
  invalid?: boolean
  dirty?: boolean
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
  /** value when the editor was opened; an unchanged editor can be discarded silently */
  private editorInitial = ''
  /** set by a real input/change event, not by a lookup resolving its display text */
  private editorDirty = false
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
  private checkChoiceEditor: (() => boolean) | null = null
  protected choiceDestination: { model: DwModel; row: number; object: string | undefined; activate: boolean | number } | null = null
  private onChange = () => { this.bindAcceptance(this.ctl.model); this.schedule() }
  private cancelRender: (() => void) | null = null
  private cancelFill: (() => void) | null = null
  private defaultKeys = new WeakMap<KeyboardEvent, Promise<boolean>>()
  private changingRow = false
  /** the field the keyboard is on when it is not the current data column (a computed field, a button) */
  protected navigation: { model: DwModel; row: number; column: number; name: string } | null = null
  /** accepts the open text editor as the user's own focus change would (waits for its pending EditChanged) */
  private acceptFromUi: (() => Promise<boolean>) | null = null
  /** the field whose entry is being accepted because the user clicked elsewhere; a rejected entry may reopen there */
  private leaving: { model: DwModel; row: number; object: string } | null = null
  /** the press that a rejected entry refused: its click must not open the destination editor */
  private refusedClick: { row: number; object: string | undefined } | null = null
  /** mouse presses and double clicks run one after another, behind the entry being validated */
  private pointerWork: Promise<void> = Promise.resolve()
  private pointerDropped = false
  /** a repaint is putting an existing draft back; it is not a new focus change */
  protected restoringEditor = false
  /** the spin arrows of a Classic numeric editor */
  private spinArrows: HTMLElement | null = null
  /** lookup choices checked against the detail columns a lookup browser shows */
  private detailedChoices = new WeakMap<DwChoices, (choice: DwChoice) => void>()

  constructor(ctl: NDwBase, host: HTMLElement, observe = true) {
    this.ctl = ctl
    this.host = host
    this.root = document.createElement('div')
    this.root.className = 'dw'
    host.appendChild(this.root)
    this.root.addEventListener('scroll', this.onScroll)
    this.root.addEventListener('keydown', (event) => {
      const target = event.target
      if (event.defaultPrevented || event.isComposing || this.disposed || this.ctl.destroyed || this.pendingEdits.size ||
        this.ctl.props.get('enabled') === false || !(target instanceof Node) || !this.root.contains(target) ||
        this.editor?.contains(target)) return
      if (target !== this.root && (!(target instanceof Element) || !target.closest('[data-obj]'))) return
      const key = keyEnum(event)
      if (!key) return
      const allowed = this.ctl.findRoutines('ue_dwnkey').length ?
        this.ctl.rt.fire(this.ctl, 'ue_dwnkey', [key, keyFlags(event)]).then((result) => toNum(result) !== 1) :
        Promise.resolve(true)
      const result = allowed.catch((error) => { this.ctl.rt.onError(error); return false })
      this.defaultKeys.set(event, result)
      // The DataWindow's own key processing follows its key event, which may claim the key by returning 1.
      this.keyDefault(event, target === this.root ? null : (target as Element).closest<HTMLElement>('[data-obj]'), result)
    })
    if (observe) {
      this.bindAcceptance(ctl.model)
      ctl.listeners.add(this.onChange)
      this.schedule()
    }
  }

  allowsDefaultKey(event: KeyboardEvent): Promise<boolean> {
    return this.defaultKeys.get(event) ?? Promise.resolve(false)
  }

  /**
   * Keys pressed while the DataWindow has the keyboard but no editor is open (after Escape, on a read-only cell): Tab moves
   * through the tab sequence, Enter or F2 opens the current field, and the arrow keys move a grid's current row and column.
   * The key event (ue_dwnkey) runs first; returning 1 from it keeps the default processing from happening.
   */
  protected keyDefault(event: KeyboardEvent, cell: HTMLElement | null, allowed: Promise<boolean>): void {
    const model = this.ctl.model
    if (!model || this.recoveredDraft || event.altKey || event.ctrlKey || event.metaKey) return
    const action = this.keyAction(event, model, cell)
    if (!action) return
    event.preventDefault()
    void allowed.then(async (ok) => {
      if (ok && !this.disposed && !this.ctl.destroyed && this.ctl.model === model) await action()
    }).catch((error) => this.ctl.rt.onError(error))
  }

  protected keyAction(event: KeyboardEvent, model: DwModel, cell: HTMLElement | null): (() => Promise<unknown>) | null {
    const button = cell instanceof HTMLButtonElement
    // Tab on a button object moves on to the next control, as the window's tab order does.
    if (event.key === 'Tab') return !button && this.hasTabColumns(model) ? () => this.tabNext(event.shiftKey ? -1 : 1) : null
    if (event.shiftKey) return null
    if (!button && (event.key === 'Enter' || event.key === 'F2')) return () => this.focusCurrent()
    if (!this.gridKeys(model) || model.row < 1 || model.row > model.rowCount()) return null
    const name = this.currentField(model)
    if (!name) return null
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      const row = model.row + (event.key === 'ArrowDown' ? 1 : -1)
      return row < 1 || row > model.rowCount() ? null : () => this.navigate(model, row, name)
    }
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return null
    return async () => {
      const row = model.row
      const fields = await this.displayFields(model, row)
      const index = fields.indexOf(name)
      const target = event.key === 'Home' ? fields[0] : event.key === 'End' ? fields.at(-1) :
        fields[Math.max(0, Math.min(fields.length - 1, index + (event.key === 'ArrowRight' ? 1 : -1)))]
      if (target && target !== name && model.row === row) await this.navigate(model, row, target)
    }
  }

  /** a grid DataWindow: the arrow keys move its current row and column */
  protected gridKeys(model: DwModel): boolean {
    return num(model.def.datawindow, 'processing', 0) === 1
  }

  /** a DataWindow without any tab-sequenced column does not keep the Tab key */
  private hasTabColumns(model: DwModel): boolean {
    return model.def.objects.some((object) => object.type === 'column' &&
      Number(splitExpr(model.overrides.get(`${object.name.toLowerCase()}.tabsequence`) ?? object.tabsequence).value) > 0)
  }

  /** the field the keyboard is on: the current column, or the computed field / button navigation moved to */
  protected currentField(model: DwModel): string | undefined {
    const focus = this.navigation
    if (focus?.model === model && focus.row === model.row && focus.column === model.col) return focus.name
    return model.col > 0 ? model.colNames[model.col - 1] : undefined
  }

  /** moves the keyboard to a field: row focus events for another row, item focus for a data column */
  protected async navigate(model: DwModel, row: number, name: string): Promise<boolean> {
    if (row !== model.row) {
      if (!(await this.canChangeRow(model, row))) return false
      model.row = row
      await this.ctl.rt.fire(this.ctl, 'rowfocuschanged', [row])
    }
    if (this.disposed || this.ctl.model !== model || model.row !== row) return false
    const field = name.toLowerCase()
    const object = model.def.objects.find((item) => item.name.toLowerCase() === field)
    const column = model.colIndex(field)
    if (object?.type === 'column' && column >= 0) {
      model.col = column + 1
      await this.ctl.fireItemFocus(row, field)
    }
    if (this.disposed || this.ctl.model !== model || model.row !== row) return false
    this.navigation = { model, row, column: model.col, name: field }
    this.ctl.changed()
    return true
  }

  /** the fields of a detail row from left to right as the grid shows them (columns, computed fields, buttons) */
  protected async displayFields(model: DwModel, row: number): Promise<string[]> {
    this.layout(model)
    const fields: { name: string; x: number }[] = []
    for (const source of model.def.objects) {
      if (source.band !== 'detail' || !source.name || !['column', 'compute', 'button'].includes(source.type)) continue
      const name = source.name.toLowerCase()
      const geometry = ['x', 'width'].filter((key) => model.overrides.has(`${name}.${key}`))
      const object = geometry.length ? { ...source, ...Object.fromEntries(geometry.map((key) => [key, model.overrides.get(`${name}.${key}`)!])) } as DwObject : source
      if ((await this.prop(model, object, 'visible', row, 'detail')) === '0') continue
      const shift = this.gridShift(object)
      if (shift === null) continue
      fields.push({ name, x: num(object, 'x') - shift })
    }
    return fields.sort((a, b) => a.x - b.x).map((field) => field.name)
  }

  /** the columns a script switched on after the grid was laid out: they are shown behind the visible ones, in this order */
  protected movedColumns(): string[] {
    return this.movedCols.map((column) => column.name)
  }

  dispose(): void {
    this.disposed = true
    this.renderSettled()
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
    if (this.retainInvalidChoice()) return false
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

  private async settleInput(): Promise<boolean> {
    const version = this.inputVersion
    let pending: Promise<boolean>
    do {
      pending = this.inputEvents
      if (!(await pending)) return false
    } while (pending !== this.inputEvents)
    return !this.disposed && !this.inputFailed && version === this.inputVersion
  }

  schedule(): void {
    if (this.disposed || this.scheduled) return
    this.scheduled = true
    this.cancelRender = nextFrame(() => {
      this.scheduled = false
      void this.render()
    })
  }

  /** callers of render() that arrived while a render was running: they wait for the render that includes their change */
  private renderWaiters: (() => void)[] = []
  private renderSettled(): void {
    for (const resolve of this.renderWaiters.splice(0)) resolve()
  }

  async render(): Promise<void> {
    if (this.disposed || this.recoveredDraft || this.choiceEdit?.isComposing || this.composingText && this.editor === this.composingText) {
      if (!this.rendering) this.renderSettled()
      return
    }
    if (this.rendering) {
      // A render is running: this caller's change is painted by the next one, so it waits for that (SetFocus after InsertRow looks
      // for the new row's cells as soon as this returns).
      this.again = true
      return new Promise((resolve) => this.renderWaiters.push(resolve))
    }
    this.rendering = true
    try {
      await this.ctl.ready
      if (this.disposed) return
      if (this.retainInvalidChoice()) return
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
        // the waiters are released by the end of the render this schedules (or by dispose, which cancels it)
        if (this.disposed) this.renderSettled()
        else this.schedule()
      } else this.renderSettled()
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
      el.addEventListener('mousedown', (ev) => this.pointerDown(m, f.row, ev))
      el.addEventListener('dblclick', () => this.pointerDouble(m, f.row))
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
    if (this.choiceEdit?.isComposing || this.composingText && this.editor === this.composingText) return
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
  private async tabColumns(m: DwModel): Promise<string[]> {
    const row = Math.max(1, m.row)
    const columns = await Promise.all(m.def.objects.filter((object) => object.type === 'column').map(async (object) => ({
      name: object.name.toLowerCase(),
      sequence: Number(await this.prop(m, object, 'tabsequence', row, object.band)),
      editable: await this.canEdit(m, object, row),
    })))
    return columns.filter((column) => column.editable)
      .sort((a, b) => a.sequence - b.sequence).map((column) => column.name)
  }

  /** Tab / Enter: next enterable cell of the row, then the first of the next row (the previous one with `dir` = -1) */
  async tabNext(dir: number): Promise<void> {
    const m = this.ctl.model
    if (!m || !m.rowCount()) return
    const currentRow = m.row, currentColumn = m.col
    const cols = await this.tabColumns(m)
    if (this.disposed || this.ctl.model !== m || m.row !== currentRow || m.col !== currentColumn) return
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
    if (row > m.rowCount() || row < 1) {
      // Past the last (or before the first) entry the keyboard stays on the current field, as in PowerBuilder.
      await this.keepKeyboard(m)
      return
    }
    if (row !== m.row) {
      if (!(await this.canChangeRow(m, row))) return
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
    const object = m.def.objects.find((object) => object.name.toLowerCase() === cols[i])
    const cell = object ? this.cellOf(row, object.name) : null
    if (object && cell?.classList.contains('editable')) this.edit(m, object, row, cell)
  }

  /** Tab with nowhere to go: an entry just accepted reopens on its field instead of leaving the keyboard nowhere */
  private async keepKeyboard(m: DwModel): Promise<void> {
    const focus = document.activeElement
    if (this.editor || this.disposed || this.ctl.model !== m || focus && focus !== document.body) return
    await this.focusCurrent()
  }

  private focused = false
  protected async canChangeRow(model: DwModel, row: number): Promise<boolean> {
    if (row === model.row) return true
    const currentRow = model.row, column = model.col
    const current = model.rowAt(currentRow), destination = model.rowAt(row)
    if (!destination || this.disposed || this.ctl.destroyed || this.ctl.model !== model) return false
    if (!this.ctl.findRoutines('rowfocuschanging').length) return true
    if (this.changingRow) {
      this.acceptanceBusy('Wait for the current row transition to finish before selecting another row.')
      return false
    }
    this.changingRow = true
    const focus = document.activeElement
    try {
      const result = await this.ctl.rt.fire(this.ctl, 'rowfocuschanging', [currentRow, row])
      return toNum(result) !== 1 && !this.disposed && !this.ctl.destroyed && this.ctl.model === model &&
        model.row === currentRow && model.col === column && model.rowAt(currentRow) === current && model.rowAt(row) === destination &&
        (document.activeElement === focus || document.activeElement === document.body || this.root.contains(document.activeElement))
    } catch (error) {
      this.ctl.rt.onError(error)
      return false
    } finally { this.changingRow = false }
  }

  protected async rowClick(m: DwModel, row: number, ev: MouseEvent, source?: HTMLElement): Promise<void> {
    if (this.choiceDestination) {
      this.acceptanceBusy('Wait for the current field transition to finish before selecting another field.')
      return
    }
    let target = (source ?? ev.target as HTMLElement).closest('[data-obj]') as HTMLElement | null
    // A press inside the open editor (its text, check box, radio buttons or drop-down arrow) is a click on the edited column.
    if (!source && row === this.editRow && this.ownsEditorTarget(ev.target)) target = this.cellOf(row, this.editObj) ?? target
    // A disabled button object does not take the click.
    if (target?.dataset.disabled === 'true') target = null
    const obj = target?.dataset.obj
    const destination = m.rowAt(row)
    const leavingChoice = !!this.choiceEdit && (this.editRow !== row || this.editObj !== obj)
    // Focus leaving a typed entry accepts it first (ItemChanged, validation); a rejected entry keeps the focus.
    const leavingText = !this.choiceEdit && !!this.acceptFromUi && !!this.editor && this.editor === this.textEditor &&
      (this.editRow !== row || this.editObj !== obj)
    const changingRow = m.row !== row && this.ctl.findRoutines('rowfocuschanging').length > 0
    const transition: DwView['choiceDestination'] = leavingChoice || leavingText || changingRow ? { model: m, row, object: obj, activate: false } : null
    this.choiceDestination = transition
    try {
      // PowerBuilder's order: GetFocus (when the DataWindow did not have it), then Clicked while the current row and column are still
      // the ones being left (scripts read GetRow() there as the old row: `SelectRow(GetRow(), false); SelectRow(row, true)`), and
      // Clicked returning 1 keeps the focus where it is.  Only then is the pending entry accepted (ItemChanged), the row changed
      // (RowFocusChanging / RowFocusChanged) and the clicked field opened.
      if (!this.focused) {
        this.focused = true
        // A press inside a DataWindow that already holds the keyboard (its editor, after SetFocus) is no focus change: no GetFocus.
        if (!(document.activeElement && document.activeElement !== document.body && this.root.contains(document.activeElement))) {
          await this.ctl.rt.fire(this.ctl, 'getfocus')
        }
      }
      if (this.disposed || this.ctl.destroyed || this.ctl.model !== m) return
      const clicked = await this.ctl.rt.fire(this.ctl, 'clicked', [ev.offsetX, ev.offsetY, row, { name: obj ?? '' }])
      if (this.disposed || this.ctl.destroyed) return
      if (toNum(clicked) === 1) {
        this.ctl.changed()
        if (this.editor?.isConnected) this.editor.focus({ preventScroll: true })
        return
      }
      // the script moved, replaced or removed what was clicked: the click has done what it can
      if (this.ctl.model !== m || !destination || m.rowAt(row) !== destination) {
        this.ctl.changed()
        return
      }
      if (leavingChoice && !(await this.choiceEdit!.accept(true))) return
      if (leavingText) {
        const accept = this.acceptFromUi!
        this.leaving = { model: m, row: this.editRow, object: this.editObj }
        let accepted = false
        try { accepted = await accept() } finally { this.leaving = null }
        if (!accepted) {
          this.refusedClick = { row, object: obj }
          return
        }
      }
      if (transition && (this.disposed || this.ctl.destroyed)) return
      if (transition && (this.ctl.model !== m || !destination || m.rowAt(row) !== destination)) {
        this.acceptanceBusy('The destination record changed while accepting the current entry. Select the destination again.')
        return
      }
      const changedRow = m.row !== row
      if (changedRow && !(await this.canChangeRow(m, row))) {
        ev.preventDefault()
        this.ctl.changed()
        return
      }
      m.row = row
      if (obj) {
        const ci = m.colIndex(obj)
        if (ci >= 0) m.col = ci + 1
      }
      if (changedRow) await this.ctl.rt.fire(this.ctl, 'rowfocuschanged', [row])
      if (transition && (this.disposed || this.ctl.destroyed || this.ctl.model !== m || m.row !== row || m.rowAt(row) !== destination)) return
      // Keep an editable cell attached until its click opens the editor.
      if (!(target?.classList.contains('editable') && !changedRow)) this.ctl.changed()
      this.choiceDestination = null
      if (transition && obj && m.row === row && m.col === m.colIndex(obj) + 1 && !this.editor) {
        const object = m.def.objects.find((object) => object.name === obj)
        const cell = this.cellOf(row, obj)
        if (object && cell?.classList.contains('editable')) this.edit(m, object, row, cell, transition!.activate)
      }
    } finally {
      if (this.choiceDestination === transition) this.choiceDestination = null
    }
  }

  /**
   * A mouse press on a detail row (or a keyboard press of a button object).  Presses are processed in order, after any entry
   * still being validated, as PowerBuilder processes them behind ItemChanged; a press that a rejected entry refuses is dropped.
   */
  protected pointerDown(m: DwModel, row: number, ev: MouseEvent, source?: HTMLElement): void {
    if (!source) this.refusedClick = null
    this.pointerWork = this.pointerWork.then(async () => {
      this.pointerDropped = false
      while (this.pendingEdits.size) {
        if ((await Promise.all([...this.pendingEdits])).some((accepted) => !accepted)) {
          this.pointerDropped = true
          return
        }
      }
      if (!this.disposed && !this.ctl.destroyed) await this.rowClick(m, row, ev, source)
    }).catch((error) => this.ctl.rt.onError(error))
  }

  /** DoubleClicked follows the Clicked of its second press, and is dropped with that press */
  protected pointerDouble(m: DwModel, row: number): void {
    this.pointerWork = this.pointerWork.then(async () => {
      if (this.pointerDropped || this.disposed || this.ctl.destroyed || this.ctl.model !== m) return
      await this.ctl.rt.fire(this.ctl, 'doubleclicked', [0, 0, row, { name: '' }])
    }).catch((error) => this.ctl.rt.onError(error))
  }

  /** the open editor, its drop-down arrow, detail button or spin arrows */
  private ownsEditorTarget(node: EventTarget | null): boolean {
    if (!(node instanceof Node) || !this.editor) return false
    return this.editor.contains(node) || !!this.choiceEdit?.popup?.button.contains(node) ||
      !!this.choiceEdit?.browse?.contains(node) || !!this.spinArrows?.contains(node)
  }

  /** the click that follows a press refused by a rejected entry */
  protected takeRefusedClick(row: number, object: string): boolean {
    const refused = this.refusedClick
    this.refusedClick = null
    return !!refused && refused.row === row && refused.object === object
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

  /**
   * The painted text of a text object.  A DataWindow text object may carry an expression after a tab (`"static~texpression"`);
   * PowerBuilder paints the value of that expression, the static part only documents the design.  Thousands of reports use
   * this for titles and Dr/Cr labels.  Painting the raw text showed `f_reporttitle(1)` instead of the title.
   */
  protected async textOf(m: DwModel, o: DwObject, row: number, band: string): Promise<string> {
    const raw = (await this.prop(m, o, 'text', row, band)).replace(/~r~n/g, '\n')
    const tab = raw.indexOf('\t')
    if (tab < 0) return raw
    const src = raw.slice(tab + 1).trim()
    if (!src) return raw
    try {
      const v = await evalDw(compileDw(src), newCtx(m, row, band))
      return v === null || v === undefined ? '' : toStr(v)
    } catch {
      return ''
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
      const t = await this.textOf(m, o, row, band)
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
      // Enabled=no (a runtime Modify) greys the button out and it no longer takes the click.
      if (/^(no|false|0)$/i.test(await this.prop(m, o, 'enabled', row, band))) {
        el.dataset.disabled = 'true'
        el.setAttribute('aria-disabled', 'true')
        st.color = '#a0a0a0'
      }
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
      const text = choiceProperty(o, 'checkbox.text', m.overrides)
      const caption = document.createElement('span')
      caption.className = 'dw-checkbox-caption'
      caption.textContent = text ?? ''
      const leftText = /^(yes|true|1)$/i.test(choiceProperty(o, 'checkbox.lefttext', m.overrides) ?? 'no')
      el.classList.toggle('dw-checkbox-left', leftText)
      if (leftText) el.append(caption, box)
      else el.append(box, caption)
      el.style.display = 'flex'
      el.style.alignItems = 'center'
      el.style.gap = '3px'
    } else if (o.type === 'column' && choiceStyle(o, m.overrides).kind === 'radio') {
      const options = document.createElement('span')
      options.className = 'dw-radio-options'
      // Keep the clicked option attached until click replaces it with the native editor.
      options.addEventListener('mousedown', (event) => event.preventDefault())
      const style = choiceStyle(o, m.overrides)
      const items = this.codeTable(m, o) ?? []
      options.style.setProperty('--dw-radio-columns', String(style.kind === 'radio' ? Math.min(style.columns, items.length || 1) : 1))
      const selected = items.findIndex(([, value]) => sameChoiceValue(value, v))
      for (let index = 0; index < items.length; index++) {
        const option = document.createElement('span')
        option.className = 'dw-radio-option'
        option.dataset.radioChoice = String(index)
        const marker = document.createElement('span')
        marker.className = 'dw-radio-marker'
        marker.classList.toggle('on', index === selected)
        marker.setAttribute('aria-hidden', 'true')
        const text = document.createElement('span')
        text.textContent = radioCaption(items[index][0])
        option.append(marker, text)
        options.append(option)
      }
      el.replaceChildren(options)
    } else el.textContent = await this.display(m, o, v, row, band)
    if (o.type === 'column') {
      // a drop-down that uses the arrow as its border shows it all the time; a spin edit mask shows its two arrows
      if (['dddw', 'ddlb'].some((prefix) => choiceProperty(o, `${prefix}.useasborder`, m.overrides) === 'yes' &&
        !/^(yes|true|1)$/i.test(choiceProperty(o, `${prefix}.showlist`, m.overrides) ?? 'no'))) {
        el.appendChild(Object.assign(document.createElement('span'), { className: 'dd-arrow' }))
      }
      else if (o['editmask.spin'] === 'yes') el.appendChild(Object.assign(document.createElement('span'), { className: 'dd-spin' }))
      // A field the user cannot enter (protected, no tab sequence, read-only, display-only, a disabled control) opens no editor.
      if (await this.canEdit(m, o, row)) {
        el.classList.add('editable')
        el.addEventListener('click', (event) => {
          if (this.takeRefusedClick(row, o.name)) return
          const radio = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>('[data-radio-choice]') : null
          const arrows = el.querySelector('.dd-spin')?.getBoundingClientRect()
          const spin = arrows && arrows.width && event.clientX >= arrows.left ? (event.clientY < arrows.top + arrows.height / 2 ? 1 : -1) : 0
          this.edit(m, o, row, el, radio ? Number(radio.dataset.radioChoice) : true)
          // A press on the spin arrows of a closed field opens it and takes the step, as the arrows of the open editor do.
          if (spin && this.editor instanceof HTMLInputElement && this.editRow === row && this.editObj === o.name) {
            this.stepText(m, o, row, this.editor, spin)
          }
        })
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
      const box = on ? '\u2611' : '\u2610'
      return /^(yes|true|1)$/i.test(choiceProperty(o, 'checkbox.lefttext', m.overrides) ?? 'no') ?
        (text ? text + ' ' : '') + box : box + (text ? ' ' + text : '')
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
    // The keyboard goes by the current paint: a change still waiting to be painted (InsertRow, a tab page enabled just before
    // SetFocus) is painted first, so the cells and their editability are those of the record now current.
    if (this.scheduled || this.rendering) await this.render()
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
    // A current column that is not painted (hidden, or not part of the Modern form) is not a place for the keyboard either: when the
    // window comes up the keyboard goes to the first editable column of the tab order, as for a protected current cell.
    if (!cell && !fallback) return false
    if (cell && (this.editor instanceof HTMLInputElement || this.editor instanceof HTMLTextAreaElement) &&
      this.editRow === m.row && this.editObj.toLowerCase() === name) {
      this.syncFocusedText?.()
      this.editor.focus()
      if (!this.choiceEdit && dwEditAutoSelect(m, o)) this.editor.select()
      return true
    }
    if (!cell || !cell.classList.contains('editable')) {
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
      row: this.editRow, obj: this.editObj, value: this.choiceEdit.read(),
      start: e instanceof HTMLInputElement ? e.selectionStart : null,
      end: e instanceof HTMLInputElement ? e.selectionEnd : null,
      direction: e instanceof HTMLInputElement ? e.selectionDirection ?? undefined : undefined,
      choice: this.choiceEdit,
      popupOpen: this.choiceEdit.popup?.open,
      focused: this.choiceEdit.ownsFocus(),
    }
    if (!(e instanceof HTMLInputElement || e instanceof HTMLTextAreaElement)) return null
    return {
      row: this.editRow, obj: this.editObj, value: this.readTextEditor?.() ?? e.value,
      start: e.selectionStart, end: e.selectionEnd, direction: e.selectionDirection ?? undefined,
      scrollTop: e.scrollTop, scrollLeft: e.scrollLeft, focused: document.activeElement === e,
      invalid: e.getAttribute('aria-invalid') === 'true',
      dirty: this.editorDirty,
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
      s.choice.popup?.mount()
      if (s.choice.element instanceof HTMLInputElement && s.start !== null && s.end !== null) {
        s.choice.element.setSelectionRange(s.start, s.end, s.direction)
      }
      if (s.focused && (document.activeElement === document.body || s.choice.ownsFocus())) {
        s.choice.element.focus({ preventScroll: true })
        if (s.popupOpen) s.choice.popup?.show()
      }
      return
    }
    this.restoringEditor = true
    try { this.edit(m, o, s.row, cell, false, false) }
    finally { this.restoringEditor = false }
    const e = this.editor
    if (!(e instanceof HTMLInputElement || e instanceof HTMLTextAreaElement)) return
    e.value = s.value
    e.dispatchEvent(new CustomEvent('dwtextchange', { detail: s.value }))
    this.editorDirty = s.dirty ?? false
    if (s.invalid) e.setAttribute('aria-invalid', 'true')
    if (s.start !== null && s.end !== null) e.setSelectionRange(s.start, s.end, s.direction)
    e.scrollTop = s.scrollTop ?? 0
    e.scrollLeft = s.scrollLeft ?? 0
    if (s.focused !== false) e.focus({ preventScroll: true })
  }

  protected placeEditor(editor: HTMLElement, cell: HTMLElement): void {
    cell.parentElement?.appendChild(editor)
    if (cell.classList.contains('dw-checkbox-left') && editor instanceof HTMLInputElement && editor.type === 'checkbox') {
      const marker = cell.querySelector<HTMLElement>('.cbx')
      if (marker) {
        Object.assign(editor.style, { left: `${cell.offsetLeft + marker.offsetLeft}px`, top: `${cell.offsetTop + marker.offsetTop}px`,
          width: `${marker.offsetWidth}px`, height: `${marker.offsetHeight}px`, margin: '0', padding: '0', border: '0' })
        marker.style.visibility = 'hidden'
      }
    }
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
    this.editorInitial = ''
    this.editorDirty = false
    this.readTextEditor = null
    this.checkTextEditor = null
    this.composingText = null
    this.syncFocusedText = null
    this.acceptFromUi = null
    this.spinArrows?.remove()
    this.spinArrows = null
  }

  /** a choice editor whose value the user has not changed: its record went away, so it simply closes */
  protected discardUnchangedChoiceEditor(): boolean {
    const choice = this.choiceEdit
    if (!choice || this.editor !== choice.element || this.editorDirty || choice.read() !== this.editorInitial ||
      this.inputEventCount || this.pendingEdits.size) return false
    const element = choice.element
    this.cancelChoice()
    this.detachTextEditor()
    this.discardInputEvents()
    this.acceptEdit = null
    this.editor = null
    element.remove()
    return true
  }

  protected discardUnchangedTextEditor(): boolean {
    const editor = this.editor
    if (!editor || this.choiceEdit || editor !== this.textEditor || !this.readTextEditor ||
      this.readTextEditor() !== this.editorInitial || editor.getAttribute('aria-invalid') === 'true' ||
      this.composingText || this.inputEventCount || this.pendingEdits.size) return false
    this.detachTextEditor()
    this.discardInputEvents()
    this.acceptEdit = null
    this.editor = null
    editor.remove()
    return true
  }

  private async retainInvalidText(): Promise<boolean> {
    const check = this.checkTextEditor, read = this.readTextEditor
    if (!check || !read || this.editor !== this.textEditor || await check() || check !== this.checkTextEditor) return false
    const text = read()
    if (!this.editorDirty || text === this.editorInitial) {
      // the record/layout changed under an editor the user never typed in
      // (reopening a row from a list): discard it silently, do not block the
      // whole DataWindow behind the "unapplied entry" recovery panel
      const editor = this.editor
      this.detachTextEditor()
      this.editor = null
      if (editor?.isConnected) editor.remove()
      return false
    }
    this.retainStaleDraft(text)
    return true
  }

  private retainInvalidChoice(): boolean {
    const choice = this.choiceEdit, check = this.checkChoiceEditor
    if (!choice || !check || check()) return false
    this.retainStaleDraft(choice.read())
    return true
  }

  /** the keyboard is (or was just) in this DataWindow, so a recovery notice may take it */
  protected ownsKeyboard(): boolean {
    const focus = document.activeElement
    return !focus || focus === document.body || this.root.contains(focus)
  }

  protected retainStaleDraft(value: string): void {
    if (this.disposed) return
    const focused = this.ownsKeyboard()
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
    if (focused) text.focus()
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
    this.checkChoiceEditor = null
  }

  protected lookupSurface(_object: DwObject): DataSurface | undefined { return undefined }
  protected async browseChoices(_editor: DwChoiceEditor): Promise<number | null> {
    throw new Error('This presentation does not provide a detailed lookup browser.')
  }

  protected restoreCellFocus(target: HTMLElement): void {
    target.focus({ preventScroll: true })
  }

  private editChoice(model: DwModel, object: DwObject, row: number, cell: HTMLElement, style: DwChoiceBinding, activate: boolean | number): void {
    const record = model.rowAt(row)
    const column = model.colIndex(object.name)
    const signature = choiceSignature(model.def, object, model.overrides)
    const lookup = style.kind === 'lookup' ? this.lookupSurface(object) : undefined
    const editable = (style.kind === 'lookup' || style.kind === 'list') && style.editable
    const current = (): boolean => !this.disposed && !this.ctl.destroyed && this.choiceEdit === choice &&
      this.ctl.model === model && model.rowAt(row) === record
    const configured = (): boolean => current() && model.row === row && model.col === column + 1 &&
      choiceSignature(model.def, object, model.overrides) === signature
    const guard = async () => {
      if (!configured() || !(await this.canEdit(model, object, row)) || !configured()) {
        throw new Error('The record, field or choice configuration changed. The entry was not applied.')
      }
    }
    const key = async (event: KeyboardEvent): Promise<boolean> => {
      await guard()
      const key = keyEnum(event)
      const result = key ? await this.ctl.rt.fire(this.ctl, 'ue_dwnkey', [key, keyFlags(event)]) : 0
      await this.ctl.rt.flushPosted()
      return result === 1
    }
    const choice: DwChoiceEditor = new DwChoiceEditor({
      value: model.getItem(row, column + 1),
      checkbox: style.kind === 'checkbox',
      radio: style.kind === 'radio' ? style.columns : undefined,
      showList: (style.kind === 'lookup' || style.kind === 'list') && style.showList,
      popupWidthPercent: style.kind === 'lookup' ? style.percentWidth : undefined,
      popupLines: style.kind === 'lookup' ? style.lines : undefined,
      key,
      editable: editable ? {
        limit: Number(choiceProperty(object, `${style.kind === 'list' ? 'ddlb' : 'dddw'}.limit`, model.overrides) ?? 0),
        normalize: (text) => choiceEditText(object, text, model.overrides),
        changed: (text) => this.inputChanged(model, row, object, text),
        settle: () => this.settleInput(),
        value: () => model.getItem(row, column + 1),
        key,
        enter: async () => {
          if (this.ctl.findRoutines('ue_enterkey').length) await this.ctl.rt.fire(this.ctl, 'ue_enterkey', [])
          else await this.tabNext(1)
        },
      } : undefined,
      current, guard,
      load: (retry) => this.choiceOptions(model, object, style, retry, lookup),
      details: lookup ? (editor) => this.browseChoices(editor) : undefined,
      commit: (value, check) => this.commitEditValue(model, row, column, object, value, check),
      status: (message) => this.acceptanceBusy(message),
      error: (error) => this.ctl.rt.onError(error),
      close: (restoreFocus) => {
        if (this.choiceEdit !== choice) return
        const focused = choice.ownsFocus() || restoreFocus && document.activeElement === document.body
        this.cancelChoice()
        if (editable) this.discardInputEvents()
        this.detachTextEditor()
        if (this.editor === choice.element) this.editor = null
        choice.element.remove()
        this.acceptEdit = null
        if (focused) {
          const target = this.root.classList.contains('modern-surface') ? this.cellOf(row, object.name) : this.root
          if (target) { if (!target.hasAttribute('tabindex')) target.tabIndex = -1; this.restoreCellFocus(target) }
        }
        this.schedule()
      },
      next: (direction) => this.tabNext(direction),
    })
    this.choiceEdit = choice
    // Retain readonly SetText drafts on policy changes, not on source-directed focus transitions.
    this.checkChoiceEditor = !editable && choice.popup ?
      () => !current() || choiceSignature(model.def, object, model.overrides) === signature : null
    this.editor = choice.element
    this.editorInitial = choice.read()
    const markDirty = () => { this.editorDirty = true }
    choice.element.addEventListener('input', markDirty)
    choice.element.addEventListener('change', markDirty)
    choice.element.style.cssText = cell.style.cssText + ';z-index:5;line-height:normal'
    if (style.kind === 'checkbox') choice.element.setAttribute('aria-label', choiceProperty(object, 'checkbox.text', model.overrides) || object.name)
    if (style.kind === 'radio') choice.element.setAttribute('aria-label', object.name)
    if (choice.popup) {
      choice.element.setAttribute('aria-label', object.name)
    }
    this.placeEditor(choice.element, cell)
    choice.popup?.mount()
    this.acceptEdit = (navigation) => choice.accept(navigation)
    this.releaseTextEditor = this.ctl.bindTextEditor(model, row, object.name, { read: () => choice.read(), write: (text) => choice.write(text) })
    if (editable && choice.element instanceof HTMLInputElement) {
      this.textEditor = choice.element
      this.readTextEditor = () => choice.read()
      this.checkTextEditor = async () => configured() && await this.canEdit(model, object, row) && configured()
      this.syncFocusedText = () => choice.syncValue()
    }
    choice.element.focus()
    choice.start()
    // after start() a lookup editor shows the display text, not the data code
    this.editorInitial = choice.read()
    if (activate !== false) void choice.activate(activate).catch((error) => this.ctl.rt.onError(error))
  }

  private async choiceOptions(model: DwModel, object: DwObject, style: DwChoiceBinding, retry: boolean, lookup?: DataSurface): Promise<DwChoices> {
    if (style.kind === 'checkbox') {
      const items = [{ text: 'Unchecked', value: style.off }, { text: 'Checked', value: style.on }]
      return { items, validate: (choice) => {
        if (!items.some((item) => item === choice)) throw new Error('The checkbox value is no longer available.')
      } }
    }
    if (style.kind === 'list' || style.kind === 'radio') {
      const items = (this.codeTable(model, object) ?? []).map(([text, value]) => ({ text, value }))
      if (style.kind === 'list' && style.sorted) items.sort((left, right) => compareLabels(left.text, right.text))
      let current = -1
      return { items, validate: (choice) => {
        if (!items.some((item) => item === choice)) throw new Error('The selected value is no longer in this code table.')
      }, current: () => current, highlight: (index) => {
        if (!items[index]) throw new Error('The requested code-table choice is unavailable.')
        current = index
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
    if (style.editable || style.showList || style.percentWidth !== undefined || style.lines !== undefined) {
      const childCursor = style.editable || style.showList
      let current = -1
      choices.current = () => childCursor ? rows.indexOf(data.rowAt(data.row)!) : current
      choices.highlight = (index) => {
        const choice = items[index]
        if (!choice) throw new Error('The requested lookup row is unavailable.')
        choices.validate(choice)
        current = index
        if (!childCursor) return
        const row = data.buf.primary.indexOf(rows[index]) + 1
        data.row = row
        for (const record of data.buf.primary) record.sel = record === rows[index]
        child.changed()
      }
    }
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
    // Every pick, from the drop-down or the detail browser, is checked against the lookup it was chosen from: a selection whose
    // child list changed meanwhile (its definition, details, header or visibility, also while an asynchronous validation runs) is
    // never written into the parent; the user reopens the field and chooses again.
    const original = choices.validate
    const detailed = (choice: DwChoice) => {
      original(choice)
      const index = choices.items.indexOf(choice), record = records[index]
      if (data.def !== definition || configuration() !== signature || !record ||
        columns.some((column, at) => !sameChoiceValue(record.v[column.index], values[index][at]))) {
        throw new Error('The lookup details changed. Press Escape and reopen the field before choosing a value.')
      }
    }
    choices.validate = detailed
    this.detailedChoices.set(choices, detailed)
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
        detailed(choice)
        const row = data.buf.primary.indexOf(records[index]) + 1
        const result = await Promise.all(columns.map((column, at) =>
          this.display(data, column.object, values[index][at], row, column.object.band)))
        detailed(choice)
        return result
      },
    }
  }

  /** the choices as the detail browser sees them: a pick is also checked against the detail columns it showed */
  protected detailChoices(choices: DwChoices): DwChoices {
    const detailed = this.detailedChoices.get(choices)
    return detailed ? { ...choices, validate: detailed } : choices
  }

  protected edit(m: DwModel, o: DwObject, row: number, cell: HTMLElement, activate: boolean | number = false, focus = true): void {
    if (this.choiceDestination) {
      const destination = this.choiceDestination, leaving = this.leaving
      if (destination.model === m && destination.row === row && destination.object === o.name) {
        if (activate !== false) destination.activate = activate
        return
      }
      // A rejected entry reopens on the field the user tried to leave.
      if (!(leaving?.model === m && leaving.row === row && leaving.object === o.name)) {
        this.acceptanceBusy('Wait for the current field transition to finish before selecting another field.')
        return
      }
    }
    if (this.changingRow || this.ctl.model !== m || m.row !== row) return
    if (this.choiceEdit && this.editor === this.choiceEdit.element) {
      if (this.editRow === row && this.editObj === o.name) {
        this.editor.focus()
        if (activate !== false) void this.choiceEdit.activate(activate).catch((error) => this.ctl.rt.onError(error))
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
    // Moving the keyboard off a typed entry accepts it first (ItemChanged, validation); it is never silently dropped.
    if (!this.restoringEditor && this.acceptFromUi && this.editor && this.editor === this.textEditor &&
      (this.editRow !== row || this.editObj !== o.name)) {
      const accept = this.acceptFromUi, destination = m.rowAt(row)
      void accept().then((ok) => {
        if (!ok || this.disposed || this.editor || this.ctl.model !== m || m.row !== row || m.rowAt(row) !== destination) return
        const target = this.cellOf(row, o.name)
        if (target) this.edit(m, o, row, target, activate, focus)
      }).catch((error) => this.ctl.rt.onError(error))
      return
    }
    this.cancelChoice()
    this.detachTextEditor()
    this.editorDirty = false
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
    if (choice.kind === 'list' || choice.kind === 'lookup' || choice.kind === 'checkbox' || choice.kind === 'radio') {
      this.editChoice(m, o, row, cell, choice, activate)
      return
    }
    if (choice.kind === 'unsupported' && (Object.keys(o).some((key) => key.startsWith('radiobuttons.')) ||
      [...m.overrides.keys()].some((key) => key.startsWith(`${o.name.toLowerCase()}.radiobuttons.`)))) {
      this.ctl.rt.onError(new Error(`Radio choices for ${o.name} are unavailable: ${choice.reason}`))
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
      this.editorInitial = cur
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
      sel.addEventListener('change', () => { this.editorDirty = true })
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
        this.editorInitial = cur
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
        sel.addEventListener('change', () => { this.editorDirty = true })
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
    const temporal = ['date', 'datetime', 'time'].includes(m.kinds[ci])
    const editMask = choiceProperty(o, 'editmask.mask', m.overrides)
    const limit = dwTextLimit(m, ci, o)
    if (limit) input.maxLength = limit
    let sourceText = dwEditorText(m, o, v)
    this.editorInitial = sourceText
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
    const arrows = input instanceof HTMLInputElement ? this.spinControl(input, m, o, row) : null
    const domText = (text: string) => multiline ? dwMultilineDomText(text) : text
    const readText = () => multiline ? dwMultilineText(input.value, sourceText) : input.value
    this.readTextEditor = readText
    let storedText = sourceText
    let storedValue = toStr(v)
    let composing = false
    let compositionText: string | null = null
    this.syncFocusedText = () => {
      const value = m.getItem(row, ci + 1)
      const currentValue = toStr(value)
      if (currentValue !== storedValue) {
        storedValue = currentValue
        const current = dwEditorText(m, o, value)
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
    input.addEventListener('input', () => { this.editorDirty = true })
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
    // `Modify()` (the Customer form re-lays its fields at run time) replaces
    // the definition objects, so the editor's `o` is no longer the same object
    // even though the column is unchanged.  Compare the column, not identity.
    const currentObject = (): DwObject | undefined => m.def.objects.find((x) => x.name === o.name)
    const configured = () => !this.disposed && !this.ctl.destroyed && this.ctl.model === m &&
      sameDwColumn(m, o, ci, row, record, multiline) &&
      (!temporal || choiceProperty(currentObject() ?? o, 'editmask.mask', m.overrides) === editMask)
    const editable = async () => configured() && await this.canEdit(m, currentObject() ?? o, row) && configured()
    this.checkTextEditor = multiline ? editable : async () => configured()
    const guard = async () => {
      if (!configured() || multiline && !(await editable())) {
        this.retainStaleDraft(readText())
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
      const cur = temporal ? storedText : toStr(v)
      if (input.value !== domText(cur)) input.value = dwEditText(m, ci, o, input.value)
      const text = readText()
      if (input.isConnected) input.remove()
      arrows?.remove()
      try {
        const targetObject = currentObject() ?? o
        const result = input.value !== domText(cur) ? await this.commitEditValue(m, row, ci, targetObject, text, guard) : 'accepted'
        if (result === 'rejected' && !this.editor && !this.disposed && this.ctl.model === m &&
          m.rowAt(row) === record && m.row === row && m.col === ci + 1) {
          const target = this.cellOf(row, o.name)
          if (target && await this.canEdit(m, targetObject, row)) {
            this.edit(m, targetObject, row, target)
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
    this.acceptFromUi = commitFromUi
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
        // Removing the input must not let its detached event target trigger the window's Cancel button.
        ev.preventDefault()
        ev.stopPropagation()
        const focused = document.activeElement === input
        this.editor = null
        this.acceptEdit = null
        this.discardInputEvents()
        release()
        if (input.isConnected) input.remove()
        arrows?.remove()
        if (focused && !this.root.classList.contains('modern-surface')) {
          if (!this.root.hasAttribute('tabindex')) this.root.tabIndex = -1
          this.restoreCellFocus(this.root)
        }
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
      const spin = (ev.key === 'ArrowUp' || ev.key === 'ArrowDown') && !ev.altKey && !ev.ctrlKey && !ev.metaKey && !ev.shiftKey &&
        input instanceof HTMLInputElement && numericSpin(currentObject() ?? o, m.kinds[ci], m.overrides).kind === 'number'
      if (!spin) {
        if (k) void this.ctl.rt.fire(this.ctl, 'ue_dwnkey', [k, keyFlags(ev)])
        return
      }
      // A spin edit mask steps its value with Up and Down, after the key event (which may claim the key by returning 1).
      ev.preventDefault()
      const direction = ev.key === 'ArrowUp' ? 1 : -1
      const step = () => this.stepText(m, currentObject() ?? o, row, input, direction)
      const notified = k ? this.ctl.rt.fire(this.ctl, 'ue_dwnkey', [k, keyFlags(ev)]) : Promise.resolve(null)
      if (!this.ctl.findRoutines('ue_dwnkey').length) {
        step()
        void notified.catch((error) => this.ctl.rt.onError(error))
      } else void notified.then((result) => { if (toNum(result) !== 1) step() }).catch((error) => this.ctl.rt.onError(error))
    })
  }

  /**
   * One step of a spin edit mask (Up/Down or its arrows): the draft changes, the buffer does not.  The step raises the same
   * EditChanged as typing, and the value goes through the normal acceptance and validation when the field is left.
   */
  protected stepText(model: DwModel, object: DwObject, row: number, input: HTMLInputElement, direction: -1 | 1): boolean {
    if (this.disposed || this.ctl.model !== model || this.editor !== input || this.editRow !== row ||
      model.row !== row || model.col !== model.colIndex(object.name) + 1) return false
    const config = numericSpin(object, model.kinds[model.colIndex(object.name)], model.overrides)
    if (config.kind !== 'number') return false
    const value = stepNumber(input.value, config, direction)
    if (value === null) {
      this.acceptanceBusy('Enter a valid number before using Increase or Decrease. The entry has not been changed.')
      input.setAttribute('aria-invalid', 'true')
      return false
    }
    input.value = value
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.focus({ preventScroll: true })
    return true
  }

  /** the two arrows of a Classic spin editor, over its right edge as the closed field shows them */
  protected spinControl(input: HTMLInputElement, m: DwModel, o: DwObject, row: number): HTMLElement | null {
    if (numericSpin(o, m.kinds[m.colIndex(o.name)], m.overrides).kind !== 'number') return null
    const arrows = document.createElement('span')
    arrows.className = 'dw-spin-arrows'
    arrows.setAttribute('aria-hidden', 'true')
    const style = input.style
    arrows.style.cssText = `position:absolute;left:calc(${style.left || '0px'} + ${style.width || '100%'} - 15px);top:${style.top || '0px'};` +
      `height:${style.height || '100%'};width:14px;z-index:6;box-sizing:border-box;border-left:1px solid #adadad;cursor:default;` +
      `background:#fdfdfd url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 8 10'%3E%3Cpath d='M1 4l3-3 3 3M1 6l3 3 3-3' fill='none' stroke='%23303030' stroke-width='1.2'/%3E%3C/svg%3E") center/8px 10px no-repeat`
    arrows.addEventListener('mousedown', (event) => { event.preventDefault(); event.stopPropagation() })
    arrows.addEventListener('dblclick', (event) => event.stopPropagation())
    arrows.addEventListener('click', (event) => {
      event.stopPropagation()
      const box = arrows.getBoundingClientRect()
      this.stepText(m, m.def.objects.find((x) => x.name === o.name) ?? o, row, input, event.clientY < box.top + box.height / 2 ? 1 : -1)
    })
    input.after(arrows)
    this.spinArrows = arrows
    return arrows
  }
}
