import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Runtime, Ref, Frame } from '../src/runtime/interp.ts'
import { registerSysFuncs } from '../src/runtime/sysfuncs.ts'
import { registerWindowing } from '../src/runtime/native/windowing.ts'
import { NCalendar, CALENDAR_MIN, CALENDAR_MAX, calendarMonth, calendarWeekNumber, calendarWeekStart } from '../src/runtime/native/calendar.ts'
import { PBObject, type ClassDef } from '../src/runtime/object.ts'
import { PBDate, PBDateTime, PBTime, dateOrder, setDateOrder } from '../src/runtime/values.ts'
import { NDwBase } from '../src/runtime/native/dwctrl.ts'
import { DwModel } from '../src/dw/model.ts'
import { parseScriptFile } from '../src/pbscript/parser.ts'
import type { Routine } from '../src/pbscript/ast.ts'
import { fixClassData } from '../src/runtime/class-fixes.ts'
import { CALENDAR_WINDOW_SURFACES, windowSurfaceIssues } from '../src/ui/window-surfaces.ts'

function source(name: string) {
  const library = name === 'w_arguements' ? 'reports' : name === 'w_customercomments' ? 'custcomponents' : 'components'
  const kind = name === 'u_dwstandard' ? 'userobject' : 'window'
  const root = resolve(import.meta.dirname, '..', '..', 'data', 'src')
  const definition: ClassDef = JSON.parse(readFileSync(resolve(root, 'objects', library, kind, name + '.json'), 'utf8'))
  const { file, errors } = parseScriptFile(readFileSync(resolve(root, 'scripts', library, name + '.pbs'), 'utf8'))
  assert.deepEqual(errors, [])
  const routines: Record<string, Record<string, Routine[]>> = {}
  for (const routine of file.routines) ((routines[routine.owner] ??= {})[routine.name] ??= []).push(routine)
  return { ...definition, routines }
}

function runtime() {
  const rt = new Runtime({ load: async (name) => {
    if (!['w_calendar', 'w_calendar2', 'w_arguements', 'u_dwstandard'].includes(name)) return undefined
    const data = source(name)
    fixClassData(name, data)
    return { ...data, routines: new Map(Object.entries(data.routines).map(([owner, routines]) =>
      [owner, new Map(Object.entries(routines))])) }
  } })
  registerSysFuncs(rt)
  registerWindowing(rt)
  const message = new PBObject(rt, 'message', 'message')
  message.declare('stringparm', 'string')
  message.declare('returnvalue', 'long')
  rt.globals.set('message', message)
  return rt
}

for (const name of ['w_calendar', 'w_calendar2']) test(`${name}: native registration and complete source layout retain the original three controls`, async () => {
  const rt = runtime(), window = await rt.instantiate(name)
  assert.ok(window.children.get('mc_calendar') instanceof NCalendar)
  const surface = CALENDAR_WINDOW_SURFACES.find((surface) => surface.name === name)!
  const controls = [...window.children.values()].map((control) => ({ name: control.name, native: control.native }))
  assert.deepEqual(windowSurfaceIssues(controls, surface), [])
  assert.ok(windowSurfaceIssues(controls, { ...surface, calendars: [] }).includes('Unmapped control: mc_calendar'))
  assert.ok(windowSurfaceIssues(controls, { ...surface, calendars: ['mc_calendar', 'mc_calendar'] }).includes('Duplicate binding: mc_calendar'))
  assert.ok(windowSurfaceIssues(controls, { ...surface, calendars: ['cb_ok'] }).includes('Unsupported control: cb_ok'))
  const calendar = window.children.get('mc_calendar')!
  for (const property of ['todaysection', 'todaycircle', 'weeknumbers', 'autosize']) assert.equal(calendar.pbGet(property), true)
  assert.notEqual(calendar.pbGet('multiselect'), true)
  assert.equal(calendar.pbGet('maxselectcount'), 31, 'A maximum count does not itself enable range selection')
  window.destroy()
})

