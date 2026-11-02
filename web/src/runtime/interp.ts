// Tree-walking, async interpreter for the recovered PowerScript.
import type { Expr, Stmt, Routine, CaseTest } from '../pbscript/ast.ts'
import { PBObject, PBStruct, isMember } from './object.ts'
import type { ClassDef, ControlDef, FieldDef, Member, RoutineEntry } from './object.ts'
import { add, cmp, coerce, defaultValue, Dec, div, equals, isNull, mul, NUMERIC_TYPES, PBArray, PBRuntimeError, sub, toNum, toStr } from './values.ts'

// ---------------------------------------------------------------------------------------------- hosts
export interface ClassLoader {
  /** definition of a user-defined class (window, menu, userobject, function, structure) or undefined */
  load(name: string): Promise<ClassDef | undefined>
}

export interface UiHost {
  messageBox(title: string, text: string, icon: string, buttons: string, def: number): Promise<number>
  openWindow(rt: Runtime, w: PBObject, modal: boolean, sheet: boolean): Promise<void>
  closeWindow(w: PBObject): void
  [k: string]: unknown
}

export interface SysFunc {
  fn: (rt: Runtime, args: unknown[], f: Frame) => unknown | Promise<unknown>
  refs?: number[] // argument positions passed by reference (setnull, filereadex ...)
}

export class Ref {
  get: () => unknown
  set: (v: unknown) => Promise<void> | void
  name = '' // identifier the reference was made from
  typ = '' // declared type of that identifier (windows opened through variables)
  constructor(get: () => unknown, set: (v: unknown) => Promise<void> | void) {
    this.get = get
    this.set = set
  }
}

export class HaltSignal extends Error {}

/** short text of an expression for error messages */
export function exprText(e: Expr): string {
  switch (e.k) {
    case 'id':
      return e.n
    case 'global':
      return '::' + e.n
    case 'mem':
      return exprText(e.o) + '.' + e.n
    case 'idx':
      return exprText(e.o) + '[..]'
    case 'call':
      return (e.o ? exprText(e.o) + '.' : '') + e.n + '(..)'
    default:
      return e.k
  }
}

/** native methods that return a value through a `ref` argument: name -> argument positions */
const REF_METHODS: Record<string, number[]> = { getchild: [1], getfullstate: [0], getdata: [0], getdatetime: [0], getmostrecenttransdate: [0], findrequired: [1, 2, 3] }
function e0(_e: unknown, r: Routine): Routine {
  return r
}

const PRIMITIVES = new Set([...NUMERIC_TYPES, 'string', 'boolean', 'char', 'date', 'time', 'datetime', 'blob', 'any', 'uint', 'ulong'])

/** exception raised by `throw` or converted from runtime errors, catchable with try/catch */
export class PBThrowable extends PBObject {
  message = ''
  n_getmessage(): string {
    return this.message
  }
  n_gettext(): string {
    return this.message
  }
}

const NONE = 0
const RETURN = 1
const EXIT = 2
const CONTINUE = 3
const GOTO = 4

export class Frame {
  self: PBObject | null
  routine: Routine | null
  scriptIdx: number
  locals = new Map<string, unknown>()
  types = new Map<string, string>()
  ret: unknown = null
  gotoLabel = ''
  constructor(self: PBObject | null, routine: Routine | null, scriptIdx: number) {
    this.self = self
    this.routine = routine
    this.scriptIdx = scriptIdx
  }
}

export class Runtime {
  loader: ClassLoader
  classes = new Map<string, ClassDef | null>()
  sys = new Map<string, SysFunc>()
  natives = new Map<string, (rt: Runtime, className: string) => PBObject>()
  nativeParent = new Map<string, string | null>() // native class hierarchy (commandbutton -> windowobject ...)
  globals = new Map<string, unknown>()
  gtypes = new Map<string, string>()
  ui: UiHost | null = null
  posted: (() => Promise<void>)[] = []
  /** statement executor for embedded SQL (set by the data layer) */
  sql: ((rt: Runtime, f: Frame, st: Extract<Stmt, { k: 'sql' }>) => Promise<void>) | null = null
  /** translated retrieve statement of a DataWindow (data/sql); set by the application shell */
  dwSql: ((name: string) => { sql: string; params: string[]; proc?: boolean } | undefined) | null = null
  windowInstances = new Map<string, PBObject>() // open window by class name (global window variables such as w_main)
  dwCatalog: import('../dw/def.ts').DwCatalog | null = null
  closeWindow: (w: PBObject) => Promise<number> = async () => 0
  /** translated embedded statement by normalised original text (data/sql) */
  sqlStmt: ((key: string) => { sql: string; params: string[]; into?: string[] } | undefined) | null = null
  /** opens a server session for a transaction object */
  openDb: ((t: PBObject) => Promise<import('./wire.ts').Db>) | null = null
  /** stored procedures callable through the transaction object (RPC declarations) */
  procs: { call(t: PBObject, name: string, args: unknown[]): Promise<unknown>; refPositions?(name: string): number[] | undefined } | null = null
  /** run-time translation of a changed SELECT (modify datawindow.table.select) */
  /** diagnostic hook: an exception about to be handled by a script's catch block */
  onCaught: ((e: unknown) => void) | null = null
  translateSql: ((text: string) => { sql: string; params: string[] } | undefined) | null = null
  missing = new Map<string, number>() // unimplemented functions / members seen at run time
  depth = 0
  /** safety net for scripts that wait for data that never arrives */
  loopLimit = 20_000_000
  /**
   * Session cache for the application-wide item lists (traderappv1.open creates gd_itemsinfo / gd_popup_itemsinfo /
   * gd_itemswithalternatealias and every window shares them).  Keyed by DataWindow name + translated retrieve SQL +
   * parameter values; cleared whenever this session writes through a DataWindow or embedded SQL.  See dw/model.ts.
   */
  retrieveCache = new Map<string, import('./wire.ts').QueryResult>()
  invalidateRetrieveCache(): void {
    this.retrieveCache.clear()
  }

