import { Runtime, Ref, Frame } from './src/runtime/interp.js'
import { DwModel } from './src/dw/model.js'
import { PBObject } from './src/runtime/object.js'
import { PBArray, PBDate, PBDateTime, PBTime } from './src/runtime/values.js'
import { entryControls } from './src/ui/modern-entry-window.js'

// `surface` is an entry window (its first Detail form) or a single DataWindow binding.
const displayFieldOf = (surface, definition) => {
  const fields = (surface.details ? surface.details[0].surface : surface).fields
  const isText = (field) => {
    const column = definition.table.columns.find((item) => item.name.toLowerCase() === field.object.toLowerCase())
    return !!column && /^(char|varchar|text)/i.test(column.type)
  }
  return fields.find((field) => field.object === 'name') ??
    fields.find((field) => field.object !== 'code' && field.kind !== 'computed' && !field.multiline && !field.choice && isText(field)) ??
    fields.find((field) => field.kind !== 'computed' && !field.choice) ??
    fields[0]
}

// Real inherited UI routines, synthetic rows; no per-window save/retrieve/print execution.
export async function checkSingleEntrySurfaces(fixture, check, settle, filter) {
  const source = await (await fetch('./presentation-single-entry.json')).json()
  const surfaces = filter ? source.surfaces.filter((surface) => filter.includes(surface.name)) : source.surfaces
  const names = new Set(surfaces.map((surface) => surface.name))
  // the definitions this check runs on; the browser preview registers them again, as later checks may replace an ancestor
  const registered = []
  for (const definition of source.classes) {
    if (fixture.rt.classes.has(definition.name) && !names.has(definition.name) && definition.name !== 'w_single_entry') continue
    definition.routines = new Map(Object.entries(definition.routines).map(([owner, routines]) => [owner, new Map(Object.entries(routines))]))
    fixture.rt.classes.set(definition.name, definition)
    registered.push(definition)
  }
  const oldFire = fixture.rt.fire
  const events = []
  const route = async (target, event, args) => {
    let owner = target
    while (owner && !names.has(owner.className)) owner = owner.parent
    if (!owner) return oldFire(target, event, args)
    events.push({ target, event, args })
    return Runtime.prototype.fire.call(fixture.rt, target, event, args)
  }
  // A synthetic string must fit the recovered column width and edit limit (char(14) and a limit of 6 reject 17 characters), as a real entry would.
  const fitted = (text, definition, column) => {
    const type = definition?.table?.columns?.find((item) => item.name === column)?.type ?? ''
    const width = Number(/\((\d+)\)/.exec(type)?.[1])
    const limit = Number(definition?.objects?.find((item) => item.name === column)?.['edit.limit'])
    const widths = [width, limit].filter((value) => value > 0)
    return widths.length ? text.slice(0, Math.min(...widths)) : text
  }
  const open = async (name) => {
    const surface = source.surfaces.find((surface) => surface.name === name)
    if (!surface) throw new Error(`Unmapped single-entry fixture ${name}`)
    let window
    const ref = new Ref(() => window, (value) => { window = value })
    ref.name = name
    await fixture.rt.sys.get('opensheet').fn(fixture.rt, [ref, fixture.frame], new Frame(null, null, 0))
    const view = fixture.ui.views.get(window)
    const controls = entryControls(window)
    const control = (name) => [...controls.values()].find((control) => control.name === name)
    const element = (name) => {
      const root = view.ctlViews.get(control(name)).el
      return root.classList.contains('pb-dropdown') ? root.querySelector('select:not([hidden]),input:not([hidden])') : root
    }
    const attach = (controlName, dataName, rows, binding) => {
      const model = new DwModel(fixture.rt, dataName, structuredClone(source.data[dataName]))
      for (const values of rows) {
        const row = model.insertRow(0)
        for (const [column, value] of Object.entries(values)) model.setItem(row, column, value)
        for (const field of binding?.fields ?? []) {
          if (field.kind === 'computed' || field.kind === 'image' || Object.hasOwn(values, field.object)) continue
          const kind = model.kinds[model.colIndex(field.object)]
          if (field.choice?.kind === 'checkbox') model.setItem(row, field.object, field.choice.off)
          else if (kind === 'string') model.setItem(row, field.object, field.multiline ? 'First line\r\nSecond line' : fitted('Synthetic details', source.data[dataName], field.object))
          else if (kind === 'number' || kind === 'decimal') model.setItem(row, field.object, '2.25')
          else if (kind === 'date') model.setItem(row, field.object, PBDate.ymd(2024, 1, 1))
          else if (kind === 'datetime') model.setItem(row, field.object, new PBDateTime(PBDate.ymd(2024, 1, 1).n, PBTime.hms(0, 0, 0).ms))
          else if (kind === 'time') model.setItem(row, field.object, PBTime.hms(0, 0, 0))
          else throw new Error(`Add a synthetic value for ${dataName}.${field.object} (${kind})`)
        }
      }
      model.resetUpdate()
      control(controlName).attach(model)
      return model
    }
    const extra = name === 'w_checklistitem_form' ? { autocheck: 'N' } :
      name === 'w_shift_form' ? { description: 'Evening shift' } : name === 'w_taxcategory_form' ? { taxperc: '17.5' } : {}
    const displayField = displayFieldOf(surface, source.data[surface.details[0].surface.name])
    const detail = attach('dw_detail', surface.details[0].surface.name,
      [{ code: 1, name: 'Stored Mixed', ...(displayField.object === 'code' ? {} : { [displayField.object]: 'Stored Mixed' }), ...extra }], surface.details[0].surface)
    const listDisplay = displayFieldOf(surface.list, source.data[surface.list.name])
    const list = attach('dw_list', surface.list.name, ['ALPHA', 'BRAVO', 'CHARLIE'].map((label, index) => ({
      code: index + 1, name: label, ...(listDisplay.object === 'code' ? {} : { [listDisplay.object]: label }),
      ...(name === 'w_checklistitem_form' ? { autocheck: ['N', 'Y', null][index] } :
        name === 'w_taxcategory_form' ? { taxperc: '17.5' } : {}),
    })), surface.list)
    attach('dw_find', 'd_find', [{ find: '' }])
    for (const [name, values] of [
      ['ddlb_sort', ['Code', 'Name']], ['ddlb_filter_column', ['Code', 'Name']],
      ['ddlb_op', ['=', '<>', '>']], ['ddlb_data', ['ALPHA', 'BRAVO', 'CHARLIE']],
    ]) {
      const items = new PBArray('string')
      items.a.push(...values)
      control(name).props.set('_items', items)
      await control(name).n_selectitem(name === 'ddlb_sort' || name === 'ddlb_filter_column' ? 2 : 1)
    }
    control('rb_ascending').pbSet('checked', true)
    const menu = new PBObject(fixture.rt, 'menu', 'menu')
    const file = new PBObject(fixture.rt, 'menu', 'menu')
    menu.children.set('m_file', file)
    for (const name of ['m_save', 'm_new', 'm_retrieve', 'm_next', 'm_previous']) file.children.set(name, new PBObject(fixture.rt, 'menu', 'menu'))
    file.children.get('m_save').props.set('enabled', false)
    for (const [name, value] of Object.entries({
      im_menu: menu, id_detail: control('dw_detail'), id_list: control('dw_list'), id_dwcontrol: control('dw_list'),
      id_print: control('dw_print'), id_listprint: control('dw_listprint'),
      ii_colindex: list.colIndex('name') + 1, ii_type: 1, is_sortsequence: 'A', editflag: false, i_editmode: 1,
    })) window.props.set(name, value)
    await settle()
    return { window, view, controls, control, element, detail, list, surface, save: file.children.get('m_save'),
      close: () => fixture.rt.closeWindow(window) }
  }
  const modern = fixture.session.activeMode === 'modern'
  fixture.rt.fire = route
  // A modal Validation Error that a step did not expect would block every later step: record it as a named failure with the
  // step's location and dismiss it, so the pass continues instead of stalling.
  let activeSurface = ''
  const reported = new Set()
  const dialogWatcher = setInterval(() => {
    if (!window.singleEntryStep) return // only inside the additional-field loop; other steps expect their own dialogs
    for (const box of document.querySelectorAll('.presentation-runtime-dialog[open], dialog[open], .msgbox')) {
      if (!/Validation/.test(box.textContent) || reported.has(box)) continue
      reported.add(box)
      check(false, `${activeSurface}/${modern ? 'Modern' : 'Classic'}: unexpected modal dialog (${box.textContent.replace(/\s+/g, ' ').trim()}); focus ${document.activeElement?.outerHTML?.slice(0, 80)}; step ${window.singleEntryStep ?? ''}; ${window.singleEntryInfo ?? ''}`)
      box.querySelector('button')?.click()
    }
  }, 40)
  try {
    for (const surface of surfaces) {
      activeSurface = surface.name
      const f = await open(surface.name)
      const assert = (condition, message) => check(condition, `${surface.name}/${modern ? 'Modern' : 'Classic'}: ${message}`)
      try {
        assert(f.controls.size === 22 && [...f.view.ctlViews.values()].every((binding) => f.view.client.contains(binding.el)),
          'all inherited control elements remain attached')
        assert(f.view.el.classList.contains('modern-entry-window') === modern, 'the outer layout changes only in Modern')
        assert(f.element('dw_detail').querySelectorAll('.modern-surface').length === (modern ? 1 : 0) &&
          f.element('dw_list').querySelectorAll('.modern-surface').length === (modern ? 1 : 0), 'form/list mappings are active only in Modern')
        assert(['dw_print', 'dw_listprint'].every((name) => f.element(name).getClientRects().length === 0),
          'both hidden print companions retain their original visibility')
        if (surface.name === 'w_checklistitem_form') await checkCheckbox(f, fixture, events, assert, settle)
        const detail = f.control('dw_detail')
        const editor = f.view.ctlViews.get(detail).dw
        const displayField = displayFieldOf(surface, f.detail.def)
        const displayName = displayField.object
        // Text-entry checks need a plain text editor.  A master whose first field is a dropdown or masked entry has other editors,
        // covered by the dropdown and mask checks, so it is counted as skipped instead of being forced through a text path.
        const displayObject = f.detail.def.objects.find((object) => object.name === displayName)
        const plainText = !!displayObject && f.detail.kinds[f.detail.colIndex(displayName)] === 'string' && Object.keys(displayObject).some((key) => key.startsWith('edit.')) &&
          !Object.keys(displayObject).some((key) => /^(dddw|ddlb|editmask|checkbox|radiobutton)\./.test(key)) &&
          displayObject.tabsequence !== '0' && displayObject.protect !== '1' && !String(displayObject.protect ?? '').includes('\t') && displayObject['edit.displayonly'] !== 'yes' && displayObject['edit.codetable'] !== 'yes' &&
          displayObject.visible !== '0' && String(displayObject.visible ?? '').split('	')[1] !== '0'
        if (!plainText) (window.singleEntrySkippedText ??= []).push(`${surface.name}/${modern ? 'Modern' : 'Classic'}`)
        textSection: {
        if (!plainText) break textSection
        f.detail.row = 1
        f.detail.col = f.detail.colIndex(displayName) + 1
        await fixture.ui.focusDw(detail, true)
        await settle()
        assert(editor.editor && f.detail.getItem(1, displayName) === 'Stored Mixed', 'focusing does not rewrite stored case')
        const nameObject = f.detail.def.objects.find((object) => object.name === displayName)
        const casing = nameObject['edit.case']
        assert(nameObject['edit.autoselect'] === 'no' ?
          editor.editor.selectionStart === editor.editor.selectionEnd :
          editor.editor.selectionStart === 0 && editor.editor.selectionEnd === editor.editor.value.length,
        'initial text selection follows the recovered AutoSelect setting')
        const expected = casing === 'upper' ? 'MIXED DRAFT' : casing === 'lower' ? 'mixed draft' : 'Mixed draft'
        events.length = 0
        editor.editor.value = 'Mixed draft'
        editor.editor.setSelectionRange(3, 3)
        editor.editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertFromPaste' }))
        await settle()
        const edited = events.filter((event) => event.target === detail && event.event === 'editchanged')
        assert(editor.editor.value === expected && editor.editor.selectionStart === 3 && await detail.n_gettext() === expected,
          'paste obeys source case and preserves the caret and live GetText')
        assert(edited.length === 1 && edited[0].args[2] === expected && f.window.props.get('editflag') && f.save.props.get('enabled'),
          'the inherited EditChanged enables Save once with the converted text')
        assert(f.detail.getItem(1, displayName) === 'Stored Mixed', 'typing is still an unaccepted draft')
        assert(await editor.acceptPendingEdit() && f.detail.getItem(1, displayName) === expected, 'AcceptText uses the shared validation path')
        const tabs = [...f.element('tab_retrieve').querySelectorAll(':scope > .strip > .t')]
        tabs[1].click()
        await settle()
        const dialog = document.querySelector('.presentation-runtime-dialog[open],.msgbox')
        assert(dialog?.textContent.includes('Confirm Changes'), 'List navigation runs the actual unsaved-change guard')
        const cancel = [...(dialog?.querySelectorAll('button') ?? [])].find((button) => button.textContent.trim() === 'Cancel')
        if (!cancel) throw new Error(`Missing ${surface.name} Cancel action`)
        cancel.click()
        await settle()
        assert(f.control('tab_retrieve').props.get('selectedtab') === 1 && f.detail.getItem(1, displayName) === expected,
          'Cancel keeps the Detail page and its edit')
        f.window.props.set('editflag', false)
        tabs[1].click()
        await settle()
        assert(f.control('tab_retrieve').props.get('selectedtab') === 2, 'an unedited form can navigate to List')
        if (modern) {
          assert(f.view.el.querySelectorAll('.entry-criteria-group[role=group]').length === 2, 'criteria keep named semantic groups')
          assert(f.element('dw_find').querySelector('[data-obj=find]')?.getAttribute('aria-labelledby') === f.element('st_find').id,
            'Find is named by the retained source label')
          for (const [controlName, binding] of [['dw_detail', surface.details[0].surface], ['dw_list', surface.list]]) {
            const labels = [...f.element(controlName).querySelectorAll('.surface-label,th')].map((node) => node.textContent.trim())
            for (const field of binding.fields) {
              // A field without a caption object (computed or label-less) has no source wording to compare.
              const captionText = field.labelObject ? source.data[binding.name].objects.find((object) => object.name === field.labelObject)?.text : undefined
              if (typeof captionText !== 'string') continue
              // A field the definition hides (visible="0", revealed only by a script) is not shown in Classic or Modern.
              if (source.data[binding.name].objects.find((object) => object.name === field.object)?.visible === '0') continue
              const text = captionText.replace(/&&|&/g, (token) => token === '&&' ? '&' : '').trim()
              assert(labels.includes(text), `mapped labels retain the original field wording (${binding.name}.${field.object}: ${JSON.stringify(text)} in ${JSON.stringify(labels)})`)
            }
          }
          if (surface.name === 'w_checklistitem_form') {
            const cells = [...f.element('dw_list').querySelectorAll('[data-obj=autocheck]')]
            assert(cells.length === 3 && cells.every((cell) => cell.getAttribute('role') === 'gridcell') &&
              cells.map((cell) => cell.querySelector('[role=checkbox]')?.getAttribute('aria-checked')).join(',') === 'false,true,mixed' &&
              cells.every((cell) => cell.querySelector('[role=checkbox]')?.getAttribute('aria-readonly') === 'true'),
            'readonly list checkboxes keep grid-cell semantics and distinguish checked, unchecked and unknown')
          }
          // Only row-number computes (getrow()) are expected to read 1,2,3; other computed fields have their own expressions.
          for (const field of surface.list.fields.filter((field) => field.kind === 'computed' &&
            /^\s*getrow\(\)\s*$/i.test(source.data[surface.list.name].objects.find((object) => object.name === field.object)?.expression ?? ''))) {
            const cells = [...f.element('dw_list').querySelectorAll(`[data-obj=${field.object}]`)]
            assert(cells.map((cell) => cell.textContent.trim()).join(',') === '1,2,3' &&
              cells.every((cell) => cell.getAttribute('aria-readonly') === 'true'), 'source S No. remains computed and readonly')
          }
        }
        if (surface.name === 'w_checklistitem_form') {
          const cell = f.element('dw_list').querySelector('[data-obj=autocheck]')
          events.length = 0
          cell.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
          cell.click()
          cell.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }))
          await settle()
          assert(f.list.getItem(1, 'autocheck') === 'N' &&
            !events.some((event) => event.target === f.control('dw_list') && event.event === 'itemchanged'),
          'pointer and Space cannot modify a readonly list checkbox')
        }
        for (const field of surface.details[0].surface.fields.filter((field) =>
          !['code', displayName].includes(field.object) && field.kind !== 'computed' && field.kind !== 'image' && !field.choice && !['date', 'datetime', 'time'].includes(f.detail.kinds[f.detail.colIndex(field.object)]) &&
          (() => {
            const source = f.detail.def.objects.find((object) => object.name === field.object)
            // A field whose visibility expression is the constant 0 (visible="1~t0") is never shown, so it has no editor.
            // A protect expression (for example by gender) makes the field read-only for the synthetic row.
            return source && source.visible !== '0' && String(source.visible ?? '').split('\t')[1] !== '0' && source.tabsequence !== '0' && source.protect !== '1' &&
              !String(source.protect ?? '').includes('\t') &&
              source['edit.readonly'] !== 'yes' && source['editmask.readonly'] !== 'yes'
          })())) {
          window.singleEntryStep = `${field.object}: selecting the Detail tab`
          tabs[0].click()
          await settle()
          const column = f.detail.colIndex(field.object)
          f.detail.col = column + 1
          window.singleEntryStep = `${field.object}: focusing the field`
          await fixture.ui.focusDw(detail, true)
          await settle()
          window.singleEntryStep = `${field.object}: draft and accept`
          const stored = String(f.detail.getItem(1, field.object))
          const sourceField = f.detail.def.objects.find((object) => object.name === field.object)
          const mask = sourceField?.['editmask.mask']
          const draft = mask ? (/[#0]/.test(mask) ? '14' : 'AB') :
            f.detail.kinds[column] === 'string' ?
              (field.multiline ? (fitted('Updated first line\r\nSecond <literal>', f.detail.def, field.object) === 'Updated first line\r\nSecond <literal>' ?
                'Updated first line\r\nSecond <literal>' : fitted('A\r\nB', f.detail.def, field.object)) : fitted('<literal>', f.detail.def, field.object)) :
              /^(long|ulong|int|integer|short|smallint|tinyint|bigint)\b/i.test(f.detail.def.table.columns[column].type) ? '3' : '3.5'
          assert(!!editor.editor && (editor.editor instanceof HTMLTextAreaElement) === !!field.multiline,
            `${field.object}: the real source field opens the declared single-line or multiline editor`)
          await detail.n_settext(draft)
          const expected = await detail.n_gettext()
          assert(String(f.detail.getItem(1, field.object)) === stored && expected !== stored,
            `${field.object}: SetText updates only the live draft`)
          if (field.multiline) assert(editor.editor.value === expected.replace(/\r\n/g, '\n') && expected.includes('\r\n') && expected.toLowerCase() === draft.toLowerCase(),
            `textarea DOM uses LF while live PowerScript text retains CRLF (${JSON.stringify({ field: field.object, draft, dom: editor.editor.value, expected, limit: sourceField?.['edit.limit'], type: f.detail.def.table.columns[column].type })})`)
          window.singleEntryInfo = JSON.stringify({ draft, expected, stored, kind: f.detail.kinds[column], editLimit: sourceField?.['edit.limit'],
            columnType: f.detail.def.table.columns[column].type, case: sourceField?.['edit.case'], validation: f.detail.def.table.columns[column].validation ?? null })
          // A rejected entry opens a modal Validation Error; report it with the evidence and dismiss it so the pass continues.
          let rejection
          const watcher = setInterval(() => {
            const box = [...document.querySelectorAll('.presentation-runtime-dialog[open]')].find((item) => item.textContent.includes('Validation Error'))
            if (box && !rejection) {
              rejection = box.textContent.replace(/\s+/g, ' ').trim()
              box.querySelector('button')?.click()
            }
          }, 40)
          let accepted
          try { accepted = await detail.n_accepttext() } finally { clearInterval(watcher) }
          if (rejection) assert(false, `${field.object}: the synthetic draft was rejected (${JSON.stringify({ draft, expected, stored, kind: f.detail.kinds[column],
            editLimit: sourceField?.['edit.limit'], columnType: f.detail.def.table.columns[column].type, dialog: rejection })})`)
          assert(accepted === 1 && String(f.detail.getItem(1, field.object)) === expected,
            `${field.object}: the additional real field uses the shared text/decimal acceptance path (${JSON.stringify({ accepted, draft, expected, stored: String(f.detail.getItem(1, field.object)), kind: f.detail.kinds[column], type: f.detail.def.table.columns[column].type, limit: sourceField?.['edit.limit'], validation: f.detail.def.table.columns[column].validation ?? null })})`)
          window.singleEntryStep = ''
          if (surface.name === 'w_goodscompany_form' && field.object === 'phone') {
            assert(f.detail.def.table.columns[column].type === 'char(15)',
              'Phone retains its original 15-character storage limit')
            await fixture.ui.focusDw(detail, true)
            await settle()
            const fire = fixture.rt.fire
            let itemErrors = 0
            fixture.rt.fire = async (target, event, args) => {
              if (target === detail && event === 'itemerror') { itemErrors++; return 1 }
              return fire(target, event, args)
            }
            try {
              await detail.n_settext('1234567890123456')
              assert(await detail.n_accepttext() === -1 && itemErrors === 1 &&
                f.detail.getItem(1, field.object) === expected &&
                await detail.n_gettext() === '1234567890123456' &&
                editor.editor?.getAttribute('aria-invalid') === 'true',
              'Phone rejects an overlong draft without replacing its stored value')
              await detail.n_settext('123456789012345')
              assert(await detail.n_accepttext() === 1 &&
                f.detail.getItem(1, field.object) === '123456789012345' &&
                editor.editor?.getAttribute('aria-invalid') !== 'true',
              'Phone accepts its exact storage boundary and clears the invalid state')
            } finally {
              fixture.rt.fire = fire
            }
          }
          f.window.props.set('editflag', false)
        }
        }
        if (surface.name === 'w_resourcecategory_form') await checkMultilineMaster(f, fixture, assert, settle)
        if (surface.name === 'w_grade_form' && modern) await checkDecimalMaster(f, fixture, assert, settle)
        if (surface.name === 'w_manufacturertype_form') await checkInteractions(f, fixture, events, assert, settle)
      } finally {
        await f.close()
      }
      assert([...f.controls.values()].every((control) => !control.listeners?.size), 'closing releases all control subscriptions')
    }
    await checkCheckboxGuards(open, fixture, route, check, settle)
    if (modern) {
      const name = 'w_manufacturertype_form'
      const definition = fixture.rt.classes.get(name)
      fixture.rt.classes.set(name, { ...definition, controls: [...definition.controls, { name: 'unmapped_field', ancestor: 'singlelineedit', fields: [], controls: [] }] })
      try {
        const fallback = await open(name)
        check(!fallback.view.el.classList.contains('modern-entry-window') &&
          !fallback.element('dw_detail').querySelector('.modern-surface') &&
          !fallback.element('dw_list').querySelector('.modern-surface') &&
          !fallback.element('dw_find').querySelector('.modern-surface'), 'A changed single-entry tree retains the complete compatibility presentation')
        await fallback.close()
      } finally {
        fixture.rt.classes.set(name, definition)
      }
      window.openPresentationSingleEntryPreview = async (name = 'w_message_form') => {
        // the generated-window checks that ran since register their own w_single_entry: use the definitions checked here
        for (const definition of registered) fixture.rt.classes.set(definition.name, definition)
        fixture.rt.fire = route
        try {
          events.length = 0
          const preview = await open(name)
          window.presentationSingleEntryPreview = { ...preview, events, close: async () => {
            try { await preview.close() } finally { fixture.rt.fire = oldFire }
          } }
          return true
        } catch (error) {
          fixture.rt.fire = oldFire
          throw error
        }
      }
    }
  } finally {
    window.singleEntryStep = ''
    clearInterval(dialogWatcher)
    fixture.rt.fire = oldFire
  }
}

