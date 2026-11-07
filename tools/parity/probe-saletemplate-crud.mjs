// Sale Template full CRUD through the rebuilt UI.
// add header + item detail -> save -> verify -> edit -> save -> delete -> verify.
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
const require = createRequire(process.env.PLAYWRIGHT_MODULES || 'C:/Users/Admin/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/');
const { chromium } = require('playwright');
const PSQL = 'C:\\PostgreSQL\\17\\bin\\psql.exe';
const DB = process.env.PARITY_DB || 'trader_write_test';
const OUT = 'C:/Projects/Abuzar/deploy/parity/saletemplate-crud';
mkdirSync(OUT, { recursive: true });
const q = (sql) => execFileSync(PSQL, ['-U', 'postgres', '-h', '127.0.0.1', '-d', DB, '-t', '-A', '-F', '|', '-c', sql], { env: { ...process.env, PGPASSWORD: 'postgres' }, encoding: 'utf8', windowsHide: true }).trim();
const rows = (sql) => q(sql).split(/\r?\n/).filter(Boolean).map((l) => l.split('|'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const NAME = 'PARITY TEMPLATE ' + String(Date.now()).slice(-6);
const counts = () => ({
  headers: Number(rows('select count(*) from dbo.saletemplateheader')[0][0]),
  headerMax: Number(rows('select coalesce(max(saletemplatecode),0) from dbo.saletemplateheader')[0][0]),
  details: Number(rows('select count(*) from dbo.saletemplatedetail')[0][0]),
  tab: rows("select tabmaxkey from dbo._tabmaxkey where tabname='SaleTemplateHeader'")[0]?.[0] ?? null,
  utn: rows('select utn from dbo._utn')[0]?.[0] ?? null,
  serverDate: rows('select lasttransdate::text from dbo.serverdate')[0]?.[0] ?? null,
  audit: Number(rows('select count(*) from dbo.audit_log')[0][0]),
  auditMax: Number(rows('select max(audit_id) from dbo.audit_log')[0][0]),
});
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const out = { name: NAME, messages: [], errors: [] };
page.on('pageerror', (e) => out.errors.push(String(e.message || e).slice(0, 400)));
async function poll(seconds = 6) {
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
try {
  out.baseline = counts();
  await page.goto('http://127.0.0.1:5177/?app=1&autologin=ADMIN:password9080', { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.rt && window.rt.windowInstances.get('w_main') && typeof window.__menu === 'function', null, { timeout: 120000, polling: 300 });
  await page.evaluate(() => { void window.__menu('Basic Data | Sale Template') });
  await page.waitForFunction(() => window.rt.windowInstances.get('w_saletemplate'), null, { timeout: 40000, polling: 300 });
  await sleep(1600);
  await poll(2);
  out.structure = await page.evaluate(() => {
    const rt = window.rt; const w = rt.windowInstances.get('w_saletemplate');
    const pick = (n) => { const d = w.props.get(n); return d?.model ? { rows: d.model.rowCount(), cols: d.model.colNames, table: d.model.def.table.update } : null };
    return { title: w.props.get('title'), master: pick('id_master'), detail: pick('id_detail'), footer: pick('id_footer'), children: [...w.children.keys()] };
  });
  await page.evaluate(async () => { const rt = window.rt; const w = rt.windowInstances.get('w_saletemplate'); await w.pbCall('ue_newform', [], rt).catch(() => {}); });
  await sleep(1200);
  await poll(2);
  out.fill = await page.evaluate(async (name) => {
    const rt = window.rt; const w = rt.windowInstances.get('w_saletemplate');
    const m = w.props.get('id_master'), d = w.props.get('id_detail');
    const bad = [];
    const set = async (dw, row, n, v) => { try { await dw.pbCall('setitem', [row, n, v], rt) } catch (e) { bad.push(n + ':' + String(e.message || e).slice(0, 70)) } };
    if (m.model.rowCount() === 0) await m.pbCall('insertrow', [0], rt);
    const now = '05/11/2026';
    await set(m, 1, 'name', name); await set(m, 1, 'date', now); await set(m, 1, 'modified', now); await set(m, 1, 'headerno', 1);
    if (d.model.rowCount() === 0) await d.pbCall('insertrow', [0], rt);
    const dr = d.model.rowCount();
    for (const [n, v] of Object.entries({ icode: 9801, itemname: 'FACE MASK ', qty: 1, looseqty: 1, saleprice: 10, discperc: 0, itemflatdisc: 0, unitsalestax: 0, gstperc: 0, packunits: 1, bonusqty: 0, marked: 'N' })) await set(d, dr, n, v);
    await m.pbCall('accepttext', [], rt).catch(() => {});
    await d.pbCall('accepttext', [], rt).catch(() => {});
    return { bad, masterRows: m.model.rowCount(), detailRows: d.model.rowCount(), detailFirst: d.model.buf.primary[dr - 1]?.v, detailCols: d.model.colNames };
  }, NAME);
  out.save1 = await page.evaluate(async () => { const rt = window.rt; const w = rt.windowInstances.get('w_saletemplate'); return String(await w.pbCall('ue_save', [], rt).catch((e) => 'ERR ' + String(e.message || e).slice(0, 300))) });
  await poll(10);
  out.header = rows(`select saletemplatecode,name,headerno from dbo.saletemplateheader where name like 'PARITY TEMPLATE %'`);
  const code = out.header[0]?.[0];
  out.code = code;
  if (code) {
    out.detail = rows(`select saletemplatecode,icode,looseqty,saleprice from dbo.saletemplatedetail where saletemplatecode=${code}`);
    out.edit = await page.evaluate(async (name) => {
      const rt = window.rt; const w = rt.windowInstances.get('w_saletemplate'); const m = w.props.get('id_master');
      await m.pbCall('setitem', [1, 'name', name + ' EDIT'], rt); await m.pbCall('accepttext', [], rt);
      const r = await w.pbCall('ue_save', [], rt).catch((e) => 'ERR ' + String(e.message || e).slice(0, 200));
      return String(r);
    }, NAME);
    await poll(8);
    out.afterEdit = rows(`select saletemplatecode,name from dbo.saletemplateheader where saletemplatecode=${code}`);
    // delete through the inherited delete event (answer Yes)
    out.del = await page.evaluate(async () => { const rt = window.rt; const w = rt.windowInstances.get('w_saletemplate'); void rt.fire(w, 'ue_delete'); return 'fired' });
    await poll(8);
    out.afterDelete = rows(`select saletemplatecode,name from dbo.saletemplateheader where saletemplatecode=${code}`);
  }
  out.ok = !!code && out.detail?.length > 0 && out.afterEdit?.[0]?.[1]?.endsWith('EDIT') === true && (out.afterDelete?.length ?? 0) === 0;
} catch (e) { out.fatal = String(e.stack || e).slice(0, 1800); }
finally {
  try {
    if (out.code) {
      q(`delete from dbo.saletemplatedetail where saletemplatecode=${Number(out.code)}`);
      q(`delete from dbo.saletemplateheader where saletemplatecode=${Number(out.code)}`);
    }
    const b = out.baseline;
    if (b) {
      if (b.tab !== null) q(`update dbo._tabmaxkey set tabmaxkey=${Number(b.tab)} where tabname='SaleTemplateHeader'`);
      if (b.utn) q(`update dbo._utn set utn=${Number(b.utn)}`);
      if (b.serverDate) q(`update dbo.serverdate set lasttransdate='${String(b.serverDate).replace(/'/g, "''")}'::timestamp`);
      if (b.auditMax) { q(`delete from dbo.audit_log where audit_id > ${Number(b.auditMax)}`); q(`select setval(pg_get_serial_sequence('dbo.audit_log','audit_id'), ${Number(b.auditMax)}, true)`) }
    }
    out.final = counts();
    out.baselineOk = !!b && JSON.stringify(out.final) === JSON.stringify(b);
    out.ok = !!out.ok && out.baselineOk;
  } catch (e) { out.restoreError = String(e.message || e).slice(0, 800); }
  writeFileSync(`${OUT}/saletemplate-crud.json`, JSON.stringify(out, (k, v) => (typeof v === 'bigint' ? Number(v) : v), 1));
  console.log(JSON.stringify(out, (k, v) => (typeof v === 'bigint' ? Number(v) : v), 1));
  await browser.close().catch(() => {});
}
