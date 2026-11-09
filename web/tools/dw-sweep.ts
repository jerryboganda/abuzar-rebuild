// Executes the retrieve statement of every DataWindow against a real server / PostgreSQL with default arguments and reports what fails.
// usage: node tools/dw-sweep.ts <public/data dir> <server url> [report.json]
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { HttpDb } from '../src/app/httpdb.ts'
import { argList } from '../src/dw/def.ts'
import type { DwDef } from '../src/dw/def.ts'

const dir = process.argv[2]
const base = process.argv[3]
const out = process.argv[4]
const sql = JSON.parse(readFileSync(join(dir, 'sql.json'), 'utf8')) as { dw: Record<string, { sql: string; params: string[]; proc?: boolean }> }
const index = JSON.parse(readFileSync(join(dir, 'dw/_index.json'), 'utf8')) as Record<string, string>

// the server is plain HTTP on the same machine
;(globalThis as { fetch: typeof fetch }).fetch = ((orig) => (u: string | URL | Request, i?: RequestInit) => orig(typeof u === 'string' && u.startsWith('/') ? base + u : u, i))(fetch)

const bundles = new Map<string, Record<string, DwDef>>()
const defOf = (name: string): DwDef | undefined => {
  const lib = index[name]
  if (!lib) return undefined
  if (!bundles.has(lib)) {
    const p = join(dir, 'dw', lib + '.json.gz')
    bundles.set(lib, existsSync(p) ? JSON.parse(gunzipSync(readFileSync(p)).toString('utf8')) : {})
  }
  return bundles.get(lib)![name]
}

function defaultFor(type: string): unknown {
  const t = type.toLowerCase()
  if (t.endsWith('list')) return t.startsWith('string') ? [''] : [0]
  if (t === 'number' || t === 'long' || t === 'decimal' || t === 'ulong') return 0
  if (t === 'datetime') return '2026-01-01 00:00:00.000'
  if (t === 'date') return '2026-01-01'
  if (t === 'time') return '00:00:00'
  return ''
}

