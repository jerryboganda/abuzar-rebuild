// Purchase Order: add/save, reopen/edit remarks through the real editor,
// save, verify PostgreSQL, confirm the original Delete-disabled behaviour,
// then remove the test PO and restore every counter/audit/date exactly.
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
const require = createRequire(process.env.PLAYWRIGHT_MODULES || 'C:/Users/Admin/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/')
const { chromium } = require('playwright')
const PSQL = 'C:\\PostgreSQL\\17\\bin\\psql.exe'
const DB = process.env.PARITY_DB || 'trader_write_test'
const OUT = 'C:/Projects/Abuzar/deploy/parity/purchaseorder-crud'
mkdirSync(OUT, { recursive: true })
const q = (sql) => execFileSync(PSQL, ['-U', 'postgres', '-h', '127.0.0.1', '-d', DB, '-t', '-A', '-F', '|', '-c', sql], { env: { ...process.env, PGPASSWORD: 'postgres' }, encoding: 'utf8', windowsHide: true }).trim()
const rows = (sql) => q(sql).split(/\r?\n/).filter(Boolean).map((l) => l.split('|'))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const SUF = String(Date.now()).slice(-6)
const REMARKS = 'PARITY PO ADD ' + SUF
const REMARKS2 = 'PARITY PO EDIT ' + SUF
const SUPP = 311
const ITEM = 9801

const counts = () => ({
  headers: Number(rows('select count(*) from dbo.purorderheader')[0][0]),
  headerMax: Number(rows('select coalesce(max(pocode),0) from dbo.purorderheader')[0][0]),
  details: Number(rows('select count(*) from dbo.purorderdetail')[0][0]),
  detailMax: Number(rows('select coalesce(max(porowid),0) from dbo.purorderdetail')[0][0]),
  tab: rows("select tabmaxkey from dbo._tabmaxkey where tabname='PurOrderHeader'")[0]?.[0] ?? null,
  utn: rows('select utn from dbo._utn')[0]?.[0] ?? null,
  serverDate: rows('select lasttransdate::text from dbo.serverdate')[0]?.[0] ?? null,
  audit: Number(rows('select count(*) from dbo.audit_log')[0][0]),
  auditMax: Number(rows('select max(audit_id) from dbo.audit_log')[0][0]),
})

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } })
page.setDefaultTimeout(20000)
const out = { remarks: REMARKS, remarks2: REMARKS2, messages: [], errors: [] }
page.on('pageerror', (e) => out.errors.push(String(e.message || e).slice(0, 400)))

async function drain(yes = false) {
  const texts = []
  for (let i = 0; i < 30; i++) {
    const t = await page.evaluate((y) => {
      const b = document.querySelector('.msgbox')
      if (!b) return null
      const text = (b.querySelector('.txt')?.textContent || '').replace(/\s+/g, ' ').trim()
      const bs = [...b.querySelectorAll('.btns button')]
      const pick = (y && bs.find((x) => /^yes$/i.test(x.textContent.trim()))) || bs.find((x) => /^(ok|yes|no|cancel|close)$/i.test(x.textContent.trim())) || bs[0]
      pick?.click()
      return text
    }, yes)
    if (t === null) break
    texts.push(t)
    await sleep(130)
  }
  return texts
}

