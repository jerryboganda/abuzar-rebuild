import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

test('the formatter comparator includes matching and mismatching question-mark output', () => {
  const folder = mkdtempSync(join(tmpdir(), 'trader-format-diff-'))
  try {
    const meta = join(folder, 'meta.json'), engine = join(folder, 'engine.jsonl'), report = join(folder, 'report.json')
    writeFileSync(meta, JSON.stringify([
      ['num', '1234.5', '#,##0.00'],
      ['date', 'date', 'dd/mm/yyyy hh:mm'],
      ['date', 'date', 'dd/mm/yyyy hh:mm'],
      ['str', '?', '@'],
      ['date', 'date', 'dd/mm/yyyy'],
      ['date', 'date', 'dd/mm/yyyy'],
    ]))
    writeFileSync(engine, ['1,234.50', '03/11/2026 ??:??', '03/11/2026 ??:xx', '?', '<CRASH>', '\uffff']
      .map((r, i) => JSON.stringify({ i, r })).join('\n'))
    execFileSync(process.execPath, [fileURLToPath(new URL('../tools/format-diff.ts', import.meta.url)), meta, engine, report],
      { encoding: 'utf8', timeout: 20_000 })
    const result = JSON.parse(readFileSync(report, 'utf8'))
    assert.equal(result.same, 3)
    assert.equal(result.diff, 1)
    assert.equal(result.crashed, 1)
    assert.deepEqual(result.rows, [{
      kind: 'date', value: 'date', fmt: 'dd/mm/yyyy hh:mm',
      engine: '03/11/2026 ??:xx', rebuild: '03/11/2026 ??:??',
    }])
  } finally {
    rmSync(folder, { recursive: true, force: true })
  }
})
