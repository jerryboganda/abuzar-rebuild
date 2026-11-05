// Zone end-to-end add/edit/save and delete-state test.
// Zone requires both ZoneAreas and ZoneContactGroup to update.  ContactGroup
// is empty in both DBs, so the probe inserts temporary ContactGroup 1/2 rows,
// adds a Zone with one area + one contact group, edits it, records the delete
// state, then removes every fixture and restores tabmax/audit.
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const require = createRequire(process.env.PLAYWRIGHT_MODULES || 'C:/Users/Admin/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/');
const { chromium } = require('playwright');
const PSQL = 'C:\\PostgreSQL\\17\\bin\\psql.exe';
const q = (sql) => execFileSync(PSQL, ['-U', 'postgres', '-h', '127.0.0.1', '-d', 'trader_write_test', '-t', '-A', '-F', '|', '-c', sql], { env: { ...process.env, PGPASSWORD: 'postgres' }, encoding: 'utf8', windowsHide: true }).trim();
const rows = (sql) => q(sql).split(/\r?\n/).filter(Boolean).map((l) => l.split('|'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SUF = String(Date.now()).slice(-6);
const NAME = 'PARITY ZONE ' + SUF;
const NAME2 = NAME + ' EDIT';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const out = { name: NAME, name2: NAME2, messages: [], errors: [], net: [] };
page.on('pageerror', (e) => out.errors.push(String(e.message || e).slice(0, 400)));
page.on('request', (r) => { if (r.url().includes('/api/exec')) out.net.push({ p: 'req', body: String(r.postData() || '') }) });
page.on('response', async (r) => { if (r.url().includes('/api/exec')) { let b = ''; try { b = await r.text() } catch {} out.net.push({ p: 'res', status: r.status(), body: String(b).slice(0, 300) }) } });
async function poll(seconds = 8) {
  for (let i = 0; i < seconds * 2; i++) {
    await sleep(500);
    const msgs = await page.evaluate(() => [...document.querySelectorAll('.msgbox .txt')].map((e) => e.textContent.replace(/\s+/g, ' ').trim().slice(0, 240)));
    if (msgs.length) {
      out.messages.push(...msgs);
      await page.evaluate(() => { for (const b of document.querySelectorAll('.msgbox')) { const bs = [...b.querySelectorAll('.btns button')]; (bs.find((x) => /^yes$/i.test(x.textContent.trim())) || bs.find((x) => /^(ok|no|close)$/i.test(x.textContent.trim())) || bs[0])?.click(); } });
      await sleep(250);
    }
  }
}
const restore = () => {
  try {
    q(`delete from dbo.zonecontactgroup where zonecode in (select zonecode from dbo.zone where name like 'PARITY ZONE %')`);
    q(`delete from dbo.zoneareas where zonecode in (select zonecode from dbo.zone where name like 'PARITY ZONE %')`);
    q(`delete from dbo.zone where name like 'PARITY ZONE %'`);
    q("delete from dbo.contactgroup where name like 'PARITY CG %'");
    q("update dbo._tabmaxkey set tabmaxkey=0 where tabname='Zone'");
    q("update dbo._tabmaxkey set tabmaxkey=0 where tabname='ContactGroup'");
    if (out.baseline?.auditMax) {
      q(`delete from dbo.audit_log where audit_id > ${out.baseline.auditMax}`);
      q(`select setval(pg_get_serial_sequence('dbo.audit_log','audit_id'), ${out.baseline.auditMax}, true)`);
    }
  } catch (e) { out.restoreError = String(e.message || e).slice(0, 500); }
};
try {
  out.baseline = {
    zone: Number(rows('select count(*) from dbo.zone')[0][0]),
    za: Number(rows('select count(*) from dbo.zoneareas')[0][0]),
    zcg: Number(rows('select count(*) from dbo.zonecontactgroup')[0][0]),
    cg: Number(rows('select count(*) from dbo.contactgroup')[0][0]),
    tabZone: rows("select tabmaxkey from dbo._tabmaxkey where tabname='Zone'")[0]?.[0] ?? null,
    tabCG: rows("select tabmaxkey from dbo._tabmaxkey where tabname='ContactGroup'")[0]?.[0] ?? null,
    audit: Number(rows('select count(*) from dbo.audit_log')[0][0]),
    auditMax: Number(rows('select max(audit_id) from dbo.audit_log')[0][0]),
  };
  q("insert into dbo.contactgroup (contactgroupcode,name) values (1,'PARITY CG ONE'), (2,'PARITY CG TWO')");
  await page.goto('http://127.0.0.1:5177/?app=1&autologin=ADMIN:password9080', { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.rt && window.rt.windowInstances.get('w_main') && typeof window.__menu === 'function', null, { timeout: 90000, polling: 300 });
  out.menuOpen = await page.evaluate(async () => {
    const rt = window.rt; const root = rt.windowInstances.get('w_main')?.props.get('menuid');
    const find = (o, n) => { for (const c of o.children.values()) { if (c.name === n) return c; const r = find(c, n); if (r) return r } return null };
    const item = root ? find(root, 'm_zone0') : null;
    if (!item) return { found: false };
    await rt.fire(item, 'selected').catch(() => {});
    await rt.fire(item, 'clicked').catch((e) => { window.__menuErr = String(e.message || e) });
    return { found: true, visible: item.props.get('visible'), text: String(item.props.get('text') ?? '') };
  });
  await page.waitForFunction(() => window.rt.windowInstances.get('w_zone'), null, { timeout: 40000, polling: 300 });
  await sleep(1500); await poll(2);
  // reset to a blank form
  await page.evaluate(async () => {
    const rt = window.rt; const w = rt.windowInstances.get('w_zone');
    await w.pbCall('ue_newform', [], rt).catch(() => {});
  });
  await sleep(1200); await poll(2);
  out.open = await page.evaluate(() => {
    const rt = window.rt; const w = rt.windowInstances.get('w_zone');
    const cg = w.props.get('ids_zonecontactgroup') || [...w.children.values()].find((c) => String(c.props?.get('dataobject') ?? '').toLowerCase() === 'd_zonecontactgroup');
    return {
      title: String(w.props.get('title') ?? ''),
      masterRows: w.props.get('id_master')?.model?.rowCount?.() ?? null,
      masterCols: w.props.get('id_master')?.model?.colNames ?? null,
      detailRows: w.props.get('id_detail')?.model?.rowCount?.() ?? null,
      detailCols: w.props.get('id_detail')?.model?.colNames ?? null,
      cgName: cg?.name ?? null,
      cgRows: cg?.model?.rowCount?.() ?? null,
      cgCols: cg?.model?.colNames ?? null,
    };
  });
  out.fillAdd = await page.evaluate(async ({ name }) => {
    const rt = window.rt; const w = rt.windowInstances.get('w_zone');
    const m = w.props.get('id_master'); const d = w.props.get('id_detail');
    const cg = w.props.get('ids_zonecontactgroup') || [...w.children.values()].find((c) => String(c.props?.get('dataobject') ?? '').toLowerCase() === 'd_zonecontactgroup');
    if (!m?.model || !d?.model) return { error: 'missing master/detail' };
    if (!cg?.model) return { error: 'missing contactgroup', cgName: cg?.name ?? null };
    if (m.model.rowCount() === 0) await m.pbCall('insertrow', [0], rt);
    for (const [n, v] of Object.entries({ name, manfcode: 1, manager: 'PARITY ZONE MANAGER', remarks: 'PARITY ZONE REMARKS', icatcode: 1, useforsms: 'N' })) await m.pbCall('setitem', [1, n, v], rt).catch(() => {});
    if (d.model.rowCount() === 0) await d.pbCall('insertrow', [0], rt);
    for (const [n, v] of Object.entries({ areacode: 1, rowid: 1 })) await d.pbCall('setitem', [1, n, v], rt).catch(() => {});
    if (cg.model.rowCount() === 0) await cg.pbCall('insertrow', [0], rt);
    await cg.pbCall('setitem', [1, 'contactgroupcode', 1], rt).catch(() => {});
    w.props.set('il_currrow', 1);
    w.props.set('ib_itemvalidated', true);
    await m.pbCall('accepttext', [], rt).catch(() => {});
    await d.pbCall('accepttext', [], rt).catch(() => {});
    await cg.pbCall('accepttext', [], rt).catch(() => {});
    return { master: m.model.buf.primary[0]?.v, detail: d.model.buf.primary[0]?.v, cg: cg.model.buf.primary[0]?.v };
  }, { name: NAME });
  out.addSave = await page.evaluate(async () => {
    const rt = window.rt; const w = rt.windowInstances.get('w_zone');
    window.__saveDone = false;
    void w.pbCall('ue_save', [], rt).then(() => { window.__saveDone = 'ok' }).catch((e) => { window.__saveDone = 'ERR ' + String(e.message || e).slice(0, 400) });
    return 'fired';
  });
  await poll(10);
  out.afterAdd = {
    saveDone: await page.evaluate(() => window.__saveDone ?? null),
    zone: rows(`select zonecode,name,manfcode,manager,icatcode,useforsms from dbo.zone where name='${NAME}'`),
    areas: rows(`select zonecode,areacode,rowid from dbo.zoneareas order by zonecode,areacode`),
    cg: rows(`select zonecode,contactgroupcode from dbo.zonecontactgroup order by zonecode,contactgroupcode`),
    tabZone: rows("select tabmaxkey from dbo._tabmaxkey where tabname='Zone'"),
  };
  out.code = out.afterAdd.zone?.[0]?.[0] ?? null;
  out.addOk = !!out.code && out.afterAdd.areas?.[0]?.[1] === '1' && out.afterAdd.cg?.[0]?.[1] === '1'
    && out.afterAdd.tabZone?.[0]?.[0] === String(Number(out.code)) && out.messages.some((m) => /Changes take effect in database/i.test(m));
  // edit: name/remarks + detail rowid + contactgroup code
  out.fillEdit = await page.evaluate(async ({ name2 }) => {
    const rt = window.rt; const w = rt.windowInstances.get('w_zone');
    const m = w.props.get('id_master'); const d = w.props.get('id_detail');
    const cg = w.props.get('ids_zonecontactgroup') || [...w.children.values()].find((c) => String(c.props?.get('dataobject') ?? '').toLowerCase() === 'd_zonecontactgroup');
    await m.pbCall('setitem', [1, 'name', name2], rt).catch(() => {});
    await m.pbCall('setitem', [1, 'remarks', 'PARITY ZONE REMARKS EDITED'], rt).catch(() => {});
    await d.pbCall('setitem', [1, 'rowid', 2], rt).catch(() => {});
    await cg.pbCall('setitem', [1, 'contactgroupcode', 2], rt).catch(() => {});
    await m.pbCall('accepttext', [], rt).catch(() => {});
    await d.pbCall('accepttext', [], rt).catch(() => {});
    await cg.pbCall('accepttext', [], rt).catch(() => {});
    window.__saveDone2 = false;
    void w.pbCall('ue_save', [], rt).then(() => { window.__saveDone2 = 'ok' }).catch((e) => { window.__saveDone2 = 'ERR ' + String(e.message || e).slice(0, 400) });
    return { master: m.model.buf.primary[0]?.v, detail: d.model.buf.primary[0]?.v, cg: cg.model.buf.primary[0]?.v };
  }, { name2: NAME2 });
  await poll(10);
  out.afterEdit = {
    saveDone: await page.evaluate(() => window.__saveDone2 ?? null),
    zone: rows(`select zonecode,name,remarks from dbo.zone where zonecode=${Number(out.code ?? 0)}`),
    areas: rows(`select zonecode,areacode,rowid from dbo.zoneareas where zonecode=${Number(out.code ?? 0)}`),
    cg: rows(`select zonecode,contactgroupcode from dbo.zonecontactgroup where zonecode=${Number(out.code ?? 0)}`),
  };
  out.editOk = out.afterEdit.zone?.[0]?.[1] === NAME2
    && out.afterEdit.areas?.[0]?.[2] === '2' && out.afterEdit.cg?.[0]?.[1] === '2'
    && out.messages.filter((m) => /Changes take effect in database/i.test(m)).length >= 2;
  // delete state: list -> detail enables m_delete; record it (no ue_delete handler)
  await page.evaluate(async () => { const rt = window.rt; const w = rt.windowInstances.get('w_zone'); await w.pbCall('ue_list', [], rt).catch(() => {}) });
  await sleep(1600); await poll(2);
  out.deleteState = await page.evaluate((code) => {
    const rt = window.rt; const w = rt.windowInstances.get('w_zone');
    const l = w.props.get('id_list');
    let idx = 0;
    if (l?.model) {
      const ci = l.model.colIndex('code');
      for (let i = 0; i < l.model.buf.primary.length; i++) if (Number(l.model.buf.primary[i].v[ci]) === Number(code)) { idx = i + 1; break; }
    }
    w.props.set('il_selectedrow', idx);
    const menu = w.props.get('menuid') || w.props.get('im_menu');
    const find = (o, n) => { for (const c of o.children.values()) { if (c.name === n) return c; const r = find(c, n); if (r) return r } return null };
    const del = menu ? find(menu, 'm_delete') : null;
    return { idx, listRows: l?.model?.rowCount?.() ?? null, deleteFound: !!del, deleteEnabled: del ? del.props.get('enabled') !== false : null };
  }, Number(out.code));
  await page.evaluate(async () => { const rt = window.rt; const w = rt.windowInstances.get('w_zone'); await w.pbCall('ue_detail', [], rt).catch(() => {}) });
  await sleep(1000); await poll(2);
  out.deleteAfterDetail = await page.evaluate(() => {
    const rt = window.rt; const w = rt.windowInstances.get('w_zone');
    const menu = w.props.get('menuid') || w.props.get('im_menu');
    const find = (o, n) => { for (const c of o.children.values()) { if (c.name === n) return c; const r = find(c, n); if (r) return r } return null };
    const del = menu ? find(menu, 'm_delete') : null;
    return { deleteEnabled: del ? del.props.get('enabled') !== false : null };
  });
  restore();
  out.final = {
    zone: Number(rows('select count(*) from dbo.zone')[0][0]),
    za: Number(rows('select count(*) from dbo.zoneareas')[0][0]),
    zcg: Number(rows('select count(*) from dbo.zonecontactgroup')[0][0]),
    cg: Number(rows('select count(*) from dbo.contactgroup')[0][0]),
    tabZone: rows("select tabmaxkey from dbo._tabmaxkey where tabname='Zone'")[0]?.[0] ?? null,
    tabCG: rows("select tabmaxkey from dbo._tabmaxkey where tabname='ContactGroup'")[0]?.[0] ?? null,
    audit: Number(rows('select count(*) from dbo.audit_log')[0][0]),
    auditMax: Number(rows('select max(audit_id) from dbo.audit_log')[0][0]),
  };
  out.baselineOk = out.final.zone === out.baseline.zone && out.final.za === out.baseline.za && out.final.zcg === out.baseline.zcg
    && out.final.cg === out.baseline.cg && out.final.tabZone === out.baseline.tabZone && out.final.tabCG === out.baseline.tabCG
    && out.final.audit === out.baseline.audit && out.final.auditMax === out.baseline.auditMax;
  out.ok = !!out.addOk && !!out.editOk && out.baselineOk;
} catch (e) { out.fatal = String(e.stack || e).slice(0, 2400); }
finally {
  restore();
  console.log(JSON.stringify(out, (k, v) => (typeof v === 'bigint' ? Number(v) : v), 1));
  await browser.close().catch(() => {});
}
