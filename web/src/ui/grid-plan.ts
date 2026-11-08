// Structural parity of arrangement (decision 17).  The Classic view paints every object at its source coordinates; the Modern layout
// reproduces the *structure* of that arrangement with a CSS grid derived from the same coordinates: objects that share a row share
// grid rows, a tall object beside two stacked ones spans both rows, and column widths are proportional to the source widths.  Only the
// geometry of tracks is derived; the DOM order of the elements (and so the tab order) is left exactly as it is.
export interface GridBox {
  key: string; left: number; right: number; top: number; bottom: number
  /** A container whose own content sizes it (a groupbox, an embedded tab or DataWindow): it adds no minimum height to the rows it spans. */
  flex?: boolean
}
export interface GridPlacement { colStart: number; colEnd: number; rowStart: number; rowEnd: number }
export interface GridPlan {
  /** Relative widths (fr) of the column tracks that carry content. */
  columns: number[]
  /** Number of row tracks. */
  rows: number
  /** Source height of each row track (the distance between its edges), so rows keep the source's vertical proportions. */
  rowSizes: number[]
  /** A typical field height in source units: the scale that maps a source height to a Modern line height. */
  unit: number
  place: Map<string, GridPlacement>
}

const MAX_COLUMNS = 24

/**
 * The cell of a field is its editor, plus a caption or suffix that shares the editor's row (a caption left of the editor).  A caption
 * on another row (above the editor) is part of the cell's own content, not a reason to occupy that row as well.
 */
export function anchoredBox(key: string, editor: GridBox, others: readonly GridBox[]): GridBox {
  const height = Math.max(1, editor.bottom - editor.top)
  let { left, right, top, bottom } = editor
  for (const other of others) {
    const overlap = Math.min(editor.bottom, other.bottom) - Math.max(editor.top, other.top)
    if (overlap >= 0.5 * Math.min(height, Math.max(1, other.bottom - other.top))) {
      left = Math.min(left, other.left); right = Math.max(right, other.right); top = Math.min(top, other.top); bottom = Math.max(bottom, other.bottom)
    }
  }
  return { key, left, right, top, bottom }
}

/** Snaps near-equal coordinates together; edges closer than `tolerance` become one edge. */
function snapEdges(values: number[], tolerance: number): number[] {
  const sorted = [...values].sort((a, b) => a - b)
  const edges: number[] = []
  let group: number[] = []
  const flush = () => { if (group.length) edges.push(group.reduce((sum, value) => sum + value, 0) / group.length); group = [] }
  for (const value of sorted) {
    if (group.length && value - group[0] > tolerance) flush()
    group.push(value)
  }
  flush()
  return edges
}

const nearest = (edges: readonly number[], value: number): number => {
  let best = 0
  for (let index = 1; index < edges.length; index++) if (Math.abs(edges[index] - value) < Math.abs(edges[best] - value)) best = index
  return best
}

/** Tracks between consecutive edges that some box covers; returns the track list and, per edge, its grid line number. */
function tracksOf(edges: readonly number[], spans: readonly [number, number][], flexible: readonly boolean[] = []): { sizes: number[]; line: number[] } {
  const sizes: number[] = []
  const line: number[] = [1]
  for (let index = 0; index + 1 < edges.length; index++) {
    const covered = spans.some(([start, end]) => start <= index && end >= index + 1)
    // A track only flexible containers cover has no minimum of its own: their content sizes it.
    const fixed = spans.some(([start, end], box) => start <= index && end >= index + 1 && !flexible[box])
    if (covered) sizes.push(fixed ? Math.max(1, edges[index + 1] - edges[index]) : 0)
    line.push(sizes.length + 1)
  }
  return { sizes, line }
}

/**
 * A caption beside an editor joins the editor's cell only when that wider cell takes no other editor's place (a caption at the top-left
 * of a tall memo, with another field below the caption, would otherwise swallow that field's column).  Otherwise the cell is the editor.
 */
