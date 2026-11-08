import test from 'node:test'
import assert from 'node:assert/strict'
import { planGrid } from '../src/ui/grid-plan.ts'

const box = (key: string, left: number, right: number, top: number, bottom: number) => ({ key, left, right, top, bottom })

test('two fields sharing a row split it by their source widths', () => {
  const plan = planGrid([box('a', 0, 500, 0, 60), box('b', 520, 1020, 4, 64)])
  const a = plan.place.get('a')!, b = plan.place.get('b')!
  // Rows follow the source distances, so a 4-unit offset is kept as overlapping row spans rather than snapped away.
  assert.ok(Math.min(a.rowEnd, b.rowEnd) > Math.max(a.rowStart, b.rowStart), 'their row spans overlap')
  assert.ok(a.colEnd <= b.colStart)
})

test('stacked fields take consecutive rows in the same columns', () => {
  const plan = planGrid([box('a', 0, 500, 0, 60), box('b', 0, 500, 80, 140)])
  assert.deepEqual([plan.place.get('a')!.colStart, plan.place.get('a')!.colEnd], [plan.place.get('b')!.colStart, plan.place.get('b')!.colEnd])
  assert.ok(plan.place.get('a')!.rowEnd <= plan.place.get('b')!.rowStart)
})

test('a tall list beside two stacked fields spans both of their rows', () => {
  const plan = planGrid([box('start', 0, 300, 100, 160), box('end', 0, 300, 180, 240), box('list', 400, 800, 0, 300)])
  const start = plan.place.get('start')!, end = plan.place.get('end')!, list = plan.place.get('list')!
  assert.ok(end.rowStart >= start.rowEnd, 'the dates stay stacked')
  assert.ok(list.rowStart <= start.rowStart && list.rowEnd >= end.rowEnd, 'the list spans both rows')
  assert.ok(list.colStart >= start.colEnd, 'the list stays beside them')
})

test('an equal split stays 50/50 and a wide field keeps its proportion', () => {
  const equal = planGrid([box('a', 0, 500, 0, 60), box('b', 500, 1000, 0, 60)])
  assert.deepEqual(equal.columns[0], equal.columns[1])
  const wide = planGrid([box('wide', 0, 750, 0, 60), box('narrow', 750, 1000, 0, 60)])
  assert.equal(wide.columns[0] / wide.columns[1], 3)
})

test('empty space between objects does not become a track, and tracks stay bounded', () => {
  const plan = planGrid([box('a', 0, 100, 0, 60), box('b', 5000, 5100, 0, 60)])
  assert.equal(plan.columns.length, 2)
  const many = planGrid(Array.from({ length: 80 }, (_, index) => box(`f${index}`, index * 37, index * 37 + 30, index * 100, index * 100 + 50)))
  assert.ok(many.columns.length <= 24)
})

test('a tall container does not merge the rows of the small boxes above it', () => {
  const plan = planGrid([box('plain', 0, 3000, 8, 308), box('group', 30, 2990, 308, 1584)])
  assert.ok(plan.place.get('group')!.rowStart >= plan.place.get('plain')!.rowEnd)
})

test('rows are sized in proportion to the source distances', () => {
  const plan = planGrid([box('a', 0, 500, 0, 60), box('b', 0, 500, 60, 120), box('c', 0, 500, 300, 360)])
  assert.deepEqual(plan.rowSizes, [60, 60, 60], 'the empty space between b and c is not a row')
  assert.equal(plan.unit, 60)
})
