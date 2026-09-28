/** NOTES-CH-001 — a chapter's notes, from the existing canonical classification. */
import { describe, it, expect } from 'vitest'
import { classifyChapterNotes } from '../chapterNotes'

const n = (id: string, verseRef: string | null, content: string, title = id) => ({ id, title, content, verseRef })

describe('classifyChapterNotes', () => {
  it('chapter notes (verseRef BOOK.CH) and notes citing the whole chapter; verse-specific notes excluded', () => {
    const notes = [
      n('ch', 'MAT.10', 'Overview of the sending of the twelve'),
      n('cite', 'LUK.9.1', 'Compare Matthew 10 for the parallel.'),
      n('verse', 'MAT.10.5', 'Go not into the way of the Gentiles'),
      n('verseCite', 'MRK.6.7', 'See Matthew 10:5 only.'),
      n('other', 'MAT.11', 'Next chapter'),
    ]
    const r = classifyChapterNotes(notes, 'MAT', 10)
    expect(r.map((e) => [e.noteId, e.kind])).toEqual([['ch', 'attached'], ['cite', 'cites']])
    expect(r[1].from).toEqual({ bookId: 'LUK', chapter: 9, verse: 1 })
  })

  it('each note once — a chapter note that also cites its chapter, or cites it several ways', () => {
    const notes = [
      n('both', 'MAT.10', 'Matthew 10 — see also Matt 10 and [[Matthew 10]]'),
      n('twice', 'JHN.1.1', 'Matthew 10 … Mt 10 … Matthew 10'),
    ]
    const r = classifyChapterNotes(notes, 'MAT', 10)
    expect(r.map((e) => e.noteId)).toEqual(['both', 'twice'])
    expect(r[0].kind).toBe('attached')
  })

  it('trashed notes are not listed', () => {
    expect(classifyChapterNotes([{ ...n('gone', 'MAT.10', 'x'), deletedAt: 5 }], 'MAT', 10)).toEqual([])
  })
})
