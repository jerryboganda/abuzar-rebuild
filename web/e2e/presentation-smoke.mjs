import { chromium } from 'playwright'
import { createServer } from 'node:http'
import { readFile, mkdir, cp, writeFile, rm } from 'node:fs/promises'
import { resolve, dirname, extname, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { once } from 'node:events'
import assert from 'node:assert/strict'
import { gunzipSync } from 'node:zlib'
import { DATA_SURFACES, CRITERIA_DATA_SURFACES, TRANSACTION_DATA_SURFACES, dataSurfaceIssues } from '../src/ui/data-surfaces.ts'
import { ALL_ENTRY_WINDOW_SURFACES } from '../src/ui/surface-registry.ts'
import { buildDerivedFixtures, standardSingle, representativeModalWindows } from './presentation-derived-fixture.mjs'
import { WINDOW_SURFACES, CALCULATOR_WINDOW_SURFACES, CRITERIA_WINDOW_SURFACES, LOOKUP_CRITERIA_WINDOWS, REFERENCE_CRITERIA_WINDOWS, NUMERIC_CRITERIA_WINDOWS, DATE_OPTION_CRITERIA_WINDOWS, DATE_CHOICE_CRITERIA_WINDOWS, ENTRY_WINDOW_SURFACES } from '../src/ui/window-surfaces.ts'
import { parseScriptFile } from '../src/pbscript/parser.ts'
import { checkForcedColors } from './presentation-forced-colors.mjs'
import { createRequire } from 'node:module'
// Automated WCAG 2.2 A/AA rules (axe-core). CI installs it for this job; where it is absent the scan is reported as not run.
const axeSource = await (async () => {
  try { return await readFile(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8') } catch { return null }
})()
const axeCases = []
async function scanAccessibility(page, label, selector) {
  if (!axeSource) return
  if (!(await page.evaluate(() => !!window.axe))) await page.addScriptTag({ content: axeSource })
  const violations = await page.evaluate(async (selector) => {
    const root = document.querySelector(selector)
    if (!root) return null
    const result = await window.axe.run(root, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] }, resultTypes: ['violations'] })
    return result.violations.map((violation) => ({ id: violation.id, impact: violation.impact, nodes: violation.nodes.length, sample: violation.nodes[0]?.target?.join(' ') ?? '' }))
  }, selector)
  if (violations) axeCases.push({ label, violations })
}

const visibleContrast = (form) => form.evaluate((root) => {
  window.__lowestContrast = null
  const rgba = (color) => (color.match(/[\d.]+/g) || []).map(Number)
  const luminance = (color) => rgba(color).slice(0, 3).map((value) => {
    const v = value / 255
    return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4
  }).reduce((total, value, index) => total + value * [.2126, .7152, .0722][index], 0)
  return [...root.querySelectorAll('.ttl,legend,.window-option span,.window-caption,.window-field label .ctl,.entry-control.st,.entry-order span,input,textarea,select,button,.surface-label,.surface-suffix,.surface-group-caption,.surface-help,.surface-required,.surface-value,.surface-band dt,.surface-band [role=textbox],th,.surface-status,.strip .t,.presentation-lookup h2,.presentation-lookup p,.lookup-search,.lookup-details summary,.lookup-details dt,.lookup-details dd,.lookup-grid-wrap td>span,.dw-choice-popup [role=option],.presentation-settings h2,.presentation-settings p,.presentation-settings label,.page [data-obj]')]
    .filter((element) => element.getClientRects().length > 0).map((element) => {
      let ancestor = element
      let background = getComputedStyle(ancestor).backgroundColor
      while (rgba(background)[3] === 0 && ancestor.parentElement) {
        ancestor = ancestor.parentElement
        background = getComputedStyle(ancestor).backgroundColor
      }
      const foreground = luminance(getComputedStyle(element).color), back = luminance(background)
      const ratio = (Math.max(foreground, back) + .05) / (Math.min(foreground, back) + .05)
      // the weakest element, so a failure names what to fix
      if (!window.__lowestContrast || ratio < window.__lowestContrast.ratio) {
        window.__lowestContrast = { ratio, element: `${element.tagName.toLowerCase()}.${[...element.classList].join('.')}`,
          text: (element.textContent || element.value || '').trim().slice(0, 40), color: getComputedStyle(element).color, background }
      }
      return ratio
    })
})
const lowestContrast = (page) => page.evaluate(() => { const lowest = window.__lowestContrast; window.__lowestContrast = null; return JSON.stringify(lowest) })

async function capturePrintSettings(page, output) {
  const cases = []
  const dialog = page.locator('.presentation-settings')
  const open = () => page.getByRole('button', { name: 'Appearance', exact: true }).click()
  await page.setViewportSize({ width: 1366, height: 768 })
  await open()
  const saved = await dialog.locator('select[name=theme],select[name=density],select[name=textSize]').evaluateAll((fields) =>
    fields.map((field) => [field.name, field.value]))
  try {
    for (const [theme, scale, width, height] of [
      ['light', 100, 1366, 768], ['dark', 200, 1366, 768], ['dark', 200, 683, 384],
      ['light', 200, 320, 768], ['dark', 200, 320, 768],
    ]) {
      if (!await dialog.evaluate((element) => element.open)) await open()
      await dialog.locator('[name=theme]').selectOption(theme)
      await dialog.locator('[name=textSize]').selectOption(String(scale))
      await dialog.locator('[name=density]').selectOption('comfortable')
      await dialog.getByRole('button', { name: 'Save settings', exact: true }).click()
      await page.setViewportSize({ width, height })
      await open()
      const familyNames = await dialog.locator('select[name^="printFamily:"]').evaluateAll((fields) => fields.map((field) => field.name))
      await dialog.locator('select[name=printMode]').focus()
      for (const name of familyNames) {
        await page.keyboard.press('Tab')
        assert.equal(await page.evaluate(() => document.activeElement.name), name, 'Document layout keyboard order follows its labels')
        const field = dialog.locator(`select[name="${name}"]`)
        assert.ok(await field.evaluate((element) => {
          const r = element.getBoundingClientRect(), s = getComputedStyle(element)
          return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight &&
            s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) >= 2
        }), `Document layout focus remains visible: ${name}/${theme}/${scale}/${width}`)
      }
      await dialog.locator('select[name="printFamily:sales-invoice"]').focus()
      await page.keyboard.press('End')
      assert.equal(await dialog.locator('select[name="printFamily:sales-invoice"]').inputValue(), 'modern')
      await page.keyboard.press('Home')
      assert.equal(await dialog.locator('select[name="printFamily:sales-invoice"]').inputValue(), '')
      await page.screenshot({ path: resolve(output, `print-settings-${theme}-${scale}-${width}.png`) })
      const layout = await dialog.evaluate((root) => {
        const context = document.createElement('canvas').getContext('2d')
        return {
          fits: root.scrollWidth <= root.clientWidth,
          fields: [...root.querySelectorAll('select[name=printMode],select[name^="printFamily:"]')].map((element) => {
            const s = getComputedStyle(element)
            context.font = s.font
            return { name: element.name, fontSize: parseFloat(s.fontSize),
              longestOptionWidth: Math.max(...[...element.options].map((option) => context.measureText(option.textContent).width)),
              availableWidth: element.clientWidth - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight) - 18 }
          }),
        }
      })
      assert.ok(layout.fits, `Document layout settings do not scroll horizontally: ${theme}/${scale}/${width}`)
      assert.ok(layout.fields.every((field) => field.longestOptionWidth <= field.availableWidth),
        `Document layout selections remain readable: ${JSON.stringify({ theme, scale, width, ...layout })}`)
      assert.ok(layout.fields.every((field) => field.fontSize === 14 * scale / 100))
      const contrast = await visibleContrast(dialog)
      assert.ok(contrast.length && contrast.every((ratio) => ratio >= 4.5), 'Document preference text meets contrast requirements')
      await dialog.locator('select[name="printFamily:item-label"]').focus()
      await page.keyboard.press('End')
      assert.equal(await dialog.locator('select[name="printFamily:item-label"]').inputValue(), 'classic',
        'Keyboard cannot select a blocked Modern label template')
      await page.keyboard.press('Tab')
      assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Cancel')
      await page.keyboard.press('Enter')
      await open()
      assert.equal(await dialog.locator('select[name="printFamily:item-label"]').inputValue(), '',
        'Keyboard cancellation preserves family inheritance')
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
      cases.push({ theme, scale, width, height, minimumTextContrast: Math.min(...contrast), ...layout })
      await page.setViewportSize({ width: 1366, height: 768 })
    }
  } finally {
    await page.setViewportSize({ width: 1366, height: 768 })
    if (!await dialog.evaluate((element) => element.open)) await open()
    for (const [name, value] of saved) await dialog.locator(`select[name="${name}"]`).selectOption(value)
    await dialog.getByRole('button', { name: 'Save settings', exact: true }).click()
  }
  return cases
}

async function capturePrintDocuments(page, output) {
  const cases = []
  await page.setViewportSize({ width: 1366, height: 1200 })
  try {
    for (const presentation of ['classic', 'modern']) {
      await page.evaluate((mode) => window.openPrintDocumentPreview(mode), presentation)
      const pages = page.frameLocator(`iframe[title="Synthetic ${presentation} document preview"]`).locator('.page')
      const count = await pages.count()
      assert.ok(count > 1)
      for (const index of [0, count - 1]) {
        const documentPage = pages.nth(index)
        const geometry = await documentPage.evaluate((root) => {
          const r = root.getBoundingClientRect()
          const footer = root.querySelector('.ftr').getBoundingClientRect()
          return {
            width: r.width, height: r.height, background: getComputedStyle(root).backgroundColor,
            bodyFits: [...root.querySelectorAll('.row,.gtr,.sum')].every((band) =>
              band.getBoundingClientRect().bottom <= footer.top),
          }
        })
        assert.ok(geometry.bodyFits, 'Printed details and totals do not overlap the page footer')
        assert.equal(geometry.background, 'rgb(255, 255, 255)', 'Document paper is white in both print presentations')
        const contrast = await visibleContrast(documentPage)
        assert.ok(contrast.length && contrast.every((ratio) => ratio >= 4.5), 'Synthetic print text remains readable on white paper')
        await documentPage.screenshot({ path: resolve(output, `print-document-${presentation}-${index + 1}.png`) })
        cases.push({ presentation, page: index + 1, totalPages: count, ...geometry, minimumTextContrast: Math.min(...contrast) })
      }
      await page.evaluate(() => window.closePrintDocumentPreview())
    }
  } finally {
    await page.evaluate(() => window.closePrintDocumentPreview())
    await page.setViewportSize({ width: 1366, height: 768 })
  }
  return cases
}

async function openCalendarInput(page, name = 'w_arg_sdate', text) {
  await page.evaluate((name) => window.openCriteriaWindowPreview(name), name)
  const field = page.locator(`.pbwin[data-win="${name}"] input[id$="-em_startdate"]`)
  await field.fill(text ?? (name === 'w_arg_sdate_notime' ? '31/03/2024' : '31/03/2024 21:22:23'))
  await field.press('F4')
  const calendar = page.locator('.modern-calendar-window')
  await calendar.waitFor()
  await page.waitForFunction(() => {
    const root = document.querySelector('.modern-calendar-window')
    return root?.querySelector('[aria-selected=true]') === document.activeElement
  })
  return { calendar, field }
}

async function checkCalendarInput(page) {
  await page.setViewportSize({ width: 1366, height: 768 })
  for (const name of ['w_arg_sdate', 'w_arg_sdate_notime', 'w_arg_sdate_ldate', 'w_arg_ason']) {
    const { calendar, field } = await openCalendarInput(page, name)
    try {
      await page.keyboard.press('PageUp')
      await page.waitForFunction(() => document.querySelector('.modern-calendar-window [aria-selected=true]')
        ?.getAttribute('aria-label')?.includes('February 29, 2024'))
      await page.keyboard.press('Enter')
      await calendar.waitFor({ state: 'detached' })
      assert.equal(await field.inputValue(), name === 'w_arg_sdate_notime' ? '29/02/2024' : '29/02/2024 21:22:23')
      assert.ok(await field.evaluate((element) => element === document.activeElement),
        'Calendar acceptance restores the invoking field')
      await field.press('F4')
      await calendar.waitFor()
      await page.keyboard.press('ArrowRight')
      await page.waitForFunction(() => document.querySelector('.modern-calendar-window [aria-selected=true]')
        ?.getAttribute('aria-label')?.includes('March 1, 2024'))
      await page.keyboard.press('Escape')
      await calendar.waitFor({ state: 'detached' })
      assert.equal(await field.inputValue(), name === 'w_arg_sdate_notime' ? '29/02/2024' : '29/02/2024 21:22:23')
      await field.press('F4')
      await calendar.waitFor()
      await calendar.getByRole('gridcell', { name: 'Wednesday, February 28, 2024', exact: true }).dblclick()
      await calendar.waitFor({ state: 'detached' })
      assert.equal(await field.inputValue(), name === 'w_arg_sdate_notime' ? '28/02/2024' : '28/02/2024 21:22:23',
        'Real double-click reaches the original posted OK once')
    } finally { await page.evaluate(() => window.criteriaWindowPreview.close()) }
  }
  const { calendar, field } = await openCalendarInput(page)
  try {
    await calendar.getByRole('button', { name: 'Choose month: March 2024', exact: true }).click()
    assert.equal(await calendar.getByRole('gridcell').count(), 12)
    await calendar.getByRole('button', { name: 'Choose year: 2024', exact: true }).click()
    await calendar.getByRole('button', { name: 'Next decade', exact: true }).click()
    await calendar.getByRole('gridcell', { name: '2032', exact: true }).click()
    await calendar.getByRole('gridcell', { name: 'February 2032', exact: true }).click()
    assert.equal(await calendar.locator('[aria-selected=true]').getAttribute('aria-label'), 'Sunday, February 29, 2032')
    await page.keyboard.press('Home')
    await page.waitForFunction(() => document.querySelector('.modern-calendar-window [aria-selected=true]')?.textContent === '1')
    await page.keyboard.press('End')
    await page.waitForFunction(() => document.querySelector('.modern-calendar-window [aria-selected=true]')?.textContent === '29')
    await calendar.getByRole('button', { name: /^Today:/ }).click()
    assert.equal(await calendar.locator('[aria-selected=true]').getAttribute('aria-current'), 'date')
    await calendar.getByRole('button', { name: 'Close window', exact: true }).click()
    await calendar.waitFor({ state: 'detached' })
    assert.equal(await field.inputValue(), '31/03/2024 21:22:23')
  } finally { await page.evaluate(() => window.criteriaWindowPreview.close()) }
  const empty = await openCalendarInput(page, 'w_arg_sdate_notime', '')
  try {
    assert.equal(await empty.calendar.locator('[aria-selected=true]').getAttribute('aria-current'), 'date')
    await page.keyboard.press('Enter')
    await empty.calendar.waitFor({ state: 'detached' })
    assert.match(await empty.field.inputValue(), /^\d{2}\/\d{2}\/\d{4}$/)
  } finally { await page.evaluate(() => window.criteriaWindowPreview.close()) }
}

async function openDataWindowCalendarInput(page, owner = 'standard') {
  await page.evaluate((owner) => window.openDataWindowCalendarPreview(owner), owner)
  const field = page.locator('.pbwin[data-win="w_calendar_dw_fixture"] .dw-edit')
  await field.press('F4')
  const calendar = page.locator('.pbwin[data-win="w_calendar2"]')
  await calendar.waitFor()
  await page.waitForFunction(() => document.querySelector('.pbwin[data-win="w_calendar2"] [aria-selected=true]') === document.activeElement)
  return { field, calendar }
}

async function checkDataWindowCalendarInput(page) {
  await page.setViewportSize({ width: 1366, height: 768 })
  for (const owner of ['standard', 'comments']) {
    const { calendar } = await openDataWindowCalendarInput(page, owner)
    try {
      await page.keyboard.press('PageUp')
      await page.waitForFunction(() => document.querySelector('.pbwin[data-win="w_calendar2"] [aria-selected=true]')
        ?.getAttribute('aria-label')?.includes('February 29, 2024'))
      await page.keyboard.press('Enter')
      await calendar.waitFor({ state: 'detached' })
      await page.evaluate(() => window.dataWindowCalendarPreview.finish())
      const value = await page.evaluate(() => {
        const f = window.dataWindowCalendarPreview, value = f.model.getItem(1, 'date')
        return { date: value.n, clock: value.ms, focused: f.dw.root.contains(document.activeElement) }
      })
      assert.deepEqual(value, { date: Date.UTC(2024, 1, 29) / 86400000, clock: (21 * 3600 + 22 * 60 + 23) * 1000 + 125, focused: true })
      await page.keyboard.press('F4')
      await calendar.waitFor()
      await calendar.getByRole('gridcell', { name: 'Wednesday, February 28, 2024', exact: true }).dblclick()
      await calendar.waitFor({ state: 'detached' })
      await page.evaluate(() => window.dataWindowCalendarPreview.finish())
      assert.equal(await page.evaluate(() => window.dataWindowCalendarPreview.model.getItem(1, 'date').n), Date.UTC(2024, 1, 28) / 86400000)
    } finally { await page.evaluate(() => window.dataWindowCalendarPreview.close()) }
  }
}

async function captureCalendars(page, output, dataWindow = false) {
  const cases = []
  for (const [theme, scale, width, height, forced] of [
    ['light', 100, 1366, 768, false], ['dark', 100, 1366, 768, false],
    ['light', 200, 320, 768, false], ['dark', 200, 320, 768, false],
    ['light', 200, 683, 384, false], ['dark', 200, 683, 384, false],
    ['light', 200, 320, 768, true], ['dark', 200, 320, 768, true],
  ]) {
    await page.setViewportSize({ width, height })
    await page.emulateMedia({ forcedColors: forced ? 'active' : 'none', colorScheme: theme })
    const { calendar } = dataWindow ? await openDataWindowCalendarInput(page) : await openCalendarInput(page)
    try {
      await calendar.evaluate((root, { theme, scale }) => {
        root.dataset.theme = theme
        root.dataset.density = 'comfortable'
        root.style.setProperty('--p-scale', String(scale / 100))
      }, { theme, scale })
      await calendar.locator('[aria-selected=true]').focus()
      assert.ok(await calendar.evaluate((root) => {
        const bounds = root.getBoundingClientRect()
        return root.scrollWidth <= root.clientWidth + 1 && bounds.left >= 0 && bounds.right <= innerWidth + .5 &&
          bounds.top >= 0 && bounds.bottom <= innerHeight + .5
      }), 'Calendar reflows without horizontal overflow or viewport clipping')
      const selected = calendar.locator('[aria-selected=true]')
      assert.equal(await selected.evaluate((cell) => parseFloat(getComputedStyle(cell).fontSize)), 14 * scale / 100)
      const cells = await calendar.locator('[role=gridcell]').evaluateAll((cells) => cells.map((cell) => {
        const style = getComputedStyle(cell), canvas = document.createElement('canvas').getContext('2d')
        canvas.font = style.font
        const l = (color) => (color.match(/[\d.]+/g) || []).slice(0, 3).map((value) => {
          const v = Number(value) / 255
          return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4
        }).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0)
        let parent = cell
        let background = getComputedStyle(parent).backgroundColor
        while (background === 'rgba(0, 0, 0, 0)' && parent.parentElement) {
          parent = parent.parentElement
          background = getComputedStyle(parent).backgroundColor
        }
        const foreground = l(style.color), back = l(background)
        return { width: cell.getBoundingClientRect().width, textWidth: canvas.measureText(cell.textContent).width,
          contrast: (Math.max(foreground, back) + .05) / (Math.min(foreground, back) + .05) }
      }))
      assert.ok(cells.every((cell) => cell.textWidth + 4 <= cell.width && cell.contrast >= 4.5),
        `All calendar dates fit and meet contrast: ${JSON.stringify({ theme, scale, width, forced, cells })}`)
      await page.keyboard.press('Tab')
      assert.match(await page.evaluate(() => document.activeElement.textContent), /^Today:/)
      await page.keyboard.press('Tab')
      assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Ok')
      assert.ok(await page.evaluate(() => {
        const r = document.activeElement.getBoundingClientRect()
        return r.top >= 0 && r.bottom <= innerHeight
      }), 'Calendar keyboard actions stay visible at enlarged text and short viewports')
      const minimumTextContrast = Math.min(...cells.map((cell) => cell.contrast), ...await visibleContrast(calendar))
      assert.ok(minimumTextContrast >= 4.5)
      await page.screenshot({ path: resolve(output, `calendar${dataWindow ? '2' : ''}-${theme}-${scale}-${width}${forced ? '-forced' : ''}.png`) })
      cases.push({ theme, scale, width, height, forced, minimumTextContrast })
      await calendar.getByRole('button', { name: 'Cancel', exact: true }).click()
      await calendar.waitFor({ state: 'detached' })
    } finally {
      await page.emulateMedia({ forcedColors: 'none' })
      if (dataWindow) await page.evaluate(() => window.dataWindowCalendarPreview.close())
      else await page.evaluate(() => window.criteriaWindowPreview.close())
    }
  }
  await page.setViewportSize({ width: 1366, height: 768 })
  return cases
}

// One generated response window per distinct layout shape, at the lightest and the harshest appearance.
// With `failures`, appearance failures are recorded and the scan goes on, so one run reports every window.
async function captureDerivedModalWindows(page, output, names = representativeModalWindows(), failures = null) {
  const cases = []
  const expect = (condition, message) => {
    if (condition) return
    if (!failures) assert.fail(message)
    failures.push(message)
  }
  for (const name of names) {
    for (const [theme, scale, width, height] of [['light', 100, 1366, 768], ['dark', 200, 320, 768]]) try {
      await page.setViewportSize({ width, height })
      await page.evaluate(async ({ name, theme, scale }) => {
        await window.openDerivedModalPreview(name)
        const { view } = window.derivedModalPreview
        view.el.dataset.theme = theme; view.el.dataset.density = 'comfortable'
        view.el.style.setProperty('--p-scale', String(scale / 100))
      }, { name, theme, scale })
      const form = page.locator('.presentation-modern-dialog[open]>.modern-window')
      expect(await form.evaluate((root) => {
        const bounds = root.getBoundingClientRect()
        return root.scrollWidth <= root.clientWidth + 1 && bounds.left >= 0 && bounds.right <= innerWidth + .5 &&
          bounds.top >= 0 && bounds.bottom <= innerHeight + .5
      }), `${name}/${width}: generated dialog reflows inside the viewport`)
      for (const control of await form.locator('input:visible:not(:disabled),select:visible:not(:disabled),button:visible:not(:disabled),.surface-value:visible').all()) {
        await control.focus()
        expect(await control.evaluate((element) => {
          const bounds = element.getBoundingClientRect()
          return bounds.left >= 0 && bounds.right <= innerWidth + 1 && bounds.top >= 0 && bounds.bottom <= innerHeight + 1
        }), `${name}/${width}: keyboard focus reveals fields and actions`)
      }
      const contrast = await visibleContrast(form)
      const minimumContrast = contrast.length ? Math.min(...contrast) : 21
      const weakest = await lowestContrast(page)
      expect(minimumContrast >= 4.5, `${name}/${width}: generated dialog text contrast (${minimumContrast}; ${weakest})`)
      cases.push({ name, theme, scale, width, height, minimumContrast })
      await scanAccessibility(page, `${name}/${theme}/${width}`, '.presentation-modern-dialog[open]>.modern-window')
    } catch (error) {
      if (!failures) throw error
      failures.push(`${name}/${theme}/${width}: ${String(error?.message ?? error).split('\n')[0]}`)
    }
  }
  await page.evaluate(() => window.closeDerivedModalPreview())
  return cases
}
async function captureCriteriaWindows(page, output, surfaces = CRITERIA_WINDOW_SURFACES) {
  const cases = []
  for (const surface of surfaces) for (const reveal of surface.options && !surface.lists ? [false, true] : [false]) {
    for (const [theme, scale, width, height] of [
      ['light', 100, 1366, 768], ['dark', 200, 1366, 768], ['dark', 200, 683, 384], ['dark', 200, 320, 768],
    ]) {
      await page.setViewportSize({ width, height })
      await page.evaluate(async ({ name, theme, scale, reveal }) => {
        await window.openCriteriaWindowPreview(name)
        const f = window.criteriaWindowPreview
        f.view.el.dataset.theme = theme; f.view.el.dataset.density = 'comfortable'
        f.view.el.style.setProperty('--p-scale', String(scale / 100))
        if (reveal) {
          for (const option of f.surface.options) f.window.children.get(option.control).pbSet('visible', true)
          const price = f.window.children.get('dw_price')
          await price.ready
          if (!price.model.rowCount()) price.model.insertRow(0)
          price.pbSet('visible', true)
          f.window.children.get('st_3').pbSet('visible', true)
        }
        for (const binding of f.surface.data) {
          const view = f.view.ctlViews.get(f.window.children.get(binding.control)).dw
          view.root.dataset.theme = theme; view.root.dataset.density = 'comfortable'
          view.root.style.setProperty('--p-scale', String(scale / 100))
          await view.render()
        }
      }, { name: surface.name, theme, scale, reveal })
      try {
        const form = page.locator('.presentation-modern-dialog[open]>.modern-window')
        assert.ok(await form.evaluate((root) => {
          const bounds = root.getBoundingClientRect()
          return root.scrollWidth <= root.clientWidth + 1 && bounds.left >= 0 && bounds.right <= innerWidth + .5 &&
            bounds.top >= 0 && bounds.bottom <= innerHeight + .5
        }), `${surface.name}/${width}: complete criteria dialog reflows inside the viewport`)
        const lookupOwner = LOOKUP_CRITERIA_WINDOWS.some(([name]) => name === surface.name)
        const referenceOwner = REFERENCE_CRITERIA_WINDOWS.some(([name]) => name === surface.name)
        const numericOwner = NUMERIC_CRITERIA_WINDOWS.some(([name]) => name === surface.name)
        const dateOptions = DATE_OPTION_CRITERIA_WINDOWS.find((owner) => owner.name === surface.name)
        const dateChoice = DATE_CHOICE_CRITERIA_WINDOWS.find((owner) => owner.name === surface.name)
        if (!reveal && (lookupOwner || referenceOwner || numericOwner || dateOptions || dateChoice || ['w_arg_zone_sdate_ldate_top_n_customer', 'w_sale_replace_custref',
          'w_arg_sdate', 'w_arg_sdate_notime', 'w_arg_sdate_ldate'].includes(surface.name))) {
          const stops = dateChoice ? [...dateChoice.order.filter((name) =>
            !['st_4', 'gb_2', 'rb_bank', 'rb_both', 'rb_purprice'].includes(name)), 'cb_ok', 'cb_cancel'] :
            dateOptions ? ['em_startdate', 'em_enddate', ...dateOptions.checkboxes,
            ...(dateOptions.radios ? [dateOptions.radios[0]] : []), 'cb_ok', 'cb_cancel'] : lookupOwner ? [
            ...(['w_arg_singleregion', 'w_arg_singlezone', 'w_arg_supp_label'].includes(surface.name) ? [] :
              ['em_startdate', 'em_enddate']), 'dw_control', ...(surface.name === 'w_arg_supp_label' ? ['cbx_supress'] : []),
            'cb_ok', 'cb_cancel',
          ] : numericOwner ? [
            ...surface.data[0].surface.fields.map(() => 'dw_control'),
            ...(surface.name === 'w_arg_scode_lcode' ? ['cbx_supress', 'cbx_hide'] : []), 'cb_ok', 'cb_cancel',
          ] : referenceOwner ? ['dw_control', 'cb_ok', 'cb_cancel'] : surface.name === 'w_sale_replace_custref' ?
            ['dw_replace_custref', 'cb_ok', 'cb_cancel'] :
            surface.name === 'w_arg_zone_sdate_ldate_top_n_customer' ?
              ['dw_control', 'em_startdate', 'em_enddate', 'dw_custcount', 'cb_ok', 'cb_cancel'] :
              ['em_startdate', ...(surface.name === 'w_arg_sdate_ldate' ? ['em_enddate'] : []), 'cb_ok', 'cb_cancel']
          // The lists name each window's tab stops; Tab visits them in the source TabOrder (none = last, as 9999), e.g.
          // w_arg_subacc_sdate_ldate: dw_control 10, em_startdate 20, em_enddate 30, cb_ok 40, cb_cancel 50.
          const tabOrders = await page.evaluate((names) => {
            const f = window.criteriaWindowPreview
            return Object.fromEntries(names.map((name) => [name, Number(f.window.children.get(name)?.props.get('taborder') ?? 0) || 9999]))
          }, [...new Set(stops)])
          const order = stops.map((name, index) => ({ name, index })).sort((a, b) => tabOrders[a.name] - tabOrders[b.name] || a.index - b.index)
            .map((entry) => entry.name)
          // start on the last stop: the first Tab wraps to the first, wherever the layout draws it
          await page.evaluate((name) => {
            const f = window.criteriaWindowPreview, element = f.view.ctlViews.get(f.window.children.get(name)).el
            ;(element.matches('input,select,textarea,button') ? element : element.querySelector('input,select,textarea,button,[tabindex]:not([tabindex="-1"])'))?.focus()
          }, order.at(-1))
          let numericColumn = 0
          for (const name of order) {
            await page.keyboard.press('Tab')
            await page.waitForFunction(({ name, field }) => {
              const f = window.criteriaWindowPreview
              const control = f.view.ctlViews.get(f.window.children.get(name)).el
              return (field ? control.querySelector(`.surface-value[data-obj="${field}"]`) : control)
                ?.contains(document.activeElement)
            }, { name, field: numericOwner && name === 'dw_control' ?
              surface.data[0].surface.fields[numericColumn++].object : null }, { timeout: 5000 })
          }
          // the title-bar Close button is a mouse control outside the cycle: Tab wraps to the first control in source order
          await page.keyboard.press('Tab')
          assert.ok(await page.evaluate((name) => {
            const f = window.criteriaWindowPreview
            return f.view.ctlViews.get(f.window.children.get(name)).el.contains(document.activeElement)
          }, order[0]), `${surface.name}/${width}: keyboard traversal wraps within the modal in source order`)
        }
        for (const control of await form.locator('input:visible:not(:disabled),select:visible:not(:disabled),button:visible:not(:disabled),.surface-value:visible').all()) {
          await control.focus()
          assert.ok(await control.evaluate((element) => {
            const bounds = element.getBoundingClientRect()
            return bounds.left >= 0 && bounds.right <= innerWidth + 1 && bounds.top >= 0 && bounds.bottom <= innerHeight + 1
          }), `${surface.name}/${width}: keyboard focus reveals fields and actions`)
          assert.ok(await control.evaluate((element) => !element.matches('.ctl:focus-visible') ||
            getComputedStyle(element).outlineStyle === 'solid' && parseFloat(getComputedStyle(element).outlineWidth) >= 2),
          `${surface.name}/${width}: Modern native controls retain their focus outline independently of Classic styles`)
        }
        const contrast = Math.min(...await visibleContrast(form))
        assert.ok(contrast >= 4.5, `${surface.name}/${width}: criteria dialog text contrast (${contrast})`)
        await form.evaluate((root) => { root.scrollTop = 0 })
        if (surface.name === 'w_sale_replace_custref') {
          assert.ok(await form.evaluate((root) => {
            const close = root.querySelector('.tbar .cls').getBoundingClientRect()
            const content = root.querySelector('.window-fields').getBoundingClientRect()
            return close.bottom <= content.top
          }), `${surface.name}/${width}: the untitled dialog's close button never covers its field or source instructions`)
        }
        const screenshot = `${surface.name}-${reveal ? 'options' : 'default'}-${theme}-${scale}-${width}.png`
        await page.screenshot({ path: resolve(output, screenshot) })
        cases.push({ name: surface.name, reveal, theme, scale, width, height, minimumContrast: contrast, screenshot })
      } catch (error) {
        throw new Error(`${surface.name}/${theme}/${scale}/${width}: ${error.message}`, { cause: error })
      } finally { await page.evaluate(() => window.criteriaWindowPreview.close()) }
    }
  }
  return cases
}

