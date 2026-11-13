// Launch the Classic application (the original PowerBuilder look) against a live data server and drive it
// end to end the way an operator would: sign in, open the Cash Sale, pick a real item, put a quantity on it,
// save the document (the app asks for the operator's password), open the masters and print a report.
//
//   node e2e/classic-live-run.mjs <base-url> <api-token>
//
// The credentials of the operator come from the environment (APP_USER, APP_PW); nothing is written to disk.
import { chromium } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'

const base = process.argv[2] ?? 'http://localhost:5176'
const token = process.argv[3] ?? process.env.APP_TOKEN ?? ''
const user = process.env.APP_USER ?? 'ADMIN'
const pass = process.env.APP_PW ?? ''
const headed = process.env.HEADED === '1'
const tag = process.env.TAG ?? 'live'
const shots = process.env.SHOTS ?? 'C:/Users/Admin/AppData/Local/Temp/opencode/e2e'
mkdirSync(shots, { recursive: true })

const log = (...a) => console.log(...a)
const errors = []
const result = { base, user, at: new Date().toISOString() }

const browser = await chromium.launch({ headless: !headed })
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } })
page.on('pageerror', (e) => errors.push('page: ' + String(e.message ?? e).slice(0, 300)))
page.on('console', (m) => {
  if (m.type() !== 'error') return
  const t = m.text()
  if (/Failed to load resource/.test(t)) return
  errors.push('console: ' + t.slice(0, 300))
})

const answer = async (prefer = 'ok') => {
  try {
    await page.evaluate((p) => {
      for (const bar of document.querySelectorAll('.msgbox .btns, .presentation-runtime-dialog[open]')) {
        const buttons = [...bar.querySelectorAll('button')]
        const b = buttons.find((x) => new RegExp('^' + p + '$', 'i').test(x.textContent.trim())) ?? buttons[0]
        b?.click()
      }
    }, prefer)
  } catch { /* the page is busy */ }
}
const boxes = async () => page.evaluate(() => window.__boxes.slice()).catch(() => [])
const shot = async (name) => {
  await page.screenshot({ path: `${shots}/${tag}-${name}.png` })
  log('   screenshot:', `${tag}-${name}.png`)
}
const waitFor = async (fn, ms = 90000, every = 400, autoAnswer = true) => {
  const until = Date.now() + ms
  while (Date.now() < until) {
    const v = await page.evaluate(fn).catch(() => null)
    if (v) return v
    if (autoAnswer) await answer()
    await page.waitForTimeout(every)
  }
  return null
}
/** the text of the first line of a grid, the way the operator sees it */
const lineText = () => page.evaluate(() => {
  const grids = [...document.querySelectorAll('.dw')]
  const grid = grids.find((g) => (g.querySelector('.band.hdr')?.textContent ?? '').replace(/\s+/g, ' ').trim().startsWith('No.'))
  if (!grid) return null
  const row = grid.querySelector('.band.row')
  if (!row) return null
  const out = {}
  for (const c of row.querySelectorAll('[data-obj]')) out[c.getAttribute('data-obj')] = c.textContent.trim()
  return out
}).catch(() => null)

// ---- 1. sign in through the original login window -----------------------------------------------
log('1. sign in (the original login window)')
await page.goto(`${base}/?app=1&token=${encodeURIComponent(token)}`)
await page.waitForFunction(() => window.rt && window.rt.windowInstances.get('w_login1'), null, { timeout: 180000, polling: 250 })
// every message box of the application is recorded, so the run can report what the operator was told
await page.evaluate(() => {
  window.__boxes = []
  const ui = window.rt.ui
  const shown = ui.messageBox.bind(ui)
  ui.messageBox = (title, text, ...rest) => {
    window.__boxes.push(title + ': ' + String(text).replace(/\s+/g, ' ').slice(0, 200))
    return shown(title, text, ...rest)
  }
})
await page.waitForTimeout(700)
await shot('01-login')
await page.evaluate(({ u, p }) => {
  const w = window.rt.windowInstances.get('w_login1')
  const dw = w.children.get('dw_password')
  void (async () => {
    await dw.ready
    while (Number(await window.rt.callMethod(dw, 'getrow', [])) < 1) await new Promise((r) => setTimeout(r, 50))
    await window.rt.callMethod(dw, 'setitem', [1, 'login', u])
    await window.rt.callMethod(dw, 'setitem', [1, 'password', p])
    await window.rt.fire(w.children.get('cb_ok'), 'clicked', [])
  })()
}, { u: user, p: pass })
const main = await waitFor(() => (window.rt.windowInstances.get('w_main') ? {
  title: window.rt.windowInstances.get('w_main')?.props.get('title') ?? '',
  usercode: window.rt.globals.get('gl_usercode'),
} : null), 120000)
// the title is set in the Open event of the main window: read it after it has run
await page.waitForTimeout(2500)
main.title = await page.evaluate(() => window.rt.windowInstances.get('w_main')?.props.get('title') ?? '')
log('   main window:', JSON.stringify(main))
result.main = main
await page.waitForTimeout(1200)
await shot('02-main-window')

