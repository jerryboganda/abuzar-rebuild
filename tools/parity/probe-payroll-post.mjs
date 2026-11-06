// Payroll Post (m_post -> w_payroll.wf_post): password dialog, payroll range
// dialog, then sp_postpayroll.  A temporary employee + unposted payroll row is
// created by SQL; the probe verifies Posted/PostDate/PostedBy and removes it.
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const require = createRequire(process.env.PLAYWRIGHT_MODULES || 'C:/Users/Admin/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/');
const { chromium } = require('playwright');
const PSQL = 'C:\\PostgreSQL\\17\\bin\\psql.exe';
const DB = process.env.PARITY_DB || 'trader_write_test';
const q = (sql) => execFileSync(PSQL, ['-U', 'postgres', '-h', '127.0.0.1', '-d', DB, '-t', '-A', '-F', '|', '-c', sql], { env: { ...process.env, PGPASSWORD: 'postgres' }, encoding: 'utf8', windowsHide: true }).trim();
const rows = (sql) => q(sql).split(/\r?\n/).filter(Boolean).map((l) => l.split('|'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const REMARK = 'PARITY POST PAYROLL ' + String(Date.now()).slice(-6);
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
  payrolls: Number(rows('select count(*) from dbo.emp_payroll')[0][0]),
  payrollMax: Number(rows('select coalesce(max(payrollcode),0) from dbo.emp_payroll')[0][0]),
  employees: Number(rows('select count(*) from dbo.emp_employee')[0][0]),
  advances: Number(rows('select count(*) from dbo.emp_advance')[0][0]),
  glheaders: Number(rows('select count(*) from dbo.glheader')[0][0]),
  gldetails: Number(rows('select count(*) from dbo.gldetail')[0][0]),
  tab: rows("select tabmaxkey from dbo._tabmaxkey where tabname='Emp_Payroll'")[0]?.[0] ?? null,
  serverDate: rows('select lasttransdate::text from dbo.serverdate')[0]?.[0] ?? null,
  audit: Number(rows('select count(*) from dbo.audit_log')[0][0]),
  auditMax: Number(rows('select max(audit_id) from dbo.audit_log')[0][0]),
});
const restore = () => {
  try {
    killIdle();
    q(`set session_replication_role = replica;
       delete from dbo.emp_payroll where remarks='${REMARK}';
       delete from dbo.emp_employee where empid='PARITYPOST';
       set session_replication_role = origin`);
    if (out.baseline?.tab !== null) q(`update dbo._tabmaxkey set tabmaxkey=${Number(out.baseline.tab)} where tabname='Emp_Payroll'`);
    if (out.baseline?.serverDate) q(`update dbo.serverdate set lasttransdate='${String(out.baseline.serverDate).replace(/'/g, "''")}'::timestamp`);
    if (out.baseline?.auditMax) { q(`delete from dbo.audit_log where audit_id > ${out.baseline.auditMax}`); q(`select setval(pg_get_serial_sequence('dbo.audit_log','audit_id'), ${out.baseline.auditMax}, true)`); }
  } catch (e) { out.restoreError = String(e.message || e).slice(0, 700); }
};
try {
  out.baseline = counts();
  q("insert into dbo.emp_employee (empcode,empid,fullname,empcatcode,deptcode,desigcode,acccode,advacccode) values (1,'PARITYPOST','PARITY POST EMPLOYEE',1,1,1,2,24)");
  q(`insert into dbo.emp_payroll (payrollcode,date,posted,usercode,lastsaved,fromdate,todate,empcode,workdays,presents,absents,leaves,sundays,holidays,hoursworked,perhourrate,basicpay,overtimehours,overtimerate,overtime,bonuspay,specialpay,additionalpay,otherpay,fine,penalty,othercharge,advance,netpayable,remarks,paid,paidvia,paymentdate,paymentrefno) values (1,localtimestamp(3),'N',1,localtimestamp(3),'2026-11-01','2026-11-30',1,26,26,0,0,0,0,0,100,2600,0,0,0,0,0,0,0,0,0,0,0,2600,'${REMARK}','N',2,localtimestamp(3),'CASH')`);
  q("update dbo._tabmaxkey set tabmaxkey=1 where tabname='Emp_Payroll'");
  await page.goto('http://127.0.0.1:5177/?app=1&autologin=ADMIN:password9080', { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.rt && window.rt.windowInstances.get('w_main') && typeof window.__menu === 'function', null, { timeout: 90000, polling: 300 });
  out.menuOpen = await page.evaluate(async () => {
    const rt = window.rt; const root = rt.windowInstances.get('w_main')?.props.get('menuid');
    const find = (o, n) => { for (const c of o.children.values()) { if (c.name === n) return c; const r = find(c, n); if (r) return r } return null };
    const item = root ? find(root, 'm_payroll') : null;
    if (!item) return { found: false };
    await rt.fire(item, 'selected').catch(() => {});
    await rt.fire(item, 'clicked').catch(() => {});
    return { found: true, visible: item.props.get('visible'), text: String(item.props.get('text') ?? '') };
  });
  await page.waitForFunction(() => window.rt.windowInstances.get('w_payroll'), null, { timeout: 30000, polling: 300 });
  await sleep(1500); await poll(2);
  out.open = await page.evaluate(() => {
    const w = window.rt.windowInstances.get('w_payroll');
    return { title: String(w.props.get('title') ?? ''), master: !!w.props.get('id_master') };
  });
  out.postFire = await page.evaluate(async () => {
    const rt = window.rt; const w = rt.windowInstances.get('w_payroll');
    window.__post = false;
    void w.pbCall('wf_post', [], rt).then(() => { window.__post = 'ok' }).catch((e) => { window.__post = 'ERR ' + String(e.message || e).slice(0, 400) });
    return 'fired';
  });
  // password dialog
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
  // payroll range dialog
  out.range = null;
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    const has = await page.evaluate(() => !!window.rt.windowInstances.get('w_arg_sinvcode_linvcode'));
    if (has) {
      out.range = await page.evaluate(async () => {
        const rt = window.rt; const w = rt.windowInstances.get('w_arg_sinvcode_linvcode');
        const find = (o, n) => { if (o.name === n) return o; for (const c of o.children.values()) { const r = find(c, n); if (r) return r } return null };
        const d = find(w, 'dw_control');
        if (!d.model.rowCount()) await d.pbCall('insertrow', [0], rt);
        await d.pbCall('setitem', [1, 'sinvcode', 1], rt);
        await d.pbCall('setitem', [1, 'linvcode', 1], rt);
        d.model.acceptText = async () => 1;
        await d.pbCall('accepttext', [], rt).catch(() => {});
        const ok = find(w, 'cb_ok');
        if (ok) await rt.fire(ok, 'clicked').catch(() => {});
        return { rows: d.model.rowCount(), values: d.model.buf.primary[0]?.v };
      });
      break;
    }
    await poll(1);
  }
  await poll(20);
  out.postResult = await page.evaluate(() => window.__post ?? null);
  out.after = {
    row: rows(`select payrollcode,posted,postdate::text,postedby,remarks from dbo.emp_payroll where remarks='${REMARK}'`)[0] ?? null,
    glheaders: rows('select count(*) from dbo.glheader')[0]?.[0] ?? null,
    gldetails: rows('select count(*) from dbo.gldetail')[0]?.[0] ?? null,
  };
  out.postOk = out.after.row?.[1] === 'Y' && !!out.after.row?.[2] && out.after.row?.[3] === '1'
    && out.messages.some((m) => /Posting Successfully done/i.test(m));
  restore();
  out.final = counts();
  out.final.residue = rows(`select count(*) from dbo.emp_payroll where remarks='${REMARK}'`)[0]?.[0] ?? null;
  out.baselineOk = out.final.payrolls === out.baseline.payrolls && out.final.payrollMax === out.baseline.payrollMax
    && out.final.employees === out.baseline.employees && out.final.advances === out.baseline.advances
    && out.final.glheaders === out.baseline.glheaders && out.final.gldetails === out.baseline.gldetails
    && out.final.tab === out.baseline.tab && out.final.serverDate === out.baseline.serverDate
    && out.final.audit === out.baseline.audit && out.final.auditMax === out.baseline.auditMax
    && out.final.residue === '0';
  out.ok = !!out.postOk && out.baselineOk;
} catch (e) { out.fatal = String(e.stack || e).slice(0, 3000); }
finally {
  restore();
  console.log(JSON.stringify(out, (k, v) => (typeof v === 'bigint' ? Number(v) : v), 1));
  await browser.close().catch(() => {});
}
