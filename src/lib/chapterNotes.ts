import type { Note } from '@/types'
import { buildCrossRefSources, chapterCrossRefSources } from './crossRefIndex'
import { getAllNotes } from './notesCache'

/**
 * The notes of a whole CHAPTER (NOTES-CH-001) — built on the existing canonical classification,
 * not a new one:
 *   attached  notes whose own reference IS the chapter (`verseRef` = "BOOK.CH", a chapter note —
 *             the same test the desktop right panel's "chapter" group uses)
 *   cites     verse notes elsewhere whose text cites the whole chapter ("Matthew 10") — exactly the
 *             sources of the chapter cross-ref banner (crossRefIndex.chapterCrossRefSources)
 * One entry per note (a note that is both, or cites the chapter several ways, appears once;
 * attached wins). Verse-specific notes are NOT chapter notes — they keep their verse indicators.
 */
export interface ChapterNoteEntry {
  noteId: string
  title: string
  kind: 'attached' | 'cites'
  /** For `cites`: the verse the citing note belongs to. */
  from?: { bookId: string; chapter: number; verse: number }
  preview: string
}

const previewOf = (content: string) => content.replace(/^---[\s\S]*?---\s*/m, '').replace(/[#>*_`[\]]/g, '').replace(/\s+/g, ' ').trim().slice(0, 140)

export function classifyChapterNotes(notes: ReadonlyArray<Pick<Note, 'id' | 'title' | 'content' | 'verseRef'> & { deletedAt?: number | null }>, bookId: string, chapter: number): ChapterNoteEntry[] {
  const out = new Map<string, ChapterNoteEntry>()
  const live = notes.filter((n) => !n.deletedAt)
  for (const n of live) {
    if (n.verseRef === `${bookId}.${chapter}`) out.set(n.id, { noteId: n.id, title: n.title || 'Untitled', kind: 'attached', preview: previewOf(n.content ?? '') })
  }
  const byId = new Map(live.map((n) => [n.id, n]))
  for (const s of chapterCrossRefSources(buildCrossRefSources(live.map((n) => ({ id: n.id, title: n.title ?? null, content: n.content ?? '', verseRef: n.verseRef ?? null }))), bookId, chapter)) {
    if (!s.noteId || out.has(s.noteId)) continue
    out.set(s.noteId, { noteId: s.noteId, title: s.title, kind: 'cites', from: { bookId: s.homeBookId, chapter: s.homeChapter, verse: s.homeVerse }, preview: previewOf(byId.get(s.noteId)?.content ?? '') })
  }
  return [...out.values()]
}

/** The chapter's notes from the shared notes cache (re-read on every note change token). */
export async function loadChapterNotes(bookId: string, chapter: number, token: number): Promise<ChapterNoteEntry[]> {
  return classifyChapterNotes(await getAllNotes(token), bookId, chapter)
}
