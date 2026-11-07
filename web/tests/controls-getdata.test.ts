import test from 'node:test'
import assert from 'node:assert/strict'
import { Runtime, Ref } from '../src/runtime/interp.ts'
import { NControl } from '../src/runtime/native/controls.ts'
import { PBDate, PBDateTime, PBTime, dateOrder, setDateOrder } from '../src/runtime/values.ts'

test('native datetime GetData uses the declared numeric mask, not regional order or the receiving placeholder', async () => {
  const control = new NControl(new Runtime({ load: async () => undefined }), 'editmask', 'editmask')
  control.pbSet('maskdatatype', 5)
  const previous = dateOrder
  try {
    for (const regional of ['mdy', 'dmy'] as const) {
      setDateOrder(regional)
      for (const [mask, text] of [
        ['dd/mm/yyyy hh:mm:ss', '04/05/2024 21:22:23'],
        ['mm/dd/yyyy hh:mm:ss', '05/04/2024 21:22:23'],
        ['yyyy-mm-dd hh:mm:ss', '2024-05-04 21:22:23'],
      ]) {
        control.pbSet('mask', mask); control.pbSet('text', text)
        let value: unknown = 0
        assert.equal(await control.n_getdata(new Ref(() => value, (next) => { value = next })), 1)
        assert.deepEqual(value, new PBDateTime(PBDate.ymd(2024, 5, 4).n, PBTime.hms(21, 22, 23).ms))
        assert.equal(control.pbGet('text'), text)
        assert.equal(control.props.has('_invaliddata'), false)
      }
    }
  } finally { setDateOrder(previous) }
})

test('native datetime GetData rejects impossible dates and clocks without overwriting the receiving value or draft', async () => {
  const control = new NControl(new Runtime({ load: async () => undefined }), 'editmask', 'editmask')
  control.pbSet('maskdatatype', 5)
  control.pbSet('mask', 'dd/mm/yyyy hh:mm:ss')
  const original = new PBDateTime(PBDate.ymd(2024, 5, 4).n, 0)
  let value: unknown = original
  const ref = new Ref(() => value, (next) => { value = next })
  for (const text of ['', 'not a date', '30/02/2024', '29/02/2023', '31/04/2024', '04/13/2024',
    '04/05/2024 24:00:00', '04/05/2024 21:60:00', '04/05/2024 21:22:60', '04/05/2024 trailing']) {
    control.pbSet('text', text)
    assert.equal(await control.n_getdata(ref), -1, text)
    assert.equal(value, original, text)
    assert.equal(control.pbGet('text'), text)
    assert.equal(control.pbGet('_invaliddata'), true)
  }
  control.pbSet('text', '29/02/2024 21:22:23')
  assert.equal(await control.n_getdata(ref), 1)
  assert.deepEqual(value, new PBDateTime(PBDate.ymd(2024, 2, 29).n, PBTime.hms(21, 22, 23).ms))
  assert.equal(control.props.has('_invaliddata'), false)
})

test('date-only masks retain the source datetime result with midnight and support leap years', async () => {
  const control = new NControl(new Runtime({ load: async () => undefined }), 'editmask', 'editmask')
  control.pbSet('maskdatatype', 5)
  control.pbSet('mask', 'dd/mm/yyyy')
  control.pbSet('text', '29/02/2024')
  let value: unknown = 0
  assert.equal(await control.n_getdata(new Ref(() => value, (next) => { value = next })), 1)
  assert.deepEqual(value, new PBDateTime(PBDate.ymd(2024, 2, 29).n, 0))
  assert.equal(await control.n_getdata(), -1)
})

test('unrelated native text and numeric GetData conversions keep their existing behavior', async () => {
  const control = new NControl(new Runtime({ load: async () => undefined }), 'editmask', 'editmask')
  let value: unknown = 0
  const ref = new Ref(() => value, (next) => { value = next })
  control.pbSet('text', '1,250.5')
  assert.equal(await control.n_getdata(ref), 1)
  assert.equal(value, 1250.5)
  value = ''
  control.pbSet('text', 'Synthetic text')
  assert.equal(await control.n_getdata(ref), 1)
  assert.equal(value, 'Synthetic text')
  control.pbSet('maskdatatype', 5)
  control.pbSet('mask', 'dd/mm/yyyy')
  assert.equal(await control.n_getdata(ref), -1)
  control.pbSet('maskdatatype', 1)
  control.pbSet('mask', '@@@@@@@@@@@@@@')
  assert.equal(await control.n_getdata(ref), 1)
  assert.equal(value, 'Synthetic text')
  assert.equal(control.props.has('_invaliddata'), false, 'A successful changed mask clears an earlier date error')
})
