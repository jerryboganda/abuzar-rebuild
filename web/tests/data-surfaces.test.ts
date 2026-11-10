import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import type { DwDef } from '../src/dw/def.ts'
import { DATA_SURFACES, CRITERIA_DATA_SURFACES, TRANSACTION_DATA_SURFACES, dataSurfaceIssues, lookupSurfaceIssues } from '../src/ui/data-surfaces.ts'
import { CONTACT_DETAIL_SURFACE, CONTACT_LOOKUP_SURFACE } from '../src/ui/window-surfaces.ts'

const directory = new URL('../../data/src/dw/', import.meta.url)
const index = JSON.parse(readFileSync(new URL('_index.json', directory), 'utf8')) as Record<string, string>
function definition(name: string): DwDef {
  const bundle = JSON.parse(gunzipSync(readFileSync(new URL(index[name] + '.json.gz', directory))).toString('utf8')) as Record<string, DwDef>
  return structuredClone(bundle[name])
}

for (const surface of DATA_SURFACES) test(`${surface.name}: every real object has an explicit supported binding`, () => {
  assert.deepEqual(dataSurfaceIssues(definition(surface.name), surface), [])
})

test('criteria forms preserve every source field in its original visual order', () => {
  assert.equal(CRITERIA_DATA_SURFACES.length, 27)
  for (const surface of CRITERIA_DATA_SURFACES) {
    const def = definition(surface.name)
    assert.deepEqual(surface.fields.map((field) => field.object), def.objects.filter((object) => object.type === 'column')
      .sort((a, b) => Number(a.y) - Number(b.y) || Number(a.x) - Number(b.x)).map((object) => object.name))
    for (const field of surface.fields) assert.ok(def.objects.find((object) => object.name === field.labelObject)?.text?.trim() || field.label?.trim())
    assert.ok(dataSurfaceIssues(def, { ...surface, fields: surface.fields.slice(1) }).some((issue) => issue.startsWith('Unmapped object:')))
  }
})

test('criteria suffixes bind all source units and trailing captions without replacing field labels', () => {
  for (const [name, column, label, suffix] of [
    ['d_arg_percentage_reduce_raise', 'percentage', '', '%'],
    ['d_arg_top_n_customers', 'count', 'Show Top', 'Customer(s)'],
    ['d_arg_custref', 'custref', 'Replace Column', 'With Sale Invoice No. Column'],
  ]) {
    const surface = CRITERIA_DATA_SURFACES.find((surface) => surface.name === name)!
    const field = surface.fields.find((field) => field.object === column)!, def = definition(name)
    assert.equal(def.objects.find((object) => object.name === field.labelObject)!.text, label)
    assert.equal(field.suffixObject, 't_1')
    assert.equal(def.objects.find((object) => object.name === field.suffixObject)!.text, suffix)
    assert.deepEqual(dataSurfaceIssues(def, surface), [])
    assert.ok(dataSurfaceIssues(def, { ...surface, fields: surface.fields.map((field) => ({ ...field, suffixObject: undefined })) })
      .includes('Unmapped object: t_1'))
    assert.ok(dataSurfaceIssues(def, { ...surface, kind: 'grid' }).includes(`Field suffix requires a form layout: ${column}`))
    for (const suffixObject of ['missing', column, field.labelObject]) {
      const issues = dataSurfaceIssues(def, { ...surface, fields: surface.fields.map((item) =>
        item === field ? { ...item, suffixObject } : item) })
      assert.ok(issues.some((issue) => /Unsupported suffix|Duplicate suffix/.test(issue)))
    }
    def.objects.find((object) => object.name === field.suffixObject)!.band = 'footer'
    assert.ok(dataSurfaceIssues(def, surface).includes('Unsupported suffix: t_1'))
  }
})

