// Windows and standard controls (headless behaviour; the DOM layer binds to `onProp` and the listeners).
import { PBObject } from '../object.ts'
import type { Member } from '../object.ts'
import type { Runtime } from '../interp.ts'
import { PBArray, toNum, toStr } from '../values.ts'
import { Ref } from '../interp.ts'

/** the automation object of an OLE control whose server is not installed here (fingerprint reader, ActiveX viewers): every call fails with -1,
 *  so the window opens and the device features report an error instead of the whole window failing */
class OleStub implements Member {
  pbGet(): unknown {
    return null
  }
  pbSet(): void {}
  pbCall(name: string, _args: unknown[], rt: Runtime): number {
    rt.noteMissing('ole:' + name)
    return -1
  }
}

export class NControl extends PBObject {
  listeners = new Set<() => void>()
  constructor(rt: Runtime, className: string, native: string) {
    super(rt, className, native)
  }
  changed(): void {
    for (const l of this.listeners) l()
  }
  override setNative(name: string, value: unknown): void {
    super.setNative(name, value)
    this.changed()
  }
  private ole = new OleStub()
  override pbGet(name: string): unknown {
    if (name === 'object' && (this.native === 'olecustomcontrol' || this.native === 'ole')) return this.ole
    return super.pbGet(name)
  }
  override pbSet(name: string, value: unknown): void {
    const old = name === 'selectedtab' ? toNum(this.props.get('selectedtab') ?? 1) : 0
    super.pbSet(name, value)
    this.changed()
    // `tab.selectedtab = n` in a script raises the tab events like a click does (the entry windows build their new form that way)
    if (name === 'selectedtab' && this.native === 'tab') {
      const n = toNum(value)
      void (async () => {
        await this.rt.fire(this, 'selectionchanging', [old, n])
        await this.rt.fire(this, 'selectionchanged', [old, n])
        this.changed()
      })()
    }
  }

  // ---- common window-object methods
  /** EditMask.GetData(ref value): the entered text converted to the type of the receiving variable */
  async n_getdata(ref?: unknown): Promise<number> {
    if (!(ref instanceof Ref)) return -1
    const text = toStr(this.props.get('text'))
    const cur = ref.get()
    if (typeof cur === 'number') await ref.set(Number(text.replace(/,/g, '')) || 0)
    else await ref.set(text)
    return 1
  }
  /** the window that contains this control */
  async n_getparent(): Promise<unknown> {
    let p = this.parent
    while (p && !(p instanceof NWindow)) p = p.parent
    return p
  }
  async n_hide(): Promise<number> {
    this.pbSet('visible', false)
    return 1
  }
  async n_show(): Promise<number> {
    this.pbSet('visible', true)
    return 1
  }
  async n_setfocus(): Promise<number> {
    this.rt.ui?.focus?.(this)
    return 1
  }
  async n_move(x: unknown, y: unknown): Promise<number> {
    this.props.set('x', toNum(x))
    this.props.set('y', toNum(y))
    this.changed()
    return 1
  }
  async n_resize(w: unknown, h: unknown): Promise<number> {
    this.props.set('width', toNum(w))
    this.props.set('height', toNum(h))
    this.changed()
    return 1
  }
  async n_setposition(): Promise<number> {
    return 1
  }
  async n_setredraw(): Promise<number> {
    return 1
  }
  async n_bringtotop(): Promise<number> {
    return 1
  }
  async n_settaborder(n: unknown): Promise<number> {
    this.props.set('taborder', toNum(n))
    return 1
  }
  async n_gettext(): Promise<string> {
    return toStr(this.props.get('text'))
  }
  async n_settext(t: unknown): Promise<number> {
    this.pbSet('text', toStr(t))
    return 1
  }
  async n_text(): Promise<string> {
    return toStr(this.props.get('text'))
  }
  async n_selecttext(start: unknown, len: unknown): Promise<number> {
    this.props.set('_selstart', toNum(start))
    this.props.set('_sellen', toNum(len))
    this.rt.ui?.selectText?.(this, toNum(start), toNum(len))
    return 1
  }
  async n_selectedtext(): Promise<string> {
    const t = toStr(this.props.get('text'))
    const s = toNum(this.props.get('_selstart') ?? 1)
    return t.substr(s - 1, toNum(this.props.get('_sellen') ?? 0))
  }
  async n_textlimit(): Promise<number> {
    return toNum(this.props.get('limit') ?? 0)
  }

