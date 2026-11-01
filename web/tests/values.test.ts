import test from 'node:test'
import assert from 'node:assert/strict'
import { Dec, PBDate, PBTime, formatNumber, formatDate, formatTime, add, mul, div, cmp, coerce, toStr } from '../src/runtime/values.ts'

test('decimal arithmetic is exact', () => {
  const a = Dec.parse('0.1')
  const b = Dec.parse('0.2')
  assert.equal(a.add(b).toString(), '0.3')
  assert.equal(Dec.parse('10').div(Dec.parse('3')).round(2).toString(), '3.33')
  assert.equal(Dec.parse('2.675').round(2).toString(), '2.68')
  assert.equal(Dec.parse('-2.675').round(2).toString(), '-2.68')
  assert.equal(Dec.parse('1234.5').toFixed(2), '1234.50')
  assert.equal(String(add(new Dec(150n, 2), 2)), '3.50')
  assert.equal(toStr(mul(Dec.parse('1.5'), Dec.parse('2'))), '3.0')
})

test('number masks', () => {
  assert.equal(formatNumber(1234.5, '###0.00'), '1234.50')
  assert.equal(formatNumber(1234.5, '#,##0.00'), '1,234.50')
  assert.equal(formatNumber(1234567.891, '#,##0.00'), '1,234,567.89')
  assert.equal(formatNumber(1234567.891, '#,##,##,##0.00'), '12,34,567.89')
  assert.equal(formatNumber(0, '#,##0.00'), '0.00')
  assert.equal(formatNumber(0.5, '#.##'), '.5')
  assert.equal(formatNumber(-5, '0.00'), '-5.00')
  assert.equal(formatNumber(-5, '0.00;(0.00)'), '(5.00)')
  assert.equal(formatNumber(7, '00000'), '00007')
  assert.equal(formatNumber(12.3456, '[general]'), '12.3456')
  assert.equal(formatNumber(Dec.parse('12.345'), '0.00'), '12.35')
})

test('dates', () => {
  const d = PBDate.ymd(2026, 11, 2)
  assert.equal(formatDate(d, 'dd/mm/yyyy'), '02/11/2026')
  assert.equal(formatDate(d, 'dddd, d mmmm yy'), 'Monday, 2 November 26')
  assert.equal(d.dow, 2)
  assert.equal(formatTime(PBTime.hms(15, 4, 9), 'hh:mm:ss'), '15:04:09')
  assert.equal(formatTime(PBTime.hms(15, 4, 9), 'h:mm am/pm'), '3:04 PM')
  assert.equal(cmp(PBDate.ymd(1900, 2, 28), PBDate.ymd(1899, 12, 30)), 1)
})

test('coercion', () => {
  assert.equal(coerce('integer', 40000), -25536)
  assert.equal(coerce('long', 3.9), 3)
  assert.equal(coerce('string', 5), '5')
  assert.equal(String(coerce('decimal', 1.25)), '1.25')
  assert.equal(div(7, 2), 3.5)
})
