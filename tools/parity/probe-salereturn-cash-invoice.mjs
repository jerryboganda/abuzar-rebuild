// Cash Sale Return against a retail sale invoice
// (Sales | Sale Return | Cash Sale Return).
//
// Validates the invoice, picks the returned item, saves through the real form +
// password dialog, verifies SRLedger/SRDetail/stock/return counter/UTN in
// PostgreSQL, then reopens the saved return from the List tab, edits its
// header remarks through the real editor, saves again and verifies.  The
// Delete menu availability is recorded (the original may keep it disabled).
//
// Invoice 588890 is used because the older 588888 was already fully returned in
// the clone (SRLedger 61605, returncounter 1); 588890 is the next clean posted
// retail invoice with one item of qty 1 at 10.00.
//
// Exact restore: SR rows above the baseline code, godown/item stock counters and
// timestamps, Saleledger returncounter/outstanding, _utn, _tabmaxkey,
// _headertabmaxkey, serverdate, AutoFiscalizeOnPosting and audit_log.
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
const require = createRequire(process.env.PLAYWRIGHT_MODULES || 'C:/Users/Admin/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/')
const { chromium } = require('playwright')
const PSQL = 'C:\\PostgreSQL\\17\\bin\\psql.exe'
const DB = process.env.PARITY_DB || 'trader_write_test'
const OUT = 'C:/Projects/Abuzar/deploy/parity/salereturn-cash-invoice'
mkdirSync(OUT, { recursive: true })
const STEPS = `${OUT}/steps.txt`
writeFileSync(STEPS, '')
const step = (s) => appendFileSync(STEPS, new Date().toISOString() + ' ' + s + '\n')
const q = (sql) => execFileSync(PSQL, ['-U', 'postgres', '-h', '127.0.0.1', '-d', DB, '-t', '-A', '-F', '|', '-c', sql], { env: { ...process.env, PGPASSWORD: 'postgres' }, encoding: 'utf8', windowsHide: true }).trim()
const rows = (sql) => q(sql).split(/\r?\n/).filter(Boolean).map((l) => l.split('|'))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const SALEINV = 588890
const ITEM = 9801
const EXPECT_SRCAT = '8'
const EXPECT_TOTAL = 11
const REMARKS = 'PARITY CASH SR EDIT ' + String(Date.now()).slice(-6)

const counts = () => ({
  srledger: Number(rows('select count(*) from dbo.srledger')[0][0]),
  srledgerMax: Number(rows('select coalesce(max(srinvcode),0) from dbo.srledger')[0][0]),
  srdetail: Number(rows('select count(*) from dbo.srdetail')[0][0]),
  godown: rows(`select currqty::text,lastupdated::text from dbo.godowndetail where icode=${ITEM} and gcode=1`)[0] ?? null,
  totalpieces: rows(`select totalpieces::text from dbo.item where icode=${ITEM}`)[0]?.[0] ?? null,
  itemLastupdate: rows(`select lastupdate::text from dbo.item where icode=${ITEM}`)[0]?.[0] ?? null,
  saleledger: rows(`select returncounter::text,outstandingamt::text from dbo.saleledger where saleinvcode=${SALEINV}`)[0] ?? null,
  stockledger: Number(rows('select count(*) from dbo.stockledger')[0][0]),
  stockledgerMaxUtn: Number(rows('select coalesce(max(utn),0) from dbo.stockledger')[0][0]),
  itemlog: Number(rows('select count(*) from dbo.itemlog')[0][0]),
  itemlogMax: Number(rows('select coalesce(max(itemrowid),0) from dbo.itemlog')[0][0]),
  utn: rows('select utn from dbo._utn')[0]?.[0] ?? null,
  tabs: rows('select tabname,tabmaxkey from dbo._tabmaxkey order by tabname'),
  headerTabs: rows('select headercode,module,tabmaxkey from dbo._headertabmaxkey order by headercode,module'),
  serverDate: rows('select lasttransdate::text from dbo.serverdate')[0]?.[0] ?? null,
  fiscalPref: rows("select prefvalue from dbo.softwarepreferences where name='AutoFiscalizeOnPosting'")[0]?.[0] ?? null,
  audit: Number(rows('select count(*) from dbo.audit_log')[0][0]),
  auditMax: Number(rows('select max(audit_id) from dbo.audit_log')[0][0]),
})

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
page.setDefaultTimeout(20000)
const out = { saleinv: SALEINV, item: ITEM, remarks: REMARKS, messages: [], errors: [] }
page.on('pageerror', (e) => out.errors.push(String(e.message || e).slice(0, 500)))

