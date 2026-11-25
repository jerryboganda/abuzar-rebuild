import test from 'node:test'
import assert from 'node:assert/strict'
import { applyMenuFixes, MENU_FIXES } from '../src/runtime/menu-fixes.ts'
import type { PBObject } from '../src/runtime/object.ts'

// a menu item stand-in: name, props, children and pbSet are all applyMenuFixes touches
function item(name: string, props: Record<string, unknown> = {}, kids: PBObject[] = []): PBObject {
  const o = { name, className: name, props: new Map(Object.entries(props)), children: new Map(kids.map((k) => [k.name, k])), pbSet(key: string, value: unknown) { this.props.set(key, value) } }
  return o as unknown as PBObject
}
const window = (cls: string, menu: PBObject): PBObject => ({ name: cls, className: cls, props: new Map([['menuid', menu]]), children: new Map() }) as unknown as PBObject

test('Print is shown on a transaction window, as measured on the original', () => {
  const print = item('m_print', { visible: false, enabled: false })
  const menu = item('m_x', {}, [item('m_file', {}, [print])])
  applyMenuFixes(window('w_purchasereturn', menu))
  assert.equal(print.props.get('visible'), true)
  assert.equal(print.props.get('toolbaritemvisible'), true)
  assert.equal(print.props.get('enabled'), false) // the scripts still decide when it can be used
})

test('Adjustment Decrease hides Post, the sale window renames it, the Item menu goes from Priority Setting', () => {
  const post = item('m_post', { visible: true })
  applyMenuFixes(window('w_adjwindow', item('m_x', {}, [item('m_file', {}, [item('m_print'), post])])))
  assert.equal(post.props.get('visible'), false)
  const salePost = item('m_post', { text: 'Post\tCtrl+E' })
  applyMenuFixes(window('w_sale', item('m_x', {}, [item('m_file', {}, [item('m_print'), salePost])])))
  assert.match(String(salePost.props.get('text')), /^Post Sale Invoices/)
  const itemMenu = item('m_item', { visible: true })
  applyMenuFixes(window('w_itempriority_form', item('m_x', {}, [itemMenu])))
  assert.equal(itemMenu.props.get('visible'), false)
})

test('an unknown window, or an entry the menu does not have, is left alone', () => {
  applyMenuFixes(window('w_unknown', item('m_x')))
  applyMenuFixes(window('w_sale', item('m_x')))
  assert.ok(Object.keys(MENU_FIXES).every((k) => /^w_/.test(k)))
})
