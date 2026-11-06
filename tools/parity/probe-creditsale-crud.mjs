// Credit Sale (Sales | Credit Sale): real customer 22 + item 9801, save through
// ue_save + salesman password, verify SaleLedger/SaleDetail/stock/UTN/counters,
// record the Delete menu state, then remove the sale and restore exactly.
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
const require = createRequire(process.env.PLAYWRIGHT_MODULES || 'C:/Users/Admin/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/')
const { chromium } = require('playwright')
const PSQL = 'C:\\PostgreSQL\\17\\bin\\psql.exe'
const DB = process.env.PARITY_DB || 'trader_write_test'
const OUT = 'C:/Projects/Abuzar/deploy/parity/creditsale-crud'
mkdirSync(OUT, { recursive: true })
const q = (sql) => execFileSync(PSQL, ['-U', 'postgres', '-h', '127.0.0.1', '-d', DB, '-t', '-A', '-F', '|', '-c', sql], { env: { ...process.env, PGPASSWORD: 'postgres' }, encoding: 'utf8', windowsHide: true }).trim()
const rows = (sql) => q(sql).split(/\r?\n/).filter(Boolean).map((l) => l.split('|'))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const ITEM = 9801
const CUSTOMER = 22

const counts = () => ({
  saleledger: Number(rows('select count(*) from dbo.saleledger')[0][0]),
  saleledgerMax: Number(rows('select coalesce(max(saleinvcode),0) from dbo.saleledger')[0][0]),
  saledetail: Number(rows('select count(*) from dbo.saledetail')[0][0]),
  godown: rows(`select currqty::text,lastupdated::text from dbo.godowndetail where icode=${ITEM} and gcode=1`)[0] ?? null,
  totalpieces: rows(`select totalpieces::text from dbo.item where icode=${ITEM}`)[0]?.[0] ?? null,
  itemLastupdate: rows(`select lastupdate::text from dbo.item where icode=${ITEM}`)[0]?.[0] ?? null,
  stockledger: Number(rows('select count(*) from dbo.stockledger')[0][0]),
  stockledgerMaxUtn: Number(rows('select coalesce(max(utn),0) from dbo.stockledger')[0][0]),
  itemlog: Number(rows('select count(*) from dbo.itemlog')[0][0]),
  itemlogMax: Number(rows('select coalesce(max(itemrowid),0) from dbo.itemlog')[0][0]),
  utn: rows('select utn from dbo._utn')[0]?.[0] ?? null,
  tab: rows("select tabmaxkey from dbo._tabmaxkey where tabname='SaleLedger'")[0]?.[0] ?? null,
  headerTab: rows('select tabmaxkey from dbo._headertabmaxkey where headercode=1 and module=1')[0]?.[0] ?? null,
  serverDate: rows('select lasttransdate::text from dbo.serverdate')[0]?.[0] ?? null,
  fiscalPref: rows("select prefvalue from dbo.softwarepreferences where name='AutoFiscalizeOnPosting'")[0]?.[0] ?? null,
  audit: Number(rows('select count(*) from dbo.audit_log')[0][0]),
  auditMax: Number(rows('select max(audit_id) from dbo.audit_log')[0][0]),
})

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } })
page.setDefaultTimeout(20000)
const out = { item: ITEM, customer: CUSTOMER, messages: [], errors: [] }
page.on('pageerror', (e) => out.errors.push(String(e.message || e).slice(0, 400)))

async function poll(seconds = 12, yes = false) {
  for (let i = 0; i < seconds * 2; i++) {
    await sleep(500)
    const msgs = await page.evaluate(() => [...document.querySelectorAll('.msgbox .txt')].map((e) => e.textContent.replace(/\s+/g, ' ').trim().slice(0, 260)))
    if (msgs.length) {
      out.messages.push(...msgs)
      await page.evaluate((y) => {
        for (const b of document.querySelectorAll('.msgbox')) {
          const bs = [...b.querySelectorAll('.btns button')]
          ;(bs.find((x) => (y && /^yes$/i.test(x.textContent.trim())) || /^(ok|yes)$/i.test(x.textContent.trim())) || bs[0])?.click()
        }
      }, yes)
      await sleep(250)
    }
  }
}

