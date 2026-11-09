import test from 'node:test'
import assert from 'node:assert/strict'
import { buildGroupPlan, rowAtItem } from '../src/ui/group-plan.ts'
import { PBDate, PBDateTime } from '../src/runtime/values.ts'

const rows = ['A', 'A', 'B', 'C', 'C', 'C'].map((v) => ({ v: [v] }))
const levels = [{ level: 1, by: [0] }]

test('group breaks add a header before the first and a trailer after the last row of each group', () => {
  const plan = buildGroupPlan(levels, rows, new Set(['header.1', 'trailer.1']))
  assert.deepEqual([...plan.heads], [[1, ['header.1']], [3, ['header.1']], [4, ['header.1']]])
  assert.deepEqual([...plan.tails], [[2, ['trailer.1']], [3, ['trailer.1']], [6, ['trailer.1']]])
  // 6 data rows + 3 headers + 3 trailers
  assert.equal(plan.prefix.at(-1), 12)
  assert.deepEqual(plan.prefix, [0, 2, 4, 7, 9, 10, 12])
})

test('only mapped bands count and an unbroken grid keeps one item per row', () => {
  assert.equal(buildGroupPlan(levels, rows, new Set(['trailer.1'])).prefix.at(-1), 9)
  const flat = buildGroupPlan([], rows, new Set())
  assert.deepEqual(flat.prefix, [0, 1, 2, 3, 4, 5, 6])
  assert.equal(rowAtItem(null, 7), 7)
})

test('a scroll offset in display items maps back to the right data row', () => {
  const plan = buildGroupPlan(levels, rows, new Set(['header.1', 'trailer.1']))
  // items: 0 H, 1 A1, 2 A2, 3 T | 4 H, 5 B, 6 T | 7 H, 8 C1, 9 C2, 10 C3, 11 T  -> prefix [0,2,4,7,9,10,12]
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((item) => rowAtItem(plan, item)), [0, 0, 1, 1, 2, 2, 2, 3, 3, 4, 5, 5])
  assert.equal(rowAtItem(plan, 99), 5)
})

test('multi-level groups nest: a break at level 1 also breaks level 2', () => {
  const data = [['A', 'x'], ['A', 'y'], ['B', 'y']].map((v) => ({ v }))
  const plan = buildGroupPlan([{ level: 1, by: [0] }, { level: 2, by: [1] }], data, new Set(['header.1', 'header.2', 'trailer.2']))
  assert.deepEqual(plan.heads.get(1), ['header.1', 'header.2'])
  assert.deepEqual(plan.heads.get(2), ['header.2'])
  assert.deepEqual(plan.heads.get(3), ['header.1', 'header.2'])
  assert.deepEqual([1, 2, 3].map((row) => plan.tails.get(row)), [['trailer.2'], ['trailer.2'], ['trailer.2']])
})

test('date groups break on each date, as the Classic view compares their text', () => {
  const dates = [PBDate.ymd(2026, 1, 1), PBDate.ymd(2026, 1, 1), PBDate.ymd(2026, 1, 2), new PBDateTime(PBDate.ymd(2026, 1, 3).n, 0)]
  const plan = buildGroupPlan(levels, dates.map((v) => ({ v: [v] })), new Set(['header.1', 'trailer.1']))
  assert.deepEqual([...plan.heads.keys()], [1, 3, 4])
  assert.deepEqual([...plan.tails.keys()], [2, 3, 4])
})

test('a null and an empty value fall into one group, as in the Classic view', () => {
  const plan = buildGroupPlan(levels, [null, '', undefined, 'A'].map((v) => ({ v: [v] })), new Set(['header.1']))
  assert.deepEqual([...plan.heads.keys()], [1, 4])
})
