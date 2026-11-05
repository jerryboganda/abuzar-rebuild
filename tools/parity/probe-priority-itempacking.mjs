// Dump Priority list Item Packing model/DOM values and the retrieve SQL/response.
import { createRequire } from 'node:module';
const require = createRequire(process.env.PLAYWRIGHT_MODULES || 'C:/Users/Admin/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/');
const { chromium } = require('playwright');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const out = { messages: [], errors: [], net: [] };
page.on('pageerror', (e) => out.errors.push(String(e.message || e).slice(0, 300)));
page.on('request', (r) => { if (r.url().includes('/api/exec')) out.net.push({ p: 'req', body: String(r.postData() || '') }) });
page.on('response', async (r) => { if (r.url().includes('/api/exec')) { let b = ''; try { b = await r.text() } catch {} out.net.push({ p: 'res', body: String(b).slice(0, 1500) }) } });
try {
  await page.goto('http://127.0.0.1:5177/?app=1&autologin=ADMIN:password9080', { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.rt && window.rt.windowInstances.get('w_main') && typeof window.__menu === 'function', null, { timeout: 90000, polling: 300 });
  await page.evaluate(() => { void window.__menu('Maintenance | Priority Setting') });
  await page.waitForFunction(() => window.rt.windowInstances.get('w_itempriority_form'), null, { timeout: 40000, polling: 300 });
  await sleep(2200);
  out.state = await page.evaluate(() => {
    const rt = window.rt; const w = rt.windowInstances.get('w_itempriority_form');
    const l = w.props.get('id_list');
    const m = l.model;
    const ci = m.colIndex('itempacking');
    const rows = m.buf.primary.slice(0, 6).map((r) => ({ icode: r.v[m.colIndex('code')], name: r.v[m.colIndex('itemname')], itempacking: r.v[ci], raw: r.v.slice(0, 8) }));
    const root = [...document.querySelectorAll('.pbwin')].find((e) => e.dataset.win === 'w_itempriority_form');
    const cells = [...(root?.querySelectorAll('.row .o[data-obj="itempacking"]') || [])].slice(0, 6).map((e) => ({ text: (e.textContent || '').trim(), cls: String(e.className || ''), html: e.innerHTML.slice(0, 120) }));
    const def = m.def.table.columns.find((c) => c.name === 'itempacking');
    return { cols: m.colNames, rows, cells, def, rowCount: m.rowCount() };
  });
} catch (e) { out.fatal = String(e.stack || e).slice(0, 1500); }
finally { console.log(JSON.stringify(out, null, 1)); await browser.close().catch(() => {}); }
