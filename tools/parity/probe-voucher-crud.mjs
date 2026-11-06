// Voucher CRUD through the real recovered forms, opened with the numeric
// category parm (the original menu's struct parm does not reach
// w_voucher.ue_postopen's message.doubleparm in this build; the numeric open is
// the same path the form itself supports).  Categories:
//   1 Cash Payment, 2 Cash Receipt (w_voucher -> glheader/gldetail)
//   5 Journal Voucher (w_journalvoucher -> glheader/gldetail)
// Temporary bank accounts are not needed for these three; 13/16 are recorded
// separately because the clone has no subcode-4 account.
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { appendFileSync, writeFileSync } from 'node:fs';
const require = createRequire(process.env.PLAYWRIGHT_MODULES || 'C:/Users/Admin/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/');
const { chromium } = require('playwright');
const PSQL = 'C:\\PostgreSQL\\17\\bin\\psql.exe';
const DB = process.env.PARITY_DB || 'trader_write_test';
const STEPS = 'C:/Projects/Abuzar/deploy/parity/voucher-crud-steps.txt';
writeFileSync(STEPS, '');
const step = (s) => appendFileSync(STEPS, new Date().toISOString() + ' ' + s + '\n');
const q = (sql) => execFileSync(PSQL, ['-U', 'postgres', '-h', '127.0.0.1', '-d', DB, '-t', '-A', '-F', '|', '-c', sql], { env: { ...process.env, PGPASSWORD: 'postgres' }, encoding: 'utf8', windowsHide: true }).trim();
const rows = (sql) => q(sql).split(/\r?\n/).filter(Boolean).map((l) => l.split('|'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SUF = String(Date.now()).slice(-6);
const REM1 = 'PARITY CASH PAYMENT ' + SUF;
const REM2 = 'PARITY CASH RECEIPT ' + SUF;
const REM5 = 'PARITY JOURNAL ' + SUF;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
page.setDefaultTimeout(20000);
const out = { refs: { REM1, REM2, REM5 }, messages: [], errors: [], net: [] };
page.on('pageerror', (e) => out.errors.push(String(e.message || e).slice(0, 500)));
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
const counters = () => rows("select vochcatcode,counter from dbo.vochercategory where vochcatcode in (1,2,5) order by vochcatcode");
const counts = () => ({
  glheader: Number(rows('select count(*) from dbo.glheader')[0][0]),
  glheaderMax: Number(rows('select coalesce(max(glvochcode),0) from dbo.glheader')[0][0]),
  gldetail: Number(rows('select count(*) from dbo.gldetail')[0][0]),
  glTab: rows("select tabmaxkey from dbo._tabmaxkey where tabname='glheader'")[0]?.[0] ?? null,
  counters: counters(),
  serverDate: rows('select lasttransdate::text from dbo.serverdate')[0]?.[0] ?? null,
  audit: Number(rows('select count(*) from dbo.audit_log')[0][0]),
  auditMax: Number(rows('select max(audit_id) from dbo.audit_log')[0][0]),
});
const restore = () => {
  try {
    killIdle();
    q("set session_replication_role = replica; delete from dbo.gldetail where glvochcode in (select glvochcode from dbo.glheader where remarks in ('" + REM1.replace(/'/g, "''") + "','" + REM2.replace(/'/g, "''") + "','" + REM5.replace(/'/g, "''") + "')); delete from dbo.glheader where remarks in ('" + REM1.replace(/'/g, "''") + "','" + REM2.replace(/'/g, "''") + "','" + REM5.replace(/'/g, "''") + "'); set session_replication_role = origin");
    if (out.baseline?.glTab !== null) q(`update dbo._tabmaxkey set tabmaxkey=${Number(out.baseline.glTab)} where tabname='glheader'`);
    for (const [cat, counter] of out.baseline.counters) q(`update dbo.vochercategory set counter=${Number(counter)} where vochcatcode=${Number(cat)}`);
    if (out.baseline?.serverDate) q(`update dbo.serverdate set lasttransdate='${String(out.baseline.serverDate).replace(/'/g, "''")}'::timestamp`);
    if (out.baseline?.auditMax) { q(`delete from dbo.audit_log where audit_id > ${out.baseline.auditMax}`); q(`select setval(pg_get_serial_sequence('dbo.audit_log','audit_id'), ${out.baseline.auditMax}, true)`); }
  } catch (e) { out.restoreError = String(e.message || e).slice(0, 700); }
};
async function openCat(cat) {
  return await page.evaluate(async (c) => {
    const rt = window.rt;
    const { Ref } = await import('/src/runtime/interp.js');
    const winName = (c === 5 || c === 14 || c === 17) ? 'w_journalvoucher' : 'w_voucher';
    let win = null; const ref = new Ref(() => win, (v) => { win = v }); ref.name = winName;
    void rt.sys.get('opensheetwithparm').fn(rt, [ref, c, rt.windowInstances.get('w_main'), 0, 5], undefined).catch(() => {});
    return { fired: true, winName };
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
async function fillAndSave(cat, windowName, master, detailRows) {
  const fill = await page.evaluate(async ({ master, detailRows }) => {
    const rt = window.rt; const w = rt.windowInstances.get('w_voucher') || rt.windowInstances.get('w_journalvoucher');
    const m = w.props.get('id_master'); const d = w.props.get('id_detail');
    if (!m || !d) return { error: 'missing master/detail', fields: [...w.props.keys()].filter((k) => /^id_/.test(k)) };
    if (!m.model.rowCount()) await m.pbCall('insertrow', [0], rt);
    if (!d.model.rowCount()) await d.pbCall('insertrow', [0], rt);
    const bad = [];
    for (const [k, v] of Object.entries(master)) { try { await m.pbCall('setitem', [1, k, v], rt) } catch { bad.push('m:' + k) } }
    let i = 0;
    for (const row of detailRows) {
      i++;
      if (d.model.rowCount() < i) await d.pbCall('insertrow', [0], rt);
      for (const [k, v] of Object.entries(row)) { try { await d.pbCall('setitem', [i, k, v], rt) } catch { bad.push('d' + i + ':' + k) } }
    }
    const setac = (x) => { if (x?.model) x.model.acceptText = async () => 1 };
    setac(m); setac(d);
    await m.pbCall('accepttext', [], rt).catch(() => {});
    await d.pbCall('accepttext', [], rt).catch(() => {});
    return { bad, masterRows: m.model.rowCount(), detailRows: d.model.rowCount(), m: m.model.buf.primary[0]?.v ?? null, d: [...d.model.buf.primary.entries()].map(([r, v]) => v.v) };
  }, { master, detailRows });
  const fire = await page.evaluate(async () => {
    const rt = window.rt; const w = rt.windowInstances.get('w_voucher') || rt.windowInstances.get('w_journalvoucher');
    window.__save = false;
    void w.pbCall('ue_save', [], rt).then(() => { window.__save = 'ok' }).catch((e) => { window.__save = 'ERR ' + String(e.message || e).slice(0, 400) });
    return 'fired';
  });
  // password dialog (transuserwindow=Y)
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
  return { fill, save: await page.evaluate(() => window.__save ?? null) };
}
try {
  out.baseline = counts();
  step('baseline ' + JSON.stringify(out.baseline));
  await page.goto('http://127.0.0.1:5177/?app=1&autologin=ADMIN:password9080', { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.rt && window.rt.windowInstances.get('w_main') && typeof window.__menu === 'function', null, { timeout: 90000, polling: 300 });
  step('logged in');
  // ---------------------------------------------------------------- cash payment (1)
  await closeForms();
  await openCat(1);
  await page.waitForFunction(() => window.rt.windowInstances.get('w_voucher'), null, { timeout: 30000, polling: 300 });
  await sleep(1500); await poll(2);
  out.cpOpen = await page.evaluate(() => {
    const w = window.rt.windowInstances.get('w_voucher');
    const rows = (f) => { try { return w.props.get(f)?.model?.rowCount?.() ?? null } catch { return 'ERR' } };
    return { title: String(w.props.get('title') ?? ''), cat: w.props.get('ii_vouchertype'), headerRows: rows('idc_dddwheaderaccount'), detailRows: rows('idc_dddwdetailaccount'), treatment: w.props.get('is_detailtreatment') };
  });
  await page.evaluate(async () => { const rt = window.rt; const w = rt.windowInstances.get('w_voucher'); await w.pbCall('ue_newform', [], rt).catch(() => {}) });
  await sleep(900); await poll(1);
  out.cpSave = await fillAndSave(1, 'w_voucher', { date: '2026-11-06 00:00:00', acccode: 2, currencycode: 1, conversionrate: 1, remarks: REM1 }, [{ acccode: 101, debit: 100, credit: 0, foreignamt: 0, remarks: 'PARITY CP LINE' }]);
  out.cpRows = rows(`select glvochcode,vochcatcode,acccode,vouchercode,posted,remarks from dbo.glheader where remarks='${REM1}'`);
  out.cpDetail = out.cpRows[0] ? rows(`select acccode,debit::text,credit::text from dbo.gldetail where glvochcode=${Number(out.cpRows[0][0])} order by glrowid`) : [];
  out.cpOk = out.cpRows.length === 1 && out.cpRows[0][1] === '1' && out.cpRows[0][2] === '2' && out.cpRows[0][4] === 'N'
    && out.cpDetail.length === 2
    && out.cpDetail.some((r) => r[0] === '101' && Number(r[1]) === 100 && Number(r[2]) === 0)
    && out.cpDetail.some((r) => r[0] === '2' && Number(r[1]) === 0 && Number(r[2]) === 100)
    && out.messages.some((m) => /Changes take effect in database/i.test(m));
  step('cash payment ' + JSON.stringify({ open: out.cpOpen, rows: out.cpRows, detail: out.cpDetail, ok: out.cpOk, msgs: out.messages.slice(-3) }));
  // ---------------------------------------------------------------- cash receipt (2)
  await closeForms();
  await openCat(2);
  await page.waitForFunction(() => window.rt.windowInstances.get('w_voucher'), null, { timeout: 30000, polling: 300 });
  await sleep(1500); await poll(2);
  out.crOpen = await page.evaluate(() => {
    const w = window.rt.windowInstances.get('w_voucher');
    const rows = (f) => { try { return w.props.get(f)?.model?.rowCount?.() ?? null } catch { return 'ERR' } };
    return { title: String(w.props.get('title') ?? ''), cat: w.props.get('ii_vouchertype'), headerRows: rows('idc_dddwheaderaccount'), detailRows: rows('idc_dddwdetailaccount'), treatment: w.props.get('is_detailtreatment') };
  });
  await page.evaluate(async () => { const rt = window.rt; const w = rt.windowInstances.get('w_voucher'); await w.pbCall('ue_newform', [], rt).catch(() => {}) });
  await sleep(900); await poll(1);
  out.crSave = await fillAndSave(2, 'w_voucher', { date: '2026-11-06 00:00:00', acccode: 2, currencycode: 1, conversionrate: 1, remarks: REM2 }, [{ acccode: 22, debit: 0, credit: 50, foreignamt: 0, remarks: 'PARITY CR LINE' }]);
  out.crRows = rows(`select glvochcode,vochcatcode,acccode,vouchercode,posted,remarks from dbo.glheader where remarks='${REM2}'`);
  out.crDetail = out.crRows[0] ? rows(`select acccode,debit::text,credit::text from dbo.gldetail where glvochcode=${Number(out.crRows[0][0])} order by glrowid`) : [];
  out.crOk = out.crRows.length === 1 && out.crRows[0][1] === '2' && out.crRows[0][2] === '2' && out.crRows[0][4] === 'N'
    && out.crDetail.length === 2
    && out.crDetail.some((r) => r[0] === '22' && Number(r[1]) === 0 && Number(r[2]) === 50)
    && out.crDetail.some((r) => r[0] === '2' && Number(r[1]) === 50 && Number(r[2]) === 0)
    && out.messages.some((m) => /Changes take effect in database/i.test(m));
  step('cash receipt ' + JSON.stringify({ open: out.crOpen, rows: out.crRows, detail: out.crDetail, ok: out.crOk }));
  // ---------------------------------------------------------------- journal voucher (5)
  await closeForms();
  await openCat(5);
  await page.waitForFunction(() => window.rt.windowInstances.get('w_journalvoucher'), null, { timeout: 30000, polling: 300 });
  await sleep(1500); await poll(2);
  out.jvOpen = await page.evaluate(() => {
    const w = window.rt.windowInstances.get('w_journalvoucher');
    const rows = (f) => { try { return w.props.get(f)?.model?.rowCount?.() ?? null } catch { return 'ERR' } };
    return { title: String(w.props.get('title') ?? ''), cat: w.props.get('ii_vouchertype'), masterRows: rows('id_master'), detailRows: rows('id_detail') };
  });
  await page.evaluate(async () => { const rt = window.rt; const w = rt.windowInstances.get('w_journalvoucher'); await w.pbCall('ue_newform', [], rt).catch(() => {}) });
  await sleep(900); await poll(1);
  out.jvSave = await fillAndSave(5, 'w_journalvoucher', { date: '2026-11-06 00:00:00', remarks: REM5 }, [
    { acccode: 24, debit: 25, credit: 0, remarks: 'PARITY JV DEBIT' },
    { acccode: 2, debit: 0, credit: 25, remarks: 'PARITY JV CREDIT' },
  ]);
  out.jvRows = rows(`select glvochcode,vochcatcode,acccode,vouchercode,posted,remarks from dbo.glheader where remarks='${REM5}'`);
  out.jvDetail = out.jvRows[0] ? rows(`select acccode,debit::text,credit::text from dbo.gldetail where glvochcode=${Number(out.jvRows[0][0])} order by glrowid`) : [];
  out.jvOk = out.jvRows.length === 1 && out.jvRows[0][1] === '5' && out.jvRows[0][4] === 'N'
    && out.jvDetail.length === 2
    && out.jvDetail.some((r) => r[0] === '24' && Number(r[1]) === 25 && Number(r[2]) === 0)
    && out.jvDetail.some((r) => r[0] === '2' && Number(r[1]) === 0 && Number(r[2]) === 25)
    && out.messages.some((m) => /Changes take effect in database/i.test(m));
  step('journal ' + JSON.stringify({ open: out.jvOpen, rows: out.jvRows, detail: out.jvDetail, ok: out.jvOk }));
  await closeForms();
  restore();
  out.final = counts();
  out.final.residue = rows("select count(*) from dbo.glheader where remarks like 'PARITY CASH %' or remarks like 'PARITY JOURNAL %'")[0]?.[0] ?? null;
  out.baselineOk = out.final.glheader === out.baseline.glheader && out.final.glheaderMax === out.baseline.glheaderMax
    && out.final.gldetail === out.baseline.gldetail && out.final.glTab === out.baseline.glTab
    && JSON.stringify(out.final.counters) === JSON.stringify(out.baseline.counters)
    && out.final.serverDate === out.baseline.serverDate
    && out.final.audit === out.baseline.audit && out.final.auditMax === out.baseline.auditMax
    && out.final.residue === '0';
  out.ok = !!out.cpOk && !!out.crOk && !!out.jvOk && out.baselineOk;
  step('done ok=' + out.ok + ' baselineOk=' + out.baselineOk);
} catch (e) { out.fatal = String(e.stack || e).slice(0, 3000); step('FATAL ' + out.fatal); }
finally {
  restore();
  console.log(JSON.stringify(out, (k, v) => (typeof v === 'bigint' ? Number(v) : v), 1));
  await browser.close().catch(() => {});
}