async function checkItemSelectionInput(page) {
  await page.setViewportSize({ width: 1366, height: 768 })
  await page.evaluate(() => window.openCriteriaWindowPreview('w_arg_items_sdate_ldate_topn'))
  try {
    const form = page.locator('.presentation-modern-dialog[open]>.modern-window')
    const search = form.locator('[data-window-data=dw_selected]')
    const available = form.locator('[data-window-data=dw_selectionlist]')
    const selected = form.locator('.window-list select')
    const alias = async (value) => {
      await search.locator('[data-obj=aliasname]').click()
      await search.locator('input.surface-editor').fill(value)
      await search.locator('input.surface-editor').press('Enter')
      await page.waitForFunction(() => {
        const f = window.criteriaWindowPreview
        return f.model.colNames[f.model.col - 1] === 'name' && f.dw.editor === document.activeElement
      })
    }
    const total = async (count) => page.waitForFunction((count) =>
      window.criteriaWindowPreview.window.children.get('lb_selected').items().a.length === count, count)
    await alias('syn-a')
    assert.equal(await page.evaluate(() => window.criteriaWindowPreview.model.getItem(1, 'code')), 901,
      'Real typing keeps the source uppercase alias rule and procedure-selected key')
    await search.locator('input.surface-editor').press('ArrowDown')
    await page.waitForFunction(() => window.criteriaWindowPreview.model.getItem(1, 'code') === 902)
    await search.locator('input.surface-editor').press('F4')
    await available.locator('.surface-value[data-obj=name]').filter({ hasText: 'Charlie synthetic item' }).click()
    await page.waitForFunction(() => window.criteriaWindowPreview.model.getItem(1, 'code') === 903)
    await search.locator('input.surface-editor').press('Enter')
    await total(1)
    await selected.focus()
    await selected.press('Enter')
    await total(0)
    await alias('SYN-C')
    await search.locator('input.surface-editor').press('Enter')
    await total(1)
    await alias('SYN-A')
    await search.locator('input.surface-editor').press('Enter')
    await total(2)
    await selected.focus()
    await page.waitForFunction(() => window.criteriaWindowPreview.window.children.get('lb_selected').props.get('_selected') === 1)
    await selected.locator('option').filter({ hasText: 'Alpha synthetic item' }).dblclick()
    await total(1)
    assert.deepEqual(await selected.locator('option').allTextContents(), ['Charlie synthetic item'],
      'Real native-list double-click removes only the chosen item')
    assert.deepEqual(await page.evaluate(() => {
      const model = window.criteriaWindowPreview.data.get('dw_selectionlist').model
      return model.buf.primary.map((row) => row.v[model.colIndex('code')])
    }), [901, 902], 'Keyboard and pointer removal restore exact available keys')
  } finally { await page.evaluate(() => window.criteriaWindowPreview.close()) }
}

// The criteria window's next control after `name` in the source TabOrder (visible, enabled; ties in document order, as the
// app orders them): where Tab past a DataWindow's last field moves, as in PowerBuilder.
const nextCriteriaControl = (name) => {
  const f = window.criteriaWindowPreview
  const order = (control) => Number(control?.props.get('taborder') ?? 0)
  const own = f.window.children.get(name), element = f.el(name)
  const later = (control) => order(control) > order(own) || order(control) === order(own) &&
    !!(element.compareDocumentPosition(f.el(control.name)) & Node.DOCUMENT_POSITION_FOLLOWING)
  const next = [...f.window.children.values()]
    .filter((control) => control !== own && order(control) > 0 && control.props.get('visible') !== false &&
      control.props.get('enabled') !== false && later(control))
    .sort((a, b) => order(a) - order(b) || (f.el(a.name).compareDocumentPosition(f.el(b.name)) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1))[0]
  return !!next && f.el(next.name).contains(document.activeElement)
}

async function checkLookupCriteriaInput(page) {
  await page.setViewportSize({ width: 1366, height: 768 })
  for (const [name] of LOOKUP_CRITERIA_WINDOWS) {
    await page.evaluate((name) => window.openCriteriaWindowPreview(name), name)
    try {
      const form = page.locator('.presentation-modern-dialog[open]>.modern-window')
      const data = form.locator('[data-window-data=dw_control]')
      await data.locator('.surface-value').click()
      const editor = data.locator('input.surface-editor,select.surface-editor')
      if (await editor.evaluate((element) => element instanceof HTMLSelectElement)) {
        await editor.selectOption('2')
      } else {
        if (await editor.getAttribute('aria-expanded') !== 'true') await editor.press('F4')
        await data.locator('.dw-choice-popup [data-index="2"]').click()
      }
      await page.waitForFunction(() => {
        const f = window.criteriaWindowPreview
        return f.model.getItem(1, f.surface.data[0].surface.fields[0].object) === 903
      })
      if (await page.evaluate(() => window.criteriaWindowPreview.surface.data[0].surface.fields[0].choice.showList === true)) {
        assert.equal(await editor.getAttribute('aria-expanded'), 'true',
          `${name}: source ShowList intentionally remains open after selection`)
        await editor.press('Tab')
        // Tab past the lookup's only field moves on to the window's next control in the source tab order (the start date
        // where the dialog has dates: dw_control 10, em_startdate 20, ..., cb_ok 40), as PowerBuilder does.
        await page.waitForFunction(nextCriteriaControl, 'dw_control', { timeout: 10000 })
          .catch(async (error) => {
            const state = await page.evaluate(() => {
              const f = window.criteriaWindowPreview, active = document.activeElement
              const describe = (element) => element ? `${element.tagName.toLowerCase()}${element.dataset?.obj ? '[' + element.dataset.obj + ']' : ''}` +
                `${element.className ? '.' + String(element.className).split(' ').slice(0, 2).join('.') : ''}` +
                ` tab=${[...(function* () { for (let at = element; at && at !== f.view.client; at = at.parentElement) if (at.dataset?.tab) yield at.dataset.tab })()].reverse().join('/')}` +
                ` index=${element.tabIndex}` : 'none'
              const stops = [...f.view.client.querySelectorAll('input,textarea,select,button,a[href],[tabindex]')]
                .filter((element) => element.tabIndex >= 0 && !element.matches(':disabled') && element.getClientRects().length > 0)
              return { active: describe(active), insideDialog: f.view.el.contains(active), editor: describe(f.dw?.editor),
                popup: !!f.dw?.choiceEdit?.popup?.open, row: f.model.row, column: f.model.col,
                cbOk: describe(f.el('cb_ok')), stops: stops.slice(0, 16).map(describe) }
            })
            throw new Error(`Tab from the lookup did not reach the next control in the source tab order: ${JSON.stringify(state)}`, { cause: error })
          })
        assert.equal(await data.locator('.dw-choice-popup:visible').count(), 0,
          `${name}: real Tab accepts and dismisses the automatic list before the next action`)
      }
      if (name === 'w_arg_supp_label') {
        const all = form.getByRole('checkbox', { name: 'All:' })
        await all.focus()
        await all.press('Space')
      }
      await form.getByRole('button', { name: 'Ok', exact: true }).click()
      await page.waitForFunction(() => !window.criteriaWindowPreview.window.isOpen)
      assert.deepEqual(await page.evaluate(() => {
        const f = window.criteriaWindowPreview, result = f.returned()
        return [result.pbGet('i_status'), result.pbGet('l_code1'),
          f.events.filter((event) => event.target === f.window.children.get('cb_ok') && event.event === 'clicked').length,
          f.surface.name === 'w_arg_supp_label' ? result.pbGet('i_supress') : 0]
      }), [1, 903, 1, name === 'w_arg_supp_label' ? true : 0],
      `${name}: real pointer/keyboard selection produces exactly one source OK with the selected key and flags`)
    } catch (error) {
      throw new Error(`${name}: ${error.message}`, { cause: error })
    } finally { await page.evaluate(() => window.criteriaWindowPreview.close()) }
  }
}

async function checkReferenceCriteriaInput(page) {
  await page.setViewportSize({ width: 1366, height: 768 })
  for (const [name, caption] of REFERENCE_CRITERIA_WINDOWS) {
    await page.evaluate((name) => window.openCriteriaWindowPreview(name), name)
    try {
      const form = page.locator('.presentation-modern-dialog[open]>.modern-window')
      const data = form.locator('[data-window-data=dw_control]')
      const sourceLabel = form.locator('.window-caption').filter({ hasText: caption })
      const editor = data.locator('.surface-value')
      await editor.click()
      const input = data.locator('input.surface-editor')
      assert.equal(await input.getAttribute('aria-labelledby'), await sourceLabel.getAttribute('id'),
        `${name}: the visible source caption directly labels the text editor`)
      await input.fill('Batch-0042')
      await input.press('Tab')
      await page.waitForFunction(() => window.criteriaWindowPreview.el('cb_ok') === document.activeElement,
        null, { timeout: 5000 })
      assert.equal(await page.evaluate(() => window.criteriaWindowPreview.model.getItem(1, 'refno')), 'Batch-0042')
      await page.keyboard.press('Enter')
      await page.waitForFunction(() => !window.criteriaWindowPreview.window.isOpen)
      assert.deepEqual(await page.evaluate(() => {
        const f = window.criteriaWindowPreview, result = f.returned()
        return [result.pbGet('i_status'), result.pbGet('s_name1')]
      }), [1, 'Batch-0042'], `${name}: real typing/Tab/Enter returns the accepted source string exactly once`)
    } finally { await page.evaluate(() => window.criteriaWindowPreview.close()) }
  }
}

async function checkNumericCriteriaInput(page) {
  await page.setViewportSize({ width: 1366, height: 768 })
  for (const [name] of NUMERIC_CRITERIA_WINDOWS) {
    const surface = CRITERIA_WINDOW_SURFACES.find((surface) => surface.name === name)
    const fields = surface.data[0].surface.fields
    const percentage = ['w_arg_discperc', 'w_arg_gstperc'].includes(name)
    await page.evaluate((name) => window.openCriteriaWindowPreview(name), name)
    try {
      const form = page.locator('.presentation-modern-dialog[open]>.modern-window')
      const data = form.locator('[data-window-data=dw_control]')
      for (const [index, field] of fields.entries()) {
        await data.locator(`.surface-value[data-obj="${field.object}"]`).click()
        const input = data.locator('input.surface-editor')
        const id = await page.evaluate((field) => {
          const f = window.criteriaWindowPreview
          return f.el(f.surface.data[0].labels.find((binding) => binding.field === field).control).id
        }, field.object)
        assert.equal(await input.getAttribute('aria-labelledby'), id,
          `${name}/${field.object}: actual numeric input uses its original caption`)
        await input.fill(percentage ? '12.34' : String(100 + index * 100))
        await input.press('Tab')
        if (index + 1 < fields.length) await page.waitForFunction((column) => {
          const f = window.criteriaWindowPreview
          return f.model.col === column && f.dw.root.contains(document.activeElement)
        }, index + 2, { timeout: 5000 })
      }
      if (name === 'w_arg_scode_lcode') {
        for (const control of ['cbx_supress', 'cbx_hide']) {
          await page.waitForFunction((control) => window.criteriaWindowPreview.el(control).contains(document.activeElement),
            control, { timeout: 5000 })
          await page.keyboard.press('Space')
          await page.keyboard.press('Tab')
        }
      }
      await page.waitForFunction(() => window.criteriaWindowPreview.el('cb_ok') === document.activeElement,
        null, { timeout: 5000 })
      await page.keyboard.press('Enter')
      await page.waitForFunction(() => !window.criteriaWindowPreview.window.isOpen)
      assert.deepEqual(await page.evaluate(({ percentage, count }) => {
        const f = window.criteriaWindowPreview, result = f.returned()
        return [result.pbGet('i_status'), ...Array.from({ length: count }, (_, index) =>
          Number(result.pbGet(percentage ? 'db_code1' : `l_code${index + 1}`))),
        f.events.filter((event) => event.target.name === 'cb_ok' && event.event === 'clicked').length]
      }, { percentage, count: fields.length }), [1, ...fields.map((_, index) => percentage ? 12.34 : 100 + index * 100), 1],
      `${name}: actual typing, field-order Tab and Enter return the source numeric fields exactly once`)
    } finally { await page.evaluate(() => window.criteriaWindowPreview.close()) }
  }
}

async function checkDateOptionInput(page) {
  await page.setViewportSize({ width: 1366, height: 768 })
  for (const owner of DATE_OPTION_CRITERIA_WINDOWS) {
    await page.evaluate((name) => window.openCriteriaWindowPreview(name), owner.name)
    try {
      const form = page.locator('.presentation-modern-dialog[open]>.modern-window')
      const captions = await page.evaluate((names) => Object.fromEntries(names.map((name) =>
        [name, window.criteriaWindowPreview.window.children.get(name).pbGet('text')])),
      [...owner.checkboxes, ...(owner.radios ?? [])])
      const input = (name) => form.getByRole(owner.radios?.includes(name) ? 'radio' : 'checkbox',
        { name: captions[name], exact: true })
      const start = form.locator('input[id$="-em_startdate"]')
      await start.fill('29/02/2023 12:00:00')
      await form.getByRole('button', { name: 'Ok', exact: true }).click()
      const message = page.locator('.presentation-runtime-dialog[open]')
      await message.waitFor()
      assert.match(await message.textContent(), /Enter a valid date using/)
      await message.getByRole('button', { name: 'OK', exact: true }).click()
      await page.waitForFunction(() => window.criteriaWindowPreview.el('em_startdate') === document.activeElement)
      assert.equal(await start.inputValue(), '29/02/2023 12:00:00')
      assert.equal(await start.getAttribute('aria-invalid'), 'true')
      await start.fill('29/02/2024 21:22:23')
      await page.keyboard.press('Tab')
      assert.equal(await page.evaluate(() => document.activeElement === window.criteriaWindowPreview.el('em_enddate')), true)
      await form.locator('input[id$="-em_enddate"]').fill('01/03/2024 01:02:03')
      if (owner.checkboxes.length) {
        const first = owner.checkboxes[0], checkbox = input(first), initial = await checkbox.isChecked()
        await checkbox.focus()
        await checkbox.press('Space')
        assert.equal(await checkbox.isChecked(), !initial, `${owner.name}: real Space changes the native checkbox`)
        assert.equal(await page.evaluate((name) => window.criteriaWindowPreview.window.children.get(name).pbGet('checked'), first),
          !initial, `${owner.name}: keyboard changes reach the original runtime control`)
        if (first === 'cbx_all') {
          await page.waitForFunction(() => !window.criteriaWindowPreview.window.children.get('cbx_others').pbGet('enabled'))
          for (const name of owner.checkboxes.slice(1)) {
            assert.equal(await input(name).isChecked(), true)
            assert.equal(await input(name).isDisabled(), true)
          }
          await checkbox.click()
          await page.waitForFunction(() => window.criteriaWindowPreview.window.children.get('cbx_others').pbGet('enabled'))
          for (const name of owner.checkboxes.slice(1)) {
            assert.equal(await input(name).isChecked(), false)
            assert.equal(await input(name).isDisabled(), false)
          }
          await input('cbx_cr').click()
        }
      }
      if (owner.radios) {
        await input(owner.radios[0]).focus()
        await page.keyboard.press('ArrowRight')
        await page.waitForFunction((name) => window.criteriaWindowPreview.window.children.get(name).pbGet('checked'), owner.radios[1])
        assert.equal(await input(owner.radios[0]).isChecked(), false)
        assert.equal(await input(owner.radios[1]).isChecked(), true)
      }
      await form.getByRole('button', { name: 'Ok', exact: true }).focus()
      await page.keyboard.press('Enter')
      await page.waitForFunction(() => !window.criteriaWindowPreview.window.isOpen)
      assert.deepEqual(await page.evaluate(() => {
        const f = window.criteriaWindowPreview
        return { status: f.returned().pbGet('i_status'),
          accepts: f.events.filter((event) => event.target === f.window.children.get('cb_ok') && event.event === 'clicked').length,
          invalid: f.el('em_startdate').getAttribute('aria-invalid'), reads: f.calls.length }
      }), { status: 1, accepts: 2, invalid: null, reads: 0 },
      `${owner.name}: corrected keyboard acceptance runs once, clears the error and avoids hidden-buffer retrieval`)
      if (owner.name === 'w_arg_sdate_ldate_transaction') {
        assert.equal(await page.evaluate(() => window.criteriaWindowPreview.returned().pbGet('ia_integerlist').a[10]), 2,
          'Pointer-selected Cash Receipts retains original return position 11 and code 2')
      }
    } finally { await page.evaluate(() => window.criteriaWindowPreview.close()) }
  }
}

async function checkDateChoiceInput(page) {
  await page.setViewportSize({ width: 1366, height: 768 })
  for (const owner of DATE_CHOICE_CRITERIA_WINDOWS.filter((owner) => owner.name !== 'w_arg_ason')) {
    await page.evaluate((name) => window.openCriteriaWindowPreview(name), owner.name)
    try {
      const form = page.locator('.presentation-modern-dialog[open]>.modern-window')
      const start = form.locator('input[id$="-em_startdate"]'), end = form.locator('input[id$="-em_enddate"]')
      await end.fill('31/04/2024 12:00:00')
      await form.getByRole('button', { name: 'Ok', exact: true }).click()
      const message = page.locator('.presentation-runtime-dialog[open]')
      await message.waitFor()
      assert.match(await message.textContent(), /Enter a valid date using/)
      await message.getByRole('button', { name: 'OK', exact: true }).click()
      await page.waitForFunction(() => window.criteriaWindowPreview.el('em_enddate') === document.activeElement)
      assert.equal(await end.getAttribute('aria-invalid'), 'true')
      assert.equal(await end.inputValue(), '31/04/2024 12:00:00')
      await start.fill('29/02/2024 21:22:23')
      await end.fill('01/03/2024 01:02:03')
      let code = 0, name = ''
      if (owner.price) {
        const data = form.locator('[data-window-data=dw_price]')
        await data.locator('.surface-value').click()
        const editor = data.locator('input.surface-editor,select.surface-editor')
        assert.equal(await editor.getAttribute('aria-labelledby'),
          await page.evaluate(() => window.criteriaWindowPreview.el('st_4').id),
          `${owner.name}: the source cost/type caption labels the actual editor`)
        const index = owner.price.fields[0].object === 'price' ? 0 : 2
        code = index === 0 ? 5 : 3
        if (await editor.evaluate((input) => input instanceof HTMLSelectElement)) await editor.selectOption(String(index))
        else {
          if (await editor.getAttribute('aria-expanded') !== 'true') await editor.press('F4')
          await data.locator(`.dw-choice-popup [data-index="${index}"]`).click()
        }
        await page.waitForFunction(() => window.criteriaWindowPreview.data.get('dw_price').dw.root.contains(document.activeElement),
          null, { timeout: 5000 })
        await page.keyboard.press('Tab')
        // past the price type's only field: the next control by TabOrder (dw_price shares 20 with the start date)
        await page.waitForFunction(nextCriteriaControl, 'dw_price', { timeout: 5000 })
      } else if (owner.name === 'w_arg_sdate_cashflow_crosstab') {
        await form.getByRole('radio', { name: 'Cash Accounts', exact: true }).focus()
        await page.keyboard.press('ArrowRight')
        assert.equal(await form.getByRole('radio', { name: 'Bank Accounts', exact: true }).isChecked(), true)
        await form.getByRole('checkbox', { name: 'Show Accounts with Transactions only', exact: true }).focus()
        await page.keyboard.press('Space')
        code = 2
      } else {
        await form.getByRole('radio', { name: 'Show cust/supp', exact: true }).focus()
        await page.keyboard.press('ArrowRight')
        assert.equal(await form.getByRole('radio', { name: 'Show Remarks', exact: true }).isChecked(), true)
        name = 'Y'
      }
      await form.getByRole('button', { name: 'Ok', exact: true }).focus()
      await page.keyboard.press('Enter')
      await page.waitForFunction(() => !window.criteriaWindowPreview.window.isOpen)
      assert.deepEqual(await page.evaluate(() => {
        const f = window.criteriaWindowPreview, result = f.returned()
        return [result.pbGet('i_status'), result.pbGet('l_code1'), result.pbGet('l_code2'), result.pbGet('s_name1'),
          f.events.filter((event) => event.target === f.window.children.get('cb_ok') && event.event === 'clicked').length,
          f.el('em_enddate').getAttribute('aria-invalid')]
      }), [1, code, 0, name, 2, null], `${owner.name}: actual choice and recovery return exact codes through one corrected acceptance`)
    } finally { await page.evaluate(() => window.criteriaWindowPreview.close()) }
  }
}

async function checkNativeDateInput(page, names = ['w_arg_sdate', 'w_arg_sdate_notime', 'w_arg_sdate_ldate', 'w_arg_ason']) {
  await page.setViewportSize({ width: 1366, height: 768 })
  for (const name of names) {
    await page.evaluate((name) => window.openCriteriaWindowPreview(name), name)
    try {
      const form = page.locator('.presentation-modern-dialog[open]>.modern-window')
      const start = form.locator('input[id$="-em_startdate"]')
      const end = form.locator('input[id$="-em_enddate"]')
      await start.fill('30/02/2024')
      await form.getByRole('button', { name: 'Ok', exact: true }).click()
      const message = page.locator('.presentation-runtime-dialog[open]')
      await message.waitFor()
      assert.match(await message.textContent(), /Enter a valid date using dd\/mm\/yyyy/)
      await message.getByRole('button', { name: 'OK', exact: true }).click()
      await page.waitForFunction(() => {
        const f = window.criteriaWindowPreview
        return f.el('em_startdate') === document.activeElement
      })
      assert.equal(await start.inputValue(), '30/02/2024', `${name}: actual invalid typing remains recoverable`)
      assert.equal(await start.getAttribute('aria-invalid'), 'true')
      const border = await start.evaluate((input) => {
        const probe = document.createElement('span')
        probe.style.color = 'var(--p-danger)'
        input.parentElement.append(probe)
        const result = [getComputedStyle(input).borderTopColor, getComputedStyle(probe).color]
        probe.remove()
        return result
      })
      assert.equal(border[0], border[1], `${name}: the native error border overrides the normal input border`)
      await page.emulateMedia({ forcedColors: 'active' })
      assert.equal(await start.evaluate((input) => getComputedStyle(input).borderTopStyle), 'dashed',
        `${name}: invalid native dates retain a non-color error cue in forced colors`)
      await page.emulateMedia({ forcedColors: 'none' })
      await start.fill(name === 'w_arg_sdate_notime' ? '29/02/2024' : '29/02/2024 21:22:23')
      await start.press('Enter')
      const next = name === 'w_arg_sdate_ldate' ? 'em_enddate' : 'cb_ok'
      await page.waitForFunction((next) => {
        const f = window.criteriaWindowPreview
        return f.el(next) === document.activeElement
      }, next, { timeout: 5000 })
      if (name === 'w_arg_sdate_ldate') {
        await end.fill('01/03/2024 01:02:03')
        await end.press('Enter')
        await page.waitForFunction(() => window.criteriaWindowPreview.el('cb_ok') === document.activeElement)
      }
      await page.keyboard.press('Enter')
      await page.waitForFunction(() => !window.criteriaWindowPreview.window.isOpen)
      assert.equal(await page.evaluate(() => {
        const f = window.criteriaWindowPreview
        return f.events.filter((event) => event.target === f.window.children.get('cb_ok') && event.event === 'clicked').length
      }), 2, `${name}: invalid pointer acceptance and corrected keyboard acceptance each run once`)
      assert.equal(await page.evaluate(() => window.criteriaWindowPreview.returned().pbGet('i_status')), 1,
        `${name}: real Enter/Handle/Send navigation and acceptance return success once corrected`)
      assert.equal(await page.evaluate(() => window.criteriaWindowPreview.el('em_startdate').getAttribute('aria-invalid')), null)
    } finally {
      await page.emulateMedia({ forcedColors: 'none' })
      await page.evaluate(() => window.criteriaWindowPreview.close())
    }
    await page.evaluate((name) => window.openCriteriaWindowPreview(name), name)
    try {
      await page.keyboard.press('Escape')
      assert.equal(await page.evaluate(() => window.criteriaWindowPreview.window.isOpen), true,
        `${name}: Escape does not invent a shortcut absent from the source Cancel button`)
      assert.equal(await page.evaluate(() => window.criteriaWindowPreview.returned().pbGet('i_status')), 0,
        `${name}: reopening cannot reuse the previous successful date result`)
      await page.locator('.presentation-modern-dialog[open]').getByRole('button', { name: 'Cancel', exact: true }).focus()
      await page.keyboard.press('Enter')
      await page.waitForFunction(() => !window.criteriaWindowPreview.window.isOpen)
      assert.equal(await page.evaluate(() => window.criteriaWindowPreview.returned().pbGet('i_status')), 0,
        `${name}: real keyboard Cancel returns the source cancellation structure`)
    } finally { await page.evaluate(() => window.criteriaWindowPreview.close()) }
  }
}

