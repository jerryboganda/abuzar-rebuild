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
  // the template's row tracks (it starts with an `auto` track per unplaced, hidden control); track n is grid line n to n + 1
  const rows: string[] = []
  let depth = 0, token = ''
  for (const ch of fields.style.getPropertyValue('--grid-rows').trim()) {
    if (ch === '(') depth++
    if (ch === ')') depth--
    if (ch === ' ' && depth === 0) { if (token) rows.push(token); token = '' } else token += ch
  }
  if (token) rows.push(token)
  const moved = blocks.slice(split), from = moved[0].start, to = moved[moved.length - 1].end
  if (rows.length < to - 1) return why('row template')
  // the later blocks go into a grid of their own beside the earlier ones: they keep their own row sizes instead of stretching the
  // rows of the first column (two tall Term fields in short rows pushed the customer list down)
  const column = document.createElement('div')
  column.className = 'window-fields has-grid criteria-fold-column'
  column.style.setProperty('--grid-columns', columns)
  column.style.setProperty('--grid-rows', rows.slice(from - 1, to - 1).join(' '))
  column.style.cssText += `;grid-column:${tracks + 2} / ${2 * tracks + 2};grid-row:${blocks[0].start} / ${from};align-self:start;margin:0;padding:0;display:grid;min-width:0`
  for (const block of moved) {
    for (const cell of block.members) {
      const [r0, r1] = cell.rows!
      cell.element.style.gridRow = `${r0 - from + 1} / ${r1 - from + 1}`
      column.append(cell.element)
    }
  }
  fields.append(column)
  fields.style.setProperty('--grid-columns', `${columns} minmax(16px,.05fr) ${columns}`)
  // the rows the moved blocks left keep no height: the template ends where the first column ends
  fields.style.setProperty('--grid-rows', rows.slice(0, from - 1).join(' '))
  fields.dataset.folded = 'true'
  fields.classList.add('criteria-folded')
  return true
}

/**
 * Fits a docked report's criteria: the source's empty spacing rows are drawn smaller, step by step, until it fits; a form still
 * taller than the card scrolls. The groups stay in the original's single column (Optimum Level / Stock Management stack their
 * four list groups as the original does; side by side 2026-11-24) - foldCriteria is no longer applied.
 * Every field keeps its own size; only blank space between the source's rows shrinks.
 */
export function fitCriteria(fields: HTMLElement): void {
  const client = fields.parentElement
  if (!client) return
  for (const grid of [fields, ...fields.querySelectorAll<HTMLElement>(':scope > .criteria-fold-column')]) spreadOptions(grid)
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

/**
 * Options of one source row (Original / Last Saving / Billing) whose captions no longer fit their narrow source cells are set side by
 * side in one strip over the same cells, each caption whole: in the source the radio buttons sit close together and the captions,
 * drawn in a smaller font, fit; here a caption was cut ("Origina", "Last Savin") and the next button sat on its end.
 */
export function spreadOptions(fields: HTMLElement): void {
  const rows = new Map<string, HTMLElement[]>()
  for (const child of [...fields.children]) {
    if (!(child instanceof HTMLElement) || !child.matches('label.window-option.grid-cell') || getComputedStyle(child).display === 'none') continue
    rows.set(child.style.gridRow, [...(rows.get(child.style.gridRow) ?? []), child])
  }
  for (const [row, options] of rows) {
    if (options.length < 2 || !options.some((option) => option.scrollWidth > option.clientWidth + 1)) continue
    const start = (option: HTMLElement) => Number(option.style.gridColumn.split('/')[0])
    options.sort((a, b) => start(a) - start(b))
    const ends = options.map((option) => Number(option.style.gridColumn.split('/')[1]))
    const strip = document.createElement('div')
    strip.className = 'criteria-option-strip'
    strip.style.cssText = `grid-row:${row};grid-column:${start(options[0])} / ${ends.some((end) => end < 0) ? -1 : Math.max(...ends)};` +
      'display:flex;flex-wrap:nowrap;align-items:center;column-gap:18px;position:relative;z-index:2;width:max-content;align-self:center;background:var(--p-surface);padding:2px 6px;border-radius:6px'
    options[0].before(strip)
    for (const option of options) {
      option.style.removeProperty('grid-row')
      option.style.removeProperty('grid-column')
      option.style.setProperty('flex', 'none')
      option.style.setProperty('width', 'auto', 'important')
      option.style.setProperty('position', 'static')
      strip.append(option)
    }
  }
}
