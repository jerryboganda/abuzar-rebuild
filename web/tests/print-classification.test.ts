import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { classify, OUTPUT } from '../tools/classify-documents.ts'
import { PRINT_TEMPLATES } from '../src/ui/print-templates.ts'

const result = classify()

test('the checked-in document classification matches a fresh run', () => {
  assert.equal(JSON.stringify(result, null, 1) + '\n', readFileSync(OUTPUT, 'utf8'), 'Run node tools/classify-documents.ts from web/')
})

test('every DataWindow is in exactly one evidence class and registered templates keep their own class', () => {
  const names = Object.values(result.members).flat()
  assert.equal(names.length, result.definitions)
  assert.equal(new Set(names).size, result.definitions)
  assert.deepEqual([...result.members['registered-template']].sort(), PRINT_TEMPLATES.flatMap((template) => [...template.definitions]).sort())
  assert.equal(result.printCandidates, result.classes['print-target'] + result.classes['report-or-document'] + result.classes['registered-template'])
})
