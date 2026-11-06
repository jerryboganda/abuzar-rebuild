// Voucher screen matrix: open each visible voucher menu path (Cash Payment,
// Cash Receipt, Bank Payment, Bank Receipt, Journal) and each invoice-based
// voucher category (12/13/15/16 via w_voucher, 14/17 via w_journalvoucher as
// the original menu does), and record what the form actually loads.
import { createRequire } from 'node:module';
import { appendFileSync, writeFileSync } from 'node:fs';
const require = createRequire(process.env.PLAYWRIGHT_MODULES || 'C:/Users/Admin/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/');
const { chromium } = require('playwright');
const STEPS = 'C:/Projects/Abuzar/deploy/parity/voucher-matrix-steps.txt';
writeFileSync(STEPS, '');
const step = (s) => appendFileSync(STEPS, new Date().toISOString() + ' ' + s + '\n');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
page.setDefaultTimeout(20000);
const out = { screens: [], messages: [], errors: [] };
page.on('pageerror', (e) => out.errors.push(String(e.message || e).slice(0, 400)));
async function drain() {
  const msgs = await page.evaluate(() => [...document.querySelectorAll('.msgbox .txt')].map((e) => e.textContent.replace(/\s+/g, ' ').trim().slice(0, 300)));
  if (msgs.length) {
    out.messages.push(...msgs);
    await page.evaluate(() => { for (const b of document.querySelectorAll('.msgbox')) { const bs = [...b.querySelectorAll('.btns button')]; (bs.find((x) => /^(ok|yes)$/i.test(x.textContent.trim())) || bs[0])?.click() } });
  }
}
const closeAll = async () => {
  await page.evaluate(async () => {
    const rt = window.rt;
    for (const [k, w] of [...rt.windowInstances.entries()].reverse()) {
      if (k === 'w_main') continue;
      try { await Promise.race([rt.closeWindow(w), new Promise((r) => setTimeout(r, 1500))]) } catch {}
    }
  }).catch(() => {});
  await sleep(500);
};
try {
  await page.goto('http://127.0.0.1:5177/?app=1&autologin=ADMIN:password9080', { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.rt && window.rt.windowInstances.get('w_main') && typeof window.__menu === 'function', null, { timeout: 90000, polling: 300 });
  step('logged in');
  const menuNames = [
    ['cashpayment', 'm_cashpayment', 1],
    ['cashreceipt', 'm_cashreceipt', 2],
    ['bankpayment', 'm_bankpayment', 3],
    ['bankreceipt', 'm_bankreceipt', 4],
    ['journalvoucher', 'm_journalvoucher', 5],
  ];
  for (const [label, itemName, cat] of menuNames) {
    await closeAll();
    const click = await page.evaluate(async (name) => {
      const rt = window.rt; const root = rt.windowInstances.get('w_main')?.props.get('menuid');
      const find = (o, n) => { for (const c of o.children.values()) { if (c.name === n) return c; const r = find(c, n); if (r) return r } return null };
      const item = root ? find(root, name) : null;
      if (!item) return { found: false };
      await rt.fire(item, 'selected').catch(() => {});
      void rt.fire(item, 'clicked').catch(() => {});
      return { found: true, visible: item.props.get('visible'), enabled: item.props.get('enabled'), text: String(item.props.get('text') ?? '') };
    }, itemName);
    await sleep(2500);
    await drain();
    const state = await page.evaluate(() => {
      const rt = window.rt;
      const winNames = [...rt.windowInstances.keys()];
      const get = (n) => rt.windowInstances.get(n);
      const w = get('w_voucher') || get('w_journalvoucher');
      if (!w) return { winNames, window: null };
      const rows = (field) => { try { const d = w.props.get(field); return d?.model?.rowCount?.() ?? null } catch { return 'ERR' } };
      return {
        winNames,
        window: w.name,
        title: String(w.props.get('title') ?? ''),
        ii_vouchertype: w.props.get('ii_vouchertype') ?? null,
        categoryName: String(w.props.get('is_vouchercategoryname') ?? ''),
        is_jv: w.props.get('is_jv') ?? null,
        is_invoicebased: w.props.get('is_invoicebased') ?? null,
        is_headertreatment: w.props.get('is_headertreatment') ?? null,
        is_detailtreatment: w.props.get('is_detailtreatment') ?? null,
        headerRows: rows('idc_dddwheaderaccount'),
        detailRows: rows('idc_dddwdetailaccount'),
        masterRows: rows('id_master'),
        detailGridRows: rows('id_detail'),
      };
    });
    step(label + ' click=' + JSON.stringify(click) + ' state=' + JSON.stringify(state));
    out.screens.push({ label, itemName, category: cat, click, state });
  }
  // invoice-based voucher categories: same windows, direct numeric parm
  for (const cat of [12, 13, 15, 16]) {
    await closeAll();
    const open = await page.evaluate(async (c) => {
      const rt = window.rt;
      const { Ref } = await import('/src/runtime/interp.js');
      let win = null; const ref = new Ref(() => win, (v) => { win = v }); ref.name = 'w_voucher';
      void rt.sys.get('opensheetwithparm').fn(rt, [ref, c, rt.windowInstances.get('w_main'), 0, 5], undefined).catch(() => {});
      return { fired: true };
    }, cat);
    await sleep(2500); await drain();
    const state = await page.evaluate(() => {
      const rt = window.rt; const w = rt.windowInstances.get('w_voucher');
      if (!w) return { open: false, winNames: [...rt.windowInstances.keys()] };
      const rows = (field) => { try { const d = w.props.get(field); return d?.model?.rowCount?.() ?? null } catch { return 'ERR' } };
      return { open: true, title: String(w.props.get('title') ?? ''), ii_vouchertype: w.props.get('ii_vouchertype'), categoryName: String(w.props.get('is_vouchercategoryname') ?? ''), is_jv: w.props.get('is_jv'), is_invoicebased: w.props.get('is_invoicebased'), is_headertreatment: w.props.get('is_headertreatment'), is_detailtreatment: w.props.get('is_detailtreatment'), headerRows: rows('idc_dddwheaderaccount'), detailRows: rows('idc_dddwdetailaccount') };
    });
    step('cat ' + cat + ' ' + JSON.stringify(open) + ' state=' + JSON.stringify(state));
    out.screens.push({ label: 'category ' + cat, category: cat, state });
  }
  for (const cat of [14, 17]) {
    await closeAll();
    await page.evaluate(async (c) => {
      const rt = window.rt;
      const { Ref } = await import('/src/runtime/interp.js');
      let win = null; const ref = new Ref(() => win, (v) => { win = v }); ref.name = 'w_journalvoucher';
      void rt.sys.get('opensheetwithparm').fn(rt, [ref, c, rt.windowInstances.get('w_main'), 0, 5], undefined).catch(() => {});
    }, cat);
    await sleep(2500); await drain();
    const state = await page.evaluate(() => {
      const rt = window.rt; const w = rt.windowInstances.get('w_journalvoucher');
      if (!w) return { open: false, winNames: [...rt.windowInstances.keys()] };
      const rows = (field) => { try { const d = w.props.get(field); return d?.model?.rowCount?.() ?? null } catch { return 'ERR' } };
      return { open: true, title: String(w.props.get('title') ?? ''), ii_vouchertype: w.props.get('ii_vouchertype'), masterRows: rows('id_master'), detailRows: rows('id_detail'), detailAccountRows: rows('idc_dddwdetailaccount') };
    });
    step('cat ' + cat + ' state=' + JSON.stringify(state));
    out.screens.push({ label: 'category ' + cat, category: cat, state });
  }
  await closeAll();
  step('done');
} catch (e) { out.fatal = String(e.stack || e).slice(0, 2000); step('FATAL ' + out.fatal); }
finally {
  await closeAll();
  console.log(JSON.stringify(out, (k, v) => (typeof v === 'bigint' ? Number(v) : v), 1));
  await browser.close().catch(() => {});
}