  constructor(loader: ClassLoader) {
    this.loader = loader
  }

  // ---------------------------------------------------------------- classes and instances
  async getClass(name: string): Promise<ClassDef | undefined> {
    const key = name.toLowerCase()
    if (this.classes.has(key)) return this.classes.get(key) || undefined
    const c = await this.loader.load(key)
    this.classes.set(key, c || null)
    return c
  }

  /** class chain, leaf first, and the name of the native root class */
  async classChain(name: string): Promise<{ chain: ClassDef[]; native: string }> {
    const chain: ClassDef[] = []
    let cur: string | null = name.toLowerCase()
    const seen = new Set<string>()
    while (cur) {
      if (seen.has(cur)) break
      seen.add(cur)
      const c: ClassDef | undefined = await this.getClass(cur)
      if (!c) return { chain, native: cur }
      chain.push(c)
      cur = c.ancestor ? c.ancestor.toLowerCase() : null
    }
    return { chain, native: chain.length ? chain[chain.length - 1].kind : name }
  }

  private makeNative(native: string, className: string): PBObject {
    let n: string | null = native
    while (n) {
      const f = this.natives.get(n)
      if (f) return f(this, className)
      n = this.nativeParent.get(n) ?? null
    }
    return new PBObject(this, className, native)
  }

  /** create an object of a user-defined or native class */
  async instantiate(className: string, parent: PBObject | null = null, name = ''): Promise<PBObject> {
    const { chain, native } = await this.classChain(className)
    const obj = this.makeNative(native, className.toLowerCase())
    obj.parent = parent
    obj.name = name || className.toLowerCase()
    obj.scripts = chain.map((c) => ({ cls: c, owner: c.name }))
    // fields: root first so descendants override
    for (let i = chain.length - 1; i >= 0; i--) this.applyFields(obj, chain[i].fields)
    // controls: root-most class first; a descendant may redefine (override fields/scripts of) an inherited control
    const classesRootFirst = chain.slice().reverse()
    await this.buildControls(obj, classesRootFirst, (c) => c.controls)
    await this.initObjectVars(obj)
    if (obj.native === 'menu' || obj.native === 'window' || chain.length) await this.runCreate(obj)
    return obj
  }

  /** instance variables of object / structure / array types do not use the numeric placeholder stored in the class data */
  async initObjectVars(obj: PBObject): Promise<void> {
    for (const name of obj.vars) {
      const type = obj.types.get(name)!
      if (PRIMITIVES.has(type) || type.endsWith('[]') || obj.children.has(name)) continue
      obj.props.set(name, await this.defaultOf(type))
    }
  }

  applyFields(obj: PBObject, fields: FieldDef[]): void {
    for (const f of fields) {
      if (f.name === 'control') continue
      obj.declare(f.name, f.type, f.value === undefined ? undefined : f.value)
      if (f.attr === '0xcc') obj.vars.add(f.name)
      if (f.array) {
        obj.props.set(f.name, new PBArray(f.type))
        obj.types.set(f.name, f.type + '[]')
      }
      // `item[]` of menus / list boxes: filled by scripts (this.item[upperbound(this.item) + 1] = ...)
      if (f.name === 'item') obj.props.set('item', new PBArray('any'))
    }
  }

  private async buildControls(obj: PBObject, classes: ClassDef[], pick: (c: ClassDef) => ControlDef[]): Promise<void> {
    for (const cls of classes) {
      for (const cd of pick(cls)) await this.addControl(obj, cd, cls, classes)
    }
  }

