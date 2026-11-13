// In-memory corrections for the recovered class JSON.  The external/generated
// class builder can rewrite its files at any time; applying these at load time
// keeps the runtime behaviour stable without changing the generated files.
type Json = any

const id = (n: string): Json => ({ k: 'id', n })
const mem = (o: Json, n: string): Json => ({ k: 'mem', o, n })
const str = (v: string): Json => ({ k: 'str', v })
const num = (v: number): Json => ({ k: 'num', v, dec: false })
const call = (o: Json, n: string, a: Json[]): Json => ({ k: 'call', o, n, a })
const expr = (e: Json): Json => ({ k: 'expr', e })
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T

function statusColumn(c: Json): string | null {
  if (!c || typeof c !== 'object') return null
  if (c.k === 'call' && c.n === 'getitemstatus') {
    const a = c.a || []
    return a.length > 1 && a[1]?.k === 'str' ? String(a[1].v) : null
  }
  if (c.k === 'bin') return statusColumn(c.l)
  return null
}

function findStatusCall(o: Json, col: string): Json | null {
  if (!o || typeof o !== 'object') return null
  if (o.k === 'call' && o.n === 'getitemstatus') {
    const a = o.a || []
    if (a.length > 1 && a[1]?.k === 'str' && a[1].v === col) return o
  }
  for (const v of Object.values(o)) {
    const r = findStatusCall(v, col)
    if (r) return r
  }
  for (const v of Array.isArray(o) ? o : []) {
    const r = findStatusCall(v, col)
    if (r) return r
  }
  return null
}

function normalizeStatusOr(o: Json): Json {
  if (Array.isArray(o)) return o.map(normalizeStatusOr)
  if (!o || typeof o !== 'object') return o
  if (o.k === 'bin' && o.op === 'or') {
    const lcol = statusColumn(o.l)
    const rcol = statusColumn(o.r)
    const text = JSON.stringify(o)
    if (lcol && lcol === rcol && text.includes('notmodified!') && text.includes('new!')) {
      const s = findStatusCall(o.l, lcol)
      if (s) {
        const c1 = clone(s)
        const c2 = clone(s)
        return {
          k: 'bin', op: 'or',
          l: { k: 'bin', op: '=', l: c1, r: { k: 'enum', v: 'notmodified!' } },
          r: { k: 'bin', op: '=', l: c2, r: { k: 'enum', v: 'new!' } },
        }
      }
    }
  }
  return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, normalizeStatusOr(v)]))
}

function isCanonicalGate(o: Json): boolean {
  if (!o || o.k !== 'bin' || o.op !== 'or') return false
  const left = o.l
  const right = o.r
  return left?.k === 'bin' && left.op === '=' && left.r?.v === 'notmodified!' &&
    right?.k === 'bin' && right.op === '=' && right.r?.v === 'new!' &&
    statusColumn(left) === statusColumn(right)
}

function widenStatus(o: Json, cols: Set<string>, counter: { n: number }): Json {
  if (isCanonicalGate(o)) return o
  if (Array.isArray(o)) return o.map((v) => widenStatus(v, cols, counter))
  if (!o || typeof o !== 'object') return o
  if (o.k === 'bin' && o.op === '=' && o.r?.v === 'notmodified!') {
    const col = statusColumn(o.l)
    if (col && cols.has(col)) {
      counter.n++
      const left = o.l
      return {
        k: 'bin', op: 'or',
        l: { k: 'bin', op: '=', l: left, r: { k: 'enum', v: 'notmodified!' } },
        r: { k: 'bin', op: '=', l: clone(left), r: { k: 'enum', v: 'new!' } },
      }
    }
  }
  return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, widenStatus(v, cols, counter)]))
}

function fixMultiEntry(data: Json): boolean {
  const body = data.routines?.dw_itemslist?.clicked?.[0]?.body
  if (!Array.isArray(body)) return false
  if (body.some((n) => n?.k === 'expr' && JSON.stringify(n).includes('ll_rowmain') && JSON.stringify(n).includes('"stock"'))) return false
  const parent3 = mem(mem(mem(id('parent'), 'parent'), 'parent'), 'id_detail')
  const list3 = mem(mem(mem(id('parent'), 'parent'), 'parent'), 'id_itemslist')
  const node = expr(call(parent3, 'setitem', [
    id('ll_rowmain'), str('stock'),
    call(list3, 'getitemnumber', [id('row'), str('stock')]),
  ]))
  const at = Math.max(0, body.findIndex((n) => n?.k === 'return'))
  body.splice(at < 0 ? body.length : at, 0, node)
  return true
}

function removeSpuriousReturns(body: Json, markers: string[]): number {
  let removed = 0
  const walk = (o: Json): void => {
    if (Array.isArray(o)) { for (const v of o) walk(v); return }
    if (!o || typeof o !== 'object') return
    if (o.k === 'if' && Array.isArray(o.t) && o.t.length && o.t[o.t.length - 1]?.k === 'return') {
      const cond = JSON.stringify(o.c || {})
      if (markers.some((m) => cond.includes(m)) && o.t.some((n: Json) => n?.k === 'if')) {
        while (o.t.length && o.t[o.t.length - 1]?.k === 'return') o.t.pop()
        removed++
      }
    }
    for (const v of Object.values(o)) walk(v)
  }
  walk(body)
  return removed
}

function fixPurchase(data: Json): string[] {
  const out: string[] = []
  const save = data.routines?.w_purchase?.ue_save?.[0]?.body
  if (Array.isArray(save)) {
    // `return` is only valid inside the inner duplicate/expiry checks; the
    // decompiler copied it to the end of each outer validation block, which
    // aborted every save even when the check had passed.
    const n = removeSpuriousReturns(save, ['ForceUniqueSuppInvNoInPur', 'forceuniquegrnnoinpur', 'ls_expiry', 'ld_expiry'])
    if (n) out.push(`purchase save returns (${n})`)
  }
  return out
}

