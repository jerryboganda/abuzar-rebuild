import test from 'node:test'
import assert from 'node:assert/strict'
import { Runtime } from '../src/runtime/interp.ts'
import { NDwBase } from '../src/runtime/native/dwctrl.ts'
import { NTransaction } from '../src/runtime/native/transaction.ts'
import { DwModel, NEW_MODIFIED } from '../src/dw/model.ts'
import type { Db } from '../src/runtime/wire.ts'

function fixture(native = 'datawindow', response = 0) {
  const rt = new Runtime({ load: async () => undefined })
  const control = new NDwBase(rt, 'dw_fixture', native)
  const model = new DwModel(rt, 'd_fixture', {
    datawindow: {}, bands: {}, objects: [],
    table: { update: 'synthetic', columns: [{ name: 'name', type: 'char(50)', update: 'yes' }] },
  })
  model.insertRow(0)
  model.setItem(1, 'name', 'Retained draft')
  control.attach(model)
  const messages: string[] = []
  const events: string[] = []
  rt.fire = async (_object, event) => { events.push(event); return event === 'dberror' ? response : 0 }
  rt.ui = { openWindow: async () => {}, closeWindow: () => {},
    messageBox: async (_title, text) => { messages.push(text); return 1 } }
  const db: Db = {
    query: async () => { throw new Error('Synthetic retrieve failure') },
    exec: async () => { throw new Error('Synthetic update failure') },
    commit: async () => {}, rollback: async () => {}, close: async () => {},
    call: async () => { throw new Error('Unexpected procedure call') },
  }
  const transaction = new NTransaction(rt, 'transaction')
  transaction.db = db
  model.trans = transaction
  control.trans = transaction
  rt.dwSql = () => ({ sql: 'SELECT name FROM synthetic', params: [] })
  return { rt, control, model, transaction, messages, events }
}

for (const native of ['datawindow', 'datastore']) for (const response of [0, 1, 2, 3]) {
  test(`${native} DBError ${response} preserves default-message behavior without hiding failed writes`, async () => {
    const f = fixture(native, response)
    assert.equal(await f.control.n_update(), -1)
    assert.deepEqual(f.events, ['updatestart', 'dberror'])
    assert.deepEqual(f.messages, native !== 'datastore' && [0, 2].includes(response) ? ['Synthetic update failure'] : [])
    assert.equal(f.model.getItem(1, 'name'), 'Retained draft')
    assert.equal(f.model.rowAt(1)?.st, NEW_MODIFIED)
    assert.equal(f.transaction.props.get('sqlcode'), -1)
  })
}

test('retrieval failures reach DBError before RetrieveEnd and display the default error', async () => {
  const f = fixture()
  assert.equal(await f.control.n_retrieve(), -1)
  assert.deepEqual(f.events, ['retrievestart', 'dberror', 'retrieveend'])
  assert.deepEqual(f.messages, ['Synthetic retrieve failure'])
})

test('disconnected updates report that changes remain unsaved', async () => {
  const f = fixture()
  f.transaction.db = null
  assert.equal(await f.control.n_update(), -1)
  assert.match(f.messages[0], /not been saved/)
  assert.equal(f.model.getItem(1, 'name'), 'Retained draft')
  assert.equal(f.model.rowAt(1)?.st, NEW_MODIFIED)
})

test('editor rejection is not mislabeled as a database error', async () => {
  const f = fixture()
  f.model.acceptText = async () => -1
  assert.equal(await f.control.n_update(), -1)
  assert.deepEqual(f.events, ['updatestart'])
  assert.deepEqual(f.messages, [])
})

test('default database feedback preserves the original error if its handler clears the model error', async () => {
  const f = fixture()
  const fire = f.rt.fire.bind(f.rt)
  f.rt.fire = async (object, event, args) => {
    const response = await fire(object, event, args)
    if (event === 'dberror') f.model.lastError = ''
    return response
  }
  assert.equal(await f.control.n_update(), -1)
  assert.deepEqual(f.messages, ['Synthetic update failure'])
})

test('DataStore Update accepts a script draft before building its statement', async () => {
  const f = fixture('datastore')
  const writes: unknown[][] = []
  f.transaction.db!.exec = async (_sql, params) => { writes.push(params); return { rowcount: 1 } }
  await f.control.n_setcolumn(1)
  await f.control.n_settext('Accepted for update')
  assert.equal(f.model.getItem(1, 'name'), 'Retained draft')
  assert.equal(await f.control.n_update(), 1)
  assert.deepEqual(writes, [['Accepted for update']])
  assert.deepEqual(f.events, ['updatestart', 'itemchanged'])
  assert.equal(f.model.getItem(1, 'name'), 'Accepted for update')
})

test('DataStore Update(false) leaves a script draft unaccepted', async () => {
  const f = fixture('datastore')
  const writes: unknown[][] = []
  f.transaction.db!.exec = async (_sql, params) => { writes.push(params); return { rowcount: 1 } }
  await f.control.n_setcolumn(1)
  await f.control.n_settext('Not yet accepted')
  assert.equal(await f.control.n_update(false), 1)
  assert.deepEqual(writes, [['Retained draft']])
  assert.equal(await f.control.n_gettext(), 'Not yet accepted')
  assert.equal(f.model.getItem(1, 'name'), 'Retained draft')
  assert.deepEqual(f.events, ['updatestart'])
})
