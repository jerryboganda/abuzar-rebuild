// Evaluates DataWindow expressions with the rebuild's expression engine and compares the text with what the original's DataWindow engine (pbdwe125.dll) answered to Evaluate().
// usage: node tools/expr-diff.ts <expressions.json> <engine_out.jsonl> [report.json]
//   expressions.json: ["round(2.5, 0)", "string(Date(~'2026-11-03~'), ~'dd/mm/yyyy~')", ...]  (`~'` is a quote inside the Evaluate string)
//   engine_out.jsonl: one {"i": index, "r": "text"} per line (the host marks an item that stopped it with "<CRASH>")
import { readFileSync, writeFileSync } from 'node:fs'
import { Runtime } from '../src/runtime/interp.ts'
import { registerSysFuncs } from '../src/runtime/sysfuncs.ts'
import { DwModel } from '../src/dw/model.ts'
import { formatValue } from '../src/runtime/sysfuncs.ts'
import type { DwDef } from '../src/dw/def.ts'

const exprs = JSON.parse(readFileSync(process.argv[2], 'utf8')) as string[]
const engine = new Map<number, string>()
for (const line of readFileSync(process.argv[3], 'utf8').split('\n')) {
  if (!line.trim()) continue
  const j = JSON.parse(line) as { i: number; r: string | null }
  if (j.r !== '<PENDING>') engine.set(j.i, j.r ?? '')
}
const rt = new Runtime({ load: async () => undefined })
registerSysFuncs(rt)
let same = 0
const rows: { expr: string; engine: string; rebuild: string }[] = []
let skipped = 0
for (let i = 0; i < exprs.length; i++) {
  const e = engine.get(i)
  if (e === undefined || e === '<CRASH>') {
    skipped++
    continue
  }
  const text = exprs[i].replace(/~'/g, "'")
  const def = {
    datawindow: { processing: '1' },
    bands: { detail: { height: '80' } },
    table: { columns: [{ type: 'long', name: 'k' }] },
    objects: [{ type: 'compute', name: 'x', band: 'detail', expression: text }],
  } as unknown as DwDef
  let r: string
  try {
    const m = new DwModel(rt, 'd_x', def)
    m.insertRow(0)
    const v = await m.getValue(1, 'x')
    r = v === null || v === undefined ? '' : typeof v === 'boolean' ? (v ? 'true' : 'false') : formatValue(v)
  } catch (err) {
    r = 'ERROR ' + (err as Error).message.slice(0, 80)
  }
  if (r === e) same++
  else rows.push({ expr: text, engine: e, rebuild: r })
}
console.log(`expressions compared: ${same + rows.length} (not answered by the engine: ${skipped}): same ${same}, different ${rows.length}`)
for (const r of rows.slice(0, 80)) console.log(`  ${r.expr}: engine ${JSON.stringify(r.engine)} rebuild ${JSON.stringify(r.rebuild)}`)
if (process.argv[4]) writeFileSync(process.argv[4], JSON.stringify({ same, rows }, null, 1))
