import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import type { DwDef } from '../src/dw/def.ts'
import { recoverObjectNames } from '../src/dw/def.ts'
import { dataSurfaceIssues } from '../src/ui/data-surfaces.ts'
import { LIST_WINDOW_SURFACES } from '../src/ui/list-window-surfaces.ts'

const root = new URL('../../data/src/dw/', import.meta.url)
const index: Record<string, string> = JSON.parse(readFileSync(new URL('_index.json', root), 'utf8'))
const definition = (name: string): DwDef => {
  const bundle = JSON.parse(gunzipSync(readFileSync(new URL(index[name] + '.json.gz', root))).toString('utf8')) as Record<string, DwDef>
  return recoverObjectNames(bundle[name])
}

test('list-window surfaces (Groups, patient visits) are valid for their DataWindow definitions', () => {
  assert.deepEqual(LIST_WINDOW_SURFACES.map((surface) => surface.name), ['d_grouplist', 'd_visit_list_userwise'])
  for (const surface of LIST_WINDOW_SURFACES) assert.deepEqual(dataSurfaceIssues(definition(surface.name), surface), [], surface.name)
})
