import { Runtime, Ref, Frame } from './src/runtime/interp.js'
import { DwCatalog } from './src/dw/def.js'
import { DwModel } from './src/dw/model.js'
import { PBObject } from './src/runtime/object.js'
import { PBArray } from './src/runtime/values.js'
import { NDwBase } from './src/runtime/native/dwctrl.js'
import { entryControls } from './src/ui/modern-entry-window.js'

// Recovered member-editing handlers only: no contact SQL, Save, Retrieve or Print.
export async function checkContactSurfaces(fixture, check, settle) {
  const source = await (await fetch('./presentation-contact.json')).json()
  for (const definition of source.classes) {
    if (fixture.rt.classes.has(definition.name) && definition.name !== 'w_contactgroup') continue
    definition.routines = new Map(Object.entries(definition.routines).map(([owner, routines]) => [owner, new Map(Object.entries(routines))]))
    fixture.rt.classes.set(definition.name, definition)
  }
  const contacts = ['Alpha', 'Bravo', 'Charlie'].map((name, index) => ({
    code: index + 1, contactcardname: index ? 'Repeated contact label' : 'Synthetic contact Alpha',
    acccode: 501 + index, accountname: `Synthetic account ${index + 1}`, title: `Fixture title ${index + 1}`,
    name: `Synthetic ${name}`, address: `Fixture address ${index + 1}`, phone: `TEST-${index + 1}`,
    fax: '', email: `fixture${index + 1}@example.invalid`, mobile: '', useforsms: index ? 'N' : 'Y', web: '',
  }))
  const copied = ['acccode', 'title', 'name', 'address', 'phone', 'fax', 'email', 'mobile', 'useforsms', 'web']
  const oldCatalog = fixture.rt.dwCatalog, oldFire = fixture.rt.fire
  const catalog = new DwCatalog(async () => undefined)
  catalog.get = async (name) => source.data[name] ? structuredClone(source.data[name]) : undefined
  const events = []
  const route = async (target, event, args) => {
    let owner = target
    while (owner && owner.className !== 'w_contactgroup') owner = owner.parent
    if (!owner) return oldFire(target, event, args)
    events.push({ target, event, args })
    return Runtime.prototype.fire.call(fixture.rt, target, event, args)
  }
  const populate = (model, rows) => {
    for (const values of rows) {
      const row = model.insertRow(0)
      for (const [name, value] of Object.entries(values)) model.setItem(row, name, value)
    }
    model.resetUpdate()
  }
  const open = async () => {
    let window
    const ref = new Ref(() => window, (value) => { window = value })
    ref.name = 'w_contactgroup'
    await fixture.rt.sys.get('opensheet').fn(fixture.rt, [ref, fixture.frame], new Frame(null, null, 0))
    const view = fixture.ui.views.get(window)
    const controls = entryControls(window)
    const control = (name) => [...controls.values()].find((control) => control.name === name)
    const element = (name) => view.ctlViews.get(control(name)).el
    const attach = (name, dataName, rows) => {
      const model = new DwModel(fixture.rt, dataName, structuredClone(source.data[dataName]))
      populate(model, rows)
      control(name).attach(model)
      return model
    }
    attach('dw_detail', 'd_contactgroup', [{ code: 1, name: 'Synthetic contact group' }])
    attach('dw_list', 'd_contactgrouplist', [{ code: 1, name: 'Synthetic contact group' }])
    attach('dw_find', 'd_find', [{ find: '' }])
    const detail = control('dw_itemsdetail')
    const model = attach('dw_itemsdetail', 'd_contactgroupdetail', [
      { code: 1, contactcardcode: 1 }, { code: 1, contactcardcode: 3 },
    ])
    const retrievals = [], configuredChildren = new WeakSet()
    const getChild = detail.n_getchild.bind(detail)
    detail.n_getchild = async (...args) => {
      const child = await getChild(...args)
      if (child instanceof NDwBase && !configuredChildren.has(child)) {
        configuredChildren.add(child)
        child.n_retrieve = async () => {
          await child.ready
          if (child.destroyed || child.model?.name !== 'ddd_contactcardlist' || child.model.rowCount() !== 0) {
            throw new Error('Unexpected synthetic contact lookup retrieval')
          }
          retrievals.push(child)
          populate(child.model, contacts)
          child.changed()
          return contacts.length
        }
      }
      return child
    }
    const child = await detail.n_getchild('contactcardcode')
    await child.ready
    populate(child.model, contacts)
    const menu = new PBObject(fixture.rt, 'menu', 'menu')
    const file = new PBObject(fixture.rt, 'menu', 'menu')
    menu.children.set('m_file', file)
    for (const name of ['m_save', 'm_new', 'm_retrieve', 'm_next', 'm_previous']) file.children.set(name, new PBObject(fixture.rt, 'menu', 'menu'))
    for (const [name, value] of Object.entries({
      im_menu: menu, id_master: control('dw_detail'), id_detail: detail, id_list: control('dw_list'),
      id_dwcontrol: control('dw_list'), id_itemslist: control('dw_itemslist'), id_footer: control('dw_footer'),
      idc_contacts: child, il_currrow: 1, ib_itemvalidated: true, i_editmode: 1,
      ii_colindex: 2, ii_type: 1, is_sortsequence: 'A', editflag: false,
    })) window.props.set(name, value)
    for (const [name, values] of [
      ['ddlb_sort', ['Code', 'Name']], ['ddlb_filter_column', ['Code', 'Name']],
      ['ddlb_op', ['=', '<>', '>']], ['ddlb_data', ['Synthetic contact group']],
    ]) {
      const items = new PBArray('string')
      items.a.push(...values)
      control(name).props.set('_items', items)
      await control(name).n_selectitem(name === 'ddlb_sort' || name === 'ddlb_filter_column' ? 2 : 1)
    }
    control('rb_ascending').pbSet('checked', true)
    await fixture.rt.callMethod(window, 'wf_setcontactdetails', [1, 1])
    await fixture.rt.callMethod(window, 'wf_setcontactdetails', [3, 2])
    model.resetUpdate()
    await settle()
    const dw = view.ctlViews.get(detail).dw
    const edit = async (row = 1) => {
      model.row = row
      model.col = model.colIndex('contactcardcode') + 1
      await fixture.ui.focusDw(detail, true)
      await settle()
      if (!(dw.editor instanceof HTMLInputElement) || !dw.editor.readOnly || dw.editor.getAttribute('role') !== 'combobox') {
        throw new Error('Missing readonly contact-card choice editor')
      }
      return dw.editor
    }
    return { window, view, controls, control, element, detail, model, child, dw, edit, retrievals,
      close: () => fixture.rt.closeWindow(window) }
  }
  const modern = fixture.session.activeMode === 'modern'
  const browse = async (f) => {
    const select = await f.edit()
    select.dispatchEvent(new KeyboardEvent('keydown', { key: 'F4', shiftKey: true, bubbles: true, cancelable: true }))
    await settle()
    const dialog = document.querySelector('.presentation-lookup[open]')
    if (!dialog) throw new Error('Missing reviewed contact lookup browser')
    const search = dialog.querySelector('input')
    return { select, dialog, search,
      button: (name) => [...dialog.querySelectorAll('button')].find((button) => button.textContent === name),
      filter: async (value) => { search.value = value; search.dispatchEvent(new Event('input', { bubbles: true })); await settle() } }
  }
  fixture.rt.dwCatalog = catalog
  fixture.rt.fire = route
  try {
    const f = await open()
    try {
      check(f.controls.size === 23 && [...f.view.ctlViews.values()].every((binding) => f.view.client.contains(binding.el)),
        'Contact Group retains all 23 inherited control elements')
      check(f.view.el.classList.contains('modern-entry-window') === modern &&
        !!f.element('dw_itemsdetail').querySelector('.modern-surface') === modern,
      'Contact Group uses the contextual member grid only in Modern')
      check(f.element('dw_footer').getClientRects().length === 0 && f.element('dw_itemslist').getClientRects().length === 0,
        'The contact footer and item-list companion remain hidden')
      if (modern) {
        check(f.element('dw_itemsdetail').querySelectorAll('thead th').length === 11 &&
          !f.element('dw_itemsdetail').querySelector('[data-obj=acccode],[data-obj=code]'),
        'The member grid presents all 11 source objects without exposing hidden keys')
        check(f.element('dw_itemsdetail').querySelector('[data-obj=useforsms]')?.textContent.trim() === 'Yes',
          'A readonly numeric/key-independent code table shows its display label')
      } else {
        check(!f.element('dw_itemsdetail').querySelector('.dw-choice-browse'),
          'Classic does not acquire Modern detailed-lookup controls')
      }
      const select = await f.edit()
      check(f.dw.choiceEdit.options.items.length === 3 && select.value === contacts[0].contactcardname &&
        !f.dw.choiceEdit.popup.open,
        'The editor obtains options from the actual native child DataWindow')
      f.detail.validateRules.set('contactcardcode', 'number(gettext()) <> 2')
      await f.detail.n_settext('2')
      events.length = 0
      check(await f.detail.n_accepttext() === -1 && f.model.getItem(1, 'contactcardcode') === 1 &&
        events.filter((event) => event.target === f.detail && ['itemchanged', 'itemerror'].includes(event.event))
          .map((event) => event.event).join(',') === 'itemerror',
      'A failed choice rule executes the recovered ItemError without firing ItemChanged or replacing the key')
      f.detail.validateRules.delete('contactcardcode')
      check(await f.detail.n_settext('2') === 1 && await f.detail.n_gettext() === '2' &&
        f.model.getItem(1, 'contactcardcode') === 1, 'Native SetText/GetText use the pending contact key, not its duplicate display label')
      select.blur()
      f.detail.changed()
      await settle()
      check(f.dw.editor === select && select.value === 'Repeated contact label' &&
        f.model.getItem(1, 'contactcardcode') === 1 && document.activeElement !== select,
      'Repaint retains the same unaccepted selection without stealing externally moved focus')
      events.length = 0
      check(await f.detail.n_accepttext() === 1 && f.model.getItem(1, 'contactcardcode') === 2 &&
        f.window.props.get('ib_itemvalidated') === false && f.window.props.get('il_currrow') === 1,
      'The actual contact ItemChanged runs before the selected key is stored')
      check(events.filter((event) => event.target === f.detail && event.event === 'itemchanged').length === 1,
        'Contact-key acceptance raises the recovered ItemChanged exactly once')
      await f.dw.tabNext(1)
      await settle()
      check(copied.every((name) => f.model.getItem(1, name) === contacts[1][name]) &&
        f.window.props.get('ib_itemvalidated') === true && f.model.row === 2,
      'Source ItemFocusChanged validates the previous member and copies all ten contact fields, including its hidden account key')
      await f.detail.n_settext('2')
      check(await f.detail.n_accepttext() === 1, 'A second-row selection reaches normal source validation')
      const duplicate = f.dw.tabNext(-1)
      await settle()
      const dialog = document.querySelector('.presentation-runtime-dialog[open],.msgbox')
      check(dialog?.textContent.includes('Duplication Error'), 'The original contact duplicate-member message remains visible')
      const button = dialog?.querySelector('button')
      if (!button) throw new Error('Missing contact duplicate acknowledgement')
      button.click()
      await duplicate
      await settle()
      check(f.model.getItem(2, 'contactcardcode') === null && f.model.row === 2 &&
        f.model.col === f.model.colIndex('contactcardcode') + 1,
      'Duplicate rejection clears only the rejected key and preserves the source-directed row and column')
      await f.edit(2)
      await f.detail.n_settext('3')
      check(await f.detail.n_accepttext() === 1 && await fixture.rt.callMethod(f.window, 'wf_validateitem', []) === 0 &&
        copied.every((name) => f.model.getItem(2, name) === contacts[2][name]),
      'Correcting the duplicate copies the intended member even when two choices have identical display labels')
      check(await fixture.rt.callMethod(f.window, 'wf_setcontactdetails', [999, 2]) === 1,
        'An unknown key preserves the original helper failure result instead of copying an arbitrary contact')
    } finally { await f.close() }
    check([...f.controls.values()].every((control) => !control.listeners?.size),
      'Closing the contact fixture releases its control-view subscriptions')
    check(f.child.destroyed && f.child.listeners.size === 0, 'Closing the parent invalidates its native lookup and releases its repaint callback')

    if (modern) {
      const detailBrowser = await open()
      try {
        const snapshot = JSON.stringify(detailBrowser.child.model.buf)
        const row = detailBrowser.child.model.row, col = detailBrowser.child.model.col
        const b = await browse(detailBrowser)
        check([...b.dialog.querySelectorAll('th')].map((header) => header.textContent).join('|') ===
          'Code|Contactcardname|Title|Contact Name|Address|Phone|Fax|Email|Mobile|Use for SMS|Web',
        'The reviewed lookup preserves all eleven source headers and their exact order')
        check(fixture.ui.dialogs.has(b.dialog) && !fixture.ui.shortcutsEnabled() && !fixture.ui.menuShortcutsEnabled() &&
          fixture.ui.down.size === 0, 'The lookup uses the tracked presenter and blocks parent commands and held keys')
        fixture.ui.applyAppearance()
        await settle()
        check(b.dialog.open && document.activeElement === b.search && detailBrowser.dw.editor === b.select,
          'Appearance repaint preserves the tracked lookup, its search focus and its retained readonly combobox')
        await b.filter('Synthetic account 2')
        check(!b.dialog.querySelector('tbody tr'), 'Hidden account fields are not exposed through lookup search')
        await b.filter('No')
        check(b.dialog.querySelectorAll('tbody tr').length === 2, 'Loaded-row search uses the SMS display label, not just its stored key')
        await b.filter('Fixture address 2')
        check(b.dialog.querySelectorAll('tbody tr').length === 1 && b.dialog.querySelector('tbody tr').dataset.choice === '1' &&
          await detailBrowser.detail.n_gettext() === '1' && detailBrowser.model.getItem(1, 'contactcardcode') === 1,
        'Browsing duplicate labels by address does not change the parent draft or stored key')
        check(await detailBrowser.detail.n_accepttext() === -1, 'Programmatic AcceptText is blocked while the lookup owns focus')
        b.button('Cancel').click()
        await settle()
        check(detailBrowser.dw.editor === b.select && document.activeElement === b.select &&
          detailBrowser.model.getItem(1, 'contactcardcode') === 1,
        'Cancel returns to the same native editor without an invented selection')
        check(JSON.stringify(detailBrowser.child.model.buf) === snapshot && detailBrowser.child.model.row === row &&
          detailBrowser.child.model.col === col, 'Lookup inspection leaves every child buffer and current row/column untouched')

        detailBrowser.detail.validateRules.set('contactcardcode', 'number(gettext()) <> 2')
        const rejected = await browse(detailBrowser)
        await rejected.filter('Fixture address 2')
        rejected.button('Select').click()
        await settle()
        check(!rejected.dialog.isConnected && detailBrowser.dw.editor === rejected.select &&
          rejected.select.getAttribute('aria-invalid') === 'true' &&
          await detailBrowser.detail.n_gettext() === '2' && detailBrowser.model.getItem(1, 'contactcardcode') === 1,
        'A detailed choice closes browsing before source validation and retains a rejected data-key draft')
        detailBrowser.detail.validateRules.delete('contactcardcode')
        fixture.rt.fire = async (target, event, args) => {
          if (target === detailBrowser.detail && event === 'itemchanged') {
            await fixture.ui.messageBox('Synthetic choice validation', 'Continue with this fixture choice?', 'question!', 'ok!', 1)
            return 0
          }
          return route(target, event, args)
        }
        const accepted = await browse(detailBrowser)
        accepted.button('Select').click()
        await settle()
        const validation = document.querySelector('.presentation-runtime-dialog[open]')
        check(!accepted.dialog.isConnected && validation?.textContent.includes('Synthetic choice validation') &&
          fixture.ui.dialogs.size === 1, 'Source validation can open its own tracked dialog after the lookup has released modality')
        validation.querySelector('button').click()
        await settle()
        check(detailBrowser.model.getItem(1, 'contactcardcode') === 2 && fixture.ui.dialogs.size === 0,
          'The selected duplicate-name record reaches the guarded commit exactly once')
      } finally { fixture.rt.fire = route; await detailBrowser.close() }

      for (const change of ['child-details', 'child-destroyed', 'parent-record', 'readonly', 'close']) {
        const owner = await open()
        let closed = false
        try {
          const b = await browse(owner)
          if (change === 'child-details') {
            owner.child.model.setItem(2, 'address', 'Replacement synthetic address')
            owner.child.changed()
          }
          if (change === 'child-destroyed') owner.child.destroy()
          if (change === 'parent-record') {
            owner.model.deleteRow(1)
            owner.model.setItem(owner.model.insertRow(1), 'contactcardcode', 1)
            owner.detail.changed()
          }
          if (change === 'readonly') { owner.model.modify("contactcardcode.protect='1'"); owner.detail.changed() }
          if (change === 'close') { await owner.close(); closed = true }
          await settle()
          check(!b.dialog.isConnected && !fixture.ui.dialogs.size && owner.model.getItem(1, 'contactcardcode') === 1,
            `${change}: an owned lookup closes without applying a value from obsolete context`)
          if (change === 'parent-record' || change === 'readonly') {
            // A retained entry keeps the keyboard.  An unchanged choice whose record went away is closed without a recovery panel, as
            // Classic closes an untouched text field (parent-record); a protected field retains it (readonly).
            const retained = owner.element('dw_itemsdetail').querySelector('.surface-stale input')
            check(retained ? retained.value === '1' && document.activeElement === retained : change === 'parent-record',
              `${change}: picker teardown cannot steal focus from the retained unapplied entry`)
          }
        } finally { if (!closed) await owner.close() }
      }

      const hidden = await open()
      try {
        hidden.child.model.modify("address.visible='0'")
        hidden.child.model.modify("address_t.visible='0'")
        hidden.child.changed()
        const b = await browse(hidden)
        check(b.dialog.querySelectorAll('th').length === 10 && ![...b.dialog.querySelectorAll('th')].some((header) => header.textContent === 'Address'),
          'Static hidden lookup columns are omitted from both the grid and expanded details')
        await b.filter('Fixture address 2')
        check(!b.dialog.querySelector('tbody tr'), 'Hidden-column values cannot be inferred by filtering visible records')
        b.button('Cancel').click()
      } finally { await hidden.close() }

      const fallback = await open()
      try {
        fallback.child.model.modify("address.format='[currency]'")
        fallback.child.changed()
        const select = await fallback.edit()
        check(fallback.dw.choiceEdit.options.items.length === contacts.length && select.readOnly &&
          fallback.element('dw_itemsdetail').querySelector('.dw-choice-browse')?.disabled &&
          fallback.element('dw_itemsdetail').textContent.includes('Detailed choices unavailable'),
        'Unreviewed child formats leave the basic list usable with an explicit detailed-lookup warning')
      } finally { await fallback.close() }
    }

    const failures = []
    const onError = fixture.rt.onError
    fixture.rt.onError = (error) => failures.push(error)
    try {
      const navigation = await open()
      let reject = true
      fixture.rt.fire = async (target, event, args) => {
        if (target === navigation.detail && event === 'itemchanged') return reject ? 1 : 0
        if (target === navigation.detail && event === 'itemerror') return 1
        return route(target, event, args)
      }
      try {
        const select = await navigation.edit()
        await navigation.detail.n_settext('2')
        const clickSecondRow = () => {
          const cell = navigation.element('dw_itemsdetail').querySelector('.row[data-row="2"] [data-obj=contactcardcode]')
          if (!cell) throw new Error('Missing second contact member row')
          cell.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
          cell.click()
        }
        clickSecondRow()
        await settle()
        check(navigation.model.row === 1 && navigation.model.getItem(1, 'contactcardcode') === 1 &&
          navigation.dw.editor === select && await navigation.detail.n_gettext() === '2',
        'Pointer navigation cannot drop a rejected choice or move its draft to the next member')
        reject = false
        clickSecondRow()
        await settle()
        check(navigation.model.getItem(1, 'contactcardcode') === 2 && navigation.model.row === 2 &&
          navigation.dw.editor instanceof HTMLInputElement && navigation.dw.editor.readOnly && navigation.dw.editor !== select,
        'A successful awaited pointer transition opens the destination editor after native GetFocus completes')
      } finally {
        fixture.rt.fire = route
        await navigation.close()
      }
      const replacedDestination = await open()
      let finishDestination
      const destinationGate = new Promise((resolve) => { finishDestination = resolve })
      fixture.rt.fire = async (target, event, args) => {
        if (target === replacedDestination.detail && event === 'itemchanged') { await destinationGate; return 0 }
        return route(target, event, args)
      }
      try {
        await replacedDestination.edit()
        await replacedDestination.detail.n_settext('2')
        const cell = replacedDestination.element('dw_itemsdetail').querySelector('.row[data-row="2"] [data-obj=contactcardcode]')
        if (!cell) throw new Error('Missing destination member')
        const move = replacedDestination.dw.rowClick(replacedDestination.model, 2, new MouseEvent('mousedown'), cell)
        cell.click()
        await settle()
        const editingRow = replacedDestination.model.row
        replacedDestination.model.deleteRow(2)
        const replacement = replacedDestination.model.insertRow(0)
        replacedDestination.model.setItem(replacement, 'contactcardcode', 3)
        replacedDestination.model.row = editingRow
        finishDestination()
        await move
        await settle()
        check(replacedDestination.model.getItem(1, 'contactcardcode') === 2 &&
          replacedDestination.model.getItem(2, 'contactcardcode') === 3 &&
          replacedDestination.model.row === 1 && !replacedDestination.dw.editor,
        'Replacing the destination during acceptance does not redirect the queued pointer edit to another record')
      } finally {
        finishDestination()
        fixture.rt.fire = route
        await replacedDestination.close()
      }
      const retry = await open()
      try {
        let retrieves = 0
        retry.child.n_retrieve = async () => {
          retrieves++
          if (retrieves === 1) throw new Error('Synthetic contact lookup unavailable')
          populate(retry.child.model, contacts)
          retry.child.changed()
          return contacts.length
        }
        retry.child.model.buf.primary = []
        retry.detail.changed()
        await settle()
        const select = await retry.edit()
        check(select.getAttribute('aria-invalid') === 'true' && retrieves === 1 &&
          await retry.detail.n_accepttext() === -1, 'A failed autoretrieve is not retried by every repaint or acceptance attempt')
        retry.detail.changed()
        await settle()
        check(retrieves === 1, 'Repainting a failed native child does not create an automatic retry loop')
        select.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
        await settle()
        check(retrieves === 2 && retry.dw.choiceEdit.options.items.length === contacts.length &&
          retry.model.getItem(1, 'contactcardcode') === 1, 'Explicit retry repopulates the child without replacing the parent key')
      } finally { await retry.close() }
      check(failures.length > 0, 'Lookup load errors reach the runtime error reporter')
      failures.length = 0
      for (const change of ['child-row', 'child-model', 'child-destroyed', 'parent-record', 'configuration', 'readonly',
        ...(modern ? ['child-details', 'child-header', 'child-visibility'] : [])]) {
        const f = await open()
        let release
        const gate = new Promise((resolve) => { release = resolve })
        fixture.rt.fire = async (target, event, args) => {
          if (target === f.detail && event === 'itemchanged') { await gate; return 0 }
          return route(target, event, args)
        }
        try {
          await f.edit()
          await f.detail.n_settext('2')
          const accepting = f.detail.n_accepttext()
          await settle()
          if (change === 'child-row') f.child.model.setItem(2, 'code', 22)
          if (change === 'child-model') {
            const replacement = new DwModel(fixture.rt, 'ddd_contactcardlist', structuredClone(source.data.ddd_contactcardlist))
            populate(replacement, contacts)
            f.child.attach(replacement)
          }
          if (change === 'child-destroyed') f.child.destroy()
          if (change === 'child-details') f.child.model.setItem(2, 'address', 'Changed after selection')
          if (change === 'child-header') f.child.model.def.objects.find((object) => object.name === 'address_t').text = 'Changed header'
          if (change === 'child-visibility') f.child.model.modify("address.visible='0'")
          if (change === 'parent-record') {
            f.model.deleteRow(1)
            const replacement = f.model.insertRow(1)
            f.model.setItem(replacement, 'contactcardcode', 1)
          }
          if (change === 'configuration') f.model.modify("contactcardcode.dddw.displaycolumn='name'")
          if (change === 'readonly') f.model.modify("contactcardcode.protect='1'")
          release()
          check(await accepting === -1 && f.model.getItem(1, 'contactcardcode') === 1,
            `${change}: asynchronous validation cannot write a stale selection into the parent`)
          await settle()
          check(modern ? f.element('dw_itemsdetail').querySelector('.surface-stale input')?.value === '2' :
            f.dw.editor instanceof HTMLInputElement && f.dw.editor.value === contacts[1].contactcardname,
          `${change}: the unapplied selection is retained rather than reported as a successful write`)
          if (!modern && change === 'child-destroyed') check(f.retrievals.length === 1 && f.retrievals[0] !== f.child,
            'Classic redraw may repopulate a replacement child with synthetic rows, but cannot validate the destroyed child selection')
        } finally {
          release()
          fixture.rt.fire = route
          await f.close()
        }
      }
    } finally { fixture.rt.onError = onError }

    if (modern) {
      window.openPresentationContactPreview = async () => {
        fixture.rt.dwCatalog = catalog
        fixture.rt.fire = route
        try {
          const preview = await open()
          window.presentationContactPreview = { ...preview, close: async () => {
            try { await preview.close() } finally { fixture.rt.dwCatalog = oldCatalog; fixture.rt.fire = oldFire }
          } }
          return true
        } catch (error) {
          fixture.rt.dwCatalog = oldCatalog
          fixture.rt.fire = oldFire
          throw error
        }
      }
    }
  } finally {
    fixture.rt.dwCatalog = oldCatalog
    fixture.rt.fire = oldFire
  }
}
