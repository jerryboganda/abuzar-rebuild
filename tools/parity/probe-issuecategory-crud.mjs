// Issue Category (Maintenance | Issue | Issue Category) add/edit/save cycle.
// The form is a w_multi_entry child: File | New switches to the detail tab and
// posts ue_newform; File | Save triggers the child's ue_save, which calls
// wf_tabnewid, inserts the master row, commits and shows "Changes take effect
// in database".  File | Delete is disabled by w_multi_entry.ue_list.
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const require = createRequire(process.env.PLAYWRIGHT_MODULES || 'C:/Users/Admin/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/');
const { chromium } = require('playwright');
const PSQL = 'C:\\PostgreSQL\\17\\bin\\psql.exe';
const q = (sql) => execFileSync(PSQL, ['-U', 'postgres', '-h', '127.0.0.1', '-d', 'trader_write_test', '-t', '-A', '-F', '|', '-c', sql], { env: { ...process.env, PGPASSWORD: 'postgres' }, encoding: 'utf8', windowsHide: true }).trim();
const rows = (sql) => q(sql).split(/\r?\n/).filter(Boolean).map((l) => l.split('|'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SUF = String(Date.now()).slice(-6);
const NAME = 'PARITY ISSUE CAT ' + SUF;
const NAME2 = NAME + ' EDIT';
const SHORT = 'PIC' + SUF;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const out = { name: NAME, name2: NAME2, short: SHORT, messages: [], errors: [], net: [] };
page.on('pageerror', (e) => out.errors.push(String(e.message || e).slice(0, 400)));
page.on('request', (r) => { if (r.url().includes('/api/exec')) out.net.push({ p: 'req', body: String(r.postData() || '') }) });
page.on('response', async (r) => { if (r.url().includes('/api/exec')) { let b = ''; try { b = await r.text() } catch {} out.net.push({ p: 'res', status: r.status(), body: String(b).slice(0, 300) }) } });
async function poll(seconds = 8) {
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
try {
  out.baseline = {
    cats: Number(rows('select count(*) from dbo.issuecategory')[0][0]),
    accounts: Number(rows('select count(*) from dbo.issuecategoryaccounts')[0][0]),
    tabmax: rows("select tabmaxkey from dbo._tabmaxkey where tabname='IssueCategory'")[0]?.[0] ?? null,
    audit: Number(rows('select count(*) from dbo.audit_log')[0][0]),
    auditMax: Number(rows('select max(audit_id) from dbo.audit_log')[0][0]),
  };
  await page.goto('http://127.0.0.1:5177/?app=1&autologin=ADMIN:password9080', { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.rt && window.rt.windowInstances.get('w_main') && typeof window.__menu === 'function', null, { timeout: 90000, polling: 300 });
  // `Maintenance | Issue` is hidden by the rights/menu state in both apps; fire
  // the real m_issuecategory menu item by name (its clicked handler opens the sheet).
  out.menuOpen = await page.evaluate(async () => {
    const rt = window.rt; const root = rt.windowInstances.get('w_main')?.props.get('menuid');
    const find = (o, n) => { for (const c of o.children.values()) { if (c.name === n) return c; const r = find(c, n); if (r) return r } return null };
    const item = root ? find(root, 'm_issuecategory') : null;
    if (!item) return { found: false };
    await rt.fire(item, 'selected').catch(() => {});
    await rt.fire(item, 'clicked').catch((e) => { window.__menuErr = String(e.message || e) });
    return { found: true, visible: item.props.get('visible'), text: String(item.props.get('text') ?? '') };
  });
  await page.waitForFunction(() => window.rt.windowInstances.get('w_issuecategory'), null, { timeout: 40000, polling: 300 });
  await sleep(1800); await poll(2);
  out.open = await page.evaluate(() => {
    const rt = window.rt; const w = rt.windowInstances.get('w_issuecategory');
    const tab = w.children.get('tab_retrieve') || w.props.get('tab_retrieve');
    return {
      title: String(w.props.get('title') ?? ''),
      selectedTab: tab?.props?.get('selectedtab') ?? null,
      listRows: w.props.get('id_list')?.model?.rowCount?.() ?? null,
      masterRows: w.props.get('id_master')?.model?.rowCount?.() ?? null,
      masterCols: w.props.get('id_master')?.model?.colNames ?? null,
      detailRows: w.props.get('id_detail')?.model?.rowCount?.() ?? null,
    };
  });
  // File | New: fire the real menu item when present, otherwise the tab's
  // posted ue_newform handler (same path).
  out.newFire = await page.evaluate(async () => {
    const rt = window.rt; const w = rt.windowInstances.get('w_issuecategory');
    const menu = w.props.get('menuid') || w.props.get('im_menu');
    const find = (o, n) => { for (const c of o.children.values()) { if (c.name === n) return c; const r = find(c, n); if (r) return r } return null };
    const item = menu ? find(menu, 'm_new') : null;
    if (item) { await rt.fire(item, 'clicked'); return { via: 'm_new', enabled: item.props.get('enabled') !== false }; }
    await w.pbCall('ue_newform', [], rt);
    return { via: 'ue_newform' };
  });
  await sleep(1200); await poll(2);
  out.afterNew = await page.evaluate(() => {
    const rt = window.rt; const w = rt.windowInstances.get('w_issuecategory');
    const m = w.props.get('id_master');
    return { rows: m?.model?.rowCount?.() ?? null, code: m?.model ? String(m.model.buf.primary[0]?.v?.[m.model.colIndex('code')] ?? '') : null, name: m?.model ? String(m.model.buf.primary[0]?.v?.[m.model.colIndex('name')] ?? '') : null };
  });
  out.fill = await page.evaluate(async ({ name, short }) => {
    const rt = window.rt; const w = rt.windowInstances.get('w_issuecategory');
    const m = w.props.get('id_master');
    if (!m?.model) return { error: 'no id_master' };
    if (m.model.rowCount() === 0) await m.pbCall('insertrow', [0], rt);
    const bad = [];
    const set = async (n, v) => { try { await m.pbCall('setitem', [1, n, v], rt) } catch (e) { bad.push(n + ':' + String(e.message || e).slice(0, 50)) } };
    for (const [n, v] of Object.entries({ name, shortname: short, description: 'PARITY ISSUE CATEGORY TEST', accountfor: 'N', posted: 'N', counter: 0, enabled: 'Y' })) await set(n, v);
    await m.pbCall('accepttext', [], rt).catch(() => {});
    return { bad, rows: m.model.rowCount(), values: m.model.buf.primary[0]?.v?.slice(0, 8) };
  }, { name: NAME, short: SHORT });
  // Save through the child's ue_save (the File | Save menu triggers this event)
  out.save1 = await page.evaluate(async () => {
    const rt = window.rt; const w = rt.windowInstances.get('w_issuecategory');
    window.__saveDone = false;
    void w.pbCall('ue_save', [], rt).then(() => { window.__saveDone = 'ok' }).catch((e) => { window.__saveDone = 'ERR ' + String(e.message || e).slice(0, 300) });
    return 'fired';
  });
  await poll(10);
  out.afterAdd = {
    saveDone: await page.evaluate(() => window.__saveDone ?? null),
    row: rows(`select issuecategorycode,name,shortname,description,accountfor,posted,enabled from dbo.issuecategory where name='${NAME}'`),
    tabmax: rows("select tabmaxkey from dbo._tabmaxkey where tabname='IssueCategory'"),
    masterCode: await page.evaluate(() => { const m = window.rt.windowInstances.get('w_issuecategory').props.get('id_master'); return m?.model ? String(m.model.buf.primary[0]?.v?.[m.model.colIndex('code')] ?? '') : null; }),
  };
  out.code = out.afterAdd.row?.[0]?.[0] ?? null;
  out.addOk = !!out.code && out.afterAdd.row?.[0]?.[1] === NAME && out.afterAdd.row?.[0]?.[2] === SHORT
    && out.afterAdd.tabmax?.[0]?.[0] === String(Number(out.code))
    && out.messages.some((m) => /Changes take effect in database/i.test(m));
  // Edit the two text fields and save again (row flags were reset by the app)
  if (out.code) {
    out.edit = await page.evaluate(async ({ name2 }) => {
      const rt = window.rt; const w = rt.windowInstances.get('w_issuecategory');
      const m = w.props.get('id_master');
      await m.pbCall('setitem', [1, 'name', name2], rt).catch(() => {});
      await m.pbCall('setitem', [1, 'description', 'PARITY ISSUE CATEGORY EDITED'], rt).catch(() => {});
      await m.pbCall('accepttext', [], rt).catch(() => {});
      window.__saveDone2 = false;
      void w.pbCall('ue_save', [], rt).then(() => { window.__saveDone2 = 'ok' }).catch((e) => { window.__saveDone2 = 'ERR ' + String(e.message || e).slice(0, 300) });
      return { rows: m.model.rowCount() };
    }, { name2: NAME2 });
    await poll(10);
    out.afterEdit = {
      saveDone: await page.evaluate(() => window.__saveDone2 ?? null),
      row: rows(`select issuecategorycode,name,description from dbo.issuecategory where issuecategorycode=${Number(out.code)}`),
    };
    out.editOk = out.afterEdit.row?.[0]?.[1] === NAME2 && out.afterEdit.row?.[0]?.[2] === 'PARITY ISSUE CATEGORY EDITED'
      && out.messages.filter((m) => /Changes take effect in database/i.test(m)).length >= 2;
  }
  // Delete state: ancestor list mode disables File | Delete
  out.delete = await page.evaluate(() => {
    const rt = window.rt; const w = rt.windowInstances.get('w_issuecategory');
    const menu = w.props.get('menuid') || w.props.get('im_menu');
    const find = (o, n) => { for (const c of o.children.values()) { if (c.name === n) return c; const r = find(c, n); if (r) return r } return null };
    const item = menu ? find(menu, 'm_delete') : null;
    return item ? { found: true, enabled: item.props.get('enabled') !== false } : { found: false };
  });
  // exact cleanup
  if (out.code) {
    q(`delete from dbo.issuecategoryaccounts where issuecategorycode=${Number(out.code)}`);
    q(`delete from dbo.issuecategory where issuecategorycode=${Number(out.code)}`);
  }
  if (out.baseline.tabmax !== null) q(`update dbo._tabmaxkey set tabmaxkey=${Number(out.baseline.tabmax)} where tabname='IssueCategory'`);
  q(`delete from dbo.audit_log where audit_id > ${out.baseline.auditMax}`);
  q(`select setval(pg_get_serial_sequence('dbo.audit_log','audit_id'), ${out.baseline.auditMax}, true)`);
  out.final = {
    cats: Number(rows('select count(*) from dbo.issuecategory')[0][0]),
    accounts: Number(rows('select count(*) from dbo.issuecategoryaccounts')[0][0]),
    tabmax: rows("select tabmaxkey from dbo._tabmaxkey where tabname='IssueCategory'")[0]?.[0] ?? null,
    audit: Number(rows('select count(*) from dbo.audit_log')[0][0]),
    auditMax: Number(rows('select max(audit_id) from dbo.audit_log')[0][0]),
    residue: rows(`select count(*) from dbo.issuecategory where name like 'PARITY ISSUE CAT%'`),
  };
  out.baselineOk = out.final.cats === out.baseline.cats && out.final.accounts === out.baseline.accounts
    && out.final.tabmax === out.baseline.tabmax && out.final.audit === out.baseline.audit
    && out.final.auditMax === out.baseline.auditMax && out.final.residue?.[0]?.[0] === '0';
  out.ok = !!out.addOk && !!out.editOk && out.baselineOk;
} catch (e) { out.fatal = String(e.stack || e).slice(0, 2000); }
finally {
  try {
    if (out.code) {
      q(`delete from dbo.issuecategoryaccounts where issuecategorycode=${Number(out.code)}`);
      q(`delete from dbo.issuecategory where issuecategorycode=${Number(out.code)}`);
    }
    if (out.baseline?.tabmax !== null) q(`update dbo._tabmaxkey set tabmaxkey=${Number(out.baseline.tabmax)} where tabname='IssueCategory'`);
    if (out.baseline?.auditMax) { q(`delete from dbo.audit_log where audit_id > ${out.baseline.auditMax}`); q(`select setval(pg_get_serial_sequence('dbo.audit_log','audit_id'), ${out.baseline.auditMax}, true)`); }
  } catch {}
  console.log(JSON.stringify(out, (k, v) => (typeof v === 'bigint' ? Number(v) : v), 1));
  await browser.close().catch(() => {});
}
