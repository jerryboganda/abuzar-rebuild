// DOM implementation of the UiHost: windows, MDI frame, menus, controls, message boxes.
import type { Runtime, UiHost } from '../runtime/interp.ts'
import { PBObject } from '../runtime/object.ts'
import { NControl, NWindow } from '../runtime/native/controls.ts'
import { NDwBase } from '../runtime/native/dwctrl.ts'
import { PBArray, toNum, toStr } from '../runtime/values.ts'
import { cssFont, fontSize, pbColor, toPx } from './pb.ts'
import { DwView } from './dwview.ts'
import { printDw } from './print.ts'
import { CSS } from './styles.ts'

const num = (o: PBObject, k: string, d = 0): number => {
  const v = o.props.get(k)
  return typeof v === 'number' ? v : d
}
const bool = (o: PBObject, k: string, d = true): boolean => {
  const v = o.props.get(k)
  return typeof v === 'boolean' ? v : d
}
const str = (o: PBObject, k: string): string => toStr(o.props.get(k))

const ALIGN = ['left', 'right', 'center', 'justify']

function fontOf(o: PBObject): string {
  return cssFont({ face: str(o, 'facename') || 'Arial', size: fontSize(num(o, 'textsize', -9)), weight: num(o, 'weight', 400), italic: bool(o, 'italic', false), underline: false, strike: false })
}

/** caption with & accelerator markers */
function caption(t: string): string {
  return t.replace(/&&/g, '\u0001').replace(/&/g, '').replace(/\u0001/g, '&')
}

export class DomUi implements UiHost {
  [k: string]: unknown
  rt: Runtime
  desktop: HTMLElement
  views = new Map<PBObject, WinView>()
  mdi: WinView | null = null
  zTop = 10

  constructor(rt: Runtime, desktop: HTMLElement) {
    this.rt = rt
    this.desktop = desktop
    const st = document.createElement('style')
    st.textContent = CSS
    document.head.appendChild(st)
  }

  createWindow(w: NWindow, opts: { sheet: boolean; modal: boolean }): void {
    const v = new WinView(this, w, opts)
    this.views.set(w, v)
    if (Number(w.props.get('windowtype')) >= 4) this.mdi = v
  }
  showWindow(w: NWindow): void {
    this.views.get(w)?.show()
  }
  hideWindow(w: NWindow): void {
    this.views.get(w)?.el.classList.add('hidden')
  }
  closeWindow(w: NWindow): void {
    const v = this.views.get(w)
    v?.destroy()
    this.views.delete(w)
    if (this.mdi === v) this.mdi = null
  }
  activate(w: NWindow): void {
    this.views.get(w)?.activate()
  }
  focus(o: PBObject): void {
    const v = this.findView(o)
    v?.focus()
  }
  findView(o: PBObject): { focus(): void } | undefined {
    for (const wv of this.views.values()) {
      const cv = wv.ctlViews.get(o)
      if (cv) return { focus: () => (cv.el.querySelector('input,textarea,select,button') as HTMLElement | null)?.focus() ?? cv.el.focus?.() }
    }
    return undefined
  }
  print(dw: NDwBase): Promise<boolean> {
    return printDw(dw)
  }
  setMicroHelp(_w: NWindow, t: string): void {
    const s = this.desktop.querySelector('.status') as HTMLElement | null
    if (s) s.textContent = t
  }

  /** text prompt standing in for the file dialogs of the original */
  prompt(title: string, text: string, def: string): Promise<string | null> {
    return new Promise((resolve) => {
      const bg = document.createElement('div')
      bg.className = 'modal-bg'
      bg.style.zIndex = '1999'
      const box = document.createElement('div')
      box.className = 'msgbox'
      box.innerHTML = '<div class="tbar" style="background:#fff"><div class="ttl"></div></div><div class="body" style="flex-direction:column"><div class="txt"></div><input style="width:100%;height:24px;border:1px solid #7a7a7a"></div><div class="btns"><button class="ok">OK</button><button class="cancel">Cancel</button></div>'
      ;(box.querySelector('.ttl') as HTMLElement).textContent = title
      ;(box.querySelector('.txt') as HTMLElement).textContent = text
      const input = box.querySelector('input') as HTMLInputElement
      input.value = def
      const done = (v: string | null) => {
        bg.remove()
        box.remove()
        resolve(v)
      }
      ;(box.querySelector('.ok') as HTMLElement).onclick = () => done(input.value)
      ;(box.querySelector('.cancel') as HTMLElement).onclick = () => done(null)
      input.onkeydown = (e) => {
        if (e.key === 'Enter') done(input.value)
        if (e.key === 'Escape') done(null)
      }
      this.desktop.appendChild(bg)
      this.desktop.appendChild(box)
      const r = this.desktop.getBoundingClientRect()
      box.style.left = Math.max(0, (r.width - 420) / 2) + 'px'
      box.style.top = Math.max(0, (r.height - 160) / 3) + 'px'
      input.focus()
    })
  }

