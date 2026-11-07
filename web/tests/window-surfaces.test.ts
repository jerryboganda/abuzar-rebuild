import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { WINDOW_SURFACES, CALCULATOR_WINDOW_SURFACES, CRITERIA_WINDOW_SURFACES, LOOKUP_CRITERIA_WINDOWS, REFERENCE_CRITERIA_WINDOWS, NUMERIC_CRITERIA_WINDOWS, DATE_OPTION_CRITERIA_WINDOWS, DATE_CHOICE_CRITERIA_WINDOWS, windowSurfaceIssues, ENTRY_WINDOW_SURFACES, entryWindowIssues } from '../src/ui/window-surfaces.ts'
import { Runtime } from '../src/runtime/interp.ts'
import { entryControls } from '../src/ui/modern-entry-window.ts'
import { DATA_SURFACES, dataSurfaceIssues } from '../src/ui/data-surfaces.ts'
import { colKind, type DwDef } from '../src/dw/def.ts'
import { codeTable } from '../src/dw/choices.ts'
import { numericSpin } from '../src/ui/numeric-spin.ts'

for (const surface of CRITERIA_WINDOW_SURFACES) {
  test(`${surface.name}: criteria layout covers the complete inherited control tree`, async () => {
    const root = resolve(import.meta.dirname, '..', '..', 'data', 'src', 'objects')
    const rt = new Runtime({ load: async (name) => {
      const components = ['u_dwstandard', 'w_popup_forselection', 'w_popup_forselection_walias', 's_popup_selection']
      if (![surface.name, 'w_arguements', 's_arguements', ...components].includes(name)) return undefined
      const library = components.includes(name) ? 'components' : name === 's_arguements' ? 'reportviewer' :
        name === surface.name ? surface.library : 'reports'
      const kind = name === 'u_dwstandard' ? 'userobject' : ['s_arguements', 's_popup_selection'].includes(name) ? 'structure' : 'window'
      const definition = JSON.parse(readFileSync(resolve(root, library, kind, name + '.json'), 'utf8'))
      return { ...definition, routines: new Map() }
    } })
    const window = await rt.instantiate(surface.name)
    const controls = [...window.children.values()].map((control) => ({
      name: control.name, native: control.native, children: control.children.size,
    }))
    assert.equal(window.pbGet('windowtype'), 3)
    assert.deepEqual(windowSurfaceIssues(controls, surface), [])
    for (const binding of surface.data!) {
      assert.equal(window.children.get(binding.control)!.pbGet('dataobject'), binding.surface.name)
      assert.deepEqual(dataSurfaceIssues(dataDefinition(binding.surface.name), binding.surface), [])
    }
    for (const option of surface.options ?? []) {
      const dateOptions = DATE_OPTION_CRITERIA_WINDOWS.find((owner) => owner.name === surface.name)
      const dateChoice = DATE_CHOICE_CRITERIA_WINDOWS.find((owner) => owner.name === surface.name)
      assert.equal(window.children.get(option.control)!.pbGet('visible'), option.control === 'cbx_all' ||
        surface.name === 'w_arg_scode_lcode' && ['cbx_supress', 'cbx_hide'].includes(option.control) ||
        surface.name === 'w_arg_supp_label' && option.control === 'cbx_supress' ||
        [...(dateOptions?.checkboxes ?? []), ...(dateOptions?.radios ?? []), ...(dateChoice?.order ?? [])].includes(option.control))
      assert.ok(windowSurfaceIssues(controls, { ...surface, options: surface.options!.filter((item) => item !== option) })
        .includes(`Unmapped control: ${option.control}`))
      assert.ok(windowSurfaceIssues(controls.map((control) => control.name === option.control ?
        { ...control, native: 'singlelineedit' } : control), surface).includes(`Unsupported control: ${option.control}`))
    }
    if (surface.frame) {
      assert.ok(windowSurfaceIssues(controls, { ...surface, frame: 'cb_ok' }).includes('Unsupported control: cb_ok'))
      assert.ok(windowSurfaceIssues(controls, { ...surface, frame: undefined }).includes(`Unmapped control: ${surface.frame}`))
    }
    for (const caption of surface.captions ?? []) {
      assert.ok(windowSurfaceIssues(controls, { ...surface, captions: [...surface.captions!, caption] })
        .includes(`Duplicate binding: ${caption}`))
    }
    for (const name of surface.frames ?? []) {
      assert.ok(windowSurfaceIssues(controls, { ...surface, frames: [] }).includes(`Unmapped control: ${name}`))
      assert.ok(windowSurfaceIssues(controls, { ...surface, frames: [name, name] }).includes(`Duplicate binding: ${name}`))
      assert.ok(windowSurfaceIssues(controls, { ...surface, frames: ['cb_ok'] }).includes('Unsupported control: cb_ok'))
    }
    for (const list of surface.lists ?? []) {
      assert.ok(windowSurfaceIssues(controls, { ...surface, lists: [] }).includes(`Unmapped control: ${list.control}`))
      assert.ok(windowSurfaceIssues(controls, { ...surface, lists: [list, list] }).includes(`Duplicate binding: ${list.control}`))
      assert.ok(windowSurfaceIssues(controls, { ...surface, lists: [{ ...list, caption: 'cb_ok' }] })
        .includes('Unsupported control: cb_ok'))
    }
    if (surface.contentOrder) {
      for (const order of [surface.contentOrder.slice(1), [...surface.contentOrder, surface.contentOrder[0]],
        surface.contentOrder.map((name, index) => index ? name : 'cb_ok')]) {
        assert.ok(windowSurfaceIssues(controls, { ...surface, contentOrder: order })
          .includes('Content order must include every field, caption, frame, list, DataWindow and option once'))
      }
    }
    for (const data of surface.data ?? []) for (const label of data.labels ?? []) {
      for (const labels of [[{ ...label, field: 'unknown' }], [{ ...label, control: 'cb_ok' }], [label, label]]) {
        const issues = windowSurfaceIssues(controls, { ...surface,
          data: surface.data!.map((binding) => binding === data ? { ...binding, labels } : binding) })
        assert.ok(issues.some((issue) => /Unsupported data label|Duplicate data label/.test(issue)))
      }
    }
    assert.ok(windowSurfaceIssues([...controls, { name: 'future_control', native: 'statictext' }], surface)
      .includes('Unmapped control: future_control'))
    window.destroy()
  })
}

