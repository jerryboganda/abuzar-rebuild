import { Runtime, Ref, Frame } from './src/runtime/interp.js'
import { PBStruct } from './src/runtime/object.js'
import { PBArray } from './src/runtime/values.js'
import { NDwBase } from './src/runtime/native/dwctrl.js'
import { NTransaction, executeStatement, stmtKey } from './src/runtime/native/transaction.js'
import { DwCatalog } from './src/dw/def.js'
import { DwModel } from './src/dw/model.js'

// Original modal, parameter structure, scripts and SQL translations; only records are synthetic.
export async function checkAssociatedInvoices(fixture, check, settle) {
  const source = await (await fetch('./presentation-associated-invoices.json')).json()
  const rt = fixture.rt, name = 'w_assocadvsaleinvlist_form', dataName = 'd_assocadvsaleinvlist'
  for (const definition of source.classes) {
    definition.routines = new Map(Object.entries(definition.routines).map(([owner, routines]) => [owner, new Map(Object.entries(routines))]))
    rt.classes.set(definition.name, definition)
  }
  const catalog = new DwCatalog(async () => undefined)
  catalog.get = async (name) => name === dataName ? structuredClone(source.data) : undefined
  const statements = new Map(source.statements.map((statement) => [stmtKey(statement.original), statement]))
  const calls = [], events = [], violations = []
  let active = false, old, current
  const reject = (message) => { violations.push(message); throw new Error(message) }
  const transaction = new NTransaction(rt, 'transaction')
  const totalsTransaction = new NTransaction(rt, 'transaction')
  const invoices = new Map([
    [901, { amount: 125.25 }], [902, { amount: 75.5 }], [903, { amount: null }],
    [904, { amount: 14, association: 701 }], [905, { amount: 15, unposted: true }],
    [906, { amount: 16, association: 700 }], [999, { amount: 0, missing: true }],
  ])
  const database = (totalOnly) => ({
    query: async (sql, params) => {
      const statement = source.statements.find((statement) => statement.sql === sql)
      if (!statement || params.length !== statement.params.length) return reject('Unexpected associated-invoice query')
      const total = statement.routine.endsWith('.wf_getsaleinv_netamt')
      const code = Number(params.at(-1)), invoice = invoices.get(code)
      if (total !== totalOnly || !invoice || params.some((param) => typeof param !== 'number') ||
        params.length === 2 && params[0] !== 700) return reject('Unexpected associated-invoice transaction or parameters')
      calls.push({ total, sql, params: [...params] })
      const associated = Boolean(invoice.association && (params.length === 1 || invoice.association !== params[0]))
      const values = total ? [invoice.amount] : statement.into.length === 3 ?
        [associated ? 1 : 0, associated ? code : null, associated ? invoice.association : null] :
        [sql.includes("posted = 'N'") ? Number(Boolean(invoice.unposted)) : Number(!invoice.missing)]
      return { columns: values.map((_, index) => ({ name: statement.into[index], type: total ? 'numeric' : 'integer' })), rows: [values] }
    },
    exec: async () => reject('Associated-invoice fixtures forbid writes'),
    call: async () => reject('Associated-invoice fixtures forbid procedures'),
    commit: async () => reject('Associated-invoice fixtures forbid commits'),
    rollback: async () => reject('Unexpected associated-invoice rollback'),
    close: async () => {},
  })
  transaction.db = database(false)
  totalsTransaction.db = database(true)
  const activate = () => {
    if (active) throw new Error('Associated-invoice fixture already active')
    old = { catalog: rt.dwCatalog, fire: rt.fire, sql: rt.sql, statement: rt.sqlStmt, dwSql: rt.dwSql,
      sqlca: rt.globals.get('sqlca') }
    active = true
    rt.dwCatalog = catalog
    rt.sql = executeStatement
    rt.sqlStmt = (key) => statements.get(key) ?? reject('Unrecorded associated-invoice SQL statement')
    rt.dwSql = () => reject('The associated-invoice modal must share, not retrieve, its caller buffer')
    rt.globals.set('sqlca', totalsTransaction)
    rt.fire = async (target, event, args) => {
      let owner = target
      while (owner && owner.className !== name) owner = owner.parent
      if (!owner) return old.fire(target, event, args)
      events.push({ target, event, args })
      return Runtime.prototype.fire.call(rt, target, event, args)
    }
  }
  const restore = () => {
    rt.dwCatalog = old.catalog; rt.fire = old.fire; rt.sql = old.sql; rt.sqlStmt = old.statement; rt.dwSql = old.dwSql
    if (old.sqlca === undefined) rt.globals.delete('sqlca')
    else rt.globals.set('sqlca', old.sqlca)
    active = false
  }
  const wait = async (predicate, description) => {
    for (let attempts = 0; attempts < 35; attempts++) {
      await settle()
      if (predicate()) return
    }
    throw new Error(`Associated-invoice ${description} did not settle: ${JSON.stringify({
      mode: fixture.session.activeMode, row: current?.model.row, col: current?.model.col,
      codes: current?.model.buf.primary.map((_, index) => current.model.getItem(index + 1, 'saleinvcode')),
      feedback: feedback()?.textContent, events: events.slice(-12).map(({ event, args }) => ({ event, args: args?.map((value) =>
        value && typeof value === 'object' ? value.name ?? value.className ?? 'object' : value) })),
    })}`)
  }
  const feedback = () => document.querySelector('.presentation-runtime-dialog[open],.msgbox')
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
  const open = async (rows = [], modify = false) => {
    if (current) throw new Error('Close the previous associated-invoice fixture first')
    const caller = new NDwBase(rt, 'datawindow', 'datawindow')
    const callerModel = new DwModel(rt, dataName, structuredClone(source.data))
    for (const row of rows) {
      const index = callerModel.insertRow(0)
      for (const [column, value] of Object.entries(row)) callerModel.setItem(index, column, value)
    }
    caller.attach(callerModel)
    const argument = await rt.defaultOf('s_dw_header')
    for (const [key, value] of Object.entries({
      dw_header: caller, t_transobject: transaction, b_modifystatus: modify, l_code: 700,
    })) argument.pbSet(key, value)
    let window, failure
    const ref = new Ref(() => window, (value) => { window = value })
    ref.name = name
    calls.length = 0; events.length = 0
    const pending = rt.sys.get('openwithparm').fn(rt, [ref, argument], new Frame(null, null, 0))
    pending.catch((error) => { failure = error })
    await wait(() => failure || window?.props.get('id_header')?.model?.rowCount() > 0 && rt.modalWaiting > 0, 'Open')
    if (failure) { caller.destroy(); throw failure }
    const view = fixture.ui.views.get(window), control = window.children.get('dw_viewheader')
    await control.ready
    const dw = view.ctlViews.get(control).dw, model = control.model
    const click = (name) => view.ctlViews.get(window.children.get(name)).el.click()
    const edit = async (row = model.row) => {
      model.row = row; model.col = model.colIndex('saleinvcode') + 1
      await fixture.ui.focusDw(control, true)
      await settle()
      if (!dw.editor) throw new Error(`Associated-invoice editor missing: ${JSON.stringify({
        mode: fixture.session.activeMode, row: model.row, column: model.col, rows: model.rowCount(),
        recovery: dw.root.querySelector('.surface-stale,.dw-recovery')?.textContent,
      })}`)
      return dw.editor
    }
    const close = async () => {
      if (current !== f) return
      try {
        if (window.isOpen) click('cb_cancel')
        await pending
      } finally { caller.destroy(); current = null }
    }
    const f = { window, argument, view, control, model, dw, caller, pending, edit, click, close,
      calls, events, returned: () => rt.globals.get('message').pbGet('powerobjectparm') }
    current = f
    return f
  }
  const enter = async (f, value, row = f.model.row) => {
    const input = await f.edit(row)
    input.value = String(value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    return finish(f.dw.acceptPendingEdit())
  }
  const okay = async (f, messageText) => {
    f.click('cb_ok')
    await wait(() => feedback() || !f.window.isOpen, 'OK')
    if (messageText) {
      const message = feedback()
      check(message?.textContent.includes(messageText), `Original OK explains ${messageText}`)
      message?.querySelector('button').click()
      await settle()
      check(f.window.isOpen && rt.globals.get('message').pbGet('powerobjectparm').pbGet('i_closemode') !== 1,
        'Rejected validation cannot publish an accepted return structure')
    } else {
      await f.pending
      const result = f.returned()
      check(result instanceof PBStruct && result.pbGet('i_closemode') === 1 && result.pbGet('dw_header') === f.control &&
        result.pbGet('values') instanceof PBArray, 'OK returns the original structure, shared control and values array')
    }
  }
  const key = async (target, value, ctrlKey = false) => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key: value, ctrlKey, bubbles: true, cancelable: true }))
    await settle()
  }
  const modern = fixture.session.activeMode === 'modern'
  activate()
  try {
    let f = await open()
    check(f.model.buf === f.caller.model.buf && f.model.rowCount() === 1 && f.model.row === 1 &&
      f.window.props.get('id_header') === f.control && f.control.trans === transaction && f.caller.trans === transaction,
    'Open shares the caller buffer, creates one empty row, selects it and retains its transaction')
    check(calls.length === 0 && f.model.getItem(1, 'saleinvcode') === null,
      'An empty caller does not trigger a retrieve or invent an invoice code')
    check(f.view.el.classList.contains('modern-data-window') === modern && f.view.ctlViews.size === 3,
      'Only Modern reflows the real response window, preserving every source control')
    await okay(f)
    check(f.caller.model.rowCount() === 0 && calls.length === 0, 'OK removes a blank optional row without database requests')
    await f.close()

    f = await open([{ saleinvcode: 901, netamt: 125.25 }])
    const edited = await enter(f, 902)
    check(edited.value && edited.messages.length === 0 && f.caller.model.getItem(1, 'saleinvcode') === 902 &&
      Number(f.caller.model.getItem(1, 'netamt')) === 75.5, 'ItemChanged applies the invoice key and queried total to the shared caller buffer')
    check(calls.length === 1 && calls[0].total && calls[0].params[0] === 902 &&
      events.filter((event) => event.event === 'itemchanged').length === 1, 'An accepted edit queries through sqlca and dispatches ItemChanged once')
    await enter(f, 903)
    check(Number(f.model.getItem(1, 'netamt')) === 0, 'A NULL invoice total follows the source zero-total rule')
    await enter(f, 902)
    const beforeInvalid = calls.length
    const rejected = await enter(f, 'invalid')
    check(!rejected.value && f.dw.editor?.value === 'invalid' && f.dw.editor?.getAttribute('aria-invalid') === 'true' &&
      f.model.getItem(1, 'saleinvcode') === 902 && calls.length === beforeInvalid,
    'Malformed numeric input remains marked, recoverable and uncommitted without querying')
    await enter(f, 901)
    await okay(f)
    check(calls.filter((call) => !call.total).length === 3 && f.caller.model.getItem(1, 'saleinvcode') === 901,
      'Accepted selection checks existence, association and posting without writing')
    await f.close()

    for (const [code, message] of [[999, 'does not exist'], [904, 'already associated'], [905, 'un-posted']]) {
      f = await open([{ saleinvcode: code, netamt: 0 }])
      await okay(f, message)
      check(f.caller.model.getItem(1, 'saleinvcode') === code, 'Rejected database validation retains the selected invoice for correction')
      await f.close()
      check(f.returned().pbGet('i_closemode') === -1, 'Cancel after rejection returns the source sentinel')
    }
    for (const [modify, accepted] of [[false, false], [true, true]]) {
      f = await open([{ saleinvcode: 906, netamt: 16 }], modify)
      check(f.window.props.get('ib_modifystatus') === modify && f.window.props.get('il_advsaleinvcode') === 700,
        'Open reads modify mode and advance-invoice identity from the real parameter structure')
      await okay(f, accepted ? undefined : 'already associated')
      const association = calls.find((call) => call.sql.includes('dbo.assocadvsaleinvlist'))
      check(JSON.stringify(association?.params) === JSON.stringify(modify ? [700, 906] : [906]),
        'Modify mode excludes only the caller advance invoice in the exact translated query')
      await f.close()
    }

    f = await open([{ saleinvcode: 901, netamt: 125.25 }, { saleinvcode: 902, netamt: 75.5 }])
    check(f.model.row === 2, 'Open selects the last shared record')
    await enter(f, 901, 2)
    await okay(f, 'Current row is duplicate')
    check(f.model.getItem(2, 'saleinvcode') === null && f.model.row === 2 && f.model.col === f.model.colIndex('saleinvcode') + 1 &&
      f.caller.model.getItem(1, 'saleinvcode') === 901, 'Duplicate validation clears only the rejected key and selects its source row and column')
    await enter(f, 902, 2)
    await okay(f)
    check(f.caller.model.rowCount() === 2, 'Corrected duplicate retains both accepted invoices')
    await f.close()

    f = await open([{ saleinvcode: 901, netamt: 125.25 }])
    await key(await f.edit(), 'i', true)
    check(f.model.rowCount() === 2 && f.model.row === 2 && f.caller.model.rowCount() === 2,
      'Ctrl+I dispatches the original insertion script once through the live editor')
    await key(await f.edit(), 'd', true)
    check(f.model.rowCount() === 1 && f.caller.model.getItem(1, 'saleinvcode') === 901,
      'Ctrl+D deletes exactly the current shared row through its original script')
    check(!f.dw.root.querySelector('.surface-stale,.dw-recovery'),
      'Deleting an untouched row does not invent an unapplied entry or block further editing')
    const draft = await f.edit()
    draft.value = '902'
    draft.dispatchEvent(new Event('input', { bubbles: true }))
    await key(draft, 'Escape')
    check(f.window.isOpen && f.model.getItem(1, 'saleinvcode') === 901 && !f.dw.editor,
      'First Escape discards only the pending text, not the shared stored invoice')
    check(f.dw.root.contains(document.activeElement), 'Cancelling text editing keeps keyboard focus in its DataWindow')
    await key(document.activeElement, 'Escape')
    await wait(() => !f.window.isOpen, 'source Escape')
    check(f.returned().pbGet('i_closemode') === -1 &&
      events.filter((event) => event.event === 'ue_dwnkey' && event.args?.[0] === 'keyescape!').length === 1,
    'Escape outside an editor reaches the original cancellation event once')
    await f.close()

    f = await open([{ saleinvcode: 901, netamt: 125.25 }, { saleinvcode: 902, netamt: 75.5 }])
    let changed = await f.edit(2)
    changed.value = '906'
    changed.dispatchEvent(new Event('input', { bubbles: true }))
    f.control.changed()
    await settle()
    changed = f.dw.editor
    await key(changed, 'd', true)
    check(f.model.rowCount() === 1 && f.dw.root.querySelector('.surface-stale input,.dw-recovery textarea')?.value === '906' &&
      await f.control.n_accepttext() === -1 && calls.length === 0,
    `Deleting a genuinely changed row retains its draft for copying and cannot apply it to the surviving invoice: ${JSON.stringify({
      rows: f.model.rowCount(), draft: f.dw.root.querySelector('.surface-stale input,.dw-recovery textarea')?.value,
      calls: calls.length,
    })}`)
    const recovery = f.dw.root.querySelector('.surface-stale input,.dw-recovery textarea')
    await key(recovery, 'd', true)
    check(f.model.rowCount() === 1 && recovery.value === '906',
      'Recovery-field keyboard commands cannot delete a surviving business row')
    await f.close()
    f = await open([{ saleinvcode: 901, netamt: 125.25 }])
    await key(await f.edit(), 'Enter')
    check(f.model.rowCount() === 2 && f.model.row === 2, 'Enter on the last invoice field uses the original row-insertion handler')
    await key(await f.edit(), 'Enter')
    await wait(() => !f.window.isOpen, 'two-blank-row Enter')
    check(f.returned().pbGet('i_closemode') === 1 && f.caller.model.rowCount() === 1 &&
      f.caller.model.getItem(1, 'saleinvcode') === 901,
    'Enter through the source blank-row sequence validates and returns the remaining invoice')
    await f.close()
    check(violations.length === 0, 'No unexpected SQL, transaction, retrieve, write, procedure or commit was attempted')
  } finally {
    try { if (current) await current.close() } finally { restore() }
  }
  if (modern) window.openAssociatedInvoicePreview = async () => {
    if (window.associatedInvoicePreview) await window.associatedInvoicePreview.close()
    activate()
    try {
      const f = await open([{ saleinvcode: 901, netamt: 125.25 }])
      window.associatedInvoicePreview = { ...f, close: async () => {
        if (current !== f) return
        try { await f.close() } finally { restore() }
      } }
    } catch (error) { restore(); throw error }
  }
}
