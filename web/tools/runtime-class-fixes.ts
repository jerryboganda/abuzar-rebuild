// Runtime corrections that the decompiled class data cannot express yet.
//
// The recovered scripts lost a few initialisers, enum contracts and the
// post-decompile compensation for item entry.  These are applied after every
// class build so a rebuild cannot silently remove them.  The same function is
// safe to run repeatedly.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, normalize } from 'node:path'

type Json = any

const id = (n: string): Json => ({ k: 'id', n })
const mem = (o: Json, n: string): Json => ({ k: 'mem', o, n })
const str = (v: string): Json => ({ k: 'str', v })
const num = (v: number): Json => ({ k: 'num', v, dec: false })
const call = (o: Json, n: string, a: Json[]): Json => ({ k: 'call', o, n, a })
const expr = (e: Json): Json => ({ k: 'expr', e })
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T

function load(out: string, name: string): Json | null {
  const p = join(out, name)
  if (!existsSync(p)) return null
  try {
    return JSON.parse(readFileSync(p, 'utf8'))
  } catch {
    return null
  }
}

function save(out: string, name: string, data: Json): void {
  const text = JSON.stringify(data)
  writeFileSync(join(out, name), text)
  // the deployed bundle has a separate generated copy
  const n = normalize(out).replace(/\\/g, '/')
  if (n.endsWith('/public/data/classes')) {
    const d = join(dirname(dirname(dirname(out))), 'dist', 'data', 'classes')
    if (existsSync(d)) writeFileSync(join(d, name), text)
  }
}

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
    const r = findStatusCall(v as Json, col)
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
          k: 'bin',
          op: 'or',
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
        k: 'bin',
        op: 'or',
        l: { k: 'bin', op: '=', l: left, r: { k: 'enum', v: 'notmodified!' } },
        r: { k: 'bin', op: '=', l: clone(left), r: { k: 'enum', v: 'new!' } },
      }
    }
  }
  return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, widenStatus(v, cols, counter)]))
}

