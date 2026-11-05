// Generic final-report capture: open a report path, answer whichever format /
// argument / selection dialogs it opens (Ok), wait for w_reviewreport, screenshot.
// Usage: node probe-report-generic.mjs "<menu path>" <out.png> [out.json]
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
const require = createRequire(process.env.PLAYWRIGHT_MODULES || 'C:/Users/Admin/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/');
const { chromium } = require('playwright');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const [PATH, OUT, JSONOUT] = process.argv.slice(2);
if (!PATH || !OUT) throw new Error('args: path out.png [out.json]');
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const out = { path: PATH, stages: [], messages: [], errors: [] };
page.on('pageerror', (e) => out.errors.push(String(e.message || e).slice(0, 300)));
async function dismiss() {
  for (let i = 0; i < 8; i++) {
    const n = await page.evaluate(() => document.querySelectorAll('.msgbox').length);
    if (!n) return;
    const m = await page.evaluate(() => { const b = document.querySelector('.msgbox'); const bs = [...b.querySelectorAll('.btns button')]; const t = (b.querySelector('.txt')?.textContent || '').replace(/\s+/g, ' ').trim(); (bs.find((x) => /^(ok|no|cancel|close)$/i.test(x.textContent.trim())) || bs[0])?.click(); return t });
    out.messages.push(m); await sleep(200);
  }
}
async function dialogs() {
  return await page.evaluate(() => {
    const rt = window.rt; const out = [];
    for (const [k, w] of rt.windowInstances) {
      if (k === 'w_main' || k === 'w_reviewreport') continue;
      const type = Number(w.props?.get('windowtype') ?? 0);
      if (type !== 3) continue;
      out.push({ key: k, title: String(w.props.get('title') ?? '') });
    }
    return out;
  });
}
async function clickOk(win) {
  const b = page.locator(`.pbwin[data-win="${win.toLowerCase()}"] button`).filter({ hasText: /^\s*Ok\s*$/i }).first();
  if (await b.count()) { await b.click({ force: true }).catch(() => {}); return 'dom' }
  return await page.evaluate(async (k) => {
    const rt = window.rt; const w = rt.windowInstances.get(k);
    const cb = w?.children.get('cb_ok') || w?.props.get('cb_ok');
    if (cb) { await rt.fire(cb, 'clicked').catch(() => {}); return 'runtime' }
    return 'none';
  }, win);
}
try {
  await page.goto('http://127.0.0.1:5177/?app=1&autologin=ADMIN:password9080', { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.rt && window.rt.windowInstances.get('w_main') && typeof window.__menu === 'function', null, { timeout: 120000, polling: 300 });
  await page.evaluate((p) => { void window.__menu(p) }, PATH);
  await page.waitForFunction(() => window.rt.windowInstances.get('w_reviewreport'), null, { timeout: 30000, polling: 300 }).catch(() => {});
  for (let stage = 0; stage < 8; stage++) {
    await sleep(900);
    await dismiss();
    const ds = await dialogs();
    if (!ds.length) break;
    const d = ds[0];
    out.stages.push({ key: d.key, title: d.title, how: await clickOk(d.key) });
    // let a posted ue_close run; otherwise close it the way its Ok handler does
    await sleep(700);
    const still = await page.evaluate((k) => !!window.rt.windowInstances.get(k), d.key);
    if (still) {
      await page.evaluate(async (k) => { const rt = window.rt; const w = rt.windowInstances.get(k); if (w) await w.pbCall('ue_close', [1], rt).catch(() => {}); }, d.key);
    }
    await sleep(500);
  }
  for (let i = 0; i < 30; i++) {
    await sleep(500);
    const rows = await page.evaluate(() => window.rt.windowInstances.get('w_reviewreport')?.children.get('dw_report')?.model?.rowCount?.() ?? 0);
    if (rows > 0) break;
    await dismiss();
  }
  await sleep(2500);
  await dismiss();
  out.state = await page.evaluate(() => {
    const rt = window.rt; const w = rt.windowInstances.get('w_reviewreport');
    const d = w?.children.get('dw_report');
    const pages = [...document.querySelectorAll('.page')].map((p) => { const r = p.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x), y: Math.round(r.y) } });
    return { open: !!w, title: w?.props.get('title'), rows: d?.model?.rowCount?.() ?? null, pages, wins: [...rt.windowInstances.keys()], body: document.body.innerText.replace(/\s+/g, ' ').slice(0, 800) };
  });
  await page.screenshot({ path: OUT });
  out.saved = OUT;
} catch (e) { out.fatal = String(e.stack || e).slice(0, 1500); }
finally {
  const text = JSON.stringify(out, (k, v) => (typeof v === 'bigint' ? Number(v) : v), 1);
  console.log(text);
  if (JSONOUT) writeFileSync(JSONOUT, text);
  await browser.close().catch(() => {});
}
