// QR code encoder (byte mode, versions 1-40, all four error correction levels) and a bitmap writer.
// Replaces QRCodeGenLibrary.dll (`createbmpfile(file, text, errCorLvl, border, scale)`), which the application calls to print the fiscal-invoice
// QR code.  The algorithm is the standard one of ISO/IEC 18004 (symbol layout, Reed-Solomon over GF(256), eight masks with penalty scoring).

/** 0 = L, 1 = M, 2 = Q, 3 = H */
export type Ecl = 0 | 1 | 2 | 3

const FORMAT_BITS = [1, 0, 3, 2] // L M Q H
const ECC_PER_BLOCK: number[][] = [
  [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
  [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
]
const BLOCKS: number[][] = [
  [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
  [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
  [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
]

function rawModules(ver: number): number {
  let r = (16 * ver + 128) * ver + 64
  if (ver >= 2) {
    const n = Math.floor(ver / 7) + 2
    r -= (25 * n - 10) * n - 55
    if (ver >= 7) r -= 36
  }
  return r
}
export function dataCodewords(ver: number, ecl: Ecl): number {
  return Math.floor(rawModules(ver) / 8) - ECC_PER_BLOCK[ecl][ver] * BLOCKS[ecl][ver]
}

// ---------------------------------------------------------------- Reed-Solomon over GF(2^8) / 0x11D
function gfMul(x: number, y: number): number {
  let z = 0
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d)
    z ^= ((y >>> i) & 1) * x
  }
  return z
}
export function rsDivisor(degree: number): number[] {
  const r = new Array<number>(degree).fill(0)
  r[degree - 1] = 1
  let root = 1
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      r[j] = gfMul(r[j], root)
      if (j + 1 < degree) r[j] ^= r[j + 1]
    }
    root = gfMul(root, 2)
  }
  return r
}
export function rsRemainder(data: number[], divisor: number[]): number[] {
  const r = divisor.map(() => 0)
  for (const b of data) {
    const factor = b ^ r.shift()!
    r.push(0)
    divisor.forEach((c, i) => (r[i] ^= gfMul(c, factor)))
  }
  return r
}

const bit = (x: number, i: number): boolean => ((x >>> i) & 1) !== 0

function alignmentPositions(ver: number): number[] {
  if (ver === 1) return []
  const n = Math.floor(ver / 7) + 2
  const step = ver === 32 ? 26 : Math.ceil((ver * 4 + 4) / (n * 2 - 2)) * 2
  const r = [6]
  for (let pos = ver * 4 + 17 - 7; r.length < n; pos -= step) r.splice(1, 0, pos)
  return r
}

/** the 15 format bits of an error correction level and mask (BCH code, masked with 0x5412) */
export function formatInfo(ecl: Ecl, mask: number): number {
  const d = (FORMAT_BITS[ecl] << 3) | mask
  let rem = d
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537)
  return ((d << 10) | rem) ^ 0x5412
}

export interface QrCode {
  version: number
  size: number
  mask: number
  modules: boolean[][]
}

