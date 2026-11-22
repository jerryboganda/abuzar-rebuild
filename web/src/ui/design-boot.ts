// Sign-in screen of the approved design (Modern interface only).  The original login window keeps its controls and scripts; this
// adds the brand panel beside it and the design system's look until the Modern workspace takes over after authentication.
import { DESIGN_CSS } from './design-system.ts'
import { FX_CSS, installRipple, toast } from './ds-fx.ts'
import { interfaceHref } from './interface-chooser.ts'

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
    <div class="ds-login-feats" hidden></div>
    <ul class="ds-login-points"><li><i>FBR</i>Fiscal invoices sent to FBR as you sell</li><li><i>Rx</i>Batch, expiry and narcotics control on every line</li><li><i>₨</i>Ledgers and receivables that post themselves</li></ul></div>
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
    art.querySelector<HTMLElement>('.ds-login-points')!.hidden = true
  }
  // the way back to the start page or to the other interface (the start page chooses one; a bookmark may have skipped it)
  const swap = document.createElement('nav')
  swap.className = 'ds-login-switch'
  swap.setAttribute('aria-label', 'Interface')
  const classic = document.createElement('a')
  classic.href = interfaceHref('classic', location)
  classic.textContent = 'Use the Classic interface'
  const start = document.createElement('a')
  start.href = location.pathname
  start.textContent = 'Start page'
  swap.append(classic, start)
  body.append(swap)
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
    swap.remove()
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
body.ds-boot .pbwin[data-win=w_login1] .ds-caps {position:absolute;left:0;top:150px;margin:0;font:500 12px var(--p-font);color:var(--p-warn);}
body.ds-boot .pbwin[data-win=w_login1] .ds-caps[hidden] {display:none;}

