import { Runtime, Ref, Frame } from './src/runtime/interp.js'

export async function checkWindowSurfaces(fixture, check, settle) {
  const classes = await (await fetch('./presentation-windows.json')).json()
  for (const definition of classes) {
    definition.routines = new Map(Object.entries(definition.routines).map(([owner, routines]) => [owner, new Map(Object.entries(routines))]))
    fixture.rt.classes.set(definition.name, definition)
  }
  const oldFire = fixture.rt.fire
  const names = new Set(classes.map((definition) => definition.name))
  const events = []
  fixture.rt.fire = async (target, event, args) => {
    let owner = target
    while (owner && !names.has(owner.className)) owner = owner.parent
    if (!owner) return oldFire(target, event, args)
    events.push({ target, event })
    if (event === 'closequery' && target.props.get('preventClose')) return 1
    return Runtime.prototype.fire.call(fixture.rt, target, event, args)
  }
  const open = async (name, label = 'Synthetic value') => {
    let window
    const ref = new Ref(() => window, (value) => { window = value })
    ref.name = name
    let failure
    const pending = fixture.rt.sys.get('openwithparm').fn(fixture.rt, [ref, label], new Frame(null, null, 0))
    pending.catch((error) => { failure = error })
    await settle()
    if (failure) throw failure
    if (!window || !fixture.ui.views.has(window)) throw new Error(`Mapped window did not open: ${name}`)
    return { window, view: fixture.ui.views.get(window), pending }
  }
  const change = (input, value) => {
    input.value = value
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }
  if (fixture.session.activeMode === 'classic') {
    for (const definition of classes) {
      const f = await open(definition.name)
      check(!f.view.el.classList.contains('modern-window') && !f.view.el.closest('dialog') &&
        f.view.client.querySelectorAll('.ctl').length === definition.controls.length,
      `${definition.name}: Classic keeps its original layout and every control`)
      f.window.pbSet('title', 'Synthetic Classic response')
      check(f.view.ttlEl.textContent === 'Synthetic Classic response',
        `${definition.name}: Classic response titles exclude the unrelated MDI sheet title`)
      change(f.view.client.querySelector('input'), '12')
      f.view.ctlViews.get(f.window.children.get('cb_ok')).el.click()
      await f.pending
      check(Number(fixture.rt.globals.get('message').props.get('doubleparm')) === 12,
        `${definition.name}: Classic uses the same original return script`)
    }
    return
  }
  for (const definition of classes) {
    const f = await open(definition.name)
    const input = f.view.client.querySelector('input')
    check(f.view.el.classList.contains('modern-window') && !!f.view.el.closest('dialog[open].presentation-modern-dialog'),
      `${definition.name}: the complete real window uses a Modern modal layout`)
    check(input.getAttribute('aria-labelledby') && document.getElementById(input.getAttribute('aria-labelledby'))?.textContent.trim(),
      `${definition.name}: the existing label names the original edit control`)
    const control = [...f.view.ctlViews].find(([, binding]) => binding.el === input)[0]
    check(input === f.view.ctlViews.get(control).el, `${definition.name}: layout retains the existing control and bindings`)
    if (['w_arg_decimal_val', 'w_arg_integer_val'].includes(definition.name)) {
      check(document.getElementById(input.getAttribute('aria-labelledby')).textContent === 'Synthetic value',
        `${definition.name}: the original Open script sets the caller-supplied label`)
    }
    f.window.pbSet('title', 'Synthetic dynamic title')
    check(f.view.ttlEl.textContent === 'Synthetic dynamic title',
      `${definition.name}: the original title binding remains live`)
    await settle()
    const dialog = f.view.el.closest('dialog')
    check(dialog.getAttribute('aria-labelledby') === f.view.ttlEl.id,
      `${definition.name}: a changed window title names the modal`)
    f.window.pbSet('title', '')
    await settle()
    check(dialog.getAttribute('aria-labelledby') === input.getAttribute('aria-labelledby') &&
      f.view.el.classList.contains('window-untitled'),
      `${definition.name}: an untitled modal uses its live field label without inventing copy`)
    change(input, '12')
    check(control.props.get('text') === '12', `${definition.name}: input updates the original runtime control`)
    input.focus()
    input.setSelectionRange(1, 2)
    control.pbSet('x', 400)
    control.pbSet('width', 900)
    check(input.value === '12' && input.selectionStart === 1 && input.selectionEnd === 2,
      `${definition.name}: runtime geometry refresh preserves entered text and selection`)
    control.pbSet('enabled', false)
    check(input.disabled, `${definition.name}: original runtime disabling reaches the reflowed input`)
    control.pbSet('enabled', true)
    control.pbSet('visible', false)
    check(input.getClientRects().length === 0, `${definition.name}: original runtime visibility reaches the reflowed input`)
    control.pbSet('visible', true)
    f.window.props.set('preventClose', true)
    f.view.el.querySelector('.cls').click()
    await settle()
    check(f.view.el.isConnected && input.value === '12', `${definition.name}: cancelled CloseQuery retains the window and input`)
    f.window.props.set('preventClose', false)
    const invalid = definition.name === 'w_printer_copies' ? '0' : '-1'
    change(input, invalid)
    const ok = f.window.children.get('cb_ok')
    const okButton = f.view.ctlViews.get(ok).el
    okButton.focus()
    okButton.click()
    await settle()
    const message = document.querySelector('.presentation-runtime-dialog[open]')
    const expected = { w_printer_copies: 'Kindly enter valid copies no.', w_arg_integer_val: 'lesser then 0', w_arg_decimal_val: '[0-100]' }
    check(message?.textContent.includes(expected[definition.name] ?? 'negative'),
      `${definition.name}: the original invalid-value rule opens its validation message`)
    if (!message) throw new Error(`Missing validation message: ${definition.name}`)
    message.querySelector('button').click()
    await settle()
    check(f.view.el.isConnected && input.value === invalid && document.activeElement === (definition.name === 'w_printer_copies' ? okButton : input),
      `${definition.name}: rejected values and original focus behavior survive the validation message`)
    const accepted = definition.name === 'w_arg_integer_val' ? '12.5' : '12'
    change(input, accepted)
    events.length = 0
    f.view.ctlViews.get(ok).el.click()
    await settle()
    await f.pending
    check(!fixture.ui.views.has(f.window) && Number(fixture.rt.globals.get('message').props.get('doubleparm')) === Number(accepted),
      `${definition.name}: the real OK script returns the entered value through CloseWithReturn`)
    check(events.filter((event) => event.target === ok && event.event === 'clicked').length === 1,
      `${definition.name}: the original Clicked handler runs once`)
    if (definition.name !== 'w_printer_copies') {
      const cancelled = await open(definition.name)
      cancelled.view.ctlViews.get(cancelled.window.children.get('cb_cancel')).el.click()
      await cancelled.pending
      check(Number(fixture.rt.globals.get('message').props.get('doubleparm')) === -1,
        `${definition.name}: the original Cancel script returns its sentinel`)
    }
  }
  const f = await open('w_arg_decimal_val', 'Synthetic percentage')
  const input = f.view.client.querySelector('input')
  change(input, '101')
  f.view.ctlViews.get(f.window.children.get('cb_ok')).el.click()
  await settle()
  const validation = document.querySelector('.presentation-settings[open]')
  check(validation?.textContent.includes('Should be within range [0-100]') && f.view.el.isConnected,
    'The real range-validation script displays a nested Modern message without closing the form')
  validation.querySelector('button').click()
  await settle()
  check(document.activeElement === input && input.value === '101', 'Rejected input and focus survive the nested validation message')
  f.view.ctlViews.get(f.window.children.get('cb_cancel')).el.click()
  await f.pending
  check(Number(fixture.rt.globals.get('message').props.get('doubleparm')) === -1,
    'The existing Cancel script preserves its negative return value')
  for (const value of ['0', '100']) {
    const boundary = await open('w_arg_decimal_val')
    change(boundary.view.client.querySelector('input'), value)
    boundary.view.ctlViews.get(boundary.window.children.get('cb_ok')).el.click()
    await boundary.pending
    check(Number(fixture.rt.globals.get('message').props.get('doubleparm')) === Number(value),
      `The original percentage validation accepts its inclusive ${value} boundary`)
  }
  const definition = fixture.rt.classes.get('w_arg_amount')
  const extra = { ...definition.controls.find((control) => control.name === 'em_val'), name: 'new_field', field: 'new_field' }
  fixture.rt.classes.set(definition.name, { ...definition, controls: [...definition.controls, extra] })
  const changed = await open(definition.name)
  check(!changed.view.el.classList.contains('modern-window') && changed.view.ctlViews.size === 5 && changed.view.client.querySelectorAll('.ctl').length === 5,
    'A changed mapped window keeps every control in the Classic compatibility layout')
  await fixture.rt.closeWindow(changed.window)
  await changed.pending
  fixture.rt.classes.set(definition.name, definition)
  window.openPresentationWindowPreview = async (name = 'w_arg_decimal_val', label = 'Synthetic percentage') => {
    const preview = await open(name, label)
    events.length = 0
    const ok = preview.window.children.get('cb_ok')
    window.presentationWindowPreview = {
      ...preview,
      clicks: () => events.filter((event) => event.target === ok && event.event === 'clicked').length,
      returned: () => fixture.rt.globals.get('message').props.get('doubleparm'),
    }
  }
}