  private async addControl(parent: PBObject, cd: ControlDef, declaring: ClassDef, windowClasses: ClassDef[]): Promise<void> {
    let child = parent.children.get(cd.name.toLowerCase())
    if (!child) {
      const { chain, native } = await this.classChain(cd.ancestor)
      child = this.makeNative(native, cd.ancestor.toLowerCase())
      child.parent = parent
      child.name = cd.name.toLowerCase()
      parent.children.set(child.name, child)
      for (let i = chain.length - 1; i >= 0; i--) this.applyFields(child, chain[i].fields)
      // scripts: window-level definitions of this control (most derived first), then the control's own class chain
      child.scripts = []
      child.scripts.push(...chain.map((c) => ({ cls: c, owner: c.name })))
      // UO-internal controls (a user object with children of its own)
      for (let i = chain.length - 1; i >= 0; i--) for (const sub of chain[i].controls) await this.addControl(child, sub, chain[i], chain.slice().reverse())
    }
    // the declaring class redefines fields of the control
    this.applyFields(child, cd.fields)
    // scripts written for this control in the window / menu classes of the chain (most derived first), then the control's own class chain
    const nm = cd.name.toLowerCase()
    const mine = windowClasses.slice().reverse().filter((c) => c.routines.get(nm)).map((c) => ({ cls: c, owner: nm }))
    const rest = child.scripts.filter((sc) => !mine.some((m) => m.cls === sc.cls && m.owner === sc.owner))
    child.scripts = [...mine, ...rest]
    void declaring
    for (const sub of cd.controls) await this.addControl(child, sub, declaring, windowClasses)
    await this.initObjectVars(child)
  }

  /** run the `create` events of an object and its controls (menu items set their captions there; each one chains to its ancestor's with `call super::create`) */
  private async runCreate(obj: PBObject): Promise<void> {
    const own = obj.findRoutines('create').filter((e) => obj.scripts[e.idx].owner === obj.scripts[e.idx].cls.name)
    if (own.length) await this.runEntry(obj, own[0], [])
    await this.createChildren(obj)
  }

  private async createChildren(obj: PBObject): Promise<void> {
    for (const c of obj.children.values()) {
      const es = c.findRoutines('create')
      if (es.length) await this.runEntry(c, es[0], [])
      await this.createChildren(c)
    }
  }

  // ---------------------------------------------------------------- invoking routines
  /** the routines started last, newest last (a debugging aid of the browser test: what ran just before a script closed a window) */
  recent: [PBObject, Routine][] = []
  recentNames(n = 8): string {
    return this.recent.slice(-n).map(([o, r]) => `${o.className}.${this.routineName(o, r)}`).join(' > ')
  }

  async runEntry(self: PBObject, e: RoutineEntry, args: unknown[]): Promise<unknown> {
    const r = e.r
    this.recent.push([self, r])
    if (this.recent.length > 24) this.recent.shift()
    const f = new Frame(self, r, e.idx)
    const refBack: { i: number; ref: Ref }[] = []
    r.params.forEach((p, i) => {
      let v = args[i]
      if (v instanceof Ref) {
        refBack.push({ i, ref: v })
        v = v.get()
      }
      f.types.set(p.n, p.t)
      f.locals.set(p.n, v === undefined ? (p.arr ? new PBArray(p.t) : defaultValue(p.t)) : p.arr ? v : coerce(p.t, v))
    })
    if (++this.depth > 400) {
      this.depth = 0
      throw new PBRuntimeError('Maximum call depth exceeded')
    }
    try {
      await this.execBlock(r.body, f)
    } catch (e) {
      if (e instanceof PBRuntimeError && !e.where) e.where = `${self.className}.${self.name}.${r.params.length >= 0 ? this.routineName(self, e0(e, r)) : ''}`
      throw e
    } finally {
      this.depth--
      // the outermost routine returned: now the posted events may run
      if (this.depth === 0 && this.posted.length) this.kickQueue()
    }
    for (const b of refBack) await b.ref.set(f.locals.get(r.params[b.i].n))
    if (f.ret === null && r.ret && r.ret !== '0' && NUMERIC_TYPES.has(r.ret)) return null
    return f.ret === undefined ? null : f.ret
  }

  routineName(self: PBObject, r: Routine): string {
    for (const sc of self.scripts) for (const [, m] of sc.cls.routines) for (const [n, list] of m) if (list.includes(r)) return n
    return '?'
  }

  /** find the routine (events and functions share a namespace) matching the argument count */
  pick(entries: RoutineEntry[], argc: number): RoutineEntry | undefined {
    if (entries.length === 1) return entries[0]
    return entries.find((e) => e.r.params.length === argc) || entries.find((e) => e.r.params.length >= argc) || entries[0]
  }

  async callMethod(obj: PBObject, name: string, args: unknown[]): Promise<unknown> {
    const entries = obj.findRoutines(name)
    if (entries.length) return this.runEntry(obj, this.pick(entries, args.length)!, args)
    return this.callNative(obj, name, args)
  }

  async callNative(obj: PBObject, name: string, args: unknown[]): Promise<unknown> {
    const nm = (obj as unknown as Record<string, unknown>)['n_' + name]
    if (typeof nm === 'function') return (nm as (...a: unknown[]) => unknown).apply(obj, args)
    // generic powerobject methods
    switch (name) {
      case 'triggerevent':
      case 'postevent': {
        const ev = typeof args[0] === 'string' ? args[0].toLowerCase() : String(args[0]).replace(/!$/, '').toLowerCase()
        if (name === 'postevent') {
          this.post(async () => void (await this.callMethod(obj, ev, args.slice(1))))
          return 1
        }
        const r = await this.callMethod(obj, ev, args.slice(1))
        return r === null || r === undefined ? 1 : r
      }
      case 'classname':
        return obj.className
      case 'typeof':
        return obj.native
      case 'destroy':
        obj.destroy()
        return 1
    }
    // stored procedures declared on the transaction object (RPCFUNC)
    if (obj.native === 'transaction' && this.procs) return this.procs.call(obj, name, args)
    // events without a script (post event ue_xxx, constructor ...) do nothing, like in PowerBuilder
    if (!/^ue_|^constructor$|^destructor$/.test(name)) this.noteMissing(obj.native + '.' + name)
    return null
  }

