import { connect, sleep } from './drive.mjs'
const c = await connect(process.argv[2] || 'main')
const x = Number(process.argv[3] || 700), y = Number(process.argv[4] || 400)
const setup = process.argv[5] || ''
if (setup) { await c.ev(setup); await sleep(800) }
const runs = []
for (let k = 0; k < 3; k++) {
  await c.ev(`window.__fr = []; window.__frOn = true; (function f(t) { window.__fr.push(t); if (window.__frOn) requestAnimationFrame(f) })(performance.now()); window.__lt = []; try { window.__po?.disconnect(); window.__po = new PerformanceObserver(l => { for (const e of l.getEntries()) window.__lt.push(Math.round(e.duration)) }); window.__po.observe({ type: 'longtask' }) } catch {} ; 1`)
  for (let i = 0; i < 90; i++) { await c.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: 0, deltaY: k % 2 ? -40 : 40 }); await sleep(16) }
  await sleep(300)
  runs.push(await c.ev(`(() => { window.__frOn = false; const f = window.__fr; const d = f.slice(1).map((t, i) => t - f[i]).sort((a, b) => a - b); const q = (p) => d[Math.floor(p * (d.length - 1))]; return { frames: d.length, p50: +q(0.5).toFixed(1), p95: +q(0.95).toFixed(1), p99: +q(0.99).toFixed(1), over25: d.filter(x => x > 25).length, over50: d.filter(x => x > 50).length, longTasks: window.__lt.length, longest: Math.max(0, ...window.__lt) } })()`))
}
console.log(JSON.stringify(runs))
c.close()
