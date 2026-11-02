// Rights of the menu items: the original database held one `rights` row per menu item of the main menu (m_entry) - rows 1..240 were part
// of the pre-built database, later ones came with the migration scripts (db/pg/90_seed.sql).  The main window shows a menu item only when a
// row tells it to (`indicesstring` = the position of the item in its menu, e.g. `6,30,`), so the missing rows are generated from the menu.
// usage: node tools/gen-rights.ts <public/data dir> <out sql>
import { readFileSync, existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { createRuntime } from '../src/runtime/boot.ts'
import { JsonClassLoader } from '../src/runtime/loader.ts'
import type { PBObject } from '../src/runtime/object.ts'

const dataDir = process.argv[2]
const out = process.argv[3]
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

const clean = (s: unknown): string => String(s ?? '').replace(/&/g, '').replace(/\s+/g, ' ').trim()
const rows: { name: string; menu: string; level: number; indices: string }[] = []
const walk = (m: PBObject, path: string[], idx: number[]) => {
  let i = 0
  for (const it of m.children.values()) {
    i++
    const text = clean(it.props.get('text'))
    if (!text || text === '-') continue
    const p = [...path, text]
    const ix = [...idx, i]
    rows.push({ name: p.join(' , '), menu: text, level: ix.length, indices: ix.join(',') + ',' })
    walk(it, p, ix)
  }
}
walk(menu, [], [])
const lit = (s: string) => "'" + s.replace(/'/g, "''") + "'"
const values = rows.map((r) => `    (${lit(r.name)}, ${lit(r.menu)}, ${r.level}, ${lit(r.indices)})`).join(',\n')
writeFileSync(
  out,
  `-- Rights of the menu items of the main menu that the seed does not define, generated from the menu (web/tools/gen-rights.ts, ${rows.length} items).
-- The main window shows a menu item only when a row names its position (\`indicesstring\`).  Existing rows are kept.
DO $rights$
DECLARE
  r record;
  code integer := (SELECT coalesce(max(rightcode), 0) FROM dbo.rights);
BEGIN
  FOR r IN SELECT * FROM (VALUES
${values}
  ) AS v(rightname, menuname, levelindex, indicesstring)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM dbo.rights WHERE indicesstring = r.indicesstring AND object = 'A') THEN
      code := code + 1;
      INSERT INTO dbo.rights (rightcode, rightname, menuname, levelindex, indicesstring, object, rightcatcode) VALUES (code, r.rightname, r.menuname, r.levelindex, r.indicesstring, 'A', 1);
    END IF;
  END LOOP;
END
$rights$;
`,
)
console.log(`menu items: ${rows.length}; deepest level ${Math.max(...rows.map((r) => r.level))}; written to ${out}`)
setTimeout(() => process.exit(0), 100)
