// Approved departures from structural parity (user decision 2026-11-11, see docs/HANDOFF.md "Approved parity exceptions").
// A simplified layout never drops a field: it only marks some visible fields as secondary.  Secondary header fields move into a
// "More options" disclosure, secondary grid columns are hidden until the user (or a script that moves focus there) shows all
// columns.  The DataWindow objects, their events, validation and computed values are untouched; only the painted DOM changes.

export interface SimplifiedLayout {
  /** DataWindow (data surface) name the layout applies to. */
  surface: string
  kind: 'form' | 'grid'
  /** Fields shown by default; every other visible field is secondary. */
  primary: readonly string[]
  /** Field shown as the emphasised total (form surfaces only). */
  emphasis?: string
  /** Caption of the disclosure (form) or the column toggle (grid). */
  moreLabel: string
  /** Card heading and hint shown above the surface (the approved mockup's section titles). */
  heading?: string
  hint?: string
  /** Visual order of the visible fields (forms); fields not listed follow in source order. */
  order?: readonly string[]
  /** Fields that take two columns of the form grid. */
  wide?: readonly string[]
  /** Totals of the grid's footer band that stay visible while secondary columns are hidden. */
  primaryTotals?: readonly string[]
  /** The surface is the bill summary panel beside the form and the items. */
  summary?: boolean
  /** Keep the source arrangement (fields placed with separate caption objects must stay next to them). */
  keepLayout?: boolean
}

export const SIMPLIFIED_LAYOUTS: readonly SimplifiedLayout[] = [
  {
    // Pack Purchase (w_purchase, normal purchase): supplier and bill first, rare bill options behind "More bill options".
    surface: 'd_normalpurchaseheader', kind: 'form', moreLabel: 'More bill options',
    heading: 'Supplier & bill', hint: 'Who sold it, and their bill number',
    order: ['suppcode', 'suppinvcode', 'date', 'gcode', 'taxcategorycode', 'grn', 'remarks', 'code', 'suppinvdate', 'ntn', 'suppbalance'],
    wide: ['suppcode'],
    primary: ['code', 'date', 'gcode', 'taxcategorycode', 'suppcode', 'ntn', 'suppbalance', 'suppinvcode', 'suppinvdate', 'grn', 'remarks'],
  },
  {
    // Pack Purchase item lines: what a clerk keys from the supplier's bill, plus the results they check.
    surface: 'd_normalpurchasedetail', kind: 'grid', moreLabel: 'columns', heading: 'Items', hint: 'Type a name, code or barcode in the item column',
    primaryTotals: ['c_sumpackqty', 'c_sumbonusqty', 'c_sumgstval', 'c_total_finalitemval'],
    primary: ['c_serialno', 'quicksearch', 'fullcode', 'itemname', 'batch', 'expiry', 'packqty', 'bonusqty', 'purprice', 'discperc',
      'c_gstval', 'c_finalitemval', 'c_margin'],
  },
  {
    surface: 'd_purchasefooter', kind: 'form', moreLabel: '', emphasis: 'total', heading: 'Bill summary', summary: true,
    order: ['itemtotalval', 'discperc', 'flatdisc', 'misccharges', 'invgstperc1', 'advancetaxamt', 'stock', 'totalstock', 'totalexp', 'total'],
    primary: ['stock', 'discperc', 'flatdisc', 'misccharges', 'invgstperc1', 'advancetaxamt', 'totalstock', 'totalexp', 'itemtotalval', 'total'],
  },
]

/** Section headings of the approved design for transaction windows (header form, line grid, footer form). */
const TRANSACTION_HEADINGS: Record<string, [string, string, string, string, string]> = {
  w_sale: ['Customer & invoice', 'Who is buying, and how the sale is billed', 'Sale lines', 'Scan a barcode or type an item in the item column', 'Payment'],
  w_item_form: ['Item', 'Name, packing, prices and tax', 'Lines', '', 'Summary'],
}
const TOTAL_FIELDS = ['c_big_grandtotal', 'total', 'c_nettotal', 'grandtotal', 'c_grandtotal', 'nettotal']

/**
 * The approved design's layout for any entry window shaped as header form, line grid and footer form (sales, purchases, returns,
 * vouchers): cards with headings, the header on a 4-column grid, the footer as the summary panel with its total in the dark band.
 * Every field stays visible in its source order; nothing moves out of its surface.
 */
export function transactionLayout(role: 'header' | 'grid' | 'footer', surface: string, window: string, fields: readonly string[], captions: boolean): SimplifiedLayout {
  const [h1, hint1, h2, hint2, h3] = TRANSACTION_HEADINGS[window] ?? ['Details', '', 'Lines', '', 'Summary']
  if (role === 'grid') return { surface, kind: 'grid', moreLabel: 'columns', primary: fields, heading: h2, hint: hint2 }
  // Footers keep their source arrangement (their totals are captioned by separate text objects) in a full-width card.
  if (role === 'footer') return { surface, kind: 'form', moreLabel: '', primary: fields, heading: h3, keepLayout: true }
  return { surface, kind: 'form', moreLabel: '', primary: fields, heading: h1, hint: hint1, keepLayout: captions }
}

