// Change Item Reorder Qty (compound): pick ONE manufacturer/category/class/packing
// in the argument window, let the form's own ue_generate retrieve, edit a reorder
// qty and save through ue_save; verify dbo.item and restore.
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
const OUT = 'C:/Projects/Abuzar/deploy/parity/reorderqty-crud';
mkdirSync(OUT, { recursive: true });
const require = createRequire(process.env.PLAYWRIGHT_MODULES || 'C:/Users/Admin/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/');
const { chromium } = require('playwright');
const PSQL = 'C:\\PostgreSQL\\17\\bin\\psql.exe';
const q = (sql) => execFileSync(PSQL, ['-U', 'postgres', '-h', '127.0.0.1', '-d', 'trader_write_test', '-t', '-A', '-F', '|', '-c', sql], { env: { ...process.env, PGPASSWORD: 'postgres' }, encoding: 'utf8', windowsHide: true }).trim();
const rows = (sql) => q(sql).split(/\r?\n/).filter(Boolean).map((l) => l.split('|'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const out = { errors: [], messages: [] };
page.on('pageerror', (e) => out.errors.push(String(e.message || e).slice(0, 400)));
async function dismiss() {
  for (let i = 0; i < 12; i++) {
    const n = await page.evaluate(() => document.querySelectorAll('.msgbox').length);
    if (!n) break;
    const t = await page.evaluate(() => { const b = document.querySelector('.msgbox'); if (!b) return ''; const bs = [...b.querySelectorAll('.btns button')]; const pick = bs.find((x) => /^(ok|no|cancel|close)$/i.test(x.textContent.trim())) || bs[0]; const t = (b.querySelector('.txt')?.textContent || '').replace(/\s+/g, ' ').trim(); pick?.click(); return t });
    out.messages.push(t); await sleep(150);
  }
}
async function fillPassword() {
  for (let i = 0; i < 20; i++) {
    const r = await page.evaluate(async () => { const rt = window.rt; const a = rt.windowInstances.get('w_salesmanpassword'); if (!a) return false; const dw = a.children.get('dw_password') || a.props.get('dw_password'); if (!dw) return false; await dw.pbCall('setitem', [1, 'salesmancode', 1], rt); await dw.pbCall('setitem', [1, 'password', 'password9080'], rt); await dw.pbCall('accepttext', [], rt); const cb = a.children.get('cb_ok') || a.props.get('cb_ok'); if (cb) await rt.fire(cb, 'clicked'); return true }).catch(() => false);
    if (r) return; await sleep(400);
  }
}
const TARGET = rows("select icode,name,reorderqty,manfcode,icatcode,iccode,packcode from dbo.item where active=1 and manfcode=20 and icatcode=2 and iccode=9 and packcode=1 order by icode limit 1")[0];
const ORIG = rows(`select reorderqty,usercode,lastupdate,changereason,module from dbo.item where icode=${TARGET[0]}`)[0];
out.orig = ORIG;
out.target = TARGET;
const counts = () => ({
  item: rows(`select reorderqty,usercode,coalesce(lastupdate::text,''),coalesce(changereason,''),coalesce(module,'') from dbo.item where icode=${TARGET[0]}`)[0] ?? null,
  itemlog: Number(rows('select count(*) from dbo.itemlog')[0][0]),
  itemlogMax: Number(rows('select coalesce(max(itemrowid),0) from dbo.itemlog')[0][0]),
  audit: Number(rows('select count(*) from dbo.audit_log')[0][0]),
  auditMax: Number(rows('select max(audit_id) from dbo.audit_log')[0][0]),
  serverDate: rows('select lasttransdate::text from dbo.serverdate')[0]?.[0] ?? null,
});
out.baseline = counts();
try {
  await page.goto('http://127.0.0.1:5177/?app=1&autologin=ADMIN:password9080', { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.rt && window.rt.windowInstances.get('w_main') && typeof window.__menu === 'function', null, { timeout: 120000, polling: 300 });
  await page.evaluate(() => { void window.__menu('Maintenance | Change Item Reorder Qty') });
  await page.waitForFunction(() => window.rt.windowInstances.get('w_select_manf_cat_class_packing_combined'), null, { timeout: 30000, polling: 300 });
  await sleep(500);
  out.selector = await page.evaluate(async () => {
    const rt = window.rt; const w = rt.windowInstances.get('w_select_manf_cat_class_packing_combined');
    const rb = w.children.get('rb_compound'); if (rb) { rb.pbSet('checked', true); await rt.fire(rb, 'clicked').catch(() => {}) }
    const cb = w.children.get('cb_ok'); if (cb) await rt.fire(cb, 'clicked').catch(() => {});
    return { compound: !!rb, ok: !!cb };
  });
  await page.waitForFunction(() => window.rt.windowInstances.get('w_changeitem_reorderqty'), null, { timeout: 30000, polling: 300 });
  await sleep(800);
  out.main = await page.evaluate(() => { const w = window.rt.windowInstances.get('w_changeitem_reorderqty'); return { title: w.props.get('title'), is_dwtype: String(w.props.get('is_dwtype') ?? ''), detailRows: w.props.get('id_detail')?.model?.rowCount?.() ?? null } });
  await page.evaluate(() => { const rt = window.rt; const w = rt.windowInstances.get('w_changeitem_reorderqty'); void w.pbCall('ue_generate', [], rt).catch(() => {}) });
  await page.waitForFunction(() => window.rt.windowInstances.get('w_arg_manf_cat_class_packing'), null, { timeout: 40000, polling: 300 });
  await sleep(600);
  out.arg = await page.evaluate(async () => {
    const rt = window.rt; const w = rt.windowInstances.get('w_arg_manf_cat_class_packing');
    const allKeys = ['cbx_all', 'cbx_itemcategoriesall', 'cbx_itemclassesall', 'cbx_itempackingall'];
    for (const k of allKeys) { const c = w.children.get(k) || w.props.get(k); if (c) c.pbSet('checked', false) }
    const sd = w.children.get('em_startdate') || w.props.get('em_startdate'); if (sd) sd.pbSet('text', '01/01/2020 00:00:00');
    const ed = w.children.get('em_enddate') || w.props.get('em_enddate'); if (ed) ed.pbSet('text', '12/12/2030 23:59:59');
    const fill = async (name, value) => {
      const lb = w.children.get(name) || w.props.get(name);
      if (!lb) return name + ': missing';
      await lb.pbCall('reset', [], rt).catch(() => {});
      await lb.pbCall('additem', [value], rt).catch(() => {});
      return name + ':' + String(await lb.pbCall('totalitems', [], rt));
    };
    const lists = [];
    lists.push(await fill('lb_selectedcategories', 'ALI GOHAR PHARMACEUTICALS(PVT)'));
    lists.push(await fill('lb_selecteditemcategories', 'NARCOTICS'));
    lists.push(await fill('lb_selecteditemclasses', 'NARCOTICS'));
    lists.push(await fill('lb_selecteditempacking', '.'));
    const readback = [];
    for (const [name, n] of [['lb_selectedcategories', 1], ['lb_selecteditemcategories', 1], ['lb_selecteditemclasses', 1], ['lb_selecteditempacking', 1]]) {
      const lb = w.children.get(name) || w.props.get(name);
      readback.push(name + '=' + String(await lb.pbCall('text', [n], rt)));
    }
    const cb = w.children.get('cb_ok') || w.props.get('cb_ok'); if (cb) await rt.fire(cb, 'clicked').catch(() => {});
    return { lists, readback };
  });
  // let the posted ue_close run through the modal queue; fall back to a direct close
  let closed = false;
  for (let i = 0; i < 40; i++) { await sleep(250); closed = await page.evaluate(() => !window.rt.windowInstances.get('w_arg_manf_cat_class_packing')); if (closed) break; }
  if (!closed) {
    out.forcedClose = await page.evaluate(async () => { const rt = window.rt; const w = rt.windowInstances.get('w_arg_manf_cat_class_packing'); if (w) await w.pbCall('ue_close', [1], rt).catch(() => {}); return true });
    for (let i = 0; i < 20; i++) { await sleep(250); closed = await page.evaluate(() => !window.rt.windowInstances.get('w_arg_manf_cat_class_packing')); if (closed) break; }
  }
  out.argClosed = closed;
  // load (ue_generate resumes and retrieves)
  let loaded = null;
  for (let i = 0; i < 240; i++) {
    await sleep(500);
    loaded = await page.evaluate(() => { const w = window.rt.windowInstances.get('w_changeitem_reorderqty'); const d = w?.props.get('id_detail'); return { rows: d?.model?.rowCount?.() ?? null, first: d?.model?.buf?.primary?.[0]?.v ?? null, lastError: d?.model?.lastError ?? '' } });
    if (loaded.rows >= 1 && loaded.first?.[0] != null) break;
    await dismiss();
  }
  out.loaded = loaded;
  if (loaded?.rows >= 1 && loaded.first?.[0] != null) {
    out.before = rows(`select icode,reorderqty from dbo.item where icode=${TARGET[0]}`);
    out.edit = await page.evaluate(async (code) => {
      const rt = window.rt; const w = rt.windowInstances.get('w_changeitem_reorderqty'); const d = w.props.get('id_detail');
      const total = d.model.rowCount();
      let row = await d.pbCall('find', [`icode = ${code}`, 1, total], rt).catch(() => 0);
      if (!(row > 0)) for (const [i, r] of d.model.buf.primary.entries()) if (Number(r.v[d.model.colIndex('icode')]) === Number(code)) { row = i + 1; break }
      if (!(row > 0)) return { error: 'row not found', total };
      const orig = Number(d.model.buf.primary[row - 1].v[d.model.colIndex('reorderqty')]);
      await d.pbCall('setitem', [row, 'reorderqty', orig + 1], rt);
      await d.pbCall('accepttext', [], rt);
      await d.pbCall('setitemstatus', [row, 0, 'primary!', 'datamodified!'], rt).catch(() => {});
      const db = d.model.trans?.db; window.__sql = [];
      if (db?.exec) { const origExec = db.exec.bind(db); db.exec = async (sql, params) => { const r = await origExec(sql, params); window.__sql.push({ sql, params, rowcount: r.rowcount }); return r } }
      void w.pbCall('ue_save', [], rt).catch(() => {});
      return { row, total, orig, now: Number(d.model.buf.primary[row - 1].v[d.model.colIndex('reorderqty')]), status: String(d.model.buf.primary[row - 1]?.st ?? '') };
    }, TARGET[0]);
    await fillPassword();
    for (let i = 0; i < 20; i++) { await sleep(500); await dismiss(); }
    out.sql = await page.evaluate(() => window.__sql || []).catch(() => []);
    out.after = rows(`select icode,reorderqty,usercode,changereason,module from dbo.item where icode=${TARGET[0]}`);
    const qv = (v) => (v === null || v === undefined ? 'null' : `'${String(v).replace(/'/g, "''")}'`);
    q(`set session_replication_role = replica;
       update dbo.item set reorderqty=${Number(ORIG[0])}, usercode=${ORIG[1] === null ? 'null' : Number(ORIG[1])}, lastupdate=${ORIG[2] === null ? 'null' : qv(ORIG[2])}, changereason=${qv(ORIG[3])}, module=${qv(ORIG[4])} where icode=${TARGET[0]};
       set session_replication_role = origin;`);
    out.restored = rows(`select icode,reorderqty from dbo.item where icode=${TARGET[0]}`);
    out.ok = Number(out.after?.[0]?.[1]) === Number(TARGET[2]) + 1;
  }
} catch (e) { out.fatal = String(e.stack || e).slice(0, 1800); }
finally {
  try {
    const b = out.baseline;
    if (out.target?.[0] && out.orig) {
      const qv = (v) => (v === null || v === undefined ? 'null' : `'${String(v).replace(/'/g, "''")}'`);
      q(`set session_replication_role = replica;
         update dbo.item set reorderqty=${Number(out.orig[0])}, usercode=${out.orig[1] === null ? 'null' : Number(out.orig[1])}, lastupdate=${out.orig[2] === null ? 'null' : qv(out.orig[2])}, changereason=${qv(out.orig[3])}, module=${qv(out.orig[4])} where icode=${Number(out.target[0])};
         set session_replication_role = origin;`);
    }
    if (b) {
      if (b.itemlogMax) q(`delete from dbo.itemlog where itemrowid > ${Number(b.itemlogMax)}`);
      if (b.serverDate) q(`update dbo.serverdate set lasttransdate='${String(b.serverDate).replace(/'/g, "''")}'::timestamp`);
      if (b.auditMax) { q(`delete from dbo.audit_log where audit_id > ${Number(b.auditMax)}`); q(`select setval(pg_get_serial_sequence('dbo.audit_log','audit_id'), ${Number(b.auditMax)}, true)`) }
    }
    out.final = counts();
    out.baselineOk = !!b && JSON.stringify(out.final) === JSON.stringify(b);
    out.ok = !!out.ok && out.baselineOk;
  } catch (e) { out.restoreError = String(e.message || e).slice(0, 800); }
  writeFileSync(`${OUT}/reorderqty-crud.json`, JSON.stringify(out, (k, v) => (typeof v === 'bigint' ? Number(v) : v), 1));
  console.log(JSON.stringify(out, (k, v) => (typeof v === 'bigint' ? Number(v) : v), 1));
  await browser.close().catch(() => {});
}
