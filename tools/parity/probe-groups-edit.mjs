// Groups edit/save cycle on an existing group (12, SALES OFFICER).
// The list's File | Delete is disabled in the original; new-group creation was
// proven to be an original defect (update(true,false) keeps the row flagged as
// new, so the second save re-inserts and hits the primary key).  This probe
// exercises the path that does work: open by code, change the two text fields,
// save, verify the grouprights set is unchanged, then restore exactly.
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const require = createRequire(process.env.PLAYWRIGHT_MODULES || 'C:/Users/Admin/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/');
const { chromium } = require('playwright');
const PSQL = 'C:\\PostgreSQL\\17\\bin\\psql.exe';
const q = (sql) => execFileSync(PSQL, ['-U', 'postgres', '-h', '127.0.0.1', '-d', 'trader_write_test', '-t', '-A', '-F', '|', '-c', sql], { env: { ...process.env, PGPASSWORD: 'postgres' }, encoding: 'utf8', windowsHide: true }).trim();
const rows = (sql) => q(sql).split(/\r?\n/).filter(Boolean).map((l) => l.split('|'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CODE = 12;
const MARK = 'PARITY EDIT ' + String(Date.now()).slice(-6);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const out = { code: CODE, mark: MARK, messages: [], errors: [], net: [] };
page.on('pageerror', (e) => out.errors.push(String(e.message || e).slice(0, 400)));
page.on('request', (r) => { if (r.url().includes('/api/exec')) out.net.push({ p: 'req', body: String(r.postData() || '') }) });
page.on('response', async (r) => { if (r.url().includes('/api/exec')) { let b = ''; try { b = await r.text() } catch {} out.net.push({ p: 'res', status: r.status(), body: String(b).slice(0, 300) }) } });
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
try {
  out.baseline = {
    group: rows(`select groupcode,groupname,remarks from dbo.groups where groupcode=${CODE}`),
    rights: Number(rows(`select count(*) from dbo.grouprights where groupcode=${CODE}`)[0][0]),
    audit: Number(rows('select count(*) from dbo.audit_log')[0][0]),
    auditMax: Number(rows('select max(audit_id) from dbo.audit_log')[0][0]),
    tabmax: rows("select tabmaxkey from dbo._tabmaxkey where tabname='Groups'")[0]?.[0] ?? null,
  };
  q('drop table if exists dbo.parity_g12_rights');
  q(`create table dbo.parity_g12_rights as select groupcode,rightcode,status from dbo.grouprights where groupcode=${CODE}`);
  await page.goto('http://127.0.0.1:5177/?app=1&autologin=ADMIN:password9080', { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.rt && window.rt.windowInstances.get('w_main') && typeof window.__menu === 'function', null, { timeout: 90000, polling: 300 });
  await page.evaluate(() => { void window.__menu('Manage | Groups') });
  await page.waitForFunction(() => window.rt.windowInstances.get('w_groups'), null, { timeout: 40000, polling: 300 });
  await sleep(1600); await poll(2);
  await page.evaluate(async (code) => {
    const rt = window.rt; const w = rt.windowInstances.get('w_groups');
    void w.pbCall('wf_openmywindow', [code], rt).catch(() => {});
  }, CODE);
  await page.waitForFunction(() => window.rt.windowInstances.get('w_groups_form'), null, { timeout: 30000, polling: 300 });
  await sleep(1800); await poll(2);
  out.open = await page.evaluate(() => {
    const rt = window.rt; const w = rt.windowInstances.get('w_groups_form');
    const g = w.props.get('id_group'); const r = w.props.get('id_rights');
    return {
      title: String(w.props.get('title') ?? ''),
      groupRows: g?.model?.rowCount?.() ?? null,
      groupName: g?.model ? String(g.model.buf.primary[0]?.v?.[g.model.colIndex('groupname')] ?? '') : null,
      rightsRows: r?.model?.rowCount?.() ?? null,
      rightsChecked: r?.model ? r.model.buf.primary.filter((x) => String(x.v[r.model.colIndex('checked')] ?? '').trim() === 'Y').length : null,
    };
  });
  out.fill = await page.evaluate(async ({ mark }) => {
    const rt = window.rt; const w = rt.windowInstances.get('w_groups_form');
    const g = w.props.get('id_group');
    await g.pbCall('setitem', [1, 'groupname', mark], rt).catch(() => {});
    await g.pbCall('setitem', [1, 'remarks', mark], rt).catch(() => {});
    await g.pbCall('accepttext', [], rt).catch(() => {});
    const cb = w.children.get('cb_ok');
    window.__okDone = false;
    void rt.fire(cb, 'clicked').then(() => { window.__okDone = 'ok' }).catch((e) => { window.__okDone = 'ERR ' + String(e.message || e).slice(0, 300) });
    return { rows: g.model.rowCount(), name: String(g.model.buf.primary[0]?.v?.[g.model.colIndex('groupname')] ?? ''), remarks: String(g.model.buf.primary[0]?.v?.[g.model.colIndex('remarks')] ?? '') };
  }, { mark: MARK });
  await sleep(4000); await poll(6);
  out.after = {
    formOpen: await page.evaluate(() => !!window.rt.windowInstances.get('w_groups_form')),
    okDone: await page.evaluate(() => window.__okDone ?? null),
    group: rows(`select groupcode,groupname,remarks from dbo.groups where groupcode=${CODE}`),
    rights: Number(rows(`select count(*) from dbo.grouprights where groupcode=${CODE}`)[0][0]),
    rightsDiff: rows(`select 'missing',count(*) from (select rightcode,status from dbo.parity_g12_rights except select rightcode,status from dbo.grouprights where groupcode=${CODE}) x union all select 'extra',count(*) from (select rightcode,status from dbo.grouprights where groupcode=${CODE} except select rightcode,status from dbo.parity_g12_rights) y`),
    tabmax: rows("select tabmaxkey from dbo._tabmaxkey where tabname='Groups'")[0]?.[0] ?? null,
  };
  out.editOk = out.after.group?.[0]?.[1] === MARK && out.after.group?.[0]?.[2] === MARK
    && out.after.rights === out.baseline.rights
    && out.after.rightsDiff?.every((r) => r[1] === '0')
    && out.after.formOpen === false
    && out.messages.some((m) => /Changes take effect in database/i.test(m));
  out.commitSent = out.net.some((e) => e.p === 'req' && /commit/i.test(e.body));
  // restore exactly
  const b = out.baseline.group[0];
  q(`update dbo.groups set groupname='${String(b[1]).replace(/'/g, "''")}', remarks='${String(b[2] ?? '').replace(/'/g, "''")}' where groupcode=${CODE}`);
  q(`delete from dbo.grouprights where groupcode=${CODE}`);
  q(`insert into dbo.grouprights (groupcode,rightcode,status) select groupcode,rightcode,status from dbo.parity_g12_rights`);
  q('drop table dbo.parity_g12_rights');
  if (out.baseline.tabmax !== null) q(`update dbo._tabmaxkey set tabmaxkey=${Number(out.baseline.tabmax)} where tabname='Groups'`);
  q(`delete from dbo.audit_log where audit_id > ${out.baseline.auditMax}`);
  q(`select setval(pg_get_serial_sequence('dbo.audit_log','audit_id'), ${out.baseline.auditMax}, true)`);
  out.final = {
    group: rows(`select groupcode,groupname,remarks from dbo.groups where groupcode=${CODE}`),
    rights: Number(rows(`select count(*) from dbo.grouprights where groupcode=${CODE}`)[0][0]),
    totalRights: Number(rows('select count(*) from dbo.grouprights')[0][0]),
    audit: Number(rows('select count(*) from dbo.audit_log')[0][0]),
    auditMax: Number(rows('select max(audit_id) from dbo.audit_log')[0][0]),
    tabmax: rows("select tabmaxkey from dbo._tabmaxkey where tabname='Groups'")[0]?.[0] ?? null,
    scratch: rows("select count(*) from information_schema.tables where table_schema='dbo' and table_name='parity_g12_rights'"),
  };
  out.baselineOk = JSON.stringify(out.final.group) === JSON.stringify(out.baseline.group)
    && out.final.rights === out.baseline.rights && out.final.totalRights === 688
    && out.final.audit === out.baseline.audit && out.final.auditMax === out.baseline.auditMax
    && out.final.tabmax === out.baseline.tabmax && out.final.scratch?.[0]?.[0] === '0';
  out.ok = !!out.editOk && out.baselineOk;
} catch (e) { out.fatal = String(e.stack || e).slice(0, 2000); }
finally {
  try {
    const b = out.baseline?.group?.[0];
    if (b) q(`update dbo.groups set groupname='${String(b[1]).replace(/'/g, "''")}', remarks='${String(b[2] ?? '').replace(/'/g, "''")}' where groupcode=${CODE}`);
    const has = rows("select count(*) from information_schema.tables where table_schema='dbo' and table_name='parity_g12_rights'")[0]?.[0];
    if (has === '1') {
      q(`delete from dbo.grouprights where groupcode=${CODE}`);
      q(`insert into dbo.grouprights (groupcode,rightcode,status) select groupcode,rightcode,status from dbo.parity_g12_rights`);
      q('drop table dbo.parity_g12_rights');
    }
    if (out.baseline?.tabmax !== null) q(`update dbo._tabmaxkey set tabmaxkey=${Number(out.baseline.tabmax)} where tabname='Groups'`);
    if (out.baseline?.auditMax) { q(`delete from dbo.audit_log where audit_id > ${out.baseline.auditMax}`); q(`select setval(pg_get_serial_sequence('dbo.audit_log','audit_id'), ${out.baseline.auditMax}, true)`); }
  } catch {}
  console.log(JSON.stringify(out, (k, v) => (typeof v === 'bigint' ? Number(v) : v), 1));
  await browser.close().catch(() => {});
}
