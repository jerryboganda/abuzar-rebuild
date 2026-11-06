// Preferences (Maintenance | Preferences): locate one real preference in the
// tab DataWindows, change it through the form's cb_ok, verify PostgreSQL, then
// reopen the form and set it back before an exact counter/audit/date restore.
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
const require = createRequire(process.env.PLAYWRIGHT_MODULES || 'C:/Users/Admin/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/')
const { chromium } = require('playwright')
const PSQL = 'C:\\PostgreSQL\\17\\bin\\psql.exe'
const DB = process.env.PARITY_DB || 'trader_write_test'
const OUT = 'C:/Projects/Abuzar/deploy/parity/preferences-save'
mkdirSync(OUT, { recursive: true })
const q = (sql) => execFileSync(PSQL, ['-U', 'postgres', '-h', '127.0.0.1', '-d', DB, '-t', '-A', '-F', '|', '-c', sql], { env: { ...process.env, PGPASSWORD: 'postgres' }, encoding: 'utf8', windowsHide: true }).trim()
const rows = (sql) => q(sql).split(/\r?\n/).filter(Boolean).map((l) => l.split('|'))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const PREF = (process.env.PREF || 'showtransitstockinitemlist').toLowerCase()
const VALUE = process.env.VALUE || 'Y'

const counts = () => ({
  pref: rows(`select prefvalue from dbo.softwarepreferences where lower(name)='${PREF}'`)[0]?.[0] ?? null,
  audit: Number(rows('select count(*) from dbo.audit_log')[0][0]),
  auditMax: Number(rows('select max(audit_id) from dbo.audit_log')[0][0]),
  serverDate: rows('select lasttransdate::text from dbo.serverdate')[0]?.[0] ?? null,
})

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } })
page.setDefaultTimeout(20000)
const out = { pref: PREF, target: VALUE, messages: [], errors: [] }
page.on('pageerror', (e) => out.errors.push(String(e.message || e).slice(0, 300)))

async function poll(seconds = 10) {
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

async function openPreferences() {
  await page.evaluate(() => { void window.__menu('Maintenance | Preferences') })
  await page.waitForFunction(() => window.rt.windowInstances.get('w_preferences'), null, { timeout: 40000, polling: 300 })
  await sleep(2200)
  await poll(2)
}

async function setPref(value) {
  return page.evaluate(async ({ pref, value }) => {
    const rt = window.rt; const w = rt.windowInstances.get('w_preferences')
    if (!w) return { error: 'preferences window not open' }
    let hit = null
    const walk = (o) => {
      for (const c of o.children.values()) {
        if (hit) return
        if (c.native === 'datawindow' && c.model) {
          const m = c.model; const ni = m.colIndex('name')
          if (ni >= 0) for (const [i, r] of m.buf.primary.entries()) if (String(r.v[ni]).toLowerCase() === pref) { hit = { c, row: i + 1, old: String(r.v[m.colIndex('prefvalue')]) }; return }
        }
        if (c.children.size) walk(c)
      }
    }
    walk(w)
    if (!hit) return { error: 'preference not in any tab DataWindow', children: [...w.children.keys()] }
    await hit.c.pbCall('setitem', [hit.row, 'prefvalue', value], rt)
    await hit.c.pbCall('accepttext', [], rt).catch(() => {})
    const cb = w.children.get('cb_ok') || w.props.get('cb_ok')
    if (cb) void rt.fire(cb, 'clicked').catch(() => {})
    return { dw: hit.c.name, row: hit.row, old: hit.old, set: String(await hit.c.pbCall('getitemstring', [hit.row, 'prefvalue'], rt)) }
  }, { pref: PREF, value })
}

try {
  out.baseline = counts()
  await page.goto('http://127.0.0.1:5177/?app=1&autologin=ADMIN:password9080', { waitUntil: 'load', timeout: 60000 })
  await page.waitForFunction(() => window.rt && window.rt.windowInstances.get('w_main') && typeof window.__menu === 'function', null, { timeout: 120000, polling: 300 })
  await openPreferences()
  out.set = await setPref(VALUE)
  await poll(12)
  out.after = rows(`select prefvalue from dbo.softwarepreferences where lower(name)='${PREF}'`)[0]?.[0] ?? null
  out.setOk = out.after === String(VALUE)

  // reopen and put the original value back through the same form
  if (out.setOk && out.baseline.pref !== null) {
    await page.evaluate(() => { const rt = window.rt; const w = rt.windowInstances.get('w_preferences'); if (w) void w.pbCall('ue_close', [], rt).catch(() => {}) }).catch(() => {})
    await sleep(600)
    if (!(await page.evaluate(() => !!window.rt.windowInstances.get('w_preferences')))) await openPreferences()
    out.restoreSet = await setPref(out.baseline.pref)
    await poll(12)
    out.restored = rows(`select prefvalue from dbo.softwarepreferences where lower(name)='${PREF}'`)[0]?.[0] ?? null
    out.restoreOk = out.restored === out.baseline.pref
  }
  out.ok = !!out.setOk && !!out.restoreOk && out.errors.length === 0
} catch (e) {
  out.fatal = String(e.stack || e).slice(0, 1800)
} finally {
  try {
    const b = out.baseline
    if (b?.pref !== null && b?.pref !== undefined) q(`update dbo.softwarepreferences set prefvalue='${String(b.pref).replace(/'/g, "''")}' where lower(name)='${PREF}'`)
    if (b?.serverDate) q(`update dbo.serverdate set lasttransdate='${String(b.serverDate).replace(/'/g, "''")}'::timestamp`)
    if (b?.auditMax) { q(`delete from dbo.audit_log where audit_id > ${Number(b.auditMax)}`); q(`select setval(pg_get_serial_sequence('dbo.audit_log','audit_id'), ${Number(b.auditMax)}, true)`) }
    out.final = counts()
    out.baselineOk = !!b && JSON.stringify(out.final) === JSON.stringify(b)
    out.ok = !!out.ok && out.baselineOk
  } catch (e) { out.restoreError = String(e.message || e).slice(0, 800) }
  writeFileSync(`${OUT}/preferences-save.json`, JSON.stringify(out, (k, v) => (typeof v === 'bigint' ? Number(v) : v), 1))
  console.log(JSON.stringify(out, (k, v) => (typeof v === 'bigint' ? Number(v) : v), 1))
  await browser.close().catch(() => {})
}
