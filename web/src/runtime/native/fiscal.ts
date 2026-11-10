// FBR fiscalization of sale and sale-return invoices, reproduced on PostgreSQL.
//
// The original fiscalized a posted invoice in one of two ways (preference FiscalizationMethod):
//  1  the stored procedure SP_FiscalizeSaleInvoice / SP_FiscalizeSRInvoice, which built the invoice JSON and called the
//     local FBR IMS service through MSXML2.ServerXMLHttp inside SQL Server (sp_OACreate);
//  2  `S<code>` / `R<code>` over TCP to the vendor's FiscalizationApp (a separate PowerBuilder listener) that retrieved
//     d_saleinvoice_json / d_srinvoice_json, posted the JSON to the IMS service and wrote the fiscal invoice number back.
// Neither works on PostgreSQL: there is no sp_OACreate, and the FiscalizationApp reads and writes SQL Server - pointed at
// by a rebuild client it would fiscalize the SQL Server invoice that happens to have the same number.  Both are reproduced
// here from the recovered code (the FiscalizationApp's scripts were decompiled from fiscalizationapp.pbd, its two JSON
// DataWindows are identical to the main application's): same requests, same answer parsing, same writes, same texts.
import type { Runtime } from '../interp.ts'
import { Ref } from '../interp.ts'
import { authHeaders } from '../apiauth.ts'
import { toWire } from '../wire.ts'
import type { NTransaction } from './transaction.ts'
import type { NDwBase } from './dwctrl.ts'
import type { ProcSig } from './procs.ts'

const TEST_URL = 'http://localhost:8524/api/IMSFiscal/Get'
const INVOICE_URL = 'http://localhost:8524/api/IMSFiscal/GetInvoiceNumberByModel'

export interface InetReply {
  ok: boolean
  status?: number
  body?: string
  error?: string
}

/** an HTTP request to the local FBR IMS service (PowerBuilder Inet GetURL / PostURL, MSXML2.ServerXMLHttp).  A browser
 * cannot call that service, so the server sends it; it only reaches this computer or the local network. */
export async function inetRequest(url: string, method: 'GET' | 'POST', body = ''): Promise<InetReply> {
  try {
    const base = (globalThis as { __TRADER_API_BASE__?: string }).__TRADER_API_BASE__ ?? ''
    const r = await fetch(base + '/api/inet', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ url, method, body, content_type: 'application/json' }),
    })
    if (!r.ok) return { ok: false, error: `HTTP ${r.status}` }
    return (await r.json()) as InetReply
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/** PowerBuilder Mid(s, start, length) with 1-based start; a length below 1 gives "" */
function mid(s: string, start: number, length: number): string {
  return length > 0 ? s.substr(start - 1, length) : ''
}

/** the fiscal invoice number in an IMS answer (u_fbr_response.internetdata): `{"InvoiceNumber":"<no>","Code":"100",...}` */
export function fbrResponse(data: string): { ok: true; msg: string } | { ok: false; msg: string } {
  const token = '","Code":"100"'
  const pos = data.indexOf(token) + 1
  if (pos > 0) return { ok: true, msg: mid(data, 19, pos - 19) }
  return { ok: false, msg: 'fiscalization not done successfully\r\nDetails are:-\r\n' + data }
}

async function preference(db: NonNullable<NTransaction['db']>, name: string): Promise<string | null> {
  const r = await db.query('SELECT prefvalue FROM dbo.softwarepreferences WHERE lower(name) = lower($1)', [name])
  const v = r.rows[0]?.[0]
  return v === null || v === undefined ? null : String(v)
}

