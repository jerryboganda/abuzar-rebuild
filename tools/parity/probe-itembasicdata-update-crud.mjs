// Update Item Basic Data (Maintenance | Update Item Basic Data):
// Manufacturer Wise -> All -> load the full item grid -> edit row 1's sale
// price through the batch DataWindow -> save -> verify Item -> restore the
// item row, itemlog, audit and server-date exactly.
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
const require = createRequire(process.env.PLAYWRIGHT_MODULES || 'C:/Users/Admin/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/')
const { chromium } = require('playwright')
const PSQL = 'C:\\PostgreSQL\\17\\bin\\psql.exe'
const DB = process.env.PARITY_DB || 'trader_write_test'
const OUT = 'C:/Projects/Abuzar/deploy/parity/itembasicdata-update-crud'
mkdirSync(OUT, { recursive: true })
const q = (sql) => execFileSync(PSQL, ['-U', 'postgres', '-h', '127.0.0.1', '-d', DB, '-t', '-A', '-F', '|', '-c', sql], { env: { ...process.env, PGPASSWORD: 'postgres' }, encoding: 'utf8', windowsHide: true }).trim()
const rows = (sql) => q(sql).split(/\r?\n/).filter(Boolean).map((l) => l.split('|'))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const counts = () => ({
  itemlog: Number(rows('select count(*) from dbo.itemlog')[0][0]),
  itemlogMax: Number(rows('select coalesce(max(itemrowid),0) from dbo.itemlog')[0][0]),
  audit: Number(rows('select count(*) from dbo.audit_log')[0][0]),
  auditMax: Number(rows('select max(audit_id) from dbo.audit_log')[0][0]),
  serverDate: rows('select lasttransdate::text from dbo.serverdate')[0]?.[0] ?? null,
})

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } })
page.setDefaultTimeout(20000)
const out = { messages: [], errors: [] }
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

async function clickText(win, text) {
  const loc = page.locator(`.pbwin[data-win="${win.toLowerCase()}"]`).getByText(text, { exact: true })
  if (await loc.count()) { await loc.first().click({ force: true }).catch(() => {}); return true }
  const btn = page.locator(`.pbwin[data-win="${win.toLowerCase()}"] button`).filter({ hasText: text }).first()
  if (await btn.count()) { await btn.click({ force: true }).catch(() => {}); return true }
  return false
}

