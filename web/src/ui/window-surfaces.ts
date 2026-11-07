import { DATA_SURFACES, CRITERIA_DATA_SURFACES, TRANSACTION_DATA_SURFACES } from './data-surfaces.ts'
import type { DataSurface } from './data-surfaces.ts'

export interface WindowSurface {
  name: string
  library: string
  fields: readonly { control: string; label: string }[]
  actions: readonly string[]
  data?: readonly { control: string; surface: DataSurface; labels?: readonly { field: string; control: string }[] }[]
  contentOrder?: readonly string[]
  auxiliary?: readonly string[]
  frame?: string
  frames?: readonly string[]
  lists?: readonly { control: string; caption: string }[]
  captions?: readonly string[]
  options?: readonly { control: string; native: 'checkbox' | 'radiobutton' }[]
  calendars?: readonly string[]
}

export const LOOKUP_CRITERIA_WINDOWS = [
  ['w_arg_acc_sdate_ldate', 'd_arg_acc'],
  ['w_arg_antinortixitem_sdate_ldate', 'd_arg_antinortixitem'],
  ['w_arg_doct_sdate_ldate', 'd_arg_doctor'],
  ['w_arg_godown_sdate_ldate', 'd_arg_godown'],
  ['w_arg_manf_sdate_ldate', 'd_arg_manf'],
  ['w_arg_patient_sdate_ldate_old', 'd_arg_patient'],
  ['w_arg_region_sdate_ldate', 'd_region'],
  ['w_arg_singleregion', 'd_region'],
  ['w_arg_singlezone', 'd_arg_zone'],
  ['w_arg_sman_sdate_ldate', 'd_arg_salesman'],
  ['w_arg_subacc_sdate_ldate', 'd_arg_subacc'],
  ['w_arg_supp_label', 'd_arg_supp'],
  ['w_arg_supp_sdate_ldate_old', 'd_arg_supp'],
  ['w_arg_user_sdate_ldate', 'd_arg_user'],
  ['w_arg_custgroup', 'd_arg_custrgroup'],
] as const

export const REFERENCE_CRITERIA_WINDOWS = [
  ['w_arg_batchno', 'Batch Number:'],
  ['w_arg_containerno', 'Container No.:'],
  ['w_arg_masterpart', 'Master Part No:'],
  ['w_arg_phoneno', 'Phone Number:'],
  ['w_arg_ref', 'Reference No.:'],
  ['w_arg_smscenter', 'SMS Center No.:'],
] as const

export const NUMERIC_CRITERIA_WINDOWS = [
  ['w_arg_day', 'd_arg_days'],
  ['w_arg_discperc', 'd_arg_discperc'],
  ['w_arg_gstperc', 'd_arg_gstperc'],
  ['w_arg_scode_lcode', 'd_arg_scode_lcode'],
  ['w_arg_scode_lcode2', 'd_arg_scode_lcode'],
  ['w_arg_sinvcode_linvcode', 'd_arg_sinvcode_linvcode'],
] as const

export const DATE_OPTION_CRITERIA_WINDOWS: readonly {
  name: string
  checkboxes: readonly string[]
  radios?: readonly string[]
  frame?: string
  caption?: string
}[] = [
  { name: 'w_arg_sale_sdate_ldate', checkboxes: ['cbx_cash', 'cbx_credit'] },
  { name: 'w_arg_sale_return_sdate_ldate', checkboxes: ['cbx_cash', 'cbx_credit'] },
  { name: 'w_arg_sdate_ldate_adj', checkboxes: ['cbx_increase', 'cbx_decrease'] },
  { name: 'w_arg_sdate_ldate_outstanding_inv', checkboxes: ['cbx_outstandinginv'] },
  { name: 'w_arg_sdate_ldate_postunpost', checkboxes: ['cbx_posted', 'cbx_unposted'], caption: 'st_4' },
  { name: 'w_arg_sdate_ldate_postunpost_dateoption', checkboxes: ['cbx_posted', 'cbx_unposted'],
    radios: ['rb_issuedate', 'rb_duedate', 'rb_postdate'], frame: 'gb_date', caption: 'st_4' },
  { name: 'w_arg_sdate_ldate_purtype', checkboxes: [], radios: ['rb_pp', 'rb_lp'], frame: 'gb_2' },
  { name: 'w_arg_sdate_ldate_saletype', checkboxes: [], radios: ['rb_sales', 'rb_returns'], frame: 'gb_2' },
  { name: 'w_arg_sdate_ldate_transaction', frame: 'gb_2', checkboxes: [
    'cbx_all', 'cbx_purchase', 'cbx_purchasereturn', 'cbx_sales', 'cbx_salesreturn',
    'cbx_service', 'cbx_servicereturn', 'cbx_issue', 'cbx_receipt', 'cbx_adjustment',
    'cbx_cp', 'cbx_cr', 'cbx_bp', 'cbx_br', 'cbx_jv', 'cbx_others',
  ] },
]

const costPriceCriteria: DataSurface = {
  name: 'ddd_avgpricerpp', title: 'Cost price', kind: 'form',
  fields: [{ object: 'price', label: 'Cost price', choice: {
    kind: 'lookup', name: 'ddd_pricetype_avg_rpp', dataColumn: 'pricetypecode', displayColumn: 'name',
  } }],
}

export const DATE_CHOICE_CRITERIA_WINDOWS: readonly {
  name: string
  order: readonly string[]
  extra?: WindowSurface['options']
  frame?: string
  price?: DataSurface
}[] = [
  { name: 'w_arg_ason', order: ['em_startdate'] },
  { name: 'w_arg_sale_sdate_ldate_avgprice_rpp',
    order: ['em_startdate', 'em_enddate', 'cbx_cash', 'cbx_credit', 'st_4', 'dw_price'],
    extra: [{ control: 'cbx_cash', native: 'checkbox' }, { control: 'cbx_credit', native: 'checkbox' }],
    price: costPriceCriteria },
  { name: 'w_arg_sdate_ldate_avg_rpp', order: ['em_startdate', 'em_enddate', 'st_4', 'dw_price'],
    price: costPriceCriteria },
  { name: 'w_arg_sdate_ldate_cashcreditboth', order: ['em_startdate', 'em_enddate', 'st_4', 'dw_price'],
    price: { name: 'd_arg_cashcreditboth', title: 'Type', kind: 'form',
      fields: [{ object: 'typecode', label: 'Type', choice: { kind: 'list' } }] } },
  { name: 'w_arg_sdate_cashflow_crosstab', frame: 'gb_2',
    order: ['em_startdate', 'em_enddate', 'gb_2', 'rb_cash', 'rb_bank', 'rb_both', 'cbx_supress'],
    extra: ['rb_cash', 'rb_bank', 'rb_both'].map((control) => ({ control, native: 'radiobutton' })) },
  { name: 'w_arg_sdate_ldate_remarks_option',
    order: ['em_startdate', 'em_enddate', 'rb_saleprice', 'rb_purprice'] },
]

const lookupCriteriaData: readonly DataSurface[] = [
  DATA_SURFACES.find((surface) => surface.name === 'd_arg_manf')!,
  ...([
    ['d_arg_cust', 'Customer', 'custcode', 'ddd_customer', 'accounts_acccode', 'customer_name', true, 250, 10],
    ['d_arg_zone', 'Zone', 'zonecode', 'ddd_zones', 'zonecode', 'name', true, 100, 10],
    ['d_arg_acc', 'Account', 'acccode', 'ddd_otheraccounts', 'acccode', 'name', false, 175, 10],
    ['d_arg_antinortixitem', 'Item', 'icode', 'ddd_antinorcotix_item', 'icode', 'itemname', false, 0, 0],
    ['d_arg_doctor', 'Doctor', 'doctorcode', 'ddd_doctors', 'doctcode', 'name', true, 100, 10],
    ['d_arg_godown', 'Godown', 'gcode', 'ddd_godown', 'gcode', 'name', false, 50, 5],
    ['d_arg_patient', 'Patient', 'patientcode', 'ddd_patient', 'patientcode', 'patient', false, 250, 10],
    ['d_region', 'Region', 'regioncode', 'ddd_region', 'regioncode', 'name', true, 100, 10],
    ['d_arg_salesman', 'Sales Person', 'salesman', 'ddd_sman', 'salesmancode', 'name', false, 0, 10],
    ['d_arg_subacc', 'Sub. Account', 'subacccode', 'ddd_subaccounts', 'subacccode', 'name', false, 100, 10],
    ['d_arg_supp', 'Supplier', 'suppcode', 'ddd_suppliernames', 'supplier_suppcode', 'accounts_name', true, 250, 10],
    ['d_arg_user', 'User', 'code', 'ddd_user', 'usercode', 'username', false, 0, 10],
    ['d_arg_custrgroup', 'Customer Group', 'customergroupcode', 'd_customergrouplist', 'code', 'name', false, 0, 0],
  ] as const).map(([name, title, object, lookup, dataColumn, displayColumn, editable, percentWidth, lines]): DataSurface => ({
    name, title, kind: 'form', fields: [{ object, label: title + ':', choice: {
      kind: 'lookup', name: lookup, dataColumn, displayColumn,
      ...(editable ? { editable, case: 'any' } : {}),
      ...(percentWidth ? { percentWidth } : {}), ...(lines ? { lines } : {}),
      ...(name === 'd_arg_subacc' ? { showList: true } : {}),
    } }],
  })),
]

const referenceCriteriaSurface: DataSurface = {
  name: 'd_arg_ref', title: 'Reference number', kind: 'form',
  fields: [{ object: 'refno', label: 'Reference number' }],
}