async function checkMultilineMaster(f, fixture, check, settle) {
  const control = f.control('dw_detail'), view = f.view.ctlViews.get(control).dw
  const stored = f.detail.getItem(1, 'description')
  const route = fixture.rt.fire
  try {
    f.detail.col = f.detail.colIndex('description') + 1
    await fixture.ui.focusDw(control, true)
    await settle()
    let input = view.editor
    check(input instanceof HTMLTextAreaElement, 'Resource Category opens its recovered multiline Description')
    await control.n_settext('Rejected first line\r\nSecond <literal>')
    fixture.rt.fire = async (target, event, args) => {
      if (target === control && event === 'itemchanged' && args[1].name === 'description') {
        await route(target, event, args)
        return 1
      }
      if (target === control && event === 'itemerror') return 1
      return route(target, event, args)
    }
    const accepted = await control.n_accepttext()
    input = view.editor
    check(accepted === -1 && f.detail.getItem(1, 'description') === stored &&
      input?.getAttribute('aria-invalid') === 'true', 'rejected multiline input cannot replace stored Description')
    control.changed()
    await settle()
    input = view.editor
    check(input instanceof HTMLTextAreaElement && input.value === 'Rejected first line\nSecond <literal>' &&
      input.getAttribute('aria-invalid') === 'true' &&
      await control.n_gettext() === 'Rejected first line\r\nSecond <literal>',
    'repaint retains a rejected textarea, its literal text and CRLF GetText')
    const enter = new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true, cancelable: true })
    input.dispatchEvent(enter)
    check(!enter.defaultPrevented, 'Shift+Enter adds a line without accepting the rejected draft')
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    await settle()
    check(!view.editor && f.detail.getItem(1, 'description') === stored, 'Escape discards the multiline draft without changing the record')
  } finally {
    fixture.rt.fire = route
    f.window.props.set('editflag', false)
  }
}

