// Visual QA walk of the Modern interface against a live data server: signs in, opens every enabled leaf of the user's menu
// (or the ones named), takes a full-size screenshot of each and records what a reviewer would look for: page errors, message
// boxes, clipped captions, controls outside their window, overlapping controls, windows that do not fit.
//
//   APP_USER=... APP_PW=... node e2e/modern-visual-qa.mjs <base-url> <out-dir> [filter-regex] [theme: dark|light]
//
// Nothing is saved by the walk: every window is closed with No/Cancel, like a user leaving.
import { chromium } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'

const base = process.argv[2] ?? 'http://localhost:5174'
const out = process.argv[3] ?? 'qa-shots'
const filter = process.argv[4] ? new RegExp(process.argv[4], 'i') : null
const theme = process.argv[5] === 'light' ? 'light' : 'dark'
const user = process.env.APP_USER ?? 'admin'
const pass = process.env.APP_PW ?? ''
const width = Number(process.env.QA_W ?? 1440), height = Number(process.env.QA_H ?? 900)
mkdirSync(out, { recursive: true })

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width, height }, colorScheme: theme })
const errors = []
let current = 'start'
page.on('pageerror', (e) => errors.push({ at: current, text: 'page: ' + String(e?.message ?? e).slice(0, 300) }))
page.on('console', (m) => {
  if (m.type() !== 'error' || /Failed to load resource/.test(m.text())) return
  errors.push({ at: current, text: 'console: ' + m.text().slice(0, 300) })
})

await page.goto(`${base}/?presentation=1&autologin=${encodeURIComponent(user)}:${encodeURIComponent(pass)}`)
await page.waitForFunction(() => window.__menu && window.rt?.windowInstances.get('w_main'), null, { timeout: 180000, polling: 500 })
await page.waitForTimeout(6000)