const numericCriteriaData: readonly DataSurface[] = [
  { name: 'd_arg_days', title: 'Day', kind: 'form', fields: [
    { object: 'day', labelObject: 'day_t', labelBand: 'header', label: 'Day:' },
  ] },
  { name: 'd_arg_discperc', title: 'Discount percentage', kind: 'form', fields: [{ object: 'discperc', label: 'Discount %:' }] },
  { name: 'd_arg_gstperc', title: 'GST percentage', kind: 'form', fields: [{ object: 'gstperc', label: 'GST %:' }] },
  { name: 'd_arg_scode_lcode', title: 'Code range', kind: 'form', fields: [
    { object: 'scode', label: 'Start Code:' }, { object: 'lcode', label: 'End Code:' },
  ] },
  { name: 'd_arg_sinvcode_linvcode', title: 'Document range', kind: 'form', fields: [
    { object: 'sinvcode', label: 'Starting Doc. No:' }, { object: 'linvcode', label: 'Last Doc. No.:' },
  ] },
]

export const CRITERIA_WINDOW_SURFACES: readonly WindowSurface[] = [
  {
    name: 'w_arg_items_sdate_ldate_topn', library: 'reports', frame: 'gb_1', frames: ['gb_2'],
    fields: [{ control: 'em_startdate', label: 'st_1' }, { control: 'em_enddate', label: 'st_2' }],
    lists: [{ control: 'lb_selected', caption: 'gb_3' }],
    options: [{ control: 'cbx_all', native: 'checkbox' }],
    actions: ['cb_ok', 'cb_cancel'],
    contentOrder: ['dw_selected', 'dw_selectionlist', 'lb_selected', 'cbx_all', 'gb_2',
      'em_startdate', 'em_enddate', 'dw_custcount'],
    data: [
      { control: 'dw_selected', surface: {
        name: 'd_popup_itemselected_arglist', title: 'Selection List', kind: 'form', sourceProcessing: 1, fields: [
          { object: 'aliasname', labelObject: 'aliasname_t' }, { object: 'name', labelObject: 't_1' },
        ],
      } },
      { control: 'dw_selectionlist', surface: {
        name: 'd_popup_itemselection', title: 'Selection List', kind: 'grid', fields: [
          { object: 'aliasname', labelObject: 'aliasname_t' }, { object: 'name', labelObject: 'name_t' },
          { object: 'manfname', labelObject: 't_1' },
        ],
      } },
      { control: 'dw_custcount',
        surface: CRITERIA_DATA_SURFACES.find((surface) => surface.name === 'd_arg_top_n_customers')! },
    ],
  },
  ...[
    ...LOOKUP_CRITERIA_WINDOWS,
    ...REFERENCE_CRITERIA_WINDOWS.map(([name]) => [name, 'd_arg_ref'] as const),
    ...NUMERIC_CRITERIA_WINDOWS,
    ...DATE_OPTION_CRITERIA_WINDOWS.map(({ name }) => [name, 'd_arg_cust'] as const),
    ...DATE_CHOICE_CRITERIA_WINDOWS.map(({ name }) => [name, 'd_arg_cust'] as const),
    ['w_arg_sdate', 'd_arg_cust'],
    ['w_arg_sdate_notime', 'd_arg_cust'],
    ['w_arg_sdate_ldate', 'd_arg_cust'],
    ['w_arg_activeclass_single', 'd_arg_activeclass_single'],
    ['w_arg_letter_sdate_ldate', 'd_arg_letter'],
    ['w_arg_pricetype_markup', 'd_arg_pricetype_markupperc'],
    ['w_arg_sdate_ldate_margin_markup_range', 'd_arg_margin_markup_range'],
    ['w_arg_percentage_reduce_raise', 'd_arg_percentage_reduce_raise'],
    ['w_arg_zone_sdate_ldate_top_n_customer', 'd_arg_zone', 'reports_cust'],
  ].map(([name, data, library = 'reports']): WindowSurface => {
    const lookup = lookupCriteriaData.find((surface) => surface.name === data)
    const numeric = numericCriteriaData.find((surface) => surface.name === data)
    const range = numeric && numeric.fields.length === 2
    const reference = data === 'd_arg_ref'
    const dateOptions = DATE_OPTION_CRITERIA_WINDOWS.find((owner) => owner.name === name)
    const dateChoice = DATE_CHOICE_CRITERIA_WINDOWS.find((owner) => owner.name === name)
    const frame = dateOptions?.frame ?? dateChoice?.frame
    const sourceLabel = REFERENCE_CRITERIA_WINDOWS.find(([owner]) => owner === name)?.[1]
    return {
      name, library, frame: 'gb_1',
      fields: [{ control: 'em_startdate', label: 'st_1' }, { control: 'em_enddate', label: range ? 'st_4' : 'st_2' }],
      captions: range ? ['st_3', 'st_2'] : name === 'w_arg_activeclass_single' ? ['st_3', 'st_godown'] :
        ['st_3', ...(dateOptions?.caption ? [dateOptions.caption] : []), ...(dateChoice?.price ? ['st_4'] : [])],
      ...(frame ? { frames: [frame] } : {}),
      actions: ['cb_ok', 'cb_cancel'],
      contentOrder: name === 'w_arg_zone_sdate_ldate_top_n_customer' ?
        ['st_3', 'dw_control', 'em_startdate', 'em_enddate', 'dw_custcount', 'cbx_hide', 'cbx_supress',
          'rb_saleprice', 'rb_purprice', 'dw_price'] : dateOptions ? [
          'em_startdate', 'em_enddate', 'st_3', 'dw_control', 'dw_price',
          'cbx_hide', 'cbx_supress', 'rb_saleprice', 'rb_purprice',
          ...(dateOptions.caption ? [dateOptions.caption] : []),
          ...(dateOptions.frame && !dateOptions.radios ? [dateOptions.frame] : []),
          ...dateOptions.checkboxes,
          ...(dateOptions.frame && dateOptions.radios ? [dateOptions.frame] : []),
          ...(dateOptions.radios ?? []),
        ] : dateChoice ? [...dateChoice.order, ...[
          'em_startdate', 'em_enddate', 'st_3', 'dw_control', 'dw_price',
          'cbx_hide', 'cbx_supress', 'rb_saleprice', 'rb_purprice',
        ].filter((control) => !dateChoice.order.includes(control))] : undefined,
      options: [
        ...(range ? ['cbx_supress', 'cbx_hide'] : ['cbx_hide', 'cbx_supress'])
          .map((control) => ({ control, native: 'checkbox' as const })),
        { control: 'rb_saleprice', native: 'radiobutton' }, { control: 'rb_purprice', native: 'radiobutton' },
        ...(dateOptions?.checkboxes ?? []).map((control) => ({ control, native: 'checkbox' as const })),
        ...(dateOptions?.radios ?? []).map((control) => ({ control, native: 'radiobutton' as const })),
        ...(dateChoice?.extra ?? []),
      ],
      data: [
        { control: 'dw_control',
          labels: numeric ? numeric.fields.map((field, index) => ({ field: field.object, control: index ? 'st_2' : 'st_3' })) :
            lookup || reference ? [{ field: (lookup ?? referenceCriteriaSurface).fields[0].object, control: 'st_3' }] : undefined,
          surface: lookup ?? numeric ?? (reference ? referenceCriteriaSurface :
            CRITERIA_DATA_SURFACES.find((surface) => surface.name === data)!) },
        ...(name === 'w_arg_zone_sdate_ldate_top_n_customer' ? [{ control: 'dw_custcount',
          surface: CRITERIA_DATA_SURFACES.find((surface) => surface.name === 'd_arg_top_n_customers')! }] : []),
        { control: 'dw_price',
          ...(dateChoice?.price ? { labels: [{ field: dateChoice.price.fields[0].object, control: 'st_4' }] } : {}),
          surface: dateChoice?.price ?? {
          name: 'ddd_typepofprice', title: 'Price', kind: 'form',
          fields: [{ object: 'price', label: 'Price', choice: { kind: 'list' } }],
        } },
      ],
      ...(sourceLabel ? { captions: ['st_3'] } : {}),
    }
  }),
  {
    name: 'w_sale_replace_custref', library: 'salerespwin', fields: [], actions: ['cb_ok', 'cb_cancel'],
    data: [{ control: 'dw_replace_custref',
      surface: CRITERIA_DATA_SURFACES.find((surface) => surface.name === 'd_arg_custref')! }],
  },
  {
    name: 'w_arg_quotation_customer_remarks', library: 'reports', fields: [], actions: ['cb_ok', 'cb_cancel'],
    data: [{ control: 'dw_selection',
      surface: CRITERIA_DATA_SURFACES.find((surface) => surface.name === 'd_arg_quotation_customer_remarks')! }],
  },
  {
    name: 'w_select_case', library: 'packingmodule', fields: [], frame: 'gb_format', actions: ['cb_ok'],
    data: [{ control: 'dw_control', surface: CRITERIA_DATA_SURFACES.find((surface) => surface.name === 'd_arg_packlayout')! }],
  },
]

