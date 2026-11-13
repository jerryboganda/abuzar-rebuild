import test from 'node:test'
import assert from 'node:assert/strict'
import { fixClassData } from '../src/runtime/class-fixes.ts'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseScriptFile } from '../src/pbscript/parser.ts'
import type { Routine, Stmt } from '../src/pbscript/ast.ts'
import { LOOKUP_CRITERIA_WINDOWS, REFERENCE_CRITERIA_WINDOWS, NUMERIC_CRITERIA_WINDOWS, DATE_OPTION_CRITERIA_WINDOWS, DATE_CHOICE_CRITERIA_WINDOWS } from '../src/ui/window-surfaces.ts'

function removeDateGuards(body: Stmt[], count: number): void {
  const at = body.findIndex((node) => node.k === 'decl' && node.vars.some((variable) => variable.n === 'ldt_criteria_checked'))
  assert.ok(at >= 0)
  const guards = body.splice(at, count + 1).slice(1)
  assert.equal(guards.length, count)
  for (const guard of guards) {
    assert.ok(guard.k === 'if' && guard.c.k === 'bin' && guard.c.op === '<>' &&
      guard.c.l.k === 'call' && guard.c.l.n === 'getdata')
    assert.deepEqual(guard.c.l.a, [{ k: 'id', n: 'ldt_criteria_checked' }])
    assert.match(JSON.stringify(guard.t), /"messagebox"/)
    assert.match(JSON.stringify(guard.t), /"setfocus"/)
    assert.equal(guard.t.at(-1)?.k, 'return')
  }
}

for (const name of ['w_arg_activeclass_single', 'w_arg_letter_sdate_ldate', 'w_arg_pricetype_markup',
  'w_arg_sdate_ldate_margin_markup_range', 'w_arg_quotation_customer_remarks', 'w_arg_percentage_reduce_raise',
  'w_arg_zone_sdate_ldate_top_n_customer', 'w_sale_replace_custref']) {
  test(`${name}: rejected criteria drafts cannot reach original validation or return scripts`, () => {
    const library = name === 'w_sale_replace_custref' ? 'salerespwin' :
      name === 'w_arg_zone_sdate_ldate_top_n_customer' ? 'reports_cust' : 'reports'
    const { file, errors } = parseScriptFile(readFileSync(resolve(import.meta.dirname, '..', '..', 'data', 'src',
      'scripts', library, name + '.pbs'), 'utf8'))
    assert.deepEqual(errors, [])
    const routines: Record<string, Record<string, Routine[]>> = {}
    for (const routine of file.routines) ((routines[routine.owner] ??= {})[routine.name] ??= []).push(routine)
    const data = { routines }, original = structuredClone(data)
    const dateReads = original.routines.cb_ok.clicked[0].body.filter((node) => node.k === 'expr' &&
      node.e.k === 'call' && node.e.n === 'getdata').length
    const changes = [...(dateReads ? ['criteria date acceptance guards'] : []), 'criteria acceptance guard']
    if (['w_arg_pricetype_markup', 'w_arg_quotation_customer_remarks'].includes(name)) changes.push('criteria retrieval failure guard')
    if (name === 'w_arg_pricetype_markup') changes.push('price type null validation')
    if (name === 'w_sale_replace_custref') changes.push('customer reference cancellation default')
    assert.deepEqual(fixClassData(name, data), changes)
    assert.deepEqual(fixClassData(name, data), [], 'Loading a fixed class is idempotent')
    const body = data.routines.cb_ok.clicked[0].body
    const controls = name === 'w_sale_replace_custref' ? ['dw_replace_custref'] :
      name === 'w_arg_quotation_customer_remarks' ? ['dw_selection'] :
        name === 'w_arg_zone_sdate_ldate_top_n_customer' ? ['dw_control', 'dw_custcount'] : ['dw_control']
    for (const control of controls) {
      const guard = body.find((node) => node.k !== 'decl')!
      assert.equal(guard.k, 'if')
      assert.match(JSON.stringify(guard), /"accepttext"/)
      assert.match(JSON.stringify(guard), new RegExp(`"${control}"`))
      body.splice(body.indexOf(guard), 1)
    }
    if (dateReads) removeDateGuards(body, dateReads)
    if (name === 'w_sale_replace_custref') {
      const open = data.routines[name].open[0].body
      const initial = open.find((node) => node.k !== 'decl')!
      assert.ok(initial.k === 'assign' && initial.r.k === 'num')
      assert.equal(initial.r.v, -1)
      assert.match(JSON.stringify(initial.l), /"doubleparm"/)
      open.splice(open.indexOf(initial), 1)
    }
    if (changes.includes('criteria retrieval failure guard')) {
      const open = data.routines[name].open[0].body
      const at = open.findIndex((node) => node.k === 'if' && node.c.k === 'bin' && node.c.op === '<' &&
        node.c.l.k === 'call' && node.c.l.n === 'retrieve')
      const failure = open[at]
      assert.ok(failure.k === 'if' && failure.c.k === 'bin')
      open[at] = { k: 'expr', e: failure.c.l }
    }
    if (name === 'w_arg_pricetype_markup') {
      const valid = body.find((node) => node.k === 'if' && node.c.k === 'bin' && node.c.op === 'or' &&
        node.c.l.k === 'call' && node.c.l.n === 'isnull')
      assert.ok(valid?.k === 'if' && valid.c.k === 'bin')
      valid.c = valid.c.r
    }
    assert.deepEqual(data, original, 'Every original validation, event, return and cancellation remains unchanged')
    assert.deepEqual(fixClassData(name, data), changes)
    assert.deepEqual(fixClassData(name, data), [], 'Loading a fixed class is idempotent')
    assert.deepEqual(fixClassData(name, { routines: {} }), [])
    assert.deepEqual(fixClassData('unrelated_criteria', original), [])
  })
}

