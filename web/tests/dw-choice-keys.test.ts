import test from 'node:test'
import assert from 'node:assert/strict'
import { DwChoiceEditor } from '../src/ui/dw-choice-editor.ts'

const key = (key: string, modifiers: Partial<Record<'shiftKey' | 'altKey' | 'ctrlKey' | 'metaKey', boolean>> = {}) =>
  ({ key, shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, ...modifiers }) as KeyboardEvent

test('the detail browser has its own shortcut; F4 and Alt+Down keep opening the list as in the Classic view', () => {
  assert.equal(DwChoiceEditor.detailKey(key('F4', { shiftKey: true })), true)
  assert.equal(DwChoiceEditor.detailKey(key('F4')), false)
  assert.equal(DwChoiceEditor.detailKey(key('ArrowDown', { altKey: true })), false)
  assert.equal(DwChoiceEditor.detailKey(key('F4', { shiftKey: true, ctrlKey: true })), false)
  assert.equal(DwChoiceEditor.detailKey(key('F4', { ctrlKey: true })), false)
})
