// Generic group-settings add/delete cycle used by the three Manage screens.
// Config via env FORM=price|cash|supp
//   price: groupallowedprice  (code, module, pricetypecode)
//   cash : groupcashaccount   (code, moduleid, cashacccode)
//   supp : groupsuppliercategory (code, suppcatcode, status)
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const require = createRequire(process.env.PLAYWRIGHT_MODULES || 'C:/Users/Admin/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/');
const { chromium } = require('playwright');
const PSQL = 'C:\\PostgreSQL\\17\\bin\\psql.exe';
const q = (sql) => execFileSync(PSQL, ['-U', 'postgres', '-h', '127.0.0.1', '-d', 'trader_write_test', '-t', '-A', '-F', '|', '-c', sql], { env: { ...process.env, PGPASSWORD: 'postgres' }, encoding: 'utf8', windowsHide: true }).trim();
const rows = (sql) => q(sql).split(/\r?\n/).filter(Boolean).map((l) => l.split('|'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CONFIGS = {
  price: { path: 'Manage | Group Allowed Price Setting', win: 'w_groupwiseallowedprices', table: 'dbo.groupallowedprice', keys: ['code', 'module', 'pricetypecode'], dbKeys: ['groupcode', 'module', 'pricetypecode'], vals: [2, 7, 6], label: 'Group Allowed Price Setting' },
  cash: { path: 'Manage | Group Wise Cash Account Setting', win: 'w_groupwiseallowedcashaccount', table: 'dbo.groupcashaccount', keys: ['code', 'moduleid', 'cashacccode'], dbKeys: ['groupcode', 'moduleid', 'cashacccode'], vals: [2, 39, 2], label: 'Group Wise Cash Account Setting' },
  supp: { path: 'Manage | Group Wise Supplier Category', win: 'w_groupsuppcategory', table: 'dbo.groupsuppliercategory', keys: ['code', 'suppcatcode', 'status'], dbKeys: ['groupcode', 'suppcatcode', 'status'], vals: [2, 1, 1], label: 'Group Wise Supplier Category' },
};
const cfg = CONFIGS[process.env.FORM || 'cash'];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const out = { form: process.env.FORM || 'cash', config: cfg, messages: [], errors: [], net: [] };
page.on('pageerror', (e) => out.errors.push(String(e.message || e).slice(0, 400)));
page.on('request', (r) => { if (r.url().includes('/api/exec')) out.net.push({ p: 'req', body: String(r.postData() || '') }) });
page.on('response', async (r) => { if (r.url().includes('/api/exec')) { let b = ''; try { b = await r.text() } catch {} out.net.push({ p: 'res', status: r.status(), body: String(b).slice(0, 500) }) } });
async function poll(seconds = 8) {
  for (let i = 0; i < seconds * 2; i++) {
    await sleep(500);
    const msgs = await page.evaluate(() => [...document.querySelectorAll('.msgbox .txt')].map((e) => e.textContent.replace(/\s+/g, ' ').trim().slice(0, 240)));
    if (msgs.length) {
      out.messages.push(...msgs);
      await page.evaluate(() => { for (const b of document.querySelectorAll('.msgbox')) { const bs = [...b.querySelectorAll('.btns button')]; const pick = bs.find((x) => /^(yes|ok)$/i.test(x.textContent.trim())) || bs.find((x) => /^(no|cancel|close)$/i.test(x.textContent.trim())) || bs[0]; pick?.click(); } });
      await sleep(250);
    }
  }
}
const whereVals = (vals) => cfg.keys.map((k, i) => `${cfg.table === 'dbo.groupallowedprice' ? k : k} = ${vals[i]}`).join(' and ');
const whereSql = (vals) => cfg.dbKeys.map((k, i) => `${k}=${vals[i]}`).join(' and ');
try {
  out.baseline = { rows: Number(rows(`select count(*) from ${cfg.table}`)[0][0]) };
  out.beforeCombo = rows(`select ${cfg.dbKeys.join(',')} from ${cfg.table} where ${whereSql(cfg.vals)}`);
  await page.goto('http://127.0.0.1:5177/?app=1&autologin=ADMIN:password9080', { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.rt && window.rt.windowInstances.get('w_main') && typeof window.__menu === 'function', null, { timeout: 90000, polling: 300 });
  await page.evaluate((p) => { void window.__menu(p) }, cfg.path);
  await page.waitForFunction((k) => window.rt.windowInstances.get(k), cfg.win, { timeout: 40000, polling: 300 });
  await sleep(1600); await poll(2);
  await page.evaluate((k) => { const rt = window.rt; const w = rt.windowInstances.get(k); void w.pbCall('ue_list', [], rt).catch(() => {}) }, cfg.win);
  for (let i = 0; i < 30; i++) { await sleep(500); const n = await page.evaluate((k) => window.rt.windowInstances.get(k)?.props.get('id_list')?.model?.rowCount?.() ?? 0, cfg.win); if (n > 0) { out.listRows = n; break; } await poll(1); }
  out.pick = await page.evaluate(async ({ k, g }) => {
    const rt = window.rt; const w = rt.windowInstances.get(k);
    const l = w.props.get('id_list'); const m = l.model;
    const ci = m.colIndex('groupcode') >= 0 ? m.colIndex('groupcode') : (m.colIndex('code') >= 0 ? m.colIndex('code') : 0);
    const hit = [...m.buf.primary.entries()].find(([, r]) => Number(r.v[ci]) === g);
    if (!hit) return { error: 'group not in list', rows: m.rowCount(), cols: m.colNames };
    w.props.set('id_dwcontrol', l); w.props.set('il_selectedrow', hit[0] + 1);
    void w.pbCall('ue_detail', [], rt).catch(() => {});
    await new Promise((r) => setTimeout(r, 2000));
    const mm = w.props.get('id_master')?.model; const dd = w.props.get('id_detail')?.model;
    return { row: hit[0] + 1, listRows: m.rowCount(), masterCode: String(mm?.buf.primary[0]?.v[mm.colIndex('code')] ?? ''), detailRows: dd?.rowCount(), detailCols: dd?.colNames };
  }, { k: cfg.win, g: cfg.vals[0] });
  await poll(2);
  out.add = await page.evaluate(async ({ k, keys, vals }) => {
    const rt = window.rt; const w = rt.windowInstances.get(k); const d = w.props.get('id_detail');
    const beforeRows = d.model.rowCount();
    await w.pbCall('ue_newitem', [], rt).catch(() => {});
    await new Promise((r) => setTimeout(r, 600));
    const m = d.model;
    const idx = keys.map((n) => m.colIndex(n));
    let row = 0;
    for (const [i, r] of m.buf.primary.entries()) {
      if (idx.every((ci) => ci < 0 || r.v[ci] === null || r.v[ci] === undefined)) { row = i + 1; break }
    }
    if (!row) return { error: 'new row not found', beforeRows, afterRows: m.rowCount() };
    const bad = [];
    for (let x = 0; x < keys.length; x++) {
      try { await d.pbCall('setitem', [row, keys[x], vals[x]], rt) } catch (e) { bad.push(keys[x] + ':' + String(e.message || e).slice(0, 60)) }
    }
    await d.pbCall('accepttext', [], rt).catch(() => {});
    await d.pbCall('setrow', [row], rt).catch(() => {});
    w.props.set('il_currrow', row); w.props.set('ib_itemvalidated', true);
    window.__saveDone = false;
    w.pbCall('ue_save', [], rt).then((v) => { window.__saveDone = String(v) }).catch((e) => { window.__saveDone = 'ERR ' + String(e.message || e).slice(0, 200) });
    return { row, beforeRows, afterRows: m.rowCount(), bad, status: String(m.buf.primary[row - 1]?.st ?? '') };
  }, { k: cfg.win, keys: cfg.keys, vals: cfg.vals });
  await poll(10);
  out.saveDone = await page.evaluate(() => window.__saveDone);
  out.afterAdd = rows(`select ${cfg.dbKeys.join(',')} from ${cfg.table} where ${whereSql(cfg.vals)}`);
  out.addOk = out.afterAdd.length === 1;
  out.sqlAdd = out.net.filter((x) => String(x.body).toLowerCase().includes(cfg.table.split('.')[1])).slice(0, 4);
  if (out.addOk) {
    out.del = await page.evaluate(async ({ k, keys, vals }) => {
      const rt = window.rt; const w = rt.windowInstances.get(k); const d = w.props.get('id_detail'); const m = d.model;
      const idx = keys.map((n) => m.colIndex(n));
      let row = 0;
      for (const [i, r] of m.buf.primary.entries()) {
        if (idx.every((ci, x) => Number(r.v[ci]) === Number(vals[x]))) { row = i + 1; break }
      }
      if (!row) return { error: 'not found in detail', rows: m.rowCount() };
      await d.pbCall('setrow', [row], rt); w.props.set('il_currrow', row);
      await w.pbCall('ue_deleteitem', [], rt).catch(() => {});
      window.__saveDone = false;
      w.pbCall('ue_save', [], rt).then((v) => { window.__saveDone = String(v) }).catch((e) => { window.__saveDone = 'ERR ' + String(e.message || e).slice(0, 200) });
      return { row, rowsAfterDelete: d.model.rowCount(), deleted: d.model.deletedCount?.() ?? null };
    }, { k: cfg.win, keys: cfg.keys, vals: cfg.vals });
    await poll(10);
    out.afterDelete = rows(`select ${cfg.dbKeys.join(',')} from ${cfg.table} where ${whereSql(cfg.vals)}`);
    out.deleteOk = out.afterDelete.length === 0;
  }
  if (!out.deleteOk) q(`delete from ${cfg.table} where ${whereSql(cfg.vals)}`);
  out.final = { rows: Number(rows(`select count(*) from ${cfg.table}`)[0][0]) };
  out.baselineOk = out.final.rows === out.baseline.rows;
} catch (e) { out.fatal = String(e.stack || e).slice(0, 1600); }
finally { console.log(JSON.stringify(out, (k, v) => (typeof v === 'bigint' ? Number(v) : v), 1)); await browser.close().catch(() => {}); }
