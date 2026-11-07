import { lookupDialog, LOOKUP_PAGE_SIZE } from './src/ui/dw-lookup-dialog.js'

export async function checkLookupDialogs(check, settle) {
  const key = (target, key, ctrlKey = false, shiftKey = false) => target.dispatchEvent(new KeyboardEvent('keydown',
    { key, ctrlKey, shiftKey, bubbles: true, cancelable: true }))
  const mount = (settings = {}) => {
    const rows = settings.rows ?? Array.from({ length: 10003 }, (_, index) =>
      [String(index), 'Duplicate name', `entry-${index} / synthetic details`])
    const items = rows.map((row, index) => ({ value: index, text: row[1] }))
    const errors = [], reads = []
    const lifetime = new AbortController()
    const choices = { items, validate: settings.validate ?? (() => {}), grid: {
      title: 'Synthetic loaded choices',
      columns: [{ label: 'Code', numeric: true }, { label: 'Name', numeric: false }, { label: 'Address', numeric: false }],
      matches: (index, query) => rows[index].some((value) => value.toLocaleLowerCase().includes(query)),
      read: async (index) => {
        reads.push(index)
        if (settings.read) return settings.read(index, rows)
        return rows[index]
      },
    } }
    const dialog = lookupDialog(choices, settings.initial ?? 0, lifetime.signal, (error) => errors.push(error))
    let finished = false, selected
    dialog.result.then((value) => { finished = true; selected = value })
    dialog.open()
    const element = dialog.element, search = element.querySelector('input'), table = element.querySelector('table')
    const button = (name) => [...element.querySelectorAll('button')].find((button) => button.textContent === name)
    return { rows, items, reads, errors, dialog, lifetime, element, search, table, button,
      get finished() { return finished }, get selected() { return selected },
      filter: (value) => { search.value = value; search.dispatchEvent(new Event('input', { bubbles: true })) },
      close: () => { dialog.cancel(); lifetime.abort() } }
  }

  const large = mount()
  const original = JSON.stringify(large.rows)
  try {
    await settle()
    check(document.activeElement === large.search && large.table.rows.length === LOOKUP_PAGE_SIZE + 1 &&
      large.reads.length === LOOKUP_PAGE_SIZE, 'A large lookup starts in search and formats only one bounded page')
    check(large.table.getAttribute('aria-rowcount') === '10004' && large.table.getAttribute('aria-colcount') === '3',
      'The lookup grid announces its complete loaded row and column counts')
    key(large.search, 'Tab', false, true)
    check(document.activeElement === large.button('Select'), 'Shift+Tab from lookup search stays inside the owned dialog')
    key(document.activeElement, 'Tab')
    check(document.activeElement === large.search, 'Tab from the last lookup action wraps to search')
    key(large.search, 'Enter')
    check(document.activeElement === large.table.tBodies[0].rows[0].cells[0] && !large.finished,
      'Scanner/search Enter moves to the highlighted row instead of committing an unseen first match')
    key(document.activeElement, 'PageDown')
    await settle()
    check(large.table.tBodies[0].rows[0].dataset.choice === '50' &&
      large.table.tBodies[0].rows[0].getAttribute('aria-rowindex') === '52',
      'PageDown retains original option identity and logical ARIA row positions')
    key(document.activeElement, 'End', true)
    await settle()
    check(large.table.tBodies[0].rows.length === 3 && document.activeElement.dataset.column === '2' &&
      document.activeElement.parentElement.dataset.choice === '10002',
      'Ctrl+End reaches the final cell without materializing intervening rows')
    large.search.focus()
    large.filter('ENTRY-7777')
    await settle()
    check(large.table.tBodies[0].rows.length === 1 && large.table.tBodies[0].rows[0].dataset.choice === '7777',
      'Case-insensitive loaded-field search distinguishes repeated names using their details')
    key(large.search, 'ArrowDown')
    key(document.activeElement, 'Enter')
    check(await large.dialog.result === 7777, 'Selection returns the original option index, never an index into filtered results')
    check(JSON.stringify(large.rows) === original, 'Search, paging and selection do not reorder or mutate source rows')
  } finally { large.close() }

  for (const rows of [[], [['0', 'Duplicate name', 'one loaded row']]]) {
    const empty = mount({ rows })
    try {
      await settle()
      if (rows.length) { empty.filter('not-present'); await settle() }
      check(empty.table.tBodies[0].rows.length === 0 && empty.button('Select').disabled &&
        empty.button('Next page').disabled && empty.button('Previous page').disabled,
      'Empty and no-match states have no selectable or stale row')
      check(empty.element.querySelector('[role=status]').textContent.includes(rows.length ? 'No loaded records match' : 'No loaded records are available'),
        'Empty and no-match states explain different recovery actions')
      if (rows.length) {
        empty.filter('')
        await settle()
        check(empty.table.tBodies[0].rows.length === 1 && !empty.button('Select').disabled,
          'Clearing search restores the loaded rows without a retrieve')
      }
      empty.element.dispatchEvent(new Event('cancel', { cancelable: true }))
      check(await empty.dialog.result === null, 'Escape/cancel returns no selection')
    } finally { empty.close() }
  }

  const text = '<script>not HTML</script> \u0627\u0644\u0631\u064a\u0627\u0636 \u6771\u4eac ' + 'Long value '.repeat(90)
  const long = mount({ rows: [['0', 'Repeated', text], ['1', 'Repeated', 'Distinct']] })
  try {
    await settle()
    long.element.querySelector('details').open = true
    check(long.element.querySelector('dl').textContent.includes(text) && !long.element.querySelector('script'),
      'Expanded details preserve full multilingual and long values as text, not executable markup')
    long.button('Cancel').click()
    check(await long.dialog.result === null, 'Cancelling inspected details never changes the parent choice')
  } finally { long.close() }

  const stale = mount({ rows: [['1', 'Repeated', 'Original details']], validate: () => { throw new Error('Synthetic stale details') } })
  try {
    await settle()
    key(stale.search, 'ArrowDown')
    key(document.activeElement, 'Enter')
    await settle()
    check(stale.errors.length === 1 && !stale.finished && stale.button('Select').disabled &&
      !stale.element.querySelector('[role=alert]').hidden && document.activeElement === stale.button('Cancel'),
    'Changed selections report an error, clear obsolete rows and keep a reachable Cancel action')
  } finally { stale.close() }

  for (const read of [
    async () => { throw new Error('Synthetic formatting failure') },
    async () => ['wrong column count'],
  ]) {
    const failed = mount({ rows: [['1', 'Name', 'Address']], read })
    try {
      await settle()
      check(failed.errors.length === 1 && failed.table.getAttribute('aria-busy') === 'false' &&
        failed.element.querySelector('[role=status]').textContent === 'Row details unavailable.' && failed.button('Select').disabled,
      'Formatting errors and mismatched column shapes are visible failures, never incomplete success rows')
    } finally { failed.close() }
  }

  let release
  const gate = new Promise((resolve) => { release = resolve })
  const slow = mount({ rows: [['1', 'Name', 'Address']], read: async (_index, rows) => { await gate; return rows[0] } })
  slow.lifetime.abort()
  release()
  await settle()
  check(await slow.dialog.result === null && !slow.element.isConnected && slow.errors.length === 0,
    'Owner cancellation closes a loading lookup and ignores late formatting results')
  slow.close()

  let releaseFirst
  const firstPage = new Promise((resolve) => { releaseFirst = resolve })
  const rapid = mount({ read: async (index, rows) => { if (index < LOOKUP_PAGE_SIZE) await firstPage; return rows[index] } })
  try {
    rapid.filter('entry-5000 /')
    await settle()
    check(rapid.table.tBodies[0].rows[0]?.dataset.choice === '5000', 'A newer search can finish while an old page is still formatting')
    releaseFirst()
    await settle()
    check(rapid.table.tBodies[0].rows.length === 1 && rapid.table.tBodies[0].rows[0].dataset.choice === '5000',
      'Late page results cannot overwrite a newer query or selected identity')
  } finally { releaseFirst(); rapid.close() }
}
