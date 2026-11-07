import test from 'node:test'
import assert from 'node:assert/strict'
import { choiceSignature, choiceStyle, codeTable, sameChoiceValue, radioCaption, choiceEditText } from '../src/dw/choices.ts'
import { DwCatalog } from '../src/dw/def.ts'
import type { DwDef, DwObject } from '../src/dw/def.ts'
import { DwModel } from '../src/dw/model.ts'
import { Runtime } from '../src/runtime/interp.ts'
import { NDwBase } from '../src/runtime/native/dwctrl.ts'
import { commitDwValue } from '../src/dw/edit.ts'
import { compareLabels } from '../src/runtime/values.ts'

const object: DwObject = { name: 'status', type: 'column', band: 'detail', 'ddlb.allowedit': 'no', 'ddlb.sorted': 'no', 'ddlb.showlist': 'no' }
const definition: DwDef = { datawindow: {}, bands: {}, objects: [object], table: {
  columns: [{ name: 'status', type: 'char(1)', values: 'Yes\tY/No\tN/' }],
} }

test('code tables preserve display/data pairs and honor live values overrides', () => {
  assert.deepEqual(codeTable(definition, object), [['Yes', 'Y'], ['No', 'N']])
  assert.deepEqual(codeTable(definition, object, new Map([['status.values', 'Empty\t/Zero\t0/Same\tS/']])),
    [['Empty', ''], ['Zero', '0'], ['Same', 'S']])
  assert.equal(codeTable({ ...definition, table: { columns: [{ name: 'status', type: 'char(1)' }] } }, object), null)
})

test('escaped slashes preserve recovered titles, empty keys and trailing separators', () => {
  const titles = 'Mr.\tMr./Miss\tMiss/Mrs.\tMrs./M//S\tM//S/C//O\tC//O/Dr.\tDr./Prof.\tProf./H//Dr.\tH//Dr./'
  const expected = ['Mr.', 'Miss', 'Mrs.', 'M/S', 'C/O', 'Dr.', 'Prof.', 'H/Dr.']
  assert.deepEqual(codeTable(definition, object, new Map([['status.values', titles]])),
    expected.map((title) => [title, title]))
  assert.deepEqual(codeTable(definition, object, new Map([['status.values', '//Lead\tA/Tail//\tB/////Empty\t/Extra\ta\tb/']])),
    [['/Lead', 'A'], ['Tail/', 'B//'], ['Empty', ''], ['Extra', 'a\tb']])
})

test('sorted choices reuse stable case-insensitive native label order without rewriting keys', () => {
  assert.deepEqual(choiceStyle(object, new Map([['status.ddlb.sorted', 'yes']])), { kind: 'list', sorted: true })
  const entries = codeTable(definition, object, new Map([['status.values', 'Zulu\tz/alpha\ta/ALPHA\tb/Alpha\tc/']]))!
  assert.deepEqual([...entries].sort((left, right) => compareLabels(left[0], right[0])),
    [['alpha', 'a'], ['ALPHA', 'b'], ['Alpha', 'c'], ['Zulu', 'z']])
  assert.equal(entries[0][1], 'z', 'Ordering the editor must not mutate the source code table')
  const signature = choiceSignature(definition, object)
  assert.notEqual(choiceSignature(definition, object, new Map([['status.ddlb.sorted', 'yes']])), signature)
})

test('a lookup does not accidentally use a table values list as its display source', () => {
  const lookup = { name: 'status', type: 'column', band: 'detail', 'dddw.name': 'd_child', 'dddw.allowedit': 'no' }
  assert.equal(codeTable(definition, lookup), null)
})

test('only reviewed choice styles are selected', () => {
  assert.deepEqual(choiceStyle(object), { kind: 'list' })
  for (const [key, value] of [['allowedit', 'unknown'], ['showlist', 'unknown'], ['sorted', 'unknown'], ['sorted', 'no\tcode = 1']]) {
    assert.equal(choiceStyle(object, new Map([[`status.ddlb.${key}`, value]])).kind, 'unsupported')
  }
  assert.equal(choiceStyle({ ...object, 'dddw.name': 'd_child' }).kind, 'unsupported')
  assert.equal(choiceStyle({ ...object, 'checkbox.on': 'Y' }).kind, 'unsupported')
  assert.equal(choiceStyle({ ...object, 'radiobuttons.columns': '2' }).kind, 'unsupported')
  const lookup = { name: 'status', type: 'column', band: 'detail', 'dddw.allowedit': 'no',
    'dddw.name': 'D_CHILD', 'dddw.datacolumn': 'Code', 'dddw.displaycolumn': 'Label' }
  assert.deepEqual(choiceStyle(lookup), { kind: 'lookup', name: 'd_child', dataColumn: 'code', displayColumn: 'label' })
  assert.equal(choiceStyle({ ...lookup, 'dddw.displaycolumn': '' }).kind, 'unsupported')
})

