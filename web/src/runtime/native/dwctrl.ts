// DataWindow control, DataStore and DataWindowChild: the PowerScript-visible API on top of DwModel.
import { PBObject } from '../object.ts'
import type { Member } from '../object.ts'
import type { Runtime } from '../interp.ts'
import { Dec, PBDate, PBDateTime, PBTime, PBArray, PBRuntimeError, toNum, toStr, coerce } from '../values.ts'
import { compileDw } from '../../dw/expr.ts'
import { DwModel, DATA_MODIFIED, NEW, NEW_MODIFIED, NOT_MODIFIED } from '../../dw/model.ts'
import type { DwDef } from '../../dw/def.ts'
import { NTransaction } from './transaction.ts'
import { Ref } from '../interp.ts'

const bufferName = (v: unknown): string => String(v ?? 'primary!').replace(/!$/, '').toLowerCase()

/** `dw.object.<column>` : column properties and per-row values */
export class NDwColumn implements Member {
  dw: NDwBase
  col: string
  constructor(dw: NDwBase, col: string) {
    this.dw = dw
    this.col = col
  }
  pbGet(prop: string): unknown {
    const m = this.dw.model
    if (!m) return null
    const path = `${this.col}.${prop}`
    const v = m.describe(path)
    // `object.datawindow.column.count`: an unknown intermediate name continues the path
    return v === '!' ? new NDwColumn(this.dw, path) : v
  }
  pbSet(prop: string, v: unknown): void {
    this.dw.model?.modify(`${this.col}.${prop}=${typeof v === 'boolean' ? (v ? 'yes' : 'no') : toStr(v)}`)
    this.dw.changed()
  }
  async pbIndex(idx: unknown[]): Promise<unknown> {
    await this.dw.ready
    const m = this.dw.model
    if (!m) return null
    if (this.col === 'data') {
      // object.data[row, col]
      return idx.length > 1 ? m.getItem(toNum(idx[0]), toNum(idx[1])) : null
    }
    return m.getValue(toNum(idx[0]), this.col)
  }
  pbSetIndex(idx: unknown[], v: unknown): void {
    const m = this.dw.model
    if (!m) return
    if (this.col === 'data') m.setItem(toNum(idx[0]), toNum(idx[1]), v)
    else m.setItem(toNum(idx[0]), this.col, v)
    this.dw.changed()
  }
}

export class NDwObject implements Member {
  dw: NDwBase
  constructor(dw: NDwBase) {
    this.dw = dw
  }
  pbGet(name: string): unknown {
    return new NDwColumn(this.dw, name)
  }
  pbSet(): void {
    /* assigning to dw.object itself is not meaningful */
  }
}

export class NDwBase extends PBObject {
  model: DwModel | null = null
  ready: Promise<void> = Promise.resolve()
  dwName = ''
  listeners = new Set<() => void>()

  constructor(rt: Runtime, className: string, native = 'datawindow') {
    super(rt, className, native)
  }

  changed(): void {
    for (const l of this.listeners) l()
  }

  /** itemfocuschanged is running: SelectText from its script must not raise it again */
  inItemFocus = false
  /** the item focus raised by InsertRow while another control owns the keyboard: SelectText in the handler must not take the keyboard over */
  quietItemFocus = false
  async fireItemFocus(row: number, col: string, quiet = false): Promise<unknown> {
    const prev = this.inItemFocus
    const prevQuiet = this.quietItemFocus
    this.inItemFocus = true
    this.quietItemFocus = quiet
    try {
      return await this.rt.fire(this, 'itemfocuschanged', [row, { name: col }])
    } finally {
      this.inItemFocus = prev
      this.quietItemFocus = prevQuiet
    }
  }

