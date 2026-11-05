// Measure Priority Setting list rows, especially the first focused row.
import { createRequire } from 'node:module';
const require = createRequire(process.env.PLAYWRIGHT_MODULES || 'C:/Users/Admin/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/');
const { chromium } = require('playwright');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = 'C:/Projects/Abuzar/deploy/parity/geometry/priority-rows.png';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const out = { messages: [], errors: [] };
page.on('pageerror', (e) => out.errors.push(String(e.message || e).slice(0, 300)));
async function poll(seconds = 6) {
  for (let i = 0; i < seconds * 2; i++) {
    await sleep(400);
    const msgs = await page.evaluate(() => [...document.querySelectorAll('.msgbox .txt')].map((e) => e.textContent.replace(/\s+/g, ' ').trim().slice(0, 200)));
    if (msgs.length) {
      out.messages.push(...msgs);
      await page.evaluate(() => { for (const b of document.querySelectorAll('.msgbox')) { const bs = [...b.querySelectorAll('.btns button')]; (bs.find((x) => /^(ok|yes)$/i.test(x.textContent.trim())) || bs[0])?.click(); } });
      await sleep(200);
    }
  }
}
try {
  await page.goto('http://127.0.0.1:5177/?app=1&autologin=ADMIN:password9080', { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.rt && window.rt.windowInstances.get('w_main') && typeof window.__menu === 'function', null, { timeout: 90000, polling: 300 });
  await page.evaluate(() => { void window.__menu('Maintenance | Priority Setting') });
  await page.waitForFunction(() => window.rt.windowInstances.get('w_itempriority_form'), null, { timeout: 40000, polling: 300 });
  await sleep(1600); await poll(2);
  await page.evaluate(async () => {
    const rt = window.rt; const w = rt.windowInstances.get('w_itempriority_form');
    const l = w.props.get('id_list');
    let idx = 0;
    if (l?.model) { const ci = l.model.colIndex('code'); for (let i = 0; i < l.model.buf.primary.length; i++) if (Number(l.model.buf.primary[i].v[ci]) === 9801) { idx = i + 1; break; } }
    w.props.set('il_selectedrow', idx);
    await w.pbCall('ue_detail', [], rt).catch(() => {});
  });
  await sleep(1600); await poll(2);
  out.selectFirst = await page.evaluate(async () => {
    const rt = window.rt; const w = rt.windowInstances.get('w_itempriority_form');
    try { await w.pbCall('wf_selectunselectrow', [1], rt) } catch (e) { return 'ERR ' + String(e.message || e).slice(0, 200) }
    await new Promise((r) => setTimeout(r, 400));
    return 'ok';
  });  out.measure = await page.evaluate(() => {
    const w = window.rt.windowInstances.get('w_itempriority_form');
    const root = [...document.querySelectorAll('.pbwin')].find((e) => e.dataset.win === 'w_itempriority_form');
    const d = w.props.get('id_detail');
    if (!root) return { error: 'no window root' };
    root.id = 'priority-root';
    const rows = [...root.querySelectorAll('.row')].slice(0, 8).map((e) => {
      const b = e.getBoundingClientRect(); const cs = getComputedStyle(e);
      return {
        cls: String(e.className || ''), row: e.dataset.row, top: b.top, bottom: b.bottom, h: b.height,
        display: cs.display, height: cs.height, margin: cs.margin, padding: cs.padding, border: cs.border, outline: cs.outline, lineHeight: cs.lineHeight, fontSize: cs.fontSize,
        cells: [...e.children].slice(0, 4).map((c) => { const cb = c.getBoundingClientRect(); const cc = getComputedStyle(c); return { tag: c.tagName, cls: String(c.className || ''), top: cb.top, h: cb.height, padding: cc.padding, border: cc.border, outline: cc.outline, lineHeight: cc.lineHeight, fontSize: cc.fontSize, fontWeight: cc.fontWeight } }),
      };
    });
    const dws = [...root.querySelectorAll('.dw')].slice(0, 4).map((e) => { const b = e.getBoundingClientRect(); const cs = getComputedStyle(e); return { cls: String(e.className || ''), top: b.top, h: b.height, overflow: cs.overflow, lineHeight: cs.lineHeight, fontSize: cs.fontSize }; });
    return { rows, dws, detailRows: d?.model?.rowCount?.() ?? null, html: root.querySelector('.dw')?.outerHTML.slice(0, 2500) };
  });
  await page.locator('#priority-root').screenshot({ path: OUT }).catch(() => {});
  out.saved = OUT;
} catch (e) { out.fatal = String(e.stack || e).slice(0, 1800); }
finally { console.log(JSON.stringify(out, null, 1)); await browser.close().catch(() => {}); }
