import { test } from 'node:test'
import assert from 'node:assert/strict'
import { messageButtons } from '../src/ui/message-buttons.ts'

test('Classic and Modern message boxes share PowerBuilder response codes', () => {
  const expected = {
    'ok!': [['OK', 1]],
    'okcancel!': [['OK', 1], ['Cancel', 2]],
    'yesno!': [['Yes', 1], ['No', 2]],
    'yesnocancel!': [['Yes', 1], ['No', 2], ['Cancel', 3]],
    'retrycancel!': [['Retry', 1], ['Cancel', 2]],
    'abortretryignore!': [['Abort', 1], ['Retry', 2], ['Ignore', 3]],
  }
  for (const [kind, choices] of Object.entries(expected)) assert.deepEqual(messageButtons(kind), choices)
})

test('unsupported message buttons retain observable Classic fallback behavior', (context) => {
  const warning = context.mock.method(console, 'warn', () => {})
  assert.deepEqual(messageButtons('unsupported!'), [['OK', 1]])
  assert.deepEqual(messageButtons('constructor'), [['OK', 1]])
  assert.equal(warning.mock.callCount(), 2)
})
