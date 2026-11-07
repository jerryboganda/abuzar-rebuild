// Parser for the recovered PowerScript (.pbs files written by the decompiler: one statement per line).
import { lex, unescape } from './lexer.ts'
import type { Tok } from './lexer.ts'
import type { Expr, Stmt, CaseTest, Routine, ScriptFile, Param } from './ast.ts'

const MODS = new Set(['post', 'dynamic', 'event', 'trigger', 'static'])
const STMT_KW = new Set([
  'if', 'elseif', 'else', 'end', 'choose', 'case', 'for', 'next', 'do', 'loop', 'try', 'catch', 'finally', 'return',
  'exit', 'continue', 'halt', 'goto', 'call', 'destroy', 'throw',
])

export class ExprParser {
  p = 0
  t: Tok[]
  dw = false // DataWindow expression dialect: `in (...)`, aggregate scopes, case()
  constructor(t: Tok[], dw = false) {
    this.t = t
    this.dw = dw
  }
  get cur(): Tok {
    return this.t[this.p]
  }
  isOp(v: string): boolean {
    return this.cur.t === 'op' && this.cur.v === v
  }
  isKw(v: string): boolean {
    return this.cur.t === 'id' && this.cur.v.toLowerCase() === v
  }
  eat(v: string): boolean {
    if (this.isOp(v)) {
      this.p++
      return true
    }
    return false
  }
  expect(v: string): void {
    if (!this.eat(v)) throw new Error(`expected '${v}' but found '${this.cur.v}'`)
  }
  atEnd(): boolean {
    return this.cur.t === 'eof'
  }

  or(): Expr {
    let l = this.and()
    while (this.isKw('or')) {
      this.p++
      l = { k: 'bin', op: 'or', l, r: this.and() }
    }
    return l
  }
  and(): Expr {
    let l = this.not()
    while (this.isKw('and')) {
      this.p++
      l = { k: 'bin', op: 'and', l, r: this.not() }
    }
    return l
  }
  not(): Expr {
    if (this.isKw('not')) {
      this.p++
      return { k: 'un', op: 'not', e: this.not() }
    }
    return this.rel()
  }
  rel(): Expr {
    let l = this.add()
    for (;;) {
      const c = this.cur
      if (this.dw && c.t === 'id' && c.v.toLowerCase() === 'not' && this.t[this.p + 1]?.t === 'id' && this.t[this.p + 1].v.toLowerCase() === 'in' && this.t[this.p + 2]?.v === '(') {
        this.p += 3
        const e: Expr[] = []
        do {
          e.push(this.or())
        } while (this.eat(','))
        this.expect(')')
        l = { k: 'bin', op: 'not in', l, r: { k: 'arr', e } }
        continue
      }
      if (this.dw && c.t === 'id' && c.v.toLowerCase() === 'in' && this.t[this.p + 1].v === '(') {
        this.p += 2
        const e: Expr[] = []
        do {
          e.push(this.or())
        } while (this.eat(','))
        this.expect(')')
        l = { k: 'bin', op: 'in', l, r: { k: 'arr', e } }
        continue
      }
      if (this.dw && c.t === 'id' && c.v.toLowerCase() === 'between') {
        this.p++
        const lo = this.add()
        if (!this.isKw('and')) throw new Error("'and' expected after between")
        this.p++
        const hi = this.add()
        l = { k: 'bin', op: 'and', l: { k: 'bin', op: '>=', l, r: lo }, r: { k: 'bin', op: '<=', l, r: hi } }
        continue
      }
      if (c.t === 'op' && (c.v === '=' || c.v === '<>' || c.v === '<' || c.v === '>' || c.v === '<=' || c.v === '>=')) {
        this.p++
        l = { k: 'bin', op: c.v, l, r: this.add() }
      } else return l
    }
  }
  add(): Expr {
    let l = this.mul()
    for (;;) {
      const c = this.cur
      if (c.t === 'op' && (c.v === '+' || c.v === '-')) {
        this.p++
        l = { k: 'bin', op: c.v, l, r: this.mul() }
      } else return l
    }
  }
  mul(): Expr {
    let l = this.unary()
    for (;;) {
      const c = this.cur
      if ((c.t === 'op' && (c.v === '*' || c.v === '/')) || (c.t === 'id' && c.v.toLowerCase() === 'mod')) {
        this.p++
        l = { k: 'bin', op: c.v.toLowerCase(), l, r: this.unary() }
      } else return l
    }
  }
  unary(): Expr {
    if (this.isOp('-')) {
      this.p++
      const e = this.unary()
      return e.k === 'num' ? { k: 'num', v: -e.v, dec: e.dec } : { k: 'un', op: '-', e }
    }
    if (this.isOp('+')) {
      this.p++
      return this.unary()
    }
    return this.pow()
  }
  pow(): Expr {
    let l = this.postfix()
    while (this.isOp('^')) {
      this.p++
      l = { k: 'bin', op: '^', l, r: this.unary() }
    }
    return l
  }

