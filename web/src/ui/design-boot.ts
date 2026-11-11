// Sign-in screen of the approved design (Modern interface only).  The original login window keeps its controls and scripts; this
// adds the brand panel beside it and the design system's look until the Modern workspace takes over after authentication.
import { DESIGN_CSS } from './design-system.ts'

export function startDesignBoot(): () => void {
  const style = document.createElement('style')
  style.textContent = DESIGN_CSS
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
    <p>Pharmacy retail and wholesale with FBR fiscal invoices, batch and expiry control, and accounts that post themselves.</p></div>
    <small style="color:var(--p-chrome-muted)">Abuzar Consultancy · Trader v2</small>`
  body.append(art)
  return () => {
    dark.removeEventListener('change', theme)
    art.remove()
    style.remove()
    body.classList.remove('ds-boot')
    delete body.dataset.theme
  }
}
