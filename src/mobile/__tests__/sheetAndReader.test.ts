/**
 * Wave 3 (docs/mobile/testing-backlog-2026-09-22.md): the reusable sheet detent model
 * (TEST-026/027/040), the reader's top-bar auto-hide (TEST-029) and per-tab reader scroll memory.
 */
import { describe, it, expect } from 'vitest'
import { resolveDetentHeights, settleDetent } from '../primitives/Sheet'
import { stepHideOnScroll, hideOnScrollTop, HIDE_AFTER_PX, SHOW_AFTER_PX, SETTLE_FACTOR, type HideOnScrollState } from '../reader/useHideOnScroll'
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
  it('an end-of-chapter rubber-band bounce does not bring the bars back (2026-10-19: max 880 → 914 → 880)', () => {
    const max = { scrollHeight: 1700, clientHeight: 820 } // scrollable range 0…880
    const at = (top: number) => hideOnScrollTop(top, max.scrollHeight, max.clientHeight)
    let st = { hidden: false, acc: 0 }
    let prev = at(600)
    for (const top of [700, 820, 880, 900, 914, 905, 890, 880]) { st = stepHideOnScroll(st, prev, at(top)); prev = at(top) }
    expect(st.hidden).toBe(true) // still reading down: the bounce is not an upward scroll
    // A real upward scroll afterwards still reveals them.
    for (const top of [840, 760, 680]) { st = stepHideOnScroll(st, prev, at(top)); prev = at(top) }
    expect(st.hidden).toBe(false)
    expect(at(-30)).toBe(0) // the top bounce clamps too
  })
  it('a small upward scroll reveals it; jitter does not flicker it', () => {
    let st: HideOnScrollState = { hidden: true, acc: 0 }
    st = stepHideOnScroll(st, 500, 495); expect(st.hidden).toBe(true)
    st = stepHideOnScroll(st, 495, 495 - SHOW_AFTER_PX - 2); expect(st.hidden).toBe(false)
  })
  it('scrolling up and down a few lines right after the bars moved does not flip them every time (2026-10-19)', () => {
    let st: HideOnScrollState = { hidden: false, acc: 0 }
    let top = 400, flips = 0
    const go = (to: number) => { for (const step of [0.25, 0.5, 0.75, 1]) { const next = top + (to - top) * step; const was = st.hidden; st = stepHideOnScroll(st, top + (to - top) * (step - 0.25), next); if (st.hidden !== was) flips++ } top = to }
    go(460) // reading down: the bars go away
    expect(st.hidden).toBe(true)
    for (let i = 0; i < 4; i++) { go(top - 60); go(top + 60) } // re-reading: ±60 px, four times
    expect(flips).toBe(1)
    // A deliberate scroll back up still brings them back, even right after.
    go(top - SHOW_AFTER_PX * SETTLE_FACTOR - 10)
    expect(st.hidden).toBe(false)
  })
  it('once settled, the usual small travel works again', () => {
    let st: HideOnScrollState = { hidden: false, acc: 0, anchor: 300 }
    st = stepHideOnScroll(st, 300, 300 + HIDE_AFTER_PX + 5); expect(st.hidden).toBe(false) // just moved here: needs more
    st = stepHideOnScroll(st, 345, 600); expect(st.hidden).toBe(true)
    st = stepHideOnScroll(st, 600, 900) // keeps reading down: settles
    st = stepHideOnScroll(st, 900, 900 - SHOW_AFTER_PX - 2); expect(st.hidden).toBe(false)
  })
})

describe('reader scroll memory', () => {
  it('restores a verse anchor for the same book (and chapter, when asked)', () => {
    readerScrollMemory.save('t1', 'GEN', { chapter: 1, verse: 7, offset: -12 })
    expect(readerScrollMemory.restore('t1', 'GEN')).toEqual({ chapter: 1, verse: 7, offset: -12 })
    expect(readerScrollMemory.restore('t1', 'GEN', 1)?.verse).toBe(7)
    expect(readerScrollMemory.restore('t1', 'GEN', 2)).toBeUndefined()
    expect(readerScrollMemory.restore('t1', 'EXO')).toBeUndefined()
    expect(readerScrollMemory.restore('t2', 'GEN')).toBeUndefined()
  })
})
