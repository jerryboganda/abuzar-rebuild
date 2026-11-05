// Item parent-save cycle for item 9801:
//  - nested Set Item Price Policy: add qtylimit 1 / price 11 row
//  - nested Set Alternate Item Alias Names: add PARITYALIAS row
//  - change item saleprice 10 -> 11 to force f_generateitemlog
//  - Item Form ue_save, verify alternateitemalias / pricepolicydetail / itemlog
//  - delete both nested rows and restore saleprice, save again, verify
//  - restore item fields + itemlog rows/identity to the captured baseline
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const require = createRequire(process.env.PLAYWRIGHT_MODULES || 'C:/Users/Admin/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/');
const { chromium } = require('playwright');
const PSQL = 'C:\\PostgreSQL\\17\\bin\\psql.exe';
const q = (sql) => execFileSync(PSQL, ['-U', 'postgres', '-h', '127.0.0.1', '-d', 'trader_write_test', '-t', '-A', '-F', '|', '-c', sql], { env: { ...process.env, PGPASSWORD: 'postgres' }, encoding: 'utf8', windowsHide: true }).trim();
const rows = (sql) => q(sql).split(/\r?\n/).filter(Boolean).map((l) => l.split('|'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ITEM = Number(process.env.ITEM || 9801);
const ALIAS = 'PARITYALIAS';
const POLICY_QTY = 1;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const out = { item: ITEM, alias: ALIAS, messages: [], errors: [], net: [] };
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
    itemlog: Number(rows(`select count(*) from dbo.itemlog where icode=${ITEM}`)[0][0]),
    itemlogMax: Number(rows('select max(itemrowid) from dbo.itemlog')[0][0]),
    itemlogAll: Number(rows('select count(*) from dbo.itemlog')[0][0]),
    alias: Number(rows(`select count(*) from dbo.alternateitemalias where icode=${ITEM}`)[0][0]),
    aliasAll: Number(rows('select count(*) from dbo.alternateitemalias')[0][0]),
    policy: rows(`select pricepolicycode,name from dbo.pricepolicy where icode=${ITEM}`),
    policyDetail: Number(rows('select count(*) from dbo.pricepolicydetail')[0][0]),
    tabmaxPolicy: rows("select tabmaxkey from dbo._tabmaxkey where tabname='PricePolicy'")[0]?.[0] ?? null,
    auditMax: Number(rows('select max(audit_id) from dbo.audit_log')[0][0]),
  };
  await page.goto('http://127.0.0.1:5177/?app=1&autologin=ADMIN:password9080', { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.rt && window.rt.windowInstances.get('w_main') && typeof window.__menu === 'function', null, { timeout: 90000, polling: 300 });
  await page.evaluate(() => { void window.__menu('Basic Data | Item .......... | Item') });
  await page.waitForFunction(() => window.rt.windowInstances.get('w_item_form'), null, { timeout: 40000, polling: 300 });
  await sleep(1800); await poll(2);
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
  await poll(3);
  // nested price policy
  out.firePolicy = await fireMenu('m_setitempricepolicy');
  await page.waitForFunction(() => window.rt.windowInstances.get('w_item_pricepolicy_form'), null, { timeout: 30000, polling: 300 });
  await sleep(900);
  out.policyAdd = await page.evaluate(async ({ qty }) => {
    const rt = window.rt; const w = rt.windowInstances.get('w_item_pricepolicy_form');
    const d = w.children.get('dw_viewheader') || w.props.get('id_header');
    const { PBDateTime } = await import('/src/runtime/values.ts');
    const m = d.model;
    let row = 0;
    for (const [i, r] of m.buf.primary.entries()) if (r.v[m.colIndex('qtylimit')] === null || r.v[m.colIndex('qtylimit')] === undefined) { row = i + 1; break }
    if (!row) { await d.pbCall('insertrow', [0], rt); row = m.rowCount(); }
    await d.pbCall('setitem', [row, 'qtylimit', qty], rt);
    await d.pbCall('setitem', [row, 'price', 11], rt);
    await d.pbCall('setitem', [row, 'itemflatdisc', 0], rt);
    await d.pbCall('setitem', [row, 'discperc', 0], rt);
    await d.pbCall('setitem', [row, 'expirydate', PBDateTime.fromJs(new Date(2030, 11, 12))], rt);
    await d.pbCall('accepttext', [], rt).catch(() => {});
    await d.pbCall('setrow', [row], rt).catch(() => {});
    await w.pbCall('ue_close', [-1], rt).catch(() => {});
    await new Promise((r) => setTimeout(r, 600));
    return { row, rows: m.rowCount(), values: m.buf.primary[row - 1]?.v?.map((x) => (x && typeof x === 'object' ? JSON.stringify(x) : String(x))) };
  }, { qty: POLICY_QTY });
  await poll(2);
  out.parentPolicy = await page.evaluate(() => {
    const rt = window.rt; const w = rt.windowInstances.get('w_item_form'); const d = w.props.get('id_pricepolicydetail');
    if (!d?.model) return { error: 'no parent policy dw' };
    const m = d.model;
    let found = 0;
    for (const [i, r] of m.buf.primary.entries()) if (Number(r.v[m.colIndex('qtylimit')]) === 1) found = i + 1;
    return { rows: m.rowCount(), found, cols: m.colNames };
  });
  // nested alternate alias
  out.fireAlias = await fireMenu('m_setalternateitemaliasnames');
  await page.waitForFunction(() => window.rt.windowInstances.get('w_alternate_item_aliasname_form'), null, { timeout: 30000, polling: 300 });
  await sleep(900);
  out.aliasAdd = await page.evaluate(async (alias) => {
    const rt = window.rt; const w = rt.windowInstances.get('w_alternate_item_aliasname_form');
    const d = w.children.get('dw_viewheader') || w.props.get('id_header');
    const m = d.model;
    let row = 0;
    for (const [i, r] of m.buf.primary.entries()) if (r.v[m.colIndex('customicode')] === null || r.v[m.colIndex('customicode')] === undefined) { row = i + 1; break }
    if (!row) { await d.pbCall('insertrow', [0], rt); row = m.rowCount(); }
    for (const [n, v] of Object.entries({ customicode: alias, name: 'PARITY ALIAS', packingdesc: 'PCS', qty: 1, purprice: 1, saleprice: 11, retailprice: 11 })) await d.pbCall('setitem', [row, n, v], rt);
    await d.pbCall('accepttext', [], rt).catch(() => {});
    await d.pbCall('setrow', [row], rt).catch(() => {});
    await w.pbCall('ue_close', [-1], rt).catch(() => {});
    await new Promise((r) => setTimeout(r, 600));
    return { row, rows: m.rowCount() };
  }, ALIAS);
  await poll(2);
  out.parentAlias = await page.evaluate((alias) => {
    const rt = window.rt; const w = rt.windowInstances.get('w_item_form'); const d = w.props.get('id_alternateitemalias');
    if (!d?.model) return { error: 'no parent alias dw' };
    const m = d.model; const ci = m.colIndex('customicode');
    let found = 0;
    for (const [i, r] of m.buf.primary.entries()) if (String(r.v[ci]) === alias) found = i + 1;
    return { rows: m.rowCount(), found, coins: m.colNames?.slice(0, 10) };
  }, ALIAS);
  // change item saleprice to force itemlog, then save
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
    alias: rows(`select icode,customicode,name,qty,saleprice from dbo.alternateitemalias where icode=${ITEM} and customicode='${ALIAS}'`),
    policy: rows(`select pricepolicycode,qtylimit,price,expirydate::date,itemflatdisc,discperc from dbo.pricepolicydetail where pricepolicycode=7670 and qtylimit=${POLICY_QTY}`),
    item: rows(`select saleprice,retailprice,lastupdate,changereason,module,usercode from dbo.item where icode=${ITEM}`),
    itemlog: rows(`select count(*),max(itemrowid) from dbo.itemlog where icode=${ITEM}`),
    itemlogAll: rows('select count(*),max(itemrowid) from dbo.itemlog'),
  };
  out.addOk = out.afterSave.alias?.length === 1 && out.afterSave.policy?.length === 1 && out.afterSave.item?.[0]?.[0] === '11.00' && Number(out.afterSave.itemlog?.[0]?.[1]) > out.baseline.itemlogMax;
  out.sql = out.net.filter((x) => String(x.body).toLowerCase().includes('alternateitemalias') || String(x.body).toLowerCase().includes('pricepolicy') || String(x.body).toLowerCase().includes('itemlog')).slice(0, 8);
  // delete the nested rows through the parent DataWindows, restore saleprice, save again
  out.deleteRows = await page.evaluate(async (alias) => {
    const rt = window.rt; const w = rt.windowInstances.get('w_item_form');
    const ad = w.props.get('id_alternateitemalias'); const pd = w.props.get('id_pricepolicydetail'); const m = w.props.get('id_master');
    let ar = 0, pr = 0;
    if (ad?.model) { const ci = ad.model.colIndex('customicode'); for (const [i, r] of ad.model.buf.primary.entries()) if (String(r.v[ci]) === alias) { ar = i + 1; break } }
    if (pd?.model) { const qi = pd.model.colIndex('qtylimit'); for (const [i, r] of pd.model.buf.primary.entries()) if (Number(r.v[qi]) === 1) { pr = i + 1; break } }
    if (ar) await ad.pbCall('deleterow', [ar], rt).catch(() => {});
    if (pr) await pd.pbCall('deleterow', [pr], rt).catch(() => {});
    await m.pbCall('setitem', [1, 'saleprice', 10], rt);
    await m.pbCall('accepttext', [], rt).catch(() => {});
    w.props.set('ib_itemvalidated', true);
    window.__saveDone2 = false;
    w.pbCall('ue_save', [], rt).then((v) => { window.__saveDone2 = String(v) }).catch((e) => { window.__saveDone2 = 'ERR ' + String(e.message || e).slice(0, 300) });
    return { aliasRow: ar, policyRow: pr, aliasRows: ad?.model?.rowCount(), policyRows: pd?.model?.rowCount() };
  }, ALIAS);
  await poll(14);
  out.saveDone2 = await page.evaluate(() => window.__saveDone2);
  out.afterDelete = {
    alias: rows(`select count(*) from dbo.alternateitemalias where icode=${ITEM} and customicode='${ALIAS}'`),
    policy: rows(`select count(*) from dbo.pricepolicydetail where pricepolicycode=7670 and qtylimit=${POLICY_QTY}`),
    item: rows(`select saleprice from dbo.item where icode=${ITEM}`),
    itemlog: rows(`select count(*) from dbo.itemlog where icode=${ITEM}`),
  };
  out.deleteOk = out.afterDelete.alias?.[0]?.[0] === '0' && out.afterDelete.policy?.[0]?.[0] === '0' && out.afterDelete.item?.[0]?.[0] === '10.00';
  // cleanup: remove any residue and restore item fields + itemlog identity exactly
  q(`delete from dbo.alternateitemalias where icode=${ITEM} and customicode='${ALIAS}'`);
  q(`delete from dbo.pricepolicydetail where pricepolicycode=7670 and qtylimit=${POLICY_QTY}`);
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
    alias: rows(`select count(*) from dbo.alternateitemalias where icode=${ITEM}`),
    aliasAll: rows('select count(*) from dbo.alternateitemalias'),
    policyDetail: rows('select count(*) from dbo.pricepolicydetail'),
    itemlog: rows(`select count(*),max(itemrowid) from dbo.itemlog`),
    itemlogIcode: rows(`select count(*) from dbo.itemlog where icode=${ITEM}`),
    audit: rows('select count(*),max(audit_id) from dbo.audit_log'),
  };
  out.baselineOk = JSON.stringify(out.final.item) === JSON.stringify(out.baseline.item)
    && out.final.alias[0][0] === String(out.baseline.alias) && out.final.aliasAll[0][0] === String(out.baseline.aliasAll)
    && out.final.policyDetail[0][0] === String(out.baseline.policyDetail)
    && out.final.itemlog[0][0] === String(out.baseline.itemlogAll) && out.final.itemlog[0][1] === String(out.baseline.itemlogMax)
    && out.final.itemlogIcode[0][0] === String(out.baseline.itemlog)
    && out.final.audit[0][1] === String(out.baseline.auditMax);
  out.ok = !!out.addOk && !!out.deleteOk && out.baselineOk;
} catch (e) { out.fatal = String(e.stack || e).slice(0, 1800); }
finally {
  try {
    q(`delete from dbo.alternateitemalias where icode=${ITEM} and customicode='${ALIAS}'`);
    q(`delete from dbo.pricepolicydetail where pricepolicycode=7670 and qtylimit=${POLICY_QTY}`);
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
