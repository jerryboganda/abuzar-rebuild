import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { virtualKey } from '../src/ui/keys.ts'

const root = resolve(import.meta.dirname, '..', '..', 'data', 'src', 'scripts')

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const file = join(dir, entry)
    if (statSync(file).isDirectory()) out.push(...sourceFiles(file))
    else if (file.endsWith('.pbs')) out.push(file)
  }
  return out
}

const shortcuts: { file: string; line: number; code: number }[] = []
for (const file of sourceFiles(root)) {
  const lines = readFileSync(file, 'utf8').split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const match = /this\.shortcut\s*=\s*(\d+)/.exec(lines[i])
    if (match) shortcuts.push({ file: file.slice(root.length + 1), line: i + 1, code: Number(match[1]) })
  }
}

test('every recovered menu accelerator is a supported PowerBuilder key chord', () => {
  assert.ok(shortcuts.length >= 650, `found ${shortcuts.length} menu accelerators`)
  const named = new Map<number, string>([
    [8, 'keyback!'], [9, 'keytab!'], [13, 'keyenter!'], [27, 'keyescape!'], [32, 'keyspacebar!'],
    [33, 'keypageup!'], [34, 'keypagedown!'], [35, 'keyend!'], [36, 'keyhome!'], [37, 'keyleftarrow!'],
    [38, 'keyuparrow!'], [39, 'keyrightarrow!'], [40, 'keydownarrow!'], [45, 'keyinsert!'], [46, 'keydelete!'],
  ])
  for (const shortcut of shortcuts) {
    assert.ok(shortcut.code >= 0 && shortcut.code < 2048, `${shortcut.file}:${shortcut.line} shortcut out of range`)
    const base = shortcut.code % 256
    const key = named.get(base) ??
      (base >= 112 && base <= 123 ? `keyf${base - 111}!` :
        base >= 65 && base <= 90 ? `key${String.fromCharCode(base).toLowerCase()}!` :
          base >= 48 && base <= 57 ? `key${String.fromCharCode(base)}!` : null)
    assert.ok(key, `${shortcut.file}:${shortcut.line} has an unsupported base key ${base}`)
    assert.equal(virtualKey(key!), base, `${shortcut.file}:${shortcut.line} cannot be dispatched (${key})`)
  }
})
