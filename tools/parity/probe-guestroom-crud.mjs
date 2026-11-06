// Guest Room (m_guestroom -> w_guestroom_form): add/edit a room with temporary
// floor/type/status fixtures, measure the File | Delete path, then remove all
// fixtures and restore the GuestRoom tab counter and audit log exactly.
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
const NAME = 'PARITY ROOM ' + SUF;
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
  rooms: Number(rows('select count(*) from dbo.guestroom')[0][0]),
  floors: Number(rows('select count(*) from dbo.guestroomfloor')[0][0]),
  types: Number(rows('select count(*) from dbo.guestroomtype')[0][0]),
  statuses: Number(rows('select count(*) from dbo.guestroomstatus')[0][0]),
  services: Number(rows('select count(*) from dbo.guestroomservice')[0][0]),
  tab: rows("select tabmaxkey from dbo._tabmaxkey where tabname='GuestRoom'")[0]?.[0] ?? null,
  audit: Number(rows('select count(*) from dbo.audit_log')[0][0]),
  auditMax: Number(rows('select max(audit_id) from dbo.audit_log')[0][0]),
});
const restore = () => {
  try {
    killIdle();
    q(`delete from dbo.guestroomservice where guestroomcode in (select guestroomcode from dbo.guestroom where name in ('${NAME.replace(/'/g, "''")}','${NAME2.replace(/'/g, "''")}'))`);
    q(`delete from dbo.guestroom where name in ('${NAME.replace(/'/g, "''")}','${NAME2.replace(/'/g, "''")}')`);
    q("delete from dbo.guestroomfloor where name='PARITY FLOOR FIXTURE'");
    q("delete from dbo.guestroomtype where name='PARITY TYPE FIXTURE'");
    q("delete from dbo.guestroomstatus where name='PARITY STATUS FIXTURE'");
    if (out.baseline?.tab !== null) q(`update dbo._tabmaxkey set tabmaxkey=${Number(out.baseline.tab)} where tabname='GuestRoom'`);
    if (out.baseline?.auditMax) { q(`delete from dbo.audit_log where audit_id > ${out.baseline.auditMax}`); q(`select setval(pg_get_serial_sequence('dbo.audit_log','audit_id'), ${out.baseline.auditMax}, true)`); }
  } catch (e) { out.restoreError = String(e.message || e).slice(0, 600); }
};
try {
  out.baseline = counts();
  q("insert into dbo.guestroomfloor (guestroomfloorcode,name) values (1,'PARITY FLOOR FIXTURE')");
  q("insert into dbo.guestroomtype (guestroomtypecode,name) values (1,'PARITY TYPE FIXTURE')");
  q("insert into dbo.guestroomstatus (guestroomstatuscode,name) values (1,'PARITY STATUS FIXTURE')");
  await page.goto('http://127.0.0.1:5177/?app=1&autologin=ADMIN:password9080', { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.rt && window.rt.windowInstances.get('w_main') && typeof window.__menu === 'function', null, { timeout: 90000, polling: 300 });
  out.menuOpen = await page.evaluate(async () => {
    const rt = window.rt; const root = rt.windowInstances.get('w_main')?.props.get('menuid');
    const find = (o, n) => { for (const c of o.children.values()) { if (c.name === n) return c; const r = find(c, n); if (r) return r } return null };
    const item = root ? find(root, 'm_guestroom') : null;
    if (!item) return { found: false };
    await rt.fire(item, 'selected').catch(() => {});
    await rt.fire(item, 'clicked').catch(() => {});
    return { found: true, visible: item.props.get('visible'), text: String(item.props.get('text') ?? '') };
  });
  await page.waitForFunction(() => window.rt.windowInstances.get('w_guestroom_form'), null, { timeout: 30000, polling: 300 });
  await sleep(1800); await poll(2);
  out.open = await page.evaluate(() => {
    const w = window.rt.windowInstances.get('w_guestroom_form');
    return { title: String(w.props.get('title') ?? ''), master: !!w.props.get('id_master'), detail: !!w.props.get('id_detail'), list: !!w.props.get('id_list') };
  });
  await page.evaluate(async () => { const rt = window.rt; const w = rt.windowInstances.get('w_guestroom_form'); await w.pbCall('ue_newform', [], rt).catch(() => {}) });
  await sleep(900); await poll(1);
  out.fillAdd = await page.evaluate(async ({ name }) => {
    const rt = window.rt; const w = rt.windowInstances.get('w_guestroom_form');
    const m = w.props.get('id_master');
    if (!m.model.rowCount()) await m.pbCall('insertrow', [0], rt);
    for (const [k, v] of Object.entries({ name, capacity: 2, guestroomfloorcode: 1, guestroomtypecode: 1, guestroomstatuscode: 1, occupied: 'N' })) await m.pbCall('setitem', [1, k, v], rt);
    await m.pbCall('accepttext', [], rt).catch(() => {});
    return { rows: m.model.rowCount(), values: m.model.buf.primary[0]?.v };
  }, { name: NAME });
  out.addSave = await page.evaluate(async () => {
    const rt = window.rt; const w = rt.windowInstances.get('w_guestroom_form');
    window.__save1 = false;
    void w.pbCall('ue_save', [], rt).then(() => { window.__save1 = 'ok' }).catch((e) => { window.__save1 = 'ERR ' + String(e.message || e).slice(0, 400) });
    return 'fired';
  });
  await poll(14);
  out.afterAdd = {
    saveDone: await page.evaluate(() => window.__save1 ?? null),
    row: rows(`select guestroomcode,name,capacity,guestroomfloorcode,guestroomtypecode,guestroomstatuscode,occupied from dbo.guestroom where name='${NAME}'`)[0] ?? null,
    tab: rows("select tabmaxkey from dbo._tabmaxkey where tabname='GuestRoom'")[0]?.[0] ?? null,
  };
  out.code = out.afterAdd.row?.[0] ?? null;
  out.addOk = !!out.code && out.afterAdd.row?.[1] === NAME && Number(out.afterAdd.row?.[2]) === 2
    && out.afterAdd.tab === out.code && out.messages.some((m) => /Changes take effect in database/i.test(m));
  if (out.code) {
    await page.evaluate(async () => { const rt = window.rt; const w = rt.windowInstances.get('w_guestroom_form'); void w.pbCall('ue_list', [], rt).catch(() => {}) });
    for (let i = 0; i < 40; i++) { await sleep(500); const n = await page.evaluate(() => window.rt.windowInstances.get('w_guestroom_form')?.props.get('id_list')?.model?.rowCount?.() ?? 0); if (n > 0) { out.listRows = n; break; } await poll(1); }
    out.pick = await page.evaluate(async (code) => {
      const rt = window.rt; const w = rt.windowInstances.get('w_guestroom_form');
      const l = w.props.get('id_list'); const m = l.model; const ci = m.colIndex('code') >= 0 ? m.colIndex('code') : 1;
      const hit = [...m.buf.primary.entries()].find(([, r]) => Number(r.v[ci]) === Number(code));
      if (!hit) return { error: 'room not in list', rows: m.rowCount() };
      w.props.set('id_dwcontrol', l); w.props.set('il_selectedrow', hit[0] + 1);
      await w.pbCall('ue_detail', [], rt).catch(() => {});
      await new Promise((r) => setTimeout(r, 1000));
      const mm = w.props.get('id_master'); const dd = w.props.get('id_detail');
      return { row: hit[0] + 1, listRows: m.rowCount(), masterCode: Number(mm?.model?.buf.primary[0]?.v?.[mm.model.colIndex('code')] ?? 0), detailRows: dd?.model?.rowCount?.() ?? null };
    }, Number(out.code));
    await poll(2);
    out.edit = await page.evaluate(async ({ name2 }) => {
      const rt = window.rt; const w = rt.windowInstances.get('w_guestroom_form'); const m = w.props.get('id_master');
      await m.pbCall('setitem', [1, 'name', name2], rt);
      await m.pbCall('setitem', [1, 'capacity', 3], rt);
      await m.pbCall('accepttext', [], rt).catch(() => {});
      window.__save2 = false;
      void w.pbCall('ue_save', [], rt).then(() => { window.__save2 = 'ok' }).catch((e) => { window.__save2 = 'ERR ' + String(e.message || e).slice(0, 400) });
      return { values: m.model.buf.primary[0]?.v };
    }, { name2: NAME2 });
    await poll(14);
    out.afterEdit = {
      saveDone: await page.evaluate(() => window.__save2 ?? null),
      row: rows(`select guestroomcode,name,capacity from dbo.guestroom where guestroomcode=${Number(out.code)}`)[0] ?? null,
    };
    out.editOk = out.afterEdit.row?.[1] === NAME2 && Number(out.afterEdit.row?.[2]) === 3
      && out.messages.filter((m) => /Changes take effect in database/i.test(m)).length >= 2;
    out.fileDelete = await page.evaluate(async () => {
      const rt = window.rt; const w = rt.windowInstances.get('w_guestroom_form');
      const has = typeof w.findRoutines === 'function' && w.findRoutines('ue_delete').length > 0;
      const menu = w.props.get('menuid') || w.props.get('im_menu');
      let hit = null; const walk = (o) => { for (const c of o.children.values()) { if (c.name === 'm_delete') hit = hit || c; walk(c) } }; if (menu) walk(menu);
      const enabled = hit ? hit.props.get('enabled') !== false : null;
      if (hit) void rt.fire(hit, 'clicked').catch(() => {});
      return { hasUeDelete: has, menuEnabled: enabled };
    });
    await sleep(900); await poll(4, true);
    out.afterDeleteAttempt = rows(`select count(*) from dbo.guestroom where guestroomcode=${Number(out.code)}`)[0]?.[0] ?? null;
    out.deleteNoOp = out.fileDelete?.hasUeDelete === false && out.afterDeleteAttempt === '1';
  }
  restore();
  out.final = counts();
  out.final.residue = rows("select count(*) from dbo.guestroom where name like 'PARITY ROOM %'")[0]?.[0] ?? null;
  out.baselineOk = out.final.rooms === out.baseline.rooms && out.final.floors === out.baseline.floors
    && out.final.types === out.baseline.types && out.final.statuses === out.baseline.statuses
    && out.final.services === out.baseline.services && out.final.tab === out.baseline.tab
    && out.final.audit === out.baseline.audit && out.final.auditMax === out.baseline.auditMax
    && out.final.residue === '0';
  out.ok = !!out.addOk && !!out.editOk && !!out.deleteNoOp && out.baselineOk;
} catch (e) { out.fatal = String(e.stack || e).slice(0, 2600); }
finally {
  restore();
  console.log(JSON.stringify(out, (k, v) => (typeof v === 'bigint' ? Number(v) : v), 1));
  await browser.close().catch(() => {});
}
