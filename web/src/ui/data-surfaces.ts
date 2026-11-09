import type { DwDef, DwObject } from '../dw/def.ts'
import { colKind, splitExpr } from '../dw/def.ts'
import { numericSpin } from './numeric-spin.ts'
import { choiceStyle } from '../dw/choices.ts'
import type { DwChoiceBinding } from '../dw/choices.ts'
import { dwMultiline } from '../dw/edit.ts'

export interface DataSurfaceField {
  object: string
  labelObject?: string
  labelBand?: 'header' | 'detail'
  label?: string
  /** The source shows no caption for this field: `label` is only its accessible name and is not painted. */
  labelHidden?: boolean
  /** The source asks for stepping the Modern editor cannot honour (date mask, unbounded range); the field is edited as plain text, like the Classic view. */
  spinPlain?: boolean
  suffixObject?: string
  /** `computed` is a compute object; `button` is a per-row button in a grid (it raises the same Clicked event as the Classic button). */
  kind?: 'computed' | 'button'
  numeric?: boolean
  choice?: DwChoiceBinding
  lookup?: DataSurface
  multiline?: boolean
}

export interface DataSurface {
  name: string
  title: string
  kind: 'form' | 'grid'
  sourceProcessing?: 0 | 1
  fields: readonly DataSurfaceField[]
  /** Groupbox sections; one section with an empty `object` holds fields that sit outside every groupbox. */
  groups?: readonly { object: string; fields: readonly string[] }[]
  separators?: readonly { object: string; before?: string }[]
  /** Plain source text (a heading or note) that belongs to no field; placed before the named field in a form, above the table in a grid. */
  captions?: readonly { object: string; before?: string }[]
  /** DataWindow buttons in a form: real buttons that raise the same Clicked event the Classic view raises for that object. */
  buttons?: readonly { object: string; before?: string }[]
  /** Static artwork (bitmaps and drawn boxes) in the source; accounted for but not painted by the Modern layout. */
  decorations?: readonly string[]
  bands?: readonly {
    /** Totals bands, or the header/trailer of a group level (`header.1`, `trailer.1`) when `grouped` is set. */
    band: 'summary' | 'footer' | `header.${number}` | `trailer.${number}`
    label: string
    /** Source text in this band that names no total (for example a lone "Total:"), shown above the values. */
    captions?: readonly string[]
    fields: readonly Pick<DataSurfaceField, 'object' | 'labelObject' | 'label' | 'labelHidden' | 'numeric'>[]
  }[]
  /** The grid is sorted by the source's groups: each break shows the group bands listed in `bands`. */
  /** A grid with a multiline field shows each row this many single-line heights tall (the source's detail band height). */
  rowLines?: number
  grouped?: boolean
}

// Source geometry shared by the generators (web/tools/derive-*.ts) and the validators below, so a mapping is judged by the same rules
// that produced it.  Coordinates are the recovered PowerBuilder units of the definition.
const at = (object: DwObject | undefined, key: string) => Number(object?.[key] ?? 0)
const rightOf = (object: DwObject) => at(object, 'x') + at(object, 'width')
const bottomOf = (object: DwObject) => at(object, 'y') + at(object, 'height')
const middleOf = (object: DwObject) => at(object, 'y') + at(object, 'height') / 2
const sharedHeight = (a: DwObject, b: DwObject) => Math.min(bottomOf(a), bottomOf(b)) - Math.max(at(a, 'y'), at(b, 'y'))

/** A visibility that is always off: `0`, or an expression that is the constant 0 (`1<TAB>0`). Other expressions are dynamic. */
export function alwaysHidden(visible: string | undefined): boolean {
  if (visible === undefined) return false
  if (visible.trim() === '0') return true
  const { expr } = splitExpr(visible)
  return expr !== undefined && /^\s*0\s*$/.test(expr)
}

/**
 * An object the source never paints: it starts at or below the bottom of its band, or it sits in a header or detail band without height
 * (the Classic view hides such a band).  Totals bands without height stay mapped: the renderer skips them while their height is 0.
 */
export function clippedObject(def: DwDef, object: DwObject): boolean {
  const props = def.bands[object.band]
  if (!props || Array.isArray(props) || props.height === undefined || props.height === '') return false
  const height = Number(props.height)
  if (!Number.isFinite(height)) return false
  if (height === 0) return object.band === 'header' || object.band === 'detail'
  return height > 0 && Number(object.y ?? 0) >= height
}

/** A caption on the field's own row, ending left of it. */
export function captionBeside(text: DwObject, field: DwObject): boolean {
  return Math.abs(middleOf(text) - middleOf(field)) <= Math.max(at(field, 'height'), 40) && rightOf(text) <= at(field, 'x') + 8
}

/**
 * A caption stacked directly above its field: left edges aligned (within half the narrower of the two), a short gap.  A heading that
 * spans the form is not the caption of whichever field happens to sit below it.
 */
export function captionAbove(text: DwObject, field: DwObject): boolean {
  return bottomOf(text) <= at(field, 'y') + 8 && at(field, 'y') - bottomOf(text) <= Math.max(at(field, 'height') * 2, 120) &&
    Math.abs(at(text, 'x') - at(field, 'x')) <= Math.max(Math.min(at(text, 'width'), at(field, 'width')) * 0.5, 100)
}

/** Another field sits between a row caption and the field: that nearer field owns the caption. */
export function fieldBetween(text: DwObject, field: DwObject, peers: readonly DwObject[]): boolean {
  return peers.some((other) => other !== field && at(other, 'x') >= rightOf(text) - 8 && rightOf(other) <= at(field, 'x') + 8 &&
    sharedHeight(other, field) >= 0.5 * Math.min(at(other, 'height'), at(field, 'height')) && sharedHeight(other, text) > 0)
}

