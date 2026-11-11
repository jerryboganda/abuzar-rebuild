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
export function decoratePurchase(ctx: PurchaseContext, state: PurchaseState, toolbar: (stock: string) => HTMLButtonElement | null, onAsync: () => void): void {
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
    if (!card) { card = document.createElement('div'); card.className = 'ds-supp'; headerCtl.append(card) }
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
      <span>Terms <b>${info === 'loading' ? '…' : esc(info?.terms ?? '—')}</b></span><span>Last purchase <b>${info === 'loading' ? '…' : esc(info?.last ?? '—')}</b></span></div></div>`
    if (card.dataset.html !== html) { card.innerHTML = html; card.dataset.html = html }
  } else card?.remove()
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
        const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-stock]')
        if (!button || button.disabled) return
        toolbar(button.dataset.stock!)?.click()
      })
    }
    const checks: [keyof PurchaseState, string][] = [['supp', 'Supplier chosen'], ['bill', 'Supplier bill # entered'], ['items', 'At least one item'], ['price', 'Every item has qty and price']]
    const done = checks.filter(([k]) => state[k]).length
    const ready = done === 4
    const tb = (stock: string) => toolbar(stock)
    const dis = (stock: string, extra = false) => !tb(stock) || tb(stock)!.disabled || extra ? 'disabled' : ''
    const html = `<div class="ring">${ringSvg(state.posted ? 1 : done / 4)}<div><b>${state.posted ? 'Posted to stock' : ready ? 'Ready to post' : 'Before you can post'}</b>
      <div class="help">${state.posted ? 'Stock and supplier balance were updated' : 'Complete each check below'}</div></div></div>
      <ul class="checks">${checks.map(([k, t]) => `<li class="${state[k] || state.posted ? 'y' : ''}"><span class="c">✓</span>${t}</li>`).join('')}</ul>
      <div class="acts"><button type="button" class="ds-btn primary block" data-stock="dbadmin!" ${dis('dbadmin!', !ready || state.posted)}>Save &amp; post to stock</button>
      <div class="row2"><button type="button" class="ds-btn" data-stock="save!" ${dis('save!')}>Save draft</button><button type="button" class="ds-btn" data-stock="print!" ${dis('print!')}>Print slip</button></div></div>`
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
.ds-post .ds-btn.primary:disabled {background:var(--p-sunk);border-color:var(--p-line);color:var(--p-muted);box-shadow:none;opacity:1;}
`
