import type { DwChoices } from '../dw/choices.ts'
import { containDialogFocus } from './presentation-dialogs.ts'
import type { PresentationDialog } from './presentation-dialogs.ts'

export const LOOKUP_PAGE_SIZE = 50
let nextLookup = 0

export interface LookupDialog extends PresentationDialog<number | null> {
  cancel(): void
}

/** Searching and paging never change the child DataWindow's buffers or current row. */
export function lookupDialog(choices: DwChoices, initial: number, signal: AbortSignal, onError: (error: unknown) => void): LookupDialog {
  const grid = choices.grid
  if (!grid || !grid.columns.length) throw new Error('This lookup has no reviewed detail columns.')
  const identity = `lookup-${++nextLookup}`
  const element = document.createElement('dialog')
  element.className = 'presentation-settings presentation-lookup'
  const heading = document.createElement('h2')
  heading.id = identity
  heading.textContent = grid.title
  element.setAttribute('aria-labelledby', identity)
  const help = document.createElement('p')
  help.id = identity + '-help'
  help.textContent = 'Search loaded records. Arrow keys inspect cells; Enter or Select chooses the highlighted row. No additional records are retrieved.'
  element.setAttribute('aria-describedby', help.id)
  const label = document.createElement('label')
  label.className = 'lookup-search'
  label.textContent = 'Search loaded records'
  const search = document.createElement('input')
  search.type = 'search'
  search.autocomplete = 'off'
  search.spellcheck = false
  search.setAttribute('aria-controls', identity + '-grid')
  label.append(search)
  const status = document.createElement('p')
  status.className = 'lookup-status'
  status.setAttribute('role', 'status')
  const error = document.createElement('p')
  error.className = 'presentation-error'
  error.setAttribute('role', 'alert')
  error.hidden = true
  const viewport = document.createElement('div')
  viewport.className = 'lookup-grid-wrap'
  const table = document.createElement('table')
  table.id = identity + '-grid'
  table.setAttribute('role', 'grid')
  table.setAttribute('aria-label', grid.title)
  table.setAttribute('aria-colcount', String(grid.columns.length))
  const header = table.createTHead().insertRow()
  header.setAttribute('aria-rowindex', '1')
  grid.columns.forEach((column, at) => {
    const th = document.createElement('th')
    th.scope = 'col'
    th.id = `${identity}-heading-${at}`
    th.textContent = column.label
    if (column.numeric) th.className = 'lookup-number'
    header.append(th)
  })
  const body = table.createTBody()
  viewport.append(table)
  const resize = new ResizeObserver(() => {
    viewport.style.scrollPaddingTop = `${table.tHead?.getBoundingClientRect().height ?? 0}px`
    const focus = document.activeElement
    if (element.open && focus instanceof HTMLElement && body.contains(focus)) {
      focus.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    }
  })
  const details = document.createElement('details')
  details.className = 'lookup-details'
  const summary = document.createElement('summary')
  summary.textContent = 'Selected row details'
  summary.tabIndex = 0
  const values = document.createElement('dl')
  details.append(summary, values)
  const footer = document.createElement('footer')
  const pages = document.createElement('nav')
  pages.className = 'lookup-pages'
  pages.setAttribute('aria-label', 'Lookup pages')
  const button = (text: string) => {
    const control = document.createElement('button')
    control.type = 'button'
    control.textContent = text
    return control
  }
  const previous = button('Previous page'), next = button('Next page')
  pages.append(previous, next)
  const cancel = button('Cancel'), select = button('Select')
  select.className = 'lookup-select'
  footer.append(pages, cancel, select)
  element.append(heading, help, label, status, error, viewport, details, footer)
  containDialogFocus(element)

  let resolve!: (value: number | null) => void
  const result = new Promise<number | null>((done) => { resolve = done })
  let closed = false, busy = false, failed = false, revision = 0
  let matches = choices.items.map((_item, index) => index)
  let active = initial >= 0 && initial < matches.length ? initial : matches.length ? 0 : -1
  let column = 0, page = Math.max(0, Math.floor(active / LOOKUP_PAGE_SIZE))
  let rendered = new Map<number, readonly string[]>()
  const finish = (value: number | null) => {
    if (closed) return
    closed = true
    revision++
    resize.disconnect()
    signal.removeEventListener('abort', aborted)
    if (element.open) element.close()
    element.remove()
    resolve(value)
  }
  const aborted = () => finish(null)
  const report = (cause: unknown) => {
    const focusedRow = body.contains(document.activeElement)
    failed = true
    body.replaceChildren()
    rendered.clear()
    details.hidden = true
    select.disabled = true
    status.textContent = 'Row details unavailable.'
    error.hidden = false
    error.textContent = 'These choices changed or could not be displayed. Cancel, press Escape to leave the field, and reopen it.'
    if (focusedRow) cancel.focus()
    onError(cause)
  }
  const selectedDetails = () => {
    values.replaceChildren()
    const row = rendered.get(active)
    details.hidden = !row
    if (!row) return
    grid.columns.forEach((column, at) => {
      const pair = document.createElement('div')
      const name = document.createElement('dt'), value = document.createElement('dd')
      name.textContent = column.label
      value.textContent = row[at] || '(empty)'
      pair.append(name, value)
      values.append(pair)
    })
  }
  const highlight = (focus = false) => {
    for (const row of body.rows) {
      const selected = Number(row.dataset.position) === active
      row.setAttribute('aria-selected', String(selected))
      for (const [at, cell] of [...row.cells].entries()) cell.tabIndex = selected && at === column ? 0 : -1
    }
    selectedDetails()
    if (focus) {
      const cell = body.querySelector<HTMLElement>(`[data-position="${active}"] [data-column="${column}"]`)
      cell?.focus({ preventScroll: true })
      cell?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    }
  }
  const choose = () => {
    if (closed || busy || failed || active < 0) return
    const index = matches[active], choice = choices.items[index]
    try {
      if (!choice) throw new Error('The highlighted lookup row is unavailable.')
      choices.validate(choice)
      finish(index)
    } catch (cause) { report(cause) }
  }
  const render = async (focus = false) => {
    if (closed) return
    const version = ++revision
    const start = page * LOOKUP_PAGE_SIZE
    const requested = matches.slice(start, start + LOOKUP_PAGE_SIZE)
    busy = true
    failed = false
    error.hidden = true
    select.disabled = previous.disabled = next.disabled = true
    table.setAttribute('aria-busy', 'true')
    status.textContent = 'Loading row details...'
    try {
      const rows = await Promise.all(requested.map((index) => grid.read(index)))
      if (closed || revision !== version) return
      if (rows.some((row) => row.length !== grid.columns.length)) throw new Error('Lookup row details do not match the reviewed columns.')
      rendered = new Map(rows.map((row, index) => [start + index, row]))
      body.replaceChildren()
      table.setAttribute('aria-rowcount', String(matches.length + 1))
      rows.forEach((values, index) => {
        const position = start + index
        const tr = body.insertRow()
        tr.dataset.position = String(position)
        tr.dataset.choice = String(requested[index])
        tr.setAttribute('aria-rowindex', String(position + 2))
        values.forEach((text, at) => {
          const cell = tr.insertCell()
          cell.id = `${identity}-row-${requested[index]}-${at}`
          cell.dataset.column = String(at)
          cell.setAttribute('role', 'gridcell')
          cell.setAttribute('aria-labelledby', `${identity}-heading-${at} ${cell.id}`)
          if (grid.columns[at].numeric) cell.className = 'lookup-number'
          const value = document.createElement('span')
          value.textContent = text
          cell.append(value)
        })
        tr.addEventListener('click', (event) => {
          if (busy || failed) return
          const cell = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-column]') : null
          active = position
          if (cell) column = Number(cell.dataset.column)
          highlight(true)
        })
        tr.addEventListener('dblclick', choose)
      })
      previous.disabled = page === 0
      next.disabled = start + LOOKUP_PAGE_SIZE >= matches.length
      select.disabled = active < 0
      status.textContent = matches.length ?
        `${matches.length} matching loaded ${matches.length === 1 ? 'record' : 'records'} / rows ${start + 1}-${start + rows.length}.` :
        choices.items.length ? 'No loaded records match this search. Change or clear the search.' : 'No loaded records are available.'
      viewport.style.scrollPaddingTop = `${table.tHead?.getBoundingClientRect().height ?? 0}px`
      highlight(focus)
    } catch (cause) {
      if (!closed && revision === version) report(cause)
    } finally {
      if (!closed && revision === version) { busy = false; table.setAttribute('aria-busy', 'false') }
    }
  }
  const move = (row: number, at: number) => {
    if (failed || !matches.length) return
    active = Math.max(0, Math.min(matches.length - 1, row))
    column = Math.max(0, Math.min(grid.columns.length - 1, at))
    const nextPage = Math.floor(active / LOOKUP_PAGE_SIZE)
    if (nextPage !== page || busy) { page = nextPage; void render(true) }
    else highlight(true)
  }
  search.addEventListener('input', () => {
    if (closed) return
    try {
      const query = search.value.trim().toLocaleLowerCase()
      matches = choices.items.flatMap((_choice, index) => !query || grid.matches(index, query) ? [index] : [])
      active = matches.length ? 0 : -1
      column = page = 0
      viewport.scrollTop = viewport.scrollLeft = 0
      void render()
    } catch (cause) {
      revision++
      busy = false
      table.setAttribute('aria-busy', 'false')
      report(cause)
    }
  })
  search.addEventListener('keydown', (event) => {
    if (event.isComposing || !['ArrowDown', 'Enter'].includes(event.key)) return
    event.preventDefault()
    if (active >= 0) move(active, column)
  })
  table.addEventListener('keydown', (event) => {
    if (event.isComposing || event.altKey || event.metaKey) return
    if (event.key === 'Enter') { event.preventDefault(); choose(); return }
    let row = active, at = column
    if (event.key === 'ArrowDown') row++
    else if (event.key === 'ArrowUp') row--
    else if (event.key === 'ArrowRight') at++
    else if (event.key === 'ArrowLeft') at--
    else if (event.key === 'PageDown') row += LOOKUP_PAGE_SIZE
    else if (event.key === 'PageUp') row -= LOOKUP_PAGE_SIZE
    else if (event.key === 'Home') { at = 0; if (event.ctrlKey) row = 0 }
    else if (event.key === 'End') { at = grid.columns.length - 1; if (event.ctrlKey) row = matches.length - 1 }
    else return
    event.preventDefault()
    move(row, at)
  })
  previous.onclick = () => move(Math.max(0, (page - 1) * LOOKUP_PAGE_SIZE), column)
  next.onclick = () => move((page + 1) * LOOKUP_PAGE_SIZE, column)
  select.onclick = choose
  cancel.onclick = () => finish(null)
  element.addEventListener('cancel', (event) => { event.preventDefault(); finish(null) })
  signal.addEventListener('abort', aborted, { once: true })
  if (signal.aborted) finish(null)
  return {
    element, result, restoreFocus: false, cancel: () => finish(null),
    open: () => {
      if (closed) return
      document.body.append(element)
      element.showModal()
      resize.observe(header)
      search.focus()
      void render()
    },
  }
}