export function simplifiedLayout(surface: string): SimplifiedLayout | undefined {
  return SIMPLIFIED_LAYOUTS.find((layout) => layout.surface === surface)
}

/** Per-view state the painter keeps between repaints. */
export interface SimplifiedState { open: boolean; column?: string }

/**
 * Applies the layout to a freshly painted surface body, before it is attached.  `current` is the DataWindow's current column:
 * when it moves to a secondary field (a script's SetColumn, Tab from the last primary field) the secondary fields are shown, so
 * focus always lands on a visible editor.  The column a surface opens on does not count as a move.
 */
export function applySimplifiedLayout(layout: SimplifiedLayout, body: HTMLElement, state: SimplifiedState, current: string | undefined): void {
  const primary = new Set(layout.primary)
  const moved = 'column' in state && current !== state.column
  state.column = current
  if (moved && current && !primary.has(current)) state.open = true
  body.classList.add('simplified-surface', `simplified-${layout.kind}`)
  if (layout.summary) body.classList.add('simplified-summary')
  if (layout.heading) {
    const head = document.createElement('div')
    head.className = 'simplified-head'
    const title = document.createElement('h2')
    title.textContent = layout.heading
    head.append(title)
    if (layout.hint) {
      const hint = document.createElement('span')
      hint.textContent = layout.hint
      head.append(hint)
    }
    body.prepend(head)
  }
  // Captions read as in the approved mockup: no trailing colon (the text comes from the DataWindow and is otherwise unchanged).
  for (const label of body.querySelectorAll<HTMLElement>('.surface-label, th > span:first-child')) {
    if (label.childElementCount === 0 && /:\s*$/.test(label.textContent ?? '')) label.textContent = label.textContent!.replace(/\s*:\s*$/, '')
  }
  if (layout.emphasis) body.querySelector<HTMLElement>(`.surface-field[data-field="${layout.emphasis}"]`)?.classList.add('simplified-emphasis')
  if (layout.kind === 'grid') {
    const table = body.querySelector<HTMLTableElement>('table.surface-grid')
    if (!table) return
    const headings = [...table.tHead?.rows[0]?.cells ?? []]
    const secondary = headings.flatMap((th, index) => th.dataset.field && !primary.has(th.dataset.field) ? [index] : [])
    if (!secondary.length) return
    for (const index of secondary) {
      headings[index].classList.add('simplified-secondary')
      table.querySelectorAll('colgroup > col')[index]?.classList.add('simplified-secondary')
    }
    for (const cell of table.querySelectorAll<HTMLElement>('tbody td.surface-field[data-field]')) {
      if (!primary.has(cell.dataset.field!)) cell.classList.add('simplified-secondary')
    }
    const totals = new Set(layout.primaryTotals ?? [])
    for (const value of body.querySelectorAll<HTMLElement>('.surface-band-footer [data-obj]')) {
      if (totals.size && !totals.has(value.dataset.obj!)) value.closest('dl > div')?.classList.add('simplified-secondary')
    }
    body.classList.toggle('simplified-all', state.open)
    table.classList.toggle('simplified-all', state.open)
    const toggle = document.createElement('button')
    toggle.type = 'button'
    toggle.className = 'simplified-toggle'
    const caption = () => state.open ? `Show fewer ${layout.moreLabel}` : `Show all ${layout.moreLabel} (+${secondary.length})`
    toggle.textContent = caption()
    toggle.setAttribute('aria-expanded', String(state.open))
    toggle.addEventListener('click', () => {
      state.open = !state.open
      table.classList.toggle('simplified-all', state.open)
      body.classList.toggle('simplified-all', state.open)
      toggle.textContent = caption()
      toggle.setAttribute('aria-expanded', String(state.open))
    })
    body.insertBefore(toggle, table)
    return
  }
  if (layout.keepLayout) return
  const wide = new Set(layout.wide ?? [])
  for (const row of body.querySelectorAll<HTMLElement>('.surface-row')) {
    row.classList.add('simplified-row')
    for (const field of row.querySelectorAll<HTMLElement>('.surface-field[data-field]')) {
      const index = layout.order?.indexOf(field.dataset.field!) ?? -1
      field.style.order = String(index < 0 ? 100 : index)
      field.classList.toggle('simplified-wide', wide.has(field.dataset.field!))
    }
    const secondary = [...row.querySelectorAll<HTMLElement>('.surface-field[data-field]')].filter((field) => !primary.has(field.dataset.field!))
    if (!secondary.length) continue
    const more = document.createElement('details')
    more.className = 'simplified-more'
    more.open = state.open
    more.addEventListener('toggle', () => { state.open = more.open })
    const summary = document.createElement('summary')
    summary.textContent = layout.moreLabel
    const fields = document.createElement('div')
    fields.className = 'simplified-more-fields'
    // Source order is kept inside the disclosure.
    fields.append(...secondary)
    more.append(summary, fields)
    row.append(more)
  }
}