  args(): Expr[] {
    const a: Expr[] = []
    if (this.eat(')')) return a
    do {
      a.push(this.or())
    } while (this.eat(','))
    this.expect(')')
    return a
  }

  /** `sum(x for group 1)` style call: arguments followed by a scope clause */
  scopedCall(name: string): Expr {
    const a: Expr[] = []
    let sc: { kind: string; n?: number; distinct?: Expr[] } | undefined
    if (!this.eat(')')) {
      do {
        a.push(this.or())
        if (this.isKw('for')) {
          this.p++
          const kind = this.cur.v.toLowerCase()
          this.p++
          sc = { kind }
          if (kind === 'group' && this.cur.t === 'num') {
            sc.n = Number(this.cur.v)
            this.p++
          }
          if (this.isKw('distinct')) {
            this.p++
            // `for all distinct a, b` deduplicates by the combination of the
            // listed expressions.  A bare `for all distinct` deduplicates by
            // the aggregate's own argument.
            const ds: Expr[] = []
            if (this.isOp(')') || this.cur.t === 'eof') {
              ds.push(a[0] ?? { k: 'num', v: 1, dec: false })
            } else {
              do {
                ds.push(this.or())
              } while (this.eat(','))
            }
            sc.distinct = ds
          }
          break
        }
      } while (this.eat(','))
      this.expect(')')
    }
    const call: Expr = { k: 'call', o: null, n: name, a }
    if (sc) call.sc = sc
    return call
  }

  caseExpr(): Expr {
    const e = this.or()
    const w: { v: Expr[]; to?: Expr[]; is?: { op: string; e: Expr }; r: Expr }[] = []
    let d: Expr | undefined
    for (;;) {
      if (this.isKw('when')) {
        this.p++
        const v: Expr[] = []
        const to: Expr[] = []
        let is: { op: string; e: Expr } | undefined
        if (this.isKw('is')) {
          this.p++
          const op = this.cur.v
          this.p++
          is = { op, e: this.or() }
        } else {
          v.push(this.or())
          while (this.isKw('to')) {
            this.p++
            to.push(this.or())
            if (!this.eat(',')) break
            v.push(this.or())
          }
          while (this.eat(',')) v.push(this.or())
        }
        if (!this.isKw('then')) throw new Error('then expected in case()')
        this.p++
        w.push({ v, to: to.length ? to : undefined, is, r: this.or() })
      } else if (this.isKw('else')) {
        this.p++
        d = this.or()
      } else break
    }
    this.expect(')')
    return { k: 'case', e, w, d }
  }

  mods(): string {
    let m = ''
    while (this.cur.t === 'id' && MODS.has(this.cur.v.toLowerCase()) && this.t[this.p + 1].t === 'id') {
      m += (m ? ' ' : '') + this.cur.v.toLowerCase()
      this.p++
    }
    return m
  }

