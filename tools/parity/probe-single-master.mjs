// Generic single-entry master CRUD probe (add/edit/delete/save) with exact
// table/tabmax/audit restore.  Usage: node probe-single-master.mjs region
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const require = createRequire(process.env.PLAYWRIGHT_MODULES || 'C:/Users/Admin/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/');
const { chromium } = require('playwright');
const PSQL = 'C:\\PostgreSQL\\17\\bin\\psql.exe';
const q = (sql) => execFileSync(PSQL, ['-U', 'postgres', '-h', '127.0.0.1', '-d', 'trader_write_test', '-t', '-A', '-F', '|', '-c', sql], { env: { ...process.env, PGPASSWORD: 'postgres' }, encoding: 'utf8', windowsHide: true }).trim();
const rows = (sql) => q(sql).split(/\r?\n/).filter(Boolean).map((l) => l.split('|'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CONFIGS = {
  region: {
    menu: 'm_region0', window: 'w_region_form', table: 'region', key: 'regioncode', tab: 'Region', prefix: 'PARITY REGION',
    fields: { name: '{{name}}', manager: 'PARITY MANAGER', remarks: 'PARITY REMARKS' },
    edit: { manager: 'PARITY MANAGER EDITED', remarks: 'PARITY REMARKS EDITED' },
  },
  subarea: {
    menu: 'm_subarea', window: 'w_subarea_form', table: 'subarea', key: 'subareacode', tab: 'SubArea', prefix: 'PARITY SUBAREA',
    fields: { name: '{{name}}', manager: 'PARITY MANAGER', areacode: 1, distance: 1 },
    edit: { manager: 'PARITY MANAGER EDITED', distance: 2 },
  },
  salesman: {
    menu: 'm_salesperson', window: 'w_salesman_form', table: 'salesman', key: 'salesmancode', tab: 'salesman', prefix: 'PARITY SALESMAN',
    fields: { name: '{{name}}', address: 'PARITY ADDRESS', phone: '03001234567', nicno: 'PARITY NIC', active: 'Y', outstandinglimit: 0, saleperson: 'Y', deliveryperson: 'Y', recoveryperson: 'Y', saletarget: 0 },
    edit: { address: 'PARITY ADDRESS EDITED', phone: '03007654321' },
  },
  itempacking: {
    menu: 'm_itempacking0', window: 'w_itempacking_form', table: 'itempacking', key: 'packcode', tab: 'ItemPacking', prefix: 'PARITYPK',
    fields: { name: '{{name}}', numericalfactor: 1 },
    edit: { numericalfactor: 2 },
  },
};
const key = process.argv[2] || 'region';
const cfg = CONFIGS[key];
if (!cfg) throw new Error('unknown config ' + key);
const SUF = String(Date.now()).slice(-6);
const NAME = cfg.prefix + ' ' + SUF;
const NAME2 = NAME + ' EDIT';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const out = { config: key, name: NAME, name2: NAME2, messages: [], errors: [], net: [] };
page.on('pageerror', (e) => out.errors.push(String(e.message || e).slice(0, 400)));
page.on('request', (r) => { if (r.url().includes('/api/exec')) out.net.push({ p: 'req', body: String(r.postData() || '') }) });
page.on('response', async (r) => { if (r.url().includes('/api/exec')) { let b = ''; try { b = await r.text() } catch {} out.net.push({ p: 'res', status: r.status(), body: String(b).slice(0, 300) }) } });
async function poll(seconds = 8) {
  for (let i = 0; i < seconds * 2; i++) {
    await sleep(500);
    const msgs = await page.evaluate(() => [...document.querySelectorAll('.msgbox .txt')].map((e) => e.textContent.replace(/\s+/g, ' ').trim().slice(0, 240)));
    if (msgs.length) {
      out.messages.push(...msgs);
      await page.evaluate(() => { for (const b of document.querySelectorAll('.msgbox')) { const bs = [...b.querySelectorAll('.btns button')]; (bs.find((x) => /^yes$/i.test(x.textContent.trim())) || bs.find((x) => /^(ok|no|close)$/i.test(x.textContent.trim())) || bs[0])?.click(); } });
      await sleep(250);
    }
  }
}
const resolve = (v) => typeof v === 'string' ? v.replace(/\{\{name\}\}/g, NAME) : v;
const restore = () => {
  try {
    q(`delete from dbo.${cfg.table} where name like '${cfg.prefix.replace(/'/g, "''")} %'`);
    if (out.baseline?.tab !== null) q(`update dbo._tabmaxkey set tabmaxkey=${Number(out.baseline.tab)} where tabname='${cfg.tab}'`);
    if (out.baseline?.auditMax) {
      q(`delete from dbo.audit_log where audit_id > ${out.baseline.auditMax}`);
      q(`select setval(pg_get_serial_sequence('dbo.audit_log','audit_id'), ${out.baseline.auditMax}, true)`);
    }
  } catch (e) { out.restoreError = String(e.message || e).slice(0, 500); }
};
try {
  out.baseline = {
    rows: Number(rows(`select count(*) from dbo.${cfg.table}`)[0][0]),
    all: rows(`select ${cfg.key},name from dbo.${cfg.table} order by ${cfg.key}`),
    tab: rows(`select tabmaxkey from dbo._tabmaxkey where tabname='${cfg.tab}'`)[0]?.[0] ?? null,
    audit: Number(rows('select count(*) from dbo.audit_log')[0][0]),
    auditMax: Number(rows('select max(audit_id) from dbo.audit_log')[0][0]),
  };
  await page.goto('http://127.0.0.1:5177/?app=1&autologin=ADMIN:password9080', { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.rt && window.rt.windowInstances.get('w_main') && typeof window.__menu === 'function', null, { timeout: 90000, polling: 300 });
  out.menuOpen = await page.evaluate(async (menuName) => {
    const rt = window.rt; const root = rt.windowInstances.get('w_main')?.props.get('menuid');
    const find = (o, n) => { for (const c of o.children.values()) { if (c.name === n) return c; const r = find(c, n); if (r) return r } return null };
    const item = root ? find(root, menuName) : null;
    if (!item) return { found: false };
    await rt.fire(item, 'selected').catch(() => {});
    await rt.fire(item, 'clicked').catch((e) => { window.__menuErr = String(e.message || e) });
    return { found: true, visible: item.props.get('visible'), text: String(item.props.get('text') ?? '') };
  }, cfg.menu);
  await page.waitForFunction((winName) => window.rt.windowInstances.get(winName), cfg.window, { timeout: 40000, polling: 300 });
  await sleep(1500); await poll(2);
  out.open = await page.evaluate((winName) => {
    const rt = window.rt; const w = rt.windowInstances.get(winName);
    const d = w.props.get('id_detail');
    return { title: String(w.props.get('title') ?? ''), rows: d?.model?.rowCount?.() ?? null, cols: d?.model?.colNames ?? null };
  }, cfg.window);
  const fields = Object.fromEntries(Object.entries(cfg.fields).map(([k, v]) => [k, resolve(v)]));
  out.fillAdd = await page.evaluate(async ({ winName, fields }) => {
    const rt = window.rt; const w = rt.windowInstances.get(winName);
    const d = w.props.get('id_detail');
    if (!d?.model) return { error: 'no detail' };
    if (d.model.rowCount() === 0) await d.pbCall('insertrow', [0], rt);
    const set = async (n, v) => { try { await d.pbCall('setitem', [1, n, v], rt) } catch {} };
    for (const [n, v] of Object.entries(fields)) await set(n, v);
    await d.pbCall('accepttext', [], rt).catch(() => {});
    return { rows: d.model.rowCount(), values: d.model.buf.primary[0]?.v };
  }, { winName: cfg.window, fields });
  out.addSave = await page.evaluate(async (winName) => {
    const rt = window.rt; const w = rt.windowInstances.get(winName);
    window.__saveDone = false;
    void w.pbCall('ue_save', [], rt).then(() => { window.__saveDone = 'ok' }).catch((e) => { window.__saveDone = 'ERR ' + String(e.message || e).slice(0, 300) });
    return 'fired';
  }, cfg.window);
  await poll(8);
  out.afterAdd = {
    saveDone: await page.evaluate(() => window.__saveDone ?? null),
    row: rows(`select ${cfg.key},name from dbo.${cfg.table} where name='${NAME}'`),
    tab: rows(`select tabmaxkey from dbo._tabmaxkey where tabname='${cfg.tab}'`),
  };
  out.code = out.afterAdd.row?.[0]?.[0] ?? null;
  out.addOk = !!out.code && out.afterAdd.tab?.[0]?.[0] === String(Number(out.code)) && out.messages.some((m) => /Changes take effect in database/i.test(m));
  // edit: name + config-specific secondary fields
  const editFields = { name: NAME2, ...cfg.edit };
  out.fillEdit = await page.evaluate(async ({ winName, editFields }) => {
    const rt = window.rt; const w = rt.windowInstances.get(winName);
    const d = w.props.get('id_detail');
    for (const [n, v] of Object.entries(editFields)) await d.pbCall('setitem', [1, n, v], rt).catch(() => {});
    await d.pbCall('accepttext', [], rt).catch(() => {});
    window.__saveDone2 = false;
    void w.pbCall('ue_save', [], rt).then(() => { window.__saveDone2 = 'ok' }).catch((e) => { window.__saveDone2 = 'ERR ' + String(e.message || e).slice(0, 300) });
    return { values: d.model.buf.primary[0]?.v };
  }, { winName: cfg.window, editFields });
  await poll(8);
  out.afterEdit = {
    saveDone: await page.evaluate(() => window.__saveDone2 ?? null),
    row: rows(`select ${cfg.key},name from dbo.${cfg.table} where ${cfg.key}=${Number(out.code)}`),
  };
  out.editOk = out.afterEdit.row?.[0]?.[1] === NAME2 && out.messages.filter((m) => /Changes take effect in database/i.test(m)).length >= 2;
  // delete via ue_delete (right 579)
  out.deleteState = await page.evaluate(async (winName) => {
    const rt = window.rt; const w = rt.windowInstances.get(winName);
    const menu = w.props.get('menuid') || w.props.get('im_menu');
    const find = (o, n) => { for (const c of o.children.values()) { if (c.name === n) return c; const r = find(c, n); if (r) return r } return null };
    const del = menu ? find(menu, 'm_delete') : null;
    window.__delDone = false;
    void w.pbCall('ue_delete', [], rt).then(() => { window.__delDone = 'ok' }).catch((e) => { window.__delDone = 'ERR ' + String(e.message || e).slice(0, 300) });
    return { found: !!del, enabled: del ? del.props.get('enabled') !== false : null };
  }, cfg.window);
  await poll(10);
  out.afterDelete = {
    delDone: await page.evaluate(() => window.__delDone ?? null),
    row: rows(`select ${cfg.key},name from dbo.${cfg.table} where ${cfg.key}=${Number(out.code ?? 0)}`),
    residue: rows(`select count(*) from dbo.${cfg.table} where name like '${cfg.prefix.replace(/'/g, "''")} %'`),
    tab: rows(`select tabmaxkey from dbo._tabmaxkey where tabname='${cfg.tab}'`),
  };
  out.deleteOk = out.afterDelete.row?.length === 0 && out.afterDelete.residue?.[0]?.[0] === '0' && out.messages.some((m) => /Record Deleted Successfully/i.test(m));
  restore();
  out.final = {
    rows: Number(rows(`select count(*) from dbo.${cfg.table}`)[0][0]),
    all: rows(`select ${cfg.key},name from dbo.${cfg.table} order by ${cfg.key}`),
    tab: rows(`select tabmaxkey from dbo._tabmaxkey where tabname='${cfg.tab}'`)[0]?.[0] ?? null,
    audit: Number(rows('select count(*) from dbo.audit_log')[0][0]),
    auditMax: Number(rows('select max(audit_id) from dbo.audit_log')[0][0]),
  };
  out.baselineOk = out.final.rows === out.baseline.rows && JSON.stringify(out.final.all) === JSON.stringify(out.baseline.all)
    && out.final.tab === out.baseline.tab && out.final.audit === out.baseline.audit && out.final.auditMax === out.baseline.auditMax;
  out.ok = !!out.addOk && !!out.editOk && !!out.deleteOk && out.baselineOk;
} catch (e) { out.fatal = String(e.stack || e).slice(0, 2000); }
finally {
  restore();
  console.log(JSON.stringify(out, (k, v) => (typeof v === 'bigint' ? Number(v) : v), 1));
  await browser.close().catch(() => {});
}
