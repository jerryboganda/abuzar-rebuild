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
  assert.match(st[0].sql, /^DELETE FROM dbo\.item WHERE /)
  assert.match(st[1].sql, /^UPDATE dbo\.item SET amt = \$1 WHERE code = \$2 AND grp = \$3 AND amt = \$4$/)
  // untouched NULL columns are omitted so database defaults apply
  assert.match(st[2].sql, /^INSERT INTO dbo\.item \(code, amt\) VALUES \(\$1, \$2\)$/)
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

test('dynamic SQL: session options are accepted, plain statements get the dialect basics', async () => {
  const { translateDynamicSql } = await import('../src/runtime/dynsql.ts')
  assert.equal(translateDynamicSql('Set ANSI_NULLS ON Set ANSI_WARNINGS ON')?.sql, 'SELECT 1')
  assert.equal(translateDynamicSql('UPDATE ITEM SET [saleprice]=12.5 , d=isnull(d,0) where len(x)>1')?.sql, 'UPDATE ITEM SET saleprice=12.5 , d=coalesce(d,0) where length(x)>1')
  assert.equal(translateDynamicSql('backup database x to disk=\'y\''), undefined)
})

test('code 39: start / stop characters, extended lower case', async () => {
  const { code39Svg, isCode39Font } = await import('../src/ui/barcode.ts')
  assert.equal(isCode39Font('Free 3 of 9 Extended'), true)
  assert.equal(isCode39Font('IDAutomation.com Code39'), true)
  assert.equal(isCode39Font('Arial'), false)
  // *1* = 3 characters x 5 bars; the extended set writes a lower-case letter as + and the letter
  const bars = (s: string) => (code39Svg(s, 100, 20).match(/<rect /g) || []).length
  assert.equal(bars('1'), 15)
  assert.equal(bars('a'), 20)
  assert.equal(bars('*1*'), 15)
})

test('SaveAs: csv with headings, xlsx container, html, xml', async () => {
  const { exportDw, zipStored, crc32 } = await import('../src/dw/export.ts')
  const rt = new Runtime({ load: async () => undefined })
  registerSysFuncs(rt)
  const d: DwDef = {
    datawindow: {},
    bands: { header: { height: '10' }, detail: { height: '10' } } as DwDef['bands'],
    table: { columns: [{ type: 'char(10)', name: 'code' }, { type: 'decimal(2)', name: 'amt' }] },
    objects: [
      { type: 'text', name: 'code_t', band: 'header', x: '0', text: 'Code' },
      { type: 'text', name: 'amt_t', band: 'header', x: '100', text: 'Amount' },
      { type: 'column', name: 'amt', band: 'detail', x: '100' },
      { type: 'column', name: 'code', band: 'detail', x: '0' },
    ],
  }
  const m = new DwModel(rt, 'd_x', d)
  const r1 = m.insertRow(0)
  m.setItem(r1, 'code', 'A,1')
  m.setItem(r1, 'amt', 12.5)
  const dec = (u: Uint8Array) => new TextDecoder().decode(u)
  assert.equal(dec((await exportDw(m, 'csv!', true))!.bytes), 'Code,Amount\r\n"A,1",12.5\r\n')
  assert.equal(dec((await exportDw(m, 'text!', false))!.bytes), 'A,1\t12.5\r\n')
  assert.match(dec((await exportDw(m, 'html!', true))!.bytes), /<th>Code<\/th><th>Amount<\/th>/)
  assert.match(dec((await exportDw(m, 'xml!', false))!.bytes), /<d_x_row><Code>A,1<\/Code><Amount>12.5<\/Amount><\/d_x_row>/)
  const x = (await exportDw(m, 'excel8!', true))!
  assert.equal(x.ext, 'xlsx')
  assert.equal(x.bytes[0], 0x50) // PK
  assert.equal(await exportDw(m, 'pdf!', false), null)
  // the zip container is well formed: one end-of-central-directory record that counts the entries
  const z = zipStored([{ name: 'a.txt', data: new TextEncoder().encode('hello') }])
  assert.equal(new DataView(z.buffer, z.length - 22).getUint16(10, true), 1)
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926)
})

