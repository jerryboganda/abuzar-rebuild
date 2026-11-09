import type { DwChoices } from '../dw/choices.ts'
import { DwChoiceRows } from './dw-choice-rows.ts'

let nextPopup = 0
const windowThreshold = 100
const overscan = 8
type ScrollAnchor = { index: number; inset: number; bottom: boolean }

/** Popup exploration changes only the supplied cursor, never the parent's edit text. */
export class DwChoicePopup {
  readonly button = document.createElement('button')
  readonly list = document.createElement('div')
  private input: HTMLInputElement
  private choices: () => DwChoices | null
  private choose: (index: number) => void
  private signal: AbortSignal
  private active = -1
  private opened = false
  private resize: ResizeObserver
  private typed = ''
  private typedAt = 0
  private widthPercent = 100
  private lines: number | undefined
  private options = new Map<number, HTMLElement>()
  private renderedItems: DwChoices['items'] | null = null
  private renderedCount = 0
  private rows: DwChoiceRows | null = null
  private metrics = ''
  private before = document.createElement('div')
  private after = document.createElement('div')
  private frame = 0

  constructor(input: HTMLInputElement, choices: () => DwChoices | null, choose: (index: number) => void, signal: AbortSignal,
    automatic = false, widthPercent = 100, lines?: number) {
    this.input = input
    this.choices = choices
    this.choose = choose
    this.signal = signal
    this.widthPercent = widthPercent
    this.lines = lines
    const id = `dw-choice-popup-${++nextPopup}`
    input.setAttribute('role', 'combobox')
    input.setAttribute('aria-autocomplete', 'none')
    input.setAttribute('aria-controls', id)
    input.setAttribute('aria-expanded', 'false')
    input.autocomplete = 'off'
    input.spellcheck = false
    this.button.type = 'button'
    this.button.className = 'dw-choice-toggle'
    this.button.hidden = automatic
    input.classList.toggle('dw-choice-automatic', automatic)
    this.button.tabIndex = -1
    this.button.setAttribute('aria-label', 'Show choices')
    this.button.setAttribute('aria-controls', id)
    this.button.innerHTML = '<svg viewBox="0 0 12 8" width="12" height="8" aria-hidden="true"><path d="m2 2 4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>'
    this.list.id = id
    this.list.className = 'dw-choice-popup'
    this.list.setAttribute('role', 'listbox')
    this.list.popover = 'manual'
    for (const spacer of [this.before, this.after]) spacer.setAttribute('aria-hidden', 'true')
    this.button.addEventListener('mousedown', (event) => event.preventDefault())
    this.button.addEventListener('click', (event) => {
      event.stopPropagation()
      input.focus({ preventScroll: true })
      if (this.opened) this.close()
      else this.show()
    })
    // The list is the drop-down's own window: picking or scrolling in it is not a click on the DataWindow (no Clicked).
    this.list.addEventListener('mousedown', (event) => { event.preventDefault(); event.stopPropagation() })
    this.list.addEventListener('dblclick', (event) => event.stopPropagation())
    this.list.addEventListener('click', (event) => {
      event.stopPropagation()
      const option = event.target instanceof Element ? event.target.closest<HTMLElement>('[role=option]') : null
      if (option && this.list.contains(option)) this.choose(Number(option.dataset.index))
    })
    this.list.addEventListener('scroll', () => {
      if (!this.opened || !this.rows || this.frame) return
      this.frame = requestAnimationFrame(() => {
        this.frame = 0
        if (this.opened) this.renderWindow()
      })
    }, { passive: true, signal })
    input.addEventListener('blur', () => {
      queueMicrotask(() => { if (document.activeElement !== input) this.close() })
    }, { signal })
    if (automatic) input.addEventListener('focus', () => this.show(), { signal })
    document.addEventListener('pointerdown', (event) => {
      if (event.target instanceof Node && event.target !== input && !this.button.contains(event.target) && !this.list.contains(event.target)) this.close()
    }, { capture: true, signal })
    document.addEventListener('scroll', (event) => {
      if (this.opened && event.target !== this.list && !this.position()) this.close()
    }, { capture: true, signal })
    window.addEventListener('resize', () => this.close(), { signal })
    document.fonts.addEventListener('loadingdone', () => {
      if (this.opened && !this.position()) this.close()
    }, { signal })
    this.resize = new ResizeObserver(() => { if (this.opened && !this.position()) this.close() })
    this.resize.observe(input)
    signal.addEventListener('abort', () => {
      this.close()
      this.resize.disconnect()
      this.button.remove()
      this.list.remove()
    }, { once: true })
  }

