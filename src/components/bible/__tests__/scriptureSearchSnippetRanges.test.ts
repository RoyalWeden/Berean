import { describe, it, expect } from 'vitest'
import { buildAllWordsSnippet, remapRangesToSnippet } from '../ScriptureSearchView'
import { getAnnotationRanges } from '@/lib/verseUtils'

// Regression coverage for "Advanced Scripture Search shows no red-letter/italic markup" —
// root cause was buildAllWordsSnippet's truncated snippet invalidating the FULL-text
// annotation ranges getAnnotationRanges computed, and the caller silently falling back to
// plain highlight() (no ranges at all) whenever that happened — the common case, since the
// default view (context mode off) always goes through this snippet path for 'all' word mode.

const MAT_5_3_TAGGED = '!Blessed{G3107} *are{} !the{G3588} !poor{G4434} !in{G3588} !spirit:{G4151} !for{G3754} !theirs{G846} !is{G2076} !the{G3588} !kingdom{G932} !of{G3588} !heaven.{G3772}'

describe('buildAllWordsSnippet + remapRangesToSnippet', () => {
  it('keeps text unchanged (identity mapping) when the verse already fits maxLen', () => {
    const text = 'Short verse text.'
    const snippet = buildAllWordsSnippet(text, 'Short', 100)
    expect(snippet.text).toBe(text)
    expect(snippet.sliceStart).toBe(0)
    expect(snippet.sliceEnd).toBe(text.length)
    expect(snippet.prefixLen).toBe(0)
  })

  it('remaps a red-letter range that survives truncation into the snippet coordinate space', () => {
    const ranges = getAnnotationRanges(MAT_5_3_TAGGED, 'kjva')
    expect(ranges.length).toBeGreaterThan(0)
    // Everything in this verse is either red-letter or italic — every char is covered by SOME
    // range. Force a small maxLen so buildAllWordsSnippet actually truncates.
    const rawText = 'Blessed are the poor in spirit: for theirs is the kingdom of heaven.'
    const snippet = buildAllWordsSnippet(rawText, 'poor spirit', 30)
    expect(snippet.text.length).toBeLessThan(rawText.length + 2) // truncated (+2 allows both ellipses)
    const remapped = remapRangesToSnippet(ranges, snippet)
    expect(remapped.length).toBeGreaterThan(0)
    // Every remapped range must land INSIDE the snippet's own text bounds — this is the actual
    // bug: a stale full-text offset applied to the (shorter) snippet string would either point
    // past its end or land on the wrong characters entirely.
    for (const r of remapped) {
      expect(r.start).toBeGreaterThanOrEqual(0)
      expect(r.end).toBeLessThanOrEqual(snippet.text.length)
      expect(r.start).toBeLessThan(r.end)
    }
  })

  it('drops a range entirely when it falls outside the kept slice', () => {
    const ranges = [{ start: 0, end: 5, isRedLetter: true, isItalic: false }]
    // A snippet that only kept characters [20, 40) — the range above (0-5) doesn't overlap it.
    const snippet = { text: 'kept slice text here', sliceStart: 20, sliceEnd: 41, prefixLen: 1 }
    expect(remapRangesToSnippet(ranges, snippet)).toEqual([])
  })

  it('clips a range that only partially overlaps the kept slice', () => {
    const ranges = [{ start: 10, end: 30, isRedLetter: false, isItalic: true }]
    const snippet = { text: '…0123456789', sliceStart: 20, sliceEnd: 40, prefixLen: 1 }
    const [r] = remapRangesToSnippet(ranges, snippet)
    // Original range [10,30) clipped to [20,30) (only the part inside [sliceStart, sliceEnd)),
    // then shifted by -sliceStart + prefixLen = -20 + 1 = -19: [20-19, 30-19) = [1, 11).
    expect(r).toEqual({ start: 1, end: 11, isRedLetter: false, isItalic: true })
  })
})