// ---- 2. the menu of the deployment -------------------------------------------------------------
log('2. the menu of the deployment')
const leaves = await page.evaluate(() => {
  const w = window.rt.windowInstances.get('w_main')
  const menu = w.children.get('imenu') ?? w.props.get('menuid') ?? w.children.get('menu')
  const out = []
  const walk = (m, path) => {
    for (const c of m.children.values()) {
      const text = String(c.props.get('text') ?? '').replace(/<TAB>/g, ' ').trim()
      if (!text) continue
      const p = path ? path + ' | ' + text : text
      if (c.children.size) walk(c, p)
      else if (c.props.get('visible') !== false && c.props.get('enabled') !== false) out.push(p)
    }
  }
  if (menu) walk(menu, '')
  return out
})
log(`   ${leaves.length} visible menu commands`)
result.menuCommands = leaves.length
result.menuSample = leaves.slice(0, 12)

// ---- 3. the Cash Sale --------------------------------------------------------------------------
log('3. Sales | Cash&Sale')
await page.evaluate(() => { void window.__menu('Sales | Cash&Sale') })
const sale = await waitFor(() => (window.rt.windowInstances.get('w_sale') ? {
  open: true,
  title: window.rt.windowInstances.get('w_sale')?.props.get('title') ?? '',
} : null), 60000)
await answer()
log('   ', JSON.stringify(sale))
result.cashSale = sale
await page.waitForTimeout(2000)
await shot('03-cash-sale')

// ---- 4. the item line --------------------------------------------------------------------------
log('4. the item line (the real catalogue of the deployment)')
const catalogue = await page.evaluate(async () => {
  const rt = window.rt
  const w = rt.windowInstances.get('w_sale')
  const findCtl = (o, name, out = []) => {
    for (const c of o.children.values()) { if (c.name === name) out.push(c); findCtl(c, name, out) }
    return out[0]
  }
  const list = findCtl(w, 'dw_itemslist')
  return {
    rows: Number(await rt.callMethod(list, 'rowcount', [])),
    icode: String(await rt.callMethod(list, 'getitemstring', [1, 'icode'])),
    name: String(await rt.callMethod(list, 'getitemstring', [1, 'itemname'])),
    price: String(await rt.callMethod(list, 'getitemstring', [1, 'saleprice'])),
  }
})
log('   the catalogue of the window:', JSON.stringify(catalogue))
result.catalogue = catalogue
// the first line of the document has to be there before the operator can type into it
await waitFor(async () => {
  const t = await lineText()
  return t && t.itemname ? t : null
}, 120000)
const picked = await page.evaluate(async (code) => {
  const grids = [...document.querySelectorAll('.dw')]
  const grid = grids.find((g) => (g.querySelector('.band.hdr')?.textContent ?? '').replace(/\s+/g, ' ').trim().startsWith('No.'))
  const cell = grid.querySelector('[data-obj=itemname]')
  if (!cell) return { error: 'the item cell was not found' }
  cell.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
  cell.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
  cell.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  await new Promise((r) => setTimeout(r, 700))
  const editor = /input|textarea/i.test(document.activeElement?.tagName ?? '') ? document.activeElement : null
  if (!editor) return { error: 'the item editor did not open' }
  editor.focus()
  editor.value = code
  editor.dispatchEvent(new Event('input', { bubbles: true }))
  editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }))
  return { typed: code }
}, catalogue.icode)
log('   the item code was typed into the line:', JSON.stringify(picked))
// the window looks the item up and fills the line
const line = await waitFor(async () => {
  const t = await lineText()
  return t && t.itemname && t.itemname !== ' ' ? t : null
}, 120000)
const footer1 = await page.evaluate(async () => {
  const rt = window.rt
  const w = rt.windowInstances.get('w_sale')
  const findCtl = (o, name, out = []) => {
    for (const c of o.children.values()) { if (c.name === name) out.push(c); findCtl(c, name, out) }
    return out[0]
  }
  const footer = findCtl(w, 'dw_footer')
  return String(await rt.callMethod(footer, 'getitemstring', [1, 'total']))
})
log('   the line:', JSON.stringify(line))
log('   the footer total:', footer1)
result.itemLine = { line, footerTotal: footer1 }
await answer()
await shot('04-cash-sale-line')

