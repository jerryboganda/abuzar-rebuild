// Standalone design prototype. No runtime, backend, storage, or printer access.
const $ = (selector) => document.querySelector(selector)
const $$ = (selector) => [...document.querySelectorAll(selector)]
const money = (cents) => (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const titles = { sale: 'Cash Sale', purchase: 'Pack Purchase', inventory: 'Items', accounts: 'Account Ledger', reports: 'Reports', documents: 'Document preview', settings: 'Appearance' }
const catalog = [
  { code: 'DEMO-01', name: 'Sample cotton roll', pack: 'Each', price: 12500 },
  { code: 'DEMO-02', name: 'Sample dressing pack', pack: 'Pack', price: 36000 },
  { code: 'DEMO-03', name: 'Sample gloves', pack: 'Pair', price: 4000 },
  { code: 'DEMO-04', name: 'Sample paper tape', pack: 'Roll', price: 8500 },
  { code: 'DEMO-05', name: 'Sample gauze pack', pack: 'Pack', price: 18000 },
]
let nextRow = 0
const line = (item, qty, price = item.price) => ({ ...item, qty, price, id: ++nextRow })
const rows = { sale: [line(catalog[0], 2), line(catalog[1], 1), line(catalog[2], 3)], purchase: [line(catalog[0], 10, 8000), line(catalog[1], 3, 24000)] }
const reports = [
  { name: 'Sales summary', group: 'Sales', description: 'Review totals by document type for a selected period.' },
  { name: 'Stock position', group: 'Inventory', description: 'Review stock quantities for the selected item and godown criteria.' },
  { name: 'Account ledger', group: 'Accounts', description: 'Review account entries for the selected period.' },
  { name: 'Purchase summary', group: 'Purchase', description: 'Review purchase totals for the selected period.' },
]
let selectedReport = reports[0]
let active = 'sale'
let pickerTarget = 'sale'
const openTabs = ['sale', 'purchase', 'accounts', 'reports']
const announce = (text) => { $('#status').textContent = text }

function iconHidden() {
  $$('button svg').forEach((icon) => icon.setAttribute('aria-hidden', 'true'))
}

function drawTabs() {
  $('.workspace-tabs').replaceChildren()
  for (const id of openTabs) {
    const button = document.createElement('button')
    button.id = `tab-${id}`
    button.textContent = titles[id]
    button.setAttribute('role', 'tab')
    button.setAttribute('aria-controls', `page-${id}`)
    button.setAttribute('aria-selected', String(active === id))
    button.tabIndex = active === id ? 0 : -1
    button.addEventListener('click', () => openPage(id))
    button.addEventListener('keydown', (event) => {
      const position = openTabs.indexOf(id)
      const index = event.key === 'ArrowRight' ? (position + 1) % openTabs.length
        : event.key === 'ArrowLeft' ? (position - 1 + openTabs.length) % openTabs.length
          : event.key === 'Home' ? 0 : event.key === 'End' ? openTabs.length - 1 : -1
      if (index >= 0) {
        event.preventDefault()
        openPage(openTabs[index], true)
      }
    })
    $('.workspace-tabs').append(button)
  }
}

function openPage(id, focusTab = false) {
  if (!Object.hasOwn(titles, id)) return
  const wasTab = document.activeElement?.getAttribute('role') === 'tab'
  active = id
  if (!openTabs.includes(id)) openTabs.push(id)
  $$('.page').forEach((page) => { page.hidden = page.id !== `page-${id}` })
  $$('#module-nav button').forEach((button) => {
    const selected = button.dataset.open === id
    button.classList.toggle('selected', selected)
    if (selected) button.setAttribute('aria-current', 'page')
    else button.removeAttribute('aria-current')
  })
  drawTabs()
  if (focusTab || wasTab) $(`#tab-${id}`).focus()
  if (id === 'documents') drawDocument()
  if (id === 'reports') {
    $('#report-title').textContent = selectedReport.name
    $('#report-description').textContent = selectedReport.description
    drawReports()
  }
  announce(`${titles[id]} / Synthetic prototype / No database connection`)
}
$$('[data-open]').forEach((button) => button.addEventListener('click', () => openPage(button.dataset.open)))
$('#nav-search').addEventListener('input', (event) => {
  const query = event.target.value.trim().toLowerCase()
  $$('#module-nav button').forEach((button) => { button.hidden = !`${button.textContent} ${titles[button.dataset.open]}`.toLowerCase().includes(query) })
  $('#nav-empty').hidden = $$('#module-nav button').some((button) => !button.hidden)
})

function message(text) {
  $('#message-text').textContent = text
  $('#message').showModal()
}
$$('.demo-action').forEach((button) => button.addEventListener('click', () => message(button.dataset.message)))

function valid(row) {
  return Number.isFinite(row.qty) && row.qty > 0 && row.qty <= 999999 && Number.isFinite(row.price) && row.price >= 0 && row.price <= 99999999
}
function total(kind) {
  return rows[kind].reduce((sum, row) => sum + (valid(row) ? Math.round(row.qty * row.price) : 0), 0)
}
function updateTotals(kind) {
  const invalid = rows[kind].some((row) => !valid(row))
  $$(`[data-total="${kind}"]`).forEach((element) => { element.textContent = invalid ? 'Check entries' : money(total(kind)) })
  $(`#${kind}-count`).textContent = rows[kind].length
  $(`#${kind}-empty`).hidden = rows[kind].length !== 0
  if (kind === 'sale') $('#summary-items').textContent = rows.sale.length
}

function drawRows(kind) {
  const body = $(`#${kind}-table tbody`)
  body.replaceChildren()
  for (const row of rows[kind]) {
    const tr = document.createElement('tr')
    const name = tr.insertCell()
    const strong = document.createElement('strong')
    strong.textContent = row.name
    const code = document.createElement('small')
    code.textContent = row.code
    name.append(strong, code)
    tr.insertCell().textContent = row.pack
    for (const field of ['qty', 'price']) {
      const cell = tr.insertCell()
      cell.className = 'num'
      const input = document.createElement('input')
      input.type = 'number'
      input.className = field === 'price' ? 'price' : ''
      input.min = field === 'qty' ? '0.01' : '0'
      input.max = field === 'qty' ? '999999' : '999999.99'
      input.step = '0.01'
      input.required = true
      input.id = `${kind}-${row.id}-${field}`
      input.value = field === 'price' ? (row.price / 100).toFixed(2) : row.qty
      input.setAttribute('aria-label', `${field === 'price' ? 'Price' : 'Quantity'} for ${row.name}`)
      input.addEventListener('input', () => {
        const n = input.valueAsNumber
        row[field] = field === 'price' ? Math.round(n * 100) : n
        input.setAttribute('aria-invalid', String(!input.validity.valid))
        amount.textContent = valid(row) ? money(Math.round(row.qty * row.price)) : 'Check entry'
        updateTotals(kind)
        if (kind === 'sale' && !$('#sale-errors').hidden) validateSale()
      })
      cell.append(input)
    }
    const amount = tr.insertCell()
    amount.className = 'num'
    amount.textContent = valid(row) ? money(Math.round(row.qty * row.price)) : 'Check entry'
    const remove = document.createElement('button')
    remove.className = 'remove-row'
    remove.textContent = '\u00d7'
    remove.setAttribute('aria-label', `Remove ${row.name}`)
    remove.addEventListener('click', () => {
      rows[kind] = rows[kind].filter((r) => r.id !== row.id)
      drawRows(kind)
      $(`[data-picker="${kind}"]`).focus()
      announce(`Removed ${row.name} from the example. Nothing was saved.`)
    })
    tr.insertCell().append(remove)
    body.append(tr)
  }
  updateTotals(kind)
  if (kind === 'sale' && !$('#sale-errors').hidden) validateSale()
}

function drawPicker() {
  const query = $('#picker-search').value.trim().toLowerCase()
  const host = $('#picker-items')
  host.replaceChildren()
  for (const item of catalog.filter((item) => `${item.name} ${item.code}`.toLowerCase().includes(query))) {
    const button = document.createElement('button')
    button.className = 'picker-item'
    const name = document.createElement('span')
    name.textContent = item.name
    const code = document.createElement('small')
    code.textContent = `${item.code} / ${item.pack}`
    name.append(code)
    const price = document.createElement('span')
    price.textContent = money(item.price)
    button.append(name, price)
    button.addEventListener('click', () => {
      const added = line(item, 1)
      rows[pickerTarget].push(added)
      drawRows(pickerTarget)
      $('#picker').close()
      $(`#${pickerTarget}-${added.id}-qty`).focus()
      announce(`Added ${item.name} to the synthetic example.`)
    })
    host.append(button)
  }
  if (!host.children.length) host.textContent = 'No matching sample items.'
}
$$('[data-picker]').forEach((button) => button.addEventListener('click', () => {
  pickerTarget = button.dataset.picker
  $('#picker-search').value = ''
  drawPicker()
  $('#picker').showModal()
  $('#picker-search').focus()
}))
$('#picker-search').addEventListener('input', drawPicker)
function validateSale(focus = false) {
  const invalid = [...$('#sale-table').querySelectorAll('input')].filter((input) => !input.validity.valid)
  const errors = $('#sale-errors')
  errors.replaceChildren()
  $$('#sale-table input').forEach((input) => input.removeAttribute('aria-describedby'))
  if (invalid.length || !rows.sale.length) {
    const heading = document.createElement('strong')
    heading.textContent = 'Review the sale items'
    errors.append(heading)
    if (!rows.sale.length) {
      const p = document.createElement('p')
      p.textContent = 'Add at least one sample item.'
      errors.append(p)
    }
    for (const input of invalid) {
      input.setAttribute('aria-invalid', 'true')
      const p = document.createElement('div')
      p.id = `error-${input.id}`
      input.setAttribute('aria-describedby', p.id)
      const link = document.createElement('a')
      link.href = `#${input.id}`
      link.textContent = `${input.getAttribute('aria-label')}: enter a value from ${input.min} to ${input.max}.`
      link.addEventListener('click', (event) => { event.preventDefault(); input.focus() })
      p.append(link)
      errors.append(p)
    }
    errors.hidden = false
    if (focus) errors.focus()
    return false
  }
  errors.hidden = true
  return true
}
$('#preview-save').addEventListener('click', () => {
  if (!validateSale(true)) return
  message('The sample entries are valid for this design demonstration. No invoice has been saved or posted. The integrated app will use the existing business validation and transaction rules.')
})

function showItem(item) {
  $('#item-title').textContent = item.name
  const host = $('#item-detail')
  host.replaceChildren()
  for (const [label, value] of [['Code', item.code], ['Packing', item.pack], ['Sale price', money(item.price)], ['Source', 'Synthetic fixture']]) {
    const div = document.createElement('div')
    const dt = document.createElement('dt')
    const dd = document.createElement('dd')
    dt.textContent = label
    dd.textContent = value
    div.append(dt, dd)
    host.append(div)
  }
}
function drawInventory() {
  const query = $('#item-filter').value.trim().toLowerCase()
  const host = $('#inventory-table tbody')
  host.replaceChildren()
  for (const item of catalog.filter((item) => `${item.code} ${item.name}`.toLowerCase().includes(query))) {
    const row = document.createElement('tr')
    row.insertCell().textContent = item.code
    const button = document.createElement('button')
    button.className = 'text-button'
    button.textContent = item.name
    button.addEventListener('click', () => { showItem(item); announce(`Showing ${item.name}`) })
    row.insertCell().append(button)
    row.insertCell().textContent = item.pack
    const value = row.insertCell()
    value.className = 'num'
    value.textContent = money(item.price)
    host.append(row)
  }
  $('#inventory-empty').hidden = host.children.length > 0
}
$('#item-filter').addEventListener('input', drawInventory)

const ledger = [
  { reference: 'DEMO-001', account: 'Cash', description: 'Sample sale', debit: 73000, credit: 0 },
  { reference: 'DEMO-002', account: 'Cash', description: 'Sample receipt', debit: 25000, credit: 0 },
  { reference: 'DEMO-003', account: 'Supplier', description: 'Sample purchase', debit: 0, credit: 152000 },
  { reference: 'DEMO-004', account: 'Supplier', description: 'Sample payment', debit: 40000, credit: 0 },
]
function visibleLedger() {
  return ledger.filter((entry) => $('#account-filter').value === 'all' || entry.account === $('#account-filter').value)
}
function drawLedger() {
  const selected = visibleLedger()
  const host = $('#ledger-table tbody')
  host.replaceChildren()
  for (const entry of selected) {
    const row = document.createElement('tr')
    for (const field of ['reference', 'account', 'description', 'debit', 'credit']) {
      const cell = row.insertCell()
      cell.textContent = typeof entry[field] === 'number' ? money(entry[field]) : entry[field]
      if (field === 'debit' || field === 'credit') cell.className = 'num'
    }
    host.append(row)
  }
  $('#ledger-debit').textContent = money(selected.reduce((n, e) => n + e.debit, 0))
  $('#ledger-credit').textContent = money(selected.reduce((n, e) => n + e.credit, 0))
}
$('#account-filter').addEventListener('change', drawLedger)
function drawReports() {
  const query = $('#report-filter').value.trim().toLowerCase()
  const host = $('#report-list')
  host.replaceChildren()
  for (const report of reports.filter((report) => report.name.toLowerCase().includes(query))) {
    const button = document.createElement('button')
    button.className = 'report-choice'
    button.setAttribute('aria-pressed', String(report === selectedReport))
    const title = document.createElement('strong')
    title.textContent = report.name
    const group = document.createElement('small')
    group.textContent = report.group
    button.append(title, group)
    button.addEventListener('click', () => {
      selectedReport = report
      $('#report-title').textContent = report.name
      $('#report-description').textContent = report.description
      $$('.report-choice').forEach((b) => b.setAttribute('aria-pressed', String(b === button)))
    })
    host.append(button)
  }
  $('#reports-empty').hidden = host.children.length > 0
}
$('#report-filter').addEventListener('input', drawReports)
$('#preview-report').addEventListener('click', () => {
  $('#document-kind').value = 'report'
  $('#print-layout').value = 'modern'
  openPage('documents')
})
$$('[data-preview]').forEach((button) => button.addEventListener('click', () => {
  const isLedger = button.dataset.preview === 'ledger'
  $('#document-kind').value = isLedger ? 'report' : 'invoice'
  if (isLedger) selectedReport = reports.find((report) => report.name === 'Account ledger')
  $('#print-layout').value = 'modern'
  openPage('documents')
}))

function reportExample() {
  if (selectedReport.name === 'Stock position') return {
    headers: ['Sample item', 'Qty'],
    data: [[catalog[0].name, '20'], [catalog[1].name, '12']],
    totalLabel: 'Sample units', total: '32',
  }
  if (selectedReport.name === 'Account ledger') {
    const selected = visibleLedger()
    return {
      headers: ['Reference', 'Debit', 'Credit'],
      data: selected.map((entry) => [entry.reference, money(entry.debit), money(entry.credit)]),
      totalLabel: 'Sample debit / credit',
      total: `${money(selected.reduce((n, e) => n + e.debit, 0))} / ${money(selected.reduce((n, e) => n + e.credit, 0))}`,
    }
  }
  if (selectedReport.name === 'Purchase summary') return {
    headers: ['Description', 'Sample amount'],
    data: [['Sample purchase', money(total('purchase'))]],
    totalLabel: 'Illustrative total', total: money(total('purchase')),
  }
  return {
    headers: ['Description', 'Sample amount'],
    data: [['Sample sale', money(total('sale'))]],
    totalLabel: 'Illustrative total', total: money(total('sale')),
  }
}

function drawDocument() {
  const classic = $('#print-layout').value === 'classic'
  $('#paper').hidden = classic
  $('#classic-print-message').hidden = !classic
  const paperSize = $('#paper-size').value
  $('#paper').classList.toggle('receipt', paperSize !== 'a4')
  $('#paper').classList.toggle('narrow', paperSize === 'receipt58')
  const isReport = $('#document-kind').value === 'report'
  $('#paper-title').textContent = isReport ? selectedReport.name : 'Sale invoice'
  $('#paper-recipient').textContent = isReport ? 'Example report structure' : 'Sample walk-in customer'
  const table = $('#paper-table')
  table.tHead.replaceChildren()
  table.tBodies[0].replaceChildren()
  const head = document.createElement('tr')
  const report = reportExample()
  const headers = isReport ? report.headers : ['Description', 'Qty', 'Amount']
  for (const [index, name] of headers.entries()) {
    const th = document.createElement('th')
    th.scope = 'col'
    th.textContent = name
    if (index) th.className = 'num'
    head.append(th)
  }
  table.tHead.append(head)
  const data = isReport
    ? report.data
    : rows.sale.map((row) => [row.name, String(row.qty), valid(row) ? money(Math.round(row.qty * row.price)) : 'Invalid'])
  for (const values of data) {
    const tr = document.createElement('tr')
    values.forEach((value, i) => { const td = tr.insertCell(); td.textContent = value; if (i) td.className = 'num' })
    table.tBodies[0].append(tr)
  }
  $('#paper-total-label').textContent = isReport ? report.totalLabel : 'Total amount'
  $('#paper-total').textContent = isReport ? report.total : rows.sale.some((row) => !valid(row)) ? 'Check entries' : money(total('sale'))
}
for (const id of ['document-kind', 'paper-size', 'print-layout']) $(`#${id}`).addEventListener('change', drawDocument)
$('#return-modern-print').addEventListener('click', () => { $('#print-layout').value = 'modern'; drawDocument() })

const systemTheme = matchMedia('(prefers-color-scheme: dark)')
function applyAppearance() {
  const theme = $('#theme').value
  document.documentElement.dataset.theme = theme === 'system' ? systemTheme.matches ? 'dark' : 'light' : theme
  document.documentElement.dataset.density = $('#density').value
  document.documentElement.style.setProperty('--text-scale', Number($('#text-size').value) / 100)
  $('#text-size-value').textContent = `${$('#text-size').value}%`
  $('#appearance-status').textContent = `${$('#density').selectedOptions[0].textContent} / ${$('#theme').selectedOptions[0].textContent} theme`
}
for (const id of ['theme', 'density']) $(`#${id}`).addEventListener('change', applyAppearance)
$('#text-size').addEventListener('input', applyAppearance)
systemTheme.addEventListener('change', applyAppearance)
$('#interface-mode').addEventListener('change', () => {
  const mode = $('#interface-mode').selectedOptions[0].textContent
  $('#mode-notice').textContent = `${mode} is selected for the next sign-in. This is a preview; no preference has been saved.`
  announce(`${mode} selected for the next sign-in preview. The current workspace has not changed.`)
})

drawTabs()
drawRows('sale')
drawRows('purchase')
drawInventory()
showItem(catalog[0])
drawLedger()
drawReports()
drawDocument()
applyAppearance()
iconHidden()
