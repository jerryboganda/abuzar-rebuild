// Check Database Integrity: PostgreSQL catalog check wired to the original
// DBCC_History monitor.  Opens the real window, runs wf_checkdb, expects
// "Found 0 Problems", verifies the list is empty, then removes the completion
// row and restores counters/audit/server-date exactly.
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
const require = createRequire(process.env.PLAYWRIGHT_MODULES || 'C:/Users/Admin/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/')
const { chromium } = require('playwright')
const PSQL = 'C:\\PostgreSQL\\17\\bin\\psql.exe'
const DB = process.env.PARITY_DB || 'trader_write_test'
const OUT = 'C:/Projects/Abuzar/deploy/parity/checkdb-crud'
mkdirSync(OUT, { recursive: true })
const q = (sql) => execFileSync(PSQL, ['-U', 'postgres', '-h', '127.0.0.1', '-d', DB, '-t', '-A', '-F', '|', '-c', sql], { env: { ...process.env, PGPASSWORD: 'postgres' }, encoding: 'utf8', windowsHide: true }).trim()
const rows = (sql) => q(sql).split(/\r?\n/).filter(Boolean).map((l) => l.split('|'))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const counts = () => ({
  history: Number(rows('select count(*) from dbo.dbcc_history')[0][0]),
  historyMax: Number(rows('select coalesce(max(rowid),0) from dbo.dbcc_history')[0][0]),
  audit: Number(rows('select count(*) from dbo.audit_log')[0][0]),
  auditMax: Number(rows('select max(audit_id) from dbo.audit_log')[0][0]),
  serverDate: rows('select lasttransdate::text from dbo.serverdate')[0]?.[0] ?? null,
})

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } })
page.setDefaultTimeout(20000)
const out = { messages: [], errors: [] }
page.on('pageerror', (e) => out.errors.push(String(e.message || e).slice(0, 400)))

async function poll(seconds = 30) {
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
      return msgs
    }
  }
  return []
}

try {
  out.baseline = counts()
  await page.goto('http://127.0.0.1:5177/?app=1&autologin=ADMIN:password9080', { waitUntil: 'load', timeout: 60000 })
  await page.waitForFunction(() => window.rt && window.rt.windowInstances.get('w_main') && typeof window.__menu === 'function', null, { timeout: 120000, polling: 300 })
  await page.evaluate(() => { void window.__menu('Maintenance | Database Utilities | Check Database Integrity') })
  await page.waitForFunction(() => window.rt.windowInstances.get('w_checkdb'), null, { timeout: 40000, polling: 300 })
  await sleep(1500)
  out.window = await page.evaluate(() => {
    const w = window.rt.windowInstances.get('w_checkdb')
    return { title: String(w.props.get('title') ?? ''), detail: w.props.get('id_list')?.model?.rowCount?.() ?? null }
  })
  await page.evaluate(() => {
    const rt = window.rt; const w = rt.windowInstances.get('w_checkdb')
    void w.pbCall('wf_checkdb', [], rt).catch(() => {})
  })
  out.messages.push(...await poll(60))
  out.listRows = await page.evaluate(() => {
    const rt = window.rt; const w = rt.windowInstances.get('w_checkdb')
    return w?.props.get('id_list')?.model?.rowCount?.() ?? null
  })
  out.zeroProblems = out.messages.some((m) => /Found 0 Problems/i.test(m))
  out.ok = !!out.zeroProblems && out.listRows === 0
} catch (e) {
  out.fatal = String(e.stack || e).slice(0, 1800)
} finally {
  try {
    const b = out.baseline
    if (b?.historyMax) q(`delete from dbo.dbcc_history where rowid > ${Number(b.historyMax)}`)
    if (b?.serverDate) q(`update dbo.serverdate set lasttransdate='${String(b.serverDate).replace(/'/g, "''")}'::timestamp`)
    if (b?.auditMax) { q(`delete from dbo.audit_log where audit_id > ${Number(b.auditMax)}`); q(`select setval(pg_get_serial_sequence('dbo.audit_log','audit_id'), ${Number(b.auditMax)}, true)`) }
    out.final = counts()
    out.baselineOk = !!b && JSON.stringify(out.final) === JSON.stringify(b)
    out.ok = !!out.ok && out.baselineOk
  } catch (e) { out.restoreError = String(e.message || e).slice(0, 800) }
  writeFileSync(`${OUT}/checkdb-crud.json`, JSON.stringify(out, null, 1))
  console.log(JSON.stringify(out, null, 1))
  await browser.close().catch(() => {})
}
