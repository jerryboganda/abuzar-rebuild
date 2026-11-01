// Which functions / methods / members do the recovered scripts use, and how often?  usage: node tools/call-stats.ts <scripts dir> <out json>
import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { parseScriptFile } from '../src/pbscript/parser.ts'
import type { Expr, Stmt } from '../src/pbscript/ast.ts'

const calls = new Map<string, number>()
const methods = new Map<string, number>()
const members = new Map<string, number>()
const enums = new Map<string, number>()
const stmtKinds = new Map<string, number>()
const inc = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) || 0) + 1)

function ex(e: Expr | undefined | null): void {
  if (!e) return
  switch (e.k) {
    case 'call':
      if (e.o) {
        inc(methods, e.n)
        ex(e.o)
      } else inc(calls, e.n)
      e.a.forEach(ex)
      break
    case 'super':
      e.a.forEach(ex)
      break
    case 'mem':
      inc(members, e.n)
      ex(e.o)
      break
    case 'idx':
      ex(e.o)
      e.i.forEach(ex)
      break
    case 'un':
      ex(e.e)
      break
    case 'bin':
      ex(e.l)
      ex(e.r)
      break
    case 'arr':
      e.e.forEach(ex)
      break
    case 'enum':
      inc(enums, e.v)
      break
    case 'new':
      if (typeof e.t !== 'string') ex(e.t)
      e.a.forEach(ex)
      break
  }
}
function st(list: Stmt[]): void {
  for (const s of list) {
    inc(stmtKinds, s.k)
    switch (s.k) {
      case 'assign':
        ex(s.l)
        ex(s.r)
        break
      case 'expr':
        ex(s.e)
        break
      case 'if':
        ex(s.c)
        st(s.t)
        s.ei.forEach((x) => {
          ex(x.c)
          st(x.b)
        })
        if (s.e) st(s.e)
        break
      case 'choose':
        ex(s.e)
        s.cs.forEach((c) => st(c.b))
        if (s.d) st(s.d)
        break
      case 'for':
        ex(s.a)
        ex(s.b)
        st(s.body)
        break
      case 'while':
        ex(s.c)
        st(s.body)
        break
      case 'try':
        st(s.body)
        s.catches.forEach((c) => st(c.b))
        if (s.fin) st(s.fin)
        break
      case 'return':
        ex(s.e)
        break
      case 'destroy':
        ex(s.e)
        break
      case 'decl':
        s.vars.forEach((v) => ex(v.init))
        break
    }
  }
}

const root = process.argv[2]
for (const lib of readdirSync(root)) {
  const dir = join(root, lib)
  if (!statSync(dir).isDirectory()) continue
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.pbs')) continue
    const { file } = parseScriptFile(readFileSync(join(dir, f), 'utf8'))
    for (const r of file.routines) st(r.body)
  }
}
const top = (m: Map<string, number>, n: number) => Object.fromEntries([...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n))
writeFileSync(
  process.argv[3],
  JSON.stringify({ calls: top(calls, 2000), methods: top(methods, 800), members: top(members, 800), enums: top(enums, 800), stmtKinds: top(stmtKinds, 40) }, null, 1),
)
console.log('calls', calls.size, 'methods', methods.size, 'members', members.size, 'enums', enums.size)
