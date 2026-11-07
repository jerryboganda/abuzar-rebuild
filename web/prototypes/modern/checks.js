// Browser-only, deterministic interaction checks for the isolated prototype.
export async function runPrototypeChecks() {
  document.querySelector('#prototype-check-frame')?.remove()
  const frame = document.createElement('iframe')
  frame.title = 'Prototype verification viewport'
  frame.id = 'prototype-check-frame'
  frame.style.cssText = 'position:fixed;left:0;top:0;width:1366px;height:900px;border:0;z-index:100'
  const loaded = new Promise((resolve) => frame.addEventListener('load', resolve, { once: true }))
  frame.src = './index.html'
  document.body.append(frame)
  await loaded
  const w = frame.contentWindow
  const d = frame.contentDocument
  const failures = []
  let passed = 0
  const check = (condition, name) => { if (condition) passed++; else failures.push(name) }
  const q = (selector) => d.querySelector(selector)
  const change = (selector, value, type = 'change') => {
    const element = q(selector)
    element.value = value
    element.dispatchEvent(new w.Event(type, { bubbles: true }))
  }
  const click = (selector) => q(selector).click()
  const settle = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  const exceptions = []
  w.addEventListener('error', (e) => exceptions.push(e.message))
  w.addEventListener('unhandledrejection', (e) => exceptions.push(String(e.reason)))
  await settle()
  check(q('[data-total="sale"]').textContent === '730.00', 'Initial sale total')
  check(q('[data-total="purchase"]').textContent === '1,520.00', 'Initial purchase total')
  q('#tab-sale').focus()
  q('#tab-sale').dispatchEvent(new w.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
  check(!q('#page-purchase').hidden && d.activeElement === q('#tab-purchase'), 'Arrow key activates and focuses next tab')
  q('#tab-purchase').dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Home', bubbles: true }))
  check(!q('#page-sale').hidden && d.activeElement === q('#tab-sale'), 'Home returns to first tab')
  change('#nav-search', 'cash', 'input')
  check(!q('#module-nav [data-open="sale"]').hidden && q('#module-nav [data-open="purchase"]').hidden, 'Module search includes workspace titles')
  change('#nav-search', 'no-such-workspace', 'input')
  check(!q('#nav-empty').hidden, 'Module search empty state')
  change('#nav-search', '', 'input')
  const qty = q('#sale-table input')
  const qtyId = qty.id
  qty.focus()
  change(`#${qtyId}`, '4', 'input')
  check(q('[data-total="sale"]').textContent === '980.00', 'Quantity updates total')
  check(d.activeElement === qty, 'Editing preserves active element')
  click('[data-open="purchase"]')
  click('[data-open="sale"]')
  check(q(`#${qtyId}`).value === '4', 'Tab switches preserve unsaved input')
  click('[data-picker="sale"]')
  check(q('#picker').open && d.activeElement === q('#picker-search'), 'Picker opens with search focus')
  change('#picker-search', 'gauze', 'input')
  check(q('#picker-items').children.length === 1, 'Picker search filters')
  click('.picker-item')
  check(q('#sale-count').textContent === '4' && !q('#picker').open, 'Picker adds and closes')
  click('#sale-table tbody tr:last-child .remove-row')
  check(q('#sale-count').textContent === '3', 'Remove updates item count')
  change(`#${qtyId}`, '0', 'input')
  click('#preview-save')
  check(!q('#sale-errors').hidden && d.activeElement === q('#sale-errors'), 'Invalid form focuses error summary')
  check(!q('#message').open, 'Invalid form does not show success')
  check(q(`#${qtyId}`).getAttribute('aria-describedby') === `error-${qtyId}`, 'Invalid field references its error')
  click('#sale-errors a')
  check(d.activeElement === q(`#${qtyId}`), 'Error link returns focus to field')
  change(`#${qtyId}`, '2', 'input')
  check(q('#sale-errors').hidden && !q(`#${qtyId}`).hasAttribute('aria-describedby'), 'Correcting errors clears stale feedback')
  click('#preview-save')
  check(q('#message').open && q('#message-text').textContent.includes('No invoice has been saved'), 'Save clearly remains prototype-only')
  q('#message').close()
  click('[data-open="inventory"]')
  change('#item-filter', 'gauze', 'input')
  check(q('#inventory-table tbody').children.length === 1, 'Inventory search')
  click('#inventory-table .text-button')
  check(q('#item-title').textContent === 'Sample gauze pack', 'Item detail selection')
  click('[data-open="accounts"]')
  change('#account-filter', 'Cash')
  check(q('#ledger-table tbody').children.length === 2 && q('#ledger-debit').textContent === '980.00', 'Ledger filters and totals')
  click('[data-preview="ledger"]')
  check(q('#paper-title').textContent === 'Account ledger' && q('#paper-table tbody').children.length === 2, 'Ledger preview retains filtered rows')
  click('[data-open="reports"]')
  check(q('#report-title').textContent === 'Account ledger', 'Report details track preview selection')
  change('#report-filter', 'purchase', 'input')
  check(q('#report-list').children.length === 1, 'Report search')
  click('.report-choice')
  click('#preview-report')
  check(q('#paper-title').textContent === 'Purchase summary', 'Selected report opens document preview')
  check(q('#paper-total').textContent === '1,520.00', 'Purchase report uses the purchase fixture')
  click('[data-open="sale"]')
  click('[data-preview="invoice"]')
  check(q('#paper-title').textContent === 'Sale invoice', 'Sale preview opens invoice after report preview')
  change('#print-layout', 'classic')
  check(q('#paper').hidden && !q('#classic-print-message').hidden, 'Classic print is not imitated')
  click('#return-modern-print')
  change('#paper-size', 'receipt58')
  check(q('#paper').classList.contains('narrow'), 'Receipt format preview')
  click('[data-open="settings"]')
  change('#interface-mode', 'classic')
  check(q('#mode-notice').textContent.includes('next sign-in') && !q('#page-settings').hidden, 'Mode preference does not replace active workspace')
  change('#density', 'comfortable')
  check(d.documentElement.dataset.density === 'comfortable', 'Comfortable density')

  const luminance = (hex) => {
    const channels = hex.trim().replace('#', '').match(/.{2}/g).map((s) => parseInt(s, 16) / 255)
      .map((n) => n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4)
    return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722
  }
  const contrasts = []
  for (const theme of ['light', 'dark']) {
    change('#theme', theme)
    const css = w.getComputedStyle(d.documentElement)
    for (const [front, back, minimum] of [
      ['--text', '--surface', 4.5], ['--muted', '--surface', 4.5],
      ['--muted', '--rail', 4.5], ['--on-accent', '--accent', 4.5],
      ['--selected-text', '--selected', 4.5], ['--input-border', '--surface', 3],
      ['--danger', '--danger-bg', 4.5],
    ]) {
      const a = luminance(css.getPropertyValue(front))
      const b = luminance(css.getPropertyValue(back))
      const ratio = (Math.max(a, b) + .05) / (Math.min(a, b) + .05)
      contrasts.push({ theme, front, back, ratio: Number(ratio.toFixed(2)), minimum })
      check(ratio >= minimum, `${theme}: ${front}/${back} contrast`)
    }
  }
  const layouts = []
  for (const [width, text] of [[1366, 100], [1920, 100], [683, 100], [320, 100], [1366, 200]]) {
    frame.style.width = `${width}px`
    change('#text-size', String(text), 'input')
    for (const id of ['sale', 'purchase', 'inventory', 'accounts', 'reports', 'documents', 'settings']) {
      click(`[data-open="${id}"]`)
      await settle()
      const overflow = d.documentElement.scrollWidth > d.documentElement.clientWidth + 1
      layouts.push({ width, text, page: id, overflow })
      check(!overflow, `${id}: whole-page overflow at ${width}px/text ${text}%`)
      const unlabeled = [...q(`#page-${id}`).querySelectorAll('input,select,textarea,button')].filter((el) =>
        !el.closest('[hidden]') && !el.getAttribute('aria-label') && !el.getAttribute('aria-labelledby')
        && !el.labels?.length && !el.textContent.trim())
      check(!unlabeled.length, `${id}: controls have accessible names`)
    }
  }
  frame.style.width = '1366px'
  change('#text-size', '100', 'input')
  change('#density', 'compact')
  change('#theme', 'light')
  change('#document-kind', 'invoice')
  change('#paper-size', 'a4')
  click('[data-open="sale"]')
  await settle()
  check(exceptions.length === 0, 'No uncaught errors during interaction checks')
  return { passed, failures, exceptions, contrasts, layouts, previewFrame: '#prototype-check-frame' }
}
