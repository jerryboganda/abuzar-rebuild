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

test('the full list shows disabled leaves greyed with check marks and shortcuts, never a disabled submenu, in menu-bar order', async () => {
  const { menuBarOrder } = await import('../src/ui/menu-commands.ts')
  const f = fixture()
  f.item.props.set('checked', true)
  assert.deepEqual(menuCommands(f.root, { includeDisabled: true }).map(({ label, checked, shortcut, disabled }) => ({ label, checked, shortcut, disabled })),
    [{ label: 'Sales / Cash & Sale', checked: true, shortcut: 'F2', disabled: undefined }])
  f.item.props.set('enabled', false)
  assert.equal(menuCommands(f.root, { includeDisabled: true })[0].disabled, true)
  assert.deepEqual(menuCommands(f.root), [])
  f.item.props.set('enabled', true)
  f.group.props.set('enabled', false)
  assert.deepEqual(menuCommands(f.root, { includeDisabled: true }), [])
  // a sheet's own Item menu follows File
  const root = new PBObject(f.rt, 'sheet_menu', 'menu')
  for (const name of ['m_file', 'm_edit', 'm_window', 'm_item']) root.children.set(name, Object.assign(new PBObject(f.rt, name, 'menu'), { name }))
  assert.deepEqual(menuBarOrder(root).map((item) => item.className), ['m_file', 'm_item', 'm_edit', 'm_window'])
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

test('modules group available commands by their top-level menu in live order', async () => {
  const { menuModules } = await import('../src/ui/menu-commands.ts')
  const f = fixture()
  const second = new PBObject(f.rt, 'm_purchase', 'menu')
  second.props.set('text', 'Purchase')
  const leaf = new PBObject(f.rt, 'm_order', 'menu')
  leaf.props.set('text', 'Order')
  const nested = new PBObject(f.rt, 'm_more', 'menu')
  nested.props.set('text', 'More')
  second.children.set('order', leaf)
  second.children.set('more', nested)
  nested.children.set('leaf', Object.assign(new PBObject(f.rt, 'm_leaf', 'menu'), {}))
  nested.children.get('leaf')!.props.set('text', 'Return')
  f.root.children.set('purchase', second)
  const modules = menuModules(menuCommands(f.root))
  assert.deepEqual(modules.map((module) => [module.label, module.commands.map((item) => item.label)]),
    [['Sales', ['Cash & Sale']], ['Purchase', ['Order', 'More / Return']]])
  f.item.props.set('enabled', false)
  assert.deepEqual(menuModules(menuCommands(f.root)).map((module) => module.label), ['Purchase'])
})
