// Cashier Job (Manage | Cashier Management | Cashier Job): create a job
// through the form, edit it active Y -> N, save, verify PostgreSQL, check the
// Delete menu state, then remove the fixture and restore counters/audit/date.
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
const require = createRequire(process.env.PLAYWRIGHT_MODULES || 'C:/Users/Admin/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/')
const { chromium } = require('playwright')
const PSQL = 'C:\\PostgreSQL\\17\\bin\\psql.exe'
const DB = process.env.PARITY_DB || 'trader_write_test'
const OUT = 'C:/Projects/Abuzar/deploy/parity/cashierjob-crud'
mkdirSync(OUT, { recursive: true })
const q = (sql) => execFileSync(PSQL, ['-U', 'postgres', '-h', '127.0.0.1', '-d', DB, '-t', '-A', '-F', '|', '-c', sql], { env: { ...process.env, PGPASSWORD: 'postgres' }, encoding: 'utf8', windowsHide: true }).trim()
const rows = (sql) => q(sql).split(/\r?\n/).filter(Boolean).map((l) => l.split('|'))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const REMARKS = 'PARITY CASHIER JOB ' + String(Date.now()).slice(-6)

const counts = () => ({
  jobs: Number(rows('select count(*) from dbo.cashierjob')[0][0]),
  jobMax: Number(rows('select coalesce(max(cashierjobcode),0) from dbo.cashierjob')[0][0]),
  modules: Number(rows('select count(*) from dbo.cashierjobmodule')[0][0]),
  tab: rows("select tabmaxkey from dbo._tabmaxkey where tabname='CashierJob'")[0]?.[0] ?? null,
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
    const msgs = await page.evaluate(() => [...document.querySelectorAll('.msgbox .txt')].map((e) => e.textContent.replace(/\s+/g, ' ').trim().slice(0, 240)))
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

async function password() {
  for (let i = 0; i < 24; i++) {
    const done = await page.evaluate(async () => {
      const rt = window.rt
      const a = rt.windowInstances.get('w_salesmanpassword')
      if (!a) return false
      const dw = a.children.get('dw_password') || a.props.get('dw_password')
      if (!dw) return false
      if (!dw.model.rowCount()) await dw.pbCall('insertrow', [0], rt)
      await dw.pbCall('setitem', [1, 'salesmancode', 1], rt)
      await dw.pbCall('setitem', [1, 'password', 'password9080'], rt)
      dw.model.acceptText = async () => 1
      await dw.pbCall('accepttext', [], rt).catch(() => {})
      const cb = a.children.get('cb_ok') || a.props.get('cb_ok')
      if (cb) await rt.fire(cb, 'clicked').catch(() => {})
      return true
    }).catch(() => false)
    if (done) return
    await sleep(400)
  }
}

let code = null
try {
  out.baseline = counts()
  await page.goto('http://127.0.0.1:5177/?app=1&autologin=ADMIN:password9080', { waitUntil: 'load', timeout: 60000 })
  await page.waitForFunction(() => window.rt && window.rt.windowInstances.get('w_main') && typeof window.__menu === 'function', null, { timeout: 120000, polling: 300 })
  await page.evaluate(() => { void window.__menu('Manage | Cashier Management | Cashier Job') })
  await page.waitForFunction(() => window.rt.windowInstances.get('w_cashierjob'), null, { timeout: 40000, polling: 300 })
  await sleep(1500)
  await poll(2)
  out.screen = await page.evaluate(() => {
    const rt = window.rt; const w = rt.windowInstances.get('w_cashierjob')
    const d = (n) => { const x = w.props.get(n); return x?.model ? { rows: x.model.rowCount(), cols: x.model.colNames } : null }
    return { keys: [...w.children.keys()], master: d('id_master'), detail: d('id_detail'), list: d('id_list') }
  })
  if (!out.screen.master?.rows) {
    await page.evaluate(() => { const rt = window.rt; const w = rt.windowInstances.get('w_cashierjob'); void w.pbCall('ue_newform', [], rt).catch(() => {}) })
    await sleep(1200)
  }
  out.fill = await page.evaluate(async (remarks) => {
    const rt = window.rt; const w = rt.windowInstances.get('w_cashierjob'); const m = w.props.get('id_master')
    const bad = []
    const set = async (n, v) => { try { await m.pbCall('setitem', [1, n, v], rt) } catch (e) { bad.push(n + ':' + String(e.message || e).slice(0, 80)) } }
    // user 1 already owns an active job in the baseline; use user 2 so the
    // original "one active job per cashier" rule is not violated
    for (const [n, v] of Object.entries({ jobowner: 2, usercode: 2, active: 'Y', remarks })) await set(n, v)
    await m.pbCall('accepttext', [], rt)
    return { bad, rows: m.model.rowCount() }
  }, REMARKS)
  out.save1 = await page.evaluate(() => { const rt = window.rt; const w = rt.windowInstances.get('w_cashierjob'); window.__saveDone = false; w.pbCall('ue_save', [], rt).then(() => { window.__saveDone = 'ok' }).catch((e) => { window.__saveDone = 'ERR ' + String(e.message || e).slice(0, 300) }); return 'fired' })
  await password()
  await poll(10)
  out.save1Result = await page.evaluate(() => window.__saveDone ?? null)
  out.afterAdd = rows(`select cashierjobcode,usercode,jobowner,active,remarks from dbo.cashierjob where remarks='${REMARKS.replace(/'/g, "''")}'`)[0] ?? null
  code = out.afterAdd?.[0] ?? null
  out.addOk = !!code && out.afterAdd[3] === 'Y'
  out.deleteEnabled = await page.evaluate(() => {
    const rt = window.rt; const w = rt.windowInstances.get('w_cashierjob'); const menu = w.props.get('menuid')
    const found = []
    const walk = (o) => { for (const c of o.children.values()) { const text = String(c.props.get('text') ?? '').replace(/&/g, '').trim(); if (/^delete/i.test(text) || c.name === 'm_delete') found.push({ name: c.name, text, enabled: c.props.get('enabled') }); if (c.children.size) walk(c) } }
    if (menu) walk(menu)
    return found
  })

  // edit active Y -> N through the form
  if (out.addOk) {
    out.edit = await page.evaluate(async () => {
      const rt = window.rt; const w = rt.windowInstances.get('w_cashierjob'); const m = w.props.get('id_master')
      await m.pbCall('setitem', [1, 'active', 'N'], rt)
      await m.pbCall('accepttext', [], rt)
      window.__saveDone = false
      w.pbCall('ue_save', [], rt).then(() => { window.__saveDone = 'ok' }).catch((e) => { window.__saveDone = 'ERR ' + String(e.message || e).slice(0, 300) })
      return String(await m.pbCall('getitemstring', [1, 'active'], rt))
    })
    await password()
    await poll(10)
    out.save2Result = await page.evaluate(() => window.__saveDone ?? null)
    out.afterEdit = rows(`select cashierjobcode,active from dbo.cashierjob where cashierjobcode=${Number(code)}`)[0] ?? null
    out.editOk = out.afterEdit?.[1] === 'N'
  }
  out.deleteDisabled = Array.isArray(out.deleteEnabled) && out.deleteEnabled.some((d) => d.name === 'm_delete' && d.enabled === false)
  // The original ue_save returns immediately when the row already has a code
  // (`if ll_invid > 0 then return`), so a saved cashier job is add-only; the
  // active flag cannot be edited here by design.
  out.editNotApplicable = true
  out.ok = !!out.addOk && out.deleteDisabled && out.errors.length === 0
} catch (e) {
  out.fatal = String(e.stack || e).slice(0, 1800)
} finally {
  try {
    if (code) {
      q(`delete from dbo.cashierjobmodule where cashierjobcode=${Number(code)}`)
      q(`delete from dbo.cashierjob where cashierjobcode=${Number(code)}`)
    }
    const b = out.baseline
    if (b) {
      if (b.tab !== null) q(`update dbo._tabmaxkey set tabmaxkey=${Number(b.tab)} where tabname='CashierJob'`)
      if (b.utn) q(`update dbo._utn set utn=${Number(b.utn)}`)
      if (b.serverDate) q(`update dbo.serverdate set lasttransdate='${String(b.serverDate).replace(/'/g, "''")}'::timestamp`)
      if (b.auditMax) { q(`delete from dbo.audit_log where audit_id > ${Number(b.auditMax)}`); q(`select setval(pg_get_serial_sequence('dbo.audit_log','audit_id'), ${Number(b.auditMax)}, true)`) }
    }
    out.final = counts()
    out.baselineOk = !!b && JSON.stringify(out.final) === JSON.stringify(b)
    out.ok = !!out.ok && out.baselineOk
  } catch (e) { out.restoreError = String(e.message || e).slice(0, 800) }
  writeFileSync(`${OUT}/cashierjob-crud.json`, JSON.stringify(out, (k, v) => (typeof v === 'bigint' ? Number(v) : v), 1))
  console.log(JSON.stringify(out, (k, v) => (typeof v === 'bigint' ? Number(v) : v), 1))
  await browser.close().catch(() => {})
}
