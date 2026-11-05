// Sale Order add/edit/save and delete-state probe.
// SaleOrderCategory 1 is posted; header/detail are empty.  Save uses
// AskUserPwdInSaleOrder=Y.  Soft delete needs right 572/573, which do not
// exist in the Rights catalog, so delete should be a measured rights rejection.
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const require = createRequire(process.env.PLAYWRIGHT_MODULES || 'C:/Users/Admin/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/');
const { chromium } = require('playwright');
const PSQL = 'C:\\PostgreSQL\\17\\bin\\psql.exe';
const q = (sql) => execFileSync(PSQL, ['-U', 'postgres', '-h', '127.0.0.1', '-d', 'trader_write_test', '-t', '-A', '-F', '|', '-c', sql], { env: { ...process.env, PGPASSWORD: 'postgres' }, encoding: 'utf8', windowsHide: true }).trim();
const rows = (sql) => q(sql).split(/\r?\n/).filter(Boolean).map((l) => l.split('|'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const REMARK = 'PARITY SALEORDER ' + String(Date.now()).slice(-6);
const REMARK2 = REMARK + ' EDIT';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const out = { remark: REMARK, remark2: REMARK2, messages: [], errors: [], net: [] };
page.on('pageerror', (e) => out.errors.push(String(e.message || e).slice(0, 500)));
page.on('request', (r) => { if (r.url().includes('/api/exec')) out.net.push({ p: 'req', body: String(r.postData() || '') }) });
page.on('response', async (r) => { if (r.url().includes('/api/exec')) { let b = ''; try { b = await r.text() } catch {} out.net.push({ p: 'res', status: r.status(), body: String(b).slice(0, 300) }) } });
async function poll(seconds = 8) {
  for (let i = 0; i < seconds * 2; i++) {
    await sleep(500);
    const msgs = await page.evaluate(() => [...document.querySelectorAll('.msgbox .txt')].map((e) => e.textContent.replace(/\s+/g, ' ').trim().slice(0, 260)));
    if (msgs.length) {
      out.messages.push(...msgs);
      await page.evaluate(() => { for (const b of document.querySelectorAll('.msgbox')) { const bs = [...b.querySelectorAll('.btns button')]; (bs.find((x) => /^(yes|ok)$/i.test(x.textContent.trim())) || bs[0])?.click(); } });
      await sleep(250);
    }
  }
}
async function runSave() {
  await page.evaluate(async () => {
    const rt = window.rt; const w = rt.windowInstances.get('w_salesorder');
    window.__saveDone = false;
    void w.pbCall('ue_save', [], rt).then(() => { window.__saveDone = 'ok' }).catch((e) => { window.__saveDone = 'ERR ' + String(e.message || e).slice(0, 500) });
  });
  for (let i = 0; i < 90; i++) {
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
    if (done) { await poll(4); return done; }
  }
  return await page.evaluate(() => window.__saveDone);
}
const restore = () => {
  try {
    q(`delete from dbo.saleorderdetail where saleordercode in (select saleordercode from dbo.saleorderheader where remarks like 'PARITY SALEORDER %')`);
    q(`delete from dbo.saleorderheader where remarks like 'PARITY SALEORDER %'`);
    if (out.baseline?.tab !== null) q(`update dbo._tabmaxkey set tabmaxkey=${Number(out.baseline.tab)} where tabname='SaleOrderHeader'`);
    if (out.baseline?.counter !== null) q(`update dbo.saleordercategory set counter=${Number(out.baseline.counter)} where socatcode=1`);
    if (out.baseline?.auditMax) { q(`delete from dbo.audit_log where audit_id > ${out.baseline.auditMax}`); q(`select setval(pg_get_serial_sequence('dbo.audit_log','audit_id'), ${out.baseline.auditMax}, true)`); }
  } catch (e) { out.restoreError = String(e.message || e).slice(0, 500); }
};
try {
  out.baseline = {
    soh: Number(rows('select count(*) from dbo.saleorderheader')[0][0]),
    sod: Number(rows('select count(*) from dbo.saleorderdetail')[0][0]),
    tab: rows("select tabmaxkey from dbo._tabmaxkey where tabname='SaleOrderHeader'")[0]?.[0] ?? null,
    counter: rows('select counter from dbo.saleordercategory where socatcode=1')[0]?.[0] ?? null,
    stock: rows('select coalesce(sum(currqty),0) from dbo.godowndetail where icode=9801 and gcode=1')[0]?.[0] ?? null,
    itemlog: Number(rows('select count(*) from dbo.itemlog')[0][0]),
    utn: rows('select utn from dbo._utn')[0]?.[0] ?? null,
    audit: Number(rows('select count(*) from dbo.audit_log')[0][0]),
    auditMax: Number(rows('select max(audit_id) from dbo.audit_log')[0][0]),
  };
  await page.goto('http://127.0.0.1:5177/?app=1&autologin=ADMIN:password9080', { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.rt && window.rt.windowInstances.get('w_main') && typeof window.__menu === 'function', null, { timeout: 90000, polling: 300 });
  out.menuOpen = await page.evaluate(async () => {
    const rt = window.rt; const root = rt.windowInstances.get('w_main')?.props.get('menuid');
    const find = (o, n) => { for (const c of o.children.values()) { if (c.name === n) return c; const r = find(c, n); if (r) return r } return null };
    const item = root ? find(root, 'm_saleorder') : null;
    if (!item) return { found: false };
    await rt.fire(item, 'selected').catch(() => {});
    await rt.fire(item, 'clicked').catch((e) => { window.__menuErr = String(e.message || e) });
    return { found: true, visible: item.props.get('visible'), text: String(item.props.get('text') ?? '') };
  });
  await page.waitForFunction(() => window.rt.windowInstances.get('w_salesorder'), null, { timeout: 40000, polling: 300 });
  await sleep(1800); await poll(3);
  await page.evaluate(async () => { const rt = window.rt; const w = rt.windowInstances.get('w_salesorder'); await w.pbCall('ue_newform', [], rt).catch(() => {}) });
  await sleep(1200); await poll(2);
  out.open = await page.evaluate(() => {
    const rt = window.rt; const w = rt.windowInstances.get('w_salesorder');
    const m = w.props.get('id_master'); const d = w.props.get('id_detail'); const f = w.props.get('id_footer');
    return {
      title: String(w.props.get('title') ?? ''),
      masterRows: m?.model?.rowCount?.() ?? null, masterCols: m?.model?.colNames ?? null,
      detailRows: d?.model?.rowCount?.() ?? null, detailCols: d?.model?.colNames ?? null,
      footerRows: f?.model?.rowCount?.() ?? null, footerCols: f?.model?.colNames ?? null,
    };
  });
  out.fill = await page.evaluate(async ({ remark }) => {
    const rt = window.rt; const w = rt.windowInstances.get('w_salesorder');
    const m = w.props.get('id_master'); const d = w.props.get('id_detail'); const f = w.props.get('id_footer');
    if (!m?.model || !d?.model) return { error: 'missing master/detail' };
    if (m.model.rowCount() === 0) await m.pbCall('insertrow', [0], rt);
    for (const [n, v] of Object.entries({ custcode: 22, socatcode: 1, usercode: 1, headerno: 1, posted: 'N', finalized: 'N', deleted: 'N', remarks: remark })) await m.pbCall('setitem', [1, n, v], rt).catch(() => {});
    if (d.model.rowCount() === 0) await d.pbCall('insertrow', [0], rt);
    for (const [n, v] of Object.entries({ icode: 9801, itemname: 'FACE MASK', gcode: 1, rowid: 1, looseqty: 1, packunits: 1, saleprice: 10, avgprice: 4.87463, rate: 0, discperc: 0, itemflatdisc: 0, unitsalestax: 0, gstperc: 0, claimable: 'N' })) await d.pbCall('setitem', [1, n, v], rt).catch(() => {});
    if (f?.model) {
      if (f.model.rowCount() === 0) await f.pbCall('insertrow', [0], rt).catch(() => {});
      for (const [n, v] of Object.entries({ invdiscperc: 0, flatdisc: 0, misccharges: 0, invgstperc1: 0 })) await f.pbCall('setitem', [1, n, v], rt).catch(() => {});
    }
    w.props.set('ib_itemvalidated', true);
    w.props.set('il_currrow', 1);
    await m.pbCall('accepttext', [], rt).catch(() => {});
    await d.pbCall('accepttext', [], rt).catch(() => {});
    if (f?.model) await f.pbCall('accepttext', [], rt).catch(() => {});
    await w.pbCall('wf_grandtotal', [], rt).catch(() => {});
    return { master: m.model.buf.primary[0]?.v?.slice(0, 20), detail: d.model.buf.primary[0]?.v?.slice(0, 25), footer: f?.model?.buf?.primary?.[0]?.v };
  }, { remark: REMARK });
  out.save1 = await runSave();
  out.afterAdd = {
    saveDone: out.save1,
    header: rows(`select saleordercode,custcode,usercode,socatcode,posted,finalized,deleted,remarks from dbo.saleorderheader where remarks='${REMARK}'`),
    detail: rows(`select saleordercode,icode,gcode,rowid,looseqty,saleprice from dbo.saleorderdetail order by saleordercode desc limit 3`),
    tab: rows("select tabmaxkey from dbo._tabmaxkey where tabname='SaleOrderHeader'"),
    counter: rows('select counter from dbo.saleordercategory where socatcode=1'),
  };
  out.code = out.afterAdd.header?.[0]?.[0] ?? null;
  out.addOk = !!out.code && out.afterAdd.header?.[0]?.[4] === 'N' && out.afterAdd.detail?.some((r) => String(r[1]) === '9801')
    && out.afterAdd.tab?.[0]?.[0] === String(Number(out.code)) && out.afterAdd.counter?.[0]?.[0] === '1'
    && out.messages.some((m) => /Changes take effect in database|Saved|Success/i.test(m));
  // edit through the list -> ue_detail path, forcing modify if needed
  if (out.code) {
    await page.evaluate(async () => { const rt = window.rt; const w = rt.windowInstances.get('w_salesorder'); await w.pbCall('ue_list', [], rt).catch(() => {}) });
    await sleep(1800); await poll(2);
    out.list = await page.evaluate((code) => {
      const rt = window.rt; const w = rt.windowInstances.get('w_salesorder');
      const l = w.props.get('id_list');
      let idx = 0;
      if (l?.model) {
        const ci = l.model.colIndex('code');
        for (let i = 0; i < l.model.buf.primary.length; i++) if (Number(l.model.buf.primary[i].v[ci]) === Number(code)) { idx = i + 1; break; }
      }
      w.props.set('il_selectedrow', idx);
      return { rows: l?.model?.rowCount?.() ?? null, idx };
    }, Number(out.code));
    out.detail = await page.evaluate(async () => {
      const rt = window.rt; const w = rt.windowInstances.get('w_salesorder');
      w.props.set('ib_modify', true);
      try { await w.pbCall('ue_detail', [], rt) } catch (e) { window.__detailErr = String(e.message || e).slice(0, 200) }
      const m = w.props.get('id_master'); const d = w.props.get('id_detail');
      return { ib_modify: w.props.get('ib_modify'), masterRows: m?.model?.rowCount?.() ?? null, detailRows: d?.model?.rowCount?.() ?? null, code: m?.model ? String(m.model.buf.primary[0]?.v?.[m.model.colIndex('code')] ?? '') : null };
    });
    out.tabState = await page.evaluate(async () => {
      const rt = window.rt; const w = rt.windowInstances.get('w_salesorder');
      const tab = w.children.get('tab_retrieve') || [...w.children.values()].find((c) => c.native === 'tab');
      if (tab) tab.pbSet('selectedtab', 1);
      await new Promise((r) => setTimeout(r, 300));
      return { selectedtab: Number(tab?.props.get('selectedtab') ?? 0), editflag: w.props.get('editflag') };
    });
    await sleep(900); await poll(2);    out.editFill = await page.evaluate(async ({ remark2 }) => {
      const rt = window.rt; const w = rt.windowInstances.get('w_salesorder');
      const m = w.props.get('id_master'); const d = w.props.get('id_detail');
      await m.pbCall('setitem', [1, 'remarks', remark2], rt).catch(() => {});
      await d.pbCall('setitem', [1, 'looseqty', 2], rt).catch(() => {});
      await m.pbCall('accepttext', [], rt).catch(() => {});
      await d.pbCall('accepttext', [], rt).catch(() => {});
      w.props.set('editflag', true);
      return { master: m.model.buf.primary[0]?.v?.slice(0, 20), detail: d.model.buf.primary[0]?.v?.slice(0, 25) };
    }, { remark2: REMARK2 });
    out.save2 = await runSave();
    out.afterEdit = {
      saveDone: out.save2,
      header: rows(`select saleordercode,remarks,modifycounter from dbo.saleorderheader where saleordercode=${Number(out.code)}`),
      detail: rows(`select saleordercode,icode,looseqty from dbo.saleorderdetail where saleordercode=${Number(out.code)}`),
    };
    out.editOk = out.afterEdit.header?.[0]?.[1] === REMARK2 && String(out.afterEdit.detail?.[0]?.[2]) === '2.0000';
  }
  // delete: rights 572/573 do not exist, measure the rejection
  out.deleteAttempt = await page.evaluate(async () => {
    const rt = window.rt; const w = rt.windowInstances.get('w_salesorder');
    window.__delDone = false;
    void w.pbCall('ue_deleteinvoice', [], rt).then(() => { window.__delDone = 'ok' }).catch((e) => { window.__delDone = 'ERR ' + String(e.message || e).slice(0, 300) });
    return 'fired';
  });
  await poll(8);
  out.afterDelete = {
    delDone: await page.evaluate(() => window.__delDone ?? null),
    header: rows(`select saleordercode,remarks,deleted from dbo.saleorderheader where saleordercode=${Number(out.code ?? 0)}`),
  };
  out.deleteRightsBlocked = out.messages.some((m) => /Not enough rights to delete Sales Order/i.test(m));
  restore();
  out.final = {
    soh: Number(rows('select count(*) from dbo.saleorderheader')[0][0]),
    sod: Number(rows('select count(*) from dbo.saleorderdetail')[0][0]),
    tab: rows("select tabmaxkey from dbo._tabmaxkey where tabname='SaleOrderHeader'")[0]?.[0] ?? null,
    counter: rows('select counter from dbo.saleordercategory where socatcode=1')[0]?.[0] ?? null,
    stock: rows('select coalesce(sum(currqty),0) from dbo.godowndetail where icode=9801 and gcode=1')[0]?.[0] ?? null,
    itemlog: Number(rows('select count(*) from dbo.itemlog')[0][0]),
    utn: rows('select utn from dbo._utn')[0]?.[0] ?? null,
    audit: Number(rows('select count(*) from dbo.audit_log')[0][0]),
    auditMax: Number(rows('select max(audit_id) from dbo.audit_log')[0][0]),
    residue: rows(`select count(*) from dbo.saleorderheader where remarks like 'PARITY SALEORDER %'`),
  };
  out.baselineOk = out.final.soh === out.baseline.soh && out.final.sod === out.baseline.sod && out.final.tab === out.baseline.tab
    && out.final.counter === out.baseline.counter && out.final.stock === out.baseline.stock
    && out.final.itemlog === out.baseline.itemlog && out.final.utn === out.baseline.utn
    && out.final.audit === out.baseline.audit && out.final.auditMax === out.baseline.auditMax
    && out.final.residue?.[0]?.[0] === '0';
  out.ok = !!out.addOk && !!out.deleteRightsBlocked && out.baselineOk;
} catch (e) { out.fatal = String(e.stack || e).slice(0, 2400); }
finally {
  restore();
  console.log(JSON.stringify(out, (k, v) => (typeof v === 'bigint' ? Number(v) : v), 1));
  await browser.close().catch(() => {});
}