// ---- 5. the quantity ---------------------------------------------------------------------------
log('5. the quantity of the line (2)')
await page.evaluate(async () => {
  const grids = [...document.querySelectorAll('.dw')]
  const grid = grids.find((g) => (g.querySelector('.band.hdr')?.textContent ?? '').replace(/\s+/g, ' ').trim().startsWith('No.'))
  const cell = grid.querySelector('[data-obj=looseqty], [data-obj=qty]')
  if (!cell) return
  cell.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
  cell.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
  cell.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  await new Promise((r) => setTimeout(r, 600))
  const editor = /input|textarea/i.test(document.activeElement?.tagName ?? '') ? document.activeElement : null
  if (!editor) return
  editor.focus()
  editor.value = '2'
  editor.dispatchEvent(new Event('input', { bubbles: true }))
  editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }))
})
const afterQty = await waitFor(async () => {
  const t = await lineText()
  return t && t.looseqty === '2' ? t : null
}, 60000)
const footer2 = await page.evaluate(async () => {
  const rt = window.rt
  const w = rt.windowInstances.get('w_sale')
  const findCtl = (o, name, out = []) => {
    for (const c of o.children.values()) { if (c.name === name) out.push(c); findCtl(c, name, out) }
    return out[0]
  }
  const footer = findCtl(w, 'dw_footer')
  return String(await rt.callMethod(footer, 'getitemstring', [1, 'total']))
})
log('   the line after the quantity:', JSON.stringify(afterQty))
log('   the footer total:', footer2)
result.quantity = { line: afterQty, footerTotal: footer2 }
await answer()
await shot('05-cash-sale-qty')

// ---- 6. save the document ----------------------------------------------------------------------
log('6. save the document (the app asks for the operator\'s password)')
await page.evaluate(() => {
  const rt = window.rt
  const w = rt.windowInstances.get('w_sale')
  const find = (m, name) => {
    for (const c of m.children.values()) { if (c.name === name) return c; const r = find(c, name); if (r) return r }
    return null
  }
  void rt.fire(find(w.props.get('menuid'), 'm_save'), 'clicked', [])
})
let passwordAsked = false
for (let i = 0; i < 30 && !passwordAsked; i++) {
  await page.waitForTimeout(700)
  const open = await page.evaluate(() => !!window.rt.windowInstances.get('w_salesmanpassword')).catch(() => false)
  if (!open) continue
  passwordAsked = true
  await page.evaluate(async ({ pw }) => {
    const rt = window.rt
    const win = rt.windowInstances.get('w_salesmanpassword')
    const dw = win.children.get('dw_password')
    await dw.ready
    while (Number(await rt.callMethod(dw, 'getrow', [])) < 1) await new Promise((r) => setTimeout(r, 50))
    await rt.callMethod(dw, 'setitem', [1, 'salesmancode', 1])
    await rt.callMethod(dw, 'setitem', [1, 'password', pw])
    void rt.fire(win.children.get('cb_ok'), 'clicked', [])
  }, { pw: pass })
}
log('   the operator password was asked for:', passwordAsked)
await page.waitForTimeout(6000)
await answer('ok')
await page.waitForTimeout(3000)
result.save = { passwordAsked, boxes: await boxes() }
log('   ', JSON.stringify(result.save))
await shot('06-cash-sale-saved')
await page.evaluate(() => {
  const w = window.rt.windowInstances.get('w_sale')
  if (w) void window.rt.closeWindow(w).catch(() => {})
})
await page.waitForTimeout(1500)

