#!/usr/bin/env node
// Launches the built app and proves a real window loaded: the Electron process starts, the
// renderer reaches a page, and the preload bridge answers. Run after `npm run build` and
// `npm run rebuild`. Uses a throwaway profile, so it never touches anyone's data.
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const require = createRequire(import.meta.url)
const PORT = 9333
const userData = mkdtempSync(join(tmpdir(), 'berean-smoke-'))
const app = spawn(require('electron'), ['.'], { env: { ...process.env, BEREAN_CDP_PORT: String(PORT), BEREAN_QA_USER_DATA: userData }, stdio: ['ignore', 'pipe', 'pipe'] })
let log = ''
app.stdout.on('data', (d) => { log += d })
app.stderr.on('data', (d) => { log += d })

const fail = (why) => { console.error(`Smoke test failed: ${why}\n${log.slice(-3000)}`); finish(1) }
function finish(code) {
  app.kill()
  setTimeout(() => {
    // Electron may still be writing as it exits; a leftover temp folder doesn't change the result.
    try { rmSync(userData, { recursive: true, force: true, maxRetries: 3 }) } catch { /* the OS clears it */ }
    process.exit(code)
  }, 500)
}
app.on('exit', (code) => { if (code) fail(`Electron exited with ${code}`) })
app.on('error', (e) => fail(e.message))

async function evaluate(url, expression) {
  const ws = new WebSocket(url)
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject })
  const reply = new Promise((resolve) => { ws.onmessage = (e) => resolve(JSON.parse(e.data)) })
  ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }))
  const r = await reply
  ws.close()
  return r.result?.result?.value
}

const deadline = Date.now() + 60_000
while (Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, 1000))
  const targets = await fetch(`http://127.0.0.1:${PORT}/json`).then((r) => r.json()).catch(() => [])
  const page = targets.find((t) => t.type === 'page' && !t.url.startsWith('devtools:'))
  if (!page) continue
  const state = await evaluate(page.webSocketDebuggerUrl, `(async () => ({ ready: document.readyState, chars: document.body.innerText.length, bridge: !!(await window.aiLookup.listProfiles()).length }))()`).catch(() => null)
  if (state?.ready === 'complete' && state.chars > 0 && state.bridge) {
    console.log('Smoke test passed:', JSON.stringify(state))
    finish(0)
    await new Promise(() => {})
  }
}
fail('no working window within 60 seconds')
