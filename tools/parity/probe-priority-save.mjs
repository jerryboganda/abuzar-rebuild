// Priority Setting (Maintenance | Priority Setting) field edit/save cycle.
// Selects item 9801, edits its batch priority 10 -> 11, saves through the
// window's ue_save (File | Save), verifies dbo.godowndetail.priority, then
// restores the full row (priority/manfdate/lastupdated) with triggers off.
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const require = createRequire(process.env.PLAYWRIGHT_MODULES || 'C:/Users/Admin/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/');
const { chromium } = require('playwright');
const PSQL = 'C:\\PostgreSQL\\17\\bin\\psql.exe';
const q = (sql) => execFileSync(PSQL, ['-U', 'postgres', '-h', '127.0.0.1', '-d', 'trader_write_test', '-t', '-A', '-F', '|', '-c', sql], { env: { ...process.env, PGPASSWORD: 'postgres' }, encoding: 'utf8', windowsHide: true }).trim();
const rows = (sql) => q(sql).split(/\r?\n/).filter(Boolean).map((l) => l.split('|'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const out = { messages: [], errors: [], net: [] };
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
const restore = () => {
  try {
    const b = out.baseline.row?.[0];
    if (!b) return;
    const [gcode, icode, batch, expiry, priority, manfdate, lastupdated, currqty] = b;
    q(`begin; set local session_replication_role = replica; update dbo.godowndetail set priority=${Number(priority)}, manfdate=${manfdate === '' ? 'null' : `'${manfdate}'::timestamp`}, lastupdated='${lastupdated}'::timestamp, currqty=${currqty}, batch='${String(batch).replace(/'/g, "''")}', expiry='${expiry}'::timestamp where icode=${Number(icode)} and gcode=${Number(gcode)} and batch='${String(batch).replace(/'/g, "''")}' and expiry='${expiry}'::timestamp; commit;`);
    if (out.baseline.auditMax) {
      q(`delete from dbo.audit_log where audit_id > ${out.baseline.auditMax}`);
      q(`select setval(pg_get_serial_sequence('dbo.audit_log','audit_id'), ${out.baseline.auditMax}, true)`);
    }
  } catch (e) { out.restoreError = String(e.message || e).slice(0, 500); }
};
try {
  out.baseline = {
    row: rows("select gcode,icode,batch,expiry::text,priority,manfdate::text,lastupdated::text,currqty::text from dbo.godowndetail where icode=9801 order by gcode,batch,expiry"),
    audit: Number(rows('select count(*) from dbo.audit_log')[0][0]),
    auditMax: Number(rows('select max(audit_id) from dbo.audit_log')[0][0]),
    utn: rows('select utn from dbo._utn')[0]?.[0] ?? null,
  };
  await page.goto('http://127.0.0.1:5177/?app=1&autologin=ADMIN:password9080', { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.rt && window.rt.windowInstances.get('w_main') && typeof window.__menu === 'function', null, { timeout: 90000, polling: 300 });
  await page.evaluate(() => { void window.__menu('Maintenance | Priority Setting') });
  await page.waitForFunction(() => window.rt.windowInstances.get('w_itempriority_form'), null, { timeout: 40000, polling: 300 });
  await sleep(1800); await poll(3);
  out.open = await page.evaluate(() => {
    const rt = window.rt; const w = rt.windowInstances.get('w_itempriority_form');
    const l = w.props.get('id_list'); const d = w.props.get('id_detail');
    return { title: String(w.props.get('title') ?? ''), listRows: l?.model?.rowCount?.() ?? null, detailRows: d?.model?.rowCount?.() ?? null, detailCols: d?.model?.colNames ?? null };
  });
  // select the 9801 row and run the real ue_detail handler; fall back to
  // direct retrieves if the list-row lookup cannot be resolved.
  out.select = await page.evaluate(async () => {
    const rt = window.rt; const w = rt.windowInstances.get('w_itempriority_form');
    const l = w.props.get('id_list');
    let idx = 0;
    if (l?.model) {
      const ci = l.model.colIndex('code');
      for (let i = 0; i < l.model.buf.primary.length; i++) {
        if (Number(l.model.buf.primary[i].v[ci]) === 9801) { idx = i + 1; break; }
      }
    }
    w.props.set('il_selectedrow', idx);
    let via = 'ue_detail';
    try { await w.pbCall('ue_detail', [], rt) } catch (e) { via = 'ue_detail-err:' + String(e.message || e).slice(0, 120) }
    return { idx, via };
  });
  await sleep(1800); await poll(3);
  out.detail = await page.evaluate(() => {
    const rt = window.rt; const w = rt.windowInstances.get('w_itempriority_form');
    const d = w.props.get('id_detail');
    return { rows: d?.model?.rowCount?.() ?? null, cols: d?.model?.colNames ?? null, first: d?.model?.buf?.primary?.slice(0, 3).map((r) => r.v) ?? null };
  });
  // if ue_detail did not populate, retrieve the detail directly (same DW + SQL)
  if (!out.detail.rows) {
    out.fallback = await page.evaluate(async () => {
      const rt = window.rt; const w = rt.windowInstances.get('w_itempriority_form');
      const d = w.props.get('id_detail');
      const n = await d.pbCall('retrieve', [9801, 2], rt).catch((e) => 'ERR ' + String(e.message || e).slice(0, 120));
      return { n, rows: d?.model?.rowCount?.() ?? null };
    });
  }
  out.edit = await page.evaluate(async () => {
    const rt = window.rt; const w = rt.windowInstances.get('w_itempriority_form');
    const d = w.props.get('id_detail');
    if (!d?.model) return { error: 'no detail' };
    const ci = (n) => d.model.colIndex(n);
    let row = 0;
    for (let i = 0; i < d.model.buf.primary.length; i++) {
      const v = d.model.buf.primary[i].v;
      if (Number(v[ci('gcode')]) === 1 && Number(v[ci('icode')]) === 9801) { row = i + 1; break; }
    }
    if (!row) return { error: 'item 9801 not in detail' };
    const before = Number(d.model.buf.primary[row - 1].v[ci('priority')]);
    await d.pbCall('setitem', [row, 'priority', 11], rt).catch(() => {});
    await d.pbCall('accepttext', [], rt).catch(() => {});
    window.__saveDone = false;
    void w.pbCall('ue_save', [], rt).then(() => { window.__saveDone = 'ok' }).catch((e) => { window.__saveDone = 'ERR ' + String(e.message || e).slice(0, 300) });
    return { row, before, after: Number(d.model.buf.primary[row - 1].v[ci('priority')]) };
  });
  await poll(10);
  out.after = {
    saveDone: await page.evaluate(() => window.__saveDone ?? null),
    row: rows("select gcode,icode,batch,expiry::text,priority,manfdate::text,lastupdated::text,currqty::text from dbo.godowndetail where icode=9801 order by gcode,batch,expiry"),
    audit: Number(rows('select count(*) from dbo.audit_log')[0][0]),
    auditMax: Number(rows('select max(audit_id) from dbo.audit_log')[0][0]),
    utn: rows('select utn from dbo._utn')[0]?.[0] ?? null,
  };
  out.editOk = out.after.row?.[0]?.[4] === '11' && out.messages.some((m) => /Changes take effect in database/i.test(m));
  restore();
  out.final = {
    row: rows("select gcode,icode,batch,expiry::text,priority,manfdate::text,lastupdated::text,currqty::text from dbo.godowndetail where icode=9801 order by gcode,batch,expiry"),
    audit: Number(rows('select count(*) from dbo.audit_log')[0][0]),
    auditMax: Number(rows('select max(audit_id) from dbo.audit_log')[0][0]),
    utn: rows('select utn from dbo._utn')[0]?.[0] ?? null,
  };
  out.baselineOk = JSON.stringify(out.final.row) === JSON.stringify(out.baseline.row)
    && out.final.audit === out.baseline.audit && out.final.auditMax === out.baseline.auditMax
    && out.final.utn === out.baseline.utn;
  out.ok = !!out.editOk && out.baselineOk;
} catch (e) { out.fatal = String(e.stack || e).slice(0, 2000); }
finally {
  restore();
  console.log(JSON.stringify(out, (k, v) => (typeof v === 'bigint' ? Number(v) : v), 1));
  await browser.close().catch(() => {});
}
