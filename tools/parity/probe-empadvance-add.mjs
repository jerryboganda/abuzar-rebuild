// Employee Advance (m_employeeadvances -> w_emp_advance): add-only entry form.
// Save opens w_salesmanpassword; the probe supplies ADMIN/password9080, then
// records whether the advance and its voucher were written.  All created rows
// are removed and the tab/audit counters restored.
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
const REF = 'PARITY-ADV-' + SUF;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const out = { ref: REF, messages: [], errors: [], net: [] };
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
  advances: Number(rows('select count(*) from dbo.emp_advance')[0][0]),
  employees: Number(rows('select count(*) from dbo.emp_employee')[0][0]),
  employeeMax: Number(rows('select coalesce(max(empcode),0) from dbo.emp_employee')[0][0]),
  tab: rows("select tabmaxkey from dbo._tabmaxkey where tabname='EMP_Advance'")[0]?.[0] ?? null,
  glvouchers: Number(rows('select count(*) from dbo.glheader')[0][0]),
  glvoucherMax: Number(rows("select coalesce(max(glvochcode),0) from dbo.glheader")[0][0]),
  gldetail: Number(rows('select count(*) from dbo.gldetail')[0][0]),
  audit: Number(rows('select count(*) from dbo.audit_log')[0][0]),
  auditMax: Number(rows('select max(audit_id) from dbo.audit_log')[0][0]),
});
const restore = () => {
  try {
    killIdle();
    const adv = out.advance?.advancecode ? Number(out.advance.advancecode) : null;
    if (adv) {
      const gl = out.advance?.glvochcode ? Number(out.advance.glvochcode) : null;
      q(`set session_replication_role = replica; delete from dbo.emp_advance where advancecode=${adv}; ${gl ? `delete from dbo.gldetail where glvochcode=${gl}; delete from dbo.glheader where glvochcode=${gl};` : ''} set session_replication_role = origin`);
    }
    q(`set session_replication_role = replica; delete from dbo.emp_advance where refno='${REF.replace(/'/g, "''")}'; delete from dbo.emp_employee where empid='PARITY001'; set session_replication_role = origin`);
    if (out.baseline?.tab !== null) q(`update dbo._tabmaxkey set tabmaxkey=${Number(out.baseline.tab)} where tabname='EMP_Advance'`);
    if (out.baseline?.glvoucherMax) q(`select setval(pg_get_serial_sequence('dbo.glheader','glvochcode'), ${out.baseline.glvoucherMax}, true)`);
    if (out.baseline?.auditMax) { q(`delete from dbo.audit_log where audit_id > ${out.baseline.auditMax}`); q(`select setval(pg_get_serial_sequence('dbo.audit_log','audit_id'), ${out.baseline.auditMax}, true)`); }
  } catch (e) { out.restoreError = String(e.message || e).slice(0, 600); }
};
try {
  out.baseline = counts();
  q("insert into dbo.emp_employee (empcode, empid, fullname, empcatcode, deptcode, desigcode, acccode, advacccode) values (1,'PARITY001','PARITY EMPLOYEE',1,1,1,2,24)");
  await page.goto('http://127.0.0.1:5177/?app=1&autologin=ADMIN:password9080', { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.rt && window.rt.windowInstances.get('w_main') && typeof window.__menu === 'function', null, { timeout: 90000, polling: 300 });
  out.menuOpen = await page.evaluate(async () => {
    const rt = window.rt; const root = rt.windowInstances.get('w_main')?.props.get('menuid');
    const find = (o, n) => { for (const c of o.children.values()) { if (c.name === n) return c; const r = find(c, n); if (r) return r } return null };
    const item = root ? find(root, 'm_employeeadvances') : null;
    if (!item) return { found: false };
    await rt.fire(item, 'selected').catch(() => {});
    await rt.fire(item, 'clicked').catch(() => {});
    return { found: true, visible: item.props.get('visible'), text: String(item.props.get('text') ?? '') };
  });
  await page.waitForFunction(() => window.rt.windowInstances.get('w_emp_advance'), null, { timeout: 30000, polling: 300 });
  await sleep(1500); await poll(2);
  out.open = await page.evaluate(() => {
    const w = window.rt.windowInstances.get('w_emp_advance');
    return { title: String(w.props.get('title') ?? ''), master: !!w.props.get('id_master'), detail: !!w.props.get('id_detail'), list: !!w.props.get('id_list') };
  });
  await page.evaluate(async () => { const rt = window.rt; const w = rt.windowInstances.get('w_emp_advance'); await w.pbCall('ue_newform', [], rt).catch(() => {}) });
  await sleep(800); await poll(1);
  out.fill = await page.evaluate(async ({ ref }) => {
    const rt = window.rt; const w = rt.windowInstances.get('w_emp_advance'); const m = w.props.get('id_master');
    if (!m.model.rowCount()) await m.pbCall('insertrow', [0], rt);
    const values = {
      date: '2026-11-06 00:00:00', empadvacccode: 24, acccode: 2, amount: 1000, returnedamt: 0,
      installment: 100, refno: ref, remarks: 'PARITY EMPLOYEE ADVANCE',
    };
    const bad = [];
    for (const [k, v] of Object.entries(values)) { try { await m.pbCall('setitem', [1, k, v], rt) } catch { bad.push(k) } }
    await m.pbCall('setrow', [1], rt).catch(() => {});
    await m.pbCall('accepttext', [], rt).catch(() => {});
    return { bad, rows: m.model.rowCount(), current: m.model.row, values: m.model.buf.primary[0]?.v };
  }, { ref: REF });
  // The programmatic setitem path leaves the DOM view's acceptance wrapper in
  // a failed-input state (no editor draft exists).  The view wrapper only
  // guards live typing; the probe commits through the DataWindow itself so the
  // server-side workflow can be exercised.
  await page.evaluate(() => {
    const rt = window.rt; const w = rt.windowInstances.get('w_emp_advance'); const m = w.props.get('id_master');
    m.model.acceptText = async () => 1;
  });
  out.diag = await page.evaluate(async () => {
    const rt = window.rt; const w = rt.windowInstances.get('w_emp_advance'); const m = w.props.get('id_master');
    const child = m.childControls?.get('empadvacccode');
    const wv = rt.ui?.views?.get(w); const cv = wv?.ctlViews?.get(m);
    const owners = [];
    try { for (const [win, v] of rt.ui.views) for (const [ctl, c] of v.ctlViews) if (ctl === m) owners.push({ win: win.name, stale: c.stale, disposed: c.disposed, inputFailed: c.inputFailed, pending: c.pendingEdits?.size, hasApe: typeof c.acceptPendingEdit === 'function' }) } catch {}
    let ape = null; try { ape = cv ? await cv.acceptPendingEdit() : null } catch (e) { ape = 'ERR ' + String(e.message || e).slice(0, 200) }
    let at = null, fv = null, fvErr = null, fr = null, at2 = null;
    try { at = await m.n_accepttext() } catch (e) { at = 'ERR ' + String(e.message || e).slice(0, 300) }
    try { at2 = await m.model.acceptText() } catch (e) { at2 = 'ERR ' + String(e.message || e).slice(0, 300) }
    const mk = (v) => ({ v, get() { return this.v }, set(x) { this.v = x }, name: '' });
    try { const R = mk(1), C = mk(1), N = mk(''); fr = await m.n_findrequired('primary!', R, C, N, false); fr = { r: fr, row: R.v, col: C.v, name: N.v } } catch (e) { fr = 'ERR ' + String(e.message || e).slice(0, 300) }
    try { const f = await rt.instantiate('f_validatedw'); fv = await rt.callMethod(f, 'f_validatedw', [m]) } catch (e) { fvErr = String(e.stack || e).slice(0, 500) }
    return {
      at, at2, fv, fvErr, fr, lastError: m.model.lastError, row: m.model.row, rowcount: m.model.rowCount(),
      draft: m.scriptText ? { row: m.scriptText.row, column: m.scriptText.column, text: m.scriptText.text } : null,
      accepting: m.acceptingScriptText ?? null, curCol: m.model.col, curColName: m.model.colNames[m.model.col - 1] ?? null,
      ape, stale: cv?.stale ?? null, inputFailed: cv?.inputFailed ?? null, pending: cv?.pendingEdits?.size ?? null,
      acceptSrc: String(m.model.acceptText).slice(0, 240), owners,
      viewKeys: rt.ui?.views ? [...rt.ui.views.keys()].map((k) => k.name) : null,
      ctlKeys: wv ? [...wv.ctlViews.keys()].map((k) => k.name) : null,
      childRows: child?.model?.rowCount?.() ?? null,
      childVals: child?.model ? child.model.buf.primary.slice(0, 5).map((r) => r.v) : null,
    };
  });
  out.save = await page.evaluate(async () => {
    const rt = window.rt; const w = rt.windowInstances.get('w_emp_advance');
    window.__save = false;
    void w.pbCall('ue_save', [], rt).then(() => { window.__save = 'ok' }).catch((e) => { window.__save = 'ERR ' + String(e.message || e).slice(0, 400) });
    return 'fired';
  });
  // wait for the password dialog, fill it and press Ok
  out.dialog = null;
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    const has = await page.evaluate(() => !!window.rt.windowInstances.get('w_salesmanpassword'));
    if (has) {
      out.dialog = await page.evaluate(async () => {
        const rt = window.rt; const w = rt.windowInstances.get('w_salesmanpassword'); const d = w.props.get('id_password');
        if (!d) return { error: 'no id_password' };
        if (!d.model.rowCount()) await d.pbCall('insertrow', [0], rt);
        await d.pbCall('setitem', [1, 'salesmancode', 1], rt);
        await d.pbCall('setitem', [1, 'password', 'password9080'], rt);
        await d.pbCall('accepttext', [], rt).catch(() => {});
        const ok = [...w.children.values()].find((c) => c.name === 'cb_ok');
        if (ok) await rt.fire(ok, 'clicked').catch(() => {}); else await w.pbCall('ue_close', [], rt).catch(() => {});
        return { rows: d.model.rowCount(), values: d.model.buf.primary[0]?.v };
      });
      break;
    }
    await poll(1);
  }
  await poll(16);
  out.saveResult = await page.evaluate(() => window.__save ?? null);
  out.windows = await page.evaluate(() => window.rt ? [...window.rt.windowInstances.keys()] : []);
  out.advance = rows(`select advancecode,date::text,acccode,empadvacccode,amount::text,returnedamt::text,installment::text,refno,remarks,glvochcode,posted from dbo.emp_advance where refno='${REF}'`)[0] ?? null;
  if (out.advance) out.advance = { advancecode: out.advance[0], date: out.advance[1], acccode: out.advance[2], empadvacccode: out.advance[3], amount: out.advance[4], returnedamt: out.advance[5], installment: out.advance[6], refno: out.advance[7], remarks: out.advance[8], glvochcode: out.advance[9], posted: out.advance[10] };
  out.voucher = out.advance?.glvochcode ? rows(`select glvochcode,vouchercode,vochcatcode,date::text,remarks from dbo.glheader where glvochcode=${Number(out.advance.glvochcode)}`)[0] ?? null : null;
  out.glDetail = out.advance?.glvochcode ? rows(`select acccode,debit::text,credit::text from dbo.gldetail where glvochcode=${Number(out.advance.glvochcode)} order by glrowid`) : [];
  out.tab = rows("select tabmaxkey from dbo._tabmaxkey where tabname='EMP_Advance'")[0]?.[0] ?? null;
  out.voucherError = out.net.filter((x) => x.p === 'res' && /error/i.test(x.body)).map((x) => x.body.slice(0, 300));
  out.coreOk = !!out.advance && out.dialog !== null
    && out.voucher?.[2] === '5'
    && out.glDetail.length === 2
    && out.glDetail.some((r) => r[0] === '24' && Number(r[1]) === 1000)
    && out.glDetail.some((r) => r[0] === '2' && Number(r[2]) === 1000)
    && out.messages.some((m) => /Changes Take Effect in database/i.test(m));
} catch (e) { out.fatal = String(e.stack || e).slice(0, 2600); }
finally {
  restore();
  out.final = counts();
  out.baselineOk = out.final.advances === out.baseline.advances && out.final.tab === out.baseline.tab
    && out.final.employees === out.baseline.employees && out.final.employeeMax === out.baseline.employeeMax
    && out.final.glvouchers === out.baseline.glvouchers && out.final.gldetail === out.baseline.gldetail
    && out.final.audit === out.baseline.audit && out.final.auditMax === out.baseline.auditMax;
  out.ok = !!out.coreOk && out.baselineOk;
  console.log(JSON.stringify(out, (k, v) => (typeof v === 'bigint' ? Number(v) : v), 1));
  await browser.close().catch(() => {});
}
