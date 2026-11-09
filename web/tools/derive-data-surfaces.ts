// Derives Modern DataWindow surfaces from the recovered source definitions (data/src/dw) and validates each one with the
// same `dataSurfaceIssues` check the runtime applies.  Only mappings that pass are written; everything else stays on the
// labelled Classic layout and is recorded with its concrete reason in docs/ui-derived-surfaces-backlog.json.
//
// usage: node tools/derive-data-surfaces.ts [--check]     (run from web/; --check fails when the generated files are stale)
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { colKind } from '../src/dw/def.ts'
import type { DwDef, DwObject } from '../src/dw/def.ts'
import { choiceStyle } from '../src/dw/choices.ts'
import { dwMultiline } from '../src/dw/edit.ts'
import { numericSpin } from '../src/ui/numeric-spin.ts'
import {
  DATA_SURFACES, dataSurfaceIssues, dataSurfacePositionIssues, alwaysHidden, clippedObject, captionBeside, captionAbove, fieldBetween,
  suffixBeside, sameBox, readingOrder, exactHeader, holderBox,
} from '../src/ui/data-surfaces.ts'
import { ENTRY_WINDOW_SURFACES, WINDOW_SURFACES, CALCULATOR_WINDOW_SURFACES, CRITERIA_WINDOW_SURFACES } from '../src/ui/window-surfaces.ts'
import type { DataSurface, DataSurfaceField } from '../src/ui/data-surfaces.ts'

const here = import.meta.dirname
const dataRoot = resolve(here, '..', '..', 'data', 'src', 'dw')
export const OUTPUT_TS = resolve(here, '..', 'src', 'ui', 'derived-data-surfaces.ts')
export const OUTPUT_BACKLOG = resolve(here, '..', '..', 'docs', 'ui-derived-surfaces-backlog.json')

const num = (object: DwObject, key: string) => Number(object[key] ?? 0)
const centreY = (object: DwObject) => num(object, 'y') + num(object, 'height') / 2

export function titleOf(name: string): string {
  const words = name.replace(/^d_/, '').split('_').filter(Boolean)
  const text = words.join(' ')
  return text.charAt(0).toUpperCase() + text.slice(1)
}

const ART = new Set(['bitmap', 'rectangle', 'roundrectangle', 'ellipse', 'line'])

export interface Derivation { surface?: DataSurface; reason?: string }