  mount(): void {
    if (this.signal.aborted || !this.input.parentElement) return
    this.input.parentElement.append(this.button, this.list)
    if (!this.input.closest('.modern-surface')) {
      const style = this.input.style
      this.button.style.cssText = `position:absolute;left:calc(${style.left || '0px'} + ${style.width || '100%'} - 24px);top:${style.top || '0px'};height:${style.height || '100%'};width:24px;z-index:6`
    }
    if (this.opened) { this.opened = false; this.show() }
  }

  get open(): boolean { return this.opened }
  get index(): number { return this.active }

  close(): void {
    cancelAnimationFrame(this.frame)
    this.frame = 0
    if (this.list.matches(':popover-open')) this.list.hidePopover()
    this.opened = false
    this.input.setAttribute('aria-expanded', 'false')
    this.input.removeAttribute('aria-activedescendant')
  }

  show(): void {
    const choices = this.choices()
    if (this.signal.aborted || this.button.disabled || !choices) return
    if (this.renderedItems !== choices.items || this.renderedCount !== choices.items.length) this.rows = null
    if (!this.position()) return
    const previous = this.active
    this.active = this.choices()?.current?.() ?? -1
    this.draw(previous)
    this.list.showPopover()
    this.opened = true
    if (!this.position()) { this.close(); return }
    this.input.setAttribute('aria-expanded', 'true')
    this.reveal()
  }

  move(direction: number): void {
    if (!this.opened) this.show()
    if (!this.opened) return
    const count = this.choices()?.items.length ?? 0
    this.moveTo(Math.max(0, Math.min(count - 1, this.active < 0 ? (direction < 0 ? count - 1 : 0) : this.active + direction)))
  }

  moveTo(index: number): void {
    if (!this.opened) this.show()
    if (!this.opened || !this.choices()?.items[index]) return
    this.choices()?.highlight?.(index)
    const previous = this.active
    this.active = index
    this.draw(previous)
    this.reveal()
  }