  primary(): Expr {
    const c = this.cur
    if (c.t === 'num') {
      this.p++
      return { k: 'num', v: Number(c.v), dec: c.v.includes('.') }
    }
    if (c.t === 'str') {
      this.p++
      return { k: 'str', v: c.v }
    }
    if (c.t === 'enum') {
      this.p++
      return { k: 'enum', v: c.v }
    }
    if (c.t === 'op') {
      if (c.v === '(') {
        this.p++
        const e = this.or()
        this.expect(')')
        return e
      }
      if (c.v === '{') {
        this.p++
        const e: Expr[] = []
        if (!this.eat('}')) {
          do {
            e.push(this.or())
          } while (this.eat(','))
          this.expect('}')
        }
        return { k: 'arr', e }
      }
      if (c.v === '::') {
        this.p++
        const n = this.cur
        if (n.t !== 'id') throw new Error('identifier expected after ::')
        this.p++
        if (this.isOp('(')) {
          this.p++
          return { k: 'call', o: null, n: n.v.toLowerCase(), a: this.args(), m: 'global' }
        }
        return { k: 'global', n: n.v.toLowerCase() }
      }
      throw new Error(`unexpected '${c.v}'`)
    }
    if (c.t === 'id') {
      const lc = c.v.toLowerCase()
      if (lc === 'create' && this.t[this.p + 1].v !== '(') {
        this.p++
        if (this.isKw('using')) {
          this.p++
          return { k: 'new', t: this.unary(), using: true, a: [] }
        }
        const n = this.cur
        if (n.t !== 'id') throw new Error('type name expected after create')
        this.p++
        let a: Expr[] = []
        if (this.isOp('(')) {
          this.p++
          a = this.args()
        }
        return { k: 'new', t: n.v.toLowerCase(), using: false, a }
      }
      // [post|dynamic|event|trigger]* name(args)  without receiver
      const m = this.mods()
      const nm = this.cur
      if (m && nm.t === 'id') {
        this.p++
        this.expect('(')
        return { k: 'call', o: null, n: nm.v.toLowerCase(), a: this.args(), m }
      }
      this.p++
      if (lc === 'super' && this.isOp('::')) {
        this.p++
        const f = this.cur
        if (f.t !== 'id') throw new Error('name expected after super::')
        this.p++
        this.expect('(')
        return { k: 'super', n: f.v.toLowerCase(), a: this.args() }
      }
      if (this.isOp('(')) {
        this.p++
        if (this.dw && lc === 'case') return this.caseExpr()
        if (this.dw) return this.scopedCall(lc)
        return { k: 'call', o: null, n: lc, a: this.args() }
      }
      return { k: 'id', n: lc }
    }
    throw new Error(`unexpected end of expression`)
  }

  postfix(): Expr {
    let e = this.primary()
    for (;;) {
      if (this.isOp('.')) {
        this.p++
        const m = this.mods()
        const n = this.cur
        if (n.t !== 'id') throw new Error(`member name expected after '.', found '${n.v}'`)
        this.p++
        if (this.isOp('(')) {
          this.p++
          const call: Expr = { k: 'call', o: e, n: n.v.toLowerCase(), a: this.args() }
          if (m) call.m = m
          e = call
        } else e = { k: 'mem', o: e, n: n.v.toLowerCase() }
      } else if (this.isOp('[')) {
        this.p++
        const i: Expr[] = []
        if (!this.isOp(']')) {
          do {
            i.push(this.or())
          } while (this.eat(','))
        }
        this.expect(']')
        e = { k: 'idx', o: e, i }
      } else return e
    }
  }
}

export function parseDwExpr(src: string): Expr {
  const ep = new ExprParser(lex(src, true), true)
  const e = ep.or()
  if (!ep.atEnd()) throw new Error(`trailing '${ep.cur.v}'`)
  return e
}

export function parseExpr(src: string): Expr {
  const ep = new ExprParser(lex(src))
  const e = ep.or()
  if (!ep.atEnd()) throw new Error(`trailing '${ep.cur.v}'`)
  return e
}

