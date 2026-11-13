import { toast } from './ds-fx.ts'
// Cash Sale companion of the approved design (point-of-sale layout): a scan bar and frequent-item tiles over the original sale lines,
// the customer and totals beside them, and a change calculator.  Items are always added through the window's own item column and
// item search (the same keystroke handling and checks); the change calculator only displays a sum and saves nothing.

type Query = (sql: string, params: unknown[]) => Promise<unknown[][]>
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!))
const money = (n: number) => n.toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const num = (text: string | null | undefined) => Number(String(text ?? '').replace(/[^0-9.-]/g, '')) || 0
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

interface Tile { name: string; stock: number; price: number }
let tiles: Tile[] | 'loading' | null = null
/** What the original needs before it takes a card (Cheque/Bank) receipt on a Credit Sale; null while it is read. */
let cardSetup: string[] | 'loading' | null = null

/** Types text into a cell editor one character at a time, as a person would: the window's own search narrows with each one. */
export async function typeInto(first: HTMLInputElement, text: string, done?: () => boolean): Promise<void> {
  // the window redraws its line after a keystroke and the cell gets a new editor: always type into the live one
  const field = first.closest('td')?.dataset.field
  const live = (): HTMLInputElement | null => {
    const active = document.activeElement
    if (active instanceof HTMLInputElement && active.closest('td')?.dataset.field === field) return active
    return first.isConnected ? first : null
  }
  for (let i = 1; i <= text.length; i++) {
    const editor = live()
    if (!editor) return
    editor.value = text.slice(0, i)
    editor.dispatchEvent(new InputEvent('input', { bubbles: true, data: text[i - 1], inputType: 'insertText' }))
    // a person's typing speed: each keystroke's own handling (search, checks) finishes before the next
    await wait(140)
    if (done?.()) return
  }
}

/** Opens the editor of a line's cell the way a click on it does and resolves with it once it exists. */
async function openCell(cell: HTMLElement): Promise<HTMLInputElement | null> {
  for (const type of ['mousedown', 'mouseup', 'click']) cell.dispatchEvent(new MouseEvent(type, { bubbles: true, view: window }))
  for (let i = 0; i < 40; i++) {
    const editor = cell.closest('td')?.querySelector<HTMLInputElement>('input,textarea')
    if (editor) { editor.focus(); return editor }
    await wait(25)
  }
  return null
}

/** The sale window's own File › Print (saves the sale when needed, then prints the invoice), and whether this deployment fiscalizes. */
export interface SaleExtras { print: { run(): void; shortcut?: string; disabled: boolean; label: string } | null; fiscal: boolean }