test('percentage and top-customer criteria retain exact source codes, defaults and numeric limits', () => {
  const percentage = definition('d_arg_percentage_reduce_raise')
  assert.deepEqual(percentage.table.columns.map((column) => [column.name, column.initial, column.values]), [
    ['interventiontype', '1', 'Reduce\t1/Raise\t2/'], ['percentage', '0.00', undefined],
  ])
  assert.equal(percentage.table.columns[1].validation, 'real(gettext()) >=0 AND real(gettext()) <= 100')
  assert.equal(percentage.objects.find((object) => object.name === 'percentage')!['editmask.spinrange'], '0~100')
  const top = definition('d_arg_top_n_customers')
  assert.equal(top.table.columns[0].initial, '20')
  assert.equal(top.objects.find((object) => object.name === 'count')!['editmask.spinrange'], '1~9999999')
  const reference = definition('d_arg_custref')
  assert.equal(reference.table.columns[0].initial, '1')
  assert.equal(reference.table.columns[0].values, 'Cust Ref. 1\t1/Cust Ref. 2\t2/Cust Ref. 3\t3/Cust Ref. 4\t4/')
})

test('lookup criteria bind exact child definitions, keys, captions and live input policies', () => {
  const expected = [
    ['d_arg_academicclass2', 'classcode', 'ddd_active_academicclasses', 'code', 'name'],
    ['d_arg_activeclass_single', 'classcode', 'ddd_active_academicclasses', 'code', 'name'],
    ['d_arg_packlayout', 'packlayoutcode', 'ddd_packinglayout', 'packinglayoutcode', 'name'],
    ['d_arg_pricetype_markupperc', 'pricetypecode', 'ddd_pricetype_module', 'pricetypecode', 'name'],
    ['d_arg_servicetemplate_remarks', 'servicetemplatecode', 'ddd_servicetemplate_null', 'code', 'name'],
    ['d_arg_servicetemplate_remarks2', 'servicetemplatecode', 'ddd_servicetemplate_null', 'code', 'name'],
    ['d_arg_zone_details', 'zonecode', 'ddd_zones', 'zonecode', 'name'],
    ['d_arg_zone_details', 'manfcode', 'ddd_manf', 'code', 'name'],
    ['d_arg_quotation_customer_remarks', 'quotationcode', 'ddd_quotation', 'quotationcode', 'quotationcode'],
    ['d_arg_quotation_customer_remarks', 'custcode', 'ddd_customer', 'accounts_acccode', 'customer_name'],
    ['d_arg_svouchcode_lvouchcode', 'type', 'ddd_vouchercategory_posted', 'vochcatcode', 'name'],
  ]
  for (const [name, column, child, key, caption] of expected) {
    const surface = CRITERIA_DATA_SURFACES.find((surface) => surface.name === name)!
    const binding = surface.fields.find((field) => field.object === column)!.choice!
    assert.ok(binding.kind === 'lookup')
    assert.deepEqual([binding.name, binding.dataColumn, binding.displayColumn], [child, key, caption])
    assert.equal(!!binding.editable, name === 'd_arg_activeclass_single')
    const childDef = definition(child)
    assert.ok(childDef.table.columns.some((column) => column.name === key))
    assert.ok(childDef.table.columns.some((column) => column.name === caption))
    for (const [property, value] of [['name', 'd_unreviewed'], ['datacolumn', 'wrong_key'], ['displaycolumn', 'wrong_caption'],
      ['percentwidth', String((binding.percentWidth ?? 0) + 1)], ['lines', String((binding.lines ?? 0) + 1)]]) {
      assert.ok(dataSurfaceIssues(definition(name), surface, new Map([[`${column}.dddw.${property}`, value]]))
        .includes(`Lookup binding changed: ${column}`))
    }
  }
})

