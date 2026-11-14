// Round-trip savings of the HTTP database session: one-trip session open and the short memory of identical SELECTs.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { HttpDb, rememberable } from '../src/app/httpdb.ts'

type Call = { path: string; body: Record<string, unknown> }

function fakeServer(init: boolean): { calls: Call[] } {
  const calls: Call[] = []
  let n = 0
  globalThis.fetch = (async (url: string, opts: { body: string }) => {
    const path = String(url)
    const body = JSON.parse(opts.body) as Record<string, unknown>
    calls.push({ path, body })
    let json: unknown = { ok: true }
    if (path === '/api/session') json = init ? { sid: 's1', init: { timezone: body.timezone } } : { sid: 's1' }
    if (path === '/api/query') json = { columns: [{ name: 'n', type: 'int4' }], rows: [[String(++n)]] }
    if (path === '/api/exec') json = { rowcount: 1 }
    return new Response(JSON.stringify(json), { status: 200, headers: { 'content-type': 'application/json' } })
  }) as typeof fetch
  return { calls }
}

test('a session opens in one round trip when the server applies the time zone', async () => {
  const { calls } = fakeServer(true)
  const db = await new HttpDb('', false).open()
  assert.deepEqual(calls.map((c) => c.path), ['/api/session'])
  assert.equal(calls[0].body.timezone, 'Asia/Karachi')
  await db.rollback()
  assert.deepEqual(calls.map((c) => c.path), ['/api/session'], 'nothing ran: the rollback is not sent')
  await db.exec('UPDATE dbo.item SET active = 1 WHERE icode = $1', [5])
  await db.rollback()
  assert.deepEqual(calls.map((c) => c.path), ['/api/session', '/api/exec', '/api/rollback'], 'no SET TIME ZONE after a rollback')
  await db.commit()
  assert.equal(calls.length, 3, 'nothing ran since the rollback: the commit is not sent')
})

test('an older server still gets the time zone as a query', async () => {
  const { calls } = fakeServer(false)
  await new HttpDb('', false).open()
  assert.deepEqual(calls.map((c) => c.path), ['/api/session', '/api/query'])
  assert.match(String(calls[1].body.sql), /SET TIME ZONE/)
})

test('an identical SELECT right after is answered from memory, a write forgets it', async () => {
  const { calls } = fakeServer(true)
  const db = await new HttpDb('', false).open()
  const a = await db.query('SELECT icode FROM dbo.item WHERE active = $1', [1])
  const b = await db.query('SELECT icode FROM dbo.item WHERE active = $1', [1])
  assert.deepEqual(b, a)
  assert.equal(calls.filter((c) => c.path === '/api/query').length, 1)
  b.rows[0][0] = 'changed by the caller'
  const c = await db.query('SELECT icode FROM dbo.item WHERE active = $1', [1])
  assert.equal(c.rows[0][0], a.rows[0][0], 'callers get their own copy')
  await db.query('SELECT icode FROM dbo.item WHERE active = $1', [0])
  assert.equal(calls.filter((c) => c.path === '/api/query').length, 2, 'other parameters are another query')
  await db.exec('UPDATE dbo.item SET active = 0 WHERE icode = $1', [5])
  await db.query('SELECT icode FROM dbo.item WHERE active = $1', [1])
  assert.equal(calls.filter((c) => c.path === '/api/query').length, 3, 'a write forgets every remembered result')
})

test('statements that depend on the moment or change state are never remembered', () => {
  assert.equal(rememberable('SELECT name FROM dbo.item'), true)
  assert.equal(rememberable('  select a from b'), true)
  for (const sql of [
    "SELECT set_config('app.user', $1, false)",
    'SELECT nextval($1)',
    'SELECT now()',
    'SELECT getdate()',
    'SELECT coalesce(username, \'\'), (now() AT TIME ZONE \'Asia/Karachi\') FROM dbo.users',
    'SELECT * FROM dbo.item FOR UPDATE',
    'SELECT a INTO t FROM b',
    'SELECT * FROM dbo.sp_getmostrecenttransdate($1)',
    'UPDATE dbo.item SET a = 1',
    "SET TIME ZONE 'Asia/Karachi'",
  ]) assert.equal(rememberable(sql), false, sql)
})
