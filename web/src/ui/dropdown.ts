import type { NControl } from '../runtime/native/controls.ts'
import { toNum, toStr } from '../runtime/values.ts'
import { keyEnum, keyFlags } from './keys.ts'

let nextDropdown = 0

/** The edit portion changes Text, not the list selection. Modified is an end-of-edit event. */
export class DropdownView {
  readonly el = document.createElement('div')
  readonly input = document.createElement('input')
  readonly select = document.createElement('select')
  private button = document.createElement('button')
  private list = document.createElement('div')
  private lifetime = new AbortController()
  private labels: MutationObserver
  private resize: ResizeObserver
  private items: string[] = []
  private active = -1
  private open = false
  private dirty = false
  private composing = false
  private busy = false
  private running = false
  private disposed = false
  private textVersion = -1
  private pending: { run: () => Promise<void>; blockInput: boolean }[] = []
  private control: NControl

  constructor(control: NControl) {
    this.control = control
    const id = `dropdown-${++nextDropdown}`
    this.el.className = 'ctl pb-dropdown'
    this.input.className = 'dropdown-input'
    this.select.className = 'dropdown-select'
    this.input.type = 'text'
    this.input.autocomplete = 'off'
    this.input.spellcheck = false
    this.input.setAttribute('role', 'combobox')
    this.input.setAttribute('aria-autocomplete', 'none')
    this.input.setAttribute('aria-controls', `${id}-list`)
    this.input.setAttribute('aria-expanded', 'false')
    this.button.type = 'button'
    this.button.className = 'dropdown-toggle'
    this.button.tabIndex = -1
    this.button.setAttribute('aria-label', 'Show choices')
    this.button.setAttribute('aria-controls', `${id}-list`)
    this.button.innerHTML = '<svg viewBox="0 0 12 8" width="12" height="8" aria-hidden="true"><path d="m2 2 4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>'
    this.list.id = `${id}-list`
    this.list.className = 'dropdown-list'
    this.list.setAttribute('role', 'listbox')
    this.list.popover = 'manual'
    this.el.append(this.select, this.input, this.button, this.list)
    const order = toNum(control.props.get('taborder') ?? 0)
    for (const field of [this.input, this.select]) {
      field.dataset.tab = String(order || 9999)
      field.tabIndex = order > 0 ? order : -1
      field.addEventListener('focus', () => this.enqueue(() => this.fire('getfocus'), false))
      field.addEventListener('blur', () => {
        this.close()
        this.modified()
        this.enqueue(() => this.fire('losefocus'), false)
      })
      field.addEventListener('keydown', (event) => { if (event instanceof KeyboardEvent) this.key(event) })
    }
    this.input.addEventListener('input', () => {
      if (this.busy || this.input.disabled || this.input.readOnly || this.disposed) return
      control.props.set('text', this.input.value)
      control.props.set('_selected', 0)
      this.dirty = true
      this.close()
    })
    this.input.addEventListener('compositionstart', () => { this.composing = true })
    this.input.addEventListener('compositionend', () => { this.composing = false })
    this.input.addEventListener('select', () => {
      if (this.disposed) return
      control.props.set('_selstart', (this.input.selectionStart ?? 0) + 1)
      control.props.set('_sellen', (this.input.selectionEnd ?? 0) - (this.input.selectionStart ?? 0))
    })
    this.select.addEventListener('change', () => this.choose(this.select.selectedIndex, false))
    this.select.addEventListener('mousedown', (event) => { if (this.busy) event.preventDefault() })
    this.button.addEventListener('mousedown', (event) => event.preventDefault())
    this.button.addEventListener('click', () => {
      if (this.open) this.close()
      else {
        this.input.focus()
        this.show()
      }
    })
    this.list.addEventListener('mousedown', (event) => event.preventDefault())
    this.list.addEventListener('click', (event) => {
      const option = event.target instanceof Element ? event.target.closest<HTMLElement>('[role=option]') : null
      if (option && this.list.contains(option)) this.choose(Number(option.dataset.index), true)
    })
    const signal = this.lifetime.signal
    document.addEventListener('pointerdown', (event) => {
      if (event.target instanceof Node && !this.el.contains(event.target)) this.close()
    }, { capture: true, signal })
    document.addEventListener('scroll', (event) => {
      if (this.open && event.target !== this.list && !(event.target instanceof Node && this.list.contains(event.target)) && !this.position()) this.close()
    }, { capture: true, signal })
    window.addEventListener('resize', () => this.close(), { signal })
    this.resize = new ResizeObserver(() => { if (this.open && !this.position()) this.close() })
    this.resize.observe(this.el)
    this.labels = new MutationObserver(() => this.syncLabels())
    this.labels.observe(this.el, { attributes: true, attributeFilter: ['aria-label', 'aria-labelledby', 'aria-describedby'] })
    this.refresh()
  }

