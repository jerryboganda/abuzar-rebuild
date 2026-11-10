// Structural-parity regressions of the generated layouts: each test pins a defect found in review on the real recovered definitions
// (captions paired with the wrong field, fields dropped or shown that Classic hides, buttons moved out of the content, groupboxes
// detached from their controls) and checks that the position validators refuse the wrong mapping.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { dataSurfaceIssues, dataSurfacePositionIssues } from '../src/ui/data-surfaces.ts'
import type { DataSurface } from '../src/ui/data-surfaces.ts'
import { windowSurfaceIssues, windowSurfacePositionIssues, windowContentItems, SHELL_WINDOW_SURFACES } from '../src/ui/window-surfaces.ts'
import type { WindowSurface, ControlBox } from '../src/ui/window-surfaces.ts'
import { DERIVED_DATA_SURFACES } from '../src/ui/derived-data-surfaces.ts'
import { DERIVED_SCREEN_DATA_SURFACES } from '../src/ui/derived-screen-data-surfaces.ts'
import { DERIVED_COMPATIBILITY_DATA_SURFACES } from '../src/ui/derived-compatibility-data-surfaces.ts'
import { DERIVED_ENTRY_WINDOW_SURFACES } from '../src/ui/derived-entry-windows.ts'
import { DERIVED_MODAL_WINDOW_SURFACES } from '../src/ui/derived-modal-windows.ts'
import * as dataTool from '../tools/derive-data-surfaces.ts'
import { indexClasses, sourceRuntime, windowGeometry, ancestryOf } from '../tools/derive-modal-windows.ts'
import { classify } from '../tools/classify-documents.ts'

const definitions = dataTool.loadDefinitions()
const classes = indexClasses()
const rt = sourceRuntime(classes)
const ancestry = ancestryOf(classes, rt)
const geometry = async (name: string): Promise<ControlBox[]> => {
  const window = await rt.instantiate(name)
  try { return windowGeometry(window) } finally { window.destroy() }
}
const generated: DataSurface[] = [
  ...DERIVED_DATA_SURFACES,
  ...DERIVED_SCREEN_DATA_SURFACES,
  ...DERIVED_ENTRY_WINDOW_SURFACES.flatMap((entry) => [...entry.details.flatMap((detail) => detail.surface ?? []), ...(entry.list ? [entry.list] : [])]),
  ...DERIVED_MODAL_WINDOW_SURFACES.flatMap((window) => (window.data ?? []).map((binding) => binding.surface)),
]
const surface = (name: string) => generated.find((item) => item.name === name)!
const field = (data: DataSurface, object: string) => data.fields.find((item) => item.object === object)!
const modal = (name: string) => DERIVED_MODAL_WINDOW_SURFACES.find((item) => item.name === name)!
const backlog = JSON.parse(readFileSync(dataTool.OUTPUT_BACKLOG, 'utf8')).reasons as Record<string, { names: string[] }>
const refused = (name: string) => Object.entries(backlog).find(([, entry]) => entry.names.includes(name))?.[0]

test('every generated DataWindow surface keeps its captions, suffixes and order where the source paints them', () => {
  for (const item of generated) assert.deepEqual(dataSurfacePositionIssues(definitions.get(item.name)!, item), [], item.name)
})

test('every generated window keeps its captions, actions and frame members where the source places them', async () => {
  for (const window of DERIVED_MODAL_WINDOW_SURFACES) {
    assert.deepEqual(windowSurfacePositionIssues(await geometry(window.name), window, await ancestry(window.name)), [], window.name)
  }
})

test('a hidden grid column keeps its own header and never shows it as a loose caption (d_item_update)', () => {
  const grid = surface('d_item_update'), def = definitions.get('d_item_update')!
  assert.equal(field(grid, 'pctcode').labelObject, 'pctcode_t')
  assert.ok(!grid.captions?.some((caption) => caption.object === 'pctcode_t'))
  const moved = { ...grid, fields: grid.fields.map((item) => item.object === 'pctcode' ? { object: 'pctcode', label: 'Pctcode', labelHidden: true, choice: item.choice } : item),
    captions: [...grid.captions ?? [], { object: 'pctcode_t' }] }
  assert.ok(dataSurfaceIssues(def, moved).includes('Header of a hidden column mapped as a caption: pctcode_t'))
})

test('a band without height paints nothing: its text is decoration, never a caption (d_arg_region)', () => {
  const form = surface('d_arg_region'), def = definitions.get('d_arg_region')!
  assert.equal(form.kind, 'form')
  assert.ok(form.decorations?.includes('category_t'))
  assert.equal(field(form, 'region').labelHidden, true)
  const wrong: DataSurface = { ...form, kind: 'grid', sourceProcessing: 0, decorations: undefined,
    fields: [{ ...field(form, 'region'), label: undefined, labelHidden: undefined, labelObject: 'category_t', labelBand: 'header' }] }
  assert.ok(dataSurfaceIssues(def, wrong).includes('Not painted by the source: category_t'))
})

