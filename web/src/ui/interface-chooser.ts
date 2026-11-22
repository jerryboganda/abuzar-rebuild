// The start page of the web application: the user picks the interface before signing in.  Opening the bare address
// (https://pharmacy.polytronx.com/) shows it; a choice reloads the address with `?presentation=1` (Modern) or `?classic=1` (Classic),
// so a bookmark of either goes straight to its sign-in.  Development and test links that already name a mode, a window or a
// DataWindow (`presentation`, `classic`, `app`, `w`, `dw`, `live`, `autologin`) never see it.

const CHOICE_KEY = 'trader.interface'
const MODE_PARAMS = ['presentation', 'classic', 'app', 'w', 'dw', 'live', 'autologin']

export type InterfaceChoice = 'modern' | 'classic'

/** the address names no interface: the start page is shown */
export function needsInterfaceChoice(query: URLSearchParams): boolean {
  return !MODE_PARAMS.some((name) => query.has(name))
}

/** the address of the chosen interface (the other parameters of the address are kept) */
export function interfaceHref(choice: InterfaceChoice, location: { pathname: string; search: string; hash: string }): string {
  const query = new URLSearchParams(location.search)
  query.delete('presentation')
  query.delete('classic')
  query.set(choice === 'modern' ? 'presentation' : 'classic', '1')
  return `${location.pathname}?${query.toString()}${location.hash}`
}

function lastChoice(): InterfaceChoice | null {
  try {
    const value = localStorage.getItem(CHOICE_KEY)
    return value === 'modern' || value === 'classic' ? value : null
  } catch { return null }
}

function remember(choice: InterfaceChoice): void {
  try { localStorage.setItem(CHOICE_KEY, choice) } catch { /* a refused storage only loses the highlight next time */ }
}

const CSS = `
.ic-page {
  --c-canvas:#f3f5f7;--c-surface:#ffffff;--c-text:#18212b;--c-muted:#56636f;--c-line:#dde2e8;--c-accent:#0f6b6f;--c-accent-2:#12797d;
  --c-on-accent:#ffffff;--c-glow:rgb(15 107 111 / .28);--c-shadow:0 1px 2px rgb(16 24 32 / .06),0 12px 32px rgb(16 24 32 / .10);
  --c-classic:#d4d0c8;--c-classic-title:#0a246a;--c-chip:#e1f0ef;
  position:fixed;inset:0;overflow:auto;display:grid;place-items:center;padding:32px 16px;box-sizing:border-box;
  background:radial-gradient(1200px 600px at 10% -10%,rgb(15 107 111 / .14),transparent 60%),
    radial-gradient(900px 500px at 110% 110%,rgb(31 143 122 / .12),transparent 60%),var(--c-canvas);
  color:var(--c-text);font:15px/1.5 "IBM Plex Sans",system-ui,-apple-system,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased;
}
@media (prefers-color-scheme: dark) {
  .ic-page {
    --c-canvas:#0f1418;--c-surface:#161d23;--c-text:#e6ecf1;--c-muted:#a3b0bc;--c-line:#27323b;--c-accent:#4fb8b2;--c-accent-2:#6fd0c9;
    --c-on-accent:#06201f;--c-glow:rgb(79 184 178 / .3);--c-shadow:0 1px 2px rgb(0 0 0 / .4),0 12px 32px rgb(0 0 0 / .45);
    --c-classic:#b9b4aa;--c-chip:#163331;
  }
}
.ic-page * {box-sizing:border-box;}
.ic-wrap {width:min(980px,100%);display:grid;gap:28px;}
.ic-brand {display:flex;align-items:center;gap:14px;}
.ic-logo {width:48px;height:48px;border-radius:12px;display:grid;place-items:center;background:linear-gradient(135deg,var(--c-accent),#1f8f7a);
  color:#fff;font-weight:700;font-size:18px;letter-spacing:.02em;box-shadow:var(--c-shadow);}
.ic-brand b {display:block;font-size:20px;letter-spacing:.04em;}
.ic-brand span {color:var(--c-muted);font-size:13px;}
.ic-head h1 {margin:0 0 6px;font-size:clamp(24px,3.2vw,32px);line-height:1.2;font-weight:650;letter-spacing:-.01em;}
.ic-head p {margin:0;color:var(--c-muted);max-width:60ch;}
.ic-grid {display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,400px),1fr));gap:20px;}
.ic-card {position:relative;display:grid;gap:16px;align-content:start;text-align:left;padding:20px;border-radius:16px;cursor:pointer;
  background:var(--c-surface);color:inherit;font:inherit;border:1px solid var(--c-line);box-shadow:var(--c-shadow);
  transition:transform .25s cubic-bezier(.2,.8,.2,1),border-color .2s,box-shadow .25s;}
.ic-card:hover {transform:translateY(-3px);border-color:var(--c-accent);}
.ic-card:focus-visible {outline:none;border-color:var(--c-accent);box-shadow:0 0 0 1px var(--c-accent),0 0 0 5px var(--c-glow),var(--c-shadow);}
.ic-card[aria-current=true] {border-color:var(--c-accent);}
.ic-preview {height:190px;border-radius:10px;overflow:hidden;border:1px solid var(--c-line);background:var(--c-canvas);}
.ic-preview svg {display:block;width:100%;height:100%;}
.ic-title {display:flex;align-items:center;gap:10px;flex-wrap:wrap;}
.ic-title h2 {margin:0;font-size:19px;font-weight:650;}
.ic-chip {font-size:12px;font-weight:600;padding:2px 10px;border-radius:999px;background:var(--c-chip);color:var(--c-accent);}
.ic-card p {margin:0;color:var(--c-muted);font-size:14px;}
.ic-list {margin:0;padding:0;list-style:none;display:grid;gap:6px;font-size:14px;}
.ic-list li {display:flex;gap:8px;align-items:baseline;}
.ic-list li::before {content:"";flex:none;width:6px;height:6px;border-radius:50%;background:var(--c-accent);transform:translateY(-2px);}
.ic-go {justify-self:start;display:inline-flex;align-items:center;gap:8px;padding:10px 18px;border-radius:10px;font-weight:600;
  background:var(--c-accent);color:var(--c-on-accent);}
.ic-card.classic .ic-go {background:transparent;color:var(--c-accent);box-shadow:inset 0 0 0 1px var(--c-accent);}
.ic-card:hover .ic-go {filter:brightness(1.06);}
.ic-foot {color:var(--c-muted);font-size:13px;}
@media (prefers-reduced-motion: reduce) {.ic-card {transition:none;} .ic-card:hover {transform:none;}}
`

