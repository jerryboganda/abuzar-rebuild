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
for (const f of walk(join(root, 'src'))) {
  if (!f.endsWith('.ts')) continue
  const code = stripTypeScriptTypes(readFileSync(f, 'utf8'), { mode: 'strip' }).replace(/(from\s+['"]|import\(\s*['"])(\.{1,2}\/[^'"]+)\.ts(['"])/g, '$1$2.js$3')
  const dst = join(out, 'src', relative(join(root, 'src'), f)).replace(/\.ts$/, '.js')
  mkdirSync(dirname(dst), { recursive: true })
  writeFileSync(dst, code)
  n++
}
cpSync(join(root, 'public'), out, { recursive: true })
writeFileSync(join(out, 'index.html'), readFileSync(join(root, 'public', 'index.html'), 'utf8').replace('/src/main.ts', '/src/main.js'))
console.log(`built ${n} modules into ${out}`)