/** Pairs every label with the column it describes using the geometry stored in the source definition. */
export function derive(name: string, def: DwDef, options: { plainSeparators?: boolean } = {}): Derivation {
  const processing = Number(def.datawindow.processing ?? 0)
  if (processing !== 0 && processing !== 1) return { reason: `processing style ${processing}` }
  // A freeform ("tabular") DataWindow whose captions sit in a header band reads as a grid, as the original paints it.
  // An object placed below its band's height, or in a header or detail band without height, is never painted by the original.
  const clippedOf = (object: DwObject) => clippedObject(def, object)
  const clipped = def.objects.filter(clippedOf)
  const live = def.objects.filter((object) => !clippedOf(object))
  const tabular = processing === 0 && live.some((object) => object.type === 'text' && object.band === 'header') &&
    !live.some((object) => object.type === 'text' && object.band === 'detail')
  const kind = processing === 1 || tabular ? 'grid' : 'form'
  const labelBand = kind === 'grid' ? 'header' : 'detail'
  const totalBands = ['summary', 'footer'] as const
  // Group levels (grids only) show their header and trailer bands at every break.
  const groupLevels = ((def.bands.group ?? []) as { level: string }[]).map((group) => Number(group.level))
  if (groupLevels.length && kind !== 'grid') return { reason: 'grouped bands' }
  const groupBands = groupLevels.flatMap((level) => [`header.${level}`, `trailer.${level}`])
  const strange = live.find((object) =>
    !(object.type === 'column' && object.band === 'detail' || object.type === 'compute' && object.band === 'detail' ||
      kind === 'grid' && object.type === 'button' && object.band === 'detail' ||
      object.type === 'text' && object.band === labelBand ||
      kind === 'form' && (object.type === 'groupbox' || object.type === 'line') && object.band === 'detail' ||
      kind === 'form' && object.type === 'button' && object.band === 'detail' ||
      // Text, columns and computed values in the background layer are painted content (a heading such as "Item Name: ..."), not artwork.
      ART.has(object.type) && (object.band === 'detail' || object.band === 'header' || object.band === 'background') ||
      object.type === 'line' && (totalBands as readonly string[]).includes(object.band) ||
      kind === 'grid' && (object.type === 'text' || object.type === 'compute') && (totalBands as readonly string[]).includes(object.band) ||
      kind === 'grid' && (object.type === 'text' || object.type === 'compute' || object.type === 'column') && groupBands.includes(object.band)))
  if (strange) return { reason: `unsupported object: ${strange.type} in ${strange.band}` }
  const inBand = (band: string, type: string) => live.filter((object) => object.band === band && object.type === type)
  // A button in a grid's detail band is a per-row button column; in a form it is a separate `buttons` entry.
  const fields = [...inBand('detail', 'column'), ...inBand('detail', 'compute'), ...(kind === 'grid' ? inBand('detail', 'button') : [])]
  const texts = inBand(labelBand, 'text')
  const groupboxes = inBand('detail', 'groupbox')
  const horizontal = (line: DwObject) => num(line, 'y1') === num(line, 'y2') && num(line, 'x2') > num(line, 'x1')
  // A rule line the surface cannot place (grouped forms, odd order) is accounted for as an unpainted decoration: it is design, not structure.
  const lines = options.plainSeparators ? [] : inBand('detail', 'line').filter(horizontal)
  const separatorLines = new Set(lines.map((line) => line.name))
  if (!fields.length && !(kind === 'form' && (inBand('detail', 'button').length || texts.length))) return { reason: 'no fields' }
  const columnOf = (object: DwObject) => def.table.columns.find((column) => column.name.toLowerCase() === object.name.toLowerCase())
  // A visibility that is the constant 0 (`1<TAB>0`) hides the object for good: it never owns a caption a visible field shows.
  const hidden = (object: DwObject) => alwaysHidden(object.visible)
  const taken = new Set<string>()
  const labelOf = new Map<string, DwObject>()
  const suffixOf = new Map<string, DwObject>()
  const visibleFields = fields
  const right = (object: DwObject) => num(object, 'x') + num(object, 'width')
  if (kind === 'grid') {
    const overlapOf = (text: DwObject, field: DwObject) => Math.min(right(field), right(text)) - Math.max(num(field, 'x'), num(text, 'x'))
    // PowerBuilder's grid hides a column's header with the column, so a hidden column owns the visible header painted exactly over it.
    const ownsHeader = (text: DwObject, field: DwObject) => hidden(text) === hidden(field) ||
      processing === 1 && hidden(field) && !hidden(text) && exactHeader(text, field)
    // The header that covers the column best (the shared part of the narrower of the two); a text that heads several columns (a report
    // title, a group caption) loses a tie to the column's own header, and a lower header row (nearer the detail band) wins the rest.
    const spans = (text: DwObject) => fields.filter((field) => overlapOf(text, field) > 0.5 * num(field, 'width')).length
    const rank = (text: DwObject, field: DwObject) => [
      Math.round(100 * overlapOf(text, field) / Math.max(1, Math.min(num(text, 'width'), num(field, 'width')))), -spans(text), overlapOf(text, field), num(text, 'y'),
    ]
    const better = (a: number[], b: number[]) => { for (let index = 0; index < a.length; index++) if (a[index] !== b[index]) return a[index] > b[index]; return false }
    for (const field of visibleFields) {
      let best: DwObject | undefined, bestRank: number[] = []
      for (const text of texts) {
        if (taken.has(text.name) || !ownsHeader(text, field) || overlapOf(text, field) <= 0) continue
        const score = rank(text, field)
        if (!best || better(score, bestRank)) { best = text; bestRank = score }
      }
      if (best) { labelOf.set(field.name, best); taken.add(best.name) }
    }
    // A free tabular header painted over a hidden column has no Modern place: the column is left out, the text would float above it.
    const orphan = texts.find((text) => !taken.has(text.name) && !hidden(text) && fields.some((field) => hidden(field) && exactHeader(text, field)))
    if (orphan) return { reason: 'header over a hidden column' }
  } else {
    // Labels sit left of their field on the same row; suffixes sit to the right on the same row.
    const sameRow = (text: DwObject, field: DwObject) => hidden(text) === hidden(field) && captionBeside(text, field)
    const bottom = (object: DwObject) => num(object, 'y') + num(object, 'height')
    const stackedAbove = (text: DwObject, field: DwObject) => hidden(text) === hidden(field) && captionAbove(text, field)
    // A caption cannot be paired with a field when another field sits between them on that row: that field owns the caption.
    const between = (text: DwObject, field: DwObject) => fieldBetween(text, field, visibleFields.filter((other) => hidden(other) === hidden(field)))
    // A trailing text the painter named after the field it follows (<column>_t, "(L)" after the length) is that field's suffix; taken
    // first, it is never read as the caption of the next field on the row.
    for (const field of visibleFields) {
      const own = texts.find((text) => text.name.toLowerCase() === `${field.name.toLowerCase()}_t` && hidden(text) === hidden(field) &&
        suffixBeside(text, field) && !/:\s*$/.test(text.text ?? ''))
      if (own && !taken.has(own.name)) { suffixOf.set(field.name, own); taken.add(own.name) }
    }
    // Globally cheapest pairs first (vertical alignment dominates), so a near label is never taken by a farther field.
    // A caption stacked directly above its field (left edges aligned, a short gap) is paired too, at a small penalty so a caption on the
    // field's own row still wins when both exist; without it a stacked caption is taken by a farther field on its row.
    const candidates = visibleFields.flatMap((field) => [
      ...texts.filter((text) => !taken.has(text.name) && sameRow(text, field) && !between(text, field))
        .map((text) => ({ field, text, cost: Math.abs(centreY(text) - centreY(field)) * 10 + (num(field, 'x') - right(text)) })),
      ...texts.filter((text) => !taken.has(text.name) && stackedAbove(text, field))
        .map((text) => ({ field, text, cost: (num(field, 'y') - bottom(text)) * 10 + Math.abs(num(text, 'x') - num(field, 'x')) + 200 })),
    ]).sort((a, b) => a.cost - b.cost)
    const paired = new Set<string>()
    for (const { field, text } of candidates) {
      if (paired.has(field.name) || taken.has(text.name)) continue
      paired.add(field.name)
      labelOf.set(field.name, text)
      taken.add(text.name)
    }
    // Fields painted over each other (alternatives a script or expression switches between) share the one caption the source paints.
    for (const field of visibleFields) {
      if (labelOf.has(field.name) || hidden(field)) continue
      const twin = visibleFields.find((other) => other !== field && labelOf.has(other.name) && hidden(other) === hidden(field) && sameBox(other, field))
      if (twin) labelOf.set(field.name, labelOf.get(twin.name)!)
    }
    for (const field of visibleFields) {
      if (suffixOf.has(field.name)) continue
      // A suffix is trailing text directly beside its field ("%", "Customer(s)"); a farther text or a label-like one (ends with a colon) is not.
      const candidates = texts.filter((text) => !taken.has(text.name) && hidden(text) === hidden(field) && suffixBeside(text, field) &&
        !/:\s*$/.test(text.text ?? '')).sort((a, b) => num(a, 'x') - num(b, 'x'))
      if (candidates.length) { suffixOf.set(field.name, candidates[0]); taken.add(candidates[0].name) }
    }
  }
  const loose = texts.filter((text) => !taken.has(text.name))
  let order = kind === 'grid' ? [...fields].sort((a, b) => num(a, 'x') - num(b, 'x') || num(a, 'y') - num(b, 'y')) : readingOrder(fields)
  let groups: { object: string; fields: string[] }[] | undefined
  if (groupboxes.length) {
    if (lines.length) return { reason: 'groups combined with separators' }
    const sorted = [...groupboxes].sort((a, b) => num(a, 'y') - num(b, 'y') || num(a, 'x') - num(b, 'x'))
    const owner = new Map<string, DwObject>()
    for (const field of fields) {
      const holder = holderBox(sorted, field)
      if (holder) owner.set(field.name, holder)
    }
    // Each section reads in its own order: fields of another box never decide which row a field shares.
    groups = sorted.map((box) => ({ object: box.name.toLowerCase(), fields: readingOrder(order.filter((field) => owner.get(field.name) === box)).map((field) => field.name.toLowerCase()) }))
    if (groups.some((group) => !group.fields.length)) return { reason: 'empty group box' }
    const outside = readingOrder(order.filter((field) => !owner.has(field.name)))
    if (outside.length) {
      // Fields outside every box form one plain section, placed where its first field sits among the boxes.
      const top = Math.min(...outside.map((field) => num(field, 'y')))
      const at = sorted.findIndex((box) => num(box, 'y') > top)
      groups.splice(at < 0 ? groups.length : at, 0, { object: '', fields: outside.map((field) => field.name.toLowerCase()) })
    }
    order = groups.flatMap((group) => group.fields.map((fieldName) => order.find((field) => field.name.toLowerCase() === fieldName)!))
  }
  const surfaceFields: DataSurfaceField[] = []
  for (const object of order) {
    const field: DataSurfaceField = { object: object.name.toLowerCase() }
    const label = labelOf.get(object.name)
    const column = columnOf(object)
    const columnKind = column ? colKind(column.type) : ''
    const style = choiceStyle(object)
    if (style.kind === 'unsupported') return { reason: `choice: ${style.reason}` }
    if (label) { field.labelObject = label.name.toLowerCase(); if (tabular) field.labelBand = 'header' }
    else if (hidden(object)) {
      // A hidden field without a source caption: should a script show it, it is named for assistive technology only, as Classic paints
      // no caption for it.
      field.label = object.name.charAt(0).toUpperCase() + object.name.slice(1).replace(/_/g, ' ')
      field.labelHidden = true
    }
    else if (style.kind === 'checkbox' && object['checkbox.text']?.trim()) field.label = object['checkbox.text'].trim()
    else {
      // The source paints no caption: keep it that way and give the field an accessible name from its column.
      field.label = object.name.charAt(0).toUpperCase() + object.name.slice(1).replace(/_/g, ' ')
      field.labelHidden = true
    }
    if (label && !label.text?.trim()) {
      // The caption object exists but is blank (a script may set it): keep it, with an accessible name until then.
      field.label = object.name.charAt(0).toUpperCase() + object.name.slice(1).replace(/_/g, ' ')
      field.labelHidden = true
    }
    const suffix = suffixOf.get(object.name)
    if (suffix) field.suffixObject = suffix.name.toLowerCase()
    if (object.type === 'compute') field.kind = 'computed'
    if (object.type === 'button') {
      field.kind = 'button'
      // The button's own text names it when no header caption does.
      if (!field.labelObject) { field.label = (object.text ?? '').replace(/&(?=\S)/g, '').replace(/[.\s]+$/g, '').trim() || object.name; field.labelHidden = true }
    }
    if (style.kind !== 'none') field.choice = style
    if (object.type === 'column' && dwMultiline(object, columnKind)) {
      field.multiline = true
    }
    if (numericSpin(object, columnKind).kind === 'unsupported') field.spinPlain = true
    if (object.type === 'compute' && object.alignment === '1') field.numeric = true
    surfaceFields.push(field)
  }
  const surface: DataSurface = { name, title: titleOf(name), kind, ...(tabular ? { sourceProcessing: 0 as const } : {}), fields: surfaceFields }
  if (kind === 'grid' && surfaceFields.some((field) => field.multiline)) {
    // Each row is as many single lines tall as the source's detail band is tall (a typical single-line field is 74-76 units).
    const detail = def.bands.detail
    const bandHeight = detail && !Array.isArray(detail) ? Number(detail.height ?? 0) : 0
    const lines = Math.round(bandHeight / 76)
    if (lines < 2 || lines > 12) return { reason: 'multiline grid row height' }
    surface.rowLines = lines
  }
  // A heading or button of a form is placed before the next field below it; in a grouped form only a field of the same groupbox (or of
  // the plain section, for one outside every box) may follow it, so it never moves into another box.  A heading after the last field of
  // its box has no place in the mapping, and the form keeps its Classic layout.
  const boxOf = (object: DwObject) => groups ? holderBox(groupboxes, object)?.name.toLowerCase() ?? '' : ''
  const placed = (object: DwObject): { before?: string } | null => {
    const box = boxOf(object)
    const before = order.filter((field) => centreY(field) > centreY(object) && boxOf(field) === box)
      .sort((a, b) => centreY(a) - centreY(b) || num(a, 'x') - num(b, 'x'))[0]
    if (!before && box) return null
    return before ? { before: before.name.toLowerCase() } : {}
  }
  if (loose.length && kind === 'grid') {
    surface.captions = [...loose].sort((x, y) => num(x, 'x') - num(y, 'x')).map((text) => ({ object: text.name.toLowerCase() }))
  } else if (loose.length) {
    // Source text that names no field (headings, notes, script-set values) is kept in place as a caption.
    const captions: { object: string; before?: string }[] = []
    for (const text of [...loose].sort((x, y) => num(x, 'y') - num(y, 'y') || num(x, 'x') - num(y, 'x'))) {
      const position = placed(text)
      if (!position) return { reason: 'heading after the last field of its groupbox' }
      captions.push({ object: text.name.toLowerCase(), ...position })
    }
    surface.captions = captions
  }
  if (groups) surface.groups = groups
  const buttons = kind === 'grid' ? [] : live.filter((object) => object.type === 'button')
  if (buttons.length) {
    const entries: { object: string; before?: string }[] = []
    for (const button of [...buttons].sort((x, y) => num(x, 'y') - num(y, 'y') || num(x, 'x') - num(y, 'x'))) {
      const position = placed(button)
      if (!position) return { reason: 'button after the last field of its groupbox' }
      entries.push({ object: button.name.toLowerCase(), ...position })
    }
    surface.buttons = entries
  }
  const art = [...live.filter((object) => ART.has(object.type) && !(object.type === 'line' && separatorLines.has(object.name))), ...clipped]
  if (art.length) surface.decorations = art.map((object) => object.name.toLowerCase())
  if (lines.length) {
    const separators: { object: string; before?: string }[] = []
    for (const line of [...lines].sort((a, b) => num(a, 'y1') - num(b, 'y1'))) {
      const before = order.find((field) => centreY(field) > num(line, 'y1'))
      separators.push({ object: line.name.toLowerCase(), ...(before ? { before: before.name.toLowerCase() } : {}) })
    }
    surface.separators = separators
  }
  if (kind === 'grid') {
    type Total = NonNullable<DataSurface['bands']>[number]['fields'][number]
    const bands: NonNullable<DataSurface['bands']> = []
    for (const band of [...groupBands, ...totalBands] as string[]) {
      const computes = [...inBand(band, 'compute'), ...inBand(band, 'column')].sort((a, b) => num(a, 'x') - num(b, 'x'))
      const bandTexts = inBand(band, 'text')
      if (!computes.length && !bandTexts.length) continue
      if (!computes.length && !band.includes('.')) return { reason: 'totals band without values' }
      const used = new Set<string>()
      const entries: Total[] = []
      for (const compute of computes) {
        const groupTitle = band.includes('.') && compute.type === 'column' && ['lookup', 'list'].includes(choiceStyle(compute).kind)
        if (choiceStyle(compute).kind !== 'none' && !groupTitle) return { reason: 'choice in a totals band' }
        const candidates = bandTexts.filter((text) => !used.has(text.name) && right(text) <= num(compute, 'x') + 8 &&
          Math.abs(centreY(text) - centreY(compute)) <= Math.max(num(compute, 'height'), 40))
          .sort((a, b) => right(b) - right(a))
        const entry: Total = { object: compute.name.toLowerCase() }
        if (candidates.length) {
          entry.labelObject = candidates[0].name.toLowerCase(); used.add(candidates[0].name)
          // The caption object exists but its text is blank (a script may set it): keep it, with an accessible name until then.
          if (!candidates[0].text?.trim()) {
            entry.label = compute.name.charAt(0).toUpperCase() + compute.name.slice(1).replace(/_/g, ' ')
            entry.labelHidden = true
          }
        } else {
          // An unlabelled total is named by the column header above it (source text, accelerator marks removed).
          const header = texts.filter((text) => !hidden(text) && Math.min(right(compute), right(text)) - Math.max(num(compute, 'x'), num(text, 'x')) > 0)
            .sort((a, b) => (Math.min(right(compute), right(b)) - Math.max(num(compute, 'x'), num(b, 'x'))) - (Math.min(right(compute), right(a)) - Math.max(num(compute, 'x'), num(a, 'x'))))[0]
          const text = band.startsWith('header.') ? undefined : header?.text?.replace(/&(?=\S)/g, '').replace(/\s+/g, ' ').trim()
          if (text) entry.label = text
          else {
            // Nothing in the source names this value (for example a group title): keep it unlabelled and give it an accessible name.
            entry.label = compute.name.charAt(0).toUpperCase() + compute.name.slice(1).replace(/_/g, ' ')
            entry.labelHidden = true
          }
        }
        if (compute.alignment === '1') entry.numeric = true
        entries.push(entry)
      }
      const unpaired = bandTexts.filter((text) => !used.has(text.name))
      bands.push({ band: band as NonNullable<DataSurface['bands']>[number]['band'], label: band.includes('.') ? 'Group' : 'Totals', ...(unpaired.length ? { captions: unpaired.sort((a, b) => num(a, 'x') - num(b, 'x')).map((text) => text.name.toLowerCase()) } : {}), fields: entries })
    }
    if (bands.length) surface.bands = bands
    if (groupLevels.length) surface.grouped = true
  }
  return { surface }
}

