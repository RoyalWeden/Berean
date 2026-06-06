/**
 * 10 unit tests for the fit-scale calculation used in PrintPreviewModal.
 * The formula: avail = containerWidth - 32 (p-4 each side) - 8 (buffer)
 *              fitScale = clamp(avail / 816, 0.2, 1)
 * PAGE_W_PX = 816 (8.5in @ 96dpi)
 */
import { describe, it, expect } from 'vitest'

const PAGE_W_PX = 816
const PADDING = 32   // p-4 on each side (16px × 2)
const BUFFER  = 8    // safety buffer to prevent horizontal scrollbar

function calcFitScale(containerClientWidth: number): number {
  const avail = containerClientWidth - PADDING - BUFFER
  return Math.min(1, Math.max(0.2, avail / PAGE_W_PX))
}

describe('printFitScale — fit scale calculation', () => {
  it('wide container (1200px) → scales to 1 (page fits at 100%)', () => {
    // avail = 1200 - 32 - 8 = 1160 > 816 → capped at 1
    expect(calcFitScale(1200)).toBe(1)
  })

  it('exact page width + padding + buffer (856px) → 1', () => {
    // avail = 856 - 32 - 8 = 816 = PAGE_W_PX → exactly 1
    expect(calcFitScale(856)).toBe(1)
  })

  it('one pixel wider than needed → still 1 (capped)', () => {
    expect(calcFitScale(857)).toBe(1)
  })

  it('one pixel narrower than needed (855px) → < 1', () => {
    // avail = 855 - 40 = 815 → 815/816 ≈ 0.9988
    const s = calcFitScale(855)
    expect(s).toBeLessThan(1)
    expect(s).toBeCloseTo(815 / 816, 3)
  })

  it('typical sidebar layout (~650px) → correct fraction', () => {
    // avail = 650 - 40 = 610 → 610/816 ≈ 0.7475
    expect(calcFitScale(650)).toBeCloseTo(610 / 816, 3)
  })

  it('narrow panel (500px) → correct fraction', () => {
    // avail = 500 - 40 = 460 → 460/816 ≈ 0.5637
    expect(calcFitScale(500)).toBeCloseTo(460 / 816, 3)
  })

  it('very narrow (200px) → minimum scale (0.2) applied', () => {
    // avail = 200 - 40 = 160 → 160/816 ≈ 0.196 → clamped to 0.2
    expect(calcFitScale(200)).toBe(0.2)
  })

  it('zero container width → minimum scale (0.2)', () => {
    expect(calcFitScale(0)).toBe(0.2)
  })

  it('negative container width → minimum scale (0.2)', () => {
    expect(calcFitScale(-100)).toBe(0.2)
  })

  it('scale never exceeds 1 for any wide container', () => {
    for (const w of [900, 1000, 1200, 1600, 2000]) {
      expect(calcFitScale(w)).toBeLessThanOrEqual(1)
    }
  })
})
