import test from 'node:test'
import assert from 'node:assert/strict'
import { Runtime } from '../src/runtime/interp.ts'
import { NDwBase } from '../src/runtime/native/dwctrl.ts'
import { DwModel } from '../src/dw/model.ts'
import type { DwDef } from '../src/dw/def.ts'

function fixture(native = 'datawindow') {
  const rt = new Runtime({ load: async () => undefined })
  const control = new NDwBase(rt, 'dw_synthetic_text', native)
  const definition: DwDef = {
    datawindow: {}, bands: {}, objects: [],
    table: { columns: [{ name: 'name', type: 'char(40)' }, { name: 'code', type: 'long' }] },
  }
  const model = new DwModel(rt, 'd_synthetic_text', definition)
  model.insertRow(0)
  model.setItem(1, 'name', 'Stored first row')
  model.setItem(1, 'code', 10)
  model.insertRow(0)
  model.setItem(2, 'name', 'Stored second row')
  model.row = 1
  model.col = 1
  control.attach(model)
  let text = 'Unaccepted draft'
  const release = control.bindTextEditor(model, 1, 'name', {
    read: () => text, write: (value) => { text = value },
  })
  return { control, model, release, text: () => text, rt, definition }
}

test('GetText reads the live edit control rather than the stored item', async () => {
  const f = fixture()
  assert.equal(await f.control.n_gettext(), 'Unaccepted draft')
  assert.equal(f.model.getItem(1, 'name'), 'Stored first row')
})

test('SetText changes only the active draft, including empty text', async () => {
  const f = fixture()
  let changes = 0
  f.control.listeners.add(() => { changes++ })
  assert.equal(await f.control.n_settext('Script replacement'), 1)
  assert.equal(await f.control.n_gettext(), 'Script replacement')
  assert.equal(f.text(), 'Script replacement')
  assert.equal(f.model.getItem(1, 'name'), 'Stored first row')
  assert.equal(await f.control.n_settext(''), 1)
  assert.equal(f.text(), '')
  assert.equal(changes, 0)
})

test('null SetText preserves the draft and stored item', async () => {
  const f = fixture()
  assert.equal(await f.control.n_settext(null), null)
  assert.equal(f.text(), 'Unaccepted draft')
  assert.equal(f.model.getItem(1, 'name'), 'Stored first row')
})

for (const mounted of [true, false]) {
  test(`SetText applies Edit.Case with ${mounted ? 'a mounted editor' : 'a script draft'} without editing the buffer`, async () => {
    const f = fixture()
    if (!mounted) f.release()
    f.model.modify("name.edit.case='upper'")
    const events: string[] = []
    f.rt.fire = async (_object, event) => { events.push(event); return 0 }
    assert.equal(await f.control.n_settext('Mixed text'), 1)
    assert.equal(await f.control.n_gettext(), 'MIXED TEXT')
    assert.equal(f.model.getItem(1, 'name'), 'Stored first row')
    assert.deepEqual(events, [])
    f.model.modify("name.edit.case='lower'")
    assert.equal(await f.control.n_settext('RePLACED'), 1)
    assert.equal(await f.control.n_gettext(), 'replaced')
    if (!mounted) {
      assert.equal(await f.control.n_accepttext(), 1)
      assert.equal(f.model.getItem(1, 'name'), 'replaced')
      assert.deepEqual(events, ['itemchanged'])
    }
  })
}

test('a case change before script acceptance keeps GetText and event data consistent', async () => {
  const f = fixture('datastore')
  f.release()
  await f.control.n_settext('Mixed draft')
  f.model.modify("name.edit.case='upper'")
  f.rt.fire = async (_object, event, args = []) => {
    assert.equal(event, 'itemchanged')
    assert.equal(args[2], 'MIXED DRAFT')
    assert.equal(await f.control.n_gettext(), args[2])
    return 0
  }
  assert.equal(await f.control.n_accepttext(), 1)
  assert.equal(f.model.getItem(1, 'name'), 'MIXED DRAFT')
})

test('text editor ownership follows record, column and model identity', async () => {
  const f = fixture()
  f.model.col = 2
  assert.equal(await f.control.n_gettext(), '10')
  f.model.col = 1
  f.model.row = 2
  assert.equal(await f.control.n_gettext(), 'Stored second row')
  f.model.row = 1
  assert.equal(await f.control.n_gettext(), 'Unaccepted draft')
  const replacement = new DwModel(f.rt, 'd_replacement', f.definition)
  replacement.insertRow(0)
  replacement.setItem(1, 'name', 'Replacement record')
  replacement.row = 1
  replacement.col = 1
  f.control.attach(replacement)
  assert.equal(await f.control.n_gettext(), 'Replacement record')
})

