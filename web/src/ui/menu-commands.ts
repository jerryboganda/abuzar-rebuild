import { PBObject } from '../runtime/object.ts'
import type { Runtime } from '../runtime/interp.ts'

export interface MenuCommand {
  label: string
  path: PBObject[]
}

const available = (item: PBObject) => !item.destroyed && item.props.get('visible') !== false && item.props.get('enabled') !== false
const caption = (item: PBObject) => String(item.props.get('text') ?? '').split(/<TAB>|\t/)[0].replace(/&&/g, '\0').replace(/&/g, '').replace(/\0/g, '&').trim()

export function menuCommands(root: PBObject): MenuCommand[] {
  const result: MenuCommand[] = []
  function visit(parent: PBObject, path: PBObject[], labels: string[]): void {
    if (!available(parent)) return
    for (const item of parent.children.values()) {
      if (!available(item)) continue
      const label = caption(item)
      if (!label || label === '-') continue
      const next = [...path, item]
      const names = [...labels, label]
      if (item.children.size) visit(item, next, names)
      else result.push({ label: names.join(' / '), path: next })
    }
  }
  visit(root, [], [])
  return result
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
