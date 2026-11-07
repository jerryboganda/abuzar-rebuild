import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Runtime, Ref } from '../src/runtime/interp.ts'
import { registerSysFuncs } from '../src/runtime/sysfuncs.ts'
import { NControl } from '../src/runtime/native/controls.ts'
import { NDwBase } from '../src/runtime/native/dwctrl.ts'
import { DwModel } from '../src/dw/model.ts'
import { PBObject } from '../src/runtime/object.ts'
import { dateOrder, PBDate, PBDateTime, PBTime, setDateOrder } from '../src/runtime/values.ts'
import { parseScriptFile } from '../src/pbscript/parser.ts'

const scriptRoot = resolve(import.meta.dirname, '..', '..', 'data', 'src', 'scripts')

function routine(library: string, file: string, owner: string, name: string) {
  const path = resolve(scriptRoot, library, file)
  const { file: parsed, errors } = parseScriptFile(readFileSync(path, 'utf8'))
  assert.deepEqual(errors, [], path)
  const found = parsed.routines.find((item) => item.owner === owner && item.name === name)
  assert.ok(found, `missing routine ${owner}.${name} in ${file}`)
  return { r: found, idx: 0 }
}

function runtime() {
  const rt = new Runtime({ load: async () => undefined })
  registerSysFuncs(rt)
  const message = new PBObject(rt, 'message', 'message')
  message.declare('stringparm', 'string')
  message.declare('returnvalue', 'long')
  rt.globals.set('message', message)
  return { rt, message }
}

function calendarOpener(rt: Runtime, message: PBObject, selected: () => string, inputs: string[]) {
  rt.sys.set('openwithparm', {
    refs: [0],
    fn: async (_rt, args) => {
      inputs.push(String(args[1] ?? ''))
      message.pbSet('stringparm', selected())
      return 1
    },
  })
  message.pbSet('returnvalue', 7)
}

function editmask(rt: Runtime, text: string) {
  const control = new NControl(rt, 'synthetic_editmask', 'editmask')
  control.props.set('text', text)
  return control
}

test('f_getdatefromcalendar preserves the selected and cancelled reference text', async () => {
  const { rt, message } = runtime()
  const inputs: string[] = []
  let selected = '29/02/2024'
  calendarOpener(rt, message, () => selected, inputs)
  const entry = routine('functions', 'f_getdatefromcalendar.pbs', 'f_getdatefromcalendar', 'f_getdatefromcalendar')
  const self = new PBObject(rt, 'f_getdatefromcalendar', 'function_object')
  let value = '31/03/2024 21:22:23'
  assert.equal(await rt.runEntry(self, entry, [new Ref(() => value, (next) => { value = String(next ?? '') })], null), 0)
  assert.equal(value, '29/02/2024')
  selected = ''
  value = '31/03/2024'
  assert.equal(await rt.runEntry(self, entry, [new Ref(() => value, (next) => { value = String(next ?? '') })], null), 0)
  assert.equal(value, '')
  assert.deepEqual(inputs, ['31/03/2024', '31/03/2024'])
  assert.deepEqual([...rt.missing], [])
})

test('aging and list argument F4 handlers preserve each field mask, clock and cancellation', async () => {
  const { rt, message } = runtime()
  const inputs: string[] = []
  let selected = '29/02/2024'
  calendarOpener(rt, message, () => selected, inputs)
  for (const [library, file, owner, name, text, expected] of [
    ['reports', 'w_arg_agingbased_epi.pbs', 'em_agingdate', 'ue_keydown', '31/03/2024 21:22:23', '29/02/2024 21:22:23'],
    ['reports', 'w_listarguments.pbs', 'em_startdate', 'keydown', '31/03/2024 08:09:10', '29/02/2024 08:09:10'],
    ['reports', 'w_listarguments.pbs', 'em_enddate', 'keydown', '31/03/2024 08:09:10', '29/02/2024 08:09:10'],
  ] as const) {
    const entry = routine(library, file, owner, name)
    const control = editmask(rt, text)
    assert.equal(await rt.runEntry(control, entry, ['keyf4!', 0]), 7, `${owner} preserves the source return value`)
    assert.equal(control.props.get('text'), expected, `${owner} keeps its existing clock`)
    selected = ''
    const before = control.props.get('text')
    assert.equal(await rt.runEntry(control, entry, ['keyf4!', 0]), 7)
    assert.equal(control.props.get('text'), before, `${owner} cancellation does not overwrite the field`)
    selected = '29/02/2024'
  }
  assert.deepEqual(inputs, ['31/03/2024', '29/02/2024', '31/03/2024', '29/02/2024', '31/03/2024', '29/02/2024'])
  assert.deepEqual([...rt.missing], [])
})

function deliveryControl(rt: Runtime, original: PBDateTime) {
  const model = new DwModel(rt, 'synthetic_delivery', {
    datawindow: { processing: '1' },
    bands: { detail: { height: '100' } },
    table: { columns: [{ name: 'deliverydate', type: 'datetime' }] },
    objects: [{ name: 'deliverydate', type: 'column', id: '1', band: 'detail', tabsequence: '10' }],
  })
  model.insertRow(0)
  model.row = 1
  model.col = 1
  model.setItem(1, 'deliverydate', original)
  const control = new NDwBase(rt, 'datawindow', 'datawindow')
  control.attach(model)
  const one = new NControl(rt, 'synthetic_one', 'userobject')
  const two = new NControl(rt, 'synthetic_two', 'userobject')
  const three = new PBObject(rt, 'synthetic_three', 'userobject')
  control.parent = one
  one.parent = two
  two.parent = three
  three.pbSet('is_columnitemname', 'itemname')
  return { model, control }
}

test('inpatient and service DataWindow F4 handlers preserve exact clocks in both callers', async () => {
  const previousOrder = dateOrder
  try {
    setDateOrder('mdy')
    const { rt, message } = runtime()
    const inputs: string[] = []
    let selected = '02/29/2024'
    calendarOpener(rt, message, () => selected, inputs)
    const original = new PBDateTime(PBDate.ymd(2024, 3, 31).n, PBTime.hms(21, 22, 23, 125).ms)
    for (const [library, file] of [['ipservices', 'w_inpatientservice.pbs'], ['servicesalescomp', 'w_service.pbs']] as const) {
      const entry = routine(library, file, 'dw_itemsdetail', 'ue_dwnkey')
      const { model, control } = deliveryControl(rt, original)
      assert.equal(await rt.runEntry(control, entry, ['keyf4!', 0]), 0)
      assert.deepEqual(model.getItem(1, 'deliverydate'),
        new PBDateTime(PBDate.ymd(2024, 2, 29).n, PBTime.hms(21, 22, 23).ms),
        `${file} keeps the source's second-precision clock`)
      selected = ''
      const before = model.getItem(1, 'deliverydate')
      assert.equal(await rt.runEntry(control, entry, ['keyf4!', 0]), 0)
      assert.deepEqual(model.getItem(1, 'deliverydate'), before, `${file} cancellation preserves the stored value`)
      selected = '02/29/2024'
      control.destroy()
    }
    assert.equal(inputs.length, 4)
    assert.deepEqual([...rt.missing], [])
  } finally {
    setDateOrder(previousOrder)
  }
})