// ---- 7. the masters ----------------------------------------------------------------------------
log('7. the masters with real data')
result.masters = []
for (const [path, name] of [['Basic Data | &Customer .......... | &Customer', 'w_customer_form'], ['Basic Data | &Item .......... | &Item', 'w_item_form']]) {
  await page.evaluate((p) => { void window.__menu(p) }, path)
  const opened = await waitFor((n) => (window.rt.windowInstances.get(n) ? { open: true } : null), 60000)
  await answer()
  await page.waitForTimeout(3000)
  const info = await page.evaluate(async (n) => {
    const w = window.rt.windowInstances.get(n)
    if (!w) return { open: false }
    const findCtl = (o, name2, out = []) => {
      for (const c of o.children.values()) { if (c.name === name2) out.push(c); findCtl(c, name2, out) }
      return out[0]
    }
    const list = findCtl(w, 'dw_list')
    const rows = list ? Number(await window.rt.callMethod(list, 'rowcount', [])) : -1
    const columns = list?.model?.colNames ?? []
    const first = list && rows > 0 ? {} : null
    if (first) for (const c of columns.slice(0, 6)) first[c] = String(await window.rt.callMethod(list, 'getitemstring', [1, c]))
    return { open: true, title: w.props.get('title') ?? '', listRows: rows, firstRow: first }
  }, name)
  // the master form opens with an empty list (the original does the same): the operator switches to the
  // list page and presses Retrieve
  await page.waitForTimeout(6000)
  const switched = await page.evaluate(() => {
    const strips = [...document.querySelectorAll('.pbwin .tabctl .strip')]
    const strip = strips.at(-1)
    const tabs = strip ? [...strip.querySelectorAll('.t')] : []
    const listTab = tabs.find((t) => /list/i.test(t.textContent.trim())) ?? tabs[1]
    listTab?.click()
    return { tabs: tabs.map((t) => t.textContent.trim()), clicked: !!listTab }
  })
  await page.waitForTimeout(1500)
  // the detail page asks whether the empty record is to be saved: the operator discards it
  await answer('no')
  await page.waitForTimeout(1500)
  // the Retrieve button of the list page
  const clicked = await page.evaluate(async () => {
    const rt = window.rt
    const w = rt.windowInstances.get('w_customer_form') ?? rt.windowInstances.get('w_item_form')
    if (!w) return false
    const findCtl = (o, name, out = []) => {
      for (const c of o.children.values()) { if (c.name === name) out.push(c); findCtl(c, name, out) }
      return out[0]
    }
    const page_ = findCtl(w, 'tabpage_list')
    const button = page_ ? findCtl(page_, 'cb_retrieve') : null
    if (!button) return false
    await rt.fire(button, 'clicked', [])
    // the button of the interface flushes the posted events (the retrieve of the list runs in one)
    await rt.flushPosted()
    await rt.flushPosted()
    return true
  })
  // the list arrives with its own retrieve (the item list of the deployment holds 28,966 rows)
  const immediate = await page.evaluate(async () => {
    const rt = window.rt
    const w = rt.windowInstances.get('w_customer_form') ?? rt.windowInstances.get('w_item_form')
    if (!w) return { none: true }
    const findCtl = (o, name2, out = []) => {
      for (const c of o.children.values()) { if (c.name === name2) out.push(c); findCtl(c, name2, out) }
      return out[0]
    }
    const list = findCtl(w, 'dw_list')
    return { model: list?.model?.rowCount?.() ?? -1, call: list ? Number(await rt.callMethod(list, 'rowcount', [])) : -1 }
  })
  log('   the list right after the Retrieve:', JSON.stringify(immediate))
  const retrieved = await waitFor(() => {
    const rt = window.rt
    const w = rt.windowInstances.get('w_customer_form') ?? rt.windowInstances.get('w_item_form')
    if (!w) return null
    const findCtl = (o, name2, out = []) => {
      for (const c of o.children.values()) { if (c.name === name2) out.push(c); findCtl(c, name2, out) }
      return out[0]
    }
    const list = findCtl(w, 'dw_list')
    const rows = list?.model?.rowCount?.() ?? -1
    return rows > 0 ? rows : null
  }, 180000, 1000, false)
  const first = await page.evaluate(async () => {
    const rt = window.rt
    const w = rt.windowInstances.get('w_customer_form') ?? rt.windowInstances.get('w_item_form')
    if (!w) return {}
    const findCtl = (o, name2, out = []) => {
      for (const c of o.children.values()) { if (c.name === name2) out.push(c); findCtl(c, name2, out) }
      return out[0]
    }
    const list = findCtl(w, 'dw_list')
    const columns = list?.model?.colNames ?? []
    const out = {}
    for (const c of ['code', 'customer_name', 'accounts_aliasname', 'itemname', 'name', 'saleprice', 'purprice', 'stock']) {
      if (!columns.includes(c)) continue
      out[c] = String(await rt.callMethod(list, 'getitemstring', [1, c]))
    }
    return out
  })
  log(`   ${path}: ${JSON.stringify({ ...info, ...switched, retrieveClicked: clicked, listRows: retrieved, firstRow: first })}`)
  result.masters.push({ path, ...info, listRows: retrieved, firstRow: first })
  await shot('07-' + name)
  await page.evaluate((n) => {
    const w = window.rt.windowInstances.get(n)
    if (w) void window.rt.closeWindow(w).catch(() => {})
  }, name)
  await page.waitForTimeout(1200)
}

