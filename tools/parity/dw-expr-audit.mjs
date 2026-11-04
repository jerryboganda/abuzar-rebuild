import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { compileDw } from '../../web/src/dw/expr.ts'

const dir = process.argv[2]
const keys = new Set(['expression', 'visible', 'protect', 'color', 'background.color', 'font.face', 'format'])
const out = []
let total = 0
for (const f of readdirSync(dir).filter((x) => x.endsWith('.json.gz'))) {
  const bundle = JSON.parse(gunzipSync(readFileSync(join(dir, f))).toString('utf8'))
  for (const [dwName, dw] of Object.entries(bundle)) {
    for (const o of dw.objects || []) {
      for (const [k, v] of Object.entries(o)) {
        if (typeof v !== 'string' || !keys.has(k)) continue
        if (!/^[\d.\-+ ]+$/.test(v) && !/^(yes|no|true|false|\d+)$/i.test(v)) {
          total++
          try { compileDw(v) } catch (e) { out.push({ dw: dwName, obj: o.name, key: k, error: String(e.message).slice(0, 250), src: v.replace(/\s+/g, ' ').slice(0, 300) }) }
        }
      }
    }
    // table validation expressions
    for (const c of dw.table?.columns || []) {
      for (const k of ['validation', 'validationexpression']) {
        if (typeof c[k] === 'string' && c[k].trim()) {
          total++
          try { compileDw(c[k]) } catch (e) { out.push({ dw: dwName, obj: c.name, key: k, error: String(e.message).slice(0, 250), src: c[k].replace(/\s+/g, ' ').slice(0, 300) }) }
        }
      }
    }
  }
}
console.log('expressions checked', total, 'failures', out.length)
for (const x of out.slice(0, 60)) console.log(JSON.stringify(x))