export function encodeQr(text: string, ecl: Ecl = 1): QrCode | null {
  const bytes = [...new TextEncoder().encode(text)]
  let ver = 1
  for (;; ver++) {
    if (ver > 40) return null
    if (4 + (ver <= 9 ? 8 : 16) + 8 * bytes.length <= dataCodewords(ver, ecl) * 8) break
  }
  // segment: mode 0100, character count, bytes
  const bits: number[] = []
  const put = (v: number, n: number) => {
    for (let i = n - 1; i >= 0; i--) bits.push((v >>> i) & 1)
  }
  put(4, 4)
  put(bytes.length, ver <= 9 ? 8 : 16)
  for (const b of bytes) put(b, 8)
  const cap = dataCodewords(ver, ecl) * 8
  put(0, Math.min(4, cap - bits.length))
  put(0, (8 - (bits.length % 8)) % 8)
  for (let pad = 0xec; bits.length < cap; pad ^= 0xec ^ 0x11) put(pad, 8)
  const data: number[] = []
  for (let i = 0; i < bits.length; i += 8) data.push(parseInt(bits.slice(i, i + 8).join(''), 2))

  const size = ver * 4 + 17
  const modules = Array.from({ length: size }, () => new Array<boolean>(size).fill(false))
  const isFn = Array.from({ length: size }, () => new Array<boolean>(size).fill(false))
  const setFn = (x: number, y: number, dark: boolean) => {
    modules[y][x] = dark
    isFn[y][x] = true
  }
  // function patterns
  for (let i = 0; i < size; i++) {
    setFn(6, i, i % 2 === 0)
    setFn(i, 6, i % 2 === 0)
  }
  const finder = (cx: number, cy: number) => {
    for (let dy = -4; dy <= 4; dy++)
      for (let dx = -4; dx <= 4; dx++) {
        const d = Math.max(Math.abs(dx), Math.abs(dy))
        const x = cx + dx
        const y = cy + dy
        if (x >= 0 && x < size && y >= 0 && y < size) setFn(x, y, d !== 2 && d !== 4)
      }
  }
  finder(3, 3)
  finder(size - 4, 3)
  finder(3, size - 4)
  const al = alignmentPositions(ver)
  for (let i = 0; i < al.length; i++)
    for (let j = 0; j < al.length; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === al.length - 1) || (i === al.length - 1 && j === 0)) continue
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) setFn(al[i] + dx, al[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1)
    }
  const formatBits = (mask: number) => {
    const b = formatInfo(ecl, mask)
    for (let i = 0; i <= 5; i++) setFn(8, i, bit(b, i))
    setFn(8, 7, bit(b, 6))
    setFn(8, 8, bit(b, 7))
    setFn(7, 8, bit(b, 8))
    for (let i = 9; i < 15; i++) setFn(14 - i, 8, bit(b, i))
    for (let i = 0; i < 8; i++) setFn(size - 1 - i, 8, bit(b, i))
    for (let i = 8; i < 15; i++) setFn(8, size - 15 + i, bit(b, i))
    setFn(8, size - 8, true)
  }
  formatBits(0) // reserves the area
  if (ver >= 7) {
    let rem = ver
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25)
    const b = (ver << 12) | rem
    for (let i = 0; i < 18; i++) {
      const a = size - 11 + (i % 3)
      const c = Math.floor(i / 3)
      setFn(a, c, bit(b, i))
      setFn(c, a, bit(b, i))
    }
  }
  // error correction, interleaved
  const nBlocks = BLOCKS[ecl][ver]
  const eccLen = ECC_PER_BLOCK[ecl][ver]
  const raw = Math.floor(rawModules(ver) / 8)
  const nShort = nBlocks - (raw % nBlocks)
  const shortLen = Math.floor(raw / nBlocks)
  const div = rsDivisor(eccLen)
  const blocks: number[][] = []
  for (let i = 0, k = 0; i < nBlocks; i++) {
    const dat = data.slice(k, k + shortLen - eccLen + (i < nShort ? 0 : 1))
    k += dat.length
    const ecc = rsRemainder(dat, div)
    if (i < nShort) dat.push(0)
    blocks.push(dat.concat(ecc))
  }
  const all: number[] = []
  for (let i = 0; i < blocks[0].length; i++) blocks.forEach((b, j) => i !== shortLen - eccLen || j >= nShort ? all.push(b[i]) : undefined)
  // codewords in the zig-zag order
  let n = 0
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5
    for (let vert = 0; vert < size; vert++)
      for (let j = 0; j < 2; j++) {
        const x = right - j
        const y = ((right + 1) & 2) === 0 ? size - 1 - vert : vert
        if (!isFn[y][x] && n < all.length * 8) {
          modules[y][x] = bit(all[n >>> 3], 7 - (n & 7))
          n++
        }
      }
  }
  // choose the mask with the lowest penalty
  const applyMask = (mask: number) => {
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const inv = [(x + y) % 2 === 0, y % 2 === 0, x % 3 === 0, (x + y) % 3 === 0, (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, ((x * y) % 2) + ((x * y) % 3) === 0, (((x * y) % 2) + ((x * y) % 3)) % 2 === 0, (((x + y) % 2) + ((x * y) % 3)) % 2 === 0][mask]
        if (!isFn[y][x] && inv) modules[y][x] = !modules[y][x]
      }
  }
  let best = 0
  let bestScore = Infinity
  for (let mask = 0; mask < 8; mask++) {
    applyMask(mask)
    formatBits(mask)
    const s = penalty(modules, size)
    if (s < bestScore) {
      best = mask
      bestScore = s
    }
    applyMask(mask) // undo
  }
  applyMask(best)
  formatBits(best)
  return { version: ver, size, mask: best, modules }
}

