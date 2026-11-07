import type { DwChoices, DwChoice } from '../dw/choices.ts'
import { sameChoiceValue, radioCaption } from '../dw/choices.ts'
import type { DwEditResult } from '../dw/edit.ts'
import { toStr } from '../runtime/values.ts'
import { DwChoicePopup } from './dw-choice-popup.ts'

interface ChoiceEditorHost {
  value: unknown
  checkbox?: boolean
  radio?: number
  showList?: boolean
  popupWidthPercent?: number
  popupLines?: number
  key?(event: KeyboardEvent): Promise<boolean>
  editable?: {
    limit: number
    normalize(text: string): string
    changed(text: string): void
    settle(): Promise<boolean>
    key(event: KeyboardEvent): Promise<boolean>
    enter(): Promise<void>
    value(): unknown
  }
  load(retry: boolean): Promise<DwChoices>
  current(): boolean
  guard(): Promise<void>
  commit(value: unknown, guard: () => Promise<void>): Promise<DwEditResult>
  close(restoreFocus?: boolean): void
  next(direction: number): Promise<void>
  status(message: string): void
  error(error: unknown): void
  details?(editor: DwChoiceEditor): Promise<number | null>
}

let nextRadioGroup = 0

/** Shared choice controls own display text and data keys until validation finishes. */
export class DwChoiceEditor {
  readonly element: HTMLSelectElement | HTMLInputElement | HTMLFieldSetElement
  readonly browse: HTMLButtonElement | null
  readonly popup: DwChoicePopup | null
  private lifetime = new AbortController()
  get signal(): AbortSignal { return this.lifetime.signal }
  get options(): DwChoices | null { return this.choices }
  get selectedIndex(): number {
    const choice = this.selected()
    return choice && this.choices ? this.choices.items.indexOf(choice) : -1
  }
  get isComposing(): boolean { return this.composing }
  private choices: DwChoices | null = null
  private value: unknown
  private original: unknown
  private radioName = `dw-radio-${++nextRadioGroup}`
  private cancelled = false
  private loading = false
  private failed = false
  private browsing = false
  private loadingWork: Promise<void> = Promise.resolve()
  private accepting: { accepted: Promise<boolean>; navigation: Promise<boolean> } | null = null
  private host: ChoiceEditorHost
  private draftChoice: DwChoice | null = null
  private originalText = ''
  private textWritten = false
  private composing = false
  private compositionText: string | null = null
  private keys: Promise<void> = Promise.resolve()