const MODERN_ART = `<svg viewBox="0 0 400 190" aria-hidden="true" preserveAspectRatio="xMinYMin slice">
  <rect width="400" height="190" fill="var(--c-canvas)"/>
  <rect width="400" height="26" fill="#13232a"/>
  <rect x="10" y="7" width="12" height="12" rx="3" fill="#4fb8b2"/><rect x="28" y="10" width="54" height="6" rx="3" fill="#e7f0f1"/>
  <rect x="150" y="8" width="110" height="10" rx="5" fill="#2a3f46"/>
  <rect x="14" y="38" width="118" height="54" rx="8" fill="var(--c-surface)" stroke="var(--c-line)"/>
  <rect x="24" y="50" width="40" height="5" rx="2.5" fill="var(--c-muted)" opacity=".6"/><rect x="24" y="62" width="64" height="12" rx="4" fill="var(--c-text)" opacity=".85"/>
  <polyline points="80,84 92,76 102,80 114,66 124,70" fill="none" stroke="var(--c-accent)" stroke-width="2.5" stroke-linecap="round"/>
  <rect x="141" y="38" width="118" height="54" rx="8" fill="var(--c-surface)" stroke="var(--c-line)"/>
  <rect x="151" y="50" width="40" height="5" rx="2.5" fill="var(--c-muted)" opacity=".6"/><rect x="151" y="62" width="58" height="12" rx="4" fill="var(--c-text)" opacity=".85"/>
  <rect x="268" y="38" width="118" height="54" rx="8" fill="var(--c-surface)" stroke="var(--c-line)"/>
  <rect x="278" y="50" width="40" height="5" rx="2.5" fill="var(--c-muted)" opacity=".6"/><rect x="278" y="62" width="70" height="12" rx="4" fill="var(--c-text)" opacity=".85"/>
  <rect x="14" y="102" width="245" height="76" rx="8" fill="var(--c-surface)" stroke="var(--c-line)"/>
  <path d="M26 166 L60 150 L94 156 L128 128 L162 138 L196 118 L246 126" fill="none" stroke="var(--c-accent)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M26 166 L60 150 L94 156 L128 128 L162 138 L196 118 L246 126 L246 172 L26 172Z" fill="var(--c-accent)" opacity=".12"/>
  <rect x="268" y="102" width="118" height="76" rx="8" fill="var(--c-surface)" stroke="var(--c-line)"/>
  <rect x="278" y="114" width="98" height="22" rx="6" fill="var(--c-accent)"/><rect x="278" y="142" width="98" height="10" rx="4" fill="var(--c-line)"/><rect x="278" y="158" width="70" height="10" rx="4" fill="var(--c-line)"/>
</svg>`

