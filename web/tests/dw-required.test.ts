import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { Runtime, Ref } from '../src/runtime/interp.ts'
import { NDwBase } from '../src/runtime/native/dwctrl.ts'
import { registerWindowing } from '../src/runtime/native/windowing.ts'
import { registerSysFuncs } from '../src/runtime/sysfuncs.ts'
import { DwModel, NEW, NEW_MODIFIED, NOT_MODIFIED } from '../src/dw/model.ts'
import { parseScriptFile } from '../src/pbscript/parser.ts'
import { commitDwValue, dwRequired } from '../src/dw/edit.ts'
import type { DwDef } from '../src/dw/def.ts'

function reference(value: unknown) {
  return new Ref(() => value, (next) => { value = next })
}

test('required guidance shares all four FindRequired styles and boolean aliases', () => {
  for (const style of ['edit', 'dddw', 'ddlb', 'editmask']) {
    for (const value of ['yes', 'YES', 'true', '1']) {
      const object = { type: 'column', name: 'Name', band: 'detail', [`${style}.required`]: value }
      assert.equal(dwRequired(object), true)
      for (const optional of ['no', 'false', '0', '', 'unsupported']) {
        assert.equal(dwRequired(object, new Map([[`name.${style}.required`, optional]])), false)
      }
    }
  }
})

test('required guidance is limited to declared column flags without guessing other rules', () => {
  const object = { type: 'column', name: 'name', band: 'detail' }
  assert.equal(dwRequired(object), false)
  assert.equal(dwRequired({ ...object, 'criteria.required': 'yes', validation: 'len(gettext()) > 0' }), false)
  assert.equal(dwRequired({ ...object, type: 'compute', 'edit.required': 'yes' }), false)
  assert.equal(dwRequired({ ...object, 'edit.required': 'no', 'dddw.required': 'yes' }), true)
  assert.equal(dwRequired(object, new Map([['name.editmask.required', 'true']])), true)
})

function fixture() {
  const rt = new Runtime({ load: async () => undefined })
  registerWindowing(rt)
  registerSysFuncs(rt)
  const control = new NDwBase(rt, 'dw_required', 'datawindow')
  const definition: DwDef = {
    datawindow: {}, bands: {},
    table: { columns: [{ name: 'name', type: 'char(40)' }, { name: 'limit', type: 'long' }] },
    objects: [
      { name: 'name', type: 'column', band: 'detail', 'edit.required': 'yes', 'edit.nilisnull': 'yes' },
      { name: 'limit', type: 'column', band: 'detail', 'editmask.required': 'yes' },
      { name: 'name_t', type: 'text', band: 'header', text: 'Description' },
    ],
  }
  const model = new DwModel(rt, 'd_required', definition)
  model.insertRow(0)
  model.insertRow(0)
  model.row = 1
  model.col = 1
  control.attach(model)
  const row = reference(1), column = reference(1), name = reference('')
  const find = (buffer = 'primary!', updateOnly = false) => control.n_findrequired(buffer, row, column, name, updateOnly)
  return { rt, control, model, row, column, name, find }
}

test('FindRequired advances from the supplied column and resets search references at the end', async () => {
  const f = fixture()
  await f.column.set(2)
  assert.equal(await f.find(), 1)
  assert.equal(f.row.get(), 1)
  assert.equal(f.column.get(), 2)
  assert.equal(f.name.get(), 'limit')
  await f.column.set(3)
  assert.equal(await f.find(), 1)
  assert.equal(f.row.get(), 2)
  assert.equal(f.column.get(), 1)
  f.model.setItem(2, 'name', 'Present')
  f.model.setItem(2, 'limit', 30)
  assert.equal(await f.find(), 1)
  assert.equal(f.row.get(), 0)
  assert.equal(f.column.get(), 1)
  assert.equal(f.name.get(), '')
})

test('FindRequired searches the requested filtered buffer and honors modified-only rows', async () => {
  const f = fixture()
  f.model.buf.filtered.push(f.model.buf.primary.pop()!)
  f.model.buf.primary[0].st = NOT_MODIFIED
  f.model.buf.filtered[0].st = NEW
  assert.equal(await f.find('primary!', true), 1)
  assert.equal(f.row.get(), 0)
  await f.row.set(1)
  assert.equal(await f.find('filter!', true), 1)
  assert.equal(f.row.get(), 0)
  f.model.buf.filtered[0].st = NEW_MODIFIED
  await f.row.set(1)
  assert.equal(await f.find('filter!', true), 1)
  assert.equal(f.row.get(), 1)
  assert.equal(f.name.get(), 'name')
})

test('FindRequired honors runtime requirements and does not confuse empty strings with null', async () => {
  const f = fixture()
  f.model.setItem(1, 'name', '')
  f.model.modify("limit.editmask.required='no'")
  assert.equal(await f.find(), 1)
  assert.equal(f.row.get(), 2)
  assert.equal(f.name.get(), 'name')
  f.model.modify("name.edit.required='no'")
  f.model.modify("limit.dddw.required='yes'")
  await f.row.set(1)
  assert.equal(await f.find(), 1)
  assert.equal(f.name.get(), 'limit')
})

test('empty-is-null editing feeds required validation without normalizing ordinary strings', async () => {
  const f = fixture()
  assert.equal(await commitDwValue(f.control, f.model, 1, 0, f.model.def.objects[0], ''), 'accepted')
  assert.equal(f.model.getItem(1, 'name'), null)
  f.model.modify("name.edit.nilisnull='no'")
  assert.equal(await commitDwValue(f.control, f.model, 1, 0, f.model.def.objects[0], ''), 'accepted')
  assert.equal(f.model.getItem(1, 'name'), '')
})

test('FindRequired returns standard failure/null results without changing search references', async () => {
  const f = fixture()
  assert.equal(await f.find('delete!'), -1)
  assert.equal(f.row.get(), 1)
  assert.equal(await f.control.n_findrequired(null, f.row, f.column, f.name, false), null)
  await f.row.set(null)
  assert.equal(await f.find(), null)
})

test('the recovered f_validatedw accepts a populated form and locates its required description', async () => {
  const f = fixture()
  const { file, errors } = parseScriptFile(readFileSync(new URL('../../data/src/scripts/functions/f_validatedw.pbs', import.meta.url), 'utf8'))
  assert.deepEqual(errors, [])
  f.rt.classes.set('f_validatedw', {
    name: 'f_validatedw', kind: 'function', ancestor: 'function_object', library: 'functions',
    fields: [], controls: [],
    routines: new Map([['f_validatedw', new Map([['f_validatedw', file.routines]])]]),
  })
  const messages: string[] = []
  f.rt.ui = {
    messageBox: async (_title, text) => { messages.push(text); return 1 },
    closeWindow: () => {}, openWindow: async () => {},
  }
  f.model.deleteRow(2)
  f.model.setItem(1, 'name', 'Valid description')
  f.model.setItem(1, 'limit', 30)
  const fn = await f.rt.instantiate('f_validatedw')
  assert.equal(await f.rt.callMethod(fn, 'f_validatedw', [f.control]), 1)
  assert.deepEqual(messages, [])
  f.model.setItem(1, 'name', null)
  assert.equal(await f.rt.callMethod(fn, 'f_validatedw', [f.control]), -1)
  assert.equal(messages.length, 1)
  assert.match(messages[0], /Description/)
  assert.equal(f.model.col, 1)
  assert.equal(f.model.row, 1)
})
