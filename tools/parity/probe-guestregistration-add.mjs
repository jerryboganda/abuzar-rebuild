// Guest Registration modal (w_guestregistration, opened by the check-in
// screen's Register Guest action): add a guest through cb_ok, which generates
// the Guest tab key, updates ServerDate and inserts the Guest row.
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
const NAME = 'PARITY REG GUEST ' + SUF;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const out = { name: NAME, messages: [], errors: [], net: [] };
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
  guests: Number(rows('select count(*) from dbo.guest')[0][0]),
  guestMax: Number(rows('select coalesce(max(guestcode),0) from dbo.guest')[0][0]),
  tab: rows("select tabmaxkey from dbo._tabmaxkey where tabname='Guest'")[0]?.[0] ?? null,
  serverDate: rows('select lasttransdate::text from dbo.serverdate')[0]?.[0] ?? null,
  audit: Number(rows('select count(*) from dbo.audit_log')[0][0]),
  auditMax: Number(rows('select max(audit_id) from dbo.audit_log')[0][0]),
});
const restore = () => {
  try {
    killIdle();
    q(`delete from dbo.guest where name='${NAME.replace(/'/g, "''")}'`);
    if (out.baseline?.tab !== null) q(`update dbo._tabmaxkey set tabmaxkey=${Number(out.baseline.tab)} where tabname='Guest'`);
    if (out.baseline?.serverDate) q(`update dbo.serverdate set lasttransdate='${String(out.baseline.serverDate).replace(/'/g, "''")}'::timestamp`);
    if (out.baseline?.auditMax) { q(`delete from dbo.audit_log where audit_id > ${out.baseline.auditMax}`); q(`select setval(pg_get_serial_sequence('dbo.audit_log','audit_id'), ${out.baseline.auditMax}, true)`); }
  } catch (e) { out.restoreError = String(e.message || e).slice(0, 700); }
};
try {
  out.baseline = counts();
  await page.goto('http://127.0.0.1:5177/?app=1&autologin=ADMIN:password9080', { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.rt && window.rt.windowInstances.get('w_main') && typeof window.__menu === 'function', null, { timeout: 90000, polling: 300 });
  out.openCall = await page.evaluate(async () => {
    const rt = window.rt;
    const { Ref } = await import('/src/runtime/interp.js');
    let win = null; const ref = new Ref(() => win, (v) => { win = v }); ref.name = 'w_guestregistration';
    void rt.sys.get('open').fn(rt, [ref], undefined).catch(() => {});
    return { fired: true };
  });
  await page.waitForFunction(() => window.rt.windowInstances.get('w_guestregistration'), null, { timeout: 30000, polling: 300 });
  await sleep(1200); await poll(2);
  out.form = await page.evaluate(() => {
    const w = window.rt.windowInstances.get('w_guestregistration');
    const find = (o, n) => { if (o.name === n) return o; for (const c of o.children.values()) { const r = find(c, n); if (r) return r } return null };
    const d = find(w, 'dw_detail');
    return { title: String(w.props.get('title') ?? ''), rows: d?.model?.rowCount?.() ?? null, cols: d?.model?.colNames?.length ?? null };
  });
  out.fill = await page.evaluate(async ({ name }) => {
    const rt = window.rt; const w = rt.windowInstances.get('w_guestregistration');
    const find = (o, n) => { if (o.name === n) return o; for (const c of o.children.values()) { const r = find(c, n); if (r) return r } return null };
    const d = find(w, 'dw_detail');
    if (!d.model.rowCount()) await d.pbCall('insertrow', [0], rt);
    const values = {
      name, nic: 'PARITY-REG-' + String(Date.now()).slice(-6), gender: 'M', active: 'Y', custcode: 22, regno: '',
      fhname: 'PARITY FATHER', address: 'PARITY REG ADDRESS', mobile: '03000000000', phone: '000000000',
      email: 'parity.reg@example.test', profession: 'TEST', nationality: 'PAKISTANI', passport: 'PARITY-REG-PASS', reference: 'PARITY REF',
    };
    const bad = [];
    for (const [k, v] of Object.entries(values)) { try { await d.pbCall('setitem', [1, k, v], rt) } catch { bad.push(k) } }
    await d.pbCall('setrow', [1], rt).catch(() => {});
    d.model.acceptText = async () => 1;
    return { bad, rows: d.model.rowCount(), values: d.model.buf.primary[0]?.v };
  }, { name: NAME });
  out.click = await page.evaluate(async () => {
    const rt = window.rt; const w = rt.windowInstances.get('w_guestregistration');
    const find = (o, n) => { if (o.name === n) return o; for (const c of o.children.values()) { const r = find(c, n); if (r) return r } return null };
    const ok = find(w, 'cb_ok'); if (!ok) return { error: 'cb_ok not found' };
    void rt.fire(ok, 'clicked').catch(() => {});
    return { fired: true };
  });
  await poll(16);
  out.formClosed = await page.evaluate(() => !window.rt.windowInstances.get('w_guestregistration'));
  out.afterAdd = {
    row: rows(`select guestcode,regno,name,active,custcode,usercode,gender,nic from dbo.guest where name='${NAME}'`)[0] ?? null,
    tab: rows("select tabmaxkey from dbo._tabmaxkey where tabname='Guest'")[0]?.[0] ?? null,
    serverDate: rows('select lasttransdate::text from dbo.serverdate')[0]?.[0] ?? null,
  };
  out.code = out.afterAdd.row?.[0] ?? null;
  out.addOk = !!out.code && out.afterAdd.row?.[2] === NAME && out.afterAdd.row?.[1] === out.code
    && out.afterAdd.row?.[4] === '22' && out.afterAdd.tab === out.code
    && out.afterAdd.serverDate !== out.baseline.serverDate;
  restore();
  out.final = counts();
  out.final.residue = rows(`select count(*) from dbo.guest where name='${NAME}'`)[0]?.[0] ?? null;
  out.baselineOk = out.final.guests === out.baseline.guests && out.final.guestMax === out.baseline.guestMax
    && out.final.tab === out.baseline.tab && out.final.serverDate === out.baseline.serverDate
    && out.final.audit === out.baseline.audit && out.final.auditMax === out.baseline.auditMax
    && out.final.residue === '0';
  out.ok = !!out.addOk && out.baselineOk;
} catch (e) { out.fatal = String(e.stack || e).slice(0, 2500); }
finally {
  restore();
  console.log(JSON.stringify(out, (k, v) => (typeof v === 'bigint' ? Number(v) : v), 1));
  await browser.close().catch(() => {});
}