test('date-option layouts keep native source options and hidden data scoped to their owners', () => {
  for (const owner of DATE_OPTION_CRITERIA_WINDOWS) {
    const surface = CRITERIA_WINDOW_SURFACES.find((surface) => surface.name === owner.name)!
    const source = JSON.parse(readFileSync(resolve(import.meta.dirname, '..', '..', 'data', 'src',
      'objects', 'reports', 'window', owner.name + '.json'), 'utf8'))
    assert.equal(source.ancestor, 'w_arguements')
    assert.deepEqual(surface.fields, [
      { control: 'em_startdate', label: 'st_1' }, { control: 'em_enddate', label: 'st_2' },
    ])
    assert.deepEqual(surface.contentOrder!.slice(0, 2), ['em_startdate', 'em_enddate'])
    assert.equal(surface.data![0].surface.name, 'd_arg_cust')
    const control = source.controls.find((item: { name: string }) => item.name === 'dw_control')
    assert.equal(control.fields.find((item: { name: string }) => item.name === 'visible').value, false)
    for (const [controls, native] of [[owner.checkboxes, 'checkbox'], [owner.radios ?? [], 'radiobutton']] as const) {
      for (const name of controls) {
        const definition = source.controls.find((item: { name: string }) => item.name === name)
        assert.equal(definition.ancestor, native)
        assert.equal(definition.fields.find((item: { name: string }) => item.name === 'visible').value, true)
        assert.ok(definition.fields.find((item: { name: string; value: unknown }) => item.name === 'text' && item.value))
        assert.ok(surface.options!.some((option) => option.control === name && option.native === native))
      }
    }
  }
})

test('date-choice owners preserve scoped cost/payment choices and literal external labels', () => {
  for (const owner of DATE_CHOICE_CRITERIA_WINDOWS) {
    const surface = CRITERIA_WINDOW_SURFACES.find((surface) => surface.name === owner.name)!
    assert.deepEqual(surface.contentOrder!.slice(0, owner.order.length), owner.order)
    if (!owner.price) continue
    const binding = surface.data!.find((binding) => binding.control === 'dw_price')!
    const field = binding.surface.fields[0], definition = dataDefinition(binding.surface.name)
    assert.deepEqual(binding.labels, [{ field: field.object, control: 'st_4' }])
    assert.ok(!DATA_SURFACES.some((global) => global.name === binding.surface.name))
    assert.equal(definition.table.columns[0].initial, field.object === 'price' ? '6' : '1')
    if (field.object === 'price') {
      assert.deepEqual(field.choice, {
        kind: 'lookup', name: 'ddd_pricetype_avg_rpp', dataColumn: 'pricetypecode', displayColumn: 'name',
      })
      assert.match(dataDefinition('ddd_pricetype_avg_rpp').table.retrieve!, /PriceTypeCode IN \(5,6\)/)
    } else {
      assert.deepEqual(codeTable(definition, definition.objects[0]), [['Cash', '1'], ['Credit', '2'], ['Both', '3']])
    }
  }
})

test('zone/top-customer criteria bind a context-only editable zone and both original buffers', () => {
  const surface = CRITERIA_WINDOW_SURFACES.find((surface) => surface.name === 'w_arg_zone_sdate_ldate_top_n_customer')!
  const zone = surface.data![0], source = dataDefinition(zone.surface.name)
  assert.equal(zone.control, 'dw_control')
  assert.deepEqual(zone.labels, [{ field: 'zonecode', control: 'st_3' }])
  assert.equal(zone.surface.name, 'd_arg_zone')
  assert.ok(!DATA_SURFACES.some((surface) => surface.name === zone.surface.name))
  assert.equal(source.table.columns[0].initial, 'Null')
  assert.equal(source.objects[0]['dddw.allowedit'], 'yes')
  assert.deepEqual(zone.surface.fields[0].choice, {
    kind: 'lookup', name: 'ddd_zones', dataColumn: 'zonecode', displayColumn: 'name',
    editable: true, case: 'any', lines: 10, percentWidth: 100,
  })

  assert.deepEqual(surface.contentOrder!.slice(0, 5), ['st_3', 'dw_control', 'em_startdate', 'em_enddate', 'dw_custcount'])
  assert.equal(surface.data![1].surface.name, 'd_arg_top_n_customers')
})

test('item-selection preserves the source grid metadata while explicitly reflowing its one-row search form', () => {
    const surface = CRITERIA_WINDOW_SURFACES.find((surface) => surface.name === 'w_arg_items_sdate_ldate_topn')!
    const search = surface.data![0].surface, definition = dataDefinition(search.name)
    assert.equal(search.kind, 'form')
    assert.equal(search.sourceProcessing, 1)
    assert.deepEqual(dataSurfaceIssues(definition, search), [])
    assert.ok(dataSurfaceIssues(definition, { ...search, sourceProcessing: undefined }).includes('Processing style changed'))
    const changed = structuredClone(definition)
    changed.datawindow.processing = '0'
    assert.ok(dataSurfaceIssues(changed, search).includes('Processing style changed'))
    assert.deepEqual(search.fields.map((field) => field.object), ['aliasname', 'name'])
    assert.equal(definition.table.columns.find((column) => column.name === 'code')!.type, 'long')
    assert.ok(!search.fields.some((field) => field.object === 'code'))
    for (const binding of surface.data!.slice(0, 2)) {
      assert.ok(!DATA_SURFACES.some((global) => global.name === binding.surface.name))
    }
})

test('native date criteria retain their hidden contextual customer lookup without adding a global mapping', () => {
  for (const name of ['w_arg_sdate', 'w_arg_sdate_notime', 'w_arg_sdate_ldate']) {
    const surface = CRITERIA_WINDOW_SURFACES.find((surface) => surface.name === name)!
    const customer = surface.data![0]
    assert.equal(customer.control, 'dw_control')
    assert.equal(customer.surface.name, 'd_arg_cust')
    assert.deepEqual(customer.labels, [{ field: 'custcode', control: 'st_3' }])
    assert.ok(!DATA_SURFACES.some((surface) => surface.name === 'd_arg_cust'))
    assert.deepEqual(customer.surface.fields[0].choice, {
      kind: 'lookup', name: 'ddd_customer', dataColumn: 'accounts_acccode', displayColumn: 'customer_name',
      editable: true, case: 'any', lines: 10, percentWidth: 250,
    })
    const definition = JSON.parse(readFileSync(resolve(import.meta.dirname, '..', '..', 'data', 'src',
      'objects', 'reports', 'window', name + '.json'), 'utf8'))
    const property = (control: string, field: string) => definition.controls.find((item: { name: string }) =>
      item.name === control)?.fields.find((item: { name: string }) => item.name === field)?.value
    assert.equal(property('dw_control', 'visible'), false)
    assert.equal(property('st_3', 'visible'), false)
    if (name !== 'w_arg_sdate_ldate') assert.equal(property('em_enddate', 'visible'), false)
    if (name === 'w_arg_sdate_notime') assert.equal(property('em_startdate', 'mask'), 'dd/mm/yyyy')
  }
})