test('painted background headings are mapped as report header values (d_view_item_satisfiable)', () => {
  for (const [name, objects] of [
    ['d_view_item_satisfiable', ['compute_2', 'compute_3']],
    ['d_visithistory', ['compute_2']],
    ['d_itemtransferhistory', ['compute_1']],
  ] as const) {
    const grid = surface(name)
    assert.deepEqual(grid.header?.map((item) => item.object), objects, name)
    assert.ok(grid.header?.every((item) => item.band === 'background'), name)
    assert.ok(!grid.decorations?.some((item) => objects.includes(item as never)), name)
    assert.equal(refused(name), undefined, name)
  }
  const def = definitions.get('d_view_item_satisfiable')!
  const columns = def.objects.filter((object) => object.band === 'detail' && object.type === 'column').map((object) => object.name.toLowerCase())
  const pretend: DataSurface = { name: 'd_view_item_satisfiable', title: 'probe', kind: 'grid', fields: columns.map((object) => ({ object, label: object })), decorations: ['compute_2'] }
  assert.ok(dataSurfaceIssues(def, pretend).includes('Unsupported decoration: compute_2'))
})

test('dialog captions pair with the control beside them, not across another control (date and format criteria)', async () => {
  // w_arg_cust_sdate_ldate_v13 had the format drop-down captioned "End Date:"; it keeps Classic (staggered rows, browser
  // structure gate), and the same caption trap is pinned on w_arg_cust_dates_caption_disc_terms.
  assert.equal(modal('w_arg_cust_sdate_ldate_v13'), undefined)
  const terms = modal('w_arg_cust_dates_caption_disc_terms')
  assert.deepEqual(terms.fields.find((item) => item.control === 'em_enddate'), { control: 'em_enddate', label: 'st_2' })
  assert.equal(terms.fields.find((item) => item.control === 'ddlb_format')?.label, 'st_9')
  const wrong: WindowSurface = { ...terms, fields: terms.fields.map((item) => item.control === 'ddlb_format' ? { control: 'ddlb_format', label: 'st_1' } :
    item.control === 'em_startdate' ? { control: 'em_startdate', name: 'Dates' } : item) }
  assert.ok(windowSurfacePositionIssues(await geometry(terms.name), wrong).includes('Caption is not beside its field in the source: ddlb_format'))
  const days = modal('w_arg_manfs_cats_classes_packs_dates_v3')
  assert.equal(days.fields.find((item) => item.control === 'em_days')?.label, 'st_4')
  assert.equal(days.fields.find((item) => item.control === 'em_startdate')?.label, 'st_1')
  // Hidden inherited controls keep their own captions: date captions on the date fields, invoice captions on the invoice range.
  const accounts = modal('w_arg_accounts')
  assert.equal(accounts.fields.find((item) => item.control === 'em_startdate')?.label, 'st_1')
  assert.deepEqual(accounts.data?.find((item) => item.control === 'dw_startendinvoice')?.labels, [{ field: 'sinvcode', control: 'st_3' }, { field: 'linvcode', control: 'st_7' }])
  const swapped: WindowSurface = { ...accounts, fields: accounts.fields.map((item) => item.control === 'em_startdate' ? { ...item, label: 'st_3' } : item) }
  assert.ok(windowSurfacePositionIssues(await geometry(accounts.name), swapped, await ancestry(accounts.name))
    .includes('Caption is not beside its field in the source: em_startdate'))
  const invoice = modal('w_arg_saleinvcode')
  assert.equal(invoice.fields.find((item) => item.control === 'em_startdate')?.label, 'st_1')
  assert.deepEqual(invoice.data?.find((item) => item.control === 'dw_control')?.labels, [{ field: 'custcode', control: 'st_3' }])
})

test('alternative fields painted over each other share their one caption; an always-hidden one owns none', () => {
  const sale = surface('d_inpatientsalereturn')
  assert.equal(field(sale, 'admissioncode').labelObject, 't_patient')
  assert.equal(field(sale, 'patientcode').labelObject, undefined)
  const order = surface('d_serviceorderheader')
  assert.equal(field(order, 'accounts_name').labelObject, 'custcode_t')
  const receipt = surface('d_receiptheader')
  assert.deepEqual(['deptcode', 'recipientsalesman', 'acccode'].map((name) => field(receipt, name).labelObject), ['deptcode_t', 'deptcode_t', 'deptcode_t'])
  const value = surface('d_set_student_columnvalue'), def = definitions.get('d_set_student_columnvalue')!
  assert.deepEqual(['value2', 'value'].map((name) => field(value, name).labelObject), ['targetcolumn_t', 'targetcolumn_t'])
  assert.deepEqual(dataSurfaceIssues(def, value), [])
  // Fields that are not painted over each other cannot share a caption.
  const shared = { ...value, fields: value.fields.map((item) => item.object === 'sourcecolumn' ? { ...item, labelObject: 'targetcolumn_t' } : item) }
  assert.ok(dataSurfaceIssues(def, shared).some((issue) => /Duplicate label: (sourcecolumn_t|targetcolumn_t)/.test(issue) || issue === 'Unmapped object: sourcecolumn_t'))
})