export const WINDOW_SURFACES: readonly WindowSurface[] = [
  {
    name: 'w_cashierjobactivity_changecategory', library: 'cashierjob', fields: [],
    actions: ['cb_ok', 'cb_cancel'],
    data: [{ control: 'dw_control', surface: {
      name: 'd_cashierjobactivity_changecategory', title: 'Change category', kind: 'form', fields: [
        { object: 'doccode', labelObject: 'doccode_t' },
        { object: 'remarks', labelObject: 'remarks_t' },
        { object: 'amount', labelObject: 'amount_t' },
        { object: 'cashtendered', labelObject: 'cashtendered_t' },
        { object: 'cashcharged', labelObject: 'cashcharged_t' },
        { object: 'cashback', labelObject: 'cashback_t' },
        { object: 'catcode', labelObject: 'catcode_t',
          choice: { kind: 'lookup', name: 'ddd_cashierjob_cashcredit', dataColumn: 'code', displayColumn: 'name' } },
        { object: 'acccode', labelObject: 'acccode_t',
          choice: { kind: 'lookup', name: 'ddd_allaccounts', dataColumn: 'acccode', displayColumn: 'name', percentWidth: 150 } },
        { object: 'supervised', labelObject: 'supervised_t', choice: { kind: 'list', sorted: true } },
      ],
    } }],
  },
  {
    name: 'w_cashierjobactivity_cashtendered', library: 'cashierjob', fields: [],
    actions: ['cb_print', 'cb_ok', 'cb_cancel'], auxiliary: ['dw_print'],
    data: [
      { control: 'dw_header', surface: {
        name: 'd_cashierjobactivity_multiinvoice', title: 'Cashier documents', kind: 'grid', fields: [
          { object: 'compute_1', labelObject: 't_1', kind: 'computed', numeric: true },
          { object: 'module', labelObject: 'module_t', choice: { kind: 'list', sorted: true } },
          { object: 'doccode', labelObject: 'doccode_t' },
          { object: 'amount', labelObject: 'amount_t' },
        ],
        bands: [{ band: 'summary', label: 'Totals', fields: [{ object: 'c_total', labelObject: 't_2', numeric: true }] }],
      } },
      { control: 'dw_cash', surface: {
        name: 'd_cashierjobactivity_cashtendered', title: 'Cash tendered', kind: 'form', fields: [
          { object: 'cashtendered', labelObject: 'cashtendered_t' },
          { object: 'cashcharged', labelObject: 'cashcharged_t' },
          { object: 'cashback', labelObject: 'cashback_t' },
        ],
      } },
    ],
  },
  {
    name: 'w_cashiershift_closing', library: 'cashierjob', fields: [], actions: ['cb_ok', 'cb_cancel'],
    data: [
      { control: 'dw_detail', surface: {
        name: 'd_cashiershift_closing', title: 'Cashier shift', kind: 'form', fields: [
          { object: 'code', labelObject: 'code_t' },
          { object: 'openedon', labelObject: 'openedon_t' },
          { object: 'openedby', labelObject: 'openedby_t', choice: { kind: 'lookup', name: 'ddd_users', dataColumn: 'usercode', displayColumn: 'username' } },
          { object: 'shiftstatus', labelObject: 'shiftstatus_t', choice: { kind: 'list' } },
          { object: 'shiftowner', labelObject: 'shiftowner_t',
            choice: { kind: 'lookup', name: 'ddd_users', dataColumn: 'usercode', displayColumn: 'username', percentWidth: 200, lines: 10 } },
          { object: 'closedon', labelObject: 't_1' },
          { object: 'closedby', labelObject: 't_2', choice: { kind: 'lookup', name: 'ddd_users', dataColumn: 'usercode', displayColumn: 'username' } },
          { object: 'cashacccode', labelObject: 'cashacccode_t',
            choice: { kind: 'lookup', name: 'ddd_cashaccounts', dataColumn: 'acccode', displayColumn: 'name', percentWidth: 150, lines: 10 } },
          { object: 'compute_1', labelObject: 'openingbalance_t', kind: 'computed', numeric: true },
          { object: 'compute_2', label: 'Opening balance debit/credit', kind: 'computed' },
        ], separators: [{ object: 'l_1' }],
      } },
      { control: 'dw_cash', surface: TRANSACTION_DATA_SURFACES.find((surface) => surface.name === 'd_cashiershift_cashdenomination')! },
      { control: 'dw_figures', surface: {
        name: 'd_cashiershift_figures', title: 'Cashier shift figures', kind: 'form', fields: [
          { object: 'amttransferedto', labelObject: 't_3', choice: {
            kind: 'lookup', name: 'ddd_cashbankaccounts_cashiershift', dataColumn: 'acccode', displayColumn: 'name', percentWidth: 350, lines: 10 } },
          { object: 'amttransfered', labelObject: 't_2' },
          { object: 'remarks', labelObject: 't_4' },
          { object: 'totalamount', labelObject: 't_1' },
          { object: 'refno', labelObject: 't_5' },
          { object: 'compute_1', labelObject: 't_11', kind: 'computed', numeric: true },
          { object: 'creditsales', labelObject: 't_7' },
          { object: 'cashsales', labelObject: 't_6' },
          { object: 'creditservice', labelObject: 't_9' },
          { object: 'cashservice', labelObject: 't_8' },
          { object: 'creditsr', labelObject: 't_16' },
          { object: 'cashsr', labelObject: 't_13' },
          { object: 'creditservicereturn', labelObject: 't_15' },
          { object: 'cashservicereturn', labelObject: 't_14' },
          { object: 'totalreceipts', labelObject: 't_20' },
          { object: 'totalpayments', labelObject: 't_19' },
          { object: 'netamt', labelObject: 't_10' },
          { object: 'compute_2', labelObject: 't_18', kind: 'computed', numeric: true },
          { object: 'compute_3', label: 'Opening balance debit/credit', kind: 'computed' },
          { object: 'compute_6', labelObject: 't_23', kind: 'computed', numeric: true },
          { object: 'compute_7', labelObject: 't_24', kind: 'computed', numeric: true },
          { object: 'difftransferedto', labelObject: 't_17', choice: {
            kind: 'lookup', name: 'ddd_suspense_cashiershift', dataColumn: 'acccode', displayColumn: 'name', percentWidth: 350, lines: 10 } },
          { object: 'diffamt', labelObject: 't_12' },
        ], separators: [
          { object: 'l_6', before: 'amttransferedto' }, { object: 'l_1', before: 'creditsales' },
          { object: 'l_3', before: 'netamt' }, { object: 'l_4', before: 'compute_6' },
          { object: 'l_2', before: 'difftransferedto' },
        ],
      } },
    ],
  },
  {
    name: 'w_assocadvsaleinvlist_form', library: 'advancedsale', fields: [],
    data: [{ control: 'dw_viewheader', surface: TRANSACTION_DATA_SURFACES.find((surface) => surface.name === 'd_assocadvsaleinvlist')! }],
    actions: ['cb_ok', 'cb_cancel'],
  },
  ...['w_arg_amount', 'w_arg_decimal_val', 'w_arg_integer_val', 'w_arg_noofsiblings'].map((name) => ({
    name, library: 'reports', fields: [{ control: 'em_val', label: 'st_val' }], actions: ['cb_ok', 'cb_cancel'],
  })),
  { name: 'w_printer_copies', library: 'salerespwin', fields: [{ control: 'em_copies', label: 'st_1' }], actions: ['cb_ok'] },
]

export const CALENDAR_WINDOW_SURFACES: readonly WindowSurface[] = [
  { name: 'w_calendar', library: 'components', fields: [], calendars: ['mc_calendar'], actions: ['cb_ok', 'cb_cancel'] },
  { name: 'w_calendar2', library: 'components', fields: [], calendars: ['mc_calendar'], actions: ['cb_ok', 'cb_cancel'] },
]

export const CALCULATOR_WINDOW_SURFACES: readonly WindowSurface[] = [
  {
    name: 'w_discountcalculator', library: 'salerespwin', fields: [], actions: ['cb_ok', 'cb_cancel'],
    data: [{ control: 'dw_amountoninvoice', surface: {
      name: 'd_discountcalculator', title: 'Sales discount calculation', kind: 'form', fields: [
        { object: 'aliasname', labelObject: 'aliasname_t' },
        { object: 'saleprice', labelObject: 'saleprice_t' },
        { object: 'packunits', labelObject: 'packunits_t' },
        { object: 'name', labelObject: 'name_t' },
        { object: 'c_unitprice', labelObject: 't_2', kind: 'computed', numeric: true },
        { object: 'type', labelObject: 'type_t', choice: { kind: 'radio', columns: 2 } },
        { object: 'discount', label: 'Discount' },
        { object: 'oldrate', labelObject: 't_1' },
        { object: 'rate', labelObject: 'rate_t' },
        { object: 'c_discount', labelObject: 'discount_t', kind: 'computed', numeric: true },
      ],
    } }],
  },
  {
    name: 'w_pricecalculator', library: 'salerespwin', fields: [], actions: ['cb_ok', 'cb_cancel'],
    data: [{ control: 'dw_amountoninvoice', surface: {
      name: 'd_pricecalculator', title: 'Price calculation', kind: 'form', fields: [
        { object: 'name', labelObject: 'name_t' },
        { object: 'aliasname', labelObject: 'aliasname_t' },
        { object: 'c_unitprice', labelObject: 't_2', kind: 'computed', numeric: true },
        { object: 'oldrate', labelObject: 't_1' },
        { object: 'rate', labelObject: 'rate_t' },
        { object: 'gstperc', labelObject: 't_gstperc' },
        { object: 'c_price', labelObject: 'discount_t', kind: 'computed', numeric: true },
      ],
    } }],
  },
  {
    name: 'w_qty_rate_value_calculator', library: 'salerespwin', fields: [], actions: ['cb_ok', 'cb_cancel'],
    data: [{ control: 'dw_amountoninvoice', surface: {
      name: 'd_qty_rate_value_calculator', title: 'Qty/Rate/Value calculation', kind: 'form', fields: [
        { object: 'name', labelObject: 'name_t' },
        { object: 'aliasname', labelObject: 'aliasname_t' },
        { object: 'saleprice', labelObject: 't_4' },
        { object: 'packunits', labelObject: 't_5' },
        { object: 'value', labelObject: 'value_t' },
        { object: 'rate', labelObject: 'rate_t' },
        { object: 'looseqty', labelObject: 't_1' },
      ],
      groups: [
        { object: 'gb_1', fields: ['name', 'aliasname', 'saleprice', 'packunits'] },
        { object: 'gb_2', fields: ['value', 'rate', 'looseqty'] },
      ],
    } }],
  },
  {
    name: 'w_set_flatdiscamt', library: 'salerespwin', fields: [], actions: ['cb_ok', 'cb_cancel'],
    data: [{ control: 'dw_control', surface: {
      name: 'd_set_flatdiscamt', title: 'Invoice discount with GST', kind: 'form', fields: [
        { object: 'netamount', labelObject: 'netamount_t' },
        { object: 'discperc', labelObject: 'processingfeeperc_t' },
        { object: 'c_discamt', labelObject: 't_1', kind: 'computed', numeric: true },
        { object: 'c_newnetamount', labelObject: 't_2', kind: 'computed', numeric: true },
      ],
    } }],
  },
]