/** Trailing text directly beside its field on the same row ("%", "Customer(s)", "(L)"). */
export function suffixBeside(text: DwObject, field: DwObject): boolean {
  return Math.abs(middleOf(text) - middleOf(field)) <= Math.max(at(field, 'height'), 40) && at(text, 'x') >= rightOf(field) - 8 &&
    at(text, 'x') - rightOf(field) <= 120
}

/** Two fields painted over each other (mutually exclusive alternatives a script or expression switches between). */
export function sameBox(a: DwObject, b: DwObject): boolean {
  const width = Math.min(rightOf(a), rightOf(b)) - Math.max(at(a, 'x'), at(b, 'x'))
  const height = sharedHeight(a, b)
  return width > 0 && height > 0 && width * height > 0.5 * Math.min(at(a, 'width') * at(a, 'height'), at(b, 'width') * at(b, 'height'))
}

/** Same row for reading order: the vertical extents share most of the shorter one. */
function sameReadingRow(a: DwObject, b: DwObject): boolean {
  return sharedHeight(a, b) >= 0.6 * Math.min(Math.max(1, at(a, 'height')), Math.max(1, at(b, 'height')))
}

/** Reading order of a form: rows top to bottom (fields sharing a row despite a few units of jitter stay one row), left to right. */
export function readingOrder<T extends DwObject>(objects: readonly T[]): T[] {
  const rows: T[][] = []
  for (const object of [...objects].sort((a, b) => at(a, 'y') - at(b, 'y') || at(a, 'x') - at(b, 'x'))) {
    const row = rows.at(-1)
    if (row && row.some((member) => sameReadingRow(member, object))) row.push(object)
    else rows.push([object])
  }
  return rows.flatMap((row) => row.sort((a, b) => at(a, 'x') - at(b, 'x') || at(a, 'y') - at(b, 'y')))
}

/** PowerBuilder's grid hides a column's header with the column; the header is the text painted exactly over it. */
export function exactHeader(text: DwObject, column: DwObject): boolean {
  return Math.abs(at(text, 'x') - at(column, 'x')) <= 2 && Math.abs(at(text, 'width') - at(column, 'width')) <= 10
}

/** The smallest groupbox of the detail band that holds the centre of an object. */
export function holderBox(boxes: readonly DwObject[], object: DwObject): DwObject | undefined {
  const cx = at(object, 'x') + at(object, 'width') / 2, cy = middleOf(object)
  return boxes.filter((box) => cx >= at(box, 'x') && cx <= rightOf(box) && cy >= at(box, 'y') && cy <= bottomOf(box))
    .sort((a, b) => at(a, 'width') * at(a, 'height') - at(b, 'width') * at(b, 'height'))[0]
}

const accountChoice: DwChoiceBinding = { kind: 'lookup', name: 'ddd_allaccounts', dataColumn: 'acccode', displayColumn: 'name' }

