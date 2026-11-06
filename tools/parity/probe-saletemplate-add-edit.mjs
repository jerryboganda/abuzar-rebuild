// Sale Template (Basic Data | Sale Template): add header + item detail, save,
// edit the header name, save again, verify PostgreSQL, record the original
// enabled-but-inert File | Delete, then remove the fixture and restore the
// counter/audit/server-date exactly.
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
const require = createRequire(process.env.PLAYWRIGHT_MODULES || 'C:/Users/Admin/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/')
const { chromium } = require('playwright')
const PSQL = 'C:\\PostgreSQL\\17\\bin\\psql.exe'
const DB = process.env.PARITY_DB || 'trader_write_test'
const OUT = 'C:/Projects/Abuzar/deploy/parity/saletemplate-add-edit'
mkdirSync(OUT, { recursive: true })
const q = (sql) => execFileSync(PSQL, ['-U', 'postgres', '-h', '127.0.0.1', '-d', DB, '-t', '-A', '-F', '|', '-c', sql], { env: { ...process.env, PGPASSWORD: 'postgres' }, encoding: 'utf8', windowsHide: true }).trim()
const rows = (sql) => q(sql).split(/\r?\n/).filter(Boolean).map((l) => l.split('|'))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const NAME = 'PARITY TEMPLATE ' + String(Date.now()).slice(-6)

