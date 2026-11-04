// Screen-by-screen capture of the rebuilt desktop app for parity comparison with the
// running original.  For every menu path it opens the screen through the live menu,
// dismisses non-destructive dialogs like a user (No / Cancel / OK), and writes:
//   <out>/NNN_<path>.png             screenshot of the screen
//   <out>/NNN_<path>.json            window classes, controls, menu, DataWindow model
//   <out>/NNN_<path>_s2.png/.json    after OK on each report argument / format dialog
//   <out>/screens.json               per-path outcome
//
// usage:
//   node crawl-new.mjs --base http://127.0.0.1:5177 --items <items.json> --out <dir>
//                       [--login user:pass | --login-file <local ps1>] [--only TEXT]
//
// The capture is read-only: it never presses Save / Delete / Print / Post / Yes.
import { createRequire } from 'node:module'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(process.env.PLAYWRIGHT_MODULES || 'C:/Users/Admin/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/')
const { chromium } = require('playwright')

function arg(name, fallback) {
  const i = process.argv.indexOf(name)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}
const BASE = arg('--base', 'http://127.0.0.1:5177')
const ITEMS = arg('--items', '')
const OUT = arg('--out', join(process.cwd(), 'screen-parity', 'new'))
const ONLY = arg('--only', '')
const LIMIT = Number(arg('--limit', '0'))
const SETTLE = Number(arg('--settle', '2500'))
const OPEN_TIMEOUT = Number(arg('--open-timeout', '20000'))
const CLOSE_TIMEOUT = Number(arg('--close-timeout', '8000'))
const VIEWPORT = { width: 1920, height: 1080 }

function loginFromFile(path) {
  const src = readFileSync(path, 'utf8')
  const user = (src.match(/\$User\s*=\s*'([^']*)'/) || [])[1] || 'ADMIN'
  const pass = (src.match(/\$Pass\s*=\s*'([^']*)'/) || [])[1]
  if (!pass) throw new Error('no password in local login script: ' + path)
  return user + ':' + pass
}
const LOGIN_ARG = arg('--login', '')
const LOGIN_FILE = arg('--login-file', 'C:/Projects/Abuzar/deploy/parity/login-trader.ps1')
const LOGIN = LOGIN_ARG || loginFromFile(LOGIN_FILE)
const LOGIN_URL = `${BASE}/?app=1&autologin=${encodeURIComponent(LOGIN.split(':')[0])}:${encodeURIComponent(LOGIN.split(':').slice(1).join(':'))}`

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const clean = (t) => String(t ?? '').replace(/<TAB>/g, ' ').replace(/&/g, '').replace(/\s+/g, ' ').trim()
function slug(s, max = 100) {
  return String(s ?? '').replace(/&/g, '').replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ').replace(/\s+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '').slice(0, max) || 'screen'
}

