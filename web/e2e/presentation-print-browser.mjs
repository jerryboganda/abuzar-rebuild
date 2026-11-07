import { DwModel } from './src/dw/model.js'
import { NDwBase } from './src/runtime/native/dwctrl.js'
import { buildPages, pageSetup, printDocumentStyle } from './src/ui/print.js'
import { printTemplateFor, resolvePrintPresentation, printFamilies } from './src/ui/print-templates.js'

const text = (pages) => pages.map((page) => page.textContent.replace(/\s+/g, ' ').trim()).join('\n')

const report = {
  name: 'd_synthetic_modern_print',
  datawindow: {
    processing: '0', units: '0',
    'print.paper.size': '9', 'print.orientation': '0',
    'print.margin.left': '110', 'print.margin.right': '110',
    'print.margin.top': '96', 'print.margin.bottom': '96',
  },
  bands: {
    header: { height: '180' }, detail: { height: '90' }, summary: { height: '110' }, footer: { height: '90' },
    group: [{ level: '1', by: { _items: ['grp'] }, 'header.height': '70', 'trailer.height': '70' }],
  },
  table: {
    columns: [
      { name: 'grp', type: 'char(10)' },
      { name: 'quantity', type: 'long' },
      { name: 'amount', type: 'decimal(2)' },
      { name: 'description', type: 'char(100)' },
    ],
  },
  objects: [
    { name: 'title', type: 'text', band: 'header', text: 'Synthetic modern document', x: '0', y: '0', width: '3000', height: '90' },
    { name: 'grp_t', type: 'text', band: 'header', text: 'Group', x: '0', y: '100', width: '600', height: '60' },
    { name: 'quantity_t', type: 'text', band: 'header', text: 'Quantity', x: '700', y: '100', width: '600', height: '60' },
    { name: 'amount_t', type: 'text', band: 'header', text: 'Amount', x: '1300', y: '100', width: '700', height: '60' },
    { name: 'description_t', type: 'text', band: 'header', text: 'Description', x: '2000', y: '100', width: '1000', height: '60' },
    { name: 'grp', type: 'column', band: 'detail', x: '0', y: '0', width: '600', height: '70' },
    { name: 'quantity', type: 'column', band: 'detail', x: '700', y: '0', width: '600', height: '70', alignment: '1', tabsequence: '10' },
    { name: 'amount', type: 'column', band: 'detail', x: '1300', y: '0', width: '700', height: '70', alignment: '1', tabsequence: '20' },
    { name: 'description', type: 'column', band: 'detail', x: '2000', y: '0', width: '1000', height: '70' },
    { name: 'grp_label', type: 'text', band: 'header.1', text: 'Group detail', x: '0', y: '0', width: '1200', height: '60' },
    { name: 'group_total', type: 'compute', band: 'trailer.1', expression: 'sum(amount for group 1)', x: '1300', y: '0', width: '700', height: '70', alignment: '1' },
    { name: 'total', type: 'compute', band: 'summary', expression: 'sum(amount for all)', x: '1300', y: '0', width: '700', height: '80', alignment: '1' },
    { name: 'page_t', type: 'text', band: 'footer', text: 'Page', x: '0', y: '0', width: '300', height: '70' },
    { name: 'page_no', type: 'compute', band: 'footer', expression: 'page()', x: '320', y: '0', width: '200', height: '70' },
    { name: 'of_t', type: 'text', band: 'footer', text: 'of', x: '540', y: '0', width: '200', height: '70' },
    { name: 'page_count', type: 'compute', band: 'footer', expression: 'pagecount()', x: '760', y: '0', width: '200', height: '70' },
  ],
}

function makeControl(rt, model) {
  const control = new NDwBase(rt, 'datawindow', 'datawindow')
  control.attach(model)
  return control
}

