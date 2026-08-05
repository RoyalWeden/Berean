/**
 * Tests for the LXX (Septuagint) verse-block support and the word-replacer-aware
 * verse-text match sensitivity.
 *
 *  - stripLxxMarker:      B2 — recognise " LXX" suffix / "lxx:" prefix on a reference
 *  - verseTextMatchRatio: B1 — pasted notes use replaced divine names (Yehovah), but the
 *                         DB stores the original (LORD). Applying the word replacer to the
 *                         fetched verse text before scoring must restore a high match ratio.
 */
import { describe, it, expect } from 'vitest'
import { stripLxxMarker, verseTextMatchRatio } from '@/lib/notePreviewRender'
import { applyWordReplacer } from '@/lib/wordReplacer'
import type { WordReplacerRule } from '@/store'

const lordRule: WordReplacerRule = {
  id: 'lord', enabled: true, wholeWord: true,
  queries: ['LORD'], replacement: 'Yehovah',
}

describe('stripLxxMarker — B2 Septuagint reference markers', () => {
  it('strips a trailing " LXX" suffix', () => {
    expect(stripLxxMarker('Isaiah 9:12 LXX')).toEqual({ ref: 'Isaiah 9:12', lxx: true })
  })

  it('strips a tab-separated LXX suffix case-insensitively', () => {
    expect(stripLxxMarker('Gen 1:1\tlxx')).toEqual({ ref: 'Gen 1:1', lxx: true })
  })

  it('strips a leading "lxx:" prefix', () => {
    expect(stripLxxMarker('lxx: Psalm 95:1')).toEqual({ ref: 'Psalm 95:1', lxx: true })
  })

  it('strips a leading "LXX:" prefix', () => {
    expect(stripLxxMarker('LXX:Psalm 95:1')).toEqual({ ref: 'Psalm 95:1', lxx: true })
  })

  it('leaves a plain reference untouched', () => {
    expect(stripLxxMarker('John 1:1')).toEqual({ ref: 'John 1:1', lxx: false })
  })

  it('does not treat a book whose name contains no LXX as LXX', () => {
    expect(stripLxxMarker('Malachi 4:5').lxx).toBe(false)
  })
})

describe('verseTextMatchRatio — B1 word-replacer sensitivity', () => {
  const noteText = 'For the people turneth not unto him that smiteth them, neither do they seek Yehovah of hosts.'
  const dbText   = 'For the people turneth not unto him that smiteth them, neither do they seek the LORD of hosts.'

  it('scores low when the DB still says LORD but the note says Yehovah', () => {
    // "yehovah" has no counterpart in the raw DB text → one miss.
    expect(verseTextMatchRatio(noteText, dbText)).toBeLessThan(1)
  })

  it('scores a perfect match once the word replacer is applied to the DB text', () => {
    const replaced = applyWordReplacer(dbText, [lordRule])
    expect(verseTextMatchRatio(noteText, replaced)).toBe(1)
  })

  it('still scores high enough to accept above the 0.9 threshold', () => {
    const replaced = applyWordReplacer(dbText, [lordRule])
    expect(verseTextMatchRatio(noteText, replaced)).toBeGreaterThanOrEqual(0.9)
  })
})