test('lookup criteria bind exact source keys and external captions without expanding the global catalog', () => {
  const result = JSON.parse(readFileSync(resolve(import.meta.dirname, '..', '..', 'data', 'src', 'objects',
    'reportviewer', 'structure', 's_arguements.json'), 'utf8'))
  assert.deepEqual(result.fields.filter((field: { name: string }) => ['i_hide', 'i_supress'].includes(field.name))
    .map((field: { name: string; type: string; value: unknown }) => [field.name, field.type, field.value]),
  [['i_supress', 'boolean', false], ['i_hide', 'boolean', false]])
  for (const [name, data] of LOOKUP_CRITERIA_WINDOWS) {
    const surface = CRITERIA_WINDOW_SURFACES.find((surface) => surface.name === name)!
    const binding = surface.data![0], source = dataDefinition(data), field = binding.surface.fields[0]
    assert.equal(binding.surface.name, data)
    assert.equal(surface.data!.length, 2, 'The single-zone owner must not acquire the top-customer count buffer')
    assert.deepEqual(binding.labels, [{ field: field.object, control: 'st_3' }])
    assert.deepEqual(dataSurfaceIssues(source, binding.surface), [])
    assert.equal(field.object, source.objects.find((object) => object.type === 'column')!.name)
    assert.equal(DATA_SURFACES.some((surface) => surface.name === data), data === 'd_arg_manf')
    if (data === 'd_arg_custrgroup') {
      assert.ok(source.table.columns.some((column) => column.name === 'itemgroupcode'))
      assert.ok(!binding.surface.fields.some((field) => field.object === 'itemgroupcode'))
    }
    if (data === 'd_arg_subacc') assert.equal(field.choice?.kind === 'lookup' && field.choice.showList, true)
  }
})

test('reference-text criteria share their exact source column and retain owner-specific external captions', () => {
  const definition = dataDefinition('d_arg_ref')
  assert.deepEqual(definition.table.columns.map((column: { name: string; type: string }) =>
    [column.name, column.type]), [['refno', 'char(100)']])
  assert.deepEqual(definition.objects.filter((object: { type: string }) => object.type === 'column')
    .map((object: { name: string; tabsequence: string }) => [object.name, object.tabsequence]), [['refno', '10']])
  assert.ok(!DATA_SURFACES.some((surface) => surface.name === 'd_arg_ref'))
  for (const [name, caption] of REFERENCE_CRITERIA_WINDOWS) {
    const surface = CRITERIA_WINDOW_SURFACES.find((surface) => surface.name === name)!
    const binding = surface.data![0]
    assert.equal(binding.surface.name, 'd_arg_ref')
    assert.deepEqual(binding.labels, [{ field: 'refno', control: 'st_3' }])
    assert.equal(surface.captions?.includes('st_3'), true)
    assert.equal(surface.data!.length, 2)
    assert.deepEqual(dataSurfaceIssues(definition, binding.surface), [])
    const owner = JSON.parse(readFileSync(resolve(import.meta.dirname, '..', '..', 'data', 'src', 'objects',
      'reports', 'window', name + '.json'), 'utf8'))
    assert.equal(owner.controls.find((control: { name: string }) => control.name === 'st_3')?.fields
      .find((field: { name: string }) => field.name === 'text')?.value, caption)
  }
})

test('numeric criteria preserve source field types, percentage rules and two external range captions', () => {
  for (const [name, data] of NUMERIC_CRITERIA_WINDOWS) {
    const surface = CRITERIA_WINDOW_SURFACES.find((surface) => surface.name === name)!
    const binding = surface.data![0], source = dataDefinition(data), fields = binding.surface.fields
    const range = fields.length === 2
    assert.deepEqual(fields.map((field) => field.object), source.table.columns.map((column) => column.name))
    assert.deepEqual(source.table.columns.map((column) => column.type), fields.map(() =>
      ['d_arg_discperc', 'd_arg_gstperc'].includes(data) ? 'decimal(2)' : 'long'))
    assert.deepEqual(binding.labels, fields.map((field, index) => ({ field: field.object, control: index ? 'st_2' : 'st_3' })))
    assert.deepEqual(surface.fields, [
      { control: 'em_startdate', label: 'st_1' }, { control: 'em_enddate', label: range ? 'st_4' : 'st_2' },
    ])
    assert.deepEqual(surface.captions, range ? ['st_3', 'st_2'] : ['st_3'])
    assert.ok(!DATA_SURFACES.some((surface) => surface.name === data))
    if (data === 'd_arg_days') {
      assert.equal(fields[0].labelBand, 'header')
      assert.ok(dataSurfaceIssues(source, { ...binding.surface, fields: [{ ...fields[0], labelBand: undefined }] })
        .includes('Unsupported label: day_t'))
      const changed = structuredClone(source)
      changed.objects.find((object) => object.name === 'day_t')!.band = 'detail'
      assert.ok(dataSurfaceIssues(changed, binding.surface).includes('Unsupported label: day_t'))
    }
    const owner = JSON.parse(readFileSync(resolve(import.meta.dirname, '..', '..', 'data', 'src', 'objects',
      'reports', 'window', name + '.json'), 'utf8'))
    for (const [index, field] of fields.entries()) {
      const object = source.objects.find((object) => object.name === field.object)!
      assert.equal(object.tabsequence, String((index + 1) * 10))
      const caption = owner.controls.find((control: { name: string }) => control.name === (index ? 'st_2' : 'st_3'))
      assert.equal(caption.fields.find((property: { name: string }) => property.name === 'text').value, field.label)
      const spin = numericSpin(object, colKind(source.table.columns[index].type))
      if (data === 'd_arg_discperc') {
        assert.deepEqual(spin, { kind: 'number', minimum: 0, maximum: 100, increment: 1 })
      } else assert.deepEqual(spin, { kind: 'none' })
    }
    if (['d_arg_discperc', 'd_arg_gstperc'].includes(data)) {
      assert.equal(source.table.columns[0].initial, '0')
      assert.match(source.table.columns[0].validation!, /real\(gettext\(\)\) >= 0 AND real\(gettext\(\)\) <= 100/i)
    }
    if (range) assert.deepEqual(surface.options!.slice(0, 2).map((option) => option.control), ['cbx_supress', 'cbx_hide'])
  }
})

for (const surface of WINDOW_SURFACES) {
  test(`${surface.name}: every recovered window control has an explicit Modern binding`, async () => {
    const definition = JSON.parse(readFileSync(resolve(import.meta.dirname, '..', '..', 'data', 'src', 'objects', surface.library, 'window', surface.name + '.json'), 'utf8'))
    assert.equal(definition.ancestor, 'window')
    assert.equal(definition.fields.find((field: { name: string }) => field.name === 'windowtype')?.value, 3)
    const rt = new Runtime({ load: async (name) => {
      const source = name === surface.name ? definition : name === 'u_dwstandard' ?
        JSON.parse(readFileSync(resolve(dataRoot, 'objects', 'components', 'userobject', name + '.json'), 'utf8')) : undefined
      return source ? { ...source, routines: new Map() } : undefined
    } })
    const window = await rt.instantiate(surface.name)
    const controls = [...window.children.values()].map((control) => ({
      name: control.name, native: control.native, children: control.children.size,
    }))
    assert.deepEqual(windowSurfaceIssues(controls, surface), [])
  })
}

