import { Runtime, Ref, Frame } from './src/runtime/interp.js'
import { fixClassData } from './src/runtime/class-fixes.js'
import { NTransaction } from './src/runtime/native/transaction.js'
import { DwCatalog, argList } from './src/dw/def.js'
import { PBDate, PBDateTime, PBTime } from './src/runtime/values.js'
import { CRITERIA_WINDOW_SURFACES, LOOKUP_CRITERIA_WINDOWS, REFERENCE_CRITERIA_WINDOWS } from './src/ui/window-surfaces.js'

// Original window/ancestor routines and metadata. Preferences, group and retrieval records are synthetic.
export async function checkCriteriaWindows(fixture, check, settle) {
  const nativeDates = ['w_arg_sdate', 'w_arg_sdate_notime', 'w_arg_sdate_ldate']
  const lookupOwners = new Set(LOOKUP_CRITERIA_WINDOWS.map(([name]) => name))
  const referenceOwners = new Set(REFERENCE_CRITERIA_WINDOWS.map(([name]) => name))
  const source = await (await fetch('./presentation-criteria-windows.json')).json()
  const rt = fixture.rt, modern = fixture.session.activeMode === 'modern'
  const classes = source.classes.map((definition) => {
    fixClassData(definition.name, definition)
    return { ...definition, routines: new Map(Object.entries(definition.routines).map(([owner, routines]) =>
      [owner, new Map(Object.entries(routines))])) }
  })
  const lookups = new Map()
  for (const surface of CRITERIA_WINDOW_SURFACES) for (const binding of surface.data) {
    for (const field of binding.surface.fields) if (field.choice?.kind === 'lookup') {
      lookups.set(field.choice.name, field.choice)
    }
  }
  const calls = [], violations = [], events = [], procedureCalls = []
  const items = [
    { code: 901, aliasname: 'SYN-A', name: 'Alpha synthetic item', manfname: 'Synthetic maker A' },
    { code: 902, aliasname: 'SYN-B', name: 'Bravo synthetic item', manfname: 'Synthetic maker B' },
    { code: 903, aliasname: 'SYN-C', name: 'Charlie synthetic item', manfname: 'Synthetic maker C' },
  ]
  const state = { rejectChanged: false, failRetrieve: null, emptySelection: false, defaultStart: null }
  let current, old
  const reject = (message) => { violations.push(message); throw new Error(message) }
  const rows = (name) => {
    if (name === 'd_popup_itemselection') return state.emptySelection ? [] : items
    if (name === 'd_arg_top_n_customers') return [{ count: 20 }]
    if (name === 'd_arg_antinortixitem') return []
    const lookup = lookups.get(name)
    if (lookup) return [901, 902, 903].map((key, index) => ({
      [lookup.dataColumn.toLowerCase()]: key,
      [lookup.displayColumn.toLowerCase()]: lookup.dataColumn === lookup.displayColumn ? key :
        `${['Alpha', 'Bravo', 'Charlie'][index]} synthetic choice`,
    }))
    if (name === 'd_arg_packlayout') return [{ packlayoutcode: 901 }]
    if (name === 'd_arg_quotation_customer_remarks') return [{ quotationcode: 0, custcode: 0, remarks: 'Synthetic remarks' }]
    return reject(`Unseeded criteria retrieval: ${name}`)
  }
  const transaction = new NTransaction(rt, 'transaction')
  transaction.db = {
    query: async (sql, params) => {
      const name = sql.replace(/^criteria-fixture:/, '')
      const definition = source.data[name]
      if (!sql.startsWith('criteria-fixture:') || !definition || params.length !== argList(definition).length) {
        return reject('Unexpected criteria query or arguments')
      }
      calls.push({ name, params: [...params] })
      if (state.failRetrieve === name || state.failRetrieve?.name === name &&
        calls.filter((call) => call.name === name).length === state.failRetrieve.occurrence) {
        throw new Error('Synthetic criteria retrieval failure')
      }
      const columns = definition.table.columns.map((column) => ({ name: column.name, type: column.type }))
      return { columns, rows: rows(name).map((row) => columns.map((column) => row[column.name.toLowerCase()] ?? null)) }
    },
    exec: async () => reject('Criteria fixtures forbid writes'),
    call: async () => reject('Criteria fixtures forbid procedures'),
    commit: async () => reject('Criteria fixtures forbid commits'),
    rollback: async () => reject('Criteria fixtures forbid rollbacks'),
    close: async () => {},
  }
  const activate = () => {
    if (old) throw new Error('Criteria fixture already active')
    old = { catalog: rt.dwCatalog, dwSql: rt.dwSql, fire: rt.fire, procs: rt.procs,
      classes: new Map(classes.map((definition) => [definition.name, rt.classes.get(definition.name)])),
      globals: new Map(['sqlca', 'gl_usercode'].map((name) => [name, rt.globals.get(name)])),
      functions: new Map(['f_stringpreferences', 'f_datepreferences', 'f_getgroupcode'].map((name) => [name, rt.sys.get(name)])) }
    for (const definition of classes) rt.classes.set(definition.name, definition)
    const catalog = new DwCatalog(async () => undefined)
    catalog.get = async (name) => source.data[name] ? structuredClone(source.data[name]) : reject(`Unseeded criteria DataWindow: ${name}`)
    rt.dwCatalog = catalog
    rt.dwSql = (name) => source.data[name] ? {
      sql: `criteria-fixture:${name}`, params: argList(source.data[name]).map((arg) => arg.name),
    } : reject(`Unrecorded criteria retrieve: ${name}`)
    rt.globals.set('sqlca', transaction); rt.globals.set('gl_usercode', 700)
    rt.procs = {
      refPositions: (name) => name === 'getaliasname_fromallitems' ? [2, 3, 4] : undefined,
      call: async (target, name, args) => {
        if (target !== transaction || name !== 'getaliasname_fromallitems' || args.length !== 5 ||
          args[0] !== 700 || !args.slice(2).every((arg) => arg instanceof Ref)) {
          return reject('Unexpected criteria procedure or arguments')
        }
        procedureCalls.push({ name, user: args[0], alias: args[1] })
        const row = items.find((item) => item.aliasname === args[1])
        await args[2].set(row?.code ?? null); await args[3].set(row?.name ?? ''); await args[4].set(1)
        transaction.setOk(0)
        return 0
      },
    }
    rt.sys.set('f_stringpreferences', { fn: async (_rt, args) => args.length === 1 && args[0] === 'ApplyArgSDate' ?
      state.defaultStart ? 'Y' : 'N' : reject('Unexpected criteria preference') })
    rt.sys.set('f_datepreferences', { fn: async (_rt, args) => state.defaultStart &&
      args.length === 1 && args[0] === 'DefaultArgSDate' ? state.defaultStart :
      reject('Unexpected or disabled date preference') })
    rt.sys.set('f_getgroupcode', { fn: async (_rt, args) => args.length === 1 && args[0] === 700 ?
      701 : reject('Unexpected criteria user-group request') })
    rt.fire = async (target, event, args) => {
      let owner = target
      while (owner && !CRITERIA_WINDOW_SURFACES.some((surface) => surface.name === owner.className)) owner = owner.parent
      if (!owner) return old.fire(target, event, args)
      events.push({ target, event, args })
      if (event === 'itemerror' || event === 'itemchanged' && state.rejectChanged) return 1
      return Runtime.prototype.fire.call(rt, target, event, args)
    }
  }
  const restore = () => {
    rt.dwCatalog = old.catalog; rt.dwSql = old.dwSql; rt.fire = old.fire; rt.procs = old.procs
    for (const [map, saved] of [[rt.classes, old.classes], [rt.globals, old.globals], [rt.sys, old.functions]]) {
      for (const [key, value] of saved) if (value === undefined) map.delete(key); else map.set(key, value)
    }
    old = null
  }
  const feedback = () => document.querySelector('.presentation-runtime-dialog[open],.msgbox')
  const wait = async (predicate, label) => {
    for (let attempt = 0; attempt < 45; attempt++) {
      await settle()
      if (predicate()) return
    }
    throw new Error(`Criteria ${label} did not settle: ${JSON.stringify({
      name: current?.surface.name, mode: fixture.session.activeMode, feedback: feedback()?.textContent,
      missing: [...(rt.missing ?? [])], events: events.slice(-8).map((entry) => entry.event),
      columnName: current?.window.pbGet('is_columnname'), caption: current?.model.describe('percentage_t.text'),
      row: current?.model.row, column: current?.model.col, editor: current?.dw.editor?.value,
      intervention: current?.model.getItem(1, 'interventiontype'), percentage: current?.model.getItem(1, 'percentage'),
      pendingEdits: current?.dw.pendingEdits.size, inputFailed: current?.dw.inputFailed,
      runtimeErrors: window.presentationRuntimeErrors,
    })}`)
  }
  const finish = async (work) => {
    let done = false, failure, value
    const messages = []
    Promise.resolve(work).then((result) => { value = result }, (error) => { failure = error }).finally(() => { done = true })
    await wait(() => {
      const message = feedback()
      if (message) { messages.push(message.textContent); message.querySelector('button').click() }
      return done
    }, 'operation')
    if (failure) throw failure
    return { value, messages }
  }
  const open = async (name, columnName = 'Synthetic price', defaultStart = null) => {
    await current?.close()
    activate()
    calls.length = 0; events.length = 0; state.rejectChanged = false; state.failRetrieve = null; state.emptySelection = false
    state.defaultStart = defaultStart
    const surface = CRITERIA_WINDOW_SURFACES.find((surface) => surface.name === name)
    if (!surface) throw new Error(`Unknown criteria dialog: ${name}`)
    let window, failure
    const ref = new Ref(() => window, (value) => { window = value }); ref.name = name
    const percentage = name === 'w_arg_percentage_reduce_raise'
    const pending = rt.sys.get(percentage ? 'openwithparm' : 'open').fn(rt,
      percentage ? [ref, columnName] : [ref], new Frame(null, null, 0))
    pending.catch((error) => { failure = error })
    await wait(() => failure || window?.isOpen && rt.modalWaiting > 0, 'Open')
    if (failure) { restore(); throw failure }
    const view = fixture.ui.views.get(window)
    const data = new Map()
    for (const binding of surface.data) {
      const control = window.children.get(binding.control)
      await control.ready
      data.set(binding.control, { control, model: control.model, dw: view.ctlViews.get(control).dw })
    }
    const { control, model, dw } = data.get(surface.data[0].control)
    const children = new Map()
    for (const field of surface.data[0].surface.fields) if (field.choice?.kind === 'lookup') {
      const child = await control.n_getchild(field.object)
      await child.ready
      if (!child.model.rowCount()) for (const seed of rows(field.choice.name)) {
        const row = child.model.insertRow(0)
        for (const [key, value] of Object.entries(seed)) child.model.setItem(row, key, value)
      }
      children.set(field.object, child)
    }
    const el = (name) => view.ctlViews.get(window.children.get(name)).el
    const action = async (name) => {
      const result = await finish(rt.fire(window.children.get(name), 'clicked'))
      await rt.flushPosted(); await rt.flushPosted(); await settle()
      return result
    }
    const edit = async (name, value, controlName = surface.data[0].control) => {
      const { control, dw } = data.get(controlName)
      await control.n_setcolumn(name)
      await fixture.ui.focusDw(control, true)
      await settle()
      const input = dw.editor
      if (!input) throw new Error(`No criteria editor for ${name}`)
      if (value !== undefined) {
        input.value = value
        input.dispatchEvent(new Event('input', { bubbles: true }))
      }
      await settle()
      return input
    }
    const close = async () => {
      if (current !== f) return
      try {
        if (window.isOpen) {
          if (window.children.has('cb_cancel')) await action('cb_cancel')
          else { await rt.fire(window, 'ue_close', [-1]); await rt.flushPosted() }
        }
        await pending
        await rt.flushPosted()
      } finally { current = null; restore() }
    }
    const f = { surface, window, view, control, model, dw, data, children, pending, action, edit, el, close, calls, events,
      returned: () => rt.globals.get('message').pbGet(['w_select_case', 'w_sale_replace_custref'].includes(name) ? 'doubleparm' : 'powerobjectparm') }
    current = f
    await dw.render(); await settle()
    return f
  }
  const prepare = async (f) => {
    const seeds = {
      classcode: 902, packlayoutcode: 902, pricetypecode: 902, markupperc: 12.5,
      quotationcode: 901, custcode: 902, remarks: 'Synthetic remarks',
      arg_to: 'Synthetic addressee', arg_subject: 'Synthetic subject', arg_detail: 'Synthetic detail',
      criteria: 'M', startperc: 12.5, endperc: 25, percentage: 12.5, zonecode: 902, count: 20,
      refno: 'Synthetic reference',
    }
    for (const { control, model } of f.data.values()) {
      if (!model.rowCount()) continue
      for (const [column, value] of Object.entries(seeds)) if (model.colIndex(column) >= 0) model.setItem(1, column, value)
      control.changed()
    }
    if (lookupOwners.has(f.surface.name)) {
      f.model.setItem(1, f.surface.data[0].surface.fields[0].object, 902)
    }
    for (const name of ['em_startdate', 'em_enddate']) if (f.window.children.has(name)) {
      const control = f.window.children.get(name)
      const text = name === 'em_startdate' ? '04/05/2024 01:02:03' : '06/07/2024 21:22:23'
      control.pbSet('text', control.pbGet('mask') === 'dd/mm/yyyy' ? text.slice(0, 10) : text)
    }
    f.control.changed(); await settle()
  }
  const invalidDate = async (f, name, text) => {
    const input = f.el(name)
    const control = f.window.children.get(name), label = f.window.children.get(name === 'em_startdate' ? 'st_1' : 'st_2')
    const visible = control.pbGet('visible'), labelVisible = label.pbGet('visible'), enabled = control.pbGet('enabled')
    control.pbSet('visible', true); label.pbSet('visible', true); control.pbSet('enabled', true)
    input.focus(); input.value = text
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await settle()
    const result = await f.action('cb_ok')
    check(f.window.isOpen && result.messages.some((message) => message.includes('Enter a valid date using')),
      `${f.surface.name}/${name}: invalid native date ${JSON.stringify(text)} reports a recoverable error`)
    check(input.value === text && document.activeElement === input && input.getAttribute('aria-invalid') === 'true' &&
      f.window.pbGet('istr_arg').pbGet('i_status') !== 1,
    `${f.surface.name}/${name}: rejected date retains the actual input, field focus and non-success status`)
    control.pbSet('visible', visible); label.pbSet('visible', labelVisible); control.pbSet('enabled', enabled)
  }
  const checkNativeDates = async (f) => {
    const name = f.surface.name, dateOnly = name === 'w_arg_sdate_notime', range = name === 'w_arg_sdate_ldate'
    const original = f.window.pbGet('istr_arg')
    const todayText = f.el('em_startdate').value.slice(0, 10)
    check(f.returned() === original && original.pbGet('i_status') === 0,
      `${name}: Open initializes the cancellation channel to this window's structure`)
    check(f.model.rowCount() === 0 && !calls.length && f.el('dw_control').classList.contains('hidden') &&
      f.el('st_3').classList.contains('hidden'), `${name}: hidden customer criteria stay empty without retrieval`)
    check(f.el('em_enddate').classList.contains('hidden') === !range &&
      f.el('st_2').classList.contains('hidden') === !range,
    `${name}: only the source-declared date controls are visible`)
    check(new RegExp(dateOnly ? '^\\d{2}/\\d{2}/\\d{4}$' : '^\\d{2}/\\d{2}/\\d{4} 00:00:00$')
      .test(f.el('em_startdate').value), `${name}: original Open retains its date-only or midnight default`)
    check(f.el('em_enddate').value.endsWith('23:59:59'),
      `${name}: inherited end-of-day initialization remains intact, including hidden fields`)
    if (modern) check(f.el('em_startdate').getAttribute('aria-labelledby') === f.el('st_1').id,
      `${name}: the original native date caption remains the accessible field label`)
    const enter = async (control, next) => {
      const input = f.el(control)
      input.focus()
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true, cancelable: true }))
      await wait(() => document.activeElement === f.el(next), 'native date Enter navigation')
      check(f.window.isOpen && document.activeElement === f.el(next),
        `${name}: source ${control} KeyDown/Handle/Send advances once past hidden or disabled controls`)
    }
    const ok = f.window.children.get('cb_ok'), hadDefault = ok.props.has('default'), defaultValue = ok.pbGet('default')
    ok.pbSet('default', true)
    try {
      await enter('em_startdate', range ? 'em_enddate' : 'cb_ok')
      if (range) {
        await enter('em_enddate', 'cb_ok')
        f.window.children.get('em_enddate').pbSet('enabled', false)
        try { await enter('em_startdate', 'cb_ok') }
        finally { f.window.children.get('em_enddate').pbSet('enabled', true) }
      }
      check(!events.some((event) => event.target === ok && event.event === 'clicked'),
        `${name}: source Enter navigation does not also activate a default button`)
    } finally {
      if (hadDefault) ok.pbSet('default', defaultValue)
      else ok.props.delete('default')
    }
    for (const text of ['30/02/2024', '29/02/2023', '', '04/05/2024 24:00:00']) {
      await invalidDate(f, 'em_startdate', text)
      check(original.pbGet('d_sdate') === 0 && original.pbGet('d_edate') === 0,
        `${name}: preflight rejection does not modify either return date`)
    }
    await prepare(f)
    if (range) {
      await invalidDate(f, 'em_enddate', '31/04/2024 12:00:00')
      check(original.pbGet('d_sdate') === 0 && original.pbGet('d_edate') === 0,
        'An invalid ending date cannot partially write a valid starting date into the return structure')
    }
    f.window.children.get('em_startdate').pbSet('text', dateOnly ? '29/02/2024' : '29/02/2024 21:22:23')
    f.window.children.get('em_enddate').pbSet('text', '28/02/2024 01:02:03')
    await f.action('cb_ok'); await f.pending
    const returned = f.returned()
    check(!f.window.isOpen && returned === original && returned.pbGet('i_status') === 1,
      `${name}: corrected input closes through the original posted return`)
    check(returned.pbGet('d_sdate')?.n === PBDate.ymd(2024, 2, 29).n &&
      returned.pbGet('d_sdate')?.ms === (dateOnly ? 0 : PBTime.hms(21, 22, 23).ms),
    `${name}: leap day and the source date-only/clock value reach the original structure`)
    check(range ? returned.pbGet('d_edate')?.n === PBDate.ymd(2024, 2, 28).n &&
      returned.pbGet('d_edate')?.ms === PBTime.hms(1, 2, 3).ms : returned.pbGet('d_edate') === 0,
    `${name}: return fields follow the original routine without inventing a date-range ordering rule`)
    const controls = [...f.view.ctlViews.keys()]
    await f.close()
    check(controls.every((control) => !control.listeners?.size), `${name}: closing releases all control subscriptions`)
    f = await open(name)
    await f.close()
    check(f.returned()?.pbGet('i_status') === 0, `${name}: explicit Cancel returns the untouched cancellation structure`)
    rt.globals.get('message').pbSet('powerobjectparm', returned)
    f = await open(name)
    f.view.el.querySelector('.tbar .cls').click()
    await wait(() => !f.window.isOpen, 'date title-bar cancellation')
    await f.pending
    check(f.returned() !== returned && f.returned()?.pbGet('i_status') === 0,
      `${name}: title-bar cancellation cannot reuse a previous successful date result`)
    await f.close()
    f = await open(name, undefined, new PBDateTime(PBDate.ymd(2031, 4, 2).n, PBTime.hms(5, 6, 7).ms))
    check(f.el('em_startdate').value === (dateOnly ? todayText : '02/04/2031 05:06:07'),
      `${name}: the enabled start-date preference and date-only source override retain their original precedence`)
    await f.close()
  }
  const checkLookupOwner = async (f) => {
    const name = f.surface.name, field = f.surface.data[0].surface.fields[0]
    const dateControls = classes.find((definition) => definition.name === name).routines.get('cb_ok').get('clicked')[0]
      .body.filter((node) => node.k === 'expr' && node.e?.n === 'getdata').map((node) => node.e.o.n)
    const original = f.window.pbGet('istr_arg')
    check(f.returned() === original && original.pbGet('i_status') === 0,
      `${name}: Open initializes this owner's cancellation structure`)
    check(calls.filter((call) => call.name === f.surface.data[0].surface.name).length ===
      (name === 'w_arg_antinortixitem_sdate_ldate' ? 1 : 0),
      `${name}: original Open only performs its declared criteria retrieval`)
    if (modern) {
      const label = f.el('st_3'), caption = label.textContent
      const cell = () => f.dw.root.querySelector(`[data-obj="${field.object}"]`)
      check(cell().getAttribute('aria-labelledby') === label.id && !f.dw.root.querySelector('.surface-label'),
        `${name}: the original external caption names the lookup without a duplicate label`)
      f.window.children.get('st_3').pbSet('text', 'Synthetic live criterion:')
      f.control.changed(); await settle()
      check(cell().getAttribute('aria-labelledby') === label.id && label.textContent === 'Synthetic live criterion:',
        `${name}: repaint preserves its live external accessible label`)
      f.window.children.get('st_3').pbSet('text', caption)
    }
    const accept = f.model.acceptText
    let attempts = 0
    f.model.acceptText = async () => { attempts++; return -1 }
    await f.action('cb_ok')
    check(attempts === 1 && f.window.isOpen && original.pbGet('i_status') === 0 && original.pbGet('l_code1') === 0,
      `${name}: failed acceptance cannot read an older key or reach the original success routine`)
    f.model.acceptText = accept
    await prepare(f)
    if (dateControls.length) {
      await invalidDate(f, 'em_enddate', '31/04/2024 12:00:00')
      check(original.pbGet('d_sdate') === 0 && original.pbGet('d_edate') === 0 && original.pbGet('l_code1') === 0,
        `${name}: invalid dates cannot partially write either date or the selected key`)
      await prepare(f)
    } else {
      check(f.el('em_startdate').classList.contains('hidden') && f.el('em_enddate').classList.contains('hidden'),
        `${name}: selection-only criteria do not reveal inherited dates`)
    }
    const child = f.children.get(field.object)
    child.model.setItem(3, field.choice.displayColumn.toLowerCase(), 'Bravo synthetic choice')
    child.changed()
    const choose = async (index) => {
      const editor = await f.edit(field.object)
      if (editor instanceof HTMLSelectElement) {
        editor.value = String(index)
        editor.dispatchEvent(new Event('change', { bubbles: true }))
      } else {
        if (editor.getAttribute('aria-expanded') !== 'true') {
          editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'F4', bubbles: true, cancelable: true }))
          await settle()
        }
        check(editor.readOnly === !field.choice.editable && editor.getAttribute('aria-expanded') === 'true',
          `${name}: lookup popup retains its source editing policy`)
        f.dw.root.querySelector(`.dw-choice-popup [data-index="${index}"]`).click()
      }
      await settle()
    }
    state.rejectChanged = true
    await choose(0); await f.action('cb_ok')
    check(f.window.isOpen && f.model.getItem(1, field.object) === 902 && original.pbGet('i_status') === 0,
      `${name}: an ItemChanged veto retains the previous key without returning it as a new success`)
    state.rejectChanged = false
    if (field.choice.editable) {
      await f.edit(field.object, 'Unmatched synthetic choice')
      const errors = events.filter((event) => event.target === f.control && event.event === 'itemerror').length
      await f.action('cb_ok')
      check(f.window.isOpen && await f.control.n_gettext() === 'Unmatched synthetic choice' &&
        events.filter((event) => event.target === f.control && event.event === 'itemerror').length === errors + 1,
      `${name}: an unmatched typed caption remains correctable rather than becoming an arbitrary key`)
      await f.edit(field.object, 'Bravo synthetic choice')
      check(await f.control.n_accepttext() === 1 && f.model.getItem(1, field.object) === 902,
        `${name}: exact typed duplicate captions resolve by the existing first-match rule`)
    }
    await choose(2)
    check(f.model.getItem(1, field.object) === 903,
      `${name}: explicit duplicate-caption selection preserves the chosen row's original key`)
    if (name === 'w_arg_supp_label') {
      const all = f.el('cbx_supress').querySelector('input')
      check(all.getClientRects().length > 0 && f.el('cbx_supress').textContent.trim() === 'All:',
        'Supplier labels retain the source-visible All option and literal caption')
      all.click()
    } else if (name === 'w_arg_custgroup') {
      f.window.children.get('cbx_supress').pbSet('checked', true)
      f.window.children.get('cbx_hide').pbSet('checked', true)
    }
    await f.action('cb_ok'); await f.pending
    const returned = f.returned()
    check(!f.window.isOpen && returned.pbGet('i_status') === 1 && returned.pbGet('l_code1') === 903,
      `${name}: corrected acceptance returns the chosen key through its original posted close`)
    check(dateControls.length ? returned.pbGet('d_sdate')?.n === PBDate.ymd(2024, 5, 4).n &&
      returned.pbGet('d_edate')?.n === PBDate.ymd(2024, 7, 6).n :
      returned.pbGet('d_sdate') === 0 && returned.pbGet('d_edate') === 0,
    `${name}: only dates actually consumed by the source routine enter the return structure`)
    if (['w_arg_custgroup', 'w_arg_supp_label'].includes(name)) check(returned.pbGet('i_supress') === true &&
      (name !== 'w_arg_custgroup' || returned.pbGet('i_hide') === true),
    `${name}: original option flags are returned without redefining their meaning`)
    const controls = [...f.view.ctlViews.keys()]
    await f.close()
    check(controls.every((control) => !control.listeners?.size), `${name}: closing releases all original control listeners`)
    f = await open(name)
    const untouched = f.model.getItem(1, field.object)
    await f.action('cb_ok'); await f.pending
    check(f.returned()?.pbGet('i_status') === 1 && f.returned().pbGet('l_code1') ===
      (untouched === null && ['w_arg_godown_sdate_ldate', 'w_arg_sman_sdate_ldate'].includes(name) ? 0 : untouched),
    `${name}: untouched criteria retain the source null/zero behavior without invented validation`)
    await f.close()
    f = await open(name)
    await f.close()
    check(f.returned()?.pbGet('i_status') === 0, `${name}: explicit Cancel returns this owner's cancellation result`)
    rt.globals.get('message').pbSet('powerobjectparm', returned)
    f = await open(name)
    f.view.el.querySelector('.tbar .cls').click()
    await wait(() => !f.window.isOpen, 'lookup title-bar cancellation')
    await f.pending
    check(f.returned() !== returned && f.returned()?.pbGet('i_status') === 0,
      `${name}: title-bar cancellation cannot reuse a previous selected key`)
    await f.close()
  }
  const checkReferenceOwner = async (f) => {
    const name = f.surface.name, customNullValidation = ['w_arg_containerno', 'w_arg_ref', 'w_arg_smscenter'].includes(name)
    const original = f.window.pbGet('istr_arg')
    check(f.returned() === original && original.pbGet('i_status') === 0,
      `${name}: Open initializes this owner's cancellation structure`)
    check(f.model.rowCount() === 1, `${name}: original Open inserts exactly one editable reference row`)
    await prepare(f)
    check(f.model.getItem(1, 'refno') === 'Synthetic reference',
      `${name}: the reference row retains its accepted string before owner validation`)
    check(f.el('em_startdate').classList.contains('hidden') && f.el('em_enddate').classList.contains('hidden'),
      `${name}: inherited date controls remain hidden and are not introduced as criteria`)
    if (modern) {
      const label = f.el('st_3'), caption = label.textContent
      const cell = f.dw.root.querySelector('[data-obj="refno"]')
      check(cell?.getAttribute('aria-labelledby') === label.id && !f.dw.root.querySelector('.surface-label'),
        `${name}: the exact owner caption labels its reference editor without duplication`)
      f.window.children.get('st_3').pbSet('text', 'Synthetic live reference:')
      f.control.changed(); await settle()
      check(label.textContent === 'Synthetic live reference:' &&
        f.dw.root.querySelector('[data-obj="refno"]')?.getAttribute('aria-labelledby') === label.id,
      `${name}: external reference label remains live through repaint`)
      f.window.children.get('st_3').pbSet('text', caption)
    }
    const accept = f.model.acceptText
    let attempts = 0
    f.model.acceptText = async () => { attempts++; return -1 }
    await f.action('cb_ok')
    check(attempts === 1 && f.window.isOpen && original.pbGet('i_status') === 0,
      `${name}: rejected edits cannot enter the original reference-return routine`)
    f.model.acceptText = accept
    await prepare(f)
    if (customNullValidation) {
      f.model.setItem(1, 'refno', null)
      f.control.changed(); await settle()
      const result = await f.action('cb_ok')
      check(f.window.isOpen && result.messages.some((message) => message.includes('Please select a valid Reference No.')) &&
        f.model.getItem(1, 'refno') === null && original.pbGet('i_status') === 0,
      `${name}: the source-required null rule retains an editable draft and prevents success`)
    } else {
      f.model.setItem(1, 'refno', null)
      f.control.changed(); await settle()
      await f.action('cb_ok'); await f.pending
      check(!f.window.isOpen && f.returned().pbGet('i_status') === 1 && f.returned().pbGet('s_name1') === null,
        `${name}: the original optional null reference is returned unchanged without invented required validation`)
      f = await open(name)
    }
    const input = await f.edit('refno', 'Batch-0042')
    check(await f.control.n_accepttext() === 1 && f.model.getItem(1, 'refno') === 'Batch-0042',
      `${name}: corrected reference text commits through the original field`)
    await f.action('cb_ok'); await f.pending
    const returned = f.returned()
    check(!f.window.isOpen && returned.pbGet('i_status') === 1 && returned.pbGet('s_name1') === 'Batch-0042',
      `${name}: corrected text returns the original string field and success status`)
    check(input.value === 'Batch-0042' && !f.el('em_startdate').getClientRects().length &&
      !f.el('em_enddate').getClientRects().length,
    `${name}: return retains the accepted input while inherited dates stay source-hidden`)
    const controls = [...f.view.ctlViews.keys()]
    await f.close()
    check(controls.every((control) => !control.listeners?.size), `${name}: closing releases every control listener`)
    f = await open(name)
    await f.close()
    check(f.returned()?.pbGet('i_status') === 0, `${name}: Cancel returns fresh cancellation state`)
    rt.globals.get('message').pbSet('powerobjectparm', returned)
    f = await open(name)
    f.view.el.querySelector('.tbar .cls').click()
    await wait(() => !f.window.isOpen, 'reference text title-bar cancellation')
    await f.pending
    check(f.returned() !== returned && f.returned()?.pbGet('i_status') === 0,
      `${name}: title-bar cancellation cannot reuse an earlier returned string`)
    await f.close()
  }
  const checkItemSelection = async (f) => {
    const count = f.data.get('dw_custcount'), available = f.data.get('dw_selectionlist')
    const selected = f.window.children.get('lb_selected')
    check(f.window.pbGet('ib_itemsearch') === true,
      'Original GetSQLSelect metadata retains the procedure-backed item alias branch')
    check(available.model.rowCount() === 3 && count.model.getItem(1, 'count') === 20,
      'Item-selection Open initializes the available records and source customer-count default')
    check(f.window.pbGet('ids_allcustomers').model.rowCount() === 3 &&
      f.window.pbGet('ids_hold').model.rowCount() === 0 && await selected.n_totalitems() === 0,
    'Available, all-item, selected-list and hold buffers have distinct original lifetimes')
    if (modern) check(f.el('lb_selected').getAttribute('aria-labelledby') === f.el('gb_3').querySelector('legend').id,
      'The native selected list uses its live original group caption as its accessible name')
    let result = await f.action('cb_ok')
    check(f.window.isOpen && result.messages.some((text) => text.includes('Either select all Items')),
      'Empty selection retains the original Item Validation message')
    const key = async (target, name) => {
      target.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }))
      await settle(); await rt.flushPosted(); await settle()
    }
    const alias = async (text) => {
      await f.edit('aliasname', text)
      return finish(f.control.n_accepttext())
    }
    result = await alias('UNKNOWN')
    check(result.value === -1 && result.messages.some((text) => text.includes('AliasName does not exist')),
      'Unknown aliases retain the original validation and cannot enter the selected list')
    result = await alias('SYN-C')
    check(result.value === 1 && f.model.getItem(1, 'code') === 903 &&
      procedureCalls.at(-1)?.alias === 'SYN-C', 'Corrected aliases run the source read-only procedure with the original user and output references')
    await f.control.n_setcolumn('name'); await fixture.ui.focusDw(f.control, true); await settle()
    await key(f.dw.editor, 'Enter')
    await wait(() => selected.items().a.length === 1, 'source Enter selection')
    check(selected.items().a[0] === items[2].name && available.model.rowCount() === 2 &&
      f.window.pbGet('ids_hold').model.getItem(1, 'code') === 903 && f.model.getItem(1, 'name') === null,
    'Source Enter moves the exact item key to the hold buffer, removes its available row and clears the search draft')
    await alias('SYN-A')
    await f.control.n_setcolumn('name'); await fixture.ui.focusDw(f.control, true); await settle()
    await key(f.dw.editor, 'Enter')
    await wait(() => selected.items().a.length === 2, 'second source Enter selection')
    check(selected.items().a.join('|') === [items[0].name, items[2].name].join('|'),
      'The source Sorted native list retains alphabetical order rather than insertion order')
    f.el('lb_selected').focus(); await settle()
    check(await selected.n_selectedindex() === 1, 'Native list focus executes the original first-item selection')
    await key(f.el('lb_selected'), 'Enter')
    await wait(() => selected.items().a.length === 1, 'selected-list Enter removal')
    check(selected.items().a[0] === items[2].name && available.model.rowCount() === 2 &&
      available.model.getItem(1, 'code') === 901 && available.model.getItem(2, 'code') === 902,
    'Source Enter removal restores the item and deletes only the temporary null row after Sort')
    await selected.n_selectitem(1)
    f.el('lb_selected').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    await wait(() => selected.items().a.length === 0, 'selected-list double-click removal')
    check(available.model.rowCount() === 3 && available.model.getItem(3, 'code') === 903 &&
      f.window.pbGet('ids_hold').model.rowCount() === 0, 'Native double-click restores the second item without lost keys or hold rows')
    await alias('SYN-A')
    await f.control.n_setcolumn('name'); await fixture.ui.focusDw(f.control, true); await settle()
    await key(f.dw.editor, 'Enter')
    await wait(() => selected.items().a.length === 1, 're-add removed item')
    await prepare(f)
    for (const value of [0, -1, null]) {
      count.model.setItem(1, 'count', value)
      result = await f.action('cb_ok')
      check(f.window.isOpen && result.messages.some((text) => text.includes('Please enter valid value')),
        `Item-selection rejects the original invalid customer count ${value}`)
    }
    count.model.setItem(1, 'count', 20)
    await f.edit('count', 'not-a-number', 'dw_custcount')
    result = await f.action('cb_ok')
    check(f.window.isOpen && f.window.pbGet('istr_arg').pbGet('i_status') !== 1,
      'A rejected count draft cannot close with a stale accepted count')
    await f.edit('count', '37', 'dw_custcount')
    await f.action('cb_ok'); await f.pending
    const returned = f.returned()
    check(returned.pbGet('i_status') === 1 && returned.pbGet('l_code1') === 37 &&
      returned.pbGet('l_code2') === 0 && returned.pbGet('la_longlist').a.join() === '901',
    'Selected-item acceptance returns exact keys, count and the original selected-only flag')
    check(returned.pbGet('d_sdate')?.n === PBDate.ymd(2024, 5, 4).n &&
      returned.pbGet('d_edate')?.n === PBDate.ymd(2024, 7, 6).n, 'Item-selection returns the original day-first dates')
    const controls = [...f.view.ctlViews.keys()]
    await f.close()
    check(controls.every((control) => !control.listeners?.size), 'Item-selection closes without retained native-control subscriptions')
    f = await open('w_arg_items_sdate_ldate_topn')
    f.el('cbx_all').querySelector('input').click()
    await f.action('cb_ok'); await f.pending
    check(f.returned().pbGet('i_status') === 1 && f.returned().pbGet('l_code2') === 1 &&
      f.returned().pbGet('la_longlist').a.join() === '901,902,903',
    'All-items acceptance does not incorrectly validate the intentionally empty transient Name field')
    await f.close()
    f = await open('w_arg_items_sdate_ldate_topn')
    f.view.el.querySelector('.tbar .cls').click()
    await wait(() => !f.window.isOpen, 'item-selection title-bar cancellation')
    await f.pending
    check(f.returned()?.pbGet('i_status') === 0, 'Title-bar cancellation cannot reuse the previous successful item selection')
    await f.close()
    f = await open('w_arg_items_sdate_ldate_topn')
    await f.close()
    check(f.returned()?.pbGet('i_status') === 0, 'Original Cancel returns the untouched argument structure')
  }
  try {
    for (const surface of CRITERIA_WINDOW_SURFACES) {
      let f = await open(surface.name)
      check(f.model.rowCount() === (nativeDates.includes(surface.name) ? 0 : 1),
        `${surface.name}: original Open preserves its populated or intentionally empty criteria buffer`)
      check(f.view.el.classList.contains('modern-window') === modern, `${surface.name}: the complete dialog follows the chosen presentation`)
      check([...f.view.ctlViews.values()].every((binding) => f.view.el.contains(binding.el)),
        `${surface.name}: all inherited and direct controls remain attached`)
      if (surface.name === 'w_arg_items_sdate_ldate_topn') {
        await checkItemSelection(f)
        continue
      }
      if (surface.name === 'w_arg_pricetype_markup') check(calls.some((call) =>
        call.params.join() === '1,701') && Number(f.model.getItem(1, 'pricetypecode')) === 901,
      'Price-type Open passes the original module/group arguments and selects the first returned key')
      if (surface.frame) {
        f.window.children.get(surface.frame).pbSet('visible', false)
        await settle()
        check((nativeDates.includes(surface.name) ? f.el('em_startdate') : f.dw.root).getClientRects().length > 0,
          `${surface.name}: hiding a decorative source frame does not hide its fields`)
        f.window.children.get(surface.frame).pbSet('visible', true)
      }
      if (surface.options) {
        const visibility = new Map(surface.options.map((option) =>
          [option.control, f.window.children.get(option.control).pbGet('visible')]))
        const hideEnabled = f.window.children.get('cbx_hide').pbGet('enabled')
        if (modern) check(surface.options.every((option) => f.el(option.control).querySelector('input').tabIndex <= 0),
          `${surface.name}: native options follow the reflowed DOM tab order rather than jumping ahead of fields`)
        check(surface.options.every((option) => f.el(option.control).classList.contains('hidden') === !visibility.get(option.control)),
          `${surface.name}: inherited and overridden option visibility follows its source`)
        for (const option of surface.options) f.window.children.get(option.control).pbSet('visible', true)
        await settle()
        f.window.children.get('rb_purprice').pbSet('enabled', true)
        f.el('rb_purprice').querySelector('input').click()
        check(f.window.children.get('rb_purprice').pbGet('checked') === true &&
          f.window.children.get('rb_saleprice').pbGet('checked') === false,
        `${surface.name}: reflow retains the source native radio group`)
        f.window.children.get('cbx_hide').pbSet('enabled', false)
        check(f.el('cbx_hide').querySelector('input').disabled, `${surface.name}: source option disabling remains live`)
        for (const option of surface.options) f.window.children.get(option.control).pbSet('visible', visibility.get(option.control))
        f.window.children.get('cbx_hide').pbSet('enabled', hideEnabled)
      }
      if (lookupOwners.has(surface.name)) {
        await checkLookupOwner(f)
        continue
      }
      if (referenceOwners.has(surface.name)) {
        await checkReferenceOwner(f)
        continue
      }
      if (nativeDates.includes(surface.name)) {
        await checkNativeDates(f)
        continue
      }
      if (surface.name === 'w_arg_zone_sdate_ldate_top_n_customer') {
        check(f.model.getItem(1, 'zonecode') === null && f.data.get('dw_custcount').model.getItem(1, 'count') === 20,
          'Top-customer Open keeps the original null zone and twenty-customer defaults in separate buffers')
        if (modern) {
          const label = f.el('st_3')
          check(f.dw.root.querySelector('[data-obj=zonecode]')?.getAttribute('aria-labelledby') === label.id &&
            !f.dw.root.querySelector('.surface-label'), 'The external source Zone caption names the field without a duplicate label')
          f.window.children.get('st_3').pbSet('text', 'Synthetic zone caption:')
          await settle()
          check(label.textContent === 'Synthetic zone caption:' &&
            document.getElementById(f.dw.root.querySelector('[data-obj=zonecode]').getAttribute('aria-labelledby')) === label,
          'The original external zone caption remains live and accessible')
          f.window.children.get('st_3').pbSet('text', 'Zone:')
          check([...f.view.el.querySelector('.window-fields').children].slice(1).map((element) =>
            [...f.view.ctlViews].find(([, binding]) => binding.el === element ||
              element.querySelector('input.ctl') === binding.el)?.[0].name).join('|') === surface.contentOrder.join('|'),
          'Zone, dates, customer count and hidden options retain the explicit source content order')
        }
      }
      for (const [name, { model }] of f.data) {
        if (name === 'dw_price') continue
        const accept = model.acceptText
        let attempted = 0
        model.acceptText = async () => { attempted++; return -1 }
        await f.action('cb_ok')
        check(attempted === 1 && f.window.isOpen && f.window.pbGet('istr_arg')?.pbGet('i_status') !== 1,
          `${surface.name}/${name}: rejected AcceptText cannot post a success return`)
        model.acceptText = accept
      }
      await prepare(f)
      if (['w_arg_letter_sdate_ldate', 'w_arg_sdate_ldate_margin_markup_range',
        'w_arg_zone_sdate_ldate_top_n_customer'].includes(surface.name)) {
        await invalidDate(f, 'em_enddate', '30/02/2024 12:00:00')
        await prepare(f)
      }
      if (surface.name === 'w_arg_pricetype_markup') {
        for (const [column, value, message] of [['pricetypecode', 0, 'valid Price Type'],
          ['pricetypecode', null, 'valid Price Type'], ['markupperc', -1, 'valid Mark-Up']]) {
          f.model.setItem(1, column, value)
          const result = await f.action('cb_ok')
          check(f.window.isOpen && result.messages.some((text) => text.includes(message)), `Original ${column} validation stays open with its message`)
          await prepare(f)
        }
      } else if (surface.name === 'w_arg_sdate_ldate_margin_markup_range') {
        f.model.setItem(1, 'startperc', 30)
        const result = await f.action('cb_ok')
        check(f.window.isOpen && result.messages.some((text) => text.includes('Greater than Maximum')) &&
          f.model.col === f.model.colIndex('startperc') + 1, 'Original range validation identifies and focuses the minimum percentage')
        await prepare(f)
      } else if (surface.name === 'w_arg_quotation_customer_remarks') {
        for (const [column, message] of [['quotationcode', 'valid Quotation'], ['custcode', 'valid Customer']]) {
          f.model.setItem(1, column, 0)
          const result = await f.action('cb_ok')
          check(f.window.isOpen && result.messages.some((text) => text.includes(message)) &&
            f.model.col === f.model.colIndex(column) + 1, `Original ${column} validation retains its message and focus`)
          await prepare(f)
        }
      }
      const textColumn = surface.name === 'w_arg_letter_sdate_ldate' ? 'arg_detail' :
        surface.name === 'w_arg_quotation_customer_remarks' ? 'remarks' : null
      if (surface.name === 'w_arg_zone_sdate_ldate_top_n_customer') {
        const zoneErrors = events.filter((entry) => entry.event === 'itemerror' && entry.target === f.control).length
        await f.edit('zonecode', 'Unmatched synthetic zone')
        await f.action('cb_ok')
        check(f.window.isOpen && f.model.getItem(1, 'zonecode') === 902 &&
          await f.control.n_gettext() === 'Unmatched synthetic zone' &&
          events.filter((entry) => entry.event === 'itemerror' && entry.target === f.control).length === zoneErrors + 1,
        'The primary zone guard rejects an unmatched typed choice without losing its draft or returning the old key')
        await f.edit('zonecode', 'Bravo synthetic choice')
        check(await f.control.n_accepttext() === 1 && f.model.getItem(1, 'zonecode') === 902,
          'Correcting a typed zone resolves its original lookup key')
        const count = f.data.get('dw_custcount')
        for (const invalid of [0, -1, null]) {
          count.model.setItem(1, 'count', invalid)
          const result = await f.action('cb_ok')
          check(f.window.isOpen && result.messages.some((text) => text.includes('Number of Customer Validation!')) &&
            count.dw.root.contains(document.activeElement),
          `Original top-customer validation rejects ${invalid} and focuses the count buffer`)
          await prepare(f)
        }
        const before = events.filter((entry) => entry.event === 'itemerror' && entry.target === count.control).length
        await f.edit('count', 'not-count', 'dw_custcount')
        await f.action('cb_ok')
        check(f.window.isOpen && count.model.getItem(1, 'count') === 20 && await count.control.n_gettext() === 'not-count' &&
          events.filter((entry) => entry.event === 'itemerror' && entry.target === count.control).length === before + 1,
        'The secondary count guard rejects an actual invalid draft before ancestor focus or a stale result')
        await f.edit('count', '37', 'dw_custcount')
      }
      if (surface.name === 'w_sale_replace_custref') {
        check(f.returned() === -1, 'Customer-reference Open clears a previous numeric result to cancellation')
        for (let index = 0; index < 4; index++) {
          const choice = await f.edit('custref', String(index))
          choice.dispatchEvent(new Event('change', { bubbles: true }))
          await settle()
          check(f.model.getItem(1, 'custref') === index + 1, `Customer-reference option ${index + 1} keeps its original code`)
        }
        state.rejectChanged = true
        const choice = await f.edit('custref', '2')
        choice.dispatchEvent(new Event('change', { bubbles: true }))
        await settle()
        await f.action('cb_ok')
        check(f.window.isOpen && f.model.getItem(1, 'custref') === 4 && f.returned() === -1,
          'Rejected customer-reference selection cannot close with the previous column code')
        state.rejectChanged = false
        if (modern) {
          const dialog = f.view.el.closest('dialog')
          check(document.getElementById(dialog.getAttribute('aria-labelledby'))?.textContent === 'Replace Column',
            'The untitled customer-reference dialog is named by its source field label')
          f.control.pbGet('object').pbGet('custref_t').pbSet('text', 'Synthetic replacement column')
          await settle()
          check(document.getElementById(dialog.getAttribute('aria-labelledby'))?.textContent === 'Synthetic replacement column',
            'An untitled data dialog keeps a valid accessible name after its label is redrawn')
        }
      }
      if (surface.name === 'w_arg_percentage_reduce_raise') {
        check(f.window.pbGet('is_columnname') === 'Synthetic price' &&
          f.model.describe('percentage_t.text') === 'Reduce Synthetic price To:',
        'Percentage Open retains the caller-supplied caption and its original To wording')
        for (const [index, code, caption] of [[1, 2, 'Raise'], [0, 1, 'Reduce'], [1, 2, 'Raise']]) {
          const choice = await f.edit('interventiontype', String(index))
          choice.dispatchEvent(new Event('change', { bubbles: true }))
          await settle()
          check(f.model.getItem(1, 'interventiontype') === code &&
            f.model.describe('percentage_t.text') === `${caption} Synthetic price By:`,
          `The original ItemChanged updates ${caption} and its source By caption`)
          if (modern) check(f.dw.root.querySelectorAll('.surface-label')[1]?.textContent === `${caption} Synthetic price By:`,
            'The Modern percentage label follows the original live script caption')
        }
        for (const invalid of ['-0.01', '100.01']) {
          const itemErrors = events.filter((entry) => entry.event === 'itemerror' && entry.target === f.control).length
          await f.edit('percentage', invalid)
          await f.action('cb_ok')
          check(events.filter((entry) => entry.event === 'itemerror' && entry.target === f.control).length === itemErrors + 1,
            `Invalid percentage ${invalid} reaches original validation rather than only a pending-input guard`)
          check(f.window.isOpen && Number(f.model.getItem(1, 'percentage')) === 12.5 &&
            await f.control.n_gettext() === invalid && f.window.pbGet('istr_arg').pbGet('i_status') !== 1,
          `Percentage OK cannot return a stale buffer after rejecting ${invalid}`)
        }
        await f.edit('percentage', '24.75')
      }
      if (textColumn) {
        state.rejectChanged = true
        await f.edit(textColumn, 'Synthetic unapplied text')
        await f.action('cb_ok')
        check(f.window.isOpen && f.model.getItem(1, textColumn) !== 'Synthetic unapplied text' &&
          await f.control.n_gettext() === 'Synthetic unapplied text',
        `${surface.name}: an actual rejected text draft stays available instead of returning the prior buffer`)
        state.rejectChanged = false
      }
      await f.action('cb_ok')
      await wait(() => !f.window.isOpen, 'successful OK')
      await f.pending
      const returned = f.returned()
      check(!f.window.isOpen, `${surface.name}: original posted OK closes its response window`)
      if (surface.name === 'w_select_case') check(returned === 902, 'Packing layout returns the selected numeric key')
      else if (surface.name === 'w_sale_replace_custref') check(returned === 3,
        'Customer-reference OK returns the corrected column code through the original numeric channel')
      else {
        check(returned?.pbGet('i_status') === 1, `${surface.name}: the original structure reports success`)
        if (textColumn) check(returned.pbGet(textColumn === 'arg_detail' ? 's_name3' : 's_name1') === 'Synthetic unapplied text',
          `${surface.name}: corrected acceptance returns the current text rather than the old buffer`)
        if (surface.name === 'w_arg_activeclass_single') check(returned.pbGet('l_code1') === 902 &&
          returned.pbGet('s_name1') === 'p', 'Class selection returns its key and source purchase-price flag')
        if (surface.name === 'w_arg_pricetype_markup') check(returned.pbGet('l_code1') === 902 &&
          Number(returned.pbGet('db_code1')) === 12.5, 'Price type returns the source key and mark-up')
        if (surface.name === 'w_arg_percentage_reduce_raise') check(returned.pbGet('l_code1') === 2 &&
          Number(returned.pbGet('db_code1')) === 24.75, 'Percentage OK returns the selected intervention and newly accepted decimal')
        if (surface.name === 'w_arg_zone_sdate_ldate_top_n_customer') check(returned.pbGet('l_code1') === 902 &&
          returned.pbGet('l_code2') === 37, 'Top-customer OK returns the zone key and newly accepted secondary count')
        if (surface.name === 'w_arg_quotation_customer_remarks') check(returned.pbGet('l_code1') === 901 &&
          returned.pbGet('l_code2') === 902, 'Quotation and customer return distinct original keys')
        if (['w_arg_sdate_ldate_margin_markup_range', 'w_arg_letter_sdate_ldate',
          'w_arg_zone_sdate_ldate_top_n_customer'].includes(surface.name)) {
          check(returned.pbGet('d_sdate')?.n === PBDate.ymd(2024, 5, 4).n &&
            returned.pbGet('d_edate')?.n === PBDate.ymd(2024, 7, 6).n,
          `${surface.name}: native day-first dates survive the original structure-return path`)
        }
      }
      const listeners = [...f.view.ctlViews.keys()]
      await f.close()
      check(listeners.every((control) => !control.listeners?.size), `${surface.name}: closing releases control subscriptions`)
      f = await open(surface.name)
      await f.close()
      const cancelled = f.returned()
      check(surface.name === 'w_select_case' ? cancelled === 0 : surface.name === 'w_sale_replace_custref' ? cancelled === -1 :
        cancelled?.pbGet('i_status') === (['w_arg_quotation_customer_remarks', 'w_arg_percentage_reduce_raise'].includes(surface.name) ? -1 : 0),
      `${surface.name}: cancellation preserves its source return value without a success status`)
      if (surface.name === 'w_arg_zone_sdate_ldate_top_n_customer') {
        f = await open(surface.name)
        await f.action('cb_ok')
        await wait(() => !f.window.isOpen, 'unfiltered top-customer OK')
        await f.pending
        check(f.returned()?.pbGet('i_status') === 1 && f.returned().pbGet('l_code1') === 0 &&
          f.returned().pbGet('l_code2') === 20,
        'The original untouched null zone means no zone filter and keeps the default customer count')
        await f.close()
      }
      if (surface.name === 'w_sale_replace_custref') {
        rt.globals.get('message').pbSet('doubleparm', 4)
        f = await open(surface.name)
        f.view.el.querySelector('.tbar .cls').click()
        await wait(() => !f.window.isOpen, 'customer-reference title-bar cancellation')
        await f.pending; await rt.flushPosted()
        check(f.returned() === -1, 'Customer-reference title-bar cancellation cannot reuse a previous positive column code')
        await f.close()
      }
      if (surface.name === 'w_select_case') {
        f = await open(surface.name)
        const accept = f.model.acceptText
        f.model.acceptText = async () => -1
        await rt.fire(f.window, 'ue_close', [1]); await rt.flushPosted()
        check(f.window.isOpen, 'Direct packing return cannot skip a rejected edit')
        f.model.acceptText = accept
        f.view.el.querySelector('.tbar .cls').click()
        await wait(() => !f.window.isOpen, 'title-bar cancellation')
        await f.pending; await rt.flushPosted()
        check(f.returned() === 0, 'Packing title-bar cancellation returns no selection, not the previous result')
        await f.close()
      }
    }
    for (const name of ['w_arg_pricetype_markup', 'w_arg_quotation_customer_remarks', 'w_select_case',
      'w_arg_antinortixitem_sdate_ldate']) {
      activate()
      const surface = CRITERIA_WINDOW_SURFACES.find((surface) => surface.name === name)
      state.failRetrieve = name === 'w_arg_pricetype_markup' ? surface.data[0].surface.fields[0].choice.name :
        surface.data[0].surface.name
      let window
      try {
        const ref = new Ref(() => window, (value) => { window = value }); ref.name = name
        const result = await finish(rt.sys.get('open').fn(rt, [ref], new Frame(null, null, 0)))
        const message = rt.globals.get('message')
        check(result.messages.some((text) => text.includes('Synthetic criteria retrieval failure')) && !window.isOpen,
          `${name}: failed retrieval is reported and cannot leave a success-capable empty dialog`)
        check(name === 'w_select_case' ? message.pbGet('doubleparm') === 0 :
          message.pbGet('powerobjectparm')?.pbGet('i_status') === (name === 'w_arg_quotation_customer_remarks' ? -1 : 0),
        `${name}: failed retrieval uses the original cancellation return type`)
        await rt.flushPosted()
      } finally {
        if (window?.isOpen) await rt.closeWindow(window)
        restore(); state.failRetrieve = null
      }
    }
    for (const failure of [
      { name: 'd_popup_itemselection', occurrence: 1 }, { name: 'd_popup_itemselection', occurrence: 2 },
      { name: 'd_arg_top_n_customers', occurrence: 1 }, null,
    ]) {
      activate()
      calls.length = 0
      state.failRetrieve = failure; state.emptySelection = failure === null
      let window
      try {
        const ref = new Ref(() => window, (value) => { window = value }); ref.name = 'w_arg_items_sdate_ldate_topn'
        const result = await finish(rt.sys.get('open').fn(rt, [ref], new Frame(null, null, 0)))
        const returned = rt.globals.get('message').pbGet('powerobjectparm')
        check(!window.isOpen && returned?.pbGet('i_status') !== 1 &&
          result.messages.some((text) => text.includes(failure ? 'Synthetic criteria retrieval failure' : 'There are no rows')),
        `Item-selection ${failure ? failure.name + '/' + failure.occurrence : 'empty source list'} reports the problem and cannot return success`)
        check(failure?.occurrence === 2 || failure?.name === 'd_arg_top_n_customers' ?
          returned?.pbGet('i_status') === 0 : returned?.pbGet('l_code') === -1,
        'Failed item selection preserves the owning or inherited cancellation structure for its failing stage')
        await rt.flushPosted()
      } finally {
        if (window?.isOpen) await rt.closeWindow(window)
        restore(); state.failRetrieve = null; state.emptySelection = false
      }
    }
    check(!violations.length, 'Criteria workflows never request unseeded reads, writes or procedures')
  } finally { await current?.close() }
  window.openCriteriaWindowPreview = async (name) => {
    window.criteriaWindowPreview = await open(name, 'Synthetic price for a long item description')
    await prepare(window.criteriaWindowPreview)
    return true
  }
}
