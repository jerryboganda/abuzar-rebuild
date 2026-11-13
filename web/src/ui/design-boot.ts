// Sign-in screen of the approved design (Modern interface only).  The original login window keeps its controls and scripts; this
// adds the brand panel beside it and the design system's look until the Modern workspace takes over after authentication.
import { DESIGN_CSS } from './design-system.ts'
import { FX_CSS, installRipple, toast } from './ds-fx.ts'

type Query = (sql: string) => Promise<unknown[][]>
interface Figures { items: number; users: number; fbr: boolean }
const FIGURES_KEY = 'trader.ds.loginFigures'
function readFigures(): Figures | null {
  try { const v = JSON.parse(localStorage.getItem(FIGURES_KEY) ?? 'null') as Figures | null; return v && Number.isFinite(v.items) && Number.isFinite(v.users) ? v : null } catch { return null }
}

/** Reads the sign-in screen's figures from the signed-in session and keeps them on this computer for the next sign-in. */
export async function saveLoginFigures(query: Query): Promise<void> {
  try {
    const [items, users, fiscal] = await Promise.all([
      query('SELECT count(*) FROM dbo.item WHERE active = 1'),
      query(`SELECT count(*) FROM dbo.users WHERE upper(coalesce(active::text, 'Y')) = 'Y'`),
      query(`SELECT prefvalue FROM dbo.softwarepreferences WHERE lower(name) = 'fiscalizationmethod'`).catch(() => [] as unknown[][]),
    ])
    const figures: Figures = { items: Number(items[0]?.[0] ?? 0), users: Number(users[0]?.[0] ?? 0), fbr: Number(fiscal[0]?.[0] ?? 0) > 0 }
    localStorage.setItem(FIGURES_KEY, JSON.stringify(figures))
  } catch { /* decoration only */ }
}

export function startDesignBoot(): () => void {
  const style = document.createElement('style')
  style.textContent = DESIGN_CSS + FX_CSS + BOOT_CSS
  installRipple()
  document.head.append(style)
  const body = document.body
  body.classList.add('ds-boot')
  const dark = matchMedia('(prefers-color-scheme: dark)')
  const theme = () => { body.dataset.theme = dark.matches ? 'dark' : 'light' }
  theme()
  dark.addEventListener('change', theme)
  const art = document.createElement('aside')
  art.className = 'ds-login-art'
  art.setAttribute('aria-hidden', 'true')
  art.innerHTML = `<span class="ds-blob" style="width:420px;height:420px;background:#0f6b6f;top:-80px;left:-60px"></span>
    <span class="ds-blob" style="width:360px;height:360px;background:#1f8f7a;bottom:-120px;right:-40px;animation-delay:-5s"></span>
    <span class="ds-blob" style="width:240px;height:240px;background:#2b5f8f;top:40%;left:45%;animation-delay:-9s;opacity:.35"></span>
    <div class="ds-login-brand"><span class="ds-login-mark">TA</span>WASEELA · Trader</div>
    <div><h1>Every sale, purchase and batch in one calm place.</h1>
    <p>Pharmacy retail and wholesale with FBR fiscal invoices, batch and expiry control, and accounts that post themselves.</p>
    <div class="ds-login-feats" hidden></div></div>
    <small style="color:var(--p-chrome-muted)">Abuzar Consultancy · Trader v2</small>`
  body.append(art)
  // the approved design's three figures: there is no database session before sign-in, so the figures of the last sign-in on this
  // computer are shown (saved by `saveLoginFigures` after each sign-in)
  const feats = art.querySelector<HTMLElement>('.ds-login-feats')!
  const saved = readFigures()
  if (saved) {
    feats.innerHTML = `<div><b class="num">${saved.items.toLocaleString('en-PK')}</b><span>items in the catalogue</span></div>
      <div><b class="num">${saved.users.toLocaleString('en-PK')}</b><span>staff accounts</span></div>
      <div><b>FBR</b><span>${saved.fbr ? 'fiscal invoicing ready' : 'fiscal invoicing not set up'}</span></div>`
    feats.hidden = false
  }
  // Caps Lock: shown under the password field while it is on (the approved design's hint and toast)
  const caps = document.createElement('p')
  caps.className = 'ds-caps'
  caps.hidden = true
  caps.textContent = 'Caps Lock is on.'
  let warned = false
  const onKey = (event: KeyboardEvent) => {
    const login = document.querySelector<HTMLElement>('.pbwin[data-win=w_login1] > .client')
    if (!login || typeof event.getModifierState !== 'function') return
    if (caps.parentElement !== login) login.append(caps)
    const on = event.getModifierState('CapsLock')
    caps.hidden = !on
    if (on && !warned && (event.target as HTMLElement | null)?.closest?.('[data-obj=password]')) { warned = true; toast('Caps Lock is on', 'alert') }
    if (!on) warned = false
  }
  document.addEventListener('keyup', onKey, true)
  return () => {
    document.removeEventListener('keyup', onKey, true)
    caps.remove()
    dark.removeEventListener('change', theme)
    art.remove()
    style.remove()
    body.classList.remove('ds-boot')
    delete body.dataset.theme
  }
}

const BOOT_CSS = `
body.ds-boot .ds-login-feats {display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin-top:28px;max-width:560px;}
body.ds-boot .ds-login-feats[hidden] {display:none;}
body.ds-boot .ds-login-feats > div {border:1px solid var(--p-chrome-line,#2a3f46);background:rgb(255 255 255 / .04);border-radius:12px;padding:12px;backdrop-filter:blur(6px);}
body.ds-boot .ds-login-feats b {display:block;font-size:20px;}
body.ds-boot .ds-login-feats .num {font-family:var(--p-mono);}
body.ds-boot .ds-login-feats span {font-size:12px;color:var(--p-chrome-muted);}
body.ds-boot .pbwin[data-win=w_login1] .ds-caps {position:absolute;left:0;top:140px;margin:0;font:500 12px var(--p-font);color:var(--p-warn);}
body.ds-boot .pbwin[data-win=w_login1] .ds-caps[hidden] {display:none;}
`
