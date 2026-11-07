// Death Certificate (Basic Data | Patient | Death Certificate): open the
// rights-hidden menu item directly, add/save a certificate, verify PostgreSQL,
// then remove it and restore the counter/audit/server-date exactly.
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
const require = createRequire(process.env.PLAYWRIGHT_MODULES || 'C:/Users/Admin/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/')
const { chromium } = require('playwright')
const PSQL = 'C:\\PostgreSQL\\17\\bin\\psql.exe'
const DB = process.env.PARITY_DB || 'trader_write_test'
const OUT = 'C:/Projects/Abuzar/deploy/parity/deathcertificate-crud'
mkdirSync(OUT, { recursive: true })
const q = (sql) => execFileSync(PSQL, ['-U', 'postgres', '-h', '127.0.0.1', '-d', DB, '-t', '-A', '-F', '|', '-c', sql], { env: { ...process.env, PGPASSWORD: 'postgres' }, encoding: 'utf8', windowsHide: true }).trim()
const rows = (sql) => q(sql).split(/\r?\n/).filter(Boolean).map((l) => l.split('|'))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const NAME = 'PARITY DEATH CERT ' + String(Date.now()).slice(-6)

const counts = () => ({
  rows: Number(rows('select count(*) from dbo.deathcertificate')[0][0]),
  max: Number(rows('select coalesce(max(deathcertificatecode),0) from dbo.deathcertificate')[0][0]),
  tab: rows("select tabmaxkey from dbo._tabmaxkey where tabname='DeathCertificate'")[0]?.[0] ?? null,
  patients: Number(rows('select count(*) from dbo.patient')[0][0]),
  patientMax: Number(rows('select coalesce(max(patientcode),0) from dbo.patient')[0][0]),
  patientTab: rows("select tabmaxkey from dbo._tabmaxkey where tabname='Patient'")[0]?.[0] ?? null,
  utn: rows('select utn from dbo._utn')[0]?.[0] ?? null,
  serverDate: rows('select lasttransdate::text from dbo.serverdate')[0]?.[0] ?? null,
  audit: Number(rows('select count(*) from dbo.audit_log')[0][0]),
  auditMax: Number(rows('select max(audit_id) from dbo.audit_log')[0][0]),
})

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } })
page.setDefaultTimeout(20000)
const out = { name: NAME, messages: [], errors: [] }
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

