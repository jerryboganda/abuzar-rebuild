// Drives the real user interface in Chromium against the real server: signs in through the original login window (?autologin), checks the
// menu bar and toolbar, opens a sample of the windows through the DOM UI and reports page errors, message boxes and slow windows.
// usage: node browser-smoke.mjs <base url> [stride]       (needs the `playwright` package and a Chromium)
import { chromium } from 'playwright'

const base = process.argv[2]
const stride = Number(process.argv[3] || 14)
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1366, height: 768 } })
const errors = []
let missingFiles = 0
let current = '(start-up)'
page.on('pageerror', (e) => errors.push({ win: current, text: String((e && e.message) || e).slice(0, 220) }))
page.on('console', (m) => {
  if (m.type() !== 'error') return
  if (/Failed to load resource/.test(m.text())) missingFiles++
  else errors.push({ win: current, text: m.text().slice(0, 220) })
})
await page.goto(base + '/?autologin=admin:admin')
try {
  await page.waitForFunction(() => window.__open && window.rt && window.rt.windowInstances.get('w_main'), null, { timeout: 150000, polling: 500 })
} catch (e) {
  // say what the page shows instead of only timing out
  const state = await page.evaluate(() => ({
    rt: !!window.rt,
    windows: window.rt ? [...window.rt.windowInstances.keys()] : [],
    text: document.body.innerText.replace(/\s+/g, ' ').slice(0, 400),
    msgbox: [...document.querySelectorAll('.msgbox .txt')].map((x) => x.textContent.slice(0, 200)),
  })).catch((err) => ({ error: String(err) }))
  console.log('the application did not reach the main window:', JSON.stringify(state))
  console.log('browser errors so far:', errors.length)
  for (const er of errors.slice(0, 15)) console.log('  ' + er.text)
  console.log('missing files:', missingFiles)
  await browser.close()
  process.exit(0)
}
await page.waitForTimeout(1500)
const frame = await page.evaluate(() => ({
  menuItems: [...document.querySelectorAll('.menubar .mi')].map((e) => e.textContent),
  toolbarButtons: document.querySelectorAll('.toolbar .tb').length,
  title: document.querySelector('.win.mdi .ttl, .mdi-frame .ttl')?.textContent ?? '',
}))
console.log(`main window: menu bar [${frame.menuItems.join(' | ')}], ${frame.toolbarButtons} toolbar buttons`)

const names = await page.evaluate(async () => {
  const j = await (await fetch('/data/classes/_index.json')).json()
  return Object.keys(j).filter((n) => n.startsWith('w_')).sort()
})
const skip = new Set(['w_main', 'w_login1', 'w_startup', 'w_logo'])
const sample = names.filter((n, i) => i % stride === 0 && !skip.has(n))
let opened = 0
let thrown = 0
const boxes = []
const slow = []
const failed = []
for (const name of sample) {
  current = name
  const r = await page.evaluate(async (n) => {
    const t0 = performance.now()
    let err = null
    try {
      await Promise.race([window.__open(n), new Promise((res) => setTimeout(res, 3500))])
    } catch (e) {
      err = String((e && e.message) || e).slice(0, 160)
    }
    await new Promise((res) => setTimeout(res, 150))
    const w = window.rt.windowInstances.get(n)
    const msgs = [...document.querySelectorAll('.msgbox')].map((b) => (b.querySelector('.txt')?.textContent || '').slice(0, 110))
    document.querySelectorAll('.msgbox .btns button').forEach((b) => b.click())
    const hadDom = document.querySelectorAll('.win').length
    if (w) {
      try {
        await window.rt.closeWindow(w)
      } catch (e) {
        /* closing a window that failed half-way */
      }
    }
    return { err, msgs, opened: !!w, ms: Math.round(performance.now() - t0), hadDom }
  }, name)
  if (r.opened) opened++
  if (r.err) {
    thrown++
    failed.push(`${name}: ${r.err}`)
  }
  for (const m of r.msgs) boxes.push(`${name}: ${m.replace(/\s+/g, ' ')}`)
  if (r.ms > 2500) slow.push(`${name} ${r.ms} ms`)
}
current = '(end)'
console.log(`sample of ${sample.length} of ${names.length} windows (every ${stride}th): ${opened} opened in the DOM user interface, ${thrown} raised an exception while opening`)
console.log(`message boxes shown while opening: ${boxes.length}`)
for (const b of boxes.slice(0, 15)) console.log('  ' + b)
console.log(`exceptions: ${failed.length}`)
for (const f of failed.slice(0, 20)) console.log('  ' + f)
const grouped = new Map()
for (const e of errors) {
  const k = e.text.replace(/\d+/g, 'N').slice(0, 120)
  const g = grouped.get(k) || { n: 0, win: e.win }
  g.n++
  grouped.set(k, g)
}
console.log(`browser errors (page errors and console errors, not counting ${missingFiles} missing files): ${errors.length}`)
for (const [k, g] of [...grouped.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 20)) console.log(`  ${g.n} x ${k}   (first in ${g.win})`)
if (slow.length) console.log('slow windows: ' + slow.slice(0, 10).join(', '))
await browser.close()
process.exit(0)
