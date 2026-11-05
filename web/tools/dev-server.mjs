// Zero-dependency development server: serves web/public, strips TypeScript types from web/src on the fly
// (node:module stripTypeScriptTypes), exposes data/ (built classes, DataWindow bundles) and optionally proxies /api to the Rust server.
// usage: node tools/dev-server.mjs [port] [api-url]
import http from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import { gunzipSync } from 'node:zlib'
import { join, extname, normalize, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const port = Number(process.argv[2] || 5173)
const api = process.argv[3] || ''
const dist = process.env.DIST === '1'
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.bmp': 'image/bmp' }

const tsCache = new Map()

async function serveTs(file, res) {
  const st = await stat(file)
  const hit = tsCache.get(file)
  let code
  if (hit && hit.mtime === st.mtimeMs) code = hit.code
  else {
    const src = await readFile(file, 'utf8')
    code = stripTypeScriptTypes(src, { mode: 'strip' })
    tsCache.set(file, { mtime: st.mtimeMs, code })
  }
  res.writeHead(200, { 'content-type': MIME['.js'], 'cache-control': 'no-cache' })
  res.end(code)
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x')
    let p = decodeURIComponent(url.pathname)
    if (p.startsWith('/api/') && api) {
      const body = await new Promise((r) => {
        const c = []
        req.on('data', (d) => c.push(d))
        req.on('end', () => r(Buffer.concat(c)))
      })
      const up = await fetch(api + p + url.search, { method: req.method, headers: { 'content-type': req.headers['content-type'] || 'application/json' }, body: ['GET', 'HEAD'].includes(req.method) ? undefined : body })
      res.writeHead(up.status, { 'content-type': up.headers.get('content-type') || 'application/json' })
      res.end(Buffer.from(await up.arrayBuffer()))
      return
    }
    if (p === '/') p = '/index.html'
    let file
    if (dist) file = join(root, 'dist', normalize(p))
    else if (p.startsWith('/src/')) file = join(root, normalize(p))
    else if (p.startsWith('/data/')) file = join(root, 'public', normalize(p))
    else file = join(root, 'public', normalize(p))
    if (!file.startsWith(root)) {
      res.writeHead(403).end()
      return
    }
    if (!dist && (p.endsWith('.ts') || (p.startsWith('/src/') && p.endsWith('.ts')))) return await serveTs(file, res)
    // gzip-only files are served decompressed (DataWindow bundles are stored as .json.gz)
    try {
      await stat(file)
    } catch {
      try {
        await stat(file + '.gz')
        const buf = gunzipSync(await readFile(file + '.gz'))
        res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' })
        res.end(buf)
        return
      } catch {
        res.writeHead(404).end('not found: ' + p)
        return
      }
    }
    res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' })
    createReadStream(file).pipe(res)
  } catch (e) {
    res.writeHead(500, { 'content-type': 'text/plain' })
    res.end(String(e && e.stack ? e.stack : e))
  }
})
server.listen(port, () => console.log(`dev server http://localhost:${port}/`))
