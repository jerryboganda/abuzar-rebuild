// Employee Education / Certification / Skill (single-entry masters backed by a
// database identity key): add, then reopen through File | List -> Detail so the
// identity code is in the buffer, edit, and delete.  The recovered DataWindows
// have no Identity attribute, so an in-place edit right after Insert matches
// `code IS NULL`; the real reopen path is used here.
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const require = createRequire(process.env.PLAYWRIGHT_MODULES || 'C:/Users/Admin/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/');
const { chromium } = require('playwright');
const PSQL = 'C:\\PostgreSQL\\17\\bin\\psql.exe';
const DB = process.env.PARITY_DB || 'trader_write_test';
const q = (sql) => execFileSync(PSQL, ['-U', 'postgres', '-h', '127.0.0.1', '-d', DB, '-t', '-A', '-F', '|', '-c', sql], { env: { ...process.env, PGPASSWORD: 'postgres' }, encoding: 'utf8', windowsHide: true }).trim();
const rows = (sql) => q(sql).split(/\r?\n/).filter(Boolean).map((l) => l.split('|'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CONFIGS = {
  education: { menu: 'm_education', window: 'w_emp_education', table: 'emp_education', key: 'educationcode', seq: 'emp_education_educationcode_seq', prefix: 'PARITY EMPEDU' },
  certification: { menu: 'm_certificationcourse', window: 'w_emp_certification', table: 'emp_certification', key: 'certificationcode', seq: 'emp_certification_certificationcode_seq', prefix: 'PARITY EMPCERT' },
  skill: { menu: 'm_skillcapability', window: 'w_emp_skill', table: 'emp_skill', key: 'skillcode', seq: 'emp_skill_skillcode_seq', prefix: 'PARITY EMPSKILL' },
};
const key = process.argv[2] || 'education';
const cfg = CONFIGS[key];
if (!cfg) throw new Error('unknown config ' + key);
const SUF = String(Date.now()).slice(-6);
const NAME = cfg.prefix + ' ' + SUF;
const NAME2 = NAME + ' EDIT';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const out = { config: key, name: NAME, name2: NAME2, messages: [], errors: [], net: [] };
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
const seq = () => rows(`select last_value::text,is_called::text from dbo.${cfg.seq}`)[0] ?? null;
const counts = () => ({
  rows: Number(rows(`select count(*) from dbo.${cfg.table}`)[0][0]),
  all: rows(`select ${cfg.key},name from dbo.${cfg.table} order by ${cfg.key}`),
  seq: seq(),
  audit: Number(rows('select count(*) from dbo.audit_log')[0][0]),
  auditMax: Number(rows('select max(audit_id) from dbo.audit_log')[0][0]),
});
const restore = () => {
  try {
    killIdle();
    q(`delete from dbo.${cfg.table} where name like '${cfg.prefix.replace(/'/g, "''")} %'`);
    if (out.baseline?.seq) q(`select setval('dbo.${cfg.seq}', ${Number(out.baseline.seq[0])}, ${['t', 'true'].includes(out.baseline.seq[1]) ? 'true' : 'false'})`);
    if (out.baseline?.auditMax) { q(`delete from dbo.audit_log where audit_id > ${out.baseline.auditMax}`); q(`select setval(pg_get_serial_sequence('dbo.audit_log','audit_id'), ${out.baseline.auditMax}, true)`); }
  } catch (e) { out.restoreError = String(e.message || e).slice(0, 600); }
};
try {
  out.baseline = counts();
  await page.goto('http://127.0.0.1:5177/?app=1&autologin=ADMIN:password9080', { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.rt && window.rt.windowInstances.get('w_main') && typeof window.__menu === 'function', null, { timeout: 90000, polling: 300 });
  out.menuOpen = await page.evaluate(async (menuName) => {
    const rt = window.rt; const root = rt.windowInstances.get('w_main')?.props.get('menuid');
    const find = (o, n) => { for (const c of o.children.values()) { if (c.name === n) return c; const r = find(c, n); if (r) return r } return null };
    const item = root ? find(root, menuName) : null;
    if (!item) return { found: false };
    await rt.fire(item, 'selected').catch(() => {});
    await rt.fire(item, 'clicked').catch(() => {});
    return { found: true, visible: item.props.get('visible'), text: String(item.props.get('text') ?? '') };
  }, cfg.menu);
  await page.waitForFunction((winName) => window.rt.windowInstances.get(winName), cfg.window, { timeout: 30000, polling: 300 });
  await sleep(1500); await poll(2);
  out.open = await page.evaluate((winName) => {
    const w = window.rt.windowInstances.get(winName); const d = w.props.get('id_detail');
    return { title: String(w.props.get('title') ?? ''), rows: d?.model?.rowCount?.() ?? null, cols: d?.model?.colNames ?? null };
  }, cfg.window);
  out.fillAdd = await page.evaluate(async ({ winName, name }) => {
    const rt = window.rt; const w = rt.windowInstances.get(winName); const d = w.props.get('id_detail');
    if (!d.model.rowCount()) await d.pbCall('insertrow', [0], rt);
    await d.pbCall('setitem', [1, 'name', name], rt);
    await d.pbCall('accepttext', [], rt).catch(() => {});
    return { rows: d.model.rowCount(), values: d.model.buf.primary[0]?.v };
  }, { winName: cfg.window, name: NAME });
  out.addSave = await page.evaluate(async (winName) => {
    const rt = window.rt; const w = rt.windowInstances.get(winName);
    window.__save1 = false;
    void w.pbCall('ue_save', [], rt).then(() => { window.__save1 = 'ok' }).catch((e) => { window.__save1 = 'ERR ' + String(e.message || e).slice(0, 400) });
    return 'fired';
  }, cfg.window);
  await poll(12);
  out.afterAdd = { saveDone: await page.evaluate(() => window.__save1 ?? null), row: rows(`select ${cfg.key},name from dbo.${cfg.table} where name='${NAME}'`) };
  out.code = out.afterAdd.row?.[0]?.[0] ?? null;
  out.addOk = !!out.code && out.messages.some((m) => /Changes take effect in database/i.test(m));
  // reopen through File | List -> Detail so the identity code is in the buffer
  await page.evaluate(async (winName) => { const rt = window.rt; const w = rt.windowInstances.get(winName); void w.pbCall('ue_list', [], rt).catch(() => {}) }, cfg.window);
  for (let i = 0; i < 40; i++) { await sleep(500); const n = await page.evaluate((winName) => window.rt.windowInstances.get(winName)?.props.get('id_list')?.model?.rowCount?.() ?? 0, cfg.window); if (n > 0) { out.listRows = n; break; } await poll(1); }
  out.pick = await page.evaluate(async ({ winName, name, code }) => {
    const rt = window.rt; const w = rt.windowInstances.get(winName);
    const l = w.props.get('id_list'); const m = l.model; const ci = m.colIndex('code') >= 0 ? m.colIndex('code') : 1; const ni = m.colIndex('name');
    let hit = [...m.buf.primary.entries()].find(([, r]) => Number(r.v[ci]) === Number(code));
    if (!hit) hit = [...m.buf.primary.entries()].find(([, r]) => String(r.v[ni]) === name);
    if (!hit) return { error: 'new row not in list', rows: m.rowCount() };
    w.props.set('id_dwcontrol', l); w.props.set('il_selectedrow', hit[0] + 1);
    await w.pbCall('ue_detail', [], rt).catch(() => {});
    await new Promise((r) => setTimeout(r, 900));
    const d = w.props.get('id_detail');
    return { row: hit[0] + 1, listRows: m.rowCount(), detailRows: d?.model?.rowCount?.() ?? null, code: d?.model?.buf.primary[0]?.v?.[d.model.colIndex('code')] ?? null, name: d?.model?.buf.primary[0]?.v?.[d.model.colIndex('name')] ?? null };
  }, { winName: cfg.window, name: NAME, code: Number(out.code) });
  await poll(2);
  out.edit = await page.evaluate(async ({ winName, name2 }) => {
    const rt = window.rt; const w = rt.windowInstances.get(winName); const d = w.props.get('id_detail');
    await d.pbCall('setitem', [1, 'name', name2], rt);
    await d.pbCall('accepttext', [], rt).catch(() => {});
    window.__save2 = false;
    void w.pbCall('ue_save', [], rt).then(() => { window.__save2 = 'ok' }).catch((e) => { window.__save2 = 'ERR ' + String(e.message || e).slice(0, 400) });
    return { values: d.model.buf.primary[0]?.v };
  }, { winName: cfg.window, name2: NAME2 });
  await poll(12);
  out.afterEdit = { saveDone: await page.evaluate(() => window.__save2 ?? null), row: rows(`select ${cfg.key},name from dbo.${cfg.table} where ${cfg.key}=${Number(out.code)}`) };
  out.editOk = out.afterEdit.row?.[0]?.[1] === NAME2 && out.messages.filter((m) => /Changes take effect in database/i.test(m)).length >= 2;
  out.deleteState = await page.evaluate(async (winName) => {
    const rt = window.rt; const w = rt.windowInstances.get(winName);
    window.__delDone = false;
    void w.pbCall('ue_delete', [], rt).then(() => { window.__delDone = 'ok' }).catch((e) => { window.__delDone = 'ERR ' + String(e.message || e).slice(0, 400) });
    return 'fired';
  }, cfg.window);
  await poll(8, true);
  out.afterDelete = { delDone: await page.evaluate(() => window.__delDone ?? null), row: rows(`select ${cfg.key},name from dbo.${cfg.table} where ${cfg.key}=${Number(out.code ?? 0)}`), residue: rows(`select count(*) from dbo.${cfg.table} where name like '${cfg.prefix.replace(/'/g, "''")} %'`) };
  out.deleteOk = out.afterDelete.row?.length === 0 && out.afterDelete.residue?.[0]?.[0] === '0' && out.messages.some((m) => /Record Deleted Successfully/i.test(m));
  restore();
  out.final = counts();
  out.baselineOk = out.final.rows === out.baseline.rows && JSON.stringify(out.final.all) === JSON.stringify(out.baseline.all)
    && JSON.stringify(out.final.seq) === JSON.stringify(out.baseline.seq)
    && out.final.audit === out.baseline.audit && out.final.auditMax === out.baseline.auditMax;
  out.ok = !!out.addOk && !!out.editOk && !!out.deleteOk && out.baselineOk;
} catch (e) { out.fatal = String(e.stack || e).slice(0, 2600); }
finally {
  restore();
  console.log(JSON.stringify(out, (k, v) => (typeof v === 'bigint' ? Number(v) : v), 1));
  await browser.close().catch(() => {});
}
