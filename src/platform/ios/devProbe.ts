/**
 * Simulator automation probe — DEVELOPMENT BUILDS ONLY. Compiled in only when the iOS web bundle
 * is built with `BEREAN_E2E_PROBE=1` (see vite.ios.config.ts; that build also gets the dev CSP).
 * It polls a tiny server on the Mac (scripts/ios/probe-server.mjs, 127.0.0.1:9555 — the simulator
 * shares the Mac's loopback) for JavaScript to evaluate and posts the result back, so UI flows
 * can be verified on the simulator with real WKWebView rendering. Never present in a normal,
 * TestFlight or App Store build: the guard below is a compile-time constant.
 */
import { useAppStore } from '@/store'

export function installDevProbe(): void {
  if (import.meta.env.VITE_E2E_PROBE !== '1') return
  ;(window as unknown as { __bereanStore: typeof useAppStore }).__bereanStore = useAppStore
  const base = 'http://127.0.0.1:9555'
  const tick = async () => {
    try {
      const r = await fetch(`${base}/next`, { cache: 'no-store' })
      if (r.status === 200) {
        const { id, code } = (await r.json()) as { id: string; code: string }
        let result: unknown
        try {
          // eslint-disable-next-line no-new-func
          result = await new Function(`return (async () => { ${code} })()`)()
        } catch (e) {
          result = { probeError: String((e as Error)?.stack ?? e) }
        }
        let body: string
        try { body = JSON.stringify({ id, result }) } catch { body = JSON.stringify({ id, result: String(result) }) }
        await fetch(`${base}/result`, { method: 'POST', body, headers: { 'content-type': 'application/json' } })
      }
    } catch { /* server not running */ }
    setTimeout(tick, 250)
  }
  void tick()
}
