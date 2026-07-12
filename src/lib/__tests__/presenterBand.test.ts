/**
 * Presenter outline-band geometry suite.
 *
 * Verifies that the band drawn in the main panel maps the presenter's visible window onto
 * the main panel's own verse positions accurately — independent of window size, zoom (font
 * scale), chapter-header height, and text wrapping — and that it tracks scroll position.
 */
import { describe, it, expect } from 'vitest'
import { computePresenterBand, presenterFracToMainY, sortVerseFracs, measureContentHeight, CONTENT_HEIGHT_PADDING_PX } from '../presenterBand'

// A presenter layout: 100px header, 5 verses through a 1000px content, 400px viewport.
const presenterVerseFracs = { 1: 0.10, 2: 0.25, 3: 0.45, 4: 0.65, 5: 0.85 }
const presenterF = 400 / 1000 // 0.4 visible

// A *larger* main panel (2000px content) with a different header (50px) and different
// verse spacing — i.e. different wrapping/zoom from the presenter.
const mainTops = { 1: 50, 2: 350, 3: 750, 4: 1150, 5: 1650 }
const mainH = 2000
const mainClient = 800

function band(scrollTop: number, f = presenterF, verseFracs = presenterVerseFracs, tops = mainTops, H = mainH, client = mainClient) {
  return computePresenterBand({
    visibleFraction: f, verseFracs, mainTops: tops,
    mainScrollHeight: H, mainClientHeight: client, mainScrollTop: scrollTop,
  })
}

describe('presenterFracToMainY anchoring', () => {
  const entries = sortVerseFracs(presenterVerseFracs)
  it('maps a verse-top fraction to that verse top in the main panel', () => {
    expect(presenterFracToMainY(0.25, entries, mainTops, mainH)).toBeCloseTo(350, 5) // verse 2
    expect(presenterFracToMainY(0.65, entries, mainTops, mainH)).toBeCloseTo(1150, 5) // verse 4
  })
  it('interpolates within a verse gap', () => {
    // 0.35 is halfway between v2(0.25) and v3(0.45) → halfway between 350 and 750 = 550
    expect(presenterFracToMainY(0.35, entries, mainTops, mainH)).toBeCloseTo(550, 5)
  })
  it('maps the header region proportionally to the main header', () => {
    // F below first verse frac → proportional within [0, mainTops[1]]
    expect(presenterFracToMainY(0.05, entries, mainTops, mainH)).toBeCloseTo(25, 5) // half of 50
    expect(presenterFracToMainY(0, entries, mainTops, mainH)).toBeCloseTo(0, 5)
  })
  it('maps the trailing region proportionally to the content bottom', () => {
    expect(presenterFracToMainY(1, entries, mainTops, mainH)).toBeCloseTo(2000, 5)
  })
})

describe('computePresenterBand across scroll positions', () => {
  it('starts at the very top of content when scrolled to top', () => {
    const b = band(0)!
    expect(b.top).toBeCloseTo(0, 5)
    expect(b.height).toBeGreaterThan(0)
  })
  it('ends at the very bottom of content when scrolled to bottom', () => {
    const maxScroll = mainH - mainClient
    const b = band(maxScroll)!
    expect(b.top + b.height).toBeCloseTo(mainH, 1)
  })
  it('moves the band down monotonically as the panel scrolls', () => {
    const tops = [0, 200, 600, mainH - mainClient].map((s) => band(s)!.top)
    for (let i = 1; i < tops.length; i++) expect(tops[i]).toBeGreaterThanOrEqual(tops[i - 1])
  })
  it('keeps the band inside the content bounds at every scroll position', () => {
    for (let s = 0; s <= mainH - mainClient; s += 80) {
      const b = band(s)!
      expect(b.top).toBeGreaterThanOrEqual(0)
      expect(b.top + b.height).toBeLessThanOrEqual(mainH + 0.5)
    }
  })
})

