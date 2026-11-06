// Targeted field wiring probe for the two sale entry screens, which the
// generic screen audit reported with 0 fields (they need a live customer and
// item row before the grids render their editors).
//
// For Cash Sale and Credit Sale:
//   1. open through the real menu,
//   2. create the header row (Credit) / use the inserted row (Cash),
//   3. select customer 19/22 and item 9801 through the real item list,
//   4. type into every rendered editable cell of the master, detail and footer
//      DataWindows and read the value back from the model,
//   5. check the footer total reacts to qty/price/discount edits,
//   6. close the page without Save.
//
// It is read-only: the browser is closed without calling ue_save, so no
// transaction reaches PostgreSQL.
import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync } from 'node:fs'
const require = createRequire(process.env.PLAYWRIGHT_MODULES || 'C:/Users/Admin/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/')
const { chromium } = require('playwright')
const OUT = process.env.OUT || 'C:/Projects/Abuzar/deploy/parity/sale-fields'
mkdirSync(OUT, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const SCREENS = [
  { kind: 'cash', path: 'Sales | CashSale', customer: 19 },
  { kind: 'credit', path: 'Sales | Credit Sale', customer: 22 },
]

// fields whose value is a lookup / key and must stay as selected through the UI
const LOOKUP = new Set(['custcode', 'itemname', 'icode', 'fullcode', 'gcode', 'batch', 'expiry', 'gccode', 'headerno', 'acccode', 'aliasname'])

function valueFor(type) {
  const t = String(type || '').toLowerCase()
  if (t === 'date') return '06/11/2026'
  if (t === 'datetime') return '06/11/2026 10:00:00'
  if (t === 'time') return '10:00:00'
  if (t.startsWith('char') || t === 'string') return 'PARITY'
  if (/^(decimal|numeric|real|double|long|ulong|integer|int|uint|smallint|boolean|number)/.test(t)) return '1'
  return 'PARITY'
}

async function drain(page) {
  const texts = []
  for (let i = 0; i < 10; i++) {
    const t = await page.evaluate(() => {
      const b = document.querySelector('.msgbox')
      if (!b) return null
      const text = (b.querySelector('.txt')?.textContent || '').replace(/\s+/g, ' ').trim()
      const bs = [...b.querySelectorAll('.btns button')]
      ;(bs.find((x) => /^(ok|yes|no|cancel)$/i.test(x.textContent.trim())) || bs[0])?.click()
      return text
    })
    if (t === null) break
    texts.push(t)
    await sleep(150)
  }
  return texts
}

const browser = await chromium.launch()
const results = []
try {
  for (const s of SCREENS) {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } })
    page.setDefaultTimeout(15000)
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e.message || e).slice(0, 400)))
    const out = { kind: s.kind, path: s.path, customer: s.customer, fields: [], totals: {}, messages: [], errors }
    try {
      await page.goto('http://127.0.0.1:5177/?app=1&autologin=ADMIN:password9080', { waitUntil: 'load', timeout: 60000 })
      await page.waitForFunction(() => window.rt && window.rt.windowInstances.get('w_main') && typeof window.__menu === 'function', null, { timeout: 90000, polling: 300 })
      await page.evaluate((p) => { void window.__menu(p) }, s.path)
      await page.waitForFunction(() => window.rt.windowInstances.get('w_sale'), null, { timeout: 30000, polling: 300 })
      await sleep(1800)
      out.open = await page.evaluate(async ({ kind, customer }) => {
        const rt = window.rt
        const w = rt.windowInstances.get('w_sale')
        if (kind === 'credit') await w.pbCall('ue_newform', [], rt).catch(() => {})
        await new Promise((r) => setTimeout(r, 1200))
        const m = w.props.get('id_master')
        const d = w.props.get('id_detail')
        await m.pbCall('setitem', [1, 'custcode', customer], rt).catch(() => {})
        await m.pbCall('accepttext', [], rt).catch(() => {})
        // Do not synthesise itemchanged: it runs wf_setcustomerinfo without
        // the editor's data payload and logs a spurious validation box.
        await new Promise((r) => setTimeout(r, 1000))
        return { title: String(w.props.get('title') ?? ''), master: m.props.get('dataobject'), detail: d.props.get('dataobject'), mrows: m.model.rowCount(), drows: d.model.rowCount() }
      }, { kind: s.kind, customer: s.customer })
      out.pick = await page.evaluate(async () => {
        const rt = window.rt
        const w = rt.windowInstances.get('w_sale')
        const l = w.props.get('id_itemslist')
        const n = await l.n_rowcount()
        if (!n) return { listRows: 0 }
        const r = await l.pbCall('find', ['icode = 9801', 1, n], rt)
        const row = r > 0 ? r : 1
        await l.pbCall('setrow', [row], rt)
        await l.n_scrolltorow(row)
        await rt.fire(l, 'clicked', [0, 0, row, { name: 'itemname' }])
        await new Promise((x) => setTimeout(x, 1800))
        const d = w.props.get('id_detail')
        return { listRows: n, row, detailRows: d.model.rowCount(), icode: String(d.model.buf.primary[0]?.v[d.model.colIndex('icode')] ?? '') }
      })
      out.messages.push(...await drain(page))
      out.pick = { ...out.pick, ...(await page.evaluate(() => ({ msgs: [...document.querySelectorAll('.msgbox .txt')].map((e) => e.textContent.replace(/\s+/g, ' ').trim()) }))) }
      // tag each target DataWindow's DOM container
      out.targets = await page.evaluate(() => {
        const rt = window.rt
        const w = rt.windowInstances.get('w_sale')
        const view = rt.ui.views.get(w)
        const ids = ['id_master', 'id_detail', 'id_footer']
        const res = []
        for (const id of ids) {
          const dw = w.props.get(id)
          const el = view?.ctlViews?.get?.(dw)?.el
          if (el) el.setAttribute('data-parity-dw', id)
          const m = dw?.model
          res.push({
            id,
            dataobject: dw?.props.get('dataobject') ?? null,
            rows: m?.rowCount?.() ?? 0,
            cols: (m?.def?.table?.columns || []).map((c) => ({ name: c.name, type: c.type })),
            objects: (m?.def?.objects || [])
              .filter((o) => o.type === 'column' && Number(o.tabsequence) > 0 && o.protect !== '1')
              .map((o) => ({ name: o.name, tab: Number(o.tabsequence), visible: String(o.visible ?? '1') })),
          })
        }
        return res
      })
      // read footer total
      out.totals.before = await page.evaluate(async () => {
        const rt = window.rt
        const w = rt.windowInstances.get('w_sale')
        const f = w.props.get('id_footer')
        try { await w.pbCall('wf_grandtotal', [], rt) } catch { /* not present on w_sale? fall through */ }
        return String(await f.pbCall('getitemstring', [1, 'total'], rt))
      }).catch(() => null)

      for (const t of out.targets) {
        if (!t.rows) continue
        for (const o of t.objects) {
          const rec = { dw: t.id, field: o.name, tab: o.tab }
          if (LOOKUP.has(o.name) || o.visible === '0') { rec.skipped = LOOKUP.has(o.name) ? 'lookup/key' : 'hidden'; out.fields.push(rec); continue }
          const cellSel = `[data-parity-dw="${t.id}"] .o[data-obj="${o.name}"]`
          const cell = page.locator(cellSel).first()
          if (!(await cell.count().catch(() => 0))) { rec.skipped = 'not rendered'; out.fields.push(rec); continue }
          if (!(await cell.isVisible().catch(() => false))) { rec.skipped = 'hidden'; out.fields.push(rec); continue }
          // the DOM marks the cells the runtime will actually edit; protected
          // columns such as the sale date (`0<TAB>1`) render without it
          const cls = (await cell.getAttribute('class').catch(() => '')) || ''
          if (!/\beditable\b/.test(cls)) { rec.skipped = 'read-only'; out.fields.push(rec); continue }
          const col = t.cols.find((c) => c.name === o.name)
          const value = valueFor(col?.type)
          rec.value = value
          try {
            await cell.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => {})
            await cell.click({ force: true, timeout: 2500 })
            await sleep(150)
            const editor = page.locator('.dw-edit').last()
            if (!(await editor.count())) {
              rec.skipped = 'no editor'
              await page.keyboard.press('Escape').catch(() => {})
              out.fields.push(rec)
              continue
            }
            const tag = await editor.evaluate((e) => e.tagName).catch(() => '')
            if (tag === 'SELECT') {
              const opts = await editor.locator('option').evaluateAll((os) => os.map((x) => x.value).filter((v) => v !== ''))
              if (!opts.length) { rec.skipped = 'empty drop-down'; await page.keyboard.press('Escape').catch(() => {}); out.fields.push(rec); continue }
              await editor.selectOption(opts[0]).catch(() => {})
            } else {
              await editor.fill(value).catch(() => {})
            }
            await page.keyboard.press('Tab').catch(() => {})
            await sleep(250)
            // dismiss a validation box but keep its text
            const box = await drain(page)
            if (box.length) rec.message = box.join(' | ')
            out.messages.push(...box)
            rec.got = await page.evaluate(async ({ id, field }) => {
              const rt = window.rt
              const w = rt.windowInstances.get('w_sale')
              const dw = w.props.get(id)
              try {
                const s = await dw.pbCall('getitemstring', [1, field], rt)
                if (s !== null && s !== undefined && String(s) !== '') return String(s)
              } catch { /* fall back to the raw model cell */ }
              const m = dw?.model
              if (!m) return null
              const v = m.buf.primary[0]?.v[m.colIndex(field)]
              if (v && typeof v === 'object') {
                if ('u' in v && 's' in v) return String(v.u)
                if ('y' in v) return `${v.y}-${v.m}-${v.d}`
              }
              return v === null || v === undefined ? '' : String(v)
            }, { id: t.id, field: o.name })
            const norm = (x) => String(x ?? '').trim().replace(/,/g, '').replace(/\.0+$/, '')
            const isNum = /^-?\d+(\.\d+)?$/.test(value)
            rec.applied = isNum
              ? norm(rec.got) !== '' && Math.abs(Number(norm(rec.got)) - Number(value)) < 1e-9
              : /^\d\d\/\d\d\/\d{4}/.test(value)
                ? String(rec.got).includes(value.slice(0, 10))
                : norm(rec.got) === norm(value)
            rec.typed = rec.applied
            if (t.id === 'id_detail' && (o.name === 'looseqty' || o.name === 'saleprice' || o.name === 'discperc')) {
              out.totals[o.name] = await page.evaluate(async () => {
                const rt = window.rt
                const w = rt.windowInstances.get('w_sale')
                const f = w.props.get('id_footer')
                return String(await f.pbCall('getitemstring', [1, 'total'], rt))
              }).catch(() => null)
            }
          } catch (e) {
            rec.error = String(e.message || e).slice(0, 200)
            await page.keyboard.press('Escape').catch(() => {})
          }
          out.fields.push(rec)
        }
      }
      out.summary = {
        rendered: out.fields.filter((f) => !f.skipped && !f.error).length,
        applied: out.fields.filter((f) => f.typed).length,
        skipped: out.fields.filter((f) => f.skipped).length,
        errors: out.fields.filter((f) => f.error).length,
      }
      out.ok = out.summary.applied > 0 && out.summary.errors === 0 && errors.length === 0
    } catch (e) {
      out.fatal = String(e.stack || e).slice(0, 2000)
    } finally {
      results.push(out)
      writeFileSync(`${OUT}/${s.kind}.json`, JSON.stringify(out, null, 1))
      console.log(s.kind, JSON.stringify({ open: out.open, pick: out.pick?.detailRows, totals: out.totals, summary: out.summary, ok: out.ok, fatal: out.fatal, errors: out.errors }))
      await page.close().catch(() => {})
    }
  }
} finally {
  writeFileSync(`${OUT}/summary.json`, JSON.stringify(results, null, 1))
  await browser.close().catch(() => {})
}
