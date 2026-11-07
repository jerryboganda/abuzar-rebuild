// End-to-end completion audit for the Classic/Modern presentation plan.
// It reads the static inventory, the authored registries and optional measured
// test results.  It never treats a mapping count as an accepted workflow and it
// never invents native, hardware or assistive-technology evidence.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  WINDOW_SURFACES, CALCULATOR_WINDOW_SURFACES, CALENDAR_WINDOW_SURFACES, CRITERIA_WINDOW_SURFACES, ENTRY_WINDOW_SURFACES,
} from '../../web/src/ui/window-surfaces.ts'
import { DATA_SURFACES } from '../../web/src/ui/data-surfaces.ts'
import { PRINT_TEMPLATES } from '../../web/src/ui/print-templates.ts'

const here = dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const option = (name, fallback) => {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : fallback
}
const fail = (message) => {
  console.error(message)
  process.exit(2)
}
// Results of checks this tool cannot run itself are supplied by the caller; anything
// not supplied is reported as "not supplied" instead of being assumed.
const passFail = (name) => {
  const value = option(name)
  if (value === undefined) return null
  const match = /^(\d+)\/(\d+)$/.exec(value)
  return match ? { passed: Number(match[1]), failed: Number(match[2]) } : fail(`${name} expects <passed>/<failed>, for example 796/0`)
}
const inventoryPath = resolve(option('--inventory', resolve(here, '..', '..', 'docs', 'ui-inventory.json')))
const resultPath = option('--result')
const printResultPath = option('--print-result')
const outRoot = resolve(option('--out', resolve(here, '..', '..', 'docs')))
const frontendTests = passFail('--frontend-tests')
const inventoryTests = passFail('--inventory-tests')
const staticModules = option('--static-modules')
const typecheck = option('--typecheck')
const remoteCi = option('--ci')

if (!existsSync(inventoryPath)) {
  fail(`The static inventory is not tracked and was not found at ${inventoryPath}.\n`
    + 'Generate it with: python -I tools/parity/ui_inventory.py --out <inventory.json>\n'
    + 'then run this tool again with --inventory <inventory.json>.')
}

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'))
const inventory = readJson(inventoryPath)
const result = resultPath ? readJson(resultPath) : null
const printResult = printResultPath ? readJson(printResultPath) : null

const unique = (items) => new Set(items.map((item) => String(item).toLowerCase()))
const windowRegistries = {
  windowSurfaces: WINDOW_SURFACES,
  calendarWindows: CALENDAR_WINDOW_SURFACES,
  calculatorWindows: CALCULATOR_WINDOW_SURFACES,
  criteriaWindows: CRITERIA_WINDOW_SURFACES,
  entryWindows: ENTRY_WINDOW_SURFACES,
}
const mappedWindows = unique(Object.values(windowRegistries).flatMap((registry) => registry.map((item) => item.name)))
const inventoryWindows = unique((inventory.windows || []).map((item) => item.id || item.name))
const mappedWindowsInInventory = new Set([...mappedWindows].filter((name) => inventoryWindows.has(name)))
const mappedWindowsOutsideInventory = [...mappedWindows].filter((name) => !inventoryWindows.has(name)).sort()

