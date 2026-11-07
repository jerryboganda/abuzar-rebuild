import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { NativeAppearance, currentThemeWindow, nativeTheme } from '../src/ui/native-appearance.ts'
import type { NativeTheme } from '../src/ui/native-appearance.ts'

test('Classic always keeps Light chrome; Modern System restores native system following', () => {
  for (const theme of ['system', 'light', 'dark'] as const) assert.equal(nativeTheme('classic', theme), 'light')
  assert.equal(nativeTheme('modern', 'system'), null)
  assert.equal(nativeTheme('modern', 'light'), 'light')
  assert.equal(nativeTheme('modern', 'dark'), 'dark')
})

test('plain browser previews do not pretend to apply a native theme', async () => {
  assert.equal(currentThemeWindow(), null)
  assert.equal(await new NativeAppearance(() => null).set('dark'), false)
})

test('native requests serialize so a replaced host or rapid settings change wins last', async () => {
  const calls: NativeTheme[] = []
  const release = Promise.withResolvers<void>()
  const bridge = new NativeAppearance(() => ({
    async setTheme(theme) {
      calls.push(theme)
      if (calls.length === 1) await release.promise
    },
  }))
  const old = bridge.set('dark')
  const current = bridge.set('light')
  const system = bridge.set(null)
  await Promise.resolve()
  assert.deepEqual(calls, ['dark'])
  release.resolve()
  assert.deepEqual(await Promise.all([old, current, system]), [true, true, true])
  assert.deepEqual(calls, ['dark', 'light', null])
})

test('native failures reject visibly without blocking an explicit retry', async () => {
  let fails = true
  const bridge = new NativeAppearance(() => ({
    async setTheme() { if (fails) throw new Error('Synthetic native permission failure') },
  }))
  await assert.rejects(bridge.set('dark'), /Synthetic native permission failure/)
  fails = false
  assert.equal(await bridge.set('dark'), true)
})

test('a desktop without the configured bridge is an error, not a browser fallback', () => {
  const host = globalThis as { __TAURI_INTERNALS__?: unknown }
  host.__TAURI_INTERNALS__ = {}
  try { assert.throws(currentThemeWindow, /bridge is unavailable/) }
  finally { delete host.__TAURI_INTERNALS__ }
})

test('desktop appearance uses the official global API and only adds the needed window permission', () => {
  const root = resolve(import.meta.dirname, '..', '..', 'src-tauri')
  const config = JSON.parse(readFileSync(resolve(root, 'tauri.conf.json'), 'utf8'))
  const capability = JSON.parse(readFileSync(resolve(root, 'capabilities', 'default.json'), 'utf8'))
  assert.equal(config.app.withGlobalTauri, true)
  assert.equal(config.app.windows[0].theme, 'Light')
  assert.deepEqual(capability.windows, ['main'])
  assert.deepEqual(capability.permissions, [
    'core:default', 'core:window:allow-set-title', 'core:window:allow-set-icon', 'core:window:allow-set-theme',
  ])
})