test('QR code: Reed-Solomon vector, capacities, format bits, symbol structure', async () => {
  const { rsDivisor, rsRemainder, dataCodewords, formatInfo, encodeQr, qrBmp } = await import('../src/runtime/qr.ts')
  // "HELLO WORLD" in version 1-Q (the worked example of the standard's tutorials)
  const data = [32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236]
  assert.deepEqual(rsRemainder(data, rsDivisor(13)), [168, 72, 22, 82, 217, 54, 156, 0, 46, 15, 180, 122, 16])
  assert.deepEqual(rsDivisor(7), [127, 122, 154, 164, 11, 68, 117])
  // data capacities of the standard (codewords)
  const cap = (v: number) => [0, 1, 2, 3].map((e) => dataCodewords(v, e as 0 | 1 | 2 | 3))
  assert.deepEqual(cap(1), [19, 16, 13, 9])
  assert.deepEqual(cap(2), [34, 28, 22, 16])
  assert.deepEqual(cap(5), [108, 86, 62, 46])
  assert.deepEqual(cap(10), [274, 216, 154, 122])
  assert.deepEqual(cap(40), [2956, 2334, 1666, 1276])
  assert.equal(formatInfo(0, 0), 0x77c4) // level L, mask 0
  assert.equal(formatInfo(1, 0), 0x5412) // level M, mask 0
  const q = encodeQr('https://example.com/invoice/12345', 1)!
  assert.equal(q.size, q.version * 4 + 17)
  assert.ok(q.version >= 2 && q.version <= 4)
  // finder patterns in three corners, timing pattern alternates
  for (const [ox, oy] of [[0, 0], [q.size - 7, 0], [0, q.size - 7]]) {
    assert.equal(q.modules[oy][ox], true)
    assert.equal(q.modules[oy + 3][ox + 3], true)
    assert.equal(q.modules[oy + 1][ox + 1], false)
  }
  assert.equal(q.modules[6][8], true)
  assert.equal(q.modules[6][9], false)
  assert.equal(q.modules[q.size - 8][8], true) // the dark module
  const bmp = qrBmp(q, 4, 3)
  assert.equal(bmp[0], 0x42)
  assert.equal(new DataView(bmp.buffer).getInt32(18, true), (q.size + 8) * 3)
  assert.equal(encodeQr('x'.repeat(3000), 0), null)
})

test('string to number: the leading number counts (the menu rights code relies on Integer("2,") = 2)', async () => {
  const rt = new Runtime({ load: async () => undefined })
  registerSysFuncs(rt)
  const f = (n: string, v: unknown) => rt.sys.get(n)!.fn(rt, [v], undefined as never)
  assert.equal(await f('integer', '2,'), 2)
  assert.equal(await f('integer', '  -15abc'), -15)
  assert.equal(await f('integer', 'abc'), 0)
  assert.equal(await f('long', '1234,'), 1234)
  assert.equal(await f('integer', null), null)
})

test('shared item list: one retrieve per session, reset and writes invalidate the cache', async () => {
  const rt = new Runtime({ load: async () => undefined })
  registerSysFuncs(rt)
  rt.dwSql = () => ({ sql: 'select code, grp, amt from item where code > $1', params: ['ai_min'] })
  const log: { sql: string; params: unknown[] }[] = []
  const queries = () => log.filter((x) => x.sql.startsWith('select')).length
  const trans = { db: makeDb(log), setError() {}, setOk() {} }
  const a = new DwModel(rt, 'ddd_itemmanfnames_groupgodown', def)
  a.trans = trans
  const b = new DwModel(rt, 'ddd_itemmanfnames_groupgodown', def)
  b.trans = trans
  assert.equal(await a.retrieve([0]), 3)
  assert.equal(await b.retrieve([0]), 3) // another screen asks for the same shared list
  assert.equal(queries(), 1)
  assert.equal(b.rowCount(), 3)
  // Reset() before Retrieve() is the original's explicit refresh: it must go to the database
  a.reset()
  assert.equal(await a.retrieve([0]), 3)
  assert.equal(queries(), 2)
  // a write clears the session cache: the next screen sees the changed item data
  a.setItem(1, 'amt', 11)
  assert.equal(await a.update(), 1)
  assert.equal(await b.retrieve([0]), 3)
  assert.equal(queries(), 3)
})

