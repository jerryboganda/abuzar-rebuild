import test from 'node:test'
import assert from 'node:assert/strict'
import { interfaceHref, needsInterfaceChoice } from '../src/ui/interface-chooser.ts'

test('the bare address shows the interface chooser; addresses that name a mode or a development view do not', () => {
  assert.equal(needsInterfaceChoice(new URLSearchParams('')), true)
  assert.equal(needsInterfaceChoice(new URLSearchParams('company=X')), true)
  for (const query of ['presentation=1', 'classic=1', 'app=1', 'w=w_sale', 'dw=d_x', 'live=d_x', 'autologin=a:b', 'presentation=0']) {
    assert.equal(needsInterfaceChoice(new URLSearchParams(query)), false, query)
  }
})

test('a choice keeps the other parameters and names exactly one interface', () => {
  const at = (search: string) => ({ pathname: '/', search, hash: '' })
  assert.equal(interfaceHref('modern', at('')), '/?presentation=1')
  assert.equal(interfaceHref('classic', at('')), '/?classic=1')
  assert.equal(interfaceHref('classic', at('?presentation=1&company=X')), '/?company=X&classic=1')
  assert.equal(interfaceHref('modern', { pathname: '/app/', search: '?classic=1', hash: '#x' }), '/app/?presentation=1#x')
})
