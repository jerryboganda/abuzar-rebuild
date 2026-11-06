// Guest Check-Out (m_guestcheckout -> w_guestcheckout_form): with a temporary
// checked-in guest, measure both save paths:
//  - CheckOut = Y  -> guest is set inactive, balance is checked, and the
//    recovered script returns before GuestCheckin.update (original defect)
//  - CheckOut = N  -> GuestCheckin.update runs and the room is freed
// All fixtures and counters are removed afterwards.
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const require = createRequire(process.env.PLAYWRIGHT_MODULES || 'C:/Users/Admin/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/');
const { chromium } = require('playwright');
const PSQL = 'C:\\PostgreSQL\\17\\bin\\psql.exe';
const DB = process.env.PARITY_DB || 'trader_write_test';
const q = (sql) => execFileSync(PSQL, ['-U', 'postgres', '-h', '127.0.0.1', '-d', DB, '-t', '-A', '-F', '|', '-c', sql], { env: { ...process.env, PGPASSWORD: 'postgres' }, encoding: 'utf8', windowsHide: true }).trim();
const rows = (sql) => q(sql).split(/\r?\n/).filter(Boolean).map((l) => l.split('|'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const REMARK = 'PARITY CHECKOUT ' + String(Date.now()).slice(-6);
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
  checkins: Number(rows('select count(*) from dbo.guestcheckin')[0][0]),
  rooms: Number(rows('select count(*) from dbo.guestroom')[0][0]),
  guests: Number(rows('select count(*) from dbo.guest')[0][0]),
  audit: Number(rows('select count(*) from dbo.audit_log')[0][0]),
  auditMax: Number(rows('select max(audit_id) from dbo.audit_log')[0][0]),
});
const restore = () => {
  try {
    killIdle();
    q(`set session_replication_role = replica;
       delete from dbo.guestcheckinservice where guestcheckincode in (select guestcheckincode from dbo.guestcheckin where remarks='${REMARK}');
       delete from dbo.guestcheckin where remarks='${REMARK}';
       delete from dbo.guestroom where name='PARITY ROOM CHECKOUT';
       delete from dbo.guestroomfloor where name='PARITY FLOOR FIXTURE';
       delete from dbo.guestroomtype where name='PARITY TYPE FIXTURE';
       delete from dbo.guestroomstatus where name='PARITY STATUS FIXTURE';
       delete from dbo.guest where regno='PARITY-GCO';
       set session_replication_role = origin`);
    if (out.baseline?.auditMax) { q(`delete from dbo.audit_log where audit_id > ${out.baseline.auditMax}`); q(`select setval(pg_get_serial_sequence('dbo.audit_log','audit_id'), ${out.baseline.auditMax}, true)`); }
  } catch (e) { out.restoreError = String(e.message || e).slice(0, 700); }
};
try {
  out.baseline = counts();
  q("insert into dbo.guestroomfloor (guestroomfloorcode,name) values (1,'PARITY FLOOR FIXTURE')");
  q("insert into dbo.guestroomtype (guestroomtypecode,name) values (1,'PARITY TYPE FIXTURE')");
  q("insert into dbo.guestroomstatus (guestroomstatuscode,name) values (1,'PARITY STATUS FIXTURE')");
  q("insert into dbo.guestroom (guestroomcode,name,capacity,guestroomfloorcode,guestroomtypecode,guestroomstatuscode,occupied) values (1,'PARITY ROOM CHECKOUT',2,1,1,1,'Y')");
  q("insert into dbo.guest (guestcode,active,date,regno,name,custcode,usercode,gender,nic) values (1,'Y',localtimestamp(3),'PARITY-GCO','PARITY GUEST CHECKOUT',22,1,'M','PARITY-GCO-NIC')");
  q("insert into dbo.guestcheckin (guestcheckincode,date,usercode,guestcode,currentroom,checkinroom,checkindate,checkinby,checkout,remarks,cashacccode,cashtendered,cashcharged,cashback,arrivaldate,departuredate,stayperiod,personcount) values (1,localtimestamp(3),1,1,1,1,localtimestamp(3),1,'N','" + REMARK + "',2,0,0,0,localtimestamp(3),localtimestamp(3),1,1)");
  await page.goto('http://127.0.0.1:5177/?app=1&autologin=ADMIN:password9080', { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.rt && window.rt.windowInstances.get('w_main') && typeof window.__menu === 'function', null, { timeout: 90000, polling: 300 });
  out.menuOpen = await page.evaluate(async () => {
    const rt = window.rt; const root = rt.windowInstances.get('w_main')?.props.get('menuid');
    const find = (o, n) => { for (const c of o.children.values()) { if (c.name === n) return c; const r = find(c, n); if (r) return r } return null };
    const item = root ? find(root, 'm_guestcheckout') : null;
    if (!item) return { found: false };
    await rt.fire(item, 'selected').catch(() => {});
    await rt.fire(item, 'clicked').catch(() => {});
    return { found: true, visible: item.props.get('visible'), text: String(item.props.get('text') ?? '') };
  });
  await page.waitForFunction(() => window.rt.windowInstances.get('w_guestcheckout_form'), null, { timeout: 30000, polling: 300 });
  await sleep(1600); await poll(2);
  out.open = await page.evaluate(() => {
    const w = window.rt.windowInstances.get('w_guestcheckout_form');
    return { title: String(w.props.get('title') ?? ''), detail: !!w.props.get('id_detail'), list: !!w.props.get('id_list') };
  });
  await page.evaluate(async () => { const rt = window.rt; const w = rt.windowInstances.get('w_guestcheckout_form'); void w.pbCall('ue_list', [], rt).catch(() => {}) });
  for (let i = 0; i < 40; i++) { await sleep(500); const n = await page.evaluate(() => window.rt.windowInstances.get('w_guestcheckout_form')?.props.get('id_list')?.model?.rowCount?.() ?? 0); if (n > 0) { out.listRows = n; break; } await poll(1); }
  out.pick = await page.evaluate(async () => {
    const rt = window.rt; const w = rt.windowInstances.get('w_guestcheckout_form');
    const l = w.props.get('id_list'); const m = l.model; const ci = m.colIndex('code') >= 0 ? m.colIndex('code') : 0;
    const hit = [...m.buf.primary.entries()].find(([, r]) => Number(r.v[ci]) === 1);
    if (!hit) return { error: 'checkin not in list', rows: m.rowCount() };
    w.props.set('id_dwcontrol', l); w.props.set('il_selectedrow', hit[0] + 1);
    await w.pbCall('ue_detail', [], rt).catch(() => {});
    await new Promise((r) => setTimeout(r, 1000));
    const d = w.props.get('id_detail');
    return { row: hit[0] + 1, listRows: m.rowCount(), detailRows: d?.model?.rowCount?.() ?? null, values: d?.model?.buf.primary[0]?.v ?? null };
  });
  await poll(2);
  // programmatic setitem leaves the DOM view acceptance wrapper in a failed
  // input state (no editor draft); commit through the DataWindow model.
  await page.evaluate(() => {
    const rt = window.rt; const w = rt.windowInstances.get('w_guestcheckout_form'); const d = w.props.get('id_detail');
    d.model.acceptText = async () => 1;
  });
  // Set CheckOut=Y and save: recovered code sets guest inactive and returns.
  out.checkoutY = await page.evaluate(async () => {
    const rt = window.rt; const w = rt.windowInstances.get('w_guestcheckout_form'); const d = w.props.get('id_detail');
    await d.pbCall('setitem', [1, 'checkout', 'Y'], rt);
    await d.pbCall('setrow', [1], rt).catch(() => {});
    await d.pbCall('accepttext', [], rt).catch(() => {});
    window.__saveY = false;
    void w.pbCall('ue_save', [], rt).then(() => { window.__saveY = 'ok' }).catch((e) => { window.__saveY = 'ERR ' + String(e.message || e).slice(0, 400) });
    return { values: d.model.buf.primary[0]?.v };
  });
  await poll(14, true);
  out.afterY = {
    saveDone: await page.evaluate(() => window.__saveY ?? null),
    checkin: rows(`select guestcheckincode,checkout,remarks,checkoutdate::text,checkoutby from dbo.guestcheckin where guestcheckincode=1`)[0] ?? null,
    guestActive: rows("select active from dbo.guest where guestcode=1")[0]?.[0] ?? null,
    roomOccupied: rows("select occupied from dbo.guestroom where guestroomcode=1")[0]?.[0] ?? null,
  };
  // The guest-inactive UPDATE is issued but the recovered branch returns
  // without COMMIT, so an outside session still sees Active='Y'.  The
  // GuestCheckin row is not updated and the room stays occupied.
  out.originalEarlyReturn = out.afterY.checkin?.[1] === 'N' && out.afterY.guestActive === 'Y' && out.afterY.roomOccupied === 'Y'
    && out.messages.filter((m) => /Changes take effect in database/i.test(m)).length === 0
    && out.net.some((x) => x.p === 'req' && /UPDATE dbo\.guest SET active = 'N'/i.test(x.body));
  // Set CheckOut=N and save again: this is the path that updates GuestCheckin
  // and frees the room.
  out.checkoutN = await page.evaluate(async () => {
    const rt = window.rt; const w = rt.windowInstances.get('w_guestcheckout_form'); const d = w.props.get('id_detail');
    await d.pbCall('setitem', [1, 'checkout', 'N'], rt);
    await d.pbCall('setrow', [1], rt).catch(() => {});
    await d.pbCall('accepttext', [], rt).catch(() => {});
    window.__saveN = false;
    void w.pbCall('ue_save', [], rt).then(() => { window.__saveN = 'ok' }).catch((e) => { window.__saveN = 'ERR ' + String(e.message || e).slice(0, 400) });
    return { values: d.model.buf.primary[0]?.v };
  });
  await poll(14, true);
  out.afterN = {
    saveDone: await page.evaluate(() => window.__saveN ?? null),
    checkin: rows(`select guestcheckincode,checkout,remarks from dbo.guestcheckin where guestcheckincode=1`)[0] ?? null,
    roomOccupied: rows("select occupied from dbo.guestroom where guestroomcode=1")[0]?.[0] ?? null,
    guestActive: rows("select active from dbo.guest where guestcode=1")[0]?.[0] ?? null,
  };
  out.noCheckoutUpdate = out.afterN.checkin?.[1] === 'N' && out.afterN.roomOccupied === 'N'
    && out.afterN.guestActive === 'N'
    && out.messages.some((m) => /Changes take effect in database/i.test(m));
  restore();
  out.final = counts();
  out.final.residue = rows("select count(*) from dbo.guestcheckin where remarks='${REMARK}'".replace('${REMARK}', REMARK))[0]?.[0] ?? null;
  out.baselineOk = out.final.checkins === out.baseline.checkins && out.final.rooms === out.baseline.rooms
    && out.final.guests === out.baseline.guests
    && out.final.audit === out.baseline.audit && out.final.auditMax === out.baseline.auditMax
    && out.final.residue === '0';
  out.ok = !!out.originalEarlyReturn && !!out.noCheckoutUpdate && out.baselineOk;
} catch (e) { out.fatal = String(e.stack || e).slice(0, 3000); }
finally {
  restore();
  console.log(JSON.stringify(out, (k, v) => (typeof v === 'bigint' ? Number(v) : v), 1));
  await browser.close().catch(() => {});
}
