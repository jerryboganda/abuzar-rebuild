import test from 'node:test'
import assert from 'node:assert/strict'
import { Runtime } from '../src/runtime/interp.ts'
import { NDwBase } from '../src/runtime/native/dwctrl.ts'
import { DwModel } from '../src/dw/model.ts'
import type { DwDef, DwObject } from '../src/dw/def.ts'
import { commitDwValue, dwEditAutoSelect, dwEditorText, dwEditText, dwMultiline, dwMultilineDomText, dwMultilineText, sameDwColumn } from '../src/dw/edit.ts'
import { parseScriptFile } from '../src/pbscript/parser.ts'
import type { ClassDef } from '../src/runtime/object.ts'
import { dateOrder, PBDate, PBDateTime, PBTime, setDateOrder, toStr } from '../src/runtime/values.ts'

function scripts(name: string, text: string): ClassDef {
  const { file, errors } = parseScriptFile(text)
  assert.deepEqual(errors, [])
  const routines: ClassDef['routines'] = new Map()
  for (const routine of file.routines) {
    if (!routines.has(routine.owner)) routines.set(routine.owner, new Map())
    const owner = routines.get(routine.owner)!
    if (!owner.has(routine.name)) owner.set(routine.name, [])
    owner.get(routine.name)!.push(routine)
  }
  return { name, kind: name.startsWith('f_') ? 'function' : 'userobject', ancestor: 'powerobject',
    library: 'synthetic', fields: [], controls: [], routines }
}

function fixture(type = 'long', validation = '') {
  const rt = new Runtime({ load: async () => undefined })
  const ctl = new NDwBase(rt, 'dw_fixture', 'datawindow')
  const object: DwObject = { name: 'quantity', type: 'column', band: 'detail' }
  const def: DwDef = { datawindow: {}, bands: {}, table: { columns: [{ name: object.name, type, validation, validationmsg: 'Check the sample quantity.' }] }, objects: [object] }
  const model = new DwModel(rt, 'd_synthetic_edit', def)
  ctl.model = model
  model.insertRow(0)
  model.setItem(1, 1, 7)
  const events: { name: string; args: unknown[] }[] = []
  let changed = 0
  ctl.listeners.add(() => { changed++ })
  let itemChanged = 0
  let itemError = 0
  rt.fire = async (_object, name, args = []) => {
    events.push({ name, args })
    assert.equal(String(model.getItem(1, 1)), '7', 'Events precede the model write')
    return name === 'itemchanged' ? itemChanged : itemError
  }
  const messages: string[] = []
  rt.ui = { messageBox: async (_title, text) => { messages.push(text); return 1 }, closeWindow: () => {}, openWindow: async () => {} }
  return {
    ctl, model, events, messages, changed: () => changed,
    responses: (change: number, error = 0) => { itemChanged = change; itemError = error },
    commit: (value: unknown) => commitDwValue(ctl, model, 1, 0, object, value),
  }
}

test('native Sort resets to the first sorted row without row-focus callbacks', async () => {
  const { ctl, model, events } = fixture()
  model.insertRow(0)
  model.setItem(2, 1, 3)
  model.insertRow(0)
  model.row = 2
  await ctl.n_setsort('quantity A')
  assert.equal(await ctl.n_sort(), 1)
  assert.equal(model.row, 1)
  assert.equal(model.getItem(1, 1), null)
  assert.equal(model.getItem(2, 1), 3)
  assert.equal(model.getItem(3, 1), 7)
  assert.deepEqual(events, [])
  assert.equal(await ctl.n_deleterow(0), 1)
  assert.deepEqual([model.getItem(1, 1), model.getItem(2, 1)], [3, 7])
})

test('multiline editing requires a plain string Edit with explicit vertical scrolling and wrapping', () => {
  const object: DwObject = { name: 'address', type: 'column', band: 'detail',
    'edit.autohscroll': 'no', 'edit.autovscroll': 'yes', 'edit.password': 'no', 'edit.codetable': 'no' }
  assert.equal(dwMultiline(object, 'string'), true)
  assert.equal(dwMultiline(object, 'number'), false)
  for (const [property, value] of [
    ['edit.autohscroll', 'yes'], ['edit.autovscroll', 'no'], ['edit.autovscroll', 'yes\tcode=1'],
    ['edit.password', 'yes'], ['edit.codetable', 'yes'], ['edit.password', 'unknown'],
    ['ddlb.allowedit', 'no'], ['editmask.mask', '###'], ['radiobuttons.columns', '2'],
  ]) assert.equal(dwMultiline(object, 'string', new Map([[`address.${property}`, value]])), false, property)
})

