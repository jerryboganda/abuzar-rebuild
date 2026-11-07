import type { NDwBase } from '../runtime/native/dwctrl.ts'
import type { DwModel, DwRow } from './model.ts'
import type { DwObject } from './def.ts'
import { compileDw, evalDw, newCtx } from './expr.ts'
import { Dec, PBDate, PBDateTime, PBTime, shortDateMask, toStr } from '../runtime/values.ts'
import { formatValue, numericDateMask, parseMaskedDate, parseMaskedTime, parseMaskedDateTime } from '../runtime/sysfuncs.ts'
import { choiceStyle } from './choices.ts'

export type DwEditResult = 'accepted' | 'rejected' | 'discarded'

export function dwRequired(object: DwObject, overrides?: ReadonlyMap<string, string>): boolean {
  return object.type === 'column' && ['edit', 'dddw', 'ddlb', 'editmask'].some((style) =>
    /^(yes|true|1)$/i.test(overrides?.get(`${object.name.toLowerCase()}.${style}.required`) ?? object[`${style}.required`] ?? ''))
}

export function normalizeDwNumber(value: unknown): string {
  return toStr(value).trim().replace(/[,\s]/g, '').replace(/^\((.*)\)$/, '-$1')
}

export function dwEditText(model: DwModel, column: number, object: DwObject, value: string): string {
  if (model.kinds[column] !== 'string') return value
  const choice = choiceStyle(object, model.overrides)
  if (choice.kind === 'list' || choice.kind === 'lookup' || choice.kind === 'checkbox' || choice.kind === 'radio') return value
  const casing = (model.overrides.get(`${object.name.toLowerCase()}.edit.case`) ?? object['edit.case'] ?? 'any').toLowerCase()
  return casing === 'upper' ? value.toUpperCase() : casing === 'lower' ? value.toLowerCase() : value
}

export function dwEditAutoSelect(model: DwModel, object: DwObject): boolean {
  const setting = ['edit', 'editmask'].map((style) =>
    model.overrides.get(`${object.name.toLowerCase()}.${style}.autoselect`) ?? object[`${style}.autoselect`])
    .find((value) => value !== undefined)
  return !/^(no|false|0)$/i.test(setting ?? 'yes')
}

export function dwMultiline(object: DwObject, columnKind: string, overrides?: ReadonlyMap<string, string>): boolean {
  if (columnKind !== 'string' || choiceStyle(object, overrides).kind !== 'none') return false
  const property = (name: string) => overrides?.get(`${object.name.toLowerCase()}.edit.${name}`) ?? object[`edit.${name}`] ?? ''
  return /^(no|false|0)$/i.test(property('autohscroll')) && /^(yes|true|1)$/i.test(property('autovscroll')) &&
    /^(no|false|0|)$/i.test(property('password')) && /^(no|false|0|)$/i.test(property('codetable')) &&
    !Object.keys(object).some((key) => /^(editmask|radiobuttons)\./.test(key)) &&
    ![...(overrides?.keys() ?? [])].some((key) => key.startsWith(`${object.name.toLowerCase()}.`) &&
      /^(editmask|radiobuttons)\./.test(key.slice(object.name.length + 1)))
}

/**
 * The editor still targets the same live column.  `Modify()` may replace the
 * definition objects (the Customer form re-lays its fields at run time), so
 * the captured object must be matched by name, not by identity.
 */
export function sameDwColumn(model: DwModel, object: DwObject, column: number, row: number, record: DwRow | undefined, multiline: boolean): boolean {
  if (!record || column < 0 || column >= model.colNames.length) return false
  const current = model.def.objects.find((x) => x.name === object.name)
  return !!current && model.rowAt(row) === record && model.colIndex(object.name) === column &&
    dwMultiline(current, model.kinds[column], model.overrides) === multiline
}

export function dwMultilineDomText(text: string): string {
  return text.replace(/\r\n?/g, '\n')
}

export function dwMultilineText(text: string, original: string): string {
  const normalized = dwMultilineDomText(text)
  // Textareas use LF; preserve untouched source strings and use CRLF for new input.
  return normalized === dwMultilineDomText(original) ? original : normalized.replace(/\n/g, '\r\n')
}

export function dwTextLimit(model: DwModel, column: number, object: DwObject): number {
  const length = model.kinds[column] === 'string' ? Number(/\((\d+)\)/.exec(model.def.table.columns[column].type)?.[1]) : 0
  const choice = choiceStyle(object, model.overrides)
  const configured = choice.kind === 'checkbox' || choice.kind === 'radio' || choice.kind === 'lookup' || choice.kind === 'list' ? 0 :
    Number(model.overrides.get(`${object.name.toLowerCase()}.edit.limit`) ?? object['edit.limit'] ?? 0)
  const limits = [length, configured].filter((value) => Number.isInteger(value) && value > 0)
  return limits.length ? Math.min(...limits) : 0
}

