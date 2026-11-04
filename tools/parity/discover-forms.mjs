import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
const require = createRequire('C:/Users/Admin/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/')
const { chromium } = require('playwright')
const src = readFileSync('C:/Projects/Abuzar/deploy/parity/login-trader.ps1', 'utf8')
const user = (src.match(/\$User\s*=\s*'([^']*)'/) || [])[1] || 'ADMIN'
const pass = (src.match(/\$Pass\s*=\s*'([^']*)'/) || [])[1]
const paths = [
  'Basic Data | Customer .......... | Customer Category',
  'Basic Data | Customer .......... | Sale Promotion',
  'Basic Data | Customer .......... | Customer Sector',
  'Basic Data | Supplier .......... | Supplier Category',
  'Basic Data | Item .......... | Item Category',
  'Basic Data | Item .......... | Generic Item',
  'Basic Data | Item .......... | Price Policy',
  'Basic Data | Item .......... | Item Alert',
  'Basic Data | Item .......... | Sales Tax Schedule',
  'Basic Data | Item .......... | PCT Codes',
  'Basic Data | Item .......... | Generic Item Type',
  'Basic Data | Item .......... | Item Thickness',
  'Basic Data | Item .......... | Lock Reason',
  'Basic Data | Item .......... | Category Segment',
  'Basic Data | Item .......... | Manufacturer Type',
  'Manage | Groups',
  'Manage | Users',
  'Manage | Group Allowed Price Setting',
  'Manage | Group Wise Cash Account Setting',
  'Manage | Group Wise Supplier Category',
]
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } })
await page.goto('http://127.0.0.1:5177/?app=1&autologin=' + encodeURIComponent(user) + ':' + encodeURIComponent(pass))
await page.waitForFunction(() => window.rt && window.rt.windowInstances.get('w_main'), null, { timeout: 120000, polling: 500 })
await page.waitForTimeout(800)
for (const path of paths) {
  try {
    await page.evaluate((p) => window.__menu(p), path)
    await page.waitForTimeout(1500)
    const info = await page.evaluate(() => {
      const rt = window.rt
      const w = [...rt.windowInstances.entries()].filter(([k]) => k !== 'w_main').map(([, v]) => v).pop()
      if (!w) return { error: 'no window' }
      const detail = w.props.get('id_detail')
      const list = w.props.get('id_list')
      const desc = (dw) => {
        const m = dw && dw.model
        if (!m) return null
        return {
          name: dw.name, dataobject: dw.props.get('dataobject'), rows: m.rowCount(), table: m.def.table.update,
          key: m.def.table.columns.filter((c) => c.key === 'yes').map((c) => c.name),
          columns: m.def.table.columns.map((c) => `${c.name}:${c.type}${c.key === 'yes' ? '*' : ''}${c.update === 'yes' ? '+' : ''}`),
        }
      }
      return { window: w.className, title: w.props.get('title'), detail: desc(detail), list: desc(list) }
    })
    console.log(JSON.stringify({ path, ...info }))
    await page.evaluate(async () => {
      const rt = window.rt
      for (const [k, w] of [...rt.windowInstances.entries()].reverse()) if (k !== 'w_main') { try { await Promise.race([rt.closeWindow(w), new Promise((r) => setTimeout(r, 1500))]) } catch {} }
    })
    await page.waitForTimeout(500)
  } catch (e) {
    console.log(JSON.stringify({ path, error: String(e.message || e) }))
  }
}
await browser.close()
