import { Runtime, Ref, Frame } from './src/runtime/interp.js'
import { NWindow } from './src/runtime/native/controls.js'
import { PBObject } from './src/runtime/object.js'
import { registerWindowing } from './src/runtime/native/windowing.js'
import { registerSysFuncs } from './src/runtime/sysfuncs.js'
import { registerFileFuncs } from './src/runtime/sysfiles.js'
import { DwModel } from './src/dw/model.js'
import { PresentationSession } from './src/app/ui-preferences.js'
import { PresentationUi } from './src/ui/presentation-ui.js'
import { NativeAppearance } from './src/ui/native-appearance.js'
import { buildPages } from './src/ui/print.js'
import { checkDataSurfaces } from './presentation-data-browser.mjs'
import { checkWindowSurfaces } from './presentation-window-browser.mjs'
import { checkCalculatorSurfaces } from './presentation-calculator-browser.mjs'
import { checkAssociatedInvoices } from './presentation-associated-invoices-browser.mjs'
import { checkCashierClosing } from './presentation-cashier-browser.mjs'
import { checkCashierPayment } from './presentation-payment-browser.mjs'
import { checkCashierCategory } from './presentation-category-browser.mjs'
import { checkTabSurfaces } from './presentation-tabs-browser.mjs'
import { checkEntrySurfaces } from './presentation-entry-browser.mjs'
import { checkSingleEntrySurfaces } from './presentation-single-entry-browser.mjs'
import { checkDerivedModalWindows, checkDerivedEntryWindows, checkDerivedDataSurfaces } from './presentation-derived-browser.mjs'
import { checkChoiceEditors } from './presentation-choice-browser.mjs'
import { checkContactSurfaces } from './presentation-contact-browser.mjs'
import { checkContactCardSurfaces } from './presentation-contact-card-browser.mjs'
import { checkLookupDialogs } from './presentation-lookup-browser.mjs'
import { checkEditableLookups } from './presentation-editable-lookup-browser.mjs'
import { checkAutomaticChoices } from './presentation-automatic-choice-browser.mjs'
import { checkSelectorVariants } from './presentation-selector-variants-browser.mjs'
import { checkTransactionBands } from './presentation-transaction-bands-browser.mjs'
import { checkCriteriaSurfaces } from './presentation-criteria-browser.mjs'
import { checkCriteriaWindows } from './presentation-criteria-window-browser.mjs'
import { checkDataWindowCalendar } from './presentation-datawindow-calendar-browser.mjs'
import { checkModernPrint } from './presentation-print-browser.mjs'

const field = (name, value, type = 'long') => ({ name, value, type, attr: '0xbc' })
const definitions = new Map(['sale', 'purchase', 'response'].map((name) => [name, {
  name, kind: 'window', ancestor: 'window', library: 'synthetic', routines: new Map(),
  fields: [field('title', `Synthetic ${name}`, 'string'), field('width', 2600), field('height', 1600), field('windowstate', 2), field('windowtype', name === 'response' ? 3 : 1)],
  controls: [
    { name: 'st_note', ancestor: 'statictext', fields: [field('text', 'Reference', 'string'), field('x', 60), field('y', 50), field('width', 400), field('height', 100)], controls: [] },
    { name: 'sle_reference', ancestor: 'singlelineedit', fields: [field('text', 'Synthetic draft', 'string'), field('x', 500), field('y', 50), field('width', 1000), field('height', 110), field('taborder', 10)], controls: [] },
    { name: 'dw_grid', ancestor: 'datawindow', fields: [field('x', 60), field('y', 240), field('width', 2200), field('height', 1000), field('hscrollbar', true, 'boolean'), field('vscrollbar', true, 'boolean')], controls: [] },
  ],
}]))
const datawindow = {
  datawindow: { processing: '1', units: '0' },
  bands: { header: { height: '100' }, detail: { height: '100' } },
  table: { columns: [{ name: 'quantity', type: 'long', validation: 'number(gettext()) > 0', validationmsg: 'Enter a positive quantity.' }] },
  objects: [
    { name: 'quantity_t', type: 'text', band: 'header', text: 'Sample quantity', x: '0', y: '0', width: '800', height: '90' },
    { name: 'quantity', type: 'column', band: 'detail', id: '1', x: '0', y: '0', width: '800', height: '90', tabsequence: '10' },
  ],
}
const scope = { server: 'http://synthetic.invalid', database: 'fixture', appUser: '17', workstation: 'browser-check' }
const storage = {
  records: new Map(), fail: false,
  getItem(key) { return this.records.get(key) ?? null },
  setItem(key, value) { if (this.fail) throw new Error('Synthetic storage failure'); this.records.set(key, value) },
}
const nativeThemes = []
let failNativeTheme = false
const nativeAppearance = new NativeAppearance(() => ({
  async setTheme(theme) {
    nativeThemes.push(theme)
    if (failNativeTheme) throw new Error('Synthetic native theme failure')
  },
}))
window.presentationNativeThemes = nativeThemes
const errors = []
window.presentationRuntimeErrors = errors
window.addEventListener('error', (event) => errors.push(event.message))
window.addEventListener('unhandledrejection', (event) => errors.push(String(event.reason)))
const settle = () => new Promise((resolve) => setTimeout(resolve, 90))
let current

