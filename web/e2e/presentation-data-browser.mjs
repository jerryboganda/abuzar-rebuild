import { DwModel } from './src/dw/model.js'
import { buildPages } from './src/ui/print.js'

export async function checkDataSurfaces(fixture, check, settle) {
  const definitions = await (await fetch('./presentation-surfaces.json')).json()
  const control = fixture.sale.children.get('dw_grid')
  const view = fixture.ui.views.get(fixture.sale).ctlViews.get(control).dw
  const originalFire = fixture.rt.fire
  const events = []
  fixture.rt.fire = async (target, name, args = []) => {
    if (target === control) {
      events.push({ name, args })
      if (name === 'itemerror') return 1
    }
    return originalFire(target, name, args)
  }
  const modelFor = (name, rows = 1) => {
    const model = new DwModel(fixture.rt, name, structuredClone(definitions[name]))
    for (let row = 1; row <= rows; row++) {
      model.insertRow(0)
      if (model.colIndex('code') >= 0) model.setItem(row, 'code', row)
      if (model.colIndex('name') >= 0) model.setItem(row, 'name', `Synthetic name ${row}`)
      if (model.colIndex('limit') >= 0) model.setItem(row, 'limit', row * 30)
    }
    model.row = rows ? 1 : 0
    model.col = rows ? 1 : 0
    return model
  }
  const cell = (name, row = 1) => view.root.querySelector(`.row[data-row="${row}"] [data-obj="${name}"]`)
  const edit = async (name = 'name') => {
    const target = cell(name)
    target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    await settle()
    cell(name).click()
    await settle()
    const input = view.root.querySelector('.surface-editor')
    if (!input) throw new Error(`Modern editor missing for ${name}`)
    return input
  }
  const submit = async (input, value) => {
    input.value = value
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', keyCode: 9, bubbles: true, cancelable: true }))
    await settle()
  }
  let form = modelFor('d_aginginterval')
  control.attach(form)
  await settle()
  check(view.root.classList.contains('modern-surface') && view.root.querySelectorAll('.surface-field').length === 2,
    'A real mapped DataWindow renders all fields in a Modern form')
  check(cell('name').getAttribute('aria-labelledby')
    && document.getElementById(cell('name').getAttribute('aria-labelledby')).textContent === 'Description:',
    'Modern form labels use the original label object, not guessed captions')
  check(cell('code').getAttribute('aria-readonly') === 'true' && cell('name').classList.contains('editable'),
    'Modern form preserves protected and enterable fields')
  check(cell('name').getAttribute('aria-required') === 'true' &&
    document.getElementById(cell('name').getAttribute('aria-describedby'))?.textContent === 'Required' &&
    cell('name').closest('.surface-field').querySelector('.surface-required')?.getClientRects().length > 0,
    'The source-required description has a visible cue and an accessible requirement without changing its label')
  form.modify('code.edit.required=yes')
  control.changed()
  await settle()
  check(!cell('code').hasAttribute('aria-required') &&
    !cell('code').closest('.surface-field').querySelector('.surface-required'),
    'A protected generated code is not presented as an input the user must fill')
  form.overrides.delete('code.edit.required')
  let input = await edit()
  check(input.getAttribute('aria-labelledby') === cell('name').getAttribute('aria-labelledby'),
    'Modern editor has the same accessible name as its field')
  check(input.getAttribute('aria-required') === 'true' && !input.required &&
    input.getAttribute('aria-describedby').split(' ').some((id) => document.getElementById(id)?.textContent === 'Required'),
    'Active required editors retain their hint without enabling browser-native constraint validation')
  input.value = 'Unapplied required guidance'
  input.setSelectionRange(2, 7)
  form.modify('name.edit.required=no')
  control.changed()
  await settle()
  input = view.root.querySelector('.surface-editor')
  check(!input.hasAttribute('aria-required') && !view.root.querySelector('.surface-required') &&
    input.value === 'Unapplied required guidance' && input.selectionStart === 2 && input.selectionEnd === 7 &&
    form.getItem(1, 'name') === 'Synthetic name 1',
    'Removing a runtime requirement removes the cue without accepting or losing the draft and caret')
  form.overrides.delete('name.edit.required')
  control.changed()
  await settle()
  input = view.root.querySelector('.surface-editor')
  check(input.getAttribute('aria-required') === 'true' && input.value === 'Unapplied required guidance' &&
    input.getAttribute('aria-describedby').split(' ').every((id) => document.getElementById(id)) &&
    form.getItem(1, 'name') === 'Synthetic name 1',
    'Restoring the source requirement restores live hint references without writing the buffer')
  events.length = 0
  await submit(input, 'Edited synthetic name')
  check(form.getItem(1, 'name') === 'EDITED SYNTHETIC NAME' && events.filter((event) => event.name === 'itemchanged').length === 1,
    'Modern editor uses exactly one shared ItemChanged-to-model commit')
  check(view.root.contains(document.activeElement) && view.root.querySelector('.surface-editor') === document.activeElement,
    'Tab at the last form editor keeps the keyboard on that field, as in Classic and PowerBuilder')
  control.validateRules.set('name', 'len(gettext()) >= 3')
  input = await edit()
  await submit(input, 'x')
  input = view.root.querySelector('.surface-editor')
  check(form.getItem(1, 'name') === 'EDITED SYNTHETIC NAME' && input?.value === 'X'
    && input.getAttribute('aria-invalid') === 'true', 'Rejected Modern edits retain the entry and accessible validation state')
  control.changed()
  await settle()
  input = view.root.querySelector('.surface-editor')
  check(input?.value === 'X' && input.getAttribute('aria-invalid') === 'true'
    && view.root.querySelector('.surface-status').textContent.includes('not accepted'),
    'Redrawing a rejected edit retains its error state and validation feedback')
  await submit(input, 'Corrected synthetic name')
  input = await edit()
  input.value = 'Draft across redraw'
  input.setSelectionRange(3, 8)
  control.changed()
  await settle()
  input = view.root.querySelector('.surface-editor')
  check(input?.value === 'Draft across redraw' && input.selectionStart === 3 && input.selectionEnd === 8,
    'Model redraw retains Modern editor text and selection')
  form.modify("name.protect='0~tif(code > 0, 1, 0)'")
  control.changed()
  await settle()
  input = view.root.querySelector('.surface-editor')
  check(!view.root.querySelector('.surface-stale') && input?.value === 'Draft across redraw'
    && form.getItem(1, 'name') === 'CORRECTED SYNTHETIC NAME',
    'A runtime protection expression keeps the open draft in its editor without writing it, as the Classic view does')
  form.modify('name.protect=0')
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
  await settle()
  input = await edit()
  input.value = 'Draft from old definition'
  form = modelFor('d_contactgroup')
  control.attach(form)
  check(await control.n_accepttext() === -1, 'Model replacement rejects a stale editor before the next paint')
  await settle()
  check(view.root.querySelector('.surface-stale input')?.value === 'Draft from old definition'
    && form.getItem(1, 'name') === 'Synthetic name 1', 'A Dataobject replacement cannot apply an old editor to the new record')
  check(await control.n_accepttext() === -1, 'AcceptText cannot bypass an unresolved stale entry')
  view.root.querySelector('.surface-stale button').click()
  await settle()
  check(cell('name') && document.getElementById(cell('name').getAttribute('aria-labelledby')).textContent === 'Name:',
    'Explicit draft dismissal continues with the new definition and its label')
  input = await edit()
  input.value = 'Accepted through the runtime'
  const accepted = await control.n_accepttext()
  check(accepted === 1 && form.getItem(1, 'name') === 'Accepted through the runtime',
    'Runtime AcceptText commits the Modern editor before callers read the buffer')
  if (accepted !== 1 || view.editor) throw new Error('Runtime AcceptText left an unresolved Modern editor.')
  control.pbSet('visible', false)
  check(getComputedStyle(view.host).display === 'none', 'Runtime Hide updates the DataWindow control container')
  control.pbSet('visible', true)
  check(getComputedStyle(view.host).display !== 'none', 'Runtime Show restores the DataWindow control container')
  input = await edit()
  input.value = 'Draft before clear'
  control.pbSet('dataobject', '')
  await control.ready
  await settle()
  check(control.model === null && view.root.querySelector('.surface-stale input')?.value === 'Draft before clear',
    'Clearing the Dataobject keeps an unapplied draft visible instead of dropping it')
  form = modelFor('d_contactgroup')
  control.attach(form)
  check(await control.n_accepttext() === -1, 'A newly attached model cannot save before the stale draft is resolved')
  view.root.querySelector('.surface-stale button').click()
  await settle()
  input = await edit()
  input.value = 'x'
  let writes = 0
  form.trans = {
    db: { exec: async () => { writes++; return { rowcount: 1 } } },
    setError: () => { throw new Error('Editor rejection must not become a database error') },
    setOk: () => {},
  }
  check(await form.update() === -1 && form.getItem(1, 'name') === 'Synthetic name 1'
    && writes === 0 && view.root.querySelector('[aria-invalid=true]'),
    'Update refuses a rejected Modern entry without modifying the buffer')
  await submit(view.root.querySelector('.surface-editor'), 'Valid synthetic entry')
  const errors = []
  const onError = fixture.rt.onError
  fixture.rt.onError = (error) => { errors.push(String(error)) }
  const fire = fixture.rt.fire
  let releaseValidation
  let beginValidation
  const began = new Promise((resolve) => { beginValidation = resolve })
  const validation = new Promise((resolve) => { releaseValidation = resolve })
  fixture.rt.fire = async (target, name, args) => {
    if (target === control && name === 'itemchanged') { beginValidation(); await validation }
    return fire(target, name, args)
  }
  input = await edit()
  input.value = 'Draft during validation'
  const accepting = control.n_accepttext()
  await began
  check(await control.n_accepttext() === -1, 'Concurrent AcceptText rejects pending validation without reentering it')
  form.reset()
  form.insertRow(0)
  form.setItem(1, 'name', 'Replacement record')
  control.changed()
  releaseValidation()
  check(await accepting === -1, 'Replacing a row during validation rejects the pending commit')
  await settle()
  check(form.getItem(1, 'name') === 'Replacement record'
    && view.root.querySelector('.surface-stale input')?.value === 'Draft during validation'
    && errors.some((error) => error.includes('changed') && error.includes('not applied')),
    'Interrupted validation preserves the draft and reports why it was not applied')
  fixture.rt.fire = fire
  view.root.querySelector('.surface-stale button').click()
  await settle()
  fixture.rt.fire = async (target, name, args) => {
    if (target === control && name === 'itemchanged') {
      form.modify('name.edit.readonly=yes')
      control.changed()
    }
    return fire(target, name, args)
  }
  input = await edit()
  input.value = 'Draft before readonly'
  check(await control.n_accepttext() === 1 && form.getItem(1, 'name') === 'Draft before readonly'
    && !view.root.querySelector('.surface-stale'),
    'An entry ItemChanged accepts is written even when the script makes the field read-only, as in Classic and PowerBuilder')
  fixture.rt.fire = fire
  fixture.rt.onError = onError
  form.modify('name.edit.readonly=no')
  control.changed()
  await settle()
  // Pause one asynchronous paint to exercise typing and accepting while it is in flight.
  const pausePaint = async () => {
    const label = view.label
    let release
    let begin
    const started = new Promise((resolve) => { begin = resolve })
    const wait = new Promise((resolve) => { release = resolve })
    view.label = async (...args) => { begin(); await wait; return label.apply(view, args) }
    const painted = view.render()
    await started
    return async () => { release(); await painted; view.label = label; await settle() }
  }
  input = await edit()
  input.value = 'Before repaint'
  let finishPaint = await pausePaint()
  input.value = 'Typed during repaint'
  input.setSelectionRange(2, 6)
  await finishPaint()
  input = view.root.querySelector('.surface-editor')
  check(input?.value === 'Typed during repaint' && input.selectionStart === 2 && input.selectionEnd === 6,
    'Typing during an asynchronous repaint preserves the latest draft and selection')
  finishPaint = await pausePaint()
  check(await control.n_accepttext() === 1, 'AcceptText can commit while a repaint is pending')
  await finishPaint()
  check(!view.root.querySelector('.surface-editor') && form.getItem(1, 'name') === 'Typed during repaint',
    'An older repaint cannot resurrect an already committed editor')
  control.validateRules.clear()
  const grid = modelFor('d_agingintervallist', 10000)
  control.attach(grid)
  await settle()
  check(view.root.querySelector('[role=grid]')?.getAttribute('aria-rowcount') === '10001'
    && view.root.querySelectorAll('.surface-row').length <= 61,
    'Modern grid exposes 10000 logical rows while rendering a bounded window')
  // The plan's required report/grid size; timings are recorded for the reference-machine assessment, not asserted here.
  const huge = modelFor('d_agingintervallist', 100000)
  const attachStart = performance.now()
  control.attach(huge)
  await settle()
  ;(window.presentationPerformance ??= []).push({ name: 'grid-100000-rows-attach-and-first-paint', rows: 100000, milliseconds: Math.round(performance.now() - attachStart) })
  check(view.root.querySelector('[role=grid]')?.getAttribute('aria-rowcount') === '100001'
    && view.root.querySelectorAll('.surface-row').length <= 61,
    'Modern grid exposes 100000 logical rows while rendering a bounded window')
  control.attach(grid)
  await settle()
  check(view.root.querySelectorAll('th[scope=col]').length === 2
    && view.root.querySelectorAll('[data-obj][tabindex="0"]').length === 1, 'Modern grid has named columns and one keyboard entry point')
  cell('code').focus()
  finishPaint = await pausePaint()
  cell('name').focus()
  await finishPaint()
  check(document.activeElement === cell('name'),
    'An asynchronous grid repaint preserves a newer cell focus instead of restoring its stale snapshot')
  const outside = document.querySelector('.presentation-sidebar input')
  finishPaint = await pausePaint()
  outside.focus()
  await finishPaint()
  check(document.activeElement === outside,
    'An asynchronous grid repaint cannot reclaim focus after the user leaves the DataWindow')
  const first = cell('code')
  first.focus()
  first.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }))
  await settle()
  check(grid.row === 2 && document.activeElement === cell('code', 2)
    && events.some((event) => event.name === 'rowfocuschanged' && event.args[0] === 2),
    'Grid keyboard movement retains shared row and item focus events')
  grid.row = 9000
  grid.col = 2
  control.changed()
  await settle()
  check(cell('name', 9000)?.textContent === 'Synthetic name 9000'
    && cell('name', 9000).closest('tr').getAttribute('aria-rowindex') === '9001',
    'Programmatic row changes reveal the correct virtual row and accessibility index')
  const revealed = cell('name', 9000).getBoundingClientRect()
  const gridViewport = view.root.getBoundingClientRect()
  const heading = view.root.querySelector('thead').getBoundingClientRect()
  check(revealed.top >= heading.bottom && revealed.bottom <= gridViewport.bottom,
    'A programmatically selected virtual row is visible below the sticky column headings')
  const renderedRowHeight = view.root.querySelector('.surface-row').getBoundingClientRect().height
  check(Math.abs(renderedRowHeight - parseFloat(view.root.style.getPropertyValue('--surface-row-height'))) < 1,
    'Virtual row height matches the measured table row including borders')
  view.root.scrollTop = 5000 * parseFloat(view.root.style.getPropertyValue('--surface-row-height'))
  view.root.dispatchEvent(new Event('scroll'))
  await settle()
  check(view.root.querySelectorAll('.surface-row').length <= 61
    && view.root.querySelectorAll('[data-obj][tabindex="0"]').length === 1,
    'Scrolling a large grid retains bounded rendering and a keyboard entry point')
  grid.modify('name.visible=0')
  grid.modify('name.edit.required=yes')
  control.changed()
  await settle()
  check(view.root.querySelectorAll('th').length === 1 && !view.root.querySelector('[data-obj=name]') &&
    !view.root.querySelector('.surface-required'),
    'Runtime column visibility removes the field and its header together')
  const empty = modelFor('d_agingintervallist', 0)
  control.attach(empty)
  await settle()
  check(view.root.querySelector('.surface-empty')?.textContent === 'No rows to display.', 'Modern data surfaces expose a real empty state')
  const changed = modelFor('d_aginginterval')
  changed.def.objects.push({ name: 'new_business_label', type: 'text', band: 'detail', text: 'New field', x: '0', y: '100', width: '200', height: '80' })
  control.attach(changed)
  await settle()
  check(!view.root.classList.contains('modern-surface') && view.root.querySelector('.surface-status')?.textContent.includes('Unmapped object: new_business_label'),
    'An incomplete mapping visibly retains Classic instead of hiding added content')
  view.root.querySelector('[data-obj=name]').click()
  await settle()
  view.root.querySelector('.dw-edit').value = 'Classic compatibility draft'
  control.changed()
  await settle()
  check(!view.root.classList.contains('modern-surface')
    && view.root.querySelector('.dw-edit')?.value === 'Classic compatibility draft',
    'An unmapped Classic editor retains its normal redraw behavior inside the Modern workspace')
  view.root.querySelector('.dw-edit').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  for (const [name, definition] of Object.entries(definitions)) {
    control.attach(modelFor(name))
    await settle()
    check(view.root.classList.contains('modern-surface')
      && view.root.querySelectorAll('.surface-value').length === definition.objects.filter((object) =>
        ['column', 'compute'].includes(object.type) && object.visible !== '0').length,
      `${name}: actual definition renders every visible mapped field`)
  }
  const detail = modelFor('d_agingintervaldetail', 3)
  control.attach(detail)
  await settle()
  check(cell('compute_1', 2)?.textContent === '2' && cell('compute_2', 2)?.textContent === '>=' &&
    cell('limit', 2)?.textContent === '60', 'Detail calculations use the existing row expression evaluator and numeric formatter')
  check(cell('compute_1').getAttribute('aria-readonly') === 'true' &&
    view.root.querySelector('[role=grid]').getAttribute('aria-colcount') === '3',
    'Computed cells are readonly and all three presentation columns are exposed')
  check(!view.root.querySelector('[data-obj=code]') && detail.getItem(1, 'code') === 1,
    'Hidden business keys remain in the data model without becoming presentation fields')
  check(document.getElementById(cell('compute_2').dataset.labelledby).textContent === 'Comparison',
    'An originally blank comparison heading has an explicit accessible label')
  const columnBeforeRequiredCheck = detail.col
  detail.modify('limit.editmask.required=yes compute_1.edit.required=yes')
  control.changed()
  await settle()
  check(cell('limit').getAttribute('aria-required') === 'true' &&
    !cell('compute_1').hasAttribute('aria-required') && view.root.querySelectorAll('thead .surface-required').length === 1,
    'Grid column guidance identifies source-required input but never marks a computation required')
  input = await edit('limit')
  check(input.getAttribute('aria-required') === 'true' && !input.required &&
    input.getAttribute('aria-describedby').split(' ').some((id) => document.getElementById(id)?.textContent === 'Required'),
    'A grid editor references its required column guidance without changing validation')
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
  detail.overrides.delete('limit.editmask.required')
  detail.overrides.delete('compute_1.edit.required')
  await control.n_setcolumn(columnBeforeRequiredCheck)
  await settle()
  events.length = 0
  cell('compute_1').focus()
  const key = async (name, key) => {
    cell(name).dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
    await settle()
  }
  await key('compute_1', 'ArrowRight')
  check(document.activeElement === cell('compute_2') && detail.col === 1 &&
    !events.some((event) => event.name === 'itemfocuschanged'),
    'Navigating a computation retains the real data column without a fictitious item-focus event')
  check(cell('compute_2').tabIndex === 0 && view.root.querySelectorAll('[role=gridcell][tabindex="0"]').length === 1,
    'Computed-cell navigation retains one roving keyboard entry point')
  await key('compute_2', 'Enter')
  check(!view.root.querySelector('.surface-editor') && detail.col === 1,
    'Computed fields cannot open a text editor or become a writable data column')
  await key('compute_2', 'ArrowRight')
  check(document.activeElement === cell('limit') && detail.col === 2 &&
    events.filter((event) => event.name === 'itemfocuschanged').length === 1,
    'Leaving computations for a data column raises the normal item-focus event once')
  await key('limit', 'ArrowLeft')
  events.length = 0
  control.changed()
  await settle()
  check(document.activeElement === cell('compute_2') && cell('compute_2').tabIndex === 0,
    'Ordinary redraws retain calculated-cell focus independently of the model column')
  await control.n_setcolumn('limit')
  await settle()
  check(document.activeElement === cell('limit') && cell('limit').tabIndex === 0 &&
    !events.some((event) => event.name === 'itemfocuschanged'),
    'Explicit SetColumn reselects an unchanged data column without inventing an item-focus event')
  await key('limit', 'ArrowLeft')
  await key('compute_2', 'ArrowDown')
  check(document.activeElement === cell('compute_2', 2) && detail.row === 2 && detail.col === 2 &&
    events.filter((event) => event.name === 'rowfocuschanged').length === 1 &&
    !events.some((event) => event.name === 'itemfocuschanged'),
    'Vertical computed-cell navigation preserves the data column and emits only row focus')
  await control.n_setrow(1)
  await control.n_setcolumn('limit')
  await settle()
  input = await edit('limit')
  input.value = '45'
  check(await control.n_accepttext() === 1 && detail.getItem(1, 'limit') === 45,
    'The editable detail limit uses shared acceptance beside readonly calculations')
  await settle()
  input = await edit('limit')
  await submit(input, 'invalid')
  input = view.root.querySelector('.surface-editor')
  check(input?.value === 'invalid' && input.getAttribute('aria-invalid') === 'true' &&
    detail.getItem(1, 'limit') === 45 && cell('compute_1').textContent === '1',
    'Invalid numeric detail entry retains the draft and computed context without writing a value')
  input.value = '75'
  check(await control.n_accepttext() === 1 && detail.getItem(1, 'limit') === 75,
    'A corrected numeric detail draft commits through the shared acceptance path')
  await settle()
  const step = (direction, row = 1) => cell('limit', row).querySelector(`button[data-direction="${direction}"]`)
  input = await edit('limit')
  check(input.getAttribute('role') === 'spinbutton' && input.getAttribute('aria-valuemin') === '0' &&
    input.getAttribute('aria-valuemax') === '999999' && input.getAttribute('aria-valuenow') === '75',
    'The numeric editor exposes its actual spin bounds and current value')
  events.length = 0
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }))
  await settle()
  check(input.value === '76' && detail.getItem(1, 'limit') === 75 &&
    events.filter((event) => event.name === 'ue_dwnkey').length === 1 &&
    !events.some((event) => event.name === 'itemchanged'),
    'Up changes only the draft and preserves exactly one original key notification')
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', ctrlKey: true, bubbles: true, cancelable: true }))
  check(input.value === '76', 'Modified arrow shortcuts are not captured by numeric stepping')
  input.click()
  check(view.root.querySelector('.surface-editor') === input && input.value === '76',
    'Clicking inside a Modern editor cannot recreate it or discard the draft')
  input.value = '1,000'
  input.dispatchEvent(new Event('input', { bubbles: true }))
  step(1).click()
  await settle()
  input = view.root.querySelector('.surface-editor')
  check(input?.value === '1001' && input.getAttribute('aria-valuenow') === '1001' &&
    document.activeElement === input && detail.getItem(1, 'limit') === 75,
    'Pointer stepping retains grouped-number drafts, focus and accessible values across redraw')
  check([...cell('limit').querySelectorAll('button')].every((button) => button.tabIndex === -1),
    'Spin buttons do not multiply the grid keyboard entry points')
  events.length = 0
  check(await control.n_accepttext() === 1 && detail.getItem(1, 'limit') === 1001 &&
    events.filter((event) => event.name === 'itemchanged').length === 1,
    'Stepped text goes through exactly one normal ItemChanged acceptance')
  await settle()
  step(-1).click()
  await settle()
  input = view.root.querySelector('.surface-editor')
  check(input?.value === '1000' && detail.getItem(1, 'limit') === 1001,
    'A pointer step opens the real editor without prematurely writing the buffer')
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  await settle()
  check(!view.root.querySelector('.surface-editor') && detail.getItem(1, 'limit') === 1001,
    'Escape cancels an unaccepted numeric adjustment')
  input = await edit('limit')
  input.value = '999999'
  input.dispatchEvent(new Event('input', { bubbles: true }))
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }))
  check(input.value === '999999' && step(1).disabled, 'The upper spin bound cannot wrap or overflow')
  input.value = '0'
  input.dispatchEvent(new Event('input', { bubbles: true }))
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }))
  check(input.value === '0' && step(-1).disabled, 'The lower spin bound cannot wrap or become negative')
  input.value = ''
  input.dispatchEvent(new Event('input', { bubbles: true }))
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }))
  check(input.value === '' && input.getAttribute('aria-invalid') === 'true' &&
    view.root.querySelector('.surface-status').textContent.includes('Enter a valid number'),
    'Stepping an empty draft explains recovery instead of silently inventing zero')
  input.value = '75'
  input.dispatchEvent(new Event('input', { bubbles: true }))
  control.validateRules.set('limit', 'number(gettext()) < 76')
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }))
  check(await control.n_accepttext() === -1 && detail.getItem(1, 'limit') === 1001 &&
    view.root.querySelector('.surface-editor')?.value === '76',
    'Stepping cannot bypass the original validation path and rejected adjustments stay editable')
  control.validateRules.delete('limit')
  input = view.root.querySelector('.surface-editor')
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  await settle()
  await control.n_modify("limit.editmask.spinincr=5 limit.editmask.spinrange='0~2000'")
  await settle()
  step(1).click()
  await settle()
  input = view.root.querySelector('.surface-editor')
  check(input?.value === '1006' && input.getAttribute('aria-valuemax') === '2000',
    'Runtime spin increment and range changes reach the actual editor')
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  await settle()
  await control.n_modify('limit.protect=1')
  await settle()
  check(step(-1).disabled && step(1).disabled && cell('limit').getAttribute('aria-readonly') === 'true',
    'Protected numeric fields cannot be changed through their spin buttons')
  await control.n_modify('limit.protect=0 limit.editmask.spin=no')
  await settle()
  check(!cell('limit').querySelector('.surface-spin-controls'), 'Turning Spin off removes its interactive affordance')
  await control.n_modify('limit.editmask.spin=yes limit.editmask.spinincr=0')
  await settle()
  check(!view.root.classList.contains('modern-surface') &&
    view.root.querySelector('.surface-status').textContent.includes('positive integer increment'),
    'Unsupported runtime spin configuration retains Classic with a visible diagnostic')
  await control.n_modify('limit.editmask.spinincr=1')
  await settle()
  input = await edit('limit')
  input.value = '88'
  await control.n_modify('limit.editmask.spinincr=0')
  await settle()
  const classicDraft = view.root.querySelector('.dw-edit')
  check(!view.root.classList.contains('modern-surface') && !view.root.querySelector('.surface-stale') &&
    classicDraft?.value === '88' && detail.getItem(1, 'limit') === 1001,
    'An unsupported spin change keeps the open draft, unwritten, in the Classic layout instead of dropping or committing it')
  classicDraft?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
  await control.n_modify('limit.editmask.spinincr=1')
  await settle()
  await control.n_deleterow(1)
  await settle()
  check(cell('compute_1', 1)?.textContent === '1' && cell('compute_1', 2)?.textContent === '2' &&
    cell('limit', 1)?.textContent === '60', 'Row deletion recalculates serial numbers without changing the surviving limits')
  await control.n_insertrow(1)
  await control.n_setitem(1, 'limit', 15)
  await control.n_setcolumn('limit')
  await settle()
  check(cell('compute_1', 1)?.textContent === '1' && cell('compute_1', 3)?.textContent === '3' &&
    cell('limit', 1)?.textContent === '15' && cell('limit', 2)?.textContent === '60' && cell('limit').tabIndex === 0,
    'Runtime row insertion recalculates serial numbers and preserves explicit data-column selection')
  const detailPages = await buildPages(control)
  check(detailPages.length > 0 && detailPages.some((page) => page.querySelector('[data-obj=compute_1]')) &&
    !detailPages.some((page) => page.querySelector('.modern-surface')),
    'Computed Modern grids retain the original independent Classic print layout')
  const replacedDuringStep = modelFor('d_agingintervaldetail')
  control.attach(replacedDuringStep)
  await settle()
  const beforeStepFire = fixture.rt.fire
  let releaseStep
  let startStep
  const stepStarted = new Promise((resolve) => { startStep = resolve })
  const stepWaiting = new Promise((resolve) => { releaseStep = resolve })
  fixture.rt.fire = async (target, name, args) => {
    if (target === control && name === 'clicked') { startStep(); await stepWaiting }
    return beforeStepFire(target, name, args)
  }
  step(1).click()
  await stepStarted
  control.attach(modelFor('d_contactgroup'))
  releaseStep()
  await settle()
  fixture.rt.fire = beforeStepFire
  check(replacedDuringStep.getItem(1, 'limit') === 30 && control.model.name === 'd_contactgroup' &&
    !view.root.querySelector('.surface-editor'),
    'A delayed pointer adjustment cannot edit a replaced model or create an editor for a stale field')
  control.attach(modelFor('d_contactgroup'))
  await settle()
  const pages = await buildPages(control)
  check(pages.length > 0 && !pages.some((page) => page.querySelector('.modern-surface')),
    'Mapped Modern screen fields do not change Classic print rendering')
  let priorCalls = 0
  const owned = modelFor('d_contactgroup')
  const prior = async () => { priorCalls++; return 1 }
  owned.acceptText = prior
  control.attach(owned)
  check(await control.n_accepttext() === 1 && priorCalls === 1,
    'Model attachment binds acceptance synchronously and preserves the existing acceptance callback')
  control.attach(modelFor('d_contactgroup'))
  check(owned.acceptText === prior, 'Model replacement releases the previous model acceptance callback')
  const activeAcceptance = control.model.acceptText
  await view.paint(owned)
  check(control.model.acceptText === activeAcceptance && owned.acceptText === prior,
    'An outdated repaint cannot steal acceptance ownership from the current model')
  await settle()
  const isolated = new control.constructor(fixture.rt, 'dw_synthetic_disposal')
  isolated.attach(owned)
  const disposable = new view.constructor(isolated, document.createElement('div'))
  disposable.dispose()
  check(owned.acceptText === prior, 'Disposing a Modern view restores the model acceptance callback')
  window.presentationSurfaceFixture = { control, view, modelFor }
  window.previewPresentationSurface = async ({ name, theme, density, scale, width }) => {
    window.presentationSurfacePreview?.dispose()
    const host = document.createElement('div')
    host.id = 'presentation-surface-preview'
    host.style.cssText = `position:fixed;left:16px;top:16px;width:${width}px;height:520px;z-index:2147483000`
    document.body.append(host)
    const previewControl = new control.constructor(fixture.rt, 'dw_synthetic_visual')
    const model = modelFor(name, definitions[name].datawindow.processing === '1' ? 10000 : 1)
    previewControl.attach(model)
    const preview = new view.constructor(previewControl, host)
    preview.root.dataset.theme = theme
    preview.root.dataset.density = density
    preview.root.style.setProperty('--p-scale', String(scale / 100))
    window.presentationSurfacePreview = {
      view: preview, model, dispose: () => { preview.dispose(); host.remove() },
    }
    await preview.render()
  }
  fixture.rt.fire = originalFire
}