test('a unit text after a field is its suffix, never the next field\'s caption (d_patientvisit_gyn_us)', () => {
  const form = surface('d_patientvisit_gyn_us'), def = definitions.get('d_patientvisit_gyn_us')!
  for (const organ of ['uterus', 'rtov', 'ltov']) {
    for (const side of ['l', 'w', 't']) assert.equal(field(form, `${organ}_size_${side}`).suffixObject, `${organ}_size_${side}_t`, `${organ} ${side}`)
    assert.ok(field(form, `${organ}_size_w`).labelHidden)
  }
  const old: DataSurface = { ...form, fields: form.fields.map((item) => item.object === 'uterus_size_l' ? { object: item.object, labelObject: 't_2' } :
    item.object === 'uterus_size_w' ? { object: item.object, labelObject: 'uterus_size_l_t' } : item) }
  assert.ok(dataSurfacePositionIssues(def, old).includes('Caption belongs to another field: uterus_size_w'))
})

test('a button the source places among the content keeps its place; OK and Cancel stay actions', async () => {
  const export_ = modal('w_arg_manf_sdate_ldate_abbott')
  assert.deepEqual(export_.buttons, ['cb_trans', 'cb_cust', 'cb_stock'])
  assert.deepEqual(export_.actions, ['cb_ok', 'cb_cancel'])
  assert.deepEqual(modal('w_backupinfo').actions, ['cb_close'])
  assert.deepEqual(modal('w_emp_employee_fingerprint_enrollment').actions, ['cb_ok', 'cb_cancel'])
  const moved: WindowSurface = { ...export_, actions: ['cb_trans', ...export_.actions], buttons: ['cb_cust', 'cb_stock'],
    contentOrder: export_.contentOrder!.filter((name) => name !== 'cb_trans'), members: { ...export_.members, gb_2: export_.members!.gb_2.filter((name) => name !== 'cb_trans') } }
  assert.ok(windowSurfacePositionIssues(await geometry(export_.name), moved).includes('A button the source places among the content is in the action row: cb_trans'))
})

test('visible pictures, colour keys and progress bars are positioned content; hidden ones stay auxiliary', () => {
  assert.deepEqual(modal('w_backupinfo').artwork, ['r_above1day', 'r_above3hr', 'r_below1day'])
  assert.equal(modal('w_emp_employee_fingerprint_enrollment').artwork?.length, 10)
  assert.deepEqual(modal('w_arg_manf_sdate_ldate_abbott').auxiliary, ['hpb_hpb'])
  const window = modal('w_backupinfo')
  const controls = [...windowContentItems(window), ...window.actions, ...(window.auxiliary ?? [])]
    .map((name) => ({ name, native: name.startsWith('r_') ? 'rectangle' : name.startsWith('st_') ? 'statictext' : name.startsWith('cb_') ? 'commandbutton' : 'datawindow', children: 0 }))
  assert.deepEqual(windowSurfaceIssues(controls, window), [])
  assert.ok(windowSurfaceIssues(controls, { ...window, artwork: ['cb_close', 'r_above3hr', 'r_below1day'] }).includes('Unsupported control: cb_close'))
})

test('a groupbox keeps its caption with exactly the content it encloses', async () => {
  const window = modal('w_arg_cust_dates_caption_disc_terms')
  assert.deepEqual(window.members, { gb_1: ['dw_selected'], gb_3: ['rb_originaldate', 'rb_lastsavingdate', 'rb_billingdate'], gb_2: ['em_startdate', 'em_enddate'] })
  const boxes = await geometry(window.name)
  assert.ok(windowSurfacePositionIssues(boxes, { ...window, members: { ...window.members, gb_2: ['em_startdate'] } })
    .includes('Frame members differ from the content each groupbox encloses in the source'))
  const controls = boxes.map(({ name, native }) => ({ name, native, children: 0 }))
  assert.deepEqual(windowSurfaceIssues(controls, window), [])
  assert.ok(windowSurfaceIssues(controls, { ...window, members: { ...window.members, gb_2: ['em_startdate', 'em_enddate', 'cb_ok'] } })
    .includes('Unsupported frame member: gb_2.cb_ok'))
  assert.ok(windowSurfaceIssues(controls, { ...window, members: { ...window.members, gb_3: [...window.members!.gb_3, 'em_startdate'] } })
    .includes('Duplicate frame member: em_startdate'))
})

