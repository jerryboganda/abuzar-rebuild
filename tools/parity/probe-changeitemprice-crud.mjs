// Change Items Price (Manufacturer Wise): selector -> manufacturer sheet ->
// pick manufacturer 120 -> edit one item's Retail column through the real DOM
// editor -> save -> verify Item.SalePrice/RetailPrice -> restore exactly.
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
const require = createRequire(process.env.PLAYWRIGHT_MODULES || 'C:/Users/Admin/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/')
const { chromium } = require('playwright')
const PSQL = 'C:\\PostgreSQL\\17\\bin\\psql.exe'
const DB = process.env.PARITY_DB || 'trader_write_test'
const OUT = 'C:/Projects/Abuzar/deploy/parity/changeitemprice-crud'
mkdirSync(OUT, { recursive: true })
const q = (sql) => execFileSync(PSQL, ['-U', 'postgres', '-h', '127.0.0.1', '-d', DB, '-t', '-A', '-F', '|', '-c', sql], { env: { ...process.env, PGPASSWORD: 'postgres' }, encoding: 'utf8', windowsHide: true }).trim()
const rows = (sql) => q(sql).split(/\r?\n/).filter(Boolean).map((l) => l.split('|'))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const MANF = Number(process.env.MANF || 120)

const counts = () => ({
  itemlog: Number(rows('select count(*) from dbo.itemlog')[0][0]),
  itemlogMax: Number(rows('select coalesce(max(itemrowid),0) from dbo.itemlog')[0][0]),
  serverDate: rows('select lasttransdate::text from dbo.serverdate')[0]?.[0] ?? null,
  audit: Number(rows('select count(*) from dbo.audit_log')[0][0]),
  auditMax: Number(rows('select max(audit_id) from dbo.audit_log')[0][0]),
})

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } })
page.setDefaultTimeout(20000)
const out = { manf: MANF, messages: [], errors: [] }
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