async function captureCriteria(page, output) {
  const cases = []
  for (const surface of CRITERIA_DATA_SURFACES) for (const [theme, scale, width, height] of [
    ['light', 100, 1366, 768], ['dark', 200, 1366, 768], ['dark', 200, 683, 384], ['dark', 200, 320, 768],
  ]) {
    await page.setViewportSize({ width, height })
    await page.evaluate(async ({ name, theme, scale }) => {
      await window.openCriteriaPreview(name)
      const f = window.criteriaPreview
      f.view.root.dataset.theme = theme
      f.view.root.dataset.density = 'comfortable'
      f.view.root.style.setProperty('--p-scale', String(scale / 100))
      await f.view.render()
    }, { name: surface.name, theme, scale })
    try {
      const root = page.locator('#criteria-preview .modern-surface')
      await page.waitForFunction(() => !window.criteriaPreview.view.scheduled && !window.criteriaPreview.view.rendering)
      assert.ok(await root.evaluate(root => {
        const bounds = root.getBoundingClientRect()
        return root.scrollWidth <= root.clientWidth + 1 && bounds.left >= 0 && bounds.right <= innerWidth &&
          bounds.top >= 0 && bounds.bottom <= innerHeight
      }), `${surface.name}/${width}: criteria reflow inside the viewport`)
      for (const cell of await root.locator('.surface-value').all()) {
        await cell.focus()
        assert.ok(await cell.evaluate(cell => {
          const value = cell.getBoundingClientRect(), root = cell.closest('.dw').getBoundingClientRect()
          return value.left >= root.left - .5 && value.right <= root.right + .5 &&
            value.top >= root.top - .5 && value.bottom <= root.bottom + .5
        }), `${surface.name}/${width}: keyboard focus reveals the complete field`)
      }
      const editable = surface.name !== 'd_arg_saleprice_disabled'
      const field = surface.fields[0].object
      const sourceChoice = ['list', 'lookup'].includes(surface.fields[0].choice?.kind)
      const before = await page.evaluate(field => {
        const f = window.criteriaPreview
        return { value: String(f.model.getItem(1, field)), changes: f.events.filter(event => event.event === 'itemchanged').length,
          integer: f.model.def.table.columns.find(column => column.name === field)?.type === 'long' }
      }, field)
      const draft = field === 'arg_to' ? 'Synthetic draft' : field === 'distcode' ? 'Synthetic criteria draft' : before.integer ? '42' : '14.25'
      if (editable) {
        await page.evaluate(field => window.criteriaPreview.edit(field), field)
        const editor = root.locator('.surface-editor')
        if (sourceChoice) {
          assert.ok(await editor.evaluate(input => document.activeElement === input && !!input.getAttribute('aria-labelledby')),
            `${surface.name}/${width}: the choice editor keeps keyboard focus and its field label`)
          if (await editor.evaluate(input => input instanceof HTMLSelectElement)) {
            const current = await editor.inputValue()
            const target = await editor.locator('option:not(:disabled)').evaluateAll((options, current) =>
              options.find(option => option.value !== current)?.value ?? '', current)
            assert.notEqual(target, '', `${surface.name}: source choice list has an alternate option`)
            await editor.selectOption(target)
          } else {
            await editor.press('F4')
            await editor.press(surface.fields[0].choice?.editable ? 'ArrowDown' : 'End')
            const popup = root.locator('.dw-choice-popup')
            await popup.waitFor({ state: 'visible' })
            assert.ok(await popup.evaluate(popup => {
              const rect = popup.getBoundingClientRect()
              return rect.left >= 0 && rect.right <= innerWidth + .5 && rect.top >= 0 && rect.bottom <= innerHeight + .5 &&
                popup.scrollWidth <= popup.clientWidth + 1
            }), `${surface.name}/${width}: the source-sized lookup fits the viewport without horizontal scrolling`)
            assert.equal(await page.evaluate(field => String(window.criteriaPreview.model.getItem(1, field)), field), before.value,
              `${surface.name}: navigating a lookup leaves the parent key unapplied`)
            const popupContrast = await visibleContrast(popup)
            assert.ok(popupContrast.length && popupContrast.every(value => value >= 4.5),
              `${surface.name}/${width}: every visible lookup option meets text contrast`)
            await root.screenshot({ path: resolve(output, `criteria-${surface.name}-${theme}-${scale}-${width}-lookup.png`) })
            await editor.press('Enter')
          }
          await page.waitForFunction(({ field, before }) =>
            String(window.criteriaPreview.model.getItem(1, field)) !== before.value, { field, before })
          assert.notEqual(await page.evaluate(field => String(window.criteriaPreview.model.getItem(1, field)), field), before.value,
            `${surface.name}: selecting a source option updates the model`)
          assert.equal(await page.evaluate(() => window.criteriaPreview.events.filter(event => event.event === 'itemchanged').length),
            before.changes + 1, `${surface.name}: choosing a source option commits exactly once`)
        } else {
          await editor.fill(draft)
          if (field === 'arg_to') {
            await editor.press('Shift+Enter')
            await editor.pressSequentially('Second line')
            assert.equal(await editor.inputValue(), 'Synthetic draft\nSecond line', 'Real Shift+Enter adds a letter line without submitting')
          }
          await page.waitForFunction(() => !window.criteriaPreview.view.scheduled && !window.criteriaPreview.view.rendering)
          assert.equal(await page.evaluate(field => String(window.criteriaPreview.model.getItem(1, field)), field), before.value,
            `${surface.name}: real typing does not accept a draft`)
          assert.ok(await editor.evaluate(input => {
            const value = input.getBoundingClientRect(), root = input.closest('.dw').getBoundingClientRect()
            return document.activeElement === input && value.left >= root.left - .5 && value.right <= root.right + .5 &&
              value.top >= root.top - .5 && value.bottom <= root.bottom + .5 &&
              !!input.getAttribute('aria-labelledby')
          }), `${surface.name}/${width}: the complete active editor and its label survive reflow`)
        }
      }
      const contrast = await visibleContrast(root)
      assert.ok(contrast.length && contrast.every(value => value >= 4.5), `${surface.name}/${width}: criteria text contrast`)
      for (const field of surface.fields.filter(field => field.suffixObject)) {
        const suffix = root.locator(`[data-surface-suffix="${field.suffixObject}"]`)
        await suffix.scrollIntoViewIfNeeded()
        assert.ok(await suffix.evaluate(element => {
          const r = element.getBoundingClientRect(), cell = element.previousElementSibling
          return r.width > 0 && r.left >= 0 && r.right <= innerWidth + .5 && r.top >= 0 && r.bottom <= innerHeight + .5 &&
            element.scrollWidth <= element.clientWidth + 1 &&
            cell.getAttribute('aria-describedby')?.split(' ').includes(element.id)
        }), `${surface.name}/${width}: source unit or trailing caption wraps without clipping and stays associated`)
      }
      await root.screenshot({ path: resolve(output, `criteria-${surface.name}-${theme}-${scale}-${width}.png`) })
      if (editable && !sourceChoice) {
        await root.locator('.surface-editor').press('Tab')
        const expected = field === 'arg_to' ? 'Synthetic draft\r\nSecond line' : draft
        await page.waitForFunction(({ field, expected }) =>
          String(window.criteriaPreview.model.getItem(1, field)) === expected, { field, expected })
        assert.equal(await page.evaluate(() => window.criteriaPreview.events.filter(event => event.event === 'itemchanged').length), before.changes + 1,
          `${surface.name}: real Tab accepts once through the shared validation route`)
        if (field === 'arg_to') {
          for (const next of ['arg_subject', 'arg_detail']) {
            assert.equal(await page.evaluate(() => {
              const f = window.criteriaPreview
              return f.view.editor === document.activeElement ? f.model.colNames[f.model.col - 1] : null
            }), next, 'Letter keyboard navigation follows To, Subject, Detail rather than object-array order')
            if (next === 'arg_subject') {
              await root.locator('.surface-editor').press('Tab')
              await page.waitForFunction(() => window.criteriaPreview.model.col === 3)
            }
          }
        }
      }
      assert.deepEqual(await page.evaluate(() => window.criteriaPreview.errors), [])
      cases.push({ name: surface.name, theme, scale, width, height, editable, minimumTextContrast: Math.min(...contrast) })
    } finally {
      await page.evaluate(() => window.criteriaPreview.close())
    }
  }
  return cases
}

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(process.argv[2] || resolve(here, '..', 'dist'))
const output = resolve(process.argv[3] || resolve(here, '..', '..', 'shots', 'presentation'))
await cp(resolve(here, 'presentation.html'), resolve(root, 'presentation.html'))
await cp(resolve(here, 'presentation-browser.mjs'), resolve(root, 'presentation-browser.mjs'))
await cp(resolve(here, 'presentation-data-browser.mjs'), resolve(root, 'presentation-data-browser.mjs'))
await cp(resolve(here, 'presentation-window-browser.mjs'), resolve(root, 'presentation-window-browser.mjs'))
await cp(resolve(here, 'presentation-calculator-browser.mjs'), resolve(root, 'presentation-calculator-browser.mjs'))
await cp(resolve(here, 'presentation-associated-invoices-browser.mjs'), resolve(root, 'presentation-associated-invoices-browser.mjs'))
await cp(resolve(here, 'presentation-cashier-browser.mjs'), resolve(root, 'presentation-cashier-browser.mjs'))
await cp(resolve(here, 'presentation-payment-browser.mjs'), resolve(root, 'presentation-payment-browser.mjs'))
await cp(resolve(here, 'presentation-category-browser.mjs'), resolve(root, 'presentation-category-browser.mjs'))
await cp(resolve(here, 'presentation-tabs-browser.mjs'), resolve(root, 'presentation-tabs-browser.mjs'))
await cp(resolve(here, 'presentation-entry-browser.mjs'), resolve(root, 'presentation-entry-browser.mjs'))
await cp(resolve(here, 'presentation-entry-workflow.mjs'), resolve(root, 'presentation-entry-workflow.mjs'))
await cp(resolve(here, 'presentation-single-entry-browser.mjs'), resolve(root, 'presentation-single-entry-browser.mjs'))
await cp(resolve(here, 'presentation-derived-browser.mjs'), resolve(root, 'presentation-derived-browser.mjs'))
await cp(resolve(here, 'presentation-choice-browser.mjs'), resolve(root, 'presentation-choice-browser.mjs'))
await cp(resolve(here, 'presentation-contact-browser.mjs'), resolve(root, 'presentation-contact-browser.mjs'))
await cp(resolve(here, 'presentation-contact-card-browser.mjs'), resolve(root, 'presentation-contact-card-browser.mjs'))
await cp(resolve(here, 'presentation-lookup-browser.mjs'), resolve(root, 'presentation-lookup-browser.mjs'))
await cp(resolve(here, 'presentation-editable-lookup-browser.mjs'), resolve(root, 'presentation-editable-lookup-browser.mjs'))
await cp(resolve(here, 'presentation-automatic-choice-browser.mjs'), resolve(root, 'presentation-automatic-choice-browser.mjs'))
await cp(resolve(here, 'presentation-selector-variants-browser.mjs'), resolve(root, 'presentation-selector-variants-browser.mjs'))
await cp(resolve(here, 'presentation-transaction-bands-browser.mjs'), resolve(root, 'presentation-transaction-bands-browser.mjs'))
await cp(resolve(here, 'presentation-criteria-browser.mjs'), resolve(root, 'presentation-criteria-browser.mjs'))
await cp(resolve(here, 'presentation-criteria-window-browser.mjs'), resolve(root, 'presentation-criteria-window-browser.mjs'))
await cp(resolve(here, 'presentation-datawindow-calendar-browser.mjs'), resolve(root, 'presentation-datawindow-calendar-browser.mjs'))
await cp(resolve(here, 'presentation-print-browser.mjs'), resolve(root, 'presentation-print-browser.mjs'))
const source = resolve(here, '..', '..', 'data', 'src', 'dw')
const index = JSON.parse(await readFile(resolve(source, '_index.json'), 'utf8'))
const definitions = {}
for (const surface of DATA_SURFACES.filter((surface) => !surface.bands?.length)) {
  const bundle = JSON.parse(gunzipSync(await readFile(resolve(source, index[surface.name] + '.json.gz'))).toString('utf8'))
  const definition = bundle[surface.name]
  // The fixture uses recovered presentation metadata, never retrieve SQL or records.
  definitions[surface.name] = { datawindow: definition.datawindow, bands: definition.bands, objects: definition.objects, table: { columns: definition.table.columns } }
}
await writeFile(resolve(root, 'presentation-surfaces.json'), JSON.stringify(definitions))
const criteriaLookups = {}
for (const name of new Set(CRITERIA_DATA_SURFACES.flatMap((surface) =>
  surface.fields.flatMap((field) => field.choice?.kind === 'lookup' ? [field.choice.name] : [])))) {
  const definition = JSON.parse(gunzipSync(await readFile(resolve(source, index[name] + '.json.gz'))))[name]
  criteriaLookups[name] = { datawindow: definition.datawindow, bands: definition.bands, objects: definition.objects,
    table: { columns: definition.table.columns } }
}
await writeFile(resolve(root, 'presentation-criteria-lookups.json'), JSON.stringify(criteriaLookups))
const transactionData = {}
for (const name of [...TRANSACTION_DATA_SURFACES.map((surface) => surface.name), 'ddd_allaccounts', 'ddd_currency']) {
  const bundle = JSON.parse(gunzipSync(await readFile(resolve(source, index[name] + '.json.gz'))).toString('utf8'))
  const definition = bundle[name]
  transactionData[name] = { datawindow: definition.datawindow, bands: definition.bands, objects: definition.objects,
    table: { columns: definition.table.columns } }
}
await writeFile(resolve(root, 'presentation-transaction-bands.json'), JSON.stringify(transactionData))
const editableData = {}
const automaticData = {}
for (const name of ['d_arg_genericitemtype', 'ddd_genericitemtype', 'd_changeitem_price_marginbased', 'd_emailsubject', 'd_emailtemplate_list']) {
  const definition = JSON.parse(gunzipSync(await readFile(resolve(source, index[name] + '.json.gz'))).toString('utf8'))[name]
  automaticData[name] = { datawindow: definition.datawindow, bands: definition.bands, objects: definition.objects,
    table: { columns: definition.table.columns } }
}
await writeFile(resolve(root, 'presentation-automatic-choices.json'), JSON.stringify(automaticData))
const selectorData = {}
for (const name of ['d_change_purinv', 'd_customer_category', 'd_stockleder_inputs',
  'ddd_purchasetype', 'ddd_itemcategory', 'ddd_customersegment']) {
  const definition = JSON.parse(gunzipSync(await readFile(resolve(source, index[name] + '.json.gz'))).toString('utf8'))[name]
  selectorData[name] = { datawindow: definition.datawindow, bands: definition.bands, objects: definition.objects,
    table: { columns: definition.table.columns } }
}
await writeFile(resolve(root, 'presentation-selector-variants.json'), JSON.stringify(selectorData))
for (const name of ['d_arg_manf', 'd_arg_manf2', 'ddd_manufacturer', 'd_arg_select_cust', 'ddd_customer']) {
  const bundle = JSON.parse(gunzipSync(await readFile(resolve(source, index[name] + '.json.gz'))).toString('utf8'))
  const definition = bundle[name]
  editableData[name] = { datawindow: definition.datawindow, bands: definition.bands, objects: definition.objects, table: { columns: definition.table.columns } }
}
const { file: saleLookupScripts, errors: saleLookupErrors } = parseScriptFile(await readFile(resolve(here, '..', '..', 'data', 'src', 'scripts', 'salewin', 'w_sale.pbs'), 'utf8'))
assert.deepEqual(saleLookupErrors, [], 'Parse original sale type-to-customer routine')
await writeFile(resolve(root, 'presentation-editable-lookups.json'), JSON.stringify({
  data: editableData, search: saleLookupScripts.routines.find((routine) => routine.owner === 'w_sale' && routine.name === 'wf_setcustomername'),
}))
const windows = []
const criteriaClasses = []
for (const [name, library, kind] of [
  ...CRITERIA_WINDOW_SURFACES.map((surface) => [surface.name, surface.library, 'window']),
  ['w_arguements', 'reports', 'window'], ['s_arguements', 'reportviewer', 'structure'],
  ['w_calendar', 'components', 'window'], ['w_calendar2', 'components', 'window'],
  ['w_popup_forselection', 'components', 'window'], ['w_popup_forselection_walias', 'components', 'window'],
  ['s_popup_selection', 'components', 'structure'],
  ['u_dwstandard', 'components', 'userobject'],
]) {
  const definition = JSON.parse(await readFile(resolve(here, '..', '..', 'data', 'src', 'objects', library, kind, name + '.json'), 'utf8'))
  const routines = {}
  if (kind === 'window') {
    const { file, errors } = parseScriptFile(await readFile(resolve(here, '..', '..', 'data', 'src', 'scripts', library, name + '.pbs'), 'utf8'))
    assert.deepEqual(errors, [], `Parse criteria dialog ${name}`)
    for (const routine of file.routines) ((routines[routine.owner] ??= {})[routine.name] ??= []).push(routine)
  }
  criteriaClasses.push({ ...definition, fields: definition.fields.filter((field) => field.name !== 'control'), routines })
}
const criteriaWindowData = {}
for (const surface of CRITERIA_WINDOW_SURFACES) for (const binding of surface.data) {
  for (const name of [binding.surface.name, ...binding.surface.fields.flatMap((field) =>
    field.choice?.kind === 'lookup' ? [field.choice.name] : [])]) {
    if (criteriaWindowData[name]) continue
    const definition = JSON.parse(gunzipSync(await readFile(resolve(source, index[name] + '.json.gz'))).toString('utf8'))[name]
    if (name === binding.surface.name) assert.deepEqual(dataSurfaceIssues(definition, binding.surface), [], name)
    criteriaWindowData[name] = { datawindow: definition.datawindow, bands: definition.bands, objects: definition.objects,
      table: { columns: definition.table.columns, arguments: definition.table.arguments,
        ...(name === 'd_popup_itemselected_arglist' ? { retrieve: definition.table.retrieve } : {}) } }
  }
}
await writeFile(resolve(root, 'presentation-criteria-windows.json'), JSON.stringify({ classes: criteriaClasses, data: criteriaWindowData }))
const { file: commentsSource, errors: commentsErrors } = parseScriptFile(await readFile(
  resolve(here, '..', '..', 'data', 'src', 'scripts', 'custcomponents', 'w_customercomments.pbs'), 'utf8'))
assert.deepEqual(commentsErrors, [], 'Parse original customer-comment F4 override')
const commentsCalendar = commentsSource.routines.filter((routine) => routine.owner === 'dw_itemsdetail' && routine.name === 'ue_dwnkey')
assert.equal(commentsCalendar.length, 1)
const { file: standardSource, errors: standardErrors } = parseScriptFile(await readFile(
  resolve(here, '..', '..', 'data', 'src', 'scripts', 'components', 'u_dwstandard.pbs'), 'utf8'))
assert.deepEqual(standardErrors, [], 'Parse original standard DataWindow routines')
const standardRoutines = {}
for (const routine of standardSource.routines) ((standardRoutines[routine.owner] ??= {})[routine.name] ??= []).push(routine)
assert.equal(standardRoutines.u_dwstandard.ue_dwnkey.length, 1)
await writeFile(resolve(root, 'presentation-datawindow-calendar.json'), JSON.stringify({
  classes: [criteriaClasses.find((definition) => definition.name === 'w_calendar2'),
    { ...criteriaClasses.find((definition) => definition.name === 'u_dwstandard'), routines: standardRoutines }],
  comments: { routines: { dw_itemsdetail: { ue_dwnkey: commentsCalendar } } },
  data: definitions.d_arg_date,
}))
for (const surface of WINDOW_SURFACES) {
  const definition = JSON.parse(await readFile(resolve(here, '..', '..', 'data', 'src', 'objects', surface.library, 'window', surface.name + '.json'), 'utf8'))
  const { file, errors } = parseScriptFile(await readFile(resolve(here, '..', '..', 'data', 'src', 'scripts', surface.library, surface.name + '.pbs'), 'utf8'))
  assert.deepEqual(errors, [], `Parse ${surface.name}`)
  const routines = {}
  for (const routine of file.routines) ((routines[routine.owner] ??= {})[routine.name] ??= []).push(routine)
  windows.push({ ...definition, fields: definition.fields.filter((field) => field.name !== 'control'), routines })
}
await writeFile(resolve(root, 'presentation-windows.json'), JSON.stringify(windows.filter((definition) =>
  WINDOW_SURFACES.some((surface) => surface.name === definition.name && !surface.data?.length))))
const tabDefinition = JSON.parse(await readFile(resolve(here, '..', '..', 'data', 'src', 'objects', 'components', 'window', 'w_multi_entry.json'), 'utf8'))
const { file: tabScripts, errors: tabErrors } = parseScriptFile(await readFile(resolve(here, '..', '..', 'data', 'src', 'scripts', 'components', 'w_multi_entry.pbs'), 'utf8'))
assert.deepEqual(tabErrors, [], 'Parse inherited entry-window tab scripts')
const tabControl = tabDefinition.controls.find((control) => control.name === 'tab_retrieve')
const findDefinition = JSON.parse(gunzipSync(await readFile(resolve(source, index.d_find + '.json.gz'))).toString('utf8')).d_find
const { file: searchScripts, errors: searchErrors } = parseScriptFile(await readFile(resolve(here, '..', '..', 'data', 'src', 'scripts', 'functions', 'f_binarysearch.pbs'), 'utf8'))
assert.deepEqual(searchErrors, [], 'Parse recovered live-search function')
await writeFile(resolve(root, 'presentation-tabs.json'), JSON.stringify({
  fields: tabControl.fields.filter((field) => ['selectedtab', 'taborder', 'visible', 'enabled'].includes(field.name)),
  pages: tabControl.controls.map((page) => ({ name: page.name, fields: page.fields.filter((field) => ['text', 'visible', 'enabled'].includes(field.name)) })),
  routines: tabScripts.routines.filter((routine) => routine.owner === 'tab_retrieve' && ['selectionchanging', 'selectionchanged'].includes(routine.name)),
  editChanged: tabScripts.routines.find((routine) => routine.owner === 'dw_detail' && routine.name === 'editchanged'),
  findChanged: tabScripts.routines.find((routine) => routine.owner === 'dw_find' && routine.name === 'editchanged'),
  searchRoutines: searchScripts.routines,
  findDefinition: { datawindow: findDefinition.datawindow, bands: findDefinition.bands, objects: findDefinition.objects, table: { columns: findDefinition.table.columns } },
}))
const metadata = (control) => ({
  name: control.name, ancestor: control.ancestor,
  // Preserve presentation metadata; attach models without data loading or window-open SQL.
  fields: control.fields.filter((field) => field.attr === '0xbc' && !['control', 'dataobject', 'menuname', 'item'].includes(field.name)),
  controls: control.controls.map(metadata),
})
const entryClasses = []
for (const [library, kind, name] of [
  ['components', 'window', 'w_entry_primitives'], ['components', 'window', 'w_multi_entry'],
  ['accounts', 'window', 'w_agingintervals'], ['components', 'userobject', 'u_dwstandard'],
]) {
  const definition = JSON.parse(await readFile(resolve(here, '..', '..', 'data', 'src', 'objects', library, kind, name + '.json'), 'utf8'))
  const routines = {}
  if (name === 'w_multi_entry') for (const routine of tabScripts.routines) {
    if ((routine.owner === 'tab_retrieve' && ['selectionchanging', 'selectionchanged'].includes(routine.name)) ||
      (['dw_detail', 'dw_find'].includes(routine.owner) && routine.name === 'editchanged') ||
      (['dw_detail', 'dw_itemsdetail'].includes(routine.owner) && ['itemchanged', 'itemerror'].includes(routine.name)) ||
      (routine.owner === 'dw_itemsdetail' && routine.name === 'itemfocuschanged') ||
      (routine.owner === 'w_multi_entry' && ['wf_filter', 'wf_sortdw', 'wf_grandtotal', 'ue_save'].includes(routine.name)) ||
      (['cb_filter', 'rb_ascending', 'rb_descending'].includes(routine.owner) && routine.name === 'clicked') ||
      (['ddlb_sort', 'ddlb_filter_column', 'ddlb_op', 'ddlb_data'].includes(routine.owner) && routine.name === 'selectionchanged')) {
      ((routines[routine.owner] ??= {})[routine.name] ??= []).push(routine)
    }
  }
  if (name === 'w_agingintervals' || name === 'w_entry_primitives') {
    const { file, errors } = parseScriptFile(await readFile(resolve(here, '..', '..', 'data', 'src', 'scripts', library, name + '.pbs'), 'utf8'))
    assert.deepEqual(errors, [], 'Parse aging field validation scripts')
    for (const routine of file.routines) {
      if ((routine.owner === name && (name === 'w_entry_primitives' ? routine.name === 'wf_tabnewid' :
        ['wf_validateitem', 'wf_duplicatename', 'ue_save', 'ue_newitem', 'ue_deleteitem'].includes(routine.name))) ||
        (name === 'w_agingintervals' && ['dw_detail', 'dw_itemsdetail'].includes(routine.owner) &&
          ['itemchanged', 'itemerror', 'itemfocuschanged', 'getfocus'].includes(routine.name))) {
        ((routines[routine.owner] ??= {})[routine.name] ??= []).push(routine)
      }
    }
  }
  entryClasses.push({ ...metadata(definition), kind, library, routines })
}
for (const name of ['vf_dwdupcode1', 'f_validatedw']) {
  const { file, errors } = parseScriptFile(await readFile(resolve(here, '..', '..', 'data', 'src', 'scripts', 'functions', name + '.pbs'), 'utf8'))
  assert.deepEqual(errors, [], `Parse ${name}`)
  const routines = {}
  for (const routine of file.routines) ((routines[routine.owner] ??= {})[routine.name] ??= []).push(routine)
  entryClasses.push({ name, kind: 'function', ancestor: 'function_object', library: 'functions', fields: [], controls: [], routines })
}
await writeFile(resolve(root, 'presentation-entry.json'), JSON.stringify(entryClasses))
// Generated window families (response windows, multi-entry and non-standard entry trees) get their own fixtures.
console.log('Derived window fixtures:', JSON.stringify(await buildDerivedFixtures({ here, outDir: root })))
// Reviewed single-entry masters plus generated ones that use the standard 22-control tree and a Detail form with its own List.
const singleSurfaces = ALL_ENTRY_WINDOW_SURFACES.filter((surface) => ENTRY_WINDOW_SURFACES.includes(surface) ? surface.family === 'single' : standardSingle(surface))
const singleClasses = entryClasses.filter((definition) => ['w_entry_primitives', 'u_dwstandard', 'f_validatedw'].includes(definition.name))
const { file: singleScripts, errors: singleErrors } = parseScriptFile(await readFile(resolve(here, '..', '..', 'data', 'src', 'scripts', 'components', 'w_single_entry.pbs'), 'utf8'))
assert.deepEqual(singleErrors, [], 'Parse single-entry presentation scripts')
for (const { name, library } of [{ name: 'w_single_entry', library: 'components' }, ...singleSurfaces]) {
  const definition = JSON.parse(await readFile(resolve(here, '..', '..', 'data', 'src', 'objects', library, 'window', name + '.json'), 'utf8'))
  const routines = {}
  if (name === 'w_single_entry') for (const routine of singleScripts.routines) {
    if ((routine.owner === 'tab_retrieve' && ['selectionchanging', 'selectionchanged'].includes(routine.name)) ||
      (['dw_detail', 'dw_find'].includes(routine.owner) && routine.name === 'editchanged') ||
      (routine.owner === 'dw_detail' && routine.name === 'itemchanged') ||
      (routine.owner === name && ['wf_filter', 'wf_sortdw'].includes(routine.name)) ||
      (['cb_filter', 'rb_ascending', 'rb_descending'].includes(routine.owner) && routine.name === 'clicked') ||
      (['ddlb_sort', 'ddlb_filter_column', 'ddlb_op', 'ddlb_data'].includes(routine.owner) && routine.name === 'selectionchanged')) {
      ((routines[routine.owner] ??= {})[routine.name] ??= []).push(routine)
    }
  }
  singleClasses.push({ ...metadata(definition), kind: 'window', library, routines })
}
const searchRoutines = {}
for (const routine of searchScripts.routines) ((searchRoutines[routine.owner] ??= {})[routine.name] ??= []).push(routine)
singleClasses.push({ name: 'f_binarysearch', kind: 'function', ancestor: 'function_object', library: 'functions', fields: [], controls: [], routines: searchRoutines })
const singleData = { d_find: { datawindow: findDefinition.datawindow, bands: findDefinition.bands, objects: findDefinition.objects, table: { columns: findDefinition.table.columns } } }
const singleBundles = new Map()
for (const surface of singleSurfaces) for (const binding of [surface.details[0].surface, surface.list]) {
  const library = index[binding.name]
  if (!singleBundles.has(library)) singleBundles.set(library, JSON.parse(gunzipSync(await readFile(resolve(source, library + '.json.gz'))).toString('utf8')))
  const definition = singleBundles.get(library)[binding.name]
  assert.deepEqual(dataSurfaceIssues(definition, binding), [], `${surface.name}/${binding.name}: fixture mapping must match recovered metadata`)
  singleData[binding.name] = { datawindow: definition.datawindow, bands: definition.bands, objects: definition.objects, table: { columns: definition.table.columns } }
}
await writeFile(resolve(root, 'presentation-single-entry.json'), JSON.stringify({
  classes: singleClasses, surfaces: singleSurfaces, data: singleData,
}))
const contactDefinition = JSON.parse(await readFile(resolve(here, '..', '..', 'data', 'src', 'objects', 'contactmanagement', 'window', 'w_contactgroup.json'), 'utf8'))
const { file: contactScripts, errors: contactErrors } = parseScriptFile(
  await readFile(resolve(here, '..', '..', 'data', 'src', 'scripts', 'contactmanagement', 'w_contactgroup.pbs'), 'utf8'))
assert.deepEqual(contactErrors, [], 'Parse contact-group presentation and member validation scripts')
const contactRoutines = {}
for (const routine of contactScripts.routines) {
  if ((routine.owner === 'w_contactgroup' && ['wf_validateitem', 'wf_setcontactdetails'].includes(routine.name)) ||
    (routine.owner === 'dw_itemsdetail' && ['itemchanged', 'itemerror', 'itemfocuschanged', 'getfocus'].includes(routine.name))) {
    ((contactRoutines[routine.owner] ??= {})[routine.name] ??= []).push(routine)
  }
}
const contactData = { d_find: singleData.d_find }
for (const name of ['d_contactgroup', 'd_contactgrouplist', 'd_contactgroupdetail', 'ddd_contactcardlist']) {
  const bundle = JSON.parse(gunzipSync(await readFile(resolve(source, index[name] + '.json.gz'))).toString('utf8'))
  const definition = bundle[name]
  contactData[name] = { datawindow: definition.datawindow, bands: definition.bands, objects: definition.objects,
    table: { columns: definition.table.columns } }
}
await writeFile(resolve(root, 'presentation-contact.json'), JSON.stringify({
  classes: [
    ...entryClasses.filter((definition) => ['w_entry_primitives', 'w_multi_entry', 'u_dwstandard', 'vf_dwdupcode1'].includes(definition.name)),
    { ...metadata(contactDefinition), kind: 'window', library: 'contactmanagement', routines: contactRoutines },
  ],
  data: contactData,
}))
const statementCatalog = JSON.parse(await readFile(resolve(here, '..', '..', 'data', 'sql', 'statements.json'), 'utf8'))
const associatedWindow = windows.find((definition) => definition.name === 'w_assocadvsaleinvlist_form')
const associatedStructure = JSON.parse(await readFile(resolve(here, '..', '..', 'data', 'src', 'objects',
  'salewin', 'structure', 's_dw_header.json'), 'utf8'))
const associatedStatements = statementCatalog.filter((statement) => statement.routine?.startsWith('w_assocadvsaleinvlist_form.'))
assert.ok(associatedWindow)
assert.equal(associatedStatements.length, 5)
assert.ok(associatedStatements.every((statement) => statement.status === 'translated' && statement.translated))
await writeFile(resolve(root, 'presentation-associated-invoices.json'), JSON.stringify({
  classes: [
    associatedWindow, { ...associatedStructure, routines: {} },
    ...entryClasses.filter((definition) => ['vf_dwdupcode1', 'f_validatedw'].includes(definition.name)),
  ],
  data: transactionData.d_assocadvsaleinvlist,
  statements: associatedStatements.map(({ original, translated, params, into, routine }) =>
    ({ original, sql: translated, params, into, routine })),
}))
const cashierSurface = WINDOW_SURFACES.find((surface) => surface.name === 'w_cashiershift_closing')
const cashierData = {}, cashierNames = [
  ...cashierSurface.data.map(({ surface }) => surface.name), 'd_currency_denominations', 'd_cashiershift_unpostedtrans',
  'ddd_currency', 'ddd_cashaccounts', 'ddd_users', 'ddd_cashbankaccounts_cashiershift', 'ddd_suspense_cashiershift',
]
for (const name of cashierNames) {
  const definition = JSON.parse(gunzipSync(await readFile(resolve(source, index[name] + '.json.gz'))))[name]
  const { retrieve, ...table } = definition.table
  cashierData[name] = { datawindow: definition.datawindow, bands: definition.bands, objects: definition.objects, table }
}
for (const { surface } of cashierSurface.data) {
  assert.deepEqual(dataSurfaceIssues(cashierData[surface.name], surface), [], `Exact cashier binding ${surface.name}`)
}
const cashierRetrieves = cashierNames.map((name) => {
  const statement = statementCatalog.find((statement) => statement.id === `dw:${index[name]}/${name}`)
  assert.equal(statement?.status, 'translated', `Cashier retrieve ${name}`)
  return { name, sql: statement.translated, params: statement.params }
})
const { file: preferenceScripts, errors: preferenceErrors } = parseScriptFile(
  await readFile(resolve(here, '..', '..', 'data', 'src', 'scripts', 'functions', 'f_numberpreferences.pbs'), 'utf8'))
assert.deepEqual(preferenceErrors, [])
const preferenceRoutines = {}
for (const routine of preferenceScripts.routines) ((preferenceRoutines[routine.owner] ??= {})[routine.name] ??= []).push(routine)
const transactionDefinition = JSON.parse(await readFile(resolve(here, '..', '..', 'data', 'src', 'objects',
  'components', 'userobject', 'u_transaction.json'), 'utf8'))