// A DataWindow counts as authored when it is a global surface or a contextual surface
// of an authored window or entry (including lookup surfaces nested in a field).
const surfaceNamesOf = (roots) => {
  const names = new Set()
  const seen = new WeakSet()
  const visit = (surface) => {
    if (!surface || seen.has(surface)) return
    seen.add(surface)
    names.add(String(surface.name).toLowerCase())
    for (const field of surface.fields || []) visit(field.lookup)
  }
  roots.forEach(visit)
  return names
}
const contextualRoots = [
  ...[WINDOW_SURFACES, CALENDAR_WINDOW_SURFACES, CALCULATOR_WINDOW_SURFACES, CRITERIA_WINDOW_SURFACES]
    .flatMap((registry) => registry.flatMap((window) => (window.data || []).map((item) => item.surface))),
  ...ENTRY_WINDOW_SURFACES.flatMap((entry) => [...entry.details.map((detail) => detail.surface), entry.list]),
]
const globalDataWindows = surfaceNamesOf(DATA_SURFACES)
const contextualDataWindows = surfaceNamesOf(contextualRoots)
const mappedDataWindows = new Set([...globalDataWindows, ...contextualDataWindows])
const inventoryDataWindows = unique((inventory.datawindows || []).map((item) => item.id || item.name))
const mappedDataWindowsInInventory = new Set([...mappedDataWindows].filter((name) => inventoryDataWindows.has(name)))
const mappedDataWindowsOutsideInventory = [...mappedDataWindows].filter((name) => !inventoryDataWindows.has(name)).sort()
const printDefinitions = unique(PRINT_TEMPLATES.flatMap((template) => template.definitions))
const printDefinitionsInInventory = new Set([...printDefinitions].filter((name) => inventoryDataWindows.has(name)))
const unmappedWindows = inventoryWindows.size - mappedWindowsInInventory.size
const unmappedDataWindows = inventoryDataWindows.size - mappedDataWindowsInInventory.size
const unregisteredPrintDefinitions = inventoryDataWindows.size - printDefinitionsInInventory.size
const number = (value) => value.toLocaleString('en-US')
const inventoryStatus = (inventory.windows || []).reduce((counts, window) => {
  const status = window.modernStatus || 'unknown'
  counts[status] = (counts[status] || 0) + 1
  return counts
}, {})
const documentUse = (inventory.datawindows || []).reduce((counts, datawindow) => {
  const use = datawindow.documentUse || 'unknown'
  counts[use] = (counts[use] || 0) + 1
  return counts
}, {})

const caseKeys = result ? Object.keys(result).filter((key) => key.endsWith('Cases') && Array.isArray(result[key])) : []
const appearances = result ? caseKeys.reduce((total, key) => total + result[key].length, 0) : 0
const contrastValues = result ? caseKeys.flatMap((key) => result[key]
  .map((item) => item.minimumTextContrast ?? item.contrast)
  .filter((value) => typeof value === 'number')) : []
const minimumContrast = contrastValues.length ? Math.min(...contrastValues) : null