export function decorateSale(root: HTMLElement, query: Query, toolbar: (stock: string) => HTMLButtonElement | null, onAsync: () => void, openOther: (() => void) | null = null, credit = false,
  extras: SaleExtras = { print: null, fiscal: false }): void {
  const detail = root.querySelector<HTMLElement>('.entry-detail.ds-transaction[data-win=w_sale]')
  if (!detail) return
  const gridCtl = detail.querySelector<HTMLElement>(':scope > .entry-control:not(.entry-auxiliary):has(.simplified-grid)')
  const gridSurface = gridCtl?.querySelector<HTMLElement>(':scope > .modern-surface')
  const forms = [...detail.querySelectorAll<HTMLElement>(':scope > .entry-form')]
  const footer = forms.at(-1)
  if (!gridCtl || !gridSurface || !footer) return
  const rows = () => [...gridSurface.querySelectorAll<HTMLElement>('tbody tr')]
  const openRow = () => rows().find((row) => !row.querySelector('[data-obj=itemname]')?.textContent?.trim())
  /** the next open line's item cell (a new line from the original New Item command when every line has an item) */
  const itemCell = async (): Promise<HTMLElement | null> => {
    let row = openRow()
    if (!row && toolbar('update!') && !toolbar('update!')!.disabled) { toolbar('update!')!.click(); await wait(350); row = openRow() }
    return row?.querySelector<HTMLElement>('[data-obj=itemname]') ?? null
  }
  /** types an item name into the item column and lets the original search choose it (Enter), as a cashier would */
  const addByName = async (name: string) => {
    const cell = await itemCell()
    const editor = cell && await openCell(cell)
    if (!editor) return
    await wait(250)
    // Enter only once the original search list has landed on exactly this item; otherwise the name stays typed for the cashier
    const norm = (text: string) => text.replace(/\s+/g, ' ').trim().toUpperCase()
    const landed = () => norm(detail.querySelector<HTMLElement>(':scope > .entry-auxiliary:not(.hidden) tbody tr.cur [data-obj=itemname]')?.textContent ?? '') === norm(name)
    await typeInto(editor, name, landed)
    for (let i = 0; i < 30; i++) {
      await wait(100)
      const current = detail.querySelector<HTMLElement>(':scope > .entry-auxiliary:not(.hidden) tbody tr.cur [data-obj=itemname]')
      if (current && norm(current.textContent ?? '') === norm(name)) {
        const target = document.activeElement instanceof HTMLInputElement && document.activeElement.closest('td')?.dataset.field === 'itemname' ? document.activeElement : editor
        for (const type of ['keydown', 'keyup']) target.dispatchEvent(new KeyboardEvent(type, { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }))
        return
      }
    }
  }

  // scan bar at the top of the lines card
  let scan = gridCtl.querySelector<HTMLElement>(':scope > .ds-scan')
  if (!scan) {
    scan = document.createElement('div')
    scan.className = 'ds-scan'
    scan.innerHTML = `<label class="ds-scan-in"><span class="ds-sr">Scan a barcode or type an item name</span><svg class="ds-i s" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input type="text" placeholder="Scan a barcode or type an item name…" autocomplete="off"></label>`
    const input = scan.querySelector('input')!
    const go = async () => {
      const cell = await itemCell()
      const editor = cell && await openCell(cell)
      if (editor && input.value) await typeInto(editor, input.value)
      input.value = ''
    }
    input.addEventListener('mousedown', (event) => event.preventDefault())
    input.addEventListener('click', () => void go())
    input.addEventListener('focus', () => setTimeout(() => { if (document.activeElement === input) void go() }, 0))
    gridCtl.prepend(scan)
  }

  // frequent items (most sold in the last 30 days up to the latest business day)
  let tileBox = gridCtl.querySelector<HTMLElement>(':scope > .ds-tiles')
  if (!tileBox) {
    tileBox = document.createElement('section')
    tileBox.className = 'ds-tiles'
    tileBox.setAttribute('aria-label', 'Frequent items')
    gridCtl.append(tileBox)
    tileBox.addEventListener('click', (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-tile]')
      if (button && !button.disabled) void addByName(button.dataset.tile!)
    })
  }
  if (tiles === null) {
    tiles = 'loading'
    void query(`SELECT i.name::text, coalesce(s.qty, 0), coalesce(i.saleprice, 0), count(*) n FROM dbo.saledetail d
        JOIN dbo.saleledger l ON l.saleinvcode = d.saleinvcode JOIN dbo.item i ON i.icode = d.icode
        LEFT JOIN (SELECT icode, sum(qty) qty FROM dbo.view_waseelamini_stock GROUP BY icode) s ON s.icode = d.icode
        WHERE l.date >= (SELECT max(date) FROM dbo.saleledger) - interval '30 days' AND i.active = 1
        GROUP BY 1, 2, 3 ORDER BY n DESC LIMIT 10`, [])
      .then((r) => { tiles = r.map((row) => ({ name: String(row[0] ?? ''), stock: Number(row[1] ?? 0), price: Number(row[2] ?? 0) })); onAsync() })
      .catch(() => { tiles = [] })
  }
  if (Array.isArray(tiles)) {
    const html = `<div class="ds-tiles-h"><h2>Frequent items</h2><span>tap to add</span></div><div class="ds-tiles-g">${tiles.map((t) =>
      `<button type="button" class="ds-tile" data-tile="${esc(t.name)}"><b>${esc(t.name)}</b><small class="${t.stock > 0 ? '' : 'out'}">${t.stock > 0 ? `${t.stock.toLocaleString('en-PK')} in stock` : 'Out of stock'}</small><span class="p">Rs ${money(t.price)}</span></button>`).join('') || '<p class="ds-help">No sales in the last 30 days.</p>'}</div>`
    if (tileBox.dataset.html !== html) { tileBox.innerHTML = html; tileBox.dataset.html = html }
  }

  // the original item search list floats just under the line being typed
  const aux = detail.querySelector<HTMLElement>(':scope > .entry-auxiliary:not(.hidden)')
  if (aux) {
    const line = gridCtl.querySelector<HTMLElement>('tr.cur') ?? gridCtl.querySelector<HTMLElement>('tbody tr')
    const top = line ? Math.max(0, Math.round(line.getBoundingClientRect().bottom - gridCtl.getBoundingClientRect().top + 4)) : 150
    if (aux.style.marginTop !== `${top}px`) aux.style.marginTop = `${top}px`
  }
  // change calculator under the totals (display only)
  let pay = footer.querySelector<HTMLElement>(':scope > .ds-change')
  if (!pay) {
    pay = document.createElement('section')
    pay.className = 'ds-change'
    pay.innerHTML = `<div class="row"><span>Pay by</span><span class="ds-seg" role="group" aria-label="Payment method"><button type="button" data-mode="cash">Cash</button><button type="button" data-card aria-pressed="false">Card</button><button type="button" data-mode="credit">Credit</button></span></div>
      <div class="ds-cash-only"><div class="row"><label for="ds-cash">Cash received</label><input id="ds-cash" type="text" inputmode="decimal" placeholder="0" autocomplete="off"></div>
      <div class="quick">${[500, 1000, 5000].map((n) => `<button type="button" data-add="${n}">+${n}</button>`).join('')}</div>
      <div class="row ch"><span>Change to return</span><b class="num" aria-live="polite">0.00</b></div>
      <p class="ds-help">Counts the change only; nothing here is saved with the sale.</p></div>`
    const cash = pay.querySelector<HTMLInputElement>('#ds-cash')!
    pay.addEventListener('click', (event) => {
      const card = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-card]')
      if (card) { if (!card.disabled && card.getAttribute('aria-pressed') !== 'true') pay!.dispatchEvent(new CustomEvent('ds-card')); return }
      const mode = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-mode]')
      if (mode) { if (mode.getAttribute('aria-pressed') !== 'true') pay!.dispatchEvent(new CustomEvent('ds-credit')); return }
      const add = (event.target as HTMLElement).closest<HTMLElement>('[data-add]')
      if (add) { cash.value = String(num(cash.value) + Number(add.dataset.add)); onAsync() }
    })
    cash.addEventListener('input', () => onAsync())
    footer.append(pay)
  }
  // the switch shows which window this is (Cash Sale or Credit Sale); the other choice opens that window from the Sales menu
  for (const button of pay.querySelectorAll<HTMLButtonElement>('[data-mode]')) {
    const current = (button.dataset.mode === 'credit') === credit
    button.setAttribute('aria-pressed', String(current))
    button.disabled = !current && !openOther
    button.title = current ? '' : `Opens Sales › ${button.dataset.mode === 'credit' ? 'Credit Sale' : 'Cash Sale'}`
  }
  // Card: the original's own Cheque/Bank receipt.  A card sale is a Credit Sale whose amount is received in the payment window the
  // original opens on save (AskAmtOnCreditSale, right 582), starting in the mode and account of SalePaymentMode / SalePaymentAccCode.
  if (cardSetup === null) {
    cardSetup = 'loading'
    void query(`SELECT (SELECT count(*) FROM dbo.accounts WHERE upper(active::text) = 'Y' AND subcode = (SELECT code FROM dbo.global WHERE name = 'GT_BankSub')),
        (SELECT max(prefvalue::text) FROM dbo.softwarepreferences WHERE lower(name) = 'askamtoncreditsale'),
        (SELECT max(prefvalue::text) FROM dbo.softwarepreferences WHERE lower(name) = 'salepaymentmode'),
        (SELECT max(prefvalue::text) FROM dbo.softwarepreferences WHERE lower(name) = 'salepaymentacccode'),
        (SELECT count(*) FROM dbo.rights WHERE rightcode = 582)`, [])
      .then((r) => {
        const [banks, ask, mode, account, right] = r[0] ?? []
        const missing: string[] = []
        if (!Number(banks)) missing.push('a card (bank) account in Basic Data › Account, under the bank group')
        if (String(ask ?? '').trim().toUpperCase() !== 'Y') missing.push('Preferences: AskAmtOnCreditSale = Y')
        if (String(mode ?? '').trim().toUpperCase() !== 'B') missing.push('Preferences: SalePaymentMode = Cheque/Bank (B)')
        if (!Number(account)) missing.push('Preferences: SalePaymentAccCode = the card account')
        if (!Number(right)) missing.push('right 582 (amount on credit sale) in the rights list, granted to the cashier group')
        cardSetup = missing
        onAsync()
      }).catch(() => { cardSetup = ['the payment settings could not be read'] ; onAsync() })
  }
  const cardButton = pay.querySelector<HTMLButtonElement>('[data-card]')!
  const paidByBank = credit && /^b/i.test(detail.querySelector('.surface-field[data-field=paymentmode] .surface-value')?.textContent?.trim() ?? '')
  const ready = Array.isArray(cardSetup) && !cardSetup.length
  cardButton.setAttribute('aria-pressed', String(paidByBank))
  cardButton.disabled = !ready || (!credit && !openOther)
  cardButton.title = !Array.isArray(cardSetup) ? 'Checking the card payment settings…'
    : cardSetup.length ? `Card payment needs: ${cardSetup.join('; ')}.`
      : credit ? 'Card: on save, enter the amount received in the payment window (Cheque/Bank, card account)' : 'Opens Sales › Credit Sale; the card amount is entered in the payment window on save'
  if (paidByBank) for (const button of pay.querySelectorAll<HTMLButtonElement>('[data-mode=credit]')) button.setAttribute('aria-pressed', 'false')
  pay.querySelector<HTMLElement>('.ds-cash-only')!.hidden = credit
  // FBR note and the big Pay & print button of the approved design, under the payment card
  let after = footer.querySelector<HTMLElement>(':scope > .ds-pay-after')
  if (!after) {
    after = document.createElement('div')
    after.className = 'ds-pay-after'
    after.innerHTML = `<p class="ds-fbr" hidden><svg class="ds-i s" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/></svg><span>Each posted sale gets an FBR fiscal invoice number and QR code on the slip.</span></p>
      <button type="button" class="ds-btn primary ds-pay-btn"><svg class="ds-i s" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg><span></span></button>`
    after.querySelector('button')!.addEventListener('click', () => (after as HTMLElement & { _print?: () => void })._print?.())
    footer.append(after)
  }
  after.querySelector<HTMLElement>('.ds-fbr')!.hidden = !extras.fiscal
  const payButton = after.querySelector<HTMLButtonElement>('.ds-pay-btn')!
  const payText = `${extras.print?.label ?? 'Pay & print'}${extras.print?.shortcut ? ` · ${extras.print.shortcut}` : ''}`
  if (payButton.lastElementChild!.textContent !== payText) payButton.lastElementChild!.textContent = payText
  payButton.disabled = !extras.print || extras.print.disabled
  payButton.title = extras.print?.label === 'Save & post' ? 'File › Save And Post' : 'File › Print: saves the sale if needed, then prints the invoice'
  ;(after as HTMLElement & { _print?: () => void })._print = extras.print?.run
  ;(pay as HTMLElement & { _credit?: () => void })._credit = openOther ?? undefined
  if (!pay.dataset.creditWired) {
    pay.dataset.creditWired = '1'
    pay.addEventListener('ds-credit', () => (pay as HTMLElement & { _credit?: () => void })._credit?.())
    // in Cash Sale, Card opens Credit Sale (where the original takes the card receipt); in Credit Sale it explains the next step
    pay.addEventListener('ds-card', () => {
      const p = pay as HTMLElement & { _credit?: () => void; _isCredit?: boolean }
      if (p._isCredit) toast('Card: save the sale, then enter the amount received in the payment window (Cheque/Bank, card account)', 'ok')
      else p._credit?.()
    })
  }
  ;(pay as HTMLElement & { _isCredit?: boolean })._isCredit = credit
  // the amount the customer pays: the window's own grand total (rounded, with its charges)
  const net = num(footer.querySelector('[data-obj=c_big_grandtotal]')?.textContent ?? footer.querySelector('[data-obj=total]')?.textContent)
  const cashInput = pay.querySelector<HTMLInputElement>('#ds-cash')!
  if (net === 0 && document.activeElement !== cashInput && cashInput.value) cashInput.value = ''
  const received = num(cashInput.value)
  const change = pay.querySelector<HTMLElement>('.ch b')!
  const text = received ? money(received - net) : '0.00'
  if (change.textContent !== text) change.textContent = text
  change.classList.toggle('neg', received > 0 && received < net)
}