  private syncLabels(): void {
    for (const field of [this.input, this.select, this.list]) {
      for (const attribute of ['aria-label', 'aria-labelledby', 'aria-describedby']) {
        const value = this.el.getAttribute(attribute) ??
          (attribute === 'aria-label' ? toStr(this.control.props.get('accessiblename')) || this.control.name : '')
        if (value) field.setAttribute(attribute, value)
        else field.removeAttribute(attribute)
      }
    }
  }

  refresh(): void {
    if (this.disposed) return
    const editable = this.control.props.get('allowedit') === true
    const current = this.input.hidden ? this.select : this.input
    const next = editable ? this.input : this.select
    const hadFocus = document.activeElement === current
    next.tabIndex = current.tabIndex
    this.input.hidden = !editable
    this.select.hidden = editable
    this.button.hidden = !editable
    this.input.disabled = this.control.props.get('enabled') === false
    this.input.readOnly = this.busy
    this.select.disabled = this.input.disabled
    this.select.setAttribute('aria-disabled', String(this.input.disabled || this.busy))
    this.button.disabled = this.input.disabled || this.busy
    this.el.setAttribute('aria-busy', String(this.busy))
    const limit = toNum(this.control.props.get('limit') ?? 0)
    if (limit > 0) this.input.maxLength = limit
    else this.input.removeAttribute('maxlength')
    const values = this.control.items().a.map(toStr)
    if (values.length !== this.items.length || values.some((value, index) => value !== this.items[index])) {
      this.close()
      this.items = values
      this.select.replaceChildren(...values.map((value) => new Option(value)))
      this.list.replaceChildren(...values.map((value, index) => {
        const option = document.createElement('div')
        option.id = `${this.list.id}-${index}`
        option.dataset.index = String(index)
        option.setAttribute('role', 'option')
        option.textContent = value
        return option
      }))
    }
    this.select.selectedIndex = toNum(this.control.props.get('_selected') ?? 0) - 1
    if (this.textVersion !== this.control.dropdownTextVersion) {
      this.textVersion = this.control.dropdownTextVersion
      this.dirty = false
    }
    const text = toStr(this.control.props.get('text'))
    if (this.input.value !== text) this.input.value = text
    this.syncLabels()
    if (!editable || this.input.disabled || this.control.props.get('visible') === false) this.close()
    if (hadFocus && next !== current) next.focus()
  }

  private position(): boolean {
    const rect = this.el.getBoundingClientRect()
    if (!rect.width || !rect.height || rect.bottom <= 0 || rect.top >= innerHeight || rect.right <= 0 || rect.left >= innerWidth) return false
    const below = innerHeight - rect.bottom - 4
    const above = rect.top - 4
    const down = below >= Math.min(200, this.items.length * parseFloat(getComputedStyle(this.el).fontSize) * 2) || below >= above
    Object.assign(this.list.style, {
      left: `${Math.max(4, Math.min(rect.left, innerWidth - rect.width - 4))}px`,
      top: down ? `${rect.bottom}px` : 'auto',
      bottom: down ? 'auto' : `${innerHeight - rect.top}px`,
      width: `${Math.min(rect.width, innerWidth - 8)}px`,
      maxHeight: `${Math.max(0, Math.min(320, down ? below : above))}px`,
    })
    return true
  }

  private show(): void {
    if (this.open || this.disposed || this.button.disabled || this.input.hidden || !this.items.length || !this.position()) return
    this.list.showPopover()
    this.open = true
    this.input.setAttribute('aria-expanded', 'true')
    this.highlight(toNum(this.control.props.get('_selected') ?? 0) - 1)
  }

  private close(): void {
    if (!this.open) return
    this.list.hidePopover()
    this.open = false
    this.input.setAttribute('aria-expanded', 'false')
    this.input.removeAttribute('aria-activedescendant')
    this.active = -1
  }