  messageBox(title: string, text: string, icon: string, buttons: string, def: number): Promise<number> {
    return new Promise((resolve) => {
      const bg = document.createElement('div')
      bg.className = 'modal-bg'
      bg.style.zIndex = '1999'
      const box = document.createElement('div')
      box.className = 'msgbox'
      const ic: Record<string, string> = { 'stopsign!': '⛔', 'exclamation!': '⚠️', 'question!': '❓', 'information!': 'ℹ️' }
      box.innerHTML = `<div class="tbar" style="background:#fff"><div class="ttl"></div></div><div class="body"><div class="ico" style="font-size:28px"></div><div class="txt"></div></div><div class="btns"></div>`
      ;(box.querySelector('.ttl') as HTMLElement).textContent = title
      ;(box.querySelector('.ico') as HTMLElement).textContent = ic[icon] ?? ''
      ;(box.querySelector('.txt') as HTMLElement).textContent = text.replace(/\r\n/g, '\n')
      const defs: Record<string, [string, number][]> = {
        'ok!': [['OK', 1]],
        'okcancel!': [['OK', 1], ['Cancel', 2]],
        'yesno!': [['Yes', 1], ['No', 2]],
        'yesnocancel!': [['Yes', 1], ['No', 2], ['Cancel', 3]],
        'retrycancel!': [['Retry', 1], ['Cancel', 2]],
        'abortretryignore!': [['Abort', 1], ['Retry', 2], ['Ignore', 3]],
      }
      const btns = box.querySelector('.btns') as HTMLElement
      const list = defs[buttons] ?? defs['ok!']
      const done = (n: number) => {
        bg.remove()
        box.remove()
        resolve(n)
      }
      list.forEach(([label, code], i) => {
        const b = document.createElement('button')
        b.textContent = label
        b.onclick = () => done(code)
        btns.appendChild(b)
        if (i + 1 === def || (def === 0 && i === 0)) setTimeout(() => b.focus(), 0)
      })
      this.desktop.appendChild(bg)
      this.desktop.appendChild(box)
      const r = this.desktop.getBoundingClientRect()
      box.style.left = Math.max(0, (r.width - box.offsetWidth) / 2) + 'px'
      box.style.top = Math.max(0, (r.height - box.offsetHeight) / 3) + 'px'
    })
  }
}

class CtlView {
  el: HTMLElement
  obj: PBObject
  ui: DomUi
  constructor(ui: DomUi, obj: PBObject, el: HTMLElement) {
    this.ui = ui
    this.obj = obj
    this.el = el
  }
}

export class WinView {
  ui: DomUi
  w: NWindow
  el: HTMLElement
  client: HTMLElement
  ctlViews = new Map<PBObject, CtlView>()
  sheet: boolean
  modal: boolean
  mdiClient: HTMLElement | null = null