const documentUnclassified = (documentUse.unclassified ?? 0) + (documentUse.unknown ?? 0)
const approvedPrintTemplates = PRINT_TEMPLATES.filter((template) => template.status === 'approved').length
if (typecheck !== undefined && typecheck !== 'passed' && typecheck !== 'failed') fail('--typecheck expects passed or failed')
const localChecks = [
  frontendTests && `${frontendTests.passed} frontend tests passed, ${frontendTests.failed} failed`,
  typecheck && `strict presentation types ${typecheck}`,
  inventoryTests && `${inventoryTests.passed} inventory tests passed, ${inventoryTests.failed} failed`,
  staticModules && `${staticModules}-module static build`,
].filter(Boolean)
const localChecksClean = frontendTests?.failed === 0 && inventoryTests?.failed === 0 && typecheck === 'passed' && Boolean(staticModules)
const ciEvidence = `Remote CI (the ci and sql workflows) is authoritative for the revision that contains this report and is not recorded in this file; last run supplied when generated: ${remoteCi ?? 'none'}.`
const workPackages = [
  {
    id: 'ui-baseline',
    status: 'partial',
    evidence: `Static inventory covers ${inventory.counts?.windows ?? inventoryWindows.size} windows and ${inventory.counts?.datawindows ?? inventoryDataWindows.size} DataWindows; runtime role/caller and document-family classification are not complete.`,
  },
  {
    id: 'ui-direction',
    status: 'partial',
    evidence: 'Windows-familiar tokens and the isolated prototype exist; the all-role production pilot and official document direction are not approved.',
  },
  {
    id: 'ui-contract',
    status: 'partial',
    evidence: 'Shared validation, choice, text, temporal, tab, modal and calendar contracts have characterization/synthetic coverage, including the additional f_getdatefromcalendar, aging/list and inpatient/service F4 callers; full native event/property equivalence remains open.',
  },
  {
    id: 'ui-preferences',
    status: 'partial',
    evidence: 'Versioned workstation/user/database preferences, hashed keys, deferred mode changes and per-family print choices are implemented; authenticated database/native acceptance is pending.',
  },
  {
    id: 'ui-primitives',
    status: 'partial',
    evidence: 'Modern controls, selectors, grids, dialogs, tabs, feedback, forced colors and print tokens exist; native chrome, assistive-technology and remaining selector variants remain open.',
  },
  {
    id: 'ui-shell',
    status: 'partial',
    evidence: `${mappedWindowsInInventory.size} windows have authored layouts; complete rights-aware navigation, the full catalog and role workflows are not covered.`,
  },
  {
    id: 'ui-data-surfaces',
    status: 'partial',
    evidence: `${mappedDataWindowsInInventory.size} DataWindow definitions have explicit surfaces (${globalDataWindows.size} global, ${contextualDataWindows.size} contextual); ${number(unmappedDataWindows)} inventoried DataWindows are unmapped.`,
  },
  {
    id: 'ui-print-engine',
    status: 'partial',
    evidence: `Classic isolation and per-family Modern choice are verified; ${PRINT_TEMPLATES.filter((template) => template.status === 'approved').length} approved templates and ${PRINT_TEMPLATES.filter((template) => template.status === 'preview').length} preview templates exist, with ${PRINT_TEMPLATES.filter((template) => template.status === 'blocked').length} blocked family.`,
  },
  {
    id: 'ui-pilot',
    status: 'blocked',
    evidence: 'No all-role end-to-end Cash Sale, Purchase, Account Ledger and Manager reporting pilot has been accepted.',
  },
  {
    id: 'ui-screen-coverage',
    status: 'partial',
    evidence: `${mappedWindowsInInventory.size} of ${number(inventoryWindows.size)} windows have authored surfaces; complete verified screens remain zero.`,
  },
  {
    id: 'ui-print-coverage',
    status: 'blocked',
    evidence: `${printDefinitionsInInventory.size} of ${number(inventoryDataWindows.size)} DataWindows are registered as print templates; no template is approved and item-label hardware dimensions are unknown.`,
  },
  {
    id: 'ui-resilience',
    status: 'partial',
    evidence: 'Synthetic interaction, focus, contrast, scaling and lifecycle checks pass; native assistive technology, real hardware and production-data acceptance are not performed.',
  },
  {
    id: 'ui-release-verification',
    status: 'blocked',
    evidence: 'Packaged Windows/WebView2, authenticated PostgreSQL, native assistive technology, printer/scanner and remote CI gates are outstanding.',
  },
  {
    id: 'ui-handoff',
    status: 'partial',
    evidence: 'Product/design/evidence documents exist, but a complete screen/document acceptance matrix and release handoff cannot be produced while the above gates remain open.',
  },
]

