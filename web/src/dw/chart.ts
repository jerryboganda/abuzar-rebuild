// Graph objects of DataWindows (70 report definitions): bar / column / line / area / pie charts drawn as SVG from the data of the DataWindow.
import type { DwModel } from './model.ts'
import type { DwObject } from './def.ts'
import { compileDw, evalDw, newCtx } from './expr.ts'
import { toNum, toStr } from '../runtime/values.ts'
import { pbColor } from '../ui/pb.ts'

/** PowerBuilder GraphType values */
const KIND: Record<number, 'area' | 'bar' | 'col' | 'line' | 'pie' | 'scatter'> = {
  1: 'area', 15: 'area', 2: 'bar', 3: 'bar', 4: 'bar', 5: 'bar', 6: 'bar', 7: 'col', 8: 'col', 9: 'col', 10: 'col', 11: 'col',
  12: 'line', 16: 'line', 13: 'pie', 14: 'pie', 17: 'scatter',
}
const PALETTE = ['#0000ff', '#ff0000', '#00a000', '#ff8000', '#800080', '#008080', '#808000', '#ff00ff', '#00ffff', '#804000']

interface Point {
  cat: string
  series: string
  v: number
}

async function points(m: DwModel, o: DwObject): Promise<{ pts: Point[]; cats: string[]; series: string[] }> {
  const catExpr = o.category ? compileDw(o.category) : null
  // `values` may be an aggregate over the graph: sum(netsales for graph)
  const valSrc = (o.values || '').replace(/\s+for\s+graph/i, '')
  const valExpr = valSrc ? compileDw(valSrc.replace(/^\s*(sum|avg|count|min|max)\s*\((.*)\)\s*$/i, '$2')) : null
  const serExpr = o.series ? compileDw(o.series) : null
  const acc = new Map<string, number>()
  const cats: string[] = []
  const series: string[] = []
  for (let r = 1; r <= m.rowCount(); r++) {
    const ctx = newCtx(m, r, 'detail')
    const cat = catExpr ? toStr(await evalDw(catExpr, ctx)) : String(r)
    const ser = serExpr ? toStr(await evalDw(serExpr, ctx)) : ''
    const v = valExpr ? toNum(await evalDw(valExpr, ctx)) : 0
    if (!cats.includes(cat)) cats.push(cat)
    if (!series.includes(ser)) series.push(ser)
    acc.set(cat + '\u0000' + ser, (acc.get(cat + '\u0000' + ser) || 0) + v)
  }
  const pts: Point[] = []
  for (const c of cats) for (const s of series) pts.push({ cat: c, series: s, v: acc.get(c + '\u0000' + s) || 0 })
  return { pts, cats, series }
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

export async function renderChart(m: DwModel, o: DwObject, w: number, h: number): Promise<string> {
  const kind = KIND[Number(o.graphtype ?? 7)] ?? 'col'
  const { pts, cats, series } = await points(m, o)
  const title = (o.title || '').replace(/^"|"$/g, '')
  const bg = pbColor(o.backcolor, '#fff')
  const font = 'font-family:Tahoma,Arial,sans-serif;font-size:10px'
  const parts: string[] = [`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" style="${font};background:${bg}">`]
  const top = title ? 22 : 8
  if (title) parts.push(`<text x="${w / 2}" y="15" text-anchor="middle" style="font-weight:bold">${esc(title)}</text>`)
  const legendW = series.length > 1 || (series[0] && series[0] !== '') ? 90 : 0
  const left = kind === 'pie' ? 10 : 48
  const plotW = Math.max(10, w - left - 10 - legendW)
  const plotH = Math.max(10, h - top - 34)
  if (kind === 'pie') {
    const total = pts.reduce((a, p) => a + Math.max(0, p.v), 0) || 1
    const cx = left + plotW / 2
    const cy = top + plotH / 2
    const rad = Math.min(plotW, plotH) / 2
    let ang = -Math.PI / 2
    cats.forEach((c, i) => {
      const v = pts.filter((p) => p.cat === c).reduce((a, p) => a + Math.max(0, p.v), 0)
      const a2 = ang + (v / total) * Math.PI * 2
      const large = a2 - ang > Math.PI ? 1 : 0
      parts.push(`<path d="M${cx},${cy} L${cx + rad * Math.cos(ang)},${cy + rad * Math.sin(ang)} A${rad},${rad} 0 ${large} 1 ${cx + rad * Math.cos(a2)},${cy + rad * Math.sin(a2)} Z" fill="${PALETTE[i % PALETTE.length]}" stroke="#fff"/>`)
      const mid = (ang + a2) / 2
      if (v / total > 0.04) parts.push(`<text x="${cx + rad * 0.65 * Math.cos(mid)}" y="${cy + rad * 0.65 * Math.sin(mid)}" text-anchor="middle" fill="#fff">${esc(c)}</text>`)
      ang = a2
    })
  } else {
    const max = Math.max(1, ...pts.map((p) => p.v)) * 1.05
    const min = Math.min(0, ...pts.map((p) => p.v))
    const range = max - min
    const y = (v: number) => top + plotH - ((v - min) / range) * plotH
    // grid and value axis
    for (let i = 0; i <= 5; i++) {
      const v = min + (range * i) / 5
      parts.push(`<line x1="${left}" y1="${y(v)}" x2="${left + plotW}" y2="${y(v)}" stroke="#d0d0d0"/><text x="${left - 4}" y="${y(v) + 3}" text-anchor="end">${esc(Number.isInteger(v) ? String(v) : v.toFixed(1))}</text>`)
    }
    parts.push(`<line x1="${left}" y1="${top}" x2="${left}" y2="${top + plotH}" stroke="#000"/><line x1="${left}" y1="${y(0)}" x2="${left + plotW}" y2="${y(0)}" stroke="#000"/>`)
    const slot = plotW / Math.max(1, cats.length)
    const horizontal = kind === 'bar'
    cats.forEach((c, ci) => {
      parts.push(`<text x="${left + slot * ci + slot / 2}" y="${top + plotH + 14}" text-anchor="middle">${esc(c.length > 14 ? c.slice(0, 13) + '…' : c)}</text>`)
      series.forEach((s, si) => {
        const p = pts.find((q) => q.cat === c && q.series === s)!
        const bw = (slot * 0.7) / Math.max(1, series.length)
        const x = left + slot * ci + slot * 0.15 + bw * si
        const col = PALETTE[si % PALETTE.length]
        if (kind === 'col' || horizontal) parts.push(`<rect x="${x}" y="${Math.min(y(p.v), y(0))}" width="${bw}" height="${Math.abs(y(p.v) - y(0))}" fill="${col}"/>`)
      })
    })
    if (kind === 'line' || kind === 'area' || kind === 'scatter') {
      series.forEach((s, si) => {
        const col = PALETTE[si % PALETTE.length]
        const xy = cats.map((c, ci) => [left + slot * ci + slot / 2, y(pts.find((q) => q.cat === c && q.series === s)!.v)])
        if (kind === 'area') parts.push(`<path d="M${xy[0]?.[0]},${y(0)} ${xy.map((p) => `L${p[0]},${p[1]}`).join(' ')} L${xy[xy.length - 1]?.[0]},${y(0)} Z" fill="${col}" fill-opacity=".45"/>`)
        if (kind !== 'scatter') parts.push(`<polyline points="${xy.map((p) => p.join(',')).join(' ')}" fill="none" stroke="${col}" stroke-width="2"/>`)
        for (const p of xy) parts.push(`<circle cx="${p[0]}" cy="${p[1]}" r="3" fill="${col}"/>`)
      })
    }
    const vl = (o['values.label'] || '').trim()
    const cl = (o['category.label'] || '').trim()
    if (cl) parts.push(`<text x="${left + plotW / 2}" y="${h - 4}" text-anchor="middle" style="font-weight:bold">${esc(cl)}</text>`)
    if (vl) parts.push(`<text transform="translate(10,${top + plotH / 2}) rotate(-90)" text-anchor="middle" style="font-weight:bold">${esc(vl)}</text>`)
  }
  if (legendW) {
    series.forEach((s, i) => parts.push(`<rect x="${w - legendW + 4}" y="${top + i * 16}" width="10" height="10" fill="${PALETTE[i % PALETTE.length]}"/><text x="${w - legendW + 18}" y="${top + i * 16 + 9}">${esc(s)}</text>`))
  }
  parts.push('</svg>')
  return parts.join('')
}