test('releasing an old editor cannot detach its replacement', async () => {
  const f = fixture()
  const release = f.control.bindTextEditor(f.model, 1, 'name', {
    read: () => 'Replacement editor', write: () => { throw new Error('Unexpected write') },
  })
  f.release()
  assert.equal(await f.control.n_gettext(), 'Replacement editor')
  release()
  assert.equal(await f.control.n_gettext(), 'Stored first row')
})

test('an editor cannot expose a removed record or a destroyed control draft', async () => {
  const f = fixture()
  f.model.deleteRow(1)
  f.model.row = 1
  assert.equal(await f.control.n_gettext(), 'Stored second row')
  const g = fixture()
  g.control.destroy()
  assert.notEqual(await g.control.n_gettext(), 'Unaccepted draft')
})

for (const native of ['datawindow', 'datastore', 'datawindowchild']) {
  test(`${native} SetText without a mounted editor changes only the draft until AcceptText`, async () => {
    const f = fixture(native)
    f.release()
    f.model.resetUpdate()
    const events: string[] = []
    f.rt.fire = async (_object, event) => { events.push(event); return 0 }
    assert.equal(await f.control.n_settext('Script draft'), 1)
    assert.equal(await f.control.n_settext(null), null)
    assert.equal(await f.control.n_gettext(), 'Script draft')
    assert.equal(f.model.getItem(1, 'name'), 'Stored first row')
    assert.equal(await f.control.n_modifiedcount(), 0)
    assert.deepEqual(events, [])
    assert.equal(await f.control.n_accepttext(), 1)
    assert.equal(f.model.getItem(1, 'name'), 'Script draft')
    assert.equal(await f.control.n_modifiedcount(), 1)
    assert.deepEqual(events, ['itemchanged'])
    assert.equal(await f.control.n_accepttext(), 1)
    assert.deepEqual(events, ['itemchanged'], 'Already accepted text is not validated a second time')
  })
}

test('a script rejection preserves both SetItem correction and replacement edit text', async () => {
  const f = fixture('datastore')
  f.release()
  const events: string[] = []
  f.rt.fire = async (_object, event) => {
    events.push(event)
    if (event === 'itemchanged') {
      await f.control.n_setitem(1, 'name', 'Buffer correction')
      await f.control.n_settext('Editable correction')
    }
    return 1
  }
  await f.control.n_settext('Rejected draft')
  assert.equal(await f.control.n_accepttext(), -1)
  assert.equal(f.model.getItem(1, 'name'), 'Buffer correction')
  assert.equal(await f.control.n_gettext(), 'Editable correction')
  assert.deepEqual(events, ['itemchanged', 'itemerror'])
})

test('script numeric validation runs before ItemChanged and retains invalid text', async () => {
  const f = fixture('datastore')
  f.release()
  await f.control.n_setcolumn('code')
  const events: string[] = []
  f.rt.fire = async (_object, event) => { events.push(event); return event === 'itemerror' ? 1 : 0 }
  await f.control.n_settext('Not numeric')
  assert.equal(await f.control.n_accepttext(), -1)
  assert.equal(await f.control.n_gettext(), 'Not numeric')
  assert.equal(f.model.getItem(1, 'code'), 10)
  assert.deepEqual(events, ['itemerror'])
  await f.control.n_settext('42')
  assert.equal(await f.control.n_accepttext(), 1)
  assert.equal(f.model.getItem(1, 'code'), 42)
  assert.deepEqual(events, ['itemerror', 'itemchanged'])
})

for (const action of ['row', 'column', 'scroll'] as const) {
  test(`script ${action} navigation cannot abandon rejected text`, async () => {
    const f = fixture('datastore')
    f.release()
    f.rt.fire = async () => 1
    await f.control.n_settext('Rejected draft')
    const navigate = () => action === 'row' ? f.control.n_setrow(2) :
      action === 'column' ? f.control.n_setcolumn(2) : f.control.n_scrolltorow(2)
    assert.equal(await navigate(), -1)
    assert.equal(f.model.row, 1)
    assert.equal(f.model.col, 1)
    assert.equal(await f.control.n_gettext(), 'Rejected draft')
    f.rt.fire = async () => 0
    assert.equal(await navigate(), action === 'scroll' ? 2 : 1)
    assert.equal(f.model.getItem(1, 'name'), 'Rejected draft')
    assert.equal(f.model.row, action === 'column' ? 1 : 2)
    assert.equal(f.model.col, action === 'column' ? 2 : 1)
  })
}