const CLASSIC_ART = `<svg viewBox="0 0 400 190" aria-hidden="true" preserveAspectRatio="xMinYMin slice">
  <rect width="400" height="190" fill="#808080"/>
  <rect x="0" y="0" width="400" height="20" fill="#d4d0c8"/>
  <text x="8" y="14" font-size="10" font-family="Tahoma,Arial,sans-serif" fill="#000">File   Purchase   Sales   Reports   Basic Data</text>
  <rect x="0" y="20" width="400" height="18" fill="#d4d0c8" stroke="#a0a0a0"/>
  <g fill="#ece9d8" stroke="#808080"><rect x="6" y="23" width="14" height="12"/><rect x="24" y="23" width="14" height="12"/><rect x="42" y="23" width="14" height="12"/><rect x="60" y="23" width="14" height="12"/></g>
  <rect x="60" y="50" width="280" height="128" fill="#d4d0c8" stroke="#404040"/>
  <rect x="62" y="52" width="276" height="16" fill="#0a246a"/>
  <text x="68" y="64" font-size="10" font-weight="700" font-family="Tahoma,Arial,sans-serif" fill="#fff">Cash Sale</text>
  <g font-size="9" font-family="Tahoma,Arial,sans-serif" fill="#000"><text x="72" y="86">Customer:</text><text x="72" y="104">Date:</text></g>
  <g fill="#fff" stroke="#808080"><rect x="122" y="78" width="120" height="12"/><rect x="122" y="96" width="80" height="12"/></g>
  <rect x="70" y="116" width="260" height="50" fill="#fff" stroke="#808080"/>
  <g stroke="#c0c0c0"><line x1="70" y1="128" x2="330" y2="128"/><line x1="70" y1="140" x2="330" y2="140"/><line x1="70" y1="152" x2="330" y2="152"/><line x1="160" y1="116" x2="160" y2="166"/><line x1="240" y1="116" x2="240" y2="166"/></g>
  <rect x="70" y="116" width="260" height="12" fill="#d4d0c8" stroke="#808080"/>
</svg>`

/** shows the start page; the choice reloads the address in the chosen interface */
export function showInterfaceChooser(): void {
  const style = document.createElement('style')
  style.textContent = CSS
  document.head.append(style)
  document.title = 'Waseela - choose your interface'
  const last = lastChoice()
  const page = document.createElement('main')
  page.className = 'ic-page'
  page.innerHTML = `<div class="ic-wrap">
    <div class="ic-brand"><div class="ic-logo">TA</div><div><b>WASEELA</b><span>Trader suite · Abuzar V2</span></div></div>
    <div class="ic-head"><h1>How would you like to work today?</h1>
      <p>Both open the same data, the same screens and the same reports. Pick the look you prefer; you can come back here any time.</p></div>
    <div class="ic-grid">
      <button type="button" class="ic-card modern" data-choice="modern">
        <div class="ic-preview">${MODERN_ART}</div>
        <div class="ic-title"><h2>Modern</h2><span class="ic-chip">Recommended</span></div>
        <p>The new design: a home dashboard, search for screens and items, light and dark themes.</p>
        <ul class="ic-list"><li>Dashboard with today's sales and purchases</li><li>Quick search across screens, items and invoices</li><li>Light or dark theme, larger touch-friendly controls</li></ul>
        <span class="ic-go">Open Modern →</span>
      </button>
      <button type="button" class="ic-card classic" data-choice="classic">
        <div class="ic-preview">${CLASSIC_ART}</div>
        <div class="ic-title"><h2>Classic</h2><span class="ic-chip">Original layout</span></div>
        <p>The familiar Trader windows, exactly as in the desktop program: same menus, toolbars and keys.</p>
        <ul class="ic-list"><li>Original menus, toolbar and window layout</li><li>Same keyboard shortcuts as before</li><li>Best for users trained on the desktop program</li></ul>
        <span class="ic-go">Open Classic →</span>
      </button>
    </div>
    <div class="ic-foot" aria-live="polite"></div>
  </div>`
  const foot = page.querySelector<HTMLElement>('.ic-foot')!
  if (last) {
    foot.textContent = `Last time you used ${last === 'modern' ? 'Modern' : 'Classic'}.`
    page.querySelector(`[data-choice=${last}]`)?.setAttribute('aria-current', 'true')
  }
  for (const card of page.querySelectorAll<HTMLButtonElement>('[data-choice]')) {
    card.addEventListener('click', () => {
      const choice = card.dataset.choice as InterfaceChoice
      remember(choice)
      foot.textContent = `Opening ${choice === 'modern' ? 'Modern' : 'Classic'}…`
      location.assign(interfaceHref(choice, location))
    })
  }
  document.getElementById('desktop')?.setAttribute('hidden', '')
  document.body.append(page)
  page.querySelector<HTMLButtonElement>(`[data-choice=${last ?? 'modern'}]`)?.focus()
}