export function loadDefinitions(): Map<string, DwDef> {
  const index: Record<string, string> = JSON.parse(readFileSync(resolve(dataRoot, '_index.json'), 'utf8'))
  const bundles = new Map<string, Record<string, DwDef>>()
  const result = new Map<string, DwDef>()
  for (const name of Object.keys(index).sort()) {
    const library = index[name]
    if (!bundles.has(library)) bundles.set(library, JSON.parse(gunzipSync(readFileSync(resolve(dataRoot, library + '.json.gz'))).toString('utf8')))
    const def = bundles.get(library)![name]
    if (def) result.set(name, def)
  }
  return result
}

const ENTRY_ANCESTORS = new Set(['w_single_entry', 'w_multi_entry'])
const objectsRoot = resolve(here, '..', '..', 'data', 'src', 'objects')

/** DataWindows hosted by entry masters keep context-only mappings: the same DataWindow elsewhere is not re-presented. */
export function entryHostedDataWindows(): Set<string> {
  const names = new Set<string>()
  const walk = (controls: { fields?: { name: string; value: unknown }[]; controls?: unknown[] }[]) => {
    for (const control of controls) {
      const dataobject = control.fields?.find((field) => field.name === 'dataobject')?.value
      if (typeof dataobject === 'string' && dataobject) names.add(dataobject.toLowerCase())
      walk((control.controls ?? []) as typeof controls)
    }
  }
  for (const library of readdirSync(objectsRoot)) {
    const dir = resolve(objectsRoot, library, 'window')
    if (!existsSync(dir)) continue
    for (const file of readdirSync(dir)) {
      if (!file.endsWith('.json')) continue
      const window = JSON.parse(readFileSync(resolve(dir, file), 'utf8'))
      if (ENTRY_ANCESTORS.has(window.ancestor)) walk(window.controls ?? [])
    }
  }
  return names
}