export interface EntryWindowSurface {
  name: string
  library: string
  family: 'single' | 'multi'
  controls: readonly { path: string; native: string }[]
  details: readonly { control: string; kind: 'form' | 'grid' | 'auxiliary'; surface?: DataSurface }[]
  list?: DataSurface
}

const entryTab = 'tab_retrieve'
const detailPage = `${entryTab}.tabpage_detail`
const listPage = `${entryTab}.tabpage_list`
function entryControlPaths(details: readonly string[]): EntryWindowSurface['controls'] {
  return [
    { path: entryTab, native: 'tab' },
    { path: detailPage, native: 'userobject' },
    { path: listPage, native: 'userobject' },
    ...details.map((name) => ({ path: `${detailPage}.${name}`, native: 'datawindow' })),
    ...['dw_find', 'dw_list'].map((name) => ({ path: `${listPage}.${name}`, native: 'datawindow' })),
    ...['gb_sort', 'gb_fliter'].map((name) => ({ path: `${listPage}.${name}`, native: 'groupbox' })),
    ...['ddlb_sort', 'ddlb_filter_column', 'ddlb_op', 'ddlb_data'].map((name) => ({ path: `${listPage}.${name}`, native: 'dropdownlistbox' })),
    ...['rb_ascending', 'rb_descending'].map((name) => ({ path: `${listPage}.${name}`, native: 'radiobutton' })),
    ...['cb_filter', 'cb_retrieve'].map((name) => ({ path: `${listPage}.${name}`, native: 'commandbutton' })),
    ...['st_find', 'st_1', 'st_2'].map((name) => ({ path: `${listPage}.${name}`, native: 'statictext' })),
    { path: `${listPage}.r_1`, native: 'rectangle' },
  ]
}

type CodeNameBinding = readonly [datawindow: string, codeLabel: string, nameLabel?: string]
interface SingleEntryBinding {
  name: string
  library: string
  detail: CodeNameBinding
  list: CodeNameBinding
}

// Reviewed identities and labels, not a name/coordinate-based auto-migration.
const SINGLE_ENTRIES: readonly SingleEntryBinding[] = [
  { library: 'accounts', name: 'w_groupsummaryaccount_form', detail: ['d_groupsummaryaccount_detail', 'groupsummaryacccode_t'], list: ['d_groupsummaryaccount_list', 'groupsummaryacccode_t'] },
  { library: 'custcomponents', name: 'w_custsegment_form', detail: ['d_customersegment_detail', 'customersegmentcode_t'], list: ['d_customersegment_list', 'code_t'] },
  { library: 'custcomponents', name: 'w_licensecategory_form', detail: ['d_licensecategory_detail', 'salesmancode_t'], list: ['d_licensecategory_list', 'code_t'] },
  { library: 'employee', name: 'w_emp_category', detail: ['d_emp_category_detail', 't_1'], list: ['d_emp_category_list', 'code_t'] },
  { library: 'employee', name: 'w_emp_certification', detail: ['d_emp_certification_detail', 'code_t'], list: ['d_emp_certification_list', 'certificationcode_t'] },
  { library: 'employee', name: 'w_emp_designation', detail: ['d_emp_designation_detail', 'code_t'], list: ['d_emp_designation_list', 'desigcode_t'] },
  { library: 'employee', name: 'w_emp_education', detail: ['d_emp_education_detail', 't_1'], list: ['d_emp_education_list', 'code_t'] },
  { library: 'employee', name: 'w_emp_skill', detail: ['d_emp_skill_detail', 't_1'], list: ['d_emp_skill_list', 'code_t'] },
  { library: 'eprescriptionbasics', name: 'w_diagnosticitemtype_form', detail: ['d_diagnosticitemtype_detail', 'code_t'], list: ['d_diagnosticitemtype_list', 'diagnosticitemtypecode_t'] },
  { library: 'eprescriptionbasics', name: 'w_diagnosticunit_form', detail: ['d_diagnosticunit_detail', 'diagnosticunitcode_t'], list: ['d_diagnosticunit_list', 'diagnosticunitcode_t'] },
  { library: 'eprescriptionbasics', name: 'w_organ_form', detail: ['d_organ_detail', 'organcode_t'], list: ['d_organ_list', 'code_t'] },
  { library: 'eprescriptionbasics', name: 'w_severitylevel_form', detail: ['d_severitylevel_detail', 'severitylevelcode_t'], list: ['d_severitylevel_list', 'severitylevelcode_t'] },
  { library: 'eprescriptionbasics', name: 'w_symptomtype_form', detail: ['d_symptomtype_detail', 'code_t'], list: ['d_symptomtype_list', 'symptomtypecode_t'] },
  { library: 'eprescriptionbasics', name: 'w_visitstatus_form', detail: ['d_visitstatus_detail', 'visitstatuscode_t'], list: ['d_visitstatus_list', 'code_t'] },
  { library: 'eprescriptionbasics', name: 'w_visittype_form', detail: ['d_visittype_detail', 'visittypecode_t'], list: ['d_visittype_list', 'visittypecode_t', 't_1'] },
  { library: 'guestcomponents', name: 'w_guestroomfloor_form', detail: ['d_guestroomfloor_detail', 'code_t'], list: ['d_guestroomfloor_list', 'code_t'] },
  { library: 'guestcomponents', name: 'w_guestroomstatus_form', detail: ['d_guestroomstatus_detail', 'code_t'], list: ['d_guestroomstatus_list', 'code_t'] },
  { library: 'guestcomponents', name: 'w_guestroomtype_form', detail: ['d_guestroomtype_detail', 'code_t'], list: ['d_guestroomtype_list', 'code_t'] },
  { library: 'patientcomponents', name: 'w_dischargereason_form', detail: ['d_dischargereason_detail', 'code_t'], list: ['d_dischargereason_list', 'dischargereasoncode_t'] },
  { library: 'patientcomponents', name: 'w_gestation_form', detail: ['d_gestation_detail', 'gestationcode_t'], list: ['d_gestation_list', 'code_t'] },
  { library: 'patientcomponents', name: 'w_testmachine_form', detail: ['d_testmachine_detail', 'testmachinecode_t'], list: ['d_testmachine_list', 'code_t'] },
  { library: 'saleorder', name: 'w_saleorderitemstatus_form', detail: ['d_saleorderitemstatus_detail', 'code_t'], list: ['d_saleorderitemstatus_list', 'code_t', 't_2'] },
  { library: 'saleorder', name: 'w_workordertype_form', detail: ['d_workordertype_detail', 'code_t'], list: ['d_workordertype_list', 'code_t'] },
  { library: 'servicecomponents', name: 'w_sampletype_form', detail: ['d_sampletype_detail', 'sampletypecode_t'], list: ['d_sampletype_list', 'code_t'] },
  { library: 'servicecomponents', name: 'w_servicetype_form', detail: ['d_servicetype_detail', 'code_t'], list: ['d_servicetype_list', 'code_t'] },
  { library: 'servicemodules', name: 'w_serviceorderstatus_form', detail: ['d_serviceorderstatusdetail', 'code_t'], list: ['d_serviceorderstatuslist', 'code_t'] },
  { library: 'singleentry', name: 'w_doctorcategory_form', detail: ['d_doctorcategory_detail', 'code_t'], list: ['d_doctorcategory_list', 'code_t'] },
  { library: 'singleentry', name: 'w_issuetype_form', detail: ['d_issuetype', 't_1'], list: ['d_issuetype_list', 'code_t'] },
  { library: 'singleentry', name: 'w_lockercategory', detail: ['d_lockercategory_detail', 'code_t'], list: ['d_lockercategory_list', 'code_t'] },
  { library: 'singleentry', name: 'w_lockreason', detail: ['d_lockreason_detail', 'code_t'], list: ['d_lockreason_list', 'code_t'] },
  { library: 'singleentry', name: 'w_message_form', detail: ['d_message', 'messagecode_t', 'description_t'], list: ['d_message_list', 'code_t'] },
  { library: 'singleentry', name: 'w_motorvehicletype_form', detail: ['d_motorvehicletype_detail', 'code_t'], list: ['d_motorvehicletype_list', 'code_t'] },
  { library: 'singleentry', name: 'w_productpurpose', detail: ['d_productpurpose_detail', 'code_t'], list: ['d_productpurpose_list', 'productpurposecode_t'] },
  { library: 'singleentry', name: 'w_producttype', detail: ['d_producttype_detail', 'code_t'], list: ['d_producttype_list', 'code_t'] },
  { library: 'singleentry', name: 'w_purchasetype_form', detail: ['d_purchasetyp_detail', 'salesmancode_t'], list: ['d_purtype_list', 'code_t'] },
  { library: 'singleentry', name: 'w_serviceinvoicetype_form', detail: ['d_serviceinvoicetype_detail', 't_1'], list: ['d_serviceinvoicetype_list', 'code_t'] },
  { library: 'singleentry', name: 'w_suppliercategory_form', detail: ['d_suppliercategory_detail', 't_1'], list: ['d_suppliercategory_list', 'code_t'] },
  { library: 'singleentryitem', name: 'w_categorysegment_form', detail: ['d_categorysegment_detail', 'code_t'], list: ['d_categorysegment_list', 'code_t'] },
  { library: 'singleentryitem', name: 'w_manufacturercategory_form', detail: ['d_manufacturercategory', 't_1'], list: ['d_manufacturercategory_list', 'manfcatcode_t'] },
  { library: 'singleentryitem', name: 'w_manufacturertype_form', detail: ['d_manufacturertype_detail', 't_1'], list: ['d_manufacturertype_list', 'code_t'] },
  { library: 'studentcomponents', name: 'w_classmedium_form', detail: ['d_classmedium_detail', 'classmediumcode_t'], list: ['d_classmedium_list', 'classmediumcode_t'] },
  { library: 'studentcomponents', name: 'w_classtype_form', detail: ['d_classtype_detail', 'classtypecode_t'], list: ['d_classtype_list', 'classtypecode_t'] },
  { library: 'studentcomponents', name: 'w_schoolbranch_form', detail: ['d_schoolbranch_detail', 'schoolbranchcode_t'], list: ['d_schoolbranch_list', 'schoolbranchcode_t'] },
]

