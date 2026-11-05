// Item Part add / reopen-edit / reopen-detail-delete cycle.
//
// Master d_item_part -> ItemPart; detail d_itempartinmodel -> ItemPartInModel.
// The original ue_save calls id_master.update(true,false) and then
// id_detail.update(true,false) with resetflag = false, but only resets the
// MASTER (id_master.resetupdate()).  A second save in the same detail buffer
// therefore re-inserts the already-saved detail row; the normal workflow
// reopens the record through File | List -> ue_detail -> wf_retrieve, which
// resets the detail DataWindow.  Both paths are measured here.
//
// Model has 0 rows in both DBs, so temporary Model 1/2 rows are inserted and
// removed in a finally block.  Header File | Delete is disabled in the
// original and has no ue_delete handler, so cleanup is SQL.
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const require = createRequire(process.env.PLAYWRIGHT_MODULES || 'C:/Users/Admin/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/');
const { chromium } = require('playwright');
const PSQL = 'C:\\PostgreSQL\\17\\bin\\psql.exe';
const q = (sql) => execFileSync(PSQL, ['-U', 'postgres', '-h', '127.0.0.1', '-d', 'trader_write_test', '-t', '-A', '-F', '|', '-c', sql], { env: { ...process.env, PGPASSWORD: 'postgres' }, encoding: 'utf8', windowsHide: true }).trim();
const rows = (sql) => q(sql).split(/\r?\n/).filter(Boolean).map((l) => l.split('|'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SUF = String(Date.now()).slice(-6);
const NAME = 'PARITY ITEMPART ' + SUF;
const NAME2 = NAME + ' EDIT';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const out = { name: NAME, name2: NAME2, messages: [], errors: [], net: [] };
page.on('pageerror', (e) => out.errors.push(String(e.message || e).slice(0, 400)));
page.on('request', (r) => { if (r.url().includes('/api/exec')) out.net.push({ p: 'req', body: String(r.postData() || '') }) });
page.on('response', async (r) => { if (r.url().includes('/api/exec')) { let b = ''; try { b = await r.text() } catch {} out.net.push({ p: 'res', status: r.status(), body: String(b).slice(0, 400) }) } });
async function poll(seconds = 8) {
  for (let i = 0; i < seconds * 2; i++) {
    await sleep(500);
    const msgs = await page.evaluate(() => [...document.querySelectorAll('.msgbox .txt')].map((e) => e.textContent.replace(/\s+/g, ' ').trim().slice(0, 240)));
    if (msgs.length) {
      out.messages.push(...msgs);
      await page.evaluate(() => { for (const b of document.querySelectorAll('.msgbox')) { const bs = [...b.querySelectorAll('.btns button')]; (bs.find((x) => /^(yes|ok)$/i.test(x.textContent.trim())) || bs[0])?.click(); } });
      await sleep(250);
    }
  }
}
async function startSave(key) {
  await page.evaluate(async (k) => {
    const rt = window.rt; const w = rt.windowInstances.get('w_item_part_form');
    window[k] = false;
    void w.pbCall('ue_save', [], rt).then(() => { window[k] = 'ok' }).catch((e) => { window[k] = 'ERR ' + String(e.message || e).slice(0, 400) });
  }, key);
  await poll(10);
  return page.evaluate((k) => window[k] ?? null, key);
}
async function reopen(code) {
  await page.evaluate(async () => {
    const rt = window.rt; const w = rt.windowInstances.get('w_item_part_form');
    await w.pbCall('ue_list', [], rt).catch((e) => { window.__listErr = String(e.message || e).slice(0, 200) });
  });
  await sleep(1800); await poll(2);
  out.listPick = await page.evaluate((c) => {
    const rt = window.rt; const w = rt.windowInstances.get('w_item_part_form');
    const l = w.props.get('id_list');
    let idx = 0;
    if (l?.model) {
      const ci = l.model.colIndex('code');
      for (let i = 0; i < l.model.buf.primary.length; i++) if (Number(l.model.buf.primary[i].v[ci]) === Number(c)) { idx = i + 1; break; }
    }
    w.props.set('il_selectedrow', idx);
    return { rows: l?.model?.rowCount?.() ?? null, idx };
  }, Number(code));
  out.reopen = await page.evaluate(async () => {
    const rt = window.rt; const w = rt.windowInstances.get('w_item_part_form');
    try { await w.pbCall('ue_detail', [], rt) } catch (e) { window.__detailErr = String(e.message || e).slice(0, 240) }
    const m = w.props.get('id_master'); const d = w.props.get('id_detail');
    const status = (dw, r) => dw?.model ? dw.model.getStatus(r, 0) : null;
    return {
      masterRows: m?.model?.rowCount?.() ?? null,
      masterCode: m?.model ? String(m.model.buf.primary[0]?.v?.[m.model.colIndex('code')] ?? '') : null,
      masterStatus: status(m, 1),
      detailRows: d?.model?.rowCount?.() ?? null,
      details: d?.model?.buf?.primary?.map((x) => x.v) ?? null,
      detailStatuses: d?.model?.buf?.primary?.map((_, i) => status(d, i + 1)) ?? null,
      detailErr: window.__detailErr ?? null,
    };
  });
  await sleep(700); await poll(1);
  return out.reopen;
}
const restore = () => {
  try {
    q(`delete from dbo.itempartinmodel where ipartcode in (select ipartcode from dbo.itempart where name like 'PARITY ITEMPART %')`);
    q(`delete from dbo.itempart where name like 'PARITY ITEMPART %'`);
    q("delete from dbo.model where modelcode in (1,2) and name like 'PARITY TEMP MODEL%'");
    if (out.baseline?.tab !== null) q(`update dbo._tabmaxkey set tabmaxkey=${Number(out.baseline.tab)} where tabname='ItemPart'`);
    if (out.baseline?.modelTab !== null) q(`update dbo._tabmaxkey set tabmaxkey=${Number(out.baseline.modelTab)} where tabname='Model'`);
    if (out.baseline?.auditMax) { q(`delete from dbo.audit_log where audit_id > ${out.baseline.auditMax}`); q(`select setval(pg_get_serial_sequence('dbo.audit_log','audit_id'), ${out.baseline.auditMax}, true)`); }
  } catch (e) { out.restoreError = String(e.message || e).slice(0, 500); }
};
try {
  out.baseline = {
    parts: Number(rows('select count(*) from dbo.itempart')[0][0]),
    partRows: rows('select ipartcode,name,description,application,remarks,icatcode,iccode,manfcode,gcode from dbo.itempart order by ipartcode'),
    pim: Number(rows('select count(*) from dbo.itempartinmodel')[0][0]),
    model: Number(rows('select count(*) from dbo.model')[0][0]),
    tab: rows("select tabmaxkey from dbo._tabmaxkey where tabname='ItemPart'")[0]?.[0] ?? null,
    modelTab: rows("select tabmaxkey from dbo._tabmaxkey where tabname='Model'")[0]?.[0] ?? null,
    audit: Number(rows('select count(*) from dbo.audit_log')[0][0]),
    auditMax: Number(rows('select max(audit_id) from dbo.audit_log')[0][0]),
  };
  q("insert into dbo.model (modelcode,name,description) values (1,'PARITY TEMP MODEL 1','TEMP') on conflict (modelcode) do nothing");
  q("insert into dbo.model (modelcode,name,description) values (2,'PARITY TEMP MODEL 2','TEMP') on conflict (modelcode) do nothing");
  await page.goto('http://127.0.0.1:5177/?app=1&autologin=ADMIN:password9080', { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.rt && window.rt.windowInstances.get('w_main') && typeof window.__menu === 'function', null, { timeout: 90000, polling: 300 });
  out.menuOpen = await page.evaluate(async () => {
    const rt = window.rt; const root = rt.windowInstances.get('w_main')?.props.get('menuid');
    const find = (o, n) => { for (const c of o.children.values()) { if (c.name === n) return c; const r = find(c, n); if (r) return r } return null };
    const item = root ? find(root, 'm_itempart') : null;
    if (!item) return { found: false };
    await rt.fire(item, 'selected').catch(() => {});
    await rt.fire(item, 'clicked').catch((e) => { window.__menuErr = String(e.message || e) });
    return { found: true, visible: item.props.get('visible'), text: String(item.props.get('text') ?? '') };
  });
  await page.waitForFunction(() => window.rt.windowInstances.get('w_item_part_form'), null, { timeout: 40000, polling: 300 });
  await sleep(1600); await poll(2);
  await page.evaluate(async () => { const rt = window.rt; const w = rt.windowInstances.get('w_item_part_form'); await w.pbCall('ue_newform', [], rt).catch(() => {}) });
  await sleep(1000); await poll(2);
  out.open = await page.evaluate(() => {
    const rt = window.rt; const w = rt.windowInstances.get('w_item_part_form');
    return {
      title: String(w.props.get('title') ?? ''),
      masterRows: w.props.get('id_master')?.model?.rowCount?.() ?? null,
      masterCols: w.props.get('id_master')?.model?.colNames ?? null,
      detailRows: w.props.get('id_detail')?.model?.rowCount?.() ?? null,
      detailCols: w.props.get('id_detail')?.model?.colNames ?? null,
    };
  });
  // ---------------------------------------------------------------- add
  out.fillAdd = await page.evaluate(async ({ name }) => {
    const rt = window.rt; const w = rt.windowInstances.get('w_item_part_form');
    const m = w.props.get('id_master'); const d = w.props.get('id_detail');
    if (!m?.model || !d?.model) return { error: 'missing master/detail' };
    if (m.model.rowCount() === 0) await m.pbCall('insertrow', [0], rt);
    for (const [n, v] of Object.entries({ name, description: 'PARITY ITEM PART DESCRIPTION', application: 'PARITY APPLICATION', remarks: 'PARITY REMARKS', icatcode: 1, iccode: 1, manfcode: 1, gcode: 1, purprice: 0, saleprice: 0, reorderlevel: 0, minlevel: 0, maxlevel: 0, qtyused: 0 })) await m.pbCall('setitem', [1, n, v], rt).catch(() => {});
    if (d.model.rowCount() === 0) await d.pbCall('insertrow', [0], rt);
    await d.pbCall('setitem', [1, 'modelcode', 1], rt).catch(() => {});
    w.props.set('ib_itemvalidated', true); w.props.set('il_currrow', 1);
    await m.pbCall('accepttext', [], rt).catch(() => {}); await d.pbCall('accepttext', [], rt).catch(() => {});
    return { master: m.model.buf.primary[0]?.v, detail: d.model.buf.primary[0]?.v };
  }, { name: NAME });
  out.save1 = await startSave('__save1');
  out.afterAdd = {
    part: rows(`select ipartcode,name,description,application,remarks,icatcode,iccode,manfcode,gcode from dbo.itempart where name='${NAME}'`),
    models: rows(`select ipartcode,modelcode from dbo.itempartinmodel order by ipartcode,modelcode`),
    tab: rows("select tabmaxkey from dbo._tabmaxkey where tabname='ItemPart'"),
  };
  out.code = out.afterAdd.part?.[0]?.[0] ?? null;
  out.addOk = !!out.code && out.afterAdd.models?.some((r) => String(r[0]) === String(out.code) && String(r[1]) === '1')
    && out.afterAdd.tab?.[0]?.[0] === String(Number(out.code)) && out.messages.some((m) => /Changes take effect in database/i.test(m));
  // ------------------------------------------- in-place second save (defect)
  // This is what the original does if the user edits again without reopening:
  // only the master was reset, the detail is still flagged new-modified.
  const netStart = out.net.length;
  out.inPlace = await page.evaluate(async ({ name2 }) => {
    const rt = window.rt; const w = rt.windowInstances.get('w_item_part_form');
    const m = w.props.get('id_master'); const d = w.props.get('id_detail');
    await m.pbCall('setitem', [1, 'name', name2], rt).catch(() => {});
    await d.pbCall('insertrow', [0], rt).catch(() => {});
    await d.pbCall('setitem', [d.model.rowCount(), 'modelcode', 2], rt).catch(() => {});
    w.props.set('ib_itemvalidated', true);
    await m.pbCall('accepttext', [], rt).catch(() => {}); await d.pbCall('accepttext', [], rt).catch(() => {});
    return { beforeRows: d.model.rowCount() - 1, afterRows: d.model.rowCount(), details: d.model.buf.primary.map((x) => x.v) };
  }, { name2: NAME2 });
  out.inPlaceSave = await startSave('__saveInPlace');
  out.inPlaceEvidence = out.net.slice(netStart).filter((e) => e.p === 'req').map((e) => {
    try { const o = JSON.parse(e.body); return { sql: String(o.sql).slice(0, 180), params: o.params }; } catch { return { raw: e.body.slice(0, 120) }; }
  });
  out.inPlaceDup = out.inPlaceEvidence.some((e) => /INSERT INTO dbo\.itempartinmodel/i.test(e.sql ?? ''));
  out.inPlaceRejected = rows(`select name from dbo.itempart where ipartcode=${Number(out.code ?? 0)}`)[0]?.[0] === NAME;
  // ------------------------------------------------------- reopen + edit
  out.reopenEdit = await reopen(out.code);
  out.fillEdit = await page.evaluate(async ({ name2 }) => {
    const rt = window.rt; const w = rt.windowInstances.get('w_item_part_form');
    const m = w.props.get('id_master'); const d = w.props.get('id_detail');
    await m.pbCall('setitem', [1, 'name', name2], rt).catch(() => {});
    await m.pbCall('setitem', [1, 'remarks', 'PARITY REMARKS EDITED'], rt).catch(() => {});
    await d.pbCall('insertrow', [0], rt).catch(() => {});
    await d.pbCall('setitem', [d.model.rowCount(), 'modelcode', 2], rt).catch(() => {});
    w.props.set('ib_itemvalidated', true);
    await m.pbCall('accepttext', [], rt).catch(() => {}); await d.pbCall('accepttext', [], rt).catch(() => {});
    return { master: m.model.buf.primary[0]?.v, details: d.model.buf.primary.map((x) => x.v) };
  }, { name2: NAME2 });
  out.save2 = await startSave('__save2');
  out.afterEdit = {
    part: rows(`select ipartcode,name,remarks from dbo.itempart where ipartcode=${Number(out.code ?? 0)}`),
    models: rows(`select ipartcode,modelcode from dbo.itempartinmodel where ipartcode=${Number(out.code ?? 0)} order by modelcode`),
  };
  out.editOk = out.afterEdit.part?.[0]?.[1] === NAME2 && out.afterEdit.part?.[0]?.[2] === 'PARITY REMARKS EDITED'
    && out.afterEdit.models?.length === 2 && out.afterEdit.models.some((r) => String(r[1]) === '1') && out.afterEdit.models.some((r) => String(r[1]) === '2')
    && out.messages.filter((m) => /Changes take effect in database/i.test(m)).length >= 2;
  // ------------------------------------------------ reopen + detail delete
  out.reopenDelete = await reopen(out.code);
  out.fillDelete = await page.evaluate(async () => {
    const rt = window.rt; const w = rt.windowInstances.get('w_item_part_form');
    const d = w.props.get('id_detail');
    while (d.model.rowCount() > 0) await d.pbCall('deleterow', [1], rt).catch(() => {});
    return { detailRows: d.model.rowCount() };
  });
  out.save3 = await startSave('__save3');
  out.afterDetailDelete = {
    part: rows(`select ipartcode,name from dbo.itempart where ipartcode=${Number(out.code ?? 0)}`),
    models: rows(`select count(*) from dbo.itempartinmodel where ipartcode=${Number(out.code ?? 0)}`),
  };
  out.detailDeleteOk = out.afterDetailDelete.part?.length === 1 && out.afterDetailDelete.models?.[0]?.[0] === '0';
  // ---------------------------------------------------- header delete state
  out.headerDelete = await page.evaluate(async () => {
    const rt = window.rt; const w = rt.windowInstances.get('w_item_part_form');
    const menu = w.props.get('menuid') || w.props.get('im_menu');
    const find = (o, n) => { for (const c of o.children.values()) { if (c.name === n) return c; const r = find(c, n); if (r) return r } return null };
    const del = menu ? find(menu, 'm_delete') : null;
    return { found: !!del, enabled: del ? del.props.get('enabled') !== false : null };
  });
  restore();
  out.final = {
    parts: Number(rows('select count(*) from dbo.itempart')[0][0]),
    partRows: rows('select ipartcode,name,description,application,remarks,icatcode,iccode,manfcode,gcode from dbo.itempart order by ipartcode'),
    pim: Number(rows('select count(*) from dbo.itempartinmodel')[0][0]),
    model: Number(rows('select count(*) from dbo.model')[0][0]),
    tab: rows("select tabmaxkey from dbo._tabmaxkey where tabname='ItemPart'")[0]?.[0] ?? null,
    modelTab: rows("select tabmaxkey from dbo._tabmaxkey where tabname='Model'")[0]?.[0] ?? null,
    audit: Number(rows('select count(*) from dbo.audit_log')[0][0]),
    auditMax: Number(rows('select max(audit_id) from dbo.audit_log')[0][0]),
    residue: rows(`select count(*) from dbo.itempart where name like 'PARITY ITEMPART %'`),
  };
  out.baselineOk = out.final.parts === out.baseline.parts && JSON.stringify(out.final.partRows) === JSON.stringify(out.baseline.partRows)
    && out.final.pim === out.baseline.pim && out.final.model === out.baseline.model
    && out.final.tab === out.baseline.tab && out.final.modelTab === out.baseline.modelTab
    && out.final.audit === out.baseline.audit && out.final.auditMax === out.baseline.auditMax
    && out.final.residue?.[0]?.[0] === '0';
  out.ok = !!out.addOk && !!out.inPlaceRejected && !!out.editOk && !!out.detailDeleteOk && out.baselineOk;
} catch (e) { out.fatal = String(e.stack || e).slice(0, 2400); }
finally {
  restore();
  console.log(JSON.stringify(out, (k, v) => (typeof v === 'bigint' ? Number(v) : v), 1));
  await browser.close().catch(() => {});
}