test('shell windows keep their native shell content without a dialog reflow', async () => {
  for (const surface of SHELL_WINDOW_SURFACES) {
    const controls = (await geometry(surface.name)).map(({ name, native }) => ({ name, native, children: 0 }))
    assert.deepEqual(windowSurfaceIssues(controls, surface), [], surface.name)
  }
})

test('overlapping source rows use source-proportional placement', () => {
  for (const name of [
    'd_alnaseeb_deliveryorder_saleinvprint', 'd_normalpurchasereturnfooter', 'd_old_general1',
    'd_opensalereturnfooter', 'd_salereturnfooter_view', 'd_servicefooter_view',
  ]) {
    const item = surface(name)
    assert.equal(item.sourceLayout, true, name)
    assert.deepEqual(dataSurfaceIssues(definitions.get(name)!, item), [], name)
    assert.ok(!DERIVED_COMPATIBILITY_DATA_SURFACES.some((surface) => surface.name === name), name)
  }
  for (const name of ['w_arg_cust_sdate_ldate_v13', 'w_arg_customers_sdate_ldate_v7']) {
    assert.equal(modal(name), undefined, name)
  }
})

test('a heading or button stays in the groupbox that holds it, or the form keeps Classic', () => {
  const preferences = surface('d_adjustmentpreferences')
  assert.ok(preferences.captions?.some((caption) => caption.group))
  assert.deepEqual(dataSurfacePositionIssues(definitions.get('d_adjustmentpreferences')!, preferences), [])
  assert.equal(refused('d_adjustmentpreferences'), undefined)
  const child = surface('d_childserver_controlpanel')
  assert.deepEqual(child.buttons?.find((button) => button.object === 'b_saletrans'), { object: 'b_saletrans', group: 'gb_2' })
  assert.deepEqual(dataSurfacePositionIssues(definitions.get('d_childserver_controlpanel')!, child), [])
  assert.equal(refused('d_childserver_controlpanel'), undefined)
  const grouped = generated.find((item) => item.groups && item.groups.length > 1 && item.captions?.some((caption) => caption.before))!
  const def = definitions.get(grouped.name)!
  const caption = grouped.captions!.find((item) => item.before)!
  const home = grouped.groups!.find((group) => group.fields.includes(caption.before!))!
  const elsewhere = grouped.groups!.find((group) => group !== home)!.fields[0]
  const moved = { ...grouped, captions: grouped.captions!.map((item) => item === caption ? { ...item, before: elsewhere } : item) }
  assert.ok(dataSurfacePositionIssues(def, moved).includes(`Placed outside the groupbox that holds it: ${caption.object}`), grouped.name)
})

test('on-screen data-entry DataWindows are never exempted as print or report layouts', () => {
  const members = classify().members as Record<string, string[]>
  for (const name of ['d_guestroom_detail', 'd_emp_employee', 'd_cashactivitymonitorlist', 'd_activemarkeditems']) {
    assert.ok(members['screen-control'].includes(name), name)
  }
})

test('fields on one row keep their left-to-right order despite a few units of vertical jitter', () => {
  // The old strict top-to-bottom sort put guaranteepersoncode (y 4, right) before custcode (y 8, left) on the same row.
  const form = surface('d_cust_guaranteeperson_search'), def = definitions.get('d_cust_guaranteeperson_search')!
  assert.deepEqual(form.fields.map((item) => item.object), ['custcode', 'guaranteepersoncode'])
  assert.ok(dataSurfacePositionIssues(def, { ...form, fields: [...form.fields].reverse() }).includes('Field order differs from the source reading order: custcode'))
  // The same holds for the always-hidden alternatives of d_advsaleheader_popup, which keep their source rows.
  const names = surface('d_advsaleheader_popup').fields.map((item) => item.object)
  assert.ok(names.indexOf('custrefno2') < names.indexOf('custrefno4'))
})

test('a report title over a tabular grid is a caption, not the first column\'s header', () => {
  const grid = surface('d_studentsiblings_suspeciousfordiscount')
  assert.equal(field(grid, 'regno').labelObject, 'regno_t')
  assert.deepEqual(grid.captions, [{ object: 't_1' }])
  const backlogText = readFileSync(resolve(import.meta.dirname, '..', '..', 'docs', 'ui-derived-modal-windows-backlog.json'), 'utf8')
  assert.ok(!backlogText.includes('columnNamedFields'))
})
