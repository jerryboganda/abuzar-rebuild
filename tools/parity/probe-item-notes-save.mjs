// Item Notes nested RichText form on item 9801:
//  - open Set Item Notes, type text in rte_control, OK
//  - change saleprice 10->11 to force itemlog, save Item Form
//  - verify ItemNotes blob (UTF-8 text) + itemlog
//  - restore the exact notes bytes, item fields, itemlog identity and audit rows
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const require = createRequire(process.env.PLAYWRIGHT_MODULES || 'C:/Users/Admin/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/');
const { chromium } = require('playwright');
const PSQL = 'C:\\PostgreSQL\\17\\bin\\psql.exe';
const q = (sql) => execFileSync(PSQL, ['-U', 'postgres', '-h', '127.0.0.1', '-d', 'trader_write_test', '-t', '-A', '-F', '|', '-c', sql], { env: { ...process.env, PGPASSWORD: 'postgres' }, encoding: 'utf8', windowsHide: true }).trim();
const rows = (sql) => q(sql).split(/\r?\n/).filter(Boolean).map((l) => l.split('|'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ITEM = Number(process.env.ITEM || 9801);
const TEXT = 'PARITY ITEM NOTES';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const out = { item: ITEM, text: TEXT, messages: [], errors: [], net: [] };
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
    notes: rows(`select coalesce(encode(notes,'hex'),'<null>'), coalesce(octet_length(notes),-1) from dbo.itemnotes where icode=${ITEM}`),
    notesTotal: Number(rows('select count(*) from dbo.itemnotes')[0][0]),
    itemlog: Number(rows(`select count(*) from dbo.itemlog where icode=${ITEM}`)[0][0]),
    itemlogAll: Number(rows('select count(*) from dbo.itemlog')[0][0]),
    itemlogMax: Number(rows('select max(itemrowid) from dbo.itemlog')[0][0]),
    auditMax: Number(rows('select max(audit_id) from dbo.audit_log')[0][0]),
  };
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
  out.fire = await fireMenu('m_setitemnotes');
  await page.waitForFunction(() => window.rt.windowInstances.get('w_item_form_notes'), null, { timeout: 30000, polling: 300 });
  await sleep(900);
  out.notes = await page.evaluate(async (text) => {
    const rt = window.rt; const w = rt.windowInstances.get('w_item_form_notes');
    const rte = w.children.get('rte_control') || w.props.get('rte_control');
    if (!rte) return { error: 'no rte_control', children: [...w.children.keys()] };
    rte.pbSet('text', text);
    const before = String(await rte.pbCall('copyrtf', [false, 0], rt).catch((e) => 'ERR ' + String(e.message || e).slice(0, 200)));
    const cb = w.children.get('cb_ok');
    if (cb) await rt.fire(cb, 'clicked').catch(() => {});
    await new Promise((r) => setTimeout(r, 700));
    return { before, closed: !rt.windowInstances.get('w_item_form_notes') };
  }, TEXT);
  // wait for the parent handler to capture iblob_notes
  let parentLen = -1;
  for (let i = 0; i < 15; i++) {
    await sleep(400);
    parentLen = await page.evaluate(() => {
      const rt = window.rt; const w = rt.windowInstances.get('w_item_form');
      const b = w?.props.get('iblob_notes');
      return b instanceof Uint8Array ? b.length : b ? String(b).length : -1;
    });
    if (parentLen >= 0) break;
  }
  out.parentBytes = parentLen;
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
    notes: rows(`select coalesce(convert_from(notes,'UTF8'),'<null>'), coalesce(octet_length(notes),-1) from dbo.itemnotes where icode=${ITEM}`),
    noteTotal: rows('select count(*) from dbo.itemnotes'),
    item: rows(`select saleprice,lastupdate,changereason,module from dbo.item where icode=${ITEM}`),
    itemlog: rows(`select count(*),max(itemrowid) from dbo.itemlog where icode=${ITEM}`),
  };
  out.addOk = out.afterSave.notes?.[0]?.[0] === TEXT && out.afterSave.item?.[0]?.[0] === '11.00' && Number(out.afterSave.itemlog?.[0]?.[1]) > out.baseline.itemlogMax;
  out.sql = out.net.filter((x) => String(x.body).toLowerCase().includes('itemnotes')).slice(0, 4);
  // restore notes and item exactly
  const hex = out.baseline.notes?.[0]?.[0];
  if (hex === '<null>') q(`update dbo.itemnotes set notes = null where icode=${ITEM}`);
  else q(`update dbo.itemnotes set notes = decode('${hex}','hex') where icode=${ITEM}`);
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
    notes: rows(`select coalesce(encode(notes,'hex'),'<null>'), coalesce(octet_length(notes),-1) from dbo.itemnotes where icode=${ITEM}`),
    notesTotal: rows('select count(*) from dbo.itemnotes'),
    item: rows(`select saleprice,retailprice,lastupdate,changereason,module,usercode,coalesce(location,'') from dbo.item where icode=${ITEM}`),
    itemlog: rows('select count(*),max(itemrowid) from dbo.itemlog'),
    itemlogIcode: rows(`select count(*) from dbo.itemlog where icode=${ITEM}`),
    audit: rows('select count(*),max(audit_id) from dbo.audit_log'),
  };
  out.baselineOk = JSON.stringify(out.final.notes) === JSON.stringify(out.baseline.notes)
    && out.final.notesTotal[0][0] === String(out.baseline.notesTotal)
    && JSON.stringify(out.final.item) === JSON.stringify(out.baseline.item)
    && out.final.itemlog[0][0] === String(out.baseline.itemlogAll) && out.final.itemlog[0][1] === String(out.baseline.itemlogMax)
    && out.final.itemlogIcode[0][0] === String(out.baseline.itemlog)
    && out.final.audit[0][1] === String(out.baseline.auditMax);
  out.ok = !!out.addOk && out.baselineOk;
} catch (e) { out.fatal = String(e.stack || e).slice(0, 1800); }
finally {
  try {
    const hex2 = out.baseline?.notes?.[0]?.[0];
    if (hex2 === '<null>') q(`update dbo.itemnotes set notes = null where icode=${ITEM}`);
    else if (hex2) q(`update dbo.itemnotes set notes = decode('${hex2}','hex') where icode=${ITEM}`);
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
