export type InterfaceMode = 'classic' | 'modern'
export type PrintFamilyPreferences = Readonly<Record<string, InterfaceMode>>
export interface UiPreferences {
  version: 1
  mode: InterfaceMode
  printMode: InterfaceMode
  /** explicit per-family choices; an absent family follows printMode */
  printFamilies: PrintFamilyPreferences
  theme: 'system' | 'light' | 'dark'
  density: 'compact' | 'comfortable'
  textSize: number
}

export interface PresentationScope {
  server: string
  database: string
  appUser: string
  workstation: string
}

export interface PreferenceStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export const DEFAULT_UI_PREFERENCES: Readonly<UiPreferences> = Object.freeze({
  version: 1, mode: 'modern', printMode: 'classic', printFamilies: Object.freeze({}),
  theme: 'system', density: 'compact', textSize: 100,
})

export class PreferenceError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause })
    this.name = 'PreferenceError'
  }
}

export function validatePreferences(value: unknown): UiPreferences {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new PreferenceError('Appearance preferences must be an object.')
  const record: Record<string, unknown> = { ...value }
  const families = record.printFamilies === undefined ? {} : record.printFamilies
  const validFamilies = families !== null && typeof families === 'object' && !Array.isArray(families)
    && Object.keys(families).length <= 64
    && Object.entries(families).every(([family, mode]) =>
      /^[a-z0-9][a-z0-9._-]{0,63}$/.test(family) && (mode === 'classic' || mode === 'modern'))
  if (Object.keys(record).some((key) => !Object.hasOwn(DEFAULT_UI_PREFERENCES, key))
      || record.version !== 1
      || (record.mode !== 'classic' && record.mode !== 'modern')
      || (record.printMode !== 'classic' && record.printMode !== 'modern')
      || !validFamilies
      || (record.theme !== 'system' && record.theme !== 'light' && record.theme !== 'dark')
      || (record.density !== 'compact' && record.density !== 'comfortable')
      || typeof record.textSize !== 'number' || !Number.isInteger(record.textSize) || record.textSize < 100 || record.textSize > 200) {
    throw new PreferenceError('Appearance preferences have an unsupported version or invalid values.')
  }
  return {
    version: 1, mode: record.mode, printMode: record.printMode,
    printFamilies: { ...(families as Record<string, InterfaceMode>) },
    theme: record.theme === 'dark' ? 'dark' : record.theme === 'light' ? 'light' : 'system',
    density: record.density === 'comfortable' ? 'comfortable' : 'compact', textSize: record.textSize,
  }
}

export async function preferenceKey(scope: PresentationScope): Promise<string> {
  const parts = [scope.server, scope.database, scope.appUser, scope.workstation]
  if (parts.some((part) => typeof part !== 'string' || !part.trim())) {
    throw new PreferenceError('Appearance preferences require a server, database, signed-in user and workstation.')
  }
  let server = scope.server
  if (server.includes('://')) {
    const url = new URL(server)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
      throw new PreferenceError('The appearance scope must use an API address without credentials or query parameters.')
    }
    server = url.href.replace(/\/$/, '')
  }
  // Persist neither identifiers nor connection material as readable storage keys.
  const encoded = new TextEncoder().encode(JSON.stringify([server, scope.database, scope.appUser, scope.workstation]))
  // crypto.subtle exists only on a secure origin (https, localhost, the desktop shell); a browser on a LAN address over plain http has
  // none, and must still sign in: it keys its preferences with a non-cryptographic digest under its own prefix.
  if (!globalThis.crypto?.subtle) return 'trader.ui.v1f.' + fallbackDigest(encoded)
  const digest = await crypto.subtle.digest('SHA-256', encoded)
  return 'trader.ui.v1.' + [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** Four independent FNV-1a 32-bit hashes: an opaque key, not a security boundary (the value stored under it is not secret). */
function fallbackDigest(bytes: Uint8Array): string {
  return [0x811c9dc5, 0x01000193, 0x5bd1e995, 0x27d4eb2f].map((seed) => {
    let hash = seed >>> 0
    for (const byte of bytes) hash = Math.imul(hash ^ byte, 0x01000193) >>> 0
    return hash.toString(16).padStart(8, '0')
  }).join('')
}

/** Preferences kept for this session only, when the browser storage cannot be used. */
export class SessionPreferenceStorage implements PreferenceStorage {
  private values = new Map<string, string>()
  getItem(key: string): string | null { return this.values.get(key) ?? null }
  setItem(key: string, value: string): void { this.values.set(key, value) }
}

/** The current host is fixed at sign-in; saving another mode only affects a later session. */
export class PresentationSession {
  readonly activeMode: InterfaceMode
  private current: UiPreferences
  private storage: PreferenceStorage
  private key: string

  private constructor(storage: PreferenceStorage, key: string, preferences: UiPreferences) {
    this.storage = storage
    this.key = key
    this.current = preferences
    this.activeMode = preferences.mode
  }

  static async load(storage: PreferenceStorage, scope: PresentationScope): Promise<PresentationSession> {
    const key = await preferenceKey(scope)
    try {
      const saved = storage.getItem(key)
      return new PresentationSession(storage, key, saved === null ? { ...DEFAULT_UI_PREFERENCES } : validatePreferences(JSON.parse(saved)))
    } catch (error) {
      throw new PreferenceError('Appearance preferences could not be read. The saved value has not been changed.', error)
    }
  }

  get preferences(): UiPreferences {
    return { ...this.current, printFamilies: { ...this.current.printFamilies } }
  }

  /** The family's explicit choice, falling back to the global print layout. */
  printModeFor(family: string): InterfaceMode {
    return Object.hasOwn(this.current.printFamilies, family) ? this.current.printFamilies[family] : this.current.printMode
  }

  save(preferences: UiPreferences): void {
    const validated = validatePreferences(preferences)
    try {
      this.storage.setItem(this.key, JSON.stringify(validated))
    } catch (error) {
      throw new PreferenceError('Appearance preferences could not be saved. No settings have been applied.', error)
    }
    this.current = validated
  }
}
