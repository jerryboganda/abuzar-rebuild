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
  ui.messageBox = (title, text, ...rest) => { window.__boxes.push(`${title}: ${String(text).replace(/\s+/g, ' ').slice(0, 200)}` + (window.__boxWhere ? ` [open: ${[...window.rt.ui.views.keys()].map((w) => w.className + ':' + (w.props.get('title') || '')).join(', ')}]` : '')); return shown(title, text, ...rest) }
  window.__answer = () => {
    for (const bar of document.querySelectorAll('.msgbox .btns, .presentation-runtime-dialog[open]')) {
      const buttons = [...bar.querySelectorAll('button')]
      const b = buttons.find((x) => /^no$/i.test(x.textContent.trim())) ?? buttons.find((x) => /^cancel$/i.test(x.textContent.trim())) ?? buttons[0]
      b?.click()
    }
  }
  window.closeLikeUser = async (w) => {
    const closing = (window.rt.closeWindowByUser ?? window.rt.closeWindow)(w).catch(() => {})
    for (let i = 0; i < 4; i++) {
      const done = await Promise.race([closing.then(() => true), new Promise((r) => setTimeout(() => r(false), 400))])
      if (done) return
      window.__answer()
    }
  }
  // after a click or an entry: message boxes answered (cautiously) and windows the action opened closed again, until the screen is back
  window.__side = async () => {
    const seen = []
    for (let r = 0; r < 8; r++) {
      const box = [...document.querySelectorAll('.msgbox, .presentation-runtime-dialog[open]')].find((b) => b.offsetParent !== null || b.open)
      if (box) { seen.push('box: ' + box.innerText.replace(/\s+/g, ' ').slice(0, 120)); window.__answer(); await new Promise((res) => setTimeout(res, 500)); continue }
      const extra = [...window.rt.ui.views.keys()].filter((w) => !window.__home.has(w))
      if (!extra.length) break
      for (const w of extra.reverse()) {
        seen.push('opened ' + w.className)
        const view = window.rt.ui.views.get(w)
        const cancel = view && [...view.el.querySelectorAll('button')].find((b) => b.offsetParent && /^(cancel|close|exit)$/i.test(b.textContent.trim()))
        if (cancel) cancel.click(); else await Promise.race([window.closeLikeUser(w), new Promise((res) => setTimeout(res, 3000))])
        await new Promise((res) => setTimeout(res, 500))
      }
    }
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    return [...new Set(seen)]
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
    const textRect = (el) => {
      const range = document.createRange()
      range.selectNodeContents(el)
      const r = range.getBoundingClientRect()
      return r.width > 0 && r.height > 0 ? r : el.getBoundingClientRect()
    }
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
        // cut vertically only when the glyphs themselves run past the box (a line box taller than the text is not a cut)
        if (el.scrollHeight > el.clientHeight + 3 && s.overflowY === 'hidden' && el.clientHeight > 0 && el.clientHeight < 40 &&
          textRect(el).height > el.getBoundingClientRect().height + 2) {
          const key = `clipv:${t.slice(0, 30)}`
          if (!seen.has(key)) { seen.add(key); issues.push(`${name}: caption cut vertically "${t.slice(0, 50)}" (${el.clientHeight}/${el.scrollHeight}px)`) }
        }
        const fs = parseFloat(s.fontSize)
        // a report page keeps its printed design (exempt from the Modern rules): its small print is not a screen caption
        if (fs < 10.5 && !el.closest('.page, .dw-preview, .print-modern')) { const key = `font:${Math.round(fs)}`; if (!seen.has(key)) { seen.add(key); issues.push(`${name}: ${fs}px text "${t.slice(0, 30)}"`) } }
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
      // what is painted: a caption's text, not its (often wider) box; a control's box
      const rects = boxes.map((el) => ({ el, r: /^(INPUT|SELECT|TEXTAREA|BUTTON)$/.test(el.tagName) ? el.getBoundingClientRect() : textRect(el) }))
      const footer = (el) => el.closest('.window-actions, .ds-actions, .tbar')
      let overlaps = 0
      for (let i = 0; i < rects.length && overlaps < 6; i++) for (let j = i + 1; j < rects.length && overlaps < 6; j++) {
        const a = rects[i], b = rects[j]
        if (a.el.contains(b.el) || b.el.contains(a.el)) continue
        // a drop-down's chevron sits inside its own field by design
        if ([a.el, b.el].some((el) => el.matches('.dw-choice-toggle, .dw-choice-browse')) && a.el.parentElement === b.el.parentElement) continue
        // content scrolled under the sticky title or Ok/Cancel bar is not an overlap
        if (!!footer(a.el) !== !!footer(b.el)) continue
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
  const cancelOf = (w) => {
    const view = [...window.rt.ui.views.values()].find((v) => v.w === w)
    return view ? [...view.el.querySelectorAll('button')].find((b) => b.offsetParent && /^(cancel|close|exit)$/i.test(b.textContent.trim())) : undefined
  }
  for (let i = 0; i < 16; i++) {
    // a message box answered: the dialog under it shows its buttons only once the box has gone, so look again next round
    if (document.querySelector('.msgbox, .presentation-runtime-dialog[open]')) { window.__answer(); await new Promise((r) => setTimeout(r, 600)); continue }
    // like a user: the dialog's own Cancel (its CloseWithReturn tells the report script it was cancelled; a dialog may open the next
    // one of a chain); a window is closed directly only when it offers no Cancel (a format choice, the report sheet itself)
    let cancelled = false
    for (const [n, w] of [...window.rt.windowInstances]) {
      const cancel = n !== 'w_main' && cancelOf(w)
      if (cancel) { cancel.click(); cancelled = true }
    }
    await new Promise((r) => setTimeout(r, cancelled ? 900 : 300))
    if (cancelled || document.querySelector('.msgbox, .presentation-runtime-dialog[open]')) continue
    // the topmost dialog first (a format choice without Cancel), the sheets once no dialog is left
    const isDialog = ([n, w]) => n !== 'w_main' && ![...window.rt.ui.views.values()].find((v) => v.w === w)?.sheet
    if (![...window.rt.windowInstances].some(isDialog)) {
      // the next dialog of a chain opens after a round trip: closing the report sheet before it does ends the report script
      // half-way (its dialog closes without returning), so wait for the chain to settle first
      await new Promise((r) => setTimeout(r, 2500))
      if ([...window.rt.windowInstances].some(isDialog) || document.querySelector('.msgbox, .presentation-runtime-dialog[open]')) continue
    }
    const dialogs = [...window.rt.windowInstances].filter(isDialog)
    const order = dialogs.length ? dialogs : [...window.rt.windowInstances].filter(([n]) => n !== 'w_main')
    for (const [, w] of order.slice(-1)) { try { await Promise.race([window.closeLikeUser ? window.closeLikeUser(w) : window.rt.closeWindow(w), new Promise((r) => setTimeout(r, 3000))]) } catch { /* next */ } }
    await new Promise((r) => setTimeout(r, 150))
    if ([...window.rt.windowInstances.keys()].filter((n) => n !== 'w_main').length === 0 && !document.querySelector('.msgbox, .presentation-runtime-dialog[open]')) break
  }
  // an instance that lost its name to a second one of the same class (two w_sale) is closed through its view
  for (const w of [...window.rt.ui.views.keys()]) {
    if (w.className === 'w_main' || [...window.rt.windowInstances.values()].includes(w)) continue
    try { await Promise.race([window.closeLikeUser(w), new Promise((r) => setTimeout(r, 3000))]) } catch { /* next */ }
  }
  return [...window.rt.ui.views.keys()].map((w) => w.className).filter((n) => n !== 'w_main')
}).catch((e) => ['close failed: ' + e])

