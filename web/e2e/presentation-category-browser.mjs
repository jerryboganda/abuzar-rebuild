import { Runtime, Ref, Frame } from './src/runtime/interp.js'
import { fixClassData } from './src/runtime/class-fixes.js'
import { NDwBase } from './src/runtime/native/dwctrl.js'
import { NTransaction, executeStatement, stmtKey } from './src/runtime/native/transaction.js'
import { ProcCaller } from './src/runtime/native/procs.js'
import { DwCatalog } from './src/dw/def.js'
import { DwModel } from './src/dw/model.js'

// Recovered category scripts and production SQL contracts; all records and
// transaction outcomes are synthetic, with no database or native bridge access.
export async function checkCashierCategory(fixture, check, settle) {
  const source = await (await fetch('./presentation-category.json')).json()
  const rt = fixture.rt, name = 'w_cashierjobactivity_changecategory'
  const dataName = 'd_cashierjobactivity_changecategory'
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
  const progress = window.categoryCheckProgress = { mode: fixture.session.activeMode, phase: 'setup', calls }
  const reject = (message) => { violations.push(message); throw new Error(message) }
  const initialRow = () => ({
    rowid: 101, date: '2031-04-02 00:00:00.000', moduleid: 1, doccode: 901, catcode: 1,
    category: 'Synthetic cash document', acccode: 19, usercode: 17, machinename: 'synthetic-station',
    headerno: 1, headerinvno: 901, amount: 120, cashacccode: 77, cashtendered: 120, cashcharged: 120,
    cashback: 0, remarks: 'Synthetic document for category change', cashierjobcode: null,
    posted: 'N', printed: 'N', supervised: 'N',
  })
  const accounts = [
    [19, 3, 5, 'Synthetic cash customer'], [22, 3, 5, 'Synthetic credit customer'],
    [42, 3, 7, 'Synthetic account choice'], [43, 3, 9, 'Synthetic restricted category'],
    [88, 7, -1, 'Synthetic supplier'],
  ].map(([acccode, subcode, custcatcode, name]) => ({
    acccode, subcode, custcatcode, name, aliasname: String(acccode), category: 'Synthetic category',
    subaccounts_name: subcode === 3 ? 'Customers' : 'Suppliers', city: 'Synthetic city', address: 'Synthetic address',
    restricted: 'N', balance: 0, balancetype: 'CR.', alertcode: null, alerttypecode: null,
  }))
  const result = (name, rows) => {
    const columns = source.data[name].table.columns
    return {
      columns: columns.map((column) => ({ name: column.dbname.split('.').at(-1).toLowerCase(),
        type: column.type === 'datetime' ? 'timestamp' : /decimal|double|real/.test(column.type) ? 'numeric' :
          /long|int/.test(column.type) ? 'int4' : 'text' })),
      rows: rows.map((row) => columns.map((column) => row[column.name] ?? null)),
    }
  }
  const equivalent = (left, right) => left === right || left != null && right != null &&
    Number.isFinite(Number(left)) && Number.isFinite(Number(right)) && Number(left) === Number(right)
  let state, current, old, active = false
  Object.defineProperty(progress, 'current', { enumerable: true, get: () => current ? {
    row: current.model.row, column: current.model.colNames[current.model.col - 1],
    values: current.model.buf.primary[0]?.v.map((value) => value == null ? null : String(value)),
    editor: current.dw?.editor?.outerHTML,
  } : null })
  const applyWrite = (sql, params) => {
    const match = /^UPDATE dbo\.cashieractivity SET (.+) WHERE (.+)$/.exec(sql)
    if (!match || state.staged) return reject('Unexpected category update or transaction boundary')
    const columns = source.data[dataName].table.columns, used = new Set(), values = {}, conditions = {}
    const parameter = (number) => {
      const index = Number(number) - 1
      if (index < 0 || index >= params.length || used.has(index)) return reject('Invalid category update parameter')
      used.add(index)
      return params[index]
    }
    for (const part of match[1].split(', ')) {
      const assignment = /^([a-z]+) = \$(\d+)$/.exec(part)
      if (!assignment || !['catcode', 'acccode', 'cashtendered', 'cashcharged', 'supervised'].includes(assignment[1]) ||
        Object.hasOwn(values, assignment[1])) return reject('Unexpected category assignment')
      values[assignment[1]] = parameter(assignment[2])
    }
    for (const part of match[2].split(' AND ')) {
      const predicate = /^"?([a-z]+)"? (?:IS NULL|= \$(\d+))$/.exec(part)
      if (!predicate || Object.hasOwn(conditions, predicate[1])) return reject('Unexpected category original-value predicate')
      conditions[predicate[1]] = predicate[2] ? parameter(predicate[2]) : null
    }
    const predicates = columns.filter((column) => column.key === 'yes' ||
      column.update === 'yes' && column.updatewhereclause !== 'no').map((column) => column.name)
    if (source.data[dataName].table.updatewhere !== '1' || Object.keys(conditions).length !== predicates.length ||
      predicates.some((key) => !Object.hasOwn(conditions, key) || !equivalent(conditions[key], state.row[key])) ||
      Object.hasOwn(conditions, 'posted') || used.size !== params.length) {
      return reject(`Category original-value mismatch: ${JSON.stringify({ conditions, expected: state.row, used: used.size, count: params.length })}`)
    }
    if (Object.keys(values).length !== 5 || Object.entries(values).some(([key, value]) => !equivalent(value, state.expected[key]))) {
      return reject('Category update differs from the expected edited fields')
    }
    state.staged = { ...state.row, ...values }
  }
  const database = () => ({
    query: async (sql, params) => {
      const plan = source.retrieves.find((plan) => plan.sql === sql)
      if (plan) {
        if (JSON.stringify(params) !== JSON.stringify(plan.name === dataName ? [state.rowId] : [])) return reject('Unexpected category retrieve arguments')
        calls.push({ kind: 'retrieve', name: plan.name })
        if (state.failure === 'retrieve' && plan.name === dataName) throw new Error('Synthetic activity retrieval failure')
        if (state.failure === 'accounts' && plan.name === 'ddd_allaccounts') throw new Error('Synthetic account retrieval failure')
        if (plan.name === dataName) return result(dataName, state.missing ? [] : [state.row])
        if (plan.name === 'ddd_allaccounts') return result(plan.name, accounts)
        if (plan.name === 'ddd_cashierjob_cashcredit') return result(plan.name, [{ code: 1, name: 'Cash' }, { code: 2, name: 'Credit' }])
        return reject('Unreviewed category lookup')
      }
      const entry = source.statements.find((statement) => statement.routine === `${name}.open`)
      if (sql !== entry.sql || params.length !== 1 || params[0] !== 17) return reject('Unexpected category cashier-job query')
      calls.push({ kind: 'job' })
      if (state.failure === 'job') throw new Error('Synthetic cashier-job query failure')
      return { columns: [{ name: 'cashierjobcode', type: 'int4' }], rows: [[state.job]] }
    },
    exec: async (sql, params) => {
      if (state.aborted) return reject('Category retry omitted rollback after the previous failed update')
      calls.push({ kind: 'update-attempt', sql, params })
      applyWrite(sql, params); calls.push({ kind: 'update', sql, params })
      if (state.failure === 'update') { state.staged = null; state.aborted = true; throw new Error('Synthetic category update failure') }
      if (state.failure === 'conflict') { state.staged = null; return { rowcount: 0 } }
      return { rowcount: 1 }
    },
    call: async (sql, params) => {
      const filter = source.procs.sp_getallowedgroupcustomercategory
      if (sql === filter.call) {
        if (params.length !== 2 || params[0] !== state.group || params[1] !== source.filterBuffer) {
          return reject('Category permissions must use the original user group and INOUT buffer')
        }
        calls.push({ kind: 'filter', params })
        if (state.failure === 'filter') throw new Error('Synthetic account-filter failure')
        return { columns: [{ name: 'return_value', type: 'int4' }, { name: 'custcatstring', type: 'text' }],
          row: [0, state.allowed], resultsets: [] }
      }
      const signature = source.procs.sp_supervise_cashieractivity
      if (sql !== signature.call || params.length !== signature.params.length || state.staged) return reject('Unexpected category procedure')
      signature.params.forEach(({ name }, index) => {
        if (!equivalent(params[index], state.expected[name])) reject(`Unexpected category procedure value: ${name}`)
      })
      calls.push({ kind: 'supervise', params })
      if (state.failure === 'supervise') throw new Error('Synthetic category supervision failure')
      state.staged = { ...state.expected, supervised: 'Y' }
      return { columns: [{ name: 'return_value', type: 'int4' }], row: [0], resultsets: [] }
    },
    commit: async () => {
      calls.push({ kind: 'commit-attempt' })
      if (state.failure === 'commit') throw new Error('Synthetic category commit failure')
      if (!state.staged && calls.some(({ kind }) => kind === 'update-attempt' || kind === 'supervise')) {
        return reject('Category write commit without a staged update')
      }
      if (state.staged) state.row = state.staged
      state.staged = null; calls.push({ kind: 'commit' })
      if (state.failure === 'commit-acknowledgment') throw new Error('Synthetic lost commit acknowledgment')
    },
    rollback: async () => { state.staged = null; state.aborted = false; calls.push({ kind: 'rollback' }) },
    close: async () => { calls.push({ kind: 'disconnect' }) },
  })
  const sqlca = new NTransaction(rt, 'transaction')
  sqlca.db = {
    query: async (sql, params) => {
      const entry = source.statements.find((statement) => statement.routine === 'f_getgroupcode.f_getgroupcode')
      if (sql !== entry.sql || params.length !== 1 || params[0] !== 17) return reject('Group lookup must use the current user on sqlca')
      calls.push({ kind: 'group' })
      if (state.failure === 'group') throw new Error('Synthetic user-group query failure')
      return { columns: [{ name: 'groupcode', type: 'int4' }], rows: [[state.group]] }
    },
    exec: async () => reject('Category sqlca must not write'), call: async () => reject('Category sqlca must not call procedures'),
    commit: async () => reject('Category sqlca must not commit'), rollback: async () => reject('Category sqlca must not roll back'),
    close: async () => {},
  }
  const preferences = new NDwBase(rt, 'datastore', 'datastore')
  preferences.attach(new DwModel(rt, 'synthetic_category_preferences', {
    datawindow: {}, bands: {}, objects: [], table: { columns: [{ name: 'name', type: 'char(50)' }, { name: 'prefvalue', type: 'char(10)' }] },
  }))
  const activate = () => {
    if (active) throw new Error('Category fixture already active')
    old = { catalog: rt.dwCatalog, fire: rt.fire, sql: rt.sql, sqlStmt: rt.sqlStmt, dwSql: rt.dwSql, openDb: rt.openDb, procs: rt.procs, onError: rt.onError,
      globals: new Map(['sqlca', 'gds_preferences', 'gl_usercode', 'gs_localcomputername'].map((key) => [key, rt.globals.get(key)])) }
    active = true
    rt.dwCatalog = catalog; rt.sql = executeStatement; rt.procs = new ProcCaller(source.procs)
    rt.sqlStmt = (key) => statements.get(key) ?? reject('Unrecorded category statement')
    rt.dwSql = (name) => source.retrieves.find((plan) => plan.name === name) ?? reject(`Unrecorded category retrieve: ${name}`)
    rt.openDb = async (transaction) => {
      if (transaction.className !== 'u_transaction') return reject('Unexpected category transaction owner')
      state.transaction = transaction; calls.push({ kind: 'connect' })
      if (state.failure === 'connect') throw new Error('Synthetic category connection failure')
      return database()
    }
    rt.globals.set('sqlca', sqlca); rt.globals.set('gds_preferences', preferences)
    rt.globals.set('gl_usercode', 17); rt.globals.set('gs_localcomputername', 'synthetic-station')
    rt.onError = (error) => {
      if (state.failure === 'accounts' && error instanceof Error && error.message === 'The choices for acccode could not be retrieved.') {
        state.lookupErrors.push(error.message)
      } else old.onError(error)
    }
    rt.fire = async (target, event, args) => {
      let owner = target
      while (owner && owner.className !== name) owner = owner.parent
      return owner ? Runtime.prototype.fire.call(rt, target, event, args) : old.fire(target, event, args)
    }
  }
  const restore = () => {
    rt.dwCatalog = old.catalog; rt.fire = old.fire; rt.sql = old.sql; rt.sqlStmt = old.sqlStmt
    rt.dwSql = old.dwSql; rt.openDb = old.openDb; rt.procs = old.procs
    rt.onError = old.onError
    for (const [key, value] of old.globals) {
      if (value === undefined) rt.globals.delete(key)
      else rt.globals.set(key, value)
    }
    active = false
  }
  const feedback = () => document.querySelector('.presentation-runtime-dialog[open],.msgbox')
  const wait = async (predicate, description) => {
    for (let index = 0; index < 80; index++) { await settle(); if (predicate()) return }
    throw new Error(`Category ${description} did not settle: ${JSON.stringify({ phase: progress.phase, violations, calls: calls.slice(-8) })}`)
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
    if (current) throw new Error('Close the previous category fixture first')
    progress.phase = `Open ${JSON.stringify(options)}`
    state = { row: initialRow(), rowId: 101, job: 700, group: 5, preference: 'N', allowed: '5,7', staged: null, lookupErrors: [], ...options }
    state.row.rowid = state.rowId
    state.expected = { ...state.row, cashierjobcode: state.job }
    preferences.model.reset()
    const row = preferences.model.insertRow(0)
    preferences.model.setItem(row, 'name', 'groupcustomercategory'); preferences.model.setItem(row, 'prefvalue', state.preference)
    calls.length = 0
    let window, failure, done = false
    const ref = new Ref(() => window, (value) => { window = value }); ref.name = name
    const pending = rt.sys.get('openwithparm').fn(rt, [ref, state.rowId], new Frame(null, null, 0))
    pending.then(() => { done = true }, (error) => { failure = error; done = true })
    const messages = []
    await wait(() => {
      const message = feedback()
      if (message) { messages.push(message.textContent); message.querySelector('button').click() }
      return done || window?.isOpen && rt.modalWaiting > 0
    }, 'Open')
    if (failure) throw failure
    const view = fixture.ui.views.get(window), control = window.children.get('dw_control')
    await control.ready
    const dw = view?.ctlViews.get(control)?.dw, model = control.model
    const edit = async (column) => {
      model.row = 1; model.col = model.colIndex(column) + 1
      await fixture.ui.focusDw(control, true); await settle()
      if (!dw.editor) throw new Error(`Category editor missing: ${column}`)
      return dw.editor
    }
    const close = async () => {
      if (current !== f) return
      try {
        if (window.isOpen) await finish(rt.fire(window.children.get('cb_cancel'), 'clicked'))
        await finish(pending)
      } finally { state.transaction?.destroy(); current = null }
    }
    const f = { window, view, control, dw, model, state, pending, messages, edit, close, calls }
    current = f
    return f
  }
  const enter = async (f, column, value) => {
    progress.phase = `Edit ${column}: ${value}`
    const input = await f.edit(column)
    input.value = String(value); input.dispatchEvent(new Event('input', { bubbles: true }))
    return finish(f.dw.acceptPendingEdit())
  }
  const choose = async (f, column, value) => {
    progress.phase = `Choose ${column}: ${value}`
    await f.edit(column)
    await wait(() => f.dw.choiceEdit?.options, 'choice loading')
    const editor = f.dw.choiceEdit, index = editor.options.items.findIndex((item) => equivalent(item.value, value))
    if (index < 0) throw new Error(`Category choice missing: ${column}/${value}`)
    return finish(editor.choose(index))
  }
  const save = (f) => { progress.phase = 'OK'; return finish(rt.fire(f.window.children.get('cb_ok'), 'clicked')) }
  const count = (kind) => calls.filter((call) => call.kind === kind).length
  const values = (f, columns) => columns.map((column) => f.model.getItem(1, column))
  const amounts = (f) => values(f, ['cashtendered', 'cashcharged', 'cashback']).map(Number)
  const allowedAccounts = (f) => f.window.props.get('idc_account').model.buf.primary.map((row) => row.v[0]).sort((a, b) => a - b).join()
  const modern = fixture.session.activeMode === 'modern'
  activate()
  try {
    let f = await open()
    check(f.window.props.get('id_dw') === f.control && f.control.trans === f.state.transaction &&
      f.window.props.get('idc_account').trans === f.state.transaction && count('group') === 1 && count('filter') === 0,
    'Category Open owns its record/account transactions while querying the current user group on separate sqlca')
    check(f.view.ctlViews.size === 3 && f.view.el.classList.contains('modern-data-window') === modern,
      'Category retains all three original controls with an opt-in context-local form')
    check(allowedAccounts(f) === '19,22,42,43', 'The ordinary preference permits customer accounts only')
    const child = f.window.props.get('idc_account').model
    check(child.getItem(1, 'name').startsWith('Synthetic ') && child.getItem(1, 'subaccounts_name') === 'Customers',
      'Joined Account.Name and SubAccount.Name remain separate rather than overwriting the customer display name')
    const editable = async (column) => f.dw.canEdit(f.model, f.model.def.objects.find((object) => object.name === column), 1)
    for (const column of ['doccode', 'remarks', 'amount', 'cashcharged', 'cashback', 'catcode', 'acccode', 'supervised']) {
      check(!await editable(column), `${column} obeys its source readonly or fully-paid protection`)
    }
    for (const value of ['-1', '']) {
      const rejected = await enter(f, 'cashtendered', value)
      check(!rejected.value && rejected.messages.some((text) => text.includes('Cash Tendered')) && amounts(f).join() === '120,120,0',
        'Rejected negative or empty tender preserves the source record and calculation')
    }
    await enter(f, 'cashtendered', '0')
    check(amounts(f).join() === '0,0,0' && values(f, ['catcode', 'acccode', 'supervised']).join() === '2,22,Y',
      'The inclusive zero-tender boundary keeps all amounts zero and selects the original credit state')
    await enter(f, 'cashtendered', '50')
    check(amounts(f).join() === '50,50,0' && values(f, ['catcode', 'acccode', 'supervised']).join() === '2,22,Y',
      'Partial tender calculates charged/change and selects the original credit account and supervision state')
    for (const column of ['catcode', 'acccode', 'supervised']) check(await editable(column), `${column} unlocks only when charged differs from amount`)
    await choose(f, 'catcode', 1)
    check(values(f, ['catcode', 'acccode', 'supervised']).join() === '1,19,Y', 'Cash category invokes the original account default')
    await choose(f, 'catcode', 2); await choose(f, 'acccode', 42)
    check(values(f, ['catcode', 'acccode', 'supervised']).join() === '2,42,Y', 'Credit category and account selection store original keys, not labels')
    await enter(f, 'cashtendered', '120.25')
    check(amounts(f).join() === '120.25,120,0.25',
      'Fractional tender preserves exact source decimal change rather than rounding to whole amounts')
    await enter(f, 'cashtendered', '150')
    check(amounts(f).join() === '150,120,30' && values(f, ['catcode', 'acccode']).join() === '1,19' && !await editable('acccode'),
      'Excess tender produces exact change and restores fully-paid protection')
    Object.assign(f.state.expected, { cashtendered: 150, cashcharged: 120, cashback: 30, catcode: 1, acccode: 19 })
    await save(f); await finish(f.pending)
    check(!f.window.isOpen && count('supervise') === 1 && count('commit') === 1 && count('update') === 0 &&
      rt.globals.get('message').props.get('doubleparm') === 1, 'Supervised category saves actual tender/charged/change through the original RPC and accepted return')
    await f.close()

    f = await open()
    await save(f); await finish(f.pending)
    check(!f.window.isOpen && count('commit') === 1 && count('update-attempt') === 0 && count('supervise') === 0 &&
      JSON.stringify(f.state.row) === JSON.stringify(initialRow()) && rt.globals.get('message').props.get('doubleparm') === 1,
      'Unchanged OK closes successfully after a read-only commit without rewriting or supervising the activity')
    await f.close()

    f = await open({ preference: 'Y', failure: 'accounts' })
    check(f.window.isOpen && f.messages.some((message) => message.includes('Synthetic account retrieval failure')) &&
      f.state.lookupErrors.length === 1 && allowedAccounts(f) === '' && count('commit') === 0,
      'Failed account retrieval reports the database and choice errors without substituting unfiltered accounts')
    await f.close()

    f = await open()
    await enter(f, 'cashtendered', '50')
    f.model.col = f.model.colIndex('cashtendered') + 1
    await finish(rt.fire(f.control, 'ue_enterkey'))
    check(f.model.col === f.model.colIndex('catcode') + 1 && f.dw.choiceEdit?.options?.items.length === 2,
      'Original Enter and real Handle/Send advance to the next editable category choice')
    await f.close()

    for (const allowed of ['5,7', '0']) {
      f = await open({ preference: 'Y', allowed })
      check(count('filter') === 1 && allowedAccounts(f) === (allowed === '0' ? '' : '19,22,42'),
        'INOUT group permissions restrict the account child, including a legitimate no-permitted-category result')
      await f.close()
      check(count('commit') === 0 && count('supervise') === 0 && rt.globals.get('message').props.get('doubleparm') === -1,
        'Category Cancel discards the response without database writes')
    }
    for (const failure of [undefined, 'update', 'conflict', 'commit']) {
      f = await open({ failure })
      await enter(f, 'cashtendered', '50'); await choose(f, 'supervised', 'N')
      Object.assign(f.state.expected, { catcode: 2, acccode: 22, cashtendered: 50, cashcharged: 50, supervised: 'N' })
      const saved = await save(f)
      if (!failure) {
        await finish(f.pending)
        check(!f.window.isOpen && count('update') === 1 && count('commit') === 1 && count('supervise') === 0 &&
          f.state.row.supervised === 'N', 'Explicit No saves the edited row with all source original-value predicates, excluding derived Posted')
      } else {
        check(f.window.isOpen && saved.messages.length > 0 && count('commit') === 0 &&
          f.model.modifiedCount() === 1 && amounts(f).join() === '50,50,0',
        `${failure} leaves the category dialog and dirty edits available with explicit failure feedback`)
        if (f.window.isOpen) {
          f.state.failure = undefined
          await save(f); await finish(f.pending)
          check(count('update') === 2 && count('commit') === 1, 'A category retry reuses the original snapshot after a failed write or commit')
        }
      }
      await f.close()
    }
    for (const failure of ['supervise', 'commit']) {
      f = await open({ failure })
      await enter(f, 'cashtendered', '50')
      Object.assign(f.state.expected, { catcode: 2, acccode: 22, cashtendered: 50, cashcharged: 50 })
      const saved = await save(f)
      check(f.window.isOpen && saved.messages.some((text) => text.includes('Synthetic category')) &&
        count('commit') === 0 && !f.state.staged && amounts(f).join() === '50,50,0',
      'A failed supervision or commit cannot return acceptance or discard pending category edits')
      await f.close()
    }
    f = await open({ failure: 'commit-acknowledgment' })
    await enter(f, 'cashtendered', '50')
    Object.assign(f.state.expected, { catcode: 2, acccode: 22, cashtendered: 50, cashcharged: 50 })
    const uncertain = await save(f)
    check(f.window.isOpen && uncertain.messages.some((text) => text.includes('Check the document before retrying')) &&
      count('supervise') === 1 && count('commit') === 1 && f.state.row.supervised === 'Y' && f.model.modifiedCount() === 1,
    'A lost commit acknowledgment retains the dialog and warns about uncertain outcome without automatically repeating the posting')
    await f.close()
    f = await open()
    await enter(f, 'cashtendered', '50')
    Object.assign(f.state.expected, { catcode: 2, acccode: 22, cashtendered: 50, cashcharged: 50 })
    const input = await f.edit('cashtendered')
    input.value = '-1'; input.dispatchEvent(new Event('input', { bubbles: true }))
    await save(f)
    check(f.window.isOpen && count('supervise') === 0 && count('commit') === 0,
      'Immediate OK cannot outrun the pending tender input event')
    const rejected = await save(f)
    check(f.window.isOpen && rejected.messages.some((text) => text.includes('Cash Tendered')) &&
      count('supervise') === 0 && count('commit') === 0, 'OK must not supervise the stale accepted value when the current tender draft is rejected')
    await f.close()
    for (const options of [
      { failure: 'connect' }, { failure: 'job' }, { job: null }, { job: -1 },
      { failure: 'group' }, { failure: 'retrieve' }, { missing: true },
      { preference: 'Y', failure: 'filter' }, ...['', ' ', null].map((allowed) => ({ preference: 'Y', allowed })),
    ]) {
      f = await open(options)
      check(!f.window.isOpen && f.messages.length > 0 && count('supervise') === 0 && count('commit') === 0 &&
        rt.globals.get('message').props.get('doubleparm') === -1,
        `Unavailable category data or permissions cannot expose an unfiltered editable dialog: ${JSON.stringify(options)}`)
      await f.close()
    }
    f = await open({ missing: true, rowId: 1 })
    check(!f.window.isOpen && rt.globals.get('message').props.get('doubleparm') === -1,
      'Failed category loading returns rejection even when the caller supplied row ID 1, the success sentinel')
    await f.close()
    check(violations.length === 0, `Category transport rejects unknown SQL, arguments, writes and procedure calls: ${violations.join('; ')}`)
  } finally {
    if (current) await current.close()
    restore()
  }
  if (modern) window.openCategoryPreview = async () => {
    activate()
    try {
      const f = await open({ preference: 'Y' })
      const close = f.close
      f.close = async () => { try { await close() } finally { restore() } }
      window.categoryPreview = f
    } catch (error) {
      if (current) await current.close()
      restore()
      throw error
    }
  }
}
