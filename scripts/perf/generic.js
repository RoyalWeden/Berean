window.__g = (() => {
  const st = () => window.__bereanStore.getState()
  const raf2 = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  // First painted DOM change after `act`, and when mutations stop for 120 ms ("settled").
  async function once(act) {
    let first = null, last = null
    const t0 = performance.now()
    const mo = new MutationObserver(() => { const t = performance.now(); if (first == null) first = t; last = t })
    mo.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true })
    let lt = []
    let po; try { po = new PerformanceObserver((l) => { for (const e of l.getEntries()) lt.push(Math.round(e.duration)) }); po.observe({ type: 'longtask' }) } catch {}
    act()
    for (;;) { await sleep(10); if (first != null) break; if (performance.now() - t0 > 4000) break }
    await raf2(); const resp = first == null ? -1 : performance.now() - t0
    for (;;) { await sleep(20); if (last != null && performance.now() - last > 120) break; if (performance.now() - t0 > 8000) break }
    mo.disconnect(); po?.disconnect()
    return { resp: Math.round(resp), settled: last == null ? -1 : Math.round(last - t0), longest: Math.max(0, ...lt) }
  }
  async function series(act, n, reset) { const xs = []; for (let i = 0; i < n; i++) { if (reset) { await reset(); await sleep(450) } xs.push(await once(act)); await sleep(250) } const med = (k) => { const a = xs.map((x) => x[k]).sort((p, q) => p - q); return a[Math.floor((a.length - 1) / 2)] }; return { resp: med('resp'), settled: med('settled'), maxSettled: Math.max(...xs.map((x) => x.settled)), longest: Math.max(...xs.map((x) => x.longest)) } }
  return { st, sleep, once, series }
})()
