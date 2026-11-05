// Users (Manage | Users) add/edit/save cycle with group detail.
// File | Delete is expected to be inert (no ue_delete in the original), so
// cleanup removes only the created user/groups rows.
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const require = createRequire(process.env.PLAYWRIGHT_MODULES || 'C:/Users/Admin/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/');
const { chromium } = require('playwright');
const PSQL = 'C:\\PostgreSQL\\17\\bin\\psql.exe';
const q = (sql) => execFileSync(PSQL, ['-U', 'postgres', '-h', '127.0.0.1', '-d', 'trader_write_test', '-t', '-A', '-F', '|', '-c', sql], { env: { ...process.env, PGPASSWORD: 'postgres' }, encoding: 'utf8', windowsHide: true }).trim();
const rows = (sql) => q(sql).split(/\r?\n/).filter(Boolean).map((l) => l.split('|'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const NAME = 'PARITY USER ' + String(Date.now()).slice(-6);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const out = { name: NAME, messages: [], errors: [] };
page.on('pageerror', (e) => out.errors.push(String(e.message || e).slice(0, 400)));
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
try {
  out.baseline = {
    users: Number(rows('select count(*) from dbo.users')[0][0]),
    groups: Number(rows('select count(*) from dbo.usergroups')[0][0]),
  };
  await page.goto('http://127.0.0.1:5177/?app=1&autologin=ADMIN:password9080', { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.rt && window.rt.windowInstances.get('w_main') && typeof window.__menu === 'function', null, { timeout: 90000, polling: 300 });
  await page.evaluate(() => { void window.__menu('Manage | Users') });
  await page.waitForFunction(() => window.rt.windowInstances.get('w_users'), null, { timeout: 40000, polling: 300 });
  await sleep(1600); await poll(2);
  out.open = await page.evaluate(() => {
    const rt = window.rt; const w = rt.windowInstances.get('w_users');
    const get = (n) => { const d = w.props.get(n); return d?.model ? { rows: d.model.rowCount(), cols: d.model.colNames, do: d.props.get('dataobject') } : null };
    return { title: w.props.get('title'), master: get('id_master'), detail: get('id_detail'), list: get('id_list'), children: [...w.children.keys()] };
  });
  await page.evaluate(() => { const rt = window.rt; const w = rt.windowInstances.get('w_users'); void w.pbCall('ue_newform', [], rt).catch(() => {}) });
  await sleep(1500); await poll(2);
  out.fill = await page.evaluate(async (name) => {
    const rt = window.rt; const w = rt.windowInstances.get('w_users');
    const m = w.props.get('id_master'); const d = w.props.get('id_detail');
    const bad = [];
    const set = async (dw, row, n, v) => { try { await dw.pbCall('setitem', [row, n, v], rt) } catch (e) { bad.push(n + ':' + String(e.message || e).slice(0, 70)) } };
    if (m.model.rowCount() === 0) await m.pbCall('insertrow', [0], rt);
    for (const [n, v] of Object.entries({ username: name, password: 'parity123', confirmpassword: 'parity123', fathername: 'PARITY FATHER', address: 'PARITY ADDRESS', phone: '03000000000', active: 'Y' })) await set(m, 1, n, v);
    if (d.model.rowCount() === 0) await d.pbCall('insertrow', [0], rt);
    const dr = d.model.rowCount();
    await set(d, dr, 'groupcode', 2);
    await m.pbCall('accepttext', [], rt).catch(() => {});
    await d.pbCall('accepttext', [], rt).catch(() => {});
    await d.pbCall('setrow', [dr], rt).catch(() => {});
    w.props.set('il_currrow', dr);
    w.props.set('ib_itemvalidated', true);
    return { bad, masterRows: m.model.rowCount(), detailRows: d.model.rowCount(), masterVals: m.model.buf.primary[0]?.v?.slice(0, 10), detailVals: d.model.buf.primary[dr - 1]?.v };
  }, NAME);
  await poll(2);
  out.save = await page.evaluate(() => { const rt = window.rt; const w = rt.windowInstances.get('w_users'); window.__saveDone = false; w.pbCall('ue_save', [], rt).then((v) => { window.__saveDone = String(v) }).catch((e) => { window.__saveDone = 'ERR ' + String(e.message || e).slice(0, 200) }); return 'fired' });
  await poll(12);
  out.saveDone = await page.evaluate(() => window.__saveDone);
  out.added = rows(`select usercode,username,fathername,address,phone,active from dbo.users where username='${NAME}'`);
  out.code = out.added[0]?.[0] ?? null;
  out.addedGroups = out.code ? rows(`select usercode,groupcode,modifiedby from dbo.usergroups where usercode=${out.code}`) : [];
  out.addOk = !!out.code && out.addedGroups.length === 1 && Number(out.addedGroups[0][1]) === 2;
  if (out.code) {
    out.edit = await page.evaluate(async () => {
      const rt = window.rt; const w = rt.windowInstances.get('w_users'); const m = w.props.get('id_master');
      await m.pbCall('setitem', [1, 'address', 'PARITY ADDRESS EDIT'], rt);
      await m.pbCall('setitem', [1, 'phone', '03111111111'], rt);
      await m.pbCall('accepttext', [], rt);
      window.__saveDone = false;
      w.pbCall('ue_save', [], rt).then((v) => { window.__saveDone = String(v) }).catch((e) => { window.__saveDone = 'ERR ' + String(e.message || e).slice(0, 200) });
      return 'fired';
    });
    await poll(10);
    out.afterEdit = rows(`select usercode,username,address,phone from dbo.users where usercode=${out.code}`);
    out.editOk = out.afterEdit?.[0]?.[2] === 'PARITY ADDRESS EDIT' && out.afterEdit?.[0]?.[3] === '03111111111';
    out.del = await page.evaluate(() => {
      const rt = window.rt; const w = rt.windowInstances.get('w_users');
      const menu = w.props.get('menuid') || w.props.get('im_menu'); let del = null;
      const walk = (o) => { for (const c of o.children.values()) { if (c.name === 'm_delete') del = c; walk(c) } };
      if (menu) walk(menu);
      if (!del) return { found: false };
      void rt.fire(del, 'clicked').catch(() => {});
      return { found: true, enabled: del.props.get('enabled') !== false };
    });
    await poll(8);
    out.afterDelete = rows(`select usercode,username from dbo.users where usercode=${out.code}`);
    out.deleteInert = out.afterDelete.length === 1;
    q(`delete from dbo.usergroups where usercode=${out.code}; delete from dbo.users where usercode=${out.code}`);
  }
  out.final = {
    users: Number(rows('select count(*) from dbo.users')[0][0]),
    groups: Number(rows('select count(*) from dbo.usergroups')[0][0]),
    residue: rows(`select usercode,username from dbo.users where username like 'PARITY USER %'`),
  };
  out.baselineOk = out.final.users === out.baseline.users && out.final.groups === out.baseline.groups && out.final.residue.length === 0;
} catch (e) { out.fatal = String(e.stack || e).slice(0, 1600); }
finally { console.log(JSON.stringify(out, (k, v) => (typeof v === 'bigint' ? Number(v) : v), 1)); await browser.close().catch(() => {}); }