let code = null
let patientCode = null
const PATIENT_REGNO = 'PARITY-PAT-' + String(Date.now()).slice(-6)
try {
  out.baseline = counts()
  // DeathCertificate.PatientCode is NOT NULL with a real FK; the clone's
  // Patient table is empty, so create one disposable patient fixture.
  patientCode = out.baseline.patientMax + 1
  q(`insert into dbo.patient (patientcode,regno,active,name,gender,date,usercode,membershipid)
     values (${Number(patientCode)},'${PATIENT_REGNO}','Y','PARITY PATIENT','M','2026-11-06 00:00:00',1,'')`)
  await page.goto('http://127.0.0.1:5177/?app=1&autologin=ADMIN:password9080', { waitUntil: 'load', timeout: 60000 })
  await page.waitForFunction(() => window.rt && window.rt.windowInstances.get('w_main') && typeof window.__menu === 'function', null, { timeout: 120000, polling: 300 })
  out.menu = await page.evaluate(async () => {
    const rt = window.rt
    const root = rt.windowInstances.get('w_main').props.get('menuid')
    let hit = null
    const walk = (o) => { for (const c of o.children?.values?.() || []) { if (c.name === 'm_deathcertificate') { hit = c; return } walk(c) } }
    if (root) walk(root)
    if (!hit) return { error: 'menu item not found' }
    hit.props.set('text', 'Death Certificate')
    void rt.fire(hit, 'clicked').catch(() => {})
    return { text: String(hit.props.get('text')), visible: hit.props.get('visible'), enabled: hit.props.get('enabled') }
  })
  await page.waitForFunction(() => window.rt.windowInstances.get('w_deathcertificate'), null, { timeout: 40000, polling: 300 })
  await sleep(1500)
  await poll(2)
  await page.evaluate(async () => { const rt = window.rt; const w = rt.windowInstances.get('w_deathcertificate'); await w.pbCall('ue_newform', [], rt).catch(() => {}) })
  await sleep(1000)
  out.fill = await page.evaluate(async ({ name, patientcode, regno }) => {
    const rt = window.rt; const w = rt.windowInstances.get('w_deathcertificate')
    const m = w.props.get('id_master')
    const bad = []
    const set = async (n, v) => { try { await m.pbCall('setitem', [1, n, v], rt) } catch (e) { bad.push(n + ':' + String(e.message || e).slice(0, 70)) } }
    for (const [n, v] of Object.entries({
      patientcode, regno, usercode: 1,
      date: '2026-11-06 00:00:00', dob: '1990-01-01 00:00:00', fullname: name, gender: 'M',
      fathername: 'PARITY FATHER', fathercnic: '12345-1234567-1', fathercellno: '03001234567',
      mothername: 'PARITY MOTHER', mothercnic: '12345-1234567-2', mothercellno: '03007654321',
      ageofmother: 30, placeofdeath: 'PARITY HOSPITAL', causeofdeath: 'PARITY CAUSE',
      doctorname: 'PARITY DOCTOR', hospitalname: 'PARITY HOSPITAL', issuedto: 'PARITY ISSUED TO',
      issuedtocnic: '12345-1234567-3', issuedtocellno: '03001112223', cnic: '12345-1234567-4',
    })) await set(n, v)
    await m.pbCall('accepttext', [], rt).catch(() => {})
    return { bad, rows: m.model.rowCount(), cols: m.model.colNames }
  }, { name: NAME, patientcode: patientCode, regno: PATIENT_REGNO })
  await poll(2)
  out.save = await page.evaluate(() => {
    const rt = window.rt; const w = rt.windowInstances.get('w_deathcertificate')
    window.__saveDone = false
    w.pbCall('ue_save', [], rt).then(() => { window.__saveDone = 'ok' }).catch((e) => { window.__saveDone = 'ERR ' + String(e.message || e).slice(0, 300) })
    return 'fired'
  })
  await poll(10)
  out.saveResult = await page.evaluate(() => window.__saveDone ?? null)
  out.after = rows(`select deathcertificatecode,fullname,gender,fathername,causeofdeath from dbo.deathcertificate where fullname='${NAME.replace(/'/g, "''")}'`)[0] ?? null
  code = out.after?.[0] ?? null
  out.addOk = !!code && out.after[2] === 'M'
  out.deleteState = await page.evaluate(() => {
    const rt = window.rt; const w = rt.windowInstances.get('w_deathcertificate'); const menu = w.props.get('menuid')
    const found = []
    const walk = (o) => { for (const c of o.children.values()) { const text = String(c.props.get('text') ?? '').replace(/&/g, '').trim(); if (/^delete/i.test(text) || c.name === 'm_delete') found.push({ name: c.name, text, enabled: c.props.get('enabled') }); if (c.children.size) walk(c) } }
    if (menu) walk(menu)
    return found
  })
  out.ok = !!out.addOk && out.errors.length === 0
} catch (e) {
  out.fatal = String(e.stack || e).slice(0, 1800)
} finally {
  try {
    if (code) q(`delete from dbo.deathcertificate where deathcertificatecode=${Number(code)}`)
    if (patientCode) q(`delete from dbo.patient where patientcode=${Number(patientCode)}`)
    const b = out.baseline
    if (b) {
      if (b.tab !== null) q(`update dbo._tabmaxkey set tabmaxkey=${Number(b.tab)} where tabname='DeathCertificate'`)
      if (b.patientTab !== null) q(`update dbo._tabmaxkey set tabmaxkey=${Number(b.patientTab)} where tabname='Patient'`)
      if (b.utn) q(`update dbo._utn set utn=${Number(b.utn)}`)
      if (b.serverDate) q(`update dbo.serverdate set lasttransdate='${String(b.serverDate).replace(/'/g, "''")}'::timestamp`)
      if (b.auditMax) { q(`delete from dbo.audit_log where audit_id > ${Number(b.auditMax)}`); q(`select setval(pg_get_serial_sequence('dbo.audit_log','audit_id'), ${Number(b.auditMax)}, true)`) }
    }
    out.final = counts()
    out.baselineOk = !!b && JSON.stringify(out.final) === JSON.stringify(b)
    out.ok = !!out.ok && out.baselineOk
  } catch (e) { out.restoreError = String(e.message || e).slice(0, 800) }
  writeFileSync(`${OUT}/deathcertificate-crud.json`, JSON.stringify(out, (k, v) => (typeof v === 'bigint' ? Number(v) : v), 1))
  console.log(JSON.stringify(out, (k, v) => (typeof v === 'bigint' ? Number(v) : v), 1))
  await browser.close().catch(() => {})
}
