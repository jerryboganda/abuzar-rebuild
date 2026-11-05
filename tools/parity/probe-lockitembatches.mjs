// Lock Item Batches: select item 9801, lock its batch, save, verify, then
// unlock through the same form and verify the baseline value.
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const require = createRequire(process.env.PLAYWRIGHT_MODULES || 'C:/Users/Admin/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/');
const { chromium } = require('playwright');
const PSQL = 'C:\\PostgreSQL\\17\\bin\\psql.exe';
const q = (sql) => execFileSync(PSQL, ['-U', 'postgres', '-h', '127.0.0.1', '-d', 'trader_write_test', '-t', '-A', '-F', '|', '-c', sql], { env: { ...process.env, PGPASSWORD: 'postgres' }, encoding: 'utf8', windowsHide: true }).trim();
const rows = (sql) => q(sql).split(/\r?\n/).filter(Boolean).map((l) => l.split('|'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ITEM = Number(process.env.ITEM || 9801);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const out = { item: ITEM, messages: [], errors: [], net: [] };
page.on('pageerror', (e) => out.errors.push(String(e.message || e).slice(0, 400)));
page.on('request', (r) => { if (r.url().includes('/api/exec')) out.net.push({ p: 'req', body: String(r.postData() || '') }) });
page.on('response', async (r) => { if (r.url().includes('/api/exec')) { let b = ''; try { b = await r.text() } catch {} out.net.push({ p: 'res', status: r.status(), body: String(b).slice(0, 400) }) } });
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
try {
  out.before = rows(`select gcode,icode,batch,locked,lockreasoncode from dbo.godowndetail where icode=${ITEM}`);
  await page.goto('http://127.0.0.1:5177/?app=1&autologin=ADMIN:password9080', { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.rt && window.rt.windowInstances.get('w_main') && typeof window.__menu === 'function', null, { timeout: 90000, polling: 300 });
  await page.evaluate(() => { void window.__menu('Maintenance | Lock Item Batches') });
  await page.waitForFunction(() => window.rt.windowInstances.get('w_lockitembatches_form'), null, { timeout: 40000, polling: 300 });
  await sleep(1600); await poll(2);
  await page.evaluate(() => { const rt = window.rt; const w = rt.windowInstances.get('w_lockitembatches_form'); void w.pbCall('ue_list', [], rt).catch(() => {}) });
  for (let i = 0; i < 30; i++) { await sleep(500); const n = await page.evaluate(() => window.rt.windowInstances.get('w_lockitembatches_form')?.props.get('id_list')?.model?.rowCount?.() ?? 0); if (n > 0) { out.listRows = n; break; } await poll(1); }
  out.pick = await page.evaluate(async (item) => {
    const rt = window.rt; const w = rt.windowInstances.get('w_lockitembatches_form');
    const l = w.props.get('id_list'); const m = l.model;
    const ci = m.colIndex('code') >= 0 ? m.colIndex('code') : (m.colIndex('icode') >= 0 ? m.colIndex('icode') : 0);
    const hit = [...m.buf.primary.entries()].find(([, r]) => Number(r.v[ci]) === item);
    if (!hit) return { error: 'item not in list', rows: m.rowCount(), cols: m.colNames };
    w.props.set('id_dwcontrol', l); w.props.set('il_selectedrow', hit[0] + 1);
    void w.pbCall('ue_detail', [], rt).catch(() => {});
    await new Promise((r) => setTimeout(r, 2000));
    const d = w.props.get('id_detail')?.model;
    return { row: hit[0] + 1, listRows: m.rowCount(), detailRows: d?.rowCount(), detailCols: d?.colNames };
  }, ITEM);
  await poll(2);
  const setLock = async (value) => await page.evaluate(async (v) => {
    const rt = window.rt; const w = rt.windowInstances.get('w_lockitembatches_form'); const d = w.props.get('id_detail');
    if (!d.model.rowCount()) return 'no detail';
    const row = 1;
    await d.pbCall('setitem', [row, 'locked', v], rt);
    await d.pbCall('setitem', [row, 'lockreasoncode', 1], rt);
    await d.pbCall('accepttext', [], rt);
    await d.pbCall('setrow', [row], rt).catch(() => {});
    w.props.set('il_currrow', row); w.props.set('ib_itemvalidated', true);
    window.__saveDone = false;
    w.pbCall('ue_save', [], rt).then((x) => { window.__saveDone = String(x) }).catch((e) => { window.__saveDone = 'ERR ' + String(e.message || e).slice(0, 200) });
    return { locked: String(await d.pbCall('getitemstring', [row, 'locked'], rt)) };
  }, value);
  out.lock = await setLock('Y');
  await poll(10);
  out.afterLock = rows(`select gcode,icode,batch,locked,lockreasoncode from dbo.godowndetail where icode=${ITEM}`);
  out.lockOk = out.afterLock?.[0]?.[3] === 'Y';
  out.sql = out.net.filter((x) => String(x.body).toLowerCase().includes('godowndetail') && String(x.body).toLowerCase().includes('locked')).slice(0, 2);
  out.unlock = await setLock('N');
  await poll(10);
  out.afterUnlock = rows(`select gcode,icode,batch,locked,lockreasoncode from dbo.godowndetail where icode=${ITEM}`);
  out.unlockOk = out.afterUnlock?.[0]?.[3] === 'N';
  if (!out.unlockOk) q(`update dbo.godowndetail set locked='N', lockreasoncode=1 where icode=${ITEM}`);
  out.final = rows(`select gcode,icode,batch,locked,lockreasoncode from dbo.godowndetail where icode=${ITEM}`);
  out.baselineOk = JSON.stringify(out.final) === JSON.stringify(out.before);
  out.ok = out.lockOk && out.unlockOk && out.baselineOk;
} catch (e) { out.fatal = String(e.stack || e).slice(0, 1600); }
finally { console.log(JSON.stringify(out, (k, v) => (typeof v === 'bigint' ? Number(v) : v), 1)); await browser.close().catch(() => {}); }
