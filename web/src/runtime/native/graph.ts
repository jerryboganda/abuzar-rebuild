// The PowerBuilder graph control (the graph viewer of the application).
//
// The scripts use a small part of the control: the series and the data they add, the two axis labels, the drawing
// options the graph dialogs set (type, rotation, spacing, colours) and the clipboard / print / save actions.  The
// chart itself is drawn by the DOM layer from the series this class keeps.
import type { Runtime } from '../interp.ts'
import { PBObject } from '../object.ts'
import type { Member } from '../object.ts'
import { toNum, toStr } from '../values.ts'
import { NControl } from './controls.ts'

/** one axis of the graph: the categories or the values */
export class NGraphAxis implements Member {
  graph: NGraph
  name: string
  private values = new Map<string, unknown>()
  constructor(graph: NGraph, name: string) {
    this.graph = graph
    this.name = name
  }
  pbGet(prop: string): unknown {
    if (this.values.has(prop)) return this.values.get(prop)
    if (prop === 'label') return ''
    return null
  }
  pbSet(prop: string, value: unknown): void {
    this.values.set(prop, value)
    this.graph.changed()
  }
  /** the label the scripts read and write */
  get label(): string {
    return toStr(this.values.get('label') ?? '')
  }
}

export interface GraphSeries {
  name: string
  points: { value: number; category: string }[]
}

export class NGraph extends NControl {
  series: GraphSeries[] = []
  category = new NGraphAxis(this, 'category')
  values = new NGraphAxis(this, 'values')

  constructor(rt: Runtime, className: string) {
    super(rt, className, 'graph')
  }

  override getNative(name: string): unknown {
    switch (name) {
      case 'category': return this.category
      case 'values': return this.values
      case 'title': return this.props.get('title') ?? ''
      case 'graphtype': return this.props.get('graphtype') ?? 1
      case 'rotation': return this.props.get('rotation') ?? 0
      case 'spacing': return this.props.get('spacing') ?? 0
      case 'backcolor': return this.props.get('backcolor') ?? 16777215
      case 'color': return this.props.get('color') ?? 0
      case 'textcolor': return this.props.get('textcolor') ?? 0
      case 'categorysort': return this.props.get('categorysort') ?? 'unsorted!'
      case 'data': return this.props.get('data') ?? null
    }
    return super.getNative(name)
  }

  override setNative(name: string, value: unknown): void {
    super.setNative(name, value)
  }

  /** TypeOf(): the graph control answers "graph" */
  n_typeof(): string {
    return 'graph'
  }

  /** Reset(all!): the graph keeps no series and no data */
  async n_reset(): Promise<number> {
    this.series = []
    this.changed()
    return 1
  }

  /** AddSeries(name): the number of the new series (1 is the first) */
  n_addseries(name: unknown): number {
    this.series.push({ name: toStr(name), points: [] })
    this.changed()
    return this.series.length
  }

  /** AddData(series, value, category): one point of a series */
  n_adddata(series: unknown, value: unknown, category: unknown): number {
    const index = Math.round(toNum(series))
    const target = this.series[index - 1] ?? this.series[0]
    if (!target) return -1
    target.points.push({ value: toNum(value), category: toStr(category) })
    this.changed()
    return 1
  }

  /** FindSeries(name): the number of the series, -1 when it does not exist */
  n_findseries(name: unknown): number {
    const index = this.series.findIndex((s) => s.name === toStr(name))
    return index < 0 ? -1 : index + 1
  }

  /** the categories in the order they were added */
  get categories(): string[] {
    const out: string[] = []
    for (const s of this.series) for (const p of s.points) if (!out.includes(p.category)) out.push(p.category)
    return out
  }

  n_clipboard(): number {
    return 1
  }

  n_saveas(): number {
    return 1
  }

  n_print(..._args: unknown[]): number {
    return 1
  }
}

/** the graph object a script passes around (`graphicobject`): the control itself */
export function graphOf(value: unknown): NGraph | null {
  return value instanceof NGraph ? value : null
}

export { PBObject }
