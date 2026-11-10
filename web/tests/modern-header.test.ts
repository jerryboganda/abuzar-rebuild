// Modern header (approved parity exception 2026-11-11): the context bar reads the frame title the application script builds, and
// the command bar groups the frame toolbar by the stock picture of each menu item.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseFrameTitle, toolbarGroup } from '../src/ui/modern-header.ts'

test('frame title splits into company, period and user', () => {
  assert.deepEqual(parseFrameTitle('WASEELA  ABUZAR V2 01.01.2022 : ADMIN : 11/11/26 02:25:13 - [Pack Purchase]'),
    { company: 'WASEELA ABUZAR V2', period: '01.01.2022', user: 'ADMIN', raw: 'WASEELA  ABUZAR V2 01.01.2022 : ADMIN : 11/11/26 02:25:13' })
})

test('an unexpected frame title is shown as it is', () => {
  assert.deepEqual(parseFrameTitle('Trader'), { company: 'Trader', period: undefined, user: undefined, raw: 'Trader' })
  assert.equal(parseFrameTitle('').company, '')
})

test('toolbar stock pictures map to the command groups', () => {
  assert.equal(toolbarGroup('SelectScript!'), 'record')
  assert.equal(toolbarGroup('save!'), 'record')
  assert.equal(toolbarGroup('Clear!'), 'record')
  assert.equal(toolbarGroup('Update!'), 'items')
  assert.equal(toolbarGroup('Retrieve!'), 'items')
  assert.equal(toolbarGroup('Undo!'), 'items')
  for (const stock of ['VCRFirst!', 'VCRPrior!', 'VCRNext!', 'VCRLast!']) assert.equal(toolbarGroup(stock), 'browse')
  for (const stock of ['Find!', 'Print!', 'DBAdmin!', 'Custom048!']) assert.equal(toolbarGroup(stock), 'output')
})

test('the header exception is recorded in HANDOFF.md', () => {
  const handoff = readFileSync(resolve(import.meta.dirname, '../../docs/HANDOFF.md'), 'utf8')
  assert.ok(handoff.includes('modern-header.ts'))
})