  noteMissing(what: string): void {
    this.missing.set(what, (this.missing.get(what) || 0) + 1)
  }

  /** defer a call until the current event handler has finished (PowerScript `post`) */
  /**
   * posted events run one after the other, each to its end (a message queue: `post event ue_newform()` after `postevent("ue_postopen")` means the second starts when the
   * first is done).  A modal window or a message box waiting for its answer runs a message loop of its own in PowerBuilder: `yieldQueue` lets the queue go on meanwhile.
   */
  private draining = false
  private gen = 0
  post(fn: () => Promise<void>): void {
    this.posted.push(fn)
    // A posted event only runs after the current PowerScript event has
    // returned (PowerBuilder's message queue).  A bare setTimeout would fire
    // while the window's Open is still awaiting a query, interleaving
    // ue_postopen with ue_newform and leaving child DataWindows null.
    if (!this.draining && this.depth === 0) this.kickQueue()
  }
  private kickQueue(): void {
    if (this.draining) return
    this.draining = true
    const g = this.gen
    setTimeout(() => void this.drainPosted(g), 0)
  }
  async drainPosted(g = this.gen): Promise<void> {
    try {
      while (g === this.gen && this.posted.length) {
        const fn = this.posted.shift()!
        try {
          await fn()
        } catch (e) {
          this.onError(e)
        }
      }
    } finally {
      if (g === this.gen) this.draining = false
    }
  }
  /** run every posted event now (the window's Open has finished, its `postevent ue_postopen` must run before the first tab selection) */
  async flushPosted(): Promise<void> {
    this.gen++
    this.draining = false
    await this.drainPosted(this.gen)
  }
  yieldQueue(): void {
    this.gen++
    this.draining = false
    if (this.posted.length) {
      this.draining = true
      const g = this.gen
      setTimeout(() => void this.drainPosted(g), 0)
    }
  }
  onError: (e: unknown) => void = (e) => {
    console.error(e)
  }

  /** fire an event on an object; arguments are positional. Returns the value of the script (or null when no script) */
  async fire(obj: PBObject, event: string, args: unknown[] = []): Promise<unknown> {
    const entries = obj.findRoutines(event.toLowerCase())
    if (!entries.length) return null
    return this.runEntry(obj, this.pick(entries, args.length)!, args)
  }

  // ---------------------------------------------------------------- statements
  async execBlock(list: Stmt[], f: Frame): Promise<number> {
    let i = 0
    while (i < list.length) {
      const sig = await this.exec(list[i], f)
      if (sig === NONE) {
        i++
        continue
      }
      if (sig === GOTO) {
        const at = list.findIndex((s) => s.k === 'label' && s.l === f.gotoLabel)
        if (at >= 0) {
          i = at + 1
          continue
        }
      }
      return sig
    }
    return NONE
  }

  async cond(e: Expr, f: Frame): Promise<boolean> {
    const v = await this.eval(e, f)
    return v === true || (typeof v === 'number' && v !== 0)
  }