function fixJournalVoucher(data: Json): string[] {
  const out: string[] = []
  const save = data.routines?.w_journalvoucher?.ue_save?.[0]?.body
  if (Array.isArray(save)) {
    // The decompiler left an unconditional `return` after the category
    // 5/14/17 validation blocks, so Save validated and then did nothing.
    const n = removeSpuriousReturns(save, ['ii_vouchertype'])
    if (n) out.push(`journal voucher save returns (${n})`)
  }
  const post = data.routines?.w_journalvoucher?.ue_postopen?.[0]?.body
  if (Array.isArray(post)) {
    // `d_InvJournalVoucherDetail.patientcode` has no DropDownDataWindow in
    // the recovered definition, so GetChild returns -1 and the original
    // closes the whole voucher with "Can not get a detail DataWindowChild".
    // The patient column is hidden immediately afterwards; skip that guard so
    // the voucher remains usable (the runtime still supplies a dummy child).
    for (let i = 0; i < post.length - 1; i++) {
      const n = post[i]
      if (n?.k === 'assign' && n.l?.n === 'li_rtncode' && n.r?.k === 'call' &&
        n.r.n === 'getchild' && String(n.r.a?.[0]?.v ?? '') === 'patientcode') {
        const guard = post[i + 1]
        if (guard?.k === 'if' && JSON.stringify(guard.t || []).includes('"close"')) {
          post.splice(i + 1, 1)
          out.push('journal voucher patient child guard')
          break
        }
      }
    }
  }
  return out
}

function fixBackupDevice(data: Json): string[] {
  // The original device name is derived from a SQL Server database name that
  // contains "DATABASE".  The PostgreSQL database does not, so the function
  // stopped with "Unable to locate Database backup device." and the backup
  // form could never run.  Use a stable device name; the client maps it to a
  // pg_dump file.
  const routine = data.routines?.f_getbackupdevicename?.f_getbackupdevicename?.[0]
  if (!routine) return []
  routine.body = [{ k: 'return', e: { k: 'str', v: 'traderDBDump' } }]
  return ['backup device name']
}

function fixBackupResult(data: Json, name: string): string[] {
  let changed = 0
  const walk = (o: Json): void => {
    if (Array.isArray(o)) { for (const v of o) walk(v); return }
    if (!o || typeof o !== 'object') return
    if (o.k === 'if' && JSON.stringify(o.c || {}).includes('4035')) {
      o.c = {
        k: 'bin', op: 'or', l: o.c,
        r: {
          k: 'bin', op: '=',
          l: { k: 'mem', o: { k: 'mem', o: { k: 'id', n: 'parent' }, n: 'it_transobject' }, n: 'sqldbcode' },
          r: { k: 'num', v: 0, dec: false },
        },
      }
      changed++
    }
    for (const v of Object.values(o)) walk(v)
  }
  walk(data.routines?.cb_backup?.clicked?.[0]?.body)
  return changed ? [`${name} backup result`] : []
}

function fixCashierShift(data: Json): string[] {
  const body = data.routines?.cb_ok?.clicked?.[0]?.body
  if (!Array.isArray(body)) return []
  // Bytecode guards 518/928 -> 1028, 1398/1574 -> 1628 and 2060 -> 6676
  // continue after their inner validations; only the failure branches return.
  const n = removeSpuriousReturns(body, ['dw_figures', 'dw_cash'])
  const out = n ? [`cashier shift close returns (${n})`] : []
  let updates = 0
  const retainDirty = (node: Json): void => {
    if (!node || typeof node !== 'object') return
    if (node.k === 'call' && node.n === 'update' && node.o?.k === 'mem' &&
      node.o.o?.k === 'id' && node.o.o.n === 'parent' && ['dw_detail', 'dw_cash'].includes(node.o.n) &&
      node.a?.length === 1 && node.a[0]?.k === 'id' && node.a[0].n === 'true') {
      // A later cash-count failure rolls both updates back. Retain the original
      // snapshots for retry; success closes and destroys this modal's buffers.
      node.a.push(id('false'))
      updates++
    }
    for (const value of Object.values(node)) retainDirty(value)
  }
  retainDirty(body)
  if (updates) out.push(`cashier shift deferred update flags (${updates})`)
  return out
}

/** `sqlcode <> 0` also matches the PowerBuilder no-row result 100; a missing lookup row is not a database failure. */
function treatNoRowsAsSuccess(cond: Json): Json {
  if (!cond || cond.k !== 'bin') return cond
  const equals = (value: Json): Json => ({ k: 'bin', op: '=', l: value, r: num(100) })
  if (cond.op === '=' && cond.r?.k === 'num' && cond.r.v === 0) {
    return { k: 'bin', op: 'or', l: cond, r: equals(clone(cond.l)) }
  }
  if (cond.op === '<>' && cond.r?.k === 'num' && cond.r.v === 0) {
    return { k: 'bin', op: 'and', l: cond, r: { k: 'bin', op: '<>', l: clone(cond.l), r: num(100) } }
  }
  return cond
}

function fixSqlNoRows(data: Json, owner: string, event: string, marker: string): string[] {
  const body = data.routines?.[owner]?.[event]?.[0]?.body
  if (!Array.isArray(body)) return []
  const sql = body.findIndex((n) => n?.k === 'sql' && n.kind === 'select' &&
    JSON.stringify(n.text || '').toLowerCase().includes(marker))
  if (sql < 0) return []
  const at = body.findIndex((n, index) => index > sql && n?.k === 'if' && JSON.stringify(n.c || {}).includes('sqlcode'))
  if (at < 0) return []
  if (JSON.stringify(body[at].c).includes('"v":100')) return []
  const original = body[at].c
  body[at].c = treatNoRowsAsSuccess(original)
  // Change Password's next branch tests `isnull(ls_password)`, but an
  // uninitialised PowerScript string is "" rather than null.  Route the
  // explicit no-row result to the name-validation branch too.
  if (owner === 'cb_ok' && original?.l) {
    const first = body[at].ei?.[0]
    if (first && JSON.stringify(first.c || {}).includes('isnull')) {
      first.c = { k: 'bin', op: 'or', l: { k: 'bin', op: '=', l: clone(original.l), r: num(100) }, r: first.c }
    }
  }
  return [`${owner}.${event} treats SQLCode 100 as no rows`]
}