test('cashier category binds every source field, retaining conditional choice protection and read-only amounts', () => {
  const surface = WINDOW_SURFACES.find((surface) => surface.name === 'w_cashierjobactivity_changecategory')!
  const binding = surface.data![0], definition = dataDefinition(binding.surface.name)
  assert.deepEqual(surface.actions, ['cb_ok', 'cb_cancel'])
  assert.equal(binding.control, 'dw_control')
  assert.deepEqual(dataSurfaceIssues(definition, binding.surface), [])
  assert.deepEqual(binding.surface.fields.map((field) => field.object), definition.objects
    .filter((object) => object.type === 'column')
    .sort((a, b) => Number(a.y) - Number(b.y) || Number(a.x) - Number(b.x)).map((object) => object.name))
  for (const name of ['catcode', 'acccode', 'supervised']) {
    assert.equal(definition.objects.find((object) => object.name === name)!.protect, '0\tif( cashcharged = amount, 1 , 0)')
  }
  for (const name of ['doccode', 'remarks', 'amount', 'cashcharged', 'cashback']) {
    assert.equal(definition.objects.find((object) => object.name === name)!.tabsequence, '0')
  }
  assert.ok(!DATA_SURFACES.some((global) => global.name === binding.surface.name))
})

test('cashier payment binds source documents, signed totals and tender fields while retaining its hidden print control', () => {
  const surface = WINDOW_SURFACES.find((surface) => surface.name === 'w_cashierjobactivity_cashtendered')!
  const definition = JSON.parse(readFileSync(resolve(dataRoot, 'objects', 'cashierjob', 'window', surface.name + '.json'), 'utf8'))
  assert.deepEqual(surface.data?.map((binding) => binding.control), ['dw_header', 'dw_cash'])
  assert.deepEqual(surface.actions, ['cb_print', 'cb_ok', 'cb_cancel'])
  assert.deepEqual(surface.auxiliary, ['dw_print'])
  const print = definition.controls.find((control: { name: string }) => control.name === 'dw_print')
  assert.equal(print.fields.find((field: { name: string }) => field.name === 'visible').value, false)
  assert.equal(print.fields.find((field: { name: string }) => field.name === 'dataobject').value, 'd_cashierjobactivity_multiinvoice_print')
  for (const binding of surface.data!) {
    const data = dataDefinition(binding.surface.name)
    assert.deepEqual(dataSurfaceIssues(data, binding.surface), [])
    assert.deepEqual(binding.surface.fields.map((field) => field.object), data.objects
      .filter((object) => object.band === 'detail' && ['column', 'compute'].includes(object.type))
      .sort((a, b) => Number(a.y) - Number(b.y) || Number(a.x) - Number(b.x)).map((object) => object.name))
    assert.ok(!DATA_SURFACES.some((global) => global.name === binding.surface.name))
  }
  const header = dataDefinition(surface.data![0].surface.name), cash = dataDefinition(surface.data![1].surface.name)
  assert.equal(header.objects.find((object) => object.name === 'c_total')!.expression, 'sum(amount * if(module=1, 1, -1) for all)')
  assert.equal(header.objects.find((object) => object.name === 'amount')!.tabsequence, '0')
  for (const name of ['cashcharged', 'cashback']) assert.equal(cash.objects.find((object) => object.name === name)!.tabsequence, '0')
  const controls = definition.controls.map((control: { name: string; ancestor: string }) => ({
    name: control.name, native: control.ancestor === 'u_dwstandard' ? 'datawindow' : control.ancestor,
  }))
  assert.deepEqual(windowSurfaceIssues(controls, surface), [])
  assert.ok(windowSurfaceIssues(controls, { ...surface, auxiliary: [] }).includes('Unmapped control: dw_print'))
  assert.ok(windowSurfaceIssues(controls, { ...surface, auxiliary: ['dw_print', 'dw_print'] }).includes('Duplicate binding: dw_print'))
  assert.ok(windowSurfaceIssues(controls, { ...surface, auxiliary: ['cb_print'] }).includes('Unsupported control: cb_print'))
})

test('cashier closing binds all three DataWindows in source display order, including separators and conditional figures', () => {
  const surface = WINDOW_SURFACES.find((surface) => surface.name === 'w_cashiershift_closing')!
  assert.deepEqual(surface.data?.map((binding) => binding.control), ['dw_detail', 'dw_cash', 'dw_figures'])
  const definition = JSON.parse(readFileSync(resolve(dataRoot, 'objects', 'cashierjob', 'window', surface.name + '.json'), 'utf8'))
  for (const binding of surface.data!) {
    const source = dataDefinition(binding.surface.name)
    assert.deepEqual(dataSurfaceIssues(source, binding.surface), [])
    const control = definition.controls.find((control: { name: string }) => control.name === binding.control)
    assert.equal(control.fields.find((field: { name: string }) => field.name === 'dataobject').value, binding.surface.name)
    assert.deepEqual(binding.surface.fields.map((field) => field.object), source.objects
      .filter((object) => object.band === 'detail' && ['column', 'compute'].includes(object.type))
      .sort((a, b) => Number(a.y) - Number(b.y) || Number(a.x) - Number(b.x)).map((object) => object.name))
    if (binding.control !== 'dw_cash') assert.ok(!DATA_SURFACES.some((global) => global.name === binding.surface.name))
  }
  const figures = surface.data![2].surface, source = dataDefinition(figures.name)
  for (const name of ['cashsales', 'netamt', 'diffamt', 'difftransferedto']) {
    assert.match(source.objects.find((object) => object.name === name)!.visible!, /shiftstatus = 'C'/)
  }
  assert.equal(source.objects.find((object) => object.name === 'compute_7')!.visible, '1')
  const invalid = [
    figures.separators!.slice(1), [...figures.separators!, figures.separators![0]],
    [...figures.separators!].reverse(),
    [{ object: 'l_6', before: 'missing' }, ...figures.separators!.slice(1)],
    [{ object: 't_3', before: 'amttransferedto' }, ...figures.separators!.slice(1)],
  ]
  for (const separators of invalid) assert.ok(dataSurfaceIssues(source, { ...figures, separators }).length)
  assert.ok(dataSurfaceIssues(source, { ...figures, kind: 'grid' }).includes('Separators require an ungrouped form layout'))
  const changed = structuredClone(source)
  changed.objects.find((object) => object.name === 'l_6')!.y2 = '10'
  assert.ok(dataSurfaceIssues(changed, figures).includes('Unsupported separator: l_6'))
})

test('associated advance-sale invoice picker maps its exact transaction grid and modal actions', () => {
  const surface = WINDOW_SURFACES.find((surface) => surface.name === 'w_assocadvsaleinvlist_form')!
  const definition = JSON.parse(readFileSync(resolve(import.meta.dirname, '..', '..', 'data', 'src', 'objects',
    surface.library, 'window', surface.name + '.json'), 'utf8'))
  assert.equal(surface.data?.length, 1)
  const grid = surface.data![0]
  assert.equal(definition.controls.find((control: { name: string }) => control.name === grid.control)
    .fields.find((field: { name: string }) => field.name === 'dataobject').value, grid.surface.name)
  assert.deepEqual(grid.surface.fields.map((field) => field.object), ['saleinvcode', 'netamt'])
  const sourceOrder = dataDefinition(grid.surface.name).objects.filter((object) =>
    object.band === 'detail' && (object.type === 'column' || object.type === 'compute'))
    .sort((a, b) => Number(a.y) - Number(b.y) || Number(a.x) - Number(b.x)).map((object) => object.name)
  assert.deepEqual(grid.surface.fields.map((field) => field.object), sourceOrder)
  assert.deepEqual(dataSurfaceIssues(dataDefinition(grid.surface.name), grid.surface), [])
  assert.deepEqual(surface.actions, ['cb_ok', 'cb_cancel'])
})

