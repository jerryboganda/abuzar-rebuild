import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Runtime } from '../src/runtime/interp.ts'
import { registerSysFuncs } from '../src/runtime/sysfuncs.ts'
import type { ClassDef } from '../src/runtime/object.ts'
import { NDwBase, NDwColumn, NDwObject } from '../src/runtime/native/dwctrl.ts'
import { DwCatalog } from '../src/dw/def.ts'
import type { DwDef } from '../src/dw/def.ts'
import { DwModel } from '../src/dw/model.ts'
import { fixClassData } from '../src/runtime/class-fixes.ts'
import { parseScriptFile } from '../src/pbscript/parser.ts'
import type { Routine } from '../src/pbscript/ast.ts'
import { LooseArgument, WINDOW_ARGUMENTS, windowArgument } from '../src/app/window-arguments.ts'
import { NGraph } from '../src/runtime/native/graph.ts'

const definition: DwDef = {
  datawindow: {}, bands: {},
  table: { columns: [{ name: 'code', type: 'char(10)' }, { name: 'name', type: 'char(60)' }] },
  objects: [{ name: 'code', type: 'column', band: 'detail' }, { name: 'name', type: 'column', band: 'detail' }],
}

function fixture() {
  const rt = new Runtime({ load: async () => undefined })
  const control = new NDwBase(rt, 'dw_synthetic')
  rt.dwCatalog = new DwCatalog(async () => undefined)
  return { rt, control }
}

/** dw.object.datawindow.column.count: the entry windows read it in their Open event to fill their column lists */
test('a DataWindow without a definition has no columns instead of a null reference', () => {
  const { control } = fixture()
  const object = control.pbGet('object') as NDwObject
  const datawindow = object.pbGet('datawindow') as NDwColumn
  const column = datawindow.pbGet('column') as NDwColumn
  assert.equal(column.pbGet('count'), '0')
  assert.equal(datawindow.pbGet('objects'), '')
})

test('a DataWindow with a definition answers its column count and its objects', () => {
  const { rt, control } = fixture()
  control.attach(new DwModel(rt, 'd_columns', definition))
  const object = control.pbGet('object') as NDwObject
  const datawindow = object.pbGet('datawindow') as NDwColumn
  const column = datawindow.pbGet('column') as NDwColumn
  assert.equal(column.pbGet('count'), '2')
  assert.match(datawindow.pbGet('objects') as string, /code/)
})

test('the prescription sets the initial value of the bsa column of the caller datastore', () => {
  const file = resolve(import.meta.dirname, '..', '..', 'data', 'src', 'scripts', 'patientvisitcomp', 'w_visitprescription.pbs')
  const { file: parsed, errors } = parseScriptFile(readFileSync(file, 'utf8'))
  assert.deepEqual(errors, [])
  const routines: Record<string, Record<string, Routine[]>> = {}
  for (const routine of parsed.routines) ((routines[routine.owner] ??= {})[routine.name] ??= []).push(routine)
  const data = { routines }
  assert.deepEqual(fixClassData('w_visitprescription', data), ['w_visitprescription bsa default'])
  assert.deepEqual(fixClassData('w_visitprescription', data), [], 'Loading a fixed class is idempotent')
  const body = data.routines.w_visitprescription.open[0].body
  const assignment = body.find((node) => node.k === 'if' && JSON.stringify(node).includes('"bsa"'))
  assert.ok(assignment, 'the prescription sets the bsa default')
  assert.match(JSON.stringify(assignment), /"n":"object"/)
  assert.doesNotMatch(JSON.stringify(assignment), /"n":"name"/)
})

test('the barcode label popup does not re-trigger its own post-open event', () => {
  const file = resolve(import.meta.dirname, '..', '..', 'data', 'src', 'scripts', 'barcodecomponents', 'w_barcodelabels_popup.pbs')
  const { file: parsed, errors } = parseScriptFile(readFileSync(file, 'utf8'))
  assert.deepEqual(errors, [])
  const routines: Record<string, Record<string, Routine[]>> = {}
  for (const routine of parsed.routines) ((routines[routine.owner] ??= {})[routine.name] ??= []).push(routine)
  const data = { routines }
  assert.deepEqual(fixClassData('w_barcodelabels_popup', data), ['w_barcodelabels_popup postopen recursion'])
  assert.deepEqual(fixClassData('w_barcodelabels_popup', data), [], 'Loading a fixed class is idempotent')
  const body = data.routines.w_barcodelabels_popup.ue_postopen[0].body
  const selfTrigger = body.find((node) => node.k === 'expr' && node.e.k === 'call' && node.e.n === 'ue_postopen')
  assert.equal(selfTrigger, undefined, 'the event does not trigger itself any more')
  assert.ok(body.some((node) => node.k === 'callsuper' && node.n === 'ue_postopen'), 'the ancestor script runs with the parameter the author set')
})

