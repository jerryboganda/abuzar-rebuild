// Structural parity of form arrangement.  The Classic view paints every object at its source coordinates, so two fields that
// share a row stay on one row and a wide field next to a narrow one keeps that proportion.  The Modern layout reproduces that
// structure (not the pixels): objects whose vertical extents overlap form one line, ordered left to right, and each cell
// takes a share of the line in proportion to the width the source gives it.
import type { DwDef, DwObject } from '../dw/def.ts'
import type { DataSurface, DataSurfaceField } from './data-surfaces.ts'

export interface PlanBox { key: string; left: number; right: number; top: number; bottom: number; /** The share of the line this cell takes; defaults to the box width. */ weight?: number }
export interface PlanCell { key: string; weight: number }

/** Groups boxes into lines (top to bottom) of cells (left to right) by overlap of their vertical extents. */
export function planLines(boxes: readonly PlanBox[]): PlanCell[][] {
  const sorted = [...boxes].sort((a, b) => a.top - b.top || a.left - b.left)
  const lines: { top: number; bottom: number; cells: PlanBox[] }[] = []
  for (const box of sorted) {
    const height = Math.max(1, box.bottom - box.top)
    const line = lines.find((candidate) => {
      const overlap = Math.min(box.bottom, candidate.bottom) - Math.max(box.top, candidate.top)
      return overlap >= 0.5 * Math.min(height, Math.max(1, candidate.bottom - candidate.top))
    })
    if (line) {
      line.cells.push(box)
      line.top = Math.min(line.top, box.top)
      line.bottom = Math.max(line.bottom, box.bottom)
    } else lines.push({ top: box.top, bottom: box.bottom, cells: [box] })
  }
  return lines.sort((a, b) => a.top - b.top).map((line) =>
    line.cells.sort((a, b) => a.left - b.left || a.top - b.top).map((cell) => ({ key: cell.key, weight: Math.max(1, cell.weight ?? cell.right - cell.left) })))
}

/**
 * The source box of one or more objects.  With the DataWindow's runtime overrides, a script's Modify of visibility, position or
 * size counts as it does for the Classic view (a column switched on at run time takes its place; a moved field is placed where
 * the script put it).
 */
export function boxOf(def: DwDef, names: readonly (string | undefined)[], key: string, weightOf?: string,
  overrides?: ReadonlyMap<string, string>): PlanBox | null {
  // A RichText input field can lose its object name in recovery; its single table column names it.
  const nameOf = (object: DwObject): string => object.name ??
    (Number(def.datawindow.processing ?? 0) === 7 && object.type === 'column' && def.table.columns.length === 1
      ? def.table.columns[0].name : '')
  const property = (object: DwObject, name: string) => overrides?.get(`${nameOf(object).toLowerCase()}.${name}`) ?? object[name]
  const num = (object: DwObject | undefined, name: string): number => {
    const value = Number(object ? property(object, name) : undefined)
    return Number.isFinite(value) ? value : 0
  }
  const objects = names.flatMap((name) => {
    const found = name ? def.objects.find((object) => nameOf(object).toLowerCase() === name.toLowerCase()) : undefined
    return found ? [found] : []
  }).filter((object) => property(object, 'visible') !== '0')
  if (!objects.length) return null
  const left = Math.min(...objects.map((object) => num(object, 'x')))
  const top = Math.min(...objects.map((object) => num(object, 'y')))
  const editor = weightOf ? def.objects.find((object) => nameOf(object).toLowerCase() === weightOf.toLowerCase()) : undefined
  return {
    key, left, top, ...(editor && num(editor, 'width') > 0 ? { weight: num(editor, 'width') } : {}),
    right: Math.max(...objects.map((object) => num(object, 'x') + num(object, 'width'))),
    bottom: Math.max(...objects.map((object) => num(object, 'y') + Math.max(1, num(object, 'height')))),
  }
}

/** The line each form field belongs to and its share of that line, from the source geometry (label, editor and suffix together). */
export function formLinePlan(def: DwDef, surface: DataSurface, fieldNames?: readonly string[]): Map<string, { line: number; weight: number }> {
  const wanted = fieldNames ? new Set(fieldNames) : undefined
  const boxes = surface.fields.flatMap((field: DataSurfaceField) => {
    if (wanted && !wanted.has(field.object)) return []
    const box = boxOf(def, [field.labelBand === 'header' ? undefined : field.labelObject, field.object, field.suffixObject], field.object, field.object)
    return box ? [box] : []
  })
  const plan = new Map<string, { line: number; weight: number }>()
  planLines(boxes).forEach((line, index) => { for (const cell of line) plan.set(cell.key, { line: index, weight: cell.weight }) })
  return plan
}

/** The line each groupbox belongs to (groupboxes that sit side by side share a line). */
export function groupLinePlan(def: DwDef, groups: readonly string[]): Map<string, { line: number; weight: number }> {
  const boxes = groups.flatMap((group) => { const box = boxOf(def, [group], group); return box ? [box] : [] })
  const plan = new Map<string, { line: number; weight: number }>()
  planLines(boxes).forEach((line, index) => { for (const cell of line) plan.set(cell.key, { line: index, weight: cell.weight }) })
  return plan
}
