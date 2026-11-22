// Round-trip savings of the HTTP database session: one-trip session open and the short memory of identical SELECTs.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { HttpDb, rememberable } from '../src/app/httpdb.ts'
import { resetQueryMemory, tablesRead, tableWritten } from '../src/app/query-memory.ts'

type Call = { path: string; body: Record<string, unknown> }

/** catalogue rows: [kind, name, writes, dynamic, calls] */
let catalogue: unknown[][] = []

function fakeServer(init: boolean): { calls: Call[] } {
  resetQueryMemory()
  catalogue = []
  const calls: Call[] = []
  let n = 0
  let sids = 0
  globalThis.fetch = (async (url: string, opts: { body: string }) => {
    const path = String(url)
    const body = JSON.parse(opts.body) as Record<string, unknown>
    calls.push({ path, body })
    let json: unknown = { ok: true }
    if (path === '/api/session') json = init ? { sid: 's' + ++sids, init: { timezone: body.timezone } } : { sid: 's' + ++sids }
    if (path === '/api/query') json = /pg_proc/.test(String(body.sql)) ? { columns: [], rows: catalogue } : { columns: [{ name: 'n', type: 'int4' }], rows: [[String(++n)]] }
    if (path === '/api/exec') json = { rowcount: 1 }
    return new Response(JSON.stringify(json), { status: 200, headers: { 'content-type': 'application/json' } })
  }) as typeof fetch
  return { calls }
}

const queries = (calls: Call[]) => calls.filter((c) => c.path === '/api/query' && !/pg_proc/.test(String(c.body.sql))).length

