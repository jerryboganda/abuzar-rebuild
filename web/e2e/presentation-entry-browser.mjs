import { Runtime, Ref, Frame } from './src/runtime/interp.js'
import { DwModel } from './src/dw/model.js'
import { PBObject } from './src/runtime/object.js'
import { PBArray } from './src/runtime/values.js'
import { entryControls } from './src/ui/modern-entry-window.js'
import { checkEntryWorkflows } from './presentation-entry-workflow.mjs'

export async function checkEntrySurfaces(fixture, check, settle) {
  const definitions = await (await fetch('./presentation-entry.json')).json()
  const surfaces = await (await fetch('./presentation-surfaces.json')).json()
  const source = await (await fetch('./presentation-tabs.json')).json()
  for (const definition of definitions) {
    definition.routines = new Map(Object.entries(definition.routines).map(([owner, routines]) => [owner, new Map(Object.entries(routines))]))
    fixture.rt.classes.set(definition.name, definition)
  }
  const oldFire = fixture.rt.fire
  const events = []
  fixture.rt.fire = async (target, event, args) => {
    let owner = target
    while (owner && owner.className !== 'w_agingintervals') owner = owner.parent
    if (!owner) return oldFire(target, event, args)
    events.push({ target, event, args, text: target.props.get('text') })
    return Runtime.prototype.fire.call(fixture.rt, target, event, args)
  }
  const open = async () => {
    let window
    const ref = new Ref(() => window, (value) => { window = value })
    ref.name = 'w_agingintervals'
    await fixture.rt.sys.get('opensheet').fn(fixture.rt, [ref, fixture.frame], new Frame(null, null, 0))
    const view = fixture.ui.views.get(window)
    const controls = entryControls(window)
    const control = (name) => [...controls.values()].find((control) => control.name === name)
    const element = (name) => {
      const root = view.ctlViews.get(control(name)).el
      return root.classList.contains('pb-dropdown') ? root.querySelector('select:not([hidden]),input:not([hidden])') : root
    }
    const attach = (name, definition, rows) => {
      const model = new DwModel(fixture.rt, definition, structuredClone(definition === 'd_find' ? source.findDefinition : surfaces[definition]))
      for (const values of rows) {
        const row = model.insertRow(0)
        for (const [name, value] of Object.entries(values)) model.setItem(row, name, value)
      }
      control(name).attach(model)
      return model
    }
    attach('dw_detail', 'd_aginginterval', [{ code: 1, name: 'Synthetic intervals' }])
    attach('dw_itemsdetail', 'd_agingintervaldetail', [{ code: 1, limit: 30 }, { code: 1, limit: 60 }])
    attach('dw_list', 'd_agingintervallist', ['ALPHA', 'BRAVO', 'CHARLIE'].map((name, index) => ({ code: index + 1, name })))
    attach('dw_find', 'd_find', [{ find: '' }])
    for (const [name, values] of [
      ['ddlb_sort', ['Code', 'Name']], ['ddlb_filter_column', ['Code', 'Name']],
      ['ddlb_op', ['=', '<>', '>']], ['ddlb_data', ['ALPHA', 'BRAVO', 'CHARLIE']],
    ]) {
      const items = new PBArray('string')
      items.a.push(...values)
      control(name).props.set('_items', items)
      await control(name).n_selectitem(name === 'ddlb_sort' || name === 'ddlb_filter_column' ? 2 : 1)
    }
    control('rb_ascending').pbSet('checked', true)
    const menu = new PBObject(fixture.rt, 'menu', 'menu')
    const file = new PBObject(fixture.rt, 'menu', 'menu')
    menu.children.set('m_file', file)
    for (const name of ['m_save', 'm_new', 'm_retrieve', 'm_next', 'm_previous']) file.children.set(name, new PBObject(fixture.rt, 'menu', 'menu'))
    for (const [name, value] of Object.entries({
      im_menu: menu, id_detail: control('dw_itemsdetail'), id_master: control('dw_detail'),
      id_list: control('dw_list'), id_dwcontrol: control('dw_list'),
      id_itemslist: control('dw_itemslist'), id_footer: control('dw_footer'),
      ii_colindex: 2, ii_type: 1, is_sortsequence: 'A', editflag: false, i_editmode: 1,
      il_currrow: 1, ib_itemvalidated: true,
    })) window.props.set(name, value)
    await settle()
    return { window, view, controls, control, element, events, fixture, close: () => fixture.rt.closeWindow(window) }
  }
  const modern = fixture.session.activeMode === 'modern'
  const f = await open()
  check(f.controls.size === 23 && [...f.view.ctlViews.values()].every((binding) => f.view.client.contains(binding.el)),
    'The inherited aging entry retains all 23 control paths and every existing control element')
  check(f.view.el.classList.contains('modern-entry-window') === modern,
    'Only Modern reflows the reviewed aging entry; Classic retains its layout')
  check(f.element('dw_footer').getClientRects().length === 0 && f.element('dw_itemslist').getClientRects().length === 0,
    'Inherited hidden footer and item-list controls are retained without becoming visible')
  const tabs = [...f.element('tab_retrieve').querySelectorAll(':scope > .strip > .t')]
  const detail = f.control('dw_itemsdetail')
  const detailView = f.view.ctlViews.get(detail).dw
  const limit = async (value, row = 1) => {
    detail.model.row = row
    detail.model.col = 2
    await fixture.ui.focusDw(detail, true)
    await settle()
    const input = detailView.editor
    if (!input) throw new Error('Missing aging limit editor')
    input.value = value
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await settle()
    return input
  }
  const message = async (title) => {
    const dialog = document.querySelector('.presentation-runtime-dialog[open],.msgbox')
    check(dialog?.textContent.includes(title), `Recovered aging validation displays ${title}`)
    const button = dialog?.querySelector('button')
    if (!button) throw new Error(`Missing validation dialog for ${title}`)
    button.click()
    await settle()
  }
  events.length = 0
  await limit('-1')
  const negative = detailView.acceptPendingEdit()
  await settle()
  await message('Limit Validation')
  check(!(await negative) && detail.model.getItem(1, 'limit') === 30 && detailView.editor?.value === '-1',
    'The original negative-limit rejection retains the value and draft in both presentations')
  check(events.filter((event) => event.target === detail && ['itemchanged', 'itemerror'].includes(event.event))
    .map((event) => event.event).join(',') === 'itemchanged,itemerror',
    'A source ItemChanged rejection reaches the original ItemError once without an extra standard message')
  detailView.editor.value = '60'
  detailView.editor.dispatchEvent(new Event('input', { bubbles: true }))
  await settle()
  check(await detailView.acceptPendingEdit() && detail.model.getItem(1, 'limit') === 60 &&
    f.window.props.get('ib_itemvalidated') === false, 'The accepted limit reaches the inherited edit state before row validation')
  const duplicate = detailView.tabNext(1)
  await settle()
  await message('Duplication Error')
  await duplicate
  check(detail.model.getItem(1, 'limit') === null && detail.model.row === 1 &&
    f.window.props.get('ib_itemvalidated') === true && detail.model.col === 2,
    'Forward navigation preserves the recovered duplicate-limit correction and source-directed return to row one')
  await limit('45')
  check(await detailView.acceptPendingEdit() && await fixture.rt.callMethod(f.window, 'wf_validateitem', []) === 0,
    'Correcting a duplicate limit passes the original row validation')
  await limit('45', 2)
  check(await detailView.acceptPendingEdit(), 'The second-row edit reaches source validation')
  const previousDuplicate = detailView.tabNext(-1)
  await settle()
  await message('Duplication Error')
  await previousDuplicate
  check(detail.model.getItem(2, 'limit') === null && detail.model.row === 2 && detail.model.col === 2,
    'Backward duplicate searching preserves the source-directed correction on the second row')
  await limit('90', 2)
  check(await detailView.acceptPendingEdit() && await fixture.rt.callMethod(f.window, 'wf_validateitem', []) === 0,
    'Correcting the second-row duplicate restores a valid detail list')
  detail.validateRules.set('limit', 'number(gettext()) >= 0')
  await limit('-2')
  events.length = 0
  const ruleFailure = detailView.acceptPendingEdit()
  await settle()
  await message('Limit Validation')
  check(!(await ruleFailure) && events.filter((event) => event.target === detail && ['itemchanged', 'itemerror'].includes(event.event))
    .map((event) => event.event).join(',') === 'itemerror',
    'A failed runtime validation rule reaches source ItemError without incorrectly firing ItemChanged')
  detail.validateRules.delete('limit')
  detailView.editor.value = '45'
  await detailView.acceptPendingEdit()
  f.window.props.set('ib_itemvalidated', true)
  const decisionFire = fixture.rt.fire
  for (const [changed, error, navigation] of [[2, 0, true], [1, 3, true], [1, 3, false], [1, 2, false]]) {
    detail.model.setItem(1, 'limit', 45)
    detail.changed()
    await settle()
    const sequence = []
    fixture.rt.fire = async (target, event, args) => {
      if (target === detail && event === 'itemchanged') { sequence.push(event); return changed }
      if (target === detail && event === 'itemerror') {
        sequence.push(event)
        if (error === 3) await detail.n_setitem(1, 'limit', 55)
        return error
      }
      return decisionFire(target, event, args)
    }
    const input = await limit('42')
    let result
    if (navigation) {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }))
      await settle()
    } else {
      result = await detail.n_accepttext()
      await settle()
    }
    check(detail.model.getItem(1, 'limit') === (error === 2 ? 42 : error === 3 ? 55 : 45),
      `ItemChanged ${changed}/ItemError ${error} never overwrites a rejected value or a script correction`)
    check(sequence.join(',') === (changed === 2 ? 'itemchanged' : 'itemchanged,itemerror'),
      'The shared editor calls each decision handler exactly once')
    check(navigation ? detail.model.row === 2 : result === (error === 2 ? 1 : -1),
      'Discarding permits requested cell navigation but is not reported as accepted by native AcceptText')
    if (detailView.editor) detailView.editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  }
  fixture.rt.fire = decisionFire
  detail.model.setItem(1, 'limit', 45)
  detail.changed()
  await settle()
  const externalDraft = await limit('46')
  externalDraft.blur()
  await settle()
  check(detail.model.getItem(1, 'limit') === 45 && detailView.editor?.value === '46' &&
    await detail.n_gettext() === '46', 'Leaving the DataWindow retains its unaccepted draft instead of silently committing on blur')
  check(await detail.n_accepttext() === 1 && detail.model.getItem(1, 'limit') === 46,
    'Explicit AcceptText accepts an externally blurred draft through its normal validation')
  f.window.props.set('ib_itemvalidated', true)
  const validate = await fixture.rt.instantiate('f_validatedw')
  const master = f.control('dw_detail')
  const masterView = f.view.ctlViews.get(master).dw
  master.model.row = 1
  master.model.col = 2
  await fixture.ui.focusDw(master, true)
  await settle()
  masterView.editor.value = ''
  masterView.editor.dispatchEvent(new Event('input', { bubbles: true }))
  await settle()
  check(await masterView.acceptPendingEdit() && master.model.getItem(1, 'name') === null,
    'The recovered description Empty String Is Null flag is preserved by the shared editor')
  const required = fixture.rt.callMethod(validate, 'f_validatedw', [master])
  await settle()
  await message('Validation Error')
  check(await required === -1 && master.model.col === 2 && masterView.editor,
    'The recovered required-field helper prevents saving an empty description and focuses its field')
  masterView.editor.value = 'Synthetic intervals'
  check(await masterView.acceptPendingEdit() && await fixture.rt.callMethod(validate, 'f_validatedw', [master]) === 1 &&
    await fixture.rt.callMethod(validate, 'f_validatedw', [detail]) === 1,
    'Populated master/detail fields pass the actual required-field helper without a spurious end-of-search error')
  f.window.props.set('editflag', false)
  tabs[1].click()
  await settle()
  check(f.control('tab_retrieve').props.get('selectedtab') === 2, 'The composed entry still uses guarded List activation')
  if (modern) {
    check(f.view.el.querySelectorAll('.entry-criteria-group[role=group]').length === 2 &&
      f.element('ddlb_sort').getAttribute('aria-label') === 'Sort column',
    'Sort and filter controls are named and grouped without replacing their runtime objects')
    const label = f.element('st_find')
    const find = f.element('dw_find').querySelector('[data-obj=find]')
    check(find?.getAttribute('aria-labelledby') === label.id && !f.element('dw_find').querySelector('.surface-label'),
      'Contextual Find uses its existing live label without duplicating it or globally changing compatibility slots')
    check(find.getAttribute('aria-describedby') === f.element('st_1').id,
      'The original Find instructions describe the reflowed field')
    label.parentElement.scrollIntoView({ block: 'nearest' })
    f.control('st_find').pbSet('text', 'Find matching name:')
    check(document.getElementById(find.getAttribute('aria-labelledby')).textContent === 'Find matching name:',
      'The composed Find accessible name follows original label changes')
    f.control('gb_sort').pbSet('text', 'Sort Criteria (synthetic)')
    check(f.element('gb_sort').querySelector('legend').textContent === 'Sort Criteria (synthetic)',
      'Original group captions remain live after reflow')
    f.control('gb_sort').pbSet('enabled', false)
    check(!f.element('ddlb_sort').matches(':disabled'),
      'A decorative group caption cannot newly disable independent original controls')
    f.control('gb_sort').pbSet('enabled', true)
  }
  const select = f.element('ddlb_op')
  events.length = 0
  select.selectedIndex = 1
  select.dispatchEvent(new Event('change', { bubbles: true }))
  await settle()
  check(events.filter((event) => event.target === f.control('ddlb_op') && event.event === 'selectionchanged').length === 1 &&
    f.control('ddlb_op').props.get('_selected') === 2, 'Reflowed selects dispatch the existing one-based selection once')
  check(events.find((event) => event.target === f.control('ddlb_op') && event.event === 'selectionchanged').text === '<>' &&
    await f.control('ddlb_op').n_gettext() === '<>',
  'The selected criterion text reaches the source handler and GetText before selection notification')
  f.control('ddlb_op').pbSet('enabled', false)
  check(select.disabled, 'Runtime disabling reaches the existing criterion select')
  f.control('ddlb_op').pbSet('enabled', true)
  await f.control('ddlb_op').n_selectitem(1)
  await f.control('ddlb_data').n_selectitem(2)
  events.length = 0
  f.element('cb_filter').click()
  await settle()
  check(events.filter((event) => event.target === f.control('cb_filter') && event.event === 'clicked').length === 1,
    'Filter keeps its original Clicked route')
  check(f.control('dw_list').model.rowCount() === 1 && f.control('dw_list').model.getItem(1, 'name') === 'BRAVO' &&
    f.element('cb_filter').textContent.replace('&', '') === 'Unfilter' &&
    f.control('dw_find').model.getItem(1, 'find') === 'BRAVO',
  'The recovered filter routine reads current criterion text, filters synthetic rows and updates Find')
  f.element('cb_filter').click()
  await settle()
  check(f.control('dw_list').model.rowCount() === 3 && f.element('cb_filter').textContent.trim() === 'Filter',
    'The original Unfilter action restores the full synthetic list')
  const valueControl = f.control('ddlb_data')
  const valueInput = f.element('ddlb_data')
  const combo = f.view.ctlViews.get(valueControl).el
  const key = (name, options = {}) => valueInput.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true, ...options }))
  const type = (text) => {
    valueInput.value = text
    valueInput.dispatchEvent(new Event('input', { bubbles: true }))
  }
  // Background browser canvases update activeElement without delivering native focus events.
  const backgroundBlur = (input) => {
    if (!document.hasFocus()) input.dispatchEvent(new FocusEvent('blur'))
  }
  check(valueControl.props.get('allowedit') === true && valueInput.tagName === 'INPUT' &&
    valueInput.getAttribute('role') === 'combobox', 'The recovered AllowEdit value now renders a real editable combo in both presentations')
  await valueControl.n_setfocus()
  await settle()
  events.length = 0
  type('BR')
  await settle()
  check(valueControl.props.get('text') === 'BR' && await valueControl.n_selectedindex() === 0 &&
    !events.some((event) => event.target === valueControl && ['modified', 'selectionchanged'].includes(event.event)),
  'Typing freeform criteria updates Text without inventing a list selection or per-keystroke Modified event')
  key('Enter')
  await settle()
  key('Enter')
  await settle()
  check(events.filter((event) => event.target === valueControl && event.event === 'modified').length === 1,
    'Modified fires once when the edited text is finished, not again on unchanged Enter')
  await f.control('ddlb_op').n_selectitem(3)
  f.element('cb_filter').click()
  await settle()
  check(f.control('dw_list').model.rowCount() === 2 &&
    f.control('dw_list').model.getItem(1, 'name') === 'BRAVO' &&
    f.control('dw_list').model.getItem(2, 'name') === 'CHARLIE',
  'The original filter routine accepts a typed, non-listed value through the same criterion Text property')
  f.element('cb_filter').click()
  await settle()
  await f.control('ddlb_op').n_selectitem(1)
  valueInput.focus()
  await settle()
  events.length = 0
  key('ArrowDown')
  check(valueInput.getAttribute('aria-expanded') === 'true' && valueInput.getAttribute('aria-activedescendant') &&
    valueInput.value === 'BR', 'Opening the editable list exposes an active choice without replacing typed text')
  key('Escape')
  check(valueInput.getAttribute('aria-expanded') === 'false' && valueInput.value === 'BR' &&
    !events.some((event) => event.target === valueControl && event.event === 'selectionchanged'),
  'Escape dismisses the choices without discarding freeform text or selecting a suggestion')
  key('ArrowDown')
  key('ArrowUp')
  check(document.getElementById(valueInput.getAttribute('aria-activedescendant'))?.textContent === 'ALPHA',
    'Up Arrow at the first editable-list option stays at its boundary')
  key('ArrowDown')
  key('Enter')
  await settle()
  check(valueInput.value === 'BRAVO' && await valueControl.n_selectedindex() === 2 &&
    events.filter((event) => event.target === valueControl && event.event === 'selectionchanged').length === 1,
  'Keyboard list acceptance sends one one-based SelectionChanged with the selected Text')
  events.length = 0
  combo.querySelector('.dropdown-toggle').click()
  combo.querySelectorAll('[role=option]')[1].click()
  await settle()
  check(events.filter((event) => event.target === valueControl && ['selectionchanged', 'clicked'].includes(event.event))
    .map((event) => event.event).join(',') === 'selectionchanged,clicked',
  'Clicking an already selected editable-list option still sends SelectionChanged before Clicked')
  events.length = 0
  type('Needs notification')
  f.element('ddlb_op').focus()
  backgroundBlur(valueInput)
  await settle()
  check(events.filter((event) => event.target === valueControl && ['modified', 'losefocus'].includes(event.event))
    .map((event) => event.event).join(',') === 'modified,losefocus',
  'Leaving a changed editable combo sends Modified before LoseFocus')
  valueInput.focus()
  await settle()
  type('Draft before script')
  await valueControl.n_selectitem(1)
  events.length = 0
  key('Enter')
  await settle()
  check(valueInput.value === 'ALPHA' && !events.some((event) => event.target === valueControl && event.event === 'modified'),
    'Programmatic selection replaces a typed value without leaving a stale Modified notification')
  await valueControl.n_settext('Replacement text')
  await valueControl.n_selecttext(2, 4)
  check(valueInput.value === 'Replacement text' && valueInput.selectionStart === 1 && valueInput.selectionEnd === 5 &&
    await valueControl.n_selectedtext() === 'epla', 'Native SetText and SelectText reach the real editable field')
  valueControl.pbSet('limit', 12)
  check(valueInput.maxLength === 12, 'The original text limit reaches the native input')
  valueControl.pbSet('limit', 0)
  valueControl.pbSet('enabled', false)
  check(valueInput.disabled && combo.querySelector('button').disabled, 'Disabling the original control disables editing and opening choices')
  valueControl.pbSet('enabled', true)
  await valueControl.n_selectitem(2)
  valueInput.focus()
  await settle()
  valueControl.pbSet('allowedit', false)
  await settle()
  check(f.element('ddlb_data').tagName === 'SELECT' && f.element('ddlb_data').value === 'BRAVO' &&
    document.activeElement === f.element('ddlb_data'), 'Runtime AllowEdit changes preserve the selected value and control focus')
  valueControl.pbSet('allowedit', true)
  await settle()
  check(f.element('ddlb_data') === valueInput && valueInput.value === 'BRAVO' && document.activeElement === valueInput,
    'Re-enabling text input restores the same editor instance and value')
  const realFire = fixture.rt.fire
  let release
  const held = new Promise((resolve) => { release = resolve })
  let modifications = 0
  fixture.rt.fire = async (target, event, args) => {
    if (target === valueControl && event === 'modified') { modifications++; await held }
    return realFire(target, event, args)
  }
  type('Held edit')
  key('Enter')
  await settle()
  key('Enter')
  check(valueInput.readOnly && combo.querySelector('button').disabled && modifications === 1,
    'An unfinished control notification prevents competing edits and duplicate Enter processing')
  release()
  await settle()
  fixture.rt.fire = realFire
  check(!valueInput.readOnly && !combo.querySelector('button').disabled, 'Editing becomes available after notification completion')
  await valueControl.n_reset()
  check(valueInput.value === '' && !combo.querySelectorAll('[role=option]').length,
    'Reset clears the editable text and removes old suggestions')
  f.element('ddlb_filter_column').selectedIndex = 1
  f.element('ddlb_filter_column').dispatchEvent(new Event('change', { bubbles: true }))
  await settle()
  check(valueControl.items().a.join(',') === 'ALPHA,BRAVO,CHARLIE' && valueInput.value === '',
    'The recovered column-selection routine repopulates and sorts criteria without resurrecting old text')
  type('Composed')
  events.length = 0
  key('Enter', { isComposing: true })
  await settle()
  check(!events.some((event) => event.target === valueControl && event.event === 'modified'),
    'Composition confirmation is not mistaken for finished criterion entry')
  key('Tab')
  await settle()
  const errorEvents = []
  const realError = fixture.rt.onError
  const realMessage = fixture.ui.messageBox
  fixture.rt.onError = (error) => errorEvents.push(String(error))
  fixture.ui.messageBox = async (title, text) => { errorEvents.push({ title, text }); return 1 }
  fixture.rt.fire = async (target, event, args) => {
    if (target === valueControl && event === 'modified') throw new Error('Synthetic criterion failure')
    return realFire(target, event, args)
  }
  type('Failed event')
  key('Enter')
  await settle()
  check(errorEvents.some((error) => typeof error === 'string' && error.includes('Synthetic criterion failure')) &&
    errorEvents.some((error) => error.title === 'Control action failed') && valueInput.value === 'Failed event',
  'Control notification failure is reported with retained text instead of silently succeeding')
  fixture.rt.onError = realError
  fixture.ui.messageBox = realMessage
  fixture.rt.fire = realFire
  await valueControl.n_selectitem(1)
  f.element('ddlb_sort').selectedIndex = 1
  f.element('ddlb_sort').dispatchEvent(new Event('change', { bubbles: true }))
  await settle()
  check(f.window.props.get('ii_colindex') === 2 && f.window.props.get('ii_type') === 1 &&
    f.control('dw_list').model.getItem(1, 'name') === 'ALPHA' && f.control('dw_find').model.getItem(1, 'find') === '',
  'The recovered sort handler resolves the selected column and restores ascending names without a stale Text property')
  const second = await open()
  check(f.element('rb_ascending').querySelector('input').checked && second.element('rb_ascending').querySelector('input').checked,
    'Two retained entry windows have independent native radio groups')
  second.element('rb_descending').querySelector('input').click()
  await settle()
  check(f.element('rb_ascending').querySelector('input').checked &&
    second.control('rb_descending').props.get('checked') === true && second.control('rb_ascending').props.get('checked') === false,
    'Changing sort direction does not uncheck another workspace or desynchronize its model')
  second.element('tab_retrieve').querySelectorAll(':scope > .strip > .t')[1].click()
  await settle()
  const closingControl = second.control('ddlb_data')
  const closingInput = second.element('ddlb_data')
  closingInput.focus()
  await settle()
  closingInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
  closingControl.pbSet('visible', false)
  check(closingInput.getAttribute('aria-expanded') === 'false', 'Hiding a control also closes its top-layer choices')
  closingControl.pbSet('visible', true)
  closingInput.focus()
  await settle()
  let finishClosing
  const closingWait = new Promise((resolve) => { finishClosing = resolve })
  const closingEvents = []
  fixture.rt.fire = async (target, event, args) => {
    if (target === closingControl) {
      closingEvents.push(event)
      if (event === 'modified') await closingWait
    }
    return realFire(target, event, args)
  }
  closingInput.value = 'Closing draft'
  closingInput.dispatchEvent(new Event('input', { bubbles: true }))
  closingInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  await settle()
  second.element('ddlb_op').focus()
  backgroundBlur(closingInput)
  await second.close()
  finishClosing()
  await settle()
  fixture.rt.fire = realFire
  check(closingEvents.includes('modified') && !closingEvents.includes('losefocus') &&
    !document.getElementById(closingInput.getAttribute('aria-controls')),
  'Closing while a notification runs removes the popup and drops queued control events')
  fixture.ui.activate(f.window)
  f.control('dw_find').model.col = 1
  f.control('dw_find').model.row = 1
  await fixture.ui.focusDw(f.control('dw_find'), true)
  const findView = f.view.ctlViews.get(f.control('dw_find')).dw
  if (modern) check(findView.editor.getAttribute('aria-describedby').split(' ').includes(f.element('st_1').id),
    'The active Find editor preserves both its instructions and current status description')
  findView.editor.value = 'BR'
  findView.editor.dispatchEvent(new Event('input', { bubbles: true }))
  await settle()
  check(f.window.props.get('il_selectedrow') === 2 && f.control('tabpage_detail').props.get('enabled') === true &&
    f.control('dw_find').model.getItem(1, 'find') === '',
  'The reflowed Find runs the original live search before accepting its text')
  findView.editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  await f.control('dw_find').n_settext('AL')
  check(f.control('dw_find').model.getItem(1, 'find') === '' && await f.control('dw_find').n_gettext() === 'AL',
    'SetText without a visible editor retains a draft rather than bypassing acceptance')
  check(await findView.acceptPendingEdit() && f.control('dw_find').model.getItem(1, 'find') === 'AL',
    'Workspace and tab guards also accept script text when no visible editor is mounted')
  await f.control('dw_find').n_settext('BR')
  await fixture.ui.focusDw(f.control('dw_find'), true)
  check(findView.editor.value === 'BR' && f.control('dw_find').model.getItem(1, 'find') === 'AL',
    'Opening the current field transfers its script draft into either presentation without writing the buffer')
  check(await f.control('dw_find').n_accepttext() === 1 && f.control('dw_find').model.getItem(1, 'find') === 'BR',
    'The transferred script draft still uses the mounted editor acceptance path')
  f.control('tab_retrieve').props.set('selectedtab', 1)
  f.control('tab_retrieve').changed()
  f.control('dw_footer').pbSet('visible', true)
  await settle()
  check(f.element('dw_footer').getClientRects().length > 0, 'A formerly hidden auxiliary control remains reachable if original code shows it')
  f.control('dw_footer').pbSet('visible', false)
  await f.close()
  check([...f.controls.values()].every((control) => !control.listeners?.size), 'Closing the composed entry releases every control subscription')
  await checkEntryWorkflows(open, check, settle)
  if (modern) {
    const definition = fixture.rt.classes.get('w_agingintervals')
    const extra = { name: 'unmapped_entry', ancestor: 'singlelineedit', fields: [], controls: [] }
    fixture.rt.classes.set(definition.name, { ...definition, controls: [...definition.controls, extra] })
    const fallback = await open()
    check(!fallback.view.el.classList.contains('modern-entry-window') && fallback.controls.size === 24 &&
      !fallback.element('dw_find').querySelector('.modern-surface'),
    `Unexpected inherited entry controls keep the whole Classic layout and the compact Find presentation (${JSON.stringify({
      modernWindow: fallback.view.el.classList.contains('modern-entry-window'), controls: fallback.controls.size,
      findSurface: !!fallback.element('dw_find').querySelector('.modern-surface'), classes: fallback.view.el.className })})`)
    await fallback.close()
    fixture.rt.classes.set(definition.name, definition)
    window.openPresentationEntryPreview = async () => {
      // the generated-window checks that ran since register their own w_multi_entry (without the inherited Find scripts):
      // use the definitions checked here
      for (const definition of definitions) fixture.rt.classes.set(definition.name, definition)
      const preview = await open()
      window.presentationEntryPreview = preview
      return true
    }
  }
}