// ---- 8. a report with real data ----------------------------------------------------------------
log('8. Reports | &Sales Reports | User Wise | Net Cash')
await page.evaluate(() => { void window.__menu('Reports | &Sales Reports | User Wise | Net Cash') })
await page.waitForTimeout(6000)
await answer()
await page.waitForTimeout(1500)
// the criteria of the report: the date range and the user
const criteria = await page.evaluate(async () => {
  const rt = window.rt
  const win = rt.windowInstances.get('w_arg_user_sdate_ldate')
  const inputs = [...document.querySelectorAll('.pbwin input')]
  const dates = inputs.filter((i) => /^\d{2}\/\d{2}\/\d{4}/.test(i.value))
  // the mask of the criteria window: the start date and the end date (the end date stands first in the form)
  const start = dates.find((i) => /00:00:00\s*$/.test(i.value))
  const end = dates.find((i) => /23:59:59\s*$/.test(i.value))
  const set = (input, value) => {
    if (!input) return
    input.focus()
    input.value = value
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
  }
  set(start, '01/01/2024 00:00:00')
  set(end, '31/12/2025 23:59:59')
  // the user code of the report (the criteria window keeps it in its own grid)
  const grids = []
  const walk = (o) => {
    for (const c of o.children.values()) { if (c.native === 'datawindow') grids.push(c); walk(c) }
  }
  if (win) walk(win)
  for (const g of grids) {
    const column = (g.model?.colNames ?? []).find((c) => /user|code/i.test(c))
    if (column) await rt.callMethod(g, 'setitem', [1, column, '1'])
  }
  return { open: !!win, dates: dates.map((i) => i.value) }
})
log('   the criteria:', JSON.stringify(criteria))
// the Ok of the criteria window, then the format of the report
for (let i = 0; i < 4; i++) {
  const step = await page.evaluate(() => {
    const wins = [...document.querySelectorAll('.pbwin')]
    const win = wins.at(-1)
    if (!win) return { none: true }
    const title = win.querySelector('.ttl')?.textContent ?? ''
    if (/report:/i.test(title)) return { title, done: true }
    const button = [...win.querySelectorAll('button')].find((b) => /^ok$/i.test(b.textContent.trim()))
    button?.click()
    return { title, clicked: !!button }
  })
  log('   the next step:', JSON.stringify(step))
  if (step.done || step.none) break
  await page.waitForTimeout(4000)
}
await answer('ok')
// the report reads the whole ledger: it needs a moment
await waitFor(() => {
  const w = window.rt.windowInstances.get('w_reviewreport')
  const dw = w?.children?.get('dw_report')
  const rows = dw?.model?.rowCount?.() ?? -1
  return rows > 0 ? rows : null
}, 120000, 1000, false)
const report = await page.evaluate(async () => {
  const w = window.rt.windowInstances.get('w_reviewreport')
  const dw = w?.children?.get('dw_report')
  const rows = dw ? Number(await window.rt.callMethod(dw, 'rowcount', [])) : -1
  const columns = dw?.model?.colNames ?? []
  const first = {}
  if (dw && rows > 0) for (const c of columns.slice(0, 16)) first[c] = String(await window.rt.callMethod(dw, 'getitemstring', [1, c]))
  // what the operator sees in the report window
  const win = [...document.querySelectorAll('.pbwin')].at(-1)
  const text = (win?.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 1200)
  return { open: !!w, title: w?.props.get('title') ?? '', rows, columns: columns.slice(0, 16), firstRow: first, printed: text }
})
log('   ', JSON.stringify(report))
result.report = report
await shot('08-report')

// ---- the end -----------------------------------------------------------------------------------
result.boxes = await boxes()
result.errors = errors
log('message boxes of the run:', JSON.stringify(result.boxes))
log('page/console errors:', errors.length)
for (const e of errors.slice(0, 12)) log('  ', e)
writeFileSync(`${shots}/${tag}-result.json`, JSON.stringify(result, null, 1))
log('the result file:', `${shots}/${tag}-result.json`)
if (process.env.KEEP_OPEN === '1') {
  log('the application stays open (KEEP_OPEN=1) - close the browser window to end it')
  await new Promise(() => {})
}
await browser.close()