test('textarea conversion preserves untouched source line endings and uses CRLF only for changed text', () => {
  for (const original of ['First\r\nSecond', 'First\nSecond', 'First\rSecond', 'First\r\nSecond\nThird\r']) {
    assert.equal(dwMultilineText(dwMultilineDomText(original), original), original)
  }
  assert.equal(dwMultilineText('Changed\ntext\n', 'First\r\nSecond'), 'Changed\r\ntext\r\n')
  assert.equal(dwMultilineText('', 'First\r\nSecond'), '')
})

test('multiline CRLF limits are measured on the actual data, not shorter DOM line endings', async () => {
  const f = fixture('char(8)')
  assert.equal(await f.commit(dwMultilineText('1234\n789', '7')), 'rejected')
  assert.equal(f.model.getItem(1, 1), '7')
  assert.equal(await f.commit(dwMultilineText('1234\n78', '7')), 'accepted')
  assert.equal(f.model.getItem(1, 1), '1234\r\n78')
})

test('accepted edit validates then runs ItemChanged before the buffer write and notifies once', async () => {
  const f = fixture()
  assert.equal(await f.commit('12'), 'accepted')
  assert.equal(f.model.getItem(1, 1), 12)
  assert.deepEqual(f.events, [{ name: 'itemchanged', args: [1, { name: 'quantity' }, '12'] }])
  assert.equal(f.changed(), 1)
})

for (const rejection of [1, 2]) test(`ItemChanged return ${rejection} retains the original value and its focus decision`, async () => {
  const f = fixture()
  f.responses(rejection)
  assert.equal(await f.commit('12'), rejection === 1 ? 'rejected' : 'discarded')
  assert.equal(f.model.getItem(1, 1), 7)
  assert.equal(f.changed(), 0)
  assert.deepEqual(f.events.map((event) => event.name), rejection === 1 ? ['itemchanged', 'itemerror'] : ['itemchanged'])
})

for (const response of [0, 1, 2, 3]) {
  test(`invalid numeric text never fabricates a number for ItemError return ${response}`, async () => {
    const f = fixture()
    f.responses(0, response)
    assert.equal(await f.commit('not a number'), response === 3 ? 'discarded' : 'rejected')
    assert.equal(f.model.getItem(1, 1), 7)
    assert.deepEqual(f.events.map((event) => event.name), ['itemerror'])
    assert.equal(f.messages.length, response === 0 || response === 2 ? 1 : 0)
    assert.equal(f.changed(), 0)
  })
}

test('blank numbers remain null, formatted decimals retain precision', async () => {
  const blank = fixture()
  assert.equal(await blank.commit(' '), 'accepted')
  assert.equal(blank.model.getItem(1, 1), null)
  const decimal = fixture('decimal(4)')
  assert.equal(await decimal.commit('(1,234.5678)'), 'accepted')
  assert.equal(String(decimal.model.getItem(1, 1)), '-1234.5678')
})

for (const type of ['long', 'decimal(2)']) for (const value of ['0x10', '0b10', '.', '1e999']) {
  test(`${type} rejects non-decimal or non-finite text ${value} before ItemChanged`, async () => {
    const f = fixture(type)
    assert.equal(await f.commit(value), 'rejected')
    assert.equal(String(f.model.getItem(1, 1)), '7')
    assert.deepEqual(f.events.map((event) => event.name), ['itemerror'])
  })
}

test('text limits reject an overlong draft instead of silently truncating the saved value', async () => {
  const f = fixture('char(8)')
  assert.equal(await f.commit('123456789'), 'rejected')
  assert.equal(f.model.getItem(1, 1), '7')
  assert.deepEqual(f.events.map((event) => event.name), ['itemerror'])
  f.model.modify("quantity.edit.limit='4'")
  assert.equal(await f.commit('12345'), 'rejected')
  assert.equal(await f.commit('1234'), 'accepted')
  assert.equal(f.model.getItem(1, 1), '1234')
})

