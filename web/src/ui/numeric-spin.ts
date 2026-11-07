import type { DwObject } from '../dw/def.ts'
import { Dec } from '../runtime/values.ts'
import { normalizeDwNumber } from '../dw/edit.ts'

export interface NumericSpin {
  kind: 'number'
  minimum: number
  maximum: number
  increment: number
}

export type SpinConfiguration = NumericSpin | { kind: 'none' } | { kind: 'unsupported'; reason: string }

export function numericSpin(object: DwObject, columnKind: string, overrides?: ReadonlyMap<string, string>): SpinConfiguration {
  const property = (name: string) => overrides?.get(`${object.name.toLowerCase()}.editmask.${name}`) ?? object[`editmask.${name}`]
  const spin = property('spin') ?? 'no'
  if (/^(no|false|0)$/i.test(spin)) return { kind: 'none' }
  if (!/^(yes|true|1)$/i.test(spin)) return { kind: 'unsupported', reason: 'Unrecognized numeric Spin setting' }
  if (!['number', 'decimal'].includes(columnKind) || !/^(no|false|0)$/i.test(property('codetable') ?? 'no')) {
    return { kind: 'unsupported', reason: 'Numeric stepping requires a numeric column without a code table' }
  }
  const range = (property('spinrange') ?? '').split('~')
  const increment = Number(property('spinincr') ?? '1')
  if (range.length !== 2 || range.some((part) => !part.trim() || !Number.isSafeInteger(Number(part)))
    || !Number.isSafeInteger(increment) || increment <= 0 || Number(range[0]) > Number(range[1])) {
    return { kind: 'unsupported', reason: 'Numeric stepping requires explicit safe integer bounds and a positive integer increment' }
  }
  return { kind: 'number', minimum: Number(range[0]), maximum: Number(range[1]), increment }
}

function spinDecimal(text: string): Dec | null {
  const normalized = normalizeDwNumber(text)
  const match = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e([+-]?\d+))?$/i.exec(normalized)
  // Bound exponent expansion before constructing a bigint-backed draft.
  if (!match || Math.abs(Number(match[1] ?? 0)) > 324 || !Number.isFinite(Number(normalized))) return null
  return Dec.parse(normalized)
}

export function spinNumber(text: string): number | null {
  return spinDecimal(text)?.toNumber() ?? null
}

export function canStepNumber(text: string, config: NumericSpin, direction: -1 | 1): boolean {
  const value = spinDecimal(text)
  return value === null || (direction < 0 ? value.cmp(Dec.of(config.minimum)) > 0 : value.cmp(Dec.of(config.maximum)) < 0)
}

export function stepNumber(text: string, config: NumericSpin, direction: -1 | 1): string | null {
  const value = spinDecimal(text)
  if (value === null) return null
  if (value.cmp(Dec.of(config.minimum)) < 0) return String(config.minimum)
  if (value.cmp(Dec.of(config.maximum)) > 0) return String(config.maximum)
  const next = value.add(Dec.of(config.increment * direction))
  if (next.cmp(Dec.of(config.minimum)) < 0) return String(config.minimum)
  if (next.cmp(Dec.of(config.maximum)) > 0) return String(config.maximum)
  return next.normalize().toString()
}
