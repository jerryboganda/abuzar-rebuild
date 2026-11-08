import { DATA_SURFACES } from './data-surfaces.ts'
import type { DataSurface } from './data-surfaces.ts'
import { DERIVED_DATA_SURFACES } from './derived-data-surfaces.ts'
import { ENTRY_WINDOW_SURFACES } from './window-surfaces.ts'
import type { EntryWindowSurface } from './window-surfaces.ts'
import { DERIVED_ENTRY_WINDOW_SURFACES } from './derived-entry-windows.ts'

// Reviewed (hand-authored) mappings always win over those derived from the recovered definitions by
// web/tools/derive-*.ts.  Both kinds are re-validated against the live definition before they are used.
const dataByName = new Map<string, DataSurface>()
for (const surface of DERIVED_DATA_SURFACES) dataByName.set(surface.name, surface)
for (const surface of DATA_SURFACES) dataByName.set(surface.name, surface)

export function dataSurfaceByName(name: string): DataSurface | undefined {
  return dataByName.get(name)
}

export const ALL_DATA_SURFACES: readonly DataSurface[] = [...dataByName.values()]

const handEntries = new Set(ENTRY_WINDOW_SURFACES.map((surface) => surface.name))
export const ALL_ENTRY_WINDOW_SURFACES: readonly EntryWindowSurface[] = [
  ...ENTRY_WINDOW_SURFACES,
  ...DERIVED_ENTRY_WINDOW_SURFACES.filter((surface) => !handEntries.has(surface.name)),
]

const entryByName = new Map(ALL_ENTRY_WINDOW_SURFACES.map((surface) => [surface.name, surface]))
export function entryWindowSurfaceByName(name: string): EntryWindowSurface | undefined {
  return entryByName.get(name)
}