function mountPrintPages(pages, model, presentation) {
  const frame = document.createElement('iframe')
  frame.title = `Synthetic ${presentation} document preview`
  frame.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;border:0;z-index:10000;background:white'
  document.body.append(frame)
  const doc = frame.contentDocument
  const css = [...document.querySelectorAll('style')].map((style) => style.textContent).join('\n')
  doc.open()
  doc.write(`<!doctype html><html><head><meta charset="utf-8"><style>${printDocumentStyle(css, pageSetup(model), presentation)}</style></head><body></body></html>`)
  doc.close()
  pages.forEach((page) => doc.body.append(doc.importNode(page, true)))
  return frame
}

function measuredPages(pages, model, presentation) {
  const frame = mountPrintPages(pages, model, presentation)
  try {
    return [...frame.contentDocument.querySelectorAll('.page')].map((page) => {
      const bounds = page.getBoundingClientRect()
      return {
        background: frame.contentWindow.getComputedStyle(page).backgroundColor,
        bands: [...page.querySelectorAll('.band')].map((element) => {
          const r = element.getBoundingClientRect()
          return { name: element.classList[1], x: r.x - bounds.x, y: r.y - bounds.y, width: r.width, height: r.height }
        }),
        objects: [...page.querySelectorAll('[data-obj]')].map((element) => {
          const r = element.getBoundingClientRect()
          return { name: element.dataset.obj, x: r.x - bounds.x, y: r.y - bounds.y, width: r.width, height: r.height }
        }),
      }
    })
  } finally { frame.remove() }
}

async function checkPrintPreferences(fixture, check, settle, storage) {
  const saved = fixture.session.preferences, oldFailure = storage.fail
  const settings = () => document.querySelector('.presentation-settings')
  const field = (name) => settings().querySelector(`select[name="${name}"]`)
  const family = (name) => field(`printFamily:${name}`)
  const open = () => { fixture.ui.openSettings(); return settings() }
  const save = async () => { settings().querySelector('form').requestSubmit(); await settle() }
  try {
    fixture.session.save({ ...saved, printMode: 'classic', printFamilies: { 'synthetic-future-family': 'modern' } })
    open()
    check([...settings().querySelectorAll('select[name^="printFamily:"]')].every((select) => select.value === ''),
      'Unspecified document families visibly follow the global print layout')
    check([...settings().querySelectorAll('select[name^="printFamily:"]')].every((select) =>
      select.labels.length === 1 && select.getAttribute('aria-describedby').split(/\s+/).every((id) =>
        document.getElementById(id)?.textContent)),
    'Each document family has an accessible label and preview or blocked explanation')
    check(family('item-label').querySelector('option[value=modern]').disabled,
      'Unavailable label templates cannot be newly selected')
    field('theme').value = saved.theme === 'dark' ? 'light' : 'dark'
    await save()
    check(!settings().open && Object.keys(fixture.session.preferences.printFamilies).join() === 'synthetic-future-family',
      'Saving an unrelated appearance choice does not materialize inherited family overrides')
    open(); field('printMode').value = 'modern'; await save()
    check(fixture.session.printModeFor('sales-invoice') === 'modern' &&
      fixture.session.printModeFor('purchase-invoice') === 'modern' &&
      !Object.hasOwn(fixture.session.preferences.printFamilies, 'sales-invoice'),
    'Changing the global layout updates inherited families without persisting overrides')
    open(); family('sales-invoice').value = 'classic'; await save()
    check(fixture.session.printModeFor('sales-invoice') === 'classic' &&
      fixture.session.printModeFor('purchase-invoice') === 'modern',
    'An explicit family layout remains independent of other documents')
    open(); field('printMode').value = 'classic'; await save()
    open(); field('printMode').value = 'modern'; await save()
    check(fixture.session.printModeFor('sales-invoice') === 'classic',
      'An explicit family choice survives later global layout changes')
    open(); family('sales-invoice').value = ''; await save()
    check(!Object.hasOwn(fixture.session.preferences.printFamilies, 'sales-invoice') &&
      fixture.session.printModeFor('sales-invoice') === 'modern',
    'Follow print layout removes an explicit override and restores live inheritance')
    open()
    check(family('sales-invoice').value === '', 'Reopening settings preserves the inherited selection')
    family('sales-invoice').value = 'classic'
    settings().querySelector('button[type=button]').click()
    check(fixture.session.printModeFor('sales-invoice') === 'modern',
      'Cancel does not persist an edited document-family choice')
    open(); family('sales-invoice').value = 'classic'
    storage.fail = true
    await save()
    check(settings().open && !settings().querySelector('[role=alert]').hidden &&
      fixture.session.printModeFor('sales-invoice') === 'modern' && family('sales-invoice').value === 'classic',
    'Failed storage keeps the unsaved family choice visible without changing the saved layout')
    storage.fail = false
    await save()
    check(!settings().open && fixture.session.printModeFor('sales-invoice') === 'classic',
      'Retry saves the retained family choice after storage recovers')
    fixture.session.save({ ...fixture.session.preferences, printFamilies: {
      ...fixture.session.preferences.printFamilies, 'item-label': 'modern',
    } })
    open()
    check(family('item-label').value === 'modern' &&
      family('item-label').selectedOptions[0].disabled &&
      document.getElementById(`${family('item-label').id}-availability`).textContent.includes('Not available'),
    'An existing unavailable choice is shown honestly with its blocking reason')
    family('item-label').value = ''
    await save()
    check(!Object.hasOwn(fixture.session.preferences.printFamilies, 'item-label'),
      'An unavailable stored override can be cleared without enabling its template')
    check(fixture.session.preferences.printFamilies['synthetic-future-family'] === 'modern',
      'Editing known document families preserves unregistered stored family choices')
    const control = makeControl(fixture.rt, new DwModel(fixture.rt, report.name, structuredClone(report)))
    let rejection
    try { await fixture.ui.print(control) } catch (error) { rejection = error.message }
    check(rejection?.includes('Select Classic print layout') && !rejection.includes('will print'),
      'Unavailable Modern printing reports the recovery action without claiming a print job occurred')
  } finally {
    storage.fail = false
    settings().close()
    fixture.session.save(saved)
    open()
    await save()
    storage.fail = oldFailure
  }
}

