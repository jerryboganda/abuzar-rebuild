// Drives the real user interface in Chromium against the real server: signs in through the original login window (?autologin), checks the
// menu bar and toolbar, opens a sample of the windows through the DOM UI and reports page errors, message boxes and slow windows.
// usage: node browser-smoke.mjs <base url> [stride]       (needs the `playwright` package and a Chromium)
import { chromium } from 'playwright'

const base = process.argv[2]
const stride = Number(process.argv[3] || 14)
const browser = await chromium.launch()
// the size of the screen the original was compared on: windows lay themselves out from the screen size (GetEnvironment)
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } })
await page.addInitScript(() => {
  window.closeLikeUser = async (w) => {
    const closing = window.rt.closeWindow(w).catch(() => {})
    for (let i = 0; i < 4; i++) {
      const done = await Promise.race([closing.then(() => true), new Promise((r) => setTimeout(() => r(false), 400))])
      if (done) return
      document.querySelectorAll('.msgbox .btns').forEach((bar) => {
        const no = [...bar.querySelectorAll('button')].find((x) => /^no$/i.test(x.textContent.trim()))
        ;(no || bar.querySelector('button'))?.click()
      })
    }
  }
})
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
      if (w) await window.closeLikeUser(w)
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
  // windows that a script closes by itself (a failed check in the open event): which routines ran just before, per menu item
  await page.evaluate(() => {
    window.__closes = []
    const cw = window.rt.closeWindow
    window.rt.closeWindow = (w) => {
      window.__closes.push(`${w.className}<-${window.rt.recentNames(6)}`)
      return cw(w)
    }
    // message boxes too: the watchdog answers them before the screen is read
    const mb = window.rt.sys.get('messagebox')
    window.rt.sys.set('messagebox', {
      ...mb,
      fn: (r, a, ...x) => {
        window.__closes.push(`BOX ${a[0]}: ${String(a[1]).slice(0, 90)}`)
        return mb.fn(r, a, ...x)
      },
    })
  })
  const t0 = Date.now()
  const rows = []
  for (const p of order) {
    if (Date.now() - t0 > budgetMs) break
    const [id, , , path] = p
    current = path
    const name = id + '_' + path.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 110)
    await page.evaluate(() => (window.__closes.length = 0))
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
    if (path.startsWith('&Reports')) {
      // the report may still be retrieving: wait (up to 20 s) until its DataWindow is shown, then take the final screen
      for (let i = 0; i < 20; i++) {
        const shown = await page.evaluate(() => {
          const d = window.rt.windowInstances.get('w_reviewreport')?.children.get('dw_report')
          return !d || d.props.get('visible') !== false
        })
        if (shown) break
        await page.waitForTimeout(1000)
      }
      await page.waitForTimeout(800)
      await page.screenshot({ path: `${shots}/${name}_final.png` })
    }
    const titles = await page.evaluate(() => [...document.querySelectorAll('.pbwin .ttl')].map((t) => t.textContent.trim()).join(' ; '))
    // message boxes that were open (script errors show up as "Application error" boxes): what the user would have seen
    const boxes = await page.evaluate(() => [...document.querySelectorAll('.msgbox')].map((b) => ((b.querySelector('.ttl')?.textContent || '') + ': ' + (b.querySelector('.txt')?.textContent || '')).replace(/\s+/g, ' ').slice(0, 260)).join(' || '))
    // what the report window holds (for the reports that opened one): the DataWindow's visibility, rows, preview state
    const rep = await page.evaluate(() => {
      const w = window.rt.windowInstances.get('w_reviewreport')
      const d = w && w.children.get('dw_report')
      if (!d) return ''
      const m = d.model
      const el = [...document.querySelectorAll('.pbwin')].pop()
      return `dw=${d.props.get('dataobject') || (m && m.name) || ''} visible=${d.props.get('visible')} rows=${m ? m.rowCount() : 'nomodel'} preview=${m ? m.overrides.get('datawindow.print.preview') : ''} dom=${document.querySelectorAll('.dw-preview').length}`
    })
    // closed by scripts while this item was opening
    const closed = await page.evaluate(() => window.__closes.splice(0).join(' || '))
    rows.push(`${id}\t${res}\t${titles}\t${path}\t${boxes}\t${rep}\t${closed}`)
    writeFileSync(`${shots}/menu-crawl.tsv`, rows.join('\n') + '\n') // kept up to date: a frozen page must not lose what was seen
    await page.evaluate(async () => {
      for (let i = 0; i < 4; i++) {
        document.querySelectorAll('.msgbox .btns button').forEach((b) => {
          const no = [...b.parentElement.querySelectorAll('button')].find((x) => /^no$/i.test(x.textContent.trim()))
          ;(no || b).click()
        })
        // dialogs (password, arguments ...) are left with their Cancel button, as a user would; the rest is closed
        document.querySelectorAll('.pbwin:not(.sheet) button').forEach((b) => {
          if (/^cancel$/i.test(b.textContent.trim())) b.click()
        })
        await new Promise((r) => setTimeout(r, 200))
        for (const [n, w] of [...window.rt.windowInstances]) if (n !== 'w_main') await window.closeLikeUser(w)
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
let dbg = null
try {
  dbg = await page.context().newCDPSession(page)
  await dbg.send('Debugger.enable')
} catch (e) {
  console.log('debugger session for the stall probe: ' + String((e && e.message) || e).slice(0, 100))
}
for (const name of sample) {
  current = name
  const r = await Promise.race([new Promise((res) => setTimeout(() => res({ stuck: true }), 30000)), page.evaluate(async (n) => {
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
        await window.closeLikeUser(w)
      } catch (e) {
        /* closing a window that failed half-way */
      }
    }
    return { err, msgs, opened: !!w, ms: Math.round(performance.now() - t0), hadDom }
  }, name)])
  if (r.stuck) {
    const t0 = Date.now()
    // where the main thread is: a debugger pause answers with the call stack of whatever is running (it is resumed right away)
    // every call to a frozen page can itself block for ever (the 20-minute watchdog then ends the run without a stack): each gets 8 s
    const quick = (p, what) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(what + ' did not answer within 8 s (the page is frozen)')), 8000))])
    const where = await (async () => {
      try {
        // the session was opened and Debugger.enable sent before the sample: a frozen renderer cannot start either, but it still takes the pause interrupt
        if (!dbg) throw new Error('no debugger session (opened before the sample failed)')
        const cdp = dbg
        const paused = new Promise((res) => cdp.once('Debugger.paused', res))
        await quick(cdp.send('Debugger.pause'), 'Debugger.pause')
        const ev = await Promise.race([paused, new Promise((res) => setTimeout(() => res(null), 8000))])
        const stack = ev ? ev.callFrames.slice(0, 14).map((f) => `${f.functionName || '(anonymous)'} ${f.url.split('/').pop()}:${f.location.lineNumber + 1}`).join(' < ') : 'the page did not pause (it is idle, not computing)'
        await quick(cdp.send('Debugger.resume'), 'Debugger.resume').catch(() => {})
        return stack
      } catch (e) {
        return 'no stack: ' + String((e && e.message) || e).slice(0, 120)
      }
    })()
    console.log(`stuck: ${name} did not finish opening within 30 s; main thread: ${where}`)
    const back = await Promise.race([page.evaluate(() => 1).then(() => true, () => false), new Promise((res) => setTimeout(() => res(false), 90000))])
    const secs = Math.round((Date.now() - t0) / 1000) + 30
    if (!back) {
      console.log('the page did not answer again within 2 minutes; the rest of the sample is skipped')
      break
    }
    console.log(`the page answered again after ${secs} s: the sample goes on`)
    slow.push(`${name} stalled ${secs} s`)
    continue
  }
  console.log(`  sample ${name}: ${r.ms} ms${r.opened ? '' : ' (not open)'}`)
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
