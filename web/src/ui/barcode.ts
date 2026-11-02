// Code 39 barcodes.  The application prints item labels and receipts with the fonts "Free 3 of 9 Extended" and
// "IDAutomation.com Code39" (538 objects in 76 DataWindows): the text of the field is drawn by the font as bars.  Those fonts are not
// installed on a user's machine, so the bars are drawn here.
const PATTERN: Record<string, string> = {
  '0': 'nnnwwnwnn', '1': 'wnnwnnnnw', '2': 'nnwwnnnnw', '3': 'wnwwnnnnn', '4': 'nnnwwnnnw', '5': 'wnnwwnnnn', '6': 'nnwwwnnnn', '7': 'nnnwnnwnw',
  '8': 'wnnwnnwnn', '9': 'nnwwnnwnn', A: 'wnnnnwnnw', B: 'nnwnnwnnw', C: 'wnwnnwnnn', D: 'nnnnwwnnw', E: 'wnnnwwnnn', F: 'nnwnwwnnn',
  G: 'nnnnnwwnw', H: 'wnnnnwwnn', I: 'nnwnnwwnn', J: 'nnnnwwwnn', K: 'wnnnnnnww', L: 'nnwnnnnww', M: 'wnwnnnnwn', N: 'nnnnwnnww',
  O: 'wnnnwnnwn', P: 'nnwnwnnwn', Q: 'nnnnnnwww', R: 'wnnnnnwwn', S: 'nnwnnnwwn', T: 'nnnnwnwwn', U: 'wwnnnnnnw', V: 'nwwnnnnnw',
  W: 'wwwnnnnnn', X: 'nwnnwnnnw', Y: 'wwnnwnnnn', Z: 'nwwnwnnnn', '-': 'nwnnnnwnw', '.': 'wwnnnnwnn', ' ': 'nwwnnnwnn', '*': 'nwnnwnwnn',
  $: 'nwnwnwnnn', '/': 'nwnwnnnwn', '+': 'nwnnnwnwn', '%': 'nnnwnwnwn',
}

export const isCode39Font = (face: string | undefined): boolean => !!face && /3 of 9|code ?39/i.test(face)

/** the characters the bars encode: the extended set writes a lower-case letter as `+` and the upper-case letter */
function encode(text: string): string {
  let body = ''
  for (const ch of text) {
    if (ch === '*') continue
    if (PATTERN[ch.toUpperCase()] && !(ch >= 'a' && ch <= 'z')) body += ch
    else if (ch >= 'a' && ch <= 'z') body += '+' + ch.toUpperCase()
  }
  return `*${body}*`
}

/** SVG of the bars of `text` (start / stop `*` are added), stretched over width x height */
export function code39Svg(text: string, width: number, height: number): string {
  const chars = encode(text)
  const NARROW = 1
  const WIDE = 2.5
  let x = 0
  let bars = ''
  for (let c = 0; c < chars.length; c++) {
    const p = PATTERN[chars[c]]
    for (let i = 0; i < p.length; i++) {
      const w = p[i] === 'w' ? WIDE : NARROW
      if (i % 2 === 0) bars += `<rect x="${x}" y="0" width="${w}" height="1"/>`
      x += w
    }
    x += NARROW // gap between characters
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.max(1, Math.round(width))}" height="${Math.max(1, Math.round(height))}" viewBox="0 0 ${x - NARROW} 1" preserveAspectRatio="none" shape-rendering="crispEdges" fill="#000">${bars}</svg>`
}
