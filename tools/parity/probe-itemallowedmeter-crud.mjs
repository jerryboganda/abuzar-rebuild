// Item Allowed Meter (m_itemallowedmeter -> w_itemallowedmeter): assign meter
// 1 to existing item 9801 through the real form, then delete the assignment.
// The form never updates Item; only ItemAllowedMeter is written.  A temporary
// ItemMeter 1 fixture is inserted and removed.
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
const METER = 1;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const out = { item: ITEM, meter: METER, messages: [], errors: [], net: [] };
page.on('pageerror', (e) => out.errors.push(String(e.message || e).slice(0, 600)));
page.on('request', (r) => { if (r.url().includes('/api/exec')) out.net.push({ p: 'req', body: String(r.postData() || '') }) });
page.on('response', async (r) => { if (r.url().includes('/api/exec')) { let b = ''; try { b = await r.text() } catch {} out.net.push({ p: 'res', status: r.status(), body: String(b).slice(0, 400) }) } });
async function poll(seconds = 12, yes = false) {
  for (let i = 0; i < seconds * 2; i++) {
    await sleep(500);
    const msgs = await page.evaluate(() => [...document.querySelectorAll('.msgbox .txt')].map((e) => e.textContent.replace(/\s+/g, ' ').trim().slice(0, 300)));
    if (msgs.length) {
      out.messages.push(...msgs);
      await page.evaluate((y) => { for (const b of document.querySelectorAll('.msgbox')) { const bs = [...b.querySelectorAll('.btns button')]; (bs.find((x) => (y && /^yes$/i.test(x.textContent.trim())) || /^(ok|yes)$/i.test(x.textContent.trim())) || bs[0])?.click(); } }, yes);
      await sleep(250);
    }
  }
}
const killIdle = () => { try { q("select count(pg_terminate_backend(pid)) from pg_stat_activity where datname='" + DB + "' and xact_start is not null and pid<>pg_backend_pid()"); } catch {} };
const counts = () => ({
  allowed: Number(rows('select count(*) from dbo.itemallowedmeter')[0][0]),
  meters: Number(rows('select count(*) from dbo.itemmeter')[0][0]),
  item: rows(`select icode,saleprice,lastupdate::text from dbo.item where icode=${ITEM}`)[0] ?? null,
  audit: Number(rows('select count(*) from dbo.audit_log')[0][0]),
  auditMax: Number(rows('select max(audit_id) from dbo.audit_log')[0][0]),
});
const restore = () => {
  try {
    killIdle();
    q(`delete from dbo.itemallowedmeter where icode=${ITEM} and itemmetercode=${METER}`);
    q(`delete from dbo.itemmeter where itemmetercode=${METER} and name='PARITY TEMP METER'`);
    if (out.baseline?.auditMax) { q(`delete from dbo.audit_log where audit_id > ${out.baseline.auditMax}`); q(`select setval(pg_get_serial_sequence('dbo.audit_log','audit_id'), ${out.baseline.auditMax}, true)`); }
  } catch (e) { out.restoreError = String(e.message || e).slice(0, 600); }
};
try {
  out.baseline = counts();
  q("insert into dbo.itemmeter (itemmetercode,name,description,currentreading) values (1,'PARITY TEMP METER','TEMP',0)");
  await page.goto('http://127.0.0.1:5177/?app=1&autologin=ADMIN:password9080', { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.rt && window.rt.windowInstances.get('w_main') && typeof window.__menu === 'function', null, { timeout: 90000, polling: 300 });
  out.menuOpen = await page.evaluate(async () => {
    const rt = window.rt; const root = rt.windowInstances.get('w_main')?.props.get('menuid');
    const find = (o, n) => { for (const c of o.children.values()) { if (c.name === n) return c; const r = find(c, n); if (r) return r } return null };
    const item = root ? find(root, 'm_itemallowedmeter') : null;
    if (!item) return { found: false };
    await rt.fire(item, 'selected').catch(() => {});
    await rt.fire(item, 'clicked').catch(() => {});
    return { found: true, visible: item.props.get('visible'), text: String(item.props.get('text') ?? '') };
  });
  await page.waitForFunction(() => window.rt.windowInstances.get('w_itemallowedmeter'), null, { timeout: 30000, polling: 300 });
  await sleep(1500); await poll(2);
  out.open = await page.evaluate(() => {
    const w = window.rt.windowInstances.get('w_itemallowedmeter');
    return { title: String(w.props.get('title') ?? ''), master: !!w.props.get('id_master'), detail: !!w.props.get('id_detail'), list: !!w.props.get('id_list') };
  });
  await page.evaluate(async () => { const rt = window.rt; const w = rt.windowInstances.get('w_itemallowedmeter'); await w.pbCall('ue_newform', [], rt).catch(() => {}) });
  await sleep(800); await poll(1);
  out.fill = await page.evaluate(async ({ item, meter }) => {
    const rt = window.rt; const w = rt.windowInstances.get('w_itemallowedmeter');
    const m = w.props.get('id_master'); const d = w.props.get('id_detail');
    if (!m.model.rowCount()) await m.pbCall('insertrow', [0], rt);
    await m.pbCall('setitem', [1, 'code', item], rt);
    await m.pbCall('setitem', [1, 'name', 'FACE MASK'], rt).catch(() => {});
    if (!d.model.rowCount()) await d.pbCall('insertrow', [0], rt);
    await d.pbCall('setitem', [1, 'itemmetercode', meter], rt);
    await d.pbCall('setitem', [1, 'priority', 10], rt);
    await m.pbCall('accepttext', [], rt).catch(() => {});
    await d.pbCall('accepttext', [], rt).catch(() => {});
    return { master: m.model.buf.primary[0]?.v, detail: d.model.buf.primary[0]?.v };
  }, { item: ITEM, meter: METER });
  out.save1 = await page.evaluate(async () => {
    const rt = window.rt; const w = rt.windowInstances.get('w_itemallowedmeter');
    window.__save1 = false;
    void w.pbCall('ue_save', [], rt).then(() => { window.__save1 = 'ok' }).catch((e) => { window.__save1 = 'ERR ' + String(e.message || e).slice(0, 500) });
    return 'fired';
  });
  await poll(12);
  out.save1Result = await page.evaluate(() => window.__save1 ?? null);
  out.afterAdd = rows(`select icode,itemmetercode,priority from dbo.itemallowedmeter where icode=${ITEM} and itemmetercode=${METER}`)[0] ?? null;
  out.addOk = out.afterAdd?.[0] === String(ITEM) && out.afterAdd?.[1] === String(METER) && out.messages.some((m) => /Changes take effect in database/i.test(m));
  // delete the assignment through the form buffer and save again
  out.deleteRows = await page.evaluate(async () => {
    const rt = window.rt; const w = rt.windowInstances.get('w_itemallowedmeter'); const d = w.props.get('id_detail');
    for (let i = d.model.rowCount(); i >= 1; i--) await d.pbCall('deleterow', [i], rt).catch(() => {});
    window.__save2 = false;
    void w.pbCall('ue_save', [], rt).then(() => { window.__save2 = 'ok' }).catch((e) => { window.__save2 = 'ERR ' + String(e.message || e).slice(0, 500) });
    return { rows: d.model.rowCount() };
  });
  await poll(12);
  out.save2Result = await page.evaluate(() => window.__save2 ?? null);
  out.afterDelete = rows(`select count(*) from dbo.itemallowedmeter where icode=${ITEM} and itemmetercode=${METER}`)[0]?.[0] ?? null;
  out.deleteOk = out.afterDelete === '0' && out.messages.filter((m) => /Changes take effect in database/i.test(m)).length >= 2;
  out.itemUnchanged = JSON.stringify(rows(`select icode,saleprice,lastupdate::text from dbo.item where icode=${ITEM}`)[0] ?? null) === JSON.stringify(out.baseline.item);
  restore();
  out.final = counts();
  out.final.residueMeter = rows("select count(*) from dbo.itemmeter where name='PARITY TEMP METER'")[0]?.[0] ?? null;
  out.baselineOk = out.final.allowed === out.baseline.allowed && out.final.meters === out.baseline.meters
    && out.final.item?.[0] === out.baseline.item?.[0] && out.final.item?.[1] === out.baseline.item?.[1] && out.final.item?.[2] === out.baseline.item?.[2]
    && out.final.audit === out.baseline.audit && out.final.auditMax === out.baseline.auditMax
    && out.final.residueMeter === '0';
  out.ok = !!out.addOk && !!out.deleteOk && !!out.itemUnchanged && out.baselineOk;
} catch (e) { out.fatal = String(e.stack || e).slice(0, 2600); }
finally {
  restore();
  console.log(JSON.stringify(out, (k, v) => (typeof v === 'bigint' ? Number(v) : v), 1));
  await browser.close().catch(() => {});
}
