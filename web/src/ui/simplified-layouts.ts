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
}

export const SIMPLIFIED_LAYOUTS: readonly SimplifiedLayout[] = [
  {
    // Pack Purchase (w_purchase, normal purchase): supplier and bill first, rare bill options behind "More bill options".
    surface: 'd_normalpurchaseheader', kind: 'form', moreLabel: 'More bill options',
    primary: ['code', 'date', 'gcode', 'taxcategorycode', 'suppcode', 'ntn', 'suppbalance', 'suppinvcode', 'suppinvdate', 'grn', 'remarks'],
  },
  {
    // Pack Purchase item lines: what a clerk keys from the supplier's bill, plus the results they check.
    surface: 'd_normalpurchasedetail', kind: 'grid', moreLabel: 'columns',
    primary: ['c_serialno', 'quicksearch', 'fullcode', 'itemname', 'batch', 'expiry', 'packqty', 'bonusqty', 'purprice', 'discperc',
      'c_gstval', 'c_finalitemval', 'c_margin'],
  },
  {
    surface: 'd_purchasefooter', kind: 'form', moreLabel: '', emphasis: 'total',
    primary: ['stock', 'discperc', 'flatdisc', 'misccharges', 'invgstperc1', 'advancetaxamt', 'totalstock', 'totalexp', 'itemtotalval', 'total'],
  },
]

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
      toggle.textContent = caption()
      toggle.setAttribute('aria-expanded', String(state.open))
    })
    body.insertBefore(toggle, table)
    return
  }
  for (const row of body.querySelectorAll<HTMLElement>('.surface-row')) {
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
