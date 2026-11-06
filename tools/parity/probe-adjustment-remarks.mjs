// Adjustment Increase/Decrease: type the header remarks through the real
// editor, save, verify dbo.adjheader.remarks, then remove the adjustment and
// reverse its stock movement/counters exactly.
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
const require = createRequire(process.env.PLAYWRIGHT_MODULES || 'C:/Users/Admin/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/')
const { chromium } = require('playwright')
const PSQL = 'C:\\PostgreSQL\\17\\bin\\psql.exe'
const DB = process.env.PARITY_DB || 'trader_write_test'
const MODE = process.env.MODE || 'inc'
const CFG = {
  inc: { path: 'Maintenance | Adjustment | Increase', win: 'w_adjincrease', label: 'ADJ INCREASE' },
  dec: { path: 'Maintenance | Adjustment | Decrease', win: 'w_adjwindow', label: 'ADJ DECREASE' },
}[MODE]
if (!CFG) throw new Error('MODE must be inc|dec')
const OUT = 'C:/Projects/Abuzar/deploy/parity/adjustment-remarks'
mkdirSync(OUT, { recursive: true })
const q = (sql) => execFileSync(PSQL, ['-U', 'postgres', '-h', '127.0.0.1', '-d', DB, '-t', '-A', '-F', '|', '-c', sql], { env: { ...process.env, PGPASSWORD: 'postgres' }, encoding: 'utf8', windowsHide: true }).trim()
const rows = (sql) => q(sql).split(/\r?\n/).filter(Boolean).map((l) => l.split('|'))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const MARK = 'PARITY ' + CFG.label + ' REMARKS ' + String(Date.now()).slice(-6)

const counts = () => ({
  headers: Number(rows('select count(*) from dbo.adjheader')[0][0]),
  headerMax: Number(rows('select coalesce(max(adjcode),0) from dbo.adjheader')[0][0]),
  details: Number(rows('select count(*) from dbo.adjdetail')[0][0]),
  godown: rows("select currqty::text,lastupdated::text from dbo.godowndetail where icode=9801 and gcode=1")[0] ?? null,
  itemlog: Number(rows('select count(*) from dbo.itemlog')[0][0]),
  stockledger: Number(rows('select count(*) from dbo.stockledger')[0][0]),
  glheader: Number(rows('select count(*) from dbo.glheader')[0][0]),
  glTab: rows("select tabmaxkey from dbo._tabmaxkey where tabname='glheader'")[0]?.[0] ?? null,
  tab: rows("select tabmaxkey from dbo._tabmaxkey where tabname='AdjHeader'")[0]?.[0] ?? null,
  utn: rows('select utn from dbo._utn')[0]?.[0] ?? null,
  serverDate: rows('select lasttransdate::text from dbo.serverdate')[0]?.[0] ?? null,
  audit: Number(rows('select count(*) from dbo.audit_log')[0][0]),
  auditMax: Number(rows('select max(audit_id) from dbo.audit_log')[0][0]),
  fiscal: rows("select prefvalue from dbo.softwarepreferences where name='AutoFiscalizeOnPosting'")[0]?.[0] ?? null,
})

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } })
page.setDefaultTimeout(20000)
const out = { mode: MODE, mark: MARK, fields: [], messages: [], errors: [] }
page.on('pageerror', (e) => out.errors.push(String(e.message || e).slice(0, 400)))

