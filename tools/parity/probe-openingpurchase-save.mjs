// Opening Purchase add/save: fill header + one item, save (unposted), verify
// purledger/purdetail inserts, then remove only the created rows and restore
// _tabmaxkey, the purdetail identity sequence and the recorded stock/avgprice.
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const require = createRequire(process.env.PLAYWRIGHT_MODULES || 'C:/Users/Admin/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/');
const { chromium } = require('playwright');
const PSQL = 'C:\\PostgreSQL\\17\\bin\\psql.exe';
const q = (sql) => execFileSync(PSQL, ['-U', 'postgres', '-h', '127.0.0.1', '-d', 'trader_write_test', '-t', '-A', '-F', '|', '-c', sql], { env: { ...process.env, PGPASSWORD: 'postgres' }, encoding: 'utf8', windowsHide: true }).trim();
const rows = (sql) => q(sql).split(/\r?\n/).filter(Boolean).map((l) => l.split('|'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ITEM = Number(process.env.ITEM || 9801);
const SUPP = Number(process.env.SUPP || 18);
const STAMP = String(Date.now()).slice(-6);
const SUPINV = 'PARITY-OPEN-' + STAMP;
const REMARKS = 'PARITY OPENING PURCHASE ' + STAMP;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const out = { item: ITEM, supp: SUPP, suppinv: SUPINV, remarks: REMARKS, messages: [], errors: [], net: [] };
page.on('pageerror', (e) => out.errors.push(String(e.message || e).slice(0, 400)));
page.on('request', (r) => { if (r.url().includes('/api/exec')) out.net.push({ p: 'req', body: String(r.postData() || '') }) });
page.on('response', async (r) => { if (r.url().includes('/api/exec')) { let b = ''; try { b = await r.text() } catch {} out.net.push({ p: 'res', status: r.status(), body: String(b).slice(0, 500) }) } });
async function poll(seconds = 8, yes = false) {
  for (let i = 0; i < seconds * 2; i++) {
    await sleep(500);
    const msgs = await page.evaluate(() => [...document.querySelectorAll('.msgbox .txt')].map((e) => e.textContent.replace(/\s+/g, ' ').trim().slice(0, 240)));
    if (msgs.length) {
      out.messages.push(...msgs);
      await page.evaluate((y) => { for (const b of document.querySelectorAll('.msgbox')) { const bs = [...b.querySelectorAll('.btns button')]; const want = y ? /^(yes|ok)$/i : /^(ok|no|cancel|close)$/i; (bs.find((x) => want.test(x.textContent.trim())) || bs[0])?.click(); } }, yes);
      await sleep(250);
    }
  }
}
try {
  out.baseline = {
    purledger: Number(rows('select count(*) from dbo.purledger')[0][0]),
    purdetail: Number(rows('select count(*) from dbo.purdetail')[0][0]),
    maxcode: Number(rows('select max(purinvcode) from dbo.purledger')[0][0]),
    tabmax: rows("select tabmaxkey from dbo._tabmaxkey where tabname='PurLedger'")[0]?.[0] ?? null,
    stock: rows(`select gcode,currqty from dbo.godowndetail where icode=${ITEM} order by gcode`),
    item: rows(`select avgprice,recentpurprice,saleprice,retailprice from dbo.item where icode=${ITEM}`),
    purrowid: rows('select max(purrowid) from dbo.purdetail')[0]?.[0] ?? null,
  };
  await page.goto('http://127.0.0.1:5177/?app=1&autologin=ADMIN:password9080', { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.rt && window.rt.windowInstances.get('w_main') && typeof window.__menu === 'function', null, { timeout: 90000, polling: 300 });
  await page.evaluate(() => { void window.__menu('Purchase | Opening Purchase') });
  await page.waitForFunction(() => window.rt.windowInstances.get('w_purchase'), null, { timeout: 40000, polling: 300 });
  await sleep(2200); await poll(3);
  out.open = await page.evaluate(() => {
    const rt = window.rt; const w = rt.windowInstances.get('w_purchase');
    const get = (n) => { const d = w.props.get(n); return d?.model ? { rows: d.model.rowCount(), cols: d.model.colNames, do: d.props.get('dataobject') } : null };
    return { title: String(w.props.get('title') ?? ''), master: get('id_master'), detail: get('id_detail'), footer: get('id_footer') };
  });
  out.fill = await page.evaluate(async ({ supp, item, supinv, remarks }) => {
    const rt = window.rt; const w = rt.windowInstances.get('w_purchase');
    const m = w.props.get('id_master'); const d = w.props.get('id_detail'); const f = w.props.get('id_footer');
    const bad = [];
    const set = async (dw, row, n, v) => { try { await dw.pbCall('setitem', [row, n, v], rt) } catch (e) { bad.push(n + ':' + String(e.message || e).slice(0, 60)) } };
    const { PBDateTime } = await import('/src/runtime/values.ts');
    const now = PBDateTime.fromJs(new Date());
    if (m.model.rowCount() === 0) await m.pbCall('insertrow', [0], rt);
    for (const [n, v] of Object.entries({ suppcode: supp, date: now, postdate: now, originaldate: now, suppinvcode: supinv, suppinvdate: now, purcatcode: 3, headerno: 1, taxcategorycode: 1, salesmancode: 1, posted: 'N', discperc: 0, flatdisc: 0, misccharges: 0, salestax: 0, accountfor: 'N', impactinventory: 'Y', currencycode: 1, conversionfactor: 1, advancetaxamt: 0, remarks })) await set(m, 1, n, v);
    if (d.model.rowCount() === 0) await d.pbCall('insertrow', [0], rt);
    const dr = d.model.rowCount();
    for (const [n, v] of Object.entries({ icode: item, itemname: 'FACE MASK ', fullcode: '9801', itemdescription: 'FACE MASK ', batch: '.', gcode: 1, packunits: 1, packqty: 0, looseqty: 1, bonusqty: 0, purprice: 10, rate: 10, netrate: 10, discperc: 0, itemflatdisc: 0, unitsalestax: 0, gstperc: 0, extrataxperc: 0, valueextax: 10, prediscprice: 10, totalpieces: 1, piecesinhand: 0, pcs: 1, saleprice: 10, salepriceforitem: 10, batchsaleprice: 10, discountedsaleprice: 10, recentpurprice: 2, avgprice: 4.87463, godownstock: 18035, totalstock: 18035, stock: 18035, lockbatch: 'N', lockreasoncode: 1 })) await set(d, dr, n, v);
    await set(d, dr, 'expiry', PBDateTime.fromJs(new Date(2030, 11, 12)));
    if (f.model.rowCount() === 0) await f.pbCall('insertrow', [0], rt);
    for (const [n, v] of Object.entries({ discperc: 0, flatdisc: 0, misccharges: 0, misccharges1: 0, misccharges2: 0, misccharges3: 0, misccharges4: 0, misccharges5: 0, advancetaxamt: 0, salestax: 0 })) await set(f, 1, n, v);
    await m.pbCall('accepttext', [], rt).catch(() => {});
    await d.pbCall('accepttext', [], rt).catch(() => {});
    await f.pbCall('accepttext', [], rt).catch(() => {});
    await d.pbCall('setrow', [dr], rt).catch(() => {});
    w.props.set('il_currrow', dr); w.props.set('ib_itemvalidated', true);
    return { bad, masterRows: m.model.rowCount(), detailRows: d.model.rowCount(), footerRows: f.model.rowCount() };
  }, { supp: SUPP, item: ITEM, supinv: SUPINV, remarks: REMARKS });
  await poll(2);
  out.save = await page.evaluate(() => { const rt = window.rt; const w = rt.windowInstances.get('w_purchase'); window.__saveDone = false; w.pbCall('ue_save', [], rt).then((v) => { window.__saveDone = String(v) }).catch((e) => { window.__saveDone = 'ERR ' + String(e.message || e).slice(0, 250) }); return 'fired' });
  await poll(14, true);
  out.saveDone = await page.evaluate(() => window.__saveDone);
  out.after = {
    ledger: rows(`select purinvcode,purcatcode,suppcode,suppinvcode,posted,impactinventory,invtotal from dbo.purledger where remarks='${REMARKS}'`),
    detail: rows(`select purinvcode,icode,batch,gcode,packqty,looseqty,purprice,rate from dbo.purdetail where purinvcode in (select purinvcode from dbo.purledger where remarks='${REMARKS}')`),
    stock: rows(`select gcode,currqty from dbo.godowndetail where icode=${ITEM} order by gcode`),
    item: rows(`select avgprice,recentpurprice,saleprice,retailprice from dbo.item where icode=${ITEM}`),
  };
  out.code = out.after.ledger?.[0]?.[0] ?? null;
  out.addOk = !!out.code && out.after.detail?.length === 1 && out.after.ledger[0][4] === 'N';
  out.stockUnchanged = JSON.stringify(out.after.stock) === JSON.stringify(out.baseline.stock) && JSON.stringify(out.after.item) === JSON.stringify(out.baseline.item);
  out.sql = out.net.filter((x) => String(x.body).toLowerCase().includes('purledger') || String(x.body).toLowerCase().includes('purdetail')).slice(0, 6);
  if (out.code) {
    // edit/save: reopen the invoice from the list, change remarks, save again
    out.edit = await page.evaluate(async (code) => {
      const rt = window.rt; const w = rt.windowInstances.get('w_purchase');
      void w.pbCall('ue_list', [], rt).catch(() => {});
      await new Promise((r) => setTimeout(r, 2500));
      const l = w.props.get('id_list');
      if (!l?.model) return { error: 'no list' };
      const m = l.model; const ci = m.colIndex('code');
      const hit = [...m.buf.primary.entries()].find(([, r]) => Number(r.v[ci]) === Number(code));
      if (!hit) return { error: 'invoice not in list', rows: m.rowCount(), cols: m.colNames };
      w.props.set('id_dwcontrol', l); w.props.set('il_selectedrow', hit[0] + 1);
      void w.pbCall('ue_detail', [], rt).catch(() => {});
      await new Promise((r) => setTimeout(r, 2500));
      const mm = w.props.get('id_master');
      if (!mm?.model) return { error: 'no master after detail' };
      const mr = mm.model.rowCount() ? 1 : 0;
      if (!mr) return { error: 'master empty' };
      await mm.pbCall('setitem', [1, 'remarks', String(await mm.pbCall('getitemstring', [1, 'remarks'], rt)) + ' EDITED'], rt);
      await mm.pbCall('accepttext', [], rt).catch(() => {});
      window.__saveDone = false;
      w.pbCall('ue_save', [], rt).then((v) => { window.__saveDone = String(v) }).catch((e) => { window.__saveDone = 'ERR ' + String(e.message || e).slice(0, 200) });
      return { found: hit[0] + 1, listRows: m.rowCount(), masterCode: String(mm.model.buf.primary[0]?.v[mm.model.colIndex('code')] ?? '') };
    }, Number(out.code));
    await poll(12, true);
    out.afterEdit = rows(`select purinvcode,remarks,invtotal from dbo.purledger where purinvcode=${out.code}`);
    out.editOk = String(out.afterEdit?.[0]?.[1] || '').endsWith(' EDITED');
    q(`delete from dbo.purdetail where purinvcode=${out.code}`);
    q(`delete from dbo.purledger where purinvcode=${out.code}`);
    // restore the ID counters / identity sequence exactly
    if (out.baseline.tabmax !== null) q(`update dbo._tabmaxkey set tabmaxkey=${Number(out.baseline.tabmax)} where tabname='PurLedger'`);
    if (out.baseline.purrowid !== null) q(`select setval(pg_get_serial_sequence('dbo.purdetail','purrowid'), ${Number(out.baseline.purrowid)}, true)`);
  }
  out.final = {
    purledger: Number(rows('select count(*) from dbo.purledger')[0][0]),
    purdetail: Number(rows('select count(*) from dbo.purdetail')[0][0]),
    maxcode: Number(rows('select max(purinvcode) from dbo.purledger')[0][0]),
    tabmax: rows("select tabmaxkey from dbo._tabmaxkey where tabname='PurLedger'")[0]?.[0] ?? null,
    stock: rows(`select gcode,currqty from dbo.godowndetail where icode=${ITEM} order by gcode`),
    item: rows(`select avgprice,recentpurprice,saleprice,retailprice from dbo.item where icode=${ITEM}`),
    residue: rows(`select count(*) from dbo.purledger where remarks='${REMARKS}'`),
  };
  out.baselineOk = out.final.purledger === out.baseline.purledger && out.final.purdetail === out.baseline.purdetail && out.final.maxcode === out.baseline.maxcode && out.final.tabmax === out.baseline.tabmax && JSON.stringify(out.final.stock) === JSON.stringify(out.baseline.stock) && JSON.stringify(out.final.item) === JSON.stringify(out.baseline.item);
  out.ok = !!out.addOk && out.stockUnchanged && out.baselineOk;
} catch (e) { out.fatal = String(e.stack || e).slice(0, 1800); }
finally {
  if (out.code && out.final?.residue?.[0]?.[0] !== '0') {
    try { q(`delete from dbo.purdetail where purinvcode=${out.code}; delete from dbo.purledger where purinvcode=${out.code}`); } catch {}
  }
  console.log(JSON.stringify(out, (k, v) => (typeof v === 'bigint' ? Number(v) : v), 1));
  await browser.close().catch(() => {});
}