  page(direction: number): void {
    if (!this.opened) this.show()
    if (!this.opened) return
    if (this.rows) this.reveal()
    const option = this.options.get(this.active)
    if (!option) { this.move(direction); return }
    const style = getComputedStyle(this.list)
    const distance = this.list.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom)
    if (this.rows) {
      const top = this.rows.offset(this.active) + direction * distance
      let index = this.rows.at(top + (direction > 0 ? .5 : -.5))
      if (direction < 0 && this.rows.offset(index) < top - .5) index++
      index = direction > 0 ? Math.max(this.active + 1, index) : Math.min(this.active - 1, index)
      this.moveTo(Math.max(0, Math.min(this.renderedCount - 1, index)))
      return
    }
    const top = option.getBoundingClientRect().top + direction * distance
    let low = 0, high = this.options.size
    while (low < high) {
      const middle = Math.floor((low + high) / 2)
      const y = this.options.get(middle)!.getBoundingClientRect().top
      if (direction > 0 ? y <= top + .5 : y < top - .5) low = middle + 1
      else high = middle
    }
    const index = direction > 0 ? Math.max(this.active + 1, low - 1) : Math.min(this.active - 1, low)
    this.moveTo(Math.max(0, Math.min(this.options.size - 1, index)))
  }

  search(character: string): void {
    const now = performance.now()
    this.typed = now - this.typedAt < 700 ? this.typed + character : character
    this.typedAt = now
    const items = this.choices()?.items ?? []
    const text = this.typed.toLocaleLowerCase()
    const prefix = [...text].every((character) => character === text[0]) ? text[0] : text
    for (let offset = 1; offset <= items.length; offset++) {
      const index = (Math.max(-1, this.active) + offset) % items.length
      if (items[index].text.toLocaleLowerCase().startsWith(prefix)) { this.moveTo(index); return }
    }
  }

  private draw(previous: number): void {
    const items = this.choices()?.items ?? []
    for (const name of ['aria-label', 'aria-labelledby']) {
      const value = this.input.getAttribute(name)
      if (value) this.list.setAttribute(name, value)
      else this.list.removeAttribute(name)
    }
    if (this.renderedItems !== items || this.renderedCount !== items.length) {
      this.list.replaceChildren()
      this.options.clear()
      this.renderedItems = items
      this.renderedCount = items.length
      this.metrics = ''
      this.rows = items.length > windowThreshold ?
        new DwChoiceRows(items.length, parseFloat(getComputedStyle(this.input).fontSize) * 2) : null
      this.list.style.setProperty('overflow-anchor', this.rows ? 'none' : '')
      this.list.style.setProperty('scrollbar-gutter', this.rows ? 'stable' : '')
      if (!items.length) this.list.textContent = 'No choices available'
      if (!this.rows) for (let index = 0; index < items.length; index++) {
        this.list.append(this.option(index))
      }
    }
    if (this.rows) this.renderWindow()
    if (previous !== this.active) {
      this.options.get(previous)?.setAttribute('aria-selected', 'false')
      this.options.get(this.active)?.setAttribute('aria-selected', 'true')
    }
  }

  private option(index: number): HTMLElement {
    let option = this.options.get(index)
    if (option) return option
    option = document.createElement('div')
    option.id = `${this.list.id}-${index}`
    option.dataset.index = String(index)
    option.setAttribute('role', 'option')
    option.setAttribute('aria-selected', String(index === this.active))
    option.setAttribute('aria-posinset', String(index + 1))
    option.setAttribute('aria-setsize', String(this.renderedCount))
    option.textContent = this.renderedItems![index].text || '(empty)'
    this.options.set(index, option)
    return option
  }

  private scrollAnchor(): ScrollAnchor {
    const rows = this.rows!
    const top = this.list.scrollTop - parseFloat(getComputedStyle(this.list).paddingTop)
    const index = rows.at(top)
    return { index, inset: top - rows.offset(index),
      bottom: this.list.scrollTop > 0 && this.list.scrollTop >= this.list.scrollHeight - this.list.clientHeight - 1 }
  }

  private renderWindow(anchor?: ScrollAnchor): void {
    const rows = this.rows
    if (!rows) return
    anchor = anchor ?? this.scrollAnchor()
    const style = getComputedStyle(this.list)
    const padding = parseFloat(style.paddingTop)
    const top = rows.offset(anchor.index) + anchor.inset
    const viewport = this.list.clientHeight || 320
    const start = Math.max(0, rows.at(top) - overscan)
    const end = Math.min(rows.count, rows.at(top + viewport) + overscan + 1)
    const indices = Array.from({ length: end - start }, (_, offset) => start + offset)
    const pinned = this.active >= 0 && this.active < rows.count && (this.active < start || this.active >= end)
    if (pinned) indices.push(this.active)
    const keep = new Set(indices)
    for (const [index, option] of this.options) if (!keep.has(index)) {
      option.remove()
      this.options.delete(index)
    }
    const elements = indices.filter(index => index !== this.active || !pinned).map(index => this.option(index))
    const selected = pinned ? this.option(this.active) : null
    const children = [
      ...(selected && this.active < start ? [selected] : []), this.before, ...elements, this.after,
      ...(selected && this.active >= end ? [selected] : []),
    ]
    for (const [index, option] of this.options) {
      option.style.position = pinned && index === this.active ? 'absolute' : ''
      option.style.left = pinned && index === this.active ? style.paddingLeft : ''
      option.style.right = pinned && index === this.active ? style.paddingRight : ''
      if (!(pinned && index === this.active)) option.style.top = ''
    }
    const place = () => {
      this.before.style.height = `${rows.offset(start)}px`
      this.after.style.height = `${rows.offset(rows.count) - rows.offset(end)}px`
      if (selected) selected.style.top = `${padding + rows.offset(this.active)}px`
    }
    place()
    let cursor = this.list.firstChild
    for (const child of children) {
      if (child === cursor) cursor = cursor.nextSibling
      else this.list.insertBefore(child, cursor)
    }
    while (cursor) {
      const next = cursor.nextSibling
      cursor.remove()
      cursor = next
    }
    if (!this.list.matches(':popover-open')) return
    const heights = [...this.options].map(([index, option]) => [index, option.getBoundingClientRect().height])
    for (const [index, height] of heights) if (height > 0) rows.measure(index, height)
    place()
    this.list.scrollTop = anchor.bottom ? this.list.scrollHeight :
      Math.max(0, padding + rows.offset(anchor.index) + anchor.inset)
  }

  private reveal(): void {
    const option = this.options.get(this.active)
    if (option) {
      this.input.setAttribute('aria-activedescendant', option.id)
      for (let pass = 0; pass < (this.rows ? 2 : 1); pass++) {
        option.scrollIntoView({ block: 'nearest', inline: 'nearest' })
        if (this.rows) this.renderWindow()
      }
    } else this.input.removeAttribute('aria-activedescendant')
  }

  private position(): boolean {
    const rect = this.input.getBoundingClientRect()
    if (!rect.width || !rect.height || rect.bottom <= 0 || rect.top >= innerHeight || rect.right <= 0 || rect.left >= innerWidth) return false
    const below = innerHeight - rect.bottom - 4, above = rect.top - 4
    const width = Math.min(Math.max(1, rect.width * this.widthPercent / 100), innerWidth - 8)
    Object.assign(this.list.style, {
      left: `${Math.max(4, Math.min(rect.left, innerWidth - width - 4))}px`,
      width: `${width}px`,
      boxSizing: 'border-box',
    })
    const count = this.choices()?.items.length ?? 0
    let height = 320
    let anchor: ScrollAnchor | undefined
    if ((this.lines !== undefined || this.rows) && this.list.matches(':popover-open')) {
      // Wrapped labels may use more room, but never squeeze additional values into the declared line budget.
      const probe = document.createElement('div')
      probe.setAttribute('role', 'option')
      probe.setAttribute('aria-hidden', 'true')
      probe.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap;pointer-events:none'
      probe.textContent = 'M'
      this.list.append(probe)
      const rowHeight = probe.getBoundingClientRect().height
      const textStyle = getComputedStyle(probe)
      const metrics = [this.list.clientWidth, rowHeight, textStyle.font, textStyle.letterSpacing,
        textStyle.wordSpacing, textStyle.paddingLeft, textStyle.paddingRight].join('|')
      probe.remove()
      const style = getComputedStyle(this.list)
      if (this.lines !== undefined) height = Math.min(this.lines, Math.max(1, count)) * rowHeight +
        parseFloat(style.paddingTop) + parseFloat(style.paddingBottom) +
        parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth)
      if (this.rows && this.metrics !== metrics) {
        anchor = this.scrollAnchor()
        this.metrics = metrics
        this.rows = new DwChoiceRows(count, rowHeight)
      }
    }
    const needed = this.lines === undefined ? Math.min(200, count * parseFloat(getComputedStyle(this.input).fontSize) * 2) : height
    const down = below >= needed || below >= above
    Object.assign(this.list.style, {
      top: down ? `${rect.bottom}px` : 'auto',
      bottom: down ? 'auto' : `${innerHeight - rect.top}px`,
      maxHeight: `${Math.max(0, Math.min(height, down ? below : above))}px`,
    })
    if (this.rows && this.opened) this.renderWindow(anchor)
    return true
  }
}
