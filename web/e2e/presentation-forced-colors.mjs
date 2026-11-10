import { resolve } from 'node:path'
import { writeFile } from 'node:fs/promises'

export async function checkForcedColors(page, output) {
  const cases = [], failures = []
  let passed = 0
  const check = (condition, name) => { if (condition) passed++; else failures.push(name) }
  const rgb = color => color.match(/[\d.]+/g).slice(0, 3).map(Number)
  const contrast = (a, b) => {
    const luminance = color => rgb(color).map(channel => {
      const value = channel / 255
      return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4
    }).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0)
    const first = luminance(a), second = luminance(b)
    return (Math.max(first, second) + .05) / (Math.min(first, second) + .05)
  }
  const settleSurface = () => page.waitForFunction(() => {
    const view = window.presentationSurfacePreview.view
    return !view.scheduled && !view.rendering
  })
  const colors = async (selector, pseudo = null) => {
    if (selector.startsWith('#presentation-surface-preview')) await settleSurface()
    return page.evaluate(({ selector, pseudo }) => {
      const element = document.querySelector(selector)
      if (!element) throw new Error(`Missing high-contrast fixture element: ${selector}`)
      const style = getComputedStyle(element, pseudo)
      return {
        color: style.color, background: style.backgroundColor, image: style.backgroundImage,
        border: style.borderBottomColor, borderStyle: style.borderBottomStyle, borderWidth: style.borderBottomWidth,
        outline: style.outlineColor, outlineWidth: style.outlineWidth, outlineStyle: style.outlineStyle,
        adjust: style.forcedColorAdjust,
      }
    }, { selector, pseudo })
  }
  const paintedText = async (selector, background, foreground) => {
    const bounds = await page.locator(selector).evaluate(element => {
      const range = document.createRange()
      range.selectNodeContents(element)
      const text = range.getBoundingClientRect(), box = element.getBoundingClientRect()
      return { x: text.left - box.left, y: text.top - box.top, width: text.width, height: text.height }
    })
    const image = await page.locator(selector).screenshot()
    return page.evaluate(async ({ bytes, bounds, backplate, foreground }) => {
      const bitmap = await createImageBitmap(new Blob([Uint8Array.from(bytes)], { type: 'image/png' }))
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height), context = canvas.getContext('2d')
      context.drawImage(bitmap, 0, 0)
      const { data } = context.getImageData(0, 0, canvas.width, canvas.height)
      // The painted background is the most frequent colour behind the text: the system Highlight may be translucent
      // (rgba(5, 0, 73, 0.8) in this Chromium), so it is composited and never equals the system colour itself. A forced-colors
      // text backplate would paint that area in Canvas instead.
      let total = 0, ink = 0
      const counts = new Map()
      for (let y = Math.max(0, Math.ceil(bounds.y)); y < Math.min(canvas.height, bounds.y + bounds.height); y++) {
        for (let x = Math.max(0, Math.ceil(bounds.x)); x < Math.min(canvas.width, bounds.x + bounds.width); x++) {
          const at = (y * canvas.width + x) * 4
          total++
          const key = `${data[at]},${data[at + 1]},${data[at + 2]}`
          counts.set(key, (counts.get(key) ?? 0) + 1)
          if (foreground.every((value, index) => data[at + index] === value)) ink++
        }
      }
      bitmap.close()
      const [dominant, fill] = [...counts].sort((a, b) => b[1] - a[1])[0] ?? ['', 0]
      const channels = dominant.split(',').map(Number)
      const luminance = (rgb) => rgb.map((value) => value / 255).map((value) => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4)
        .reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0)
      const a = luminance(channels), b = luminance(foreground)
      return { total, fill, ink, dominant, backplate: backplate.every((value, index) => value === channels[index]),
        contrast: (Math.max(a, b) + .05) / (Math.min(a, b) + .05) }
    }, { bytes: [...image], bounds, backplate: rgb(background), foreground: rgb(foreground) })
  }
  // legible glyphs on the selection colour: a dominant background that is not the Canvas backplate, glyphs in the system text
  // colour, and contrast between them
  const legible = (paint) => paint.fill > paint.total * .15 && paint.ink > paint.total * .01 && !paint.backplate && paint.contrast >= 4.5
  try {
    for (const scheme of ['light', 'dark']) for (const [width, scale] of [[1366, 100], [320, 200]]) {
      const theme = scheme === 'light' ? 'dark' : 'light'
      const label = `${scheme} system colors, ${width}px/${scale}%`
      await page.setViewportSize({ width, height: 768 })
      await page.emulateMedia({ forcedColors: 'active', colorScheme: scheme })
      const system = await page.evaluate(() => {
        const probe = document.createElement('span')
        probe.style.cssText = 'position:fixed;visibility:hidden;forced-color-adjust:none'
        document.body.append(probe)
        const colors = {}
        for (const name of ['Canvas', 'CanvasText', 'Highlight', 'HighlightText', 'GrayText', 'ButtonFace', 'ButtonText']) {
          probe.style.color = name
          colors[name] = getComputedStyle(probe).color
        }
        probe.remove()
        return colors
      })
      check(await page.evaluate(() => matchMedia('(forced-colors:active)').matches), `${label}: forced colors are active`)
      const tab = await colors('.presentation-tab > [aria-selected=true]')
      check(tab.outline === system.Highlight && parseFloat(tab.outlineWidth) >= 2 && tab.outlineStyle !== 'none',
        `${label}: selected workspace tab remains identifiable without its box shadow`)
      await page.evaluate(async ({ theme, width, scale }) => {
        await window.previewPresentationSurface({ name: 'd_agingintervallist', theme, density: 'comfortable', scale, width: Math.min(720, width - 32) })
        const f = window.presentationSurfacePreview
        f.model.rowAt(2).sel = true
        await f.view.render()
      }, { theme, width, scale })
      const grid = '#presentation-surface-preview'
      await page.locator(`${grid} .row[data-row="1"] [data-obj=code]`).focus()
      const selected = await colors(`${grid} .row.sel [data-obj=name]`)
      const current = await colors(`${grid} .row.cur [data-obj=name]`)
      check(selected.background === system.Highlight && selected.color === system.HighlightText,
        `${label}: selected grid cells use the system selection pair`)
      check(current.outline === system.Highlight && current.outlineStyle === 'dashed' && parseFloat(current.outlineWidth) >= 1,
        `${label}: an unselected current row has a non-color-only marker`)
      await page.locator(`${grid} .row[data-row="2"] [data-obj=name]`).focus()
      const selectedFocus = await colors(`${grid} .row.sel [data-obj=name]`)
      check(selectedFocus.outline === system.HighlightText && parseFloat(selectedFocus.outlineWidth) >= 2,
        `${label}: selected-cell focus contrasts with its system highlight`)
      check(await page.evaluate(() => window.presentationSurfacePreview.model.getItem(2, 'name') === 'Synthetic name 2'),
        `${label}: focus and palette changes do not edit the selected record`)
      const paint = await paintedText(`${grid} .row.sel [data-obj=name]`, system.Canvas, system.HighlightText)
      check(legible(paint),
        `${label}: selected text paints legible glyphs rather than a solid text backplate`)
      await page.screenshot({ path: resolve(output, `forced-colors-grid-${scheme}-${width}.png`) })

      await page.evaluate(async ({ theme, width, scale }) => {
        await window.previewPresentationSurface({ name: 'd_customer_category', theme, density: 'comfortable', scale, width: Math.min(720, width - 32) })
        const f = window.presentationSurfacePreview
        f.model.setItem(1, 'allowincashsale', 'Y')
        f.model.setItem(1, 'allowincreditsale', null)
        f.model.rowAt(1).sel = true
        await f.view.render()
      }, { theme, width, scale })
      const checked = await colors(`${grid} .cbx.on`), tick = await colors(`${grid} .cbx.on`, '::after')
      const mixed = await colors(`${grid} .cbx.mixed`), dash = await colors(`${grid} .cbx.mixed`, '::after')
      check(checked.background === system.Highlight && tick.border === system.HighlightText && parseFloat(tick.borderWidth) >= 2,
        `${label}: checked marker keeps a contrasting system-color tick`)
      check(dash.background === system.CanvasText && mixed.background === system.Canvas && dash.background !== mixed.background,
        `${label}: indeterminate marker remains visible on its canvas`)
      await page.locator(`${grid} .cbx.mixed`).scrollIntoViewIfNeeded()
      await page.screenshot({ path: resolve(output, `forced-colors-checkbox-${scheme}-${width}.png`) })
      await page.locator(`${grid} [data-obj=allowincashsale]`).click()
      await settleSurface()
      check(await page.evaluate(() => window.presentationSurfacePreview.model.getItem(1, 'allowincashsale') === 'N'),
        `${label}: a real pointer click changes the checkbox key once`)
      await page.locator(`${grid} [data-obj=allowincashsale]`).press('F2')
      await page.locator(`${grid} input[type=checkbox]`).waitFor()
      const checkboxFocus = await colors(`${grid} input[type=checkbox]`)
      check(checkboxFocus.outline === system.Highlight && parseFloat(checkboxFocus.outlineWidth) >= 2,
        `${label}: active native checkbox retains a visible focus ring`)
      check(await page.evaluate(() => window.presentationSurfacePreview.model.getItem(1, 'allowincashsale') === 'N'),
        `${label}: F2 focuses the checkbox without changing its key`)
      await page.keyboard.press('Space')
      await page.waitForFunction(() => !window.presentationSurfacePreview.view.editor)
      check(await page.evaluate(() => window.presentationSurfacePreview.model.getItem(1, 'allowincashsale') === 'Y'),
        `${label}: a real Space key changes the checkbox key once`)
      await page.locator(`${grid} [data-obj=name]`).click()
      const editor = page.locator(`${grid} .surface-editor:not([type=checkbox])`)
      await page.evaluate(() => window.presentationSurfacePreview.view.ctl.validateRules.set('name', 'len(gettext()) >= 40'))
      await editor.fill('High contrast unapplied draft')
      await editor.press('Tab')
      await page.locator('.presentation-runtime-dialog[open]').filter({ hasText: 'Validation Error' })
        .getByRole('button', { name: 'OK', exact: true }).click()
      await page.waitForFunction(() => window.presentationSurfacePreview.view.editor?.getAttribute('aria-invalid') === 'true' &&
        !window.presentationSurfacePreview.view.pendingEdits.size)
      const invalid = await colors(`${grid} .surface-editor:not([type=checkbox])`)
      const required = await colors(`${grid} .surface-required`)
      check(required.color === system.CanvasText && await editor.getAttribute('aria-required') === 'true',
        `${label}: source-required guidance and editor semantics survive the system palette`)
      check(await page.locator(`${grid} .surface-required`).evaluate(hint => {
        const bounds = hint.getBoundingClientRect()
        return hint.textContent === 'Required' && bounds.width > 0 && bounds.height > 0 &&
          bounds.left >= 0 && bounds.right <= innerWidth
      }), `${label}: required guidance fits the viewport through enlarged text`)
      check(invalid.adjust === 'auto' && invalid.color === system.CanvasText && invalid.background === system.Canvas,
        `${label}: active editors inside selected rows keep native system colors`)
      check(invalid.borderStyle === 'dashed' && invalid.border === system.CanvasText,
        `${label}: invalid field has a visible border pattern without relying on red`)
      check(await page.evaluate(() => window.presentationSurfacePreview.model.getItem(1, 'name') === 'Synthetic name 1'),
        `${label}: rejected validation leaves the stored record unchanged`)
      const draft = await editor.inputValue()
      await page.emulateMedia({ forcedColors: 'none' })
      check(await editor.inputValue() === draft && await editor.evaluate(input => document.activeElement === input),
        `${label}: leaving forced colors retains the exact draft and focus`)
      const normalInvalid = await colors(`${grid} .surface-editor:not([type=checkbox])`)
      check(normalInvalid.borderStyle === 'solid' && normalInvalid.border !== system.CanvasText,
        `${label}: ordinary themed validation styling returns when forced colors end`)
      await page.emulateMedia({ forcedColors: 'active' })
      check(await editor.inputValue() === draft && await editor.evaluate(input => document.activeElement === input),
        `${label}: entering forced colors retains the exact draft and focus`)
      await page.screenshot({ path: resolve(output, `forced-colors-form-${scheme}-${width}.png`) })
      await page.evaluate(() => window.presentationSurfacePreview.dispose())

      await page.evaluate(async ({ theme, width, scale }) => {
        await window.previewPresentationSurface({ name: 'd_arg_top_n_customers', theme, density: 'comfortable', scale, width: Math.min(720, width - 32) })
        const f = window.presentationSurfacePreview
        f.model.rowAt(1).sel = true
        await f.view.render()
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      }, { theme, width, scale })
      const suffix = await colors(`${grid} .surface-suffix`)
      const suffixPaint = await paintedText(`${grid} .surface-suffix`, system.Canvas, system.HighlightText)
      check(suffix.color === system.HighlightText && legible(suffixPaint),
      `${label}: selected field suffix retains legible system-colored glyphs without a text backplate`)
      check(await page.locator(`${grid} .surface-suffix`).evaluate(element => {
        const bounds = element.getBoundingClientRect()
        const field = element.closest('.surface-field').querySelector('.surface-value')
        return bounds.left >= 0 && bounds.right <= innerWidth &&
          field.getAttribute('aria-describedby').split(' ').includes(element.id)
      }), `${label}: enlarged source suffix remains in view and describes its field`)
      await page.screenshot({ path: resolve(output, `forced-colors-suffix-${scheme}-${width}.png`) })
      await page.evaluate(() => window.presentationSurfacePreview.dispose())

      await page.evaluate(async ({ theme, scale }) => {
        await window.openPresentationCalculatorPreview('w_discountcalculator')
        window.forcedColorCalculator = window.presentationCalculatorPreview
        const f = window.forcedColorCalculator
        for (const root of [f.view.el, f.dw.root]) {
          root.dataset.theme = theme
          root.style.setProperty('--p-scale', String(scale / 100))
        }
        await f.dw.render()
      }, { theme, scale })
      await page.waitForFunction(() => !window.forcedColorCalculator.dw.scheduled && !window.forcedColorCalculator.dw.rendering)
      const radio = await colors('.modern-window .dw-radio-marker.on')
      const radioDot = await colors('.modern-window .dw-radio-marker.on', '::after')
      check(radio.border === system.CanvasText && radioDot.border === system.CanvasText && parseFloat(radioDot.borderWidth) > 0,
        `${label}: readonly radio marker and selected dot remain visible`)
      const windowPrimary = await colors('.modern-window .window-actions button.default')
      check(windowPrimary.border === system.Highlight && parseFloat(windowPrimary.borderWidth) >= 2,
        `${label}: original default window action retains system-color emphasis`)
      await page.locator('.modern-window [data-obj=type] [data-radio-choice="0"]').click()
      await page.waitForFunction(() => window.forcedColorCalculator.model.getItem(1, 'type') === 'F')
      await page.keyboard.press('ArrowRight')
      await page.waitForFunction(() => window.forcedColorCalculator.model.getItem(1, 'type') === 'D' &&
        document.activeElement instanceof HTMLInputElement && document.activeElement.type === 'radio' && document.activeElement.checked)
      const radioFocus = await colors('.modern-window input[type=radio]:checked')
      check(radioFocus.outline === system.Highlight && parseFloat(radioFocus.outlineWidth) >= 2,
        `${label}: keyboard radio changes retain original keys and visible native focus`)
      await page.screenshot({ path: resolve(output, `forced-colors-radio-${scheme}-${width}.png`) })
      await page.evaluate(async () => { await window.forcedColorCalculator.close(); window.forcedColorCalculator = null })

      await page.getByRole('button', { name: 'Appearance', exact: true }).click()
      const settingsPrimary = await colors('.presentation-settings button[type=submit]')
      check(settingsPrimary.border === system.Highlight && parseFloat(settingsPrimary.borderWidth) >= 2,
        `${label}: primary settings action retains a visible emphasis without its custom fill`)
      await page.keyboard.press('Escape')

      await page.evaluate(async ({ theme, scale, width }) => {
        const { DwChoicePopup } = await import('./src/ui/dw-choice-popup.js')
        const host = document.createElement('div')
        host.id = 'forced-color-popup'
        host.className = 'modern-surface'
        host.dataset.theme = theme
        host.style.cssText = `position:fixed;left:16px;top:16px;width:${Math.min(600, width - 32)}px;height:3em;z-index:2147483000;--p-scale:${scale / 100}`
        const input = document.createElement('input')
        input.className = 'surface-editor'
        input.setAttribute('aria-label', 'Synthetic high-contrast choices')
        input.value = 'Unapplied synthetic draft'
        host.append(input)
        document.body.append(host)
        const controller = new AbortController(), selected = []
        const items = Array.from({ length: 101 }, (_, index) => ({ value: `KEY:${index}`, text: `Synthetic choice ${index}` }))
        const popup = new DwChoicePopup(input, () => ({ items, current: () => 0, validate: () => {} }),
          index => { selected.push(items[index].value); popup.close() }, controller.signal, false, 100, 7)
        window.forcedColorPopup = { host, input, controller, selected }
        popup.mount()
        input.focus()
        popup.show()
        popup.moveTo(100)
      }, { theme, scale, width })
      const popupOption = await colors('#forced-color-popup [aria-selected=true]')
      check(popupOption.background === system.Highlight && popupOption.color === system.HighlightText &&
        popupOption.outline === system.HighlightText,
      `${label}: virtual popup selection uses the system text, fill and focus colors`)
      await page.locator('#forced-color-popup [aria-selected=true]').click()
      check(await page.evaluate(() => {
        const f = window.forcedColorPopup
        return f.selected.length === 1 && f.selected[0] === 'KEY:100' &&
          f.input.value === 'Unapplied synthetic draft' && document.activeElement === f.input
      }), `${label}: pointer selection retains the original distant key and input focus`)
      await page.evaluate(() => { window.forcedColorPopup.controller.abort(); window.forcedColorPopup.host.remove() })

      await page.evaluate(async ({ theme, scale }) => {
        const { lookupDialog } = await import('./src/ui/dw-lookup-dialog.js')
        const controller = new AbortController()
        const items = [{ value: 1, text: 'First synthetic record' }, { value: 2, text: 'Second synthetic record' }]
        const choices = {
          items, validate: choice => { if (!items.includes(choice)) throw new Error('Unknown synthetic choice') },
          grid: {
            title: 'Synthetic high-contrast lookup', columns: [{ label: 'Code', numeric: true }, { label: 'Name', numeric: false }],
            matches: (index, query) => items[index].text.toLowerCase().includes(query),
            read: async index => [String(items[index].value), items[index].text],
          },
        }
        const errors = []
        const dialog = lookupDialog(choices, 0, controller.signal, error => errors.push(String(error)))
        dialog.element.dataset.theme = theme
        dialog.element.style.setProperty('--p-scale', String(scale / 100))
        window.forcedColorLookup = { dialog, controller, errors }
        dialog.open()
      }, { theme, scale })
      const lookup = '.presentation-lookup'
      await page.locator(`${lookup} [role=grid][aria-busy=false]`).waitFor()
      await page.locator(`${lookup} tr[aria-selected=true] td`).first().focus()
      const lookupRow = await colors(`${lookup} tr[aria-selected=true]`)
      const lookupText = await colors(`${lookup} tr[aria-selected=true] td > span`)
      const lookupFocus = await colors(`${lookup} tr[aria-selected=true] td`)
      check(lookupRow.background === system.Highlight && lookupText.color === system.HighlightText,
        `${label}: lookup row text and background use the same system selection pair`)
      check(lookupFocus.outline === system.HighlightText && parseFloat(lookupFocus.outlineWidth) >= 2,
        `${label}: focused lookup cell remains distinct inside its selected row`)
      const disabled = await colors(`${lookup} button:disabled`), primary = await colors(`${lookup} .lookup-select`)
      check(disabled.color === system.GrayText, `${label}: unavailable lookup paging uses the system disabled text color`)
      check(primary.border === system.Highlight && parseFloat(primary.borderWidth) >= 2,
        `${label}: primary lookup action retains a visible emphasis without its custom fill`)
      await page.keyboard.press('ArrowDown')
      check(await page.locator(`${lookup} tr[aria-selected=true]`).getAttribute('data-choice') === '1',
        `${label}: system colors do not change keyboard row selection`)
      const lookupPaint = await paintedText(`${lookup} tr[aria-selected=true] td:first-child > span`, system.Canvas, system.HighlightText)
      check(legible(lookupPaint),
        `${label}: selected lookup text paints legible glyphs rather than a solid backplate`)
      await page.screenshot({ path: resolve(output, `forced-colors-lookup-${scheme}-${width}.png`) })
      await page.keyboard.press('Enter')
      check(await page.evaluate(async () => await window.forcedColorLookup.dialog.result === 1 && !window.forcedColorLookup.errors.length),
        `${label}: Enter returns the original selected choice index once`)
      await page.evaluate(() => window.forcedColorLookup.controller.abort())
      const minimumTextContrast = Math.min(contrast(selected.color, selected.background),
        contrast(lookupText.color, lookupRow.background), contrast(popupOption.color, popupOption.background))
      check(minimumTextContrast >= 4.5, `${label}: system-palette selected text meets 4.5:1`)
      cases.push({ scheme, theme, width, scale, system, selected, current, selectedFocus, paint, checked, tick, mixed, dash, checkboxFocus,
        invalid, required, normalInvalid, suffix, suffixPaint, settingsPrimary, windowPrimary, radio, radioDot, radioFocus, popupOption,
        lookupRow, lookupText, lookupFocus, lookupPaint, disabled, primary, minimumTextContrast })
    }
  } finally {
    await page.evaluate(async () => {
      window.presentationSurfacePreview?.dispose()
      window.forcedColorLookup?.controller.abort()
      window.forcedColorPopup?.controller.abort()
      window.forcedColorPopup?.host.remove()
      if (window.forcedColorCalculator) { await window.forcedColorCalculator.close(); window.forcedColorCalculator = null }
    })
    await page.emulateMedia({ forcedColors: 'none', colorScheme: 'light' })
    await page.setViewportSize({ width: 1366, height: 768 })
  }
  const result = { passed, failures, cases }
  await writeFile(resolve(output, 'forced-colors-diagnostics.json'), JSON.stringify(result, null, 2) + '\n')
  return result
}
