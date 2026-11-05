// Issue / Delivery Challan edit/save cycle.
// This deployment has IssuePosting=Y and no right 560 (Issue modify) in the
// Rights catalog, so a posted issue can never be edited here.  The probe
// temporarily sets IssuePosting=N, forces the window's ib_issuemodify flag,
// creates an UNPOSTED issue, reopens it through the list, edits remarks+qty,
// saves, then restores the preference, stock, pieces, UTN and counters.
// File | Delete is hard-disabled in wf_initmodify (measured).
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const require = createRequire(process.env.PLAYWRIGHT_MODULES || 'C:/Users/Admin/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/');
const { chromium } = require('playwright');
const PSQL = 'C:\\PostgreSQL\\17\\bin\\psql.exe';
const q = (sql) => execFileSync(PSQL, ['-U', 'postgres', '-h', '127.0.0.1', '-d', 'trader_write_test', '-t', '-A', '-F', '|', '-c', sql], { env: { ...process.env, PGPASSWORD: 'postgres' }, encoding: 'utf8', windowsHide: true }).trim();
const rows = (sql) => q(sql).split(/\r?\n/).filter(Boolean).map((l) => l.split('|'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const REMARK = 'PARITY ISS ADD ' + String(Date.now()).slice(-6);
const REMARK2 = 'PARITY ISS EDIT ' + String(Date.now()).slice(-6);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const out = { remark: REMARK, remark2: REMARK2, messages: [], errors: [], net: [] };
page.on('pageerror', (e) => out.errors.push(String(e.message || e).slice(0, 400)));
page.on('request', (r) => { if (r.url().includes('/api/exec')) out.net.push({ p: 'req', body: String(r.postData() || '') }) });
page.on('response', async (r) => { if (r.url().includes('/api/exec')) { let b = ''; try { b = await r.text() } catch {} out.net.push({ p: 'res', status: r.status(), body: String(b).slice(0, 300) }) } });
async function poll(seconds = 8) {
  for (let i = 0; i < seconds * 2; i++) {
    await sleep(500);
    const msgs = await page.evaluate(() => [...document.querySelectorAll('.msgbox .txt')].map((e) => e.textContent.replace(/\s+/g, ' ').trim().slice(0, 260)));
    if (msgs.length) {
      out.messages.push(...msgs);
      await page.evaluate(() => { for (const b of document.querySelectorAll('.msgbox')) { const bs = [...b.querySelectorAll('.btns button')]; (bs.find((x) => /^(ok|yes)$/i.test(x.textContent.trim())) || bs[0])?.click(); } });
      await sleep(250);
    }
  }
}
async function runSave() {
  await page.evaluate(async () => {
    const rt = window.rt; const w = rt.windowInstances.get('w_issue');
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
    const c = out.code;
    if (c) { q(`delete from dbo.issuedetail where issueinvcode=${Number(c)}`); q(`delete from dbo.issueheader where issueinvcode=${Number(c)}`); }
    q("delete from dbo.department where deptcode=1 and name='PARITY DEPARTMENT'");
    if (out.baseline?.prefIssuePosting !== null) q(`update dbo.softwarepreferences set prefvalue='${String(out.baseline.prefIssuePosting).replace(/'/g, "''")}' where lower(name)='issueposting'`);
    if (out.baseline?.tabI !== null) q(`update dbo._tabmaxkey set tabmaxkey=${Number(out.baseline.tabI)} where tabname='IssueHeader'`);
    if (out.baseline?.header5 !== null) q(`update dbo._headertabmaxkey set tabmaxkey=${Number(out.baseline.header5)} where module=5 and headercode=1`);
    if (out.baseline?.counter !== null) q(`update dbo.issuecategory set counter=${Number(out.baseline.counter)} where issuecategorycode=1`);
    if (out.baseline?.utn !== null) q(`update dbo._utn set utn=${Number(out.baseline.utn)}`);
    const hasG = rows("select count(*) from information_schema.tables where table_schema='dbo' and table_name='parity_issue_godown'")[0]?.[0];
    if (hasG === '1') {
      q('delete from dbo.godowndetail where icode=9801');
      q('insert into dbo.godowndetail select * from dbo.parity_issue_godown');
      q('drop table dbo.parity_issue_godown');
    }
    const hasB = rows("select count(*) from information_schema.tables where table_schema='dbo' and table_name='parity_issue_batches'")[0]?.[0];
    if (hasB === '1') {
      q('delete from dbo.itembatches where icode=9801');
      q('insert into dbo.itembatches select * from dbo.parity_issue_batches');
      q('drop table dbo.parity_issue_batches');
    }
    const s = out.itemSnap;
    if (s) q(`begin; set local session_replication_role = replica; update dbo.item set totalpieces=${Number(s[0])}, lastupdate='${String(s[1]).replace(/'/g, "''")}'::timestamp, saleprice=${s[2]}, recentpurprice=${s[3]}, avgprice=${s[4]}, purprice=${s[5]} where icode=9801; commit;`);
    if (out.baseline?.itemlogMax) q(`delete from dbo.itemlog where icode=9801 and itemrowid > ${Number(out.baseline.itemlogMax)}`);
    if (out.baseline?.auditMax) {
      q(`delete from dbo.audit_log where audit_id > ${out.baseline.auditMax}`);
      q(`select setval(pg_get_serial_sequence('dbo.audit_log','audit_id'), ${out.baseline.auditMax}, true)`);
    }
  } catch (e) { out.restoreError = String(e.message || e).slice(0, 500); }
};
try {
  out.baseline = {
    prefIssuePosting: rows("select prefvalue from dbo.softwarepreferences where lower(name)='issueposting'")[0]?.[0] ?? null,
    dept: Number(rows('select count(*) from dbo.department')[0][0]),
    ih: Number(rows('select count(*) from dbo.issueheader')[0][0]),
    id: Number(rows('select count(*) from dbo.issuedetail')[0][0]),
    tabI: rows("select tabmaxkey from dbo._tabmaxkey where tabname='IssueHeader'")[0]?.[0] ?? null,
    header5: rows("select tabmaxkey from dbo._headertabmaxkey where module=5 and headercode=1")[0]?.[0] ?? null,
    counter: rows('select counter from dbo.issuecategory where issuecategorycode=1')[0]?.[0] ?? null,
    utn: rows('select utn from dbo._utn')[0]?.[0] ?? null,
    godown: rows('select gcode,currqty::text,batch,expiry::text from dbo.godowndetail where icode=9801 order by gcode,batch,expiry'),
    itemlog: Number(rows('select count(*) from dbo.itemlog')[0][0]),
    itemlogMax: rows('select coalesce(max(itemrowid),0) from dbo.itemlog')[0]?.[0] ?? '0',
    audit: Number(rows('select count(*) from dbo.audit_log')[0][0]),
    auditMax: Number(rows('select max(audit_id) from dbo.audit_log')[0][0]),
  };
  out.itemSnap = rows('select totalpieces,lastupdate::text,saleprice,recentpurprice,avgprice,purprice from dbo.item where icode=9801')[0];
  q("update dbo.softwarepreferences set prefvalue='N' where lower(name)='issueposting'");
  q("insert into dbo.department (deptcode,name,description,active) values (1,'PARITY DEPARTMENT','PARITY TEST','Y')");
  q('drop table if exists dbo.parity_issue_godown');
  q('create table dbo.parity_issue_godown as select * from dbo.godowndetail where icode=9801');
  q('drop table if exists dbo.parity_issue_batches');
  q('create table dbo.parity_issue_batches as select * from dbo.itembatches where icode=9801');
  await page.goto('http://127.0.0.1:5177/?app=1&autologin=ADMIN:password9080', { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.rt && window.rt.windowInstances.get('w_main') && typeof window.__menu === 'function', null, { timeout: 90000, polling: 300 });
  out.menuOpen = await page.evaluate(async () => {
    const rt = window.rt; const root = rt.windowInstances.get('w_main')?.props.get('menuid');
    const find = (o, n) => { for (const c of o.children.values()) { if (c.name === n) return c; const r = find(c, n); if (r) return r } return null };
    const item = root ? find(root, 'm_issue_form') : null;
    if (!item) return { found: false };
    await rt.fire(item, 'selected').catch(() => {});
    await rt.fire(item, 'clicked').catch((e) => { window.__menuErr = String(e.message || e) });
    return { found: true };
  });
  await page.waitForFunction(() => window.rt.windowInstances.get('w_issue'), null, { timeout: 40000, polling: 300 });
  await sleep(1600); await poll(3);
  out.fillAdd = await page.evaluate(async ({ remark }) => {
    const rt = window.rt; const w = rt.windowInstances.get('w_issue');
    const m = w.props.get('id_master'); const d = w.props.get('id_detail');
    const set = async (dw, r, n, v) => { try { await dw.pbCall('setitem', [r, n, v], rt) } catch {} };
    for (const [n, v] of Object.entries({ deptcode: 1, recipientcode: 2, pricetypecode: 1, headerno: 1, headerinvno: 1, issuecategorycode: 1, accountfor: 'N', gcode: 1, smancode: 1, areacode: 1, acccode: 2, printwarranty: 'N', remarks: remark })) await set(m, 1, n, v);
    for (const [n, v] of Object.entries({ gcode: 1, icode: 9801, batch: '.', expiry: '2030-12-12 00:00:00', qty: 1, price: 10, saleprice: 10, purchaseprice: 2, avgprice: 4.87463, packunits: 1, claimable: 'N', itemdescription: remark, piecesinhand: 0, totalpieces: 0, pcs: 0, packingfactor: 1, packcapacity: 1, areavolume: 1, unitweight: 0, sectcode: null, mrpp: 10 })) await set(d, 1, n, v);
    w.props.set('il_currrow', 1);
    await m.pbCall('accepttext', [], rt).catch(() => {});
    await d.pbCall('accepttext', [], rt).catch(() => {});
    const iv = await w.pbCall('wf_validateitem', [true], rt).catch(() => -9);
    const gv = await w.pbCall('wf_validategodown', [], rt).catch(() => -9);
    return { itemValid: iv, godownValid: gv, master: m.model.buf.primary[0]?.v?.slice(0, 22), detail: d.model.buf.primary[0]?.v?.slice(0, 26) };
  }, { remark: REMARK });
  out.addSave = await runSave();
  out.code = rows(`select issueinvcode from dbo.issueheader where remarks='${REMARK}'`)[0]?.[0] ?? null;
  out.afterAdd = rows(`select issueinvcode,remarks,posted,issuecode,salesmancode from dbo.issueheader where issueinvcode=${Number(out.code ?? 0)}`);
  out.addOk = !!out.code && out.afterAdd?.[0]?.[1] === REMARK && out.afterAdd?.[0]?.[2] === 'N';
  // list -> detail (forced modify flag)
  await page.evaluate(async () => {
    const rt = window.rt; const w = rt.windowInstances.get('w_issue');
    await w.pbCall('ue_list', [], rt).catch((e) => { window.__listErr = String(e.message || e) });
  });
  await sleep(2000); await poll(3);
  out.listState = await page.evaluate(() => {
    const rt = window.rt; const w = rt.windowInstances.get('w_issue');
    const l = w.props.get('id_list');
    let idx = 0;
    if (l?.model) {
      const ci = l.model.colIndex('code');
      for (let i = 0; i < l.model.buf.primary.length; i++) if (Number(l.model.buf.primary[i].v[ci]) === 1) { idx = i + 1; break; }
    }
    w.props.set('il_selectedrow', idx);
    return { rows: l?.model?.rowCount?.() ?? null, idx };
  });
  out.detail = await page.evaluate(async () => {
    const rt = window.rt; const w = rt.windowInstances.get('w_issue');
    // Right 560 (Issue modify) does not exist in this deployment's Rights catalog.
    w.props.set('ib_issuemodify', true);
    try { await w.pbCall('ue_detail', [], rt) } catch (e) { window.__detailErr = String(e.message || e).slice(0, 200) }
    const m = w.props.get('id_master'); const d = w.props.get('id_detail');
    const menu = w.props.get('menuid') || w.props.get('im_menu');
    const find = (o, n) => { for (const c of o.children.values()) { if (c.name === n) return c; const r = find(c, n); if (r) return r } return null };
    const del = menu ? find(menu, 'm_delete') : null; const sav = menu ? find(menu, 'm_save') : null;
    return {
      ib_issuemodify: w.props.get('ib_issuemodify'), ib_modify: w.props.get('ib_modify'),
      saveEnabled: sav ? sav.props.get('enabled') !== false : null,
      deleteEnabled: del ? del.props.get('enabled') !== false : null,
      masterPosted: m?.model ? String(m.model.buf.primary[0]?.v?.[m.model.colIndex('posted')] ?? '') : null,
      detailRows: d?.model?.rowCount?.() ?? null,
    };
  });
  await sleep(800); await poll(2);
  out.editFill = await page.evaluate(async ({ remark2 }) => {
    const rt = window.rt; const w = rt.windowInstances.get('w_issue');
    const m = w.props.get('id_master'); const d = w.props.get('id_detail');
    await m.pbCall('setitem', [1, 'remarks', remark2], rt).catch(() => {});
    await d.pbCall('setitem', [1, 'qty', 2], rt).catch(() => {});
    await m.pbCall('accepttext', [], rt).catch(() => {});
    await d.pbCall('accepttext', [], rt).catch(() => {});
    return { masterRemark: String(m.model.buf.primary[0]?.v?.[m.model.colIndex('remarks')] ?? ''), qty: String(d.model.buf.primary[0]?.v?.[d.model.colIndex('qty')] ?? '') };
  }, { remark2: REMARK2 });
  out.editSave = await runSave();
  out.afterEdit = {
    header: rows(`select issueinvcode,remarks,posted,issuecode from dbo.issueheader where issueinvcode=${Number(out.code ?? 0)}`),
    detail: rows(`select issueinvcode,icode,qty,price from dbo.issuedetail where issueinvcode=${Number(out.code ?? 0)}`),
    stock: rows('select coalesce(sum(currqty),0) from dbo.godowndetail where icode=9801 and gcode=1')[0]?.[0] ?? null,
    utn: rows('select utn from dbo._utn')[0]?.[0] ?? null,
    tabI: rows("select tabmaxkey from dbo._tabmaxkey where tabname='IssueHeader'")[0]?.[0] ?? null,
    counter: rows('select counter from dbo.issuecategory where issuecategorycode=1')[0]?.[0] ?? null,
  };
  out.editOk = out.afterEdit.header?.[0]?.[1] === REMARK2 && String(out.afterEdit.detail?.[0]?.[2]) === '2.0000'
    && out.listState?.idx > 0 && out.detail?.saveEnabled === true
    && out.messages.filter((m) => /Changes take effect in database/i.test(m)).length >= 2;
  out.deleteDisabled = out.detail?.deleteEnabled === false;
  restore();
  out.final = {
    prefIssuePosting: rows("select prefvalue from dbo.softwarepreferences where lower(name)='issueposting'")[0]?.[0] ?? null,
    dept: Number(rows('select count(*) from dbo.department')[0][0]),
    ih: Number(rows('select count(*) from dbo.issueheader')[0][0]),
    id: Number(rows('select count(*) from dbo.issuedetail')[0][0]),
    tabI: rows("select tabmaxkey from dbo._tabmaxkey where tabname='IssueHeader'")[0]?.[0] ?? null,
    header5: rows("select tabmaxkey from dbo._headertabmaxkey where module=5 and headercode=1")[0]?.[0] ?? null,
    counter: rows('select counter from dbo.issuecategory where issuecategorycode=1')[0]?.[0] ?? null,
    utn: rows('select utn from dbo._utn')[0]?.[0] ?? null,
    godown: rows('select gcode,currqty::text,batch,expiry::text from dbo.godowndetail where icode=9801 order by gcode,batch,expiry'),
    item: rows('select totalpieces,lastupdate::text,saleprice,recentpurprice,avgprice,purprice from dbo.item where icode=9801'),
    itemlog: Number(rows('select count(*) from dbo.itemlog')[0][0]),
    audit: Number(rows('select count(*) from dbo.audit_log')[0][0]),
    auditMax: Number(rows('select max(audit_id) from dbo.audit_log')[0][0]),
    residue: rows(`select count(*) from dbo.issueheader where remarks like 'PARITY ISS%'`),
    scratch: rows("select count(*) from information_schema.tables where table_schema='dbo' and table_name like 'parity_issue_%'"),
  };
  out.baselineOk = out.final.prefIssuePosting === out.baseline.prefIssuePosting && out.final.dept === out.baseline.dept
    && out.final.ih === out.baseline.ih && out.final.id === out.baseline.id
    && out.final.tabI === out.baseline.tabI && out.final.header5 === out.baseline.header5 && out.final.counter === out.baseline.counter
    && out.final.utn === out.baseline.utn && JSON.stringify(out.final.godown) === JSON.stringify(out.baseline.godown)
    && JSON.stringify(out.final.item?.[0]) === JSON.stringify(out.itemSnap)
    && out.final.itemlog === out.baseline.itemlog && out.final.audit === out.baseline.audit && out.final.auditMax === out.baseline.auditMax
    && out.final.residue?.[0]?.[0] === '0' && out.final.scratch?.[0]?.[0] === '0';
  out.ok = !!out.addOk && !!out.editOk && out.deleteDisabled && out.baselineOk;
} catch (e) { out.fatal = String(e.stack || e).slice(0, 2200); }
finally {
  restore();
  console.log(JSON.stringify(out, (k, v) => (typeof v === 'bigint' ? Number(v) : v), 1));
  await browser.close().catch(() => {});
}