export const CRITERIA_DATA_SURFACES: readonly DataSurface[] = [
  { name: 'd_arg_percentage_reduce_raise', title: 'Percentage adjustment', kind: 'form', fields: [
    { object: 'interventiontype', labelObject: 'interventiontype_t', choice: { kind: 'list' } },
    { object: 'percentage', labelObject: 'percentage_t', label: 'Percentage', suffixObject: 't_1' },
  ] },
  { name: 'd_arg_top_n_customers', title: 'Top customers', kind: 'form', fields: [
    { object: 'count', labelObject: 'count_t', suffixObject: 't_1' },
  ] },
  { name: 'd_arg_custref', title: 'Replace customer reference', kind: 'form', fields: [
    { object: 'custref', labelObject: 'custref_t', suffixObject: 't_1', choice: { kind: 'list' } },
  ] },
  { name: 'd_arg_academicclass2', title: 'Class', kind: 'form', fields: [
    { object: 'classcode', labelObject: 't_1',
      choice: { kind: 'lookup', name: 'ddd_active_academicclasses', dataColumn: 'code', displayColumn: 'name', percentWidth: 150, lines: 20 } },
  ] },
  { name: 'd_arg_activeclass_single', title: 'Class', kind: 'form', fields: [
    { object: 'classcode', labelObject: 'classcode_t',
      choice: { kind: 'lookup', name: 'ddd_active_academicclasses', dataColumn: 'code', displayColumn: 'name',
        editable: true, case: 'any', percentWidth: 150, lines: 10 } },
  ] },
  { name: 'd_arg_packlayout', title: 'Packing layout', kind: 'form', fields: [
    { object: 'packlayoutcode', labelObject: 'packlayoutcode_t',
      choice: { kind: 'lookup', name: 'ddd_packinglayout', dataColumn: 'packinglayoutcode', displayColumn: 'name', percentWidth: 120, lines: 7 } },
  ] },
  { name: 'd_arg_pricetype_markupperc', title: 'Price type and mark-up', kind: 'form', fields: [
    { object: 'pricetypecode', labelObject: 'pricetypecode_t',
      choice: { kind: 'lookup', name: 'ddd_pricetype_module', dataColumn: 'pricetypecode', displayColumn: 'name', percentWidth: 100, lines: 10 } },
    { object: 'markupperc', labelObject: 'markupperc_t' },
  ] },
  ...['d_arg_servicetemplate_remarks', 'd_arg_servicetemplate_remarks2'].map((name): DataSurface => ({
    name, title: 'Service template criteria', kind: 'form', fields: [
      { object: 'servicetemplatecode', labelObject: 't_1',
        choice: { kind: 'lookup', name: 'ddd_servicetemplate_null', dataColumn: 'code', displayColumn: 'name', percentWidth: 200, lines: 10 } },
      { object: 'remarks', labelObject: 't_2' },
      ...(name === 'd_arg_servicetemplate_remarks2' ? [{ object: 'date', labelObject: 't_3' }] : []),
    ],
  })),
  { name: 'd_arg_zone_details', title: 'Zone details', kind: 'form', fields: [
    { object: 'zonecode', labelObject: 't_1',
      choice: { kind: 'lookup', name: 'ddd_zones', dataColumn: 'zonecode', displayColumn: 'name', percentWidth: 120, lines: 10 } },
    { object: 'manfcode', labelObject: 't_2',
      choice: { kind: 'lookup', name: 'ddd_manf', dataColumn: 'code', displayColumn: 'name' } },
    { object: 'distcode', labelObject: 't_3' },
  ] },
  { name: 'd_arg_quotation_customer_remarks', title: 'Quotation and customer', kind: 'form', fields: [
    { object: 'quotationcode', labelObject: 'quotationcode_t',
      choice: { kind: 'lookup', name: 'ddd_quotation', dataColumn: 'quotationcode', displayColumn: 'quotationcode' } },
    { object: 'custcode', labelObject: 'custcode_t',
      choice: { kind: 'lookup', name: 'ddd_customer', dataColumn: 'accounts_acccode', displayColumn: 'customer_name' } },
    { object: 'remarks', labelObject: 'remarks_t' },
  ] },
  { name: 'd_arg_svouchcode_lvouchcode', title: 'Voucher range', kind: 'form', fields: [
    { object: 'type', labelObject: 't_3',
      choice: { kind: 'lookup', name: 'ddd_vouchercategory_posted', dataColumn: 'vochcatcode', displayColumn: 'name', percentWidth: 200, lines: 10 } },
    { object: 'svouchcode', labelObject: 't_1' }, { object: 'lvouchcode', labelObject: 't_2' },
  ] },
  { name: 'd_arg_sinvcode_linvcode_singlerow', title: 'Invoice range', kind: 'form', fields: [
    { object: 'sinvcode', labelObject: 't_1' }, { object: 'linvcode', labelObject: 't_2' },
  ] },
  ...['d_arg_distcode_targetsystem', 'd_arg_distcode_targetsystem_highq',
    'd_arg_distcode_targetsystem_masspharma', 'd_arg_distcode_targetsystem_vikor'].map((name): DataSurface => ({
    name, title: 'Distributor export target', kind: 'form', fields: [
      { object: 'distcode', labelObject: 'distcode_t' },
      { object: 'targetsys', labelObject: 'targetsys_t', choice: { kind: 'list' } },
    ],
  })),
  { name: 'd_arg_zonaldailsale', title: 'Zonal daily sales report', kind: 'form', fields: [
    { object: 'reporttype', labelObject: 'reporttype_t', choice: { kind: 'list' } },
    { object: 'colname', labelObject: 'colname_t', choice: { kind: 'list' } },
  ] },
  { name: 'd_arg_margin_markup_range', title: 'Margin and mark-up range', kind: 'form', fields: [
    { object: 'criteria', labelObject: 'criteria_t', choice: { kind: 'list', sorted: true } },
    { object: 'startperc', labelObject: 'startperc_t' },
    { object: 'endperc', labelObject: 'endperc_t' },
  ] },
  { name: 'd_arg_distcode', title: 'Dist. Code', kind: 'form', fields: [
    { object: 'distcode', labelObject: 'distcode_t' },
  ] },
  ...['d_arg_distcode_city', 'd_arg_distcode_city2'].map((name): DataSurface => ({
    name, title: 'Dist. Code / Distrib. City', kind: 'form', fields: [
      { object: 'distcode', labelObject: 'distcode_t' }, { object: 'city', labelObject: 't_1' },
    ],
  })),
  { name: 'd_arg_otbill', title: 'OT Bill', kind: 'form', fields: [
    { object: 'amount', labelObject: 'amount_t' },
  ] },
  ...['d_arg_saleprice', 'd_arg_saleprice_disabled'].map((name): DataSurface => ({
    name, title: 'Sale Price', kind: 'form', fields: [{ object: 'saleprice', labelObject: 'saleprice_t' }],
  })),
  { name: 'd_arg_saleprice_discperc', title: 'Sale Price / Disc %', kind: 'form', fields: [
    { object: 'saleprice', labelObject: 'saleprice_t' }, { object: 'discperc', labelObject: 't_1' },
  ] },
  { name: 'd_arg_letter', title: 'Letter', kind: 'form', fields: [
    { object: 'arg_to', labelObject: 'arg_to_t', multiline: true },
    { object: 'arg_subject', labelObject: 'arg_subject_t', multiline: true },
    { object: 'arg_detail', labelObject: 'arg_detail_t', multiline: true },
  ] },
]