test('linked criteria retain readonly dependencies, remarks rules and date mask', () => {
  const zone = definition('d_arg_zone_details')
  assert.deepEqual(['zonecode', 'manfcode', 'distcode'].map((name) =>
    zone.objects.find((object) => object.name === name)!.tabsequence), ['10', '0', '0'])
  for (const name of ['d_arg_servicetemplate_remarks', 'd_arg_servicetemplate_remarks2', 'd_arg_quotation_customer_remarks']) {
    const remarks = definition(name).objects.find((object) => object.name === 'remarks')!
    assert.equal(remarks['edit.limit'], '100')
    assert.equal(remarks['edit.case'], name === 'd_arg_quotation_customer_remarks' ? 'any' : 'upper')
    assert.equal(remarks['edit.nilisnull'], name === 'd_arg_quotation_customer_remarks' ? 'no' : 'yes')
  }
  const dated = definition('d_arg_servicetemplate_remarks2')
  assert.equal(dated.table.columns.find((column) => column.name === 'date')!.initial, 'today')
  assert.equal(dated.objects.find((object) => object.name === 'date')!['editmask.mask'], 'dd/mm/yyyy')
  assert.equal(definition('d_arg_quotation_customer_remarks').table.columns.find((column) => column.name === 'custcode')!.initial, '19')
})

test('range criteria preserve distinct same-line labels and visual order over table order', () => {
  const voucher = CRITERIA_DATA_SURFACES.find((surface) => surface.name === 'd_arg_svouchcode_lvouchcode')!
  const invoice = CRITERIA_DATA_SURFACES.find((surface) => surface.name === 'd_arg_sinvcode_linvcode_singlerow')!
  assert.deepEqual(voucher.fields.map((field) => [field.object, field.labelObject]), [['type', 't_3'], ['svouchcode', 't_1'], ['lvouchcode', 't_2']])
  assert.deepEqual(invoice.fields.map((field) => [field.object, field.labelObject]), [['sinvcode', 't_1'], ['linvcode', 't_2']])
  assert.deepEqual(definition(invoice.name).table.columns.map((column) => column.initial), ['0', '100'])
  assert.deepEqual(definition(voucher.name).table.columns.map((column) => column.name), ['svouchcode', 'lvouchcode', 'type'])
  assert.equal(definition(invoice.name).objects.find((object) => object.name === 't_2')!.text, 'TO:')
})

test('static report criteria retain their exact lists, defaults and percentage spin ranges', () => {
  const zonal = definition('d_arg_zonaldailsale')
  assert.deepEqual(zonal.table.columns.map((column) => [column.name, column.initial, column.values]), [
    ['reporttype', '1', 'Item Summary\t1/Item Category Summary\t2/'],
    ['colname', '1', 'Unit Wise\t1/Value Wise\t2/'],
  ])
  assert.deepEqual(dataSurfaceIssues(zonal, CRITERIA_DATA_SURFACES.find((surface) => surface.name === 'd_arg_zonaldailsale')!), [])

  const margin = definition('d_arg_margin_markup_range')
  assert.deepEqual(margin.table.columns.map((column) => [column.name, column.initial, column.values]), [
    ['criteria', 'K', 'Mark-Up\tK/Margin\tG/'],
    ['startperc', '0', undefined],
    ['endperc', '15', undefined],
  ])
  for (const name of ['startperc', 'endperc']) {
    const object = margin.objects.find((candidate) => candidate.name === name)!
    assert.equal(object['editmask.spinrange'], '0~100')
    assert.equal(object['editmask.spinincr'], '1')
    assert.equal(object['editmask.required'], 'yes')
  }
  assert.deepEqual(dataSurfaceIssues(margin, CRITERIA_DATA_SURFACES.find((surface) => surface.name === 'd_arg_margin_markup_range')!), [])
})

test('distributor export criteria retain each exact static target-system list', () => {
  const expected = new Map([
    ['d_arg_distcode_targetsystem', 'Sales Analysis System (SAS)\tSAS/Daily Sales Reporting (DSR)\tDSR/'],
    ['d_arg_distcode_targetsystem_highq', 'Daily Sales Reporting (DSR)\tDSR/Master Stock And Sales Report (MSSR)\tMSSR/'],
    ['d_arg_distcode_targetsystem_masspharma', 'Daily Sales Reporting (DSA)\tDSA/'],
    ['d_arg_distcode_targetsystem_vikor', 'Daily Sales Reporting (DSR)\tDSR/'],
  ])
  for (const [name, values] of expected) {
    const def = definition(name), surface = CRITERIA_DATA_SURFACES.find((candidate) => candidate.name === name)!
    assert.deepEqual(surface.fields.map((field) => field.object), ['distcode', 'targetsys'])
    assert.deepEqual(surface.fields.map((field) => def.objects.find((object) => object.name === field.labelObject)?.text?.trim()),
      ['Dist. Code:', 'System:'])
    assert.equal(def.table.columns.find((column) => column.name === 'targetsys')!.values, values)
    assert.deepEqual(surface.fields[1].choice, { kind: 'list' })
    assert.equal(def.objects.find((object) => object.name === 'distcode')!['edit.limit'], '30')
    assert.deepEqual(dataSurfaceIssues(def, surface), [])
  }
})

