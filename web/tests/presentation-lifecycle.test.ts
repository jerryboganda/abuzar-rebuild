import test from 'node:test'
import type { TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { setImmediate } from 'node:timers/promises'
import { Frame, Ref, Runtime } from '../src/runtime/interp.ts'
import type { UiHost } from '../src/runtime/interp.ts'
import type { ClassDef } from '../src/runtime/object.ts'
import { PBObject } from '../src/runtime/object.ts'
import { NWindow } from '../src/runtime/native/controls.ts'
import { registerWindowing } from '../src/runtime/native/windowing.ts'
import { parseScriptFile } from '../src/pbscript/parser.ts'
import type { Routine } from '../src/pbscript/ast.ts'

const name = 'w_presentation_fixture'
const script = `// window w_presentation_fixture (fixture) ancestor: window

// tab_steps.constructor() returns 0
f_trace("tab.constructor")

// dw_detail.constructor() returns 0
f_trace("detail.constructor")

// w_presentation_fixture.open() returns 0
f_trace("open")
dw_detail.setfocus()
postevent("ue_ready")

// w_presentation_fixture.ue_ready() returns 0
f_trace("posted")

// tab_steps.selectionchanging(long oldtab, long newtab) returns long
f_trace("tab.changing")
return 0

// tab_steps.selectionchanged(long oldtab, long newtab) returns 0
f_trace("tab.changed")

// dw_detail.getfocus() returns 0
f_trace("detail.focus")

// w_presentation_fixture.closequery() returns long
f_trace("closequery")
return il_blockclose

// w_presentation_fixture.close() returns 0
f_trace("close")

// w_presentation_fixture.timer() returns 0
f_trace("timer")
`

class RecordingHost implements UiHost {
  [key: string]: unknown
  trace: string[]
  created: { window: PBObject; options: { sheet: boolean; modal: boolean } }[] = []
  closed: { window: PBObject; isOpen: boolean; destroyed: boolean }[] = []
  activated: PBObject[] = []

  constructor(trace: string[]) { this.trace = trace }
  async messageBox(): Promise<number> { throw new Error('Unexpected message box in synthetic lifecycle fixture') }
  async openWindow(): Promise<void> { throw new Error('Runtime uses createWindow/showWindow, not legacy openWindow') }
  createWindow(window: PBObject, options: { sheet: boolean; modal: boolean }): void {
    this.created.push({ window, options })
    this.trace.push('host.create')
  }
  showWindow(): void { this.trace.push('host.show') }
  focus(): void { this.trace.push('host.focus-request') }
  async focusDw(): Promise<boolean> { this.trace.push('host.focus-editor'); return true }
  activate(window: PBObject): void { this.activated.push(window) }
  closeWindow(window: PBObject): void {
    assert.ok(window instanceof NWindow)
    this.closed.push({ window, isOpen: window.isOpen, destroyed: window.destroyed })
    this.trace.push('host.close')
  }
}

function fixture(t: TestContext, windowtype = 0) {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
  const { file, errors } = parseScriptFile(script)
  assert.deepEqual(errors, [])
  const routines = new Map<string, Map<string, Routine[]>>()
  for (const routine of file.routines) {
    if (!routines.has(routine.owner)) routines.set(routine.owner, new Map())
    const owner = routines.get(routine.owner)!
    if (!owner.has(routine.name)) owner.set(routine.name, [])
    owner.get(routine.name)!.push(routine)
  }
  const definition: ClassDef = {
    name, kind: 'window', ancestor: 'window', library: 'synthetic', routines,
    fields: [
      { name: 'windowtype', type: 'long', attr: '0xbc', value: windowtype },
      { name: 'il_blockclose', type: 'long', attr: '0xcc', value: 0 },
      { name: 'draft', type: 'string', attr: '0xcc', value: 'synthetic unsaved value' },
    ],
    controls: [
      { name: 'tab_steps', ancestor: 'tab', fields: [], controls: [
        { name: 'tabpage_detail', ancestor: 'userobject', fields: [], controls: [] },
      ] },
      { name: 'dw_detail', ancestor: 'datawindow', fields: [], controls: [] },
    ],
  }
  const rt = new Runtime({ load: async (key) => key === name ? definition : undefined })
  registerWindowing(rt)
  const trace: string[] = []
  const host = new RecordingHost(trace)
  rt.ui = host
  rt.onError = (error) => { throw error }
  rt.sys.set('f_trace', { fn: (_rt, args) => { trace.push(String(args[0])); return 1 } })
  const message = new PBObject(rt, 'message', 'message')
  rt.globals.set('message', message)
  let window: NWindow | null = null
  const ref = new Ref(() => window, (value) => {
    assert.ok(value instanceof NWindow)
    window = value
  })
  ref.name = name
  const getWindow = (): NWindow => { assert.ok(window); return window }
  const call = (method: string, args: unknown[]) => {
    const fn = rt.sys.get(method)
    assert.ok(fn, `Missing system function ${method}`)
    return Promise.resolve(fn.fn(rt, args, new Frame(null, null, 0)))
  }
  t.after(async () => {
    if (window?.isOpen) {
      window.props.set('il_blockclose', 0)
      await rt.closeWindow(window)
    }
  })
  return { rt, trace, host, ref, message, getWindow, call }
}

test('presentation lifecycle preserves constructor, Open, posted, tab and initial-focus order', async (t) => {
  const f = fixture(t)
  assert.equal(await f.call('open', [f.ref]), 1)
  assert.deepEqual(f.trace, [
    'tab.constructor', 'detail.constructor', 'host.create', 'open', 'host.focus-request',
    'host.show', 'posted', 'tab.changing', 'tab.changed', 'detail.focus', 'host.focus-editor',
  ])
  assert.deepEqual(f.host.created[0].options, { sheet: false, modal: false })
  assert.equal(f.rt.posted.length, 0)
  assert.equal(f.getWindow().focusOwner, f.getWindow().children.get('dw_detail'))
  assert.equal(f.getWindow().focusLive, true)
})

test('sheets retain their parent and share the same lifecycle', async (t) => {
  const f = fixture(t)
  const parent = new NWindow(f.rt, 'w_synthetic_parent')
  assert.equal(await f.call('opensheet', [f.ref, parent]), 1)
  assert.equal(f.getWindow().parent, parent)
  assert.deepEqual(f.host.created[0].options, { sheet: true, modal: false })
  assert.equal(f.trace.filter((event) => event === 'open').length, 1)
})

test('reactivating an open reference does not rerun Open or replace unsaved state', async (t) => {
  const f = fixture(t)
  await f.call('open', [f.ref])
  const original = f.getWindow()
  original.props.set('draft', 'edited synthetic value')
  const events = f.trace.slice()
  assert.equal(await f.call('open', [f.ref]), 1)
  assert.equal(f.getWindow(), original)
  assert.deepEqual(f.trace, events)
  assert.deepEqual(f.host.activated, [original])
  assert.equal(original.props.get('draft'), 'edited synthetic value')
})

test('CloseQuery cancellation retains the window and draft; acceptance closes exactly once', async (t) => {
  const f = fixture(t)
  await f.call('open', [f.ref])
  const window = f.getWindow()
  window.props.set('il_blockclose', 1)
  assert.equal(await f.rt.closeWindow(window), -1)
  assert.equal(window.isOpen, true)
  assert.equal(window.closing, false)
  assert.equal(window.destroyed, false)
  assert.equal(window.props.get('draft'), 'synthetic unsaved value')
  assert.equal(f.rt.windowInstances.get(name), window)
  assert.equal(f.host.closed.length, 0)
  window.props.set('il_blockclose', 0)
  assert.equal(await f.rt.closeWindow(window), 1)
  await window.closed
  assert.deepEqual(f.host.closed, [{ window, isOpen: false, destroyed: false }])
  assert.equal(window.destroyed, true)
  assert.ok([...window.children.values()].every((child) => child.destroyed))
  assert.equal(f.rt.windowInstances.has(name), false)
  assert.equal(await f.rt.closeWindow(window), 0)
  assert.equal(f.host.closed.length, 1)
})

for (const [label, returned, slot] of [
  ['string', 'synthetic result', 'stringparm'],
  ['number', 17, 'doubleparm'],
  ['object', { selection: 'synthetic result' }, 'powerobjectparm'],
] as const) {
  test(`modal ${label} return waits for accepted close and preserves the message channel`, async (t) => {
    const f = fixture(t, 3)
    const yielded = Promise.withResolvers<void>()
    const yieldQueue = f.rt.yieldQueue.bind(f.rt)
    f.rt.yieldQueue = () => { yieldQueue(); yielded.resolve() }
    let completed = false
    const opening = f.call('openwithparm', [f.ref, 'synthetic argument']).then((result) => {
      completed = true
      return result
    })
    await yielded.promise
    assert.equal(completed, false)
    assert.equal(f.message.props.get('stringparm'), 'synthetic argument')
    assert.equal(f.message.props.get('doubleparm'), 0)
    assert.equal(f.message.props.get('powerobjectparm'), null)
    assert.deepEqual(f.host.created[0].options, { sheet: false, modal: true })
    assert.equal(await f.call('closewithreturn', [f.getWindow(), returned]), 1)
    assert.equal(await opening, 1)
    assert.equal(f.message.props.get(slot), returned)
    assert.equal(await f.call('closewithreturn', [f.getWindow(), 'stale posted close']), 0)
    assert.equal(f.message.props.get(slot), returned, 'A stale close cannot replace the completed modal return')
    for (const other of ['stringparm', 'doubleparm', 'powerobjectparm']) {
      if (other !== slot) assert.equal(f.message.props.get(other), other === 'stringparm' ? '' : other === 'doubleparm' ? 0 : null)
    }
  })
}

test('overlapping close requests cannot duplicate CloseQuery or close callbacks', async (t) => {
  const f = fixture(t)
  await f.call('open', [f.ref])
  const gate = Promise.withResolvers<void>()
  const fire = f.rt.fire.bind(f.rt)
  f.rt.fire = async (object, event, args) => {
    if (event === 'closequery') await gate.promise
    return fire(object, event, args)
  }
  const first = f.rt.closeWindow(f.getWindow())
  assert.equal(await f.rt.closeWindow(f.getWindow()), 0)
  gate.resolve()
  assert.equal(await first, 1)
  assert.equal(f.trace.filter((event) => event === 'closequery').length, 1)
  assert.equal(f.host.closed.length, 1)
})

test('Close handlers can publish their return while the window is still closing', async (t) => {
  const f = fixture(t)
  await f.call('open', [f.ref])
  const fire = f.rt.fire.bind(f.rt)
  f.rt.fire = async (object, event, args) => {
    if (event === 'close') assert.equal(await f.call('closewithreturn', [object, 902]), 0)
    return fire(object, event, args)
  }
  assert.equal(await f.rt.closeWindow(f.getWindow()), 1)
  assert.equal(f.message.props.get('doubleparm'), 902)
  assert.equal(f.host.closed.length, 1)
  assert.equal(f.trace.filter((event) => event === 'close').length, 1)
})

test('window timers survive cancelled closes and stop on accepted close', async (t) => {
  const f = fixture(t)
  await f.call('open', [f.ref])
  const window = f.getWindow()
  await f.call('timer', [1, window])
  t.mock.timers.tick(1000)
  await setImmediate()
  assert.equal(f.trace.filter((event) => event === 'timer').length, 1)
  window.props.set('il_blockclose', 1)
  await f.rt.closeWindow(window)
  t.mock.timers.tick(1000)
  await setImmediate()
  assert.equal(f.trace.filter((event) => event === 'timer').length, 2)
  window.props.set('il_blockclose', 0)
  await f.rt.closeWindow(window)
  t.mock.timers.tick(1000)
  await setImmediate()
  assert.equal(f.trace.filter((event) => event === 'timer').length, 2)
})
