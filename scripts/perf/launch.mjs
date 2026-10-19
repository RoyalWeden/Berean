// Launch benchmark: N launches of the BUILT app (out/), QA user data (copy of Berean Dev, sync off).
// Records: spawn → app ready / db open / window created (main early log), renderer marks,
// first contentful paint, memory (RSS of all processes, JS heap).
import { spawn, execSync } from 'node:child_process'
import { readFileSync, statSync } from 'node:fs'
const N = Number(process.argv[2] || 5)
const PORT = 9224
const ROOT = new URL('../..', import.meta.url).pathname.replace(/\/$/, '')
const USER = process.env.PERF_USER || '' + (process.env.PERF_DIR || '/tmp/berean-perf') + '/userdata'
const EARLY = '' + (process.env.PERF_DIR || '/tmp/berean-perf') + '/early.log'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function target() {
  for (let i = 0; i < 400; i++) {
    try { const l = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); const t = l.find((x) => x.type === 'page' && x.url.startsWith('file:') && !/[?&](chat|viewer|studyTrail|float|versePicker)=1/.test(x.url)); if (t) return t } catch {}
    await sleep(25)
  }
  throw new Error('no target')
}
async function conn(t) {
  const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise((r, j) => { ws.onopen = r; ws.onerror = j })
  let id = 0; const pend = new Map(); ws.onmessage = (e) => { const m = JSON.parse(e.data); pend.get(m.id)?.(m) }
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
  const ev = async (x) => (await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true })).result?.result?.value
  return { send, ev, close: () => ws.close() }
}
// A leftover instance on the port (or holding the single-instance lock) would receive every
// launch below and be measured instead — refuse to start.
try { await fetch(`http://127.0.0.1:${PORT}/json`); console.error(`port ${PORT} is in use — quit the instance listening there first`); process.exit(1) } catch { /* free */ }
const runs = []
for (let k = 0; k < N; k++) {
  const earlySize = (() => { try { return statSync(EARLY).size } catch { return 0 } })()
  const t0 = Date.now()
  const child = spawn(`${ROOT}/node_modules/.bin/electron`, ['.'], { cwd: ROOT, env: { ...process.env, BEREAN_QA_USER_DATA: USER, BEREAN_CDP_PORT: String(PORT), ELECTRON_RENDERER_URL: '', BEREAN_PERF_LOG: EARLY }, stdio: 'ignore', detached: true })
  try {
  const t = await target()
  const c = await conn(t)
  let marks
  for (let i = 0; i < 600; i++) { marks = await c.ev('window.__bereanPerf && window.__bereanPerf.interactive ? JSON.stringify({ origin: Date.now() - performance.now(), marks: window.__bereanPerf, fcp: (performance.getEntriesByName("first-contentful-paint")[0]||{}).startTime, nav: performance.getEntriesByType("navigation")[0]?.toJSON() }) : null'); if (marks) break; await sleep(25) }
  const m = JSON.parse(marks)
  await sleep(1500) // settle
  await c.send('Performance.enable')
  const met = Object.fromEntries((await c.send('Performance.getMetrics')).result.metrics.map((x) => [x.name, x.value]))
  const dom = await c.ev('document.querySelectorAll("*").length')
  // RSS of the app's process tree
  // RSS of THIS launch's process group only (never the developer's own `npm run dev`)
  const rss = execSync('ps -A -o pgid=,rss=').toString().trim().split('\n').map((l) => l.trim().split(/\s+/).map(Number)).filter(([g]) => g === child.pid).reduce((a, [, r]) => a + r, 0)
  // main-process timeline from the early log (this run's lines only)
  const early = readFileSync(EARLY, 'utf8').slice(earlySize).split('\n')
  const at = (re) => { const l = early.find((x) => re.test(x)); return l ? Date.parse(l.slice(1, 25)) - t0 : null }
  const rel = (v) => (v == null ? null : Math.round(m.origin + v - t0))
  runs.push({
    mainLoaded: at(/module loaded/), appReady: at(/whenReady fired/), dbOpen: at(/berean\.db opened OK/), windowCreated: at(/createWindow\(\) returned/), domReady: at(/\[dom-ready\]/),
    navStart: Math.round(m.origin - t0), modules: rel(m.marks['modules-evaluated']), mounted: rel(m.marks['app-mounted']), fcp: rel(m.fcp), scripture: rel(m.marks['scripture-visible']), interactive: rel(m.marks.interactive),
    heapMB: Math.round(met.JSHeapUsedSize / 1048576), dom, rssMB: Math.round(rss / 1024),
  })
  console.log(JSON.stringify(runs.at(-1)))
  c.close()
  } finally {
  // Kill this launch's whole process group, then wait until no process uses the perf profile
  // (a survivor would make the next launch hand off to it under the single-instance lock).
  try { process.kill(-child.pid, 'SIGKILL') } catch {}
  for (let i = 0; i < 100; i++) {
    const left = execSync('ps -A -o pid=,args=').toString().split('\n').filter((l) => l.includes(USER))
    if (!left.length) break
    for (const l of left) { try { process.kill(Number(l.trim().split(/\s+/)[0]), 'SIGKILL') } catch {} }
    await sleep(100)
  }
  await sleep(1500)
  }
}
const keys = Object.keys(runs[0])
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor((s.length - 1) / 2)] }
console.log('MEDIAN', JSON.stringify(Object.fromEntries(keys.map((k) => [k, med(runs.map((r) => r[k]).filter((v) => v != null))]))))
console.log('MAX', JSON.stringify(Object.fromEntries(keys.map((k) => [k, Math.max(...runs.map((r) => r[k]).filter((v) => v != null))]))))
