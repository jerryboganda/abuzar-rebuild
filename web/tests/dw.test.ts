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

test('crosstab pivot: replicated columns, shifted objects, crosstabsum, sparse', async () => {
  const xdef: DwDef = {
    datawindow: { processing: '4' },
    bands: { 'header[1]': { height: '100' }, 'header[2]': { height: '50' }, detail: { height: '40' }, summary: { height: '40' } } as DwDef['bands'],
    table: {
      columns: [
        { type: 'char(10)', name: 'grp' },
        { type: 'char(10)', name: 'item' },
        { type: 'decimal(0)', name: 'qty' },
        { type: 'decimal(0)', name: 'val' },
      ],
      retrieve: 'select grp, item, client, qty, val from t',
      sort: 'grp A, item A',
    },
    objects: [
      { type: 'column', name: 'grp', band: 'detail', x: '0', width: '100' },
      { type: 'column', name: 'item', band: 'detail', x: '100', width: '100' },
      { type: 'column', name: 'qty', band: 'detail', x: '200', width: '60', 'crosstab.repeat': 'yes' },
      { type: 'column', name: 'val', band: 'detail', x: '260', width: '40', 'crosstab.repeat': 'yes' },
      { type: 'text', name: 't_client', band: 'header[2]', x: '200', width: '100', text: '@client' },
      { type: 'text', name: 'qty_t', band: 'header[2]', x: '200', width: '60', text: 'Qty' },
      { type: 'compute', name: 'c_qty', band: 'summary', x: '200', width: '60', expression: 'sum(qty for all)', visible: '1\tif(sum(qty for all)=0,0,1)' },
      { type: 'compute', name: 'gsq', band: 'detail', x: '310', width: '50', expression: 'crosstabsum(1)' },
    ],
    crosstab: { columns: 'client', rows: 'grp, item', values: 'sum(qty for crosstab), sum(val for crosstab)', sourcenames: 'grp, item, client, qty, val', crosstabonly: 'yes' },
    sparse: ['grp'],
  }
  const rt = new Runtime({ load: async () => undefined })
  registerSysFuncs(rt)
  rt.dwSql = () => ({ sql: 'select 1', params: [] })
  const db = makeDb([])
  db.query = async () => ({
    columns: [{ name: 'grp', type: 'text' }, { name: 'item', type: 'text' }, { name: 'client', type: 'text' }, { name: 'qty', type: 'numeric' }, { name: 'val', type: 'numeric' }],
    rows: [['g1', 'i1', 'B', '1', '10'], ['g1', 'i1', 'A', '2', '20'], ['g1', 'i1', 'A', '3', '30'], ['g1', 'i2', 'B', '4', '40'], ['g2', 'i3', 'A', '5', '50']],
  })
  const m = new DwModel(rt, 'd_x', xdef)
  m.trans = { db, setError() {}, setOk() {} }
  assert.equal(await m.retrieve([]), 3)
  assert.deepEqual(m.colNames, ['grp', 'item', 'qty_1', 'val_1', 'qty_2', 'val_2'])
  // client A (sorted first) sums its two rows, B has the other
  assert.equal(String(m.getItem(1, 'qty_1')), '5')
  assert.equal(String(m.getItem(1, 'val_1')), '50')
  assert.equal(String(m.getItem(1, 'qty_2')), '1')
  assert.equal(m.getItem(2, 'qty_1'), null)
  assert.equal(String(m.getItem(2, 'qty_2')), '4')
  assert.equal(String(m.getItem(3, 'qty_1')), '5')
  assert.equal(String(await m.getValue(1, 'gsq')), '6')
  assert.equal(String(await m.getValue(2, 'gsq')), '4')
  const by = (n: string) => m.def.objects.find((o) => o.name === n)
  assert.equal(by('qty_1')?.x, '200')
  assert.equal(by('qty_2')?.x, '300') // zone = 200..300 (qty + val) -> stride 100
  assert.equal(by('gsq')?.x, '410') // moved right by the one added column group
  assert.equal(by('t_client_1')?.text, 'A')
  assert.equal(by('t_client_2')?.text, 'B')
  assert.equal(by('qty_t_2')?.text, 'Qty')
  assert.equal(by('c_qty_2')?.expression, 'sum(qty_2 for all)')
  assert.equal(by('c_qty_2')?.visible, '1\tif(sum(qty_2 for all)=0,0,1)')
  assert.equal(String(await m.getValue(1, 'c_qty_1')), '10')
  assert.equal(by('qty'), undefined)
  // suppress repeating values: g1 is shown on its first row only
  assert.equal(m.suppressed(1, 0), false)
  assert.equal(m.suppressed(2, 0), true)
  assert.equal(m.suppressed(3, 0), false)
  assert.equal(m.suppressed(2, 1), false) // not a sparse column
})
