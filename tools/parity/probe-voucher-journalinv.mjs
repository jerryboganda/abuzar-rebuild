// Journal vouchers against sales (14) and purchase (17): w_journalvoucher
// assigns d_invsale/d_invpurjournalvoucherheader + d_invjournalvoucherdetail,
// writes InvLedger/InvDetail and uses f_newtableid("InvLedger").
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { appendFileSync, writeFileSync } from 'node:fs';
const require = createRequire(process.env.PLAYWRIGHT_MODULES || 'C:/Users/Admin/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/');
const { chromium } = require('playwright');
const PSQL = 'C:\\PostgreSQL\\17\\bin\\psql.exe';
const DB = process.env.PARITY_DB || 'trader_write_test';
const STEPS = 'C:/Projects/Abuzar/deploy/parity/voucher-journalinv-steps.txt';
writeFileSync(STEPS, '');
const step = (s) => appendFileSync(STEPS, new Date().toISOString() + ' ' + s + '\n');
const q = (sql) => execFileSync(PSQL, ['-U', 'postgres', '-h', '127.0.0.1', '-d', DB, '-t', '-A', '-F', '|', '-c', sql], { env: { ...process.env, PGPASSWORD: 'postgres' }, encoding: 'utf8', windowsHide: true }).trim();
const rows = (sql) => q(sql).split(/\r?\n/).filter(Boolean).map((l) => l.split('|'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SUF = String(Date.now()).slice(-6);
const REM14 = 'PARITY JVI SALE ' + SUF;
const REM17 = 'PARITY JVI PUR ' + SUF;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
page.setDefaultTimeout(20000);
const out = { rem14: REM14, rem17: REM17, messages: [], errors: [], net: [] };
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
  invledger: Number(rows('select count(*) from dbo.invledger')[0][0]),
  invledgerMax: Number(rows('select coalesce(max(invvochcode),0) from dbo.invledger')[0][0]),
  invdetail: Number(rows('select count(*) from dbo.invdetail')[0][0]),
  invTab: rows("select tabmaxkey from dbo._tabmaxkey where tabname='InvLedger'")[0]?.[0] ?? null,
  counters: rows("select vochcatcode,counter from dbo.vochercategory where vochcatcode in (14,17) order by vochcatcode"),
  serverDate: rows('select lasttransdate::text from dbo.serverdate')[0]?.[0] ?? null,
  audit: Number(rows('select count(*) from dbo.audit_log')[0][0]),
  auditMax: Number(rows('select max(audit_id) from dbo.audit_log')[0][0]),
});
const restore = () => {
  try {
    killIdle();
    q("set session_replication_role = replica; delete from dbo.invdetail where invvochcode in (select invvochcode from dbo.invledger where remarks in ('" + REM14.replace(/'/g, "''") + "','" + REM17.replace(/'/g, "''") + "')); delete from dbo.invledger where remarks in ('" + REM14.replace(/'/g, "''") + "','" + REM17.replace(/'/g, "''") + "'); set session_replication_role = origin");
    if (out.baseline?.invTab !== null) q(`update dbo._tabmaxkey set tabmaxkey=${Number(out.baseline.invTab)} where tabname='InvLedger'`);
    for (const [cat, counter] of out.baseline.counters) q(`update dbo.vochercategory set counter=${Number(counter)} where vochcatcode=${Number(cat)}`);
    if (out.baseline?.serverDate) q(`update dbo.serverdate set lasttransdate='${String(out.baseline.serverDate).replace(/'/g, "''")}'::timestamp`);
    if (out.baseline?.auditMax) { q(`delete from dbo.audit_log where audit_id > ${out.baseline.auditMax}`); q(`select setval(pg_get_serial_sequence('dbo.audit_log','audit_id'), ${out.baseline.auditMax}, true)`); }
  } catch (e) { out.restoreError = String(e.message || e).slice(0, 700); }
};
async function openCat(cat) {
  await page.evaluate(async (c) => {
    const rt = window.rt;
    const { Ref } = await import('/src/runtime/interp.js');
    let win = null; const ref = new Ref(() => win, (v) => { win = v }); ref.name = 'w_journalvoucher';
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
async function saveVoucher(cat, master, detailRows) {
  const fill = await page.evaluate(async ({ master, detailRows }) => {
    const rt = window.rt; const w = rt.windowInstances.get('w_journalvoucher');
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
    const rt = window.rt; const w = rt.windowInstances.get('w_journalvoucher');
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
  await page.goto('http://127.0.0.1:5177/?app=1&autologin=ADMIN:password9080', { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.rt && window.rt.windowInstances.get('w_main') && typeof window.__menu === 'function', null, { timeout: 90000, polling: 300 });
  step('logged in');
  for (const cat of [14, 17]) {
    const rem = cat === 14 ? REM14 : REM17;
    await closeForms();
    await openCat(cat);
    await page.waitForFunction(() => window.rt.windowInstances.get('w_journalvoucher'), null, { timeout: 30000, polling: 300 });
    await sleep(2000); await poll(2);
    out['open' + cat] = await page.evaluate(() => {
      const w = window.rt.windowInstances.get('w_journalvoucher');
      const rows = (f) => { try { return w.props.get(f)?.model?.rowCount?.() ?? null } catch { return 'ERR' } };
      return { title: String(w.props.get('title') ?? ''), cat: w.props.get('ii_vouchertype'), masterRows: rows('id_master'), detailRows: rows('id_detail'), dataobject: String(w.props.get('id_master')?.props.get('dataobject') ?? '') };
    });
    await page.evaluate(async () => { const rt = window.rt; const w = rt.windowInstances.get('w_journalvoucher'); await w.pbCall('ue_newform', [], rt).catch(() => {}) });
    await sleep(900); await poll(1);
    out['save' + cat] = await saveVoucher(cat, { date: '2026-11-06 00:00:00', acccode: 2, remarks: rem }, [
      { acccode: 24, debit: 10, credit: 0, invcode: null, chkno: '', remarks: 'PARITY JVI D' },
      { acccode: 2, debit: 0, credit: 10, invcode: null, chkno: '', remarks: 'PARITY JVI C' },
    ]);
    out['rows' + cat] = rows(`select invvochcode,invvochcatcode,acccode,posted,remarks from dbo.invledger where remarks='${rem}'`);
    out['detail' + cat] = out['rows' + cat][0] ? rows(`select acccode,debit::text,credit::text,chkno,remarks from dbo.invdetail where invvochcode=${Number(out['rows' + cat][0][0])} order by rowid`) : [];
    out['ok' + cat] = out['rows' + cat].length === 1 && out['rows' + cat][0][1] === String(cat) && out['rows' + cat][0][3] === 'N'
      && out['detail' + cat].length === 2
      && out['detail' + cat].some((r) => r[0] === '24' && Number(r[1]) === 10 && Number(r[2]) === 0)
      && out['detail' + cat].some((r) => r[0] === '2' && Number(r[1]) === 0 && Number(r[2]) === 10)
      && out.messages.some((m) => /Changes take effect in database/i.test(m));
    step('cat ' + cat + ' ' + JSON.stringify({ open: out['open' + cat], rows: out['rows' + cat], detail: out['detail' + cat], ok: out['ok' + cat], msgs: out.messages.slice(-3) }));
  }
  await closeForms();
  restore();
  out.final = counts();
  out.final.residue = rows("select count(*) from dbo.invledger where remarks like 'PARITY JVI %'")[0]?.[0] ?? null;
  out.baselineOk = out.final.invledger === out.baseline.invledger && out.final.invledgerMax === out.baseline.invledgerMax
    && out.final.invdetail === out.baseline.invdetail && out.final.invTab === out.baseline.invTab
    && JSON.stringify(out.final.counters) === JSON.stringify(out.baseline.counters)
    && out.final.serverDate === out.baseline.serverDate
    && out.final.audit === out.baseline.audit && out.final.auditMax === out.baseline.auditMax
    && out.final.residue === '0';
  out.ok = !!out.ok14 && !!out.ok17 && out.baselineOk;
  step('done ok=' + out.ok + ' baselineOk=' + out.baselineOk);
} catch (e) { out.fatal = String(e.stack || e).slice(0, 3000); step('FATAL ' + out.fatal); }
finally {
  restore();
  console.log(JSON.stringify(out, (k, v) => (typeof v === 'bigint' ? Number(v) : v), 1));
  await browser.close().catch(() => {});
}
