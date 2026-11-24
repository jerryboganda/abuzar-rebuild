import test from 'node:test'
import assert from 'node:assert/strict'
import { Runtime } from '../src/runtime/interp.ts'
import { NDwBase } from '../src/runtime/native/dwctrl.ts'
import { DwModel } from '../src/dw/model.ts'
import type { DwDef } from '../src/dw/def.ts'

const field = { name: 'saleprice', type: 'column', band: 'detail' }
const definition: DwDef = { datawindow: {}, bands: {}, objects: [field], table: { columns: [{ name: 'saleprice', type: 'number' }] } } as unknown as DwDef

// A column's status is only NotModified! or DataModified!: the Sale Template fills a new line's price under
// `if getitemstatus(row, "saleprice", primary!) = notmodified! then` (save test 2026-11-25: the line saved with price 0).
test('GetItemStatus of a column of a new row is notmodified! until set, then datamodified!; the row keeps new! / newmodified!', async () => {
  const rt = new Runtime({ load: async () => undefined })
  const model = new DwModel(rt, 'd_line', definition)
  const control = new NDwBase(rt, 'dw_line')
  control.attach(model)
  model.insertRow(0)
  assert.equal(await control.n_getitemstatus(1, 'saleprice', 'primary!'), 'notmodified!')
  assert.equal(await control.n_getitemstatus(1, 0, 'primary!'), 'new!')
  model.setItem(1, 'saleprice', 120)
  assert.equal(await control.n_getitemstatus(1, 'saleprice', 'primary!'), 'datamodified!')
  assert.equal(await control.n_getitemstatus(1, 0, 'primary!'), 'newmodified!')
})

// The sale return copies its footer's FBRPOSFee (NULL on an open return) into SRLedger.FBRPosFee, NOT NULL DEFAULT 0: PowerBuilder
// leaves a NULL column out of the INSERT, so the default applies (the original stored 0 on every return without a sale).
test('INSERT leaves out a column whose value is NULL, even when a script set it', () => {
  const rt = new Runtime({ load: async () => undefined })
  const def = { datawindow: {}, bands: {}, objects: [],
    table: { update: 'srledger', columns: [{ name: 'code', type: 'long', update: 'yes', key: 'yes' }, { name: 'fbrposfee', type: 'number', update: 'yes' }] } } as unknown as DwDef
  const model = new DwModel(rt, 'd_ret', def)
  model.insertRow(0)
  model.setItem(1, 'code', 7)
  model.setItem(1, 'fbrposfee', null)
  const [stmt] = model.buildUpdate()
  assert.match(stmt.sql, /^INSERT INTO dbo\."?srledger"? \("?code"?\) VALUES \(\$1\)$/)
  assert.deepEqual(stmt.params, [7])
})
