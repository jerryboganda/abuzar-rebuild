import test from 'node:test'
import assert from 'node:assert/strict'
import { planLines, formLinePlan } from '../src/ui/line-plan.ts'
import { ALL_DATA_SURFACES } from '../src/ui/surface-registry.ts'
import { loadDefinitions } from '../tools/derive-data-surfaces.ts'

const box = (key: string, left: number, right: number, top: number, bottom: number) => ({ key, left, right, top, bottom })

test('two fields that share a row stay on one line with their source proportion', () => {
  const lines = planLines([box('a', 0, 500, 0, 60), box('b', 520, 1020, 5, 65), box('c', 0, 1020, 120, 180)])
  assert.deepEqual(lines, [[{ key: 'a', weight: 500 }, { key: 'b', weight: 500 }], [{ key: 'c', weight: 1020 }]])
})

test('a wide field beside a narrow one keeps the proportion; cells are ordered left to right', () => {
  const [line] = planLines([box('narrow', 700, 900, 0, 60), box('wide', 0, 600, 0, 60)])
  assert.deepEqual(line.map((cell) => cell.key), ['wide', 'narrow'])
  assert.ok(line[0].weight / line[1].weight === 3)
})

test('stacked fields do not share a line', () => {
  assert.equal(planLines([box('a', 0, 500, 0, 60), box('b', 0, 500, 70, 130)]).length, 2)
})

test('every generated and reviewed form plans every visible field exactly once', () => {
  const definitions = loadDefinitions()
  let forms = 0
  let sideBySide = 0
  for (const surface of ALL_DATA_SURFACES) {
    const def = definitions.get(surface.name)
    if (!def || surface.kind !== 'form') continue
    forms++
    const plan = formLinePlan(def, surface)
    const planned = new Set(plan.keys())
    for (const field of surface.fields) {
      const object = def.objects.find((item) => item.name.toLowerCase() === field.object.toLowerCase())
      if (object && object.visible !== '0') assert.ok(planned.has(field.object), `${surface.name}.${field.object} is planned`)
    }
    const perLine = new Map<number, number>()
    for (const { line } of plan.values()) perLine.set(line, (perLine.get(line) ?? 0) + 1)
    if ([...perLine.values()].some((count) => count > 1)) sideBySide++
  }
  assert.ok(forms > 100, `forms checked: ${forms}`)
  console.log(`forms checked: ${forms}; forms with fields sharing a row: ${sideBySide}`)
})

// Forms whose source tab order is not row-major cannot be wrapped into lines without reordering the DOM (and so the tab order).
// They keep one field per line until a placement-based arrangement exists; the list is pinned so any new case fails loudly.
const NON_ROW_MAJOR = ['d_mr_patientdischarge', 'd_old_general1', 'd_opensalereturnfooter', 'd_patientvisit_obs_us', 'd_salepreferences', 'd_salereturnfooter_view', 'd_servicefooter_view', 'd_visitvitals']

test('only the known forms have a source order that interleaves lines', () => {
  const definitions = loadDefinitions()
  const found: string[] = []
  for (const surface of ALL_DATA_SURFACES) {
    const def = definitions.get(surface.name)
    if (!def || surface.kind !== 'form') continue
    const plan = formLinePlan(def, surface)
    const seen = new Set<number>()
    let last = -1
    for (const { line } of surface.fields.flatMap((field) => plan.get(field.object) ?? [])) {
      if (line !== last) {
        if (seen.has(line)) { found.push(surface.name); break }
        seen.add(line)
        last = line
      }
    }
  }
  assert.deepEqual(found.sort(), NON_ROW_MAJOR)
})
