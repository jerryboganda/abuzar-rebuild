// Item Set Models nested-form cycle on item 9801:
//  - open Set Item Associations through the Item Form menu
//  - add modelcode 1, close the nested form (shared DataWindow)
//  - change saleprice 10->11 to force itemlog, save Item Form
//  - verify iteminmodel + itemlog
//  - remove the association, restore saleprice 10, save again
//  - restore item fields (lastupdate via trigger bypass), itemlog identity and audit rows
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const require = createRequire(process.env.PLAYWRIGHT_MODULES || 'C:/Users/Admin/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/');
const { chromium } = require('playwright');
const PSQL = 'C:\\PostgreSQL\\17\\bin\\psql.exe';
const q = (sql) => execFileSync(PSQL, ['-U', 'postgres', '-h', '127.0.0.1', '-d', 'trader_write_test', '-t', '-A', '-F', '|', '-c', sql], { env: { ...process.env, PGPASSWORD: 'postgres' }, encoding: 'utf8', windowsHide: true }).trim();
const rows = (sql) => q(sql).split(/\r?\n/).filter(Boolean).map((l) => l.split('|'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ITEM = Number(process.env.ITEM || 9801);
const MODEL = Number(process.env.MODEL || 1);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const out = { item: ITEM, assoc: MODEL, messages: [], errors: [], net: [] };
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
const fireMenu = async (name) => await page.evaluate((n) => {
  const rt = window.rt; const w = rt.windowInstances.get('w_item_form');
  const menu = w.props.get('menuid') || w.props.get('im_menu');
  let hit = null;
  const walk = (o) => { for (const c of o.children.values()) { if (c.name === n) hit = c; walk(c) } };
  if (menu) walk(menu);
  if (!hit) return { error: 'menu item not found: ' + n };
  void rt.fire(hit, 'clicked').catch(() => {});
  return { fired: true, text: String(hit.props.get('text') ?? ''), visible: hit.props.get('visible') !== false };
}, name);
try {
  out.baseline = {
    item: rows(`select saleprice,retailprice,lastupdate,changereason,module,usercode,coalesce(location,'') from dbo.item where icode=${ITEM}`),
    assoc: Number(rows('select count(*) from dbo.iteminmodel')[0][0]),
    assocItem: Number(rows(`select count(*) from dbo.iteminmodel where icode=${ITEM}`)[0][0]),
    itemlog: Number(rows(`select count(*) from dbo.itemlog where icode=${ITEM}`)[0][0]),
    itemlogAll: Number(rows('select count(*) from dbo.itemlog')[0][0]),
    itemlogMax: Number(rows('select max(itemrowid) from dbo.itemlog')[0][0]),
    auditMax: Number(rows('select max(audit_id) from dbo.audit_log')[0][0]),
    modelRows: Number(rows('select count(*) from dbo.model')[0][0]),
    model1: rows("select count(*) from dbo.model where modelcode=1")[0]?.[0] ?? '0',
  };
  q("insert into dbo.model (modelcode,name,description) values (1,'PARITY TEMP MODEL','TEMP MODEL FOR SET MODELS TEST') on conflict (modelcode) do nothing");
  await page.goto('http://127.0.0.1:5177/?app=1&autologin=ADMIN:password9080', { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.rt && window.rt.windowInstances.get('w_main') && typeof window.__menu === 'function', null, { timeout: 90000, polling: 300 });
  await page.evaluate(() => { void window.__menu('Basic Data | Item .......... | Item') });
  await page.waitForFunction(() => window.rt.windowInstances.get('w_item_form'), null, { timeout: 40000, polling: 300 });
  await sleep(1600); await poll(2);
  await page.evaluate(() => { const rt = window.rt; const w = rt.windowInstances.get('w_item_form'); void w.pbCall('ue_list', [], rt).catch(() => {}) });
  for (let i = 0; i < 30; i++) { await sleep(500); const n = await page.evaluate(() => window.rt.windowInstances.get('w_item_form')?.props.get('id_list')?.model?.rowCount?.() ?? 0); if (n > 0) { out.listRows = n; break; } await poll(1); }
  out.pick = await page.evaluate(async (item) => {
    const rt = window.rt; const w = rt.windowInstances.get('w_item_form');
    const l = w.props.get('id_list'); const m = l.model;
    const ci = m.colIndex('code') >= 0 ? m.colIndex('code') : (m.colIndex('icode') >= 0 ? m.colIndex('icode') : 0);
    const hit = [...m.buf.primary.entries()].find(([, r]) => Number(r.v[ci]) === item);
    if (!hit) return { error: 'item not in list', rows: m.rowCount(), cols: m.colNames };
    w.props.set('id_dwcontrol', l); w.props.set('il_selectedrow', hit[0] + 1);
    void w.pbCall('ue_detail', [], rt).catch(() => {});
    await new Promise((r) => setTimeout(r, 2500));
    const mm = w.props.get('id_master');
    return { row: hit[0] + 1, listRows: m.rowCount(), masterCode: String(mm?.model?.buf.primary[0]?.v[mm.model.colIndex('code')] ?? '') };
  }, ITEM);
  await poll(2);
  out.fire = await fireMenu('m_selectmodels');
  await page.waitForFunction(() => window.rt.windowInstances.get('w_iteminmodel_form'), null, { timeout: 30000, polling: 300 });
  await sleep(900);
  out.add = await page.evaluate(async (assoc) => {
    const rt = window.rt; const w = rt.windowInstances.get('w_iteminmodel_form');
    const d = w.children.get('dw_viewheader') || w.props.get('id_header');
    const m = d.model;
    let row = 0;
    for (const [i, r] of m.buf.primary.entries()) if (r.v[m.colIndex('modelcode')] === null || r.v[m.colIndex('modelcode')] === undefined) { row = i + 1; break }
    if (!row) { await d.pbCall('insertrow', [0], rt); row = m.rowCount(); }
    await d.pbCall('setitem', [row, 'modelcode', assoc], rt);
    await d.pbCall('accepttext', [], rt).catch(() => {});
    await d.pbCall('setrow', [row], rt).catch(() => {});
    await w.pbCall('ue_close', [-1], rt).catch(() => {});
    await new Promise((r) => setTimeout(r, 600));
    return { row, rows: m.rowCount(), cols: m.colNames };
  }, MODEL);
  await poll(2);
  out.parent = await page.evaluate((assoc) => {
    const rt = window.rt; const w = rt.windowInstances.get('w_item_form'); const d = w.props.get('id_iteminmodel');
    if (!d?.model) return { error: 'no parent association dw' };
    const m = d.model; const ci = m.colIndex('modelcode');
    let found = 0;
    for (const [i, r] of m.buf.primary.entries()) if (Number(r.v[ci]) === assoc) found = i + 1;
    return { rows: m.rowCount(), found, cols: m.colNames };
  }, MODEL);
  out.change = await page.evaluate(async () => {
    const rt = window.rt; const w = rt.windowInstances.get('w_item_form'); const m = w.props.get('id_master');
    await m.pbCall('setitem', [1, 'saleprice', 11], rt);
    await m.pbCall('accepttext', [], rt).catch(() => {});
    w.props.set('ib_itemvalidated', true);
    window.__saveDone = false;
    w.pbCall('ue_save', [], rt).then((v) => { window.__saveDone = String(v) }).catch((e) => { window.__saveDone = 'ERR ' + String(e.message || e).slice(0, 300) });
    return { saleprice: String(await m.pbCall('getitemstring', [1, 'saleprice'], rt)) };
  });
  await poll(14);
  out.saveDone = await page.evaluate(() => window.__saveDone);
  out.afterSave = {
    assoc: rows(`select icode,modelcode from dbo.iteminmodel where icode=${ITEM} and modelcode=${MODEL}`),
    item: rows(`select saleprice,retailprice,lastupdate,changereason,module,usercode from dbo.item where icode=${ITEM}`),
    itemlog: rows(`select count(*),max(itemrowid) from dbo.itemlog where icode=${ITEM}`),
    itemlogAll: rows('select count(*),max(itemrowid) from dbo.itemlog'),
  };
  out.addOk = out.afterSave.assoc?.length === 1 && out.afterSave.item?.[0]?.[0] === '11.00' && Number(out.afterSave.itemlog?.[0]?.[1]) > out.baseline.itemlogMax;
  out.sql = out.net.filter((x) => String(x.body).toLowerCase().includes('iteminmodel') || String(x.body).toLowerCase().includes('itemlog')).slice(0, 6);
  out.deleteRows = await page.evaluate(async (assoc) => {
    const rt = window.rt; const w = rt.windowInstances.get('w_item_form');
    const d = w.props.get('id_iteminmodel'); const m = w.props.get('id_master');
    let row = 0;
    if (d?.model) { const ci = d.model.colIndex('modelcode'); for (const [i, r] of d.model.buf.primary.entries()) if (Number(r.v[ci]) === assoc) { row = i + 1; break } }
    if (row) await d.pbCall('deleterow', [row], rt).catch(() => {});
    await m.pbCall('setitem', [1, 'saleprice', 10], rt);
    await m.pbCall('accepttext', [], rt).catch(() => {});
    w.props.set('ib_itemvalidated', true);
    window.__saveDone2 = false;
    w.pbCall('ue_save', [], rt).then((v) => { window.__saveDone2 = String(v) }).catch((e) => { window.__saveDone2 = 'ERR ' + String(e.message || e).slice(0, 300) });
    return { row, rows: d?.model?.rowCount() };
  }, MODEL);
  await poll(14);
  out.saveDone2 = await page.evaluate(() => window.__saveDone2);
  out.afterDelete = {
    assoc: rows(`select count(*) from dbo.iteminmodel where icode=${ITEM} and modelcode=${MODEL}`),
    item: rows(`select saleprice from dbo.item where icode=${ITEM}`),
    itemlog: rows(`select count(*) from dbo.itemlog where icode=${ITEM}`),
  };
  out.deleteOk = out.afterDelete.assoc?.[0]?.[0] === '0' && out.afterDelete.item?.[0]?.[0] === '10.00';
  // exact restore
  q(`delete from dbo.iteminmodel where icode=${ITEM} and modelcode=${MODEL}`);
  if (out.baseline?.model1 === '0') q("delete from dbo.model where modelcode=1 and name='PARITY TEMP MODEL'");
  const b = out.baseline.item?.[0];
  if (b) {
    const qv = (v) => (v === null || v === undefined || v === '' ? 'null' : `'${String(v).replace(/'/g, "''")}'`);
    q(`set session_replication_role = replica; update dbo.item set saleprice=${Number(b[0])}, retailprice=${Number(b[1])}, lastupdate=${qv(b[2])}, changereason=${qv(b[3])}, module=${qv(b[4])}, usercode=${b[5] === '' ? 'null' : Number(b[5])}, location=${b[6] === '' ? 'null' : qv(b[6])} where icode=${ITEM}; set session_replication_role = origin;`);
  }
  q(`delete from dbo.itemlog where itemrowid > ${out.baseline.itemlogMax}`);
  q(`select setval(pg_get_serial_sequence('dbo.itemlog','itemrowid'), ${out.baseline.itemlogMax}, true)`);
  q(`delete from dbo.audit_log where audit_id > ${out.baseline.auditMax}`);
  q(`select setval(pg_get_serial_sequence('dbo.audit_log','audit_id'), ${out.baseline.auditMax}, true)`);
  out.final = {
    item: rows(`select saleprice,retailprice,lastupdate,changereason,module,usercode,coalesce(location,'') from dbo.item where icode=${ITEM}`),
    assoc: rows('select count(*) from dbo.iteminmodel'),
    itemlog: rows('select count(*),max(itemrowid) from dbo.itemlog'),
    itemlogIcode: rows(`select count(*) from dbo.itemlog where icode=${ITEM}`),
    audit: rows('select count(*),max(audit_id) from dbo.audit_log'),
    model: rows('select count(*) from dbo.model'),
  };
  out.baselineOk = JSON.stringify(out.final.item) === JSON.stringify(out.baseline.item)
    && out.final.assoc[0][0] === String(out.baseline.assoc)
    && out.final.itemlog[0][0] === String(out.baseline.itemlogAll) && out.final.itemlog[0][1] === String(out.baseline.itemlogMax)
    && out.final.itemlogIcode[0][0] === String(out.baseline.itemlog)
    && out.final.audit[0][1] === String(out.baseline.auditMax)
    && out.final.model[0][0] === String(out.baseline.modelRows);
  out.ok = !!out.addOk && !!out.deleteOk && out.baselineOk;
} catch (e) { out.fatal = String(e.stack || e).slice(0, 1800); }
finally {
  try {
    q(`delete from dbo.iteminmodel where icode=${ITEM} and modelcode=${MODEL}`);
    if (out.baseline?.model1 === '0') q("delete from dbo.model where modelcode=1 and name='PARITY TEMP MODEL'");
    const b2 = out.baseline?.item?.[0];
    if (b2) {
      const qv2 = (v) => (v === null || v === undefined || v === '' ? 'null' : `'${String(v).replace(/'/g, "''")}'`);
      q(`set session_replication_role = replica; update dbo.item set saleprice=${Number(b2[0])}, retailprice=${Number(b2[1])}, lastupdate=${qv2(b2[2])}, changereason=${qv2(b2[3])}, module=${qv2(b2[4])}, usercode=${b2[5] === '' ? 'null' : Number(b2[5])}, location=${b2[6] === '' ? 'null' : qv2(b2[6])} where icode=${ITEM}; set session_replication_role = origin;`);
    }
    if (out.baseline?.itemlogMax) {
      q(`delete from dbo.itemlog where itemrowid > ${out.baseline.itemlogMax}`);
      q(`select setval(pg_get_serial_sequence('dbo.itemlog','itemrowid'), ${out.baseline.itemlogMax}, true)`);
    }
    if (out.baseline?.auditMax) {
      q(`delete from dbo.audit_log where audit_id > ${out.baseline.auditMax}`);
      q(`select setval(pg_get_serial_sequence('dbo.audit_log','audit_id'), ${out.baseline.auditMax}, true)`);
    }
  } catch {}
  console.log(JSON.stringify(out, (k, v) => (typeof v === 'bigint' ? Number(v) : v), 1));
  await browser.close().catch(() => {});
}
