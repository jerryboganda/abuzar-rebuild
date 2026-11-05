// Purchase Return full cycle: new return -> fill master/detail -> save ->
// verify prledger/prdetail + stock/avgprice -> delete through the form ->
// verify rows gone and stock restored.  Falls back to SQL cleanup only for the
// created rows, restoring the recorded stock/avgprice baselines.
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const require = createRequire(process.env.PLAYWRIGHT_MODULES || 'C:/Users/Admin/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/');
const { chromium } = require('playwright');
const PSQL = 'C:\\PostgreSQL\\17\\bin\\psql.exe';
const q = (sql) => execFileSync(PSQL, ['-U', 'postgres', '-h', '127.0.0.1', '-d', 'trader_write_test', '-t', '-A', '-F', '|', '-c', sql], { env: { ...process.env, PGPASSWORD: 'postgres' }, encoding: 'utf8', windowsHide: true }).trim();
const rows = (sql) => q(sql).split(/\r?\n/).filter(Boolean).map((l) => l.split('|'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SUPP = Number(process.env.SUPP || 311);
const ITEM = Number(process.env.ITEM || 9801);
const QTY = Number(process.env.QTY || 1);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const out = { messages: [], errors: [], supp: SUPP, item: ITEM, qty: QTY };
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
async function passPassword() {
  for (let i = 0; i < 24; i++) {
    const ok = await page.evaluate(async () => {
      const rt = window.rt; const w = rt.windowInstances.get('w_salesmanpassword');
      if (!w) return false;
      const dw = w.children.get('dw_password') || w.props.get('dw_password');
      if (!dw) return false;
      await dw.pbCall('setitem', [1, 'salesmancode', 1], rt);
      await dw.pbCall('setitem', [1, 'password', 'password9080'], rt);
      await dw.pbCall('accepttext', [], rt);
      const cb = w.children.get('cb_ok') || w.props.get('cb_ok');
      if (cb) await rt.fire(cb, 'clicked').catch(() => {});
      return true;
    }).catch(() => false);
    if (ok) { await sleep(400); return true; }
    await sleep(400);
  }
  return false;
}
const dump = async () => await page.evaluate(() => {
  const rt = window.rt; const w = rt.windowInstances.get('w_purchasereturn');
  if (!w) return { wins: [...rt.windowInstances.keys()] };
  const get = (n) => { const d = w.props.get(n); return d?.model ? { rows: d.model.rowCount(), cols: d.model.colNames, do: d.props.get('dataobject'), first: d.model.buf.primary[0]?.v?.map((x) => (x && typeof x === 'object' ? JSON.stringify(x) : String(x)))?.slice(0, 60) } : null };
  return { title: w.props.get('title'), master: get('id_master'), detail: get('id_detail'), footer: get('id_footer'), list: get('id_list'), children: [...w.children.keys()] };
});
try {
  out.baseline = {
    prledger: Number(rows('select count(*) from dbo.prledger')[0][0]),
    prdetail: Number(rows('select count(*) from dbo.prdetail')[0][0]),
    stock: rows(`select gcode,currqty from dbo.godowndetail where icode=${ITEM} order by gcode`),
    avg: rows(`select avgprice,saleprice,retailprice from dbo.item where icode=${ITEM}`),
  };
  await page.goto('http://127.0.0.1:5177/?app=1&autologin=ADMIN:password9080', { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.rt && window.rt.windowInstances.get('w_main') && typeof window.__menu === 'function', null, { timeout: 90000, polling: 300 });
  await page.evaluate(() => { void window.__menu('Purchase | Purchase Return') });
  await page.waitForFunction(() => window.rt.windowInstances.get('w_purchasereturn'), null, { timeout: 40000, polling: 300 });
  await sleep(1800); await poll(2);
  out.opened = await dump();
  await page.evaluate(() => { const rt = window.rt; const w = rt.windowInstances.get('w_purchasereturn'); void w.pbCall('ue_newform', [], rt).catch(() => {}) });
  await sleep(1800); await poll(3);
  out.blank = await dump();
  out.fill = await page.evaluate(async ({ supp, item, qty }) => {
    const rt = window.rt; const w = rt.windowInstances.get('w_purchasereturn');
    const m = w.props.get('id_master'); const d = w.props.get('id_detail'); const f = w.props.get('id_footer');
    const bad = [];
    const set = async (dw, row, n, v) => { try { await dw.pbCall('setitem', [row, n, v], rt) } catch (e) { bad.push(n + ':' + String(e.message || e).slice(0, 70)) } };
    const { PBDateTime } = await import('/src/runtime/values.ts');
    if (m.model.rowCount() === 0) await m.pbCall('insertrow', [0], rt);
    const now = PBDateTime.fromJs(new Date());
    for (const [n, v] of Object.entries({ suppcode: supp, date: now, postdate: now, originaldate: now, prcatcode: 4, purcatcode: 1, accountfor: 'S', remarks: 'PARITY PR RETURN' })) await set(m, 1, n, v);
    if (d.model.rowCount() === 0) await d.pbCall('insertrow', [0], rt);
    const dr = d.model.rowCount();
    for (const [n, v] of Object.entries({ icode: item, itemname: 'FACE MASK ', fullcode: 'FACE MASK ', itemdescription: 'FACE MASK ', packingdesc: 'PCS', historicalbatch: '.', looseqty: qty, packqty: 0, bonusqty: 0, discperc: 0, prprice: 10, batch: '.', gcode: 1, packunits: 1, totalpieces: qty, piecesinhand: 0, balancestock: qty, packsaleprice: 10, unitsalestax: 0, gstperc: 0, avgprice: 4.87463, prutn: 0 })) await set(d, dr, n, v);
    // match the real batch row for item 9801: batch '.' with expiry 2030-12-12
    await set(d, dr, 'expiry', PBDateTime.fromJs(new Date(2030, 11, 12)));
    if (f.model.rowCount() === 0) await f.pbCall('insertrow', [0], rt);
    await m.pbCall('accepttext', [], rt).catch(() => {});
    await d.pbCall('accepttext', [], rt).catch(() => {});
    await f.pbCall('accepttext', [], rt).catch(() => {});
    await d.pbCall('setrow', [dr], rt).catch(() => {});
    w.props.set('il_currrow', dr);
    w.props.set('ib_itemvalidated', true);
    return { bad, masterRows: m.model.rowCount(), detailRows: d.model.rowCount(), footerRows: f.model.rowCount(), masterVals: m.model.buf.primary[0]?.v?.slice(0, 12), detailVals: d.model.buf.primary[dr - 1]?.v };
  }, { supp: SUPP, item: ITEM, qty: QTY });
  await poll(2);
  out.save = await page.evaluate(() => { const rt = window.rt; const w = rt.windowInstances.get('w_purchasereturn'); window.__saveDone = false; w.pbCall('ue_save', [], rt).then((v) => { window.__saveDone = String(v) }).catch((e) => { window.__saveDone = 'ERR ' + String(e.message || e).slice(0, 200) }); return 'fired' });
  await sleep(1500);
  out.passwordOk = await passPassword();
  await poll(14);
  out.saveDone = await page.evaluate(() => window.__saveDone);
  out.afterSave = {
    prledger: rows(`select prinvcode,suppcode,invtotal,posted,prcatcode from dbo.prledger where suppcode=${SUPP} order by prinvcode desc limit 3`),
    prdetail: rows(`select prinvcode,icode,looseqty,prprice,batch,gcode from dbo.prdetail where icode=${ITEM} order by prinvcode desc limit 3`),
    stock: rows(`select gcode,currqty from dbo.godowndetail where icode=${ITEM} order by gcode`),
    avg: rows(`select avgprice,saleprice,retailprice from dbo.item where icode=${ITEM}`),
  };
  const created = rows(`select prinvcode from dbo.prledger where suppcode=${SUPP} and remarks='PARITY PR RETURN' order by prinvcode desc limit 1`);
  out.createdCode = created[0]?.[0] ?? null;
  out.addOk = !!out.createdCode && Number(out.afterSave.prdetail?.length) > 0;
  if (out.createdCode) {
    // load the created row from the list and delete via the form
    out.reopen = await page.evaluate(async (code) => {
      const rt = window.rt; const w = rt.windowInstances.get('w_purchasereturn');
      const l = w.props.get('id_list');
      void w.pbCall('ue_list', [], rt).catch(() => {});
      await new Promise((r) => setTimeout(r, 2000));
      if (!l?.model) return { error: 'no list' };
      const m = l.model; const ci = m.colIndex('prinvcode') >= 0 ? m.colIndex('prinvcode') : m.colIndex('code');
      const hit = [...m.buf.primary.entries()].find(([, r]) => Number(r.v[ci]) === Number(code));
      if (!hit) return { error: 'not in list', rows: m.rowCount(), cols: m.colNames };
      w.props.set('id_dwcontrol', l); w.props.set('il_selectedrow', hit[0] + 1);
      void w.pbCall('ue_detail', [], rt).catch(() => {});
      await new Promise((r) => setTimeout(r, 2000));
      const mm = w.props.get('id_master');
      return { found: hit[0] + 1, listRows: m.rowCount(), masterCode: String(mm?.model?.buf.primary[0]?.v[mm.model.colIndex('code')] ?? '') };
    }, out.createdCode);
    await poll(3);
    out.delete = await page.evaluate(() => { const rt = window.rt; const w = rt.windowInstances.get('w_purchasereturn'); window.__delDone = false; const menu = w.props.get('menuid') || w.props.get('im_menu'); let del = null; const walk = (o) => { for (const c of o.children.values()) { if (c.name === 'm_delete') del = c; walk(c) } }; if (menu) walk(menu); if (del) { void rt.fire(del, 'clicked').then(() => { window.__delDone = 'fired' }).catch((e) => { window.__delDone = 'ERR ' + String(e.message || e).slice(0, 200) }) } else { window.__delDone = 'no m_delete' } return window.__delDone });
    await poll(12);
    out.delDone = await page.evaluate(() => window.__delDone);
    out.afterDelete = {
      prledger: rows(`select count(*) from dbo.prledger where prinvcode=${out.createdCode}`),
      prdetail: rows(`select count(*) from dbo.prdetail where prinvcode=${out.createdCode}`),
      stock: rows(`select gcode,currqty from dbo.godowndetail where icode=${ITEM} order by gcode`),
      avg: rows(`select avgprice,saleprice,retailprice from dbo.item where icode=${ITEM}`),
    };
    out.deleteOk = out.afterDelete.prledger?.[0]?.[0] === '0' && out.afterDelete.prdetail?.[0]?.[0] === '0';
    // cleanup if the UI delete did not run
    if (!out.deleteOk) {
      q(`delete from dbo.prdetail where prinvcode=${out.createdCode}; delete from dbo.prledger where prinvcode=${out.createdCode}`);
      // restore stock/avgprice baselines exactly
      for (const [gcode, currqty] of out.baseline.stock) q(`update dbo.godowndetail set currqty=${Number(currqty)} where gcode=${Number(gcode)} and icode=${ITEM}`);
      if (out.baseline.avg?.[0]) q(`update dbo.item set avgprice=${Number(out.baseline.avg[0][0])}, saleprice=${Number(out.baseline.avg[0][1])}, retailprice=${Number(out.baseline.avg[0][2])} where icode=${ITEM}`);
      out.cleanupSql = true;
    }
  }
  out.final = {
    prledger: Number(rows('select count(*) from dbo.prledger')[0][0]),
    prdetail: Number(rows('select count(*) from dbo.prdetail')[0][0]),
    stock: rows(`select gcode,currqty from dbo.godowndetail where icode=${ITEM} order by gcode`),
    avg: rows(`select avgprice,saleprice,retailprice from dbo.item where icode=${ITEM}`),
  };
  out.baselineOk = out.final.prledger === out.baseline.prledger && out.final.prdetail === out.baseline.prdetail && JSON.stringify(out.final.stock) === JSON.stringify(out.baseline.stock) && JSON.stringify(out.final.avg) === JSON.stringify(out.baseline.avg);
} catch (e) { out.fatal = String(e.stack || e).slice(0, 1800); }
finally { console.log(JSON.stringify(out, (k, v) => (typeof v === 'bigint' ? Number(v) : v), 1)); await browser.close().catch(() => {}); }