async function drain() {
  const texts = []
  for (let i = 0; i < 24; i++) {
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

let code = null
try {
  out.baseline = counts()
  out.startedAt = rows("select localtimestamp(3)::text")[0][0]
  q("update dbo.softwarepreferences set prefvalue='N' where name='AutoFiscalizeOnPosting'")
  await page.goto('http://127.0.0.1:5177/?app=1&autologin=ADMIN:password9080', { waitUntil: 'load', timeout: 60000 })
  await page.waitForFunction(() => window.rt && window.rt.windowInstances.get('w_main') && typeof window.__menu === 'function', null, { timeout: 90000, polling: 300 })
  await page.evaluate((p) => { void window.__menu(p) }, CFG.path)
  await page.waitForFunction((k) => window.rt.windowInstances.get(k), CFG.win, { timeout: 30000, polling: 300 })
  await sleep(1600)
  await drain()
  out.prepare = await page.evaluate(async ({ win, mark }) => {
    const rt = window.rt
    const w = rt.windowInstances.get(win)
    const m = w.props.get('id_master')
    const d = w.props.get('id_detail')
    if (!d.model.rowCount()) await w.pbCall('ue_newitem', [], rt).catch(() => {})
    if (!m.model.rowCount()) await m.pbCall('insertrow', [0], rt)
    if (!d.model.rowCount()) await d.pbCall('insertrow', [0], rt)
    const set = async (dw, row, k, v) => { try { await dw.pbCall('setitem', [row, k, v], rt) } catch { /* recorded by caller */ } }
    await set(m, 1, 'date', '2026-11-06 00:00:00')
    await set(m, 1, 'acccode', 311)
    await set(m, 1, 'remarks', 'SEED REMARK')
    await set(d, 1, 'itemname', 'FACE MASK ')
    await set(d, 1, 'icode', 9801)
    await set(d, 1, 'looseqty', 1)
    await set(d, 1, 'price', 10)
    await set(d, 1, 'gcode', 1)
    await set(d, 1, 'stock', 18035)
    await set(d, 1, 'totalstock', 18035)
    await set(d, 1, 'currstock', 18035)
    await set(d, 1, 'batch', '.')
    await set(d, 1, 'expiry', '2030-12-12 00:00:00')
    await set(d, 1, 'priority', 1)
    await m.pbCall('accepttext', [], rt).catch(() => {})
    await d.pbCall('accepttext', [], rt).catch(() => {})
    const view = rt.ui.views.get(w)
    view?.ctlViews?.get?.(m)?.el?.setAttribute('data-parity-dw', 'master')
    return { masterRows: m.model.rowCount(), detailRows: d.model.rowCount(), masterCols: m.model.colNames, detailCols: d.model.colNames }
  }, { win: CFG.win, mark: MARK })
  out.messages.push(...await drain())

  // type remarks through the real editor
  const rec = { field: 'remarks', value: MARK }
  const cell = page.locator('[data-parity-dw="master"] .o[data-obj="remarks"]').first()
  if (!(await cell.count())) rec.skipped = 'not rendered'
  else {
    await cell.scrollIntoViewIfNeeded().catch(() => {})
    await cell.click({ force: true })
    await sleep(250)
    const ed = page.locator('.dw-edit').last()
    if (!(await ed.count())) rec.skipped = 'no editor'
    else {
      await ed.fill(MARK)
      await page.keyboard.press('Tab')
      await sleep(600)
      out.messages.push(...await drain())
      rec.got = await page.evaluate(async ({ win }) => {
        const rt = window.rt
        const w = rt.windowInstances.get(win)
        const m = w.props.get('id_master')
        try { return String(await m.pbCall('getitemstring', [1, 'remarks'], rt)) } catch { /* raw */ }
        const mm = m.model
        const v = mm.buf.primary[0]?.v[mm.colIndex('remarks')]
        return v === null || v === undefined ? '' : String(v)
      }, { win: CFG.win })
      rec.applied = rec.got === MARK
    }
  }
  out.fields.push(rec)
  out.fieldOk = !!rec.applied

  out.save = await page.evaluate((win) => {
    const rt = window.rt
    const w = rt.windowInstances.get(win)
    window.__save = false
    void w.pbCall('ue_save', [], rt).then(() => { window.__save = 'ok' }).catch((e) => { window.__save = 'ERR ' + String(e.message || e).slice(0, 400) })
  }, CFG.win)
  await password()
  for (let i = 0; i < 50; i++) { await sleep(500); await drain() }
  out.saveResult = await page.evaluate(() => window.__save ?? null)
  out.db = rows(`select adjcode,remarks,posted from dbo.adjheader where remarks='${MARK.replace(/'/g, "''")}'`)
  code = out.db[0]?.[0] ?? null
  out.dbDetail = code ? rows(`select adjcode,icode,looseqty::text,price::text from dbo.adjdetail where adjcode=${Number(code)}`) : []
  out.stockAfter = rows("select currqty::text from dbo.godowndetail where icode=9801 and gcode=1")[0]?.[0] ?? null
  out.dbOk = !!code && out.db[0][1] === MARK
  out.ok = !!code && out.fieldOk && out.dbOk && out.errors.length === 0
} catch (e) {
  out.fatal = String(e.stack || e).slice(0, 2500)
} finally {
  try {
    if (code) {
      q(`delete from dbo.adjdetail where adjcode=${Number(code)}`)
      q(`delete from dbo.adjheader where adjcode=${Number(code)}`)
    }
    // undo any stock movement this probe made (new UTNs / new item-log rows)
    if (out.baseline?.utn) q(`delete from dbo.stockledger where utn > ${Number(out.baseline.utn)}`)
    if (out.startedAt) q(`delete from dbo.itemlog where icode=9801 and lastupdate > '${out.startedAt.replace(/'/g, "''")}'::timestamp`)
    if (out.baseline?.godown) q(`set session_replication_role=replica; update dbo.godowndetail set currqty=${Number(out.baseline.godown[0])}, lastupdated='${String(out.baseline.godown[1]).replace(/'/g, "''")}' where icode=9801 and gcode=1; set session_replication_role=origin`)
    if (out.baseline?.glTab !== null) q(`update dbo._tabmaxkey set tabmaxkey=${Number(out.baseline.glTab)} where tabname='glheader'`)
    if (out.baseline?.tab !== null) q(`update dbo._tabmaxkey set tabmaxkey=${Number(out.baseline.tab)} where tabname='AdjHeader'`)
    if (out.baseline?.utn) q(`update dbo._utn set utn=${Number(out.baseline.utn)}`)
    if (out.baseline?.serverDate) q(`update dbo.serverdate set lasttransdate='${String(out.baseline.serverDate).replace(/'/g, "''")}'::timestamp`)
    if (out.baseline?.fiscal) q(`update dbo.softwarepreferences set prefvalue='${String(out.baseline.fiscal).replace(/'/g, "''")}' where name='AutoFiscalizeOnPosting'`)
    if (out.baseline?.auditMax) { q(`delete from dbo.audit_log where audit_id > ${out.baseline.auditMax}`); q(`select setval(pg_get_serial_sequence('dbo.audit_log','audit_id'), ${out.baseline.auditMax}, true)`) }
    out.final = counts()
    out.baselineOk = JSON.stringify(out.final) === JSON.stringify(out.baseline)
  } catch (e) { out.restoreError = String(e.message || e).slice(0, 800) }
  writeFileSync(`${OUT}/${MODE}.json`, JSON.stringify(out, null, 1))
  console.log(JSON.stringify(out, (k, v) => (typeof v === 'bigint' ? Number(v) : v), 1))
  await browser.close().catch(() => {})
}