test('SetSelectedDate triggers DateChanged and GetSelectedDate writes a detached date through Ref', async () => {
  const rt = runtime(), calendar = await rt.instantiate('monthcalendar') as NCalendar
  const events: string[] = []
  rt.fire = async (_control, event) => { events.push(event); return 0 }
  assert.equal(await rt.callMethod(calendar, 'setselecteddate', [PBDate.ymd(2024, 2, 29)]), 0)
  let date: unknown = null
  assert.equal(await rt.callMethod(calendar, 'getselecteddate', [new Ref(() => date, (value) => { date = value })]), 0)
  assert.deepEqual(date, PBDate.ymd(2024, 2, 29))
  assert.ok(date instanceof PBDate)
  date.n++
  assert.deepEqual(calendar.selectedDate, PBDate.ymd(2024, 2, 29))
  assert.equal(await calendar.n_setselecteddate(new PBDateTime(PBDate.ymd(2024, 2, 29).n, 12345)), 0)
  assert.deepEqual(events, ['datechanged', 'datechanged'])
  assert.deepEqual([...rt.missing], [])
})

test('invalid calendar selections preserve value and never raise a successful DateChanged event', async () => {
  const rt = runtime(), calendar = new NCalendar(rt, 'monthcalendar')
  await calendar.n_setselecteddate(PBDate.ymd(2024, 1, 31))
  const events: string[] = []
  rt.fire = async (_control, event) => { events.push(event); return 0 }
  for (const invalid of [null, '2024-01-31', 0, new PBDate(NaN), new PBDate(Infinity), new PBDate(0.5),
    new PBDate(CALENDAR_MIN - 1), new PBDate(CALENDAR_MAX + 1)]) {
    assert.equal(await calendar.n_setselecteddate(invalid), -1)
    assert.deepEqual(calendar.selectedDate, PBDate.ymd(2024, 1, 31))
  }
  assert.deepEqual(events, [])
  assert.equal(await calendar.n_getselecteddate(null), -2)
  for (const edge of [CALENDAR_MIN, CALENDAR_MAX]) assert.equal(await calendar.n_setselecteddate(new PBDate(edge)), 0)
})

test('SetToday changes only the marker and returns documented status codes', async () => {
  const calendar = new NCalendar(runtime(), 'monthcalendar')
  const selected = calendar.selectedDate, today = PBDate.ymd(2030, 3, 10)
  const events: string[] = []
  calendar.rt.fire = async (_control, event) => { events.push(event); return 0 }
  assert.equal(calendar.n_settoday(today), 0)
  assert.deepEqual(calendar.n_gettoday(), today)
  today.n++
  assert.deepEqual(calendar.today, PBDate.ymd(2030, 3, 10))
  assert.deepEqual(calendar.selectedDate, selected)
  assert.equal(calendar.n_settoday(null), -1)
  assert.deepEqual(calendar.today, PBDate.ymd(2030, 3, 10))
  assert.deepEqual(events, [])
})

test('both receiver forms pass native output references rather than their old values', async () => {
  const rt = runtime(), window = await rt.instantiate('w_calendar'), calendar = window.children.get('mc_calendar')!
  const frame = new Frame(calendar, null, 0)
  const output = { k: 'mem' as const, o: { k: 'id' as const, n: 'parent' }, n: 'id_date' }
  for (const receiver of [null, { k: 'id' as const, n: 'this' }]) {
    window.pbSet('id_date', null)
    assert.equal(await rt.evalCall({ k: 'call', o: receiver, n: 'getselecteddate', a: [output] }, frame), 0)
    assert.ok(window.pbGet('id_date') instanceof PBDate)
  }
  window.destroy()
})