function fixValidatedW(data: Json): boolean {
  const body = data.routines?.f_validatedw?.f_validatedw?.[0]?.body
  if (!Array.isArray(body)) return false
  // The decompiler duplicated the FindRequired call into the second gate and
  // replaced the original `ll_row <> 0` test with `FindRequired(...) = 1`.
  // FindRequired returns 1 even when it reports "no required column" (it sets
  // row to 0), so every save of a valid DataWindow showed the validation box
  // and aborted.  The first gate (`FindRequired(...) < 0`) is harmless; the
  // second gate must test the row number that the first call filled in.
  const gates = body.filter((n) => n?.k === 'if' && JSON.stringify(n.c || {}).includes('findrequired'))
  const hasDescribe = (n: Json): boolean => Array.isArray(n?.t) && n.t.some((statement: Json) => statement?.k === 'assign' &&
    statement.r?.k === 'call' && statement.r.n === 'describe')
  const target = gates.length >= 2 ? gates[1] : body.find((n) => n?.k === 'if' && hasDescribe(n))
  if (!target) return false
  const c = target.c
  let changed = false
  if (!(c?.k === 'bin' && c.op === '<>' && c.l?.k === 'id' && c.l.n === 'll_row' && c.r?.k === 'num' && c.r.v === 0)) {
    target.c = { k: 'bin', op: '<>', l: id('ll_row'), r: num(0) }
    changed = true
  }
  // Describe("column_t.Text") returns "!" for a required column whose label
  // object does not exist (for example supplier_cp).  Keep the column name as
  // the fallback instead of showing the PowerBuilder error marker.
  const statements = Array.isArray(target.t) ? target.t : []
  const describe = statements.findIndex((n: Json) => n?.k === 'assign' && n.l?.k === 'id' && n.l.n === 'ls_colname' &&
    n.r?.k === 'call' && n.r.n === 'describe')
  if (describe >= 0) {
    statements[describe] = { ...statements[describe], l: id('ls_textname') }
    statements.splice(describe + 1, 0, {
      k: 'if',
      c: { k: 'bin', op: '=', l: id('ls_textname'), r: { k: 'str', v: '!' } },
      t: [{ k: 'assign', l: id('ls_textname'), op: '=', r: id('ls_colname') }],
      ei: [],
    })
    const box = statements.find((n: Json) => n?.k === 'expr' && n.e?.k === 'call' && n.e.n === 'messagebox')
    const replaceName = (node: Json): void => {
      if (Array.isArray(node)) { node.forEach(replaceName); return }
      if (!node || typeof node !== 'object') return
      if (node.k === 'id' && node.n === 'ls_colname') { node.n = 'ls_textname'; return }
      Object.values(node).forEach(replaceName)
    }
    if (box?.e?.a?.[1]) replaceName(box.e.a[1])
    changed = true
  }
  return changed
}

function fixCashierCategory(data: Json): string[] {
  const name = 'w_cashierjobactivity_changecategory'
  const window = data.routines?.[name], ok = data.routines?.cb_ok?.clicked?.[0]?.body
  const open = window?.open?.[0]?.body, filter = window?.wf_filteraccounts?.[0]?.body
  const out: string[] = []
  const returned = { k: 'return', e: mem({ k: 'global', n: 'message' }, 'returnvalue') }
  const gate = (value: Json, op: string, expected: number, body: Json[]): Json =>
    ({ k: 'if', c: { k: 'bin', op, l: value, r: num(expected) }, t: body, ei: [] })
  const message = (text: Json): Json => expr(call(null, 'messagebox', [str('Change Category'), text, { k: 'enum', v: 'stopsign!' }]))
  const close = (text: Json): Json[] => [message(text), expr(call(null, 'closewithreturn', [id('this'), num(-1)])), clone(returned)]
  const guardCall = (body: Json, method: string, op: string, expected: number, failure: Json[], label: string): void => {
    if (!Array.isArray(body)) return
    const at = body.findIndex((node) => node.k === 'expr' && node.e?.k === 'call' && node.e.n === method)
    if (at < 0) return
    body[at] = gate(body[at].e, op, expected, failure)
    out.push(label)
  }
  // Intentional rebuild hardening: invalid drafts must not post their last
  // accepted value, and these modal-owned buffers survive unsuccessful saves.
  guardCall(ok, 'accepttext', '=', -1, [clone(returned)], 'cashier category acceptance guard')
  let updates = 0
  const retainDirty = (node: Json): void => {
    if (!node || typeof node !== 'object') return
    if (node.k === 'call' && node.n === 'update' && node.o?.n === 'id_dw' &&
      node.a?.length === 1 && node.a[0]?.n === 'true') {
      node.a.push(id('false')); updates++
    }
    for (const value of Object.values(node)) retainDirty(value)
  }
  retainDirty(ok)
  if (updates) out.push(`cashier category deferred update flags (${updates})`)
  const save = ok?.find((node: Json) => node.k === 'if' &&
    node.ei?.some((branch: Json) => branch.c?.l?.n === 'update' && branch.c.l.o?.n === 'id_dw'))
  if (save && !save.e) {
    save.e = [gate(mem(mem(id('parent'), 'it_transobject'), 'sqlcode'), '<>', 0, [
      { k: 'sql', kind: 'rollback', text: 'rollback', hv: [], using: 'parent.it_transobject' },
    ])]
    out.push('cashier category failed-update rollback')
  }
  let commits = 0
  const guardCommits = (node: Json, result: Json): void => {
    if (!node || typeof node !== 'object') return
    if (node.k === 'try' && node.catches?.some((entry: Json) => entry.v === 'le_category_commit')) return
    if (Array.isArray(node)) {
      for (let index = 0; index < node.length; index++) {
        const statement = node[index]
        if (statement?.k === 'sql' && statement.kind === 'commit' &&
          ['this.it_transobject', 'parent.it_transobject'].includes(statement.using)) {
          node[index] = { k: 'try', body: [statement], catches: [{ t: 'throwable', v: 'le_category_commit', b: [
            message({ k: 'bin', op: '+', l: str('The save could not be confirmed. Check the document before retrying.\r\n'),
              r: call(id('le_category_commit'), 'getmessage', []) }),
            { ...clone(statement), kind: 'rollback', text: 'rollback' }, clone(result),
          ] }] }
          commits++
        } else guardCommits(statement, result)
      }
    } else for (const value of Object.values(node)) guardCommits(value, result)
  }
  guardCommits(ok, returned)
  guardCommits(window?.wf_supervise?.[0]?.body, { k: 'return', e: num(1) })
  if (commits) out.push(`cashier category commit guards (${commits})`)
  let failedOpens = 0
  const rejectOpen = (node: Json): void => {
    if (!node || typeof node !== 'object') return
    if (node.k === 'call' && node.n === 'close' && node.a?.length === 1 && node.a[0]?.n === 'this') {
      node.n = 'closewithreturn'; node.a.push(num(-1)); failedOpens++
    }
    for (const value of Object.values(node)) rejectOpen(value)
  }
  rejectOpen(open)
  if (failedOpens) out.push(`cashier category failed-open returns (${failedOpens})`)
  if (Array.isArray(open)) {
    const at = open.findIndex((node) => node.k === 'assign' && node.r?.k === 'call' && node.r.n === 'f_getgroupcode')
    if (at >= 0 && !JSON.stringify(open[at + 1] ?? null).includes('"sqlca"')) {
      open.splice(at + 1, 0, gate(mem(id('sqlca'), 'sqlcode'), '<>', 0, close(mem(id('sqlca'), 'sqlerrtext'))))
      out.push('cashier category group-query guard')
    }
  }
  guardCall(open, 'retrieve', '<>', 1,
    close(str('The cashier activity is unavailable or already supervised. No changes were saved.')), 'cashier category retrieve guard')
  guardCall(open, 'wf_filteraccounts', '<>', 0,
    close(str('Unable to load permitted account choices. Close and try again.')), 'cashier category permissions guard')
  const guardFilterStatus = (node: Json): void => {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node)) {
      const at = node.findIndex((entry) => entry.k === 'expr' && entry.e?.n === 'getallowedgroupcustomercategory')
      if (at >= 0 && !JSON.stringify(node[at + 1] ?? null).includes('"sqlcode"')) {
        node.splice(at + 1, 0, gate(mem(mem(id('this'), 'it_transobject'), 'sqlcode'), '<>', 0, [{ k: 'return', e: num(1) }]))
        out.push('cashier category permission-query guard')
      }
    }
    for (const value of Object.values(node)) guardFilterStatus(value)
  }
  guardFilterStatus(filter)
  return out
}