async function password() {
  for (let i = 0; i < 30; i++) {
    const done = await page.evaluate(async () => {
      const rt = window.rt
      const a = rt.windowInstances.get('w_salesmanpassword')
      if (!a) return false
      const dw = a.props.get('id_password') || a.children.get('dw_password')
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
  q("update dbo.softwarepreferences set prefvalue='N' where name='AutoFiscalizeOnPosting'")
  await page.goto('http://127.0.0.1:5177/?app=1&autologin=ADMIN:password9080', { waitUntil: 'load', timeout: 60000 })
  await page.waitForFunction(() => window.rt && window.rt.windowInstances.get('w_main') && typeof window.__menu === 'function', null, { timeout: 120000, polling: 300 })
  await page.evaluate(() => { void window.__menu('Sales | Credit Sale') })
  await page.waitForFunction(() => {
    const w = window.rt.windowInstances.get('w_sale')
    const d = w?.props.get('id_detail')
    return d?.model && d.model.rowCount() > 0
  }, null, { timeout: 40000, polling: 300 })
  await sleep(1500)
  await poll(2)
  await page.evaluate(async () => { const rt = window.rt; const w = rt.windowInstances.get('w_sale'); await w.pbCall('ue_newform', [], rt).catch(() => {}); await new Promise((r) => setTimeout(r, 1200)) })
  out.open = await page.evaluate(() => {
    const w = window.rt.windowInstances.get('w_sale')
    const m = w.props.get('id_master'); const d = w.props.get('id_detail')
    return { title: String(w.props.get('title') ?? ''), master: m?.props?.get?.('dataobject'), detail: d?.props?.get?.('dataobject'), masterRows: m?.model?.rowCount?.(), detailRows: d?.model?.rowCount?.() }
  })
  out.prepare = await page.evaluate(async (customer) => {
    const rt = window.rt; const w = rt.windowInstances.get('w_sale')
    const m = w.props.get('id_master')
    try { await m.pbCall('setitem', [1, 'custcode', customer], rt) } catch (e) { return { error: String(e.message || e).slice(0, 200) } }
    await m.pbCall('accepttext', [], rt).catch(() => {})
    await new Promise((r) => setTimeout(r, 600))
    return { custcode: String(await m.pbCall('getitemstring', [1, 'custcode'], rt)), masterRows: m.model.rowCount() }
  }, CUSTOMER)
  await poll(2)
  out.pick = await page.evaluate(async (icode) => {
    const rt = window.rt; const w = rt.windowInstances.get('w_sale')
    const l = w.props.get('id_itemslist'); const d = w.props.get('id_detail')
    const n = await l.n_rowcount()
    if (!n) return { error: 'item list empty' }
    const hit = await l.pbCall('find', ['icode = ' + icode, 1, n], rt)
    if (!(hit > 0)) return { error: 'item not in list', rows: n }
    await l.pbCall('setrow', [hit], rt)
    await l.n_scrolltorow(hit)
    await rt.fire(l, 'clicked', [0, 0, hit, { name: 'itemname' }])
    await new Promise((r) => setTimeout(r, 1800))
    return { row: hit, rows: n, detailRows: d.model.rowCount() }
  }, ITEM)
  await poll(3)
  out.values = await page.evaluate(async () => {
    const rt = window.rt; const w = rt.windowInstances.get('w_sale')
    const d = w.props.get('id_detail'); const f = w.props.get('id_footer')
    await rt.fire(d, 'itemfocuschanged', [1, { name: 'itemname' }]).catch(() => {})
    await new Promise((r) => setTimeout(r, 900))
    await d.pbCall('setitem', [1, 'looseqty', 1], rt).catch(() => {})
    await d.pbCall('setitem', [1, 'saleprice', 10], rt).catch(() => {})
    await d.pbCall('setitem', [1, 'discperc', 0], rt).catch(() => {})
    await d.pbCall('accepttext', [], rt).catch(() => {})
    await rt.fire(d, 'itemfocuschanged', [1, { name: 'itemname' }]).catch(() => {})
    await new Promise((r) => setTimeout(r, 900))
    for (const [n, v] of [['fbrposfee', 0], ['flatdisc', 0], ['discperc', 0], ['misccharges', 0], ['invgstperc1', 0], ['advancetaxamt', 0]]) { try { await f.pbCall('setitem', [1, n, v], rt) } catch { /* not a footer column */ } }
    await f.pbCall('accepttext', [], rt).catch(() => {})
    try { await w.pbCall('wf_grandtotal', [], rt) } catch { /* footer recalculated by item focus */ }
    const o = {}
    for (const n of ['icode', 'itemname', 'gcode', 'looseqty', 'saleprice', 'discperc', 'totalpieces']) { try { o[n] = String(await d.pbCall('getitemstring', [1, n], rt)) } catch { o[n] = 'n/a' } }
    for (const n of ['total']) { try { o[n] = String(await f.pbCall('getitemstring', [1, n], rt)) } catch { o[n] = 'n/a' } }
    return o
  })
  await poll(2)
  out.save = await page.evaluate(() => {
    const rt = window.rt; const w = rt.windowInstances.get('w_sale')
    window.__saveDone = false
    w.pbCall('ue_save', [], rt).then(() => { window.__saveDone = 'ok' }).catch((e) => { window.__saveDone = 'ERR ' + String(e.message || e).slice(0, 400) })
    return 'fired'
  })
  await password()
  await poll(30, true)
  out.saveResult = await page.evaluate(() => window.__saveDone ?? null)
  out.after = {
    saleledger: rows(`select saleinvcode,salecatcode,custcode,posted,marked,invtotal::text,date::text from dbo.saleledger where saleinvcode > ${out.baseline.saleledgerMax} order by saleinvcode`),
    saledetail: rows(`select saleinvcode,icode,gcode,looseqty::text,saleprice::text from dbo.saledetail where saleinvcode > ${out.baseline.saleledgerMax} order by saleinvcode`),
    godown: rows(`select currqty::text from dbo.godowndetail where icode=${ITEM} and gcode=1`)[0]?.[0] ?? null,
    totalpieces: rows(`select totalpieces::text from dbo.item where icode=${ITEM}`)[0]?.[0] ?? null,
    utn: rows('select utn from dbo._utn')[0]?.[0] ?? null,
    tab: rows("select tabmaxkey from dbo._tabmaxkey where tabname='SaleLedger'")[0]?.[0] ?? null,
  }
  code = out.after.saleledger[0]?.[0] ?? null
  out.addOk = !!code
    && out.after.saleledger.length === 1
    && out.after.saleledger[0][1] === '2'
    && out.after.saleledger[0][2] === String(CUSTOMER)
    && out.after.saleledger[0][3] === 'Y'
    && out.after.saledetail.length === 1
    && out.after.saledetail[0][1] === String(ITEM)
    && Number(out.after.saledetail[0][3]) === 1
    && Number(out.after.saledetail[0][4]) === 10
    && Number(out.after.godown) === Number(out.baseline.godown?.[0]) - 1
    && Number(out.after.utn) > Number(out.baseline.utn)
  out.deleteEnabled = await page.evaluate(() => {
    const rt = window.rt; const w = rt.windowInstances.get('w_sale'); const menu = w.props.get('menuid')
    const found = []
    const walk = (o) => { for (const c of o.children.values()) { const text = String(c.props.get('text') ?? '').replace(/&/g, '').trim(); if (/^delete/i.test(text) || c.name === 'm_delete') found.push({ name: c.name, text, enabled: c.props.get('enabled') }); if (c.children.size) walk(c) } }
    if (menu) walk(menu)
    return found
  })
  out.ok = !!out.addOk && out.errors.length === 0
} catch (e) {
  out.fatal = String(e.stack || e).slice(0, 2000)
} finally {
  try {
    const b = out.baseline
    q(`set session_replication_role = replica;
       ${code ? `delete from dbo.saledetail where saleinvcode=${Number(code)}; delete from dbo.saleledger where saleinvcode=${Number(code)};` : ''}
       ${b?.stockledgerMaxUtn ? `delete from dbo.stockledger where utn > ${Number(b.stockledgerMaxUtn)};` : ''}
       ${b?.godown ? `update dbo.godowndetail set currqty=${Number(b.godown[0])}, lastupdated='${String(b.godown[1]).replace(/'/g, "''")}' where icode=${ITEM} and gcode=1;` : ''}
       ${b?.totalpieces !== null && b?.totalpieces !== undefined ? `update dbo.item set totalpieces=${Number(b.totalpieces)}, lastupdate='${String(b.itemLastupdate).replace(/'/g, "''")}' where icode=${ITEM};` : ''}
       set session_replication_role = origin;`)
    if (b?.itemlogMax) q(`delete from dbo.itemlog where itemrowid > ${Number(b.itemlogMax)}`)
    if (b?.utn) q(`update dbo._utn set utn=${Number(b.utn)}`)
    if (b?.tab !== null) q(`update dbo._tabmaxkey set tabmaxkey=${Number(b.tab)} where tabname='SaleLedger'`)
    if (b?.headerTab !== null) q(`update dbo._headertabmaxkey set tabmaxkey=${Number(b.headerTab)} where headercode=1 and module=1`)
    if (b?.serverDate) q(`update dbo.serverdate set lasttransdate='${String(b.serverDate).replace(/'/g, "''")}'::timestamp`)
    if (b?.fiscalPref) q(`update dbo.softwarepreferences set prefvalue='${String(b.fiscalPref).replace(/'/g, "''")}' where name='AutoFiscalizeOnPosting'`)
    if (b?.auditMax) { q(`delete from dbo.audit_log where audit_id > ${Number(b.auditMax)}`); q(`select setval(pg_get_serial_sequence('dbo.audit_log','audit_id'), ${Number(b.auditMax)}, true)`) }
    out.final = counts()
    out.baselineOk = !!b && JSON.stringify(out.final) === JSON.stringify(b)
    out.ok = !!out.ok && out.baselineOk
  } catch (e) { out.restoreError = String(e.message || e).slice(0, 1000) }
  writeFileSync(`${OUT}/creditsale-crud.json`, JSON.stringify(out, (k, v) => (typeof v === 'bigint' ? Number(v) : v), 1))
  console.log(JSON.stringify(out, (k, v) => (typeof v === 'bigint' ? Number(v) : v), 1))
  await browser.close().catch(() => {})
}