  constructor(host: ChoiceEditorHost) {
    this.host = host
    this.value = this.original = host.value
    const popupInput = host.editable || host.showList || host.popupWidthPercent !== undefined || host.popupLines !== undefined
    this.element = host.radio ? document.createElement('fieldset') :
      host.checkbox || popupInput ? document.createElement('input') : document.createElement('select')
    if (this.element instanceof HTMLFieldSetElement) {
      this.element.tabIndex = -1
      this.element.setAttribute('role', 'radiogroup')
      this.element.addEventListener('focusin', (event) => {
        if (event.target === this.element) this.element.querySelector<HTMLInputElement>('input[tabindex="0"]')?.focus({ preventScroll: true })
      })
      this.element.addEventListener('click', (event) => event.stopPropagation())
      this.element.addEventListener('dblclick', (event) => event.stopPropagation())
    }
    if (this.element instanceof HTMLInputElement && host.checkbox) {
      this.element.type = 'checkbox'
      this.element.addEventListener('click', (event) => {
        event.stopPropagation()
        if (this.loading || this.failed) {
          event.preventDefault()
          this.host.status(this.failed ? 'Press Enter to retry loading the checkbox.' : 'Wait for the checkbox to load.')
        }
      })
      this.element.addEventListener('dblclick', (event) => event.stopPropagation())
    }
    this.element.className = 'dw-edit dw-choice'
    this.element.setAttribute('aria-description', 'Choose a value. Escape cancels. Tab accepts and moves to the next field.')
    this.browse = host.details ? document.createElement('button') : null
    this.popup = popupInput && !host.checkbox && this.element instanceof HTMLInputElement ?
      new DwChoicePopup(this.element, () => this.choices, (index) => {
        void (host.editable ? host.editable.settle() : Promise.resolve(true))
          .then((ok) => ok && this.choose(index)).catch(host.error)
      }, this.signal, host.showList, host.popupWidthPercent, host.popupLines) : null
    if (this.popup && !host.editable && this.element instanceof HTMLInputElement) {
      this.element.type = 'text'
      this.element.readOnly = true
      this.element.addEventListener('click', (event) => { event.stopPropagation(); this.popup?.show() })
      this.element.addEventListener('dblclick', (event) => event.stopPropagation())
    }
    if (host.editable && this.element instanceof HTMLInputElement) {
      const input = this.element
      input.type = 'text'
      if (host.editable.limit) input.maxLength = host.editable.limit
      input.value = toStr(host.value)
      input.setAttribute('aria-description', 'Type a value or use Down to browse choices. Enter selects; Escape dismisses the list, then cancels. Tab accepts.')
      input.addEventListener('click', (event) => event.stopPropagation())
      input.addEventListener('dblclick', (event) => event.stopPropagation())
      const changed = () => {
        const text = input.value, start = input.selectionStart, end = input.selectionEnd, direction = input.selectionDirection
        input.value = host.editable!.normalize(text)
        if (start !== null && end !== null) input.setSelectionRange(
          host.editable!.normalize(text.slice(0, start)).length, host.editable!.normalize(text.slice(0, end)).length, direction ?? undefined)
        this.draftChoice = null
        this.textWritten = true
        if (!host.showList) this.popup?.close()
        host.editable!.changed(input.value)
      }
      input.addEventListener('compositionstart', () => { this.composing = true; this.compositionText = null })
      input.addEventListener('compositionend', () => {
        this.composing = false
        changed()
        this.compositionText = input.value
      })
      input.addEventListener('input', (event) => {
        if (this.composing || event instanceof InputEvent && event.isComposing) return
        const notified = this.compositionText === input.value
        this.compositionText = null
        if (!notified) changed()
      })
    }
    if (this.browse) {
      this.browse.type = 'button'
      this.browse.className = 'dw-choice-browse'
      this.browse.tabIndex = -1
      this.browse.textContent = '...'
      this.browse.setAttribute('aria-label', 'Browse choice details')
      this.browse.setAttribute('aria-haspopup', 'dialog')
      this.browse.setAttribute('aria-keyshortcuts', 'F4 Alt+ArrowDown')
      this.browse.disabled = true
      this.browse.addEventListener('mousedown', (event) => { event.preventDefault(); event.stopPropagation() })
      this.browse.addEventListener('click', (event) => { event.stopPropagation(); void this.showDetails() })
      this.element.setAttribute('aria-description', 'Choose a value. F4 or Alt+Down opens choice details. Escape cancels. Tab accepts and moves on.')
    }
    this.element.addEventListener('change', () => {
      if (this.popup) return
      if (this.element instanceof HTMLInputElement) this.element.value = this.element.checked ? '1' : '0'
      const choice = this.selected()
      if (choice) this.value = choice.value
      void this.accept(false, !!host.radio).catch((error) => host.error(error))
    })
    this.element.addEventListener('keydown', (event) => {
      if (!(event instanceof KeyboardEvent) || event.isComposing) return
      if (host.editable) { this.editableKey(event); return }
      if (this.popup) { this.listKey(event); return }
      if (host.details && !event.ctrlKey && !event.metaKey && !event.shiftKey &&
        (event.key === 'F4' && !event.altKey || event.altKey && event.key === 'ArrowDown')) {
        event.preventDefault()
        event.stopPropagation()
        void this.showDetails()
      } else if (event.key === 'Escape' && !this.accepting) {
        event.preventDefault()
        event.stopPropagation()
        this.cancel()
        host.close()
      } else if (event.key === 'Enter' && this.failed) {
        event.preventDefault()
        this.loadingWork = this.load(true)
      } else if (event.key === 'Tab' || event.key === 'Enter') {
        event.preventDefault()
        const direction = event.shiftKey && event.key === 'Tab' ? -1 : 1
        void this.accept(true).then((ok) => { if (ok) return host.next(direction) }).catch((error) => host.error(error))
      }
    })
  }

