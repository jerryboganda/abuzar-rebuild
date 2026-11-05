// Change Password: wrong old password, then a real change and restore.
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const require = createRequire(process.env.PLAYWRIGHT_MODULES || 'C:/Users/Admin/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/');
const { chromium } = require('playwright');
const PSQL = 'C:\\PostgreSQL\\17\\bin\\psql.exe';
const q = (sql) => execFileSync(PSQL, ['-U', 'postgres', '-h', '127.0.0.1', '-d', 'trader_write_test', '-t', '-A', '-F', '|', '-c', sql], { env: { ...process.env, PGPASSWORD: 'postgres' }, encoding: 'utf8', windowsHide: true }).trim();
const rows = (sql) => q(sql).split(/\r?\n/).filter(Boolean).map((l) => l.split('|'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OLD = 'password9080';
const NEW = 'parity9080';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const out = { messages: [], errors: [] };
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
async function openForm() {
  await page.evaluate(() => { void window.__menu('Maintenance | Change Password') });
  await page.waitForFunction(() => window.rt.windowInstances.get('w_changepassword'), null, { timeout: 30000, polling: 300 });
  await sleep(600);
}
async function submit({ user, oldp, new1, new2 }) {
  return await page.evaluate(async (v) => {
    const rt = window.rt; const w = rt.windowInstances.get('w_changepassword');
    if (!w) return 'no window';
    const set = (n, x) => { const c = w.children.get(n); if (c) { c.pbSet('text', x); return true } return false };
    const ok = [set('sle_salesman', v.user), set('sle_oldpassword', v.oldp), set('sle_newpassword1', v.new1), set('sle_newpassword2', v.new2)];
    const cb = w.children.get('cb_ok');
    if (cb) void rt.fire(cb, 'clicked').catch(() => {});
    return ok;
  }, { user, oldp, new1, new2 });
}
try {
  out.before = rows(`select usercode,username,password from dbo.users where usercode=1`);
  await page.goto('http://127.0.0.1:5177/?app=1&autologin=ADMIN:' + OLD, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.rt && window.rt.windowInstances.get('w_main') && typeof window.__menu === 'function', null, { timeout: 90000, polling: 300 });
  // wrong old password must be rejected
  await openForm();
  out.wrong = await submit({ user: 'ADMIN', oldp: 'wrongpass', new1: NEW, new2: NEW });
  await poll(6);
  out.afterWrong = rows(`select password from dbo.users where usercode=1`);
  out.wrongRejected = out.afterWrong?.[0]?.[0] === OLD;
  const still = await page.evaluate(() => !!window.rt.windowInstances.get('w_changepassword'));
  if (!still) { await openForm(); }
  // real change
  out.change = await submit({ user: 'ADMIN', oldp: OLD, new1: NEW, new2: NEW });
  await poll(10);
  out.afterChange = rows(`select password from dbo.users where usercode=1`);
  out.changed = out.afterChange?.[0]?.[0] === NEW;
  // restore through the form
  if (!(await page.evaluate(() => !!window.rt.windowInstances.get('w_changepassword')))) await openForm();
  out.restore = await submit({ user: 'ADMIN', oldp: NEW, new1: OLD, new2: OLD });
  await poll(10);
  out.afterRestore = rows(`select password from dbo.users where usercode=1`);
  out.restored = out.afterRestore?.[0]?.[0] === OLD;
  out.ok = out.wrongRejected && out.changed && out.restored;
} catch (e) { out.fatal = String(e.stack || e).slice(0, 1600); }
finally {
  if (!out.restored) q(`update dbo.users set password='${OLD}' where usercode=1`);
  out.final = rows(`select usercode,username,password from dbo.users where usercode=1`);
  console.log(JSON.stringify(out, (k, v) => (typeof v === 'bigint' ? Number(v) : v), 1));
  await browser.close().catch(() => {});
}
