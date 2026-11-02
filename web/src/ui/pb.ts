// PowerBuilder visual primitives: units, colours, fonts.
import { PX_PER_PBU_X, PX_PER_PBU_Y } from '../runtime/sysfuncs.ts'

export const SYSTEM_COLORS = { windowText: '#000000', buttonFace: '#f0f0f0', window: '#ffffff', appWorkspace: '#ababab', highlight: '#0078d7', highlightText: '#ffffff' }

export const px = { x: PX_PER_PBU_X, y: PX_PER_PBU_Y }

/** PowerBuilder units -> CSS pixels; DataWindow `datawindow.units`: 0 = PBU, 1 = pixels, 2 = 1/1000 inch, 3 = 1/1000 cm */
export function toPx(v: number, axis: 'x' | 'y', units = 0): number {
  switch (units) {
    case 1:
      return v
    case 2:
      return (v / 1000) * 96
    case 3:
      return (v / 1000 / 2.54) * 96
    default:
      return v * px[axis]
  }
}

/**
 * PowerBuilder colour value -> CSS colour.
 *  - plain 0x00BBGGRR values are RGB
 *  - values with a flag byte: low 24 bits non-zero = RGB with that flag, otherwise the system colour of the flag
 */
export function pbColor(v: number | string | undefined | null, fallback = 'transparent'): string {
  if (v === undefined || v === null || v === '') return fallback
  const n = typeof v === 'string' ? Number(v) : v
  if (Number.isNaN(n)) return fallback
  const u = n >>> 0
  const flag = u >>> 24
  const low = u & 0xffffff
  if (flag === 0 || (low !== 0 && flag !== 0x20 && flag !== 0x40)) return rgb(low)
  switch (flag) {
    case 0x02:
      return SYSTEM_COLORS.windowText
    case 0x04:
      return SYSTEM_COLORS.buttonFace
    case 0x08:
      return SYSTEM_COLORS.window
    case 0x10:
      return SYSTEM_COLORS.appWorkspace
    default:
      return 'transparent' // 0x20 / 0x40: transparent / default
  }
}

function rgb(bgr: number): string {
  const r = bgr & 0xff
  const g = (bgr >> 8) & 0xff
  const b = (bgr >> 16) & 0xff
  return '#' + [r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('')
}

export interface FontSpec {
  face: string
  size: number // points (positive); PowerBuilder stores negative = points, positive = pixels(*)
  weight: number
  italic: boolean
  underline: boolean
  strike: boolean
}

const FALLBACK: Record<string, string> = {
  'ms sans serif': '"MS Sans Serif", Tahoma, "Segoe UI", Arial, sans-serif',
  'ms serif': '"MS Serif", "Times New Roman", serif',
  'system': 'Tahoma, "Segoe UI", Arial, sans-serif',
  'courier': '"Courier New", monospace',
  'arial': 'Arial, "Liberation Sans", Helvetica, sans-serif',
  'times new roman': '"Times New Roman", "Liberation Serif", serif',
  'tahoma': 'Tahoma, "Segoe UI", Arial, sans-serif',
}

/** the generic family a face falls back to when it is not installed */
function genericOf(face: string): string {
  if (/courier|console|mono|draft|fixed/i.test(face)) return 'monospace'
  if (/script|corsiva|handwriting|brush/i.test(face)) return 'cursive'
  if (/times|serif|garamond|bookman|antiqua|cambria|batang|century|georgia|palatino|eras/i.test(face) && !/sans/i.test(face)) return 'serif'
  return 'sans-serif'
}

export function cssFont(f: FontSpec): string {
  const px = f.size * (96 / 72)
  const face = f.face.trim()
  const key = face.toLowerCase()
  let fam = FALLBACK[key]
  if (!fam) {
    const g = genericOf(face)
    if (/^draft \d+cpi$/.test(key)) fam = '"Courier New", Courier, monospace' // dot-matrix printer fonts
    else if (/nastaleeq|nastaliq|noori/.test(key)) fam = `"${face}", "Noto Nastaliq Urdu", "Noto Naskh Arabic", "Segoe UI", ${g}`
    else if (key === 'arial narrow') fam = '"Arial Narrow", "Liberation Sans Narrow", "Nimbus Sans Narrow", Arial, sans-serif'
    else fam = `"${face}", ${g === 'sans-serif' ? 'Arial, sans-serif' : g}`
  }
  return `${f.italic ? 'italic ' : ''}${f.weight || 400} ${px.toFixed(2)}px ${fam}`
}

/** characters per inch of a "Draft Ncpi" printer font, else 0 */
export function draftCpi(face: string): number {
  const m = /^draft (\d+)cpi$/i.exec(face.trim())
  return m ? Number(m[1]) : 0
}

/** PowerBuilder font height: negative = points, positive = (character cell) pixels */
export function fontSize(height: number): number {
  return height < 0 ? -height : Math.round((height * 72) / 96)
}
