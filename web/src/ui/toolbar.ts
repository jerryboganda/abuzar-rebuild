// MDI frame toolbar: the menu items that carry a toolbar picture (`toolbaritemname`) become buttons, in menu order.  The original draws
// its stock pictures ("Save!", "VCRNext!" ...) from the PowerBuilder runtime; here every stock name has a glyph, unknown names show the
// first letters of the item text.
import { ICON_NAMES } from './toolbar-icons.ts'
const GLYPH: Record<string, string> = {
  save: '\u{1F4BE}', saveas: '\u{1F4E4}', print: '\u{1F5A8}', preview: '\u{1F441}', find: '\u{1F50D}', clear: '✖', update: '⟳', retrieve: '⬇',
  sort: '⇅', vcrfirst: '⏮', vcrprior: '◀', vcrnext: '▶', vcrlast: '⏭', undo: '↶', run: '▶', query: '?', exit: '\u{1F6AA}',
  dbadmin: '\u{1F6E0}', selectscript: '\u{1F4DC}', move: '↔', regenerate5: '⟳', report: '\u{1F4CA}', report5: '\u{1F4CA}', graph: '\u{1F4C8}',
  crosstab: '▦', checkin5: '⬆', checkout5: '⬇', delete: '\u{1F5D1}', insert: '➕', new: '➕',
}

export interface ToolButton {
  name: string
  stock: string
  glyph: string
  text: string
  enabled: boolean
  space: boolean
}

/** column of a stock picture in the sprite (toolbar-icons.ts, cut from the original's own toolbar); null = not captured */
export function iconPos(stock: string): number | null {
  const i = ICON_NAMES.indexOf(stock.replace(/!$/, '').toLowerCase())
  return i < 0 ? null : i
}

export function glyphFor(stock: string, text: string): string {
  const key = stock.replace(/!$/, '').toLowerCase()
  return GLYPH[key] ?? (text.trim().slice(0, 2).toUpperCase() || key.slice(0, 2).toUpperCase() || '□')
}

interface MenuLike {
  name: string
  props: Map<string, unknown>
  children: Map<string, MenuLike>
}

/** the toolbar buttons of a menu tree, depth first in menu order */
export function toolbarItems(menu: MenuLike): { item: MenuLike; button: ToolButton }[] {
  const out: { item: MenuLike; button: ToolButton }[] = []
  const str = (o: MenuLike, k: string): string => {
    const v = o.props.get(k)
    return typeof v === 'string' ? v : ''
  }
  const walk = (m: MenuLike, visible: boolean) => {
    for (const it of m.children.values()) {
      const shown = visible && it.props.get('visible') !== false
      const stock = str(it, 'toolbaritemname')
      if (shown && stock && it.props.get('toolbaritemvisible') !== false && !it.children.size) {
        const text = str(it, 'toolbaritemtext') || str(it, 'text').replace(/&/g, '').replace(/\.\.\.$/, '')
        out.push({ item: it, button: { name: it.name, stock, glyph: glyphFor(stock, text), text, enabled: it.props.get('enabled') !== false, space: Number(it.props.get('toolbaritemspace') ?? 0) > 0 } })
      }
      walk(it, shown)
    }
  }
  walk(menu, true)
  // the toolbar follows `toolbaritemorder` (the items of a sheet's menu are not in toolbar order), `toolbaritembarindex` picks the bar
  const key = (x: { item: MenuLike }) => [Number(x.item.props.get('toolbaritembarindex') ?? 0), Number(x.item.props.get('toolbaritemorder') ?? 0)]
  return out.map((x, i) => ({ x, i })).sort((a, b) => key(a.x)[0] - key(b.x)[0] || key(a.x)[1] - key(b.x)[1] || a.i - b.i).map((e) => e.x)
}