  start(): void { this.loadingWork = this.load(false) }
  read(): string { return this.host.editable && this.element instanceof HTMLInputElement ? this.element.value : toStr(this.value) }
  ownsFocus(): boolean { return this.element.contains(document.activeElement) }
  syncValue(): void {
    if (!this.host.editable || !this.active()) return
    const value = this.host.editable.value()
    if (sameChoiceValue(value, this.original)) return
    this.original = this.value = value
    this.textWritten = false
    this.draftChoice = null
    if (!this.loading && !this.failed) this.populate()
  }

  async activate(activation: boolean | number): Promise<boolean> {
    return typeof activation === 'number' && this.host.radio ? this.choose(activation) :
      activation === true ? this.toggle() : false
  }

  async toggle(): Promise<boolean> {
    if (!this.host.checkbox || !(this.element instanceof HTMLInputElement)) return false
    await this.loadingWork
    if (!this.active()) return false
    if (this.loading || this.failed || this.accepting) {
      this.host.status('Wait for the checkbox to finish, or retry loading with Enter.')
      return false
    }
    return this.choose(this.element.checked ? 0 : 1)
  }

  write(text: string): void {
    if (this.host.editable && this.element instanceof HTMLInputElement) {
      this.element.value = this.host.editable.normalize(text)
      this.textWritten = true
      this.draftChoice = null
      if (!this.host.showList) this.popup?.close()
      return
    }
    this.value = text
    if (!this.loading && !this.failed) this.populate()
  }

  cancel(): void {
    this.cancelled = true
    this.lifetime.abort()
    this.browse?.remove()
  }

  async choose(index: number): Promise<boolean> {
    await this.loadingWork
    if (!this.active() || this.loading || this.failed || this.accepting) return false
    if (this.composing) {
      this.host.status('Finish composing the current entry before choosing a value.')
      return false
    }
    const choice = this.choices?.items[index]
    if (!choice) {
      this.host.status('The selected choice is unavailable. Reopen the field and try again.')
      return false
    }
    try { this.choices!.validate(choice) }
    catch (error) { this.host.error(error); this.host.status('The choices changed. Reopen the field before choosing.'); return false }
    this.value = choice.value
    if (this.host.editable && this.element instanceof HTMLInputElement) {
      try {
        this.choices!.validate(choice)
        this.choices!.highlight?.(index)
      } catch (error) { this.host.error(error); this.host.status('The choices changed. Reopen the field before choosing.'); return false }
      this.draftChoice = choice
      this.element.value = choice.text
      this.textWritten = true
      this.popup?.close()
      return this.accept(false, !!this.host.showList)
    }
    this.populate()
    if (this.element instanceof HTMLSelectElement) this.element.value = String(index)
    return this.accept(false, !!(this.host.radio || this.host.showList))
  }

  private async showDetails(): Promise<void> {
    if (!this.active() || this.loading || this.failed || this.accepting || this.browsing) return
    if (!this.choices?.grid) {
      this.host.status(this.choices?.gridIssue ?? 'Choice details are unavailable. Use the basic list.')
      return
    }
    this.browsing = true
    this.syncBrowse()
    let selected: number | null = null
    try {
      await this.host.guard()
      if (this.active()) selected = await this.host.details?.(this) ?? null
    } catch (error) {
      if (this.active()) {
        this.host.error(error)
        this.host.status('Choice details could not be opened. Use the basic list or reopen the field.')
      }
    } finally {
      this.browsing = false
      this.syncBrowse()
    }
    if (selected !== null && this.active()) await this.choose(selected)
  }

  private syncBrowse(): void {
    if (!this.browse) return
    this.browse.disabled = this.cancelled || this.loading || this.failed || this.browsing || !!this.accepting || !this.choices?.grid
    this.browse.title = this.choices?.gridIssue ?? 'Browse choice details (F4)'
  }

