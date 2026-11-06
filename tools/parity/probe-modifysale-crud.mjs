// Modify Sale Invoices: open final form, load invoice 588890 into the grid,
// edit remarks, save through the form + password dialog, verify PostgreSQL,
// then restore remarks/billingdate/modifiedby and audit/server-date exactly.
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
const require = createRequire(process.env.PLAYWRIGHT_MODULES || 'C:/Users/Admin/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/');
const { chromium } = require('playwright');
const PSQL = 'C:\\PostgreSQL\\17\\bin\\psql.exe';
const DB = process.env.PARITY_DB || 'trader_write_test';
const OUT = 'C:/Projects/Abuzar/deploy/parity/modifysale-crud';
mkdirSync(OUT, { recursive: true });
const q = (sql) => execFileSync(PSQL, ['-U', 'postgres', '-h', '127.0.0.1', '-d', DB, '-t', '-A', '-F', '|', '-c', sql], { env: { ...process.env, PGPASSWORD: 'postgres' }, encoding: 'utf8', windowsHide: true }).trim();
const rows = (sql) => q(sql).split(/\r?\n/).filter(Boolean).map((l) => l.split('|'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CODE = 588890;
const MARK = 'PARITY MODIFY SALE ' + String(Date.now()).slice(-6);
const counts = () => ({
  row: rows(`select saleinvcode,coalesce(remarks,''),billingdate::text,coalesce(modifiedby::text,'') from dbo.saleledger where saleinvcode=${CODE}`)[0] ?? null,
  audit: Number(rows('select count(*) from dbo.audit_log')[0][0]),
  auditMax: Number(rows('select max(audit_id) from dbo.audit_log')[0][0]),
  serverDate: rows('select lasttransdate::text from dbo.serverdate')[0]?.[0] ?? null,
});
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const out = { errors: [], messages: [] };
page.on('pageerror', (e) => out.errors.push(String(e.message || e).slice(0, 400)));
async function dismiss() {
  for (let i = 0; i < 12; i++) {
    const n = await page.evaluate(() => document.querySelectorAll('.msgbox').length);
    if (!n) break;
    const t = await page.evaluate(() => { const b = document.querySelector('.msgbox'); if (!b) return ''; const bs = [...b.querySelectorAll('.btns button')]; const pick = bs.find((x) => /^(ok|no|cancel|close)$/i.test(x.textContent.trim())) || bs[0]; const t = (b.querySelector('.txt')?.textContent || '').replace(/\s+/g, ' ').trim(); pick?.click(); return t });
    out.messages.push(t); await sleep(150);
  }
}
async function fillPassword() {
  for (let i = 0; i < 20; i++) {
    const r = await page.evaluate(async () => { const rt = window.rt; const a = rt.windowInstances.get('w_salesmanpassword'); if (!a) return false; const dw = a.children.get('dw_password') || a.props.get('dw_password'); if (!dw) return false; await dw.pbCall('setitem', [1, 'salesmancode', 1], rt); await dw.pbCall('setitem', [1, 'password', 'password9080'], rt); await dw.pbCall('accepttext', [], rt); const cb = a.children.get('cb_ok') || a.props.get('cb_ok'); if (cb) await rt.fire(cb, 'clicked'); return true }).catch(() => false);
    if (r) return; await sleep(400);
  }
}
try {
  out.mark = MARK;
  out.baseline = counts();
  await page.goto('http://127.0.0.1:5177/?app=1&autologin=ADMIN:password9080', { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.rt && window.rt.windowInstances.get('w_main') && typeof window.__menu === 'function', null, { timeout: 120000, polling: 300 });
  await page.evaluate(() => { void window.__menu('Maintenance | Modify Sale Invoices') });
  await page.waitForFunction(() => window.rt.windowInstances.get('w_selectformat_period_invrange'), null, { timeout: 30000, polling: 300 });
  await sleep(400);
  const selOk = page.locator('.pbwin[data-win="w_selectformat_period_invrange"] button').filter({ hasText: /Ok/i }).first();
  if (await selOk.count()) await selOk.click({ force: true });
  await page.waitForFunction(() => window.rt.windowInstances.get('w_arg_cust_sdate_ldate_withalloption2'), null, { timeout: 20000, polling: 300 });
  await sleep(500);
  await page.evaluate(async () => {
    const rt = window.rt; const w = rt.windowInstances.get('w_arg_cust_sdate_ldate_withalloption2');
    const all = w.children.get('cbx_allcustomers') || w.props.get('cbx_allcustomers'); if (all) all.pbSet('checked', true);
    const sd = w.children.get('em_startdate') || w.props.get('em_startdate'); if (sd) sd.pbSet('text', '01/01/2020 00:00:00');
    const ed = w.children.get('em_enddate') || w.props.get('em_enddate'); if (ed) ed.pbSet('text', '12/12/2030 23:59:59');
    const cb = w.children.get('cb_ok') || w.props.get('cb_ok'); if (cb) await rt.fire(cb, 'clicked').catch(() => {});
  });
  await sleep(700);
  out.argDates = await page.evaluate(() => {
    const w = window.rt.windowInstances.get('w_arg_cust_sdate_ldate_withalloption2');
    const a = w?.props.get('istr_arg');
    if (!a?.f) return null;
    const sd = a.f.get('d_sdate'); const ed = a.f.get('d_edate');
    return { sd: String(sd), sdType: sd?.constructor?.name, ed: String(ed), edType: ed?.constructor?.name, all: String(a.f.get('l_code1')), period: String(a.f.get('l_code5')) };
  });
  await page.evaluate(async () => { const rt = window.rt; const w = rt.windowInstances.get('w_arg_cust_sdate_ldate_withalloption2'); if (w) await w.pbCall('ue_close', [], rt).catch(() => {}); });
  await page.waitForFunction(() => window.rt.windowInstances.get('w_modify_saleinvces'), null, { timeout: 30000, polling: 300 });
  await sleep(1200);
  await dismiss();
  out.modelError = await page.evaluate(() => {
    const w = window.rt.windowInstances.get('w_modify_saleinvces');
    const d = w?.props.get('id_detail');
    const a = w?.props.get('istr_arg');
    const pick = (k) => { const v = a?.f?.get(k); return v && typeof v === 'object' ? v.constructor.name : String(v) };
    return { rows: d?.model?.rowCount?.() ?? null, lastError: d?.model?.lastError ?? '', transError: d?.model?.trans?.lastError ?? '', first: d?.model?.buf?.primary?.[0]?.v ?? null, arg: a?.f ? { l_code1: pick('l_code1'), l_code2: pick('l_code2'), l_code5: pick('l_code5'), d_sdate: pick('d_sdate'), d_edate: pick('d_edate'), l_code3: pick('l_code3'), l_code4: pick('l_code4') } : null };
  });
  out.before = rows(`select saleinvcode,remarks,custcode,invtotal from dbo.saleledger where saleinvcode=${CODE}`);
  out.loadList = await page.evaluate(async () => {
    const rt = window.rt; const w = rt.windowInstances.get('w_modify_saleinvces');
    try { const n = await w.pbCall('ue_newform', [], rt); return String(n) } catch (e) { return 'ERR ' + String(e.message || e).slice(0, 300) }
  });
  await page.waitForTimeout(3000);
  await dismiss();
  out.afterList = await page.evaluate(() => {
    const w = window.rt.windowInstances.get('w_modify_saleinvces'); const d = w?.props.get('id_detail');
    return { rows: d?.model?.rowCount?.() ?? null, first: d?.model?.buf?.primary?.[0]?.v ?? null, lastError: d?.model?.lastError ?? '' };
  });
  out.retry = await page.evaluate(async () => {
    const rt = window.rt; const w = rt.windowInstances.get('w_modify_saleinvces'); const d = w.props.get('id_detail'); const a = w.props.get('istr_arg');
    if (!d || !a?.f) return null;
    const args = [a.f.get('l_code1'), a.f.get('l_code2'), a.f.get('l_code5'), a.f.get('d_sdate'), a.f.get('d_edate'), a.f.get('l_code3'), a.f.get('l_code4')];
    const db = d.model.trans?.db; window.__q = [];
    if (db?.query) { const orig = db.query.bind(db); db.query = async (sql, params) => { const r = await orig(sql, params); window.__q.push({ sql, params, rows: r.rows?.length }); return r } }
    const n = await d.pbCall('retrieve', args, rt).catch((e) => 'ERR ' + String(e.message || e).slice(0, 300));
    return { n, rows: d.model.rowCount(), q: window.__q, lastError: d.model.lastError, transError: d.model.trans?.lastError };
  });
  out.load = await page.evaluate(async ({ code, mark }) => {
    const rt = window.rt; const w = rt.windowInstances.get('w_modify_saleinvces'); const d = w.props.get('id_detail');
    if (!d) return 'no id_detail';
    let row = 0;
    const total = d.model.rowCount();
    const hit = await d.pbCall('find', [`saleinvcode = ${code}`, 1, total], rt).catch(() => 0);
    if (hit > 0) row = hit;
    else {
      for (const [i, r] of d.model.buf.primary.entries()) if (Number(r.v[d.model.colIndex('saleinvcode')]) === code) { row = i + 1; break }
    }
    if (!row) return { error: 'invoice not found', rows: total, cols: d.model.colNames };
    const set = async (n, v) => { try { await d.pbCall('setitem', [row, n, v], rt) } catch (e) { return n + ':' + String(e.message || e).slice(0, 60) } };
    const bad = [];
    for (const [n, v] of Object.entries({ saleinvcode: code, custcode: 19, invtotal: 11, billingdate: '05/11/2026', remarks: mark })) { const b = await set(n, v); if (b) bad.push(b); }
    await d.pbCall('accepttext', [], rt).catch(() => {});
    await d.pbCall('setitemstatus', [row, 0, 'primary!', 'datamodified!'], rt).catch(() => {});
    return { rows: d.model.rowCount(), row, bad, first: d.model.buf.primary[row - 1]?.v, cols: d.model.colNames, status: String(d.model.buf.primary[row - 1]?.st ?? '') };
  }, { code: CODE, mark: MARK });
  out.save = await page.evaluate(() => {
    const rt = window.rt; const w = rt.windowInstances.get('w_modify_saleinvces');
    const d = w.props.get('id_detail');
    const db = d?.model?.trans?.db;
    window.__sqlLog = [];
    if (db?.exec) {
      const orig = db.exec.bind(db);
      db.exec = async (sql, params) => {
        try { const r = await orig(sql, params); window.__sqlLog.push({ sql, params, rowcount: r.rowcount }); return r }
        catch (e) { window.__sqlLog.push({ sql, params, error: String(e.message || e).slice(0, 500) }); throw e }
      };
    }
    void w.pbCall('ue_save', [], rt).catch(() => {});
    return 'fired';
  });
  await fillPassword(); await sleep(2500); await dismiss();
  out.sqlLog = await page.evaluate(() => window.__sqlLog || []).catch(() => []);
  out.after = rows(`select saleinvcode,remarks,billingdate::text from dbo.saleledger where saleinvcode=${CODE}`);
  out.fieldOk = out.after?.[0]?.[1] === MARK;
  out.sqlOk = (out.sqlLog || []).some((x) => /UPDATE dbo\.saleledger/i.test(String(x.sql)) && Number(x.rowcount) === 1);
  out.ok = !!out.fieldOk && !!out.sqlOk && out.errors.length === 0;
} catch (e) { out.fatal = String(e.stack || e).slice(0, 1800); }
finally {
  try {
    const b = out.baseline;
    if (b?.row) {
      const remarks = b.row[1] === '' ? "''" : `'${String(b.row[1]).replace(/'/g, "''")}'`;
      const billing = b.row[2] && b.row[2] !== 'null' ? `'${String(b.row[2]).replace(/'/g, "''")}'` : 'NULL';
      const modified = b.row[3] === '' || b.row[3] === 'null' ? 'NULL' : Number(b.row[3]);
      q(`update dbo.saleledger set remarks=${remarks}, billingdate=${billing}, modifiedby=${modified} where saleinvcode=${CODE}`);
    }
    if (b?.serverDate) q(`update dbo.serverdate set lasttransdate='${String(b.serverDate).replace(/'/g, "''")}'::timestamp`);
    if (b?.auditMax) { q(`delete from dbo.audit_log where audit_id > ${Number(b.auditMax)}`); q(`select setval(pg_get_serial_sequence('dbo.audit_log','audit_id'), ${Number(b.auditMax)}, true)`) }
    out.final = counts();
    out.baselineOk = !!b && JSON.stringify(out.final) === JSON.stringify(b);
    out.ok = !!out.ok && out.baselineOk;
  } catch (e) { out.restoreError = String(e.message || e).slice(0, 800); }
  writeFileSync(`${OUT}/modifysale-crud.json`, JSON.stringify(out, (k, v) => (typeof v === 'bigint' ? Number(v) : v), 1));
  console.log(JSON.stringify(out, (k, v) => (typeof v === 'bigint' ? Number(v) : v), 1));
  await browser.close().catch(() => {});
}
