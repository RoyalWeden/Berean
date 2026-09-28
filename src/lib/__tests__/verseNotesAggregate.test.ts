/** SEP27-VERSE-002 — notes on several selected verses: aggregated and de-duplicated. */
import { describe, it, expect } from 'vitest'
import { aggregateVerseNotes } from '@/lib/verseNotesAggregate'
import type { Note } from '@/types'

const n = (id: string, updatedAt: number) => ({ id, title: id, content: '', updatedAt }) as unknown as Note

describe('aggregateVerseNotes', () => {
  it('shows a note attached to several selected verses once, with all its references', () => {
    const shared = n('shared', 5)
    const out = aggregateVerseNotes([
      { ref: 'MAT.23.12', notes: [n('a', 1), shared] },
      { ref: 'MAT.23.13', notes: [shared, n('b', 9)] },
    ])
    expect(out.map((x) => x.note.id)).toEqual(['shared', 'a', 'b'])
    expect(out.find((x) => x.note.id === 'shared')!.refs).toEqual(['MAT.23.12', 'MAT.23.13'])
  })
  it('empty when no selected verse has notes', () => {
    expect(aggregateVerseNotes([{ ref: 'GEN.1.1', notes: [] }])).toEqual([])
  })
})