export const SALE_CSS = `
/* ---------- Cash Sale (mockup point-of-sale layout) ---------- */
.modern-entry-window .entry-detail.ds-transaction[data-win=w_sale] {display:grid!important;grid-template-columns:minmax(0,1fr) minmax(300px,360px);gap:16px;align-items:start;}
.modern-entry-window .entry-detail.ds-transaction[data-win=w_sale] > .entry-form:first-of-type {grid-column:2;grid-row:1;}
.modern-entry-window .entry-detail.ds-transaction[data-win=w_sale] > .entry-control:not(.entry-auxiliary):has(.simplified-grid) {grid-column:1;grid-row:1 / span 2;}
.modern-entry-window .entry-detail.ds-transaction[data-win=w_sale] > .entry-form ~ .entry-form {grid-column:2;grid-row:2;}
.modern-entry-window .entry-detail.ds-transaction[data-win=w_sale] > .entry-auxiliary:not(.hidden) {grid-column:1;grid-row:1;}
.modern-entry-window .entry-detail.ds-transaction[data-win=w_sale] > .entry-form:first-of-type .simplified-row {grid-template-columns:repeat(2,minmax(0,1fr))!important;}
.modern-entry-window .entry-detail.ds-transaction[data-win=w_sale] > .entry-control:has(> .ds-scan) {display:flex!important;flex-direction:column;height:auto!important;background:var(--p-surface)!important;border:1px solid var(--p-hair)!important;border-radius:14px;box-shadow:var(--p-shadow)!important;overflow:hidden;}
.modern-entry-window .entry-detail.ds-transaction[data-win=w_sale] > .entry-control:has(> .ds-scan) > .modern-surface {position:relative!important;inset:auto!important;flex:none;height:clamp(300px,52vh,620px)!important;border:0!important;box-shadow:none!important;border-radius:0;}
.ds-scan {flex:none;padding:14px 18px;background:linear-gradient(180deg,var(--p-selected),transparent);border-bottom:1px solid var(--p-hair);}
.ds-scan-in {position:relative;display:block;}
.ds-scan-in .ds-i {position:absolute;left:14px;top:50%;transform:translateY(-50%);color:var(--p-faint);pointer-events:none;}
.ds-scan-in input {width:100%;height:46px;padding:0 52px 0 40px;border:1px solid var(--p-line);border-radius:10px;background:var(--p-surface);color:var(--p-text);font:15px var(--p-font);box-sizing:border-box;}
.ds-scan-in input:focus {outline:0;border-color:var(--p-accent);box-shadow:0 0 0 4px var(--p-glow);}
.ds-scan-in kbd {position:absolute;right:12px;top:50%;transform:translateY(-50%);font:11px var(--p-mono);padding:2px 6px;border:1px solid var(--p-line);border-radius:5px;color:var(--p-muted);background:var(--p-sunk);}
.ds-tiles {flex:none;background:var(--p-surface);border-top:1px solid var(--p-hair);}
.ds-tiles-h {display:flex;align-items:baseline;gap:10px;padding:14px 18px;border-bottom:1px solid var(--p-hair);}
.ds-tiles-h h2 {margin:0;font-size:15px;font-weight:600;}
.ds-tiles-h span {color:var(--p-muted);font-size:12.5px;}
.ds-tiles-g {display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px;padding:14px 18px;}
.ds-tile {display:flex;flex-direction:column;align-items:flex-start;gap:3px;padding:10px 12px;border:1px solid var(--p-hair);border-radius:12px;background:var(--p-surface);color:var(--p-text);cursor:pointer;text-align:left;font:13px var(--p-font);transition:transform .2s cubic-bezier(.34,1.56,.64,1),border-color .2s,box-shadow .2s;}
.ds-tile:hover {transform:translateY(-2px);border-color:var(--p-accent);box-shadow:0 8px 20px var(--p-glow);}
.ds-tile b {font-weight:500;}
.ds-tile small {color:var(--p-muted);font-size:11.5px;}
.ds-tile small.out {color:var(--p-danger);}
.ds-tile .p {font:600 13.5px var(--p-mono);color:var(--p-accent);margin-top:4px;}
.ds-change {margin:0 18px 18px;padding-top:12px;border-top:1px solid var(--p-hair);display:grid;gap:10px;}
.ds-change .row {display:flex;align-items:center;justify-content:space-between;gap:10px;font-size:13.5px;color:var(--p-muted);}
.ds-change input {width:120px;height:38px;padding:0 10px;border:1px solid var(--p-line);border-radius:8px;background:var(--p-surface);color:var(--p-text);font:14px var(--p-mono);text-align:right;}
.ds-change input:focus {outline:0;border-color:var(--p-accent);box-shadow:0 0 0 4px var(--p-glow);}
.ds-change .quick {display:grid;grid-template-columns:repeat(3,1fr);gap:8px;}
.ds-change .quick button {height:38px;border:1px solid var(--p-line);border-radius:8px;background:var(--p-surface);color:var(--p-text);font:600 13px var(--p-mono);cursor:pointer;}
.ds-change .quick button:hover {border-color:var(--p-accent);background:var(--p-selected);}
.ds-change .ch b {font:600 16px var(--p-mono);color:var(--p-text);}
.ds-change .ch b.neg {color:var(--p-danger);}
.ds-change .ds-help {margin:0;}
.ds-change .ds-seg {display:inline-flex;padding:3px;border-radius:10px;background:var(--p-sunk);gap:2px;}
.ds-change .ds-seg button {border:0;background:none;padding:5px 14px;border-radius:7px;cursor:pointer;color:var(--p-muted);font:500 13px var(--p-font);}
.ds-change .ds-seg button[aria-pressed=true] {background:var(--p-surface);color:var(--p-text);box-shadow:0 1px 3px rgb(0 0 0 / .12);}
.ds-change .ds-seg button:disabled {opacity:.5;cursor:not-allowed;}
.ds-pay-after {margin:0 18px 18px;display:grid;gap:12px;}
/* the payment card's grouped totals (Sales, S/R, Net) and the "Item figures" disclosure read as summary rows too */
.modern-surface .simplified-summary .simplified-row :is(.surface-group, .simplified-more-fields) > .surface-field:not([hidden]) {display:grid!important;align-self:stretch!important;grid-template-columns:max-content auto minmax(0,1fr)!important;grid-area:auto!important;position:static!important;align-items:center;gap:12px;padding:3px 0;width:auto!important;height:auto!important;}
.modern-surface .simplified-summary .simplified-row :is(.surface-group, .simplified-more-fields) > .surface-field > .surface-label {grid-column:1;}
.modern-surface .simplified-summary .simplified-row :is(.surface-group, .simplified-more-fields) > .surface-field > .surface-required {grid-column:2;}
.modern-surface .simplified-summary .simplified-row :is(.surface-group, .simplified-more-fields) > .surface-field > :not(.surface-label):not(.surface-required) {grid-column:3!important;justify-self:end;width:9.5em!important;max-width:100%;position:static!important;}
.modern-surface .simplified-summary .simplified-row > .surface-group {order:0;}
.modern-surface .simplified-summary .simplified-more {order:250;margin:8px 0 0;padding-top:8px;border-top:1px dashed var(--p-hair);}
.modern-surface .simplified-summary .simplified-more > summary {cursor:pointer;color:var(--p-accent);font-size:13px;font-weight:600;}
.modern-surface .simplified-summary .simplified-more-fields {display:flex;flex-direction:column;gap:2px;margin-top:6px;}
/* the current item's figures have no caption of their own in the original (they sit beside "%" and "Stock:"): readable captions are
   drawn for them here; the accessible name stays the original's */
.modern-surface[aria-label=Salefooter2] .simplified-more-fields > .surface-field > .surface-label {position:static!important;width:auto!important;height:auto!important;clip:auto!important;clip-path:none!important;overflow:visible!important;margin:0!important;white-space:nowrap;font-size:0!important;color:var(--p-muted);}
.modern-surface[aria-label=Salefooter2] .simplified-more-fields > .surface-field > .surface-label::before {font-size:13px;}
.modern-surface[aria-label=Salefooter2] [data-field=rppmargin] > .surface-label::before {content:"RPP margin %";}
.modern-surface[aria-label=Salefooter2] [data-field=purprice] > .surface-label::before {content:"Purchase price";}
.modern-surface[aria-label=Salefooter2] [data-field=rpp] > .surface-label::before {content:"RPP";}
.modern-surface[aria-label=Salefooter2] [data-field=avgprice] > .surface-label::before {content:"Avg. price";}
.modern-surface[aria-label=Salefooter2] [data-field=retailprice] > .surface-label::before {content:"Retail price";}
.modern-surface[aria-label=Salefooter2] [data-field=itemtotalval] > .surface-label::before {content:"Item value";}
.modern-surface[aria-label=Salefooter2] [data-field=stock] > .surface-label::before {content:"Stock";}
.modern-surface[aria-label=Salefooter2] [data-field=totalstock] > .surface-label::before {content:"T/Stock";}
.modern-surface[aria-label=Salefooter2] .surface-field[data-field=invdiscperc] {grid-template-columns:max-content auto minmax(0,1fr)!important;}
.ds-fbr {display:flex;align-items:center;gap:10px;margin:0;padding:10px 12px;border-radius:10px;background:var(--p-info-soft);color:var(--p-info);font-size:12.5px;}
.ds-fbr[hidden] {display:none;}
.ds-pay-btn {width:100%;min-height:52px!important;font-size:16px!important;justify-content:center;background:linear-gradient(180deg,var(--p-accent-2),var(--p-accent))!important;border-color:var(--p-accent)!important;color:var(--p-on-accent)!important;box-shadow:0 6px 18px var(--p-glow);}
.ds-pay-btn:disabled {background:var(--p-sunk)!important;border-color:var(--p-line)!important;color:var(--p-muted)!important;box-shadow:none;cursor:not-allowed;}
@media (max-width:1000px){.modern-entry-window .entry-detail.ds-transaction[data-win=w_sale]{grid-template-columns:minmax(0,1fr)}.modern-entry-window .entry-detail.ds-transaction[data-win=w_sale] > *{grid-column:1!important;grid-row:auto!important}.modern-entry-window .entry-detail.ds-transaction[data-win=w_sale] > .entry-auxiliary:not(.hidden){grid-row:2!important}}
`
