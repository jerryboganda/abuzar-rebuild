// Measure the Select Format modal geometry and row spacing.
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
const require = createRequire(process.env.PLAYWRIGHT_MODULES || 'C:/Users/Admin/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/');
const { chromium } = require('playwright');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = process.env.OUT || 'C:/Projects/Abuzar/deploy/parity/geometry/new-selectformat.png';
const REPORT_PATH = process.env.REPORT_PATH || 'Reports | Daily Reports | Sale | Sale summary';
const DIALOG_TITLE = process.env.DIALOG_TITLE || 'Select Format';
mkdirSync('C:/Projects/Abuzar/deploy/parity/geometry', { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const out = { errors: [], messages: [] };
page.on('pageerror', (e) => out.errors.push(String(e.message || e).slice(0, 300)));
try {
  await page.goto('http://127.0.0.1:5177/?app=1&autologin=ADMIN:password9080', { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.rt && window.rt.windowInstances.get('w_main') && typeof window.__menu === 'function', null, { timeout: 90000, polling: 300 });
  await page.evaluate((p) => { void window.__menu(p) }, REPORT_PATH);
  await page.waitForFunction((title) => {
    for (const [k, w] of window.rt.windowInstances) {
      if (k !== 'w_main' && String(w.props.get('title') ?? '').toLowerCase().includes(title.toLowerCase())) return true;
    }
    return false;
  }, DIALOG_TITLE, { timeout: 30000, polling: 300 });
  await sleep(1000);
  out.windows = await page.evaluate(() => [...window.rt.windowInstances.entries()].map(([k, w]) => ({ k, title: String(w.props.get('title') ?? ''), type: w.props.get('windowtype') })));
  out.measure = await page.evaluate((title) => {
    const wins = [...document.querySelectorAll('.pbwin')].filter((e) => (e.querySelector('.tbar .ttl')?.textContent || '').trim() === title);
    const el = wins[wins.length - 1];
    if (!el) return { error: 'no dialog element' };
    el.id = 'geom-dialog';
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const client = el.querySelector('.client');
    const cr = client?.getBoundingClientRect();
    const ctl = [...el.querySelectorAll('.ctl')].map((c) => {
      const b = c.getBoundingClientRect();
      return { text: (c.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60), x: b.x, y: b.y, w: b.width, h: b.height, top: b.top, bottom: b.bottom };
    }).filter((c) => (/^Format /.test(c.text) || /^\d+\)/.test(c.text)) && c.h <= 30);
    const ys = [...new Set(ctl.map((c) => Math.round(c.top)))].sort((a, b) => a - b);
    const gaps = ys.slice(1).map((y, i) => y - ys[i]);
    return {
      rect: { x: r.x, y: r.y, w: r.width, h: r.height },
      style: { width: cs.width, height: cs.height, border: cs.border, padding: cs.padding, boxSizing: cs.boxSizing, font: cs.font, lineHeight: cs.lineHeight },
      client: cr ? { w: cr.width, h: cr.height, top: cr.top, bottom: cr.bottom } : null,
      tbar: (() => { const t = el.querySelector('.tbar'); if (!t) return null; const b = t.getBoundingClientRect(); return { w: b.width, h: b.height, top: b.top, bottom: b.bottom, font: getComputedStyle(t).font } })(),
      formats: ctl,
      rowTops: ys,
      gaps,
    };
  }, DIALOG_TITLE);
  await page.locator('#geom-dialog').screenshot({ path: OUT }).catch((e) => { out.shotError = String(e.message || e).slice(0, 300) });
  out.saved = OUT;
  // close the dialog and app cleanly
  await page.evaluate(async (title) => {
    const rt = window.rt;
    for (const [k, w] of [...rt.windowInstances]) {
      if (String(w.props.get('title') ?? '').toLowerCase().includes(title.toLowerCase())) {
        await w.pbCall('ue_close', [1], rt).catch(() => {});
      }
    }
  }, DIALOG_TITLE);
  await sleep(500);
} catch (e) { out.fatal = String(e.stack || e).slice(0, 1800); }
finally { console.log(JSON.stringify(out, (k, v) => (typeof v === 'bigint' ? Number(v) : v), 1)); await browser.close().catch(() => {}); }
