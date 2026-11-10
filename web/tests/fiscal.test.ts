import test from 'node:test'
import assert from 'node:assert/strict'
import { fbrResponse, fiscalListener, fiscalizeInvoice, fiscalizeProcedure } from '../src/runtime/native/fiscal.ts'
import type { Runtime } from '../src/runtime/interp.ts'
import type { NTransaction } from '../src/runtime/native/transaction.ts'
import type { ProcSig } from '../src/runtime/native/procs.ts'

const OK = '{"InvoiceNumber":"900001FBR1","Code":"100","Response":"Fiscal Invoice Number generated successfully."}'

interface Sent { url: string; method: string; body: string }

/** global fetch replaced by the /api/inet relay of a fake FBR IMS service */
function fakeInet(answer: (sent: Sent) => { ok: boolean; body?: string; error?: string }): Sent[] {
  const sent: Sent[] = []
  globalThis.fetch = (async (url: string, init: { body: string }) => {
    assert.equal(url, '/api/inet')
    const req = JSON.parse(init.body) as Sent
    sent.push(req)
    return { ok: true, json: async () => answer(req) } as unknown as Response
  }) as typeof fetch
  return sent
}

/** a database session that records statements; `answers` gives query results by SQL fragment */
function fakeDb(answers: Record<string, unknown[][]>, opts: { failExec?: boolean; call?: { return_value: number; json: string } | Error } = {}) {
  const log: { sql: string; params: unknown[] }[] = []
  let commits = 0
  const db = {
    async query(sql: string, params: unknown[]) {
      log.push({ sql, params })
      const key = Object.keys(answers).find((k) => sql.includes(k))
      return { columns: [{ name: 'v', type: 'text' }], rows: key ? answers[key] : [] }
    },
    async exec(sql: string, params: unknown[]) {
      log.push({ sql, params })
      if (opts.failExec) throw new Error('update failed')
      return { rowcount: 1 }
    },
    async call(sql: string, params: unknown[]) {
      log.push({ sql, params })
      if (opts.call instanceof Error) throw opts.call
      const c = opts.call ?? { return_value: 0, json: '' }
      return { columns: [{ name: 'return_value', type: 'int4' }, { name: 'json', type: 'citext' }], row: [c.return_value, c.json], resultsets: [] }
    },
    async commit() { commits++ },
    async rollback() {},
    async close() {},
  }
  return { db, log, commits: () => commits }
}

/** runtime with a fake u_transaction and a datastore holding the given JSON rows (rowid, itemcount, json) */
function fakeRuntime(rows: [number, number, string | null][], db: ReturnType<typeof fakeDb>['db'], connected = true) {
  const destroyed: string[] = []
  const trans = {
    db: connected ? db : null,
    props: new Map<string, unknown>([['sqlcode', connected ? 0 : -1]]),
    async n_connect() { return connected ? 1 : -1 },
    destroy() { destroyed.push('trans') },
  }
  let dataobject = ''
  const ds = {
    setNative(name: string, value: string) { if (name === 'dataobject') dataobject = value },
    async n_settransobject(t: unknown) { assert.equal(t, trans); return 1 },
    async n_retrieve() { return rows.length },
    async n_getitemnumber(row: number, col: string) { return col === 'rowid' ? rows[row - 1][0] : rows[row - 1][1] },
    async n_getitemstring(row: number) { return rows[row - 1][2] },
    destroy() { destroyed.push('ds') },
  }
  let invalidated = 0
  const rt = {
    async instantiate(name: string) { return name === 'u_transaction' ? trans : ds },
    async fire() { return 0 },
    invalidateRetrieveCache() { invalidated++ },
  } as unknown as Runtime
  return { rt, destroyed, dataobject: () => dataobject, invalidated: () => invalidated }
}

/** the preference query is answered per name, as SoftwarePreferences would */
function prefDb(values: Record<string, string>, opts?: Parameters<typeof fakeDb>[1]) {
  const f = fakeDb({}, opts)
  const query = f.db.query
  f.db.query = async (sql: string, params: unknown[]) => {
    if (sql.includes('softwarepreferences')) {
      f.log.push({ sql, params })
      const v = values[String(params[0])]
      return { columns: [{ name: 'prefvalue', type: 'text' }], rows: v === undefined ? [] : [[v]] }
    }
    return query(sql, params)
  }
  return f
}

const HEADER = '{"InvoiceNumber":"","POSID":"1","USIN":"7","Items":['
const ITEM = '{"ItemCode":"A1","Quantity":"1.0000"},'

test('the IMS answer gives the fiscal invoice number as u_fbr_response.internetdata reads it', () => {
  assert.deepEqual(fbrResponse(OK), { ok: true, msg: '900001FBR1' })
  assert.deepEqual(fbrResponse('{"InvoiceNumber":"","Code":"401","Response":"Invalid POSID"}'), {
    ok: false, msg: 'fiscalization not done successfully\r\nDetails are:-\r\n{"InvoiceNumber":"","Code":"401","Response":"Invalid POSID"}',
  })
  // Mid() with a length below 1 is empty
  assert.deepEqual(fbrResponse('","Code":"100"'), { ok: true, msg: '' })
})

