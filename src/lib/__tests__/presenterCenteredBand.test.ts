/**
 * Inverted centred-outline scroll model — shared band/scrollTop transform.
 *
 * `presenterCenteredBandGeometry` is the ONE definition of where the outline band sits (in
 * main-panel content px) for a given presenter percent `p`, AND the `scrollTop` the main panel
 * slaves to so the band stays vertically centred in the viewport. BiblePanel's ease loop
 * (applyPresenterScroll) and the band renderer (computePresenterBand) both go through it, so
 * they can never drift apart — the regression this model replaces.
 *
 * Invariant:
 *   - mid-range `p`: band's viewport-top (`bandTopContent − desiredScrollTop`) is within ~1px
 *     of `(V − bandH)/2` (strictly centred);
 *   - `p = 0`: `desiredScrollTop === 0` and the band rides to the very top;
 *   - `p = 1`: `desiredScrollTop === maxScroll` and the band rides to the very bottom;
 *   - `desiredScrollTop` is monotonic non-decreasing in `p`.
 */
import { describe, it, expect } from 'vitest'
import { presenterCenteredBandGeometry, sortVerseFracs } from '../presenterBand'

// 12-verse chapter, identity presenter↔main mapping: 60px header, 120px verses, 1500px content,
// 900px viewport (so presenterFracToMainY(F) === 1500·F everywhere → clean hand-traceable math).
const mainH = 1500
const V = 900
const f = 0.5
const maxScroll = mainH - V // 600
const verseFracs: Record<number, number> = {}
const idTops: Record<number, number> = {}
for (let i = 1; i <= 12; i++) {
  const top = 60 + (i - 1) * 120
  idTops[i] = top
  verseFracs[i] = top / mainH
}
const entries = sortVerseFracs(verseFracs)
const geo = (p: number, tops = idTops, vf = f) =>
  presenterCenteredBandGeometry({ p, f: vf, entries, tops, mainH, V })

describe('presenterCenteredBandGeometry — endpoints ride to the edge', () => {
  it('p = 0: scrollTop pinned to 0, band at the very top of the viewport', () => {
    const g = geo(0)
    expect(g.desiredScrollTop).toBe(0)
    expect(g.bandTopContent - g.desiredScrollTop).toBeCloseTo(0, 6)
  })
  it('p = 1: scrollTop pinned to maxScroll, band bottom at the very bottom of the viewport', () => {
    const g = geo(1)
    expect(g.desiredScrollTop).toBeCloseTo(maxScroll, 6)
    expect(g.bandTopContent + g.bandH - g.desiredScrollTop).toBeCloseTo(V, 6)
  })
  it('reports maxScroll = mainH − V', () => {
    expect(geo(0.5).maxScroll).toBe(maxScroll)
  })
})

describe('presenterCenteredBandGeometry — strictly centred through the middle', () => {
  it('band viewport-top stays within 1px of (V − bandH)/2 for mid-range p', () => {
    for (let p = 0.12; p <= 0.88; p += 0.01) {
      const g = geo(p)
      const viewportTop = g.bandTopContent - g.desiredScrollTop
      expect(Math.abs(viewportTop - (V - g.bandH) / 2)).toBeLessThan(1)
    }
  })
  it('the identity case holds bandH constant at f·mainH mid-chapter', () => {
    for (let p = 0.12; p <= 0.88; p += 0.05) {
      expect(geo(p).bandH).toBeCloseTo(f * mainH, 6)
    }
  })
})

describe('presenterCenteredBandGeometry — monotonic', () => {
  it('desiredScrollTop is non-decreasing across p = 0 → 1', () => {
    let prev = -1
    for (let p = 0; p <= 1.0001; p += 0.005) {
      const cur = geo(Math.min(1, p)).desiredScrollTop
      expect(cur).toBeGreaterThanOrEqual(prev - 1e-6)
      prev = cur
    }
  })
  it('bandTopContent is non-decreasing across p = 0 → 1', () => {
    let prev = -1
    for (let p = 0; p <= 1.0001; p += 0.005) {
      const cur = geo(Math.min(1, p)).bandTopContent
      expect(cur).toBeGreaterThanOrEqual(prev - 1e-6)
      prev = cur
    }
  })
  it('clamps p outside [0,1]', () => {
    expect(geo(-3).desiredScrollTop).toBe(0)
    expect(geo(5).desiredScrollTop).toBeCloseTo(maxScroll, 6)
  })
})

describe('presenterCenteredBandGeometry — irregular verse spacing (non-identity)', () => {
  // Uneven main-panel verse tops (different wrapping/zoom from the presenter). The strict
  // centred invariant must still hold wherever desiredScrollTop is not clamped at an edge.
  const irregTops: Record<number, number> = {
    1: 40, 2: 90, 3: 300, 4: 340, 5: 620, 6: 700, 7: 760, 8: 1000, 9: 1180, 10: 1220, 11: 1360, 12: 1440,
  }
  it('band stays centred wherever the scrollTop clamp is not engaged', () => {
    let checked = 0
    for (let p = 0.05; p <= 0.95; p += 0.01) {
      const g = geo(p, irregTops)
      if (g.desiredScrollTop <= 0.5 || g.desiredScrollTop >= g.maxScroll - 0.5) continue
      const viewportTop = g.bandTopContent - g.desiredScrollTop
      expect(Math.abs(viewportTop - (V - g.bandH) / 2)).toBeLessThan(1)
      checked++
    }
    expect(checked).toBeGreaterThan(20)
  })
  it('desiredScrollTop is still monotonic with irregular tops', () => {
    let prev = -1
    for (let p = 0; p <= 1.0001; p += 0.01) {
      const cur = geo(Math.min(1, p), irregTops).desiredScrollTop
      expect(cur).toBeGreaterThanOrEqual(prev - 1e-6)
      prev = cur
    }
  })
})
