// Credit Sale Return (Sales | Sale Return | Credit Sale Return):
// validate a Credit Whole Sale invoice, pick the returned item, save through
// the real form + password dialog, verify SRLedger/SRDetail, stock counters,
// sale-return counter and UTN, then restore exactly.
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { appendFileSync, writeFileSync } from 'node:fs';
const require = createRequire(process.env.PLAYWRIGHT_MODULES || 'C:/Users/Admin/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/');
const { chromium } = require('playwright');
const PSQL = 'C:\\PostgreSQL\\17\\bin\\psql.exe';
const DB = process.env.PARITY_DB || 'trader_write_test';
const STEPS = 'C:/Projects/Abuzar/deploy/parity/salereturn-credit-steps.txt';
writeFileSync(STEPS, '');
const step = (s) => appendFileSync(STEPS, new Date().toISOString() + ' ' + s + '\n');
const q = (sql) => execFileSync(PSQL, ['-U', 'postgres', '-h', '127.0.0.1', '-d', DB, '-t', '-A', '-F', '|', '-c', sql], { env: { ...process.env, PGPASSWORD: 'postgres' }, encoding: 'utf8', windowsHide: true }).trim();
const rows = (sql) => q(sql).split(/\r?\n/).filter(Boolean).map((l) => l.split('|'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SALEINV = 588889;
const ITEM = 9801;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
page.setDefaultTimeout(20000);
const out = { saleinv: SALEINV, item: ITEM, messages: [], errors: [], net: [] };
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
const tabs = () => rows("select tabname,tabmaxkey from dbo._tabmaxkey order by tabname");
const counts = () => ({
  srledger: Number(rows('select count(*) from dbo.srledger')[0][0]),
  srledgerMax: Number(rows('select coalesce(max(srinvcode),0) from dbo.srledger')[0][0]),
  srdetail: Number(rows('select count(*) from dbo.srdetail')[0][0]),
  godown: rows("select currqty::text,lastupdated::text from dbo.godowndetail where icode=" + ITEM + " and gcode=1")[0] ?? null,
  totalpieces: rows("select totalpieces::text from dbo.item where icode=" + ITEM)[0]?.[0] ?? null,
  itemLastupdate: rows("select lastupdate::text from dbo.item where icode=" + ITEM)[0]?.[0] ?? null,
  returncounter: rows("select returncounter::text from dbo.saleledger where saleinvcode=" + SALEINV)[0]?.[0] ?? null,
  utn: rows('select utn from dbo._utn')[0]?.[0] ?? null,
  tabs: tabs(),
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
    // one psql session: replica role must cover the triggered tables too
    q(`set session_replication_role = replica;
       delete from dbo.srdetail where srinvcode > ${max};
       delete from dbo.srledger where srinvcode > ${max};
       ${out.baseline?.godown ? `update dbo.godowndetail set currqty=${Number(out.baseline.godown[0])}, lastupdated='${String(out.baseline.godown[1]).replace(/'/g, "''")}' where icode=${ITEM} and gcode=1;` : ''}
       ${out.baseline?.totalpieces !== null ? `update dbo.item set totalpieces=${Number(out.baseline.totalpieces)}, lastupdate='${String(out.baseline.itemLastupdate).replace(/'/g, "''")}' where icode=${ITEM};` : ''}
       set session_replication_role = origin;`);
    if (out.baseline?.returncounter !== null) q(`update dbo.saleledger set returncounter=${Number(out.baseline.returncounter)} where saleinvcode=${SALEINV}`);
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
  // the clone has no FBR endpoint; the original call blocks ~30 s after commit
  q("update dbo.softwarepreferences set prefvalue='N' where name='AutoFiscalizeOnPosting'");
  step('baseline ' + JSON.stringify(out.baseline));
  await page.goto('http://127.0.0.1:5177/?app=1&autologin=ADMIN:password9080', { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.rt && window.rt.windowInstances.get('w_main') && typeof window.__menu === 'function', null, { timeout: 90000, polling: 300 });
  step('logged in');
  await page.evaluate(async () => { void window.__menu('Sales | Sale Return | Credit Sale Return'); });
  await page.waitForFunction(() => {
    const w = window.rt.windowInstances.get('w_salereturn');
    const d = w?.props.get('id_detail');
    return d?.model && d.model.rowCount() > 0;
  }, null, { timeout: 30000, polling: 300 });
  await sleep(1200);
  out.open = await page.evaluate(() => {
    const w = window.rt.windowInstances.get('w_salereturn');
    const d = w.props.get('id_detail');
    return { title: String(w.props.get('title') ?? ''), type: w.props.get('ii_salerettype'), master: !!w.props.get('id_master'), detailRows: d?.model?.rowCount?.() ?? null };
  });
  out.validate = await page.evaluate(async (inv) => {
    const rt = window.rt; const w = rt.windowInstances.get('w_salereturn'); const m = w.props.get('id_master');
    try {
      await m.pbCall('setitem', [1, 'saleinvcode', inv], rt);
      await m.pbCall('accepttext', [], rt);
      return String(await w.pbCall('wf_validatesaleinvcode', [1, inv], rt));
    } catch (e) { return 'ERR ' + String(e.message || e).slice(0, 400); }
  }, SALEINV);
  step('validate ' + JSON.stringify(out.validate));
  // wait for the sold-item list and pick the requested item
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    const n = await page.evaluate(async () => {
      const w = window.rt.windowInstances.get('w_salereturn');
      const l = w?.props.get('id_itemslist');
      return l ? await l.n_rowcount() : 0;
    });
    if (n > 0) { out.itemsListRows = n; break; }
    await poll(1);
  }
  out.pick = await page.evaluate(async (icode) => {
    const rt = window.rt; const w = rt.windowInstances.get('w_salereturn');
    const l = w.props.get('id_itemslist'); const d = w.props.get('id_detail');
    const n = await l.pbCall('find', ['icode = ' + icode, 1, await l.n_rowcount()], rt);
    if (!(n > 0)) return { error: 'item not in list', rows: await l.n_rowcount() };
    await d.pbCall('setrow', [1], rt);
    await l.pbCall('setrow', [n], rt);
    await l.n_scrolltorow(n);
    await rt.fire(l, 'clicked', [0, 0, n, { name: 'itemname' }]);
    await new Promise((r) => setTimeout(r, 1200));
    return { row: n, rows: await l.n_rowcount() };
  }, ITEM);
  step('pick ' + JSON.stringify(out.pick));
  await poll(3);
  await page.evaluate(async () => {
    const rt = window.rt; const w = rt.windowInstances.get('w_salereturn'); const d = w.props.get('id_detail');
    await d.pbCall('setrow', [1], rt);
    void rt.fire(d, 'itemfocuschanged', [1, { name: 'itemname' }]);
    await new Promise((r) => setTimeout(r, 600));
  });
  await sleep(1800);
  out.before = await page.evaluate(async () => {
    const rt = window.rt; const w = rt.windowInstances.get('w_salereturn');
    const d = w.props.get('id_detail'); const f = w.props.get('id_footer');
    const o = {};
    for (const n of ['icode', 'itemname', 'packqty', 'looseqty', 'srprice', 'saleprice', 'batch', 'expiry', 'totalpieces']) { try { o[n] = String(await d.pbCall('getitemstring', [1, n], rt)); } catch { o[n] = 'n/a' } }
    for (const n of ['total']) { try { o[n] = String(await f.pbCall('getitemstring', [1, n], rt)); } catch { o[n] = 'n/a' } }
    return o;
  });
  step('before ' + JSON.stringify(out.before));
  out.save = await page.evaluate(async () => {
    const rt = window.rt; const w = rt.windowInstances.get('w_salereturn');
    window.__save = false;
    void w.pbCall('ue_save', [], rt).then(() => { window.__save = 'ok' }).catch((e) => { window.__save = 'ERR ' + String(e.message || e).slice(0, 400) });
    return 'fired';
  });
  // password dialog
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
    returncounter: rows("select returncounter::text from dbo.saleledger where saleinvcode=" + SALEINV)[0]?.[0] ?? null,
    utn: rows('select utn from dbo._utn')[0]?.[0] ?? null,
  };
  out.addOk = out.after.srledger.length === 1
    && out.after.srledger[0][1] === String(SALEINV)
    && out.after.srledger[0][2] === '7'
    && out.after.srledger[0][4] === 'Y'
    && Number(out.after.srledger[0][5]) === 11
    && out.after.srdetail.length === 1
    && out.after.srdetail[0][1] === String(ITEM)
    && Number(out.after.srdetail[0][3]) === 1
    && Number(out.after.srdetail[0][4]) === 10
    && Number(out.after.godown) === Number(out.baseline.godown?.[0]) + 1
    && Number(out.after.returncounter) === 1
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
    && out.final.returncounter === out.baseline.returncounter
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
