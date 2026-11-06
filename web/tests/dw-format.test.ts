import test from 'node:test'
import assert from 'node:assert/strict'
import { splitExpr, splitFormatExpr } from '../src/dw/def.ts'

test('a pure DataWindow format expression is separated from its empty static head', () => {
  assert.deepEqual(splitFormatExpr("\tf_SetColumnFormat('Qty')"), {
    value: '',
    expr: "f_SetColumnFormat('Qty')",
  })
})

test('a static format prefix followed by an expression keeps the prefix', () => {
  assert.deepEqual(splitFormatExpr("[currency]\tf_SetColumnFormat('Qty')"), {
    value: '[currency]',
    expr: "f_SetColumnFormat('Qty')",
  })
  assert.deepEqual(splitFormatExpr('dd/mm/yyyy~tf_GetDateFormat()'), {
    value: 'dd/mm/yyyy',
    expr: 'f_GetDateFormat()',
  })
})

test('a static format without a tab is returned unchanged', () => {
  assert.deepEqual(splitFormatExpr('#,##0.00'), { value: '#,##0.00' })
})

test('splitExpr keeps treating a tab in a computed expression as whitespace', () => {
  // the value is not a simple literal, so this is one expression, not a format
  const v = 'if(column1 = 0,\n  column2, 0)'
  assert.deepEqual(splitExpr(v), { value: v })
})
