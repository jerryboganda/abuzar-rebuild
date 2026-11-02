// Which called functions are neither implemented system functions nor functions / classes of the application?  usage: node tools/sysfunc-coverage.ts <public/data> <call-stats.json>
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Runtime } from '../src/runtime/interp.ts'
import { registerSysFuncs } from '../src/runtime/sysfuncs.ts'
import { registerWindowing } from '../src/runtime/native/windowing.ts'
import { registerFileFuncs } from '../src/runtime/sysfiles.ts'

const dir = process.argv[2]
const stats = JSON.parse(readFileSync(process.argv[3], 'utf8')) as { calls: Record<string, number> }
const rt = new Runtime({ load: async () => undefined })
registerSysFuncs(rt)
registerWindowing(rt)
registerFileFuncs(rt)
const index = JSON.parse(readFileSync(join(dir, 'classes/_index.json'), 'utf8')) as Record<string, string>
// methods implemented by the native classes (n_<name>) can be called without a receiver from scripts of the object itself
const natives = new Set<string>()
const nativeDir = new URL('../src/runtime/native/', import.meta.url)
for (const f of readdirSync(nativeDir)) for (const m of readFileSync(new URL(f, nativeDir), 'utf8').matchAll(/n_([a-z_0-9]+)\(/g)) natives.add(m[1])
const missing: [string, number][] = []
let total = 0
let covered = 0
for (const [name, n] of Object.entries(stats.calls)) {
  const mod = name.replace(/^(post|dynamic|event|trigger) /, '')
  total += n
  if (rt.sys.has(mod) || natives.has(mod) || index[mod] || existsSync(join(dir, 'classes', mod + '.json'))) covered += n
  else missing.push([mod, n])
}
console.log(`calls ${total}  resolved ${covered} (${((100 * covered) / total).toFixed(1)}%)`)
console.log(missing.sort((a, b) => b[1] - a[1]).slice(0, 80).map(([k, v]) => `${k}:${v}`).join(' '))