test('criteria variants retain hidden defaults, readonly price and original monetary validation', () => {
  const city = definition('d_arg_distcode_city2')
  assert.equal(city.objects.find((object) => object.name === 'city')!.visible, '0')
  assert.equal(city.objects.find((object) => object.name === 't_1')!.visible, '0')
  assert.equal(city.table.columns.find((column) => column.name === 'city')!.initial, '.')
  assert.equal(city.objects.find((object) => object.name === 'city')!['edit.limit'], '60')
  assert.equal(definition('d_arg_saleprice_disabled').objects.find((object) => object.name === 'saleprice')!.tabsequence, '0')
  const price = definition('d_arg_saleprice_discperc')
  assert.equal(price.table.columns[0].validation, 'Real(GetText()) >= 0')
  assert.equal(price.table.columns[1].validation, 'Real(GetText()) >= 0 AND Real(GetText()) <= 100')
})

test('letter criteria keep three original multiline fields and distinct empty-text policy', () => {
  const def = definition('d_arg_letter'), surface = CRITERIA_DATA_SURFACES.find((surface) => surface.name === 'd_arg_letter')!
  assert.deepEqual(surface.fields.map((field) => [field.object, field.multiline]),
    [['arg_to', true], ['arg_subject', true], ['arg_detail', true]])
  for (const field of surface.fields) {
    assert.equal(def.objects.find((object) => object.name === field.object)!['edit.limit'], '4000')
    assert.equal(def.table.columns.find((column) => column.name === field.object)!.type, 'char(4000)')
  }
  assert.deepEqual(surface.fields.map((field) => def.objects.find((object) => object.name === field.object)!['edit.nilisnull']),
    ['yes', 'no', 'no'])
  const issues = dataSurfaceIssues(def, { ...surface, fields: surface.fields.map((field) => ({ ...field, multiline: false })) })
  assert.equal(issues.length, 3)
  assert.ok(issues.every((issue) => issue.startsWith('Multiline field requires')))
})

for (const surface of TRANSACTION_DATA_SURFACES) test(`${surface.name}: transaction field order and total band match source`, () => {
  const def = definition(surface.name)
  assert.deepEqual(surface.fields.map((field) => field.object), def.objects
    .filter((object) => object.band === 'detail').sort((a, b) => Number(a.x) - Number(b.x)).map((object) => object.name))
  assert.deepEqual(surface.bands!.flatMap((band) => band.fields.map((field) => field.object)),
    def.objects.filter((object) => ['summary', 'footer'].includes(object.band) && object.type === 'compute').map((object) => object.name))
  assert.ok(def.table.columns.some((column) => !surface.fields.some((field) => field.object === column.name)),
    'Hidden record keys remain outside the explicit presentation')
})

test('caption-only footer bands retain source instructions without inventing totals', () => {
  const def = definition('d_smstemplate_associatedrecipient')
  const surface = { name: def.name, title: 'Recipients', kind: 'grid' as const, fields: [
    { object: 'contactgroupcode', labelObject: 'contactgroupcode_t', choice: {
      kind: 'lookup' as const, name: 'ddd_contactgroup', dataColumn: 'contactgroupcode', displayColumn: 'name', percentWidth: 250,
    } },
  ], bands: [{ band: 'footer' as const, label: 'Template text', captions: ['t_1'], fields: [] }] }
  assert.deepEqual(dataSurfaceIssues(def, surface), [])
  assert.ok(dataSurfaceIssues(def, { ...surface, bands: [{ ...surface.bands[0], captions: [] }] })
    .includes('Missing totals content: footer'))
  assert.ok(dataSurfaceIssues(def, { ...surface, bands: [{ ...surface.bands[0], captions: ['missing_caption'] }] })
    .includes('Unsupported totals caption: missing_caption'))
})