describe('adapts to the presenter window size / zoom', () => {
  it('a more zoomed-in presenter (smaller visible fraction) yields a shorter band', () => {
    const big = band(600, 0.6)!  // presenter shows 60% of content
    const small = band(600, 0.2)! // zoomed in: shows only 20%
    expect(small.height).toBeLessThan(big.height)
  })
  it('a presenter showing the whole chapter outlines (nearly) the whole main content', () => {
    const b = band(0, 1)!
    expect(b.top).toBeCloseTo(0, 5)
    expect(b.height).toBeCloseTo(mainH, 1)
  })
})

describe('identity: matching layouts reduce to the exact proportional window', () => {
  // When the main panel's verse positions match the presenter's fractions exactly, the
  // anchored mapping must reduce to the plain proportional band — proving no distortion.
  const idTops = Object.fromEntries(Object.entries(presenterVerseFracs).map(([v, f]) => [v, f * mainH]))
  it.each([0, 0.25, 0.5, 0.8, 1])('p=%s', (p) => {
    const maxScroll = mainH - mainClient
    const b = computePresenterBand({
      visibleFraction: presenterF, verseFracs: presenterVerseFracs, mainTops: idTops,
      mainScrollHeight: mainH, mainClientHeight: mainClient, mainScrollTop: p * maxScroll,
    })!
    expect(b.top).toBeCloseTo(p * (1 - presenterF) * mainH, 4)
    expect(b.height).toBeCloseTo(presenterF * mainH, 4)
  })
})

describe('degenerate inputs', () => {
  it('returns null when nothing is visible / no content', () => {
    expect(band(0, 0)).toBeNull()
    expect(computePresenterBand({
      visibleFraction: 0.4, verseFracs: presenterVerseFracs, mainTops,
      mainScrollHeight: 0, mainClientHeight: 0, mainScrollTop: 0,
    })).toBeNull()
  })
  it('falls back to a proportional band when no verse anchors are present', () => {
    const b = computePresenterBand({
      visibleFraction: 0.5, verseFracs: {}, mainTops: {},
      mainScrollHeight: 1000, mainClientHeight: 500, mainScrollTop: 250,
    })!
    // p = 250/500 = 0.5 → topFrac = 0.5*0.5 = 0.25 → 250px; botFrac = 0.75 → 750px
    expect(b.top).toBeCloseTo(250, 4)
    expect(b.height).toBeCloseTo(500, 4)
  })
})

describe('visible verse range (for the "audience sees v.N–M" label)', () => {
  it('reports the verses overlapping the visible fraction window when scrolled to top', () => {
    const b = band(0)!
    // topFrac=0, botFrac=0.4 → v1 (0.10–0.25) and v2 (0.25–0.45) overlap; v3 starts at 0.45, outside.
    expect(b.firstVerse).toBe(1)
    expect(b.lastVerse).toBe(2)
  })
  it('reports the verses overlapping the visible fraction window when scrolled to bottom', () => {
    const maxScroll = mainH - mainClient
    const b = band(maxScroll)!
    // p=1, f=0.4 → topFrac=0.6, botFrac=1 → v3 (0.45–0.65) already overlaps at its tail
    // (end 0.65 > topFrac 0.6), plus v4 (0.65–0.85) and v5 (0.85–1.0).
    expect(b.firstVerse).toBe(3)
    expect(b.lastVerse).toBe(5)
  })
  it('returns null/null when there are no verse anchors', () => {
    const b = computePresenterBand({
      visibleFraction: 0.5, verseFracs: {}, mainTops: {},
      mainScrollHeight: 1000, mainClientHeight: 500, mainScrollTop: 250,
    })!
    expect(b.firstVerse).toBeNull()
    expect(b.lastVerse).toBeNull()
  })
})

describe('measureContentHeight (shared between main + viewer windows)', () => {
  it('uses last-verse-bottom + padding when it fits under scrollHeight', () => {
    expect(measureContentHeight(1000, 600)).toBe(600 + CONTENT_HEIGHT_PADDING_PX)
  })
  it('clamps to scrollHeight when content-bottom + padding would exceed it', () => {
    expect(measureContentHeight(500, 498)).toBe(500)
  })
  it('falls back to raw scrollHeight when contentBottom is 0 (no measured verses)', () => {
    expect(measureContentHeight(800, 0)).toBe(800)
  })
})
