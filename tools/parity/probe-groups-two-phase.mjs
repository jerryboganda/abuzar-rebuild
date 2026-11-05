// Groups new-group two-phase save, exactly as the recovered script behaves:
//   1st OK: id_group.update + 8 godown + 8 header rows, returns WITHOUT commit,
//           form stays open, id_rights points at the hidden DataWindow.
//   2nd OK: lb_modify = true -> delete rights, rebuild hidden, update rights,
//           SQL commit, messagebox, close.
// Then an edit cycle (check 5 rights) must commit 5 grouprights rows.
// Cleanup restores every touched table and the audit sequence exactly.
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const require = createRequire(process.env.PLAYWRIGHT_MODULES || 'C:/Users/Admin/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/');
const { chromium } = require('playwright');
const PSQL = 'C:\\PostgreSQL\\17\\bin\\psql.exe';
const q = (sql) => execFileSync(PSQL, ['-U', 'postgres', '-h', '127.0.0.1', '-d', 'trader_write_test', '-t', '-A', '-F', '|', '-c', sql], { env: { ...process.env, PGPASSWORD: 'postgres' }, encoding: 'utf8', windowsHide: true }).trim();
const rows = (sql) => q(sql).split(/\r?\n/).filter(Boolean).map((l) => l.split('|'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const NAME = 'PARITY GROUP ' + String(Date.now()).slice(-6);
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
      await page.evaluate(() => { for (const b of document.querySelectorAll('.msgbox')) { const bs = [...b.querySelectorAll('.btns button')]; (bs.find((x) => /^(ok|yes)$/i.test(x.textContent.trim())) || bs[0])?.click(); } });
      await sleep(250);
    }
  }
}
const clickOk = () => page.evaluate(async () => {
  const rt = window.rt; const w = rt.windowInstances.get('w_groups_form');
  const cb = w.children.get('cb_ok');
  window.__okDone = false;
  void rt.fire(cb, 'clicked').then(() => { window.__okDone = 'ok' }).catch((e) => { window.__okDone = 'ERR ' + String(e.message || e).slice(0, 300) });
});
try {
  out.baseline = {
    groups: Number(rows('select count(*) from dbo.groups')[0][0]),
    godown: Number(rows('select count(*) from dbo.groupallowedgodown')[0][0]),
    header: Number(rows('select count(*) from dbo.groupallowedheader')[0][0]),
    rights: Number(rows('select count(*) from dbo.grouprights')[0][0]),
    price: Number(rows('select count(*) from dbo.groupallowedprice')[0][0]),
    cash: Number(rows('select count(*) from dbo.groupcashaccount')[0][0]),
    tabmax: rows("select tabmaxkey from dbo._tabmaxkey where tabname='Groups'")[0]?.[0] ?? null,
    audit: Number(rows('select count(*) from dbo.audit_log')[0][0]),
    auditMax: Number(rows('select max(audit_id) from dbo.audit_log')[0][0]),
  };
  await page.goto('http://127.0.0.1:5177/?app=1&autologin=ADMIN:password9080', { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.rt && window.rt.windowInstances.get('w_main') && typeof window.__menu === 'function', null, { timeout: 90000, polling: 300 });
  await page.evaluate(() => { void window.__menu('Manage | Groups') });
  await page.waitForFunction(() => window.rt.windowInstances.get('w_groups'), null, { timeout: 40000, polling: 300 });
  await sleep(1600); await poll(2);
  await page.evaluate(async () => {
    const rt = window.rt; const w = rt.windowInstances.get('w_groups');
    void w.pbCall('wf_openmywindow', [0], rt).catch(() => {});
  });
  await page.waitForFunction(() => window.rt.windowInstances.get('w_groups_form'), null, { timeout: 30000, polling: 300 });
  await sleep(1800); await poll(2);
  out.fill = await page.evaluate(async ({ name }) => {
    const rt = window.rt; const w = rt.windowInstances.get('w_groups_form');
    const g = w.props.get('id_group'); const rights = w.props.get('id_rights');
    if (!g?.model) return { error: 'no id_group' };
    if (g.model.rowCount() === 0) await g.pbCall('insertrow', [0], rt);
    await g.pbCall('setitem', [1, 'groupname', name], rt).catch(() => {});
    await g.pbCall('setitem', [1, 'remarks', 'PARITY GROUPS TEST'], rt).catch(() => {});
    await g.pbCall('accepttext', [], rt).catch(() => {});
    // check the first 3 visible rights, like a user would before the first OK
    for (let i = 1; i <= 3; i++) await rights.pbCall('setitem', [i, 'checked', 'Y'], rt).catch(() => {});
    await rights.pbCall('accepttext', [], rt).catch(() => {});
    return { rows: g.model.rowCount(), checked: rights.model.buf.primary.slice(0, 4).map((r) => String(r.v[rights.model.colIndex('checked')] ?? '')) };
  }, { name: NAME });
  await clickOk();
  await sleep(3000); await poll(4);
  out.afterFirstOk = await page.evaluate(() => {
    const rt = window.rt; const w = rt.windowInstances.get('w_groups_form');
    if (!w) return { form: false };
    const hid = w.props.get('id_rights_hidden'); const cur = w.props.get('id_rights');
    return {
      form: true,
      idRightsIsHidden: cur === hid,
      hidRows: hid?.model?.rowCount?.() ?? null,
      hidFirst: hid?.model?.buf?.primary?.[0]?.v ?? null,
      saveDone: window.__okDone,
    };
  });
  out.visibleAfterFirst = {
    group: rows(`select groupcode,groupname from dbo.groups where groupname='${NAME}'`),
    godown: rows(`select count(*) from dbo.groupallowedgodown where groupcode=13`),
    header: rows(`select count(*) from dbo.groupallowedheader where groupcode=13`),
    tabmax: rows("select tabmaxkey from dbo._tabmaxkey where tabname='Groups'"),
  };
  // second OK: expected lb_modify path, commit, close
  await clickOk();
  await sleep(4000); await poll(6);
  out.afterSecondOk = {
    formOpen: await page.evaluate(() => !!window.rt.windowInstances.get('w_groups_form')),
    okDone: await page.evaluate(() => window.__okDone ?? null),
    group: rows(`select groupcode,groupname,remarks from dbo.groups where groupname='${NAME}'`),
    godown: rows(`select count(*) from dbo.groupallowedgodown where groupcode in (select groupcode from dbo.groups where groupname='${NAME}')`),
    header: rows(`select count(*) from dbo.groupallowedheader where groupcode in (select groupcode from dbo.groups where groupname='${NAME}')`),
    rights: rows(`select count(*) from dbo.grouprights where groupcode in (select groupcode from dbo.groups where groupname='${NAME}')`),
    tabmax: rows("select tabmaxkey from dbo._tabmaxkey where tabname='Groups'"),
  };
  out.code = out.afterSecondOk.group?.[0]?.[0] ?? null;
  out.addOk = !!out.code && out.afterSecondOk.group?.[0]?.[1] === NAME
    && out.afterSecondOk.godown?.[0]?.[0] === '8' && out.afterSecondOk.header?.[0]?.[0] === '8'
    && out.afterSecondOk.tabmax?.[0]?.[0] === String(Number(out.code))
    && out.afterSecondOk.formOpen === false;
  // edit: open by code, check 5 rights, one OK (lb_modify path)
  if (out.code) {
    await page.evaluate(async (code) => {
      const rt = window.rt; const w = rt.windowInstances.get('w_groups');
      void w.pbCall('wf_openmywindow', [code], rt).catch(() => {});
    }, Number(out.code));
    await page.waitForFunction(() => window.rt.windowInstances.get('w_groups_form'), null, { timeout: 30000, polling: 300 });
    await sleep(1600); await poll(2);
    out.editFill = await page.evaluate(async ({ name2 }) => {
      const rt = window.rt; const w = rt.windowInstances.get('w_groups_form');
      const g = w.props.get('id_group'); const rights = w.props.get('id_rights');
      await g.pbCall('setitem', [1, 'groupname', name2], rt).catch(() => {});
      await g.pbCall('setitem', [1, 'remarks', 'PARITY GROUPS TEST EDITED'], rt).catch(() => {});
      await g.pbCall('accepttext', [], rt).catch(() => {});
      for (let i = 1; i <= 5; i++) await rights.pbCall('setitem', [i, 'checked', 'Y'], rt).catch(() => {});
      await rights.pbCall('accepttext', [], rt).catch(() => {});
      return { rows: g.model.rowCount(), checked: rights.model.buf.primary.slice(0, 6).map((r) => String(r.v[rights.model.colIndex('checked')] ?? '')) };
    }, { name2: NAME2 });
    await clickOk();
    await sleep(4000); await poll(6);
    out.afterEdit = {
      formOpen: await page.evaluate(() => !!window.rt.windowInstances.get('w_groups_form')),
      group: rows(`select groupcode,groupname,remarks from dbo.groups where groupcode=${Number(out.code)}`),
      rights: rows(`select count(*) from dbo.grouprights where groupcode=${Number(out.code)}`),
    };
    out.editOk = out.afterEdit.group?.[0]?.[1] === NAME2 && out.afterEdit.rights?.[0]?.[0] === '5' && out.afterEdit.formOpen === false;
  }
  // delete attempt: File | Delete disabled in the original
  out.delete = await page.evaluate(() => {
    const rt = window.rt; const w = rt.windowInstances.get('w_groups');
    const menu = w.props.get('menuid') || w.props.get('im_menu');
    let del = null;
    const walk = (o) => { for (const c of o.children.values()) { if (c.name === 'm_delete') del = c; walk(c) } };
    if (menu) walk(menu);
    return del ? { found: true, enabled: del.props.get('enabled') !== false } : { found: false };
  });
  // exact cleanup
  if (out.code) {
    q(`delete from dbo.grouprights where groupcode=${Number(out.code)}`);
    q(`delete from dbo.groupallowedgodown where groupcode=${Number(out.code)}`);
    q(`delete from dbo.groupallowedheader where groupcode=${Number(out.code)}`);
    q(`delete from dbo.groups where groupcode=${Number(out.code)}`);
  }
  if (out.baseline.tabmax !== null) q(`update dbo._tabmaxkey set tabmaxkey=${Number(out.baseline.tabmax)} where tabname='Groups'`);
  q(`delete from dbo.audit_log where audit_id > ${out.baseline.auditMax}`);
  q(`select setval(pg_get_serial_sequence('dbo.audit_log','audit_id'), ${out.baseline.auditMax}, true)`);
  out.final = {
    groups: Number(rows('select count(*) from dbo.groups')[0][0]),
    godown: Number(rows('select count(*) from dbo.groupallowedgodown')[0][0]),
    header: Number(rows('select count(*) from dbo.groupallowedheader')[0][0]),
    rights: Number(rows('select count(*) from dbo.grouprights')[0][0]),
    price: Number(rows('select count(*) from dbo.groupallowedprice')[0][0]),
    cash: Number(rows('select count(*) from dbo.groupcashaccount')[0][0]),
    tabmax: rows("select tabmaxkey from dbo._tabmaxkey where tabname='Groups'")[0]?.[0] ?? null,
    audit: Number(rows('select count(*) from dbo.audit_log')[0][0]),
    auditMax: Number(rows('select max(audit_id) from dbo.audit_log')[0][0]),
    residue: rows(`select count(*) from dbo.groups where groupname like 'PARITY GROUP %'`),
  };
  out.baselineOk = out.final.groups === out.baseline.groups && out.final.godown === out.baseline.godown && out.final.header === out.baseline.header && out.final.rights === out.baseline.rights && out.final.price === out.baseline.price && out.final.cash === out.baseline.cash && out.final.tabmax === out.baseline.tabmax && out.final.audit === out.baseline.audit && out.final.auditMax === out.baseline.auditMax && out.final.residue?.[0]?.[0] === '0';
  out.ok = !!out.addOk && !!out.editOk && out.baselineOk;
} catch (e) { out.fatal = String(e.stack || e).slice(0, 2000); }
finally {
  try {
    if (out.code) {
      q(`delete from dbo.grouprights where groupcode=${Number(out.code)}`);
      q(`delete from dbo.groupallowedgodown where groupcode=${Number(out.code)}`);
      q(`delete from dbo.groupallowedheader where groupcode=${Number(out.code)}`);
      q(`delete from dbo.groups where groupcode=${Number(out.code)}`);
    }
    if (out.baseline?.tabmax !== null) q(`update dbo._tabmaxkey set tabmaxkey=${Number(out.baseline.tabmax)} where tabname='Groups'`);
    if (out.baseline?.auditMax) { q(`delete from dbo.audit_log where audit_id > ${out.baseline.auditMax}`); q(`select setval(pg_get_serial_sequence('dbo.audit_log','audit_id'), ${out.baseline.auditMax}, true)`); }
  } catch {}
  console.log(JSON.stringify(out, (k, v) => (typeof v === 'bigint' ? Number(v) : v), 1));
  await browser.close().catch(() => {});
}
