import { typeInto } from './ds-sale.ts'

// Pack Purchase companion of the approved design: progress steps, supplier card, the ready-to-post panel and the command-bar status,
// all read from the window's live DataWindows.  Every button runs the window's own toolbar command (the same menu item and script),
// so nothing here holds business logic; elements live outside the repainted data surfaces.

interface Model { name: string; version: number; rowCount(): number; getItem(row: number, column: string): unknown; modifiedCount(): number; hasName(name: string): boolean }
export interface PurchaseContext {
  /** The window's client element and its DataWindow models by control name. */
  root: HTMLElement
  model(control: string): Model | null
  /** Runs a read-only query; rows as arrays. */
  query(sql: string, params: unknown[]): Promise<unknown[][]>
}

const str = (v: unknown) => (v === null || v === undefined ? '' : String(v)).trim()
const numv = (v: unknown) => Number(v) || 0
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!))
const supplierCache = new Map<string, { terms: string; last: string; name: string } | 'loading'>()
const postedCache = new Map<string, boolean | 'loading'>()

export interface PurchaseState { supp: boolean; bill: boolean; items: boolean; price: boolean; posted: boolean; dirty: boolean; position: string }

export function purchaseState(ctx: PurchaseContext, onAsync: () => void): PurchaseState | null {
  const header = ctx.model('dw_detail'), lines = ctx.model('dw_itemsdetail'), list = ctx.model('dw_list')
  if (!header || header.name !== 'd_normalpurchaseheader' || !lines || header.rowCount() < 1) return null
  const code = str(header.getItem(1, 'code'))
  const rows: number[] = []
  for (let r = 1; r <= lines.rowCount(); r++) if (str(lines.getItem(r, 'itemname')) || str(lines.getItem(r, 'fullcode'))) rows.push(r)
  const dirty = header.modifiedCount() > 0 || lines.modifiedCount() > 0
  let posted = false
  if (code) {
    const known = postedCache.get(code)
    if (known === undefined) {
      postedCache.set(code, 'loading')
      void ctx.query('SELECT posted FROM dbo.purledger WHERE purinvcode = $1', [code])
        .then((r) => { postedCache.set(code, str(r[0]?.[0]).toUpperCase() === 'Y'); onAsync() }).catch(() => postedCache.delete(code))
    } else if (known !== 'loading') posted = known
  }
  let position = ''
  if (list && list.rowCount() > 0 && code) {
    for (let r = 1; r <= list.rowCount(); r++) if (str(list.getItem(r, 'code')) === code) { position = `${r} of ${list.rowCount()}`; break }
  }
  return {
    supp: !!str(header.getItem(1, 'suppcode')), bill: !!str(header.getItem(1, 'suppinvcode')), items: rows.length > 0,
    price: rows.length > 0 && rows.every((r) => numv(lines.getItem(r, 'packqty')) > 0 && numv(lines.getItem(r, 'purprice')) > 0),
    posted, dirty, position,
  }
}

const ringSvg = (p: number) => { const r = 22, c = 2 * Math.PI * r; return `<svg viewBox="0 0 54 54" aria-hidden="true"><circle class="bgc" cx="27" cy="27" r="${r}"/><circle class="fgc" cx="27" cy="27" r="${r}" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${(c * (1 - p)).toFixed(1)}"/></svg>` }

/** Inserts or updates the companion elements; `toolbar(stock)` returns the window's toolbar button for a stock picture. */
/** The window's own menu commands the companion runs (null when the menu does not offer one to this user). */
export type PurchaseMenu = (key: 'slip' | 'labels' | 'history' | 'expenses' | 'supplier') => (() => void) | null
export const PURCHASE_MENU: Record<Parameters<PurchaseMenu>[0], RegExp> = {
  slip: /^purchase slip$/i, labels: /^print purchase labels$/i, history: /^item purchase history$/i, expenses: /^show purchase expenses window$/i, supplier: /^supplier info\.?$/i,
}