test('the listener ignores requests without an invoice code, unknown requests and the Google QR code request', async () => {
  const rt = {} as Runtime
  for (const m of ['', 'S', 'S0', 'Sabc', 'R-4', 'X12', 'Q12', '12']) assert.equal(await fiscalListener(rt, m), null, m)
})

test('a sale invoice is posted to the FBR service as one JSON document and its fiscal number written back', async () => {
  const sent = fakeInet(() => ({ ok: true, status: 200, body: OK } as never))
  const f = prefDb({ UseFBRTestService: 'N', FBRInvoiceServiceURL: 'http://localhost:8524/api/IMSFiscal/GetInvoiceNumberByModel' })
  const r = fakeRuntime([[0, 2, HEADER], [11, 1, ITEM], [12, 1, ITEM]], f.db)
  assert.equal(await fiscalListener(r.rt, 'S7'), '1')
  assert.equal(r.dataobject(), 'd_saleinvoice_json')
  assert.deepEqual(sent, [{ url: 'http://localhost:8524/api/IMSFiscal/GetInvoiceNumberByModel', method: 'POST', body: HEADER + ITEM + ITEM.slice(0, -1) + ']}', content_type: 'application/json' } as never])
  const update = f.log.find((s) => s.sql.startsWith('UPDATE'))!
  assert.match(update.sql, /UPDATE dbo\.saleledger SET fiscalized = 'Y', fiscalizedon = localtimestamp\(3\), fiscalinvoiceno = \$1 WHERE saleinvcode = \$2$/)
  assert.deepEqual(update.params, ['900001FBR1', 7])
  assert.equal(f.commits(), 1)
  assert.equal(r.invalidated(), 1)
  assert.deepEqual(r.destroyed, ['ds', 'trans'])
})

test('a sale return uses its own DataWindow, the test service by GET and updates only an unfiscalized return', async () => {
  const sent = fakeInet(() => ({ ok: true, body: OK }))
  const f = prefDb({ UseFBRTestService: 'Y', FBRTestServiceURL: '' })
  const r = fakeRuntime([[0, 1, HEADER], [3, 1, ITEM]], f.db)
  const out = await fiscalizeInvoice(r.rt, false, 9)
  assert.deepEqual(out, { ret: 0, text: 'Fiscalization Done, Fiscal Invoice No.:900001FBR1' })
  assert.equal(r.dataobject(), 'd_srinvoice_json')
  assert.equal(sent[0].method, 'GET')
  assert.equal(sent[0].url, 'http://localhost:8524/api/IMSFiscal/Get?' + HEADER + ITEM.slice(0, -1) + ']}')
  assert.match(f.log.find((s) => s.sql.startsWith('UPDATE'))!.sql, /WHERE srinvcode = \$2 AND fiscalized = 'N'$/)
})

test('fiscalization failures give the FiscalizationApp texts and leave the invoice unfiscalized', async () => {
  // no details: Error-3
  let f = prefDb({})
  let r = fakeRuntime([[0, 0, HEADER]], f.db)
  assert.deepEqual(await fiscalizeInvoice(r.rt, true, 5), { ret: 1, text: 'Fiscalization Error-3: \r\nInvoice Details Does Not Exist.' })
  assert.deepEqual(await fiscalizeInvoice(r.rt, false, 5), { ret: 1, text: 'Fiscalization Error-3: \r\nS/R Invoice Details Does Not Exist.' })
  // service not reachable: Error-1
  fakeInet(() => ({ ok: false, error: 'Cannot connect' }))
  f = prefDb({})
  r = fakeRuntime([[0, 1, HEADER], [1, 1, ITEM]], f.db)
  assert.deepEqual(await fiscalizeInvoice(r.rt, true, 5), { ret: 1, text: 'Fiscalization Error-1: \r\nCannot invoke FBR Web service\r\n\r\nDetails are:-\r\n' })
  assert.equal(await fiscalListener(r.rt, 'S5'), '0')
  // refused by FBR: Error-2 with the answer
  const refused = '{"InvoiceNumber":"","Code":"401"}'
  fakeInet(() => ({ ok: true, body: refused }))
  assert.deepEqual(await fiscalizeInvoice(r.rt, true, 5), {
    ret: 1, text: 'Fiscalization Error-2: fiscalization not done successfully\r\nDetails are:-\r\n' + refused + '\r\nDetails are:-\r\n' + refused,
  })
  assert.equal(f.log.some((s) => s.sql.startsWith('UPDATE')), false)
  assert.equal(f.commits(), 0)
  // no database connection
  r = fakeRuntime([], f.db, false)
  assert.deepEqual(await fiscalizeInvoice(r.rt, true, 5), { ret: 1, text: 'Fiscalization failed, Database Connection Error.' })
  // an invoice that does not exist: nothing to do, answered as done
  r = fakeRuntime([], prefDb({}).db)
  assert.deepEqual(await fiscalizeInvoice(r.rt, true, 5), { ret: 0, text: '' })
  // a failing write: the listener answers "0" and nothing is committed
  fakeInet(() => ({ ok: true, body: OK }))
  f = prefDb({}, { failExec: true })
  r = fakeRuntime([[0, 1, HEADER], [1, 1, ITEM]], f.db)
  assert.equal((await fiscalizeInvoice(r.rt, true, 5)).ret, 1)
  assert.equal(f.commits(), 0)
})