  /** a script that changes visibility, position or size of the control (`dw.visible = false`, `dw.width = ...`) must see the change on the screen */
  override pbSet(name: string, value: unknown): void {
    // the design-time `dataobject` is a declared property: a script that assigns another one must still load that definition
    if (name.toLowerCase() === 'dataobject') return this.setNative('dataobject', value)
    super.pbSet(name, value)
    if (['visible', 'enabled', 'x', 'y', 'width', 'height'].includes(name.toLowerCase())) this.changed()
  }
  async n_hide(): Promise<number> {
    this.pbSet('visible', false)
    return 1
  }
  async n_show(): Promise<number> {
    this.pbSet('visible', true)
    return 1
  }

  // ---------------------------------------------------------------- properties
  override declare(name: string, type: string, value?: unknown): void {
    super.declare(name, type, value)
    // the design-time `dataobject` property loads the definition as soon as the control is created
    if (name === 'dataobject' && typeof value === 'string' && value) this.setNative('dataobject', value)
  }
  override getNative(name: string): unknown {
    switch (name) {
      case 'object':
        return new NDwObject(this)
      case 'dataobject':
        return this.dwName
      case 'rowcount':
        return this.model?.rowCount() ?? 0
    }
    return super.getNative(name)
  }
  override hasNative(name: string): boolean {
    return name === 'object' || name === 'dataobject'
  }
  override setNative(name: string, value: unknown): void {
    if (name === 'dataobject') {
      this.dwName = toStr(value).toLowerCase()
      this.props.set('dataobject', this.dwName)
      this.ready = this.loadDef(this.dwName)
      return
    }
    super.setNative(name, value)
  }

  async loadDef(name: string): Promise<void> {
    const cat = this.rt.dwCatalog
    if (!cat || !name) {
      this.model = null
      return
    }
    const def = await cat.get(name)
    if (!def) {
      this.rt.noteMissing('dw:' + name)
      this.model = null
      return
    }
    this.attach(new DwModel(this.rt, name, def as DwDef))
  }

  attach(model: DwModel): void {
    const prevTrans = this.model?.trans ?? null
    this.model = model
    if (prevTrans) model.trans = prevTrans
    else if (this.trans) model.trans = this.trans
    this.changed()
  }

  trans: NTransaction | null = null

  // ---------------------------------------------------------------- methods
  async m(): Promise<DwModel | null> {
    await this.ready
    return this.model
  }

