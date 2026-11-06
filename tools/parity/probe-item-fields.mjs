// Item master: type the remaining item fields that the generic audit could
// not apply (blank new row / price recalculation) through the real DOM
// editors, save, verify the row in PostgreSQL, then remove the test item and
// restore every counter.
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
const require = createRequire(process.env.PLAYWRIGHT_MODULES || 'C:/Users/Admin/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/')
const { chromium } = require('playwright')
const PSQL = 'C:\\PostgreSQL\\17\\bin\\psql.exe'
const DB = process.env.PARITY_DB || 'trader_write_test'
const OUT = 'C:/Projects/Abuzar/deploy/parity/item-fields'
mkdirSync(OUT, { recursive: true })
const q = (sql) => execFileSync(PSQL, ['-U', 'postgres', '-h', '127.0.0.1', '-d', DB, '-t', '-A', '-F', '|', '-c', sql], { env: { ...process.env, PGPASSWORD: 'postgres' }, encoding: 'utf8', windowsHide: true }).trim()
const rows = (sql) => q(sql).split(/\r?\n/).filter(Boolean).map((l) => l.split('|'))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const SUF = String(Date.now()).slice(-6)
const NAME = 'PARITY ITEM FIELDS ' + SUF
const CODE = 'PIF' + SUF

const TARGETS = [
  ['name', 'name', NAME],
  ['customicode', 'customicode', CODE],
  ['location', 'location', 'PARITY LOCATION'],
  ['purprice', 'purprice', '7'],
  ['salediscperc', 'salediscperc', '3'],
  ['minqty', 'minqty', '4'],
  ['packsalestax', 'packsalestax', '2'],
  ['saleprice', 'saleprice', '15'],
  ['bonusqty', 'bonusqty', '2'],
  ['commissionperc', 'commissionperc', '1'],
]

const counts = () => ({
  item: Number(rows('select count(*) from dbo.item')[0][0]),
  itemMax: Number(rows('select coalesce(max(icode),0) from dbo.item')[0][0]),
  suppliers: Number(rows('select count(*) from dbo.itemsuppliers')[0][0]),
  itemnotes: Number(rows('select count(*) from dbo.itemnotes')[0][0]),
  pricepolicy: Number(rows('select count(*) from dbo.pricepolicy')[0][0]),
  itemlog: Number(rows('select count(*) from dbo.itemlog')[0][0]),
  itemTab: rows("select tabmaxkey from dbo._tabmaxkey where tabname='Item'")[0]?.[0] ?? null,
  tabs: rows("select tabname,tabmaxkey from dbo._tabmaxkey where tabname ilike '%item%' order by tabname"),
  headers: rows('select headercode,module,tabmaxkey from dbo._headertabmaxkey order by headercode,module'),
  utn: rows('select utn from dbo._utn')[0]?.[0] ?? null,
  serverDate: rows('select lasttransdate::text from dbo.serverdate')[0]?.[0] ?? null,
  audit: Number(rows('select count(*) from dbo.audit_log')[0][0]),
  auditMax: Number(rows('select max(audit_id) from dbo.audit_log')[0][0]),
})

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } })
page.setDefaultTimeout(20000)
const out = { name: NAME, code: CODE, fields: [], messages: [], errors: [] }
page.on('pageerror', (e) => out.errors.push(String(e.message || e).slice(0, 400)))

async function drain() {
  const texts = []
  for (let i = 0; i < 20; i++) {
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
    await sleep(120)
  }
  return texts
}

