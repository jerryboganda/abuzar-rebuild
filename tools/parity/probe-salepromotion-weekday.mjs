// Sale Promotion: drive weekdaycode through its real dddw editor, save, verify
// dbo.salepromotion.weekdaycode, then remove the fixture and restore counters.
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
const require = createRequire(process.env.PLAYWRIGHT_MODULES || 'C:/Users/Admin/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/')
const { chromium } = require('playwright')
const PSQL = 'C:\\PostgreSQL\\17\\bin\\psql.exe'
const DB = process.env.PARITY_DB || 'trader_write_test'
const OUT = 'C:/Projects/Abuzar/deploy/parity/salepromotion-weekday'
mkdirSync(OUT, { recursive: true })
const q = (sql) => execFileSync(PSQL, ['-U', 'postgres', '-h', '127.0.0.1', '-d', DB, '-t', '-A', '-F', '|', '-c', sql], { env: { ...process.env, PGPASSWORD: 'postgres' }, encoding: 'utf8', windowsHide: true }).trim()
const rows = (sql) => q(sql).split(/\r?\n/).filter(Boolean).map((l) => l.split('|'))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const SUF = String(Date.now()).slice(-6)
const NAME = 'PARITY WEEKDAY ' + SUF
const GROUP = 'PARITY GROUP ' + SUF
const CUST = 22

const counts = () => ({
  promotions: Number(rows('select count(*) from dbo.salepromotion')[0][0]),
  promotionMax: Number(rows('select coalesce(max(salepromotioncode),0) from dbo.salepromotion')[0][0]),
  groups: Number(rows('select count(*) from dbo.customergroup')[0][0]),
  groupDetails: Number(rows('select count(*) from dbo.customergroupdetail')[0][0]),
  custDisc: rows(`select defaultitemdiscperc from dbo.customer where custcode=${CUST}`)[0]?.[0] ?? null,
  tab: rows("select tabmaxkey from dbo._tabmaxkey where tabname='SalePromotion'")[0]?.[0] ?? null,
  utn: rows('select utn from dbo._utn')[0]?.[0] ?? null,
  serverDate: rows('select lasttransdate::text from dbo.serverdate')[0]?.[0] ?? null,
  audit: Number(rows('select count(*) from dbo.audit_log')[0][0]),
  auditMax: Number(rows('select max(audit_id) from dbo.audit_log')[0][0]),
})

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } })
page.setDefaultTimeout(20000)
const out = { name: NAME, fields: [], messages: [], errors: [] }
page.on('pageerror', (e) => out.errors.push(String(e.message || e).slice(0, 400)))

async function drain() {
  const texts = []
  for (let i = 0; i < 24; i++) {
    const t = await page.evaluate(() => {
      const b = document.querySelector('.msgbox')
      if (!b) return null
      const text = (b.querySelector('.txt')?.textContent || '').replace(/\s+/g, ' ').trim()
      const bs = [...b.querySelectorAll('.btns button')]
      ;(bs.find((x) => /^(ok|yes|no|cancel|close)$/i.test(x.textContent.trim())) || bs[0])?.click()
      return text
    })
    if (t === null) break
    texts.push(t)
    await sleep(140)
  }
  return texts
}