for (const [casing, expected] of [['upper', 'MIXED'], ['lower', 'mixed'], ['any', 'MiXeD']]) {
  test(`Edit.Case ${casing} applies before validation and ItemChanged, not just display`, async () => {
    const f = fixture('char(20)', `gettext() = '${expected}'`)
    f.model.def.objects[0]['edit.case'] = casing
    assert.equal(await f.commit('MiXeD'), 'accepted')
    assert.equal(f.model.getItem(1, 1), expected)
    assert.deepEqual(f.events, [{ name: 'itemchanged', args: [1, { name: 'quantity' }, expected] }])
  })
}

test('Edit.Case honors live overrides and does not rewrite stored items or numeric text', () => {
  const f = fixture('char(20)')
  const object = f.model.def.objects[0]
  object['edit.case'] = 'upper'
  f.model.setItem(1, 1, 'Stored Mixed')
  assert.equal(dwEditText(f.model, 0, object, 'Mixed'), 'MIXED')
  f.model.modify("quantity.edit.case='lower'")
  assert.equal(dwEditText(f.model, 0, object, 'Mixed'), 'mixed')
  f.model.modify("quantity.edit.case='any'")
  assert.equal(dwEditText(f.model, 0, object, 'Mixed'), 'Mixed')
  assert.equal(f.model.getItem(1, 1), 'Stored Mixed')
  const numeric = fixture()
  numeric.model.def.objects[0]['edit.case'] = 'upper'
  assert.equal(dwEditText(numeric.model, 0, numeric.model.def.objects[0], '1e2'), '1e2')
})

test('case expansion respects text limits without silently truncating the converted draft', async () => {
  const f = fixture('char(1)')
  f.model.def.objects[0]['edit.case'] = 'upper'
  f.responses(0, 1)
  assert.equal(await f.commit('\u00df'), 'rejected')
  assert.equal(f.model.getItem(1, 1), '7')
  assert.deepEqual(f.events, [{ name: 'itemerror', args: [1, { name: 'quantity' }, 'SS'] }])
})

test('AutoSelect follows explicit Edit/EditMask flags and runtime overrides', () => {
  for (const style of ['edit', 'editmask']) {
    const f = fixture('char(20)')
    const object = f.model.def.objects[0]
    assert.equal(dwEditAutoSelect(f.model, object), true)
    object[`${style}.autoselect`] = 'no'
    assert.equal(dwEditAutoSelect(f.model, object), false)
    f.model.modify(`quantity.${style}.autoselect='yes'`)
    assert.equal(dwEditAutoSelect(f.model, object), true)
    f.model.modify(`quantity.${style}.autoselect='no'`)
    assert.equal(dwEditAutoSelect(f.model, object), false)
  }
})

for (const [type, text, Expected] of [
  ['date', '2028-02-29', PBDate],
  ['time', '11:59:30 PM', PBTime],
  ['datetime', '2028-02-29T23:59:30.125', PBDateTime],
] as const) {
  test(`${type} input becomes a typed PowerBuilder value rather than a raw string`, async () => {
    const f = fixture(type)
    assert.equal(await f.commit(text), 'accepted')
    assert.ok(f.model.getItem(1, 1) instanceof Expected)
  })
}

for (const [type, text] of [
  ['date', '2027-02-29'], ['date', '2028-02-29 garbage'],
  ['time', '13:00 PM'], ['time', '00:15 AM'], ['time', '24:00'],
  ['datetime', '2028-02-29T23:60'], ['datetime', '2028-02-29Tbad-time'],
]) {
  test(`${type} rejects invalid temporal input ${text} instead of fabricating a value`, async () => {
    const f = fixture(type)
    assert.equal(await f.commit(text), 'rejected')
    assert.equal(f.model.getItem(1, 1), 7)
    assert.deepEqual(f.events.map((event) => event.name), ['itemerror'])
  })
}