test('changed, missing, duplicate and nested controls cannot silently disappear in a Modern window', () => {
  const surface = WINDOW_SURFACES.find((surface) => surface.name === 'w_arg_amount')!
  const controls = [
    { name: 'em_val', native: 'editmask' }, { name: 'st_val', native: 'statictext' },
    { name: 'cb_ok', native: 'commandbutton' }, { name: 'cb_cancel', native: 'commandbutton' },
  ]
  assert.deepEqual(windowSurfaceIssues(controls, surface), [])
  assert.ok(windowSurfaceIssues([...controls, { name: 'new_field', native: 'singlelineedit' }], surface).some((issue) => issue.includes('Unmapped control')))
  assert.ok(windowSurfaceIssues(controls.slice(1), surface).some((issue) => issue.includes('em_val')))
  assert.ok(windowSurfaceIssues([...controls, controls[0]], surface).some((issue) => issue.includes('Duplicate control')))
  assert.ok(windowSurfaceIssues(controls.map((control) => ({ ...control, children: 1 })), surface).length)
  assert.ok(windowSurfaceIssues(controls, { ...surface, actions: ['cb_ok', 'cb_ok', 'cb_cancel'] }).some((issue) => issue.includes('Duplicate binding')))
})

for (const surface of CALCULATOR_WINDOW_SURFACES) {
  test(`${surface.name}: calculator layout retains every source control and scopes all DataWindow objects`, () => {
    const definition = JSON.parse(readFileSync(resolve(import.meta.dirname, '..', '..', 'data', 'src', 'objects',
      surface.library, 'window', surface.name + '.json'), 'utf8'))
    assert.equal(definition.ancestor, 'window')
    assert.equal(definition.fields.find((field: { name: string }) => field.name === 'windowtype')?.value, 3)
    const controls = definition.controls.map((control: { name: string; ancestor: string; controls: unknown[] }) => ({
      name: control.name, native: control.ancestor, children: control.controls.length,
    }))
    assert.deepEqual(windowSurfaceIssues(controls, surface), [])
    assert.equal(surface.data?.length, 1)
    for (const binding of surface.data ?? []) {
      const control = definition.controls.find((control: { name: string }) => control.name === binding.control)
      assert.equal(control.fields.find((field: { name: string }) => field.name === 'dataobject')?.value, binding.surface.name)
      const data = dataDefinition(binding.surface.name)
      assert.deepEqual(dataSurfaceIssues(data, binding.surface), [])
      assert.ok(!DATA_SURFACES.some((global) => global.name === binding.surface.name))
      const sourceOrder = data.objects.filter((object) => object.type === 'column' || object.type === 'compute')
        .sort((a, b) => Number(a.y) - Number(b.y) || Number(a.x) - Number(b.x)).map((object) => object.name)
      assert.deepEqual(binding.surface.fields.map((field) => field.object), sourceOrder)
    }
    assert.ok(windowSurfaceIssues(controls, { ...surface, data: [] }).some((issue) => issue.startsWith('Unmapped control')))
    assert.ok(windowSurfaceIssues(controls, { ...surface, data: [...surface.data!, ...surface.data!] })
      .some((issue) => issue.startsWith('Duplicate binding')))
  })
}

test('calculator group mappings cannot omit, repeat, reorder or misclassify source content', () => {
  const surface = CALCULATOR_WINDOW_SURFACES.find((surface) => surface.name === 'w_qty_rate_value_calculator')!.data![0].surface
  const def = dataDefinition(surface.name)
  assert.deepEqual(dataSurfaceIssues(def, surface), [])
  assert.ok(dataSurfaceIssues(def, { ...surface, groups: undefined }).includes('Unmapped object: gb_1'))
  const invalidGroups = [
    surface.groups!.slice(1),
    [...surface.groups!, surface.groups![0]],
    [...surface.groups!].reverse(),
    [{ ...surface.groups![0], fields: ['name'] }, surface.groups![1]],
    [{ ...surface.groups![0], object: 'name' }, surface.groups![1]],
    [{ ...surface.groups![0], object: 'missing' }, surface.groups![1]],
    [{ ...surface.groups![0], fields: [] }, surface.groups![1]],
  ]
  for (const groups of invalidGroups) assert.ok(dataSurfaceIssues(def, { ...surface, groups }).length)
  assert.ok(dataSurfaceIssues(def, { ...surface, kind: 'grid' }).includes('Field groups require a form layout'))
})

test('discount calculator radio mapping guards layout changes and preserves hidden source fields', () => {
  const surface = CALCULATOR_WINDOW_SURFACES.find((surface) => surface.name === 'w_discountcalculator')!.data![0].surface
  const def = dataDefinition(surface.name)
  assert.deepEqual(dataSurfaceIssues(def, surface), [])
  assert.ok(dataSurfaceIssues(def, surface, new Map([['type.radiobuttons.columns', '1']])).includes('Radio columns changed: type'))
  assert.ok(dataSurfaceIssues(def, { ...surface, kind: 'grid' }).includes('Radio choices require a form layout: type'))
  for (const name of ['saleprice', 'packunits', 'c_unitprice', 'discount']) {
    assert.equal(def.objects.find((object) => object.name === name)?.visible, '0')
    assert.ok(surface.fields.some((field) => field.object === name))
  }
})

test('aging entry mapping accounts for the entire recovered inherited control tree', async () => {
  const sources = new Map([
    ['w_entry_primitives', ['components', 'window']], ['w_multi_entry', ['components', 'window']],
    ['w_agingintervals', ['accounts', 'window']], ['u_dwstandard', ['components', 'userobject']],
  ])
  const rt = new Runtime({ load: async (name: string) => {
    const location = sources.get(name)
    if (!location) return undefined
    const definition = JSON.parse(readFileSync(resolve(import.meta.dirname, '..', '..', 'data', 'src', 'objects', ...location, name + '.json'), 'utf8'))
    definition.routines = new Map()
    return definition
  } })
  const window = await rt.instantiate('w_agingintervals')
  const controls = entryControls(window)
  assert.equal(controls.size, 23)
  assert.deepEqual(entryWindowIssues([...controls].map(([path, control]) => ({ path, native: control.native })), ENTRY_WINDOW_SURFACES[0]), [])
  assert.equal(controls.get('tab_retrieve.tabpage_detail.dw_footer')?.props.get('visible'), false)
  assert.equal(controls.get('tab_retrieve.tabpage_detail.dw_itemslist')?.props.get('visible'), false)
  assert.equal(controls.get('tab_retrieve.tabpage_detail.dw_detail')?.props.get('dataobject'), 'd_aginginterval')
})

