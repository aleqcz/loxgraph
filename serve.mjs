// Dev static server - mirrors Miniserver layout:
//   /loxgraph/* -> app/*   (like /user/common/loxgraph on the Miniserver)
//   /stats/*    -> stats/* (stats directory served at the Miniserver root)
// `node serve.mjs stats-2` serves stats from ./stats-2/ instead
// `node serve.mjs proxy`   proxies /stats/* to a real Miniserver
//                          (LOXONE_HOST/USER/PASS from .env.local)
// no-store on every response so a plain browser reload always picks up new files
import http from 'node:http'
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs'
import { extname, join, normalize, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('.', import.meta.url))
const PORT = 8314
// stats dir selectable via CLI arg: `node serve.mjs stats-2` serves your own untracked data
// resolved inside ROOT so an arg like `..` cannot escape the repo
const STATS_DIR_ARG = process.argv[2] || 'stats'
const STATS_DIR = resolve(ROOT, STATS_DIR_ARG).startsWith(resolve(ROOT) + sep)
  ? STATS_DIR_ARG
  : 'stats'
// proxy mode: forward /stats/* to a real Miniserver with credentials from .env.local
const PROXY = process.argv[2] === 'proxy'
const ENV = PROXY ? loadEnv() : {}
const LOXONE_HOST = ENV.LOXONE_HOST || '192.168.1.77'
const LOXONE_AUTH = 'Basic ' + Buffer.from(`${ENV.LOXONE_USER}:${ENV.LOXONE_PASS}`).toString('base64')
const proxyStats = { count: 0, bytes: 0, ms: 0, t0: 0 }

// tiny .env.local parser (KEY=VALUE per line)
function loadEnv() {
  const env = {}
  try {
    for (const line of readFileSync(join(ROOT, '.env.local'), 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
      if (m) env[m[1]] = m[2]
    }
  } catch { /* missing .env.local -> empty env, proxy calls will fail auth */ }
  return env
}

// forward a /stats/* request to the Miniserver and stream the response back
// logs per-request timing and a running summary for profiling
function proxyStatsRequest(req, res, startedAt) {
  const upstream = http.request(
    { host: LOXONE_HOST, path: req.url, headers: { Authorization: LOXONE_AUTH }, timeout: 120000 },
    up => {
      res.writeHead(up.statusCode, { 'Content-Type': up.headers['content-type'] ?? 'application/octet-stream', 'Cache-Control': 'no-store' })
      up.pipe(res)
      up.on('end', () => {
        const s = proxyStats
        s.count++
        s.bytes += +(up.headers['content-length'] || 0)
        const ms = Date.now() - startedAt
        s.ms += ms
        if (s.count === 1 || s.count % 50 === 0) console.log(`stats #${s.count} ${req.url} ${up.statusCode} ${ms}ms | total ${(s.ms / 1000).toFixed(1)}s ${(s.bytes / 1e6).toFixed(1)}MB`)
      })
    }
  )
  upstream.on('timeout', () => upstream.destroy(new Error('upstream timeout')))
  upstream.on('error', err => {
    console.log(`stats proxy error ${req.url}: ${err.message}`)
    if (!res.headersSent) res.writeHead(502)
    res.end('502')
  })
  upstream.end()
}

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
  ...(PROXY ? [] : [{ prefix: '/stats/', dir: STATS_DIR }]),
]

http.createServer((req, res) => {
  let pathname
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname)
  } catch {
    res.writeHead(400)
    return res.end('400')
  }
  if (pathname === '/' || pathname === '/loxgraph') {
    res.writeHead(302, { Location: '/loxgraph/' })
    return res.end()
  }
  if (PROXY && pathname.startsWith('/stats/')) {
    if (!proxyStats.t0) proxyStats.t0 = Date.now()
    return proxyStatsRequest(req, res, Date.now())
  }

  // case-insensitive route match (Windows FS is case-insensitive anyway)
  const route = ROUTES.find(r => pathname.toLowerCase().startsWith(r.prefix))
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
  let st = existsSync(file) ? statSync(file) : null
  if (st?.isDirectory()) {
    file = join(file, 'index.html')
    st = existsSync(file) ? statSync(file) : null
  }
  if (!st?.isFile()) {
    res.writeHead(404)
    return res.end('404')
  }

  res.writeHead(200, {
    'Content-Type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream',
    'Content-Length': st.size,
    'Cache-Control': 'no-store',
  })
  createReadStream(file).pipe(res)
}).listen(PORT, '127.0.0.1', () => {
  console.log(`loxgraph dev server: http://127.0.0.1:${PORT}/loxgraph/`)
  if (PROXY) {
    console.log(`stats proxied to http://${LOXONE_HOST}/stats/`)
    if (!ENV.LOXONE_USER || !ENV.LOXONE_PASS) console.log('warning: .env.local missing LOXONE_USER/LOXONE_PASS')
  } else {
    console.log(`stats served from ./${STATS_DIR}/`)
    if (!existsSync(join(ROOT, STATS_DIR))) console.log(`warning: ${STATS_DIR}/ does not exist`)
  }
})
