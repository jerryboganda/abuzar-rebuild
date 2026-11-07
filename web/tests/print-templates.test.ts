import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  PRINT_TEMPLATES, printFamilies, printTemplateFor, printTemplateIssues, resolvePrintPresentation,
} from '../src/ui/print-templates.ts'
import { MODERN_PRINT_CSS } from '../src/ui/modern-print.ts'
import { printDocumentStyle } from '../src/ui/print.ts'
import { DEFAULT_UI_PREFERENCES, PresentationSession, preferenceKey, validatePreferences } from '../src/app/ui-preferences.ts'
import type { PreferenceStorage } from '../src/app/ui-preferences.ts'

const index = JSON.parse(readFileSync(resolve(import.meta.dirname, '..', '..', 'data', 'src', 'dw', '_index.json'), 'utf8')) as Record<string, string>

test('print template catalog uses unique, available, lowercase definitions', () => {
  assert.deepEqual(printTemplateIssues(), [])
  for (const template of PRINT_TEMPLATES) {
    for (const definition of template.definitions) {
      assert.ok(Object.hasOwn(index, definition), `missing DataWindow definition ${definition}`)
    }
  }
  assert.equal(printTemplateFor('d_retailsaleinvreport')?.family, 'sales-invoice')
  assert.equal(printTemplateFor('D_RETAILSALEINVREPORT')?.id, 'sales-invoice-standard')
  assert.equal(printTemplateFor('d_not_registered'), undefined)
  assert.equal(printTemplateFor(undefined), undefined)
})

test('duplicate and incomplete catalog entries fail the explicit gate', () => {
  const entry = PRINT_TEMPLATES[0]
  assert.ok(printTemplateIssues([entry, entry]).includes(`Duplicate template identity: ${entry.id}`))
  assert.ok(printTemplateIssues([entry, { ...entry, id: 'second' }])
    .includes(`Definition is registered twice: ${entry.definitions[0]}`))
  assert.ok(printTemplateIssues([{ ...entry, id: 'bad id' }]).some((issue) => issue.startsWith('Invalid template identity')))
  assert.ok(printTemplateIssues([{ ...entry, definitions: [] }]).includes(`Template has no definitions: ${entry.id}`))
  assert.ok(printTemplateIssues([{ ...entry, status: 'blocked', blockedReason: '' }])
    .includes(`Blocked template has no reason: ${entry.id}`))
})

test('document families expose preview and blocked availability separately', () => {
  const families = printFamilies()
  assert.equal(families.find((family) => family.id === 'sales-invoice')?.status, 'preview')
  assert.equal(families.find((family) => family.id === 'purchase-invoice')?.status, 'preview')
  assert.equal(families.find((family) => family.id === 'item-label')?.status, 'blocked')
  assert.match(families.find((family) => family.id === 'item-label')!.blockedReason!, /Label paper dimensions/)
})

test('unregistered, preview, approved and blocked layouts resolve without silent substitution', () => {
  assert.deepEqual(resolvePrintPresentation('d_not_registered', 'classic'), { presentation: 'classic' })
  assert.match(resolvePrintPresentation('d_not_registered', 'modern').notice!, /No Modern template/)
  assert.equal(resolvePrintPresentation('d_retailsaleinvreport', 'classic').presentation, 'classic')
  assert.match(resolvePrintPresentation('d_retailsaleinvreport', 'modern', { preview: false }).notice!, /gated preview/)
  assert.equal(resolvePrintPresentation('d_retailsaleinvreport', 'modern', { preview: true }).presentation, 'modern')
  assert.match(resolvePrintPresentation('d_itemlabels_4', 'modern', { preview: true }).notice!, /Label paper dimensions/)
  assert.equal(resolvePrintPresentation('d_itemlabels_4', 'modern', { preview: true }).presentation, 'classic')
  for (const definition of ['d_not_registered', 'd_itemlabels_4']) {
    const notice = resolvePrintPresentation(definition, 'modern', { preview: true }).notice!
    assert.match(notice, /Select Classic print layout/)
    assert.doesNotMatch(notice, /will print/)
  }

  const approved = {
    ...PRINT_TEMPLATES[0], id: 'approved-test', family: 'approved-test', definitions: ['d_synthetic_approved'], status: 'approved' as const,
  }
  assert.equal(resolvePrintPresentation('d_synthetic_approved', 'modern', { templates: [approved] }).presentation, 'modern')
  assert.equal(resolvePrintPresentation('d_synthetic_approved', 'classic', { templates: [approved] }).presentation, 'classic')
})

