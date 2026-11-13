/**
 * Approved whole-app design (2026-11-12): the Reports catalogue and the Items list pages beside Home, and the item side panel.
 * Reports are the live Reports menu (each card runs the original menu item and opens its original criteria window, so rights and
 * report logic are unchanged). Items are read from the item and stock tables; editing goes through the original Item form.
 */
import { HOME_ICONS } from './ds-home.ts'

type Query = (sql: string, params?: unknown[]) => Promise<unknown[][]>
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!))
const icon = (k: string, cls = '') => `<svg class="ds-i ${cls}" viewBox="0 0 24 24" aria-hidden="true">${PAGE_ICONS[k] ?? HOME_ICONS[k] ?? ''}</svg>`
const money = (n: number) => n.toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export const PAGE_ICONS: Record<string, string> = {
  star: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.2l1.1-6.2L3 9.6l6.2-.9z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  right: '<path d="m9 6 6 6-6 6"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
}

/* ---------- Reports catalogue ---------- */

export interface ReportEntry { group: string; label: string; disabled: boolean; run: () => void }

const STAR_KEY = 'trader.ds.starredReports'
const readStars = (): Set<string> => { try { return new Set(JSON.parse(localStorage.getItem(STAR_KEY) || '[]') as string[]) } catch { return new Set() } }
const writeStars = (s: Set<string>) => { try { localStorage.setItem(STAR_KEY, JSON.stringify([...s])) } catch { /* private window: stars last for this page only */ } }

export function renderReports(host: HTMLElement, entries: ReportEntry[], state: { group?: string }): void {
  const stars = readStars()
  const groups = [...new Set(entries.map((e) => e.group))]
  if (!state.group || (state.group !== 'Starred' && !groups.includes(state.group))) state.group = groups[0] ?? 'Starred'
  const key = (e: ReportEntry) => `${e.group} / ${e.label}`
  const shown = state.group === 'Starred' ? entries.filter((e) => stars.has(key(e))) : entries.filter((e) => e.group === state.group)
  host.innerHTML = `<div class="ds-home ds-page"><div class="ds-rep-grid">
    <nav class="ds-card ds-cats" aria-label="Report groups">${groups.map((g) => `<button type="button" data-rc="${esc(g)}" aria-current="${g === state.group}">${esc(g)}<span class="n">${entries.filter((e) => e.group === g).length}</span></button>`).join('')}
      <button type="button" data-rc="Starred" aria-current="${state.group === 'Starred'}"><span class="ds-cat-star">${icon('star', 's')}Starred</span><span class="n">${entries.filter((e) => stars.has(key(e))).length}</span></button></nav>
    <div><div class="ds-hello ds-page-hello"><div><h2>${state.group === 'Starred' ? 'Starred reports' : esc(state.group)}</h2><p>Pick a report, set its dates and filters, then Run. Every report prints or saves to Excel.</p></div></div>
    <div class="ds-rcards ds-stagger">${shown.map((e, i) => `<div class="ds-rcard${e.disabled ? ' off' : ''}" role="button" tabindex="${e.disabled ? -1 : 0}" aria-disabled="${e.disabled}" data-rep="${i}" style="--i:${i}">
      <div class="ds-rcard-top"><span class="ds-qi">${icon('chart', 's')}</span><button class="ds-star${stars.has(key(e)) ? ' on' : ''}" type="button" data-star="${i}" aria-pressed="${stars.has(key(e))}" aria-label="${stars.has(key(e)) ? 'Unstar' : 'Star'} ${esc(e.label)}">${icon('star', 's')}</button></div>
      <b>${esc(e.label)}</b><small>${esc(e.group)}${e.disabled ? ' · not available to this user' : ''}</small></div>`).join('') || `<div class="ds-empty">${state.group === 'Starred' ? 'Star a report to keep it here.' : 'No reports in this group.'}</div>`}</div></div></div></div>`
  host.onclick = (event) => {
    const target = event.target as HTMLElement
    const cat = target.closest<HTMLElement>('[data-rc]')
    if (cat) { state.group = cat.dataset.rc; renderReports(host, entries, state); return }
    const star = target.closest<HTMLElement>('[data-star]')
    if (star) { const e = shown[Number(star.dataset.star)]; if (stars.has(key(e))) stars.delete(key(e)); else stars.add(key(e)); writeStars(stars); renderReports(host, entries, state); return }
    const card = target.closest<HTMLElement>('[data-rep]')
    if (card) { const e = shown[Number(card.dataset.rep)]; if (!e.disabled) e.run() }
  }
  host.onkeydown = (event) => {
    const card = (event.target as HTMLElement).closest<HTMLElement>('.ds-rcard')
    if (card && (event.key === 'Enter' || event.key === ' ') && event.target === card) { event.preventDefault(); card.click() }
  }
}

/* ---------- Items list ---------- */

export interface ItemRow { icode: number; code: string; name: string; pack: string; mfr: string; cat: string; stock: number; reorder: number; pur: number; sale: number; exp: Date | null }
export interface ItemsState { q: string; filter: 'all' | 'low' | 'out' | 'exp'; rows: ItemRow[]; counts: Record<string, number>; anchor: Date | null; seq: number }

const STOCK = `select icode, sum(qty) qty, min(expiry) filter (where qty > 0) exp from dbo.view_waseelamini_stock group by icode`
const ANCHOR = `(select coalesce(max(date)::date, current_date) from dbo.saleledger)`
const FILTER: Record<ItemsState['filter'], string> = {
  all: 'true',
  low: 'coalesce(s.qty,0) > 0 and coalesce(s.qty,0) <= i.reorderlevel',
  out: 'coalesce(s.qty,0) <= 0',
  exp: `coalesce(s.qty,0) > 0 and s.exp < ${ANCHOR} + 120`,
}