  private active(): boolean { return !this.cancelled && this.host.current() }

  private placeholder(text: string): void {
    if (this.host.editable) {
      this.element.setAttribute('aria-description', text)
      return
    }
    if (this.popup && this.element instanceof HTMLInputElement) {
      this.element.value = text
      this.element.setAttribute('aria-description', text)
      return
    }
    if (this.element instanceof HTMLFieldSetElement) {
      this.element.textContent = text
      return
    }
    if (this.element instanceof HTMLInputElement) {
      this.element.value = ''
      this.element.checked = false
      this.element.indeterminate = true
      this.element.setAttribute('aria-description', text)
      return
    }
    const option = document.createElement('option')
    option.value = ''
    option.textContent = text
    option.disabled = true
    option.selected = true
    this.element.replaceChildren(option)
  }

  private selected(): DwChoice | undefined {
    if (this.host.editable) {
      if (this.draftChoice?.text === this.read()) return this.draftChoice
      if (!this.textWritten) return this.choices?.items.find((choice) => sameChoiceValue(choice.value, this.original))
      return this.choices?.items.find((choice) => choice.text === this.read())
    }
    if (this.popup) return this.choices?.items.find((choice) => sameChoiceValue(choice.value, this.value))
    const key = this.element instanceof HTMLFieldSetElement ?
      this.element.querySelector<HTMLInputElement>('input:checked')?.value ?? '' : this.element.value
    return key === '' ? undefined : this.choices?.items[Number(key)]
  }

  private populate(): void {
    const items = this.choices?.items ?? []
    const selected = items.findIndex((choice) => sameChoiceValue(choice.value, this.value))
    if (this.host.editable && this.element instanceof HTMLInputElement) {
      this.originalText = selected < 0 ? toStr(this.original) : items[selected].text
      if (!this.textWritten) this.element.value = this.originalText
      this.element.setAttribute('aria-description', this.host.showList ?
        'Type a value or browse the visible choices. Enter selects. Escape dismisses the list, then cancels. Tab accepts.' :
        'Type a value or use Down to browse choices. Enter selects; Escape dismisses the list, then cancels. Tab accepts.')
      return
    }
    if (this.popup && this.element instanceof HTMLInputElement) {
      this.element.value = selected < 0 ? toStr(this.value) : items[selected].text
      this.element.setAttribute('aria-description', this.host.showList ?
        'Choices open on focus. Arrows browse; Enter or Space selects. Tab accepts and moves on. Escape cancels a rejected choice.' :
        'Use Down or the arrow button to browse choices. Enter or Space selects. Escape dismisses the list, then cancels. Tab accepts and moves on.')
      if (selected >= 0) this.choices?.highlight?.(selected)
      return
    }
    if (this.element instanceof HTMLFieldSetElement) {
      const focused = this.ownsFocus()
      this.element.replaceChildren()
      this.element.classList.add('dw-radio-options')
      this.element.style.setProperty('--dw-radio-columns', String(Math.min(this.host.radio ?? 1, items.length || 1)))
      for (let index = 0; index < items.length; index++) {
        const label = document.createElement('label')
        label.className = 'dw-radio-option'
        const input = document.createElement('input')
        input.type = 'radio'
        input.name = this.radioName
        input.value = String(index)
        input.checked = index === selected
        input.tabIndex = index === (selected < 0 ? 0 : selected) ? 0 : -1
        input.addEventListener('focus', () => {
          for (const radio of this.element.querySelectorAll<HTMLInputElement>('input[type=radio]')) radio.tabIndex = radio === input ? 0 : -1
        })
        const text = document.createElement('span')
        text.textContent = radioCaption(items[index].text)
        label.append(input, text)
        this.element.append(label)
      }
      this.element.setAttribute('aria-description',
        `${selected < 0 ? `No matching choice: ${toStr(this.value) || '(empty)'}. ` : ''}Arrow keys choose a value. Space selects. Escape cancels a rejected draft; Tab accepts and moves on.`)
      if (focused) this.element.querySelector<HTMLInputElement>('input[tabindex="0"]')?.focus({ preventScroll: true })
      return
    }
    if (this.element instanceof HTMLInputElement) {
      this.element.checked = selected === 1
      this.element.indeterminate = selected < 0
      this.element.value = selected < 0 ? '' : String(selected)
      this.element.setAttribute('aria-description',
        `${selected < 0 ? `No matching checked or unchecked value: ${toStr(this.value) || '(empty)'}. ` : ''}Space changes the value. Escape cancels a rejected draft; Tab accepts and moves on.`)
      return
    }
    this.element.replaceChildren()
    if (selected < 0) this.placeholder(items.length ? (this.value == null ? 'Choose a value' : `Not listed: ${toStr(this.value)}`) : 'No choices available')
    for (let index = 0; index < items.length; index++) {
      const option = document.createElement('option')
      option.value = String(index)
      option.textContent = items[index].text
      option.selected = index === selected
      this.element.append(option)
    }
    this.element.value = selected < 0 ? '' : String(selected)
  }

