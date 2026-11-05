// Basic Data | Item | Item Basic Data (w_item_basicdata_form) â€” new-item cycle.
//
// Measured original defect: for ib_modify = true the original ue_save writes
// an itemlog and returns BEFORE updating item/supplier.  The new-item path
// (ib_modify = false) proceeds through the real updates.  The form requires
// non-empty iteminmodel / itemassociation / associateditempart / itemauthor
// buffers, so temporary Model 1, Author 1 and ItemPart 2 fixtures are used.
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const require = createRequire(process.env.PLAYWRIGHT_MODULES || 'C:/Users/Admin/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/');
const { chromium } = require('playwright');
const PSQL = 'C:\\PostgreSQL\\17\\bin\\psql.exe';
const q = (sql) => execFileSync(PSQL, ['-U', 'postgres', '-h', '127.0.0.1', '-d', 'trader_write_test', '-t', '-A', '-F', '|', '-c', sql], { env: { ...process.env, PGPASSWORD: 'postgres' }, encoding: 'utf8', windowsHide: true }).trim();
const rows = (sql) => q(sql).split(/\r?\n/).filter(Boolean).map((l) => l.split('|'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SUF = String(Date.now()).slice(-6);
const CUSTOM = 'PIB' + SUF;
const PARTNAME = 'PARITY ITEM BASIC ' + SUF;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const out = { custom: CUSTOM, partname: PARTNAME, messages: [], errors: [], net: [] };
page.on('pageerror', (e) => out.errors.push(String(e.message || e).slice(0, 500)));
page.on('request', (r) => { if (r.url().includes('/api/exec')) out.net.push({ p: 'req', body: String(r.postData() || '') }) });
page.on('response', async (r) => { if (r.url().includes('/api/exec')) { let b = ''; try { b = await r.text() } catch {} out.net.push({ p: 'res', status: r.status(), body: String(b).slice(0, 500) }) } });
async function poll(seconds = 12) {
  for (let i = 0; i < seconds * 2; i++) {
    await sleep(500);
    const msgs = await page.evaluate(() => [...document.querySelectorAll('.msgbox .txt')].map((e) => e.textContent.replace(/\s+/g, ' ').trim().slice(0, 300)));
    if (msgs.length) {
      out.messages.push(...msgs);
      await page.evaluate(() => { for (const b of document.querySelectorAll('.msgbox')) { const bs = [...b.querySelectorAll('.btns button')]; (bs.find((x) => /^(ok|yes)$/i.test(x.textContent.trim())) || bs[0])?.click(); } });
      await sleep(250);
    }
  }
}
async function save(key) {
  await page.evaluate(async (k) => {
    const rt = window.rt; const w = rt.windowInstances.get('w_item_basicdata_form');
    window[k] = false;
    void w.pbCall('ue_save', [], rt).then((v) => { window[k] = String(v) }).catch((e) => { window[k] = 'ERR ' + String(e.message || e).slice(0, 500) });
  }, key);
  await poll(16);
  return page.evaluate((k) => window[k] ?? null, key);
}
const killIdle = () => { try { q("select count(pg_terminate_backend(pid)) from pg_stat_activity where datname='trader_write_test' and xact_start is not null and pid<>pg_backend_pid()"); } catch {} };
const counts = () => ({
  item: Number(rows('select count(*) from dbo.item')[0][0]),
  itemMax: Number(rows('select max(icode) from dbo.item')[0][0]),
  itempart: Number(rows('select count(*) from dbo.itempart')[0][0]),
  itempartMax: Number(rows('select max(ipartcode) from dbo.itempart')[0][0]),
  model: Number(rows('select count(*) from dbo.model')[0][0]),
  author: Number(rows('select count(*) from dbo.author')[0][0]),
  itempartinmodel: Number(rows('select count(*) from dbo.itempartinmodel')[0][0]),
  itempartinmodelSeq: Number(rows("select last_value from dbo.itempartinmodel_rowid_seq")[0][0]),
  iteminmodel: Number(rows('select count(*) from dbo.iteminmodel')[0][0]),
  itemassociation: Number(rows('select count(*) from dbo.itemassociation')[0][0]),
  associateditempart: Number(rows('select count(*) from dbo.associateditempart')[0][0]),
  itemauthor: Number(rows('select count(*) from dbo.itemauthor')[0][0]),
  itemsuppliers: Number(rows('select count(*) from dbo.itemsuppliers')[0][0]),
  itemnotes: Number(rows('select count(*) from dbo.itemnotes')[0][0]),
  pricepolicy: Number(rows('select count(*) from dbo.pricepolicy')[0][0]),
  tabItem: rows("select tabmaxkey from dbo._tabmaxkey where tabname='Item'")[0]?.[0] ?? null,
  tabItemPart: rows("select tabmaxkey from dbo._tabmaxkey where tabname='ItemPart'")[0]?.[0] ?? null,
  tabModel: rows("select tabmaxkey from dbo._tabmaxkey where tabname='Model'")[0]?.[0] ?? null,
  itemlog: Number(rows('select count(*) from dbo.itemlog')[0][0]),
  itemlogMax: Number(rows('select max(itemrowid) from dbo.itemlog')[0][0]),
  audit: Number(rows('select count(*) from dbo.audit_log')[0][0]),
  auditMax: Number(rows('select max(audit_id) from dbo.audit_log')[0][0]),
});
const restore = () => {
  try {
    killIdle();
    q(`delete from dbo.itemnotes where icode in (select icode from dbo.item where customicode='${CUSTOM}')`);
    q(`delete from dbo.itemauthor where icode in (select icode from dbo.item where customicode='${CUSTOM}')`);
    q(`delete from dbo.itemassociation where icode in (select icode from dbo.item where customicode='${CUSTOM}')`);
    q(`delete from dbo.iteminmodel where icode in (select icode from dbo.item where customicode='${CUSTOM}')`);
    q(`delete from dbo.itemsuppliers where icode in (select icode from dbo.item where customicode='${CUSTOM}')`);
    q(`delete from dbo.pricepolicydetail where pricepolicycode in (select pricepolicycode from dbo.pricepolicy where icode in (select icode from dbo.item where customicode='${CUSTOM}'))`);
    q(`delete from dbo.pricepolicy where icode in (select icode from dbo.item where customicode='${CUSTOM}')`);
    q(`delete from dbo.item where customicode='${CUSTOM}'`);
    q('delete from dbo.associateditempart where ipartcode=1 and associatedipartcode=2');
    q('delete from dbo.itempartinmodel where ipartcode=1 and modelcode=1');
    if (out.baseline?.itempartinmodelSeq !== undefined) q(`select setval('dbo.itempartinmodel_rowid_seq', ${Number(out.baseline.itempartinmodelSeq)}, true)`);
    q("delete from dbo.itempart where ipartcode=2 and name='PARITY TEMP PART'");
    q("delete from dbo.model where modelcode=1 and name='PARITY TEMP MODEL'");
    q("delete from dbo.author where authorcode=1 and name='PARITY TEMP AUTHOR'");
    if (out.baseline?.tabItem !== null) q(`update dbo._tabmaxkey set tabmaxkey=${Number(out.baseline.tabItem)} where tabname='Item'`);
    if (out.baseline?.tabItemPart !== null) q(`update dbo._tabmaxkey set tabmaxkey=${Number(out.baseline.tabItemPart)} where tabname='ItemPart'`);
    if (out.baseline?.tabModel !== null) q(`update dbo._tabmaxkey set tabmaxkey=${Number(out.baseline.tabModel)} where tabname='Model'`);
    if (out.baseline?.itemlogMax) { q(`delete from dbo.itemlog where itemrowid > ${out.baseline.itemlogMax}`); q(`select setval(pg_get_serial_sequence('dbo.itemlog','itemrowid'), ${out.baseline.itemlogMax}, true)`); }
    if (out.baseline?.auditMax) { q(`delete from dbo.audit_log where audit_id > ${out.baseline.auditMax}`); q(`select setval(pg_get_serial_sequence('dbo.audit_log','audit_id'), ${out.baseline.auditMax}, true)`); }
  } catch (e) { out.restoreError = String(e.message || e).slice(0, 600); }
};
try {
  out.baseline = counts();
  q("insert into dbo.model (modelcode,name,description) values (1,'PARITY TEMP MODEL','TEMP')");
  q("insert into dbo.author (authorcode,name,remarks) values (1,'PARITY TEMP AUTHOR','TEMP')");
  q("insert into dbo.itempart (ipartcode,name,description,application,remarks,icatcode,iccode,manfcode,gcode,purprice,saleprice,reorderlevel,minlevel,maxlevel,qtyused) values (2,'PARITY TEMP PART','TEMP','','',1,1,1,1,0,0,0,0,0,0)");
  await page.goto('http://127.0.0.1:5177/?app=1&autologin=ADMIN:password9080', { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.rt && window.rt.windowInstances.get('w_main') && typeof window.__menu === 'function', null, { timeout: 90000, polling: 300 });
  out.menu = await page.evaluate(async () => { try { await window.__menu('Basic Data | Item .......... | Item Basic Data'); return 'ok'; } catch (e) { return 'ERR ' + String(e.message || e); } });
  await page.waitForFunction(() => window.rt.windowInstances.get('w_item_basicdata_form'), null, { timeout: 30000, polling: 300 });
  await sleep(1800); await poll(3);
  await page.evaluate(async () => { const rt = window.rt; const w = rt.windowInstances.get('w_item_basicdata_form'); await w.pbCall('ue_newform', [], rt).catch(() => {}) });
  await sleep(900); await poll(1);
  out.fill = await page.evaluate(async ({ custom, partname }) => {
    const rt = window.rt; const w = rt.windowInstances.get('w_item_basicdata_form');
    const m = w.props.get('id_master'); const d = w.props.get('id_detail');
    if (m.model.rowCount() === 0) await m.pbCall('insertrow', [0], rt);
    const mf = {
      customicode: custom, itempartname: partname, iccode: 1, icatcode: 1, packcode: 1, manfcode: 1, gcode: 1,
      saleprice: 0, purprice: 0, retailprice: 0, avgprice: 0, salediscperc: 0, purdiscperc: 0, salestax: 0,
      reorderqty: 0, optimumqty: 0, packunits: 1, active: 1, prescribed: 0, refrigrated: 0, printable: 1,
      location1: '', remarks1: '.', location: '', remarks: '', packingfactor: 1, transitstock: 0, minqty: 0, qtyused: 0,
      locksaleprice: 'N', lockdiscperc: 'N', printexpiry: 'Y', antinorcotix: 'N', restricted: 'N', generatepo: 'N',
      saleprice2: 0, saleprice3: 0, saleprice4: 0, saleprice5: 0, salediscperc2: 0, salediscperc3: 0, salediscperc4: 0, salediscperc5: 0,
      recentpurprice: 0, greorderqty: 1, goptimumqty: 1, packsalestax: 0, gstperc1: 0, gstperc2: 0,
      isizecode: 1, istylecode: 1, icolourcode: 1, isleevecode: 1, iyarncode: 1, ifabriccode: 1, ibrandcode: 1,
      ipartcode: 1, itemtypecode: 1, measureunitcode: 1, genericcode: 1, itemalertcode: 1, sizedescription: '', modeldescription: '', typedescription: '',
    };
    const bad = [];
    for (const [k, v] of Object.entries(mf)) { try { await m.pbCall('setitem', [1, k, v], rt) } catch { bad.push(k) } }
    if (d.model.rowCount() === 0) await d.pbCall('insertrow', [0], rt);
    for (const [k, v] of Object.entries({ suppcode: 18, priority: 1, rate: 0, discperc: 0, saleqty: 0, bonusqty: 0, days: 0 })) { try { await d.pbCall('setitem', [1, k, v], rt) } catch { bad.push('d:' + k) } }
    const add = async (prop, vals) => {
      const dw = w.props.get(prop); if (!dw?.model) { bad.push(prop); return null; }
      if (dw.model.rowCount() === 0) await dw.pbCall('insertrow', [0], rt);
      for (const [k, v] of Object.entries(vals)) await dw.pbCall('setitem', [dw.model.rowCount(), k, v], rt).catch(() => {});
      return dw.model.rowCount();
    };
    const im = await add('id_iteminmodel', { modelcode: 1 });
    const ia = await add('id_itemassociation', { associcode: 9800 });
    const ap = await add('id_associateditempart', { code: 1, associatedipartcode: 2 });
    const au = await add('id_itemauthor', { authorcode: 1, priority: 1 });
    w.props.set('ib_itemvalidated', true);
    await m.pbCall('accepttext', [], rt).catch(() => {}); await d.pbCall('accepttext', [], rt).catch(() => {});
    for (const p of ['id_iteminmodel', 'id_itemassociation', 'id_associateditempart', 'id_itemauthor']) await w.props.get(p)?.pbCall('accepttext', [], rt).catch(() => {});
    return { bad, masterRows: m.model.rowCount(), detailRows: d.model.rowCount(), iteminmodel: im, association: ia, associatedpart: ap, author: au };
  }, { custom: CUSTOM, partname: PARTNAME });
  out.save1 = await save('__save1');
  out.newItem = rows(`select icode,name,customicode,ipartcode,saleprice from dbo.item where customicode='${CUSTOM}'`)[0] ?? null;
  out.code = out.newItem?.[0] ?? null;
  out.afterAdd = {
    item: out.newItem,
    supplier: out.code ? rows(`select icode,suppcode,priority,rate from dbo.itemsuppliers where icode=${Number(out.code)} and suppcode=18`) : [],
    iteminmodel: out.code ? rows(`select icode,modelcode from dbo.iteminmodel where icode=${Number(out.code)}`) : [],
    itemassociation: out.code ? rows(`select icode,associcode from dbo.itemassociation where icode=${Number(out.code)}`) : [],
    associatedpart: rows('select ipartcode,associatedipartcode from dbo.associateditempart where ipartcode=1 and associatedipartcode=2'),
    itemauthor: out.code ? rows(`select icode,authorcode from dbo.itemauthor where icode=${Number(out.code)}`) : [],
    itempartinmodel: rows('select ipartcode,modelcode from dbo.itempartinmodel where ipartcode=1 and modelcode=1'),
    itemnotes: out.code ? rows(`select count(*) from dbo.itemnotes where icode=${Number(out.code)}`) : [],
    tabItem: rows("select tabmaxkey from dbo._tabmaxkey where tabname='Item'"),
  };
  out.addOk = !!out.code && out.afterAdd.supplier?.length === 1 && out.afterAdd.iteminmodel?.length === 1
    && out.afterAdd.itemassociation?.length === 1 && out.afterAdd.associatedpart?.length === 1
    && out.afterAdd.itemauthor?.length === 1 && out.afterAdd.itempartinmodel?.length === 1
    && out.messages.some((m) => /Changes take effect in database/i.test(m));
  // edit attempt: the original ib_modify path generates an itemlog and returns
  if (out.code) {
    await page.evaluate(async () => { const rt = window.rt; const w = rt.windowInstances.get('w_item_basicdata_form'); await w.pbCall('ue_list', [], rt).catch(() => {}) });
    for (let i = 0; i < 30; i++) { await sleep(500); const n = await page.evaluate(() => window.rt.windowInstances.get('w_item_basicdata_form')?.props.get('id_list')?.model?.rowCount?.() ?? 0); if (n > 0) break; await poll(1); }
    out.editPick = await page.evaluate(async (code) => {
      const rt = window.rt; const w = rt.windowInstances.get('w_item_basicdata_form');
      const l = w.props.get('id_list'); const m = l.model; const ci = m.colIndex('code') >= 0 ? m.colIndex('code') : 0;
      const hit = [...m.buf.primary.entries()].find(([, r]) => Number(r.v[ci]) === Number(code));
      if (!hit) return { error: 'new item not in list', rows: m.rowCount() };
      w.props.set('id_dwcontrol', l); w.props.set('il_selectedrow', hit[0] + 1);
      await w.pbCall('ue_detail', [], rt).catch(() => {});
      await new Promise((r) => setTimeout(r, 3000));
      return { row: hit[0] + 1, masterCode: String(w.props.get('id_master')?.model?.buf.primary[0]?.v?.[w.props.get('id_master').model.colIndex('code')] ?? '') };
    }, Number(out.code));
    const netStart = out.net.length;
    out.editAttempt = await page.evaluate(async () => {
      const rt = window.rt; const w = rt.windowInstances.get('w_item_basicdata_form'); const m = w.props.get('id_master');
      await m.pbCall('setitem', [1, 'remarks', 'PARITY EDIT'], rt).catch(() => {});
      await m.pbCall('accepttext', [], rt).catch(() => {});
      window.__editSave = false;
      void w.pbCall('ue_save', [], rt).then((v) => { window.__editSave = String(v) }).catch((e) => { window.__editSave = 'ERR ' + String(e.message || e).slice(0, 300) });
      return 'fired';
    });
    await poll(10);
    const ev = out.net.slice(netStart);
    out.editSQL = ev.filter((x) => x.p === 'req').map((x) => { try { return String(JSON.parse(x.body).sql).slice(0, 160) } catch { return x.body.slice(0, 120) } }).filter((s) => /itemlog|UPDATE dbo\.item|INSERT INTO dbo\.item/i.test(s));
    out.afterEditAttempt = {
      item: rows(`select icode,name,remarks from dbo.item where icode=${Number(out.code)}`),
      itemlogCount: Number(rows('select count(*) from dbo.itemlog')[0][0]),
    };
    out.editOriginalDefect = out.editSQL.some((s) => /itemlog/i.test(s)) && out.afterEditAttempt.item?.[0]?.[2] !== 'PARITY EDIT';
  }
  killIdle();
  restore();
  out.final = counts();
  out.final.residue = rows(`select count(*) from dbo.item where customicode='${CUSTOM}'`);
  out.final.itemlogIcode = rows(`select count(*) from dbo.itemlog where icode=${Number(out.code ?? 0)}`);
  out.baselineOk = JSON.stringify(out.final) === JSON.stringify({ ...out.baseline, residue: [['0']], itemlogIcode: [['0']] })
    || (out.final.item === out.baseline.item && out.final.itemMax === out.baseline.itemMax
      && out.final.itempart === out.baseline.itempart && out.final.itempartMax === out.baseline.itempartMax
      && out.final.model === out.baseline.model && out.final.author === out.baseline.author
      && out.final.itempartinmodel === out.baseline.itempartinmodel && out.final.itempartinmodelSeq === out.baseline.itempartinmodelSeq
      && out.final.iteminmodel === out.baseline.iteminmodel
      && out.final.itemassociation === out.baseline.itemassociation && out.final.associateditempart === out.baseline.associateditempart
      && out.final.itemauthor === out.baseline.itemauthor && out.final.itemsuppliers === out.baseline.itemsuppliers
      && out.final.itemnotes === out.baseline.itemnotes && out.final.pricepolicy === out.baseline.pricepolicy
      && out.final.tabItem === out.baseline.tabItem && out.final.tabItemPart === out.baseline.tabItemPart && out.final.tabModel === out.baseline.tabModel
      && out.final.itemlog === out.baseline.itemlog && out.final.itemlogMax === out.baseline.itemlogMax
      && out.final.audit === out.baseline.audit && out.final.auditMax === out.baseline.auditMax
      && out.final.residue?.[0]?.[0] === '0');
  out.ok = !!out.addOk && !!out.editOriginalDefect && out.baselineOk;
} catch (e) { out.fatal = String(e.stack || e).slice(0, 2600); }
finally {
  restore();
  console.log(JSON.stringify(out, (k, v) => (typeof v === 'bigint' ? Number(v) : v), 1));
  await browser.close().catch(() => {});
}
