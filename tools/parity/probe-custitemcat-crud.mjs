// CustItemCatAssociation nested feature on a temporary customer.
//
// The Customer Form owns a hidden d_custitemcatassociation DataWindow
// (`id_cust_itemcat_association`).  Menu m_setitemcategories opens
// w_custitemcatassociation_form with that DataWindow shared.  The customer
// save chain calls id_cust_itemcat_association.update() (default resetflag),
// so the association buffer is reset after a successful save.
//
// The probe creates a temporary customer through the verified add flow,
// creates a temporary ItemCategory (8) via SQL, adds (customer, 8) through the
// nested popup, saves, then deletes the association through the nested buffer,
// restores a harmless customer edit, deletes the customer, and restores every
// row/counter/audit entry.
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const require = createRequire(process.env.PLAYWRIGHT_MODULES || 'C:/Users/Admin/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/');
const { chromium } = require('playwright');
const PSQL = 'C:\\PostgreSQL\\17\\bin\\psql.exe';
const q = (sql) => execFileSync(PSQL, ['-U', 'postgres', '-h', '127.0.0.1', '-d', 'trader_write_test', '-t', '-A', '-F', '|', '-c', sql], { env: { ...process.env, PGPASSWORD: 'postgres' }, encoding: 'utf8', windowsHide: true }).trim();
const rows = (sql) => q(sql).split(/\r?\n/).filter(Boolean).map((l) => l.split('|'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SUF = String(Date.now()).slice(-6);
const NAME = 'PARITY CUST ITEMCAT ' + SUF;
const ALIAS = 'PZIC' + SUF;
const CATNAME = 'PARITY TEMP CAT ' + SUF;
const CATCODE = 8;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const out = { name: NAME, category: CATNAME, messages: [], errors: [], net: [] };
page.on('pageerror', (e) => out.errors.push(String(e.message || e).slice(0, 500)));
page.on('request', (r) => { if (r.url().includes('/api/exec')) out.net.push({ p: 'req', body: String(r.postData() || '') }) });
page.on('response', async (r) => { if (r.url().includes('/api/exec')) { let b = ''; try { b = await r.text() } catch {} out.net.push({ p: 'res', status: r.status(), body: String(b).slice(0, 400) }) } });
async function dismiss(chooseYes = false) {
  for (let i = 0; i < 40; i++) {
    const n = await page.evaluate(() => document.querySelectorAll('.msgbox').length);
    if (!n) break;
    const m = await page.evaluate((yes) => {
      const b = document.querySelector('.msgbox');
      const bs = [...b.querySelectorAll('.btns button')];
      const pick = (yes && bs.find((x) => /^yes$/i.test(x.textContent.trim()))) || bs.find((x) => /^(ok|no|cancel|close)$/i.test(x.textContent.trim())) || bs[0];
      const t = (b.querySelector('.txt')?.textContent || '').replace(/\s+/g, ' ').trim();
      pick?.click();
      return t;
    }, chooseYes);
    if (m) out.messages.push(m);
    await sleep(150);
  }
}
async function runSave(key) {
  await page.evaluate(async (k) => {
    const rt = window.rt; const w = rt.windowInstances.get('w_customer_form');
    window[k] = false;
    void w.pbCall('ue_save', [], rt).then((v) => { window[k] = String(v) }).catch((e) => { window[k] = 'ERR ' + String(e.message || e).slice(0, 400) });
  }, key);
  for (let i = 0; i < 36; i++) {
    await sleep(500);
    await dismiss();
    const d = await page.evaluate((k) => window[k], key);
    if (d) return d;
  }
  return await page.evaluate((k) => window[k], key);
}
const fireMenu = async (name) => await page.evaluate((n) => {
  const rt = window.rt; const w = rt.windowInstances.get('w_customer_form');
  const menu = w.props.get('menuid') || w.props.get('im_menu');
  let hit = null;
  const walk = (o) => { for (const c of o.children.values()) { if (c.name === n) hit = c; walk(c) } };
  if (menu) walk(menu);
  if (!hit) return { error: 'menu item not found: ' + n };
  void rt.fire(hit, 'clicked').catch(() => {});
  return { fired: true, text: String(hit.props.get('text') ?? ''), visible: hit.props.get('visible') !== false };
}, name);
const customerBy = () => rows(`select acccode,name from dbo.accounts where name='${NAME.replace(/'/g, "''")}'`);
const restore = () => {
  try {
    q(`delete from dbo.custitemcatassociation where custcode in (select acccode from dbo.accounts where name='${NAME.replace(/'/g, "''")}')`);
    q(`delete from dbo.customer where custcode in (select acccode from dbo.accounts where name='${NAME.replace(/'/g, "''")}')`);
    q(`delete from dbo.accounts where name='${NAME.replace(/'/g, "''")}'`);
    q(`delete from dbo.itemcategory where icatcode=${CATCODE} and name='${CATNAME.replace(/'/g, "''")}'`);
    if (out.baseline?.tabAccounts !== null) q(`update dbo._tabmaxkey set tabmaxkey=${Number(out.baseline.tabAccounts)} where tabname='Accounts'`);
    if (out.baseline?.tabItemCategory !== null) q(`update dbo._tabmaxkey set tabmaxkey=${Number(out.baseline.tabItemCategory)} where tabname='ItemCategory'`);
    if (out.baseline?.auditMax) { q(`delete from dbo.audit_log where audit_id > ${out.baseline.auditMax}`); q(`select setval(pg_get_serial_sequence('dbo.audit_log','audit_id'), ${out.baseline.auditMax}, true)`); }
  } catch (e) { out.restoreError = String(e.message || e).slice(0, 500); }
};
try {
  out.baseline = {
    accounts: Number(rows('select count(*) from dbo.accounts')[0][0]),
    accountsMax: Number(rows('select max(acccode) from dbo.accounts')[0][0]),
    customer: Number(rows('select count(*) from dbo.customer')[0][0]),
    customerMax: Number(rows('select max(custcode) from dbo.customer')[0][0]),
    assoc: Number(rows('select count(*) from dbo.custitemcatassociation')[0][0]),
    itemcategory: Number(rows('select count(*) from dbo.itemcategory')[0][0]),
    itemcatRows: rows('select icatcode,name from dbo.itemcategory order by icatcode'),
    tabAccounts: rows("select tabmaxkey from dbo._tabmaxkey where tabname='Accounts'")[0]?.[0] ?? null,
    tabItemCategory: rows("select tabmaxkey from dbo._tabmaxkey where tabname='ItemCategory'")[0]?.[0] ?? null,
    audit: Number(rows('select count(*) from dbo.audit_log')[0][0]),
    auditMax: Number(rows('select max(audit_id) from dbo.audit_log')[0][0]),
  };
  q(`insert into dbo.itemcategory (icatcode,name,categorysegmentcode) values (${CATCODE},'${CATNAME.replace(/'/g, "''")}',1)`);
  await page.goto('http://127.0.0.1:5177/?app=1&autologin=ADMIN:password9080', { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.rt && window.rt.windowInstances.get('w_main') && typeof window.__menu === 'function', null, { timeout: 90000, polling: 300 });
  await page.evaluate(() => { void window.__menu('Basic Data | Customer .......... | Customer') });
  await page.waitForFunction(() => window.rt.windowInstances.get('w_customer_form'), null, { timeout: 30000, polling: 300 });
  await sleep(1200); await dismiss();
  out.open = await page.evaluate(() => {
    const w = window.rt.windowInstances.get('w_customer_form');
    return {
      title: String(w.props.get('title') ?? ''),
      detailRows: w.props.get('id_detail')?.model?.rowCount?.() ?? null,
      assocRows: w.props.get('id_cust_itemcat_association')?.model?.rowCount?.() ?? null,
    };
  });
  out.fill = await page.evaluate(async ({ name, alias }) => {
    const rt = window.rt; const w = rt.windowInstances.get('w_customer_form');
    const d = w.props.get('id_detail');
    if (d.model.rowCount() === 0) await d.pbCall('insertrow', [0], rt);
    const fields = {
      accounts_name: name, accounts_aliasname: alias, accounts_subcode: 3, accounts_active: 'Y', accounts_alertcode: 1,
      customer_areacode: 1, customer_subareacode: 1, customer_custcatcode: 1, customer_city: 'KARACHI', customer_country: 'PAKISTAN',
      customer_phone: '03001234567', customer_cellno: '03001234567', customer_crlimit: 0, customer_dayslimit: 0, customer_criticallimit: 0,
      customer_customersectorcode: 1, customer_taxcategorycode: 1, customer_defaultgst: 1, customer_salesmancode: 1,
      customer_collectionpolicycode: 1, customer_defaultsaleprice: 1, customer_defaultitemdiscperc: 1,
      customer_gender: 'M', customer_ageinyears: 25, customer_schedforposting: 'Y',
      customer_allowsalebelowavgprice: 'N', customer_considerinpo: 'N', customer_saletypecode: 1,
      customer_address: 'PARITY ADDRESS', customer_address1: 'PARITY ADDRESS', customer_owner: 'PARITY OWNER',
      customer_fullname: name, customer_issuedlicenseno: 'PARITY LICENSE', customer_salestaxexemption: 'N',
      customer_printoutstandingserviceresult: 'N', customer_printamtonserviceinv: 'N', customer_printbalance: 'N', customer_printwaranty: 'N',
    };
    const bad = [];
    for (const [k, v] of Object.entries(fields)) {
      try { await d.pbCall('setitem', [1, k, v], rt) } catch { bad.push(k) }
    }
    await d.pbCall('setrow', [1], rt);
    await d.pbCall('accepttext', [], rt).catch(() => {});
    return { rows: d.model.rowCount(), bad, city: String(d.model.buf.primary[0]?.v?.[d.model.colIndex('customer_city')] ?? '') };
  }, { name: NAME, alias: ALIAS });
  await dismiss();
  out.fire = await fireMenu('m_setitemcategories');
  await page.waitForFunction(() => window.rt.windowInstances.get('w_custitemcatassociation_form'), null, { timeout: 30000, polling: 300 });
  await sleep(800);
  out.addAssoc = await page.evaluate(async (cat) => {
    const rt = window.rt; const w = rt.windowInstances.get('w_custitemcatassociation_form');
    const d = w.children.get('dw_viewheader') || w.props.get('id_header');
    const m = d.model;
    let row = 0;
    for (const [i, r] of m.buf.primary.entries()) if (r.v[m.colIndex('icatcode')] === null || r.v[m.colIndex('icatcode')] === undefined) { row = i + 1; break }
    if (!row) { await d.pbCall('insertrow', [0], rt); row = m.rowCount(); }
    await d.pbCall('setitem', [row, 'icatcode', cat], rt);
    await d.pbCall('accepttext', [], rt).catch(() => {});
    await d.pbCall('setrow', [row], rt).catch(() => {});
    await w.pbCall('ue_close', [-1], rt).catch(() => {});
    await new Promise((r) => setTimeout(r, 600));
    return { row, rows: m.rowCount(), cols: m.colNames, values: m.buf.primary.map((r) => r.v) };
  }, CATCODE);
  await dismiss();
  out.parentAssoc = await page.evaluate(() => {
    const w = window.rt.windowInstances.get('w_customer_form');
    const d = w.props.get('id_cust_itemcat_association');
    if (!d?.model) return { error: 'no parent assoc dw' };
    return { rows: d.model.rowCount(), values: d.model.buf.primary.map((r) => r.v), statuses: d.model.buf.primary.map((_, i) => d.model.getStatus(i + 1, 0)) };
  });
  out.save1 = await runSave('__save1');
  const account = customerBy();
  out.code = account?.[0]?.[0] ?? null;
  out.afterAdd = {
    account,
    customer: out.code ? rows(`select custcode,fullname,city from dbo.customer where custcode=${Number(out.code)}`) : [],
    assoc: out.code ? rows(`select custcode,icatcode from dbo.custitemcatassociation where custcode=${Number(out.code)} order by icatcode`) : [],
    tabAccounts: rows("select tabmaxkey from dbo._tabmaxkey where tabname='Accounts'"),
  };
  out.addOk = !!out.code && out.afterAdd.customer?.length === 1 && out.afterAdd.assoc?.some((r) => String(r[1]) === String(CATCODE))
    && out.messages.some((m) => /Changes take effect in database/i.test(m));
  out.assocBufferAfterSave = await page.evaluate(() => {
    const w = window.rt.windowInstances.get('w_customer_form');
    const d = w.props.get('id_cust_itemcat_association');
    return d?.model ? { rows: d.model.rowCount(), values: d.model.buf.primary.map((r) => r.v), statuses: d.model.buf.primary.map((_, i) => d.model.getStatus(i + 1, 0)) } : null;
  });
  // delete the association through the nested buffer and restore the city
  out.assocDelete = await page.evaluate(async (cat) => {
    const rt = window.rt; const w = rt.windowInstances.get('w_customer_form');
    const d = w.props.get('id_cust_itemcat_association');
    let row = 0;
    if (d?.model) { const ci = d.model.colIndex('icatcode'); for (const [i, r] of d.model.buf.primary.entries()) if (Number(r.v[ci]) === cat) { row = i + 1; break } }
    if (row) await d.pbCall('deleterow', [row], rt).catch(() => {});
    const det = w.props.get('id_detail');
    await det.pbCall('setitem', [1, 'customer_city', 'LAHORE'], rt).catch(() => {});
    await det.pbCall('accepttext', [], rt).catch(() => {});
    return { row, rows: d?.model?.rowCount() };
  }, CATCODE);
  out.save2 = await runSave('__save2');
  out.afterDeleteAssoc = {
    assoc: out.code ? rows(`select count(*) from dbo.custitemcatassociation where custcode=${Number(out.code)}`) : [],
    customer: out.code ? rows(`select custcode,city from dbo.customer where custcode=${Number(out.code)}`) : [],
  };
  out.deleteAssocOk = out.afterDeleteAssoc.assoc?.[0]?.[0] === '0' && out.afterDeleteAssoc.customer?.[0]?.[1] === 'LAHORE';
  // delete the temporary customer through the window's own event
  out.del = await page.evaluate(async () => { const rt = window.rt; const w = rt.windowInstances.get('w_customer_form'); void rt.fire(w, 'ue_delete').catch(() => {}); return 'fired' });
  await sleep(700); await dismiss(true); await sleep(1500); await dismiss(true);
  out.afterDeleteCustomer = {
    account: customerBy(),
    customer: out.code ? rows(`select custcode,fullname from dbo.customer where custcode=${Number(out.code)}`) : [],
    assoc: out.code ? rows(`select count(*) from dbo.custitemcatassociation where custcode=${Number(out.code)}`) : [],
  };
  out.deleteCustomerOk = out.afterDeleteCustomer.account?.length === 0 && out.afterDeleteCustomer.customer?.length === 0;
  out.customerDeleteBlocked = out.messages.some((m) => /refering to this record exists|referring to this record exists/i.test(m));
  out.customerDeleteOutcome = { deleted: out.deleteCustomerOk, blocked: out.customerDeleteBlocked };
  restore();
  out.final = {
    accounts: Number(rows('select count(*) from dbo.accounts')[0][0]),
    accountsMax: Number(rows('select max(acccode) from dbo.accounts')[0][0]),
    customer: Number(rows('select count(*) from dbo.customer')[0][0]),
    customerMax: Number(rows('select max(custcode) from dbo.customer')[0][0]),
    assoc: Number(rows('select count(*) from dbo.custitemcatassociation')[0][0]),
    itemcategory: Number(rows('select count(*) from dbo.itemcategory')[0][0]),
    itemcatRows: rows('select icatcode,name from dbo.itemcategory order by icatcode'),
    tabAccounts: rows("select tabmaxkey from dbo._tabmaxkey where tabname='Accounts'")[0]?.[0] ?? null,
    tabItemCategory: rows("select tabmaxkey from dbo._tabmaxkey where tabname='ItemCategory'")[0]?.[0] ?? null,
    audit: Number(rows('select count(*) from dbo.audit_log')[0][0]),
    auditMax: Number(rows('select max(audit_id) from dbo.audit_log')[0][0]),
    residueName: rows(`select count(*) from dbo.accounts where name='${NAME.replace(/'/g, "''")}'`),
    residueCat: rows(`select count(*) from dbo.itemcategory where name='${CATNAME.replace(/'/g, "''")}'`),
  };
  out.baselineOk = out.final.accounts === out.baseline.accounts && out.final.accountsMax === out.baseline.accountsMax
    && out.final.customer === out.baseline.customer && out.final.customerMax === out.baseline.customerMax
    && out.final.assoc === out.baseline.assoc && out.final.itemcategory === out.baseline.itemcategory
    && JSON.stringify(out.final.itemcatRows) === JSON.stringify(out.baseline.itemcatRows)
    && out.final.tabAccounts === out.baseline.tabAccounts && out.final.tabItemCategory === out.baseline.tabItemCategory
    && out.final.audit === out.baseline.audit && out.final.auditMax === out.baseline.auditMax
    && out.final.residueName?.[0]?.[0] === '0' && out.final.residueCat?.[0]?.[0] === '0';
  out.ok = !!out.addOk && !!out.deleteAssocOk && out.baselineOk;
} catch (e) { out.fatal = String(e.stack || e).slice(0, 2400); }
finally {
  restore();
  console.log(JSON.stringify(out, (k, v) => (typeof v === 'bigint' ? Number(v) : v), 1));
  await browser.close().catch(() => {});
}