async function checkDecimalMaster(f, fixture, check, settle) {
  const control = f.control('dw_detail'), view = f.view.ctlViews.get(control).dw
  const stored = String(f.detail.getItem(1, 'numericalfactor'))
  const route = fixture.rt.fire
  const key = (key) => view.editor.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
  const button = (direction) => f.element('dw_detail').querySelector(`[data-obj=numericalfactor] button[data-direction="${direction}"]`)
  try {
    f.detail.col = f.detail.colIndex('numericalfactor') + 1
    await fixture.ui.focusDw(control, true)
    await settle()
    check(view.editor?.getAttribute('role') === 'spinbutton' &&
      view.editor.getAttribute('aria-valuemin') === '0' && view.editor.getAttribute('aria-valuemax') === '999',
    'Grade exposes its source integer-bounded decimal spin semantics')
    await control.n_settext('1.25')
    key('ArrowUp')
    await settle()
    check(await control.n_gettext() === '2.25' && String(f.detail.getItem(1, 'numericalfactor')) === stored,
      'Up adjusts the decimal draft without committing or losing its fraction')
    key('ArrowDown')
    await settle()
    check(await control.n_gettext() === '1.25', 'Down reverses the decimal step exactly')
    button(1).click()
    await settle()
    check(await control.n_gettext() === '2.25' && String(f.detail.getItem(1, 'numericalfactor')) === stored,
      'the named Increase action uses the same uncommitted decimal draft')
    fixture.rt.fire = async (target, event, args) => {
      if (target === control && event === 'itemchanged' && args[1].name === 'numericalfactor') {
        await route(target, event, args)
        return 1
      }
      if (target === control && event === 'itemerror') return 1
      return route(target, event, args)
    }
    check(await control.n_accepttext() === -1 && await control.n_gettext() === '2.25' &&
      String(f.detail.getItem(1, 'numericalfactor')) === stored, 'rejection retains the stepped decimal draft and original buffer')
    fixture.rt.fire = route
    check(await control.n_accepttext() === 1 && String(f.detail.getItem(1, 'numericalfactor')) === '2.25',
      'decimal stepping commits only through successful shared validation')
    await fixture.ui.focusDw(control, true)
    await settle()
    await control.n_settext('998.75')
    key('ArrowUp')
    await settle()
    check(await control.n_gettext() === '999' && button(1).disabled, 'upper-bound stepping clamps without wrapping')
    await control.n_settext('0')
    key('ArrowDown')
    await settle()
    check(await control.n_gettext() === '0' && button(-1).disabled, 'lower-bound stepping clamps without wrapping')
    await control.n_settext('invalid')
    key('ArrowUp')
    await settle()
    check(await control.n_gettext() === 'invalid' && view.editor.getAttribute('aria-invalid') === 'true' &&
      view.status.textContent.includes('Enter a valid number') && String(f.detail.getItem(1, 'numericalfactor')) === '2.25',
    'invalid spin input stays intact with explicit correction guidance')
    key('Escape')
    await settle()
  } finally {
    fixture.rt.fire = route
    f.window.props.set('editflag', false)
  }
}