await page.screenshot({ path: `${out}/000-home.png` })
const leaves = await page.evaluate(() => window.__leaves())
const skip = /(^|\| )(E&?xit|Exit|Change User|Log ?off|Backup|Restore|Check Database|Import|Inplace|Initializ|Lock Item|Year End|Close Year|Delete(?!d)|Purge|Recalculate|Rebuild|Post All|Re-?post|Synchron|Transfer Data|Upload|Download|Send )/i
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
  await page.evaluate((w) => { window.__boxes.length = 0; window.__boxWhere = w }, process.env.QA_BOXWHERE === '1')
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
    // QA_RUN_WAIT=ms: time for a long report to retrieve and draw before it is photographed
    if (process.env.QA_RUN_WAIT) await page.waitForTimeout(Number(process.env.QA_RUN_WAIT))
    await page.screenshot({ path: `${out}/${id}-run.png`, timeout: 60000 }).catch((e) => console.log('  screenshot failed: ' + String(e?.message ?? e).split('\n')[0]))
    const runBoxes = await page.evaluate(() => window.__boxes.splice(0))
    const preview = await page.evaluate(() => {
      const dw = [...document.querySelectorAll('.pbwin.sheet .dw')].find((d) => d.offsetParent !== null)
      return dw ? (dw.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 120) : '(no visible report)'
    }).catch(() => '')
    console.log(`  run: ${steps.join(' > ')} | boxes=${runBoxes.join(' / ').slice(0, 300)} | preview: ${preview}`)
    report.push({ id: id + '-run', path: leaf.path, steps, boxes: runBoxes, preview, errors: errors.slice(before).map((e) => e.text) })
  }
  // QA_ELEMENTS=1: every button, tab, check box, radio button and drop-down toggle of the screen is clicked in turn; after each click
  // the errors and message boxes are recorded and any dialog the click opened is closed again (Save/Delete/Post/Print/Close are not
  // clicked: they write data, print or end the screen)
  const clicks = []
  if (process.env.QA_ELEMENTS === '1' && !/^&?Reports/.test(leaf.path)) {
    // window objects, not names: two instances of one class (Cash Sale's Card button opens Credit Sale, both w_sale) share a name
    const home = await page.evaluate(() => { window.__home = new Set(window.rt.ui.views.keys()); return window.__home.size })
    const count = await page.evaluate(() => {
      const vis = (el) => el.offsetParent !== null && el.getBoundingClientRect().width > 0
      const w = [...document.querySelectorAll('.pbwin')].filter((x) => vis(x) && x.dataset.win !== 'w_main').at(-1)
      if (!w) return 0
      // the screen's own command bar (New, Add item, First ... Last, List) sits in the workspace header, outside the window
      const els = [...w.querySelectorAll('button, [role=tab], input[type=checkbox], input[type=radio], .dw-choice-toggle, summary, [role=button]'), ...document.querySelectorAll('.toolbar .tb')].filter(vis)
      els.forEach((e, i) => { e.dataset.qaI = String(i) })
      return els.length
    })
    const skipEl = /^(save|delete|del|post|unpost|exit|close|quit|print|remove|log ?off|ok|×|x|✕)$|^(save|delete|post|print|close|exit)\b/i
    // QA_WRITE=1 (scratch database only): Save, Delete, Post and Print are clicked too; their questions get the cautious answer (No / Cancel)
    const skipWrite = /^(exit|close|quit|log ?off|ok|×|x|✕)$|^(close|exit)\b/i
    for (let i = 0; i < Math.min(count, 120); i++) {
      const name = await page.evaluate((k) => {
        const el = document.querySelector(`[data-qa-i="${k}"]`)
        if (!el || el.offsetParent === null || el.disabled) return null
        return (el.getAttribute('aria-label') || el.title || el.textContent || el.value || el.className).replace(/&/g, '').replace(/\s+/g, ' ').trim().slice(0, 40) || el.tagName
      }, i).catch(() => null)
      if (name === null || (process.env.QA_WRITE === '1' ? skipWrite : skipEl).test(name) || (process.env.QA_SKIP && new RegExp(process.env.QA_SKIP, 'i').test(name))) continue
      const e0 = errors.length
      current = `${leaf.path} > ${name}`
      if (process.env.QA_TRACE) console.log('  . click ' + name)
      await page.evaluate((k) => document.querySelector(`[data-qa-i="${k}"]`)?.click(), i).catch(() => {})
      await settle(6)
      const side = await page.evaluate(() => window.__side()).catch((e) => ['side failed ' + e])
      clicks.push({ el: name, side, errors: errors.slice(e0).map((e) => e.text) })
      const alive = await page.evaluate(() => [...window.__home].every((w) => window.rt.ui.views.has(w))).catch(() => false)
      if (!alive) { clicks.push({ el: '(screen closed by ' + name + ')', side: [], errors: [] }); break }
    }
    current = leaf.path
    const bad = clicks.filter((c) => c.errors.length)
    console.log(`  elements: ${clicks.length} clicked, ${bad.length} with errors${bad.length ? ': ' + bad.map((c) => c.el + ' -> ' + c.errors[0]).join(' / ').slice(0, 400) : ''}`)
  }
  // QA_FIELDS=1: every editable field and DataWindow cell of the screen is clicked like a user would (mouse), a value is typed
  // (a date for date fields, "1" otherwise) and Tab is pressed; errors, message boxes and opened windows are recorded and undone
  const entries = []
  if (process.env.QA_FIELDS === '1' && !/^&?Reports/.test(leaf.path)) {
    await page.evaluate(() => { window.__home = new Set(window.rt.ui.views.keys()) })
    const tagFields = () => page.evaluate(() => {
      const vis = (el) => el.offsetParent !== null && el.getBoundingClientRect().width > 4 && el.getBoundingClientRect().height > 4
      const w = [...document.querySelectorAll('.pbwin')].filter((x) => vis(x) && x.dataset.win !== 'w_main').at(-1)
      if (!w) return []
      const els = [...w.querySelectorAll('input:not([type=checkbox]):not([type=radio]):not([type=hidden]):not([readonly]):not([disabled]), textarea:not([readonly]), select:not([disabled]), .o-column.editable')].filter(vis)
      // one cell per column of a grid: its first row
      const seen = new Set()
      const list = []
      for (const e of els) {
        const key = (e.dataset.obj || e.closest('[data-field]')?.dataset.field || e.getAttribute('aria-label') || e.name || e.placeholder || '') + '|' + (e.closest('.dw')?.dataset.obj ?? e.closest('.ctl')?.dataset.obj ?? '')
        if (e.classList.contains('o-column') && seen.has(key)) continue
        seen.add(key)
        list.push(e)
      }
      document.querySelectorAll('[data-qa-f]').forEach((e) => e.removeAttribute('data-qa-f'))
      return list.slice(0, 80).map((e, i) => {
        e.dataset.qaF = String(i)
        const label = (e.dataset.obj || e.closest('[data-field]')?.dataset.field || e.getAttribute('aria-label') || e.name || e.placeholder || e.closest('label')?.textContent || e.tagName).replace(/\s+/g, ' ').trim().slice(0, 40)
        const date = /date|dob|expiry|from|upto|to\b/i.test(label) || /date/i.test(e.type || '')
        return { i, label, tag: e.tagName.toLowerCase(), date }
      })
    })
    const fields = await tagFields()
    const labels = [...new Set(fields.map((f) => f.label))]
    for (const label of labels) {
      const e0 = errors.length
      current = `${leaf.path} > field ${label}`
      if (process.env.QA_TRACE) console.log('  . field ' + label)
      // the screen redraws after an entry (the tags go with the old elements): tag again and find this field by its name
      let f = (await tagFields()).find((x) => x.label === label)
      if (!f) { entries.push({ field: label, side: ['no longer shown'], errors: [] }); continue }
      let el = page.locator(`[data-qa-f="${f.i}"]`).first()
      if (!(await el.isVisible().catch(() => false))) { entries.push({ field: label, side: ['not visible'], errors: [] }); continue }
      try {
        // Tab out of the previous cell may move the focus into this one, which then turns into its editor: tag again and retry once
        const clicked = await el.click({ timeout: 1500 }).then(() => true, () => false)
        if (!clicked) {
          await page.waitForTimeout(500)
          f = (await tagFields()).find((x) => x.label === label) ?? f
          el = page.locator(`[data-qa-f="${f.i}"]`).first()
          await el.click({ timeout: 3000 })
        }
        await page.waitForTimeout(300)
        if (f.tag === 'select') await page.keyboard.press('ArrowDown')
        else await page.keyboard.type(f.date ? '01/01/2026' : '1', { delay: 20 })
        await page.keyboard.press('Tab')
      } catch (e) {
        // what is on top of the field's centre: the element that takes the click instead
        const cover = await page.evaluate((k) => {
          const el = document.querySelector(`[data-qa-f="${k}"]`)
          if (!el) return 'gone'
          const r = el.getBoundingClientRect()
          const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
          const path = []
          for (let p = top; p && path.length < 4; p = p.parentElement) path.push(p.tagName.toLowerCase() + (p.className ? '.' + String(p.className).split(' ').slice(0, 2).join('.') : '') + (p.dataset?.obj ? `[${p.dataset.obj}]` : ''))
          return `at ${[r.left, r.top, r.width, r.height].map(Math.round).join(',')} under ${path.join(' < ')}`
        }, f.i).catch(() => '')
        entries.push({ field: f.label, side: ['not clickable: ' + String(e?.message ?? e).split('\n')[0].slice(0, 120) + ' ' + cover], errors: [] })
        continue
      }
      await settle(5)
      const side = await page.evaluate(() => window.__side()).catch((e) => ['side failed ' + e])
      entries.push({ field: f.label, side, errors: errors.slice(e0).map((e) => e.text) })
      const alive = await page.evaluate(() => [...window.__home].every((w) => window.rt.ui.views.has(w))).catch(() => false)
      if (!alive) { entries.push({ field: '(screen closed after ' + f.label + ')', side: [], errors: [] }); break }
    }
    current = leaf.path
    const bad = entries.filter((c) => c.errors.length)
    console.log(`  fields: ${entries.length} typed, ${bad.length} with errors${bad.length ? ': ' + bad.map((c) => c.field + ' -> ' + c.errors[0]).join(' / ').slice(0, 400) : ''}`)
  }
  const audit = await page.evaluate(() => window.__audit()).catch((e) => ['audit failed: ' + e])
  const boxes = await page.evaluate(() => window.__boxes.splice(0))
  const open = await page.evaluate(() => [...window.rt.windowInstances.keys()].filter((x) => x !== 'w_main'))
  const left = await closeAll()
  await settle(4)
  const entry = { id, path: leaf.path, clicked: res, ms, windows: open, boxes, audit, clicks, entries, errors: errors.slice(before).map((e) => e.text), leftOpen: left }
  report.push(entry)
  writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 1))
  console.log(`${id} ${res} ${ms}ms win=[${open.join(',')}] boxes=${boxes.length} issues=${Math.max(0, audit.length - open.length)} errors=${entry.errors.length}${left.length ? ' LEFT ' + left.join(',') : ''}`)
}
// close the page like a user closing the tab (pagehide releases the server sessions), then the browser
await page.close({ runBeforeUnload: true }).catch(() => undefined)
await new Promise((resolve) => setTimeout(resolve, 1000))
await browser.close()
console.log(`done: ${report.length} items, ${errors.length} errors`)