export async function checkModernPrint(fixture, check, settle, storage) {
  const definition = structuredClone(report)
  const model = new DwModel(fixture.rt, report.name, definition)
  for (let row = 1; row <= 120; row++) {
    model.insertRow(0)
    model.setItem(row, 'grp', row <= 60 ? 'A' : 'B')
    model.setItem(row, 'quantity', row)
    model.setItem(row, 'amount', row)
    model.setItem(row, 'description', row === 120 ? 'A long synthetic description that must wrap or clip without changing any other value.' : 'Synthetic line ' + row)
  }
  const control = makeControl(fixture.rt, model)
  await settle()

  const classic = await buildPages(control)
  const modern = await buildPages(control, { presentation: 'modern' })
  check(classic.length > 1, 'Synthetic report prints on more than one Classic page')
  check(classic.length === modern.length, 'Modern print preserves the Classic page count')
  check(classic.every((page) => !page.classList.contains('print-modern')), 'Classic print pages carry no Modern document class')
  check(modern.every((page) => page.classList.contains('print-modern')), 'Modern print pages carry the print-only document class')
  check(classic.every((page, index) => page.style.width === modern[index].style.width && page.style.height === modern[index].style.height),
    'Modern print preserves every page dimension')
  check(text(classic) === text(modern), 'Modern print preserves every visible text value, group label, total and page number')
  check(modern.some((page) => page.querySelector('.print-band-row')), 'Modern print marks detail bands without changing their content')
  check(modern.some((page) => page.querySelector('.print-band-gtr')), 'Modern print preserves group trailer bands')
  check(modern.some((page) => page.querySelector('.print-band-sum')), 'Modern print preserves the summary band')
  check(modern.some((page) => page.querySelector('.print-number-right')), 'Modern print identifies right-aligned numeric values')
  check(text(modern).includes('7260'), 'Modern print retains the full-report total')
  check(text(modern).includes('Page'), 'Modern print retains the source page footer')
  check(modern.flatMap((page) => [...page.querySelectorAll('[data-obj=quantity]')]).length === 120,
    'Modern print retains all detail rows exactly once')
  check(JSON.stringify(modern.flatMap((page) => [...page.querySelectorAll('[data-obj=group_total]')].map((element) =>
    element.textContent.trim()))) === JSON.stringify(['1830', '5430']), 'Modern print retains both exact group totals')
  check(modern.every((page, index) => page.querySelector('[data-obj=page_no]').textContent.trim() === String(index + 1) &&
    page.querySelector('[data-obj=page_count]').textContent.trim() === String(modern.length)),
  'Every page displays its exact current page number and total page count')
  const classicGeometry = measuredPages(classic, model, 'classic')
  const modernGeometry = measuredPages(modern, model, 'modern')
  const changedPositions = modernGeometry.flatMap((page, index) => page.objects.filter((object, position) =>
    JSON.stringify(object) !== JSON.stringify(classicGeometry[index].objects[position])))
  check(changedPositions.length === 0,
    `Modern print rules preserve measured field positions on paper: ${JSON.stringify(changedPositions.slice(0, 3))}`)
  check(JSON.stringify(classicGeometry.map((page) => page.bands)) === JSON.stringify(modernGeometry.map((page) => page.bands)),
    'Modern print rules preserve measured source band geometry on paper')
  check(modernGeometry.every((page) => page.background === 'rgb(255, 255, 255)'),
    'Mounted Modern documents use white paper instead of workspace theme colors')

  const emptyModel = new DwModel(fixture.rt, report.name, structuredClone(report))
  const emptyControl = makeControl(fixture.rt, emptyModel)
  const emptyClassic = await buildPages(emptyControl)
  const emptyModern = await buildPages(emptyControl, { presentation: 'modern' })
  check(emptyClassic.length === 1 && emptyModern.length === 1, 'Empty report keeps the Classic one-page behavior in both layouts')
  check(!text(emptyModern).includes('7260'), 'Empty report does not invent a summary total')
  check(text(emptyClassic) === text(emptyModern), 'Empty report preserves all visible values in both layouts')
  const hiddenDefinition = structuredClone(report)
  hiddenDefinition.bands.group[0]['header.height'] = '0'
  hiddenDefinition.bands.group[0]['trailer.height'] = '0'
  const hiddenModel = new DwModel(fixture.rt, report.name, hiddenDefinition)
  hiddenModel.insertRow(0)
  hiddenModel.setItem(1, 'amount', 5)
  const hiddenControl = makeControl(fixture.rt, hiddenModel)
  const hiddenClassic = measuredPages(await buildPages(hiddenControl), hiddenModel, 'classic')
  const hiddenModern = measuredPages(await buildPages(hiddenControl, { presentation: 'modern' }), hiddenModel, 'modern')
  check(JSON.stringify(hiddenClassic) === JSON.stringify(hiddenModern),
    'Modern rules do not reveal zero-height group bands or displace their adjacent rows')

  check(printTemplateFor('d_retailsaleinvreport')?.family === 'sales-invoice', 'The catalog resolves the sales-invoice definition')
  check(resolvePrintPresentation('d_retailsaleinvreport', 'modern', { preview: true }).presentation === 'modern',
    'The gated preview resolves to the Modern renderer only when previews are enabled')
  check(resolvePrintPresentation('d_retailsaleinvreport', 'modern', { preview: false }).presentation === 'classic',
    'A preview template stays Classic outside the gated host')
  check(printFamilies().some((family) => family.status === 'blocked' && family.blockedReason),
    'Blocked document families expose their reason instead of pretending to be available')
  await checkPrintPreferences(fixture, check, settle, storage)
  let preview
  window.openPrintDocumentPreview = (presentation) => {
    if (!['classic', 'modern'].includes(presentation)) throw new Error('Unsupported synthetic print preview')
    preview?.remove()
    preview = mountPrintPages(presentation === 'modern' ? modern : classic, model, presentation)
  }
  window.closePrintDocumentPreview = () => { preview?.remove(); preview = null }
}
