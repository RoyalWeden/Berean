#!/usr/bin/env node
// Development-only companion of src/platform/ios/devProbe.ts (simulator automation).
//   node scripts/ios/probe-server.mjs            → serve on 127.0.0.1:9555
//   node scripts/ios/probe-server.mjs run "<js>" → evaluate <js> (async function body; `return` a value) in the app
import http from 'node:http'
const PORT = 9555
if (process.argv[2] === 'run') {
  const code = process.argv.slice(3).join(' ')
  const res = await fetch(`http://127.0.0.1:${PORT}/run`, { method: 'POST', body: code })
  console.log(await res.text())
  process.exit(0)
}
let pending = null          // { id, code, resolve }
const waiting = new Map()
http.createServer((req, res) => {
  let body = ''
  req.on('data', (c) => { body += c })
  req.on('end', () => {
    if (req.url === '/next') {
      if (!pending) { res.writeHead(204, { 'access-control-allow-origin': '*' }); return res.end() }
      const { id, code } = pending; pending = null
      res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' })
      return res.end(JSON.stringify({ id, code }))
    }
    if (req.url === '/result') {
      try { const { id, result } = JSON.parse(body); waiting.get(id)?.(JSON.stringify(result, null, 1)); waiting.delete(id) } catch {}
      res.writeHead(204, { 'access-control-allow-origin': '*' }); return res.end()
    }
    if (req.url === '/run') {
      const id = Math.random().toString(36).slice(2)
      pending = { id, code: body }
      const t = setTimeout(() => { waiting.delete(id); res.end('TIMEOUT (is the app running a BEREAN_E2E_PROBE build?)') }, 20000)
      waiting.set(id, (out) => { clearTimeout(t); res.end(out) })
      return
    }
    if (req.method === 'OPTIONS') { res.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }); return res.end() }
    res.writeHead(404); res.end()
  })
}).listen(PORT, '127.0.0.1', () => console.log(`probe server on ${PORT}`))
