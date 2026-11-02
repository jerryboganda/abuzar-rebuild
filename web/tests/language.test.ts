import test from 'node:test'
import assert from 'node:assert/strict'
import { parseScriptFile, parseExpr, parseDwExpr } from '../src/pbscript/parser.ts'
import { Runtime, Frame } from '../src/runtime/interp.ts'
import { registerSysFuncs } from '../src/runtime/sysfuncs.ts'
import { PBObject } from '../src/runtime/object.ts'
import type { ClassDef } from '../src/runtime/object.ts'
import { Dec, PBDate, PBArray } from '../src/runtime/values.ts'
import { DwModel } from '../src/dw/model.ts'
import { compileDw, evalDw, newCtx } from '../src/dw/expr.ts'
import type { DwDef } from '../src/dw/def.ts'

function runtimeWith(...srcs: string[]): Runtime {
  const defs = new Map<string, ClassDef>()
  for (const src of srcs) {
    const { file, errors } = parseScriptFile(src)
    assert.deepEqual(errors, [])
    const routines = new Map<string, Map<string, any[]>>()
    for (const r of file.routines) {
      if (!routines.has(r.owner)) routines.set(r.owner, new Map())
      const m = routines.get(r.owner)!
      if (!m.has(r.name)) m.set(r.name, [])
      m.get(r.name)!.push(r)
    }
    defs.set(file.name, { name: file.name, kind: file.kind, ancestor: null, library: 'x', fields: [], controls: [], routines })
  }
  const rt = new Runtime({ load: async (n) => defs.get(n) })
  registerSysFuncs(rt)
  rt.natives.set('nonvisualobject', (r, c) => new PBObject(r, c, 'nonvisualobject'))
  return rt
}

async function call(rt: Runtime, name: string, ...args: unknown[]): Promise<unknown> {
  const f = new Frame(null, null, 0)
  return rt.evalCall({ k: 'call', o: null, n: name, a: args.map((a) => (typeof a === 'string' ? { k: 'str', v: a } : { k: 'num', v: a as number, dec: false })) }, f)
}

test('call modifiers survive parsing: post / dynamic / event', () => {
  const e = parseExpr('parent.post event ue_close(1)') as any
  assert.equal(e.k, 'call')
  assert.equal(e.m, 'post event')
  assert.equal(e.n, 'ue_close')
  const d = parseExpr('lm_menu.dynamic mf_initsecurityapp(this)') as any
  assert.equal(d.m, 'dynamic')
  const hdr = parseScriptFile('// window w (x)  ancestor: window\n\n// w.open() returns long [event]\n\treturn 1\n// w.wf_a(string a) returns long\n\treturn 2\n')
  assert.equal(hdr.file.routines[0].event, true)
  assert.equal(hdr.file.routines[1].event, false)
})

test('choose case with ranges and lists, try/catch, arrays, do loops', async () => {
  const rt = runtimeWith(`// function f_t (x)  ancestor: function_object

// f_t.f_t(long a) returns string
	string s
	string arr[]
	long i
	choose case a
	case 1, 2
		s = "low"
	case 3 to 9
		s = "mid"
	case else
		s = "high"
	end choose
	arr[3] = "x"
	s = s + string(upperbound(arr))
	i = 0
	do while i < 3
		i = i + 1
		if i = 2 then
			continue
		end if
		s = s + string(i)
	loop
	try
		i = 1 / 0
	catch (throwable e)
		s = s + "!"
	end try
	return s
`)
  assert.equal(await call(rt, 'f_t', 2), 'low313!')
  assert.equal(await call(rt, 'f_t', 5), 'mid313!')
  assert.equal(await call(rt, 'f_t', 50), 'high313!')
})

test('null propagation, decimals and dates in scripts', async () => {
  const rt = runtimeWith(`// function f_n (x)  ancestor: function_object

// f_n.f_n() returns string
	string ls_null
	decimal ld_a
	date ld_d
	setnull(ls_null)
	ld_a = 0.1 + 0.2
	ld_d = date(2026, 2, 28)
	ld_d = relativedate(ld_d, 1)
	if isnull(ls_null + "x") then
		return string(ld_a, "0.00") + " " + string(ld_d, "dd/mm/yyyy")
	end if
	return "no"
`)
  assert.equal(await call(rt, 'f_n'), '0.30 01/03/2026')
})

const def: DwDef = {
  datawindow: { units: '1' },
  bands: { detail: { height: '20' } },
  table: {
    columns: [
      { type: 'long', name: 'k', key: 'yes', update: 'yes', updatewhereclause: 'yes' },
      { type: 'char(5)', name: 'kind', update: 'yes', updatewhereclause: 'yes' },
      { type: 'decimal(2)', name: 'amt', update: 'yes', updatewhereclause: 'no' },
    ],
    update: 'T',
    updatewhere: '1',
  },
  objects: [],
}

test('DataWindow expressions: case, in, if, aggregates with scope', async () => {
  const rt = runtimeWith()
  const m = new DwModel(rt, 'd', def)
  for (const [k, kind, amt] of [[1, 'a', '10.5'], [2, 'b', '2.25'], [3, 'a', '1']] as const) {
    const r = m.insertRow(0)
    m.setItem(r, 'k', k)
    m.setItem(r, 'kind', kind)
    m.setItem(r, 'amt', amt)
  }
  const ev = async (src: string, row = 1) => evalDw(compileDw(src), newCtx(m, row, 'detail'))
  assert.equal(String(await ev("case(kind when 'a' then 'A!' when 'b' then 'B!' else '?')", 2)), 'B!')
  assert.equal(await ev("kind in ('x', 'b')", 2), true)
  assert.equal(await ev('if(amt > 5, 1, 0)', 1), 1)
  assert.equal(String(await ev('sum(amt for all)')), '13.75')
  assert.equal(String(await ev('cumulativesum(amt for all)', 2)), '12.75')
  assert.equal(await ev('count(k for all)'), 3)
})

