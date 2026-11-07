import { Runtime, Ref, Frame } from './src/runtime/interp.js'
import { DwCatalog } from './src/dw/def.js'
import { DwModel } from './src/dw/model.js'
import { PBObject } from './src/runtime/object.js'
import { PBArray } from './src/runtime/values.js'
import { NTransaction, executeStatement, stmtKey } from './src/runtime/native/transaction.js'
import { registerFileFuncs } from './src/runtime/sysfiles.js'
import { entryControls } from './src/ui/modern-entry-window.js'

// Recovered account-copy and Enter handlers with synthetic SQL results; no Save, Retrieve or Print.
export async function checkContactCardSurfaces(fixture, check, settle) {
  const source = await (await fetch('./presentation-contact-card.json')).json()
  for (const definition of source.classes) {
    if (fixture.rt.classes.has(definition.name) && definition.name !== 'w_contactcard_form') continue
    definition.routines = new Map(Object.entries(definition.routines).map(([owner, routines]) => [owner, new Map(Object.entries(routines))]))
    fixture.rt.classes.set(definition.name, definition)
  }
  const rt = fixture.rt
  const oldCatalog = rt.dwCatalog, oldFire = rt.fire, oldSql = rt.sql, oldStatements = rt.sqlStmt
  const keyboardRuntime = new Runtime({ load: async () => undefined })
  registerFileFuncs(keyboardRuntime)
  const keyboardNames = ['handle', 'send']
  const oldKeyboard = new Map(keyboardNames.map((name) => [name, rt.sys.get(name)]))
  const catalog = new DwCatalog(async () => undefined)
  catalog.get = async (name) => source.data[name] ? structuredClone(source.data[name]) : undefined
  const statements = new Map(source.statements.map((statement) => [stmtKey(statement.original), statement]))
  const accountStatement = source.statements.find((statement) => statement.into.length === 1)
  const customerStatement = source.statements.find((statement) => statement.sql.includes('FROM dbo.customer '))
  const supplierStatement = source.statements.find((statement) => statement.sql.includes('FROM dbo.supplier '))
  if (!accountStatement || !customerStatement || !supplierStatement) throw new Error('Missing Contact Card account-copy statements')
  const fields = ['code', 'acccode', 'title', 'name', 'address', 'phone', 'fax', 'email', 'mobile', 'useforsms', 'web']
  const originalAddress = 'Synthetic first line\r\nSecond line\r\nThird line'
  const card = { code: 1, acccode: null, title: 'Mr.', name: 'Synthetic contact', address: originalAddress,
    phone: 'TEST-1', fax: '', email: 'fixture@example.invalid', mobile: '', useforsms: 'N', web: '' }
  const events = []
  let intercept
  const route = (target, event, args = []) => {
    let owner = target
    while (owner && owner.className !== 'w_contactcard_form') owner = owner.parent
    if (!owner) return oldFire(target, event, args)
    events.push({ target, event, args })
    const result = intercept?.(target, event, args)
    return result === undefined ? Runtime.prototype.fire.call(rt, target, event, args) : result
  }
  const activate = () => {
    rt.dwCatalog = catalog
    rt.fire = route
    rt.sql = executeStatement
    rt.sqlStmt = (key) => statements.get(key)
    for (const name of keyboardNames) rt.sys.set(name, keyboardRuntime.sys.get(name))
  }
  const restore = () => {
    rt.dwCatalog = oldCatalog; rt.fire = oldFire; rt.sql = oldSql; rt.sqlStmt = oldStatements
    for (const [name, binding] of oldKeyboard) {
      if (binding) rt.sys.set(name, binding)
      else rt.sys.delete(name)
    }
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
    ref.name = 'w_contactcard_form'
    await rt.sys.get('opensheet').fn(rt, [ref, fixture.frame], new Frame(null, null, 0))
    const view = fixture.ui.views.get(window)
    const controls = entryControls(window)
    const control = (name) => [...controls.values()].find((control) => control.name === name)
    const element = (name) => view.ctlViews.get(control(name)).el
    const attach = (name, dataName, rows) => {
      const model = new DwModel(rt, dataName, structuredClone(source.data[dataName]))
      populate(model, rows)
      control(name).attach(model)
      return model
    }
    const model = attach('dw_detail', 'd_contactcarddetail', [card])
    attach('dw_list', 'd_contactcardlist', [{ ...card, accountname: 'Synthetic account' },
      { ...card, code: 2, title: 'C/O', name: 'Synthetic second contact', useforsms: 'Y' }])
    attach('dw_find', 'd_find', [{ find: '' }])
    const master = control('dw_detail')
    const child = await master.n_getchild('acccode')
    await child.ready
    populate(child.model, [
      { acccode: null, accountname: '<None>' }, { acccode: 501, accountname: 'Synthetic customer' },
      { acccode: 502, accountname: 'Synthetic supplier' },
    ])
    const transaction = new NTransaction(rt, 'transaction')
    const calls = []
    transaction.db = {
      query: async (sql, params) => {
        if (params.length !== 1 || ![501, 502].includes(params[0])) throw new Error('Unexpected Contact Card fixture query parameters')
        const code = params[0]
        calls.push({ sql, code })
        if (sql === accountStatement.sql) return {
          columns: [{ name: 'subcode', type: 'int4' }], rows: [[code === 501 ? 3 : 7]],
        }
        if (sql !== (code === 501 ? customerStatement.sql : supplierStatement.sql)) throw new Error('Unexpected Contact Card fixture query')
        return { columns: ['name', 'address', 'phone', 'fax', 'email'].map((name) => ({ name, type: 'text' })),
          rows: [[`Synthetic ${code === 501 ? 'customer' : 'supplier'}`, `Account ${code}\r\nSecond line`,
            `TEST-${code}`, '', `fixture${code}@example.invalid`]] }
      },
      exec: async () => { throw new Error('The Contact Card fixture forbids database writes') },
      call: async () => { throw new Error('The Contact Card fixture forbids stored procedures') },
      commit: async () => { throw new Error('The Contact Card fixture does not save') },
      rollback: async () => { throw new Error('Unexpected Contact Card fixture rollback') },
      close: async () => {},
    }
    const menu = new PBObject(rt, 'menu', 'menu'), file = new PBObject(rt, 'menu', 'menu')
    menu.children.set('m_file', file)
    for (const name of ['m_save', 'm_new', 'm_retrieve', 'm_next', 'm_previous']) file.children.set(name, new PBObject(rt, 'menu', 'menu'))
    for (const [name, value] of Object.entries({
      im_menu: menu, id_master: master, id_detail: control('dw_itemsdetail'), id_list: control('dw_list'),
      id_dwcontrol: control('dw_list'), id_itemslist: control('dw_itemslist'), id_footer: control('dw_footer'),
      it_transobject: transaction, il_currrow: 1, ib_itemvalidated: true, i_editmode: 1,
      ii_colindex: 4, ii_type: 1, is_sortsequence: 'A', editflag: false,
    })) window.props.set(name, value)
    for (const [name, values] of [
      ['ddlb_sort', ['Code', 'Name']], ['ddlb_filter_column', ['Code', 'Name']],
      ['ddlb_op', ['=', '<>', '>']], ['ddlb_data', ['Synthetic contact']],
    ]) {
      const items = new PBArray('string')
      items.a.push(...values)
      control(name).props.set('_items', items)
      await control(name).n_selectitem(1)
    }
    control('rb_ascending').pbSet('checked', true)
    await settle()
    const dw = view.ctlViews.get(master).dw
    const edit = async (name) => {
      model.row = 1
      model.col = model.colIndex(name) + 1
      await fixture.ui.focusDw(master, true)
      await settle()
      if (!dw.editor) throw new Error(`Missing Contact Card ${name} editor`)
      return dw.editor
    }
    return { window, view, controls, control, element, model, master, child, dw, edit, calls,
      close: () => { window.props.set('editflag', false); return rt.closeWindow(window) } }
  }
  const modern = fixture.session.activeMode === 'modern'
  activate()
  try {
    const f = await open()
    try {
      check(f.controls.size === 24 && [...f.view.ctlViews.values()].every((binding) => f.view.client.contains(binding.el)),
        'Contact Card keeps all 24 inherited and added controls')
      check(f.view.el.classList.contains('modern-entry-window') === modern, 'Contact Card reflows only in Modern')
      check(['dw_itemsdetail', 'dw_itemslist', 'dw_footer', 'dw_print'].every((name) => !f.element(name).getClientRects().length),
        'Hidden detail and print companions stay hidden')
      if (modern) {
        check([...f.element('dw_detail').querySelectorAll('[data-obj]')].map((element) => element.dataset.obj).join('|') === fields.join('|'),
          'All eleven Contact Card fields retain their exact source order')
        check([...f.element('dw_detail').querySelectorAll('.surface-label')].map((label) => label.textContent).join('|') ===
          'Code:|A/c Name:|Title:|Name:|Address:|Phone:|Fax:|Email:|Mobile:|Use for SMS:|Web:',
        'Contact Card preserves source wording, including the account label')
      }
      let editor = await f.edit('title')
      check(editor instanceof HTMLSelectElement && editor.options.length === 8 &&
        [...editor.options].some((option) => option.textContent === 'H/Dr.') && editor.selectedOptions[0].textContent === 'Mr.',
      'Sorted titles contain eight complete source entries, including literal slashes')
      await f.master.n_settext('M/S')
      check(await f.master.n_gettext() === 'M/S' && await f.master.n_accepttext() === 1 && f.model.getItem(1, 'title') === 'M/S',
        'Sorted title selection commits its original key, not its position or escaped spelling')
      editor = await f.edit('useforsms')
      check([...editor.options].map((option) => option.textContent).join('|') === 'No|Yes', 'SMS choices sort labels without swapping N/Y')
      await f.master.n_settext('Y')
      check(await f.master.n_accepttext() === 1 && f.model.getItem(1, 'useforsms') === 'Y', 'Sorted SMS selection uses the Y key')
      editor = await f.edit('address')
      check(editor instanceof HTMLTextAreaElement && editor.value === originalAddress.replace(/\r\n/g, '\n') &&
        await f.master.n_gettext() === originalAddress, 'A real textarea displays multiple lines without changing source CRLF text')
      if (modern) {
        const wasRequired = editor.getAttribute('aria-required')
        f.model.modify('address.edit.required=yes')
        f.master.changed()
        await settle()
        editor = f.dw.editor
        const descriptions = editor.getAttribute('aria-describedby').split(' ').map((id) => document.getElementById(id)?.textContent)
        check(editor.getAttribute('aria-required') === 'true' && !editor.required &&
          editor.parentElement.getAttribute('role') === 'group' && !editor.parentElement.hasAttribute('aria-required') &&
          descriptions.includes('Required') && descriptions.some((text) => text?.includes('Shift+Enter')),
        'Required multiline editors keep their line-entry hint and valid field/group accessibility semantics')
        f.model.overrides.delete('address.edit.required')
        f.master.changed()
        await settle()
        editor = f.dw.editor
        check(editor.getAttribute('aria-required') === wasRequired &&
          editor.getAttribute('aria-describedby').split(' ').every((id) => document.getElementById(id)) &&
          f.model.getItem(1, 'address') === originalAddress,
        'Removing multiline requirement guidance preserves description references and original CRLF data')
      }
      events.length = 0
      check(await f.master.n_accepttext() === 1 && f.model.getItem(1, 'address') === originalAddress &&
        !events.some((event) => event.target === f.master && event.event === 'itemchanged'),
      'Focusing and accepting an unchanged address does not rewrite its line endings')
      editor = await f.edit('address')
      editor.value = 'New first line\nNew second line'
      editor.dispatchEvent(new Event('input', { bubbles: true }))
      await settle()
      editor = f.dw.editor
      editor.setSelectionRange(2, 9, 'backward')
      f.master.changed()
      await settle()
      check(f.dw.editor instanceof HTMLTextAreaElement && f.dw.editor.value === 'New first line\nNew second line' &&
        f.dw.editor.selectionStart === 2 && f.dw.editor.selectionEnd === 9 && f.dw.editor.selectionDirection === 'backward' &&
        await f.master.n_gettext() === 'New first line\r\nNew second line',
      'Multiline redraw retains the draft, selection direction and CRLF GetText')
      const scroller = f.view.client, originalStyle = scroller.style.cssText
      const originalScroll = scroller.scrollTop
      try {
        scroller.style.maxHeight = '40px'
        scroller.style.overflow = 'auto'
        await settle()
        scroller.scrollTop = 0
        check(f.dw.editor.getBoundingClientRect().bottom > scroller.getBoundingClientRect().bottom,
          'A user can scroll the focused multiline draft outside the visible client area')
        f.master.changed()
        await settle()
        check(scroller.scrollTop === 0 && document.activeElement === f.dw.editor &&
          f.dw.editor.selectionStart === 2 && f.dw.editor.selectionEnd === 9,
        'Redraw restores multiline focus and selection without scrolling a user-positioned ancestor')
      } finally {
        scroller.style.cssText = originalStyle
        scroller.scrollTop = originalScroll
        await settle()
      }
      const external = document.createElement('button')
      external.textContent = 'Synthetic external focus'
      document.body.append(external)
      try {
        external.focus()
        f.master.changed()
        await settle()
        check(document.activeElement === external && await f.master.n_gettext() === 'New first line\r\nNew second line' &&
          f.model.getItem(1, 'address') === originalAddress, 'Repaint does not steal external focus or accept an address draft')
      } finally { external.remove() }
      await f.master.n_settext('Script\r\nreplacement')
      check(await f.master.n_gettext() === 'Script\r\nreplacement' && f.model.getItem(1, 'address') === originalAddress,
        'Multiline SetText changes the live draft, not the stored value')
      check(await f.master.n_accepttext() === 1 && f.model.getItem(1, 'address') === 'Script\r\nreplacement',
        'Multiline acceptance uses the shared model-write path')
      editor = await f.edit('address')
      intercept = (target, event, args) => target !== f.master || args[1]?.name !== 'address' ? undefined :
        event === 'itemchanged' ? 1 : event === 'itemerror' ? f.master.n_settext('Corrected\r\naddress').then(() => 1) : undefined
      await f.master.n_settext('Rejected\r\naddress')
      check(await f.master.n_accepttext() === -1 && f.model.getItem(1, 'address') === 'Script\r\nreplacement',
        'Rejected multiline input does not reach the buffer')
      check(await f.master.n_gettext() === 'Corrected\r\naddress' && f.dw.editor?.getAttribute('aria-invalid') === 'true',
        'SetText correction during rejection survives restored multiline editing')
      intercept = undefined
      check(await f.master.n_accepttext() === 1 && f.model.getItem(1, 'address') === 'Corrected\r\naddress',
        'The corrected multiline draft can be accepted')
      f.model.modify("address.edit.case='upper'")
      editor = await f.edit('address')
      events.length = 0
      editor.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
      editor.value = '漢\nmixed'
      editor.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true }))
      f.master.changed()
      await settle()
      check(f.dw.editor === editor && editor.isConnected, 'Repaint defers instead of replacing an active composition editor')
      check(!events.some((event) => event.event === 'editchanged'), 'Composition does not emit an incomplete multiline edit')
      editor.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }))
      editor.dispatchEvent(new InputEvent('input', { bubbles: true }))
      await settle()
      check(await f.master.n_gettext() === '漢\r\nMIXED' &&
        events.filter((event) => event.target === f.master && event.event === 'editchanged').length === 1,
      'Multiline IME completion normalizes case and emits one ordered EditChanged event')
      await f.master.n_accepttext()
      f.model.modify("address.edit.case='any'")
      editor = await f.edit('address')
      await f.master.n_settext('Enter\r\nroute')
      events.length = 0
      editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
      await settle()
      check(f.model.getItem(1, 'address') === 'Enter\r\nroute' && f.model.col === f.model.colIndex('phone') + 1 &&
        events.filter((event) => event.target === f.master && event.event === 'ue_enterkey').length === 1,
      'Enter accepts the multiline draft and invokes the recovered Enter-to-Tab handler exactly once')
      await f.master.n_accepttext()
      for (const code of [501, 502]) {
        await f.edit('acccode')
        await f.master.n_settext(String(code))
        check(await f.master.n_accepttext() === 1 && f.model.getItem(1, 'acccode') === code &&
          f.model.getItem(1, 'name') === `Synthetic ${code === 501 ? 'customer' : 'supplier'}` &&
          f.model.getItem(1, 'address') === `Account ${code}\r\nSecond line` &&
          f.model.getItem(1, 'phone') === `TEST-${code}` && f.model.getItem(1, 'mobile') === `TEST-${code}` &&
          f.model.getItem(1, 'fax') === '' && f.model.getItem(1, 'email') === `fixture${code}@example.invalid` &&
          f.model.getItem(1, 'web') === '' && f.model.getItem(1, 'useforsms') === 'N',
        `Account ${code} executes the recovered query-and-copy routine rather than copying lookup display fields`)
      }
      check(f.calls.map((call) => call.sql).join('|') ===
        [accountStatement.sql, customerStatement.sql, accountStatement.sql, supplierStatement.sql].join('|'),
      'Account selection uses only the four expected in-memory queries in source order')
      editor = await f.edit('acccode')
      check(editor.readOnly && f.dw.choiceEdit.options.items[0].value === null,
        'The readonly account popup preserves the actual null child key, not an empty string or zero')
      f.dw.choiceEdit.popup.button.click()
      await settle()
      f.dw.choiceEdit.popup.list.querySelector('[data-index="0"]').click()
      await settle()
      check(f.model.getItem(1, 'acccode') === null &&
        f.model.getItem(1, 'name') === '' && f.model.getItem(1, 'address') === '' && f.calls.length === 4,
      'The null account follows the recovered clear-fields branch without querying')
      const list = f.view.ctlViews.get(f.control('dw_list')).dw
      f.window.props.set('editflag', false)
      await f.control('tab_retrieve').n_selecttab(2)
      await settle()
      if (modern) check([...f.element('dw_list').querySelectorAll('thead th')].map((head) => head.textContent).join('|') ===
        'Code|Account Name|Title|Name|Address|Phone|Fax|Email|Mobile|Use for SMS|Web',
      'Contact Card list retains all eleven source headings without exposing its hidden account key')
      for (const cell of f.element('dw_list').querySelectorAll('.o[data-obj]')) cell.click()
      await settle()
      check(!list.editor, 'Readonly contact list cells cannot open an editor')
    } finally { intercept = undefined; await f.close() }
    check(f.child.destroyed && [...f.controls.values()].every((control) => !control.listeners?.size),
      'Closing Contact Card releases child ownership and view subscriptions')

    const sorted = await open()
    try {
      sorted.model.overrides.set('title.values', 'Zulu\tz/alpha\ta/ALPHA\tb/Alpha\tc/')
      const editor = await sorted.edit('title')
      check([...editor.options].filter((option) => option.value !== '').map((option) => option.textContent).join('|') ===
        'alpha|ALPHA|Alpha|Zulu', 'Sorted duplicate labels retain stable source identity')
      await sorted.master.n_settext('b')
      check(editor.selectedOptions[0].textContent === 'ALPHA' && await sorted.master.n_accepttext() === 1 &&
        sorted.model.getItem(1, 'title') === 'b', 'A duplicate sorted label commits its own original data key')
    } finally { await sorted.close() }

    {
      const onError = rt.onError, errors = []
      rt.onError = (error) => errors.push(error)
      try {
        for (const change of ['multiline-style', 'readonly', 'displayonly', 'record', ...(modern ? ['sort-order'] : [])]) {
          const f = await open()
          let release
          const gate = new Promise((resolve) => { release = resolve })
          const field = change === 'sort-order' ? 'title' : 'address'
          intercept = (target, event) => target === f.master && event === 'itemchanged' ? gate.then(() => 0) : undefined
          try {
            await f.edit(field)
            const value = field === 'title' ? 'M/S' : 'Pending\r\naddress'
            await f.master.n_settext(value)
            const accepting = f.master.n_accepttext()
            await settle()
            if (change === 'multiline-style') f.model.modify("address.edit.autovscroll='no'")
            if (change === 'readonly') f.model.modify("address.protect='1'")
            if (change === 'displayonly') f.model.modify("address.edit.displayonly='yes'")
            if (change === 'sort-order') f.model.modify("title.ddlb.sorted='no'")
            if (change === 'record') {
              f.model.deleteRow(1)
              populate(f.model, [card])
            }
            release()
            check(await accepting === -1 && f.model.getItem(1, field) === card[field],
              `${change}: pending Contact Card validation cannot overwrite a changed owner or field`)
            await settle()
            check(f.element('dw_detail').querySelector('.surface-stale textarea,.surface-stale input,.dw-recovery textarea')?.value.replace(/\r\n/g, '\n') === value.replace(/\r\n/g, '\n'),
              `${change}: the rejected Contact Card draft remains available to copy`)
            check(await f.master.n_accepttext() === -1, `${change}: recovery does not silently accept a detached draft`)
            f.element('dw_detail').querySelector('.surface-stale button,.dw-recovery button').click()
            await settle()
            check(await f.master.n_gettext() !== value && f.model.getItem(1, field) === card[field],
              `${change}: explicit discard releases the stale text binding without changing the buffer`)
          } finally { release(); intercept = undefined; await f.close() }
        }
        check(errors.length > 0, 'Rejected asynchronous Contact Card operations report their errors')
      } finally { rt.onError = onError }
    }
    if (modern) {
      window.openPresentationContactCardPreview = async () => {
        activate()
        try {
          const preview = await open()
          window.presentationContactCardPreview = { ...preview, close: async () => {
            try { await preview.close() } finally { restore() }
          } }
        } catch (error) { restore(); throw error }
      }
    }
  } finally { restore() }
}