export const TRANSACTION_DATA_SURFACES: readonly DataSurface[] = [
  { name: 'd_invbankpaymentdetail', title: 'Invoice bank payments', kind: 'grid', fields: [
    { object: 'c_rowid', labelObject: 't_1', kind: 'computed', numeric: true },
    { object: 'invcode', labelObject: 'obj_6051972' }, { object: 'acccode', labelObject: 't_2',
      choice: { ...accountChoice, percentWidth: 265, lines: 15 } },
    { object: 'chkno', labelObject: 't_3' }, { object: 'remarks', labelObject: 't_4' },
    { object: 'debit', labelObject: 't_5' },
  ], bands: [{ band: 'footer', label: 'Totals', fields: [{ object: 'compute_1', labelObject: 't_6', numeric: true }] }] },
  { name: 'd_invbankreceiptdetail', title: 'Invoice bank receipts', kind: 'grid', fields: [
    { object: 'c_rowid', labelObject: 't_1', kind: 'computed', numeric: true },
    { object: 'invcode', labelObject: 'obj_6051972' }, { object: 'acccode', labelObject: 't_2', choice: accountChoice },
    { object: 'chkno', labelObject: 't_3' }, { object: 'remarks', labelObject: 't_4' },
    { object: 'credit', labelObject: 't_5' },
  ], bands: [{ band: 'footer', label: 'Totals', fields: [{ object: 'c_totalamt', labelObject: 't_6', numeric: true }] }] },
  { name: 'd_invcashpaymentdetail', title: 'Invoice cash payments', kind: 'grid', fields: [
    { object: 'c_rowid', labelObject: 't_1', kind: 'computed', numeric: true },
    { object: 'invcode', labelObject: 'obj_1531031' }, { object: 'acccode', labelObject: 't_3',
      choice: { ...accountChoice, percentWidth: 265, lines: 15 } },
    { object: 'remarks', labelObject: 't_2' }, { object: 'debit', labelObject: 't_4' },
  ], bands: [{ band: 'footer', label: 'Totals', fields: [{ object: 'c_totalamt', labelObject: 't_5', numeric: true }] }] },
  { name: 'd_invcashreceiptdetail', title: 'Invoice cash receipts', kind: 'grid', fields: [
    { object: 'c_rowid', labelObject: 't_2', kind: 'computed', numeric: true },
    { object: 'invcode', labelObject: 'obj_16009820' }, { object: 'acccode', labelObject: 'obj_16021067',
      choice: { ...accountChoice, percentWidth: 235, lines: 15 } },
    { object: 'remarks', labelObject: 'obj_16035848' }, { object: 'credit', labelObject: 'obj_16041626' },
  ], bands: [{ band: 'footer', label: 'Totals', fields: [{ object: 'c_totalamt', labelObject: 't_1', numeric: true }] }] },
  { name: 'd_cashiershift_cashdenomination', title: 'Cash denominations', kind: 'grid', fields: [
    { object: 'type', labelObject: 'type_t', choice: { kind: 'list' } },
    { object: 'currencycode', labelObject: 'currencycode_t',
      choice: { kind: 'lookup', name: 'ddd_currency', dataColumn: 'code', displayColumn: 'name' } },
    { object: 'name', labelObject: 'name_t' }, { object: 'denomination', labelObject: 'denomination_t' },
    { object: 'qty', labelObject: 'qty_t' }, { object: 'c_amount', labelObject: 't_1', kind: 'computed', numeric: true },
  ], bands: [{ band: 'summary', label: 'Change left', fields: [{ object: 'c_totalamount', labelObject: 't_2', numeric: true }] }] },
  { name: 'd_assocadvsaleinvlist', title: 'Associated advance sale invoices', kind: 'grid', fields: [
    { object: 'saleinvcode', labelObject: 'saleinvcode_t' }, { object: 'netamt', labelObject: 'netamt_t' },
  ], bands: [{ band: 'summary', label: 'Totals', fields: [{ object: 'totalamount', labelObject: 't_1', numeric: true }] }] },
]

// Explicit bindings reviewed against the recovered definitions, not coordinate/name heuristics.
export const DATA_SURFACES: readonly DataSurface[] = [
  { name: 'd_aginginterval', title: 'Aging interval', kind: 'form', fields: [
    { object: 'code', labelObject: 'agingintervalcode_t' }, { object: 'name', labelObject: 'name_t' },
  ] },
  { name: 'd_agingintervallist', title: 'Aging intervals', kind: 'grid', fields: [
    { object: 'code', labelObject: 'code_t' }, { object: 'name', labelObject: 'name_t' },
  ] },
  { name: 'd_agingintervaldetail', title: 'Aging interval limits', kind: 'grid', fields: [
    { object: 'compute_1', labelObject: 't_1', kind: 'computed', numeric: true },
    { object: 'compute_2', labelObject: 't_2', label: 'Comparison', kind: 'computed' },
    { object: 'limit', labelObject: 'limit_t' },
  ] },
  { name: 'd_contactgroup', title: 'Contact group', kind: 'form', fields: [
    { object: 'code', labelObject: 'contactgroupcode_t' }, { object: 'name', labelObject: 'name_t' },
  ] },
  { name: 'd_contactgrouplist', title: 'Contact groups', kind: 'grid', fields: [
    { object: 'code', labelObject: 'contactgroupcode_t' }, { object: 'name', labelObject: 'name_t' },
  ] },
  { name: 'd_summaryaccount_list', title: 'Summary accounts', kind: 'grid', fields: [
    { object: 'code', labelObject: 'code_t' }, { object: 'aliasname', labelObject: 'aliasname_t' },
    { object: 'name', labelObject: 'name_t' },
  ] },
  { name: 'd_arg_date', title: 'Date', kind: 'form', fields: [{ object: 'date', label: 'Date' }] },
  ...['d_arg_manf', 'd_arg_manf2'].map((name): DataSurface => ({
    name, title: 'Manufacturer', kind: 'form', fields: [{ object: 'manfcode', label: 'Manufacturer',
      choice: { kind: 'lookup', name: 'ddd_manufacturer', dataColumn: 'manfcode', displayColumn: 'name',
        editable: true, case: 'any', percentWidth: 100, lines: 7 } }],
  })),
  ...TRANSACTION_DATA_SURFACES,
  { name: 'd_arg_genericitemtype', title: 'Generic item type', kind: 'form', fields: [
    { object: 'genericitemtypecode', label: 'Generic item type',
      choice: { kind: 'lookup', name: 'ddd_genericitemtype', dataColumn: 'code', displayColumn: 'name', showList: true, percentWidth: 200 },
      lookup: { name: 'ddd_genericitemtype', title: 'Generic item types', kind: 'grid', fields: [
        { object: 'code', labelObject: 'code_t', numeric: true },
        { object: 'name', labelObject: 'name_t' }, { object: 'description', labelObject: 'description_t' },
      ] } },
  ] },
  { name: 'd_changeitem_price_marginbased', title: 'Margin criteria', kind: 'form', fields: [
    { object: 'margintype', labelObject: 't_3', choice: { kind: 'list', sorted: true, showList: true } },
    { object: 'startingmarginperc', labelObject: 't_1' }, { object: 'endingmarginperc', labelObject: 't_2' },
  ] },
  { name: 'd_change_purinv', title: 'Purchase invoice changes', kind: 'grid', fields: [
    { object: 'date', labelObject: 'date_t' }, { object: 'code', labelObject: 'code_t' },
    { object: 'supplier', labelObject: 'supplier_t' }, { object: 'invtotal', labelObject: 'invtotal_t' },
    { object: 'purtypecode', labelObject: 'purtypecode_t',
      choice: { kind: 'lookup', name: 'ddd_purchasetype', dataColumn: 'purtypecode', displayColumn: 'name', lines: 5 } },
    { object: 'icatcode', labelObject: 'icatcode_t',
      choice: { kind: 'lookup', name: 'ddd_itemcategory', dataColumn: 'icatcode', displayColumn: 'name', showList: true, percentWidth: 250, lines: 10 } },
    { object: 'suppinvcode', labelObject: 'suppinvcode_t' }, { object: 'suppinvdate', labelObject: 'suppinvdate_t' },
    { object: 'suppinvamount', labelObject: 'suppinvamount_t' }, { object: 'creditdays', labelObject: 'creditdays_t' },
    { object: 'c_duedate', labelObject: 'c_duedate_t', kind: 'computed' }, { object: 'remarks', labelObject: 'remarks_t' },
    { object: 'purinvpagesize', labelObject: 'purinvpagesize_t', choice: { kind: 'list', editable: true, case: 'any' } },
  ] },
  { name: 'd_customer_category', title: 'Customer category', kind: 'form', fields: [
    { object: 'code', labelObject: 't_1' }, { object: 'name', labelObject: 'name_t' },
    { object: 'customersegmentcode', labelObject: 't_2',
      choice: { kind: 'lookup', name: 'ddd_customersegment', dataColumn: 'customersegmentcode',
        displayColumn: 'name', percentWidth: 100, lines: 10 } },
    { object: 'allowincashsale', label: 'Allow In Cash Sale:', choice: { kind: 'checkbox', on: 'Y', off: 'N', leftText: true } },
    { object: 'allowincreditsale', label: 'Allow In Credit Sale:', choice: { kind: 'checkbox', on: 'Y', off: 'N', leftText: true } },
  ] },
  { name: 'd_stockleder_inputs', title: 'Stock ledger inputs', kind: 'form', fields: [
    { object: 'purgestockledger', label: 'Purge Item Stock Ledger (Build From Scratch)',
      choice: { kind: 'checkbox', on: 'Y', off: 'N', leftText: true } },
    { object: 'updatebasetables', label: 'Update Base Transaction Tables (Takes Time)',
      choice: { kind: 'checkbox', on: 'Y', off: 'N', leftText: true } },
  ] },
  ...CRITERIA_DATA_SURFACES,
]