test('entry layouts reject extra, missing, moved, duplicate and changed control paths', () => {
  const surface = ENTRY_WINDOW_SURFACES[0]
  assert.deepEqual(entryWindowIssues(surface.controls, surface), [])
  assert.ok(entryWindowIssues(surface.controls.slice(1), surface).length)
  assert.ok(entryWindowIssues([...surface.controls, { path: 'new_field', native: 'singlelineedit' }], surface).some((issue) => issue.startsWith('Unmapped')))
  assert.ok(entryWindowIssues([...surface.controls, surface.controls[0]], surface).includes('Duplicate control paths'))
  assert.ok(entryWindowIssues(surface.controls.map((control) => ({ ...control, native: 'singlelineedit' })), surface).length)
  assert.ok(entryWindowIssues(surface.controls.map((control) => ({ ...control, path: control.path.replace('tabpage_list', 'tabpage_detail') })), surface).length)
  assert.ok(entryWindowIssues(surface.controls, { ...surface, controls: [...surface.controls, surface.controls[0]] }).includes('Duplicate layout bindings'))
  assert.ok(entryWindowIssues(surface.controls, { ...surface, details: surface.details.slice(1) }).some((issue) => issue.startsWith('Unplaced detail')))
  assert.ok(entryWindowIssues(surface.controls, { ...surface, details: [...surface.details, surface.details[0]] }).some((issue) => issue.startsWith('Duplicate detail')))
  assert.ok(entryWindowIssues(surface.controls, { ...surface, details: [{ control: 'missing', kind: 'form' }] }).some((issue) => issue.startsWith('Unsupported detail')))
})

const dataRoot = resolve(import.meta.dirname, '..', '..', 'data', 'src')
const dataIndex: Record<string, string> = JSON.parse(readFileSync(resolve(dataRoot, 'dw', '_index.json'), 'utf8'))
const dataBundles = new Map<string, Record<string, DwDef>>()
function dataDefinition(name: string): DwDef {
  const library = dataIndex[name]
  assert.ok(library, `Missing DataWindow ${name}`)
  if (!dataBundles.has(library)) dataBundles.set(library, JSON.parse(gunzipSync(readFileSync(resolve(dataRoot, 'dw', library + '.json.gz'))).toString('utf8')))
  return dataBundles.get(library)![name]
}

const richerFields = new Map([
  ['w_checklistitem_form', [['code', 'name', 'autocheck'], ['name', 'code', 'autocheck']]],
  ['w_shift_form', [['code', 'name', 'description'], ['compute_1', 'code', 'name']]],
  ['w_taxcategory_form', [['code', 'name', 'taxperc'], ['name', 'code', 'taxperc']]],
  ['w_relation_form', [['code', 'name', 'description'], ['compute_1', 'code', 'name']]],
  ['w_diseasetype_form', [['code', 'name', 'description'], ['name', 'code']]],
  ['w_itembrand_form', [['code', 'name', 'description'], ['compute_1', 'code', 'name']]],
  ['w_itemcolour_form', [['code', 'name', 'description'], ['compute_1', 'code', 'name']]],
  ['w_itemfabric_form', [['code', 'name', 'description'], ['compute_1', 'code', 'name']]],
  ['w_itemsize_form', [['code', 'name', 'description'], ['compute_1', 'code', 'name']]],
  ['w_itemsleeve_form', [['code', 'name', 'description'], ['compute_1', 'code', 'name']]],
  ['w_itemstyle_form', [['code', 'name', 'description'], ['compute_1', 'code', 'name']]],
  ['w_itemyarn_form', [['code', 'name', 'description'], ['compute_1', 'code', 'name']]],
  ['w_model_form', [['code', 'name', 'description'], ['compute_1', 'code', 'name']]],
  ['w_rank_form', [['code', 'name', 'description'], ['compute_1', 'code', 'name']]],
  ['w_site_form', [['code', 'name', 'description'], ['compute_1', 'code', 'name']]],
  ['w_unit_form', [['code', 'name', 'description'], ['compute_1', 'code', 'name']]],
  ['w_county_form', [['code', 'name', 'description'], ['code', 'name', 'description']]],
  ['w_eyevision_form', [['code', 'name', 'description'], ['name', 'description', 'code']]],
  ['w_genericitemtype_form', [['code', 'name', 'description'], ['code', 'name', 'description']]],
  ['w_godowngroup_form', [['code', 'name', 'description'], ['code', 'name', 'description']]],
  ['w_iolpower_form', [['code', 'name', 'description'], ['name', 'description', 'code']]],
  ['w_itemdesign_form', [['code', 'name', 'description'], ['code', 'name', 'description']]],
  ['w_itemthickness_form', [['code', 'name', 'description'], ['name', 'description', 'code']]],
  ['w_resourcecategory_form', [['code', 'name', 'description'], ['code', 'name', 'description']]],
  ['w_school_form', [['code', 'name', 'description'], ['code', 'name', 'description']]],
  ['w_surgery_form', [['code', 'name', 'description'], ['name', 'description', 'code']]],
  ['w_surgeryprocedure_form', [['code', 'name', 'description'], ['name', 'description', 'code']]],
  ['w_ward_form', [['code', 'name', 'description'], ['code', 'name', 'description']]],
  ['w_author_form', [['code', 'name', 'remarks'], ['code', 'name', 'remarks']]],
  ['w_dosageunit_form', [['code', 'name', 'localdosageunit'], ['code', 'name', 'localdosageunit']]],
  ['w_grade_form', [['code', 'name', 'numericalfactor'], ['code', 'name', 'numericalfactor']]],
  ['w_class_form', [['code', 'name', 'numericalfactor'], ['code', 'name']]],
  ['w_itemclass_form', [['code', 'name', 'numericalfactor'], ['code', 'name']]],
  ['w_itempacking_form', [['code', 'name', 'numericalfactor'], ['code', 'name']]],
  ['w_measuringunit_form', [['code', 'name', 'measureqty'], ['code', 'name', 'measureqty']]],
  ['w_transportroute_form', [['code', 'name', 'transportcharges'], ['name', 'transportcharges', 'code']]],
  ['w_dischargerefferal_form', [['code', 'name'], ['name']]],
  ['w_vehicletype_form', [['code', 'name'], ['name', 'code']]],
  ['w_pctcodes_form', [['code', 'name', 'remarks'], ['name', 'remarks']]],
  ['w_tests_form', [['code', 'name', 'testprice'], ['code', 'name']]],
  ['w_itemmeter_form', [['code', 'name', 'description', 'currentreading'], ['name', 'description', 'code', 'currentreading']]],
  ['w_biometricmachine', [['code', 'name', 'manufacturer', 'model', 'ipaddress', 'port'], ['name', 'ipaddress', 'port', 'manufacturer', 'model', 'code']]],
  ['w_crs_clientlist', [['code', 'name', 'address1', 'address2', 'phone', 'phone2', 'fax', 'email', 'web', 'cp', 'cpphone', 'cpmobile'], ['code', 'name', 'address1', 'address2', 'phone', 'phone2', 'fax', 'email', 'web', 'cp', 'cpphone', 'cpmobile']]],
  ['w_custsector_form', [['code', 'name', 'aliasname', 'description'], ['name', 'aliasname', 'description', 'code']]],
  ['w_dosage_form', [['code', 'name', 'dosefactor', 'description', 'localdosage'], ['compute_1', 'code', 'name', 'localdosage']]],
  ['w_instruction_form', [['code', 'name', 'description', 'localinstruction'], ['compute_1', 'code', 'name', 'localinstruction']]],
  ['w_precaution_form', [['code', 'name', 'localprecaution'], ['name', 'localprecaution', 'code']]],
  ['w_region_form', [['code', 'name', 'manager', 'remarks'], ['code', 'name']]],
  ['w_route_form', [['code', 'name', 'description', 'localroute'], ['compute_1', 'code', 'name', 'localroute']]],
  ['w_saletype_form', [['code', 'name', 'description', 'counter'], ['code', 'name']]],
  ['w_weighingscale_form', [['code', 'name', 'manufacturer', 'model', 'scaleid', 'scaleidpos', 'barcodelen', 'itemstartpos', 'itemendpos', 'weightstartpos', 'weightendpos'], ['code', 'name', 'manufacturer', 'model', 'scaleid']]],
  ['w_goodscompany_form', [['code', 'name', 'address1', 'address2', 'city', 'country', 'phone', 'fax', 'email'], ['code', 'name']]],
])

