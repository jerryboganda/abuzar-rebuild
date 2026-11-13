// The argument a caller passes to a window.
//
// Some windows are never opened on their own: the application opens them with `openwithparm(window, argument)`,
// and their own Open event reads that argument (a DataWindow, or a structure that carries one).  A sweep that
// opens every window without its argument measures nothing: the window reads a null object and stops, exactly as
// the original would.  This module builds the same argument for those windows, so a sweep opens every window the
// way the application opens it.
import type { Runtime } from '../runtime/interp.ts'
import type { PBObject } from '../runtime/object.ts'
import { PBStruct } from '../runtime/object.ts'
import type { NDwBase } from '../runtime/native/dwctrl.ts'

/** a DataWindow control without a definition: the caller passes the grid it works on */
function emptyDataWindow(rt: Runtime): NDwBase {
  return rt.natives.get('datawindow')!(rt, 'u_dwstandard')
}

/** an empty datastore: the caller passes the buffers of the document it opens */
function emptyDatastore(rt: Runtime): NDwBase {
  return rt.natives.get('datastore')!(rt, 'datastore')
}

/** an empty graph control: the graph viewer passes the graph it draws */
function emptyGraph(rt: Runtime): PBObject {
  return rt.natives.get('graph')!(rt, 'gr_mygraph')
}

/** the structure the caller passes, with the objects it carries */
async function structure(rt: Runtime, type: string, objects: Record<string, () => PBObject>): Promise<PBStruct> {
  const cls = await rt.getClass(type)
  const s = cls ? await rt.newStruct(cls) : new PBStruct(type)
  for (const [name, make] of Object.entries(objects)) s.f.set(name, make())
  return s
}

export interface WindowArgument {
  /** the caller passes a DataWindow itself */
  datawindow?: boolean
  /** the caller passes the graph control itself */
  graph?: boolean
  /** the caller passes a structure of this type, with these object fields */
  struct?: { type: string; objects: Record<string, () => PBObject> }
}

/**
 * The windows the application opens with an argument, and the argument it passes.
 *
 * | window | caller | argument |
 * |---|---|---|
 * | `w_findwindow` | `u_dwstandard` (the Find button of every grid) | the grid itself |
 * | `w_printer` | the report viewers | the report DataWindow |
 * | `w_select` | the report viewers (`s_dwinfo`) | the report DataWindow |
 * | `w_graphviewer`, `w_graph_series` | the report viewer / the graph viewer (`str_graphobjectatpoint`) | the graph's DataWindow and the graph itself |
 * | `w_graph_type`, `w_graph_color`, `w_graph_title`, `w_graph_spacing`, `w_graph_rotation`, `w_graph_division` | the graph viewer | the graph they change |
 * | `w_alternate_item_aliasname_form`, `w_alternate_item_aliasname_req_form`, `w_item_pricepolicy_form` | the item forms (`s_dw_header`) | the header DataWindow |
 * | `w_saleinpurchase` | `w_purchase` (`s_datastore`) | the purchase's DataWindow and buffers |
 * | `w_visitprescription` | `w_visit_form` (`s_datastore`) | the prescription's DataWindow and buffers |
 */
export const WINDOW_ARGUMENTS: Record<string, WindowArgument> = {
  w_findwindow: { datawindow: true },
  w_printer: { datawindow: true },
  w_select: { struct: { type: 's_dwinfo', objects: { dw_control: (rt) => emptyDataWindow(rt) } } },
  w_graph_series: { struct: { type: 'str_graphobjectatpoint', objects: { dw_dw1: (rt) => emptyDataWindow(rt), graphicobject: (rt) => emptyGraph(rt) } } },
  w_graphviewer: { struct: { type: 'str_graphobjectatpoint', objects: { dw_dw1: (rt) => emptyDataWindow(rt), graphicobject: (rt) => emptyGraph(rt) } } },
  // the graph dialogs of the graph viewer receive the graph they change
  w_graph_type: { graph: true },
  w_graph_color: { graph: true },
  w_graph_title: { graph: true },
  w_graph_spacing: { graph: true },
  w_graph_rotation: { graph: true },
  w_graph_division: { graph: true },
  w_alternate_item_aliasname_form: { struct: { type: 's_dw_header', objects: { dw_header: (rt) => emptyDataWindow(rt) } } },
  w_alternate_item_aliasname_req_form: { struct: { type: 's_dw_header', objects: { dw_header: (rt) => emptyDataWindow(rt) } } },
  w_item_pricepolicy_form: { struct: { type: 's_dw_header', objects: { dw_header: (rt) => emptyDataWindow(rt) } } },
  w_saleinpurchase: {
    struct: {
      type: 's_datastore',
      objects: {
        dw: (rt) => emptyDataWindow(rt),
        ds1: (rt) => emptyDatastore(rt),
        ds2: (rt) => emptyDatastore(rt),
        ds3: (rt) => emptyDatastore(rt),
      },
    },
  },
  w_visitprescription: {
    struct: {
      type: 's_datastore',
      objects: {
        ds: (rt) => emptyDatastore(rt),
        dw: (rt) => emptyDataWindow(rt),
        ds1: (rt) => emptyDatastore(rt),
        ds2: (rt) => emptyDatastore(rt),
        ds3: (rt) => emptyDatastore(rt),
      },
    },
  },
}

/**
 * The stand-in for the argument of a window the application opens without one: every field answers with 0 (or with
 * empty text for a name that starts with s_ / as_ / is_), the way an empty structure does.
 */
export class LooseArgument extends PBStruct {
  override pbGet(name: string): unknown {
    if (this.f.has(name)) return this.f.get(name)
    return /^(s|as|is)_/.test(name) ? '' : 0
  }
}

/** the argument the application passes to a window (a DataWindow, or a structure that carries one) */
export async function windowArgument(rt: Runtime, name: string): Promise<PBObject | PBStruct> {
  const spec = WINDOW_ARGUMENTS[name.toLowerCase()]
  if (!spec) return new LooseArgument('arguments')
  if (spec.datawindow) return emptyDataWindow(rt)
  if (spec.graph) return emptyGraph(rt)
  if (spec.struct) {
    const objects: Record<string, () => PBObject> = {}
    for (const [field, make] of Object.entries(spec.struct.objects)) objects[field] = () => make(rt)
    return await structure(rt, spec.struct.type, objects)
  }
  return new LooseArgument('arguments')
}