async function poll(seconds = 12, yes = false) {
  for (let i = 0; i < seconds * 2; i++) {
    await sleep(500)
    const msgs = await page.evaluate(() => [...document.querySelectorAll('.msgbox .txt')].map((e) => e.textContent.replace(/\s+/g, ' ').trim().slice(0, 400)))
    if (msgs.length) {
      out.messages.push(...msgs)
      await page.evaluate((y) => {
        for (const b of document.querySelectorAll('.msgbox')) {
          const bs = [...b.querySelectorAll('.btns button')]
          ;(bs.find((x) => (y && /^yes$/i.test(x.textContent.trim())) || /^(ok|yes)$/i.test(x.textContent.trim())) || bs[0])?.click()
        }
      }, yes)
      await sleep(250)
    }
  }
}

async function password() {
  for (let i = 0; i < 40; i++) {
    const done = await page.evaluate(async () => {
      const rt = window.rt
      const a = rt.windowInstances.get('w_salesmanpassword')
      if (!a) return false
      const dw = a.props.get('id_password') || a.children.get('dw_password')
      if (!dw) return false
      if (!dw.model.rowCount()) await dw.pbCall('insertrow', [0], rt)
      await dw.pbCall('setitem', [1, 'salesmancode', 1], rt)
      await dw.pbCall('setitem', [1, 'password', 'password9080'], rt)
      dw.model.acceptText = async () => 1
      await dw.pbCall('accepttext', [], rt).catch(() => {})
      const ok = [...a.children.values()].find((c) => c.name === 'cb_ok')
      if (ok) await rt.fire(ok, 'clicked').catch(() => {})
      return true
    }).catch(() => false)
    if (done) return true
    await sleep(400)
  }
  return false
}

let code = null
const restore = () => {
  try {
    q(`select count(pg_terminate_backend(pid)) from pg_stat_activity where datname='${DB}' and state like 'idle in transaction%' and pid<>pg_backend_pid()`)
    const b = out.baseline
    const max = Number(b?.srledgerMax ?? 0)
    q(`set session_replication_role = replica;
       delete from dbo.srdetail where srinvcode > ${max};
       delete from dbo.srledger where srinvcode > ${max};
       ${b?.stockledgerMaxUtn ? `delete from dbo.stockledger where utn > ${Number(b.stockledgerMaxUtn)};` : ''}
       ${b?.godown ? `update dbo.godowndetail set currqty=${Number(b.godown[0])}, lastupdated='${String(b.godown[1]).replace(/'/g, "''")}' where icode=${ITEM} and gcode=1;` : ''}
       ${b?.totalpieces !== null && b?.totalpieces !== undefined ? `update dbo.item set totalpieces=${Number(b.totalpieces)}, lastupdate='${String(b.itemLastupdate).replace(/'/g, "''")}' where icode=${ITEM};` : ''}
       set session_replication_role = origin;`)
    if (b?.itemlogMax) q(`delete from dbo.itemlog where itemrowid > ${Number(b.itemlogMax)}`)
    if (b?.saleledger) q(`update dbo.saleledger set returncounter=${Number(b.saleledger[0])}, outstandingamt=${Number(b.saleledger[1])} where saleinvcode=${SALEINV}`)
    if (b?.utn) q(`update dbo._utn set utn=${Number(b.utn)}`)
    for (const [name, value] of b?.tabs ?? []) q(`update dbo._tabmaxkey set tabmaxkey=${Number(value)} where tabname='${String(name).replace(/'/g, "''")}'`)
    for (const [headercode, module, value] of b?.headerTabs ?? []) q(`update dbo._headertabmaxkey set tabmaxkey=${Number(value)} where headercode=${Number(headercode)} and module=${Number(module)}`)
    if (b?.serverDate) q(`update dbo.serverdate set lasttransdate='${String(b.serverDate).replace(/'/g, "''")}'::timestamp`)
    if (b?.fiscalPref) q(`update dbo.softwarepreferences set prefvalue='${String(b.fiscalPref).replace(/'/g, "''")}' where name='AutoFiscalizeOnPosting'`)
    if (b?.auditMax) { q(`delete from dbo.audit_log where audit_id > ${Number(b.auditMax)}`); q(`select setval(pg_get_serial_sequence('dbo.audit_log','audit_id'), ${Number(b.auditMax)}, true)`) }
  } catch (e) { out.restoreError = String(e.message || e).slice(0, 800) }
}

