// open / opensheet / close / closewithreturn and the message object; registers the native classes.
import type { Runtime } from '../interp.ts'
import { Ref } from '../interp.ts'
import { PBObject } from '../object.ts'
import { Dec, PBRuntimeError, toNum, toStr } from '../values.ts'
import { NControl, NMenuItem, NWindow } from './controls.ts'
import { NDwBase } from './dwctrl.ts'
import { NTransaction } from './transaction.ts'
import { NWinSock } from './winsock.ts'

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

/** PowerBuilder Timer(): the repeating timer of a window (seconds); interval 0 stops it */
const windowTimers = new WeakMap<PBObject, ReturnType<typeof setInterval>>()

function stopWindowTimer(w: PBObject): void {
  const t = windowTimers.get(w)
  if (t !== undefined) {
    clearInterval(t)
    windowTimers.delete(w)
  }
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
  const ownedMenu = w.props.get('menuid')
  if (ownedMenu instanceof PBObject && !ownedMenu.parent) ownedMenu.parent = w
  await rt.fireConstructors(w)
  // the item list popup of the entry windows is a DataWindow that is only shown while the user searches (the original has it hidden until `show()`;
  // its definition lacks the attribute, the program keeps `visible` false: its window class is not visible in the original's control tree)
  // controls that sit inside the rectangle of a hidden group box and carry no `visible` attribute are hidden, too (the original shows none of the invoice / price fields of the
  // argument windows; the definition only lists `visible = false` for the group box and some of its fields)
  const num = (c: PBObject, k: string) => Number(c.props.get(k) ?? 0)
  const hideInHiddenBoxes = (o: PBObject) => {
    const kids = [...o.children.values()]
    const boxes = kids.filter((c) => c.native === 'groupbox' && c.props.get('visible') === false)
    for (const c of kids) {
      if (c.native === 'groupbox' || (c.props.get('visible') ?? null) !== null) continue
      if (boxes.some((b) => num(c, 'x') >= num(b, 'x') && num(c, 'y') >= num(b, 'y') && num(c, 'x') + num(c, 'width') <= num(b, 'x') + num(b, 'width') && num(c, 'y') + num(c, 'height') <= num(b, 'y') + num(b, 'height'))) c.props.set('visible', false)
    }
  }
  const hidePopups = (o: PBObject, keepItemList = false) => {
    hideInHiddenBoxes(o)
    for (const c of o.children.values()) {
      // the sale/purchase entry windows call their list `id_itemslist`; some
      // recovered screens use `dw_itemslist`.  Cash Sale and Refused Sale open
      // with that list visible in the original; the other entry windows do not.
      if (!keepItemList && (c.name === 'dw_itemslist' || c.name === 'id_itemslist')) c.pbSet('visible', false)
      hidePopups(c, keepItemList)
    }
  }
  hidePopups(w)
  const type = Number(w.props.get('windowtype') ?? 0)
  const modal = type === 3
  // Argument sheets often retrieve in their ancestor Open/Activate and assign
  // `istr_arg = message.powerobjectparm` only later in their own Open.  Seed the
  // declared argument structure from openwithparm before the UI creates /
  // activates the window so the first retrieve sees the caller's dates/range.
  if (withParm && parm && typeof parm === 'object') {
    for (const k of ['istr_arg', 'is_arg']) if (w.props.has(k)) w.props.set(k, parm)
  }
  rt.ui?.createWindow?.(w, { sheet, modal })
  await rt.fire(w, 'open')
  // The child Open may assign `istr_arg` from message.powerobjectparm after an
  // ancestor call that already consumed/overwrote the message.  Restore the
  // call parameter before the window is shown and its Activate retrieve runs.
  if (withParm && parm && typeof parm === 'object') {
    for (const k of ['istr_arg', 'is_arg']) if (w.props.has(k)) w.props.set(k, parm)
  }
  rt.ui?.showWindow?.(w, { sheet, modal })
  // `postevent("ue_postopen")` queued by the window's Open must finish before
  // the first tab is selected: the entry windows lay out and initialise their
  // DataWindows there, and the tab's SelectionChanged reads those values
  // (Cash Sale's godown and price were still null when the tab ran first).
  await rt.flushPosted()
  // `ue_newform` runs from the posted queue and can focus the detail grid,
  // which opens the search list before the window is painted.  The original
  // starts with it closed; the first real focus on the item cell opens it.
  // The original opens Cash Sale and Refused Sale with their item search list
  // visible (the detail grid gets the focus from Open); Credit Sale, Purchase
  // and Purchase Order open with it shut.  Keep that difference instead of
  // closing the list for every entry window.
  const findItemDetail = (o: PBObject): PBObject | null => {
    for (const c of o.children.values()) {
      if (c.name === 'id_detail' || c.name === 'dw_detail') return c
      const f = findItemDetail(c)
      if (f) return f
    }
    return null
  }
  const detailObject = String(findItemDetail(w)?.props.get('dataobject') ?? '').toLowerCase()
  const keepItemList = w.name === 'w_refusedsales' || (w.name === 'w_sale' && detailObject.startsWith('d_retail'))
  const hideLists = () => {
    hidePopups(w, keepItemList)
    if (keepItemList) {
      const list = [...w.children.values()].find((c) => c.name === 'id_itemslist' || c.name === 'dw_itemslist')
      if (list && list.props.get('visible') === false) list.pbSet('visible', true)
      if (w.props.has('ib_itemslistopen')) w.props.set('ib_itemslistopen', true)
    } else {
      if (w.props.has('ib_itemslistopen')) w.props.set('ib_itemslistopen', false)
      if (w.props.has('ib_focusdetail')) w.props.set('ib_focusdetail', false)
    }
  }
  hideLists()
  // the first-focus timer scheduled by showWindow may run after this point and
  // open the search list from the detail grid's GetFocus handler; close it once
  // that initial focus sequence has settled (the original starts with it shut)
  setTimeout(hideLists, 0)
  setTimeout(hideLists, 250)
  // a tab control raises SelectionChanging / SelectionChanged for its first page when its window comes up (the entry windows build their blank new form in it:
  // the original's Users, Item or Sale Template window opens with an empty form and the menu in new-form state)
  const tabs: PBObject[] = []
  const findTabs = (o: PBObject) => {
    for (const c of o.children.values()) {
      if (c instanceof NControl && c.native === 'tab' && c.children.size) tabs.push(c)
      else findTabs(c)
    }
  }
  findTabs(w)
  for (const t of tabs) {
    const first = Number(t.props.get('selectedtab') ?? 1) || 1
    await rt.fire(t, 'selectionchanging', [0, first])
    await rt.fire(t, 'selectionchanged', [0, first])
  }
  // the DataWindow that holds the keyboard when the window comes up gets its GetFocus (the entry windows open the item list popup from it: Cash Sale and Refused Sale start with
  // the detail grid focused, the Purchase Order with its header)
  const fd = w.lastFocusDw
  w.lastFocusDw = null
  w.focusLive = true
  w.focusOwner = fd
  if (fd && !fd.destroyed && w.isOpen) {
    await rt.fire(fd, 'getfocus')
    // the keyboard is in the current cell of that DataWindow (its editor, text selected): the sale promotion starts in `Name`, Refused Sale in the detail grid
    try {
      await (rt.ui as { focusDw?: (o: PBObject, fallback?: boolean) => Promise<boolean> } | null)?.focusDw?.(fd, true)
    } catch {
      /* a DataWindow without a current cell takes no focus */
    }
  }
  if (modal) {
    rt.modalWaiting++
    rt.yieldQueue()
    try {
      await w.closed
    } finally {
      rt.modalWaiting--
    }
  }
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
  stopWindowTimer(w)
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
  // Timer(interval, window): interval in seconds, 0 stops it.  PowerBuilder has a system function with this name while a
  // window also has a Timer event; a plain `timer(0, this)` call must reach the function, not recursively fire the event.
  def('timer', (r, a) => {
    const w = a[1]
    if (!(w instanceof PBObject)) return -1
    stopWindowTimer(w)
    const seconds = toNum(a[0])
    if (seconds > 0) {
      const handle = setInterval(() => {
        void Promise.resolve(r.fire(w, 'timer')).catch((e) => r.onError(e))
      }, seconds * 1000)
      windowTimers.set(w, handle)
    }
    return 1
  })
  def('closewithreturn', (r, a) => {
    const w = a[0]
    // A delayed Close event must not overwrite an already accepted modal return.
    if (!(w instanceof NWindow) || !w.isOpen) return 0
    setMessage(r, a[1])
    return closeWindow(r, w)
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
  nat.set('n_winsock', (r, c) => new NWinSock(r, c))
  for (const k of [
    'commandbutton', 'statictext', 'singlelineedit', 'multilineedit', 'editmask', 'checkbox', 'radiobutton', 'listbox', 'dropdownlistbox', 'picturelistbox',
    'tab', 'groupbox', 'picture', 'picturebutton', 'progressbar', 'hscrollbar', 'vscrollbar', 'hprogressbar', 'userobject', 'oval', 'rectangle', 'roundrectangle', 'line',
    'richtextedit', 'treeview', 'listview', 'ole', 'olecustomcontrol', 'graph', 'hslider', 'vslider', 'monthcalendar', 'datepicker', 'statichyperlink', 'picturehyperlink',
  ]) nat.set(k, (r, c) => new NControl(r, c, k))
  rt.nativeParent.set('u_transaction', 'transaction')
  void toStr
}