  private async load(retry: boolean): Promise<void> {
    if (this.loading || !this.active()) return
    this.loading = true
    this.failed = false
    this.syncBrowse()
    this.element.setAttribute('aria-busy', 'true')
    if (this.popup) this.popup.button.disabled = true
    if (this.host.editable && this.element instanceof HTMLInputElement) this.element.readOnly = true
    this.placeholder(this.host.checkbox ? 'Loading checkbox...' : 'Loading choices...')
    try {
      const choices = await this.host.load(retry)
      if (!this.active()) return
      await this.host.guard()
      if (!this.active()) return
      this.choices = choices
      this.populate()
      this.element.removeAttribute('aria-invalid')
      this.host.status(choices.gridIssue ?? (choices.items.length ?
        this.host.editable ? 'Type a value or press Down to browse choices.' :
        this.host.checkbox ? 'Press Space to change the checkbox. Escape cancels.' : 'Choose a value.' :
        'No choices are available. The stored value has not changed.'))
    } catch (error) {
      if (!this.active()) return
      this.failed = true
      this.placeholder('Choices unavailable - press Enter to retry')
      this.element.setAttribute('aria-invalid', 'true')
      this.host.status('Choices could not be loaded. Press Enter to retry or Escape to cancel. The stored value has not changed.')
      this.host.error(error)
    } finally {
      this.loading = false
      this.element.disabled = false
      this.element.setAttribute('aria-busy', 'false')
      if (this.popup) this.popup.button.disabled = this.failed
      if (this.host.editable && this.element instanceof HTMLInputElement) this.element.readOnly = this.failed
      this.syncBrowse()
      if (this.host.showList && !this.failed && this.active() && this.ownsFocus()) this.popup?.show()
    }
  }