  constructor(ui: DomUi, w: NWindow, opts: { sheet: boolean; modal: boolean }) {
    this.ui = ui
    this.w = w
    this.sheet = opts.sheet
    this.modal = opts.modal
    const isMdi = Number(w.props.get('windowtype')) >= 4
    this.el = document.createElement('div')
    this.el.className = 'pbwin' + (this.sheet ? ' sheet' : '')
    const W = toPx(num(w, 'width'), 'x')
    const H = toPx(num(w, 'height'), 'y')
    const s = this.el.style
    s.width = W + 'px'
    s.height = H + 'px'
    s.left = toPx(num(w, 'x'), 'x') + 'px'
    s.top = toPx(num(w, 'y'), 'y') + 'px'
    if (isMdi) {
      s.left = '0'
      s.top = '0'
      s.width = '100%'
      s.height = '100%'
    }
    const titlebar = bool(w, 'titlebar', true)
    if (titlebar) {
      const tb = document.createElement('div')
      tb.className = 'tbar'
      tb.innerHTML = '<div class="ttl"></div><div class="cls">✕</div>'
      ;(tb.querySelector('.ttl') as HTMLElement).textContent = str(w, 'title')
      ;(tb.querySelector('.cls') as HTMLElement).onclick = () => void ui.rt.closeWindow(w)
      this.el.appendChild(tb)
      w.onProp = (n) => {
        if (n === 'title') (tb.querySelector('.ttl') as HTMLElement).textContent = str(w, 'title')
      }
      if (!isMdi) this.dragify(tb)
    }
    if (isMdi) {
      this.buildMdi()
    } else {
      this.client = document.createElement('div')
      this.client.className = 'client'
      this.client.style.background = pbColor(w.props.get('backcolor') as number, '#f0f0f0')
      this.el.appendChild(this.client)
    }
    this.client = this.client! // set by buildMdi or above
    this.renderControls(w, this.client)
    w.listeners.add(() => this.syncWindow())
    const host = this.sheet && ui.mdi?.mdiClient ? ui.mdi.mdiClient : ui.desktop
    host.appendChild(this.el)
    if (modal(this)) {
      // centred like a PowerBuilder response window
      const r = host.getBoundingClientRect()
      s.left = Math.max(0, (r.width - W) / 2) + 'px'
      s.top = Math.max(0, (r.height - H) / 3) + 'px'
    }
    this.el.classList.add('hidden')
    this.el.addEventListener('mousedown', () => this.activate())
  }

  private syncWindow(): void {
    const s = this.el.style
    if (Number(this.w.props.get('windowtype')) < 4) {
      s.left = toPx(num(this.w, 'x'), 'x') + 'px'
      s.top = toPx(num(this.w, 'y'), 'y') + 'px'
      s.width = toPx(num(this.w, 'width'), 'x') + 'px'
      s.height = toPx(num(this.w, 'height'), 'y') + 'px'
    }
  }

  private dragify(bar: HTMLElement): void {
    let sx = 0
    let sy = 0
    let ox = 0
    let oy = 0
    const move = (e: MouseEvent) => {
      this.el.style.left = ox + e.clientX - sx + 'px'
      this.el.style.top = oy + e.clientY - sy + 'px'
    }
    bar.addEventListener('mousedown', (e) => {
      if ((e.target as HTMLElement).classList.contains('cls')) return
      sx = e.clientX
      sy = e.clientY
      ox = this.el.offsetLeft
      oy = this.el.offsetTop
      const up = () => {
        document.removeEventListener('mousemove', move)
        document.removeEventListener('mouseup', up)
      }
      document.addEventListener('mousemove', move)
      document.addEventListener('mouseup', up)
    })
  }

  show(): void {
    this.el.classList.remove('hidden')
    this.activate()
    // first focus: the control with the lowest tab order
    const first = this.firstFocusable()
    if (first) setTimeout(() => first.focus(), 0)
    void this.ui.rt.fire(this.w, 'activate')
  }

  firstFocusable(): HTMLElement | null {
    const els = [...this.client.querySelectorAll<HTMLElement>('input,textarea,select,button')].filter((e) => !(e as HTMLInputElement).disabled)
    els.sort((a, b) => Number(a.dataset.tab ?? 9999) - Number(b.dataset.tab ?? 9999))
    return els[0] ?? null
  }

  focus(): void {
    this.firstFocusable()?.focus()
  }

  activate(): void {
    for (const v of this.ui.views.values()) v.el.classList.remove('active')
    this.el.classList.add('active')
    this.el.style.zIndex = String(++this.ui.zTop)
  }

  destroy(): void {
    this.el.remove()
  }

  // ---------------------------------------------------------------- MDI frame
  buildMdi(): void {
    const w = this.w
    this.client = document.createElement('div')
    this.client.style.cssText = 'flex:1;display:flex;flex-direction:column;position:relative;overflow:hidden'
    this.el.appendChild(this.client)
    const menuName = str(w, 'menuname')
    const bar = document.createElement('div')
    bar.className = 'menubar'
    this.client.appendChild(bar)
    const tool = document.createElement('div')
    tool.className = 'toolbar'
    this.client.appendChild(tool)
    this.mdiClient = document.createElement('div')
    this.mdiClient.className = 'mdi-client'
    this.client.appendChild(this.mdiClient)
    const st = document.createElement('div')
    st.className = 'status'
    this.client.appendChild(st)
    if (menuName) void this.loadMenu(menuName, bar)
  }