function codeNameSurface([name, codeLabel, nameLabel = 'name_t']: CodeNameBinding, kind: DataSurface['kind']): DataSurface {
  return { name, title: kind === 'form' ? 'Detail' : 'List', kind, fields: [
    { object: 'code', labelObject: codeLabel }, { object: 'name', labelObject: nameLabel },
  ] }
}

function singleEntrySurface(name: string, detail: DataSurface, list: DataSurface, library = 'singleentry'): EntryWindowSurface {
  return {
    name, library, family: 'single',
    controls: entryControlPaths(['dw_detail', 'dw_print', 'dw_listprint']),
    details: [
      { control: 'dw_detail', kind: 'form', surface: detail },
      { control: 'dw_print', kind: 'auxiliary' }, { control: 'dw_listprint', kind: 'auxiliary' },
    ],
    list,
  }
}

interface DescriptiveEntryBinding {
  name: string
  library: string
  detail: string
  detailLabels: readonly [code: string, name: string, description: string]
  descriptionMultiline?: boolean
  list: DataSurface
}

function descriptiveEntrySurface(binding: DescriptiveEntryBinding): EntryWindowSurface {
  const [codeLabel, nameLabel, descriptionLabel] = binding.detailLabels
  return singleEntrySurface(binding.name, {
    name: binding.detail, title: 'Detail', kind: 'form', fields: [
      { object: 'code', labelObject: codeLabel },
      { object: 'name', labelObject: nameLabel },
      { object: 'description', labelObject: descriptionLabel, ...(binding.descriptionMultiline ? { multiline: true } : {}) },
    ],
  }, binding.list, binding.library)
}

const DESCRIPTIVE_ENTRIES: readonly DescriptiveEntryBinding[] = [
  { name: 'w_relation_form', library: 'patientcomponents', detail: 'd_relation', detailLabels: ['t_1', 'name_t', 't_2'],
    list: { name: 'd_relation_list', title: 'List', kind: 'grid', fields: [
      { object: 'compute_1', labelObject: 't_5', kind: 'computed', numeric: true },
      { object: 'code', labelObject: 'code_t' }, { object: 'name', labelObject: 'name_t' },
    ] } },
  { name: 'w_diseasetype_form', library: 'singleentry', detail: 'd_diseasetype_detail',
    detailLabels: ['diseasetypecode_t', 'name_t', 'description_t'],
    list: { name: 'd_diseasetype_list', title: 'List', kind: 'grid', fields: [
      { object: 'name', labelObject: 'name_t' }, { object: 'code', labelObject: 'code_t' },
    ] } },
  ...([
    { name: 'w_itembrand_form', detail: 'd_item_brand', list: 'd_item_brand_list' },
    { name: 'w_itemcolour_form', detail: 'd_item_colour', list: 'd_item_colour_list' },
    { name: 'w_itemfabric_form', detail: 'd_item_fabric', list: 'd_item_fabric_list' },
    { name: 'w_itemsleeve_form', detail: 'd_item_sleeve', list: 'd_item_sleeve_list' },
    { name: 'w_itemstyle_form', detail: 'd_item_style', list: 'd_item_style_list' },
    { name: 'w_itemyarn_form', detail: 'd_item_yarn', list: 'd_item_yarn_list' },
  ] as const).map(({ name, detail, list }): DescriptiveEntryBinding => ({
    name, library: 'singleentryitem', detail, detailLabels: ['t_1', 'name_t', 't_2'] as const,
    list: { name: list, title: 'List', kind: 'grid', fields: [
      { object: 'compute_1', labelObject: 't_5', kind: 'computed', numeric: true },
      { object: 'code', labelObject: 'code_t' }, { object: 'name', labelObject: 'name_t' },
    ] },
  })),
  { name: 'w_itemsize_form', library: 'singleentryitem', detail: 'd_item_size',
    detailLabels: ['t_1', 'name_t', 't_2'],
    list: { name: 'd_item_size_list', title: 'List', kind: 'grid', fields: [
      { object: 'compute_1', labelObject: 't_5', kind: 'computed', numeric: true },
      { object: 'code', labelObject: 'code_t' }, { object: 'name', labelObject: 'name_t' },
    ] } },
  { name: 'w_model_form', library: 'singleentryitem', detail: 'd_model',
    detailLabels: ['t_1', 'name_t', 't_2'],
    list: { name: 'd_model_list', title: 'List', kind: 'grid', fields: [
      { object: 'compute_1', labelObject: 't_5', kind: 'computed', numeric: true },
      { object: 'code', labelObject: 'code_t' }, { object: 'name', labelObject: 'name_t' },
    ] } },
  { name: 'w_rank_form', library: 'patientcomponents', detail: 'd_rank',
    detailLabels: ['t_1', 'name_t', 't_2'],
    list: { name: 'd_rank_list', title: 'List', kind: 'grid', fields: [
      { object: 'compute_1', labelObject: 't_5', kind: 'computed', numeric: true },
      { object: 'code', labelObject: 'code_t' }, { object: 'name', labelObject: 'name_t' },
    ] } },
  { name: 'w_site_form', library: 'singleentry', detail: 'd_shift',
    detailLabels: ['t_1', 'name_t', 't_2'],
    list: { name: 'd_shift_list', title: 'List', kind: 'grid', fields: [
      { object: 'compute_1', labelObject: 't_5', kind: 'computed', numeric: true },
      { object: 'code', labelObject: 'code_t' }, { object: 'name', labelObject: 'name_t' },
    ] } },
  { name: 'w_unit_form', library: 'patientcomponents', detail: 'd_unit',
    detailLabels: ['t_1', 'name_t', 't_2'],
    list: { name: 'd_unit_list', title: 'List', kind: 'grid', fields: [
      { object: 'compute_1', labelObject: 't_5', kind: 'computed', numeric: true },
      { object: 'code', labelObject: 'code_t' }, { object: 'name', labelObject: 'name_t' },
    ] } },
  { name: 'w_county_form', library: 'custcomponents', detail: 'd_county_detail',
    detailLabels: ['t_1', 'name_t', 'description_t'],
    list: { name: 'd_county_list', title: 'List', kind: 'grid', fields: [
      { object: 'code', labelObject: 'countycode_t' }, { object: 'name', labelObject: 'name_t' },
      { object: 'description', labelObject: 'description_t' },
    ] } },
  { name: 'w_eyevision_form', library: 'patientcomponents', detail: 'd_eyevision_detail',
    detailLabels: ['code_t', 'name_t', 'description_t'],
    list: { name: 'd_eyevision_list', title: 'List', kind: 'grid', fields: [
      { object: 'name', labelObject: 'name_t' }, { object: 'description', labelObject: 'description_t' },
      { object: 'code', labelObject: 'code_t' },
    ] } },
  { name: 'w_genericitemtype_form', library: 'singleentryitem', detail: 'd_genericitemtype_detail',
    detailLabels: ['code_t', 'name_t', 'description_t'],
    list: { name: 'd_genericitemtype_list', title: 'List', kind: 'grid', fields: [
      { object: 'code', labelObject: 'code_t' }, { object: 'name', labelObject: 'name_t' },
      { object: 'description', labelObject: 'description_t' },
    ] } },
  { name: 'w_godowngroup_form', library: 'singleentryitem', detail: 'd_godowngroup_detail',
    detailLabels: ['godowngroupcode_t', 'name_t', 'description_t'],
    list: { name: 'd_godowngroup_list', title: 'List', kind: 'grid', fields: [
      { object: 'code', labelObject: 'code_t' }, { object: 'name', labelObject: 'name_t' },
      { object: 'description', labelObject: 'description_t' },
    ] } },
  { name: 'w_iolpower_form', library: 'patientcomponents', detail: 'd_iolpower_detail',
    detailLabels: ['code_t', 'name_t', 'description_t'],
    list: { name: 'd_iolpower_list', title: 'List', kind: 'grid', fields: [
      { object: 'name', labelObject: 'name_t' }, { object: 'description', labelObject: 'description_t' },
      { object: 'code', labelObject: 'code_t' },
    ] } },
  { name: 'w_itemdesign_form', library: 'singleentryitem', detail: 'd_itemdesign_detail',
    detailLabels: ['authorcode_t', 'name_t', 'remarks_t'],
    list: { name: 'd_itemdesign_list', title: 'List', kind: 'grid', fields: [
      { object: 'code', labelObject: 'code_t' }, { object: 'name', labelObject: 'name_t' },
      { object: 'description', labelObject: 'description_t' },
    ] } },
  { name: 'w_itemthickness_form', library: 'singleentryitem', detail: 'd_item_thickness_detail',
    detailLabels: ['t_1', 'name_t', 't_2'],
    list: { name: 'd_item_thickness_list', title: 'List', kind: 'grid', fields: [
      { object: 'name', labelObject: 'name_t' }, { object: 'description', labelObject: 'description_t' },
      { object: 'code', labelObject: 'code_t' },
    ] } },
  { name: 'w_resourcecategory_form', library: 'singleentry', detail: 'd_resourcecategory_detail',
    detailLabels: ['code_t', 'name_t', 'description_t'], descriptionMultiline: true,
    list: { name: 'd_resourcecategory_list', title: 'List', kind: 'grid', fields: [
      { object: 'code', labelObject: 'code_t' }, { object: 'name', labelObject: 'name_t' },
      { object: 'description', labelObject: 'description_t' },
    ] } },
  { name: 'w_school_form', library: 'studentcomponents', detail: 'd_school_detail',
    detailLabels: ['code_t', 'name_t', 'description_t'],
    list: { name: 'd_school_list', title: 'List', kind: 'grid', fields: [
      { object: 'code', labelObject: 'code_t' }, { object: 'name', labelObject: 'name_t' },
      { object: 'description', labelObject: 'description_t' },
    ] } },
  { name: 'w_surgery_form', library: 'patientcomponents', detail: 'd_surgery_detail',
    detailLabels: ['code_t', 'name_t', 'description_t'],
    list: { name: 'd_surgery_list', title: 'List', kind: 'grid', fields: [
      { object: 'name', labelObject: 'name_t' }, { object: 'description', labelObject: 'description_t' },
      { object: 'code', labelObject: 'code_t' },
    ] } },
  { name: 'w_surgeryprocedure_form', library: 'patientcomponents', detail: 'd_surgeryprocedure_detail',
    detailLabels: ['code_t', 'name_t', 'description_t'],
    list: { name: 'd_surgeryprocedure_list', title: 'List', kind: 'grid', fields: [
      { object: 'name', labelObject: 'name_t' }, { object: 'description', labelObject: 'description_t' },
      { object: 'code', labelObject: 'code_t' },
    ] } },
  { name: 'w_ward_form', library: 'patientcomponents', detail: 'd_ward',
    detailLabels: ['code_t', 'name_t', 'description_t'],
    list: { name: 'd_ward_list', title: 'List', kind: 'grid', fields: [
      { object: 'code', labelObject: 'code_t' }, { object: 'name', labelObject: 'name_t' },
      { object: 'description', labelObject: 'description_t' },
    ] } },
]

