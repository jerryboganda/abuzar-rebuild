import { Runtime, Ref, Frame } from './src/runtime/interp.js'
import { PBStruct } from './src/runtime/object.js'
import { NDwBase } from './src/runtime/native/dwctrl.js'
import { NTransaction, executeStatement, stmtKey } from './src/runtime/native/transaction.js'
import { DwCatalog } from './src/dw/def.js'
import { DwModel } from './src/dw/model.js'

// Original Open, ItemChanged, OK and Cancel scripts; only SQL results and preferences are synthetic.
export async function checkCalculatorSurfaces(fixture, check, settle) {
  const source = await (await fetch('./presentation-calculators.json')).json()
  const rt = fixture.rt
  for (const definition of source.classes) {
    definition.routines = new Map(Object.entries(definition.routines).map(([owner, routines]) => [owner, new Map(Object.entries(routines))]))
    rt.classes.set(definition.name, definition)
  }
  const names = new Set(source.surfaces.map((surface) => surface.name))
  let old
  const catalog = new DwCatalog(async () => undefined)
  catalog.get = async (name) => source.data[name] ? structuredClone(source.data[name]) : undefined
  const statements = new Map(source.statements.map((statement) => [stmtKey(statement.original), statement]))
  const events = [], calls = []
  const transaction = new NTransaction(rt, 'transaction')
  transaction.db = {
    query: async (sql, params) => {
      calls.push({ sql, params })
      if (sql === source.retrieve.sql && params.length === 0) return {
        columns: [{ name: 'netamount', type: 'numeric' }, { name: 'processingfeeperc', type: 'numeric' }], rows: [[0, 0]],
      }
      const statement = source.statements.find((statement) => statement.sql === sql)
      if (!statement || params.length !== 1) throw new Error('Unexpected calculator query')
      if (statement.params[0] === 'as_col' && params[0] === 'Qty') return {
        columns: [{ name: 'styledesc', type: 'text' }, { name: 'stylename', type: 'text' }],
        rows: [['##,###,##0.0000', 'Qty']],
      }
      if (params[0] !== 901) throw new Error('Unexpected calculator item identity')
      const values = ['SYN-901', 'Synthetic calculator item', 120, 10, 1, 1].slice(0, statement.into.length)
      return { columns: statement.into.map((name, index) => ({ name, type: index < 2 ? 'text' : 'numeric' })), rows: [values] }
    },
    exec: async () => { throw new Error('Calculator fixtures forbid database writes') },
    call: async () => { throw new Error('Calculator fixtures forbid procedures') },
    commit: async () => { throw new Error('Calculator fixtures forbid commits') },
    rollback: async () => { throw new Error('Unexpected calculator rollback') },
    close: async () => {},
  }
  const precision = new NDwBase(rt, 'datastore', 'datastore')
  const precisionModel = new DwModel(rt, 'synthetic_precision', {
    datawindow: {}, bands: {}, objects: [], table: { columns: [{ name: 'colprecision', type: 'long' }] },
  })
  precisionModel.insertRow(0)
  precisionModel.setItem(1, 'colprecision', 4)
  precision.attach(precisionModel)
  const activate = () => {
    old = { catalog: rt.dwCatalog, fire: rt.fire, sql: rt.sql, statement: rt.sqlStmt, dwSql: rt.dwSql,
      sqlca: rt.globals.get('sqlca'), precision: rt.globals.get('gds_colpref') }
    rt.dwCatalog = catalog
    rt.sql = executeStatement
    rt.sqlStmt = (key) => statements.get(key)
    rt.dwSql = (name) => name === 'd_set_flatdiscamt' ? source.retrieve : undefined
    rt.globals.set('sqlca', transaction)
    rt.globals.set('gds_colpref', precision)
    rt.fire = async (target, event, args) => {
      let owner = target
      while (owner && !names.has(owner.className)) owner = owner.parent
      if (!owner) return old.fire(target, event, args)
      events.push({ target, event, args })
      return Runtime.prototype.fire.call(rt, target, event, args)
    }
  }
  const restore = () => {
    rt.dwCatalog = old.catalog; rt.fire = old.fire; rt.sql = old.sql; rt.sqlStmt = old.statement; rt.dwSql = old.dwSql
    for (const [name, value] of [['sqlca', old.sqlca], ['gds_colpref', old.precision]]) {
      if (value === undefined) rt.globals.delete(name)
      else rt.globals.set(name, value)
    }
  }
  const open = async (name, argumentsOverride = {}) => {
    const surface = source.surfaces.find((surface) => surface.name === name)
    const argument = new PBStruct('s_amountoninvoice')
    for (const [key, value] of Object.entries({
      l_invcode: 901, s_module: 'sales', d_netamt: name === 'w_discountcalculator' ? 150 : name === 'w_pricecalculator' ? 118 : 12,
      d_balance: name === 'w_discountcalculator' ? 200 : name === 'w_pricecalculator' ? 118 : 10, d_value: 120, d_amt: 18, i_status: -1,
      c_paymentmode: name === 'w_discountcalculator' ? 'B' : 'D', i_acccode: 71, s_reference: 'Synthetic reference', ...argumentsOverride,
    })) argument.pbSet(key, value)
    let window, failure
    const ref = new Ref(() => window, (value) => { window = value })
    ref.name = name
    calls.length = 0; events.length = 0
    const pending = rt.sys.get('openwithparm').fn(rt,
      [ref, name === 'w_set_flatdiscamt' ? 999.99 : argument], new Frame(null, null, 0))
    pending.catch((error) => { failure = error })
    await settle()
    if (failure) throw failure
    const view = fixture.ui.views.get(window)
    const control = window?.children.get(surface.data[0].control)
    await control?.ready
    if (!view || !control?.model || control.model.rowCount() !== 1) throw new Error(`Calculator did not open: ${name}`)
    const dw = view.ctlViews.get(control).dw, model = control.model
    const edit = async (column) => {
      model.row = 1
      model.col = model.colIndex(column) + 1
      await fixture.ui.focusDw(control, true)
      await settle()
      if (!dw.editor) throw new Error(`Calculator editor missing: ${name}/${column}`)
      return dw.editor
    }
    const click = (name) => view.ctlViews.get(window.children.get(name)).el.click()
    return { name, surface, argument, window, view, control, model, dw, pending, edit, click,
      returned: () => rt.globals.get('message').props.get(name === 'w_set_flatdiscamt' ? 'doubleparm' : 'powerobjectparm') }
  }
  const change = (input, value) => {
    input.value = String(value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }
  const accept = async (f, name, value, expected = true) => {
    change(await f.edit(name), value)
    let done = false
    const pending = f.dw.acceptPendingEdit().finally(() => { done = true })
    let messages = 0
    for (let attempts = 0; !done && attempts < 12; attempts++) {
      await settle()
      const message = document.querySelector('.presentation-runtime-dialog[open],.msgbox')
      if (message) {
        messages++
        check(!expected, `${f.name}/${name}: only a rejected value opens validation feedback`)
        message.querySelector('button').click()
      }
    }
    if (!done) throw new Error(`Calculator acceptance did not settle: ${f.name}/${name}`)
    const accepted = await pending
    check(accepted === expected, `${f.name}/${name}: recovered validation ${expected ? 'accepts' : 'rejects'} ${value}`)
    if (!expected) check(f.dw.editor?.value === String(value) && f.dw.editor?.getAttribute('aria-invalid') === 'true',
      `${f.name}/${name}: rejected input remains editable and marked invalid`)
    await settle()
    return messages
  }
  const modern = fixture.session.activeMode === 'modern'
  activate()
  try {
    for (const surface of source.surfaces) {
      const f = await open(surface.name)
      try {
        check(f.view.el.classList.contains('modern-data-window') === modern,
          `${f.name}: only Modern reflows the calculator dialog`)
        check(f.view.ctlViews.size === 3 && [...f.view.ctlViews.values()].every((binding) => f.view.client.contains(binding.el)),
          `${f.name}: all source controls and original button bindings remain present`)
        check(f.name === 'w_set_flatdiscamt' ? Number(f.model.getItem(1, 'netamount')) === 999.99 :
          f.model.getItem(1, 'name') === 'Synthetic calculator item',
        `${f.name}: the original Open handler initializes caller data and synthetic query results`)
        check(calls.length === (f.name === 'w_qty_rate_value_calculator' ? 2 : 1),
          `${f.name}: Open uses only the expected read-only query contract`)
        if (modern) {
          const visible = surface.data[0].surface.fields.filter((field) =>
            (f.model.overrides.get(`${field.object}.visible`) ?? f.model.def.objects.find((object) => object.name === field.object)?.visible) !== '0')
          check(f.dw.root.classList.contains('modern-surface') && f.dw.root.querySelectorAll('.surface-field').length === visible.length,
            `${f.name}: the scoped form renders every source presentation field`)
          check([...f.dw.root.querySelectorAll('.surface-value')].every((field) =>
            document.getElementById(field.getAttribute('aria-labelledby'))?.textContent.trim()),
          `${f.name}: every editable and calculated value has its source label`)
        }
        if (f.name === 'w_discountcalculator') {
          check(f.model.getItem(1, 'type') === 'D' && f.model.describe('type.visible') === '1',
            'The original mixed-discount argument reveals the radio choices and starts with percentage')
          check(Number(await f.control.n_getitemdecimal(1, 'c_discount')) === 25,
            'Discount calculator uses the original percentage expression')
          const group = await f.edit('type')
          check(group instanceof HTMLFieldSetElement && group.querySelectorAll('input[type=radio]').length === 2,
            'Discount type uses native radios in both Classic and Modern')
          group.querySelector('input[value="0"]').click()
          await settle()
          check(f.model.getItem(1, 'type') === 'F' && Number(await f.control.n_getitemdecimal(1, 'c_discount')) === 50,
            'A real radio click retains the original flat-discount key and expression')
          check(events.filter((event) => event.target === f.control && event.event === 'itemchanged' && event.args[1].name === 'type').length === 1,
            'A radio click reaches the recovered ItemChanged exactly once')
          if (modern) {
            const maxHeight = f.view.el.style.maxHeight
            f.view.el.style.maxHeight = '100px'
            f.view.el.scrollTop = 0
            await f.dw.render()
            check(f.view.el.scrollTop === 0 && f.dw.editor?.contains(document.activeElement),
              'Passive radio redraw keeps native focus without undoing deliberate ancestor scrolling')
            f.view.el.style.maxHeight = maxHeight
            await settle()
          }
          await f.control.n_settext('D')
          check(await f.control.n_gettext() === 'D' && f.model.getItem(1, 'type') === 'F',
            'Radio GetText/SetText owns a pending source key without writing')
          f.control.changed()
          await settle()
          check(f.dw.editor?.querySelector('input:checked')?.value === '1' && await f.control.n_gettext() === 'D',
            'A radio draft survives DataWindow repaint')
          check(await f.control.n_accepttext() === 1 && f.model.getItem(1, 'type') === 'D',
            'Native AcceptText applies the retained radio key')
          await settle()
          check(f.dw.editor === null, 'Accepted radio focus restoration does not reopen its editor')
          const rate = await f.edit('rate')
          rate.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }))
          await settle()
          check(f.dw.editObj === 'type' && f.dw.editor instanceof HTMLFieldSetElement && f.dw.editor.contains(document.activeElement),
            'Shift+Tab reaches the source-revealed radio field using its live TabSequence')
          f.dw.editor?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
          await settle()
          check(f.dw.editor === null && fixture.ui.views.has(f.window),
            'Escape closes the radio editor without reopening it or cancelling the calculator')
          await accept(f, 'rate', -1, false)
          await accept(f, 'rate', 250)
          f.click('cb_ok')
          await settle()
          const validation = document.querySelector('.presentation-runtime-dialog[open],.msgbox')
          check(validation?.textContent.includes('Net Rate Validation'), 'Original OK validation rejects a rate above the invoice rate')
          validation?.querySelector('button').click()
          await settle()
          check(fixture.ui.views.has(f.window), 'Invalid net rate cannot close or return from the calculator')
          check(events.filter((event) => event.target.name === 'cb_ok' && event.event === 'clicked').length === 1,
            'The rejected OK action invokes the source handler only once')
          await accept(f, 'rate', 100)
          const flat = await f.edit('type')
          if (!(flat instanceof HTMLFieldSetElement)) throw new Error(`Discount type did not focus its radio group: ${JSON.stringify({
            mode: fixture.session.activeMode, column: f.model.col, object: f.dw.editObj, editor: flat.outerHTML,
          })}`)
          flat.querySelector('input[value="0"]').click()
          await settle()
          check(Number(await f.control.n_getitemdecimal(1, 'c_discount')) === 100,
            'The source flat-discount calculation uses the accepted net rate')
        } else if (f.name === 'w_pricecalculator') {
          check(Number(await f.control.n_getitemdecimal(1, 'c_price')) === 100, 'Price calculator uses the recovered GST-exclusive expression')
          await accept(f, 'rate', -1, false)
          check(Number(f.model.getItem(1, 'rate')) === 118, 'Rejected price does not change the stored rate')
          await accept(f, 'rate', 236)
          await accept(f, 'gstperc', 0)
          check(Number(await f.control.n_getitemdecimal(1, 'c_price')) === 236, 'Zero GST preserves the inclusive rate')
          await accept(f, 'gstperc', 100)
          check(Number(await f.control.n_getitemdecimal(1, 'c_price')) === 118, 'The source accepts the inclusive 100-percent GST boundary')
          await accept(f, 'gstperc', 101, false)
          await accept(f, 'gstperc', 18)
          check(Number(await f.control.n_getitemdecimal(1, 'c_price')) === 200, 'Price changes recalculate GST-exclusive value through the original expression')
          if (modern) {
            const input = await f.edit('gstperc')
            change(input, '18')
            input.setSelectionRange(1, 2)
            await settle()
            const maxHeight = f.view.el.style.maxHeight
            f.view.el.style.maxHeight = '100px'
            f.view.el.scrollTop = 0
            await f.dw.render()
            check(f.view.el.scrollTop === 0 && f.dw.editor === document.activeElement &&
              f.dw.editor.value === '18' && f.dw.editor.selectionStart === 1 && f.dw.editor.selectionEnd === 2,
            'Passive numeric-editor repaint preserves user scroll, focus, draft and selection')
            f.view.el.style.maxHeight = maxHeight
            await accept(f, 'gstperc', 18)
          }
        } else if (f.name === 'w_qty_rate_value_calculator') {
          await accept(f, 'value', 0, false)
          check(Number(f.model.getItem(1, 'value')) === 120 && Number(f.model.getItem(1, 'looseqty')) === 10,
            'Rejected calculator value cannot mutate quantity')
          await accept(f, 'value', 36)
          check(Number(f.model.getItem(1, 'looseqty')) === 3, 'Value editing runs the recovered quantity calculation')
          await accept(f, 'rate', 18)
          check(Number(f.model.getItem(1, 'looseqty')) === 2, 'Rate editing runs the recovered quantity calculation')
          await accept(f, 'looseqty', 5)
          check(Number(f.model.getItem(1, 'value')) === 90, 'Quantity editing runs the recovered value calculation')
          if (modern) {
            const group = () => f.dw.root.querySelector('[data-group=gb_1]')
            check(group()?.getAttribute('role') === 'group' &&
              document.getElementById(group().getAttribute('aria-labelledby'))?.textContent === 'Item Information',
            'Quantity calculator retains the source group caption and semantic field grouping')
            await f.control.n_modify("gb_1.text='Synthetic item information' gb_1.visible=0")
            await settle()
            check(!group()?.hasAttribute('aria-labelledby') &&
              group()?.querySelector('[data-obj=name]')?.getClientRects().length > 0,
            'Hiding a source groupbox hides its caption, not independently visible fields')
            await f.control.n_modify('gb_1.visible=1')
            await settle()
            check(document.getElementById(group().getAttribute('aria-labelledby'))?.textContent === 'Synthetic item information',
              'Runtime group caption changes reach the semantic form')
          }
        } else {
          await accept(f, 'discperc', -1, false)
          await accept(f, 'discperc', 100, false)
          check(Number(f.model.getItem(1, 'discperc')) === 0, 'The recovered discount definition rejects both out-of-range endpoints without a write')
          await accept(f, 'discperc', 0)
          await accept(f, 'discperc', 12.5)
          check(Number(await f.control.n_getitemnumber(1, 'c_discamt')) === 125 &&
            Number(await f.control.n_getitemnumber(1, 'c_newnetamount')) === 875,
          'GST discount uses the recovered nested amount and whole-invoice rounding')
          if (modern) {
            const windowStyle = f.view.el.style.cssText, dataStyle = f.dw.root.style.cssText
            try {
              f.view.el.style.setProperty('width', '284px', 'important')
              f.view.el.style.maxHeight = '300px'
              for (const root of [f.view.el, f.dw.root]) root.style.setProperty('--p-scale', '2')
              await f.dw.render()
              await settle()
              const action = f.view.ctlViews.get(f.window.children.get('cb_ok')).el
              const visible = () => {
                const bounds = action.getBoundingClientRect(), box = f.view.el.getBoundingClientRect()
                return bounds.top >= box.top + f.view.el.clientTop &&
                  bounds.bottom <= box.top + f.view.el.clientTop + f.view.el.clientHeight &&
                  bounds.left >= box.left && bounds.right <= box.right
              }
              f.dw.status.textContent = 'Ready'
              action.focus({ preventScroll: true })
              const actionBounds = action.getBoundingClientRect(), windowBounds = f.view.el.getBoundingClientRect()
              f.view.el.scrollTop += actionBounds.bottom -
                (windowBounds.top + f.view.el.clientTop + f.view.el.clientHeight - 12)
              check(visible(), 'The post-acceptance action starts completely visible beside the short Ready status')
              await f.dw.render()
              check(document.activeElement === action && visible(),
                'Restoring the wrapped form summary cannot push a focused dialog action below the scrollport')
              f.view.el.scrollTop = 0
              f.dw.status.textContent = 'Ready'
              await f.dw.render()
              check(f.view.el.scrollTop === 0 && document.activeElement === action && !visible(),
                'A passive form repaint does not pull a deliberately scrolled-away dialog action back')
            } finally {
              f.view.el.style.cssText = windowStyle
              f.dw.root.style.cssText = dataStyle
              await f.dw.render()
              await settle()
            }
          }
        }
        events.length = 0
        const ok = f.window.children.get('cb_ok')
        f.click('cb_ok')
        await f.pending
        const returned = f.returned()
        const okClicks = events.filter((event) => event.target === ok && event.event === 'clicked').length
        check(okClicks === 1,
          `${f.name}/${fixture.session.activeMode}: each OK action invokes its original Clicked handler once (${okClicks})`)
        check(!fixture.ui.views.has(f.window), `${f.name}: the original OK script closes the response`)
        if (f.name === 'w_set_flatdiscamt') check(Number(returned) === 125, 'Discount returns the original numeric result channel')
        else {
          check(returned instanceof PBStruct && Number(returned.pbGet('i_status')) === 1,
            `${f.name}: the original structure and success status return to the caller`)
          check(Number(returned.pbGet('d_netamt')) === (f.name === 'w_discountcalculator' ? 100 : f.name === 'w_pricecalculator' ? 200 : 18),
            `${f.name}: the recovered OK script returns the calculated rate`)
          check(f.name === 'w_discountcalculator' ? Number(returned.pbGet('d_amt')) === 100 && returned.pbGet('c_paymentmode') === 'F' &&
            Number(returned.pbGet('d_balance')) === 200 : f.name === 'w_pricecalculator' ? Number(returned.pbGet('d_amt')) === 18 :
            Number(returned.pbGet('d_balance')) === 5 && Number(returned.pbGet('d_value')) === 90,
          `${f.name}: the recovered OK script returns the remaining transaction values`)
        }
      } finally {
        if (fixture.ui.views.has(f.window)) { f.click('cb_cancel'); await f.pending }
      }
      const cancelled = await open(surface.name)
      await accept(cancelled, surface.name === 'w_set_flatdiscamt' ? 'discperc' : 'rate', 25)
      cancelled.click('cb_cancel')
      await cancelled.pending
      const returned = cancelled.returned()
      check(surface.name === 'w_set_flatdiscamt' ? Number(returned) === -9999 :
        returned instanceof PBStruct && Number(returned.pbGet('i_status')) === -1 &&
        Number(returned.pbGet('d_netamt')) === Number(cancelled.argument.pbGet('d_netamt')) &&
        returned.pbGet('s_reference') === 'Synthetic reference',
      `${surface.name}: Cancel preserves the original sentinel and caller result contract`)
      if (surface.name === 'w_discountcalculator') {
        check(returned.pbGet('c_paymentmode') === 'B' && Number(returned.pbGet('d_amt')) === 18,
          'Discount Cancel restores the original caller mode and amount')
        const fixed = await open(surface.name, { c_paymentmode: 'F' })
        try {
          check(fixed.model.getItem(1, 'type') === 'F' && fixed.model.describe('type.visible') === '0' &&
            !fixed.dw.root.querySelector('[data-obj=type]'),
          'A fixed-discount caller keeps the original hidden radio field hidden in either presentation')
          check(Number(await fixed.control.n_getitemdecimal(1, 'c_discount')) === 50,
            'The source fixed-discount branch does not require a visible selector')
        } finally { fixed.click('cb_cancel'); await fixed.pending }
      }
    }
  } finally { restore() }
  if (modern) window.openPresentationCalculatorPreview = async (name = 'w_pricecalculator') => {
    activate()
    try {
      const f = await open(name)
      window.presentationCalculatorPreview = { ...f, change, events,
        close: async () => {
          try {
            if (fixture.ui.views.has(f.window)) f.click('cb_cancel')
            await f.pending
          } finally { restore() }
        },
      }
    } catch (error) { restore(); throw error }
  }
}