test('packing selection guards both acceptance paths and initializes only its numeric cancellation channel', () => {
  const { file, errors } = parseScriptFile(readFileSync(resolve(import.meta.dirname, '..', '..', 'data', 'src',
    'scripts', 'packingmodule', 'w_select_case.pbs'), 'utf8'))
  assert.deepEqual(errors, [])
  const routines: Record<string, Record<string, Routine[]>> = {}
  for (const routine of file.routines) ((routines[routine.owner] ??= {})[routine.name] ??= []).push(routine)
  const data = { routines }, original = structuredClone(data)
  assert.deepEqual(fixClassData('w_select_case', data),
    ['criteria acceptance guard', 'packing cancellation default', 'packing return acceptance guard', 'criteria retrieval failure guard'])
  assert.deepEqual(data.routines.w_select_case.close, original.routines.w_select_case.close)
  assert.match(JSON.stringify(data.routines.w_select_case.ue_close), /"accepttext"/)
  assert.match(JSON.stringify(data.routines.w_select_case.ue_close), /"packlayoutcode"/)
  assert.deepEqual(data.routines.w_select_case.ue_close[0].body.at(-1), original.routines.w_select_case.ue_close[0].body.at(-1))
  assert.deepEqual(fixClassData('w_select_case', data), [])
  assert.deepEqual(fixClassData('w_select_case', { routines: {} }), [])
})