test('editable lookups require explicit popup input policies and retain display-text casing', () => {
  const lookup = { name: 'status', type: 'column', band: 'detail', 'dddw.allowedit': 'yes',
    'dddw.name': 'D_CHILD', 'dddw.datacolumn': 'Code', 'dddw.displaycolumn': 'Label' }
  assert.deepEqual(choiceStyle(lookup), { kind: 'lookup', name: 'd_child', dataColumn: 'code', displayColumn: 'label', editable: true, case: 'any' })
  for (const [key, value] of [['showlist', 'unknown'], ['hsplitscroll', 'yes'], ['case', 'unknown'], ['limit', '-1'], ['limit', '32768'], ['limit', '1\tcode']]) {
    assert.equal(choiceStyle(lookup, new Map([[`status.dddw.${key}`, value]])).kind, 'unsupported', key)
  }
  assert.equal(choiceEditText(lookup, 'MiXeD'), 'MiXeD')
  assert.equal(choiceEditText(lookup, 'MiXeD', new Map([['status.dddw.case', 'upper']])), 'MIXED')
  assert.equal(choiceEditText(lookup, 'MiXeD', new Map([['status.dddw.case', 'lower']])), 'mixed')
})

test('ShowList opens choices on focus without changing keys, editing or sort policy', () => {
  assert.deepEqual(choiceStyle(object, new Map([['status.ddlb.showlist', 'yes']])), { kind: 'list', showList: true })
  assert.deepEqual(choiceStyle(object, new Map([['status.ddlb.showlist', 'yes'], ['status.ddlb.sorted', 'yes']])),
    { kind: 'list', showList: true, sorted: true })
  const lookup = { name: 'status', type: 'column', band: 'detail', 'dddw.allowedit': 'no',
    'dddw.name': 'd_child', 'dddw.datacolumn': 'code', 'dddw.displaycolumn': 'name', 'dddw.showlist': 'yes' }
  assert.deepEqual(choiceStyle(lookup), { kind: 'lookup', name: 'd_child', dataColumn: 'code', displayColumn: 'name', showList: true })
  assert.deepEqual(choiceStyle({ ...lookup, 'dddw.allowedit': 'yes' }),
    { kind: 'lookup', name: 'd_child', dataColumn: 'code', displayColumn: 'name', showList: true, editable: true, case: 'any' })
  for (const allowedit of ['yes', 'no']) assert.equal(choiceStyle({ ...lookup,
    'dddw.allowedit': allowedit, 'dddw.hsplitscroll': 'yes' }).kind, 'unsupported')
  assert.notEqual(choiceSignature(definition, object, new Map([['status.ddlb.showlist', 'yes']])), choiceSignature(definition, object))
})

test('lookup popup width percentages are finite source settings included in the binding', () => {
  const lookup = { name: 'status', type: 'column', band: 'detail', 'dddw.allowedit': 'no',
    'dddw.name': 'd_child', 'dddw.datacolumn': 'code', 'dddw.displaycolumn': 'name' }
  assert.deepEqual(choiceStyle({ ...lookup, 'dddw.percentwidth': '200' }),
    { kind: 'lookup', name: 'd_child', dataColumn: 'code', displayColumn: 'name', percentWidth: 200 })
  for (const value of ['-1', '1.5', 'Infinity', '32768', '20px']) {
    assert.equal(choiceStyle({ ...lookup, 'dddw.percentwidth': value }).kind, 'unsupported', value)
  }
  assert.notEqual(choiceSignature(definition, object, new Map([['status.dddw.percentwidth', '200']])),
    choiceSignature(definition, object))
})

