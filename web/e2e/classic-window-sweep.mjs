// Classic completeness sweep: opens every window class in the real Classic interface (the DOM UI of the original
// application) and records what the runtime or the page reports, so a window that cannot be opened is named.
//
// usage: node e2e/classic-window-sweep.mjs <base url> [report.json] [stride] [name filter]
//        (needs the `playwright` package and a Chromium; the app runs on the mock database unless a server answers)
import { chromium } from 'playwright'
import { writeFileSync } from 'node:fs'

const base = process.argv[2] || 'http://localhost:5173'
const reportFile = process.argv[3] || ''
const stride = Number(process.argv[4] || 1)
const only = process.argv[5] ? new RegExp(process.argv[5]) : null

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1366, height: 768 } })
const pageErrors = []
const consoleErrors = []
page.on('pageerror', (e) => pageErrors.push({ text: String((e && e.message) || e).slice(0, 400) }))
page.on('console', (m) => {
  if (m.type() !== 'error') return
  const text = m.text()
  if (/Failed to load resource/.test(text)) return
  consoleErrors.push({ text: text.slice(0, 400) })
})

// CRAWL_DB=server runs the sweep against the data server of the deployment instead of the mock database.
const query = process.env.CRAWL_DB === 'server' ? '?app=1&autologin=admin:admin' : '?app=1&db=mock&autologin=admin:admin'
await page.goto(base + '/' + query)
await page.waitForFunction(() => window.rt && window.rt.windowInstances.get('w_main') && typeof window.__open === 'function', null, { timeout: 120000, polling: 250 })

// the message boxes of the Classic interface answer themselves (a user would read them; the sweep asks the first answer)
// and every box is recorded, so a window that asks a question is visible in the report.
await page.evaluate(() => {
  window.__boxes = []
  window.__created = []
  const ui = window.rt.ui
  const created = ui.createWindow.bind(ui)
  ui.createWindow = (w, opts) => {
    window.__created.push(String(w.className || w.name || '').toLowerCase())
    return created(w, opts)
  }
  const shown = ui.messageBox.bind(ui)
  ui.messageBox = (title, text, ...rest) => {
    window.__boxes.push(`${title}: ${String(text).replace(/\s+/g, ' ').slice(0, 120)}`)
    const answer = shown(title, text, ...rest)
    return answer
  }
  window.answerBoxes = () => {
    for (const bar of document.querySelectorAll('.msgbox .btns, .presentation-runtime-dialog[open]')) {
      const buttons = [...bar.querySelectorAll('button')]
      const no = buttons.find((x) => /^no$/i.test(x.textContent.trim()))
      ;(no || buttons[0])?.click()
    }
  }
})

const names = await page.evaluate(async () => {
  const index = await (await fetch('/data/classes/_index.json')).json()
  return Object.keys(index).filter((n) => n.startsWith('w_')).sort()
})
const list = (only ? names.filter((n) => only.test(n)) : names)
const step = stride > 1 ? list.filter((_, i) => i % stride === 0) : list
console.log(`windows to open: ${step.length} (of ${names.length})`)

// the argument the application passes to a window (a DataWindow, or a structure that carries one)
await page.evaluate(async () => {
  window.__argumentFor = async (name) => {
    const { windowArgument } = await import('/src/app/window-arguments.ts')
    return await windowArgument(window.rt, name)
  }
})

const results = []
const t0 = Date.now()
for (let i = 0; i < step.length; i++) {
  const name = step[i]
  const before = { page: pageErrors.length, console: consoleErrors.length }
  const outcome = await page.evaluate(async (n) => {
    window.__boxes.length = 0
    window.__created.length = 0
    const rt = window.rt
    let error = null
    // the argument the application passes to this window (a DataWindow, or a structure that carries one)
    const argument = await window.__argumentFor(n)
    if (argument) rt.globals.get('message').props.set('powerobjectparm', argument)
    try {
      await Promise.race([
        window.__open(n),
        new Promise((resolve) => setTimeout(resolve, 1200)),
      ])
    } catch (e) {
      error = String((e && e.message) || e).slice(0, 300)
    }
    // the open may still be running (a modal waits for an answer): give the scripts a moment, then close what opened
    await new Promise((r) => setTimeout(r, 40))
    window.answerBoxes()
    await new Promise((r) => setTimeout(r, 40))
    const instance = rt.windowInstances.get(n)
    const rendered = !!document.querySelector('.pbwin')
    let closed = 'closed'
    if (instance) {
      try {
        await Promise.race([rt.closeWindow(instance), new Promise((r) => setTimeout(r, 4000))])
      } catch (e) {
        closed = 'close failed: ' + String((e && e.message) || e).slice(0, 120)
      }
    }
    const still = rt.windowInstances.get(n)
    if (still) {
      try {
        rt.windowInstances.delete(n)
      } catch { /* the instance stays: the report says so */ }
    }
    // a window that opens and closes itself (the About box) is not a failure: it was created
    const opened = !!instance || window.__created.includes(n)
    return { error, rendered, closed, boxes: window.__boxes.slice(0, 6), opened }
  }, name)
  // the runtime reports its own errors through the console; the ones raised while this window was open are its errors
  const runtimeErrors = consoleErrors.slice(before.console).map((e) => e.text)
  const pageError = pageErrors.slice(before.page).map((e) => e.text)
  const failed = !!outcome.error || runtimeErrors.length > 0 || pageError.length > 0 || !outcome.opened
  results.push({ name, ok: !failed, error: outcome.error, runtimeErrors, pageError, rendered: outcome.rendered, closed: outcome.closed, boxes: outcome.boxes })
  if (failed) console.log(`FAIL ${name}: ${outcome.error || runtimeErrors[0] || pageError[0] || 'the window did not open'}`)
  if ((i + 1) % 50 === 0) console.log(`  ${i + 1}/${step.length} (${((Date.now() - t0) / 1000).toFixed(0)}s)`)
}

const failed = results.filter((r) => !r.ok)
console.log(`windows opened: ${results.length - failed.length}  failed: ${failed.length}  (${((Date.now() - t0) / 1000).toFixed(0)}s)`)
for (const r of failed) console.log(`  ${r.name}: ${r.error || r.runtimeErrors[0] || r.pageError[0] || 'did not open'}`)
if (reportFile) writeFileSync(reportFile, JSON.stringify({ results, pageErrors, consoleErrors }, null, 1))
await browser.close()
process.exit(failed.length ? 1 : 0)
