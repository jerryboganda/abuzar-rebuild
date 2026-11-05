// Godown (Basic Data | Godown) full add/edit/delete cycle through the real
// w_godown_form (w_single_entry): File | Save inserts, edit updates, File |
// Delete uses the window's ue_delete (right 579) and the confirmation box.
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const require = createRequire(process.env.PLAYWRIGHT_MODULES || 'C:/Users/Admin/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/');
const { chromium } = require('playwright');
const PSQL = 'C:\\PostgreSQL\\17\\bin\\psql.exe';
const q = (sql) => execFileSync(PSQL, ['-U', 'postgres', '-h', '127.0.0.1', '-d', 'trader_write_test', '-t', '-A', '-F', '|', '-c', sql], { env: { ...process.env, PGPASSWORD: 'postgres' }, encoding: 'utf8', windowsHide: true }).trim();
const rows = (sql) => q(sql).split(/\r?\n/).filter(Boolean).map((l) => l.split('|'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SUF = String(Date.now()).slice(-6);
const NAME = 'PARITY GODOWN ' + SUF;
const NAME2 = NAME + ' EDIT';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const out = { name: NAME, name2: NAME2, messages: [], errors: [], net: [] };
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
const restore = () => {
  try {
    q(`delete from dbo.godown where name like 'PARITY GODOWN %'`);
    if (out.baseline?.tab !== null) q(`update dbo._tabmaxkey set tabmaxkey=${Number(out.baseline.tab)} where tabname='godown'`);
    if (out.baseline?.auditMax) {
      q(`delete from dbo.audit_log where audit_id > ${out.baseline.auditMax}`);
      q(`select setval(pg_get_serial_sequence('dbo.audit_log','audit_id'), ${out.baseline.auditMax}, true)`);
    }
  } catch (e) { out.restoreError = String(e.message || e).slice(0, 500); }
};
try {
  out.baseline = {
    rows: Number(rows('select count(*) from dbo.godown')[0][0]),
    tab: rows("select tabmaxkey from dbo._tabmaxkey where tabname='godown'")[0]?.[0] ?? null,
    names: rows('select gcode,name from dbo.godown order by gcode'),
    audit: Number(rows('select count(*) from dbo.audit_log')[0][0]),
    auditMax: Number(rows('select max(audit_id) from dbo.audit_log')[0][0]),
  };
  await page.goto('http://127.0.0.1:5177/?app=1&autologin=ADMIN:password9080', { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.rt && window.rt.windowInstances.get('w_main') && typeof window.__menu === 'function', null, { timeout: 90000, polling: 300 });
  out.menuOpen = await page.evaluate(async () => {
    const rt = window.rt; const root = rt.windowInstances.get('w_main')?.props.get('menuid');
    const find = (o, n) => { for (const c of o.children.values()) { if (c.name === n) return c; const r = find(c, n); if (r) return r } return null };
    const item = root ? find(root, 'm_godown') : null;
    if (!item) return { found: false };
    await rt.fire(item, 'selected').catch(() => {});
    await rt.fire(item, 'clicked').catch((e) => { window.__menuErr = String(e.message || e) });
    return { found: true, visible: item.props.get('visible'), text: String(item.props.get('text') ?? '') };
  });
  await page.waitForFunction(() => window.rt.windowInstances.get('w_godown_form'), null, { timeout: 40000, polling: 300 });
  await sleep(1500); await poll(2);
  out.open = await page.evaluate(() => {
    const rt = window.rt; const w = rt.windowInstances.get('w_godown_form');
    const d = w.props.get('id_detail');
    return { title: String(w.props.get('title') ?? ''), rows: d?.model?.rowCount?.() ?? null, cols: d?.model?.colNames ?? null, first: d?.model?.buf?.primary?.[0]?.v ?? null };
  });
  out.fillAdd = await page.evaluate(async ({ name }) => {
    const rt = window.rt; const w = rt.windowInstances.get('w_godown_form');
    const d = w.props.get('id_detail');
    if (!d?.model) return { error: 'no detail' };
    if (d.model.rowCount() === 0) await d.pbCall('insertrow', [0], rt);
    const set = async (n, v) => { try { await d.pbCall('setitem', [1, n, v], rt) } catch {} };
    for (const [n, v] of Object.entries({ name, location: 'PARITY LOCATION', godowngroupcode: 1, autosatisfydue: 'N', considerstockinpo: 'Y', localgodownname: 'PARITY LOCAL ' + name.slice(-6) })) await set(n, v);
    await d.pbCall('accepttext', [], rt).catch(() => {});
    return { rows: d.model.rowCount(), values: d.model.buf.primary[0]?.v };
  }, { name: NAME });
  out.addSave = await page.evaluate(async () => {
    const rt = window.rt; const w = rt.windowInstances.get('w_godown_form');
    window.__saveDone = false;
    void w.pbCall('ue_save', [], rt).then(() => { window.__saveDone = 'ok' }).catch((e) => { window.__saveDone = 'ERR ' + String(e.message || e).slice(0, 300) });
    return 'fired';
  });
  await poll(8);
  out.afterAdd = {
    saveDone: await page.evaluate(() => window.__saveDone ?? null),
    row: rows(`select gcode,name,location,godowngroupcode,autosatisfydue,considerstockinpo,localgodownname from dbo.godown where name='${NAME}'`),
    tab: rows("select tabmaxkey from dbo._tabmaxkey where tabname='godown'"),
  };
  out.code = out.afterAdd.row?.[0]?.[0] ?? null;
  out.addOk = !!out.code && out.afterAdd.tab?.[0]?.[0] === String(Number(out.code)) && out.messages.some((m) => /Changes take effect in database/i.test(m));
  // edit
  out.fillEdit = await page.evaluate(async ({ name2 }) => {
    const rt = window.rt; const w = rt.windowInstances.get('w_godown_form');
    const d = w.props.get('id_detail');
    await d.pbCall('setitem', [1, 'name', name2], rt).catch(() => {});
    await d.pbCall('setitem', [1, 'location', 'PARITY LOCATION EDITED'], rt).catch(() => {});
    await d.pbCall('accepttext', [], rt).catch(() => {});
    window.__saveDone2 = false;
    void w.pbCall('ue_save', [], rt).then(() => { window.__saveDone2 = 'ok' }).catch((e) => { window.__saveDone2 = 'ERR ' + String(e.message || e).slice(0, 300) });
    return { values: d.model.buf.primary[0]?.v };
  }, { name2: NAME2 });
  await poll(8);
  out.afterEdit = {
    saveDone: await page.evaluate(() => window.__saveDone2 ?? null),
    row: rows(`select gcode,name,location from dbo.godown where gcode=${Number(out.code)}`),
  };
  out.editOk = out.afterEdit.row?.[0]?.[1] === NAME2 && out.afterEdit.row?.[0]?.[2] === 'PARITY LOCATION EDITED'
    && out.messages.filter((m) => /Changes take effect in database/i.test(m)).length >= 2;
  // delete through the window's ue_delete (right 579 + confirmation).  The
  // File | Delete menu was measured disabled on the new/edit form; the
  // single-entry CRUD harness uses this same event for the other masters.
  out.deleteState = await page.evaluate(async () => {
    const rt = window.rt; const w = rt.windowInstances.get('w_godown_form');
    const menu = w.props.get('menuid') || w.props.get('im_menu');
    const find = (o, n) => { for (const c of o.children.values()) { if (c.name === n) return c; const r = find(c, n); if (r) return r } return null };
    const del = menu ? find(menu, 'm_delete') : null;
    window.__delDone = false;
    void w.pbCall('ue_delete', [], rt).then(() => { window.__delDone = 'ok' }).catch((e) => { window.__delDone = 'ERR ' + String(e.message || e).slice(0, 300) });
    return { found: !!del, enabled: del ? del.props.get('enabled') !== false : null };
  });
  await poll(10);
  out.afterDelete = {
    delDone: await page.evaluate(() => window.__delDone ?? null),
    row: rows(`select gcode,name from dbo.godown where gcode=${Number(out.code ?? 0)}`),
    residue: rows(`select count(*) from dbo.godown where name like 'PARITY GODOWN %'`),
    tab: rows("select tabmaxkey from dbo._tabmaxkey where tabname='godown'"),
  };
  out.deleteOk = out.afterDelete.row?.length === 0 && out.afterDelete.residue?.[0]?.[0] === '0'
    && out.messages.some((m) => /Record Deleted Successfully/i.test(m));
  restore();
  out.final = {
    rows: Number(rows('select count(*) from dbo.godown')[0][0]),
    names: rows('select gcode,name from dbo.godown order by gcode'),
    tab: rows("select tabmaxkey from dbo._tabmaxkey where tabname='godown'")[0]?.[0] ?? null,
    audit: Number(rows('select count(*) from dbo.audit_log')[0][0]),
    auditMax: Number(rows('select max(audit_id) from dbo.audit_log')[0][0]),
  };
  out.baselineOk = out.final.rows === out.baseline.rows && JSON.stringify(out.final.names) === JSON.stringify(out.baseline.names)
    && out.final.tab === out.baseline.tab && out.final.audit === out.baseline.audit && out.final.auditMax === out.baseline.auditMax;
  out.ok = !!out.addOk && !!out.editOk && !!out.deleteOk && out.baselineOk;
} catch (e) { out.fatal = String(e.stack || e).slice(0, 2000); }
finally {
  restore();
  console.log(JSON.stringify(out, (k, v) => (typeof v === 'bigint' ? Number(v) : v), 1));
  await browser.close().catch(() => {});
}
