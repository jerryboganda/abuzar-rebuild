// Static build for the desktop shell: strips TypeScript types (node:module) and rewrites `.ts` import specifiers to `.js`.
// usage: node tools/build-static.ts <out dir>     (data/ is copied from public/data as it is)
import { readdirSync, readFileSync, writeFileSync, mkdirSync, statSync, cpSync, rmSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import { join, relative, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = process.argv[2] || join(root, 'dist')
rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })

function walk(dir: string): string[] {
  const res: string[] = []
  for (const f of readdirSync(dir)) {
    const p = join(dir, f)
    if (statSync(p).isDirectory()) res.push(...walk(p))
    else res.push(p)
  }
  return res
}

let n = 0
const modules: string[] = []
for (const f of walk(join(root, 'src'))) {
  if (!f.endsWith('.ts')) continue
  const code = stripTypeScriptTypes(readFileSync(f, 'utf8'), { mode: 'strip' }).replace(/(from\s+['"]|import\(\s*['"])(\.{1,2}\/[^'"]+)\.ts(['"])/g, '$1$2.js$3')
  const dst = join(out, 'src', relative(join(root, 'src'), f)).replace(/\.ts$/, '.js')
  mkdirSync(dirname(dst), { recursive: true })
  writeFileSync(dst, code)
  if (!/\.test\.js$/.test(dst)) modules.push('/' + relative(out, dst).split('\\').join('/'))
  n++
}
cpSync(join(root, 'public'), out, { recursive: true })
// Every module is announced in the page, so the browser requests them all at once instead of discovering them import by
// import (over the internet each level of the import chain was a round trip: 92 modules took about 8 seconds).
// Only the modules main.js really reaches (static and dynamic imports) are announced; tests and tools under src/ are not.
const reached = new Set<string>()
const todo = ['/src/main.js']
while (todo.length) {
  const m = todo.pop()!
  if (reached.has(m) || !modules.includes(m)) continue
  reached.add(m)
  const code = readFileSync(join(out, m), 'utf8')
  for (const [, spec] of code.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)['"](\.{1,2}\/[^'"]+)['"]/g)) todo.push(new URL(spec, 'http://x' + m).pathname)
}
const preload = [...reached].sort().map((m) => `<link rel="modulepreload" href="${m}">`).join('\n')
writeFileSync(join(out, 'index.html'), readFileSync(join(root, 'public', 'index.html'), 'utf8').replace('/src/main.ts', '/src/main.js').replace('</head>', preload + '\n</head>'))
console.log(`built ${n} modules into ${out} (${reached.size} preloaded)`)