test('numeric date masks own ambiguous date entry independently of regional order', async () => {
  const previous = dateOrder
  try {
    for (const regional of ['mdy', 'dmy'] as const) {
      setDateOrder(regional)
      for (const type of ['date', 'datetime']) for (const [mask, text] of [
        ['dd/mm/yyyy', '03/04/2028'], ['mm/dd/yyyy', '04/03/2028'],
        ['d.m.yy', '3.4.28'], ['yyyy-mm-dd', '2028-04-03'],
      ]) {
        const f = fixture(type)
        const object = f.model.def.objects[0]
        object['editmask.mask'] = mask
        object['editmask.useformat'] = 'yes'
        object.format = 'mm/dd/yyyy'
        assert.equal(await f.commit(text), 'accepted')
        const value = f.model.getItem(1, 1)
        assert.ok(value instanceof PBDate || value instanceof PBDateTime)
        assert.equal(value.n, PBDate.ymd(2028, 4, 3).n)
        assert.equal(dwEditorText(f.model, object, value), text)
      }
    }
  } finally { setDateOrder(previous) }
})

test('date masks reject invalid calendar dates, preserve timestamps and honor live overrides', async () => {
  const f = fixture('datetime')
  const object = f.model.def.objects[0]
  object['editmask.mask'] = 'mm/dd/yyyy hh:mm:ss'
  f.model.modify("quantity.editmask.mask='dd/mm/yyyy hh:mm:ss'")
  for (const text of ['29/02/2027 12:30:45', '31/04/2028', '29/02/2028 25:00']) {
    assert.equal(await f.commit(text), 'rejected')
    assert.equal(f.model.getItem(1, 1), 7)
  }
  assert.equal(await f.commit('29/02/2028 12:30:45'), 'accepted')
  const value = f.model.getItem(1, 1)
  assert.ok(value instanceof PBDateTime)
  assert.equal(value.n, PBDate.ymd(2028, 2, 29).n)
  assert.equal(value.ms, PBTime.hms(12, 30, 45).ms)
  assert.equal(dwEditorText(f.model, object, value), '29/02/2028 12:30:45')
  f.model.modify("quantity.editmask.mask='dd/mm/yyyy'")
  assert.equal(dwEditorText(f.model, object, value), '29/02/2028')
  assert.equal(dwEditorText(f.model, object, null), '')
})

test('unmasked and named short-date editors retain regional input order', async () => {
  const previous = dateOrder
  try {
    for (const regional of ['mdy', 'dmy'] as const) for (const mask of ['', '[shortdate]']) {
      setDateOrder(regional)
      const f = fixture('date'), object = f.model.def.objects[0]
      object['editmask.mask'] = mask
      assert.equal(await f.commit('03/04/2028'), 'accepted')
      const value = f.model.getItem(1, 1)
      assert.ok(value instanceof PBDate)
      assert.equal(value.n, PBDate.ymd(2028, regional === 'mdy' ? 3 : 4, regional === 'mdy' ? 4 : 3).n)
      assert.equal(dwEditorText(f.model, object, value), regional === 'mdy' ? '3/4/2028' : '03/04/2028')
    }
  } finally { setDateOrder(previous) }
})

test('other temporal mask grammars keep existing editable text rather than showing unparseable tokens', async () => {
  for (const mask of ['mmmm d, yyyy', 'mm/yyyy', 'dd/mm/yyy', 'dd/mm/yyyy literal', 'hh:mm a/p']) {
    const f = fixture('datetime'), object = f.model.def.objects[0]
    object['editmask.mask'] = mask
    const value = new PBDateTime(PBDate.ymd(2028, 4, 3).n, PBTime.hms(12, 30, 45).ms)
    const text = dwEditorText(f.model, object, value)
    assert.equal(text, toStr(value))
    assert.equal(await f.commit(text), 'accepted')
    assert.deepEqual(f.model.getItem(1, 1), value)
  }
})

test('validation failure invokes ItemError and shows the existing message without writing', async () => {
  const f = fixture('long', 'number(gettext()) > 10')
  assert.equal(await f.commit('5'), 'rejected')
  assert.equal(f.model.getItem(1, 1), 7)
  assert.deepEqual(f.events.map((event) => event.name), ['itemerror'])
  assert.deepEqual(f.messages, ['Check the sample quantity.'])
  assert.equal(f.changed(), 0)
})

