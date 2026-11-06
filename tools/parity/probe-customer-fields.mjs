// Customer master: type every one of the 22 customer_* fields through the real
// DOM editors (this is the screen whose run-time Modify() used to make the
// editor guard reject every commit), save, verify each value in PostgreSQL,
// then delete the test customer and restore every counter exactly.
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
const require = createRequire(process.env.PLAYWRIGHT_MODULES || 'C:/Users/Admin/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/')
const { chromium } = require('playwright')
const PSQL = 'C:\\PostgreSQL\\17\\bin\\psql.exe'
const DB = process.env.PARITY_DB || 'trader_write_test'
const OUT = 'C:/Projects/Abuzar/deploy/parity/customer-fields'
mkdirSync(OUT, { recursive: true })
const q = (sql) => execFileSync(PSQL, ['-U', 'postgres', '-h', '127.0.0.1', '-d', DB, '-t', '-A', '-F', '|', '-c', sql], { env: { ...process.env, PGPASSWORD: 'postgres' }, encoding: 'utf8', windowsHide: true }).trim()
const rows = (sql) => q(sql).split(/\r?\n/).filter(Boolean).map((l) => l.split('|'))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const SUF = String(Date.now()).slice(-6)
const NAME = 'PARITY CUSTOMER FIELDS ' + SUF
const ALIAS = 'PCF' + SUF

// target fields and the database column each one updates
const TARGETS = [
  ['customer_city', 'city', 'PARITY-CITY'],
  ['customer_membershipid', 'membershipid', 'MEM-' + SUF],
  ['customer_designation', 'designation', 'DESIG-' + SUF],
  ['customer_postcode', 'postcode', '75000'],
  ['customer_country', 'country', 'PARITYLAND'],
  ['customer_phone', 'phone', '0300-7654321'],
  ['customer_fax', 'fax', '021-1234567'],
  ['customer_licenceno', 'licenceno', 'LIC-' + SUF],
  ['customer_salestaxregno', 'salestaxregno', 'STR-' + SUF],
  ['customer_ntnno', 'ntnno', 'NTN-' + SUF],
  ['customer_invdiscperc', 'invdiscperc', '2'],
  ['customer_crlimit', 'crlimit', '5'],
  ['customer_dayslimit', 'dayslimit', '5'],
  ['customer_defaultsaleprice', 'defaultsaleprice', '1'],
  ['customer_nic', 'nic', 'NIC-' + SUF],
  ['customer_address1', 'address1', 'PARITY ADDRESS 1'],
  ['customer_cp2', 'cp2', 'PARITY CP2'],
  ['customer_cp', 'cp', 'PARITY CP'],
  ['customer_address2', 'address2', 'PARITY ADDRESS 2'],
  ['customer_bankname', 'bankname', 'PARITY BANK'],
  ['customer_bankadd', 'bankadd', 'PARITY BANK ADDRESS'],
  ['customer_specialinstructions', 'specialinstructions', 'PARITY INSTRUCTIONS'],
]

