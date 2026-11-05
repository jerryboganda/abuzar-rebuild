// Groups (Manage | Groups) add/edit/save cycle.
// The list's File | Delete is disabled in the original, so cleanup removes the
// created group and its default godown/header rows with SQL, restoring the
// Groups counter and audit rows exactly.
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const require = createRequire(process.env.PLAYWRIGHT_MODULES || 'C:/Users/Admin/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/');
const { chromium } = require('playwright');
const PSQL = 'C:\\PostgreSQL\\17\\bin\\psql.exe';
const q = (sql) => execFileSync(PSQL, ['-U', 'postgres', '-h', '127.0.0.1', '-d', 'trader_write_test', '-t', '-A', '-F', '|', '-c', sql], { env: { ...process.env, PGPASSWORD: 'postgres' }, encoding: 'utf8', windowsHide: true }).trim();
const rows = (sql) => q(sql).split(/\r?\n/).filter(Boolean).map((l) => l.split('|'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const NAME = 'PARITY GROUP ' + String(Date.now()).slice(-6);
const NAME2 = NAME + ' EDIT';
const REMARKS = 'PARITY GROUPS TEST';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const out = { name: NAME, name2: NAME2, messages: [], errors: [], net: [] };
page.on('pageerror', (e) => out.errors.push(String(e.message || e).slice(0, 400)));
page.on('request', (r) => { if (r.url().includes('/api/exec')) out.net.push({ p: 'req', body: String(r.postData() || '') }) });
page.on('response', async (r) => { if (r.url().includes('/api/exec')) { let b = ''; try { b = await r.text() } catch {} out.net.push({ p: 'res', status: r.status(), body: String(b).slice(0, 400) }) } });
async function poll(seconds = 8) {
  for (let i = 0; i < seconds * 2; i++) {
    await sleep(500);
    const msgs = await page.evaluate(() => [...document.querySelectorAll('.msgbox .txt')].map((e) => e.textContent.replace(/\s+/g, ' ').trim().slice(0, 240)));
    if (msgs.length) {
      out.messages.push(...msgs);
      await page.evaluate(() => { for (const b of document.querySelectorAll('.msgbox')) { const bs = [...b.querySelectorAll('.btns button')]; (bs.find((x) => /^(ok|yes)$/i.test(x.textContent.trim())) || bs[0])?.click(); } });
      await sleep(250);
    }
  }
}
const findDw = (w, n) => {
  const walk = (o) => { for (const c of o.children.values()) { if (c.name === n && c.model) return c; const r = walk(c); if (r) return r } return null };
  return walk(w);
};
try {
  out.baseline = {
    groups: Number(rows('select count(*) from dbo.groups')[0][0]),
    godown: Number(rows('select count(*) from dbo.groupallowedgodown')[0][0]),
    header: Number(rows('select count(*) from dbo.groupallowedheader')[0][0]),
    rights: Number(rows('select count(*) from dbo.grouprights')[0][0]),
    price: Number(rows('select count(*) from dbo.groupallowedprice')[0][0]),
    cash: Number(rows('select count(*) from dbo.groupcashaccount')[0][0]),
    tabmax: rows("select tabmaxkey from dbo._tabmaxkey where tabname='Groups'")[0]?.[0] ?? null,
    audit: Number(rows('select count(*) from dbo.audit_log')[0][0]),
    auditMax: Number(rows('select max(audit_id) from dbo.audit_log')[0][0]),
  };
  await page.goto('http://127.0.0.1:5177/?app=1&autologin=ADMIN:password9080', { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.rt && window.rt.windowInstances.get('w_main') && typeof window.__menu === 'function', null, { timeout: 90000, polling: 300 });
  await page.evaluate(() => { void window.__menu('Manage | Groups') });
  await page.waitForFunction(() => window.rt.windowInstances.get('w_groups'), null, { timeout: 40000, polling: 300 });
  await sleep(1800); await poll(2);
  out.list = await page.evaluate(() => {
    const rt = window.rt; const w = rt.windowInstances.get('w_groups');
    const l = w.props.get('id_list');
    return { title: String(w.props.get('title') ?? ''), rows: l?.model?.rowCount?.() ?? null, cols: l?.model?.colNames ?? null, selected: String(w.props.get('il_selectedrow') ?? '') };
  });
  // open the form in new mode
  await page.evaluate(async () => {
    const rt = window.rt; const w = rt.windowInstances.get('w_groups');
    void w.pbCall('wf_openmywindow', [0], rt).catch(() => {});
  });
  await page.waitForFunction(() => window.rt.windowInstances.get('w_groups_form'), null, { timeout: 30000, polling: 300 });
  await sleep(1800); await poll(2);
  out.open = await page.evaluate(() => {
    const rt = window.rt; const w = rt.windowInstances.get('w_groups_form');
    const g = w.props.get('id_group'); const r = w.props.get('id_rights');
    return { title: String(w.props.get('title') ?? ''), groupRows: g?.model?.rowCount?.() ?? null, groupCols: g?.model?.colNames ?? null, rightsRows: r?.model?.rowCount?.() ?? null, ilCode: String(w.props.get('il_code') ?? '') };
  });
  out.fillNew = await page.evaluate(async ({ name, remarks }) => {
    const rt = window.rt; const w = rt.windowInstances.get('w_groups_form');
    const g = w.props.get('id_group');
    if (!g?.model) return { error: 'no id_group' };
    if (g.model.rowCount() === 0) await g.pbCall('insertrow', [0], rt);
    const bad = [];
    const set = async (n, v) => { try { await g.pbCall('setitem', [1, n, v], rt) } catch (e) { bad.push(n + ':' + String(e.message || e).slice(0, 60)) } };
    for (const [n, v] of Object.entries({ groupname: name, remarks, autorefreshitemlist: 'N', salepriceinitemlist: 1, consideralldiscountsonitem: 'Y', accumulateddiscperc: 0, accumdiscperccaution: 0 })) await set(n, v);
    await g.pbCall('accepttext', [], rt).catch(() => {});
    // the save always rebuilds rights; at least one checked row is required
    const rights = w.props.get('id_rights');
    let rightsChecked = 0;
    if (rights?.model?.rowCount?.() > 0) {
      const n = rights.model.rowCount();
      for (let i = 1; i <= n; i++) await rights.pbCall('setitem', [i, 'checked', 'Y'], rt).catch(() => {});
      await rights.pbCall('accepttext', [], rt).catch(() => {});
      rightsChecked = n;
    }
    w.props.set('il_protect', 0);
    window.__saveDone = false;
    w.pbCall('cb_ok', [], rt).catch(() => {});
    // cb_ok is a control, not a method; fire it if the call above did nothing
    const cb = w.children.get('cb_ok');
    if (cb) void rt.fire(cb, 'clicked').catch(() => {});
    return { bad, rightsChecked, rows: g.model.rowCount(), values: g.model.buf.primary[0]?.v?.slice(0, 12) };
  }, { name: NAME, remarks: REMARKS });
  await poll(12);
  out.afterAdd = {
    group: rows(`select groupcode,groupname,remarks,autorefreshitemlist,salepriceinitemlist from dbo.groups where groupname='${NAME}'`),
    godown: rows(`select count(*) from dbo.groupallowedgodown where groupcode in (select groupcode from dbo.groups where groupname='${NAME}')`),
    header: rows(`select count(*) from dbo.groupallowedheader where groupcode in (select groupcode from dbo.groups where groupname='${NAME}')`),
    rights: rows(`select count(*) from dbo.grouprights where groupcode in (select groupcode from dbo.groups where groupname='${NAME}')`),
    tabmax: rows("select tabmaxkey from dbo._tabmaxkey where tabname='Groups'"),
    formOpen: await page.evaluate(() => !!window.rt.windowInstances.get('w_groups_form')),
  };
  out.debug = await page.evaluate(() => {
    const rt = window.rt; const w = rt.windowInstances.get('w_groups_form');
    if (!w) return { form: false };
    const vis = w.props.get('id_rights'); const hid = w.props.get('id_rights_hidden');
    return {
      form: true,
      visRows: vis?.model?.rowCount?.() ?? null,
      visChecked: vis?.model ? String(vis.model.buf.primary[0]?.v?.[vis.model.colIndex('checked')] ?? '') : null,
      hidRows: hid?.model?.rowCount?.() ?? null,
      hidFirst: hid?.model?.buf?.primary?.[0]?.v ?? null,
    };
  });
  out.code = out.afterAdd.group?.[0]?.[0] ?? null;
  out.addOk = !!out.code && out.afterAdd.group?.[0]?.[1] === NAME && out.afterAdd.godown?.[0]?.[0] === '8' && out.afterAdd.header?.[0]?.[0] === '8' && out.afterAdd.tabmax?.[0]?.[0] === String(Number(out.code));
  // edit/save
  await page.evaluate(async (code) => {
    const rt = window.rt; const w = rt.windowInstances.get('w_groups');
    void w.pbCall('wf_openmywindow', [code], rt).catch(() => {});
  }, Number(out.code));
  await page.waitForFunction(() => window.rt.windowInstances.get('w_groups_form'), null, { timeout: 30000, polling: 300 });
  await sleep(1600); await poll(2);
  out.editFill = await page.evaluate(async ({ name2, remarks }) => {
    const rt = window.rt; const w = rt.windowInstances.get('w_groups_form');
    const g = w.props.get('id_group');
    if (!g?.model) return { error: 'no id_group' };
    await g.pbCall('setitem', [1, 'groupname', name2], rt).catch((e) => { window.__e = String(e.message) });
    await g.pbCall('setitem', [1, 'remarks', remarks + ' EDITED'], rt).catch(() => {});
    await g.pbCall('accepttext', [], rt).catch(() => {});
    const cb = w.children.get('cb_ok');
    window.__saveDone = false;
    if (cb) void rt.fire(cb, 'clicked').catch((e) => { window.__saveDone = 'ERR ' + String(e.message || e).slice(0, 200) });
    return { rows: g.model.rowCount(), values: g.model.buf.primary[0]?.v?.slice(0, 8), err: String(window.__e ?? '') };
  }, { name2: NAME2, remarks: REMARKS });
  await poll(12);
  out.afterEdit = rows(`select groupcode,groupname,remarks from dbo.groups where groupcode=${Number(out.code)}`);
  out.editOk = out.afterEdit?.[0]?.[1] === NAME2 && String(out.afterEdit?.[0]?.[2] || '').endsWith('EDITED');
  // delete attempt: list's File | Delete is disabled in the original
  out.delete = await page.evaluate(() => {
    const rt = window.rt; const w = rt.windowInstances.get('w_groups');
    const menu = w.props.get('menuid') || w.props.get('im_menu');
    let del = null;
    const walk = (o) => { for (const c of o.children.values()) { if (c.name === 'm_delete') del = c; walk(c) } };
    if (menu) walk(menu);
    if (!del) return { found: false };
    return { found: true, enabled: del.props.get('enabled') !== false };
  });
  await poll(3);
  out.deleteResidue = out.code ? rows(`select count(*) from dbo.groups where groupcode=${Number(out.code)}`) : null;
  // exact cleanup (the delete is disabled in the original)
  if (out.code) {
    q(`delete from dbo.grouprights where groupcode=${Number(out.code)}`);
    q(`delete from dbo.groupallowedgodown where groupcode=${Number(out.code)}`);
    q(`delete from dbo.groupallowedheader where groupcode=${Number(out.code)}`);
    q(`delete from dbo.groups where groupcode=${Number(out.code)}`);
  }
  const bt = out.baseline.tabmax;
  if (bt !== null) q(`update dbo._tabmaxkey set tabmaxkey=${Number(bt)} where tabname='Groups'`);
  q(`delete from dbo.audit_log where audit_id > ${out.baseline.auditMax}`);
  q(`select setval(pg_get_serial_sequence('dbo.audit_log','audit_id'), ${out.baseline.auditMax}, true)`);
  out.final = {
    groups: Number(rows('select count(*) from dbo.groups')[0][0]),
    godown: Number(rows('select count(*) from dbo.groupallowedgodown')[0][0]),
    header: Number(rows('select count(*) from dbo.groupallowedheader')[0][0]),
    rights: Number(rows('select count(*) from dbo.grouprights')[0][0]),
    price: Number(rows('select count(*) from dbo.groupallowedprice')[0][0]),
    cash: Number(rows('select count(*) from dbo.groupcashaccount')[0][0]),
    tabmax: rows("select tabmaxkey from dbo._tabmaxkey where tabname='Groups'")[0]?.[0] ?? null,
    audit: Number(rows('select count(*) from dbo.audit_log')[0][0]),
    auditMax: Number(rows('select max(audit_id) from dbo.audit_log')[0][0]),
    residue: rows(`select count(*) from dbo.groups where groupname like 'PARITY GROUP %'`),
  };
  out.baselineOk = out.final.groups === out.baseline.groups && out.final.godown === out.baseline.godown && out.final.header === out.baseline.header && out.final.rights === out.baseline.rights && out.final.price === out.baseline.price && out.final.cash === out.baseline.cash && out.final.tabmax === out.baseline.tabmax && out.final.audit === out.baseline.audit && out.final.auditMax === out.baseline.auditMax && out.final.residue?.[0]?.[0] === '0';
  out.ok = !!out.addOk && !!out.editOk && out.baselineOk;
} catch (e) { out.fatal = String(e.stack || e).slice(0, 2000); }
finally {
  try {
    if (out.code) {
      q(`delete from dbo.grouprights where groupcode=${Number(out.code)}`);
      q(`delete from dbo.groupallowedgodown where groupcode=${Number(out.code)}`);
      q(`delete from dbo.groupallowedheader where groupcode=${Number(out.code)}`);
      q(`delete from dbo.groups where groupcode=${Number(out.code)}`);
    }
    if (out.baseline?.tabmax !== null) q(`update dbo._tabmaxkey set tabmaxkey=${Number(out.baseline.tabmax)} where tabname='Groups'`);
    if (out.baseline?.auditMax) { q(`delete from dbo.audit_log where audit_id > ${out.baseline.auditMax}`); q(`select setval(pg_get_serial_sequence('dbo.audit_log','audit_id'), ${out.baseline.auditMax}, true)`); }
  } catch {}
  console.log(JSON.stringify(out, (k, v) => (typeof v === 'bigint' ? Number(v) : v), 1));
  await browser.close().catch(() => {});
}
