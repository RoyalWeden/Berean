import { describe, it, expect } from 'vitest'
import { computeCaretScrollDelta, DEFAULT_CARET_SCROLL_MARGINS } from '../caretScroll'

// Pure-math coverage only — the actual DOM wiring (view.coordsAtPos, scrollEl.scrollTop)
// lives in NoteEditorPM.tsx and needs real browser layout to test meaningfully; jsdom's
// getBoundingClientRect always returns all-zero rects, so a "test" through the live
// EditorView would just assert 0-delta-does-nothing forever regardless of whether the
// threshold logic is actually correct. This file covers the one part that's genuinely
// verifiable without a real browser: the comfortable-zone math itself.
describe('computeCaretScrollDelta', () => {
  const viewport = { top: 0, bottom: 500 }

  it('returns 0 when the caret is comfortably inside the viewport', () => {
    expect(computeCaretScrollDelta({ top: 250, bottom: 266 }, viewport)).toBe(0)
  })

  it('returns 0 when the caret sits exactly on the comfortable-zone boundary', () => {
    const { topMargin, bottomMargin } = DEFAULT_CARET_SCROLL_MARGINS
    expect(computeCaretScrollDelta({ top: topMargin, bottom: viewport.bottom - bottomMargin }, viewport)).toBe(0)
  })

  it('returns a positive delta when the caret bottom crosses into the bottom margin', () => {
    const { bottomMargin } = DEFAULT_CARET_SCROLL_MARGINS
    const caret = { top: 480, bottom: viewport.bottom - bottomMargin + 10 }
    expect(computeCaretScrollDelta(caret, viewport)).toBe(10)
  })

  it('returns a negative delta when the caret top crosses into the top margin', () => {
    const { topMargin } = DEFAULT_CARET_SCROLL_MARGINS
    const caret = { top: topMargin - 10, bottom: topMargin + 4 }
    expect(computeCaretScrollDelta(caret, viewport)).toBe(-10)
  })

  it('prioritizes the bottom check when both would technically match (degenerate/very short viewport)', () => {
    // A viewport shorter than topMargin + bottomMargin has overlapping "zones" — the
    // function checks bottom first, matching the fact that typing (appending at the
    // caret) is the dominant real-world trigger this feature targets.
    const tinyViewport = { top: 0, bottom: 20 }
    const caret = { top: -5, bottom: 25 }
    expect(computeCaretScrollDelta(caret, tinyViewport)).toBeGreaterThan(0)
  })

  it('respects custom margins', () => {
    const caret = { top: 100, bottom: 120 }
    const wideMargins = { topMargin: 150, bottomMargin: 30 }
    // top (100) < viewport.top + topMargin (150) → scroll up
    expect(computeCaretScrollDelta(caret, viewport, wideMargins)).toBe(-50)
  })
})
