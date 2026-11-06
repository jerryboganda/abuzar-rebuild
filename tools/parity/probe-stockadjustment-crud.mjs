// Stock Adjustment (Maintenance | Adjustment | Stock Adjustment):
// add header + item 9801, save through the form, verify AdjBufferHeader /
// AdjBufferDetail + counter, then delete the buffer rows and restore the
// counter/audit/server-date exactly.
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
const require = createRequire(process.env.PLAYWRIGHT_MODULES || 'C:/Users/Admin/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/')
const { chromium } = require('playwright')
const PSQL = 'C:\\PostgreSQL\\17\\bin\\psql.exe'
const DB = process.env.PARITY_DB || 'trader_write_test'
const OUT = 'C:/Projects/Abuzar/deploy/parity/stockadjustment-crud'
mkdirSync(OUT, { recursive: true })
const q = (sql) => execFileSync(PSQL, ['-U', 'postgres', '-h', '127.0.0.1', '-d', DB, '-t', '-A', '-F', '|', '-c', sql], { env: { ...process.env, PGPASSWORD: 'postgres' }, encoding: 'utf8', windowsHide: true }).trim()
const rows = (sql) => q(sql).split(/\r?\n/).filter(Boolean).map((l) => l.split('|'))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const REMARKS = 'PARITY STOCK ADJUSTMENT ' + String(Date.now()).slice(-6)
const ITEM = 9801

const counts = () => ({
  headers: Number(rows('select count(*) from dbo.adjbufferheader')[0][0]),
  headerMax: Number(rows('select coalesce(max(adjbuffercode),0) from dbo.adjbufferheader')[0][0]),
  details: Number(rows('select count(*) from dbo.adjbufferdetail')[0][0]),
  tab: rows("select tabmaxkey from dbo._tabmaxkey where tabname='AdjBufferHeader'")[0]?.[0] ?? null,
  stock: rows(`select currqty::text,lastupdated::text from dbo.godowndetail where icode=${ITEM} and gcode=1`)[0] ?? null,
  utn: rows('select utn from dbo._utn')[0]?.[0] ?? null,
  serverDate: rows('select lasttransdate::text from dbo.serverdate')[0]?.[0] ?? null,
  audit: Number(rows('select count(*) from dbo.audit_log')[0][0]),
  auditMax: Number(rows('select max(audit_id) from dbo.audit_log')[0][0]),
})

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } })
page.setDefaultTimeout(20000)
const out = { remarks: REMARKS, messages: [], errors: [] }
page.on('pageerror', (e) => out.errors.push(String(e.message || e).slice(0, 400)))

async function poll(seconds = 8) {
  for (let i = 0; i < seconds * 2; i++) {
    await sleep(500)
    const msgs = await page.evaluate(() => [...document.querySelectorAll('.msgbox .txt')].map((e) => e.textContent.replace(/\s+/g, ' ').trim().slice(0, 220)))
    if (msgs.length) {
      out.messages.push(...msgs)
      await page.evaluate(() => {
        for (const b of document.querySelectorAll('.msgbox')) {
          const bs = [...b.querySelectorAll('.btns button')]
          ;(bs.find((x) => /^(ok|yes)$/i.test(x.textContent.trim())) || bs[0])?.click()
        }
      })
      await sleep(250)
    }
  }
}

