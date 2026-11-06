// Open Sale Return (Cash or Credit; PARITY_OPEN_CASH=1 selects Cash):
// no source invoice; enter item 9801, validate it, save through the real
// password dialog, verify SRLedger/SRDetail + stock + UTN, restore exactly.
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { appendFileSync, writeFileSync } from 'node:fs';
const require = createRequire(process.env.PLAYWRIGHT_MODULES || 'C:/Users/Admin/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/');
const { chromium } = require('playwright');
const PSQL = 'C:\\PostgreSQL\\17\\bin\\psql.exe';
const DB = process.env.PARITY_DB || 'trader_write_test';
const CASH = process.env.PARITY_OPEN_CASH === '1';
const STEPS = `C:/Projects/Abuzar/deploy/parity/salereturn-open-${CASH ? 'cash' : 'credit'}-steps.txt`;
writeFileSync(STEPS, '');
const step = (s) => appendFileSync(STEPS, new Date().toISOString() + ' ' + s + '\n');
const q = (sql) => execFileSync(PSQL, ['-U', 'postgres', '-h', '127.0.0.1', '-d', DB, '-t', '-A', '-F', '|', '-c', sql], { env: { ...process.env, PGPASSWORD: 'postgres' }, encoding: 'utf8', windowsHide: true }).trim();
const rows = (sql) => q(sql).split(/\r?\n/).filter(Boolean).map((l) => l.split('|'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ITEM = 9801;
const customer = Number(process.env.PARITY_CUSTOMER || (CASH ? 19 : 22));
const SRCAT = CASH ? '8' : '7';
const OPEN_PATH = CASH ? 'Sales | Open Sale Return | Cash Sale Return' : 'Sales | Open Sale Return | Credit Sale Return';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
page.setDefaultTimeout(20000);
const out = { cash: CASH, item: ITEM, customer, messages: [], errors: [], net: [] };
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
const counts = () => ({
  srledger: Number(rows('select count(*) from dbo.srledger')[0][0]),
  srledgerMax: Number(rows('select coalesce(max(srinvcode),0) from dbo.srledger')[0][0]),
  srdetail: Number(rows('select count(*) from dbo.srdetail')[0][0]),
  godown: rows("select currqty::text,lastupdated::text from dbo.godowndetail where icode=" + ITEM + " and gcode=1")[0] ?? null,
  totalpieces: rows("select totalpieces::text from dbo.item where icode=" + ITEM)[0]?.[0] ?? null,
  itemLastupdate: rows("select lastupdate::text from dbo.item where icode=" + ITEM)[0]?.[0] ?? null,
  utn: rows('select utn from dbo._utn')[0]?.[0] ?? null,
  tabs: rows('select tabname,tabmaxkey from dbo._tabmaxkey order by tabname'),
  headerTabs: rows('select headercode,module,tabmaxkey from dbo._headertabmaxkey order by headercode,module'),
  serverDate: rows('select lasttransdate::text from dbo.serverdate')[0]?.[0] ?? null,
  fiscalPref: rows("select prefvalue from dbo.softwarepreferences where name='AutoFiscalizeOnPosting'")[0]?.[0] ?? null,
  audit: Number(rows('select count(*) from dbo.audit_log')[0][0]),
  auditMax: Number(rows('select max(audit_id) from dbo.audit_log')[0][0]),
});
const restore = () => {
  try {
    killIdle();
    const max = Number(out.baseline?.srledgerMax ?? 0);
    q(`set session_replication_role = replica;
       delete from dbo.srdetail where srinvcode > ${max};
       delete from dbo.srledger where srinvcode > ${max};
       ${out.baseline?.godown ? `update dbo.godowndetail set currqty=${Number(out.baseline.godown[0])}, lastupdated='${String(out.baseline.godown[1]).replace(/'/g, "''")}' where icode=${ITEM} and gcode=1;` : ''}
       ${out.baseline?.totalpieces !== null ? `update dbo.item set totalpieces=${Number(out.baseline.totalpieces)}, lastupdate='${String(out.baseline.itemLastupdate).replace(/'/g, "''")}' where icode=${ITEM};` : ''}
       set session_replication_role = origin;`);
    if (out.baseline?.utn) q(`update dbo._utn set utn=${Number(out.baseline.utn)}`);
    for (const [name, value] of out.baseline.tabs) q(`update dbo._tabmaxkey set tabmaxkey=${Number(value)} where tabname='${String(name).replace(/'/g, "''")}'`);
    for (const [headercode, module, value] of out.baseline.headerTabs) q(`update dbo._headertabmaxkey set tabmaxkey=${Number(value)} where headercode=${Number(headercode)} and module=${Number(module)}`);
    if (out.baseline?.serverDate) q(`update dbo.serverdate set lasttransdate='${String(out.baseline.serverDate).replace(/'/g, "''")}'::timestamp`);
    if (out.baseline?.fiscalPref) q(`update dbo.softwarepreferences set prefvalue='${String(out.baseline.fiscalPref).replace(/'/g, "''")}' where name='AutoFiscalizeOnPosting'`);
    if (out.baseline?.auditMax) { q(`delete from dbo.audit_log where audit_id > ${out.baseline.auditMax}`); q(`select setval(pg_get_serial_sequence('dbo.audit_log','audit_id'), ${out.baseline.auditMax}, true)`); }
  } catch (e) { out.restoreError = String(e.message || e).slice(0, 800); }
};
try {
  out.baseline = counts();
  q("update dbo.softwarepreferences set prefvalue='N' where name='AutoFiscalizeOnPosting'");
  step('baseline ' + JSON.stringify({ ...out.baseline, tabs: undefined, headerTabs: undefined }));
  await page.goto('http://127.0.0.1:5177/?app=1&autologin=ADMIN:password9080', { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.rt && window.rt.windowInstances.get('w_main') && typeof window.__menu === 'function', null, { timeout: 90000, polling: 300 });
  step('logged in');
  await page.evaluate(async (path) => { void window.__menu(path); }, OPEN_PATH);
  await page.waitForFunction(() => {
    const w = window.rt.windowInstances.get('w_salereturn');
    const d = w?.props.get('id_detail');
    return d?.model && d.model.rowCount() > 0;
  }, null, { timeout: 30000, polling: 300 });
  await sleep(1200);
  out.open = await page.evaluate(() => {
    const w = window.rt.windowInstances.get('w_salereturn');
    const d = w.props.get('id_detail');
    return { title: String(w.props.get('title') ?? ''), type: w.props.get('ii_salerettype'), open: w.props.get('ib_opensalereturn'), detailRows: d?.model?.rowCount?.() ?? null };
  });
  out.fill = await page.evaluate(async ({ item, customer }) => {
    const rt = window.rt; const w = rt.windowInstances.get('w_salereturn');
    const m = w.props.get('id_master'); const d = w.props.get('id_detail');
    const bad = [];
    for (const [k, v] of Object.entries({ custcode: customer, date: '2026-11-06 00:00:00', posted: 'Y', accountfor: 'Y', cashacccode: 2 })) {
      try { await m.pbCall('setitem', [1, k, v], rt) } catch { bad.push('m:' + k) }
    }
    if (!d.model.rowCount()) await d.pbCall('insertrow', [0], rt);
    for (const [k, v] of Object.entries({ icode: item, gcode: 1, batch: '.', expiry: '2030-12-12 00:00:00', looseqty: 1, srprice: 10, saleprice: 10, discperc: 0, bonusqty: 0 })) {
      try { await d.pbCall('setitem', [1, k, v], rt) } catch { bad.push('d:' + k) }
    }
    await d.pbCall('setrow', [1], rt).catch(() => {});
    for (const x of [m, d]) if (x?.model) x.model.acceptText = async () => 1;
    await m.pbCall('accepttext', [], rt).catch(() => {});
    await d.pbCall('accepttext', [], rt).catch(() => {});
    return { bad, m: m.model.buf.primary[0]?.v ?? null, d: d.model.buf.primary[0]?.v ?? null };
  }, { item: ITEM, customer });
  await poll(2);
  out.validate = await page.evaluate(async () => {
    const rt = window.rt; const w = rt.windowInstances.get('w_salereturn');
    window.__val = false;
    try { const r = await w.pbCall('wf_validateitem', [], rt); window.__val = String(r) } catch (e) { window.__val = 'ERR ' + String(e.message || e).slice(0, 300) }
    return window.__val;
  });
  await poll(4);
  // the user's item focus runs the footer total; the programmatic validate
  // path does not, and a null FBR fee would make the insert violate NOT NULL.
  out.total = await page.evaluate(async () => {
    const rt = window.rt; const w = rt.windowInstances.get('w_salereturn');
    const m = w.props.get('id_master'); const f = w.props.get('id_footer');
    try { await w.pbCall('wf_grandtotal', [], rt) } catch {}
    for (const [k, v] of Object.entries({ fbrposfee: 0, advancetaxamt: 0, invgstperc1: 0, discperc: 0, flatdisc: 0, misccharges: 0 })) {
      try { await f.pbCall('setitem', [1, k, v], rt) } catch {}
    }
    for (const [k, v] of Object.entries({ fbrposfee: 0, advancetaxamt: 0, invgstperc1: 0, discperc: 0, flatdisc: 0, misccharges: 0, advancetax: 'N' })) {
      try { await m.pbCall('setitem', [1, k, v], rt) } catch {}
    }
    f.model.acceptText = async () => 1;
    m.model.acceptText = async () => 1;
    await f.pbCall('accepttext', [], rt).catch(() => {});
    await m.pbCall('accepttext', [], rt).catch(() => {});
    try { return String(await f.pbCall('getitemstring', [1, 'total'], rt)) } catch { return 'n/a' }
  });
  out.afterValidate = await page.evaluate(async () => {
    const rt = window.rt; const w = rt.windowInstances.get('w_salereturn'); const d = w.props.get('id_detail'); const f = w.props.get('id_footer');
    const o = {};
    for (const n of ['icode', 'itemname', 'packqty', 'looseqty', 'srprice', 'saleprice', 'batch', 'expiry', 'gcode']) { try { o[n] = String(await d.pbCall('getitemstring', [1, n], rt)) } catch { o[n] = 'n/a' } }
    for (const n of ['total']) { try { o[n] = String(await f.pbCall('getitemstring', [1, n], rt)) } catch { o[n] = 'n/a' } }
    return o;
  });
  step('validate ' + JSON.stringify(out.validate) + ' after ' + JSON.stringify(out.afterValidate));
  out.save = await page.evaluate(async () => {
    const rt = window.rt; const w = rt.windowInstances.get('w_salereturn');
    window.__save = false;
    void w.pbCall('ue_save', [], rt).then(() => { window.__save = 'ok' }).catch((e) => { window.__save = 'ERR ' + String(e.message || e).slice(0, 400) });
    return 'fired';
  });
  out.password = null;
  for (let i = 0; i < 60; i++) {
    await sleep(500);
    const has = await page.evaluate(() => !!window.rt.windowInstances.get('w_salesmanpassword'));
    if (has) {
      out.password = await page.evaluate(async () => {
        const rt = window.rt; const w = rt.windowInstances.get('w_salesmanpassword'); const d = w.props.get('id_password') || w.children.get('dw_password');
        if (!d) return { error: 'no password dw' };
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
  await poll(25);
  out.saveResult = await page.evaluate(() => window.__save ?? null);
  out.after = {
    srledger: rows(`select srinvcode,saleinvcode,srcatcode,custcode,posted,invtotal::text,remarks from dbo.srledger where srinvcode > ${out.baseline.srledgerMax} order by srinvcode`),
    srdetail: rows(`select srinvcode,icode,gcode,looseqty::text,srprice::text,srutn,currstock::text from dbo.srdetail where srinvcode > ${out.baseline.srledgerMax} order by srinvcode`),
    godown: rows("select currqty::text from dbo.godowndetail where icode=" + ITEM + " and gcode=1")[0]?.[0] ?? null,
    totalpieces: rows("select totalpieces::text from dbo.item where icode=" + ITEM)[0]?.[0] ?? null,
    utn: rows('select utn from dbo._utn')[0]?.[0] ?? null,
  };
  out.addOk = out.after.srledger.length === 1
    && (out.after.srledger[0][1] === '' || out.after.srledger[0][1] === null)
    && out.after.srledger[0][2] === SRCAT
    && out.after.srledger[0][3] === String(customer)
    && out.after.srledger[0][4] === 'Y'
    && Number(out.after.srledger[0][5]) === 10
    && out.after.srdetail.length === 1
    && out.after.srdetail[0][1] === String(ITEM)
    && Number(out.after.srdetail[0][3]) === 1
    && Number(out.after.srdetail[0][4]) === 10
    && Number(out.after.godown) === Number(out.baseline.godown?.[0]) + 1
    && out.messages.some((m) => /Changes take effect in database/i.test(m));
  step('after ' + JSON.stringify(out.after) + ' ok=' + out.addOk);
  restore();
  out.final = counts();
  out.final.residue = rows(`select count(*) from dbo.srledger where srinvcode > ${out.baseline.srledgerMax}`)[0]?.[0] ?? null;
  out.baselineOk = out.final.srledger === out.baseline.srledger && out.final.srledgerMax === out.baseline.srledgerMax
    && out.final.srdetail === out.baseline.srdetail
    && JSON.stringify(out.final.godown) === JSON.stringify(out.baseline.godown)
    && out.final.totalpieces === out.baseline.totalpieces
    && out.final.itemLastupdate === out.baseline.itemLastupdate
    && out.final.utn === out.baseline.utn
    && JSON.stringify(out.final.tabs) === JSON.stringify(out.baseline.tabs)
    && JSON.stringify(out.final.headerTabs) === JSON.stringify(out.baseline.headerTabs)
    && out.final.serverDate === out.baseline.serverDate
    && out.final.fiscalPref === out.baseline.fiscalPref
    && out.final.audit === out.baseline.audit && out.final.auditMax === out.baseline.auditMax
    && out.final.residue === '0';
  out.ok = !!out.addOk && out.baselineOk;
  step('done ok=' + out.ok + ' baselineOk=' + out.baselineOk);
} catch (e) { out.fatal = String(e.stack || e).slice(0, 3000); step('FATAL ' + out.fatal); }
finally {
  restore();
  console.log(JSON.stringify(out, (k, v) => (typeof v === 'bigint' ? Number(v) : v), 1));
  await browser.close().catch(() => {});
}