function fixCalendar(name: string, data: Json): string[] {
  const body = data.routines?.[name]?.open?.[0]?.body
  if (!Array.isArray(body)) return []
  const out: string[] = []
  const branch = body.find((node) => node.k === 'if' && node.c?.k === 'call' && node.c.n === 'isdate')
  const calendar = mem(id('this'), 'mc_calendar')
  const today = expr(call(calendar, 'setselecteddate', [call(null, 'today', [])]))
  if (branch?.e && !branch.e.some((node: Json) => node.k === 'expr' && node.e?.n === 'setselecteddate')) {
    branch.e.push(today)
    out.push('calendar invalid-date selection')
  }
  const original = branch?.t?.[0]
  const selectionFailure = (result: Json): Json => ({
    k: 'if', c: { k: 'bin', op: '<>', l: result, r: num(0) }, t: [
      expr(call(null, 'messagebox', [str('Calendar'),
        str('This date is outside the calendar range (1601 to 9999). Select a supported date or cancel.'),
        { k: 'enum', v: 'exclamation!' }, { k: 'enum', v: 'ok!' }, num(1)])),
      clone(today),
    ], ei: [],
  })
  if (original?.k === 'expr' && original.e?.n === 'setselecteddate') {
    branch.t[0] = selectionFailure(original.e)
    out.push('calendar selection failure feedback')
  } else if (original?.k === 'assign' && original.l?.n === 'll_retcode' &&
    original.r?.n === 'setselecteddate' && branch.t.length === 1) {
    branch.t.push(selectionFailure(id('ll_retcode')))
    out.push('calendar selection failure feedback')
  }
  const initial = { k: 'assign', l: mem({ k: 'global', n: 'message' }, 'stringparm'), op: '=',
    r: name === 'w_calendar2' ? call(null, 'string', [mem(id('this'), 'id_old_date'), str('yyyy-mm-dd')]) : str('') }
  if (!body.some((node) => JSON.stringify(node) === JSON.stringify(initial))) {
    const at = body.findIndex((node) => node.k === 'expr' && node.e?.n === 'setfocus')
    if (at >= 0) { body.splice(at + 1, 0, initial); out.push('calendar cancellation default') }
  }
  return out
}

