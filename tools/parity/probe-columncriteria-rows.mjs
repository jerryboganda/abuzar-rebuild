// Measure the Select Column Criteria radio rows and the focused first row.
import { createRequire } from 'node:module';
const require = createRequire(process.env.PLAYWRIGHT_MODULES || 'C:/Users/Admin/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/');
const { chromium } = require('playwright');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = 'C:/Projects/Abuzar/deploy/parity/geometry/columncriteria-rows.png';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const out = { messages: [], errors: [] };
page.on('pageerror', (e) => out.errors.push(String(e.message || e).slice(0, 400)));
try {
  await page.goto('http://127.0.0.1:5177/?app=1&autologin=ADMIN:password9080', { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.rt && window.rt.windowInstances.get('w_main') && typeof window.__menu === 'function', null, { timeout: 90000, polling: 300 });
  await page.evaluate(() => { void window.__menu('Maintenance | Update Item Basic Data') });
  await page.waitForFunction(() => {
    for (const [k, w] of window.rt.windowInstances) if (k !== 'w_main' && String(w.props.get('title') ?? '').toLowerCase().includes('select column criteria')) return true;
    return false;
  }, null, { timeout: 30000, polling: 300 });
  await sleep(1000);
  out.measure = await page.evaluate(() => {
    const wins = [...document.querySelectorAll('.pbwin')].filter((e) => (e.querySelector('.tbar .ttl')?.textContent || '').trim() === 'Select Column Criteria');
    const el = wins[wins.length - 1];
    if (!el) return { error: 'no dialog' };
    el.id = 'geom-columncriteria';
    const r = el.getBoundingClientRect();
    const labels = ['Manufacturer Wise', 'Category Wise', 'Class Wise', 'Packing Wise', 'Sale Order'];
    const rows = [];
    for (const label of labels) {
      const node = [...el.querySelectorAll('*')].find((x) => x.children.length === 0 && (x.textContent || '').trim() === label);
      if (!node) { rows.push({ label, missing: true }); continue; }
      const parts = [];
      let p = node;
      for (let i = 0; i < 5 && p; i++, p = p.parentElement) {
        const b = p.getBoundingClientRect();
        const cs = getComputedStyle(p);
        parts.push({
          i, tag: p.tagName, cls: String(p.className || ''), text: (p.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40),
          top: b.top, bottom: b.bottom, h: b.height, w: b.width,
          display: cs.display, height: cs.height, minHeight: cs.minHeight, maxHeight: cs.maxHeight,
          margin: cs.margin, padding: cs.padding, border: cs.border, outline: cs.outline,
          lineHeight: cs.lineHeight, fontSize: cs.fontSize, boxSizing: cs.boxSizing,
          position: cs.position, topCss: cs.top, transform: cs.transform,
        });
        if (p === el) break;
      }
      const labelEl = node.closest('label'); const input = labelEl ? labelEl.querySelector('input') : null; const ir = input ? input.getBoundingClientRect() : null; const ics = input ? getComputedStyle(input) : null; rows.push({ label, nodeTag: node.tagName, nodeCls: String(node.className || ''), nodeRect: (() => { const b = node.getBoundingClientRect(); return { top: b.top, bottom: b.bottom, h: b.height, w: b.width }; })(), input: ir ? { top: ir.top, h: ir.height, w: ir.width, outline: ics.outline, outlineOffset: ics.outlineOffset, border: ics.border, boxShadow: ics.boxShadow, margin: ics.margin, appearance: ics.appearance } : null, labelText: labelEl ? { top: labelEl.getBoundingClientRect().top, h: labelEl.getBoundingClientRect().height, gap: getComputedStyle(labelEl).gap, font: getComputedStyle(labelEl).font } : null, parts });
    }
    return {
      rect: { x: r.x, y: r.y, w: r.width, h: r.height },
      rows,
      html: el.outerHTML.slice(0, 3500),
    };
  });
  out.experiment = await page.evaluate(() => {
    const labels = [...document.querySelectorAll('.pbwin label.ctl')].filter((l) => l.querySelector('input[type=radio]'));
    for (const l of labels) {
      l.style.alignItems = 'flex-start';
      l.style.paddingTop = '0px';
      const i = l.querySelector('input[type=radio]');
      i.style.marginTop = '2px';
      i.style.outline = 'none';
    }
    const first = labels.find((l) => (l.textContent || '').includes('Manufacturer Wise'));
    if (first) { const s = first.querySelector('span'); if (s) { s.style.outline = '1px dotted #000'; s.style.outlineOffset = '0px'; } }
    return labels.slice(0, 5).map((l) => ({ text: (l.textContent || '').trim(), top: l.getBoundingClientRect().top, spanTop: l.querySelector('span')?.getBoundingClientRect().top, inputTop: l.querySelector('input')?.getBoundingClientRect().top }));
  });
  await page.waitForTimeout(300);
  await page.locator('#geom-columncriteria').screenshot({ path: OUT.replace('.png', '-styled.png') }).catch(() => {});  await page.locator('#geom-columncriteria').screenshot({ path: OUT }).catch(() => {});
  out.saved = OUT;
} catch (e) { out.fatal = String(e.stack || e).slice(0, 1800); }
finally { console.log(JSON.stringify(out, null, 1)); await browser.close().catch(() => {}); }
