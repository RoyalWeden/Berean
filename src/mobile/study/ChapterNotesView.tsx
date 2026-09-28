import React, { useEffect, useState } from 'react'
import { BookOpen, NotepadText } from 'lucide-react'
import { useAppStore } from '@/store'
import { bookChapterVerseLabel, bookName } from '@/lib/parseRef'
import { displayChapter } from '@/lib/chapterNumbering'
import { loadChapterNotes, type ChapterNoteEntry } from '@/lib/chapterNotes'
import { openDestination } from '@/lib/navigation/destination'
import type { SheetApi } from '../primitives/Sheet'
import { CrossRefList } from './CrossRefsSheet'
import { pushSheetNoteEditor } from './VerseNotesSheet'
import { displayNoteTitle } from '@/lib/noteTitle'

/** The chapter's notes (lib/chapterNotes), live: re-read on every note change token. */
export function useChapterNotes(bookId: string, chapter: number): ChapterNoteEntry[] | null {
  const token = useAppStore((s) => s.noteChangeToken)
  const [entries, setEntries] = useState<ChapterNoteEntry[] | null>(null)
  useEffect(() => {
    let alive = true
    loadChapterNotes(bookId, chapter, token).then((e) => { if (alive) setEntries(e) }).catch(() => { if (alive) setEntries([]) })
    return () => { alive = false }
  }, [bookId, chapter, token])
  return entries
}

/**
 * The Scripture caret's My Notes (NOTES-CH-001), inside the caret sheet:
 *  - NO verse selected → the chapter's notes (chapter notes + notes citing the whole chapter),
 *    each once; tap → edit it right here (same sheet, "‹ My Notes" returns). These used to show
 *    as a banner over the text on the iPhone.
 *  - verses selected → the existing selected-verse My Notes (notes referencing those verses),
 *    unchanged.
 */
export function ChapterNotesView({ bookId, chapter, textId, selectedVerses, api, onOpenInNotes }: {
  bookId: string; chapter: number; textId: string; selectedVerses: readonly number[]; api: SheetApi
  onOpenInNotes: (noteId: string) => void
}) {
  const entries = useChapterNotes(bookId, chapter)
  const chapterLabel = `${bookName(bookId)} ${displayChapter(bookId, chapter)}`
  if (selectedVerses.length > 0) {
    return (
      <div className="mobile-crossrefs">
        <CrossRefList bookId={bookId} chapter={chapter} verses={selectedVerses} textId={textId} source="notes"
          onNavigate={(r, source, intent) => { api.close(); openDestination({ kind: 'passage', bookId: r.bookId, chapter: r.chapter, verse: r.verse, endVerse: r.endVerse ?? null, ...(r.lxx ? { textId: 'lxx' } : {}) }, intent, { origin: { kind: 'cross-ref', source, fromVerse: selectedVerses[0] } }) }} />
      </div>
    )
  }
  const go = (r: { bookId: string; chapter: number; verse: number; endVerse?: number | null; lxx?: boolean }, source: string, intent: 'current-tab' | 'new-tab') => {
    api.close()
    openDestination({ kind: 'passage', bookId: r.bookId, chapter: r.chapter, verse: r.verse, endVerse: r.endVerse ?? null, ...(r.lxx ? { textId: 'lxx' } : {}) }, intent, { origin: { kind: 'cross-ref', source: source as 'notes' } })
  }
  // No verse selected (XREF-001 §1A): the chapter's notes, then the chapter-level cross references
  // (references made by the chapter's notes, notes citing the chapter, Taylor footnotes) — one scroll.
  return (
    <div className="m-chapter-notes-wrap">
      <section aria-label={`Notes on ${chapterLabel}`}>
        <h4 className="m-xref-heading m-chapter-notes-heading">Notes</h4>
        {entries === null ? <div className="mobile-muted mobile-study-pad">Loading…</div>
          : entries.length === 0 ? <div className="mobile-empty">No notes on {chapterLabel} yet. Notes that cite the whole chapter appear here.</div>
          : (
            <div className="mobile-newtab m-chapter-notes" role="list">
              <div className="mobile-newtab-list">
                {entries.map((e) => (
                  <button key={e.noteId} type="button" role="listitem" className="mobile-newtab-row"
                    onClick={() => pushSheetNoteEditor(api, e.noteId, chapterLabel, onOpenInNotes, 1)}>
                    <span className="mobile-newtab-row-icon">{e.kind === 'attached' ? <BookOpen size={17} aria-hidden /> : <NotepadText size={17} aria-hidden />}</span>
                    <span className="mobile-newtab-row-text">
                      <span>{displayNoteTitle(e.title)}</span>
                      <small>{e.kind === 'attached' ? `Note on ${chapterLabel}` : `Cites ${chapterLabel} · from ${bookChapterVerseLabel(e.from!.bookId, e.from!.chapter, e.from!.verse)}`}{e.preview ? ` — ${e.preview}` : ''}</small>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
      </section>
      <section aria-label={`Cross references for ${chapterLabel}`} className="m-chapter-xrefs">
        <h4 className="m-xref-heading m-chapter-notes-heading">Cross References</h4>
        <CrossRefList bookId={bookId} chapter={chapter} verses={[]} textId={textId} source="notes" variant="compact" onNavigate={go} />
      </section>
    </div>
  )
}
