import { DwCatalog } from './src/dw/def.js'
import { DwModel } from './src/dw/model.js'
import { NDwBase } from './src/runtime/native/dwctrl.js'

// Recovered presentation definitions with synthetic records and controlled
// validation/loading boundaries; no email, pricing or database operations.
export async function checkAutomaticChoices(fixture, check, settle) {
  const source = await (await fetch('./presentation-automatic-choices.json')).json()
  const rt = fixture.rt, modern = fixture.session.activeMode === 'modern'
  const original = fixture.ui.views.get(fixture.sale).ctlViews.get(fixture.sale.children.get('dw_grid')).dw
  let current
  const key = (input, key, options = {}) => input.dispatchEvent(new KeyboardEvent('keydown',
    { key, bubbles: true, cancelable: true, ...options }))
  const open = async (kind = 'lookup', options = {}) => {
    if (current) await current.close()
    const old = { catalog: rt.dwCatalog, fire: rt.fire, error: rt.onError }
    const catalog = new DwCatalog(async () => undefined)
    catalog.get = async (name) => source[name] ? structuredClone(source[name]) : undefined
    rt.dwCatalog = catalog
    const host = document.createElement('div')
    host.className = 'automatic-choice-preview'
    host.style.cssText = 'position:fixed;inset:72px 16px auto;max-width:560px;height:300px;z-index:500'
    document.body.append(host)
    const control = new NDwBase(rt, 'dw_automatic_choices')
    control.parent = fixture.sale
    const view = new original.constructor(control, host, original.presentLookup)
    const name = kind === 'list' ? 'd_changeitem_price_marginbased' : kind === 'editable' ? 'd_emailsubject' : 'd_arg_genericitemtype'
    const column = kind === 'list' ? 'margintype' : kind === 'editable' ? 'subject' : 'genericitemtypecode'
    const model = new DwModel(rt, name, structuredClone(source[name]))
    model.insertRow(0)
    model.setItem(1, column, kind === 'list' ? 1 : kind === 'editable' ? 'Alpha synthetic subject' : 901)
    model.row = 1; model.col = model.colIndex(column) + 1
    if (options.arrow) model.modify(`${column}.${kind === 'list' ? 'ddlb' : 'dddw'}.useasborder=yes`)
    control.attach(model)
    if (modern && kind === 'editable') view.useContextSurface({
      name, title: 'Subject', kind: 'form', fields: [{ object: column, label: 'Subject',
        choice: { kind: 'lookup', name: 'd_emailtemplate_list', dataColumn: 'subject', displayColumn: 'subject',
          editable: true, case: 'any', showList: true } }],
    })
    let child
    if (kind !== 'list') {
      child = await control.n_getchild(column)
      await child.ready
      for (const [index, text] of ['Alpha', 'Bravo', 'Repeated', 'Repeated'].entries()) {
        const row = child.model.insertRow(0)
        child.model.setItem(row, 'code', 901 + index)
        child.model.setItem(row, kind === 'editable' ? 'subject' : 'name', `${text} synthetic ${kind === 'editable' ? 'subject' : 'item type'}`)
        if (kind !== 'editable') child.model.setItem(row, 'description', `Synthetic description ${index + 1}`)
      }
      child.model.row = 1
    }
    const events = [], errors = [], expectedErrors = new Set()
    const state = { reject: false, handled: false, empty: false, failure: false, gate: null, ...options }
    if (state.failure) expectedErrors.add('Synthetic automatic choice load failure')
    rt.onError = (error) => {
      if (expectedErrors.has(error.message)) errors.push(error.message)
      else old.error(error)
    }
    rt.fire = async (target, event, args = []) => {
      if (target !== control) return old.fire(target, event, args)
      events.push({ event, args })
      if (event === 'itemerror') return 1
      if (event === 'itemchanged') return state.reject ? 1 : 0
      if (event === 'ue_dwnkey' && state.handled) return 1
      if (event === 'editchanged' && state.correctText) {
        if (state.correctGate) await state.correctGate
        await control.n_settext('Corrected synthetic subject')
      }
      return 0
    }
    const load = view.choiceOptions
    view.choiceOptions = async (...args) => {
      if (state.gate) await state.gate
      if (state.failure) throw new Error('Synthetic automatic choice load failure')
      const choices = await load.apply(view, args)
      return state.empty ? { items: [], validate: () => { throw new Error('Empty automatic list cannot select a row') } } : choices
    }
    await settle()
    const edit = async () => {
      model.row = 1; model.col = model.colIndex(column) + 1
      await view.focusCurrent()
      await settle()
      if (!view.editor || view.editor.getAttribute('role') !== 'combobox') throw new Error('Automatic choice did not open as a combobox')
      return view.editor
    }
    const close = async () => {
      if (current !== f) return
      view.dispose(); control.destroy(); host.remove()
      rt.dwCatalog = old.catalog; rt.fire = old.fire; rt.onError = old.error
      current = null
      await settle()
    }
    const f = { host, control, view, model, column, child, state, events, errors, expectedErrors, edit, close }
    current = f
    return f
  }
  const selected = (f) => f.model.getItem(1, f.column)
  try {
    for (const kind of ['list', 'lookup']) {
      const f = await open(kind, { arrow: true })
      const input = await f.edit(), initial = selected(f)
      check(input.readOnly && input.getAttribute('aria-expanded') === 'true' &&
        f.view.choiceEdit.popup.button.hidden && !f.view.root.querySelector('.dd-arrow,.surface-choice-arrow') &&
        document.activeElement === input, `${kind}: ShowList opens on focus with no down arrow or text editing`)
      const before = f.view.choiceEdit.popup.index
      if (modern && kind === 'lookup') {
        check(f.view.choiceEdit.options.grid?.columns.map((field) => field.label).join() === 'Code,Name,Description' &&
          !!f.view.choiceEdit.browse && !f.view.choiceEdit.browse.disabled,
        'The generic-item lookup retains all three source detail columns through its bound detail browser')
        key(input, 'F4', { shiftKey: true }); await settle(); await settle()
        const dialog = document.querySelector('.presentation-lookup[open]')
        check(dialog?.querySelectorAll('th').length === 3 && dialog.textContent.includes('Synthetic description 1'),
          'Shift+F4 opens the actual three-column detail browser without changing the chosen key')
        if (!dialog) throw new Error('Automatic choice detail browser did not open')
        ;[...dialog.querySelectorAll('button')].find((button) => button.textContent === 'Cancel').click()
        await settle()
        check(selected(f) === initial && f.view.editor === input && f.view.choiceEdit.popup.open,
          'Cancelling detail browsing restores the focused automatic list without changing the record')
        // The detail shortcut raised its own key event first; count the next key's event alone.
        f.events.length = 0
      }
      f.state.handled = true
      key(input, 'ArrowDown'); await settle()
      check(f.view.choiceEdit.popup.index === before && selected(f) === initial &&
        f.events.filter((event) => event.event === 'ue_dwnkey').length === 1,
      `${kind}: the original key result can prevent browsing without committing a value`)
      f.state.handled = false
      if (kind === 'lookup') {
        key(input, 'r'); await settle(); key(input, 'r'); await settle()
        check(f.view.choiceEdit.popup.index === 3 && selected(f) === initial,
          'Repeated-letter typeahead cycles duplicate labels without committing either key')
      }
      key(input, 'End'); await settle()
      check(selected(f) === initial && f.events.every((event) => event.event !== 'itemchanged'),
        `${kind}: browsing changes the active option, not the accepted field`)
      const last = f.view.choiceEdit.options.items.length - 1
      key(input, 'Enter'); await settle()
      check(selected(f) === (kind === 'list' ? 2 : 904) && f.view.editor === input &&
        f.view.choiceEdit.popup.open && f.events.filter((event) => event.event === 'itemchanged').length === 1 &&
        await f.control.n_gettext() === String(selected(f)),
      `${kind}: Enter accepts one original key and keeps the focused list available`)
      f.control.changed(); await settle()
      check(f.view.editor === input && input.getAttribute('aria-expanded') === 'true' &&
        f.view.choiceEdit.popup.index === last, `${kind}: repaint retains the same input and highlighted choice`)
      f.state.reject = true
      await f.view.choiceEdit.choose(0); await settle()
      check(selected(f) === (kind === 'list' ? 2 : 904) && input.getAttribute('aria-invalid') === 'true' &&
        f.view.choiceEdit.popup.open, `${kind}: rejected choices remain visible without replacing the accepted record`)
      key(input, 'Escape'); await settle()
      check(!f.view.editor && !f.host.querySelector(':popover-open'),
        `${kind}: Escape discards the rejected choice and removes its popup`)
      f.state.reject = false
      const restored = await f.edit()
      check(f.view.choiceEdit.popup.open && !restored.hasAttribute('aria-invalid'), `${kind}: refocusing opens a fresh valid list`)
      if (kind === 'lookup') {
        const expected = 'The selected lookup row changed. Reopen the field and choose its current value.'
        f.expectedErrors.add(expected)
        f.child.model.deleteRow(1)
        check(!await f.view.choiceEdit.choose(0) && selected(f) === 904 && f.errors[0] === expected,
          'A removed child row cannot be committed from an automatic list')
      }
      await f.close()
    }
    for (const options of [{ empty: true }, { failure: true }]) {
      const f = await open('lookup', options), input = await f.edit()
      check(selected(f) === 901 && (options.empty ?
        f.view.choiceEdit.popup.list.textContent.includes('No choices available') :
        input.getAttribute('aria-invalid') === 'true' && f.errors.length === 1),
      'Empty or failed automatic choices provide explicit feedback without changing the record')
      if (options.failure) {
        f.state.failure = false
        key(input, 'Enter'); await settle()
        check(f.view.choiceEdit.popup.open && !input.hasAttribute('aria-invalid') &&
          f.view.choiceEdit.options.items.length === 4, 'Enter retries automatic-list loading and opens the recovered choices')
      }
      await f.close()
    }
    let release
    const pending = await open('lookup', { gate: new Promise((resolve) => { release = resolve }) })
    await pending.edit()
    check(await pending.control.n_accepttext() === -1 && selected(pending) === 901,
      'Pending automatic choices cannot be accepted before loading completes')
    const outside = document.createElement('button')
    outside.textContent = 'Synthetic outside focus'
    document.body.append(outside); outside.focus()
    release(); await settle()
    check(document.activeElement === outside && !pending.view.choiceEdit.popup.open,
      'Late list loading does not open a popup or steal newer external focus')
    await pending.close(); outside.remove()

    const f = await open('editable'), input = await f.edit()
    check(!input.readOnly && f.view.choiceEdit.popup.open && f.view.choiceEdit.popup.button.hidden,
      'Editable source ShowList keeps a typed input and automatically opens its choices')
    input.value = 'Custom synthetic subject'
    input.dispatchEvent(new InputEvent('input', { bubbles: true })); await settle()
    check(f.view.choiceEdit.popup.open && f.events.some((event) => event.event === 'editchanged' && event.args[2] === input.value),
      'Typing keeps the automatic list open and dispatches the original EditChanged text')
    await f.view.choiceEdit.choose(1); await settle()
    check(selected(f) === 'Bravo synthetic subject' && f.view.editor === input && f.view.choiceEdit.popup.open,
      'Editable automatic-list selection accepts the chosen value without losing focused choices')
    input.dispatchEvent(new CompositionEvent('compositionstart'))
    input.value = 'Composing synthetic subject'
    input.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true }))
    f.control.changed(); await settle()
    check(f.view.editor === input && document.activeElement === input && !await f.view.acceptPendingEdit(),
      'Automatic-list IME keeps the composing input mounted and cannot commit mid-composition')
    input.dispatchEvent(new CompositionEvent('compositionend')); await settle()
    key(input, 'Escape'); await settle()
    check(!f.view.choiceEdit.popup.open && input.value === 'Composing synthetic subject',
      'First editable Escape dismisses choices without discarding the typed draft')
    key(input, 'Escape'); await settle()
    check(!f.view.editor && selected(f) === 'Bravo synthetic subject', 'Second editable Escape discards only the unapplied draft')
    const corrected = await f.edit()
    f.state.correctText = true
    let correct
    f.state.correctGate = new Promise((resolve) => { correct = resolve })
    corrected.value = 'Correct the pending input'
    corrected.dispatchEvent(new InputEvent('input', { bubbles: true }))
    const accepting = f.view.choiceEdit.choose(0)
    await settle()
    correct()
    const accepted = await accepting
    await settle()
    check(accepted && selected(f) === 'Corrected synthetic subject' && f.view.editor === corrected &&
      corrected.value === 'Corrected synthetic subject' && f.view.choiceEdit.popup.open,
    'A source SetText correction during choice acceptance remains accepted, visible and focused even without a matching listed value')
    await f.close()
  } finally {
    if (current) await current.close()
  }
  if (modern) window.openAutomaticChoicePreview = async (kind = 'lookup') => {
    const f = await open(kind)
    window.automaticChoicePreview = f
    return true
  }
}