  async exec(s: Stmt, f: Frame): Promise<number> {
    switch (s.k) {
      case 'decl':
        for (const v of s.vars) {
          let val: unknown
          if (s.arr || v.dims) {
            val = new PBArray(s.t)
            if (v.dims && v.dims[0] && v.dims[0].length) {
              const n = toNum(await this.eval(v.dims[0][v.dims[0].length - 1], f))
              const arr = val as PBArray
              for (let i = 0; i < n; i++) arr.a.push(defaultValue(s.t))
            }
          } else val = v.init ? coerce(s.t, await this.eval(v.init, f)) : PRIMITIVES.has(s.t) ? defaultValue(s.t) : await this.defaultOf(s.t)
          f.locals.set(v.n, val)
          f.types.set(v.n, s.arr || v.dims ? s.t + '[]' : s.t)
        }
        return NONE
      case 'assign': {
        let val = await this.eval(s.r, f)
        if (s.op !== '=') {
          const cur = await this.eval(s.l, f)
          val = s.op === '+=' ? add(cur, val) : s.op === '-=' ? sub(cur, val) : s.op === '*=' ? mul(cur, val) : div(cur, val)
        }
        // `this.child = create child` re-creates nothing: controls are built structurally
        if (s.r.k === 'new' && typeof s.r.t === 'string' && s.l.k === 'mem' && s.l.o.k === 'id' && s.l.o.n === 'this' && f.self?.children.has(s.l.n)) return NONE
        await this.assign(s.l, val, f)
        return NONE
      }
      case 'expr':
        await this.eval(s.e, f)
        return NONE
      case 'if':
        if (await this.cond(s.c, f)) return this.execBlock(s.t, f)
        for (const ei of s.ei) if (await this.cond(ei.c, f)) return this.execBlock(ei.b, f)
        if (s.e) return this.execBlock(s.e, f)
        return NONE
      case 'choose': {
        const v = await this.eval(s.e, f)
        for (const c of s.cs) {
          for (const t of c.t) if (await this.caseMatch(t, v, f)) return this.execBlock(c.b, f)
        }
        if (s.d) return this.execBlock(s.d, f)
        return NONE
      }
      case 'for': {
        const a = toNum(await this.eval(s.a, f))
        const step = s.s ? toNum(await this.eval(s.s, f)) : 1
        if (step === 0) return NONE
        // an empty loop is a delay loop (`for ll_waitcount = 1 to 9999999 / next` of the SMS centre): it has no effect except the final value of the variable
        if (!s.body.length) {
          const lim = toNum(await this.eval(s.b, f))
          const n = step > 0 ? (a <= lim ? Math.floor((lim - a) / step) + 1 : 0) : a >= lim ? Math.floor((a - lim) / -step) + 1 : 0
          await this.assign(s.v, a + n * step, f)
          return NONE
        }
        // the compiled loop tests the limit expression again on every pass (`for i = 1 to ds.rowcount()` follows rows the body deletes)
        for (let i = a; ; i += step) {
          const b = toNum(await this.eval(s.b, f))
          if (!(step > 0 ? i <= b : i >= b)) break
          await this.assign(s.v, i, f)
          const sig = await this.execBlock(s.body, f)
          if (sig === EXIT) break
          if (sig === RETURN || sig === GOTO) return sig
          // loop variable may be changed by the body
          i = toNum(await this.eval(s.v, f))
        }
        return NONE
      }
      case 'while': {
        let guard = 0
        if (s.post) {
          do {
            if (++guard > this.loopLimit) throw new PBRuntimeError('Loop iteration limit exceeded')
            const sig = await this.execBlock(s.body, f)
            if (sig === EXIT) break
            if (sig === RETURN || sig === GOTO) return sig
          } while (s.until ? !(await this.cond(s.c, f)) : await this.cond(s.c, f))
          return NONE
        }
        while (s.until ? !(await this.cond(s.c, f)) : await this.cond(s.c, f)) {
          if (++guard > this.loopLimit) throw new PBRuntimeError('Loop iteration limit exceeded')
          const sig = await this.execBlock(s.body, f)
          if (sig === EXIT) break
          if (sig === RETURN || sig === GOTO) return sig
        }
        return NONE
      }
      case 'try': {
        try {
          return await this.execBlock(s.body, f)
        } catch (e) {
          if (e instanceof HaltSignal) throw e
          const c = s.catches[0]
          if (!c) throw e
          this.onCaught?.(e)
          const t = this.toThrowable(e)
          f.locals.set(c.v, t)
          f.types.set(c.v, c.t)
          return await this.execBlock(c.b, f)
        } finally {
          if (s.fin) await this.execBlock(s.fin, f)
        }
      }
      case 'return':
        f.ret = s.e ? await this.eval(s.e, f) : null
        if (f.routine && f.routine.ret && f.routine.ret !== '0' && f.ret !== null) f.ret = coerce(f.routine.ret, f.ret)
        return RETURN
      case 'exit':
        return EXIT
      case 'continue':
        return CONTINUE
      case 'halt':
        throw new HaltSignal('halt')
      case 'goto':
        f.gotoLabel = s.l
        return GOTO
      case 'label':
        return NONE
      case 'throw':
        throw await this.eval(s.e, f)
      case 'callsuper': {
        if (!f.self) return NONE
        const entries = f.self.findRoutines(s.n, f.scriptIdx + 1)
        if (entries.length) {
          const args = f.routine ? f.routine.params.map((p) => f.locals.get(p.n)) : []
          await this.runEntry(f.self, this.pick(entries, args.length)!, args)
        }
        return NONE
      }
      case 'destroy': {
        const o = await this.eval(s.e, f)
        if (o instanceof PBObject) o.destroy()
        return NONE
      }
      case 'sql':
        if (!this.sql) throw new PBRuntimeError('embedded SQL is not available in this runtime')
        await this.sql(this, f, s)
        return NONE
    }
  }

  toThrowable(e: unknown): unknown {
    if (e instanceof PBObject) return e
    const t = new PBThrowable(this, 'throwable', 'throwable')
    t.message = e instanceof Error ? e.message : String(e)
    return t
  }

  async caseMatch(t: CaseTest, v: unknown, f: Frame): Promise<boolean> {
    if (t.k === 'val') return equals(v, await this.eval(t.e, f))
    if (t.k === 'range') return cmp(v, await this.eval(t.a, f)) >= 0 && cmp(v, await this.eval(t.b, f)) <= 0
    const o = await this.eval(t.e, f)
    const c = cmp(v, o)
    switch (t.op) {
      case '>':
        return c > 0
      case '<':
        return c < 0
      case '>=':
        return c >= 0
      case '<=':
        return c <= 0
      case '<>':
        return c !== 0
      default:
        return c === 0
    }
  }

