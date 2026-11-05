// Main Item Form (Basic Data | Item .......... | Item, w_item_form):
// new-header add + save, reopen through File | List, then the File | Delete
// (header delete) path.  The original w_item_form enables m_delete in
// ue_detail but defines no ue_delete event; this probe measures that path
// instead of assuming it.  All temporary rows/counters/audit entries are
// restored.
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const require = createRequire(process.env.PLAYWRIGHT_MODULES || 'C:/Users/Admin/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/');
const { chromium } = require('playwright');
const PSQL = 'C:\\PostgreSQL\\17\\bin\\psql.exe';
const DB = process.env.PARITY_DB || 'trader_write_test';
const q = (sql) => execFileSync(PSQL, ['-U', 'postgres', '-h', '127.0.0.1', '-d', DB, '-t', '-A', '-F', '|', '-c', sql], { env: { ...process.env, PGPASSWORD: 'postgres' }, encoding: 'utf8', windowsHide: true }).trim();
const rows = (sql) => q(sql).split(/\r?\n/).filter(Boolean).map((l) => l.split('|'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SUF = String(Date.now()).slice(-6);
const NAME = 'PARITY ITEM MAIN ' + SUF;
const ALIAS = 'PIM' + SUF;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const out = { name: NAME, alias: ALIAS, messages: [], errors: [], net: [] };
page.on('pageerror', (e) => out.errors.push(String(e.message || e).slice(0, 600)));
page.on('request', (r) => { if (r.url().includes('/api/exec')) out.net.push({ p: 'req', body: String(r.postData() || '') }) });
page.on('response', async (r) => { if (r.url().includes('/api/exec')) { let b = ''; try { b = await r.text() } catch {} out.net.push({ p: 'res', status: r.status(), body: String(b).slice(0, 500) }) } });
async function poll(seconds = 12, yes = false) {
  for (let i = 0; i < seconds * 2; i++) {
    await sleep(500);
    const msgs = await page.evaluate(() => [...document.querySelectorAll('.msgbox .txt')].map((e) => e.textContent.replace(/\s+/g, ' ').trim().slice(0, 300)));
    if (msgs.length) {
      out.messages.push(...msgs);
      await page.evaluate((y) => { for (const b of document.querySelectorAll('.msgbox')) { const bs = [...b.querySelectorAll('.btns button')]; (bs.find((x) => (y && /^yes$/i.test(x.textContent.trim())) || /^(ok|yes)$/i.test(x.textContent.trim())) || bs[0])?.click(); } }, yes);
      await sleep(250);
    }
  }
}
const killIdle = () => { try { q("select count(pg_terminate_backend(pid)) from pg_stat_activity where datname='" + DB + "' and xact_start is not null and pid<>pg_backend_pid()"); } catch {} };
const counts = () => ({
  item: Number(rows('select count(*) from dbo.item')[0][0]),
  itemMax: Number(rows('select max(icode) from dbo.item')[0][0]),
  itemsuppliers: Number(rows('select count(*) from dbo.itemsuppliers')[0][0]),
  itemnotes: Number(rows('select count(*) from dbo.itemnotes')[0][0]),
  pricepolicy: Number(rows('select count(*) from dbo.pricepolicy')[0][0]),
  pricepolicydetail: Number(rows('select count(*) from dbo.pricepolicydetail')[0][0]),
  itemassociation: Number(rows('select count(*) from dbo.itemassociation')[0][0]),
  iteminmodel: Number(rows('select count(*) from dbo.iteminmodel')[0][0]),
  itemauthor: Number(rows('select count(*) from dbo.itemauthor')[0][0]),
  alternateitemalias: Number(rows('select count(*) from dbo.alternateitemalias')[0][0]),
  itemimage: Number(rows('select count(*) from dbo.itemimage')[0][0]),
  itemlog: Number(rows('select count(*) from dbo.itemlog')[0][0]),
  itemlogMax: Number(rows('select max(itemrowid) from dbo.itemlog')[0][0]),
  tabItem: rows("select tabmaxkey from dbo._tabmaxkey where tabname='Item'")[0]?.[0] ?? null,
  tabPricePolicy: rows("select tabmaxkey from dbo._tabmaxkey where tabname='PricePolicy'")[0]?.[0] ?? null,
  serverDate: rows('select lasttransdate::text from dbo.serverdate')[0]?.[0] ?? null,
  audit: Number(rows('select count(*) from dbo.audit_log')[0][0]),
  auditMax: Number(rows('select max(audit_id) from dbo.audit_log')[0][0]),
});
const restore = () => {
  try {
    killIdle();
    const ids = `select icode from dbo.item where customicode='${ALIAS.replace(/'/g, "''")}'`;
    const pol = `select pricepolicycode from dbo.pricepolicy where icode in (${ids})`;
    q(`delete from dbo.pricepolicydetail where pricepolicycode in (${pol})`);
    q(`delete from dbo.pricepolicy where icode in (${ids})`);
    q(`delete from dbo.itemsuppliers where icode in (${ids})`);
    q(`delete from dbo.itemnotes where icode in (${ids})`);
    q(`delete from dbo.itemimage where icode in (${ids})`);
    q(`delete from dbo.itemassociation where icode in (${ids})`);
    q(`delete from dbo.iteminmodel where icode in (${ids})`);
    q(`delete from dbo.itemauthor where icode in (${ids})`);
    q(`delete from dbo.alternateitemalias where icode in (${ids})`);
    q(`delete from dbo.itemlog where icode in (${ids})`);
    q(`delete from dbo.item where icode in (${ids})`);
    if (out.baseline?.tabItem !== null) q(`update dbo._tabmaxkey set tabmaxkey=${Number(out.baseline.tabItem)} where tabname='Item'`);
    if (out.baseline?.tabPricePolicy !== null) q(`update dbo._tabmaxkey set tabmaxkey=${Number(out.baseline.tabPricePolicy)} where tabname='PricePolicy'`);
    if (out.baseline?.serverDate) q(`update dbo.serverdate set lasttransdate='${String(out.baseline.serverDate).replace(/'/g, "''")}'::timestamp`);
    if (out.baseline?.itemlogMax) { q(`delete from dbo.itemlog where itemrowid > ${out.baseline.itemlogMax}`); q(`select setval(pg_get_serial_sequence('dbo.itemlog','itemrowid'), ${out.baseline.itemlogMax}, true)`); }
    if (out.baseline?.auditMax) { q(`delete from dbo.audit_log where audit_id > ${out.baseline.auditMax}`); q(`select setval(pg_get_serial_sequence('dbo.audit_log','audit_id'), ${out.baseline.auditMax}, true)`); }
  } catch (e) { out.restoreError = String(e.message || e).slice(0, 600); }
};
try {
  out.baseline = counts();
  await page.goto('http://127.0.0.1:5177/?app=1&autologin=ADMIN:password9080', { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.rt && window.rt.windowInstances.get('w_main') && typeof window.__menu === 'function', null, { timeout: 90000, polling: 300 });
  out.menu = await page.evaluate(async () => { try { await window.__menu('Basic Data | Item .......... | Item'); return 'ok'; } catch (e) { return 'ERR ' + String(e.message || e); } });
  await page.waitForFunction(() => window.rt.windowInstances.get('w_item_form'), null, { timeout: 40000, polling: 300 });
  await sleep(1800); await poll(3);
  out.open = await page.evaluate(() => {
    const w = window.rt.windowInstances.get('w_item_form');
    return { title: String(w.props.get('title') ?? ''), master: !!w.props.get('id_master'), detail: !!w.props.get('id_detail'), masterCols: w.props.get('id_master')?.model?.colNames?.length ?? null };
  });
  await page.evaluate(async () => { const rt = window.rt; const w = rt.windowInstances.get('w_item_form'); await w.pbCall('ue_newform', [], rt).catch(() => {}) });
  await sleep(900); await poll(1);
  out.fill = await page.evaluate(async ({ name, alias }) => {
    const rt = window.rt; const w = rt.windowInstances.get('w_item_form');
    const m = w.props.get('id_master'); const d = w.props.get('id_detail');
    if (m.model.rowCount() === 0) await m.pbCall('insertrow', [0], rt);
    const fields = {
      name, customicode: alias, manfcode: 1, iccode: 1, icatcode: 1, packcode: 1, gcode: 1,
      saleprice: 10, purprice: 5, retailprice: 10, avgprice: 0, salediscperc: 0, purdiscperc: 0, salestax: 0,
      reorderqty: 0, optimumqty: 0, packunits: 1, active: 1, prescribed: 0, refrigrated: 0, printable: 1,
      location: '.', remarks: '.', location1: '', remarks1: '',
      saleprice2: 0, saleprice3: 0, saleprice4: 0, saleprice5: 0, salediscperc2: 0, salediscperc3: 0, salediscperc4: 0, salediscperc5: 0,
      recentpurprice: 0, greorderqty: 1, goptimumqty: 1, packsalestax: 0, gstperc1: 0, gstperc2: 0,
      isizecode: 1, istylecode: 1, icolourcode: 1, isleevecode: 1, iyarncode: 1, ifabriccode: 1, ibrandcode: 1,
      ipartcode: 1, itemtypecode: 1, measureunitcode: 1, genericcode: 1, itemalertcode: 1,
      minqty: 0, packingfactor: 1, transitstock: 0, generatepo: 'N', qtyused: 0,
      antinorcotix: 'N', restricted: 'N', locksaleprice: 'N', lockdiscperc: 'N', printitembatch: 'Y', printexpiry: 'Y',
      taxable: 'N', allowdue: 'N', loyaltyitem: 'Y', confirmexpiry: 'N', allowsaleindecimalqty: 'N',
      salestaxschedulecode: 1, headerno: 1, pctcode: 1, itemthicknesscode: 1,
      maxsalediscperc: 100, itemdesigncode: 1, alternatepurprice: 0, purflatdisc: 0, foreignprice: 0,
      checkuppersaleqtylimit: 'N', uppersaleqtylimit: 0, width: 1, length: 1, areavolume: 1, thickness: 1,
      sheets: 1, gender: 'M', prefferedsaleqty: 1, packcapacity: 1, packingcost: 0, unitweight: 1,
      redemptiondiscperc: 0, claimablediscperc: 0, allowsalepricebelowavgprice: 'N',
    };
    const bad = [];
    for (const [k, v] of Object.entries(fields)) { try { await m.pbCall('setitem', [1, k, v], rt) } catch { bad.push(k) } }
    if (!d.model.rowCount()) await d.pbCall('insertrow', [0], rt);
    for (const [k, v] of Object.entries({ suppcode: 18, priority: 1, rate: 10, discperc: 0, saleqty: 0, bonusqty: 0, days: 0 })) {
      try { await d.pbCall('setitem', [1, k, v], rt) } catch { bad.push('d:' + k) }
    }
    const reqNulls = (dw) => {
      const model = dw.model; const row = model.buf.primary[0]; if (!row) return ['NO ROW'];
      return (model.def.objects || []).filter((o) => o.type === 'column' && ['edit', 'dddw', 'ddlb', 'editmask'].some((style) => /^(yes|true|1)$/i.test(model.overrides?.get?.(`${o.name.toLowerCase()}.${style}.required`) ?? o[`${style}.required`] ?? '')))
        .map((o) => ({ n: o.name, i: model.colIndex(o.name), v: row.v[model.colIndex(o.name)] }))
        .filter((x) => x.i >= 0 && (x.v === null || x.v === undefined));
    };
    const before = { master: reqNulls(m), detail: reqNulls(d) };
    await m.pbCall('accepttext', [], rt).catch(() => {});
    await d.pbCall('accepttext', [], rt).catch(() => {});
    return { bad, masterRows: m.model.rowCount(), detailRows: d.model.rowCount(), values: m.model.buf.primary[0]?.v?.slice(0, 12), before, after: { master: reqNulls(m), detail: reqNulls(d) }, detailValues: d.model.buf.primary[0]?.v };
  }, { name: NAME, alias: ALIAS });
  out.save1 = await page.evaluate(async () => {
    const rt = window.rt; const w = rt.windowInstances.get('w_item_form');
    window.__save1 = false;
    void w.pbCall('ue_save', [], rt).then((v) => { window.__save1 = String(v) }).catch((e) => { window.__save1 = 'ERR ' + String(e.message || e).slice(0, 500) });
    return 'fired';
  });
  await poll(18);
  out.save1Result = await page.evaluate(() => window.__save1 ?? null);
  out.afterAdd = {
    item: rows(`select icode,name,customicode,manfcode,iccode,icatcode,packcode,gcode,saleprice,purprice,retailprice,active,location,remarks,regdno from dbo.item where customicode='${ALIAS}'`),
    suppliers: rows(`select icode,suppcode,priority,rate from dbo.itemsuppliers where icode in (select icode from dbo.item where customicode='${ALIAS}')`),
    notes: rows(`select icode,notes is null from dbo.itemnotes where icode in (select icode from dbo.item where customicode='${ALIAS}')`),
    policy: rows(`select p.pricepolicycode,p.icode,p.name,d.qtylimit,d.price,d.expirydate::date from dbo.pricepolicy p left join dbo.pricepolicydetail d on d.pricepolicycode=p.pricepolicycode where p.icode in (select icode from dbo.item where customicode='${ALIAS}')`),
    tabItem: rows("select tabmaxkey from dbo._tabmaxkey where tabname='Item'"),
    tabPricePolicy: rows("select tabmaxkey from dbo._tabmaxkey where tabname='PricePolicy'"),
  };
  out.code = out.afterAdd.item?.[0]?.[0] ?? null;
  out.addOk = !!out.code && out.afterAdd.item[0][1] === NAME && out.afterAdd.suppliers?.length === 1
    && out.afterAdd.notes?.length === 1 && out.afterAdd.policy?.length === 1
    && out.messages.some((m) => /Changes take effect in database/i.test(m));
  out.addSQL = out.net.filter((x) => x.p === 'req').map((x) => { try { return String(JSON.parse(x.body).sql) } catch { return '' } }).filter((s) => /INSERT INTO dbo\.item|INSERT INTO dbo\.itemsuppliers|INSERT INTO dbo\.itemnotes|INSERT INTO dbo\.pricepolicy/i.test(s)).map((s) => s.slice(0, 200));
  if (out.code) {
    // reopen through File | List -> ue_detail
    await page.evaluate(async () => { const rt = window.rt; const w = rt.windowInstances.get('w_item_form'); void w.pbCall('ue_list', [], rt).catch(() => {}) });
    for (let i = 0; i < 120; i++) { await sleep(500); const n = await page.evaluate(() => window.rt.windowInstances.get('w_item_form')?.props.get('id_list')?.model?.rowCount?.() ?? 0); if (n > 0) { out.listRows = n; break; } await poll(1); }
    out.pick = await page.evaluate(async (code) => {
      const rt = window.rt; const w = rt.windowInstances.get('w_item_form');
      const l = w.props.get('id_list'); const m = l.model; const ci = m.colIndex('code') >= 0 ? m.colIndex('code') : 0;
      const hit = [...m.buf.primary.entries()].find(([, r]) => Number(r.v[ci]) === Number(code));
      if (!hit) return { error: 'new item not in list', rows: m.rowCount() };
      w.props.set('id_dwcontrol', l); w.props.set('il_selectedrow', hit[0] + 1);
      await w.pbCall('ue_detail', [], rt).catch(() => {});
      await new Promise((r) => setTimeout(r, 1200));
      const mm = w.props.get('id_master');
      return { row: hit[0] + 1, listRows: m.rowCount(), masterCode: String(mm?.model?.buf.primary[0]?.v?.[mm.model.colIndex('code')] ?? ''), masterRows: mm?.model?.rowCount?.() ?? null };
    }, Number(out.code));
    await poll(2);
    out.menuDelete = await page.evaluate(() => {
      const rt = window.rt; const w = rt.windowInstances.get('w_item_form');
      const menu = w.props.get('menuid') || w.props.get('im_menu');
      let hit = null; const walk = (o) => { for (const c of o.children.values()) { if (c.name === 'm_delete') hit = hit || c; walk(c) } }; if (menu) walk(menu);
      if (!hit) return { error: 'm_delete not found' };
      const before = { enabled: hit.props.get('enabled') !== false, text: String(hit.props.get('text') ?? '') };
      void rt.fire(hit, 'clicked').catch(() => {});
      return { fired: true, ...before };
    });
    await sleep(800); await poll(4, true); await sleep(800); await poll(2, true);
    out.afterHeaderDelete = {
      item: rows(`select count(*) from dbo.item where icode=${Number(out.code)}`),
      suppliers: rows(`select count(*) from dbo.itemsuppliers where icode=${Number(out.code)}`),
      tabItem: rows("select tabmaxkey from dbo._tabmaxkey where tabname='Item'"),
    };
    out.directDelete = await page.evaluate(async () => {
      const rt = window.rt; const w = rt.windowInstances.get('w_item_form');
      try { const v = await w.pbCall('ue_delete', [], rt); return { ok: true, value: String(v) } }
      catch (e) { return { ok: false, error: String(e.message || e).slice(0, 300) } }
    });
    await sleep(600); await poll(3, true);
    out.afterDirectDelete = rows(`select count(*) from dbo.item where icode=${Number(out.code)}`);
    out.headerDeleteBehavior = {
      exists: out.afterHeaderDelete.item?.[0]?.[0] === '1',
      menuEnabled: out.menuDelete?.enabled ?? null,
      directOk: out.directDelete?.ok ?? null,
      directError: out.directDelete?.error ?? null,
      messages: out.messages.filter((m) => /delete|deleted|record/i.test(m)),
    };
    out.headerDeleteOk = out.headerDeleteBehavior.exists && out.menuDelete?.enabled === true
      && out.afterDirectDelete?.[0]?.[0] === '1';
  }
  restore();
  out.final = counts();
  out.final.residue = rows(`select count(*) from dbo.item where customicode='${ALIAS}'`);
  out.final.policyResidue = rows(`select count(*) from dbo.pricepolicy where name like '${String(out.code ?? -1)}.%' and icode=${Number(out.code ?? -1)}`);
  out.baselineOk = out.final.item === out.baseline.item && out.final.itemMax === out.baseline.itemMax
    && out.final.itemsuppliers === out.baseline.itemsuppliers && out.final.itemnotes === out.baseline.itemnotes
    && out.final.pricepolicy === out.baseline.pricepolicy && out.final.pricepolicydetail === out.baseline.pricepolicydetail
    && out.final.itemassociation === out.baseline.itemassociation && out.final.iteminmodel === out.baseline.iteminmodel
    && out.final.itemauthor === out.baseline.itemauthor && out.final.alternateitemalias === out.baseline.alternateitemalias
    && out.final.itemimage === out.baseline.itemimage
    && out.final.itemlog === out.baseline.itemlog && out.final.itemlogMax === out.baseline.itemlogMax
    && out.final.tabItem === out.baseline.tabItem && out.final.tabPricePolicy === out.baseline.tabPricePolicy
    && out.final.serverDate === out.baseline.serverDate
    && out.final.audit === out.baseline.audit && out.final.auditMax === out.baseline.auditMax
    && out.final.residue?.[0]?.[0] === '0' && out.final.policyResidue?.[0]?.[0] === '0';
  out.ok = !!out.addOk && !!out.headerDeleteOk && out.baselineOk;
} catch (e) { out.fatal = String(e.stack || e).slice(0, 2800); }
finally {
  restore();
  console.log(JSON.stringify(out, (k, v) => (typeof v === 'bigint' ? Number(v) : v), 1));
  await browser.close().catch(() => {});
}