  // ---- list boxes / drop-down list boxes
  items(): PBArray {
    let a = this.props.get('_items') as PBArray | undefined
    if (!a) {
      a = new PBArray('string')
      this.props.set('_items', a)
    }
    return a
  }
  async n_additem(t: unknown): Promise<number> {
    this.items().a.push(toStr(t))
    this.changed()
    return this.items().a.length
  }
  async n_insertitem(t: unknown, at: unknown): Promise<number> {
    this.items().a.splice(Math.max(0, toNum(at) - 1), 0, toStr(t))
    this.changed()
    return this.items().a.length
  }
  async n_deleteitem(at: unknown): Promise<number> {
    const a = this.items().a
    const i = toNum(at) - 1
    if (i < 0 || i >= a.length) return -1
    a.splice(i, 1)
    this.changed()
    return a.length
  }
  async n_reset(): Promise<number> {
    this.items().a.length = 0
    this.props.set('_selected', 0)
    this.changed()
    return 1
  }
  async n_totalitems(): Promise<number> {
    return this.items().a.length
  }
  async n_selectitem(i: unknown): Promise<number> {
    const n = typeof i === 'string' ? this.items().a.findIndex((x) => x === i) + 1 : toNum(i)
    if (n < 0 || n > this.items().a.length) return -1
    this.props.set('_selected', n)
    this.changed()
    return n
  }
  async n_selectedindex(): Promise<number> {
    return toNum(this.props.get('_selected') ?? 0)
  }
  async n_selecteditem(): Promise<string> {
    const n = toNum(this.props.get('_selected') ?? 0)
    return n > 0 ? toStr(this.items().a[n - 1]) : ''
  }
  async n_finditem(t: unknown, from: unknown): Promise<number> {
    const a = this.items().a
    const s = toStr(t).toLowerCase()
    for (let i = Math.max(0, toNum(from)); i < a.length; i++) if (toStr(a[i]).toLowerCase().startsWith(s)) return i + 1
    return -1
  }
  async n_text_of(i: unknown): Promise<string> {
    return toStr(this.items().a[toNum(i) - 1])
  }

  // ---- progress bar
  async n_stepit(): Promise<number> {
    const p = toNum(this.props.get('position') ?? 0) + toNum(this.props.get('setstep') ?? 10)
    this.pbSet('position', Math.min(p, toNum(this.props.get('maxposition') ?? 100)))
    return p
  }
  async n_setrange(min: unknown, max: unknown): Promise<number> {
    this.props.set('minposition', toNum(min))
    this.props.set('maxposition', toNum(max))
    return 1
  }

  // ---- tab control
  async n_selecttab(t: unknown): Promise<number> {
    let n: number
    if (typeof t === 'number') n = t
    else {
      const names = [...this.children.keys()]
      n = names.indexOf(t instanceof PBObject ? t.name : toStr(t)) + 1
    }
    if (n < 1) return -1
    const old = toNum(this.props.get('selectedtab') ?? 1)
    this.props.set('selectedtab', n)
    await this.rt.fire(this, 'selectionchanged', [old, n])
    this.changed()
    return 1
  }
  async n_opentab(): Promise<number> {
    return 1
  }
}

export class NWindow extends NControl {
  closed: Promise<void>
  resolveClosed!: () => void
  isOpen = false
  closing = false
  returnValue: unknown = null
  constructor(rt: Runtime, className: string, native = 'window') {
    super(rt, className, native)
    this.closed = new Promise<void>((r) => (this.resolveClosed = r))
  }
  override getNative(name: string): unknown {
    if (name === 'parentwindow') return this.parent
    if (name === 'menuid') return this.props.get('menuid') ?? null
    return super.getNative(name)
  }
  async n_close(): Promise<number> {
    return this.rt.closeWindow(this)
  }
  async n_setmicrohelp(t: unknown): Promise<number> {
    this.rt.ui?.setMicroHelp?.(this, toStr(t))
    return 1
  }
  async n_arrangesheets(): Promise<number> {
    return 1
  }
  async n_getactivesheet(): Promise<unknown> {
    return this.rt.ui?.activeSheet?.(this) ?? null
  }
  async n_changemenu(m: unknown): Promise<number> {
    this.props.set('menuid', m)
    this.rt.ui?.changeMenu?.(this, m)
    return 1
  }
  async n_print(): Promise<number> {
    return 1
  }
  async n_title(): Promise<string> {
    return toStr(this.props.get('title'))
  }
}

export class NMenuItem extends NControl {
  async n_popmenu(x: unknown, y: unknown): Promise<number> {
    this.rt.ui?.popMenu?.(this, toNum(x), toNum(y))
    return 1
  }
  async n_checked(): Promise<boolean> {
    return this.props.get('checked') === true
  }
}
