// Optional shared token for the server API in LAN mode (server environment variable API_TOKEN).  The desktop shell binds the
// server to localhost without one.  The token comes from `?token=` of the page URL, a global, or the session storage.
let cached: string | null = null

export function apiToken(): string {
  if (cached !== null) return cached
  let t = (globalThis as { TRADER_API_TOKEN?: string }).TRADER_API_TOKEN ?? ''
  try {
    const q = new URLSearchParams(globalThis.location?.search ?? '').get('token')
    if (q) sessionStorage.setItem('traderApiToken', q)
    t = t || sessionStorage.getItem('traderApiToken') || ''
  } catch {
    // no storage in this context
  }
  cached = t
  return t
}

export function setApiToken(t: string): void {
  cached = t
  try {
    sessionStorage.setItem('traderApiToken', t)
  } catch {
    // no storage in this context
  }
}

export function authHeaders(): Record<string, string> {
  const t = apiToken()
  return t ? { 'x-api-token': t } : {}
}

/** a 401 answer: ask the user for the token once and report whether a retry makes sense */
export function askForToken(): boolean {
  const ask = (globalThis as { prompt?: (m: string) => string | null }).prompt
  const t = ask ? ask('This server asks for an access token:') : null
  if (!t) return false
  setApiToken(t)
  return true
}
