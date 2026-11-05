// Sale Promotion (Basic Data | Customer .......... | Sale Promotion).
//
// The form was previously data-blocked because CustomerGroup was empty in
// both databases.  This probe inserts a temporary CustomerGroup 1 plus one
// CustomerGroupDetail row for customer 22, runs add/edit/delete through the
// form, verifies the form's Customer.DefaultItemDiscPerc side effect, and
// restores every row/counter/audit entry.
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const require = createRequire(process.env.PLAYWRIGHT_MODULES || 'C:/Users/Admin/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/');
const { chromium } = require('playwright');
const PSQL = 'C:\\PostgreSQL\\17\\bin\\psql.exe';
const q = (sql) => execFileSync(PSQL, ['-U', 'postgres', '-h', '127.0.0.1', '-d', 'trader_write_test', '-t', '-A', '-F', '|', '-c', sql], { env: { ...process.env, PGPASSWORD: 'postgres' }, encoding: 'utf8', windowsHide: true }).trim();
const rows = (sql) => q(sql).split(/\r?\n/).filter(Boolean).map((l) => l.split('|'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SUF = String(Date.now()).slice(-6);
const NAME = 'PARITY PROMO ' + SUF;
const NAME2 = NAME + ' EDIT';
const GROUP = 'PARITY CUST GROUP ' + SUF;
const CUST = 22;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const out = { name: NAME, name2: NAME2, group: GROUP, messages: [], errors: [], net: [] };
page.on('pageerror', (e) => out.errors.push(String(e.message || e).slice(0, 500)));
page.on('request', (r) => { if (r.url().includes('/api/exec')) out.net.push({ p: 'req', body: String(r.postData() || '') }) });
page.on('response', async (r) => { if (r.url().includes('/api/exec')) { let b = ''; try { b = await r.text() } catch {} out.net.push({ p: 'res', status: r.status(), body: String(b).slice(0, 400) }) } });
async function poll(seconds = 10, yes = false) {
  for (let i = 0; i < seconds * 2; i++) {
    await sleep(500);
    const msgs = await page.evaluate(() => [...document.querySelectorAll('.msgbox .txt')].map((e) => e.textContent.replace(/\s+/g, ' ').trim().slice(0, 240)));
    if (msgs.length) {
      out.messages.push(...msgs);
      await page.evaluate((y) => { for (const b of document.querySelectorAll('.msgbox')) { const bs = [...b.querySelectorAll('.btns button')]; (bs.find((x) => (y && /^yes$/i.test(x.textContent.trim())) || /^(ok|yes)$/i.test(x.textContent.trim())) || bs[0])?.click(); } }, yes);
      await sleep(250);
    }
  }
}
async function save(key) {
  await page.evaluate(async (k) => {
    const rt = window.rt; const w = rt.windowInstances.get('w_salepromotion_form');
    window[k] = false;
    void w.pbCall('ue_save', [], rt).then((v) => { window[k] = String(v) }).catch((e) => { window[k] = 'ERR ' + String(e.message || e).slice(0, 400) });
  }, key);
  await poll(14);
  return page.evaluate((k) => window[k] ?? null, key);
}
const restore = () => {
  try {
    q(`delete from dbo.salepromotion where name in ('${NAME.replace(/'/g, "''")}','${NAME2.replace(/'/g, "''")}')`);
    q(`delete from dbo.customergroupdetail where customergroupcode=1 and custcode=${CUST}`);
    q(`delete from dbo.customergroup where customergroupcode=1 and name='${GROUP.replace(/'/g, "''")}'`);
    if (out.baseline?.custDisc !== null) q(`update dbo.customer set defaultitemdiscperc=${Number(out.baseline.custDisc)} where custcode=${CUST}`);
    if (out.baseline?.tab !== null) q(`update dbo._tabmaxkey set tabmaxkey=${Number(out.baseline.tab)} where tabname='SalePromotion'`);
    if (out.baseline?.auditMax) { q(`delete from dbo.audit_log where audit_id > ${out.baseline.auditMax}`); q(`select setval(pg_get_serial_sequence('dbo.audit_log','audit_id'), ${out.baseline.auditMax}, true)`); }
  } catch (e) { out.restoreError = String(e.message || e).slice(0, 500); }
};
try {
  out.baseline = {
    promotions: Number(rows('select count(*) from dbo.salepromotion')[0][0]),
    promotionMax: rows('select coalesce(max(salepromotioncode),0) from dbo.salepromotion')[0][0],
    groups: Number(rows('select count(*) from dbo.customergroup')[0][0]),
    groupDetails: Number(rows('select count(*) from dbo.customergroupdetail')[0][0]),
    custDisc: rows(`select defaultitemdiscperc from dbo.customer where custcode=${CUST}`)[0]?.[0] ?? null,
    tab: rows("select tabmaxkey from dbo._tabmaxkey where tabname='SalePromotion'")[0]?.[0] ?? null,
    audit: Number(rows('select count(*) from dbo.audit_log')[0][0]),
    auditMax: Number(rows('select max(audit_id) from dbo.audit_log')[0][0]),
  };
  q(`insert into dbo.customergroup (customergroupcode,name,remarks,usercode) values (1,'${GROUP.replace(/'/g, "''")}','PARITY TEST GROUP',1)`);
  q(`insert into dbo.customergroupdetail (customergroupcode,custcode,rowid) values (1,${CUST},1)`);
  await page.goto('http://127.0.0.1:5177/?app=1&autologin=ADMIN:password9080', { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.rt && window.rt.windowInstances.get('w_main') && typeof window.__menu === 'function', null, { timeout: 90000, polling: 300 });
  out.menu = await page.evaluate(async () => { try { await window.__menu('Basic Data | Customer .......... | Sale Promotion'); return 'ok'; } catch (e) { return 'ERR ' + String(e.message || e); } });
  await page.waitForFunction(() => window.rt.windowInstances.get('w_salepromotion_form'), null, { timeout: 30000, polling: 300 });
  await sleep(1200); await poll(2);
  await page.evaluate(async () => { const rt = window.rt; const w = rt.windowInstances.get('w_salepromotion_form'); await w.pbCall('ue_newform', [], rt).catch(() => {}) });
  await sleep(800); await poll(1);
  out.open = await page.evaluate(() => {
    const w = window.rt.windowInstances.get('w_salepromotion_form');
    const d = w.props.get('id_detail');
    return { title: String(w.props.get('title') ?? ''), rows: d?.model?.rowCount?.() ?? null, cols: d?.model?.colNames ?? null };
  });
  out.fillAdd = await page.evaluate(async ({ name }) => {
    const rt = window.rt; const w = rt.windowInstances.get('w_salepromotion_form'); const d = w.props.get('id_detail');
    if (d.model.rowCount() === 0) await d.pbCall('insertrow', [0], rt);
    const values = { name, active: 'Y', customergroupcode: 1, defaultitemdiscperc: 5, weekdaycode: 0, remarks: 'PARITY PROMOTION TEST' };
    const bad = [];
    for (const [k, v] of Object.entries(values)) { try { await d.pbCall('setitem', [1, k, v], rt) } catch { bad.push(k) } }
    await d.pbCall('accepttext', [], rt).catch(() => {});
    return { bad, values: d.model.buf.primary[0]?.v };
  }, { name: NAME });
  out.save1 = await save('__save1');
  out.afterAdd = {
    promo: rows(`select salepromotioncode,name,active,customergroupcode,defaultitemdiscperc,weekdaycode,startdate::text,enddate::text from dbo.salepromotion where name='${NAME}'`),
    custDisc: rows(`select defaultitemdiscperc from dbo.customer where custcode=${CUST}`),
    tab: rows("select tabmaxkey from dbo._tabmaxkey where tabname='SalePromotion'"),
  };
  out.code = out.afterAdd.promo?.[0]?.[0] ?? null;
  out.addOk = !!out.code && out.afterAdd.custDisc?.[0]?.[0] === '5'
    && out.afterAdd.tab?.[0]?.[0] === String(Number(out.code))
    && out.messages.some((m) => /Changes take effect in database/i.test(m));
  // edit
  out.edit = await page.evaluate(async ({ name2 }) => {
    const rt = window.rt; const w = rt.windowInstances.get('w_salepromotion_form'); const d = w.props.get('id_detail');
    await d.pbCall('setitem', [1, 'name', name2], rt).catch(() => {});
    await d.pbCall('setitem', [1, 'defaultitemdiscperc', 6], rt).catch(() => {});
    await d.pbCall('setitem', [1, 'remarks', 'PARITY PROMOTION EDITED'], rt).catch(() => {});
    await d.pbCall('accepttext', [], rt).catch(() => {});
    return { values: d.model.buf.primary[0]?.v };
  }, { name2: NAME2 });
  out.save2 = await save('__save2');
  out.afterEdit = {
    promo: out.code ? rows(`select salepromotioncode,name,defaultitemdiscperc,remarks from dbo.salepromotion where salepromotioncode=${Number(out.code)}`) : [],
    custDisc: rows(`select defaultitemdiscperc from dbo.customer where custcode=${CUST}`),
  };
  out.editOk = out.afterEdit.promo?.[0]?.[1] === NAME2 && out.afterEdit.promo?.[0]?.[2] === '6'
    && out.afterEdit.promo?.[0]?.[3] === 'PARITY PROMOTION EDITED' && out.afterEdit.custDisc?.[0]?.[0] === '6';
  // delete through list -> ue_detail -> ue_delete
  if (out.code) {
    await page.evaluate(async () => { const rt = window.rt; const w = rt.windowInstances.get('w_salepromotion_form'); await w.pbCall('ue_list', [], rt).catch(() => {}) });
    for (let i = 0; i < 30; i++) { await sleep(500); const n = await page.evaluate(() => window.rt.windowInstances.get('w_salepromotion_form')?.props.get('id_list')?.model?.rowCount?.() ?? 0); if (n > 0) break; await poll(1); }
    out.listPick = await page.evaluate(async (code) => {
      const rt = window.rt; const w = rt.windowInstances.get('w_salepromotion_form');
      const l = w.props.get('id_list'); const m = l.model; const ci = m.colIndex('code');
      let idx = 0; for (const [i, r] of m.buf.primary.entries()) if (Number(r.v[ci]) === Number(code)) { idx = i + 1; break }
      w.props.set('il_selectedrow', idx); return { rows: m.rowCount(), idx };
    }, Number(out.code));
    out.detail = await page.evaluate(async () => {
      const rt = window.rt; const w = rt.windowInstances.get('w_salepromotion_form');
      await w.pbCall('ue_detail', [], rt).catch(() => {});
      await new Promise((r) => setTimeout(r, 900));
      const menu = w.props.get('menuid') || w.props.get('im_menu');
      const find = (o, n) => { for (const c of o.children.values()) { if (c.name === n) return c; const r = find(c, n); if (r) return r } return null };
      const del = menu ? find(menu, 'm_delete') : null;
      return { rows: w.props.get('id_detail')?.model?.rowCount?.() ?? null, deleteFound: !!del, deleteEnabled: del ? del.props.get('enabled') !== false : null };
    });
    out.deleteAttempt = await page.evaluate(async () => {
      const rt = window.rt; const w = rt.windowInstances.get('w_salepromotion_form');
      window.__delDone = false;
      void w.pbCall('ue_delete', [], rt).then((v) => { window.__delDone = String(v) }).catch((e) => { window.__delDone = 'ERR ' + String(e.message || e).slice(0, 300) });
      return 'fired';
    });
    await sleep(600); await poll(4, true); await sleep(1200); await poll(3, true);
    out.afterDelete = { promo: rows(`select count(*) from dbo.salepromotion where salepromotioncode=${Number(out.code)}`), tab: rows("select tabmaxkey from dbo._tabmaxkey where tabname='SalePromotion'") };
    out.deleteOk = out.afterDelete.promo?.[0]?.[0] === '0';
  }
  restore();
  out.final = {
    promotions: Number(rows('select count(*) from dbo.salepromotion')[0][0]),
    promotionMax: rows('select coalesce(max(salepromotioncode),0) from dbo.salepromotion')[0][0],
    groups: Number(rows('select count(*) from dbo.customergroup')[0][0]),
    groupDetails: Number(rows('select count(*) from dbo.customergroupdetail')[0][0]),
    custDisc: rows(`select defaultitemdiscperc from dbo.customer where custcode=${CUST}`)[0]?.[0] ?? null,
    tab: rows("select tabmaxkey from dbo._tabmaxkey where tabname='SalePromotion'")[0]?.[0] ?? null,
    audit: Number(rows('select count(*) from dbo.audit_log')[0][0]),
    auditMax: Number(rows('select max(audit_id) from dbo.audit_log')[0][0]),
    residue: rows(`select count(*) from dbo.salepromotion where name like 'PARITY PROMO %'`),
  };
  out.baselineOk = out.final.promotions === out.baseline.promotions && out.final.promotionMax === out.baseline.promotionMax
    && out.final.groups === out.baseline.groups && out.final.groupDetails === out.baseline.groupDetails
    && out.final.custDisc === out.baseline.custDisc && out.final.tab === out.baseline.tab
    && out.final.audit === out.baseline.audit && out.final.auditMax === out.baseline.auditMax
    && out.final.residue?.[0]?.[0] === '0';
  out.ok = !!out.addOk && !!out.editOk && !!out.deleteOk && out.baselineOk;
} catch (e) { out.fatal = String(e.stack || e).slice(0, 2400); }
finally {
  restore();
  console.log(JSON.stringify(out, (k, v) => (typeof v === 'bigint' ? Number(v) : v), 1));
  await browser.close().catch(() => {});
}