async function isolated(checks, ...args) {
  await checks(...args)
  const dialogs = [...document.querySelectorAll('dialog[open],.msgbox')]
  if (dialogs.length) throw new Error(`${checks.name} left unexpected dialogs: ${dialogs.map((dialog) => dialog.textContent).join(' | ')}`)
}

async function setup() {
  const rt = new Runtime({ load: async (name) => definitions.get(name) })
  registerSysFuncs(rt)
  registerWindowing(rt)
  registerFileFuncs(rt)
  rt.globals.set('message', new PBObject(rt, 'message', 'message'))
  const session = await PresentationSession.load(storage, scope)
  const ui = new PresentationUi(rt, document.getElementById('desktop'), session, nativeAppearance)
  rt.ui = ui
  rt.onError = (error) => { errors.push(String(error)) }
  rt.fire = async (window, event) => {
    if (event === 'closequery' && window.props.get('preventClose')) return 1
    if (event === 'clicked' && window.props.has('fixtureWindow')) await open(window.props.get('fixtureWindow'))
    return 0
  }
  // Do not invoke the native title bridge from a browser-only fixture.
  const frame = new NWindow(rt, 'w_synthetic_frame')
  frame.name = 'w_synthetic_frame'
  frame.props.set('windowtype', 4)
  frame.props.set('title', 'Synthetic fixtures / No database or printer connection')
  const menu = new PBObject(rt, 'm_synthetic', 'menu')
  menu.name = 'm_synthetic'
  for (const name of ['sale', 'purchase']) {
    const item = new PBObject(rt, 'm_' + name, 'menu')
    item.name = 'm_' + name
    item.props.set('text', 'Open synthetic ' + name)
    item.props.set('fixtureWindow', name)
    menu.children.set(name, item)
  }
  frame.props.set('menuid', menu)
  frame.isOpen = true
  ui.createWindow(frame, { sheet: false, modal: false })
  ui.showWindow(frame)
  const open = async (name) => {
    let window
    const ref = new Ref(() => window, (value) => { window = value })
    ref.name = name
    await rt.sys.get('opensheet').fn(rt, [ref, frame], new Frame(null, null, 0))
    const ctl = window.children.get('dw_grid')
    const model = new DwModel(rt, 'd_synthetic', datawindow)
    model.insertRow(0)
    model.setItem(1, 1, 7)
    ctl.attach(model)
    await settle()
    return window
  }
  const sale = await open('sale')
  const purchase = await open('purchase')
  ui.activate(sale)
  const openResponse = async () => {
    let response
    const ref = new Ref(() => response, (value) => { response = value })
    ref.name = 'response'
    const pending = rt.sys.get('openwithparm').fn(rt, [ref, 'synthetic parameter'], new Frame(null, null, 0))
    pending.catch((error) => errors.push(String(error)))
    await settle()
    if (!response || !ui.views.has(response)) throw new Error('Synthetic response window did not open.')
    return { response, pending }
  }
  return { rt, ui, session, frame, sale, purchase, open, openResponse }
}