export function dataSurfaceIssues(def: DwDef, surface: DataSurface, overrides?: ReadonlyMap<string, string>): string[] {
  const issues: string[] = []
  const objects = new Map(def.objects.map((object) => [object.name.toLowerCase(), object]))
  const used = new Set<string>()
  if (objects.size !== def.objects.length) issues.push('Duplicate object identities')
  const processing = surface.sourceProcessing ?? (surface.kind === 'grid' ? 1 : 0)
  if (Number(def.datawindow.processing ?? 0) !== processing) issues.push('Processing style changed')
  const groupLevels = new Map(((def.bands.group ?? []) as { level: string; 'header.height'?: string; 'trailer.height'?: string }[]).map((group) => [Number(group.level), group]))
  if (groupLevels.size && !surface.grouped) issues.push('Grouped bands require an explicit mapping')
  if (surface.grouped && (!groupLevels.size || surface.kind !== 'grid')) issues.push('Group bands require a grouped grid')
  if (surface.rowLines !== undefined && (surface.kind !== 'grid' || !Number.isInteger(surface.rowLines) || surface.rowLines < 2 || surface.rowLines > 12 || !surface.fields.some((field) => field.multiline))) {
    issues.push('Row lines need a grid with a multiline field')
  }
  if (!surface.fields.length && !(surface.kind === 'form' && (surface.buttons?.length || surface.captions?.length))) issues.push('No fields mapped')
  // An object the source never paints (below its band, or in a header or detail band without height) is decoration, never content.
  const painted = (name: string | undefined) => {
    const object = name ? objects.get(name) : undefined
    if (object && clippedObject(def, object)) issues.push(`Not painted by the source: ${name}`)
  }
  // A caption may name several fields only when they are painted over each other (alternatives the source switches between).
  const labelOwners = new Map<string, string>()
  for (const field of surface.fields) {
    const object = objects.get(field.object)
    if (!object || object.type !== (field.kind === 'computed' ? 'compute' : field.kind === 'button' ? 'button' : 'column') || object.band !== 'detail') issues.push(`Unsupported field: ${field.object}`)
    if (field.kind === 'button' && surface.kind !== 'grid') issues.push(`Button fields require a grid layout: ${field.object}`)
    if (used.has(field.object)) issues.push(`Duplicate field: ${field.object}`)
    used.add(field.object)
    painted(field.object)
    if (field.labelObject) {
      const label = objects.get(field.labelObject)
      if (!label || label.type !== 'text' || label.band !== (field.labelBand ?? (processing === 1 ? 'header' : 'detail'))) issues.push(`Unsupported label: ${field.labelObject}`)
      if (!label?.text?.trim() && !field.label?.trim()) issues.push(`Missing label: ${field.object}`)
      const owner = labelOwners.get(field.labelObject)
      const shared = owner !== undefined && !!object && !!objects.get(owner) && sameBox(objects.get(owner)!, object)
      if (used.has(field.labelObject) && !shared) issues.push(`Duplicate label: ${field.labelObject}`)
      // A reviewed one-row criteria form may name its field by a header text (`labelBand: 'header'`), which its window replaces by an
      // external caption; every other caption must be one the source paints.
      if (owner === undefined) { labelOwners.set(field.labelObject, field.object); if (!(surface.kind === 'form' && field.labelBand === 'header')) painted(field.labelObject) }
      used.add(field.labelObject)
    } else if (!field.label?.trim()) issues.push(`Missing label: ${field.object}`)
    if (field.labelHidden && !field.label?.trim()) issues.push(`Hidden label needs an accessible name: ${field.object}`)
    if (field.labelHidden && field.labelObject && objects.get(field.labelObject)?.text?.trim()) issues.push(`Hidden label hides a source caption: ${field.object}`)
    if (field.suffixObject) {
      const suffix = objects.get(field.suffixObject)
      if (surface.kind !== 'form') issues.push(`Field suffix requires a form layout: ${field.object}`)
      if (!suffix || suffix.type !== 'text' || suffix.band !== 'detail') issues.push(`Unsupported suffix: ${field.suffixObject}`)
      if (used.has(field.suffixObject)) issues.push(`Duplicate suffix: ${field.suffixObject}`)
      used.add(field.suffixObject)
      painted(field.suffixObject)
    }
    if (object) {
      const style = choiceStyle(object, overrides)
      const otherSelector = Object.keys(object).some((key) => /^(checkbox|radiobuttons)\./.test(key)) ||
        [...(overrides?.keys() ?? [])].some((key) => key.startsWith(`${field.object}.checkbox.`) || key.startsWith(`${field.object}.radiobuttons.`))
      if (otherSelector && !(style.kind === 'checkbox' && field.choice?.kind === 'checkbox' || style.kind === 'radio' && field.choice?.kind === 'radio') ||
        style.kind !== 'none' && !field.choice) issues.push(`Selector requires a mapped interaction: ${field.object}`)
      if (field.choice) {
        if (style.kind === 'unsupported') issues.push(`${field.object}: ${style.reason}`)
        else if (style.kind !== field.choice.kind) issues.push(`Choice style changed: ${field.object}`)
        else if ((style.kind === 'list' || style.kind === 'lookup') &&
          (field.choice.kind === 'list' || field.choice.kind === 'lookup') && !!style.showList !== !!field.choice.showList) {
          issues.push(`Automatic choice-list behavior changed: ${field.object}`)
        }
        else if (style.kind === 'lookup' && field.choice.kind === 'lookup' &&
          (style.name !== field.choice.name || style.dataColumn !== field.choice.dataColumn || style.displayColumn !== field.choice.displayColumn ||
            style.percentWidth !== field.choice.percentWidth || style.lines !== field.choice.lines ||
            !!style.editable !== !!field.choice.editable || style.editable && style.case !== field.choice.case)) {
          issues.push(`Lookup binding changed: ${field.object}`)
        }
        else if (style.kind === 'checkbox' && field.choice.kind === 'checkbox' &&
          (style.on !== field.choice.on || style.off !== field.choice.off || !!style.leftText !== !!field.choice.leftText)) {
          issues.push(`Checkbox binding changed: ${field.object}`)
        }
        else if (style.kind === 'list' && field.choice.kind === 'list' &&
          (!!style.editable !== !!field.choice.editable || style.editable && style.case !== field.choice.case)) {
          issues.push(`Code-table input policy changed: ${field.object}`)
        }
        else if (style.kind === 'list' && field.choice.kind === 'list' && !!style.sorted !== !!field.choice.sorted) {
          issues.push(`Code-table order changed: ${field.object}`)
        }
        else if (style.kind === 'radio' && field.choice.kind === 'radio' && style.columns !== field.choice.columns) {
          issues.push(`Radio columns changed: ${field.object}`)
        }
        if (field.choice.kind === 'radio' && surface.kind !== 'form') issues.push(`Radio choices require a form layout: ${field.object}`)
      }
    }
    if (field.lookup && (field.choice?.kind !== 'lookup' || field.choice.editable || field.lookup.name !== field.choice.name || field.lookup.kind !== 'grid')) {
      issues.push(`Detailed lookup binding changed: ${field.object}`)
    }
    if (object) {
      const column = def.table.columns.find((column) => column.name.toLowerCase() === field.object)
      const multiline = dwMultiline(object, column ? colKind(column.type) : '', overrides)
      if (!!field.multiline !== multiline || field.multiline && surface.kind === 'grid' && !surface.rowLines) {
        issues.push(`Multiline field requires a matching form layout: ${field.object}`)
      }
      const spin = numericSpin(object, column ? colKind(column.type) : '', overrides)
      if (spin.kind === 'unsupported' && !field.spinPlain) issues.push(`${field.object}: ${spin.reason}`)
      if (spin.kind !== 'unsupported' && field.spinPlain) issues.push(`Plain-spin acknowledgement not needed: ${field.object}`)
    }
  }
  if (surface.groups) {
    if (surface.kind !== 'form') issues.push('Field groups require a form layout')
    const grouped: string[] = []
    if (surface.groups.filter((group) => group.object === '').length > 1) issues.push('Only one ungrouped section is allowed')
    for (const group of surface.groups) {
      if (group.object !== '') {
        const object = objects.get(group.object)
        if (!object || object.type !== 'groupbox' || object.band !== 'detail') issues.push(`Unsupported group: ${group.object}`)
        if (used.has(group.object)) issues.push(`Duplicate group: ${group.object}`)
        used.add(group.object)
        painted(group.object)
      }
      if (!group.fields.length) issues.push(`Empty group: ${group.object}`)
      grouped.push(...group.fields)
    }
    if (grouped.length !== surface.fields.length || grouped.some((name, index) => name !== surface.fields[index]?.object)) {
      issues.push('Field groups must contain every field once in presentation order')
    }
  }
  if (surface.separators) {
    if (surface.kind !== 'form' || surface.groups) issues.push('Separators require an ungrouped form layout')
    let previous = -1
    for (const separator of surface.separators) {
      const object = objects.get(separator.object)
      if (!object || object.type !== 'line' || object.band !== 'detail' ||
        Number(object.y1) !== Number(object.y2) || !(Number(object.x2) > Number(object.x1))) {
        issues.push(`Unsupported separator: ${separator.object}`)
      }
      if (used.has(separator.object)) issues.push(`Duplicate separator: ${separator.object}`)
      used.add(separator.object)
      painted(separator.object)
      const position = separator.before === undefined ? surface.fields.length :
        surface.fields.findIndex((field) => field.object === separator.before)
      if (position < 0 || position <= previous) issues.push(`Invalid separator order: ${separator.object}`)
      previous = position
    }
  }
  if (surface.captions) {
    const captionBand = surface.kind === 'grid' ? 'header' : 'detail'
    for (const caption of surface.captions) {
      const object = objects.get(caption.object)
      if (!object || object.type !== 'text' || object.band !== captionBand) issues.push(`Unsupported caption: ${caption.object}`)
      if (used.has(caption.object)) issues.push(`Duplicate caption: ${caption.object}`)
      used.add(caption.object)
      painted(caption.object)
      if (caption.before !== undefined && !surface.fields.some((field) => field.object === caption.before)) issues.push(`Invalid caption position: ${caption.object}`)
      // A grid's column header travels with its column: the header of a hidden column is never a free caption.
      const column = surface.kind === 'grid' && object ? def.objects.find((item) => (item.type === 'column' || item.type === 'compute') &&
        item.band === 'detail' && alwaysHidden(item.visible) && exactHeader(object, item)) : undefined
      if (column && !alwaysHidden(object!.visible)) issues.push(`Header of a hidden column mapped as a caption: ${caption.object}`)
    }
  }
  if (surface.buttons) {
    if (surface.kind !== 'form') issues.push('Buttons require a form layout')
    for (const button of surface.buttons) {
      const object = objects.get(button.object)
      if (!object || object.type !== 'button' || object.band !== 'detail') issues.push(`Unsupported button: ${button.object}`)
      if (used.has(button.object)) issues.push(`Duplicate button: ${button.object}`)
      used.add(button.object)
      painted(button.object)
      if (button.before !== undefined && !surface.fields.some((field) => field.object === button.before)) issues.push(`Invalid button position: ${button.object}`)
    }
  }
  for (const name of surface.decorations ?? []) {
    const object = objects.get(name)
    const clipped = !!object && clippedObject(def, object)
    // Static artwork, or any object the source never paints (below its band, or in a header or detail band without height), is accounted
    // for and not painted.  Text, columns and computed values in the background layer are painted content, never decoration.
    const art = !!object && (object.type === 'line' || ['bitmap', 'rectangle', 'roundrectangle', 'ellipse'].includes(object.type) && !['summary', 'footer'].includes(object.band))
    if (!object || !(clipped || art)) issues.push(`Unsupported decoration: ${name}`)
    if (used.has(name)) issues.push(`Duplicate decoration: ${name}`)
    used.add(name)
  }
  if (surface.bands) {
    if (surface.kind !== 'grid') issues.push('Totals require a grid layout')
    const seen = new Set<string>()
    for (const band of surface.bands) {
      const group = /^(header|trailer)\.(\d+)$/.exec(band.band)
      if (group) {
        if (!surface.grouped || !groupLevels.has(Number(group[2]))) issues.push(`Unsupported group band: ${band.band}`)
        if (seen.has(band.band)) issues.push('Totals bands must appear once in source order')
        seen.add(band.band)
      } else {
        if (!['summary', 'footer'].includes(band.band) || !def.bands[band.band] || Array.isArray(def.bands[band.band])) {
          issues.push(`Unsupported totals band: ${band.band}`)
        }
        if (seen.has(band.band) || band.band === 'summary' && seen.has('footer')) issues.push('Totals bands must appear once in source order')
        seen.add(band.band)
      }
      if (!band.label.trim() || !band.fields.length && !(band.captions?.length && /\./.test(band.band))) issues.push(`Missing totals content: ${band.band}`)
      for (const name of band.captions ?? []) {
        const caption = objects.get(name)
        if (!caption || caption.type !== 'text' || caption.band !== band.band) issues.push(`Unsupported totals caption: ${name}`)
        if (used.has(name)) issues.push(`Duplicate caption: ${name}`)
        used.add(name)
      }
      for (const field of band.fields) {
        const object = objects.get(field.object)
        if (!object || !(object.type === 'compute' || /\./.test(band.band) && object.type === 'column') || object.band !== band.band ||
          // A group title may show a code by its lookup or list display text; it is display only, as in Classic.
          choiceStyle(object, overrides).kind !== 'none' && !(/\./.test(band.band) && object.type === 'column' && ['lookup', 'list'].includes(choiceStyle(object, overrides).kind))) {
          issues.push(`Unsupported total: ${field.object}`)
        }
        if (used.has(field.object)) issues.push(`Duplicate field: ${field.object}`)
        used.add(field.object)
        if (field.labelObject) {
          const label = objects.get(field.labelObject)
          if (!label || label.type !== 'text' || label.band !== band.band) issues.push(`Unsupported label: ${field.labelObject}`)
          if (!label?.text?.trim() && !field.label?.trim()) issues.push(`Missing label: ${field.object}`)
          if (used.has(field.labelObject)) issues.push(`Duplicate label: ${field.labelObject}`)
          used.add(field.labelObject)
        } else if (!field.label?.trim()) issues.push(`Missing label: ${field.object}`)
        if (field.labelHidden && (field.labelObject && objects.get(field.labelObject)?.text?.trim() || !field.label?.trim())) issues.push(`Hidden total label needs a plain name: ${field.object}`)
      }
    }
  }
  for (const object of def.objects) if (!used.has(object.name.toLowerCase())) issues.push(`Unmapped object: ${object.name}`)
  return issues
}

