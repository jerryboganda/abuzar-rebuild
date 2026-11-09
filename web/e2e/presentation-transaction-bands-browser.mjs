import { DwCatalog } from './src/dw/def.js'
import { DwModel } from './src/dw/model.js'
import { NDwBase } from './src/runtime/native/dwctrl.js'
import { TRANSACTION_DATA_SURFACES } from './src/ui/data-surfaces.js'
import { applyModernWindow } from './src/ui/modern-window.js'

// Real presentation/validation metadata, synthetic buffers only. No voucher posting.
export async function checkTransactionBands(fixture, check, settle) {
  const definitions = await (await fetch('./presentation-transaction-bands.json')).json()
  const rt = fixture.rt
  const View = fixture.ui.views.get(fixture.sale).ctlViews.get(fixture.sale.children.get('dw_grid')).dw.constructor
  const create = async (name, count = 3) => {
    const old = { catalog: rt.dwCatalog, fire: rt.fire, error: rt.onError }
    const catalog = new DwCatalog(async () => undefined)
    catalog.get = async (name) => {
      if (!definitions[name]) throw new Error(`Unreviewed transaction fixture definition: ${name}`)
      return structuredClone(definitions[name])
    }
    rt.dwCatalog = catalog
    const surface = TRANSACTION_DATA_SURFACES.find((surface) => surface.name === name)
    const model = new DwModel(rt, name, structuredClone(definitions[name]))
    const control = new NDwBase(rt, 'dw_transaction_totals')
    control.props.set('hscrollbar', true)
    control.props.set('vscrollbar', true)
    control.attach(model)
    const quantity = name === 'd_cashiershift_cashdenomination'
    const amount = model.colIndex('qty') >= 0 ? 'qty' : model.colIndex('debit') >= 0 && name.includes('payment') ?
      'debit' : model.colIndex('credit') >= 0 ? 'credit' : 'netamt'
    const seed = (count) => {
      model.reset()
      for (let i = 0; i < count; i++) {
        const row = model.insertRow(0)
        model.setItem(row, amount, count > 3 ? 1 : quantity ? i + 1 : [10.25, 20.5, 3.25][i])
        if (quantity) {
          model.setItem(row, 'name', `Synthetic denomination ${i + 1}`)
          model.setItem(row, 'denomination', count > 3 ? 5 : [5, 10, 20][i])
        } else {
          model.setItem(row, name === 'd_assocadvsaleinvlist' ? 'saleinvcode' : 'invcode', 1000 + i)
          if (model.colIndex('remarks') >= 0) model.setItem(row, 'remarks', `Synthetic entry ${i + 1}`)
        }
        if (model.colIndex('acccode') >= 0) model.setItem(row, 'acccode', 901)
      }
      model.row = count ? 1 : 0
      model.col = model.colIndex(amount) + 1
    }
    seed(count)
    for (const field of surface.fields.filter((field) => field.choice?.kind === 'lookup')) {
      const child = await control.n_getchild(field.object)
      await child.ready
      child.model.reset()
      child.model.insertRow(0)
      child.model.setItem(1, field.choice.dataColumn, quantity ? 1 : 901)
      child.model.setItem(1, field.choice.displayColumn, quantity ? 'Synthetic currency' : 'Synthetic account')
    }
    const events = [], errors = []
    rt.fire = async (target, event, args = []) => {
      if (target !== control) return old.fire(target, event, args)
      events.push({ event, args })
      return event === 'itemerror' ? 1 : 0
    }
    rt.onError = (error) => errors.push(String(error))
    const host = document.createElement('div')
    host.id = 'transaction-band-preview'
    host.style.cssText = 'position:fixed;inset:16px;z-index:2147483000'
    document.body.append(host)
    const view = new View(control, host)
    await view.render()
    await settle()
    let disposed = false
    return {
      model, control, view, host, surface, amount, quantity, events, errors, seed,
      total: () => view.root.querySelector(`[data-obj="${surface.bands[0].fields[0].object}"]`),
      totalNumber: () => Number(view.root.querySelector(`[data-obj="${surface.bands[0].fields[0].object}"]`)?.textContent.replaceAll(',', '')),
      async edit() {
        model.row = 1; model.col = model.colIndex(amount) + 1
        await view.focusCurrent()
        await settle()
        if (!view.editor) throw new Error(`Transaction editor missing: ${name}.${amount}`)
        return view.editor
      },
      dispose() {
        if (disposed) return
        disposed = true
        view.dispose(); control.destroy(); host.remove()
        rt.dwCatalog = old.catalog; rt.fire = old.fire; rt.onError = old.error
      },
    }
  }
  for (const surface of TRANSACTION_DATA_SURFACES) {
    const f = await create(surface.name)
    const modern = fixture.session.activeMode === 'modern'
    const initial = f.quantity ? 85 : 34
    const band = surface.bands[0], field = band.fields[0]
    try {
      check(f.view.root.classList.contains('modern-surface') === modern && f.totalNumber() === initial,
        `${surface.name}: source aggregate and current presentation agree`)
      check(!f.view.root.querySelector('[data-obj=code]'), `${surface.name}: hidden keys remain hidden`)
      if (modern) {
        check(f.total().getAttribute('aria-readonly') === 'true' &&
          f.view.root.querySelector('[role=grid]').getAttribute('aria-rowcount') === '4',
        `${surface.name}: totals are named readonly output, not extra data rows`)
        const column = f.model.col
        f.total().focus()
        f.control.changed()
        await settle()
        check(document.activeElement === f.total() && f.model.col === column && f.model.row === 1,
          `${surface.name}: total focus survives redraw without selecting a fictitious field`)
        await f.control.n_setcolumn(f.amount)
        await settle()
        check(document.activeElement?.dataset.obj === f.amount && document.activeElement.closest('[data-row]')?.dataset.row === '1',
          `${surface.name}: explicit source column selection takes focus back from totals`)
      }
      if (f.amount !== 'netamt') {
        let input = await f.edit()
        input.value = f.quantity ? '4' : '12.75'
        input.dispatchEvent(new InputEvent('input', { bubbles: true }))
        f.control.changed()
        await settle()
        check(f.totalNumber() === initial && f.view.editor?.value === input.value,
          `${surface.name}: an unaccepted draft cannot change totals and survives aggregate redraw`)
        check(await f.control.n_accepttext() === 1, `${surface.name}: edited value passes the shared acceptance path`)
        await settle()
        check(f.totalNumber() === (f.quantity ? 100 : 36.5) && f.events.filter((item) => item.event === 'itemchanged').length === 1,
          `${surface.name}: accepted input recalculates source totals once`)
        input = await f.edit()
        await f.control.n_settext('-1')
        check(await f.control.n_accepttext() === -1 && f.events.filter((item) => item.event === 'itemerror').length === 1 &&
          f.totalNumber() === (f.quantity ? 100 : 36.5),
        `${surface.name}: original negative-value validation retains both record and total`)
        f.view.editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
        await settle()
      }
      f.model.modify(`${field.object}.visible=0`)
      f.control.changed()
      await settle()
      check(!f.total() && f.view.root.querySelector(`[data-obj="${field.labelObject}"],.surface-band dt`),
        `${surface.name}: hiding a compute preserves its independently visible source label`)
      f.model.modify(`${field.object}.visible=1 ${field.labelObject}.text='Synthetic total label'`)
      f.control.changed()
      await settle()
      check(f.total() && f.view.root.textContent.includes('Synthetic total label'),
        `${surface.name}: runtime total visibility and labels update together`)
      f.model.modify(`${field.labelObject}.visible=0`)
      f.control.changed()
      await settle()
      check(f.total() && !f.view.root.textContent.includes('Synthetic total label'),
        `${surface.name}: hiding the label does not conceal the value`)
      if (modern) check(!!f.total().getAttribute('aria-label'), `${surface.name}: an unlabelled visible value retains an accessible name`)
      f.model.modify(`${field.labelObject}.visible=1`)
      const height = f.model.def.bands[band.band].height
      f.model.def.bands[band.band].height = '0'
      f.control.changed()
      await settle()
      check(!f.total(), `${surface.name}: a source zero-height totals band is not rendered`)
      f.model.def.bands[band.band].height = height
      f.seed(3)
      f.model.setFilter(`${f.amount} > ${f.quantity ? '1' : '11'}`)
      await f.model.filter()
      f.control.changed()
      await settle()
      check(f.totalNumber() === (f.quantity ? 80 : 20.5), `${surface.name}: filtered-out records leave the displayed aggregate`)
      f.model.setFilter('')
      await f.model.filter()
      f.control.changed()
      await settle()
      check(f.totalNumber() === initial, `${surface.name}: clearing a filter restores the aggregate`)
      f.seed(3)
      f.model.deleteRow(3)
      f.model.modify(`${field.object}.format='#,##0.0000'`)
      f.control.changed()
      await settle()
      check(f.total()?.textContent === (f.quantity ? '25.0000' : '30.7500'),
        `${surface.name}: deleted rows leave the total and live source precision is preserved`)
      f.model.overrides.delete(`${field.object}.format`)
      f.model.reset()
      f.control.changed()
      await settle()
      check(!!f.total() === (band.band === 'footer'), `${surface.name}: empty data suppresses summary but retains footer`)
      f.seed(1000)
      f.control.changed()
      await settle()
      check(f.totalNumber() === (f.quantity ? 5000 : 1000),
        `${surface.name}: aggregate covers all loaded rows, not only the rendered window`)
      if (modern) {
        check(f.view.root.querySelectorAll('.row[data-row]').length <= 61,
          `${surface.name}: adding a total preserves bounded grid rows`)
        f.total().focus()
        f.view.root.scrollTop = f.view.root.scrollHeight
        await settle()
        await f.control.n_setcolumn(f.amount)
        await settle()
        check(document.activeElement?.dataset.obj === f.amount && document.activeElement.closest('[data-row]')?.dataset.row === '1',
          `${surface.name}: explicit source focus can return from an offscreen summary to the current record`)
        f.model.modify('datawindow.print.preview=yes')
        f.control.changed()
        await settle()
        check(!f.view.root.classList.contains('modern-surface') && !f.view.root.querySelector('.surface-band') &&
          f.view.root.style.scrollPaddingBottom === '' && f.total(),
        `${surface.name}: print preview retains source layout without Modern footer styling`)
        f.model.modify('datawindow.print.preview=no')
        f.control.changed()
        await settle()
        check(f.view.root.classList.contains('modern-surface') && f.total(),
          `${surface.name}: leaving print preview restores the reviewed transaction grid`)
        f.model.def.objects.push({ name: 'unreviewed_total', type: 'compute', band: band.band,
          expression: '1', x: '0', y: '0', width: '100', height: '60' })
        f.control.changed()
        await settle()
        check(!f.view.root.classList.contains('modern-surface') &&
          f.view.root.querySelector('.surface-status').textContent.includes('Unmapped object: unreviewed_total'),
        `${surface.name}: added totals retain Classic instead of disappearing`)
      }
      check(!f.errors.length, `${surface.name}: isolated transaction presentation reports no unexpected error`)
    } finally { f.dispose() }
  }
  if (fixture.session.activeMode === 'modern') {
    const f = await create('d_assocadvsaleinvlist')
    try {
      const client = document.createElement('div')
      const root = document.createElement('section')
      root.append(client)
      // The window's own controls are scoped by their parent, so the stand-in window owns every control.
      const owner = { className: 'w_assocadvsaleinvlist_form', children: new Map() }
      const actions = ['cb_ok', 'cb_cancel'].map((name) => {
        const control = { name, native: 'commandbutton', children: new Map(), parent: owner }
        const el = document.createElement('button')
        el.textContent = name
        return [control, { el }]
      })
      const dataControl = { name: 'dw_viewheader', native: 'datawindow', children: new Map(), parent: owner }
      const modal = {
        w: owner, modal: true, client, el: root,
        ctlViews: new Map([[dataControl, { el: f.host, dw: f.view }], ...actions]),
      }
      check(applyModernWindow(modal) && root.classList.contains('modern-window'),
        'The associated-sale invoice modal uses its reviewed Modern window mapping')
      await settle()
      check(client.querySelector('[data-window-data="dw_viewheader"]')?.contains(f.view.root) &&
        client.querySelectorAll('.window-actions button').length === 2 &&
        f.view.root.querySelector('[data-obj="totalamount"]')?.getAttribute('aria-readonly') === 'true',
      'The picker retains its mapped transaction grid, source totals and original actions')
    } finally { f.dispose() }
  }
  window.openTransactionBandPreview = async (name) => {
    window.transactionBandPreview?.dispose()
    window.transactionBandPreview = await create(name, 120)
  }
}
