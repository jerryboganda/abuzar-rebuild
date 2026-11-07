import type { Expr, ScriptFile } from '../src/pbscript/ast.ts'

export interface UiCatalog {
  windows: ReadonlySet<string>
  datawindows: ReadonlySet<string>
}

export interface UiScriptSite {
  owner: string
  routine: string
  routineLine: number
  astPath: string
  kind: 'window-open' | 'dataobject-assignment' | 'presentation-assignment' | 'layout-call' | 'focus-call' | 'output-call' | 'message-parameter'
  operation: string
  receiver: string | null
  receiverType?: string | null
  target?: string | null
  targetBasis?: 'literal' | 'declared-type' | 'class-reference' | 'cleared' | 'unresolved'
  withParameter?: boolean
}

const WINDOW_CALLS = new Set(['open', 'openwithparm', 'opensheet', 'opensheetwithparm'])
const PRESENTATION_PROPERTIES = new Set(['visible', 'enabled', 'protect', 'taborder', 'tabsequence', 'text', 'title', 'menuname', 'x', 'y', 'width', 'height'])
const LAYOUT_CALLS = new Set(['modify', 'move', 'resize', 'show', 'hide', 'setposition', 'setredraw', 'changemenu', 'settaborder'])
const FOCUS_CALLS = new Set(['setfocus', 'selecttext', 'selecttab', 'setcolumn', 'setrow', 'scrolltorow'])
const OUTPUT_CALLS = new Set(['print', 'printopen', 'printclose', 'printdatawindow', 'printsend', 'saveas'])
const MESSAGE_PARAMETERS = new Set(['message.stringparm', 'message.doubleparm', 'message.powerobjectparm'])
const identifier = (value: string) => /^[a-z_][a-z_0-9]*$/i.test(value)

/** Symbolic paths only: never serialize array indexes, string values or SQL. */
function symbol(expression: Expr | null): string | null {
  if (!expression) return null
  if (expression.k === 'id' || expression.k === 'global') return identifier(expression.n) ? expression.n : null
  if (expression.k === 'mem') {
    const parent = symbol(expression.o)
    return parent && identifier(expression.n) ? `${parent}.${expression.n}` : null
  }
  if (expression.k === 'idx') {
    const parent = symbol(expression.o)
    return parent ? parent + '[]' : null
  }
  return null
}

function literalString(expression: Expr): string | null {
  if (expression.k === 'str') return expression.v
  if (expression.k === 'bin' && expression.op === '+') {
    const left = literalString(expression.l)
    const right = literalString(expression.r)
    if (left !== null && right !== null) return left + right
  }
  return null
}

function windowTarget(call: Extract<Expr, { k: 'call' }>, types: ReadonlyMap<string, string>, catalog: UiCatalog): Pick<UiScriptSite, 'target' | 'targetBasis' | 'withParameter'> {
  const withParameter = call.n.endsWith('withparm')
  let explicit: string | null = null
  let uncertain = false
  // Match openWin's argument scan: the parameter is not a class name, and the
  // last string after it wins. Unknown expressions may be strings at runtime.
  for (const argument of call.a.slice(withParameter ? 2 : 1)) {
    const text = literalString(argument)
    if (text !== null) {
      if (!text.endsWith('!')) { explicit = text.toLowerCase(); uncertain = false }
      continue
    }
    if (argument.k === 'num' || argument.k === 'enum') continue
    const path = symbol(argument)
    const type = path ? types.get(path) : undefined
    if (path && (catalog.windows.has(path) || type === 'window' || (type && catalog.windows.has(type)))) continue
    uncertain = true
  }
  if (uncertain) return { target: null, targetBasis: 'unresolved', withParameter }
  if (explicit !== null && explicit !== '') {
    return { target: catalog.windows.has(explicit) ? explicit : null, targetBasis: catalog.windows.has(explicit) ? 'literal' : 'unresolved', withParameter }
  }
  const reference = symbol(call.a[0])
  const type = reference ? types.get(reference) : undefined
  if (type && catalog.windows.has(type)) return { target: type, targetBasis: 'declared-type', withParameter }
  if (reference && catalog.windows.has(reference)) return { target: reference, targetBasis: 'class-reference', withParameter }
  return { target: null, targetBasis: 'unresolved', withParameter }
}

export function analyzeUiScript(file: ScriptFile, catalog: UiCatalog): UiScriptSite[] {
  const result: UiScriptSite[] = []
  for (const routine of file.routines) {
    const types = new Map([...routine.locals, ...routine.params].map((local) => [local.n, local.t]))
    const add = (path: string, site: Omit<UiScriptSite, 'owner' | 'routine' | 'routineLine' | 'astPath'>) => {
      result.push({
        owner: routine.owner, routine: routine.name, routineLine: routine.line, astPath: path,
        ...site, receiverType: site.receiver ? types.get(site.receiver) ?? null : null,
      })
    }
    const expression = (node: Expr, path: string): void => {
      switch (node.k) {
        case 'call': {
          if (WINDOW_CALLS.has(node.n) && node.o === null && node.a.length) {
            add(path, { kind: 'window-open', operation: node.n, receiver: symbol(node.a[0]), ...windowTarget(node, types, catalog) })
          } else {
            const kind = LAYOUT_CALLS.has(node.n) ? 'layout-call' : FOCUS_CALLS.has(node.n) ? 'focus-call' : OUTPUT_CALLS.has(node.n) ? 'output-call' : null
            if (kind) add(path, { kind, operation: node.n, receiver: symbol(node.o) })
          }
          break
        }
        case 'mem': {
          const reference = symbol(node)
          if (reference && MESSAGE_PARAMETERS.has(reference)) add(path, { kind: 'message-parameter', operation: node.n, receiver: 'message' })
          break
        }
      }
    }
    function walk(value: unknown, path: string): void {
      if (Array.isArray(value)) { value.forEach((child, index) => walk(child, `${path}[${index}]`)); return }
      if (!value || typeof value !== 'object') return
      // The tree is produced by parseScriptFile; this visitor retains only
      // explicitly selected AST fields, never arbitrary values from the tree.
      if ('k' in value && value.k === 'sql') return
      if ('k' in value && value.k === 'assign' && 'l' in value && 'r' in value) {
        const left = value.l as Expr
        const right = value.r as Expr
        if (left.k === 'mem' && (left.n === 'dataobject' || PRESENTATION_PROPERTIES.has(left.n))) {
          const literal = literalString(right)?.toLowerCase()
          add(path, {
            kind: left.n === 'dataobject' ? 'dataobject-assignment' : 'presentation-assignment',
            operation: left.n, receiver: symbol(left.o),
            ...(left.n === 'dataobject' ? {
              target: literal && catalog.datawindows.has(literal) ? literal : null,
              targetBasis: literal === '' ? 'cleared' as const : literal && catalog.datawindows.has(literal) ? 'literal' as const : 'unresolved' as const,
            } : {}),
          })
        }
      }
      if ('k' in value && (value.k === 'call' || value.k === 'mem')) expression(value as Expr, path)
      for (const [key, child] of Object.entries(value)) walk(child, path ? `${path}.${key}` : key)
    }
    walk(routine.body, 'body')
  }
  return result
}
