// Home dashboard of the approved design: real figures read from the company database (read-only SELECTs), quick actions that run
// the live menu items, stock and expiry alerts, recent activity.  Figures are anchored to the latest business day that has sales, so
// a database restored from an older snapshot still shows its real numbers (the anchor date is printed).
export interface HomeQuery { (sql: string): Promise<unknown[][]> }
export interface HomeAction { label: string; hint: string; icon: string; run(): void; disabled?: boolean }
export interface HomeNote { tone: 'bad' | 'warn' | 'info' | 'ok'; title: string; detail: string }

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!))
const rs0 = (n: number) => `Rs ${Math.round(n).toLocaleString('en-PK')}`
const num = (v: unknown) => Number(v) || 0
const day = (v: unknown) => new Date(String(v).slice(0, 10) + 'T00:00:00')
const fmtDay = (d: Date, o: Intl.DateTimeFormatOptions) => d.toLocaleDateString('en-GB', o)
export const HOME_ICONS: Record<string, string> = {
  cart: '<circle cx="9" cy="20" r="1.5"/><circle cx="18" cy="20" r="1.5"/><path d="M2 3h3l2.6 12.4a2 2 0 0 0 2 1.6h8.8a2 2 0 0 0 2-1.6L22 7H6"/>',
  truck: '<path d="M1 4h13v12H1zM14 8h4l4 4v4h-8"/><circle cx="5.5" cy="18.5" r="2"/><circle cx="17.5" cy="18.5" r="2"/>',
  wallet: '<path d="M3 7a2 2 0 0 1 2-2h13v4"/><path d="M3 7v11a2 2 0 0 0 2 2h15V9H5a2 2 0 0 1-2-2zM16 14h.01"/>',
  doc: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M8 13h8M8 17h5"/>',
  box: '<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/>',
  chart: '<path d="M3 3v18h18"/><path d="m7 15 4-4 3 3 6-7"/>',
  users: '<circle cx="9" cy="8" r="4"/><path d="M2 21a7 7 0 0 1 14 0M16 3.1a4 4 0 0 1 0 7.8M22 21a7 7 0 0 0-4-6.3"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>',
  post: '<path d="M20 6 9 17l-5-5"/>',
}
const icon = (k: string, cls = '') => `<svg class="ds-i ${cls}" viewBox="0 0 24 24" aria-hidden="true">${HOME_ICONS[k] ?? ''}</svg>`

export interface HomeData {
  anchor: Date | null
  sales: number; salesPrev: number; purchases: number; purchasesPrev: number
  receivable: number; receivableCount: number; payable: number; payableCount: number
  series: { d: Date; sales: number; purchases: number }[]
  low: { name: string; stock: number; reorder: number }[]
  expiring: { name: string; batch: string; expiry: Date; qty: number }[]
  recent: { kind: 'sale' | 'purchase'; code: string; total: number; date: Date; who: string }[]
}

