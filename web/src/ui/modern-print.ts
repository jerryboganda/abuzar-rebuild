// Modern document presentation.  This renderer reuses the characterized
// DataWindow layout, band heights and pagination from DwView; it changes only
// print typography and structural rules.  It never reads the screen theme.
import type { NDwBase } from '../runtime/native/dwctrl.ts'
import type { DwModel } from '../dw/model.ts'
import type { DwObject } from '../dw/def.ts'
import { DwView } from './dwview.ts'

/** Print-only white-paper rules.  No dark workspace tokens reach this stylesheet. */
export const MODERN_PRINT_CSS = `
.print-modern {
  --print-ink:#111827;--print-muted:#4b5563;--print-rule:#c7d0da;--print-strong:#6b7785;
  background:#fff!important;color:var(--print-ink);
  font-family:"Segoe UI",Tahoma,Arial,sans-serif;
  -webkit-print-color-adjust:exact;print-color-adjust:exact;
}
.print-modern .print-band { break-inside:avoid; }
/* Overlay rules cannot shift field origins or expand source zero-height bands. */
.print-modern .print-band::before,
.print-modern .print-band::after { content:"";position:absolute;left:0;right:0;pointer-events:none; }
.print-modern .print-band::before { top:0; }
.print-modern .print-band::after { bottom:0; }
.print-modern .print-band-header::after,
.print-modern .print-band-hdr::after,
.print-modern .print-band-ghdr::after { border-bottom:1.5px solid var(--print-rule); }
.print-modern .print-band-row::after { border-bottom:1px solid #e5e9ee; }
.print-modern .print-band-gtr::before,
.print-modern .print-band-sum::before,
.print-modern .print-band-ftr::before { border-top:1.5px solid var(--print-strong); }
.print-modern .print-band-ghdr::before { border-top:1px solid var(--print-rule); }
.print-modern .print-object { text-rendering:geometricPrecision; }
.print-modern .print-object.print-number,
.print-modern .print-object.print-number-right { font-variant-numeric:tabular-nums; }
.print-modern .print-heading { color:var(--print-ink); }
.print-modern .o-text { color:var(--print-ink); }
.print-modern .o-line { opacity:.8; }
.print-modern .placeholder { color:var(--print-muted); }
@media print {
  .print-modern { box-shadow:none!important; }
  .print-modern .print-band { break-inside:avoid; }
}
`

/**
 * A print view that preserves every geometry, band and value decision of the
 * Classic renderer while marking the output for the Modern print stylesheet.
 * It deliberately does not alter row/column identity or pagination state.
 */
export class ModernPrintView extends DwView {
  constructor(control: NDwBase, host: HTMLElement, interactive = false) {
    super(control, host, interactive)
  }

  override async makeBand(
    model: DwModel,
    layout: ReturnType<DwView['layout']>,
    band: string,
    row: number,
    cls: string,
  ): Promise<HTMLElement> {
    const element = await super.makeBand(model, layout, band, row, cls)
    element.classList.add('print-band', `print-band-${band.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`,
      `print-band-${cls.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`)
    if (cls === 'row') element.classList.add(row % 2 ? 'print-row-odd' : 'print-row-even')
    return element
  }

  protected override async object(
    model: DwModel,
    object: DwObject,
    row: number,
    band: string,
    sx: (value: number) => number,
    sy: (value: number) => number,
    context: unknown,
  ): Promise<HTMLElement | null> {
    const element = await super.object(model, object, row, band, sx, sy, context)
    if (!element) return null
    element.classList.add('print-object', `print-type-${object.type}`)
    element.dataset.printType = object.type
    element.dataset.printBand = band
    if (object.type === 'column' || object.type === 'compute') {
      element.classList.add('print-number')
      if (element.style.textAlign === 'right') element.classList.add('print-number-right')
    }
    if (object.type === 'text' && (band.startsWith('header') || band === 'footer')) {
      element.classList.add('print-heading')
    }
    return element
  }
}