const counts = () => ({
  headers: Number(rows('select count(*) from dbo.saletemplateheader')[0][0]),
  headerMax: Number(rows('select coalesce(max(saletemplatecode),0) from dbo.saletemplateheader')[0][0]),
  details: Number(rows('select count(*) from dbo.saletemplatedetail')[0][0]),
  tab: rows("select tabmaxkey from dbo._tabmaxkey where tabname='SaleTemplateHeader'")[0]?.[0] ?? null,
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

async function poll(seconds = 10) {
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
try {
  out.baseline = counts()
  await page.goto('http://127.0.0.1:5177/?app=1&autologin=ADMIN:password9080', { waitUntil: 'load', timeout: 60000 })
  await page.waitForFunction(() => window.rt && window.rt.windowInstances.get('w_main') && typeof window.__menu === 'function', null, { timeout: 120000, polling: 300 })
  await page.evaluate(() => { void window.__menu('Basic Data | Sale Template') })
  await page.waitForFunction(() => window.rt.windowInstances.get('w_saletemplate'), null, { timeout: 40000, polling: 300 })
  await sleep(1600)
  await poll(2)
  await page.evaluate(async () => { const rt = window.rt; const w = rt.windowInstances.get('w_saletemplate'); await w.pbCall('ue_newform', [], rt).catch(() => {}) })
  await sleep(1200)
  await poll(2)
  out.fill = await page.evaluate(async (name) => {
    const rt = window.rt; const w = rt.windowInstances.get('w_saletemplate')
    const m = w.props.get('id_master'); const d = w.props.get('id_detail')
    const bad = []
    const set = async (dw, row, n, v) => { try { await dw.pbCall('setitem', [row, n, v], rt) } catch (e) { bad.push(n + ':' + String(e.message || e).slice(0, 70)) } }
    if (m.model.rowCount() === 0) await m.pbCall('insertrow', [0], rt)
    const now = '05/11/2026'
    for (const [n, v] of Object.entries({ name, date: now, modified: now, headerno: 1 })) await set(m, 1, n, v)
    if (d.model.rowCount() === 0) await d.pbCall('insertrow', [0], rt)
    const dr = d.model.rowCount()
    for (const [n, v] of Object.entries({ icode: 9801, itemname: 'FACE MASK ', qty: 1, looseqty: 1, saleprice: 10, discperc: 0, itemflatdisc: 0, unitsalestax: 0, gstperc: 0, packunits: 1, bonusqty: 0, marked: 'N' })) await set(d, dr, n, v)
    await m.pbCall('accepttext', [], rt).catch(() => {})
    await d.pbCall('accepttext', [], rt).catch(() => {})
    return { bad, masterRows: m.model.rowCount(), detailRows: d.model.rowCount() }
  }, NAME)
  out.save1 = await page.evaluate(() => {
    const rt = window.rt; const w = rt.windowInstances.get('w_saletemplate')
    window.__saveDone = false
    w.pbCall('ue_save', [], rt).then(() => { window.__saveDone = 'ok' }).catch((e) => { window.__saveDone = 'ERR ' + String(e.message || e).slice(0, 300) })
    return 'fired'
  })
  await poll(10)
  out.save1Result = await page.evaluate(() => window.__saveDone ?? null)
  out.header = rows(`select saletemplatecode,name,headerno from dbo.saletemplateheader where name='${NAME.replace(/'/g, "''")}'`)[0] ?? null
  code = out.header?.[0] ?? null
  out.detail = code ? rows(`select saletemplatecode,icode,looseqty::text,saleprice::text from dbo.saletemplatedetail where saletemplatecode=${Number(code)}`) : []
  out.addOk = !!code && out.detail.length > 0

  if (out.addOk) {
    out.edit = await page.evaluate(async (name) => {
      const rt = window.rt; const w = rt.windowInstances.get('w_saletemplate'); const m = w.props.get('id_master')
      await m.pbCall('setitem', [1, 'name', name + ' EDIT'], rt)
      await m.pbCall('accepttext', [], rt)
      window.__saveDone = false
      w.pbCall('ue_save', [], rt).then(() => { window.__saveDone = 'ok' }).catch((e) => { window.__saveDone = 'ERR ' + String(e.message || e).slice(0, 300) })
      return String(await m.pbCall('getitemstring', [1, 'name'], rt))
    }, NAME)
    await poll(10)
    out.save2Result = await page.evaluate(() => window.__saveDone ?? null)
    out.afterEdit = rows(`select saletemplatecode,name from dbo.saletemplateheader where saletemplatecode=${Number(code)}`)[0] ?? null
    out.editOk = out.afterEdit?.[1] === NAME + ' EDIT'
  }
  out.deleteState = await page.evaluate(() => {
    const rt = window.rt; const w = rt.windowInstances.get('w_saletemplate'); const menu = w.props.get('menuid')
    const found = []
    const walk = (o) => { for (const c of o.children.values()) { const text = String(c.props.get('text') ?? '').replace(/&/g, '').trim(); if (/^delete/i.test(text) || c.name === 'm_delete') found.push({ name: c.name, text, enabled: c.props.get('enabled') }); if (c.children.size) walk(c) } }
    if (menu) walk(menu)
    return found
  })
  out.ok = !!out.addOk && !!out.editOk && out.errors.length === 0
} catch (e) {
  out.fatal = String(e.stack || e).slice(0, 1800)
} finally {
  try {
    if (code) {
      q(`delete from dbo.saletemplatedetail where saletemplatecode=${Number(code)}`)
      q(`delete from dbo.saletemplateheader where saletemplatecode=${Number(code)}`)
    }
    const b = out.baseline
    if (b) {
      if (b.tab !== null) q(`update dbo._tabmaxkey set tabmaxkey=${Number(b.tab)} where tabname='SaleTemplateHeader'`)
      if (b.utn) q(`update dbo._utn set utn=${Number(b.utn)}`)
      if (b.serverDate) q(`update dbo.serverdate set lasttransdate='${String(b.serverDate).replace(/'/g, "''")}'::timestamp`)
      if (b.auditMax) { q(`delete from dbo.audit_log where audit_id > ${Number(b.auditMax)}`); q(`select setval(pg_get_serial_sequence('dbo.audit_log','audit_id'), ${Number(b.auditMax)}, true)`) }
    }
    out.final = counts()
    out.baselineOk = !!b && JSON.stringify(out.final) === JSON.stringify(b)
    out.ok = !!out.ok && out.baselineOk
  } catch (e) { out.restoreError = String(e.message || e).slice(0, 800) }
  writeFileSync(`${OUT}/saletemplate-add-edit.json`, JSON.stringify(out, (k, v) => (typeof v === 'bigint' ? Number(v) : v), 1))
  console.log(JSON.stringify(out, (k, v) => (typeof v === 'bigint' ? Number(v) : v), 1))
  await browser.close().catch(() => {})
}
