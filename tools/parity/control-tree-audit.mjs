// Mechanical control-tree parity audit.
//
// For each menu path it opens the screen, enumerates every runtime window and
// control, then compares that tree with the original window definitions in
// data/src/objects.  Missing controls, tab pages and DataWindow dataobjects are
// reported per screen.  This catches a feature that was never instantiated even
// when the screen screenshot looks plausible.
//
//   node control-tree-audit.mjs --base http://127.0.0.1:5177 --items items.json --out dir
import { createRequire } from 'node:module'
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs'
import { join, basename } from 'node:path'

const require = createRequire(process.env.PLAYWRIGHT_MODULES || 'C:/Users/Admin/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/')
const { chromium } = require('playwright')
const arg = (n, d) => { const i = process.argv.indexOf(n); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d }
const BASE = arg('--base', 'http://127.0.0.1:5177')
const ITEMS = arg('--items')
const OUT = arg('--out', join(process.cwd(), 'control-tree-audit'))
const ONLY = arg('--only', '')
const LIMIT = Number(arg('--limit', '0'))
const SETTLE = Number(arg('--settle', '1500'))
const loginFile = arg('--login-file', 'C:/Projects/Abuzar/deploy/parity/login-trader.ps1')
const src = readFileSync(loginFile, 'utf8')
const USER = arg('--user', (src.match(/\$User\s*=\s*'([^']*)'/) || [])[1] || 'ADMIN')
const PASS = arg('--pass', (src.match(/\$Pass\s*=\s*'([^']*)'/) || [])[1])
if (!PASS || !ITEMS) throw new Error('need --items and a local login file')
mkdirSync(OUT, { recursive: true })
const paths = JSON.parse(readFileSync(ITEMS, 'utf8')).filter((p) => !ONLY || p.toLowerCase().includes(ONLY.toLowerCase())).slice(0, LIMIT || undefined)
const slug = (s) => String(s).replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ').replace(/\s+/g, '_').replace(/_+/g, '_').slice(0, 100)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// index window definitions by lower-case class name
const OBJECTS = 'C:/Projects/Abuzar/rebuild/data/src/objects'
const defs = new Map()
function index(dir) {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, ent.name)
    if (ent.isDirectory()) index(p)
    else if (ent.name.endsWith('.json')) {
      const name = basename(ent.name, '.json').toLowerCase()
      if (!defs.has(name)) defs.set(name, p)
    }
  }
}
index(OBJECTS)

function expectedControls(def) {
  const out = []
  const walk = (c, parent) => {
    const name = String(c.name ?? c.field ?? '')
    if (name) out.push({
      name,
      parent,
      native: c.ancestor ?? c.field ?? '',
      text: (c.fields || []).find((f) => f.name === 'text')?.value,
      dataobject: (c.fields || []).find((f) => f.name === 'dataobject')?.value,
      visible: (c.fields || []).find((f) => f.name === 'visible')?.value,
    })
    for (const ch of c.controls || []) walk(ch, name)
  }
  for (const c of def.controls || []) walk(c, '')
  return out
}

