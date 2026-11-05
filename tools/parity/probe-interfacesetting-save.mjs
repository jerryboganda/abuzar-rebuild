// Interface Setting: press OK with no changes, then change one row and save.
// Verifies the many-DataWindow update chain and the interfacesetting table.
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const require = createRequire(process.env.PLAYWRIGHT_MODULES || 'C:/Users/Admin/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/');
const { chromium } = require('playwright');
const PSQL = 'C:\\PostgreSQL\\17\\bin\\psql.exe';
const q = (sql) => execFileSync(PSQL, ['-U', 'postgres', '-h', '127.0.0.1', '-d', 'trader_write_test', '-t', '-A', '-F', '|', '-c', sql], { env: { ...process.env, PGPASSWORD: 'postgres' }, encoding: 'utf8', windowsHide: true }).trim();
const rows = (sql) => q(sql).split(/\r?\n/).filter(Boolean).map((l) => l.split('|'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const out = { messages: [], errors: [], net: [] };
page.on('pageerror', (e) => out.errors.push(String(e.message || e).slice(0, 400)));
page.on('request', (r) => { if (r.url().includes('/api/exec')) out.net.push({ p: 'req', body: String(r.postData() || '') }) });
page.on('response', async (r) => { if (r.url().includes('/api/exec')) { let b = ''; try { b = await r.text() } catch {} out.net.push({ p: 'res', status: r.status(), body: String(b).slice(0, 400) }) } });
async function poll(seconds = 8) {
  for (let i = 0; i < seconds * 2; i++) {
    await sleep(500);
    const msgs = await page.evaluate(() => [...document.querySelectorAll('.msgbox .txt')].map((e) => e.textContent.replace(/\s+/g, ' ').trim().slice(0, 240)));
    if (msgs.length) {
      out.messages.push(...msgs);
      await page.evaluate(() => { for (const b of document.querySelectorAll('.msgbox')) { const bs = [...b.querySelectorAll('.btns button')]; const pick = bs.find((x) => /^(yes|ok)$/i.test(x.textContent.trim())) || bs.find((x) => /^(no|cancel|close)$/i.test(x.textContent.trim())) || bs[0]; pick?.click(); } });
      await sleep(250);
    }
  }
}
async function openScreen() {
  await page.evaluate(() => { void window.__menu('Maintenance | Interface Setting') });
  await page.waitForFunction(() => window.rt.windowInstances.get('w_interfacesetting'), null, { timeout: 40000, polling: 300 });
  await sleep(2000); await poll(2);
}
try {
  out.before = rows(`select moduleid,sequenceid,colname,visibility from dbo.interfacesetting where moduleid=1 and sequenceid=17 and colname='authorcode'`);
  out.count = Number(rows('select count(*) from dbo.interfacesetting')[0][0]);
  await page.goto('http://127.0.0.1:5177/?app=1&autologin=ADMIN:password9080', { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.rt && window.rt.windowInstances.get('w_main') && typeof window.__menu === 'function', null, { timeout: 90000, polling: 300 });
  await openScreen();
  out.open = await page.evaluate(() => {
    const rt = window.rt; const w = rt.windowInstances.get('w_interfacesetting');
    const names = [...w.children.keys()];
    const d = w.children.get('dw_itemsetting');
    const m = d?.model;
    return { title: String(w.props.get('title') ?? ''), children: names, rows: m?.rowCount(), cols: m?.colNames, do: d?.props.get('dataobject'), cbOk: !!w.children.get('cb_ok') };
  });
  // 1) no-change OK
  out.noChange = await page.evaluate(async () => {
    const rt = window.rt; const w = rt.windowInstances.get('w_interfacesetting'); const cb = w.children.get('cb_ok');
    if (!cb) return 'no cb_ok';
    void rt.fire(cb, 'clicked').catch(() => {});
    return 'fired';
  });
  await poll(10);
  out.afterNoChangeOpen = await page.evaluate(() => !!window.rt.windowInstances.get('w_interfacesetting'));
  // 2) change visibility of the authorcode row (the grids live inside tab pages)
  if (!out.afterNoChangeOpen) await openScreen();
  out.change = await page.evaluate(async () => {
    const rt = window.rt; const w = rt.windowInstances.get('w_interfacesetting');
    const dws = [];
    const collect = (o) => { for (const c of o.children.values()) { if (c.native === 'datawindow' && c.model) dws.push(c); collect(c) } };
    collect(w);
    for (const d of dws) {
      const m = d.model; const ni = m.colIndex('colname');
      if (ni < 0) continue;
      let row = 0;
      for (const [i, r] of m.buf.primary.entries()) if (String(r.v[ni]) === 'authorcode') { row = i + 1; break }
      if (!row) continue;
      const vi = m.colIndex('visibility');
      const oldValue = Number(m.buf.primary[row - 1].v[vi]);
      const value = oldValue === 1 ? 0 : 1;
      await d.pbCall('setitem', [row, 'visibility', value], rt);
      await d.pbCall('accepttext', [], rt);
      const cb = w.children.get('cb_ok');
      void rt.fire(cb, 'clicked').catch(() => {});
      return { row, value, oldValue, dw: d.name, rows: m.rowCount(), moduleid: String(m.buf.primary[row - 1].v[m.colIndex('moduleid')]) };
    }
    return { error: 'authorcode not in any interface grid', dws: dws.map((d) => ({ name: d.name, rows: d.model.rowCount(), cols: d.model.colNames })) };
  });
  await poll(12);
  out.after = rows(`select moduleid,sequenceid,colname,visibility from dbo.interfacesetting where moduleid=1 and sequenceid=17 and colname='authorcode'`);
  out.saved = out.after?.[0]?.[3] !== out.before?.[0]?.[3];
  // restore the original value directly
  if (out.saved && out.before?.[0]) q(`update dbo.interfacesetting set visibility=${Number(out.before[0][3])} where moduleid=1 and sequenceid=17 and colname='authorcode'`);
  out.restored = rows(`select moduleid,sequenceid,colname,visibility from dbo.interfacesetting where moduleid=1 and sequenceid=17 and colname='authorcode'`);
  out.finalCount = Number(rows('select count(*) from dbo.interfacesetting')[0][0]);
  out.sql = out.net.filter((x) => String(x.body).toLowerCase().includes('interfacesetting')).slice(0, 4);
  out.ok = out.saved && out.finalCount === out.count;
} catch (e) { out.fatal = String(e.stack || e).slice(0, 1600); }
finally { console.log(JSON.stringify(out, (k, v) => (typeof v === 'bigint' ? Number(v) : v), 1)); await browser.close().catch(() => {}); }