let code = null
try {
  out.baseline = counts()
  await page.goto('http://127.0.0.1:5177/?app=1&autologin=ADMIN:password9080', { waitUntil: 'load', timeout: 60000 })
  await page.waitForFunction(() => window.rt && window.rt.windowInstances.get('w_main') && typeof window.__menu === 'function', null, { timeout: 120000, polling: 300 })
  await page.evaluate(() => { void window.__menu('Maintenance | Adjustment | Stock Adjustment') })
  await page.waitForFunction(() => window.rt.windowInstances.get('w_adjbuffer'), null, { timeout: 40000, polling: 300 })
  await sleep(1600)
  await poll(2)
  out.screen = await page.evaluate(async ({ item, remarks }) => {
    const rt = window.rt; const w = rt.windowInstances.get('w_adjbuffer')
    const m = w.props.get('id_master'); const d = w.props.get('id_detail')
    if (!m.model.rowCount()) await m.pbCall('insertrow', [0], rt)
    if (!d.model.rowCount()) await d.pbCall('insertrow', [0], rt)
    const bad = []
    const set = async (dw, n, v) => { try { await dw.pbCall('setitem', [1, n, v], rt) } catch (e) { bad.push(n + ':' + String(e.message || e).slice(0, 60)) } }
    await set(m, 'gcode', 1)
    await set(m, 'remarks', remarks)
    await set(m, 'modifieddate', '2026-11-06 00:00:00')
    await set(d, 'itemname', 'FACE MASK ')
    await set(d, 'icode', item)
    await set(d, 'stockonshelf', 0)
    await set(d, 'stockinhand', 0)
    await m.pbCall('accepttext', [], rt).catch(() => {})
    await d.pbCall('accepttext', [], rt).catch(() => {})
    return { masterRows: m.model.rowCount(), detailRows: d.model.rowCount(), bad, mcols: m.model.colNames, dcols: d.model.colNames }
  }, { item: ITEM, remarks: REMARKS })
  await poll(2)
  out.save = await page.evaluate(() => {
    const rt = window.rt; const w = rt.windowInstances.get('w_adjbuffer')
    window.__saveDone = false
    w.pbCall('ue_save', [], rt).then(() => { window.__saveDone = 'ok' }).catch((e) => { window.__saveDone = 'ERR ' + String(e.message || e).slice(0, 300) })
    return 'fired'
  })
  await poll(10)
  out.saveResult = await page.evaluate(() => window.__saveDone ?? null)
  out.after = {
    header: rows(`select adjbuffercode,gcode,remarks from dbo.adjbufferheader where remarks='${REMARKS.replace(/'/g, "''")}'`)[0] ?? null,
    detail: rows(`select adjbuffercode,icode,stockinhand::text,stockonshelf::text from dbo.adjbufferdetail where adjbuffercode=(select max(adjbuffercode) from dbo.adjbufferheader)`),
  }
  code = out.after.header?.[0] ?? null
  out.addOk = !!code && out.after.detail.length === 1 && out.after.detail[0][1] === String(ITEM)
  out.ok = !!out.addOk && out.errors.length === 0
} catch (e) {
  out.fatal = String(e.stack || e).slice(0, 1800)
} finally {
  try {
    if (code) {
      q(`delete from dbo.adjbufferdetail where adjbuffercode=${Number(code)}`)
      q(`delete from dbo.adjbufferheader where adjbuffercode=${Number(code)}`)
    }
    const b = out.baseline
    if (b) {
      if (b.tab !== null) q(`update dbo._tabmaxkey set tabmaxkey=${Number(b.tab)} where tabname='AdjBufferHeader'`)
      if (b.utn) q(`update dbo._utn set utn=${Number(b.utn)}`)
      if (b.serverDate) q(`update dbo.serverdate set lasttransdate='${String(b.serverDate).replace(/'/g, "''")}'::timestamp`)
      if (b.auditMax) { q(`delete from dbo.audit_log where audit_id > ${Number(b.auditMax)}`); q(`select setval(pg_get_serial_sequence('dbo.audit_log','audit_id'), ${Number(b.auditMax)}, true)`) }
    }
    out.final = counts()
    out.baselineOk = !!out.baseline && JSON.stringify(out.final) === JSON.stringify(out.baseline)
    out.ok = !!out.ok && out.baselineOk
  } catch (e) { out.restoreError = String(e.message || e).slice(0, 800) }
  writeFileSync(`${OUT}/stockadjustment-crud.json`, JSON.stringify(out, (k, v) => (typeof v === 'bigint' ? Number(v) : v), 1))
  console.log(JSON.stringify(out, (k, v) => (typeof v === 'bigint' ? Number(v) : v), 1))
  await browser.close().catch(() => {})
}