export async function loadHome(query: HomeQuery): Promise<HomeData> {
  const [anchorRow] = await query(`SELECT max(date)::date FROM dbo.saleledger`)
  const anchor = anchorRow?.[0] ? day(anchorRow[0]) : null
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  if (!anchor) return { anchor, sales: 0, salesPrev: 0, purchases: 0, purchasesPrev: 0, receivable: 0, receivableCount: 0, payable: 0, payableCount: 0, series: [], low: [], expiring: [], recent: [] }
  const a = iso(anchor)
  const [series, ar, ap, low, expiring, recent] = await Promise.all([
    query(`WITH d AS (SELECT generate_series(date '${a}' - 13, date '${a}', interval '1 day')::date AS d)
      SELECT d.d, coalesce((SELECT sum(invtotal) FROM dbo.saleledger s WHERE s.date::date = d.d),0),
        coalesce((SELECT sum(invtotal) FROM dbo.purledger p WHERE p.date::date = d.d),0) FROM d ORDER BY d.d`),
    // balances from the accounts ledger (the invoices' own outstanding columns are not maintained by the application)
    query(`SELECT coalesce(sum(b),0), count(*) FROM (SELECT g.acccode, sum(g.debit - g.credit) AS b FROM dbo.virtualgl g
      JOIN dbo.customer c ON c.custcode = g.acccode GROUP BY g.acccode HAVING sum(g.debit - g.credit) > 0.5) x`),
    query(`SELECT coalesce(sum(b),0), count(*) FROM (SELECT g.acccode, sum(g.credit - g.debit) AS b FROM dbo.virtualgl g
      JOIN dbo.supplier s ON s.suppcode = g.acccode GROUP BY g.acccode HAVING sum(g.credit - g.debit) > 0.5) x`),
    query(`SELECT i.name, coalesce(sum(v.qty),0) AS stock, i.reorderlevel FROM dbo.item i LEFT JOIN dbo.view_waseelamini_stock v ON v.icode = i.icode
      WHERE i.reorderlevel > 0 GROUP BY i.icode, i.name, i.reorderlevel HAVING coalesce(sum(v.qty),0) < i.reorderlevel
      ORDER BY coalesce(sum(v.qty),0) / i.reorderlevel, i.name LIMIT 5`),
    query(`SELECT itemname, batch, expiry::date, qty FROM dbo.view_waseelamini_stock WHERE qty > 0 AND expiry IS NOT NULL
      AND expiry::date <= current_date + 90 ORDER BY expiry, itemname LIMIT 5`),
    query(`SELECT r.kind, r.code, r.total, r.date, coalesce(u.username::text, '') FROM (
        (SELECT 'sale' AS kind, saleinvcode AS code, invtotal AS total, date, coalesce(postedby, modifiedby) AS who FROM dbo.saleledger ORDER BY date DESC, saleinvcode DESC LIMIT 3)
        UNION ALL (SELECT 'purchase', purinvcode, invtotal, date, coalesce(postedby, modifiedby) FROM dbo.purledger ORDER BY date DESC, purinvcode DESC LIMIT 2)
      ) r LEFT JOIN dbo.users u ON u.usercode = r.who ORDER BY r.date DESC`),
  ])
  const s = series.map((r) => ({ d: day(r[0]), sales: num(r[1]), purchases: num(r[2]) }))
  return {
    anchor,
    sales: s.at(-1)?.sales ?? 0, salesPrev: s.at(-2)?.sales ?? 0, purchases: s.at(-1)?.purchases ?? 0, purchasesPrev: s.at(-2)?.purchases ?? 0,
    receivable: num(ar[0]?.[0]), receivableCount: num(ar[0]?.[1]), payable: num(ap[0]?.[0]), payableCount: num(ap[0]?.[1]),
    series: s,
    low: low.map((r) => ({ name: String(r[0]).trim(), stock: num(r[1]), reorder: num(r[2]) })),
    expiring: expiring.map((r) => ({ name: String(r[0]).trim(), batch: String(r[1] ?? '').trim(), expiry: day(r[2]), qty: num(r[3]) })),
    recent: recent.map((r) => ({ kind: r[0] === 'sale' ? 'sale' : 'purchase', code: String(r[1]).trim(), total: num(r[2]), date: day(r[3]), who: String(r[4] ?? '').trim() })),
  }
}

/** Notifications for the bell, derived from the same figures. */
export function homeNotes(d: HomeData): HomeNote[] {
  const notes: HomeNote[] = []
  if (d.low.length) notes.push({ tone: 'bad', title: `${d.low.length} item${d.low.length === 1 ? '' : 's'} below reorder level`, detail: d.low.slice(0, 3).map((x) => x.name).join(', ') })
  if (d.expiring.length) notes.push({ tone: 'warn', title: `${d.expiring.length} batch${d.expiring.length === 1 ? '' : 'es'} expired or expiring within 90 days`, detail: d.expiring.slice(0, 3).map((x) => x.name).join(', ') })
  if (d.receivableCount) notes.push({ tone: 'info', title: `${d.receivableCount.toLocaleString('en-PK')} customers owe money`, detail: `${rs0(d.receivable)} to collect` })
  if (d.payableCount) notes.push({ tone: 'info', title: `${d.payableCount.toLocaleString('en-PK')} suppliers have a balance`, detail: `${rs0(d.payable)} payable` })
  return notes
}