function fixDataWindowCalendar(data: Json): string[] {
  const out: string[] = []
  for (const owner of ['u_dwstandard', 'dw_itemsdetail']) {
    const body = data.routines?.[owner]?.ue_dwnkey?.[0]?.body
    const branch = body?.find((node: Json) => node.k === 'if' && node.t?.some((entry: Json) =>
      entry.k === 'expr' && entry.e?.n === 'openwithparm' && entry.e.a?.[0]?.n === 'w_calendar2'))
    if (!branch) continue
    const at = branch.t.findIndex((node: Json) => node.k === 'expr' && node.e?.n === 'accepttext')
    if (at >= 0) {
      branch.t[at] = { k: 'if', c: { k: 'bin', op: '<>', l: branch.t[at].e, r: num(1) },
        t: [{ k: 'return', e: mem({ k: 'global', n: 'message' }, 'returnvalue') }], ei: [] }
      out.push(`${owner} calendar acceptance guard`)
    }
    const emptyClock = { k: 'if', c: { k: 'bin', op: 'or',
      l: call(null, 'isnull', [id('ls_temp')]), r: { k: 'bin', op: '=', l: id('ls_temp'), r: str('') } },
      t: [{ k: 'assign', l: id('ls_time'), op: '=', r: str('00:00:00') }], ei: [] }
    let clockFormat: Json[] | undefined, clockSuffix: Json[] | undefined
    const visitClock = (node: Json): void => {
      if (!node || typeof node !== 'object') return
      if (node.k === 'assign' && node.l?.n === 'ls_temp' && node.r?.n === 'string' &&
        node.r.a?.[1]?.v === 'yyyy-mm-dd hh:mm:ss') clockFormat = node.r.a
      if (node.k === 'assign' && node.l?.n === 'ls_time' && node.r?.n === 'right' &&
        node.r.a?.[0]?.n === 'ls_temp' && node.r.a?.[1]?.v === 8) clockSuffix = node.r.a
      if (Array.isArray(node)) {
        const index = node.findIndex((entry) => entry.k === 'assign' && entry.l?.n === 'ls_time' && entry.r?.n === 'right')
        if (index >= 0 && !node.some((entry) => JSON.stringify(entry) === JSON.stringify(emptyClock))) {
          node.splice(index + 1, 0, clone(emptyClock))
          out.push(`${owner} empty calendar clock`)
        }
      }
      for (const value of Object.values(node)) visitClock(value)
    }
    visitClock(branch.t)
    if (clockFormat && clockSuffix) {
      clockFormat[1] = str('yyyy-mm-dd hh:mm:ss:fff')
      clockSuffix[1] = num(12)
      out.push(`${owner} calendar clock precision`)
    }
    if (!branch.t.some((node: Json) => node.k === 'expr' && node.e?.n === 'setfocus')) {
      branch.t.push(expr(call(id('this'), 'setfocus', [])))
      out.push(`${owner} calendar focus restoration`)
    }
  }
  return out
}

function fixCriteriaCalendar(data: Json): string[] {
  const out: string[] = []
  for (const name of ['em_startdate', 'em_enddate']) {
    const body = data.routines?.[name]?.keydown?.[0]?.body
    if (!Array.isArray(body)) continue
    const f4 = body.find((node) => node.k === 'if' && node.c?.k === 'bin' && node.c.r?.v === 'keyf4!')
    const selected = f4?.t?.find((node: Json) => node.k === 'if')
    if (!selected?.t || selected.t.some((node: Json) => node.k === 'assign' && node.l?.n === 'ls_date')) continue
    const at = selected.t.findIndex((node: Json) => node.k === 'assign' && node.l?.n === 'ls_temp')
    if (at < 0) continue
    const format = call(null, 'left', [mem(id('this'), 'mask'), num(10)])
    selected.t.splice(at, 1,
      { k: 'assign', l: id('ls_date'), op: '=', r: call(null, 'string', [call(null, 'date', [id('ls_date')]), format]) },
      { k: 'if', c: { k: 'bin', op: '>', l: call(null, 'len', [mem(id('this'), 'mask')]), r: num(10) },
        t: [selected.t[at]], ei: [], e: [{ k: 'assign', l: id('ls_temp'), op: '=', r: id('ls_date') }] })
    f4.t.push({ k: 'assign', l: mem({ k: 'global', n: 'message' }, 'powerobjectparm'),
      op: '=', r: mem(id('parent'), 'istr_arg') })
    f4.t.push(expr(call(id('this'), 'setfocus', [])))
    out.push(`${name} calendar mask preservation`)
  }
  return out
}

function fixCriteriaAcceptance(name: string, data: Json, boundControls?: readonly string[]): string[] {
  const body = data.routines?.cb_ok?.clicked?.[0]?.body
  if (!Array.isArray(body)) return []
  const controls = boundControls ?? (name === 'w_arg_quotation_customer_remarks' ? ['dw_selection'] :
    name === 'w_sale_replace_custref' ? ['dw_replace_custref'] :
      name === 'w_arg_items_sdate_ldate_topn' ? ['dw_custcount'] :
        name === 'w_arg_zone_sdate_ldate_top_n_customer' ? ['dw_control', 'dw_custcount'] : ['dw_control'])
  const guards = controls.map((control) => ({
    k: 'if', c: { k: 'bin', op: '<>', l: call(mem(id('parent'), control), 'accepttext', []), r: num(1) },
    t: [{ k: 'return', e: mem({ k: 'global', n: 'message' }, 'returnvalue') }], ei: [],
  }))
  const missing = guards.filter((guard) => !body.some((node) => JSON.stringify(node) === JSON.stringify(guard)))
  if (!missing.length) return []
  let at = 0
  while (body[at]?.k === 'decl') at++
  body.splice(at, 0, ...missing)
  return ['criteria acceptance guard']
}

function fixNumericCancellation(name: string, data: Json, value: number): boolean {
  const open = data.routines?.[name]?.open?.[0]?.body
  const initial = { k: 'assign', l: mem({ k: 'global', n: 'message' }, 'doubleparm'), op: '=', r: num(value) }
  if (!Array.isArray(open) || open.some((node) => JSON.stringify(node) === JSON.stringify(initial))) return false
  let at = 0
  while (open[at]?.k === 'decl') at++
  open.splice(at, 0, initial)
  return true
}

function fixCriteriaDates(data: Json): string[] {
  const body = data.routines?.cb_ok?.clicked?.[0]?.body
  if (!Array.isArray(body) || body.some((node) => node.k === 'decl' &&
    node.vars?.some((variable: Json) => variable.n === 'ldt_criteria_checked'))) return []
  const controls = [...new Set<string>(body.filter((node) => node.k === 'expr' && node.e?.n === 'getdata' &&
    ['em_startdate', 'em_enddate'].includes(node.e.o?.n)).map((node) => node.e.o.n))]
  if (!controls.length) return []
  const declaration = { k: 'decl', t: 'datetime', arr: false, vars: [{ n: 'ldt_criteria_checked' }] }
  const guards = controls.map((name) => {
    const control = mem(id('parent'), name)
    return { k: 'if', c: { k: 'bin', op: '<>', l: call(control, 'getdata', [id('ldt_criteria_checked')]), r: num(1) },
      t: [
        expr(call(null, 'messagebox', [str('Validation Error'),
          { k: 'bin', op: '+', l: str('Enter a valid date using '), r: mem(control, 'mask') },
          { k: 'enum', v: 'exclamation!' }, { k: 'enum', v: 'ok!' }, num(1)])),
        expr(call(control, 'setfocus', [])),
        { k: 'return', e: mem({ k: 'global', n: 'message' }, 'returnvalue') },
      ], ei: [] }
  })
  let at = 0
  while (body[at]?.k === 'decl') at++
  body.splice(at, 0, declaration, ...guards)
  return ['criteria date acceptance guards']
}

