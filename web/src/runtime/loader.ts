// Loads class definitions (data/classes/<name>.json) through an injected reader (fetch in the browser, fs in tests).
import type { ClassLoader } from './interp.ts'
import type { ClassDef } from './object.ts'
import type { Routine } from '../pbscript/ast.ts'
import { fixClassData } from './class-fixes.ts'

interface RawClass extends Omit<ClassDef, 'routines'> {
  routines: Record<string, Record<string, Routine[]>>
}

export class JsonClassLoader implements ClassLoader {
  read: (name: string) => Promise<string | undefined>
  /**
   * The names of the class files that exist (data/classes/_index.json).  A name that is not in it (a menu item, a built-in
   * control class such as `checkbox`) has no file: asking the server for it only produces a 404.  The login of the main window
   * asked for 1,482 such names one by one, which took seconds on the main PC and far longer over the network.
   * Without the index (an older build, tests) every name is read.
   */
  known?: ReadonlySet<string>
  constructor(read: (name: string) => Promise<string | undefined>, known?: ReadonlySet<string>) {
    this.read = read
    this.known = known
  }
  async load(name: string): Promise<ClassDef | undefined> {
    if (this.known && !this.known.has(name.toLowerCase())) return undefined
    const txt = await this.read(name)
    if (!txt) return undefined
    const raw = JSON.parse(txt) as RawClass
    // The recovered JSON can be regenerated at any time and loses a few
    // initialisers/contracts the decompiler could not express.  Apply the
    // corrections in memory so runtime behaviour never depends on the last
    // writer of the class files.
    fixClassData(name, raw)
    const routines = new Map<string, Map<string, Routine[]>>()
    for (const [owner, byName] of Object.entries(raw.routines)) {
      const m = new Map<string, Routine[]>()
      for (const [rn, list] of Object.entries(byName)) m.set(rn, list)
      routines.set(owner, m)
    }
    return { name: raw.name, kind: raw.kind, ancestor: raw.ancestor, library: raw.library, fields: raw.fields, controls: raw.controls, routines }
  }
}
