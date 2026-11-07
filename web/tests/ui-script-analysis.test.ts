import test from 'node:test'
import assert from 'node:assert/strict'
import { parseScriptFile } from '../src/pbscript/parser.ts'
import { analyzeUiScript } from '../tools/ui-script-analysis.ts'

const catalog = { windows: new Set(['w_sale', 'w_purchase', 'w_main']), datawindows: new Set(['d_lines']) }
function analyze(body: string, parameters = '') {
  const { file, errors } = parseScriptFile(`// window w_fixture (synthetic)  ancestor: window

// w_fixture.open(${parameters}) returns void
${body}
`)
  assert.deepEqual(errors, [])
  return analyzeUiScript(file, catalog)
}

test('resolves known class references, declared types and explicit window overloads', () => {
  const sites = analyze(`
w_purchase lw_next
open(w_sale)
open(lw_next)
open(lw_next, "w_sale")
opensheetwithparm(lw_next, "DO_NOT_EMIT", "w_purchase", w_main, 0)
`)
  assert.deepEqual(sites.map((site) => [site.target, site.targetBasis, site.withParameter]), [
    ['w_sale', 'class-reference', false], ['w_purchase', 'declared-type', false],
    ['w_sale', 'literal', false], ['w_purchase', 'literal', true],
  ])
})

test('dynamic override strings remain unresolved instead of pretending the reference type wins', () => {
  const sites = analyze(`
w_sale lw_next
open(lw_next, as_name)
open(lw_next, "w_sale", as_name)
open(lw_next, as_name, "w_purchase")
`, 'string as_name')
  assert.deepEqual(sites.map((site) => site.target), [null, null, 'w_purchase'])
})

test('WithParm payloads are not interpreted as window class names', () => {
  const sites = analyze('openwithparm(w_sale, "w_purchase")')
  assert.equal(sites[0].target, 'w_sale')
})

test('empty class strings follow native window-reference fallback while empty dataobjects clear the binding', () => {
  const sites = analyze('open(w_sale, "")\nthis.dw_lines.dataobject = ""')
  assert.equal(sites[0].target, 'w_sale')
  assert.equal(sites[1].target, null)
  assert.equal(sites[1].targetBasis, 'cleared')
})

test('records dynamic DataWindow replacements without emitting unknown literals or expressions', () => {
  const sites = analyze(`
this.dw_lines.dataobject = "d_" + "lines"
this.dw_lines.dataobject = as_dataobject
this.dw_lines.dataobject = "DO_NOT_EMIT"
`, 'string as_dataobject')
  assert.deepEqual(sites.map((site) => site.target), ['d_lines', null, null])
  assert.ok(sites.every((site) => site.receiver === 'this.dw_lines'))
  assert.ok(!JSON.stringify(sites).includes('DO_NOT_EMIT'))
})

test('retains nested branch identity without copying field values, Modify strings or print payloads', () => {
  const sites = analyze(`
if true then
  this.dw_lines.visible = false
  this.dw_lines.modify("DO_NOT_EMIT")
  this.dw_lines.setfocus()
else
  this.dw_lines.saveas("DO_NOT_EMIT", pdf!, true)
end if
`)
  assert.deepEqual(sites.map((site) => site.kind), ['presentation-assignment', 'layout-call', 'focus-call', 'output-call'])
  assert.ok(sites[0].astPath.includes('.t['))
  assert.ok(sites[3].astPath.includes('.e['))
  assert.ok(!JSON.stringify(sites).includes('DO_NOT_EMIT'))
})

test('reports Message parameter dependencies, not invented caller arguments', () => {
  const sites = analyze(`
string ls_code
ls_code = message.stringparm
this.dw_lines.dataobject = message.stringparm
`)
  assert.equal(sites.filter((site) => site.kind === 'message-parameter').length, 2)
  assert.equal(sites.find((site) => site.kind === 'dataobject-assignment')?.target, null)
})

test('distinguishes known nonvisual DataStore receivers without guessing aliases', () => {
  const sites = analyze(`
datastore lds_rows
datawindow ldw_control
lds_rows.dataobject = "d_lines"
ldw_control.dataobject = "d_lines"
this.id_detail.dataobject = "d_lines"
`)
  assert.deepEqual(sites.map((site) => site.receiverType), ['datastore', 'datawindow', null])
})

test('SQL and arbitrary string contents never become serialized inventory fields', () => {
  const { file } = parseScriptFile('// window w_fixture (synthetic)  ancestor: window\n// w_fixture.open() returns void\n')
  file.routines[0].body = [
    { k: 'sql', kind: 'select', text: 'DO_NOT_EMIT', hv: ['DO_NOT_EMIT'] },
    { k: 'expr', e: { k: 'call', o: null, n: 'messagebox', a: [{ k: 'str', v: 'DO_NOT_EMIT' }] } },
  ]
  assert.deepEqual(analyzeUiScript(file, catalog), [])
})

test('unknown literal class names stay unresolved and output is deterministic', () => {
  const sites = analyze('open(w_sale, "DO_NOT_EMIT")')
  assert.equal(sites[0].target, null)
  assert.ok(!JSON.stringify(sites).includes('DO_NOT_EMIT'))
  assert.deepEqual(sites, analyze('open(w_sale, "DO_NOT_EMIT")'))
})