test('header-band action buttons map as a form without inventing fields', () => {
  const def = definition('d_visit_footer')
  const buttons = def.objects.filter((object) => object.type === 'button')
    .sort((a, b) => Number(a.y) - Number(b.y) || Number(a.x) - Number(b.x))
    .map((object) => ({ object: object.name.toLowerCase() }))
  const surface = { name: def.name, title: 'Visit actions', kind: 'form' as const, fields: [], buttons }
  assert.deepEqual(dataSurfaceIssues(def, surface), [])
  assert.ok(dataSurfaceIssues(def, { ...surface, buttons: [] }).includes('No fields mapped'))
  assert.ok(dataSurfaceIssues(def, { ...surface, buttons: buttons.slice(1) }).includes('Unmapped object: b_registerpatient'))
  const moved = structuredClone(def)
  moved.objects.find((object) => object.name === 'b_rx')!.band = 'summary'
  assert.ok(dataSurfaceIssues(moved, surface).includes('Unsupported button: b_rx'))
})

test('totals cannot omit source objects or substitute editable/detail fields', () => {
  const surface = TRANSACTION_DATA_SURFACES[0], def = definition(surface.name), band = surface.bands![0]
  assert.ok(dataSurfaceIssues(def, { ...surface, bands: undefined }).includes('Unmapped object: compute_1'))
  def.objects.find((object) => object.name === 'compute_1')!.type = 'text'
  assert.ok(dataSurfaceIssues(def, surface).includes('Unsupported total: compute_1'))
  assert.ok(dataSurfaceIssues(def, { ...surface, bands: [{ ...band, fields: [{ object: 'debit', label: 'Amount' }] }] })
    .includes('Unsupported total: debit'))
})

test('totals require unique named bands, matching labels and grid-only presentation', () => {
  const surface = TRANSACTION_DATA_SURFACES[0], def = definition(surface.name), band = surface.bands![0]
  assert.ok(dataSurfaceIssues(def, { ...surface, kind: 'form' }).includes('Totals require a grid layout'))
  assert.ok(dataSurfaceIssues(def, { ...surface, bands: [band, band] }).includes('Totals bands must appear once in source order'))
  assert.ok(dataSurfaceIssues(def, { ...surface, bands: [{ ...band, fields: [{ object: 'compute_1' }] }] }).includes('Missing label: compute_1'))
  assert.ok(dataSurfaceIssues(def, { ...surface, bands: [{ ...band, fields: [{ object: 'compute_1', labelObject: 't_5' }] }] })
    .includes('Unsupported label: t_5'))
  assert.ok(lookupSurfaceIssues(def, surface).includes('Detailed lookups do not render totals bands'))
  def.objects.push({ name: 'unreviewed_total', type: 'compute', band: 'footer', expression: 'sum(debit for all)' })
  assert.ok(dataSurfaceIssues(def, surface).includes('Unmapped object: unreviewed_total'))
})

test('missing, reordered and empty totals bands cannot pass the presentation gate', () => {
  const surface = TRANSACTION_DATA_SURFACES[0], def = definition(surface.name), band = surface.bands![0]
  assert.ok(dataSurfaceIssues(def, { ...surface, bands: [band, { ...band, band: 'summary' }] })
    .includes('Totals bands must appear once in source order'))
  assert.ok(dataSurfaceIssues(def, { ...surface, bands: [{ ...band, label: '', fields: [] }] })
    .includes('Missing totals content: footer'))
  assert.ok(dataSurfaceIssues(def, { ...surface, bands: [{ ...band, fields: [...band.fields, ...band.fields] }] })
    .includes('Duplicate label: t_6'))
  delete def.bands.footer
  assert.ok(dataSurfaceIssues(def, surface).includes('Unsupported totals band: footer'))
})