export async function loadItems(query: Query, state: ItemsState): Promise<void> {
  const seq = ++state.seq
  const q = state.q.trim()
  const [counts, rows] = await Promise.all([
    query(`with s as (${STOCK}) select count(*), count(*) filter (where ${FILTER.low}), count(*) filter (where ${FILTER.out}), count(*) filter (where ${FILTER.exp}), ${ANCHOR}
      from dbo.item i left join s on s.icode = i.icode where i.active = 1`),
    query(itemsSql(state, 200), [q]),
  ])
  if (seq !== state.seq) return
  const c = counts[0] ?? []
  state.counts = { all: Number(c[0] ?? 0), low: Number(c[1] ?? 0), out: Number(c[2] ?? 0), exp: Number(c[3] ?? 0) }
  state.anchor = c[4] ? new Date(String(c[4])) : null
  state.rows = rows.map(itemRow)
}

function itemsSql(state: ItemsState, limit: number | null): string {
  return `with s as (${STOCK}) select i.icode, coalesce(i.customicode::text, i.icode::text), i.name::text, coalesce(p.name::text, ''), coalesce(m.name::text, ''), coalesce(c.name::text, ''),
        coalesce(s.qty, 0), coalesce(i.reorderlevel, 0), coalesce(i.purprice, 0), coalesce(i.saleprice, 0), s.exp
      from dbo.item i left join s on s.icode = i.icode left join dbo.manufacturer m on m.manfcode = i.manfcode
      left join dbo.itemcategory c on c.icatcode = i.icatcode left join dbo.itempacking p on p.packcode = i.packcode
      where i.active = 1 and ${FILTER[state.filter]} and ($1 = '' or i.name::text ilike '%' || $1 || '%' or coalesce(i.customicode::text, '') ilike $1 || '%' or m.name::text ilike '%' || $1 || '%')
      order by i.name::text${limit ? ` limit ${limit}` : ''}`
}

const itemRow = (r: unknown[]): ItemRow => ({ icode: Number(r[0]), code: String(r[1] ?? ''), name: String(r[2] ?? ''), pack: String(r[3] ?? ''), mfr: String(r[4] ?? ''), cat: String(r[5] ?? ''),
  stock: Number(r[6] ?? 0), reorder: Number(r[7] ?? 0), pur: Number(r[8] ?? 0), sale: Number(r[9] ?? 0), exp: r[10] ? new Date(String(r[10])) : null })

/** One item by its code (the search palette opens it), whatever the list's search and filter are. */
export async function loadItem(query: Query, icode: number): Promise<ItemRow | null> {
  const rows = await query(itemsSql({ q: '', filter: 'all', rows: [], counts: {}, anchor: null, seq: 0 }, null).replace(" and ($1 = ''", " and i.icode = $2 and ($1 = ''"), ['', icode])
  return rows[0] ? itemRow(rows[0]) : null
}

const ITEM_COLUMNS = ['Code', 'Item', 'Packing', 'Manufacturer', 'Category', 'Stock', 'Reorder level', 'Pur. price', 'Sale price', 'Nearest expiry']
const itemCells = (it: ItemRow) => [it.code, it.name, it.pack, it.mfr, it.cat, String(it.stock), String(it.reorder), it.pur.toFixed(2), it.sale.toFixed(2),
  it.exp ? `${String(it.exp.getMonth() + 1).padStart(2, '0')}/${it.exp.getFullYear()}` : '']

/** Every item of the current search and filter (not only the rows on screen). */
async function allItems(query: Query, state: ItemsState): Promise<ItemRow[]> {
  return (await query(itemsSql(state, null), [state.q.trim()])).map(itemRow)
}

/** Export of the approved design ("Export to Excel"): the current list as a CSV file Excel opens. */
export async function exportItems(query: Query, state: ItemsState): Promise<number> {
  const rows = await allItems(query, state)
  const cell = (v: string) => /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
  const csv = '﻿' + [ITEM_COLUMNS, ...rows.map(itemCells)].map((r) => r.map(cell).join(',')).join('\n')
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = `items-${new Date().toISOString().slice(0, 10)}.csv`
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  return rows.length
}

/** Print of the approved design ("Print list"): the current list as a plain table on paper. */
export async function printItems(query: Query, state: ItemsState, company: string): Promise<number> {
  const rows = await allItems(query, state)
  const frame = document.createElement('iframe')
  frame.style.cssText = 'position:fixed;width:0;height:0;border:0;right:0;bottom:0'
  document.body.append(frame)
  const doc = frame.contentDocument!
  doc.open()
  doc.write(`<!doctype html><html><head><meta charset="utf-8"><title>Items</title><style>body{font:11px Arial,sans-serif;margin:12mm}h1{font-size:15px;margin:0 0 2px}p{margin:0 0 8px;color:#555}
    table{width:100%;border-collapse:collapse}th,td{border-bottom:1px solid #ccc;padding:3px 5px;text-align:left}th{background:#eee}td.r,th.r{text-align:right}</style></head><body>
    <h1>${esc(company)} · Items</h1><p>${rows.length.toLocaleString('en-PK')} items · printed ${esc(new Date().toLocaleString('en-GB'))}</p>
    <table><thead><tr>${ITEM_COLUMNS.map((c, i) => `<th${i >= 5 && i <= 8 ? ' class="r"' : ''}>${c}</th>`).join('')}</tr></thead>
    <tbody>${rows.map((it) => `<tr>${itemCells(it).map((v, i) => `<td${i >= 5 && i <= 8 ? ' class="r"' : ''}>${esc(v)}</td>`).join('')}</tr>`).join('')}</tbody></table></body></html>`)
  doc.close()
  frame.contentWindow!.focus()
  frame.contentWindow!.print()
  setTimeout(() => frame.remove(), 1000)
  return rows.length
}

