import test from 'node:test'
import assert from 'node:assert/strict'
import { Runtime } from '../src/runtime/interp.ts'
import { NDwBase, NDwColumn, NDwObject } from '../src/runtime/native/dwctrl.ts'
import { DwCatalog } from '../src/dw/def.ts'
import type { DwDef } from '../src/dw/def.ts'
import { DwModel } from '../src/dw/model.ts'

const definition: DwDef = { datawindow: {}, bands: {}, table: { columns: [] }, objects: [] }

function fixture() {
  const rt = new Runtime({ load: async () => undefined })
  const control = new NDwBase(rt, 'dw_synthetic')
  const pending = new Map<string, (value: DwDef | undefined) => void>()
  rt.dwCatalog = new DwCatalog(async () => undefined)
  rt.dwCatalog.get = (name) => new Promise((resolve) => pending.set(name, resolve))
  const changes: (string | null)[] = []
  control.listeners.add(() => changes.push(control.model?.name ?? null))
  return { rt, control, changes, resolve: (name: string, value: DwDef | undefined = definition) => pending.get(name)!(value) }
}

test('object.column.visible reflects a hidden expression, not its static half', () => {
  const rt = new Runtime({ load: async () => undefined })
  const control = new NDwBase(rt, 'dw_synthetic')
  const def: DwDef = {
    datawindow: {}, bands: {},
    table: { columns: [{ name: 'customicode', type: 'char(60)' }] },
    objects: [{ name: 'customicode', type: 'column', band: 'detail', visible: '1\t0' }],
  }
  control.attach(new DwModel(rt, 'd_visible', def))
  const object = control.pbGet('object') as NDwObject
  const column = object.pbGet('customicode') as NDwColumn
  // the item form compares this with "1" to decide whether to reveal the
  // alias field; returning the static half "1" showed the hidden field
  assert.equal(column.pbGet('visible'), '0')
})

test('only the latest asynchronous Dataobject assignment attaches a model', async () => {
  const f = fixture()
  f.control.pbSet('dataobject', 'd_first')
  const first = f.control.ready
  f.control.pbSet('dataobject', 'd_second')
  f.resolve('d_second')
  await f.control.ready
  f.resolve('d_first')
  await first
  assert.equal(f.control.model?.name, 'd_second')
  assert.deepEqual(f.changes, ['d_second'])
})

test('clearing a Dataobject notifies views and prevents an older load from restoring it', async () => {
  const f = fixture()
  f.control.attach(new DwModel(f.rt, 'd_original', definition))
  f.control.pbSet('dataobject', 'd_pending')
  const pending = f.control.ready
  f.control.pbSet('dataobject', '')
  await f.control.ready
  assert.equal(f.control.model, null)
  f.resolve('d_pending')
  await pending
  assert.equal(f.control.model, null)
  assert.deepEqual(f.changes, ['d_original', null])
})

test('an explicit model attachment supersedes an unfinished definition load', async () => {
  const f = fixture()
  const pending = f.control.loadDef('d_pending')
  f.control.attach(new DwModel(f.rt, 'd_attached', definition))
  f.resolve('d_pending')
  await pending
  assert.equal(f.control.model?.name, 'd_attached')
  assert.deepEqual(f.changes, ['d_attached'])
})

test('a missing Dataobject clears the model with a diagnostic and view notification', async () => {
  const f = fixture()
  const missing: string[] = []
  f.rt.noteMissing = (name) => { missing.push(name) }
  f.control.attach(new DwModel(f.rt, 'd_original', definition))
  f.rt.dwCatalog!.get = async () => undefined
  await f.control.loadDef('d_absent')
  assert.equal(f.control.model, null)
  assert.deepEqual(missing, ['dw:d_absent'])
  assert.deepEqual(f.changes, ['d_original', null])
})

test('SetColumn distinguishes an explicit selection from a redraw even for the same column', async () => {
  const f = fixture()
  const def: DwDef = { ...definition, table: { columns: [{ name: 'limit', type: 'long' }] } }
  f.control.attach(new DwModel(f.rt, 'd_selection', def))
  const changes: ('column' | undefined)[] = []
  f.control.listeners.add((selection) => changes.push(selection))
  assert.equal(await f.control.n_setcolumn('limit'), 1)
  assert.equal(await f.control.n_setcolumn(1), 1)
  assert.equal(await f.control.n_setcolumn('compute_1'), -1)
  f.control.changed()
  assert.equal(f.control.model?.col, 1)
  assert.deepEqual(changes, ['column', 'column', undefined])
})

test('a change through one DataWindow repaints every DataWindow sharing its buffer, until ShareDataOff', async () => {
  const rt = new Runtime({ load: async () => undefined })
  const def: DwDef = { datawindow: {}, bands: {}, table: { columns: [{ name: 'netamt', type: 'decimal(2)' }] },
    objects: [{ name: 'netamt', type: 'column', band: 'detail' }] }
  const primary = new NDwBase(rt, 'dw_header'), secondary = new NDwBase(rt, 'dw_viewheader')
  primary.attach(new DwModel(rt, 'd_header', structuredClone(def)))
  secondary.attach(new DwModel(rt, 'd_header', structuredClone(def)))
  assert.equal(await primary.n_sharedata(secondary), 1)
  let repaints = 0
  secondary.listeners.add(() => repaints++)
  primary.changed()
  assert.equal(repaints, 1, 'the sharing view repaints the change made through the primary')
  assert.equal(await secondary.n_sharedataoff(), 1)
  primary.changed()
  assert.equal(repaints, 1, 'after ShareDataOff the views are independent again')
})