/** Names that already have a reviewed mapping: global, or reviewed for exactly one hosting window. */
export function reviewedDataWindows(): Set<string> {
  const names = new Set(DATA_SURFACES.map((surface) => surface.name))
  for (const entry of ENTRY_WINDOW_SURFACES) {
    for (const detail of entry.details) if (detail.surface) names.add(detail.surface.name)
    if (entry.list) names.add(entry.list.name)
  }
  for (const window of [...WINDOW_SURFACES, ...CALCULATOR_WINDOW_SURFACES, ...CRITERIA_WINDOW_SURFACES]) {
    for (const binding of window.data ?? []) names.add(binding.surface.name)
  }
  return names
}

/** Derives a surface and validates it against its definition; a rule line the surface cannot place is retried as an unpainted decoration. */
export function deriveValidated(name: string, def: DwDef): Derivation {
  const attempt = (options: { plainSeparators?: boolean }): Derivation => {
    let result: Derivation
    try { result = derive(name, def, options) } catch (error) { result = { reason: `derivation error: ${(error as Error).message}` } }
    if (result.surface) {
      const issues = dataSurfaceIssues(def, result.surface)
      const positions = issues.length ? [] : dataSurfacePositionIssues(def, result.surface)
      if (issues.length) result = { reason: `validation: ${issues[0].replace(/:.*$/, '')}` }
      // A mapping whose captions, suffixes or order disagree with the source geometry is refused: the DataWindow keeps its Classic layout.
      else if (positions.length) result = { reason: `position: ${positions[0].replace(/:.*$/, '')}` }
    }
    return result
  }
  const outcome = attempt({})
  return !outcome.surface && /separator/i.test(outcome.reason ?? '') ? attempt({ plainSeparators: true }) : outcome
}