  private highlight(index: number): void {
    this.active = index
    for (const [at, option] of [...this.list.children].entries()) option.setAttribute('aria-selected', String(at === index))
    const option = this.list.children[index]
    if (option instanceof HTMLElement) {
      this.input.setAttribute('aria-activedescendant', option.id)
      option.scrollIntoView({ block: 'nearest' })
    } else this.input.removeAttribute('aria-activedescendant')
  }

  private choose(index: number, pointer: boolean): void {
    if (this.busy || this.disposed || this.input.disabled || index < 0 || index >= this.items.length) return
    this.close()
    this.dirty = false
    this.control.props.set('_selected', index + 1)
    this.control.props.set('text', this.items[index])
    this.refresh()
    this.enqueue(async () => {
      await this.fire('selectionchanged', [index + 1])
      if (pointer && !this.disposed) await this.fire('clicked')
    })
  }

  private modified(): void {
    if (!this.dirty || this.composing) return
    this.dirty = false
    this.enqueue(() => this.fire('modified'))
  }

  private key(event: KeyboardEvent): void {
    if (event.isComposing || this.composing || this.disposed) return
    if (this.busy && ((event.target === this.select && event.key !== 'Tab') || ['Enter', 'ArrowDown', 'ArrowUp', 'F4'].includes(event.key))) {
      event.preventDefault()
      event.stopPropagation()
      return
    }
    if (event.target === this.input && !this.busy) {
      const arrow = event.key === 'ArrowDown' || event.key === 'ArrowUp'
      if (!event.ctrlKey && !event.metaKey && !event.shiftKey && (arrow || (event.key === 'F4' && !event.altKey))) {
        event.preventDefault()
        event.stopPropagation()
        if ((event.altKey && event.key === 'ArrowUp') || (event.key === 'F4' && this.open)) this.close()
        else {
          const wasOpen = this.open
          this.show()
          if (this.open && !event.altKey && event.key !== 'F4') {
            const at = this.active < 0 ? (event.key === 'ArrowUp' ? this.items.length - 1 : 0) :
              this.active + (wasOpen ? (event.key === 'ArrowDown' ? 1 : -1) : 0)
            this.highlight(Math.max(0, Math.min(this.items.length - 1, at)))
          }
        }
        return
      }
      if (this.open && (event.key === 'Escape' || event.key === 'Enter')) {
        event.preventDefault()
        event.stopPropagation()
        if (event.key === 'Enter' && this.active >= 0) this.choose(this.active, false)
        else this.close()
        return
      }
    }
    if (event.key === 'Enter' || event.key === 'Tab') {
      this.close()
      this.modified()
    }
    const key = keyEnum(event)
    if (key) this.enqueue(async () => {
      await this.fire('key', [key, keyFlags(event)])
      if (!this.disposed) await this.fire('ue_enterkey', [key, keyFlags(event)])
    }, false)
  }

  private async fire(event: string, args: unknown[] = []): Promise<void> {
    if (this.disposed || this.control.destroyed) return
    await this.control.rt.fire(this.control, event, args)
    if (!this.disposed) await this.control.rt.flushPosted()
  }

  private enqueue(action: () => Promise<void>, blockInput = true): void {
    if (this.disposed || this.control.destroyed) return
    this.pending.push({ run: action, blockInput })
    if (blockInput && this.running) {
      this.busy = true
      this.refresh()
    }
    if (!this.running) void this.drain()
  }

  private async drain(): Promise<void> {
    this.running = true
    try {
      while (!this.disposed && !this.control.destroyed && this.pending.length) {
        const next = this.pending.shift()!
        this.busy = next.blockInput || this.pending.some((action) => action.blockInput)
        this.refresh()
        await next.run()
      }
    } catch (error) {
      this.pending = []
      this.control.rt.onError(error)
      if (!this.disposed) await this.control.rt.ui?.messageBox('Control action failed',
        'The control event could not finish. Review the current value before continuing. No action was retried.',
        'stopsign!', 'ok!', 1)
    } finally {
      this.busy = false
      this.running = false
      this.refresh()
      if (this.pending.length && !this.running && !this.disposed) void this.drain()
    }
  }

  dispose(): void {
    this.close()
    this.disposed = true
    this.pending = []
    this.lifetime.abort()
    this.labels.disconnect()
    this.resize.disconnect()
  }
}