export function decoratePurchase(ctx: PurchaseContext, state: PurchaseState, toolbar: (stock: string) => HTMLButtonElement | null, onAsync: () => void, menu: PurchaseMenu = () => null): void {
  const detail = ctx.root.querySelector<HTMLElement>('.entry-detail')
  if (!detail) return
  // progress steps
  let steps = detail.querySelector<HTMLElement>(':scope > .ds-steps')
  if (!steps) {
    steps = document.createElement('ol')
    steps.className = 'ds-steps'
    steps.setAttribute('aria-label', 'Progress')
    detail.prepend(steps)
  }
  const s1 = state.supp && state.bill, s2 = state.items && state.price
  const step = (n: number) => state.posted || (n === 1 && s1) || (n === 2 && s1 && s2) ? 'done' : (n === 1 && !s1) || (n === 2 && s1 && !s2) || (n === 3 && s1 && s2) ? 'now' : ''
  const stepsHtml = ['Supplier &amp; bill', 'Add items', 'Review &amp; post'].map((t, i) => { const c = step(i + 1); return `<li class="${c}"><span class="sn">${c === 'done' ? '✓' : i + 1}</span>${t}</li>` }).join('')
  if (steps.innerHTML !== stepsHtml) steps.innerHTML = stepsHtml
  // supplier card under the bill form
  const headerCtl = detail.querySelector<HTMLElement>(':scope > .entry-control:has(.simplified-form:not(.simplified-summary))')
  const header = ctx.model('dw_detail')!
  const supp = str(header.getItem(1, 'suppcode'))
  let card = headerCtl?.querySelector<HTMLElement>(':scope > .ds-supp') ?? null
  if (headerCtl && supp) {
    if (!card) {
      card = document.createElement('div')
      card.className = 'ds-supp'
      headerCtl.append(card)
      // Ledger of the approved design: the window's own Supplier Info. (F12)
      card.addEventListener('click', (event) => { if ((event.target as HTMLElement).closest('[data-ledger]')) (card as HTMLElement & { _ledger?: () => void })._ledger?.() })
    }
    ;(card as HTMLElement & { _ledger?: () => void })._ledger = menu('supplier') ?? undefined
    let info = supplierCache.get(supp)
    if (info === undefined) {
      supplierCache.set(supp, 'loading')
      void ctx.query(`SELECT coalesce(a.name::text, ''), coalesce(s.dayslimit::text, ''), (SELECT max(p.date)::date::text FROM dbo.purledger p WHERE p.suppcode = s.suppcode)
        FROM dbo.supplier s LEFT JOIN dbo.accounts a ON a.acccode = s.suppcode WHERE s.suppcode = $1`, [supp])
        .then((r) => {
          const last = str(r[0]?.[2])
          supplierCache.set(supp, { name: str(r[0]?.[0]), terms: numv(r[0]?.[1]) > 0 ? `${numv(r[0]?.[1])} days` : 'Cash', last: last ? new Date(last + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—' })
          onAsync()
        }).catch(() => supplierCache.delete(supp))
      info = 'loading'
    }
    const display = ctx.root.querySelector('.surface-field[data-field=suppcode] .surface-value')?.textContent?.trim()
    const name = (info !== 'loading' && info?.name) || display || supp
    const initials = name.split(/\s+/).filter((w) => /^[A-Za-z]/.test(w)).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || 'S'
    const ntn = str(header.getItem(1, 'ntn')) || '—'
    const balance = numv(header.getItem(1, 'suppbalance'))
    const html = `<span class="av">${esc(initials)}</span><div class="ds-supp-body"><b>${esc(name)}</b><div class="meta"><span>NTN <b class="num">${esc(ntn)}</b></span>
      <span>Balance payable <b class="num">Rs ${balance.toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</b></span>
      <span>Terms <b>${info === 'loading' ? '…' : esc(info?.terms ?? '—')}</b></span><span>Last purchase <b>${info === 'loading' ? '…' : esc(info?.last ?? '—')}</b></span></div></div>
      <button type="button" class="ds-btn ds-btn-ghost" data-ledger title="Supplier Info. (F12)" ${menu('supplier') ? '' : 'disabled'}><svg class="ds-i s" viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M8 13h8M8 17h5"/></svg>Ledger</button>`
    if (card.dataset.html !== html) { card.innerHTML = html; card.dataset.html = html }
  } else card?.remove()
  // quick-add bar of the approved design at the top of the lines card.  It sits outside the DataWindow (the grid's own markup is
  // never touched) and hands the keyboard to the item cell of the open line, adding a line with the original New Item command when
  // every line already has an item; the original item search then runs in that cell.
  const gridCtl = detail.querySelector<HTMLElement>(':scope > .entry-control:not(.entry-auxiliary):has(.simplified-grid)')
  const gridSurface = gridCtl?.querySelector<HTMLElement>(':scope > .modern-surface')
  if (gridCtl && gridSurface && !state.posted) {
    let quick = gridCtl.querySelector<HTMLElement>(':scope > .ds-quick-card')
    if (!quick) {
      quick = document.createElement('div')
      quick.className = 'ds-quick-card'
      quick.innerHTML = `<div class="ds-quick-h"><h2>Items</h2><span>Type a name, code or barcode</span></div><div class="ds-quick">
        <label class="ds-quick-f"><span>Item · name, code or barcode</span><span class="ds-quick-in"><svg class="ds-i s" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input type="text" placeholder="Start typing… e.g. pana" autocomplete="off" aria-describedby="ds-quick-help"></span></label>
        ${[['packqty', 'Packs'], ['bonusqty', 'Bonus'], ['purprice', 'P. Price']].map(([col, label]) => `<label class="ds-quick-f ds-quick-n"><span>${label}</span><input type="text" inputmode="decimal" data-cell="${col}" placeholder="—" autocomplete="off" aria-describedby="ds-quick-help"></label>`).join('')}
        <button type="button" class="ds-btn primary" data-quick-add><svg class="ds-i s" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M12 13v5M9.5 15.5h5"/></svg>Add line</button>
        <p class="ds-help" id="ds-quick-help">Each field types into the same column of the current line, so the window's own checks run. Item: use ↓ ↑ and Enter to pick from the list; batch and expiry are filled in the line.</p></div>`
      const openRow = () => [...gridSurface.querySelectorAll<HTMLElement>('tbody tr')].find((row) => !row.querySelector('[data-obj=itemname]')?.textContent?.trim())
      // opens the cell's own editor (as a click on it does) and moves the keyboard there once it exists; anything already typed in
      // the bar is carried over, and the next real keystroke runs the window's own search and checks
      const handOff = (cell: HTMLElement, from: HTMLInputElement | null) => {
        for (const type of ['mousedown', 'mouseup', 'click']) cell.dispatchEvent(new MouseEvent(type, { bubbles: true, view: window }))
        const td = cell.closest('td')
        let tries = 0
        const focus = () => {
          const editor = td?.querySelector<HTMLInputElement>('input,textarea')
          if (!editor) { if (++tries < 40) setTimeout(focus, 25); return }
          editor.focus()
          if (from?.value) { const text = from.value; from.value = ''; void typeInto(editor, text) }
          else editor.select?.()
        }
        focus()
      }
      const itemInput = () => quick!.querySelector<HTMLInputElement>('.ds-quick-in input')
      const toItemCell = (allowNew: boolean): void => {
        const cell = openRow()?.querySelector<HTMLElement>('[data-obj=itemname]')
        if (cell) { handOff(cell, itemInput()); return }
        if (allowNew && toolbar('update!') && !toolbar('update!')!.disabled) { toolbar('update!')!.click(); setTimeout(() => toItemCell(false), 350) }
      }
      const currentRow = () => gridSurface.querySelector<HTMLElement>('tbody tr.cur') ?? [...gridSurface.querySelectorAll<HTMLElement>('tbody tr')].at(-1)
      const toCell = (col: string) => {
        const cell = currentRow()?.querySelector<HTMLElement>(`[data-obj=${col}]`)
        if (cell) handOff(cell, null)
      }
      // a press on a bar field must not finish as a click outside the grid's new editor (that would close it): the press does not
      // take focus, the click hands over; keyboard focus (Tab) hands over right after it lands
      const wire = (field: HTMLInputElement, go: () => void) => {
        field.addEventListener('mousedown', (event) => event.preventDefault())
        field.addEventListener('click', go)
        field.addEventListener('focus', () => setTimeout(() => { if (document.activeElement === field) go() }, 0))
      }
      wire(quick.querySelector<HTMLInputElement>('.ds-quick-in input')!, () => toItemCell(true))
      for (const field of quick.querySelectorAll<HTMLInputElement>('[data-cell]')) wire(field, () => toCell(field.dataset.cell!))
      quick.querySelector('[data-quick-add]')!.addEventListener('mousedown', (event) => event.preventDefault())
      quick.querySelector('[data-quick-add]')!.addEventListener('click', () => toItemCell(true))
      gridCtl.prepend(quick)
    }
    quick.querySelector<HTMLButtonElement>('[data-quick-add]')!.disabled = !toolbar('update!') || toolbar('update!')!.disabled
    // the number fields show the current line's values
    const row = gridSurface.querySelector<HTMLElement>('tbody tr.cur') ?? [...gridSurface.querySelectorAll<HTMLElement>('tbody tr')].at(-1)
    for (const field of quick.querySelectorAll<HTMLInputElement>('[data-cell]')) {
      const value = row?.querySelector(`[data-obj=${field.dataset.cell}]`)?.textContent?.trim() ?? ''
      if (field.value !== value) field.value = value
    }
  } else gridCtl?.querySelector(':scope > .ds-quick-card')?.remove()
  // the original item search list floats just under the line being typed (like the mockup's suggestions under the input)
  const aux = detail.querySelector<HTMLElement>(':scope > .entry-auxiliary:not(.hidden)')
  if (aux && gridCtl) {
    const editor = gridCtl.querySelector<HTMLElement>('tr.cur') ?? gridCtl.querySelector<HTMLElement>('tbody tr')
    const top = editor ? Math.max(0, Math.round(editor.getBoundingClientRect().bottom - gridCtl.getBoundingClientRect().top + 4)) : 150
    if (aux.style.marginTop !== `${top}px`) aux.style.marginTop = `${top}px`
  }
  // ready-to-post panel under the bill summary
  const summaryCtl = detail.querySelector<HTMLElement>(':scope > .entry-control:has(.simplified-summary)')
  if (summaryCtl) {
    let panel = summaryCtl.querySelector<HTMLElement>(':scope > .ds-post')
    if (!panel) {
      panel = document.createElement('section')
      panel.className = 'ds-post'
      panel.setAttribute('aria-label', 'Before you can post')
      summaryCtl.append(panel)
      panel.addEventListener('click', (event) => {
        const run = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-menu]')
        if (run && !run.disabled) { (panel as HTMLElement & { _menu?: PurchaseMenu })._menu?.(run.dataset.menu as Parameters<PurchaseMenu>[0])?.(); return }
        const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-stock]')
        if (!button || button.disabled) return
        toolbar(button.dataset.stock!)?.click()
      })
    }
    ;(panel as HTMLElement & { _menu?: PurchaseMenu })._menu = menu
    const ICONS = { labels: '<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/>', history: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
      expenses: '<rect x="2" y="6" width="20" height="13" rx="2"/><path d="M2 10h20M16 15h2"/>' }
    const extra = (key: 'labels' | 'history' | 'expenses', label: string) => `<button type="button" class="ds-btn ds-btn-ghost" data-menu="${key}" ${menu(key) ? '' : 'disabled'}><svg class="ds-i s" viewBox="0 0 24 24" aria-hidden="true">${ICONS[key]}</svg>${label}</button>`
    const checks: [keyof PurchaseState, string][] = [['supp', 'Supplier chosen'], ['bill', 'Supplier bill # entered'], ['items', 'At least one item'], ['price', 'Every item has qty and price']]
    const done = checks.filter(([k]) => state[k]).length
    const ready = done === 4
    const tb = (stock: string) => toolbar(stock)
    const dis = (stock: string, extra = false) => !tb(stock) || tb(stock)!.disabled || extra ? 'disabled' : ''
    const html = `<div class="ring">${ringSvg(state.posted ? 1 : done / 4)}<div><b>${state.posted ? 'Posted to stock' : ready ? 'Ready to post' : 'Before you can post'}</b>
      <div class="help">${state.posted ? 'Stock and supplier balance were updated' : 'Complete each check below'}</div></div></div>
      <ul class="checks">${checks.map(([k, t]) => `<li class="${state[k] || state.posted ? 'y' : ''}"><span class="c">✓</span>${t}</li>`).join('')}</ul>
      <div class="acts"><button type="button" class="ds-btn primary block" data-stock="dbadmin!" ${dis('dbadmin!', !ready || state.posted)}>Save &amp; post to stock</button>
      <div class="row2"><button type="button" class="ds-btn" data-stock="save!" ${dis('save!')}>Save draft</button><button type="button" class="ds-btn" data-menu="slip" ${menu('slip') ? '' : 'disabled'}>Print slip</button></div>
      <div class="extra-acts">${extra('labels', 'Barcode labels')}${extra('history', 'Item history')}${extra('expenses', 'Pur. expenses')}</div></div>`
    if (panel.dataset.html !== html) { panel.innerHTML = html; panel.dataset.html = html }
  }
  // command-bar status and record position
  const bar = ctx.root.closest('.pbwin')?.ownerDocument.querySelector<HTMLElement>('.presentation-ui .mh-toolbar')
  if (bar) {
    let pill = bar.querySelector<HTMLElement>(':scope > .mh-state')
    if (!pill) { pill = document.createElement('span'); pill.className = 'mh-state'; bar.querySelector(':scope > .mh-title')?.after(pill) }
    const text = state.posted ? 'Posted' : state.dirty ? 'Draft · not saved' : 'Draft · saved'
    if (pill.textContent !== text) pill.textContent = text
    pill.classList.toggle('ok', state.posted)
    // Print of the approved design's command bar: the window's own Purchase Slip (Ctrl+M)
    let print = bar.querySelector<HTMLButtonElement>(':scope .ds-print-slip')
    if (!print) {
      print = document.createElement('button')
      print.type = 'button'
      print.className = 'tb ds-print-slip'
      print.setAttribute('aria-label', 'Print · Purchase Slip')
      print.title = 'Purchase Slip (Ctrl+M)'
      print.innerHTML = '<svg class="mh-i" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9V3h12v6M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="7"/></svg><span class="mh-label">Print</span>'
      print.addEventListener('click', () => (print as HTMLButtonElement & { _run?: () => void })._run?.())
      const list = bar.querySelector('button[data-stock="find!"]')
      if (list) list.after(print); else bar.querySelector('.mh-group-exit')?.before(print)
    }
    ;(print as HTMLButtonElement & { _run?: () => void })._run = menu('slip') ?? undefined
    print.disabled = !menu('slip')
    const browse = bar.querySelector<HTMLElement>('.mh-group-browse')
    if (browse) {
      let pos = browse.querySelector<HTMLElement>('.mh-pos')
      if (!pos) { pos = document.createElement('span'); pos.className = 'mh-pos'; pos.setAttribute('aria-live', 'polite'); browse.children[2] ? browse.insertBefore(pos, browse.children[2]) : browse.append(pos) }
      if (pos.textContent !== state.position) pos.textContent = state.position
      pos.hidden = !state.position
    }
  }
}

/** Forget cached database facts after a save or post (the next refresh reads them again). */
export function forgetPurchaseFacts(): void { postedCache.clear(); supplierCache.clear() }

export const PURCHASE_CSS = `
.modern-entry-window .entry-detail:has(.simplified-summary) > .ds-steps {grid-column:1 / -1;grid-row:1;}
.modern-entry-window .entry-detail:has(.ds-steps) > .entry-control:has(.simplified-summary) {grid-row:2 / span 3!important;}
.modern-entry-window .entry-detail:has(.ds-steps) > .entry-control:has(.simplified-form:not(.simplified-summary)) {grid-row:2;}
.modern-entry-window .entry-detail:has(.ds-steps) > .entry-control:has(.simplified-grid) {grid-row:3;}
@media (max-width:1000px){.modern-entry-window .entry-detail:has(.ds-steps) > .entry-control:has(.simplified-summary){grid-row:4!important}.modern-entry-window .entry-detail:has(.ds-steps) > .ds-post{grid-row:5}}
/* the bill form card holds the supplier card, as in the approved design */
.modern-entry-window .entry-detail > .entry-control:has(> .ds-supp) {background:var(--p-surface)!important;border:1px solid var(--p-hair)!important;border-radius:14px;box-shadow:var(--p-shadow)!important;}
.modern-entry-window .entry-detail > .entry-control:has(> .ds-supp) > .modern-surface {border:0!important;box-shadow:none!important;border-radius:14px 14px 0 0;}
.ds-steps {display:flex;list-style:none;padding:0;margin:0 0 -4px;flex-wrap:wrap;gap:4px;}
.ds-steps li {display:flex;align-items:center;gap:8px;color:var(--p-faint);font-size:13px;font-weight:500;padding-right:22px;}
.ds-steps li+li::before {content:"";width:26px;height:2px;background:var(--p-hair);margin-right:10px;border-radius:2px;transition:background .4s;}
.ds-steps li.done+li::before {background:var(--p-ok);}
.ds-steps .sn {width:26px;height:26px;border-radius:50%;display:grid;place-items:center;font-size:12px;border:2px solid var(--p-line);background:var(--p-surface);transition:all .35s var(--p-spring);}
.ds-steps li.done {color:var(--p-text);} .ds-steps li.done .sn {background:var(--p-ok);border-color:var(--p-ok);color:#fff;transform:scale(1.06);}
.ds-steps li.now {color:var(--p-accent);} .ds-steps li.now .sn {border-color:var(--p-accent);color:var(--p-accent);box-shadow:0 0 0 5px var(--p-glow);}
.modern-entry-window .entry-detail:has(.simplified-summary) > .entry-control:has(> .ds-quick-card):has(.simplified-grid),.modern-entry-window .entry-detail > .entry-control:has(> .ds-quick-card) {display:flex!important;flex-direction:column;height:calc(clamp(300px,52vh,620px) + 150px)!important;background:var(--p-surface)!important;border:1px solid var(--p-hair)!important;border-radius:14px;box-shadow:var(--p-shadow)!important;overflow:hidden;}
.modern-entry-window .entry-detail:has(.simplified-summary) > .entry-control:has(> .ds-quick-card):has(.simplified-grid) > .modern-surface,.modern-entry-window .entry-detail > .entry-control:has(> .ds-quick-card) > .modern-surface {position:relative!important;inset:auto!important;flex:1;min-height:0;height:auto!important;border:0!important;box-shadow:none!important;border-radius:0 0 14px 14px;}
.modern-entry-window .entry-detail > .entry-control:has(> .ds-quick-card) .simplified-grid > .simplified-head {display:none;}
.ds-quick-card {flex:none;}
.ds-quick-h {display:flex;align-items:baseline;gap:10px;padding:14px 18px;border-bottom:1px solid var(--p-hair);flex-wrap:wrap;}
.ds-quick-h h2 {margin:0;font-size:15px;font-weight:600;}
.ds-quick-h span {color:var(--p-muted);font-size:12.5px;}
.ds-quick {display:grid;grid-template-columns:minmax(0,2.4fr) repeat(3,minmax(0,.8fr)) auto;gap:6px 10px;align-items:end;padding:14px 18px;background:var(--p-sunk);border-bottom:1px solid var(--p-hair);}
.ds-quick-f {display:flex;flex-direction:column;gap:5px;font-size:12.5px;font-weight:500;color:var(--p-muted);}
.ds-quick-in {position:relative;display:block;}
.ds-quick-in .ds-i {position:absolute;left:11px;top:50%;transform:translateY(-50%);color:var(--p-faint);pointer-events:none;}
.ds-quick-in input {width:100%;height:40px;padding:0 12px 0 34px;border:1px solid var(--p-line);border-radius:8px;background:var(--p-surface);color:var(--p-text);font:14px var(--p-font);box-sizing:border-box;}
.ds-quick-n input {width:100%;height:40px;padding:0 10px;border:1px solid var(--p-line);border-radius:8px;background:var(--p-surface);color:var(--p-text);font:14px var(--p-mono);text-align:right;box-sizing:border-box;}
.ds-quick-n input:focus,.ds-quick-in input:focus {outline:0;border-color:var(--p-accent);box-shadow:0 0 0 4px var(--p-glow);}
.ds-quick .ds-btn {height:40px;display:inline-flex;align-items:center;gap:6px;}
.ds-quick .ds-help {grid-column:1 / -1;margin:0;}
@media (max-width:760px){.ds-quick{grid-template-columns:repeat(3,minmax(0,1fr))}.ds-quick .ds-quick-f:first-child{grid-column:1 / -1}.ds-quick .ds-btn{grid-column:1 / -1}}
/* the original item search list (the window's auxiliary DataWindow) floats over the lines like the mockup's suggestion list */
.modern-entry-window .entry-detail.ds-transaction > .entry-auxiliary:not(.hidden) {grid-column:1;grid-row:3;align-self:start;justify-self:start;width:min(680px,100%)!important;z-index:30;height:min(360px,60vh)!important;border:1px solid var(--p-hair);border-radius:12px;box-shadow:var(--p-shadow-lg);background:var(--p-surface);overflow:hidden;animation:ds-drop .16s var(--p-ease);transition:margin-top .12s;}
.modern-entry-window .entry-detail.ds-transaction > .entry-auxiliary:not(.hidden) > .modern-surface {width:100%!important;height:100%!important;border:0!important;box-shadow:none!important;border-radius:12px;}
.modern-entry-window .entry-detail.ds-transaction > .entry-auxiliary .simplified-head {display:none;}
.modern-entry-window .entry-detail.ds-transaction > .entry-auxiliary:not(.hidden) tr.cur {background:var(--p-selected)!important;}
/* the bill summary's computed figures read as plain right-aligned numbers (mockup); fields the user can type in stay boxes */
.modern-surface .simplified-summary .surface-value[aria-readonly=true]:not(.simplified-emphasis *) {background:transparent!important;border-color:transparent!important;box-shadow:none!important;text-align:right;font-family:var(--p-mono);padding-right:2px!important;}
.ds-supp {display:flex;gap:14px;align-items:center;padding:12px 14px;border-radius:12px;background:var(--p-selected);margin:0 18px 18px;flex-wrap:wrap;animation:ds-up .4s var(--p-ease);}
.ds-supp .av {width:38px;height:38px;border-radius:10px;background:linear-gradient(135deg,#0f6b6f,#1d5f80);color:#fff;display:grid;place-items:center;font-size:12px;font-weight:600;flex:none;}
.ds-supp-body {flex:1;min-width:0;}
.ds-supp .meta {display:flex;gap:20px;flex-wrap:wrap;font-size:12.5px;color:var(--p-muted);}
.ds-supp .meta b {color:var(--p-text);font-weight:600;}
.ds-supp .num {font-family:var(--p-mono);}
.ds-post {margin-top:12px;padding:18px;border:1px solid var(--p-hair);border-radius:14px;background:var(--p-surface);box-shadow:var(--p-shadow);}
.ds-post .ring {display:flex;align-items:center;gap:14px;margin-bottom:14px;}
.ds-post .ring svg {width:54px;height:54px;transform:rotate(-90deg);flex:none;}
.ds-post .ring circle {fill:none;stroke-width:6;}
.ds-post .ring .bgc {stroke:var(--p-sunk);} .ds-post .ring .fgc {stroke:var(--p-ok);stroke-linecap:round;transition:stroke-dashoffset .7s var(--p-ease);}
.ds-post .help {font-size:12px;color:var(--p-faint);}
.ds-post .checks {list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:7px;font-size:13px;}
.ds-post .checks li {display:flex;gap:9px;align-items:center;color:var(--p-muted);transition:color .3s;}
.ds-post .checks li.y {color:var(--p-text);}
.ds-post .checks .c {width:18px;height:18px;border-radius:50%;display:grid;place-items:center;font-size:10px;flex:none;color:transparent;border:2px solid var(--p-line);transition:all .35s var(--p-spring);}
.ds-post .checks li.y .c {background:var(--p-ok);border-color:var(--p-ok);color:#fff;transform:scale(1.1);}
.ds-post .acts {display:flex;flex-direction:column;gap:8px;margin-top:16px;}
.ds-post .row2 {display:flex;gap:8px;} .ds-post .row2 .ds-btn {flex:1;justify-content:center;}
.ds-post .ds-btn.block {width:100%;justify-content:center;}
.ds-post .ds-btn:disabled {opacity:.5;cursor:not-allowed;}
.ds-post .extra-acts {display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:4px;}
.ds-post .extra-acts .ds-btn {flex-direction:column;gap:4px;min-height:58px;padding:6px;font-size:12px;white-space:normal;text-align:center;justify-content:center;}
.ds-supp .ds-btn {flex:none;}
.ds-post .ds-btn.primary:disabled {background:var(--p-sunk);border-color:var(--p-line);color:var(--p-muted);box-shadow:none;opacity:1;}
`
