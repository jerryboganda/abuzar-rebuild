// Supplier Form (Basic Data | Supplier .......... | Supplier) add/edit/detail-delete.
//
// w_supplier_manf (w_multi_entry): d_supplier_detail -> Accounts + Supplier,
// d_supmanf -> SupplierManufacturers (suppcode + manfcode).  The original
// save requires both a master change and id_detail.update() > 0, otherwise it
// rolls back.  Detail rows also push their purchase-order policy values to
// the Manufacturer table, so the probe uses manufacturer 1/2's existing
// values (45 / 30 / 1) to make that update a no-op.
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const require = createRequire(process.env.PLAYWRIGHT_MODULES || 'C:/Users/Admin/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/');
const { chromium } = require('playwright');
const PSQL = 'C:\\PostgreSQL\\17\\bin\\psql.exe';
const q = (sql) => execFileSync(PSQL, ['-U', 'postgres', '-h', '127.0.0.1', '-d', 'trader_write_test', '-t', '-A', '-F', '|', '-c', sql], { env: { ...process.env, PGPASSWORD: 'postgres' }, encoding: 'utf8', windowsHide: true }).trim();
const rows = (sql) => q(sql).split(/\r?\n/).filter(Boolean).map((l) => l.split('|'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SUF = String(Date.now()).slice(-6);
const NAME = 'PARITY SUPPLIER ' + SUF;
const ALIAS = 'PSUP' + SUF;
const ALIAS2 = ALIAS + 'E';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const out = { name: NAME, alias: ALIAS, messages: [], errors: [], net: [] };
page.on('pageerror', (e) => out.errors.push(String(e.message || e).slice(0, 500)));
page.on('request', (r) => { if (r.url().includes('/api/exec')) out.net.push({ p: 'req', body: String(r.postData() || '') }) });
page.on('response', async (r) => { if (r.url().includes('/api/exec')) { let b = ''; try { b = await r.text() } catch {} out.net.push({ p: 'res', status: r.status(), body: String(b).slice(0, 400) }) } });
async function poll(seconds = 10) {
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
async function save(key) {
  await page.evaluate(async (k) => {
    const rt = window.rt; const w = rt.windowInstances.get('w_supplier_manf');
    window[k] = false;
    void w.pbCall('ue_save', [], rt).then((v) => { window[k] = String(v) }).catch((e) => { window[k] = 'ERR ' + String(e.message || e).slice(0, 400) });
  }, key);
  await poll(12);
  return page.evaluate((k) => window[k] ?? null, key);
}
const restore = () => {
  try {
    q(`delete from dbo.suppliermanufacturers where suppcode in (select acccode from dbo.accounts where name='${NAME.replace(/'/g, "''")}')`);
    q(`delete from dbo.supplier where suppcode in (select acccode from dbo.accounts where name='${NAME.replace(/'/g, "''")}')`);
    q(`delete from dbo.accounts where name='${NAME.replace(/'/g, "''")}'`);
    if (out.baseline?.manufacturer1) q(`update dbo.manufacturer set purorderbaseperioddays=${Number(out.baseline.manufacturer1[0])}, purorderprojperioddays=${Number(out.baseline.manufacturer1[1])}, popolicycode=${Number(out.baseline.manufacturer1[2])} where manfcode=1`);
    if (out.baseline?.manufacturer2) q(`update dbo.manufacturer set purorderbaseperioddays=${Number(out.baseline.manufacturer2[0])}, purorderprojperioddays=${Number(out.baseline.manufacturer2[1])}, popolicycode=${Number(out.baseline.manufacturer2[2])} where manfcode=2`);
    if (out.baseline?.tabAccounts !== null) q(`update dbo._tabmaxkey set tabmaxkey=${Number(out.baseline.tabAccounts)} where tabname='Accounts'`);
    if (out.baseline?.auditMax) { q(`delete from dbo.audit_log where audit_id > ${out.baseline.auditMax}`); q(`select setval(pg_get_serial_sequence('dbo.audit_log','audit_id'), ${out.baseline.auditMax}, true)`); }
  } catch (e) { out.restoreError = String(e.message || e).slice(0, 500); }
};
try {
  out.baseline = {
    accounts: Number(rows('select count(*) from dbo.accounts')[0][0]),
    accountsMax: Number(rows('select max(acccode) from dbo.accounts')[0][0]),
    suppliers: Number(rows('select count(*) from dbo.supplier')[0][0]),
    supplierMax: Number(rows('select max(suppcode) from dbo.supplier')[0][0]),
    supmanf: Number(rows('select count(*) from dbo.suppliermanufacturers')[0][0]),
    tabAccounts: rows("select tabmaxkey from dbo._tabmaxkey where tabname='Accounts'")[0]?.[0] ?? null,
    manufacturer1: rows('select purorderbaseperioddays,purorderprojperioddays,popolicycode from dbo.manufacturer where manfcode=1')[0] ?? null,
    manufacturer2: rows('select purorderbaseperioddays,purorderprojperioddays,popolicycode from dbo.manufacturer where manfcode=2')[0] ?? null,
    audit: Number(rows('select count(*) from dbo.audit_log')[0][0]),
    auditMax: Number(rows('select max(audit_id) from dbo.audit_log')[0][0]),
  };
  await page.goto('http://127.0.0.1:5177/?app=1&autologin=ADMIN:password9080', { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.rt && window.rt.windowInstances.get('w_main') && typeof window.__menu === 'function', null, { timeout: 90000, polling: 300 });
  out.menu = await page.evaluate(async () => { try { await window.__menu('Basic Data | Supplier .......... | Supplier'); return 'ok'; } catch (e) { return 'ERR ' + String(e.message || e); } });
  await page.waitForFunction(() => window.rt.windowInstances.get('w_supplier_manf'), null, { timeout: 30000, polling: 300 });
  await sleep(1400); await poll(2);
  await page.evaluate(async () => { const rt = window.rt; const w = rt.windowInstances.get('w_supplier_manf'); await w.pbCall('ue_newform', [], rt).catch(() => {}) });
  await sleep(900); await poll(1);
  out.open = await page.evaluate(() => {
    const w = window.rt.windowInstances.get('w_supplier_manf');
    return { title: String(w.props.get('title') ?? ''), masterRows: w.props.get('id_master')?.model?.rowCount?.() ?? null, masterCols: w.props.get('id_master')?.model?.colNames ?? null, detailRows: w.props.get('id_detail')?.model?.rowCount?.() ?? null, detailCols: w.props.get('id_detail')?.model?.colNames ?? null };
  });
  out.fillAdd = await page.evaluate(async ({ name, alias }) => {
    const rt = window.rt; const w = rt.windowInstances.get('w_supplier_manf');
    const m = w.props.get('id_master'); const d = w.props.get('id_detail');
    if (m.model.rowCount() === 0) await m.pbCall('insertrow', [0], rt);
    const fields = {
      accounts_name: name, accounts_aliasname: alias, accounts_subcode: 7, accounts_active: 'Y',
      supplier_cp: 'PARITY CONTACT', supplier_address1: 'PARITY ADDRESS', supplier_city: 'KARACHI', supplier_country: 'PAKISTAN',
      supplier_phone: '03001234567', supplier_fax: '', supplier_email: 'parity@example.com', supplier_address2: '',
      supplier_defaultgst: 1, supplier_dayslimit: 0, supplier_specialinstructions: '', supplier_postcode: '',
      supplier_ntnno: '', supplier_salestaxregno: '', supplier_cnic: '', supplier_mobileno: '', supplier_websiteadd: '',
      supplier_phone2: '', supplier_email2: '', supplier_email3: '', supplier_bankacc: '', supplier_whperc: 0,
      supplier_purquotationcode: 0, supplier_sitecode: 0, suppcatcode: 1,
    };
    const bad = [];
    for (const [k, v] of Object.entries(fields)) { try { await m.pbCall('setitem', [1, k, v], rt) } catch { bad.push(k) } }
    if (d.model.rowCount() === 0) await d.pbCall('insertrow', [0], rt);
    for (const [k, v] of Object.entries({ manfcode: 1, popolicycode: 1, purorderbaseperioddays: 45, purorderprojperioddays: 30 })) { try { await d.pbCall('setitem', [1, k, v], rt) } catch { bad.push('d:' + k) } }
    w.props.set('ib_itemvalidated', true);
    await m.pbCall('accepttext', [], rt).catch(() => {}); await d.pbCall('accepttext', [], rt).catch(() => {});
    return { bad, masterRows: m.model.rowCount(), detailRows: d.model.rowCount(), master: m.model.buf.primary[0]?.v, detail: d.model.buf.primary[0]?.v };
  }, { name: NAME, alias: ALIAS });
  out.save1 = await save('__save1');
  const account = rows(`select acccode,name from dbo.accounts where name='${NAME.replace(/'/g, "''")}'`);
  out.code = account?.[0]?.[0] ?? null;
  out.afterAdd = {
    account,
    supplier: out.code ? rows(`select suppcode,cp,city,country from dbo.supplier where suppcode=${Number(out.code)}`) : [],
    supmanf: out.code ? rows(`select suppcode,manfcode from dbo.suppliermanufacturers where suppcode=${Number(out.code)} order by manfcode`) : [],
    manufacturer: rows('select manfcode,purorderbaseperioddays,purorderprojperioddays,popolicycode from dbo.manufacturer where manfcode in (1,2) order by manfcode'),
    tabAccounts: rows("select tabmaxkey from dbo._tabmaxkey where tabname='Accounts'"),
  };
  out.addOk = !!out.code && out.afterAdd.supplier?.length === 1 && out.afterAdd.supmanf?.some((r) => String(r[1]) === '1')
    && out.messages.some((m) => /Changes take effect in database/i.test(m));
  // edit: change master city/alias and add manufacturer 2 detail
  out.edit = await page.evaluate(async ({ alias2 }) => {
    const rt = window.rt; const w = rt.windowInstances.get('w_supplier_manf');
    const m = w.props.get('id_master'); const d = w.props.get('id_detail');
    await m.pbCall('setitem', [1, 'supplier_city', 'LAHORE'], rt).catch(() => {});
    await m.pbCall('setitem', [1, 'accounts_aliasname', alias2], rt).catch(() => {});
    await d.pbCall('insertrow', [0], rt).catch(() => {});
    const row = d.model.rowCount();
    for (const [k, v] of Object.entries({ manfcode: 2, popolicycode: 1, purorderbaseperioddays: 45, purorderprojperioddays: 30 })) await d.pbCall('setitem', [row, k, v], rt).catch(() => {});
    w.props.set('ib_itemvalidated', true);
    await m.pbCall('accepttext', [], rt).catch(() => {}); await d.pbCall('accepttext', [], rt).catch(() => {});
    return { row, detailRows: d.model.rowCount() };
  }, { alias2: ALIAS2 });
  out.save2 = await save('__save2');
  out.afterEdit = {
    account: out.code ? rows(`select acccode,name,aliasname from dbo.accounts where acccode=${Number(out.code)}`) : [],
    supplier: out.code ? rows(`select suppcode,city from dbo.supplier where suppcode=${Number(out.code)}`) : [],
    supmanf: out.code ? rows(`select suppcode,manfcode from dbo.suppliermanufacturers where suppcode=${Number(out.code)} order by manfcode`) : [],
    manufacturer: rows('select manfcode,purorderbaseperioddays,purorderprojperioddays,popolicycode from dbo.manufacturer where manfcode in (1,2) order by manfcode'),
  };
  out.editOk = out.afterEdit.account?.[0]?.[2] === ALIAS2 && out.afterEdit.supplier?.[0]?.[1] === 'LAHORE'
    && out.afterEdit.supmanf?.length === 2;
  // delete both detail rows, restore city/alias
  out.deleteRows = await page.evaluate(async ({ alias }) => {
    const rt = window.rt; const w = rt.windowInstances.get('w_supplier_manf');
    const m = w.props.get('id_master'); const d = w.props.get('id_detail');
    while (d.model.rowCount() > 0) await d.pbCall('deleterow', [1], rt).catch(() => {});
    await m.pbCall('setitem', [1, 'supplier_city', 'KARACHI'], rt).catch(() => {});
    await m.pbCall('setitem', [1, 'accounts_aliasname', alias], rt).catch(() => {});
    w.props.set('ib_itemvalidated', true);
    await m.pbCall('accepttext', [], rt).catch(() => {}); await d.pbCall('accepttext', [], rt).catch(() => {});
    return { detailRows: d.model.rowCount() };
  }, { alias: ALIAS });
  out.save3 = await save('__save3');
  out.afterDelete = {
    account: out.code ? rows(`select acccode,name,aliasname from dbo.accounts where acccode=${Number(out.code)}`) : [],
    supplier: out.code ? rows(`select suppcode,city from dbo.supplier where suppcode=${Number(out.code)}`) : [],
    supmanf: out.code ? rows(`select count(*) from dbo.suppliermanufacturers where suppcode=${Number(out.code)}`) : [],
    manufacturer: rows('select manfcode,purorderbaseperioddays,purorderprojperioddays,popolicycode from dbo.manufacturer where manfcode in (1,2) order by manfcode'),
  };
  out.deleteOk = out.afterDelete.supmanf?.[0]?.[0] === '0' && out.afterDelete.supplier?.[0]?.[1] === 'KARACHI';
  restore();
  out.final = {
    accounts: Number(rows('select count(*) from dbo.accounts')[0][0]),
    accountsMax: Number(rows('select max(acccode) from dbo.accounts')[0][0]),
    suppliers: Number(rows('select count(*) from dbo.supplier')[0][0]),
    supplierMax: Number(rows('select max(suppcode) from dbo.supplier')[0][0]),
    supmanf: Number(rows('select count(*) from dbo.suppliermanufacturers')[0][0]),
    tabAccounts: rows("select tabmaxkey from dbo._tabmaxkey where tabname='Accounts'")[0]?.[0] ?? null,
    manufacturer: rows('select manfcode,purorderbaseperioddays,purorderprojperioddays,popolicycode from dbo.manufacturer where manfcode in (1,2) order by manfcode'),
    audit: Number(rows('select count(*) from dbo.audit_log')[0][0]),
    auditMax: Number(rows('select max(audit_id) from dbo.audit_log')[0][0]),
    residue: rows(`select count(*) from dbo.accounts where name='${NAME.replace(/'/g, "''")}'`),
  };
  out.baselineOk = out.final.accounts === out.baseline.accounts && out.final.accountsMax === out.baseline.accountsMax
    && out.final.suppliers === out.baseline.suppliers && out.final.supplierMax === out.baseline.supplierMax
    && out.final.supmanf === out.baseline.supmanf && out.final.tabAccounts === out.baseline.tabAccounts
    && JSON.stringify(out.final.manufacturer) === JSON.stringify([out.baseline.manufacturer1, out.baseline.manufacturer2].map((r, i) => [String(i + 1), ...r]))
    && out.final.audit === out.baseline.audit && out.final.auditMax === out.baseline.auditMax
    && out.final.residue?.[0]?.[0] === '0';
  out.ok = !!out.addOk && !!out.editOk && !!out.deleteOk && out.baselineOk;
} catch (e) { out.fatal = String(e.stack || e).slice(0, 2400); }
finally {
  restore();
  console.log(JSON.stringify(out, (k, v) => (typeof v === 'bigint' ? Number(v) : v), 1));
  await browser.close().catch(() => {});
}
