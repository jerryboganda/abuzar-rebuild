// Applies a few security rows to the main menu the way w_main does (m_entry.mf_initsecurityapp) and prints what becomes visible.
// usage: node tools/menu-check.ts <public/data dir>
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { createRuntime } from '../src/runtime/boot.ts'
import { JsonClassLoader } from '../src/runtime/loader.ts'
import type { PBObject } from '../src/runtime/object.ts'
import type { NDwBase } from '../src/runtime/native/dwctrl.ts'

const dataDir = process.argv[2]
const read = async (p: string): Promise<string | undefined> => {
  const f = join(dataDir, p)
  if (existsSync(f)) return readFileSync(f, 'utf8')
  if (existsSync(f + '.gz')) return gunzipSync(readFileSync(f + '.gz')).toString('utf8')
  return undefined
}
const names = JSON.parse((await read('names.json')) || '{}')
const loader = new JsonClassLoader((n) => read(`classes/${n}.json`))
const rt = await createRuntime({ loader, readData: read, sharedVars: names.sharedVars, globalTypes: names.globalTypes, ui: { async messageBox() { return 1 } } as never })
const errors: string[] = []
rt.onError = (e) => errors.push((e as Error).message)
const caught: string[] = []
rt.onCaught = (e) => caught.push(((e as Error).message || String(e)).slice(0, 100) + ' @' + ((e as { where?: string }).where ?? ''))
const menu = (await rt.instantiate('m_entry', null)) as PBObject
const ds = (await rt.instantiate('datastore')) as NDwBase
ds.setNative('dataobject', 'd_security')
await ds.ready
const rows = [
  [1, 1, '2,', 'A', 1, 'Purchase'],
  [2, 2, '2,1,', 'A', 1, 'Purchase , Purchase Order'],
  [3, 1, '3,', 'A', 0, 'Sales'],
]
for (const r of rows) {
  const n = ds.model!.insertRow(0)
  ;['rightcode', 'levelindex', 'indicesstring', 'object', 'status', 'rightname'].forEach((c, i) => ds.model!.setItem(n, c, r[i]))
}
rt.globals.set('gds_security', ds)
rt.globals.set('gl_securityrowcount', rows.length)
const withStock: string[] = []
const walkStock = (m: PBObject, depth: number) => {
  for (const it of m.children.values()) {
    const n = it.props.get('toolbaritemname')
    if (typeof n === 'string' && n) withStock.push(`${it.name}:${n}:${String(it.props.get('visible'))}`)
    walkStock(it, depth + 1)
  }
}
walkStock(menu, 0)
console.log('items with a toolbar picture:', withStock.length, withStock.slice(0, 8))
const before = [...menu.children.values()].map((i) => i.props.get('visible'))
const ret = await rt.callMethod(menu, 'mf_initsecurityapp', [menu])
const after = [...menu.children.values()].map((i) => i.props.get('visible'))
console.log('returned', ret, 'errors', errors.slice(0, 3), 'caught by scripts', caught.length, caught.slice(0, 4))
console.log('top-level visible before', JSON.stringify(before))
console.log('top-level visible after ', JSON.stringify(after))
const find = await rt.callMethod(menu, 'mf_findindex', [2, '5,12,'])
console.log('mf_findindex(2, "5,12,") =', find)
console.log('mf_findindex(1, "2,") =', await rt.callMethod(menu, 'mf_findindex', [1, '2,']), ' (3,14,) idx 2 =', await rt.callMethod(menu, 'mf_findindex', [2, '3,14,']))
setTimeout(() => process.exit(0), 100)