export function resolveAnchors(items: readonly { editor: GridBox; anchored: GridBox }[]): GridBox[] {
  const intersects = (a: GridBox, b: GridBox) => Math.min(a.right, b.right) > Math.max(a.left, b.left) && Math.min(a.bottom, b.bottom) > Math.max(a.top, b.top)
  return items.map((item) => items.some((other) => other !== item && !intersects(item.editor, other.editor) && intersects(item.anchored, other.editor)) ?
    { ...item.editor, key: item.anchored.key, ...(item.anchored.flex ? { flex: true } : {}) } : item.anchored)
}

export function planGrid(boxes: readonly GridBox[]): GridPlan {
  const place = new Map<string, GridPlacement>()
  if (!boxes.length) return { columns: [], rows: 0, rowSizes: [], unit: 1, place }
  const minX = Math.min(...boxes.map((box) => box.left)), maxX = Math.max(...boxes.map((box) => box.right))
  const heights = boxes.map((box) => Math.max(1, box.bottom - box.top)).sort((a, b) => a - b)
  // The typical height is a low quantile, not the median: tall containers (a groupbox, a list) must not widen the tolerance that
  // decides whether two small fields share a row.
  const typicalHeight = heights[Math.floor(heights.length * 0.25)]
  // Row edges snap within 5% of a typical field height (only measurement jitter), so staggered neighbours keep their stagger:
  // the rows are then sized in proportion to the source distances.
  const yEdges = snapEdges(boxes.flatMap((box) => [box.top, box.bottom]), Math.max(1, typicalHeight * 0.05))
  // Column edges snap within 1% of the span, widened until the track count is workable.
  let xTolerance = Math.max(1, (maxX - minX) * 0.01)
  let xEdges = snapEdges(boxes.flatMap((box) => [box.left, box.right]), xTolerance)
  while (xEdges.length - 1 > MAX_COLUMNS && xTolerance < maxX - minX) {
    xTolerance *= 1.5
    xEdges = snapEdges(boxes.flatMap((box) => [box.left, box.right]), xTolerance)
  }
  const colSpans = boxes.map((box): [number, number] => [nearest(xEdges, box.left), nearest(xEdges, box.right)])
  const rowSpans = boxes.map((box): [number, number] => [nearest(yEdges, box.top), nearest(yEdges, box.bottom)])
  const cols = tracksOf(xEdges, colSpans)
  const rows = tracksOf(yEdges, rowSpans, boxes.map((box) => !!box.flex))
  boxes.forEach((box, index) => {
    const [c0, c1] = colSpans[index], [r0, r1] = rowSpans[index]
    const colStart = cols.line[c0]
    const rowStart = rows.line[r0]
    place.set(box.key, {
      colStart, colEnd: Math.max(colStart + 1, cols.line[c1]),
      rowStart, rowEnd: Math.max(rowStart + 1, rows.line[r1]),
    })
  })
  return { columns: cols.sizes, rows: rows.sizes.length, rowSizes: rows.sizes, unit: Math.max(1, typicalHeight), place }
}

/** Applies a plan to a container: the grid tracks on the container, the placement on each element (DOM order is untouched). */
export function applyGrid(container: HTMLElement, plan: GridPlan, elements: ReadonlyMap<string, HTMLElement>, rowOffset = 0): void {
  if (!plan.columns.length) return
  container.classList.add('has-grid')
  container.style.setProperty('--grid-columns', plan.columns.map((size) => `minmax(0,${size}fr)`).join(' '))
  // A typical field is four lines of text high (caption above editor); every row is at least its source share of that, and grows with content.
  container.style.setProperty('--grid-unit', `${4 / plan.unit}em`)
  container.style.setProperty('--grid-rows', [...Array.from({ length: rowOffset }, () => 'auto'), ...plan.rowSizes.map((size) => `minmax(calc(${size} * var(--grid-unit)), auto)`)].join(' '))
  for (const [key, element] of elements) {
    const placement = plan.place.get(key)
    if (!placement) continue
    element.classList.add('grid-cell')
    element.style.gridColumn = `${placement.colStart} / ${placement.colEnd}`
    element.style.gridRow = `${placement.rowStart + rowOffset} / ${placement.rowEnd + rowOffset}`
  }
}