/* ---------- sign-in, 2026-11-23 refresh: the form on a card, icons in the fields, the brand's type everywhere ---------- */
body.ds-boot #desktop {background:radial-gradient(900px 600px at 100% 0%,var(--p-selected),transparent 60%),var(--p-canvas)!important;}
body.ds-boot .ds-login-art {background:linear-gradient(160deg,#0f2329 0%,#0a1316 70%);}
body.ds-boot .ds-login-art::before {content:"";position:absolute;inset:0;background-image:radial-gradient(rgb(255 255 255 / .07) 1px,transparent 1px);background-size:22px 22px;
  mask-image:linear-gradient(180deg,#000,transparent 85%);-webkit-mask-image:linear-gradient(180deg,#000,transparent 85%);pointer-events:none;}
body.ds-boot .ds-login-art h1 {font-size:clamp(30px,3.6vw,52px);font-weight:650;}
body.ds-boot .ds-login-art p {font-size:clamp(14px,1.1vw,16px);line-height:1.6;}
body.ds-boot .ds-login-points {list-style:none;margin:28px 0 0;padding:0;display:grid;gap:12px;max-width:460px;}
body.ds-boot .ds-login-points li {display:flex;gap:12px;align-items:center;padding:12px 14px;border-radius:12px;border:1px solid var(--p-chrome-line);
  background:rgb(255 255 255 / .04);backdrop-filter:blur(6px);font-size:14px;color:var(--p-chrome-text);}
body.ds-boot .ds-login-points i {flex:none;width:32px;height:32px;border-radius:9px;display:grid;place-items:center;background:rgb(79 184 178 / .16);color:#6fd0c9;font-style:normal;font-weight:700;font-size:13px;}
body.ds-boot .ds-login-points[hidden] {display:none;}
body.ds-boot .ds-login-switch {position:fixed;top:20px;right:28px;z-index:5;display:flex;gap:6px;align-items:center;font:500 13px var(--p-font);color:var(--p-muted);}
body.ds-boot .ds-login-switch a {color:var(--p-accent);text-decoration:none;padding:6px 10px;border-radius:8px;border:1px solid transparent;}
body.ds-boot .ds-login-switch a:hover {border-color:var(--p-hair);background:var(--p-surface);}
body.ds-boot .ds-login-switch a:focus-visible {outline:2px solid var(--p-accent);outline-offset:2px;}
/* the card */
body.ds-boot .pbwin[data-win=w_login1] {left:calc(52vw + (48vw - 440px) / 2)!important;top:max(24px,calc(50vh - 236px))!important;width:440px!important;
  padding:36px 36px 28px!important;box-sizing:border-box;background:var(--p-surface)!important;border:1px solid var(--p-hair)!important;border-radius:20px;
  box-shadow:var(--p-shadow-lg)!important;animation:ds-pop .35s var(--p-ease);}
body.ds-boot .pbwin[data-win=w_login1] > .tbar {padding:0 0 22px;}
body.ds-boot .pbwin[data-win=w_login1] > .tbar .ttl::before {content:"Welcome back";font:650 28px/1.15 var(--p-font);}
body.ds-boot .pbwin[data-win=w_login1] > .tbar .ttl::after {content:"Sign in with your Trader user name to continue.";margin-top:6px;font-size:14.5px;}
body.ds-boot .pbwin[data-win=w_login1] > .client {height:282px!important;min-height:282px;flex:none!important;}
body.ds-boot .pbwin[data-win=w_login1] {display:flex!important;flex-direction:column;}
body.ds-boot .pbwin[data-win=w_login1] .ctl:has([data-obj=login]) .o-text {font:600 13px var(--p-font)!important;color:var(--p-text)!important;}
body.ds-boot .pbwin[data-win=w_login1] [data-obj=password_t] {top:80px!important;}
body.ds-boot .pbwin[data-win=w_login1] :is([data-obj=login],[data-obj=password]),body.ds-boot .pbwin[data-win=w_login1] .dw-edit {
  height:46px!important;padding:11px 14px 11px 42px!important;border-radius:10px!important;font:15px var(--p-font)!important;
  background-repeat:no-repeat!important;background-position:14px 50%!important;background-size:18px 18px!important;}
body.ds-boot .pbwin[data-win=w_login1] [data-obj=login] {top:24px!important;}
body.ds-boot .pbwin[data-win=w_login1] [data-obj=password] {top:104px!important;}
body.ds-boot .pbwin[data-win=w_login1] :is([data-obj=login],.dw-edit[data-for=login]),body.ds-boot .pbwin[data-win=w_login1] .dw-edit:not([type=password]) {
  background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%238c99a5' stroke-width='2' stroke-linecap='round'%3E%3Ccircle cx='12' cy='8' r='4'/%3E%3Cpath d='M4 21c0-4 4-6 8-6s8 2 8 6'/%3E%3C/svg%3E")!important;}
body.ds-boot .pbwin[data-win=w_login1] :is([data-obj=password],.dw-edit[type=password]) {
  background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%238c99a5' stroke-width='2' stroke-linecap='round'%3E%3Crect x='4' y='11' width='16' height='10' rx='2'/%3E%3Cpath d='M8 11V8a4 4 0 0 1 8 0v3'/%3E%3C/svg%3E")!important;}
body.ds-boot .pbwin[data-win=w_login1] > .client > button.ctl {top:184px!important;height:48px!important;font:600 15px var(--p-font)!important;border-radius:10px!important;}
body.ds-boot .pbwin[data-win=w_login1] > .client > button.ctl:first-of-type {width:calc(66% - 5px)!important;}
body.ds-boot .pbwin[data-win=w_login1] > .client > button.ctl:last-of-type {left:66%!important;width:34%!important;}
body.ds-boot .pbwin[data-win=w_login1] > .client > button.ctl:first-of-type::after {content:" →";}
body.ds-boot .pbwin[data-win=w_login1] > .client > button.ctl:focus-visible {outline:2.5px solid var(--p-accent);outline-offset:2px;}
body.ds-boot .pbwin[data-win=w_login1] > .client::after {content:"Forgot your password? An administrator can reset it in Manage › Users.";top:250px;font-size:12.5px;line-height:1.4;color:var(--p-muted);text-wrap:balance;}
body.ds-boot .pbwin[data-win=w_login1] .ds-caps {top:156px;}
@media (max-width:860px) {
  body.ds-boot .pbwin[data-win=w_login1] {left:max(16px,calc(50vw - 220px))!important;width:min(440px,calc(100vw - 32px))!important;top:max(72px,calc(50vh - 236px))!important;padding:28px 22px 22px!important;}
  body.ds-boot .ds-login-switch {right:12px;top:12px;}
}
@media (prefers-reduced-motion: reduce) {body.ds-boot .pbwin[data-win=w_login1] {animation:none;}}
`
