// Drives the real user interface in Chromium against the real server: signs in through the original login window (?autologin), checks the
// menu bar and toolbar, opens a sample of the windows through the DOM UI and reports page errors, message boxes and slow windows.
// usage: node browser-smoke.mjs <base url> [stride]       (needs the `playwright` package and a Chromium)
import { chromium } from 'playwright'

const base = process.argv[2]
const stride = Number(process.argv[3] || 14)
const browser = await chromium.launch()
// the size of the screen the original was compared on: windows lay themselves out from the screen size (GetEnvironment)
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } })
const shots = process.argv[4] || ''
const errors = []
let missingFiles = 0
let current = '(start-up)'
// a window whose script never returns freezes the page (and with it every evaluate call): the run ends here and says where, instead of hanging until the job timeout
const watchdog = setTimeout(() => {
  console.log(`watchdog: the browser run was still busy after 20 minutes, last step: ${current}; ${errors.length} browser errors so far`)
  process.exit(0)
}, 20 * 60 * 1000)
watchdog.unref?.()
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

// screens for the side-by-side comparison with the original (uploaded by the workflow as release assets)
if (shots && !process.argv[5]) {
  const { mkdirSync } = await import('node:fs')
  mkdirSync(shots, { recursive: true })
  await page.screenshot({ path: `${shots}/main.png` })
  for (const name of ['w_sale', 'w_sale_modified', 'w_purchase', 'w_item_form', 'w_customer_form', 'w_voucher']) {
    current = name
    await page.evaluate(async (n) => {
      try {
        await Promise.race([window.__opensheet(n), new Promise((res) => setTimeout(res, 4000))])
      } catch (e) {
        /* reported by the page errors */
      }
    }, name)
    await page.waitForTimeout(3500)
    await page.evaluate(() => document.querySelectorAll('.msgbox .btns button').forEach((b) => b.click()))
    await page.waitForTimeout(300)
    await page.screenshot({ path: `${shots}/${name}.png` })
    await page.evaluate(async (n) => {
      const w = window.rt.windowInstances.get(n)
      if (w) await window.rt.closeWindow(w).catch(() => {})
    }, name)
  }
}
// the same menu walk as tools/orig/crawl.ps1 does in the original: every leaf of the observed menu, a screenshot named by the id of the original's command
const observed = process.argv[5] || ''
const budgetMs = Number(process.argv[6] || 900000)
if (shots && observed) {
  const { readFileSync, writeFileSync, mkdirSync } = await import('node:fs')
  mkdirSync(shots, { recursive: true })
  await page.screenshot({ path: `${shots}/main.png` })
  const lines = readFileSync(observed, 'utf8').replace(/^﻿/, '').split(/\r?\n/).filter(Boolean).map((l) => l.split('\t'))
  const skipRe = /Exit|Change User|Backup Database|Check Database Integrity|Import Previous Sales|Inplace Initialization|Lock Item Batches/i
  const leaves = lines.filter((p) => p[1] === 'item' && p[2] !== 'disabled' && p[0] !== '0' && !skipRe.test(p[3]))
  const rep = leaves.filter((p) => p[3].startsWith('&Reports'))
  const order = [...leaves.filter((p) => !p[3].startsWith('&Reports')), ...rep.filter((_, i) => i % 3 === 0)]
  const t0 = Date.now()
  const rows = []
  for (const p of order) {
    if (Date.now() - t0 > budgetMs) break
    const [id, , , path] = p
    current = path
    const name = id + '_' + path.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 110)
    const res = await page.evaluate(async (pa) => {
      try {
        return String(await Promise.race([window.__menu(pa), new Promise((r) => setTimeout(() => r('timeout'), 6000))]))
      } catch (e) {
        return 'error ' + ((e && e.message) || e)
      }
    }, path)
    let prev = ''
    for (let i = 0; i < 10; i++) {
      const h = await page.evaluate(() => document.body.innerHTML.length + ':' + document.querySelectorAll('.pbwin').length)
      if (h === prev) break
      prev = h
      await page.waitForTimeout(500)
    }
    await page.screenshot({ path: `${shots}/${name}.png` })
    // a report asks for its format and arguments in dialogs: press Ok like the user does and take the next screens (`_s2`, `_s3`, `_s4`)
    if (path.startsWith('&Reports')) {
      for (let step = 2; step <= 4; step++) {
        const pressed = await page.evaluate(() => {
          for (const w of [...document.querySelectorAll('.pbwin:not(.sheet)')].reverse()) {
            const b = [...w.querySelectorAll('button')].find((x) => /^ok$/i.test(x.textContent.trim()) && !x.disabled)
            if (b) {
              b.click()
              return true
            }
          }
          return false
        })
        if (!pressed) break
        let seen = ''
        for (let i = 0; i < 12; i++) {
          await page.waitForTimeout(600)
          const h = await page.evaluate(() => document.body.innerHTML.length + ':' + document.querySelectorAll('.pbwin').length)
          if (h === seen) break
          seen = h
        }
        await page.screenshot({ path: `${shots}/${name}_s${step}.png` })
      }
    }
    const titles = await page.evaluate(() => [...document.querySelectorAll('.pbwin .ttl')].map((t) => t.textContent.trim()).join(' ; '))
    // message boxes that were open (script errors show up as "Application error" boxes): what the user would have seen
    const boxes = await page.evaluate(() => [...document.querySelectorAll('.msgbox')].map((b) => ((b.querySelector('.ttl')?.textContent || '') + ': ' + (b.querySelector('.txt')?.textContent || '')).replace(/\s+/g, ' ').slice(0, 260)).join(' || '))
    rows.push(`${id}\t${res}\t${titles}\t${path}\t${boxes}`)
    writeFileSync(`${shots}/menu-crawl.tsv`, rows.join('\n') + '\n') // kept up to date: a frozen page must not lose what was seen
    await page.evaluate(async () => {
      for (let i = 0; i < 4; i++) {
        document.querySelectorAll('.msgbox .btns button').forEach((b) => {
          const no = [...b.parentElement.querySelectorAll('button')].find((x) => /^no$/i.test(x.textContent.trim()))
          ;(no || b).click()
        })
        for (const [n, w] of [...window.rt.windowInstances]) if (n !== 'w_main') await window.rt.closeWindow(w).catch(() => {})
        await new Promise((r) => setTimeout(r, 150))
      }
    })
  }
  writeFileSync(`${shots}/menu-crawl.tsv`, rows.join('\n') + '\n')
  console.log(`menu walk: ${rows.length} of ${order.length} items opened in ${Math.round((Date.now() - t0) / 1000)} s; ${rows.filter((r) => r.split('\t')[1] !== 'true').length} did not click`)
}
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