test('entry registry has 43 Code/Name and 52 custom single-entry windows without duplicate identities', () => {
  const singles = ENTRY_WINDOW_SURFACES.filter((surface) => surface.family === 'single')
  assert.equal(singles.length, 95)
  assert.equal(singles.filter((surface) => !richerFields.has(surface.name)).length, 43)
  assert.equal(singles.filter((surface) => richerFields.has(surface.name)).length, 52)
  assert.equal(ENTRY_WINDOW_SURFACES.length, 98)
  assert.equal(new Set(ENTRY_WINDOW_SURFACES.map((surface) => surface.name)).size, ENTRY_WINDOW_SURFACES.length)
})

test('Contact Card retains all controls, exact fields, sorted choices and its hidden print companion', async () => {
  const surface = ENTRY_WINDOW_SURFACES.find((surface) => surface.name === 'w_contactcard_form')!
  const sources = new Map([
    ['w_entry_primitives', ['components', 'window']], ['w_multi_entry', ['components', 'window']],
    [surface.name, [surface.library, 'window']], ['u_dwstandard', ['components', 'userobject']],
  ])
  const rt = new Runtime({ load: async (name) => {
    const location = sources.get(name)
    if (!location) return undefined
    const definition = JSON.parse(readFileSync(resolve(dataRoot, 'objects', ...location, name + '.json'), 'utf8'))
    definition.routines = new Map()
    return definition
  } })
  const controls = entryControls(await rt.instantiate(surface.name))
  assert.equal(controls.size, 24)
  assert.deepEqual(entryWindowIssues([...controls].map(([path, control]) => ({ path, native: control.native })), surface), [])
  for (const name of ['dw_itemsdetail', 'dw_itemslist', 'dw_footer', 'dw_print']) {
    assert.equal(controls.get(`tab_retrieve.tabpage_detail.${name}`)?.props.get('visible'), false)
  }
  assert.equal(controls.get('tab_retrieve.tabpage_detail.dw_print')?.props.get('dataobject'), 'd_visitprescription_print')
  const detail = surface.details[0].surface!, list = surface.list!
  for (const [path, binding] of [['tab_retrieve.tabpage_detail.dw_detail', detail], ['tab_retrieve.tabpage_list.dw_list', list]] as const) {
    assert.equal(controls.get(path)?.props.get('dataobject'), binding.name)
    assert.deepEqual(dataSurfaceIssues(dataDefinition(binding.name), binding), [])
    assert.ok(!DATA_SURFACES.some((global) => global.name === binding.name))
  }
  assert.deepEqual(detail.fields.map((field) => field.object),
    ['code', 'acccode', 'title', 'name', 'address', 'phone', 'fax', 'email', 'mobile', 'useforsms', 'web'])
  assert.deepEqual(list.fields.map((field) => field.object),
    ['code', 'accountname', 'title', 'name', 'address', 'phone', 'fax', 'email', 'mobile', 'useforsms', 'web'])
  assert.ok(!detail.fields.find((field) => field.object === 'acccode')?.lookup, 'Nested account lookups are not reviewed for detailed browsing')
  const def = dataDefinition(detail.name)
  assert.deepEqual(codeTable(def, def.objects.find((object) => object.name === 'title')!),
    ['Mr.', 'Miss', 'Mrs.', 'M/S', 'C/O', 'Dr.', 'Prof.', 'H/Dr.'].map((title) => [title, title]))
  assert.ok(dataSurfaceIssues(def, detail, new Map([['title.ddlb.sorted', 'no']])).includes('Code-table order changed: title'))
  assert.ok(dataSurfaceIssues(def, detail, new Map([['address.edit.autohscroll', 'yes']]))
    .includes('Multiline field requires a matching form layout: address'))
  assert.ok(dataSurfaceIssues(def, { ...detail, fields: detail.fields.map(({ multiline, ...field }) => field) })
    .includes('Multiline field requires a matching form layout: address'))
})

test('contact-group layout retains every inherited control and scopes its member lookup grid', async () => {
  const surface = ENTRY_WINDOW_SURFACES.find((surface) => surface.name === 'w_contactgroup')!
  const sources = new Map([
    ['w_entry_primitives', ['components', 'window']], ['w_multi_entry', ['components', 'window']],
    [surface.name, [surface.library, 'window']], ['u_dwstandard', ['components', 'userobject']],
  ])
  const rt = new Runtime({ load: async (name) => {
    const location = sources.get(name)
    if (!location) return undefined
    const definition = JSON.parse(readFileSync(resolve(dataRoot, 'objects', ...location, name + '.json'), 'utf8'))
    definition.routines = new Map()
    return definition
  } })
  const controls = entryControls(await rt.instantiate(surface.name))
  assert.equal(controls.size, 23)
  assert.deepEqual(entryWindowIssues([...controls].map(([path, control]) => ({ path, native: control.native })), surface), [])
  const binding = surface.details.find((binding) => binding.control === 'dw_itemsdetail')!.surface!
  assert.equal(controls.get('tab_retrieve.tabpage_detail.dw_itemsdetail')?.props.get('dataobject'), binding.name)
  assert.deepEqual(dataSurfaceIssues(dataDefinition(binding.name), binding), [])
  assert.ok(!DATA_SURFACES.some((surface) => surface.name === binding.name))
})