async function checkCheckbox(f, fixture, events, check, settle) {
  const control = f.control('dw_detail'), view = f.view.ctlViews.get(control).dw
  const escape = () => view.editor?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
  const focus = async () => {
    f.detail.row = 1
    f.detail.col = f.detail.colIndex('autocheck') + 1
    await fixture.ui.focusDw(control, true)
    await settle()
    check(view.editor instanceof HTMLInputElement && view.editor.type === 'checkbox', 'Auto Check opens a real native checkbox')
    return view.editor
  }
  const changed = () => events.filter((event) => event.target === control && event.event === 'itemchanged' && event.args[1].name === 'autocheck')
  const route = fixture.rt.fire
  try {
    events.length = 0
    const initial = await focus()
    await fixture.ui.focusDw(control, true)
    control.changed()
    await settle()
    check(view.editor === initial && !initial.checked && document.activeElement === initial &&
      f.detail.getItem(1, 'autocheck') === 'N' && changed().length === 0,
    'SetFocus and repaint retain checkbox identity and focus without toggling')
    escape()
    f.detail.col = f.detail.colIndex('name') + 1
    await fixture.ui.focusDw(control, true)
    await settle()
    view.editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }))
    await settle()
    check(view.editor instanceof HTMLInputElement && view.editor.type === 'checkbox' && !view.editor.checked &&
      f.detail.getItem(1, 'autocheck') === 'N' && changed().length === 0, 'Tab enters Auto Check without treating focus as a click')
    escape()
    if (fixture.session.activeMode === 'modern') {
      const field = f.element('dw_detail').querySelector('[data-obj=autocheck]')
      field.focus()
      field.dispatchEvent(new KeyboardEvent('keydown', { key: 'F2', bubbles: true, cancelable: true }))
      await settle()
      check(view.editor?.type === 'checkbox' && !view.editor.checked && changed().length === 0, 'F2 enters a checkbox without changing it')
      escape()
    }
    events.length = 0
    const field = f.element('dw_detail').querySelector('[data-obj=autocheck]')
    field.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    field.click()
    await settle()
    check(f.detail.getItem(1, 'autocheck') === 'Y' && changed().length === 1 && changed()[0].args[2] === 'Y' &&
      f.window.props.get('editflag'), 'a first pointer click commits the exact Y key once through inherited ItemChanged')
    const object = f.detail.def.objects.find((object) => object.name === 'autocheck')
    const sourceSequence = object.tabsequence
    object.tabsequence = '0'
    try {
      for (const [sequence, stored, count] of [[0, 'Y', 0], [3, 'N', 1], [0, 'N', 0], [3, 'Y', 1]]) {
        f.detail.modify(`autocheck.tabsequence='${sequence}'`)
        control.changed()
        await settle()
        events.length = 0
        const target = f.element('dw_detail').querySelector('[data-obj=autocheck]')
        target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
        target.click()
        await settle()
        check(f.detail.getItem(1, 'autocheck') === stored && changed().length === count && !view.editor,
          `TabSequence ${sequence}: the shared pointer route follows the live override, not the disabled source value`)
      }
    } finally {
      object.tabsequence = sourceSequence
      f.detail.overrides.delete('autocheck.tabsequence')
      control.changed()
      await settle()
    }
    fixture.rt.fire = async (target, event, args) => {
      if (target === control && event === 'itemchanged' && args[1].name === 'autocheck') {
        await route(target, event, args)
        return 1
      }
      if (target === control && event === 'itemerror') return 1
      return route(target, event, args)
    }
    const rejected = await focus()
    events.length = 0
    rejected.click()
    await settle()
    check(f.detail.getItem(1, 'autocheck') === 'Y' && await control.n_gettext() === 'N' &&
      !rejected.checked && rejected.getAttribute('aria-invalid') === 'true' && changed().length === 1,
    'rejection keeps the native unchecked N draft rather than writing or reverting it')
    control.changed()
    await settle()
    check(view.editor === rejected && !rejected.checked && await control.n_gettext() === 'N',
      'repaint keeps a rejected native checkbox and its live data-key text')
    await control.n_settext('Y')
    check(rejected.checked && await control.n_accepttext() === 1 && changed().length === 1,
      'SetText can restore the original checkbox state without replaying a rejected change')
    fixture.rt.fire = route
    f.detail.setItem(1, 'autocheck', null)
    control.changed()
    await settle()
    const unknown = await focus()
    check(unknown.indeterminate && !unknown.checked && await control.n_accepttext() === 1 &&
      f.detail.getItem(1, 'autocheck') === null, 'unknown stored values stay mixed and unchanged when focus leaves')
  } finally {
    fixture.rt.fire = route
    escape()
    f.detail.setItem(1, 'autocheck', 'N')
    f.detail.setItem(1, 'name', 'Stored Mixed')
    f.detail.resetUpdate()
    f.window.props.set('editflag', false)
    f.save.props.set('enabled', false)
    control.changed()
    await settle()
  }
}