test('item-selection guards only the count draft and failed retrievals, preserving the original selector routines', () => {
  const name = 'w_arg_items_sdate_ldate_topn'
  const { file, errors } = parseScriptFile(readFileSync(resolve(import.meta.dirname, '..', '..', 'data', 'src',
    'scripts', 'reports', name + '.pbs'), 'utf8'))
  assert.deepEqual(errors, [])
  const routines: Record<string, Record<string, Routine[]>> = {}
  for (const routine of file.routines) ((routines[routine.owner] ??= {})[routine.name] ??= []).push(routine)
  const data = { routines }, original = structuredClone(data)
  assert.deepEqual(fixClassData(name, data), [
    'criteria date acceptance guards', 'criteria acceptance guard', 'item selection cancellation default', 'item selection retrieval guards (2)',
  ])
  assert.deepEqual(fixClassData(name, data), [])
  assert.equal((JSON.stringify(data).match(/"n":"messagebox"/g) ?? []).length,
    (JSON.stringify(original).match(/"n":"messagebox"/g) ?? []).length + 3,
  'Both date guards and the headless DataStore failure gain feedback; visible DataWindows keep their own DBError')
  const clicked = routines.cb_ok.clicked[0].body
  const guard = clicked.find((node) => node.k !== 'decl')!
  assert.match(JSON.stringify(guard), /"dw_custcount"/)
  assert.doesNotMatch(JSON.stringify(guard), /"dw_selected"/)
  clicked.splice(clicked.indexOf(guard), 1)
  removeDateGuards(clicked, 2)
  const open = routines[name].open[0].body
  const initial = open.find((node) => node.k !== 'decl')!
  assert.match(JSON.stringify(initial), /"powerobjectparm"/)
  assert.match(JSON.stringify(initial), /"istr_arg"/)
  open.splice(open.indexOf(initial), 1)
  let guarded = 0
  for (let at = 0; at < open.length; at++) {
    const node = open[at]
    if (node.k !== 'if' || node.c.k !== 'bin' || node.c.l.k !== 'call' || node.c.l.n !== 'retrieve') continue
    assert.equal(node.c.op, '<')
    assert.match(JSON.stringify(node.t), /"closewithreturn"/)
    open[at] = { k: 'expr', e: node.c.l }
    guarded++
  }
  assert.equal(guarded, 2)
  assert.deepEqual(data, original)
  assert.deepEqual(fixClassData(name, { routines: {} }), [])
})

for (const name of ['w_arg_sdate', 'w_arg_sdate_notime', 'w_arg_sdate_ldate',
  ...DATE_OPTION_CRITERIA_WINDOWS.map((owner) => owner.name),
  ...DATE_CHOICE_CRITERIA_WINDOWS.filter((owner) => !owner.price).map((owner) => owner.name)]) {
  test(`${name}: native date guards and cancellation initialization preserve every original routine`, () => {
    const { file, errors } = parseScriptFile(readFileSync(resolve(import.meta.dirname, '..', '..', 'data', 'src',
      'scripts', 'reports', name + '.pbs'), 'utf8'))
    assert.deepEqual(errors, [])
    const routines: Record<string, Record<string, Routine[]>> = {}
    for (const routine of file.routines) ((routines[routine.owner] ??= {})[routine.name] ??= []).push(routine)
    const data = { routines }, original = structuredClone(data)
    assert.deepEqual(fixClassData(name, data), ['criteria date acceptance guards', 'date criteria cancellation default'])
    assert.deepEqual(fixClassData(name, data), [])
    removeDateGuards(routines.cb_ok.clicked[0].body, ['w_arg_sdate', 'w_arg_sdate_notime', 'w_arg_ason'].includes(name) ? 1 : 2)
    const open = routines[name].open[0].body
    const at = open.findIndex((node) => node.k !== 'decl')
    assert.match(JSON.stringify(open[at]), /"powerobjectparm"/)
    assert.match(JSON.stringify(open[at]), /"istr_arg"/)
    open.splice(at, 1)
    if (!original.routines[name].open) {
      assert.deepEqual(open[0], { k: 'expr', e: { k: 'super', n: 'open', a: [] } })
      assert.equal(open.length, 2)
      delete routines[name].open
    }
    assert.deepEqual(data, original)
    assert.deepEqual(fixClassData(name, { routines: {} }), [])
  })
}

