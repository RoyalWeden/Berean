/**
 * TEST-002 (docs/mobile/testing-backlog-2026-09-22.md): every history type the app writes belongs
 * to a category, every category filters to exactly its types, and "Study only" hides routine
 * chapter reads without emptying the Scripture category.
 */
import { describe, it, expect } from 'vitest'
import type { HistoryEntry } from '@/types'
import {
  HISTORY_CATEGORIES, HISTORY_ENTRY_TYPES, countByCategory, filterHistory, isRoutineRead,
  localDateKey, shouldLoadMoreHistory, typesForCategory, type HistoryCategory,
} from '@/lib/historyModel'

let n = 0
const e = (type: HistoryEntry['type'], extra: Partial<HistoryEntry> = {}): HistoryEntry =>
  ({ id: `h${n++}`, timestamp: Date.UTC(2026, 8, 22, 12), type, title: type, ...extra })

const sample: HistoryEntry[] = [
  e('bible', { bookId: 'GEN', chapter: 1 }),                 // routine read
  e('bible', { bookId: 'JHN', chapter: 3, verse: 16 }),      // deliberate (verse target)
  e('compare', { bookId: 'GEN', chapter: 1 }),
  e('strongs-click', { strongsNum: 'H7225' }),
  e('lexicon', { strongsNum: 'G3056' }),
  e('note', { noteId: 'n1' }),
  e('search', { query: 'sabbath' }),
  e('youtube', { videoId: 'abc' }),
  e('import', { importSource: 'esword' }),
]

describe('history model', () => {
  it('every written type belongs to exactly one category', () => {
    for (const t of HISTORY_ENTRY_TYPES) {
      const owners = HISTORY_CATEGORIES.filter((c) => c.types?.includes(t))
      expect(owners, t).toHaveLength(1)
    }
  })

  const expected: Record<Exclude<HistoryCategory, 'all'>, HistoryEntry['type'][]> = {
    scripture: ['bible', 'bible', 'compare'],
    notes: ['note'],
    lexicon: ['strongs-click', 'lexicon'],
    youtube: ['youtube'],
    search: ['search'],
    imports: ['import'],
  }
  for (const [cat, types] of Object.entries(expected)) {
    it(`category "${cat}" filters to its own entries`, () => {
      expect(filterHistory(sample, { category: cat as HistoryCategory }).map((x) => x.type)).toEqual(types)
    })
  }

  it('"all" keeps everything', () => expect(filterHistory(sample, { category: 'all' })).toHaveLength(sample.length))

  it('Study only hides routine reads but keeps verse-targeted visits and compare', () => {
    const out = filterHistory(sample, { category: 'scripture', studyOnly: true })
    expect(out.map((x) => [x.type, x.verse])).toEqual([['bible', 16], ['compare', undefined]])
  })

  it('isRoutineRead: chapter-only Scripture visit is routine; others are not', () => {
    expect(isRoutineRead(sample[0])).toBe(true)
    expect(isRoutineRead(sample[1])).toBe(false)
    expect(isRoutineRead(sample[2])).toBe(false)
  })

  it('type chips narrow inside a category', () => {
    expect(filterHistory(sample, { category: 'lexicon', types: new Set(['lexicon']) }).map((x) => x.type)).toEqual(['lexicon'])
    expect(typesForCategory('scripture')).toEqual(['bible', 'compare'])
  })

  it('date filter uses the local calendar day', () => {
    const day = localDateKey(sample[0].timestamp)
    expect(filterHistory(sample, { date: day })).toHaveLength(sample.length)
    expect(filterHistory(sample, { date: '1999-01-01' })).toHaveLength(0)
  })

  it('counts per category', () => {
    const c = countByCategory(sample)
    expect(c).toMatchObject({ all: 9, scripture: 3, notes: 1, lexicon: 2, youtube: 1, search: 1, imports: 1 })
  })

  it('keeps paging while a filter leaves too few rows', () => {
    expect(shouldLoadMoreHistory(3, true, false)).toBe(true)
    expect(shouldLoadMoreHistory(3, false, false)).toBe(false)
    expect(shouldLoadMoreHistory(3, true, true)).toBe(false)
    expect(shouldLoadMoreHistory(200, true, false)).toBe(false)
  })
})