for (const regional of ['mdy', 'dmy'] as const) {
  test(`original calendar Open and DateChanged initialize selected date with ${regional} return formatting`, async () => {
    const before = dateOrder
    try {
      setDateOrder(regional)
      const rt = runtime(), window = await rt.instantiate('w_calendar')
      rt.globals.get('message')!.pbSet('stringparm', '31/03/2024')
      await rt.fire(window, 'open')
      assert.deepEqual(window.pbGet('id_date'), PBDate.ymd(2024, 3, 31))
      assert.equal(window.pbGet('is_date'), regional === 'mdy' ? '3/31/2024' : '31/03/2024')
      assert.equal(rt.globals.get('message')!.pbGet('stringparm'), '', 'Opening leaves a fresh cancellation channel')
      assert.deepEqual([...rt.missing], [])
      window.destroy()
    } finally { setDateOrder(before) }
  })

  test(`original criteria F4 retains its mask and clock independently of ${regional} calendar output`, async () => {
    const before = dateOrder
    try {
      setDateOrder(regional)
      const rt = runtime(), window = await rt.instantiate('w_arguements')
      const inputs: unknown[] = []
      rt.sys.set('openwithparm', { refs: [0], fn: async (_r, args) => {
        inputs.push(args[1])
        rt.globals.get('message')!.pbSet('stringparm', regional === 'mdy' ? '2/29/2024' : '29/02/2024')
        return 1
      } })
      for (const name of ['em_startdate', 'em_enddate']) for (const timed of [true, false]) {
        const field = window.children.get(name)!
        field.pbSet('mask', timed ? 'dd/mm/yyyy hh:mm:ss' : 'dd/mm/yyyy')
        field.pbSet('text', timed ? '31/03/2024 21:22:23' : '31/03/2024')
        await rt.fire(field, 'keydown', ['keyf4!', 0])
        assert.equal(field.pbGet('text'), timed ? '29/02/2024 21:22:23' : '29/02/2024')
      }
      assert.deepEqual(inputs, Array(4).fill('31/03/2024'))
      window.destroy()
    } finally { setDateOrder(before) }
  })
}

test('empty calendar input selects the displayed today rather than returning malformed text', async () => {
  const rt = runtime(), window = await rt.instantiate('w_calendar')
  await rt.fire(window, 'open')
  const calendar = window.children.get('mc_calendar') as NCalendar
  assert.deepEqual(window.pbGet('id_date'), calendar.today)
  assert.deepEqual(calendar.selectedDate, calendar.today)
  assert.match(String(window.pbGet('is_date')), /\d/)
  window.destroy()
})

test('calendar and criteria corrections are idempotent and do not rewrite acceptance or cancellation scripts', () => {
  for (const name of ['w_calendar', 'w_calendar2', 'w_arguements']) {
    const data = source(name), original = structuredClone(data)
    assert.equal(fixClassData(name, data).length, name === 'w_arguements' ? 2 : 3)
    assert.deepEqual(fixClassData(name, data), [])
    for (const owner of ['cb_ok', 'cb_cancel']) assert.deepEqual(data.routines[owner], original.routines[owner])
    if (name !== 'w_arguements') for (const event of ['ue_close', 'create', 'destroy']) {
      assert.deepEqual(data.routines[name][event], original.routines[name][event])
    }
  }
})

for (const regional of ['mdy', 'dmy'] as const) test(`ISO calendar preserves original selection and Cancel in ${regional}`, async () => {
  const before = dateOrder
  try {
    setDateOrder(regional)
    for (const accept of [true, false]) {
      const rt = runtime(), window = await rt.instantiate('w_calendar2')
      rt.globals.get('message')!.pbSet('stringparm', '2024-03-31')
      let returned: unknown
      rt.sys.set('closewithreturn', { fn: async (_rt, args) => { returned = args[1]; return 1 } })
      await rt.fire(window, 'open')
      assert.deepEqual(window.pbGet('id_old_date'), PBDate.ymd(2024, 3, 31))
      assert.equal(rt.globals.get('message')!.pbGet('stringparm'), '2024-03-31', 'Title-close keeps the original ISO value')
      await rt.callMethod(window.children.get('mc_calendar')!, 'setselecteddate', [PBDate.ymd(2024, 2, 29)])
      await rt.fire(window, 'ue_close', [accept ? 1 : -1])
      assert.equal(returned, accept ? '2024-02-29' : '2024-03-31')
      window.destroy()
    }
  } finally { setDateOrder(before) }
})

