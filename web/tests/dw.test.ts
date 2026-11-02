import test from 'node:test'
import assert from 'node:assert/strict'
import { Runtime } from '../src/runtime/interp.ts'
import { registerSysFuncs } from '../src/runtime/sysfuncs.ts'
import { DwModel, NOT_MODIFIED, NEW_MODIFIED } from '../src/dw/model.ts'
import type { DwDef } from '../src/dw/def.ts'
import { Dec } from '../src/runtime/values.ts'
import type { Db } from '../src/runtime/wire.ts'

const def: DwDef = {
  datawindow: { processing: '1' },
  bands: { detail: { height: '80' }, group: [{ level: '1', by: { _items: ['grp'] } }] } as DwDef['bands'],
  table: {
    columns: [
      { type: 'long', name: 'code', key: 'yes', update: 'yes', updatewhereclause: 'yes', dbname: 'Item.Code' },
      { type: 'char(10)', name: 'grp', update: 'yes', updatewhereclause: 'yes', dbname: 'Item.Grp' },
      { type: 'decimal(2)', name: 'amt', update: 'yes', updatewhereclause: 'yes', dbname: 'Item.Amt' },
    ],
    retrieve: 'select code, grp, amt from item where code > :ai_min',
    update: 'Item',
    updatewhere: '1',
    arguments: { _items: [{ _items: ['ai_min', 'number'] }] },
  },
  objects: [
    { type: 'compute', name: 'total', band: 'footer', expression: 'sum(amt for all)' },
    { type: 'compute', name: 'gtotal', band: 'trailer.1', expression: 'sum(amt for group 1)' },
    { type: 'compute', name: 'dbl', band: 'detail', expression: 'round(amt * 2, 1)' },
  ],
}

function makeDb(log: { sql: string; params: unknown[] }[]): Db {
  return {
    async query(sql, params) {
      log.push({ sql, params })
      return {
        columns: [{ name: 'code', type: 'int4' }, { name: 'grp', type: 'text' }, { name: 'amt', type: 'numeric' }],
        rows: [[1, 'a', '10.10'], [2, 'a', '20.20'], [3, 'b', '5.05']],
      }
    },
    async call() {
      return { columns: [], row: null, resultsets: [] }
    },
    async exec(sql, params) {
      log.push({ sql, params })
      return { rowcount: 1 }
    },
    async commit() {},
    async rollback() {},
    async close() {},
  }
}

test('retrieve, aggregates, groups, update statements', async () => {
  const rt = new Runtime({ load: async () => undefined })
  registerSysFuncs(rt)
  rt.dwSql = () => ({ sql: 'select code, grp, amt from item where code > $1', params: ['ai_min'] })
  const log: { sql: string; params: unknown[] }[] = []
  const m = new DwModel(rt, 'd_test', def)
  m.trans = { db: makeDb(log), setError() {}, setOk() {} }
  assert.equal(await m.retrieve([0]), 3)
  assert.deepEqual(log[0].params, [0])
  assert.equal(m.getItem(2, 'amt')?.toString(), '20.20')
  assert.equal(String(await m.getValue(1, 'total')), '35.35')
  assert.equal(String(await m.getValue(1, 'gtotal')), '30.30')
  assert.equal(String(await m.getValue(3, 'gtotal')), '5.05')
  assert.equal(String(await m.getValue(1, 'dbl')), '20.2')
  assert.equal(await m.find("grp = 'b'", 1, 3), 3)
  // filter + sort
  m.setFilter('amt > 6')
  m.setSort('amt D')
  await m.applyFilterSort()
  assert.equal(m.rowCount(), 2)
  assert.equal(m.filteredCount(), 1)
  assert.equal(m.getItem(1, 'code'), 2)
  m.setFilter('')
  await m.filter()
  assert.equal(m.rowCount(), 3)
  // modify / insert / delete -> statements
  m.setItem(1, 'amt', 99)
  const ins = m.insertRow(0)
  m.setItem(ins, 'code', 7)
  m.setItem(ins, 'amt', 1.5)
  m.deleteRow(2)
  const st = m.buildUpdate()
  assert.equal(st.length, 3)
  assert.match(st[0].sql, /^DELETE FROM item WHERE /)
  assert.match(st[1].sql, /^UPDATE item SET amt = \$1 WHERE code = \$2 AND grp = \$3 AND amt = \$4$/)
  assert.match(st[2].sql, /^INSERT INTO item \(code, grp, amt\) VALUES \(\$1, \$2, \$3\)$/)
  assert.equal(await m.update(), 1)
  assert.equal(m.getStatus(1, null), NOT_MODIFIED)
  assert.equal(m.modifiedCount(), 0)
  void NEW_MODIFIED; void Dec
})
