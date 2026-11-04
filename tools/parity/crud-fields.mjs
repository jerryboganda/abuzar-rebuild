// Per-field add / edit / delete through the rebuilt desktop UI, verified in PostgreSQL.
// Every editable cell is clicked, typed into (or a drop-down option chosen), committed
// with Tab, then the record is saved, edited and deleted through the window's own
// File | Save / File | Delete events.  The clone database is the target.
//
//   node crud-fields.mjs --base http://127.0.0.1:5177 --db trader_write_test --form manufacturer
import { createRequire } from 'node:module'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
const require = createRequire(process.env.PLAYWRIGHT_MODULES || 'C:/Users/Admin/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/')
const { chromium } = require('playwright')

const arg = (n, d) => { const i = process.argv.indexOf(n); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d }
const BASE = arg('--base', 'http://127.0.0.1:5177')
const DB = arg('--db', 'trader_write_test')
const FORM = arg('--form', 'manufacturer')
const OUT = arg('--out', join(process.cwd(), 'screen-parity', 'crud'))
const loginFile = arg('--login-file', 'C:/Projects/Abuzar/deploy/parity/login-trader.ps1')
const src = readFileSync(loginFile, 'utf8')
const USER = arg('--user', (src.match(/\$User\s*=\s*'([^']*)'/) || [])[1] || 'ADMIN')
const PASS = arg('--pass', (src.match(/\$Pass\s*=\s*'([^']*)'/) || [])[1])
if (!PASS) throw new Error('no password in ' + loginFile)
mkdirSync(OUT, { recursive: true })

const PSQL = process.env.PSQL || 'C:\\PostgreSQL\\17\\bin\\psql.exe'
const query = (sql) => execFileSync(PSQL, ['-U', process.env.PGUSER || 'postgres', '-h', process.env.PGHOST || '127.0.0.1', '-d', DB, '-t', '-A', '-F', '|', '-c', sql], { env: { ...process.env, PGPASSWORD: process.env.PGPASSWORD || 'postgres' }, encoding: 'utf8', windowsHide: true }).trim().split(/\r?\n/).filter(Boolean).map((l) => l.split('|'))

const FORMS = {
  manufacturer: {
    path: 'Basic Data | Item .......... | Manufacturer', window: 'w_manufacturer_form',
    table: 'manufacturer', dbKey: 'manfcode', keyCol: 'code', nameCol: 'name', prefix: 'PZUI',
    values: { manfcatcode: 1, manufacturertypecode: 1, popolicycode: 1, city: 'KARACHI', country: 'PAKISTAN', phone: '03001234567', cp: 'CRUD PERSON', email: 'crud@example.com', address1: 'CRUD ADDRESS', address2: 'CRUD ADDRESS', fax: '111', licenseno: 'CRUD', purorderbaseperioddays: 1, purorderprojperioddays: 1 },
  },
  itemclass: {
    path: 'Basic Data | Item .......... | Item Class', window: 'w_class_form',
    table: 'itemclass', dbKey: 'iccode', keyCol: 'code', nameCol: 'name', prefix: 'CLUI',
    values: { numericalfactor: 1 },
  },
  taxcategory: {
    path: 'Basic Data | Tax Category', window: 'w_taxcategory_form',
    table: 'TaxCategory', dbKey: 'taxcategorycode', keyCol: 'code', nameCol: 'name', prefix: 'TXUI',
    values: { taxperc: 5 },
  },
  suppliercategory: {
    path: 'Basic Data | Supplier .......... | Supplier Category', window: 'w_suppliercategory_form',
    table: 'suppliercategory', dbKey: 'suppcatcode', keyCol: 'code', nameCol: 'name', prefix: 'SUUI', values: {},
  },
  customersector: {
    path: 'Basic Data | Customer .......... | Customer Sector', window: 'w_custsector_form',
    table: 'customersector', dbKey: 'customersectorcode', keyCol: 'code', nameCol: 'name', prefix: 'CSUI', values: {},
  },
  genericitemtype: {
    path: 'Basic Data | Item .......... | Generic Item Type', window: 'w_genericitemtype_form',
    table: 'genericitemtype', dbKey: 'genericitemtypecode', keyCol: 'code', nameCol: 'name', prefix: 'GIUI', values: {},
  },
  itemthickness: {
    path: 'Basic Data | Item .......... | Item Thickness', window: 'w_itemthickness_form',
    table: 'itemthickness', dbKey: 'itemthicknesscode', keyCol: 'code', nameCol: 'name', prefix: 'ITUI', values: {},
  },
  lockreason: {
    path: 'Basic Data | Item .......... | Lock Reason', window: 'w_lockreason',
    table: 'lockreason', dbKey: 'lockreasoncode', keyCol: 'code', nameCol: 'name', prefix: 'LKUI', values: {},
  },
  categorysegment: {
    path: 'Basic Data | Item .......... | Category Segment', window: 'w_categorysegment_form',
    table: 'categorysegment', dbKey: 'categorysegmentcode', keyCol: 'code', nameCol: 'name', prefix: 'CGUI', values: {},
  },
  manufacturertype: {
    path: 'Basic Data | Item .......... | Manufacturer Type', window: 'w_manufacturertype_form',
    table: 'manufacturertype', dbKey: 'manufacturertypecode', keyCol: 'code', nameCol: 'name', prefix: 'MTUI', values: {},
  },
  pctcodes: {
    path: 'Basic Data | Item .......... | PCT Codes', window: 'w_pctcodes_form',
    table: 'pct', dbKey: 'pctcode', keyCol: 'code', nameCol: 'name', dbNameCol: 'description', prefix: 'PTUI', values: {},
  },
  customercategory: {
    path: 'Basic Data | Customer .......... | Customer Category', window: 'w_custcategory_form',
    table: 'customercategory', dbKey: 'custcatcode', keyCol: 'code', nameCol: 'name', prefix: 'CCUI',
    values: { customersegmentcode: 1, allowincashsale: 'Y', allowincreditsale: 'Y' },
  },
  itemcategory: {
    path: 'Basic Data | Item .......... | Item Category', window: 'w_itemcategory_form',
    table: 'itemcategory', dbKey: 'icatcode', keyCol: 'code', nameCol: 'name', prefix: 'ICUI',
    values: { categorysegmentcode: 1, numericalfactor: 1, saleexpirydays: 1 },
  },
  genericitem: {
    path: 'Basic Data | Item .......... | Generic Item', window: 'w_genericitem_form',
    table: 'genericitem', dbKey: 'genericcode', keyCol: 'code', nameCol: 'name', prefix: 'GEUI',
    values: { genericitemtypecode: 1 },
  },
  salestaxschedule: {
    path: 'Basic Data | Item .......... | Sales Tax Schedule', window: 'w_salestaxschedule_form',
    table: 'salestaxschedule', dbKey: 'salestaxschedulecode', keyCol: 'code', nameCol: 'name', prefix: 'SSUI',
    values: { taxperc: 5, taxtype: 'S', applicable: 'Y' },
  },
  itemalert: {
    path: 'Basic Data | Item .......... | Item Alert', window: 'w_itemalert_form',
    table: 'itemalert', dbKey: 'itemalertcode', keyCol: 'code', nameCol: 'name', prefix: 'IAUI',
    values: { itemalerttypecode: 1, bgcolor: 0, alertdetail: 'CRUD ALERT' },
  },
  salepromotion: {
    path: 'Basic Data | Customer .......... | Sale Promotion', window: 'w_salepromotion_form',
    table: 'salepromotion', dbKey: 'salepromotioncode', keyCol: 'code', nameCol: 'name', prefix: 'SPUI',
    values: { customergroupcode: 1, defaultitemdiscperc: 0, weekdaycode: 1, startdate: '05/11/2026', enddate: '05/11/2027', active: 'Y' },
  },
}
const cfg = FORMS[FORM]
if (!cfg) throw new Error('unknown form ' + FORM)

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } })
const errors = []
page.on('pageerror', (e) => errors.push(String(e.message || e).slice(0, 300)))
await page.goto(`${BASE}/?app=1&autologin=${encodeURIComponent(USER)}:${encodeURIComponent(PASS)}`)
await page.waitForFunction(() => window.rt && window.rt.windowInstances.get('w_main'), null, { timeout: 180000, polling: 500 })
await page.waitForTimeout(1000)

