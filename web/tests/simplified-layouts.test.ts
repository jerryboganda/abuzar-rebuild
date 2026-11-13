// Approved simplified layouts must stay tied to real recovered fields: a renamed or dropped field would silently turn a primary
// field into a hidden one.  The exception list is closed: any new entry needs a recorded user approval in docs/HANDOFF.md.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { SIMPLIFIED_LAYOUTS } from '../src/ui/simplified-layouts.ts'
import { DERIVED_ENTRY_WINDOW_SURFACES } from '../src/ui/derived-entry-windows.ts'

// the window each approved layout belongs to
const WINDOW: Record<string, string> = { d_normalpurchasedetail: 'w_purchase', d_normalpurchaseheader: 'w_purchase', d_purchasefooter: 'w_purchase', d_salefooter2: 'w_sale' }

test('only the approved Pack Purchase and Cash Sale surfaces are simplified', () => {
  assert.deepEqual(SIMPLIFIED_LAYOUTS.map((layout) => layout.surface).sort(), Object.keys(WINDOW).sort())
  const handoff = readFileSync(resolve(import.meta.dirname, '../../docs/HANDOFF.md'), 'utf8')
  for (const layout of SIMPLIFIED_LAYOUTS) assert.ok(handoff.includes(layout.surface), `${layout.surface} is recorded in HANDOFF.md`)
})

test('every primary field exists on its surface and has the same kind', () => {
  for (const layout of SIMPLIFIED_LAYOUTS) {
    const window = DERIVED_ENTRY_WINDOW_SURFACES.find((item) => item.name === WINDOW[layout.surface])
    const surface = window?.details.find((binding) => binding.surface?.name === layout.surface)?.surface
    assert.ok(surface, `${layout.surface} is a ${WINDOW[layout.surface]} surface`)
    assert.equal(surface.kind, layout.kind, layout.surface)
    const fields = new Set(surface.fields.map((field) => field.object))
    for (const name of layout.primary) assert.ok(fields.has(name), `${layout.surface}.${name}`)
    if (layout.emphasis) assert.ok(layout.primary.includes(layout.emphasis), `${layout.surface} emphasis is primary`)
  }
})
