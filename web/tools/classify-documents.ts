// Evidence-based classification of DataWindows into screen, report-viewer and print-document candidates.
// It reads only data/src (redacted definitions and scripts).  A class names the evidence found, never a guess from a name, and
// no class approves a Modern template: approvals and physical dimensions stay open (see docs/UI-ENHANCEMENT.md).
//
// usage: node tools/classify-documents.ts [--check]     (run from web/)
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { loadDefinitions } from './derive-data-surfaces.ts'
import { PRINT_TEMPLATES } from '../src/ui/print-templates.ts'

const here = import.meta.dirname
const source = resolve(here, '..', '..', 'data', 'src')
export const OUTPUT = resolve(here, '..', '..', 'docs', 'ui-print-classification.json')

const ASSIGN = /(?:([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\s*\.\s*)?dataobject\s*=\s*["']([A-Za-z0-9_]+)["']/gi

function targetOf(identifier: string | undefined): 'print' | 'report' | 'datastore' | 'control' | 'implicit' | 'other' {
  const name = (identifier ?? '').split('.').at(-1)!.toLowerCase()
  if (!name) return 'implicit'
  if (name.includes('print')) return 'print'
  if (name.includes('report') || name.startsWith('rpt')) return 'report'
  if (/^(l|i|a|g)?ds_|^lds|^ids/.test(name)) return 'datastore'
  if (/^(a|i|l)?dw_/.test(name)) return 'control'
  return 'other'
}

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(resolve(dir, entry.name)) : entry.name.endsWith('.pbs') ? [resolve(dir, entry.name)] : [])
}

export function classify() {
  const definitions = loadDefinitions()
  const uses = new Map<string, Record<string, number>>()
  const referenced = new Set<string>()
  const root = resolve(source, 'scripts')
  if (existsSync(root)) {
    for (const file of walk(root).sort()) {
      const text = readFileSync(file, 'utf8')
      for (const match of text.matchAll(ASSIGN)) {
        const name = match[2].toLowerCase()
        if (!definitions.has(name)) continue
        const entry = uses.get(name) ?? {}
        const target = targetOf(match[1])
        entry[target] = (entry[target] ?? 0) + 1
        uses.set(name, entry)
      }
      for (const match of text.matchAll(/["']([A-Za-z_][A-Za-z0-9_]*)["']/g)) if (definitions.has(match[1].toLowerCase())) referenced.add(match[1].toLowerCase())
    }
  }
  // Static window controls and nested reports, from the window definitions.
  const onScreen = new Set<string>()
  const hiddenOnly = new Set<string>()
  const objectsRoot = resolve(source, 'objects')
  const visit = (controls: any[]) => {
    for (const control of controls ?? []) {
      const dataobject = control.fields?.find((field: any) => field.name === 'dataobject')?.value
      if (typeof dataobject === 'string' && dataobject) {
        const visible = control.fields?.find((field: any) => field.name === 'visible')?.value
        ;(visible === false ? hiddenOnly : onScreen).add(dataobject.toLowerCase())
      }
      visit(control.controls)
    }
  }
  for (const library of readdirSync(objectsRoot)) {
    const dir = resolve(objectsRoot, library, 'window')
    if (!existsSync(dir)) continue
    for (const file of readdirSync(dir)) if (file.endsWith('.json')) visit(JSON.parse(readFileSync(resolve(dir, file), 'utf8')).controls)
  }
  const nested = new Set<string>()
  for (const def of definitions.values()) for (const object of def.objects) if (object.type === 'report' && object.dataobject) nested.add(object.dataobject.toLowerCase())

  const registered = new Set(PRINT_TEMPLATES.flatMap((template) => template.definitions))
  const classes: Record<string, string[]> = {}
  const flags = { captionless: 0, multiUp: 0, headerData: 0, letterhead: 0, pageNumbers: 0, grouped: 0, crosstab: 0, label: 0, graph: 0, composite: 0 }
  for (const [name, def] of definitions) {
    const used = uses.get(name) ?? {}
    const processing = Number(def.datawindow.processing ?? 0)
    const pageNumbers = def.objects.some((object) => /\bpage(count)?\s*\(/i.test(object.expression ?? ''))
    // A company letterhead (f_ReportHeaderInfo*, owner preferences) or a reprint counter is printed-document evidence.
    const letterhead = def.objects.some((object) => /f_reportheaderinfo|f_stringpreferences\s*\(\s*['"]owner|reprintcounter/i.test(object.expression ?? ''))
    if (letterhead) flags.letterhead++
    // Record data (columns or computed values) printed in the header band is a document layout: on-screen grids keep only captions there.
    const headerData = def.objects.some((object) => object.band === 'header' && (object.type === 'column' || object.type === 'compute'))
    if (headerData) flags.headerData++
    // Several copies of the same column side by side in the detail band (name_1, name_2, ...) is a multi-up label sheet.
    const detailColumns = new Set(def.objects.filter((object) => object.type === 'column' && object.band === 'detail').map((object) => object.name))
    const multiUp = [...detailColumns].some((column) => /_1$/.test(column) && detailColumns.has(column.replace(/_1$/, '_2')))
    if (multiUp) flags.multiUp++
    // Several columns and no caption text anywhere: a data or export definition (distributor interface files), not a human-facing screen.
    const columnCount = def.objects.filter((object) => object.type === 'column').length
    const captionless = columnCount >= 4 && !def.objects.some((object) => object.type === 'text')
    if (captionless) flags.captionless++
    if (pageNumbers) flags.pageNumbers++
    if (def.bands.group?.length) flags.grouped++
    if (processing === 4) flags.crosstab++
    if (processing === 2) flags.label++
    if (processing === 3) flags.graph++
    if (processing === 5) flags.composite++
    // Highest-evidence class first; a DataWindow lands in exactly one class.
    const cls = registered.has(name) ? 'registered-template' :
      used.print ? 'print-target' :
      used.report || pageNumbers || letterhead || headerData || multiUp || captionless || [2, 3, 4, 5].includes(processing) ? 'report-or-document' :
      onScreen.has(name) ? 'screen-control' :
      used.control || used.implicit ? 'script-assigned-control' :
      used.datastore ? 'datastore-only' :
      hiddenOnly.has(name) ? 'hidden-control-only' :
      nested.has(name) ? 'nested-in-report' :
      referenced.has(name) ? 'referenced-by-name' : 'no-evidence'
    ;(classes[cls] ??= []).push(name)
  }
  const sorted = Object.fromEntries(Object.entries(classes).sort(([a], [b]) => a.localeCompare(b)).map(([key, names]) => [key, names.sort()]))
  return {
    note: 'Generated by web/tools/classify-documents.ts. Evidence classes only: no template is approved and no physical dimension is assumed.',
    definitions: definitions.size,
    classes: Object.fromEntries(Object.entries(sorted).map(([key, names]) => [key, names.length])),
    structuralFlags: flags,
    printCandidates: (sorted['print-target']?.length ?? 0) + (sorted['report-or-document']?.length ?? 0) + (sorted['registered-template']?.length ?? 0),
    members: sorted,
  }
}

if (import.meta.main) {
  const text = JSON.stringify(classify(), null, 1) + '\n'
  if (process.argv.includes('--check')) {
    if (!existsSync(OUTPUT) || readFileSync(OUTPUT, 'utf8') !== text) { console.error('Stale: run node tools/classify-documents.ts'); process.exit(1) }
  } else writeFileSync(OUTPUT, text)
  const parsed = JSON.parse(text)
  console.log(parsed.definitions, parsed.classes, parsed.structuralFlags, 'print candidates', parsed.printCandidates)
}
