// Parse every recovered .pbs script and report failures.  usage: node tools/parse-corpus.ts <scripts dir> [out ast dir]
import { readdirSync, readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { parseScriptFile } from '../src/pbscript/parser.ts'

const root = process.argv[2]
const out = process.argv[3]
let files = 0
let routines = 0
let lines = 0
const errors: string[] = []
const t0 = Date.now()
for (const lib of readdirSync(root)) {
  const dir = join(root, lib)
  if (!statSync(dir).isDirectory()) continue
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.pbs')) continue
    const text = readFileSync(join(dir, f), 'utf8')
    lines += text.split('\n').length
    const { file, errors: errs } = parseScriptFile(text)
    files++
    routines += file.routines.length
    for (const e of errs) errors.push(`${lib}/${f}: ${e}`)
    if (out) {
      mkdirSync(join(out, lib), { recursive: true })
      writeFileSync(join(out, lib, f.replace(/\.pbs$/, '.json')), JSON.stringify(file))
    }
  }
}
console.log(`files ${files}  routines parsed ${routines}  lines ${lines}  failed routines ${errors.length}  ${(Date.now() - t0) / 1000}s`)
const kinds = new Map<string, number>()
for (const e of errors) {
  const k = e.replace(/^.*?line \d+: /, '').replace(/<<.*$/, '').trim().slice(0, 60)
  kinds.set(k, (kinds.get(k) || 0) + 1)
}
console.log([...kinds.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25))
writeFileSync(process.env.PARSE_ERRORS || 'parse-errors.txt', errors.join('\n'))
