import test from 'node:test'
import assert from 'node:assert/strict'
import { Runtime, Frame } from '../src/runtime/interp.ts'
import { registerSysFuncs } from '../src/runtime/sysfuncs.ts'
import { parseScriptFile } from '../src/pbscript/parser.ts'
import type { ClassDef } from '../src/runtime/object.ts'
import { PBObject } from '../src/runtime/object.ts'

function classFrom(src: string): ClassDef {
  const { file, errors } = parseScriptFile(src)
  assert.deepEqual(errors, [])
  const routines = new Map<string, Map<string, any[]>>()
  for (const r of file.routines) {
    if (!routines.has(r.owner)) routines.set(r.owner, new Map())
    const m = routines.get(r.owner)!
    if (!m.has(r.name)) m.set(r.name, [])
    m.get(r.name)!.push(r)
  }
  return { name: file.name, kind: file.kind, ancestor: null, library: 'x', fields: [], controls: [], routines }
}

function rt(...srcs: string[]): Runtime {
  const defs = new Map(srcs.map((s) => { const c = classFrom(s); return [c.name, c] }))
  const r = new Runtime({ load: async (n) => defs.get(n) })
  registerSysFuncs(r)
  r.natives.set('nonvisualobject', (rr, cn) => new PBObject(rr, cn, 'nonvisualobject'))
  return r
}

test('global function with loops, strings and choose case', async () => {
  const r = rt(`// function f_demo (x)  ancestor: function_object

// f_demo.f_demo(string as_x, long al_n) returns string
	string ls_out
	long ll_i
	ls_out = ""
	for ll_i = 1 to al_n
		choose case ll_i mod 3
		case 0
			ls_out = ls_out + upper(as_x)
		case 1, 2
			ls_out = ls_out + as_x
		end choose
	next
	if len(ls_out) > 5 and not isnull(ls_out) then
		return trim(left(ls_out, 5)) + "!"
	end if
	return ls_out
`)
  const f = new Frame(null, null, 0)
  const v = await r.evalCall({ k: 'call', o: null, n: 'f_demo', a: [{ k: 'str', v: 'ab' }, { k: 'num', v: 4, dec: false }] }, f)
  assert.equal(v, 'ababA!')
})

test('ref arguments and recursion', async () => {
  const r = rt(`// function f_fact (x)  ancestor: function_object

// f_fact.f_fact(long n) returns long
	if n <= 1 then
		return 1
	end if
	return n * f_fact(n - 1)
`, `// function f_inc (x)  ancestor: function_object

// f_inc.f_inc(ref long n) returns long
	n = n + 1
	return n
`)
  const f = new Frame(null, null, 0)
  f.locals.set('v', 5); f.types.set('v', 'long')
  assert.equal(await r.evalCall({ k: 'call', o: null, n: 'f_fact', a: [{ k: 'num', v: 6, dec: false }] }, f), 720)
  await r.evalCall({ k: 'call', o: null, n: 'f_inc', a: [{ k: 'id', n: 'v' }] }, f)
  assert.equal(f.locals.get('v'), 6)
})