const months = (e: Date, from: Date) => (e.getFullYear() - from.getFullYear()) * 12 + e.getMonth() - from.getMonth()
function expTag(e: Date | null, anchor: Date | null): string {
  if (!e) return '<span class="ds-faint">—</span>'
  const from = anchor ?? new Date()
  const m = months(e, from)
  return `<span class="ds-tag ${e < from || m < 4 ? 'bad' : m < 12 ? 'warn' : ''}">${e < from ? 'expired' : 'exp'} ${String(e.getMonth() + 1).padStart(2, '0')}/${e.getFullYear()}</span>`
}

export function renderItems(host: HTMLElement, state: ItemsState, onChange: () => void, onOpen: (row: ItemRow) => void): void {
  const focused = document.activeElement?.id === 'ds-item-q'
  const filters: [ItemsState['filter'], string][] = [['all', 'All'], ['low', 'Low stock'], ['out', 'Out of stock'], ['exp', 'Expiring']]
  host.innerHTML = `<div class="ds-home ds-page"><section class="ds-card">
    <div class="ds-toolbar2"><div class="ds-search"><label class="ds-sr" for="ds-item-q">Search items</label><input class="ds-in" id="ds-item-q" value="${esc(state.q)}" placeholder="Search name, code or manufacturer" autocomplete="off">${icon('search', 's')}</div>
      <div class="ds-filters" role="group" aria-label="Filter items">${filters.map(([k, t]) => `<button class="ds-fchip" type="button" data-if="${k}" aria-pressed="${state.filter === k}">${t}<span class="n">${(state.counts[k] ?? 0).toLocaleString('en-PK')}</span></button>`).join('')}</div>
      <span class="grow"></span><span class="ds-help">${state.rows.length.toLocaleString('en-PK')}${state.rows.length === 200 ? '+' : ''} of ${(state.counts[state.filter] ?? 0).toLocaleString('en-PK')} shown</span></div>
    <div class="ds-tblw"><table class="ds-table"><thead><tr><th>Item</th><th>Manufacturer</th><th>Category</th><th>Stock</th><th class="r">Pur. price</th><th class="r">Sale price</th><th>Nearest expiry</th><th><span class="ds-sr">Open</span></th></tr></thead>
    <tbody class="ds-stagger">${state.rows.map((it, i) => {
      const p = it.reorder > 0 ? Math.min(100, it.stock / (it.reorder * 2) * 100) : it.stock > 0 ? 100 : 0
      const color = it.stock <= 0 || p < 15 ? 'var(--p-danger)' : p < 50 ? 'var(--p-warn)' : 'var(--p-ok)'
      return `<tr data-item="${i}" style="--i:${Math.min(i, 20)}" tabindex="0"><td><div class="ds-item-cell"><span class="ds-iav">${esc(it.name.slice(0, 2))}</span><div><b>${esc(it.name)}</b><div class="ds-help">${esc(it.code)}${it.pack && it.pack !== '.' ? ` · ${esc(it.pack)}` : ''}</div></div></div></td>
        <td>${esc(it.mfr)}</td><td>${esc(it.cat)}</td><td><span class="ds-sbar"><i style="width:${Math.max(3, p)}%;background:${color}"></i></span><span class="num">${it.stock.toLocaleString('en-PK')}</span></td>
        <td class="r num">${money(it.pur)}</td><td class="r num">${money(it.sale)}</td><td>${expTag(it.exp, state.anchor)}</td><td>${icon('right', 's')}</td></tr>`
    }).join('') || '<tr><td colspan="8" class="ds-empty">No item matches. Clear the search or pick another filter.</td></tr>'}</tbody></table></div></section></div>`
  const input = host.querySelector<HTMLInputElement>('#ds-item-q')!
  if (focused) { input.focus(); input.setSelectionRange(input.value.length, input.value.length) }
  let timer = 0
  input.addEventListener('input', () => { clearTimeout(timer); timer = window.setTimeout(() => { state.q = input.value; onChange() }, 250) })
  host.onclick = (event) => {
    const target = event.target as HTMLElement
    const chip = target.closest<HTMLElement>('[data-if]')
    if (chip) { state.filter = chip.dataset.if as ItemsState['filter']; onChange(); return }
    const row = target.closest<HTMLElement>('[data-item]')
    if (row) onOpen(state.rows[Number(row.dataset.item)])
  }
  host.onkeydown = (event) => {
    const row = (event.target as HTMLElement).closest<HTMLElement>('[data-item]')
    if (row && event.key === 'Enter') onOpen(state.rows[Number(row.dataset.item)])
  }
}