/**
 * Position checks of a mapping against the geometry of its definition: every caption, suffix and column header must sit where the source
 * paints it for that field, captions stay in the groupbox that holds them, and the presentation order follows the source reading order.
 * The generators refuse any mapping that fails them (it keeps the Classic layout).  The runtime keeps to the structural checks of
 * `dataSurfaceIssues`, because a script may re-lay a definition's objects while it runs.
 */
export function dataSurfacePositionIssues(def: DwDef, surface: DataSurface): string[] {
  const issues: string[] = []
  const objects = new Map(def.objects.map((object) => [object.name.toLowerCase(), object]))
  const fieldObjects = surface.fields.flatMap((field) => objects.get(field.object) ?? [])
  const peersOf = (object: DwObject) => fieldObjects.filter((other) => alwaysHidden(other.visible) === alwaysHidden(object.visible))
  const visibleIn = (names: readonly string[]) => names.flatMap((name) => objects.get(name) ?? []).filter((object) => !alwaysHidden(object.visible))
  if (surface.kind === 'form') {
    const groupboxes = def.objects.filter((object) => object.type === 'groupbox' && object.band === 'detail')
    const groupOf = new Map<string, string>()
    for (const group of surface.groups ?? []) for (const name of group.fields) groupOf.set(name, group.object)
    const valid = (text: DwObject, field: DwObject) => captionBeside(text, field) && !fieldBetween(text, field, peersOf(field)) || captionAbove(text, field)
    for (const field of surface.fields) {
      const object = objects.get(field.object)
      if (!object) continue
      const label = field.labelObject ? objects.get(field.labelObject) : undefined
      // Only a caption painted in the detail band beside its field has a source position to compare (a reviewed header caption has none).
      if (label?.band === 'detail') {
        const sharers = surface.fields.filter((other) => other.labelObject === field.labelObject).flatMap((other) => objects.get(other.object) ?? [])
        if (!sharers.some((other) => valid(label, other))) issues.push(`Caption is not beside its field in the source: ${field.object}`)
        // A trailing text the painter named after the field it follows (<column>_t) is that field's suffix, not the next field's caption.
        const owner = surface.fields.find((other) => other !== field && `${other.object}_t` === field.labelObject && objects.get(other.object))
        if (owner && suffixBeside(label, objects.get(owner.object)!) && !/:\s*$/.test(label.text ?? '')) issues.push(`Caption belongs to another field: ${field.object}`)
        const box = surface.groups ? holderBox(groupboxes, label) : undefined
        if (box && box.name.toLowerCase() !== groupOf.get(field.object)) issues.push(`Caption sits in another group: ${field.object}`)
      }
      const suffix = field.suffixObject ? objects.get(field.suffixObject) : undefined
      if (suffix && !suffixBeside(suffix, object)) issues.push(`Suffix is not beside its field in the source: ${field.object}`)
    }
    for (const names of surface.groups ? surface.groups.map((group) => group.fields) : [surface.fields.map((field) => field.object)]) {
      const visible = visibleIn(names)
      for (let index = 1; index < visible.length; index++) {
        const [before, after] = [visible[index - 1], visible[index]]
        if (sameReadingRow(before, after) && rightOf(after) <= at(before, 'x')) issues.push(`Field order differs from the source reading order: ${after.name.toLowerCase()}`)
      }
    }
    if (surface.groups) {
      // A heading or button stays in the groupbox that holds it (or outside every box when no box holds it).
      for (const item of [...surface.captions ?? [], ...surface.buttons ?? []]) {
        const object = objects.get(item.object)
        if (!object) continue
        const box = holderBox(groupboxes, object)?.name.toLowerCase() ?? ''
        const placed = item.before === undefined ? '' : groupOf.get(item.before)
        if (placed !== box) issues.push(`Placed outside the groupbox that holds it: ${item.object}`)
      }
    }
  } else {
    for (const field of surface.fields) {
      const label = field.labelObject ? objects.get(field.labelObject) : undefined, object = objects.get(field.object)
      if (label && object && Math.min(rightOf(label), rightOf(object)) - Math.max(at(label, 'x'), at(object, 'x')) <= 0) {
        issues.push(`Column header is not above its column: ${field.object}`)
      }
    }
    const visible = visibleIn(surface.fields.map((field) => field.object))
    for (let index = 1; index < visible.length; index++) {
      if (at(visible[index], 'x') < at(visible[index - 1], 'x')) issues.push(`Column order differs from the source: ${visible[index].name.toLowerCase()}`)
    }
  }
  return issues
}