async function checkCheckboxGuards(open, fixture, route, check, settle) {
  const failures = [], onError = fixture.rt.onError
  fixture.rt.onError = (error) => failures.push(error)
  try {
    for (const replaceDestination of [false, true]) {
      const f = await open('w_checklistitem_form')
      const control = f.control('dw_detail'), view = f.view.ctlViews.get(control).dw
      const second = f.detail.insertRow(0)
      f.detail.setItem(second, 'code', 2)
      f.detail.setItem(second, 'name', 'Second record')
      f.detail.setItem(second, 'autocheck', 'N')
      control.changed()
      let reject = true, releaseFocus, releaseCommit, changes = 0
      const focusGate = new Promise((resolve) => { releaseFocus = resolve })
      const commitGate = new Promise((resolve) => { releaseCommit = resolve })
      fixture.rt.fire = async (target, event, args) => {
        if (target === control && event === 'itemchanged') changes++
        if (target === control && event === 'itemchanged' && reject) return 1
        if (target === control && event === 'itemchanged' && args[0] === 1) await commitGate
        if (target === control && event === 'itemerror') return 1
        if (target === control && event === 'getfocus') await focusGate
        return route(target, event, args)
      }
      try {
        f.detail.row = 1
        f.detail.col = f.detail.colIndex('autocheck') + 1
        await fixture.ui.focusDw(control, true)
        await settle()
        await control.n_settext('Y')
        const clickDestination = async () => {
          const cell = f.element('dw_detail').querySelector('.row[data-row="2"] [data-obj=autocheck]')
          if (!cell) throw new Error('Missing synthetic checkbox destination')
          cell.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
          await settle()
          const current = f.element('dw_detail').querySelector('.row[data-row="2"] [data-obj=autocheck]')
          if (!current) throw new Error('Checkbox destination disappeared during validation')
          current.click()
        }
        await clickDestination()
        await settle()
        check(f.detail.row === 1 && f.detail.getItem(1, 'autocheck') === 'N' &&
          f.detail.getItem(2, 'autocheck') === 'N' && view.editor?.checked && changes === 1,
        'rejected pointer navigation neither abandons a checkbox draft nor toggles its destination')
        // PowerBuilder order: the DataWindow already holds the keyboard (its editor), so the press raises no GetFocus; Clicked, then the
        // previous record's ItemChanged, then the destination.  The activation waits for that acceptance.
        reject = false
        await clickDestination()
        check(f.detail.getItem(1, 'autocheck') === 'N' && f.detail.getItem(2, 'autocheck') === 'N',
          'a queued checkbox activation waits while the previous record is accepted')
        if (replaceDestination) {
          f.detail.deleteRow(2)
          f.detail.setItem(f.detail.insertRow(0), 'autocheck', 'N')
          control.changed()
        }
        releaseCommit()
        await settle()
        const outcome = `row1=${f.detail.getItem(1, 'autocheck')} row2=${f.detail.getItem(2, 'autocheck')} changes=${changes} rows=${f.detail.rowCount()}`
        // Replacing rows while ItemChanged still runs cannot happen in PowerBuilder; the rebuild then may refuse the pending write
        // (rows changed under it), but it never toggles the replaced destination nor writes into the new row.
        check((replaceDestination || f.detail.getItem(1, 'autocheck') === 'Y') && f.detail.getItem(2, 'autocheck') === (replaceDestination ? 'N' : 'Y') &&
          changes === (replaceDestination ? 2 : 3),
          (replaceDestination ? 'replacing the destination invalidates its queued checkbox activation' :
            'the original destination toggles once when its awaited pointer transition completes') + ` (${outcome})`)
      } finally {
        releaseCommit()
        releaseFocus()
        fixture.rt.fire = route
        await f.close()
      }
    }
    for (const change of ['on-code', 'radio-style', 'readonly', 'disabled', 'record', 'destroyed']) {
      const f = await open('w_checklistitem_form')
      const control = f.control('dw_detail'), view = f.view.ctlViews.get(control).dw
      let finish
      const gate = new Promise((resolve) => { finish = resolve })
      fixture.rt.fire = async (target, event, args) => {
        if (target === control && event === 'itemchanged') { await gate; return 0 }
        return route(target, event, args)
      }
      try {
        f.detail.row = 1
        f.detail.col = f.detail.colIndex('autocheck') + 1
        await fixture.ui.focusDw(control, true)
        await settle()
        await control.n_settext('Y')
        const pending = control.n_accepttext()
        await settle()
        if (change === 'on-code') f.detail.modify("autocheck.checkbox.on='T'")
        if (change === 'radio-style') f.detail.modify("autocheck.radiobuttons.columns='2'")
        if (change === 'readonly') f.detail.modify("autocheck.protect='1'")
        if (change === 'disabled') control.pbSet('enabled', false)
        if (change === 'record') {
          f.detail.deleteRow(1)
          const row = f.detail.insertRow(1)
          f.detail.setItem(row, 'autocheck', 'N')
        }
        if (change === 'destroyed') control.destroy()
        else control.changed()
        finish()
        check(await pending === -1 && f.detail.getItem(1, 'autocheck') === 'N',
          `${change}/${fixture.session.activeMode}: a stale checkbox draft cannot write through asynchronous validation`)
        await settle()
        // The rejected draft stays visible: in its editor, as in Classic, or (Modern, when the field can no longer take it) in the
        // recovery panel with its original data key.
        const recovery = f.element('dw_detail').querySelector('.surface-stale input')
        if (fixture.session.activeMode === 'modern' && recovery) {
          check(recovery.value === 'Y', 'stale checkbox recovery exposes its original data key, not a native input index')
        } else check(view.editor?.type === 'checkbox' && view.editor.checked, `${change}/${fixture.session.activeMode}: rejected checkbox drafts remain visible`)
      } finally {
        finish()
        fixture.rt.fire = route
        await f.close()
      }
    }
    check(failures.length >= 4, 'checkbox guard failures reach the shared runtime error reporter')
  } finally { fixture.rt.onError = onError; fixture.rt.fire = route }
}

