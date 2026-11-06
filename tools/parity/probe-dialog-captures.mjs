// Same-role recapture of the 17 original `*_dlg1.png` windows.
//
// The original capture tool saved every non-frame top-level window of the
// screen as `NNN_name_dlg1.png` (see tools/parity/capture-old.ps1).  The
// rebuild's screen crawl only saved full-screen shots, so compare-images.ps1
// could not pair those dialog crops by role.  This probe opens each parent
// command in a fresh session and screenshots the same window element:
//   deploy/parity/screen-parity/new-dlg-refresh/<same old file name>
//
// Targets that are original-side SQL/schema errors (Waseela "Invalid column
// name 'Name'", Preferences/Job Schedule/Group Wise Supplier Category) have no
// rebuild equivalent: the rebuild schema has the missing column and the screen
// opens normally.  They are recorded as `original_error_no_equivalent` and are
// not captured, so they stay visibly unpaired instead of being compared to a
// different window.
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
const require = createRequire(process.env.PLAYWRIGHT_MODULES || 'C:/Users/Admin/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/')
const { chromium } = require('playwright')
const OUT = process.env.OUT || 'C:/Projects/Abuzar/deploy/parity/screen-parity/new-dlg-refresh'
mkdirSync(OUT, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const PSQL = 'C:\\PostgreSQL\\17\\bin\\psql.exe'
const DB = process.env.PARITY_DB || 'trader_write_test'
const ONLY = process.env.ONLY ? new RegExp(process.env.ONLY) : null
const q = (sql) => execFileSync(PSQL, ['-U', 'postgres', '-h', '127.0.0.1', '-d', DB, '-t', '-A', '-F', '|', '-c', sql], { env: { ...process.env, PGPASSWORD: 'postgres' }, encoding: 'utf8', windowsHide: true }).trim()
const rows = (sql) => q(sql).split(/\r?\n/).filter(Boolean).map((l) => l.split('|'))

const TARGETS = [
  { file: '037_Maintenance_Change_Password_dlg1.png', path: 'Maintenance | Change Password', cls: 'w_changepassword', title: 'Change User Password Form' },
  { file: '038_Maintenance_Preferences_dlg1.png', path: 'Maintenance | Preferences', title: 'Waseela', originalError: 'Invalid column name \'Name\'' },
  { file: '039_Maintenance_Change_Items_Price_dlg1.png', path: 'Maintenance | Change Items Price', cls: 'w_filter_changeitem_price', title: 'Change Price Filter Window' },
  { file: '044_Maintenance_Change_Item_Discount_dlg1.png', path: 'Maintenance | Change Item Discount', cls: 'w_select_changediscmethod', title: 'Select Format' },
  { file: '045_Maintenance_Modify_Sale_Invoices_dlg1.png', path: 'Maintenance | Modify Sale Invoices', cls: 'w_selectformat_period_invrange', title: 'Select Format' },
  { file: '046_Maintenance_Modify_Last_Transaction_Date_dlg1.png', path: 'Maintenance | Modify Last Transaction Date', cls: 'w_set_lasttransdate', title: 'Last Transaction Date Modification' },
  { file: '047_Maintenance_Godown_Preferences_Group_Wise_Godown_Setting_dlg1.png', path: 'Maintenance | Godown Preferences | Group Wise Godown Setting', cls: 'w_arg_group', title: 'Specify Retrieval Arguements' },
  { file: '048_Maintenance_Interface_Setting_dlg1.png', path: 'Maintenance | Interface Setting', cls: 'w_interfacesetting', title: 'Interface Settings' },
  { file: '049_Maintenance_Update_Item_Basic_Data_dlg1.png', path: 'Maintenance | Update Item Basic Data', cls: 'w_select_manf_cat_class_pack_saleorder', title: 'Select Column Criteria' },
  { file: '051_Maintenance_Change_Item_Reorder_Qty_dlg1.png', path: 'Maintenance | Change Item Reorder Qty', cls: 'w_select_manf_cat_class_packing_combined', title: 'Select Column Criteria' },
  { file: '052_Mana_ge_Groups_new_dlg1.png', path: 'Manage | Groups', cls: 'w_groups_form', title: 'Group and Rights Information', groupsForm: true },
  { file: '054_Mana_ge_Group_Wise_Header_Setting_dlg1.png', path: 'Manage | Group Wise Header Setting', cls: 'w_arg_group', title: 'Specify Retrieval Arguements' },
  { file: '057_Mana_ge_Session_Monitor_TAB_Ctrl_Alt_M_dlg1.png', path: 'Manage | Session Monitor Ctrl+Alt+M', cls: 'w_salesmanpassword', title: 'User Password' },
  { file: '059_Mana_ge_Cashier_Management_Cashier_Activity_Window_dlg1.png', path: 'Manage | Cashier Management | Cashier Activity Window', msgTitle: 'Cashier Job Status', title: 'Cashier Job Status' },
  { file: '060_Mana_ge_Job_Schedule_dlg1.png', path: 'Manage | Job Schedule', title: 'Waseela', originalError: 'Invalid column name \'Name\'' },
  { file: '061_Mana_ge_Group_Wise_Supplier_Category_dlg1.png', path: 'Manage | Group Wise Supplier Category', title: 'Waseela', originalError: 'Invalid column name \'Name\'' },
  { file: '062_Help_About_dlg1.png', path: 'Help | About', cls: 'w_about', title: 'About' },
]

const browser = await chromium.launch()
const results = []
try {
  for (const t of TARGETS) {
    if (ONLY && !ONLY.test(t.file)) continue
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } })
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e.message || e).slice(0, 300)))
    const r = { file: t.file, path: t.path, title: t.title, errors }
    // The original 059 capture was taken when ADMIN had no active cashier job;
    // the clone now carries a probe-created job.  Match the capture state, then
    // restore the job flags.
    let cashierJobCodes = []
    try {
      if (/^059_/.test(t.file)) {
        cashierJobCodes = rows("select cashierjobcode from dbo.cashierjob where active='Y'").map((x) => x[0])
        if (cashierJobCodes.length) q(`update dbo.cashierjob set active='N' where cashierjobcode in (${cashierJobCodes.map(Number).join(',')})`)
      }
    } catch (e) { r.preSqlError = String(e.message || e).slice(0, 400) }
    try {
      await page.goto('http://127.0.0.1:5177/?app=1&autologin=ADMIN:password9080', { waitUntil: 'load', timeout: 60000 })
      await page.waitForFunction(() => window.rt && window.rt.windowInstances.get('w_main') && typeof window.__menu === 'function', null, { timeout: 90000, polling: 300 })
      // __menu awaits the clicked handler; a modal sheet keeps that promise open,
      // so start it without awaiting (the same way the screen crawl opens paths).
      r.menu = await page.evaluate((path) => {
        try {
          void window.__menu(path)
          return { started: true }
        } catch (e) {
          return { started: false, error: String(e.message || e).slice(0, 300) }
        }
      }, t.path)
      if (t.groupsForm) {
        await page.waitForFunction(() => window.rt.windowInstances.get('w_groups'), null, { timeout: 30000, polling: 300 })
        await sleep(1200)
        await page.evaluate(async () => {
          const rt = window.rt
          const w = rt.windowInstances.get('w_groups')
          void w.pbCall('wf_openmywindow', [2], rt).catch(() => {})
        })
      }
      // wait for the target window / message box
      let state = null
      for (let i = 0; i < 50; i++) {
        state = await page.evaluate(({ cls, msgTitle }) => {
          const rt = window.rt
          const visible = [...document.querySelectorAll('.pbwin:not(.hidden)')]
          if (msgTitle) {
            const boxes = [...document.querySelectorAll('.msgbox')]
            const hit = boxes.find((b) => (b.querySelector('.ttl')?.textContent || '').trim() === msgTitle)
            if (hit) {
              document.querySelectorAll('[data-parity-capture]').forEach((e) => e.removeAttribute('data-parity-capture'))
              hit.setAttribute('data-parity-capture', '1')
              const rr = hit.getBoundingClientRect()
              return { kind: 'msgbox', title: (hit.querySelector('.ttl')?.textContent || '').trim(), text: (hit.querySelector('.txt')?.textContent || '').replace(/\s+/g, ' ').trim(), rect: [Math.round(rr.x), Math.round(rr.y), Math.round(rr.width), Math.round(rr.height)] }
            }
            return { kind: 'none', boxes: boxes.map((b) => (b.querySelector('.ttl')?.textContent || '').trim()) }
          }
          const w = rt.windowInstances.get(cls)
          const el = w ? rt.ui.views.get(w)?.el : null
          if (!w || !el || !el.isConnected || el.classList.contains('hidden')) return { kind: 'none', wins: [...rt.windowInstances.keys()] }
          document.querySelectorAll('[data-parity-capture]').forEach((e) => e.removeAttribute('data-parity-capture'))
          el.setAttribute('data-parity-capture', '1')
          const rr = el.getBoundingClientRect()
          return {
            kind: 'window',
            cls,
            title: String(w.props.get('title') ?? ''),
            modal: el.classList.contains('modal'),
            sheet: el.classList.contains('sheet'),
            rect: [Math.round(rr.x), Math.round(rr.y), Math.round(rr.width), Math.round(rr.height)],
            wins: [...rt.windowInstances.keys()],
            visibleWins: visible.map((x) => x.className),
          }
        }, { cls: t.cls, msgTitle: t.msgTitle }).catch((e) => ({ kind: 'error', error: String(e.message || e).slice(0, 300) }))
        if (state.kind === 'window' || state.kind === 'msgbox') break
        await sleep(500)
      }
      r.state = state
      if (state && (state.kind === 'window' || state.kind === 'msgbox')) {
        await sleep(1500)
        // re-measure after layout settles
        const rect = await page.evaluate(() => {
          const el = document.querySelector('[data-parity-capture="1"]')
          if (!el) return null
          const rr = el.getBoundingClientRect()
          return { x: Math.round(rr.x), y: Math.round(rr.y), width: Math.round(rr.width), height: Math.round(rr.height) }
        })
        r.rect = rect
        if (rect && rect.width > 20 && rect.height > 20) {
          await page.locator('[data-parity-capture="1"]').screenshot({ path: `${OUT}/${t.file}`, timeout: 15000 })
          r.captured = true
        }
      } else if (t.originalError) {
        // the rebuild schema has the column the original query is missing
        r.originalErrorNoEquivalent = true
        r.note = 'original Waseela SQL error (' + t.originalError + '); rebuild screen opens normally'
      } else {
        r.captured = false
      }
    } catch (e) {
      r.fatal = String(e.stack || e).slice(0, 1500)
    } finally {
      if (cashierJobCodes.length) {
        try { q(`update dbo.cashierjob set active='Y' where cashierjobcode in (${cashierJobCodes.map(Number).join(',')})`) } catch (e) { r.postSqlError = String(e.message || e).slice(0, 400) }
      }
      results.push(r)
      console.log(t.file, JSON.stringify({ state: r.state, captured: !!r.captured, note: r.note, fatal: r.fatal, preSqlError: r.preSqlError, postSqlError: r.postSqlError, errors: r.errors }))
      await page.close().catch(() => {})
    }
  }
} finally {
  let manifest = results
  if (ONLY) {
    try {
      const prev = JSON.parse(readFileSync(`${OUT}/captures.json`, 'utf8'))
      manifest = prev.map((p) => results.find((r) => r.file === p.file) || p)
      for (const r of results) if (!manifest.some((p) => p.file === r.file)) manifest.push(r)
    } catch { /* first run on an empty directory */ }
  }
  writeFileSync(`${OUT}/captures.json`, JSON.stringify(manifest, null, 1))
  await browser.close().catch(() => {})
}