await page.evaluate(() => {
  window.__boxes = []
  const ui = window.rt.ui
  const shown = ui.messageBox.bind(ui)
  ui.messageBox = (title, text, ...rest) => { window.__boxes.push(`${title}: ${String(text).replace(/\s+/g, ' ').slice(0, 200)}`); return shown(title, text, ...rest) }
  window.__answer = () => {
    for (const bar of document.querySelectorAll('.msgbox .btns, .presentation-runtime-dialog[open]')) {
      const buttons = [...bar.querySelectorAll('button')]
      const b = buttons.find((x) => /^no$/i.test(x.textContent.trim())) ?? buttons.find((x) => /^cancel$/i.test(x.textContent.trim())) ?? buttons[0]
      b?.click()
    }
  }
  window.closeLikeUser = async (w) => {
    const closing = window.rt.closeWindow(w).catch(() => {})
    for (let i = 0; i < 4; i++) {
      const done = await Promise.race([closing.then(() => true), new Promise((r) => setTimeout(() => r(false), 400))])
      if (done) return
      window.__answer()
    }
  }
  window.__leaves = () => {
    const outList = []
    const clean = (t) => String(t ?? '').replace(/<TAB>.*/g, '').replace(/\t.*/, '').trim()
    const walk = (m, path) => {
      for (const k of m.children.values()) {
        if (k.props.get('visible') === false) continue
        const text = clean(k.props.get('text'))
        if (!text || text === '-') continue
        const p = path ? `${path} | ${text}` : text
        if (k.children.size) walk(k, p)
        else outList.push({ path: p, enabled: k.props.get('enabled') !== false })
      }
    }
    const menu = window.rt.windowInstances.get('w_main')?.props.get('menuid')
    if (menu) walk(menu, '')
    return outList
  }
  // what a reviewer looks for in the front window
  window.__audit = () => {
    const issues = []
    const wins = [...document.querySelectorAll('.pbwin')].filter((w) => w.offsetParent !== null && w.dataset.win !== 'w_main')
    const vw = innerWidth, vh = innerHeight
    const label = (el) => (el.getAttribute('data-obj') || el.getAttribute('data-name') || el.getAttribute('aria-label') || el.className || el.tagName).toString().slice(0, 40)
    const visible = (el) => { const s = getComputedStyle(el); const r = el.getBoundingClientRect(); return s.visibility !== 'hidden' && s.display !== 'none' && r.width > 0 && r.height > 0 && el.offsetParent !== null }
    const clippedBy = (el) => {
      // the nearest ancestor that cuts the element off without offering a scroll bar
      const r = el.getBoundingClientRect()
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        const s = getComputedStyle(p)
        const cut = (v) => v === 'hidden' || v === 'clip'
        const scrolls = (v) => v === 'auto' || v === 'scroll'
        const pr = p.getBoundingClientRect()
        if (cut(s.overflowX) && (r.right > pr.right + 2 || r.left < pr.left - 2)) return p
        if (cut(s.overflowY) && (r.bottom > pr.bottom + 2 || r.top < pr.top - 2)) return p
        if (scrolls(s.overflowX) || scrolls(s.overflowY)) return null
      }
      return null
    }
    for (const w of wins) {
      const name = w.dataset.win
      const wr = w.getBoundingClientRect()
      if (wr.right > vw + 2 || wr.bottom > vh + 2 || wr.left < -2 || wr.top < -2) issues.push(`${name}: window outside the viewport (${Math.round(wr.left)},${Math.round(wr.top)} ${Math.round(wr.width)}x${Math.round(wr.height)})`)
      const texts = [...w.querySelectorAll('label, button, .st, span, legend, th, h1, h2, h3, [role=tab], .cap, .caption')].filter(visible)
      const seen = new Set()
      for (const el of texts) {
        const t = (el.textContent || '').trim()
        if (!t || el.children.length > 0 && el.tagName !== 'BUTTON') continue
        const s = getComputedStyle(el)
        // visually hidden captions (kept for screen readers) are not on screen
        if (el.clientWidth <= 2 || el.clientHeight <= 2 || parseFloat(s.fontSize) < 1 || s.clip === 'rect(0px, 0px, 0px, 0px)') continue
        if ((s.overflow === 'hidden' || s.overflowX === 'hidden' || s.textOverflow === 'ellipsis') && el.scrollWidth > el.clientWidth + 1) {
          const key = `clip:${t.slice(0, 30)}`
          if (!seen.has(key)) { seen.add(key); issues.push(`${name}: caption cut "${t.slice(0, 50)}" (${el.clientWidth}/${el.scrollWidth}px)`) }
        }
        if (el.scrollHeight > el.clientHeight + 3 && s.overflowY === 'hidden' && el.clientHeight > 0 && el.clientHeight < 40) {
          const key = `clipv:${t.slice(0, 30)}`
          if (!seen.has(key)) { seen.add(key); issues.push(`${name}: caption cut vertically "${t.slice(0, 50)}" (${el.clientHeight}/${el.scrollHeight}px)`) }
        }
        const fs = parseFloat(s.fontSize)
        if (fs < 10.5) { const key = `font:${Math.round(fs)}`; if (!seen.has(key)) { seen.add(key); issues.push(`${name}: ${fs}px text "${t.slice(0, 30)}"`) } }
      }
      const controls = [...w.querySelectorAll('input, select, textarea, button, .dw, [role=combobox], [role=listbox]')].filter(visible)
      for (const el of controls) {
        const cut = clippedBy(el)
        if (cut) issues.push(`${name}: ${el.tagName.toLowerCase()} ${label(el)} cut off by ${label(cut)}`)
        const r = el.getBoundingClientRect()
        if ((el.tagName === 'INPUT' || el.tagName === 'SELECT') && el.type !== 'checkbox' && el.type !== 'radio' && (r.width < 14 || r.height < 12)) issues.push(`${name}: ${el.tagName.toLowerCase()} ${label(el)} is ${Math.round(r.width)}x${Math.round(r.height)}px`)
      }
      // overlapping form controls and captions (siblings that sit on top of each other)
      const boxes = [...w.querySelectorAll('input, select, textarea, button, label, .st')].filter((el) => visible(el) && !el.closest('.dw .band.row') && !el.closest('[role=menu]'))
      const rects = boxes.map((el) => ({ el, r: el.getBoundingClientRect() }))
      let overlaps = 0
      for (let i = 0; i < rects.length && overlaps < 6; i++) for (let j = i + 1; j < rects.length && overlaps < 6; j++) {
        const a = rects[i], b = rects[j]
        if (a.el.contains(b.el) || b.el.contains(a.el)) continue
        const ox = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left), oy = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top)
        if (ox > 6 && oy > 6) { overlaps++; issues.push(`${name}: overlap ${a.el.tagName.toLowerCase()} "${(a.el.textContent || a.el.value || label(a.el)).trim().slice(0, 24)}" x ${b.el.tagName.toLowerCase()} "${(b.el.textContent || b.el.value || label(b.el)).trim().slice(0, 24)}" (${Math.round(ox)}x${Math.round(oy)})`) }
      }
      const mode = w.classList.contains('presentation-window') || w.querySelector('.presentation-window, .modern-window, [data-surface]') ? 'modern' : 'compat'
      issues.unshift(`${name}: [${mode}] ${Math.round(wr.width)}x${Math.round(wr.height)} "${(w.querySelector('.ttl, .title, header')?.textContent || '').trim().slice(0, 60)}"`)
    }
    return issues
  }
})