async function teardown(fixture) {
  for (const window of [...fixture.ui.views.keys()].reverse()) {
    window.props.set('preventClose', false)
    await fixture.rt.closeWindow(window)
  }
  fixture.ui.dispose()
}

export async function runPresentationChecks() {
  const failures = []
  let passed = 0
  window.presentationCheckProgress = { get passed() { return passed }, failures }
  const check = (condition, name) => { if (condition) passed++; else failures.push(name) }
  const f = current
  check(nativeThemes.at(-1) === null, 'Modern System requests native system following, not a forced resolved theme')
  const tabs = () => [...document.querySelectorAll('[role=tab]')]
  const shortcut = () => document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 's', keyCode: 83, ctrlKey: true, bubbles: true, cancelable: true }))
  check(tabs().length === 2, 'Real runtime sheets create workspace tabs')
  check(!f.ui.views.get(f.sale).el.hidden && f.ui.views.get(f.purchase).el.hidden, 'Only active sheet is visible')
  const reference = f.ui.views.get(f.sale).el.querySelector('input')
  reference.focus()
  reference.value = 'Retained synthetic draft'
  reference.dispatchEvent(new Event('input', { bubbles: true }))
  reference.dispatchEvent(new Event('change', { bubbles: true }))
  tabs()[1].click()
  tabs()[0].click()
  check(reference.value === 'Retained synthetic draft', 'Switching tabs preserves the editor DOM and value')
  check(document.activeElement === reference, 'Returning to workspace restores focus')
  f.sale.pbSet('title', 'Synthetic sale - edited')
  check(tabs()[0].textContent === 'Synthetic sale - edited'
    && tabs()[0].parentElement.querySelector('button:last-child').getAttribute('aria-label') === 'Close Synthetic sale - edited', 'Workspace and close labels follow runtime title changes')
  check(f.ui.views.get(f.sale).ttlEl.textContent === 'Synthetic sale - edited'
    && f.ui.mdi.ttlEl.textContent.endsWith('[Synthetic sale - edited]'), 'Classic sheet and frame title bindings remain live inside Modern')
  const originalShortcut = f.ui.mdi.fireShortcut
  let shortcutCalls = 0
  f.ui.mdi.fireShortcut = () => { shortcutCalls++; return true }
  document.querySelector('.presentation-sidebar input').focus()
  shortcut()
  check(shortcutCalls === 0, 'Command search does not dispatch business accelerators')
  reference.focus()
  shortcut()
  check(shortcutCalls === 1, 'Active business controls retain existing accelerators')
  f.sale.props.set('preventClose', true)
  check(await f.rt.closeWindow(f.sale) === -1, 'CloseQuery cancellation')
  check(tabs().length === 2 && !f.sale.destroyed, 'Cancelled close retains workspace')
  f.sale.props.set('preventClose', false)
  const ctl = f.sale.children.get('dw_grid')
  const subscriptions = ctl.listeners.size
  const pages = await buildPages(ctl)
  check(pages.length > 0, 'Classic print pages still build')
  check(ctl.listeners.size === subscriptions, 'Print construction adds no live editor subscriptions')
  const { response, pending } = await f.openResponse()
  const responseDialog = document.querySelector('.presentation-compatibility-dialog')
  check(responseDialog?.open && tabs().length === 2, 'Runtime response windows get native modal containment, not workspace tabs')
  const nativeCancel = new Event('cancel', { cancelable: true })
  responseDialog.dispatchEvent(nativeCancel)
  check(nativeCancel.defaultPrevented && responseDialog.open, 'Native Escape cannot bypass the response-window runtime close lifecycle')
  const responseInput = f.ui.views.get(response).el.querySelector('input')
  responseInput.focus()
  reference.focus()
  check(document.activeElement === responseInput, 'A response window makes the background form inert')
  shortcut()
  check(shortcutCalls === 1 && f.ui.keyIsDown('keys!'), 'Response windows retain key state without invoking background accelerators')
  const nested = await f.openResponse()
  const nestedInput = f.ui.views.get(nested.response).el.querySelector('input')
  nestedInput.focus()
  responseInput.focus()
  check(document.activeElement === nestedInput && document.querySelectorAll('.presentation-compatibility-dialog[open]').length === 2,
    'Nested response windows retain distinct runtime instances and modal ownership')
  const nestedMessage = f.ui.messageBox('Nested synthetic choice', 'No transaction will be posted.', 'information!', 'ok!', 1)
  const nestedMessageDialog = document.querySelector('.presentation-runtime-dialog')
  nestedMessageDialog.querySelector('button').click()
  await nestedMessage
  check(document.activeElement === nestedInput && tabs().every((tab) => tab.disabled),
    'A message inside a response window restores its editor without unlocking workspaces')
  await f.rt.closeWindow(nested.response)
  check(await nested.pending === 1 && responseDialog.open && document.activeElement === responseInput
    && f.ui.views.get(response).el.classList.contains('active') && tabs().every((tab) => tab.disabled),
    'Closing a nested response restores the parent window activation, focus and modal ownership')
  response.props.set('preventClose', true)
  check(await f.rt.closeWindow(response) === -1 && responseDialog.open, 'Cancelled response-window close keeps modal ownership')
  response.props.set('preventClose', false)
  await f.rt.closeWindow(response)
  check(await pending === 1 && !responseDialog.isConnected, 'Accepted response close resolves the original runtime channel and removes its wrapper')
  check(document.activeElement === reference, 'Response window restores the invoking editor focus')
  check(f.ui.views.get(f.sale).el.classList.contains('active') && tabs()[0].getAttribute('aria-selected') === 'true'
    && f.ui.mdi.ttlEl.textContent.endsWith('[Synthetic sale - edited]'),
    'Closing a response restores active sheet, workspace selection and frame title')
  const answer = f.ui.messageBox('Synthetic choice', 'No transaction will be posted.', 'question!', 'yesnocancel!', 2)
  const message = document.querySelector('.presentation-runtime-dialog')
  check(message.open && document.activeElement.textContent === 'No', 'Runtime message focuses the specified default')
  check(message.querySelector('h2').textContent === 'Question: Synthetic choice', 'Message semantics include the original icon meaning')
  shortcut()
  check(shortcutCalls === 1, 'Runtime dialog prevents background menu accelerators')
  check(tabs().every((tab) => tab.disabled), 'Runtime dialog prevents workspace switching')
  message.querySelectorAll('button')[1].click()
  check(await answer === 2, 'Runtime message preserves PowerBuilder response codes')
  check(tabs().every((tab) => !tab.disabled), 'Closing runtime dialog restores workspace controls')
  check(document.activeElement === reference, 'Runtime message restores the prior editor focus')
  const warning = f.ui.messageBox('Synthetic warning', 'No transaction will be posted.', 'exclamation!', 'yesnocancel!', 1)
  const warningDialog = document.querySelector('.presentation-runtime-dialog')
  check(warningDialog.getAttribute('role') === 'alertdialog', 'Warnings expose alert-dialog semantics')
  warningDialog.dispatchEvent(new Event('cancel', { cancelable: true }))
  check(await warning === 3, 'Escape returns the explicit Cancel response')
  const requiredChoice = f.ui.messageBox('Synthetic decision', 'Choose without posting.', 'question!', 'yesno!', 2)
  const choiceDialog = document.querySelector('.presentation-runtime-dialog')
  choiceDialog.dispatchEvent(new Event('cancel', { cancelable: true }))
  check(choiceDialog.open, 'Escape cannot invent a response when Cancel is absent')
  choiceDialog.querySelectorAll('button')[1].click()
  await requiredChoice
  const prompted = f.ui.prompt('Synthetic prompt', 'Example only', 'initial')
  const prompt = document.querySelector('.presentation-runtime-dialog')
  prompt.querySelector('input').value = 'synthetic input'
  prompt.querySelector('form').requestSubmit()
  check(await prompted === 'synthetic input', 'Runtime prompt returns the entered value')
  f.ui.mdi.fireShortcut = originalShortcut

  f.ui.openSettings()
  const dialog = document.querySelector('.presentation-settings')
  const select = (name, value) => { dialog.querySelector(`[name="${name}"]`).value = value }
  select('mode', 'classic')
  select('theme', 'dark')
  select('density', 'comfortable')
  select('textSize', '200')
  dialog.querySelector('form').requestSubmit()
  check(!dialog.open && f.session.preferences.mode === 'classic', 'Settings save and close')
  check(f.session.activeMode === 'modern' && document.querySelector('.presentation-ui'), 'Interface change is deferred')
  check(document.querySelector('.presentation-ui').dataset.theme === 'dark', 'Saved theme applies to the workspace')
  check(document.querySelector('.presentation-ui').style.getPropertyValue('--p-scale') === '2', 'Saved text scale applies')
  await settle()
  check(nativeThemes.at(-1) === 'dark', 'Deferred Classic selection does not change the active Modern native theme')
  check(getComputedStyle(document.querySelector('.presentation-stage')).color === 'rgb(0, 0, 0)', 'Dark shell does not recolor Classic labels')
  check(getComputedStyle(document.querySelector('.presentation-stage')).fontSize === '12px', 'Text scaling does not distort compatibility geometry')
  check(!pages[0].closest('.presentation-ui') && pages[0].style.background, 'Print pages stay outside Modern theme scope')
  f.ui.openSettings()
  storage.fail = true
  select('theme', 'light')
  dialog.querySelector('form').requestSubmit()
  check(dialog.open && !dialog.querySelector('[role=alert]').hidden, 'Storage failure stays visible')
  check(f.session.preferences.theme === 'dark', 'Failed save does not alter current preferences')
  storage.fail = false
  dialog.close()
  await f.rt.closeWindow(f.sale)
  check(ctl.listeners.size === 0, 'Closed DataWindow releases subscriptions')
  check(f.sale.listeners.size === 0, 'Closed window releases subscriptions')
  check(f.sale.onProp === null, 'Closing a window releases its UI property hook')
  check(tabs().length === 1 && !f.ui.views.get(f.purchase).el.hidden, 'Accepted close selects remaining workspace')
  for (let i = 0; i < 5; i++) {
    const window = await f.open('sale')
    const control = window.children.get('dw_grid')
    await f.rt.closeWindow(window)
    check(control.listeners.size === 0 && window.listeners.size === 0, `Open-close cycle ${i + 1} releases subscriptions`)
  }
  const search = document.querySelector('.presentation-sidebar input')
  search.value = 'sale'
  search.dispatchEvent(new Event('input'))
  const matches = document.querySelectorAll('.presentation-command')
  check(matches.length === 1 && matches[0].textContent === 'Open synthetic sale', 'Live command search filters actual menu objects')
  search.value = ''
  search.dispatchEvent(new Event('input'))
  const modules = [...document.querySelectorAll('.presentation-module')]
  check(modules.length > 0 && modules.every((module) => module.querySelector('summary')?.textContent.trim()), 'An empty search browses the live menu by module')
  check(modules.every((module) => !module.querySelector('button')), 'Closed modules do not render their commands')
  modules[0].open = true
  await settle()
  check(modules[0].querySelectorAll('button.presentation-command').length > 0 && document.querySelector('.command-status').textContent.includes('modules'),
    'Opening a module lists its currently available commands')
  await matches[0].onclick(new MouseEvent('click'))
  check([...f.ui.views.keys()].filter((window) => window.className === 'sale').length === 1, 'Search executes the real menu event route')
  await teardown(f)
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', keyCode: 65 }))
  check(f.ui.down.size === 0, 'Disposed host no longer receives keyboard state')
  check(!document.querySelector('.presentation-ui,.presentation-settings'), 'Disposed shell and settings are removed')
  current = await setup()
  check(current.session.activeMode === 'classic' && !document.querySelector('.presentation-ui'), 'Next session honors Classic preference')
  check(nativeThemes.at(-1) === 'light', 'Classic uses Light native chrome even with a stored Dark preference')
  current.sale.pbSet('title', 'Synthetic Classic title')
  check(current.ui.views.get(current.sale).ttlEl.textContent === 'Synthetic Classic title'
    && current.ui.mdi.ttlEl.textContent.endsWith('[Synthetic Classic title]'), 'Classic mode preserves dynamic sheet and frame titles')
  await isolated(checkWindowSurfaces, current, check, settle)
  await isolated(checkCalculatorSurfaces, current, check, settle)
  await isolated(checkAssociatedInvoices, current, check, settle)
  await isolated(checkCashierClosing, current, check, settle)
  await isolated(checkCashierPayment, current, check, settle)
  await isolated(checkCashierCategory, current, check, settle)
  await isolated(checkTabSurfaces, current, check, settle)
  await isolated(checkEntrySurfaces, current, check, settle)
  await isolated(checkSingleEntrySurfaces, current, check, settle)
  await isolated(checkDerivedDataSurfaces, current, check, settle)
  await isolated(checkDerivedEntryWindows, current, check, settle)
  await isolated(checkDerivedModalWindows, current, check, settle)
  await isolated(checkChoiceEditors, check, settle)
  await isolated(checkEditableLookups, current, check, settle)
  await isolated(checkAutomaticChoices, current, check, settle)
  await isolated(checkSelectorVariants, current, check, settle)
  await isolated(checkTransactionBands, current, check, settle)
  await isolated(checkContactSurfaces, current, check, settle)
  await isolated(checkContactCardSurfaces, current, check, settle)
  await isolated(checkCriteriaSurfaces, current, check, settle)
  await isolated(checkCriteriaWindows, current, check, settle)
  await isolated(checkDataWindowCalendar, current, check, settle)
  await isolated(checkModernPrint, current, check, settle, storage)
  await teardown(current)
  storage.records.clear()
  current = await setup()
  await isolated(checkDataSurfaces, current, check, settle)
  await isolated(checkLookupDialogs, check, settle)
  await isolated(checkWindowSurfaces, current, check, settle)
  await isolated(checkCalculatorSurfaces, current, check, settle)
  await isolated(checkAssociatedInvoices, current, check, settle)
  await isolated(checkCashierClosing, current, check, settle)
  await isolated(checkCashierPayment, current, check, settle)
  await isolated(checkCashierCategory, current, check, settle)
  await isolated(checkTabSurfaces, current, check, settle)
  await isolated(checkEntrySurfaces, current, check, settle)
  await isolated(checkSingleEntrySurfaces, current, check, settle)
  await isolated(checkDerivedDataSurfaces, current, check, settle)
  await isolated(checkDerivedEntryWindows, current, check, settle)
  await isolated(checkDerivedModalWindows, current, check, settle)
  await isolated(checkChoiceEditors, check, settle)
  await isolated(checkEditableLookups, current, check, settle)
  await isolated(checkAutomaticChoices, current, check, settle)
  await isolated(checkSelectorVariants, current, check, settle)
  await isolated(checkTransactionBands, current, check, settle)
  await isolated(checkContactSurfaces, current, check, settle)
  await isolated(checkContactCardSurfaces, current, check, settle)
  await isolated(checkCriteriaSurfaces, current, check, settle)
  await isolated(checkCriteriaWindows, current, check, settle)
  await isolated(checkDataWindowCalendar, current, check, settle)
  await isolated(checkModernPrint, current, check, settle, storage)
  const nativeErrors = []
  const onError = current.rt.onError
  let nativeMessage
  current.rt.onError = (error) => {
    nativeErrors.push(error)
    nativeMessage = current.ui.messageBox('Appearance unavailable', error.message, 'stopsign!', 'ok!', 1)
  }
  const saveTheme = async (theme) => {
    current.ui.openSettings()
    const settings = document.querySelector('.presentation-settings:not(.presentation-runtime-dialog)')
    settings.querySelector('[name=theme]').value = theme
    settings.querySelector('form').requestSubmit()
    await settle()
  }
  failNativeTheme = true
  await saveTheme('dark')
  check(nativeErrors.length === 1 && document.querySelector('.presentation-runtime-dialog[open]')?.textContent.includes('desktop window theme could not be applied'),
    'Native theme failures are reported without recursively opening error dialogs')
  check(current.session.preferences.theme === 'dark' && document.querySelector('.presentation-ui').dataset.theme === 'dark',
    'A failed chrome update preserves the saved preference and usable workspace')
  document.querySelector('.presentation-runtime-dialog button').click()
  await nativeMessage
  const beforeRetry = nativeThemes.length
  failNativeTheme = false
  await saveTheme('dark')
  check(nativeThemes.length === beforeRetry + 1 && nativeErrors.length === 1,
    'Saving unchanged appearance explicitly retries a failed native theme')
  await saveTheme('system')
  check(nativeThemes.at(-1) === null, 'Returning to System releases the explicit native theme')
  current.rt.onError = onError
  check(errors.length === 0, 'No uncaught exceptions')
  return { passed, failures, errors }
}

