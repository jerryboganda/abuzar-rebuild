// Invoice-based voucher categories:
//   12 Cash Receipt against Sales (sale invoice 588882, balance 11.00)
//   15 Cash Payment against Purchase (purchase invoice 2, balance 803.00)
//   13/16 open with a temporary bank account (the clone has no subcode-4 account)
// The invoice balances, GL rows, temporary account and counters are restored.
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { appendFileSync, writeFileSync } from 'node:fs';
const require = createRequire(process.env.PLAYWRIGHT_MODULES || 'C:/Users/Admin/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/');
const { chromium } = require('playwright');
const PSQL = 'C:\\PostgreSQL\\17\\bin\\psql.exe';
const DB = process.env.PARITY_DB || 'trader_write_test';
const STEPS = 'C:/Projects/Abuzar/deploy/parity/voucher-invoice-steps.txt';
writeFileSync(STEPS, '');
const step = (s) => appendFileSync(STEPS, new Date().toISOString() + ' ' + s + '\n');
const q = (sql) => execFileSync(PSQL, ['-U', 'postgres', '-h', '127.0.0.1', '-d', DB, '-t', '-A', '-F', '|', '-c', sql], { env: { ...process.env, PGPASSWORD: 'postgres' }, encoding: 'utf8', windowsHide: true }).trim();
const rows = (sql) => q(sql).split(/\r?\n/).filter(Boolean).map((l) => l.split('|'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SUF = String(Date.now()).slice(-6);
const REM12 = 'PARITY INV CR ' + SUF;
const REM15 = 'PARITY INV CP ' + SUF;
const SALEINV = 588882;
const SALEINV2 = 588886;
const PURINV = 2;
const PURINV2 = 3;
const BANKCODE = 326;
const BANKNAME = 'PARITY BANK ' + SUF;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
page.setDefaultTimeout(20000);
const out = { rem12: REM12, rem15: REM15, saleinv: SALEINV, purinv: PURINV, bank: BANKCODE, messages: [], errors: [], net: [] };
page.on('pageerror', (e) => out.errors.push(String(e.message || e).slice(0, 500)));
page.on('request', (r) => { if (r.url().includes('/api/exec')) out.net.push({ p: 'req', body: String(r.postData() || '') }) });
page.on('response', async (r) => { if (r.url().includes('/api/exec')) { let b = ''; try { b = await r.text() } catch {} out.net.push({ p: 'res', status: r.status(), body: String(b).slice(0, 400) }) } });
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
  glheader: Number(rows('select count(*) from dbo.glheader')[0][0]),
  glheaderMax: Number(rows('select coalesce(max(glvochcode),0) from dbo.glheader')[0][0]),
  gldetail: Number(rows('select count(*) from dbo.gldetail')[0][0]),
  glTab: rows("select tabmaxkey from dbo._tabmaxkey where tabname='glheader'")[0]?.[0] ?? null,
  counters: rows("select vochcatcode,counter from dbo.vochercategory where vochcatcode in (12,13,15,16) order by vochcatcode"),
  saleBal: rows(`select outstandingamt::text from dbo.saleledger where saleinvcode=${SALEINV} and marked='N' and posted='Y' and accountfor='Y'`)[0]?.[0] ?? null,
  saleBal2: rows(`select outstandingamt::text from dbo.saleledger where saleinvcode=${SALEINV2} and marked='N' and posted='Y' and accountfor='Y'`)[0]?.[0] ?? null,
  purBal: rows(`select outstandingamt::text from dbo.purledger where purinvcode=${PURINV} and marked='N' and posted='Y' and accountfor='Y'`)[0]?.[0] ?? null,
  purBal2: rows(`select outstandingamt::text from dbo.purledger where purinvcode=${PURINV2} and marked='N' and posted='Y' and accountfor='Y'`)[0]?.[0] ?? null,
  accounts: Number(rows('select count(*) from dbo.accounts')[0][0]),
  accountsMax: Number(rows('select coalesce(max(acccode),0) from dbo.accounts')[0][0]),
  accountsTab: rows("select tabmaxkey from dbo._tabmaxkey where tabname='Accounts'")[0]?.[0] ?? null,
  serverDate: rows('select lasttransdate::text from dbo.serverdate')[0]?.[0] ?? null,
  audit: Number(rows('select count(*) from dbo.audit_log')[0][0]),
  auditMax: Number(rows('select max(audit_id) from dbo.audit_log')[0][0]),
});
const restore = () => {
  try {
    killIdle();
    // every GL row this probe writes is above the baseline maximum; this also
    // covers the 13/16 remarks created later in the run.
    const max = Number(out.baseline?.glheaderMax ?? 0);
    q(`set session_replication_role = replica; delete from dbo.gldetail where glvochcode > ${max}; delete from dbo.glheader where glvochcode > ${max}; delete from dbo.accounts where acccode=${BANKCODE}; set session_replication_role = origin`);
    if (out.baseline?.glTab !== null) q(`update dbo._tabmaxkey set tabmaxkey=${Number(out.baseline.glTab)} where tabname='glheader'`);
    for (const [cat, counter] of out.baseline.counters) q(`update dbo.vochercategory set counter=${Number(counter)} where vochcatcode=${Number(cat)}`);
    if (out.baseline?.saleBal !== null) q(`update dbo.saleledger set outstandingamt=${Number(out.baseline.saleBal)} where saleinvcode=${SALEINV} and marked='N' and posted='Y' and accountfor='Y'`);
    if (out.baseline?.saleBal2 !== null) q(`update dbo.saleledger set outstandingamt=${Number(out.baseline.saleBal2)} where saleinvcode=${SALEINV2} and marked='N' and posted='Y' and accountfor='Y'`);
    if (out.baseline?.purBal !== null) q(`update dbo.purledger set outstandingamt=${Number(out.baseline.purBal)} where purinvcode=${PURINV} and marked='N' and posted='Y' and accountfor='Y'`);
    if (out.baseline?.purBal2 !== null) q(`update dbo.purledger set outstandingamt=${Number(out.baseline.purBal2)} where purinvcode=${PURINV2} and marked='N' and posted='Y' and accountfor='Y'`);
    if (out.baseline?.accountsTab !== null) q(`update dbo._tabmaxkey set tabmaxkey=${Number(out.baseline.accountsTab)} where tabname='Accounts'`);
    if (out.baseline?.serverDate) q(`update dbo.serverdate set lasttransdate='${String(out.baseline.serverDate).replace(/'/g, "''")}'::timestamp`);
    if (out.baseline?.auditMax) { q(`delete from dbo.audit_log where audit_id > ${out.baseline.auditMax}`); q(`select setval(pg_get_serial_sequence('dbo.audit_log','audit_id'), ${out.baseline.auditMax}, true)`); }
  } catch (e) { out.restoreError = String(e.message || e).slice(0, 700); }
};
async function openCat(cat) {
  await page.evaluate(async (c) => {
    const rt = window.rt;
    const { Ref } = await import('/src/runtime/interp.js');
    let win = null; const ref = new Ref(() => win, (v) => { win = v }); ref.name = 'w_voucher';
    void rt.sys.get('opensheetwithparm').fn(rt, [ref, c, rt.windowInstances.get('w_main'), 0, 5], undefined).catch(() => {});
  }, cat);
}
async function closeForms() {
  await page.evaluate(async () => {
    const rt = window.rt;
    for (const [k, w] of [...rt.windowInstances.entries()].reverse()) {
      if (k === 'w_main') continue;
      try { await Promise.race([rt.closeWindow(w), new Promise((r) => setTimeout(r, 1500))]) } catch {}
    }
  }).catch(() => {});
  await sleep(600);
}
async function formState() {
  return await page.evaluate(() => {
    const w = window.rt.windowInstances.get('w_voucher');
    if (!w) return { open: false };
    const rows = (f) => { try { return w.props.get(f)?.model?.rowCount?.() ?? null } catch { return 'ERR' } };
    return { open: true, title: String(w.props.get('title') ?? ''), cat: w.props.get('ii_vouchertype'), headerRows: rows('idc_dddwheaderaccount'), detailRows: rows('idc_dddwdetailaccount'), treatment: w.props.get('is_detailtreatment') };
  });
}
async function saveVoucher(master, detailRows) {
  const fill = await page.evaluate(async ({ master, detailRows }) => {
    const rt = window.rt; const w = rt.windowInstances.get('w_voucher');
    const m = w.props.get('id_master'); const d = w.props.get('id_detail');
    if (!m || !d) return { error: 'missing master/detail' };
    if (!m.model.rowCount()) await m.pbCall('insertrow', [0], rt);
    const bad = [];
    for (const [k, v] of Object.entries(master)) { try { await m.pbCall('setitem', [1, k, v], rt) } catch { bad.push('m:' + k) } }
    let i = 0;
    for (const row of detailRows) {
      i++;
      if (d.model.rowCount() < i) await d.pbCall('insertrow', [0], rt);
      for (const [k, v] of Object.entries(row)) { try { await d.pbCall('setitem', [i, k, v], rt) } catch { bad.push('d' + i + ':' + k) } }
    }
    for (const x of [m, d]) if (x?.model) x.model.acceptText = async () => 1;
    await m.pbCall('accepttext', [], rt).catch(() => {});
    await d.pbCall('accepttext', [], rt).catch(() => {});
    return { bad, mrows: m.model.rowCount(), drows: d.model.rowCount(), m: m.model.buf.primary[0]?.v ?? null, d: [...d.model.buf.primary.entries()].map(([, v]) => v.v) };
  }, { master, detailRows });
  await page.evaluate(async () => {
    const rt = window.rt; const w = rt.windowInstances.get('w_voucher');
    window.__save = false;
    void w.pbCall('ue_save', [], rt).then(() => { window.__save = 'ok' }).catch((e) => { window.__save = 'ERR ' + String(e.message || e).slice(0, 500) });
  });
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
  await poll(20);
  return { fill, save: await page.evaluate(() => window.__save ?? null) };
}
try {
  out.baseline = counts();
  step('baseline ' + JSON.stringify(out.baseline));
  q(`insert into dbo.accounts (acccode,subcode,name,aliasname,openingdate,active,restricted,alertcode) values (${BANKCODE},4,'${BANKNAME}','PB${SUF}','2026-11-06 00:00:00','Y','N',1)`);
  step('bank fixture inserted');
  await page.goto('http://127.0.0.1:5177/?app=1&autologin=ADMIN:password9080', { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.rt && window.rt.windowInstances.get('w_main') && typeof window.__menu === 'function', null, { timeout: 90000, polling: 300 });
  step('logged in');
  // 13/16 open with the bank fixture
  for (const cat of [13, 16]) {
    await closeForms();
    await openCat(cat);
    await page.waitForFunction(() => window.rt.windowInstances.get('w_voucher'), null, { timeout: 30000, polling: 300 });
    await sleep(2200); await poll(2);
    out['bank' + cat] = await formState();
    step('bank cat ' + cat + ' ' + JSON.stringify(out['bank' + cat]));
  }
  // 12: cash receipt against sale invoice 588882
  await closeForms();
  await openCat(12);
  await page.waitForFunction(() => window.rt.windowInstances.get('w_voucher'), null, { timeout: 30000, polling: 300 });
  await sleep(2200); await poll(2);
  out.inv12Open = await formState();
  await page.evaluate(async () => { const rt = window.rt; const w = rt.windowInstances.get('w_voucher'); await w.pbCall('ue_newform', [], rt).catch(() => {}) });
  await sleep(900); await poll(1);
  out.inv12Save = await saveVoucher({ date: '2026-11-06 00:00:00', acccode: 2, currencycode: 1, conversionrate: 1, remarks: REM12 }, [
    { acccode: 22, invoicecode: SALEINV, credit: 11, debit: 0, outstandingamt: 11, foreignamt: 0, remarks: 'PARITY INV CR LINE' },
  ]);
  out.inv12Rows = rows(`select glvochcode,vochcatcode,acccode,vouchercode,posted,remarks from dbo.glheader where remarks='${REM12}'`);
  out.inv12Detail = out.inv12Rows[0] ? rows(`select acccode,debit::text,credit::text,invoicecode from dbo.gldetail where glvochcode=${Number(out.inv12Rows[0][0])} order by glrowid`) : [];
  out.inv12Bal = rows(`select outstandingamt::text from dbo.saleledger where saleinvcode=${SALEINV} and marked='N' and posted='Y' and accountfor='Y'`)[0]?.[0] ?? null;
  out.inv12Ok = out.inv12Rows.length === 1 && out.inv12Rows[0][1] === '12' && out.inv12Rows[0][4] === 'N'
    && out.inv12Detail.length === 2
    && out.inv12Detail.some((r) => r[0] === '22' && Number(r[2]) === 11 && r[3] === String(SALEINV))
    && out.inv12Detail.some((r) => r[0] === '2' && Number(r[1]) === 11)
    && Number(out.inv12Bal) === 0
    && out.messages.some((m) => /Changes take effect in database/i.test(m));
  step('inv12 ' + JSON.stringify({ open: out.inv12Open, rows: out.inv12Rows, detail: out.inv12Detail, bal: out.inv12Bal, ok: out.inv12Ok }));
  // 15: cash payment against purchase invoice 2
  await closeForms();
  await openCat(15);
  await page.waitForFunction(() => window.rt.windowInstances.get('w_voucher'), null, { timeout: 30000, polling: 300 });
  await sleep(2200); await poll(2);
  out.inv15Open = await formState();
  await page.evaluate(async () => { const rt = window.rt; const w = rt.windowInstances.get('w_voucher'); await w.pbCall('ue_newform', [], rt).catch(() => {}) });
  await sleep(900); await poll(1);
  out.inv15Save = await saveVoucher({ date: '2026-11-06 00:00:00', acccode: 2, currencycode: 1, conversionrate: 1, remarks: REM15 }, [
    { acccode: 115, invoicecode: PURINV, credit: 0, debit: 803, outstandingamt: 803, foreignamt: 0, remarks: 'PARITY INV CP LINE' },
  ]);
  out.inv15Rows = rows(`select glvochcode,vochcatcode,acccode,vouchercode,posted,remarks from dbo.glheader where remarks='${REM15}'`);
  out.inv15Detail = out.inv15Rows[0] ? rows(`select acccode,debit::text,credit::text,invoicecode from dbo.gldetail where glvochcode=${Number(out.inv15Rows[0][0])} order by glrowid`) : [];
  out.inv15Bal = rows(`select outstandingamt::text from dbo.purledger where purinvcode=${PURINV} and marked='N' and posted='Y' and accountfor='Y'`)[0]?.[0] ?? null;
  out.inv15Ok = out.inv15Rows.length === 1 && out.inv15Rows[0][1] === '15' && out.inv15Rows[0][4] === 'N'
    && out.inv15Detail.length === 2
    && out.inv15Detail.some((r) => r[0] === '115' && Number(r[1]) === 803 && r[3] === String(PURINV))
    && out.inv15Detail.some((r) => r[0] === '2' && Number(r[2]) === 803)
    && Number(out.inv15Bal) === 0
    && out.messages.some((m) => /Changes take effect in database/i.test(m));
  step('inv15 ' + JSON.stringify({ open: out.inv15Open, rows: out.inv15Rows, detail: out.inv15Detail, bal: out.inv15Bal, ok: out.inv15Ok }));
  // 13: bank receipt against sale invoice 588886
  await closeForms();
  await openCat(13);
  await page.waitForFunction(() => window.rt.windowInstances.get('w_voucher'), null, { timeout: 30000, polling: 300 });
  await sleep(2200); await poll(2);
  await page.evaluate(async () => { const rt = window.rt; const w = rt.windowInstances.get('w_voucher'); await w.pbCall('ue_newform', [], rt).catch(() => {}) });
  await sleep(900); await poll(1);
  const REM13 = 'PARITY INV BR ' + SUF;
  out.rem13 = REM13;
  out.inv13Save = await saveVoucher({ date: '2026-11-06 00:00:00', acccode: BANKCODE, currencycode: 1, conversionrate: 1, remarks: REM13 }, [
    { acccode: 22, invoicecode: SALEINV2, credit: 11, debit: 0, outstandingamt: 11, foreignamt: 0, remarks: 'PARITY INV BR LINE' },
  ]);
  out.inv13Rows = rows(`select glvochcode,vochcatcode,acccode,vouchercode,posted,remarks from dbo.glheader where remarks='${REM13}'`);
  out.inv13Detail = out.inv13Rows[0] ? rows(`select acccode,debit::text,credit::text,invoicecode from dbo.gldetail where glvochcode=${Number(out.inv13Rows[0][0])} order by glrowid`) : [];
  out.inv13Bal = rows(`select outstandingamt::text from dbo.saleledger where saleinvcode=${SALEINV2} and marked='N' and posted='Y' and accountfor='Y'`)[0]?.[0] ?? null;
  out.inv13Ok = out.inv13Rows.length === 1 && out.inv13Rows[0][1] === '13' && out.inv13Rows[0][2] === String(BANKCODE) && out.inv13Rows[0][4] === 'N'
    && out.inv13Detail.length === 2
    && out.inv13Detail.some((r) => r[0] === '22' && Number(r[2]) === 11 && r[3] === String(SALEINV2))
    && out.inv13Detail.some((r) => r[0] === String(BANKCODE) && Number(r[1]) === 11)
    && Number(out.inv13Bal) === 0
    && out.messages.some((m) => /Changes take effect in database/i.test(m));
  step('inv13 ' + JSON.stringify({ rows: out.inv13Rows, detail: out.inv13Detail, bal: out.inv13Bal, ok: out.inv13Ok }));
  // 16: bank payment against purchase invoice 3
  await closeForms();
  await openCat(16);
  await page.waitForFunction(() => window.rt.windowInstances.get('w_voucher'), null, { timeout: 30000, polling: 300 });
  await sleep(2200); await poll(2);
  await page.evaluate(async () => { const rt = window.rt; const w = rt.windowInstances.get('w_voucher'); await w.pbCall('ue_newform', [], rt).catch(() => {}) });
  await sleep(900); await poll(1);
  const REM16 = 'PARITY INV BP ' + SUF;
  out.rem16 = REM16;
  out.inv16Save = await saveVoucher({ date: '2026-11-06 00:00:00', acccode: BANKCODE, currencycode: 1, conversionrate: 1, remarks: REM16 }, [
    { acccode: 111, invoicecode: PURINV2, credit: 0, debit: 3289, outstandingamt: 3289, foreignamt: 0, remarks: 'PARITY INV BP LINE' },
  ]);
  out.inv16Rows = rows(`select glvochcode,vochcatcode,acccode,vouchercode,posted,remarks from dbo.glheader where remarks='${REM16}'`);
  out.inv16Detail = out.inv16Rows[0] ? rows(`select acccode,debit::text,credit::text,invoicecode from dbo.gldetail where glvochcode=${Number(out.inv16Rows[0][0])} order by glrowid`) : [];
  out.inv16Bal = rows(`select outstandingamt::text from dbo.purledger where purinvcode=${PURINV2} and marked='N' and posted='Y' and accountfor='Y'`)[0]?.[0] ?? null;
  out.inv16Ok = out.inv16Rows.length === 1 && out.inv16Rows[0][1] === '16' && out.inv16Rows[0][2] === String(BANKCODE) && out.inv16Rows[0][4] === 'N'
    && out.inv16Detail.length === 2
    && out.inv16Detail.some((r) => r[0] === '111' && Number(r[1]) === 3289 && r[3] === String(PURINV2))
    && out.inv16Detail.some((r) => r[0] === String(BANKCODE) && Number(r[2]) === 3289)
    && Number(out.inv16Bal) === 0
    && out.messages.some((m) => /Changes take effect in database/i.test(m));
  step('inv16 ' + JSON.stringify({ rows: out.inv16Rows, detail: out.inv16Detail, bal: out.inv16Bal, ok: out.inv16Ok }));
  await closeForms();
  restore();
  out.final = counts();
  out.final.residue = rows("select count(*) from dbo.glheader where remarks like 'PARITY INV %'")[0]?.[0] ?? null;
  out.baselineOk = out.final.glheader === out.baseline.glheader && out.final.glheaderMax === out.baseline.glheaderMax
    && out.final.gldetail === out.baseline.gldetail && out.final.glTab === out.baseline.glTab
    && JSON.stringify(out.final.counters) === JSON.stringify(out.baseline.counters)
    && out.final.saleBal === out.baseline.saleBal && out.final.saleBal2 === out.baseline.saleBal2
    && out.final.purBal === out.baseline.purBal && out.final.purBal2 === out.baseline.purBal2
    && out.final.accounts === out.baseline.accounts && out.final.accountsMax === out.baseline.accountsMax
    && out.final.accountsTab === out.baseline.accountsTab
    && out.final.serverDate === out.baseline.serverDate
    && out.final.audit === out.baseline.audit && out.final.auditMax === out.baseline.auditMax
    && out.final.residue === '0';
  out.ok = !!out.inv12Ok && !!out.inv15Ok && !!out.inv13Ok && !!out.inv16Ok && !!out.bank13?.headerRows && !!out.bank16?.headerRows && out.baselineOk;
  step('done ok=' + out.ok + ' baselineOk=' + out.baselineOk);
} catch (e) { out.fatal = String(e.stack || e).slice(0, 3000); step('FATAL ' + out.fatal); }
finally {
  restore();
  console.log(JSON.stringify(out, (k, v) => (typeof v === 'bigint' ? Number(v) : v), 1));
  await browser.close().catch(() => {});
}