const browser = await chromium.launch()
const summary = []
for (let pi = 0; pi < paths.length; pi++) {
  const path = paths[pi]
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 300)))
  const result = { path, errors, windows: [] }
  try {
    await page.goto(`${BASE}/?app=1&autologin=${encodeURIComponent(USER)}:${encodeURIComponent(PASS)}`, { waitUntil: 'load', timeout: 60000 })
    await page.waitForFunction(() => window.rt && window.rt.windowInstances.get('w_main') && typeof window.__menu === 'function', null, { timeout: 120000, polling: 300 })
    await page.evaluate((p) => { void window.__menu(p) }, path)
    await page.waitForTimeout(SETTLE)
    // dismiss any information boxes without choosing Yes
    for (let i = 0; i < 15; i++) {
      const n = await page.evaluate(() => document.querySelectorAll('.msgbox').length)
      if (!n) break
      await page.evaluate(() => {
        const b = document.querySelector('.msgbox')
        const bs = [...b.querySelectorAll('.btns button')]
        const pick = bs.find((x) => /^(ok|no|cancel|close)$/i.test(x.textContent.trim())) || bs[0]
        pick?.click()
      })
      await page.waitForTimeout(100)
    }
    result.windows = await page.evaluate(() => {
      const skip = new Set(['w_main'])
      const out = []
      const visibleChain = (o) => { for (let x = o; x; x = x.parent) if (x.props && x.props.get('visible') === false) return false; return true }
      for (const [key, w] of window.rt.windowInstances) {
        if (skip.has(key)) continue
        const walk = (o) => [...o.children.values()].map((c) => ({
          name: c.name,
          native: c.native,
          className: c.className,
          text: c.props.get('text'),
          visible: visibleChain(c),
          selfVisible: c.props.get('visible'),
          enabled: c.props.get('enabled'),
          dataobject: c.props.get('dataobject'),
          children: walk(c),
        }))
        out.push({ key, className: w.className, title: w.props.get('title'), controls: walk(w) })
      }
      return out
    })
    for (const w of result.windows) {
      const defPath = defs.get(String(w.className).toLowerCase())
      if (!defPath) { w.definition = null; continue }
      const def = JSON.parse(readFileSync(defPath, 'utf8'))
      const expected = expectedControls(def)
      const actual = new Map()
      const collect = (list) => { for (const c of list) { if (c.name) actual.set(c.name, c); collect(c.children) } }
      collect(w.controls)
      w.definition = defPath.replace(/\\/g, '/').split('/objects/')[1]
      w.missing = []
      for (const e of expected) {
        if (!actual.has(e.name)) w.missing.push(e)
      }
      // tab pages: expected tab controls and children
      w.tabMismatches = []
      const tabs = []
      const findTabs = (list) => { for (const c of list) { if (c.native === 'tab') tabs.push(c); findTabs(c.children) } }
      findTabs(w.controls)
      w.tabCount = tabs.length
      // dataobject mismatches
      w.dataobjectMismatches = []
      for (const e of expected) {
        if (!e.dataobject) continue
        const a = actual.get(e.name)
        if (a && String(a.dataobject || '').toLowerCase() !== String(e.dataobject).toLowerCase()) w.dataobjectMismatches.push({ name: e.name, expected: e.dataobject, actual: a.dataobject })
      }
    }
    result.summary = result.windows.map((w) => ({ class: w.className, def: w.definition, expectedMissing: w.missing?.length ?? null, tabs: w.tabCount, dataobjectMismatches: w.dataobjectMismatches?.length ?? null }))
  } catch (e) {
    result.error = String(e.stack || e).slice(0, 1000)
  } finally {
    await page.close().catch(() => {})
  }
  summary.push({ path, windows: result.windows.length, missing: result.windows.reduce((n, w) => n + (w.missing?.length || 0), 0), dataobjectMismatches: result.windows.reduce((n, w) => n + (w.dataobjectMismatches?.length || 0), 0), errors: errors.length, error: result.error })
  writeFileSync(join(OUT, `${String(pi + 1).padStart(3, '0')}_${slug(path)}.json`), JSON.stringify(result, null, 1))
  console.log(`${pi + 1}/${paths.length} ${path} windows=${result.windows.length} missing=${result.windows.reduce((n, w) => n + (w.missing?.length || 0), 0)} dmismatch=${result.windows.reduce((n, w) => n + (w.dataobjectMismatches?.length || 0), 0)}${result.error ? ' FATAL ' + result.error.slice(0, 120) : ''}`)
}
writeFileSync(join(OUT, 'summary.json'), JSON.stringify(summary, null, 1))
console.log('done', paths.length, '->', OUT)
await browser.close()
