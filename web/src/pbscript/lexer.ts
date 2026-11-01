// Lexer for one line of recovered PowerScript.

export type Tok = { t: 'num' | 'str' | 'id' | 'enum' | 'op' | 'eof'; v: string }

const IDSTART = /[A-Za-z_$#%]/
const IDCHAR = /[A-Za-z0-9_$#%-]/
const OPS3: string[] = []
const OPS2 = ['<>', '<=', '>=', '::', '+=', '-=', '*=', '/=', '++', '--']
const OPS1 = '+-*/^=<>(),.[]{}:;&'

export function unescape(s: string): string {
  // PowerScript escapes: ~n ~r ~t ~" ~' ~~ ~ooo ~hFF
  let out = ''
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (c !== '~' || i === s.length - 1) {
      out += c
      continue
    }
    const d = s[++i]
    if (d === 'n') out += '\n'
    else if (d === 'r') out += '\r'
    else if (d === 't') out += '\t'
    else if (d === 'f') out += '\f'
    else if (d === 'v') out += '\v'
    else if (d === 'h' && /^[0-9a-fA-F]{2}/.test(s.slice(i + 1, i + 3))) {
      out += String.fromCharCode(parseInt(s.slice(i + 1, i + 3), 16))
      i += 2
    } else if (/[0-7]/.test(d) && /^[0-7]{3}/.test(s.slice(i, i + 3))) {
      out += String.fromCharCode(parseInt(s.slice(i, i + 3), 8))
      i += 2
    } else out += d
  }
  return out
}

export function lex(src: string): Tok[] {
  const out: Tok[] = []
  let i = 0
  const n = src.length
  while (i < n) {
    const c = src[i]
    if (c === ' ' || c === '\t' || c === '\r') {
      i++
      continue
    }
    if (c === '"' || c === "'") {
      let j = i + 1
      let raw = ''
      while (j < n && src[j] !== c) {
        if (src[j] === '~' && j + 1 < n) {
          raw += src[j] + src[j + 1]
          j += 2
        } else raw += src[j++]
      }
      if (j >= n) throw new Error('unterminated string')
      out.push({ t: 'str', v: unescape(raw) })
      i = j + 1
      continue
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] || '') && !(out.length && (out[out.length - 1].t === 'id' || out[out.length - 1].v === ']' || out[out.length - 1].v === ')')))) {
      let j = i
      while (j < n && /[0-9]/.test(src[j])) j++
      if (src[j] === '.' && /[0-9]/.test(src[j + 1] || '')) {
        j++
        while (j < n && /[0-9]/.test(src[j])) j++
      }
      if ((src[j] === 'e' || src[j] === 'E') && /^[+-]?[0-9]/.test(src.slice(j + 1, j + 3))) {
        j++
        if (src[j] === '+' || src[j] === '-') j++
        while (j < n && /[0-9]/.test(src[j])) j++
      }
      out.push({ t: 'num', v: src.slice(i, j) })
      i = j
      continue
    }
    if (IDSTART.test(c)) {
      let j = i + 1
      while (j < n && IDCHAR.test(src[j])) j++
      // a hyphen only belongs to the name when the decompiler printed it without spaces (m_-, m_-1 ...)
      let word = src.slice(i, j)
      if (src[j] === '!') {
        out.push({ t: 'enum', v: word.toLowerCase() + '!' })
        i = j + 1
        continue
      }
      out.push({ t: 'id', v: word })
      i = j
      continue
    }
    const two = src.slice(i, i + 2)
    if (OPS2.includes(two)) {
      out.push({ t: 'op', v: two })
      i += 2
      continue
    }
    if (OPS1.includes(c)) {
      out.push({ t: 'op', v: c })
      i++
      continue
    }
    throw new Error('bad character ' + JSON.stringify(c))
  }
  out.push({ t: 'eof', v: '' })
  return out
}