for (const [name] of [...LOOKUP_CRITERIA_WINDOWS,
  ...DATE_CHOICE_CRITERIA_WINDOWS.filter((owner) => owner.price).map((owner) => [owner.name])]) {
  test(`${name}: acceptance, dates and cancellation guards preserve the complete original lookup workflow`, () => {
    const { file, errors } = parseScriptFile(readFileSync(resolve(import.meta.dirname, '..', '..', 'data', 'src',
      'scripts', 'reports', name + '.pbs'), 'utf8'))
    assert.deepEqual(errors, [])
    const routines: Record<string, Record<string, Routine[]>> = {}
    for (const routine of file.routines) ((routines[routine.owner] ??= {})[routine.name] ??= []).push(routine)
    const data = { routines }, original = structuredClone(data)
    const dates = original.routines.cb_ok.clicked[0].body.filter((node) =>
      node.k === 'expr' && node.e.k === 'call' && node.e.n === 'getdata').length
    const retrieval = name === 'w_arg_antinortixitem_sdate_ldate'
    assert.deepEqual(fixClassData(name, data), [
      ...(dates ? ['criteria date acceptance guards'] : []), 'criteria acceptance guard',
      'date criteria cancellation default', ...(retrieval ? ['criteria retrieval failure guard'] : []),
    ])
    assert.deepEqual(fixClassData(name, data), [])
    const body = routines.cb_ok.clicked[0].body
    const accepted = body.findIndex((node) => node.k !== 'decl')
    assert.match(JSON.stringify(body[accepted]), /"accepttext"/)
    assert.match(JSON.stringify(body[accepted]), DATE_CHOICE_CRITERIA_WINDOWS.some((owner) => owner.name === name) ?
      /"dw_price"/ : /"dw_control"/)
    body.splice(accepted, 1)
    if (dates) removeDateGuards(body, dates)
    const open = routines[name].open[0].body
    const initial = open.findIndex((node) => node.k !== 'decl')
    assert.match(JSON.stringify(open[initial]), /"powerobjectparm"/)
    assert.match(JSON.stringify(open[initial]), /"istr_arg"/)
    open.splice(initial, 1)
    if (retrieval) {
      const at = open.findIndex((node) => node.k === 'if' && node.c.k === 'bin' &&
        node.c.l.k === 'call' && node.c.l.n === 'retrieve')
      const guard = open[at]
      assert.ok(guard.k === 'if' && guard.c.k === 'bin')
      assert.match(JSON.stringify(guard.t), /"closewithreturn"/)
      open[at] = { k: 'expr', e: guard.c.l }
    }
    assert.deepEqual(data, original)
    assert.deepEqual(fixClassData(name, { routines: {} }), [])
  })
}

for (const [name] of [...REFERENCE_CRITERIA_WINDOWS, ...NUMERIC_CRITERIA_WINDOWS]) {
  test(`${name}: scalar acceptance and cancellation guards preserve the owner script`, () => {
    const { file, errors } = parseScriptFile(readFileSync(resolve(import.meta.dirname, '..', '..', 'data', 'src',
      'scripts', 'reports', name + '.pbs'), 'utf8'))
    assert.deepEqual(errors, [])
    const routines: Record<string, Record<string, Routine[]>> = {}
    for (const routine of file.routines) ((routines[routine.owner] ??= {})[routine.name] ??= []).push(routine)
    const data = { routines }, original = structuredClone(data)
    assert.deepEqual(fixClassData(name, data), ['criteria acceptance guard', 'date criteria cancellation default'])
    assert.deepEqual(fixClassData(name, data), [])
    const body = routines.cb_ok.clicked[0].body
    const accepted = body.findIndex((node) => node.k !== 'decl')
    assert.match(JSON.stringify(body[accepted]), /"accepttext"/)
    assert.match(JSON.stringify(body[accepted]), /"dw_control"/)
    body.splice(accepted, 1)
    const open = routines[name].open[0].body
    const initial = open.findIndex((node) => node.k !== 'decl')
    assert.match(JSON.stringify(open[initial]), /"powerobjectparm"/)
    assert.match(JSON.stringify(open[initial]), /"istr_arg"/)
    open.splice(initial, 1)
    assert.deepEqual(data, original)
    assert.deepEqual(fixClassData(name, { routines: {} }), [])
    const validatesNull = ['w_arg_containerno', 'w_arg_ref', 'w_arg_smscenter'].includes(name)
    assert.equal(JSON.stringify(original.routines.cb_ok.clicked[0].body).includes('"isnull"'), validatesNull)
  })
}

test('the f_validatedw fix gates on the row filled by the first FindRequired call', () => {
  const findRequired = () => ({ k: 'call', o: { k: 'id', n: 'adw_control' }, n: 'findrequired', a: [] })
  const body = [
    { k: 'if', c: { k: 'bin', op: '<', l: findRequired(), r: { k: 'num', v: 0, dec: false } }, t: [], ei: [] },
    { k: 'if', c: { k: 'bin', op: '=', l: findRequired(), r: { k: 'num', v: 1, dec: false } }, t: [], ei: [] },
    { k: 'return', e: { k: 'num', v: 1, dec: false } },
  ]
  const data = { routines: { f_validatedw: { f_validatedw: [{ body }] } } }

  assert.deepEqual(fixClassData('f_validatedw', data), ['required-field gate'])
  const gate = body[1] as unknown as { c: { op: string; l: { n: string }; r: { v: number } } }
  assert.equal(gate.c.op, '<>')
  assert.equal(gate.c.l.n, 'll_row')
  assert.equal(gate.c.r.v, 0)

  // Idempotent: a second pass leaves the corrected gate alone.
  assert.deepEqual(fixClassData('f_validatedw', data), [])
})

