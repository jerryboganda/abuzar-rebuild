// Sample PDFs of the Modern print templates for the owner's approval: the real DataWindow definitions of the registered
// templates (print-templates.ts), filled with SYNTHETIC rows (no customer data), printed once with the Classic renderer
// and once with the Modern template.  Runs in CI only (workflow print-samples.yml); the PDFs are uploaded as an artifact.
//   node web/e2e/print-samples.mjs [web/dist] [shots/print-samples]
import { chromium } from 'playwright'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { resolve, extname, sep } from 'node:path'

const root = resolve(process.argv[2] ?? 'web/dist')
const output = resolve(process.argv[3] ?? 'shots/print-samples')
await mkdir(output, { recursive: true })
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.ttf': 'font/ttf', '.gz': 'application/gzip' }
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://localhost')
    const file = resolve(root, '.' + decodeURIComponent(url.pathname))
    if (!file.startsWith(root + sep)) { response.writeHead(403).end(); return }
    const bytes = await readFile(file)
    response.writeHead(200, { 'content-type': mime[extname(file)] || 'application/octet-stream' }).end(bytes)
  } catch (error) {
    response.writeHead(error.code === 'ENOENT' ? 404 : 500).end()
  }
})
server.listen(0, '127.0.0.1')
await once(server, 'listening')
const origin = `http://127.0.0.1:${server.address().port}`

/** the templates to sample: registered definition, library bundle, and how many rows the sample invoice carries */
const samples = [
  { template: 'sales-invoice-standard', definition: 'd_retailsaleinvreport', lines: 14 },
  { template: 'sales-invoice-standard-long', definition: 'd_retailsaleinvreport', lines: 70 },
  { template: 'purchase-invoice-standard', definition: 'd_purchaseinvreportstock_retailer', lines: 12 },
]