const db = await new HttpDb('').open()
const failures = new Map<string, { n: number; example: string }>()
let ok = 0
let tried = 0
const bad: { dw: string; error: string }[] = []
for (const [name, e] of Object.entries(sql.dw)) {
  const def = defOf(name)
  const decl = def ? argList(def) : []
  const params = e.params.map((p, index) => {
    const a = decl.find((d) => d.name === p.toLowerCase())
    const value = defaultFor(a ? a.type : 'number')
    if (value !== '') return value
    // string arguments in the two shapes the scripts fill with something other than free text: a column name the rows
    // are sorted by (`ORDER BY :ai_ordercol`), and a date label read as a datetime (us_english, month first)
    const placeholder = new RegExp(`\\$${index + 1}(?!\\d)`)
    if (new RegExp(`order\\s+by\\s+${placeholder.source}`, 'i').test(e.sql)) return def?.table?.columns?.[0]?.name ?? value
    if (new RegExp(`\\(${placeholder.source}\\)::timestamp`, 'i').test(e.sql)) return '01/02/2026'
    return value
  })
  tried++
  try {
    if (e.proc) await db.call(e.sql, params)
    else await db.query(e.sql, params)
    ok++
  } catch (err) {
    const msg = (err as Error).message
    const k = msg.replace(/"[^"]*"/g, '"?"').replace(/\d+/g, 'N').slice(0, 90)
    const f = failures.get(k) || { n: 0, example: name }
    f.n++
    failures.set(k, f)
    bad.push({ dw: name, error: msg.slice(0, 200) })
  }
  // an aborted transaction would hide every following error: start over
  await db.rollback().catch(() => {})
}
// embedded statements: run with null parameters inside the session transaction (rolled back): only the SQLSTATE class decides
const stmtStats = new Map<string, { n: number; example: string }>()
let stmtOk = 0
let stmtTried = 0
const stmtBad: { text: string; code: string; error: string }[] = []
const full = JSON.parse(readFileSync(join(dir, 'sql.json'), 'utf8')) as { stmt: Record<string, { sql: string; params: string[] }> }
for (const [key, e] of Object.entries(full.stmt)) {
  stmtTried++
  try {
    if (/^\s*select/i.test(e.sql)) await db.query(e.sql, e.params.map(() => null))
    else await db.exec(e.sql, e.params.map(() => null))
    stmtOk++
  } catch (err) {
    const code = (err as { code?: string }).code || '?'
    // 23xxx integrity (null parameters), 22xxx data (null / empty values) and 40001 are expected with dummy parameters; the rest is a defect
    if (/^(23|22|P0001|40)/.test(code)) {
      stmtOk++
    } else {
      const k = code + ' ' + (err as Error).message.replace(/"[^"]*"/g, '"?"').slice(0, 70)
      const f = stmtStats.get(k) || { n: 0, example: key.slice(0, 80) }
      f.n++
      stmtStats.set(k, f)
      stmtBad.push({ text: key.slice(0, 200), code, error: (err as Error).message.slice(0, 200) })
    }
  }
  await db.rollback().catch(() => {})
}
// stored procedures: run once with neutral arguments (the body is resolved only when it runs, so this finds what creation cannot)
const pgDefault = (type: string): unknown => {
  const t = type.toLowerCase()
  if (/^(smallint|integer|bigint|numeric|real|double|int)/.test(t)) return 0
  if (/^(text|citext|char|varchar)/.test(t)) return ''
  if (t.startsWith('timestamp')) return '2026-01-01 00:00:00'
  if (t === 'date') return '2026-01-01'
  if (t.startsWith('bool')) return false
  return null
}
const procStats = new Map<string, { n: number; example: string; names: string[] }>()
let procOk = 0
let procTried = 0
const procBad: { proc: string; code: string; error: string }[] = []
const procs = JSON.parse(readFileSync(join(dir, 'sql.json'), 'utf8')) as { proc: Record<string, { call: string; params: { name: string; mode: string; type?: string }[] }> }
for (const [name, p] of Object.entries(procs.proc)) {
  procTried++
  try {
    await db.call(p.call, p.params.map((x) => pgDefault(x.type || '')))
    procOk++
  } catch (err) {
    const code = (err as { code?: string }).code || '?'
    // integrity / data errors and the ROLLBACK marker are what neutral arguments cause; the rest is a defect of the translation
    if (/^(23|22|P0001|40|TS001)/.test(code)) procOk++
    else {
      const k = code + ' ' + (err as Error).message.replace(/"[^"]*"/g, '"?"').replace(/\d+/g, 'N').slice(0, 70)
      const f = procStats.get(k) || { n: 0, example: name, names: [] }
      f.n++
      if (f.names.length < 12) f.names.push(name)
      procStats.set(k, f)
      procBad.push({ proc: name, code, error: (err as Error).message.slice(0, 200) })
    }
  }
  await db.rollback().catch(() => {})
}
console.log(`procedures executed: ${procOk} of ${procTried} (failures are SQLSTATE classes other than integrity / data errors)`)
for (const [k, v] of [...procStats.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 30)) console.log(`${v.n} x ${k}   e.g. ${v.example}`)
console.log(`embedded statements executed: ${stmtOk} of ${stmtTried} (failures are SQLSTATE classes other than integrity / data errors)`)
for (const [k, v] of [...stmtStats.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 20)) console.log(`${v.n} x ${k}   e.g. ${v.example}`)
console.log(`DataWindows executed: ${ok} of ${tried} retrieve statements run on PostgreSQL`)
for (const [k, v] of [...failures.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 25)) console.log(`${v.n} x ${k}   e.g. ${v.example}`)
// every failure with its message, so the next fix does not need another run just to see them
console.log('--- failing DataWindows')
for (const b of bad.slice(0, 120)) console.log(`${b.dw}: ${b.error.slice(0, 150)}`)
console.log('--- failing embedded statements')
for (const b of stmtBad.slice(0, 40)) console.log(`${b.code} ${b.text.slice(0, 90)}: ${b.error.slice(0, 120)}`)
console.log('--- failing procedures')
for (const b of procBad.slice(0, 260)) console.log(`${b.proc}: ${b.code} ${b.error.slice(0, 130)}`)
if (out) writeFileSync(out, JSON.stringify({ tried, ok, failures: Object.fromEntries(failures), bad, stmtTried, stmtOk, stmtFailures: Object.fromEntries(stmtStats), stmtBad, procTried, procOk, procFailures: Object.fromEntries(procStats), procBad }, null, 1))
void readdirSync
// open handles of the HTTP client would keep the process (and the CI job) alive
setTimeout(() => process.exit(0), 200)