test('a RichText DataWindow (objects without a name) builds and holds rows', () => {
  const rt = new Runtime({ load: async () => undefined })
  registerSysFuncs(rt)
  const rich = {
    datawindow: { processing: '7' },
    bands: {},
    table: { columns: [{ type: 'char(4000)', name: 'comments', dbname: 'Comments' }] },
    objects: [{ id: '1', type: 'column' }],
  } as unknown as DwDef
  const m = new DwModel(rt, 'd_rich', rich)
  m.insertRow(0)
  m.setItem(1, 'comments', 'text')
  assert.equal(m.getItem(1, 'comments'), 'text')
})

test('an initial date set from String(datetime) (regional day-first text) is honoured', () => {
  const rt = new Runtime({ load: async () => undefined })
  registerSysFuncs(rt)
  const d = {
    datawindow: { processing: '1' },
    bands: { detail: { height: '80' } },
    table: { columns: [{ type: 'datetime', name: 'expiry' }] },
    objects: [],
  } as unknown as DwDef
  const m = new DwModel(rt, 'd_exp', d)
  m.overrides.set('expiry.initial', '12/12/2030 00:00:00')
  assert.notEqual(m.defaultFor(0), null)
  m.overrides.set('expiry.initial', '2030-12-12 00:00:00')
  assert.equal(String(m.defaultFor(0)), String((() => { m.overrides.set('expiry.initial', '12/12/2030 00:00:00'); return m.defaultFor(0) })()))
})

test('datawindow.objects lists every object name, each followed by a tab', () => {
  const rt = new Runtime({ load: async () => undefined })
  registerSysFuncs(rt)
  const d = {
    datawindow: { processing: '1' },
    bands: { detail: { height: '80' } },
    table: { columns: [{ type: 'long', name: 'qty' }] },
    objects: [{ type: 'column', name: 'qty', band: 'detail' }, { type: 'text', name: 'qty_t', band: 'header' }],
  } as unknown as DwDef
  assert.equal(new DwModel(rt, 'd_o', d).describe('datawindow.objects'), 'qty\tqty_t\t')
})

test('datawindow expressions ignore SQL-style comments left in the recovered formulas', async () => {
  const { compileDw } = await import('../src/dw/expr.ts')
  const e = compileDw('Round( ((saleprice - (netrate * 2)) / if(saleprice=0,1,saleprice)) * 100, 2 ) /* Round( old */')
  assert.equal(e.k, 'call')
})

test('new rows are inserted into the dbo schema, not the unqualified name', async () => {
  const rt = new Runtime({ load: async () => undefined })
  registerSysFuncs(rt)
  const d = {
    datawindow: { processing: '1' },
    bands: { detail: { height: '80' } },
    table: { columns: [{ type: 'long', name: 'code', key: 'yes', update: 'yes' }, { type: 'char(10)', name: 'name', update: 'yes' }], update: 'manufacturer', updatewhere: '1' },
    objects: [{ type: 'column', name: 'name', band: 'detail' }],
  } as unknown as DwDef
  const m = new DwModel(rt, 'd_u', d)
  m.insertRow(0)
  m.setItem(1, 'name', 'X')
  const st = m.buildUpdate()
  assert.equal(st.length, 1)
  assert.match(st[0].sql, /^INSERT INTO dbo\.manufacturer/)
})

test('SetValidate / GetValidate keep the run-time rule and fall back to the design-time rule', async () => {
  const { NDwBase } = await import('../src/runtime/native/dwctrl.ts')
  const rt = new Runtime({ load: async () => undefined })
  registerSysFuncs(rt)
  const d = {
    datawindow: { processing: '1' },
    bands: { detail: { height: '80' } },
    table: { columns: [{ type: 'decimal(4)', name: 'qty', validation: 'Real(GetText()) >= 0', validationmsg: "'Qty must be zero or more'" }] },
    objects: [{ type: 'column', name: 'qty', band: 'detail' }],
  } as unknown as DwDef
  const dw = new NDwBase(rt, 'datawindow')
  dw.attach(new DwModel(rt, 'd_v', d))
  assert.equal(await dw.n_getvalidate('qty'), 'Real(GetText()) >= 0')
  assert.equal(await dw.n_setvalidate('qty', 'Real(GetText()) > 0'), 1)
  assert.equal(await dw.n_getvalidate('qty'), 'Real(GetText()) > 0')
  assert.equal(dw.columnValidationMessage(0), "'Qty must be zero or more'")
})
