import { describe, it, expect } from 'vitest'
import { tierForOrigin, reasonForOrigin } from '../studyTrailSlice'
import type { NavOrigin } from '@/lib/verseNavigation'

describe('tierForOrigin', () => {
  it('assigns tier 1 (100% clear, never prompted) to TSKe/Classic cross-refs, lexicon occurrences, AI Lookup, and Compare', () => {
    expect(tierForOrigin({ kind: 'cross-ref', source: 'tske' })).toBe(1)
    expect(tierForOrigin({ kind: 'cross-ref', source: 'classic' })).toBe(1)
    expect(tierForOrigin({ kind: 'lexicon-occurrence', strongsNum: 'G26' })).toBe(1)
    expect(tierForOrigin({ kind: 'ai-lookup', question: 'What does love mean?' })).toBe(1)
    expect(tierForOrigin({ kind: 'compare-column' })).toBe(1)
  })

  it('assigns tier 2 (softly inferred, quiet edit affordance) to notes cross-refs, search results, and wikilinks', () => {
    expect(tierForOrigin({ kind: 'cross-ref', source: 'notes' })).toBe(2)
    expect(tierForOrigin({ kind: 'search-result', query: 'love' })).toBe(2)
    expect(tierForOrigin({ kind: 'note-wikilink', noteId: 'n1', noteTitle: 'Sabbath study' })).toBe(2)
    expect(tierForOrigin({ kind: 'verse-popover' })).toBe(2)
    expect(tierForOrigin({ kind: 'history-revisit' })).toBe(2)
  })

  it('assigns tier 3 (ambiguous, must probe) to manual book/chapter picker jumps and unclassified origins', () => {
    expect(tierForOrigin({ kind: 'book-chapter-picker' })).toBe(3)
    expect(tierForOrigin({ kind: 'other' })).toBe(3)
  })
})

describe('reasonForOrigin', () => {
  it('carries the TSKe/Classic/notes reason through when supplied', () => {
    expect(reasonForOrigin({ kind: 'cross-ref', source: 'tske', reason: 'shared theme of love' }))
      .toEqual({ text: 'shared theme of love', tags: ['cross-ref:tske'] })
  })

  it('builds a reason from the asked question for AI Lookup', () => {
    expect(reasonForOrigin({ kind: 'ai-lookup', question: 'What does agape mean?' }))
      .toEqual({ text: 'What does agape mean?', tags: ['ai-lookup'] })
  })

  it('builds a reason from the search query', () => {
    const { text, tags } = reasonForOrigin({ kind: 'search-result', query: 'love' })
    expect(text).toContain('love')
    expect(tags).toContain('search')
  })

  it('has no pre-filled reason for an ambiguous manual jump — only a tag', () => {
    const { text, tags } = reasonForOrigin({ kind: 'book-chapter-picker' })
    expect(text).toBeUndefined()
    expect(tags).toEqual(['manual'])
  })

  it('never throws for every NavOrigin variant', () => {
    const origins: NavOrigin[] = [
      { kind: 'verse-popover' },
      { kind: 'cross-ref', source: 'tske' },
      { kind: 'search-result', query: 'x' },
      { kind: 'lexicon-occurrence', strongsNum: 'H430' },
      { kind: 'note-wikilink', noteId: 'n', noteTitle: 't' },
      { kind: 'ai-lookup', question: 'q' },
      { kind: 'compare-column' },
      { kind: 'book-chapter-picker' },
      { kind: 'history-revisit' },
      { kind: 'other' },
    ]
    for (const o of origins) {
      expect(() => reasonForOrigin(o)).not.toThrow()
      expect(() => tierForOrigin(o)).not.toThrow()
    }
  })
})
