// Inplace Initialization full cycle on a disposable copy of the clone.
// Chooses "Inplace Initialization", passes the random key gate, keeps the
// default Transfer Item Stock / Transfer Acc. Balances checkboxes, confirms
// the warning, and records before/after counts. The database is dropped by
// the caller afterwards, so no restore is needed here.
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const require = createRequire(process.env.PLAYWRIGHT_MODULES || 'C:/Users/Admin/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/');
const { chromium } = require('playwright');
const DB = process.env.DB || 'trader_init_test';
const TRANSFER = process.env.TRANSFER !== '0';
const PSQL = 'C:\\PostgreSQL\\17\\bin\\psql.exe';
const q = (sql) => execFileSync(PSQL, ['-U', 'postgres', '-h', '127.0.0.1', '-d', DB, '-t', '-A', '-F', '|', '-c', sql], { env: { ...process.env, PGPASSWORD: 'postgres' }, encoding: 'utf8', windowsHide: true }).trim();
const rows = (sql) => q(sql).split(/\r?\n/).filter(Boolean).map((l) => l.split('|'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TABLES = ['saleledger', 'saledetail', 'srledger', 'srdetail', 'purledger', 'purdetail', 'prledger', 'prdetail', 'glheader', 'gldetail', 'itemlog', 'stockledger', 'godowndetail', 'itembatches', 'previoussalehistory', 'eventlog'];
const counts = () => Object.fromEntries(rows(TABLES.map((t) => `select '${t}', count(*) from dbo.${t}`).join(' union all ')).map(([t, n]) => [t, Number(n)]));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const out = { db: DB, messages: [], errors: [] };
page.on('pageerror', (e) => out.errors.push(String(e.message || e).slice(0, 400)));
async function poll(seconds = 10) {
  for (let i = 0; i < seconds * 2; i++) {
    await sleep(500);
    const msgs = await page.evaluate(() => [...document.querySelectorAll('.msgbox .txt')].map((e) => e.textContent.replace(/\s+/g, ' ').trim().slice(0, 300)));
    if (msgs.length) {
      out.messages.push(...msgs);
      await page.evaluate(() => { for (const b of document.querySelectorAll('.msgbox')) { const bs = [...b.querySelectorAll('.btns button')]; (bs.find((x) => /^(yes|ok)$/i.test(x.textContent.trim())) || bs[0])?.click(); } });
      await sleep(250);
    }
  }
}
try {
  out.before = counts();
  out.beforeUtn = rows('select utn from dbo._utn')[0]?.[0] ?? null;
  out.beforeTab = rows("select tabmaxkey from dbo._tabmaxkey where tabname='SaleLedger'")[0]?.[0] ?? null;
  await page.goto('http://127.0.0.1:5177/?app=1&autologin=ADMIN:password9080', { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.rt && window.rt.windowInstances.get('w_main') && typeof window.__menu === 'function', null, { timeout: 90000, polling: 300 });
  await page.evaluate(() => { void window.__menu('Maintenance | Inplace Initialization') });
  await page.waitForFunction(() => window.rt.windowInstances.get('w_select_initialization_type'), null, { timeout: 30000, polling: 300 });
  await sleep(700);
  out.formatWindow = await page.evaluate(() => {
    const rt = window.rt; const w = rt.windowInstances.get('w_select_initialization_type');
    return { title: String(w.props.get('title') ?? ''), radios: [...w.children.values()].filter((c) => c.native === 'radiobutton').map((c) => ({ n: c.name, text: String(c.props.get('text') ?? ''), checked: c.props.get('checked') })) };
  });
  await page.evaluate(async () => {
    const rt = window.rt; const w = rt.windowInstances.get('w_select_initialization_type');
    w.children.get('rb_format1').props.set('checked', false);
    w.children.get('rb_format2').props.set('checked', true);
    void rt.fire(w.children.get('cb_ok'), 'clicked').catch(() => {});
  });
  await page.waitForFunction(() => window.rt.windowInstances.get('w_initialization_key'), null, { timeout: 30000, polling: 300 });
  await sleep(900); await poll(2);
  out.keyWindow = await page.evaluate(() => {
    const rt = window.rt; const w = rt.windowInstances.get('w_initialization_key');
    const em = w.children.get('em_statuscode');
    return { title: String(w.props.get('title') ?? ''), statuscode: String(em?.props.get('text') ?? ''), localdb: w.children.get('cbx_localdb')?.props.get('checked') };
  });
  out.key = await page.evaluate(async () => {
    const rt = window.rt; const w = rt.windowInstances.get('w_initialization_key');
    const status = Number(String(w.children.get('em_statuscode')?.props.get('text') ?? ''));
    if (!Number.isFinite(status)) return { error: 'no status code' };
    const d = status % 2 === 0 ? 22 : 21;
    const key = status + d;
    w.children.get('cbx_localdb').props.set('checked', false);
    w.children.get('sle_key').pbSet('text', String(key));
    void rt.fire(w.children.get('cb_ok'), 'clicked').catch(() => {});
    return { status, key, diff: key - status };
  });
  await page.waitForFunction(() => window.rt.windowInstances.get('w_inplace_initialization'), null, { timeout: 30000, polling: 300 });
  await sleep(1200); await poll(2);
  out.inplaceWindow = await page.evaluate(() => {
    const rt = window.rt; const w = rt.windowInstances.get('w_inplace_initialization');
    return { title: String(w.props.get('title') ?? ''), boxes: [...w.children.values()].filter((c) => c.native === 'checkbox').map((c) => ({ n: c.name, text: String(c.props.get('text') ?? ''), checked: c.props.get('checked') })) };
  });
  out.fire = await page.evaluate(async (transfer) => {
    const rt = window.rt; const w = rt.windowInstances.get('w_inplace_initialization');
    w.children.get('cbx_transferstock').props.set('checked', transfer);
    w.children.get('cbx_accountsbalances').props.set('checked', transfer);
    w.children.get('cbx_loyaltypoints').props.set('checked', false);
    window.__inplaceDone = false;
    void rt.fire(w.children.get('cb_ok'), 'clicked').then(() => { window.__inplaceDone = 'ok' }).catch((e) => { window.__inplaceDone = 'ERR ' + String(e.message || e).slice(0, 500) });
    return 'fired';
  }, TRANSFER);
  for (let i = 0; i < 600; i++) {
    await sleep(500);
    await poll(1);
    const done = await page.evaluate(() => window.__inplaceDone);
    const windowOpen = await page.evaluate(() => !!window.rt.windowInstances.get('w_inplace_initialization'));
    if (done && done !== false) { out.done = done; break; }
    if (!windowOpen && i > 4) { out.done = 'closed'; break; }
  }
  out.done = out.done ?? await page.evaluate(() => window.__inplaceDone);
  await poll(3);
  out.after = counts();
  out.afterUtn = rows('select utn from dbo._utn')[0]?.[0] ?? null;
  out.afterTab = rows("select tabmaxkey from dbo._tabmaxkey where tabname='SaleLedger'")[0]?.[0] ?? null;
  out.eventlog = rows("select count(*) from dbo.eventlog where module='Inplace Initialization' and detail='Inplace Initialization Performed.'");
  out.successMessage = out.messages.some((m) => /completed Successfully/i.test(m));
  out.ok = out.successMessage && out.done === 'ok';
} catch (e) { out.fatal = String(e.stack || e).slice(0, 2000); }
finally { console.log(JSON.stringify(out, (k, v) => (typeof v === 'bigint' ? Number(v) : v), 1)); await browser.close().catch(() => {}); }
