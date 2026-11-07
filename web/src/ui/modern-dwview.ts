import { DwView } from './dwview.ts'
import { DATA_SURFACES, dataSurfaceIssues } from './data-surfaces.ts'
import type { DataSurface, DataSurfaceField } from './data-surfaces.ts'
import type { NDwBase } from '../runtime/native/dwctrl.ts'
import type { DwModel, DwRow } from '../dw/model.ts'
import type { DwObject } from '../dw/def.ts'
import { toStr } from '../runtime/values.ts'
import { commitDwValue, dwRequired } from '../dw/edit.ts'
import type { DwEditResult } from '../dw/edit.ts'
import { numericSpin, spinNumber, stepNumber, canStepNumber } from './numeric-spin.ts'
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
  private bindings = new Map<string, { label: string; object: DwObject; suffix?: DwObject; numeric: boolean; spin: NumericSpin | null; choice: boolean; toggle: boolean; radio: boolean; multiline: boolean }>()
  private navigation: { model: DwModel; row: number; column: number; name: string } | null = null
  private columnSelected = false
  private boundModel: DwModel | null = null
  private boundRow: DwRow | undefined
  private previousRow = 0
  private rovingRow = 1
  private start = 0
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
      if (!this.discardUnchangedTextEditor()) this.retainStaleDraft(draft.value)
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
      const start = Math.max(0, Math.floor(this.root.scrollTop / this.rowHeight) - 5)
      if (start !== this.start) this.schedule()
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

  private async label(model: DwModel, field: DataSurfaceField, row: number): Promise<string> {
    const external = this.contextSurface?.name === model.name ? this.contextLabels.get(field.object) : null
    if (external) return external.textContent?.trim() || field.label || ''
    const object = model.def.objects.find((item) => item.name.toLowerCase() === field.labelObject)
    const text = object ? await this.prop(model, object, 'text', row, object.band) : field.label ?? ''
    return text.replace(/&&/g, '\0').replace(/&/g, '').replace(/\0/g, '&').trim() || field.label || ''
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
      if (!this.discardUnchangedTextEditor()) this.retainStaleDraft(draft.value)
      else this.schedule()
      return
    }
    const surface = this.contextSurface?.name === model.name ? this.contextSurface : DATA_SURFACES.find((item) => item.name === model.name)
    const issues = surface ? dataSurfaceIssues(model.def, surface, model.overrides) : []
    const preview = /^(yes|true|1)$/i.test(model.describe('datawindow.print.preview'))
    const modern = !!surface && !issues.length && !preview
    if (draft && !!this.surface !== modern) { this.retainStaleDraft(draft.value); return }
    if (draft && modern) {
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
    this.rowHeight = Math.ceil(parseFloat(getComputedStyle(this.root).fontSize) * (this.root.dataset.density === 'comfortable' ? 3 : 2.5))
    this.root.style.setProperty('--surface-row-height', `${this.rowHeight}px`)
    const scroll = this.root.scrollTop
    const left = this.root.scrollLeft
    let start = surface.kind === 'grid' ? Math.max(0, Math.floor(scroll / this.rowHeight) - 5) : 0
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
      const spin = numericSpin(object, model.kinds[model.colIndex(field.object)], model.overrides)
      this.bindings.set(field.object, {
        object, label: await this.label(model, field, Math.max(1, model.row)),
        suffix: field.suffixObject ? model.def.objects.find((object) => object.name.toLowerCase() === field.suffixObject) : undefined,
        numeric: field.numeric ?? (!field.choice && ['number', 'decimal'].includes(model.kinds[model.colIndex(field.object)])),
        spin: spin.kind === 'number' ? spin : null,
        choice: !!field.choice,
        toggle: field.choice?.kind === 'checkbox',
        radio: field.choice?.kind === 'radio',
        multiline: !!field.multiline,
      })
    }
    const body = document.createElement('div')
    body.className = surface.kind === 'grid' ? 'surface-body surface-body-grid' : 'surface-body'
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
      table.setAttribute('aria-rowcount', String(count + 1))
      table.setAttribute('aria-colcount', String(this.bindings.size))
      const head = table.createTHead().insertRow()
      head.setAttribute('aria-rowindex', '1')
      for (const [name, field] of this.bindings) {
        const th = document.createElement('th')
        th.scope = 'col'
        const label = document.createElement('span')
        label.id = `${this.identity}-${name}-heading`
        label.textContent = field.label
        th.append(label)
        if (dwRequired(field.object, model.overrides)) th.append(this.requiredHint(`${this.identity}-${name}-required`))
        if (field.numeric) th.classList.add('surface-number')
        if (field.spin) th.classList.add('surface-spin-heading')
        head.append(th)
      }
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
      for (const row of [...visible].sort((a, b) => a - b)) {
        spacer(row - previous - 1)
        rows.append(await this.makeRow(model, row, true))
        previous = row
      }
      spacer(count - previous)
      body.append(table)
    }
    for (const band of surface.bands ?? []) {
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
    this.root.scrollTop = jumped ? start * this.rowHeight : scroll
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

  private async makeTotals(model: DwModel, band: NonNullable<DataSurface['bands']>[number]): Promise<HTMLElement | null> {
    const section = document.createElement('section')
    section.className = `surface-band surface-band-${band.band}`
    section.dataset.surfaceBand = band.band
    section.setAttribute('aria-label', band.label)
    const values = document.createElement('dl')
    const row = Math.max(1, model.rowCount())
    for (const field of band.fields) {
      const object = model.def.objects.find((item) => item.name.toLowerCase() === field.object)!
      const value = await this.object(model, object, row, band.band, (n) => n, (n) => n, null)
      const labelObject = model.def.objects.find((item) => item.name.toLowerCase() === field.labelObject)
      const sourceLabel = labelObject ? await this.object(model, labelObject, row, band.band, (n) => n, (n) => n, null) : null
      if (!value && !sourceLabel) continue
      const item = document.createElement('div')
      const label = document.createElement('dt')
      label.id = `${this.identity}-${band.band}-${field.object}-label`
      label.textContent = sourceLabel?.textContent ?? (labelObject ? '' : field.label ?? '')
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
        value.tabIndex = 0
        value.addEventListener('focus', () => { if (!this.restoringFocus) this.revealFocus(value) })
        result.append(value)
        item.append(result)
      }
      values.append(item)
    }
    if (!values.children.length) return null
    section.append(values)
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
      element.setAttribute('aria-rowindex', String(row + 1))
      element.setAttribute('aria-selected', String(!!model.rowAt(row)?.sel))
    }
    else element.setAttribute('aria-label', `${this.surface!.title}, row ${row}`)
    if (model.rowAt(row)?.sel) element.classList.add('sel')
    if (model.row === row) element.classList.add('cur')
    element.addEventListener('mousedown', (event) => {
      if (!this.committing) void this.rowClick(model, row, event).catch((error) => this.ctl.rt.onError(error))
    })
    element.addEventListener('dblclick', () => {
      if (!this.committing) void this.ctl.rt.fire(this.ctl, 'doubleclicked', [0, 0, row, { name: '' }]).catch((error) => this.ctl.rt.onError(error))
    })
    const grouped = new Map<string, HTMLElement>()
    for (const group of this.surface!.groups ?? []) {
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
    for (const [name, field] of this.bindings) {
      await appendSeparator(name)
      const container = grouped.get(name) ?? element
      const wrapper = document.createElement(grid ? 'td' : 'div')
      wrapper.className = 'surface-field'
      if (grid) wrapper.setAttribute('role', 'presentation')
      const external = !grid && this.surface === this.contextSurface ? this.contextLabels.get(name) : null
      const labelId = grid ? `${this.identity}-${name}-heading` : external?.id || `${this.identity}-${row}-${name}-label`
      if (external && this.contextLabels.size > 1) wrapper.append(external)
      if (!grid && !external?.id) {
        const label = document.createElement('span')
        label.id = labelId
        label.className = 'surface-label'
        label.textContent = field.label
        wrapper.append(label)
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
        const text = await this.prop(model, field.suffix, 'text', row, 'detail')
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
          hint.className = 'surface-help'
          hint.textContent = 'Shift+Enter adds a line. Enter keeps the form action.'
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
      value.addEventListener('keydown', (event) => {
        if (event.target !== value || this.committing) return
        const fields = [...this.bindings.keys()]
        const index = fields.indexOf(name)
        let targetRow = row
        let targetName = name
        if (event.key === 'ArrowDown') targetRow++
        else if (event.key === 'ArrowUp') targetRow--
        else if (event.key === 'ArrowRight') targetName = fields[Math.min(index + 1, fields.length - 1)]
        else if (event.key === 'ArrowLeft') targetName = fields[Math.max(index - 1, 0)]
        else if (event.key === 'Home') targetName = fields[0]
        else if (event.key === 'End') targetName = fields.at(-1)!
        else if (event.key === 'Enter' || event.key === 'F2' || event.key === ' ' && field.choice) {
          event.preventDefault()
          void this.rowClick(model, row, new MouseEvent('mousedown'), value).then(() => {
            const cell = this.cell(row, name)
            if (enabled && cell && this.ctl.model === model && model.row === row && model.col === model.colIndex(name) + 1) {
              this.edit(model, field.object, row, cell, event.key === ' ' && field.toggle)
            }
          }).catch((error) => this.ctl.rt.onError(error))
          return
        } else return
        if (!grid) return
        event.preventDefault()
        if (targetRow < 1 || targetRow > model.rowCount()) return
        void this.moveTo(model, targetRow, targetName).catch((error) => this.ctl.rt.onError(error))
      })
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
    return element
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

  override async tabNext(direction: number): Promise<void> {
    if (!this.surface) return super.tabNext(direction)
    const model = this.ctl.model
    if (!model || !model.rowCount() || this.stale) return
    const columns = [...this.bindings.values()]
    const ordered = await Promise.all(columns.map(async ({ object }) => ({
      object, sequence: Number(await this.prop(model, object, 'tabsequence', model.row, object.band)),
    })))
    ordered.sort((a, b) => a.sequence - b.sequence)
    const current = model.colNames[model.col - 1]
    let row = Math.max(1, model.row)
    let index = ordered.findIndex(({ object }) => object.name.toLowerCase() === current)
    for (let steps = 0; steps < model.rowCount() * ordered.length; steps++) {
      index += direction
      if (index >= ordered.length) { index = 0; row++ }
      if (index < 0) { index = ordered.length - 1; row-- }
      if (row < 1 || row > model.rowCount()) break
      const object = ordered[index].object
      if (!(await this.canEdit(model, object, row))) continue
      if (!(await this.moveTo(model, row, object.name))) return
      const target = this.cell(row, object.name)
      if (target) this.edit(model, object, row, target)
      return
    }
    const outside = [...document.querySelectorAll<HTMLElement>('input,button,select,textarea,[tabindex]')]
      .filter((element) => !this.root.contains(element) && element.tabIndex >= 0
        && !element.matches(':disabled') && element.getClientRects().length > 0)
    const following = outside.filter((element) => !!(this.root.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING))
    const preceding = outside.filter((element) => !!(this.root.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_PRECEDING))
    const next = direction > 0 ? following[0] ?? outside[0] : preceding.at(-1) ?? outside.at(-1)
    if (next) next.focus()
    else { this.root.tabIndex = 0; this.root.focus() }
  }

  protected override edit(model: DwModel, object: DwObject, row: number, cell: HTMLElement, activate: boolean | number = false, focus = true): void {
    if (this.stale || this.changes.signal.aborted || this.ctl.model !== model) return
    if (this.choiceDestination) { super.edit(model, object, row, cell, activate, focus); return }
    if (this.committing) return
    if (this.surface && this.editor && this.boundModel === model && this.boundRow === model.rowAt(row)
      && this.editRow === row && this.editObj === object.name) {
      this.editor.focus({ preventScroll: true })
      if (activate !== false) void this.choiceEdit?.activate(activate).catch((error) => this.ctl.rt.onError(error))
      return
    }
    if (this.choiceEdit && this.editor === this.choiceEdit.element) {
      super.edit(model, object, row, cell, activate, focus)
      return
    }
    this.boundModel = model
    this.boundRow = model.rowAt(row)
    this.lookupNotice = ''
    if (!this.surface) { super.edit(model, object, row, cell, activate, focus); return }
    if (!cell.classList.contains('editable') || this.ctl.props.get('enabled') === false) return
    super.edit(model, object, row, cell, activate, focus)
    this.editor?.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') { this.cell(row, object.name)?.focus(); this.schedule() }
    })
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
      const model = this.ctl.model!
      const object = this.bindings.get(cell.dataset.obj!)!.object
      const row = Number(cell.closest<HTMLElement>('[data-row]')?.dataset.row)
      const revision = this.revision
      const sync = () => this.syncSpin(editor, cell, model, object)
      sync()
      editor.addEventListener('input', sync)
      editor.addEventListener('dwtextchange', sync)
      editor.addEventListener('keydown', (event) => {
        if (!['ArrowUp', 'ArrowDown'].includes(event.key) || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
        const spin = numericSpin(object, model.kinds[model.colIndex(object.name)], model.overrides)
        if (spin.kind === 'none') return
        event.preventDefault()
        if (revision !== this.revision) {
          this.status.textContent = 'The layout changed. Try the adjustment again after it refreshes.'
          return
        }
        this.adjustDraft(model, object, row, editor, event.key === 'ArrowUp' ? 1 : -1)
        // The shared editor still dispatches the original ue_dwnkey exactly once.
      })
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
    const dialog = lookupDialog(editor.options, editor.popup?.open ? editor.popup.index : editor.selectedIndex,
      editor.signal, (error) => this.ctl.rt.onError(error))
    this.lookup = dialog
    try { return await this.presentLookup(dialog) }
    finally {
      dialog.cancel()
      if (this.lookup === dialog) this.lookup = null
      if (!editor.signal.aborted && editor.element.isConnected && document.activeElement === document.body) {
        editor.element.focus({ preventScroll: true })
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

  private adjustDraft(model: DwModel, object: DwObject, row: number, input: HTMLInputElement, direction: -1 | 1): void {
    if (this.committing || this.stale || this.ctl.model !== model || model.rowAt(row) !== this.boundRow || this.editor !== input) return
    if (model.row !== row || model.col !== model.colIndex(object.name) + 1) {
      this.status.textContent = 'Select this field again before adjusting it; the current record or column has changed.'
      return
    }
    const config = numericSpin(object, model.kinds[model.colIndex(object.name)], model.overrides)
    if (config.kind === 'none') return
    if (config.kind === 'unsupported') {
      this.status.textContent = config.reason
      return
    }
    const value = stepNumber(input.value, config, direction)
    if (value === null) {
      this.status.textContent = 'Enter a valid number before using Increase or Decrease. The entry has not been changed.'
      input.setAttribute('aria-invalid', 'true')
      return
    }
    input.value = value
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.focus({ preventScroll: true })
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
    try {
      if (this.ctl.model !== model || model.rowAt(row) !== record) {
        this.retainStaleDraft(toStr(value))
        return 'rejected'
      }
      if (!(await this.canEdit(model, object, row))) throw new Error('This field is no longer editable. The entry was not applied.')
      const result = await commitDwValue(this.ctl, model, row, column, object, value, async () => {
        await guard?.()
        if (this.changes.signal.aborted || this.ctl.model !== model || model.rowAt(row) !== record || model.colIndex(object.name) !== column) {
          throw new Error('The record or layout changed during validation. The entry was not written to the data model.')
        }
        if (!(await this.canEdit(model, object, row))) throw new Error('This field is no longer editable. The entry was not applied.')
      })
      if (result === 'accepted') this.status.textContent = 'Ready'
      if (result === 'discarded') this.status.textContent = 'The entry was rejected. The stored value was not replaced.'
      if (result === 'rejected') {
        const text = editText()
        this.status.textContent = 'The entry was not accepted. Correct it or press Escape to cancel the edit.'
        this.committing = false
        const cell = this.cell(row, object.name)
        if (cell) {
          this.edit(model, object, row, cell)
          this.restoreRejectedText(text)
        }
      }
      return result
    } catch (error) {
      if (!this.changes.signal.aborted) this.retainStaleDraft(editText())
      this.ctl.rt.onError(error)
      return 'rejected'
    } finally {
      this.committing = false
    }
  }

  private staleValue = ''

  protected override retainStaleDraft(value: string): void {
    if (this.changes.signal.aborted) return
    this.cancelChoice()
    this.detachTextEditor()
    this.stale = true
    this.staleValue = value
    this.editor = null
    this.acceptEdit = null
    this.showStaleDraft()
  }

  private showStaleDraft(): void {
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
    input.focus()
  }
}
