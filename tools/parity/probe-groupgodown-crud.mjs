// Group Wise Godown Setting on group 2:
//  - open w_groupwisegodownsetting with parm 2 (opensheetwithparm)
//  - uncheck the only sale godown (gcode 1), save, verify GroupAllowedGodown
//  - reopen, check it again, save, verify the full baseline snapshot
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const require = createRequire(process.env.PLAYWRIGHT_MODULES || 'C:/Users/Admin/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/');
const { chromium } = require('playwright');
const PSQL = 'C:\\PostgreSQL\\17\\bin\\psql.exe';
const q = (sql) => execFileSync(PSQL, ['-U', 'postgres', '-h', '127.0.0.1', '-d', 'trader_write_test', '-t', '-A', '-F', '|', '-c', sql], { env: { ...process.env, PGPASSWORD: 'postgres' }, encoding: 'utf8', windowsHide: true }).trim();
const rows = (sql) => q(sql).split(/\r?\n/).filter(Boolean).map((l) => l.split('|'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const GROUP = Number(process.env.GROUP || 2);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const out = { group: GROUP, messages: [], errors: [], net: [] };
page.on('pageerror', (e) => out.errors.push(String(e.message || e).slice(0, 400)));
page.on('request', (r) => { if (r.url().includes('/api/exec')) out.net.push({ p: 'req', body: String(r.postData() || '') }) });
page.on('response', async (r) => { if (r.url().includes('/api/exec')) { let b = ''; try { b = await r.text() } catch {} out.net.push({ p: 'res', status: r.status(), body: String(b).slice(0, 500) }) } });
async function poll(seconds = 8) {
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
const openSheet = async () => await page.evaluate(async (g) => {
  const rt = window.rt;
  const { Ref } = await import('/src/runtime/interp.ts');
  let win = null;
  const ref = new Ref(() => win, (v) => { win = v });
  ref.name = 'w_groupwisegodownsetting';
  const parent = rt.windowInstances.get('w_main');
  await rt.sys.get('opensheetwithparm').fn(rt, [ref, g, parent, 0, 0], undefined);
  return { opened: !!rt.windowInstances.get('w_groupwisegodownsetting') };
}, GROUP);
try {
  out.baseline = rows('select groupcode,module,gcode,priority from dbo.groupallowedgodown order by groupcode,module,gcode');
  out.count = out.baseline.length;
  await page.goto('http://127.0.0.1:5177/?app=1&autologin=ADMIN:password9080', { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.rt && window.rt.windowInstances.get('w_main') && typeof window.__menu === 'function', null, { timeout: 90000, polling: 300 });
  out.open = await openSheet();
  await page.waitForFunction(() => window.rt.windowInstances.get('w_groupwisegodownsetting'), null, { timeout: 30000, polling: 300 });
  await sleep(1800); await poll(2);
  out.state = await page.evaluate((g) => {
    const rt = window.rt; const w = rt.windowInstances.get('w_groupwisegodownsetting');
    const gi = w.children.get('dw_groupinfo') || w.props.get('dw_groupinfo');
    const grid = w.children.get('dw_groupallowedgodown_sale') || w.props.get('dw_groupallowedgodown_sale');
    return { title: String(w.props.get('title') ?? ''), groupcode: gi?.model ? String(gi.model.buf.primary[0]?.v[gi.model.colIndex('code')]) : null, saleRows: grid?.model?.rowCount?.(), saleCols: grid?.model?.colNames, saleFirst: grid?.model?.buf.primary?.[0]?.v, children: [...w.children.keys()] };
  }, GROUP);
  out.toggleOff = await page.evaluate(async () => {
    const rt = window.rt; const w = rt.windowInstances.get('w_groupwisegodownsetting');
    const grid = w.children.get('dw_groupallowedgodown_sale') || w.props.get('dw_groupallowedgodown_sale');
    const m = grid.model; const ci = m.colIndex('allowed'); const gi = m.colIndex('gcode');
    let row = 0;
    for (const [i, r] of m.buf.primary.entries()) if (Number(r.v[gi]) === 1) { row = i + 1; break }
    if (!row) return { error: 'sale godown row not found', rows: m.rowCount(), cols: m.colNames };
    await grid.pbCall('setitem', [row, 'allowed', 0], rt);
    await grid.pbCall('accepttext', [], rt).catch(() => {});
    const cb = w.children.get('cb_save');
    if (cb) await rt.fire(cb, 'clicked').catch(() => {});
    await new Promise((r) => setTimeout(r, 1200));
    return { row, allowed: String(await grid.pbCall('getitemstring', [row, 'allowed'], rt)), closed: !rt.windowInstances.get('w_groupwisegodownsetting') };
  });
  await poll(12);
  out.afterOff = rows(`select groupcode,module,gcode,priority from dbo.groupallowedgodown where groupcode=${GROUP} and module=1 order by gcode`);
  out.offOk = out.afterOff.length === 0;
  // reopen and restore
  if (!(await page.evaluate(() => !!window.rt.windowInstances.get('w_groupwisegodownsetting')))) await openSheet();
  await page.waitForFunction(() => window.rt.windowInstances.get('w_groupwisegodownsetting'), null, { timeout: 30000, polling: 300 });
  await sleep(1600); await poll(2);
  out.toggleOn = await page.evaluate(async () => {
    const rt = window.rt; const w = rt.windowInstances.get('w_groupwisegodownsetting');
    const grid = w.children.get('dw_groupallowedgodown_sale') || w.props.get('dw_groupallowedgodown_sale');
    const m = grid.model; const ci = m.colIndex('allowed'); const gi = m.colIndex('gcode');
    let row = 0;
    for (const [i, r] of m.buf.primary.entries()) if (Number(r.v[gi]) === 1) { row = i + 1; break }
    if (!row) return { error: 'sale godown row not found', rows: m.rowCount() };
    await grid.pbCall('setitem', [row, 'allowed', 1], rt);
    await grid.pbCall('accepttext', [], rt).catch(() => {});
    const cb = w.children.get('cb_save');
    if (cb) await rt.fire(cb, 'clicked').catch(() => {});
    await new Promise((r) => setTimeout(r, 1200));
    return { row, allowed: String(await grid.pbCall('getitemstring', [row, 'allowed'], rt)), closed: !rt.windowInstances.get('w_groupwisegodownsetting') };
  });
  await poll(12);
  out.afterOn = rows('select groupcode,module,gcode,priority from dbo.groupallowedgodown order by groupcode,module,gcode');
  out.baselineOk = JSON.stringify(out.afterOn) === JSON.stringify(out.baseline);
  out.sql = out.net.filter((x) => String(x.body).toLowerCase().includes('groupallowedgodown')).slice(0, 6);
  if (!out.baselineOk) {
    q(`delete from dbo.groupallowedgodown where groupcode=${GROUP}`);
    for (const [g, mo, gc, p] of out.baseline.filter((r) => Number(r[0]) === GROUP)) q(`insert into dbo.groupallowedgodown (groupcode,module,gcode,priority) values (${g},${mo},${gc},${p}) on conflict do nothing`);
    out.sqlRestored = true;
  }
  out.final = rows('select groupcode,module,gcode,priority from dbo.groupallowedgodown order by groupcode,module,gcode');
  out.finalOk = JSON.stringify(out.final) === JSON.stringify(out.baseline);
  out.ok = !!out.offOk && out.baselineOk && out.finalOk;
} catch (e) { out.fatal = String(e.stack || e).slice(0, 1800); }
finally { console.log(JSON.stringify(out, (k, v) => (typeof v === 'bigint' ? Number(v) : v), 1)); await browser.close().catch(() => {}); }
