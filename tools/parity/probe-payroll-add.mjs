// Payroll (m_payroll -> w_payroll): add one employee payroll through the real
// form, including the salesman-password dialog.  Temporary employee fixture;
// no allowances/deductions rows.  Verifies the EMP_Payroll insert and
// netpayable calculation, then removes the fixture and restores counters.
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const require = createRequire(process.env.PLAYWRIGHT_MODULES || 'C:/Users/Admin/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/');
const { chromium } = require('playwright');
const PSQL = 'C:\\PostgreSQL\\17\\bin\\psql.exe';
const DB = process.env.PARITY_DB || 'trader_write_test';
const q = (sql) => execFileSync(PSQL, ['-U', 'postgres', '-h', '127.0.0.1', '-d', DB, '-t', '-A', '-F', '|', '-c', sql], { env: { ...process.env, PGPASSWORD: 'postgres' }, encoding: 'utf8', windowsHide: true }).trim();
const rows = (sql) => q(sql).split(/\r?\n/).filter(Boolean).map((l) => l.split('|'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const REMARK = 'PARITY PAYROLL ' + String(Date.now()).slice(-6);
const REMARK2 = REMARK + ' EDIT';
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
  allowances: Number(rows('select count(*) from dbo.emp_payrollallowances')[0][0]),
  deductions: Number(rows('select count(*) from dbo.emp_payrolldeductions')[0][0]),
  tab: rows("select tabmaxkey from dbo._tabmaxkey where tabname='Emp_Payroll'")[0]?.[0] ?? null,
  serverDate: rows('select lasttransdate::text from dbo.serverdate')[0]?.[0] ?? null,
  audit: Number(rows('select count(*) from dbo.audit_log')[0][0]),
  auditMax: Number(rows('select max(audit_id) from dbo.audit_log')[0][0]),
});
const restore = () => {
  try {
    killIdle();
    q(`set session_replication_role = replica;
       delete from dbo.emp_payrollallowances where payrollcode in (select payrollcode from dbo.emp_payroll where remarks='${REMARK}' or remarks='${REMARK} EDIT');
       delete from dbo.emp_payrolldeductions where payrollcode in (select payrollcode from dbo.emp_payroll where remarks='${REMARK}' or remarks='${REMARK} EDIT');
       delete from dbo.emp_payroll where remarks='${REMARK}' or remarks='${REMARK} EDIT';
       delete from dbo.emp_employee where empid='PARITY001';
       set session_replication_role = origin`);
    if (out.baseline?.tab !== null) q(`update dbo._tabmaxkey set tabmaxkey=${Number(out.baseline.tab)} where tabname='Emp_Payroll'`);
    if (out.baseline?.serverDate) q(`update dbo.serverdate set lasttransdate='${String(out.baseline.serverDate).replace(/'/g, "''")}'::timestamp`);
    if (out.baseline?.auditMax) { q(`delete from dbo.audit_log where audit_id > ${out.baseline.auditMax}`); q(`select setval(pg_get_serial_sequence('dbo.audit_log','audit_id'), ${out.baseline.auditMax}, true)`); }
  } catch (e) { out.restoreError = String(e.message || e).slice(0, 700); }
};
try {
  out.baseline = counts();
  q("insert into dbo.emp_employee (empcode, empid, fullname, empcatcode, deptcode, desigcode, acccode, advacccode) values (1,'PARITY001','PARITY EMPLOYEE',1,1,1,2,24)");
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
  await sleep(1800); await poll(2);
  out.open = await page.evaluate(() => {
    const w = window.rt.windowInstances.get('w_payroll');
    return { title: String(w.props.get('title') ?? ''), master: !!w.props.get('id_master'), detail: !!w.props.get('id_detail'), footer: !!w.props.get('id_footer'), footer2: !!w.props.get('id_footer2') };
  });
  await page.evaluate(async () => { const rt = window.rt; const w = rt.windowInstances.get('w_payroll'); await w.pbCall('ue_newform', [], rt).catch(() => {}) });
  await sleep(900); await poll(1);
  out.fill = await page.evaluate(async ({ remark }) => {
    const rt = window.rt; const w = rt.windowInstances.get('w_payroll'); const m = w.props.get('id_master');
    if (!m.model.rowCount()) await m.pbCall('insertrow', [0], rt);
    const values = {
      date: '2026-11-06 00:00:00', empcode: 1, paytype: 2, paid: 'N', paidvia: 2, paymentdate: '2026-11-06 00:00:00',
      fromdate: '2026-11-01 00:00:00', todate: '2026-11-30 00:00:00', workdays: 26, presents: 26, absents: 0,
      leaves: 0, sundays: 0, holidays: 0, hoursworked: 0, perhourrate: 100, basicpay: 2600,
      overtimehours: 0, overtimerate: 0, overtime: 0, bonuspay: 0, specialpay: 0, additionalpay: 0,
      otherpay: 0, fine: 0, penalty: 0, othercharge: 0, advance: 0, remarks: remark,
    };
    const bad = [];
    for (const [k, v] of Object.entries(values)) { try { await m.pbCall('setitem', [1, k, v], rt) } catch { bad.push(k) } }
    await m.pbCall('setrow', [1], rt).catch(() => {});
    // programmatic edits bypass the live editor; commit through the model
    m.model.acceptText = async () => 1;
    for (const name of ['id_detail', 'id_footer']) { const d = w.props.get(name); if (d?.model) d.model.acceptText = async () => 1 }
    await m.pbCall('accepttext', [], rt).catch(() => {});
    return { bad, rows: m.model.rowCount(), values: m.model.buf.primary[0]?.v };
  }, { remark: REMARK });
  out.save = await page.evaluate(async () => {
    const rt = window.rt; const w = rt.windowInstances.get('w_payroll');
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
        if (ok) await rt.fire(ok, 'clicked').catch(() => {}); else await w.pbCall('ue_close', [], rt).catch(() => {});
        return { rows: d.model.rowCount(), values: d.model.buf.primary[0]?.v };
      });
      break;
    }
    await poll(1);
  }
  await poll(18);
  out.saveResult = await page.evaluate(() => window.__save ?? null);
  out.afterAdd = {
    row: rows(`select payrollcode,date::text,usercode,empcode,workdays::text,presents::text,basicpay::text,netpayable::text,paid,remarks from dbo.emp_payroll where remarks='${REMARK}'`)[0] ?? null,
    allowances: rows(`select count(*) from dbo.emp_payrollallowances where payrollcode in (select payrollcode from dbo.emp_payroll where remarks='${REMARK}')`)[0]?.[0] ?? null,
    deductions: rows(`select count(*) from dbo.emp_payrolldeductions where payrollcode in (select payrollcode from dbo.emp_payroll where remarks='${REMARK}')`)[0]?.[0] ?? null,
    tab: rows("select tabmaxkey from dbo._tabmaxkey where tabname='Emp_Payroll'")[0]?.[0] ?? null,
  };
  out.code = out.afterAdd.row?.[0] ?? null;
  out.addOk = !!out.code && out.afterAdd.row?.[3] === '1' && Number(out.afterAdd.row?.[6]) === 2600
    && Number(out.afterAdd.row?.[7]) === 2600 && out.afterAdd.row?.[8] === 'N' && out.afterAdd.tab === out.code
    && out.messages.some((m) => /Changes take effect in database/i.test(m));
  if (out.code) {
    await page.evaluate(async () => { const rt = window.rt; const w = rt.windowInstances.get('w_payroll'); void w.pbCall('ue_list', [], rt).catch(() => {}) });
    for (let i = 0; i < 40; i++) { await sleep(500); const n = await page.evaluate(() => window.rt.windowInstances.get('w_payroll')?.props.get('id_list')?.model?.rowCount?.() ?? 0); if (n > 0) { out.listRows = n; break; } await poll(1); }
    out.pick = await page.evaluate(async (code) => {
      const rt = window.rt; const w = rt.windowInstances.get('w_payroll');
      const l = w.props.get('id_list'); const m = l.model; const ci = m.colIndex('code') >= 0 ? m.colIndex('code') : 0;
      const hit = [...m.buf.primary.entries()].find(([, r]) => Number(r.v[ci]) === Number(code));
      if (!hit) return { error: 'payroll not in list', rows: m.rowCount() };
      w.props.set('id_dwcontrol', l); w.props.set('il_selectedrow', hit[0] + 1);
      await w.pbCall('ue_detail', [], rt).catch(() => {});
      await new Promise((r) => setTimeout(r, 1200));
      const mm = w.props.get('id_master');
      return { row: hit[0] + 1, listRows: m.rowCount(), masterCode: Number(mm?.model?.buf.primary[0]?.v?.[mm.model.colIndex('code')] ?? 0) };
    }, Number(out.code));
    await poll(2);
    out.edit = await page.evaluate(async ({ remark2 }) => {
      const rt = window.rt; const w = rt.windowInstances.get('w_payroll'); const m = w.props.get('id_master');
      await m.pbCall('setitem', [1, 'basicpay', 2700], rt);
      await m.pbCall('setitem', [1, 'remarks', remark2], rt);
      await m.pbCall('setrow', [1], rt).catch(() => {});
      m.model.acceptText = async () => 1;
      window.__save2 = false;
      void w.pbCall('ue_save', [], rt).then(() => { window.__save2 = 'ok' }).catch((e) => { window.__save2 = 'ERR ' + String(e.message || e).slice(0, 400) });
      return { values: m.model.buf.primary[0]?.v };
    }, { remark2: REMARK2 });
    for (let i = 0; i < 40; i++) {
      await sleep(500);
      const has = await page.evaluate(() => !!window.rt.windowInstances.get('w_salesmanpassword'));
      if (has) {
        await page.evaluate(async () => {
          const rt = window.rt; const w = rt.windowInstances.get('w_salesmanpassword'); const d = w.props.get('id_password');
          if (!d.model.rowCount()) await d.pbCall('insertrow', [0], rt);
          await d.pbCall('setitem', [1, 'salesmancode', 1], rt);
          await d.pbCall('setitem', [1, 'password', 'password9080'], rt);
          d.model.acceptText = async () => 1;
          await d.pbCall('accepttext', [], rt).catch(() => {});
          const ok = [...w.children.values()].find((c) => c.name === 'cb_ok');
          if (ok) await rt.fire(ok, 'clicked').catch(() => {});
        });
        break;
      }
      await poll(1);
    }
    await poll(18);
    out.save2Result = await page.evaluate(() => window.__save2 ?? null);
    out.afterEdit = rows(`select payrollcode,basicpay::text,netpayable::text,remarks from dbo.emp_payroll where payrollcode=${Number(out.code)}`)[0] ?? null;
    out.editOk = Number(out.afterEdit?.[1]) === 2700 && Number(out.afterEdit?.[2]) === 2700 && out.afterEdit?.[3] === REMARK2;
  }
  restore();
  out.final = counts();
  out.final.residue = rows(`select count(*) from dbo.emp_payroll where remarks like 'PARITY PAYROLL %'`)[0]?.[0] ?? null;
  out.baselineOk = out.final.payrolls === out.baseline.payrolls && out.final.payrollMax === out.baseline.payrollMax
    && out.final.employees === out.baseline.employees && out.final.allowances === out.baseline.allowances
    && out.final.deductions === out.baseline.deductions && out.final.tab === out.baseline.tab
    && out.final.serverDate === out.baseline.serverDate
    && out.final.audit === out.baseline.audit && out.final.auditMax === out.baseline.auditMax
    && out.final.residue === '0';
  out.ok = !!out.addOk && !!out.editOk && out.baselineOk;
} catch (e) { out.fatal = String(e.stack || e).slice(0, 3000); }
finally {
  restore();
  console.log(JSON.stringify(out, (k, v) => (typeof v === 'bigint' ? Number(v) : v), 1));
  await browser.close().catch(() => {});
}
