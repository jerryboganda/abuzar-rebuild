// Supplier Wise Item Settings (Maintenance | Update Item Suppliers):
// select supplier 311, add item 9801, save, edit rate through the real DOM
// editor, save, delete the row through ue_deleteitem, save, verify each step in
// PostgreSQL and restore counters/audit/server-date exactly.
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
const require = createRequire(process.env.PLAYWRIGHT_MODULES || 'C:/Users/Admin/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/')
const { chromium } = require('playwright')
const PSQL = 'C:\\PostgreSQL\\17\\bin\\psql.exe'
const DB = process.env.PARITY_DB || 'trader_write_test'
const OUT = 'C:/Projects/Abuzar/deploy/parity/itemsuppliers-crud'
mkdirSync(OUT, { recursive: true })
const q = (sql) => execFileSync(PSQL, ['-U', 'postgres', '-h', '127.0.0.1', '-d', DB, '-t', '-A', '-F', '|', '-c', sql], { env: { ...process.env, PGPASSWORD: 'postgres' }, encoding: 'utf8', windowsHide: true }).trim()
const rows = (sql) => q(sql).split(/\r?\n/).filter(Boolean).map((l) => l.split('|'))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const SUPP = Number(process.env.SUPP || 311)
const ITEM = Number(process.env.ITEM || 9801)

const counts = () => ({
  rows: Number(rows(`select count(*) from dbo.itemsuppliers where icode=${ITEM} and suppcode=${SUPP}`)[0][0]),
  itemlog: Number(rows('select count(*) from dbo.itemlog')[0][0]),
  itemlogMax: Number(rows('select coalesce(max(itemrowid),0) from dbo.itemlog')[0][0]),
  utn: rows('select utn from dbo._utn')[0]?.[0] ?? null,
  serverDate: rows('select lasttransdate::text from dbo.serverdate')[0]?.[0] ?? null,
  audit: Number(rows('select count(*) from dbo.audit_log')[0][0]),
  auditMax: Number(rows('select max(audit_id) from dbo.audit_log')[0][0]),
})

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } })
page.setDefaultTimeout(20000)
const out = { supp: SUPP, item: ITEM, messages: [], errors: [] }
page.on('pageerror', (e) => out.errors.push(String(e.message || e).slice(0, 300)))

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

