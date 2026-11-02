// Generates docs/PARITY.md from tool outputs (never from memory).
// usage: node tools/parity.ts <repo root> <smoke report.json> <parse errors file>
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const root = process.argv[2]
const smokeFile = process.argv[3]
const read = (p: string) => (existsSync(p) ? readFileSync(p, 'utf8') : '')
const json = (p: string) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null)

const smoke = json(smokeFile) as { results: { name: string; ok: boolean; error?: string }[]; missing: Record<string, number> } | null
const stmts = json(join(root, 'data/sql/statements.json')) as { status: string; kind: string }[] | null
const sigs = json(join(root, 'data/sql/proc_signatures.json')) as { kind: string; status: string }[] | null
const dwIndex = json(join(root, 'data/src/dw/_index.json')) as Record<string, string> | null
const classes = existsSync(join(root, 'web/public/data/classes')) ? readdirSync(join(root, 'web/public/data/classes')).length : 0
const parseErr = read(process.argv[4] || '').split('\n').filter(Boolean).length

const count = <T,>(xs: T[], f: (x: T) => string) => {
  const m = new Map<string, number>()
  for (const x of xs) m.set(f(x), (m.get(f(x)) || 0) + 1)
  return m
}
const L: string[] = []
L.push('# Parity status (generated)', '', 'Every number below is produced by a tool run; nothing is estimated.', '')
L.push('## Scripts (PowerScript)')
L.push(`- classes built: ${classes}; routines that fail to parse: ${parseErr}`)
if (smoke) {
  const ok = smoke.results.filter((r) => r.ok).length
  L.push('', '## Windows (headless run, mock database)', `- windows opened without a runtime error: **${ok} of ${smoke.results.length}** (${((100 * ok) / smoke.results.length).toFixed(1)}%)`)
  const errs = count(smoke.results.filter((r) => !r.ok), (r) => (r.error || '').split(' @')[0].replace(/\d+/g, 'N').slice(0, 70))
  L.push('- most common failures:')
  for (const [k, v] of [...errs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)) L.push(`  - ${v} x ${k}`)
  const miss = Object.entries(smoke.missing).sort((a, b) => b[1] - a[1]).slice(0, 25)
  L.push('- unimplemented functions / members met at run time (calls):', '  ' + miss.map(([k, v]) => `\`${k}\` ${v}`).join(', '))
}
const ci = json(join(root, 'docs/ci-results.json')) as Record<string, { ok: number; of: number } | string | null> | null
if (ci) {
  const fmt = (x: unknown) => (x && typeof x === 'object' ? `**${(x as { ok: number }).ok} of ${(x as { of: number }).of}** (${((100 * (x as { ok: number }).ok) / (x as { of: number }).of).toFixed(1)}%)` : 'not measured')
  L.push('', `## Against a real server and PostgreSQL 17 (CI end-to-end job, run ${ci.run}, commit ${String(ci.commit).slice(0, 7)})`)
  L.push(`- DataWindow retrieve statements that run: ${fmt(ci.datawindow_retrieves)}`)
  L.push(`- embedded statements that run (null parameters, errors of integrity / data classes not counted as failures): ${fmt(ci.embedded_statements)}`)
  L.push(`- translated procedures that run with neutral arguments: ${fmt(ci.procedures)}`)
  L.push(`- windows opened without a runtime error (retried with the usual Message.StringParm codes): ${fmt(ci.windows)}`)
  L.push(`- start-up with the first administrator: ${ci.startup ?? 'not measured'}`)
}
L.push('', '## SQL translation (PostgreSQL 17)')
if (stmts) {
  const m = count(stmts, (s) => s.status)
  L.push(`- statements: ${[...m.entries()].map(([k, v]) => `${v} ${k}`).join(', ')}`)
}
if (sigs) {
  const m = count(sigs, (s) => `${s.kind}:${s.status}`)
  L.push(`- routines: ${[...m.entries()].map(([k, v]) => `${v} ${k}`).join(', ')}`)
}
L.push('', '## DataWindows', `- definitions available: ${dwIndex ? Object.keys(dwIndex).length : 0}`, '')
writeFileSync(join(root, 'docs/PARITY.md'), L.join('\n') + '\n')
console.log('docs/PARITY.md written')
