// Modify Last Transaction Date: set 04/11/2026 through the form, verify
// serverdate.lasttransdate, then restore the exact captured baseline.
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const require = createRequire(process.env.PLAYWRIGHT_MODULES || 'C:/Users/Admin/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/');
const { chromium } = require('playwright');
const PSQL = 'C:\\PostgreSQL\\17\\bin\\psql.exe';
const q = (sql) => execFileSync(PSQL, ['-U', 'postgres', '-h', '127.0.0.1', '-d', 'trader_write_test', '-t', '-A', '-F', '|', '-c', sql], { env: { ...process.env, PGPASSWORD: 'postgres' }, encoding: 'utf8', windowsHide: true }).trim();
const rows = (sql) => q(sql).split(/\r?\n/).filter(Boolean).map((l) => l.split('|'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const NEW = '04/11/2026 00:00:00';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const out = { messages: [], errors: [], target: NEW };
page.on('pageerror', (e) => out.errors.push(String(e.message || e).slice(0, 400)));
async function poll(seconds = 6) {
  for (let i = 0; i < seconds * 2; i++) {
    await sleep(500);
    const msgs = await page.evaluate(() => [...document.querySelectorAll('.msgbox .txt')].map((e) => e.textContent.replace(/\s+/g, ' ').trim().slice(0, 240)));
    if (msgs.length) {
      out.messages.push(...msgs);
      await page.evaluate(() => { for (const b of document.querySelectorAll('.msgbox')) { const bs = [...b.querySelectorAll('.btns button')]; (bs.find((x) => /^(ok|yes)$/i.test(x.textContent.trim())) || bs[0])?.click(); } });
      await sleep(250);
    }
  }
}
try {
  out.before = rows('select lasttransdate from dbo.serverdate');
  await page.goto('http://127.0.0.1:5177/?app=1&autologin=ADMIN:password9080', { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.rt && window.rt.windowInstances.get('w_main') && typeof window.__menu === 'function', null, { timeout: 90000, polling: 300 });
  await page.evaluate(() => { void window.__menu('Maintenance | Modify Last Transaction Date') });
  await page.waitForFunction(() => window.rt.windowInstances.get('w_set_lasttransdate'), null, { timeout: 30000, polling: 300 });
  await sleep(800);
  out.open = await page.evaluate(() => {
    const rt = window.rt; const w = rt.windowInstances.get('w_set_lasttransdate');
    const em = w.children.get('em_date');
    return { title: String(w.props.get('title') ?? ''), children: [...w.children.keys()], text: em ? String(em.props.get('text')) : null };
  });
  out.set = await page.evaluate(async (v) => {
    const rt = window.rt; const w = rt.windowInstances.get('w_set_lasttransdate');
    const em = w.children.get('em_date');
    if (!em) return 'no em_date';
    const { PBDateTime } = await import('/src/runtime/values.ts');
    em.pbSet('text', v);
    await new Promise((r) => setTimeout(r, 200));
    const cb = w.children.get('cb_ok');
    if (cb) void rt.fire(cb, 'clicked').catch(() => {});
    return String(em.props.get('text'));
  }, NEW);
  await poll(8);
  out.after = rows('select lasttransdate from dbo.serverdate');
  out.saved = out.after?.[0]?.[0]?.startsWith('2026-11-04');
  if (out.before?.[0]?.[0]) q(`update dbo.serverdate set lasttransdate='${out.before[0][0].replace(/'/g, "''")}'`);
  out.restored = rows('select lasttransdate from dbo.serverdate');
  out.restoredOk = out.restored?.[0]?.[0] === out.before?.[0]?.[0];
  out.ok = out.saved && out.restoredOk;
} catch (e) { out.fatal = String(e.stack || e).slice(0, 1600); }
finally { console.log(JSON.stringify(out, (k, v) => (typeof v === 'bigint' ? Number(v) : v), 1)); await browser.close().catch(() => {}); }