let price = null
try {
  out.baseline = counts()
  await page.goto('http://127.0.0.1:5177/?app=1&autologin=ADMIN:password9080', { waitUntil: 'load', timeout: 60000 })
  await page.waitForFunction(() => window.rt && window.rt.windowInstances.get('w_main') && typeof window.__menu === 'function', null, { timeout: 120000, polling: 300 })
  await page.evaluate(() => { void window.__menu('Maintenance | Change Items Price') })
  await page.waitForFunction(() => window.rt.windowInstances.get('w_filter_changeitem_price'), null, { timeout: 30000, polling: 300 })
  await sleep(600)
  out.filter = await page.evaluate(async () => {
    const rt = window.rt; const w = rt.windowInstances.get('w_filter_changeitem_price')
    const rb = w.children.get('rb_companywise') || w.props.get('rb_companywise')
    if (rb) rb.pbSet('checked', true)
    const cb = w.children.get('cb_ok') || w.props.get('cb_ok')
    if (cb) await rt.fire(cb, 'clicked').catch(() => {})
    await new Promise((r) => setTimeout(r, 500))
    if (rt.windowInstances.get('w_filter_changeitem_price')) await w.pbCall('ue_close', [1], rt).catch(() => {})
    return { rb: !!rb, cb: !!cb, closed: !rt.windowInstances.get('w_filter_changeitem_price') }
  })
  await page.waitForFunction(() => window.rt.windowInstances.get('w_changeitem_price'), null, { timeout: 30000, polling: 300 })
  await sleep(2200)
  await poll(2)
  await page.evaluate(() => { const rt = window.rt; const w = rt.windowInstances.get('w_changeitem_price'); void w.pbCall('ue_list', [], rt).catch(() => {}) })
  for (let i = 0; i < 30; i++) { await sleep(500); const n = await page.evaluate(() => window.rt.windowInstances.get('w_changeitem_price')?.props.get('id_list')?.model?.rowCount?.() ?? 0); if (n > 0) break; await poll(1) }
  out.sheet = await page.evaluate(() => {
    const rt = window.rt; const w = rt.windowInstances.get('w_changeitem_price')
    const get = (n) => { const d = w.props.get(n); return d?.model ? { rows: d.model.rowCount(), do: d.props.get('dataobject') } : null }
    return { title: w.props.get('title'), is_dwtype: String(w.props.get('is_dwtype') ?? ''), master: get('id_master'), list: get('id_list'), detail: get('id_detail') }
  })
  out.pick = await page.evaluate(async (manf) => {
    const rt = window.rt; const w = rt.windowInstances.get('w_changeitem_price')
    const l = w.props.get('id_list'); const m = l.model
    const ci = m.colIndex('manfcode') >= 0 ? m.colIndex('manfcode') : (m.colIndex('code') >= 0 ? m.colIndex('code') : -1)
    const row = [...m.buf.primary.entries()].find(([, r]) => Number(r.v[ci]) === manf)
    if (!row) return { error: 'manufacturer not in list', rows: m.rowCount() }
    w.props.set('id_dwcontrol', l); w.props.set('il_selectedrow', row[0] + 1)
    void w.pbCall('ue_detail', [], rt).catch(() => {})
    await new Promise((r) => setTimeout(r, 2500))
    const d = w.props.get('id_detail')
    const view = rt.ui.views.get(w)
    view?.ctlViews?.get?.(d)?.el?.setAttribute('data-parity-dw', 'detail')
    return { row: row[0] + 1, listRows: m.rowCount(), detailRows: d?.model?.rowCount?.() ?? 0 }
  }, MANF)
  await poll(3)
  out.detail = await page.evaluate(async () => {
    const rt = window.rt; const w = rt.windowInstances.get('w_changeitem_price'); const d = w.props.get('id_detail')
    if (!d?.model?.rowCount()) return { rows: 0 }
    const first = {}
    for (const n of ['code', 'item_name', 'saleretail', 'item_retailprice', 'item_saleprice']) { try { first[n] = String(await d.pbCall('getitemstring', [1, n], rt)) } catch { first[n] = 'n/a' } }
    return { rows: d.model.rowCount(), first, cols: d.model.colNames }
  })
  if (out.detail?.rows > 0) {
    const code = out.detail.first.code
    price = rows(`select icode,saleprice::text,retailprice::text,lastupdate::text from dbo.item where icode=${code}`)[0] ?? null
    out.before = price
    // The grid is virtualised; the proven batch path edits row 1's `saleretail`
    // cell through the DataWindow model and fires Save inside one evaluate so
    // the sheet cannot close between the edit and the save.
    out.field = { field: 'saleretail' }
    out.edit = await page.evaluate(async () => {
      const rt = window.rt; const keys = [...rt.windowInstances.keys()]; const w = rt.windowInstances.get('w_changeitem_price')
      if (!w) return { error: 'window gone', keys }
      const d = w.props.get('id_detail')
      const orig = Number(await d.pbCall('getitemnumber', [1, 'saleretail'], rt))
      await d.pbCall('setitem', [1, 'saleretail', orig + 1], rt)
      await d.pbCall('accepttext', [], rt)
      window.__saveDone = false
      w.pbCall('ue_save', [], rt).then((v) => { window.__saveDone = String(v) }).catch((e) => { window.__saveDone = 'ERR ' + String(e.message || e).slice(0, 300) })
      return { orig, now: Number(await d.pbCall('getitemnumber', [1, 'saleretail'], rt)) }
    })
    await poll(12)
    out.saveDone = await page.evaluate(() => window.__saveDone ?? null)
    out.field.orig = out.edit.orig
    out.field.value = out.edit.orig + 1
    out.field.got = out.edit.now
    out.field.applied = out.edit.now === out.edit.orig + 1
    out.after = rows(`select icode,saleprice::text,retailprice::text from dbo.item where icode=${code}`)[0] ?? null
    out.dbOk = !!out.after && Number(out.after[1]) === out.field?.value && Number(out.after[2]) === out.field?.value
  }
  out.ok = !!out.field?.applied && !!out.dbOk && out.errors.length === 0
} catch (e) {
  out.fatal = String(e.stack || e).slice(0, 1800)
} finally {
  try {
    if (price) {
      // the Item table has a trigger that stamps lastupdate=now() on UPDATE
      q(`set session_replication_role = replica;
         update dbo.item set saleprice=${Number(price[1])}, retailprice=${Number(price[2])}, lastupdate='${String(price[3]).replace(/'/g, "''")}' where icode=${Number(price[0])};
         set session_replication_role = origin;`)
    }
    const b = out.baseline
    if (b) {
      if (b.itemlogMax) q(`delete from dbo.itemlog where itemrowid > ${Number(b.itemlogMax)}`)
      if (b.serverDate) q(`update dbo.serverdate set lasttransdate='${String(b.serverDate).replace(/'/g, "''")}'::timestamp`)
      if (b.auditMax) { q(`delete from dbo.audit_log where audit_id > ${Number(b.auditMax)}`); q(`select setval(pg_get_serial_sequence('dbo.audit_log','audit_id'), ${Number(b.auditMax)}, true)`) }
    }
    out.final = counts()
    out.baselineOk = !!out.baseline && JSON.stringify(out.final) === JSON.stringify(out.baseline)
    out.ok = !!out.ok && out.baselineOk
  } catch (e) { out.restoreError = String(e.message || e).slice(0, 800) }
  writeFileSync(`${OUT}/changeitemprice-crud.json`, JSON.stringify(out, (k, v) => (typeof v === 'bigint' ? Number(v) : v), 1))
  console.log(JSON.stringify(out, (k, v) => (typeof v === 'bigint' ? Number(v) : v), 1))
  await browser.close().catch(() => {})
}
