import { Runtime, Ref, Frame } from './src/runtime/interp.js'
import { parseScriptFile } from './src/pbscript/parser.js'
import { DwModel } from './src/dw/model.js'
import { PBObject } from './src/runtime/object.js'

export async function checkTabSurfaces(fixture, check, settle) {
  const source = await (await fetch('./presentation-tabs.json')).json()
  const surfaces = await (await fetch('./presentation-surfaces.json')).json()
  const name = 'w_synthetic_tabs'
  const field = (name, value, type = 'long') => ({ name, value, type, attr: '0xbc' })
  const { file, errors } = parseScriptFile(`// window ${name} (synthetic) ancestor: window
// ${name}.wf_commitform() returns boolean
return this.ib_fixturecommit
// ${name}.ue_save() returns 0
this.il_saverequests = this.il_saverequests + 1
// ${name}.ue_list() returns 0
this.il_listrequests = this.il_listrequests + 1
`)
  if (errors.length) throw new Error(JSON.stringify(errors))
  const routines = new Map([
    ['tab_retrieve', new Map(source.routines.map((routine) => [routine.name, [routine]]))],
    [name, new Map(file.routines.map((routine) => [routine.name, [routine]]))],
    ['dw_limits', new Map([['editchanged', [source.editChanged]]])],
    ['dw_find', new Map([['editchanged', [source.findChanged]]])],
  ])
  fixture.rt.classes.set('f_binarysearch', {
    name: 'f_binarysearch', kind: 'function', ancestor: 'function_object', library: 'functions',
    fields: [], controls: [],
    routines: new Map([['f_binarysearch', new Map(source.searchRoutines.map((routine) => [routine.name, [routine]]))]]),
  })
  fixture.rt.classes.set(name, {
    name, kind: 'window', ancestor: 'window', library: 'synthetic', routines,
    fields: [field('title', 'Synthetic form tabs / inherited change confirmation', 'string'),
      field('width', 2600), field('height', 1600), field('windowstate', 2), field('windowtype', 1),
      field('il_saverequests', 0), field('il_listrequests', 0)],
    controls: [{
      name: 'tab_retrieve', ancestor: 'tab', fields: [...source.fields, field('x', 60), field('y', 60), field('width', 2200), field('height', 1100)],
      controls: source.pages.map((page) => ({
        name: page.name, ancestor: 'userobject', fields: page.fields,
        controls: [{ name: 'sle_reference', ancestor: 'singlelineedit', fields: [
          field('text', 'Synthetic retained draft', 'string'), field('x', 30), field('y', 30),
          field('width', 1800), field('height', 110), field('taborder', 10),
        ], controls: [] }, ...(page.name === 'tabpage_detail' ? [{
          name: 'dw_limits', ancestor: 'datawindow', fields: [
            field('x', 30), field('y', 180), field('width', 1800), field('height', 500),
          ], controls: [],
        }] : [{
          name: 'dw_find', ancestor: 'datawindow', fields: [
            field('x', 30), field('y', 180), field('width', 1800), field('height', 120),
          ], controls: [],
        }, {
          name: 'dw_matches', ancestor: 'datawindow', fields: [
            field('x', 30), field('y', 330), field('width', 1800), field('height', 700),
          ], controls: [],
        }])],
      })),
    }],
  })
  const oldFire = fixture.rt.fire
  const events = []
  fixture.rt.fire = async (target, event, args) => {
    let owner = target
    while (owner && owner.className !== name) owner = owner.parent
    if (!owner) return oldFire(target, event, args)
    events.push({ target, event, args })
    if (event === 'itemerror') return 1
    if (target === owner) return oldFire(target, event, args)
    return Runtime.prototype.fire.call(fixture.rt, target, event, args)
  }
  const open = async () => {
    let window
    const ref = new Ref(() => window, (value) => { window = value })
    ref.name = name
    await fixture.rt.sys.get('opensheet').fn(fixture.rt, [ref, fixture.frame], new Frame(null, null, 0))
    await settle()
    const view = fixture.ui.views.get(window)
    const control = window.children.get('tab_retrieve')
    const pages = [...control.children.values()]
    const root = view.ctlViews.get(control).el
    const tabs = [...root.querySelectorAll(':scope > .strip > .t')]
    const panels = [...root.querySelectorAll(':scope > .page')]
    const input = panels[0].querySelector('input')
    const detail = pages[0].children.get('dw_limits')
    const model = new DwModel(fixture.rt, 'd_agingintervaldetail', structuredClone(surfaces.d_agingintervaldetail))
    model.insertRow(0)
    model.setItem(1, 'code', 1)
    model.setItem(1, 'limit', 30)
    detail.attach(model)
    window.props.set('id_detail', detail)
    const menu = new PBObject(fixture.rt, 'menu', 'menu')
    const fileMenu = new PBObject(fixture.rt, 'menu', 'menu')
    const save = new PBObject(fixture.rt, 'menu', 'menu')
    menu.children.set('m_file', fileMenu)
    fileMenu.children.set('m_save', save)
    for (const action of ['m_retrieve', 'm_next', 'm_previous']) {
      fileMenu.children.set(action, new PBObject(fixture.rt, 'menu', 'menu'))
    }
    window.props.set('im_menu', menu)
    const search = pages[1].children.get('dw_find')
    const lookup = pages[1].children.get('dw_matches')
    const searchModel = new DwModel(fixture.rt, 'd_find', structuredClone(source.findDefinition))
    searchModel.insertRow(0)
    searchModel.setItem(1, 'find', '')
    searchModel.row = 1
    searchModel.col = 1
    search.attach(searchModel)
    const matches = new DwModel(fixture.rt, 'd_agingintervallist', structuredClone(surfaces.d_agingintervallist))
    for (const [index, text] of ['ALPHA', 'BRAVO', 'CHARLIE'].entries()) {
      matches.insertRow(0)
      matches.setItem(index + 1, 'code', index + 1)
      matches.setItem(index + 1, 'name', text)
    }
    lookup.attach(matches)
    window.props.set('id_dwcontrol', lookup)
    window.props.set('id_list', lookup)
    window.props.set('ii_colindex', 2)
    window.props.set('ii_type', 1)
    window.props.set('is_sortsequence', 'A')
    await settle()
    const reset = () => {
      window.props.set('editflag', true)
      window.props.set('i_editmode', 1)
      window.props.set('ib_fixturecommit', false)
      window.props.set('il_saverequests', 0)
      window.props.set('il_listrequests', 0)
      control.props.set('selectedtab', 1)
      control.changed()
      input.value = 'Synthetic retained draft'
      input.dispatchEvent(new Event('input', { bubbles: true }))
      events.length = 0
    }
    reset()
    return { window, view, control, pages, root, tabs, panels, input, detail, model, save, search, lookup, matches, reset }
  }
  const f = await open()
  const modern = fixture.session.activeMode === 'modern'
  const respond = async (label) => {
    const message = document.querySelector('.presentation-runtime-dialog[open],.msgbox')
    check(message?.textContent.includes("Yes to save changes that you've typed"),
      `${modern ? 'Modern' : 'Classic'}: the recovered SelectionChanging script requests an unsaved-change decision`)
    const button = [...(message?.querySelectorAll('button') ?? [])].find((button) => button.textContent.trim() === label)
    if (!button) throw new Error(`Missing inherited tab confirmation action: ${label}`)
    button.click()
    await settle()
  }
  for (const [decision, commit, selected] of [['Cancel', false, 1], ['No', false, 2], ['Yes', false, 1], ['Yes', true, 2]]) {
    f.reset()
    f.window.props.set('ib_fixturecommit', commit)
    f.tabs[1].click()
    await settle()
    check(f.control.props.get('selectedtab') === 1 && getComputedStyle(f.panels[0]).display !== 'none',
      'A pending change confirmation does not hide the original page')
    f.tabs[1].click()
    check(events.filter((event) => event.event === 'selectionchanging').length === 1, 'Repeated activation cannot open a second change confirmation')
    await respond(decision)
    check(f.control.props.get('selectedtab') === selected && f.input.value === 'Synthetic retained draft',
      `${decision}/${commit}: the original decision controls the page change without replacing the input`)
    check(events.filter((event) => event.event === 'selectionchanged').length === (selected === 2 ? 1 : 0),
      `${decision}/${commit}: SelectionChanged runs exactly once only for accepted transitions`)
    check(f.window.props.get('il_saverequests') === (decision === 'Yes' ? 1 : 0),
      `${decision}/${commit}: only Yes requests the original save event`)
    check(f.window.props.get('il_listrequests') === (selected === 2 ? 1 : 0),
      `${decision}/${commit}: only an accepted transition invokes the original list event`)
    if (decision === 'No') check(f.window.props.get('editflag') === false && f.window.props.get('i_editmode') === 2,
      'No preserves the recovered discard/edit-mode transition')
  }
  f.reset()
  f.window.props.set('editflag', false)
  if (modern) {
    const key = (element, key, extra = {}) => element.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...extra }))
    check(f.root.querySelector('[role=tablist]')?.getAttribute('aria-label') && f.tabs.every((tab, index) =>
      tab.getAttribute('aria-controls') === f.panels[index].id && f.panels[index].getAttribute('aria-labelledby') === tab.id),
    'Modern form tabs expose a named tab list and paired tab panels')
    check(f.tabs[0].textContent.trim() === 'Detail' && f.tabs[1].textContent.trim() === 'List',
      'Modern form tabs retain actual inherited captions')
    f.tabs[0].focus()
    key(f.tabs[0], 'ArrowRight')
    check(document.activeElement === f.tabs[1] && f.control.props.get('selectedtab') === 1 && events.every((event) => !event.event.startsWith('selection')),
      'Arrow navigation moves focus without invoking business selection events')
    key(f.tabs[1], 'Home')
    check(document.activeElement === f.tabs[0], 'Home focuses the first available form tab')
    key(f.tabs[0], 'End')
    key(f.tabs[1], ' ')
    await settle()
    check(f.control.props.get('selectedtab') === 2 && f.tabs[1].getAttribute('aria-selected') === 'true' &&
      f.panels[0].hidden && !f.panels[1].hidden, 'Space explicitly activates the focused page')
    check(f.tabs.filter((tab) => tab.tabIndex >= 0).length === 1, 'Form tabs retain a single tab-list entry point')
    f.pages[1].pbSet('text', '&Results')
    check(f.tabs[1].textContent.trim() === 'Results', 'Form-tab names follow original runtime text changes')
    f.pages[1].pbSet('text', 'List')
    f.pages[1].pbSet('enabled', false)
    check(f.tabs[1].getAttribute('aria-disabled') === 'true' && document.activeElement === f.tabs[0],
      'Disabling a focused form tab removes its tab stop and restores available focus')
    key(f.tabs[0], 'ArrowRight')
    check(document.activeElement === f.tabs[0], 'Keyboard navigation skips unavailable pages')
    f.pages[1].pbSet('enabled', true)
    f.pages[1].pbSet('visible', false)
    check(getComputedStyle(f.tabs[1]).display === 'none' && f.tabs[1].getAttribute('aria-selected') === 'false',
      'Hidden form pages leave both selection semantics and the tab sequence')
    f.pages[1].pbSet('visible', true)
    f.control.pbSet('selectedtab', 1)
    await settle()
    f.input.focus()
    f.control.pbSet('selectedtab', 2)
    await settle()
    check(document.activeElement === f.tabs[1] && f.panels[0].hidden,
      'Script page changes do not leave keyboard focus inside a hidden panel')
    const old = f.control.props.get('selectedtab')
    key(f.tabs[1], 'ArrowLeft', { ctrlKey: true })
    check(document.activeElement === f.tabs[1] && f.control.props.get('selectedtab') === old,
      'Form tab navigation does not consume modified shortcuts')
    fixture.ui.focus(f.control)
    check(document.activeElement === f.tabs[1], 'Runtime SetFocus reaches the active semantic tab')
    f.control.pbSet('enabled', false)
    f.tabs[0].click()
    await settle()
    check(f.control.props.get('selectedtab') === old && f.tabs.every((tab) => tab.tabIndex === -1),
      'Disabled tab controls reject pointer activation and keyboard entry')
    f.control.pbSet('enabled', true)
  } else {
    check(!f.root.querySelector('[role=tablist]') && !f.root.classList.contains('keyboard-tabs') &&
      getComputedStyle(f.root.querySelector('.strip')).height === '23px', 'Classic retains its original tab layout while honoring the change guard')
  }
  f.reset()
  f.tabs[1].click()
  await settle()
  f.pages[1].pbSet('visible', false)
  await respond('No')
  check(f.control.props.get('selectedtab') === 1 && !events.some((event) => event.event === 'selectionchanged'),
    'A page hidden while confirmation is open cannot receive a stale selection')
  f.pages[1].pbSet('visible', true)
  const fire = fixture.rt.fire
  const detailView = f.view.ctlViews.get(f.detail).dw
  const editLimit = async (value) => {
    const cell = detailView.root.querySelector('.row[data-row="1"] [data-obj=limit]')
    cell.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    await settle()
    detailView.root.querySelector('.row[data-row="1"] [data-obj=limit]').click()
    await settle()
    const editor = detailView.editor
    if (!(editor instanceof HTMLInputElement)) throw new Error('Tab fixture did not open the numeric editor')
    editor.value = value
    return editor
  }
  for (const [start, accepted] of [['blur', true], ['blur', false], ['pointer', true], ['pointer', false]]) {
    f.reset()
    f.window.props.set('editflag', false)
    f.model.setItem(1, 'limit', 30)
    f.detail.changed()
    await settle()
    const gate = Promise.withResolvers()
    let changes = 0
    fixture.rt.fire = async (target, event, args) => {
      if (target === f.detail && event === 'itemchanged') {
        changes++
        await gate.promise
        f.window.props.set('editflag', true)
        return accepted ? 0 : 1
      }
      return fire(target, event, args)
    }
    const editor = await editLimit('31')
    if (start === 'blur') editor.blur()
    else {
      const press = new MouseEvent('mousedown', { button: 0, bubbles: true, cancelable: true })
      f.tabs[1].dispatchEvent(press)
      check(press.defaultPrevented && document.activeElement === editor,
        'Pressing a form tab leaves the active editor focused until controlled acceptance')
    }
    f.tabs[1].click()
    await settle()
    check(f.control.props.get('selectedtab') === 1 && !events.some((event) => event.event === 'selectionchanging'),
      `${start}: form navigation waits for field validation before the original tab guard`)
    gate.resolve()
    await settle()
    if (accepted) {
      await respond('Cancel')
      check(f.model.getItem(1, 'limit') === 31 && f.control.props.get('selectedtab') === 1,
        'The confirmation reads the accepted buffer value and Cancel retains its page')
    } else {
      check(f.model.getItem(1, 'limit') === 30 && f.control.props.get('selectedtab') === 1 &&
        !events.some((event) => event.event === 'selectionchanging'), 'Rejected field validation cannot hide the page or request a premature save')
      check(detailView.editor?.value === '31', 'A rejected field retains its draft during attempted tab navigation')
    }
    check(changes === 1, 'Waiting for an editor does not duplicate ItemChanged')
    if (detailView.editor) detailView.editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    fixture.rt.fire = fire
  }
  f.reset()
  f.model.setItem(1, 'limit', 30)
  f.detail.changed()
  await settle()
  f.window.props.set('editflag', false)
  f.save.props.set('enabled', false)
  const typed = await editLimit('31')
  typed.dispatchEvent(new Event('input', { bubbles: true }))
  await settle()
  check(f.window.props.get('editflag') === true && f.save.props.get('enabled') === true && f.model.getItem(1, 'limit') === 30,
    'Typing runs the recovered EditChanged handler and enables Save before committing the item')
  check(await f.detail.n_gettext() === '31' && f.model.getItem(1, 'limit') === 30,
    'GetText reads the unaccepted input without changing the stored item')
  await f.detail.n_setfocus()
  await f.detail.n_selecttext()
  await fixture.rt.flushPosted()
  await settle()
  check(detailView.editor.value === '31', 'Returning runtime focus does not replace an unaccepted draft with the stored item')
  const notifications = events.filter((event) => event.event === 'editchanged').length
  check(await f.detail.n_settext('32') === 1 && detailView.editor.value === '32' && f.model.getItem(1, 'limit') === 30,
    'SetText replaces the active input without committing it')
  check(events.filter((event) => event.event === 'editchanged').length === notifications,
    'Programmatic SetText does not invent a user EditChanged notification')
  if (modern) check(detailView.editor.getAttribute('aria-valuenow') === '32',
    'Programmatic numeric text updates its accessibility value without a user-input event')
  let validatingText
  fixture.rt.fire = async (target, event, args) => {
    if (target === f.detail && event === 'itemchanged') {
      validatingText = await target.n_gettext()
      await target.n_settext('33')
      return 1
    }
    return fire(target, event, args)
  }
  check(!(await detailView.acceptPendingEdit()) && validatingText === '32' && f.model.getItem(1, 'limit') === 30,
    'Validation can inspect and replace the edit text without writing the model')
  check(detailView.editor?.value === '33' && document.activeElement === detailView.editor,
    'Rejected validation retains the script-corrected text rather than restoring the stale submission')
  f.detail.changed()
  await settle()
  check(detailView.editor?.value === '33' && await f.detail.n_gettext() === '33',
    'A redraw keeps the corrected input and transfers live-text ownership')
  if (modern) check(detailView.editor.getAttribute('aria-valuenow') === '33',
    'Redrawing a corrected numeric input retains its accessibility value')
  fixture.rt.fire = fire
  check(await detailView.acceptPendingEdit() && f.model.getItem(1, 'limit') === 33,
    'The next explicit acceptance validates and stores the corrected text')
  f.reset()
  f.window.props.set('editflag', false)
  const pendingInput = await editLimit('34')
  const gate = Promise.withResolvers()
  const sequence = []
  fixture.rt.fire = async (target, event, args) => {
    if (target === f.detail && event === 'editchanged') {
      sequence.push(`start:${args[2]}`)
      if (args[2] === '34') await gate.promise
      const result = await fire(target, event, args)
      sequence.push(`end:${args[2]}`)
      return result
    }
    if (target === f.detail && event === 'itemchanged') sequence.push('accept')
    return fire(target, event, args)
  }
  pendingInput.dispatchEvent(new Event('input', { bubbles: true }))
  pendingInput.value = '35'
  pendingInput.dispatchEvent(new Event('input', { bubbles: true }))
  f.tabs[1].click()
  await settle()
  check(sequence.join(',') === 'start:34' && f.control.props.get('selectedtab') === 1 && f.model.getItem(1, 'limit') === 33,
    'Rapid input events remain ordered and form navigation waits for their completion')
  check(await f.detail.n_accepttext() === -1 && f.model.getItem(1, 'limit') === 33,
    'AcceptText cannot falsely succeed while input events are still pending')
  gate.resolve()
  await settle()
  check(sequence.join(',') === 'start:34,end:34,start:35,end:35,accept',
    'Every input notification completes before ItemChanged accepts the final draft')
  await respond('Cancel')
  check(f.model.getItem(1, 'limit') === 35 && f.control.props.get('selectedtab') === 1,
    'The original confirmation follows input processing and Cancel still retains the form')
  fixture.rt.fire = fire
  const failedInput = await editLimit('36')
  const onError = fixture.rt.onError
  const failures = []
  fixture.rt.onError = (error) => failures.push(String(error))
  fixture.rt.fire = async (target, event, args) => {
    if (target === f.detail && event === 'editchanged') throw new Error('Synthetic input-event failure')
    return fire(target, event, args)
  }
  failedInput.dispatchEvent(new Event('input', { bubbles: true }))
  await settle()
  check(failures.length === 1 && await f.detail.n_accepttext() === -1 &&
    !(await detailView.acceptPendingEdit()) && f.model.getItem(1, 'limit') === 35 && detailView.editor.value === '36',
    'Input-event failures are reported and cannot silently become accepted entries')
  fixture.rt.fire = fire
  fixture.rt.onError = onError
  failedInput.value = '37'
  failedInput.dispatchEvent(new Event('input', { bubbles: true }))
  await settle()
  check(await f.detail.n_accepttext() === 1 && f.model.getItem(1, 'limit') === 37,
    'An explicit corrected input event allows acceptance to recover in either presentation')
  if (modern) check(detailView.root.querySelector('.surface-status').textContent === 'Ready',
    'Successful acceptance clears the previous input failure rather than leaving a stale error')
  const promptedInput = await editLimit('38')
  let promptedCommits = 0
  fixture.rt.fire = async (target, event, args) => {
    if (target === f.detail && event === 'editchanged') {
      await fixture.ui.messageBox('Synthetic input notice', 'Keep this entry while the notice is open.', 'information!', 'ok!', 1)
    }
    if (target === f.detail && event === 'itemchanged') promptedCommits++
    return fire(target, event, args)
  }
  promptedInput.dispatchEvent(new Event('input', { bubbles: true }))
  await settle()
  const notice = document.querySelector('.presentation-runtime-dialog[open],.msgbox')
  check(notice?.textContent.includes('Keep this entry') && promptedCommits === 0 && f.model.getItem(1, 'limit') === 37,
    'A message opened by EditChanged does not trigger premature blur validation')
  notice.querySelector('button').click()
  await settle()
  check(promptedCommits === 0 && detailView.editor?.value === '38' && f.model.getItem(1, 'limit') === 37,
    'Closing an input-event message retains the unaccepted draft without a validation loop')
  detailView.editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  fixture.rt.fire = fire
  const cancelled = await editLimit('34')
  cancelled.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  check(await f.detail.n_gettext() === '37', 'Escape releases the draft text binding')
  f.reset()
  f.window.props.set('editflag', false)
  f.tabs[1].click()
  await settle()
  const searchView = f.view.ctlViews.get(f.search).dw
  searchView.root.querySelector('[data-obj=find]').click()
  await settle()
  const searchInput = searchView.editor
  for (const [text, expected] of [['BR', 2], ['ZZ', 0], ['', 0], ['AL', 1]]) {
    searchInput.value = text
    searchInput.dispatchEvent(new Event('input', { bubbles: true }))
    await settle()
    check(await f.lookup.n_getselectedrow(0) === expected && f.pages[0].props.get('enabled') === (expected > 0),
      `Recovered Find/EditChanged and binary search select the correct row and Detail availability for "${text}"`)
    check(f.search.model.getItem(1, 'find') === '' && await f.search.n_gettext() === text,
      'Live Find uses the edit text without prematurely committing the search field')
  }
  searchInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  f.reset()
  await settle()
  const closingInput = await editLimit('36')
  const closingGate = Promise.withResolvers()
  const closingEvents = []
  fixture.rt.fire = async (target, event, args) => {
    if (target === f.detail && event === 'editchanged') {
      closingEvents.push(args[2])
      await closingGate.promise
    }
    return fire(target, event, args)
  }
  closingInput.dispatchEvent(new Event('input', { bubbles: true }))
  closingInput.value = '38'
  closingInput.dispatchEvent(new Event('input', { bubbles: true }))
  await settle()
  await fixture.rt.closeWindow(f.window)
  closingGate.resolve()
  await settle()
  fixture.rt.fire = fire
  check(closingEvents.join(',') === '36' && f.model.getItem(1, 'limit') === 37,
    'Closing the window cancels queued input notifications without applying their drafts')
  check(await f.detail.n_gettext() !== '38', 'Closing a window releases its live edit-text binding')
  check(f.control.listeners.size === 0 && f.pages.every((page) => page.listeners.size === 0),
    'Closing a tabbed window releases tab and page subscriptions')
  if (modern) {
    window.openPresentationTabsPreview = async () => {
      const preview = await open()
      window.presentationTabsPreview = preview
      return true
    }
  }
}
