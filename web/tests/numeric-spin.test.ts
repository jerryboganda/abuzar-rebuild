import test from 'node:test'
import assert from 'node:assert/strict'
import type { DwObject } from '../src/dw/def.ts'
import { numericSpin, spinNumber, stepNumber, canStepNumber } from '../src/ui/numeric-spin.ts'
import type { NumericSpin } from '../src/ui/numeric-spin.ts'

const object: DwObject = {
  name: 'limit', type: 'column', band: 'detail',
  'editmask.spin': 'yes', 'editmask.spinincr': '1', 'editmask.spinrange': '0~999999',
}
const config: NumericSpin = { kind: 'number', minimum: 0, maximum: 999999, increment: 1 }

test('numeric spin configuration honors the real metadata and runtime overrides', () => {
  assert.deepEqual(numericSpin(object, 'number'), config)
  assert.deepEqual(numericSpin(object, 'decimal'), config)
  assert.deepEqual(numericSpin(object, 'number', new Map([
    ['limit.editmask.spinrange', '-10~10'], ['limit.editmask.spinincr', '2'],
  ])), { kind: 'number', minimum: -10, maximum: 10, increment: 2 })
  assert.deepEqual(numericSpin(object, 'number', new Map([['limit.editmask.spin', 'no']])), { kind: 'none' })
})

test('unsupported masks cannot silently become numeric steppers', () => {
  for (const kind of ['date', 'datetime', 'string', 'boolean']) assert.equal(numericSpin(object, kind).kind, 'unsupported')
  for (const properties of [
    { 'editmask.spinrange': '' }, { 'editmask.spinrange': '0~' }, { 'editmask.spinrange': '10~0' },
    { 'editmask.spinrange': '0~1.5' }, { 'editmask.spinrange': '0~9007199254740992' },
    { 'editmask.spinincr': '0' }, { 'editmask.spinincr': '-1' }, { 'editmask.spinincr': '0.5' },
    { 'editmask.codetable': 'yes' },
    { 'editmask.spin': 'unsupported' }, { 'editmask.codetable': 'unsupported' },
  ]) for (const kind of ['number', 'decimal']) assert.equal(numericSpin({ ...object, ...properties }, kind).kind, 'unsupported')
})

test('stepping respects both bounds without wrapping or rounding typed fractional values', () => {
  assert.equal(stepNumber('0', config, -1), '0')
  assert.equal(stepNumber('999999', config, 1), '999999')
  assert.equal(stepNumber('999998', config, 1), '999999')
  assert.equal(stepNumber('-2', config, 1), '0')
  assert.equal(stepNumber('1000000', config, -1), '999999')
  assert.equal(stepNumber('1.1', config, 1), '2.1')
  assert.equal(stepNumber('1.123456789012345678', config, 1), '2.123456789012345678')
  assert.equal(stepNumber('1.123456789012345678', config, -1), '0.123456789012345678')
  assert.equal(stepNumber('1e-18', config, 1), '1.000000000000000001')
  assert.equal(stepNumber('998.75', { ...config, maximum: 999 }, 1), '999')
  assert.equal(stepNumber('10', { ...config, minimum: -10, increment: 3 }, -1), '7')
  assert.equal(stepNumber(String(Number.MAX_SAFE_INTEGER - 1), { ...config, maximum: Number.MAX_SAFE_INTEGER, increment: 2 }, 1), String(Number.MAX_SAFE_INTEGER))
})

test('stepping shares typed-number normalization without converting blank or invalid text to zero', () => {
  assert.equal(stepNumber('1,234', config, 1), '1235')
  assert.equal(stepNumber('(2)', { ...config, minimum: -10 }, -1), '-3')
  assert.equal(spinNumber('1e3'), 1000)
  for (const text of ['', ' ', '-', 'invalid', 'Infinity', '1e999', '1e-999999999', '0x10', '0b10', '1.2.3']) {
    assert.equal(spinNumber(text), null)
    assert.equal(stepNumber(text, config, 1), null)
  }
})

test('decimal button bounds do not round a valid draft to the boundary', () => {
  const grade = { ...config, maximum: 999 }
  assert.equal(canStepNumber('998.999999999999999999', grade, 1), true)
  assert.equal(canStepNumber('999', grade, 1), false)
  assert.equal(canStepNumber('0', grade, -1), false)
  assert.equal(canStepNumber('0.000000000000000001', grade, -1), true)
  assert.equal(canStepNumber('-1', grade, 1), true)
  assert.equal(canStepNumber('1000', grade, -1), true)
  assert.equal(canStepNumber('invalid', grade, 1), true, 'Invalid drafts keep the action available to announce correction guidance')
})
