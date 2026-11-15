// Drives the Modern interface through a list of steps (a JSON file) and takes screenshots: the hand tool of a visual QA session.
//   APP_USER=... APP_PW=... node e2e/modern-qa-steps.mjs <base-url> <out-dir> <steps.json> [dark|light]
// Steps: {menu:"Sales | Cash Sale"} {wait:ms} {shot:"name"} {click:"css"|[x,y]} {dblclick:..} {type:"text"} {key:"Enter"}
//        {eval:"js"} (result printed) {hover:"css"} {scroll:["css", dy]} {text:"css"} (innerText printed) {size:[w,h]}
import { chromium } from 'playwright'
import { mkdirSync, readFileSync } from 'node:fs'
const base = process.argv[2], out = process.argv[3], steps = JSON.parse(readFileSync(process.argv[4], 'utf8'))
const theme = process.argv[5] === 'light' ? 'light' : 'dark'
mkdirSync(out, { recursive: true })
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: Number(process.env.QA_W ?? 1440), height: Number(process.env.QA_H ?? 900) }, colorScheme: theme })
page.on('pageerror', (e) => console.log('PAGE ERROR', String(e?.message ?? e).slice(0, 300)))
page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) console.log('CONSOLE ERROR', m.text().slice(0, 300)) })
if (process.env.QA_LOGIN !== '0') {
  await page.goto(`${base}/?${process.env.QA_MODE === 'classic' ? 'classic=1' : 'presentation=1'}&autologin=${encodeURIComponent(process.env.APP_USER)}:${encodeURIComponent(process.env.APP_PW)}`)
  await page.waitForFunction(() => window.__menu && window.rt?.windowInstances.get('w_main'), null, { timeout: 180000, polling: 500 })
  await page.waitForTimeout(5000)
  await page.evaluate(() => {
    window.__boxes = []
    const ui = window.rt.ui, shown = ui.messageBox.bind(ui)
    ui.messageBox = (title, text, ...rest) => { window.__boxes.push(`${title}: ${String(text).replace(/\s+/g, ' ').slice(0, 200)}`); return shown(title, text, ...rest) }
  })
} else { await page.goto(`${base}/?presentation=1`); await page.waitForTimeout(4000) }
const target = (v) => Array.isArray(v) ? null : page.locator(v).first()
for (const s of steps) {
  try {
    if (s.menu) console.log('menu', s.menu, await page.evaluate((p) => Promise.race([window.__menu(p), new Promise((r) => setTimeout(() => r('timeout'), 8000))]), s.menu))
    else if (s.wait) await page.waitForTimeout(s.wait)
    else if (s.shot) await page.screenshot({ path: `${out}/${s.shot}.png`, fullPage: !!s.full })
    else if (s.click) { if (Array.isArray(s.click)) await page.mouse.click(...s.click); else await target(s.click).click({ timeout: 5000 }) }
    else if (s.dblclick) { if (Array.isArray(s.dblclick)) await page.mouse.dblclick(...s.dblclick); else await target(s.dblclick).dblclick({ timeout: 5000 }) }
    else if (s.hover) { if (Array.isArray(s.hover)) await page.mouse.move(...s.hover); else await target(s.hover).hover({ timeout: 5000 }) }
    else if (s.type !== undefined) await page.keyboard.type(s.type, { delay: s.delay ?? 40 })
    else if (s.key) await page.keyboard.press(s.key)
    else if (s.eval) console.log('eval', JSON.stringify(await page.evaluate(s.eval)))
    else if (s.text) console.log('text', await target(s.text).innerText({ timeout: 5000 }))
    else if (s.scroll) await page.evaluate(([sel, dy]) => { const el = document.querySelector(sel); if (el) el.scrollTop += dy }, s.scroll)
    else if (s.size) await page.setViewportSize({ width: s.size[0], height: s.size[1] })
    else if (s.boxes) console.log('boxes', JSON.stringify(await page.evaluate(() => window.__boxes.splice(0))))
  } catch (e) { console.log('STEP FAILED', JSON.stringify(s), String(e?.message ?? e).split('\n')[0]) }
}
await browser.close()
