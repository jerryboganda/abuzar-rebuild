import { Runtime, Ref, Frame } from './src/runtime/interp.js'
import { fixClassData } from './src/runtime/class-fixes.js'
import { NDwBase } from './src/runtime/native/dwctrl.js'
import { NTransaction, executeStatement, stmtKey } from './src/runtime/native/transaction.js'
import { ProcCaller } from './src/runtime/native/procs.js'
import { DwCatalog } from './src/dw/def.js'
import { DwModel } from './src/dw/model.js'

// Original payment scripts with synthetic records and strict transport boundaries.
// Procedure results and print requests are exercised, not PostgreSQL or a printer.
export async function checkCashierPayment(fixture, check, settle) {
  const source = await (await fetch('./presentation-payment.json')).json()
  const rt = fixture.rt, name = 'w_cashierjobactivity_cashtendered'
  for (const definition of source.classes) {
    fixClassData(definition.name, definition)
    definition.routines = new Map(Object.entries(definition.routines).map(([owner, routines]) =>
      [owner, new Map(Object.entries(routines))]))
    rt.classes.set(definition.name, definition)
  }
  const catalog = new DwCatalog(async () => undefined)
  catalog.get = async (name) => source.data[name] ? structuredClone(source.data[name]) : undefined
  const statements = new Map(source.statements.map((statement) => [stmtKey(statement.original), statement]))
  const calls = [], violations = []
  const progress = window.paymentCheckProgress = { mode: fixture.session.activeMode, phase: 'setup', calls }
  const reject = (message) => { violations.push(message); throw new Error(message) }
  const initialDocuments = () => [
    [101, 901, 10, 120], [102, 902, 11, 80], [103, 903, 31, 50], [104, 904, 32, 250],
    [105, 905, 10, 10], [106, 906, 10, 10],
  ].map(([rowid, doccode, moduleid, amount]) => ({
    rowid, doccode, moduleid, module: moduleid <= 11 ? 1 : 2, date: '2031-04-02 00:00:00',
    catcode: 1, category: 'Synthetic cash document', acccode: 42, usercode: 17,
    machinename: 'synthetic-workstation', headerno: 1, headerinvno: doccode, amount,
    cashacccode: 77, cashtendered: amount, cashcharged: amount, cashback: 0, remarks: 'Synthetic document',
    cashierjobcode: rowid === 105 ? 701 : rowid === 106 ? 700 : null, printed: 'N', supervised: rowid === 106 ? 'Y' : 'N',
    supervisedon: null, glvochcode: null,
  }))
  const headerName = 'd_cashierjobactivity_multiinvoice'
  const result = (dataName, rows, names = source.data[dataName].table.columns.map((column) => column.name)) => {
    const columns = source.data[dataName].table.columns
    return {
      columns: names.map((name) => {
        const column = columns.find((column) => column.name === name)
        if (!column) return reject(`Unknown payment result column: ${name}`)
        return { name, type: column.type === 'datetime' || column.type === 'date' ? 'timestamp' :
          /decimal|double|real/.test(column.type) ? 'numeric' : /long|int/.test(column.type) ? 'int4' : 'text' }
      }),
      rows: rows.map((row) => names.map((name) => row[name] ?? null)),
    }
  }
  let state, current, old, active = false
  Object.defineProperty(progress, 'current', { enumerable: true, get: () => current ? {
    rows: current.controls.dw_header.model.rowCount(), row: current.controls.dw_header.model.row,
    column: current.controls.dw_header.model.col, editor: current.views.dw_header?.editor?.outerHTML,
    validated: current.window.props.get('ib_rowvalidated'), currentRow: current.window.props.get('il_currrow'),
  } : null })
  const transactionDatabase = () => ({
    query: async (sql, params) => {
      const plan = source.retrieves.find((plan) => plan.name === headerName && plan.sql === sql)
      if (plan) {
        if (params.length !== 1 || params[0] !== state.rowId) return reject('Unexpected payment Open row-ID argument')
        calls.push({ kind: 'retrieve', name: headerName, params })
        return result(headerName, state.documents.filter((row) => row.rowid === params[0]))
      }
      const entry = source.statements.find((entry) => entry.sql === sql)
      if (!entry || params.length !== 1) return reject('Unexpected payment embedded query')
      if (entry.routine.endsWith('.open')) {
        if (params[0] !== 17) return reject('Unexpected payment cashier owner')
        calls.push({ kind: 'job' })
        if (state.failure === 'job') throw new Error('Synthetic job query failure')
        return { columns: [{ name: 'cashierjobcode', type: 'int4' }], rows: [[state.job]] }
      }
      if (entry.routine.endsWith('.ue_close')) {
        if (!state.documents.some((row) => row.doccode === params[0])) return reject('Unexpected payment ledger validation')
        calls.push({ kind: 'ledger', doccode: params[0] })
        return { columns: [{ name: 'count', type: 'int4' }], rows: [[1]] }
      }
      if (!entry.routine.endsWith('.wf_get_document_info') || !Number.isInteger(params[0])) return reject('Unexpected document lookup')
      const module = /IN \(10, 11\)/i.test(sql) ? 1 : /IN \(31, 32\)/i.test(sql) ? 2 : reject('Unexpected lookup module filter')
      calls.push({ kind: 'lookup', module, doccode: params[0] })
      if (state.failure === 'lookup') throw new Error('Synthetic document lookup failure')
      return result(headerName, state.documents.filter((row) => row.doccode === params[0] && row.module === module),
        ['rowid', 'date', 'moduleid', 'catcode', 'category', 'acccode', 'usercode', 'machinename', 'headerno', 'headerinvno',
          'amount', 'cashacccode', 'cashtendered', 'cashcharged', 'cashback', 'remarks', 'cashierjobcode', 'printed',
          'supervised', 'supervisedon', 'glvochcode'])
    },
    exec: async () => reject('Payment supervision must use the original procedure contract, not direct writes'),
    call: async (sql, params) => {
      const signature = source.procs.sp_supervise_cashieractivity
      if (sql !== signature.call || params.length !== signature.params.length) return reject('Unexpected payment procedure')
      const row = state.documents.find((row) => row.rowid === params[0])
      if (!row) return reject('Unknown payment procedure document')
      const values = { ...row, cashtendered: row.amount, cashcharged: row.amount, cashback: 0, cashierjobcode: state.job }
      signature.params.forEach(({ name }, index) => {
        const expected = values[name], actual = params[index]
        if (typeof expected === 'number' ? actual == null || Number(actual) !== expected : actual !== expected) {
          reject(`Unexpected payment procedure argument ${name}: ${JSON.stringify(actual)}`)
        }
      })
      if (state.staged) return reject('Payment procedure omitted the preceding transaction boundary')
      calls.push({ kind: 'supervise', rowid: row.rowid, params: [...params] })
      if (state.failRow === row.rowid) throw new Error('Synthetic supervision failure')
      state.staged = { ...row, supervised: 'Y', cashierjobcode: state.job }
      return { columns: [{ name: 'return_value', type: 'int4' }], row: [0], resultsets: [] }
    },
    commit: async () => {
      if (!state.staged) return reject('Payment commit without a supervised document')
      const row = state.staged
      state.documents[state.documents.findIndex((document) => document.rowid === row.rowid)] = row
      state.staged = null
      calls.push({ kind: 'commit', rowid: row.rowid })
    },
    rollback: async () => { state.staged = null; calls.push({ kind: 'rollback' }) },
    close: async () => { calls.push({ kind: 'disconnect' }) },
  })
  const printTransaction = new NTransaction(rt, 'transaction')
  printTransaction.db = {
    query: async (sql, params) => {
      const report = current?.controls.dw_print.props.get('dataobject')
      const plan = source.retrieves.find((plan) => plan.name === report && plan.sql === sql)
      const ids = params[0], attempted = calls.filter((call) => call.kind === 'supervise').map((call) => call.rowid)
      if (!plan || !report.includes('_print') || params.length !== 1 || JSON.stringify(ids) !== JSON.stringify(attempted)) {
        return reject('Unexpected payment print query or document array')
      }
      calls.push({ kind: 'print-retrieve', report, ids: [...ids] })
      return result(report, state.documents.filter((row) => ids.includes(row.rowid)))
    },
    exec: async () => reject('Payment print must not write'),
    call: async () => reject('Payment print must not call a procedure'),
    commit: async () => reject('Payment print must not commit'),
    rollback: async () => reject('Payment print must not roll back'),
    close: async () => {},
  }
  const preferences = new NDwBase(rt, 'datastore', 'datastore')
  preferences.attach(new DwModel(rt, 'synthetic_payment_preferences', {
    datawindow: {}, bands: {}, objects: [], table: { columns: [{ name: 'name', type: 'char(50)' }, { name: 'prefvalue', type: 'char(10)' }] },
  }))
  const activate = () => {
    if (active) throw new Error('Payment fixture already active')
    old = { catalog: rt.dwCatalog, fire: rt.fire, sql: rt.sql, sqlStmt: rt.sqlStmt, dwSql: rt.dwSql,
      openDb: rt.openDb, procs: rt.procs, print: fixture.ui.print,
      globals: new Map(['sqlca', 'gds_preferences', 'gl_usercode', 'gs_company', 'gs_localcomputername'].map((key) => [key, rt.globals.get(key)])) }
    active = true
    rt.dwCatalog = catalog; rt.sql = executeStatement; rt.procs = new ProcCaller(source.procs)
    rt.sqlStmt = (key) => statements.get(key) ?? reject('Unrecorded payment statement')
    rt.dwSql = (name) => source.retrieves.find((plan) => plan.name === name) ?? reject(`Unrecorded payment retrieve: ${name}`)
    rt.openDb = async (transaction) => {
      if (transaction.className !== 'u_transaction') return reject('Unexpected payment transaction owner')
      state.transaction = transaction; calls.push({ kind: 'connect' })
      if (state.failure === 'connect') throw new Error('Synthetic payment connection failure')
      return transactionDatabase()
    }
    rt.globals.set('sqlca', printTransaction); rt.globals.set('gds_preferences', preferences)
    rt.globals.set('gl_usercode', 17); rt.globals.set('gs_localcomputername', 'synthetic-workstation')
    fixture.ui.print = async (control) => {
      if (control !== current?.controls.dw_print || control.trans !== printTransaction ||
        control.props.get('visible') !== false || fixture.session.preferences.printMode !== 'classic') {
        return reject('Payment print escaped its original hidden Classic companion')
      }
      calls.push({ kind: 'print', report: control.model.name, args: [...control.model.args], rows: control.model.rowCount() })
      return 1
    }
    rt.fire = async (target, event, args) => {
      let owner = target
      while (owner && owner.className !== name) owner = owner.parent
      return owner ? Runtime.prototype.fire.call(rt, target, event, args) : old.fire(target, event, args)
    }
  }
  const restore = () => {
    rt.dwCatalog = old.catalog; rt.fire = old.fire; rt.sql = old.sql; rt.sqlStmt = old.sqlStmt; rt.dwSql = old.dwSql
    rt.openDb = old.openDb; rt.procs = old.procs; fixture.ui.print = old.print
    for (const [key, value] of old.globals) {
      if (value === undefined) rt.globals.delete(key)
      else rt.globals.set(key, value)
    }
    active = false
  }
  const feedback = () => document.querySelector('.presentation-runtime-dialog[open],.msgbox')
  const wait = async (predicate, description) => {
    for (let index = 0; index < 60; index++) { await settle(); if (predicate()) return }
    throw new Error(`Payment ${description} did not settle: ${JSON.stringify({ phase: progress.phase, violations,
      calls: calls.slice(-8), current: progress.current, feedback: feedback()?.textContent })}`)
  }
  const finish = async (work) => {
    let done = false, value, failure
    const messages = []
    Promise.resolve(work).then((result) => { value = result }, (error) => { failure = error }).finally(() => { done = true })
    await wait(() => {
      const message = feedback()
      if (message) { messages.push(message.textContent); message.querySelector('button').click() }
      return done
    }, 'operation')
    if (failure) throw failure
    await settle()
    return { value, messages }
  }
  const open = async (options = {}) => {
    if (current) throw new Error('Close the previous payment fixture first')
    progress.phase = `Open ${JSON.stringify(options)}`
    state = { documents: initialDocuments(), job: 700, rowId: 101, empty: 'Y', keepOpen: 'N', company: 'SYN', staged: null, ...options }
    rt.globals.set('gs_company', state.company)
    preferences.model.reset()
    for (const [key, value] of [['showemptydocumentcodebydefault', state.empty],
      ['keepcashwindowalwaysopen', state.keepOpen], ['showsavingsupervisemessages', 'Y']]) {
      const row = preferences.model.insertRow(0)
      preferences.model.setItem(row, 'name', key); preferences.model.setItem(row, 'prefvalue', value)
    }
    calls.length = 0
    let window, failure, done = false
    const ref = new Ref(() => window, (value) => { window = value }); ref.name = name
    const pending = rt.sys.get('openwithparm').fn(rt, [ref, state.rowId], new Frame(null, null, 0))
    pending.then(() => { done = true }, (error) => { failure = error; done = true })
    const messages = []
    await wait(() => {
      const message = feedback()
      if (message) { messages.push(message.textContent); message.querySelector('button').click() }
      return done || window?.children.get('dw_cash')?.model?.rowCount() === 1 && rt.modalWaiting > 0
    }, 'Open')
    if (failure) throw failure
    const view = fixture.ui.views.get(window)
    const controls = Object.fromEntries(['dw_header', 'dw_cash', 'dw_print'].map((key) => [key, window.children.get(key)]))
    await Promise.all(Object.values(controls).map((control) => control.ready))
    const views = Object.fromEntries(Object.entries(controls).map(([key, control]) => [key, view?.ctlViews.get(control)?.dw]))
    const edit = async (key, column, row = 1) => {
      controls[key].model.row = row; controls[key].model.col = controls[key].model.colIndex(column) + 1
      await fixture.ui.focusDw(controls[key], true); await settle()
      const input = views[key].editor
      if (!input) throw new Error(`Payment editor missing: ${key}.${column}`)
      return input
    }
    const close = async () => {
      if (current !== f) return
      try {
        if (window.isOpen) await finish(rt.fire(window.children.get('cb_cancel'), 'clicked'))
        await finish(pending)
      } finally { state.transaction?.destroy(); current = null }
    }
    const f = { window, view, controls, views, state, pending, messages, edit, close, calls }
    current = f
    return f
  }
  const enter = async (f, key, column, value, row = 1) => {
    progress.phase = `Edit ${key}.${column}[${row}]`
    const input = await f.edit(key, column, row)
    input.value = String(value); input.dispatchEvent(new Event('input', { bubbles: true }))
    return finish(f.views[key].acceptPendingEdit())
  }
  const lookupDocument = async (f, doccode, module = 1, row = 1) => {
    const model = f.controls.dw_header.model
    while (model.rowCount() < row) model.insertRow(0)
    model.setItem(row, 'module', module)
    await enter(f, 'dw_header', 'doccode', doccode, row)
    return finish(rt.fire(f.window, 'wf_validateitem'))
  }
  const save = async (f, print = false) => {
    progress.phase = print ? 'Print' : 'OK'
    return finish(rt.fire(f.window.children.get(print ? 'cb_print' : 'cb_ok'), 'clicked'))
  }
  const count = (kind) => calls.filter((call) => call.kind === kind).length
  const modern = fixture.session.activeMode === 'modern'
  activate()
  try {
    let f = await open()
    check(f.window.props.get('id_header') === f.controls.dw_header &&
      f.controls.dw_header.trans === f.state.transaction && f.controls.dw_cash.trans === f.state.transaction,
    'Payment Open owns its two entry buffers and transaction; its argument is a row ID, not a caller buffer')
    check(f.controls.dw_header.model.getItem(1, 'doccode') === null && count('retrieve') === 0 &&
      f.controls.dw_cash.model.colNames.every((column) => f.controls.dw_cash.model.getItem(1, column) === null),
    'Empty-document preference inserts source defaults without inventing payment amounts')
    check(f.view.ctlViews.size === 6 && f.view.el.classList.contains('modern-data-window') === modern &&
      f.view.client.contains(f.view.ctlViews.get(f.controls.dw_print).el) &&
      f.controls.dw_print.props.get('visible') === false,
    'Both modes retain all six controls and the source-hidden print companion')
    if (modern) check([...f.view.client.querySelectorAll('[data-window-data]')].map((element) => element.dataset.windowData).join() ===
      'dw_header,dw_cash', 'Payment sections preserve source display order and do not restyle the report as a form')
    await lookupDocument(f, 901)
    check(Number(f.controls.dw_header.model.getItem(1, 'amount')) === 120 &&
      f.controls.dw_header.model.getItem(1, 'rowid') === 101 && calls.some((call) => call.kind === 'lookup' && call.module === 1),
    'Original sale lookup copies its identity, amount and posting fields into the owned header')
    const duplicate = await lookupDocument(f, 901, 1, 2)
    check(duplicate.value === -1 && duplicate.messages.some((text) => text.includes('duplicate')) &&
      f.controls.dw_header.model.getItem(2, 'doccode') === null,
    'Duplicate module/document pairs retain the first row and clear the rejected document code')
    await lookupDocument(f, 903, 2, 2)
    check(Number(await f.controls.dw_header.model.getValue(1, 'c_total')) === 70 &&
      calls.some((call) => call.kind === 'lookup' && call.module === 2 && call.doccode === 903),
    'Sale returns use the original return lookup and subtract from the signed summary total')
    for (const value of ['-1', '69.99']) {
      const rejected = await enter(f, 'dw_cash', 'cashtendered', value)
      check(!rejected.value && rejected.messages.some((text) => text.includes('Cash Tendered')) &&
        f.controls.dw_cash.model.getItem(1, 'cashtendered') === null && count('supervise') === 0,
      `Invalid cash tendered ${JSON.stringify(value)} preserves the editable draft without supervision`)
    }
    await enter(f, 'dw_cash', 'cashtendered', '100')
    check(Number(f.controls.dw_cash.model.getItem(1, 'cashcharged')) === 70 &&
      Number(f.controls.dw_cash.model.getItem(1, 'cashback')) === 30, 'Accepted tender calculates exact signed invoice balance and change')
    const cleared = await enter(f, 'dw_cash', 'cashtendered', '')
    check(!cleared.value && cleared.messages.some((text) => text.includes('Cash Tendered')) &&
      Number(f.controls.dw_cash.model.getItem(1, 'cashtendered')) === 100 && count('supervise') === 0,
    'Clearing an accepted tender retains the amount and rejected draft without supervision')
    await enter(f, 'dw_cash', 'cashtendered', '100')
    const cash = f.controls.dw_cash
    check(!await f.views.dw_cash.canEdit(cash.model, cash.model.def.objects.find((object) => object.name === 'cashcharged'), 1) &&
      !await f.views.dw_cash.canEdit(cash.model, cash.model.def.objects.find((object) => object.name === 'cashback'), 1),
    'Charged and change fields remain source-readonly')
    await save(f); await finish(f.pending)
    check(!f.window.isOpen && rt.globals.get('message').props.get('doubleparm') === 1 &&
      count('supervise') === 2 && count('commit') === 2 && count('ledger') === 2,
    'Original OK supervises and commits each document independently, validates the ledger and returns acceptance')
    check(calls.filter((call) => call.kind === 'supervise').every((call) =>
      Number(call.params[6]) === (call.rowid === 101 ? 120 : 50) && Number(call.params[7]) === Number(call.params[6]) && Number(call.params[8]) === 0),
    'Procedure arguments preserve per-document amounts rather than substituting aggregate tendered cash')
    await f.close()

    f = await open()
    await lookupDocument(f, 901)
    const header = f.controls.dw_header.model, headerView = f.views.dw_header
    const headerKey = async (key, ctrlKey = false) => {
      if (headerView.editor) {
        headerView.editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
        await settle()
      }
      headerView.root.tabIndex = -1; headerView.root.focus(); await settle()
      const event = new KeyboardEvent('keydown', { key, ctrlKey, bubbles: true, cancelable: true })
      headerView.root.dispatchEvent(event)
      return finish(headerView.allowsDefaultKey(event))
    }
    await headerKey('i', true)
    check(header.rowCount() === 2 && header.row === 2 && header.getItem(2, 'module') === 1,
      'Original Ctrl+I validates the current document and appends a sale row')
    const previousCell = headerView.root.querySelector('[data-row="1"] [data-obj=doccode]')
    await finish(headerView.rowClick(header, 1, new MouseEvent('mousedown'), previousCell))
    check(header.row === 2, 'Source RowFocusChanging veto prevents clicking away from the final blank document')
    header.row = 2; header.col = header.colIndex('module') + 1
    await finish(headerView.tabNext(-1))
    check(header.row === 2, 'Source RowFocusChanging also prevents backward Tab from leaving the final blank document')
    await headerKey('d', true)
    check(header.rowCount() === 1 && header.getItem(1, 'doccode') === 901,
      'Original Ctrl+D deletes only the current blank document row')
    const documentInput = await f.edit('dw_header', 'doccode')
    progress.enter = { editor: documentInput.outerHTML, row: header.row, column: header.col }
    documentInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    await wait(() => header.rowCount() === 2, 'source Enter')
    check(header.row === 2 && header.getItem(2, 'module') === 1,
      'Original Enter uses the actual 23-column definition and appends a new sale row')
    if (headerView.editor) {
      headerView.editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
      await settle()
    }
    await headerKey('Escape'); await finish(f.pending)
    check(!f.window.isOpen && count('supervise') === 0 && count('commit') === 0,
      'Original header Escape cancels without supervising any document')
    await f.close()

    f = await open()
    await lookupDocument(f, 901); await lookupDocument(f, 902, 1, 2)
    const model = f.controls.dw_header.model, view = f.views.dw_header, originalFire = rt.fire
    try {
      for (const outcome of ['veto', 'changed-record', 'changed-focus', 'accept']) {
        model.row = 1; model.col = model.colIndex('doccode') + 1
        view.root.tabIndex = -1; view.root.focus(); await view.render()
        let release
        const events = []
        rt.fire = async (target, event, args) => {
          if (target === f.controls.dw_header && event === 'rowfocuschanging') {
            events.push(args)
            return new Promise((resolve) => { release = resolve })
          }
          return originalFire(target, event, args)
        }
        const target = view.root.querySelector('[data-row="2"] [data-obj=doccode]')
        const pending = view.rowClick(model, 2, new MouseEvent('mousedown'), target)
        await wait(() => !!release, 'controlled row admission')
        check(model.row === 1 && events.length === 1 && events[0].join() === '1,2',
          'Pointer row navigation waits for exactly one source admission result')
        if (outcome === 'changed-record') {
          model.deleteRow(2); model.insertRow(0); model.row = 1; model.col = model.colIndex('doccode') + 1
        }
        if (outcome === 'changed-focus') f.view.ctlViews.get(f.window.children.get('cb_cancel')).el.focus()
        release(outcome === 'veto' ? 1 : 0)
        await finish(pending)
        check(model.row === (outcome === 'accept' ? 2 : 1),
          `Row admission ${outcome} cannot move a stale, rejected or no-longer-focused transition`)
      }
    } finally { rt.fire = originalFire }
    await f.close()

    for (const [doccode, module, text] of [[999, 1, 'Sale Document'], [999, 2, 'Sale Return'], [905, 1, 'other Cashier Job'], [906, 1, 'already Supervised']]) {
      f = await open()
      const rejected = await lookupDocument(f, doccode, module)
      check(rejected.value === -1 && rejected.messages.some((message) => message.includes(text)) &&
        f.controls.dw_header.model.getItem(1, 'doccode') === null && count('supervise') === 0,
      `Rejected document ${doccode}/${module} cannot populate or post an unavailable activity`)
      await f.close()
    }
    f = await open()
    await lookupDocument(f, 904, 2)
    for (const value of ['249', '251']) {
      const rejected = await enter(f, 'dw_cash', 'cashtendered', value)
      check(!rejected.value && rejected.messages.some((text) => text.includes('Extacly Same')) &&
        f.controls.dw_cash.model.getItem(1, 'cashtendered') === null, 'Net returns require exactly the absolute source total')
    }
    await enter(f, 'dw_cash', 'cashtendered', '250')
    check(Number(await f.controls.dw_header.model.getValue(1, 'c_total')) === -250 &&
      Number(f.controls.dw_cash.model.getItem(1, 'cashcharged')) === 250 &&
      Number(f.controls.dw_cash.model.getItem(1, 'cashback')) === 0, 'Exact return tender is accepted without manufactured change')
    await f.close()
    check(count('supervise') === 0 && count('commit') === 0 && rt.globals.get('message').props.get('doubleparm') === -1,
      'Original Cancel discards the payment response without saving')

    for (const keepOpen of ['N', 'Y']) {
      f = await open({ empty: 'N', failRow: 102, keepOpen })
      check(f.controls.dw_header.model.getItem(1, 'doccode') === 901 && count('retrieve') === 1,
        'The nonempty preference retrieves by original row ID')
      await lookupDocument(f, 902, 1, 2)
      await enter(f, 'dw_cash', 'cashtendered', '200')
      const failed = await save(f)
      check(f.window.isOpen && failed.messages.some((text) => text.includes('Synthetic supervision failure')) &&
        count('supervise') === 2 && count('commit') === 1 &&
        f.state.documents.find((row) => row.rowid === 101).supervised === 'Y' &&
        f.state.documents.find((row) => row.rowid === 102).supervised === 'N' && !f.state.staged,
      'A later procedure failure preserves the earlier per-document commit; it is not an atomic batch')
      check(keepOpen === 'Y' ? f.controls.dw_header.model.rowCount() === 1 &&
        f.controls.dw_header.model.getItem(1, 'doccode') === null && f.controls.dw_cash.model.getItem(1, 'cashtendered') === null :
        f.controls.dw_header.model.rowCount() === 2 && Number(f.controls.dw_cash.model.getItem(1, 'cashtendered')) === 200,
      `Source keep-open preference ${keepOpen} controls buffer reset after failure`)
      await f.close()
    }
    for (const company of ['SYN', 'TM']) {
      f = await open({ empty: 'N', keepOpen: 'Y', company })
      await enter(f, 'dw_cash', 'cashtendered', '150')
      await save(f, true)
      const report = company === 'TM' ? 'd_cashierjobactivity_multiinv_print_tm' : 'd_cashierjobactivity_multiinvoice_print'
      const printed = calls.find((call) => call.kind === 'print')
      check(count('commit') === 1 && count('print-retrieve') === 1 && count('print') === 1 &&
        printed.report === report && printed.rows === 1 && printed.args.some(([key, value]) => key.includes('cash') && Number(value) === 150),
      `Original Print selects ${company}'s report, retains tendered retrieve argument and uses only the controlled print boundary`)
      check(f.window.isOpen && f.controls.dw_header.model.rowCount() === 1 &&
        f.controls.dw_header.model.getItem(1, 'doccode') === null && f.controls.dw_cash.model.getItem(1, 'cashtendered') === null,
      'Successful keep-open payment resets both owned buffers for the next document')
      await f.close()
    }
    for (const options of [{ failure: 'connect' }, { failure: 'job' }, { job: null }, { job: -1 }]) {
      f = await open(options)
      check(!f.window.isOpen && f.messages.length > 0 && count('supervise') === 0 && count('commit') === 0,
        'Connection or cashier-job failure closes with original feedback and cannot post')
      await f.close()
    }
    check(violations.length === 0, 'Payment fixture rejects unknown SQL, arguments, procedures, transactions and print requests')
  } finally {
    if (current) await current.close()
    restore()
  }
  if (modern) window.openPaymentPreview = async (returns = false) => {
    activate()
    try {
      const f = await open()
      await lookupDocument(f, returns ? 904 : 901, returns ? 2 : 1)
      if (!returns) await lookupDocument(f, 903, 2, 2)
      const close = f.close
      f.close = async () => { try { await close() } finally { restore() } }
      window.paymentPreview = f
    } catch (error) {
      if (current) await current.close()
      restore()
      throw error
    }
  }
}
