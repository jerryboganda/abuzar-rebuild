import { PBObject } from '../runtime/object.ts'
import type { Runtime } from '../runtime/interp.ts'

export interface MenuCommand {
  label: string
  path: PBObject[]
  /** shown greyed, as the menu bar shows it; never executed */
  disabled?: boolean
  /** the menu item's check mark */
  checked?: boolean
  /** the accelerator text the menu bar shows after the caption */
  shortcut?: string
}

const shown = (item: PBObject) => !item.destroyed && item.props.get('visible') !== false
const available = (item: PBObject) => shown(item) && item.props.get('enabled') !== false
const text = (item: PBObject) => String(item.props.get('text') ?? '')
const caption = (item: PBObject) => text(item).split(/<TAB>|\t/)[0].replace(/&&/g, '\0').replace(/&/g, '').replace(/\0/g, '&').trim()
const shortcutText = (item: PBObject) => (text(item).split(/<TAB>|\t/)[1] ?? '').trim()

/** The top-level items in menu-bar order: a sheet's own `Item` menu comes right after File, as the Classic menu bar shows it. */
export function menuBarOrder(menu: PBObject): PBObject[] {
  const tops = [...menu.children.values()]
  const own = tops.findIndex((item) => item.name === 'm_item')
  if (own > 1) tops.splice(1, 0, ...tops.splice(own, 1))
  return tops
}

/**
 * The leaf commands of a menu.  By default only the commands that can run; with `includeDisabled`, also the visible items that are
 * disabled themselves (shown greyed, as on the menu bar).  A disabled submenu cannot be opened, so its items are not listed.
 */
export function menuCommands(root: PBObject, options: { includeDisabled?: boolean } = {}): MenuCommand[] {
  const result: MenuCommand[] = []
  function visit(parent: PBObject, path: PBObject[], labels: string[]): void {
    if (!available(parent)) return
    for (const item of parent === root ? menuBarOrder(root) : parent.children.values()) {
      if (!shown(item)) continue
      const label = caption(item)
      if (!label || label === '-') continue
      const next = [...path, item]
      const names = [...labels, label]
      const enabled = available(item)
      if (item.children.size) { if (enabled) visit(item, next, names) }
      else if (enabled || options.includeDisabled) {
        const shortcut = shortcutText(item)
        result.push({ label: names.join(' / '), path: next, ...(enabled ? {} : { disabled: true }),
          ...(item.props.get('checked') === true ? { checked: true } : {}), ...(shortcut ? { shortcut } : {}) })
      }
    }
  }
  visit(root, [], [])
  return result
}

export interface MenuModule {
  /** top-level menu caption (the module) */
  label: string
  commands: { label: string; command: MenuCommand }[]
}

/**
 * Group the available commands by their top-level menu so the workspace can be browsed, not only searched.
 * Group order and item order follow the live menu; labels below the module drop its caption.
 */
export function menuModules(commands: readonly MenuCommand[]): MenuModule[] {
  const modules = new Map<string, MenuModule>()
  for (const command of commands) {
    const [module, ...rest] = command.label.split(' / ')
    const entry = modules.get(module) ?? { label: module, commands: [] }
    entry.commands.push({ label: rest.join(' / ') || module, command })
    modules.set(module, entry)
  }
  return [...modules.values()]
}

/** Recheck the live tree after Selected handlers; search results never grant permission. */
export async function executeMenuCommand(rt: Runtime, root: PBObject, command: MenuCommand): Promise<boolean> {
  const valid = () => {
    let parent = root
    if (!available(parent)) return false
    for (const item of command.path) {
      if (![...parent.children.values()].includes(item) || !available(item)) return false
      parent = item
    }
    return command.path.length > 0 && parent.children.size === 0
  }
  if (!valid()) return false
  for (const item of command.path) {
    await rt.fire(item, 'selected')
    if (!valid()) return false
  }
  await rt.fire(command.path[command.path.length - 1], 'clicked')
  await rt.flushPosted()
  return true
}
