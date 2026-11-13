// Keyboard: browser key events -> PowerScript KeyCode enumeration values (`keyenter!`, `keyf4!`, `keya!` ...) and key flags.

const NAMED: Record<string, string> = {
  Backspace: 'keyback!', Tab: 'keytab!', Enter: 'keyenter!', Shift: 'keyshift!', Control: 'keycontrol!', Alt: 'keyalt!', Pause: 'keypause!',
  CapsLock: 'keycapslock!', Escape: 'keyescape!', ' ': 'keyspacebar!', PageUp: 'keypageup!', PageDown: 'keypagedown!', End: 'keyend!',
  Home: 'keyhome!', ArrowLeft: 'keyleftarrow!', ArrowUp: 'keyuparrow!', ArrowRight: 'keyrightarrow!', ArrowDown: 'keydownarrow!',
  PrintScreen: 'keyprintscreen!', Insert: 'keyinsert!', Delete: 'keydelete!',
}

/** Windows virtual-key code of a PowerScript key enumeration value */
export function virtualKey(name: string): number {
  const n = name.toLowerCase()
  const f = /^keyf(\d{1,2})!$/.exec(n)
  if (f) return 111 + Number(f[1])
  const d = /^key(\d)!$/.exec(n)
  if (d) return 48 + Number(d[1])
  const l = /^key([a-z])!$/.exec(n)
  if (l) return l[1].toUpperCase().charCodeAt(0)
  const table: Record<string, number> = { 'keyback!': 8, 'keytab!': 9, 'keyenter!': 13, 'keyshift!': 16, 'keycontrol!': 17, 'keyalt!': 18, 'keyescape!': 27, 'keyspacebar!': 32, 'keypageup!': 33, 'keypagedown!': 34, 'keyend!': 35, 'keyhome!': 36, 'keyleftarrow!': 37, 'keyuparrow!': 38, 'keyrightarrow!': 39, 'keydownarrow!': 40, 'keyinsert!': 45, 'keydelete!': 46 }
  return table[n] ?? 0
}

export function keyEnum(ev: KeyboardEvent): string | null {
  if (NAMED[ev.key]) return NAMED[ev.key]
  if (/^F\d{1,2}$/.test(ev.key)) return 'key' + ev.key.toLowerCase() + '!'
  if (/^[0-9]$/.test(ev.key)) return `key${ev.key}!`
  if (/^[a-zA-Z]$/.test(ev.key)) return `key${ev.key.toLowerCase()}!`
  if (ev.code.startsWith('Numpad') && /\d$/.test(ev.code)) return `keynumpad${ev.code.slice(-1)}!`
  return null
}

/** KeyFlags: 1 = Shift, 2 = Ctrl, 3 = both (as PowerBuilder passes them) */
export function keyFlags(ev: KeyboardEvent): number {
  return (ev.shiftKey ? 1 : 0) | (ev.ctrlKey ? 2 : 0)
}

/** The numeric `shortcut` PowerBuilder stores on a menu item for this key chord. */
export function shortcutCode(ev: KeyboardEvent): number {
  return ev.keyCode + (ev.ctrlKey ? 256 : 0) + (ev.altKey ? 512 : 0) + (ev.shiftKey ? 1024 : 0)
}
