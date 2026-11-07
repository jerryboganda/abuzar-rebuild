import type { InterfaceMode, UiPreferences } from '../app/ui-preferences.ts'

export type NativeTheme = 'light' | 'dark' | null
export interface ThemeWindow {
  setTheme(theme: NativeTheme): Promise<void>
}

export function nativeTheme(mode: InterfaceMode, theme: UiPreferences['theme']): NativeTheme {
  return mode === 'classic' ? 'light' : theme === 'system' ? null : theme
}

export function currentThemeWindow(): ThemeWindow | null {
  const host = globalThis as {
    __TAURI_INTERNALS__?: unknown
    __TAURI__?: { window?: { getCurrentWindow?: () => ThemeWindow } }
  }
  if (!host.__TAURI__ && !host.__TAURI_INTERNALS__) return null
  const getWindow = host.__TAURI__?.window?.getCurrentWindow
  if (typeof getWindow !== 'function') throw new Error('The desktop appearance bridge is unavailable.')
  const window = getWindow()
  if (typeof window?.setTheme !== 'function') throw new Error('The desktop window does not support theme selection.')
  return window
}

export class NativeAppearance {
  private queue: Promise<void> = Promise.resolve()
  private getWindow: () => ThemeWindow | null

  constructor(getWindow: () => ThemeWindow | null = currentThemeWindow) { this.getWindow = getWindow }

  set(theme: NativeTheme): Promise<boolean> {
    const request = this.queue.then(async () => {
      const window = this.getWindow()
      if (!window) return false
      await window.setTheme(theme)
      return true
    })
    // Keep later requests ordered after a failure; the caller receives the original rejection.
    this.queue = request.then(() => undefined, () => undefined)
    return request
  }
}

// Host replacement must not let an older native operation overtake the next signed-in host.
export const nativeAppearance = new NativeAppearance()
