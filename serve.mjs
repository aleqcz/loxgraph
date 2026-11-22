// Dev static server - mirrors Miniserver layout:
//   /loxgraph/* -> app/*   (like /user/common/loxgraph on the Miniserver)
//   /stats/*    -> stats/* (stats directory served at the Miniserver root)
// no-store on every response so a plain browser reload always picks up new files
import http from 'node:http'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { extname, join, normalize, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('.', import.meta.url))
const PORT = 8314
// stats dir selectable via CLI arg: `node serve.mjs stats-2` serves your own untracked data
const STATS_DIR = process.argv[2] || 'stats'

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.coffee': 'text/plain; charset=utf-8',
  '.xml': 'text/xml; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.eot': 'application/vnd.ms-fontobject',
  '.ttf': 'font/ttf',
  '.woff': 'font/woff',
}

const ROUTES = [
  { prefix: '/loxgraph/', dir: 'app' },
  { prefix: '/stats/', dir: STATS_DIR },
]

http.createServer((req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname)
  if (pathname === '/' || pathname === '/loxgraph') {
    res.writeHead(302, { Location: '/loxgraph/' })
    return res.end()
  }

  const route = ROUTES.find(r => pathname.startsWith(r.prefix))
  if (!route) {
    res.writeHead(404)
    return res.end('404')
  }

  // resolve inside the mapped dir, block path traversal
  const dir = join(ROOT, route.dir)
  let file = normalize(join(dir, pathname.slice(route.prefix.length)))
  if (!file.startsWith(dir + sep) && file !== dir) {
    res.writeHead(403)
    return res.end('403')
  }
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html')
  if (!existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404)
    return res.end('404')
  }

  res.writeHead(200, {
    'Content-Type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream',
    'Cache-Control': 'no-store',
  })
  createReadStream(file).pipe(res)
}).listen(PORT, '127.0.0.1', () => {
  console.log(`loxgraph dev server: http://127.0.0.1:${PORT}/loxgraph/`)
  console.log(`stats served from ./${STATS_DIR}/`)
  if (!existsSync(join(ROOT, STATS_DIR))) console.log(`warning: ${STATS_DIR}/ does not exist`)
})
