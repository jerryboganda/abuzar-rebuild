import { WINDOW_SURFACES, CALCULATOR_WINDOW_SURFACES, CALENDAR_WINDOW_SURFACES, CRITERIA_WINDOW_SURFACES } from './window-surfaces.ts'
import type { WindowSurface } from './window-surfaces.ts'
import { DERIVED_MODAL_WINDOW_SURFACES } from './derived-modal-windows.ts'

// Reviewed layouts win over those derived by web/tools/derive-modal-windows.ts; both are re-validated against the live window.
const reviewed = [...WINDOW_SURFACES, ...CALCULATOR_WINDOW_SURFACES, ...CALENDAR_WINDOW_SURFACES, ...CRITERIA_WINDOW_SURFACES]
const byName = new Map<string, WindowSurface>()
for (const surface of DERIVED_MODAL_WINDOW_SURFACES) byName.set(surface.name, surface)
for (const surface of reviewed) byName.set(surface.name, surface)

export function modalWindowSurfaceByName(name: string): WindowSurface | undefined {
  return byName.get(name)
}