// ---------------------------------------------------------------- page helpers
const installHelpers = () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const clean = (t) => String(t ?? '').replace(/<TAB>/g, ' ').replace(/&/g, '').replace(/\s+/g, ' ').trim()
  const norm = (t) => clean(t).toLowerCase()
  const modalInfo = (box) => ({
    title: (box.querySelector('.ttl')?.textContent || '').replace(/\s+/g, ' ').trim(),
    text: (box.querySelector('.txt')?.textContent || '').replace(/\r\n/g, '\n').replace(/\s+/g, ' ').trim(),
    buttons: [...box.querySelectorAll('.btns button')].map((b) => clean(b.textContent)),
  })
  const seen = new WeakSet()
  const log = []
  const safeClickBoxes = () => {
    const fresh = []
    for (const box of [...document.querySelectorAll('.msgbox')]) {
      const info = modalInfo(box)
      const buttons = [...box.querySelectorAll('.btns button')]
      if (!buttons.length) continue
      const order = ['no', 'cancel', 'close', 'abort', 'ignore', 'ok']
      let pick = null
      for (const name of order) { pick = buttons.find((b) => norm(b.textContent) === name); if (pick) break }
      if (!pick) pick = buttons[0]
      if (!seen.has(box)) { seen.add(box); log.push({ ...info, chosen: clean(pick.textContent) }); fresh.push(info) }
      try { pick.click() } catch { /* gone */ }
    }
    return fresh
  }
  const winInfo = (w) => ({
    class: w.className,
    native: w.native,
    title: String(w.props.get('title') ?? ''),
    type: w.props.get('windowtype') ?? null,
    visible: w.props.get('visible') !== false,
    enabled: w.props.get('enabled') !== false,
    x: Number(w.props.get('x') ?? 0), y: Number(w.props.get('y') ?? 0),
    w: Number(w.props.get('width') ?? 0), h: Number(w.props.get('height') ?? 0),
    menuid: w.props.get('menuid') ? true : false,
  })
  const dumpControl = (c) => {
    const o = {
      name: c.name,
      class: c.className,
      native: c.native,
      text: String(c.props.get('text') ?? ''),
      visible: c.props.get('visible') !== false,
      enabled: c.props.get('enabled') !== false,
      x: Number(c.props.get('x') ?? 0), y: Number(c.props.get('y') ?? 0),
      w: Number(c.props.get('width') ?? 0), h: Number(c.props.get('height') ?? 0),
      taborder: Number(c.props.get('taborder') ?? 0),
      dataobject: typeof c.props.get('dataobject') === 'string' ? c.props.get('dataobject') : undefined,
      children: [...c.children.values()].map(dumpControl),
    }
    if (c.native === 'datawindow' || c.native === 'datastore') {
      const m = c.model
      if (m) {
        o.rows = m.rowCount()
        o.dw = {
          name: m.def?.name ?? '',
          table: m.def?.table?.name ?? '',
          columns: (m.def?.table?.columns ?? []).map((x) => ({ name: x.name, type: x.type, dbname: x.dbname ?? '', update: !!x.update })),
          objects: (m.def?.objects ?? []).map((x) => ({ name: x.name, type: x.type, band: x.band, visible: x.props?.visible !== false && x.visible !== false, x: x.x ?? x.props?.x, y: x.y ?? x.props?.y, w: x.width ?? x.props?.width, h: x.height ?? x.props?.height, text: x.text ?? x.props?.text ?? '' })),
        }
      }
    }
    return o
  }
  const dumpWindow = (w) => {
    const view = window.rt.ui && window.rt.ui.views ? window.rt.ui.views.get(w) : null
    const root = view && view.el
    const domCtl = root ? [...root.querySelectorAll('.ctl, .dw')].map((e) => ({
      tag: e.tagName, cls: e.className, text: clean(e.textContent).slice(0, 120),
      visible: !!(e.offsetWidth || e.offsetHeight || e.getClientRects().length),
      x: Math.round(e.getBoundingClientRect().x), y: Math.round(e.getBoundingClientRect().y),
      w: Math.round(e.getBoundingClientRect().width), h: Math.round(e.getBoundingClientRect().height),
    })) : []
    const dwViews = []
    if (view && view.ctlViews) {
      for (const [c, cv] of view.ctlViews) {
        if (cv.dw) {
          const m = c.model
          dwViews.push({
            control: c.name, dataobject: typeof c.props.get('dataobject') === 'string' ? c.props.get('dataobject') : '',
            rows: m ? m.rowCount() : 0,
            rendered: cv.dw.root ? cv.dw.root.querySelectorAll('[data-obj]').length : 0,
            objects: cv.dw.root ? [...cv.dw.root.querySelectorAll('[data-obj]')].slice(0, 500).map((e) => ({ obj: e.dataset.obj, text: clean(e.textContent).slice(0, 80), cls: e.className })) : [],
          })
        }
      }
    }
    return {
      ...winInfo(w),
      controls: [...w.children.values()].map(dumpControl),
      domControls: domCtl,
      datawindows: dwViews,
      bodyText: (root ? root.innerText : document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 800),
    }
  }
  const clickMenuOn = async (w, path) => {
    let m = w.props.get('menuid')
    for (const part of String(path).split(' | ')) {
      const want = norm(part)
      const kids = m ? [...m.children.values()] : []
      const hit = kids.find((k) => norm(k.props.get('text')) === want && k.props.get('visible') !== false) || kids.find((k) => norm(k.props.get('text')).startsWith(want) && k.props.get('visible') !== false)
      if (!hit) return false
      m = hit
      if (!hit.children.size) { await window.rt.fire(hit, 'selected'); await window.rt.fire(hit, 'clicked'); return true }
      await window.rt.fire(hit, 'selected')
    }
    return false
  }
  window.__parity = {
    clean,
    safeClickBoxes,
    takeLog() { const x = log.slice(); log.length = 0; return x },
    state() {
      const rt = window.rt
      return { wins: [...rt.windowInstances.entries()].map(([k, w]) => ({ key: k, ...winInfo(w) })), boxes: [...document.querySelectorAll('.msgbox')].map(modalInfo) }
    },
    async waitBoxes(ms = 4000) {
      const end = Date.now() + ms
      while (Date.now() < end) { this.safeClickBoxes(); await sleep(120) }
      return this.takeLog()
    },
    async closeAll(perWindowMs = 7000) {
      const rt = window.rt
      const targets = [...rt.windowInstances.entries()].filter(([name]) => name !== 'w_main')
      const isModal = (w) => Number(w.props.get('windowtype') ?? 0) === 3
      targets.sort((a, b) => (isModal(a[1]) ? 0 : 1) - (isModal(b[1]) ? 0 : 1))
      for (const [, w] of targets) {
        const p = rt.closeWindow(w).then(() => 'closed').catch((e) => 'error:' + String(e.message || e))
        let done = false
        const end = Date.now() + perWindowMs
        while (!done && Date.now() < end) {
          const r = await Promise.race([p.then((x) => ({ x })), sleep(200).then(() => null)])
          if (r) { done = true; break }
          this.safeClickBoxes()
        }
        if (!done) { try { await Promise.race([p, sleep(1000)]) } catch { /* */ } }
        this.safeClickBoxes()
      }
      return [...rt.windowInstances.keys()].filter((n) => n !== 'w_main')
    },
    dumpResult(w) { return dumpWindow(w) },
    clickMenuOn,
  }
}

