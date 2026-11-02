// Menu parity against the original: applies the rights of db/pg/96_rights_profile.sql to the main menu the way w_main does
// (m_entry.mf_initsecurityapp) and compares the visible tree with the one read from the running original (docs/observed/original-menu-frame.tsv).
// usage: node tools/menu-parity.ts <public/data dir> <observed.tsv> <96_rights_profile.sql>
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { createRuntime } from '../src/runtime/boot.ts'
import { JsonClassLoader } from '../src/runtime/loader.ts'
import type { PBObject } from '../src/runtime/object.ts'
import type { NDwBase } from '../src/runtime/native/dwctrl.ts'

const [dataDir, observed, profile] = process.argv.slice(2)
const read = async (p: string): Promise<string | undefined> => {
  const f = join(dataDir, p)
  if (existsSync(f)) return readFileSync(f, 'utf8')
  if (existsSync(f + '.gz')) return gunzipSync(readFileSync(f + '.gz')).toString('utf8')
  return undefined
}
const names = JSON.parse((await read('names.json')) || '{}')
const loader = new JsonClassLoader((n) => read(`classes/${n}.json`))
const rt = await createRuntime({ loader, readData: read, sharedVars: names.sharedVars, globalTypes: names.globalTypes, ui: { async messageBox() { return 1 } } as never })
rt.onError = () => {}
const menu = (await rt.instantiate('m_entry', null)) as PBObject
const ds = (await rt.instantiate('datastore')) as NDwBase
ds.setNative('dataobject', 'd_security')
await ds.ready

const indices = [...readFileSync(profile, 'utf8').matchAll(/'(\d+(?:,\d+)*,)'/g)].map((m) => m[1])
indices.forEach((ix, i) => {
  const n = ds.model!.insertRow(0)
  ;['rightcode', 'levelindex', 'indicesstring', 'object', 'status', 'rightname'].forEach((c, k) => ds.model!.setItem(n, c, [i + 1, ix.split(',').length - 1, ix, 'A', 1, ix][k]))
})
rt.globals.set('gds_security', ds)
rt.globals.set('gl_securityrowcount', indices.length)
await rt.callMethod(menu, 'mf_initsecurityapp', [menu])

const clean = (s: unknown): string => String(s ?? '').replace(/<TAB>/g, ' ').replace(/&/g, '').replace(/\s+/g, ' ').trim()
const ours: string[] = []
const walk = (m: PBObject, path: string[]) => {
  for (const it of m.children.values()) {
    const t = clean(it.props.get('text'))
    if (it.props.get('visible') === false) continue
    const p = [...path, t === '-' ? '----' : t]
    ours.push(p.join(' | '))
    walk(it, p)
  }
}
walk(menu, [])
const theirs = readFileSync(observed, 'utf8').replace(/^﻿/, '').split(/\r?\n/).filter(Boolean).map((l) => clean(l.split('\t')[3]).replace(/ \| /g, ' | ')).map((s) => s.replace(/\s*\|\s*/g, ' | '))
const norm = (s: string) => s.toLowerCase()
const oSet = new Set(ours.map(norm))
const tSet = new Set(theirs.map(norm))
const onlyTheirs = theirs.filter((s) => !oSet.has(norm(s)) && !s.endsWith('----'))
const onlyOurs = ours.filter((s) => !tSet.has(norm(s)) && !s.endsWith('----'))
const seps = (a: string[]) => a.filter((s) => s.endsWith('----')).length
console.log(`original menu items ${theirs.length} (separators ${seps(theirs)}), rebuild visible ${ours.length} (separators ${seps(ours)})`)
console.log(`missing in rebuild ${onlyTheirs.length}, extra in rebuild ${onlyOurs.length}`)
for (const s of onlyTheirs.slice(0, 25)) console.log('  missing:', s)
for (const s of onlyOurs.slice(0, 25)) console.log('  extra:  ', s)
setTimeout(() => process.exit(0), 100)
