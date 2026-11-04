// Field reachability probe for a transaction screen: opens the screen, clicks every
// visible editable DataWindow cell, types a value, commits it, and records what the
// model holds afterwards.  It never saves the document; closing answers No.
//
//   node field-probe.mjs --base http://127.0.0.1:5177 --path "Sales | CashSale" --window w_sale --out <dir>
import { createRequire } from 'node:module'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
const require = createRequire(process.env.PLAYWRIGHT_MODULES || 'C:/Users/Admin/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/')
const { chromium } = require('playwright')
const arg = (n, d) => { const i = process.argv.indexOf(n); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d }
const BASE = arg('--base', 'http://127.0.0.1:5177')
const PATH = arg('--path')
const WIN = arg('--window')
const TAB = Number(arg('--tab', '0'))
const OUT = arg('--out', join(process.cwd(), 'screen-parity', 'fields'))
const loginFile = arg('--login-file', 'C:/Projects/Abuzar/deploy/parity/login-trader.ps1')
const src = readFileSync(loginFile, 'utf8')
const USER = arg('--user', (src.match(/\$User\s*=\s*'([^']*)'/) || [])[1] || 'ADMIN')
const PASS = arg('--pass', (src.match(/\$Pass\s*=\s*'([^']*)'/) || [])[1])
if (!PASS || !PATH || !WIN) throw new Error('need --path and --window (and a local login file)')
mkdirSync(OUT, { recursive: true })
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } })
const errors = []
page.on('pageerror', (e) => errors.push(String((e && e.stack) || e).slice(0, 800)))
await page.goto(`${BASE}/?app=1&autologin=${encodeURIComponent(USER)}:${encodeURIComponent(PASS)}`)
await page.waitForFunction(() => window.rt && window.rt.windowInstances.get('w_main'), null, { timeout: 180000, polling: 500 })
await page.waitForTimeout(1000)
async function dismiss(yes = false) {
  const out = []
  for (let i = 0; i < 40; i++) {
    const n = await page.evaluate(() => document.querySelectorAll('.msgbox').length)
    if (!n) break
    const m = await page.evaluate((yes) => {
      const b = document.querySelector('.msgbox')
      const bs = [...b.querySelectorAll('.btns button')]
      const pick = (yes && bs.find((x) => /^yes$/i.test(x.textContent.trim()))) || bs.find((x) => /^(no|cancel|close|ok)$/i.test(x.textContent.trim())) || bs[0]
      const t = (b.querySelector('.txt')?.textContent || '').replace(/\s+/g, ' ').trim()
      pick?.click()
      return { text: t, chosen: pick?.textContent?.trim() }
    }, yes)
    out.push(m)
    await page.waitForTimeout(120)
  }
  return out
}
const result = { path: PATH, window: WIN, fields: [], messages: [], errors }
try {
  await page.evaluate((p) => window.__menu(p), PATH)
  await page.waitForTimeout(2200)
  result.messages.push(...await dismiss(false))
  if (TAB) {
    result.messages.push(...await page.evaluate(({ w, tab }) => {
      const win = window.rt.windowInstances.get(w)
      if (!win) return []
      let found = null
      const walk = (o) => { for (const c of o.children.values()) { if (c.native === 'tab' && !found) found = c; else if (c.children.size) walk(c) } }
      walk(win)
      if (found) found.pbSet('selectedtab', tab)
      return []
    }, { w: WIN, tab: TAB }))
    await page.waitForTimeout(700)
    result.messages.push(...await dismiss(false))
  }
  const meta = await page.evaluate((w) => {
    const win = window.rt.windowInstances.get(w)
    if (!win) return { ok: false, wins: [...window.rt.windowInstances.keys()] }
    const out = []
    const walk = (o) => {
      for (const c of o.children.values()) {
        if ((c.native === 'datawindow' || c.native === 'datastore') && c.model) {
          const m = c.model
          out.push({
            name: c.name,
            dataobject: c.props.get('dataobject'),
            rows: m.rowCount(),
            columns: m.def.table.columns.map((x) => ({ name: x.name, type: x.type })),
            objects: (m.def.objects || []).filter((x) => x.type === 'column' && Number(x.tabsequence) > 0 && x.protect !== '1').map((x) => x.name),
          })
        }
        if (c.children.size) walk(c)
      }
    }
    walk(win)
    return { ok: true, datawindows: out }
  }, WIN)
  result.datawindows = meta
  if (!meta.ok) throw new Error('window not found')
  let counter = 0
  for (const dw of meta.datawindows) {
    if (!dw.rows) continue
    for (const name of dw.objects) {
      counter++
      const col = dw.columns.find((c) => c.name === name)
      let value = 'TEST'
      if (col) {
        const t = col.type.toLowerCase()
        if (t.startsWith('char')) value = 'PARITY'
        else if (t.includes('int') || t === 'long' || t.startsWith('decimal') || t.startsWith('numeric') || t === 'double' || t === 'real') value = '1'
        else if (t === 'date' || t === 'datetime') value = '05/11/2026'
      }
      const cell = page.locator(`.pbwin[data-win="${WIN}"] .o[data-obj="${name}"]`).first()
      if (!(await cell.count())) { result.fields.push({ dw: dw.name, field: name, skipped: 'not rendered' }); continue }
      try {
        await cell.click({ force: true, timeout: 1500 })
      } catch { result.fields.push({ dw: dw.name, field: name, skipped: 'click blocked' }); continue }
      await page.waitForTimeout(180)
      const editor = page.locator('.dw-edit').last()
      if (await editor.count()) {
        const tag = await editor.evaluate((e) => e.tagName).catch(() => '')
        if (tag === 'SELECT') {
          const opts = await editor.locator('option').evaluateAll((os) => os.map((o) => o.value))
          if (opts.length) await editor.selectOption(opts.find((v) => v !== '') || opts[0]).catch(() => {})
        } else {
          await editor.fill(value).catch(() => {})
        }
        await page.keyboard.press('Tab').catch(() => {})
      } else {
        await page.keyboard.type(value).catch(() => {})
        await page.keyboard.press('Tab').catch(() => {})
      }
      await page.waitForTimeout(180)
      result.messages.push(...await dismiss(false))
      const got = await page.evaluate(({ w, dwName, field }) => {
        const win = window.rt.windowInstances.get(w)
        let found = null
        const walk = (o) => { for (const c of o.children.values()) { if (c.name === dwName) found = c; else if (c.children.size) walk(c) } }
        walk(win)
        if (!found?.model) return null
        const m = found.model
        const i = m.colIndex(field)
        return i < 0 ? null : m.buf.primary[0]?.v[i]
      }, { w: WIN, dwName: dw.name, field: name })
      result.fields.push({ dw: dw.name, field: name, value: String(got ?? '') })
    }
  }
  result.ok = result.fields.some((f) => !f.skipped)
} catch (e) {
  result.ok = false
  result.errors.push(String(e.message || e))
}
// close without saving: answer No/Cancel to any close query
await page.evaluate(async (w) => {
  const rt = window.rt
  const win = rt.windowInstances.get(w)
  if (win) void rt.closeWindow(win)
  await new Promise((r) => setTimeout(r, 500))
}, WIN).catch(() => {})
result.messages.push(...await dismiss(false))
result.errors.push(...errors)
writeFileSync(join(OUT, `fields-${WIN}.json`), JSON.stringify(result, null, 1))
console.log(JSON.stringify({ ok: result.ok, fields: result.fields.length, typed: result.fields.filter((f) => !f.skipped).length, messages: result.messages.length, errors: result.errors.slice(0, 3) }, null, 1))
await browser.close()

