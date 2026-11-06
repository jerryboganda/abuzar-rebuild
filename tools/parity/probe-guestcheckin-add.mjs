// Guest Check-In (m_guestcheckin -> w_guestcheckin): add a check-in for a
// temporary guest/room fixture, verify the GuestCheckin row and the room's
// Occupied flag, then reopen through File | List -> Detail and edit remarks.
// All fixtures, the check-in, cashier rows and counters are restored.
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
const REMARK = 'PARITY CHECKIN ' + SUF;
const REMARK2 = REMARK + ' EDIT';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const out = { remark: REMARK, remark2: REMARK2, messages: [], errors: [], net: [] };
page.on('pageerror', (e) => out.errors.push(String(e.message || e).slice(0, 600)));
page.on('request', (r) => { if (r.url().includes('/api/exec')) out.net.push({ p: 'req', body: String(r.postData() || '') }) });
page.on('response', async (r) => { if (r.url().includes('/api/exec')) { let b = ''; try { b = await r.text() } catch {} out.net.push({ p: 'res', status: r.status(), body: String(b).slice(0, 500) }) } });
async function poll(seconds = 12, yes = false) {
  for (let i = 0; i < seconds * 2; i++) {
    await sleep(500);
    const msgs = await page.evaluate(() => [...document.querySelectorAll('.msgbox .txt')].map((e) => e.textContent.replace(/\s+/g, ' ').trim().slice(0, 400)));
    if (msgs.length) {
      out.messages.push(...msgs);
      await page.evaluate((y) => { for (const b of document.querySelectorAll('.msgbox')) { const bs = [...b.querySelectorAll('.btns button')]; (bs.find((x) => (y && /^yes$/i.test(x.textContent.trim())) || /^(ok|yes)$/i.test(x.textContent.trim())) || bs[0])?.click(); } }, yes);
      await sleep(250);
    }
  }
}
const killIdle = () => { try { q("select count(pg_terminate_backend(pid)) from pg_stat_activity where datname='" + DB + "' and xact_start is not null and pid<>pg_backend_pid()"); } catch {} };
const counts = () => ({
  checkins: Number(rows('select count(*) from dbo.guestcheckin')[0][0]),
  checkinMax: Number(rows('select coalesce(max(guestcheckincode),0) from dbo.guestcheckin')[0][0]),
  services: Number(rows('select count(*) from dbo.guestcheckinservice')[0][0]),
  rooms: Number(rows('select count(*) from dbo.guestroom')[0][0]),
  guests: Number(rows('select count(*) from dbo.guest')[0][0]),
  cashwin: Number(rows('select count(*) from dbo.mastercashwin')[0][0]),
  cashacc: Number(rows('select count(*) from dbo.groupcashaccount')[0][0]),
  cashaccMaxRow: Number(rows('select coalesce(max(rowid),0) from dbo.groupcashaccount')[0][0]),
  tab: rows("select tabmaxkey from dbo._tabmaxkey where tabname='GuestCheckIn'")[0]?.[0] ?? null,
  audit: Number(rows('select count(*) from dbo.audit_log')[0][0]),
  auditMax: Number(rows('select max(audit_id) from dbo.audit_log')[0][0]),
});
const restore = () => {
  try {
    killIdle();
    const code = out.code ? Number(out.code) : null;
    if (code) {
      q(`set session_replication_role = replica; delete from dbo.guestcheckinservice where guestcheckincode=${code}; delete from dbo.mastercashwin where documentcode=${code} and documenttype='GC'; delete from dbo.guestcheckin where guestcheckincode=${code}; set session_replication_role = origin`);
    }
    q(`set session_replication_role = replica;
       delete from dbo.guestcheckinservice where guestcheckincode in (select guestcheckincode from dbo.guestcheckin where remarks like 'PARITY CHECKIN %');
       delete from dbo.guestcheckin where remarks like 'PARITY CHECKIN %';
       delete from dbo.guestroom where name='PARITY ROOM FIXTURE';
       delete from dbo.guestroomfloor where name='PARITY FLOOR FIXTURE';
       delete from dbo.guestroomtype where name='PARITY TYPE FIXTURE';
       delete from dbo.guestroomstatus where name='PARITY STATUS FIXTURE';
       delete from dbo.guest where regno='PARITY-G1';
       set session_replication_role = origin`);
    if (out.fixtureRow) q(`delete from dbo.groupcashaccount where rowid=${Number(out.fixtureRow)}`);
    if (out.baseline?.tab !== null) q(`update dbo._tabmaxkey set tabmaxkey=${Number(out.baseline.tab)} where tabname='GuestCheckIn'`);
    if (out.baseline?.auditMax) { q(`delete from dbo.audit_log where audit_id > ${out.baseline.auditMax}`); q(`select setval(pg_get_serial_sequence('dbo.audit_log','audit_id'), ${out.baseline.auditMax}, true)`); }
  } catch (e) { out.restoreError = String(e.message || e).slice(0, 700); }
};
try {
  out.baseline = counts();
  q("insert into dbo.guestroomfloor (guestroomfloorcode,name) values (1,'PARITY FLOOR FIXTURE')");
  q("insert into dbo.guestroomtype (guestroomtypecode,name) values (1,'PARITY TYPE FIXTURE')");
  q("insert into dbo.guestroomstatus (guestroomstatuscode,name) values (1,'PARITY STATUS FIXTURE')");
  q("insert into dbo.guestroom (guestroomcode,name,capacity,guestroomfloorcode,guestroomtypecode,guestroomstatuscode,occupied) values (1,'PARITY ROOM FIXTURE',2,1,1,1,'N')");
  q("insert into dbo.guest (guestcode,active,date,regno,name,custcode,usercode,gender,nic) values (1,'Y',localtimestamp(3),'PARITY-G1','PARITY GUEST FIXTURE',22,1,'M','PARITY-GUEST-NIC')");
  out.fixtureRow = out.baseline.cashaccMaxRow + 1;
  q(`insert into dbo.groupcashaccount (groupcode,moduleid,cashacccode,rowid) values (2,42,2,${out.fixtureRow})`);
  await page.goto('http://127.0.0.1:5177/?app=1&autologin=ADMIN:password9080', { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.rt && window.rt.windowInstances.get('w_main') && typeof window.__menu === 'function', null, { timeout: 90000, polling: 300 });
  out.menuOpen = await page.evaluate(async () => {
    const rt = window.rt; const root = rt.windowInstances.get('w_main')?.props.get('menuid');
    const find = (o, n) => { for (const c of o.children.values()) { if (c.name === n) return c; const r = find(c, n); if (r) return r } return null };
    const item = root ? find(root, 'm_guestcheckin') : null;
    if (!item) return { found: false };
    await rt.fire(item, 'selected').catch(() => {});
    await rt.fire(item, 'clicked').catch(() => {});
    return { found: true, visible: item.props.get('visible'), text: String(item.props.get('text') ?? '') };
  });
  await page.waitForFunction(() => window.rt.windowInstances.get('w_guestcheckin'), null, { timeout: 30000, polling: 300 });
  await sleep(1800); await poll(2);
  out.open = await page.evaluate(() => {
    const w = window.rt.windowInstances.get('w_guestcheckin');
    return { title: String(w.props.get('title') ?? ''), master: !!w.props.get('id_master'), detail: !!w.props.get('id_detail'), list: !!w.props.get('id_list') };
  });
  await page.evaluate(async () => { const rt = window.rt; const w = rt.windowInstances.get('w_guestcheckin'); await w.pbCall('ue_newform', [], rt).catch(() => {}) });
  await sleep(900); await poll(1);
  out.fill = await page.evaluate(async ({ remark }) => {
    const rt = window.rt; const w = rt.windowInstances.get('w_guestcheckin'); const m = w.props.get('id_master');
    if (!m.model.rowCount()) await m.pbCall('insertrow', [0], rt);
    const values = {
      date: '2026-11-06 00:00:00', guestcode: 1, checkinroom: 1, checkindate: '2026-11-06 00:00:00',
      arrivaldate: '2026-11-06 00:00:00', departuredate: '2026-11-07 00:00:00', checkout: 'N',
      stayperiod: 1, personcount: 1, cashacccode: 2, cashtendered: 0, cashcharged: 0, cashback: 0,
      remarks: remark, visitpurpose: 'Pleasure', comingfrom: 'PARITY', arrivalplace: 'PARITY',
    };
    const bad = [];
    for (const [k, v] of Object.entries(values)) { try { await m.pbCall('setitem', [1, k, v], rt) } catch { bad.push(k) } }
    await m.pbCall('setrow', [1], rt).catch(() => {});
    await m.pbCall('accepttext', [], rt).catch(() => {});
    return { bad, rows: m.model.rowCount(), values: m.model.buf.primary[0]?.v };
  }, { remark: REMARK });
  out.save1 = await page.evaluate(async () => {
    const rt = window.rt; const w = rt.windowInstances.get('w_guestcheckin');
    window.__save1 = false;
    void w.pbCall('ue_save', [], rt).then(() => { window.__save1 = 'ok' }).catch((e) => { window.__save1 = 'ERR ' + String(e.message || e).slice(0, 500) });
    return 'fired';
  });
  await poll(16);
  out.save1Result = await page.evaluate(() => window.__save1 ?? null);
  out.afterAdd = {
    row: rows(`select guestcheckincode,guestcode,checkinroom,currentroom,checkout,remarks,date::text,checkindate::text from dbo.guestcheckin where remarks='${REMARK}'`)[0] ?? null,
    room: rows("select guestroomcode,occupied from dbo.guestroom where guestroomcode=1")[0] ?? null,
    tab: rows("select tabmaxkey from dbo._tabmaxkey where tabname='GuestCheckIn'")[0]?.[0] ?? null,
  };
  out.code = out.afterAdd.row?.[0] ?? null;
  out.addOk = !!out.code && out.afterAdd.row?.[1] === '1' && out.afterAdd.row?.[2] === '1'
    && out.afterAdd.row?.[4] === 'N' && out.afterAdd.room?.[1] === 'Y' && out.afterAdd.tab === out.code
    && out.messages.some((m) => /Changes take effect in database/i.test(m));
  if (out.code) {
    await page.evaluate(async () => { const rt = window.rt; const w = rt.windowInstances.get('w_guestcheckin'); void w.pbCall('ue_list', [], rt).catch(() => {}) });
    for (let i = 0; i < 40; i++) { await sleep(500); const n = await page.evaluate(() => window.rt.windowInstances.get('w_guestcheckin')?.props.get('id_list')?.model?.rowCount?.() ?? 0); if (n > 0) { out.listRows = n; break; } await poll(1); }
    out.pick = await page.evaluate(async (code) => {
      const rt = window.rt; const w = rt.windowInstances.get('w_guestcheckin');
      const l = w.props.get('id_list'); const m = l.model; const ci = m.colIndex('code') >= 0 ? m.colIndex('code') : 0;
      const hit = [...m.buf.primary.entries()].find(([, r]) => Number(r.v[ci]) === Number(code));
      if (!hit) return { error: 'checkin not in list', rows: m.rowCount() };
      w.props.set('id_dwcontrol', l); w.props.set('il_selectedrow', hit[0] + 1);
      await w.pbCall('ue_detail', [], rt).catch(() => {});
      await new Promise((r) => setTimeout(r, 1200));
      const mm = w.props.get('id_master');
      await mm.pbCall('setcolumn', ['remarks'], rt).catch(() => {});
      return { row: hit[0] + 1, listRows: m.rowCount(), masterCode: Number(mm?.model?.buf.primary[0]?.v?.[mm.model.colIndex('code')] ?? 0) };
    }, Number(out.code));
    await poll(2);
    out.edit = await page.evaluate(async ({ remark2 }) => {
      const rt = window.rt; const w = rt.windowInstances.get('w_guestcheckin'); const m = w.props.get('id_master');
      await m.pbCall('setitem', [1, 'remarks', remark2], rt);
      await m.pbCall('setrow', [1], rt).catch(() => {});
      await m.pbCall('accepttext', [], rt).catch(() => {});
      window.__save2 = false;
      void w.pbCall('ue_save', [], rt).then(() => { window.__save2 = 'ok' }).catch((e) => { window.__save2 = 'ERR ' + String(e.message || e).slice(0, 400) });
      return { values: m.model.buf.primary[0]?.v };
    }, { remark2: REMARK2 });
    await poll(16);
    out.save2Result = await page.evaluate(() => window.__save2 ?? null);
    out.afterEdit = rows(`select guestcheckincode,remarks,date::text,checkindate::text from dbo.guestcheckin where guestcheckincode=${Number(out.code)}`)[0] ?? null;
    out.editOk = out.afterEdit?.[1] === REMARK2 && out.messages.filter((m) => /Changes take effect in database/i.test(m)).length >= 2;
  }
  restore();
  out.final = counts();
  out.final.residue = rows("select count(*) from dbo.guestcheckin where remarks like 'PARITY CHECKIN %'")[0]?.[0] ?? null;
  out.baselineOk = out.final.checkins === out.baseline.checkins && out.final.checkinMax === out.baseline.checkinMax
    && out.final.services === out.baseline.services && out.final.rooms === out.baseline.rooms
    && out.final.guests === out.baseline.guests && out.final.cashwin === out.baseline.cashwin
    && out.final.cashacc === out.baseline.cashacc && out.final.cashaccMaxRow === out.baseline.cashaccMaxRow
    && out.final.tab === out.baseline.tab
    && out.final.audit === out.baseline.audit && out.final.auditMax === out.baseline.auditMax
    && out.final.residue === '0';
  out.ok = !!out.addOk && !!out.editOk && out.baselineOk;
} catch (e) { out.fatal = String(e.stack || e).slice(0, 3000); }
finally {
  restore();
  console.log(JSON.stringify(out, (k, v) => (typeof v === 'bigint' ? Number(v) : v), 1));
  await browser.close().catch(() => {});
}