test('lookup row limits retain positive source counts and keep absent or zero on the existing fallback', () => {
  const lookup = { name: 'status', type: 'column', band: 'detail', 'dddw.allowedit': 'no',
    'dddw.name': 'd_child', 'dddw.datacolumn': 'code', 'dddw.displaycolumn': 'name' }
  const expected = { kind: 'lookup', name: 'd_child', dataColumn: 'code', displayColumn: 'name' }
  assert.deepEqual(choiceStyle(lookup), expected)
  assert.deepEqual(choiceStyle({ ...lookup, 'dddw.lines': '0' }), expected)
  for (const lines of [1, 3, 5, 7, 10, 15, 100, 250, 32767]) {
    assert.deepEqual(choiceStyle({ ...lookup, 'dddw.lines': String(lines) }), { ...expected, lines })
  }
  assert.deepEqual(choiceStyle(lookup, new Map([['status.dddw.lines', '7']])), { ...expected, lines: 7 })
  assert.notEqual(choiceSignature(definition, lookup, new Map([['status.dddw.lines', '7']])),
    choiceSignature(definition, lookup))
  assert.deepEqual(choiceStyle({ ...object, 'ddlb.lines': '7' }), { kind: 'list' },
    'DDLB does not acquire an undocumented row-limit binding')
})

test('invalid lookup row limits fail explicitly instead of hiding malformed source settings', () => {
  const lookup = { name: 'status', type: 'column', band: 'detail', 'dddw.allowedit': 'no',
    'dddw.name': 'd_child', 'dddw.datacolumn': 'code', 'dddw.displaycolumn': 'name' }
  for (const value of ['', ' ', '-1', '1.5', 'Infinity', 'NaN', '32768', '7px', '1e2', '0x10', '7\tcode=1']) {
    assert.deepEqual(choiceStyle(lookup, new Map([['status.dddw.lines', value]])),
      { kind: 'unsupported', reason: 'Lookup row count is unsupported' }, value)
  }
})

test('lookup keys retain schema limits but ignore inactive text limits and casing', async () => {
  const rt = new Runtime({ load: async () => undefined })
  rt.fire = async (_target, event) => event === 'itemerror' ? 1 : 0
  const field = { name: 'status', type: 'column', band: 'detail', 'dddw.allowedit': 'yes',
    'dddw.name': 'd_child', 'dddw.datacolumn': 'code', 'dddw.displaycolumn': 'label',
    'dddw.limit': '50', 'dddw.case': 'upper', 'edit.limit': '1', 'edit.case': 'upper' }
  const model = new DwModel(rt, 'd_lookup', { ...definition, objects: [field], table: { columns: [{ name: 'status', type: 'char(3)' }] } })
  const control = new NDwBase(rt, 'dw_lookup')
  control.attach(model)
  model.insertRow(0)
  assert.equal(await commitDwValue(control, model, 1, 0, field, 'abc'), 'accepted')
  assert.equal(model.getItem(1, 1), 'abc')
  assert.equal(await commitDwValue(control, model, 1, 0, field, 'long'), 'rejected')
})

test('choice signatures detect value and lookup-policy changes, not ordinary column width', () => {
  const initial = choiceSignature(definition, object)
  assert.equal(choiceSignature(definition, object, new Map([['status.width', '200']])), initial)
  assert.notEqual(choiceSignature(definition, object, new Map([['status.values', 'Other\tO/']])), initial)
  assert.notEqual(choiceSignature(definition, object, new Map([['status.ddlb.allowedit', 'yes']])), initial)
})

test('null, empty and zero remain distinct while numeric keys match their input text', () => {
  assert.equal(sameChoiceValue(null, undefined), true)
  assert.equal(sameChoiceValue(null, ''), false)
  assert.equal(sameChoiceValue('', 0), false)
  assert.equal(sameChoiceValue(0, '0'), true)
  assert.equal(sameChoiceValue(12, '12'), true)
})

const checkbox: DwObject = { name: 'status', type: 'column', band: 'detail',
  'checkbox.on': 'Y', 'checkbox.off': 'N', 'checkbox.text': '', 'checkbox.lefttext': 'no',
  'checkbox.scale': 'yes', 'checkbox.threed': 'no' }

const radio: DwObject = { name: 'status', type: 'column', band: 'detail',
  'radiobuttons.columns': '2', 'radiobuttons.lefttext': 'no', 'radiobuttons.scale': 'no', 'radiobuttons.threed': 'yes' }

