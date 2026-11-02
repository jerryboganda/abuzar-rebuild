// Lists the toolbar buttons (stock picture name, caption, space before) of every menu class, to match the pictures of the original's toolbar
// (docs/observed/toolbar-icons.json) to the names the scripts use.
// usage: node tools/toolbar-dump.ts <public/data dir> <out.json>
import { readFileSync, existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { createRuntime } from '../src/runtime/boot.ts'
import { JsonClassLoader } from '../src/runtime/loader.ts'
import type { PBObject } from '../src/runtime/object.ts'

const [dataDir, out] = process.argv.slice(2)
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
const index = JSON.parse((await read('classes/_index.json')) || '{}') as Record<string, unknown>
const result: Record<string, unknown[]> = {}
const str = (o: PBObject, k: string): string => (typeof o.props.get(k) === 'string' ? (o.props.get(k) as string) : '')
for (const cls of Object.keys(index).filter((n) => n.startsWith('m_')).sort()) {
  try {
    const m = (await rt.instantiate(cls, null)) as PBObject
    const items: unknown[] = []
    const walk = (x: PBObject) => {
      for (const it of x.children.values()) {
        const stock = str(it, 'toolbaritemname')
        if (stock) items.push({ stock, text: str(it, 'toolbaritemtext') || str(it, 'text').replace(/&/g, ''), vis: it.props.get('toolbaritemvisible') !== false && it.props.get('visible') !== false, space: Number(it.props.get('toolbaritemspace') ?? 0), order: Number(it.props.get('toolbaritemorder') ?? 0), bar: Number(it.props.get('toolbaritembarindex') ?? 0), name: it.name, en: it.props.get('enabled') !== false })
        walk(it)
      }
    }
    walk(m)
    if (items.length) result[cls] = items
  } catch {
    // classes that need a window as parent
  }
}
writeFileSync(out, JSON.stringify(result, null, 1))
console.log(`menus with toolbar items: ${Object.keys(result).length}`)
setTimeout(() => process.exit(0), 100)