const browser = await chromium.launch({ headless: true })
const failures = []
try {
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 }, locale: 'en-US', reducedMotion: 'reduce' })
  // same guards as the presentation pass: no desktop bridge, files a window reads are answered as missing, every other API is refused
  await page.addInitScript(() => {
    const forbiddenNative = () => { throw new Error('The browser fixture must not call its containing desktop bridge') }
    window.__TAURI_INTERNALS__ = { invoke: forbiddenNative }
    window.__TAURI__ = { window: { getCurrentWindow: forbiddenNative } }
  })
  const diagnostics = []
  page.on('pageerror', (error) => { failures.push('page error: ' + error.message); diagnostics.push('pageerror: ' + error.message) })
  page.on('console', (message) => { if (['error', 'warning'].includes(message.type())) diagnostics.push(`console.${message.type()}: ${message.text().slice(0, 300)}`) })
  page.on('requestfailed', (request) => diagnostics.push(`request failed: ${request.url()}`))
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url())
    if (url.origin === origin && url.pathname === '/api/fs/read') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ exists: false }) })
    }
    if (url.origin !== origin || url.pathname.startsWith('/api/')) { diagnostics.push('refused: ' + url.pathname); return route.abort() }
    return route.continue()
  })
  await page.goto(origin + '/presentation.html')
  try {
    await page.waitForFunction(() => window.presentationFixtureReady, undefined, { timeout: 120000 })
  } catch (error) {
    console.log('The fixture page did not become ready. Diagnostics:' + String.fromCharCode(10) + diagnostics.slice(0, 40).join(String.fromCharCode(10)))
    throw error
  }

  for (const sample of samples) {
    const documents = await page.evaluate(async ({ definition, lines }) => {
      const [{ Runtime }, { registerSysFuncs }, { DwModel }, { DwCatalog }, { NDwBase }, { buildPages, pageSetup, printDocumentStyle }] = await Promise.all([
        import('/src/runtime/interp.js'), import('/src/runtime/sysfuncs.js'), import('/src/dw/model.js'), import('/src/dw/def.js'),
        import('/src/runtime/native/dwctrl.js'), import('/src/ui/print.js'),
      ])
      const read = async (path) => {
        const response = await fetch('/data/' + path.replace(/\.json$/, '.json.gz').replace('_index.json.gz', '_index.json'))
        if (!response.ok) return undefined
        return path === 'dw/_index.json' ? response.text()
          : new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).text()
      }
      const rt = new Runtime({ load: async () => undefined })
      registerSysFuncs(rt)
      rt.dwCatalog = new DwCatalog(read)
      const def = await rt.dwCatalog.get(definition)
      if (!def) throw new Error('definition not found: ' + definition)
      const model = new DwModel(rt, definition, structuredClone(def))
      const items = ['PANADOL 500MG TABLET 10S', 'BRUFEN 400MG TABLET 20S', 'AUGMENTIN 625MG TABLET 6S', 'CALPOL SYRUP 120MG/5ML 60ML',
        'DISPRIN TABLET 100S', 'FLAGYL 400MG TABLET 20S', 'GAVISCON SUSPENSION 150ML', 'LOSEC 20MG CAPSULE 14S', 'NEXUM 40MG TABLET 14S',
        'SURBEX Z TABLET 30S', 'VENTOLIN INHALER 200 DOSE', 'ZYRTEC 10MG TABLET 10S', 'ARTHROTEC 50MG TABLET 20S', 'XYZAL 5MG TABLET 10S']
      const value = (column, row) => {
        const name = column.name, type = column.type
        if (/itemname$/.test(name)) return items[(row - 1) % items.length] + (row > items.length ? ` (${Math.ceil(row / items.length)})` : '')
        if (/(customer|supplier)name$/.test(name)) return 'SAMPLE CUSTOMER (SYNTHETIC)'
        if (/username$/.test(name)) return 'SAMPLE USER'
        if (/remarks$/.test(name)) return 'Synthetic sample for template review - not a real invoice'
        if (/^posted$/.test(name)) return 'Y'
        if (/(invcode|purinvcode)$/.test(name)) return 100245
        if (/date$|^expiry$/.test(name)) return new Date(2026, 10, 10 + (name === 'expiry' ? 400 : 0))
        if (/qty$/.test(name)) return row % 5 + 1
        if (/(saleprice|purprice|^rate$|_rate$|avgprice)$/.test(name)) return 12.5 * ((row % 7) + 1)
        if (/discperc$/.test(name)) return row % 4 === 0 ? 5 : 0
        if (/^id$/.test(name)) return row
        if (/packunits$/.test(name)) return 10
        if (/^batch$/.test(name)) return `B${1000 + row}`
        if (/^(packingname)$/.test(name)) return 'STRIP'
        if (type.startsWith('char')) return 'Sample ' + name
        if (type.startsWith('decimal')) return 0
        return row
      }
      for (let row = 1; row <= lines; row++) {
        model.insertRow(0)
        for (const column of def.table.columns) model.setItem(row, column.name, value(column, row))
      }
      const control = new NDwBase(rt, 'datawindow', 'datawindow')
      control.attach(model)
      const css = [...document.querySelectorAll('style')].map((style) => style.textContent).join('\n')
      const out = {}
      for (const presentation of ['classic', 'modern']) {
        const pages = await buildPages(control, presentation === 'modern' ? { presentation } : {})
        out[presentation] = {
          pages: pages.length,
          html: `<!doctype html><html><head><meta charset="utf-8"><style>${printDocumentStyle(css, pageSetup(model), presentation)}</style></head><body>${pages.map((p) => p.outerHTML).join('')}</body></html>`,
          text: pages.map((p) => p.textContent.replace(/\s+/g, ' ').trim()).join('\n').slice(0, 4000),
        }
      }
      return out
    }, sample).catch((error) => { failures.push(`${sample.template}: ${String(error.message).slice(0, 300)}`); return null })
    if (!documents) continue
    for (const presentation of ['classic', 'modern']) {
      const doc = documents[presentation]
      const printPage = await browser.newPage()
      await printPage.route('**/*', (route) => new URL(route.request().url()).origin === origin ? route.continue() : route.abort())
      await printPage.setContent(doc.html.replace('<head>', `<head><base href="${origin}/">`))
      await printPage.evaluate(() => document.fonts?.ready)
      const file = `${sample.template}-${presentation}.pdf`
      await printPage.pdf({ path: resolve(output, file), preferCSSPageSize: true, printBackground: true })
      await writeFile(resolve(output, `${sample.template}-${presentation}.txt`), doc.text + '\n')
      console.log(`${file}: ${doc.pages} page(s)`)
      await printPage.close()
    }
    if (documents.classic.pages !== documents.modern.pages) failures.push(`${sample.template}: page count differs (classic ${documents.classic.pages}, modern ${documents.modern.pages})`)
  }
} finally {
  await browser.close()
  server.close()
}
if (failures.length) {
  console.log('FAILURES:\n' + failures.join('\n'))
  process.exit(1)
}
console.log('Sample PDFs written to ' + output)