function fixMultiEntry(body: Json): boolean {
  if (!Array.isArray(body)) return false
  if (body.some((n) => n?.k === 'expr' && JSON.stringify(n).includes('ll_rowmain') && JSON.stringify(n).includes('"stock"'))) return false
  const parent3 = mem(mem(mem(id('parent'), 'parent'), 'parent'), 'id_detail')
  const list3 = mem(mem(mem(id('parent'), 'parent'), 'parent'), 'id_itemslist')
  const node = expr(call(parent3, 'setitem', [
    id('ll_rowmain'),
    str('stock'),
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

function fixValidatedW(data: Json): boolean {
  const body = data.routines?.f_validatedw?.f_validatedw?.[0]?.body
  if (!Array.isArray(body)) return false
  const find = body.find((n) => n?.k === 'if' && JSON.stringify(n.c || {}).includes('findrequired'))
  const target = body.find((n) => n?.k === 'if' && JSON.stringify(n.c || {}).includes('ll_row') && !JSON.stringify(n.c || {}).includes('findrequired'))
  if (!find || !target) return false
  target.c = { k: 'bin', op: '=', l: clone(find.c.l), r: num(1) }
  return true
}

/** Apply all runtime class corrections to `out`. Returns one message per change. */
export function applyRuntimeClassFixes(out: string): string[] {
  const messages: string[] = []

  const wm = load(out, 'w_multi_entry.json')
  if (wm && fixMultiEntry(wm.routines?.dw_itemslist?.clicked?.[0]?.body)) {
    save(out, 'w_multi_entry.json', wm)
    messages.push('w_multi_entry: item-list stock transfer')
  }

  const ws = load(out, 'w_sale.json')
  if (ws) {
    const body = ws.routines?.w_sale?.wf_inititeminfo?.[0]?.body
    if (Array.isArray(body)) {
      // retflag must be initialised after its declaration
      for (let i = body.length - 1; i >= 0; i--) {
        const n = body[i]
        if (n?.k === 'assign' && n.l?.n === 'retflag' && n.r?.n === 'true') body.splice(i, 1)
      }
      let at = 0
      while (at < body.length && body[at]?.k === 'decl') at++
      body.splice(at, 0, { k: 'assign', l: id('retflag'), op: '=', r: id('true') })

      // stock fallback from the detail value set by the item list
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
            k: 'if',
            c: { k: 'bin', op: '>', l: detailStock(), r: num(0) },
            t: [{ k: 'assign', l: id('ld_godownstock'), op: '=', r: detailStock() }],
            ei: [],
          })
          messages.push('w_sale: stock fallback')
        }
      }

      const counter = { n: 0 }
      const normalized = normalizeStatusOr(body)
      const widened = widenStatus(normalized, new Set(['saleprice', 'discperc']), counter)
      ws.routines.w_sale.wf_inititeminfo[0].body = normalizeStatusOr(widened)
      if (counter.n) messages.push(`w_sale: ${counter.n} default gate(s)`)

      // The decompiler added unconditional `return`s at the end of several
      // preference/validation blocks in ue_save.  They abort saving even when
      // the nested check passed.  Remove only the trailing return of a block
      // that already contains a nested if with its own return.
      const saveBody = ws.routines?.w_sale?.ue_save?.[0]?.body
      if (Array.isArray(saveBody)) {
        const markers = ['SaleOnZeroPrice', 'AllowSaleAboveRetailPriceInSale', 'ApplySalesTaxOnSavingBeforeUserPwd', 'PreserveSaleInvHistory', 'SaveBalanceOnSalePosting']
        let removed = 0
        const walkSave = (o: Json): void => {
          if (Array.isArray(o)) { for (const v of o) walkSave(v); return }
          if (!o || typeof o !== 'object') return
          if (o.k === 'if' && Array.isArray(o.t) && o.t.length && o.t[o.t.length - 1]?.k === 'return') {
            const cond = JSON.stringify(o.c || {})
            if (markers.some((m) => cond.includes(m)) && o.t.some((n: Json) => n?.k === 'if')) {
              while (o.t.length && o.t[o.t.length - 1]?.k === 'return') o.t.pop()
              removed++
            }
          }
          if (o.k === 'choose' && Array.isArray(o.cs)) {
            for (const c of o.cs) {
              const b = c?.b
              if (Array.isArray(b) && b.length && b[b.length - 1]?.k === 'return' && b.some((n: Json) => n?.k === 'if')) {
                while (b.length && b[b.length - 1]?.k === 'return') b.pop()
                removed++
              }
            }
          }
          for (const v of Object.values(o)) walkSave(v)
        }
        walkSave(saveBody)
        if (removed) messages.push(`w_sale: removed ${removed} spurious save return(s)`)
      }

      const ue = ws.routines?.dw_itemsdetail?.ue_enterkey?.[0]?.body
      if (Array.isArray(ue) && !JSON.stringify(ue).includes('wf_grandtotal')) {
        let p = 0
        while (p < ue.length && ue[p]?.k === 'decl') p++
        ue.splice(p, 0, expr(call(null, 'wf_grandtotal', [])))
        messages.push('w_sale: Enter refreshes footer')
      }

      // `long ll_retcode = 1` lost its initialiser in decompilation; an empty
      // refused-sale list then reported failure and blocked Save And Post.
      const refused = ws.routines?.w_sale?.wf_save_refusedsale?.[0]?.body
      if (Array.isArray(refused) && !refused.some((n) => n?.k === 'assign' && n.l?.n === 'll_retcode')) {
        let p = 0
        while (p < refused.length && refused[p]?.k === 'decl') p++
        refused.splice(p, 0, { k: 'assign', l: id('ll_retcode'), op: '=', r: num(1) })
        messages.push('w_sale: refused-sale result initialiser')
      }
    }
    save(out, 'w_sale.json', ws)
  }


  const wp = load(out, 'w_purchase.json')
  if (wp) {
    const saveBody = wp.routines?.w_purchase?.ue_save?.[0]?.body
    if (Array.isArray(saveBody)) {
      const n = removeSpuriousReturns(saveBody, ['ForceUniqueSuppInvNoInPur', 'forceuniquegrnnoinpur', 'ls_expiry', 'ld_expiry'])
      if (n) {
        save(out, 'w_purchase.json', wp)
        messages.push(`w_purchase: removed ${n} spurious save return(s)`)
      }
    }
  }

  const wj = load(out, 'w_journalvoucher.json')
  if (wj) {
    const saveBody = wj.routines?.w_journalvoucher?.ue_save?.[0]?.body
    if (Array.isArray(saveBody)) {
      const n = removeSpuriousReturns(saveBody, ['ii_vouchertype'])
      if (n) {
        save(out, 'w_journalvoucher.json', wj)
        messages.push(`w_journalvoucher: removed ${n} spurious save return(s)`)
      }
    }
  }

  const fv = load(out, 'f_validatedw.json')
  if (fv && fixValidatedW(fv)) {
    save(out, 'f_validatedw.json', fv)
    messages.push('f_validatedw: required-field gate')
  }

  return messages
}
