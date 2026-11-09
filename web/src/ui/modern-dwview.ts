import { DwView } from './dwview.ts'
import { dataSurfaceIssues } from './data-surfaces.ts'
import { dataSurfaceByName } from './surface-registry.ts'
import type { DataSurface, DataSurfaceField } from './data-surfaces.ts'
import type { NDwBase } from '../runtime/native/dwctrl.ts'
import type { DwModel, DwRow } from '../dw/model.ts'
import { buildGroupPlan, rowAtItem } from './group-plan.ts'
import { boxOf as sourceBoxOf } from './line-plan.ts'
import { planGrid, applyGrid, anchoredBox, resolveAnchors } from './grid-plan.ts'
import type { GridBox } from './grid-plan.ts'
import type { GroupPlan } from './group-plan.ts'
import type { DwObject } from '../dw/def.ts'
import { toStr } from '../runtime/values.ts'
import { commitDwValue, dwRequired } from '../dw/edit.ts'
import type { DwEditResult } from '../dw/edit.ts'
import { numericSpin, spinNumber, canStepNumber } from './numeric-spin.ts'
import type { NumericSpin } from './numeric-spin.ts'
import type { DwChoiceEditor } from './dw-choice-editor.ts'
import { lookupDialog } from './dw-lookup-dialog.ts'
import type { LookupDialog } from './dw-lookup-dialog.ts'
import type { PresentationDialog } from './presentation-dialogs.ts'
import { choiceStyle, sameChoiceValue } from '../dw/choices.ts'

let nextSurface = 0
const WINDOW_ROWS = 60

/** Semantic layouts over the existing DataWindow model, events, formatter and editor. */
export class ModernDwView extends DwView {
  private surface: DataSurface | null = null
  private contextSurface: DataSurface | null = null
  private contextLabels: ReadonlyMap<string, HTMLElement> = new Map()
  private identity = `data-surface-${++nextSurface}`
  private bindings = new Map<string, { label: string; labelShown: boolean; object: DwObject; suffix?: DwObject; numeric: boolean; spin: NumericSpin | null; choice: boolean; toggle: boolean; radio: boolean; multiline: boolean }>()
  /** a focus request (SetFocus, SelectText) made while an entry is being validated: it takes effect when validation ends */
  private deferredEdit: { model: DwModel; object: string; row: number; activate: boolean | number } | null = null
  private columnSelected = false
  private boundModel: DwModel | null = null
  private boundRow: DwRow | undefined
  private previousRow = 0
  private rovingRow = 1
  private start = 0
  private plan: GroupPlan | null = null
  private rowHeight = 35
  private status = document.createElement('p')
  private changes = new AbortController()
  private resize: ResizeObserver
  private committing = false
  private stepping = false
  private stale = false
  private revision = 0
  private paintRevision = 0
  private restoringFocus = false
  private revealEditor: HTMLElement | null = null
  private lookup: LookupDialog | null = null
  private presentLookup?: (dialog: PresentationDialog<number | null>) => Promise<number | null>
  private lookupNotice = ''
  private onControlChange = (selection?: 'column') => {
    this.revision++
    if (this.lookup?.element.open) {
      this.lookupNotice = 'The record or choices changed while browsing. Press Escape and reopen the field.'
      this.lookup.cancel()
    }
    const model = this.ctl.model
    const draft = this.takeEditor()
    if (draft && (this.ctl.destroyed || model !== this.boundModel || model?.rowAt(draft.row) !== this.boundRow)) {
      if (!this.discardUnchangedTextEditor() && !this.discardUnchangedChoiceEditor()) this.retainStaleDraft(draft.value)
    }
    if (selection === 'column') {
      this.navigation = null
      this.columnSelected = true
    }
  }

  constructor(control: NDwBase, host: HTMLElement,
    presentLookup?: (dialog: PresentationDialog<number | null>) => Promise<number | null>) {
    super(control, host)
    this.presentLookup = presentLookup
    this.status.className = 'surface-status'
    this.status.id = `${this.identity}-status`
    this.status.setAttribute('role', 'status')
    control.listeners.add(this.onControlChange)
    this.resize = new ResizeObserver(() => this.schedule())
    this.resize.observe(host)
    this.root.addEventListener('input', (event) => {
      if (this.surface && event.target instanceof HTMLTextAreaElement &&
        event.target === this.editor && document.activeElement === event.target) {
        this.revealEditor = event.target
        this.schedule()
      }
    }, { signal: this.changes.signal })
    this.root.addEventListener('focusin', (event) => {
      const text = event.target === this.editor && (event.target instanceof HTMLTextAreaElement ||
        event.target instanceof HTMLInputElement && event.target.type !== 'checkbox')
      const radio = this.editor instanceof HTMLFieldSetElement && event.target instanceof HTMLInputElement &&
        event.target.type === 'radio' && this.editor.contains(event.target)
      if (this.surface?.kind === 'form' && !this.restoringFocus && (text || radio)) {
        this.revealEditor = this.editor
        this.schedule()
      }
    }, { signal: this.changes.signal })
    this.root.addEventListener('scroll', () => {
      if (!this.surface || this.surface.kind !== 'grid' || this.stale) return
      if (this.startFor(this.root.scrollTop) !== this.start) this.schedule()
    }, { signal: this.changes.signal })
  }

  override dispose(): void {
    this.changes.abort()
    this.resize.disconnect()
    this.ctl.listeners.delete(this.onControlChange)
    super.dispose()
  }

  useContextSurface(surface: DataSurface, labels: ReadonlyMap<string, HTMLElement> = new Map()): void {
    this.contextSurface = surface
    this.contextLabels = labels
    this.revision++
    this.schedule()
  }

  override async acceptPendingEdit(): Promise<boolean> {
    if (this.stale || !(await super.acceptPendingEdit())) return false
    if (!this.stale && this.surface) this.status.textContent = 'Ready'
    return !this.stale
  }

  override async render(): Promise<void> {
    if (this.stale) return
    await super.render()
    if (this.stale && !this.root.querySelector('.surface-stale')) this.showStaleDraft()
    if (!this.ctl.model && !this.stale) {
      this.surface = null
      this.root.classList.remove('modern-surface')
      this.root.removeAttribute('aria-label')
    }
  }

  protected override acceptanceBusy(message = 'The current entry is still being processed. Wait for it to finish before continuing.'): void {
    this.status.textContent = message
  }

  protected override async acceptModelEdit(model: DwModel): Promise<boolean> {
    if (this.stale) return false
    const accepted = await super.acceptModelEdit(model) && !this.stale
    if (accepted && this.surface) this.status.textContent = 'Ready'
    return accepted
  }

  /** the row a label object is evaluated at: page header objects at row 0, as the Classic view paints them */
  private labelRow(object: DwObject, row: number): number {
    return object.band === 'header' || /^header\[\d+\]$/.test(object.band) ? 0 : row
  }

  /** the caption text as the Classic view paints it (a text object's expression is evaluated), without its mnemonic marker */
  private async label(model: DwModel, field: DataSurfaceField, row: number): Promise<string> {
    const external = this.contextSurface?.name === model.name ? this.contextLabels.get(field.object) : null
    if (external) return external.textContent?.trim() || field.label || ''
    const object = model.def.objects.find((item) => item.name.toLowerCase() === field.labelObject)
    const at = object ? this.labelRow(object, row) : row
    const text = !object ? field.label ?? '' : object.type === 'text' ? await this.textOf(model, object, at, object.band) :
      await this.prop(model, object, 'text', at, object.band)
    return text.replace(/&&/g, '\0').replace(/&/g, '').replace(/\0/g, '&').trim() || field.label || ''
  }

  /** whether the source shows a field's caption (its own visibility expression); a hidden caption still names the field */
  private async labelShown(model: DwModel, field: DataSurfaceField, row: number): Promise<boolean> {
    if (this.contextSurface?.name === model.name && this.contextLabels.get(field.object)) return true
    const object = field.labelObject ? model.def.objects.find((item) => item.name.toLowerCase() === field.labelObject) : undefined
    return !object || await this.prop(model, object, 'visible', this.labelRow(object, row), object.band) !== '0'
  }