test('Modern print style is white-paper and cannot inherit dark workspace tokens', () => {
  assert.match(MODERN_PRINT_CSS, /\.print-modern/)
  assert.match(MODERN_PRINT_CSS, /print-color-adjust:exact/)
  assert.match(MODERN_PRINT_CSS, /font-variant-numeric:tabular-nums/)
  assert.doesNotMatch(MODERN_PRINT_CSS, /#202630|#171d25|--p-surface|--p-text/)
})

test('Classic print style never includes Modern document rules', () => {
  const page = { width: 793.7, height: 1122.5, left: 37.8, right: 37.8, top: 37.8, bottom: 37.8 }
  const classic = printDocumentStyle('body{color:#000}', page, 'classic')
  const modern = printDocumentStyle('body{color:#000}', page, 'modern')
  assert.doesNotMatch(classic, /\.print-modern|print-color-adjust/)
  assert.match(modern, /\.print-modern/)
  assert.match(modern, /@page \{ size: 793\.7px 1122\.5px; margin: 0 \}/)
})

class MemoryStorage implements PreferenceStorage {
  records = new Map<string, string>()
  getItem(key: string): string | null { return this.records.get(key) ?? null }
  setItem(key: string, value: string): void { this.records.set(key, value) }
}

const scope = { server: 'https://example.invalid/api', database: 'synthetic', appUser: '17', workstation: 'fixture' }

test('per-family print choices are isolated and fall back to the global layout', async () => {
  const storage = new MemoryStorage()
  const session = await PresentationSession.load(storage, scope)
  assert.equal(session.printModeFor('sales-invoice'), 'classic')
  session.save({ ...session.preferences, printMode: 'classic', printFamilies: { 'sales-invoice': 'modern' } })
  assert.equal(session.printModeFor('sales-invoice'), 'modern')
  assert.equal(session.printModeFor('purchase-invoice'), 'classic')
  assert.equal(session.printModeFor('unregistered-family'), 'classic')

  const next = await PresentationSession.load(storage, scope)
  assert.equal(next.printModeFor('sales-invoice'), 'modern')
  assert.equal(next.preferences.printFamilies['sales-invoice'], 'modern')
  // The caller cannot mutate the stored map through the snapshot.
  const snapshot = next.preferences
  ;(snapshot.printFamilies as Record<string, 'classic' | 'modern'>)['sales-invoice'] = 'classic'
  assert.equal(next.preferences.printFamilies['sales-invoice'], 'modern')
})

test('old preference records remain readable and invalid family maps are rejected', async () => {
  const storage = new MemoryStorage()
  const key = await preferenceKey(scope)
  // Mirrors the pre-family v1 record shape.  New fields are optional on read.
  const old = { version: 1, mode: 'classic', printMode: 'classic', theme: 'light', density: 'compact', textSize: 100 }
  assert.deepEqual(validatePreferences(old).printFamilies, {})
  storage.records.set(key, JSON.stringify(old))
  const session = await PresentationSession.load(storage, scope)
  assert.deepEqual(session.preferences.printFamilies, {})
  assert.equal(session.activeMode, 'classic')
  assert.equal(session.preferences.theme, 'light')
  assert.equal(storage.records.get(key), JSON.stringify(old))

  for (const printFamilies of [
    null, [], 'modern', { 'Bad Key': 'modern' }, { 'sales-invoice': 'unknown' },
    Object.fromEntries(Array.from({ length: 65 }, (_, index) => [`family-${index}`, 'classic'])),
  ]) {
    assert.throws(() => validatePreferences({ ...DEFAULT_UI_PREFERENCES, printFamilies }), /invalid values/)
  }
})

test('only explicit own family preferences override the global print layout', async () => {
  const session = await PresentationSession.load(new MemoryStorage(), scope)
  for (const family of ['constructor', 'toString', 'valueOf']) assert.equal(session.printModeFor(family), 'classic')
  session.save({ ...session.preferences, printMode: 'modern', printFamilies: { constructor: 'classic' } })
  assert.equal(session.printModeFor('constructor'), 'classic')
  assert.equal(session.printModeFor('toString'), 'modern')
  session.save({ ...session.preferences, printFamilies: {} })
  assert.equal(session.printModeFor('constructor'), 'modern')
})
