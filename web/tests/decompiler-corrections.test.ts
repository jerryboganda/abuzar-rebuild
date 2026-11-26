import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseScriptFile } from '../src/pbscript/parser.ts'
import type { Routine, Stmt } from '../src/pbscript/ast.ts'

// Regression checks for the corrected decompiler output (stray returns, inverted
// conditions and dangling gotos) merged into data/src/scripts on 2026-11-27.

const SCRIPTS = resolve(import.meta.dirname, '..', '..', 'data', 'src', 'scripts')

function routine(library: string, name: string, owner: string, event: string): Routine {
  const { file, errors } = parseScriptFile(readFileSync(resolve(SCRIPTS, library, name + '.pbs'), 'utf8'))
  assert.deepEqual(errors, [])
  const found = file.routines.find((r) => r.owner === owner && r.name === event)
  assert.ok(found, `${owner}.${event}`)
  return found
}

type Guard = { cond: string; branch: 'then' | 'elseif' | 'else' }

/** Each statement matching `pred`, with the chain of `if` branches enclosing it (outermost first). */
function guarded(body: Stmt[], pred: (s: Stmt) => boolean): Guard[][] {
  const out: Guard[][] = []
  const walk = (list: Stmt[] | undefined, path: Guard[]): void => {
    for (const s of list ?? []) {
      if (pred(s)) out.push(path)
      if (s.k === 'if') {
        const cond = JSON.stringify(s.c)
        walk(s.t, [...path, { cond, branch: 'then' }])
        for (const ei of s.ei) walk(ei.b, [...path, { cond: JSON.stringify(ei.c), branch: 'elseif' }])
        walk(s.e, [...path, { cond, branch: 'else' }])
      } else {
        for (const v of Object.values(s)) if (Array.isArray(v) && v.every((x) => x && typeof x === 'object' && 'k' in x)) walk(v as Stmt[], path)
        if (s.k === 'choose') for (const c of (s as { cs: { b: Stmt[] }[] }).cs) walk(c.b, path)
      }
    }
  }
  walk(body, [])
  return out
}

const mentions = (text: string) => (s: Stmt): boolean => (s.k === 'assign' || s.k === 'expr') && JSON.stringify(s).includes(text)

test('no script keeps a decompiler goto or label', () => {
  const left: string[] = []
  for (const lib of readdirSync(SCRIPTS, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)) {
    for (const f of readdirSync(resolve(SCRIPTS, lib))) {
      if (!f.endsWith('.pbs')) continue
      readFileSync(resolve(SCRIPTS, lib, f), 'utf8').split('\n').forEach((line, i) => {
        if (/^\s*(goto\s+\w+|L\d+:)\s*$/.test(line)) left.push(`${lib}/${f}:${i + 1}`)
      })
    }
  }
  assert.deepEqual(left, [])
})

test('bill summary reports a balance error only when the balance lookup fails', () => {
  const body = routine('billsummary', 'w_billsummary', 'w_billsummary', 'wf_savedetail').body
  const errors = guarded(body, mentions('Problem in fetching Sale Invoice Balance'))
  assert.equal(errors.length, 1)
  const inner = errors[0].at(-1)!
  assert.equal(inner.branch, 'then')
  assert.match(inner.cond, /"op":"<>".*"v":0/)
  assert.match(inner.cond, /sqlcode/)
  const lookups = guarded(body, (s) => s.k === 'expr' && JSON.stringify(s).includes('getsaleinvbalance'))
  assert.equal(lookups.length, 1)
  assert.equal(lookups[0].at(-1)!.branch, 'else')
})

test('bill summary commit reports a balance retrieval error only on the failure branch', () => {
  const { file } = parseScriptFile(readFileSync(resolve(SCRIPTS, 'billsummary', 'w_billsummary.pbs'), 'utf8'))
  const hits = file.routines.flatMap((r) => guarded(r.body, mentions('Balance Retrieval Error')))
  assert.equal(hits.length, 1)
  assert.equal(hits[0].at(-1)!.branch, 'else')
})

