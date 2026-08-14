import { describe, it, expect } from 'vitest'
import { buildCSP } from '../csp'

describe('buildCSP', () => {
  it('always carries wasm-unsafe-eval and the berean-model: scheme, in both dev and prod', () => {
    // These two are the exact pair kokoro.worker.ts's offline WASM load depends on — see
    // csp.ts's own header for why regressing either one silently breaks Kokoro in a way that
    // only shows up in a packaged build.
    for (const dev of [true, false]) {
      const csp = buildCSP(dev)
      expect(csp).toContain("'wasm-unsafe-eval'")
      expect(csp).toContain('berean-model:')
    }
  })

  it('never allows the broad unsafe-eval or a remote CDN host in the production build', () => {
    const csp = buildCSP(false)
    // Quoted form so this doesn't false-positive on 'wasm-unsafe-eval', which legitimately does
    // appear in prod and contains "unsafe-eval" as a substring but not "'unsafe-eval'".
    expect(csp).not.toContain("'unsafe-eval'")
    expect(csp).not.toContain('cdn.jsdelivr.net')
    expect(csp).not.toContain('huggingface.co')
    expect(csp).not.toContain('ws:')
  })

  it('grants dev-only affordances (unsafe-eval, ws:, http:) needed for Vite HMR, only in dev', () => {
    const csp = buildCSP(true)
    expect(csp).toContain("script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval'")
    expect(csp).toContain('ws:')
    expect(csp).toContain('http:')
  })
})
