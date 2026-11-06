// Guest Transfer (m_guesttransfer -> w_guesttransfer_form): move a checked-in
// guest from room 1 to room 2, then verify the GuestTransfer row, the
// GuestCheckIn.CurrentRoom update and both room occupancy flags.
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const require = createRequire(process.env.PLAYWRIGHT_MODULES || 'C:/Users/Admin/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/');
const { chromium } = require('playwright');
const PSQL = 'C:\\PostgreSQL\\17\\bin\\psql.exe';
const DB = process.env.PARITY_DB || 'trader_write_test';
const q = (sql) => execFileSync(PSQL, ['-U', 'postgres', '-h', '127.0.0.1', '-d', DB, '-t', '-A', '-F', '|', '-c', sql], { env: { ...process.env, PGPASSWORD: 'postgres' }, encoding: 'utf8', windowsHide: true }).trim();
const rows = (sql) => q(sql).split(/\r?\n/).filter(Boolean).map((l) => l.split('|'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const REMARK = 'PARITY TRANSFER ' + String(Date.now()).slice(-6);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const out = { remark: REMARK, messages: [], errors: [], net: [] };
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
  transfers: Number(rows('select count(*) from dbo.guesttransfer')[0][0]),
  transferMax: Number(rows('select coalesce(max(guesttransfercode),0) from dbo.guesttransfer')[0][0]),
  checkins: Number(rows('select count(*) from dbo.guestcheckin')[0][0]),
  rooms: Number(rows('select count(*) from dbo.guestroom')[0][0]),
  floors: Number(rows('select count(*) from dbo.guestroomfloor')[0][0]),
  types: Number(rows('select count(*) from dbo.guestroomtype')[0][0]),
  statuses: Number(rows('select count(*) from dbo.guestroomstatus')[0][0]),
  guests: Number(rows('select count(*) from dbo.guest')[0][0]),
  tab: rows("select tabmaxkey from dbo._tabmaxkey where tabname='GuestTransfer'")[0]?.[0] ?? null,
  audit: Number(rows('select count(*) from dbo.audit_log')[0][0]),
  auditMax: Number(rows('select max(audit_id) from dbo.audit_log')[0][0]),
});
const restore = () => {
  try {
    killIdle();
    q(`set session_replication_role = replica;
       delete from dbo.guesttransfer where remarks='${REMARK}';
       delete from dbo.guestcheckinservice where guestcheckincode in (select guestcheckincode from dbo.guestcheckin where remarks='PARITY TRANSFER CHECKIN');
       delete from dbo.guestcheckin where remarks='PARITY TRANSFER CHECKIN';
       delete from dbo.guestroom where guestroomcode in (1,2);
       delete from dbo.guestroomfloor where name like 'PARITY FLOOR FIXTURE%';
       delete from dbo.guestroomtype where name='PARITY TYPE FIXTURE';
       delete from dbo.guestroomstatus where name='PARITY STATUS FIXTURE';
       delete from dbo.guest where regno='PARITY-GTR';
       set session_replication_role = origin`);
    if (out.baseline?.tab !== null) q(`update dbo._tabmaxkey set tabmaxkey=${Number(out.baseline.tab)} where tabname='GuestTransfer'`);
    if (out.baseline?.auditMax) { q(`delete from dbo.audit_log where audit_id > ${out.baseline.auditMax}`); q(`select setval(pg_get_serial_sequence('dbo.audit_log','audit_id'), ${out.baseline.auditMax}, true)`); }
  } catch (e) { out.restoreError = String(e.message || e).slice(0, 700); }
};
try {
  out.baseline = counts();
  q("insert into dbo.guestroomfloor (guestroomfloorcode,name) values (1,'PARITY FLOOR FIXTURE'),(2,'PARITY FLOOR FIXTURE 2')");
  q("insert into dbo.guestroomtype (guestroomtypecode,name) values (1,'PARITY TYPE FIXTURE')");
  q("insert into dbo.guestroomstatus (guestroomstatuscode,name) values (1,'PARITY STATUS FIXTURE')");
  q("insert into dbo.guestroom (guestroomcode,name,capacity,guestroomfloorcode,guestroomtypecode,guestroomstatuscode,occupied) values (1,'PARITY ROOM ONE',2,1,1,1,'Y'),(2,'PARITY ROOM TWO',2,2,1,1,'N')");
  q("insert into dbo.guest (guestcode,active,date,regno,name,custcode,usercode,gender,nic) values (1,'Y',localtimestamp(3),'PARITY-GTR','PARITY GUEST TRANSFER',22,1,'M','PARITY-GTR-NIC')");
  q("insert into dbo.guestcheckin (guestcheckincode,date,usercode,guestcode,currentroom,checkinroom,checkindate,checkinby,checkout,remarks,cashacccode) values (1,localtimestamp(3),1,1,1,1,localtimestamp(3),1,'N','PARITY TRANSFER CHECKIN',2)");
  await page.goto('http://127.0.0.1:5177/?app=1&autologin=ADMIN:password9080', { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.rt && window.rt.windowInstances.get('w_main') && typeof window.__menu === 'function', null, { timeout: 90000, polling: 300 });
  out.menuOpen = await page.evaluate(async () => {
    const rt = window.rt; const root = rt.windowInstances.get('w_main')?.props.get('menuid');
    const find = (o, n) => { for (const c of o.children.values()) { if (c.name === n) return c; const r = find(c, n); if (r) return r } return null };
    const item = root ? find(root, 'm_guesttransfer') : null;
    if (!item) return { found: false };
    await rt.fire(item, 'selected').catch(() => {});
    await rt.fire(item, 'clicked').catch(() => {});
    return { found: true, visible: item.props.get('visible'), text: String(item.props.get('text') ?? '') };
  });
  await page.waitForFunction(() => window.rt.windowInstances.get('w_guesttransfer_form'), null, { timeout: 30000, polling: 300 });
  await sleep(1600); await poll(2);
  out.open = await page.evaluate(() => {
    const w = window.rt.windowInstances.get('w_guesttransfer_form');
    return { title: String(w.props.get('title') ?? ''), detail: !!w.props.get('id_detail'), list: !!w.props.get('id_list') };
  });
  await page.evaluate(async () => { const rt = window.rt; const w = rt.windowInstances.get('w_guesttransfer_form'); await w.pbCall('ue_newform', [], rt).catch(() => {}) });
  await sleep(900); await poll(1);
  out.fill = await page.evaluate(async ({ remark }) => {
    const rt = window.rt; const w = rt.windowInstances.get('w_guesttransfer_form'); const d = w.props.get('id_detail');
    if (!d.model.rowCount()) await d.pbCall('insertrow', [0], rt);
    const values = { guestcheckincode: 1, lastroom: 1, newroom: 2, remarks: remark, date: '2026-11-06 00:00:00' };
    const bad = [];
    for (const [k, v] of Object.entries(values)) { try { await d.pbCall('setitem', [1, k, v], rt) } catch { bad.push(k) } }
    await d.pbCall('setrow', [1], rt).catch(() => {});
    d.model.acceptText = async () => 1;
    return { bad, rows: d.model.rowCount(), values: d.model.buf.primary[0]?.v };
  }, { remark: REMARK });
  out.save = await page.evaluate(async () => {
    const rt = window.rt; const w = rt.windowInstances.get('w_guesttransfer_form');
    window.__save = false;
    void w.pbCall('ue_save', [], rt).then(() => { window.__save = 'ok' }).catch((e) => { window.__save = 'ERR ' + String(e.message || e).slice(0, 400) });
    return 'fired';
  });
  out.dialog = null;
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    const has = await page.evaluate(() => !!window.rt.windowInstances.get('w_salesmanpassword'));
    if (has) {
      out.dialog = await page.evaluate(async () => {
        const rt = window.rt; const w = rt.windowInstances.get('w_salesmanpassword'); const d = w.props.get('id_password');
        if (!d.model.rowCount()) await d.pbCall('insertrow', [0], rt);
        await d.pbCall('setitem', [1, 'salesmancode', 1], rt);
        await d.pbCall('setitem', [1, 'password', 'password9080'], rt);
        d.model.acceptText = async () => 1;
        await d.pbCall('accepttext', [], rt).catch(() => {});
        const ok = [...w.children.values()].find((c) => c.name === 'cb_ok');
        if (ok) await rt.fire(ok, 'clicked').catch(() => {});
        return { rows: d.model.rowCount(), values: d.model.buf.primary[0]?.v };
      });
      break;
    }
    await poll(1);
  }
  await poll(18);
  out.saveResult = await page.evaluate(() => window.__save ?? null);
  out.afterAdd = {
    transfer: rows(`select guesttransfercode,guestcheckincode,lastroom,newroom,remarks,usercode from dbo.guesttransfer where remarks='${REMARK}'`)[0] ?? null,
    checkin: rows("select guestcheckincode,currentroom from dbo.guestcheckin where guestcheckincode=1")[0] ?? null,
    rooms: rows("select guestroomcode,occupied from dbo.guestroom where guestroomcode in (1,2) order by guestroomcode"),
    tab: rows("select tabmaxkey from dbo._tabmaxkey where tabname='GuestTransfer'")[0]?.[0] ?? null,
  };
  out.code = out.afterAdd.transfer?.[0] ?? null;
  out.addOk = !!out.code && out.afterAdd.transfer?.[2] === '1' && out.afterAdd.transfer?.[3] === '2'
    && out.afterAdd.checkin?.[1] === '2'
    && out.afterAdd.rooms?.[0]?.[1] === 'N' && out.afterAdd.rooms?.[1]?.[1] === 'Y'
    && out.afterAdd.tab === out.code
    && out.messages.some((m) => /Changes take effect in database/i.test(m));
  restore();
  out.final = counts();
  out.final.residue = rows(`select count(*) from dbo.guesttransfer where remarks='${REMARK}'`)[0]?.[0] ?? null;
  out.baselineOk = out.final.transfers === out.baseline.transfers && out.final.transferMax === out.baseline.transferMax
    && out.final.checkins === out.baseline.checkins && out.final.rooms === out.baseline.rooms
    && out.final.floors === out.baseline.floors && out.final.types === out.baseline.types
    && out.final.statuses === out.baseline.statuses
    && out.final.guests === out.baseline.guests && out.final.tab === out.baseline.tab
    && out.final.audit === out.baseline.audit && out.final.auditMax === out.baseline.auditMax
    && out.final.residue === '0';
  out.ok = !!out.addOk && out.baselineOk;
} catch (e) { out.fatal = String(e.stack || e).slice(0, 3000); }
finally {
  restore();
  console.log(JSON.stringify(out, (k, v) => (typeof v === 'bigint' ? Number(v) : v), 1));
  await browser.close().catch(() => {});
}
