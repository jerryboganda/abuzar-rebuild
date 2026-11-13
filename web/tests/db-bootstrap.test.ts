import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// The migrated company database already has customer 19, so the bootstrap's
// customer block returns early.  Every parent row that a later customer or
// supplier save needs must therefore be inserted before that block.
const sql = readFileSync(new URL('../../db/pg/95_bootstrap.sql', import.meta.url), 'utf8')

test('bootstrap ensures the default province before the guarded customer block', () => {
  const block = sql.indexOf('DO $boot$')
  const province = sql.indexOf('INSERT INTO dbo.stateprovince')
  assert.ok(block > 0, 'the customer block is present')
  assert.ok(province > 0, 'the default province row is present')
  assert.ok(province < block, 'the default province row must not be skipped by the customer guard')
})

test('bootstrap ensures every default parent row before the guarded customer block', () => {
  const block = sql.indexOf('DO $boot$')
  for (const table of ['area', 'subarea', 'customercategory', 'subaccounts', 'accounts']) {
    const insert = sql.indexOf(`INSERT INTO dbo.${table}`)
    assert.ok(insert > 0, `the ${table} seed is present`)
    assert.ok(insert < block, `the ${table} seed must not be skipped by the customer guard`)
  }
})