  async n_settransobject(t: unknown): Promise<number> {
    this.trans = t instanceof NTransaction ? t : null
    const m = await this.m()
    if (m) m.trans = this.trans
    return 1
  }
  async n_settrans(t: unknown): Promise<number> {
    return this.n_settransobject(t)
  }
  async n_retrieve(...args: unknown[]): Promise<number> {
    const m = await this.m()
    if (!m) return -1
    const start = await this.rt.fire(this, 'retrievestart')
    if (start === 1) return 0
    const n = await m.retrieve(args)
    await this.rt.fire(this, 'retrieveend', [n])
    this.changed()
    return n
  }
  async n_update(accept = true, resetFlag = true): Promise<number> {
    const m = await this.m()
    if (!m) return -1
    const ok = await this.rt.fire(this, 'updatestart')
    if (ok === 1) return -1
    const r = await m.update(accept !== false, resetFlag !== false)
    if (r < 0 && m.lastError) await this.rt.fire(this, 'dberror', [-1, m.lastError, '', 'primary!', 0])
    this.changed()
    return r
  }
  async n_rowcount(): Promise<number> {
    return (await this.m())?.rowCount() ?? 0
  }
  async n_filteredcount(): Promise<number> {
    return (await this.m())?.filteredCount() ?? 0
  }
  async n_deletedcount(): Promise<number> {
    return (await this.m())?.deletedCount() ?? 0
  }
  async n_modifiedcount(): Promise<number> {
    const m = await this.m()
    return m ? m.buf.primary.filter((r) => r.st === DATA_MODIFIED || r.st === 3).length : 0
  }
  async n_getrow(): Promise<number> {
    return (await this.m())?.row ?? 0
  }
  async n_setrow(r: unknown): Promise<number> {
    const m = await this.m()
    if (!m) return -1
    const n = toNum(r)
    if (n < 1 || n > m.rowCount()) return -1
    m.row = n
    this.changed()
    return 1
  }
  async n_scrolltorow(r: unknown): Promise<number> {
    const m = await this.m()
    if (!m) return -1
    const n = toNum(r)
    if (n < 1 || n > m.rowCount()) return -1
    if (m.row !== n) {
      m.row = n
      await this.rt.fire(this, 'rowfocuschanged', [n])
    }
    this.changed()
    return n
  }
  /** ScrollNextRow / ScrollPriorRow / ScrollNextPage / ScrollPriorPage: the row scrolled to, -1 without rows */
  private async scrollBy(delta: number): Promise<number> {
    const m = await this.m()
    if (!m || !m.rowCount()) return -1
    return this.n_scrolltorow(Math.min(m.rowCount(), Math.max(1, Math.max(1, m.row) + delta)))
  }
  async n_scrollnextrow(): Promise<number> {
    return this.scrollBy(1)
  }
  async n_scrollpriorrow(): Promise<number> {
    return this.scrollBy(-1)
  }
  async n_scrollnextpage(): Promise<number> {
    return this.scrollBy(10)
  }
  async n_scrollpriorpage(): Promise<number> {
    return this.scrollBy(-10)
  }
  /** SetSQLPreview(sql): the SQLPreview event is not raised (its handlers only adapt literals for SQL Server), so there is nothing to replace */
  async n_setsqlpreview(): Promise<number> {
    return 1
  }
  async n_insertrow(r: unknown = 0): Promise<number> {
    const m = await this.m()
    if (!m) return -1
    const n = m.insertRow(toNum(r))
    this.changed()
    // the new row is the current row and its current cell gets the item focus: the entry windows rely on it (dw_itemsdetail.itemfocuschanged sets
    // `editflag`, which `wf_validatedate` returns; ue_newform clears `ib_focusdetail` right before it so that the event does not open the item list)
    if (n > 0 && m.colNames.length) {
      if (m.col < 1) m.col = 1
      await this.fireItemFocus(n, m.colNames[m.col - 1], true)
    }
    return n
  }
  async n_deleterow(r: unknown = 0): Promise<number> {
    const m = await this.m()
    if (!m) return -1
    const n = m.deleteRow(toNum(r))
    this.changed()
    return n
  }
  async n_reset(): Promise<number> {
    const m = await this.m()
    m?.reset()
    this.changed()
    return 1
  }
  async n_resetupdate(): Promise<number> {
    ;(await this.m())?.resetUpdate()
    return 1
  }
  async n_setitem(row: unknown, col: unknown, val: unknown): Promise<number> {
    const m = await this.m()
    if (!m) return -1
    const r = m.setItem(toNum(row), typeof col === 'number' ? col : toStr(col), val)
    this.changed()
    return r
  }
  async getAny(row: unknown, col: unknown, buffer?: unknown, orig?: unknown): Promise<unknown> {
    const m = await this.m()
    if (!m) return null
    const c = typeof col === 'number' ? col : toStr(col)
    const b = bufferName(buffer)
    if (orig === true) {
      const r = m.rowAt(toNum(row), b)
      const i = m.colIndex(c)
      return r && i >= 0 ? (r.orig ?? r.v)[i] : null
    }
    return m.getValue(toNum(row), c, b)
  }
  async n_getitemstring(row: unknown, col: unknown, buffer?: unknown, orig?: unknown): Promise<unknown> {
    const v = await this.getAny(row, col, buffer, orig)
    return v === null ? null : toStr(v)
  }
  async n_getitemnumber(row: unknown, col: unknown, buffer?: unknown, orig?: unknown): Promise<unknown> {
    const v = await this.getAny(row, col, buffer, orig)
    return v === null ? null : toNum(v)
  }
  async n_getitemdecimal(row: unknown, col: unknown, buffer?: unknown, orig?: unknown): Promise<unknown> {
    const v = await this.getAny(row, col, buffer, orig)
    return v === null ? null : coerce('decimal', v)
  }
  async n_getitemdatetime(row: unknown, col: unknown, buffer?: unknown, orig?: unknown): Promise<unknown> {
    const v = await this.getAny(row, col, buffer, orig)
    if (v instanceof PBDate) return new PBDateTime(v.n, 0)
    return v instanceof PBDateTime ? v : null
  }
  async n_getitemdate(row: unknown, col: unknown, buffer?: unknown, orig?: unknown): Promise<unknown> {
    const v = await this.getAny(row, col, buffer, orig)
    return v instanceof PBDateTime ? v.date : v instanceof PBDate ? v : null
  }
  async n_getitemtime(row: unknown, col: unknown, buffer?: unknown, orig?: unknown): Promise<unknown> {
    const v = await this.getAny(row, col, buffer, orig)
    return v instanceof PBDateTime ? v.time : v instanceof PBTime ? v : null
  }
  async n_getitemany(row: unknown, col: unknown): Promise<unknown> {
    return this.getAny(row, col)
  }
  async n_getitemstatus(row: unknown, col: unknown, buffer?: unknown): Promise<number | string> {
    const m = await this.m()
    if (!m) return -1
    const st = m.getStatus(toNum(row), col === 0 || col === null ? null : typeof col === 'number' ? col : toStr(col), bufferName(buffer))
    // PowerBuilder returns the RowStatus / DWItemStatus enumeration, and every
    // recovered script compares it with `notmodified!`, `new!` ... (strings in
    // the runtime).  Returning the raw 0..3 made those comparisons always false.
    return st === NOT_MODIFIED ? 'notmodified!' : st === DATA_MODIFIED ? 'datamodified!' : st === NEW ? 'new!' : st === NEW_MODIFIED ? 'newmodified!' : st
  }
  async n_setitemstatus(row: unknown, col: unknown, buffer: unknown, status: unknown): Promise<number> {
    const m = await this.m()
    if (!m) return -1
    const st = String(status).replace(/!$/, '').toLowerCase()
    const code = st === 'notmodified' ? NOT_MODIFIED : st === 'datamodified' ? DATA_MODIFIED : st === 'new' ? 2 : st === 'newmodified' ? 3 : toNum(status)
    const r = m.setStatus(toNum(row), col === 0 || col === null ? null : typeof col === 'number' ? col : toStr(col), code, bufferName(buffer))
    this.changed()
    return r
  }
  /** an invalid expression is an error code (-1 / -5), not a runtime error, as in PowerBuilder */
  async n_find(expr: unknown, start: unknown, end: unknown): Promise<number> {
    const m = await this.m()
    if (!m) return -1
    try {
      return await m.find(toStr(expr), toNum(start), toNum(end))
    } catch (e) {
      if (e instanceof PBRuntimeError && /DataWindow expression/.test(e.message)) return -5
      throw e
    }
  }
  async n_setfilter(text: unknown): Promise<number> {
    const m = await this.m()
    if (!m) return -1
    const t = toStr(text).trim()
    if (t && !/^(none|\?)$/i.test(t)) {
      try {
        compileDw(t)
      } catch {
        return -1
      }
    }
    return m.setFilter(toStr(text))
  }
  async n_filter(): Promise<number> {
    const m = await this.m()
    if (!m) return -1
    const r = await m.filter()
    this.changed()
    return r
  }
  async n_setsort(text: unknown): Promise<number> {
    const m = await this.m()
    if (!m) return -1
    for (const part of toStr(text).split(',')) {
      const expr = part.trim().replace(/\s+[AD]$/i, '').trim()
      if (!expr) continue
      try {
        compileDw(expr)
      } catch {
        return -1
      }
    }
    return m.setSort(toStr(text))
  }
  async n_sort(): Promise<number> {
    const m = await this.m()
    if (!m) return -1
    const r = await m.sort()
    this.changed()
    return r
  }
  async n_groupcalc(): Promise<number> {
    ;(await this.m())?.touch()
    this.changed()
    return 1
  }
  async n_modify(text: unknown): Promise<string> {
    const m = await this.m()
    if (!m) return '!'
    const r = m.modify(toStr(text))
    this.changed()
    return r
  }
  async n_describe(text: unknown): Promise<string> {
    const m = await this.m()
    if (!m) return '!'
    const parts = toStr(text).split(/\s+/).filter(Boolean)
    return parts.map((p) => m.describe(p)).join('\n')
  }
  async n_accepttext(): Promise<number> {
    const m = await this.m()
    return m ? m.acceptText() : -1
  }
  async n_selectrow(row: unknown, sel: unknown): Promise<number> {
    const m = await this.m()
    if (!m) return -1
    const n = toNum(row)
    if (n === 0) {
      for (const r of m.buf.primary) r.sel = sel === true
    } else {
      const r = m.rowAt(n)
      if (!r) return -1
      r.sel = sel === true
    }
    this.changed()
    return 1
  }
  async n_isselected(row: unknown): Promise<boolean> {
    const m = await this.m()
    return !!m?.rowAt(toNum(row))?.sel
  }
  async n_getselectedrow(from: unknown): Promise<number> {
    const m = await this.m()
    if (!m) return 0
    for (let i = toNum(from); i < m.rowCount(); i++) if (m.buf.primary[i].sel) return i + 1
    return 0
  }
  async n_getcolumn(): Promise<number> {
    return (await this.m())?.col ?? 0
  }
  async n_setcolumn(c: unknown): Promise<number> {
    const m = await this.m()
    if (!m) return -1
    const i = m.colIndex(typeof c === 'number' ? c : toStr(c))
    if (i < 0) return -1
    m.col = i + 1
    this.changed()
    return 1
  }
  async n_getcolumnname(): Promise<string> {
    const m = await this.m()
    return m && m.col > 0 ? m.colNames[m.col - 1] : ''
  }
  async n_gettext(): Promise<string> {
    const m = await this.m()
    if (!m || m.row < 1 || m.col < 1) return ''
    return toStr(m.getItem(m.row, m.col))
  }
  async n_settext(t: unknown): Promise<number> {
    const m = await this.m()
    if (!m || m.row < 1 || m.col < 1) return -1
    return m.setItem(m.row, m.col, t) > 0 ? 1 : -1
  }
  async n_setfocus(): Promise<number> {
    this.rt.ui?.focus?.(this)
    type Win = { lastFocusDw: PBObject | null; focusLive: boolean; focusOwner: PBObject | null }
    let p: PBObject | null = this.parent
    while (p && !('lastFocusDw' in p)) p = p.parent
    const win = p as unknown as Win | null
    if (!win) return 1
    if (!win.focusLive) win.lastFocusDw = this // the window is still opening: GetFocus comes when it is up
    else if (win.focusOwner !== this) {
      const from = win.focusOwner
      win.focusOwner = this
      if (from && from.native === 'datawindow') await this.rt.fire(from, 'losefocus')
      await this.rt.fire(this, 'getfocus')
    }
    return 1
  }
  /**
   * SelectText: select the text of the current editable cell. The item list's
   * Clicked script calls this on id_detail after writing icode/itemname; the
   * click has taken the DOM focus, so the detail editor has to be restored and
   * its item focus raised again (after the Clicked script has set its flags).
   */
  async n_selecttext(): Promise<number> {
    const m = await this.m()
    if (!m || m.row < 1 || m.col < 1) return 1
    const ui = this.rt.ui as { focusDw?: (o: PBObject) => Promise<boolean>; focus?: (o: PBObject) => void } | null
    if (this.quietItemFocus) return 1
    if (this.inItemFocus) {
      await ui?.focusDw?.(this)
      return 1
    }
    const row = m.row
    const col = m.colNames[m.col - 1]
    this.rt.post(async () => {
      const ok = await ui?.focusDw?.(this)
      if (!ok) {
        ui?.focus?.(this)
        return
      }
      const cur = this.model
      if (!cur || cur.row < 1 || cur.col < 1 || cur.colNames[cur.col - 1] !== col) return
      await this.fireItemFocus(cur.row, col)
    })
    return 1
  }
  async n_setredraw(): Promise<number> {
    return 1
  }
  /** GetChild(column, ref DataWindowChild): returns 1 and stores the child in the reference, -1 when the column is not a drop-down DataWindow */
  async n_getchild(col: unknown, ref?: unknown): Promise<unknown> {
    const m = await this.m()
    if (!m) return -1
    const name = toStr(col).toLowerCase()
    const store = ((m as unknown as { childCtl?: Map<string, NDwBase> }).childCtl ??= new Map())
    let ch = store.get(name)
    if (!ch) {
      const o = m.def.objects.find((x) => x.type === 'column' && x.name.toLowerCase() === name)
      const dddw = o?.['dddw.name']
      if (!dddw) {
        // the variable receives an object even when the column has no DropDownDataWindow (GetChild returns -1): scripts that ignore the return code
        // go on calling SetTransObject / Retrieve on it, and the original's reports (w_reviewreport.wf_retrieve) rely on that
        if (ref instanceof Ref && (ref.get() === null || ref.get() === undefined)) await ref.set(new NDwBase(this.rt, 'datawindowchild', 'datawindowchild'))
        return -1
      }
      ch = new NDwBase(this.rt, 'datawindowchild', 'datawindowchild')
      ch.dwName = dddw.toLowerCase()
      ch.ready = ch.loadDef(ch.dwName)
      if (this.trans) ch.trans = this.trans
      // a script that retrieves the child (`idc_category.retrieve()`) changes what the column shows: the parent repaints
      ch.listeners.add(() => this.changed())
      store.set(name, ch)
    }
    if (ref instanceof Ref) {
      await ref.set(ch)
      return 1
    }
    return ch
  }
  async n_sharedata(other: unknown): Promise<number> {
    const m = await this.m()
    if (!m || !(other instanceof NDwBase)) return -1
    const o = await other.m()
    if (!o) return -1
    o.buf = m.buf
    other.changed()
    return 1
  }
  async n_sharedataoff(): Promise<number> {
    const m = await this.m()
    if (m) {
      const b = m.buf
      m.buf = Object.assign(Object.create(Object.getPrototypeOf(b)), b)
      m.buf.primary = b.primary.slice()
    }
    return 1
  }
  async n_rowscopy(start: unknown, end: unknown, srcBuf: unknown, target: unknown, before: unknown, dstBuf: unknown): Promise<number> {
    const m = await this.m()
    if (!m || !(target instanceof NDwBase)) return -1
    const t = await target.m()
    if (!t) return -1
    const rows = (bufferName(srcBuf) === 'filter' ? m.buf.filtered : bufferName(srcBuf) === 'delete' ? m.buf.deleted : m.buf.primary).slice(toNum(start) - 1, toNum(end))
    const dst = bufferName(dstBuf) === 'filter' ? t.buf.filtered : bufferName(dstBuf) === 'delete' ? t.buf.deleted : t.buf.primary
    let at = Math.max(0, Math.min(dst.length, toNum(before) - 1))
    for (const r of rows) {
      const copy = { v: t.colNames.map((n, i) => (m.colIdx.has(n) ? this.cp(r.v[m.colIdx.get(n)!]) : t.defaultFor(i))), orig: null, st: 2, mod: new Set<number>(), sel: false }
      dst.splice(at++, 0, copy)
    }
    t.touch()
    target.changed()
    return 1
  }
  private cp(v: unknown): unknown {
    return v
  }
  async n_rowsdiscard(start: unknown, end: unknown, buf: unknown): Promise<number> {
    const m = await this.m()
    if (!m) return -1
    const list = bufferName(buf) === 'filter' ? m.buf.filtered : bufferName(buf) === 'delete' ? m.buf.deleted : m.buf.primary
    list.splice(toNum(start) - 1, toNum(end) - toNum(start) + 1)
    m.touch()
    this.changed()
    return 1
  }
  async n_rowsmove(start: unknown, end: unknown, srcBuf: unknown, target: unknown, before: unknown, dstBuf: unknown): Promise<number> {
    const r = await this.n_rowscopy(start, end, srcBuf, target, before, dstBuf)
    if (r > 0) await this.n_rowsdiscard(start, end, srcBuf)
    return r
  }
  async n_getmessage(): Promise<string> {
    return (await this.m())?.lastError ?? ''
  }
  async n_print(): Promise<number> {
    return (await this.rt.ui?.print?.(this)) ? 1 : -1
  }
  /** SaveAs(file, type, headers): without a file name the user is asked (a download) */
  async n_saveas(file: unknown = '', type: unknown = '', headers?: unknown): Promise<number> {
    const f = toStr(file)
    const h = headers === undefined || headers === null ? !f : headers === true || (typeof headers === 'number' && headers !== 0)
    return (await (this.rt.ui as { saveAs?: (c: unknown, f: string, t: string, h: boolean) => Promise<boolean> } | null)?.saveAs?.(this, f, toStr(type), h)) ? 1 : -1
  }
  async n_object(): Promise<unknown> {
    return new NDwObject(this)
  }
  async n_getdwchild(col: unknown): Promise<unknown> {
    return this.n_getchild(col)
  }
  async n_setposition(): Promise<number> {
    return 1
  }
  /** FindRequired(buffer, ref row, ref column number, ref column name, updateOnly): 1 and the position of the first required column left empty, 0 when none */
  async n_findrequired(_buffer?: unknown, row?: unknown, colNo?: unknown, colName?: unknown, updateOnly?: unknown): Promise<number> {
    const m = await this.m()
    if (!m) return -1
    const only = updateOnly === true || (typeof updateOnly === 'number' && updateOnly !== 0)
    const required = m.def.objects.filter((o) => o.type === 'column' && o['edit.required'] === 'yes' && m.colIndex(o.name) >= 0).map((o) => m.colIndex(o.name))
    const startRow = row instanceof Ref ? Math.max(1, toNum(row.get())) : 1
    for (let r = startRow; r <= m.rowCount(); r++) {
      const dr = m.rowAt(r)
      if (!dr) continue
      for (const ci of required) {
        if (only && dr.st !== DATA_MODIFIED && dr.st !== NEW_MODIFIED) continue
        const v = dr.v[ci]
        if (v === null || v === undefined || v === '') {
          if (row instanceof Ref) await row.set(r)
          if (colNo instanceof Ref) await colNo.set(ci + 1)
          if (colName instanceof Ref) await colName.set(m.colNames[ci])
          return 1
        }
      }
    }
    return 0
  }
  /** SetTabOrder(column, n): column-level tab sequence */
  async n_settaborder(col: unknown, n: unknown): Promise<number> {
    const m = await this.m()
    if (!m || m.colIndex(typeof col === 'number' ? col : toStr(col)) < 0) return -1
    m.modify(`${typeof col === 'number' ? m.colNames[col - 1] : toStr(col)}.tabsequence=${toNum(n)}`)
    this.changed()
    return 1
  }
  async n_insertrow_array(): Promise<number> {
    return 1
  }
  async n_importstring(text: unknown): Promise<number> {
    const m = await this.m()
    if (!m) return -1
    let n = 0
    for (const line of toStr(text).split(/\r?\n/)) {
      if (!line) continue
      const cells = line.split('\t')
      const r = m.insertRow(0)
      cells.forEach((c, i) => m.setItem(r, i + 1, c))
      n++
    }
    this.changed()
    return n
  }
  async n_getsqlselect(): Promise<string> {
    return (await this.m())?.describe('datawindow.table.select') ?? ''
  }
  async n_setsqlselect(s: unknown): Promise<number> {
    const m = await this.m()
    if (!m) return -1
    m.modify(`datawindow.table.select='${toStr(s)}'`)
    return 1
  }
}

void PBArray
void Dec
