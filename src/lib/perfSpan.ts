/**
 * Simulator profiling spans (iOS probe builds only, `BEREAN_E2E_PROBE=1`): totals per name in
 * `window.__perfSpans`, so a stall seen at launch can be attributed to the code that ran in it.
 * In every other build this is a plain call — a compile-time constant check, nothing recorded.
 */
export function perfSpan<T>(name: string, fn: () => T): T {
  if (import.meta.env.VITE_E2E_PROBE !== '1') return fn()
  const t0 = performance.now()
  try { return fn() } finally {
    const w = window as unknown as { __perfSpans?: Record<string, { n: number; ms: number; first: number }> }
    const spans = (w.__perfSpans ??= {})
    const s = (spans[name] ??= { n: 0, ms: 0, first: Math.round(t0) })
    s.n++; s.ms = Math.round((s.ms + performance.now() - t0) * 10) / 10
  }
}