async function checkInteractions(f, fixture, events, check, settle) {
  const sort = f.element('ddlb_sort')
  sort.selectedIndex = 1
  sort.dispatchEvent(new Event('change', { bubbles: true }))
  await settle()
  check(f.list.getItem(1, 'name') === 'ALPHA' && f.window.props.get('ii_type') === 1 &&
    !f.control('tabpage_detail').props.get('enabled'), 'source sorting updates the list and Detail availability')
  const find = f.control('dw_find')
  find.model.row = 1
  find.model.col = 1
  await fixture.ui.focusDw(find, true)
  await settle()
  const findView = f.view.ctlViews.get(find).dw
  findView.editor.value = 'BR'
  findView.editor.dispatchEvent(new Event('input', { bubbles: true }))
  await settle()
  check(f.window.props.get('il_selectedrow') === 2 && f.control('tabpage_detail').props.get('enabled'),
    'the actual ascending-text Find routine selects BRAVO and enables Detail')
  findView.editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  await f.control('ddlb_data').n_selectitem(2)
  f.element('cb_filter').click()
  await settle()
  check(f.list.rowCount() === 1 && f.list.getItem(1, 'name') === 'BRAVO', 'the source filter uses current criterion text')
  f.element('cb_filter').click()
  await settle()
  check(f.list.rowCount() === 3, 'source Unfilter restores the full list')
  f.control('cb_filter').pbSet('enabled', false)
  check(f.element('cb_filter').disabled, 'runtime disabled state remains live')
  f.control('cb_filter').pbSet('enabled', true)
  f.element('rb_descending').querySelector('input').click()
  await settle()
  check(f.list.getItem(1, 'name') === 'CHARLIE' && f.window.props.get('is_sortsequence') === 'D',
    'the source descending radio changes the actual sort order')
  f.element('rb_ascending').querySelector('input').click()
  await settle()
  f.control('tabpage_detail').pbSet('enabled', true)
  f.element('tab_retrieve').querySelector(':scope > .strip > .t').click()
  await settle()
  const print = f.control('dw_print')
  print.attach(new DwModel(fixture.rt, f.detail.name, structuredClone(f.detail.def)))
  f.control('dw_print').pbSet('visible', true)
  await settle()
  check(f.element('dw_print').getClientRects().length > 0, 'a script can still show a retained print companion')
  check(!f.element('dw_print').querySelector('.modern-surface'),
    'the same DataWindow in an unreviewed print companion does not inherit the form mapping')
  f.control('dw_print').pbSet('visible', false)
  const detail = f.control('dw_detail')
  const editor = f.view.ctlViews.get(detail).dw
  f.detail.modify("name.edit.case='upper'")
  f.detail.row = 1
  f.detail.col = f.detail.colIndex('name') + 1
  await fixture.ui.focusDw(detail, true)
  await settle()
  events.length = 0
  editor.editor.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
  editor.editor.value = 'a\u00dfb'
  editor.editor.setSelectionRange(2, 2)
  editor.editor.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true }))
  editor.editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, isComposing: true }))
  await settle()
  check(editor.editor?.value === 'a\u00dfb' && !events.some((event) => event.target === detail && ['itemchanged', 'editchanged'].includes(event.event)),
    'IME composition and its confirmation key neither rewrite text nor submit an incomplete entry')
  check(!(await editor.acceptPendingEdit()) && editor.editor?.value === 'a\u00dfb',
    'explicit acceptance cannot submit an unfinished composition or discard its draft')
  editor.editor.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }))
  editor.editor.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: false }))
  await settle()
  check(editor.editor.value === 'ASSB' && editor.editor.selectionStart === 3 &&
    events.filter((event) => event.target === detail && event.event === 'editchanged').length === 1,
    'composition completion converts once and preserves the caret through case expansion')
  check(await editor.acceptPendingEdit() && f.detail.getItem(1, 'name') === 'ASSB', 'the complete composed value is accepted')
  f.detail.modify("name.edit.required='yes'")
  f.detail.setItem(1, 'name', null)
  const validate = await fixture.rt.instantiate('f_validatedw')
  const pending = fixture.rt.callMethod(validate, 'f_validatedw', [detail])
  await settle()
  const dialog = document.querySelector('.presentation-runtime-dialog[open],.msgbox')
  check(dialog?.textContent.includes('Validation Error'), 'the required-field helper reports an empty name')
  if (!dialog?.querySelector('button')) throw new Error('Missing required-name dialog')
  dialog.querySelector('button').click()
  await settle()
  check(await pending === -1 && f.detail.col === f.detail.colIndex('name') + 1, 'required-field failure returns focus to Name')
  if (editor.editor) editor.editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  f.window.props.set('editflag', false)
}
