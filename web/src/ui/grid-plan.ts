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
  const editorOnly = (item: { editor: GridBox; anchored: GridBox }): GridBox => ({ ...item.editor, key: item.anchored.key, ...(item.anchored.flex ? { flex: true } : {}) })
  const narrowed = items.map((item) => items.some((other) => other !== item && !intersects(item.editor, other.editor) && intersects(item.anchored, other.editor)))
  // Fields of one column keep one left edge: when a field had to give up the caption on its left (it would have taken another
  // field's place), the fields whose editors start at the same edge give theirs up too.  "Start Date" then starts where "End Date"
  // does, each under its caption, instead of one starting at its caption's edge and the other at its editor's.
  const resolved = items.map((item, index) => {
    if (narrowed[index]) return editorOnly(item)
    if (item.anchored.left >= item.editor.left) return item.anchored
    const tolerance = Math.max(4, (item.editor.right - item.editor.left) * 0.03)
    const sibling = items.some((other, at) => at !== index && narrowed[at] && other.anchored.left < other.editor.left &&
      Math.abs(other.editor.left - item.editor.left) <= tolerance && other.anchored.top === other.editor.top && item.anchored.top === item.editor.top)
    return sibling ? editorOnly(item) : item.anchored
  })
  // Stacked fields whose editors start at one edge start at one edge with their captions too: a caption that begins a little left
  // of its editor moved that one field left of the field under it ("Start Date" 8px left of "End Date").
  return resolved.map((box, index) => {
    const editor = items[index].editor
    const tolerance = Math.max(4, (editor.right - editor.left) * 0.03)
    let left = box.left
    items.forEach((other, at) => {
      if (at === index || Math.abs(other.editor.left - editor.left) > tolerance) return
      if (Math.min(other.editor.bottom, editor.bottom) > Math.max(other.editor.top, editor.top)) return
      if (resolved[at].left < left) left = resolved[at].left
    })
    if (left >= box.left) return box
    const wider = { ...box, left }
    return items.some((other, at) => at !== index && intersects(wider, other.editor) && !intersects(box, other.editor)) ? box : wider
  })
}

export function planGrid(boxes: readonly GridBox[]): GridPlan {
  const place = new Map<string, GridPlacement>()
  if (!boxes.length) return { columns: [], rows: 0, rowSizes: [], unit: 1, place }
  const minX = Math.min(...boxes.map((box) => box.left)), maxX = Math.max(...boxes.map((box) => box.right))
  const heights = boxes.map((box) => Math.max(1, box.bottom - box.top)).sort((a, b) => a - b)
  // The typical height is a low quantile, not the median: tall containers (a groupbox, a list) must not widen the tolerance that
  // decides whether two small fields share a row.
  const typicalHeight = heights[Math.floor(heights.length * 0.25)]
  // Row edges snap within a fifth of a typical field height: two check boxes the source draws a few pixels apart in height are one
  // row (they read as a pair), while a real stagger of half a field or more keeps its rows:
  // the rows are then sized in proportion to the source distances.
  const yEdges = snapEdges(boxes.flatMap((box) => [box.top, box.bottom]), Math.max(1, Math.min(typicalHeight * 0.2, heights[0] * 0.45)))
  // Column edges snap within 2% of the span (two date fields the source draws a few pixels apart share their edge), widened until
  // the track count is workable.
  // (never as much as half the narrowest object: its own two edges stay two edges)
  const narrowest = Math.min(...boxes.map((box) => Math.max(1, box.right - box.left)))
  let xTolerance = Math.max(1, Math.min((maxX - minX) * 0.02, narrowest * 0.6))
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
export function applyGrid(container: HTMLElement, plan: GridPlan, elements: ReadonlyMap<string, HTMLElement>, rowOffset = 0, lineEm = 4): void {
  if (!plan.columns.length) return
  container.classList.add('has-grid')
  container.style.setProperty('--grid-columns', plan.columns.map((size) => `minmax(0,${size}fr)`).join(' '))
  // A typical field is four lines of text high (caption above editor); every row is at least its source share of that, and grows with content.
  // (`lineEm`: a plan whose typical box is one line of text - radio buttons, check boxes - asks for less than four lines.)
  container.style.setProperty('--grid-unit', `${lineEm / plan.unit}em`)
  // A row never demands more than a comfortable list height: a tall source list keeps a usable size instead of pushing the fields
  // under it off the screen (the row still grows with its content).
  container.style.setProperty('--grid-rows', [...Array.from({ length: rowOffset }, () => 'auto'), ...plan.rowSizes.map((size) => `minmax(min(calc(${size} * var(--grid-unit)), 10em), auto)`)].join(' '))
  // A form the source draws as one column of fields (every field starts at the same edge, none beside another) is marked: the
  // design then puts each caption beside its field instead of above it, so a long form is half as tall.
  const starts = new Map<number, number>()
  let stacked = 0
  for (const [key, element] of elements) {
    const placement = plan.place.get(key)
    if (!placement || !element.classList.contains('surface-field')) continue
    starts.set(placement.colStart, (starts.get(placement.colStart) ?? 0) + 1)
    stacked++
  }
  // (a few fields beside another - a code and its date - do not make a form of forty stacked fields a multi-column one)
  container.classList.toggle('grid-one-column', stacked >= 6 && (starts.get(Math.min(...starts.keys())) ?? 0) >= stacked * 0.8)
  for (const [key, element] of elements) {
    const placement = plan.place.get(key)
    if (!placement) continue
    element.classList.add('grid-cell')
    element.style.gridColumn = `${placement.colStart} / ${placement.colEnd}`
    element.style.gridRow = `${placement.rowStart + rowOffset} / ${placement.rowEnd + rowOffset}`
    // A field confined to one track sizes to its content; a field spanning tracks fills them, so its source
    // row-sharing with a neighbour in a lower track survives. Lists always fill the rows they span.
    if (element.classList.contains('window-list')) element.style.alignSelf = 'stretch'
    else if (element.classList.contains('surface-field') || element.classList.contains('window-field')) {
      element.style.alignSelf = placement.rowEnd - placement.rowStart > 1 ? 'stretch' : 'start'
    }
  }
}
