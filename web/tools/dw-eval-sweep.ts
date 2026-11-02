// Fills every DataWindow with three synthetic rows and evaluates all computed fields and expression properties (visible, color, format ... after ~t) for every row.
// This is the data-dependent part of the screens and reports that the retrieve sweep (empty tables) cannot reach; it needs no database and no customer data.
// usage: node tools/dw-eval-sweep.ts <public/data dir> [report.json]
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { Runtime } from '../src/runtime/interp.ts'
import { registerSysFuncs } from '../src/runtime/sysfuncs.ts'
import { DwModel } from '../src/dw/model.ts'
import { compileDw, evalDw, newCtx } from '../src/dw/expr.ts'
import { splitExpr } from '../src/dw/def.ts'
import type { DwDef, DwObject } from '../src/dw/def.ts'

const dir = process.argv[2]
const out = process.argv[3]
const rt = new Runtime({ load: async () => undefined })
registerSysFuncs(rt)

/** value for row n of a column of the given declared type */
function sample(type: string, n: number): unknown {
  const t = type.toLowerCase()
  if (t.startsWith('char') || t.startsWith('string') || t === 'varchar') return `T${n}`
  if (t.startsWith('datetime') || t.startsWith('timestamp')) return `2026-01-0${n} 10:0${n}:00.000`
  if (t.startsWith('date')) return `2026-01-0${n}`
  if (t.startsWith('time')) return `10:0${n}:00`
  if (t === 'blob') return null
  return n * 10 + 1
}

const files = readdirSync(join(dir, 'dw')).filter((f) => f.endsWith('.json.gz'))
const errors = new Map<string, { n: number; example: string }>()
let dws = 0
let evaluated = 0
let failedDws = 0
const bad: { dw: string; what: string; error: string }[] = []
for (const f of files) {
  const defs = JSON.parse(gunzipSync(readFileSync(join(dir, 'dw', f))).toString('utf8')) as Record<string, DwDef>
  for (const [name, def] of Object.entries(defs)) {
    dws++
    let failed = false
    const note = (what: string, e: unknown) => {
      failed = true
      const msg = String((e as Error)?.message ?? e)
      const k = msg.replace(/<<.*?>>/g, '<<?>>').replace(/"[^"]*"/g, '"?"').replace(/\d+/g, 'N').slice(0, 100)
      const cur = errors.get(k)
      if (cur) cur.n++
      else errors.set(k, { n: 1, example: `${name}: ${what}` })
      if (bad.length < 4000) bad.push({ dw: name, what, error: msg.slice(0, 160) })
    }
    let m: DwModel
    try {
      m = new DwModel(rt, name, def)
      const cols = def.table?.columns ?? []
      for (let n = 1; n <= 3; n++) {
        m.insertRow(0)
        cols.forEach((c, i) => m.setItem(n, i + 1, sample(c.type, n)))
      }
    } catch (e) {
      note('build', e)
      failedDws += failed ? 1 : 0
      continue
    }
    for (const o of def.objects ?? ([] as DwObject[])) {
      if (o.type === 'report' || o.type === 'ole' || o.type === 'tableblob') continue
      const band = o.band || 'detail'
      const rows = band.startsWith('detail') ? [1, 2, 3] : [1]
      for (const row of rows) {
        if (o.type === 'compute' && o.name) {
          try {
            await m.getValue(row, o.name)
            evaluated++
          } catch (e) {
            note(`compute ${o.name}`, e)
          }
        }
        for (const [k, raw] of Object.entries(o)) {
          if (typeof raw !== 'string' || !raw.includes('~t')) continue
          const { expr } = splitExpr(raw)
          if (!expr) continue
          try {
            await evalDw(compileDw(expr), newCtx(m, row, band))
            evaluated++
          } catch (e) {
            note(`${o.name}.${k}`, e)
          }
        }
      }
    }
    if (failed) failedDws++
  }
}
console.log(`DataWindows evaluated with synthetic rows: ${dws - failedDws} of ${dws}  (${evaluated} expressions evaluated, ${bad.length} failures)`)
const top = [...errors.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 12)
for (const [k, v] of top) console.log(`  ${v.n} x ${k}   e.g. ${v.example}`)
if (out) writeFileSync(out, JSON.stringify({ dws, failedDws, evaluated, errors: top.map(([k, v]) => ({ error: k, ...v })), bad }, null, 1))
if (failedDws) process.exit(1)
