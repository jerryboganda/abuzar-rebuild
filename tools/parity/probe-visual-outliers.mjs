// Re-capture the highest visual-diff screens in fresh sessions so stale
// screenshots and leftover modal windows cannot distort the measurement.
// Writes <out>/<old-file-name>.png for compare-images.ps1.
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
const require = createRequire(process.env.PLAYWRIGHT_MODULES || 'C:/Users/Admin/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/');
const { chromium } = require('playwright');
const OUT = process.env.OUT || 'C:/Projects/Abuzar/deploy/parity/screen-parity/outlier-refresh';
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SCREENS = [
  ['006_Sales_Cash_Sale.png', 'm_retailsale', 'Sales | CashSale'],
  ['013_Sales_Refused_Sales.png', 'm_refusedsales', 'Sales | Refused Sales'],
  ['037_Maintenance_Change_Password.png', 'm_changepassword', 'Maintenance | Change Password'],
  ['039_Maintenance_Change_Items_Price.png', 'm_changeitempsprice', 'Maintenance | Change Items Price'],
  ['043_Maintenance_Priority_Setting.png', 'm_perioritysetting', 'Maintenance | Priority Setting'],
  ['046_Maintenance_Modify_Last_Transaction_Date.png', 'm_modifylasttransactiondate', 'Maintenance | Modify Last Transaction Date'],
  ['048_Maintenance_Interface_Setting.png', 'm_interfacesetting', 'Maintenance | Interface Setting'],
  ['062_Help_About.png', 'm_about', 'Help | About'],
];
const browser = await chromium.launch();
const results = [];
try {
  for (const [file, itemName, path] of SCREENS) {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e.message || e).slice(0, 300)));
    try {
      await page.goto('http://127.0.0.1:5177/?app=1&autologin=ADMIN:password9080', { waitUntil: 'load', timeout: 60000 });
      await page.waitForFunction(() => window.rt && window.rt.windowInstances.get('w_main') && typeof window.__menu === 'function', null, { timeout: 90000, polling: 300 });
      const click = await page.evaluate(async (name) => {
        const rt = window.rt; const root = rt.windowInstances.get('w_main')?.props.get('menuid');
        const find = (o, n) => { for (const c of o.children.values()) { if (c.name === n) return c; const r = find(c, n); if (r) return r } return null };
        const item = root ? find(root, name) : null;
        if (!item) return { found: false };
        await rt.fire(item, 'selected').catch(() => {});
        void rt.fire(item, 'clicked').catch(() => {});
        return { found: true, visible: item.props.get('visible'), enabled: item.props.get('enabled'), text: String(item.props.get('text') ?? '') };
      }, itemName);
      // dismiss dialogs the way the crawl does: No / Cancel / Close / OK, never Yes
      const messages = [];
      for (let i = 0; i < 16; i++) {
        await sleep(500);
        const state = await page.evaluate(() => {
          const boxes = [...document.querySelectorAll('.msgbox')];
          const msgs = boxes.map((b) => ({ title: (b.querySelector('.ttl')?.textContent || '').replace(/\s+/g, ' ').trim(), text: (b.querySelector('.txt')?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 300) }));
          for (const b of boxes) {
            const bs = [...b.querySelectorAll('.btns button')];
            const order = ['no', 'cancel', 'close', 'abort', 'ignore', 'ok'];
            let pick = null;
            for (const n of order) { pick = bs.find((x) => x.textContent.trim().toLowerCase() === n); if (pick) break }
            (pick || bs[0])?.click();
          }
          const rt = window.rt;
          return { msgs, windows: [...rt.windowInstances.keys()] };
        }).catch(() => ({ msgs: [], windows: [] }));
        messages.push(...state.msgs);
        if (!state.msgs.length && i >= 4 && state.windows.length > 1) break;
      }
      await sleep(1800);
      const state = await page.evaluate(() => {
        const rt = window.rt;
        const wins = [...rt.windowInstances.entries()].filter(([k]) => k !== 'w_main').map(([k, w]) => ({ key: k, title: String(w.props?.get?.('title') ?? ''), visible: w.props?.get?.('visible') ?? null }));
        return { wins };
      });
      // capture only the window itself (title bar + client), not the desktop
      // position: placement differences must not count as visual differences.
      const rect = await page.evaluate(() => {
        const rt = window.rt;
        const wins = [...rt.windowInstances.entries()].filter(([k]) => k !== 'w_main');
        const entry = wins[wins.length - 1];
        const el = entry ? rt.ui.views.get(entry[1])?.el : null;
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
      });
      if (rect && rect.width > 20 && rect.height > 20) await page.screenshot({ path: `${OUT}/${file}`, clip: rect });
      else await page.screenshot({ path: `${OUT}/${file}`, fullPage: false });
      results.push({ file, path, itemName, click, state, rect, messages, errors });
      console.log(file, JSON.stringify({ click, wins: state.wins, messages, errors }));
    } catch (e) {
      results.push({ file, path, itemName, fatal: String(e.stack || e).slice(0, 1000), errors });
      console.log(file, 'FATAL', String(e.message || e));
    } finally {
      await page.close().catch(() => {});
    }
  }
} finally {
  writeFileSync(`${OUT}/captures.json`, JSON.stringify(results, null, 1));
  await browser.close().catch(() => {});
}
