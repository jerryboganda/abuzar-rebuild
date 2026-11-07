import test from 'node:test'
import assert from 'node:assert/strict'
import { DwChoiceRows } from '../src/ui/dw-choice-rows.ts'

test('lookup row prefixes preserve fractional heights and exact boundary navigation', () => {
  const rows = new DwChoiceRows(5, 22.5)
  assert.deepEqual(Array.from({ length: 6 }, (_, index) => rows.offset(index)), [0, 22.5, 45, 67.5, 90, 112.5])
  assert.deepEqual([-1, 0, 22.49, 22.5, 45, 112.5, 1000].map(offset => rows.at(offset)), [0, 0, 0, 1, 2, 4, 4])
  rows.measure(1, 67.5)
  assert.deepEqual(Array.from({ length: 6 }, (_, index) => rows.offset(index)), [0, 22.5, 90, 112.5, 135, 157.5])
  assert.equal(rows.at(89.99), 1)
  assert.equal(rows.at(90), 2)
  rows.measure(1, 15)
  assert.equal(rows.offset(5), 105)
  rows.measure(1, 15)
  assert.equal(rows.offset(5), 105)
})

test('large variable-row lookups match a direct prefix oracle after repeated measurements', () => {
  const count = 10000, rows = new DwChoiceRows(count, 24), heights = Array(count).fill(24)
  for (let step = 0; step < 3000; step++) {
    const index = (step * 7919) % count, height = 18 + step % 117 / 8
    rows.measure(index, height)
    heights[index] = height
  }
  let sum = 0
  for (let index = 0; index < count; index++) {
    assert.equal(rows.offset(index), sum)
    assert.equal(rows.at(sum), index)
    assert.equal(rows.at(sum + heights[index] - .001), index)
    sum += heights[index]
  }
  assert.equal(rows.offset(count), sum)
  assert.equal(rows.at(sum), count - 1)
})

test('one-row lookups and invalid measurements have explicit boundaries', () => {
  const rows = new DwChoiceRows(1, 25)
  assert.equal(rows.at(-100), 0)
  assert.equal(rows.at(100), 0)
  rows.measure(0, 100)
  assert.equal(rows.offset(1), 100)
  for (const [count, height] of [[0, 1], [-1, 1], [1.5, 1], [2 ** 31, 1], [1, 0], [1, Infinity]]) {
    assert.throws(() => new DwChoiceRows(count, height), RangeError)
  }
  for (const index of [-1, 1.5, 2, NaN]) assert.throws(() => rows.offset(index), RangeError)
  for (const offset of [NaN, Infinity, -Infinity]) assert.throws(() => rows.at(offset), RangeError)
  for (const [index, height] of [[-1, 1], [1, 1], [0, 0], [0, NaN]]) {
    assert.throws(() => rows.measure(index, height), RangeError)
  }
})
