import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { Runtime } from '../src/runtime/interp.ts'
import { registerSysFuncs } from '../src/runtime/sysfuncs.ts'
import { DwModel } from '../src/dw/model.ts'
import type { DwDef } from '../src/dw/def.ts'
import { cmp, dwStrCmp, equals, lstrcmp } from '../src/runtime/values.ts'

// measured 2026-11-10 on the reference PC: Windows lstrcmpW, and Evaluate() of the original DataWindow engine (pbdwe125.dll)
const vectors = JSON.parse(readFileSync(new URL('./fixtures/string-order-vectors.json', import.meta.url), 'utf8')) as {
  lstrcmpW: [string, string, number][]
  dataWindowExpression: [string, string, number][]
}

test('DataWindow sorting compares strings like Windows lstrcmpW (400 measured pairs)', () => {
  for (const [a, b, want] of vectors.lstrcmpW) assert.equal(lstrcmp(a, b), want, `${JSON.stringify(a)} vs ${JSON.stringify(b)}`)
})

test('DataWindow expressions compare strings like the original engine, trailing blanks ignored', () => {
  for (const [a, b, want] of vectors.dataWindowExpression) assert.equal(dwStrCmp(a, b), want, `${JSON.stringify(a)} vs ${JSON.stringify(b)}`)
  assert.equal(dwStrCmp('PANADOL ', 'PANADOL'), 0)
  assert.equal(dwStrCmp('a', 'B'), -1)
  assert.equal(dwStrCmp('CO-OP', 'COOP'), 1)
  // PowerScript orders with lstrcmpW too (PBVM125.dll string comparison handlers) but keeps exact equality
  assert.equal(cmp('a', 'B'), -1)
  assert.equal(cmp('CO-OP', 'COOP'), 1)
  assert.equal(cmp('PANADOL ', 'PANADOL'), 1)
  assert.equal(equals('abc', 'ABC'), false)
  assert.equal(equals('PANADOL ', 'PANADOL'), false)
  for (const [a, b, want] of vectors.lstrcmpW) assert.equal(cmp(a, b), want, `PowerScript ${JSON.stringify(a)} vs ${JSON.stringify(b)}`)
})

const def: DwDef = {
  datawindow: { processing: '1' },
  bands: { detail: { height: '80' } } as DwDef['bands'],
  table: {
    columns: [
      { type: 'long', name: 'code', dbname: 'Item.Code' },
      { type: 'char(60)', name: 'name', dbname: 'Item.Name' },
    ],
    retrieve: 'select code, name from item',
  },
  objects: [{ type: 'compute', name: 'is_panadol', band: 'detail', expression: "if(name = 'PANADOL', 1, 0)" }],
}

test('Sort() orders names as the original and keeps null names first in descending order too', async () => {
  const rt = new Runtime({ load: async () => undefined })
  registerSysFuncs(rt)
  const m = new DwModel(rt, 'd_names', structuredClone(def))
  const names = ['zinc', 'PANADOL-EXTRA', 'aspirin', null, 'PANADOL EXTRA', 'Panadol', 'PANADOLEXTRA', 'PANADOL ', 'Brufen']
  names.forEach((name, i) => {
    const row = m.insertRow(0)
    m.setItem(row, 'code', i + 1)
    m.setItem(row, 'name', name)
  })
  const order = () => Array.from({ length: m.rowCount() }, (_, i) => m.getItem(i + 1, 'name'))
  m.setSort('name A')
  await m.sort()
  assert.deepEqual(order(), [null, 'aspirin', 'Brufen', 'Panadol', 'PANADOL ', 'PANADOL EXTRA', 'PANADOLEXTRA', 'PANADOL-EXTRA', 'zinc'])
  m.setSort('name D')
  await m.sort()
  assert.deepEqual(order(), [null, 'zinc', 'PANADOL-EXTRA', 'PANADOLEXTRA', 'PANADOL EXTRA', 'PANADOL ', 'Panadol', 'Brufen', 'aspirin'])
  // an expression compares without the trailing blank but with case: only 'PANADOL ' matches
  const matches: unknown[] = []
  for (let r = 1; r <= m.rowCount(); r++) if (Number(await m.getValue(r, 'is_panadol')) === 1) matches.push(m.getItem(r, 'name'))
  assert.deepEqual(matches, ['PANADOL '])
})
