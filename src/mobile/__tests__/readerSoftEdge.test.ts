// @vitest-environment node
/**
 * TEST 2026-10-19 "when I switch directions in the Scripture tab, the interaction sometimes
 * freezes": a mask added / removed / changed on the reader's scroller mid-drag makes WebKit rebuild
 * the native scroll layer and drops the active drag (reproduced in the simulator; scrolling followed
 * every reversal once the mask stopped changing). The reader's soft edge must stay an overlay.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const css = ['src/mobile/mobile.css', 'src/mobile/reader/readerChrome.css', 'src/mobile/reader/scriptureTheme.css']
  .map((f) => readFileSync(resolve(__dirname, '../../..', f), 'utf8')).join('\n')
  .replace(/\/\*[\s\S]*?\*\//g, '')

describe('Scripture reader soft scroll edge', () => {
  it('no rule puts a mask on the reader scroller', () => {
    const rules = css.split('}').map((r) => r.split('{')).filter(([sel, body]) => sel && body && /mobile-reader-scroll/.test(sel))
    for (const [sel, body] of rules) expect(`${sel.trim()} → ${/mask/.test(body) ? 'MASK' : 'ok'}`).toBe(`${sel.trim()} → ok`)
  })
  it('no toggled mask on a static page body (it holds the reader / compare scrollers)', () => {
    const rules = css.split('}').map((r) => r.split('{')).filter(([sel, body]) => sel && body && /mask-image/.test(body) && /mobile-page-body/.test(sel) && !/mask-image:\s*none/.test(body))
    expect(rules.length).toBeGreaterThan(0)
    for (const [sel] of rules) for (const part of sel.split(',')) if (/mobile-page-body/.test(part)) expect(part).toMatch(/mobile-page-body:not\(\.is-static\)/)
  })
  it('the edge is a non-interactive overlay that fades with the bottom controls', () => {
    expect(css).toMatch(/\.mobile-reader-soft-edge\s*\{[^}]*pointer-events:\s*none/)
    expect(css).toMatch(/\.mobile-reader-soft-edge\s*\{[^}]*transition:\s*opacity/)
    expect(css).toMatch(/:not\(\.is-nav-collapsed\)\s+\.mobile-reader-soft-edge\s*\{\s*opacity:\s*1/)
  })
})

describe('Scripture chrome motion (TEST 2026-10-19 "flickers too much"; capsule ⇄ island morph)', () => {
  it('the hidden header fades in place — no full-height slide — and takes no touches', () => {
    const hidden = css.match(/\.is-header-hidden\s*>\s*\.mobile-page-header\s*\{([^}]*)\}/)?.[1] ?? ''
    expect(hidden).toMatch(/opacity:\s*0/)
    expect(hidden).not.toMatch(/-100%/)
    expect(css).toMatch(/\.is-header-hidden\s*>\s*\.mobile-page-header\s*\*\s*\{\s*pointer-events:\s*none/)
  })
  it('the hidden pill sits in the capsule\'s measured shape; shown, in the island shape', () => {
    const base = css.match(/\.mobile-compact-pill\s*\{([^}]*)\}/)?.[1] ?? ''
    for (const v of ['--pill-from-top', '--pill-from-h', '--pill-from-w', '--pill-from-fs']) expect(base).toContain(v)
    expect(base).toMatch(/pointer-events:\s*none/)
    expect(css).toMatch(/\.mobile-compact-pill\.is-visible,\s*\.mobile-compact-pill\.is-measure\s*\{[^}]*top:\s*var\(--pill-to-top\)/)
  })
  it('every piece of the reader chrome moves on the one shared duration and curve', () => {
    for (const sel of ['.mobile-bottom-nav', '.mobile-compact-band', '.mobile-reader-soft-edge']) {
      const bodies = [...css.matchAll(new RegExp(`(?:^|\\})\\s*\\${sel}\\s*\\{([^}]*)\\}`, 'g'))].map((m) => m[1])
      expect(`${sel}: ${bodies.some((b) => b.includes('transition') && b.includes('var(--m-chrome-dur) var(--m-chrome-ease)'))}`).toBe(`${sel}: true`)
    }
  })
})