export const CONTACT_LOOKUP_SURFACE: DataSurface = {
  name: 'ddd_contactcardlist', title: 'Contact cards', kind: 'grid', fields: [
    ...['code', 'contactcardname', 'title', 'name', 'address', 'phone', 'fax', 'email', 'mobile']
      .map((object) => ({ object, labelObject: object + '_t' })),
    { object: 'useforsms', labelObject: 'useforsms_t', choice: { kind: 'list' } },
    { object: 'web', labelObject: 'web_t' },
  ],
}

export const CONTACT_DETAIL_SURFACE: DataSurface = {
  name: 'd_contactgroupdetail', title: 'Contact group members', kind: 'grid', fields: [
    { object: 'compute_1', labelObject: 't_1', kind: 'computed', numeric: true },
    { object: 'contactcardcode', labelObject: 'contactcardcode_t', choice: {
      kind: 'lookup', name: 'ddd_contactcardlist', dataColumn: 'code', displayColumn: 'contactcardname', percentWidth: 1000, lines: 15,
    }, lookup: CONTACT_LOOKUP_SURFACE },
    ...['title', 'name', 'address', 'phone', 'fax', 'email', 'mobile'].map((object) => ({ object, labelObject: object + '_t' })),
    { object: 'useforsms', labelObject: 'useforsms_t', choice: { kind: 'list' } },
    { object: 'web', labelObject: 'web_t' },
  ],
}