test('zero-height and hidden source totals stay mapped, with visibility owned by the renderer', () => {
  const surface = TRANSACTION_DATA_SURFACES[0], def = definition(surface.name)
  def.bands.footer = { height: '0' }
  assert.deepEqual(dataSurfaceIssues(def, surface, new Map([['compute_1.visible', '0']])), [])
  def.objects.find((object) => object.name === 'compute_1')!.band = 'summary'
  assert.ok(dataSurfaceIssues(def, surface).includes('Unsupported total: compute_1'))
})

test('added objects cannot disappear behind a supposedly complete mapping', () => {
  const surface = DATA_SURFACES[0]
  const def = definition(surface.name)
  def.objects.push({ type: 'column', name: 'new_business_field', band: 'detail' })
  assert.ok(dataSurfaceIssues(def, surface).includes('Unmapped object: new_business_field'))
})

test('duplicate bindings and missing labels fail the mapping gate', () => {
  const surface = DATA_SURFACES[0]
  const def = definition(surface.name)
  assert.ok(dataSurfaceIssues(def, { ...surface, fields: [surface.fields[0], surface.fields[0]] }).some((issue) => issue.startsWith('Duplicate field')))
  assert.ok(dataSurfaceIssues(def, { ...surface, fields: [{ object: 'code' }, surface.fields[1]] }).includes('Missing label: code'))
})

test('dynamic selector styles cannot silently become plain text fields', () => {
  const surface = DATA_SURFACES[0]
  const def = definition(surface.name)
  def.objects.find((object) => object.name === 'name')!['dddw.name'] = 'synthetic_selector'
  assert.ok(dataSurfaceIssues(def, surface).some((issue) => issue.startsWith('Selector requires')))
})

test('contact members map every field and exact lookup identity without exposing hidden keys', () => {
  const def = definition(CONTACT_DETAIL_SURFACE.name)
  assert.deepEqual(dataSurfaceIssues(def, CONTACT_DETAIL_SURFACE), [])
  assert.equal(CONTACT_DETAIL_SURFACE.fields.length, 11)
  assert.ok(!CONTACT_DETAIL_SURFACE.fields.some((field) => ['code', 'acccode'].includes(field.object)))
  assert.ok(dataSurfaceIssues(def, CONTACT_DETAIL_SURFACE, new Map([['contactcardcode.dddw.name', 'd_changed']]))
    .includes('Lookup binding changed: contactcardcode'))
  assert.ok(dataSurfaceIssues(def, CONTACT_DETAIL_SURFACE, new Map([['contactcardcode.dddw.allowedit', 'yes']]))
    .some((issue) => issue.includes('Lookup binding changed')))
  assert.ok(dataSurfaceIssues(def, { ...CONTACT_DETAIL_SURFACE,
    fields: CONTACT_DETAIL_SURFACE.fields.map(({ choice, ...field }) => field) }).some((issue) => issue.startsWith('Selector requires')))
})

test('editable lookup casing is part of the reviewed input policy', () => {
  const surface = DATA_SURFACES.find((surface) => surface.name === 'd_arg_manf')!
  const def = definition(surface.name)
  assert.deepEqual(dataSurfaceIssues(def, surface), [])
  assert.ok(dataSurfaceIssues(def, surface, new Map([['manfcode.dddw.case', 'upper']]))
    .includes('Lookup binding changed: manfcode'))
})