/** The item side panel: figures, details, batches and price history, read-only; Edit opens the original Item form. */
export async function openItemDrawer(parent: HTMLElement, it: ItemRow, query: Query, anchor: Date | null, edit: (() => void) | null): Promise<void> {
  const [detail, batches, history, sold] = await Promise.all([
    query(`select coalesce(i.retailprice,0), coalesce(i.salestax,0), coalesce(i.gstperc1,0), coalesce(i.location::text,''), coalesce(i.pctcode::text,''), coalesce(i.reorderlevel,0), coalesce(i.packunits,0), coalesce(i.salediscperc,0)
      from dbo.item i where i.icode = $1`, [it.icode]),
    query(`select coalesce(batch::text,''), expiry, qty, coalesce(godwon::text,'') from dbo.view_waseelamini_stock where icode = $1 and qty <> 0 order by expiry nulls last limit 50`, [it.icode]),
    query(`select logdate, coalesce(saleprice,0), coalesce(newsaleprice,0), coalesce(purprice,0) from dbo.itemlog where icode = $1 order by logdate desc limit 12`, [it.icode]),
    query(`select coalesce(sum(d.packqty),0) from dbo.saledetail d join dbo.saleledger l on l.saleinvcode = d.saleinvcode where d.icode = $1 and l.date >= ${ANCHOR} - 30`, [it.icode]),
  ]).catch((error: unknown) => { console.warn('Item details could not be read.', error); return [[], [], [], []] as unknown[][][] })
  const d = detail[0] ?? []
  const margin = it.sale > 0 ? (it.sale - it.pur) / it.sale * 100 : 0
  let tab = 'd'
  const scrim = document.createElement('div')
  scrim.className = 'ds-drawer-scrim'
  const drawer = document.createElement('aside')
  drawer.className = 'ds-drawer'
  drawer.setAttribute('role', 'dialog')
  drawer.setAttribute('aria-modal', 'true')
  drawer.setAttribute('aria-label', it.name)
  const previous = document.activeElement as HTMLElement | null
  const fields: [string, string][] = [['Code', it.code], ['Name', it.name], ['Packing', it.pack], ['Manufacturer', it.mfr], ['Category', it.cat], ['Reorder level', String(d[5] ?? it.reorder)],
    ['Pur. price', money(it.pur)], ['Sale price', money(it.sale)], ['Retail price', money(Number(d[0] ?? 0))], ['GST %', String(Number(d[2] ?? 0))], ['PCT code', String(d[4] ?? '')], ['Location', String(d[3] ?? '')]]
  const body = () => tab === 'd'
    ? `<div class="ds-fields">${fields.map(([l, v], i) => `<div class="ds-f"><label for="ds-dr${i}">${l}</label><input class="ds-in" id="ds-dr${i}" value="${esc(v)}" readonly></div>`).join('')}</div>`
    : tab === 'b'
      ? `<table class="ds-table"><thead><tr><th>Batch</th><th>Expiry</th><th class="r">Stock</th><th>Godown</th></tr></thead><tbody>${batches.map((b) => `<tr><td class="num">${esc(b[0])}</td><td>${expTag(b[1] ? new Date(String(b[1])) : null, anchor)}</td><td class="r num">${Number(b[2]).toLocaleString('en-PK')}</td><td>${esc(b[3])}</td></tr>`).join('') || '<tr><td colspan="4" class="ds-empty">No stock in any batch.</td></tr>'}</tbody></table>`
      : `<ul class="ds-timeline">${history.map((h) => `<li><span class="tdot">${icon('clock', 's')}</span><div>Sale price Rs ${money(Number(h[1]))}${Number(h[2]) && Number(h[2]) !== Number(h[1]) ? ` → ${money(Number(h[2]))}` : ''} · purchase Rs ${money(Number(h[3]))}<br><small>${h[0] ? new Date(String(h[0])).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : ''}</small></div></li>`).join('') || '<li>No price changes recorded.</li>'}</ul>`
  const draw = () => {
    drawer.innerHTML = `<div class="ds-drawer-h"><span class="ds-iav ds-iav-lg">${esc(it.name.slice(0, 2))}</span><div class="ds-grow"><b>${esc(it.name)}</b><div class="ds-help">${esc(it.code)} · ${esc(it.mfr)}</div></div><button class="ds-ic" type="button" data-close aria-label="Close">${icon('x')}</button></div>
      <div class="ds-drawer-b"><div class="ds-kpis ds-kpis-3">${[['In stock', it.stock.toLocaleString('en-PK'), ''], ['Sold (30 d)', Number(sold[0]?.[0] ?? 0).toLocaleString('en-PK'), ''], ['Margin', `${margin.toFixed(1)}%`, margin < 0 ? 'down' : margin < 10 ? '' : 'up']]
        .map(([k, v, c]) => `<div class="ds-card ds-kpi ds-kpi-sm"><div class="k">${k}</div><div class="v num ${c}">${v}</div></div>`).join('')}</div>
      <div class="ds-tabs" role="tablist">${[['d', 'Details'], ['b', 'Batches'], ['h', 'History']].map(([k, t]) => `<button type="button" role="tab" aria-selected="${tab === k}" data-dt="${k}">${t}</button>`).join('')}</div>${body()}</div>
      <div class="ds-drawer-f"><button class="ds-btn" type="button" data-close>Close</button><button class="ds-btn ds-btn-primary" type="button" data-edit ${edit ? '' : 'disabled'}>${icon('edit', 's')}Edit in Item form</button></div>`
  }
  const close = () => { scrim.remove(); drawer.remove(); previous?.focus?.() }
  scrim.onclick = close
  drawer.addEventListener('click', (event) => {
    const target = event.target as HTMLElement
    if (target.closest('[data-close]')) { close(); return }
    const t = target.closest<HTMLElement>('[data-dt]')
    if (t) { tab = t.dataset.dt!; draw(); drawer.querySelector<HTMLElement>(`[data-dt="${tab}"]`)?.focus(); return }
    if (target.closest('[data-edit]') && edit) { close(); edit() }
  })
  drawer.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') { event.stopPropagation(); close() }
    if (event.key === 'Tab') {
      const focusable = [...drawer.querySelectorAll<HTMLElement>('button:not([disabled]),input')]
      const first = focusable[0], last = focusable.at(-1)
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
  })
  parent.append(scrim, drawer)
  draw()
  drawer.querySelector<HTMLElement>('[data-close]')?.focus()
}