test('radio choices retain exact source columns and reject mixed or unreviewed presentations', () => {
  assert.deepEqual(choiceStyle(radio), { kind: 'radio', columns: 2 })
  assert.deepEqual(choiceStyle(radio, new Map([['status.radiobuttons.columns', '1']])), { kind: 'radio', columns: 1 })
  for (const [key, value] of [['radiobuttons.columns', '0'], ['radiobuttons.columns', '2.5'],
    ['radiobuttons.columns', '2\tcode'], ['radiobuttons.lefttext', 'yes'], ['radiobuttons.scale', 'unknown'],
    ['radiobuttons.custom', 'yes'], ['checkbox.on', 'Y'], ['ddlb.allowedit', 'no'], ['dddw.name', 'other']]) {
    assert.equal(choiceStyle(radio, new Map([[`status.${key}`, value]])).kind, 'unsupported', key)
  }
})

test('radio code tables preserve order, escaped text, original keys and live configuration signatures', () => {
  const def = { ...definition, objects: [radio] }
  assert.deepEqual(codeTable(def, radio), [['Yes', 'Y'], ['No', 'N']])
  const overrides = new Map([['status.values', '&Flat Discount\tF/&Percentage Discount\tD/']])
  assert.deepEqual(codeTable(def, radio, overrides), [['&Flat Discount', 'F'], ['&Percentage Discount', 'D']])
  assert.equal(radioCaption('&Flat && Discount'), 'Flat & Discount')
  assert.notEqual(choiceSignature(def, radio, overrides), choiceSignature(def, radio))
  assert.notEqual(choiceSignature(def, radio, new Map([['status.radiobuttons.columns', '1']])), choiceSignature(def, radio))
  assert.equal(choiceSignature(def, radio, new Map([['status.width', '999']])), choiceSignature(def, radio))
})

test('radio keys ignore inactive text properties while retaining schema length and validation', async () => {
  const rt = new Runtime({ load: async () => undefined })
  const events: string[] = []
  rt.fire = async (_target, event) => { events.push(event); return event === 'itemerror' ? 1 : 0 }
  const control = new NDwBase(rt, 'dw_radio')
  const field = { ...radio, 'edit.case': 'upper', 'edit.limit': '1', 'edit.nilisnull': 'yes' }
  const model = new DwModel(rt, 'd_radio', { ...definition, objects: [field], table: { columns: [{ name: 'status', type: 'char(3)' }] } })
  control.attach(model)
  model.insertRow(0)
  model.col = 1
  await control.n_settext('yes')
  assert.equal(await control.n_gettext(), 'yes')
  assert.equal(await commitDwValue(control, model, 1, 0, field, 'yes'), 'accepted')
  assert.equal(model.getItem(1, 1), 'yes')
  assert.equal(await commitDwValue(control, model, 1, 0, field, ''), 'accepted')
  assert.equal(model.getItem(1, 1), '')
  assert.equal(await commitDwValue(control, model, 1, 0, field, 'long'), 'rejected')
  assert.deepEqual(events, ['itemchanged', 'itemchanged', 'itemerror'])
})

test('checkboxes require distinct exact keys and a reviewed two-state presentation', () => {
  assert.deepEqual(choiceStyle(checkbox), { kind: 'checkbox', on: 'Y', off: 'N' })
  assert.deepEqual(choiceStyle(checkbox, new Map([['status.checkbox.off', '']])), { kind: 'checkbox', on: 'Y', off: '' })
  const { 'checkbox.off': _off, ...missing } = checkbox
  assert.equal(choiceStyle(missing).kind, 'unsupported')
  for (const [key, value] of [
    ['checkbox.off', 'Y'], ['checkbox.on', 'Y\tif(code=1,Y,N)'], ['checkbox.threestate', 'yes'],
    ['checkbox.lefttext', 'unknown'], ['checkbox.text', 'Text\tname'], ['radiobuttons.columns', '2'],
    ['ddlb.allowedit', 'no'], ['dddw.name', 'd_changed'],
  ]) assert.equal(choiceStyle(checkbox, new Map([[`status.${key}`, value]])).kind, 'unsupported', key)
})