  // ---------------------------------------------------------------- expressions
  lookup(name: string, f: Frame): { found: boolean; value: unknown } {
    if (f.locals.has(name)) return { found: true, value: f.locals.get(name) }
    const s = f.self
    if (s && s.pbHas(name)) return { found: true, value: s.pbGet(name) }
    if (this.globals.has(name)) return { found: true, value: this.globals.get(name) }
    return { found: false, value: null }
  }

  async eval(e: Expr, f: Frame): Promise<unknown> {
    switch (e.k) {
      case 'num':
        return e.dec ? Dec.of(e.v) : e.v
      case 'str':
        return e.v
      case 'enum':
        return e.v
      case 'id': {
        switch (e.n) {
          case 'true':
            return true
          case 'false':
            return false
          case 'this':
            return f.self
          case 'parent':
            return f.self ? f.self.parent : null
          case 'null':
            return null
        }
        const r = this.lookup(e.n, f)
        if (r.found) return r.value
        if (e.n === 'ancestorreturnvalue') return null
        if (this.windowInstances.has(e.n)) return this.windowInstances.get(e.n)!
        this.noteMissing('var:' + e.n)
        return null
      }
      case 'global': {
        if (this.globals.has(e.n)) return this.globals.get(e.n)
        return null
      }
      case 'mem': {
        const o = await this.eval(e.o, f)
        return this.getMember(o, e.n)
      }
      case 'idx': {
        const o = await this.eval(e.o, f)
        const idx: unknown[] = []
        for (const x of e.i) idx.push(await this.eval(x, f))
        return await this.getIndex(o, idx)
      }
      case 'call':
        return this.evalCall(e, f)
      case 'super': {
        if (!f.self) return null
        const entries = f.self.findRoutines(e.n, f.scriptIdx + 1)
        const args: unknown[] = []
        for (const a of e.a) args.push(await this.eval(a, f))
        if (entries.length) return this.runEntry(f.self, this.pick(entries, args.length)!, args)
        return null
      }
      case 'un': {
        const v = await this.eval(e.e, f)
        if (v === null) return null
        if (e.op === 'not') return !(v === true || (typeof v === 'number' && v !== 0))
        return v instanceof Dec ? v.neg() : -toNum(v)
      }
      case 'bin':
        return this.evalBin(e, f)
      case 'arr': {
        const a = new PBArray('any')
        for (const x of e.e) a.a.push(await this.eval(x, f))
        return a
      }
      case 'new': {
        const name = typeof e.t === 'string' ? e.t : toStr(await this.eval(e.t, f))
        return this.createObject(name, f)
      }
    }
  }

  async createObject(name: string, f: Frame): Promise<unknown> {
    const key = name.toLowerCase()
    const cls = await this.getClass(key)
    if (cls && cls.kind === 'structure') return await this.newStruct(cls)
    // local type table: `create` of a name declared in the current frame's window as control
    const o = await this.instantiate(key, null)
    void f
    if (o.native !== 'window') await this.fire(o, 'constructor')
    await this.fireConstructors(o)
    return o
  }

  /** `constructor` events of all descendant controls (PowerBuilder runs them while a window / object is being created) */
  async fireConstructors(o: PBObject): Promise<void> {
    for (const c of o.children.values()) {
      await this.fire(c, 'constructor')
      await this.fireConstructors(c)
    }
  }

  /** default value of a declared type: primitives, arrays, structures (value types, always present) or null for objects */
  async defaultOf(type: string): Promise<unknown> {
    if (type.endsWith('[]')) return new PBArray(type.slice(0, -2))
    if (PRIMITIVES.has(type)) return defaultValue(type)
    // a DataWindowChild variable is usable before GetChild filled it (calls answer -1): w_purchase (opening purchase) filters one it never assigned
    if (type === 'datawindowchild') return this.natives.get(type)?.(this, type) ?? null
    const c = await this.getClass(type)
    if (c && c.kind === 'structure') return this.newStruct(c)
    return null
  }

  async newStruct(cls: ClassDef): Promise<PBStruct> {
    const s = new PBStruct(cls.name)
    for (const fd of cls.fields) {
      const t = fd.type.toLowerCase()
      const init = PRIMITIVES.has(t) && fd.value !== undefined && fd.value !== null && typeof fd.value !== 'object' ? fd.value : await this.defaultOf(t)
      s.f.set(fd.name, init)
    }
    return s
  }

  async evalBin(e: Extract<Expr, { k: 'bin' }>, f: Frame): Promise<unknown> {
    if (e.op === 'and' || e.op === 'or') {
      const l = await this.eval(e.l, f)
      const lt = l === null ? null : l === true || (typeof l === 'number' && l !== 0)
      if (e.op === 'and') {
        if (lt === false) return false
        const r = await this.eval(e.r, f)
        const rt = r === null ? null : r === true || (typeof r === 'number' && r !== 0)
        if (rt === false) return false
        return lt === null || rt === null ? null : true
      }
      if (lt === true) return true
      const r = await this.eval(e.r, f)
      const rt = r === null ? null : r === true || (typeof r === 'number' && r !== 0)
      if (rt === true) return true
      return lt === null || rt === null ? null : false
    }
    const l = await this.eval(e.l, f)
    const r = await this.eval(e.r, f)
    switch (e.op) {
      case '+':
        return add(l, r)
      case '-':
        return sub(l, r)
      case '*':
        return mul(l, r)
      case '/':
        return div(l, r)
      case 'mod':
        return l === null || r === null ? null : toNum(l) % toNum(r)
      case '^':
        return l === null || r === null ? null : Math.pow(toNum(l), toNum(r))
    }
    if (l === null || r === null) return null
    const c = cmp(l, r)
    switch (e.op) {
      case '=':
        return equals(l, r)
      case '<>':
        return !equals(l, r)
      case '<':
        return c < 0
      case '>':
        return c > 0
      case '<=':
        return c <= 0
      case '>=':
        return c >= 0
    }
    throw new PBRuntimeError('unknown operator ' + e.op)
  }