test('source lookup row counts are explicit reviewed bindings and live changes fail the mapping gate', () => {
  for (const [name, column, lines] of [
    ['d_arg_manf', 'manfcode', 7], ['d_arg_manf2', 'manfcode', 7],
    ['d_change_purinv', 'purtypecode', 5], ['d_change_purinv', 'icatcode', 10],
    ['d_customer_category', 'customersegmentcode', 10],
    ['d_invbankpaymentdetail', 'acccode', 15], ['d_invcashpaymentdetail', 'acccode', 15],
    ['d_invcashreceiptdetail', 'acccode', 15],
  ] as const) {
    const surface = DATA_SURFACES.find((surface) => surface.name === name)!
    const def = definition(name)
    const binding = surface.fields.find((field) => field.object === column)!.choice!
    assert.equal(binding.kind, 'lookup')
    assert.equal(def.objects.find((object) => object.name === column)!['dddw.lines'], String(lines))
    assert.ok(binding.kind === 'lookup' && binding.lines === lines)
    for (const value of ['0', String(lines + 1)]) assert.ok(dataSurfaceIssues(def, surface,
      new Map([[`${column}.dddw.lines`, value]])).includes(`Lookup binding changed: ${column}`))
    assert.ok(dataSurfaceIssues(def, surface, new Map([[`${column}.dddw.lines`, 'invalid']]))
      .includes(`${column}: Lookup row count is unsupported`))
  }
})

test('automatic lists preserve source fields, detail columns and explicit focus behavior', () => {
  const generic = DATA_SURFACES.find((surface) => surface.name === 'd_arg_genericitemtype')!
  const margin = DATA_SURFACES.find((surface) => surface.name === 'd_changeitem_price_marginbased')!
  assert.deepEqual(lookupSurfaceIssues(definition('ddd_genericitemtype'), generic.fields[0].lookup!), [])
  assert.deepEqual(generic.fields[0].lookup!.fields.map((field) => field.object), ['code', 'name', 'description'])
  assert.deepEqual(margin.fields.map((field) => field.object), ['margintype', 'startingmarginperc', 'endingmarginperc'])
  assert.ok(!margin.fields.some((field) => ['code', 'name'].includes(field.object)))
  assert.ok(dataSurfaceIssues(definition(generic.name), generic, new Map([['genericitemtypecode.dddw.showlist', 'no']]))
    .includes('Automatic choice-list behavior changed: genericitemtypecode'))
  assert.ok(dataSurfaceIssues(definition(generic.name), generic, new Map([['genericitemtypecode.dddw.percentwidth', '100']]))
    .includes('Lookup binding changed: genericitemtypecode'))
  assert.ok(dataSurfaceIssues(definition(margin.name), margin, new Map([['margintype.ddlb.showlist', 'no']]))
    .includes('Automatic choice-list behavior changed: margintype'))
})

test('changed processing and group bands require a new mapping', () => {
  const surface = DATA_SURFACES[0]
  const def = definition(surface.name)
  def.datawindow.processing = '1'
  def.bands.group = [{ level: '1', by: { _items: ['#1'] } }]
  assert.deepEqual(dataSurfaceIssues(def, surface).slice(0, 2), ['Processing style changed', 'Grouped bands require an explicit mapping'])
})

test('remaining selector mappings preserve source field order and input variants', () => {
  const purchase = DATA_SURFACES.find((surface) => surface.name === 'd_change_purinv')!
  const def = definition(purchase.name)
  assert.deepEqual(purchase.fields.map((field) => field.object), def.objects.filter((object) => object.band === 'detail')
    .sort((left, right) => Number(left.x) - Number(right.x)).map((object) => object.name))
  assert.ok(!purchase.fields.some((field) => field.object === 'porb'))
  for (const [key, value] of [['allowedit', 'no'], ['case', 'upper']]) {
    assert.ok(dataSurfaceIssues(def, purchase, new Map([[`purinvpagesize.ddlb.${key}`, value]]))
      .includes('Code-table input policy changed: purinvpagesize'))
  }
  for (const name of ['d_customer_category', 'd_stockleder_inputs']) {
    const surface = DATA_SURFACES.find((surface) => surface.name === name)!
    const source = definition(name)
    const fields = surface.fields.filter((field) => field.choice?.kind === 'checkbox')
    assert.equal(fields.length, 2)
    for (const field of fields) {
      assert.equal(source.objects.find((object) => object.name === field.object)!['checkbox.text'], field.label)
      assert.ok(dataSurfaceIssues(source, surface, new Map([[`${field.object}.checkbox.lefttext`, 'no']]))
        .includes(`Checkbox binding changed: ${field.object}`))
    }
  }
})

