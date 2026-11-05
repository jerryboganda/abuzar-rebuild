// Job Schedule full cycle on the PostgreSQL scheduler stand-in.
//  - open Manage | Job Schedule
//  - configure all job/schedule globals (the recovered globals are empty in
//    this deployment; the original main DB has no SysJobs/SysJobSchedules)
//  - enable Auto Backup (Once At 10:30:00 PM) and Auto Cash Sale Posting (60 min)
//  - save: verify sysjobs enabled flags + sysjobschedules rows
//  - reopen, disable both, save: verify all jobs disabled
//  - restore sysjobs/sysjobschedules to empty, preferences, audit and serverdate
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const require = createRequire(process.env.PLAYWRIGHT_MODULES || 'C:/Users/Admin/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/');
const { chromium } = require('playwright');
const PSQL = 'C:\\PostgreSQL\\17\\bin\\psql.exe';
const q = (sql) => execFileSync(PSQL, ['-U', 'postgres', '-h', '127.0.0.1', '-d', 'trader_write_test', '-t', '-A', '-F', '|', '-c', sql], { env: { ...process.env, PGPASSWORD: 'postgres' }, encoding: 'utf8', windowsHide: true }).trim();
const rows = (sql) => q(sql).split(/\r?\n/).filter(Boolean).map((l) => l.split('|'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PAIRS = [
  ['gs_clientjob', 'gs_clientjobschedule'],
  ['gs_autocashsalepostingjob', 'gs_autocashsalepostingjobschedule'],
];
const NAMES = PAIRS.map(([job, sched], i) => ({ job, sched, jobName: 'PARITY_JOB_' + String(i + 1).padStart(2, '0'), schedName: 'PARITY_SCHED_' + String(i + 1).padStart(2, '0') }));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const out = { pairs: NAMES.length, messages: [], errors: [], net: [] };
page.on('pageerror', (e) => out.errors.push(String(e.message || e).slice(0, 400)));
page.on('request', (r) => { if (r.url().includes('/api/exec')) out.net.push({ p: 'req', body: String(r.postData() || '') }) });
page.on('response', async (r) => { if (r.url().includes('/api/exec')) { let b = ''; try { b = await r.text() } catch {} out.net.push({ p: 'res', status: r.status(), body: String(b).slice(0, 500) }) } });
async function poll(seconds = 10) {
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
async function openSchedule() {
  await page.evaluate(() => { void window.__menu('Manage | Job Schedule') });
  await page.waitForFunction(() => window.rt.windowInstances.get('w_job_schedule'), null, { timeout: 40000, polling: 300 });
  await sleep(2200); await poll(3);
}
async function save() {
  await page.evaluate(async () => {
    const rt = window.rt; const w = rt.windowInstances.get('w_job_schedule');
    const cb = w.children.get('cb_ok');
    window.__jobSave = false;
    void rt.fire(cb, 'clicked').then(() => { window.__jobSave = 'ok' }).catch((e) => { window.__jobSave = 'ERR ' + String(e.message || e).slice(0, 300) });
  });
  for (let i = 0; i < 60; i++) {
    await sleep(500);
    const done = await page.evaluate(() => window.__jobSave);
    await poll(1);
    if (done) break;
  }
  await poll(3);
  return await page.evaluate(() => window.__jobSave);
}
try {
  out.baseline = {
    sysjobs: Number(rows('select count(*) from dbo.sysjobs')[0][0]),
    sched: Number(rows('select count(*) from dbo.sysjobschedules')[0][0]),
    pref: rows("select name,prefvalue,coalesce(prefvalue2,'') from dbo.softwarepreferences where lower(name)='cashsaleautopostingtime'"),
    audit: Number(rows('select count(*) from dbo.audit_log')[0][0]),
    auditMax: Number(rows('select max(audit_id) from dbo.audit_log')[0][0]),
    serverdate: rows('select lasttransdate from dbo.serverdate')[0]?.[0] ?? null,
  };
  await page.goto('http://127.0.0.1:5177/?app=1&autologin=ADMIN:password9080', { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.rt && window.rt.windowInstances.get('w_main') && typeof window.__menu === 'function', null, { timeout: 90000, polling: 300 });
  await openSchedule();
  out.afterOpen = {
    sysjobs: Number(rows('select count(*) from dbo.sysjobs')[0][0]),
    sched: Number(rows('select count(*) from dbo.sysjobschedules')[0][0]),
  };
  out.state = await page.evaluate(() => {
    const rt = window.rt; const w = rt.windowInstances.get('w_job_schedule');
    const tab = w.children.get('tab_preferences');
    const bp = tab.children.get('tabpage_backup');
    const sp = tab.children.get('tabpage_sales');
    const g = sp.children.get('dw_autocashsalepostingschedule');
    return { title: String(w.props.get('title') ?? ''), tabs: [...tab.children.keys()].slice(0, 12), backupCbx: !!bp.children.get('cbx_activateautobackup'), cashCbx: !!sp.children.get('cbx_activateautocashsaleposting'), cashGrid: g?.model ? { rows: g.model.rowCount(), cols: g.model.colNames } : null };
  });
  out.configure = await page.evaluate(async ({ pairs }) => {
    const rt = window.rt; const w = rt.windowInstances.get('w_job_schedule');
    for (const p of pairs) { rt.globals.set(p.job, p.jobName); rt.globals.set(p.sched, p.schedName); }
    const tab = w.children.get('tab_preferences');
    const bp = tab.children.get('tabpage_backup');
    const sp = tab.children.get('tabpage_sales');
    const setText = (c, t) => { if (c) c.pbSet('text', t) };
    bp.children.get('cbx_activateautobackup').props.set('checked', true);
    bp.children.get('rb_backupevery').props.set('checked', false);
    bp.children.get('rb_backuponce').props.set('checked', true);
    setText(bp.children.get('ddlb_backuphr'), '10');
    setText(bp.children.get('ddlb_backupmin'), '30');
    setText(bp.children.get('ddlb_backupsec'), '00');
    setText(bp.children.get('ddlb_backuptime'), 'PM');
    sp.children.get('cbx_activateautocashsaleposting').props.set('checked', true);
    setText(sp.children.get('em_autocashsalepostingtime'), '60');
    const g = sp.children.get('dw_autocashsalepostingschedule');
    if (g) {
      if (g.model.rowCount() === 0) await g.pbCall('insertrow', [0], rt);
      await g.pbCall('setitem', [1, 'unit', 4], rt).catch(() => {});
      await g.pbCall('setitem', [1, 'unitvalue', 60], rt).catch(() => {});
      await g.pbCall('accepttext', [], rt).catch(() => {});
    }
    const globals = Object.fromEntries(pairs.slice(0, 3).map((p) => [p.job, String(rt.globals.get(p.job) ?? '')]));
    return { globals, backupChecked: bp.children.get('cbx_activateautobackup').props.get('checked'), cashChecked: sp.children.get('cbx_activateautocashsaleposting').props.get('checked'), hr: String(bp.children.get('ddlb_backuphr').props.get('text')), ampm: String(bp.children.get('ddlb_backuptime').props.get('text')), cashRows: g?.model.rowCount?.() ?? null };
  }, { pairs: NAMES });
  out.save1 = await save();
  out.afterEnable = {
    jobs: rows('select name,enabled from dbo.sysjobs order by name'),
    sched: rows('select j.name,s.name,s.freq_subday_type,s.freq_subday_interval,s.active_start_time from dbo.sysjobschedules s join dbo.sysjobs j on j.job_id=s.job_id order by j.name'),
    pref: rows("select prefvalue,coalesce(prefvalue2,'') from dbo.softwarepreferences where lower(name)='cashsaleautopostingtime'"),
  };
  out.clientEnabled = out.afterEnable.jobs.find((r) => r[0] === 'PARITY_JOB_01')?.[1] ?? null;
  out.cashEnabled = out.afterEnable.jobs.find((r) => r[0] === 'PARITY_JOB_02')?.[1] ?? null;
  out.clientSched = out.afterEnable.sched.find((r) => r[0] === 'PARITY_JOB_01') ?? null;
  out.cashSched = out.afterEnable.sched.find((r) => r[0] === 'PARITY_JOB_02') ?? null;
  out.enableOk = out.afterEnable.jobs.length === 2 && out.clientEnabled === '1' && out.cashEnabled === '1' && out.clientSched?.[4] === '223000' && out.clientSched?.[2] === '1' && out.cashSched?.[2] === '4' && out.cashSched?.[3] === '60' && out.afterEnable.pref?.[0]?.[0] === '60';
  // second pass: disable both
  await openSchedule();
  out.disable = await page.evaluate(async () => {
    const rt = window.rt; const w = rt.windowInstances.get('w_job_schedule');
    const tab = w.children.get('tab_preferences');
    const bp = tab.children.get('tabpage_backup');
    const sp = tab.children.get('tabpage_sales');
    bp.children.get('cbx_activateautobackup').props.set('checked', false);
    sp.children.get('cbx_activateautocashsaleposting').props.set('checked', false);
    return { backup: bp.children.get('cbx_activateautobackup').props.get('checked'), cash: sp.children.get('cbx_activateautocashsaleposting').props.get('checked') };
  });
  out.save2 = await save();
  out.afterDisable = {
    jobs: rows('select name,enabled from dbo.sysjobs order by name'),
    sched: rows('select count(*) from dbo.sysjobschedules'),
  };
  out.disableOk = out.afterDisable.jobs.length === 2 && out.afterDisable.jobs.every((r) => r[1] === '0') && out.afterDisable.sched?.[0]?.[0] === String(out.afterEnable.sched.length);
  out.sql = out.net.filter((x) => String(x.body).toLowerCase().includes('sysjob') || String(x.body).toLowerCase().includes('sp_adjustjobschedule') || String(x.body).toLowerCase().includes('sp_activatejob')).slice(0, 6);
  // exact restore
  const pb = out.baseline.pref?.[0];
  if (pb) q(`update dbo.softwarepreferences set prefvalue=${pb[1] === null ? 'null' : `'${String(pb[1]).replace(/'/g, "''")}'`}, prefvalue2=${pb[2] === '' ? 'null' : `'${String(pb[2]).replace(/'/g, "''")}'`} where lower(name)='cashsaleautopostingtime'`);
  q(`delete from dbo.sysjobs where name like 'PARITY_JOB_%' or name=''`);
  q("select setval(pg_get_serial_sequence('dbo.sysjobs','job_id'), 1, false)");
  q("select setval(pg_get_serial_sequence('dbo.sysjobschedules','schedule_id'), 1, false)");
  if (out.baseline.serverdate) q(`update dbo.serverdate set lasttransdate='${out.baseline.serverdate.replace(/'/g, "''")}'`);
  q(`delete from dbo.audit_log where audit_id > ${out.baseline.auditMax}`);
  q(`select setval(pg_get_serial_sequence('dbo.audit_log','audit_id'), ${out.baseline.auditMax}, true)`);
  out.final = {
    sysjobs: Number(rows('select count(*) from dbo.sysjobs')[0][0]),
    sched: Number(rows('select count(*) from dbo.sysjobschedules')[0][0]),
    pref: rows("select name,prefvalue,coalesce(prefvalue2,'') from dbo.softwarepreferences where lower(name)='cashsaleautopostingtime'"),
    audit: Number(rows('select count(*) from dbo.audit_log')[0][0]),
    auditMax: Number(rows('select max(audit_id) from dbo.audit_log')[0][0]),
    serverdate: rows('select lasttransdate from dbo.serverdate')[0]?.[0] ?? null,
  };
  out.baselineOk = out.final.sysjobs === out.baseline.sysjobs && out.final.sched === out.baseline.sched
    && JSON.stringify(out.final.pref) === JSON.stringify(out.baseline.pref)
    && out.final.audit === out.baseline.audit && out.final.auditMax === out.baseline.auditMax
    && out.final.serverdate === out.baseline.serverdate;
  out.ok = !!out.enableOk && !!out.disableOk && out.baselineOk;
} catch (e) { out.fatal = String(e.stack || e).slice(0, 1800); }
finally {
  try {
    q(`delete from dbo.sysjobs where name like 'PARITY_JOB_%' or name=''`);
    const pb2 = out.baseline?.pref?.[0];
    if (pb2) q(`update dbo.softwarepreferences set prefvalue=${pb2[1] === null ? 'null' : `'${String(pb2[1]).replace(/'/g, "''")}'`}, prefvalue2=${pb2[2] === '' ? 'null' : `'${String(pb2[2]).replace(/'/g, "''")}'`} where lower(name)='cashsaleautopostingtime'`);
    if (out.baseline?.serverdate) q(`update dbo.serverdate set lasttransdate='${out.baseline.serverdate.replace(/'/g, "''")}'`);
    if (out.baseline?.auditMax) { q(`delete from dbo.audit_log where audit_id > ${out.baseline.auditMax}`); q(`select setval(pg_get_serial_sequence('dbo.audit_log','audit_id'), ${out.baseline.auditMax}, true)`); }
  } catch {}
  console.log(JSON.stringify(out, (k, v) => (typeof v === 'bigint' ? Number(v) : v), 1));
  await browser.close().catch(() => {});
}
