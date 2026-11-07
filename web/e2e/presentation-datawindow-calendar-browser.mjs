import { Runtime, Ref, Frame } from './src/runtime/interp.js'
import { fixClassData } from './src/runtime/class-fixes.js'
import { DwCatalog } from './src/dw/def.js'
import { PBDate, PBDateTime, PBTime, dateOrder, setDateOrder } from './src/runtime/values.js'

// Original calendar and F4 routines; a synthetic owner/buffer isolates them from database workflows.
export async function checkDataWindowCalendar(fixture, check, settle) {
  const source = await (await fetch('./presentation-datawindow-calendar.json')).json()
  const rt = fixture.rt, modern = fixture.session.activeMode === 'modern'
  const field = (name, value, type = 'long') => ({ name, value, type, attr: '0xbc' })
  const classes = source.classes.map((definition) => {
    fixClassData(definition.name, definition)
    return { ...definition, routines: new Map(Object.entries(definition.routines).map(([owner, routines]) =>
      [owner, new Map(Object.entries(routines))])) }
  })
  fixClassData('w_customercomments', source.comments)
  let current
  const feedback = () => document.querySelector('.presentation-runtime-dialog[open],.msgbox')
  const wait = async (predicate, label, messages = []) => {
    for (let attempt = 0; attempt < 50; attempt++) {
      await settle()
      const message = feedback()
      if (message) { messages.push(message.textContent); message.querySelector('button').click() }
      if (predicate()) return
    }
    throw new Error(`DataWindow calendar ${label} did not settle: ${JSON.stringify({
      owner: current?.owner, type: current?.type, empty: current?.empty, recent: rt.recentNames(),
      editor: current?.edit()?.value, active: document.activeElement?.outerHTML?.slice(0, 400),
      messages, missing: [...rt.missing], errors: window.presentationRuntimeErrors,
    })}`)
  }
  const open = async (owner = 'standard', type = 'datetime', empty = false) => {
    await current?.close()
    const name = 'w_calendar_dw_fixture'
    const old = { fire: rt.fire, catalog: rt.dwCatalog,
      classes: new Map([...classes.map((definition) => definition.name), name].map((key) => [key, rt.classes.get(key)])) }
    for (const definition of classes) rt.classes.set(definition.name, definition)
    rt.classes.set(name, {
      name, kind: 'window', ancestor: 'window', library: 'synthetic',
      fields: [field('title', 'Synthetic DataWindow calendar caller', 'string'), field('width', 2600),
        field('height', 1600), field('windowtype', 1)],
      controls: [{ name: 'dw_date', ancestor: 'u_dwstandard', fields: [
        field('dataobject', 'd_arg_date', 'string'), field('x', 30), field('y', 30),
        field('width', 2300), field('height', 1000), field('taborder', 10),
      ], controls: [] }],
      routines: owner === 'comments' ? new Map([['dw_date', new Map(Object.entries(source.comments.routines.dw_itemsdetail))]]) : new Map(),
    })
    const catalog = new DwCatalog(async () => undefined)
    catalog.get = async (object) => {
      if (object !== 'd_arg_date') throw new Error(`Unrecorded calendar DataWindow: ${object}`)
      const definition = structuredClone(source.data)
      // The date variant checks the native API; the recovered d_arg_date column is datetime.
      definition.table.columns.find((column) => column.name === 'date').type = type
      if (type === 'date') definition.objects.find((object) => object.type === 'column' && object.name === 'date')['editmask.mask'] = 'dd/mm/yyyy'
      return definition
    }
    rt.dwCatalog = catalog
    let keyWork, window
    rt.fire = (target, event, args = []) => {
      let root = target
      while (root && ![name, 'w_calendar2'].includes(root.className)) root = root.parent
      if (!root) return old.fire(target, event, args)
      const work = Runtime.prototype.fire.call(rt, target, event, args)
      if (event === 'ue_dwnkey' && args[0] === 'keyf4!') keyWork = work
      return work
    }
    const restore = () => {
      rt.fire = old.fire; rt.dwCatalog = old.catalog
      for (const [key, value] of old.classes) if (value === undefined) rt.classes.delete(key); else rt.classes.set(key, value)
    }
    try {
      const ref = new Ref(() => window, (value) => { window = value }); ref.name = name
      await rt.sys.get('open').fn(rt, [ref], new Frame(null, null, 0))
      const control = window.children.get('dw_date')
      await control.ready
      if (control.findRoutines('ue_dwnkey')[0]?.r.owner !== (owner === 'comments' ? 'dw_itemsdetail' : 'u_dwstandard')) {
        throw new Error(`The original ${owner} F4 routine is absent from the runtime control`)
      }
      const model = control.model, view = fixture.ui.views.get(window), dw = view.ctlViews.get(control).dw
      model.insertRow(0); model.row = 1; model.col = 1
      const original = empty ? null : type === 'date' ? PBDate.ymd(2024, 3, 31) :
        new PBDateTime(PBDate.ymd(2024, 3, 31).n, PBTime.hms(21, 22, 23, 125).ms)
      model.setItem(1, 'date', original)
      control.changed(); await settle()
      await control.n_setfocus(); await settle()
      const edit = () => dw.editor
      const key = () => {
        const target = edit() ?? document.activeElement
        target.dispatchEvent(new KeyboardEvent('keydown', { key: 'F4', bubbles: true, cancelable: true }))
      }
      const finish = async () => {
        if (!keyWork) throw new Error('The original F4 handler was not reached')
        let done = false, failure
        keyWork.then(() => { done = true }, (error) => { failure = error; done = true })
        await wait(() => done, 'F4 return', messages)
        if (failure) throw failure
        await settle()
      }
      const messages = []
      const calendar = async () => {
        await wait(() => rt.windowInstances.get('w_calendar2')?.isOpen && rt.modalWaiting === 1,
          'open', messages)
        return rt.windowInstances.get('w_calendar2')
      }
      const close = async () => {
        if (current !== result) return
        try {
          const nested = rt.windowInstances.get('w_calendar2')
          if (nested?.isOpen) {
            await rt.fire(nested.children.get('cb_cancel'), 'clicked'); await rt.flushPosted()
            await finish()
          }
          if (window.isOpen) await rt.sys.get('close').fn(rt, [window], new Frame(null, null, 0))
        } finally { restore(); current = null; await settle() }
      }
      const result = { owner, type, empty, original, window, control, model, view, dw, edit, key, finish, calendar, close, messages }
      current = result
      return result
    } catch (error) {
      if (window?.isOpen) await rt.sys.get('close').fn(rt, [window], new Frame(null, null, 0))
      restore()
      throw error
    }
  }
  const originalOrder = dateOrder
  try {
    for (const owner of ['standard', 'comments']) for (const regional of ['mdy', 'dmy']) {
      setDateOrder(regional)
      for (const type of ['date', 'datetime']) for (const empty of [false, true]) {
        for (const exit of ['ok', 'cancel', 'close']) {
          const f = await open(owner, type, empty)
          f.key()
          const calendarWindow = await f.calendar(), calendar = calendarWindow.children.get('mc_calendar')
          const calendarView = fixture.ui.views.get(calendarWindow)
          check(calendarView.el.classList.contains('modern-calendar-window') === modern &&
            calendarView.ctlViews.size === 3, `${owner}/${regional}/${type}/${empty}: complete original ISO calendar opens`)
          check(calendar.selectedDate.n === (empty ? calendar.today.n : PBDate.ymd(2024, 3, 31).n) &&
            calendarView.el.querySelector('[aria-selected=true]') === document.activeElement,
          'ISO selection and source-requested calendar focus match the accepted buffer')
          await calendar.n_setselecteddate(PBDate.ymd(2024, 2, 29))
          if (exit === 'close') calendarView.el.querySelector('.tbar .cls').click()
          else calendarView.ctlViews.get(calendarWindow.children.get(exit === 'ok' ? 'cb_ok' : 'cb_cancel')).el.click()
          await wait(() => !calendarWindow.isOpen, 'close')
          await f.finish()
          const value = f.model.getItem(1, 'date')
          const expected = exit === 'ok' ? type === 'date' ? PBDate.ymd(2024, 2, 29) :
            new PBDateTime(PBDate.ymd(2024, 2, 29).n, empty ? 0 : PBTime.hms(21, 22, 23, 125).ms) : f.original
          check(value === null && expected === null || value instanceof PBDate && expected instanceof PBDate && value.n === expected.n ||
            value instanceof PBDateTime && expected instanceof PBDateTime && value.n === expected.n && value.ms === expected.ms,
          `${owner}/${regional}/${type}/${empty}/${exit}: ISO return preserves type, clock or original Cancel value`)
          check(f.dw.root.contains(document.activeElement) && rt.modalWaiting === 0 && f.window.isOpen,
            'Source DataWindow focus and non-modal caller are restored after the calendar')
          const date = expected instanceof PBDateTime ? expected.date : expected
          const dateText = date ? `${String(date.d).padStart(2, '0')}/${String(date.m).padStart(2, '0')}/${date.y}` : ''
          const clock = expected instanceof PBDateTime ? ` ${expected.ms ? '21:22:23:125' : '00:00:00:000'}` : ''
          check(f.edit()?.value === dateText + clock && document.activeElement === f.edit(),
            `${owner}/${regional}/${type}/${empty}/${exit}: restored editor displays ${JSON.stringify(dateText + clock)}, ` +
            `got ${JSON.stringify(f.edit()?.value)}, editor focused: ${document.activeElement === f.edit()}`)
          check(!calendar.listeners.size && !calendarView.el.isConnected,
            'ISO calendar disposes its source subscriptions and view')
          await f.close()
        }
      }
      for (const exit of ['ok', 'cancel']) {
        const accepted = await open(owner)
        const entered = '03/04/2024 07:08:09:007'
        accepted.edit().value = entered
        accepted.edit().dispatchEvent(new Event('input', { bubbles: true }))
        await settle()
        accepted.key()
        const acceptedCalendar = await accepted.calendar()
        const acceptedValue = accepted.model.getItem(1, 'date')
        check(acceptedValue instanceof PBDateTime && acceptedValue.n === PBDate.ymd(2024, 4, 3).n &&
          acceptedValue.ms === PBTime.hms(7, 8, 9, 7).ms &&
          acceptedCalendar.children.get('mc_calendar').selectedDate.n === acceptedValue.n,
        `${owner}/${regional}: F4 accepts the visible source-masked draft before choosing its initial date`)
        await acceptedCalendar.children.get('mc_calendar').n_setselecteddate(PBDate.ymd(2024, 2, 29))
        const acceptedView = fixture.ui.views.get(acceptedCalendar)
        acceptedView.ctlViews.get(acceptedCalendar.children.get(exit === 'ok' ? 'cb_ok' : 'cb_cancel')).el.click()
        await wait(() => !acceptedCalendar.isOpen, 'accepted draft return')
        await accepted.finish()
        const retained = accepted.model.getItem(1, 'date')
        check(retained instanceof PBDateTime &&
          retained.n === (exit === 'ok' ? PBDate.ymd(2024, 2, 29).n : acceptedValue.n) &&
          retained.ms === acceptedValue.ms &&
          accepted.edit()?.value === (exit === 'ok' ? '29/02/2024 07:08:09:007' : entered) &&
          document.activeElement === accepted.edit(),
        `${owner}/${regional}/${exit}: the chosen date or cancelled draft retains milliseconds and editor focus`)
        await accepted.close()
      }
      const f = await open(owner)
      const editor = f.edit()
      editor.value = '31/02/2024'
      editor.dispatchEvent(new Event('input', { bubbles: true }))
      await settle()
      f.key(); await f.finish()
      check(!rt.windowInstances.get('w_calendar2')?.isOpen && rt.modalWaiting === 0 &&
        f.model.getItem(1, 'date') === f.original, 'Invalid DataWindow drafts never open against or overwrite an older date')
      check(f.edit()?.value === '31/02/2024' && f.edit().getAttribute('aria-invalid') === 'true' &&
        document.activeElement === f.edit(), 'Rejected date drafts retain their text, inline error and focus')
      await f.close()
    }
  } finally { await current?.close(); setDateOrder(originalOrder) }
  window.openDataWindowCalendarPreview = async (owner = 'standard') => {
    window.dataWindowCalendarPreview = await open(owner)
  }
}