/** f_fiscalizesaleinvoice / f_fiscalizesrinvoice of the FiscalizationApp: 0 = fiscalized (or nothing to do), 1 = failed */
export async function fiscalizeInvoice(rt: Runtime, sale: boolean, code: number): Promise<{ ret: number; text: string }> {
  const trans = (await rt.instantiate('u_transaction')) as NTransaction
  await rt.fire(trans, 'constructor')
  try {
    if ((await trans.n_connect()) !== 1 || Number(trans.props.get('sqlcode')) !== 0) {
      return { ret: 1, text: 'Fiscalization failed, Database Connection Error.' }
    }
    const db = trans.db!
    const ds = (await rt.instantiate('datastore')) as NDwBase
    try {
      ds.setNative('dataobject', sale ? 'd_saleinvoice_json' : 'd_srinvoice_json')
      await ds.n_settransobject(trans)
      const rows = await ds.n_retrieve(code)
      if (rows <= 0) return { ret: 0, text: '' }
      if (Number(await ds.n_getitemnumber(1, 'rowid')) === 0 && Number(await ds.n_getitemnumber(1, 'itemcount')) === 0) {
        return { ret: 1, text: 'Fiscalization Error-3: ' + (sale ? '\r\nInvoice Details Does Not Exist.' : '\r\nS/R Invoice Details Does Not Exist.') }
      }
      const test = (await preference(db, 'UseFBRTestService')) === 'Y'
      const url = (test ? await preference(db, 'FBRTestServiceURL') : await preference(db, 'FBRInvoiceServiceURL')) || (test ? TEST_URL : INVOICE_URL)
      // PowerScript concatenation: a NULL JSON row makes the whole request NULL
      let params: string | null = ''
      for (let row = 1; row <= rows; row++) {
        const json = (await ds.n_getitemstring(row, 'json')) as string | null
        params = params === null || json === null ? null : params + json
      }
      if (params !== null && params.endsWith(',')) params = params.slice(0, -1)
      params = params === null ? null : params + ']}'
      const reply = test ? await inetRequest(url + '?' + (params ?? ''), 'GET') : await inetRequest(url, 'POST', params ?? '')
      if (!reply.ok) {
        const errtext = 'Cannot invoke FBR Web service\r\n' + '' + '\r\nDetails are:-\r\n' + ''
        return { ret: 1, text: 'Fiscalization Error-1: \r\n' + errtext }
      }
      const data = reply.body ?? ''
      const fbr = fbrResponse(data)
      if (!fbr.ok) {
        return { ret: 1, text: (sale ? 'Fiscalization Error-2: ' : 'Fiscalization Error-2: \r\n') + fbr.msg + '\r\nDetails are:-\r\n' + data }
      }
      const text = (sale ? 'Fiscalization Done, Fiscal Invoice No.: ' : 'Fiscalization Done, Fiscal Invoice No.:') + fbr.msg
      try {
        await db.exec(sale
          ? "UPDATE dbo.saleledger SET fiscalized = 'Y', fiscalizedon = localtimestamp(3), fiscalinvoiceno = $1 WHERE saleinvcode = $2"
          : "UPDATE dbo.srledger SET fiscalized = 'Y', fiscalizedon = localtimestamp(3), fiscalinvoiceno = $1 WHERE srinvcode = $2 AND fiscalized = 'N'",
        [fbr.msg, code])
      } catch {
        // the PostURL result (1) stays the return code: the listener answers "0" and nothing is committed
        return { ret: 1, text }
      }
      await db.commit()
      rt.invalidateRetrieveCache()
      return { ret: 0, text }
    } finally {
      ds.destroy()
    }
  } finally {
    trans.destroy()
  }
}

/** u_tabpg_tcpip_listen.ue_listen of the FiscalizationApp: the answer to one message ("1" fiscalized, "0" failed), or
 * null when the listener sends nothing (no invoice code, an unknown request, the Google-Charts QR code request `Q`) */
