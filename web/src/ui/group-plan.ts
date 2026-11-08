/** Group breaks of a grouped grid: the group bands shown before and after each data row, and the item prefix they add. */
export interface GroupPlan {
  /** prefix[r] = display items (group bands and data rows) up to and including data row r (1-based; prefix[0] = 0) */
  prefix: number[]
  heads: Map<number, string[]>
  tails: Map<number, string[]>
}

type Level = { level: number; by: number[] }
type Row = { v: unknown[] }

/**
 * Same break rule as the Classic view: a group of level L spans consecutive rows that agree on the `by` columns of every
 * level up to L.  Only levels whose band the surface maps are shown.
 */
export function buildGroupPlan(levels: readonly Level[], rows: readonly Row[], bands: ReadonlySet<string>): GroupPlan {
  const same = (a: Row, b: Row, level: number) => levels.filter((item) => item.level <= level).flatMap((item) => item.by)
    .every((index) => a.v[index] === b.v[index] || a.v[index] !== null && b.v[index] !== null && String(a.v[index]) === String(b.v[index]))
  const plan: GroupPlan = { prefix: [0], heads: new Map(), tails: new Map() }
  for (let index = 0; index < rows.length; index++) {
    const heads = levels.filter((item) => bands.has(`header.${item.level}`) && (index === 0 || !same(rows[index - 1], rows[index], item.level)))
      .map((item) => `header.${item.level}`)
    const tails = [...levels].reverse().filter((item) => bands.has(`trailer.${item.level}`) && (index === rows.length - 1 || !same(rows[index], rows[index + 1], item.level)))
      .map((item) => `trailer.${item.level}`)
    if (heads.length) plan.heads.set(index + 1, heads)
    if (tails.length) plan.tails.set(index + 1, tails)
    plan.prefix.push(plan.prefix[index] + heads.length + 1 + tails.length)
  }
  return plan
}

/** The 0-based data row whose items contain the given display item (group bands count as items). */
export function rowAtItem(plan: GroupPlan | null, item: number): number {
  if (!plan) return item
  let low = 1, high = plan.prefix.length - 1
  while (low < high) {
    const middle = (low + high + 1) >> 1
    if (plan.prefix[middle - 1] <= item) low = middle
    else high = middle - 1
  }
  return Math.max(0, low - 1)
}
