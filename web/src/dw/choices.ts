import type { DwDef, DwObject } from './def.ts'
import { toStr } from '../runtime/values.ts'

export type DwChoiceBinding = { kind: 'list'; sorted?: boolean; showList?: true; editable?: true; case?: 'any' | 'upper' | 'lower' } |
  { kind: 'lookup'; name: string; dataColumn: string; displayColumn: string; editable?: true; case?: 'any' | 'upper' | 'lower'; showList?: true; percentWidth?: number; lines?: number } |
  { kind: 'checkbox'; on: string; off: string; leftText?: true } | { kind: 'radio'; columns: number }
export type DwChoiceStyle = DwChoiceBinding | { kind: 'none' } | { kind: 'unsupported'; reason: string }
export interface DwChoice { text: string; value: unknown }
export interface DwChoiceGrid {
  title: string
  columns: readonly { label: string; numeric: boolean }[]
  matches(index: number, query: string): boolean
  read(index: number): Promise<readonly string[]>
}
export interface DwChoices {
  items: readonly DwChoice[]
  validate(choice: DwChoice): void
  current?(): number
  highlight?(index: number): void
  grid?: DwChoiceGrid
  gridIssue?: string
}

export function choiceProperty(object: DwObject, key: string, overrides?: ReadonlyMap<string, string>): string | undefined {
  return overrides?.get(`${object.name.toLowerCase()}.${key}`) ?? object[key]
}

export function choiceStyle(object: DwObject, overrides?: ReadonlyMap<string, string>): DwChoiceStyle {
  const has = (prefix: string) => Object.keys(object).some((key) => key.startsWith(prefix + '.')) ||
    [...(overrides?.keys() ?? [])].some((key) => key.startsWith(`${object.name.toLowerCase()}.${prefix}.`))
  const list = has('ddlb'), lookup = has('dddw')
  if (has('radiobuttons') && !list && !lookup && !has('checkbox')) {
    const columns = Number(choiceProperty(object, 'radiobuttons.columns', overrides))
    const prefix = `${object.name.toLowerCase()}.radiobuttons.`
    const properties = [...Object.keys(object).filter((key) => key.startsWith('radiobuttons.')).map((key) => key.slice(13)),
      ...[...(overrides?.keys() ?? [])].filter((key) => key.startsWith(prefix)).map((key) => key.slice(prefix.length))]
    const known = new Set(['columns', 'lefttext', 'scale', 'threed'])
    if (!Number.isSafeInteger(columns) || columns < 1 || properties.some((key) => !known.has(key)) ||
      !/^(no|false|0)$/i.test(choiceProperty(object, 'radiobuttons.lefttext', overrides) ?? 'no') ||
      ['scale', 'threed'].some((key) => !/^(yes|true|1|no|false|0)$/i.test(choiceProperty(object, `radiobuttons.${key}`, overrides) ?? 'no'))) {
      return { kind: 'unsupported', reason: 'Radio layout or presentation requires a separate interaction' }
    }
    return { kind: 'radio', columns }
  }
  if (has('checkbox') && !list && !lookup && !has('radiobuttons')) {
    const on = choiceProperty(object, 'checkbox.on', overrides), off = choiceProperty(object, 'checkbox.off', overrides)
    const known = new Set(['on', 'off', 'text', 'lefttext', 'scale', 'threed'])
    const properties = [...Object.keys(object).filter((key) => key.startsWith('checkbox.')).map((key) => key.slice(9)),
      ...[...(overrides?.keys() ?? [])].filter((key) => key.startsWith(`${object.name.toLowerCase()}.checkbox.`))
        .map((key) => key.slice(`${object.name.toLowerCase()}.checkbox.`.length))]
    if (on === undefined || off === undefined || on === off || on.includes('\t') || off.includes('\t') ||
      properties.some((key) => !known.has(key)) ||
      !/^(yes|true|1|no|false|0)$/i.test(choiceProperty(object, 'checkbox.lefttext', overrides) ?? 'no') ||
      (choiceProperty(object, 'checkbox.text', overrides) ?? '').includes('\t')) {
      return { kind: 'unsupported', reason: 'Checkbox values or presentation require a separate interaction' }
    }
    return { kind: 'checkbox', on, off,
      ...(/^(yes|true|1)$/i.test(choiceProperty(object, 'checkbox.lefttext', overrides) ?? 'no') ? { leftText: true as const } : {}) }
  }
  if (has('checkbox') && has('radiobuttons')) return { kind: 'unsupported', reason: 'Mixed checkbox or radio styles require a separate interaction' }
  if (!list && !lookup) return { kind: 'none' }
  if (has('checkbox') || has('radiobuttons')) return { kind: 'unsupported', reason: 'Mixed checkbox or radio styles require a separate interaction' }
  if (list && lookup) return { kind: 'unsupported', reason: 'Mixed choice styles require a separate mapping' }
  const prefix = lookup ? 'dddw' : 'ddlb'
  const allowEdit = choiceProperty(object, `${prefix}.allowedit`, overrides)?.toLowerCase()
  if (allowEdit !== 'no' && allowEdit !== 'yes') {
    return { kind: 'unsupported', reason: 'Unrecognized choice editing policy' }
  }
  const showList = choiceProperty(object, `${prefix}.showlist`, overrides) ?? 'no'
  if (!/^(yes|true|1|no|false|0)$/i.test(showList)) return { kind: 'unsupported', reason: 'Unrecognized automatic choice-list setting' }
  const automatic: { showList?: true } = /^(yes|true|1)$/i.test(showList) ? { showList: true } : {}
  const editing: { editable?: true; case?: 'any' | 'upper' | 'lower' } = {}
  if (allowEdit === 'yes') {
    const casing = (choiceProperty(object, `${prefix}.case`, overrides) ?? 'any').toLowerCase()
    const limit = choiceProperty(object, `${prefix}.limit`, overrides) ?? '0'
    if (casing !== 'any' && casing !== 'upper' && casing !== 'lower' ||
      !/^\d+$/.test(limit) || Number(limit) > 32767) {
      return { kind: 'unsupported', reason: 'Editable choice input policy is unsupported' }
    }
    editing.editable = true
    editing.case = casing
  }
  if (list) {
    const sorted = choiceProperty(object, 'ddlb.sorted', overrides) ?? 'no'
    if (/^(yes|true|1)$/i.test(sorted)) return { kind: 'list', sorted: true, ...automatic, ...editing }
    if (!/^(no|false|0)$/i.test(sorted)) return { kind: 'unsupported', reason: 'Unrecognized code-table sort setting' }
    return { kind: 'list', ...automatic, ...editing }
  }
  if (!/^(no|false|0)$/i.test(choiceProperty(object, 'dddw.hsplitscroll', overrides) ?? 'no')) {
    return { kind: 'unsupported', reason: 'Split lookup scrolling requires a separate interaction' }
  }
  const name = choiceProperty(object, 'dddw.name', overrides)?.toLowerCase()
  const dataColumn = choiceProperty(object, 'dddw.datacolumn', overrides)?.toLowerCase()
  const displayColumn = choiceProperty(object, 'dddw.displaycolumn', overrides)?.toLowerCase()
  const rawWidth = choiceProperty(object, 'dddw.percentwidth', overrides)
  const percentWidth = rawWidth === undefined ? 0 : Number(rawWidth)
  if (!Number.isSafeInteger(percentWidth) || percentWidth < 0 || percentWidth > 32767) {
    return { kind: 'unsupported', reason: 'Lookup width percentage is unsupported' }
  }
  const rawLines = choiceProperty(object, 'dddw.lines', overrides)
  const lines = rawLines === undefined ? 0 : Number(rawLines)
  if (rawLines !== undefined && !/^\d+$/.test(rawLines) || !Number.isSafeInteger(lines) || lines < 0 || lines > 32767) {
    return { kind: 'unsupported', reason: 'Lookup row count is unsupported' }
  }
  return name && dataColumn && displayColumn ? { kind: 'lookup', name, dataColumn, displayColumn, ...automatic, ...editing,
    ...(percentWidth > 0 ? { percentWidth } : {}), ...(lines > 0 ? { lines } : {}) } :
    { kind: 'unsupported', reason: 'Lookup definition and both column identities are required' }
}

