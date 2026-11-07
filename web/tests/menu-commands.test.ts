import test from 'node:test'
import assert from 'node:assert/strict'
import { Runtime } from '../src/runtime/interp.ts'
import { PBObject } from '../src/runtime/object.ts'
import { menuCommands, executeMenuCommand } from '../src/ui/menu-commands.ts'

function fixture() {
  const rt = new Runtime({ load: async () => undefined })
  const root = new PBObject(rt, 'fixture_menu', 'menu')
  const group = new PBObject(rt, 'm_sales', 'menu')
  group.props.set('text', '&Sales')
  const item = new PBObject(rt, 'm_sale', 'menu')
  item.props.set('text', 'Cash && &Sale<TAB>F2')
  root.children.set('sales', group)
  group.children.set('sale', item)
  return { rt, root, group, item }
}

test('commands use full captions and exclude hidden or disabled ancestors', () => {
  const f = fixture()
  assert.equal(menuCommands(f.root)[0].label, 'Sales / Cash & Sale')
  for (const object of [f.root, f.group, f.item]) {
    for (const field of ['visible', 'enabled']) {
      object.props.set(field, false)
      assert.deepEqual(menuCommands(f.root), [])
      object.props.set(field, true)
    }
  }
})

test('command execution fires Selected in order, then Clicked and posted work', async () => {
  const f = fixture()
  const events: string[] = []
  f.rt.fire = async (item, event) => {
    events.push(`${item.className}.${event}`)
    if (event === 'clicked') f.rt.post(async () => { events.push('posted') })
    return null
  }
  assert.equal(await executeMenuCommand(f.rt, f.root, menuCommands(f.root)[0]), true)
  assert.deepEqual(events, ['m_sales.selected', 'm_sale.selected', 'm_sale.clicked', 'posted'])
})

test('stale search results cannot execute after Selected revokes visibility or removes the item', async () => {
  for (const remove of [false, true]) {
    const f = fixture()
    const command = menuCommands(f.root)[0]
    let clicked = false
    f.rt.fire = async (_item, event) => {
      if (event === 'selected') {
        if (remove) f.group.children.clear()
        else f.group.props.set('visible', false)
      }
      if (event === 'clicked') clicked = true
      return null
    }
    assert.equal(await executeMenuCommand(f.rt, f.root, command), false)
    assert.equal(clicked, false)
  }
})
