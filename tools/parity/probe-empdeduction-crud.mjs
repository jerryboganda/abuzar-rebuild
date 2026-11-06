// Employee Pay Deductions (m_paydeductions -> w_emp_deduction): creates one
// Accounts row and then switches the DataWindow update table to EMP_Deduction
// for the deduction attributes.  Verifies add, edit and the File | Delete path,
// then removes both rows and restores the Accounts tab counter and audit log.
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
const NAME = 'PARITY DEDUCTION ' + SUF;
const NAME2 = NAME + ' EDIT';
const ALIAS = 'PD' + SUF;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const out = { name: NAME, name2: NAME2, alias: ALIAS, messages: [], errors: [], net: [] };
page.on('pageerror', (e) => out.errors.push(String(e.message || e).slice(0, 600)));
page.on('request', (r) => { if (r.url().includes('/api/exec')) out.net.push({ p: 'req', body: String(r.postData() || '') }) });
page.on('response', async (r) => { if (r.url().includes('/api/exec')) { let b = ''; try { b = await r.text() } catch {} out.net.push({ p: 'res', status: r.status(), body: String(b).slice(0, 400) }) } });
async function poll(seconds = 12, yes = false) {
  for (let i = 0; i < seconds * 2; i++) {
    await sleep(500);
    const msgs = await page.evaluate(() => [...document.querySelectorAll('.msgbox .txt')].map((e) => e.textContent.replace(/\s+/g, ' ').trim().slice(0, 300)));
    if (msgs.length) {
      out.messages.push(...msgs);
      await page.evaluate((y) => { for (const b of document.querySelectorAll('.msgbox')) { const bs = [...b.querySelectorAll('.btns button')]; (bs.find((x) => (y && /^yes$/i.test(x.textContent.trim())) || /^(ok|yes)$/i.test(x.textContent.trim())) || bs[0])?.click(); } }, yes);
      await sleep(250);
    }
  }
}
const killIdle = () => { try { q("select count(pg_terminate_backend(pid)) from pg_stat_activity where datname='" + DB + "' and xact_start is not null and pid<>pg_backend_pid()"); } catch {} };
const counts = () => ({
  accounts: Number(rows('select count(*) from dbo.accounts')[0][0]),
  accountsMax: Number(rows('select coalesce(max(acccode),0) from dbo.accounts')[0][0]),
  deductions: Number(rows('select count(*) from dbo.emp_deduction')[0][0]),
  tab: rows("select tabmaxkey from dbo._tabmaxkey where tabname='Accounts'")[0]?.[0] ?? null,
  audit: Number(rows('select count(*) from dbo.audit_log')[0][0]),
  auditMax: Number(rows('select max(audit_id) from dbo.audit_log')[0][0]),
});
const restore = () => {
  try {
    killIdle();
    const code = out.code ? Number(out.code) : null;
    if (code) {
      q(`set session_replication_role = replica; delete from dbo.emp_deduction where deductioncode=${code}; delete from dbo.accounts where acccode=${code}; set session_replication_role = origin`);
    }
    q(`delete from dbo.emp_deduction where deductioncode in (select acccode from dbo.accounts where name in ('${NAME.replace(/'/g, "''")}','${NAME2.replace(/'/g, "''")}'))`);
    q(`set session_replication_role = replica; delete from dbo.accounts where name in ('${NAME.replace(/'/g, "''")}','${NAME2.replace(/'/g, "''")}'); set session_replication_role = origin`);
    if (out.baseline?.tab !== null) q(`update dbo._tabmaxkey set tabmaxkey=${Number(out.baseline.tab)} where tabname='Accounts'`);
    if (out.baseline?.auditMax) { q(`delete from dbo.audit_log where audit_id > ${out.baseline.auditMax}`); q(`select setval(pg_get_serial_sequence('dbo.audit_log','audit_id'), ${out.baseline.auditMax}, true)`); }
  } catch (e) { out.restoreError = String(e.message || e).slice(0, 600); }
};
try {
  out.baseline = counts();
  await page.goto('http://127.0.0.1:5177/?app=1&autologin=ADMIN:password9080', { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.rt && window.rt.windowInstances.get('w_main') && typeof window.__menu === 'function', null, { timeout: 90000, polling: 300 });
  out.menuOpen = await page.evaluate(async () => {
    const rt = window.rt; const root = rt.windowInstances.get('w_main')?.props.get('menuid');
    const find = (o, n) => { for (const c of o.children.values()) { if (c.name === n) return c; const r = find(c, n); if (r) return r } return null };
    const item = root ? find(root, 'm_paydeductions') : null;
    if (!item) return { found: false };
    await rt.fire(item, 'selected').catch(() => {});
    await rt.fire(item, 'clicked').catch(() => {});
    return { found: true, visible: item.props.get('visible'), text: String(item.props.get('text') ?? '') };
  });
  await page.waitForFunction(() => window.rt.windowInstances.get('w_emp_deduction'), null, { timeout: 30000, polling: 300 });
  await sleep(1500); await poll(2);
  out.open = await page.evaluate(() => {
    const w = window.rt.windowInstances.get('w_emp_deduction');
    return { title: String(w.props.get('title') ?? ''), detail: !!w.props.get('id_detail'), list: !!w.props.get('id_list') };
  });
  await page.evaluate(async () => { const rt = window.rt; const w = rt.windowInstances.get('w_emp_deduction'); await w.pbCall('ue_newform', [], rt).catch(() => {}) });
  await sleep(900); await poll(1);
  out.fill = await page.evaluate(async ({ name, alias }) => {
    const rt = window.rt; const w = rt.windowInstances.get('w_emp_deduction'); const d = w.props.get('id_detail');
    if (!d.model.rowCount()) await d.pbCall('insertrow', [0], rt);
    const values = {
      name, aliasname: alias, subcode: 24, active: 'Y', restricted: 'N', alertcode: 1,
      openingdate: '2026-11-06 00:00:00', newbalancelimit: 100, balancelimitype: 'DR', remarks: 'PARITY DEDUCTION REMARKS',
      emp_deduction_description: 'PARITY PAY DEDUCTION', emp_deduction_percentage: 5, emp_deduction_flatamount: 10,
    };
    const bad = [];
    for (const [k, v] of Object.entries(values)) { try { await d.pbCall('setitem', [1, k, v], rt) } catch { bad.push(k) } }
    await d.pbCall('accepttext', [], rt).catch(() => {});
    return { bad, rows: d.model.rowCount(), values: d.model.buf.primary[0]?.v };
  }, { name: NAME, alias: ALIAS });
  out.save1 = await page.evaluate(async () => {
    const rt = window.rt; const w = rt.windowInstances.get('w_emp_deduction');
    window.__save1 = false;
    void w.pbCall('ue_save', [], rt).then(() => { window.__save1 = 'ok' }).catch((e) => { window.__save1 = 'ERR ' + String(e.message || e).slice(0, 400) });
    return 'fired';
  });
  await poll(14);
  out.afterAdd = {
    saveDone: await page.evaluate(() => window.__save1 ?? null),
    account: rows(`select acccode,subcode,name,aliasname,active,restricted,alertcode,balancelimit::text from dbo.accounts where name='${NAME}'`)[0] ?? null,
    deduction: rows(`select deductioncode,description,percentage::text,flatamount::text from dbo.emp_deduction where description='PARITY PAY DEDUCTION'`)[0] ?? null,
    tab: rows("select tabmaxkey from dbo._tabmaxkey where tabname='Accounts'")[0]?.[0] ?? null,
  };
  out.code = out.afterAdd.account?.[0] ?? null;
  out.addOk = !!out.code && out.afterAdd.account?.[2] === NAME && out.afterAdd.account?.[3] === ALIAS
    && out.afterAdd.deduction?.[0] === out.code && Number(out.afterAdd.deduction?.[2]) === 5 && Number(out.afterAdd.deduction?.[3]) === 10
    && out.afterAdd.tab === out.code && out.messages.some((m) => /Changes take effect in database/i.test(m));
  if (out.code) {
    out.edit = await page.evaluate(async () => {
      const rt = window.rt; const w = rt.windowInstances.get('w_emp_deduction'); const d = w.props.get('id_detail');
      await d.pbCall('setitem', [1, 'emp_deduction_description', 'PARITY PAY DEDUCTION EDIT'], rt);
      await d.pbCall('setitem', [1, 'emp_deduction_percentage', 7], rt);
      await d.pbCall('setitem', [1, 'remarks', 'PARITY DEDUCTION REMARKS EDIT'], rt);
      await d.pbCall('accepttext', [], rt).catch(() => {});
      window.__save2 = false;
      void w.pbCall('ue_save', [], rt).then(() => { window.__save2 = 'ok' }).catch((e) => { window.__save2 = 'ERR ' + String(e.message || e).slice(0, 400) });
      return { values: d.model.buf.primary[0]?.v };
    });
    await poll(14);
    out.afterEdit = {
      saveDone: await page.evaluate(() => window.__save2 ?? null),
      account: rows(`select acccode,name,remarks from dbo.accounts where acccode=${Number(out.code)}`)[0] ?? null,
      deduction: rows(`select deductioncode,description,percentage::text from dbo.emp_deduction where deductioncode=${Number(out.code)}`)[0] ?? null,
    };
    // The recovered ue_save restores Accounts as the update table and marks
    // remarks.Update=No after the first save, so the edit only persists the
    // EMP_Deduction attributes (and the Accounts columns that stay updateable).
    out.editOk = out.afterEdit.deduction?.[1] === 'PARITY PAY DEDUCTION EDIT' && Number(out.afterEdit.deduction?.[2]) === 7
      && out.afterEdit.account?.[2] === 'PARITY DEDUCTION REMARKS'
      && out.messages.filter((m) => /Changes take effect in database/i.test(m)).length >= 2;
    out.fileDelete = await page.evaluate(async () => {
      const rt = window.rt; const w = rt.windowInstances.get('w_emp_deduction');
      const has = typeof w.findRoutines === 'function' && w.findRoutines('ue_delete').length > 0;
      const menu = w.props.get('menuid') || w.props.get('im_menu');
      let hit = null; const walk = (o) => { for (const c of o.children.values()) { if (c.name === 'm_delete') hit = hit || c; walk(c) } }; if (menu) walk(menu);
      const enabled = hit ? hit.props.get('enabled') !== false : null;
      if (hit) void rt.fire(hit, 'clicked').catch(() => {});
      return { hasUeDelete: has, menuEnabled: enabled };
    });
    await sleep(900); await poll(4, true);
    out.afterDeleteAttempt = {
      account: rows(`select count(*) from dbo.accounts where acccode=${Number(out.code)}`)[0]?.[0] ?? null,
      deduction: rows(`select count(*) from dbo.emp_deduction where deductioncode=${Number(out.code)}`)[0]?.[0] ?? null,
    };
    // ue_save restores Accounts as the update table, so File | Delete issues
    // DELETE accounts and the EMP_Deduction FK blocks it: original behavior.
    out.deleteBlocked = out.fileDelete?.hasUeDelete === true && out.afterDeleteAttempt.account === '1'
      && out.afterDeleteAttempt.deduction === '1'
      && out.messages.some((m) => /You can not Delete this record Reason: Some information refering to this record exists/i.test(m));
  }
  restore();
  out.final = counts();
  out.final.residue = rows("select count(*) from dbo.accounts where name like 'PARITY DEDUCTION %'")[0]?.[0] ?? null;
  out.baselineOk = out.final.accounts === out.baseline.accounts && out.final.accountsMax === out.baseline.accountsMax
    && out.final.deductions === out.baseline.deductions && out.final.tab === out.baseline.tab
    && out.final.audit === out.baseline.audit && out.final.auditMax === out.baseline.auditMax
    && out.final.residue === '0';
  out.ok = !!out.addOk && !!out.editOk && !!out.deleteBlocked && out.baselineOk;
} catch (e) { out.fatal = String(e.stack || e).slice(0, 2600); }
finally {
  restore();
  console.log(JSON.stringify(out, (k, v) => (typeof v === 'bigint' ? Number(v) : v), 1));
  await browser.close().catch(() => {});
}
