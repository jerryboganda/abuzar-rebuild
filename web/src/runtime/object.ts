// Object model of the PowerScript runtime: class definitions loaded from the recovered data, and live instances.
import type { Routine } from '../pbscript/ast.ts'
import { coerce, defaultValue, PBArray } from './values.ts'
import type { Runtime } from './interp.ts'

export interface FieldDef {
  name: string
  type: string
  attr: string // '0xbc' property, '0xcc' instance variable ...
  value: unknown
}

export interface ControlDef {
  name: string
  ancestor: string
  fields: FieldDef[]
  controls: ControlDef[]
}

export interface ClassDef {
  name: string
  kind: string // window | menu | userobject | function | structure | application
  ancestor: string | null
  library: string
  fields: FieldDef[]
  controls: ControlDef[]
  /** owner (object or control name) -> routine name -> overloads */
  routines: Map<string, Map<string, Routine[]>>
}

export interface ScriptSource {
  cls: ClassDef
  owner: string
}
export interface RoutineEntry {
  r: Routine
  idx: number
}

/** anything that scripts can read/write members of, index and call methods on */
export interface Member {
  pbGet(name: string): unknown
  pbSet(name: string, value: unknown): void
  pbHas?(name: string): boolean
  pbIndex?(idx: unknown[]): unknown
  pbSetIndex?(idx: unknown[], value: unknown): void
  pbCall?(name: string, args: unknown[], rt: Runtime): Promise<unknown> | unknown
}

export function isMember(v: unknown): v is Member {
  return typeof v === 'object' && v !== null && typeof (v as Member).pbGet === 'function'
}

/** structure instance (PowerScript `structure`) */
export class PBStruct implements Member {
  typeName: string
  f = new Map<string, unknown>()
  constructor(typeName: string) {
    this.typeName = typeName
  }
  pbGet(name: string): unknown {
    return this.f.get(name) ?? null
  }
  pbSet(name: string, v: unknown): void {
    this.f.set(name, v)
  }
  pbHas(name: string): boolean {
    return this.f.has(name)
  }
  copy(): PBStruct {
    const s = new PBStruct(this.typeName)
    for (const [k, v] of this.f) s.f.set(k, v instanceof PBStruct ? v.copy() : v instanceof PBArray ? new PBArray(v.type, v.a.slice()) : v)
    return s
  }
}

/** a live object: window, control, menu item, user object, global function holder ... */
export class PBObject implements Member {
  rt: Runtime
  className: string
  /** script sources, most specific first: (class, owner name) pairs whose routines apply to this object */
  scripts: ScriptSource[] = []
  native: string // name of the native root class (window, commandbutton, datawindow, nonvisualobject ...)
  props = new Map<string, unknown>()
  types = new Map<string, string>()
  children = new Map<string, PBObject>()
  parent: PBObject | null = null
  /** name of this control inside its parent (or the object name for top-level objects) */
  name = ''
  destroyed = false
  /** UI binding hook: called after a property changed */
  onProp: ((name: string, value: unknown) => void) | null = null

  constructor(rt: Runtime, className: string, native: string) {
    this.rt = rt
    this.className = className
    this.native = native
  }

  // ---------------------------------------------------------------- members
  pbHas(name: string): boolean {
    return this.props.has(name) || this.children.has(name) || this.hasNative(name)
  }
  hasNative(_name: string): boolean {
    return false
  }
  pbGet(name: string): unknown {
    if (this.props.has(name)) return this.props.get(name)
    const c = this.children.get(name)
    if (c) return c
    return this.getNative(name)
  }
  getNative(name: string): unknown {
    if (name === 'classname') return this.className
    if (name === 'parent') return this.parent
    return null
  }
  pbSet(name: string, value: unknown): void {
    if (this.props.has(name)) {
      const t = this.types.get(name)
      const v = t ? coerce(t, value) : value
      this.props.set(name, v)
      if (this.onProp) this.onProp(name, v)
      return
    }
    this.setNative(name, value)
  }
  setNative(name: string, value: unknown): void {
    // unknown property: keep it (PowerScript would be a compile error; being permissive keeps scripts running)
    this.props.set(name, value)
    if (this.onProp) this.onProp(name, value)
  }

  declare(name: string, type: string, value?: unknown): void {
    this.types.set(name, type)
    this.props.set(name, value === undefined ? defaultValue(type) : value)
  }

  // ---------------------------------------------------------------- routines
  /** routines called `name`, most specific source first; each entry remembers its position in `scripts` (for super::) */
  findRoutines(name: string, from = 0): RoutineEntry[] {
    const out: RoutineEntry[] = []
    for (let i = from; i < this.scripts.length; i++) {
      const sc = this.scripts[i]
      const list = sc.cls.routines.get(sc.owner)?.get(name)
      if (list) for (const r of list) out.push({ r, idx: i })
    }
    return out
  }

  async pbCall(name: string, args: unknown[], rt: Runtime): Promise<unknown> {
    return rt.callMethod(this, name, args)
  }

  destroy(): void {
    this.destroyed = true
    for (const c of this.children.values()) c.destroy()
  }
}
