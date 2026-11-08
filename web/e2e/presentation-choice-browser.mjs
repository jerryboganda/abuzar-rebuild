import { DwChoiceEditor } from './src/ui/dw-choice-editor.js'

// The plan's required lookup size; the previous fixture used 10,000 choices.
const LARGE_LOOKUP = 30000

const deferred = () => {
  let resolve, reject
  const promise = new Promise((ok, fail) => { resolve = ok; reject = fail })
  return { promise, resolve, reject }
}

export async function checkChoiceEditors(check, settle) {
  const mount = (settings = {}) => {
    const state = { live: true, closed: 0, writes: [], next: [], enters: 0, errors: [], status: [], loads: [], changes: [], keys: [], current: -1 }
    const items = settings.items ?? [{ text: 'First', value: 1 }, { text: 'Second', value: 2 }]
    const choices = { items, current: () => state.current, highlight: (index) => { state.current = index }, validate: (choice) => {
      if (!items.includes(choice)) throw new Error('Synthetic selected row was removed')
    } }
    const editor = new DwChoiceEditor({
      value: Object.hasOwn(settings, 'value') ? settings.value : 99,
      checkbox: settings.checkbox,
      radio: settings.radio,
      showList: settings.showList,
      popupWidthPercent: settings.popupWidthPercent,
      popupLines: settings.popupLines,
      key: async (event) => { state.keys.push(event.key); return settings.key ? settings.key(event, state) : false },
      editable: settings.editable ? {
        limit: settings.limit ?? 0, normalize: settings.normalize ?? ((text) => text),
        changed: (text) => state.changes.push(text),
        settle: settings.settle ?? (async () => true),
        value: () => Object.hasOwn(settings, 'value') ? settings.value : 99,
        key: async (event) => { state.keys.push(event.key); return settings.key ? settings.key(event, state) : false },
        enter: async () => { state.enters++ },
      } : undefined,
      current: () => state.live,
      guard: async () => { if (settings.guard) await settings.guard() },
      load: async (retry) => {
        state.loads.push(retry)
        return settings.load ? settings.load(retry, choices) : choices
      },
      commit: async (value, guard) => {
        if (settings.commit) return settings.commit(value, guard, state)
        await guard()
        state.writes.push(value)
        return 'accepted'
      },
      close: () => { state.live = false; state.closed++; editor.element.remove() },
      next: async (direction) => { state.next.push(direction) },
      status: (message) => state.status.push(message),
      error: (error) => state.errors.push(error),
      details: settings.details,
    })
    const host = settings.host ?? document.body
    host.append(editor.element)
    editor.popup?.mount()
    if (editor.browse) document.body.append(editor.browse)
    editor.element.focus()
    editor.start()
    return { editor, state, items, dispose: () => { editor.cancel(); state.live = false; editor.element.remove() } }
  }
  const key = (f, key, shiftKey = false) => f.editor.element.dispatchEvent(
    new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true }))
  const type = (f, text) => {
    f.editor.element.value = text
    f.editor.element.dispatchEvent(new InputEvent('input', { bubbles: true }))
  }

  for (const value of [1, 0, null, 'missing']) {
    const f = mount({ popupWidthPercent: 200, value })
    try {
      await settle()
      check(f.editor.element instanceof HTMLInputElement && f.editor.element.readOnly &&
        f.editor.element.getAttribute('role') === 'combobox' && !f.editor.popup.open && !f.editor.popup.button.hidden,
      'Explicit-width readonly lookups remain collapsed on focus and expose a named combobox with an arrow')
      check(f.editor.element.value === (value === 1 ? 'First' : value == null ? '' : String(value)) &&
        f.editor.read() === (value == null ? '' : String(value)) && !f.state.changes.length,
      'Readonly lookup labels remain separate from keys, including null, zero and unlisted values')
      check(await f.editor.accept() && !f.state.writes.length && f.state.closed === 1,
        'Leaving an unchanged explicit-width lookup cannot invent a default key or an ItemChanged event')
    } finally { f.dispose() }
  }
  const readonly = mount({ popupWidthPercent: 235, value: 1,
    items: [{ text: 'Repeated', value: 1 }, { text: 'Repeated', value: 2 }] })
  try {
    await settle()
    key(readonly, 'F4'); await settle()
    const input = readonly.editor.element.getBoundingClientRect(), popup = readonly.editor.popup.list.getBoundingClientRect()
    check(readonly.editor.popup.open && readonly.editor.popup.index === 0 &&
      Math.abs(popup.width - Math.min(input.width * 2.35, innerWidth - 8)) < 1 &&
      popup.left >= 4 && popup.right <= innerWidth - 4,
    'Readonly F4 opens at the accepted key and honors the declared width within the viewport')
    key(readonly, 'ArrowDown'); await settle()
    check(readonly.editor.popup.index === 1 && readonly.editor.read() === '1' && !readonly.state.writes.length,
      'Readonly popup exploration changes the child cursor without committing a duplicate label')
    key(readonly, 'Enter'); await settle()
    check(readonly.state.writes.join() === '2' && readonly.state.closed === 1 && !readonly.state.changes.length &&
      !readonly.editor.popup.list.isConnected,
    'Readonly Enter commits exactly the highlighted original key, closes the editor and emits no text changes')
  } finally { readonly.dispose() }
  const cancelledPopup = mount({ popupWidthPercent: 100, value: 1 })
  try {
    await settle()
    cancelledPopup.editor.write('2')
    key(cancelledPopup, ' '); await settle()
    check(cancelledPopup.editor.popup.open && cancelledPopup.editor.element.value === 'Second',
      'Space opens a collapsed readonly list without replacing a pending SetText selection')
    key(cancelledPopup, 'Escape'); await settle()
    check(!cancelledPopup.editor.popup.open && !cancelledPopup.state.closed && cancelledPopup.editor.read() === '2',
      'First readonly Escape dismisses the popup without discarding the pending key')
    key(cancelledPopup, 'Escape'); await settle()
    check(cancelledPopup.state.closed === 1 && !cancelledPopup.state.writes.length,
      'Second readonly Escape cancels the pending field without writing')
  } finally { cancelledPopup.dispose() }
  let rejectReadonly = true
  const rejectedPopup = mount({ popupWidthPercent: 150, value: 1, commit: async (value, guard, state) => {
    await guard()
    if (rejectReadonly) return 'rejected'
    state.writes.push(value)
    return 'accepted'
  } })
  try {
    await settle()
    check(!await rejectedPopup.editor.choose(1) && rejectedPopup.editor.element.value === 'Second' &&
      rejectedPopup.editor.element.readOnly && rejectedPopup.editor.element.getAttribute('aria-invalid') === 'true' &&
      rejectedPopup.editor.read() === '2' && !rejectedPopup.state.writes.length,
    'Rejected readonly choices retain the proposed label/key and never permit freeform input')
    rejectReadonly = false
    rejectedPopup.editor.popup.button.click(); await settle()
    rejectedPopup.editor.popup.list.querySelector('[data-index="1"]').click(); await settle()
    check(rejectedPopup.state.writes.join() === '2' && rejectedPopup.state.closed === 1,
      'Reopening a rejected readonly popup permits one pointer retry through the shared guard')
  } finally { rejectedPopup.dispose() }
  const failedPopup = mount({ popupWidthPercent: 100, value: 1, load: async (retry, choices) => {
    if (!retry) throw new Error('Synthetic readonly lookup load failure')
    return choices
  } })
  try {
    await settle()
    check(!await failedPopup.editor.accept() && failedPopup.editor.popup.button.disabled &&
      failedPopup.editor.element.readOnly && failedPopup.editor.read() === '1' && failedPopup.state.errors.length === 1,
    'Readonly load failures keep the original key and block popup selection')
    key(failedPopup, 'Enter'); await settle()
    check(failedPopup.state.loads.join() === 'false,true' && failedPopup.editor.element.value === 'First' &&
      failedPopup.editor.element.readOnly && !failedPopup.editor.popup.button.disabled && !failedPopup.editor.popup.open,
    'Readonly retry restores the display label without silently opening or making the field editable')
  } finally { failedPopup.dispose() }
  let vetoPopup = true
  const readonlyShortcut = mount({ popupWidthPercent: 100, value: 1, key: () => vetoPopup })
  try {
    await settle()
    key(readonlyShortcut, 'ArrowDown'); key(readonlyShortcut, 'F4'); await settle()
    check(!readonlyShortcut.editor.popup.open && readonlyShortcut.state.keys.join() === 'ArrowDown,F4',
      'Original key handlers can veto readonly navigation and popup shortcuts')
    vetoPopup = false
    for (const [key, open] of [['ArrowDown', true], ['ArrowUp', false]]) {
      readonlyShortcut.editor.element.dispatchEvent(new KeyboardEvent('keydown', { key, altKey: true, bubbles: true, cancelable: true }))
      await settle()
      check(readonlyShortcut.editor.popup.open === open && !readonlyShortcut.state.writes.length,
        'Alt+Down and Alt+Up only open and close a readonly popup after the source key handler')
    }
  } finally { readonlyShortcut.dispose() }

  for (const modern of [false, true]) for (const scale of [1, 2]) for (const above of [false, true]) {
    for (const lines of [3, 7, 15, 32767, undefined]) for (const wrapped of lines === 3 ? [false, true] : [false]) {
      const host = document.createElement('div')
      host.className = modern ? 'modern-surface' : ''
      host.style.cssText = `position:fixed;left:16px;width:260px;${above ? 'bottom' : 'top'}:16px;font:${16 * scale}px/1.4 sans-serif;z-index:900`
      document.body.append(host)
      const f = mount({ host, popupWidthPercent: 100, popupLines: lines, value: 1,
        items: Array.from({ length: wrapped ? LARGE_LOOKUP : 40 }, (_, index) => ({
          text: wrapped && index % 5 === 0 ? 'Choice with a label that wraps across multiple lines' : `Value ${index + 1}`,
          value: index + 1,
        })) })
      f.editor.element.style.cssText = 'width:100%;height:2.5em;font:inherit'
      try {
        await settle()
        key(f, 'F4'); await settle()
        const list = f.editor.popup.list, rect = list.getBoundingClientRect(), field = f.editor.element.getBoundingClientRect()
        const options = [...list.querySelectorAll('[role=option]')]
        const style = getComputedStyle(list)
        const chrome = ['paddingTop', 'paddingBottom', 'borderTopWidth', 'borderBottomWidth']
          .reduce((sum, property) => sum + parseFloat(style[property]), 0)
        const rowHeight = Math.min(...options.map((option) => option.getBoundingClientRect().height))
        const available = above ? field.top - 4 : innerHeight - field.bottom - 4
        const expectedHeight = Math.min(lines === undefined ? 320 : lines * rowHeight + chrome, available)
        const context = `${modern ? 'Modern' : 'Classic'}/${scale * 100}%/${above ? 'above' : 'below'}/${lines ?? 'fallback'}/${wrapped ? 'wrapped' : 'plain'}`
        check(Math.abs(rect.height - expectedHeight) < 1 && rect.top >= 4 && rect.bottom <= innerHeight - 4 &&
          (above ? rect.bottom <= field.top : rect.top >= field.bottom),
        `${context}: measured source row budget and viewport determine popup height and placement`)
        const distance = list.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom)
        const boundary = options[0].getBoundingClientRect().top + distance + .5
        const pageSize = Math.max(1, options.filter((option) => option.getBoundingClientRect().top <= boundary).length - 1)
        if (wrapped) check(options[0].getBoundingClientRect().height > rowHeight && list.scrollWidth <= list.clientWidth,
          `${context}: long labels wrap without horizontal overflow or expanding the source row budget`)
        key(f, 'PageDown'); await settle()
        check(f.editor.popup.index === pageSize && f.editor.read() === '1' && !f.state.writes.length &&
          document.activeElement === f.editor.element,
        `${context}: Page Down moves one measured page without changing the key or focus`)
        key(f, 'PageUp'); await settle()
        check(f.editor.popup.index === 0 && f.state.keys.slice(-2).join() === 'PageDown,PageUp',
          `${context}: Page Up returns through the original key handler`)
        const originalNodes = new Map(options.map(option => [option.dataset.index, option]))
        check([...list.querySelectorAll('[role=option]')].every(option =>
          !originalNodes.has(option.dataset.index) || originalNodes.get(option.dataset.index) === option) &&
          list.querySelectorAll('[aria-selected=true]').length === 1 &&
          f.editor.element.getAttribute('aria-activedescendant') === options[0].id,
        `${context}: paging preserves option nodes and a single correctly announced highlight`)
      } finally { f.dispose(); host.remove() }
    }
  }
  for (const editable of [false, true]) {
    let veto = true
    const f = mount({ editable, popupLines: 3, value: 1, key: () => veto,
      items: Array.from({ length: 20 }, (_, index) => ({ text: `Choice ${index + 1}`, value: index + 1 })) })
    try {
      await settle()
      f.state.current = 0
      key(f, 'PageDown'); await settle()
      check(!f.editor.popup.open && f.state.keys.join() === 'PageDown',
        'Source key handlers can veto paging in both editable and readonly line-limited lookups')
      veto = false
      key(f, 'PageDown'); await settle()
      const index = f.editor.popup.index
      check(f.editor.popup.open && index === 3 && !f.state.writes.length && !f.state.changes.length,
        'Page Down opens the line-limited list and moves a page without typing or accepting')
      key(f, 'Enter'); await settle()
      check(f.state.writes.join() === String(index + 1) && f.state.closed === 1,
        'Enter after paging accepts exactly the highlighted original data key')
    } finally { f.dispose() }
  }
  for (const count of [0, 1, 100, 101]) {
    const f = mount({ popupLines: 7, value: null,
      items: Array.from({ length: count }, (_, index) => ({ text: `Item ${index}`, value: index })) })
    try {
      await settle()
      key(f, 'F4'); await settle()
      const options = [...f.editor.popup.list.querySelectorAll('[role=option]')]
      check(f.editor.popup.open && (count <= 100 ? options.length === count : options.length > 0 && options.length <= 32),
        `${count} choices: empty/small lists and the virtualization threshold have the correct rendering path`)
      check(f.editor.read() === '' && !f.state.writes.length && !f.state.errors.length &&
        options.every(option => option.getAttribute('aria-setsize') === String(count)),
      `${count} choices: opening does not invent a selection or hide the accessible set size`)
      if (count === 101) {
        f.items.splice(2)
        f.editor.popup.close(); f.editor.popup.show(); await settle()
        check(f.editor.popup.list.querySelectorAll('[role=option]').length === 2 && f.editor.popup.options.size === 2 &&
          !f.state.writes.length && !f.state.errors.length,
        'A smaller replacement list discards the old virtual dimensions before reopening')
      }
    } finally { f.dispose() }
  }
  const largeHost = document.createElement('div')
  largeHost.className = 'modern-surface'
  largeHost.style.cssText = 'position:fixed;top:16px;left:16px;width:260px;font:16px/1.4 sans-serif'
  document.body.append(largeHost)
  const large = mount({ host: largeHost, popupLines: 7, value: 1,
    items: Array.from({ length: LARGE_LOOKUP }, (_, index) => ({
      text: index === LARGE_LOOKUP / 2 || index === LARGE_LOOKUP - 1 ? 'Zebra repeated choice' : `Option ${index + 1}`, value: index + 1,
    })) })
  large.editor.element.style.cssText = 'width:100%;height:2.5em;font:inherit'
  try {
    await settle()
    const openStart = performance.now()
    key(large, 'F4'); await settle()
    ;(window.presentationPerformance ??= []).push({ name: 'lookup-30000-choices-open', rows: LARGE_LOOKUP, milliseconds: Math.round(performance.now() - openStart) })
    const popup = large.editor.popup, list = popup.list
    const visible = () => {
      const active = document.getElementById(large.editor.element.getAttribute('aria-activedescendant'))
      const box = list.getBoundingClientRect(), rect = active?.getBoundingClientRect()
      return !!rect && rect.top >= box.top - .5 && rect.bottom <= box.bottom + .5
    }
    check(list.querySelectorAll('[role=option]').length <= 32 && popup.options.size <= 32,
      'Thirty-thousand-choice opening bounds both the rendered options and retained node cache')
    const first = list.querySelector('[data-index="0"]')
    key(large, 'ArrowDown'); await settle()
    check(list.querySelector('[data-index="0"]') === first && popup.index === 1,
      'Nearby virtual navigation reuses the existing option nodes')
    for (const action of ['PageDown', 'End', 'PageUp', 'Home']) {
      key(large, action); await settle()
      check(list.querySelectorAll('[role=option]').length <= 32 && popup.options.size <= 32 && visible() &&
        document.activeElement === large.editor.element && !large.state.writes.length,
      `${action}: virtual navigation keeps the active choice visible, the cache bounded and the parent key untouched`)
    }
    list.scrollTop = list.scrollHeight / 2
    await settle()
    const middle = [...list.querySelectorAll('[role=option]')].find(option => Number(option.dataset.index) > 1000)
    check(!!middle && popup.index === 0 && large.state.current === 0 &&
      document.getElementById(large.editor.element.getAttribute('aria-activedescendant'))?.dataset.index === '0' &&
      popup.options.size <= 32 && large.editor.read() === '1',
    'Manual virtual scrolling renders distant rows while keeping the offscreen active descendant and original key')
    key(large, 'ArrowDown'); await settle()
    check(popup.index === 1 && visible(), 'Keyboard navigation returns from manual scrolling to its actual active row')
    largeHost.style.fontSize = '32px'
    largeHost.style.width = '150px'
    await settle()
    check(popup.index === 1 && visible() && document.activeElement === large.editor.element &&
      getComputedStyle(list).fontSize === '32px' && list.scrollWidth <= list.clientWidth &&
      popup.options.size <= 32 && large.editor.read() === '1',
    'An open virtual lookup remeasures wrapped rows after font and width changes without losing its draft or focus')
    popup.close(); popup.show(); popup.mount(); await settle()
    check(popup.index === 1 && popup.options.size <= 32 && visible(), 'Virtual remounting preserves the cursor and bounded window')
    key(large, 'z'); await settle()
    check(popup.index === LARGE_LOOKUP / 2 && visible() && !large.state.writes.length,
      'Virtual typeahead finds the first matching distant row without remapping its duplicate label')
    key(large, 'z'); await settle()
    const last = list.querySelector(`[data-index="${LARGE_LOOKUP - 1}"]`)
    check(popup.index === LARGE_LOOKUP - 1 && last?.textContent === 'Zebra repeated choice' &&
      last.getAttribute('aria-setsize') === String(LARGE_LOOKUP) && last.getAttribute('aria-posinset') === String(LARGE_LOOKUP) && visible(),
    'Typeahead searches the complete choice set and announces the offscreen match with its real position and size')
    last.click(); await settle()
    check(large.state.writes.join() === String(LARGE_LOOKUP) && large.state.closed === 1 && !list.isConnected &&
      !large.state.errors.length, 'Pointer selection from a distant virtual window commits exactly its original key once')
  } finally { large.dispose(); largeHost.remove() }

  for (const [draft, expected] of [['Second', 2], ['Free text', 'Free text'], ['', ''], ['2', '2']]) {
    const editable = mount({ editable: true, value: 1 })
    try {
      await settle()
      check(!(await editable.editor.activate(true)) && !editable.state.writes.length,
        'Click activation of editable text must not toggle it like a checkbox')
      check(editable.editor.read() === 'First' && !editable.state.writes.length,
        'Editable lookup GetText starts with the display label, without changing its stored key')
      type(editable, draft)
      check(editable.state.changes.join() === draft && editable.editor.read() === draft,
        'Editable lookup EditChanged receives the typed display text, not a guessed data key')
      check(await editable.editor.accept() && editable.state.writes.length === 1 && editable.state.writes[0] === expected,
        'Exact display labels map to data keys; unmatched, blank and raw-key text reach normal validation unchanged')
    } finally { editable.dispose() }
  }
  const duplicates = [{ text: 'Repeated', value: 1 }, { text: 'Repeated', value: 2 }]
  const unchanged = mount({ editable: true, items: duplicates, value: 2 })
  try {
    await settle()
    check(await unchanged.editor.accept() && !unchanged.state.writes.length,
      'An unchanged duplicate display label keeps its original key instead of choosing the first duplicate')
  } finally { unchanged.dispose() }
  const typedDuplicate = mount({ editable: true, items: duplicates, value: 99 })
  try {
    await settle()
    type(typedDuplicate, 'Repeated')
    check(await typedDuplicate.editor.accept() && typedDuplicate.state.writes[0] === 1,
      'An explicitly typed exact display label uses the documented first matching code-table row')
  } finally { typedDuplicate.dispose() }
  const explicitDuplicate = mount({ editable: true, items: duplicates, value: 99 })
  try {
    await settle()
    check(await explicitDuplicate.editor.choose(1) && explicitDuplicate.state.writes[0] === 2,
      'An explicitly selected duplicate retains its own key rather than remapping its label')
  } finally { explicitDuplicate.dispose() }
  const longSelection = mount({ editable: true, limit: 3, value: 1 })
  try {
    await settle()
    type(longSelection, 'Second')
    check(!(await longSelection.editor.accept()) && !longSelection.state.writes.length,
      'Editable lookup limits reject overlong typed display text without changing its key')
    check(await longSelection.editor.choose(1) && longSelection.state.writes[0] === 2,
      'A lookup typing limit cannot reject an explicitly selected longer display label')
  } finally { longSelection.dispose() }
  for (const accepted of [true, false]) {
    const enter = mount({ editable: true, value: 1, commit: async (value, guard, state) => {
      await guard()
      if (!accepted) return 'rejected'
      state.writes.push(value)
      return 'accepted'
    } })
    try {
      await settle()
      type(enter, 'Second')
      key(enter, 'Enter')
      await settle()
      check(enter.state.enters === Number(accepted) && !enter.state.next.length &&
        enter.state.writes.length === Number(accepted),
      'Typed Enter dispatches the source Enter continuation once only after successful acceptance, never a second Tab')
    } finally { enter.dispose() }
  }
  const editable = mount({ editable: true, value: 1 })
  try {
    await settle()
    type(editable, 'Unfinished')
    key(editable, 'ArrowDown')
    await settle()
    check(editable.editor.popup.open && editable.editor.read() === 'Unfinished' && !editable.state.writes.length &&
      document.activeElement === editable.editor.element && editable.editor.element.hasAttribute('aria-activedescendant'),
    'Editable popup exploration preserves text and input focus while announcing the active option')
    key(editable, 'Escape')
    await settle()
    check(!editable.editor.popup.open && editable.editor.read() === 'Unfinished' && !editable.state.closed,
      'First Escape dismisses the editable list without discarding text')
    key(editable, 'Escape')
    await settle()
    check(editable.state.closed === 1 && !editable.state.writes.length, 'Second Escape cancels the editable field without writing')
  } finally { editable.dispose() }
  const composing = mount({ editable: true, normalize: (text) => text.toUpperCase(), limit: 12, value: 1 })
  try {
    await settle()
    composing.editor.element.dispatchEvent(new CompositionEvent('compositionstart'))
    type(composing, 'ime')
    check(composing.editor.read() === 'ime' && !composing.state.changes.length && !(await composing.editor.accept()),
      'Editable lookup IME text stays untouched and cannot be accepted mid-composition')
    check(!(await composing.editor.choose(1)) && composing.editor.read() === 'ime' && !composing.state.writes.length,
      'Popup selection cannot replace an unfinished IME composition')
    composing.editor.element.dispatchEvent(new CompositionEvent('compositionend'))
    type(composing, 'IME')
    check(composing.editor.read() === 'IME' && composing.state.changes.join() === 'IME' &&
      composing.editor.element.maxLength === 12, 'Composition emits one normalized EditChanged and honors the lookup input limit')
    composing.editor.write('source text')
    check(composing.editor.read() === 'SOURCE TEXT' && composing.state.changes.length === 1,
      'Editable lookup SetText applies display casing without inventing an EditChanged event')
  } finally { composing.dispose() }
  const failed = mount({ editable: true, load: async (retry, choices) => {
    if (!retry) throw new Error('Synthetic editable lookup load failure')
    return choices
  } })
  try {
    await settle()
    failed.editor.write('retained')
    check(!(await failed.editor.accept()) && failed.editor.element.readOnly, 'Failed editable loads prevent unvalidated acceptance')
    key(failed, 'Enter')
    await settle()
    check(failed.editor.read() === 'retained' && !failed.editor.element.readOnly && failed.state.loads.join() === 'false,true',
      'Editable lookup retry preserves source SetText and recovers input')
  } finally { failed.dispose() }
  const validation = deferred()
  const busy = mount({ editable: true, value: 1, commit: async (value, guard, state) => {
    await validation.promise; await guard(); state.writes.push(value); return 'accepted'
  } })
  try {
    await settle()
    type(busy, 'Second')
    const first = busy.editor.accept(), second = busy.editor.accept()
    check(busy.editor.element.readOnly, 'Editable acceptance retains input focus but blocks concurrent text changes')
    validation.resolve()
    check(await first && await second && busy.state.writes.join() === '2' && busy.state.closed === 1,
      'Concurrent editable acceptance shares one guarded write and one close')
  } finally { validation.resolve(); busy.dispose() }
  const shortcut = mount({ editable: true, key: (event) => event.key === 'F4' })
  try {
    await settle()
    key(shortcut, 'F4')
    await settle()
    check(!shortcut.editor.popup.open && shortcut.state.keys.join() === 'F4',
      'A consumed source shortcut is delivered once and is not replaced by popup navigation')
  } finally { shortcut.dispose() }

  const radioItems = [{ text: '&Flat && amount', value: 'F' }, { text: '&Percentage', value: 'D' }]
  for (const value of ['F', 'D', null, 'missing']) {
    const radio = mount({ radio: 2, value, items: radioItems })
    try {
      await settle()
      const inputs = [...radio.editor.element.querySelectorAll('input[type=radio]')]
      check(radio.editor.element instanceof HTMLFieldSetElement && inputs.length === 2 &&
        inputs.filter((input) => input.checked).length === (value === 'F' || value === 'D' ? 1 : 0),
      'Radio groups preserve matched, null and unknown stored values without choosing a default')
      check(radio.editor.ownsFocus() && inputs.filter((input) => input.tabIndex === 0).length === 1 && !radio.state.writes.length,
        'Loading a radio group places one native radio in the tab sequence without writing')
      check(radio.editor.element.textContent.includes('Flat & amount') && !radio.editor.element.textContent.includes('&Percentage'),
        'Radio labels retain source text while displaying mnemonic markers correctly')
      check(await radio.editor.accept() && radio.state.writes.length === 0 && radio.state.closed === 1,
        'Leaving an unchanged radio choice closes its editor without inventing ItemChanged')
    } finally { radio.dispose() }
  }
  const radios = mount({ radio: 2, value: 'F', items: radioItems })
  const otherRadios = mount({ radio: 2, value: 'F', items: radioItems })
  try {
    await settle()
    check(radios.editor.element.querySelector('input').name !== otherRadios.editor.element.querySelector('input').name,
      'Independent DataWindow radio groups never share a native group name')
    check(await radios.editor.choose(1) && !radios.state.closed && radios.editor.element.querySelector('input:checked').value === '1',
      'An accepted radio selection keeps the native group available for another arrow or pointer choice')
    check(otherRadios.editor.element.querySelector('input:checked').value === '0',
      'Choosing in one radio group leaves a different group selected')
    await radios.editor.choose(0)
    await radios.editor.choose(0)
    check(radios.state.writes.join(',') === 'D,F', 'Radio choices commit each changed key once, not repeated selections')
    check(await radios.editor.accept() && radios.state.closed === 1 && radios.state.writes.length === 2,
      'AcceptText after radio change closes the editor without replaying the accepted value')
  } finally { radios.dispose(); otherRadios.dispose() }
  let allowRadio = false
  const rejectedRadio = mount({ radio: 2, value: 'F', items: radioItems,
    commit: async (value, guard, state) => { await guard(); state.writes.push(value); return allowRadio ? 'accepted' : 'rejected' } })
  try {
    await settle()
    check(!(await rejectedRadio.editor.choose(1)) && rejectedRadio.editor.read() === 'D' &&
      rejectedRadio.editor.element.getAttribute('aria-invalid') === 'true' && !rejectedRadio.state.closed,
    'A rejected radio choice keeps its exact pending key and visible error state')
    allowRadio = true
    check(await rejectedRadio.editor.choose(1) && !rejectedRadio.editor.element.hasAttribute('aria-invalid'),
      'An accepted radio retry clears its earlier invalid state')
    rejectedRadio.editor.write('not-listed')
    check(!(await rejectedRadio.editor.accept()) && rejectedRadio.state.writes.length === 2 &&
      !rejectedRadio.editor.element.querySelector('input:checked'),
    'An unknown SetText radio key remains unapplied rather than selecting the first button')
    rejectedRadio.editor.write('D')
    check(await rejectedRadio.editor.accept() && rejectedRadio.state.writes.length === 2,
      'Returning to the accepted radio key does not write again')
  } finally { rejectedRadio.dispose() }
  const radioLoad = deferred()
  const delayedRadio = mount({ radio: 2, value: 'D', items: radioItems,
    load: async (_retry, choices) => { await radioLoad.promise; return choices } })
  try {
    const activation = delayedRadio.editor.activate(0)
    await settle()
    check(!delayedRadio.state.writes.length, 'Radio activation waits for the choice definitions')
    radioLoad.resolve()
    check(await activation && delayedRadio.state.writes.join(',') === 'F',
      'A queued first-option radio click preserves option index zero and commits once')
  } finally { radioLoad.resolve(); delayedRadio.dispose() }
  const radioPending = deferred()
  const concurrentRadio = mount({ radio: 2, value: 'F', items: radioItems,
    commit: async (value, guard, state) => { await radioPending.promise; await guard(); state.writes.push(value); return 'accepted' } })
  try {
    await settle()
    const choosing = concurrentRadio.editor.choose(1)
    await settle()
    const accepting = concurrentRadio.editor.accept(true)
    check(concurrentRadio.editor.element.disabled && !concurrentRadio.state.writes.length,
      'Radio validation exposes a disabled group and holds navigation')
    radioPending.resolve()
    check(await choosing && await accepting && concurrentRadio.state.writes.join(',') === 'D' && concurrentRadio.state.closed === 1,
      'Concurrent radio change and AcceptText share one write and finish the editor before navigating')
  } finally { radioPending.resolve(); concurrentRadio.dispose() }
  let obsoleteRadio = false
  const staleRadio = mount({ radio: 2, value: 'F', items: radioItems,
    guard: async () => { if (obsoleteRadio) throw new Error('Synthetic radio configuration changed') } })
  try {
    await settle()
    obsoleteRadio = true
    check(!(await staleRadio.editor.choose(1)) && !staleRadio.state.writes.length &&
      staleRadio.state.errors.length === 1 && staleRadio.editor.read() === 'D',
    'Changed radio configuration rejects the write and retains the attempted key')
    key(staleRadio, 'Escape')
    check(staleRadio.state.closed === 1 && !staleRadio.state.writes.length, 'Escape discards an obsolete radio draft')
  } finally { staleRadio.dispose() }

  const loading = deferred()
  const slow = mount({ load: async (_retry, choices) => { await loading.promise; return choices } })
  try {
    check(slow.editor.element.getAttribute('aria-busy') === 'true' && !(await slow.editor.accept()),
      'A loading choice exposes its busy state and blocks acceptance')
    slow.editor.write('2')
    loading.resolve()
    await settle()
    check(slow.editor.read() === '2' && slow.editor.element.selectedOptions[0].textContent === 'Second' &&
      slow.state.writes.length === 0, 'SetText during lookup loading remains an unaccepted data-key draft')
    slow.editor.element.blur()
    await settle()
    check(slow.state.writes.length === 0 && !slow.state.closed, 'Blur never accepts a pending choice')
    key(slow, 'Escape')
    check(slow.state.closed === 1 && slow.state.writes.length === 0, 'Escape cancels a loaded draft without writing')
  } finally { slow.dispose() }

  for (const items of [[], [{ text: 'First', value: 1 }]]) {
    const missing = mount({ items })
    try {
      await settle()
      check(missing.editor.element.value === '' && missing.editor.read() === '99',
        'Empty lookups and missing current values never choose the first available item')
      check(await missing.editor.accept() && missing.state.writes.length === 0,
        'An unchanged missing stored value can be left without inventing a replacement')
    } finally { missing.dispose() }
  }

  const typed = mount({
    items: [{ text: 'Same label', value: null }, { text: 'Same label', value: '' }, { text: 'Zero', value: 0 }],
    commit: async (value, guard, state) => { await guard(); state.writes.push(value); return 'rejected' },
  })
  try {
    await settle()
    for (let index = 0; index < typed.items.length; index++) {
      typed.editor.element.value = String(index)
      typed.editor.element.dispatchEvent(new Event('change', { bubbles: true }))
      await settle()
      check(Object.is(typed.state.writes.at(-1), typed.items[index].value),
        'Option indices preserve null, empty and numeric zero despite duplicate labels')
      check(typed.editor.element.getAttribute('aria-invalid') === 'true' && !typed.state.closed,
        'Rejection retains the select and its invalid state')
    }
    typed.editor.write('not-a-key')
    check(!(await typed.editor.accept()) && typed.state.writes.length === 3,
      'An unavailable SetText key is retained but never passed to the commit path')
  } finally { typed.dispose() }

  const pending = deferred()
  let commits = 0
  const concurrent = mount({ value: 1, commit: async (value, guard, state) => {
    commits++
    await pending.promise
    await guard()
    state.writes.push(value)
    return 'accepted'
  } })
  try {
    await settle()
    concurrent.editor.write('2')
    key(concurrent, 'Tab', true)
    const first = concurrent.editor.accept(), second = concurrent.editor.accept()
    await settle()
    check(first === second && commits === 1 && concurrent.editor.element.disabled && concurrent.state.next.length === 0,
      'Concurrent acceptance shares one validation and does not navigate while pending')
    pending.resolve()
    await first
    await settle()
    check(concurrent.state.next.join(',') === '-1' && concurrent.state.closed === 1 && concurrent.state.writes[0] === 2,
      'Shift+Tab advances once only after the typed choice has been accepted')
  } finally { concurrent.dispose() }

  for (const navigation of [false, true]) {
    const discarded = mount({ value: 1, commit: async () => 'discarded' })
    try {
      await settle()
      discarded.editor.write('2')
      check(await discarded.editor.accept(navigation) === navigation && discarded.state.closed === 1,
        'Discarded choices permit requested navigation but are not reported as accepted input')
    } finally { discarded.dispose() }
  }

  const discardedGate = deferred()
  const mixed = mount({ value: 1, commit: async () => { await discardedGate.promise; return 'discarded' } })
  try {
    await settle()
    mixed.editor.write('2')
    const accepted = mixed.editor.accept(), navigated = mixed.editor.accept(true)
    discardedGate.resolve()
    check(!(await accepted) && await navigated && mixed.state.closed === 1,
      'Concurrent AcceptText and navigation share validation but retain their different discard outcomes')
  } finally { mixed.dispose() }

  const corrected = mount({ value: 1, commit: async () => { corrected.editor.write('1'); return 'rejected' } })
  try {
    await settle()
    corrected.editor.write('2')
    check(!(await corrected.editor.accept()) && corrected.editor.read() === '1' && corrected.editor.element.value === '0',
      'A script SetText correction made during rejection survives the retained selection')
    check(await corrected.editor.accept() && corrected.state.writes.length === 0,
      'Leaving a script-corrected original value does not replay the rejected change')
  } finally { corrected.dispose() }

  const retry = mount({ load: async (retry, choices) => {
    if (!retry) throw new Error('Synthetic lookup failure')
    return choices
  } })
  try {
    await settle()
    check(retry.editor.element.getAttribute('aria-invalid') === 'true' && !(await retry.editor.accept()) &&
      retry.state.loads.length === 1 && retry.state.errors.length === 1, 'Load failures remain visible without an automatic retry loop')
    key(retry, 'Enter')
    await settle()
    check(retry.state.loads.join(',') === 'false,true' && retry.editor.element.value === '' &&
      retry.editor.read() === '99', 'Enter explicitly retries and preserves an unmatched stored value')
  } finally { retry.dispose() }

  const staleCommit = deferred()
  const removed = mount({ value: 1, commit: async (value, guard, state) => {
    await staleCommit.promise
    await guard()
    state.writes.push(value)
    return 'accepted'
  } })
  try {
    await settle()
    removed.editor.write('2')
    const accepting = removed.editor.accept()
    await settle()
    removed.items.pop()
    staleCommit.resolve()
    check(!(await accepting) && removed.state.writes.length === 0 && removed.state.errors.length === 1,
      'A selected row removed during validation cannot be committed from stale options')
  } finally { removed.dispose() }

  const late = deferred()
  const closed = mount({ load: async (_retry, choices) => { await late.promise; return choices } })
  key(closed, 'Escape')
  late.resolve()
  await settle()
  check(!closed.editor.element.isConnected && closed.state.closed === 1 && !closed.state.writes.length && !closed.state.errors.length,
    'Completing a cancelled lookup does not restore an editor, steal focus or write a record')
  closed.dispose()

  const details = deferred()
  let browses = 0
  const browsing = mount({ value: 1,
    load: async (_retry, choices) => ({ ...choices, grid: { title: 'Fixture', columns: [{ label: 'Value', numeric: true }],
      matches: () => true, read: async (index) => [String(index)] } }),
    details: async () => { browses++; return details.promise },
  })
  try {
    await settle()
    const closeShortcut = new KeyboardEvent('keydown', { key: 'F4', ctrlKey: true, cancelable: true })
    browsing.editor.element.dispatchEvent(closeShortcut)
    check(!closeShortcut.defaultPrevented && browses === 0, 'Detailed browsing does not intercept the window close shortcut Ctrl+F4')
    key(browsing, 'F4')
    key(browsing, 'F4')
    await settle()
    check(browses === 1 && browsing.editor.browse.disabled && !(await browsing.editor.accept()) &&
      browsing.state.writes.length === 0, 'Repeated browse activation and programmatic acceptance cannot race an owned picker')
    details.resolve(1)
    await settle()
    check(browsing.state.writes.join(',') === '2' && browsing.state.closed === 1,
      'A detailed selection enters the same typed-key acceptance path exactly once')
  } finally { details.resolve(null); browsing.dispose() }

  const cancelledDetails = deferred()
  const gone = mount({ value: 1,
    load: async (_retry, choices) => ({ ...choices, grid: { title: 'Fixture', columns: [{ label: 'Value', numeric: true }],
      matches: () => true, read: async (index) => [String(index)] } }),
    details: async () => cancelledDetails.promise,
  })
  key(gone, 'F4')
  await settle()
  key(gone, 'F4')
  await settle()
  gone.dispose()
  cancelledDetails.resolve(1)
  await settle()
  check(gone.editor.signal.aborted && gone.state.writes.length === 0,
    'An aborted editor cannot accept a late detailed-selection result')

  const toggleItems = [{ text: 'Unchecked', value: 'N' }, { text: 'Checked', value: 'Y' }]
  for (const value of [null, '', '?', 'N', 'Y']) {
    const toggle = mount({ checkbox: true, value, items: toggleItems })
    try {
      await settle()
      check(toggle.editor.element instanceof HTMLInputElement && toggle.editor.element.type === 'checkbox' &&
        toggle.editor.element.checked === (value === 'Y') &&
        toggle.editor.element.indeterminate === !['N', 'Y'].includes(value),
      'Native checkboxes distinguish checked, unchecked and unmatched stored values')
      toggle.editor.element.focus()
      check(document.activeElement === toggle.editor.element && toggle.state.writes.length === 0,
        'Loading and focusing a checkbox never change its stored key or lose focus')
      check(await toggle.editor.accept() && toggle.state.writes.length === 0,
        'Leaving an unchanged mixed checkbox does not fabricate an unchecked key')
    } finally { toggle.dispose() }
  }

  const toggleLoad = deferred()
  const delayedToggle = mount({ checkbox: true, value: 'N', items: toggleItems,
    load: async (_retry, choices) => { await toggleLoad.promise; return choices } })
  try {
    const activated = delayedToggle.editor.toggle()
    check(delayedToggle.state.writes.length === 0 && document.activeElement === delayedToggle.editor.element,
      'First pointer activation waits for checkbox ownership without losing keyboard focus')
    toggleLoad.resolve()
    check(await activated && delayedToggle.state.writes.join(',') === 'Y',
      'A queued initial activation toggles once after the checkbox is ready')
  } finally { toggleLoad.resolve(); delayedToggle.dispose() }

  const rejectedToggle = mount({ checkbox: true, value: 'N', items: toggleItems,
    commit: async (value, guard, state) => { await guard(); state.writes.push(value); return 'rejected' } })
  try {
    await settle()
    rejectedToggle.editor.element.click()
    await settle()
    check(rejectedToggle.editor.element.checked && rejectedToggle.editor.read() === 'Y' &&
      rejectedToggle.editor.element.getAttribute('aria-invalid') === 'true' && !rejectedToggle.state.closed,
    'A rejected native click retains the checked draft and exact key')
    check(rejectedToggle.state.writes.join(',') === 'Y', 'A native checkbox click reaches acceptance only once')
    rejectedToggle.editor.write('N')
    check(!rejectedToggle.editor.element.checked && !rejectedToggle.editor.element.indeterminate,
      'SetText changes checkbox presentation without directly writing a record')
    check(await rejectedToggle.editor.accept() && rejectedToggle.state.writes.length === 1,
      'Accepting a script-corrected original checkbox state does not replay ItemChanged')
  } finally { rejectedToggle.dispose() }

  const pendingToggle = deferred()
  const asyncToggle = mount({ checkbox: true, value: 'N', items: toggleItems,
    commit: async (value, guard, state) => {
      await pendingToggle.promise
      await guard()
      state.writes.push(value)
      return 'accepted'
    } })
  try {
    await settle()
    const first = asyncToggle.editor.toggle()
    await settle()
    const accepted = asyncToggle.editor.accept()
    check(asyncToggle.editor.element.disabled && !(await asyncToggle.editor.toggle()),
      'A second activation cannot invert a checkbox while validation is pending')
    pendingToggle.resolve()
    check(await first && await accepted && asyncToggle.state.writes.join(',') === 'Y' && asyncToggle.state.closed === 1,
      'Concurrent checkbox acceptance shares one guarded write')
  } finally { pendingToggle.resolve(); asyncToggle.dispose() }

  const cancelledToggleLoad = deferred()
  const cancelledToggle = mount({ checkbox: true, value: 'N', items: toggleItems,
    load: async (_retry, choices) => { await cancelledToggleLoad.promise; return choices } })
  const cancelledActivation = cancelledToggle.editor.toggle()
  cancelledToggle.dispose()
  cancelledToggleLoad.resolve()
  check(!(await cancelledActivation) && cancelledToggle.state.writes.length === 0,
    'Cancelling a loading checkbox invalidates its queued activation')
}
