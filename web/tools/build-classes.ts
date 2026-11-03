// Merge recovered object definitions (windows, menus, user objects, structures) with the parsed PowerScript into one JSON file per class.
// usage: node tools/build-classes.ts <recovered/objects dir> <scripts dir (redacted)> <out dir>
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { parseScriptFile } from '../src/pbscript/parser.ts'
import type { Routine } from '../src/pbscript/ast.ts'
import { applyRuntimeClassFixes } from './runtime-class-fixes.ts'

const [objRoot, scrRoot, out, menuRoot] = process.argv.slice(2)
mkdirSync(out, { recursive: true })

type Plain = Record<string, Record<string, Routine[]>>
const index: Record<string, string> = {}
let nClasses = 0
let nRoutines = 0
const errors: string[] = []

function routinesOf(lib: string, name: string): Plain {
  const p = join(scrRoot, lib, name + '.pbs')
  const res: Plain = Object.create(null)
  if (!existsSync(p)) return res
  const { file, errors: errs } = parseScriptFile(readFileSync(p, 'utf8'))
  for (const e of errs) errors.push(`${lib}/${name}: ${e}`)
  for (const r of file.routines) {
    const o = (res[r.owner] ||= Object.create(null))
    const slim = { ...r } as Partial<Routine>
    delete slim.owner
    delete slim.name
    delete slim.line
    delete slim.locals
    ;(o[r.name] ||= []).push(slim as Routine)
    nRoutines++
  }
  return res
}

function slimControl(c: any): any {
  return {
    name: String(c.name).toLowerCase(),
    ancestor: String(c.ancestor).toLowerCase(),
    fields: (c.fields || []).filter((f: any) => f.name !== 'control').map((f: any) => (f.array ? { name: f.name, type: f.type, attr: f.attr, value: f.value, array: true } : { name: f.name, type: f.type, attr: f.attr, value: f.value })),
    controls: (c.controls || []).map(slimControl),
  }
}

/** complete item tree of a menu (see re-tools/menu_export.py) */
function menuControls(lib: string, name: string): any[] | null {
  if (!menuRoot) return null
  const p = join(menuRoot, lib, name + '.json')
  if (!existsSync(p)) return null
  const conv = (it: any): any => ({ name: String(it.name).toLowerCase(), ancestor: 'menu', fields: [], controls: (it.items || []).map(conv) })
  return (JSON.parse(readFileSync(p, 'utf8')).items || []).map(conv)
}

const done = new Set<string>()
for (const lib of readdirSync(objRoot)) {
  const ld = join(objRoot, lib)
  if (!statSync(ld).isDirectory()) continue
  for (const kind of readdirSync(ld)) {
    const kd = join(ld, kind)
    if (!statSync(kd).isDirectory()) continue
    for (const f of readdirSync(kd)) {
      if (!f.endsWith('.json')) continue
      const o = JSON.parse(readFileSync(join(kd, f), 'utf8'))
      const name = String(o.name).toLowerCase()
      const cls = {
        name,
        kind: o.kind || kind,
        ancestor: o.ancestor ? String(o.ancestor).toLowerCase() : null,
        library: lib,
        fields: (o.fields || []).filter((x: any) => x.name !== 'control').map((x: any) => (x.array ? { name: x.name, type: x.type, attr: x.attr, value: x.value, array: true } : { name: x.name, type: x.type, attr: x.attr, value: x.value })),
        controls: (o.kind || kind) === 'menu' ? menuControls(lib, o.name) ?? (o.controls || []).map(slimControl) : (o.controls || []).map(slimControl),
        routines: routinesOf(lib, o.name),
      }
      writeFileSync(join(out, name + '.json'), JSON.stringify(cls))
      index[name] = lib
      done.add(lib + '/' + o.name)
      nClasses++
    }
  }
}
// global functions (no object definition, only a script)
for (const lib of readdirSync(scrRoot)) {
  const ld = join(scrRoot, lib)
  if (!statSync(ld).isDirectory()) continue
  for (const f of readdirSync(ld)) {
    if (!f.endsWith('.pbs')) continue
    const name = f.slice(0, -4)
    if (done.has(lib + '/' + name)) continue
    const head = readFileSync(join(ld, f), 'utf8').split('\n', 1)[0]
    const m = head.match(/^\/\/ (\S+) (\S+) \((\S*)\)\s+ancestor: (.*)$/)
    if (!m) continue
    const cls = { name: name.toLowerCase(), kind: m[1], ancestor: null, library: lib, fields: [], controls: [], routines: routinesOf(lib, name) }
    writeFileSync(join(out, name.toLowerCase() + '.json'), JSON.stringify(cls))
    index[name.toLowerCase()] = lib
    nClasses++
  }
}
// The decompiler loses a few initialisers and enum contracts.  Re-apply the
// runtime corrections after every build so they cannot disappear silently.
const classFixes = applyRuntimeClassFixes(out)
if (classFixes.length) console.log(`runtime class fixes: ${classFixes.join(', ')}`)
writeFileSync(join(out, '_index.json'), JSON.stringify(index))
console.log(`classes ${nClasses}  routines ${nRoutines}  parse errors ${errors.length}`)
writeFileSync(join(out, '..', 'build-classes-errors.txt'), errors.join('\n'))