export const ENTRY_WINDOW_SURFACES: readonly EntryWindowSurface[] = [{
  name: 'w_agingintervals', library: 'accounts', family: 'multi',
  controls: entryControlPaths(['dw_detail', 'dw_itemsdetail', 'dw_footer', 'dw_itemslist']),
  details: [
    { control: 'dw_detail', kind: 'form' }, { control: 'dw_itemsdetail', kind: 'grid' },
    { control: 'dw_footer', kind: 'auxiliary' }, { control: 'dw_itemslist', kind: 'auxiliary' },
  ],
}, {
  name: 'w_contactgroup', library: 'contactmanagement', family: 'multi',
  controls: entryControlPaths(['dw_detail', 'dw_itemsdetail', 'dw_footer', 'dw_itemslist']),
  details: [
    { control: 'dw_detail', kind: 'form' }, { control: 'dw_itemsdetail', kind: 'grid', surface: CONTACT_DETAIL_SURFACE },
    { control: 'dw_footer', kind: 'auxiliary' }, { control: 'dw_itemslist', kind: 'auxiliary' },
  ],
}, {
  name: 'w_contactcard_form', library: 'contactmanagement', family: 'multi',
  controls: entryControlPaths(['dw_detail', 'dw_itemsdetail', 'dw_footer', 'dw_itemslist', 'dw_print']),
  details: [
    { control: 'dw_detail', kind: 'form', surface: {
      name: 'd_contactcarddetail', title: 'Contact card', kind: 'form', fields: [
        { object: 'code', labelObject: 'code_t' },
        { object: 'acccode', labelObject: 'acccode_t', choice: {
          kind: 'lookup', name: 'ddd_allaccountslist_null', dataColumn: 'acccode', displayColumn: 'accountname', percentWidth: 100, lines: 15,
        } },
        { object: 'title', labelObject: 'title_t', choice: { kind: 'list', sorted: true } },
        { object: 'name', labelObject: 'name_t' },
        { object: 'address', labelObject: 'address_t', multiline: true },
        ...['phone', 'fax', 'email', 'mobile'].map((object) => ({ object, labelObject: object + '_t' })),
        { object: 'useforsms', labelObject: 'useforsms_t', choice: { kind: 'list', sorted: true } },
        { object: 'web', labelObject: 'web_t' },
      ],
    } },
    ...['dw_itemsdetail', 'dw_footer', 'dw_itemslist', 'dw_print'].map((control) => ({ control, kind: 'auxiliary' as const })),
  ],
  list: {
    name: 'd_contactcardlist', title: 'Contact cards', kind: 'grid', fields: [
      ...['code', 'accountname', 'title', 'name', 'address', 'phone', 'fax', 'email', 'mobile']
        .map((object) => ({ object, labelObject: object + '_t' })),
      { object: 'useforsms', labelObject: 'useforsms_t', choice: { kind: 'list' } },
      { object: 'web', labelObject: 'web_t' },
    ],
  },
}, ...SINGLE_ENTRIES.map((binding) => singleEntrySurface(binding.name,
  codeNameSurface(binding.detail, 'form'), codeNameSurface(binding.list, 'grid'), binding.library)),
...DESCRIPTIVE_ENTRIES.map(descriptiveEntrySurface),
singleEntrySurface('w_author_form', {
  name: 'd_author_detail', title: 'Detail', kind: 'form', fields: [
    { object: 'code', labelObject: 'authorcode_t' }, { object: 'name', labelObject: 'name_t' },
    { object: 'remarks', labelObject: 'remarks_t' },
  ],
}, {
  name: 'd_author_list', title: 'List', kind: 'grid', fields: [
    { object: 'code', labelObject: 'code_t' }, { object: 'name', labelObject: 'name_t' },
    { object: 'remarks', labelObject: 'remarks_t' },
  ],
}),
singleEntrySurface('w_dosageunit_form', {
  name: 'd_dosageunit_detail', title: 'Detail', kind: 'form', fields: [
    { object: 'code', labelObject: 'dosageunitcode_t' }, { object: 'name', labelObject: 'name_t' },
    { object: 'localdosageunit', labelObject: 't_1' },
  ],
}, {
  name: 'd_dosageunit_list', title: 'List', kind: 'grid', fields: [
    { object: 'code', labelObject: 'dosageunitcode_t' }, { object: 'name', labelObject: 'name_t' },
    { object: 'localdosageunit', labelObject: 'localdosageunit_t' },
  ],
}, 'eprescriptionbasics'),
singleEntrySurface('w_grade_form', {
  name: 'd_grade_detail', title: 'Detail', kind: 'form', fields: [
    { object: 'code', labelObject: 't_1' }, { object: 'name', labelObject: 'name_t' },
    { object: 'numericalfactor', labelObject: 'numericalfactor_t' },
  ],
}, {
  name: 'd_grade_list', title: 'List', kind: 'grid', fields: [
    { object: 'code', labelObject: 'code_t' }, { object: 'name', labelObject: 'name_t' },
    { object: 'numericalfactor', labelObject: 'numericalfactor_t' },
  ],
}, 'studentcomponents'),
...([
  {
    name: 'w_class_form', library: 'singleentryitem',
    detailLabels: ['t_1', 'name_t', 'numericalfactor_t'],
  },
  {
    name: 'w_itemclass_form', library: 'singleentryitem',
    detailLabels: ['t_1', 'name_t', 'numericalfactor_t'],
  },
] as const).map(({ name, library, detailLabels }) => singleEntrySurface(name, {
  name: 'd_item_class', title: 'Detail', kind: 'form', fields: [
    { object: 'code', labelObject: detailLabels[0] }, { object: 'name', labelObject: detailLabels[1] },
    { object: 'numericalfactor', labelObject: detailLabels[2] },
  ],
}, {
  name: 'd_item_class_list', title: 'List', kind: 'grid', fields: [
    { object: 'code', labelObject: 'code_t' }, { object: 'name', labelObject: 'name_t' },
  ],
}, library)),
singleEntrySurface('w_itempacking_form', {
  name: 'd_item_packing', title: 'Detail', kind: 'form', fields: [
    { object: 'code', labelObject: 't_1' }, { object: 'name', labelObject: 'name_t' },
    { object: 'numericalfactor', labelObject: 't_2' },
  ],
}, {
  name: 'd_itempackinglist', title: 'List', kind: 'grid', fields: [
    { object: 'code', labelObject: 'code_t' }, { object: 'name', labelObject: 'name_t' },
  ],
}, 'singleentryitem'),
singleEntrySurface('w_measuringunit_form', {
  name: 'd_measuringunit', title: 'Detail', kind: 'form', fields: [
    { object: 'code', labelObject: 'code_t' }, { object: 'name', labelObject: 'name_t' },
    { object: 'measureqty', labelObject: 'measureqty_t' },
  ],
}, {
  name: 'd_measuringunit_list', title: 'List', kind: 'grid', fields: [
    { object: 'code', labelObject: 'code_t' }, { object: 'name', labelObject: 'name_t' },
    { object: 'measureqty', labelObject: 'measureqty_t' },
  ],
}, 'singleentryitem'),
singleEntrySurface('w_transportroute_form', {
  name: 'd_transportroute_detail', title: 'Detail', kind: 'form', fields: [
    { object: 'code', labelObject: 'code_t' }, { object: 'name', labelObject: 'name_t' },
    { object: 'transportcharges', labelObject: 'transportcharges_t' },
  ],
}, {
  name: 'd_transportroute_list', title: 'List', kind: 'grid', fields: [
    { object: 'name', labelObject: 'name_t' }, { object: 'transportcharges', labelObject: 'transportcharges_t' },
    { object: 'code', labelObject: 'code_t' },
  ],
}, 'studentcomponents'),
singleEntrySurface('w_checklistitem_form', {
  name: 'd_checklistitem_detail', title: 'Detail', kind: 'form', fields: [
    { object: 'code', labelObject: 'code_t' }, { object: 'name', labelObject: 'name_t' },
    { object: 'autocheck', labelObject: 'autocheck_t', choice: { kind: 'checkbox', on: 'Y', off: 'N' } },
  ],
}, {
  name: 'd_checklistitem_list', title: 'List', kind: 'grid', fields: [
    { object: 'name', labelObject: 'name_t' }, { object: 'code', labelObject: 'code_t' },
    { object: 'autocheck', labelObject: 'autocheck_t', choice: { kind: 'checkbox', on: 'Y', off: 'N' } },
  ],
}),
singleEntrySurface('w_shift_form', {
  name: 'd_shift', title: 'Detail', kind: 'form', fields: [
    { object: 'code', labelObject: 't_1' }, { object: 'name', labelObject: 'name_t' },
    { object: 'description', labelObject: 't_2' },
  ],
}, {
  name: 'd_shift_list', title: 'List', kind: 'grid', fields: [
    { object: 'compute_1', labelObject: 't_5', kind: 'computed', numeric: true },
    { object: 'code', labelObject: 'code_t' }, { object: 'name', labelObject: 'name_t' },
  ],
}),
singleEntrySurface('w_taxcategory_form', {
  name: 'd_taxcategory_detail', title: 'Detail', kind: 'form', fields: [
    { object: 'code', labelObject: 'authorcode_t' }, { object: 'name', labelObject: 'name_t' },
    { object: 'taxperc', labelObject: 'remarks_t' },
  ],
}, {
  name: 'd_taxcategory_list', title: 'List', kind: 'grid', fields: [
    { object: 'name', labelObject: 'name_t' }, { object: 'code', labelObject: 'code_t' },
    { object: 'taxperc', labelObject: 'taxperc_t' },
  ],
}),
singleEntrySurface('w_dischargerefferal_form', {
  name: 'd_dischargerefferal_detail', title: 'Detail', kind: 'form', fields: [
    { object: 'code', labelObject: 'code_t' }, { object: 'name', labelObject: 'name_t' },
  ],
}, {
  name: 'd_dischargerefferal_list', title: 'List', kind: 'grid', fields: [
    { object: 'name', labelObject: 'name_t' },
  ],
}, 'patientcomponents'),
singleEntrySurface('w_vehicletype_form', {
  name: 'd_vehicletype_detail', title: 'Detail', kind: 'form', fields: [
    { object: 'code', labelObject: 'vehicletypecode_t' }, { object: 'name', labelObject: 'name_t' },
  ],
}, {
  name: 'd_vehicletype_list', title: 'List', kind: 'grid', sourceProcessing: 0, fields: [
    { object: 'name', labelObject: 'name_t', labelBand: 'header' },
    { object: 'code', labelObject: 'code_t', labelBand: 'header' },
  ],
}),
singleEntrySurface('w_pctcodes_form', {
  name: 'd_pctcodes_detail', title: 'Detail', kind: 'form', fields: [
    { object: 'code', labelObject: 'code_t' }, { object: 'name', labelObject: 'description_t' },
    { object: 'remarks', labelObject: 'remarks_t' },
  ],
}, {
  name: 'd_pctcodes_list', title: 'List', kind: 'grid', fields: [
    { object: 'name', labelObject: 'name_t' }, { object: 'remarks', labelObject: 'remarks_t' },
  ],
}, 'singleentryitem'),
singleEntrySurface('w_tests_form', {
  name: 'd_test_detail', title: 'Detail', kind: 'form', fields: [
    { object: 'code', labelObject: 'ctcode_t' }, { object: 'name', labelObject: 'name_t' },
    { object: 'testprice', labelObject: 'testprice_t' },
  ],
}, {
  name: 'd_test_list', title: 'List', kind: 'grid', fields: [
    { object: 'code', labelObject: 'ctcode_t' }, { object: 'name', labelObject: 'name_t' },
  ],
}),
singleEntrySurface('w_itemmeter_form', {
  name: 'd_itemmeter_detail', title: 'Detail', kind: 'form', fields: [
    { object: 'code', labelObject: 'code_t' }, { object: 'name', labelObject: 'name_t' },
    { object: 'description', labelObject: 'description_t' },
    { object: 'currentreading', labelObject: 'currentreading_t' },
  ],
}, {
  name: 'd_itemmeter_list', title: 'List', kind: 'grid', fields: [
    { object: 'name', labelObject: 'name_t' }, { object: 'description', labelObject: 'description_t' },
    { object: 'code', labelObject: 'code_t' }, { object: 'currentreading', labelObject: 'currentreading_t' },
  ],
}, 'singleentryitem'),
singleEntrySurface('w_goodscompany_form', {
  name: 'd_goodscompany_detail', title: 'Detail', kind: 'form', fields: [
    { object: 'code', labelObject: 'doctcode_t' }, { object: 'name', labelObject: 'name_t' },
    { object: 'address1', labelObject: 't_2' }, { object: 'address2', labelObject: 't_4' },
    { object: 'city', labelObject: 'remarks_t' }, { object: 'country', labelObject: 't_5' },
    { object: 'phone', labelObject: 't_6' }, { object: 'fax', labelObject: 't_7' },
    { object: 'email', labelObject: 't_8' },
  ],
}, {
  name: 'd_goodscompanylist_list', title: 'List', kind: 'grid', fields: [
    { object: 'code', labelObject: 'code_t' }, { object: 'name', labelObject: 'name_t' },
  ],
}),
singleEntrySurface('w_biometricmachine', {
  name: 'd_biometricmachine', title: 'Detail', kind: 'form', fields: [
    { object: 'code', labelObject: 'code_t' }, { object: 'name', labelObject: 'name_t' },
    { object: 'manufacturer', labelObject: 'manufacturer_t' }, { object: 'model', labelObject: 'model_t' },
    { object: 'ipaddress', labelObject: 'ipaddress_t' }, { object: 'port', labelObject: 'port_t' },
  ],
}, {
  name: 'd_biometricmachinelist', title: 'List', kind: 'grid', fields: [
    { object: 'name', labelObject: 'name_t' }, { object: 'ipaddress', labelObject: 'ipaddress_t' },
    { object: 'port', labelObject: 'port_t' }, { object: 'manufacturer', labelObject: 'manufacturer_t' },
    { object: 'model', labelObject: 'model_t' }, { object: 'code', labelObject: 'code_t' },
  ],
}),
singleEntrySurface('w_crs_clientlist', {
  name: 'd_clientlist_detail', title: 'Detail', kind: 'form', fields: [
    { object: 'code', labelObject: 'code_t' }, { object: 'name', labelObject: 'name_t' },
    { object: 'address1', labelObject: 'address1_t' }, { object: 'address2', labelObject: 'address2_t' },
    { object: 'phone', labelObject: 'phone_t' }, { object: 'phone2', labelObject: 'phone2_t' },
    { object: 'fax', labelObject: 'fax_t' }, { object: 'email', labelObject: 'email_t' },
    { object: 'web', labelObject: 'web_t' }, { object: 'cp', labelObject: 'cp_t' },
    { object: 'cpphone', labelObject: 'cpphone_t' }, { object: 'cpmobile', labelObject: 'cpmobile_t' },
  ],
}, {
  name: 'd_clientlist_list', title: 'List', kind: 'grid', fields: [
    { object: 'code', labelObject: 'code_t' }, { object: 'name', labelObject: 'name_t' },
    { object: 'address1', labelObject: 'address1_t' }, { object: 'address2', labelObject: 'address2_t' },
    { object: 'phone', labelObject: 'phone_t' }, { object: 'phone2', labelObject: 'phone2_t' },
    { object: 'fax', labelObject: 'fax_t' }, { object: 'email', labelObject: 'email_t' },
    { object: 'web', labelObject: 'web_t' }, { object: 'cp', labelObject: 'cp_t' },
    { object: 'cpphone', labelObject: 'cpphone_t' }, { object: 'cpmobile', labelObject: 'cpmobile_t' },
  ],
}, 'crscomponents'),
singleEntrySurface('w_custsector_form', {
  name: 'd_customersector_detail', title: 'Detail', kind: 'form', fields: [
    { object: 'code', labelObject: 'customersegmentcode_t' }, { object: 'name', labelObject: 'name_t' },
    { object: 'aliasname', labelObject: 't_1' }, { object: 'description', labelObject: 't_2' },
  ],
}, {
  name: 'd_customersector_list', title: 'List', kind: 'grid', fields: [
    { object: 'name', labelObject: 'name_t' }, { object: 'aliasname', labelObject: 'aliasname_t' },
    { object: 'description', labelObject: 'description_t' }, { object: 'code', labelObject: 'code_t' },
  ],
}, 'custcomponents'),
singleEntrySurface('w_dosage_form', {
  name: 'd_dosage', title: 'Detail', kind: 'form', fields: [
    { object: 'code', labelObject: 't_1' }, { object: 'name', labelObject: 'name_t' },
    { object: 'dosefactor', labelObject: 't_dosefactor' }, { object: 'description', labelObject: 't_2' },
    { object: 'localdosage', labelObject: 't_3' },
  ],
}, {
  name: 'd_dosage_list', title: 'List', kind: 'grid', fields: [
    { object: 'compute_1', labelObject: 't_5', kind: 'computed', numeric: true },
    { object: 'code', labelObject: 'code_t' }, { object: 'name', labelObject: 'name_t' },
    { object: 'localdosage', labelObject: 'localdosage_t' },
  ],
}, 'patientcomponents'),
singleEntrySurface('w_instruction_form', {
  name: 'd_instruction', title: 'Detail', kind: 'form', fields: [
    { object: 'code', labelObject: 't_1' }, { object: 'name', labelObject: 'name_t' },
    { object: 'description', labelObject: 't_2' }, { object: 'localinstruction', labelObject: 't_3' },
  ],
}, {
  name: 'd_instruction_list', title: 'List', kind: 'grid', fields: [
    { object: 'compute_1', labelObject: 't_5', kind: 'computed', numeric: true },
    { object: 'code', labelObject: 'code_t' }, { object: 'name', labelObject: 'name_t' },
    { object: 'localinstruction', labelObject: 'localinstruction_t' },
  ],
}, 'patientcomponents'),
singleEntrySurface('w_precaution_form', {
  name: 'd_precautiondetail', title: 'Detail', kind: 'form', fields: [
    { object: 'code', labelObject: 't_1' }, { object: 'name', labelObject: 'name_t' },
    { object: 'localprecaution', labelObject: 't_2' },
  ],
}, {
  name: 'd_precautionlist', title: 'List', kind: 'grid', fields: [
    { object: 'name', labelObject: 'name_t' }, { object: 'localprecaution', labelObject: 'localprecaution_t' },
    { object: 'code', labelObject: 'code_t' },
  ],
}, 'patientcomponents'),
singleEntrySurface('w_region_form', {
  name: 'd_region_detail', title: 'Detail', kind: 'form', fields: [
    { object: 'code', labelObject: 'salesmancode_t' }, { object: 'name', labelObject: 'name_t' },
    { object: 'manager', labelObject: 'password_t' }, { object: 'remarks', labelObject: 't_1' },
  ],
}, {
  name: 'd_region_list', title: 'List', kind: 'grid', fields: [
    { object: 'code', labelObject: 'code_t' }, { object: 'name', labelObject: 'name_t' },
  ],
}, 'custcomponents'),
singleEntrySurface('w_route_form', {
  name: 'd_route', title: 'Detail', kind: 'form', fields: [
    { object: 'code', labelObject: 't_1' }, { object: 'name', labelObject: 'name_t' },
    { object: 'description', labelObject: 't_2' }, { object: 'localroute', labelObject: 't_3' },
  ],
}, {
  name: 'd_route_list', title: 'List', kind: 'grid', fields: [
    { object: 'compute_1', labelObject: 't_5', kind: 'computed', numeric: true },
    { object: 'code', labelObject: 'code_t' }, { object: 'name', labelObject: 'name_t' },
    { object: 'localroute', labelObject: 'localroute_t' },
  ],
}, 'patientcomponents'),
singleEntrySurface('w_saletype_form', {
  name: 'd_saletype', title: 'Detail', kind: 'form', fields: [
    { object: 'code', labelObject: 't_1' }, { object: 'name', labelObject: 'name_t' },
    { object: 'description', labelObject: 't_2' }, { object: 'counter', labelObject: 't_3' },
  ],
}, {
  name: 'd_saletype_list', title: 'List', kind: 'grid', fields: [
    { object: 'code', labelObject: 'code_t' }, { object: 'name', labelObject: 'name_t' },
  ],
}),
singleEntrySurface('w_weighingscale_form', {
  name: 'd_weighingscale_detail', title: 'Detail', kind: 'form', fields: [
    { object: 'code', labelObject: 'code_t' }, { object: 'name', labelObject: 'name_t' },
    { object: 'manufacturer', labelObject: 'manufacturer_t' }, { object: 'model', labelObject: 'model_t' },
    { object: 'scaleid', labelObject: 'scaleid_t' }, { object: 'scaleidpos', labelObject: 'scaleidpos_t' },
    { object: 'barcodelen', labelObject: 'barcodelen_t' }, { object: 'itemstartpos', labelObject: 'itemstartpos_t' },
    { object: 'itemendpos', labelObject: 'itemendpos_t' }, { object: 'weightstartpos', labelObject: 'weightstartpos_t' },
    { object: 'weightendpos', labelObject: 'weightendpos_t' },
  ],
}, {
  name: 'd_weighingscale_list', title: 'List', kind: 'grid', fields: [
    { object: 'code', labelObject: 'code_t' }, { object: 'name', labelObject: 'name_t' },
    { object: 'manufacturer', labelObject: 'manufacturer_t' }, { object: 'model', labelObject: 'model_t' },
    { object: 'scaleid', labelObject: 'scaleid_t' },
  ],
}, 'singleentryitem')]