  getMember(o: unknown, name: string): unknown {
    if (o === null || o === undefined) throw new PBRuntimeError(`Null object reference (reading ${name})`)
    if (isMember(o)) return o.pbGet(name)
    if (o instanceof Map) return o.get(name) ?? null
    if (typeof o === 'object') return (o as Record<string, unknown>)[name] ?? null
    this.noteMissing('member:' + typeof o + '.' + name)
    return null
  }

  getIndex(o: unknown, idx: unknown[]): unknown {
    if (o === null || o === undefined) throw new PBRuntimeError('Null object reference (array access)')
    if (o instanceof PBArray) {
      const i = toNum(idx[0]) - 1
      if (i < 0) return null
      if (idx.length > 1) {
        const v = o.md?.get(idx.map((x) => toNum(x)).join(','))
        return v === undefined ? defaultValue(o.type) : v
      }
      return i < o.a.length ? o.a[i] : defaultValue(o.type)
    }
    const m = o as Member
    if (m.pbIndex) return m.pbIndex(idx)
    return null
  }

  setIndex(o: unknown, idx: unknown[], v: unknown): void {
    if (o instanceof PBArray) {
      const i = toNum(idx[0]) - 1
      if (i < 0) throw new PBRuntimeError('Array index out of bounds')
      while (o.a.length <= i && idx.length > 1) o.a.push(defaultValue(o.type))
      if (idx.length > 1) {
        ;(o.md ??= new Map()).set(idx.map((x) => toNum(x)).join(','), o.type === 'any' ? v : coerce(o.type, v))
        return
      }
      while (o.a.length < i) o.a.push(defaultValue(o.type))
      o.a[i] = o.type === 'any' ? v : coerce(o.type, v)
      return
    }
    const m = o as Member
    if (m && m.pbSetIndex) m.pbSetIndex(idx, v)
    else throw new PBRuntimeError('Null object reference (array assignment)')
  }

  async assign(target: Expr, v: unknown, f: Frame): Promise<void> {
    switch (target.k) {
      case 'id': {
        const n = target.n
        if (f.locals.has(n)) {
          const t = f.types.get(n)
          f.locals.set(n, t && !t.endsWith('[]') ? coerce(t, v) : v)
          return
        }
        if (f.self && f.self.pbHas(n)) {
          f.self.pbSet(n, v)
          return
        }
        if (this.globals.has(n)) {
          const t = this.gtypes.get(n)
          this.globals.set(n, t ? coerce(t, v) : v)
          return
        }
        // undeclared name: behave like a global (keeps scripts running; reported by the coverage tools)
        this.noteMissing('assign:' + n)
        this.globals.set(n, v)
        return
      }
      case 'global': {
        const t = this.gtypes.get(target.n)
        this.globals.set(target.n, t ? coerce(t, v) : v)
        return
      }
      case 'mem': {
        const o = await this.eval(target.o, f)
        if (o === null || o === undefined) throw new PBRuntimeError(`Null object reference (writing ${target.n})`)
        if (isMember(o)) o.pbSet(target.n, v)
        else if (o instanceof Map) o.set(target.n, v)
        return
      }
      case 'idx': {
        const idx: unknown[] = []
        for (const x of target.i) idx.push(await this.eval(x, f))
        let base = await this.eval(target.o, f)
        // auto-create arrays on first assignment (also where the member of a structure holds a placeholder instead of an array)
        if (base === null || base === undefined || (!(base instanceof PBArray) && !(base as Member | undefined)?.pbSetIndex)) {
          base = new PBArray('any')
          await this.assign(target.o, base, f)
        }
        try {
          this.setIndex(base, idx, v)
        } catch (e) {
          if (e instanceof PBRuntimeError) e.message += ` [${exprText(target.o)}]`
          throw e
        }
        return
      }
      default:
        throw new PBRuntimeError('invalid assignment target')
    }
  }

  /** reference to an lvalue expression (for ref arguments) */
  refOf(e: Expr, f: Frame): Ref {
    const r = this.refOf0(e, f)
    if (e.k === 'id') {
      r.name = e.n
      r.typ = f.types.get(e.n) || this.gtypes.get(e.n) || ''
    }
    return r
  }
  /** like refOf, but a member / element lvalue (`this.is_x`, `la[i]`) hands its current value in: a `ref` parameter may be read before it is written */
  async refWithValue(e: Expr, f: Frame): Promise<Ref> {
    if (e.k === 'id') return this.refOf(e, f)
    let cur: unknown = null
    try {
      cur = await this.eval(e, f)
    } catch {
      cur = null
    }
    return new Ref(
      () => cur,
      async (v) => {
        cur = v
        try {
          await this.assign(e, v, f)
        } catch {
          /* an expression that is not an lvalue: the value stays in the reference only */
        }
      },
    )
  }
  private refOf0(e: Expr, f: Frame): Ref {
    return new Ref(
      () => {
        // synchronous read of variables only (the common case for ref arguments)
        if (e.k === 'id') return this.lookup(e.n, f).value
        return null
      },
      (v) => this.assign(e, v, f),
    )
  }