test('run-time validation overrides the definition and accepted ItemError preserves the entered value', async () => {
  const f = fixture('long', 'number(gettext()) > 10')
  f.ctl.validateRules.set('quantity', 'number(gettext()) > 20')
  f.responses(0, 2)
  assert.equal(await f.commit('15'), 'accepted')
  assert.deepEqual(f.events.map((event) => event.name), ['itemerror'])
  assert.equal(f.model.getItem(1, 1), 15)
  assert.deepEqual(f.messages, [])
})

test('unsupported validation fails visibly rather than silently accepting unvalidated data', async () => {
  const f = fixture('long', 'unknown_synthetic_function(')
  const errors: unknown[] = []
  f.ctl.rt.onError = (error) => errors.push(error)
  assert.equal(await f.commit('12'), 'rejected')
  assert.equal(errors.length, 1)
  assert.deepEqual(f.events, [])
  assert.match(f.messages[0], /could not be evaluated/)
  assert.equal(f.model.getItem(1, 1), 7)
})

test('ItemError return 1 suppresses the standard message; return 3 discards without writing', async () => {
  for (const response of [1, 3]) {
    const f = fixture('long', 'number(gettext()) > 10')
    f.responses(0, response)
    assert.equal(await f.commit('5'), response === 1 ? 'rejected' : 'discarded')
    assert.equal(f.model.getItem(1, 1), 7)
    assert.deepEqual(f.messages, [])
  }
})

test('a correcting ItemError SetItem followed by return 3 is not overwritten by the rejected text', async () => {
  const f = fixture('long', 'number(gettext()) > 10')
  f.ctl.rt.fire = async (_target, event) => {
    assert.equal(event, 'itemerror')
    f.model.setItem(1, 1, 25)
    return 3
  }
  assert.equal(await f.commit('5'), 'discarded')
  assert.equal(f.model.getItem(1, 1), 25)
})

test('ItemChanged rejection can be explicitly accepted by ItemError', async () => {
  const f = fixture()
  f.responses(1, 2)
  assert.equal(await f.commit('12'), 'accepted')
  assert.equal(f.model.getItem(1, 1), 12)
  assert.deepEqual(f.events.map((event) => event.name), ['itemchanged', 'itemerror'])
})

test('AcceptText within ItemChanged is a no-op, not a recursive acceptance or rejection', async () => {
  const f = fixture()
  const rt = f.ctl.rt
  let accepts = 0
  const results: unknown[] = []
  f.model.acceptText = async () => { accepts++; return -1 }
  const cls = scripts('dw_fixture', `
// dw_fixture.itemchanged(long row, dwobject dwo, string data) returns long [event]
f_observe(accepttext())
f_observe(this.accepttext())
f_observe(wf_accept())
f_observe(f_accept(this))
this.post event ue_after()
return 0
// dw_fixture.wf_accept() returns long
return this.accepttext()
// dw_fixture.ue_after() returns long [event]
f_observe(accepttext())
return 0
`)
  f.ctl.scripts.push({ cls, owner: cls.name })
  rt.classes.set('f_accept', scripts('f_accept', `
// f_accept.f_accept(datawindow control) returns long
return control.accepttext()
`))
  rt.sys.set('f_observe', { fn: (_rt, args) => { results.push(args[0]); return 1 } })
  rt.fire = Runtime.prototype.fire.bind(rt)
  assert.equal(await f.commit('12'), 'accepted')
  assert.deepEqual(results, [1, 1, 1, 1])
  assert.equal(accepts, 0)
  await rt.flushPosted()
  assert.deepEqual(results, [1, 1, 1, 1, -1], 'Posted events do not inherit an expired ItemChanged context')
  assert.equal(accepts, 1)
})

test('an unrelated AcceptText cannot inherit a suspended ItemChanged call chain', async () => {
  const f = fixture()
  const began = Promise.withResolvers<void>()
  const pending = Promise.withResolvers<void>()
  const cls = scripts('dw_fixture', `
// dw_fixture.itemchanged(long row, dwobject dwo, string data) returns long [event]
f_pause()
return 0
`)
  f.ctl.scripts.push({ cls, owner: cls.name })
  f.ctl.rt.sys.set('f_pause', { fn: async () => { began.resolve(); await pending.promise; return 1 } })
  f.ctl.rt.fire = Runtime.prototype.fire.bind(f.ctl.rt)
  f.model.acceptText = async () => -1
  const committing = f.commit('12')
  await began.promise
  assert.equal(await f.ctl.n_accepttext(), -1)
  assert.equal(await f.ctl.rt.callMethod(f.ctl, 'accepttext', []), -1)
  pending.resolve()
  assert.equal(await committing, 'accepted')
})

