import test from 'node:test'
import assert from 'node:assert/strict'
import { Runtime } from '../src/runtime/interp.ts'
import { NControl } from '../src/runtime/native/controls.ts'
import { TabSelection, visibleTabPages } from '../src/ui/tab-selection.ts'

function fixture() {
  const rt = new Runtime({ load: async () => undefined })
  const control = new NControl(rt, 'tab_retrieve', 'tab')
  const pages = ['detail', 'list', 'extra'].map((name) => {
    const page = new NControl(rt, name, 'userobject')
    page.name = name
    page.parent = control
    control.children.set(name, page)
    return page
  })
  control.props.set('selectedtab', 1)
  let refreshed = 0
  const selection = new TabSelection(control, () => { refreshed++ })
  return { rt, control, pages, selection, refreshed: () => refreshed }
}

test('tab navigation waits for SelectionChanging, commits once, then runs SelectionChanged and posted work', async () => {
  const f = fixture()
  const events: string[] = []
  let notifications = 0
  f.control.listeners.add(() => { notifications++ })
  f.rt.fire = async (control, event, args) => {
    assert.equal(control, f.control)
    assert.deepEqual(args, [1, 2])
    assert.equal(control.props.get('selectedtab'), event === 'selectionchanging' ? 1 : 2)
    events.push(event)
    if (event === 'selectionchanged') f.rt.post(async () => { events.push('posted') })
    return 0
  }
  assert.equal(await f.selection.select(f.pages[1]), true)
  assert.deepEqual(events, ['selectionchanging', 'selectionchanged', 'posted'])
  assert.equal(notifications, 1)
  assert.equal(f.selection.busy, false)
  assert.ok(f.refreshed() >= 2)
  assert.equal(await f.selection.select(f.pages[1]), true)
  assert.equal(events.length, 3, 'Selecting the active tab must not reset its form')
})

test('a cancelled or overlapping tab request keeps the original page', async () => {
  const f = fixture()
  const gate = Promise.withResolvers<number>()
  const events: string[] = []
  f.rt.fire = async (_control, event) => { events.push(event); return gate.promise }
  const first = f.selection.select(f.pages[1])
  assert.equal(f.selection.busy, true)
  assert.equal(f.control.props.get('selectedtab'), 1)
  assert.equal(await f.selection.select(f.pages[2]), false)
  gate.resolve(1)
  assert.equal(await first, false)
  assert.equal(f.control.props.get('selectedtab'), 1)
  assert.deepEqual(events, ['selectionchanging'])
  assert.equal(f.selection.busy, false)
})

test('disabled, hidden, removed and destroyed pages cannot be activated', async () => {
  for (const mutation of [
    (f: ReturnType<typeof fixture>) => f.pages[1].props.set('visible', false),
    (f: ReturnType<typeof fixture>) => f.pages[1].props.set('enabled', false),
    (f: ReturnType<typeof fixture>) => f.control.props.set('enabled', false),
    (f: ReturnType<typeof fixture>) => f.control.props.set('visible', false),
    (f: ReturnType<typeof fixture>) => { f.pages[1].destroyed = true },
    (f: ReturnType<typeof fixture>) => { f.control.destroyed = true },
    (f: ReturnType<typeof fixture>) => f.control.children.delete('list'),
  ]) {
    for (const duringGuard of [false, true]) {
      const f = fixture()
      let changed = false
      if (!duringGuard) mutation(f)
      f.rt.fire = async (_control, event) => {
        if (event === 'selectionchanging') mutation(f)
        if (event === 'selectionchanged') changed = true
        return 0
      }
      assert.equal(await f.selection.select(f.pages[1]), false)
      assert.equal(f.control.props.get('selectedtab'), 1)
      assert.equal(changed, false)
    }
  }
})

test('tab guards reject stale page order and script-directed selection changes', async () => {
  for (const mutation of [
    (f: ReturnType<typeof fixture>) => f.pages[0].props.set('visible', false),
    (f: ReturnType<typeof fixture>) => f.control.props.set('selectedtab', 3),
    (f: ReturnType<typeof fixture>) => {
      f.control.children.delete('list')
      f.control.children.set('list', f.pages[1])
    },
  ]) {
    const f = fixture()
    const events: string[] = []
    f.rt.fire = async (_control, event) => { events.push(event); mutation(f); return 0 }
    assert.equal(await f.selection.select(f.pages[1]), false)
    assert.deepEqual(events, ['selectionchanging'])
  }
})

test('tab guards report errors and release the pending state for a retry', async () => {
  const f = fixture()
  f.rt.fire = async () => { throw new Error('Synthetic selection failure') }
  await assert.rejects(f.selection.select(f.pages[1]), /Synthetic selection failure/)
  assert.equal(f.control.props.get('selectedtab'), 1)
  assert.equal(f.selection.busy, false)
  f.rt.fire = async () => 0
  assert.equal(await f.selection.select(f.pages[1]), true)
  f.pages[0].props.set('visible', false)
  assert.deepEqual(visibleTabPages(f.control), [f.pages[1], f.pages[2]])
})

test('tab navigation waits for pending edit acceptance before asking to change pages', async () => {
  for (const accepted of [true, false]) {
    const f = fixture()
    const gate = Promise.withResolvers<boolean>()
    const events: string[] = []
    f.rt.fire = async (_control, event) => { events.push(event); return 0 }
    const selection = new TabSelection(f.control, () => {}, async (page) => {
      assert.equal(page, f.pages[0])
      return gate.promise
    })
    const request = selection.select(f.pages[1])
    assert.equal(selection.busy, true)
    assert.equal(f.control.props.get('selectedtab'), 1)
    assert.deepEqual(events, [])
    gate.resolve(accepted)
    assert.equal(await request, accepted)
    assert.deepEqual(events, accepted ? ['selectionchanging', 'selectionchanged'] : [])
    assert.equal(selection.busy, false)
  }
})

test('edit acceptance cannot navigate a page whose selection changed while awaiting validation', async () => {
  const f = fixture()
  const selection = new TabSelection(f.control, () => {}, async () => {
    f.control.props.set('selectedtab', 3)
    return true
  })
  f.rt.fire = async () => { throw new Error('Stale edit acceptance must not raise tab events') }
  assert.equal(await selection.select(f.pages[1]), false)
  assert.equal(f.control.props.get('selectedtab'), 3)
})