function temporalMask(model: DwModel, object: DwObject): string {
  return (model.overrides.get(`${object.name.toLowerCase()}.editmask.mask`) ?? object['editmask.mask'] ?? '')
    .replace(/\[shortdate\]/gi, shortDateMask())
    .replace(/\[time\]/gi, 'hh:mm:ss')
}

export function dwEditorText(model: DwModel, object: DwObject, value: unknown): string {
  const mask = temporalMask(model, object), numeric = numericDateMask(mask)
  return numeric && (value instanceof PBDate || value instanceof PBDateTime) ?
    formatValue(value, value instanceof PBDate ? numeric.date : mask) : toStr(value)
}

async function validateValue(ctl: NDwBase, model: DwModel, row: number, object: DwObject, value: string): Promise<boolean> {
  const column = model.colIndex(object.name)
  if (column < 0) return true
  const rule = ctl.validateRules.get(object.name.toLowerCase()) ?? ctl.columnValidation(column)
  if (!rule.trim()) return true
  const result = await evalDw(compileDw(rule), { ...newCtx(model, row, object.band), text: value })
  return result === true || (typeof result === 'number' && result !== 0) || (result instanceof Dec && !result.isZero())
}

/** Validate before ItemChanged; a rejected value may permit navigation without a buffer write. */
export async function commitDwValue(ctl: NDwBase, model: DwModel, row: number, column: number, object: DwObject, value: unknown, guard?: () => void | Promise<void>): Promise<DwEditResult> {
  const record = model.rowAt(row)
  const checkIdentity = () => {
    if (!record || column < 0 || column >= model.colNames.length || ctl.destroyed || ctl.model !== model ||
      model.rowAt(row) !== record || model.colIndex(object.name) !== column) {
      throw new Error('The record or layout changed during validation. The entry was not written to the data model.')
    }
  }
  await guard?.()
  checkIdentity()
  if (typeof value === 'string') value = dwEditText(model, column, object, value)
  const kind = model.kinds[column]
  let converted = value
  let convertible = true
  const choice = choiceStyle(object, model.overrides)
  const nilIsNull = choice.kind !== 'checkbox' && choice.kind !== 'radio' && ['edit', 'editmask', 'ddlb', 'dddw'].some((style) =>
    /^(yes|true|1)$/i.test(model.overrides.get(`${object.name.toLowerCase()}.${style}.nilisnull`) ?? object[`${style}.nilisnull`] ?? ''))
  if (value === '' && nilIsNull) converted = null
  if (kind === 'number' || kind === 'decimal') {
    const raw = toStr(value).trim()
    if (raw === '') {
      converted = null
    } else {
      const cleaned = normalizeDwNumber(raw)
      const numeric = Number(cleaned)
      convertible = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(cleaned) && Number.isFinite(numeric)
      converted = kind === 'decimal' ? cleaned : numeric
    }
  } else if (kind === 'string') {
    const limit = dwTextLimit(model, column, object)
    convertible = !limit || toStr(value).length <= limit
  } else if (kind === 'date' || kind === 'time' || kind === 'datetime') {
    const raw = toStr(value).trim()
    const mask = temporalMask(model, object)
    if (raw === '') converted = null
    else if (kind === 'date') converted = value instanceof PBDate ? value : parseMaskedDate(raw, mask)
    else if (kind === 'time') converted = value instanceof PBTime ? value : parseMaskedTime(raw)
    else if (value instanceof PBDateTime) converted = value
    else {
      converted = parseMaskedDateTime(raw, mask)
    }
    convertible = raw === '' || converted !== null
  }
  let valid = false
  try {
    valid = convertible && await validateValue(ctl, model, row, object, toStr(value))
  } catch (error) {
    ctl.rt.onError(error)
    await ctl.rt.ui?.messageBox('Validation unavailable',
      `The validation rule for ${object.name} could not be evaluated. The entry was not applied.`,
      'stopsign!', 'ok!', 1)
    await guard?.()
    checkIdentity()
    return 'rejected'
  }
  await guard?.()
  checkIdentity()
  if (valid) {
    const response = await ctl.rt.fire(ctl, 'itemchanged', [row, { name: object.name }, toStr(value)])
    await guard?.()
    checkIdentity()
    if (response === 2) return 'discarded'
    valid = response !== 1
  }
  if (!valid) {
    const response = await ctl.rt.fire(ctl, 'itemerror', [row, { name: object.name }, toStr(value)])
    await guard?.()
    checkIdentity()
    if (response === 3) return 'discarded'
    if (response !== 2 || !convertible) {
      if ((response !== 1 && response !== 2) || !convertible && response === 2) {
        await ctl.rt.ui?.messageBox('Validation Error',
          ctl.columnValidationMessage(column) || `Enter a valid value for ${object.name}.`,
          'exclamation!', 'ok!', 1)
        await guard?.()
        checkIdentity()
      }
      return 'rejected'
    }
  }
  await guard?.()
  checkIdentity()
  if (model.setItem(row, column + 1, converted) !== 1) {
    throw new Error('The entry could not be applied to the current record. Review the record before trying again.')
  }
  ctl.changed()
  return 'accepted'
}
