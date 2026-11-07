import { DwCatalog } from './src/dw/def.js'
import { DwModel } from './src/dw/model.js'
import { NDwBase } from './src/runtime/native/dwctrl.js'
import { PBDate, PBDateTime } from './src/runtime/values.js'

// Real selector metadata with synthetic buffers only. No invoice changes,
// customer permissions, stock maintenance or persistence are executed.
export async function checkSelectorVariants(fixture, check, settle) {
  const source = await (await fetch('./presentation-selector-variants.json')).json()
  const rt = fixture.rt, modern = fixture.session.activeMode === 'modern'
  const original = fixture.ui.views.get(fixture.sale).ctlViews.get(fixture.sale.children.get('dw_grid')).dw
  let current
  const key = (input, key) => input.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
  const type = (input, text) => {
    input.value = text
    input.dispatchEvent(new InputEvent('input', { bubbles: true }))
  }
  const open = async (name = 'd_change_purinv', extraChoices = 0) => {
    if (current) await current.close()
    const old = { catalog: rt.dwCatalog, fire: rt.fire }
    const catalog = new DwCatalog(async () => undefined)
    catalog.get = async (name) => source[name] ? structuredClone(source[name]) : undefined
    rt.dwCatalog = catalog
    const host = document.createElement('div')
    host.className = 'selector-variant-preview'
    host.style.cssText = 'position:fixed;inset:72px 16px auto;max-width:900px;height:min(450px,calc(100vh - 88px));z-index:500'
    document.body.append(host)
    const control = new NDwBase(rt, 'dw_selector_variant')
    control.parent = fixture.sale
    const view = new original.constructor(control, host)
    const model = new DwModel(rt, name, structuredClone(source[name]))
    model.insertRow(0)
    if (model.colIndex('code') >= 0) model.setItem(1, 'code', 901)
    if (model.colIndex('name') >= 0) model.setItem(1, 'name', 'Synthetic category')
    if (name === 'd_change_purinv') {
      model.setItem(1, 'date', new PBDateTime(PBDate.ymd(2026, 11, 6).n, 0))
      model.setItem(1, 'creditdays', 7)
      model.setItem(1, 'supplier', 'Synthetic supplier')
      model.setItem(1, 'purinvpagesize', 'F')
    }
    const toggles = model.def.objects.filter((object) => object['checkbox.on'] !== undefined).map((object) => object.name)
    for (const column of toggles) model.setItem(1, column, 'N')
    const column = toggles[0] ?? 'purinvpagesize'
    model.row = 1; model.col = model.colIndex(column) + 1
    const state = { reject: false, correct: '', handled: false }, events = []
    rt.fire = async (target, event, args = []) => {
      if (target !== control) return old.fire(target, event, args)
      events.push({ event, args })
      if (event === 'itemerror') return 1
      if (event === 'itemchanged') return state.reject ? 1 : 0
      if (event === 'ue_dwnkey' && state.handled) return 1
      if (event === 'editchanged' && state.correct) await control.n_settext(state.correct)
      return 0
    }
    control.attach(model)
    for (const object of model.def.objects.filter((object) => object['dddw.name'])) {
      const child = await control.n_getchild(object.name)
      await child.ready
      for (let code = 901; code <= 902 + extraChoices; code++) {
        const row = child.model.insertRow(0)
        child.model.setItem(row, object['dddw.datacolumn'], code)
        child.model.setItem(row, object['dddw.displaycolumn'], `Synthetic choice ${code}`)
      }
      model.setItem(1, object.name, 901)
    }
    await settle()
    const cell = (field = column) => view.root.querySelector(`[data-row="1"] [data-obj="${field}"]`)
    const edit = async (field = column) => {
      model.col = model.colIndex(field) + 1
      await view.focusCurrent()
      await settle()
      if (!view.editor) throw new Error(`Missing selector editor: ${field}`)
      return view.editor
    }
    const close = async () => {
      if (current !== f) return
      view.dispose(); control.destroy(); host.remove()
      rt.dwCatalog = old.catalog; rt.fire = old.fire
      current = null
      await settle()
    }
    const f = { name, host, control, view, model, column, toggles, cell, edit, close, state, events }
    current = f
    return f
  }
  try {
    const f = await open()
    const dueField = f.model.def.objects.find((object) => object.name === 'c_duedate')
    check(dueField.expression === 'relativedate(date,  creditdays )' && dueField.format === 'dd/mm/yyyy hh:mm',
      'The purchase due-date calculation and mixed display mask remain exactly as recovered')
    const originalDate = f.model.getItem(1, 'date')
    for (const [days, day] of [[7, 13], [14, 20]]) {
      f.model.setItem(1, 'creditdays', days); f.control.changed(); await settle()
      const dueDate = await f.model.getValue(1, 'c_duedate')
      const cell = f.cell('c_duedate')
      check(dueDate instanceof PBDate && dueDate.n === PBDate.ymd(2026, 11, day).n &&
        (cell.querySelector('.surface-value') ?? cell).textContent.trim() === `${day}/11/2026 ??:??` &&
        f.model.getItem(1, 'date') === originalDate,
      'Both presentations show the native missing-time markers without changing the invoice timestamp or due-date type')
    }
    f.model.setItem(1, 'creditdays', 7); f.control.changed(); await settle()
    const purchaseType = await f.control.n_getchild('purtypecode')
    for (let code = 903; code <= 912; code++) {
      const row = purchaseType.model.insertRow(0)
      purchaseType.model.setItem(row, 'purtypecode', code)
      purchaseType.model.setItem(row, 'name', `Type ${code}`)
    }
    const childState = JSON.stringify([purchaseType.model.row, purchaseType.model.col, purchaseType.model.buf])
    let input = await f.edit('purtypecode')
    check(input.readOnly && input.getAttribute('role') === 'combobox' && !f.view.choiceEdit.popup.open,
      'The real five-line purchase type uses a readonly popup even without an explicit width')
    key(input, 'F4'); await settle()
    key(input, 'PageDown'); await settle()
    const purchaseKey = f.view.choiceEdit.options.items[f.view.choiceEdit.popup.index].value
    check(purchaseKey !== 901 && f.model.getItem(1, 'purtypecode') === 901 &&
      JSON.stringify([purchaseType.model.row, purchaseType.model.col, purchaseType.model.buf]) === childState,
    'Paging a source line-limited readonly lookup changes neither the parent key nor the child buffer and cursor')
    key(input, 'Enter'); await settle()
    check(f.model.getItem(1, 'purtypecode') === purchaseKey && !f.view.editor,
      'The source line-limited purchase type accepts its highlighted data key once')
    input = await f.edit('icatcode')
    const lookupBox = input.getBoundingClientRect()
    const popupBox = f.view.choiceEdit.popup.list.getBoundingClientRect()
    check(f.view.choiceEdit.popup.open && Math.abs(popupBox.width - Math.min(lookupBox.width * 2.5, innerWidth - 8)) < 1 &&
      popupBox.left >= 4 && popupBox.right <= innerWidth - 4,
    'The purchase department lookup uses its source 250% width and stays within the viewport')
    key(input, 'Escape'); await settle()
    key(input, 'Escape'); await settle()
    input = await f.edit()
    check(input.getAttribute('role') === 'combobox' && !input.readOnly && input.value === 'Full' &&
      await f.control.n_gettext() === 'Full' && f.model.getItem(1, f.column) === 'F',
    'Editable DDLB starts with its display label while retaining the original stored code')
    if (modern) check(f.view.root.querySelectorAll('[data-row="1"] .surface-field').length === 13 &&
      !f.view.root.querySelector('[data-obj=porb]'), 'The purchase grid preserves all thirteen source fields and its hidden key')
    for (const [text, expected] of [['Half', 'H'], ['X', 'X'], ['', null]]) {
      type(input, text); await settle()
      check(await f.control.n_accepttext() === 1 && f.model.getItem(1, f.column) === expected,
        'Editable DDLB resolves exact labels, permits valid freeform keys and retains NilIsNull')
      input = await f.edit()
    }
    type(input, 'Too long'); await settle()
    check(await f.control.n_accepttext() === -1 && f.model.getItem(1, f.column) === null &&
      input.getAttribute('aria-invalid') === 'true' && await f.control.n_gettext() === 'Too long',
    'Overlong freeform code-table text remains copyable and cannot bypass the column schema')
    f.state.reject = true
    type(input, 'Quarter'); await settle()
    check(await f.control.n_accepttext() === -1 && input.value === 'Quarter' && f.model.getItem(1, f.column) === null,
      'Original ItemChanged rejection retains the typed label without applying its key')
    f.control.changed(); await settle()
    check(f.view.editor === input && input.value === 'Quarter', 'Rejected editable DDLB text survives a redraw')
    f.state.reject = false
    f.state.correct = 'Half'
    type(input, 'Correct me'); await settle()
    check(input.value === 'Half' && await f.control.n_gettext() === 'Half',
      'Original SetText corrections reach the same live editable DDLB')
    f.state.correct = ''
    check(await f.control.n_accepttext() === 1 && f.model.getItem(1, f.column) === 'H',
      'A corrected code-table display label commits its original key')
    input = await f.edit()
    f.state.handled = true
    key(input, 'ArrowDown'); await settle()
    check(!f.view.choiceEdit.popup.open, 'Original key handling can veto editable DDLB popup navigation')
    f.state.handled = false
    key(input, 'ArrowDown'); await settle()
    check(f.view.choiceEdit.popup.open && f.model.getItem(1, f.column) === 'H',
      'Browsing editable DDLB options does not prematurely change the invoice buffer')
    key(input, 'Escape'); await settle()
    input.dispatchEvent(new CompositionEvent('compositionstart'))
    type(input, 'Composition')
    f.control.changed(); await settle()
    check(f.view.editor === input && !await f.view.acceptPendingEdit() && input.value === 'Composition',
      'Editable DDLB preserves IME ownership and blocks acceptance during composition')
    input.dispatchEvent(new CompositionEvent('compositionend')); await settle()
    key(input, 'Escape'); await settle()
    check(!f.view.editor && f.model.getItem(1, f.column) === 'H', 'Escape discards only the unaccepted code-table draft')
    input = await f.edit()
    type(input, 'Unapplied'); await settle()
    f.model.modify('purinvpagesize.ddlb.allowedit=no')
    f.control.changed(); await settle()
    check(await f.control.n_accepttext() === -1 &&
      f.view.root.querySelector('.surface-stale input,.dw-recovery textarea')?.value === 'Unapplied',
    'Changing the live DDLB input policy retains a copyable draft instead of accepting it under different rules')
    await f.close()

    for (const name of ['d_customer_category', 'd_stockleder_inputs']) {
      const f = await open(name)
      if (name === 'd_customer_category') {
        const input = await f.edit('customersegmentcode')
        check(input.readOnly && input.value === 'Synthetic choice 901' && !f.view.choiceEdit.popup.open &&
          await f.control.n_gettext() === '901', 'Source readonly segment lookup keeps labels and keys separate without opening on focus')
        f.view.choiceEdit.popup.button.click(); await settle()
        const field = input.getBoundingClientRect(), list = f.view.choiceEdit.popup.list.getBoundingClientRect()
        check(f.view.choiceEdit.popup.open && Math.abs(list.width - Math.min(field.width, innerWidth - 8)) < 1,
          'The real segment lookup applies its declared 100% popup width in both presentations')
        key(input, 'ArrowDown'); await settle()
        check(f.model.getItem(1, 'customersegmentcode') === 901 && await f.control.n_gettext() === '901',
          'Readonly segment exploration does not apply the highlighted child key')
        key(input, 'Enter'); await settle()
        check(f.model.getItem(1, 'customersegmentcode') === 902 && !f.view.editor &&
          f.events.filter((event) => event.event === 'itemchanged').length === 1,
        'Readonly segment acceptance writes one original child key and closes the editor')
      }
      for (const column of f.toggles) {
        const caption = f.cell(column).querySelector('.dw-checkbox-caption')
        const marker = f.cell(column).querySelector('.cbx')
        check(!!(caption.compareDocumentPosition(marker) & Node.DOCUMENT_POSITION_FOLLOWING) &&
          caption.textContent === f.model.def.objects.find((object) => object.name === column)['checkbox.text'],
        'Left-text checkboxes preserve the exact source caption before the marker')
        const input = await f.edit(column)
        check(input.type === 'checkbox' && !input.checked && !input.indeterminate && document.activeElement === input,
          'The left-text checkbox uses one focusable native editor with the source off key')
        f.state.reject = true
        check(!await f.view.choiceEdit.choose(1) && f.model.getItem(1, column) === 'N' &&
          input.checked && input.getAttribute('aria-invalid') === 'true',
        'Rejected left-text changes keep the proposed state visible without overwriting the accepted key')
        f.control.changed(); await settle()
        check(f.view.editor === input && input.checked, 'Left-text checkbox repaint preserves the same rejected editor')
        key(input, 'Escape'); await settle()
        f.state.reject = false
        const before = f.events.filter((event) => event.event === 'itemchanged').length
        f.cell(column).click(); await settle()
        check(f.model.getItem(1, column) === 'Y' &&
          f.events.filter((event) => event.event === 'itemchanged').length === before + 1,
        'A left-text field click performs exactly one original-key change')
        f.cell(column).click(); await settle()
        check(f.model.getItem(1, column) === 'N' &&
          f.events.filter((event) => event.event === 'itemchanged').length === before + 2,
        'A second click toggles once rather than undoing itself')
        f.model.setItem(1, column, null); f.control.changed(); await settle()
        const mixed = await f.edit(column)
        check(mixed.indeterminate && f.model.getItem(1, column) === null, 'Unrecognized checkbox keys are not silently converted to off')
        check(await f.view.choiceEdit.choose(0) && f.model.getItem(1, column) === 'N',
          'Explicit selection resolves an unknown checkbox key through normal validation')
        f.model.modify(`${column}.protect=1`); f.control.changed(); await settle()
        f.cell(column).click(); await settle()
        check(!f.view.editor && !f.cell(column).classList.contains('editable') && f.model.getItem(1, column) === 'N',
          'Live source protection prevents left-text checkbox activation')
      }
      await f.close()
    }
    const windowed = await open('d_customer_category', 1000)
    const segment = await windowed.control.n_getchild('customersegmentcode')
    const segmentState = JSON.stringify([segment.model.row, segment.model.col, segment.model.buf])
    input = await windowed.edit('customersegmentcode')
    key(input, 'F4'); await settle()
    key(input, 'End'); await settle()
    check(windowed.view.choiceEdit.popup.index === 1001 && windowed.view.choiceEdit.popup.options.size <= 40 &&
      windowed.model.getItem(1, 'customersegmentcode') === 901 &&
      JSON.stringify([segment.model.row, segment.model.col, segment.model.buf]) === segmentState,
    'Virtual readonly navigation preserves the entire real child buffer and its original cursor')
    key(input, 'Enter'); await settle()
    check(windowed.model.getItem(1, 'customersegmentcode') === 1902 &&
      windowed.events.filter(event => event.event === 'itemchanged').length === 1 && !windowed.view.editor,
    'The real virtual segment lookup accepts its distant original key through one guarded change')
    await windowed.close()
    for (const [property, value] of [['percentwidth', 200], ['lines', 5]]) for (const repaint of [false, true]) {
      const resized = await open('d_customer_category', 150)
      const input = await resized.edit('customersegmentcode')
      key(input, 'F4'); await settle()
      await resized.control.n_settext('902')
      resized.model.modify(`customersegmentcode.dddw.${property}=${value}`)
      resized.control.changed()
      if (repaint) await settle()
      check(await resized.control.n_accepttext() === -1 &&
        resized.model.getItem(1, 'customersegmentcode') === 901 &&
        resized.view.root.querySelector('.surface-stale input,.dw-recovery textarea')?.value === '902',
      `A source ${property} policy change retains the pending readonly key before or after repaint instead of accepting it under a different binding`)
      await resized.close()
    }
  } finally {
    if (current) await current.close()
  }
  if (modern) window.openSelectorVariantPreview = async (name) => {
    window.selectorVariantPreview = await open(name)
    return true
  }
}