let code = null
try {
  out.baseline = counts()
  q(`insert into dbo.customergroup (customergroupcode,name,remarks,usercode) values (1,'${GROUP.replace(/'/g, "''")}','PARITY TEST GROUP',1)`)
  q(`insert into dbo.customergroupdetail (customergroupcode,custcode,rowid) values (1,${CUST},1)`)
  await page.goto('http://127.0.0.1:5177/?app=1&autologin=ADMIN:password9080', { waitUntil: 'load', timeout: 60000 })
  await page.waitForFunction(() => window.rt && window.rt.windowInstances.get('w_main') && typeof window.__menu === 'function', null, { timeout: 90000, polling: 300 })
  await page.evaluate(() => { void window.__menu('Basic Data | Customer .......... | Sale Promotion') })
  await page.waitForFunction(() => window.rt.windowInstances.get('w_salepromotion_form'), null, { timeout: 30000, polling: 300 })
  await sleep(1500)
  await drain()
  out.newform = await page.evaluate(async ({ name }) => {
    const rt = window.rt
    const w = rt.windowInstances.get('w_salepromotion_form')
    await w.pbCall('ue_newform', [], rt).catch(() => {})
    await new Promise((r) => setTimeout(r, 800))
    const d = w.props.get('id_detail')
    if (!d.model.rowCount()) await d.pbCall('insertrow', [0], rt)
    for (const [k, v] of Object.entries({ name, active: 'Y', customergroupcode: 1, defaultitemdiscperc: 5, remarks: 'PARITY WEEKDAY TEST' })) {
      try { await d.pbCall('setitem', [1, k, v], rt) } catch { /* noted below */ }
    }
    await d.pbCall('accepttext', [], rt).catch(() => {})
    const view = rt.ui.views.get(w)
    view?.ctlViews?.get?.(d)?.el?.setAttribute('data-parity-dw', 'detail')
    return { rows: d.model.rowCount(), cols: d.model.colNames }
  }, { name: NAME })
  out.messages.push(...await drain())

  // drive weekdaycode through the real dddw
  const rec = { field: 'weekdaycode' }
  const cell = page.locator('[data-parity-dw="detail"] .o[data-obj="weekdaycode"]').first()
  if (!(await cell.count())) rec.skipped = 'not rendered'
  else {
    await cell.scrollIntoViewIfNeeded().catch(() => {})
    await cell.click({ force: true })
    await sleep(300)
    const ed = page.locator('.dw-edit').last()
    if (!(await ed.count())) rec.skipped = 'no editor'
    else {
      const opts = await ed.locator('option').evaluateAll((os) => os.map((o) => ({ value: o.value, text: (o.textContent || '').trim() })).filter((o) => o.value !== ''))
      rec.options = opts
      const chosen = opts.find((o) => /monday/i.test(o.text)) ?? opts[0]
      if (!chosen) rec.skipped = 'empty drop-down'
      else {
        await ed.selectOption(chosen.value)
        await page.keyboard.press('Tab').catch(() => {})
        await sleep(700)
        out.messages.push(...await drain())
        rec.selected = chosen
        rec.got = await page.evaluate(async () => {
          const rt = window.rt
          const w = rt.windowInstances.get('w_salepromotion_form')
          const d = w.props.get('id_detail')
          try { return String(await d.pbCall('getitemstring', [1, 'weekdaycode'], rt)) } catch { /* raw */ }
          const m = d.model
          const v = m.buf.primary[0]?.v[m.colIndex('weekdaycode')]
          return v === null || v === undefined ? '' : String(v)
        })
        rec.applied = rec.got !== ''
      }
    }
  }
  out.fields.push(rec)
  out.fieldOk = !!rec.applied

  out.save = await page.evaluate(async () => {
    const rt = window.rt
    const w = rt.windowInstances.get('w_salepromotion_form')
    window.__save = false
    void w.pbCall('ue_save', [], rt).then(() => { window.__save = 'ok' }).catch((e) => { window.__save = 'ERR ' + String(e.message || e).slice(0, 400) })
  })
  for (let i = 0; i < 40; i++) { await sleep(500); await drain() }
  out.saveResult = await page.evaluate(() => window.__save ?? null)
  out.db = rows(`select salepromotioncode,name,weekdaycode,remarks,active,customergroupcode,defaultitemdiscperc from dbo.salepromotion where name='${NAME.replace(/'/g, "''")}'`)
  code = out.db[0]?.[0] ?? null
  out.dbOk = !!code && out.db[0][2] === rec.got
  out.ok = !!code && out.fieldOk && out.dbOk && out.errors.length === 0
} catch (e) {
  out.fatal = String(e.stack || e).slice(0, 2500)
} finally {
  try {
    if (code) q(`delete from dbo.salepromotion where salepromotioncode=${Number(code)}`)
    q(`delete from dbo.customergroupdetail where customergroupcode=1 and custcode=${CUST}`)
    q(`delete from dbo.customergroup where customergroupcode=1 and name='${GROUP.replace(/'/g, "''")}'`)
    const b = out.baseline
    if (b) {
      if (b.custDisc !== null) q(`update dbo.customer set defaultitemdiscperc=${Number(b.custDisc)} where custcode=${CUST}`)
      if (b.tab !== null) q(`update dbo._tabmaxkey set tabmaxkey=${Number(b.tab)} where tabname='SalePromotion'`)
      if (b.utn) q(`update dbo._utn set utn=${Number(b.utn)}`)
      if (b.serverDate) q(`update dbo.serverdate set lasttransdate='${String(b.serverDate).replace(/'/g, "''")}'::timestamp`)
      if (b.auditMax) { q(`delete from dbo.audit_log where audit_id > ${b.auditMax}`); q(`select setval(pg_get_serial_sequence('dbo.audit_log','audit_id'), ${b.auditMax}, true)`) }
    }
    out.final = counts()
    out.baselineOk = JSON.stringify(out.final) === JSON.stringify(out.baseline)
  } catch (e) { out.restoreError = String(e.message || e).slice(0, 800) }
  writeFileSync(`${OUT}/salepromotion-weekday.json`, JSON.stringify(out, null, 1))
  console.log(JSON.stringify(out, (k, v) => (typeof v === 'bigint' ? Number(v) : v), 1))
  await browser.close().catch(() => {})
}