test('update statements follow the where-clause mode of the DataWindow', () => {
  const rt = runtimeWith()
  const m = new DwModel(rt, 'd', def)
  const r = m.insertRow(0)
  m.setItem(r, 'k', 1)
  m.setItem(r, 'kind', 'a')
  m.setItem(r, 'amt', 5)
  m.resetUpdate() // pretend it was retrieved
  m.setItem(1, 'kind', 'b')
  const st = m.buildUpdate()
  assert.equal(st.length, 1)
  // mode 1: key columns plus updatable columns with updatewhereclause=yes (amt is excluded)
  assert.equal(st[0].sql, 'UPDATE t SET kind = $1 WHERE k = $2 AND kind = $3')
  assert.deepEqual(st[0].params, ['b', 1, 'a'])
})

test('values: exact decimals and array helpers', () => {
  assert.equal(new Dec(1n, 1).add(new Dec(2n, 1)).toString(), '0.3')
  assert.equal(PBDate.ymd(2026, 11, 2).dow, 2)
  assert.equal(new PBArray('long', [1, 2, 3]).a.length, 3)
  assert.ok(parseDwExpr("sum(x for group 1) + if(a = 'q', 1, 2)"))
})

test('stored procedure called as a method of the transaction object: status code and INOUT values', async () => {
  const { registerWindowing } = await import('../src/runtime/native/windowing.ts')
  const { NTransaction } = await import('../src/runtime/native/transaction.ts')
  const { ProcCaller } = await import('../src/runtime/native/procs.ts')
  const rt = runtimeWith(`// function f_p (x)  ancestor: function_object

// f_p.f_p() returns long
	long ll_out
	long ll_ret
	ll_out = 1
	ll_ret = sqlca.getthing(5, ll_out)
	return ll_ret * 1000 + ll_out
`)
  registerWindowing(rt)
  const calls: unknown[][] = []
  const t = new NTransaction(rt, 'u_transaction')
  t.db = {
    async query() { return { columns: [], rows: [] } },
    async exec() { return { rowcount: 0 } },
    async call(sql: string, params: unknown[]) {
      calls.push([sql, params])
      return { columns: [{ name: 'return_value', type: 'int4' }, { name: 'b', type: 'int4' }], row: ['7', '42'], resultsets: [] }
    },
    async commit() {}, async rollback() {}, async close() {},
  }
  rt.globals.set('sqlca', t)
  rt.procs = new ProcCaller({ sp_getthing: { call: 'SELECT * FROM dbo.sp_getthing(a => $1, b => $2)', params: [{ name: 'a', mode: 'in' }, { name: 'b', mode: 'inout' }], inout: ['b'], rs: 0 } })
  assert.equal(await call(rt, 'f_p'), 7042)
  assert.deepEqual(calls[0], ['SELECT * FROM dbo.sp_getthing(a => $1, b => $2)', [5, 1]])
})

test('Timer(0, window) reaches the system function, not the window Timer event', async () => {
  const { registerWindowing } = await import('../src/runtime/native/windowing.ts')
  const rt = runtimeWith(`// window w_timer  ancestor: window

// w_timer.open() returns long [event]
	timer(0, this)
	return 1

// w_timer.timer() returns long [event]
	gs_timerhits = gs_timerhits + 1
	return 0
`)
  registerWindowing(rt)
  rt.globals.set('gs_timerhits', 0)
  const w = await rt.instantiate('w_timer')
  await rt.fire(w, 'open')
  assert.equal(rt.globals.get('gs_timerhits'), 0)
})

test('a for loop tests its limit again on every pass; a local keeps its initial value', async () => {
  const rt = runtimeWith(`// function f_loop (x)  ancestor: function_object

// f_loop.f_loop(long a) returns long
	long total = 5
	boolean lb_on = true
	long n = 3
	long i
	for i = 1 to n
		n = 2
		total = total + i
	next
	if lb_on then
		total = total + 100
	end if
	return total
`)
  // the limit drops to 2 inside the body: passes 1 and 2 run, 3 does not (5 + 1 + 2 + 100)
  assert.equal(await call(rt, 'f_loop', 0), 108)
})

test('a ref parameter returns its value to the caller', async () => {
  const rt = runtimeWith(
    `// function f_setter (x)  ancestor: function_object

// f_setter.f_setter(ref string as_out) returns boolean
	as_out = "hello"
	return true
`,
    `// function f_caller (x)  ancestor: function_object

// f_caller.f_caller() returns string
	string ls
	f_setter(ls)
	return ls
`,
  )
  assert.equal(await call(rt, 'f_caller'), 'hello')
})

test('an array addressed with two subscripts keeps every element', async () => {
  const rt = runtimeWith(`// function f_md (x)  ancestor: function_object

// f_md.f_md() returns string
	string ls_a[]
	ls_a[1, 1] = "x"
	ls_a[1, 2] = "y"
	ls_a[2, 1] = "z"
	return ls_a[1, 1] + ls_a[1, 2] + ls_a[2, 1] + string(upperbound(ls_a))
`)
  assert.equal(await call(rt, 'f_md'), 'xyz2')
})

test('a listviewitem local is a ready structure', async () => {
  const rt = runtimeWith(`// function f_lvi (x)  ancestor: function_object

// f_lvi.f_lvi() returns string
	listviewitem l_lvi
	l_lvi.label = "Bravo"
	l_lvi.pictureindex = 3
	return l_lvi.label + string(l_lvi.pictureindex)
`)
  assert.equal(await call(rt, 'f_lvi'), 'Bravo3')
})
