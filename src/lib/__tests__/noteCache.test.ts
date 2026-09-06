import { describe, it, expect, beforeEach } from 'vitest'
import { getCachedNote, setCachedNote, clearNoteCache } from '../noteCache'
import type { Note } from '@/types'

const mkNote = (id: string): Note => ({
  id, type: 'general', title: id, content: `body ${id}`,
  bookId: null, chapter: null, verse: null, verseRef: null, color: 'blue',
  tags: [], status: null, createdAt: '', updatedAt: '',
} as unknown as Note)

beforeEach(() => clearNoteCache())

describe('noteCache LRU cap', () => {
  it('evicts the oldest entry once past the cap', () => {
    // MAX_ENTRIES is 80; insert 90 distinct notes
    for (let i = 0; i < 90; i++) setCachedNote(mkNote(`n${i}`))
    // The first 10 should have been evicted, the last 80 retained
    expect(getCachedNote('n0')).toBeNull()
    expect(getCachedNote('n9')).toBeNull()
    expect(getCachedNote('n10')).not.toBeNull()
    expect(getCachedNote('n89')).not.toBeNull()
  })

  it('a cache hit refreshes recency so it survives later eviction', () => {
    for (let i = 0; i < 80; i++) setCachedNote(mkNote(`n${i}`))
    getCachedNote('n0')                 // touch the oldest → now most-recently-used
    setCachedNote(mkNote('n80'))        // forces one eviction — should drop n1, not n0
    expect(getCachedNote('n0')).not.toBeNull()
    expect(getCachedNote('n1')).toBeNull()
  })

  it('re-setting an existing id does not grow the cache', () => {
    for (let i = 0; i < 80; i++) setCachedNote(mkNote(`n${i}`))
    setCachedNote(mkNote('n0'))         // update, not insert
    expect(getCachedNote('n1')).not.toBeNull() // nothing evicted
  })
})
