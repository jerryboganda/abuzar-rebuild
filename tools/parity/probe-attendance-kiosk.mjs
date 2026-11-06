// Employee attendance kiosk (m_employeeonlineattendance -> w_emp_attendance):
// a temporary employee with AllowAttendanceViaID='Y' is identified by EMPID.
// The first scan opens EMP_Attendance (timein), the second closes it (timeout);
// both pass through sp_markattendance.
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { appendFileSync, writeFileSync } from 'node:fs';
const require = createRequire(process.env.PLAYWRIGHT_MODULES || 'C:/Users/Admin/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/');
const { chromium } = require('playwright');
const PSQL = 'C:\\PostgreSQL\\17\\bin\\psql.exe';
const DB = process.env.PARITY_DB || 'trader_write_test';
const STEPS = 'C:/Projects/Abuzar/deploy/parity/attendance-kiosk-steps.txt';
writeFileSync(STEPS, '');
const step = (s) => appendFileSync(STEPS, new Date().toISOString() + ' ' + s + '\n');
const q = (sql) => execFileSync(PSQL, ['-U', 'postgres', '-h', '127.0.0.1', '-d', DB, '-t', '-A', '-F', '|', '-c', sql], { env: { ...process.env, PGPASSWORD: 'postgres' }, encoding: 'utf8', windowsHide: true }).trim();
const rows = (sql) => q(sql).split(/\r?\n/).filter(Boolean).map((l) => l.split('|'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const EMPID = 'PARITYATT' + String(Date.now()).slice(-4);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
page.setDefaultTimeout(20000);
const out = { empid: EMPID, messages: [], errors: [], net: [] };
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
  attendance: Number(rows('select count(*) from dbo.emp_attendance')[0][0]),
  attendanceMax: Number(rows('select coalesce(max(attendancecode),0) from dbo.emp_attendance')[0][0]),
  seq: rows("select last_value::text,is_called::text from dbo.emp_attendance_attendancecode_seq")[0] ?? null,
  employees: Number(rows('select count(*) from dbo.emp_employee')[0][0]),
  timings: Number(rows('select count(*) from dbo.emp_departmenttiming where deptcode=1')[0][0]),
  prefTimeslabs: rows("select prefvalue from dbo.softwarepreferences where name='ApplyDeptTimeSlabsInOnlineAtten'")[0]?.[0] ?? null,
  serverDate: rows('select lasttransdate::text from dbo.serverdate')[0]?.[0] ?? null,
  audit: Number(rows('select count(*) from dbo.audit_log')[0][0]),
  auditMax: Number(rows('select max(audit_id) from dbo.audit_log')[0][0]),
});
const restore = () => {
  try {
    killIdle();
    q(`set session_replication_role = replica;
       delete from dbo.emp_attendance where empcode=1;
       delete from dbo.emp_employee where empid='${EMPID.replace(/'/g, "''")}';
       set session_replication_role = origin`);
    if (out.baseline?.timings === 0) q("delete from dbo.emp_departmenttiming where deptcode=1 and weekdaycode between 1 and 7 and fhtimein='1900-01-01 00:00:00'");
    if (out.baseline?.prefTimeslabs) q(`update dbo.softwarepreferences set prefvalue='${String(out.baseline.prefTimeslabs).replace(/'/g, "''")}' where name='ApplyDeptTimeSlabsInOnlineAtten'`);
    if (out.baseline?.seq) q(`select setval('dbo.emp_attendance_attendancecode_seq', ${Number(out.baseline.seq[0])}, ${['t', 'true'].includes(out.baseline.seq[1]) ? 'true' : 'false'})`);
    if (out.baseline?.serverDate) q(`update dbo.serverdate set lasttransdate='${String(out.baseline.serverDate).replace(/'/g, "''")}'::timestamp`);
    if (out.baseline?.auditMax) { q(`delete from dbo.audit_log where audit_id > ${out.baseline.auditMax}`); q(`select setval(pg_get_serial_sequence('dbo.audit_log','audit_id'), ${out.baseline.auditMax}, true)`); }
  } catch (e) { out.restoreError = String(e.message || e).slice(0, 700); }
};
try {
  out.baseline = counts();
  q(`insert into dbo.emp_employee (empcode,empid,fullname,empcatcode,deptcode,desigcode,acccode,advacccode,allowattendanceviaid,active) values (1,'${EMPID}','PARITY ATTENDANCE',1,1,1,2,24,'Y','Y')`);
  // ApplyDeptTimeSlabsInOnlineAtten is ON in this installation; the
  // department has no timing rows, so provide an all-day 7-day slot.  The
  // generator now anchors the time-slab values to the current date.
  q(`insert into dbo.emp_departmenttiming (deptcode,weekdaycode,fhtimein,fhtimeout,shtimein,shtimeout)
     select 1, w, '1900-01-01 00:00:00', '1900-01-01 23:59:59', '1900-01-01 00:00:00', '1900-01-01 23:59:59'
     from generate_series(1,7) w`);
  step('fixtures ready ' + EMPID);
  await page.goto('http://127.0.0.1:5177/?app=1&autologin=ADMIN:password9080', { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.rt && window.rt.windowInstances.get('w_main') && typeof window.__menu === 'function', null, { timeout: 90000, polling: 300 });
  step('logged in');
  out.menuOpen = await page.evaluate(async () => {
    const rt = window.rt; const root = rt.windowInstances.get('w_main')?.props.get('menuid');
    const find = (o, n) => { for (const c of o.children.values()) { if (c.name === n) return c; const r = find(c, n); if (r) return r } return null };
    const item = root ? find(root, 'm_employeeonlineattendance') : null;
    if (!item) return { found: false };
    await rt.fire(item, 'selected').catch(() => {});
    void rt.fire(item, 'clicked').catch(() => {});
    return { found: true, visible: item.props.get('visible'), text: String(item.props.get('text') ?? '') };
  });
  step('menu fired ' + JSON.stringify(out.menuOpen));
  await page.waitForFunction(() => window.rt.windowInstances.get('w_emp_attendance'), null, { timeout: 30000, polling: 300 });
  await sleep(2000); await poll(3);
  step('kiosk open');
  out.open = await page.evaluate(() => {
    const w = window.rt.windowInstances.get('w_emp_attendance');
    const find = (o, n) => { if (o.name === n) return o; for (const c of o.children.values()) { const r = find(c, n); if (r) return r } return null };
    return { title: String(w.props.get('title') ?? ''), dwEmpid: !!find(w, 'dw_empid'), uo: !!find(w, 'uo_attendance'), row: find(w, 'uo_attendance')?.props.get('dw_control')?.model?.rowCount?.() ?? null };
  });
  step('open props ' + JSON.stringify(out.open));
  // first scan: employee ID opens an attendance row
  out.scan1 = await page.evaluate(async (empid) => {
    const rt = window.rt; const w = rt.windowInstances.get('w_emp_attendance');
    window.__scan1 = false;
    void w.pbCall('wf_validate_empid', [empid], rt).then((r) => { window.__scan1 = String(r) }).catch((e) => { window.__scan1 = 'ERR ' + String(e.message || e).slice(0, 400) });
    return { fired: true };
  }, EMPID);
  await poll(12);
  out.scan1Result = await page.evaluate(() => window.__scan1 ?? null);
  out.afterScan1 = {
    row: rows("select attendancecode,empcode,fingercode,timein::text,timeout::text,attendancestatuscode,payed from dbo.emp_attendance where empcode=1 order by attendancecode")[0] ?? null,
    display: await page.evaluate(() => {
      const w = window.rt.windowInstances.get('w_emp_attendance');
      const find = (o, n) => { if (o.name === n) return o; for (const c of o.children.values()) { const r = find(c, n); if (r) return r } return null };
      const uo = find(w, 'uo_attendance'); const d = uo?.props.get('dw_control');
      return { rows: d?.model?.rowCount?.() ?? null, values: d?.model?.buf?.primary?.[0]?.v ?? null };
    }),
    seq: rows("select last_value::text,is_called::text from dbo.emp_attendance_attendancecode_seq")[0] ?? null,
  };
  step('scan1 ' + JSON.stringify(out.afterScan1));
  // second scan: closes the open attendance (timeout)
  out.scan2 = await page.evaluate(async (empid) => {
    const rt = window.rt; const w = rt.windowInstances.get('w_emp_attendance');
    window.__scan2 = false;
    void w.pbCall('wf_validate_empid', [empid], rt).then((r) => { window.__scan2 = String(r) }).catch((e) => { window.__scan2 = 'ERR ' + String(e.message || e).slice(0, 400) });
    return { fired: true };
  }, EMPID);
  await poll(12);
  out.scan2Result = await page.evaluate(() => window.__scan2 ?? null);
  out.afterScan2 = {
    row: rows("select attendancecode,empcode,fingercode,timein::text,timeout::text,attendancestatuscode,payed from dbo.emp_attendance where empcode=1 order by attendancecode")[0] ?? null,
    display: await page.evaluate(() => {
      const w = window.rt.windowInstances.get('w_emp_attendance');
      const find = (o, n) => { if (o.name === n) return o; for (const c of o.children.values()) { const r = find(c, n); if (r) return r } return null };
      const uo = find(w, 'uo_attendance'); const d = uo?.props.get('dw_control');
      return { rows: d?.model?.rowCount?.() ?? null, values: d?.model?.buf?.primary?.[0]?.v ?? null };
    }),
    seq: rows("select last_value::text,is_called::text from dbo.emp_attendance_attendancecode_seq")[0] ?? null,
  };
  step('scan2 ' + JSON.stringify(out.afterScan2));
  out.scan1Ok = out.afterScan1.row?.[1] === '1' && !!out.afterScan1.row?.[3] && out.afterScan1.row?.[4] === ''
    && out.afterScan1.row?.[6] === 'N';
  out.scan2Ok = out.afterScan2.row?.[0] === out.afterScan1.row?.[0]
    && !!out.afterScan2.row?.[4] && out.afterScan2.row?.[6] === 'N';
  step('done');
  restore();
  out.final = counts();
  out.baselineOk = out.final.attendance === out.baseline.attendance && out.final.attendanceMax === out.baseline.attendanceMax
    && JSON.stringify(out.final.seq) === JSON.stringify(out.baseline.seq)
    && out.final.employees === out.baseline.employees && out.final.timings === out.baseline.timings
    && out.final.prefTimeslabs === out.baseline.prefTimeslabs
    && out.final.serverDate === out.baseline.serverDate
    && out.final.audit === out.baseline.audit && out.final.auditMax === out.baseline.auditMax;
  out.ok = !!out.scan1Ok && !!out.scan2Ok && out.baselineOk;
} catch (e) { out.fatal = String(e.stack || e).slice(0, 3000); step('FATAL ' + out.fatal); }
finally {
  restore();
  console.log(JSON.stringify(out, (k, v) => (typeof v === 'bigint' ? Number(v) : v), 1));
  await browser.close().catch(() => {});
}
