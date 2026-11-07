import { NTransaction, executeStatement, stmtKey } from './src/runtime/native/transaction.js'

// The real source routines and SQL metadata run against a strict, in-memory call recorder.
// This verifies UI/runtime ordering, not PostgreSQL persistence or native business acceptance.
export async function checkEntryWorkflows(open, check, settle) {
  const source = await (await fetch('./presentation-entry-sql.json')).json()
  const statements = new Map(source.statements.map((statement) => [stmtKey(statement.original), statement]))
  const keyRead = source.statements.find((statement) => statement.routine === 'w_entry_primitives.wf_tabnewid' && statement.into)
  const keyWrite = source.statements.find((statement) => statement.routine === 'w_entry_primitives.wf_tabnewid' && !statement.into)
  const duplicateReads = source.statements.filter((statement) => statement.routine === 'w_agingintervals.wf_duplicatename')
  for (const scenario of ['saved', 'edited-save', 'invalid-master', 'duplicate', 'master-failure', 'detail-failure']) {
    const f = await open()
    const rt = f.fixture.rt
    const oldSql = rt.sql, oldStatements = rt.sqlStmt
    const oldDate = rt.globals.get('gd_recenttransdate')
    const master = f.control('dw_detail'), detail = f.control('dw_itemsdetail')
    const transaction = new NTransaction(rt, 'transaction')
    const calls = []
    const writes = []
    const db = {
      query: async (sql, params) => {
        calls.push('query')
        if (sql === keyRead.sql) {
          check(params.length === 1 && params[0] === 'AgingInterval', 'New aging keys use the source-selected table and locking query')
          return { columns: [{ name: 'tabmaxkey', type: 'int4' }], rows: [[100]] }
        }
        if (duplicateReads.some((statement) => statement.sql === sql)) {
          check(params[0] === (scenario === 'edited-save' ? 'Renamed intervals' : 'Synthetic intervals'),
            'Description uniqueness uses the original trimmed input')
          return { columns: [{ name: 'count', type: 'int4' }], rows: [[scenario === 'duplicate' ? 1 : 0]] }
        }
        throw new Error('Unexpected SQL in the isolated aging fixture')
      },
      exec: async (sql, params) => {
        const kind = sql === keyWrite.sql ? 'key' :
          sql.startsWith('INSERT INTO dbo.agingintervaldetail ') ? 'detail' :
            sql.startsWith('INSERT INTO dbo.aginginterval ') ? 'master' :
              /^(?:UPDATE|DELETE FROM) dbo\.agingintervaldetail\b/i.test(sql) ? 'detail' :
                /^(?:UPDATE|DELETE FROM) dbo\.aginginterval\b/i.test(sql) ? 'master' : null
        if (!kind) throw new Error('Unexpected write in the isolated aging fixture')
        calls.push(kind)
        writes.push({ kind, sql, params: [...params] })
        if (scenario === `${kind}-failure`) throw new Error(`Synthetic ${kind} write failed; no database was accessed`)
        return { rowcount: 1 }
      },
      commit: async () => { calls.push('commit') },
      rollback: async () => { calls.push('rollback') },
      close: async () => {},
      call: async () => { throw new Error('The isolated aging fixture does not execute stored procedures') },
    }
    transaction.db = db
    try {
      rt.sql = executeStatement
      rt.sqlStmt = (key) => statements.get(key)
      rt.globals.set('gd_recenttransdate', 0)
      f.window.props.set('id_systemdate', 0)
      f.window.props.set('it_transobject', transaction)
      f.window.props.set('ib_commitok', false)
      f.window.props.set('editflag', true)
      f.window.props.set('ib_itemvalidated', true)
      f.window.props.set('il_currrow', 1)
      master.model.def.table = structuredClone(source.tables.d_aginginterval)
      detail.model.def.table = structuredClone(source.tables.d_agingintervaldetail)
      master.model.setItem(1, 'code', scenario === 'edited-save' ? 1 : null)
      if (scenario === 'invalid-master') master.model.setItem(1, 'name', null)
      if (scenario === 'edited-save') {
        master.model.resetUpdate()
        detail.model.resetUpdate()
        master.model.setItem(1, 'name', 'Renamed intervals')
        detail.model.setItem(1, 'limit', 45)
      }
      await master.n_settransobject(transaction)
      await detail.n_settransobject(transaction)
      master.changed()
      detail.changed()
      await settle()
      if (scenario === 'saved') {
        await rt.fire(f.window, 'ue_newitem')
        await settle()
        const detailView = f.view.ctlViews.get(detail).dw
        check(detail.model.rowCount() === 3 && detail.model.row === 3 && detailView.editor,
          'The original New Item action appends a detail row and opens its Limit editor')
        const missingLimit = rt.fire(f.window, 'ue_newitem')
        await settle()
        const required = document.querySelector('.presentation-runtime-dialog[open],.msgbox')
        check(required?.textContent.includes('Validation Error'), 'A second New Item action requires the unfinished limit first')
        if (!required?.querySelector('button')) throw new Error('Missing required-limit feedback')
        required.querySelector('button').click()
        await missingLimit
        await settle()
        check(detail.model.rowCount() === 3 && detailView.editor, 'Required-field rejection retains the unfinished row')
        detailView.editor.value = '120'
        detailView.editor.dispatchEvent(new Event('input', { bubbles: true }))
        await settle()
        check(await detail.n_accepttext() === 1, 'A completed new Limit uses shared acceptance')
        await rt.fire(f.window, 'ue_deleteitem')
        await settle()
        check(detail.model.rowCount() === 2 && detail.model.deletedCount() === 0,
          'Deleting a newly inserted detail removes it without inventing a database delete')
      }
      const saving = rt.fire(f.window, 'ue_save')
      await settle()
      const dialog = document.querySelector('.presentation-runtime-dialog[open],.msgbox')
      const expected = scenario === 'saved' || scenario === 'edited-save' ? 'Save Changes' :
        scenario === 'invalid-master' ? 'Validation Error' :
          scenario === 'duplicate' ? 'Aging Interval Description Validation' : 'Database Error'
      check(dialog?.textContent.includes(expected), `The source ${scenario} path displays its ${expected} feedback`)
      if (!dialog?.querySelector('button')) throw new Error(`Missing ${scenario} save feedback`)
      dialog.querySelector('button').click()
      await saving
      await settle()
      if (scenario === 'saved') {
        check(calls.join(',') === 'query,rollback,query,key,master,detail,detail,commit',
          'The source new-save sequence checks uniqueness, allocates the key, updates both buffers and commits last')
        check(writes.filter((write) => write.kind === 'detail').every((write) => write.params[0] === 101) &&
          writes.find((write) => write.kind === 'master')?.params[0] === 101,
          'The original save propagates the allocated master key into every detail row')
        check(f.window.props.get('ib_commitok') === true && f.window.props.get('editflag') === false &&
          master.model.getItem(1, 'code') === null && detail.model.getItem(2, 'code') === 101,
          'The original save retains its success flags and post-save master-key clearing behavior')
      } else if (scenario === 'edited-save') {
        check(calls.join(',') === 'query,rollback,master,detail,commit',
          'Editing an existing interval validates uniqueness, updates changed buffers and commits without allocating a new key')
        const masterWrite = writes.find((write) => write.kind === 'master')
        const detailWrite = writes.find((write) => write.kind === 'detail')
        check(writes.length === 2 && writes.every((write) => ['master', 'detail'].includes(write.kind)) &&
          masterWrite?.sql.startsWith('UPDATE dbo.aginginterval SET ') && /\bWHERE\b/.test(masterWrite.sql) &&
          masterWrite.params.includes('Renamed intervals') &&
          detailWrite?.sql.startsWith('UPDATE dbo.agingintervaldetail SET ') && /\bWHERE\b/.test(detailWrite.sql) &&
          detailWrite.params.includes(45),
          'Existing updates preserve their original key predicates and write only the edited description and limit')
        check(f.window.props.get('ib_commitok') === true && f.window.props.get('editflag') === false,
          'The committed existing interval clears the edit state and retains the source success flag')
      } else if (scenario === 'invalid-master') {
        check(calls.length === 0 && writes.length === 0 && f.window.props.get('ib_commitok') === false &&
          f.window.props.get('editflag') === true && master.model.getItem(1, 'name') === null,
          'A missing required description stops before uniqueness queries, key allocation and every write while retaining the invalid value')
      } else if (scenario === 'duplicate') {
        check(writes.length === 0 && !calls.includes('commit') && f.window.props.get('ib_commitok') === false,
          'A duplicate description stops before allocating a key or writing either buffer')
      } else {
        check(!calls.includes('commit') && calls.at(-1) === 'rollback' && f.window.props.get('ib_commitok') === false &&
          f.window.props.get('editflag') === true && master.model.getItem(1, 'name') === 'Synthetic intervals',
          'A failed write rolls back, keeps the entered description and never marks the form saved')
        if (scenario === 'master-failure') check(!calls.includes('detail'),
          'A failed master write cannot continue into detail writes')
      }
    } finally {
      rt.sql = oldSql
      rt.sqlStmt = oldStatements
      if (oldDate === undefined) rt.globals.delete('gd_recenttransdate')
      else rt.globals.set('gd_recenttransdate', oldDate)
      transaction.db = null
      await f.close()
    }
  }
}
