import { PBObject } from './src/runtime/object.js'
import { DwCatalog } from './src/dw/def.js'
import { DwModel } from './src/dw/model.js'
import { NDwBase } from './src/runtime/native/dwctrl.js'

// Real argument/child metadata and the original sale type-to-child-row routine.
// The key/validation harness is synthetic, not an accepted sale or purchase workflow.
export async function checkEditableLookups(fixture, check, settle) {
  const source = await (await fetch('./presentation-editable-lookups.json')).json()
  fixture.ui.activate(fixture.sale)
  await settle()
  const rt = fixture.rt
  let control = fixture.sale.children.get('dw_grid')
  let view = fixture.ui.views.get(fixture.sale).ctlViews.get(control).dw
  const originalControl = control, originalView = view
  const old = { catalog: rt.dwCatalog, fire: rt.fire, error: rt.onError, model: control.model }
  const hostStyle = view.host.getAttribute('style')
  const catalog = new DwCatalog(async () => undefined)
  catalog.get = async (name) => source.data[name] ? structuredClone(source.data[name]) : undefined
  const key = (input, value) => input.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true }))
  let state
  const owner = new PBObject(rt, 'w_sale', 'window')
  const cls = { name: 'w_sale', ancestor: null, kind: 'window', library: 'synthetic', fields: [], controls: [],
    routines: new Map([['w_sale', new Map([['wf_setcustomername', [source.search]]])]]) }
  owner.scripts = [{ cls, owner: 'w_sale' }]
  const open = async (name = 'd_arg_manf') => {
    if (view.editor) { key(view.editor, 'Escape'); await settle(); key(view.editor ?? view.root, 'Escape'); await settle() }
    rt.dwCatalog = catalog
    const model = new DwModel(rt, name, structuredClone(source.data[name]))
    const column = name === 'd_arg_select_cust' ? 'custcode' : 'manfcode'
    model.insertRow(0)
    model.setItem(1, column, 901)
    model.col = 1
    control.attach(model)
    const child = await control.n_getchild(column)
    await child.ready
    child.model.reset()
    const keyColumn = column === 'custcode' ? 'accounts_acccode' : 'manfcode'
    const textColumn = column === 'custcode' ? 'customer_name' : 'name'
    for (const [value, text] of [[901, 'Alpha synthetic manufacturer'], [902, 'Bravo synthetic manufacturer'], [903, 'Repeated synthetic manufacturer'], [904, 'Repeated synthetic manufacturer']]) {
      const row = child.model.insertRow(0)
      child.model.setItem(row, keyColumn, value)
      child.model.setItem(row, textColumn, text)
    }
    child.model.row = 1
    owner.props.set('idc_customers', child)
    const events = [], errors = []
    state = { model, column, child, keyColumn, textColumn, events, errors, reject: false, sourceEnter: false, correct: false }
    rt.onError = (error) => errors.push(String(error))
    rt.fire = async (target, event, args = []) => {
      if (target !== control) return old.fire(target, event, args)
      events.push({ event, args })
      if (event === 'itemerror') return 1
      if (event === 'itemchanged') return state.reject ? 1 : 0
      if (event === 'editchanged') {
        if (column === 'custcode') await rt.callMethod(owner, 'wf_setcustomername', [args[2]])
        if (state.correct) await control.n_settext('Bravo synthetic manufacturer')
        return 0
      }
      if (event === 'ue_dwnkey' && args[0] === 'keyenter!' && state.sourceEnter) {
        await control.n_setitem(1, column, child.model.getItem(child.model.row, keyColumn))
        return 0
      }
      return 0
    }
    await settle()
    const edit = async () => {
      model.row = 1; model.col = 1
      await view.focusCurrent()
      await settle()
      if (view.editor?.getAttribute('role') !== 'combobox') throw new Error('Editable lookup did not open as a text combobox')
      return view.editor
    }
    const close = async () => {
      if (view.editor) { key(view.editor, 'Escape'); await settle(); if (view.editor) { key(view.editor, 'Escape'); await settle() } }
      rt.dwCatalog = old.catalog; rt.fire = old.fire; rt.onError = old.error
      if (control === originalControl) {
        if (hostStyle === null) view.host.removeAttribute('style')
        else view.host.setAttribute('style', hostStyle)
        control.attach(old.model)
      }
      await settle()
    }
    return { ...state, view, control, edit, close, state }
  }
  try {
    for (const name of ['d_arg_manf', 'd_arg_manf2']) {
      const f = await open(name)
      let input = await f.edit()
      if (view.root.classList.contains('modern-surface')) {
        check((input.getAttribute('aria-required') === 'true') === (name === 'd_arg_manf2') &&
          !!view.root.querySelector('.surface-required') === (name === 'd_arg_manf2') && !input.required,
        'Modern manufacturer guidance preserves the source optional/required distinction without browser constraints')
      } else {
        check(!input.hasAttribute('aria-required') && !view.root.querySelector('.surface-required') && !input.required,
          'Classic manufacturer input retains its original presentation and validation')
      }
      check(input.value === 'Alpha synthetic manufacturer' && await control.n_gettext() === input.value &&
        f.model.getItem(1, f.column) === 901, 'Real editable manufacturer metadata displays names while retaining numeric keys')
      input.value = 'Bravo synthetic manufacturer'
      input.dispatchEvent(new InputEvent('input', { bubbles: true }))
      await settle()
      check(f.events.filter((event) => event.event === 'editchanged').at(-1)?.args[2] === input.value,
        'Shared DataWindow EditChanged receives the complete manufacturer text')
      check(await control.n_accepttext() === 1 && f.model.getItem(1, f.column) === 902 &&
        f.events.filter((event) => event.event === 'itemchanged').at(-1)?.args[2] === '902',
      'Manufacturer selection passes the resolved numeric data key through original ItemChanged validation')
      input = await f.edit()
      await control.n_settext('not a numeric key')
      check(await control.n_accepttext() === -1 && input.value === 'not a numeric key' &&
        f.model.getItem(1, f.column) === 902 && f.events.at(-1).event === 'itemerror',
      'Unmatched manufacturer text reaches ItemError without coercing a name into an account key')
      input.setSelectionRange(2, 8)
      control.changed()
      await settle()
      check(view.editor === input && input.value === 'not a numeric key' && input.selectionStart === 2 && input.selectionEnd === 8,
        'Editable lookup redraw preserves the same input, rejected draft and text selection')
      state.correct = true
      input.value = 'correct this'
      input.dispatchEvent(new InputEvent('input', { bubbles: true }))
      await settle()
      check(input.value === 'Bravo synthetic manufacturer' && await control.n_gettext() === input.value,
        'Source SetText corrections stay in the active editable lookup')
      key(input, 'Escape')
      await settle()
      input = await f.edit()
      key(input, 'ArrowDown')
      await settle()
      check(input.getAttribute('aria-expanded') === 'true' && view.editor === input && document.activeElement === input,
        'Real child-row updates preserve an open popup and its text focus across redraw')
      const optionNodes = [...view.choiceEdit.popup.list.children]
      key(input, 'ArrowUp'); await settle()
      control.changed(); await settle()
      check(optionNodes.every((node, index) => view.choiceEdit.popup.list.children[index] === node) &&
        document.activeElement === input && view.choiceEdit.popup.open,
      'Original editable child-cursor updates and parent redraws reuse the same popup options')
      if (fixture.session.activeMode === 'classic') {
        const fill = view.fillWindow
        let enter, release
        const entered = new Promise((resolve) => { enter = resolve })
        const resume = new Promise((resolve) => { release = resolve })
        const outside = document.createElement('input')
        outside.setAttribute('aria-label', 'Synthetic external focus')
        document.body.append(outside)
        view.fillWindow = async () => { await fill.call(view); enter(); await resume }
        try {
          const painting = view.paint(f.model)
          await entered
          outside.focus()
          release()
          await painting
          check(document.activeElement === outside && input.getAttribute('aria-expanded') === 'false' && view.editor === input,
            'A paused Classic choice redraw cannot reclaim newer external focus or reopen its popup')
        } finally {
          release()
          view.fillWindow = fill
          outside.remove()
        }
        input.focus()
        key(input, 'ArrowDown')
        await settle()
      }
      const popup = view.root.querySelector('.dw-choice-popup')
      popup.querySelector('[data-index="3"]').click()
      await settle()
      check(f.model.getItem(1, f.column) === 904 && !view.editor,
        'Pointer selection of repeated manufacturer names writes the explicitly chosen key')
      input = await f.edit()
      await control.n_settext('Alpha synthetic manufacturer')
      f.child.model.deleteRow(1)
      check(await control.n_accepttext() === -1 && f.model.getItem(1, f.column) === 904 && state.errors.length === 1,
        'Deleted lookup rows cannot be committed from a retained display label')
      key(input, 'Escape')
      await settle()
      input = await f.edit()
      state.correct = false
      input.dispatchEvent(new CompositionEvent('compositionstart'))
      input.value = 'composing'
      input.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true }))
      control.changed()
      await settle()
      check(view.editor === input && input.isConnected && document.activeElement === input,
        'DataWindow redraw cannot detach an editable lookup during IME composition')
      input.dispatchEvent(new CompositionEvent('compositionend'))
      await settle()
      f.model.modify('manfcode.dddw.case=upper')
      control.changed()
      await settle()
      const retained = view.root.querySelector('.surface-stale input,.dw-recovery textarea')
      const staleAcceptance = await control.n_accepttext()
      check(retained?.value === 'composing' && staleAcceptance === -1,
        `Changed editable lookup policy retains a copyable draft and blocks acceptance in both presentations (retained=${retained?.value ?? 'missing'}, accepted=${staleAcceptance})`)
      f.model.modify('manfcode.dddw.case=any')
      view.root.querySelector('.surface-stale button,.dw-recovery button')?.click()
      await settle()
    }
    const windowed = await open()
    for (let code = 905; code <= 1904; code++) {
      const row = windowed.child.model.insertRow(0)
      windowed.child.model.setItem(row, windowed.keyColumn, code)
      windowed.child.model.setItem(row, windowed.textColumn, `Manufacturer ${code}`)
    }
    windowed.child.model.row = 1
    windowed.child.changed(); await settle()
    const windowInput = await windowed.edit()
    key(windowInput, 'F4'); await settle()
    const second = view.choiceEdit.popup.list.querySelector('[data-index="1"]')
    key(windowInput, 'ArrowDown'); await settle()
    check(windowed.child.model.row === 2 && windowed.child.model.rowAt(2).sel &&
      windowed.model.getItem(1, windowed.column) === 901 && view.editor === windowInput &&
      view.choiceEdit.popup.list.querySelector('[data-index="1"]') === second && view.choiceEdit.popup.options.size <= 40,
    'Large editable lookups retain native child-cursor updates and option identity across source redraws')
    view.choiceEdit.popup.moveTo(1003); await settle()
    const finalOption = view.choiceEdit.popup.list.querySelector('[data-index="1003"]')
    check(finalOption?.textContent === 'Manufacturer 1904' && windowed.child.model.row === 1004 &&
      document.activeElement === windowInput && windowInput.value === 'Alpha synthetic manufacturer' &&
      view.choiceEdit.popup.options.size <= 40,
    'Distant virtual child navigation retains the source cursor, unaccepted text and input focus')
    finalOption.click(); await settle()
    check(windowed.model.getItem(1, windowed.column) === 1904 &&
      windowed.events.filter(event => event.event === 'itemchanged').length === 1 && !view.editor && !state.errors.length,
    'A real virtual manufacturer choice passes its original key through one ItemChanged')
    await windowed.close()
    const f = await open('d_arg_select_cust')
    let input = await f.edit()
    input.value = 'Bravo'
    input.dispatchEvent(new InputEvent('input', { bubbles: true }))
    await settle()
    check(f.child.model.row === 2 && f.child.model.rowAt(2).sel && f.model.getItem(1, f.column) === 901,
      'The original sale type-to-customer routine moves and selects the child row without changing the parent key')
    state.sourceEnter = true
    const findRoutines = control.findRoutines
    control.findRoutines = function (name, ...args) {
      return name === 'ue_enterkey' ? [{ synthetic: true }] : findRoutines.call(this, name, ...args)
    }
    try {
      key(input, 'Enter')
      await settle()
      check(f.model.getItem(1, f.column) === 902 && !f.events.some((event) => event.event === 'itemchanged') &&
        f.events.filter((event) => event.event === 'ue_dwnkey' && event.args[0] === 'keyenter!').length === 1,
      'Source Enter may commit its selected child key without a second ItemChanged or keyboard event')
      check(f.events.filter((event) => event.event === 'ue_enterkey').length === 1,
        'After a source key write, the declared Enter continuation still runs exactly once')
    } finally { control.findRoutines = findRoutines }
    await f.close()
  } finally {
    rt.dwCatalog = old.catalog; rt.fire = old.fire; rt.onError = old.error
  }
  window.openEditableLookupPreview = async () => {
    await window.editableLookupPreview?.close()
    const host = document.createElement('div')
    host.style.cssText = 'position:fixed;inset:16px;z-index:2147483000'
    document.body.append(host)
    control = new NDwBase(rt, 'dw_lookup_preview')
    control.props.set('hscrollbar', true)
    control.props.set('vscrollbar', true)
    view = new originalView.constructor(control, host)
    const previewControl = control, previewView = view
    const f = await open()
    const close = f.close
    let closed = false
    f.close = async () => {
      if (closed) return
      closed = true
      await close()
      previewView.dispose()
      previewControl.destroy()
      host.remove()
      control = originalControl
      view = originalView
    }
    window.editableLookupPreview = f
    return true
  }
}