// Shared control DataWindows that every entry window hosts in a compact original presentation (the Find box).  Entry windows that keep
// their Classic layout must keep it, so no global Modern surface is generated for them.
const CONTROL_DATAWINDOWS = ['d_find']

export function deriveAll(definitions = loadDefinitions(), skip: ReadonlySet<string> = new Set([...reviewedDataWindows(), ...entryHostedDataWindows(), ...CONTROL_DATAWINDOWS])) {
  const surfaces: DataSurface[] = []
  const backlog: Record<string, string[]> = {}
  let skipped = 0
  for (const [name, def] of definitions) {
    if (skip.has(name)) { skipped++; continue }
    let outcome: Derivation
    outcome = deriveValidated(name, def)
    if (outcome.surface) surfaces.push(outcome.surface)
    else (backlog[outcome.reason!] ??= []).push(name)
  }
  return { surfaces, backlog, skipped }
}

export function render(surfaces: readonly DataSurface[]): string {
  return [
    '// GENERATED by web/tools/derive-data-surfaces.ts from data/src/dw. Do not edit; regenerate instead.',
    '// Every entry passes `dataSurfaceIssues` against the recovered definition; the runtime re-validates before use.',
    "import type { DataSurface } from './data-surfaces.ts'",
    '',
    'export const DERIVED_DATA_SURFACES: readonly DataSurface[] = [',
    ...surfaces.map((surface) => `  ${JSON.stringify(surface)},`),
    ']',
    '',
  ].join('\n')
}