let code = null
try {
  out.baseline = counts()
  await page.goto('http://127.0.0.1:5177/?app=1&autologin=ADMIN:password9080', { waitUntil: 'load', timeout: 60000 })
  await page.waitForFunction(() => window.rt && window.rt.windowInstances.get('w_main') && typeof window.__menu === 'function', null, { timeout: 90000, polling: 300 })
  await page.evaluate(() => { void window.__menu('Basic Data | Item .......... | Item') })
  await page.waitForFunction(() => window.rt.windowInstances.get('w_item_form'), null, { timeout: 30000, polling: 300 })
  await sleep(2000)
  await drain()
  out.newform = await page.evaluate(async ({ name, alias }) => {
    const rt = window.rt
    const w = rt.windowInstances.get('w_item_form')
    await rt.fire(w, 'ue_newform')
    await new Promise((r) => setTimeout(r, 1200))
    const m = w.props.get('id_master')
    const d = w.props.get('id_detail')
    const seed = {
      name: 'SEED ITEM', customicode: 'SEED' + alias, manfcode: 1, iccode: 1, icatcode: 1, packcode: 1, gcode: 1,
      saleprice: 10, purprice: 5, retailprice: 10, packunits: 1, active: 1, prescribed: 0, refrigrated: 0, printable: 1,
      salediscperc: 0, purdiscperc: 0, salestax: 0, reorderqty: 0, optimumqty: 0, reorderlevel: 0, optimumlevel: 0,
      isizecode: 1, istylecode: 1, icolourcode: 1, isleevecode: 1, iyarncode: 1,
    }
    const bad = []
    for (const [k, v] of Object.entries(seed)) { try { await m.pbCall('setitem', [1, k, v], rt) } catch { bad.push('m:' + k) } }
    await m.pbCall('accepttext', [], rt).catch(() => {})
    if (d?.model?.rowCount()) {
      for (const [k, v] of Object.entries({ suppcode: 18, priority: 1 })) { try { await d.pbCall('setitem', [1, k, v], rt) } catch { bad.push('d:' + k) } }
      await d.pbCall('accepttext', [], rt).catch(() => {})
    }
    // scope the field cells to this DataWindow: customicode/commissionperc
    // also exist in other grids of the form
    const view = rt.ui.views.get(w)
    view?.ctlViews?.get?.(m)?.el?.setAttribute('data-parity-dw', 'master')
    return { masterRows: m.model.rowCount(), detailRows: d?.model?.rowCount?.() ?? 0, bad, editflag: w.props.get('editflag') }
  }, { name: NAME, alias: SUF })
  out.messages.push(...await drain())

  for (const [field, dbfield, value] of TARGETS) {
    const rec = { field, db: dbfield, value }
    try {
      const cell = page.locator(`[data-parity-dw="master"] .o[data-obj="${field}"]`).first()
      if (!(await cell.count())) { rec.skipped = 'not rendered'; out.fields.push(rec); continue }
      await cell.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {})
      await cell.click({ force: true, timeout: 3000 })
      await sleep(200)
      const ed = page.locator('.dw-edit').last()
      if (!(await ed.count())) { rec.skipped = 'no editor'; await page.keyboard.press('Escape').catch(() => {}); out.fields.push(rec); continue }
      await ed.fill(value)
      await page.keyboard.press('Tab')
      await sleep(450)
      const msgs = await drain()
      if (msgs.length) rec.message = msgs.join(' | ')
      rec.got = await page.evaluate(async (f) => {
        const rt = window.rt
        const w = rt.windowInstances.get('w_item_form')
        const m = w.props.get('id_master')
        try { return String(await m.pbCall('getitemstring', [1, f], rt)) } catch { /* raw */ }
        const mm = m.model
        const v = mm.buf.primary[0]?.v[mm.colIndex(f)]
        return v === null || v === undefined ? '' : String(v)
      }, field)
      const norm = (x) => String(x ?? '').trim().replace(/,/g, '').replace(/\.0+$/, '')
      rec.applied = norm(rec.got) === norm(value) || (/^-?\d+(\.\d+)?$/.test(value) && Math.abs(Number(norm(rec.got)) - Number(value)) < 1e-9)
      if (!rec.applied) rec.value = rec.got
    } catch (e) {
      rec.error = String(e.message || e).slice(0, 300)
      await page.keyboard.press('Escape').catch(() => {})
    }
    out.fields.push(rec)
  }
  out.appliedModel = out.fields.filter((f) => f.applied).length
  out.rendered = out.fields.filter((f) => !f.skipped && !f.error).length

  out.save = await page.evaluate(async () => {
    const rt = window.rt
    const w = rt.windowInstances.get('w_item_form')
    window.__save = false
    void w.pbCall('ue_save', [], rt).then(() => { window.__save = 'ok' }).catch((e) => { window.__save = 'ERR ' + String(e.message || e).slice(0, 500) })
  })
  for (let i = 0; i < 50; i++) { await sleep(500); await drain() }
  out.saveResult = await page.evaluate(() => window.__save ?? null)
  out.db = rows(`select icode,${TARGETS.map((t) => t[1]).join(',')} from dbo.item where name='${NAME.replace(/'/g, "''")}'`)
  code = out.db[0]?.[0] ?? null
  if (out.db[0]) {
    const row = out.db[0]
    out.dbChecks = TARGETS.map(([, db], i) => {
      const f = out.fields[i]
      return { db, applied: !!f?.applied, expected: f?.value, actual: row[i + 1] }
    })
    const checked = out.dbChecks.filter((c) => c.applied)
    out.dbOk = checked.filter((c) => String(c.actual ?? '').trim().replace(/\.0+$/, '') === String(c.expected ?? '').trim().replace(/\.0+$/, '')).length
    out.checked = checked.length
  }
  out.ok = !!code && out.errors.length === 0 && out.appliedModel === out.rendered && out.dbOk === out.checked
} catch (e) {
  out.fatal = String(e.stack || e).slice(0, 2500)
} finally {
  try {
    if (code) {
      // the item Save also creates an item note and the default price policy
      try { q(`delete from dbo.pricepolicydetail where pricepolicycode in (select pricepolicycode from dbo.pricepolicy where icode=${Number(code)})`) } catch { /* no policy detail */ }
      for (const table of ['pricepolicy', 'itemnotes', 'itemsuppliers', 'item']) {
        try { q(`delete from dbo.${table} where icode=${Number(code)}`) } catch { /* best effort per child */ }
      }
    }
    const b = out.baseline
    if (b) {
      for (const [name, value] of b.tabs) q(`update dbo._tabmaxkey set tabmaxkey=${Number(value)} where tabname='${String(name).replace(/'/g, "''")}'`)
      for (const [hc, m, value] of b.headers) q(`update dbo._headertabmaxkey set tabmaxkey=${Number(value)} where headercode=${Number(hc)} and module=${Number(m)}`)
      if (b.utn) q(`update dbo._utn set utn=${Number(b.utn)}`)
      if (b.serverDate) q(`update dbo.serverdate set lasttransdate='${String(b.serverDate).replace(/'/g, "''")}'::timestamp`)
      if (b.auditMax) { q(`delete from dbo.audit_log where audit_id > ${b.auditMax}`); q(`select setval(pg_get_serial_sequence('dbo.audit_log','audit_id'), ${b.auditMax}, true)`) }
    }
    out.final = counts()
    out.baselineOk = JSON.stringify(out.final) === JSON.stringify(out.baseline)
  } catch (e) { out.restoreError = String(e.message || e).slice(0, 800) }
  writeFileSync(`${OUT}/item-fields.json`, JSON.stringify(out, null, 1))
  console.log(JSON.stringify(out, (k, v) => (typeof v === 'bigint' ? Number(v) : v), 1))
  await browser.close().catch(() => {})
}
