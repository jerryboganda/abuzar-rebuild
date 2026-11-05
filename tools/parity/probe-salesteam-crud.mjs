// Sales Team (Basic Data | Customer .......... | Sales Team, w_salesteam):
// hidden-by-rights multi-entry form.  Adds a team plus one member, edits it,
// then measures the File | Delete path (no ue_delete handler).  The menu item
// is invisible in both apps, so the probe opens the real sheet directly.
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
const NAME = 'PARITY SALES TEAM ' + SUF;
const NAME2 = NAME + ' EDIT';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const out = { name: NAME, name2: NAME2, messages: [], errors: [], net: [] };
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
  teams: Number(rows('select count(*) from dbo.salesteam')[0][0]),
  teamMax: Number(rows('select coalesce(max(saleteamcode),0) from dbo.salesteam')[0][0]),
  members: Number(rows('select count(*) from dbo.salesteammember')[0][0]),
  tab: rows("select tabmaxkey from dbo._tabmaxkey where tabname='SalesTeam'")[0]?.[0] ?? null,
  serverDate: rows('select lasttransdate::text from dbo.serverdate')[0]?.[0] ?? null,
  audit: Number(rows('select count(*) from dbo.audit_log')[0][0]),
  auditMax: Number(rows('select max(audit_id) from dbo.audit_log')[0][0]),
});
const restore = () => {
  try {
    killIdle();
    q(`delete from dbo.salesteammember where saleteamcode in (select saleteamcode from dbo.salesteam where name in ('${NAME.replace(/'/g, "''")}','${NAME2.replace(/'/g, "''")}'))`);
    q(`delete from dbo.salesteam where name in ('${NAME.replace(/'/g, "''")}','${NAME2.replace(/'/g, "''")}')`);
    if (out.baseline?.tab !== null) q(`update dbo._tabmaxkey set tabmaxkey=${Number(out.baseline.tab)} where tabname='SalesTeam'`);
    if (out.baseline?.serverDate) q(`update dbo.serverdate set lasttransdate='${String(out.baseline.serverDate).replace(/'/g, "''")}'::timestamp`);
    if (out.baseline?.auditMax) { q(`delete from dbo.audit_log where audit_id > ${out.baseline.auditMax}`); q(`select setval(pg_get_serial_sequence('dbo.audit_log','audit_id'), ${out.baseline.auditMax}, true)`); }
  } catch (e) { out.restoreError = String(e.message || e).slice(0, 600); }
};
try {
  out.baseline = counts();
  await page.goto('http://127.0.0.1:5177/?app=1&autologin=ADMIN:password9080', { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.rt && window.rt.windowInstances.get('w_main') && typeof window.__menu === 'function', null, { timeout: 90000, polling: 300 });
  out.menu = await page.evaluate(async () => { try { return await window.__menu('Basic Data | Customer .......... | Sales Team'); } catch (e) { return 'ERR ' + String(e.message || e); } });
  if (out.menu !== true) {
    out.openSheet = await page.evaluate(async () => {
      const rt = window.rt;
      const { Ref } = await import('/src/runtime/interp.ts');
      let win = null;
      const ref = new Ref(() => win, (v) => { win = v });
      ref.name = 'w_salesteam';
      await rt.sys.get('opensheetwithparm').fn(rt, [ref, 1, rt.windowInstances.get('w_main'), 0, 0], undefined);
      return !!rt.windowInstances.get('w_salesteam');
    });
  }
  await page.waitForFunction(() => window.rt.windowInstances.get('w_salesteam'), null, { timeout: 30000, polling: 300 });
  await sleep(1600); await poll(2);
  out.open = await page.evaluate(() => {
    const w = window.rt.windowInstances.get('w_salesteam');
    return { title: String(w.props.get('title') ?? ''), master: !!w.props.get('id_master'), detail: !!w.props.get('id_detail'), list: !!w.props.get('id_list') };
  });
  await page.evaluate(async () => { const rt = window.rt; const w = rt.windowInstances.get('w_salesteam'); await w.pbCall('ue_newform', [], rt).catch(() => {}) });
  await sleep(800); await poll(1);
  out.fill = await page.evaluate(async ({ name }) => {
    const rt = window.rt; const w = rt.windowInstances.get('w_salesteam');
    const m = w.props.get('id_master'); const d = w.props.get('id_detail');
    if (!m.model.rowCount()) await m.pbCall('insertrow', [0], rt);
    for (const [k, v] of Object.entries({ name, manfcode: 1, manager: 'PARITY MANAGER', remarks: 'PARITY SALES TEAM TEST' })) await m.pbCall('setitem', [1, k, v], rt);
    if (!d.model.rowCount()) await d.pbCall('insertrow', [0], rt);
    await d.pbCall('setitem', [1, 'salesmancode', 1], rt);
    await m.pbCall('accepttext', [], rt).catch(() => {});
    await d.pbCall('accepttext', [], rt).catch(() => {});
    return { master: m.model.buf.primary[0]?.v, detail: d.model.buf.primary[0]?.v };
  }, { name: NAME });
  out.save1 = await page.evaluate(async () => {
    const rt = window.rt; const w = rt.windowInstances.get('w_salesteam');
    window.__save1 = false;
    void w.pbCall('ue_save', [], rt).then((v) => { window.__save1 = String(v) }).catch((e) => { window.__save1 = 'ERR ' + String(e.message || e).slice(0, 500) });
    return 'fired';
  });
  await poll(14);
  out.save1Result = await page.evaluate(() => window.__save1 ?? null);
  out.afterAdd = {
    team: rows(`select saleteamcode,name,manfcode,manager,remarks from dbo.salesteam where name='${NAME}'`),
    member: rows(`select saleteamcode,salesmancode from dbo.salesteammember where saleteamcode in (select saleteamcode from dbo.salesteam where name='${NAME}')`),
    tab: rows("select tabmaxkey from dbo._tabmaxkey where tabname='SalesTeam'"),
  };
  out.code = out.afterAdd.team?.[0]?.[0] ?? null;
  out.addOk = !!out.code && out.afterAdd.member?.length === 1 && out.afterAdd.tab?.[0]?.[0] === String(Number(out.code))
    && out.messages.some((m) => /Changes take effect in database/i.test(m));
  if (out.code) {
    await page.evaluate(async () => { const rt = window.rt; const w = rt.windowInstances.get('w_salesteam'); void w.pbCall('ue_list', [], rt).catch(() => {}) });
    for (let i = 0; i < 60; i++) { await sleep(500); const n = await page.evaluate(() => window.rt.windowInstances.get('w_salesteam')?.props.get('id_list')?.model?.rowCount?.() ?? 0); if (n > 0) { out.listRows = n; break; } await poll(1); }
    out.pick = await page.evaluate(async (code) => {
      const rt = window.rt; const w = rt.windowInstances.get('w_salesteam');
      const l = w.props.get('id_list'); const m = l.model; const ci = m.colIndex('code') >= 0 ? m.colIndex('code') : 0;
      const hit = [...m.buf.primary.entries()].find(([, r]) => Number(r.v[ci]) === Number(code));
      if (!hit) return { error: 'team not in list', rows: m.rowCount() };
      w.props.set('id_dwcontrol', l); w.props.set('il_selectedrow', hit[0] + 1);
      await w.pbCall('ue_detail', [], rt).catch(() => {});
      await new Promise((r) => setTimeout(r, 900));
      const mm = w.props.get('id_master'); const dd = w.props.get('id_detail');
      return { row: hit[0] + 1, listRows: m.rowCount(), masterCode: String(mm?.model?.buf.primary[0]?.v?.[mm.model.colIndex('code')] ?? ''), detailRows: dd?.model?.rowCount?.() ?? null };
    }, Number(out.code));
    await poll(2);
    out.edit = await page.evaluate(async ({ name2 }) => {
      const rt = window.rt; const w = rt.windowInstances.get('w_salesteam'); const m = w.props.get('id_master');
      await m.pbCall('setitem', [1, 'name', name2], rt);
      await m.pbCall('setitem', [1, 'manager', 'PARITY MANAGER EDIT'], rt);
      await m.pbCall('setitem', [1, 'remarks', 'PARITY SALES TEAM EDITED'], rt);
      await m.pbCall('accepttext', [], rt).catch(() => {});
      window.__save2 = false;
      void w.pbCall('ue_save', [], rt).then((v) => { window.__save2 = String(v) }).catch((e) => { window.__save2 = 'ERR ' + String(e.message || e).slice(0, 500) });
      return { values: m.model.buf.primary[0]?.v };
    }, { name2: NAME2 });
    await poll(14);
    out.save2Result = await page.evaluate(() => window.__save2 ?? null);
    out.afterEdit = rows(`select saleteamcode,name,manager,remarks from dbo.salesteam where saleteamcode=${Number(out.code)}`)[0] ?? null;
    out.editOk = out.afterEdit?.[1] === NAME2 && out.afterEdit?.[2] === 'PARITY MANAGER EDIT' && out.afterEdit?.[3] === 'PARITY SALES TEAM EDITED';
    out.menuDelete = await page.evaluate(() => {
      const rt = window.rt; const w = rt.windowInstances.get('w_salesteam');
      const menu = w.props.get('menuid') || w.props.get('im_menu');
      let hit = null; const walk = (o) => { for (const c of o.children.values()) { if (c.name === 'm_delete') hit = hit || c; walk(c) } }; if (menu) walk(menu);
      if (!hit) return { error: 'm_delete not found' };
      const enabled = hit.props.get('enabled') !== false;
      void rt.fire(hit, 'clicked').catch(() => {});
      return { enabled, text: String(hit.props.get('text') ?? '') };
    });
    await sleep(800); await poll(4, true); await sleep(800); await poll(2, true);
    out.afterDeleteAttempt = {
      team: rows(`select count(*) from dbo.salesteam where saleteamcode=${Number(out.code)}`),
      member: rows(`select count(*) from dbo.salesteammember where saleteamcode=${Number(out.code)}`),
    };
    out.deleteNoOp = out.menuDelete?.enabled === true && out.afterDeleteAttempt.team?.[0]?.[0] === '1' && out.afterDeleteAttempt.member?.[0]?.[0] === '1';
  }
  restore();
  out.final = counts();
  out.final.residue = rows(`select count(*) from dbo.salesteam where name like 'PARITY SALES TEAM %'`);
  out.baselineOk = out.final.teams === out.baseline.teams && out.final.teamMax === out.baseline.teamMax
    && out.final.members === out.baseline.members && out.final.tab === out.baseline.tab
    && out.final.serverDate === out.baseline.serverDate
    && out.final.audit === out.baseline.audit && out.final.auditMax === out.baseline.auditMax
    && out.final.residue?.[0]?.[0] === '0';
  out.ok = !!out.addOk && !!out.editOk && !!out.deleteNoOp && out.baselineOk;
} catch (e) { out.fatal = String(e.stack || e).slice(0, 2600); }
finally {
  restore();
  console.log(JSON.stringify(out, (k, v) => (typeof v === 'bigint' ? Number(v) : v), 1));
  await browser.close().catch(() => {});
}