for (const owner of ['u_dwstandard', 'dw_itemsdetail']) test(`${owner}: source F4 validates before opening and preserves typed calendar values`, async () => {
  const rt = runtime()
  const control = await rt.instantiate('u_dwstandard')
  assert.ok(control instanceof NDwBase)
  const data = source(owner === 'u_dwstandard' ? owner : 'w_customercomments')
  assert.equal(fixClassData(owner === 'u_dwstandard' ? owner : 'w_customercomments', data).length, 4)
  assert.deepEqual(fixClassData(owner === 'u_dwstandard' ? owner : 'w_customercomments', data), [])
  const routine = data.routines[owner].ue_dwnkey[0]
  const entry = { r: routine, idx: 0 }
  const inputs: unknown[] = []
  let accept = 1, focused = 0, selected = '2024-02-29'
  rt.ui = { focusDw: async () => { focused++; return true } }
  rt.sys.set('openwithparm', { refs: [0], fn: async (_rt, args) => {
    inputs.push(args[1])
    rt.globals.get('message')!.pbSet('stringparm', selected)
    return 1
  } })
  for (const type of ['date', 'datetime']) for (const empty of [false, true]) {
    const model = new DwModel(rt, 'synthetic_calendar_date', {
      datawindow: { processing: '1' }, bands: { detail: { height: '100' } },
      table: { columns: [{ name: 'date', type }] },
      objects: [{ name: 'date', type: 'column', id: '1', band: 'detail', tabsequence: '10' }],
    })
    model.insertRow(0); model.row = 1; model.col = 1
    const original = empty ? null : type === 'date' ? PBDate.ymd(2024, 3, 31) :
      new PBDateTime(PBDate.ymd(2024, 3, 31).n, PBTime.hms(21, 22, 23, 125).ms)
    model.setItem(1, 'date', original)
    model.acceptText = async () => accept
    control.attach(model)
    accept = -1
    const opened = inputs.length
    await rt.runEntry(control, entry, ['keyf4!', 0])
    assert.equal(inputs.length, opened, 'A rejected draft must not open a calendar against an older value')
    assert.equal(model.getItem(1, 'date'), original)
    accept = 1
    await rt.runEntry(control, entry, ['keyf4!', 0])
    assert.equal(inputs.length, opened + 1)
    assert.ok(empty ? inputs.at(-1) === '' || inputs.at(-1) === null : inputs.at(-1) === '2024-03-31')
    assert.deepEqual(model.getItem(1, 'date'), type === 'date' ? PBDate.ymd(2024, 2, 29) :
      new PBDateTime(PBDate.ymd(2024, 2, 29).n, empty ? 0 : PBTime.hms(21, 22, 23, 125).ms))
    selected = ''
    const value = model.getItem(1, 'date')
    await rt.runEntry(control, entry, ['keyf4!', 0])
    assert.equal(model.getItem(1, 'date'), value, 'Empty cancellation never overwrites the accepted value')
    selected = '2024-02-29'
  }
  assert.equal(focused, 8)
  control.destroy()
})

test('month movement clamps month ends, leap years and native date boundaries', () => {
  for (const [from, delta, to] of [
    [[2024, 3, 31], -1, [2024, 2, 29]], [[2023, 3, 31], -1, [2023, 2, 28]],
    [[2024, 2, 29], 12, [2025, 2, 28]], [[2024, 12, 31], 1, [2025, 1, 31]],
    [[1601, 1, 1], -1, [1601, 1, 1]], [[9999, 12, 31], 1, [9999, 12, 31]],
  ] as const) assert.deepEqual(calendarMonth(PBDate.ymd(...from), delta), PBDate.ymd(...to))
})

test('calendar week numbers use the four-day first-week rule with the declared first weekday', () => {
  for (const [ymd, firstDay, expected] of [
    [[2021, 1, 1], 1, 53], [[2021, 1, 4], 1, 1], [[2024, 12, 30], 1, 1],
    [[2021, 1, 1], 0, 53], [[2021, 1, 3], 0, 1],
  ] as const) assert.equal(calendarWeekNumber(PBDate.ymd(...ymd), firstDay), expected)
  assert.deepEqual(calendarWeekStart(PBDate.ymd(2024, 5, 4), 1), PBDate.ymd(2024, 4, 29))
})