const acceptance = [
  ['Coverage inventory and explicit status for every screen/field/action/state', 'partial',
    `${mappedWindowsInInventory.size}/${number(inventoryWindows.size)} windows and ${mappedDataWindowsInInventory.size}/${number(inventoryDataWindows.size)} DataWindows have authored surfaces; the inventory reports ${inventory.counts?.modernVerified ?? 0} verified Modern screens.`],
  ['Classic has zero unexplained functional regressions', 'partial',
    'Local Classic/Modern characterization and synthetic browser checks pass; no complete recorded Classic baseline over all workflows exists.'],
  ['Modern and Classic produce identical business outcomes for the same synthetic transactions', 'partial',
    'Component and transaction-dialog fixtures compare values; complete sale/purchase/cashier transactions are not accepted.'],
  ['Shared-engine event characterization', 'verified',
    'Editing, validation rejection, dropdown selection, item focus, posted events, dynamic visibility, modal return, CloseQuery and calendar ordering have tests.'],
  ['All four screen/print combinations', 'partial',
    'Two invoice preview definitions support Classic/Modern print; all remaining document families do not.'],
  ['Printed documents preserve data and machine-readable payloads; every template tested empty/single/multipage/long/grouped', 'partial',
    'Synthetic print fixtures cover values, groups, totals, page numbers, dimensions and empty reports for the preview engine; no official template catalog is approved.'],
  ['Machine-consumed exports remain compatible', 'partial',
    'CSV/text/xlsx/HTML/XML tests pass; every document family is not re-verified against its exports.'],
  ['Fresh preferences start Modern; existing Classic honored; user/database isolation', 'verified',
    'Unit and browser preference cases cover defaults, isolation, deferred mode, family inheritance and storage failure.'],
  ['Mode change leaves edits intact and applies next sign-in', 'verified',
    'Synthetic preference and workspace lifecycle checks pass; real authenticated sign-in is not exercised.'],
  ['Tab activation does not rerun Open; dirty close follows CloseQuery', 'verified',
    'Lifecycle and browser tests cover retained windows, close guards and modal returns.'],
  ['Pending operations cannot be double-submitted; unknown writes shown as uncertain', 'partial',
    'Cashier/category/payment fixtures cover duplicate submission and uncertain commits; full application write paths are not covered.'],
  ['Theme/density/text changes retain edits, focus, validation and barcode input', 'partial',
    'Synthetic appearance cases pass; barcode hardware and packaged WebView2 are not verified.'],
  ['Repeated open/close releases listeners and temporary views', 'verified',
    'Lifecycle and browser cleanup checks pass for the tested surfaces.'],
  ['WCAG 2.2 AA through automated checks and manual Windows screen-reader/keyboard assessment', 'blocked',
    'Automated contrast/focus/forced-color checks pass; manual Windows screen-reader assessment and a complete criterion audit are not performed.'],
  ['Normal text 4.5:1; large text/non-text 3:1; state not color alone', 'verified',
    minimumContrast === null ? 'Measured by the browser suite; see the current result artifact.' : `Measured minimum text contrast ${minimumContrast}:1 across the measured appearance cases.`],
  ['Keys, names, relationships, live feedback, focus containment/restoration, drag alternatives', 'partial',
    'Synthetic browser checks cover the mapped surfaces; complete application coverage and native assistive technology are open.'],
  ['Pointer targets 24x24 or documented exception', 'verified',
    'Authored controls and appearance checks cover the mapped surfaces.'],
  ['No keyboard trap; grid editing and accelerator map tested', 'partial',
    'Mapped grid, dialog and tab cases pass; the complete historical accelerator map and every screen are not audited.'],
  ['1366x768 and 1920x1080 at 100/125/150/200% Windows scaling', 'partial',
    'Browser 1366/1920/320/683 checks pass; physical Windows scaling is not measured.'],
  ['200% text and reflow at 320 CSS px equivalent', 'verified',
    'Browser appearance cases cover 200% text at narrow effective widths for the mapped surfaces.'],
  ['Light/dark, forced colors, reduced motion, validation/selection/disabled/focus/loading', 'partial',
    `${result?.forcedColors ? `Browser light/dark and ${result.forcedColors.passed} forced-color assertions pass` : 'Browser light/dark and forced-color checks are reported by the browser result artifact (not supplied)'}; native Windows high contrast and every loading/disabled state remain open.`],
  ['p95 interaction feedback and tab-switch targets on the agreed Windows machine', 'blocked',
    'No packaged Windows performance measurement on the reference machine.'],
  ['30,000-item lookup and 100,000-row report/grid fixtures', 'partial',
    'Synthetic large-lookup and 10,000-row fixtures exist; the required 30,000/100,000 fixed fixtures are not both verified.'],
  ['Barcode sequence, rapid keyboard, active-cell preservation', 'partial',
    'Synthetic keyboard/barcode and active-cell checks pass; scanner hardware is not verified.'],
  ['No new browser exceptions, unhandled rejections or silent failures', 'verified',
    result ? `Current full browser run: ${result.failures?.length ?? 0} failures, ${result.errors?.length ?? 0} errors, ${result.pageErrors?.length ?? 0} page errors, ${result.forbidden?.length ?? 0} forbidden requests.` : 'See the current browser result artifact.'],
  ['Packaged Windows/WebView2 native theme, scaling, focus, shortcuts, print dialog, printers', 'blocked',
    'Not performed on a packaged Windows/WebView2 build.'],
  ['Local Node tests, type validation, static build', localChecksClean ? 'verified' : 'partial',
    localChecks.length ? `${localChecks.join('; ')}.` : 'No local check results were supplied to this report.'],
  ['Blocking UI acceptance job / typed checks / deterministic fixtures', 'partial',
    `A blocking CI presentation job and deterministic fixtures exist. ${ciEvidence}`],
  ['Rust/PostgreSQL/desktop integration in authorized CI', remoteCi ? 'partial' : 'blocked',
    `${ciEvidence} The presentation job itself uses synthetic fixtures, not an authenticated PostgreSQL session.`],
]