const settle = async (rounds = 16) => {
  // the page is taken as settled when two readings in a row are the same (a second dialog of a report may follow the first)
  let prev = '', same = 0
  for (let i = 0; i < rounds && same < 2; i++) {
    const h = await page.evaluate(() => document.body.innerHTML.length + ':' + document.querySelectorAll('.pbwin').length).catch(() => '')
    same = h === prev ? same + 1 : 0
    prev = h
    await page.waitForTimeout(450)
  }
}
const closeAll = async () => page.evaluate(async () => {
  for (let i = 0; i < 5; i++) {
    window.__answer()
    document.querySelectorAll('.pbwin:not(.sheet) button').forEach((b) => { if (/^(cancel|close|exit)$/i.test(b.textContent.trim())) b.click() })
    await new Promise((r) => setTimeout(r, 200))
    for (const [n, w] of [...window.rt.windowInstances]) if (n !== 'w_main') { try { await Promise.race([window.closeLikeUser ? window.closeLikeUser(w) : window.rt.closeWindow(w), new Promise((r) => setTimeout(r, 3000))]) } catch { /* next */ } }
    await new Promise((r) => setTimeout(r, 150))
    if ([...window.rt.windowInstances.keys()].filter((n) => n !== 'w_main').length === 0 && !document.querySelector('.msgbox, .presentation-runtime-dialog[open]')) break
  }
  return [...window.rt.windowInstances.keys()].filter((n) => n !== 'w_main')
}).catch((e) => ['close failed: ' + e])

await page.screenshot({ path: `${out}/000-home.png` })
const leaves = await page.evaluate(() => window.__leaves())
const skip = /(^|\| )(E&?xit|Exit|Change User|Log ?off|Backup|Restore|Check Database|Import|Inplace|Initializ|Lock Item|Year End|Close Year|Delete|Purge|Recalculate|Rebuild|Post All|Re-?post|Synchron|Transfer Data|Upload|Download|Send )/i
const todo = leaves.filter((l) => l.enabled && !skip.test(l.path.replace(/&/g, '')) && (!filter || filter.test(l.path.replace(/&/g, ''))))
console.log(`menu: ${leaves.length} leaves, ${leaves.filter((l) => !l.enabled).length} disabled, ${todo.length} to open`)
writeFileSync(`${out}/leaves.json`, JSON.stringify(leaves, null, 1))

