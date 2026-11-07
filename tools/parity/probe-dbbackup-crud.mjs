// Backup Database: the PostgreSQL pg_dump equivalent of the original
// `BACKUP DATABASE ... WITH INIT`.  Opens the real window, presses Backup,
// waits for "BackUp Successful", verifies the dump file on disk, removes it,
// and checks that no database counter/audit value changed.
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
const require = createRequire(process.env.PLAYWRIGHT_MODULES || 'C:/Users/Admin/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/')
const { chromium } = require('playwright')
const PSQL = 'C:\\PostgreSQL\\17\\bin\\psql.exe'
const DB = process.env.PARITY_DB || 'trader_write_test'
const OUT = 'C:/Projects/Abuzar/deploy/parity/dbbackup-crud'
mkdirSync(OUT, { recursive: true })
const DUMP = process.env.PARITY_BACKUP_FILE || 'C:/Projects/Abuzar/files/backups/traderDBDump.dump'
const q = (sql) => execFileSync(PSQL, ['-U', 'postgres', '-h', '127.0.0.1', '-d', DB, '-t', '-A', '-F', '|', '-c', sql], { env: { ...process.env, PGPASSWORD: 'postgres' }, encoding: 'utf8', windowsHide: true }).trim()
const rows = (sql) => q(sql).split(/\r?\n/).filter(Boolean).map((l) => l.split('|'))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const counts = () => ({
  audit: Number(rows('select count(*) from dbo.audit_log')[0][0]),
  auditMax: Number(rows('select max(audit_id) from dbo.audit_log')[0][0]),
  serverDate: rows('select lasttransdate::text from dbo.serverdate')[0]?.[0] ?? null,
})

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } })
page.setDefaultTimeout(20000)
const out = { dump: DUMP, messages: [], errors: [] }
page.on('pageerror', (e) => out.errors.push(String(e.message || e).slice(0, 400)))

async function poll(seconds = 180) {
  for (let i = 0; i < seconds; i++) {
    await sleep(1000)
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
  rmSync(DUMP, { force: true })
  await page.goto('http://127.0.0.1:5177/?app=1&autologin=ADMIN:password9080', { waitUntil: 'load', timeout: 60000 })
  await page.waitForFunction(() => window.rt && window.rt.windowInstances.get('w_main') && typeof window.__menu === 'function', null, { timeout: 120000, polling: 300 })
  await page.evaluate(() => { void window.__menu('Maintenance | Database Utilities | Backup Database') })
  await page.waitForFunction(() => window.rt.windowInstances.get('w_dbbackup1'), null, { timeout: 40000, polling: 300 })
  await sleep(800)
  out.window = await page.evaluate(() => {
    const w = window.rt.windowInstances.get('w_dbbackup1')
    return { title: String(w.props.get('title') ?? ''), buttons: [...w.children.keys()] }
  })
  await page.evaluate(() => {
    const rt = window.rt; const w = rt.windowInstances.get('w_dbbackup1')
    const cb = w.children.get('cb_backup') || w.props.get('cb_backup')
    if (cb) void rt.fire(cb, 'clicked').catch(() => {})
  })
  out.messages.push(...await poll(180))
  out.dumpExists = existsSync(DUMP)
  out.dumpBytes = out.dumpExists ? statSync(DUMP).size : 0
  out.success = out.messages.some((m) => /BackUp Successful/i.test(m))
  out.ok = out.success && out.dumpExists && out.dumpBytes > 1024
} catch (e) {
  out.fatal = String(e.stack || e).slice(0, 1800)
} finally {
  try { rmSync(DUMP, { force: true }) } catch { /* best effort */ }
  out.final = counts()
  out.baselineOk = !!out.baseline && JSON.stringify(out.final) === JSON.stringify(out.baseline)
  out.ok = !!out.ok && out.baselineOk
  writeFileSync(`${OUT}/dbbackup-crud.json`, JSON.stringify(out, null, 1))
  console.log(JSON.stringify(out, null, 1))
  await browser.close().catch(() => {})
}
