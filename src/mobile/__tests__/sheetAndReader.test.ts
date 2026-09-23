/**
 * Wave 3 (docs/mobile/testing-backlog-2026-09-22.md): the reusable sheet detent model
 * (TEST-026/027/040), the reader's top-bar auto-hide (TEST-029) and per-tab reader scroll memory.
 */
import { describe, it, expect } from 'vitest'
import { resolveDetentHeights, settleDetent } from '../primitives/Sheet'
import { stepHideOnScroll, HIDE_AFTER_PX } from '../reader/useHideOnScroll'
import { readerScrollMemory } from '../reader/readerScrollMemory'

describe('sheet detents', () => {
  const vh = 800
  it('a verse sheet has the special low position first; other sheets do not', () => {
    expect(resolveDetentHeights(vh, [0.55, 0.92], 180)).toEqual([180, 440, 736])
    expect(resolveDetentHeights(vh, [0.6, 0.92])).toEqual([480, 736])
  })
  it('the low position never exceeds the next detent', () => {
    expect(resolveDetentHeights(vh, [0.2], 400)).toEqual([160, 160])
  })
  const heights = resolveDetentHeights(vh, [0.55, 0.92], 180)
  it('a fast downward fling closes from ANY position (TEST-040)', () => {
    expect(settleDetent({ heights, vh, releaseY: vh - 736, velocityY: 1600, current: 2 })).toBe(-1)
    expect(settleDetent({ heights, vh, releaseY: vh - 440, velocityY: 1600, current: 1 })).toBe(-1)
  })
  it('a slow drag settles on the nearest position', () => {
    expect(settleDetent({ heights, vh, releaseY: vh - 430, velocityY: 0, current: 2 })).toBe(1)
    expect(settleDetent({ heights, vh, releaseY: vh - 190, velocityY: 0, current: 1 })).toBe(0)
  })
  it('dragging well below the lowest position dismisses', () => {
    expect(settleDetent({ heights, vh, releaseY: vh - 60, velocityY: 0, current: 0 })).toBe(-1)
  })
})

describe('reader top bar auto-hide (TEST-029)', () => {
  it('stays shown near the top and for tiny movements, hides after a real downward scroll', () => {
    let st = { hidden: false, acc: 0 }
    st = stepHideOnScroll(st, 0, 30); expect(st.hidden).toBe(false)          // near the top
    st = stepHideOnScroll(st, 200, 210); expect(st.hidden).toBe(false)       // jitter
    st = stepHideOnScroll(st, 210, 210 + HIDE_AFTER_PX + 5); expect(st.hidden).toBe(true)
  })
  it('a small upward scroll reveals it; jitter does not flicker it', () => {
    let st = { hidden: true, acc: 0 }
    st = stepHideOnScroll(st, 500, 495); expect(st.hidden).toBe(true)
    st = stepHideOnScroll(st, 495, 480); expect(st.hidden).toBe(false)
  })
})

describe('reader scroll memory', () => {
  it('restores only for the same passage', () => {
    readerScrollMemory.save('t1', 'GEN:1:kjva', 420)
    expect(readerScrollMemory.restore('t1', 'GEN:1:kjva')).toBe(420)
    expect(readerScrollMemory.restore('t1', 'GEN:2:kjva')).toBeUndefined()
    expect(readerScrollMemory.restore('t2', 'GEN:1:kjva')).toBeUndefined()
  })
})
