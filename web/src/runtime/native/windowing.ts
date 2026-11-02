// open / opensheet / close / closewithreturn and the message object; registers the native classes.
import type { Runtime } from '../interp.ts'
import { Ref } from '../interp.ts'
import { PBObject } from '../object.ts'
import { Dec, PBRuntimeError, toStr } from '../values.ts'
import { NControl, NMenuItem, NWindow } from './controls.ts'
import { NDwBase } from './dwctrl.ts'
import { NTransaction } from './transaction.ts'

function setMessage(rt: Runtime, parm: unknown): void {
  const msg = rt.globals.get('message') as PBObject | undefined
  if (!msg) return
  msg.props.set('stringparm', '')
  msg.props.set('doubleparm', 0)
  msg.props.set('powerobjectparm', null)
  if (typeof parm === 'string') msg.props.set('stringparm', parm)
  else if (typeof parm === 'number') msg.props.set('doubleparm', parm)
  else if (parm instanceof Dec) msg.props.set('doubleparm', parm.toNumber())
  else if (parm instanceof PBObject || (parm && typeof parm === 'object')) msg.props.set('powerobjectparm', parm)
}

async function openWin(rt: Runtime, a: unknown[], sheet: boolean, withParm: boolean): Promise<number> {
  const ref = a[0] instanceof Ref ? a[0] : null
  let i = 1
  let parm: unknown
  if (withParm) parm = a[i++]
  let cls = ''
  let parent: PBObject | null = null
  for (; i < a.length; i++) {
    const x = a[i]
    if (typeof x === 'string' && !x.endsWith('!')) cls = x.toLowerCase()
    else if (x instanceof PBObject) parent = x
  }
  if (!cls && ref) cls = (ref.typ && !['window', 'any', ''].includes(ref.typ) ? ref.typ : ref.name).toLowerCase()
  if (!cls) throw new PBRuntimeError('open: window class unknown')
  const cur = ref ? ref.get() : null
  if (cur instanceof NWindow && cur.isOpen && !cur.destroyed && !withParm) {
    rt.ui?.activate?.(cur)
    return 1
  }
  if (withParm) setMessage(rt, parm)
  const w = (await rt.instantiate(cls, parent)) as NWindow
  w.parent = parent
  if (ref) await ref.set(w)
  // open(w_logo) without a declared variable: the class name is the variable (close(w_logo) finds the window later)
  if (ref && cls === ref.name.toLowerCase() && !rt.globals.has(cls)) rt.globals.set(cls, w)
  rt.windowInstances.set(cls, w)
  w.isOpen = true
  // a window with a menu name owns an instance of that menu (`menuid`)
  const mn = w.props.get('menuname')
  if (typeof mn === 'string' && mn && !w.props.get('menuid')) w.props.set('menuid', await rt.instantiate(mn.toLowerCase(), w))
  await rt.fireConstructors(w)
  // the item list popup of the entry windows is a DataWindow that is only shown while the user searches (the original has it hidden until `show()`;
  // its definition lacks the attribute, the program keeps `visible` false: its window class is not visible in the original's control tree)
  const hidePopups = (o: PBObject) => {
    for (const c of o.children.values()) {
      if (c.name === 'dw_itemslist') c.props.set('visible', false)
      hidePopups(c)
    }
  }
  hidePopups(w)
  const type = Number(w.props.get('windowtype') ?? 0)
  const modal = type === 3
  rt.ui?.createWindow?.(w, { sheet, modal })
  await rt.fire(w, 'open')
  rt.ui?.showWindow?.(w, { sheet, modal })
  if (modal) await w.closed
  else if (w.props.get('visible') === false) rt.ui?.hideWindow?.(w)
  return 1
}

export async function closeWindow(rt: Runtime, w: PBObject): Promise<number> {
  if (!(w instanceof NWindow) || !w.isOpen || w.closing) return 0
  w.closing = true
  const q = await rt.fire(w, 'closequery')
  if (q === 1) {
    w.closing = false
    return -1
  }
  await rt.fire(w, 'close')
  w.isOpen = false
  rt.ui?.closeWindow?.(w)
  w.destroy()
  const cls = w.className
  if (rt.windowInstances.get(cls) === w) rt.windowInstances.delete(cls)
  w.resolveClosed()
  return 1
}

export function registerWindowing(rt: Runtime): void {
  rt.closeWindow = (w) => closeWindow(rt, w)
  const def = (name: string, fn: (rt: Runtime, a: unknown[]) => unknown | Promise<unknown>, refs?: number[]) => rt.sys.set(name, refs ? { fn: (r, a) => fn(r, a), refs } : { fn: (r, a) => fn(r, a) })
  def('open', (r, a) => openWin(r, a, false, false), [0])
  def('openwithparm', (r, a) => openWin(r, a, false, true), [0])
  def('opensheet', (r, a) => openWin(r, a, true, false), [0])
  def('opensheetwithparm', (r, a) => openWin(r, a, true, true), [0])
  def('close', (r, a) => (a[0] instanceof PBObject ? closeWindow(r, a[0]) : 0))
  def('closewithreturn', (r, a) => {
    const w = a[0]
    const msg = r.globals.get('message') as PBObject | undefined
    if (msg) {
      msg.props.set('stringparm', typeof a[1] === 'string' ? a[1] : '')
      msg.props.set('doubleparm', typeof a[1] === 'number' ? a[1] : a[1] instanceof Dec ? a[1].toNumber() : 0)
      msg.props.set('powerobjectparm', a[1] && typeof a[1] === 'object' && !(a[1] instanceof Dec) ? a[1] : null)
    }
    return w instanceof PBObject ? closeWindow(r, w) : 0
  })
  def('halt', () => {
    throw new Error('halt')
  })
  // ---- natives
  const nat = rt.natives
  nat.set('window', (r, c) => new NWindow(r, c))
  nat.set('menu', (r, c) => new NMenuItem(r, c, 'menu'))
  nat.set('datawindow', (r, c) => new NDwBase(r, c, 'datawindow'))
  nat.set('datastore', (r, c) => new NDwBase(r, c, 'datastore'))
  nat.set('datawindowchild', (r, c) => new NDwBase(r, c, 'datawindowchild'))
  nat.set('transaction', (r, c) => new NTransaction(r, c))
  for (const k of [
    'commandbutton', 'statictext', 'singlelineedit', 'multilineedit', 'editmask', 'checkbox', 'radiobutton', 'listbox', 'dropdownlistbox', 'picturelistbox',
    'tab', 'groupbox', 'picture', 'picturebutton', 'progressbar', 'hscrollbar', 'vscrollbar', 'hprogressbar', 'userobject', 'oval', 'rectangle', 'roundrectangle', 'line',
    'richtextedit', 'treeview', 'listview', 'ole', 'olecustomcontrol', 'graph', 'hslider', 'vslider', 'monthcalendar', 'datepicker',
  ]) nat.set(k, (r, c) => new NControl(r, c, k))
  rt.nativeParent.set('u_transaction', 'transaction')
  void toStr
}