// ------------------------------------------------------------------------------------------------ statements
const HOSTVAR = /:([A-Za-z_][\w$#%-]*(?:\.[A-Za-z_][\w$#%-]*|\[[^\]]*\])*)/g

function sqlStatement(line: string): Stmt {
  let text = line.slice(3).trim()
  let note: string | undefined
  const cm = text.match(/\s*\/\*(.*?)\*\/\s*$/)
  if (cm) {
    note = cm[1].trim()
    text = text.slice(0, text.length - cm[0].length)
  }
  text = text.replace(/;\s*$/, '')
  let using: string | undefined
  const um = text.match(/\s+USING\s+([A-Za-z_][\w$#%.-]*)\s*$/i)
  if (um) {
    using = um[1].toLowerCase()
    text = text.slice(0, text.length - um[0].length)
  }
  let kind = (text.match(/^[A-Za-z]+/) || [''])[0].toLowerCase()
  if (/^execute\s+immediate\b/i.test(text)) kind = 'execute immediate'
  else if (kind === 'start') kind = 'connect'
  else if (kind === 'stop') kind = 'disconnect'
  const hv: string[] = []
  // host variables are not looked for inside quoted literals
  const stripped = text.replace(/'(?:[^']|'')*'/g, "''")
  for (const m of stripped.matchAll(HOSTVAR)) hv.push(m[1].toLowerCase())
  const st: Stmt = { k: 'sql', kind, text, hv }
  if (using) st.using = using
  if (note) st.note = note
  return st
}

class Block {
  i = 0
  lines: { s: string; n: number }[]
  constructor(lines: { s: string; n: number }[]) {
    this.lines = lines
  }
  more(): boolean {
    return this.i < this.lines.length
  }
  peek(): string {
    return this.lines[this.i].s
  }
  err(msg: string): never {
    const l = this.lines[Math.min(this.i, this.lines.length - 1)]
    throw new Error(`line ${l ? l.n : '?'}: ${msg}`)
  }

  statements(stop: (s: string) => boolean): Stmt[] {
    const out: Stmt[] = []
    while (this.more()) {
      const s = this.peek()
      if (stop(s)) break
      out.push(this.statement())
    }
    return out
  }

  statement(): Stmt {
    const { s, n } = this.lines[this.i]
    try {
      return this.statement1(s)
    } catch (e) {
      if (e instanceof Error && /^line \d+:/.test(e.message)) throw e
      throw new Error(`line ${n}: ${(e as Error).message}  <<${s.slice(0, 140)}>>`)
    }
  }

  private head(s: string): string {
    const m = s.match(/^[A-Za-z_]+/)
    return m ? m[0].toLowerCase() : ''
  }

  private statement1(s: string): Stmt {
    if (/^SQL\b/.test(s)) {
      this.i++
      return sqlStatement(s)
    }
    const kw = this.head(s)
    // label  "L1802:"
    const lab = s.match(/^([A-Za-z_][\w]*):$/)
    if (lab) {
      this.i++
      return { k: 'label', l: lab[1] }
    }
    if (STMT_KW.has(kw) && !/^(=|\+=|-=|\.|\[)/.test(s.slice(kw.length).trimStart())) {
      switch (kw) {
        case 'if':
          return this.ifStmt()
        case 'choose':
          return this.chooseStmt()
        case 'for':
          return this.forStmt()
        case 'do':
          return this.doStmt()
        case 'try':
          return this.tryStmt()
        case 'return': {
          this.i++
          const rest = s.slice(6).trim()
          return rest ? { k: 'return', e: parseExpr(rest) } : { k: 'return' }
        }
        case 'exit':
          this.i++
          return { k: 'exit' }
        case 'continue':
          this.i++
          return { k: 'continue' }
        case 'halt':
          this.i++
          return { k: 'halt', close: /\bclose\b/i.test(s) }
        case 'goto':
          this.i++
          return { k: 'goto', l: s.slice(4).trim() }
        case 'call': {
          this.i++
          const m = s.match(/^call\s+([\w]+)::([\w$#%-]+)/i)
          if (!m) this.err('call super syntax')
          return { k: 'callsuper', n: m[2].toLowerCase() }
        }
        case 'destroy':
          this.i++
          return { k: 'destroy', e: parseExpr(s.slice(7)) }
        case 'throw':
          this.i++
          return { k: 'throw', e: parseExpr(s.slice(5)) }
        default:
          this.err(`unexpected '${kw}'`)
      }
    }
    this.i++
    return this.simple(s)
  }

  /** declaration, assignment or call */
  private simple(s: string): Stmt {
    const t = lex(s)
    // declaration: type [{n}|[]] name ...
    const d = this.declaration(t)
    if (d) return d
    const ep = new ExprParser(t)
    const l = ep.postfix()
    if (ep.cur.t === 'op' && ['=', '+=', '-=', '*=', '/='].includes(ep.cur.v)) {
      const op = ep.cur.v
      ep.p++
      const r = ep.or()
      if (!ep.atEnd()) throw new Error(`trailing '${ep.cur.v}'`)
      return { k: 'assign', l, op, r }
    }
    if (ep.cur.t === 'op' && (ep.cur.v === '++' || ep.cur.v === '--')) {
      const op = ep.cur.v === '++' ? '+=' : '-='
      ep.p++
      return { k: 'assign', l, op, r: { k: 'num', v: 1, dec: false } }
    }
    // not an assignment: re-parse as a full expression (call statement)
    const e = new ExprParser(t)
    const ex = e.or()
    if (!e.atEnd()) throw new Error(`trailing '${e.cur.v}'`)
    return { k: 'expr', e: ex }
  }

  private declaration(t: Tok[]): Stmt | null {
    let p = 0
    let constant = false
    let prec: string | undefined
    while (t[p].t === 'id' && ['constant', 'readonly', 'ref', 'private', 'public', 'protected', 'shared', 'global'].includes(t[p].v.toLowerCase()) && t[p + 1].t === 'id') {
      if (t[p].v.toLowerCase() === 'constant') constant = true
      p++
    }
    const ty = t[p]
    if (ty.t !== 'id') return null
    let q = p + 1
    let arr = false
    // type{2}   type[]
    if (t[q].t === 'op' && t[q].v === '{') {
      let j = q + 1
      while (t[j].t !== 'eof' && !(t[j].t === 'op' && t[j].v === '}')) j++
      prec = t.slice(q + 1, j).map((x) => x.v).join('')
      q = j + 1
    }
    if (t[q].t === 'op' && t[q].v === '[' && t[q + 1].t === 'op' && t[q + 1].v === ']') {
      arr = true
      q += 2
    }
    if (t[q].t !== 'id') return null
    // `name` must be followed by end, ',', '[', '=' : a call like  post foo()  has '(' after the second identifier
    const nx = t[q + 1]
    if (nx.t === 'op' && nx.v === '(') return null
    if (MODS.has(ty.v.toLowerCase())) return null
    if (ty.v.toLowerCase() === 'create') return null
    const ep = new ExprParser(t)
    ep.p = q
    const vars: { n: string; dims?: Expr[][]; init?: Expr }[] = []
    do {
      const nm = ep.cur
      if (nm.t !== 'id') throw new Error('variable name expected')
      ep.p++
      const v: { n: string; dims?: Expr[][]; init?: Expr } = { n: nm.v.toLowerCase() }
      while (ep.isOp('[')) {
        ep.p++
        const dim: Expr[] = []
        if (!ep.isOp(']')) {
          do {
            dim.push(ep.or())
            if (ep.isKw('to')) {
              ep.p++
              dim.push(ep.or())
            }
          } while (ep.eat(','))
        }
        ep.expect(']')
        ;(v.dims ||= []).push(dim)
        arr = true
      }
      if (ep.eat('=')) v.init = ep.or()
      vars.push(v)
    } while (ep.eat(','))
    if (!ep.atEnd()) throw new Error(`trailing '${ep.cur.v}' in declaration`)
    const st: Stmt = { k: 'decl', t: ty.v.toLowerCase(), arr, vars }
    if (prec) st.prec = prec
    if (constant) st.constant = true
    return st
  }

  private ifStmt(): Stmt {
    const first = this.peek()
    this.i++
    const cond = (s: string, kw: string): Expr => {
      const m = s.match(new RegExp(`^${kw}\\s+(.*)\\s+then$`, 'i'))
      if (!m) this.err(`${kw} without then: ${s}`)
      return parseExpr(m[1])
    }
    const st: Extract<Stmt, { k: 'if' }> = { k: 'if', c: cond(first, 'if'), t: [], ei: [] }
    st.t = this.statements((x) => /^(elseif\b|else$|end if$)/i.test(x))
    for (;;) {
      if (!this.more()) this.err('unterminated if')
      const s = this.peek()
      if (/^elseif\b/i.test(s)) {
        this.i++
        const c = cond(s, 'elseif')
        const b = this.statements((x) => /^(elseif\b|else$|end if$)/i.test(x))
        st.ei.push({ c, b })
      } else if (/^else$/i.test(s)) {
        this.i++
        st.e = this.statements((x) => /^end if$/i.test(x))
      } else if (/^end if$/i.test(s)) {
        this.i++
        return st
      } else this.err('bad if structure: ' + s)
    }
  }

  private caseTests(src: string): CaseTest[] {
    const out: CaseTest[] = []
    const ep = new ExprParser(lex(src))
    do {
      if (ep.isKw('is')) {
        ep.p++
        const op = ep.cur.v
        ep.p++
        out.push({ k: 'is', op, e: ep.add() })
      } else {
        const a = ep.add()
        if (ep.isKw('to')) {
          ep.p++
          out.push({ k: 'range', a, b: ep.add() })
        } else out.push({ k: 'val', e: a })
      }
    } while (ep.eat(','))
    if (!ep.atEnd()) throw new Error(`trailing '${ep.cur.v}' in case`)
    return out
  }

  private chooseStmt(): Stmt {
    const first = this.peek()
    this.i++
    const m = first.match(/^choose\s+case\s+(.*)$/i)
    if (!m) this.err('choose case syntax')
    const st: Extract<Stmt, { k: 'choose' }> = { k: 'choose', e: parseExpr(m[1]), cs: [] }
    const isCase = (x: string) => /^(case\b|end choose$)/i.test(x)
    // statements before the first case are not allowed
    for (;;) {
      if (!this.more()) this.err('unterminated choose')
      const s = this.peek()
      if (/^end choose$/i.test(s)) {
        this.i++
        return st
      }
      if (/^case else$/i.test(s)) {
        this.i++
        st.d = this.statements(isCase)
      } else if (/^case\b/i.test(s)) {
        this.i++
        const tests = this.caseTests(s.slice(4))
        st.cs.push({ t: tests, b: this.statements(isCase) })
      } else this.err('bad choose structure: ' + s)
    }
  }

  private forStmt(): Stmt {
    const first = this.peek()
    this.i++
    const ep = new ExprParser(lex(first.slice(3)))
    const v = ep.postfix()
    ep.expect('=')
    const a = ep.add()
    if (!ep.isKw('to')) throw new Error('to expected')
    ep.p++
    const b = ep.add()
    let s: Expr | undefined
    if (ep.isKw('step')) {
      ep.p++
      s = ep.add()
    }
    if (!ep.atEnd()) throw new Error(`trailing '${ep.cur.v}'`)
    const body = this.statements((x) => /^next$/i.test(x))
    if (!this.more()) this.err('unterminated for')
    this.i++
    const st: Stmt = { k: 'for', v, a, b, body }
    if (s) st.s = s
    return st
  }

  private doStmt(): Stmt {
    const first = this.peek()
    this.i++
    const m = first.match(/^do\s+(while|until)\s+(.*)$/i)
    if (m) {
      const body = this.statements((x) => /^loop$/i.test(x))
      if (!this.more()) this.err('unterminated do')
      this.i++
      return { k: 'while', c: parseExpr(m[2]), until: m[1].toLowerCase() === 'until', body, post: false }
    }
    if (!/^do$/i.test(first)) this.err('do syntax')
    const body = this.statements((x) => /^loop\b/i.test(x))
    if (!this.more()) this.err('unterminated do')
    const l = this.peek()
    this.i++
    const lm = l.match(/^loop\s+(while|until)\s+(.*)$/i)
    if (lm) return { k: 'while', c: parseExpr(lm[2]), until: lm[1].toLowerCase() === 'until', body, post: true }
    return { k: 'while', c: { k: 'id', n: 'true' }, until: false, body, post: false }
  }

  private tryStmt(): Stmt {
    this.i++
    const st: Extract<Stmt, { k: 'try' }> = { k: 'try', body: [], catches: [] }
    const stop = (x: string) => /^(catch\b|finally$|end try$)/i.test(x)
    st.body = this.statements(stop)
    for (;;) {
      if (!this.more()) this.err('unterminated try')
      const s = this.peek()
      if (/^catch\b/i.test(s)) {
        this.i++
        const m = s.match(/^catch\s*\(\s*([\w.$#%-]+)\s+([\w$#%-]+)\s*\)/i)
        if (!m) this.err('catch syntax')
        st.catches.push({ t: m[1].toLowerCase(), v: m[2].toLowerCase(), b: this.statements(stop) })
      } else if (/^finally$/i.test(s)) {
        this.i++
        st.fin = this.statements(stop)
      } else if (/^end try$/i.test(s)) {
        this.i++
        return st
      } else this.err('bad try structure: ' + s)
    }
  }
}

// ------------------------------------------------------------------------------------------------ routines / files
const ROUTINE_HDR = /^\/\/ ([^\s.]+)\.([^\s(]+)\((.*)\)(?: returns (.*?))?( \[event\])?$/

function splitParams(src: string): Param[] {
  const out: Param[] = []
  if (!src.trim()) return out
  let depth = 0
  let cur = ''
  const parts: string[] = []
  for (const ch of src) {
    if (ch === '(' || ch === '[' || ch === '{') depth++
    if (ch === ')' || ch === ']' || ch === '}') depth--
    if (ch === ',' && depth === 0) {
      parts.push(cur)
      cur = ''
    } else cur += ch
  }
  parts.push(cur)
  for (let p of parts) {
    p = p.trim()
    const words = p.split(/\s+/)
    let ref = false
    let readonly = false
    while (words.length > 2 && ['ref', 'readonly', 'value'].includes(words[0].toLowerCase())) {
      const w = words.shift()!.toLowerCase()
      if (w === 'ref') ref = true
      if (w === 'readonly') readonly = true
    }
    const name = words[words.length - 1]
    const type = words.slice(0, -1).join(' ')
    const arr = /\[\s*\]/.test(p)
    out.push({ n: name.replace(/\[.*$/, '').toLowerCase(), t: type.replace(/\[\s*\]/, '').toLowerCase(), arr, ref, readonly })
  }
  return out
}

export function parseScriptFile(text: string): { file: ScriptFile; errors: string[] } {
  const lines = text.split('\n')
  const first = lines[0].match(/^\/\/ (\S+) (\S+) \((\S*)\)\s+ancestor: (.*)$/)
  const file: ScriptFile = {
    kind: first ? first[1] : '?',
    name: first ? first[2] : '?',
    library: first ? first[3] : '?',
    ancestor: first ? first[4].trim() : '',
    routines: [],
  }
  const errors: string[] = []
  let cur: { hdr: RegExpMatchArray; at: number; body: { s: string; n: number }[] } | null = null
  const flush = () => {
    if (!cur) return
    const r: Routine = {
      owner: cur.hdr[1].toLowerCase(),
      name: cur.hdr[2].toLowerCase(),
      params: [],
      ret: (cur.hdr[4] || '').trim().toLowerCase(),
      locals: [],
      event: !!cur.hdr[5],
      body: [],
      line: cur.at,
    }
    try {
      r.params = splitParams(cur.hdr[3])
      const b = new Block(cur.body)
      r.body = b.statements(() => false)
      for (const st of r.body) {
        if (st.k === 'decl') for (const v of st.vars) r.locals.push({ n: v.n, t: st.t, arr: st.arr })
      }
      file.routines.push(r)
    } catch (e) {
      errors.push(`${file.name}.${r.owner}.${r.name} ${(e as Error).message}`)
    }
    cur = null
  }
  for (let i = 1; i < lines.length; i++) {
    const raw = lines[i].replace(/\r$/, '')
    if (raw.startsWith('// ')) {
      const m = raw.match(ROUTINE_HDR)
      if (m) {
        flush()
        cur = { hdr: m, at: i + 1, body: [] }
        continue
      }
      // "// owner.name: external function / prototype without script" and other informational lines
      continue
    }
    if (!cur) continue
    const s = raw.trim()
    // a whole-line comment (hand-written notes in the redacted copies: `// PostgreSQL: ...`) is not code
    if (s && !s.startsWith('//')) cur.body.push({ s, n: i + 1 })
  }
  flush()
  return { file, errors }
}

export { unescape }
