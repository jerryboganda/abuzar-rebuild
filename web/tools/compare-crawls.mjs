// Compares the Classic and the Modern menu crawl of the real application (web/e2e/browser-smoke.mjs with CRAWL_MODE) item by item.
// Both crawls drive the same runtime against the same database; the presentation must not change what a menu command does: whether it
// runs, which windows it leaves open (class and title), which message boxes the user sees, the report it produces and the windows its
// scripts close.  Every difference is listed; none is excused here.
// usage: node web/tools/compare-crawls.mjs <menu-crawl-classic.tsv> <menu-crawl-modern.tsv> [report.md]
import { readFileSync, writeFileSync, existsSync } from 'node:fs'

const [classicPath, modernPath, reportPath] = process.argv.slice(2)
const columns = ['clicked', 'windows', 'message boxes', 'report', 'closed by scripts', 'window state']
const read = (path) => {
  const rows = new Map()
  if (!existsSync(path)) return rows
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/).filter(Boolean)) {
    const [id, res, titles, menuPath, boxes, rep, closed, state] = line.split('\t')
    // The main window's title carries the sign-in date and time; a clock value is not an outcome of the command.
    const clock = (value) => value.replace(/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g, '<date>').replace(/\b\d{1,2}:\d{2}(:\d{2})?\b/g, '<time>')
    rows.set(`${id}\t${menuPath}`, [res, titles, boxes, rep, closed, state].map((value) => clock((value ?? '').trim())))
  }
  return rows
}
const classic = read(classicPath)
const modern = read(modernPath)
const lines = []
let same = 0
const differences = []
for (const [key, left] of classic) {
  const right = modern.get(key)
  if (!right) continue
  const changed = columns.filter((_, index) => left[index] !== right[index])
  if (!changed.length) { same++; continue }
  const [id, path] = key.split('\t')
  differences.push({ id, path, changed: changed.map((name) => ({ name, classic: left[columns.indexOf(name)], modern: right[columns.indexOf(name)] })) })
}
const onlyClassic = [...classic.keys()].filter((key) => !modern.has(key))
const onlyModern = [...modern.keys()].filter((key) => !classic.has(key))
lines.push(`Menu crawl comparison: ${classic.size} Classic items, ${modern.size} Modern items, ${classic.size - onlyClassic.length} in both.`)
lines.push(`Identical outcome: ${same}. Different outcome: ${differences.length}. Reached only in Classic: ${onlyClassic.length}. Only in Modern: ${onlyModern.length}.`)
for (const difference of differences) {
  lines.push(`- ${difference.id} ${difference.path}`)
  for (const change of difference.changed) lines.push(`  - ${change.name}: Classic \`${change.classic.slice(0, 300)}\` / Modern \`${change.modern.slice(0, 300)}\``)
}
for (const key of onlyClassic.slice(0, 50)) lines.push(`- only in Classic (the Modern crawl did not reach it): ${key.replace('\t', ' ')}`)
for (const key of onlyModern.slice(0, 50)) lines.push(`- only in Modern: ${key.replace('\t', ' ')}`)
const text = lines.join('\n') + '\n'
process.stdout.write(text)
if (reportPath) writeFileSync(reportPath, text)
process.exit(differences.length || !classic.size || !modern.size ? 1 : 0)
