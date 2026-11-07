import { Runtime, Ref, Frame } from './src/runtime/interp.js'
import { fixClassData } from './src/runtime/class-fixes.js'
import { NDwBase } from './src/runtime/native/dwctrl.js'
import { NTransaction, executeStatement, stmtKey } from './src/runtime/native/transaction.js'
import { DwCatalog } from './src/dw/def.js'
import { DwModel } from './src/dw/model.js'
import { parseScriptFile } from './src/pbscript/parser.js'

// Real closing scripts and DataWindows. Records, transport and the authorization
// dialog's result are synthetic; this does not validate credentials or PostgreSQL.
export async function checkCashierClosing(fixture, check, settle) {
  const source = await (await fetch('./presentation-cashier.json')).json()
  const rt = fixture.rt, name = 'w_cashiershift_closing'
  for (const definition of source.classes) {
    const fixes = fixClassData(definition.name, definition)
    if (definition.name === name) check(fixes.length === 2, 'Cashier source corrections run through the production class-fix hook')
    definition.routines = new Map(Object.entries(definition.routines).map(([owner, routines]) => [owner, new Map(Object.entries(routines))]))
    rt.classes.set(definition.name, definition)
  }
  const catalog = new DwCatalog(async () => undefined)
  catalog.get = async (name) => source.data[name] ? structuredClone(source.data[name]) : undefined
  const statements = new Map(source.statements.map((statement) => [stmtKey(statement.original), statement]))
  const calls = [], violations = []
  const progress = window.cashierCheckProgress = { mode: fixture.session.activeMode, phase: 'setup', calls }
  const reject = (message) => { violations.push(message); throw new Error(message) }
  const initialShift = () => ({
    code: 700, openedon: '2031-04-02 08:00:00.000', closedon: null, openedby: 17, closedby: null,
    shiftowner: 17, shiftstatus: 'O', cashacccode: 77, openingbalance: 100,
    totalamount: 0, amttransfered: 0, amttransferedto: null, amttransferedon: null, remarks: null, refno: null,
    cashsales: 200, creditsales: 30, cashsr: 10, creditsr: 4, cashservice: 50, creditservice: 8,
    cashservicereturn: 5, creditservicereturn: 2, totalreceipts: 80, totalpayments: 20,
    netamt: 295, diffamt: 0, difftransferedto: 42,
  })
  const denominations = [
    { code: 1, type: 'N', name: 'Synthetic fifty', denomination: 50 },
    { code: 1, type: 'N', name: 'Synthetic hundred', denomination: 100 },
  ]
  const countRows = () => denominations.map((row) => ({ ...row, code: 700, currencycode: 1, qty: 1 }))
  let state, current, old, active = false
  const result = (dataName, rows) => {
    const columns = source.data[dataName].table.columns
    return {
      columns: columns.map((column) => ({ name: column.dbname.split('.').at(-1).toLowerCase(),
        type: column.type === 'datetime' ? 'timestamp' : /decimal|double|real/.test(column.type) ? 'numeric' :
          /long|int/.test(column.type) ? 'int4' : 'text' })),
      rows: rows.map((row) => columns.map((column) => row[column.name] ?? null)),
    }
  }
  const rowsFor = (dataName) => {
    switch (dataName) {
      case 'd_cashiershift_closing': return [state.shift]
      case 'd_cashiershift_figures': return [{ ...state.shift, totalamount: state.cash.reduce((sum, row) => sum + row.qty * row.denomination, 0) }]
      case 'd_cashiershift_cashdenomination': return state.cash
      case 'd_currency_denominations': return denominations
      case 'd_cashiershift_unpostedtrans': return state.unposted ? [{ invcode: 'Synthetic Sale Inv. No. = 901' }] : []
      case 'ddd_users': return [{ usercode: 17, username: 'Synthetic cashier' }]
      case 'ddd_currency': return [{ code: 1, name: 'Synthetic currency', shortname: 'SYN', conversionfactor: 1 }]
      case 'ddd_cashaccounts': return [{ acccode: 77, name: 'Synthetic till' }]
      case 'ddd_cashbankaccounts_cashiershift': return [{ acccode: 88, name: 'Synthetic bank' }]
      case 'ddd_suspense_cashiershift': return [{ acccode: 42, name: 'Synthetic difference account' }]
      default: return reject(`Unexpected cashier records: ${dataName}`)
    }
  }
  const equivalent = (left, right) => left === right || left !== null && right !== null &&
    Number.isFinite(Number(left)) && Number.isFinite(Number(right)) && Number(left) === Number(right)
  const dataColumns = (table) => source.data[table === 'cashiershift' ? 'd_cashiershift_closing' : 'd_cashiershift_cashdenomination'].table.columns
  const applyWrite = (sql, params) => {
    const update = /^UPDATE dbo\.([a-z]+) SET (.+) WHERE (.+)$/.exec(sql)
    const insert = /^INSERT INTO dbo\.([a-z]+) \((.+)\) VALUES \((.+)\)$/.exec(sql)
    const match = update ?? insert, table = match?.[1]
    if (!match || !['cashiershift', 'cashiershiftcashcount'].includes(table) || insert && table !== 'cashiershiftcashcount') {
      return reject('Unexpected cashier write statement')
    }
    const columns = dataColumns(table)
    const names = new Map(columns.map((column) => [column.dbname.split('.').at(-1).toLowerCase(), column.name]))
    const pending = state.staged ??= structuredClone({ shift: state.shift, cash: state.cash })
    const values = {}, used = new Set()
    const parameter = (number) => {
      const index = Number(number) - 1
      if (index < 0 || index >= params.length || used.has(index)) return reject('Unexpected cashier write parameter')
      used.add(index)
      return params[index]
    }
    const columnName = (value) => names.get(value.replaceAll('"', '')) ?? reject('Unknown cashier write column')
    if (insert) {
      const fields = insert[2].split(', '), places = insert[3].split(', ')
      if (fields.length !== columns.length || places.length !== fields.length) return reject('Incomplete cash-count insert')
      fields.forEach((field, index) => {
        const place = /^\$(\d+)$/.exec(places[index])
        if (!place) return reject('Unexpected cash-count insert expression')
        values[columnName(field)] = parameter(place[1])
      })
      if (Object.keys(values).length !== columns.length || values.code !== 700 || values.currencycode !== 1 ||
        values.type !== 'N' || ![50, 100].includes(Number(values.denomination)) || !Number.isInteger(values.qty) || values.qty < 0 ||
        pending.cash.some((row) => Number(row.denomination) === Number(values.denomination))) return reject('Invalid cash-count insert values')
      pending.cash.push(values)
    } else {
      for (const assignment of update[2].split(', ')) {
        const part = /^("?[a-z]+"?) = \$(\d+)$/.exec(assignment)
        if (!part) return reject('Unexpected cashier assignment')
        const field = columnName(part[1])
        if (Object.hasOwn(values, field)) return reject('Duplicate cashier assignment')
        values[field] = parameter(part[2])
      }
      const conditions = {}
      for (const predicate of update[3].split(' AND ')) {
        const part = /^("?[a-z]+"?) (?:IS NULL|= \$(\d+))$/.exec(predicate)
        if (!part) return reject('Unexpected cashier optimistic predicate')
        const field = columnName(part[1])
        if (Object.hasOwn(conditions, field)) return reject('Duplicate cashier optimistic predicate')
        conditions[field] = part[2] ? parameter(part[2]) : null
      }
      const mode = source.data[table === 'cashiershift' ? 'd_cashiershift_closing' : 'd_cashiershift_cashdenomination'].table.updatewhere
      if (!['0', '1'].includes(mode)) return reject('Unreviewed cashier update predicate mode')
      const predicates = columns.filter((column) => mode === '1' || column.key === 'yes').map((column) => column.name)
      if (Object.keys(conditions).length !== predicates.length || predicates.some((name) => !Object.hasOwn(conditions, name))) {
        return reject('Cashier update omitted a source-required original-value predicate')
      }
      const candidates = table === 'cashiershift' ? [pending.shift] : pending.cash
      const row = candidates.find((row) => Object.entries(conditions).every(([key, value]) => equivalent(row[key], value)))
      if (!row) return reject('Cashier update did not retain its original snapshot')
      const protectedFields = table === 'cashiershift' ?
        ['code', 'openedon', 'openedby', 'shiftowner', 'cashacccode', 'openingbalance'] : ['code', 'currencycode', 'type', 'name', 'denomination']
      if (Object.keys(values).some((key) => protectedFields.includes(key))) return reject('Cashier update changed protected identity')
      Object.assign(row, values)
    }
    if (used.size !== params.length) return reject('Unused cashier write parameter')
    return table
  }
  const shiftDatabase = () => ({
    query: async (sql, params) => {
      const plan = source.retrieves.find((plan) => plan.sql === sql)
      if (plan) {
        const expected = plan.params.length ? [plan.name === 'd_currency_denominations' ? 1 : 700] : []
        if (JSON.stringify(params) !== JSON.stringify(expected)) return reject(`Unexpected cashier retrieve parameters: ${plan.name}`)
        calls.push({ scope: 'shift', kind: 'retrieve', name: plan.name, params })
        return result(plan.name, rowsFor(plan.name))
      }
      const entry = source.statements.find((statement) => statement.sql === sql && statement.into?.length === 2)
      if (!entry || params.length !== 1 || params[0] !== 700) return reject('Unexpected cashier identity query')
      calls.push({ scope: 'shift', kind: 'identity' })
      return { columns: [{ name: 'cashiershiftcode', type: 'int4' }, { name: 'shiftstatus', type: 'text' }], rows: [[700, state.shift.shiftstatus]] }
    },
    exec: async (sql, params) => {
      const previous = structuredClone(state.staged)
      const table = applyWrite(sql, params)
      calls.push({ scope: 'shift', kind: 'write', table, sql, params: [...params] })
      if (state.failure === (table === 'cashiershift' ? 'detail' : 'cash')) {
        state.staged = previous
        throw new Error(`Synthetic ${state.failure} write failure`)
      }
      return { rowcount: 1 }
    },
    call: async () => reject('Cashier closing must not call a stored procedure'),
    commit: async () => {
      const staged = state.staged
      if (!staged || staged.shift.shiftstatus !== 'C' || staged.shift.closedby !== state.authUser || state.authUser <= 0 ||
        staged.shift.closedon !== state.now || Number(staged.shift.totalamount) !== staged.cash.reduce((sum, row) => sum + row.qty * row.denomination, 0)) {
        return reject('Cashier commit is missing the authorized closing record or matching cash count')
      }
      state.shift = staged.shift; state.cash = staged.cash; state.staged = null
      calls.push({ scope: 'shift', kind: 'commit' })
    },
    rollback: async () => { state.staged = null; calls.push({ scope: 'shift', kind: 'rollback' }) },
    close: async () => { calls.push({ scope: 'shift', kind: 'disconnect' }) },
  })
  const clock = new NTransaction(rt, 'transaction')
  clock.db = {
    query: async (sql, params) => {
      const last = source.statements.find((entry) => entry.into?.length === 1)
      if (params.length || sql !== last.sql && sql !== 'SELECT localtimestamp(3)') return reject('Unexpected cashier date query')
      calls.push({ scope: 'clock', kind: 'query' })
      return { columns: [{ name: 'date', type: 'timestamp' }], rows: [[sql === last.sql ? state.lastDate : state.now]] }
    },
    exec: async (sql, params) => {
      const entry = source.statements.find((entry) => !entry.into)
      if (sql !== entry.sql || params.length !== 1 || params[0] !== state.now) return reject('Unexpected cashier server-date write')
      calls.push({ scope: 'clock', kind: 'write' })
      if (state.failure === 'clock') throw new Error('Synthetic server-date write failure')
      state.stagedDate = params[0]
      return { rowcount: 1 }
    },
    call: async () => reject('Cashier date validation must not call a stored procedure'),
    commit: async () => {
      if (!state.stagedDate) return reject('Cashier date commit without a validated date')
      state.lastDate = state.stagedDate; state.stagedDate = null
      calls.push({ scope: 'clock', kind: 'commit' })
    },
    rollback: async () => { state.stagedDate = null; calls.push({ scope: 'clock', kind: 'rollback' }) },
    close: async () => {},
  }
  const preferences = new NDwBase(rt, 'datastore', 'datastore')
  const preferenceModel = new DwModel(rt, 'synthetic_preferences', {
    datawindow: {}, bands: {}, objects: [], table: { columns: [{ name: 'name', type: 'char(40)' }, { name: 'prefvalue', type: 'char(10)' }] },
  })
  preferenceModel.insertRow(0); preferenceModel.setItem(1, 'name', 'maxallowdate'); preferenceModel.setItem(1, 'prefvalue', '4')
  preferences.attach(preferenceModel)
  const activate = () => {
    if (active) throw new Error('Cashier fixture already active')
    old = { catalog: rt.dwCatalog, fire: rt.fire, sql: rt.sql, sqlStmt: rt.sqlStmt, dwSql: rt.dwSql, openDb: rt.openDb,
      open: rt.sys.get('open'), sqlca: rt.globals.get('sqlca'), preferences: rt.globals.get('gds_preferences') }
    active = true
    rt.dwCatalog = catalog; rt.sql = executeStatement
    rt.sqlStmt = (key) => statements.get(key) ?? reject('Unrecorded cashier statement')
    rt.dwSql = (name) => source.retrieves.find((plan) => plan.name === name) ?? reject(`Unrecorded cashier retrieve ${name}`)
    rt.openDb = async (transaction) => {
      if (transaction.className !== 'u_transaction') return reject('Unexpected cashier transaction owner')
      state.transaction = transaction
      calls.push({ scope: 'shift', kind: 'connect' })
      if (state.failure === 'connect') throw new Error('Synthetic cashier connection failure')
      return shiftDatabase()
    }
    rt.globals.set('sqlca', clock); rt.globals.set('gds_preferences', preferences)
    rt.sys.set('open', { ...old.open, fn: async (_rt, args) => {
      if (args.length !== 1 || !(args[0] instanceof Ref) || args[0].name !== 'w_salesmanpassword') return reject('Unexpected cashier child window')
      calls.push({ scope: 'authorization', kind: 'result', user: state.authUser })
      rt.globals.get('message').pbSet('doubleparm', state.authUser)
      return 1
    } })
    rt.fire = async (target, event, args) => {
      let owner = target
      while (owner && owner.className !== name) owner = owner.parent
      if (!owner) return old.fire(target, event, args)
      return Runtime.prototype.fire.call(rt, target, event, args)
    }
  }
  const restore = () => {
    rt.dwCatalog = old.catalog; rt.fire = old.fire; rt.sql = old.sql; rt.sqlStmt = old.sqlStmt
    rt.dwSql = old.dwSql; rt.openDb = old.openDb; rt.sys.set('open', old.open)
    for (const [name, value] of [['sqlca', old.sqlca], ['gds_preferences', old.preferences]]) {
      if (value === undefined) rt.globals.delete(name)
      else rt.globals.set(name, value)
    }
    active = false
  }
  const feedback = () => document.querySelector('.presentation-runtime-dialog[open],.msgbox')
  const wait = async (predicate, description) => {
    for (let index = 0; index < 60; index++) { await settle(); if (predicate()) return }
    throw new Error(`Cashier ${description} did not settle: ${JSON.stringify({ phase: progress.phase, violations,
      calls: calls.slice(-6), feedback: feedback()?.textContent })}`)
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
    progress.phase = `Open ${JSON.stringify(options)}`
    if (current) throw new Error('Close the previous cashier fixture first')
    state = { shift: initialShift(), cash: options.existing ? countRows() : [], staged: null, authUser: 17,
      now: '2031-04-02 17:30:00.000', lastDate: '2031-04-02 16:00:00.000', unposted: false, ...options }
    if (options.closed) Object.assign(state.shift, { shiftstatus: 'C', closedby: 17, closedon: state.now, totalamount: 150 })
    calls.length = 0
    let window, failure, done = false
    const ref = new Ref(() => window, (value) => { window = value })
    ref.name = name
    const pending = rt.sys.get('openwithparm').fn(rt, [ref, 700], new Frame(null, null, 0))
    pending.then(() => { done = true }, (error) => { failure = error; done = true })
    const messages = []
    await wait(() => {
      const message = feedback()
      if (message) { messages.push(message.textContent); message.querySelector('button').click() }
      return done || failure || window?.children.get('dw_figures')?.model?.rowCount() === 1 && rt.modalWaiting > 0
    }, 'Open')
    if (failure) throw failure
    const view = fixture.ui.views.get(window)
    const controls = Object.fromEntries(['dw_detail', 'dw_cash', 'dw_figures'].map((name) => [name, window.children.get(name)]))
    await Promise.all(Object.values(controls).map((control) => control.ready))
    const views = Object.fromEntries(Object.entries(controls).map(([name, control]) => [name, view?.ctlViews.get(control)?.dw]))
    const edit = async (controlName, column, row = 1) => {
      const control = controls[controlName], model = control.model
      model.row = row; model.col = model.colIndex(column) + 1
      await fixture.ui.focusDw(control, true); await settle()
      const editor = views[controlName].editor
      if (!editor) throw new Error(`Cashier editor missing: ${controlName}.${column}`)
      return editor
    }
    const click = (name) => view.ctlViews.get(window.children.get(name)).el.click()
    const close = async () => {
      if (current !== f) return
      try {
        if (window.isOpen) click('cb_cancel')
        await finish(pending)
      } finally { state.transaction?.destroy(); current = null }
    }
    const f = { window, view, controls, views, state, pending, messages, edit, click, close, calls }
    current = f
    return f
  }
  const enter = async (f, control, column, value, row = 1) => {
    progress.phase = `Edit ${control}.${column}[${row}]`
    const input = await f.edit(control, column, row)
    input.value = String(value); input.dispatchEvent(new Event('input', { bubbles: true }))
    return finish(f.views[control].acceptPendingEdit())
  }
  const save = async (f) => {
    progress.phase = 'Close Shift'
    const result = await finish(rt.fire(f.window.children.get('cb_ok'), 'clicked'))
    progress.phase = `Close Shift returned; open=${f.window.isOpen}`
    return result
  }
  const counts = (kind, scope = 'shift') => calls.filter((call) => call.kind === kind && call.scope === scope).length
  const prepare = async (f) => {
    await enter(f, 'dw_cash', 'qty', 3, 1); await enter(f, 'dw_cash', 'qty', 2, 2)
    f.controls.dw_figures.model.setItem(1, 'amttransferedto', 88)
    await enter(f, 'dw_figures', 'amttransfered', 40)
    await enter(f, 'dw_figures', 'remarks', 'Synthetic counted cash')
    await enter(f, 'dw_figures', 'refno', 'SYN-700')
    await rt.fire(f.window, 'wf_updatetotals')
    await settle()
  }
  const modern = fixture.session.activeMode === 'modern'
  activate()
  try {
    let f = await open()
    check(f.window.props.get('il_code') === 700 && f.window.props.get('il_protect') === 0 &&
      Object.values(f.controls).every((control) => control.trans === f.state.transaction),
    'Open passes the real shift argument and owns one transaction across all three DataWindows')
    check(f.controls.dw_cash.model.rowCount() === 2 && f.controls.dw_cash.model.getItem(1, 'code') === 700 &&
      f.controls.dw_cash.model.colNames[f.controls.dw_cash.model.col - 1] === 'qty' &&
      calls.some((call) => call.name === 'd_currency_denominations' && call.params[0] === 1),
    'An uncounted shift initializes original currency denominations and selects quantity')
    check(f.view.ctlViews.size === 5 && f.view.el.classList.contains('modern-data-window') === modern,
      'The real cashier modal preserves every source control in both presentation modes')
    if (modern) {
      check([...f.view.client.querySelectorAll('[data-window-data]')].map((element) => element.dataset.windowData).join() ===
        'dw_detail,dw_cash,dw_figures', 'Modern cashier sections follow display order rather than export order')
      check(f.views.dw_figures.root.querySelectorAll('.surface-separator:not([hidden])').length === 2 &&
        !f.views.dw_figures.root.querySelector('[data-obj=cashsales]') &&
        !!f.views.dw_figures.root.querySelector('[data-obj=compute_7]'),
      'Open-shift figures retain source visibility, conditional separators and the always-visible actual cash compute')
      const target = f.views.dw_figures.root.querySelector('[data-obj=amttransfered]')
      target.focus()
      target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))
      await settle()
      check(f.views.dw_figures.editor?.isConnected && f.views.dw_figures.root.contains(document.activeElement),
        'Source GetFocus repaint during pointer-down retains a live text editor instead of losing the subsequent click')
    }
    const cancelledInput = await f.edit('dw_cash', 'qty')
    cancelledInput.value = '99'; cancelledInput.dispatchEvent(new Event('input', { bubbles: true }))
    const cancelEdit = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    cancelledInput.dispatchEvent(cancelEdit); await settle()
    check(cancelEdit.defaultPrevented && f.window.isOpen && !f.views.dw_cash.editor &&
      Number(f.controls.dw_cash.model.getItem(1, 'qty')) === 0 && f.views.dw_cash.root.contains(document.activeElement),
    'Editor Escape consumes the key before removing its input, retaining focus without invoking the native Cancel button')
    const invalid = await enter(f, 'dw_cash', 'qty', -1)
    check(!invalid.value && f.views.dw_cash.editor?.value === '-1' && Number(f.controls.dw_cash.model.getItem(1, 'qty')) === 0 &&
      counts('write') === 0, 'Negative quantity stays recoverable and cannot change the cash buffer or database')
    await prepare(f)
    const figures = f.controls.dw_figures.model
    check(Number(await f.controls.dw_cash.model.getValue(1, 'c_totalamount')) === 350 &&
      Number(figures.getItem(1, 'totalamount')) === 350 && Number(figures.getItem(1, 'netamt')) === 295 &&
      Number(figures.getItem(1, 'diffamt')) === -5 && Number(await figures.getValue(1, 'compute_1')) === 390,
    'Original denomination, net collection, actual cash and difference calculations use the same edited buffers')
    figures.setItem(1, 'openingbalance', 120)
    await rt.fire(f.window, 'wf_updatetotals')
    check(Number(figures.getItem(1, 'diffamt')) === -25, 'The original difference formula uses the figures opening balance')
    figures.setItem(1, 'openingbalance', 100)
    const amountRejected = await enter(f, 'dw_figures', 'amttransfered', -1)
    check(!amountRejected.value && f.views.dw_figures.editor?.value === '-1' &&
      Number(figures.getItem(1, 'amttransfered')) === 40, 'Negative transferred amounts preserve the accepted value and editable draft')
    await enter(f, 'dw_figures', 'amttransfered', 40)
    figures.setItem(1, 'amttransferedto', null)
    const accountRejected = await save(f)
    check(accountRejected.messages.some((text) => text.includes('Please select Valid Account')) && f.window.isOpen &&
      counts('write') === 0 && counts('commit') === 0, 'Missing transfer account blocks closing with the original validation feedback')
    figures.setItem(1, 'amttransferedto', 88)
    f.state.authUser = 0
    const denied = await save(f)
    check(denied.messages.length === 0 && f.window.isOpen && counts('write') === 0 && counts('commit') === 0,
      'A cancelled authorization result cannot close or write the shift')
    f.state.authUser = 17; f.state.unposted = true
    const unposted = await save(f)
    check(unposted.messages.some((text) => text.includes('unposted transactions')) && f.window.isOpen &&
      counts('write') === 0 && counts('commit') === 0, 'Closing rechecks unposted transactions after authorization')
    f.state.unposted = false
    const accepted = await save(f)
    await finish(f.pending)
    check(accepted.messages.some((text) => text.includes('Changes take effect')) && !f.window.isOpen &&
      counts('commit') === 1 && counts('commit', 'clock') === 1, 'Successful synthetic closing commits once and invokes the original close event')
    check(f.state.shift.shiftstatus === 'C' && f.state.shift.closedby === 17 && f.state.shift.closedon === f.state.now &&
      f.state.shift.amttransferedto === 88 && f.state.shift.remarks === 'Synthetic counted cash' && f.state.shift.refno === 'SYN-700' &&
      Number(f.state.shift.totalamount) === 350 && Number(f.state.shift.netamt) === 295 && Number(f.state.shift.diffamt) === -5 &&
      f.state.cash.map((row) => row.qty).join() === '3,2', 'Source closing copies identity, totals, transfer details and both cash-count rows to the synthetic transaction')
    await f.close()

    for (const failure of ['detail', 'cash']) {
      f = await open({ failure })
      await prepare(f)
      const rejected = await save(f)
      check(rejected.messages.some((text) => text.includes('Changes Rollback')) && f.window.isOpen &&
        f.state.shift.shiftstatus === 'O' && f.state.cash.length === 0 && counts('commit') === 0 && counts('rollback') === 1,
      `${failure} failure rolls back all closing writes and leaves the original window open`)
      check(f.controls.dw_detail.model.buildUpdate().length === 1 && f.controls.dw_cash.model.buildUpdate().length === 2,
        `${failure} failure retains both original snapshots and all pending edits for retry`)
      f.state.failure = null
      const retried = await save(f)
      await finish(f.pending)
      check(retried.messages.some((text) => text.includes('Changes take effect')) && counts('commit') === 1 &&
        f.state.shift.shiftstatus === 'C' && f.state.cash.map((row) => row.qty).join() === '3,2',
      `${failure} retry commits the same closing record and cash counts rather than losing an earlier update`)
      await f.close()
    }
    for (const options of [{ now: '2031-04-02 15:00:00.000' }, { now: '2031-04-08 17:30:00.000' }, { failure: 'clock' }]) {
      f = await open(options)
      const refused = await save(f)
      check(refused.messages.some((text) => text.includes('Date Violation')) && f.window.isOpen &&
        counts('write') === 0 && counts('commit') === 0,
      'Original backward, forward and failed server-date validation cannot persist a shift close')
      await f.close()
    }
    f = await open({ existing: true })
    check(!calls.some((call) => call.name === 'd_currency_denominations') && f.controls.dw_cash.model.rowCount() === 2,
      'Existing cash counts are retrieved rather than replaced with default denominations')
    await prepare(f)
    await save(f); await finish(f.pending)
    check(calls.filter((call) => call.kind === 'write' && call.table === 'cashiershiftcashcount')
      .every((call) => call.sql.startsWith('UPDATE ')) && f.state.cash.map((row) => row.qty).join() === '3,2',
    'Closing existing counts updates the correct original rows instead of inserting duplicates')
    await f.close()

    f = await open({ closed: true, existing: true })
    check(f.window.props.get('il_protect') === 1 && !f.window.children.get('cb_ok').props.get('enabled') &&
      Object.values(f.controls).every((control) => control.model.def.table.columns.every((column) =>
        control.model.describe(`${column.name}.protect`) === '1')), 'Closed shifts protect every DataWindow column and disable Close Shift')
    if (modern) check(f.views.dw_figures.root.querySelectorAll('.surface-separator:not([hidden])').length === 5 &&
      !!f.views.dw_figures.root.querySelector('[data-obj=cashsales]') &&
      f.views.dw_figures.root.querySelector('[data-obj=amttransfered]')?.getAttribute('aria-readonly') === 'true',
    'Closed-shift figures and separators appear without reopening their editors')
    f.click('cb_ok'); await settle()
    check(counts('result', 'authorization') === 0 && counts('write') === 0 && counts('commit') === 0,
      'A disabled closed-shift action cannot authorize or persist another close')
    await f.close()

    f = await open()
    const owner = rt.classes.get(name).routines.get('dw_cash'), previousKey = owner.get('ue_dwnkey')
    const keyFunction = 'cashier_fixture_key_result', previousFunction = rt.sys.get(keyFunction)
    const { file: keyScript, errors: keyErrors } = parseScriptFile(
      '// window cashier_key_fixture (synthetic)  ancestor: window\n\n' +
      '// dw_cash.ue_dwnkey(keycode key, unsignedlong keyflags) returns long [event]\nreturn cashier_fixture_key_result()\n')
    if (keyErrors.length || keyScript.routines.length !== 1) throw new Error(`Invalid controlled key fixture: ${JSON.stringify(keyErrors)}`)
    let keyResult, releaseKey, keyCalls = 0
    // Controlled native-key boundary, not another recovered cashier business routine.
    owner.set('ue_dwnkey', keyScript.routines)
    rt.sys.set(keyFunction, { fn: () => { keyCalls++; return keyResult } })
    const escape = async () => {
      keyResult = new Promise((resolve) => { releaseKey = resolve })
      const root = f.views.dw_cash.root
      root.tabIndex = -1; root.focus()
      root.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
      await settle()
    }
    try {
      await escape()
      check(f.window.isOpen && keyCalls === 1, 'Native Cancel waits for the original DataWindow key result')
      releaseKey(1); await settle()
      check(f.window.isOpen, 'DataWindow key return 1 suppresses native Cancel')
      await escape()
      f.view.ctlViews.get(f.window.children.get('cb_cancel')).el.focus()
      releaseKey(0); await settle()
      check(f.window.isOpen, 'A delayed key result cannot cancel after focus leaves its DataWindow')
      await escape()
      releaseKey(0); await finish(f.pending)
      check(!f.window.isOpen && keyCalls === 3 && counts('write') === 0,
        'An unconsumed DataWindow Escape invokes the original native Cancel without saving')
    } finally {
      if (previousKey === undefined) owner.delete('ue_dwnkey')
      else owner.set('ue_dwnkey', previousKey)
      if (previousFunction === undefined) rt.sys.delete(keyFunction)
      else rt.sys.set(keyFunction, previousFunction)
      await f.close()
    }

    for (const options of [{ failure: 'connect' }, { unposted: true }]) {
      f = await open(options)
      await finish(f.pending)
      check(!f.window.isOpen && f.messages.length > 0 && counts('write') === 0 && counts('commit') === 0,
        'Connection failure or unposted transactions at Open display source feedback and close without writes')
      await f.close()
    }
    check(violations.length === 0, 'Cashier fixtures use only their exact queries, guarded writes, dates and transaction boundaries')
  } finally {
    if (current) await current.close()
    restore()
  }
  if (modern) window.openCashierPreview = async (closed = false) => {
    activate()
    try {
      const f = await open({ closed, existing: closed })
      const close = f.close
      f.close = async () => { try { await close() } finally { restore() } }
      window.cashierPreview = f
    } catch (error) {
      if (current) await current.close()
      restore()
      throw error
    }
  }
}