  async loadMenu(name: string, bar: HTMLElement): Promise<void> {
    const rt = this.ui.rt
    const menu = await rt.instantiate(name, this.w)
    this.w.props.set('menuid', menu)
    this.renderMenuBar(menu, bar)
  }

  renderMenuBar(menu: PBObject, bar: HTMLElement): void {
    bar.replaceChildren()
    for (const item of menu.children.values()) {
      if (item.props.get('visible') === false) continue
      const mi = document.createElement('div')
      mi.className = 'mi'
      mi.textContent = caption(str(item, 'text'))
      mi.onclick = (e) => {
        e.stopPropagation()
        const open = bar.querySelector('.mi.open')
        if (open && open !== mi) open.classList.remove('open')
        bar.querySelectorAll('.menu-drop').forEach((d) => d.remove())
        mi.classList.toggle('open')
        if (mi.classList.contains('open')) {
          mi.appendChild(this.dropdown(item))
        }
      }
      bar.appendChild(mi)
    }
    document.addEventListener('click', () => {
      bar.querySelectorAll('.menu-drop').forEach((d) => d.remove())
      bar.querySelectorAll('.mi.open').forEach((d) => d.classList.remove('open'))
    })
  }

  dropdown(item: PBObject): HTMLElement {
    const d = document.createElement('div')
    d.className = 'menu-drop'
    void this.ui.rt.fire(item, 'selected') // lets scripts adjust items just before the menu opens
    for (const sub of item.children.values()) {
      if (sub.props.get('visible') === false) continue
      const text = str(sub, 'text')
      if (text === '-' || sub.name.startsWith('m_-')) {
        const sep = document.createElement('div')
        sep.className = 'sep'
        d.appendChild(sep)
        continue
      }
      const it = document.createElement('div')
      it.className = 'it' + (sub.props.get('enabled') === false ? ' dis' : '')
      const l = document.createElement('span')
      l.textContent = (sub.props.get('checked') === true ? '✓ ' : '') + caption(text)
      const r = document.createElement('span')
      r.textContent = sub.children.size ? '▶' : str(sub, 'shortcut') ? '' : ''
      it.append(l, r)
      if (sub.children.size) {
        const subDrop = this.dropdown(sub)
        subDrop.classList.add('sub')
        it.appendChild(subDrop)
      } else {
        it.onclick = (e) => {
          e.stopPropagation()
          if (sub.props.get('enabled') === false) return
          document.body.click()
          void this.ui.rt.fire(sub, 'clicked')
        }
      }
      d.appendChild(it)
    }
    return d
  }

  // ---------------------------------------------------------------- controls
  renderControls(parent: PBObject, host: HTMLElement): void {
    const radios: { el: HTMLInputElement; obj: PBObject }[] = []
    const groups: { name: string; x: number; y: number; w: number; h: number }[] = []
    const kids = [...parent.children.values()]
    for (const c of kids) if (c.native === 'groupbox') groups.push({ name: c.name, x: num(c, 'x'), y: num(c, 'y'), w: num(c, 'width'), h: num(c, 'height') })
    for (const c of kids) {
      const v = this.makeControl(c)
      if (!v) continue
      this.ctlViews.set(c, v)
      host.appendChild(v.el)
      if (c.native === 'radiobutton') {
        const input = v.el.querySelector('input') as HTMLInputElement
        const g = groups.find((g) => num(c, 'x') >= g.x && num(c, 'y') >= g.y && num(c, 'x') <= g.x + g.w && num(c, 'y') <= g.y + g.h)
        input.name = `rg_${parent.name}_${g ? g.name : 'win'}`
        radios.push({ el: input, obj: c })
      }
      if (c.children.size && c.native !== 'tab' && c.native !== 'datawindow') this.renderControls(c, v.el)
    }
  }

  private place(c: PBObject, el: HTMLElement): void {
    const s = el.style
    s.left = toPx(num(c, 'x'), 'x') + 'px'
    s.top = toPx(num(c, 'y'), 'y') + 'px'
    s.width = toPx(num(c, 'width'), 'x') + 'px'
    s.height = toPx(num(c, 'height'), 'y') + 'px'
    if (!bool(c, 'visible', true)) el.classList.add('hidden')
  }