test('duplicate-code check reports a duplicate only when a matching row is found', () => {
  const { file, errors } = parseScriptFile(readFileSync(resolve(SCRIPTS, 'functions', 'vf_dwdupcode2.pbs'), 'utf8'))
  assert.deepEqual(errors, [])
  const hits = file.routines.flatMap((r) => guarded(r.body, (s) => s.k === 'assign' && JSON.stringify(s.l).includes('"yesno"') &&
    JSON.stringify(s.r).includes('"true"')))
  assert.ok(hits.length >= 2)
  assert.ok(hits.some((path) => path.at(-1)!.branch === 'then' && /rt_code/.test(path.at(-1)!.cond) && /"op":"<>"/.test(path.at(-1)!.cond)))
})

test('sale-order enforcement aborts only when the bonus or discount differs', () => {
  const { file } = parseScriptFile(readFileSync(resolve(SCRIPTS, 'salewin', 'w_sale.pbs'), 'utf8'))
  for (const [text, column, op] of [['item bonus qty exceeds', 'bonusqty', '>'], ['item discount % does not match', 'discperc', '<>']]) {
    const hits = file.routines.flatMap((r) => guarded(r.body, mentions(text)))
    assert.ok(hits.length >= 1, text)
    for (const path of hits) {
      const inner = path.at(-1)!
      assert.equal(inner.branch, 'then', text)
      assert.ok(inner.cond.includes(`"${column}"`) && inner.cond.includes(`"op":"${op}"`), text)
    }
  }
})

test('remote DataWindow date parsing accepts a split between non-numeric characters', () => {
  const { file } = parseScriptFile(readFileSync(resolve(SCRIPTS, 'pbdwr125', 'nv_remote_datawindow.pbs'), 'utf8'))
  const hits = file.routines.flatMap((r) => guarded(r.body, (s) => s.k === 'assign' && JSON.stringify(s.l).includes('lb_datetime_found') &&
    JSON.stringify(s.r).includes('"true"')))
  assert.equal(hits.length, 2)
  assert.deepEqual(hits.map((p) => p.at(-1)!.branch).sort(), ['else', 'then'])
  assert.ok(hits.some((p) => p.at(-1)!.branch === 'then' && p.at(-1)!.cond.includes('"not"')))
})

test('save and close handlers keep no decompiler fall-through return after a passed validation', () => {
  const cases: [string, string, string, string, string[]][] = [
    ['salewin', 'w_sale', 'w_sale', 'ue_save', ['SaleOnZeroPrice', 'AllowSaleAboveRetailPriceInSale', 'ApplySalesTaxOnSavingBeforeUserPwd', 'PreserveSaleInvHistory', 'SaveBalanceOnSalePosting']],
    ['purchasecomponents', 'w_purchase', 'w_purchase', 'ue_save', ['ForceUniqueSuppInvNoInPur', 'forceuniquegrnnoinpur', 'ls_expiry', 'ld_expiry']],
    ['accountsext', 'w_journalvoucher', 'w_journalvoucher', 'ue_save', ['ii_vouchertype']],
    ['cashierjob', 'w_cashiershift_closing', 'cb_ok', 'clicked', ['dw_figures', 'dw_cash']],
  ]
  for (const [lib, name, owner, event, markers] of cases) {
    const body = routine(lib, name, owner, event).body
    const spurious: string[] = []
    const walk = (o: unknown): void => {
      if (Array.isArray(o)) { o.forEach(walk); return }
      if (!o || typeof o !== 'object') return
      const s = o as { k?: string; c?: unknown; t?: Stmt[] }
      if (s.k === 'if' && s.t?.length && s.t.at(-1)!.k === 'return' && !(s.t.at(-1) as { e?: unknown }).e &&
        s.t.some((n) => n.k === 'if') && markers.some((m) => JSON.stringify(s.c).includes(m))) spurious.push(JSON.stringify(s.c).slice(0, 80))
      Object.values(o).forEach(walk)
    }
    walk(body)
    assert.deepEqual(spurious, [], name)
  }
})
