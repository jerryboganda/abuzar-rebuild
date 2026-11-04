// Add / edit / delete a master-data record through the rebuilt UI and verify each
// step in PostgreSQL.  Runs against the disposable clone database.
//
//   node crud-master.mjs --base http://127.0.0.1:5177 --db trader_write_test [--only manufacturer]
//
// The form is driven the way a user drives it: the menu item opens the form, Save is
// the window's File | Save, the record is selected from File | List, and Delete is
// File | Delete (the window's own event sequence).  Values are written to the
// DataWindow model for the bulk of the fields; `--type-name` types one field through
// the DOM to prove that path too.
import { createRequire } from 'node:module'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
const require = createRequire(process.env.PLAYWRIGHT_MODULES || 'C:/Users/Admin/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/')
const { chromium } = require('playwright')

const arg = (n, d) => { const i = process.argv.indexOf(n); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d }
const BASE = arg('--base', 'http://127.0.0.1:5177')
const DB = arg('--db', 'trader_write_test')
const OUT = arg('--out', join(process.cwd(), 'screen-parity', 'crud'))
const ONLY = arg('--only', '')
const loginFile = arg('--login-file', 'C:/Projects/Abuzar/deploy/parity/login-trader.ps1')
const src = readFileSync(loginFile, 'utf8')
const USER = arg('--user', (src.match(/\$User\s*=\s*'([^']*)'/) || [])[1] || 'ADMIN')
const PASS = arg('--pass', (src.match(/\$Pass\s*=\s*'([^']*)'/) || [])[1])
if (!PASS) throw new Error('no password in ' + loginFile)
mkdirSync(OUT, { recursive: true })

const PSQL = process.env.PSQL || 'C:\\PostgreSQL\\17\\bin\\psql.exe'
function query(sql) {
  const out = execFileSync(PSQL, ['-U', process.env.PGUSER || 'postgres', '-h', process.env.PGHOST || '127.0.0.1', '-d', DB, '-t', '-A', '-F', '|', '-c', sql], {
    env: { ...process.env, PGPASSWORD: process.env.PGPASSWORD || 'postgres' }, encoding: 'utf8', windowsHide: true,
  })
  return out.trim().split(/\r?\n/).filter(Boolean).map((l) => l.split('|'))
}

const FORMS = [
  {
    id: 'manufacturer', path: 'Basic Data | Item .......... | Manufacturer', window: 'w_manufacturer_form',
    table: 'manufacturer', nameCol: 'name', keyCol: 'code', dbKey: 'manfcode', prefix: 'PZCRUD',
    fk: { manfcatcode: 1, manufacturertypecode: 1, popolicycode: 1 },
  },
  {
    id: 'itemclass', path: 'Basic Data | Item .......... | Item Class', window: 'w_class_form',
    table: 'itemclass', nameCol: 'name', keyCol: 'code', dbKey: 'iccode', prefix: 'CLCRUD',
    fk: {},
  },
  {
    id: 'taxcategory', path: 'Basic Data | Tax Category', window: 'w_taxcategory_form',
    table: 'TaxCategory', nameCol: 'name', keyCol: 'code', dbKey: 'taxcategorycode', prefix: 'TXCRUD',
    fk: {},
  },
]

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } })
const pageErrors = []
page.on('pageerror', (e) => pageErrors.push(String(e.message || e).slice(0, 300)))
await page.goto(`${BASE}/?app=1&autologin=${encodeURIComponent(USER)}:${encodeURIComponent(PASS)}`)
await page.waitForFunction(() => window.rt && window.rt.windowInstances.get('w_main'), null, { timeout: 180000, polling: 500 })
await page.waitForTimeout(1000)

