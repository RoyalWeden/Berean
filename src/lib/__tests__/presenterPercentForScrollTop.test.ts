/**
 * presenterPercentForScrollTop — the inverse of presenterCenteredBandGeometry(...).desiredScrollTop.
 *
 * Round-trips against the same 12-verse identity fixture presenterCenteredBand.test.ts uses
 * (presenterFracToMainY(F) === 1500·F everywhere), wherever desiredScrollTop is not clamped at an
 * edge; endpoints map straight to 0 / 1; monotonic non-decreasing in scrollTop.
 */
import { describe, it, expect } from 'vitest'
import { presenterCenteredBandGeometry, presenterPercentForScrollTop, sortVerseFracs } from '../presenterBand'

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
const inp = { f, entries, tops: idTops, mainH, V }
const geo = (p: number) => presenterCenteredBandGeometry({ ...inp, p })

describe('presenterPercentForScrollTop', () => {
  it('round-trips p in 0.05..0.95 where desiredScrollTop is not clamped', () => {
    let checked = 0
    for (let p = 0.05; p <= 0.9501; p += 0.05) {
      const d = geo(p).desiredScrollTop
      if (d <= 0 || d >= maxScroll) continue // skip clamped points — not invertible there
      const back = presenterPercentForScrollTop(d, inp)
      expect(Math.abs(back - p)).toBeLessThan(0.01)
      checked++
    }
    expect(checked).toBeGreaterThan(10)
  })

  it('scrollTop <= 0 → 0', () => {
    expect(presenterPercentForScrollTop(0, inp)).toBe(0)
    expect(presenterPercentForScrollTop(-50, inp)).toBe(0)
  })

  it('scrollTop >= maxScroll → 1', () => {
    expect(presenterPercentForScrollTop(maxScroll, inp)).toBe(1)
    expect(presenterPercentForScrollTop(maxScroll + 100, inp)).toBe(1)
  })

  it('is monotonic non-decreasing in scrollTop', () => {
    let prev = -1
    for (let s = 0; s <= maxScroll; s += 10) {
      const cur = presenterPercentForScrollTop(s, inp)
      expect(cur).toBeGreaterThanOrEqual(prev - 1e-9)
      prev = cur
    }
  })
})