function spark(values: number[]): string {
  if (values.length < 2) return ''
  const max = Math.max(...values), min = Math.min(...values), w = 96, h = 36
  const pts = values.map((v, i) => [i * (w / (values.length - 1)), h - 4 - (v - min) / (max - min || 1) * (h - 8)])
  const d = 'M' + pts.map((p) => p.map((n) => n.toFixed(1)).join(',')).join('L')
  return `<svg class="ds-spark" viewBox="0 0 96 36" aria-hidden="true"><path class="a" d="${d}L96,36L0,36Z"/><path class="l" d="${d}"/></svg>`
}

function chart(series: HomeData['series']): string {
  if (!series.length) return '<p class="ds-empty">No sales or purchases recorded yet.</p>'
  const W = 640, H = 240, P = [30, 10, 26, 46], n = series.length
  const max = Math.max(1, ...series.map((r) => Math.max(r.sales, r.purchases)))
  const step = Math.pow(10, Math.floor(Math.log10(max))) / 2
  const top = Math.ceil(max / step) * step
  const x = (i: number) => P[3] + i * (W - P[1] - P[3]) / Math.max(1, n - 1)
  const y = (v: number) => P[0] + (H - P[0] - P[2]) * (1 - v / top)
  const line = (k: 'sales' | 'purchases') => 'M' + series.map((r, i) => `${x(i).toFixed(1)},${y(r[k]).toFixed(1)}`).join('L')
  let grid = ''
  for (let v = 0; v <= top + 1e-9; v += top / 4) {
    grid += `<line class="g" x1="${P[3]}" x2="${W - P[1]}" y1="${y(v)}" y2="${y(v)}"/><text x="${P[3] - 8}" y="${y(v) + 4}" text-anchor="end">${v >= 1000 ? Math.round(v / 1000) + 'k' : Math.round(v)}</text>`
  }
  series.forEach((r, i) => { if (i % 2 === 0) grid += `<text x="${x(i)}" y="${H - 6}" text-anchor="middle">${r.d.getDate()}/${r.d.getMonth() + 1}</text>` })
  const last = series.length - 1
  return `<div class="ds-chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Sales and purchases over ${n} days">
    <defs><linearGradient id="ds-ga" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#4fb8b2" stop-opacity=".35"/><stop offset="1" stop-color="#4fb8b2" stop-opacity="0"/></linearGradient></defs>
    ${grid}<path class="ar" d="${line('sales')}L${x(last)},${y(0)}L${x(0)},${y(0)}Z"/><path class="s2" d="${line('purchases')}"/><path class="s1" d="${line('sales')}"/>
    <circle cx="${x(last)}" cy="${y(series[last].sales)}" r="5" class="end"/><line class="hair" x1="0" x2="0" y1="${P[0]}" y2="${H - P[2]}"/></svg><div class="ds-tip" hidden></div></div>`
}

