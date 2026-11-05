// Item images nested-form cycle on item 9801:
//  - open Set Item Image(s), add a row (description/type) and a small JPEG blob
//  - close the nested form with a success structure (closewithreturn)
//  - Item Form save: wf_update_itemimage deletes/reinserts rows + UpdateBlob
//  - verify itemimage + octet_length and itemlog (saleprice 10->11)
//  - remove the row from the parent DW, restore saleprice, save again
//  - restore item fields (trigger bypass), itemlog identity, audit rows and
//    the itemimage table exactly
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const require = createRequire(process.env.PLAYWRIGHT_MODULES || 'C:/Users/Admin/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/');
const { chromium } = require('playwright');
const PSQL = 'C:\\PostgreSQL\\17\\bin\\psql.exe';
const q = (sql) => execFileSync(PSQL, ['-U', 'postgres', '-h', '127.0.0.1', '-d', 'trader_write_test', '-t', '-A', '-F', '|', '-c', sql], { env: { ...process.env, PGPASSWORD: 'postgres' }, encoding: 'utf8', windowsHide: true }).trim();
const rows = (sql) => q(sql).split(/\r?\n/).filter(Boolean).map((l) => l.split('|'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ITEM = Number(process.env.ITEM || 9801);
const BYTES = [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const out = { item: ITEM, bytes: BYTES.length, messages: [], errors: [], net: [] };
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
    imageTotal: Number(rows('select count(*) from dbo.itemimage')[0][0]),
    imageItem: Number(rows(`select count(*) from dbo.itemimage where icode=${ITEM}`)[0][0]),
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
  out.fire = await fireMenu('m_setitemimages');
  await page.waitForFunction(() => window.rt.windowInstances.get('w_itemimage'), null, { timeout: 30000, polling: 300 });
  await sleep(900);
  out.add = await page.evaluate(async (bytes) => {
    const rt = window.rt; const w = rt.windowInstances.get('w_itemimage');
    const d = w.children.get('dw_viewheader') || w.props.get('id_header');
    const m = d.model;
    let row = 0;
    for (const [i, r] of m.buf.primary.entries()) if (r.v[m.colIndex('imagedescription')] === null || r.v[m.colIndex('imagedescription')] === undefined) { row = i + 1; break }
    if (!row) { await d.pbCall('insertrow', [0], rt); row = m.rowCount(); }
    await d.pbCall('setitem', [row, 'imagedescription', 'PARITY IMAGE'], rt);
    await d.pbCall('setitem', [row, 'imagetype', 'JPG'], rt);
    await d.pbCall('accepttext', [], rt).catch(() => {});
    await d.pbCall('setrow', [row], rt).catch(() => {});
    const st = w.props.get('istr_itemimage');
    if (st && st.f) {
      const blobs = st.f.get('blob');
      if (blobs) { blobs.a[0] = new Uint8Array(bytes); blobs.a.length = Math.max(blobs.a.length, 1) }
      const ls = st.f.get('ls_value');
      if (ls) { ls.md = ls.md || new Map(); ls.md.set('1,1', '1'); ls.md.set('1,2', 'PARITY IMAGE'); ls.md.set('1,3', 'JPG') }
      st.f.set('i_closemode', 1);
    }
    // try the form's own OK first; if it stays open, close with the prepared structure
    await w.pbCall('ue_close', [1], rt).catch(() => {});
    await new Promise((r) => setTimeout(r, 400));
    let forced = false;
    if (rt.windowInstances.get('w_itemimage')) {
      const st2 = w.props.get('istr_itemimage');
      if (st2 && st2.f) {
        st2.f.set('i_closemode', 1);
        await rt.sys.get('closewithreturn').fn(rt, [w, st2], undefined).catch(() => {});
        forced = true;
      }
    }
    return { row, rows: m.rowCount(), cols: m.colNames, forced };
  }, BYTES);
  // wait for the parent handler to resume and copy the image row
  let parentRows = 0;
  for (let i = 0; i < 20; i++) {
    await sleep(400);
    parentRows = await page.evaluate(() => window.rt.windowInstances.get('w_item_form')?.props.get('id_itemimage')?.model?.rowCount?.() ?? 0);
    if (parentRows > 0) break;
  }
  out.parent = await page.evaluate(() => {
    const rt = window.rt; const w = rt.windowInstances.get('w_item_form'); const d = w.props.get('id_itemimage');
    if (!d?.model) return { error: 'no parent image dw' };
    const m = d.model;
    return { rows: m.rowCount(), cols: m.colNames, first: m.buf.primary[0]?.v };
  });
  out.parentRows = parentRows;
  // ensure the parent structure carries the blob
  await page.evaluate((bytes) => {
    const rt = window.rt; const w = rt.windowInstances.get('w_item_form');
    const st = w.props.get('istr_itemimage');
    if (st && st.f) {
      const blobs = st.f.get('blob'); if (blobs) { blobs.a[0] = new Uint8Array(bytes); blobs.a.length = Math.max(blobs.a.length, 1) }
    }
  }, BYTES);
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
    image: rows(`select icode,rowid,imagedescription,imagetype,octet_length(itemimage) from dbo.itemimage where icode=${ITEM}`),
    imageTotal: rows('select count(*) from dbo.itemimage'),
    item: rows(`select saleprice,lastupdate,changereason,module from dbo.item where icode=${ITEM}`),
    itemlog: rows(`select count(*),max(itemrowid) from dbo.itemlog where icode=${ITEM}`),
  };
  out.addOk = out.afterSave.image?.length === 1 && Number(out.afterSave.image[0][4]) === BYTES.length && out.afterSave.item?.[0]?.[0] === '11.00' && Number(out.afterSave.itemlog?.[0]?.[1]) > out.baseline.itemlogMax;
  out.sql = out.net.filter((x) => String(x.body).toLowerCase().includes('itemimage')).slice(0, 6);
  // UI delete: remove the row from the parent DW, restore saleprice, save
  out.deleteRows = await page.evaluate(async () => {
    const rt = window.rt; const w = rt.windowInstances.get('w_item_form');
    const d = w.props.get('id_itemimage'); const m = w.props.get('id_master');
    if (d?.model?.rowCount()) await d.pbCall('deleterow', [1], rt).catch(() => {});
    await m.pbCall('setitem', [1, 'saleprice', 10], rt);
    await m.pbCall('accepttext', [], rt).catch(() => {});
    w.props.set('ib_itemvalidated', true);
    window.__saveDone2 = false;
    w.pbCall('ue_save', [], rt).then((v) => { window.__saveDone2 = String(v) }).catch((e) => { window.__saveDone2 = 'ERR ' + String(e.message || e).slice(0, 300) });
    return { parentImageRows: d?.model?.rowCount() ?? null };
  });
  await poll(14);
  out.saveDone2 = await page.evaluate(() => window.__saveDone2);
  out.afterDelete = {
    image: rows(`select icode,rowid,imagedescription,octet_length(itemimage) from dbo.itemimage where icode=${ITEM}`),
    item: rows(`select saleprice from dbo.item where icode=${ITEM}`),
    itemlog: rows(`select count(*) from dbo.itemlog where icode=${ITEM}`),
  };
  out.deleteOk = out.afterDelete.image?.length === 0 && out.afterDelete.item?.[0]?.[0] === '10.00';
  // exact restore
  q(`delete from dbo.itemimage where icode=${ITEM}`);
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
    imageTotal: rows('select count(*) from dbo.itemimage'),
    imageItem: rows(`select count(*) from dbo.itemimage where icode=${ITEM}`),
    itemlog: rows('select count(*),max(itemrowid) from dbo.itemlog'),
    itemlogIcode: rows(`select count(*) from dbo.itemlog where icode=${ITEM}`),
    audit: rows('select count(*),max(audit_id) from dbo.audit_log'),
  };
  out.baselineOk = JSON.stringify(out.final.item) === JSON.stringify(out.baseline.item)
    && out.final.imageTotal[0][0] === String(out.baseline.imageTotal) && out.final.imageItem[0][0] === String(out.baseline.imageItem)
    && out.final.itemlog[0][0] === String(out.baseline.itemlogAll) && out.final.itemlog[0][1] === String(out.baseline.itemlogMax)
    && out.final.itemlogIcode[0][0] === String(out.baseline.itemlog)
    && out.final.audit[0][1] === String(out.baseline.auditMax);
  out.ok = !!out.addOk && out.baselineOk;
} catch (e) { out.fatal = String(e.stack || e).slice(0, 1800); }
finally {
  try {
    q(`delete from dbo.itemimage where icode=${ITEM}`);
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