const report = []
let n = 0
for (const leaf of todo) {
  n++
  // QA_FROM=n resumes a long walk at its n-th item (numbering unchanged)
  if (n < Number(process.env.QA_FROM ?? 0)) continue
  current = leaf.path
  const id = String(n).padStart(3, '0') + '-' + leaf.path.replace(/&/g, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 90)
  await page.evaluate(() => { window.__boxes.length = 0 })
  const before = errors.length
  const t0 = Date.now()
  const res = await page.evaluate(async (pa) => {
    try { return String(await Promise.race([window.__menu(pa), new Promise((r) => setTimeout(() => r('timeout'), 3500))])) } catch (e) { return 'error ' + (e?.message ?? e) }
  }, leaf.path)
  await settle()
  const ms = Date.now() - t0
  await page.screenshot({ path: `${out}/${id}.png`, timeout: 60000 }).catch((e) => console.log('  screenshot failed: ' + String(e?.message ?? e).split('\n')[0]))
  // QA_RUN=1: a report is run as a user would: "All" ticked where a selection list offers it, then Ok on every dialog in turn
  // (format choice, criteria, column criteria ...) until the preview shows; a message box on the way is recorded and answered.
  if (process.env.QA_RUN === '1' && /^&?Reports/.test(leaf.path)) {
    const steps = []
    for (let i = 0; i < 7; i++) {
      const did = await page.evaluate(() => {
        const visible = (el) => el && el.offsetParent !== null
        const box = [...document.querySelectorAll('.msgbox, .presentation-runtime-dialog[open]')].find(visible)
        if (box) { const t = box.innerText.replace(/\s+/g, ' ').slice(0, 160); window.__answer(); return 'box: ' + t }
        const dialogs = [...document.querySelectorAll('dialog[open] .pbwin, .pbwin:not(.sheet)')].filter((w) => visible(w) && w.dataset.win !== 'w_main')
        const win = dialogs.at(-1)
        if (!win) return ''
        for (const label of win.querySelectorAll('label')) {
          const cb = label.querySelector('input[type=checkbox]')
          if (cb && !cb.checked && !cb.disabled && /^&?all$/i.test(label.textContent.trim())) cb.click()
        }
        const ok = [...win.querySelectorAll('button')].find((b) => visible(b) && !b.disabled && /^(&?ok|o&k|retrieve|run|preview|show)$/i.test(b.textContent.replace(/\s+/g, ' ').trim()))
        if (!ok) return ''
        ok.click()
        return 'ok: ' + win.dataset.win
      }).catch((e) => 'eval failed ' + e)
      // between two dialogs (the next one opens after a round trip) there may be none for a moment: look again before stopping
      if (!did && !steps.at(-1)?.startsWith('retry')) { steps.push('retry'); await page.waitForTimeout(2500); continue }
      if (!did) break
      steps.push(did)
      await settle(10)
    }
    await page.screenshot({ path: `${out}/${id}-run.png`, timeout: 60000 }).catch((e) => console.log('  screenshot failed: ' + String(e?.message ?? e).split('\n')[0]))
    const runBoxes = await page.evaluate(() => window.__boxes.splice(0))
    const preview = await page.evaluate(() => {
      const dw = [...document.querySelectorAll('.pbwin.sheet .dw')].find((d) => d.offsetParent !== null)
      return dw ? (dw.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 120) : '(no visible report)'
    }).catch(() => '')
    console.log(`  run: ${steps.join(' > ')} | boxes=${runBoxes.join(' / ').slice(0, 300)} | preview: ${preview}`)
    report.push({ id: id + '-run', path: leaf.path, steps, boxes: runBoxes, preview, errors: errors.slice(before).map((e) => e.text) })
  }
  const audit = await page.evaluate(() => window.__audit()).catch((e) => ['audit failed: ' + e])
  const boxes = await page.evaluate(() => window.__boxes.splice(0))
  const open = await page.evaluate(() => [...window.rt.windowInstances.keys()].filter((x) => x !== 'w_main'))
  const left = await closeAll()
  await settle(4)
  const entry = { id, path: leaf.path, clicked: res, ms, windows: open, boxes, audit, errors: errors.slice(before).map((e) => e.text), leftOpen: left }
  report.push(entry)
  writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 1))
  console.log(`${id} ${res} ${ms}ms win=[${open.join(',')}] boxes=${boxes.length} issues=${Math.max(0, audit.length - open.length)} errors=${entry.errors.length}${left.length ? ' LEFT ' + left.join(',') : ''}`)
}
await browser.close()
console.log(`done: ${report.length} items, ${errors.length} errors`)