test('a session opens in one round trip when the server applies the time zone', async () => {
  const { calls } = fakeServer(true)
  const db = await new HttpDb('', false).open()
  assert.deepEqual(calls.map((c) => c.path), ['/api/session'])
  assert.equal(calls[0].body.timezone, 'Asia/Karachi')
  await db.rollback()
  assert.deepEqual(calls.map((c) => c.path), ['/api/session'], 'nothing ran: the rollback is not sent')
  await db.exec('UPDATE dbo.item SET active = 1 WHERE icode = $1', [5])
  await db.rollback()
  assert.deepEqual(calls.filter((c) => !/pg_proc/.test(String(c.body.sql))).map((c) => c.path), ['/api/session', '/api/exec', '/api/rollback'], 'no SET TIME ZONE after a rollback')
  await db.commit()
  assert.equal(calls.filter((c) => c.path === '/api/commit').length, 0, 'nothing ran since the rollback: the commit is not sent')
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
  assert.equal(queries(calls), 1)
  b.rows[0][0] = 'changed by the caller'
  const c = await db.query('SELECT icode FROM dbo.item WHERE active = $1', [1])
  assert.equal(c.rows[0][0], a.rows[0][0], 'callers get their own copy')
  await db.query('SELECT icode FROM dbo.item WHERE active = $1', [0])
  assert.equal(queries(calls), 2, 'other parameters are another query')
  await db.exec('UPDATE dbo.item SET active = 0 WHERE icode = $1', [5])
  await db.query('SELECT icode FROM dbo.item WHERE active = $1', [1])
  assert.equal(queries(calls), 3, 'a write forgets every remembered result')
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

test('a drop-down list is remembered for its longer time, until this client writes', async (t) => {
  const { calls } = fakeServer(true)
  const db = await new HttpDb('', false).open()
  const now = Date.now()
  t.mock.method(Date, 'now', () => now)
  await db.query('SELECT accode, name FROM dbo.accounts', [], { rememberMs: 120_000 })
  await db.query('SELECT gcode FROM dbo.godown', [])
  t.mock.method(Date, 'now', () => now + 60_000)
  await db.query('SELECT accode, name FROM dbo.accounts', [], { rememberMs: 120_000 })
  await db.query('SELECT gcode FROM dbo.godown', [])
  assert.equal(queries(calls), 3, 'the list after a minute comes from memory, the plain query does not')
  t.mock.method(Date, 'now', () => now + 121_000)
  await db.query('SELECT accode, name FROM dbo.accounts', [], { rememberMs: 120_000 })
  assert.equal(queries(calls), 4, 'after its time the list is asked again')
  await db.exec('INSERT INTO dbo.accounts (accode) VALUES ($1)', [9])
  await db.query('SELECT accode, name FROM dbo.accounts', [], { rememberMs: 120_000 })
  assert.equal(queries(calls), 5, 'a write of this client shows at once')
})

test('a write forgets only what reads the tables it changes, triggers and called procedures included', async () => {
  const { calls } = fakeServer(true)
  catalogue = [
    ['t', 'customer', 'audit_log', 'f', null],
    ['f', 'sp_virtualgl', 'virtualgl', 'f', 'sp_virtualgl_patient'],
    ['f', 'sp_virtualgl_patient', 'virtualgltemp', 'f', null],
    ['f', 'sp_dynamic', null, 't', null],
  ]
  const a = await new HttpDb('', false).open()
  const b = await new HttpDb('', false).open()
  const lists = ['SELECT name FROM dbo.customer', 'SELECT name FROM dbo.godown', 'SELECT sum(debit) FROM dbo.virtualgl', 'SELECT * FROM dbo.audit_log']
  for (const sql of lists) await a.query(sql, [], { rememberMs: 120_000 })
  for (const sql of lists) await b.query(sql, [], { rememberMs: 120_000 })
  assert.equal(queries(calls), 4, 'another window reuses the lists')
  await a.call('SELECT * FROM dbo.sp_virtualgl(ac_type => $1)', ['A'])
  for (const sql of lists) await b.query(sql, [], { rememberMs: 120_000 })
  assert.equal(queries(calls), 5, 'the procedure (and the one it calls) wrote virtualgl only')
  await a.exec('UPDATE dbo.customer SET name = $1 WHERE acccode = $2', ['x', 1])
  for (const sql of lists) await b.query(sql, [], { rememberMs: 120_000 })
  assert.equal(queries(calls), 7, 'customer and its trigger target audit_log are read again, godown is not')
  await a.commit()
  await a.call('SELECT * FROM dbo.sp_dynamic()', [])
  for (const sql of lists) await b.query(sql, [], { rememberMs: 120_000 })
  assert.equal(queries(calls), 11, 'dynamic SQL in a procedure forgets everything')
})

test('a list read inside an unfinished change is not shared with other windows', async () => {
  const { calls } = fakeServer(true)
  const a = await new HttpDb('', false).open()
  const b = await new HttpDb('', false).open()
  await a.exec('INSERT INTO dbo.customer (name) VALUES ($1)', ['new'])
  await a.query('SELECT name FROM dbo.customer', [], { rememberMs: 120_000 })
  await b.query('SELECT name FROM dbo.customer', [], { rememberMs: 120_000 })
  assert.equal(queries(calls), 2)
  await a.rollback()
})

test('tables read and written are told from the translated SQL', () => {
  assert.deepEqual([...tablesRead('SELECT a.name FROM dbo.accounts AS a, dbo.subaccounts AS s WHERE a.x = (SELECT y FROM dbo.groups)')!].sort(), ['accounts', 'groups', 'subaccounts'])
  assert.deepEqual([...tablesRead("SELECT ltrim(dbo.tsql_str(code)) FROM dbo.motorvehicle")!], ['motorvehicle'])
  assert.equal(tablesRead('SELECT * FROM dbo.fn_items($1)'), undefined, 'a function: reads cannot be told')
  assert.equal(tablesRead('SELECT * FROM item'), undefined, 'an unqualified table')
  assert.equal(tableWritten('INSERT INTO dbo.customer (a) VALUES ($1)'), 'customer')
  assert.equal(tableWritten('update dbo."Item" set a = 1'), 'item')
  assert.equal(tableWritten('DELETE FROM dbo.virtualgl WHERE x = 1'), 'virtualgl')
  assert.equal(tableWritten('INSERT INTO tmp_lt_x VALUES (1)'), null, 'a session temporary table')
  assert.equal(tableWritten("SET TIME ZONE 'Asia/Karachi'"), null)
  assert.equal(tableWritten('INSERT INTO customer VALUES (1)'), '*')
  assert.equal(tableWritten('WITH x AS (DELETE FROM dbo.a RETURNING *) SELECT 1'), '*')
})

test('a read of setup tables only is shared by every window for two minutes, until this client writes one', async (t) => {
  const { calls } = fakeServer(true)
  const a = await new HttpDb('', false).open()
  const b = await new HttpDb('', false).open()
  const now = Date.now()
  t.mock.method(Date, 'now', () => now)
  const setup = 'SELECT purchasegodownstrategy FROM dbo.groups WHERE (groupcode = $1)'
  await a.query(setup, [2])
  t.mock.method(Date, 'now', () => now + 60_000)
  await b.query(setup, [2])
  await b.query('SELECT name FROM dbo.item WHERE (icode = $1)', [1])
  await a.query('SELECT name FROM dbo.item WHERE (icode = $1)', [1])
  assert.equal(queries(calls), 3, 'the setup read comes from memory in the other window; business tables do not')
  await a.query('SELECT g.name FROM dbo.groups AS g, dbo.item AS i', [])
  await b.query('SELECT g.name FROM dbo.groups AS g, dbo.item AS i', [])
  assert.equal(queries(calls), 5, 'a read that also touches a business table is not shared')
  await a.exec('UPDATE dbo.groups SET purchasegodownstrategy = $1', [1])
  await a.commit()
  await b.query(setup, [2])
  assert.equal(queries(calls), 6, 'a change of the setup in this browser shows at once')
})

test('an unfinished change of a session holds back only the lists that read what it changed', async () => {
  const { calls } = fakeServer(true)
  const a = await new HttpDb('', false).open()
  const b = await new HttpDb('', false).open()
  await a.exec('INSERT INTO dbo.tmp_lt_maxdate (d) VALUES ($1)', [1])
  await a.query('SELECT name FROM dbo.godown', [], { rememberMs: 120_000 })
  await b.query('SELECT name FROM dbo.godown', [], { rememberMs: 120_000 })
  assert.equal(queries(calls), 1, 'the list does not read the changed table: shared')
  await a.query('SELECT d FROM dbo.tmp_lt_maxdate', [], { rememberMs: 120_000 })
  await b.query('SELECT d FROM dbo.tmp_lt_maxdate', [], { rememberMs: 120_000 })
  assert.equal(queries(calls), 3, 'the list that reads it is not')
  await a.rollback()
})