test('cashier activity and change password treat SQLCode 100 as no rows, not a database error', () => {
  const parse = (library: string, name: string) => {
    const { file, errors } = parseScriptFile(readFileSync(resolve(import.meta.dirname, '..', '..', 'data', 'src', 'scripts', library, name + '.pbs'), 'utf8'))
    assert.deepEqual(errors, [])
    const routines: Record<string, Record<string, Routine[]>> = {}
    for (const routine of file.routines) ((routines[routine.owner] ??= {})[routine.name] ??= []).push(routine)
    return { routines }
  }
  const cashier = parse('cashierjob', 'w_cashieractivitymonitor')
  assert.deepEqual(fixClassData('w_cashieractivitymonitor', cashier), ['w_cashieractivitymonitor.open treats SQLCode 100 as no rows'])
  assert.match(JSON.stringify(cashier.routines.w_cashieractivitymonitor.open[0].body), /"v":100/)
  assert.deepEqual(fixClassData('w_cashieractivitymonitor', cashier), [])

  const password = parse('components', 'w_changepassword')
  assert.deepEqual(fixClassData('w_changepassword', password), ['cb_ok.clicked treats SQLCode 100 as no rows'])
  const passwordBody = password.routines.cb_ok.clicked[0].body
  assert.match(JSON.stringify(passwordBody), /"v":100/)
  const selectGate = passwordBody.find((node) => node.k === 'if' && JSON.stringify(node.c).includes('sqlcode'))!
  assert.match(JSON.stringify(selectGate.ei?.[0]?.c), /"v":100/)
  assert.deepEqual(fixClassData('w_changepassword', password), [])
})

test('the required-field message falls back to the column name when Describe returns !', () => {
  const { file, errors } = parseScriptFile(readFileSync(resolve(import.meta.dirname, '..', '..', 'data', 'src', 'scripts', 'functions', 'f_validatedw.pbs'), 'utf8'))
  assert.deepEqual(errors, [])
  const routines: Record<string, Record<string, Routine[]>> = {}
  for (const routine of file.routines) ((routines[routine.owner] ??= {})[routine.name] ??= []).push(routine)
  const data = { routines }
  assert.deepEqual(fixClassData('f_validatedw', data), ['required-field gate'])
  const body = data.routines.f_validatedw.f_validatedw[0].body
  assert.match(JSON.stringify(body), /"ls_textname".*"v":"!".*"ls_colname"/)
  assert.match(JSON.stringify(body), /"messagebox".*"ls_textname"/)
  assert.deepEqual(fixClassData('f_validatedw', data), [])
})

test('the f_validatedw fix leaves a class without the duplicated gate untouched', () => {
  const body = [{ k: 'return', e: { k: 'num', v: 1, dec: false } }]
  const data = { routines: { f_validatedw: { f_validatedw: [{ body }] } } }
  assert.deepEqual(fixClassData('f_validatedw', data), [])
  assert.deepEqual(body, [{ k: 'return', e: { k: 'num', v: 1, dec: false } }])
})

test('the journal voucher fix removes the decompiler trailing save return', () => {
  const inner = { k: 'if', c: { k: 'bin', op: '<', l: { k: 'id', n: 'll_credit' }, r: { k: 'num', v: 1, dec: false } }, t: [{ k: 'return' }], ei: [] }
  const outer = {
    k: 'if',
    c: { k: 'bin', op: '=', l: { k: 'mem', o: { k: 'id', n: 'this' }, n: 'ii_vouchertype' }, r: { k: 'num', v: 5, dec: false } },
    t: [inner, { k: 'return' }],
    ei: [],
  }
  const body = [outer]
  const data = { routines: { w_journalvoucher: { ue_save: [{ body }] } } }

  assert.deepEqual(fixClassData('w_journalvoucher', data), ['journal voucher save returns (1)'])
  assert.deepEqual(outer.t, [inner])
  // Idempotent: the trailing return is gone.
  assert.deepEqual(fixClassData('w_journalvoucher', data), [])
})

