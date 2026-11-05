// Change Item Discount - Category Wise on category 6 (29 active items):
//  - open w_change_itemdisc_catwise with parm "C"
//  - set icatcode 6 / salediscno 1 / saledisc 5, run wf_changedisc (confirm Yes)
//  - verify SaleDiscPerc on all 29 active items + 29 itemlog inserts
//  - restore every item column, itemlog and audit rows to the snapshot
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const require = createRequire(process.env.PLAYWRIGHT_MODULES || 'C:/Users/Admin/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/');
const { chromium } = require('playwright');
const PSQL = 'C:\\PostgreSQL\\17\\bin\\psql.exe';
const q = (sql) => execFileSync(PSQL, ['-U', 'postgres', '-h', '127.0.0.1', '-d', 'trader_write_test', '-t', '-A', '-F', '|', '-c', sql], { env: { ...process.env, PGPASSWORD: 'postgres' }, encoding: 'utf8', windowsHide: true }).trim();
const rows = (sql) => q(sql).split(/\r?\n/).filter(Boolean).map((l) => l.split('|'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CAT = Number(process.env.CAT || 6);
const DISCNO = Number(process.env.DISCNO || 1);
const DISC = Number(process.env.DISC || 5);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const out = { cat: CAT, discno: DISCNO, disc: DISC, messages: [], errors: [], net: [] };
page.on('pageerror', (e) => out.errors.push(String(e.message || e).slice(0, 400)));
page.on('request', (r) => { if (r.url().includes('/api/exec')) out.net.push({ p: 'req', body: String(r.postData() || '') }) });
page.on('response', async (r) => { if (r.url().includes('/api/exec')) { let b = ''; try { b = await r.text() } catch {} out.net.push({ p: 'res', status: r.status(), body: String(b).slice(0, 500) }) } });
async function poll(seconds = 8, yes = false) {
  for (let i = 0; i < seconds * 2; i++) {
    await sleep(500);
    const msgs = await page.evaluate(() => [...document.querySelectorAll('.msgbox .txt')].map((e) => e.textContent.replace(/\s+/g, ' ').trim().slice(0, 240)));
    if (msgs.length) {
      out.messages.push(...msgs);
      await page.evaluate((y) => { for (const b of document.querySelectorAll('.msgbox')) { const bs = [...b.querySelectorAll('.btns button')]; const want = y ? /^(yes|ok)$/i : /^(ok|no|cancel|close)$/i; (bs.find((x) => want.test(x.textContent.trim())) || bs[0])?.click(); } }, yes);
      await sleep(250);
    }
  }
}
try {
  out.baseline = {
    items: rows(`select icode,salediscperc::text,changereason,module,usercode::text,lastupdate::text from dbo.item where icatcode=${CAT} and active=1 order by icode`),
    count: Number(rows(`select count(*) from dbo.item where icatcode=${CAT} and active=1`)[0][0]),
    itemlog: Number(rows('select count(*) from dbo.itemlog')[0][0]),
    itemlogMax: Number(rows('select max(itemrowid) from dbo.itemlog')[0][0]),
    itemlogCat: Number(rows(`select count(*) from dbo.itemlog where icode in (select icode from dbo.item where icatcode=${CAT} and active=1)`)[0][0]),
    audit: Number(rows('select count(*) from dbo.audit_log')[0][0]),
    auditMax: Number(rows('select max(audit_id) from dbo.audit_log')[0][0]),
  };
  await page.goto('http://127.0.0.1:5177/?app=1&autologin=ADMIN:password9080', { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.rt && window.rt.windowInstances.get('w_main') && typeof window.__menu === 'function', null, { timeout: 90000, polling: 300 });
  out.open = await page.evaluate(async () => {
    const rt = window.rt;
    const { Ref } = await import('/src/runtime/interp.ts');
    let win = null;
    const ref = new Ref(() => win, (v) => { win = v });
    ref.name = 'w_change_itemdisc_catwise';
    await rt.sys.get('opensheetwithparm').fn(rt, [ref, 'C', rt.windowInstances.get('w_main'), 0, 0], undefined);
    return { opened: !!rt.windowInstances.get('w_change_itemdisc_catwise') };
  });
  await page.waitForFunction(() => window.rt.windowInstances.get('w_change_itemdisc_catwise'), null, { timeout: 30000, polling: 300 });
  await sleep(1600); await poll(2);
  out.state = await page.evaluate(() => {
    const rt = window.rt; const w = rt.windowInstances.get('w_change_itemdisc_catwise');
    const d = w.props.get('id_detail') || w.children.get('dw_detail');
    return { title: String(w.props.get('title') ?? ''), changeoption: String(w.props.get('il_changeoption') ?? ''), rows: d?.model?.rowCount(), cols: d?.model?.colNames };
  });
  out.fill = await page.evaluate(async ({ cat, no, disc }) => {
    const rt = window.rt; const w = rt.windowInstances.get('w_change_itemdisc_catwise');
    const d = w.props.get('id_detail') || w.children.get('dw_detail');
    const m = d.model; const r = m.rowCount() ? 1 : (await d.pbCall('insertrow', [0], rt), m.rowCount());
    await d.pbCall('setitem', [r, 'icatcode', cat], rt).catch((e) => { window.__e = String(e.message) });
    // the drop-down validation rejects a code whose child DataWindow has not
    // been retrieved in this harness; set the model value the form reads
    const ci = m.colIndex('icatcode');
    if (ci >= 0) m.buf.primary[r - 1].v[ci] = cat;
    await d.pbCall('setitem', [r, 'salediscno', no], rt).catch(() => {});
    await d.pbCall('setitem', [r, 'saledisc', disc], rt).catch(() => {});
    await d.pbCall('accepttext', [], rt).catch(() => {});
    return { row: r, rows: m.rowCount(), values: m.buf.primary[r - 1]?.v, code: String(await d.pbCall('getitemnumber', [r, 'icatcode'], rt)), err: String(window.__e ?? '') };
  }, { cat: CAT, no: DISCNO, disc: DISC });
  out.fire = await page.evaluate(() => {
    const rt = window.rt; const w = rt.windowInstances.get('w_change_itemdisc_catwise');
    window.__runDone = false;
    w.pbCall('wf_changedisc', [], rt).then((v) => { window.__runDone = String(v) }).catch((e) => { window.__runDone = 'ERR ' + String(e.message || e).slice(0, 300) });
    return 'fired';
  });
  await poll(10, true);
  await sleep(1500);
  await poll(10, false);
  out.runDone = await page.evaluate(() => window.__runDone);
  out.after = {
    changed: rows(`select count(*) from dbo.item where icatcode=${CAT} and active=1 and salediscperc=${DISC} and module='Change Discounts'`),
    sample: rows(`select icode,salediscperc::text,changereason,module,usercode::text,lastupdate::text from dbo.item where icatcode=${CAT} and active=1 order by icode limit 3`),
    itemlog: rows('select count(*),max(itemrowid) from dbo.itemlog'),
    itemlogCat: rows(`select count(*) from dbo.itemlog where icode in (select icode from dbo.item where icatcode=${CAT} and active=1)`),
    audit: rows('select count(*),max(audit_id) from dbo.audit_log'),
  };
  out.changedOk = out.after.changed?.[0]?.[0] === String(out.baseline.count) && out.after.sample?.[0]?.[2] === 'Change Discounts Cat Wise';
  out.logOk = Number(out.after.itemlog?.[0]?.[0]) >= out.baseline.itemlog + out.baseline.count && Number(out.after.itemlogCat?.[0]?.[0]) === out.baseline.itemlogCat + out.baseline.count;
  out.sql = out.net.filter((x) => String(x.body).toLowerCase().includes('itemlog') || String(x.body).toLowerCase().includes('sp_changeitemdisc')).slice(0, 5);
  // exact restore of every category item
  const qv = (v) => (v === null || v === undefined || v === '' ? 'null' : `'${String(v).replace(/'/g, "''")}'`);
  let restoreSql = 'set session_replication_role = replica;';
  for (const [icode, discv, reason, mod, user, last] of out.baseline.items) {
    restoreSql += ` update dbo.item set salediscperc=${Number(discv)}, changereason=${qv(reason)}, module=${qv(mod)}, usercode=${user === '' ? 'null' : Number(user)}, lastupdate=${qv(last)} where icode=${Number(icode)};`;
  }
  restoreSql += ' set session_replication_role = origin;';
  q(restoreSql);
  q(`delete from dbo.itemlog where itemrowid > ${out.baseline.itemlogMax}`);
  q(`select setval(pg_get_serial_sequence('dbo.itemlog','itemrowid'), ${out.baseline.itemlogMax}, true)`);
  q(`delete from dbo.audit_log where audit_id > ${out.baseline.auditMax}`);
  q(`select setval(pg_get_serial_sequence('dbo.audit_log','audit_id'), ${out.baseline.auditMax}, true)`);
  out.final = {
    items: rows(`select icode,salediscperc::text,changereason,module,usercode::text,lastupdate::text from dbo.item where icatcode=${CAT} and active=1 order by icode`),
    itemlog: rows('select count(*),max(itemrowid) from dbo.itemlog'),
    itemlogCat: rows(`select count(*) from dbo.itemlog where icode in (select icode from dbo.item where icatcode=${CAT} and active=1)`),
    audit: rows('select count(*),max(audit_id) from dbo.audit_log'),
  };
  out.baselineOk = JSON.stringify(out.final.items) === JSON.stringify(out.baseline.items)
    && out.final.itemlog[0][0] === String(out.baseline.itemlog) && out.final.itemlog[0][1] === String(out.baseline.itemlogMax)
    && out.final.itemlogCat[0][0] === String(out.baseline.itemlogCat)
    && out.final.audit[0][0] === String(out.baseline.audit) && out.final.audit[0][1] === String(out.baseline.auditMax);
  out.ok = !!out.changedOk && !!out.logOk && out.baselineOk;
} catch (e) { out.fatal = String(e.stack || e).slice(0, 1800); }
finally {
  try {
    if (out.baseline?.items) {
      const qv2 = (v) => (v === null || v === undefined || v === '' ? 'null' : `'${String(v).replace(/'/g, "''")}'`);
      let s = 'set session_replication_role = replica;';
      for (const [icode, discv, reason, mod, user, last] of out.baseline.items) s += ` update dbo.item set salediscperc=${Number(discv)}, changereason=${qv2(reason)}, module=${qv2(mod)}, usercode=${user === '' ? 'null' : Number(user)}, lastupdate=${qv2(last)} where icode=${Number(icode)};`;
      s += ' set session_replication_role = origin;';
      q(s);
      q(`delete from dbo.itemlog where itemrowid > ${out.baseline.itemlogMax}`);
      q(`select setval(pg_get_serial_sequence('dbo.itemlog','itemrowid'), ${out.baseline.itemlogMax}, true)`);
      q(`delete from dbo.audit_log where audit_id > ${out.baseline.auditMax}`);
      q(`select setval(pg_get_serial_sequence('dbo.audit_log','audit_id'), ${out.baseline.auditMax}, true)`);
    }
  } catch {}
  console.log(JSON.stringify(out, (k, v) => (typeof v === 'bigint' ? Number(v) : v), 1));
  await browser.close().catch(() => {});
}
