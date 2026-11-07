export type InterfaceMode = 'classic' | 'modern'
export interface UiPreferences {
  version: 1
  mode: InterfaceMode
  printMode: InterfaceMode
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
  version: 1, mode: 'modern', printMode: 'classic', theme: 'system', density: 'compact', textSize: 100,
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
  if (Object.keys(record).some((key) => !Object.hasOwn(DEFAULT_UI_PREFERENCES, key))
      || record.version !== 1
      || (record.mode !== 'classic' && record.mode !== 'modern')
      || (record.printMode !== 'classic' && record.printMode !== 'modern')
      || (record.theme !== 'system' && record.theme !== 'light' && record.theme !== 'dark')
      || (record.density !== 'compact' && record.density !== 'comfortable')
      || typeof record.textSize !== 'number' || !Number.isInteger(record.textSize) || record.textSize < 100 || record.textSize > 200) {
    throw new PreferenceError('Appearance preferences have an unsupported version or invalid values.')
  }
  return {
    version: 1, mode: record.mode, printMode: record.printMode,
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
  const digest = await crypto.subtle.digest('SHA-256', encoded)
  return 'trader.ui.v1.' + [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
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

  get preferences(): UiPreferences { return { ...this.current } }

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