const SIGS = {
  sp_getsaleinvoice_json: { call: 'SELECT * FROM dbo.sp_getsaleinvoice_json(saleinvcode => $1::integer, "json" => $2)', params: [], inout: ['json'], rs: 0 },
  sp_getsrinvoice_json: { call: 'SELECT * FROM dbo.sp_getsrinvoice_json(srinvcode => $1::integer, "json" => $2)', params: [], inout: ['json'], rs: 0 },
} as Record<string, ProcSig>

function fakeTrans(db: ReturnType<typeof fakeDb>['db']) {
  const state = { code: 0, text: '' }
  const t = {
    async ensureDb() { return db },
    setError(code: number, text: string) { state.code = code; state.text = text },
    setOk() { state.code = 0; state.text = '' },
  } as unknown as NTransaction
  return { t, state }
}

test('SP_FiscalizeSaleInvoice (method 1) posts the procedure JSON in the caller transaction and raises the original errors', async () => {
  const json = '{"InvoiceNumber":"","USIN":"7","Items":[]}'
  let sent = fakeInet(() => ({ ok: true, body: OK }))
  let f = prefDb({ UseFBRTestService: 'N' }, { call: { return_value: 0, json } })
  const fq = f.db.query
  f.db.query = async (sql, params) => sql.includes('max(fiscalized)') ? { columns: [], rows: [['N']] } : fq(sql, params)
  let x = fakeTrans(f.db)
  assert.equal(await fiscalizeProcedure(x.t, SIGS, true, [7, 3]), 0)
  assert.deepEqual(sent.map((s) => [s.method, s.url, s.body]), [['POST', 'http://localhost:8524/api/IMSFiscal/GetInvoiceNumberByModel', json]])
  const update = f.log.find((s) => s.sql.startsWith('UPDATE'))!
  assert.match(update.sql, /WHERE saleinvcode = \$2$/)
  assert.deepEqual(update.params, ['900001FBR1', 7])
  assert.equal(f.commits(), 0, 'the client commits or rolls back')
  // UseFBRTestService missing: ISNULL(..., 'Y') selects the test service by GET
  sent = fakeInet(() => ({ ok: true, body: OK }))
  f = prefDb({}, { call: { return_value: 0, json } })
  x = fakeTrans(f.db)
  assert.equal(await fiscalizeProcedure(x.t, SIGS, false, [9, 3]), 0)
  assert.deepEqual(sent.map((s) => [s.method, s.url]), [['GET', 'http://localhost:8524/api/IMSFiscal/Get?' + json]])
  assert.match(f.log.find((s) => s.sql.startsWith('UPDATE'))!.sql, /UPDATE dbo\.srledger .* WHERE srinvcode = \$2$/)
  // already fiscalized: nothing is sent
  sent = fakeInet(() => ({ ok: true, body: OK }))
  f = prefDb({})
  const fq2 = f.db.query
  f.db.query = async (sql, params) => sql.includes('max(fiscalized)') ? { columns: [], rows: [['Y']] } : fq2(sql, params)
  assert.equal(await fiscalizeProcedure(fakeTrans(f.db).t, SIGS, true, [7, 3]), 0)
  assert.equal(sent.length, 0)
  // the service cannot be reached or refuses: the response check raises
  fakeInet(() => ({ ok: false, error: 'Cannot connect' }))
  x = fakeTrans(prefDb({ UseFBRTestService: 'N' }, { call: { return_value: 0, json } }).db)
  assert.equal(await fiscalizeProcedure(x.t, SIGS, true, [7, 3]), -1)
  assert.deepEqual(x.state, { code: -1, text: 'Unable to Get Fiscal Invoice Code sucessfully for Sale Invoice 7' })
  // the JSON procedure fails
  x = fakeTrans(prefDb({}, { call: { return_value: -1, json: '' } }).db)
  assert.equal(await fiscalizeProcedure(x.t, SIGS, false, [9, 3]), -1)
  assert.equal(x.state.text, 'Unable to Generate JSON String for Fiscalization of Sale Return Invoice 9')
})
