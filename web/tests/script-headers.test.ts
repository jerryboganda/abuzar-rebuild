// Every routine of the recovered scripts carries a usable name. A blank or garbled name (the decompiler lost it) leaves the routine
// uncallable: `f_retrieve_report8.(...)` compiled to an empty function, so 77 report variants (and every report of f_retrieve_report9
// after it) opened with no format or criteria dialog.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const root = new URL('../../data/src/scripts/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')

function* scripts(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) yield* scripts(path)
    else if (name.endsWith('.pbs')) yield path
  }
}

test('every recovered routine header names its routine', () => {
  const bad: string[] = []
  for (const file of scripts(root)) {
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      const m = /^\/\/ ([A-Za-z0-9_]+)\.(.*?)(\(|: external)/.exec(line)
      if (!m || m[3] !== '(') continue
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(m[2])) bad.push(`${file.slice(root.length)}: ${line.slice(0, 80)}`)
    }
  }
  assert.deepEqual(bad, [])
})

test('a global function script names its own routine', () => {
  const bad: string[] = []
  for (const file of scripts(root)) {
    const text = readFileSync(file, 'utf8')
    const head = /^\/\/ function (\w+) /.exec(text)
    if (!head) continue
    if (!new RegExp(`^// ${head[1]}\\.${head[1]}\\(`, 'm').test(text)) bad.push(head[1])
  }
  assert.deepEqual(bad, [])
})
