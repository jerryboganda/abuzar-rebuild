import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { createRuntime } from '../src/runtime/boot.ts'
import { JsonClassLoader } from '../src/runtime/loader.ts'
import { parseScriptFile } from '../src/pbscript/parser.ts'
import type { ClassDef, PBObject } from '../src/runtime/object.ts'

const dataDir = process.argv[2]
const read = async (p: string) => {
  const f = join(dataDir, p)
  if (existsSync(f)) return readFileSync(f, 'utf8')
  if (existsSync(f + '.gz')) return gunzipSync(readFileSync(f + '.gz')).toString('utf8')
  return undefined
}
const names = JSON.parse((await read('names.json')) || '{}')
const base = new JsonClassLoader((n) => read(`classes/${n}.json`))
const src = `// function f_t (x)  ancestor: function_object

// f_t.f_t(m_entry am_menu) returns string
	string ls_out
	string ls_ind
	long ll_lv
	integer li_st
	ll_lv = gds_security.object.levelindex[1]
	li_st = gds_security.object.status[1]
	ls_ind = gds_security.object.indicesstring[1]
	ls_out = "lv=" + string(ll_lv) + " st=" + string(li_st) + " ind=" + ls_ind + " rc=" + string(gl_securityrowcount)
	return ls_out
`
const { file } = parseScriptFile(src)
const routines = new Map<string, Map<string, any[]>>()
for (const r of file.routines) {
  if (!routines.has(r.owner)) routines.set(r.owner, new Map())
  routines.get(r.owner)!.set(r.name, [r])
}
const def: ClassDef = { name: 'f_t', kind: 'function', ancestor: null, library: 'x', fields: [], controls: [], routines }
const loader = { load: async (n: string) => (n === 'f_t' ? def : base.load(n)) }
const rt = await createRuntime({ loader: loader as never, readData: read, sharedVars: names.sharedVars, globalTypes: names.globalTypes, ui: { async messageBox() { return 1 } } as never })
rt.onError = (e) => console.log('onError', (e as Error).message)
const ds = (await rt.instantiate('datastore')) as any
ds.setNative('dataobject', 'd_security')
await ds.ready
for (const r of [[1, 1, '2,', 'A', 1, 'Purchase']]) {
  const n = ds.model.insertRow(0)
  ;['rightcode', 'levelindex', 'indicesstring', 'object', 'status', 'rightname'].forEach((c, i) => ds.model.setItem(n, c, r[i]))
}
rt.globals.set('gds_security', ds)
rt.globals.set('gl_securityrowcount', 1)
const menu = (await rt.instantiate('m_entry', null)) as PBObject
try {
  const holder = await rt.instantiate('f_t', null)
  console.log(await rt.callMethod(holder, 'f_t', [menu]))
} catch (e) {
  console.log('THROWN', (e as Error).message, (e as { where?: string }).where)
}
setTimeout(() => process.exit(0), 100)