export function renderBacklog(total: number, derived: number, skipped: number, backlog: Record<string, string[]>): string {
  const reasons = Object.entries(backlog).sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
  return JSON.stringify({
    note: 'Generated by web/tools/derive-data-surfaces.ts. Listed DataWindows keep the labelled Classic layout until a reviewed mapping exists.',
    definitions: total, derivedGlobal: derived, reviewedOrEntryHosted: skipped,
    pending: reasons.reduce((sum, [, names]) => sum + names.length, 0),
    reasons: Object.fromEntries(reasons.map(([reason, names]) => [reason, { count: names.length, names }])),
  }, null, 1) + '\n'
}

if (import.meta.main) {
  const definitions = loadDefinitions()
  const { surfaces, backlog, skipped } = deriveAll(definitions)
  const ts = render(surfaces), json = renderBacklog(definitions.size, surfaces.length, skipped, backlog)
  if (process.argv.includes('--check')) {
    const stale = !existsSync(OUTPUT_TS) || readFileSync(OUTPUT_TS, 'utf8') !== ts ||
      !existsSync(OUTPUT_BACKLOG) || readFileSync(OUTPUT_BACKLOG, 'utf8') !== json
    if (stale) { console.error('Derived DataWindow surfaces are stale; run node tools/derive-data-surfaces.ts'); process.exit(1) }
  } else {
    writeFileSync(OUTPUT_TS, ts)
    writeFileSync(OUTPUT_BACKLOG, json)
  }
  console.log(`definitions ${definitions.size}; derived ${surfaces.length}; pending ${Object.values(backlog).reduce((sum, n) => sum + n.length, 0)}`)
  for (const [reason, names] of Object.entries(backlog).sort((a, b) => b[1].length - a[1].length).slice(0, 25)) console.log(`  ${names.length}\t${reason}`)
}
