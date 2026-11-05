// Read-only diagnostic: open Receipt and Issue through their real menu items
// and dump the master/detail/footer columns and current rows.
import { createRequire } from 'node:module';
const require = createRequire(process.env.PLAYWRIGHT_MODULES || 'C:/Users/Admin/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/');
const { chromium } = require('playwright');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const out = { messages: [], errors: [] };
page.on('pageerror', (e) => out.errors.push(String(e.message || e).slice(0, 400)));
async function poll(seconds = 6) {
  for (let i = 0; i < seconds * 2; i++) {
    await sleep(400);
    const msgs = await page.evaluate(() => [...document.querySelectorAll('.msgbox .txt')].map((e) => e.textContent.replace(/\s+/g, ' ').trim().slice(0, 240)));
    if (msgs.length) {
      out.messages.push(...msgs);
      await page.evaluate(() => { for (const b of document.querySelectorAll('.msgbox')) { const bs = [...b.querySelectorAll('.btns button')]; (bs.find((x) => /^(ok|yes)$/i.test(x.textContent.trim())) || bs[0])?.click(); } });
      await sleep(200);
    }
  }
}
async function fireMenu(name) {
  return page.evaluate(async (n) => {
    const rt = window.rt; const root = rt.windowInstances.get('w_main')?.props.get('menuid');
    const find = (o, x) => { for (const c of o.children.values()) { if (c.name === x) return c; const r = find(c, x); if (r) return r } return null };
    const item = root ? find(root, n) : null;
    if (!item) return { found: false };
    await rt.fire(item, 'selected').catch(() => {});
    await rt.fire(item, 'clicked').catch((e) => { window.__menuErr = String(e.message || e) });
    return { found: true, visible: item.props.get('visible'), text: String(item.props.get('text') ?? '') };
  }, name);
}
async function dump(winName) {
  return page.evaluate((n) => {
    const rt = window.rt; const w = rt.windowInstances.get(n);
    if (!w) return { open: false };
    const val = (dw, col) => dw?.model ? dw.model.buf.primary[0]?.v?.[dw.model.colIndex(col)] : null;
    const m = w.props.get('id_master'); const d = w.props.get('id_detail'); const f = w.props.get('id_footer'); const l = w.props.get('id_list');
    return {
      open: true,
      title: String(w.props.get('title') ?? ''),
      il_code: String(w.props.get('il_code') ?? ''),
      il_openparm: String(w.props.get('il_openparm') ?? ''),
      master: m?.model ? { rows: m.model.rowCount(), cols: m.model.colNames, first: m.model.buf.primary[0]?.v?.slice(0, 30) } : null,
      detail: d?.model ? { rows: d.model.rowCount(), cols: d.model.colNames, first: d.model.buf.primary[0]?.v?.slice(0, 30) } : null,
      footer: f?.model ? { rows: f.model.rowCount(), cols: f.model.colNames, first: f.model.buf.primary[0]?.v?.slice(0, 30) } : null,
      list: l?.model ? { rows: l.model.rowCount(), cols: l.model.colNames } : null,
      tabs: [...(w.children.get('tab_retrieve')?.children?.keys() ?? [])],
    };
  }, winName);
}
try {
  await page.goto('http://127.0.0.1:5177/?app=1&autologin=ADMIN:password9080', { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.rt && window.rt.windowInstances.get('w_main') && typeof window.__menu === 'function', null, { timeout: 90000, polling: 300 });
  out.receiptMenu = await fireMenu('m_receiptform');
  await sleep(2500); await poll(3);
  out.receipt = await dump('w_receipt');
  out.issueMenu = await fireMenu('m_issue_form');
  await sleep(2500); await poll(3);
  out.issue = await dump('w_issue');
  out.windows = await page.evaluate(() => [...window.rt.windowInstances.keys()]);
  // close cleanly
  await page.evaluate(async () => {
    const rt = window.rt;
    for (const n of ['w_receipt', 'w_issue']) {
      const w = rt.windowInstances.get(n);
      if (w) await rt.fire(w, 'close').catch(() => {});
    }
  });
  await sleep(800); await poll(2);
} catch (e) { out.fatal = String(e.stack || e).slice(0, 1800); }
finally { console.log(JSON.stringify(out, (k, v) => (typeof v === 'bigint' ? Number(v) : v), 1)); await browser.close().catch(() => {}); }