const counts = () => ({
  accounts: Number(rows('select count(*) from dbo.accounts')[0][0]),
  accountsMax: Number(rows('select coalesce(max(acccode),0) from dbo.accounts')[0][0]),
  customer: Number(rows('select count(*) from dbo.customer')[0][0]),
  accountsTab: rows("select tabmaxkey from dbo._tabmaxkey where tabname='Accounts'")[0]?.[0] ?? null,
  utn: rows('select utn from dbo._utn')[0]?.[0] ?? null,
  serverDate: rows('select lasttransdate::text from dbo.serverdate')[0]?.[0] ?? null,
  audit: Number(rows('select count(*) from dbo.audit_log')[0][0]),
  auditMax: Number(rows('select max(audit_id) from dbo.audit_log')[0][0]),
})

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } })
page.setDefaultTimeout(20000)
const out = { name: NAME, alias: ALIAS, fields: [], messages: [], errors: [] }
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
  await page.evaluate(() => { void window.__menu('Basic Data | Customer .......... | Customer') })
  await page.waitForFunction(() => window.rt.windowInstances.get('w_customer_form'), null, { timeout: 30000, polling: 300 })
  await sleep(2000)
  await drain()

  // new customer row + the fields the form requires before Save
  out.newform = await page.evaluate(async ({ name, alias }) => {
    const rt = window.rt
    const w = rt.windowInstances.get('w_customer_form')
    await w.pbCall('ue_newform', [], rt)
    await new Promise((r) => setTimeout(r, 1200))
    const d = w.props.get('id_detail')
    const seed = {
      accounts_name: name, accounts_aliasname: alias, accounts_subcode: 3, accounts_active: 'Y',
      customer_areacode: 1, customer_subareacode: 1, customer_custcatcode: 1,
      customer_city: 'SEED', customer_country: 'SEEDLAND', customer_address1: 'SEED ADDRESS',
      customer_phone: '000', customer_crlimit: 0, customer_dayslimit: 0, customer_criticallimit: 0,
      customer_customersectorcode: 1, customer_taxcategorycode: 1, customer_defaultgst: 1,
      customer_salesmancode: 1, customer_collectionpolicycode: 1, customer_defaultsaleprice: 1,
      customer_defaultitemdiscperc: 1, customer_gender: 'M', customer_ageinyears: 25,
      customer_schedforposting: 'Y',
    }
    const bad = []
    for (const [k, v] of Object.entries(seed)) { try { await d.pbCall('setitem', [1, k, v], rt) } catch { bad.push(k) } }
    await d.pbCall('setrow', [1], rt)
    await d.pbCall('accepttext', [], rt).catch(() => {})
    return { rows: d.model.rowCount(), bad, editflag: w.props.get('editflag') }
  }, { name: NAME, alias: ALIAS })
  out.messages.push(...await drain())

  // type every target through the real editor
  for (const [field, dbfield, value] of TARGETS) {
    const rec = { field, db: dbfield, value }
    try {
      const cell = page.locator(`.pbwin:not(.sheet) .o[data-obj="${field}"]`).first()
      if (!(await cell.count())) { rec.skipped = 'not rendered'; out.fields.push(rec); continue }
      await cell.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {})
      await cell.click({ force: true, timeout: 3000 })
      await sleep(200)
      const ed = page.locator('.dw-edit').last()
      if (!(await ed.count())) { rec.skipped = 'no editor'; await page.keyboard.press('Escape').catch(() => {}); out.fields.push(rec); continue }
      const tag = await ed.evaluate((e) => e.tagName)
      if (tag === 'SELECT') {
        const opts = await ed.locator('option').evaluateAll((os) => os.map((o) => ({ value: o.value, text: o.textContent || '' })).filter((o) => o.value !== ''))
        if (!opts.length) { rec.skipped = 'empty drop-down'; await page.keyboard.press('Escape').catch(() => {}); out.fields.push(rec); continue }
        // the dddw option value is a presentation index and the commit maps it
        // to the data column; choose "Sale Price 1" and verify the mapped code
        const chosen = field === 'customer_defaultsaleprice'
          ? opts.find((o) => o.text.trim() === 'Sale Price 1') ?? opts[0]
          : opts.find((o) => o.value === value) ?? opts[0]
        await ed.selectOption(chosen.value)
        rec.selected = chosen
        rec.isSelect = true
      } else {
        await ed.fill(value)
      }
      await page.keyboard.press('Tab')
      await sleep(450)
      const msgs = await drain()
      if (msgs.length) rec.message = msgs.join(' | ')
      rec.got = await page.evaluate(async (f) => {
        const rt = window.rt
        const w = rt.windowInstances.get('w_customer_form')
        const d = w.props.get('id_detail')
        try { return String(await d.pbCall('getitemstring', [1, f], rt)) } catch { /* raw */ }
        const m = d.model
        const v = m.buf.primary[0]?.v[m.colIndex(f)]
        return v === null || v === undefined ? '' : String(v)
      }, field)
      const norm = (x) => String(x ?? '').trim().replace(/,/g, '').replace(/\.0+$/, '')
      rec.applied = norm(rec.got) === norm(value) || (/^-?\d+(\.\d+)?$/.test(value) && Math.abs(Number(norm(rec.got)) - Number(value)) < 1e-9)
    } catch (e) {
      rec.error = String(e.message || e).slice(0, 300)
      await page.keyboard.press('Escape').catch(() => {})
    }
    out.fields.push(rec)
  }
  out.appliedModel = out.fields.filter((f) => f.applied).length
  out.rendered = out.fields.filter((f) => !f.skipped && !f.error).length

  // save through the form
  out.save = await page.evaluate(async () => {
    const rt = window.rt
    const w = rt.windowInstances.get('w_customer_form')
    window.__save = false
    void w.pbCall('ue_save', [], rt).then(() => { window.__save = 'ok' }).catch((e) => { window.__save = 'ERR ' + String(e.message || e).slice(0, 400) })
  })
  for (let i = 0; i < 40; i++) { await sleep(500); await drain() }
  out.saveResult = await page.evaluate(() => window.__save ?? null)
  out.db = rows(`select a.acccode,a.name,c.${TARGETS.map((t) => t[1]).join(',c.')} from dbo.accounts a join dbo.customer c on c.custcode=a.acccode where a.name='${NAME.replace(/'/g, "''")}'`)
  code = out.db[0]?.[0] ?? null
  if (out.db[0]) {
    const row = out.db[0]
    out.dbChecks = TARGETS.map(([, db], i) => ({ db, expected: out.fields[i]?.value ?? TARGETS[i][2], actual: row[i + 2] }))
    out.dbOk = out.dbChecks.filter((c) => String(c.actual ?? '').trim().replace(/\.0+$/, '') === String(c.expected).trim().replace(/\.0+$/, '')).length
  }
  out.ok = !!code && out.dbOk === TARGETS.length && out.errors.length === 0
} catch (e) {
  out.fatal = String(e.stack || e).slice(0, 2500)
} finally {
  // exact restore: delete only our row, then reset the counter/audit/date
  try {
    if (code) q(`delete from dbo.customer where custcode=${Number(code)}; delete from dbo.accounts where acccode=${Number(code)}`)
    const b = out.baseline
    if (b) {
      if (b.accountsTab !== null) q(`update dbo._tabmaxkey set tabmaxkey=${Number(b.accountsTab)} where tabname='Accounts'`)
      if (b.utn) q(`update dbo._utn set utn=${Number(b.utn)}`)
      if (b.serverDate) q(`update dbo.serverdate set lasttransdate='${String(b.serverDate).replace(/'/g, "''")}'::timestamp`)
      if (b.auditMax) { q(`delete from dbo.audit_log where audit_id > ${b.auditMax}`); q(`select setval(pg_get_serial_sequence('dbo.audit_log','audit_id'), ${b.auditMax}, true)`) }
    }
    out.final = counts()
    out.baselineOk = JSON.stringify(out.final) === JSON.stringify(out.baseline)
  } catch (e) { out.restoreError = String(e.message || e).slice(0, 800) }
  writeFileSync(`${OUT}/customer-fields.json`, JSON.stringify(out, null, 1))
  console.log(JSON.stringify(out, (k, v) => (typeof v === 'bigint' ? Number(v) : v), 1))
  await browser.close().catch(() => {})
}
