// Benchmark: how long does the app take to load all stats from a Miniserver
// Fetches /stats/ listing, then every XML serially (like app/processQueue does)
// and once more with a concurrency pool to show the speedup potential
// Usage: node tools/bench-stats.mjs [--limit N] [--concurrency N]
import http from 'node:http'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const env = Object.fromEntries(
  readFileSync(join(ROOT, '.env.local'), 'utf8').split('\n')
    .map(l => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)).filter(Boolean)
    .map(m => [m[1], m[2]])
)
const HOST = env.LOXONE_HOST || '192.168.1.77'
const AUTH = 'Basic ' + Buffer.from(`${env.LOXONE_USER}:${env.LOXONE_PASS}`).toString('base64')
const arg = name => { const i = process.argv.indexOf(name); return i > -1 ? +process.argv[i + 1] : 0 }
const LIMIT = arg('--limit')
const CONCURRENCY = arg('--concurrency')

const agent = new http.Agent({ keepAlive: true })

const get = path => new Promise((res, rej) => {
  http.get({ host: HOST, path, agent, headers: { Authorization: AUTH }, timeout: 120000 }, r => {
    const chunks = []
    r.on('data', c => chunks.push(c))
    r.on('end', () => {
      const body = Buffer.concat(chunks)
      res({ status: r.statusCode, bytes: body.length, body })
    })
  }).on('error', rej)
})

const run = async (urls, concurrency) => {
  const t0 = Date.now()
  let done = 0, bytes = 0
  const worker = async () => {
    let u
    while ((u = urls.pop())) {
      const r = await get(`/stats/${u}`)
      done++; bytes += r.bytes
      if (done % 250 === 0) console.log(`  ${done} done, ${(Date.now() - t0) / 1000}s`)
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker))
  return { ms: Date.now() - t0, bytes }
}

const t0 = Date.now()
const listing = await get('/stats/')
const urls = [...listing.body.toString().matchAll(/([0-9a-f-]{35}\.[0-9]{6}\.xml)/g)].map(m => m[1])
console.log(`listing /stats/: ${listing.status} ${listing.bytes}B ${Date.now() - t0}ms, ${urls.length} xml files`)

const sample = LIMIT ? urls.slice(0, LIMIT) : urls
const serial = await run([...sample].reverse(), 1)
console.log(`SERIAL   ${sample.length} files: ${(serial.ms / 1000).toFixed(1)}s, ${(serial.bytes / 1e6).toFixed(1)}MB, ${(serial.ms / sample.length).toFixed(0)}ms/file`)
if (!LIMIT) {
  const conc = await run([...urls].reverse(), CONCURRENCY || 8)
  console.log(`PARALLEL ${urls.length} files x${CONCURRENCY || 8}: ${(conc.ms / 1000).toFixed(1)}s, ${(conc.bytes / 1e6).toFixed(1)}MB`)
}
agent.destroy()
