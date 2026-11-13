import test from 'node:test'
import assert from 'node:assert/strict'
import { mnemonicKey } from '../src/ui/pb.ts'
import { keyEnum, keyFlags, shortcutCode, virtualKey } from '../src/ui/keys.ts'

test('PowerBuilder captions expose their single accelerator character', () => {
  assert.equal(mnemonicKey('&Save\tCtrl+S'), 's')
  assert.equal(mnemonicKey('Mana&ge'), 'g')
  assert.equal(mnemonicKey('&Ok'), 'o')
  assert.equal(mnemonicKey('&&Name'), null)
  assert.equal(mnemonicKey('No accelerator'), null)
  assert.equal(mnemonicKey('&'), null)
})

test('browser keys map to PowerScript key enumerations and flags', () => {
  const event = (key: string, code = key, shiftKey = false, ctrlKey = false) =>
    ({ key, code, shiftKey, ctrlKey }) as KeyboardEvent
  assert.equal(keyEnum(event('F4')), 'keyf4!')
  assert.equal(keyEnum(event('Enter')), 'keyenter!')
  assert.equal(keyEnum(event('Escape')), 'keyescape!')
  assert.equal(keyEnum(event('s')), 'keys!')
  assert.equal(keyEnum(event('7')), 'key7!')
  assert.equal(keyFlags(event('s', 's', true, true)), 3)
  assert.equal(virtualKey('keyf4!'), 115)
  assert.equal(virtualKey('keyenter!'), 13)
  assert.equal(virtualKey('keys!'), 83)
  assert.equal(virtualKey('key7!'), 55)
  const chord = (keyCode: number, ctrlKey = false, altKey = false, shiftKey = false) =>
    ({ keyCode, ctrlKey, altKey, shiftKey }) as KeyboardEvent
  assert.equal(shortcutCode(chord(83, true)), 339) // Ctrl+S
  assert.equal(shortcutCode(chord(84, true, true)), 852) // Ctrl+Alt+T
  assert.equal(shortcutCode(chord(82, true, false, true)), 1362) // Ctrl+Shift+R
  assert.equal(shortcutCode(chord(121)), 121) // F10
})
