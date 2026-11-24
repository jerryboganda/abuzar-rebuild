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
