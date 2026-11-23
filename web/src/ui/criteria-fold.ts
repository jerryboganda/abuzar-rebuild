/**
 * A report's criteria taller than the docked card (Optimum Level: four list groups, 1,120px in 584px) are laid out in two columns
 * instead of scrolling.  The source grid is cut at the row lines no visible field crosses; the blocks between the cuts keep their
 * order and their own placement, the later ones move beside the earlier ones.  Nothing is hidden, reordered within a block or resized
 * by hand; a form that fits, or a card too narrow for two columns, is left as it is.
 */
export function foldCriteria(fields: HTMLElement): boolean {
  const client = fields.parentElement
  if (!client || fields.dataset.folded || !fields.classList.contains('has-grid')) return false
  if (client.scrollHeight <= client.clientHeight + 4 || client.clientWidth < 1000) return false
  const span = (value: string) => {
    const [a, b] = value.split('/').map((part) => Number(part.trim()))
    return Number.isInteger(a) && Number.isInteger(b) ? [a, b] as const : null
  }
  const cells = [...fields.children].filter((child): child is HTMLElement =>
    child instanceof HTMLElement && child.classList.contains('grid-cell') && getComputedStyle(child).display !== 'none')
    .map((element) => ({ element, rows: span(element.style.gridRow), cols: span(element.style.gridColumn) }))
  const why = (reason: string) => { fields.dataset.foldSkip = reason; return false }
  if (!cells.length || cells.some((cell) => !cell.rows || !cell.cols)) return why('placement')
  const columns = (fields.style.getPropertyValue('--grid-columns') || '').trim()
  const tracks = columns.split(/\s+(?=minmax\()/).length
  if (!columns || tracks < 1) return false
  // cut lines: row lines that no visible cell spans across
  const first = Math.min(...cells.map((cell) => cell.rows![0])), last = Math.max(...cells.map((cell) => cell.rows![1]))
  const cuts = [first]
  for (let line = first + 1; line < last; line++) {
    if (!cells.some((cell) => cell.rows![0] < line && cell.rows![1] > line) && cells.some((cell) => cell.rows![0] === line)) cuts.push(line)
  }
  cuts.push(last)
  if (cuts.length < 3) return why('one block')
  const blocks = cuts.slice(0, -1).map((start, index) => {
    const end = cuts[index + 1]
    const members = cells.filter((cell) => cell.rows![0] >= start && cell.rows![1] <= end)
    const top = Math.min(...members.map((cell) => cell.element.getBoundingClientRect().top))
    const bottom = Math.max(...members.map((cell) => cell.element.getBoundingClientRect().bottom))
    return { start, end, members, height: members.length ? bottom - top : 0 }
  }).filter((block) => block.members.length)
  if (blocks.length < 2) return why('one block')
  // the split that makes the taller column as short as possible
  const total = blocks.reduce((sum, block) => sum + block.height, 0)
  let split = 1, best = Infinity, running = 0
  for (let index = 1; index < blocks.length; index++) {
    running += blocks[index - 1].height
    const taller = Math.max(running, total - running)
    if (taller < best) { best = taller; split = index }
  }
  const shift = blocks[split].start - blocks[0].start
  for (const block of blocks.slice(split)) {
    for (const cell of block.members) {
      const [r0, r1] = cell.rows!, [c0, c1] = cell.cols!
      cell.element.style.gridRow = `${r0 - shift} / ${r1 - shift}`
      cell.element.style.gridColumn = `${c0 + tracks + 1} / ${(c1 < 0 ? tracks + 1 : c1) + tracks + 1}`
    }
  }
  fields.style.setProperty('--grid-columns', `${columns} minmax(16px,.05fr) ${columns}`)
  // the rows the moved blocks left behind would keep their minimum height under the shorter column: the template ends at the last used row
  const used = Math.max(...cells.map((cell) => Number(cell.element.style.gridRow.split('/')[1])))
  const rows: string[] = []
  let depth = 0, token = ''
  for (const ch of fields.style.getPropertyValue('--grid-rows').trim()) {
    if (ch === '(') depth++
    if (ch === ')') depth--
    if (ch === ' ' && depth === 0) { if (token) rows.push(token); token = '' } else token += ch
  }
  if (token) rows.push(token)
  if (rows.length >= used - 1) fields.style.setProperty('--grid-rows', rows.slice(0, used - 1).join(' '))
  fields.dataset.folded = 'true'
  fields.classList.add('criteria-folded')
  return true
}

/**
 * Fits a docked report's criteria: two columns when the form splits into blocks, then (still too tall, or one block such as the
 * Stock Register's list spanning every row) the source's empty spacing rows are drawn smaller, step by step, until it fits.
 * Every field keeps its own size; only blank space between the source's rows shrinks.
 */
export function fitCriteria(fields: HTMLElement): void {
  const client = fields.parentElement
  if (!client) return
  foldCriteria(fields)
  // (run again when the lists have filled: it only ever lowers the density)
  const current = Number(fields.style.getPropertyValue('--grid-density') || 1)
  for (const density of ['.55', '.4', '.3', '.2']) {
    if (client.scrollHeight <= client.clientHeight + 4) break
    if (Number(density) >= current) continue
    fields.style.setProperty('--grid-density', density)
  }
  // the last few pixels: the gap kept under each group box goes
  if (client.scrollHeight > client.clientHeight + 4) fields.classList.add('criteria-tight')
}
