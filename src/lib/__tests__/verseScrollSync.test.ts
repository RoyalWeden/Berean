import { describe, it, expect } from 'vitest'
import { encodeScrollPosition, decodeScrollPosition } from '../verseScrollSync'

/** Builds a fake scroll container with N verse rows of given heights, stacked
 *  top-to-bottom starting at containerTop, with getBoundingClientRect mocked per
 *  element (jsdom doesn't compute real layout) — `scrollTop` shifts every row's
 *  reported top by -scrollTop, matching how a real scrolled container behaves. */
function makeContainer(rowHeights: number[], containerTop = 0) {
  const container = document.createElement('div')
  let scrollTop = 0
  Object.defineProperty(container, 'scrollTop', {
    get: () => scrollTop,
    set: (v) => { scrollTop = v },
  })
  container.getBoundingClientRect = () => ({ top: containerTop } as DOMRect)

  let cumTop = 0
  const verseEls: HTMLElement[] = []
  for (let i = 0; i < rowHeights.length; i++) {
    const el = document.createElement('div')
    el.dataset.verse = String(i + 1)
    const top = cumTop
    const height = rowHeights[i]
    el.getBoundingClientRect = () => ({ top: containerTop + top - scrollTop, height } as DOMRect)
    container.appendChild(el)
    verseEls.push(el)
    cumTop += height
  }
  return container
}

describe('encodeScrollPosition', () => {
  it('returns null for a container with no verse rows', () => {
    const container = document.createElement('div')
    container.getBoundingClientRect = () => ({ top: 0 } as DOMRect)
    expect(encodeScrollPosition(container)).toBeNull()
  })

  it('anchors on verse 1 at frac 0 when scrolled to the very top', () => {
    const container = makeContainer([20, 20, 20])
    expect(encodeScrollPosition(container)).toEqual({ verseNum: 1, frac: 0 })
  })

  it('reports a mid-verse fraction when scrolled partway into a row', () => {
    // Each row is 20px; scroll 5px into verse 1 → verse 1, frac 0.25.
    const container = makeContainer([20, 20, 20])
    container.scrollTop = 5
    expect(encodeScrollPosition(container)).toEqual({ verseNum: 1, frac: 0.25 })
  })

  it('anchors on the verse whose top has crossed above the container edge', () => {
    // Scroll 25px: verse 1 (0-20) is fully above the edge, verse 2 (20-40) is the
    // one straddling it, 5px into its own 20px row → frac 0.25.
    const container = makeContainer([20, 20, 20])
    container.scrollTop = 25
    expect(encodeScrollPosition(container)).toEqual({ verseNum: 2, frac: 0.25 })
  })

  it('clamps to the last verse when scrolled past the final row', () => {
    const container = makeContainer([20, 20, 20])
    container.scrollTop = 100
    const pos = encodeScrollPosition(container)
    expect(pos?.verseNum).toBe(3)
  })
})

describe('decodeScrollPosition', () => {
  it('round-trips within the SAME container (uniform row heights)', () => {
    const container = makeContainer([20, 20, 20])
    container.scrollTop = 25
    const pos = encodeScrollPosition(container)!
    const target = decodeScrollPosition(container, pos)
    expect(target).toBeCloseTo(25, 5)
  })

  it('maps a position onto a DIFFERENT container with different row heights', () => {
    // Column A: uniform 20px rows, scrolled 25px → verse 2, frac 0.25 (see above).
    const colA = makeContainer([20, 20, 20])
    colA.scrollTop = 25
    const pos = encodeScrollPosition(colA)!
    expect(pos).toEqual({ verseNum: 2, frac: 0.25 })

    // Column B: verse 1 is a much taller 60px row (a longer translation), verse 2
    // is 40px. Decoding the SAME { verseNum: 2, frac: 0.25 } onto column B should
    // land at verse 2's own top (60) plus 25% of ITS OWN 40px row (10) = 70,
    // not simply re-using column A's raw 25px pixel offset — this is the whole
    // point of encoding as verse+fraction instead of a pixel scrollTop.
    const colB = makeContainer([60, 40, 40])
    const target = decodeScrollPosition(colB, pos)
    expect(target).toBeCloseTo(70, 5)
  })

  it('returns null when the target verse does not exist in the container', () => {
    const colA = makeContainer([20, 20, 20])
    const colB = makeContainer([20, 20]) // only 2 verses
    const pos = { verseNum: 3, frac: 0 }
    expect(decodeScrollPosition(colA, pos)).not.toBeNull()
    expect(decodeScrollPosition(colB, pos)).toBeNull()
  })

  it('accounts for a non-zero existing scrollTop on the target container', () => {
    const container = makeContainer([20, 20, 20])
    container.scrollTop = 10
    // Verse 1 at frac 0 should always resolve to putting verse 1's top at the
    // container's own top edge, i.e. scrollTop 0, regardless of where scrollTop
    // started (decodeScrollPosition adds anchorTop, which is already relative to
    // the CURRENT scrollTop, back onto that same scrollTop).
    const target = decodeScrollPosition(container, { verseNum: 1, frac: 0 })
    expect(target).toBeCloseTo(0, 5)
  })
})
