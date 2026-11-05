import test from 'node:test'
import assert from 'node:assert/strict'
import { fixClassData } from '../src/runtime/class-fixes.ts'

test('the f_validatedw fix gates on the row filled by the first FindRequired call', () => {
  const findRequired = () => ({ k: 'call', o: { k: 'id', n: 'adw_control' }, n: 'findrequired', a: [] })
  const body = [
    { k: 'if', c: { k: 'bin', op: '<', l: findRequired(), r: { k: 'num', v: 0, dec: false } }, t: [], ei: [] },
    { k: 'if', c: { k: 'bin', op: '=', l: findRequired(), r: { k: 'num', v: 1, dec: false } }, t: [], ei: [] },
    { k: 'return', e: { k: 'num', v: 1, dec: false } },
  ]
  const data = { routines: { f_validatedw: { f_validatedw: [{ body }] } } }

  assert.deepEqual(fixClassData('f_validatedw', data), ['required-field gate'])
  const gate = body[1] as unknown as { c: { op: string; l: { n: string }; r: { v: number } } }
  assert.equal(gate.c.op, '<>')
  assert.equal(gate.c.l.n, 'll_row')
  assert.equal(gate.c.r.v, 0)

  // Idempotent: a second pass leaves the corrected gate alone.
  assert.deepEqual(fixClassData('f_validatedw', data), [])
})

test('the f_validatedw fix leaves a class without the duplicated gate untouched', () => {
  const body = [{ k: 'return', e: { k: 'num', v: 1, dec: false } }]
  const data = { routines: { f_validatedw: { f_validatedw: [{ body }] } } }
  assert.deepEqual(fixClassData('f_validatedw', data), [])
  assert.deepEqual(body, [{ k: 'return', e: { k: 'num', v: 1, dec: false } }])
})
