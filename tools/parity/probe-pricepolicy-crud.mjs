// Item Price Policy screen (Basic Data | Item | Price Policy).
//
// Every item already has exactly one PricePolicy header (28,966 items /
// 28,966 policies; 0 items without a policy), and pricepolicy.icode is
// UNIQUE, so the reachable screen workflow is maintaining the quantity/price
// slabs in pricepolicydetail.  The probe selects item 9801's policy 7670,
// adds a slab, edits it, deletes it, and restores every row/counter/audit.
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const require = createRequire(process.env.PLAYWRIGHT_MODULES || 'C:/Users/Admin/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/');
const { chromium } = require('playwright');
const PSQL = 'C:\\PostgreSQL\\17\\bin\\psql.exe';
const q = (sql) => execFileSync(PSQL, ['-U', 'postgres', '-h', '127.0.0.1', '-d', 'trader_write_test', '-t', '-A', '-F', '|', '-c', sql], { env: { ...process.env, PGPASSWORD: 'postgres' }, encoding: 'utf8', windowsHide: true }).trim();
const rows = (sql) => q(sql).split(/\r?\n/).filter(Boolean).map((l) => l.split('|'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const POLICY = 7670;
const ITEM = 9801;
const SLAB = 1;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const out = { policy: POLICY, item: ITEM, slab: SLAB, messages: [], errors: [], net: [] };
page.on('pageerror', (e) => out.errors.push(String(e.message || e).slice(0, 500)));
page.on('request', (r) => { if (r.url().includes('/api/exec')) out.net.push({ p: 'req', body: String(r.postData() || '') }) });
page.on('response', async (r) => { if (r.url().includes('/api/exec')) { let b = ''; try { b = await r.text() } catch {} out.net.push({ p: 'res', status: r.status(), body: String(b).slice(0, 400) }) } });
async function poll(seconds = 8, yes = false) {
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
    const rt = window.rt; const w = rt.windowInstances.get('w_itempricepolicy_form');
    window[k] = false;
    void w.pbCall('ue_save', [], rt).then((v) => { window[k] = String(v) }).catch((e) => { window[k] = 'ERR ' + String(e.message || e).slice(0, 400) });
  }, key);
  await poll(12);
  return page.evaluate((k) => window[k] ?? null, key);
}
async function reopenPolicy() {
  await page.evaluate(async () => { const rt = window.rt; const w = rt.windowInstances.get('w_itempricepolicy_form'); await w.pbCall('ue_list', [], rt).catch(() => {}) });
  for (let i = 0; i < 30; i++) { await sleep(500); const n = await page.evaluate(() => window.rt.windowInstances.get('w_itempricepolicy_form')?.props.get('id_list')?.model?.rowCount?.() ?? 0); if (n > 0) break; await poll(1); }
  const r = await page.evaluate(async (policy) => {
    const rt = window.rt; const w = rt.windowInstances.get('w_itempricepolicy_form');
    const l = w.props.get('id_list'); const m = l.model; const ci = m.colIndex('code');
    const hit = [...m.buf.primary.entries()].find(([, r]) => Number(r.v[ci]) === policy);
    if (!hit) return { error: 'policy not in list' };
    w.props.set('id_dwcontrol', l); w.props.set('il_selectedrow', hit[0] + 1);
    await w.pbCall('ue_detail', [], rt).catch(() => {});
    await new Promise((r) => setTimeout(r, 2500));
    const mm = w.props.get('id_master'); const d = w.props.get('id_detail');
    return {
      listRows: m.rowCount(), row: hit[0] + 1,
      masterCode: String(mm?.model?.buf.primary[0]?.v?.[mm.model.colIndex('code')] ?? ''),
      detailRows: d?.model?.rowCount?.() ?? null,
      details: d?.model?.buf?.primary?.map((x) => x.v) ?? null,
      statuses: d?.model?.buf?.primary?.map((_, i) => d.model.getStatus(i + 1, 0)) ?? null,
    };
  }, POLICY);
  await poll(2);
  return r;
}
const restore = () => {
  try {
    q(`delete from dbo.pricepolicydetail where pricepolicycode=${POLICY} and qtylimit=${SLAB}`);
    if (out.baseline?.header) {
      const h = out.baseline.header[0];
      q(`update dbo.pricepolicy set name='${String(h[1]).replace(/'/g, "''")}', icode=${Number(h[2])} where pricepolicycode=${POLICY}`);
    }
    if (out.baseline?.tab !== null) q(`update dbo._tabmaxkey set tabmaxkey=${Number(out.baseline.tab)} where tabname='PricePolicy'`);
    if (out.baseline?.auditMax) { q(`delete from dbo.audit_log where audit_id > ${out.baseline.auditMax}`); q(`select setval(pg_get_serial_sequence('dbo.audit_log','audit_id'), ${out.baseline.auditMax}, true)`); }
  } catch (e) { out.restoreError = String(e.message || e).slice(0, 500); }
};
try {
  out.baseline = {
    policies: Number(rows('select count(*) from dbo.pricepolicy')[0][0]),
    policyMax: Number(rows('select max(pricepolicycode) from dbo.pricepolicy')[0][0]),
    details: Number(rows('select count(*) from dbo.pricepolicydetail')[0][0]),
    detailsPolicy: rows(`select pricepolicycode,qtylimit,price,itemflatdisc,discperc,expirydate::text from dbo.pricepolicydetail where pricepolicycode=${POLICY} order by qtylimit`),
    header: rows(`select pricepolicycode,name,icode from dbo.pricepolicy where pricepolicycode=${POLICY}`),
    tab: rows("select tabmaxkey from dbo._tabmaxkey where tabname='PricePolicy'")[0]?.[0] ?? null,
    audit: Number(rows('select count(*) from dbo.audit_log')[0][0]),
    auditMax: Number(rows('select max(audit_id) from dbo.audit_log')[0][0]),
  };
  await page.goto('http://127.0.0.1:5177/?app=1&autologin=ADMIN:password9080', { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.rt && window.rt.windowInstances.get('w_main') && typeof window.__menu === 'function', null, { timeout: 90000, polling: 300 });
  out.menu = await page.evaluate(async () => {
    try { await window.__menu('Basic Data | Item .......... | Price Policy'); return 'ok'; }
    catch (e) {
      const rt = window.rt; const root = rt.windowInstances.get('w_main')?.props.get('menuid');
      const find = (o, n) => { for (const c of o.children.values()) { if (c.name === n) return c; const r = find(c, n); if (r) return r } return null };
      const item = root ? find(root, 'm_pricepolicy') : null;
      if (!item) return 'ERR ' + String(e.message || e);
      await rt.fire(item, 'clicked').catch(() => {});
      return 'fired m_pricepolicy';
    }
  });
  await page.waitForFunction(() => window.rt.windowInstances.get('w_itempricepolicy_form'), null, { timeout: 30000, polling: 300 });
  await sleep(1600); await poll(2);
  await page.evaluate(async () => { const rt = window.rt; const w = rt.windowInstances.get('w_itempricepolicy_form'); await w.pbCall('ue_list', [], rt).catch(() => {}) });
  for (let i = 0; i < 30; i++) { await sleep(500); const n = await page.evaluate(() => window.rt.windowInstances.get('w_itempricepolicy_form')?.props.get('id_list')?.model?.rowCount?.() ?? 0); if (n > 0) { out.listRows = n; break; } await poll(1); }
  out.pick = await page.evaluate(async (policy) => {
    const rt = window.rt; const w = rt.windowInstances.get('w_itempricepolicy_form');
    const l = w.props.get('id_list'); const m = l.model;
    const ci = m.colIndex('code');
    const hit = [...m.buf.primary.entries()].find(([, r]) => Number(r.v[ci]) === policy);
    if (!hit) return { error: 'policy not in list', rows: m.rowCount() };
    w.props.set('id_dwcontrol', l); w.props.set('il_selectedrow', hit[0] + 1);
    await w.pbCall('ue_detail', [], rt).catch(() => {});
    await new Promise((r) => setTimeout(r, 2500));
    const mm = w.props.get('id_master'); const d = w.props.get('id_detail');
    return { row: hit[0] + 1, listRows: m.rowCount(), masterCode: String(mm?.model?.buf.primary[0]?.v?.[mm.model.colIndex('code')] ?? ''), detailRows: d?.model?.rowCount?.() ?? null, details: d?.model?.buf?.primary?.map((x) => x.v) ?? null };
  }, POLICY);
  await poll(2);
  out.open = await page.evaluate(() => {
    const w = window.rt.windowInstances.get('w_itempricepolicy_form');
    return {
      title: String(w.props.get('title') ?? ''),
      masterRows: w.props.get('id_master')?.model?.rowCount?.() ?? null,
      masterCols: w.props.get('id_master')?.model?.colNames ?? null,
      detailRows: w.props.get('id_detail')?.model?.rowCount?.() ?? null,
      detailCols: w.props.get('id_detail')?.model?.colNames ?? null,
    };
  });
  // add a new slab through the real New Item path
  out.newItem = await page.evaluate(async () => {
    const rt = window.rt; const w = rt.windowInstances.get('w_itempricepolicy_form');
    w.props.set('ib_itemvalidated', true); w.props.set('ib_validatefullcode', true);
    await w.pbCall('ue_newitem', [], rt).catch(() => {});
    await new Promise((r) => setTimeout(r, 400));
    const d = w.props.get('id_detail');
    return { rows: d.model.rowCount(), cols: d.model.colNames };
  });
  out.fillAdd = await page.evaluate(async ({ slab }) => {
    const rt = window.rt; const w = rt.windowInstances.get('w_itempricepolicy_form');
    const d = w.props.get('id_detail');
    const row = d.model.rowCount();
    for (const [n, v] of Object.entries({ qtylimit: slab, price: 251, itemflatdisc: 0, discperc: 0, expirydate: '2030-12-12 00:00:00' })) await d.pbCall('setitem', [row, n, v], rt).catch(() => {});
    w.props.set('ib_itemvalidated', true);
    await d.pbCall('accepttext', [], rt).catch(() => {});
    return { row, rows: d.model.rowCount(), values: d.model.buf.primary[row - 1]?.v };
  }, { slab: SLAB });
  out.save1 = await save('__save1');
  out.afterAdd = {
    row: rows(`select pricepolicycode,qtylimit,price,itemflatdisc,discperc,expirydate::text from dbo.pricepolicydetail where pricepolicycode=${POLICY} and qtylimit=${SLAB}`),
    details: Number(rows('select count(*) from dbo.pricepolicydetail')[0][0]),
    header: rows(`select pricepolicycode,name,icode from dbo.pricepolicy where pricepolicycode=${POLICY}`),
  };
  out.addOk = out.afterAdd.row?.length === 1 && out.afterAdd.row[0][2] === '251.0000' && out.afterAdd.header?.[0]?.[0] === String(POLICY)
    && out.messages.some((m) => /Changes take effect in database/i.test(m));
  // the original save clears id_master.code after committing; reopen so the
  // header is treated as an existing policy rather than a new one
  out.headerCodeAfterSave = await page.evaluate(() => {
    const w = window.rt.windowInstances.get('w_itempricepolicy_form'); const m = w.props.get('id_master');
    return { code: String(m?.model?.buf.primary[0]?.v?.[m.model.colIndex('code')] ?? ''), status: m?.model ? m.model.getStatus(1, 0) : null };
  });
  out.reopenEdit = await reopenPolicy();
  // edit the slab
  out.edit = await page.evaluate(async ({ slab }) => {
    const rt = window.rt; const w = rt.windowInstances.get('w_itempricepolicy_form'); const d = w.props.get('id_detail');
    let row = 0;
    for (const [i, r] of d.model.buf.primary.entries()) if (Number(r.v[d.model.colIndex('qtylimit')]) === slab) { row = i + 1; break }
    await d.pbCall('setitem', [row, 'price', 252], rt).catch(() => {});
    await d.pbCall('accepttext', [], rt).catch(() => {});
    return { row };
  }, { slab: SLAB });
  out.save2 = await save('__save2');
  out.afterEdit = { row: rows(`select pricepolicycode,qtylimit,price from dbo.pricepolicydetail where pricepolicycode=${POLICY} and qtylimit=${SLAB}`) };
  out.editOk = out.afterEdit.row?.[0]?.[2] === '252.0000';
  out.headerCodeAfterEditSave = await page.evaluate(() => {
    const w = window.rt.windowInstances.get('w_itempricepolicy_form'); const m = w.props.get('id_master');
    return { code: String(m?.model?.buf.primary[0]?.v?.[m.model.colIndex('code')] ?? ''), status: m?.model ? m.model.getStatus(1, 0) : null };
  });
  out.reopenDelete = await reopenPolicy();
  // delete the slab through the detail buffer
  out.deleteRows = await page.evaluate(async ({ slab }) => {
    const rt = window.rt; const w = rt.windowInstances.get('w_itempricepolicy_form'); const d = w.props.get('id_detail');
    let row = 0;
    for (const [i, r] of d.model.buf.primary.entries()) if (Number(r.v[d.model.colIndex('qtylimit')]) === slab) { row = i + 1; break }
    if (row) await d.pbCall('deleterow', [row], rt).catch(() => {});
    return { row, rows: d.model.rowCount() };
  }, { slab: SLAB });
  out.save3 = await save('__save3');
  out.afterDelete = {
    row: rows(`select count(*) from dbo.pricepolicydetail where pricepolicycode=${POLICY} and qtylimit=${SLAB}`),
    details: Number(rows('select count(*) from dbo.pricepolicydetail')[0][0]),
    header: rows(`select pricepolicycode,name,icode from dbo.pricepolicy where pricepolicycode=${POLICY}`),
  };
  out.deleteOk = out.afterDelete.row?.[0]?.[0] === '0' && out.afterDelete.details === out.baseline.details;
  restore();
  out.final = {
    policies: Number(rows('select count(*) from dbo.pricepolicy')[0][0]),
    policyMax: Number(rows('select max(pricepolicycode) from dbo.pricepolicy')[0][0]),
    details: Number(rows('select count(*) from dbo.pricepolicydetail')[0][0]),
    detailsPolicy: rows(`select pricepolicycode,qtylimit,price,itemflatdisc,discperc,expirydate::text from dbo.pricepolicydetail where pricepolicycode=${POLICY} order by qtylimit`),
    header: rows(`select pricepolicycode,name,icode from dbo.pricepolicy where pricepolicycode=${POLICY}`),
    tab: rows("select tabmaxkey from dbo._tabmaxkey where tabname='PricePolicy'")[0]?.[0] ?? null,
    audit: Number(rows('select count(*) from dbo.audit_log')[0][0]),
    auditMax: Number(rows('select max(audit_id) from dbo.audit_log')[0][0]),
    residue: rows(`select count(*) from dbo.pricepolicydetail where pricepolicycode=${POLICY} and qtylimit=${SLAB}`),
  };
  out.baselineOk = out.final.policies === out.baseline.policies && out.final.policyMax === out.baseline.policyMax
    && out.final.details === out.baseline.details
    && JSON.stringify(out.final.detailsPolicy) === JSON.stringify(out.baseline.detailsPolicy)
    && JSON.stringify(out.final.header) === JSON.stringify(out.baseline.header)
    && out.final.tab === out.baseline.tab && out.final.audit === out.baseline.audit && out.final.auditMax === out.baseline.auditMax
    && out.final.residue?.[0]?.[0] === '0';
  out.ok = !!out.addOk && !!out.editOk && !!out.deleteOk && out.baselineOk;
} catch (e) { out.fatal = String(e.stack || e).slice(0, 2400); }
finally {
  restore();
  console.log(JSON.stringify(out, (k, v) => (typeof v === 'bigint' ? Number(v) : v), 1));
  await browser.close().catch(() => {});
}