  async evalCall(e: Extract<Expr, { k: 'call' }>, f: Frame): Promise<unknown> {
    const mods = e.m || ''
    const post = mods.includes('post')
    // ---- receiver call
    if (e.o) {
      const recv = await this.eval(e.o, f)
      const args: unknown[] = []
      let refIdx = REF_METHODS[e.n]
      // RPC calls on a transaction object: INOUT / OUT parameters come back through the arguments
      if (!refIdx && recv instanceof PBObject && recv.native === 'transaction' && this.procs?.refPositions) refIdx = this.procs.refPositions(e.n)
      // a script routine of the receiver with `ref` parameters (`w_main.wf_getappname(ref string as_appname)`) gets references for them
      if (!refIdx && recv instanceof PBObject) {
        const ents = recv.findRoutines(e.n)
        if (ents.length) {
          const idx = this.pick(ents, e.a.length)!.r.params.flatMap((p, i) => (p.ref ? [i] : []))
          if (idx.length) refIdx = idx
        }
      }
      for (let i = 0; i < e.a.length; i++) args.push(refIdx && refIdx.includes(i) ? await this.refWithValue(e.a[i], f) : await this.eval(e.a[i], f))
      if (recv === null || recv === undefined) throw new PBRuntimeError(`Null object reference (calling ${e.n})`)
      const run = async (): Promise<unknown> => {
        if (recv instanceof PBObject) return this.callMethod(recv, e.n, args)
        const m = recv as Member
        if (m && m.pbCall) return m.pbCall(e.n, args, this)
        this.noteMissing('method:' + typeof recv + '.' + e.n)
        return null
      }
      if (post) {
        this.post(async () => void (await run()))
        return 1
      }
      return run()
    }
    // ---- unqualified call: routine of this object, global function, system function
    const self = f.self
    const name = e.n
    let entries = self ? self.findRoutines(name) : []
    // a plain call never runs an *event* that shares its name with a system function: `close(this)` inside the Close event closes the window
    if (entries.length && !mods.includes('event') && this.sys.has(name) && entries.every((x) => x.r.event)) entries = []
    if (entries.length) {
      const entry = this.pick(entries, e.a.length)!
      const args = await this.evalArgs(e.a, f, entry.r)
      if (post) {
        this.post(async () => void (await this.runEntry(self!, entry, args)))
        return 1
      }
      return this.runEntry(self!, entry, args)
    }
    // the object's native methods (this.settransobject ...) when called without receiver
    if (self) {
      const nm = (self as unknown as Record<string, unknown>)['n_' + name]
      if (typeof nm === 'function') {
        const args: unknown[] = []
        for (const a of e.a) args.push(await this.eval(a, f))
        return (nm as (...a: unknown[]) => unknown).apply(self, args)
      }
    }
    const sf = this.sys.get(name)
    if (sf) {
      const args: unknown[] = []
      for (let i = 0; i < e.a.length; i++) args.push(sf.refs && sf.refs.includes(i) ? this.refOf(e.a[i], f) : await this.eval(e.a[i], f))
      if (post) {
        this.post(async () => void (await sf.fn(this, args, f)))
        return 1
      }
      return sf.fn(this, args, f)
    }
    // global function object (f_xxx)
    const gf = await this.getClass(name)
    if (gf && gf.kind === 'function') {
      const holder = await this.instantiate(name, null)
      const ents = holder.findRoutines(name)
      if (ents.length) {
        const entry = this.pick(ents, e.a.length)!
        const args = await this.evalArgs(e.a, f, entry.r)
        if (post) {
          this.post(async () => void (await this.runEntry(holder, entry, args)))
          return 1
        }
        return this.runEntry(holder, entry, args)
      }
    }
    // events/functions with a native default (triggerevent, postevent, classname ...)
    if (self && ['triggerevent', 'postevent', 'classname', 'typeof'].includes(name)) {
      const args: unknown[] = []
      for (const a of e.a) args.push(await this.eval(a, f))
      return this.callNative(self, name, args)
    }
    this.noteMissing('fn:' + name)
    for (const a of e.a) await this.eval(a, f)
    return null
  }

  async evalArgs(exprs: Expr[], f: Frame, r: Routine): Promise<unknown[]> {
    const out: unknown[] = []
    for (let i = 0; i < exprs.length; i++) {
      const p = r.params[i]
      out.push(p && p.ref ? await this.refWithValue(exprs[i], f) : await this.eval(exprs[i], f))
    }
    return out
  }

  isNullValue(v: unknown): boolean {
    return isNull(v)
  }
}
