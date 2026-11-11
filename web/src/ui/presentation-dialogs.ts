import { messageButtons } from './message-buttons.ts'

let nextDialog = 0

export interface PresentationDialog<T> {
  element: HTMLDialogElement
  result: Promise<T>
  restoreFocus?: boolean
  open(): void
}

export function containDialogFocus(element: HTMLDialogElement): void {
  const resize = new ResizeObserver(() => {
    const focus = document.activeElement
    if (element.open && focus instanceof HTMLElement && element.contains(focus)) {
      focus.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    }
  })
  element.addEventListener('focusin', () => { if (element.open) resize.observe(element) })
  element.addEventListener('close', () => { if (!element.open) resize.disconnect() })
  element.addEventListener('keydown', (event) => {
    if (event.defaultPrevented || event.key !== 'Tab' || event.altKey || event.ctrlKey || event.metaKey) return
    const controls = [...element.querySelectorAll<HTMLElement>('button,input,select,textarea,a[href],[tabindex]')]
      .filter((control) => control.tabIndex >= 0 && !control.matches(':disabled')
        && control.getClientRects().length > 0 && getComputedStyle(control).visibility !== 'hidden')
      .sort((a, b) => {
        const left = a.tabIndex || Infinity
        const right = b.tabIndex || Infinity
        return left === right ? 0 : left - right
      })
    const first = controls[0]
    const last = controls.at(-1)
    if (!first || (event.shiftKey ? document.activeElement === first : document.activeElement === last)) {
      event.preventDefault()
      ;(event.shiftKey ? last : first)?.focus()
    }
  })
}

function base(title: string, text: string) {
  const element = document.createElement('dialog')
  element.className = 'presentation-settings presentation-runtime-dialog'
  const heading = document.createElement('h2')
  heading.id = `runtime-dialog-${++nextDialog}`
  // The title is the script's, empty included (as in Classic and the original); an empty one still gives the dialog a name.
  heading.textContent = title
  if (title.trim()) element.setAttribute('aria-labelledby', heading.id)
  else element.setAttribute('aria-label', 'Message')
  const copy = document.createElement('p')
  copy.className = 'presentation-copy'
  copy.textContent = text
  copy.id = heading.id + '-description'
  element.setAttribute('aria-describedby', copy.id)
  element.append(heading, copy)
  containDialogFocus(element)
  return { element, heading }
}

export function messageDialog(title: string, text: string, icon: string, buttons: string, defaultButton: number): PresentationDialog<number> {
  const { element, heading } = base(title, text)
  const icons: Record<string, { label: string; shape: string }> = {
    'information!': { label: 'Information', shape: '<circle cx="12" cy="12" r="10"/><path d="M12 11v6m0-10v1"/>' },
    'question!': { label: 'Question', shape: '<circle cx="12" cy="12" r="10"/><path d="M9 8a3 3 0 0 1 6 0c0 3-3 2-3 5m0 3v1"/>' },
    'exclamation!': { label: 'Warning', shape: '<path d="M12 2 23 22H1zM12 9v5m0 3v1"/>' },
    'stopsign!': { label: 'Error', shape: '<circle cx="12" cy="12" r="10"/><path d="m8 8 8 8m0-8-8 8"/>' },
  }
  const severity = Object.hasOwn(icons, icon) ? icons[icon] : undefined
  if (severity) {
    const marker = document.createElement('span')
    marker.className = 'presentation-message-icon'
    marker.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${severity.shape}</svg><span class="presentation-visually-hidden">${severity.label}: </span>`
    heading.prepend(marker)
    if (icon === 'stopsign!' || icon === 'exclamation!') element.setAttribute('role', 'alertdialog')
  }
  const list = messageButtons(buttons)
  let resolve!: (value: number) => void
  const result = new Promise<number>((done) => { resolve = done })
  let closed = false
  const finish = (value: number) => {
    if (closed) return
    closed = true
    element.close()
    element.remove()
    resolve(value)
  }
  const footer = document.createElement('footer')
  const controls = list.map(([label, code]) => {
    const button = document.createElement('button')
    button.textContent = label
    button.onclick = () => finish(code)
    footer.append(button)
    return button
  })
  element.append(footer)
  // the default answer is the dialog's primary button in the approved design
  controls[defaultButton >= 1 && defaultButton <= controls.length ? defaultButton - 1 : 0]?.classList.add('ds-primary')
  // Escape answers as the Windows message box does: Cancel, or the only button; otherwise it does nothing.  The browser can close a modal
  // dialog on a repeated Escape even when its cancel event is prevented, so Escape is handled before the browser sees it, and a dialog
  // closed any other way while its script still waits is shown again: a message box never disappears without an answer.
  const escape = () => (list.find(([label]) => label === 'Cancel') ?? (list.length === 1 ? list[0] : undefined))?.[1]
  const focusDefault = () => (controls[defaultButton >= 1 && defaultButton <= controls.length ? defaultButton - 1 : 0])?.focus()
  element.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return
    event.preventDefault()
    const answer = escape()
    if (answer !== undefined) finish(answer)
  })
  element.addEventListener('cancel', (event) => {
    event.preventDefault()
    const answer = escape()
    if (answer !== undefined) finish(answer)
  })
  element.addEventListener('close', () => {
    if (closed || !element.isConnected) return
    element.showModal()
    focusDefault()
  })
  return {
    element, result,
    open: () => { document.body.append(element); element.showModal(); focusDefault() },
  }
}

export function promptDialog(title: string, text: string, initial: string): PresentationDialog<string | null> {
  const { element, heading } = base(title, text)
  const form = document.createElement('form')
  const label = document.createElement('label')
  label.textContent = 'Value'
  const input = document.createElement('input')
  input.value = initial
  input.setAttribute('aria-describedby', heading.id + '-description')
  label.append(input)
  const footer = document.createElement('footer')
  const cancel = document.createElement('button')
  cancel.type = 'button'
  cancel.textContent = 'Cancel'
  const accept = document.createElement('button')
  accept.type = 'submit'
  accept.textContent = 'OK'
  footer.append(cancel, accept)
  form.append(label, footer)
  element.append(form)
  let resolve!: (value: string | null) => void
  const result = new Promise<string | null>((done) => { resolve = done })
  let closed = false
  const finish = (value: string | null) => {
    if (closed) return
    closed = true
    element.close()
    element.remove()
    resolve(value)
  }
  form.onsubmit = (event) => { event.preventDefault(); finish(input.value) }
  cancel.onclick = () => finish(null)
  element.addEventListener('keydown', (event) => { if (event.key === 'Escape') { event.preventDefault(); finish(null) } })
  element.addEventListener('cancel', (event) => { event.preventDefault(); finish(null) })
  // closed any other way while the script still waits: answered as Cancel, never left unanswered
  element.addEventListener('close', () => { if (!closed && element.isConnected) finish(null) })
  return { element, result, open: () => { document.body.append(element); element.showModal(); input.focus(); input.select() } }
}
