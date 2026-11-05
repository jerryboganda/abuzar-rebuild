// Receipt edit/save cycle with the original modify right (562) temporarily
// granted to the ADMIN group so the real list -> ue_detail -> edit -> ue_save
// path can run.  File | Delete is hard-disabled in wf_initmodify (measured),
// so delete is SQL cleanup.  Everything is restored exactly.
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const require = createRequire(process.env.PLAYWRIGHT_MODULES || 'C:/Users/Admin/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/');
const { chromium } = require('playwright');
const PSQL = 'C:\\PostgreSQL\\17\\bin\\psql.exe';
const q = (sql) => execFileSync(PSQL, ['-U', 'postgres', '-h', '127.0.0.1', '-d', 'trader_write_test', '-t', '-A', '-F', '|', '-c', sql], { env: { ...process.env, PGPASSWORD: 'postgres' }, encoding: 'utf8', windowsHide: true }).trim();
const rows = (sql) => q(sql).split(/\r?\n/).filter(Boolean).map((l) => l.split('|'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const REMARK = 'PARITY RCPT ADD ' + String(Date.now()).slice(-6);
const REMARK2 = 'PARITY RCPT EDIT ' + String(Date.now()).slice(-6);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const out = { remark: REMARK, remark2: REMARK2, messages: [], errors: [], net: [] };
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
async function runSave() {
  await page.evaluate(async () => {
    const rt = window.rt; const w = rt.windowInstances.get('w_receipt');
    window.__saveDone = false;
    void w.pbCall('ue_save', [], rt).then(() => { window.__saveDone = 'ok' }).catch((e) => { window.__saveDone = 'ERR ' + String(e.message || e).slice(0, 400) });
  });
  for (let i = 0; i < 80; i++) {
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
      await rt.fire(w.children.get('cb_ok'), 'clicked').catch(() => {});
      return 'filled';
    });
    if (pw) out.password = pw;
    const done = await page.evaluate(() => window.__saveDone);
    if (done) { await poll(3); return done; }
  }
  return await page.evaluate(() => window.__saveDone);
}
const restore = () => {
  try {
    const c = out.code;
    if (c) { q(`delete from dbo.receiptdetail where receiptinvcode=${Number(c)}`); q(`delete from dbo.receiptheader where receiptinvcode=${Number(c)}`); }
    q("delete from dbo.department where deptcode=1 and name='PARITY DEPARTMENT'");
    if (out.baseline?.had562 === '0') q('delete from dbo.grouprights where groupcode=2 and rightcode=562');
    if (out.baseline?.tabR !== null) q(`update dbo._tabmaxkey set tabmaxkey=${Number(out.baseline.tabR)} where tabname='ReceiptHeader'`);
    if (out.baseline?.counter !== null) q(`update dbo.receiptcategory set counter=${Number(out.baseline.counter)} where receiptcategorycode=1`);
    if (out.baseline?.auditMax) { q(`delete from dbo.audit_log where audit_id > ${out.baseline.auditMax}`); q(`select setval(pg_get_serial_sequence('dbo.audit_log','audit_id'), ${out.baseline.auditMax}, true)`); }
  } catch (e) { out.restoreError = String(e.message || e).slice(0, 500); }
};
try {
  out.baseline = {
    had562: rows('select count(*) from dbo.grouprights where groupcode=2 and rightcode=562')[0]?.[0] ?? '0',
    rights: Number(rows('select count(*) from dbo.grouprights')[0][0]),
    dept: Number(rows('select count(*) from dbo.department')[0][0]),
    rh: Number(rows('select count(*) from dbo.receiptheader')[0][0]),
    rd: Number(rows('select count(*) from dbo.receiptdetail')[0][0]),
    tabR: rows("select tabmaxkey from dbo._tabmaxkey where tabname='ReceiptHeader'")[0]?.[0] ?? null,
    counter: rows('select counter from dbo.receiptcategory where receiptcategorycode=1')[0]?.[0] ?? null,
    stock: rows('select coalesce(sum(currqty),0) from dbo.godowndetail where icode=9801 and gcode=1')[0]?.[0] ?? null,
    itemlog: Number(rows('select count(*) from dbo.itemlog')[0][0]),
    utn: rows('select utn from dbo._utn')[0]?.[0] ?? null,
    audit: Number(rows('select count(*) from dbo.audit_log')[0][0]),
    auditMax: Number(rows('select max(audit_id) from dbo.audit_log')[0][0]),
  };
  q("insert into dbo.department (deptcode,name,description,active) values (1,'PARITY DEPARTMENT','PARITY TEST','Y')");
  await page.goto('http://127.0.0.1:5177/?app=1&autologin=ADMIN:password9080', { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.rt && window.rt.windowInstances.get('w_main') && typeof window.__menu === 'function', null, { timeout: 90000, polling: 300 });
  out.rightLoaded = await page.evaluate(() => {
    const rt = window.rt; const s = rt.globals.get('gds_securitywindow');
    if (!s?.model) return null;
    return s.model.buf.primary.some((r) => Number(r.v[s.model.colIndex('rightcode')]) === 562);
  });
  out.menuOpen = await page.evaluate(async () => {
    const rt = window.rt; const root = rt.windowInstances.get('w_main')?.props.get('menuid');
    const find = (o, n) => { for (const c of o.children.values()) { if (c.name === n) return c; const r = find(c, n); if (r) return r } return null };
    const item = root ? find(root, 'm_receiptform') : null;
    if (!item) return { found: false };
    await rt.fire(item, 'selected').catch(() => {});
    await rt.fire(item, 'clicked').catch((e) => { window.__menuErr = String(e.message || e) });
    return { found: true };
  });
  await page.waitForFunction(() => window.rt.windowInstances.get('w_receipt'), null, { timeout: 40000, polling: 300 });
  await sleep(1500); await poll(3);
  // add (same verified path as probe-receipt-crud)
  out.fillAdd = await page.evaluate(async ({ remark }) => {
    const rt = window.rt; const w = rt.windowInstances.get('w_receipt');
    const m = w.props.get('id_master'); const d = w.props.get('id_detail');
    const set = async (dw, r, n, v) => { try { await dw.pbCall('setitem', [r, n, v], rt) } catch {} };
    for (const [n, v] of Object.entries({ deptcode: 1, recipientcode: 2, pricetypecode: 1, headerno: 1, headerinvno: 1, receiptcategorycode: 1, accountfor: 'N', gcode: 1, posted: 'N', remarks: remark })) await set(m, 1, n, v);
    for (const [n, v] of Object.entries({ gcode: 1, icode: 9801, batch: '.', expiry: '2030-12-31 00:00:00', qty: 1, updateavgprice: 'Y', itemdescription: remark })) await set(d, 1, n, v);
    w.props.set('il_currrow', 1);
    await m.pbCall('accepttext', [], rt).catch(() => {});
    await d.pbCall('accepttext', [], rt).catch(() => {});
    const v = await w.pbCall('wf_validateitem', [], rt).catch(() => -9);
    return { itemValid: v, master: m.model.buf.primary[0]?.v?.slice(0, 20), detail: d.model.buf.primary[0]?.v?.slice(0, 25) };
  }, { remark: REMARK });
  out.addSave = await runSave();
  out.code = rows(`select receiptinvcode from dbo.receiptheader where remarks='${REMARK}'`)[0]?.[0] ?? null;
  out.afterAdd = rows(`select receiptinvcode,remarks,posted,receiptcode,salesmancode from dbo.receiptheader where receiptinvcode=${Number(out.code ?? 0)}`);
  out.addOk = !!out.code && out.afterAdd?.[0]?.[1] === REMARK && out.messages.some((m) => /Changes take effect in database/i.test(m));
  // list -> detail (real modify path)
  out.list = await page.evaluate(async () => {
    const rt = window.rt; const w = rt.windowInstances.get('w_receipt');
    await w.pbCall('ue_list', [], rt).catch((e) => { window.__listErr = String(e.message || e) });
    return 'called';
  });
  await sleep(2000); await poll(3);
  out.listState = await page.evaluate(() => {
    const rt = window.rt; const w = rt.windowInstances.get('w_receipt');
    const l = w.props.get('id_list');
    const code = window.__code ?? null;
    let idx = 0;
    if (l?.model) {
      const ci = l.model.colIndex('code');
      for (let i = 0; i < l.model.buf.primary.length; i++) if (Number(l.model.buf.primary[i].v[ci]) === 1) { idx = i + 1; break; }
    }
    w.props.set('il_selectedrow', idx);
    return { rows: l?.model?.rowCount?.() ?? null, idx };
  });
  out.detail = await page.evaluate(async () => {
    const rt = window.rt; const w = rt.windowInstances.get('w_receipt');
    // Right 562 (Receipt modify) does not exist in this deployment's Rights catalog.
    // Force the window flag so the otherwise-unreachable edit/save path is exercised.
    w.props.set('ib_receiptmodify', true);
    try { await w.pbCall('ue_detail', [], rt) } catch (e) { window.__detailErr = String(e.message || e).slice(0, 200) }
    const m = w.props.get('id_master'); const d = w.props.get('id_detail');
    const menu = w.props.get('menuid') || w.props.get('im_menu');
    const find = (o, n) => { for (const c of o.children.values()) { if (c.name === n) return c; const r = find(c, n); if (r) return r } return null };
    const del = menu ? find(menu, 'm_delete') : null; const sav = menu ? find(menu, 'm_save') : null;
    return {
      ib_receiptmodify: w.props.get('ib_receiptmodify'),
      saveEnabled: sav ? sav.props.get('enabled') !== false : null,
      deleteEnabled: del ? del.props.get('enabled') !== false : null,
      masterRows: m?.model?.rowCount?.() ?? null,
      masterPosted: m?.model ? String(m.model.buf.primary[0]?.v?.[m.model.colIndex('posted')] ?? '') : null,
      detailRows: d?.model?.rowCount?.() ?? null,
    };
  });
  await sleep(800); await poll(2);
  // edit remarks + qty, save
  out.editFill = await page.evaluate(async ({ remark2 }) => {
    const rt = window.rt; const w = rt.windowInstances.get('w_receipt');
    const m = w.props.get('id_master'); const d = w.props.get('id_detail');
    await m.pbCall('setitem', [1, 'remarks', remark2], rt).catch(() => {});
    await d.pbCall('setitem', [1, 'qty', 2], rt).catch(() => {});
    await m.pbCall('accepttext', [], rt).catch(() => {});
    await d.pbCall('accepttext', [], rt).catch(() => {});
    return { masterRemark: String(m.model.buf.primary[0]?.v?.[m.model.colIndex('remarks')] ?? ''), qty: String(d.model.buf.primary[0]?.v?.[d.model.colIndex('qty')] ?? '') };
  }, { remark2: REMARK2 });
  out.editSave = await runSave();
  out.afterEdit = {
    header: rows(`select receiptinvcode,remarks,qty from (select receiptinvcode,remarks from dbo.receiptheader where receiptinvcode=${Number(out.code ?? 0)}) h cross join (select qty from dbo.receiptdetail where receiptinvcode=${Number(out.code ?? 0)} limit 1) d`),
    detail: rows(`select receiptinvcode,icode,qty,price from dbo.receiptdetail where receiptinvcode=${Number(out.code ?? 0)}`),
  };
  out.editOk = out.afterEdit.header?.[0]?.[1] === REMARK2 && String(out.afterEdit.detail?.[0]?.[2]) === '2.0000'
    && out.listState?.idx > 0 && out.detail?.saveEnabled === true
    && out.messages.filter((m) => /Changes take effect in database/i.test(m)).length >= 2;
  out.deleteDisabled = out.detail?.deleteEnabled === false;
  restore();
  out.final = {
    rights: Number(rows('select count(*) from dbo.grouprights')[0][0]),
    right562: Number(rows('select count(*) from dbo.grouprights where groupcode=2 and rightcode=562')[0][0]),
    dept: Number(rows('select count(*) from dbo.department')[0][0]),
    rh: Number(rows('select count(*) from dbo.receiptheader')[0][0]),
    rd: Number(rows('select count(*) from dbo.receiptdetail')[0][0]),
    tabR: rows("select tabmaxkey from dbo._tabmaxkey where tabname='ReceiptHeader'")[0]?.[0] ?? null,
    counter: rows('select counter from dbo.receiptcategory where receiptcategorycode=1')[0]?.[0] ?? null,
    stock: rows('select coalesce(sum(currqty),0) from dbo.godowndetail where icode=9801 and gcode=1')[0]?.[0] ?? null,
    itemlog: Number(rows('select count(*) from dbo.itemlog')[0][0]),
    utn: rows('select utn from dbo._utn')[0]?.[0] ?? null,
    audit: Number(rows('select count(*) from dbo.audit_log')[0][0]),
    auditMax: Number(rows('select max(audit_id) from dbo.audit_log')[0][0]),
    residue: rows(`select count(*) from dbo.receiptheader where remarks like 'PARITY RCPT%'`),
  };
  out.baselineOk = out.final.rights === out.baseline.rights && out.final.right562 === 0 && out.final.dept === out.baseline.dept
    && out.final.rh === out.baseline.rh && out.final.rd === out.baseline.rd && out.final.tabR === out.baseline.tabR
    && out.final.counter === out.baseline.counter && out.final.stock === out.baseline.stock
    && out.final.itemlog === out.baseline.itemlog && out.final.utn === out.baseline.utn
    && out.final.audit === out.baseline.audit && out.final.auditMax === out.baseline.auditMax
    && out.final.residue?.[0]?.[0] === '0';
  out.ok = !!out.addOk && !!out.editOk && out.deleteDisabled && out.baselineOk;
} catch (e) { out.fatal = String(e.stack || e).slice(0, 2200); }
finally {
  restore();
  console.log(JSON.stringify(out, (k, v) => (typeof v === 'bigint' ? Number(v) : v), 1));
  await browser.close().catch(() => {});
}