export const PAGES_CSS = `
/* ---------- Reports catalogue and Items list (mockup .rep-grid, .cats, .rcards, .toolbar2, .fchip, .drawer) ---------- */
.ds-page .ds-page-hello {margin:0 0 12px;}
.ds-page .ds-page-hello h2 {font-size:20px;}
.ds-rep-grid {display:grid;grid-template-columns:240px minmax(0,1fr);gap:18px;align-items:start;}
.ds-cats {display:flex;flex-direction:column;gap:2px;padding:8px;}
.ds-cats button {display:flex;justify-content:space-between;align-items:center;border:0;background:none;padding:8px 10px;border-radius:8px;cursor:pointer;text-align:left;color:var(--p-muted);font:500 14px var(--p-font);transition:background .15s,color .15s;}
.ds-cats button:hover {background:var(--p-sunk);color:var(--p-text);}
.ds-cats button[aria-current=true] {background:var(--p-selected);color:var(--p-accent);}
.ds-cats .n {font:12px var(--p-mono);color:var(--p-faint);}
.ds-cat-star {display:inline-flex;align-items:center;gap:6px;}
.ds-rcards {display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px;}
.ds-rcard {display:flex;flex-direction:column;gap:6px;padding:14px;border:1px solid var(--p-hair);border-radius:12px;background:var(--p-surface);cursor:pointer;text-align:left;transition:transform .2s cubic-bezier(.34,1.56,.64,1),border-color .2s,box-shadow .2s;}
.ds-rcard:hover {transform:translateY(-3px);border-color:var(--p-accent);box-shadow:0 8px 24px var(--p-glow);}
.ds-rcard.off {opacity:.55;cursor:not-allowed;}
.ds-rcard.off:hover {transform:none;border-color:var(--p-hair);box-shadow:none;}
.ds-rcard small {color:var(--p-muted);}
.ds-rcard b {font-weight:600;}
.ds-rcard-top {display:flex;align-items:center;gap:8px;}
.ds-qi {width:32px;height:32px;border-radius:9px;display:grid;place-items:center;background:var(--p-selected);color:var(--p-accent);}
.ds-star {margin-left:auto;border:0;background:none;width:30px;height:30px;border-radius:8px;display:grid;place-items:center;cursor:pointer;color:var(--p-faint);}
.ds-star:hover {background:var(--p-sunk);}
.ds-star.on {color:#d9a400;}
.ds-star.on svg {fill:currentColor;}
.ds-toolbar2 {display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:14px 18px;border-bottom:1px solid var(--p-hair);}
.ds-toolbar2 .grow,.ds-grow {flex:1;min-width:0;}
.ds-search {position:relative;width:min(340px,100%);}
.ds-search .ds-i {position:absolute;left:11px;top:50%;transform:translateY(-50%);color:var(--p-faint);pointer-events:none;}
.ds-search .ds-in {padding-left:34px;}
.ds-in {width:100%;height:40px;padding:0 12px;border:1px solid var(--p-line);border-radius:8px;background:var(--p-surface);color:var(--p-text);font:14px var(--p-font);transition:border-color .2s,box-shadow .2s;}
.ds-in:focus {outline:0;border-color:var(--p-accent);box-shadow:0 0 0 4px var(--p-glow);}
.ds-in[readonly] {background:var(--p-sunk);}
.ds-sr {position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;}
.ds-filters {display:flex;gap:6px;flex-wrap:wrap;}
.ds-fchip {border:1px solid var(--p-line);background:var(--p-surface);border-radius:999px;padding:5px 12px;font:12.5px var(--p-font);cursor:pointer;color:var(--p-muted);transition:all .2s;}
.ds-fchip[aria-pressed=true] {background:var(--p-text);color:var(--p-canvas);border-color:var(--p-text);}
.ds-fchip .n {font-family:var(--p-mono);opacity:.75;margin-left:4px;}
.ds-help {font-size:12px;color:var(--p-faint);}
.ds-faint {color:var(--p-faint);}
.ds-tblw {overflow:auto;}
.ds-table {width:100%;border-collapse:collapse;font-size:13.5px;}
.ds-table th {text-align:left;font:600 11px var(--p-font);letter-spacing:.06em;text-transform:uppercase;color:var(--p-muted);padding:10px 14px;background:var(--p-sunk);border-bottom:1px solid var(--p-hair);white-space:nowrap;position:sticky;top:0;}
.ds-table td {padding:10px 14px;border-bottom:1px solid var(--p-hair);vertical-align:middle;}
.ds-table .r {text-align:right;}
.ds-table .num {font-family:var(--p-mono);font-variant-numeric:tabular-nums;}
.ds-table tbody tr[data-item] {cursor:pointer;transition:background .15s;}
.ds-table tbody tr[data-item]:hover {background:var(--p-selected);}
.ds-table tbody tr[data-item]:focus-visible {outline:2px solid var(--p-accent);outline-offset:-2px;}
.ds-item-cell {display:flex;gap:10px;align-items:center;}
.ds-item-cell b {font-weight:500;}
.ds-iav {width:32px;height:32px;border-radius:9px;display:grid;place-items:center;font-size:11px;font-weight:700;flex:none;background:var(--p-selected);color:var(--p-accent);text-transform:uppercase;}
.ds-iav-lg {width:40px;height:40px;}
.ds-sbar {width:90px;height:6px;border-radius:999px;background:var(--p-sunk);overflow:hidden;display:inline-block;vertical-align:middle;margin-right:8px;}
.ds-sbar i {display:block;height:100%;border-radius:999px;}
.ds-drawer-scrim {position:fixed;inset:0;background:var(--p-scrim);z-index:45;animation:ds-up .2s both;backdrop-filter:blur(2px);}
.ds-drawer {position:fixed;top:0;right:0;bottom:0;width:min(520px,100vw);background:var(--p-surface);color:var(--p-text);font:14px/1.5 var(--p-font);z-index:46;box-shadow:var(--p-shadow-lg);display:flex;flex-direction:column;animation:ds-slide-l .35s cubic-bezier(.2,.8,.2,1);}
@keyframes ds-slide-l {from{transform:translateX(40px);opacity:0}to{transform:none;opacity:1}}
.ds-drawer-h,.ds-drawer-f {display:flex;align-items:center;gap:12px;padding:16px 18px;border-bottom:1px solid var(--p-hair);}
.ds-drawer-f {border-bottom:0;border-top:1px solid var(--p-hair);justify-content:flex-end;}
.ds-drawer-b {flex:1;overflow:auto;padding:18px;}
.ds-ic {border:0;background:none;width:34px;height:34px;border-radius:9px;display:grid;place-items:center;cursor:pointer;color:var(--p-muted);}
.ds-ic:hover {background:var(--p-sunk);color:var(--p-text);}
.ds-kpis-3 {display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin-bottom:16px;}
.ds-kpi-sm {padding:12px;}
.ds-kpi-sm .k {font-size:12.5px;color:var(--p-muted);font-weight:500;}
.ds-kpi-sm .v {font:600 20px/1.2 var(--p-mono);margin-top:6px;}
.ds-kpi-sm .v.up {color:var(--p-ok);} .ds-kpi-sm .v.down {color:var(--p-danger);}
.ds-tabs {display:flex;gap:4px;border-bottom:1px solid var(--p-hair);margin:-4px 0 16px;}
.ds-tabs button {border:0;background:none;padding:9px 12px;cursor:pointer;color:var(--p-muted);font:500 14px var(--p-font);border-bottom:2px solid transparent;margin-bottom:-1px;transition:color .2s,border-color .2s;}
.ds-tabs button[aria-selected=true] {color:var(--p-accent);border-color:var(--p-accent);}
.ds-fields {display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px 16px;}
.ds-f label {display:block;font-size:12.5px;font-weight:500;color:var(--p-muted);margin-bottom:5px;}
.ds-btn-primary {background:var(--p-accent);color:var(--p-on-accent);border-color:var(--p-accent);}
.ds-btn-primary:hover {background:var(--p-accent-2);}
.ds-btn:disabled {opacity:.5;cursor:not-allowed;}
/* ---------- Classic content inside Modern windows (list windows, embedded tabs): the design system's colours, borders and
   controls over the original geometry.  Only the default colours are replaced; a DataWindow's own colour expressions stay. */
.modern-window .window-embedded {background-color:var(--p-surface)!important;color:var(--p-text)!important;color-scheme:inherit!important;border-radius:12px;}
.modern-window .window-embedded .strip {border-bottom:1px solid var(--p-hair);background:none!important;}
.modern-window .window-embedded .strip .t {border:0!important;border-bottom:2px solid transparent!important;background:none!important;color:var(--p-muted)!important;font:500 13.5px var(--p-font)!important;padding:6px 12px!important;border-radius:0!important;}
.modern-window .window-embedded .strip .t.on {color:var(--p-accent)!important;border-bottom-color:var(--p-accent)!important;}
.modern-window .window-embedded .page {background:var(--p-surface)!important;}
.modern-window .window-embedded fieldset.ctl {border:1px solid var(--p-hair)!important;border-radius:10px;background:none!important;}
.modern-window .window-embedded fieldset.ctl legend {color:var(--p-muted)!important;font:600 12px var(--p-font)!important;padding:0 6px;}
.modern-window .window-embedded .ctl.st,.modern-window .window-embedded label.ctl {color:var(--p-text)!important;background:none!important;}
.modern-window .window-embedded button.ctl {background:var(--p-surface)!important;color:var(--p-text)!important;border:1px solid var(--p-line)!important;border-radius:8px!important;font:500 13px var(--p-font)!important;box-shadow:none!important;transition:background .15s,border-color .15s;}
.modern-window .window-embedded button.ctl:hover:not(:disabled) {background:var(--p-selected)!important;border-color:var(--p-accent)!important;}
.modern-window .window-embedded button.ctl:disabled {color:var(--p-faint)!important;background:var(--p-sunk)!important;}
.modern-window .window-embedded :is(.pb-dropdown .dropdown-select,.pb-dropdown .dropdown-input,input.ctl,select.ctl,textarea.ctl) {background:var(--p-surface)!important;color:var(--p-text)!important;border:1px solid var(--p-line)!important;border-radius:6px!important;}
.modern-window .window-embedded .pb-dropdown .dropdown-toggle {background:none!important;border:0!important;color:var(--p-muted)!important;}
.modern-window .window-embedded :is(input,select,textarea):focus {outline:0!important;border-color:var(--p-accent)!important;box-shadow:0 0 0 3px var(--p-glow)!important;}
.modern-window .window-embedded .pb-dropdown .dropdown-list {background:var(--p-surface)!important;color:var(--p-text)!important;border:1px solid var(--p-hair)!important;border-radius:10px;box-shadow:var(--p-shadow-lg);}
.modern-window .dw:not(.modern-surface) {background:var(--p-surface)!important;color:var(--p-text);border-color:var(--p-hair)!important;}
.modern-window .dw:not(.modern-surface) > .dw-inner:is([style*="background: rgb(240, 240, 240)"],[style*="background: rgb(255, 255, 255)"],[style*="background-color: rgb(240, 240, 240)"],[style*="background-color: rgb(255, 255, 255)"]) {background:var(--p-surface)!important;}
.modern-window .dw:not(.modern-surface) .band.hdr .o {background:var(--p-sunk)!important;color:var(--p-muted)!important;border-color:var(--p-hair)!important;font-weight:600!important;}
.modern-window .dw:not(.modern-surface) .band.row .o:is([style*="background: rgb(255, 255, 255)"],[style*="background: rgb(240, 240, 240)"],[style*="background: rgb(236, 233, 216)"]) {background:transparent!important;}
.modern-window .dw:not(.modern-surface) .o[style*="; color: rgb(0, 0, 0)"] {color:var(--p-text)!important;}
.modern-window .dw:not(.modern-surface) .band.row {border-bottom:1px solid var(--p-hair);box-sizing:border-box;}
.modern-window .dw:not(.modern-surface) .band.row.cur {background:var(--p-selected)!important;box-shadow:inset 3px 0 0 var(--p-accent);}
.modern-window .dw:not(.modern-surface) .band.row:hover {background:var(--p-sunk);}
.modern-window .dw:not(.modern-surface) .band.row.cur:hover {background:var(--p-selected)!important;}
.modern-window .dw:not(.modern-surface) :is(input,textarea,select).dw-edit {background:var(--p-surface)!important;color:var(--p-text)!important;}
/* ---------- Report criteria (the original w_arg_* dialogs) docked under the report header as the mockup's filter card: same
   window, fields and Ok/Cancel; it only sits in the page instead of floating over a dimmed screen ---------- */
dialog.presentation-compatibility-dialog[open]:has(.pbwin[data-win^=w_arg_]) {position:fixed;inset:var(--ds-report-top,150px) 16px auto 16px;margin:0;width:auto;max-width:none;max-height:calc(100vh - var(--ds-report-top,150px) - 48px);animation:ds-drop .2s var(--p-ease);}
dialog.presentation-compatibility-dialog:has(.pbwin[data-win^=w_arg_])::backdrop {background:transparent;backdrop-filter:none;}
dialog.presentation-compatibility-dialog[open]:has(.pbwin[data-win^=w_arg_]) .modern-window.pbwin {width:100%!important;max-width:none!important;box-shadow:var(--p-shadow-lg);}
@media (min-width:900px){
  dialog.presentation-compatibility-dialog[open]:has(.pbwin[data-win^=w_arg_]) .window-fields.has-grid {display:flex!important;flex-wrap:wrap;align-items:flex-end;gap:12px 18px;}
  dialog.presentation-compatibility-dialog[open]:has(.pbwin[data-win^=w_arg_]) .window-fields.has-grid > * {flex:1 1 220px;grid-column:auto!important;grid-row:auto!important;}
  dialog.presentation-compatibility-dialog[open]:has(.pbwin[data-win^=w_arg_]) .window-fields.has-grid > .window-frame {flex:1 1 100%;}
  dialog.presentation-compatibility-dialog[open]:has(.pbwin[data-win^=w_arg_]) .window-fields.has-grid > .window-option {flex:0 1 auto;}
}
/* ---------- Group Rights (Manage › Groups): the original rights grid as the mockup's matrix — level shown by weight and a
   tint instead of the source's blue bands, permissions as switches (the cell, its click handling and the saved value are unchanged) */
.pbwin[data-win=w_groups_form] .dw:has(.o[data-obj=checked]) {background:var(--p-surface)!important;}
.pbwin[data-win=w_groups_form] .dw:has(.o[data-obj=checked]) .band:not(.row) .o {background:var(--p-sunk)!important;color:var(--p-muted)!important;font:600 11px/16px var(--p-font)!important;letter-spacing:.05em;text-transform:uppercase;border:0!important;}
.pbwin[data-win=w_groups_form] .dw:has(.o[data-obj=checked]) .band.row .o {color:var(--p-text)!important;font-family:var(--p-font)!important;border-color:var(--p-hair)!important;}
.pbwin[data-win=w_groups_form] .dw:has(.o[data-obj=checked]) .band.row .o[style*="rgb(100, 150, 150)"] {background:var(--p-sunk)!important;font-weight:700!important;}
.pbwin[data-win=w_groups_form] .dw:has(.o[data-obj=checked]) .band.row .o[style*="rgb(125, 175, 200)"] {background:var(--p-selected)!important;font-weight:600!important;}
.pbwin[data-win=w_groups_form] .dw:has(.o[data-obj=checked]) .band.row .o[style*="rgb(100, 150, 200)"] {background:var(--p-surface)!important;font-weight:500!important;}
.pbwin[data-win=w_groups_form] .dw:has(.o[data-obj=checked]) .band.row .o[style*="rgb(150, 200, 255)"] {background:var(--p-surface)!important;color:var(--p-muted)!important;}
.pbwin[data-win=w_groups_form] .dw:has(.o[data-obj=checked]) .band.row.cur .o {box-shadow:inset 0 -1px 0 var(--p-accent);}
.pbwin[data-win=w_groups_form] .o[data-obj=checked] .cbx {position:relative;width:26px!important;height:14px!important;border-radius:999px!important;border:0!important;background:var(--p-line)!important;transition:background .25s;flex:none;}
.pbwin[data-win=w_groups_form] .o[data-obj=checked] .cbx::after {content:""!important;position:absolute;top:2px;left:2px;width:10px;height:10px;border:0!important;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgb(0 0 0 / .3);transform:none;transition:transform .3s cubic-bezier(.34,1.56,.64,1);}
.pbwin[data-win=w_groups_form] .o[data-obj=checked] .cbx.on {background:var(--p-accent)!important;}
.pbwin[data-win=w_groups_form] .o[data-obj=checked] .cbx.on::after {transform:translateX(12px);}
/* ---------- Preferences (mockup .theme-cards, .tcard, .set-row, .seg, .switch) ---------- */
.presentation-settings {width:min(720px,calc(100vw - 32px));}
.presentation-settings .ds-set-head {display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;margin-bottom:14px;}
.presentation-settings .ds-set-head h2 {margin:0;font-size:18px;}
.presentation-settings .ds-set-card {border:1px solid var(--p-hair);border-radius:14px;padding:16px 18px;margin-bottom:14px;background:var(--p-surface);}
.presentation-settings .ds-set-card h3 {margin:0 0 4px;font-size:15px;}
.ds-theme-cards {display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin-bottom:6px;}
.presentation-settings .ds-tcard {display:block;border:2px solid var(--p-hair);border-radius:14px;padding:10px;background:var(--p-surface);cursor:pointer;text-align:left;min-height:0;height:auto;width:100%;color:var(--p-text);transition:border-color .2s,transform .2s cubic-bezier(.34,1.56,.64,1);}
.presentation-settings .ds-tcard:hover {transform:translateY(-2px);background:var(--p-surface);}
.presentation-settings .ds-tcard[aria-pressed=true] {border-color:var(--p-accent);box-shadow:0 0 0 4px var(--p-glow);}
.ds-tcard b {display:block;font-weight:600;}
.ds-tprev {height:84px;border-radius:9px;overflow:hidden;display:grid;grid-template-rows:16px 1fr;margin-bottom:8px;border:1px solid var(--p-hair);}
.ds-tprev .h {background:#13232a;}
.ds-tprev .b {display:grid;grid-template-columns:1fr 1fr;gap:6px;padding:8px;}
.ds-tprev .b i {border-radius:5px;}
.ds-set-row {display:flex;align-items:center;justify-content:space-between;gap:12px 16px;padding:14px 0;border-bottom:1px solid var(--p-hair);flex-wrap:wrap;}
.ds-set-row > div:first-child {flex:1 1 220px;min-width:0;}
.ds-set-row:last-of-type {border-bottom:0;}
.ds-set-row p {margin:2px 0 0;color:var(--p-muted);font-size:12.5px;}
.ds-set-row select {width:200px;max-width:100%;}
.ds-seg {display:inline-flex;padding:3px;border-radius:10px;background:var(--p-sunk);gap:2px;flex-wrap:wrap;}
.presentation-settings .ds-seg button {border:0!important;background:none!important;padding:6px 12px;min-height:0;height:auto;border-radius:7px;cursor:pointer;color:var(--p-muted)!important;font:500 13.5px var(--p-font);box-shadow:none!important;transition:background .2s,color .2s;}
.presentation-settings .ds-seg button[aria-pressed=true] {background:var(--p-surface)!important;color:var(--p-text)!important;box-shadow:0 1px 3px rgb(0 0 0 / .12)!important;}
.presentation-settings .ds-switch {position:relative;width:40px;height:24px;min-height:0;padding:0;flex:none;border-radius:999px;background:var(--p-line)!important;border:0!important;cursor:pointer;transition:background .25s;}
.ds-switch::after {content:"";position:absolute;top:3px;left:3px;width:18px;height:18px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgb(0 0 0 / .3);transition:transform .3s cubic-bezier(.34,1.56,.64,1);}
.presentation-settings .ds-switch[aria-checked=true] {background:var(--p-accent)!important;}
.ds-switch[aria-checked=true]::after {transform:translateX(16px);}
.ds-set-more summary {cursor:pointer;font-weight:600;padding:10px 0;color:var(--p-accent);}
.ds-set-more fieldset {border:0;padding:0;margin:0;}
.presentation-settings footer .ds-restore {margin-right:auto;}
.presentation-settings .ds-sr {position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;}
.ds-no-motion *,.ds-no-motion *::before,.ds-no-motion *::after {animation:none!important;transition:none!important;}
@media (max-width:620px){.ds-theme-cards{grid-template-columns:minmax(0,1fr)}.ds-tprev{height:56px}}
@media (max-width:900px){.ds-rep-grid{grid-template-columns:minmax(0,1fr)}.ds-cats{flex-direction:row;overflow-x:auto}.ds-cats button{white-space:nowrap;gap:8px}}
@media (max-width:560px){.ds-fields{grid-template-columns:minmax(0,1fr)}.ds-kpis-3{grid-template-columns:minmax(0,1fr)}}
`
