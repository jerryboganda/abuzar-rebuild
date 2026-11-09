import { DwModel } from './src/dw/model.js'
import { DwCatalog } from './src/dw/def.js'
import { NDwBase } from './src/runtime/native/dwctrl.js'
import { codeTable } from './src/dw/choices.js'
import { compareLabels, PBDate, PBDateTime } from './src/runtime/values.js'
import { CRITERIA_DATA_SURFACES } from './src/ui/data-surfaces.js'
import { buildPages } from './src/ui/print.js'

// Original field metadata and validation, synthetic buffers only; no report retrieval or output.
export async function checkCriteriaSurfaces(fixture, check, settle) {
  const definitions = await (await fetch('./presentation-surfaces.json')).json()
  const lookups = await (await fetch('./presentation-criteria-lookups.json')).json()
  const rt = fixture.rt, modern = fixture.session.activeMode === 'modern'
  const key = (editor, value) => editor.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true }))
  let current
  const open = async (name) => {
    await current?.close()
    const surface = CRITERIA_DATA_SURFACES.find((surface) => surface.name === name)
    if (!surface) throw new Error(`Unknown criteria preview: ${name}`)
    const old = { fire: rt.fire, error: rt.onError, catalog: rt.dwCatalog }
    const catalog = new DwCatalog(async () => undefined)
    catalog.get = async (name) => {
      if (!lookups[name]) throw new Error(`Unseeded criteria lookup: ${name}`)
      return structuredClone(lookups[name])
    }
    rt.dwCatalog = catalog
    const control = new NDwBase(rt, 'dw_synthetic_criteria')
    const model = new DwModel(rt, name, structuredClone(definitions[name]))
    model.insertRow(0)
    const seeds = {
      distcode: 'SYN-1', arg_to: 'Synthetic addressee\r\nSecond line',
      arg_subject: 'Synthetic subject', arg_detail: 'Synthetic first paragraph\r\nSecond line',
      date: new PBDateTime(PBDate.ymd(2024, 1, 30).n, 12 * 60 * 60 * 1000),
    }
    for (const [field, value] of Object.entries(seeds)) if (model.colIndex(field) >= 0) model.setItem(1, field, value)
    model.row = 1
    model.col = 1
    control.attach(model)
    const children = new Map()
    for (const field of surface.fields) if (field.choice?.kind === 'lookup') {
      const binding = field.choice
      const child = await control.n_getchild(field.object)
      await child.ready
      child.model.reset()
      const rows = [901, 902, 903, 904].map((value, index) => ({
        value, text: binding.dataColumn === binding.displayColumn ? String(value) :
          `${['Alpha', 'Bravo', 'Repeated', 'Repeated'][index]} synthetic ${field.object}`,
      }))
      for (const { value, text } of rows) {
        const row = child.model.insertRow(0)
        child.model.setItem(row, binding.dataColumn, value)
        if (binding.dataColumn !== binding.displayColumn) child.model.setItem(row, binding.displayColumn, text)
      }
      child.model.row = 1
      model.setItem(1, field.object, rows[0].value)
      children.set(field.object, { child, rows })
    }
    const events = [], errors = []
    const state = { rejectChoice: false }
    rt.fire = async (target, event, args = []) => {
      if (target !== control) return old.fire(target, event, args)
      events.push({ event, args })
      return event === 'itemerror' || event === 'itemchanged' && state.rejectChoice ? 1 : 0
    }
    rt.onError = (error) => errors.push(String(error))
    const host = document.createElement('div')
    host.id = 'criteria-preview'
    host.style.cssText = 'position:fixed;inset:16px;z-index:2147483000'
    document.body.append(host)
    const view = fixture.ui.createDwView(control, host)
    await view.render()
    await settle()
    const cell = (name) => view.root.querySelector(`[data-row="1"] [data-obj="${name}"]`)
    const edit = async (name) => {
      await control.n_setcolumn(name)
      await view.focusCurrent(false)
      await settle()
      return view.editor
    }
    const close = async () => {
      if (current !== f) return
      view.dispose()
      control.destroy()
      host.remove()
      rt.fire = old.fire
      rt.onError = old.error
      rt.dwCatalog = old.catalog
      current = null
      await settle()
    }
    const f = { name, surface, control, model, view, host, cell, edit, close, events, errors, children, state }
    current = f
    return f
  }
  try {
    for (const surface of CRITERIA_DATA_SURFACES) {
      const f = await open(surface.name)
      check(f.view.root.classList.contains('modern-surface') === modern,
        `${surface.name}: the selected presentation owns the mapped criteria form`)
      if (modern) {
        const visible = surface.fields.filter((field) =>
          f.model.def.objects.find((object) => object.name === field.object).visible !== '0')
        check([...f.view.root.querySelectorAll('.surface-value')].map((cell) => cell.dataset.obj).join('|') ===
          visible.map((field) => field.object).join('|'), `${surface.name}: every visible field retains source order`)
        check(visible.every((field) => {
          const label = f.model.def.objects.find((object) => object.name === field.labelObject).text.trim() || field.label
          return document.getElementById(f.cell(field.object).dataset.labelledby)?.textContent === label
        }), `${surface.name}: visible labels retain exact source terminology`)
        for (const field of visible.filter((field) => field.suffixObject)) {
          const suffix = f.view.root.querySelector(`[data-surface-suffix="${field.suffixObject}"]`)
          check(suffix?.textContent === f.model.def.objects.find((object) => object.name === field.suffixObject).text &&
            f.cell(field.object).getAttribute('aria-describedby')?.split(' ').includes(suffix.id),
          `${surface.name}: the source suffix is visible and associated with its field`)
        }
      }
      if (surface.name === 'd_arg_saleprice_disabled') {
        const before = String(f.model.getItem(1, 'saleprice'))
        await f.edit('saleprice')
        check(!f.view.editor && String(f.model.getItem(1, 'saleprice')) === before,
          'The zero-tab-sequence sale-price variant cannot open an editor')
        if (modern) check(f.cell('saleprice').getAttribute('aria-readonly') === 'true' &&
          !f.view.root.querySelector('.surface-required'),
        'The disabled price remains copyable without an editable required cue')
      } else if (surface.name === 'd_arg_letter') {
        for (const field of surface.fields) {
          const original = f.model.getItem(1, field.object)
          let input = await f.edit(field.object)
          check(input instanceof HTMLTextAreaElement && input.value === original.replace(/\r\n/g, '\n') &&
            await f.control.n_gettext() === original, `${field.object}: original letter CRLF text opens without rewriting`)
          await f.control.n_settext('Synthetic edited\r\nsecond line')
          input = f.view.editor
          input.setSelectionRange(2, 8, 'backward')
          f.control.changed()
          await settle()
          check(f.view.editor.value === 'Synthetic edited\nsecond line' &&
            f.view.editor.selectionStart === 2 && f.view.editor.selectionEnd === 8 &&
            f.view.editor.selectionDirection === 'backward' && f.model.getItem(1, field.object) === original,
          `${field.object}: redraw retains the unapplied multiline draft and selection`)
          check(await f.control.n_accepttext() === 1 &&
            f.model.getItem(1, field.object) === 'Synthetic edited\r\nsecond line',
          `${field.object}: normal acceptance retains CRLF data`)
          input = await f.edit(field.object)
          await f.control.n_settext('')
          check(await f.control.n_accepttext() === 1 &&
            f.model.getItem(1, field.object) === (field.object === 'arg_to' ? null : ''),
          `${field.object}: empty text follows its own original NilIsNull flag`)
        }
        await f.edit('arg_subject')
        await f.control.n_settext('x'.repeat(4001))
        check(await f.control.n_accepttext() === -1 && await f.control.n_gettext() === 'x'.repeat(4001) &&
          f.model.getItem(1, 'arg_subject') === '', 'An overlong letter draft remains recoverable rather than being truncated or saved')
        await f.control.n_settext('x'.repeat(4000))
        check(await f.control.n_accepttext() === 1 && f.model.getItem(1, 'arg_subject').length === 4000,
          'The exact 4000-character letter boundary is accepted')
        const editor = await f.edit('arg_detail')
        const edits = f.events.filter((event) => event.event === 'editchanged').length
        editor.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
        editor.value = '\u6f22\ncomposed text'
        editor.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true }))
        f.control.changed()
        await settle()
        check(f.view.editor === editor && editor.isConnected && f.model.getItem(1, 'arg_detail') === '' &&
          f.events.filter((event) => event.event === 'editchanged').length === edits,
        'Letter repaint preserves active IME text without an incomplete edit or buffer write')
        editor.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }))
        editor.dispatchEvent(new InputEvent('input', { bubbles: true }))
        await settle()
        check(await f.control.n_gettext() === '\u6f22\r\ncomposed text' &&
          f.events.filter((event) => event.event === 'editchanged').length === edits + 1,
        'Letter composition completion emits one EditChanged and retains CRLF text')
        check(await f.control.n_accepttext() === 1 && f.model.getItem(1, 'arg_detail') === '\u6f22\r\ncomposed text',
          'Completed letter IME text accepts through the shared editor')
      } else {
        if (surface.name === 'd_arg_distcode_city2') {
          check(f.model.getItem(1, 'city') === '.' && !f.cell('city'),
            'The hidden city variant keeps its dot default without exposing the field')
          await f.control.n_modify('city.visible=1 t_1.visible=1')
          await settle()
          check(!!f.cell('city') && f.model.getItem(1, 'city') === '.',
            'Source visibility can reveal the same city field without losing its default')
        }
        for (const field of surface.fields) {
          const object = f.model.def.objects.find((candidate) => candidate.name === field.object)
          const column = f.model.def.table.columns.find((candidate) => candidate.name === field.object)
          if (object.tabsequence === '0') {
            const before = f.model.getItem(1, field.object)
            await f.edit(field.object)
            check(!f.view.editor && f.model.getItem(1, field.object) === before,
              `${surface.name}.${field.object}: source zero TabSequence prevents editing the dependent value`)
            if (modern) check(f.cell(field.object).getAttribute('aria-readonly') === 'true',
              `${surface.name}.${field.object}: the dependent field is explicitly readonly`)
            continue
          }
          if (field.choice?.kind === 'lookup') {
            const { rows, child } = f.children.get(field.object)
            let editor = await f.edit(field.object)
            check((editor instanceof HTMLSelectElement ? editor.selectedOptions[0].textContent : editor.value) === rows[0].text &&
              f.model.getItem(1, field.object) === rows[0].value,
            `${surface.name}.${field.object}: the synthetic child caption does not replace its stored key`)
            const choose = async (index) => {
              editor = f.view.editor ?? await f.edit(field.object)
              if (editor instanceof HTMLSelectElement) {
                editor.value = String(index)
                editor.dispatchEvent(new Event('change', { bubbles: true }))
              } else {
                key(editor, 'F4')
                await settle()
                check(editor.getAttribute('aria-expanded') === 'true' &&
                  editor.readOnly === !field.choice.editable,
                `${surface.name}.${field.object}: popup editing policy matches the source`)
                f.view.root.querySelector(`.dw-choice-popup [data-index="${index}"]`).click()
              }
              await settle()
            }
            const changes = f.events.filter((event) => event.event === 'itemchanged').length
            await choose(3)
            check(f.model.getItem(1, field.object) === rows[3].value &&
              f.events.filter((event) => event.event === 'itemchanged').length === changes + 1 &&
              f.events.filter((event) => event.event === 'itemchanged').at(-1).args[2] === String(rows[3].value),
            `${surface.name}.${field.object}: explicit selection retains duplicate-label identity and commits its key once`)
            f.state.rejectChoice = true
            await choose(1)
            check(f.model.getItem(1, field.object) === rows[3].value && f.view.editor?.getAttribute('aria-invalid') === 'true',
              `${surface.name}.${field.object}: an ItemChanged veto retains the attempted choice without writing it`)
            const rejected = await f.control.n_gettext()
            f.control.changed()
            await settle()
            check(await f.control.n_gettext() === rejected && f.model.getItem(1, field.object) === rows[3].value,
              `${surface.name}.${field.object}: repaint keeps the rejected selection recoverable`)
            f.state.rejectChoice = false
            check(await f.control.n_accepttext() === 1 && f.model.getItem(1, field.object) === rows[1].value,
              `${surface.name}.${field.object}: retry revalidates the original selected key`)
            if (field.choice.editable) {
              editor = await f.edit(field.object)
              await f.control.n_settext('not a class key')
              check(await f.control.n_accepttext() === -1 && await f.control.n_gettext() === 'not a class key' &&
                f.model.getItem(1, field.object) === rows[1].value,
              'Editable class text cannot silently become an invalid class key')
              await f.control.n_settext(rows[0].text)
              check(await f.control.n_accepttext() === 1 && f.model.getItem(1, field.object) === rows[0].value,
                'An exact editable class caption resolves through its original child key')
            }
            check(child.model.rowCount() === rows.length, `${surface.name}.${field.object}: lookup interaction does not rewrite child records`)
            continue
          }
          if (field.choice?.kind === 'list') {
            const editor = await f.edit(field.object)
            const choices = codeTable(f.model.def, object)
            if (!choices?.length) throw new Error(`${surface.name}.${field.object}: source code table is unavailable`)
            const orderedChoices = field.choice.sorted ? [...choices].sort((left, right) => compareLabels(left[0], right[0])) : choices
            const options = [...editor.options].filter((option) => !option.disabled).map((option) => [option.text, option.value])
            check(editor instanceof HTMLSelectElement && options.length === orderedChoices.length &&
              editor.options.length === options.length + (editor.options[0]?.disabled ? 1 : 0) &&
              JSON.stringify(options) === JSON.stringify(orderedChoices.map(([text], index) => [text, String(index)])),
            `${surface.name}.${field.object}: the exact source code table is available in its native selector`)
            const changes = f.events.filter((event) => event.event === 'itemchanged').length
            const current = String(f.model.getItem(1, field.object))
            const selectedIndex = current === orderedChoices[orderedChoices.length - 1][1] ? 0 : orderedChoices.length - 1
            editor.value = String(selectedIndex)
            editor.dispatchEvent(new Event('change', { bubbles: true }))
            await settle()
            check(String(f.model.getItem(1, field.object)) === orderedChoices[selectedIndex][1] &&
              f.events.filter((event) => event.event === 'itemchanged').length === changes + 1,
            `${surface.name}.${field.object}: selecting another source option commits its stored code once`)
            continue
          }
          const temporal = column.type === 'datetime', integer = column.type === 'long'
          const text = temporal ? '29/02/2024' : integer ? '42' : field.object === 'remarks' ? 'Mixed case note' :
            field.object === 'distcode' ? 'Synthetic-code' : field.object === 'city' ? 'Mixed case city' : '12.50'
          const expected = field.object === 'city' ? 'MIXED CASE CITY' :
            field.object === 'remarks' && surface.name !== 'd_arg_quotation_customer_remarks' ? 'MIXED CASE NOTE' : text
          let input = await f.edit(field.object)
          check(input instanceof HTMLInputElement, `${surface.name}.${field.object}: original field is editable`)
          const before = f.model.getItem(1, field.object), changes = f.events.filter((event) => event.event === 'itemchanged').length
          if (temporal) {
            check(input.value === '30/01/2024' && await f.control.n_gettext() === input.value,
              'The due-date editor uses its date-only mask, not regional text with an invisible time')
            check(await f.control.n_accepttext() === 1 && f.model.getItem(1, field.object) === before &&
              f.events.filter((event) => event.event === 'itemchanged').length === changes,
            'Unchanged date-only editing preserves the stored timestamp without an ItemChanged')
            input = await f.edit(field.object)
          }
          await f.control.n_settext(text)
          check(f.model.getItem(1, field.object) === before, `${surface.name}.${field.object}: editing does not save before acceptance`)
          const accepted = await f.control.n_accepttext(), value = f.model.getItem(1, field.object)
          check(accepted === 1 && (temporal ? value instanceof PBDateTime && value.n === PBDate.ymd(2024, 2, 29).n :
            column.type.startsWith('char') ? value === expected : Number(value) === Number(expected)) &&
            f.events.filter((event) => event.event === 'itemchanged').length === changes + 1,
          `${surface.name}.${field.object}: source case/decimal conversion and one ItemChanged own acceptance`)
          if (['saleprice', 'discperc', 'percentage'].includes(field.object)) {
            for (const invalid of field.object === 'saleprice' ? ['-0.01'] : ['-0.01', '100.01']) {
              input = await f.edit(field.object)
              await f.control.n_settext(invalid)
              check(await f.control.n_accepttext() === -1 && input.value === invalid &&
                Number(f.model.getItem(1, field.object)) === 12.5 &&
                f.events.at(-1)?.event === 'itemerror',
              `${surface.name}.${field.object}: original range validation rejects ${invalid} without losing the draft`)
            }
            for (const boundary of field.object === 'saleprice' ? ['0'] : ['0', '100']) {
              await f.control.n_settext(boundary)
              check(await f.control.n_accepttext() === 1 && Number(f.model.getItem(1, field.object)) === Number(boundary),
                `${surface.name}.${field.object}: original inclusive boundary ${boundary} is accepted`)
            }
          } else if (['distcode', 'city', 'remarks'].includes(field.object)) {
            const limit = field.object === 'distcode' ? 30 : field.object === 'city' ? 60 : 100
            const stored = f.model.getItem(1, field.object)
            await f.edit(field.object)
            await f.control.n_settext('X'.repeat(limit + 1))
            check(await f.control.n_accepttext() === -1 && await f.control.n_gettext() === 'X'.repeat(limit + 1) &&
              f.model.getItem(1, field.object) === stored,
            `${surface.name}.${field.object}: exceeding its original ${limit}-character edit limit retains the rejected draft`)
            await f.control.n_settext('X'.repeat(limit))
            check(await f.control.n_accepttext() === 1 && f.model.getItem(1, field.object) === 'X'.repeat(limit),
              `${surface.name}.${field.object}: its exact original edit limit is accepted`)
            if (field.object === 'remarks') {
              await f.edit(field.object)
              await f.control.n_settext('')
              check(await f.control.n_accepttext() === 1 &&
                f.model.getItem(1, field.object) === (surface.name === 'd_arg_quotation_customer_remarks' ? '' : null),
              `${surface.name}: empty remarks retain their original NilIsNull policy`)
            }
          } else if (temporal) {
            await f.edit(field.object)
            await f.control.n_settext('31/02/2024')
            check(await f.control.n_accepttext() === -1 && f.model.getItem(1, field.object) === value &&
              await f.control.n_gettext() === '31/02/2024', 'Invalid service due dates retain their original masked draft')
            await f.control.n_settext('01/03/2024')
            check(await f.control.n_accepttext() === 1 && f.model.getItem(1, field.object).n === PBDate.ymd(2024, 3, 1).n,
              'Correcting a due date uses the original day/month/year mask')
            input = await f.edit(field.object)
            input.value = '04/05/2024'
            input.dispatchEvent(new InputEvent('input', { bubbles: true }))
            await settle()
            await f.control.n_modify("date.editmask.mask='mm/dd/yyyy'")
            await settle()
            const recovery = f.view.root.querySelector('.surface-stale,.dw-recovery')
            check(recovery?.querySelector('input,textarea')?.value === '04/05/2024' &&
              await f.control.n_accepttext() === -1 && f.model.getItem(1, field.object).n === PBDate.ymd(2024, 3, 1).n,
            'A live date-mask change cannot reinterpret or erase an unapplied date')
            await f.control.n_modify("date.editmask.mask='dd/mm/yyyy'")
            recovery?.querySelector('button').click()
            await settle()
          }
        }
      }
      if (modern) for (const field of surface.fields.filter((field) => field.suffixObject)) {
        const source = f.model.def.objects.find((object) => object.name === field.suffixObject).text
        let input = await f.edit(field.object)
        const stored = f.model.getItem(1, field.object), textInput = input instanceof HTMLInputElement
        if (textInput) {
          input.value = field.object === 'count' ? '47' : '17.25'
          input.dispatchEvent(new InputEvent('input', { bubbles: true }))
          input.setSelectionRange(1, 3, 'backward')
        }
        const draft = input.value
        const selection = textInput ? [input.selectionStart, input.selectionEnd, input.selectionDirection] : null
        const literal = 'Literal <b>unit</b> & \u6f22\u5b57 ' + 'extended source caption '.repeat(8)
        f.control.pbGet('object').pbGet(field.suffixObject).pbSet('text', literal)
        await settle()
        const suffix = f.view.root.querySelector(`[data-surface-suffix="${field.suffixObject}"]`)
        input = f.view.editor
        check(suffix?.textContent === literal && !suffix.querySelector('b') &&
          input?.getAttribute('aria-describedby')?.split(' ').includes(suffix.id),
        `${surface.name}: a live suffix remains literal text and describes the active editor`)
        check(input?.value === draft && document.activeElement === input && f.model.getItem(1, field.object) === stored &&
          (!textInput || JSON.stringify([input.selectionStart, input.selectionEnd, input.selectionDirection]) === JSON.stringify(selection)),
        `${surface.name}: changing a suffix preserves the unapplied draft, caret and focus`)
        await f.control.n_modify(`${field.suffixObject}.visible=0`)
        await settle()
        check(!f.view.root.querySelector('.surface-suffix') &&
          !f.view.editor.getAttribute('aria-describedby').split(' ').some((id) => id.endsWith('-suffix')) &&
          f.view.editor.value === draft && f.model.getItem(1, field.object) === stored,
        `${surface.name}: hiding a suffix removes its description without accepting the draft`)
        await f.control.n_modify(`${field.suffixObject}.visible=1 ${field.suffixObject}.text=''`)
        await settle()
        check(!f.view.root.querySelector('.surface-suffix') &&
          !f.view.editor.getAttribute('aria-describedby').split(' ').some((id) => id.endsWith('-suffix')),
        `${surface.name}: empty suffixes leave no blank visual or accessible description`)
        await f.control.n_modify(`${field.suffixObject}.text='${source}'`)
        await settle()
        check(f.view.root.querySelector('.surface-suffix')?.textContent === source &&
          f.view.editor.value === draft && f.model.getItem(1, field.object) === stored,
        `${surface.name}: restoring the source suffix does not rewrite the pending field`)
        key(f.view.editor, 'Escape')
        await settle()
      }
      if (modern && surface.name === 'd_arg_top_n_customers') {
        const suffix = f.control.pbGet('object').pbGet('t_1')
        f.model.setItem(1, 'count', 2)
        const second = f.model.insertRow(0)
        f.model.setItem(second, 'count', 1)
        suffix.pbSet('text', "0\tif(count=1, 'Customer', 'Customers')")
        suffix.pbSet('visible', '1\tif(count>0, 1, 0)')
        await settle()
        const suffixes = [...f.view.root.querySelectorAll('.surface-suffix')]
        check(suffixes.map((element) => element.textContent).join('|') === 'Customers|Customer' &&
          new Set(suffixes.map((element) => element.id)).size === 2 &&
          suffixes.every((element) => element.closest('.surface-field').querySelector('.surface-value')
            .getAttribute('aria-describedby').split(' ').includes(element.id)),
        'Supported row-specific suffix expressions keep independent text and accessible identities')
        f.model.setItem(second, 'count', 0)
        f.control.changed()
        await settle()
        check(f.view.root.querySelectorAll('.surface-suffix').length === 1 &&
          !f.view.root.querySelector(`[data-row="${second}"] .surface-value`)
            .getAttribute('aria-describedby')?.split(' ').some((id) => id.endsWith('-suffix')),
        'A row-specific visibility expression removes only that row suffix and its description')
      }
      const pages = await buildPages(f.control)
      check(pages.length > 0 && !pages.some((page) => page.querySelector('.modern-surface,.surface-required')),
        `${surface.name}: existing Classic print stays isolated from the Modern criteria layout`)
      check(!f.errors.length, `${surface.name}: criteria interactions have no hidden runtime errors`)
      await f.close()
      check(!f.control.listeners.size && !document.getElementById('criteria-preview'),
        `${surface.name}: owned preview disposal releases listeners and DOM`)
    }
  } finally {
    await current?.close()
  }
  window.openCriteriaPreview = async (name) => {
    window.criteriaPreview = await open(name)
    return true
  }
}
