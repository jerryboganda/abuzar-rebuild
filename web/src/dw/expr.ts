// Evaluator for DataWindow expressions (computed fields, visible/color/protect/format expressions, find/filter criteria).
import { parseDwExpr } from '../pbscript/parser.ts'
import type { Expr } from '../pbscript/ast.ts'
import { add, cmp, Dec, div, equals, mul, PBArray, PBDate, PBDateTime, PBRuntimeError, sub, toNum, toStr } from '../runtime/values.ts'
import type { Runtime } from '../runtime/interp.ts'

/** what the evaluator needs from a DataWindow model */
export interface EvalHost {
  rt: Runtime
  /** value of a column / computed field in a row of the rows list the context is evaluating over */
  colValue(name: string, ctx: EvalCtx, rel?: number): Promise<unknown> | unknown
  hasName(name: string): boolean
  rowCount(): number
  /** rows [start, end] (1-based, inclusive) forming the scope of an aggregate */
  scopeRange(ctx: EvalCtx, sc: { kind: string; n?: number } | undefined): [number, number]
  version: number
  pageInfo(): { page: number; pageCount: number }
}

export interface EvalCtx {
  host: EvalHost
  row: number // 1-based row in the current list
  band: string
  /** memoised aggregate results for this evaluation pass */
  memo: Map<string, unknown>
  depth: number
}

const cache = new Map<string, Expr>()
export function compileDw(src: string): Expr {
  let e = cache.get(src)
  if (!e) {
    e = parseDwExpr(src)
    cache.set(src, e)
  }
  return e
}

const truthy = (v: unknown): boolean => v === true || (typeof v === 'number' && v !== 0) || (v instanceof Dec && !v.isZero())

export async function evalDw(e: Expr, ctx: EvalCtx): Promise<unknown> {
  switch (e.k) {
    case 'num':
      return e.dec ? Dec.of(e.v) : e.v
    case 'str':
      return e.v
    case 'enum':
      return e.v
    case 'id':
      return ctx.host.colValue(e.n, ctx)
    case 'idx': {
      // column[-1] relative row reference
      if (e.o.k === 'id') {
        const rel = toNum(await evalDw(e.i[0], ctx))
        return ctx.host.colValue(e.o.n, ctx, rel)
      }
      return null
    }
    case 'un': {
      const v = await evalDw(e.e, ctx)
      if (v === null) return null
      if (e.op === 'not') return !truthy(v)
      return v instanceof Dec ? v.neg() : -toNum(v)
    }
    case 'bin':
      return evalBin(e, ctx)
    case 'case': {
      const v = await evalDw(e.e, ctx)
      for (const w of e.w) {
        for (const c of w.v) if (equals(v, await evalDw(c, ctx))) return evalDw(w.r, ctx)
      }
      return e.d ? evalDw(e.d, ctx) : null
    }
    case 'call':
      return evalCall(e, ctx)
    case 'arr':
      return new PBArray('any', await Promise.all(e.e.map((x) => evalDw(x, ctx))))
    default:
      throw new PBRuntimeError('unsupported DataWindow expression node ' + e.k)
  }
}

async function evalBin(e: Extract<Expr, { k: 'bin' }>, ctx: EvalCtx): Promise<unknown> {
  if (e.op === 'and') {
    const l = await evalDw(e.l, ctx)
    if (l !== null && !truthy(l)) return false
    const r = await evalDw(e.r, ctx)
    if (r !== null && !truthy(r)) return false
    return l === null || r === null ? null : true
  }
  if (e.op === 'or') {
    const l = await evalDw(e.l, ctx)
    if (l !== null && truthy(l)) return true
    const r = await evalDw(e.r, ctx)
    if (r !== null && truthy(r)) return true
    return l === null || r === null ? null : false
  }
  const l = await evalDw(e.l, ctx)
  if (e.op === 'in') {
    const list = (await evalDw(e.r, ctx)) as PBArray
    return list.a.some((x) => equals(l, x))
  }
  const r = await evalDw(e.r, ctx)
  switch (e.op) {
    case '+':
      return add(l, r)
    case '-':
      return sub(l, r)
    case '*':
      return mul(l, r)
    case '/':
      return div(l, r)
    case '^':
      return l === null || r === null ? null : Math.pow(toNum(l), toNum(r))
    case 'mod':
      return l === null || r === null ? null : toNum(l) % toNum(r)
  }
  if (l === null || r === null) return null
  const c = cmp(l, r)
  switch (e.op) {
    case '=':
      return equals(l, r)
    case '<>':
      return !equals(l, r)
    case '<':
      return c < 0
    case '>':
      return c > 0
    case '<=':
      return c <= 0
    case '>=':
      return c >= 0
  }
  throw new PBRuntimeError('operator ' + e.op)
}

const AGG = new Set(['sum', 'count', 'avg', 'min', 'max', 'first', 'last', 'median', 'stdev', 'var', 'cumulativesum', 'cumulativepercent', 'cumulativeavg', 'crosstabsum', 'crosstabcount', 'crosstabavg', 'crosstabmax', 'crosstabmin'])