export async function fiscalListener(rt: Runtime, message: string): Promise<string | null> {
  if (!message.length) return null
  const code = Math.trunc(Number(message.slice(1).trim()))
  if (!(code > 0)) return null
  const kind = message.charAt(0)
  if (kind !== 'S' && kind !== 'R') {
    // `Q<code>`: a QR code image fetched from chart.apis.google.com (QRCodePrintingMethodInSale = H); the rebuild draws
    // QR codes itself (method Q), so this request is answered with nothing, as when Google cannot be reached
    return null
  }
  console.info(`[fiscal] Request Received for ${kind === 'S' ? 'Sale' : 'S/R'} Invoice #: ${message}`)
  const r = await fiscalizeInvoice(rt, kind === 'S', code)
  console.info('[fiscal] ' + r.text)
  return r.ret === 0 ? '1' : '0'
}

/** SP_FiscalizeSaleInvoice / SP_FiscalizeSRInvoice (FiscalizationMethod 1), on the caller's transaction: the return code,
 * a raised error sets SQLCode -1 with its text as the original RaisError did */
export async function fiscalizeProcedure(t: NTransaction, sigs: Record<string, ProcSig>, sale: boolean, args: unknown[]): Promise<number> {
  const db = await t.ensureDb()
  if (!db) return -1
  const arg = args[0] instanceof Ref ? args[0].get() : args[0]
  const code = Math.trunc(Number(toWire(arg)))
  const what = sale ? 'Sale Invoice' : 'Sale Return Invoice'
  const fail = (message: string): number => {
    t.setError(-1, message)
    return -1
  }
  try {
    const done = await db.query(sale
      ? "SELECT coalesce(max(fiscalized), 'N') FROM dbo.saleledger WHERE saleinvcode = $1"
      : "SELECT coalesce(max(fiscalized), 'N') FROM dbo.srledger WHERE srinvcode = $1", [code])
    if (String(done.rows[0]?.[0] ?? 'N') === 'Y') {
      t.setOk(0)
      return 0
    }
    const test = ((await preference(db, 'UseFBRTestService')) ?? 'Y') === 'Y'
    const url = test ? (await preference(db, 'FBRTestServiceURL')) ?? TEST_URL : (await preference(db, 'FBRInvoiceServiceURL')) ?? INVOICE_URL
    const sig = sigs[sale ? 'sp_getsaleinvoice_json' : 'sp_getsrinvoice_json']
    let params = ''
    try {
      const r = await db.call(sig.call, [code, ''])
      const cols = r.columns.map((c) => c.name)
      const rv = r.row?.[cols.indexOf('return_value')]
      params = String(r.row?.[cols.indexOf('json')] ?? '')
      if (rv !== null && rv !== undefined && Number(rv) !== 0) return fail(`Unable to Generate JSON String for Fiscalization of ${what} ${code}`)
    } catch {
      return fail(`Unable to Generate JSON String for Fiscalization of ${what} ${code}`)
    }
    // LEN() ignores trailing blanks
    if (url.trimEnd().length > 0 && params.trimEnd().length > 0) {
      // SP_RequestHttpWebService: GET appends the parameters; a failed request leaves the response NULL
      const reply = test ? await inetRequest(url + '?' + params, 'GET') : await inetRequest(url, 'POST', params)
      const response = reply.ok ? (reply.body ?? '').slice(0, 4000) : null
      if (response === null || !response.includes('"Code":"100"')) return fail(`Unable to Get Fiscal Invoice Code sucessfully for ${what} ${code}`)
      if (response.includes('{"InvoiceNumber":"')) {
        const end = response.indexOf('","Code":"100"') + 1
        const fiscal = mid(response, 19, end - 19)
        await db.exec(sale
          ? "UPDATE dbo.saleledger SET fiscalized = 'Y', fiscalizedon = localtimestamp(3), fiscalinvoiceno = $1 WHERE saleinvcode = $2"
          : "UPDATE dbo.srledger SET fiscalized = 'Y', fiscalizedon = localtimestamp(3), fiscalinvoiceno = $1 WHERE srinvcode = $2",
        [fiscal, code])
      }
    }
    t.setOk(0)
    return 0
  } catch (e) {
    return fail((e as Error).message)
  }
}