function fixDateCancellation(name: string, data: Json): string[] {
  if (!data.routines?.cb_ok?.clicked) return []
  const owner = data.routines[name]
  if (!owner) return []
  if (!owner.open) {
    owner.open = [{ owner: name, name: 'open', params: [], ret: 'long', locals: [], event: true, line: 0,
      body: [expr({ k: 'super', n: 'open', a: [] }),
        { k: 'return', e: mem({ k: 'global', n: 'message' }, 'returnvalue') }] }]
  }
  const open = owner.open[0].body
  const initial = { k: 'assign', l: mem({ k: 'global', n: 'message' }, 'powerobjectparm'),
    op: '=', r: mem(id('this'), 'istr_arg') }
  if (open.some((node: Json) => JSON.stringify(node) === JSON.stringify(initial))) return []
  let at = 0
  while (open[at]?.k === 'decl') at++
  open.splice(at, 0, initial)
  return ['date criteria cancellation default']
}

function fixItemSelection(data: Json): string[] {
  const open = data.routines?.w_arg_items_sdate_ldate_topn?.open?.[0]?.body
  if (!Array.isArray(open)) return []
  const out: string[] = []
  const initial = { k: 'assign', l: mem({ k: 'global', n: 'message' }, 'powerobjectparm'),
    op: '=', r: mem(id('this'), 'istr_arg') }
  if (!open.some((node) => JSON.stringify(node) === JSON.stringify(initial))) {
    let at = 0
    while (open[at]?.k === 'decl') at++
    open.splice(at, 0, initial)
    out.push('item selection cancellation default')
  }
  let guarded = 0
  for (let at = 0; at < open.length; at++) {
    const node = open[at]
    if (node.k !== 'expr' || node.e?.n !== 'retrieve' ||
      !['ids_allcustomers', 'dw_custcount'].includes(node.e.o?.n)) continue
    const feedback = node.e.o.n === 'ids_allcustomers' ? [
      expr(call(null, 'messagebox', [str('Database Error'), mem(id('sqlca'), 'sqlerrtext'),
        { k: 'enum', v: 'stopsign!' }, { k: 'enum', v: 'ok!' }, num(1)])),
    ] : []
    open[at] = { k: 'if', c: { k: 'bin', op: '<', l: node.e, r: num(0) },
      t: [...feedback, expr(call(null, 'closewithreturn', [id('this'), mem(id('this'), 'istr_arg')])),
        { k: 'return', e: mem({ k: 'global', n: 'message' }, 'returnvalue') }], ei: [] }
    guarded++
  }
  if (guarded) out.push(`item selection retrieval guards (${guarded})`)
  return out
}

function fixPackingSelection(data: Json): string[] {
  const out: string[] = []
  if (fixNumericCancellation('w_select_case', data, 0)) out.push('packing cancellation default')
  const selected = data.routines?.w_select_case?.ue_close?.[0]?.body?.find((node: Json) => node.k === 'if')?.t
  if (Array.isArray(selected)) {
    const at = selected.findIndex((node) => node.k === 'expr' && node.e?.n === 'accepttext')
    if (at >= 0) {
      selected[at] = { k: 'if', c: { k: 'bin', op: '<>', l: selected[at].e, r: num(1) },
        t: [{ k: 'return' }], ei: [] }
      out.push('packing return acceptance guard')
    }
  }
  return out
}

function fixCriteriaRetrieval(name: string, data: Json): string[] {
  const out: string[] = []
  const open = data.routines?.[name]?.open?.[0]?.body
  const at = Array.isArray(open) ? open.findIndex((node) => node.k === 'expr' && node.e?.n === 'retrieve') : -1
  if (at >= 0) {
    const failed: Json[] = []
    if (name === 'w_arg_quotation_customer_remarks') {
      failed.push({ k: 'assign', l: mem(mem(id('this'), 'istr_arg'), 'i_status'), op: '=', r: num(-1) })
    }
    failed.push(expr(call(null, 'closewithreturn', [id('this'),
      name === 'w_select_case' ? num(0) : mem(id('this'), 'istr_arg')])),
    { k: 'return', e: mem({ k: 'global', n: 'message' }, 'returnvalue') })
    open[at] = { k: 'if', c: { k: 'bin', op: '<', l: open[at].e, r: num(0) }, t: failed, ei: [] }
    out.push('criteria retrieval failure guard')
  }
  if (name === 'w_arg_pricetype_markup') {
    const valid = data.routines?.cb_ok?.clicked?.[0]?.body?.find((node: Json) =>
      node.k === 'if' && node.c?.op === '<=' && JSON.stringify(node.c).includes('"pricetypecode"'))
    if (valid) {
      valid.c = { k: 'bin', op: 'or', l: call(null, 'isnull', [clone(valid.c.l)]), r: valid.c }
      out.push('price type null validation')
    }
  }
  return out
}

