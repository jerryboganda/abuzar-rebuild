// Quotation: reopen the existing quotation 1 from the list, edit the header
// remarks through the real editor, save, verify PostgreSQL, then restore the
// original NULL remark and the audit/server-date counters exactly.
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
const require = createRequire(process.env.PLAYWRIGHT_MODULES || 'C:/Users/Admin/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/')
const { chromium } = require('playwright')
const PSQL = 'C:\\PostgreSQL\\17\\bin\\psql.exe'
const DB = process.env.PARITY_DB || 'trader_write_test'
const OUT = 'C:/Projects/Abuzar/deploy/parity/quotation-edit'
mkdirSync(OUT, { recursive: true })
const q = (sql) => execFileSync(PSQL, ['-U', 'postgres', '-h', '127.0.0.1', '-d', DB, '-t', '-A', '-F', '|', '-c', sql], { env: { ...process.env, PGPASSWORD: 'postgres' }, encoding: 'utf8', windowsHide: true }).trim()
const rows = (sql) => q(sql).split(/\r?\n/).filter(Boolean).map((l) => l.split('|'))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const MARK = 'PARITY QUOTATION EDIT ' + String(Date.now()).slice(-6)
const CODE = 1

const counts = () => ({
  headers: Number(rows('select count(*) from dbo.quotationheader')[0][0]),
  headerMax: Number(rows('select coalesce(max(quotationcode),0) from dbo.quotationheader')[0][0]),
  details: Number(rows('select count(*) from dbo.quotationdetail')[0][0]),
  row: rows(`select quotationcode,custcode,remarks,posted,active,invtotal::text,modifiedby from dbo.quotationheader where quotationcode=${CODE}`)[0] ?? null,
  detail: rows(`select quotationcode,icode,qty::text,saleprice::text from dbo.quotationdetail where quotationcode=${CODE} order by icode`),
  tab: rows("select tabmaxkey from dbo._tabmaxkey where tabname='quotation'")[0]?.[0] ?? null,
  serverDate: rows('select lasttransdate::text from dbo.serverdate')[0]?.[0] ?? null,
  audit: Number(rows('select count(*) from dbo.audit_log')[0][0]),
  auditMax: Number(rows('select max(audit_id) from dbo.audit_log')[0][0]),
})

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } })
page.setDefaultTimeout(20000)
const out = { mark: MARK, code: CODE, messages: [], errors: [] }
page.on('pageerror', (e) => out.errors.push(String(e.message || e).slice(0, 400)))

async function drain() {
  const texts = []
  for (let i = 0; i < 30; i++) {
    const t = await page.evaluate(() => {
      const b = document.querySelector('.msgbox')
      if (!b) return null
      const text = (b.querySelector('.txt')?.textContent || '').replace(/\s+/g, ' ').trim()
      const bs = [...b.querySelectorAll('.btns button')]
      ;(bs.find((x) => /^(ok|yes|no|cancel|close)$/i.test(x.textContent.trim())) || bs[0])?.click()
      return text
    })
    if (t === null) break
    texts.push(t)
    await sleep(130)
  }
  return texts
}

async function password() {
  for (let i = 0; i < 24; i++) {
    const done = await page.evaluate(async () => {
      const rt = window.rt
      const a = rt.windowInstances.get('w_salesmanpassword')
      if (!a) return false
      const dw = a.children.get('dw_password') || a.props.get('dw_password')
      if (!dw) return false
      await dw.pbCall('setitem', [1, 'salesmancode', 1], rt)
      await dw.pbCall('setitem', [1, 'password', 'password9080'], rt)
      dw.model.acceptText = async () => 1
      await dw.pbCall('accepttext', [], rt).catch(() => {})
      const cb = a.children.get('cb_ok') || a.props.get('cb_ok')
      if (cb) await rt.fire(cb, 'clicked')
      return true
    }).catch(() => false)
    if (done) return
    await sleep(400)
  }
}