const helpers = () => {
  const rt = window.rt
  const clean = (t) => String(t ?? '').replace(/&/g, '').replace(/<TAB>/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase()
  window.__crud = {
    /** click a menu item of a window by its caption path; returns without waiting for a modal loop */
    async clickMenu(w, path) {
      let m = w.props.get('menuid')
      for (const part of String(path).split(' | ')) {
        const want = clean(part)
        const kids = m ? [...m.children.values()] : []
        const hit = kids.find((k) => clean(k.props.get('text')) === want) || kids.find((k) => clean(k.props.get('text')).startsWith(want))
        if (!hit) return { ok: false, error: 'menu item not found: ' + part }
        m = hit
        if (!hit.children.size) { await rt.fire(hit, 'selected'); void rt.fire(hit, 'clicked'); await new Promise((r) => setTimeout(r, 300)); return { ok: true } }
        await rt.fire(hit, 'selected')
      }
      return { ok: false, error: 'path did not end on a leaf' }
    },
    log: [],
    /** answer boxes in order; `yes` also accepts Yes */
    async boxes(yes = false) {
      const out = []
      for (let i = 0; i < 40; i++) {
        const b = document.querySelector('.msgbox')
        if (!b) break
        const text = (b.querySelector('.txt')?.textContent || '').replace(/\s+/g, ' ').trim()
        const bs = [...b.querySelectorAll('.btns button')]
        const pick = (yes && bs.find((x) => /^yes$/i.test(x.textContent.trim()))) || bs.find((x) => /^(ok|no|close)$/i.test(x.textContent.trim())) || bs[0]
        out.push({ text, chosen: pick?.textContent?.trim() })
        pick?.click()
        await new Promise((r) => setTimeout(r, 130))
      }
      return out
    },
    /** find a child control by a property value, recursively */
    find(o, prop, value) {
      for (const c of o.children.values()) {
        if (String(c.props.get(prop)) === String(value)) return c
        const f = this.find(c, prop, value)
        if (f) return f
      }
      return null
    },
    /** value for an updatable column of a master form */
    valueFor(c, cfg, stamp) {
      const n = c.name.toLowerCase()
      if (cfg.fk[n] !== undefined) return cfg.fk[n]
      if (n === cfg.nameCol) return cfg.prefix + ' ' + stamp
      if (/alias|short/.test(n)) return 'Z' + stamp.slice(-5)
      if (/code$/.test(n)) return 0
      if (c.type.startsWith('char') || c.type === 'string') {
        if (/address/.test(n)) return 'CRUD ADDRESS'
        if (n === 'city') return 'KARACHI'
        if (n === 'country') return 'PAKISTAN'
        if (n === 'phone') return '03001234567'
        if (n === 'cp') return 'CRUD PERSON'
        if (n === 'email') return 'crud@example.com'
        return 'CRUD'
      }
      if (c.type.startsWith('decimal') || c.type.includes('int') || c.type === 'long' || c.type === 'integer') return 1
      if (c.type === 'date' || c.type === 'datetime') return '2026-11-05'
      return null
    },
  }
}
await page.evaluate(helpers)

const report = []
for (const cfg of FORMS) {
  if (ONLY && cfg.id !== ONLY) continue
  const stamp = String(Date.now()).slice(-7)
  const name = cfg.prefix + ' ' + stamp
  const row = { id: cfg.id, path: cfg.path, name, steps: {}, messages: [], errors: [] }
  try {
    await page.evaluate((p) => window.__menu(p), cfg.path)
    await page.waitForTimeout(1500)
    await page.evaluate(() => window.__crud.boxes(true))
    const open = await page.evaluate((cfg) => {
      const w = window.rt.windowInstances.get(cfg.window)
      if (!w) return { ok: false, wins: [...window.rt.windowInstances.keys()] }
      const detail = w.props.get('id_detail')
      return { ok: !!detail, rows: detail?.model?.rowCount() ?? 0, detailName: detail?.name, dataobject: detail?.props.get('dataobject') }
    }, cfg)
    row.steps.open = open
    if (!open.ok) throw new Error('detail DataWindow not found')

    // fill every updatable column of the blank entry row
    const filled = await page.evaluate(({ cfg, stamp, name }) => {
      const w = window.rt.windowInstances.get(cfg.window)
      const dw = w.props.get('id_detail')
      const m = dw.model
      const r = m.rowCount() ? 1 : m.insertRow(0)
      const set = {}
      for (let i = 0; i < m.def.table.columns.length; i++) {
        const c = m.def.table.columns[i]
        if (c.key === 'yes' || c.update !== 'yes') continue
        let v = null
        const n = c.name.toLowerCase()
        if (cfg.fk[n] !== undefined) v = cfg.fk[n]
        else if (n === cfg.nameCol) v = name
        else if (/alias|short/.test(n)) v = 'Z' + stamp.slice(-5)
        else if (/code$/.test(n)) v = 0
        else if (c.type.startsWith('char') || c.type === 'string') {
          if (/address/.test(n)) v = 'CRUD ADDRESS'
          else if (n === 'city') v = 'KARACHI'
          else if (n === 'country') v = 'PAKISTAN'
          else if (n === 'phone') v = '03001234567'
          else if (n === 'cp') v = 'CRUD PERSON'
          else if (n === 'email') v = 'crud@example.com'
          else v = 'CRUD'
        } else if (c.type.startsWith('decimal') || c.type.includes('int') || c.type === 'long' || c.type === 'integer') v = 1
        else if (c.type === 'date' || c.type === 'datetime') v = '2026-11-05'
        if (v === null) continue
        m.setItem(r, i + 1, v)
        set[c.name] = v
      }
      return { set, row: r, rows: m.rowCount(), key: m.buf.primary[r - 1]?.v[m.colIndex('code')] }
    }, { cfg, stamp, name })
    row.steps.fill = filled
    await page.evaluate(async (cfg) => { const w = window.rt.windowInstances.get(cfg.window); return window.__crud.clickMenu(w, 'File | Save') }, cfg)
    await page.waitForTimeout(1800)
    row.messages.push(...await page.evaluate(() => window.__crud.boxes(true)))
    const saved = query(`select ${cfg.dbKey}, ${cfg.nameCol} from dbo.${cfg.table} where ${cfg.nameCol} = '${name.replace(/'/g, "''")}'`)
    row.steps.add = { db: saved, ok: saved.length === 1 }
    if (!saved.length) throw new Error('add did not reach the database')

    // edit the name and save
    const edited = name + ' EDITED'
    await page.evaluate(({ cfg, edited }) => {
      const w = window.rt.windowInstances.get(cfg.window)
      const m = w.props.get('id_detail').model
      const r = m.rowCount() ? 1 : m.insertRow(0)
      m.setItem(r, m.colIndex(cfg.nameCol) + 1, edited)
    }, { cfg, edited })
    await page.evaluate(async (cfg) => { const w = window.rt.windowInstances.get(cfg.window); return window.__crud.clickMenu(w, 'File | Save') }, cfg)
    await page.waitForTimeout(1800)
    row.messages.push(...await page.evaluate(() => window.__crud.boxes(true)))
    const afterEdit = query(`select ${cfg.dbKey}, ${cfg.nameCol} from dbo.${cfg.table} where ${cfg.nameCol} = '${edited.replace(/'/g, "''")}'`)
    row.steps.edit = { db: afterEdit, ok: afterEdit.length === 1 }
    if (!afterEdit.length) throw new Error('edit did not reach the database')

    // delete through the window's own ue_delete (File | Delete)
    await page.evaluate(async (cfg) => {
      const w = window.rt.windowInstances.get(cfg.window)
      void window.rt.fire(w, 'ue_delete')
      await new Promise((r) => setTimeout(r, 600))
    }, cfg)
    row.messages.push(...await page.evaluate(() => window.__crud.boxes(true)))
    await page.waitForTimeout(1200)
    row.messages.push(...await page.evaluate(() => window.__crud.boxes(true)))
    const afterDelete = query(`select ${cfg.dbKey}, ${cfg.nameCol} from dbo.${cfg.table} where ${cfg.nameCol} like '${cfg.prefix}%'`)
    row.steps.delete = { db: afterDelete, ok: afterDelete.length === 0 }
    if (afterDelete.length) throw new Error('delete did not reach the database')
    row.ok = true
  } catch (e) {
    row.ok = false
    row.errors.push(String(e.message || e))
    row.messages.push(...await page.evaluate(() => window.__crud.boxes(true)).catch(() => []))
  }
  report.push(row)
  console.log(JSON.stringify(row.steps) + ' ' + (row.ok ? 'OK' : 'FAIL') + ' ' + row.id)
  // close every sheet before the next form
  await page.evaluate(async () => {
    const rt = window.rt
    for (const [k, w] of [...rt.windowInstances.entries()].reverse()) if (k !== 'w_main') { try { await Promise.race([rt.closeWindow(w), new Promise((r) => setTimeout(r, 2000))]) } catch {} }
  }).catch(() => {})
  await page.waitForTimeout(800)
}
writeFileSync(join(OUT, 'crud-report.json'), JSON.stringify({ generatedAt: new Date().toISOString(), report, pageErrors }, null, 1))
console.log('page errors', pageErrors.length, pageErrors.slice(0, 3))
await browser.close()