await writeFile(resolve(root, 'presentation-cashier.json'), JSON.stringify({
  classes: [
    windows.find((definition) => definition.name === cashierSurface.name),
    ...entryClasses.filter((definition) => ['u_dwstandard', 'f_validatedw'].includes(definition.name)),
    { ...metadata(transactionDefinition), kind: 'userobject', library: 'components', routines: {} },
    { name: 'f_numberpreferences', kind: 'function', ancestor: 'function_object', fields: [], controls: [], routines: preferenceRoutines },
  ],
  data: cashierData, retrieves: cashierRetrieves,
  statements: statementCatalog.filter((statement) => statement.status === 'translated' &&
    ['w_cashiershift_closing.open', 'w_cashiershift_closing.wf_getserverdatetime'].includes(statement.routine))
    .map(({ original, translated, params, into }) => ({ original, sql: translated, params, into })),
}))
const calculatorClasses = [], calculatorData = {}
const paymentSurface = WINDOW_SURFACES.find((surface) => surface.name === 'w_cashierjobactivity_cashtendered')
const paymentNames = [...paymentSurface.data.map(({ surface }) => surface.name),
  'd_cashierjobactivity_multiinvoice_print', 'd_cashierjobactivity_multiinv_print_tm']
const paymentData = {}
for (const name of paymentNames) {
  const definition = JSON.parse(gunzipSync(await readFile(resolve(source, index[name] + '.json.gz'))))[name]
  const { retrieve, ...table } = definition.table
  paymentData[name] = { ...definition, table }
}
for (const { surface } of paymentSurface.data) {
  assert.deepEqual(dataSurfaceIssues(paymentData[surface.name], surface), [], `Exact payment binding ${surface.name}`)
}
const { file: stringPreferences, errors: stringPreferenceErrors } = parseScriptFile(
  await readFile(resolve(here, '..', '..', 'data', 'src', 'scripts', 'functions', 'f_stringpreferences.pbs'), 'utf8'))
assert.deepEqual(stringPreferenceErrors, [])
assert.equal(stringPreferences.routines.length, 1)
const stringPreferenceRoutines = {}
for (const routine of stringPreferences.routines) ((stringPreferenceRoutines[routine.owner] ??= {})[routine.name] ??= []).push(routine)
const productionSql = JSON.parse(await readFile(resolve(root, 'data', 'sql.json'), 'utf8'))
const paymentProcs = Object.fromEntries(['sp_insert_cashieractivity', 'sp_supervise_cashieractivity'].map((name) => {
  assert.ok(productionSql.proc[name]?.call, `Built production signature ${name}`)
  return [name, productionSql.proc[name]]
}))
const paymentStatements = statementCatalog.filter((statement) =>
  statement.status === 'translated' &&
  ['open', 'ue_close', 'wf_get_document_info'].some((routine) => statement.routine === `${paymentSurface.name}.${routine}`))
assert.equal(paymentStatements.length, 4)
assert.ok(paymentStatements.every((statement) => statement.status === 'translated'))
await writeFile(resolve(root, 'presentation-payment.json'), JSON.stringify({
  classes: [
    windows.find((definition) => definition.name === paymentSurface.name),
    ...entryClasses.filter((definition) => ['u_dwstandard', 'f_validatedw'].includes(definition.name)),
    { ...metadata(transactionDefinition), kind: 'userobject', library: 'components', routines: {} },
    { name: 'f_stringpreferences', kind: 'function', ancestor: 'function_object', fields: [], controls: [], routines: stringPreferenceRoutines },
  ],
  data: paymentData, procs: paymentProcs,
  retrieves: paymentNames.map((name) => {
    assert.ok(productionSql.dw[name]?.sql, `Built payment retrieve ${name}`)
    return { name, ...productionSql.dw[name] }
  }),
  statements: paymentStatements.map(({ original, translated, params, into, routine }) => ({ original, sql: translated, params, into, routine })),
}))
const categorySurface = WINDOW_SURFACES.find((surface) => surface.name === 'w_cashierjobactivity_changecategory')
const categoryNames = ['d_cashierjobactivity_changecategory', 'ddd_cashierjob_cashcredit', 'ddd_allaccounts']
const categoryData = {}
for (const name of categoryNames) {
  const definition = JSON.parse(gunzipSync(await readFile(resolve(source, index[name] + '.json.gz'))))[name]
  const { retrieve, ...table } = definition.table
  categoryData[name] = { ...definition, table }
}
assert.deepEqual(dataSurfaceIssues(categoryData[categoryNames[0]], categorySurface.data[0].surface), [])
const { file: groupScripts, errors: groupErrors } = parseScriptFile(
  await readFile(resolve(here, '..', '..', 'data', 'src', 'scripts', 'functions', 'f_getgroupcode.pbs'), 'utf8'))
assert.deepEqual(groupErrors, [])
assert.equal(groupScripts.routines.length, 2)
const groupRoutines = {}
for (const routine of groupScripts.routines) ((groupRoutines[routine.owner] ??= {})[routine.name] ??= []).push(routine)
const categoryDefinition = windows.find((definition) => definition.name === categorySurface.name)
const assignments = (node) => node && typeof node === 'object' ?
  [node, ...Object.values(node).flatMap(assignments)] : []
const filterBuffer = assignments(categoryDefinition.routines[categorySurface.name].wf_filteraccounts[0].body)
  .find((node) => node.k === 'assign' && node.l?.n === 'ls_custfilterstring' && /^0 +$/.test(node.r?.v))?.r.v
assert.ok(filterBuffer)
const categoryStatements = statementCatalog.filter((statement) => statement.status === 'translated' &&
  [`${categorySurface.name}.open`, 'f_getgroupcode.f_getgroupcode'].includes(statement.routine))
assert.equal(categoryStatements.length, 2)
assert.ok(productionSql.proc.sp_getallowedgroupcustomercategory?.call)
await writeFile(resolve(root, 'presentation-category.json'), JSON.stringify({
  classes: [
    categoryDefinition,
    ...entryClasses.filter((definition) => ['u_dwstandard', 'f_validatedw'].includes(definition.name)),
    { ...metadata(transactionDefinition), kind: 'userobject', library: 'components', routines: {} },
    { name: 'f_stringpreferences', kind: 'function', ancestor: 'function_object', fields: [], controls: [], routines: stringPreferenceRoutines },
    { name: 'f_getgroupcode', kind: 'function', ancestor: 'function_object', fields: [], controls: [], routines: groupRoutines },
  ],
  data: categoryData, filterBuffer,
  procs: { ...paymentProcs, sp_getallowedgroupcustomercategory: productionSql.proc.sp_getallowedgroupcustomercategory },
  retrieves: categoryNames.map((name) => {
    assert.ok(productionSql.dw[name]?.sql, `Built category retrieve ${name}`)
    return { name, ...productionSql.dw[name] }
  }),
  statements: categoryStatements.map(({ original, translated, params, into, routine }) => ({ original, sql: translated, params, into, routine })),
}))
for (const [name, library, kind] of [
  ...CALCULATOR_WINDOW_SURFACES.map((surface) => [surface.name, surface.library, 'window']),
  ['f_setcolumnstyle', 'functions', 'function'], ['f_get_colprecision', 'functions', 'function'],
]) {
  const { file, errors } = parseScriptFile(await readFile(resolve(here, '..', '..', 'data', 'src', 'scripts', library, name + '.pbs'), 'utf8'))
  assert.deepEqual(errors, [], `Parse original calculator script ${name}`)
  const routines = {}
  for (const routine of file.routines) ((routines[routine.owner] ??= {})[routine.name] ??= []).push(routine)
  const definition = kind === 'window' ?
    JSON.parse(await readFile(resolve(here, '..', '..', 'data', 'src', 'objects', library, kind, name + '.json'), 'utf8')) :
    { name, kind, ancestor: 'function_object', library, fields: [], controls: [] }
  calculatorClasses.push({ ...definition, fields: definition.fields.filter((field) => field.name !== 'control'), routines })
}
for (const window of CALCULATOR_WINDOW_SURFACES) for (const { surface } of window.data) {
  const definition = JSON.parse(gunzipSync(await readFile(resolve(source, index[surface.name] + '.json.gz'))).toString('utf8'))[surface.name]
  assert.deepEqual(dataSurfaceIssues(definition, surface), [], `Exact calculator binding ${surface.name}`)
  calculatorData[surface.name] = { datawindow: definition.datawindow, bands: definition.bands, objects: definition.objects,
    table: { columns: definition.table.columns } }
}
const calculatorStatements = statementCatalog.filter((statement) =>
  ['w_pricecalculator.open', 'w_discountcalculator.open', 'w_qty_rate_value_calculator.open', 'f_setcolumnstyle.f_setcolumnstyle'].includes(statement.routine))
const calculatorRetrieve = statementCatalog.find((statement) => statement.id === 'dw:salerespwin/d_set_flatdiscamt')
assert.equal(calculatorStatements.length, 4)
assert.ok(calculatorRetrieve && [...calculatorStatements, calculatorRetrieve].every((statement) => statement.status === 'translated' && statement.translated))
await writeFile(resolve(root, 'presentation-calculators.json'), JSON.stringify({
  classes: calculatorClasses, data: calculatorData, surfaces: CALCULATOR_WINDOW_SURFACES,
  statements: calculatorStatements.map(({ original, translated, params, into }) => ({ original, sql: translated, params, into })),
  retrieve: { sql: calculatorRetrieve.translated, params: calculatorRetrieve.params },
}))
const cardDefinition = JSON.parse(await readFile(resolve(here, '..', '..', 'data', 'src', 'objects', 'contactmanagement', 'window', 'w_contactcard_form.json'), 'utf8'))
const { file: cardScripts, errors: cardErrors } = parseScriptFile(
  await readFile(resolve(here, '..', '..', 'data', 'src', 'scripts', 'contactmanagement', 'w_contactcard_form.pbs'), 'utf8'))
assert.deepEqual(cardErrors, [], 'Parse Contact Card account-copy and keyboard scripts')
const cardRoutines = {}
for (const routine of cardScripts.routines) {
  if (routine.owner === 'w_contactcard_form' && routine.name === 'wf_validateaccount' ||
    routine.owner === 'dw_detail' && ['itemchanged', 'ue_enterkey'].includes(routine.name)) {
    ((cardRoutines[routine.owner] ??= {})[routine.name] ??= []).push(routine)
  }
}
const cardData = { d_find: singleData.d_find }
for (const name of ['d_contactcarddetail', 'd_contactcardlist', 'ddd_allaccountslist_null']) {
  const bundle = JSON.parse(gunzipSync(await readFile(resolve(source, index[name] + '.json.gz'))).toString('utf8'))
  const definition = bundle[name]
  cardData[name] = { datawindow: definition.datawindow, bands: definition.bands, objects: definition.objects,
    table: { columns: definition.table.columns } }
}
const cardStatements = statementCatalog.filter((statement) => statement.routine === 'w_contactcard_form.wf_validateaccount')
assert.equal(cardStatements.length, 3, 'Contact Card needs its exact account, customer and supplier queries')
assert.ok(cardStatements.every((statement) => statement.status === 'translated' && statement.translated))
await writeFile(resolve(root, 'presentation-contact-card.json'), JSON.stringify({
  classes: [
    ...entryClasses.filter((definition) => ['w_entry_primitives', 'w_multi_entry', 'u_dwstandard'].includes(definition.name)),
    { ...metadata(cardDefinition), kind: 'window', library: 'contactmanagement', routines: cardRoutines },
  ],
  data: cardData,
  statements: cardStatements.map(({ original, translated, params, into }) => ({ original, sql: translated, params, into })),
}))
const entryStatements = statementCatalog.filter((statement) =>
  ['w_agingintervals.wf_duplicatename', 'w_entry_primitives.wf_tabnewid'].includes(statement.routine))
assert.equal(entryStatements.length, 4, 'The aging save fixture requires its four exact translated statements')
assert.ok(entryStatements.every((statement) => statement.status === 'translated' && statement.translated))
const entryTables = {}
for (const name of ['d_aginginterval', 'd_agingintervaldetail']) {
  const bundle = JSON.parse(gunzipSync(await readFile(resolve(source, index[name] + '.json.gz'))).toString('utf8'))
  const { retrieve, ...table } = bundle[name].table
  entryTables[name] = table
}
await writeFile(resolve(root, 'presentation-entry-sql.json'), JSON.stringify({
  statements: entryStatements.map(({ original, translated, params, into, routine }) => ({ original, sql: translated, params, into, routine })),
  tables: entryTables,
}))
if (process.argv[4] === '--fixtures-only') {
  console.log('Prepared synthetic presentation fixtures without starting a browser or changing result artifacts.')
  process.exit(0)
}
await mkdir(output, { recursive: true })
const focusedLookups = process.argv[4] === '--editable-lookups-only'
const focusedBands = process.argv[4] === '--transaction-bands-only'
const focusedInvoices = process.argv[4] === '--associated-invoices-only'
const focusedCashier = process.argv[4] === '--cashier-only'
const focusedPayment = process.argv[4] === '--payment-only'
const focusedCategory = process.argv[4] === '--category-only'
const focusedColors = process.argv[4] === '--forced-colors-only'
const focusedCriteria = process.argv[4] === '--criteria-only'
const focusedCriteriaWindows = process.argv[4] === '--criteria-windows-only'
const focusedDateOptions = process.argv[4] === '--date-options-only'
const focusedDateChoices = process.argv[4] === '--date-choices-only'
const focusedCalendar = process.argv[4] === '--calendar-only'
const focusedDataWindowCalendar = process.argv[4] === '--datawindow-calendar-only'
const focusedDateNames = focusedCalendar ? ['w_arg_sdate', 'w_arg_sdate_notime', 'w_arg_sdate_ldate', 'w_arg_ason'] :
  (focusedDateChoices ? DATE_CHOICE_CRITERIA_WINDOWS :
  focusedDateOptions ? DATE_OPTION_CRITERIA_WINDOWS : []).map((owner) => owner.name)
const criteriaWindowResult = focusedCalendar ? 'calendar-result.json' : focusedDateChoices ? 'date-choice-result.json' :
  focusedDateOptions ? 'date-option-result.json' : 'criteria-window-result.json'