test('cashier closing removes only three decompiler fall-through returns, preserving all validation and rollback branches', () => {
  const { file, errors } = parseScriptFile(readFileSync(resolve(import.meta.dirname, '..', '..', 'data', 'src',
    'scripts', 'cashierjob', 'w_cashiershift_closing.pbs'), 'utf8'))
  assert.deepEqual(errors, [])
  const routines: Record<string, Record<string, Routine[]>> = {}
  for (const routine of file.routines) ((routines[routine.owner] ??= {})[routine.name] ??= []).push(routine)
  const data = { routines }, saved = structuredClone(data)
  const returned = (value: unknown): Stmt[] => {
    if (!value || typeof value !== 'object') return []
    const node = value as Stmt
    return node.k === 'return' ? [node] : Object.values(value).flatMap(returned)
  }
  const before = returned(data)
  assert.deepEqual(fixClassData('w_cashiershift_closing', data),
    ['cashier shift close returns (3)', 'cashier shift deferred update flags (2)'])
  const after = returned(data)
  assert.equal(before.length - after.length, 3)
  assert.deepEqual(after.filter((node) => node.k === 'return' && node.e), before.filter((node) => node.k === 'return' && node.e))
  for (const [owner, entries] of Object.entries(data.routines)) {
    for (const [name, value] of Object.entries(entries)) {
      if (owner !== 'cb_ok' || name !== 'clicked') assert.deepEqual(value, saved.routines[owner][name])
    }
  }
  assert.deepEqual(fixClassData('w_cashiershift_closing', data), [])
  assert.deepEqual(fixClassData('w_cashiershift_closing', { routines: {} }), [])
})

test('cashier category hardening is scoped, idempotent and retains original calculations and procedure arguments', () => {
  const name = 'w_cashierjobactivity_changecategory'
  const { file, errors } = parseScriptFile(readFileSync(resolve(import.meta.dirname, '..', '..', 'data', 'src',
    'scripts', 'cashierjob', name + '.pbs'), 'utf8'))
  assert.deepEqual(errors, [])
  const routines: Record<string, Record<string, Routine[]>> = {}
  for (const routine of file.routines) ((routines[routine.owner] ??= {})[routine.name] ??= []).push(routine)
  const data = { routines }, original = structuredClone(data)
  const nodes = (value: unknown): Record<string, unknown>[] => value && typeof value === 'object' ?
    [value as Record<string, unknown>, ...Object.values(value).flatMap(nodes)] : []
  const procedures = (value: unknown) => nodes(value).filter((node) => node.k === 'call' &&
    ['insert_cashieractivity', 'supervise_cashieractivity'].includes(String(node.n)))
  const before = structuredClone(procedures(data))
  assert.deepEqual(fixClassData(name, data), [
    'cashier category acceptance guard', 'cashier category deferred update flags (1)', 'cashier category failed-update rollback',
    'cashier category commit guards (3)', 'cashier category failed-open returns (4)',
    'cashier category group-query guard', 'cashier category retrieve guard',
    'cashier category permissions guard', 'cashier category permission-query guard',
  ])
  assert.deepEqual(procedures(data), before)
  assert.deepEqual(data.routines.dw_control, original.routines.dw_control)
  assert.deepEqual(data.routines.cb_cancel, original.routines.cb_cancel)
  assert.deepEqual(data.routines[name].wf_setbalance, original.routines[name].wf_setbalance)
  assert.equal(nodes(data).filter((node) => node.k === 'sql' && node.kind === 'commit').length, 3)
  assert.equal(nodes(data).filter((node) => node.k === 'try').length, 3)
  assert.deepEqual(fixClassData(name, data), [])
  assert.deepEqual(fixClassData(name, { routines: {} }), [])
  const other = structuredClone(original)
  assert.deepEqual(fixClassData('unrelated_window', other), [])
  assert.deepEqual(other, original)
})
