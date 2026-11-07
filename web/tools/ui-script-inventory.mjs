// Static migration dependencies from redacted PowerScript. Does not execute scripts.
// node web/tools/ui-script-inventory.mjs <scripts directory> <ui-inventory.json> <output.json>
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises'
import { resolve, relative, join, dirname, sep } from 'node:path'
import { createHash } from 'node:crypto'
import { parseScriptFile } from '../src/pbscript/parser.ts'
import { analyzeUiScript } from './ui-script-analysis.ts'

const [scriptsArg, catalogArg, outputArg] = process.argv.slice(2)
if (!scriptsArg || !catalogArg || !outputArg) throw new Error('Expected scripts directory, static UI inventory, and output JSON paths.')
const scripts = resolve(scriptsArg)
const output = resolve(outputArg)
if (output === resolve(catalogArg) || output === scripts || output.startsWith(scripts + sep)) {
  throw new Error('The output must not overwrite the catalog or script inputs.')
}
const baseline = JSON.parse(await readFile(resolve(catalogArg), 'utf8'))
if (baseline.schemaVersion !== 1 || typeof baseline.sourceDigest !== 'string'
  || !Array.isArray(baseline.windows) || !Array.isArray(baseline.datawindows)
  || [...baseline.windows, ...baseline.datawindows].some((item) => typeof item.id !== 'string')) {
  throw new Error('Expected a schema-v1 static UI inventory with window and DataWindow identities.')
}
const catalog = {
  windows: new Set(baseline.windows.map((item) => item.id)),
  datawindows: new Set(baseline.datawindows.map((item) => item.id)),
}
async function* paths(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  for (const entry of entries.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) yield* paths(path)
    else if (entry.isFile() && entry.name.endsWith('.pbs')) yield path
  }
}
const digest = createHash('sha256')
digest.update(baseline.sourceDigest)
const sites = []
let files = 0
let routines = 0
for await (const path of paths(scripts)) {
  const source = relative(scripts, path).split(sep).join('/')
  const bytes = await readFile(path)
  digest.update(source).update('\0').update(bytes)
  const { file, errors } = parseScriptFile(bytes.toString('utf8'))
  if (errors.length) throw new Error(`${source}: ${errors.length} parse errors. Inventory stopped; source text is deliberately not included in this report.`)
  files++
  routines += file.routines.length
  for (const site of analyzeUiScript(file, catalog)) sites.push({ source, ...site })
}
if (!files || !routines) throw new Error('No parsed PowerScript routines found.')
const count = (kind) => sites.filter((site) => site.kind === kind).length
const opens = sites.filter((site) => site.kind === 'window-open')
const replacements = sites.filter((site) => site.kind === 'dataobject-assignment')
const result = {
  schemaVersion: 1,
  sourceDigest: digest.digest('hex'),
  definitionDigest: baseline.sourceDigest,
  scope: 'static-redacted-script-dependencies',
  limitations: [
    'Call sites are candidates, not proof of runtime reachability, authorization, roles or completed Modern coverage.',
    'Source locations identify the routine start and AST path; they are not exact statement line numbers.',
    'Only catalogued literal targets and known window reference types are resolved; dynamic values remain unresolved.',
    'Inheritance, aliases, returned values and inter-routine dataflow are not expanded.',
    'Dataobject assignments include nonvisual DataStores; declared receiver types are included only when known locally.',
    'Output calls do not establish which document template, data, paper or printer is used.',
    'Property values, SQL, arbitrary string literals, record values and script bodies are not emitted.',
  ],
  counts: {
    files, routines, sites: sites.length,
    windowOpenSites: opens.length,
    knownWindowTargets: new Set(opens.filter((site) => site.target).map((site) => site.target)).size,
    unresolvedWindowOpenSites: opens.filter((site) => !site.target).length,
    dataobjectAssignments: replacements.length,
    declaredDatastoreAssignments: replacements.filter((site) => site.receiverType === 'datastore').length,
    clearedDataobjectAssignments: replacements.filter((site) => site.targetBasis === 'cleared').length,
    unresolvedDataobjectAssignments: replacements.filter((site) => site.targetBasis === 'unresolved').length,
    presentationAssignments: count('presentation-assignment'),
    layoutCalls: count('layout-call'),
    focusCalls: count('focus-call'),
    outputCalls: count('output-call'),
    messageParameterSites: count('message-parameter'),
    modernVerified: 0,
  },
  sites,
}
await mkdir(dirname(output), { recursive: true })
await writeFile(output, JSON.stringify(result, null, 2) + '\n')
console.log(JSON.stringify({ sourceDigest: result.sourceDigest, ...result.counts }, null, 2))