test('discarding script text permits navigation but never reports native acceptance', async () => {
  const f = fixture('datastore')
  f.release()
  f.rt.fire = async () => 2
  await f.control.n_settext('Discarded draft')
  assert.equal(await f.control.n_accepttext(), -1)
  assert.equal(await f.control.n_gettext(), 'Stored first row')
  assert.equal(f.model.getItem(1, 'name'), 'Stored first row')
  await f.control.n_settext('Another discarded draft')
  assert.equal(await f.control.n_setcolumn(2), 1)
  assert.equal(f.model.col, 2)
  assert.equal(f.model.getItem(1, 'name'), 'Stored first row')
})

test('script navigation does not overwrite source-directed row correction', async () => {
  const f = fixture('datastore')
  f.release()
  f.rt.fire = async () => { f.model.row = 2; return 0 }
  await f.control.n_settext('Accepted first row')
  assert.equal(await f.control.n_setcolumn(2), -1)
  assert.equal(f.model.row, 2)
  assert.equal(f.model.col, 1)
  assert.equal(f.model.getItem(1, 'name'), 'Accepted first row')
})

test('mounting an editor transfers an unaccepted script draft without a buffer write', async () => {
  const f = fixture()
  f.release()
  await f.control.n_settext('Draft before focus')
  let text = 'Stored first row'
  const release = f.control.bindTextEditor(f.model, 1, 'name', {
    read: () => text, write: (value) => { text = value },
  })
  assert.equal(text, 'Draft before focus')
  assert.equal(await f.control.n_gettext(), 'Draft before focus')
  assert.equal(f.model.getItem(1, 'name'), 'Stored first row')
  await f.control.n_settext('Mounted draft')
  assert.equal(text, 'Mounted draft')
  assert.equal(f.model.getItem(1, 'name'), 'Stored first row')
  release()
})

test('script drafts cannot enter a missing current row or column', async () => {
  const f = fixture('datastore')
  f.release()
  for (const [row, column] of [[0, 1], [3, 1], [1, 0], [1, 3]]) {
    f.model.row = row
    f.model.col = column
    assert.equal(await f.control.n_settext('Invalid target'), -1)
    assert.equal(await f.control.n_gettext(), '')
  }
  assert.equal(f.model.getItem(1, 'name'), 'Stored first row')
})

test('Reset, DeleteRow, layout replacement and destruction invalidate the corresponding script draft', async () => {
  for (const action of ['reset', 'delete', 'replace', 'destroy'] as const) {
    const f = fixture('datastore')
    f.release()
    await f.control.n_settext('Obsolete draft')
    if (action === 'reset') await f.control.n_reset()
    else if (action === 'delete') await f.control.n_deleterow(1)
    else if (action === 'replace') f.control.attach(new DwModel(f.rt, 'd_replacement', f.definition))
    else f.control.destroy()
    assert.notEqual(await f.control.n_gettext(), 'Obsolete draft')
    assert.equal(await f.model.acceptText(), 1)
    if (action === 'replace' || action === 'destroy') assert.equal(f.model.acceptScriptText, null)
  }
})

test('an unrelated concurrent AcceptText cannot reuse a pending script validation', async () => {
  const f = fixture('datastore')
  f.release()
  let begin!: () => void
  let finish!: () => void
  const started = new Promise<void>((resolve) => { begin = resolve })
  const waiting = new Promise<void>((resolve) => { finish = resolve })
  let changed = 0
  f.rt.fire = async (_object, event) => {
    if (event === 'itemchanged') { changed++; begin(); await waiting }
    return 0
  }
  await f.control.n_settext('Pending draft')
  const accepting = f.control.n_accepttext()
  await started
  assert.equal(await f.control.n_accepttext(), -1)
  assert.equal(f.model.getItem(1, 'name'), 'Stored first row')
  finish()
  assert.equal(await accepting, 1)
  assert.equal(changed, 1)
  assert.equal(f.model.getItem(1, 'name'), 'Pending draft')
})

test('a layout replaced during script validation cannot receive the old draft', async () => {
  const f = fixture('datastore')
  f.release()
  let begin!: () => void
  let finish!: () => void
  const started = new Promise<void>((resolve) => { begin = resolve })
  const waiting = new Promise<void>((resolve) => { finish = resolve })
  f.rt.fire = async () => { begin(); await waiting; return 0 }
  await f.control.n_settext('Obsolete draft')
  const accepting = assert.rejects(f.control.n_accepttext(), /original record/)
  await started
  const replacement = new DwModel(f.rt, 'd_replacement', f.definition)
  replacement.insertRow(0)
  replacement.setItem(1, 'name', 'Replacement record')
  f.control.attach(replacement)
  finish()
  await accepting
  assert.equal(f.model.getItem(1, 'name'), 'Stored first row')
  assert.equal(replacement.getItem(1, 'name'), 'Replacement record')
})