  accept(navigation = false, keepOpen = false): Promise<boolean> {
    if (this.accepting) {
      const pending = navigation ? this.accepting.navigation : this.accepting.accepted
      return (this.host.radio || this.host.showList) && !keepOpen ? pending.then((ok) => {
        if (ok && this.active()) { this.cancel(); this.host.close() }
        return ok
      }) : pending
    }
    if (!this.active()) return Promise.resolve(false)
    if (this.composing) {
      this.host.status('Finish composing the current entry before continuing.')
      return Promise.resolve(false)
    }
    if (this.browsing) {
      this.host.status('Finish or cancel browsing choices before accepting the field.')
      return Promise.resolve(false)
    }
    if (this.loading || this.failed) {
      this.host.status(this.loading ? 'Wait for the choices to load before continuing.' : 'Retry loading the choices or press Escape to cancel.')
      return Promise.resolve(false)
    }
    let choice = this.selected()
    if (!this.host.editable && sameChoiceValue(this.value, this.original)) {
      if (!keepOpen) { this.cancel(); this.host.close() }
      return Promise.resolve(true)
    }
    if (!this.host.editable && (!choice || !sameChoiceValue(choice.value, this.value))) {
      this.element.setAttribute('aria-invalid', 'true')
      this.host.status('Select an available value or press Escape to cancel. The entry was not applied.')
      return Promise.resolve(false)
    }
    const guard = async () => {
      if (!this.active()) throw new Error('The choice no longer belongs to the active record. It was not applied.')
      await this.host.guard()
      if (choice) this.choices!.validate(choice)
    }
    const focused = this.ownsFocus()
    if (this.host.editable && this.element instanceof HTMLInputElement) this.element.readOnly = true
    else this.element.disabled = true
    this.popup?.close()
    if (this.popup) this.popup.button.disabled = true
    const work = (async (): Promise<DwEditResult> => {
      try {
        if (this.host.editable) {
          if (!(await this.host.editable.settle()) || !this.active()) return 'rejected'
          choice = this.selected()
          const value = choice ? choice.value : this.read()
          if ((!this.textWritten && this.read() === this.originalText) || sameChoiceValue(value, this.host.editable.value())) {
            await guard()
            if (!keepOpen) {
              this.cancel()
              this.host.close(focused)
            }
            return 'accepted'
          }
          this.value = value
          if (!this.draftChoice && this.host.editable.limit && this.read().length > this.host.editable.limit) {
            this.element.setAttribute('aria-invalid', 'true')
            this.host.status(`Use at most ${this.host.editable.limit} characters. The entry was not applied.`)
            return 'rejected'
          }
        }
        await guard()
        const result = await this.host.commit(this.host.editable ? this.value : choice!.value, guard)
        if (!this.active()) return 'rejected'
        if (result === 'rejected') {
          this.element.setAttribute('aria-invalid', 'true')
          this.host.status('The choice was not accepted. Choose another value or press Escape to cancel.')
          return 'rejected'
        }
        if (keepOpen && (this.host.radio || this.host.showList) && result === 'accepted') {
          this.original = this.host.editable ? this.host.editable.value() : choice!.value
          if (this.host.editable) {
            this.value = this.original
            this.textWritten = false
            this.draftChoice = null
            this.populate()
          }
          this.element.removeAttribute('aria-invalid')
          this.host.status('Choose a value. Tab accepts and moves on.')
        }
        else {
          this.cancel()
          this.host.close(focused)
        }
        return result
      } catch (error) {
        if (this.active()) {
          this.element.setAttribute('aria-invalid', 'true')
          this.host.status('The record or choices changed. Press Escape and reopen the field. The entry was not applied.')
          this.host.error(error)
        }
        return 'rejected'
      } finally {
        this.accepting = null
        this.element.disabled = false
        if (this.host.editable && this.element instanceof HTMLInputElement) this.element.readOnly = false
        if (this.popup) this.popup.button.disabled = false
        this.syncBrowse()
        if (this.active() && focused && document.activeElement === document.body && this.element.isConnected) {
          this.element.focus({ preventScroll: true })
        }
        if (this.host.showList && this.active() && this.ownsFocus()) this.popup?.show()
      }
    })()
    this.accepting = {
      accepted: work.then((result) => result === 'accepted'),
      navigation: work.then((result) => result === 'accepted' || result === 'discarded'),
    }
    this.syncBrowse()
    return navigation ? this.accepting.navigation : this.accepting.accepted
  }