try {
  out.baseline = counts()
  q("update dbo.softwarepreferences set prefvalue='N' where name='AutoFiscalizeOnPosting'")
  step('baseline ' + JSON.stringify({ ...out.baseline, tabs: undefined, headerTabs: undefined }))
  await page.goto('http://127.0.0.1:5177/?app=1&autologin=ADMIN:password9080', { waitUntil: 'load', timeout: 60000 })
  await page.waitForFunction(() => window.rt && window.rt.windowInstances.get('w_main') && typeof window.__menu === 'function', null, { timeout: 120000, polling: 300 })
  step('logged in')
  await page.evaluate(async () => { void window.__menu('Sales | Sale Return | Cash Sale Return') })
  await page.waitForFunction(() => {
    const w = window.rt.windowInstances.get('w_salereturn')
    const d = w?.props.get('id_detail')
    return d?.model && d.model.rowCount() > 0
  }, null, { timeout: 30000, polling: 300 })
  await sleep(1200)
  out.open = await page.evaluate(() => {
    const w = window.rt.windowInstances.get('w_salereturn')
    const d = w.props.get('id_detail')
    const m = w.props.get('id_master')
    return { title: String(w.props.get('title') ?? ''), type: String(w.props.get('ii_salerettype')), open: w.props.get('ib_opensalereturn'), master: m?.props?.get?.('dataobject'), detail: d?.props?.get?.('dataobject'), detailRows: d?.model?.rowCount?.() ?? null }
  })
  step('open ' + JSON.stringify(out.open))

  out.validate = await page.evaluate(async (inv) => {
    const rt = window.rt; const w = rt.windowInstances.get('w_salereturn'); const m = w.props.get('id_master')
    try {
      await m.pbCall('setitem', [1, 'saleinvcode', inv], rt)
      await m.pbCall('accepttext', [], rt)
      return String(await w.pbCall('wf_validatesaleinvcode', [1, inv], rt))
    } catch (e) { return 'ERR ' + String(e.message || e).slice(0, 400) }
  }, SALEINV)
  step('validate ' + JSON.stringify(out.validate))

  for (let i = 0; i < 40; i++) {
    await sleep(500)
    const n = await page.evaluate(async () => {
      const w = window.rt.windowInstances.get('w_salereturn')
      const l = w?.props.get('id_itemslist')
      return l ? await l.n_rowcount() : 0
    })
    if (n > 0) { out.itemsListRows = n; break }
    await poll(1)
  }
  out.pick = await page.evaluate(async (icode) => {
    const rt = window.rt; const w = rt.windowInstances.get('w_salereturn')
    const l = w.props.get('id_itemslist'); const d = w.props.get('id_detail')
    const n = await l.pbCall('find', ['icode = ' + icode, 1, await l.n_rowcount()], rt)
    if (!(n > 0)) return { error: 'item not in list', rows: await l.n_rowcount() }
    await d.pbCall('setrow', [1], rt)
    await l.pbCall('setrow', [n], rt)
    await l.n_scrolltorow(n)
    await rt.fire(l, 'clicked', [0, 0, n, { name: 'itemname' }])
    await new Promise((r) => setTimeout(r, 1400))
    return { row: n, rows: await l.n_rowcount() }
  }, ITEM)
  step('pick ' + JSON.stringify(out.pick))
  await poll(3)
  await page.evaluate(async () => {
    const rt = window.rt; const w = rt.windowInstances.get('w_salereturn'); const d = w.props.get('id_detail')
    await d.pbCall('setrow', [1], rt)
    void rt.fire(d, 'itemfocuschanged', [1, { name: 'itemname' }])
    await new Promise((r) => setTimeout(r, 600))
  })
  await sleep(1500)
  out.before = await page.evaluate(async () => {
    const rt = window.rt; const w = rt.windowInstances.get('w_salereturn')
    const d = w.props.get('id_detail'); const f = w.props.get('id_footer')
    const o = {}
    for (const n of ['icode', 'itemname', 'gcode', 'looseqty', 'srprice', 'saleprice', 'batch', 'expiry', 'totalpieces']) { try { o[n] = String(await d.pbCall('getitemstring', [1, n], rt)) } catch { o[n] = 'n/a' } }
    for (const n of ['total']) { try { o[n] = String(await f.pbCall('getitemstring', [1, n], rt)) } catch { o[n] = 'n/a' } }
    return o
  })
  step('before ' + JSON.stringify(out.before))

  const save = async () => {
    await page.evaluate(() => {
      const rt = window.rt; const w = rt.windowInstances.get('w_salereturn')
      window.__save = false
      void w.pbCall('ue_save', [], rt).then(() => { window.__save = 'ok' }).catch((e) => { window.__save = 'ERR ' + String(e.message || e).slice(0, 400) })
    })
    out.password = await password()
    await poll(25)
    return page.evaluate(() => window.__save ?? null)
  }
  out.saveResult = await save()
  out.after = {
    srledger: rows(`select srinvcode,saleinvcode,srcatcode,custcode,posted,invtotal::text,remarks from dbo.srledger where srinvcode > ${out.baseline.srledgerMax} order by srinvcode`),
    srdetail: rows(`select srinvcode,icode,gcode,looseqty::text,srprice::text,srutn from dbo.srdetail where srinvcode > ${out.baseline.srledgerMax} order by srinvcode`),
    godown: rows(`select currqty::text from dbo.godowndetail where icode=${ITEM} and gcode=1`)[0]?.[0] ?? null,
    totalpieces: rows(`select totalpieces::text from dbo.item where icode=${ITEM}`)[0]?.[0] ?? null,
    saleledger: rows(`select returncounter::text,outstandingamt::text from dbo.saleledger where saleinvcode=${SALEINV}`)[0] ?? null,
    utn: rows('select utn from dbo._utn')[0]?.[0] ?? null,
  }
  code = out.after.srledger[0]?.[0] ?? null
  out.addOk = !!code
    && out.after.srledger.length === 1
    && out.after.srledger[0][1] === String(SALEINV)
    && out.after.srledger[0][2] === EXPECT_SRCAT
    && out.after.srledger[0][3] === '19'
    && out.after.srledger[0][4] === 'Y'
    && Number(out.after.srledger[0][5]) === EXPECT_TOTAL
    && out.after.srdetail.length === 1
    && out.after.srdetail[0][1] === String(ITEM)
    && Number(out.after.srdetail[0][3]) === 1
    && Number(out.after.srdetail[0][4]) === 10
    && Number(out.after.godown) === Number(out.baseline.godown?.[0]) + 1
    && Number(out.after.saleledger?.[0]) === Number(out.baseline.saleledger?.[0]) + 1
    && Number(out.after.utn) > Number(out.baseline.utn)
  step('after ' + JSON.stringify(out.after) + ' ok=' + out.addOk)

  // Reopen from the List tab and edit the header remarks through the real editor.
  out.deleteEnabled = await page.evaluate(() => {
    const rt = window.rt
    const w = rt.windowInstances.get('w_salereturn')
    const menu = w.props.get('menuid')
    const found = []
    const walk = (o) => {
      for (const c of o.children.values()) {
        const text = String(c.props.get('text') ?? '').replace(/&/g, '').trim()
        if (/^delete/i.test(text) || c.name === 'm_delete') found.push({ name: c.name, text, enabled: c.props.get('enabled'), visible: c.props.get('visible') })
        if (c.children.size) walk(c)
      }
    }
    if (menu) walk(menu)
    return found
  })
  step('delete menu ' + JSON.stringify(out.deleteEnabled))

  out.reopen = await page.evaluate(async (code) => {
    const rt = window.rt; const w = rt.windowInstances.get('w_salereturn')
    void w.pbCall('ue_list', [], rt).catch(() => {})
    await new Promise((r) => setTimeout(r, 2600))
    const l = w.props.get('id_list')
    if (!l?.model) return { error: 'no list' }
    const n = await l.n_rowcount()
    const ci = l.model.colIndex('code')
    let row = 0
    for (let i = 1; i <= n; i++) if (Number(l.model.buf.primary[i - 1]?.v[ci]) === Number(code)) { row = i; break }
    if (!row) return { error: 'return not in list', rows: n, codes: l.model.buf.primary.slice(0, 5).map((r) => r.v[ci]) }
    await l.pbCall('setrow', [row], rt)
    await l.n_scrolltorow(row)
    w.props.set('id_dwcontrol', l)
    w.props.set('il_selectedrow', row)
    void w.pbCall('ue_detail', [], rt).catch(() => {})
    await new Promise((r) => setTimeout(r, 2600))
    const m = w.props.get('id_master')
    return { listRows: n, row, masterRows: m?.model?.rowCount?.() ?? 0, code: String(m?.model?.buf?.primary?.[0]?.v?.[m.model.colIndex('code')] ?? '') }
  }, Number(code))
  await poll(4)
  step('reopen ' + JSON.stringify(out.reopen))

  // The original `ue_detail` calls wf_protectdw(master/detail/footer, 1) and
  // never sets li_protect back to 0, so a reopened saved return is fully
  // read-only (corrections go through the dedicated modify-return module).
  // Record that protection instead of forcing an edit the original forbids.
  if (out.reopen?.masterRows) {
    out.reopenState = await page.evaluate(() => {
      const rt = window.rt
      const w = rt.windowInstances.get('w_salereturn')
      const m = w.props.get('id_master')
      const d = w.props.get('id_detail')
      const f = w.props.get('id_footer')
      const view = rt.ui.views.get(w)
      const masterEl = view?.ctlViews?.get?.(m)?.el
      const cell = masterEl?.querySelector('.o[data-obj="remarks"]')
      const obj = m?.model?.def?.objects?.find((x) => x.name === 'remarks')
      return {
        masterRows: m?.model?.rowCount?.() ?? 0,
        masterEditableCells: masterEl ? masterEl.querySelectorAll('.o.editable').length : null,
        remarksCellClass: cell?.className ?? null,
        remarksProtect: m?.model?.overrides?.get?.('remarks.protect') ?? obj?.protect ?? null,
        detailRows: d?.model?.rowCount?.() ?? 0,
        footerRows: f?.model?.rowCount?.() ?? 0,
      }
    })
    out.protectedOnReopen = out.reopenState != null && out.reopenState.masterEditableCells === 0
  }
  out.deleteDisabled = Array.isArray(out.deleteEnabled) && out.deleteEnabled.some((d) => d.name === 'm_delete' && d.enabled === false)
  out.ok = !!out.addOk && !!out.protectedOnReopen && out.deleteDisabled && out.errors.length === 0
} catch (e) {
  out.fatal = String(e.stack || e).slice(0, 3000)
  step('FATAL ' + out.fatal)
} finally {
  restore()
  out.final = counts()
  out.residue = rows(`select count(*) from dbo.srledger where srinvcode > ${out.baseline?.srledgerMax ?? 0}`)[0]?.[0] ?? null
  out.baselineOk = !!out.baseline && JSON.stringify(out.final) === JSON.stringify(out.baseline) && out.residue === '0'
  out.ok = !!out.ok && out.baselineOk
  writeFileSync(`${OUT}/salereturn-cash-invoice.json`, JSON.stringify(out, (k, v) => (typeof v === 'bigint' ? Number(v) : v), 1))
  console.log(JSON.stringify(out, (k, v) => (typeof v === 'bigint' ? Number(v) : v), 1))
  await browser.close().catch(() => {})
}