export function renderHome(host: HTMLElement, d: HomeData, user: string, actionsNow: () => HomeAction[], openReports: () => void, animate: boolean, context: string[] = []): void {
  const actions = actionsNow()
  const h = new Date().getHours()
  const greet = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
  const anchorText = d.anchor ? fmtDay(d.anchor, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : 'No transactions yet'
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const stale = !!d.anchor && d.anchor.getTime() < today.getTime()
  // the approved wording ("Today's sales … vs yesterday") when the latest business day is today; otherwise the day is named
  const change = (cur: number, prev: number) => prev ? `${cur >= prev ? '+' : '−'}${Math.abs((cur - prev) / prev * 100).toFixed(1)}% vs ${stale ? 'previous day' : 'yesterday'}` : `No figures for ${stale ? 'the previous day' : 'yesterday'}`
  const kpis = [
    [stale ? 'Sales' : "Today's sales", d.sales, change(d.sales, d.salesPrev), d.sales >= d.salesPrev ? 'up' : 'down', 'cart', d.series.map((r) => r.sales)],
    [stale ? 'Purchases' : 'Purchases today', d.purchases, change(d.purchases, d.purchasesPrev), d.purchases <= d.purchasesPrev ? 'up' : 'down', 'truck', d.series.map((r) => r.purchases)],
    ['Receivables', d.receivable, d.receivableCount ? `${d.receivableCount.toLocaleString('en-PK')} customers owe` : 'No customer balances', d.receivableCount ? 'down' : '', 'wallet', []],
    ['Payables', d.payable, d.payableCount ? `${d.payableCount.toLocaleString('en-PK')} suppliers to pay` : 'No supplier balances', '', 'doc', []],
  ] as const
  const months = (e: Date) => (e.getFullYear() - today.getFullYear()) * 12 + e.getMonth() - today.getMonth()
  const tag = (e: Date) => { const m = months(e); return `<span class="ds-tag ${e < today ? 'bad' : m < 4 ? 'bad' : m < 12 ? 'warn' : ''}">${e < today ? 'expired' : 'exp'} ${String(e.getMonth() + 1).padStart(2, '0')}/${e.getFullYear()}</span>` }
  host.innerHTML = `<div class="ds-home${animate ? ' ds-enter' : ''}">
    <div class="ds-hello"><div><h2>${greet}, ${esc(user)}</h2><p>${stale ? 'Latest business day: ' : ''}${esc(anchorText)}<span class="ds-ctx">${context.map((part) => ` · ${esc(part)}`).join('')}</span></p></div>
      <div class="ds-hello-actions"><button type="button" class="ds-btn" data-home="reports">${icon('chart', 's')}Reports</button><button type="button" class="ds-btn primary" data-home="0">${icon('cart', 's')}New sale</button></div></div>
    <div class="ds-kpis ds-stagger">${kpis.map(([t, v, sub, c, ic, sp], i) => `<div class="ds-card ds-lift ds-kpi" style="--i:${i}"><div class="k"><span class="ki">${icon(ic, 's')}</span>${t}${i < 2 && stale ? ' · latest day' : ''}</div>
      <div class="v" data-to="${v}">${rs0(v)}</div><div class="d ${c}">${esc(sub)}</div>${spark([...sp])}</div>`).join('')}</div>
    <div class="ds-grid2">
      <div class="ds-stack">
        <div class="ds-card"><div class="ds-card-h"><h2>Sales and purchases</h2><span class="hint">${d.series.length} days to ${d.anchor ? fmtDay(d.anchor, { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}, Rs</span><span class="grow"></span>
          <div class="ds-legend"><span><i style="background:var(--p-accent)"></i>Sales</span><span><i style="background:#7a8fd0"></i>Purchases</span></div></div><div class="ds-card-b">${chart(d.series)}</div></div>
        <div class="ds-card"><div class="ds-card-h"><h2>Recent activity</h2></div><div class="ds-card-b"><ul class="ds-timeline ds-stagger">${d.recent.map((r, i) => `<li style="--i:${i}"><span class="tdot">${icon(r.kind === 'sale' ? 'post' : 'truck', 's')}</span><div><div>${r.kind === 'sale' ? 'Sale' : 'Purchase'} ${esc(r.code)} · ${rs0(r.total)}</div><small>${esc(r.who || '—')} · ${fmtDay(r.date, { day: 'numeric', month: 'short', year: 'numeric' })}</small></div></li>`).join('') || '<li>No transactions yet.</li>'}</ul></div></div>
      </div>
      <div class="ds-stack">
        <div class="ds-card"><div class="ds-card-h"><h2>Quick actions</h2></div><div class="ds-card-b"><div class="ds-qa ds-stagger">${actions.map((a, i) => `<button type="button" data-home="${i}" style="--i:${i}" ${a.disabled ? 'disabled' : ''}><span class="qi">${icon(a.icon, 's')}</span><b>${esc(a.label)}</b><small>${esc(a.hint)}</small></button>`).join('')}</div></div></div>
        <div class="ds-card"><div class="ds-card-h"><h2>Stock alerts</h2><span class="ds-pill bad">${d.low.length}</span></div><div class="ds-card-b" style="padding-top:6px">${d.low.map((x, i) => { const p = Math.min(100, x.stock / x.reorder * 100); return `<div class="ds-bar-row"><span class="n">${esc(x.name)}</span><span class="ds-meter"><i class="${p < 15 ? 'b' : 'w'}" style="width:${Math.max(3, p)}%;animation-delay:${i * 90}ms"></i></span><span class="q">${Math.round(x.stock)}/${Math.round(x.reorder)}</span></div>` }).join('') || '<p class="ds-empty">Every item is above its reorder level.</p>'}</div></div>
        <div class="ds-card"><div class="ds-card-h"><h2>Expiring soon</h2><span class="hint">expired or within 90 days</span></div><div class="ds-card-b" style="padding-top:6px">${d.expiring.map((x) => `<div class="ds-bar-row"><span class="n">${esc(x.name)}<small>${esc(x.batch || '—')} · ${Math.round(x.qty)} in stock</small></span>${tag(x.expiry)}</div>`).join('') || '<p class="ds-empty">No batches expire in the next 90 days.</p>'}</div></div>
      </div>
    </div></div>`
  host.querySelectorAll<HTMLButtonElement>('[data-home]').forEach((b) => b.addEventListener('click', () => {
    const k = b.dataset.home!
    // resolved at the moment of the click: the user's menu rights may have changed since the Home was drawn
    if (k === 'reports') openReports(); else actionsNow()[+k]?.run()
  }))
  // count-up (always ends on the real value), chart hover
  if (animate && !matchMedia('(prefers-reduced-motion: reduce)').matches && document.visibilityState === 'visible') {
    host.querySelectorAll<HTMLElement>('.ds-kpi .v').forEach((el) => {
      const to = +el.dataset.to!, t0 = performance.now()
      const step = (t: number) => { const p = Math.min(1, (t - t0) / 900); el.textContent = rs0(to * (1 - Math.pow(1 - p, 3))); if (p < 1) requestAnimationFrame(step) }
      requestAnimationFrame(step); setTimeout(() => { el.textContent = rs0(to) }, 1200)
    })
  }
  const svg = host.querySelector<SVGSVGElement>('.ds-chart svg'), tip = host.querySelector<HTMLElement>('.ds-tip'), hair = host.querySelector<SVGLineElement>('.ds-chart .hair')
  if (svg && tip && hair && d.series.length) {
    const W = 640, P = [30, 10, 26, 46], n = d.series.length
    svg.addEventListener('pointermove', (e) => {
      const r = svg.getBoundingClientRect(), sx = (e.clientX - r.left) / r.width * W
      const i = Math.max(0, Math.min(n - 1, Math.round((sx - P[3]) / ((W - P[1] - P[3]) / Math.max(1, n - 1)))))
      const xi = P[3] + i * (W - P[1] - P[3]) / Math.max(1, n - 1)
      hair.setAttribute('x1', String(xi)); hair.setAttribute('x2', String(xi)); hair.style.opacity = '1'
      tip.hidden = false; tip.style.left = `${xi / W * r.width}px`; tip.style.top = '20px'
      const s = d.series[i]
      tip.innerHTML = `<b>${fmtDay(s.d, { day: 'numeric', month: 'short' })}</b><br>Sales ${rs0(s.sales)}<br>Purchases ${rs0(s.purchases)}`
    })
    svg.addEventListener('pointerleave', () => { tip.hidden = true; hair.style.opacity = '0' })
  }
}

export const HOME_CSS = `
.ds-home-host {position:absolute;inset:0;overflow:auto;background:var(--p-canvas);color:var(--p-text);font:calc(14px * var(--p-scale)) / 1.5 var(--p-font);z-index:3;padding:20px 16px 40px;}
.ds-home-host[hidden] {display:none;}
.ds-i {width:18px;height:18px;flex:none;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round;}
.ds-i.s {width:15px;height:15px;}
.ds-home.ds-enter {animation:ds-up .4s var(--p-ease);}
.ds-home.ds-enter .ds-stagger>* {animation:ds-up .5s var(--p-ease) both;animation-delay:calc(var(--i,0) * 55ms);}
.ds-hello {display:flex;align-items:flex-end;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-bottom:18px;}
.ds-hello h2 {font-size:26px;margin:0;letter-spacing:-.02em;}
.ds-hello p {margin:4px 0 0;color:var(--p-muted);}
.ds-hello-actions {display:flex;gap:8px;flex-wrap:wrap;}
.ds-btn {display:inline-flex;align-items:center;gap:8px;min-height:40px;padding:0 16px;border-radius:9px;border:1px solid var(--p-line);background:var(--p-surface);color:var(--p-text);font:500 calc(14px * var(--p-scale)) var(--p-font);cursor:pointer;transition:transform .12s,background .15s,box-shadow .2s;}
.ds-btn:hover {background:var(--p-sunk);}
.ds-btn:active {transform:scale(.97);}
.ds-btn.primary {background:linear-gradient(180deg,var(--p-accent-2),var(--p-accent));border-color:var(--p-accent);color:var(--p-on-accent);box-shadow:0 6px 18px var(--p-glow);}
.ds-card {background:var(--p-surface);border:1px solid var(--p-hair);border-radius:14px;box-shadow:var(--p-shadow);min-width:0;transition:box-shadow .25s,transform .25s,border-color .25s;}
.ds-lift:hover {transform:translateY(-3px);box-shadow:0 14px 40px rgb(16 24 32 / .14);border-color:var(--p-line);}
.ds-card-h {display:flex;align-items:center;gap:10px;padding:14px 18px;border-bottom:1px solid var(--p-hair);flex-wrap:wrap;}
.ds-card-h h2 {font-size:15px;margin:0;font-weight:600;}
.ds-card-h .hint {color:var(--p-muted);font-size:12.5px;}
.ds-card-h .grow {flex:1;}
.ds-card-b {padding:18px;}
.ds-kpis {display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px;}
@media (max-width:1050px){.ds-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media (max-width:560px){.ds-kpis{grid-template-columns:minmax(0,1fr)}}
.ds-kpi {padding:16px 18px;position:relative;overflow:hidden;}
.ds-kpi .k {font-size:12.5px;color:var(--p-muted);font-weight:500;display:flex;align-items:center;gap:8px;}
.ds-kpi .ki,.ds-qa .qi {width:28px;height:28px;border-radius:8px;display:grid;place-items:center;background:var(--p-selected);color:var(--p-accent);}
.ds-kpi .v {font:600 26px/1.2 var(--p-mono);margin:10px 0 2px;letter-spacing:-.02em;font-variant-numeric:tabular-nums;}
.ds-kpi .d {font-size:12px;font-weight:500;color:var(--p-muted);}
.ds-kpi .d.up {color:var(--p-ok);} .ds-kpi .d.down {color:var(--p-danger);}
.ds-spark {position:absolute;right:12px;bottom:12px;width:96px;height:36px;overflow:visible;}
.ds-spark .l {fill:none;stroke:var(--p-accent);stroke-width:2;stroke-dasharray:300;stroke-dashoffset:0;}
.ds-enter .ds-spark .l {stroke-dashoffset:300;animation:ds-draw 1.4s var(--p-ease) .3s forwards;}
.ds-spark .a {fill:var(--p-accent);opacity:.12;}
.ds-grid2 {display:grid;grid-template-columns:minmax(0,1fr) 340px;gap:18px;align-items:start;margin-top:18px;}
@media (max-width:1050px){.ds-grid2{grid-template-columns:minmax(0,1fr)}}
.ds-stack {display:flex;flex-direction:column;gap:18px;min-width:0;}
.ds-legend {display:flex;gap:16px;font-size:12px;color:var(--p-muted);}
.ds-legend i {display:inline-block;width:12px;height:3px;border-radius:2px;margin-right:6px;vertical-align:middle;}
.ds-chart {position:relative;}
.ds-chart svg {width:100%;height:240px;display:block;overflow:visible;}
.ds-chart .g {stroke:var(--p-hair);stroke-width:1;}
.ds-chart text {fill:var(--p-faint);font:11px var(--p-mono);}
.ds-chart .s1 {fill:none;stroke:var(--p-accent);stroke-width:2.5;stroke-dasharray:1600;stroke-dashoffset:0;}
.ds-enter .ds-chart .s1 {stroke-dashoffset:1600;animation:ds-draw 1.8s var(--p-ease) .2s forwards;}
.ds-chart .s2 {fill:none;stroke:#7a8fd0;stroke-width:2;stroke-dasharray:6 5;opacity:.9;}
.ds-chart .ar {fill:url(#ds-ga);}
.ds-chart .end {fill:var(--p-accent);stroke:var(--p-surface);stroke-width:2;}
.ds-chart .hair {stroke:var(--p-line);stroke-dasharray:3 3;opacity:0;}
.ds-tip {position:absolute;pointer-events:none;background:var(--p-text);color:var(--p-surface);padding:7px 10px;border-radius:8px;font-size:12px;box-shadow:var(--p-shadow-lg);transform:translateX(-50%);white-space:nowrap;}
.ds-timeline {list-style:none;margin:0;padding:0;}
.ds-timeline li {display:flex;gap:12px;padding:10px 0;position:relative;}
.ds-timeline li::before {content:"";position:absolute;left:13px;top:36px;bottom:-6px;width:2px;background:var(--p-hair);}
.ds-timeline li:last-child::before {display:none;}
.ds-timeline .tdot {width:28px;height:28px;border-radius:50%;display:grid;place-items:center;flex:none;background:var(--p-selected);color:var(--p-accent);}
.ds-timeline small {color:var(--p-faint);}
.ds-qa {display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;}
.ds-qa button {display:flex;flex-direction:column;align-items:flex-start;gap:8px;padding:14px;border-radius:12px;border:1px solid var(--p-hair);background:var(--p-surface);color:var(--p-text);font:inherit;cursor:pointer;text-align:left;transition:transform .2s var(--p-spring),border-color .2s,box-shadow .2s;}
.ds-qa button:hover:not(:disabled) {transform:translateY(-3px);border-color:var(--p-accent);box-shadow:0 8px 24px var(--p-glow);}
.ds-qa button:disabled {opacity:.45;cursor:not-allowed;}
.ds-qa small {color:var(--p-muted);}
.ds-pill {display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:500;padding:2px 10px;border-radius:999px;background:var(--p-sunk);color:var(--p-muted);}
.ds-pill::before {content:"";width:6px;height:6px;border-radius:50%;background:currentColor;}
.ds-pill.bad {background:var(--p-danger-soft);color:var(--p-danger);}
.ds-bar-row {display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--p-hair);font-size:13px;}
.ds-bar-row:last-child {border-bottom:0;}
.ds-bar-row .n {flex:0 0 140px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.ds-bar-row .n small {display:block;color:var(--p-faint);font-size:11.5px;}
.ds-bar-row:has(.ds-tag) .n {flex:1;}
.ds-bar-row .q {font:12px var(--p-mono);width:64px;text-align:right;}
.ds-meter {flex:1;height:7px;border-radius:999px;background:var(--p-sunk);overflow:hidden;}
.ds-meter i {display:block;height:100%;border-radius:999px;background:var(--p-accent);transform-origin:left;}
.ds-enter .ds-meter i {animation:ds-grow-x 1s var(--p-ease) both;}
.ds-meter i.w {background:var(--p-warn);} .ds-meter i.b {background:var(--p-danger);}
.ds-tag {font-size:11px;padding:1px 7px;border-radius:5px;background:var(--p-sunk);color:var(--p-muted);font-weight:500;white-space:nowrap;}
.ds-tag.warn {background:var(--p-warn-soft);color:var(--p-warn);} .ds-tag.bad {background:var(--p-danger-soft);color:var(--p-danger);}
.ds-empty {margin:0;color:var(--p-muted);}
@media (max-width:760px){.ds-hello{flex-direction:column;align-items:flex-start}.ds-hello-actions{margin-top:4px}}
`

/** Greys or enables the quick actions as the live menu allows them now. */
export function syncHomeActions(host: HTMLElement, actions: HomeAction[]): void {
  host.querySelectorAll<HTMLButtonElement>('.ds-qa [data-home]').forEach((button) => {
    const action = actions[+button.dataset.home!]
    if (action) button.disabled = !!action.disabled
  })
  const sale = host.querySelector<HTMLButtonElement>('.ds-hello [data-home="0"]')
  if (sale && actions[0]) sale.disabled = !!actions[0].disabled
}
