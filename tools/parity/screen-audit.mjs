// Exhaustive screen audit: opens every menu path, walks every tab page, and
// types into every editable DataWindow cell, recording the value the model
// received, every message box and every page error.  Nothing is saved: the
// browser is closed after each screen, so no transaction can be committed.
//
//   node screen-audit.mjs --base http://127.0.0.1:5177 --items items.json --out dir
//                         [--only TEXT] [--limit N] [--max-fields N]
import { createRequire } from 'node:module'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const require = createRequire(process.env.PLAYWRIGHT_MODULES || 'C:/Users/Admin/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/')
const { chromium } = require('playwright')
const arg = (n, d) => { const i = process.argv.indexOf(n); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d }
const BASE = arg('--base', 'http://127.0.0.1:5177')
const ITEMS = arg('--items')
const OUT = arg('--out', join(process.cwd(), 'screen-audit'))
const ONLY = arg('--only', '')
const LIMIT = Number(arg('--limit', '0'))
const MAX_FIELDS = Number(arg('--max-fields', '0'))
const SETTLE = Number(arg('--settle', '1200'))
const loginFile = arg('--login-file', 'C:/Projects/Abuzar/deploy/parity/login-trader.ps1')
const src = readFileSync(loginFile, 'utf8')
const USER = arg('--user', (src.match(/\$User\s*=\s*'([^']*)'/) || [])[1] || 'ADMIN')
const PASS = arg('--pass', (src.match(/\$Pass\s*=\s*'([^']*)'/) || [])[1])
if (!PASS || !ITEMS) throw new Error('need --items and a local login file')
mkdirSync(OUT, { recursive: true })
const paths = JSON.parse(readFileSync(ITEMS, 'utf8')).filter((p) => !ONLY || p.toLowerCase().includes(ONLY.toLowerCase())).slice(0, LIMIT || undefined)

const slug = (s) => String(s).replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ').replace(/\s+/g, '_').replace(/_+/g, '_').slice(0, 100)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const browser = await chromium.launch()

async function dismiss(page) {
  const out = []
  for (let i = 0; i < 30; i++) {
    const n = await page.evaluate(() => document.querySelectorAll('.msgbox').length)
    if (!n) break
    const m = await page.evaluate(() => {
      const b = document.querySelector('.msgbox')
      if (!b) return null
      const bs = [...b.querySelectorAll('.btns button')]
      const pick = bs.find((x) => /^(no|cancel|close|abort|ignore)$/i.test(x.textContent.trim())) || bs.find((x) => /^ok$/i.test(x.textContent.trim())) || bs[0]
      const text = (b.querySelector('.txt')?.textContent || '').replace(/\s+/g, ' ').trim()
      pick?.click()
      return { text, chosen: pick?.textContent?.trim() }
    })
    if (!m) break
    out.push(m)
    await sleep(120)
  }
  return out
}

function valueFor(col) {
  const t = String(col.type || '').toLowerCase()
  const cm = t.match(/^char\((\d+)\)$/)
  if (cm) return Number(cm[1]) >= 6 ? 'PARITY' : 'Y'
  if (t === 'char' || t === 'string') return 'PARITY'
  if (t === 'date') return '05/11/2026'
  if (t === 'datetime') return '05/11/2026 10:00:00'
  if (t === 'time') return '10:00:00'
  // DataWindow column types are spelled with a width, e.g. decimal(4), char(1)
  if (/^(decimal|numeric|real|double|long|ulong|integer|int|uint|smallint|boolean|number)/.test(t)) return '1'
  return 'PARITY'
}

async function auditPath(path) {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e.message || e).slice(0, 400)))
  const result = { path, opened: false, windows: [], tabs: [], fields: [], buttons: [], messages: [], errors }
  try {
    await page.goto(`${BASE}/?app=1&autologin=${encodeURIComponent(USER)}:${encodeURIComponent(PASS)}`, { waitUntil: 'load', timeout: 60000 })
    await page.waitForFunction(() => window.rt && window.rt.windowInstances.get('w_main') && typeof window.__menu === 'function', null, { timeout: 180000, polling: 300 })
    // Do not await the menu promise: a screen that opens a modal argument or
    // password window keeps the click handler pending until the user answers.
    // Fire it, wait for the window to appear, then audit what is on screen.
    await page.evaluate((p) => { void window.__menu(p) }, path)
    result.opened = true
    await page.waitForTimeout(SETTLE)
    result.messages.push(...await dismiss(page))

    const meta = await page.evaluate(() => {
      const rt = window.rt
      const skip = new Set(['w_main', 'w_dberror', 'w_findwindow', 'w_calculator', 'w_calendar'])
      const out = []
      const visibleChain = (o) => {
        for (let x = o; x; x = x.parent) if (x.props && x.props.get('visible') === false) return false
        return true
      }
      const walk = (o, depth, acc) => {
        for (const c of o.children.values()) {
          if (c.native === 'tab') {
            const pages = [...c.children.values()].filter((p) => p.native !== 'datawindow')
            acc.tabs.push({
              name: c.name,
              selected: Number(c.props.get('selectedtab') ?? 1),
              pages: pages.map((p) => p.name),
              depth,
            })
          }
          if (c.native === 'datawindow' && c.model) {
            const m = c.model
            const tabpage = (() => {
              let p = c.parent
              while (p) {
                if (p.parent && p.parent.native === 'tab') return p.name
                p = p.parent
              }
              return ''
            })()
            acc.dws.push({
              name: c.name,
              dataobject: c.props.get('dataobject'),
              rows: m.rowCount(),
              tabpage,
              visible: visibleChain(c),
              columns: m.def.table.columns.map((x) => ({ name: x.name, type: x.type })),
              objects: (m.def.objects || []).filter((x) => x.type === 'column' && Number(x.tabsequence) > 0 && x.protect !== '1').map((x) => x.name),
            })
          }
          if (c.children.size) walk(c, depth + 1, acc)
        }
      }
      for (const [key, w] of rt.windowInstances) {
        if (skip.has(key) || !visibleChain(w)) continue
        const acc = { key, class: w.className, title: w.props.get('title'), tabs: [], dws: [], controls: [] }
        walk(w, 0, acc)
        const collect = (o) => {
          for (const c of o.children.values()) {
            if (c.native === 'button' || c.native === 'checkbox' || c.native === 'radiobutton') {
              acc.controls.push({ name: c.name, native: c.native, text: c.props.get('text'), visible: visibleChain(c), enabled: c.props.get('enabled') !== false })
            }
            if (c.children.size) collect(c)
          }
        }
        collect(w)
        out.push(acc)
      }
      return out
    })
    result.windows = meta.map((w) => ({ key: w.key, class: w.class, title: w.title, tabs: w.tabs.length, dws: w.dws.length, controls: w.controls.length }))

    let fieldCount = 0
    for (const w of meta) {
      result.tabs.push(...w.tabs)
      result.buttons.push(...w.controls.map((c) => ({ win: w.key, ...c })))
      const tabCount = Math.max(1, w.tabs[0]?.pages.length ?? 1)
      for (let tab = 1; tab <= tabCount; tab++) {
        if (w.tabs[0]) {
          await page.evaluate(({ win, tab }) => {
            const rt = window.rt
            const w = rt.windowInstances.get(win)
            let found = null
            const find = (o) => { for (const c of o.children.values()) { if (c.native === 'tab' && !found) found = c; else if (c.children.size) find(c) } }
            find(w)
            if (found) found.pbSet('selectedtab', tab)
          }, { win: w.key, tab })
          await page.waitForTimeout(400)
          result.messages.push(...await dismiss(page))
        }
        const dws = w.dws.filter((d) => {
          if (!d.visible) return false
          if (!w.tabs.length) return true
          const page = w.tabs[0].pages[tab - 1] || ''
          return !d.tabpage || d.tabpage === page
        })
        for (const dw of dws) {
          if (!dw.rows) continue
          for (const objName of dw.objects) {
            if (MAX_FIELDS && fieldCount >= MAX_FIELDS) break
            const col = dw.columns.find((c) => c.name === objName)
            if (!col) continue
            const value = valueFor(col)
            const rec = { win: w.key, dw: dw.name, tab, field: objName, type: col.type, value, got: null }
            try {
              const cell = page.locator(`.pbwin[data-win="${w.key.toLowerCase()}"] .o[data-obj="${objName}"]`).first()
              if (!(await cell.count())) { rec.skipped = 'not rendered'; result.fields.push(rec); continue }
              if (!(await cell.isVisible().catch(() => false))) { rec.skipped = 'hidden'; result.fields.push(rec); continue }
              await cell.click({ force: true, timeout: 1500 })
              await page.waitForTimeout(120)
              const editor = page.locator('.dw-edit').last()
              if (await editor.count()) {
                const tag = await editor.evaluate((e) => e.tagName).catch(() => '')
                if (tag === 'SELECT') {
                  const opts = await editor.locator('option').evaluateAll((os) => os.map((o) => o.value).filter((v) => v !== ''))
                  if (!opts.length) { rec.skipped = 'empty drop-down'; await page.keyboard.press('Escape').catch(() => {}); result.fields.push(rec); continue }
                  await editor.selectOption(opts[0]).catch(() => {})
                } else {
                  await editor.fill(value).catch(() => {})
                }
                await page.keyboard.press('Tab').catch(() => {})
              } else {
                await page.keyboard.press('Escape').catch(() => {})
                rec.skipped = 'no editor'
                result.fields.push(rec)
                continue
              }
              await page.waitForTimeout(140)
              result.messages.push(...await dismiss(page))
              rec.got = await page.evaluate(({ win, dwName, field }) => {
                const rt = window.rt
                const w = rt.windowInstances.get(win)
                // Read the same DataWindow the cell belongs to; several windows
                // have a hidden list DataWindow with the same column name.
                let dw = null
                const find = (o) => { for (const c of o.children.values()) { if (c.native === 'datawindow' && c.name === dwName) { dw = c; return } if (c.children.size) find(c) } }
                find(w)
                if (!dw || !dw.model) return null
                const m = dw.model
                return String(m.buf.primary[0]?.v[m.colIndex(field)] ?? '')
              }, { win: w.key, dwName: dw.name, field: objName })
              fieldCount++
            } catch (e) {
              rec.error = String(e.message || e).slice(0, 200)
            }
            result.fields.push(rec)
          }
          if (MAX_FIELDS && fieldCount >= MAX_FIELDS) break
        }
        if (MAX_FIELDS && fieldCount >= MAX_FIELDS) break
      }
    }
    result.ok = result.fields.filter((f) => !f.skipped && !f.error).length
  } catch (e) {
    result.error = String(e.stack || e).slice(0, 1000)
  } finally {
    await page.close().catch(() => {})
  }
  return result
}

const summary = []
for (let i = 0; i < paths.length; i++) {
  const path = paths[i]
  const r = await auditPath(path)
  summary.push({ path, opened: r.opened, windows: r.windows.length, tabs: r.tabs.length, fields: r.fields.length, probed: r.ok ?? 0, buttons: r.buttons.length, errors: r.errors.length, error: r.error })
  writeFileSync(join(OUT, `${String(i + 1).padStart(3, '0')}_${slug(path)}.json`), JSON.stringify(r, null, 1))
  console.log(`${i + 1}/${paths.length} ${path} fields=${r.fields.length} probed=${r.ok ?? 0} tabs=${r.tabs.length} errors=${r.errors.length}${r.error ? ' FATAL ' + r.error.slice(0, 200) : ''}`)
}
writeFileSync(join(OUT, 'summary.json'), JSON.stringify(summary, null, 1))
console.log('done', paths.length, '->', OUT)
await browser.close()