export function lookupSurfaceIssues(def: DwDef, surface: DataSurface, overrides?: ReadonlyMap<string, string>): string[] {
  const issues = dataSurfaceIssues(def, surface, overrides)
  if (surface.kind !== 'grid') issues.push('Detailed lookups require a grid mapping')
  if (surface.bands?.length) issues.push('Detailed lookups do not render totals bands')
  for (const field of surface.fields) {
    const object = def.objects.find((object) => object.name === field.object)
    if (field.kind || field.choice?.kind === 'lookup' || field.choice?.kind === 'checkbox' || field.choice?.kind === 'radio' ||
      !def.table.columns.some((column) => column.name === field.object)) {
      issues.push(`Unsupported lookup field: ${field.object}`)
    }
    const visible = overrides?.get(`${field.object}.visible`) ?? object?.visible ?? '1'
    if (!/^[01]$/.test(visible)) issues.push(`Dynamic lookup visibility: ${field.object}`)
    if (visible === '0') continue
    if (field.labelObject) {
      const label = def.objects.find((object) => object.name === field.labelObject)
      if ((overrides?.get(`${field.labelObject}.visible`) ?? label?.visible ?? '1') !== '1') {
        issues.push(`Hidden or dynamic lookup header: ${field.object}`)
      }
      if ((overrides?.get(`${field.labelObject}.text`) ?? label?.text ?? '').includes('\t')) {
        issues.push(`Dynamic lookup header text: ${field.object}`)
      }
    }
    // Search only reviewed plain values, never data concealed by a mask or expression.
    const format = overrides?.get(`${field.object}.format`) ?? object?.format ?? ''
    if (!['', '[general]'].includes(format.toLowerCase()) || object?.['editmask.mask']) {
      issues.push(`Lookup format requires a search contract: ${field.object}`)
    }
  }
  return issues
}
