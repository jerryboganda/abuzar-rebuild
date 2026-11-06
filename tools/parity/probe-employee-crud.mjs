// Employee master (m_employeeprofile -> w_employee_list -> w_emp_form):
// add a full employee through the real modal form.  The form creates the
// salary Accounts row and the EMP_Employee row in one save; the probe then
// reopens the employee, edits name/mobile, and removes both rows exactly.
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
const EMPID = 'PARITY' + SUF;
const NAME = 'PARITY EMPLOYEE ' + SUF;
const NAME2 = NAME + ' EDIT';
const ACCNAME = 'PARITY EMPLOYEE AC ' + SUF;
const ALIAS = 'PE' + SUF;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const out = { empid: EMPID, name: NAME, name2: NAME2, accname: ACCNAME, alias: ALIAS, messages: [], errors: [], net: [] };
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
  employees: Number(rows('select count(*) from dbo.emp_employee')[0][0]),
  employeeMax: Number(rows('select coalesce(max(empcode),0) from dbo.emp_employee')[0][0]),
  accounts: Number(rows('select count(*) from dbo.accounts')[0][0]),
  accountsMax: Number(rows('select coalesce(max(acccode),0) from dbo.accounts')[0][0]),
  accountTab: rows("select tabmaxkey from dbo._tabmaxkey where tabname='Accounts'")[0]?.[0] ?? null,
  employeeTab: rows("select tabmaxkey from dbo._tabmaxkey where tabname='EMP_Employee'")[0]?.[0] ?? null,
  audit: Number(rows('select count(*) from dbo.audit_log')[0][0]),
  auditMax: Number(rows('select max(audit_id) from dbo.audit_log')[0][0]),
});
const restore = () => {
  try {
    killIdle();
    const code = out.code ? Number(out.code) : null;
    const acc = out.accountCode ? Number(out.accountCode) : null;
    q(`set session_replication_role = replica;
       delete from dbo.emp_empeducation where empcode=${code ?? 'null'};
       delete from dbo.emp_empcertification where empcode=${code ?? 'null'};
       delete from dbo.emp_empskill where empcode=${code ?? 'null'};
       delete from dbo.emp_pay where empcode=${code ?? 'null'};
       delete from dbo.emp_employee where empid='${EMPID.replace(/'/g, "''")}';
       ${acc ? `delete from dbo.accounts where acccode=${acc};` : ''}
       delete from dbo.accounts where name='${ACCNAME.replace(/'/g, "''")}';
       set session_replication_role = origin`);
    if (out.baseline?.accountTab !== null) q(`update dbo._tabmaxkey set tabmaxkey=${Number(out.baseline.accountTab)} where tabname='Accounts'`);
    if (out.baseline?.employeeTab !== null) q(`update dbo._tabmaxkey set tabmaxkey=${Number(out.baseline.employeeTab)} where tabname='EMP_Employee'`);
    if (out.baseline?.auditMax) { q(`delete from dbo.audit_log where audit_id > ${out.baseline.auditMax}`); q(`select setval(pg_get_serial_sequence('dbo.audit_log','audit_id'), ${out.baseline.auditMax}, true)`); }
  } catch (e) { out.restoreError = String(e.message || e).slice(0, 700); }
};
const clickSave = async () => page.evaluate(async () => {
  const rt = window.rt; const w = rt.windowInstances.get('w_emp_form');
  const find = (o, n) => { if (o.name === n) return o; for (const c of o.children.values()) { const r = find(c, n); if (r) return r } return null };
  const ok = find(w, 'cb_ok');
  if (!ok) return { error: 'cb_ok not found' };
  void rt.fire(ok, 'clicked').catch(() => {});
  return { fired: true };
});
try {
  out.baseline = counts();
  await page.goto('http://127.0.0.1:5177/?app=1&autologin=ADMIN:password9080', { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.rt && window.rt.windowInstances.get('w_main') && typeof window.__menu === 'function', null, { timeout: 90000, polling: 300 });
  out.menuOpen = await page.evaluate(async () => {
    const rt = window.rt; const root = rt.windowInstances.get('w_main')?.props.get('menuid');
    const find = (o, n) => { for (const c of o.children.values()) { if (c.name === n) return c; const r = find(c, n); if (r) return r } return null };
    const item = root ? find(root, 'm_employeeprofile') : null;
    if (!item) return { found: false };
    await rt.fire(item, 'selected').catch(() => {});
    await rt.fire(item, 'clicked').catch(() => {});
    return { found: true, visible: item.props.get('visible'), text: String(item.props.get('text') ?? '') };
  });
  await page.waitForFunction(() => window.rt.windowInstances.get('w_employee_list'), null, { timeout: 30000, polling: 300 });
  await sleep(1500); await poll(2);
  out.listOpen = await page.evaluate(() => {
    const w = window.rt.windowInstances.get('w_employee_list');
    return { title: String(w.props.get('title') ?? ''), listRows: w.props.get('id_list')?.model?.rowCount?.() ?? null };
  });
  await page.evaluate(async () => { const rt = window.rt; const w = rt.windowInstances.get('w_employee_list'); void w.pbCall('ue_new', [], rt).catch(() => {}) });
  await page.waitForFunction(() => window.rt.windowInstances.get('w_emp_form'), null, { timeout: 30000, polling: 300 });
  await sleep(1600); await poll(2);
  out.formOpen = await page.evaluate(() => {
    const w = window.rt.windowInstances.get('w_emp_form');
    const d = w.props.get('id_emp');
    return { title: String(w.props.get('title') ?? ''), rows: d?.model?.rowCount?.() ?? null, cols: d?.model?.colNames?.length ?? null };
  });
  out.fill = await page.evaluate(async ({ empid, name, accname, alias }) => {
    const rt = window.rt; const w = rt.windowInstances.get('w_emp_form'); const d = w.props.get('id_emp');
    if (!d.model.rowCount()) await d.pbCall('insertrow', [0], rt);
    const values = {
      emp_employee_empid: empid, emp_employee_fullname: name, emp_employee_gender: 'M', emp_employee_maritalstatus: 'S',
      emp_employee_date: '2026-11-06 00:00:00', emp_employee_birthdate: '1985-01-01 00:00:00', emp_employee_joindate: '2026-01-01 00:00:00',
      emp_employee_empcatcode: 1, emp_employee_deptcode: 1, emp_employee_desigcode: 1, emp_employee_active: 'Y',
      emp_employee_allowattendanceviaid: 'N', emp_employee_maxtimeinlimitinhrs: 12,
      emp_employee_nationality: 'PAKISTANI', emp_employee_domicile: 'PUNJAB', emp_employee_religion: 'ISLAM',
      emp_employee_mobileno: '03000000000', emp_employee_phoneno: '000000000', emp_employee_email: 'parity.employee@example.test',
      emp_employee_pmtaddress: 'PARITY ADDRESS', emp_employee_tmpaddress: 'PARITY ADDRESS',
      accounts_aliasname: alias, accounts_subcode: 24, accounts_name: accname, accounts_active: 'Y', accounts_restricted: 'N',
      accounts_alertcode: 1, openadvaccount: 'N',
    };
    const bad = [];
    for (const [k, v] of Object.entries(values)) { try { await d.pbCall('setitem', [1, k, v], rt) } catch { bad.push(k) } }
    await d.pbCall('setrow', [1], rt).catch(() => {});
    d.model.acceptText = async () => 1;
    for (const key of ['id_edu', 'id_cert', 'id_skill', 'id_jobexp', 'id_proj', 'id_ref', 'id_pay', 'id_payallowance', 'id_paydeduction']) {
      const x = w.props.get(key); if (x?.model) x.model.acceptText = async () => 1;
    }
    return { bad, rows: d.model.rowCount(), values: d.model.buf.primary[0]?.v };
  }, { empid: EMPID, name: NAME, accname: ACCNAME, alias: ALIAS });
  out.saveClick = await clickSave();
  await poll(18);
  // the form closes on commit; the list stays open
  out.formClosed = await page.evaluate(() => !window.rt.windowInstances.get('w_emp_form'));
  out.afterAdd = {
    employee: rows(`select empcode,empid,fullname,gender,empcatcode,deptcode,desigcode,acccode,active from dbo.emp_employee where empid='${EMPID}'`)[0] ?? null,
    account: rows(`select acccode,subcode,name,aliasname,active,restricted from dbo.accounts where name='${ACCNAME}'`)[0] ?? null,
    employeeTab: rows("select tabmaxkey from dbo._tabmaxkey where tabname='EMP_Employee'")[0]?.[0] ?? null,
    accountTab: rows("select tabmaxkey from dbo._tabmaxkey where tabname='Accounts'")[0]?.[0] ?? null,
  };
  out.code = out.afterAdd.employee?.[0] ?? null;
  out.accountCode = out.afterAdd.account?.[0] ?? null;
  out.addOk = !!out.code && out.afterAdd.employee?.[2] === NAME && out.afterAdd.employee?.[7] === out.accountCode
    && out.afterAdd.employeeTab === out.code && out.afterAdd.accountTab === out.accountCode;
  if (out.code) {
    // refresh the list first: wf_openmywindow only honors the code when the
    // list has a current row, otherwise it opens a blank form.
    await page.evaluate(async () => { const rt = window.rt; const w = rt.windowInstances.get('w_employee_list'); void w.pbCall('ue_list', [], rt).catch(() => {}) });
    for (let i = 0; i < 40; i++) { await sleep(500); const n = await page.evaluate(() => window.rt.windowInstances.get('w_employee_list')?.props.get('id_list')?.model?.rowCount?.() ?? 0); if (n > 0) { out.listRowsAfterAdd = n; break; } await poll(1); }
    // reopen the saved employee through the real list form
    await page.evaluate(async (code) => {
      const rt = window.rt; const w = rt.windowInstances.get('w_employee_list');
      const list = w.props.get('id_list');
      if (list?.model?.rowCount?.()) { await list.pbCall('setrow', [1], rt).catch(() => {}); w.props.set('il_selectedrow', 1) }
      const has = w.findRoutines('wf_openmywindow');
      if (has.length) { void w.pbCall('wf_openmywindow', [code], rt).catch(() => {}) }
      else {
        const { Ref } = await import('/src/runtime/interp.ts').catch(() => ({ Ref: null }));
        if (Ref) { let win = null; const ref = new Ref(() => win, (v) => { win = v }); ref.name = 'w_emp_form'; void rt.sys.get('openwithparm').fn(rt, [ref, code], undefined) }
      }
    }, Number(out.code));
    await page.waitForFunction(() => window.rt.windowInstances.get('w_emp_form'), null, { timeout: 30000, polling: 300 });
    await sleep(1500); await poll(2);
    out.reopen = await page.evaluate((code) => {
      const w = window.rt.windowInstances.get('w_emp_form'); const d = w.props.get('id_emp');
      return { rows: d?.model?.rowCount?.() ?? null, code: d?.model?.buf.primary[0]?.v?.[d.model.colIndex('code')] ?? null, name: d?.model?.getItem?.(1, 'emp_employee_fullname') ?? null };
    }, Number(out.code));
    out.edit = await page.evaluate(async ({ name2 }) => {
      const rt = window.rt; const w = rt.windowInstances.get('w_emp_form'); const d = w.props.get('id_emp');
      await d.pbCall('setitem', [1, 'emp_employee_fullname', name2], rt);
      await d.pbCall('setitem', [1, 'emp_employee_mobileno', '03111111111'], rt);
      await d.pbCall('setrow', [1], rt).catch(() => {});
      d.model.acceptText = async () => 1;
      return { values: d.model.buf.primary[0]?.v };
    }, { name2: NAME2 });
    out.saveClick2 = await page.evaluate(async () => {
      const rt = window.rt; const w = rt.windowInstances.get('w_emp_form');
      const find = (o, n) => { if (o.name === n) return o; for (const c of o.children.values()) { const r = find(c, n); if (r) return r } return null };
      const ok = find(w, 'cb_ok'); if (!ok) return { error: 'cb_ok not found' };
      void rt.fire(ok, 'clicked').catch(() => {});
      return { fired: true };
    });
    await poll(18);
    out.afterEdit = rows(`select empcode,fullname,mobileno from dbo.emp_employee where empid='${EMPID}'`)[0] ?? null;
    out.editOk = out.afterEdit?.[1] === NAME2 && out.afterEdit?.[2] === '03111111111';
  }
  restore();
  out.final = counts();
  out.final.residueEmployees = rows(`select count(*) from dbo.emp_employee where empid='${EMPID}'`)[0]?.[0] ?? null;
  out.final.residueAccounts = rows(`select count(*) from dbo.accounts where name='${ACCNAME}'`)[0]?.[0] ?? null;
  out.baselineOk = out.final.employees === out.baseline.employees && out.final.employeeMax === out.baseline.employeeMax
    && out.final.accounts === out.baseline.accounts && out.final.accountsMax === out.baseline.accountsMax
    && out.final.accountTab === out.baseline.accountTab && out.final.employeeTab === out.baseline.employeeTab
    && out.final.audit === out.baseline.audit && out.final.auditMax === out.baseline.auditMax
    && out.final.residueEmployees === '0' && out.final.residueAccounts === '0';
  out.ok = !!out.addOk && !!out.editOk && out.baselineOk;
} catch (e) { out.fatal = String(e.stack || e).slice(0, 3000); }
finally {
  restore();
  console.log(JSON.stringify(out, (k, v) => (typeof v === 'bigint' ? Number(v) : v), 1));
  await browser.close().catch(() => {});
}