  protected override async paint(model: DwModel): Promise<void> {
    if (this.ctl.model !== model) return
    if (this.choiceEdit?.isComposing || this.composingText && this.editor === this.composingText) return
    if (this.stale) return
    const revision = this.revision
    const paintRevision = ++this.paintRevision
    const editor = this.editor
    const draft = this.takeEditor()
    if (draft && (this.boundModel !== model || model.rowAt(draft.row) !== this.boundRow)) {
      if (!this.discardUnchangedTextEditor() && !this.discardUnchangedChoiceEditor()) this.retainStaleDraft(draft.value)
      else this.schedule()
      return
    }
    const surface = this.contextSurface?.name === model.name ? this.contextSurface : dataSurfaceByName(model.name)
    const issues = surface ? dataSurfaceIssues(model.def, surface, model.overrides) : []
    const preview = /^(yes|true|1)$/i.test(model.describe('datawindow.print.preview'))
    // An open text draft survives a change of layout or protection exactly as in the Classic view: it is restored, not blocked.  A
    // pending choice (drop-down or lookup) whose field can no longer be edited is retained in the recovery panel, as Classic's choice
    // check retains it, never reopened on a protected field.
    if (draft?.choice && surface && !issues.length && !preview) {
      const object = model.def.objects.find((item) => item.name.toLowerCase() === draft.obj.toLowerCase())
      if (!object || !(await this.canEdit(model, object, draft.row))) { this.retainStaleDraft(draft.value); return }
    }
    if (!surface || issues.length || preview) {
      this.revealEditor = null
      this.surface = null
      this.navigation = null
      this.columnSelected = false
      this.root.classList.remove('modern-surface')
      this.root.removeAttribute('aria-label')
      this.root.style.scrollPaddingTop = ''
      this.root.style.scrollPaddingBottom = ''
      await super.paint(model)
      if (issues.length) {
        this.status.textContent = `Classic layout retained: ${issues.join('; ')}.`
        this.root.prepend(this.status)
      }
      return
    }
    this.surface = surface
    this.virt = null
    this.layout(model)
    this.root.classList.add('modern-surface')
    this.root.style.background = ''
    this.root.style.overflow = 'auto'
    this.root.setAttribute('aria-label', surface.title)
    this.rowHeight = Math.ceil(parseFloat(getComputedStyle(this.root).fontSize) * (this.root.dataset.density === 'comfortable' ? 3 : 2.5)) * (surface.rowLines ?? 1)
    this.root.style.setProperty('--surface-row-height', `${this.rowHeight}px`)
    const scroll = this.root.scrollTop
    const left = this.root.scrollLeft
    this.plan = surface.kind === 'grid' ? this.groupPlan(model, surface) : null
    let start = surface.kind === 'grid' ? this.startFor(scroll) : 0
    const changedRow = model.row !== this.previousRow || this.columnSelected
    let jumped = false
    if (surface.kind === 'grid' && changedRow && model.row > 0) {
      if (model.row <= start || model.row > start + WINDOW_ROWS) {
        start = Math.max(0, model.row - 6)
        jumped = true
      }
    }
    start = Math.min(start, Math.max(0, model.rowCount() - WINDOW_ROWS))
    this.previousRow = model.row
    this.start = start
    this.bindings.clear()
    for (const field of surface.fields) {
      const object = model.def.objects.find((item) => item.name.toLowerCase() === field.object)!
      if ((model.overrides.get(`${field.object}.visible`) ?? object.visible) === '0') continue
      const spin = field.kind === 'button' ? { kind: 'none' as const } : numericSpin(object, model.kinds[model.colIndex(field.object)], model.overrides)
      this.bindings.set(field.object, {
        object, label: await this.label(model, field, Math.max(1, model.row)),
        labelShown: await this.labelShown(model, field, Math.max(1, model.row)),
        suffix: field.suffixObject ? model.def.objects.find((object) => object.name.toLowerCase() === field.suffixObject) : undefined,
        numeric: field.numeric ?? (!field.choice && ['number', 'decimal'].includes(model.kinds[model.colIndex(field.object)])),
        spin: spin.kind === 'number' ? spin : null,
        choice: !!field.choice,
        toggle: field.choice?.kind === 'checkbox',
        radio: field.choice?.kind === 'radio',
        multiline: !!field.multiline,
      })
    }
    // A grid column a script switched on after the layout appears after the last visible column, as in the Classic grid.
    const moved = surface.kind === 'grid' ? this.movedColumns().filter((name) => this.bindings.has(name)) : []
    if (moved.length) {
      const entries = [...this.bindings]
      this.bindings = new Map([...entries.filter(([name]) => !moved.includes(name)),
        ...moved.map((name) => entries.find(([key]) => key === name)!)])
    }
    const body = document.createElement('div')
    body.className = surface.kind === 'grid' ? 'surface-body surface-body-grid' : 'surface-body'
    if (surface.kind === 'grid') {
      for (const caption of surface.captions ?? []) {
        const object = model.def.objects.find((item) => item.name.toLowerCase() === caption.object)!
        if (await this.prop(model, object, 'visible', 0, 'header') === '0') continue
        const text = await this.label(model, { object: caption.object, labelObject: caption.object }, 0)
        if (!text) continue
        const note = document.createElement('p')
        note.className = 'surface-caption'
        note.dataset.caption = caption.object
        note.textContent = text
        body.append(note)
      }
    }
    const count = model.rowCount()
    const summary = `${surface.title} / ${count} ${count === 1 ? 'row' : 'rows'}`
    if (!count) {
      const empty = document.createElement('p')
      empty.className = 'surface-empty'
      empty.textContent = 'No rows to display.'
      body.append(empty)
    } else if (surface.kind === 'form') {
      // Form-style DataWindows may hold several records; preserve every row.
      for (let row = 1; row <= count; row++) body.append(await this.makeRow(model, row, false))
    } else {
      const table = document.createElement('table')
      table.className = 'surface-grid'
      table.setAttribute('role', 'grid')
      table.setAttribute('aria-label', surface.title)
      table.setAttribute('aria-rowcount', String((this.plan?.prefix[count] ?? count) + 1))
      table.setAttribute('aria-colcount', String(this.bindings.size))
      const head = table.createTHead().insertRow()
      head.setAttribute('aria-rowindex', '1')
      for (const [name, field] of this.bindings) {
        const th = document.createElement('th')
        th.scope = 'col'
        const label = document.createElement('span')
        label.id = `${this.identity}-${name}-heading`
        label.textContent = field.label
        const source = this.surface?.fields.find((item) => item.object === name)
        // Hidden only while the source caption is blank or hidden by its own visibility; a script-set caption is painted.
        if (source?.labelHidden && field.label === source.label || !field.labelShown) label.classList.add('presentation-visually-hidden')
        th.append(label)
        if (dwRequired(field.object, model.overrides)) th.append(this.requiredHint(`${this.identity}-${name}-required`))
        if (field.numeric) th.classList.add('surface-number')
        if (field.spin) th.classList.add('surface-spin-heading')
        head.append(th)
      }
      // Column proportions follow the widths the source gives the columns (structure, not pixels).
      const widths = [...this.bindings.keys()].map((name) => Math.max(1, Number(model.def.objects.find((object) => object.name.toLowerCase() === name.toLowerCase())?.width) || 1))
      const total = widths.reduce((sum, width) => sum + width, 0)
      const columns = document.createElement('colgroup')
      for (const width of widths) {
        const column = document.createElement('col')
        column.style.width = `${(width / total * 100).toFixed(2)}%`
        columns.append(column)
      }
      table.prepend(columns)
      const rows = table.createTBody()
      const visible = new Set(Array.from({ length: Math.min(WINDOW_ROWS, count - start) }, (_, index) => start + index + 1))
      if (draft) visible.add(draft.row)
      this.rovingRow = visible.has(model.row) ? model.row : start + 1
      let previous = 0
      const spacer = (length: number) => {
        if (length <= 0) return
        const tr = rows.insertRow()
        tr.setAttribute('aria-hidden', 'true')
        const cell = tr.insertCell()
        cell.colSpan = Math.max(1, this.bindings.size)
        cell.style.height = `${length * this.rowHeight}px`
        cell.className = 'surface-spacer'
      }
      const items = (row: number) => this.plan?.prefix[row] ?? row
      for (const row of [...visible].sort((a, b) => a - b)) {
        spacer(items(row - 1) - items(previous))
        for (const [index, band] of (this.plan?.heads.get(row) ?? []).entries()) rows.append(await this.makeGroupRow(model, band, row, items(row - 1) + index + 2))
        rows.append(await this.makeRow(model, row, true))
        for (const [index, band] of (this.plan?.tails.get(row) ?? []).entries()) {
          rows.append(await this.makeGroupRow(model, band, row, items(row - 1) + (this.plan?.heads.get(row)?.length ?? 0) + index + 3))
        }
        previous = row
      }
      spacer(items(count) - items(previous))
      body.append(table)
    }
    for (const band of surface.bands ?? []) {
      if (/\./.test(band.band)) continue
      const props = model.def.bands[band.band]
      if (!props || Array.isArray(props) || Number(props.height ?? 0) <= 0 || band.band === 'summary' && !count) continue
      const totals = await this.makeTotals(model, band)
      if (totals) body.append(totals)
    }
    body.classList.toggle('surface-body-with-footer', !!body.querySelector('.surface-band-footer'))
    if (this.changes.signal.aborted || this.stale) return
    if (revision !== this.revision || paintRevision !== this.paintRevision || this.ctl.model !== model || editor !== this.editor) {
      this.schedule()
      return
    }
    if (this.choiceEdit?.isComposing || this.composingText && this.editor === this.composingText) return
    const currentDraft = this.takeEditor()
    const revealInput = this.revealEditor === this.editor && currentDraft?.focused
    this.revealEditor = null
    const columnSelected = this.columnSelected
    this.columnSelected = false
    const active = document.activeElement
    const focus = active instanceof HTMLElement ? active.closest<HTMLElement>('[data-obj]') : null
    // A wrapped status or field can also move a focused sibling action below the window.
    const externalFocus = active instanceof HTMLElement && !this.root.contains(active) &&
      this.root.closest('.modern-window,.modern-entry-window')?.contains(active) && this.focusInView(active) ? active : null
    const focusName = focus && this.root.contains(focus) ? focus.dataset.obj : null
    const focusRow = focusName ? Number(focus?.closest<HTMLElement>('[data-row]')?.dataset.row) : 0
    const focusBand = focusName ? focus?.closest<HTMLElement>('[data-surface-band]')?.dataset.surfaceBand : undefined
    // Reflow must not hide a visible field or pull a deliberately scrolled-away one back.
    const revealField = surface.kind === 'form' && !!focusName && focus !== null && this.focusInView(focus)
    const invalid = this.editor?.getAttribute('aria-invalid') === 'true'
    if (!invalid) this.status.textContent = this.lookupNotice || this.choiceEdit?.options?.gridIssue || summary
    this.editor = null
    this.root.replaceChildren(this.status, body)
    this.root.scrollTop = jumped ? (this.plan?.prefix[start] ?? start) * this.rowHeight : scroll
    this.root.scrollLeft = left
    const headerHeight = this.root.querySelector('thead')?.getBoundingClientRect().height ?? 0
    const headerFits = headerHeight + this.rowHeight <= this.root.clientHeight
    this.root.querySelector('.surface-grid')?.classList.toggle('surface-header-flow', !headerFits)
    const footer = this.root.querySelector<HTMLElement>('.surface-band-footer')
    const footerHeight = footer?.getBoundingClientRect().height ?? 0
    const footerFits = footerHeight + headerHeight + this.rowHeight * 2 <= this.root.clientHeight
    footer?.classList.toggle('surface-band-flow', !footerFits)
    this.root.style.scrollPaddingTop = `${headerFits ? headerHeight : 0}px`
    this.root.style.scrollPaddingBottom = `${footerFits ? footerHeight : 0}px`
    this.restoringFocus = true
    try {
      if (currentDraft) {
        this.restoreEditor(currentDraft)
        const field = this.bindings.get(currentDraft.obj)
        const cell = this.cell(currentDraft.row, currentDraft.obj)
        const restored = cell?.querySelector<HTMLInputElement>('input.surface-editor')
        if (field?.spin && cell && restored) this.syncSpin(restored, cell, model, field.object)
        if (invalid) this.root.querySelector('.surface-editor')?.setAttribute('aria-invalid', 'true')
      }
      else if (focusName && (!focusBand || columnSelected)) this.cell(columnSelected ? model.row : focusRow, columnSelected ? model.colNames[model.col - 1] : focusName)?.focus({ preventScroll: true })
      if (focusBand && !currentDraft?.focused && !columnSelected) {
        const target = [...this.root.querySelectorAll<HTMLElement>('[data-surface-band] [data-obj]')]
          .find((element) => element.dataset.obj === focusName)
        ;(target ?? this.root).focus({ preventScroll: true })
      }
    } finally {
      this.restoringFocus = false
    }
    const activeEditor = document.activeElement
    if ((revealInput || revealField) && activeEditor instanceof HTMLElement && this.root.contains(activeEditor)) {
      this.revealFocus(activeEditor)
    }
    if (externalFocus && activeEditor === externalFocus && !this.focusInView(externalFocus)) this.revealFocus(externalFocus)
    if (jumped) this.cell(model.row, model.colNames[model.col - 1])?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }

  private groupPlan(model: DwModel, surface: DataSurface): GroupPlan | null {
    return surface.grouped ? buildGroupPlan(model.groupLevels(), model.buf.primary, new Set((surface.bands ?? []).map((band) => band.band))) : null
  }

  /** First data row (0-based) a scroll offset brings into view, counting group bands as rows. */
  private startFor(scrollTop: number): number {
    return rowAtItem(this.plan, Math.max(0, Math.floor(scrollTop / this.rowHeight) - 5))
  }

  private async makeGroupRow(model: DwModel, name: string, row: number, index: number): Promise<HTMLElement> {
    const band = this.surface!.bands!.find((item) => item.band === name)!
    const tr = document.createElement('tr')
    tr.className = 'surface-group-row'
    tr.setAttribute('aria-rowindex', String(index))
    tr.dataset.groupBand = name
    tr.dataset.groupRow = String(row)
    const cell = tr.insertCell()
    cell.colSpan = Math.max(1, this.bindings.size)
    const section = await this.makeTotals(model, band, row)
    if (section) cell.append(section)
    return tr
  }

  private async makeTotals(model: DwModel, band: NonNullable<DataSurface['bands']>[number], atRow?: number): Promise<HTMLElement | null> {
    const grouped = /\./.test(band.band)
    const row = atRow ?? Math.max(1, model.rowCount())
    const section = document.createElement('section')
    section.className = `surface-band surface-band-${band.band}`
    section.dataset.surfaceBand = band.band
    section.setAttribute('aria-label', band.label)
    for (const name of band.captions ?? []) {
      const object = model.def.objects.find((item) => item.name.toLowerCase() === name)!
      if (await this.prop(model, object, 'visible', row, band.band) === '0') continue
      const text = await this.label(model, { object: name, labelObject: name }, row)
      if (!text) continue
      const note = document.createElement('p')
      note.className = 'surface-caption'
      note.textContent = text
      section.append(note)
    }
    const values = document.createElement('dl')
    for (const field of band.fields) {
      const object = model.def.objects.find((item) => item.name.toLowerCase() === field.object)!
      const value = await this.object(model, object, row, band.band, (n) => n, (n) => n, null)
      const labelObject = model.def.objects.find((item) => item.name.toLowerCase() === field.labelObject)
      const sourceLabel = labelObject ? await this.object(model, labelObject, row, band.band, (n) => n, (n) => n, null) : null
      if (!value && !sourceLabel) continue
      const item = document.createElement('div')
      const label = document.createElement('dt')
      label.id = `${this.identity}-${band.band}-${grouped ? `${row}-` : ''}${field.object}-label`
      // Hidden only while the source caption is blank; a script-set caption is painted.
      label.textContent = field.labelHidden && !sourceLabel?.textContent?.trim() ? '' : sourceLabel?.textContent ?? (labelObject ? '' : field.label ?? '')
      if (label.textContent) item.append(label)
      if (value) {
        const result = document.createElement('dd')
        value.removeAttribute('style')
        value.classList.add('surface-total-value')
        if (field.numeric) value.classList.add('surface-number')
        value.setAttribute('role', 'textbox')
        value.setAttribute('aria-readonly', 'true')
        if (label.textContent) value.setAttribute('aria-labelledby', label.id)
        else value.setAttribute('aria-label', await this.label(model, field, row))
        value.tabIndex = grouped ? -1 : 0
        value.addEventListener('focus', () => { if (!this.restoringFocus) this.revealFocus(value) })
        result.append(value)
        item.append(result)
      }
      values.append(item)
    }
    if (!values.children.length && !section.children.length) return null
    if (values.children.length) section.append(values)
    return section
  }

  private revealFocus(target: HTMLElement): void {
    const element = target instanceof HTMLInputElement && target.type === 'radio' ?
      target.closest('label') ?? target : target
    element.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }

  private focusInView(target: HTMLElement): boolean {
    const bounds = target.getBoundingClientRect()
    if (!bounds.width || !bounds.height || bounds.top < 0 || bounds.left < 0 ||
      bounds.bottom > innerHeight || bounds.right > innerWidth) return false
    for (let parent = target.parentElement; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent), box = parent.getBoundingClientRect()
      const top = box.top + parent.clientTop, left = box.left + parent.clientLeft
      // CSSOM scroll/client sizes round fractional layout pixels.
      if (/(auto|scroll|hidden|clip)/.test(style.overflowY) &&
        (bounds.top < top - 1 || bounds.bottom > top + parent.clientHeight + 1)) return false
      if (/(auto|scroll|hidden|clip)/.test(style.overflowX) &&
        (bounds.left < left - 1 || bounds.right > left + parent.clientWidth + 1)) return false
    }
    return true
  }

  private cell(row: number, name: string): HTMLElement | null {
    return [...this.root.querySelectorAll<HTMLElement>('.row[data-row] [data-obj]')]
      .find((element) => element.dataset.obj === name && Number(element.closest<HTMLElement>('[data-row]')?.dataset.row) === row) ?? null
  }

  private activeField(model: DwModel): string | undefined {
    const focus = this.navigation
    if (focus?.model === model && focus.row === model.row && focus.column === model.col && this.bindings.has(focus.name)) return focus.name
    const column = model.colNames[model.col - 1]
    return this.bindings.has(column) ? column : [...this.bindings.keys()][0]
  }

  private requiredHint(id: string): HTMLSpanElement {
    const hint = document.createElement('span')
    hint.id = id
    hint.className = 'surface-required'
    hint.textContent = 'Required'
    return hint
  }

  private async makeRow(model: DwModel, row: number, grid: boolean): Promise<HTMLElement> {
    const element: HTMLElement = document.createElement(grid ? 'tr' : 'section')
    element.className = 'row surface-row'
    element.dataset.row = String(row)
    if (grid) {
      element.setAttribute('aria-rowindex', String((this.plan ? this.plan.prefix[row - 1] + (this.plan.heads.get(row)?.length ?? 0) : row - 1) + 2))
      element.setAttribute('aria-selected', String(!!model.rowAt(row)?.sel))
    }
    else element.setAttribute('aria-label', `${this.surface!.title}, row ${row}`)
    if (model.rowAt(row)?.sel) element.classList.add('sel')
    if (model.row === row) element.classList.add('cur')
    // Presses wait behind an entry being validated instead of being dropped (shared with the Classic view).
    element.addEventListener('mousedown', (event) => this.pointerDown(model, row, event))
    element.addEventListener('dblclick', () => this.pointerDouble(model, row))
    const grouped = new Map<string, HTMLElement>()
    for (const group of this.surface!.groups ?? []) {
      if (group.object === '') {
        const plain = document.createElement('div')
        plain.className = 'surface-group surface-group-plain'
        for (const name of group.fields) grouped.set(name, plain)
        element.append(plain)
        continue
      }
      const object = model.def.objects.find((object) => object.name.toLowerCase() === group.object)!
      const visible = await this.prop(model, object, 'visible', row, 'detail') !== '0'
      const text = visible ? await this.label(model, { object: group.object, labelObject: group.object }, row) : ''
      const container = document.createElement('div')
      container.className = 'surface-group'
      container.dataset.group = group.object
      if (text) {
        const caption = document.createElement('span')
        caption.id = `${this.identity}-${row}-${group.object}-caption`
        caption.className = 'surface-group-caption'
        caption.textContent = text
        container.setAttribute('role', 'group')
        container.setAttribute('aria-labelledby', caption.id)
        container.append(caption)
      }
      // A DataWindow groupbox is decoration, not the owner of its enclosed fields.
      container.classList.toggle('surface-group-plain', !visible)
      for (const name of group.fields) grouped.set(name, container)
      element.append(container)
    }
    const appendSeparator = async (before?: string) => {
      for (const separator of this.surface!.separators ?? []) {
        if (separator.before !== before) continue
        const object = model.def.objects.find((object) => object.name.toLowerCase() === separator.object)!
        const line = document.createElement('hr')
        line.className = 'surface-separator'
        line.dataset.separator = separator.object
        line.setAttribute('aria-hidden', 'true')
        line.hidden = await this.prop(model, object, 'visible', row, 'detail') === '0'
        element.append(line)
      }
    }
    const appendCaptions = async (before?: string) => {
      for (const caption of this.surface!.captions ?? []) {
        if (caption.before !== before) continue
        const object = model.def.objects.find((object) => object.name.toLowerCase() === caption.object)!
        if (await this.prop(model, object, 'visible', row, 'detail') === '0') continue
        const text = await this.label(model, { object: caption.object, labelObject: caption.object }, row)
        if (!text) continue
        const note = document.createElement('p')
        note.className = 'surface-caption'
        note.dataset.caption = caption.object
        note.textContent = text
        ;(before === undefined ? element : grouped.get(before) ?? element).append(note)
      }
    }
    const appendButtons = async (before?: string) => {
      for (const item of this.surface!.buttons ?? []) {
        if (item.before !== before) continue
        const object = model.def.objects.find((object) => object.name.toLowerCase() === item.object)!
        if (await this.prop(model, object, 'visible', row, 'detail') === '0') continue
        const text = await this.label(model, { object: item.object, labelObject: item.object }, row)
        const button = this.dwButton(model, row, item.object, text || item.object,
          /^(no|false|0)$/i.test(await this.prop(model, object, 'enabled', row, 'detail')))
        ;(before === undefined ? element : grouped.get(before) ?? element).append(button)
      }
    }
    for (const [name, field] of this.bindings) {
      await appendSeparator(name)
      await appendCaptions(name)
      await appendButtons(name)
      const container = grouped.get(name) ?? element
      const wrapper = document.createElement(grid ? 'td' : 'div')
      wrapper.className = 'surface-field'
      wrapper.dataset.field = name
      if (grid) wrapper.setAttribute('role', 'presentation')
      const external = !grid && this.surface === this.contextSurface ? this.contextLabels.get(name) : null
      const labelId = grid ? `${this.identity}-${name}-heading` : external?.id || `${this.identity}-${row}-${name}-label`
      if (external && this.contextLabels.size > 1) wrapper.append(external)
      const source = this.surface?.fields.find((item) => item.object === name)
      if (!grid && !external?.id) {
        // Each record's caption is its own (the source evaluates the caption, and its visibility, per row).
        const label = document.createElement('span')
        label.id = labelId
        label.className = 'surface-label'
        const text = source ? await this.label(model, source, row) : field.label
        label.textContent = text
        const shown = source ? await this.labelShown(model, source, row) : true
        if (source?.labelHidden && text === source.label || !shown) label.classList.add('presentation-visually-hidden')
        wrapper.append(label)
      }
      if (grid && source?.kind === 'button') {
        // A per-row button: the same button object (and Clicked) as the Classic view, pressed through the shared row click.
        const button = await this.object(model, field.object, row, 'detail', (n) => n, (n) => n, null)
        if (button) {
          const text = button.textContent?.trim() || field.label
          const control = this.dwButton(model, row, name, text, button.dataset.disabled === 'true')
          // One keyboard entry point per grid: the arrow keys reach the row buttons.
          control.tabIndex = -1
          // The visible text names the button; its column heading describes it.
          if (!button.textContent?.trim()) control.setAttribute('aria-label', field.label)
          control.setAttribute('aria-describedby', `${this.identity}-${name}-heading`)
          wrapper.append(control)
        }
        container.append(wrapper)
        continue
      }
      const value = await this.object(model, field.object, row, 'detail', (n) => n, (n) => n, null)
      if (!value) {
        if (!grid) wrapper.hidden = true
        container.append(wrapper)
        continue
      }
      value.removeAttribute('style')
      value.classList.add('surface-value')
      value.querySelector('.dd-spin')?.remove()
      if (field.choice) value.querySelector('.dd-arrow')?.remove()
      value.id = `${this.identity}-${row}-${name}-value`
      value.dataset.labelledby = labelId
      value.setAttribute('aria-labelledby', grid ? `${labelId} ${value.id}` : labelId)
      let description = external ? this.root.parentElement?.getAttribute('aria-describedby') : null
      let suffix: HTMLSpanElement | null = null
      if (field.suffix && await this.prop(model, field.suffix, 'visible', row, 'detail') !== '0') {
        const text = await this.textOf(model, field.suffix, row, 'detail')
        if (text.trim()) {
          suffix = document.createElement('span')
          suffix.className = 'surface-suffix'
          suffix.id = `${this.identity}-${row}-${name}-suffix`
          suffix.dataset.surfaceSuffix = field.suffix.name
          suffix.textContent = text
          description = [description, suffix.id].filter(Boolean).join(' ')
        }
      }
      const enabled = await this.canEdit(model, field.object, row)
      value.classList.toggle('editable', enabled)
      value.setAttribute('aria-readonly', String(!enabled))
      value.setAttribute('role', grid ? 'gridcell' : field.toggle ? 'checkbox' : field.choice && enabled ? 'button' : 'textbox')
      if (enabled && dwRequired(field.object, model.overrides)) {
        const id = grid ? `${this.identity}-${name}-required` : `${this.identity}-${row}-${name}-required`
        if (!grid) wrapper.append(this.requiredHint(id))
        value.dataset.required = 'true'
        if (value.getAttribute('role') !== 'button') value.setAttribute('aria-required', 'true')
        description = [description, id].filter(Boolean).join(' ')
      }
      if (description) {
        value.dataset.describedby = description
        value.setAttribute('aria-describedby', description)
      }
      if (field.multiline) {
        value.classList.add('surface-multiline')
        value.setAttribute('aria-multiline', 'true')
        if (enabled) {
          const hint = document.createElement('span')
          hint.id = `${this.identity}-${row}-${name}-hint`
          // In a grid the hint is an accessible description only: the row has no room for visible help.
          hint.className = grid ? 'surface-help presentation-visually-hidden' : 'surface-help'
          hint.textContent = grid ? 'Shift+Enter adds a line.' : 'Shift+Enter adds a line. Enter keeps the form action.'
          wrapper.append(hint)
          value.dataset.describedby = [description, hint.id].filter(Boolean).join(' ')
          value.setAttribute('aria-describedby', value.dataset.describedby)
        }
      }
      if (field.toggle) {
        value.classList.add('surface-toggle')
        const style = choiceStyle(field.object, model.overrides)
        const stored = model.getItem(row, name)
        const checked = style.kind === 'checkbox' ? sameChoiceValue(stored, style.on) ? 'true' :
          sameChoiceValue(stored, style.off) ? 'false' : 'mixed' : 'mixed'
        const marker = value.querySelector<HTMLElement>('.cbx')
        if (marker) {
          marker.classList.toggle('mixed', checked === 'mixed')
          if (grid) {
            marker.setAttribute('role', 'checkbox')
            marker.setAttribute('aria-label', field.label)
            marker.setAttribute('aria-checked', checked)
            marker.setAttribute('aria-readonly', String(!enabled))
          } else marker.setAttribute('aria-hidden', 'true')
        }
        if (!grid) value.setAttribute('aria-checked', checked)
      }
      if (field.radio) {
        value.classList.add('surface-radio')
        const selected = value.querySelector('.dw-radio-marker.on')?.parentElement?.textContent
        value.setAttribute('aria-description', selected ? `Selected: ${selected}` : 'No matching choice is selected.')
      }
      const choice = field.choice ? choiceStyle(field.object, model.overrides) : null
      const automatic = choice && (choice.kind === 'list' || choice.kind === 'lookup') && choice.showList
      if (field.choice && !field.toggle && !field.radio && enabled) {
        value.classList.add('surface-choice')
        value.setAttribute('aria-haspopup', 'listbox')
        if (!automatic) {
          const arrow = document.createElement('span')
          arrow.className = 'surface-choice-arrow'
          arrow.setAttribute('aria-hidden', 'true')
          value.append(arrow)
        }
      }
      const activeName = this.activeField(model)
      value.tabIndex = grid ? (row === this.rovingRow && name === activeName ? 0 : -1) : 0
      value.addEventListener('focusin', (event) => {
        if (!this.restoringFocus && event.target instanceof HTMLElement) {
          this.revealFocus(event.target)
          if ((field.radio || automatic) && enabled && event.target === value) {
            if (model.row === row && model.col === model.colIndex(name) + 1) this.edit(model, field.object, row, value)
            else void this.focusChoice(model, field.object, row, value).catch((error) => this.ctl.rt.onError(error))
          }
        }
      })
      if (field.numeric) value.classList.add('surface-number')
      if (grid) value.addEventListener('focusin', () => {
        if (this.ctl.model !== model || model.row !== row || this.stale) return
        this.navigation = { model, row, column: model.col, name }
        for (const cell of this.root.querySelectorAll<HTMLElement>('[role=gridcell]')) cell.tabIndex = cell === value ? 0 : -1
      })
      // Keys on the cell (Enter, F2, Space, arrows, Tab) are the DataWindow's shared key processing: see keyAction.
      if (field.spin) {
        value.classList.add('surface-spinner')
        const controls = document.createElement('span')
        controls.className = 'surface-spin-controls'
        for (const direction of [-1, 1] as const) {
          const button = document.createElement('button')
          button.type = 'button'
          button.tabIndex = -1
          button.dataset.direction = String(direction)
          button.setAttribute('aria-label', `${direction < 0 ? 'Decrease' : 'Increase'} ${field.label}`)
          button.disabled = !enabled || this.committing || this.stepping ||
            !canStepNumber(toStr(model.getItem(row, name)), field.spin, direction)
          const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
          svg.setAttribute('viewBox', '0 0 16 16')
          svg.setAttribute('aria-hidden', 'true')
          svg.setAttribute('focusable', 'false')
          const path = document.createElementNS(svg.namespaceURI, 'path')
          path.setAttribute('d', direction < 0 ? 'M4 6l4 4 4-4' : 'M4 10l4-4 4 4')
          path.setAttribute('fill', 'none')
          path.setAttribute('stroke', 'currentColor')
          path.setAttribute('stroke-width', '1.5')
          svg.append(path)
          button.append(svg)
          button.addEventListener('mousedown', (event) => { event.preventDefault(); event.stopPropagation() })
          button.addEventListener('dblclick', (event) => event.stopPropagation())
          button.addEventListener('click', (event) => {
            event.stopPropagation()
            void this.startStep(model, field.object, row, direction, event).catch((error) => this.ctl.rt.onError(error))
          })
          controls.append(button)
        }
        value.append(controls)
      }
      if (suffix) {
        const group = document.createElement('div')
        group.className = 'surface-input-group'
        group.append(value, suffix)
        wrapper.append(group)
      } else wrapper.append(value)
      container.append(wrapper)
    }
    await appendSeparator()
    await appendCaptions()
    await appendButtons()
    if (!grid) this.arrangeLines(element, model)
    return element
  }

  /**
   * Structural parity with the Classic form: every field, caption, button, rule and groupbox is placed on a CSS grid derived from the
   * source coordinates (shared rows stay shared, a tall object beside stacked ones spans them, columns follow the source widths).
   * Only track geometry is derived: the DOM order, and so the tab order, is untouched.  Narrow containers stack the cells.
   */
  private arrangeLines(element: HTMLElement, model: DwModel): void {
    const surface = this.surface
    if (!surface) return
    const def = model.def
    const fieldOf = new Map(surface.fields.map((field) => [field.object, field]))
    // Runtime Modify (visibility, position, size) arranges the form as the Classic view paints it.
    const overrides = model.overrides
    const boxOf = (definition: typeof def, names: readonly (string | undefined)[], key: string) => sourceBoxOf(definition, names, key, undefined, overrides)
    const lineBox = (name: string): GridBox | null => {
      const line = def.objects.find((object) => object.name.toLowerCase() === name)
      const value = (key: string) => overrides.get(`${name}.${key}`) ?? line?.[key]
      if (!line || value('visible') === '0') return null
      const x1 = Number(value('x1')), x2 = Number(value('x2')), y1 = Number(value('y1')), y2 = Number(value('y2'))
      return [x1, x2, y1, y2].every(Number.isFinite) ? { key: '', left: Math.min(x1, x2), right: Math.max(x1, x2), top: Math.min(y1, y2), bottom: Math.max(y1, y2) + 1 } : null
    }
    // A field yields its editor box and its caption-anchored box; `resolveAnchors` keeps the wider one only where it takes no other editor's place.
    const boxFor = (child: HTMLElement): { editor: GridBox; anchored: GridBox } | null => {
      const plain = (box: GridBox | null) => box ? { editor: box, anchored: box } : null
      if (child.hidden) return null
      if (child.classList.contains('surface-field') && child.dataset.field) {
        const field = fieldOf.get(child.dataset.field)
        if (!field) return null
        const editor = boxOf(def, [field.object], `field:${field.object}`)
        if (!editor) return null
        const others = [field.labelBand === 'header' ? undefined : field.labelObject, field.suffixObject].flatMap((name) => { const box = name ? boxOf(def, [name], name) : null; return box ? [box] : [] })
        return { editor, anchored: anchoredBox(`field:${field.object}`, editor, others) }
      }
      if (child.dataset.caption) return plain(boxOf(def, [child.dataset.caption], `caption:${child.dataset.caption}`))
      if (child.classList.contains('surface-button') && child.dataset.obj) return plain(boxOf(def, [child.dataset.obj], `button:${child.dataset.obj}`))
      if (child.dataset.separator) { const box = lineBox(child.dataset.separator); return plain(box ? { ...box, key: `separator:${child.dataset.separator}` } : null) }
      return null
    }
    const keyOf = (child: HTMLElement): string | null => {
      if (child.classList.contains('surface-field') && child.dataset.field) return `field:${child.dataset.field}`
      if (child.dataset.caption) return `caption:${child.dataset.caption}`
      if (child.classList.contains('surface-button') && child.dataset.obj) return `button:${child.dataset.obj}`
      if (child.dataset.separator) return `separator:${child.dataset.separator}`
      return null
    }
    const arrange = (container: HTMLElement, groups: ReadonlyMap<HTMLElement, GridBox>): GridBox | null => {
      const cells = new Map<string, HTMLElement>()
      const items: { editor: GridBox; anchored: GridBox }[] = []
      for (const child of [...container.children] as HTMLElement[]) {
        const group = groups.get(child)
        const found = group ? { editor: group, anchored: group } : boxFor(child)
        const key = group ? `group:${child.dataset.group ?? ''}` : keyOf(child)
        if (!found || !key) continue
        cells.set(key, child)
        items.push({ editor: { ...found.editor, key }, anchored: { ...found.anchored, key } })
      }
      const boxes = resolveAnchors(items)
      const legend = container.querySelector<HTMLElement>(':scope > .surface-group-caption')
      if (legend) { legend.style.gridColumn = '1 / -1'; legend.style.gridRow = '1' }
      applyGrid(container, planGrid(boxes), cells, legend ? 1 : 0)
      return boxes.length ? {
        key: '', left: Math.min(...boxes.map((box) => box.left)), right: Math.max(...boxes.map((box) => box.right)),
        top: Math.min(...boxes.map((box) => box.top)), bottom: Math.max(...boxes.map((box) => box.bottom)),
      } : null
    }
    // Groups first (their own cells), then the top level, where a group is one cell: its groupbox, or the extent of its contents.
    const groupBoxes = new Map<HTMLElement, GridBox>()
    for (const group of element.querySelectorAll<HTMLElement>(':scope > .surface-group')) {
      const inner = arrange(group, new Map())
      const named = group.dataset.group ? boxOf(def, [group.dataset.group], `group:${group.dataset.group}`) : null
      const box = named ?? inner
      if (box) groupBoxes.set(group, { ...box, flex: true })
    }
    arrange(element, groupBoxes)
  }

  private async focusChoice(model: DwModel, object: DwObject, row: number, cell: HTMLElement): Promise<void> {
    if (!(await this.acceptPendingEdit()) || !cell.isConnected || document.activeElement !== cell ||
      this.ctl.model !== model || this.stale || this.changes.signal.aborted) return
    if (!(await this.moveTo(model, row, object.name))) return
    const target = this.cell(row, object.name)
    if (target) this.edit(model, object, row, target)
  }

  protected override async rowClick(model: DwModel, row: number, event: MouseEvent, source?: HTMLElement): Promise<void> {
    const target = (source ?? (event.target instanceof HTMLElement ? event.target : null))?.closest<HTMLElement>('[data-obj]')
    const name = target?.dataset.obj, record = model.rowAt(row)
    await super.rowClick(model, row, event, source)
    if (!this.surface || source || event.button !== 0 || !name || !record) return
    const current = () => !this.stale && !this.changes.signal.aborted && !this.ctl.destroyed && this.ctl.model === model &&
      model.rowAt(row) === record && model.row === row && model.col === model.colIndex(name) + 1 &&
      (this.root.contains(document.activeElement) || document.activeElement === document.body)
    if (!current()) return
    const field = this.bindings.get(name)
    if (!field || field.choice || !(await this.canEdit(model, field.object, row)) || !current()) return
    // Source GetFocus can repaint/reflow the form between down and up, so the
    // browser's subsequent click may never reach the original text cell.
    const cell = this.cell(row, name)
    if (cell) this.edit(model, field.object, row, cell)
  }

  private async moveTo(model: DwModel, row: number, name: string): Promise<boolean> {
    if (row !== model.row) {
      if (!(await this.canChangeRow(model, row))) return false
      model.row = row
      await this.ctl.rt.fire(this.ctl, 'rowfocuschanged', [row])
    }
    if (this.changes.signal.aborted || this.ctl.model !== model || this.stale || model.row !== row) return false
    const column = model.colIndex(name)
    const dataColumn = this.bindings.get(name)?.object.type === 'column' && column >= 0
    if (dataColumn) {
      model.col = column + 1
      await this.ctl.fireItemFocus(row, name)
    }
    const current = () => !this.changes.signal.aborted && this.ctl.model === model && !this.stale &&
      model.row === row && (!dataColumn || model.col === column + 1)
    if (!current()) return false
    this.navigation = { model, row, column: model.col, name }
    await this.paint(model)
    if (!current()) return false
    const target = this.cell(row, name)
    if (target) this.restoreCellFocus(target)
    target?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    return true
  }

  /** Tab follows the shared Classic tab sequence (current-row editability, one row at a time, nothing past the end). */
  override async tabNext(direction: number): Promise<void> {
    if (this.stale) return
    return super.tabNext(direction)
  }

  protected override async navigate(model: DwModel, row: number, name: string): Promise<boolean> {
    return this.surface ? this.moveTo(model, row, name) : super.navigate(model, row, name)
  }

  protected override async displayFields(model: DwModel, row: number): Promise<string[]> {
    if (!this.surface) return super.displayFields(model, row)
    return [...this.bindings.keys()].filter((name) => this.cell(row, name))
  }

  /**
   * The shared key processing, for the field the keyboard is on: Enter, F2 (and Space on a choice) open it without a Clicked
   * event; in a grid the arrows move the current row and column (the reading position only, in a tabular report or a group band).
   */
  protected override keyAction(event: KeyboardEvent, model: DwModel, cell: HTMLElement | null): (() => Promise<unknown>) | null {
    if (!this.surface || this.stale || !cell || event.key === 'Tab') return super.keyAction(event, model, cell)
    const rowElement = cell.closest<HTMLElement>('.row[data-row]')
    const band = cell.closest<HTMLElement>('.surface-group-row')
    if (!rowElement && !band || event.shiftKey) return null
    const name = cell.dataset.obj ?? ''
    const field = this.bindings.get(name)
    const button = cell instanceof HTMLButtonElement
    if (rowElement && !button && (event.key === 'Enter' || event.key === 'F2' || event.key === ' ' && field?.choice)) {
      const row = Number(rowElement.dataset.row)
      return () => this.activateCell(model, row, name, event.key === ' ' && !!field?.toggle)
    }
    if (this.surface.kind !== 'grid' || !['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return null
    return () => this.navigateFrom(model, cell, event.key)
  }

  /** Enter on a field: the keyboard moves there (row and item focus, no Clicked) and its editor opens */
  private async activateCell(model: DwModel, row: number, name: string, toggle: boolean): Promise<void> {
    const field = this.bindings.get(name)
    if (!field || field.object.type !== 'column' || !(await this.canEdit(model, field.object, row))) return
    const current = () => !this.stale && this.ctl.model === model && model.row === row && model.col === model.colIndex(name) + 1
    if (!current()) {
      if (this.editor && !(await this.acceptPendingEdit())) return
      if (!(await this.moveTo(model, row, name)) || !current()) return
    }
    const target = this.cell(row, name)
    if (target) this.edit(model, field.object, row, target, toggle)
  }

  private async navigateFrom(model: DwModel, cell: HTMLElement, key: string): Promise<void> {
    const from = cell.closest<HTMLElement>('tr')
    if (!from || this.ctl.model !== model) return
    const dataRow = from.matches('.row[data-row]') ? Number(from.dataset.row) : 0
    const name = cell.dataset.obj ?? ''
    if (key !== 'ArrowUp' && key !== 'ArrowDown') {
      if (!dataRow) {
        const values = [...from.querySelectorAll<HTMLElement>('[data-obj]')]
        const index = values.indexOf(cell)
        const next = key === 'Home' ? values[0] : key === 'End' ? values.at(-1) : values[index + (key === 'ArrowRight' ? 1 : -1)]
        if (next) this.focusOnly(next)
        return
      }
      const fields = await this.displayFields(model, dataRow)
      const index = fields.indexOf(name)
      const target = key === 'Home' ? fields[0] : key === 'End' ? fields.at(-1) :
        fields[Math.max(0, Math.min(fields.length - 1, index + (key === 'ArrowRight' ? 1 : -1)))]
      if (target && target !== name) await this.reach(model, dataRow, target)
      return
    }
    const direction = key === 'ArrowDown' ? 1 : -1
    const rows = [...(from.parentElement?.children ?? [])].filter((tr): tr is HTMLElement =>
      tr instanceof HTMLElement && tr.matches('.row[data-row], .surface-group-row'))
    // The data row the key leads to: the next or previous record, or the record a group band stands beside.
    const group = Number(from.dataset.groupRow), trailer = from.dataset.groupBand?.startsWith('trailer')
    const row = dataRow ? dataRow + direction : direction > 0 ? (trailer ? group + 1 : group) : (trailer ? group : group - 1)
    const reference = dataRow || group
    // A group band between the two records is visited first (it is read only); a band of a farther, unrendered record is not.
    const adjacent = rows[rows.indexOf(from) + direction]
    if (adjacent?.matches('.surface-group-row') && Math.abs(Number(adjacent.dataset.groupRow) - reference) <= 1) {
      const value = adjacent.querySelector<HTMLElement>('[data-obj]')
      if (value) {
        this.focusOnly(value)
        return
      }
    }
    const column = dataRow ? name : this.activeField(model) ?? ''
    if (row >= 1 && row <= model.rowCount() && column) await this.reach(model, row, column)
  }

  /** a grid moves its current row and column; a tabular report only moves the reading position */
  private async reach(model: DwModel, row: number, name: string): Promise<void> {
    if (this.gridKeys(model)) {
      await this.moveTo(model, row, name)
      return
    }
    if (!this.cell(row, name)) {
      this.root.scrollTop = Math.max(0, (this.plan?.prefix[row - 1] ?? row - 1) - 3) * this.rowHeight
      await this.paint(model)
    }
    const target = this.cell(row, name)
    if (target) this.focusOnly(target)
  }

  private focusOnly(target: HTMLElement): void {
    this.restoreCellFocus(target)
    this.revealFocus(target)
  }

  /** a button object: a press is the shared row click (Clicked on the button, row focus events), Enter or Space the same press */
  private dwButton(model: DwModel, row: number, name: string, text: string, disabled: boolean): HTMLButtonElement {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'surface-button'
    button.dataset.obj = name
    button.textContent = text
    if (disabled) {
      button.dataset.disabled = 'true'
      button.setAttribute('aria-disabled', 'true')
      button.style.opacity = '0.55'
    }
    button.addEventListener('click', (event) => {
      // A mouse press already ran on mousedown; only a keyboard press (detail 0) is a press of its own.
      if (event.detail !== 0 || disabled) return
      this.pointerDown(model, row, new MouseEvent('mousedown'), button)
    })
    return button
  }

  protected override edit(model: DwModel, object: DwObject, row: number, cell: HTMLElement, activate: boolean | number = false, focus = true): void {
    if (this.stale || this.changes.signal.aborted || this.ctl.model !== model) return
    if (!this.choiceDestination && !this.restoringEditor && this.committing) {
      // A focus request made by a script while an entry is being validated (SetColumn + SetFocus in ItemChanged) takes
      // effect when the validation ends, as in the Classic view.
      this.deferredEdit = { model, object: object.name, row, activate }
      return
    }
    if (!this.choiceDestination && this.surface && this.editor && this.boundModel === model && this.boundRow === model.rowAt(row)
      && this.editRow === row && this.editObj === object.name) {
      this.editor.focus({ preventScroll: true })
      if (!this.restoringFocus && document.activeElement === this.editor) this.revealFocus(this.editor)
      if (activate !== false) void this.choiceEdit?.activate(activate).catch((error) => this.ctl.rt.onError(error))
      return
    }
    if (!this.choiceDestination && !this.restoringEditor && this.surface &&
      (!cell.classList.contains('editable') || this.ctl.props.get('enabled') === false)) return
    const before = this.editor, record = model.rowAt(row)
    super.edit(model, object, row, cell, activate, focus)
    const editor = this.editor
    if (!editor || editor === before || this.editRow !== row || this.editObj !== object.name) return
    // The editor is focused without the browser's scroll-into-view (no jump on repaint), and possibly after this returns: a
    // field Tab or Enter opened below the visible part of a dialog or page is brought into view when it takes the focus.
    editor.addEventListener('focusin', (event) => {
      if (!this.restoringFocus && event.target instanceof HTMLElement) this.revealFocus(event.target)
    })
    if (focus && !this.restoringFocus && editor.contains(document.activeElement)) this.revealFocus(document.activeElement as HTMLElement)
    this.boundModel = model
    this.boundRow = record
    this.lookupNotice = ''
    if (this.surface) editor.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') { this.cell(row, object.name)?.focus(); this.schedule() }
    })
  }

  /** the Modern editor shows its spin buttons in the field (see makeRow); the steps are the shared ones */
  protected override spinControl(input: HTMLInputElement, m: DwModel, o: DwObject, row: number): HTMLElement | null {
    return this.surface ? null : super.spinControl(input, m, o, row)
  }

  protected override placeEditor(editor: HTMLElement, cell: HTMLElement): void {
    if (!this.surface) { super.placeEditor(editor, cell); return }
    editor.removeAttribute('style')
    editor.classList.add('surface-editor')
    editor.setAttribute('aria-labelledby', cell.dataset.labelledby ?? '')
    editor.setAttribute('aria-describedby', [cell.dataset.describedby, this.status.id].filter(Boolean).join(' '))
    if (cell.dataset.required === 'true') editor.setAttribute('aria-required', 'true')
    else editor.removeAttribute('aria-required')
    if (editor instanceof HTMLTextAreaElement) {
      cell.setAttribute('role', 'group')
      cell.removeAttribute('aria-multiline')
      cell.removeAttribute('aria-readonly')
      cell.scrollTop = 0
      cell.scrollLeft = 0
    }
    if (editor instanceof HTMLSelectElement && cell.getAttribute('role') === 'button') cell.setAttribute('role', 'group')
    if (editor.getAttribute('role') === 'combobox') {
      cell.setAttribute('role', 'group')
      cell.removeAttribute('aria-haspopup')
      editor.removeAttribute('aria-label')
    }
    if (editor instanceof HTMLFieldSetElement) {
      cell.setAttribute('role', 'group')
      cell.removeAttribute('aria-description')
      editor.removeAttribute('aria-label')
    }
    if (editor instanceof HTMLInputElement && editor.type === 'checkbox') {
      if (cell.getAttribute('role') === 'checkbox') cell.setAttribute('role', 'group')
      cell.removeAttribute('aria-checked')
      cell.querySelector('.cbx')?.setAttribute('aria-hidden', 'true')
    }
    if (cell.getAttribute('role') === 'group') cell.removeAttribute('aria-required')
    cell.append(editor)
    const browse = editor === this.choiceEdit?.element ? this.choiceEdit.browse : null
    if (browse) {
      const field = this.bindings.get(cell.dataset.obj ?? '')
      browse.setAttribute('aria-label', `Browse ${field?.label || 'choice'} details`)
      browse.setAttribute('aria-describedby', this.status.id)
      cell.classList.add('surface-choice-details')
      cell.append(browse)
    }
    if (editor instanceof HTMLInputElement && this.bindings.get(cell.dataset.obj ?? '')?.spin) {
      // Up and Down step the draft in the shared editor (after its key event), as in the Classic view.
      const model = this.ctl.model!
      const object = this.bindings.get(cell.dataset.obj!)!.object
      const sync = () => this.syncSpin(editor, cell, model, object)
      sync()
      editor.addEventListener('input', sync)
      editor.addEventListener('dwtextchange', sync)
    }
  }

  protected override lookupSurface(object: DwObject): DataSurface | undefined {
    return this.presentLookup ? this.surface?.fields.find((field) => field.object === object.name)?.lookup : undefined
  }

  protected override restoreCellFocus(target: HTMLElement): void {
    const restoring = this.restoringFocus
    this.restoringFocus = true
    try { super.restoreCellFocus(target) }
    finally { this.restoringFocus = restoring }
  }

  protected override async browseChoices(editor: DwChoiceEditor): Promise<number | null> {
    if (!this.presentLookup || !editor.options?.grid || editor.signal.aborted) return null
    if (this.lookup) { this.lookup.element.focus(); return null }
    const dialog = lookupDialog(this.detailChoices(editor.options), editor.popup?.open ? editor.popup.index : editor.selectedIndex,
      editor.signal, (error) => this.ctl.rt.onError(error))
    this.lookup = dialog
    try { return await this.presentLookup(dialog) }
    finally {
      dialog.cancel()
      if (this.lookup === dialog) this.lookup = null
      if (!editor.signal.aborted && editor.element.isConnected && document.activeElement === document.body) {
        editor.element.focus({ preventScroll: true })
      }
      // The lookup was torn down because its entry could not be applied: the keyboard goes to the retained entry, never the page.
      else if (this.stale && (document.activeElement === document.body || !document.activeElement)) {
        this.root.querySelector<HTMLElement>('.surface-stale input,.surface-stale textarea')?.focus({ preventScroll: true })
      }
      if (this.lookupNotice) this.status.textContent = this.lookupNotice
    }
  }

  private syncSpin(input: HTMLInputElement, cell: HTMLElement, model: DwModel, object: DwObject): void {
    const config = numericSpin(object, model.kinds[model.colIndex(object.name)], model.overrides)
    if (config.kind !== 'number') return
    input.setAttribute('role', 'spinbutton')
    input.setAttribute('aria-valuemin', String(config.minimum))
    input.setAttribute('aria-valuemax', String(config.maximum))
    input.setAttribute('aria-description', `Up and Down adjust by ${config.increment}. Tab accepts the entry using the existing validation.`)
    const value = spinNumber(input.value)
    if (value === null) input.removeAttribute('aria-valuenow')
    else input.setAttribute('aria-valuenow', String(value))
    for (const button of cell.querySelectorAll<HTMLButtonElement>('.surface-spin-controls button')) {
      button.disabled = this.committing || !canStepNumber(input.value, config, button.dataset.direction === '-1' ? -1 : 1)
    }
  }

  /** a spin button press: the shared step of the open editor */
  private adjustDraft(model: DwModel, object: DwObject, row: number, input: HTMLInputElement, direction: -1 | 1): void {
    if (this.committing || this.stale || this.ctl.model !== model || model.rowAt(row) !== this.boundRow || this.editor !== input) return
    if (model.row !== row || model.col !== model.colIndex(object.name) + 1) {
      this.status.textContent = 'Select this field again before adjusting it; the current record or column has changed.'
      return
    }
    this.stepText(model, object, row, input, direction)
  }

  private async startStep(model: DwModel, object: DwObject, row: number, direction: -1 | 1, event: MouseEvent): Promise<void> {
    if (this.committing || this.stepping || this.stale) return
    const record = model.rowAt(row)
    const valid = () => !this.changes.signal.aborted && !this.stale && this.ctl.model === model && model.rowAt(row) === record
    this.stepping = true
    try {
      if (!valid() || !(await this.canEdit(model, object, row))) return
      const sameEditor = this.editor instanceof HTMLInputElement && this.boundModel === model &&
        this.boundRow === record && this.editRow === row && this.editObj === object.name &&
        model.row === row && model.col === model.colIndex(object.name) + 1
      if (!sameEditor) {
        if (this.editor && await this.ctl.n_accepttext() !== 1) return
        if (!valid()) throw new Error('The record changed before this adjustment. No value was changed.')
        const source = this.cell(row, object.name)
        if (!source) throw new Error('The field is no longer visible. No value was changed.')
        await this.rowClick(model, row, event, source)
        if (!valid() || model.row !== row || model.col !== model.colIndex(object.name) + 1) return
        await this.paint(model)
        if (!valid() || !(await this.canEdit(model, object, row))) return
        const cell = this.cell(row, object.name)
        if (!cell) throw new Error('The field is no longer visible. No value was changed.')
        this.edit(model, object, row, cell)
      }
      if (valid() && this.editor instanceof HTMLInputElement) this.adjustDraft(model, object, row, this.editor, direction)
    } finally {
      this.stepping = false
      this.schedule()
    }
  }

  protected override async commitValue(model: DwModel, row: number, column: number, object: DwObject, value: unknown, guard?: () => Promise<void>): Promise<DwEditResult> {
    if (!this.surface) return super.commitValue(model, row, column, object, value, guard)
    this.committing = true
    const record = this.boundRow
    const editText = this.captureEditText(value)
    let result: DwEditResult = 'rejected'
    // The record, the layout or the field's configuration changed while the entry was validated (the shared guard, or this view's
    // own check): the typed text is kept in the recovery panel, as the Classic view keeps it, never reopened into a changed field.
    let configurationChanged = false
    try {
      if (this.ctl.model !== model || model.rowAt(row) !== record) {
        this.retainStaleDraft(toStr(value))
        return 'rejected'
      }
      // The same acceptance as the Classic view: ItemChanged decides; a script that protects the field (or disables the
      // control) while accepting it does not undo an accepted entry.
      result = await commitDwValue(this.ctl, model, row, column, object, value, async () => {
        try { await guard?.() } catch (error) { configurationChanged = true; throw error }
        if (this.changes.signal.aborted || this.ctl.model !== model || model.rowAt(row) !== record || model.colIndex(object.name) !== column) {
          configurationChanged = true
          throw new Error('The record or layout changed during validation. The entry was not written to the data model.')
        }
      })
      if (result === 'accepted') this.status.textContent = 'Ready'
      if (result === 'discarded') this.status.textContent = 'The entry was rejected. The stored value was not replaced.'
      // A rejected entry reopens on its field through the shared editor (when the field is still the current one).
      if (result === 'rejected') this.status.textContent = 'The entry was not accepted. Correct it or press Escape to cancel the edit.'
      return result
    } catch (error) {
      // A script error during validation rejects the entry, as in the Classic view; the editor reopens with the text.  A changed
      // configuration keeps the text in the recovery panel instead (see above).
      result = 'rejected'
      if (configurationChanged && !this.changes.signal.aborted && !this.stale) this.retainStaleDraft(editText())
      this.ctl.rt.onError(error)
      if (!this.stale) this.status.textContent = 'The entry was not accepted. Correct it or press Escape to cancel the edit.'
      return 'rejected'
    } finally {
      this.committing = false
      this.replayDeferredEdit(result)
    }
  }

  /** a script's focus request held during validation: the editor opens where the script asked */
  private replayDeferredEdit(result: DwEditResult): void {
    const deferred = this.deferredEdit
    this.deferredEdit = null
    if (!deferred || this.stale || this.changes.signal.aborted || this.ctl.model !== deferred.model || deferred.model.row !== deferred.row) return
    // A rejected entry keeps the focus: it reopens on its own field with the typed text.
    if (result === 'rejected') return
    if (this.editor && this.editor !== this.choiceEdit?.element) return
    const object = deferred.model.def.objects.find((item) => item.name === deferred.object)
    const target = this.cell(deferred.row, deferred.object)
    if (object && target) this.edit(deferred.model, object, deferred.row, target, deferred.activate)
  }

  private staleValue = ''

  protected override retainStaleDraft(value: string): void {
    if (this.changes.signal.aborted) return
    // The keyboard belongs to this DataWindow while it is in its editor, its drop-down list or its lookup browser (both outside
    // the root): the notice takes it then, before the picker is torn down and could hand it elsewhere.
    const focus = document.activeElement
    const owned = this.ownsKeyboard() || !!focus && (!!this.choiceEdit?.element.contains(focus) ||
      !!this.choiceEdit?.popup?.list.contains(focus) || !!this.lookup?.element.contains(focus))
    this.cancelChoice()
    this.detachTextEditor()
    this.stale = true
    this.staleValue = value
    this.editor = null
    this.acceptEdit = null
    this.showStaleDraft(owned)
  }

  private showStaleDraft(owned?: boolean): void {
    const focused = owned ?? this.ownsKeyboard()
    this.editor = null
    this.acceptEdit = null
    this.root.classList.add('modern-surface')
    const notice = document.createElement('div')
    notice.className = 'surface-stale'
    const message = document.createElement('p')
    message.setAttribute('role', 'alert')
    message.textContent = 'Editing was interrupted because the record, layout or validation changed. Review the current record before continuing. This entry is retained for copying.'
    const label = document.createElement('label')
    label.textContent = 'Unapplied entry'
    const input = /[\r\n]/.test(this.staleValue) ? document.createElement('textarea') : document.createElement('input')
    if (input instanceof HTMLTextAreaElement) input.rows = 4
    input.readOnly = true
    input.value = this.staleValue
    label.append(input)
    const button = document.createElement('button')
    button.textContent = 'Discard unapplied entry and use current layout'
    button.onclick = () => {
      this.discardInputEvents()
      this.stale = false
      this.staleValue = ''
      this.boundModel = null
      this.schedule()
    }
    notice.append(message, label, button)
    this.root.replaceChildren(notice)
    // The notice takes the keyboard only from this DataWindow, never from another control or window.
    if (focused) input.focus()
  }
}