current = await setup()
window.runPresentationChecks = runPresentationChecks
window.runPrintChecks = async () => {
  let passed = 0
  const failures = []
  window.presentationCheckProgress = { get passed() { return passed }, failures }
  const check = (condition, name) => { if (condition) passed++; else failures.push(name) }
  for (const mode of ['classic', 'modern']) {
    current.session.save({ ...current.session.preferences, mode })
    await teardown(current)
    current = await setup()
    await isolated(checkModernPrint, current, (condition, name) => check(condition, `${mode}: ${name}`), settle, storage)
  }
  return { passed, failures, errors }
}
window.runSingleEntryChecks = async () => {
  let passed = 0
  const failures = []
  window.presentationCheckProgress = { get passed() { return passed }, failures }
  const check = (condition, name) => { if (condition) passed++; else failures.push(name) }
  for (const mode of ['classic', 'modern']) {
    current.session.save({ ...current.session.preferences, mode })
    await teardown(current)
    current = await setup()
    await isolated(checkSingleEntrySurfaces, current, (condition, name) => check(condition, `${mode}: ${name}`), settle)
  }
  return { passed, failures, errors }
}
window.runDerivedChecks = async () => {
  let passed = 0
  const failures = []
  window.presentationCheckProgress = { get passed() { return passed }, failures }
  const check = (condition, name) => { if (condition) passed++; else failures.push(name) }
  for (const mode of ['classic', 'modern']) {
    current.session.save({ ...current.session.preferences, mode })
    await teardown(current)
    current = await setup()
    await isolated(checkDerivedDataSurfaces, current, (condition, name) => check(condition, `${mode}: ${name}`), settle, window.derivedFilter)
    await isolated(checkDerivedEntryWindows, current, (condition, name) => check(condition, `${mode}: ${name}`), settle, window.derivedFilter)
    await isolated(checkDerivedModalWindows, current, (condition, name) => check(condition, `${mode}: ${name}`), settle, window.derivedFilter)
  }
  return { passed, failures, errors }
}
window.runForcedColorChecks = async () => {
  let passed = 0
  const failures = []
  const check = (condition, name) => { if (condition) passed++; else failures.push(name) }
  await isolated(checkDataSurfaces, current, check, settle)
  await isolated(checkCalculatorSurfaces, current, check, settle)
  return { passed, failures, errors }
}
window.runCriteriaChecks = async () => {
  let passed = 0
  const failures = []
  window.presentationCheckProgress = { get passed() { return passed }, failures }
  const check = (condition, name) => { if (condition) passed++; else failures.push(name) }
  for (const mode of ['classic', 'modern']) {
    await current.session.save({ ...current.session.preferences, mode })
    await teardown(current)
    current = await setup()
    await isolated(checkCriteriaSurfaces, current, (condition, name) => check(condition, `${mode}: ${name}`), settle)
  }
  return { passed, failures, errors }
}
window.runDataWindowCalendarChecks = async () => {
  let passed = 0
  const failures = []
  window.presentationCheckProgress = { get passed() { return passed }, failures }
  const check = (condition, name) => { if (condition) passed++; else failures.push(name) }
  for (const mode of ['classic', 'modern']) {
    await current.session.save({ ...current.session.preferences, mode })
    await teardown(current)
    current = await setup()
    await isolated(checkDataWindowCalendar, current, (condition, name) => check(condition, `${mode}: ${name}`), settle)
  }
  return { passed, failures, errors }
}
window.runCriteriaWindowChecks = async (onlyNames) => {
  let passed = 0
  const failures = []
  window.presentationCheckProgress = { get passed() { return passed }, failures }
  const check = (condition, name) => { if (condition) passed++; else failures.push(name) }
  for (const mode of ['classic', 'modern']) {
    await current.session.save({ ...current.session.preferences, mode })
    await teardown(current)
    current = await setup()
    await isolated(checkCriteriaWindows, current, (condition, name) => check(condition, `${mode}: ${name}`), settle, onlyNames)
  }
  return { passed, failures, errors }
}
window.runEditableLookupChecks = async () => {
  let passed = 0
  const failures = []
  window.presentationCheckProgress = { get passed() { return passed }, failures }
  const check = (condition, name) => { if (condition) passed++; else failures.push(name) }
  await isolated(checkChoiceEditors, check, settle)
  for (const mode of ['classic', 'modern']) {
    current.session.save({ ...current.session.preferences, mode })
    await teardown(current)
    current = await setup()
    current.ui.activate(current.purchase)
    await isolated(checkEditableLookups, current, (condition, name) => check(condition, `${mode}: ${name}`), settle)
    await isolated(checkAutomaticChoices, current, (condition, name) => check(condition, `${mode}: ${name}`), settle)
    await isolated(checkSelectorVariants, current, (condition, name) => check(condition, `${mode}: ${name}`), settle)
    await isolated(checkContactSurfaces, current, (condition, name) => check(condition, `${mode}: ${name}`), settle)
    await isolated(checkContactCardSurfaces, current, (condition, name) => check(condition, `${mode}: ${name}`), settle)
  }
  return { passed, failures, errors }
}
window.runTransactionBandChecks = async () => {
  let passed = 0
  const failures = []
  window.presentationCheckProgress = { get passed() { return passed }, failures }
  const check = (condition, name) => { if (condition) passed++; else failures.push(name) }
  for (const mode of ['classic', 'modern']) {
    await current.session.save({ ...current.session.preferences, mode })
    await teardown(current)
    current = await setup()
    await isolated(checkTransactionBands, current, (condition, name) => check(condition, `${mode}: ${name}`), settle)
  }
  return { passed, failures, errors }
}
window.runAssociatedInvoiceChecks = async () => {
  let passed = 0
  const failures = []
  window.presentationCheckProgress = { get passed() { return passed }, failures }
  const check = (condition, name) => { if (condition) passed++; else failures.push(name) }
  for (const mode of ['classic', 'modern']) {
    await current.session.save({ ...current.session.preferences, mode })
    await teardown(current)
    current = await setup()
    await isolated(checkAssociatedInvoices, current, (condition, name) => check(condition, `${mode}: ${name}`), settle)
  }
  return { passed, failures, errors }
}
window.runCashierChecks = async () => {
  let passed = 0
  const failures = []
  window.presentationCheckProgress = { get passed() { return passed }, failures }
  const check = (condition, name) => { if (condition) passed++; else failures.push(name) }
  for (const mode of ['classic', 'modern']) {
    await current.session.save({ ...current.session.preferences, mode })
    await teardown(current)
    current = await setup()
    await isolated(checkCashierClosing, current, (condition, name) => check(condition, `${mode}: ${name}`), settle)
  }
  return { passed, failures, errors }
}
window.runPaymentChecks = async () => {
  let passed = 0
  const failures = []
  window.presentationCheckProgress = { get passed() { return passed }, failures }
  const check = (condition, name) => { if (condition) passed++; else failures.push(name) }
  for (const mode of ['classic', 'modern']) {
    await current.session.save({ ...current.session.preferences, mode })
    await teardown(current)
    current = await setup()
    await isolated(checkCashierPayment, current, (condition, name) => check(condition, `${mode}: ${name}`), settle)
  }

  return { passed, failures, errors }
}
window.runCategoryChecks = async () => {
  let passed = 0
  const failures = []
  window.presentationCheckProgress = { get passed() { return passed }, failures }
  const check = (condition, name) => { if (condition) passed++; else failures.push(name) }
  for (const mode of ['classic', 'modern']) {
    await current.session.save({ ...current.session.preferences, mode })
    await teardown(current)
    current = await setup()
    await isolated(checkCashierCategory, current, (condition, name) => check(condition, `${mode}: ${name}`), settle)
  }
  return { passed, failures, errors }
}
window.presentationFixtureReady = true