export function entryWindowIssues(controls: EntryWindowSurface['controls'], surface: EntryWindowSurface): string[] {
  const issues: string[] = []
  const found = new Map(controls.map((control) => [control.path, control.native]))
  const expected = new Map(surface.controls.map((control) => [control.path, control.native]))
  if (found.size !== controls.length) issues.push('Duplicate control paths')
  if (expected.size !== surface.controls.length) issues.push('Duplicate layout bindings')
  for (const [path, native] of expected) if (found.get(path) !== native) issues.push(`Unsupported control: ${path}`)
  for (const path of found.keys()) if (!expected.has(path)) issues.push(`Unmapped control: ${path}`)
  const placed = new Set<string>()
  for (const detail of surface.details) {
    const path = `${detailPage}.${detail.control}`
    if (placed.has(path)) issues.push(`Duplicate detail placement: ${path}`)
    placed.add(path)
    if (expected.get(path) !== 'datawindow') issues.push(`Unsupported detail placement: ${path}`)
  }
  for (const path of expected.keys()) if (path.startsWith(`${detailPage}.`) && !placed.has(path)) issues.push(`Unplaced detail control: ${path}`)
  return issues
}

export function windowSurfaceIssues(
  controls: readonly { name: string; native: string; children?: number }[],
  surface: WindowSurface,
): string[] {
  const issues: string[] = []
  const found = new Map(controls.map((control) => [control.name, control]))
  const used = new Set<string>()
  if (found.size !== controls.length) issues.push('Duplicate control identities')
  const use = (name: string, types: readonly string[]) => {
    const control = found.get(name)
    if (!control || !types.includes(control.native) || control.children) issues.push(`Unsupported control: ${name}`)
    if (used.has(name)) issues.push(`Duplicate binding: ${name}`)
    used.add(name)
  }
  for (const field of surface.fields) {
    use(field.control, ['editmask', 'singlelineedit'])
    use(field.label, ['statictext'])
  }
  for (const data of surface.data ?? []) use(data.control, ['datawindow'])
  for (const name of surface.auxiliary ?? []) use(name, ['datawindow'])
  if (surface.frame) use(surface.frame, ['groupbox'])
  for (const name of surface.frames ?? []) use(name, ['groupbox'])
  for (const list of surface.lists ?? []) {
    use(list.control, ['listbox'])
    use(list.caption, ['groupbox'])
  }
  for (const name of surface.captions ?? []) use(name, ['statictext'])
  for (const option of surface.options ?? []) use(option.control, [option.native])
  for (const name of surface.calendars ?? []) use(name, ['monthcalendar'])
  for (const action of surface.actions) use(action, ['commandbutton'])
  const labels = new Set<string>()
  for (const data of surface.data ?? []) for (const label of data.labels ?? []) {
    if (data.surface.kind !== 'form' || !surface.captions?.includes(label.control) ||
      !data.surface.fields.some((field) => field.object === label.field)) {
      issues.push(`Unsupported data label: ${data.control}.${label.field}`)
    }
    if (labels.has(label.control) || data.labels!.filter((item) => item.field === label.field).length > 1) {
      issues.push(`Duplicate data label: ${label.control}`)
    }
    labels.add(label.control)
  }
  if (surface.contentOrder) {
    const content = [...surface.fields.map((field) => field.control), ...(surface.captions ?? []), ...(surface.frames ?? []),
      ...(surface.lists ?? []).map((list) => list.control), ...(surface.calendars ?? []),
      ...(surface.data ?? []).map((data) => data.control), ...(surface.options ?? []).map((option) => option.control)]
    if (surface.contentOrder.length !== content.length || new Set(surface.contentOrder).size !== content.length ||
      surface.contentOrder.some((name) => !content.includes(name))) {
      issues.push('Content order must include every field, caption, frame, list, DataWindow and option once')
    }
  }
  for (const control of controls) if (!used.has(control.name)) issues.push(`Unmapped control: ${control.name}`)
  return issues
}