const focusedPrint = process.argv[4] === '--print-only'
const focusedSingleEntry = process.argv[4] === '--single-entry-only'
await Promise.all([focusedSingleEntry ? 'single-entry-result.json' : focusedDataWindowCalendar ? 'datawindow-calendar-result.json' : focusedPrint ? 'print-result.json' : focusedDateNames.length || focusedCriteriaWindows ? criteriaWindowResult : focusedCriteria ? 'criteria-result.json' : focusedColors ? 'forced-colors-result.json' : focusedCategory ? 'category-result.json' : focusedPayment ? 'payment-result.json' : focusedCashier ? 'cashier-result.json' : focusedInvoices ? 'associated-invoice-result.json' : focusedBands ? 'transaction-band-result.json' : focusedLookups ? 'editable-lookup-result.json' : 'result.json', 'failure.png', 'failure-state.json']
  .map((name) => rm(resolve(output, name), { force: true })))
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.ttf': 'font/ttf' }
const server = createServer(async (request, response) => {
  try {
    if (request.method !== 'GET' && request.method !== 'HEAD') { response.writeHead(405).end(); return }
    const url = new URL(request.url, 'http://localhost')
    const file = resolve(root, '.' + decodeURIComponent(url.pathname))
    if (!file.startsWith(root + sep)) { response.writeHead(403).end(); return }
    const bytes = await readFile(file)
    response.writeHead(200, { 'content-type': mime[extname(file)] || 'application/octet-stream' })
    response.end(request.method === 'HEAD' ? undefined : bytes)
  } catch (error) {
    response.writeHead(error.code === 'ENOENT' ? 404 : 500).end('Fixture resource unavailable')
  }
})
server.listen(0, '127.0.0.1')
await once(server, 'listening')
let browser
try {
  const origin = `http://127.0.0.1:${server.address().port}`
  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 }, locale: 'en-US', reducedMotion: 'reduce' })
  await page.addInitScript(() => {
    window.fixtureNativeAccess = 0
    const forbiddenNative = () => {
      window.fixtureNativeAccess++
      throw new Error('The browser fixture must not call its containing desktop bridge')
    }
    window.__TAURI_INTERNALS__ = { invoke: forbiddenNative }
    window.__TAURI__ = { window: { getCurrentWindow: forbiddenNative } }
  })
  const pageErrors = []
  const forbidden = []
  // Settings files a window's scripts read (FileOpen, ProfileString) do not exist in the synthetic pass: the read is answered here as
  // a missing file and listed in the result; every other server API (the database above all) stays forbidden.
  const fileReads = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url())
    if (url.origin === origin && url.pathname === '/api/fs/read') {
      let path = ''
      try { path = String(JSON.parse(route.request().postData() || '{}').path ?? '') } catch { /* unreadable body */ }
      fileReads.push(path)
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ exists: false }) })
    }
    if (url.origin !== origin || url.pathname.startsWith('/api/')) {
      forbidden.push(url.pathname)
      return route.abort()
    }
    return route.continue()
  })
  await page.goto(origin + '/presentation.html')
  await page.waitForFunction(() => window.presentationFixtureReady)
  // Accessibility of the generated Modern dialogs on its own (CI runs it as a separate step so a failure elsewhere cannot hide it).
  if (process.argv[4] === '--accessibility-only') {
    const names = representativeModalWindows()
    await page.evaluate(async (names) => { window.derivedFilter = names; await window.runDerivedChecks() }, names)
    const failures = []
    try { await captureDerivedModalWindows(page, output, names, failures) } catch (error) { failures.push(String(error?.message ?? error)) }
    const serious = axeCases.flatMap((item) => item.violations.filter((violation) => ['serious', 'critical'].includes(violation.impact))
      .map((violation) => `${item.label}: ${violation.id} (${violation.impact}, ${violation.nodes} nodes, ${violation.sample})`))
    const moderate = axeCases.flatMap((item) => item.violations.filter((violation) => !['serious', 'critical'].includes(violation.impact)).map((violation) => `${item.label}: ${violation.id} (${violation.impact})`))
    await writeFile(resolve(output, 'accessibility-result.json'), JSON.stringify({ scanner: axeSource ? 'axe-core' : 'not installed', windows: names.length, cases: axeCases, failures }, null, 2) + '\n')
    console.log(axeSource ? `Accessibility: ${names.length} generated dialogs, ${axeCases.length} appearances scanned; ${serious.length} serious or critical and ${moderate.length} other WCAG violations; ${failures.length} appearance check failures.` : 'Accessibility: axe-core not installed.')
    for (const line of [...serious, ...moderate].slice(0, 60)) console.log('  ' + line)
    for (const line of failures.slice(0, 60)) console.log('  Appearance check failure: ' + String(line).slice(0, 400))
    await browser.close(); server.close(); process.exit(serious.length || failures.length || !axeSource ? 1 : 0)
  }
  // Focused run of the generated-family checks for the named windows/DataWindows (argv[5..]); a development aid, not an acceptance pass.
  if (process.argv[4] === '--derived-only') {
    const outcome = await page.evaluate(async (names) => {
      const dump = names.find((name) => name.startsWith('dump='))
      if (dump) { window.derivedDump = dump.slice(5); names = names.filter((name) => name !== dump) }
      window.derivedFilter = names.length ? names : undefined
      const result = await window.runDerivedChecks()
      return { passed: result.passed, failures: result.failures.map((failure) => String(failure).slice(0, 300)), errors: result.errors, dump: window.derivedDumpResult }
    }, process.argv.slice(5))
    console.log(JSON.stringify(outcome, null, 1))
    await browser.close(); server.close(); process.exit(0)
  }
  // Stall watchdog: logs progress each minute and fails the pass, with the page state, when no assertion has been counted for
  // ten minutes, so a stuck window is reported instead of hanging silently.
  let lastPassed = -1
  let stalledSince = Date.now()
  const watchdog = setInterval(async () => {
    const snapshot = await Promise.race([
      page.evaluate(() => ({ passed: window.presentationCheckProgress?.passed ?? 0, failures: window.presentationCheckProgress?.failures?.length ?? 0, failureNames: (window.presentationCheckProgress?.failures ?? []).slice(0, 60),
        windows: document.querySelectorAll('.pbwin').length, active: document.activeElement?.outerHTML?.slice(0, 200) })).catch(() => null),
      new Promise((done) => setTimeout(() => done(null), 20000)),
    ])
    if (snapshot && snapshot.passed !== lastPassed) { lastPassed = snapshot.passed; stalledSince = Date.now() }
    console.log(`[progress] ${new Date().toISOString()} passed=${snapshot?.passed ?? 'page unresponsive'} failures=${snapshot?.failures ?? '?'} windows=${snapshot?.windows ?? '?'}`)
    if (snapshot?.failureNames?.length) console.log(`[failures so far] ${JSON.stringify(snapshot.failureNames)}`)
    if (Date.now() - stalledSince > 5 * 60 * 1000) {
      console.error('[watchdog] no progress for five minutes; last state:', JSON.stringify(snapshot))
      try { await page.screenshot({ path: resolve(output, 'failure.png'), timeout: 10000 }) } catch {}
      try { await writeFile(resolve(output, 'failure-state.json'), JSON.stringify({ stalled: true, snapshot }, null, 2) + '\n') } catch {}
      process.exit(3)
    }
  }, 60000)
  watchdog.unref()
  const result = await page.evaluate(({ focusedLookups, focusedBands, focusedInvoices, focusedCashier, focusedPayment, focusedCategory, focusedColors, focusedCriteria, focusedCriteriaWindows, focusedDateNames, focusedPrint, focusedDataWindowCalendar, focusedSingleEntry }) =>
    focusedSingleEntry ? window.runSingleEntryChecks() : focusedDataWindowCalendar ? window.runDataWindowCalendarChecks() : focusedPrint ? window.runPrintChecks() : focusedDateNames.length ? window.runCriteriaWindowChecks(focusedDateNames) : focusedCriteriaWindows ? window.runCriteriaWindowChecks() : focusedCriteria ? window.runCriteriaChecks() : focusedColors ? window.runForcedColorChecks() : focusedCategory ? window.runCategoryChecks() : focusedPayment ? window.runPaymentChecks() :
    focusedCashier ? window.runCashierChecks() :
    focusedInvoices ? window.runAssociatedInvoiceChecks() :
    focusedBands ? window.runTransactionBandChecks() :
    focusedLookups ? window.runEditableLookupChecks() : window.runPresentationChecks(), { focusedLookups, focusedBands, focusedInvoices, focusedCashier, focusedPayment, focusedCategory, focusedColors, focusedCriteria, focusedCriteriaWindows, focusedDateNames, focusedPrint, focusedDataWindowCalendar, focusedSingleEntry })
  assert.deepEqual(result.failures, [], JSON.stringify(result))
  assert.deepEqual(result.errors, [], 'Runtime fixture errors must not be hidden by passing assertions')
  assert.deepEqual(pageErrors, [])
  assert.deepEqual(forbidden, [], 'Synthetic checks must not access a database or external server')
  if (fileReads.length) console.log(`Settings files read by window scripts (answered as missing): ${fileReads.length} (${[...new Set(fileReads)].slice(0, 10).join(', ')})`)
  assert.equal(await page.evaluate(() => window.fixtureNativeAccess), 0, 'Injected theme fixture must not access native globals')
  const nativeRequests = await page.evaluate(() => window.presentationNativeThemes.length)
  if (focusedSingleEntry) {
    await writeFile(resolve(output, 'single-entry-result.json'),
      JSON.stringify({ ...result, singleEntryCases: [], pageErrors, forbidden }, null, 2) + '\n')
    console.log(`Single entry: ${result.passed} assertions.`)
  } else if (focusedDataWindowCalendar) {
    await checkDataWindowCalendarInput(page)
    const dataWindowCalendarCases = await captureCalendars(page, output, true)
    assert.deepEqual(pageErrors, []); assert.deepEqual(forbidden, [])
    assert.equal(await page.evaluate(() => window.fixtureNativeAccess), 0)
    await writeFile(resolve(output, 'datawindow-calendar-result.json'),
      JSON.stringify({ ...result, dataWindowCalendarCases, pageErrors, forbidden }, null, 2) + '\n')
    console.log(`DataWindow calendar: ${result.passed} assertions; ${dataWindowCalendarCases.length} appearances.`)
  } else if (focusedPrint) {
    const printSettingsCases = await capturePrintSettings(page, output)
    const printDocumentCases = await capturePrintDocuments(page, output)
    assert.deepEqual(pageErrors, []); assert.deepEqual(forbidden, [])
    assert.equal(await page.evaluate(() => window.fixtureNativeAccess), 0)
    await writeFile(resolve(output, 'print-result.json'), JSON.stringify({ ...result, printSettingsCases, printDocumentCases, pageErrors, forbidden }, null, 2) + '\n')
    console.log(`Print: ${result.passed} assertions; ${printSettingsCases.length} settings and ${printDocumentCases.length} document appearances; no printer access.`)
  } else if (focusedCriteriaWindows || focusedDateNames.length) {
    if (!focusedDateNames.length) {
      await checkItemSelectionInput(page)
      await checkNativeDateInput(page)
      await checkLookupCriteriaInput(page)
      await checkReferenceCriteriaInput(page)
      await checkNumericCriteriaInput(page)
    }
    if (!focusedDateChoices && !focusedCalendar) await checkDateOptionInput(page)
    if (!focusedDateOptions && !focusedCalendar) await checkDateChoiceInput(page)
    if (focusedDateChoices) await checkNativeDateInput(page, ['w_arg_ason'])
    if (focusedCalendar) await checkCalendarInput(page)
    const calendarCases = focusedCalendar ? await captureCalendars(page, output) : []
    const criteriaWindowCases = focusedCalendar ? [] : await captureCriteriaWindows(page, output, focusedDateNames.length ?
      CRITERIA_WINDOW_SURFACES.filter((surface) => focusedDateNames.includes(surface.name)) : undefined)
    assert.deepEqual(pageErrors, [])
    assert.deepEqual(forbidden, [])
    assert.equal(await page.evaluate(() => window.fixtureNativeAccess), 0)
    await writeFile(resolve(output, criteriaWindowResult), JSON.stringify({ ...result, criteriaWindowCases, calendarCases, pageErrors, forbidden }, null, 2) + '\n')
    console.log(`Criteria windows: ${result.passed} assertions; ${criteriaWindowCases.length} criteria and ${calendarCases.length} calendar appearance cases.`)
  } else if (focusedCriteria) {
    const criteriaCases = await captureCriteria(page, output)
    assert.deepEqual(pageErrors, [])
    assert.deepEqual(forbidden, [])
    assert.equal(await page.evaluate(() => window.fixtureNativeAccess), 0)
    await writeFile(resolve(output, 'criteria-result.json'), JSON.stringify({ ...result, criteriaCases, pageErrors, forbidden }, null, 2) + '\n')
    console.log(`Criteria: ${result.passed} assertions; ${criteriaCases.length} appearance cases.`)
  } else if (focusedColors) {
    const forcedColors = await checkForcedColors(page, output)
    await writeFile(resolve(output, 'forced-colors-result.json'), JSON.stringify({ ...result,
      forcedColors, pageErrors, forbidden }, null, 2) + '\n')
    assert.deepEqual(forcedColors.failures, [])
    assert.deepEqual(pageErrors, [])
    assert.deepEqual(forbidden, [])
    assert.equal(await page.evaluate(() => window.fixtureNativeAccess), 0)
    console.log(`Forced colors: ${forcedColors.passed} assertions; ${forcedColors.cases.length} system-palette/viewport cases.`)
  } else {
  const categoryCases = []
  if (!focusedLookups && !focusedBands && !focusedInvoices && !focusedCashier && !focusedPayment) {
    for (const partial of [true, false]) for (const [theme, scale, width, height] of [
      ['light', 100, 1366, 768], ['dark', 200, 1366, 768], ['dark', 200, 683, 384], ['dark', 200, 320, 768],
    ]) {
      await page.setViewportSize({ width, height })
      await page.evaluate(async ({ theme, scale }) => {
        await window.openCategoryPreview()
        const f = window.categoryPreview
        for (const element of [f.view.el, f.dw.root]) {
          element.dataset.theme = theme; element.dataset.density = 'comfortable'
          element.style.setProperty('--p-scale', String(scale / 100))
        }
        await f.dw.render()
      }, { theme, scale })
      const modal = page.locator('.presentation-modern-dialog[open]')
      const form = modal.locator('[data-window-data=dw_control]')
      await form.locator('[data-obj=cashtendered]').click()
      await form.locator('input.dw-edit').fill(partial ? '50' : '150')
      await form.locator('input.dw-edit').press('Tab')
      await page.waitForFunction((partial) => Number(window.categoryPreview.model.getItem(1, 'cashtendered')) === (partial ? 50 : 150), partial)
      if (await form.locator('.dw-edit').count()) await form.locator('.dw-edit').press('Escape')
      await form.locator('[data-obj=cashback]').focus()
      await page.evaluate(() => window.categoryPreview.dw.render())
      const appearance = await (await page.waitForFunction((partial) => {
        const element = window.categoryPreview.dw.root.querySelector('[data-obj=cashback]')
        if (!element?.isConnected || document.activeElement !== element ||
          element.textContent.trim() !== (partial ? '0' : '30')) return false
        const r = element.getBoundingClientRect(), s = getComputedStyle(element)
        if (!r.width || !r.height || s.outlineStyle === 'none' || parseFloat(s.outlineWidth) < 2) return false
        return { visible: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight,
          value: element.textContent.trim(), fontSize: parseFloat(s.fontSize) }
      }, partial)).jsonValue()
      assert.ok(appearance.visible && appearance.value === (partial ? '0' : '30'), JSON.stringify(appearance))
      assert.equal(appearance.fontSize, 14 * scale / 100)
      assert.match(await modal.ariaSnapshot(), /dialog "Change Category"/)
      const contrast = await visibleContrast(modal.locator('.modern-window'))
      assert.ok(contrast.length && contrast.every((ratio) => ratio >= 4.5), 'Category text meets contrast requirements')
      await page.screenshot({ path: resolve(output, `category-${partial ? 'credit' : 'cash'}-${theme}-${scale}-${width}.png`) })
      if (width === 320) {
        assert.ok(await page.evaluate(async () => {
          const f = window.categoryPreview
          f.view.el.scrollTop = 0
          await f.dw.render()
          return f.view.el.scrollTop === 0
        }), 'Repainting a manually scrolled-away field does not pull it back into view')
      }
      for (const button of await modal.locator('button:enabled').all()) {
        await button.focus()
        assert.ok(await button.evaluate((element) => {
          const r = element.getBoundingClientRect(), s = getComputedStyle(element)
          return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight &&
            s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) >= 2
        }), 'Category actions remain visible and keyboard-focusable at enlarged narrow sizes')
      }
      await modal.getByRole('button', { name: 'Cancel', exact: true }).click()
      await page.waitForFunction(() => !window.categoryPreview.window.isOpen)
      assert.equal(await page.evaluate(() => window.categoryPreview.calls.filter((call) => call.kind === 'update' || call.kind === 'supervise').length), 0)
      await page.evaluate(() => window.categoryPreview.close())
      categoryCases.push({ partial, theme, scale, width, height, ...appearance, minimumTextContrast: Math.min(...contrast) })
    }
    await page.setViewportSize({ width: 1366, height: 768 })
    await page.evaluate(() => window.openCategoryPreview())
    const modal = page.locator('.presentation-modern-dialog[open]')
    const form = modal.locator('[data-window-data=dw_control]')
    await form.locator('[data-obj=cashtendered]').click()
    await form.locator('input.dw-edit').fill('50'); await form.locator('input.dw-edit').press('Enter')
    await page.waitForFunction(() => {
      const f = window.categoryPreview
      return Number(f.model.getItem(1, 'cashtendered')) === 50 && f.model.col === f.model.colIndex('catcode') + 1
    })
    await form.locator('select.dw-edit').selectOption({ label: 'Cash' })
    await page.waitForFunction(() => window.categoryPreview.model.getItem(1, 'catcode') === 1 &&
      window.categoryPreview.model.getItem(1, 'acccode') === 19)
    await form.locator('[data-obj=acccode]').click()
    await page.waitForFunction(() => window.categoryPreview.dw.choiceEdit?.options?.items.length === 3)
    await form.locator('.dw-choice-toggle').click()
    assert.deepEqual(await form.locator('.dw-choice-popup [role=option]').allTextContents(),
      ['Synthetic account choice', 'Synthetic cash customer', 'Synthetic credit customer'])
    await form.getByRole('option', { name: 'Synthetic account choice', exact: true }).click()
    await page.waitForFunction(() => window.categoryPreview.model.getItem(1, 'acccode') === 42)
    await form.locator('[data-obj=cashtendered]').click()
    await form.locator('input.dw-edit').fill('99'); await form.locator('input.dw-edit').press('Escape')
    assert.equal(await page.evaluate(() => Number(window.categoryPreview.model.getItem(1, 'cashtendered'))), 50)
    assert.ok(await page.evaluate(() => window.categoryPreview.window.isOpen), 'First Escape cancels only the pending field draft')
    await form.locator('[data-obj=cashtendered]').press('Escape')
    await page.waitForFunction(() => !window.categoryPreview.window.isOpen)
    assert.equal(await page.evaluate(() => window.categoryPreview.calls.filter((call) => call.kind === 'commit').length), 0)
    await page.evaluate(() => window.categoryPreview.close())
  }
  if (focusedCategory) {
    assert.deepEqual(pageErrors, []); assert.deepEqual(forbidden, [])
    assert.equal(await page.evaluate(() => window.fixtureNativeAccess), 0)
    await writeFile(resolve(output, 'category-result.json'), JSON.stringify({ ...result, categoryCases, pageErrors, forbidden }, null, 2) + '\n')
    console.log(`Cashier category: ${result.passed} assertions and ${categoryCases.length} appearance cases.`)
    await browser.close(); await new Promise((resolve) => server.close(resolve))
    process.exit(0)
  }
  const paymentCases = []
  if (!focusedLookups && !focusedBands && !focusedInvoices && !focusedCashier) {
    for (const returns of [false, true]) for (const [theme, scale, width, height] of [
      ['light', 100, 1366, 768], ['dark', 200, 1366, 768], ['dark', 200, 683, 384], ['dark', 200, 320, 768],
    ]) {
      await page.setViewportSize({ width, height })
      await page.evaluate(async ({ returns, theme, scale }) => {
        await window.openPaymentPreview(returns)
        const f = window.paymentPreview
        for (const element of [f.view.el, f.views.dw_header.root, f.views.dw_cash.root]) {
          element.dataset.theme = theme; element.dataset.density = 'comfortable'
          element.style.setProperty('--p-scale', String(scale / 100))
        }
        await f.views.dw_header.render(); await f.views.dw_cash.render()
      }, { returns, theme, scale })
      const modal = page.locator('.presentation-modern-dialog[open]')
      const cash = modal.locator('[data-window-data=dw_cash]')
      // A trace of the cash DataWindow's editor, focus and paint, printed if the entry does not behave
      await page.evaluate(() => {
        const view = window.paymentPreview.views.dw_cash, log = window.__cashLog = []
        const state = () => `editor=${view.editor ? `${view.editor.tagName}:${view.editObj}` : '-'} col=${view.ctl.model?.col} focus=${document.activeElement?.tagName}.${document.activeElement?.className ?? ''}`
        for (const name of ['edit', 'focusCurrent', 'render', 'retainStaleDraft', 'rowClick']) {
          const original = view[name]
          if (typeof original !== 'function') continue
          view[name] = function (...args) { log.push(`${name} ${state()}`); return original.apply(this, args) }
        }
        document.addEventListener('focusin', (event) => log.push(`focusin ${event.target?.tagName}.${event.target?.className ?? ''}`), { capture: true })
      })
      try {
        await cash.locator('[data-obj=cashtendered]').click()
        await cash.locator('input').fill(returns ? '250' : '100'); await cash.locator('input').press('Tab', { timeout: 10000 })
      } catch (error) {
        console.log('cash entry trace:\n' + (await page.evaluate(() => (window.__cashLog ?? []).join('\n'))))
        throw error
      }
      await page.waitForFunction((returns) => {
        const model = window.paymentPreview.controls.dw_cash.model
        return model.getItem(1, 'cashback') !== null && Number(model.getItem(1, 'cashback')) === (returns ? 0 : 30) &&
          Number(model.getItem(1, 'cashtendered')) === (returns ? 250 : 100) &&
          Number(model.getItem(1, 'cashcharged')) === (returns ? 250 : 70)
      }, returns)
      await cash.locator('[data-obj=cashback]').focus()
      const appearance = await (await page.waitForFunction(() => {
        const element = window.paymentPreview.views.dw_cash.root.querySelector('[data-obj=cashback]')
        if (!element?.isConnected || document.activeElement !== element || !element.textContent.trim()) return false
        const r = element.getBoundingClientRect(), s = getComputedStyle(element)
        if (!r.width || !r.height || s.outlineStyle === 'none' || parseFloat(s.outlineWidth) < 2) return false
        return { visible: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight,
          value: element.textContent.trim(), fontSize: parseFloat(s.fontSize) }
      })).jsonValue()
      assert.ok(appearance.visible && appearance.value === (returns ? '0' : '30'), JSON.stringify(appearance))
      assert.equal(appearance.fontSize, 14 * scale / 100)
      assert.match(await modal.ariaSnapshot(), /dialog "Cash Tendered Window for Multiple Invoices"/)
      assert.equal(await modal.locator('.window-auxiliary:visible').count(), 0, 'Hidden print companion stays out of the payment interface')
      const contrast = await visibleContrast(modal.locator('.modern-window'))
      assert.ok(contrast.length && contrast.every((ratio) => ratio >= 4.5), 'Payment text meets contrast requirements')
      await page.screenshot({ path: resolve(output, `payment-${returns ? 'return' : 'sale'}-${theme}-${scale}-${width}.png`) })
      for (const button of await modal.locator('button:enabled').all()) {
        await button.focus()
        assert.ok(await button.evaluate((element) => {
          const r = element.getBoundingClientRect(), s = getComputedStyle(element)
          return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight &&
            s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) >= 2
        }), 'Payment actions remain visible and keyboard-focusable at enlarged narrow sizes')
      }
      await modal.getByRole('button', { name: 'Cancel', exact: true }).click()
      await page.waitForFunction(() => !window.paymentPreview.window.isOpen)
      assert.equal(await page.evaluate(() => window.paymentPreview.calls.filter((call) => call.kind === 'supervise').length), 0)
      await page.evaluate(() => window.paymentPreview.close())
      paymentCases.push({ returns, theme, scale, width, height, ...appearance, minimumTextContrast: Math.min(...contrast) })
    }
    await page.setViewportSize({ width: 1366, height: 768 })
    await page.evaluate(async () => {
      await window.openPaymentPreview()
      const f = window.paymentPreview, original = f.window.rt.fire
      window.paymentRowEvents = []
      f.window.rt.fire = async (target, event, args) => {
        const value = await original(target, event, args)
        if (target === f.controls.dw_header && event === 'rowfocuschanging') window.paymentRowEvents.push({ args, value })
        return value
      }
    })
    const payment = page.locator('.presentation-modern-dialog[open]')
    const header = payment.locator('[data-window-data=dw_header]')
    await header.locator('[data-row="2"] [data-obj=amount]').press('Control+i')
    await page.waitForFunction(() => window.paymentPreview.controls.dw_header.model.rowCount() === 3)
    await header.locator('.dw-edit').press('Escape')
    await page.waitForFunction(() => !window.paymentPreview.views.dw_header.editor)
    await header.locator('[data-row="1"] [data-obj=doccode]').click()
    await page.waitForFunction(() => window.paymentRowEvents.length > 0)
    assert.ok(await page.evaluate(() => {
      const f = window.paymentPreview, current = document.activeElement?.closest('[data-row]')
      return f.controls.dw_header.model.row === 3 && !f.views.dw_header.editor && current?.dataset.row === '3'
    }), 'A real pointer cannot leave the source-rejected blank row or open an editor in a different record')
    await payment.getByRole('button', { name: 'Cancel', exact: true }).click()
    await page.waitForFunction(() => !window.paymentPreview.window.isOpen)
    await page.evaluate(() => window.paymentPreview.close())
  }
  if (focusedPayment) {
    assert.deepEqual(pageErrors, []); assert.deepEqual(forbidden, [])
    assert.equal(await page.evaluate(() => window.fixtureNativeAccess), 0)
    await writeFile(resolve(output, 'payment-result.json'), JSON.stringify({ ...result, paymentCases, pageErrors, forbidden }, null, 2) + '\n')
    console.log(`Cashier payment: ${result.passed} assertions and ${paymentCases.length} appearance cases.`)
    await browser.close(); await new Promise((resolve) => server.close(resolve))
    process.exit(0)
  }
  const cashierCases = []
  if (!focusedLookups && !focusedBands && !focusedInvoices) {
    for (const closed of [false, true]) for (const [theme, scale, width, height] of [
      ['light', 100, 1366, 768], ['dark', 200, 1366, 768], ['dark', 200, 683, 384], ['dark', 200, 320, 768],
    ]) {
      await page.setViewportSize({ width, height })
      await page.evaluate(async ({ closed, theme, scale }) => {
        await window.openCashierPreview(closed)
        const f = window.cashierPreview
        for (const element of [f.view.el, ...Object.values(f.views).map((view) => view.root)]) {
          element.dataset.theme = theme; element.dataset.density = 'comfortable'
          element.style.setProperty('--p-scale', String(scale / 100))
        }
        for (const view of Object.values(f.views)) await view.render()
      }, { closed, theme, scale })
      const modal = page.locator('.presentation-modern-dialog[open]')
      const cash = modal.locator('[data-window-data=dw_cash]'), figures = modal.locator('[data-window-data=dw_figures]')
      if (!closed) {
        await cash.locator('[data-row="1"] [data-obj=qty]').click()
        await cash.locator('input').fill('3'); await cash.locator('input').press('Tab')
        await page.waitForFunction(() => window.cashierPreview.controls.dw_cash.model.getItem(1, 'qty') === 3)
        await figures.locator('[data-obj=amttransfered]').click()
        await figures.locator('input').fill('40'); await figures.locator('input').press('Tab')
        await page.waitForFunction(() => Number(window.cashierPreview.controls.dw_figures.model.getItem(1, 'amttransfered')) === 40)
        assert.equal(await page.evaluate(() => Number(window.cashierPreview.controls.dw_figures.model.getItem(1, 'totalamount'))), 150,
          'Real quantity editing propagates through source focus/totals handlers')
      }
      const actual = figures.locator('[data-obj=compute_7]')
      await actual.focus()
      const appearance = await (await page.waitForFunction(() => {
        const element = window.cashierPreview.views.dw_figures.root.querySelector('[data-obj=compute_7]')
        if (!element?.isConnected || document.activeElement !== element) return false
        const r = element.getBoundingClientRect(), s = getComputedStyle(element)
        if (!r.width || !r.height || !s.fontSize || s.outlineStyle === 'none' || parseFloat(s.outlineWidth) < 2) return false
        return {
          visible: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight,
          focus: true,
          value: element.textContent.trim(), fontSize: parseFloat(s.fontSize),
        }
      })).jsonValue()
      assert.ok(appearance.visible && appearance.focus && appearance.value === (closed ? '150.00' : '190.00'),
        `Cashier figures/${closed}/${theme}/${scale}/${width}: ${JSON.stringify(appearance)}`)
      assert.equal(appearance.fontSize, 14 * scale / 100, 'Cashier readonly values inherit the selected text scale')
      assert.equal(await figures.locator('[data-obj=cashsales]').count(), closed ? 1 : 0, 'Source status controls visibility, not presentation guesses')
      assert.equal(await modal.getByRole('button', { name: 'Close Shift', exact: true }).isDisabled(), closed)
      assert.match(await modal.ariaSnapshot(), /dialog "Cashier Shift Closing"/)
      const contrast = await visibleContrast(modal.locator('.modern-window'))
      assert.ok(contrast.length && contrast.every((ratio) => ratio >= 4.5), 'Cashier labels, values and actions meet text contrast')
      await page.screenshot({ path: resolve(output, `cashier-${closed ? 'closed' : 'open'}-${theme}-${scale}-${width}.png`) })
      for (const button of await modal.locator('button:enabled').all()) {
        await button.focus()
        assert.ok(await button.evaluate((element) => {
          const r = element.getBoundingClientRect(), s = getComputedStyle(element)
          return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight &&
            s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) >= 2
        }), 'Focused cashier actions stay visible at narrow widths and enlarged text sizes')
      }
      await modal.getByRole('button', { name: 'Cancel', exact: true }).click()
      await page.waitForFunction(() => !window.cashierPreview.window.isOpen)
      assert.equal(await page.evaluate(() => window.cashierPreview.calls.filter((call) => call.kind === 'write').length), 0,
        'Real Cancel never persists a cashier draft')
      await page.evaluate(() => window.cashierPreview.close())
      cashierCases.push({ closed, theme, scale, width, height, ...appearance, minimumTextContrast: Math.min(...contrast) })
    }
    await page.setViewportSize({ width: 1366, height: 768 })
    await page.evaluate(() => window.openCashierPreview())
    const modal = page.locator('.presentation-modern-dialog[open]')
    const cash = modal.locator('[data-window-data=dw_cash]')
    await cash.locator('[data-row="1"] [data-obj=qty]').click()
    await cash.locator('input').fill('99'); await cash.locator('input').press('Escape')
    assert.ok(await page.evaluate(() => window.cashierPreview.window.isOpen &&
      window.cashierPreview.controls.dw_cash.model.getItem(1, 'qty') === 0 && !window.cashierPreview.views.dw_cash.editor),
    'First real Escape discards only the unaccepted cashier quantity')
    await page.keyboard.press('Escape')
    await page.waitForFunction(() => !window.cashierPreview.window.isOpen)
    await page.evaluate(() => window.cashierPreview.close())
    await page.evaluate(() => window.openCashierPreview())
    await modal.getByRole('button', { name: 'Close Shift', exact: true }).press('Enter')
    const message = page.locator('.presentation-runtime-dialog[open]')
    await message.waitFor()
    assert.match(await message.textContent(), /Changes take effect/)
    await message.locator('button').first().click()
    await page.waitForFunction(() => !window.cashierPreview.window.isOpen)
    assert.deepEqual(await page.evaluate(() => ({
      authorizations: window.cashierPreview.calls.filter((call) => call.scope === 'authorization').length,
      commits: window.cashierPreview.calls.filter((call) => call.scope === 'shift' && call.kind === 'commit').length,
    })), { authorizations: 1, commits: 1 }, 'Real Enter invokes a single authorized closing sequence')
    await page.evaluate(() => window.cashierPreview.close())
  }
  const associatedInvoiceCases = []
  if (!focusedLookups && !focusedBands && !focusedCashier) {
    for (const [theme, scale, width, height] of [['light', 100, 1366, 768], ['dark', 200, 1366, 768],
      ['dark', 200, 683, 384], ['dark', 200, 320, 768]]) {
      await page.setViewportSize({ width, height })
      await page.evaluate(async ({ theme, scale }) => {
        await window.openAssociatedInvoicePreview()
        const f = window.associatedInvoicePreview
        for (const element of [f.view.el, f.dw.root]) {
          element.dataset.theme = theme
          element.dataset.density = 'comfortable'
          element.style.setProperty('--p-scale', String(scale / 100))
        }
        await f.dw.render()
      }, { theme, scale })
      const modal = page.locator('.presentation-modern-dialog[open]')
      const invoice = modal.locator('[data-row="1"] [data-obj="saleinvcode"]')
      await invoice.click()
      const input = modal.locator('input')
      await input.fill('902')
      await input.press('Tab')
      await page.waitForFunction(() => Number(window.associatedInvoicePreview.model.getItem(1, 'saleinvcode')) === 902)
      assert.equal(await page.evaluate(() => Number(window.associatedInvoicePreview.caller.model.getItem(1, 'netamt'))), 75.5,
        'Real typing reaches the original ItemChanged total query and shared caller buffer')
      await modal.getByRole('textbox', { name: 'Total Amount:', exact: true }).focus()
      const appearance = await modal.evaluate((modal) => {
        const f = window.associatedInvoicePreview
        const total = f.dw.root.querySelector('.surface-band [role=textbox]')
        const rect = total.getBoundingClientRect(), bounds = modal.getBoundingClientRect()
        const style = getComputedStyle(total)
        return {
          contained: rect.left >= bounds.left && rect.right <= bounds.right && rect.top >= bounds.top && rect.bottom <= bounds.bottom,
          viewport: rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight,
          focus: document.activeElement === total && style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) >= 2,
          total: total.textContent.trim(),
        }
      })
      assert.ok(appearance.contained && appearance.viewport && appearance.focus && appearance.total === '75.50',
        `Associated invoice modal/${theme}/${scale}/${width}: ${JSON.stringify(appearance)}`)
      const contrast = await visibleContrast(modal.locator('.modern-window'))
      assert.ok(contrast.length && contrast.every((ratio) => ratio >= 4.5),
        `Associated invoice modal/${theme}/${scale}/${width}: text contrast`)
      assert.match(await modal.ariaSnapshot(), /dialog "Select Assocaited Sale Invoices"/)
      await page.screenshot({ path: resolve(output, `associated-invoice-${theme}-${scale}-${width}.png`) })
      for (const action of await modal.locator('button').all()) {
        await action.focus()
        assert.ok(await action.evaluate((element) => {
          const rect = element.getBoundingClientRect(), style = getComputedStyle(element)
          return rect.top >= 0 && rect.bottom <= innerHeight && rect.left >= 0 && rect.right <= innerWidth &&
            style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) >= 2
        }), 'Every focused invoice-dialog action remains visible and outlined at enlarged text sizes')
      }
      await modal.getByRole('button', { name: 'Ok', exact: true }).click()
      await page.waitForFunction(() => !window.associatedInvoicePreview.window.isOpen)
      assert.equal(await page.evaluate(() => window.associatedInvoicePreview.returned().pbGet('i_closemode')), 1,
        'A real OK click returns the original accepted structure')
      await page.evaluate(() => window.associatedInvoicePreview.close())
      associatedInvoiceCases.push({ theme, scale, width, height, ...appearance, minimumTextContrast: Math.min(...contrast) })
    }
    await page.setViewportSize({ width: 1366, height: 768 })
    await page.evaluate(() => window.openAssociatedInvoicePreview())
    const modal = page.locator('.presentation-modern-dialog[open]')
    await modal.locator('[data-row="1"] [data-obj="saleinvcode"]').click()
    await modal.locator('input').fill('902')
    await modal.locator('input').press('Escape')
    assert.ok(await page.evaluate(() => window.associatedInvoicePreview.window.isOpen &&
      !window.associatedInvoicePreview.dw.editor && window.associatedInvoicePreview.dw.root.contains(document.activeElement)),
    'Real Escape cancels only the pending editor and retains grid focus')
    await page.keyboard.press('Escape')
    await page.waitForFunction(() => !window.associatedInvoicePreview.window.isOpen)
    assert.equal(await page.evaluate(() => window.associatedInvoicePreview.returned().pbGet('i_closemode')), -1,
      'The second real Escape invokes the source Cancel return')
    await page.evaluate(() => window.associatedInvoicePreview.close())
    await page.evaluate(() => window.openAssociatedInvoicePreview())
    await modal.getByRole('button', { name: 'Ok', exact: true }).press('Enter')
    await page.waitForFunction(() => !window.associatedInvoicePreview.window.isOpen)
    assert.equal(await page.evaluate(() => window.associatedInvoicePreview.calls.length), 3,
      'A real Enter on the source OK button performs one validation sequence, not a native-plus-script double activation')
    await page.evaluate(() => window.associatedInvoicePreview.close())
  }
  if (focusedCashier) {
    assert.deepEqual(pageErrors, [])
    assert.deepEqual(forbidden, [])
    assert.equal(await page.evaluate(() => window.fixtureNativeAccess), 0)
    await writeFile(resolve(output, 'cashier-result.json'), JSON.stringify({ ...result, cashierCases, pageErrors, forbidden }, null, 2) + '\n')
    console.log(`Cashier closing: ${result.passed} assertions and ${cashierCases.length} appearance cases.`)
  } else if (focusedInvoices) {
    assert.deepEqual(pageErrors, [])
    assert.deepEqual(forbidden, [])
    assert.equal(await page.evaluate(() => window.fixtureNativeAccess), 0)
    await writeFile(resolve(output, 'associated-invoice-result.json'), JSON.stringify({ ...result, associatedInvoiceCases, pageErrors, forbidden }, null, 2) + '\n')
    console.log(`Associated invoices: ${result.passed} assertions and ${associatedInvoiceCases.length} appearance cases.`)
  } else {
  const transactionBandCases = []
  if (!focusedLookups) for (const surface of TRANSACTION_DATA_SURFACES) {
    for (const [theme, scale, width, height] of [['light', 100, 1366, 768], ['dark', 200, 1366, 768],
      ['dark', 200, 683, 384], ['dark', 200, 320, 768], ['dark', 200, 683, 220]]) {
      await page.setViewportSize({ width, height })
      await page.evaluate(async ({ name, theme, scale }) => {
        await window.openTransactionBandPreview(name)
        const root = window.transactionBandPreview.view.root
        root.dataset.theme = theme
        root.dataset.density = 'comfortable'
        root.style.setProperty('--p-scale', String(scale / 100))
        await window.transactionBandPreview.view.render()
      }, { name: surface.name, theme, scale })
      const band = page.locator('#transaction-band-preview .surface-band')
      await band.waitFor({ state: 'attached' })
      await band.getByRole('textbox').focus()
      await page.waitForTimeout(120)
      const appearance = await band.evaluate((band) => {
        const root = band.closest('.dw'), total = band.querySelector('[role=textbox]')
        const bounds = root.getBoundingClientRect(), rect = band.getBoundingClientRect()
        const value = total.getBoundingClientRect(), label = band.querySelector('dt').getBoundingClientRect()
        const within = (r) => r.left >= bounds.left - .5 && r.right <= bounds.right + .5 &&
          r.top >= bounds.top - .5 && r.bottom <= bounds.bottom + .5
        const luminance = (color) => {
          const rgb = color.match(/[\d.]+/g).slice(0, 3).map(Number).map((v) => v / 255)
            .map((v) => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4)
          return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722
        }
        const contrast = [total, band.querySelector('dt')].map((element) => {
          const a = luminance(getComputedStyle(element).color), b = luminance(getComputedStyle(band).backgroundColor)
          return (Math.max(a, b) + .05) / (Math.min(a, b) + .05)
        })
        const focus = getComputedStyle(total)
        const header = root.querySelector('thead'), heading = header.querySelector('th')
        const headerFits = header.getBoundingClientRect().height + parseFloat(root.style.getPropertyValue('--surface-row-height')) <= root.clientHeight
        return { viewport: bounds.left >= 0 && bounds.right <= innerWidth && bounds.top >= 0 && bounds.bottom <= innerHeight,
          visible: [rect, value, label].every(within), focused: document.activeElement === total,
          outline: focus.outlineStyle !== 'none' && parseFloat(focus.outlineWidth) >= 2,
          minimumTextContrast: Math.min(...contrast), flow: band.classList.contains('surface-band-flow'),
          headerFits, headerPosition: getComputedStyle(heading).position,
          band: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom },
          root: { left: bounds.left, right: bounds.right, top: bounds.top, bottom: bounds.bottom } }
      })
      assert.ok(appearance.viewport && appearance.visible && appearance.focused && appearance.outline &&
        appearance.minimumTextContrast >= 4.5,
      `${surface.name}/${theme}/${scale}/${width}: totals remain visible and keyboard-readable: ${JSON.stringify(appearance)}`)
      assert.match(await band.ariaSnapshot(), /textbox/, 'Totals are exposed to accessibility')
      assert.equal(appearance.headerPosition, appearance.headerFits ? 'sticky' : 'static',
        `${surface.name}: column headings reserve a complete row or return to normal scrolling`)
      if (surface.bands[0].band === 'footer' && height === 220) assert.ok(appearance.flow,
        `${surface.name}: a short viewport releases the sticky footer`)
      await page.evaluate(() => {
        const f = window.transactionBandPreview
        f.view.root.scrollLeft = f.view.root.scrollWidth - f.view.root.clientWidth
        f.control.changed()
      })
      await page.waitForTimeout(120)
      const horizontal = await band.evaluate((band) => {
        const b = band.getBoundingClientRect(), root = band.closest('.dw'), r = root.getBoundingClientRect()
        const parent = band.parentElement.getBoundingClientRect()
        return { left: b.left, right: b.right, rootLeft: r.left, rootRight: r.right, scroll: root.scrollLeft,
          parentLeft: parent.left, parentRight: parent.right, width: innerWidth, height: innerHeight }
      })
      assert.ok(horizontal.left >= horizontal.rootLeft - .5 && horizontal.right <= horizontal.rootRight + .5,
        `${surface.name}: horizontal grid scrolling cannot move totals out of the viewport: ${JSON.stringify(horizontal)}`)
      await page.screenshot({ path: resolve(output, `transaction-${surface.name}-${theme}-${scale}-${width}x${height}.png`) })
      transactionBandCases.push({ name: surface.name, theme, scale, width, height, ...appearance })
      if (surface.name !== 'd_assocadvsaleinvlist') {
        await page.evaluate(async () => {
          const f = window.transactionBandPreview
          f.model.row = 120; f.model.col = f.model.colIndex(f.amount) + 1
          f.control.changed()
        })
        await page.waitForTimeout(120)
        await page.evaluate(() => window.transactionBandPreview.view.focusCurrent())
        const input = page.locator('#transaction-band-preview .surface-editor')
        await input.waitFor()
        await input.fill('2')
        const editorBounds = await input.evaluate((input) => {
          const r = input.closest('.dw').getBoundingClientRect(), e = input.getBoundingClientRect()
          const header = input.closest('.dw').querySelector('thead th').getBoundingClientRect()
          const footer = input.closest('.dw').querySelector('.surface-band-footer:not(.surface-band-flow)')
          return { left: e.left, right: e.right, top: e.top, bottom: e.bottom, rootLeft: r.left, rootRight: r.right,
            headerBottom: Math.max(r.top, header.bottom), footerTop: footer ? footer.getBoundingClientRect().top : r.bottom,
            width: innerWidth, height: innerHeight }
        })
        // Native scroll offsets round fractional text widths to CSS pixels.
        assert.ok(editorBounds.left >= editorBounds.rootLeft - .5 && editorBounds.right <= editorBounds.rootRight + .5 &&
          editorBounds.top >= editorBounds.headerBottom - .5 && editorBounds.bottom <= editorBounds.footerTop + .5,
        `${surface.name}: the whole focused amount editor is outside sticky headers and totals: ${JSON.stringify(editorBounds)}`)
        await input.evaluate((input) => {
          input.setSelectionRange(1, 1)
          const f = window.transactionBandPreview
          f.snapshot = { input, top: f.view.root.scrollTop, left: f.view.root.scrollLeft }
          f.model.setItem(1, f.amount, 3)
          f.control.changed()
        })
        await page.waitForTimeout(120)
        const retained = await page.evaluate(async () => {
          const f = window.transactionBandPreview, saved = f.snapshot
          return { focused: document.activeElement === f.view.editor, value: f.view.editor?.value, caret: f.view.editor?.selectionStart,
            bindingText: await f.control.n_gettext(), storedValue: Number(f.model.getItem(120, f.amount)),
            top: f.view.root.scrollTop, previousTop: saved.top, left: f.view.root.scrollLeft, previousLeft: saved.left,
            total: f.totalNumber(), expectedTotal: f.quantity ? 610 : 122 }
        })
        assert.ok(retained.focused && retained.value === '2' && retained.caret === 1 && retained.bindingText === '2' && retained.storedValue === 1 &&
          retained.top === retained.previousTop && retained.left === retained.previousLeft && retained.total === retained.expectedTotal,
        `${surface.name}: total recalculation preserves a different row's editor, caret and passive scroll: ${JSON.stringify(retained)}`)
        await input.press('Escape')
      }
      await page.evaluate(() => window.transactionBandPreview.dispose())
    }
  }
  if (focusedBands) {
    assert.deepEqual(pageErrors, [])
    assert.deepEqual(forbidden, [])
    assert.equal(await page.evaluate(() => window.fixtureNativeAccess), 0)
    await writeFile(resolve(output, 'transaction-band-result.json'), JSON.stringify({ ...result, transactionBandCases, pageErrors, forbidden }, null, 2) + '\n')
    console.log(`Transaction bands: ${result.passed} assertions and ${transactionBandCases.length} appearance cases.`)
  } else {
  await page.setViewportSize({ width: 1366, height: 768 })
  await page.evaluate(() => window.openEditableLookupPreview())
  await page.evaluate(() => {
    window.previousEditableLookupPreview = window.editableLookupPreview
    return window.openEditableLookupPreview()
  })
  assert.ok(await page.evaluate(async () => {
    await window.previousEditableLookupPreview.close()
    return window.previousEditableLookupPreview.control.destroyed && !window.previousEditableLookupPreview.view.root.isConnected &&
      window.editableLookupPreview.view.root.isConnected && !window.editableLookupPreview.control.destroyed
  }), 'Replacing a preview releases its owned view/control; closing the old preview again cannot destroy the current one')
  const lookupHost = page.locator('.dw').filter({ has: page.locator('[data-obj=manfcode]') })
  await lookupHost.locator('[data-obj=manfcode]').click()
  const lookupInput = lookupHost.getByRole('combobox')
  await lookupInput.waitFor()
  assert.match(await lookupHost.ariaSnapshot(), /combobox "Manufacturer"/, 'The editable field keeps the reviewed source label')
  await page.waitForFunction(() => window.editableLookupPreview.view.editor?.getAttribute('aria-busy') === 'false')
  await lookupInput.fill('Bravo synthetic manufacturer')
  await lookupInput.press('Tab')
  await page.waitForFunction(() => window.editableLookupPreview.model.getItem(1, 'manfcode') === 902 &&
    !window.editableLookupPreview.view.editor)
  assert.equal(await page.evaluate(() => window.editableLookupPreview.events.filter((item) => item.event === 'itemchanged').length), 1,
    'Real manufacturer typing and Tab dispatch exactly one key-valued ItemChanged')
  await lookupHost.locator('[data-obj=manfcode]').click()
  await lookupInput.press('F4')
  await page.waitForFunction(() => window.editableLookupPreview.view.editor?.getAttribute('aria-expanded') === 'true')
  await lookupHost.getByRole('option', { name: 'Repeated synthetic manufacturer', exact: true }).nth(1).click()
  await page.waitForFunction(() => window.editableLookupPreview.model.getItem(1, 'manfcode') === 904 &&
    !window.editableLookupPreview.view.editor)
  assert.equal(await page.evaluate(() => window.editableLookupPreview.events.filter((item) => item.event === 'itemchanged').length), 2,
    'Real duplicate-label pointer selection commits its exact key once')
  await page.evaluate(() => {
    const f = window.editableLookupPreview
    for (let code = 905; code <= 1904; code++) {
      const row = f.child.model.insertRow(0)
      f.child.model.setItem(row, f.keyColumn, code)
      f.child.model.setItem(row, f.textColumn, `M${code}`)
    }
    f.child.changed()
  })
  const editableLookupCases = []
  for (const [theme, scale, width, height] of [
    ['light', 100, 1366, 768], ['dark', 200, 1366, 768], ['dark', 200, 683, 384],
    ['dark', 200, 320, 768], ['dark', 200, 683, 220],
  ]) {
    await page.setViewportSize({ width, height })
    await page.evaluate(({ theme, scale }) => {
      const root = window.editableLookupPreview.view.root
      root.dataset.theme = theme
      root.style.setProperty('--p-scale', String(scale / 100))
    }, { theme, scale })
    await lookupHost.locator('[data-obj=manfcode]').click()
    await lookupInput.fill('Unapplied synthetic draft')
    await lookupInput.press('ArrowDown')
    await page.waitForFunction(() => window.editableLookupPreview.view.editor?.getAttribute('aria-expanded') === 'true')
    assert.equal(await lookupInput.inputValue(), 'Unapplied synthetic draft', 'Real popup navigation never overwrites unfinished display text')
    const appearance = await lookupInput.evaluate((input) => {
      const list = document.getElementById(input.getAttribute('aria-controls'))
      const rect = list.getBoundingClientRect()
      const active = document.getElementById(input.getAttribute('aria-activedescendant'))
      const focus = getComputedStyle(input)
      const field = input.getBoundingClientRect()
      const options = [...list.querySelectorAll('[role=option]')]
      const listStyle = getComputedStyle(list)
      const chrome = ['paddingTop', 'paddingBottom', 'borderTopWidth', 'borderBottomWidth']
        .reduce((sum, property) => sum + parseFloat(listStyle[property]), 0)
      const minimumRow = Math.min(...options.map((option) => option.getBoundingClientRect().height))
      const lines = Number(window.editableLookupPreview.model.def.objects.find((object) => object.name === 'manfcode')['dddw.lines'])
      const available = rect.top >= field.bottom - .5 ? innerHeight - field.bottom - 4 : field.top - 4
      const toggle = input.parentElement.querySelector('.dw-choice-toggle').getBoundingClientRect()
      const host = input.closest('.dw').parentElement.getBoundingClientRect()
      const withinViewport = (rect) => rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight
      const luminance = (color) => {
        const rgb = color.match(/[\d.]+/g).slice(0, 3).map(Number).map((value) => value / 255)
          .map((value) => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4)
        return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722
      }
      const contrast = [input, ...list.querySelectorAll('[role=option]')].map((element) => {
        const style = getComputedStyle(element)
        const background = style.backgroundColor === 'rgba(0, 0, 0, 0)' ? getComputedStyle(list).backgroundColor : style.backgroundColor
        const a = luminance(style.color), b = luminance(background)
        return (Math.max(a, b) + .05) / (Math.min(a, b) + .05)
      })
      return { visible: rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight,
        sourceLines: lines, popupHeight: rect.height, rowBudget: lines * minimumRow + chrome,
        sourceHeight: Math.abs(rect.height - Math.min(lines * minimumRow + chrome, available)) < 1,
        fieldVisible: [field, toggle, host].every(withinViewport),
        minimumTextContrast: Math.min(...contrast),
        focused: document.activeElement === input, options: list.querySelectorAll('[role=option]').length,
        cachedOptions: window.editableLookupPreview.view.choiceEdit.popup.options.size,
        completeSet: options.every(option => option.getAttribute('aria-setsize') === '1004'),
        activeVisible: !!active && active.getBoundingClientRect().top >= rect.top && active.getBoundingClientRect().bottom <= rect.bottom,
        outline: focus.outlineStyle !== 'none' && parseFloat(focus.outlineWidth) >= 2 }
    })
    assert.ok(appearance.visible && appearance.fieldVisible && appearance.minimumTextContrast >= 4.5 &&
      appearance.focused && appearance.options > 0 && appearance.options <= 40 && appearance.cachedOptions <= 40 &&
      appearance.completeSet && appearance.activeVisible && appearance.outline &&
      appearance.sourceLines === 7 && appearance.sourceHeight,
      `Editable lookup stays visible, named and keyboard-focused at ${theme}/${scale}/${width}: ${JSON.stringify(appearance)}`)
    await page.screenshot({ path: resolve(output, `editable-lookup-${theme}-${scale}-${width}-${height}.png`) })
    editableLookupCases.push({ theme, scale, width, height, ...appearance })
    await lookupInput.press('Escape')
    assert.equal(await lookupInput.inputValue(), 'Unapplied synthetic draft', 'Real first Escape retains the text draft')
    await lookupInput.press('Escape')
    await page.waitForFunction(() => !window.editableLookupPreview.view.editor)
  }
  await page.evaluate(() => {
    return window.editableLookupPreview.close()
  })
  const automaticChoiceCases = []
  for (const kind of ['list', 'lookup', 'editable']) for (const [theme, scale, width, height] of [
    ['light', 100, 1366, 768], ['dark', 200, 1366, 768], ['dark', 200, 683, 384], ['dark', 200, 320, 768],
  ]) {
    await page.setViewportSize({ width, height })
    await page.evaluate(async ({ kind, theme, scale }) => {
      await window.openAutomaticChoicePreview(kind)
      const f = window.automaticChoicePreview
      f.view.root.dataset.theme = theme
      f.view.root.style.setProperty('--p-scale', String(scale / 100))
      await f.view.render()
      const before = document.createElement('button')
      before.className = 'automatic-choice-before'
      before.textContent = 'Before automatic choices'
      f.host.before(before)
      before.focus()
    }, { kind, theme, scale })
    await page.keyboard.press('Tab')
    await page.waitForFunction(() => window.automaticChoicePreview.view.choiceEdit?.popup?.open)
    const host = page.locator('.automatic-choice-preview')
    const input = host.locator('input[role=combobox]')
    assert.ok(await input.evaluate((input) => document.activeElement === input), 'Real Tab opens automatic choices in the field')
    if (kind === 'editable') {
      await input.fill('Unapplied synthetic subject')
      assert.ok(await page.evaluate(() => window.automaticChoicePreview.view.choiceEdit.popup.open), 'Typing preserves an automatic list')
      await input.press('ArrowDown')
    } else await input.press('End')
    await input.press('Enter')
    await page.waitForFunction((kind) => {
      const f = window.automaticChoicePreview
      return f.model.getItem(1, f.column) === (kind === 'list' ? 2 : kind === 'lookup' ? 904 : 'Bravo synthetic subject')
    }, kind)
    const appearance = await input.evaluate((input) => {
      const list = document.getElementById(input.getAttribute('aria-controls'))
      const active = document.getElementById(input.getAttribute('aria-activedescendant'))
      const within = (rect) => rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight
      const luminance = (color) => color.match(/[\d.]+/g).slice(0, 3).map(Number).map((value) => value / 255)
        .map((value) => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4)
        .reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0)
      const contrast = [input, ...list.querySelectorAll('[role=option]')].map((element) => {
        const style = getComputedStyle(element)
        const background = style.backgroundColor === 'rgba(0, 0, 0, 0)' ? getComputedStyle(list).backgroundColor : style.backgroundColor
        const a = luminance(style.color), b = luminance(background)
        return (Math.max(a, b) + .05) / (Math.min(a, b) + .05)
      })
      const focus = getComputedStyle(input), bounds = list.getBoundingClientRect(), selected = active?.getBoundingClientRect()
      return { visible: within(input.getBoundingClientRect()) && within(bounds),
        activeVisible: !!selected && selected.top >= bounds.top && selected.bottom <= bounds.bottom,
        focused: document.activeElement === input, fontSize: parseFloat(focus.fontSize),
        outline: focus.outlineStyle !== 'none' && parseFloat(focus.outlineWidth) >= 2,
        minimumTextContrast: Math.min(...contrast), noArrow: input.parentElement.querySelector('.dw-choice-toggle')?.hidden === true }
    })
    assert.ok(appearance.visible && appearance.activeVisible && appearance.focused && appearance.outline &&
      appearance.noArrow && appearance.minimumTextContrast >= 4.5,
    `Automatic choices remain usable at ${kind}/${theme}/${scale}/${width}: ${JSON.stringify(appearance)}`)
    assert.equal(appearance.fontSize, 14 * scale / 100)
    await page.screenshot({ path: resolve(output, `automatic-choice-${kind}-${theme}-${scale}-${width}.png`) })
    automaticChoiceCases.push({ kind, theme, scale, width, ...appearance })
    if (kind !== 'editable') {
      await input.press('Tab')
      // A list moves to its next tab column; the single-field lookup has no next field, so (as in PowerBuilder)
      // Tab after the last field of the last row keeps the accepted value and the keyboard on that field.
      await page.waitForFunction((kind) => {
        const f = window.automaticChoicePreview
        return kind === 'list' ?
          !f.view.choiceEdit?.popup?.open && f.model.col === f.model.colIndex('startingmarginperc') + 1 && document.activeElement === f.view.editor :
          f.model.getItem(1, f.column) === 904 && f.model.col === f.model.colIndex(f.column) + 1 &&
            !f.view.choiceEdit?.popup?.open && f.host.contains(document.activeElement) &&
            document.activeElement.closest('[data-obj]')?.getAttribute('data-obj') === f.column
      }, kind)
    }
    await page.evaluate(() => window.automaticChoicePreview.close())
    await page.locator('.automatic-choice-before').evaluate((element) => element.remove())
    assert.equal(await page.locator('.dw-choice-popup:popover-open').count(), 0)
  }
  const selectorVariantCases = []
  for (const [name, column, kind] of [
    ['d_change_purinv', 'purinvpagesize', 'editable'],
    ['d_change_purinv', 'icatcode', 'lookup'], ['d_customer_category', 'customersegmentcode', 'lookup'],
    ['d_customer_category', 'allowincashsale', 'checkbox'], ['d_customer_category', 'allowincreditsale', 'checkbox'],
    ['d_stockleder_inputs', 'purgestockledger', 'checkbox'], ['d_stockleder_inputs', 'updatebasetables', 'checkbox'],
  ]) for (const [theme, scale, width, height] of [
    ['light', 100, 1366, 768], ['dark', 200, 1366, 768], ['dark', 200, 683, 384], ['dark', 200, 320, 768],
  ]) {
    await page.setViewportSize({ width, height })
    const checkbox = kind === 'checkbox'
    await page.evaluate(async ({ name, theme, scale, column }) => {
      await window.openSelectorVariantPreview(name)
      const f = window.selectorVariantPreview
      f.view.root.dataset.theme = theme
      f.view.root.style.setProperty('--p-scale', String(scale / 100))
      await f.view.render()
      await f.edit(column)
    }, { name, theme, scale, column })
    const host = page.locator('.selector-variant-preview')
    const cell = host.locator(`[data-row="1"] [data-obj="${column}"]`)
    const input = host.locator('input.surface-editor')
    if (checkbox) {
      await input.press('Escape')
      await cell.click()
      await page.waitForFunction((column) => window.selectorVariantPreview.model.getItem(1, column) === 'Y', column)
      await cell.focus()
      await cell.press('Space')
      await page.waitForFunction((column) => window.selectorVariantPreview.model.getItem(1, column) === 'N', column)
      assert.equal(await page.evaluate(() => window.selectorVariantPreview.events.filter((event) => event.event === 'itemchanged').length), 2,
        'Real pointer and Space toggle the left-text checkbox exactly once each')
      await page.evaluate(() => { window.selectorVariantPreview.state.reject = true })
      await cell.focus()
      await cell.press('Enter')
      await input.press('Space')
      await page.waitForFunction(() => window.selectorVariantPreview.view.editor?.getAttribute('aria-invalid') === 'true')
      assert.equal(await input.isChecked(), true, 'The rejected proposed checkbox state remains visible')
      assert.equal(await page.evaluate((column) => window.selectorVariantPreview.model.getItem(1, column), column), 'N')
    } else if (kind === 'lookup') {
      assert.equal(await input.getAttribute('readonly'), '')
      assert.equal(await input.getAttribute('aria-expanded'), column === 'icatcode' ? 'true' : 'false')
      await input.press('ArrowDown')
      assert.equal(await page.evaluate((column) => window.selectorVariantPreview.model.getItem(1, column), column), 901,
        'Real readonly arrow navigation only highlights the child row')
      await input.press('Enter')
      await page.waitForFunction((column) => window.selectorVariantPreview.model.getItem(1, column) === 902, column)
      await page.evaluate((column) => window.selectorVariantPreview.edit(column), column)
      if (column !== 'icatcode') await cell.locator('.dw-choice-toggle').click()
      assert.equal(await input.inputValue(), 'Synthetic choice 902')
      assert.equal(await page.evaluate(() => window.selectorVariantPreview.events.filter((event) => event.event === 'itemchanged').length), 1,
        'Real readonly selection accepts one original key')
    } else {
      await input.fill('Half')
      await input.press('Tab')
      await page.waitForFunction(() => window.selectorVariantPreview.model.getItem(1, 'purinvpagesize') === 'H')
      // purinvpagesize is the last tab field (80) of the only row: as in PowerBuilder, Tab keeps the keyboard on it.
      await page.waitForFunction(() => {
        const f = window.selectorVariantPreview
        return f.model.col === f.model.colIndex('purinvpagesize') + 1 && f.host.contains(document.activeElement) &&
          document.activeElement.closest('[data-obj]')?.getAttribute('data-obj') === 'purinvpagesize'
      })
      for (let attempt = 0; attempt < 2 && await page.evaluate(() => !!window.selectorVariantPreview.view.editor); attempt++) {
        await page.keyboard.press('Escape')
        await page.waitForTimeout(100)
      }
      await page.waitForFunction(() => !window.selectorVariantPreview.view.editor)
      assert.equal(await page.evaluate(() => window.selectorVariantPreview.model.getItem(1, 'purinvpagesize')), 'H',
        'Real Tab accepts the editable code-table label and keeps the keyboard on its last field')
      await cell.focus()
      await cell.press('F2')
      await input.fill('Unapplied')
      assert.ok(await host.locator('.surface-status').evaluate((element) => {
        const r = element.getBoundingClientRect()
        return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight && !!element.textContent.trim()
      }), 'Horizontal grid navigation keeps its current status message visible')
    }
    const appearance = await input.evaluate((input) => {
      const within = (r) => r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight
      const style = getComputedStyle(input), rect = input.getBoundingClientRect()
      const caption = input.parentElement.querySelector('.dw-checkbox-caption')
      const text = caption?.getBoundingClientRect()
      const popup = input.parentElement.querySelector('.dw-choice-popup:popover-open')
      const popupBox = popup?.getBoundingClientRect()
      const column = window.selectorVariantPreview.model.def.objects.find((object) => object.name === input.parentElement.dataset.obj)
      const percent = Number(column?.['dddw.percentwidth'])
      const option = popup?.querySelector('[aria-selected=true]')?.getBoundingClientRect()
      return { visible: within(rect) && (!text || within(text)), focused: document.activeElement === input,
        outline: style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) >= 2,
        fontSize: parseFloat(style.fontSize), captionBefore: !text || text.right <= rect.left,
        label: input.getAttribute('aria-labelledby'), width: rect.width, height: rect.height,
        popupVisible: !!popupBox && within(popupBox),
        popupWidthCorrect: !!popupBox && Math.abs(popupBox.width - Math.min(rect.width * percent / 100, innerWidth - 8)) < 1,
        activeVisible: !!option && option.top >= popupBox.top && option.bottom <= popupBox.bottom }
    })
    assert.ok(appearance.visible && appearance.focused && appearance.outline && appearance.captionBefore && appearance.label,
      `Selector variant ${column}/${theme}/${scale}/${width}: ${JSON.stringify(appearance)}`)
    assert.equal(appearance.fontSize, 14 * scale / 100)
    if (kind === 'lookup') assert.ok(appearance.popupVisible && appearance.popupWidthCorrect && appearance.activeVisible,
      `Source-width readonly popup ${column}/${theme}/${scale}/${width}: ${JSON.stringify(appearance)}`)
    const contrast = await visibleContrast(host)
    assert.ok(contrast.length && contrast.every((value) => value >= 4.5), 'Selector text meets contrast requirements')
    if (checkbox) assert.match(await cell.ariaSnapshot(), /checkbox.*checked/)
    await page.screenshot({ path: resolve(output, `selector-variant-${column}-${theme}-${scale}-${width}.png`) })
    selectorVariantCases.push({ name, column, theme, scale, width, ...appearance, minimumTextContrast: Math.min(...contrast) })
    await page.evaluate(() => window.selectorVariantPreview.close())
  }
  await page.setViewportSize({ width: 1366, height: 768 })
  if (focusedLookups) {
    assert.deepEqual(pageErrors, [])
    assert.deepEqual(forbidden, [])
    assert.equal(await page.evaluate(() => window.fixtureNativeAccess), 0)
    await writeFile(resolve(output, 'editable-lookup-result.json'), JSON.stringify({ ...result, editableLookupCases, automaticChoiceCases, selectorVariantCases, pageErrors, forbidden }, null, 2) + '\n')
    console.log(`Shared choices: ${result.passed} assertions; ${editableLookupCases.length} editable, ${automaticChoiceCases.length} automatic and ${selectorVariantCases.length} selector-variant appearance cases.`)
  } else {
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.waitForFunction(() => document.querySelector('.presentation-ui').dataset.theme === 'dark')
  await page.emulateMedia({ colorScheme: 'light' })
  await page.waitForFunction(() => document.querySelector('.presentation-ui').dataset.theme === 'light')
  assert.equal(await page.evaluate(() => window.presentationNativeThemes.length), nativeRequests,
    'System color-scheme changes restyle the workspace without pinning a native theme or creating a feedback loop')
  await page.evaluate(() => window.openPresentationTabsPreview())
  const formTabs = page.locator('.keyboard-tabs')
  const detailTab = formTabs.getByRole('tab', { name: 'Detail', exact: true })
  const listTab = formTabs.getByRole('tab', { name: 'List', exact: true })
  await detailTab.focus()
  await page.keyboard.press('ArrowRight')
  assert.ok(await listTab.evaluate((element) => document.activeElement === element), 'Real arrow keys move form-tab focus')
  assert.equal(await detailTab.getAttribute('aria-selected'), 'true', 'Focus alone cannot navigate away from an edited form')
  await page.keyboard.press('Space')
  const confirmation = page.getByRole('dialog', { name: 'Question: Confirm Changes', exact: true })
  await confirmation.waitFor()
  assert.equal(await page.evaluate(() => window.presentationTabsPreview.control.props.get('selectedtab')), 1)
  await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click()
  await confirmation.waitFor({ state: 'detached' })
  await detailTab.focus()
  await page.keyboard.press('Tab')
  assert.ok(await page.evaluate(() => document.activeElement === window.presentationTabsPreview.input),
    'Tab enters the active form panel despite legacy positive field tab orders')
  await page.keyboard.press('Shift+Tab')
  assert.ok(await detailTab.evaluate((element) => document.activeElement === element), 'Reverse traversal returns to the selected form tab')
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
  await confirmation.waitFor()
  await confirmation.getByRole('button', { name: 'No', exact: true }).click()
  await page.waitForFunction(() => window.presentationTabsPreview.control.props.get('selectedtab') === 2)
  const tabSnapshot = await formTabs.ariaSnapshot()
  assert.match(tabSnapshot, /tab "List" \[selected\]/, 'The selected form page is exposed to assistive technology')
  await listTab.focus()
  assert.ok(await listTab.evaluate((element) => {
    const style = getComputedStyle(element)
    return parseFloat(style.outlineWidth) >= 2 && style.outlineStyle !== 'none'
  }), 'The focused compatibility form tab has a visible outline')
  for (const width of [1366, 683]) {
    await page.setViewportSize({ width, height: 768 })
    await detailTab.focus()
    await page.keyboard.press('End')
    assert.ok(await listTab.evaluate((element) => {
      const bounds = element.parentElement.getBoundingClientRect()
      const focus = element.getBoundingClientRect()
      return focus.left >= bounds.left - 1 && focus.right <= bounds.right + 1
    }), `Keyboard focus stays visible in the form-tab strip at ${width}px`)
    await formTabs.screenshot({ path: resolve(output, `form-tabs-${width}.png`) })
  }
  await page.setViewportSize({ width: 1366, height: 768 })
  await page.evaluate(() => {
    const f = window.presentationTabsPreview
    f.reset()
    f.window.props.set('editflag', false)
    f.pointerChanges = 0
    f.pointerAccepted = false
    f.pointerFire = f.control.rt.fire
    f.control.rt.fire = async (target, event, args) => {
      if (target === f.detail && event === 'itemchanged') {
        f.pointerChanges++
        return f.pointerAccepted ? 0 : 1
      }
      const result = await f.pointerFire(target, event, args)
      if (target === f.control && event === 'selectionchanged') {
        f.view.ui.focus(f.pages[1].children.get('sle_reference'))
      }
      return result
    }
  })
  await formTabs.locator('.row[data-row="1"] [data-obj=limit]').click()
  const limit = formTabs.getByRole('spinbutton')
  await limit.fill('31')
  await listTab.click()
  await page.waitForFunction(() => {
    const f = window.presentationTabsPreview
    return f.pointerChanges > 0 && f.view.ctlViews.get(f.detail).dw.editor === document.activeElement
  })
  assert.equal(await page.evaluate(() => window.presentationTabsPreview.pointerChanges), 1,
    'A real tab click does not revalidate an immediately rejected editor through blur')
  assert.equal(await page.evaluate(() => window.presentationTabsPreview.control.props.get('selectedtab')), 1,
    'A real tab click cannot leave a rejected field')
  assert.equal(await limit.inputValue(), '31', 'Rejected pointer navigation keeps the draft and its input focus')
  assert.equal(await confirmation.count(), 0, 'Rejected validation does not open an unsaved-change confirmation')
  await page.evaluate(() => { window.presentationTabsPreview.pointerAccepted = true })
  await limit.fill('32')
  await listTab.click()
  await confirmation.waitFor()
  await confirmation.getByRole('button', { name: 'No', exact: true }).click()
  await page.waitForFunction(() => window.presentationTabsPreview.control.props.get('selectedtab') === 2)
  assert.equal(await page.evaluate(() => window.presentationTabsPreview.pointerChanges), 2,
    'Correcting the entry validates once on the next explicit navigation')
  assert.equal(await page.evaluate(() => window.presentationTabsPreview.model.getItem(1, 'limit')), 32,
    'The corrected value reaches the shared model before changing pages')
  // SelectionChanged's SetFocus applies when the page takes input again, after the transition's scripts have run.
  await page.waitForFunction(() => document.activeElement === window.presentationTabsPreview.panels[1].querySelector('input'), null, { timeout: 5000 })
    .catch((error) => { throw new Error('Pointer navigation preserves focus explicitly requested by SelectionChanged', { cause: error }) })
  await formTabs.locator('[data-obj=find]').click()
  const findInput = formTabs.locator('input.dw-edit')
  await findInput.fill('BR')
  await page.waitForFunction(() => window.presentationTabsPreview.window.props.get('il_selectedrow') === 2)
  assert.equal(await detailTab.getAttribute('aria-disabled'), 'false', 'Real Find input enables Detail for a matching row')
  await findInput.fill('')
  await page.waitForFunction(() => window.presentationTabsPreview.pages[0].props.get('enabled') === false)
  assert.equal(await detailTab.getAttribute('aria-disabled'), 'true', 'Clearing Find updates the actual Detail availability')
  await page.keyboard.press('Escape')
  await page.evaluate(() => {
    const preview = window.presentationTabsPreview
    preview.control.rt.fire = preview.pointerFire
    return preview.control.rt.closeWindow(preview.window)
  })
  for (const { name } of WINDOW_SURFACES.filter((surface) => !surface.data?.length)) {
    await page.evaluate((name) => window.openPresentationWindowPreview(name), name)
    const form = page.locator('.modern-window')
    assert.match((await page.getByRole('dialog').ariaSnapshot()).split('\n')[0], /dialog ".+"/,
      `${name}: the complete dialog has an accessible name`)
    const input = form.locator('input')
    const close = form.getByRole('button', { name: 'Close window', exact: true })
    await close.focus()
    await page.keyboard.press('Tab')
    assert.ok(await input.evaluate((element) => document.activeElement === element), `${name}: header focus enters the field`)
    await page.keyboard.press('Tab')
    assert.ok(await form.locator('.window-actions button').first().evaluate((element) => document.activeElement === element), `${name}: field focus enters the first action`)
    // Tab follows the source tab order inside the window and wraps to its first field (useSourceTabOrder); the title-bar
    // Close button is a mouse control outside that cycle. OK and Cancel share TabOrder 20 in w_arg_amount, so the button last
    // on screen need not be the last stop: walk the cycle.
    await form.locator('.window-actions button').last().focus()
    let wrapped = false
    for (let step = 0; step < 10 && !wrapped; step++) {
      await page.keyboard.press('Tab')
      const focus = await form.evaluate((root, [field, closer]) => ({ inside: root.contains(document.activeElement),
        field: document.activeElement === field, close: document.activeElement === closer }),
      [await input.elementHandle(), await close.elementHandle()])
      assert.ok(focus.inside && !focus.close, `${name}: forward focus stays in the modal's controls`)
      wrapped = focus.field
    }
    assert.ok(wrapped, `${name}: forward focus wraps to the first field`)
    await page.keyboard.press('Shift+Tab')
    assert.ok(await form.locator('.window-actions').evaluate((root) => root.contains(document.activeElement)), `${name}: reverse focus wraps to the last action`)
    await page.keyboard.press('Tab')
    assert.ok(await input.evaluate((element) => document.activeElement === element), `${name}: the last action is followed by the first field`)
    await input.fill('12')
    await page.keyboard.press('Escape')
    assert.equal(await form.count(), 1, `${name}: Escape cannot bypass a dialog without a Cancel binding`)
    await page.keyboard.press('Enter')
    if (name !== 'w_printer_copies') {
      assert.equal(await form.count(), 1, `${name}: layout does not invent a default action`)
      await form.locator('.window-actions button').first().focus()
      await page.keyboard.press('Enter')
    }
    await form.waitFor({ state: 'detached' })
    assert.equal(await page.evaluate(() => window.presentationWindowPreview.returned()), 12, `${name}: keyboard activation preserves the numeric return`)
    assert.equal(await page.evaluate(() => window.presentationWindowPreview.clicks()), 1, `${name}: keyboard activation runs the original Clicked once`)
  }
  for (const [width, height] of [[1366, 768], [1920, 1080], [683, 384], [320, 768]]) {
    await page.setViewportSize({ width, height })
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Workspace overflow at ${width}px`)
    await page.screenshot({ path: resolve(output, `workspace-${width}.png`) })
  }
  await page.setViewportSize({ width: 1366, height: 768 })
  const surfaceFailures = []
  const surfaceCases = []
  for (const [theme, density, scale, width] of [
    ['light', 'compact', 100, 800], ['dark', 'comfortable', 200, 800], ['dark', 'comfortable', 200, 280],
  ]) {
    for (const name of ['d_contactgroup', 'd_agingintervallist', 'd_agingintervaldetail']) {
      const grid = DATA_SURFACES.find((surface) => surface.name === name).kind === 'grid'
      await page.evaluate((settings) => window.previewPresentationSurface(settings), { name, theme, density, scale, width })
      const surface = page.locator('#presentation-surface-preview .modern-surface')
      await surface.waitFor()
      assert.equal(await surface.evaluate((root) => getComputedStyle(root).fontSize), `${14 * scale / 100}px`)
      const snapshot = await surface.ariaSnapshot()
      assert.match(snapshot.split('\n').slice(0, 20).join('\n'), name === 'd_agingintervaldetail' ? /gridcell "Sr\. No\. 1"/
        : grid ? /gridcell "Name Synthetic name 1"/ : /textbox "Name:"/)
      if (!grid) {
        if (!(await surface.evaluate((root) => root.scrollWidth <= root.clientWidth))) surfaceFailures.push(`${name}/${theme}/${scale}/${width}: form overflow`)
      } else {
        await page.evaluate(async () => {
          const { view, model } = window.presentationSurfacePreview
          model.rowAt(1).sel = true
          await view.render()
        })
      }
      if (name === 'd_agingintervaldetail') {
        await surface.locator('.row[data-row="1"] [data-obj=compute_1]').focus()
        await page.keyboard.press('End')
        await page.waitForFunction(() => document.activeElement?.dataset.obj === 'limit')
        assert.ok(await surface.evaluate((root) => {
          const focus = document.activeElement.getBoundingClientRect()
          const bounds = root.getBoundingClientRect()
          return focus.left >= bounds.left && focus.right <= bounds.left + root.clientWidth + 1 &&
            focus.top >= Math.max(bounds.top, root.querySelector('thead').getBoundingClientRect().bottom) &&
            focus.bottom <= bounds.top + root.clientHeight + 1
        }), `${name}/${scale}/${width}: keyboard navigation reveals the complete editable column`)
        assert.ok(await surface.locator('.row[data-row="1"] [data-obj=limit]').evaluate((cell) => {
          const range = document.createRange()
          range.selectNodeContents(cell.firstChild)
          return range.getBoundingClientRect().right <= cell.querySelector('.surface-spin-controls').getBoundingClientRect().left
        }), `${name}/${scale}/${width}: numeric adjustment controls never obscure the value`)
        for (const button of await surface.locator('.row[data-row="1"] .surface-spin-controls button').all()) {
          assert.ok(await button.evaluate((element) => {
            const rect = element.getBoundingClientRect()
            return rect.width >= 24 && rect.height >= 24 && !!element.getAttribute('aria-label')
          }), `${name}/${scale}/${width}: numeric adjustment buttons are named and meet target-size requirements`)
        }
        const increase = () => surface.locator('.row[data-row="1"]').getByRole('button', { name: 'Increase Limit', exact: true })
        await increase().click()
        await page.waitForFunction(() => document.querySelector('#presentation-surface-preview .surface-editor')?.value === '31')
        await increase().click()
        await page.waitForFunction(() => document.querySelector('#presentation-surface-preview .surface-editor')?.value === '32')
        const input = surface.getByRole('spinbutton')
        await input.fill('1,234')
        await page.keyboard.press('ArrowUp')
        assert.equal(await input.inputValue(), '1235', `${name}/${scale}/${width}: real keyboard stepping preserves grouped input`)
        assert.equal(await page.evaluate(() => window.presentationSurfacePreview.model.getItem(1, 'limit')), 30,
          `${name}/${scale}/${width}: pointer and keyboard adjustments remain uncommitted drafts`)
        await page.keyboard.press('Tab')
        await page.waitForFunction(() => window.presentationSurfacePreview.model.getItem(1, 'limit') === 1235)
        await page.waitForFunction(() => document.querySelector('#presentation-surface-preview .row[data-row="2"] .surface-editor') === document.activeElement)
      }
      const contrast = await surface.evaluate((root) => {
        const rgba = (color) => (color.match(/[\d.]+/g) || []).map(Number)
        const luminance = (color) => rgba(color).slice(0, 3).map((value) => {
          const v = value / 255
          return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
        }).reduce((total, value, index) => total + value * [0.2126, 0.7152, 0.0722][index], 0)
        return [...root.querySelectorAll('.surface-label,.surface-value,th,.surface-status,.surface-spin-controls button,.surface-editor')].map((element) => {
          let ancestor = element
          let background = getComputedStyle(ancestor).backgroundColor
          while (rgba(background)[3] === 0 && ancestor.parentElement) {
            ancestor = ancestor.parentElement
            background = getComputedStyle(ancestor).backgroundColor
          }
          const foreground = luminance(getComputedStyle(element).color)
          const back = luminance(background)
          return (Math.max(foreground, back) + 0.05) / (Math.min(foreground, back) + 0.05)
        })
      })
      surfaceCases.push({ name, theme, density, scale, width, minimumTextContrast: Math.min(...contrast) })
      if (!contrast.length || contrast.some((ratio) => ratio < 4.5)) surfaceFailures.push(`${name}/${theme}/${scale}/${width}: text contrast ${Math.min(...contrast).toFixed(2)}`)
      await surface.screenshot({ path: resolve(output, `${name}-${theme}-${scale}-${width}.png`) })
    }
  }
  await page.evaluate(() => window.presentationSurfacePreview.dispose())
  assert.deepEqual(surfaceFailures, [], 'Data surfaces must pass every reflow and contrast case')
  const windowCases = []
  const calculatorCases = []
  const entryCases = []
  const dropdownCases = []
  const singleEntryCases = []
  const contactCases = []
  const contactCardCases = []
  const gridFocusState = (element) => {
    const root = element.closest('.lookup-grid-wrap,.modern-surface'), rect = element.getBoundingClientRect()
    const bounds = root.getBoundingClientRect(), header = root.querySelector('thead').getBoundingClientRect()
    const style = getComputedStyle(element)
    const left = bounds.left + root.clientLeft, top = bounds.top + root.clientTop
    return {
      focused: document.activeElement === element,
      // the same 1 px allowance on every edge: scaled text places edges on sub-pixels (13.98 against 14 at 200%)
      left: rect.left >= Math.max(0, left) - 1,
      right: rect.right <= Math.min(innerWidth, left + root.clientWidth) + 1,
      top: rect.top >= Math.max(0, top, header.bottom) - 1,
      bottom: rect.bottom <= Math.min(innerHeight, top + root.clientHeight) + 1,
      outlined: parseFloat(style.outlineWidth) >= 2 && style.outlineStyle !== 'none',
      rect: rect.toJSON(), bounds: bounds.toJSON(), header: header.toJSON(),
      viewport: [innerWidth, innerHeight], scroll: [root.scrollLeft, root.scrollTop],
    }
  }
  const assertGridFocus = (state, label) => assert.ok(
    ['focused', 'left', 'right', 'top', 'bottom', 'outlined'].every((key) => state[key]),
    `${label}: fully revealable keyboard focus ${JSON.stringify(state)}`)
  async function captureContactCards(theme, density, scale, viewports) {
    for (const [width, height] of viewports) {
      await page.setViewportSize({ width, height })
      await page.evaluate(() => window.openPresentationContactCardPreview())
      const form = page.locator('.modern-entry-window[data-win=w_contactcard_form]')
      const capture = async (panel) => {
        assert.ok(await form.locator(':scope > .client').evaluate((root) => root.scrollWidth <= root.clientWidth + 1),
          `Contact Card/${panel}/${scale}/${width}: only the grid can scroll horizontally`)
        const contrast = await visibleContrast(form)
        assert.ok(contrast.length && contrast.every((ratio) => ratio >= 4.5),
          `Contact Card/${panel}/${theme}/${scale}/${width}: text contrast`)
        contactCardCases.push({ panel, theme, density, scale, width, height, minimumTextContrast: Math.min(...contrast) })
        await page.screenshot({ path: resolve(output, `contact-card-${panel.toLowerCase()}-${theme}-${scale}-${width}.png`) })
      }
      try {
        assert.equal(await form.getAttribute('data-theme'), theme)
        assert.equal(await form.getAttribute('data-density'), density)
        assert.equal(await form.evaluate((root) => getComputedStyle(root).fontSize), `${14 * scale / 100}px`)
        assert.equal(await form.locator('[data-entry-control="tab_retrieve.tabpage_detail.dw_detail"] .surface-value').count(), 11)
        await capture('Detail')
        await page.evaluate(() => window.presentationContactCardPreview.edit('title'))
        await form.getByRole('combobox', { name: 'Title:', exact: true }).selectOption({ label: 'M/S' })
        await page.waitForFunction(() => window.presentationContactCardPreview.model.getItem(1, 'title') === 'M/S')
        await page.evaluate(() => window.presentationContactCardPreview.edit('address'))
        const textarea = form.locator('textarea.surface-editor')
        await textarea.evaluate((input) => {
          for (let node = input.parentElement; node; node = node.parentElement) {
            if (node.matches('.client,.presentation-ui')) node.scrollTop = 0
          }
        })
        await textarea.fill('Line one')
        await textarea.press('End')
        await textarea.press('Shift+Enter')
        await page.keyboard.insertText('Line two')
        await page.waitForFunction(async () => await window.presentationContactCardPreview.master.n_gettext() === 'Line one\r\nLine two')
        assert.equal(await textarea.inputValue(), 'Line one\nLine two', 'Shift+Enter inserts a real browser line break')
        assert.equal(await page.evaluate(() => window.presentationContactCardPreview.model.getItem(1, 'address')),
          'Synthetic first line\r\nSecond line\r\nThird line', 'The multiline draft is not stored before acceptance')
        assert.equal(await textarea.getAttribute('aria-keyshortcuts'), 'Shift+Enter')
        await page.waitForFunction(() => {
          const input = document.querySelector('.modern-entry-window[data-win=w_contactcard_form] textarea.surface-editor')
          if (!input || document.activeElement !== input) return false
          const rect = input.getBoundingClientRect()
          const style = getComputedStyle(input)
          return rect.width > 0 && rect.height > 0 && rect.left >= 0 && rect.right <= innerWidth + 1 &&
            rect.top >= 0 && rect.bottom <= innerHeight + 1 &&
            parseFloat(style.outlineWidth) >= 2 && style.outlineStyle !== 'none'
        }, null, { timeout: 5000 }).catch(async (cause) => {
          const state = await textarea.evaluate((input) => {
            const ancestors = []
            for (let node = input; node; node = node.parentElement) {
              ancestors.push({ tag: node.tagName, className: node.className, rect: node.getBoundingClientRect().toJSON(),
                scroll: [node.scrollLeft, node.scrollTop], overflow: getComputedStyle(node).overflow })
            }
            return { focused: document.activeElement === input, active: document.activeElement?.outerHTML, ancestors }
          })
          await page.screenshot({ path: resolve(output, 'contact-card-failure.png') })
          throw new Error(`Contact Card/${scale}/${width}: multiline editor remained obscured ${JSON.stringify(state)}`, { cause })
        })
        await capture('Editing')
        await textarea.press('Enter')
        await page.waitForFunction(() => {
          const f = window.presentationContactCardPreview
          return f.model.getItem(1, 'address') === 'Line one\r\nLine two' && f.model.col === f.model.colIndex('phone') + 1
        })
        await page.evaluate(() => window.presentationContactCardPreview.window.props.set('editflag', false))
        await form.getByRole('tab', { name: 'List', exact: true }).click()
        await capture('List')
        assert.equal(await form.getByRole('grid', { name: 'Contact cards', exact: true }).locator('th').count(), 11)
        assert.equal(await form.locator('.entry-grid [data-obj=acccode]').count(), 0, 'The hidden account key stays hidden')
      } finally { await page.evaluate(() => window.presentationContactCardPreview.close()) }
    }
  }
  async function captureSingleEntries(theme, density, scale, viewports, name) {
    for (const [width, height] of viewports) {
      await page.setViewportSize({ width, height })
      await page.evaluate((name) => window.openPresentationSingleEntryPreview(name), name)
      const form = page.locator('.modern-entry-window[data-entry-family=single]')
      try {
        assert.equal(await form.getAttribute('data-theme'), theme)
        assert.equal(await form.getAttribute('data-density'), density)
        assert.equal(await form.evaluate((root) => getComputedStyle(root).fontSize), `${14 * scale / 100}px`)
        for (const panel of ['Detail', 'List']) {
          await form.getByRole('tab', { name: panel, exact: true }).click()
          assert.ok(await form.locator(':scope > .client').evaluate((root) => root.scrollWidth <= root.clientWidth + 1),
            `${name}/${panel}/${theme}/${scale}/${width}: only the two-dimensional list may scroll horizontally`)
          if (panel === 'Detail') {
            const field = form.locator('.entry-form [data-obj=name]')
            await field.click()
            const input = form.locator('.entry-form input.surface-editor')
            await input.fill('Mixed case')
            const expected = await page.evaluate(() => {
              const casing = window.presentationSingleEntryPreview.detail.def.objects.find((object) => object.name === 'name')['edit.case']
              return casing === 'upper' ? 'MIXED CASE' : casing === 'lower' ? 'mixed case' : 'Mixed case'
            })
            assert.equal(await input.inputValue(), expected, 'Real browser input follows the recovered Edit.Case property')
            await page.keyboard.press('Escape')
            await page.evaluate(() => window.presentationSingleEntryPreview.window.props.set('editflag', false))
            if (name === 'w_checklistitem_form') {
              const changes = () => page.evaluate(() => {
                const f = window.presentationSingleEntryPreview
                return f.events.filter((event) => event.target === f.control('dw_detail') &&
                  event.event === 'itemchanged' && event.args[1].name === 'autocheck').map((event) => event.args[2])
              })
              const checkbox = form.locator('.entry-form [data-obj=autocheck]')
              await checkbox.focus()
              assert.equal(await checkbox.getAttribute('aria-checked'), 'false', 'Focusing Auto Check does not toggle it')
              await page.keyboard.press('F2')
              const input = form.locator('.entry-form input[type=checkbox].surface-editor')
              assert.ok(await input.evaluate((element) => document.activeElement === element && !element.checked),
                'F2 opens an unchanged native checkbox')
              assert.deepEqual(await changes(), [], 'Focus and F2 do not submit a checkbox change')
              await page.keyboard.press('Space')
              await page.waitForFunction(() => window.presentationSingleEntryPreview.detail.getItem(1, 'autocheck') === 'Y' &&
                !document.querySelector('.entry-form input[type=checkbox].surface-editor'))
              assert.deepEqual(await changes(), ['Y'], 'Native Space submits exactly one checkbox change')
              await checkbox.click()
              await page.waitForFunction(() => window.presentationSingleEntryPreview.detail.getItem(1, 'autocheck') === 'N' &&
                !document.querySelector('.entry-form input[type=checkbox].surface-editor'))
              assert.deepEqual(await changes(), ['Y', 'N'], 'A real field click after keyboard editing submits exactly one change')
              await checkbox.locator('.cbx').click()
              await page.waitForFunction(() => window.presentationSingleEntryPreview.detail.getItem(1, 'autocheck') === 'Y' &&
                !document.querySelector('.entry-form input[type=checkbox].surface-editor'))
              assert.deepEqual(await changes(), ['Y', 'N', 'Y'], 'A real marker click submits exactly one change')
              await checkbox.click()
              await page.waitForFunction(() => window.presentationSingleEntryPreview.detail.getItem(1, 'autocheck') === 'N' &&
                !document.querySelector('.entry-form input[type=checkbox].surface-editor'))
              assert.deepEqual(await changes(), ['Y', 'N', 'Y', 'N'], 'A subsequent click remains a single activation')
              await checkbox.focus()
              await page.keyboard.press('Space')
              await page.waitForFunction(() => document.querySelector('.entry-form [data-obj=autocheck]')?.getAttribute('aria-checked') === 'true')
              assert.deepEqual(await changes(), ['Y', 'N', 'Y', 'N', 'Y'], 'Semantic Space submits exactly one change after pointer editing')
              assert.match(await form.ariaSnapshot(), /checkbox "Auto Check:" \[checked\]/)
              await page.evaluate(() => {
                const f = window.presentationSingleEntryPreview
                f.checkboxSourceSequence = f.detail.def.objects.find((object) => object.name === 'autocheck').tabsequence
                f.detail.def.objects.find((object) => object.name === 'autocheck').tabsequence = '0'
              })
              const expectedChanges = ['Y', 'N', 'Y', 'N', 'Y']
              for (const [sequence, stored] of [[0, 'Y'], [3, 'N'], [0, 'N'], [3, 'Y']]) {
                await page.evaluate((sequence) => {
                  const f = window.presentationSingleEntryPreview
                  f.detail.modify(`autocheck.tabsequence='${sequence}'`)
                  f.control('dw_detail').changed()
                }, sequence)
                await page.waitForFunction((sequence) => document.querySelector('.entry-form [data-obj=autocheck]')
                  ?.getAttribute('aria-readonly') === String(sequence === 0), sequence)
                await checkbox.click()
                if (sequence) expectedChanges.push(stored)
                await page.waitForFunction((stored) => window.presentationSingleEntryPreview.detail.getItem(1, 'autocheck') === stored &&
                  !document.querySelector('.entry-form input[type=checkbox].surface-editor'), stored)
                assert.deepEqual(await changes(), expectedChanges,
                  `Real pointer activation follows live TabSequence ${sequence} without duplicate or disabled writes`)
              }
              await page.evaluate(() => {
                const f = window.presentationSingleEntryPreview
                f.detail.def.objects.find((object) => object.name === 'autocheck').tabsequence = f.checkboxSourceSequence
                f.detail.overrides.delete('autocheck.tabsequence')
                f.control('dw_detail').changed()
              })
              await page.evaluate(() => window.presentationSingleEntryPreview.window.props.set('editflag', false))
            }
            if (name === 'w_resourcecategory_form') {
              await form.locator('.entry-form [data-obj=description]').click()
              const textarea = form.locator('.entry-form textarea.surface-editor')
              await textarea.fill('First line\nSecond <literal>')
              await page.keyboard.press('Shift+Enter')
              assert.equal(await textarea.inputValue(), 'First line\nSecond <literal>\n',
                'Resource Category Shift+Enter inserts a newline in the real textarea')
              assert.equal(await page.evaluate(() => window.presentationSingleEntryPreview.control('dw_detail').n_gettext()),
                'First line\r\nSecond <literal>\r\n', 'Multiline live text uses the PowerScript line-ending contract')
              await page.keyboard.press('Escape')
              await page.evaluate(() => window.presentationSingleEntryPreview.window.props.set('editflag', false))
            }
            if (name === 'w_grade_form') {
              await form.getByRole('button', { name: /^Increase / }).click()
              const spin = form.getByRole('spinbutton')
              assert.equal(await spin.inputValue(), '3.25', 'Pointer stepping preserves the synthetic decimal fraction')
              await page.keyboard.press('ArrowDown')
              assert.equal(await spin.inputValue(), '2.25', 'Keyboard stepping uses the same exact decimal draft')
              assert.equal(await page.evaluate(() => String(window.presentationSingleEntryPreview.detail.getItem(1, 'numericalfactor'))),
                '2.25', 'Pointer and keyboard stepping alone do not write the stored buffer')
              await page.keyboard.press('Escape')
              await page.evaluate(() => window.presentationSingleEntryPreview.window.props.set('editflag', false))
            }
          } else {
            const select = form.getByRole('combobox', { name: 'Sort column', exact: true })
            await select.focus()
            await page.keyboard.press('Tab')
            assert.ok(await form.getByRole('radio', { name: 'Ascending', exact: true }).evaluate((element) => document.activeElement === element),
              'Standard entry keyboard order follows the reflowed criteria')
          }
          const snapshot = await form.ariaSnapshot()
          assert.match(snapshot, panel === 'List' ? /group "Sort Criteria"/ : name === 'w_message_form' ? /Description/ : /Name/)
          for (const control of await form.locator('[role=textbox],[role=gridcell],[role=tab],[role=checkbox][data-obj],input,textarea,select,button').all()) {
            if (!await control.isVisible() || !await control.isEnabled()) continue
            await control.focus()
            assert.ok(await control.evaluate((element) => {
              const rect = element.getBoundingClientRect(), style = getComputedStyle(element)
              return rect.top >= 0 && rect.bottom <= innerHeight + 1 && rect.left >= 0 && rect.right <= innerWidth + 1 &&
                parseFloat(style.outlineWidth) >= 2 && style.outlineStyle !== 'none'
            }), `${name}/${panel}/${width}: keyboard focus remains visible and outlined`)
          }
          const contrast = await visibleContrast(form)
          assert.ok(contrast.length && contrast.every((ratio) => ratio >= 4.5), `${name}/${panel}/${theme}/${scale}/${width}: text contrast`)
          singleEntryCases.push({ name, panel, theme, density, scale, width, height, minimumTextContrast: Math.min(...contrast) })
          await form.getByRole('tab', { name: panel, exact: true }).focus()
          await page.screenshot({ path: resolve(output, `${name}-${panel.toLowerCase()}-${theme}-${scale}-${width}.png`) })
        }
      } catch (error) {
        await writeFile(resolve(output, 'single-entry-failure.json'), JSON.stringify(await page.evaluate(() => {
          const preview = window.presentationSingleEntryPreview
          const control = preview.control('dw_detail')
          const editor = preview.view.ctlViews.get(control).dw
          return { name: preview.surface.name, row: preview.detail.row, column: preview.detail.col,
            changes: preview.events.filter((event) => event.target === control && event.event === 'itemchanged').map((event) => event.args),
            values: preview.detail.buf.primary.map((record) => record.v),
            input: editor.editor?.outerHTML, text: editor.editor?.value,
            status: editor.status?.textContent, active: document.activeElement?.tagName,
            fields: [...preview.element('dw_detail').querySelectorAll('[data-obj]')].map((element) => ({
              name: element.dataset.obj, role: element.getAttribute('role'), checked: element.getAttribute('aria-checked'),
            })),
          }
        }), null, 2) + '\n')
        await page.screenshot({ path: resolve(output, 'single-entry-failure.png') })
        throw error
      } finally {
        await page.evaluate(() => window.presentationSingleEntryPreview.close())
      }
    }
  }
  async function captureContacts(theme, density, scale, viewports) {
    for (const [width, height] of viewports) {
      await page.setViewportSize({ width, height })
      await page.evaluate(() => window.openPresentationContactPreview())
      await page.evaluate(() => {
        const child = window.presentationContactPreview.child
        child.model.setItem(2, 'address', 'Fixture address 2 / ' + 'Long synthetic address segment. '.repeat(30))
        child.changed()
      })
      const form = page.locator('.modern-entry-window')
      const grid = form.locator('[data-entry-control="tab_retrieve.tabpage_detail.dw_itemsdetail"] > .modern-surface')
      const record = async (panel, root = form) => {
        assert.ok(await (panel === 'Lookup' ? root : root.locator(':scope > .client'))
          .evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
        `Contacts/${panel}/${scale}/${width}: only the two-dimensional grids scroll horizontally`)
        const contrast = await visibleContrast(root)
        assert.ok(contrast.length && contrast.every((ratio) => ratio >= 4.5), `Contacts/${panel}/${theme}/${scale}/${width}: text contrast`)
        contactCases.push({ panel, theme, density, scale, width, height, minimumTextContrast: Math.min(...contrast) })
        await page.screenshot({ path: resolve(output, `contacts-${panel.toLowerCase()}-${theme}-${scale}-${width}.png`) })
      }
      try {
        assert.equal(await form.getAttribute('data-theme'), theme)
        assert.equal(await form.getAttribute('data-density'), density)
        assert.equal(await form.evaluate((root) => getComputedStyle(root).fontSize), `${14 * scale / 100}px`)
        assert.equal(await grid.locator('th').count(), 11)
        assert.match(await form.ariaSnapshot(), /grid "Contact group members"/)
        const columns = await grid.locator('.row[data-row="1"] [role=gridcell]').evaluateAll((cells) => cells.map((cell) => cell.dataset.obj))
        await grid.locator('.row[data-row="1"] [role=gridcell]').first().focus()
        await page.keyboard.press('Home')
        for (let column = 0; column < columns.length; column++) {
          if (column) await page.keyboard.press('ArrowRight')
          await page.waitForFunction((name) => document.activeElement?.dataset.obj === name, columns[column])
          const cell = grid.locator(`.row[data-row="1"] [data-obj="${columns[column]}"]`)
          assertGridFocus(await cell.evaluate(gridFocusState), `Contacts/${scale}/${width}/${columns[column]}`)
        }
        await record('Detail')
        await grid.locator('.row[data-row="1"] [data-obj=contactcardcode]').click()
        const choice = grid.getByRole('combobox', { name: 'Contact Card Code', exact: true })
        assert.equal(await choice.inputValue(), 'Synthetic contact Alpha')
        await choice.press('ArrowDown')
        await choice.press('Enter')
        await page.waitForFunction(() => window.presentationContactPreview.model.getItem(1, 'contactcardcode') === 2)
        await page.evaluate(() => window.presentationContactPreview.edit(1))
        assert.equal(await choice.inputValue(), 'Repeated contact label', 'Real readonly selection preserves the correct key behind duplicate labels')
        await grid.locator('.dw-choice-toggle').click()
        assert.ok(await choice.evaluate((input) => {
          const field = input.getBoundingClientRect()
          const popup = input.parentElement.querySelector('.dw-choice-popup:popover-open').getBoundingClientRect()
          const toggle = input.parentElement.querySelector('.dw-choice-toggle').getBoundingClientRect()
          const details = input.parentElement.querySelector('.dw-choice-browse').getBoundingClientRect()
          return Math.abs(popup.width - Math.min(field.width * 10, innerWidth - 8)) < 1 &&
            popup.left >= 4 && popup.right <= innerWidth - 4 && popup.top >= 0 && popup.bottom <= innerHeight &&
            toggle.right <= details.left + .5
        }), 'The 1000% contact popup is viewport-clamped and its toggle cannot cover the details action')
        await record('Choices')
        if (width === 1366) { await choice.focus(); await page.keyboard.press('Shift+F4') }
        else await grid.getByRole('button', { name: 'Browse Contact Card Code details', exact: true }).click()
        const lookup = page.getByRole('dialog', { name: 'Contact cards', exact: true })
        await lookup.waitFor({ state: 'visible' })
        assert.equal(await lookup.getAttribute('data-theme'), theme)
        assert.equal(await lookup.getAttribute('data-density'), density)
        assert.equal(await lookup.evaluate((element) => getComputedStyle(element).fontSize), `${14 * scale / 100}px`)
        await lookup.getByRole('searchbox', { name: 'Search loaded records', exact: true }).fill('Fixture address 2')
        await page.waitForFunction(() => {
          const dialog = document.querySelector('.presentation-lookup[open]')
          return dialog?.querySelector('table')?.getAttribute('aria-busy') === 'false' &&
            dialog.querySelectorAll('tbody tr').length === 1
        })
        assert.equal(await lookup.locator('th').count(), 11)
        await page.keyboard.press('ArrowDown')
        for (let column = 0; column < 11; column++) {
          if (column) await page.keyboard.press('ArrowRight')
          const cell = lookup.locator('tbody tr').first().locator('td').nth(column)
          assertGridFocus(await cell.evaluate(gridFocusState), `Lookup/${scale}/${width}/column ${column}`)
        }
        await lookup.locator('summary').click()
        assert.equal(await lookup.locator('dl').evaluate((element) =>
          [...element.querySelectorAll('dt')].find((label) => label.textContent === 'Address')?.nextElementSibling?.textContent),
        await page.evaluate(() => window.presentationContactPreview.child.model.getItem(2, 'address')),
        'Expanded details retain the complete long address')
        await lookup.getByRole('searchbox').focus()
        const lookupControls = await lookup.locator('input,button,summary,td[tabindex="0"]').all()
        for (const control of lookupControls) {
          if (!await control.isVisible() || !await control.isEnabled()) continue
          assert.ok(await control.evaluate((element) => {
            const rect = element.getBoundingClientRect(), style = getComputedStyle(element)
            return document.activeElement === element &&
              rect.top >= 0 && rect.bottom <= innerHeight + 1 && rect.left >= 0 && rect.right <= innerWidth + 1 &&
              parseFloat(style.outlineWidth) >= 2 && style.outlineStyle !== 'none'
          }), `Lookup/${scale}/${width}: Tab reaches each control in DOM order with visible focus`)
          await page.keyboard.press('Tab')
        }
        assert.ok(await lookup.getByRole('searchbox').evaluate((element) => document.activeElement === element),
          'Tab from the last lookup action wraps to search')
        await lookup.getByRole('searchbox').focus()
        await page.keyboard.press('ArrowDown')
        await record('Lookup', lookup)
        await page.keyboard.press('Escape')
        await lookup.waitFor({ state: 'detached' })
        assert.equal(await choice.inputValue(), 'Repeated contact label', 'Cancelling detailed browsing preserves the readonly display label')
        assert.deepEqual(await page.evaluate(async () => {
          const f = window.presentationContactPreview
          return { text: await f.detail.n_gettext(), value: f.model.getItem(1, 'contactcardcode') }
        }), { text: '2', value: 2 }, 'Cancelling detailed browsing preserves the current data key, not a native select option index')
        await choice.focus()
        await page.keyboard.press('Tab')
        await page.waitForFunction(() => window.presentationContactPreview.model.getItem(1, 'name') === 'Synthetic Bravo')
        await page.keyboard.press('Escape')
        await page.evaluate(() => window.presentationContactPreview.window.props.set('editflag', false))
        await form.getByRole('tab', { name: 'List', exact: true }).click()
        assert.match(await form.ariaSnapshot(), /group "Sort Criteria"/)
        await record('List')
      } finally {
        await page.evaluate(() => window.presentationContactPreview.close())
      }
    }
  }
  async function captureEntries(theme, density, scale, viewports) {
    for (const [width, height] of viewports) {
      await page.setViewportSize({ width, height })
      await page.evaluate(() => window.openPresentationEntryPreview())
      const form = page.locator('.modern-entry-window')
      assert.equal(await form.getAttribute('data-theme'), theme)
      assert.equal(await form.getAttribute('data-density'), density)
      assert.equal(await form.evaluate((root) => getComputedStyle(root).fontSize), `${14 * scale / 100}px`)
      for (const panel of ['Detail', 'List']) {
        await form.getByRole('tab', { name: panel, exact: true }).click()
        const client = form.locator(':scope > .client')
        assert.ok(await client.evaluate((root) => root.scrollWidth <= root.clientWidth + 1),
          `Aging/${panel}/${theme}/${scale}/${width}: only two-dimensional grids may scroll horizontally`)
        if (panel === 'List') {
          const find = form.locator('.entry-find [data-obj=find]')
          const input = form.locator('.entry-find input')
          await (async () => {
            await find.click({ timeout: 10000 })
            await input.fill('BR', { timeout: 10000 })
            await page.waitForFunction(() => window.presentationEntryPreview.window.props.get('il_selectedrow') === 2, null, { timeout: 10000 })
          })().catch(async (error) => {
              const state = await page.evaluate(async () => {
                const f = window.presentationEntryPreview, props = f.window.props, list = f.control('dw_list').model
                const rt = f.control('dw_find').rt
                const findView = f.view.ctlViews.get(f.control('dw_find')).dw
                const describe = (value) => value === undefined ? 'undefined' : value === null ? 'null' : String(value)
                const strip = f.element('tab_retrieve').querySelector('[role=tablist],.strip')
                const before = { selected: describe(props.get('il_selectedrow')), detailEnabled: describe(f.control('tabpage_detail').props.get('enabled')),
                  selectedTab: describe(f.control('tab_retrieve').props.get('selectedtab')), tabBusy: strip?.getAttribute('aria-busy') ?? null,
                  held: [...document.querySelectorAll('[data-tab-hold]')].map((element) => element.dataset.obj ?? element.className).slice(0, 8),
                  findInert: !!f.element('dw_find').closest('[inert]'),
                  listRow: list.row, listSelected: list.buf.primary.map((row, index) => row.sel ? index + 1 : 0).filter(Boolean) }
                // how far does the script get when it runs again (a hang shows as a timeout)
                const timeout = (ms) => new Promise((resolve) => setTimeout(() => resolve('timeout'), ms))
                let search = null
                try {
                  const holder = rt.getClass ? await rt.instantiate('f_binarysearch', null) : null
                  search = holder ? describe(await Promise.race([rt.callMethod(holder, 'f_binarysearch', ['BR', f.control('dw_list'), 'name']), timeout(3000)])) : 'no class'
                } catch (error) { search = 'error: ' + String(error?.message ?? error) }
                let refire = null
                try {
                  refire = describe(await Promise.race([rt.fire(f.control('dw_find'), 'editchanged', [1, { name: 'find' }, 'BR']), timeout(3000)]))
                } catch (error) { refire = 'error: ' + String(error?.message ?? error) }
                return { ...before, after: describe(props.get('il_selectedrow')), search, refire,
                  sort: props.get('is_sortsequence'), type: props.get('ii_type'),
                  column: props.get('ii_colindex'), editor: findView.editor?.value ?? null, draft: f.control('dw_find').model.getItem(1, 'find'),
                  pending: findView.pendingEdits?.size, list: [...Array(list.rowCount())].map((_, i) => list.getItem(i + 1, 'name')),
                  events: f.events.slice(-14).map((event) => `${event.target?.name}.${event.event}(${(event.args ?? []).map((arg) =>
                    typeof arg === 'object' ? arg?.name ?? '' : String(arg)).join(',')})`),
                  missing: [...(rt.missing?.keys() ?? [])].slice(-15), errors: window.presentationRuntimeErrors ?? null }
              })
              throw new Error(`The real Find did not select the matching row: ${JSON.stringify(state)}`, { cause: error })
            })
          assert.equal(await form.getByRole('tab', { name: 'Detail', exact: true }).getAttribute('aria-disabled'), 'false')
          await page.keyboard.press('Escape')
          const select = form.getByRole('combobox', { name: 'Sort column', exact: true })
          await select.focus()
          await page.keyboard.press('Tab')
          assert.ok(await form.getByRole('radio', { name: 'Ascending', exact: true }).evaluate((element) => document.activeElement === element),
            'The Modern criterion order follows its visible layout instead of legacy positive tab indices')
          const snapshot = await form.ariaSnapshot()
          assert.match(snapshot, /group "Sort Criteria"/)
          assert.match(snapshot, /group "Filter Criteria"/)
          const criterion = form.getByRole('combobox', { name: 'Filter value', exact: true })
          await page.evaluate(() => window.presentationEntryPreview.control('ddlb_data').pbSet('limit', 4))
          await criterion.fill('')
          await criterion.pressSequentially('ALPHABET')
          assert.equal(await criterion.inputValue(), 'ALPH', 'The native text limit bounds real keyboard input')
          await page.evaluate(() => window.presentationEntryPreview.control('ddlb_data').pbSet('limit', 0))
          await form.getByRole('combobox', { name: 'Filter operator', exact: true }).selectOption({ label: '>' })
          await criterion.fill('BR')
          await page.keyboard.press('Tab')
          await form.getByRole('button', { name: 'Filter', exact: true }).click()
          await page.waitForFunction(() => window.presentationEntryPreview.control('dw_list').model.rowCount() === 2)
          assert.deepEqual(await page.evaluate(() => {
            const model = window.presentationEntryPreview.control('dw_list').model
            return [model.getItem(1, 'name'), model.getItem(2, 'name')]
          }), ['BRAVO', 'CHARLIE'])
          await form.getByRole('button', { name: 'Unfilter', exact: true }).click()
          await page.waitForFunction(() => window.presentationEntryPreview.control('dw_list').model.rowCount() === 3)
          await form.getByRole('combobox', { name: 'Filter operator', exact: true }).selectOption({ label: '=' })
          await criterion.fill('Keep this typed value')
          await page.keyboard.press('ArrowDown')
          const choices = form.getByRole('listbox', { name: 'Filter value', exact: true })
          await choices.waitFor({ state: 'visible' })
          const bounds = await choices.boundingBox()
          assert.ok(bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= width + 1 && bounds.y + bounds.height <= height + 1,
            'The editable choices stay inside the effective viewport rather than behind a clipped panel')
          const popupContrast = await choices.evaluate((list) => {
            const luminance = (color) => (color.match(/[\d.]+/g) || []).slice(0, 3).map(Number).map((value) => {
              const v = value / 255
              return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4
            }).reduce((total, value, index) => total + value * [.2126, .7152, .0722][index], 0)
            return [...list.children].map((option) => {
              const style = getComputedStyle(option)
              const background = style.backgroundColor === 'rgba(0, 0, 0, 0)' ? getComputedStyle(list).backgroundColor : style.backgroundColor
              const light = luminance(style.color), back = luminance(background)
              return (Math.max(light, back) + .05) / (Math.min(light, back) + .05)
            })
          })
          assert.ok(popupContrast.length && popupContrast.every((ratio) => ratio >= 4.5), 'Popup choices retain readable selected and unselected text')
          await page.screenshot({ path: resolve(output, `aging-choices-${theme}-${scale}-${width}.png`) })
          await page.keyboard.press('Escape')
          assert.equal(await criterion.inputValue(), 'Keep this typed value')
          assert.equal(await criterion.getAttribute('aria-expanded'), 'false')
          await page.keyboard.press('ArrowDown')
          await page.keyboard.press('ArrowDown')
          await page.keyboard.press('Enter')
          assert.equal(await criterion.inputValue(), 'BRAVO')
          await form.getByRole('button', { name: 'Filter', exact: true }).click()
          await page.waitForFunction(() => window.presentationEntryPreview.control('dw_list').model.rowCount() === 1)
          await criterion.focus()
          await page.keyboard.press('ArrowDown')
          await choices.getByRole('option', { name: 'ALPHA', exact: true }).click()
          await page.waitForFunction(() => window.presentationEntryPreview.control('dw_list').model.getItem(1, 'name') === 'ALPHA')
          assert.equal(await criterion.inputValue(), 'ALPHA')
          await form.getByRole('button', { name: 'Unfilter', exact: true }).click()
          await page.waitForFunction(() => window.presentationEntryPreview.control('dw_list').model.rowCount() === 3)
          dropdownCases.push({ theme, density, scale, width, height, minimumTextContrast: Math.min(...popupContrast) })
        }
        const focused = form.locator('input,select,button,[role=textbox],[role=gridcell],[role=tab]')
        await page.keyboard.press('Tab')
        for (const control of await focused.all()) {
          if (!await control.isVisible() || !await control.isEnabled()) continue
          await control.focus()
          const focus = await control.evaluate((element) => {
            const rect = element.getBoundingClientRect()
            const style = getComputedStyle(element)
            return { visible: rect.top >= 0 && rect.bottom <= innerHeight + 1 && rect.left >= 0 && rect.right <= innerWidth + 1,
              outlined: parseFloat(style.outlineWidth) >= 2 && style.outlineStyle !== 'none',
              active: document.activeElement === element, focusVisible: element.matches(':focus-visible'),
              activeClass: document.activeElement?.className,
              accent: style.getPropertyValue('--p-accent'),
              focusRules: [...document.styleSheets].flatMap((sheet) => [...sheet.cssRules])
                .filter((rule) => rule.selectorText && element.matches(rule.selectorText) && rule.style?.outline)
                .map((rule) => rule.cssText),
              name: element.getAttribute('aria-label') || element.dataset.obj || element.textContent.trim(),
              rect: rect.toJSON(), outline: style.outline }
          })
          assert.ok(focus.visible && focus.outlined,
            `Aging/${panel}/${theme}/${scale}/${width}x${height}: focused controls stay visible and outlined ${JSON.stringify(focus)}`)
        }
        const contrast = await form.evaluate((root) => {
          const rgba = (color) => (color.match(/[\d.]+/g) || []).map(Number)
          const luminance = (color) => rgba(color).slice(0, 3).map((value) => {
            const v = value / 255
            return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
          }).reduce((total, value, index) => total + value * [0.2126, 0.7152, 0.0722][index], 0)
          return [...root.querySelectorAll('.ttl,legend,.entry-control.st,.entry-order span,input,select,button,.surface-label,.surface-value,th,.surface-status,.strip .t')]
            .filter((element) => element.getClientRects().length > 0).map((element) => {
              let ancestor = element
              let background = getComputedStyle(ancestor).backgroundColor
              while (rgba(background)[3] === 0 && ancestor.parentElement) {
                ancestor = ancestor.parentElement
                background = getComputedStyle(ancestor).backgroundColor
              }
              const foreground = luminance(getComputedStyle(element).color)
              const back = luminance(background)
              return (Math.max(foreground, back) + 0.05) / (Math.min(foreground, back) + 0.05)
            })
        })
        assert.ok(contrast.length && contrast.every((ratio) => ratio >= 4.5),
          `Aging/${panel}/${theme}/${scale}/${width}: all visible text has 4.5:1 contrast (${Math.min(...contrast)})`)
        entryCases.push({ panel, theme, density, scale, width, height, minimumTextContrast: Math.min(...contrast) })
        await form.getByRole('tab', { name: panel, exact: true }).focus()
        await page.screenshot({ path: resolve(output, `aging-${panel.toLowerCase()}-${theme}-${scale}-${width}.png`) })
      }
      await page.evaluate(() => window.presentationEntryPreview.close())
    }
  }
  async function captureWindows(theme, density, scale, viewports) {
    for (const [width, height] of viewports) {
      await page.setViewportSize({ width, height })
      for (const name of ['w_arg_decimal_val', 'w_printer_copies']) {
        await page.evaluate(({ name, long }) => window.openPresentationWindowPreview(name,
          long ? 'Synthetic percentage with an extended field label for reflow' : 'Synthetic percentage'), { name, long: width < 1000 })
        const form = page.locator('.modern-window')
        assert.equal(await form.evaluate((root) => getComputedStyle(root).fontSize), `${14 * scale / 100}px`)
        assert.equal(await form.getAttribute('data-theme'), theme)
        assert.equal(await form.getAttribute('data-density'), density)
        if (width < 1000) {
          await page.evaluate(() => window.presentationWindowPreview.window.pbSet('title', 'Synthetic response with an extended window title'))
        }
        await form.locator('input').fill('12')
        const geometry = await form.evaluate((root) => {
          const rect = root.getBoundingClientRect()
          return root.scrollWidth <= root.clientWidth && rect.left >= 0 && rect.right <= innerWidth &&
            rect.top >= 0 && rect.bottom <= innerHeight
        })
        assert.ok(geometry, `${name}/${theme}/${scale}/${width}: window and contents fit the effective viewport`)
        assert.match(await form.ariaSnapshot(), /textbox/)
        const contrast = await form.evaluate((root) => {
          const rgba = (color) => (color.match(/[\d.]+/g) || []).map(Number)
          const luminance = (color) => rgba(color).slice(0, 3).map((value) => {
            const v = value / 255
            return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
          }).reduce((total, value, index) => total + value * [0.2126, 0.7152, 0.0722][index], 0)
          return [...root.querySelectorAll('.ttl,label .ctl,input,button')].map((element) => {
            let ancestor = element
            let background = getComputedStyle(ancestor).backgroundColor
            while (rgba(background)[3] === 0 && ancestor.parentElement) {
              ancestor = ancestor.parentElement
              background = getComputedStyle(ancestor).backgroundColor
            }
            const foreground = luminance(getComputedStyle(element).color)
            const back = luminance(background)
            return (Math.max(foreground, back) + 0.05) / (Math.min(foreground, back) + 0.05)
          })
        })
        assert.ok(contrast.length && contrast.every((ratio) => ratio >= 4.5), `${name}/${theme}/${scale}/${width}: text contrast ${Math.min(...contrast)}`)
        windowCases.push({ name, theme, density, scale, width, height, minimumTextContrast: Math.min(...contrast) })
        await form.screenshot({ path: resolve(output, `${name}-${theme}-${scale}-${width}.png`) })
        for (const control of await form.locator('input,button').all()) {
          await control.focus()
          assert.ok(await control.evaluate((element) => {
            const rect = element.getBoundingClientRect()
            return rect.top >= 0 && rect.bottom <= innerHeight && rect.left >= 0 && rect.right <= innerWidth
          }), `${name}/${width}: every focused control remains visible`)
        }
        await form.getByRole('button', { name: 'Close window', exact: true }).click()
        await form.waitFor({ state: 'detached' })
      }
    }
  }
  async function captureCalculators(theme, density, scale, viewports) {
    for (const [width, height] of viewports) {
      await page.setViewportSize({ width, height })
      for (const [name, field, value, expected] of [
        ['w_pricecalculator', 'rate', '236', 200],
        ['w_discountcalculator', 'rate', '100', 50],
        ['w_qty_rate_value_calculator', 'value', '36', 3],
        ['w_set_flatdiscamt', 'discperc', '12.5', 125],
      ]) {
        await page.evaluate((name) => window.openPresentationCalculatorPreview(name), name)
        const form = page.locator('.modern-data-window')
        assert.equal(await form.getAttribute('data-theme'), theme)
        assert.equal(await form.getAttribute('data-density'), density)
        assert.equal(await form.evaluate((root) => getComputedStyle(root).fontSize), `${14 * scale / 100}px`)
        assert.ok(await form.evaluate((root) => {
          const bounds = root.getBoundingClientRect()
          return root.scrollWidth <= root.clientWidth + 1 && bounds.left >= 0 && bounds.right <= innerWidth &&
            bounds.top >= 0 && bounds.bottom <= innerHeight
        }), `${name}/${width}/${scale}: dialog and fields fit the effective viewport`)
        const contrast = await visibleContrast(form)
        assert.ok(contrast.length && contrast.every((value) => value >= 4.5),
          `${name}/${width}/${scale}: calculator text contrast`)
        assert.match(await form.ariaSnapshot(), /textbox/)
        if (name === 'w_discountcalculator') {
          const clicksBeforeTab = await page.evaluate(() => window.presentationCalculatorPreview.events.filter(
            (event) => event.target === window.presentationCalculatorPreview.control && event.event === 'clicked').length)
          await page.evaluate(() => window.presentationCalculatorPreview.control.n_setcolumn('rate'))
          await form.locator('[data-obj=name]').focus()
          await page.keyboard.press('Tab')
          await page.waitForFunction(() => {
            const f = window.presentationCalculatorPreview
            return f.model.col === f.model.colIndex('type') + 1 &&
              document.activeElement instanceof HTMLInputElement && document.activeElement.type === 'radio' &&
              document.activeElement.value === '1'
          })
          assert.equal(await page.evaluate(() => window.presentationCalculatorPreview.events.filter(
            (event) => event.target === window.presentationCalculatorPreview.control && event.event === 'clicked').length), clicksBeforeTab,
          'Tab-only radio entry selects its source column without inventing a Clicked event')
          await page.keyboard.press('Escape')
          await form.locator('[data-obj=type] [data-radio-choice="0"]').click()
          await page.waitForFunction(() => window.presentationCalculatorPreview.model.getItem(1, 'type') === 'F' &&
            document.activeElement instanceof HTMLInputElement && document.activeElement.type === 'radio' && document.activeElement.value === '0')
          await page.keyboard.press('ArrowRight')
          await page.waitForFunction(() => window.presentationCalculatorPreview.model.getItem(1, 'type') === 'D' &&
            document.activeElement instanceof HTMLInputElement && document.activeElement.type === 'radio' && document.activeElement.value === '1')
          assert.equal(await form.getByRole('radio', { name: 'Percentage Discount', exact: true }).isChecked(), true)
          await page.waitForFunction(() => {
            const input = document.activeElement
            if (!(input instanceof HTMLInputElement) || input.type !== 'radio' || input.value !== '1') return false
            const bounds = input.closest('label').getBoundingClientRect(), style = getComputedStyle(input)
            return bounds.top >= 0 && bounds.bottom <= innerHeight &&
              bounds.left >= 0 && bounds.right <= innerWidth && parseFloat(style.outlineWidth) >= 2 && style.outlineStyle !== 'none'
          }, null, { timeout: 5000 }).catch((error) => {
            throw new Error(`${name}/${width}/${scale}: the focused radio and its complete label must remain visible and outlined`, { cause: error })
          })
          const radioStyle = await form.getByRole('radio', { name: 'Percentage Discount', exact: true }).evaluate((input) => {
            const style = getComputedStyle(input)
            return { fontSize: style.fontSize, width: input.getBoundingClientRect().width, focusColor: style.outlineColor }
          })
          assert.equal(radioStyle.fontSize, `${14 * scale / 100}px`, 'Radio glyphs inherit the selected text size')
          assert.ok(Math.abs(radioStyle.width - 14 * scale / 100 * 1.1) < 1, 'Radio glyphs grow with text rather than keeping the browser default size')
          assert.equal(radioStyle.focusColor, theme === 'dark' ? 'rgb(156, 201, 255)' : 'rgb(9, 90, 198)',
            'Radio focus uses the current theme accent instead of a legacy system highlight')
          await form.screenshot({ path: resolve(output, `${name}-choices-${theme}-${scale}-${width}.png`) })
          await page.keyboard.press('Tab')
          await page.waitForFunction(() => document.activeElement?.closest('[data-obj]')?.getAttribute('data-obj') === 'rate')
        }
        await form.locator(`[data-obj="${field}"]`).click()
        await form.locator('input.dw-edit').fill(value)
        await page.keyboard.press('Tab')
        await page.waitForFunction(({ field, value }) => {
          if (Number(window.presentationCalculatorPreview.model.getItem(1, field)) !== Number(value)) return false
          const root = document.querySelector('.modern-data-window')
          const active = document.activeElement
          if (!(active instanceof HTMLElement) || !root?.contains(active)) return false
          const bounds = active.getBoundingClientRect()
          return bounds.width > 0 && bounds.height > 0 && bounds.top >= 0 && bounds.bottom <= innerHeight &&
            bounds.left >= 0 && bounds.right <= innerWidth
        }, { field, value }, { timeout: 5000 }).catch(async (error) => {
          const state = await page.evaluate((field) => {
            const active = document.activeElement, bounds = active?.getBoundingClientRect()
            const scrollers = []
            for (let at = active?.parentElement; at; at = at.parentElement) {
              const style = getComputedStyle(at)
              if (/(auto|scroll|hidden)/.test(style.overflowY)) scrollers.push(`${at.tagName.toLowerCase()}.${String(at.className).split(' ')[0]} ${style.overflowY} ${at.scrollTop}/${at.scrollHeight - at.clientHeight}`)
            }
            return { value: window.presentationCalculatorPreview.model.getItem(1, field), active: active ? `${active.tagName}.${active.className} [${active.closest('[data-obj]')?.dataset.obj ?? ''}]` : null,
              bounds: bounds?.toJSON(), viewport: [innerWidth, innerHeight], scrollers }
          }, field)
          throw new Error(`${name}/${width}/${scale}: the next field after Tab must be focused and visible: ${JSON.stringify(state)}`, { cause: error })
        })
        await page.screenshot({ path: resolve(output, `${name}-${theme}-${scale}-${width}.png`) })
        const ok = form.getByRole('button', { name: 'Ok', exact: true })
        const cancel = form.getByRole('button', { name: 'Cancel', exact: true })
        await ok.focus()
        await page.keyboard.press('Tab')
        assert.ok(await cancel.evaluate((element) => {
          const bounds = element.getBoundingClientRect(), style = getComputedStyle(element)
          return document.activeElement === element && bounds.top >= 0 && bounds.bottom <= innerHeight &&
            bounds.left >= 0 && bounds.right <= innerWidth && parseFloat(style.outlineWidth) >= 2 && style.outlineStyle !== 'none'
        }), `${name}/${width}/${scale}: Cancel is keyboard reachable, visible and outlined`)
        await page.keyboard.press('Shift+Tab')
        assert.ok(await ok.evaluate((element) => document.activeElement === element), 'Shift+Tab returns to the original OK button')
        await ok.click()
        await form.waitFor({ state: 'detached' })
        const result = await page.evaluate(async () => {
          const f = window.presentationCalculatorPreview
          await f.pending
          const returned = f.returned()
          const value = f.name === 'w_set_flatdiscamt' ? Number(returned) : f.name === 'w_discountcalculator' ? Number(returned.pbGet('d_amt')) :
            Number(returned.pbGet(f.name === 'w_pricecalculator' ? 'd_netamt' : 'd_balance'))
          return { value, changes: f.events.filter((event) => event.target === f.control && event.event === 'itemchanged').length,
            clicks: f.events.filter((event) => event.target.name === 'cb_ok' && event.event === 'clicked').length }
        })
        assert.equal(result.value, expected, `${name}: real input reaches the recovered calculation and return channel`)
        assert.equal(result.changes, name === 'w_discountcalculator' ? 3 : 1,
          `${name}: each actual field or radio change raises one ItemChanged event`)
        assert.equal(result.clicks, 1, `${name}: one actual OK click raises one Clicked event`)
        await page.evaluate(() => window.presentationCalculatorPreview.close())
        calculatorCases.push({ name, theme, density, scale, width, height, minimumTextContrast: Math.min(...contrast) })
      }
    }
  }
  await captureWindows('light', 'compact', 100, [[1366, 768]])
  await captureCalculators('light', 'compact', 100, [[1366, 768]])
  await captureEntries('light', 'compact', 100, [[1366, 768]])
  await captureSingleEntries('light', 'compact', 100, [[1366, 768]], 'w_message_form')
  for (const name of ['w_checklistitem_form', 'w_shift_form', 'w_taxcategory_form', 'w_resourcecategory_form', 'w_grade_form', 'w_goodscompany_form']) {
    await captureSingleEntries('light', 'compact', 100, [[1366, 768]], name)
  }
  await captureContacts('light', 'compact', 100, [[1366, 768]])
  await captureContactCards('light', 'compact', 100, [[1366, 768]])
  await page.evaluate(() => window.openPresentationEntryPreview())
  const beforeAppearance = await page.evaluate(() => window.presentationEntryPreview.control('dw_detail').model.getItem(1, 'name'))
  await page.locator('.modern-entry-window [role=textbox][data-obj=name]').click()
  await page.locator('.modern-entry-window .surface-editor').fill('Synthetic appearance draft')
  assert.equal(await page.locator('.modern-entry-window .surface-editor').inputValue(), 'SYNTHETIC APPEARANCE DRAFT',
    'The appearance draft follows the source uppercase rule before settings change')
  await page.getByRole('button', { name: 'Appearance', exact: true }).click()
  for (const name of ['Next sign-in interface', 'Theme', 'Density', 'Text size', 'Print layout']) {
    assert.equal(await page.getByRole('combobox', { name, exact: true }).count(), 1, `Explicit accessible name for ${name}`)
  }
  await page.getByLabel('Theme', { exact: true }).selectOption('dark')
  await page.getByLabel('Density', { exact: true }).selectOption('comfortable')
  await page.getByLabel('Text size', { exact: true }).selectOption('200')
  await page.getByRole('button', { name: 'Save settings', exact: true }).click()
  assert.equal(await page.locator('.modern-entry-window').getAttribute('data-theme'), 'dark',
    'Saved appearance settings reach the composed entry window, not only its DataWindows')
  await page.waitForFunction(() => {
    const f = window.presentationEntryPreview
    const view = f.view.ctlViews.get(f.control('dw_detail')).dw
    return view.editor?.value === 'SYNTHETIC APPEARANCE DRAFT'
  })
  assert.equal(await page.evaluate(() => window.presentationEntryPreview.control('dw_detail').model.getItem(1, 'name')),
    beforeAppearance, 'Changing appearance preserves the draft without storing it')
  await page.evaluate(() => window.presentationEntryPreview.close())
  assert.equal(await page.locator('.modern-surface').first().evaluate((root) => getComputedStyle(root).fontSize), '28px',
    'Saved appearance settings reach live Modern DataWindow surfaces')
  await page.getByRole('button', { name: 'Appearance', exact: true }).click()
  await page.screenshot({ path: resolve(output, 'appearance-dark-200.png') })
  await page.getByRole('button', { name: 'Save settings', exact: true }).focus()
  await page.keyboard.press('Tab')
  assert.equal(await page.evaluate(() => document.activeElement.name), 'mode', 'Appearance traps forward keyboard focus')
  await page.keyboard.press('Shift+Tab')
  assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Save settings', 'Appearance traps reverse keyboard focus')
  for (const [width, height] of [[683, 384], [320, 768]]) {
    await page.setViewportSize({ width, height })
    await page.getByRole('button', { name: 'Save settings', exact: true }).focus()
    await page.waitForFunction(() => {
      const dialog = document.querySelector('dialog[open]')
      const rect = document.activeElement.getBoundingClientRect()
      return dialog.scrollWidth <= dialog.clientWidth && rect.top >= 0 && rect.bottom <= innerHeight
    }, null, { timeout: 5000 }).catch((error) => {
      throw new Error(`Settings overflow or obscure focus at ${width}x${height} and 200% text`, { cause: error })
    })
  }
  await page.keyboard.press('Escape')
  assert.equal(await page.getByRole('dialog').count(), 0, 'Escape closes Appearance without saving')
  await captureWindows('dark', 'comfortable', 200, [[1366, 768], [683, 384], [320, 768]])
  await captureCalculators('dark', 'comfortable', 200, [[1366, 768], [683, 384], [320, 768]])
  await captureEntries('dark', 'comfortable', 200, [[1366, 768], [683, 384], [320, 768]])
  await captureSingleEntries('dark', 'comfortable', 200, [[1366, 768], [683, 384], [320, 768]], 'w_manufacturertype_form')
  for (const name of ['w_checklistitem_form', 'w_shift_form', 'w_taxcategory_form', 'w_resourcecategory_form', 'w_grade_form', 'w_goodscompany_form']) {
    await captureSingleEntries('dark', 'comfortable', 200, [[1366, 768], [683, 384], [320, 768]], name)
  }
  await captureContacts('dark', 'comfortable', 200, [[1366, 768], [683, 384], [320, 768]])
  await captureContactCards('dark', 'comfortable', 200, [[1366, 768], [683, 384], [320, 768]])
  assert.equal(await page.evaluate(() => window.fixtureNativeAccess), 0, 'Preview interactions must not reach a containing desktop application')
  assert.deepEqual(pageErrors, [])
  assert.deepEqual(forbidden, [], 'Synthetic checks must not access a database or external server')
  const criteriaCases = await captureCriteria(page, output)
  await checkItemSelectionInput(page)
  await checkNativeDateInput(page)
  await checkCalendarInput(page)
  await checkLookupCriteriaInput(page)
  await checkReferenceCriteriaInput(page)
  await checkNumericCriteriaInput(page)
  await checkDateOptionInput(page)
  await checkDateChoiceInput(page)
  const criteriaWindowCases = await captureCriteriaWindows(page, output)
  const derivedModalCases = await captureDerivedModalWindows(page, output)
  const calendarCases = await captureCalendars(page, output)
  await checkDataWindowCalendarInput(page)
  const dataWindowCalendarCases = await captureCalendars(page, output, true)
  const forcedColors = await checkForcedColors(page, output)
  const printSettingsCases = await capturePrintSettings(page, output)
  const printDocumentCases = await capturePrintDocuments(page, output)
  assert.deepEqual(forcedColors.failures, [])
  assert.deepEqual(pageErrors, [])
  assert.deepEqual(forbidden, [])
  assert.equal(await page.evaluate(() => window.fixtureNativeAccess), 0)
  await writeFile(resolve(output, 'result.json'), JSON.stringify({ ...result, surfaceCases, windowCases, calculatorCases, calendarCases, dataWindowCalendarCases, entryCases, singleEntryCases, contactCases, contactCardCases, dropdownCases, editableLookupCases, automaticChoiceCases, selectorVariantCases, transactionBandCases, associatedInvoiceCases, cashierCases, paymentCases, categoryCases, criteriaCases, criteriaWindowCases, derivedModalCases, printSettingsCases, printDocumentCases, forcedColors, accessibility: { scanner: axeSource ? 'axe-core' : 'not installed', cases: axeCases }, performanceSamples: await page.evaluate(() => window.presentationPerformance ?? []), skippedTextChecks: await page.evaluate(() => window.singleEntrySkippedText ?? []), pageErrors, forbidden }, null, 2) + '\n')
  console.log(`Presentation: ${result.passed} browser assertions; four viewport sizes; ${surfaceCases.length} surface, ${windowCases.length} dialog, ${calculatorCases.length} calculator, ${calendarCases.length} calendar, ${dataWindowCalendarCases.length} DataWindow-calendar, ${entryCases.length} aging-entry, ${singleEntryCases.length} single-entry, ${contactCases.length} contact-group, ${contactCardCases.length} contact-card, ${dropdownCases.length} editable-dropdown, ${editableLookupCases.length} editable-lookup, ${automaticChoiceCases.length} automatic-choice, ${selectorVariantCases.length} selector-variant, ${transactionBandCases.length} transaction-band, ${associatedInvoiceCases.length} associated-invoice, ${cashierCases.length} cashier, ${paymentCases.length} payment, ${categoryCases.length} category, ${criteriaCases.length} criteria, ${criteriaWindowCases.length} criteria-window and ${derivedModalCases.length} generated-window appearance cases; no database or external requests.`)
  {
    const serious = axeCases.flatMap((item) => item.violations.filter((violation) => ['serious', 'critical'].includes(violation.impact)).map((violation) => `${item.label}: ${violation.id} (${violation.impact}, ${violation.nodes} nodes, ${violation.sample})`))
    console.log(axeSource ? `Accessibility scan: ${axeCases.length} generated dialog appearances, ${serious.length} serious or critical WCAG violations.` : 'Accessibility scan: axe-core not installed, not run.')
    for (const line of serious.slice(0, 40)) console.log('  ' + line)
    assert.deepEqual(serious, [], 'Generated Modern dialogs have no serious or critical automated WCAG violation')
  }
  }
  }
  }
  }
} catch (error) {
  const page = browser?.contexts()[0]?.pages()[0]
  if (page) {
    try {
      await writeFile(resolve(output, 'failure-state.json'), JSON.stringify(await page.evaluate(() => ({
        checks: window.presentationCheckProgress,
        errors: window.presentationRuntimeErrors,
        cashier: window.cashierCheckProgress,
        payment: window.paymentCheckProgress,
        category: window.categoryCheckProgress,
        dialogs: [...document.querySelectorAll('dialog,.msgbox')].map((element) => ({
          className: element.className, open: element.open, visible: !!element.getClientRects().length,
          text: element.textContent, buttons: [...element.querySelectorAll('button')].map((button) => button.textContent),
        })),
        activeElement: document.activeElement === document.body ? 'BODY' : document.activeElement?.outerHTML,
      })), null, 2) + '\n')
      await page.screenshot({ path: resolve(output, 'failure.png') })
    }
    catch (captureError) { console.error('Failure screenshot could not be captured:', captureError) }
  }
  throw error
} finally {
  await browser?.close()
  await new Promise((resolve) => server.close(resolve))
}
