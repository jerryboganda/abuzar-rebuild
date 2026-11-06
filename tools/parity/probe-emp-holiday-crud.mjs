// Employee Holiday Calendar (m_holidaycalendar -> w_emp_holiday): the master is
// only a month filter; the detail (EMP_Holiday, identity holidayid) is added,
// edited after File | List -> Detail (so the identity key is in the buffer),
// then deleted through the detail buffer and Save again.
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const require = createRequire(process.env.PLAYWRIGHT_MODULES || 'C:/Users/Admin/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/');
const { chromium } = require('playwright');
const PSQL = 'C:\\PostgreSQL\\17\\bin\\psql.exe';
const DB = process.env.PARITY_DB || 'trader_write_test';
const q = (sql) => execFileSync(PSQL, ['-U', 'postgres', '-h', '127.0.0.1', '-d', DB, '-t', '-A', '-F', '|', '-c', sql], { env: { ...process.env, PGPASSWORD: 'postgres' }, encoding: 'utf8', windowsHide: true }).trim();
const rows = (sql) => q(sql).split(/\r?\n/).filter(Boolean).map((l) => l.split('|'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SUF = String(Date.now()).slice(-6);
const NAME = 'PARITY HOLIDAY ' + SUF;
const NAME2 = NAME + ' EDIT';
const DATE = '2026-12-25 00:00:00';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const out = { name: NAME, name2: NAME2, date: DATE, messages: [], errors: [], net: [] };
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
const seq = () => rows("select last_value::text,is_called::text from dbo.emp_holiday_holidayid_seq")[0] ?? null;
const counts = () => ({
  rows: Number(rows('select count(*) from dbo.emp_holiday')[0][0]),
  seq: seq(),
  audit: Number(rows('select count(*) from dbo.audit_log')[0][0]),
  auditMax: Number(rows('select max(audit_id) from dbo.audit_log')[0][0]),
});
const restore = () => {
  try {
    killIdle();
    q(`delete from dbo.emp_holiday where name in ('${NAME.replace(/'/g, "''")}','${NAME2.replace(/'/g, "''")}')`);
    if (out.baseline?.seq) q(`select setval('dbo.emp_holiday_holidayid_seq', ${Number(out.baseline.seq[0])}, ${['t', 'true'].includes(out.baseline.seq[1]) ? 'true' : 'false'})`);
    if (out.baseline?.auditMax) { q(`delete from dbo.audit_log where audit_id > ${out.baseline.auditMax}`); q(`select setval(pg_get_serial_sequence('dbo.audit_log','audit_id'), ${out.baseline.auditMax}, true)`); }
  } catch (e) { out.restoreError = String(e.message || e).slice(0, 600); }
};
try {
  out.baseline = counts();
  await page.goto('http://127.0.0.1:5177/?app=1&autologin=ADMIN:password9080', { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.rt && window.rt.windowInstances.get('w_main') && typeof window.__menu === 'function', null, { timeout: 90000, polling: 300 });
  out.menuOpen = await page.evaluate(async () => {
    const rt = window.rt; const root = rt.windowInstances.get('w_main')?.props.get('menuid');
    const find = (o, n) => { for (const c of o.children.values()) { if (c.name === n) return c; const r = find(c, n); if (r) return r } return null };
    const item = root ? find(root, 'm_holidaycalendar') : null;
    if (!item) return { found: false };
    await rt.fire(item, 'selected').catch(() => {});
    await rt.fire(item, 'clicked').catch(() => {});
    return { found: true, visible: item.props.get('visible'), text: String(item.props.get('text') ?? '') };
  });
  await page.waitForFunction(() => window.rt.windowInstances.get('w_emp_holiday'), null, { timeout: 30000, polling: 300 });
  await sleep(1500); await poll(2);
  out.open = await page.evaluate(() => {
    const w = window.rt.windowInstances.get('w_emp_holiday');
    return { title: String(w.props.get('title') ?? ''), master: !!w.props.get('id_master'), detail: !!w.props.get('id_detail'), list: !!w.props.get('id_list') };
  });
  await page.evaluate(async () => { const rt = window.rt; const w = rt.windowInstances.get('w_emp_holiday'); await w.pbCall('ue_newform', [], rt).catch(() => {}) });
  await sleep(800); await poll(1);
  out.fillAdd = await page.evaluate(async ({ name, date }) => {
    const rt = window.rt; const w = rt.windowInstances.get('w_emp_holiday');
    const d = w.props.get('id_detail');
    if (!d.model.rowCount()) await d.pbCall('insertrow', [0], rt);
    await d.pbCall('setitem', [1, 'date', '2026-12-25 00:00:00'], rt);
    await d.pbCall('setitem', [1, 'name', name], rt);
    await d.pbCall('setitem', [1, 'payrateperc', 150], rt);
    await d.pbCall('accepttext', [], rt).catch(() => {});
    return { rows: d.model.rowCount(), values: d.model.buf.primary[0]?.v };
  }, { name: NAME, date: DATE });
  out.addSave = await page.evaluate(async () => {
    const rt = window.rt; const w = rt.windowInstances.get('w_emp_holiday');
    window.__save1 = false;
    void w.pbCall('ue_save', [], rt).then(() => { window.__save1 = 'ok' }).catch((e) => { window.__save1 = 'ERR ' + String(e.message || e).slice(0, 400) });
    return 'fired';
  });
  await poll(12);
  out.afterAdd = {
    saveDone: await page.evaluate(() => window.__save1 ?? null),
    row: rows(`select holidayid,date::text,name,payrateperc::text from dbo.emp_holiday where name='${NAME}'`)[0] ?? null,
  };
  out.addOk = !!out.afterAdd.row && out.afterAdd.row[2] === NAME && out.afterAdd.row[1].startsWith('2026-12-25')
    && out.messages.some((m) => /Changes take effect in database/i.test(m));
  // reopen through File | List -> Detail (month 2026-12) so the identity key is loaded
  await page.evaluate(async () => { const rt = window.rt; const w = rt.windowInstances.get('w_emp_holiday'); void w.pbCall('ue_list', [], rt).catch(() => {}) });
  for (let i = 0; i < 40; i++) { await sleep(500); const n = await page.evaluate(() => window.rt.windowInstances.get('w_emp_holiday')?.props.get('id_list')?.model?.rowCount?.() ?? 0); if (n > 0) { out.listRows = n; break; } await poll(1); }
  out.pick = await page.evaluate(async () => {
    const rt = window.rt; const w = rt.windowInstances.get('w_emp_holiday');
    const l = w.props.get('id_list'); const m = l.model; const ci = m.colIndex('code') >= 0 ? m.colIndex('code') : 0;
    let hit = [...m.buf.primary.entries()].find(([, r]) => String(r.v[ci] ?? '').startsWith('2026-12-01'));
    if (!hit) hit = [...m.buf.primary.entries()][0];
    if (!hit) return { error: 'empty list' };
    w.props.set('id_dwcontrol', l); w.props.set('il_selectedrow', hit[0] + 1);
    await w.pbCall('ue_detail', [], rt).catch(() => {});
    await new Promise((r) => setTimeout(r, 1000));
    const mm = w.props.get('id_master'); const dd = w.props.get('id_detail');
    return {
      row: hit[0] + 1, listRows: m.rowCount(), masterDate: mm?.model?.buf.primary[0]?.v?.[0] ?? null,
      detailRows: dd?.model?.rowCount?.() ?? null, detail: dd?.model?.buf.primary[0]?.v ?? null,
    };
  });
  await poll(2);
  // load our row in the detail if the month has other rows
  out.load = await page.evaluate(async ({ name }) => {
    const rt = window.rt; const w = rt.windowInstances.get('w_emp_holiday'); const d = w.props.get('id_detail');
    const ni = d.model.colIndex('name');
    const hit = [...d.model.buf.primary.entries()].find(([, r]) => String(r.v[ni]) === name);
    if (!hit) return { error: 'holiday not in month detail', rows: d.model.rowCount() };
    await d.pbCall('setrow', [hit[0] + 1], rt).catch(() => {});
    return { row: hit[0] + 1, values: d.model.buf.primary[hit[0]]?.v };
  }, { name: NAME });
  out.edit = await page.evaluate(async ({ name2 }) => {
    const rt = window.rt; const w = rt.windowInstances.get('w_emp_holiday'); const d = w.props.get('id_detail');
    await d.pbCall('setitem', [1, 'name', name2], rt);
    await d.pbCall('setitem', [1, 'payrateperc', 200], rt);
    await d.pbCall('accepttext', [], rt).catch(() => {});
    window.__save2 = false;
    void w.pbCall('ue_save', [], rt).then(() => { window.__save2 = 'ok' }).catch((e) => { window.__save2 = 'ERR ' + String(e.message || e).slice(0, 400) });
    return { values: d.model.buf.primary[0]?.v };
  }, { name2: NAME2 });
  await poll(12);
  out.afterEdit = {
    saveDone: await page.evaluate(() => window.__save2 ?? null),
    row: rows(`select holidayid,date::text,name,payrateperc::text from dbo.emp_holiday where name='${NAME2}'`)[0] ?? null,
  };
  out.editOk = out.afterEdit.row?.[2] === NAME2 && Number(out.afterEdit.row?.[3]) === 200
    && out.messages.filter((m) => /Changes take effect in database/i.test(m)).length >= 2;
  // delete the detail row through the form buffer and Save
  out.deleteSave = await page.evaluate(async () => {
    const rt = window.rt; const w = rt.windowInstances.get('w_emp_holiday'); const d = w.props.get('id_detail');
    for (let i = d.model.rowCount(); i >= 1; i--) await d.pbCall('deleterow', [i], rt).catch(() => {});
    window.__save3 = false;
    void w.pbCall('ue_save', [], rt).then(() => { window.__save3 = 'ok' }).catch((e) => { window.__save3 = 'ERR ' + String(e.message || e).slice(0, 400) });
    return { rows: d.model.rowCount() };
  });
  await poll(12);
  out.afterDelete = {
    saveDone: await page.evaluate(() => window.__save3 ?? null),
    residue: rows(`select count(*) from dbo.emp_holiday where name like 'PARITY HOLIDAY %'`)[0]?.[0] ?? null,
  };
  out.deleteOk = out.afterDelete.residue === '0' && out.messages.filter((m) => /Changes take effect in database/i.test(m)).length >= 3;
  // File | Delete on the whole form is an original no-op (no ue_delete defined)
  out.fileDelete = await page.evaluate(async () => {
    const rt = window.rt; const w = rt.windowInstances.get('w_emp_holiday');
    const has = typeof w.findRoutines === 'function' && w.findRoutines('ue_delete').length > 0;
    const menu = w.props.get('menuid') || w.props.get('im_menu');
    let hit = null; const walk = (o) => { for (const c of o.children.values()) { if (c.name === 'm_delete') hit = hit || c; walk(c) } }; if (menu) walk(menu);
    return { hasUeDelete: has, menuEnabled: hit ? hit.props.get('enabled') !== false : null };
  });
  restore();
  out.final = counts();
  out.baselineOk = out.final.rows === out.baseline.rows && JSON.stringify(out.final.seq) === JSON.stringify(out.baseline.seq)
    && out.final.audit === out.baseline.audit && out.final.auditMax === out.baseline.auditMax;
  out.ok = !!out.addOk && !!out.editOk && !!out.deleteOk && out.baselineOk;
} catch (e) { out.fatal = String(e.stack || e).slice(0, 2600); }
finally {
  restore();
  console.log(JSON.stringify(out, (k, v) => (typeof v === 'bigint' ? Number(v) : v), 1));
  await browser.close().catch(() => {});
}
