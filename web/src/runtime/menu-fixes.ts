// Menu entries of a few windows that the exported scripts leave in a state the original does not show.
//
// Measured on the original (abuzar.exe, ADMIN, 2026-11-25: every File / Item entry of the window each non-report menu leaf opens, read through the Win32 menu), the
// original lists `Print` (disabled until an invoice is there) on the transaction windows although `m_multi_entry.m_print.create` sets Visible = false and no script of
// these windows shows it again, hides `Post` where the rebuild keeps it (Adjustment Decrease), calls the sale windows' post entry "Post Sale Invoices" / "Post Sale
// Returns", and has no Item menu on Priority Setting and Lock Item Batches. The recovered scripts and the p-code agree with each other, so the difference is in what the
// PowerBuilder runtime does with the menu (the cause was not found); the rebuild copies the measured result. Without `Print` the transaction windows had no way to print
// the current invoice. Applied once when the window comes up (the scripts only toggle Enabled afterwards).
import type { PBObject } from './object.ts'

interface Fix { path: string[]; visible?: boolean; toolbar?: boolean; text?: string }

const PRINT: Fix = { path: ['m_file', 'm_print'], visible: true, toolbar: true }

export const MENU_FIXES: Record<string, Fix[]> = {
  w_purchase: [PRINT],
  w_purchasereturn: [PRINT],
  w_purchaseorder: [PRINT],
  w_quotation: [PRINT],
  w_sale: [PRINT, { path: ['m_file', 'm_post'], text: 'Post Sale Invoices\tCtrl+E' }],
  w_salereturn: [PRINT, { path: ['m_file', 'm_post'], text: 'Post Sale Returns\tCtrl+E' }],
  w_adjincrease: [PRINT],
  w_adjwindow: [PRINT, { path: ['m_file', 'm_post'], visible: false, toolbar: false }],
  w_adjbuffer: [PRINT],
  w_itempriority_form: [{ path: ['m_item'], visible: false }],
  w_lockitembatches_form: [{ path: ['m_item'], visible: false }],
}

function find(menu: PBObject, path: string[]): PBObject | null {
  let at: PBObject | null = menu
  for (const part of path) {
    let next: PBObject | null = null
    for (const child of at.children.values()) if (child.name.toLowerCase() === part) { next = child; break }
    if (!next) return null
    at = next
  }
  return at
}

/** the windows' menu entries as measured on the original; a window or an entry that is not there is left alone */
export function applyMenuFixes(w: PBObject): void {
  const fixes = MENU_FIXES[w.name.toLowerCase()] ?? MENU_FIXES[w.className.toLowerCase()]
  const menu = w.props.get('menuid') as PBObject | undefined
  if (!fixes || !menu || !menu.children) return
  for (const fix of fixes) {
    const item = find(menu, fix.path)
    if (!item) continue
    if (fix.visible !== undefined) item.pbSet('visible', fix.visible)
    if (fix.toolbar !== undefined) item.pbSet('toolbaritemvisible', fix.toolbar)
    if (fix.text !== undefined) item.pbSet('text', fix.text)
  }
}