test('editable code tables retain their own input policies and original keys', async () => {
  const field = { ...object, 'ddlb.allowedit': 'yes', 'ddlb.case': 'upper', 'ddlb.limit': '4',
    'edit.limit': '1', 'edit.case': 'lower' }
  assert.deepEqual(choiceStyle(field), { kind: 'list', editable: true, case: 'upper' })
  assert.equal(choiceEditText(field, 'Mixed'), 'MIXED')
  for (const [key, value] of [['case', 'unknown'], ['limit', '-1'], ['limit', '32768']]) {
    assert.equal(choiceStyle(field, new Map([[`status.ddlb.${key}`, value]])).kind, 'unsupported')
  }
  assert.deepEqual(choiceStyle(field, new Map([['status.ddlb.showlist', 'yes'], ['status.ddlb.sorted', 'yes']])),
    { kind: 'list', editable: true, case: 'upper', showList: true, sorted: true })
  const rt = new Runtime({ load: async () => undefined })
  rt.fire = async (_target, event) => event === 'itemerror' ? 1 : 0
  const model = new DwModel(rt, 'd_code_table', { ...definition, objects: [field],
    table: { columns: [{ name: 'status', type: 'char(3)' }] } })
  const control = new NDwBase(rt, 'dw_code_table')
  control.attach(model); model.insertRow(0)
  assert.equal(await commitDwValue(control, model, 1, 0, field, 'abc'), 'accepted')
  assert.equal(model.getItem(1, 1), 'abc', 'Selected keys ignore both inactive text casing and text limits')
  assert.equal(await commitDwValue(control, model, 1, 0, field, 'long'), 'rejected')
})

test('left-text checkboxes retain source key and caption placement contracts', () => {
  assert.deepEqual(choiceStyle(checkbox, new Map([['status.checkbox.lefttext', 'yes']])),
    { kind: 'checkbox', on: 'Y', off: 'N', leftText: true })
  assert.notEqual(choiceSignature(definition, checkbox, new Map([['status.checkbox.lefttext', 'yes']])),
    choiceSignature(definition, checkbox))
})

test('checkbox configuration and added selector styles invalidate a retained draft, but geometry does not', () => {
  const def = { ...definition, objects: [checkbox] }
  const signature = choiceSignature(def, checkbox)
  assert.equal(choiceSignature(def, checkbox, new Map([['status.width', '200']])), signature)
  for (const [key, value] of [['checkbox.on', 'y'], ['checkbox.off', 'n'], ['checkbox.text', 'Changed'],
    ['checkbox.threestate', 'yes'], ['radiobuttons.columns', '2']]) {
    assert.notEqual(choiceSignature(def, checkbox, new Map([[`status.${key}`, value]])), signature)
  }
})

test('checkbox keys bypass inactive case, text limit and NilIsNull, but not the schema length', async () => {
  const rt = new Runtime({ load: async () => undefined })
  const events: { event: string; value: unknown }[] = []
  rt.fire = async (_target, event, args = []) => { events.push({ event, value: args[2] }); return event === 'itemerror' ? 1 : 0 }
  const control = new NDwBase(rt, 'dw_checkbox')
  const field = { ...checkbox, 'checkbox.on': 'yes', 'checkbox.off': '',
    'edit.case': 'upper', 'edit.limit': '1', 'edit.nilisnull': 'yes' }
  const model = new DwModel(rt, 'd_checkbox', { ...definition, objects: [field],
    table: { columns: [{ name: 'status', type: 'char(3)' }] } })
  control.attach(model)
  model.insertRow(0)
  model.col = 1
  await control.n_settext('yes')
  assert.equal(await control.n_gettext(), 'yes')
  assert.equal(await commitDwValue(control, model, 1, 0, field, 'yes'), 'accepted')
  assert.equal(model.getItem(1, 1), 'yes')
  assert.equal(await commitDwValue(control, model, 1, 0, field, ''), 'accepted')
  assert.equal(model.getItem(1, 1), '')
  field['checkbox.on'] = 'toolong'
  assert.equal(await commitDwValue(control, model, 1, 0, field, 'toolong'), 'rejected')
  assert.equal(model.getItem(1, 1), '')
  assert.deepEqual(events, [{ event: 'itemchanged', value: 'yes' }, { event: 'itemchanged', value: '' },
    { event: 'itemerror', value: 'toolong' }])
})