test('AcceptText succeeds when no DataWindow object is assigned', async () => {
  const rt = new Runtime({ load: async () => undefined })
  const ctl = new NDwBase(rt, 'dw_empty', 'datawindow')
  assert.equal(await ctl.n_accepttext(), 1)
})

test('ItemChanged reentrancy state is released after a script failure', async () => {
  const f = fixture()
  f.ctl.rt.fire = async () => { throw new Error('Synthetic script failure') }
  await assert.rejects(f.commit('12'), /Synthetic script failure/)
  f.model.acceptText = async () => -1
  assert.equal(await f.ctl.n_accepttext(), -1)
})

test('asynchronous edit guards finish before ItemChanged or a buffer write', async () => {
  const f = fixture()
  let release!: () => void
  const pending = new Promise<void>((resolve) => { release = resolve })
  const result = commitDwValue(f.ctl, f.model, 1, 0, f.model.def.objects[0], '12', async () => {
    await pending
    throw new Error('Field is no longer editable')
  })
  assert.deepEqual(f.events, [])
  assert.equal(f.model.getItem(1, 1), 7)
  release()
  await assert.rejects(result, /no longer editable/)
  assert.equal(f.changed(), 0)
})

test('model identity is checked synchronously after an asynchronous final guard', async () => {
  const f = fixture()
  let checks = 0
  await assert.rejects(commitDwValue(f.ctl, f.model, 1, 0, f.model.def.objects[0], '12', async () => {
    if (++checks === 4) queueMicrotask(() => { f.ctl.model = null })
  }), /changed during validation/)
  assert.equal(f.model.getItem(1, 1), 7)
  assert.equal(f.changed(), 0)
})

test('an editor stays current when Modify replaces the definition object', () => {
  const f = fixture()
  const object = f.model.def.objects[0]
  const record = f.model.rowAt(1)
  assert.equal(sameDwColumn(f.model, object, 0, 1, record, false), true)
  // the Customer form's run-time Modify() rebuilds this array; the column is
  // still the same and the open editor must be allowed to commit
  f.model.def.objects.splice(0, 1, { ...object })
  assert.equal(sameDwColumn(f.model, object, 0, 1, record, false), true)
  // a removed column, a replaced row or a different multiline mode still fails
  f.model.def.objects.splice(0, 1)
  assert.equal(sameDwColumn(f.model, object, 0, 1, record, false), false)
})

test('missing records and columns cannot produce a successful no-op write', async () => {
  const f = fixture()
  await assert.rejects(commitDwValue(f.ctl, f.model, 2, 0, f.model.def.objects[0], '12'), /record or layout changed/)
  await assert.rejects(commitDwValue(f.ctl, f.model, 1, -1, { type: 'column', name: 'missing', band: 'detail' }, '12'), /record or layout changed/)
  assert.deepEqual(f.events, [])
  assert.equal(f.changed(), 0)
})

for (const stage of ['itemchanged', 'numeric-itemerror', 'validation-itemerror']) {
  test(`commit guard prevents stale writes after ${stage}`, async () => {
    const f = fixture('long', stage === 'validation-itemerror' ? 'number(gettext()) > 20' : '')
    f.responses(0, 3)
    let valid = true
    const fire = f.ctl.rt.fire
    f.ctl.rt.fire = async (target, event, args) => {
      const result = await fire(target, event, args)
      if (event === (stage === 'itemchanged' ? 'itemchanged' : 'itemerror')) valid = false
      return result
    }

    await assert.rejects(commitDwValue(f.ctl, f.model, 1, 0, f.model.def.objects[0],
      stage === 'numeric-itemerror' ? 'invalid' : '12',
      () => { if (!valid) throw new Error('Record replaced during validation') }), /Record replaced/)
    assert.equal(f.model.getItem(1, 1), 7)
    assert.equal(f.changed(), 0)
  })
}
