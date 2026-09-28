/**
 * TEST-043 (docs/mobile/testing-backlog-2026-09-22.md): the verse sheet's e-Sword-style study
 * view — words paired with their Strong's numbers, word replacer applied like the reader.
 */
import { describe, it, expect } from 'vitest'
import { buildVerseStudyTokens } from '@/lib/verseUtils'
import { shortRefLabel } from '@/mobile/study/VerseStudy'
import type { WordReplacerRule } from '@/store'

describe('buildVerseStudyTokens', () => {
  it("pairs words with Strong's numbers and attaches particles to the previous word", () => {
    const t = buildVerseStudyTokens('In the beginning God created the heaven', 'In{} the{} beginning{H7225} God{H430} created{H1254} ~{H853} the{} heaven{H8064}', 'kjva', false, [])
    expect(t.map((x) => [x.word, x.strongs])).toEqual([['In', []], ['the', []], ['beginning', ['H7225']], ['God', ['H430']], ['created', ['H1254', '(H853)']], ['the', []], ['heaven', ['H8064']]])
  })
  it('untagged text is one plain token', () => {
    expect(buildVerseStudyTokens('In the beginning', null, 'lxx', false, [])).toEqual([{ word: 'In the beginning', strongs: [], isRedLetter: false, isItalic: false }])
  })
  it('applies the word replacer like the reader', () => {
    const rules: WordReplacerRule[] = [{ id: 'r1', enabled: true, queries: ['LORD'], replacement: 'Yehovah', wholeWord: true }]
    const t = buildVerseStudyTokens('the LORD God', 'the{} LORD{H3068} God{H430}', 'kjva', true, rules)
    expect(t.some((x) => x.word.includes('Yehovah'))).toBe(true)
  })
})

describe('shortRefLabel', () => {
  it('abbreviates the book for the dense cross-reference list', () => {
    expect(shortRefLabel({ bookId: 'NUM', chapter: 1, verse: 21 })).toBe('Num 1:21')
    expect(shortRefLabel({ bookId: 'PRO', chapter: 8, verse: 22, endVerse: 24 })).toBe('Pro 8:22–24')
    expect(shortRefLabel({ bookId: '1JN', chapter: 1, verse: 1 })).toBe('1 Joh 1:1')
  })
})