try {
  out.baseline = counts()
  if (!out.baseline.row) throw new Error('quotation 1 is missing')
  await page.goto('http://127.0.0.1:5177/?app=1&autologin=ADMIN:password9080', { waitUntil: 'load', timeout: 60000 })
  await page.waitForFunction(() => window.rt && window.rt.windowInstances.get('w_main') && typeof window.__menu === 'function', null, { timeout: 90000, polling: 300 })
  await page.evaluate(() => { void window.__menu('Sales | Quotation') })
  await page.waitForFunction(() => window.rt.windowInstances.get('w_quotation'), null, { timeout: 30000, polling: 300 })
  await sleep(1500)
  await drain()

  out.open = await page.evaluate(async (code) => {
    const rt = window.rt
    const w = rt.windowInstances.get('w_quotation')
    void w.pbCall('ue_list', [], rt).catch(() => {})
    await new Promise((r) => setTimeout(r, 2500))
    const l = w.props.get('id_list')
    if (!l?.model) return { error: 'no list' }
    const n = await l.n_rowcount()
    const ci = l.model.colIndex('code')
    let row = 0
    for (let i = 1; i <= n; i++) { if (Number(l.model.buf.primary[i - 1]?.v[ci]) === code) { row = i; break } }
    if (!row) return { error: 'quotation not in list', rows: n, cols: l.model.colNames }
    await l.pbCall('setrow', [row], rt)
    await l.n_scrolltorow(row)
    w.props.set('id_dwcontrol', l)
    w.props.set('il_selectedrow', row)
    void w.pbCall('ue_detail', [], rt).catch(() => {})
    await new Promise((r) => setTimeout(r, 2500))
    const m = w.props.get('id_master')
    const d = w.props.get('id_detail')
    if (!m?.model) return { error: 'no master after detail' }
    return { listRows: n, selected: row, masterRows: m.model.rowCount(), detailRows: d?.model?.rowCount?.() ?? 0, masterCode: String(m.model.buf.primary[0]?.v[m.model.colIndex('code')] ?? '') }
  }, CODE)
  out.messages.push(...await drain())

  if (!out.open?.masterCode) throw new Error('quotation detail did not open: ' + JSON.stringify(out.open))
  const cell = await page.evaluateHandle(() => {
    const rt = window.rt
    const w = rt.windowInstances.get('w_quotation')
    const m = w.props.get('id_master')
    return rt.ui.views.get(w)?.ctlViews?.get?.(m)?.el?.querySelector('.o[data-obj="remarks"]') ?? null
  })
  const elem = cell.asElement()
  out.fields = []
  if (!elem) out.fields.push({ field: 'remarks', skipped: 'not rendered' })
  else {
    await elem.scrollIntoViewIfNeeded().catch(() => {})
    await elem.click({ force: true })
    await sleep(250)
    const ed = page.locator('.dw-edit').last()
    if (!(await ed.count())) out.fields.push({ field: 'remarks', skipped: 'no editor' })
    else {
      await ed.fill(MARK)
      await page.keyboard.press('Tab')
      await sleep(700)
      out.messages.push(...await drain())
      const got = await page.evaluate(async () => {
        const rt = window.rt
        const w = rt.windowInstances.get('w_quotation')
        const m = w.props.get('id_master')
        try { return String(await m.pbCall('getitemstring', [1, 'remarks'], rt)) } catch { /* raw */ }
        const mm = m.model
        return String(mm.buf.primary[0]?.v[mm.colIndex('remarks')] ?? '')
      })
      out.fields.push({ field: 'remarks', value: MARK, got, applied: got === MARK })
    }
  }
  out.fieldOk = out.fields.every((f) => f.applied)
  out.save = await page.evaluate(() => {
    const rt = window.rt
    const w = rt.windowInstances.get('w_quotation')
    window.__save = false
    void w.pbCall('ue_save', [], rt).then(() => { window.__save = 'ok' }).catch((e) => { window.__save = 'ERR ' + String(e.message || e).slice(0, 400) })
  })
  await password()
  for (let i = 0; i < 40; i++) { await sleep(500); await drain() }
  out.saveResult = await page.evaluate(() => window.__save ?? null)
  out.db = rows(`select quotationcode,remarks,custcode,posted,active from dbo.quotationheader where quotationcode=${CODE}`)
  out.dbDetail = rows(`select quotationcode,icode,qty::text,saleprice::text from dbo.quotationdetail where quotationcode=${CODE} order by icode`)
  out.dbOk = out.db[0]?.[1] === MARK && JSON.stringify(out.dbDetail) === JSON.stringify(out.baseline.detail)
  out.ok = !!out.fieldOk && out.dbOk && out.errors.length === 0
} catch (e) {
  out.fatal = String(e.stack || e).slice(0, 2500)
} finally {
  try {
    const original = out.baseline?.row?.[2] ?? null
    if (original === null) q(`update dbo.quotationheader set remarks=null where quotationcode=${CODE}`)
    else q(`update dbo.quotationheader set remarks='${String(original).replace(/'/g, "''")}' where quotationcode=${CODE}`)
    const modifiedBy = out.baseline?.row?.[6] ?? null
    if (modifiedBy === null || modifiedBy === '') q(`update dbo.quotationheader set modifiedby=null where quotationcode=${CODE}`)
    else q(`update dbo.quotationheader set modifiedby=${Number(modifiedBy)} where quotationcode=${CODE}`)
    if (out.baseline?.serverDate) q(`update dbo.serverdate set lasttransdate='${String(out.baseline.serverDate).replace(/'/g, "''")}'::timestamp`)
    if (out.baseline?.auditMax) { q(`delete from dbo.audit_log where audit_id > ${out.baseline.auditMax}`); q(`select setval(pg_get_serial_sequence('dbo.audit_log','audit_id'), ${out.baseline.auditMax}, true)`) }
    out.final = counts()
    out.baselineOk = JSON.stringify(out.final) === JSON.stringify(out.baseline)
  } catch (e) { out.restoreError = String(e.message || e).slice(0, 800) }
  writeFileSync(`${OUT}/quotation-edit.json`, JSON.stringify(out, null, 1))
  console.log(JSON.stringify(out, (k, v) => (typeof v === 'bigint' ? Number(v) : v), 1))
  await browser.close().catch(() => {})
}
