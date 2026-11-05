// Item Part masteripartcode / cascade branch.
//
// The original ue_save only enters the cascade branch when editing an existing
// part (ll_code not null) that is already the master of at least one other row
// (SELECT COUNT(IPartCode) ... WHERE MasterIPartCode = ll_code > 0), and the
// selected new master is itself top-level (wf_validate_masterpartno = 0).
// It then runs:
//   UPDATE ItemPart SET MasterIPartCode = :new WHERE MasterIPartCode = :code
// and RETURNS WITHOUT COMMIT.  w_multi_entry.close() calls wf_disconnect()
// (SQL stop), and u_transaction has autocommit=false + CommitOnDisconnect=No,
// so closing the form should roll the cascade update back.
//
// The probe creates two temporary Item Parts through the real form:
//   A = PARITY IPART PARENT (no master)
//   B = PARITY IPART CHILD  (masteripartcode = A)
// then reopens A, sets masteripartcode = 1 (DEFAULT, top-level), saves, and
// measures the message, the UPDATE statement, the uncommitted DB state, and
// the state after closing the form.  Everything is restored exactly.
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const require = createRequire(process.env.PLAYWRIGHT_MODULES || 'C:/Users/Admin/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/');
const { chromium } = require('playwright');
const PSQL = 'C:\\PostgreSQL\\17\\bin\\psql.exe';
const q = (sql) => execFileSync(PSQL, ['-U', 'postgres', '-h', '127.0.0.1', '-d', 'trader_write_test', '-t', '-A', '-F', '|', '-c', sql], { env: { ...process.env, PGPASSWORD: 'postgres' }, encoding: 'utf8', windowsHide: true }).trim();
const rows = (sql) => q(sql).split(/\r?\n/).filter(Boolean).map((l) => l.split('|'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SUF = String(Date.now()).slice(-6);
const PARENT = 'PARITY IPART PARENT ' + SUF;
const CHILD = 'PARITY IPART CHILD ' + SUF;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const out = { parent: PARENT, child: CHILD, messages: [], errors: [], net: [] };
page.on('pageerror', (e) => out.errors.push(String(e.message || e).slice(0, 400)));
page.on('request', (r) => { if (r.url().includes('/api/exec')) out.net.push({ p: 'req', body: String(r.postData() || '') }) });
page.on('response', async (r) => { if (r.url().includes('/api/exec')) { let b = ''; try { b = await r.text() } catch {} out.net.push({ p: 'res', status: r.status(), body: String(b).slice(0, 400) }) } });
async function poll(seconds = 8) {
  for (let i = 0; i < seconds * 2; i++) {
    await sleep(500);
    const msgs = await page.evaluate(() => [...document.querySelectorAll('.msgbox .txt')].map((e) => e.textContent.replace(/\s+/g, ' ').trim().slice(0, 300)));
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
  await poll(12);
  return page.evaluate((k) => window[k] ?? null, key);
}
async function latestCode(name) {
  return rows(`select ipartcode from dbo.itempart where name='${String(name).replace(/'/g, "''")}'`)[0]?.[0] ?? null;
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
    return {
      masterRows: m?.model?.rowCount?.() ?? null,
      masterCode: m?.model ? String(m.model.buf.primary[0]?.v?.[m.model.colIndex('code')] ?? '') : null,
      masterMaster: m?.model ? m.model.buf.primary[0]?.v?.[m.model.colIndex('masteripartcode')] : null,
      oldMaster: m?.model ? m.model.buf.primary[0]?.v?.[m.model.colIndex('oldmasteripartcode')] : null,
      masterStatus: m?.model ? m.model.getStatus(1, 0) : null,
      detailRows: d?.model?.rowCount?.() ?? null,
      details: d?.model?.buf?.primary?.map((x) => x.v) ?? null,
      detailStatuses: d?.model?.buf?.primary?.map((_, i) => d.model.getStatus(i + 1, 0)) ?? null,
      detailErr: window.__detailErr ?? null,
    };
  });
  await sleep(600); await poll(1);
  return out.reopen;
}
const all = () => rows("select ipartcode,name,masteripartcode from dbo.itempart order by ipartcode");
const killIdle = () => {
  try { q("select count(pg_terminate_backend(pid)) from pg_stat_activity where datname='trader_write_test' and xact_start is not null and pid<>pg_backend_pid()"); } catch {}
};
const xactCount = () => Number(rows("select count(*) from pg_stat_activity where datname='trader_write_test' and xact_start is not null and pid<>pg_backend_pid()")[0]?.[0] ?? 0);
const sessionDump = () => rows("select pid::text,state,coalesce(left(query,100),'') from pg_stat_activity where datname='trader_write_test' and xact_start is not null and pid<>pg_backend_pid() order by pid");
const restore = () => {
  try {
    killIdle();
    q(`delete from dbo.itempartinmodel where ipartcode in (select ipartcode from dbo.itempart where name like 'PARITY IPART %')`);
    q(`delete from dbo.itempart where name like 'PARITY IPART %'`);
    q("delete from dbo.model where modelcode=1 and name='PARITY TEMP MODEL 1'");
    if (out.baseline?.tab !== null) q(`update dbo._tabmaxkey set tabmaxkey=${Number(out.baseline.tab)} where tabname='ItemPart'`);
    if (out.baseline?.modelTab !== null) q(`update dbo._tabmaxkey set tabmaxkey=${Number(out.baseline.modelTab)} where tabname='Model'`);
    if (out.baseline?.auditMax) { q(`delete from dbo.audit_log where audit_id > ${out.baseline.auditMax}`); q(`select setval(pg_get_serial_sequence('dbo.audit_log','audit_id'), ${out.baseline.auditMax}, true)`); }
  } catch (e) { out.restoreError = String(e.message || e).slice(0, 500); }
};
try {
  out.baseline = {
    parts: all(),
    pim: Number(rows('select count(*) from dbo.itempartinmodel')[0][0]),
    model: Number(rows('select count(*) from dbo.model')[0][0]),
    tab: rows("select tabmaxkey from dbo._tabmaxkey where tabname='ItemPart'")[0]?.[0] ?? null,
    modelTab: rows("select tabmaxkey from dbo._tabmaxkey where tabname='Model'")[0]?.[0] ?? null,
    audit: Number(rows('select count(*) from dbo.audit_log')[0][0]),
    auditMax: Number(rows('select max(audit_id) from dbo.audit_log')[0][0]),
  };
  q("insert into dbo.model (modelcode,name,description) values (1,'PARITY TEMP MODEL 1','TEMP') on conflict (modelcode) do nothing");
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
  await sleep(1500); await poll(2);

  const add = async (name, masteripartcode) => {
    await page.evaluate(async () => { const rt = window.rt; const w = rt.windowInstances.get('w_item_part_form'); await w.pbCall('ue_newform', [], rt).catch(() => {}) });
    await sleep(900); await poll(1);
    out['fill_' + name.slice(-6)] = await page.evaluate(async ({ name, masteripartcode }) => {
      const rt = window.rt; const w = rt.windowInstances.get('w_item_part_form');
      const m = w.props.get('id_master'); const d = w.props.get('id_detail');
      if (!m?.model || !d?.model) return { error: 'missing master/detail' };
      if (m.model.rowCount() === 0) await m.pbCall('insertrow', [0], rt);
      for (const [n, v] of Object.entries({ name, description: 'PARITY CASCADE DESCRIPTION', application: 'PARITY APPLICATION', remarks: 'PARITY CASCADE REMARKS', icatcode: 1, iccode: 1, manfcode: 1, gcode: 1, purprice: 0, saleprice: 0, reorderlevel: 0, minlevel: 0, maxlevel: 0, qtyused: 0, masteripartcode })) await m.pbCall('setitem', [1, n, v], rt).catch(() => {});
      if (d.model.rowCount() === 0) await d.pbCall('insertrow', [0], rt);
      await d.pbCall('setitem', [1, 'modelcode', 1], rt).catch(() => {});
      w.props.set('ib_itemvalidated', true); w.props.set('il_currrow', 1);
      await m.pbCall('accepttext', [], rt).catch(() => {}); await d.pbCall('accepttext', [], rt).catch(() => {});
      return { master: m.model.buf.primary[0]?.v, detail: d.model.buf.primary[0]?.v };
    }, { name, masteripartcode });
    const key = '__save_' + name.slice(-6);
    out['save_' + name.slice(-6)] = await startSave(key);
  };

  await add(PARENT, null);
  out.parentCode = await latestCode(PARENT);
  out.parentRow = rows(`select ipartcode,name,masteripartcode from dbo.itempart where ipartcode=${Number(out.parentCode ?? 0)}`);
  await add(CHILD, Number(out.parentCode));
  out.childCode = await latestCode(CHILD);
  out.childRow = rows(`select ipartcode,name,masteripartcode from dbo.itempart where ipartcode=${Number(out.childCode ?? 0)}`);
  out.addOk = !!out.parentCode && !!out.childCode && out.parentRow?.[0]?.[2] === '' && out.childRow?.[0]?.[2] === String(out.parentCode);

  // reopen the parent and trigger the cascade
  out.reopenParent = await reopen(out.parentCode);
  const netStart = out.net.length;
  out.cascadeFill = await page.evaluate(async () => {
    const rt = window.rt; const w = rt.windowInstances.get('w_item_part_form');
    const m = w.props.get('id_master');
    await m.pbCall('setitem', [1, 'masteripartcode', 1], rt).catch(() => {});
    await m.pbCall('setitem', [1, 'masterpartname', 'DEFAULT'], rt).catch(() => {});
    w.props.set('ib_itemvalidated', true);
    await m.pbCall('accepttext', [], rt).catch(() => {});
    return { master: m.model.buf.primary[0]?.v, old: m.model.buf.primary[0]?.v?.[m.model.colIndex('oldmasteripartcode')] };
  });
  const msgStart = out.messages.length;
  out.cascadeSave = await startSave('__saveCascade');
  out.cascadeMessages = out.messages.slice(msgStart);
  // pair request/response events from the cascade save
  const ev = out.net.slice(netStart);
  out.cascadeTrace = [];
  for (let i = 0; i < ev.length; i++) {
    if (ev[i].p !== 'req') continue;
    let o = null; try { o = JSON.parse(ev[i].body); } catch {}
    let res = null;
    for (let j = i + 1; j < Math.min(i + 4, ev.length); j++) if (ev[j].p === 'res') { res = ev[j]; break; }
    out.cascadeTrace.push({ sql: o ? String(o.sql).slice(0, 220) : String(ev[i].body).slice(0, 160), params: o?.params ?? null, status: res?.status ?? null, body: res?.body?.slice(0, 240) ?? null });
  }
  out.cascadeUpdate = out.cascadeTrace.find((t) => /UPDATE dbo\.itempart SET masteripartcode/i.test(t.sql));
  out.cascadeMessageSeen = out.cascadeMessages.some((m) => /Cascading Update Now/i.test(m));
  out.inMemoryAfterSave = await page.evaluate(() => {
    const rt = window.rt; const w = rt.windowInstances.get('w_item_part_form');
    const m = w.props.get('id_master');
    return { master: m.model.buf.primary[0]?.v, status: m.model.getStatus(1, 0) };
  });
  out.dbBeforeClose = all().filter((r) => Number(r[0]) === Number(out.parentCode) || Number(r[0]) === Number(out.childCode));
  out.xactBeforeClose = xactCount();

  // The original close path is w_multi_entry.close -> wf_disconnect ->
  // "SQL stop USING this.it_transobject" (autocommit=false and
  // CommitOnDisconnect=No in u_transaction), so the cascade update must roll
  // back.  Invoke that exact operation; the sheet instance itself may stay in
  // the runtime's window map, which is a harness/UI lifecycle detail.
  out.disconnect = await page.evaluate(async () => {
    const rt = window.rt; const w = rt.windowInstances.get('w_item_part_form');
    if (!w) return { ok: false, reason: 'form missing' };
    w.props.set('editflag', false);
    try { await w.pbCall('wf_disconnect', [], rt); return { ok: true, visible: w.props.get('visible') }; }
    catch (e) { return { ok: false, err: String(e.message || e).slice(0, 300) }; }
  });
  await sleep(2500); await poll(2);
  out.formPresentAfterDisconnect = await page.evaluate(() => !!window.rt.windowInstances.get('w_item_part_form'));
  out.xactAfterDisconnect = xactCount();
  out.sessionsAfterDisconnect = sessionDump();
  out.dbAfterDisconnect = all().filter((r) => Number(r[0]) === Number(out.parentCode) || Number(r[0]) === Number(out.childCode));
  // terminate any remaining app sessions so the uncommitted cascade update
  // cannot linger, then re-read the committed child row
  q("select count(pg_terminate_backend(pid)) from pg_stat_activity where datname='trader_write_test' and xact_start is not null and pid<>pg_backend_pid()");
  await sleep(2000);
  out.xactAfterTerminate = xactCount();
  out.dbAfterTerminate = all().filter((r) => Number(r[0]) === Number(out.parentCode) || Number(r[0]) === Number(out.childCode));
  out.cascadeRolledBack = out.dbAfterTerminate.some((r) => Number(r[0]) === Number(out.childCode) && String(r[2]) === String(out.parentCode))
    && out.dbAfterTerminate.some((r) => Number(r[0]) === Number(out.parentCode) && String(r[2]) === '');
  out.cascadeCommitted = out.dbAfterTerminate.some((r) => Number(r[0]) === Number(out.childCode) && String(r[2]) === '1');

  restore();
  await browser.close().catch(() => {});
  out.browserClosed = true;
  await sleep(1500);
  killIdle();
  await sleep(1000);
  out.final = {
    parts: all(),
    pim: Number(rows('select count(*) from dbo.itempartinmodel')[0][0]),
    model: Number(rows('select count(*) from dbo.model')[0][0]),
    tab: rows("select tabmaxkey from dbo._tabmaxkey where tabname='ItemPart'")[0]?.[0] ?? null,
    modelTab: rows("select tabmaxkey from dbo._tabmaxkey where tabname='Model'")[0]?.[0] ?? null,
    audit: Number(rows('select count(*) from dbo.audit_log')[0][0]),
    auditMax: Number(rows('select max(audit_id) from dbo.audit_log')[0][0]),
    residue: rows(`select count(*) from dbo.itempart where name like 'PARITY IPART %'`),
    xact: xactCount(),
  };
  out.baselineOk = JSON.stringify(out.final.parts) === JSON.stringify(out.baseline.parts)
    && out.final.pim === out.baseline.pim && out.final.model === out.baseline.model
    && out.final.tab === out.baseline.tab && out.final.modelTab === out.baseline.modelTab
    && out.final.audit === out.baseline.audit && out.final.auditMax === out.baseline.auditMax
    && out.final.residue?.[0]?.[0] === '0' && out.final.xact === 0;
  out.ok = !!out.addOk && !!out.cascadeMessageSeen && !!out.cascadeUpdate
    && out.disconnect?.ok !== false && !!out.cascadeRolledBack && out.baselineOk;
} catch (e) { out.fatal = String(e.stack || e).slice(0, 2400); }
finally {
  restore();
  console.log(JSON.stringify(out, (k, v) => (typeof v === 'bigint' ? Number(v) : v), 1));
  await browser.close().catch(() => {});
}