async function evalCall(e: Extract<Expr, { k: 'call' }>, ctx: EvalCtx): Promise<unknown> {
  const name = e.n
  switch (name) {
    case 'if': {
      const c = await evalDw(e.a[0], ctx)
      return truthy(c) ? evalDw(e.a[1], ctx) : e.a[2] ? evalDw(e.a[2], ctx) : null
    }
    case 'isnull':
      return (await evalDw(e.a[0], ctx)) === null
    case 'page':
      return ctx.host.pageInfo().page
    case 'pagecount':
      return ctx.host.pageInfo().pageCount
    case 'pageacross':
    case 'pagecountacross':
      return 1
    case 'rowcount':
      return ctx.host.rowCount()
    case 'getrow':
    case 'currentrow':
      return ctx.row
    case 'rows':
      return ctx.host.rowCount()
    case 'today':
    case 'now':
    default:
      break
  }
  if (AGG.has(name)) return aggregate(e, ctx)
  if (name === 'counter') return ctx.row
  const args: unknown[] = []
  for (const a of e.a) args.push(await evalDw(a, ctx))
  const sf = ctx.host.rt.sys.get(name)
  if (sf) return sf.fn(ctx.host.rt, args, undefined as never)
  // global function (f_xxx) from the application
  const gf = await ctx.host.rt.getClass(name)
  if (gf && gf.kind === 'function') {
    const key = 'g:' + name + ':' + JSON.stringify(args.map((a) => (a instanceof Dec ? a.toString() : a instanceof PBDate ? a.n : a instanceof PBDateTime ? a.total() : a)))
    if (ctx.memo.has(key)) return ctx.memo.get(key)
    const holder = await ctx.host.rt.instantiate(name, null)
    const v = await ctx.host.rt.callMethod(holder, name, args)
    ctx.memo.set(key, v)
    return v
  }
  ctx.host.rt.noteMissing('dwfn:' + name)
  return null
}

async function aggregate(e: Extract<Expr, { k: 'call' }>, ctx: EvalCtx): Promise<unknown> {
  const host = ctx.host
  const name = e.n
  const [lo, hi] = host.scopeRange(ctx, e.sc)
  const key = `a:${name}:${JSON.stringify(e.a)}:${lo}-${hi}:${host.version}${name.startsWith('cumulative') ? ':' + ctx.row : ''}`
  if (ctx.memo.has(key)) return ctx.memo.get(key)
  const arg = e.a[0]
  const vals: unknown[] = []
  const last = name.startsWith('cumulative') ? Math.min(hi, ctx.row) : hi
  const seen = new Set<string>()
  for (let r = lo; r <= last; r++) {
    const c2: EvalCtx = { ...ctx, row: r }
    if (e.sc?.distinct) {
      const dk = toStr(await evalDw(e.sc.distinct, c2))
      if (seen.has(dk)) continue
      seen.add(dk)
    }
    vals.push(arg ? await evalDw(arg, c2) : r)
  }
  const nums = vals.filter((v) => v !== null)
  let res: unknown = null
  switch (name) {
    case 'count':
      res = nums.length
      break
    case 'sum':
    case 'cumulativesum':
    case 'crosstabsum': {
      let acc: unknown = new Dec(0n, 0)
      let allInt = true
      for (const v of nums) {
        if (typeof v === 'number' && !Number.isInteger(v)) allInt = false
        acc = add(acc, v)
      }
      res = acc instanceof Dec && !nums.some((v) => v instanceof Dec) ? (allInt ? acc.toNumber() : acc.toNumber()) : acc
      break
    }
    case 'avg':
    case 'cumulativeavg':
    case 'crosstabavg':
      res = nums.length ? toNum(nums.reduce((a: unknown, v) => add(a, v), new Dec(0n, 0))) / nums.length : null
      break
    case 'min':
    case 'crosstabmin':
      res = nums.length ? nums.reduce((a, v) => (cmp(v, a) < 0 ? v : a)) : null
      break
    case 'max':
    case 'crosstabmax':
      res = nums.length ? nums.reduce((a, v) => (cmp(v, a) > 0 ? v : a)) : null
      break
    case 'first':
      res = nums.length ? nums[0] : null
      break
    case 'last':
      res = nums.length ? nums[nums.length - 1] : null
      break
    case 'median': {
      const s = nums.map(toNum).sort((a, b) => a - b)
      res = s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null
      break
    }
    case 'var':
    case 'stdev': {
      const s = nums.map(toNum)
      if (s.length < 2) res = 0
      else {
        const m = s.reduce((a, b) => a + b, 0) / s.length
        const v = s.reduce((a, b) => a + (b - m) ** 2, 0) / (s.length - 1)
        res = name === 'var' ? v : Math.sqrt(v)
      }
      break
    }
    case 'cumulativepercent': {
      const total = nums.length ? toNum(nums.reduce((a: unknown, v) => add(a, v), new Dec(0n, 0))) : 0
      res = total ? 0 : null
      break
    }
    default:
      res = null
  }
  ctx.memo.set(key, res)
  return res
}

export function newCtx(host: EvalHost, row: number, band: string): EvalCtx {
  return { host, row, band, memo: new Map(), depth: 0 }
}
