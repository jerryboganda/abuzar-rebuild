// Feedback of the approved design: toasts, the press ripple on buttons and the confetti on a posted document.  Display only: nothing
// here changes data or runs a command.

const reduce = () => matchMedia('(prefers-reduced-motion: reduce)').matches || !!document.querySelector('.presentation-ui.ds-no-motion')

const ICON: Record<string, string> = {
  ok: '<path d="M20 6 9 17l-5-5"/>',
  alert: '<path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
  auto: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.9 1.9 0 0 0 3.4 0"/>',
  print: '<path d="M6 9V3h12v6M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="7"/>',
  dl: '<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>',
  star: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.2l1.1-6.2L3 9.6l6.2-.9z"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
}

/** A short notice in the corner of the screen (the approved design's toast); it disappears by itself. */
export function toast(text: string, icon: keyof typeof ICON | string = 'ok'): void {
  // an open modal dialog sits in the top layer: the toast is drawn inside it so it is not dimmed by the backdrop
  const host = [...document.querySelectorAll<HTMLDialogElement>('dialog[open]')].filter((dialog) => dialog.matches(':modal')).at(-1) ?? document.body
  let box = host.querySelector<HTMLElement>(':scope > .ds-toasts')
  if (!box) {
    box = document.createElement('div')
    box.className = 'ds-toasts'
    box.setAttribute('aria-live', 'polite')
    host.append(box)
  }
  const theme = document.querySelector<HTMLElement>('.presentation-ui')?.dataset.theme ?? document.body.dataset.theme
  if (theme) box.dataset.theme = theme
  const item = document.createElement('div')
  item.className = 'ds-toast'
  item.innerHTML = `<span class="tic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[icon] ?? ICON.ok}</svg></span><span></span>`
  item.lastElementChild!.textContent = text
  box.append(item)
  setTimeout(() => { item.classList.add('out'); setTimeout(() => item.remove(), 260) }, 2600)
}

/** The burst of the approved design when a document is posted. */
export function confetti(x: number, y: number): void {
  if (reduce()) return
  const colours = ['#0f6b6f', '#4fb8b2', '#d9a400', '#1f8f7a', '#7a8fd0']
  for (let i = 0; i < 34; i++) {
    const piece = document.createElement('span')
    piece.className = 'ds-confetti'
    piece.style.left = `${x}px`
    piece.style.top = `${y}px`
    piece.style.background = colours[i % colours.length]
    document.body.append(piece)
    const angle = Math.random() * Math.PI * 2, speed = 120 + Math.random() * 180
    piece.animate([{ transform: 'translate(0,0) rotate(0)', opacity: 1 },
      { transform: `translate(${Math.cos(angle) * speed}px,${Math.sin(angle) * speed + 160}px) rotate(${Math.random() * 720}deg)`, opacity: 0 }],
    { duration: 1100 + Math.random() * 500, easing: 'cubic-bezier(.2,.7,.3,1)' }).onfinish = () => piece.remove()
  }
}

const RIPPLE = '.presentation-ui .tb, .presentation-ui .ds-btn, .presentation-ui .ds-tile, .presentation-ui .ds-qa button, .presentation-ui .ds-change .quick button, .presentation-settings .ds-tcard, body.ds-boot .pbwin[data-win=w_login1] button'
let rippleOn = false
/** The press ripple of the approved design on toolbar buttons, cards and the main buttons (installed once). */
export function installRipple(): void {
  if (rippleOn) return
  rippleOn = true
  document.addEventListener('pointerdown', (event) => {
    const button = (event.target as HTMLElement | null)?.closest<HTMLElement>(RIPPLE)
    if (!button || (button as HTMLButtonElement).disabled || reduce()) return
    button.classList.add('ds-ripple-host')
    const rect = button.getBoundingClientRect()
    const dot = document.createElement('span')
    dot.className = 'ds-rip'
    dot.style.left = `${event.clientX - rect.left}px`
    dot.style.top = `${event.clientY - rect.top}px`
    button.append(dot)
    setTimeout(() => dot.remove(), 600)
  }, true)
}

export const FX_CSS = `
.ds-toasts {position:fixed;right:16px;bottom:calc(40px + env(safe-area-inset-bottom,0px));z-index:2147483000;display:flex;flex-direction:column;gap:8px;align-items:flex-end;pointer-events:none;}
.ds-toast {display:flex;align-items:center;gap:10px;background:#18212b;color:#f3f5f7;padding:11px 14px;border-radius:11px;font:500 14px "IBM Plex Sans",system-ui,sans-serif;box-shadow:0 24px 64px rgb(16 24 32 / .22);animation:ds-toast-in .3s cubic-bezier(.34,1.56,.64,1);max-width:min(420px,calc(100vw - 32px));}
.ds-toasts[data-theme=dark] .ds-toast {background:#e6ecf1;color:#0f1418;}
.ds-toast .tic {width:22px;height:22px;border-radius:50%;display:grid;place-items:center;background:#0f6b6f;color:#fff;flex:none;}
.ds-toasts[data-theme=dark] .ds-toast .tic {background:#4fb8b2;color:#06201f;}
.ds-toast .tic svg {width:13px;height:13px;}
.ds-toast.out {transition:opacity .25s,transform .25s;opacity:0;transform:translateY(8px);}
@keyframes ds-toast-in {from{opacity:0;transform:scale(.96) translateY(-6px)}to{opacity:1;transform:none}}
.ds-confetti {position:fixed;pointer-events:none;z-index:2147483001;width:8px;height:12px;border-radius:2px;}
.ds-ripple-host {position:relative;overflow:hidden;}
.ds-rip {position:absolute;border-radius:50%;width:40px;height:40px;margin:-20px 0 0 -20px;background:currentColor;opacity:.22;transform:scale(0);animation:ds-ripple .55s ease-out forwards;pointer-events:none;}
@keyframes ds-ripple {to{transform:scale(4);opacity:0}}
@media (prefers-reduced-motion:reduce){.ds-toast,.ds-rip{animation:none}}
`