  private style(c: PBObject, el: HTMLElement): void {
    el.style.font = fontOf(c)
    const tc = c.props.get('textcolor')
    if (typeof tc === 'number') el.style.color = pbColor(tc, '#000')
    if (bool(c, 'underline', false)) el.style.textDecoration = 'underline'
    const bc = c.props.get('backcolor')
    if (typeof bc === 'number') el.style.background = pbColor(bc, 'transparent')
  }

  private borderClass(c: PBObject, el: HTMLElement): void {
    const b = num(c, 'borderstyle', 0)
    if (!bool(c, 'border', true) && b === 0) return
    if (b === 5) el.classList.add('lowered')
    else if (b === 6) el.classList.add('raised')
    else if (b === 2 || b === 1) el.classList.add('box')
  }

  makeControl(c: PBObject): CtlView | null {
    const rt = this.ui.rt
    const k = c.native
    let el: HTMLElement
    const wire = (target: HTMLElement) => {
      target.dataset.tab = String(num(c, 'taborder', 0) || 9999)
    }
    switch (k) {
      case 'commandbutton':
      case 'picturebutton': {
        const b = document.createElement('button')
        b.className = 'ctl' + (bool(c, 'default', false) ? ' default' : '')
        b.textContent = caption(str(c, 'text'))
        this.style(c, b)
        b.disabled = !bool(c, 'enabled', true)
        b.onclick = () => void rt.fire(c, 'clicked')
        b.onfocus = () => void rt.fire(c, 'getfocus')
        wire(b)
        el = b
        break
      }
      case 'statictext': {
        const d = document.createElement('div')
        d.className = 'ctl st'
        d.textContent = caption(str(c, 'text')).replace(/\r\n/g, '\n')
        this.style(c, d)
        d.style.textAlign = ALIGN[num(c, 'alignment', 0)] ?? 'left'
        d.style.lineHeight = 'normal'
        this.borderClass(c, d)
        d.onclick = () => void rt.fire(c, 'clicked')
        el = d
        break
      }
      case 'singlelineedit':
      case 'editmask': {
        const i = document.createElement('input')
        i.className = 'ctl'
        i.value = str(c, 'text')
        this.style(c, i)
        i.style.textAlign = ALIGN[num(c, 'alignment', 0)] ?? 'left'
        if (bool(c, 'password', false)) i.type = 'password'
        const lim = num(c, 'limit', 0)
        if (lim > 0) i.maxLength = lim
        i.disabled = !bool(c, 'enabled', true)
        i.oninput = () => {
          c.props.set('text', i.value)
          void rt.fire(c, 'modified')
        }
        i.onfocus = () => void rt.fire(c, 'getfocus')
        i.onblur = () => void rt.fire(c, 'losefocus')
        wire(i)
        el = i
        break
      }
      case 'multilineedit': {
        const t = document.createElement('textarea')
        t.className = 'ctl'
        t.value = str(c, 'text')
        this.style(c, t)
        t.oninput = () => c.props.set('text', t.value)
        wire(t)
        el = t
        break
      }
      case 'checkbox':
      case 'radiobutton': {
        const l = document.createElement('label')
        l.className = 'ctl'
        this.style(c, l)
        const i = document.createElement('input')
        i.type = k === 'checkbox' ? 'checkbox' : 'radio'
        i.checked = bool(c, 'checked', false)
        i.disabled = !bool(c, 'enabled', true)
        i.onchange = () => {
          c.props.set('checked', i.checked)
          void rt.fire(c, 'clicked')
        }
        const sp = document.createElement('span')
        sp.textContent = caption(str(c, 'text'))
        if (bool(c, 'lefttext', false)) l.append(sp, i)
        else l.append(i, sp)
        wire(i)
        el = l
        break
      }
      case 'groupbox': {
        const f = document.createElement('fieldset')
        f.className = 'ctl'
        const lg = document.createElement('legend')
        lg.textContent = caption(str(c, 'text'))
        f.appendChild(lg)
        this.style(c, f)
        el = f
        break
      }
      case 'listbox':
      case 'dropdownlistbox': {
        const s = document.createElement('select')
        s.className = 'ctl'
        if (k === 'listbox') s.size = 2
        this.style(c, s)
        const fill = () => {
          s.replaceChildren()
          const items = c.props.get('_items') as PBArray | undefined
          for (const it of items?.a ?? []) {
            const o = document.createElement('option')
            o.textContent = toStr(it)
            s.appendChild(o)
          }
          const sel = toNum(c.props.get('_selected') ?? 0)
          s.selectedIndex = sel - 1
        }
        fill()
        ;(c as NControl).listeners.add(fill)
        s.onchange = () => {
          c.props.set('_selected', s.selectedIndex + 1)
          void rt.fire(c, 'selectionchanged', [s.selectedIndex + 1])
        }
        wire(s)
        el = s
        break
      }
      case 'datawindow':
      case 'datastore': {
        if (k === 'datastore') return null
        const d = document.createElement('div')
        d.className = 'ctl'
        d.style.overflow = 'hidden'
        d.style.border = '1px solid #a0a0a0'
        this.place(c, d)
        new DwView(c as NDwBase, d)
        const v = new CtlView(this.ui, c, d)
        return v
      }
      case 'tab': {
        const t = document.createElement('div')
        t.className = 'ctl tabctl'
        const strip = document.createElement('div')
        strip.className = 'strip'
        const pages: HTMLElement[] = []
        const pageObjs = [...c.children.values()]
        const select = (n: number) => {
          pages.forEach((p, i) => (p.style.display = i + 1 === n ? 'block' : 'none'))
          ;[...strip.children].forEach((s, i) => s.classList.toggle('on', i + 1 === n))
          c.props.set('selectedtab', n)
        }
        pageObjs.forEach((po, i) => {
          const tabEl = document.createElement('div')
          tabEl.className = 't'
          tabEl.textContent = caption(str(po, 'text'))
          tabEl.onclick = () => {
            const old = toNum(c.props.get('selectedtab') ?? 1)
            select(i + 1)
            void rt.fire(c, 'selectionchanged', [old, i + 1])
          }
          strip.appendChild(tabEl)
          const page = document.createElement('div')
          page.className = 'page'
          t.appendChild(page)
          pages.push(page)
          this.renderControls(po, page)
        })
        t.prepend(strip)
        select(toNum(c.props.get('selectedtab') ?? 1) || 1)
        el = t
        break
      }
      case 'picture': {
        const img = document.createElement('img')
        img.className = 'ctl'
        img.src = 'data/assets/' + str(c, 'picturename').replace(/^.*[\\/]/, '').toLowerCase()
        img.onerror = () => (img.style.visibility = 'hidden')
        img.onclick = () => void rt.fire(c, 'clicked')
        el = img
        break
      }
      case 'progressbar': {
        const p = document.createElement('progress')
        p.className = 'ctl'
        p.max = num(c, 'maxposition', 100)
        p.value = num(c, 'position', 0)
        ;(c as NControl).listeners.add(() => (p.value = num(c, 'position', 0)))
        el = p
        break
      }
      default: {
        // user objects, scroll bars, OLE, graph ...: a plain container
        const d = document.createElement('div')
        d.className = 'ctl'
        d.style.background = typeof c.props.get('backcolor') === 'number' ? pbColor(c.props.get('backcolor') as number, 'transparent') : 'transparent'
        el = d
      }
    }
    el.classList.add('ctl')
    this.place(c, el)
    if (!bool(c, 'enabled', true) && 'disabled' in el) (el as HTMLButtonElement).disabled = true
    ;(c as NControl).listeners?.add(() => this.refresh(c, el))
    return new CtlView(this.ui, c, el)
  }

  /** property changes made by scripts (text, enabled, visible, position ...) */
  refresh(c: PBObject, el: HTMLElement): void {
    this.place(c, el)
    el.classList.toggle('hidden', !bool(c, 'visible', true))
    const dis = !bool(c, 'enabled', true)
    if ('disabled' in el) (el as HTMLButtonElement).disabled = dis
    const t = caption(str(c, 'text'))
    if (c.native === 'commandbutton') el.textContent = t
    else if (c.native === 'statictext') el.textContent = t.replace(/\r\n/g, '\n')
    else if (c.native === 'singlelineedit' || c.native === 'editmask') {
      const i = el as HTMLInputElement
      if (i.value !== str(c, 'text')) i.value = str(c, 'text')
    } else if (c.native === 'checkbox' || c.native === 'radiobutton') {
      const i = el.querySelector('input') as HTMLInputElement
      i.checked = bool(c, 'checked', false)
      i.disabled = dis
      const sp = el.querySelector('span')
      if (sp) sp.textContent = t
    }
    const tc = c.props.get('textcolor')
    if (typeof tc === 'number') el.style.color = pbColor(tc, '#000')
  }
}

function modal(v: WinView): boolean {
  return v.modal
}
