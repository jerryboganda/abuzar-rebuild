// Writes QR codes of many sizes / levels as bitmaps for tools/qr_verify.py, which decodes them with an independent decoder (OpenCV).
// usage: node tools/qr-check.ts <out dir>
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { encodeQr, qrBmp } from '../src/runtime/qr.ts'
import type { Ecl } from '../src/runtime/qr.ts'

const out = process.argv[2]
mkdirSync(out, { recursive: true })
const texts = [
  'A',
  'HELLO WORLD',
  'https://example.com/fbr/invoice/12345?x=1',
  'Invoice 000123 | NTN 1234567-8 | 2026-11-02 14:35:10 | Total 12,345.67 | Tax 1,851.85',
  'x'.repeat(120),
  'Pakistan اردو نستعلیق',
  'The quick brown fox jumps over the lazy dog. '.repeat(8),
  Array.from({ length: 700 }, (_, i) => String.fromCharCode(33 + ((i * 7) % 90))).join(''),
]
const cases: { file: string; text: string; ecl: number; version: number }[] = []
let n = 0
for (const text of texts)
  for (const ecl of [0, 1, 2, 3] as Ecl[]) {
    const q = encodeQr(text, ecl)
    if (!q) continue
    const file = `qr${String(n++).padStart(3, '0')}.bmp`
    writeFileSync(join(out, file), qrBmp(q, 4, 5))
    cases.push({ file, text, ecl, version: q.version })
  }
writeFileSync(join(out, 'cases.json'), JSON.stringify(cases))
console.log(`wrote ${cases.length} codes, versions ${Math.min(...cases.map((c) => c.version))}-${Math.max(...cases.map((c) => c.version))}`)