test('contact lookup reviews all eleven original columns in display order, with no hidden account fields', () => {
  const surface = CONTACT_LOOKUP_SURFACE, def = definition(surface.name)
  assert.deepEqual(lookupSurfaceIssues(def, surface), [])
  assert.deepEqual(surface.fields.map((field) => field.object),
    ['code', 'contactcardname', 'title', 'name', 'address', 'phone', 'fax', 'email', 'mobile', 'useforsms', 'web'])
  assert.equal(def.objects.find((object) => object.name === 'contactcardname_t')?.text, 'Contactcardname')
  assert.ok(def.table.columns.some((column) => column.name === 'acccode'))
  assert.ok(def.table.columns.some((column) => column.name === 'accountname'))
  assert.ok(!surface.fields.some((field) => ['acccode', 'accountname'].includes(field.object)))
  assert.equal(CONTACT_DETAIL_SURFACE.fields.find((field) => field.object === 'contactcardcode')?.lookup, surface)
})

test('a detailed surface requires the exact declared lookup binding, not just a field name', () => {
  const def = definition(CONTACT_DETAIL_SURFACE.name)
  for (const replacement of [
    { ...CONTACT_LOOKUP_SURFACE, name: 'd_unreviewed' },
    { ...CONTACT_LOOKUP_SURFACE, kind: 'form' as const },
  ]) {
    const surface = { ...CONTACT_DETAIL_SURFACE, fields: CONTACT_DETAIL_SURFACE.fields.map((field) =>
      field.lookup ? { ...field, lookup: replacement } : field) }
    assert.ok(dataSurfaceIssues(def, surface).includes('Detailed lookup binding changed: contactcardcode'))
  }
  assert.ok(dataSurfaceIssues(def, { ...CONTACT_DETAIL_SURFACE, fields: CONTACT_DETAIL_SURFACE.fields.map((field) =>
    field.lookup ? { ...field, choice: undefined } : field) }).includes('Detailed lookup binding changed: contactcardcode'))
})

test('dynamic visibility, nested lookups and concealed formats never enter loaded-row search', () => {
  const surface = CONTACT_LOOKUP_SURFACE, def = definition(surface.name)
  for (const [key, value, reason] of [
    ['address.visible', '1\tif(code=1,1,0)', 'Dynamic lookup visibility: address'],
    ['address_t.visible', '0', 'Hidden or dynamic lookup header: address'],
    ['address_t.text', 'Address\tname', 'Dynamic lookup header text: address'],
    ['address.format', "'*****'", 'Lookup format requires a search contract: address'],
    ['address.dddw.name', 'd_nested', 'Selector requires a mapped interaction: address'],
  ]) {
    assert.ok(lookupSurfaceIssues(def, surface, new Map([[key, value]])).includes(reason), key)
  }
  assert.deepEqual(lookupSurfaceIssues(def, surface, new Map([['address.visible', '0'], ['address_t.visible', '0']])), [])
  def.objects.push({ name: 'hidden_extra', type: 'column', band: 'detail', visible: '0' })
  assert.ok(lookupSurfaceIssues(def, surface).includes('Unmapped object: hidden_extra'))
})

test('computed presentation objects require explicit readonly bindings and named columns', () => {
  const surface = DATA_SURFACES.find((surface) => surface.name === 'd_agingintervaldetail')!
  const def = definition(surface.name)
  assert.deepEqual(dataSurfaceIssues(def, surface), [])
  assert.ok(dataSurfaceIssues(def, { ...surface, fields: surface.fields.map(({ kind, ...field }) => field) })
    .includes('Unsupported field: compute_1'))
  assert.ok(dataSurfaceIssues(def, { ...surface, fields: surface.fields.map((field) => ({ ...field, label: undefined })) })
    .includes('Missing label: compute_2'))
  def.objects.find((object) => object.name === 'compute_1')!.type = 'column'
  assert.ok(dataSurfaceIssues(def, surface).includes('Unsupported field: compute_1'))
})