function fixSale(data: Json): string[] {
  const out: string[] = []
  const body = data.routines?.w_sale?.wf_inititeminfo?.[0]?.body
  if (Array.isArray(body)) {
    for (let i = body.length - 1; i >= 0; i--) {
      const n = body[i]
      if (n?.k === 'assign' && n.l?.n === 'retflag' && n.r?.n === 'true') body.splice(i, 1)
    }
    let at = 0
    while (at < body.length && body[at]?.k === 'decl') at++
    body.splice(at, 0, { k: 'assign', l: id('retflag'), op: '=', r: id('true') })

    for (let i = body.length - 1; i >= 0; i--) {
      const s = JSON.stringify(body[i] || {})
      if (body[i]?.k === 'if' && s.includes('ld_godownstock') && s.includes('id_itemslist')) body.splice(i, 1)
    }
    const detailStock = (): Json => call(mem(id('this'), 'id_detail'), 'getitemnumber', [id('al_row'), str('stock')])
    const hasFallback = body.some((n) => n?.k === 'if' && JSON.stringify(n).includes('ld_godownstock') && JSON.stringify(n).includes('id_detail'))
    if (!hasFallback) {
      const idx = body.findIndex((n) => n?.k === 'expr' && JSON.stringify(n).includes('getitemstocktotal'))
      if (idx >= 0) {
        let pos = idx + 1
        if (body[pos]?.k === 'if' && JSON.stringify(body[pos].c || {}).includes('sqlcode')) pos++
        body.splice(pos, 0, {
          k: 'if', c: { k: 'bin', op: '>', l: detailStock(), r: num(0) },
          t: [{ k: 'assign', l: id('ld_godownstock'), op: '=', r: detailStock() }], ei: [],
        })
      }
    }

    const counter = { n: 0 }
    const widened = widenStatus(normalizeStatusOr(body), new Set(['saleprice', 'discperc']), counter)
    data.routines.w_sale.wf_inititeminfo[0].body = normalizeStatusOr(widened)
    if (counter.n) out.push('w_sale init defaults')
  }

  const saveBody = data.routines?.w_sale?.ue_save?.[0]?.body
  if (Array.isArray(saveBody)) {
    const markers = ['SaleOnZeroPrice', 'AllowSaleAboveRetailPriceInSale', 'ApplySalesTaxOnSavingBeforeUserPwd', 'PreserveSaleInvHistory', 'SaveBalanceOnSalePosting']
    let removed = 0
    const walk = (o: Json): void => {
      if (Array.isArray(o)) { for (const v of o) walk(v); return }
      if (!o || typeof o !== 'object') return
      if (o.k === 'if' && Array.isArray(o.t) && o.t.length && o.t[o.t.length - 1]?.k === 'return') {
        const cond = JSON.stringify(o.c || {})
        if (markers.some((m) => cond.includes(m)) && o.t.some((n: Json) => n?.k === 'if')) {
          while (o.t.length && o.t[o.t.length - 1]?.k === 'return') o.t.pop()
          removed++
        }
      }
      // a validation return copied to the end of `choose case ii_saletype`
      // aborted every credit sale
      if (o.k === 'choose' && Array.isArray(o.cs)) {
        for (const c of o.cs) {
          const b = c?.b
          if (Array.isArray(b) && b.length && b[b.length - 1]?.k === 'return' && b.some((n: Json) => n?.k === 'if')) {
            while (b.length && b[b.length - 1]?.k === 'return') b.pop()
            removed++
          }
        }
      }
      for (const v of Object.values(o)) walk(v)
    }
    walk(saveBody)
    if (removed) out.push('w_sale save returns')
  }

  const ue = data.routines?.dw_itemsdetail?.ue_enterkey?.[0]?.body
  if (Array.isArray(ue) && !JSON.stringify(ue).includes('wf_grandtotal')) {
    let p = 0
    while (p < ue.length && ue[p]?.k === 'decl') p++
    ue.splice(p, 0, expr(call(null, 'wf_grandtotal', [])))
  }

  // `long ll_retcode = 1` lost its initialiser in decompilation; an empty
  // refused-sale list then reported failure and blocked Save And Post.
  const refused = data.routines?.w_sale?.wf_save_refusedsale?.[0]?.body
  if (Array.isArray(refused) && !refused.some((n) => n?.k === 'assign' && n.l?.n === 'll_retcode')) {
    let p = 0
    while (p < refused.length && refused[p]?.k === 'decl') p++
    refused.splice(p, 0, { k: 'assign', l: id('ll_retcode'), op: '=', r: num(1) })
    out.push('w_sale refused-sale result')
  }
  return out
}

/** Apply all corrections to one parsed class. Mutates `data`. */
/**
 * The decompiler printed `.name` for the `object` namespace of the DataWindow in the prescription's Open event
 * (the same defect it printed as `.borderstyle` in dozens of windows).  The statement sets the initial value of the
 * `bsa` column of the vitals datastore the caller passes, exactly like the `X.object.COL.initial` statements
 * everywhere else in the application; without the correction the window stops with a null reference.
 */
function fixVisitPrescription(data: Json): string[] {
  const out: string[] = []
  const body = data.routines?.w_visitprescription?.open?.[0]?.body
  if (!Array.isArray(body)) return out
  let fixed = 0
  const walk = (o: Json): void => {
    if (Array.isArray(o)) { for (const v of o) walk(v); return }
    if (!o || typeof o !== 'object') return
    if (o.k === 'mem' && o.n === 'name') {
      const parent = JSON.stringify(o.o || {})
      if (parent.includes('"n":"ds"') && parent.includes('"n":"istr_ds"')) { o.n = 'object'; fixed++ }
    }
    for (const v of Object.values(o)) walk(v)
  }
  walk(body)
  if (fixed) out.push('w_visitprescription bsa default')
  return out
}

/**
 * The barcode label popup re-triggers its own `ue_postopen` event from inside that event
 * (`event ue_postopen()` after `message.doubleparm = 1`), which recurses until the stack is exhausted.  The
 * statement was meant to run the ancestor's `ue_postopen` again with the parameter the author set (the ancestor
 * reads `message.doubleparm`), so the rebuild calls the ancestor's script instead.  This is a scoped correction of
 * the recovered script, documented in `docs/FIDELITY.md`, not a change of the recovered source.
 */
