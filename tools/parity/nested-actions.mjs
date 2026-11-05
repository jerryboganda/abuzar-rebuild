// Exercise the form's own menu (im_menu) actions, one per fresh session.
// Read-only: prompts are answered No/Cancel, Save/Post/Delete/Update and
// navigation actions are skipped unless --all is passed.
//
//   node nested-actions.mjs --path "Basic Data | Item .......... | Item" --window w_item_form --out dir
import { createRequire } from 'node:module'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
const require = createRequire(process.env.PLAYWRIGHT_MODULES || 'C:/Users/Admin/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/')
const { chromium } = require('playwright')
const arg = (n, d) => { const i = process.argv.indexOf(n); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d }
const BASE = arg('--base', 'http://127.0.0.1:5177')
const PATH = arg('--path')
const WIN = arg('--window')
const OUT = arg('--out', join(process.cwd(), 'screen-parity', 'nested-actions'))
const ALL = process.argv.includes('--all')
const SETTLE = Number(arg('--settle', '1200'))
if (!PATH || !WIN) throw new Error('need --path and --window')
mkdirSync(OUT, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const slug = (s) => String(s).replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ').replace(/\s+/g, '_').replace(/_+/g, '_').slice(0, 90)
const skipRe = /^(?:&?save|&?post|&?delete|&?update|&?exit|&?logoff|&?change user|&?print|&?new|&?retrieve|&?refresh|&?first|&?last|&?next|&?previous|&?close)\b/i
const browser = await chromium.launch()

function tree(winKey) {
  const rt = window.rt
  const w = rt.windowInstances.get(winKey)
  const menu = w?.props.get('im_menu') || w?.props.get('menuid')
  if (!menu) return null
  const walk = (o, prefix) => {
    const out = []
    for (const c of o.children.values()) {
      const text = String(c.props?.get('text') ?? '').replace(/\s+/g, ' ').replace(/&/g, '').trim()
      const p = prefix ? prefix + ' | ' + text : text
      const kids = [...c.children.values()]
      if (kids.length) out.push(...walk(c, p))
      else out.push({ name: c.name, text, path: p, enabled: c.props?.get('enabled') !== false, visible: c.props?.get('visible') !== false, scripts: (c.scripts || []).length })
    }
    return out
  }
  return walk(menu, '')
}

// pass 1: open once, list form actions
let page = await browser.newPage({ viewport: { width: 1920, height: 1080 } })
const result = { path: PATH, window: WIN, actions: [], errors: [] }
page.on('pageerror', (e) => result.errors.push(String(e.message || e).slice(0, 400)))
await page.goto(`${BASE}/?app=1&autologin=ADMIN:password9080`, { waitUntil: 'load', timeout: 60000 })
await page.waitForFunction(() => window.rt && window.rt.windowInstances.get('w_main') && typeof window.__menu === 'function', null, { timeout: 120000, polling: 300 })
await page.evaluate((p) => { void window.__menu(p) }, PATH)
await page.waitForFunction((k) => window.rt.windowInstances.get(k), WIN, { timeout: 30000, polling: 300 })
await sleep(SETTLE)
const all = await page.evaluate(tree, WIN)
await page.close().catch(() => {})
const actionable = (all || []).filter((a) => a.visible && a.enabled && a.scripts && (ALL || !skipRe.test(a.text)))
result.menu = all

for (const act of actionable) {
  const rec = { name: act.name, text: act.text, path: act.path, opened: [], modals: [], error: '' }
  page = await browser.newPage({ viewport: { width: 1920, height: 1080 } })
  page.on('pageerror', (e) => { rec.error = String(e.message || e).slice(0, 400) })
  try {
    await page.goto(`${BASE}/?app=1&autologin=ADMIN:password9080`, { waitUntil: 'load', timeout: 60000 })
    await page.waitForFunction(() => window.rt && window.rt.windowInstances.get('w_main') && typeof window.__menu === 'function', null, { timeout: 120000, polling: 300 })
    await page.evaluate((p) => { void window.__menu(p) }, PATH)
    await page.waitForFunction((k) => window.rt.windowInstances.get(k), WIN, { timeout: 30000, polling: 300 })
    await sleep(SETTLE)
    const before = await page.evaluate(() => [...window.rt.windowInstances.keys()])
    await page.evaluate(({ winKey, name }) => {
      const rt = window.rt
      const w = rt.windowInstances.get(winKey)
      const menu = w?.props.get('im_menu') || w?.props.get('menuid')
      let hit = null
      const walk = (o) => { for (const c of o.children.values()) { if (c.name === name) { hit = c; return } walk(c) } }
      if (menu) walk(menu)
      if (hit) void rt.fire(hit, 'clicked')
    }, { winKey: WIN, name: act.name })
    for (let i = 0; i < 16; i++) {
      await sleep(350)
      const s = await page.evaluate((prev) => ({
        wins: [...window.rt.windowInstances.keys()].filter((k) => !prev.includes(k)),
        modals: [...document.querySelectorAll('.msgbox .txt')].map((x) => x.textContent.replace(/\s+/g, ' ').trim().slice(0, 220)),
      }), before)
      rec.opened = [...new Set([...rec.opened, ...s.wins])]
      if (s.modals.length) rec.modals.push(...s.modals)
      await page.evaluate(() => { for (const b of document.querySelectorAll('.msgbox')) { const bs = [...b.querySelectorAll('.btns button')]; (bs.find((x) => /^(no|cancel|close|ok)$/i.test(x.textContent.trim())) || bs[0])?.click(); } })
      if (rec.opened.length && !s.modals.length) break
    }
    await page.screenshot({ path: join(OUT, `${slug(WIN + '_' + act.name)}.png`) }).catch(() => {})
  } catch (e) { rec.error = String(e.message || e).slice(0, 600) }
  finally { await page.close().catch(() => {}) }
  result.actions.push(rec)
  console.log(JSON.stringify({ action: rec.name, text: rec.text, opened: rec.opened, modals: rec.modals.slice(0, 2), error: rec.error }))
}
writeFileSync(join(OUT, slug(WIN) + '.json'), JSON.stringify(result, null, 1))
console.log(`done ${actionable.length} actions -> ${OUT}`)
await browser.close()
