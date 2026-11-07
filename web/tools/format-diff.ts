// Compares the rebuild's number / date formatter with the text the original's DataWindow engine (pbdwe125.dll) produced for the same value and format.
// usage: node tools/format-diff.ts <meta.json> <engine_out.jsonl> [report.json]
//   meta.json: [["num", "1234.567", "#,##0.00"], ["dt", 0, "dd/mm/yyyy hh:mm"], ...]   (dt: index into the four sample date-times below)
//   engine_out.jsonl: one {"i": index, "r": "text"} per line (the engine host marks a crashed item with "<CRASH>")
import { readFileSync, writeFileSync } from 'node:fs'
import { formatValue } from '../src/runtime/sysfuncs.ts'
import { Dec, PBDateTime } from '../src/runtime/values.ts'

const meta = JSON.parse(readFileSync(process.argv[2], 'utf8')) as [string, string | number, string][]
const engine = new Map<number, string>()
for (const line of readFileSync(process.argv[3], 'utf8').split('\n')) {
  if (!line.trim()) continue
  const j = JSON.parse(line) as { i: number; r: string | null }
  if (j.r !== '<PENDING>') engine.set(j.i, j.r ?? '')
}
const DT = [new Date(2026, 10, 3, 5, 9, 13), new Date(2000, 0, 1, 0, 0, 0), new Date(1999, 11, 31, 23, 59, 59), new Date(2026, 1, 8, 13, 5, 0)]
const SAMPLES: Record<string, Date> = { date: DT[0], dt: DT[0], dt2: DT[2], time: DT[0], t2: new Date(2026, 10, 3, 23, 59, 59) }
function sample(kind: string, value: string | number): unknown {
  if (kind === 'num') return Dec.parse(String(value))
  if (kind === 'dt') return PBDateTime.fromJs(DT[Number(value)])
  if (kind === 'str') return String(value)
  const vk = String(value)
  if (vk === 'num') return Dec.parse('1234.567')
  if (vk === 'num2') return Dec.parse('-5.5')
  const js = SAMPLES[vk]
  const dt = PBDateTime.fromJs(js)
  return vk === 'date' ? dt.date : vk === 'time' || vk === 't2' ? dt.time : dt
}
let same = 0
let diff = 0
let crashed = 0
const rows: { kind: string; value: string | number; fmt: string; engine: string; rebuild: string }[] = []
const perFormat = new Map<string, number>()
meta.forEach(([kind, value, fmt], i) => {
  const e = engine.get(i)
  if (e === undefined) return
  if (e === '<CRASH>') {
    crashed++
    return
  }
  let r: string
  // Question marks are real display output for missing temporal parts, not failed observations.
  if (/\uffff/.test(e)) return
  try {
    r = formatValue(sample(kind, value), fmt)
  } catch (err) {
    r = 'ERROR ' + (err as Error).message
  }
  if (r === e) same++
  else {
    diff++
    rows.push({ kind, value, fmt, engine: e, rebuild: r })
    perFormat.set(`${kind} ${fmt}`, (perFormat.get(`${kind} ${fmt}`) || 0) + 1)
  }
})
console.log(`formats compared: ${same + diff} (engine crashed on ${crashed}): same ${same}, different ${diff} in ${perFormat.size} formats`)
for (const r of rows.slice(0, 40)) console.log(`  ${r.kind} ${JSON.stringify(r.value)} ${JSON.stringify(r.fmt)}: engine ${JSON.stringify(r.engine)} rebuild ${JSON.stringify(r.rebuild)}`)
if (process.argv[4]) writeFileSync(process.argv[4], JSON.stringify({ same, diff, crashed, rows }, null, 1))
