import test from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_UI_PREFERENCES, preferenceKey, PresentationSession, validatePreferences } from '../src/app/ui-preferences.ts'
import type { PreferenceStorage } from '../src/app/ui-preferences.ts'

const scope = { server: 'https://example.invalid/api', database: 'synthetic', appUser: '17', workstation: 'fixture' }
class MemoryStorage implements PreferenceStorage {
  records = new Map<string, string>()
  getItem(key: string): string | null { return this.records.get(key) ?? null }
  setItem(key: string, value: string): void { this.records.set(key, value) }
}

test('new presentation sessions default to Modern with independent Classic printing', async () => {
  const session = await PresentationSession.load(new MemoryStorage(), scope)
  assert.deepEqual(session.preferences, DEFAULT_UI_PREFERENCES)
  assert.equal(session.activeMode, 'modern')
})

test('changing mode applies only to the next session and survives reopening', async () => {
  const storage = new MemoryStorage()
  const session = await PresentationSession.load(storage, scope)
  session.save({ ...session.preferences, mode: 'classic', printMode: 'modern', theme: 'dark', density: 'comfortable', textSize: 200 })
  assert.equal(session.activeMode, 'modern')
  assert.equal(session.preferences.mode, 'classic')
  const next = await PresentationSession.load(storage, scope)
  assert.equal(next.activeMode, 'classic')
  assert.deepEqual(next.preferences, session.preferences)
  const snapshot = session.preferences
  snapshot.theme = 'light'
  assert.equal(session.preferences.theme, 'dark')
})

test('server, database, app-user and workstation scopes do not collide', async () => {
  const storage = new MemoryStorage()
  const original = await PresentationSession.load(storage, scope)
  original.save({ ...original.preferences, mode: 'classic' })
  for (const field of ['server', 'database', 'appUser', 'workstation'] as const) {
    const changed = { ...scope, [field]: field === 'server' ? 'https://second.invalid/api' : 'different' }
    assert.equal((await PresentationSession.load(storage, changed)).activeMode, 'modern')
    assert.notEqual(await preferenceKey(scope), await preferenceKey(changed))
  }
  const key = await preferenceKey(scope)
  assert.match(key, /^trader\.ui\.v1\.[a-f0-9]{64}$/)
  assert.equal(key.includes(scope.database), false)
  assert.equal(await preferenceKey({ ...scope, server: scope.server + '/' }), key)
})

test('malformed, unsupported and extra-field preferences are rejected without overwriting', async () => {
  const storage = new MemoryStorage()
  const key = await preferenceKey(scope)
  for (const value of ['not json', JSON.stringify({ ...DEFAULT_UI_PREFERENCES, version: 2 }), JSON.stringify({ ...DEFAULT_UI_PREFERENCES, draft: 'must not persist' })]) {
    storage.records.set(key, value)
    await assert.rejects(PresentationSession.load(storage, scope), /could not be read/)
    assert.equal(storage.records.get(key), value)
  }
  for (const change of [{ textSize: 99 }, { textSize: 201 }, { textSize: 150.5 }, { theme: { toString: () => 'dark' } }, { density: 'dense' }, { mode: 'unknown' }]) {
    assert.throws(() => validatePreferences({ ...DEFAULT_UI_PREFERENCES, ...change }), /invalid values/)
  }
})

test('storage failures surface errors and do not apply unsaved preferences', async () => {
  const session = await PresentationSession.load({ getItem: () => null, setItem: () => { throw new Error('quota') } }, scope)
  assert.throws(() => session.save({ ...session.preferences, theme: 'dark' }), /could not be saved/)
  assert.equal(session.preferences.theme, 'system')
  await assert.rejects(PresentationSession.load({ getItem: () => { throw new Error('denied') }, setItem: () => {} }, scope), /could not be read/)
})

test('missing identities and credential-bearing addresses cannot form a storage scope', async () => {
  await assert.rejects(preferenceKey({ ...scope, appUser: '' }), /require a server/)
  for (const server of ['https://name:synthetic@example.invalid', 'https://example.invalid?token=synthetic', 'postgres://example.invalid/db']) {
    await assert.rejects(preferenceKey({ ...scope, server }), /without credentials/)
  }
})