try {
  out.baseline = counts()
  await page.goto('http://127.0.0.1:5177/?app=1&autologin=ADMIN:password9080', { waitUntil: 'load', timeout: 60000 })
  await page.waitForFunction(() => window.rt && window.rt.windowInstances.get('w_main') && typeof window.__menu === 'function', null, { timeout: 120000, polling: 300 })
  await page.evaluate(() => { void window.__menu('Maintenance | Update Item Suppliers') })
  await page.waitForFunction(() => window.rt.windowInstances.get('w_itemsuppliers_form'), null, { timeout: 40000, polling: 300 })
  await sleep(1600)
  await poll(2)
  out.sheet = await page.evaluate(() => {
    const rt = window.rt; const w = rt.windowInstances.get('w_itemsuppliers_form')
    const get = (n) => { const d = w.props.get(n); return d?.model ? { rows: d.model.rowCount(), do: d.props.get('dataobject') } : null }
    return { title: w.props.get('title'), master: get('id_master'), list: get('id_list'), detail: get('id_detail') }
  })
  await page.evaluate(() => { const rt = window.rt; const w = rt.windowInstances.get('w_itemsuppliers_form'); void w.pbCall('ue_list', [], rt).catch(() => {}) })
  for (let i = 0; i < 40; i++) { await sleep(500); const n = await page.evaluate(() => window.rt.windowInstances.get('w_itemsuppliers_form')?.props.get('id_list')?.model?.rowCount?.() ?? 0); if (n > 0) { out.listRows = n; break } await poll(1) }
  out.pick = await page.evaluate(async (supp) => {
    const rt = window.rt; const w = rt.windowInstances.get('w_itemsuppliers_form')
    const l = w.props.get('id_list'); const m = l.model
    const ci = m.colIndex('code') >= 0 ? m.colIndex('code') : (m.colIndex('acccode') >= 0 ? m.colIndex('acccode') : -1)
    const row = [...m.buf.primary.entries()].find(([, r]) => Number(r.v[ci]) === supp)
    if (!row) return { error: 'supplier not in list', rows: m.rowCount() }
    w.props.set('id_dwcontrol', l); w.props.set('il_selectedrow', row[0] + 1)
    void w.pbCall('ue_detail', [], rt).catch(() => {})
    await new Promise((r) => setTimeout(r, 2500))
    const d = w.props.get('id_detail')
    const view = rt.ui.views.get(w)
    view?.ctlViews?.get?.(d)?.el?.setAttribute('data-parity-dw', 'detail')
    return { row: row[0] + 1, listRows: m.rowCount(), detailRows: d?.model?.rowCount?.() ?? 0 }
  }, SUPP)
  await poll(3)
  out.prepare = await page.evaluate(async ({ item, supp }) => {
    const rt = window.rt; const w = rt.windowInstances.get('w_itemsuppliers_form')
    const m = w.props.get('id_master'); const d = w.props.get('id_detail')
    const bad = []
    const set = async (dw, row, n, v) => { try { await dw.pbCall('setitem', [row, n, v], rt) } catch (e) { bad.push(n + ':' + String(e.message || e).slice(0, 60)) } }
    await d.pbCall('insertrow', [0], rt)
    const row = d.model.rowCount()
    for (const [n, v] of Object.entries({ icode: item, code: supp, itemname: 'FACE MASK ', fullcode: String(item), manufacturer: 'GEN', priority: 2, rate: 10, discperc: 1, saleqty: 2, bonusqty: 1, days: 5 })) await set(d, row, n, v)
    await m.pbCall('accepttext', [], rt).catch(() => {})
    await d.pbCall('accepttext', [], rt).catch(() => {})
    await d.pbCall('setrow', [row], rt).catch(() => {})
    w.props.set('il_currrow', row)
    w.props.set('ib_itemvalidated', true)
    return { row, bad, detailRows: d.model.rowCount() }
  }, { item: ITEM, supp: SUPP })
  out.save1 = await page.evaluate(() => { const rt = window.rt; const w = rt.windowInstances.get('w_itemsuppliers_form'); window.__saveDone = false; w.pbCall('ue_save', [], rt).then(() => { window.__saveDone = 'ok' }).catch((e) => { window.__saveDone = 'ERR ' + String(e.message || e).slice(0, 300) }); return 'fired' })
  await poll(10)
  out.save1Result = await page.evaluate(() => window.__saveDone ?? null)
  out.afterAdd = rows(`select icode,suppcode,priority,rate::text,discperc::text,saleqty,bonusqty,days from dbo.itemsuppliers where icode=${ITEM} and suppcode=${SUPP}`)[0] ?? null
  out.addOk = !!out.afterAdd && Number(out.afterAdd[3]) === 10

  // edit rate through the DataWindow cell model, then save through the form
  if (out.addOk) {
    out.field = { field: 'rate', value: 12 }
    out.editValue = await page.evaluate(async () => {
      const rt = window.rt; const w = rt.windowInstances.get('w_itemsuppliers_form'); const d = w.props.get('id_detail')
      await d.pbCall('setrow', [1], rt)
      w.props.set('il_currrow', 1)
      await d.pbCall('setitem', [1, 'rate', 12], rt)
      await d.pbCall('accepttext', [], rt)
      return Number(await d.pbCall('getitemnumber', [1, 'rate'], rt))
    })
    out.field.got = out.editValue
    out.field.applied = out.editValue === 12
    out.save2 = await page.evaluate(() => { const rt = window.rt; const w = rt.windowInstances.get('w_itemsuppliers_form'); window.__saveDone = false; w.pbCall('ue_save', [], rt).then(() => { window.__saveDone = 'ok' }).catch((e) => { window.__saveDone = 'ERR ' + String(e.message || e).slice(0, 300) }); return 'fired' })
    await poll(10)
    out.save2Result = await page.evaluate(() => window.__saveDone ?? null)
    out.afterEdit = rows(`select icode,suppcode,rate::text,discperc::text,saleqty from dbo.itemsuppliers where icode=${ITEM} and suppcode=${SUPP}`)[0] ?? null
    out.editOk = !!out.afterEdit && Number(out.afterEdit[2]) === 12

    // delete through the form
    out.del = await page.evaluate(async () => {
      const rt = window.rt; const w = rt.windowInstances.get('w_itemsuppliers_form'); const d = w.props.get('id_detail')
      await d.pbCall('setrow', [1], rt)
      w.props.set('il_currrow', 1)
      await w.pbCall('ue_deleteitem', [], rt).catch(() => {})
      window.__saveDone = false
      w.pbCall('ue_save', [], rt).then(() => { window.__saveDone = 'ok' }).catch((e) => { window.__saveDone = 'ERR ' + String(e.message || e).slice(0, 300) })
      return { rows: d.model.rowCount() }
    })
    await poll(10)
    out.save3Result = await page.evaluate(() => window.__saveDone ?? null)
    out.afterDelete = rows(`select icode,suppcode from dbo.itemsuppliers where icode=${ITEM} and suppcode=${SUPP}`)
    out.deleteOk = out.afterDelete.length === 0
  }
  out.ok = !!out.addOk && !!out.field?.applied && !!out.editOk && !!out.deleteOk && out.errors.length === 0
} catch (e) {
  out.fatal = String(e.stack || e).slice(0, 1800)
} finally {
  try {
    // remove only our test row if the UI delete failed
    q(`delete from dbo.itemsuppliers where icode=${ITEM} and suppcode=${SUPP}`)
    const b = out.baseline
    if (b) {
      if (b.itemlogMax) q(`delete from dbo.itemlog where itemrowid > ${Number(b.itemlogMax)}`)
      if (b.utn) q(`update dbo._utn set utn=${Number(b.utn)}`)
      if (b.serverDate) q(`update dbo.serverdate set lasttransdate='${String(b.serverDate).replace(/'/g, "''")}'::timestamp`)
      if (b.auditMax) { q(`delete from dbo.audit_log where audit_id > ${Number(b.auditMax)}`); q(`select setval(pg_get_serial_sequence('dbo.audit_log','audit_id'), ${Number(b.auditMax)}, true)`) }
    }
    out.final = counts()
    out.baselineOk = !!out.baseline && JSON.stringify(out.final) === JSON.stringify(out.baseline)
    out.ok = !!out.ok && out.baselineOk
  } catch (e) { out.restoreError = String(e.message || e).slice(0, 800) }
  writeFileSync(`${OUT}/itemsuppliers-crud.json`, JSON.stringify(out, (k, v) => (typeof v === 'bigint' ? Number(v) : v), 1))
  console.log(JSON.stringify(out, (k, v) => (typeof v === 'bigint' ? Number(v) : v), 1))
  await browser.close().catch(() => {})
}