async function password() {
  for (let i = 0; i < 24; i++) {
    const done = await page.evaluate(async () => {
      const rt = window.rt
      const a = rt.windowInstances.get('w_salesmanpassword')
      if (!a) return false
      const dw = a.children.get('dw_password') || a.props.get('dw_password')
      if (!dw) return false
      await dw.pbCall('setitem', [1, 'salesmancode', 1], rt)
      await dw.pbCall('setitem', [1, 'password', 'password9080'], rt)
      dw.model.acceptText = async () => 1
      await dw.pbCall('accepttext', [], rt).catch(() => {})
      const cb = a.children.get('cb_ok') || a.props.get('cb_ok')
      if (cb) await rt.fire(cb, 'clicked')
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
  await page.evaluate(() => { void window.__menu('Purchase | Purchase Orders') })
  await page.waitForFunction(() => window.rt.windowInstances.get('w_purchaseorder'), null, { timeout: 40000, polling: 300 })
  await sleep(1800)
  await drain()
  out.prepare = await page.evaluate(async ({ supp, item, remarks }) => {
    const rt = window.rt
    const w = rt.windowInstances.get('w_purchaseorder')
    const m = w.props.get('id_master')
    const d = w.props.get('id_detail')
    for (const [k, v] of Object.entries({ suppcode: supp, salesmancode: 1, purordercatcode: 1, remarks })) {
      try { await m.pbCall('setitem', [1, k, v], rt) } catch { /* reported by missing columns */ }
    }
    await m.pbCall('accepttext', [], rt).catch(() => {})
    void rt.fire(m, 'itemchanged', [1, { name: 'suppcode' }]).catch(() => {})
    await new Promise((r) => setTimeout(r, 900))
    const l = w.props.get('id_itemslist')
    const nr = await l.n_rowcount()
    const n = await l.pbCall('find', ['icode = ' + item, 1, nr], rt)
    await l.pbCall('setrow', [n], rt)
    await l.n_scrolltorow(n)
    void rt.fire(l, 'clicked', [0, 0, n, { name: 'itemname' }]).catch(() => {})
    await new Promise((r) => setTimeout(r, 1800))
    if (d.model.rowCount()) {
      await d.pbCall('setitem', [1, 'qty', 1], rt).catch(() => {})
      await d.pbCall('setitem', [1, 'rate', 10], rt).catch(() => {})
      await d.pbCall('accepttext', [], rt).catch(() => {})
    }
    return { listRows: nr, found: n, masterRows: m.model.rowCount(), detailRows: d.model.rowCount(), supp: String(m.model.buf.primary[0]?.v[m.model.colIndex('suppcode')] ?? ''), icode: d.model.rowCount() ? String(d.model.buf.primary[0]?.v[d.model.colIndex('icode')] ?? '') : '' }
  }, { supp: SUPP, item: ITEM, remarks: REMARKS })
  out.messages.push(...await drain())

  out.save = await page.evaluate(() => {
    const rt = window.rt
    const w = rt.windowInstances.get('w_purchaseorder')
    window.__save = false
    void w.pbCall('ue_save', [], rt).then(() => { window.__save = 'ok' }).catch((e) => { window.__save = 'ERR ' + String(e.message || e).slice(0, 400) })
  })
  await password()
  for (let i = 0; i < 40; i++) { await sleep(500); await drain(true) }
  out.saveResult = await page.evaluate(() => window.__save ?? null)
  out.afterAdd = rows(`select pocode,suppcode,salesmancode,posted,amount::text,remarks from dbo.purorderheader where remarks='${REMARKS}'`)
  code = out.afterAdd[0]?.[0] ?? null
  out.detail = code ? rows(`select icode,qty::text,rate::text from dbo.purorderdetail where pocode=${Number(code)}`) : []
  out.addOk = !!code && out.detail.length === 1
  out.deleteEnabled = await page.evaluate(() => {
    const rt = window.rt
    const w = rt.windowInstances.get('w_purchaseorder')
    const menu = w.props.get('menuid')
    let hit = null
    const walk = (o) => { for (const c of o.children.values()) { if (c.name === 'm_delete') hit = c; else walk(c) } }
    if (menu) walk(menu)
    return hit ? hit.props.get('enabled') : null
  })

  // reopen from the list and edit remarks through the real editor
  if (code) {
    out.reopen = await page.evaluate(async (code) => {
      const rt = window.rt
      const w = rt.windowInstances.get('w_purchaseorder')
      void w.pbCall('ue_list', [], rt).catch(() => {})
      await new Promise((r) => setTimeout(r, 2200))
      const l = w.props.get('id_list')
      if (!l?.model) return { error: 'no list' }
      const n = await l.n_rowcount()
      const ci = l.model.colIndex('code')
      let row = 0
      for (let i = 1; i <= n; i++) if (Number(l.model.buf.primary[i - 1]?.v[ci]) === code) { row = i; break }
      if (!row) return { error: 'PO not in list', rows: n }
      await l.pbCall('setrow', [row], rt)
      await l.n_scrolltorow(row)
      w.props.set('id_dwcontrol', l)
      w.props.set('il_selectedrow', row)
      void w.pbCall('ue_detail', [], rt).catch(() => {})
      await new Promise((r) => setTimeout(r, 2200))
      const m = w.props.get('id_master')
      return { listRows: n, row, masterRows: m?.model?.rowCount?.() ?? 0, code: String(m?.model?.buf?.primary?.[0]?.v?.[m.model.colIndex('code')] ?? '') }
    }, Number(code))
    await drain()
    const cell = await page.evaluateHandle(() => {
      const rt = window.rt
      const w = rt.windowInstances.get('w_purchaseorder')
      const m = w.props.get('id_master')
      return rt.ui.views.get(w)?.ctlViews?.get?.(m)?.el?.querySelector('.o[data-obj="remarks"]') ?? null
    })
    const elem = cell.asElement()
    out.edit = { field: 'remarks', value: REMARKS2 }
    if (!elem) out.edit.skipped = 'not rendered'
    else {
      await elem.scrollIntoViewIfNeeded().catch(() => {})
      await elem.click({ force: true })
      await sleep(200)
      const ed = page.locator('.dw-edit').last()
      if (!(await ed.count())) out.edit.skipped = 'no editor'
      else {
        await ed.fill(REMARKS2)
        await page.keyboard.press('Tab')
        await sleep(500)
        out.messages.push(...await drain())
        out.edit.got = await page.evaluate(async () => {
          const rt = window.rt
          const w = rt.windowInstances.get('w_purchaseorder')
          const m = w.props.get('id_master')
          try { return String(await m.pbCall('getitemstring', [1, 'remarks'], rt)) } catch { /* raw */ }
          const mm = m.model
          return String(mm.buf.primary[0]?.v[mm.colIndex('remarks')] ?? '')
        })
        out.edit.applied = out.edit.got === REMARKS2
      }
    }
    out.save2 = await page.evaluate(() => {
      const rt = window.rt
      const w = rt.windowInstances.get('w_purchaseorder')
      window.__save = false
      void w.pbCall('ue_save', [], rt).then(() => { window.__save = 'ok' }).catch((e) => { window.__save = 'ERR ' + String(e.message || e).slice(0, 400) })
    })
    await password()
    for (let i = 0; i < 40; i++) { await sleep(500); await drain(true) }
    out.afterEdit = rows(`select pocode,remarks from dbo.purorderheader where pocode=${Number(code)}`)
    out.editOk = out.afterEdit[0]?.[1] === REMARKS2
  }
  out.ok = !!out.addOk && !!out.editOk && out.errors.length === 0
} catch (e) {
  out.fatal = String(e.stack || e).slice(0, 2500)
} finally {
  try {
    if (code) {
      q(`delete from dbo.purorderdetail where pocode=${Number(code)}`)
      q(`delete from dbo.purorderheader where pocode=${Number(code)}`)
    }
    const b = out.baseline
    if (b) {
      if (b.tab !== null) q(`update dbo._tabmaxkey set tabmaxkey=${Number(b.tab)} where tabname='PurOrderHeader'`)
      if (b.detailMax) q(`select setval(pg_get_serial_sequence('dbo.purorderdetail','porowid'), ${Number(b.detailMax)}, true)`)
      if (b.utn) q(`update dbo._utn set utn=${Number(b.utn)}`)
      if (b.serverDate) q(`update dbo.serverdate set lasttransdate='${String(b.serverDate).replace(/'/g, "''")}'::timestamp`)
      if (b.auditMax) { q(`delete from dbo.audit_log where audit_id > ${b.auditMax}`); q(`select setval(pg_get_serial_sequence('dbo.audit_log','audit_id'), ${b.auditMax}, true)`) }
    }
    out.final = counts()
    out.baselineOk = JSON.stringify(out.final) === JSON.stringify(out.baseline)
  } catch (e) { out.restoreError = String(e.message || e).slice(0, 800) }
  writeFileSync(`${OUT}/purchaseorder-crud.json`, JSON.stringify(out, null, 1))
  console.log(JSON.stringify(out, (k, v) => (typeof v === 'bigint' ? Number(v) : v), 1))
  await browser.close().catch(() => {})
}