test('a direct event call runs the event script of the object it belongs to', async () => {
  const r = new Runtime({ load: async () => undefined })
  registerSysFuncs(r)
  const { file, errors } = parseScriptFile(`// window w_events (x)  ancestor: window

// w_events.ue_after() returns 0 [event]
	this.hits = this.hits + 1
	return 0

// w_events.wf_direct() returns long
	event ue_after()
	return this.hits

// w_events.wf_queued() returns long
	post event ue_after()
	return this.hits
`)
  assert.deepEqual(errors, [])
  const routines = new Map<string, Map<string, any[]>>()
  for (const routine of file.routines) {
    if (!routines.has(routine.owner)) routines.set(routine.owner, new Map())
    const m = routines.get(routine.owner)!
    if (!m.has(routine.name)) m.set(routine.name, [])
    m.get(routine.name)!.push(routine)
  }
  const def = { name: 'w_events', kind: 'window', ancestor: null, library: 'x', fields: [], controls: [], routines } as unknown as ClassDef
  r.loader = { load: async (n: string) => (n === 'w_events' ? def : undefined) } as unknown as typeof r.loader
  const w = await r.instantiate('w_events')
  w.props.set('hits', 0)
  assert.equal(await r.callMethod(w, 'wf_direct', []), 1, 'the event runs at once')
  assert.equal(await r.callMethod(w, 'wf_queued', []), 1, 'the queued event runs after the script')
  await r.flushPosted()
  assert.equal(w.props.get('hits'), 2)
  assert.deepEqual([...r.missing], [])
})

test('the windows the application opens with an argument get that argument', async () => {
  const rt = new Runtime({ load: async () => undefined })
  rt.natives.set('datawindow', (r, c) => new NDwBase(r, c, 'datawindow'))
  rt.natives.set('datastore', (r, c) => new NDwBase(r, c, 'datastore'))
  const find = await windowArgument(rt, 'w_findwindow')
  assert.ok(find instanceof NDwBase, 'the Find dialog receives the grid itself')
  const select = await windowArgument(rt, 'w_select')
  assert.ok(select instanceof Object && 'f' in select, 'the column picker receives a structure')
  assert.equal((select as { f: Map<string, unknown> }).f.get('dw_control') instanceof NDwBase, true)
  const unknown = await windowArgument(rt, 'w_not_opened_with_an_argument')
  assert.ok(unknown instanceof LooseArgument)
  assert.equal((unknown as LooseArgument).pbGet('s_name'), '')
  assert.equal((unknown as LooseArgument).pbGet('l_code'), 0)
  assert.equal(Object.keys(WINDOW_ARGUMENTS).length, 16)
})

test('the graph control keeps the series the scripts add and answers the graph dialogs', async () => {
  const rt = new Runtime({ load: async () => undefined })
  const graph = new NGraph(rt, 'gr_mygraph')
  assert.equal(graph.n_typeof(), 'graph')
  assert.equal(graph.n_addseries('count'), 1)
  assert.equal(graph.n_addseries('total'), 2)
  assert.equal(graph.n_findseries('total'), 2)
  assert.equal(graph.n_findseries('missing'), -1)
  graph.n_adddata(1, 12, 'January')
  graph.n_adddata(1, 7, 'February')
  assert.deepEqual(graph.categories, ['January', 'February'])
  assert.equal(graph.series[0].points.length, 2)
  // the axis labels the graph dialogs read and write
  graph.category.pbSet('label', 'Month')
  graph.values.pbSet('label', 'Amount')
  assert.equal(graph.category.label, 'Month')
  assert.equal(graph.values.label, 'Amount')
  assert.equal(graph.pbGet('categorysort'), 'unsorted!')
  graph.pbSet('graphtype', 4)
  assert.equal(graph.pbGet('graphtype'), 4)
  await graph.n_reset()
  assert.equal(graph.series.length, 0)
})
