import test from 'node:test'
import assert from 'node:assert/strict'
import { JsonClassLoader } from '../src/runtime/loader.ts'

const raw = (name: string) => JSON.stringify({ name, kind: 'window', ancestor: null, library: 'lib', fields: [], controls: [], routines: {} })

test('the class loader never asks for a name that has no class file', async () => {
  const asked: string[] = []
  const loader = new JsonClassLoader(async (name) => { asked.push(name); return name.toLowerCase() === 'w_login1' ? raw('w_login1') : undefined }, new Set(['w_login1']))
  // menu items and built-in control classes are not class files: no request at all
  for (const name of ['m_file', 'checkbox', 'datawindow', 'M_Purchase']) assert.equal(await loader.load(name), undefined)
  assert.deepEqual(asked, [])
  assert.equal((await loader.load('w_login1'))?.name, 'w_login1')
  assert.equal((await loader.load('W_LOGIN1'))?.name, 'w_login1', 'the index is case-insensitive like the runtime lookup')
  assert.deepEqual(asked, ['w_login1', 'W_LOGIN1'])
})

test('without the index every name is read, as before', async () => {
  const asked: string[] = []
  const loader = new JsonClassLoader(async (name) => { asked.push(name); return name === 'w_a' ? raw(name) : undefined })
  assert.equal((await loader.load('w_a'))?.name, 'w_a')
  assert.equal(await loader.load('m_file'), undefined)
  assert.deepEqual(asked, ['w_a', 'm_file'])
})