  private listKey(event: KeyboardEvent): void {
    const plain = !event.ctrlKey && !event.metaKey && !event.altKey
    const details = this.host.details && !event.ctrlKey && !event.metaKey && !event.shiftKey &&
      (event.key === 'F4' && !event.altKey || event.altKey && event.key === 'ArrowDown')
    const toggle = !this.host.showList && !event.ctrlKey && !event.metaKey && !event.shiftKey &&
      (event.key === 'F4' && !event.altKey || event.altKey && ['ArrowDown', 'ArrowUp'].includes(event.key))
    const handledKey = plain && (['ArrowDown', 'ArrowUp', 'Home', 'End', 'PageDown', 'PageUp', 'Enter', 'Tab', 'Escape'].includes(event.key) || event.key.length === 1)
    if (handledKey || details || toggle) { event.preventDefault(); event.stopImmediatePropagation() }
    this.keys = this.keys.then(async () => {
      if (!this.active() || this.accepting) return
      if (plain && event.key === 'Escape') {
        if (!this.host.showList && this.popup?.open) this.popup.close()
        else { this.cancel(); this.host.close() }
        return
      }
      if (plain && event.key === 'Enter' && this.failed) { this.loadingWork = this.load(true); return }
      if (this.loading || this.failed) {
        this.host.status(this.loading ? 'Wait for the choices to load.' : 'Press Enter to retry loading the choices, or Escape to cancel.')
        return
      }
      if (details) {
        await this.showDetails()
        return
      }
      if (await this.host.key?.(event) || !this.active()) return
      if (toggle) {
        if (event.key === 'ArrowUp' || event.key === 'F4' && this.popup?.open) this.popup?.close()
        else this.popup?.show()
        return
      }
      if (!plain) return
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') this.popup?.move(event.key === 'ArrowUp' ? -1 : 1)
      else if (event.key === 'Home' || event.key === 'End') this.popup?.moveTo(event.key === 'Home' ? 0 : (this.choices?.items.length ?? 0) - 1)
      else if (event.key === 'PageDown' || event.key === 'PageUp') this.popup?.page(event.key === 'PageUp' ? -1 : 1)
      else if ((event.key === 'Enter' || event.key === ' ') && this.popup?.open && this.popup.index >= 0) await this.choose(this.popup.index)
      else if (event.key === ' ') this.popup?.show()
      else if (event.key === 'Tab' || event.key === 'Enter') {
        if (await this.accept(true)) await this.host.next(event.shiftKey && event.key === 'Tab' ? -1 : 1)
      } else if (event.key.length === 1) this.popup?.search(event.key)
    }).catch((error) => { this.host.error(error); this.host.status('The choice key action failed. Review the selection before continuing.') })
  }

  private editableKey(event: KeyboardEvent): void {
    if (this.composing) return
    const plain = !event.ctrlKey && !event.metaKey && !event.shiftKey
    const pageKey = plain && !event.altKey && ['PageDown', 'PageUp'].includes(event.key)
    const popupKey = pageKey || plain && (['ArrowDown', 'ArrowUp'].includes(event.key) || event.key === 'F4' && !event.altKey)
    if (popupKey || ['Enter', 'Tab', 'Escape'].includes(event.key)) {
      event.preventDefault()
      event.stopImmediatePropagation()
    }
    this.keys = this.keys.then(async () => {
      if (!this.active() || this.accepting) return
      if (event.key === 'Escape') {
        if (this.popup?.open) this.popup.close()
        else { this.cancel(); this.host.close() }
        return
      }
      if (event.key === 'Enter' && this.failed) { this.loadingWork = this.load(true); return }
      if (!(await this.host.editable!.settle()) || !this.active()) return
      const previous = this.host.editable!.value()
      const handled = await this.host.editable!.key(event)
      if (!this.active()) return
      if (!sameChoiceValue(previous, this.host.editable!.value())) {
        this.syncValue()
      }
      if (handled) return
      if (popupKey) {
        if (pageKey) this.popup?.page(event.key === 'PageUp' ? -1 : 1)
        else if (event.altKey && event.key === 'ArrowUp' || event.key === 'F4' && this.popup?.open) this.popup?.close()
        else if (event.key === 'F4' || event.altKey) this.popup?.show()
        else this.popup?.move(event.key === 'ArrowUp' ? -1 : 1)
      } else if (event.key === 'Enter' && this.popup?.open && this.popup.index >= 0) {
        await this.choose(this.popup.index)
      } else if (event.key === 'Tab' || event.key === 'Enter') {
        if (await this.accept(true)) {
          if (event.key === 'Enter') await this.host.editable!.enter()
          else await this.host.next(event.shiftKey ? -1 : 1)
        }
      }
    }).catch((error) => { this.host.error(error); this.host.status('The field key action failed. Review the entry before continuing.') })
  }
}