function fixBarcodeLabelsPopup(data: Json): string[] {
  const out: string[] = []
  const body = data.routines?.w_barcodelabels_popup?.ue_postopen?.[0]?.body
  if (!Array.isArray(body)) return out
  let fixed = 0
  const walk = (o: Json): void => {
    if (Array.isArray(o)) { for (const v of o) walk(v); return }
    if (!o || typeof o !== 'object') return
    if (o.k === 'expr' && o.e?.k === 'call' && o.e?.n === 'ue_postopen' && o.e?.m === 'event') {
      o.k = 'callsuper'
      o.n = 'ue_postopen'
      delete o.e
      fixed++
      return
    }
    for (const v of Object.values(o)) walk(v)
  }
  walk(body)
  if (fixed) out.push('w_barcodelabels_popup postopen recursion')
  return out
}

/** Apply all corrections to one parsed class. Mutates `data`. */
export function fixClassData(name: string, data: Json): string[] {
  const n = name.toLowerCase()
  if (n === 'w_multi_entry') return fixMultiEntry(data) ? ['stock transfer'] : []
  if (n === 'w_sale') return fixSale(data)
  if (n === 'w_purchase') return fixPurchase(data)
  if (n === 'w_journalvoucher') return fixJournalVoucher(data)
  if (n === 'w_cashiershift_closing') return fixCashierShift(data)
  if (n === 'w_cashierjobactivity_changecategory') return fixCashierCategory(data)
  if (n === 'w_calendar' || n === 'w_calendar2') return fixCalendar(n, data)
  if (n === 'w_visitprescription') return fixVisitPrescription(data)
  if (n === 'w_barcodelabels_popup') return fixBarcodeLabelsPopup(data)
  if (n === 'u_dwstandard' || n === 'w_customercomments') return fixDataWindowCalendar(data)
  if (n === 'w_arguements') return fixCriteriaCalendar(data)
  if (n === 'w_select_case') return [...fixCriteriaAcceptance(n, data), ...fixPackingSelection(data), ...fixCriteriaRetrieval(n, data)]
  if (n === 'w_sale_replace_custref') return [...fixCriteriaAcceptance(n, data),
    ...(fixNumericCancellation(n, data, -1) ? ['customer reference cancellation default'] : [])]
  if (['w_arg_sdate', 'w_arg_sdate_notime', 'w_arg_sdate_ldate',
    'w_arg_sale_sdate_ldate', 'w_arg_sale_return_sdate_ldate', 'w_arg_sdate_ldate_adj',
    'w_arg_sdate_ldate_outstanding_inv', 'w_arg_sdate_ldate_postunpost',
    'w_arg_sdate_ldate_postunpost_dateoption', 'w_arg_sdate_ldate_purtype',
    'w_arg_sdate_ldate_saletype', 'w_arg_sdate_ldate_transaction',
    'w_arg_ason', 'w_arg_sdate_cashflow_crosstab', 'w_arg_sdate_ldate_remarks_option'].includes(n)) {
    return [...fixCriteriaDates(data), ...fixDateCancellation(n, data)]
  }
  if (['w_arg_sale_sdate_ldate_avgprice_rpp', 'w_arg_sdate_ldate_avg_rpp',
    'w_arg_sdate_ldate_cashcreditboth'].includes(n)) {
    return [...fixCriteriaDates(data), ...fixCriteriaAcceptance(n, data, ['dw_price']), ...fixDateCancellation(n, data)]
  }
  if (['w_arg_acc_sdate_ldate', 'w_arg_antinortixitem_sdate_ldate', 'w_arg_doct_sdate_ldate',
    'w_arg_godown_sdate_ldate', 'w_arg_manf_sdate_ldate', 'w_arg_patient_sdate_ldate_old',
    'w_arg_region_sdate_ldate', 'w_arg_singleregion', 'w_arg_singlezone', 'w_arg_sman_sdate_ldate',
    'w_arg_subacc_sdate_ldate', 'w_arg_supp_label', 'w_arg_supp_sdate_ldate_old',
    'w_arg_user_sdate_ldate', 'w_arg_custgroup'].includes(n)) {
    return [...fixCriteriaDates(data), ...fixCriteriaAcceptance(n, data), ...fixDateCancellation(n, data),
      ...(n === 'w_arg_antinortixitem_sdate_ldate' ? fixCriteriaRetrieval(n, data) : [])]
  }
  if (['w_arg_batchno', 'w_arg_containerno', 'w_arg_masterpart', 'w_arg_phoneno', 'w_arg_ref',
    'w_arg_smscenter', 'w_arg_day', 'w_arg_discperc', 'w_arg_gstperc', 'w_arg_scode_lcode',
    'w_arg_scode_lcode2', 'w_arg_sinvcode_linvcode'].includes(n)) {
    return [...fixCriteriaAcceptance(n, data), ...fixDateCancellation(n, data)]
  }
  if (n === 'w_arg_items_sdate_ldate_topn') return [...fixCriteriaDates(data), ...fixCriteriaAcceptance(n, data), ...fixItemSelection(data)]
  if (['w_arg_activeclass_single', 'w_arg_letter_sdate_ldate', 'w_arg_pricetype_markup',
    'w_arg_sdate_ldate_margin_markup_range', 'w_arg_quotation_customer_remarks', 'w_arg_percentage_reduce_raise',
    'w_arg_zone_sdate_ldate_top_n_customer'].includes(n)) {
    return [...fixCriteriaDates(data), ...fixCriteriaAcceptance(n, data), ...(['w_arg_pricetype_markup', 'w_arg_quotation_customer_remarks'].includes(n) ?
      fixCriteriaRetrieval(n, data) : [])]
  }
  if (n === 'f_getbackupdevicename') return fixBackupDevice(data)
  if (n === 'w_dbbackup') return fixBackupResult(data, n)
  if (n === 'w_dbbackup1') return fixBackupResult(data, n)
  if (n === 'f_validatedw') return fixValidatedW(data) ? ['required-field gate'] : []
  if (n === 'w_cashieractivitymonitor') return fixSqlNoRows(data, n, 'open', 'cashierjob')
  if (n === 'w_changepassword') return fixSqlNoRows(data, 'cb_ok', 'clicked', 'users.password')
  return []
}