let item = null
try {
  out.baseline = counts()
  await page.goto('http://127.0.0.1:5177/?app=1&autologin=ADMIN:password9080', { waitUntil: 'load', timeout: 60000 })
  await page.waitForFunction(() => window.rt && window.rt.windowInstances.get('w_main') && typeof window.__menu === 'function', null, { timeout: 120000, polling: 300 })
  await page.evaluate(() => { void window.__menu('Maintenance | Update Item Basic Data') })
  await page.waitForFunction(() => window.rt.windowInstances.get('w_select_manf_cat_class_pack_saleorder'), null, { timeout: 30000, polling: 300 })
  await sleep(500)
  await clickText('w_select_manf_cat_class_pack_saleorder', 'Manufacturer Wise')
  await clickText('w_select_manf_cat_class_pack_saleorder', 'Ok')
  await page.waitForFunction(() => window.rt.windowInstances.get('w_arg_manfs_cats_classes_packs'), null, { timeout: 20000, polling: 300 })
  await sleep(500)
  out.arg = await page.evaluate(async () => {
    const rt = window.rt; const w = rt.windowInstances.get('w_arg_manfs_cats_classes_packs')
    const all = w.children.get('cbx_all') || w.props.get('cbx_all')
    if (all) all.pbSet('checked', true)
    const d = w.children.get('dw_control') || w.props.get('dw_control')
    if (d?.model) await d.pbCall('accepttext', [], rt).catch(() => {})
    return { all: !!all, dwRows: d?.model?.rowCount?.() ?? null, dwCols: d?.model?.colNames ?? null }
  })
  await clickText('w_arg_manfs_cats_classes_packs', 'Ok')
  await page.waitForFunction(() => window.rt.windowInstances.get('w_item_update'), null, { timeout: 40000, polling: 300 })
  for (let i = 0; i < 60; i++) {
    await sleep(500)
    const n = await page.evaluate(() => window.rt.windowInstances.get('w_item_update')?.props.get('dw_master')?.model?.rowCount?.() ?? 0)
    if (n > 0) { out.gridRows = n; break }
    await poll(1)
  }
  await poll(2)
  out.form = await page.evaluate(() => {
    const rt = window.rt; const w = rt.windowInstances.get('w_item_update')
    const d = w?.props.get('dw_master') || w?.children.get('dw_master')
    return { rows: d?.model?.rowCount?.() ?? null, cols: d?.model?.colNames?.slice(0, 12) ?? null }
  })
  if (out.form?.rows > 0) {
    item = await page.evaluate(async () => {
      const rt = window.rt; const w = rt.windowInstances.get('w_item_update')
      const d = w.props.get('dw_master') || w.children.get('dw_master')
      const m = d.model; const ci = m.colIndex('code'); const pi = m.colIndex('saleprice')
      const code = Number(m.buf.primary[0].v[ci]); const orig = Number(m.buf.primary[0].v[pi])
      await d.pbCall('setitem', [1, 'saleprice', orig + 1], rt)
      await d.pbCall('accepttext', [], rt)
      // setitem bypasses itemchanged, so reproduce the flag it sets before the
      // original row-focus save runs
      w.props.set('ib_editflag', true)
      // the original saves on row focus change (dw_master.rowfocuschanging
      // calls update(true,true) + commit), not on a Save menu / ue_save
      await rt.fire(d, 'rowfocuschanging', [1, 2]).catch(() => {})
      await d.pbCall('setrow', [2], rt).catch(() => {})
      return { code, orig, now: Number(m.buf.primary[0].v[pi]) }
    })
    out.edit = { ...item }
    out.saveHow = 'rowfocuschanging'
    await poll(8)
    out.after = rows(`select icode,saleprice::text,lastupdate::text from dbo.item where icode=${Number(item.code)}`)[0] ?? null
    out.dbOk = !!out.after && Number(out.after[1]) === item.orig + 1
  }
  out.ok = !!out.dbOk && out.errors.length === 0
} catch (e) {
  out.fatal = String(e.stack || e).slice(0, 1800)
} finally {
  try {
    if (item) {
      const before = rows(`select saleprice::text,lastupdate::text from dbo.item where icode=${Number(item.code)}`)[0] ?? null
      // the captured orig is authoritative; lastupdate comes from the log row
      const logRow = rows(`select lastupdate::text from dbo.itemlog where icode=${Number(item.code)} and itemrowid=(select max(itemrowid) from dbo.itemlog where icode=${Number(item.code)})`)[0] ?? null
      const lastupdate = logRow?.[0] ?? before?.[1] ?? null
      q(`set session_replication_role = replica;
         update dbo.item set saleprice=${Number(item.orig)}${lastupdate ? `, lastupdate='${String(lastupdate).replace(/'/g, "''")}'` : ''} where icode=${Number(item.code)};
         set session_replication_role = origin;`)
    }
    const b = out.baseline
    if (b) {
      if (b.itemlogMax) q(`delete from dbo.itemlog where itemrowid > ${Number(b.itemlogMax)}`)
      if (b.serverDate) q(`update dbo.serverdate set lasttransdate='${String(b.serverDate).replace(/'/g, "''")}'::timestamp`)
      if (b.auditMax) { q(`delete from dbo.audit_log where audit_id > ${Number(b.auditMax)}`); q(`select setval(pg_get_serial_sequence('dbo.audit_log','audit_id'), ${Number(b.auditMax)}, true)`) }
    }
    out.final = counts()
    out.baselineOk = !!b && JSON.stringify(out.final) === JSON.stringify(b)
    out.ok = !!out.ok && out.baselineOk
  } catch (e) { out.restoreError = String(e.message || e).slice(0, 800) }
  writeFileSync(`${OUT}/itembasicdata-update-crud.json`, JSON.stringify(out, (k, v) => (typeof v === 'bigint' ? Number(v) : v), 1))
  console.log(JSON.stringify(out, (k, v) => (typeof v === 'bigint' ? Number(v) : v), 1))
  await browser.close().catch(() => {})
}
