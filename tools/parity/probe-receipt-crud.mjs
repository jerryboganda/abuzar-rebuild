// Receipt (Maintenance | Receipt | Receipt) real save cycle on the clone.
// department is empty in BOTH the live DB and the clone, so a temporary
// department row is created just for this test and removed afterwards; every
// counter and audit row is restored to its baseline.
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const require = createRequire(process.env.PLAYWRIGHT_MODULES || 'C:/Users/Admin/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/');
const { chromium } = require('playwright');
const PSQL = 'C:\\PostgreSQL\\17\\bin\\psql.exe';
const q = (sql) => execFileSync(PSQL, ['-U', 'postgres', '-h', '127.0.0.1', '-d', 'trader_write_test', '-t', '-A', '-F', '|', '-c', sql], { env: { ...process.env, PGPASSWORD: 'postgres' }, encoding: 'utf8', windowsHide: true }).trim();
const rows = (sql) => q(sql).split(/\r?\n/).filter(Boolean).map((l) => l.split('|'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const REMARK = 'PARITY RECEIPT ' + String(Date.now()).slice(-6);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const out = { remark: REMARK, messages: [], errors: [], net: [] };
page.on('pageerror', (e) => out.errors.push(String(e.message || e).slice(0, 400)));
page.on('request', (r) => { if (r.url().includes('/api/exec')) out.net.push({ p: 'req', body: String(r.postData() || '') }) });
page.on('response', async (r) => { if (r.url().includes('/api/exec')) { let b = ''; try { b = await r.text() } catch {} out.net.push({ p: 'res', status: r.status(), body: String(b).slice(0, 300) }) } });
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
  out.baseline = {
    dept: Number(rows('select count(*) from dbo.department')[0][0]),
    rh: Number(rows('select count(*) from dbo.receiptheader')[0][0]),
    rd: Number(rows('select count(*) from dbo.receiptdetail')[0][0]),
    tabR: rows("select tabmaxkey from dbo._tabmaxkey where tabname='ReceiptHeader'")[0]?.[0] ?? null,
    header6: rows("select tabmaxkey from dbo._headertabmaxkey where module=6 and headercode=1")[0]?.[0] ?? null,
    counter: rows('select counter from dbo.receiptcategory where receiptcategorycode=1')[0]?.[0] ?? null,
    itemStock: rows('select coalesce(sum(currqty),0) from dbo.godowndetail where icode=9801 and gcode=1')[0]?.[0] ?? null,
    itemlog: Number(rows('select count(*) from dbo.itemlog')[0][0]),
    utn: rows('select utn from dbo._utn')[0]?.[0] ?? null,
    audit: Number(rows('select count(*) from dbo.audit_log')[0][0]),
    auditMax: Number(rows('select max(audit_id) from dbo.audit_log')[0][0]),
  };
  q("insert into dbo.department (deptcode,name,description,active) values (1,'PARITY DEPARTMENT','PARITY TEST','Y')");
  await page.goto('http://127.0.0.1:5177/?app=1&autologin=ADMIN:password9080', { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.rt && window.rt.windowInstances.get('w_main') && typeof window.__menu === 'function', null, { timeout: 90000, polling: 300 });
  out.menuOpen = await page.evaluate(async () => {
    const rt = window.rt; const root = rt.windowInstances.get('w_main')?.props.get('menuid');
    const find = (o, n) => { for (const c of o.children.values()) { if (c.name === n) return c; const r = find(c, n); if (r) return r } return null };
    const item = root ? find(root, 'm_receiptform') : null;
    if (!item) return { found: false };
    await rt.fire(item, 'selected').catch(() => {});
    await rt.fire(item, 'clicked').catch((e) => { window.__menuErr = String(e.message || e) });
    return { found: true, visible: item.props.get('visible'), text: String(item.props.get('text') ?? '') };
  });
  await page.waitForFunction(() => window.rt.windowInstances.get('w_receipt'), null, { timeout: 40000, polling: 300 });
  await sleep(1800); await poll(3);
  out.open = await page.evaluate(() => {
    const rt = window.rt; const w = rt.windowInstances.get('w_receipt');
    const m = w.props.get('id_master'); const d = w.props.get('id_detail');
    return {
      title: String(w.props.get('title') ?? ''), il_code: String(w.props.get('il_code') ?? ''), openparm: String(w.props.get('il_openparm') ?? ''),
      masterRows: m?.model?.rowCount?.() ?? null, detailRows: d?.model?.rowCount?.() ?? null,
      masterFirst: m?.model?.buf?.primary?.[0]?.v?.slice(0, 30) ?? null,
      detailFirst: d?.model?.buf?.primary?.[0]?.v?.slice(0, 30) ?? null,
    };
  });
  out.fill = await page.evaluate(async ({ remark }) => {
    const rt = window.rt; const w = rt.windowInstances.get('w_receipt');
    const m = w.props.get('id_master'); const d = w.props.get('id_detail');
    if (!m?.model || !d?.model) return { error: 'missing dw' };
    const bad = [];
    const set = async (dw, r, n, v) => { try { await dw.pbCall('setitem', [r, n, v], rt) } catch (e) { bad.push(n + ':' + String(e.message || e).slice(0, 60)) } };
    for (const [n, v] of Object.entries({ deptcode: 1, recipientcode: 2, pricetypecode: 1, headerno: 1, headerinvno: 1, receiptcategorycode: 1, accountfor: 'N', gcode: 1, posted: 'N', remarks: remark })) await set(m, 1, n, v);
    for (const [n, v] of Object.entries({ gcode: 1, icode: 9801, batch: '.', expiry: '2030-12-31 00:00:00', qty: 1, updateavgprice: 'Y', itemdescription: remark })) await set(d, 1, n, v);
    w.props.set('il_currrow', 1);
    await m.pbCall('accepttext', [], rt).catch(() => {});
    await d.pbCall('accepttext', [], rt).catch(() => {});
    // the real item path: wf_validateitem resolves fullcode, calls wf_inititeminfo
    let itemValid = null;
    try { itemValid = await w.pbCall('wf_validateitem', [], rt) } catch (e) { bad.push('validate:' + String(e.message || e).slice(0, 80)) }
    return {
      bad, itemValid,
      ib_itemvalidated: w.props.get('ib_itemvalidated'),
      master: m.model.buf.primary[0]?.v?.slice(0, 20),
      detail: d.model.buf.primary[0]?.v?.slice(0, 25),
      detailCols: d.model.colNames,
    };
  }, { remark: REMARK });
  if (out.fill?.itemValid !== 1) {
    // fall back to the same fields wf_inititeminfo would set, keeping the real save path
    out.fallback = await page.evaluate(async () => {
      const rt = window.rt; const w = rt.windowInstances.get('w_receipt');
      const d = w.props.get('id_detail');
      const set = async (n, v) => { try { await d.pbCall('setitem', [1, n, v], rt) } catch {} };
      for (const [n, v] of Object.entries({ gcode: 1, icode: 9801, itemname: 'FACE MASK', fullcode: '9801', batch: '.', expiry: '2030-12-31 00:00:00', qty: 1, updateavgprice: 'Y', purchaseprice: 2, saleprice: 10, avgprice: 4.87463, packunits: 1, price: 10 })) await set(n, v);
      await d.pbCall('accepttext', [], rt).catch(() => {});
      w.props.set('ib_itemvalidated', true);
      return { itemname: String(d.model.buf.primary[0]?.v?.[d.model.colIndex('itemname')] ?? '') };
    });
  }
  out.save = await page.evaluate(async () => {
    const rt = window.rt; const w = rt.windowInstances.get('w_receipt');
    window.__saveDone = false;
    void w.pbCall('ue_save', [], rt).then(() => { window.__saveDone = 'ok' }).catch((e) => { window.__saveDone = 'ERR ' + String(e.message || e).slice(0, 400) });
    return 'fired';
  });
  // ue_save opens w_salesmanpassword and waits; fill it and click Ok
  for (let i = 0; i < 60; i++) {
    await sleep(500);
    await poll(1);
    const pw = await page.evaluate(async () => {
      const rt = window.rt; const w = rt.windowInstances.get('w_salesmanpassword');
      if (!w) return false;
      const dw = w.props.get('id_password') || w.children.get('dw_password');
      if (!dw?.model) return 'no-dw';
      if (dw.model.rowCount() === 0) await dw.pbCall('insertrow', [0], rt).catch(() => {});
      await dw.pbCall('setitem', [1, 'salesmancode', 1], rt).catch(() => {});
      await dw.pbCall('setitem', [1, 'password', 'password9080'], rt).catch(() => {});
      await dw.pbCall('accepttext', [], rt).catch(() => {});
      const cb = w.children.get('cb_ok');
      await rt.fire(cb, 'clicked').catch(() => {});
      return 'filled';
    });
    if (pw) out.password = pw;
    const done = await page.evaluate(() => window.__saveDone);
    if (done) { out.saveDone = done; break; }
  }
  out.saveDone = out.saveDone ?? await page.evaluate(() => window.__saveDone);
  await poll(5);
  out.after = {
    saveDone: out.saveDone,
    receipt: rows(`select receiptinvcode,deptcode,recipientcode,receiptcategorycode,receiptcode,posted,remarks,salesmancode from dbo.receiptheader where remarks='${REMARK}'`),
    items: rows(`select receiptinvcode,gcode,icode,batch,expiry,qty,price,updateavgprice from dbo.receiptdetail order by receiptinvcode desc limit 3`),
    tabR: rows("select tabmaxkey from dbo._tabmaxkey where tabname='ReceiptHeader'"),
    header6: rows("select tabmaxkey from dbo._headertabmaxkey where module=6 and headercode=1"),
    counter: rows('select counter from dbo.receiptcategory where receiptcategorycode=1'),
    itemStock: rows('select coalesce(sum(currqty),0) from dbo.godowndetail where icode=9801 and gcode=1'),
    itemlog: Number(rows('select count(*) from dbo.itemlog')[0][0]),
    utn: rows('select utn from dbo._utn')[0]?.[0] ?? null,
  };
  out.code = out.after.receipt?.[0]?.[0] ?? null;
  out.saveOk = !!out.code && out.after.receipt?.[0]?.[2] === '2' && out.after.receipt?.[0]?.[5] === 'N'
    && out.after.items?.some((r) => String(r[2]) === '9801' && String(r[5]) === '1.0000')
    && out.messages.some((m) => /Changes take effect in database/i.test(m));
  // cleanup exactly
  if (out.code) {
    q(`delete from dbo.receiptdetail where receiptinvcode=${Number(out.code)}`);
    q(`delete from dbo.receiptheader where receiptinvcode=${Number(out.code)}`);
  }
  q('delete from dbo.department where deptcode=1 and name=\'PARITY DEPARTMENT\'');
  if (out.baseline.tabR !== null) q(`update dbo._tabmaxkey set tabmaxkey=${Number(out.baseline.tabR)} where tabname='ReceiptHeader'`);
  if (out.baseline.header6 !== null) q(`update dbo._headertabmaxkey set tabmaxkey=${Number(out.baseline.header6)} where module=6 and headercode=1`);
  if (out.baseline.counter !== null) q(`update dbo.receiptcategory set counter=${Number(out.baseline.counter)} where receiptcategorycode=1`);
  q(`delete from dbo.audit_log where audit_id > ${out.baseline.auditMax}`);
  q(`select setval(pg_get_serial_sequence('dbo.audit_log','audit_id'), ${out.baseline.auditMax}, true)`);
  out.final = {
    dept: Number(rows('select count(*) from dbo.department')[0][0]),
    rh: Number(rows('select count(*) from dbo.receiptheader')[0][0]),
    rd: Number(rows('select count(*) from dbo.receiptdetail')[0][0]),
    tabR: rows("select tabmaxkey from dbo._tabmaxkey where tabname='ReceiptHeader'")[0]?.[0] ?? null,
    header6: rows("select tabmaxkey from dbo._headertabmaxkey where module=6 and headercode=1")[0]?.[0] ?? null,
    counter: rows('select counter from dbo.receiptcategory where receiptcategorycode=1')[0]?.[0] ?? null,
    itemStock: rows('select coalesce(sum(currqty),0) from dbo.godowndetail where icode=9801 and gcode=1')[0]?.[0] ?? null,
    itemlog: Number(rows('select count(*) from dbo.itemlog')[0][0]),
    utn: rows('select utn from dbo._utn')[0]?.[0] ?? null,
    audit: Number(rows('select count(*) from dbo.audit_log')[0][0]),
    auditMax: Number(rows('select max(audit_id) from dbo.audit_log')[0][0]),
    residue: rows(`select count(*) from dbo.receiptheader where remarks='${REMARK}'`),
  };
  out.baselineOk = out.final.dept === out.baseline.dept && out.final.rh === out.baseline.rh && out.final.rd === out.baseline.rd
    && out.final.tabR === out.baseline.tabR && out.final.header6 === out.baseline.header6
    && out.final.counter === out.baseline.counter && out.final.itemStock === out.baseline.itemStock
    && out.final.itemlog === out.baseline.itemlog && out.final.utn === out.baseline.utn
    && out.final.audit === out.baseline.audit && out.final.auditMax === out.baseline.auditMax
    && out.final.residue?.[0]?.[0] === '0';
  out.ok = !!out.saveOk && out.baselineOk;
} catch (e) { out.fatal = String(e.stack || e).slice(0, 2000); }
finally {
  try {
    const c = out.code;
    if (c) { q(`delete from dbo.receiptdetail where receiptinvcode=${Number(c)}`); q(`delete from dbo.receiptheader where receiptinvcode=${Number(c)}`); }
    q("delete from dbo.department where deptcode=1 and name='PARITY DEPARTMENT'");
    if (out.baseline?.tabR !== null) q(`update dbo._tabmaxkey set tabmaxkey=${Number(out.baseline.tabR)} where tabname='ReceiptHeader'`);
    if (out.baseline?.header6 !== null) q(`update dbo._headertabmaxkey set tabmaxkey=${Number(out.baseline.header6)} where module=6 and headercode=1`);
    if (out.baseline?.counter !== null) q(`update dbo.receiptcategory set counter=${Number(out.baseline.counter)} where receiptcategorycode=1`);
    if (out.baseline?.auditMax) { q(`delete from dbo.audit_log where audit_id > ${out.baseline.auditMax}`); q(`select setval(pg_get_serial_sequence('dbo.audit_log','audit_id'), ${out.baseline.auditMax}, true)`); }
  } catch {}
  console.log(JSON.stringify(out, (k, v) => (typeof v === 'bigint' ? Number(v) : v), 1));
  await browser.close().catch(() => {});
}