// ---------------------------------------------------------------- node
mkdirSync(OUT, { recursive: true })
const allPaths = ITEMS
  ? JSON.parse(readFileSync(ITEMS, 'utf8').replace(/^\uFEFF/, '')).map((x) => (typeof x === 'string' ? x : x.path)).filter(Boolean)
  : []
const paths = allPaths.filter((p) => !ONLY || p.includes(ONLY)).slice(0, LIMIT || undefined)
if (!paths.length) throw new Error('no menu paths: pass --items with a JSON array of paths or {path} objects')

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: VIEWPORT, screen: VIEWPORT })
const events = []
page.on('pageerror', (e) => events.push({ type: 'pageerror', text: String(e.message || e).slice(0, 500) }))
page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) events.push({ type: 'console', text: m.text().slice(0, 500) }) })
await page.addInitScript(installHelpers)
await page.goto(LOGIN_URL, { waitUntil: 'load', timeout: 120000 })
await page.waitForFunction(() => window.rt && window.rt.windowInstances.get('w_main') && window.__parity, null, { timeout: 180000, polling: 500 })
await page.waitForTimeout(1200)
await page.evaluate(() => window.__parity.waitBoxes(1500))

const rows = []
for (let i = 0; i < paths.length; i++) {
  const path = paths[i]
  const name = `${String(i + 1).padStart(3, '0')}_${slug(path)}`
  const before = new Set(await page.evaluate(() => [...window.rt.windowInstances.keys()]))
  const t0 = Date.now()
  await page.evaluate(() => { window.rt.missing.clear(); window.__missingStart = window.rt.recent.length })
  const opened = await page.evaluate(async ({ p, timeout }) => {
    try {
      const r = await Promise.race([window.__menu(p).then((v) => ({ v })), new Promise((res) => setTimeout(() => res({ timeout: true }), timeout))])
      return r
    } catch (e) { return { error: String(e.message || e) } }
  }, { p: path, timeout: OPEN_TIMEOUT })
  // let the screen settle and answer non-destructive dialogs
  const seen = new Set()
  for (let k = 0; k < 12; k++) {
    const st = await page.evaluate(() => window.__parity.state())
    for (const w of st.wins) if (!before.has(w.key)) seen.add(w.key)
    const fresh = await page.evaluate(() => window.__parity.safeClickBoxes())
    if (fresh.length) continue
    await page.waitForTimeout(350)
    const st2 = await page.evaluate(() => window.__parity.state())
    if (st2.wins.length === st.wins.length && st2.boxes.length === 0) break
  }
  await page.waitForTimeout(SETTLE)
  await page.evaluate(() => window.__parity.waitBoxes(4000))
  const result = await page.evaluate(({ keys }) => {
    const out = []
    for (const [k, w] of window.rt.windowInstances.entries()) {
      if (k === 'w_main') continue
      if (keys.length && !keys.includes(k)) continue
      try { out.push({ key: k, ...window.__parity.dumpResult(w) }) } catch (e) { out.push({ key: k, error: String(e.message || e) }) }
    }
    return out
  }, { keys: [...seen] })
  const missing = await page.evaluate(() => {
    const rt = window.rt
    const recent = rt.recent.slice(window.__missingStart || -12).map(([o, r]) => `${o.className}.${rt.routineName(o, r)}`)
    const m = Object.fromEntries([...rt.missing.entries()])
    rt.missing.clear()
    return { calls: m, recent: recent.slice(-12) }
  })
  await page.screenshot({ path: join(OUT, name + '.png'), timeout: 20000 }).catch(() => {})
  writeFileSync(join(OUT, name + '.json'), JSON.stringify({ path, opened, windows: result, missing, events: events.splice(0) }, null, 1))

  // report dialogs: press OK on each one, take the next state (format / arguments / final report)
  if (path.startsWith('Reports')) {
    for (let step = 2; step <= 4; step++) {
      const pressed = await page.evaluate(() => {
        for (const w of [...document.querySelectorAll('.pbwin:not(.sheet)')].reverse()) {
          const b = [...w.querySelectorAll('button')].find((x) => /^ok$/i.test(x.textContent.trim()) && !x.disabled)
          if (b) { b.click(); return true }
        }
        return false
      })
      if (!pressed) break
      for (let k = 0; k < 10; k++) { await page.evaluate(() => window.__parity.safeClickBoxes()); await page.waitForTimeout(350) }
      const res2 = await page.evaluate(() => {
        const out = []
        for (const [k, w] of window.rt.windowInstances.entries()) if (k !== 'w_main') { try { out.push({ key: k, ...window.__parity.dumpResult(w) }) } catch (e) { out.push({ key: k, error: String(e.message || e) }) } }
        return out
      })
      const miss2 = await page.evaluate(() => Object.fromEntries([...window.rt.missing.entries()]))
      await page.screenshot({ path: join(OUT, `${name}_s${step}.png`), timeout: 20000 }).catch(() => {})
      writeFileSync(join(OUT, `${name}_s${step}.json`), JSON.stringify({ path, step, windows: res2, missing: miss2, events: events.splice(0) }, null, 1))
      await page.evaluate(() => window.rt.missing.clear())
    }
  }
  const remaining = await page.evaluate(() => window.__parity.closeAll())
  const sheet = result.find((w) => w.menuid) || result[0]
  rows.push({ n: i + 1, path, opened, windows: result.map((w) => ({ key: w.key, class: w.class, title: w.title, rows: (w.datawindows || []).map((d) => d.rows) })), missing: missing.calls, recent: missing.recent, remaining, ms: Date.now() - t0 })
  console.log(`${i + 1}/${paths.length} ${opened && opened.timeout ? 'TIMEOUT ' : ''}${JSON.stringify(result.map((w) => w.class))} ${path} (${Date.now() - t0} ms)${remaining.length ? ' LEFTOVER ' + remaining.join(',') : ''}`)
  if (remaining.length) {
    await page.evaluate(() => window.__parity.closeAll())
    await page.waitForTimeout(1000)
  }
}
writeFileSync(join(OUT, 'screens.json'), JSON.stringify(rows, null, 1))
await browser.close()
console.log(`done: ${rows.length} screens -> ${OUT}`)
