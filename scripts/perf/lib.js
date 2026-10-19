// In-page benchmark helpers (evaluated via CDP). measure(): action → condition true → the next
// frame painted (two rAFs). Long tasks observed during each run are reported.
window.__b = window.__b || (() => {
  const st = () => window.__bereanStore.getState()
  const raf = () => new Promise((r) => requestAnimationFrame(() => r()))
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  let longs = []
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) longs.push(Math.round(e.duration)) }).observe({ type: 'longtask', buffered: false }) } catch {}
  async function measure(act, done, timeout = 5000) {
    longs = []
    const t0 = performance.now()
    act()
    while (!done()) { if (performance.now() - t0 > timeout) return { ms: -1, longs: [...longs] }; await new Promise((r) => setTimeout(r, 0)) }
    const tDom = performance.now() - t0
    await raf(); await raf()
    return { ms: Math.round((performance.now() - t0) * 10) / 10, dom: Math.round(tDom * 10) / 10, longs: [...longs] }
  }
  const stats = (xs) => { const a = xs.map((x) => x.ms).filter((x) => x >= 0).sort((p, q) => p - q); const q = (f) => a[Math.min(a.length - 1, Math.floor(f * (a.length - 1) + 0.5))]; return { n: a.length, med: q(0.5), p95: q(0.95), max: a[a.length - 1], longTasks: xs.flatMap((x) => x.longs).length, longestTask: Math.max(0, ...xs.flatMap((x) => x.longs)) } }
  const firstVerseRef = () => { const v = document.querySelector('[data-verse-ref], [data-verse]'); return v ? (v.getAttribute('data-verse-ref') || v.closest('[data-chapter]')?.getAttribute('data-chapter') || '') + document.title : '' }
  return { st, raf, sleep, measure, stats, firstVerseRef }
})()