export function choiceEditText(object: DwObject, text: string, overrides?: ReadonlyMap<string, string>): string {
  const prefix = choiceStyle(object, overrides).kind === 'list' ? 'ddlb' : 'dddw'
  const casing = choiceProperty(object, `${prefix}.case`, overrides)?.toLowerCase()
  return casing === 'upper' ? text.toUpperCase() : casing === 'lower' ? text.toLowerCase() : text
}

export function choiceSignature(def: DwDef, object: DwObject, overrides?: ReadonlyMap<string, string>): string {
  const keys = new Set(Object.keys(object).filter((key) => /^(dddw|ddlb|checkbox|radiobuttons)\./.test(key)))
  for (const key of overrides?.keys() ?? []) {
    const prefix = `${object.name.toLowerCase()}.`
    if (key.startsWith(prefix) && /^(dddw|ddlb|checkbox|radiobuttons)\./.test(key.slice(prefix.length))) keys.add(key.slice(prefix.length))
  }
  return JSON.stringify([[...keys].sort().map((key) => [key, choiceProperty(object, key, overrides)]),
    overrides?.get(`${object.name.toLowerCase()}.values`) ?? def.table.columns.find((column) => column.name.toLowerCase() === object.name.toLowerCase())?.values])
}

export function codeTable(def: DwDef, object: DwObject, overrides?: ReadonlyMap<string, string>): [string, string][] | null {
  if (object.type !== 'column') return null
  const list = Object.keys(object).some((key) => /^(ddlb|radiobuttons)\./.test(key)) ||
    [...(overrides?.keys() ?? [])].some((key) => key.startsWith(`${object.name.toLowerCase()}.`) &&
      /^(ddlb|radiobuttons)\./.test(key.slice(object.name.length + 1)))
  if (!list &&
    choiceProperty(object, 'edit.codetable', overrides) !== 'yes' && choiceProperty(object, 'editmask.codetable', overrides) !== 'yes') return null
  const raw = overrides?.get(`${object.name.toLowerCase()}.values`) ??
    def.table.columns.find((column) => column.name.toLowerCase() === object.name.toLowerCase())?.values
  if (!raw) return null
  const entries: [string, string][] = []
  let part = ''
  const finish = () => {
    if (part) {
      const tab = part.indexOf('\t')
      entries.push(tab < 0 ? [part, part] : [part.slice(0, tab), part.slice(tab + 1)])
    }
    part = ''
  }
  for (let index = 0; index < raw.length; index++) {
    if (raw[index] !== '/') part += raw[index]
    else if (raw[index + 1] === '/') { part += '/'; index++ }
    else finish()
  }
  finish()
  return entries.length ? entries : null
}

export function sameChoiceValue(left: unknown, right: unknown): boolean {
  if (left === null || left === undefined || right === null || right === undefined) return left == null && right == null
  return toStr(left) === toStr(right)
}

export function radioCaption(text: string): string {
  return text.replace(/&&/g, '\0').replace(/&/g, '').replace(/\0/g, '&')
}
