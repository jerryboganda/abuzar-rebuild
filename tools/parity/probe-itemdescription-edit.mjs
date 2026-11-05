// Item Description (Basic Data | Item .......... | Item Description,
// w_item_form2): edit Item.RemarksForPurchase on item 9801 through the real
// form save, verify the single-column UPDATE, then restore the original null
// value and lastupdate with trigger bypass.
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const require = createRequire(process.env.PLAYWRIGHT_MODULES || 'C:/Users/Admin/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/');
const { chromium } = require('playwright');
const PSQL = 'C:\\PostgreSQL\\17\\bin\\psql.exe';
const DB = process.env.PARITY_DB || 'trader_write_test';
const q = (sql) => execFileSync(PSQL, ['-U', 'postgres', '-h', '127.0.0.1', '-d', DB, '-t', '-A', '-F', '|', '-c', sql], { env: { ...process.env, PGPASSWORD: 'postgres' }, encoding: 'utf8', windowsHide: true }).trim();
const rows = (sql) => q(sql).split(/\r?\n/).filter(Boolean).map((l) => l.split('|'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ITEM = Number(process.env.ITEM || 9801);
const TEXT = 'PARITY ITEM DESCRIPTION';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const out = { item: ITEM, text: TEXT, messages: [], errors: [], net: [] };
page.on('pageerror', (e) => out.errors.push(String(e.message || e).slice(0, 600)));
page.on('request', (r) => { if (r.url().includes('/api/exec')) out.net.push({ p: 'req', body: String(r.postData() || '') }) });
page.on('response', async (r) => { if (r.url().includes('/api/exec')) { let b = ''; try { b = await r.text() } catch {} out.net.push({ p: 'res', status: r.status(), body: String(b).slice(0, 400) }) } });
async function poll(seconds = 12) {
  for (let i = 0; i < seconds * 2; i++) {
    await sleep(500);
    const msgs = await page.evaluate(() => [...document.querySelectorAll('.msgbox .txt')].map((e) => e.textContent.replace(/\s+/g, ' ').trim().slice(0, 300)));
    if (msgs.length) {
      out.messages.push(...msgs);
      await page.evaluate(() => { for (const b of document.querySelectorAll('.msgbox')) { const bs = [...b.querySelectorAll('.btns button')]; (bs.find((x) => /^(ok|yes)$/i.test(x.textContent.trim())) || bs[0])?.click(); } });
      await sleep(250);
    }
  }
}
const killIdle = () => { try { q("select count(pg_terminate_backend(pid)) from pg_stat_activity where datname='" + DB + "' and xact_start is not null and pid<>pg_backend_pid()"); } catch {} };
const counts = () => ({
  item: Number(rows('select count(*) from dbo.item')[0][0]),
  itemMax: Number(rows('select max(icode) from dbo.item')[0][0]),
  itemlog: Number(rows('select count(*) from dbo.itemlog')[0][0]),
  itemlogMax: Number(rows('select max(itemrowid) from dbo.itemlog')[0][0]),
  audit: Number(rows('select count(*) from dbo.audit_log')[0][0]),
  auditMax: Number(rows('select max(audit_id) from dbo.audit_log')[0][0]),
  row: rows(`select coalesce(remarksforpurchase,'<NULL>'),lastupdate::text from dbo.item where icode=${ITEM}`)[0] ?? null,
});
const restore = () => {
  try {
    killIdle();
    const base = out.baseline?.row;
    if (base) {
      const remark = base[0] === '<NULL>' ? 'NULL' : `'${String(base[0]).replace(/'/g, "''")}'`;
      q(`set session_replication_role = replica; update dbo.item set remarksforpurchase=${remark}, lastupdate='${String(base[1]).replace(/'/g, "''")}'::timestamp where icode=${ITEM}; set session_replication_role = origin`);
    }
    if (out.baseline?.itemlogMax) { q(`delete from dbo.itemlog where itemrowid > ${out.baseline.itemlogMax}`); q(`select setval(pg_get_serial_sequence('dbo.itemlog','itemrowid'), ${out.baseline.itemlogMax}, true)`); }
    if (out.baseline?.auditMax) { q(`delete from dbo.audit_log where audit_id > ${out.baseline.auditMax}`); q(`select setval(pg_get_serial_sequence('dbo.audit_log','audit_id'), ${out.baseline.auditMax}, true)`); }
  } catch (e) { out.restoreError = String(e.message || e).slice(0, 600); }
};
try {
  out.baseline = counts();
  await page.goto('http://127.0.0.1:5177/?app=1&autologin=ADMIN:password9080', { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.rt && window.rt.windowInstances.get('w_main') && typeof window.__menu === 'function', null, { timeout: 90000, polling: 300 });
  out.menu = await page.evaluate(async () => { try { return await window.__menu('Basic Data | Item .......... | Item Description'); } catch (e) { return 'ERR ' + String(e.message || e); } });
  if (out.menu !== true) {
    out.openSheet = await page.evaluate(async () => {
      const rt = window.rt;
      const { Ref } = await import('/src/runtime/interp.ts');
      let win = null;
      const ref = new Ref(() => win, (v) => { win = v });
      ref.name = 'w_item_form2';
      await rt.sys.get('opensheetwithparm').fn(rt, [ref, 1, rt.windowInstances.get('w_main'), 0, 0], undefined);
      return !!rt.windowInstances.get('w_item_form2');
    });
  }
  await page.waitForFunction(() => window.rt.windowInstances.get('w_item_form2'), null, { timeout: 40000, polling: 300 });
  await sleep(1500); await poll(2);
  out.open = await page.evaluate(() => {
    const w = window.rt.windowInstances.get('w_item_form2');
    return { title: String(w.props.get('title') ?? ''), detail: !!w.props.get('id_detail'), list: !!w.props.get('id_list'), cols: w.props.get('id_detail')?.model?.colNames?.length ?? null };
  });
  await page.evaluate(async () => { const rt = window.rt; const w = rt.windowInstances.get('w_item_form2'); void w.pbCall('ue_list', [], rt).catch(() => {}) });
  for (let i = 0; i < 120; i++) { await sleep(500); const n = await page.evaluate(() => window.rt.windowInstances.get('w_item_form2')?.props.get('id_list')?.model?.rowCount?.() ?? 0); if (n > 0) { out.listRows = n; break; } await poll(1); }
  out.pick = await page.evaluate(async (item) => {
    const rt = window.rt; const w = rt.windowInstances.get('w_item_form2');
    const l = w.props.get('id_list'); const m = l.model; const ci = m.colIndex('code') >= 0 ? m.colIndex('code') : 0;
    const hit = [...m.buf.primary.entries()].find(([, r]) => Number(r.v[ci]) === item);
    if (!hit) return { error: 'item not in list', rows: m.rowCount() };
    w.props.set('id_dwcontrol', l); w.props.set('il_selectedrow', hit[0] + 1);
    await w.pbCall('ue_detail', [], rt).catch(() => {});
    await new Promise((r) => setTimeout(r, 1200));
    const d = w.props.get('id_detail');
    return { row: hit[0] + 1, listRows: m.rowCount(), detailRows: d?.model?.rowCount?.() ?? null, code: d?.model?.getItem?.(1, 'code') ?? null };
  }, ITEM);
  await poll(2);
  out.edit = await page.evaluate(async ({ item, text }) => {
    const rt = window.rt; const w = rt.windowInstances.get('w_item_form2'); const d = w.props.get('id_detail');
    const before = d.model.getItem(1, 'remarksforpurchase');
    await d.pbCall('setitem', [1, 'remarksforpurchase', text], rt);
    await d.pbCall('accepttext', [], rt).catch(() => {});
    const now = d.model.getItem(1, 'remarksforpurchase');
    window.__save = false;
    void w.pbCall('ue_save', [], rt).then((v) => { window.__save = String(v) }).catch((e) => { window.__save = 'ERR ' + String(e.message || e).slice(0, 500) });
    return { before: before === null ? '<NULL>' : String(before), now: now === null ? '<NULL>' : String(now), code: d.model.getItem(1, 'code') };
  }, { item: ITEM, text: TEXT });
  await poll(14);
  out.saveResult = await page.evaluate(() => window.__save ?? null);
  out.afterSave = rows(`select coalesce(remarksforpurchase,'<NULL>'),lastupdate::text from dbo.item where icode=${ITEM}`)[0] ?? null;
  out.saveSQL = out.net.filter((x) => x.p === 'req').map((x) => { try { return JSON.parse(x.body).sql } catch { return '' } }).filter((s) => /update dbo\.item|insert into dbo\.itemlog/i.test(s)).map((s) => s.slice(0, 240));
  out.editOk = out.afterSave?.[0] === TEXT && out.messages.some((m) => /Changes take effect in database/i.test(m));
  // second form save restoring the original text (the SQL cleanup below restores NULL/lastupdate exactly)
  restore();
  out.final = counts();
  out.baselineOk = out.final.item === out.baseline.item && out.final.itemMax === out.baseline.itemMax
    && out.final.itemlog === out.baseline.itemlog && out.final.itemlogMax === out.baseline.itemlogMax
    && out.final.audit === out.baseline.audit && out.final.auditMax === out.baseline.auditMax
    && out.final.row?.[0] === out.baseline.row?.[0] && out.final.row?.[1] === out.baseline.row?.[1];
  out.ok = !!out.editOk && out.baselineOk;
} catch (e) { out.fatal = String(e.stack || e).slice(0, 2600); }
finally {
  restore();
  console.log(JSON.stringify(out, (k, v) => (typeof v === 'bigint' ? Number(v) : v), 1));
  await browser.close().catch(() => {});
}