function penalty(m: boolean[][], size: number): number {
  let score = 0
  const line = (get: (i: number) => boolean) => {
    let run = 1
    for (let i = 1; i < size; i++) {
      if (get(i) === get(i - 1)) {
        run++
        if (run === 5) score += 3
        else if (run > 5) score++
      } else run = 1
    }
    // finder-like 1:1:3:1:1 with four light modules on a side
    const pat = [true, false, true, true, true, false, true]
    for (let i = 0; i + 7 <= size; i++) {
      if (pat.every((p, k) => get(i + k) === p)) {
        const before = i >= 4 && [1, 2, 3, 4].every((k) => !get(i - k))
        const after = i + 11 <= size && [7, 8, 9, 10].every((k) => !get(i + k))
        if (before || after) score += 40
      }
    }
  }
  for (let y = 0; y < size; y++) line((i) => m[y][i])
  for (let x = 0; x < size; x++) line((i) => m[i][x])
  for (let y = 0; y + 1 < size; y++) for (let x = 0; x + 1 < size; x++) if (m[y][x] === m[y][x + 1] && m[y][x] === m[y + 1][x] && m[y][x] === m[y + 1][x + 1]) score += 3
  let dark = 0
  for (const row of m) for (const v of row) if (v) dark++
  score += (Math.ceil(Math.abs(dark * 20 - size * size * 10) / (size * size)) - 1) * 10
  return score
}

/** 24-bit BMP of the symbol: `border` light modules around it, `scale` pixels per module */
export function qrBmp(qr: QrCode, border: number, scale: number): Uint8Array {
  const px = (qr.size + 2 * border) * scale
  const rowBytes = Math.ceil((px * 3) / 4) * 4
  const out = new Uint8Array(54 + rowBytes * px).fill(0xff)
  out.fill(0, 0, 54) // the header fields not set below are zero
  const v = new DataView(out.buffer)
  out[0] = 0x42
  out[1] = 0x4d
  v.setUint32(2, out.length, true)
  v.setUint32(10, 54, true)
  v.setUint32(14, 40, true)
  v.setInt32(18, px, true)
  v.setInt32(22, px, true)
  v.setUint16(26, 1, true)
  v.setUint16(28, 24, true)
  v.setUint32(34, rowBytes * px, true)
  for (let y = 0; y < px; y++) {
    const my = Math.floor(y / scale) - border
    const rowStart = 54 + (px - 1 - y) * rowBytes // bottom-up
    for (let x = 0; x < px; x++) {
      const mx = Math.floor(x / scale) - border
      const dark = my >= 0 && my < qr.size && mx >= 0 && mx < qr.size && qr.modules[my][mx]
      const o = rowStart + x * 3
      out[o] = out[o + 1] = out[o + 2] = dark ? 0 : 0xff
    }
    for (let k = px * 3; k < rowBytes; k++) out[rowStart + k] = 0
  }
  return out
}