const blockers = [
  `Complete screen/field/action/state catalog: ${number(unmappedWindows)} of ${number(inventoryWindows.size)} windows have no authored Modern surface, and 0 complete workflows are accepted.`,
  `Complete document catalog: ${number(unregisteredPrintDefinitions)} of ${number(inventoryDataWindows.size)} DataWindows are not registered as Modern print templates; ${approvedPrintTemplates} templates are approved.`,
  documentUnclassified
    ? `Document-family classification and caller/reachability evidence are still unclassified for ${number(documentUnclassified)} DataWindows in the static inventory.`
    : 'Caller/reachability evidence for each document family is not yet attached to the static inventory.',
  'No all-role Cash Sale, Purchase, Account Ledger and Manager pilot acceptance.',
  'No packaged Windows/WebView2 native theme, scaling, focus, shortcut, print-dialog or printer verification.',
  'No authenticated PostgreSQL end-to-end acceptance of the Modern presentation; the presentation job runs synthetic fixtures.',
  'No manual Windows screen-reader/keyboard WCAG 2.2 AA assessment.',
  'No physical printer, scanner, barcode-scanner or label-paper acceptance; label dimensions are unknown.',
  'No 30,000-item and 100,000-row required fixed fixtures or reference-machine p95 measurements.',
]

const summary = {
  generatedAt: new Date().toISOString(),
  sourceDigest: inventory.sourceDigest ?? inventory.counts?.sourceDigest ?? null,
  inventory: {
    windows: inventory.counts?.windows ?? inventoryWindows.size,
    windowControlPaths: inventory.counts?.windowControlPaths ?? null,
    datawindows: inventory.counts?.datawindows ?? inventoryDataWindows.size,
    datawindowColumns: inventory.counts?.datawindowColumns ?? null,
    missingStaticDatawindows: inventory.counts?.missingStaticDatawindows
      ?? (Array.isArray(inventory.missingStaticDatawindows) ? inventory.missingStaticDatawindows.length : null),
    modernVerified: inventory.counts?.modernVerified ?? 0,
    inventoryStatus,
    documentUse,
  },
  authored: {
    windowMappings: {
      windowSurfaces: WINDOW_SURFACES.length,
      calendarWindows: CALENDAR_WINDOW_SURFACES.length,
      calculatorWindows: CALCULATOR_WINDOW_SURFACES.length,
      criteriaWindows: CRITERIA_WINDOW_SURFACES.length,
      entryWindows: ENTRY_WINDOW_SURFACES.length,
      unique: mappedWindowsInInventory.size,
      unmapped: unmappedWindows,
      outsideInventory: mappedWindowsOutsideInventory,
    },
    dataWindowMappings: {
      globalSurfaces: globalDataWindows.size,
      contextualSurfaces: contextualDataWindows.size,
      unique: mappedDataWindowsInInventory.size,
      unmapped: unmappedDataWindows,
      outsideInventory: mappedDataWindowsOutsideInventory,
    },
    printTemplates: {
      families: new Set(PRINT_TEMPLATES.map((template) => template.family)).size,
      templates: PRINT_TEMPLATES.length,
      definitions: printDefinitionsInInventory.size,
      approved: approvedPrintTemplates,
      preview: PRINT_TEMPLATES.filter((template) => template.status === 'preview').length,
      blocked: PRINT_TEMPLATES.filter((template) => template.status === 'blocked').length,
    },
  },
  measured: result ? {
    passed: result.passed,
    failures: result.failures,
    errors: result.errors,
    pageErrors: result.pageErrors,
    forbidden: result.forbidden,
    appearances,
    caseKeys,
    forcedColors: result.forcedColors ?? null,
    minimumContrast,
  } : null,
  focusedPrint: printResult ? {
    passed: printResult.passed,
    failures: printResult.failures,
    errors: printResult.errors,
    settingsAppearances: printResult.printSettingsCases?.length ?? 0,
    documentAppearances: printResult.printDocumentCases?.length ?? 0,
  } : null,
  workPackages,
  acceptance,
  blockers,
  complete: false,
}

