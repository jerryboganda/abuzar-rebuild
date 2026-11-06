// Patient Transfer (m_trasnferpatient -> w_patienttransfer_form): move an
// admitted patient from bed 1 to bed 2, verify PatientTransfer and the
// PatientAdmission location update, then remove all fixtures.
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const require = createRequire(process.env.PLAYWRIGHT_MODULES || 'C:/Users/Admin/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/');
const { chromium } = require('playwright');
const PSQL = 'C:\\PostgreSQL\\17\\bin\\psql.exe';
const DB = process.env.PARITY_DB || 'trader_write_test';
const q = (sql) => execFileSync(PSQL, ['-U', 'postgres', '-h', '127.0.0.1', '-d', DB, '-t', '-A', '-F', '|', '-c', sql], { env: { ...process.env, PGPASSWORD: 'postgres' }, encoding: 'utf8', windowsHide: true }).trim();
const rows = (sql) => q(sql).split(/\r?\n/).filter(Boolean).map((l) => l.split('|'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const REMARK = 'PARITY TRANSFER PAT ' + String(Date.now()).slice(-6);
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
  transfers: Number(rows('select count(*) from dbo.patienttransfer')[0][0]),
  transferMax: Number(rows('select coalesce(max(transfercode),0) from dbo.patienttransfer')[0][0]),
  admissions: Number(rows('select count(*) from dbo.patientadmission')[0][0]),
  patients: Number(rows('select count(*) from dbo.patient')[0][0]),
  locations: Number(rows('select count(*) from dbo.patientlocation')[0][0]),
  wards: Number(rows('select count(*) from dbo.ward')[0][0]),
  tab: rows("select tabmaxkey from dbo._tabmaxkey where tabname='PatientTransfer'")[0]?.[0] ?? null,
  serverDate: rows('select lasttransdate::text from dbo.serverdate')[0]?.[0] ?? null,
  audit: Number(rows('select count(*) from dbo.audit_log')[0][0]),
  auditMax: Number(rows('select max(audit_id) from dbo.audit_log')[0][0]),
});
const restore = () => {
  try {
    killIdle();
    q(`set session_replication_role = replica;
       delete from dbo.patienttransfer where remarks='${REMARK}';
       delete from dbo.patientadmission where admissioncode=1 and remarks='${REMARK} PRE';
       delete from dbo.patient where regno='PARITY-PT1';
       delete from dbo.patientlocation where name in ('PARITY BED 1','PARITY BED 2');
       delete from dbo.ward where name='PARITY WARD';
       set session_replication_role = origin`);
    if (out.baseline?.tab !== null) q(`update dbo._tabmaxkey set tabmaxkey=${Number(out.baseline.tab)} where tabname='PatientTransfer'`);
    if (out.baseline?.serverDate) q(`update dbo.serverdate set lasttransdate='${String(out.baseline.serverDate).replace(/'/g, "''")}'::timestamp`);
    if (out.baseline?.auditMax) { q(`delete from dbo.audit_log where audit_id > ${out.baseline.auditMax}`); q(`select setval(pg_get_serial_sequence('dbo.audit_log','audit_id'), ${out.baseline.auditMax}, true)`); }
  } catch (e) { out.restoreError = String(e.message || e).slice(0, 700); }
};
try {
  out.baseline = counts();
  q("insert into dbo.ward (wardcode,name,description) values (1,'PARITY WARD','PARITY')");
  q("insert into dbo.patientlocation (locationcode,name,wardcode) values (1,'PARITY BED 1',1),(2,'PARITY BED 2',1)");
  q("insert into dbo.patient (patientcode,regno,active,name,gender,date,usercode,membershipid,custcode,diseasecode,locationcode,rankcode,unitcode,patientcatcode,gestationcode,createdby) values (1,'PARITY-PT1','Y','PARITY TRANSFER PATIENT','M',localtimestamp(3),1,'PARITY-MT1',19,1,1,1,1,1,1,1)");
  q(`insert into dbo.patientadmission (admissioncode,patientcode,custcode,locationcode,date,usercode,diseasecode,diagnosis,remarks,cashacccode,cashtendered,cashcharged,cashback,procedurecharges,proceduregstperc,transportcharges,dischargereasoncode) values (1,1,19,1,localtimestamp(3),1,1,'PARITY DIAGNOSIS','${REMARK} PRE',2,0,0,0,0,0,0,1)`);
  await page.goto('http://127.0.0.1:5177/?app=1&autologin=ADMIN:password9080', { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.rt && window.rt.windowInstances.get('w_main') && typeof window.__menu === 'function', null, { timeout: 90000, polling: 300 });
  out.menuOpen = await page.evaluate(async () => {
    const rt = window.rt; const root = rt.windowInstances.get('w_main')?.props.get('menuid');
    const find = (o, n) => { for (const c of o.children.values()) { if (c.name === n) return c; const r = find(c, n); if (r) return r } return null };
    const item = root ? find(root, 'm_trasnferpatient') : null;
    if (!item) return { found: false };
    await rt.fire(item, 'selected').catch(() => {});
    await rt.fire(item, 'clicked').catch(() => {});
    return { found: true, visible: item.props.get('visible'), text: String(item.props.get('text') ?? '') };
  });
  await page.waitForFunction(() => window.rt.windowInstances.get('w_patienttransfer_form'), null, { timeout: 30000, polling: 300 });
  await sleep(1600); await poll(2);
  out.open = await page.evaluate(() => {
    const w = window.rt.windowInstances.get('w_patienttransfer_form');
    return { title: String(w.props.get('title') ?? ''), detail: !!w.props.get('id_detail'), list: !!w.props.get('id_list') };
  });
  await page.evaluate(async () => { const rt = window.rt; const w = rt.windowInstances.get('w_patienttransfer_form'); await w.pbCall('ue_newform', [], rt).catch(() => {}) });
  await sleep(900); await poll(1);
  out.fill = await page.evaluate(async ({ remark }) => {
    const rt = window.rt; const w = rt.windowInstances.get('w_patienttransfer_form'); const d = w.props.get('id_detail');
    if (!d.model.rowCount()) await d.pbCall('insertrow', [0], rt);
    const values = { admissioncode: 1, sourcelocation: 1, targetlocation: 2, remarks: remark, date: '2026-11-06 00:00:00' };
    const bad = [];
    for (const [k, v] of Object.entries(values)) { try { await d.pbCall('setitem', [1, k, v], rt) } catch { bad.push(k) } }
    await d.pbCall('setrow', [1], rt).catch(() => {});
    d.model.acceptText = async () => 1;
    return { bad, rows: d.model.rowCount(), values: d.model.buf.primary[0]?.v };
  }, { remark: REMARK });
  out.save = await page.evaluate(async () => {
    const rt = window.rt; const w = rt.windowInstances.get('w_patienttransfer_form');
    window.__save = false;
    void w.pbCall('ue_save', [], rt).then(() => { window.__save = 'ok' }).catch((e) => { window.__save = 'ERR ' + String(e.message || e).slice(0, 400) });
    return 'fired';
  });
  out.password = null;
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    const has = await page.evaluate(() => !!window.rt.windowInstances.get('w_salesmanpassword'));
    if (has) {
      out.password = await page.evaluate(async () => {
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
    transfer: rows(`select transfercode,admissioncode,sourcelocation,targetlocation,remarks,usercode from dbo.patienttransfer where remarks='${REMARK}'`)[0] ?? null,
    admission: rows("select admissioncode,locationcode,discharged from dbo.patientadmission where admissioncode=1")[0] ?? null,
    tab: rows("select tabmaxkey from dbo._tabmaxkey where tabname='PatientTransfer'")[0]?.[0] ?? null,
  };
  out.code = out.afterAdd.transfer?.[0] ?? null;
  out.addOk = !!out.code && out.afterAdd.transfer?.[2] === '1' && out.afterAdd.transfer?.[3] === '2'
    && out.afterAdd.admission?.[1] === '2' && out.afterAdd.tab === out.code
    && out.messages.some((m) => /Changes take effect in database/i.test(m));
  restore();
  out.final = counts();
  out.final.residue = rows(`select count(*) from dbo.patienttransfer where remarks='${REMARK}'`)[0]?.[0] ?? null;
  out.baselineOk = out.final.transfers === out.baseline.transfers && out.final.transferMax === out.baseline.transferMax
    && out.final.admissions === out.baseline.admissions && out.final.patients === out.baseline.patients
    && out.final.locations === out.baseline.locations && out.final.wards === out.baseline.wards
    && out.final.tab === out.baseline.tab && out.final.serverDate === out.baseline.serverDate
    && out.final.audit === out.baseline.audit && out.final.auditMax === out.baseline.auditMax
    && out.final.residue === '0';
  out.ok = !!out.addOk && out.baselineOk;
} catch (e) { out.fatal = String(e.stack || e).slice(0, 3000); }
finally {
  restore();
  console.log(JSON.stringify(out, (k, v) => (typeof v === 'bigint' ? Number(v) : v), 1));
  await browser.close().catch(() => {});
}
