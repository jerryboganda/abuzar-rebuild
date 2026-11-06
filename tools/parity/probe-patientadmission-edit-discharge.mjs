// Patient Admission edit + Patient Discharge two-stage workflow.
// Measures the persisted columns and the recovered early-return defect on
// final discharge, then removes every fixture and restores counters.
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { appendFileSync, writeFileSync } from 'node:fs';
const require = createRequire(process.env.PLAYWRIGHT_MODULES || 'C:/Users/Admin/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/');
const { chromium } = require('playwright');
const PSQL = 'C:\\PostgreSQL\\17\\bin\\psql.exe';
const DB = process.env.PARITY_DB || 'trader_write_test';
const q = (sql) => execFileSync(PSQL, ['-U', 'postgres', '-h', '127.0.0.1', '-d', DB, '-t', '-A', '-F', '|', '-c', sql], { env: { ...process.env, PGPASSWORD: 'postgres' }, encoding: 'utf8', windowsHide: true }).trim();
const RIGHTS = [5022, 5023, 5140, 1782];
const STEPS = 'C:/Projects/Abuzar/deploy/parity/patientadmission-edit-discharge-steps.txt';
writeFileSync(STEPS, '');
const step = (s) => appendFileSync(STEPS, new Date().toISOString() + ' ' + s + '\n');
const rows = (sql) => q(sql).split(/\r?\n/).filter(Boolean).map((l) => l.split('|'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SUF = String(Date.now()).slice(-6);
const REMARK = 'PARITY ADM EDIT ' + SUF;
const REMARK2 = 'PARITY DISCHARGE ' + SUF;
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
  admissions: Number(rows('select count(*) from dbo.patientadmission')[0][0]),
  admissionMax: Number(rows('select coalesce(max(admissioncode),0) from dbo.patientadmission')[0][0]),
  patients: Number(rows('select count(*) from dbo.patient')[0][0]),
  locations: Number(rows('select count(*) from dbo.patientlocation')[0][0]),
  wards: Number(rows('select count(*) from dbo.ward')[0][0]),
  tab: rows("select tabmaxkey from dbo._tabmaxkey where tabname='PatientAdmission'")[0]?.[0] ?? null,
  serverDate: rows('select lasttransdate::text from dbo.serverdate')[0]?.[0] ?? null,
  audit: Number(rows('select count(*) from dbo.audit_log')[0][0]),
  auditMax: Number(rows('select max(audit_id) from dbo.audit_log')[0][0]),
});
const restore = () => {
  try {
    killIdle();
    q(`set session_replication_role = replica;
       delete from dbo.patientadmission where admissioncode=1;
       delete from dbo.patient where regno='PARITY-PE1';
       delete from dbo.patientlocation where name='PARITY BED 1';
       delete from dbo.ward where name='PARITY WARD';
       delete from dbo.grouprights where groupcode=2 and rightcode in (${RIGHTS.join(',')});
       delete from dbo.rights where rightcode in (${RIGHTS.join(',')});
       set session_replication_role = origin`);
    if (out.baseline?.tab !== null) q(`update dbo._tabmaxkey set tabmaxkey=${Number(out.baseline.tab)} where tabname='PatientAdmission'`);
    if (out.baseline?.serverDate) q(`update dbo.serverdate set lasttransdate='${String(out.baseline.serverDate).replace(/'/g, "''")}'::timestamp`);
    if (out.baseline?.auditMax) { q(`delete from dbo.audit_log where audit_id > ${out.baseline.auditMax}`); q(`select setval(pg_get_serial_sequence('dbo.audit_log','audit_id'), ${out.baseline.auditMax}, true)`); }
  } catch (e) { out.restoreError = String(e.message || e).slice(0, 700); }
};
try {
  out.baseline = counts();
  q("insert into dbo.ward (wardcode,name,description) values (1,'PARITY WARD','PARITY')");
  q("insert into dbo.patientlocation (locationcode,name,wardcode) values (1,'PARITY BED 1',1)");
  q("insert into dbo.patient (patientcode,regno,active,name,gender,date,usercode,membershipid,custcode,diseasecode,locationcode,rankcode,unitcode,patientcatcode,gestationcode,createdby) values (1,'PARITY-PE1','Y','PARITY EDIT PATIENT','M',localtimestamp(3),1,'PARITY-ME1',19,1,1,1,1,1,1,1)");
  q(`insert into dbo.patientadmission (admissioncode,patientcode,custcode,locationcode,date,usercode,diseasecode,diagnosis,remarks,cashacccode,cashtendered,cashcharged,cashback,procedurecharges,proceduregstperc,transportcharges,dischargereasoncode) values (1,1,19,1,localtimestamp(3),1,1,'PARITY DIAGNOSIS OLD','${REMARK}',2,0,0,0,0,0,0,1)`);
  // The live rights catalog has no 5022/5023/5140/1782 rows at all; add
  // temporary rights so the recovered discharge/admission-edit gates can run.
  q(`insert into dbo.rights (rightcode,rightname,menuname,levelindex,indicesstring,object,rightcatcode) values
     (5022,'Initial Discharge','Initial Discharge',1,'5022,','W',1),
     (5023,'Final Discharge','Final Discharge',1,'5023,','W',1),
     (5140,'Edit Patient Admission','Edit Patient Admission',1,'5140,','W',1),
     (1782,'Modify Initial Discharge Date','Modify Initial Discharge Date',1,'1782,','W',1)`);
  q(`insert into dbo.grouprights (groupcode,rightcode,status) values (2,5022,1),(2,5023,1),(2,5140,1),(2,1782,1)`);
  step('fixtures ready');
  await page.goto('http://127.0.0.1:5177/?app=1&autologin=ADMIN:password9080', { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.rt && window.rt.windowInstances.get('w_main') && typeof window.__menu === 'function', null, { timeout: 90000, polling: 300 });
  step('logged in');
  // ---------------------------------------------------------------- admission edit
  out.menuAdmission = await page.evaluate(async () => {
    const rt = window.rt; const root = rt.windowInstances.get('w_main')?.props.get('menuid');
    const find = (o, n) => { for (const c of o.children.values()) { if (c.name === n) return c; const r = find(c, n); if (r) return r } return null };
    const item = root ? find(root, 'm_admitpatient') : null;
    if (!item) return { found: false };
    await rt.fire(item, 'selected').catch(() => {});
    void rt.fire(item, 'clicked').catch(() => {});
    return { found: true };
  });
  await page.waitForFunction(() => window.rt.windowInstances.get('w_patientadmission_form'), null, { timeout: 30000, polling: 300 });
  await sleep(1500); await poll(2);
  step('admission form open');
  await page.evaluate(async () => { const rt = window.rt; const w = rt.windowInstances.get('w_patientadmission_form'); void w.pbCall('ue_list', [], rt).catch(() => {}) });
  for (let i = 0; i < 40; i++) { await sleep(500); const n = await page.evaluate(() => window.rt.windowInstances.get('w_patientadmission_form')?.props.get('id_list')?.model?.rowCount?.() ?? 0); if (n > 0) { out.admissionListRows = n; break; } await poll(1); }
  out.admissionPick = await page.evaluate(async () => {
    const rt = window.rt; const w = rt.windowInstances.get('w_patientadmission_form');
    const l = w.props.get('id_list'); const m = l.model; const ci = m.colIndex('code') >= 0 ? m.colIndex('code') : 0;
    const hit = [...m.buf.primary.entries()].find(([, r]) => Number(r.v[ci]) === 1);
    if (!hit) return { error: 'admission not in list', rows: m.rowCount() };
    w.props.set('id_dwcontrol', l); w.props.set('il_selectedrow', hit[0] + 1);
    await w.pbCall('ue_detail', [], rt).catch(() => {});
    await new Promise((r) => setTimeout(r, 1200));
    const mm = w.props.get('id_master');
    return { row: hit[0] + 1, listRows: m.rowCount(), code: mm?.model?.buf.primary[0]?.v?.[mm.model.colIndex('code')] ?? null, ibModify: w.props.get('ib_modify') ?? null };
  });
  await poll(2);
  step('admission pick ' + JSON.stringify(out.admissionPick));
  out.admissionEdit = await page.evaluate(async ({ remark }) => {
    const rt = window.rt; const w = rt.windowInstances.get('w_patientadmission_form'); const m = w.props.get('id_master');
    await m.pbCall('setitem', [1, 'remarks', remark], rt);
    await m.pbCall('setitem', [1, 'diagnosis', 'PARITY DIAGNOSIS EDITED'], rt);
    await m.pbCall('setrow', [1], rt).catch(() => {});
    m.model.acceptText = async () => 1;
    window.__saveEdit = false;
    void w.pbCall('ue_save', [], rt).then(() => { window.__saveEdit = 'ok' }).catch((e) => { window.__saveEdit = 'ERR ' + String(e.message || e).slice(0, 400) });
    return { values: m.model.buf.primary[0]?.v };
  }, { remark: REMARK2 });
  await poll(16);
  out.admissionEditResult = await page.evaluate(() => window.__saveEdit ?? null);
  out.afterAdmissionEdit = rows("select admissioncode,remarks,diagnosis from dbo.patientadmission where admissioncode=1")[0] ?? null;
  out.admissionEditOk = out.afterAdmissionEdit?.[1] === REMARK2 && out.afterAdmissionEdit?.[2] === 'PARITY DIAGNOSIS EDITED'
    && out.messages.some((m) => /Changes take effect in database/i.test(m));
  step('admission edit ' + JSON.stringify(out.afterAdmissionEdit) + ' msgs ' + JSON.stringify(out.messages));
  // ---------------------------------------------------------------- discharge
  out.menuDischarge = await page.evaluate(async () => {
    const rt = window.rt; const root = rt.windowInstances.get('w_main')?.props.get('menuid');
    const find = (o, n) => { for (const c of o.children.values()) { if (c.name === n) return c; const r = find(c, n); if (r) return r } return null };
    const item = root ? find(root, 'm_dischargepatient') : null;
    if (!item) return { found: false };
    await rt.fire(item, 'selected').catch(() => {});
    void rt.fire(item, 'clicked').catch(() => {});
    return { found: true, visible: item.props.get('visible') };
  });
  await page.waitForFunction(() => window.rt.windowInstances.get('w_patientdischarge_form'), null, { timeout: 30000, polling: 300 });
  await sleep(1500); await poll(2);
  step('discharge form open');
  out.dischargeOpen = await page.evaluate(() => {
    const w = window.rt.windowInstances.get('w_patientdischarge_form');
    return { title: String(w.props.get('title') ?? ''), detail: !!w.props.get('id_detail'), list: !!w.props.get('id_list'), initialRight: w.props.get('ib_initialdischarge'), finalRight: w.props.get('ib_finaldischarge') };
  });
  await page.evaluate(async () => { const rt = window.rt; const w = rt.windowInstances.get('w_patientdischarge_form'); void w.pbCall('ue_list', [], rt).catch(() => {}) });
  for (let i = 0; i < 40; i++) { await sleep(500); const n = await page.evaluate(() => window.rt.windowInstances.get('w_patientdischarge_form')?.props.get('id_list')?.model?.rowCount?.() ?? 0); if (n > 0) { out.dischargeListRows = n; break; } await poll(1); }
  out.dischargePick = await page.evaluate(async () => {
    const rt = window.rt; const w = rt.windowInstances.get('w_patientdischarge_form');
    const l = w.props.get('id_list'); const m = l.model; const ci = m.colIndex('code') >= 0 ? m.colIndex('code') : 0;
    const hit = [...m.buf.primary.entries()].find(([, r]) => Number(r.v[ci]) === 1);
    if (!hit) return { error: 'admission not in discharge list', rows: m.rowCount() };
    w.props.set('id_dwcontrol', l); w.props.set('il_selectedrow', hit[0] + 1);
    await w.pbCall('ue_detail', [], rt).catch(() => {});
    await new Promise((r) => setTimeout(r, 1200));
    const d = w.props.get('id_detail');
    return { row: hit[0] + 1, listRows: m.rowCount(), detailRows: d?.model?.rowCount?.() ?? null, values: d?.model?.buf.primary[0]?.v ?? null, ibDischarged1: w.props.get('ib_discharged1') };
  });
  await poll(2);
  step('discharge pick ' + JSON.stringify(out.dischargePick));
  // initial discharge only
  out.initial = await page.evaluate(async () => {
    const rt = window.rt; const w = rt.windowInstances.get('w_patientdischarge_form'); const d = w.props.get('id_detail');
    await d.pbCall('setitem', [1, 'discharged1', 'Y'], rt);
    await d.pbCall('setitem', [1, 'discharged', 'N'], rt);
    await d.pbCall('setrow', [1], rt).catch(() => {});
    d.model.acceptText = async () => 1;
    window.__saveInitial = false;
    void w.pbCall('ue_save', [], rt).then(() => { window.__saveInitial = 'ok' }).catch((e) => { window.__saveInitial = 'ERR ' + String(e.message || e).slice(0, 400) });
    return { values: d.model.buf.primary[0]?.v };
  });
  await poll(16, true);
  out.initialResult = await page.evaluate(() => window.__saveInitial ?? null);
  out.afterInitial = rows("select admissioncode,discharged1,discharged1by,discharged1on::text,discharged,dischargedby,dischargedon::text from dbo.patientadmission where admissioncode=1")[0] ?? null;
  step('initial ' + JSON.stringify(out.afterInitial) + ' msgs ' + JSON.stringify(out.messages));
  out.initialOk = out.afterInitial?.[1] === 'Y' && out.afterInitial?.[2] === '1' && !!out.afterInitial?.[3] && out.afterInitial?.[4] === 'N'
    && out.messages.some((m) => /Changes take effect in database/i.test(m));
  // final discharge
  out.messagesBeforeFinal = out.messages.length;
  out.finalStage = await page.evaluate(async () => {
    const rt = window.rt; const w = rt.windowInstances.get('w_patientdischarge_form'); const d = w.props.get('id_detail');
    await d.pbCall('setitem', [1, 'discharged', 'Y'], rt);
    await d.pbCall('setrow', [1], rt).catch(() => {});
    d.model.acceptText = async () => 1;
    window.__saveFinal = false;
    void w.pbCall('ue_save', [], rt).then(() => { window.__saveFinal = 'ok' }).catch((e) => { window.__saveFinal = 'ERR ' + String(e.message || e).slice(0, 400) });
    return { values: d.model.buf.primary[0]?.v };
  });
  await poll(18, true);
  out.finalResult = await page.evaluate(() => window.__saveFinal ?? null);
  out.afterFinal = rows("select admissioncode,discharged1,discharged,dischargedby,dischargedon::text from dbo.patientadmission where admissioncode=1")[0] ?? null;
  out.occupiedAfterFinal = rows("select count(*) from dbo.patientadmission where discharged='N' and locationcode=1")[0]?.[0] ?? null;
  step('final ' + JSON.stringify(out.afterFinal) + ' msgs ' + JSON.stringify(out.messages));
  out.finalEarlyReturn = out.afterFinal?.[2] === 'N' && out.finalResult === 'ok'
    && !out.messages.slice(out.messagesBeforeFinal).some((m) => /Changes take effect in database/i.test(m));
  restore();
  out.final = counts();
  out.final.residue = rows("select count(*) from dbo.patientadmission where admissioncode=1")[0]?.[0] ?? null;
  out.baselineOk = out.final.admissions === out.baseline.admissions && out.final.admissionMax === out.baseline.admissionMax
    && out.final.patients === out.baseline.patients && out.final.locations === out.baseline.locations
    && out.final.wards === out.baseline.wards && out.final.tab === out.baseline.tab
    && out.final.serverDate === out.baseline.serverDate
    && out.final.audit === out.baseline.audit && out.final.auditMax === out.baseline.auditMax
    && out.final.residue === '0';
  out.ok = !!out.admissionEditOk && !!out.initialOk && !!out.finalEarlyReturn && out.baselineOk;
} catch (e) { out.fatal = String(e.stack || e).slice(0, 3000); }
finally {
  restore();
  console.log(JSON.stringify(out, (k, v) => (typeof v === 'bigint' ? Number(v) : v), 1));
  await browser.close().catch(() => {});
}