const esc = (value) => String(value).replace(/\|/g, '\\|').replace(/\n/g, ' ')
const pct = (part, total) => total ? `${(100 * part / total).toFixed(2)}%` : 'n/a'
const markdown = `# Classic/Modern completion audit

Generated from the working tree on ${summary.generatedAt}.
Static source digest: \`${summary.sourceDigest ?? 'unknown'}\`.

## Verdict

**NOT 100% COMPLETE.** The plan's own release gates still include an incomplete
screen/document catalog, no accepted all-role pilot, no approved Modern print
templates, and no packaged Windows/WebView2, assistive-technology or physical
printer/scanner acceptance. The measured local checks are real, but they cover
only the authored surfaces.

## Measured evidence

| Check | Result |
|---|---|
| Frontend tests | ${frontendTests ? `${frontendTests.passed} passed, ${frontendTests.failed} failed` : 'not supplied'} |
| Strict presentation types | ${typecheck ? typecheck.charAt(0).toUpperCase() + typecheck.slice(1) : 'not supplied'} |
| Static inventory tests | ${inventoryTests ? `${inventoryTests.passed} passed, ${inventoryTests.failed} failed` : 'not supplied'} |
| Static build | ${staticModules ? `${staticModules} modules` : 'not supplied'} |
| Full browser suite | ${result ? `${result.passed} assertions, ${appearances} appearances; ${result.failures?.length ?? 0} failures, ${result.errors?.length ?? 0} errors, ${result.pageErrors?.length ?? 0} page errors, ${result.forbidden?.length ?? 0} forbidden requests` : 'not supplied'} |
| Forced-color checks | ${result?.forcedColors ? `${result.forcedColors.passed} assertions, ${result.forcedColors.failures?.length ?? 0} failures, ${Array.isArray(result.forcedColors.cases) ? result.forcedColors.cases.length : result.forcedColors.cases ?? 0} cases` : 'not supplied'} |
| Focused print checks | ${printResult ? `${printResult.passed} assertions, ${printResult.printSettingsCases?.length ?? 0} settings and ${printResult.printDocumentCases?.length ?? 0} document appearances; no printer access` : 'not supplied'} |
| Additional calendar callers | \`web/tests/calendar-callers.test.ts\` covers f_getdatefromcalendar, aging/list F4 fields and inpatient/service DataWindow F4 fields inside the frontend suite above |

## Coverage

| Denominator | Count |
|---|---:|
| Window definitions | ${summary.inventory.windows} |
| Inherited window control paths | ${summary.inventory.windowControlPaths ?? 'unknown'} |
| DataWindow definitions | ${summary.inventory.datawindows} |
| DataWindow columns | ${summary.inventory.datawindowColumns ?? 'unknown'} |
| Missing static DataWindow references | ${summary.inventory.missingStaticDatawindows ?? 'unknown'} |
| Windows with an authored Modern layout | ${summary.authored.windowMappings.unique} (${pct(summary.authored.windowMappings.unique, summary.inventory.windows)}) |
| Authored layouts by registry | ${summary.authored.windowMappings.windowSurfaces} workspace/tool, ${summary.authored.windowMappings.criteriaWindows} criteria, ${summary.authored.windowMappings.entryWindows} entry, ${summary.authored.windowMappings.calculatorWindows} calculator, ${summary.authored.windowMappings.calendarWindows} calendar |
| Windows without an authored layout | ${summary.authored.windowMappings.unmapped} |
| DataWindows with an authored surface | ${summary.authored.dataWindowMappings.unique} (${pct(summary.authored.dataWindowMappings.unique, summary.inventory.datawindows)}); ${summary.authored.dataWindowMappings.globalSurfaces} from the global registry (with nested lookups) and ${summary.authored.dataWindowMappings.contextualSurfaces} contextual, overlaps counted once |
| DataWindows without an authored surface | ${summary.authored.dataWindowMappings.unmapped} |
| Authored names absent from the static inventory | ${summary.authored.windowMappings.outsideInventory.length} windows, ${summary.authored.dataWindowMappings.outsideInventory.length} DataWindows${summary.authored.dataWindowMappings.outsideInventory.length ? ` (${summary.authored.dataWindowMappings.outsideInventory.join(', ')})` : ''} |
| Modern print template families | ${summary.authored.printTemplates.families} |
| Registered Modern print definitions | ${summary.authored.printTemplates.definitions} |
| Approved Modern print templates | ${summary.authored.printTemplates.approved} |
| Preview Modern print templates | ${summary.authored.printTemplates.preview} |
| Blocked Modern print templates | ${summary.authored.printTemplates.blocked} |
| Verified complete Modern screens | ${summary.inventory.modernVerified} |
| Document uses classified | ${JSON.stringify(summary.inventory.documentUse)} |

The static inventory reports **0 verified Modern screens** because it has no
complete per-screen acceptance evidence. Authored mappings are presentation
components, not accepted business workflows.

## Work packages

| Package | Status | Evidence |
|---|---|---|
${workPackages.map((item) => `| ${item.id} | ${item.status} | ${esc(item.evidence)} |`).join('\n')}

## Acceptance criteria

| Criterion | Status | Evidence |
|---|---|---|
${acceptance.map(([criterion, status, evidence]) => `| ${esc(criterion)} | ${status} | ${esc(evidence)} |`).join('\n')}

## Blockers

${blockers.map((item) => `- ${item}`).join('\n')}

## Conclusion

The end-to-end verification does **not** support a 100% completion claim. The
local automated suite is green and the Modern print engine and current dialog
families are verified for their scoped synthetic evidence, but the plan's
required screen/document catalog and native/hardware acceptance remain open.

This report only reads the working tree; it performs no commit, push, release,
deployment or live-system change.
`

mkdirSync(outRoot, { recursive: true })
const jsonPath = resolve(outRoot, 'ui-completion-audit.json')
const mdPath = resolve(outRoot, 'ui-completion-audit.md')
writeFileSync(jsonPath, JSON.stringify(summary, null, 2) + '\n')
writeFileSync(mdPath, markdown)
console.log(JSON.stringify({
  complete: summary.complete,
  windows: `${summary.authored.windowMappings.unique}/${summary.inventory.windows}`,
  datawindows: `${summary.authored.dataWindowMappings.unique}/${summary.inventory.datawindows}`,
  printDefinitions: `${summary.authored.printTemplates.definitions}/${summary.inventory.datawindows}`,
  approvedPrintTemplates: summary.authored.printTemplates.approved,
  verifiedScreens: summary.inventory.modernVerified,
  browser: summary.measured ? { passed: summary.measured.passed, appearances: summary.measured.appearances } : null,
  blockers: summary.blockers.length,
  json: jsonPath,
  markdown: mdPath,
}, null, 2))