for (const surface of ENTRY_WINDOW_SURFACES.filter((surface) => surface.family === 'single')) {
  test(`${surface.name}: exact inherited controls and contextual DataWindows match recovered metadata`, async () => {
    const sources = new Map([
      ['w_entry_primitives', ['components', 'window']], ['w_single_entry', ['components', 'window']],
      [surface.name, [surface.library, 'window']], ['u_dwstandard', ['components', 'userobject']],
    ])
    const rt = new Runtime({ load: async (name: string) => {
      const location = sources.get(name)
      if (!location) return undefined
      const definition = JSON.parse(readFileSync(resolve(dataRoot, 'objects', ...location, name + '.json'), 'utf8'))
      definition.routines = new Map()
      return definition
    } })
    const window = await rt.instantiate(surface.name)
    const controls = entryControls(window)
    assert.equal(controls.size, 22)
    assert.deepEqual(entryWindowIssues([...controls].map(([path, control]) => ({ path, native: control.native })), surface), [])
    for (const name of ['dw_print', 'dw_listprint']) assert.equal(controls.get(`tab_retrieve.tabpage_detail.${name}`)?.props.get('visible'), false)
    const detail = surface.details.find((binding) => binding.control === 'dw_detail')?.surface
    assert.ok(detail && surface.list)
    for (const [path, binding] of [
      ['tab_retrieve.tabpage_detail.dw_detail', detail],
      ['tab_retrieve.tabpage_list.dw_list', surface.list],
    ] as const) {
      const dataobject = controls.get(path)?.props.get('dataobject')
      assert.equal(typeof dataobject, 'string')
      assert.equal(String(dataobject).toLowerCase(), binding.name)
      assert.deepEqual(dataSurfaceIssues(dataDefinition(binding.name), binding), [])
      assert.deepEqual(binding.fields.map((field) => field.object),
        richerFields.get(surface.name)?.[binding === detail ? 0 : 1] ?? ['code', 'name'])
      assert.ok(!DATA_SURFACES.some((global) => global.name === binding.name), 'A context-only mapping must not change unrelated uses of the same DataWindow')
    }
    assert.equal(controls.get('tab_retrieve.tabpage_list.dw_find')?.props.get('dataobject'), 'd_find')
  })

  test('reviewed richer list layouts follow source horizontal positions, not export array order', () => {
    for (const surface of ENTRY_WINDOW_SURFACES.filter((entry) => richerFields.has(entry.name))) {
      const list = surface.list!
      const columns = dataDefinition(list.name).objects.filter((object) =>
        object.band === 'detail' && (object.type === 'column' || object.type === 'compute'))
      assert.ok(columns.every((object) => object.x?.trim() && Number.isFinite(Number(object.x))), list.name)
      const sourceOrder = [...columns].sort((a, b) => Number(a.x) - Number(b.x)).map((object) => object.name.toLowerCase())
      assert.deepEqual(list.fields.map((field) => field.object), sourceOrder, list.name)
    }
  })

  test('Resource Category declares its multiline Description and Grade retains decimal stepping', () => {
    const resource = ENTRY_WINDOW_SURFACES.find((surface) => surface.name === 'w_resourcecategory_form')!.details[0].surface!
    const description = dataDefinition(resource.name).objects.find((object) => object.name === 'description')!
    assert.equal(description['edit.autohscroll'], 'no')
    assert.equal(description['edit.autovscroll'], 'yes')
    assert.equal(resource.fields.find((field) => field.object === 'description')?.multiline, true)
    assert.ok(dataSurfaceIssues(dataDefinition(resource.name), {
      ...resource, fields: resource.fields.map(({ multiline, ...field }) => field),
    }).includes('Multiline field requires a matching form layout: description'))
    const grade = ENTRY_WINDOW_SURFACES.find((surface) => surface.name === 'w_grade_form')!.details[0].surface!
    const definition = dataDefinition(grade.name)
    assert.equal(definition.table.columns.find((column) => column.name === 'numericalfactor')?.type, 'decimal(2)')
    const factor = definition.objects.find((object) => object.name === 'numericalfactor')!
    assert.deepEqual(numericSpin(factor, 'decimal'), { kind: 'number', minimum: 0, maximum: 999, increment: 1 })
    assert.deepEqual(dataSurfaceIssues(definition, grade), [])
  })
}

test('richer masters retain original label identities, checkbox codes and computed row numbers', () => {
  const checklist = ENTRY_WINDOW_SURFACES.find((surface) => surface.name === 'w_checklistitem_form')!
  for (const binding of [checklist.details[0].surface!, checklist.list!]) {
    assert.deepEqual(binding.fields.find((field) => field.object === 'autocheck')?.choice, { kind: 'checkbox', on: 'Y', off: 'N' })
    assert.ok(dataSurfaceIssues(dataDefinition(binding.name), binding, new Map([['autocheck.checkbox.off', 'X']]))
      .includes('Checkbox binding changed: autocheck'))
    assert.ok(dataSurfaceIssues(dataDefinition(binding.name), { ...binding,
      fields: binding.fields.map(({ choice, ...field }) => field) }).includes('Selector requires a mapped interaction: autocheck'))
  }
  const shift = ENTRY_WINDOW_SURFACES.find((surface) => surface.name === 'w_shift_form')!
  assert.deepEqual(shift.list!.fields[0], { object: 'compute_1', labelObject: 't_5', kind: 'computed', numeric: true })
  assert.equal(dataDefinition(shift.list!.name).objects.find((object) => object.name === 'compute_1')?.expression, 'GetRow()')
  assert.ok(!shift.details[0].surface!.fields.some((field) => field.object === 'tmp'))
  const tax = ENTRY_WINDOW_SURFACES.find((surface) => surface.name === 'w_taxcategory_form')!
  assert.equal(tax.details[0].surface!.fields[0].labelObject, 'authorcode_t')
  assert.equal(tax.details[0].surface!.fields[2].labelObject, 'remarks_t')
  assert.equal(dataDefinition(tax.list!.name).objects.find((object) => object.name === 'taxperc_t')?.text, 'Taxperc')
  const relation = ENTRY_WINDOW_SURFACES.find((surface) => surface.name === 'w_relation_form')!
  assert.deepEqual(relation.details[0].surface!.fields.map((field) => field.labelObject), ['t_1', 'name_t', 't_2'])
  assert.deepEqual(relation.list!.fields[0], { object: 'compute_1', labelObject: 't_5', kind: 'computed', numeric: true })
  assert.equal(dataDefinition(relation.list!.name).objects.find((object) => object.name === 'compute_1')?.expression, 'GetRow()')
  for (const surface of ENTRY_WINDOW_SURFACES.filter((entry) => richerFields.has(entry.name))) {
    const serial = surface.list?.fields.find((field) => field.object === 'compute_1')
    if (serial) {
      assert.equal(serial.kind, 'computed', surface.name)
      assert.equal(serial.numeric, true, surface.name)
      assert.equal(dataDefinition(surface.list!.name).objects.find((object) => object.name === 'compute_1')?.expression, 'GetRow()', surface.name)
    }
  }
})