test('inactive text-case properties cannot rewrite a selected code-table key', async () => {
  const rt = new Runtime({ load: async () => undefined })
  const data: unknown[] = []
  rt.fire = async (_target, event, args = []) => { if (event === 'itemchanged') data.push(args[2]); return 0 }
  const control = new NDwBase(rt, 'dw_case_choices')
  const field = { ...object, 'edit.case': 'upper' }
  const model = new DwModel(rt, 'd_case_choices', { ...definition, objects: [field],
    table: { columns: [{ name: 'status', type: 'char(1)', values: 'Alpha\ta/Beta\tb/' }] } })
  control.attach(model)
  model.insertRow(0)
  model.col = 1
  assert.equal(await control.n_settext('a'), 1)
  assert.equal(await control.n_gettext(), 'a')
  assert.equal(await commitDwValue(control, model, 1, 0, field, 'a'), 'accepted')
  assert.equal(model.getItem(1, 'status'), 'a')
  assert.deepEqual(data, ['a'])
})

test('GetChild replaces an invalidated lookup when its runtime name changes', async () => {
  const rt = new Runtime({ load: async () => undefined })
  rt.dwCatalog = new DwCatalog(async () => undefined)
  rt.dwCatalog.get = async () => ({ datawindow: {}, bands: {}, objects: [],
    table: { columns: [{ name: 'code', type: 'long' }, { name: 'name', type: 'char(20)' }] } })
  const control = new NDwBase(rt, 'dw_choices')
  const lookup = { name: 'status', type: 'column', band: 'detail', 'dddw.name': 'd_first' }
  const model = new DwModel(rt, 'd_parent', { ...definition, objects: [lookup] })
  control.attach(model)
  const first = await control.n_getchild('status')
  assert.ok(first instanceof NDwBase)
  await first.ready
  assert.equal(first.model?.name, 'd_first')
  assert.equal(await control.n_getchild('status'), first)
  model.modify("status.dddw.name='d_second'")
  const second = await control.n_getchild('status')
  assert.ok(second instanceof NDwBase)
  await second.ready
  assert.notEqual(second, first)
  assert.equal(first.destroyed, true)
  assert.equal(second.model?.name, 'd_second')
  model.modify("status.dddw.name=''")
  assert.equal(await control.n_getchild('status'), -1)
  assert.equal(second.destroyed, true)
  assert.equal(second.listeners.size, 0)
  model.modify("status.dddw.name='d_third'")
  const third = await control.n_getchild('status')
  assert.ok(third instanceof NDwBase)
  await third.ready
  control.attach(new DwModel(rt, 'd_replaced', definition))
  assert.equal(third.destroyed, true)
  assert.equal(third.listeners.size, 0)
})

test('destroying a parent invalidates a lookup whose definition is still loading', async () => {
  const rt = new Runtime({ load: async () => undefined })
  rt.dwCatalog = new DwCatalog(async () => undefined)
  let resolveChild!: (value: DwDef) => void
  rt.dwCatalog.get = async () => new Promise<DwDef>((resolve) => { resolveChild = resolve })
  const parent = new NDwBase(rt, 'dw_parent')
  parent.attach(new DwModel(rt, 'd_parent', { ...definition, objects: [
    { name: 'status', type: 'column', band: 'detail', 'dddw.name': 'd_pending' },
  ] }))
  const child = await parent.n_getchild('status')
  assert.ok(child instanceof NDwBase)
  parent.destroy()
  resolveChild(definition)
  await child.ready
  assert.equal(child.destroyed, true)
  assert.equal(child.model, null)
  assert.equal(child.listeners.size, 0)
  assert.equal(await parent.n_getchild('status'), -1)
})

test('destroying a child notifies its owner once before releasing subscriptions', async () => {
  const rt = new Runtime({ load: async () => undefined })
  const parent = new NDwBase(rt, 'dw_parent')
  rt.dwCatalog = new DwCatalog(async () => undefined)
  rt.dwCatalog.get = async () => definition
  parent.attach(new DwModel(rt, 'd_parent', { ...definition, objects: [
    { name: 'status', type: 'column', band: 'detail', 'dddw.name': 'd_child' },
  ] }))
  const child = await parent.n_getchild('status')
  assert.ok(child instanceof NDwBase)
  await child.ready
  const destroyed: boolean[] = []
  parent.listeners.add(() => destroyed.push(child.destroyed))
  child.destroy()
  child.destroy()
  assert.deepEqual(destroyed, [true])
  assert.equal(child.listeners.size, 0)
})