const clean = (t) => String(t ?? '').replace(/&/g, '').replace(/<TAB>/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase()
async function dismiss(yes = false) {
  const out = []
  for (let i = 0; i < 40; i++) {
    const n = await page.evaluate(() => document.querySelectorAll('.msgbox').length)
    if (!n) break
    const msg = await page.evaluate((yes) => {
      const b = document.querySelector('.msgbox')
      const buttons = [...b.querySelectorAll('.btns button')]
      const pick = (yes && buttons.find((x) => /^yes$/i.test(x.textContent.trim()))) || buttons.find((x) => /^(ok|no|close)$/i.test(x.textContent.trim())) || buttons[0]
      const text = (b.querySelector('.txt')?.textContent || '').replace(/\s+/g, ' ').trim()
      pick?.click()
      return { text, chosen: pick?.textContent?.trim() }
    }, yes)
    out.push(msg)
    await page.waitForTimeout(130)
  }
  return out
}
async function clickMenu(path) {
  const r = await page.evaluate(async ({ path, wname }) => {
    const rt = window.rt
    const w = rt.windowInstances.get(wname)
    if (!w) return { ok: false, error: 'window missing' }
    const clean = (t) => String(t ?? '').replace(/&/g, '').replace(/\s+/g, ' ').trim().toLowerCase()
    let m = w.props.get('menuid')
    for (const part of path.split(' | ')) {
      const want = clean(part)
      const kids = m ? [...m.children.values()] : []
      const hit = kids.find((k) => clean(k.props.get('text')) === want) || kids.find((k) => clean(k.props.get('text')).startsWith(want))
      if (!hit) return { ok: false, error: 'menu item not found: ' + part }
      m = hit
      if (!hit.children.size) { await rt.fire(hit, 'selected'); void rt.fire(hit, 'clicked'); await new Promise((r) => setTimeout(r, 300)); return { ok: true } }
      await rt.fire(hit, 'selected')
    }
    return { ok: false, error: 'no leaf' }
  }, { path, wname: cfg.window })
  await page.waitForTimeout(500)
  return r
}
const valueFor = (col, stamp) => {
  const n = col.name.toLowerCase()
  if (cfg.values[n] !== undefined) return String(cfg.values[n])
  if (n === cfg.nameCol) return cfg.prefix + ' ' + stamp
  if (/alias|short/.test(n)) return 'Z' + stamp.slice(-5)
  if (/^char\(1\)/i.test(col.type)) return 'Y'
  if (col.type.startsWith('char') || col.type === 'string') return 'CRUD'
  if (col.type.startsWith('decimal') || col.type.includes('int') || col.type === 'long' || col.type === 'integer') return '1'
  if (col.type === 'date' || col.type === 'datetime') return '05/11/2026'
  return '1'
}

const stamp = String(Date.now()).slice(-6)
const name = cfg.prefix + ' ' + stamp
const result = { form: FORM, path: cfg.path, name, fields: [], messages: [], steps: {}, errors }
try {
  await page.evaluate((p) => window.__menu(p), cfg.path)
  await page.waitForTimeout(1800)
  result.messages.push(...await dismiss(true))
  const meta = await page.evaluate((w) => {
    const win = window.rt.windowInstances.get(w)
    if (!win) return { ok: false }
    const d = win.props.get('id_detail')
    if (!d) return { ok: false }
    const m = d.model
    return { ok: true, rows: m.rowCount(), objects: (m.def.objects || []).filter((o) => o.type === 'column' && Number(o.tabsequence) > 0 && o.protect !== '1').map((o) => ({ name: o.name, tab: Number(o.tabsequence) })).sort((a, b) => a.tab - b.tab), columns: m.def.table.columns.map((c) => ({ name: c.name, type: c.type })) }
  }, cfg.window)
  result.steps.open = meta
  if (!meta.ok) throw new Error('detail not found')
  // type every editable field through the DOM, in tab order
  for (const obj of meta.objects) {
    const col = meta.columns.find((c) => c.name === obj.name)
    if (!col) continue
    const value = valueFor(col, stamp)
    const cell = page.locator(`.pbwin[data-win="${cfg.window}"] .row[data-row="1"] .o[data-obj="${obj.name}"]`).first()
    if (!(await cell.count())) { result.fields.push({ name: obj.name, skipped: 'not rendered' }); continue }
    await cell.click({ force: true })
    await page.waitForTimeout(120)
    const editor = page.locator('.dw-edit').last()
    if (!(await editor.count())) { result.fields.push({ name: obj.name, skipped: 'no editor' }); continue }
    const tag = await editor.evaluate((e) => e.tagName).catch(() => '')
    if (tag === 'SELECT') {
      const options = await editor.locator('option').evaluateAll((os) => os.map((o) => o.value))
      if (!options.length) { result.fields.push({ name: obj.name, skipped: 'empty drop-down' }); await page.keyboard.press('Tab'); continue }
      const pick = options.includes(value) ? value : options.find((v) => v !== '')
      await editor.selectOption(pick)
    } else {
      await editor.fill(value)
    }
    await page.keyboard.press('Tab')
    await page.waitForTimeout(150)
    result.messages.push(...await dismiss(true))
    const got = await page.evaluate(({ w, col }) => {
      const win = window.rt.windowInstances.get(w)
      const m = win.props.get('id_detail').model
      return m.buf.primary[0]?.v[m.colIndex(col)]
    }, { w: cfg.window, col: obj.name })
    result.fields.push({ name: obj.name, value: String(got ?? '') })
  }
  // close any in-cell editor without changing its text, then Save
  await page.keyboard.press('Escape').catch(() => {})
  await page.waitForTimeout(200)
  result.steps.save = await clickMenu('File | Save')
  await page.waitForTimeout(1600)
  result.messages.push(...await dismiss(true))
  const added = query(`select ${cfg.dbKey}, ${cfg.dbNameCol || cfg.nameCol} from dbo.${cfg.table} where ${cfg.dbNameCol || cfg.nameCol} = '${name.replace(/'/g, "''")}'`)
  result.steps.add = { db: added, ok: added.length === 1 }
  result.steps.modelAfterAdd = await page.evaluate((w) => {
    const m = window.rt.windowInstances.get(w).props.get('id_detail').model
    return m.buf.primary.map((r) => ({ st: r.st, code: r.v[m.colIndex('code')], name: r.v[m.colIndex('name')] }))
  }, cfg.window)
  result.steps.recentAfterAdd = await page.evaluate(() => window.rt.recentNames(15))
  if (added.length !== 1) throw new Error('add did not reach the database')

  // open the saved record from File | List, the way the original edits an existing row
  async function openFromList(prefix) {
    await page.evaluate((w) => {
      const win = window.rt.windowInstances.get(w)
      win?.props.get('id_list')?.model?.reset()
    }, cfg.window)
    await clickMenu('File | List')
    await page.waitForTimeout(1400)
    result.messages.push(...await dismiss(true))
    const found = await page.evaluate(({ w, prefix }) => {
      const win = window.rt.windowInstances.get(w)
      const list = win.props.get('id_list')
      const lm = list.model
      const hit = [...lm.buf.primary.entries()].find(([, r]) => String(r.v[lm.colIndex('name')]).startsWith(prefix))
      if (!hit) return null
      win.props.set('il_selectedrow', hit[0] + 1)
      win.props.set('id_dwcontrol', list)
      const tab = win.children.get('tab_retrieve') || window.__crud.find(win, 'name', 'tab_retrieve')
      if (tab) tab.pbSet('selectedtab', 1)
      else void window.rt.fire(win, 'ue_detail')
      return { row: hit[0] + 1, code: hit[1].v[lm.colIndex('code')] }
    }, { w: cfg.window, prefix })
    await page.waitForTimeout(1400)
    result.messages.push(...await dismiss(true))
    return found
  }

  // edit the saved record: list -> select -> detail -> change name -> save
  const edited = name + ' EDITED'
  const opened = await openFromList(name)
  result.steps.editOpen = opened
  if (!opened) throw new Error('added row not found in the list')
  const nameCell = page.locator(`.pbwin[data-win="${cfg.window}"] .row[data-row="1"] .o[data-obj="${cfg.nameCol}"]`).first()
  await nameCell.click({ force: true })
  await page.waitForTimeout(120)
  const ne = page.locator('.dw-edit').last()
  if (await ne.count()) { await ne.fill(edited); await page.keyboard.press('Tab') }
  await page.waitForTimeout(200)
  await page.keyboard.press('Escape').catch(() => {})
  await clickMenu('File | Save')
  await page.waitForTimeout(1600)
  result.messages.push(...await dismiss(true))
  const editedDb = query(`select ${cfg.dbKey}, ${cfg.dbNameCol || cfg.nameCol} from dbo.${cfg.table} where ${cfg.dbNameCol || cfg.nameCol} = '${edited.replace(/'/g, "''")}'`)
  const duplicate = query(`select count(*) from dbo.${cfg.table} where ${cfg.dbNameCol || cfg.nameCol} like '${cfg.prefix} %'`)
  result.steps.edit = { db: editedDb, rowsForPrefix: duplicate, ok: editedDb.length === 1 && duplicate[0]?.[0] === '1' }

  // delete the edited record: list -> select -> detail -> File | Delete -> Yes
  const opened2 = await openFromList(edited)
  result.steps.deleteOpen = opened2
  if (!opened2) throw new Error('edited row not found in the list')
  await page.evaluate(async (w) => {
    const win = window.rt.windowInstances.get(w)
    void window.rt.fire(win, 'ue_delete')
    await new Promise((r) => setTimeout(r, 900))
  }, cfg.window)
  result.messages.push(...await dismiss(true))
  await page.waitForTimeout(1200)
  result.messages.push(...await dismiss(true))
  const gone = query(`select ${cfg.dbKey}, ${cfg.dbNameCol || cfg.nameCol} from dbo.${cfg.table} where ${cfg.dbNameCol || cfg.nameCol} like '${cfg.prefix} %'`)
  result.steps.delete = { db: gone, ok: gone.length === 0 }
  result.ok = added.length === 1 && editedDb.length === 1 && gone.length === 0 && duplicate[0]?.[0] === '1'
} catch (e) {
  result.ok = false
  result.errors.push(String(e.message || e))
  result.messages.push(...await dismiss(true).catch(() => []))
}
writeFileSync(join(OUT, `crud-${FORM}.json`), JSON.stringify(result, null, 1))
console.log(JSON.stringify(result, null, 1))
await browser.close()

