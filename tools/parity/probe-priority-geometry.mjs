// Recapture Priority Setting in the old capture's filtered state and measure
// its list columns from the DOM/screenshot.
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
const require = createRequire(process.env.PLAYWRIGHT_MODULES || 'C:/Users/Admin/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/');
const { chromium } = require('playwright');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = process.env.OUT || 'C:/Projects/Abuzar/deploy/parity/geometry/new-priority-filtered.png';
mkdirSync('C:/Projects/Abuzar/deploy/parity/geometry', { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const out = { errors: [], messages: [] };
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
  await sleep(1800); await poll(2);
  out.tree = await page.evaluate(() => {
    const w = window.rt.windowInstances.get('w_itempriority_form');
    const lines = [];
    const walk = (o, d = 0) => {
      for (const c of o.children.values()) {
        const t = String(c.props.get('text') ?? '');
        const doName = String(c.props.get('dataobject') ?? '');
        lines.push('  '.repeat(d) + [c.name, c.native, t.slice(0, 60), doName].join(' | '));
        walk(c, d + 1);
      }
    };
    walk(w);
    return lines.slice(0, 160);
  });
  out.find = await page.evaluate(async () => {
    const rt = window.rt; const w = rt.windowInstances.get('w_itempriority_form');
    const ctrls = [...w.children.values()];
    const findInput = ctrls.find((c) => (c.native === 'singlelineedit' || c.native === 'editmask') && (c.name.toLowerCase().includes('find') || String(c.props.get('text') || '').toUpperCase().includes('ZYTO')));
    const setAny = async (c, v) => { c.pbSet('text', v); c.props.set('text', v); await rt.fire(c, 'modified').catch(() => {}); };
    const results = [];
    if (findInput) { await setAny(findInput, 'ZYTO 500MG TAB'); results.push({ set: findInput.name }); }
    const buttons = ctrls.filter((c) => c.native === 'commandbutton').map((c) => ({ n: c.name, t: String(c.props.get('text') ?? '') }));
    const filter = buttons.find((b) => /filter/i.test(b.t));
    if (filter) {
      const b = ctrls.find((c) => c.name === filter.n);
      await rt.fire(b, 'clicked').catch(() => {});
      results.push({ clicked: filter.n });
    }
    return { results, findName: findInput?.name ?? null, buttons };
  });
  out.filtered = await page.evaluate(async () => {
    const rt = window.rt; const w = rt.windowInstances.get('w_itempriority_form');
    const find = (o, name) => { for (const c of o.children.values()) { if (c.name === name) return c; const r = find(c, name); if (r) return r } return null };
    const findDw = find(w, 'dw_find');
    const list = find(w, 'dw_list');
    if (findDw?.model) {
      if (findDw.model.rowCount() === 0) await findDw.pbCall('insertrow', [0], rt);
      await findDw.pbCall('setitem', [1, 'find', 'ZYTO 500MG TAB'], rt).catch(() => {});
      await findDw.pbCall('accepttext', [], rt).catch(() => {});
    }
    let matchRow = 0;
    if (list?.model) {
      const m = list.model; const ci = m.colIndex('itemname');
      for (const [i, r] of m.buf.primary.entries()) { if (/^ZYTO 500MG TAB/i.test(String(r.v[ci]))) { matchRow = i + 1; break } }
      if (matchRow) {
        await list.pbCall('setrow', [matchRow], rt).catch(() => {});
        await list.pbCall('scrolltorow', [matchRow], rt).catch(() => {});
      }
    }
    return { find: findDw?.model?.buf?.primary?.[0]?.v?.[0] ?? null, listRows: list?.model?.rowCount?.() ?? null, matchRow, first: list?.model?.buf?.primary?.slice(matchRow - 1, matchRow + 4).map((r) => String(r.v[list.model.colIndex('itemname')])) ?? null };
  });
  await sleep(2000); await poll(3);
  out.state = await page.evaluate(() => {
    const w = window.rt.windowInstances.get('w_itempriority_form');
    const list = w.children.get('dw_list') || w.props.get('id_list');
    const detail = w.children.get('dw_detail') || w.props.get('id_detail');
    return {
      title: String(w.props.get('title') ?? ''),
      list: list?.model ? { rows: list.model.rowCount(), cols: list.model.colNames } : null,
      detail: detail?.model ? { rows: detail.model.rowCount(), cols: detail.model.colNames } : null,
      findText: (() => { const c = [...w.children.values()].find((x) => x.native === 'singlelineedit' && x.name.toLowerCase().includes('find')); return c ? String(c.props.get('text') ?? '') : null })(),
    };
  });
  await page.screenshot({ path: OUT });
  out.saved = OUT;
} catch (e) { out.fatal = String(e.stack || e).slice(0, 1800); }
finally { console.log(JSON.stringify(out, (k, v) => (typeof v === 'bigint' ? Number(v) : v), 1)); await browser.close().catch(() => {}); }
