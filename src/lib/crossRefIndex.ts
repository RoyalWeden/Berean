/**
 * Reciprocal (backward) cross-reference index.
 *
 * The forward direction is easy: a note's own content is parsed for the verses it
 * points to. The backward direction — "which notes point AT this verse?" — needs to
 * scan every verse note's content, because a note may reference a verse using any
 * form ("Exodus 20:11", "Exod 20:11", "Ex 20:11", "[[Exod 20:11]]", ranges, chapters).
 * A text LIKE search misses abbreviations, so we load all verse notes once and run the
 * real ref parser over each, caching the parsed result per noteChangeToken.
 */
import { extractRefsFromNote, refMatchesVerse } from './noteRefs'
import type { NoteVerseRef } from './noteRefs'

export interface CrossRefSource {
  /** The verse the source note is attached to (the "from" side of a backward ref). */
  homeBookId: string
  homeChapter: number
  homeVerse: number
  title: string
  /** All verse references found in the source note's content. */
  refs: NoteVerseRef[]
}

interface MinimalNote {
  title: string | null
  content: string
  verseRef: string | null
}

/** Parse a list of notes into cross-ref sources (pure — unit testable). */
export function buildCrossRefSources(notes: MinimalNote[]): CrossRefSource[] {
  const sources: CrossRefSource[] = []
  for (const note of notes) {
    if (!note.verseRef) continue // only verse notes are reciprocal sources
    const [bId, chStr, vsStr] = note.verseRef.split('.')
    const ch = parseInt(chStr ?? '0', 10)
    const vs = parseInt(vsStr ?? '0', 10)
    if (!bId || !ch || !vs) continue
    const refs = extractRefsFromNote(note.content, note.title || 'Untitled')
    if (refs.length === 0) continue
    sources.push({ homeBookId: bId, homeChapter: ch, homeVerse: vs, title: note.title || 'Untitled', refs })
  }
  return sources
}

/**
 * Backward cross-refs for a target verse: the home verses of every note whose content
 * references that verse (matching ranges and whole-chapter refs too).
 */
export function reciprocalRefsFor(
  sources: CrossRefSource[],
  bookId: string,
  chapter: number,
  verseNum: number,
): NoteVerseRef[] {
  const out: NoteVerseRef[] = []
  for (const s of sources) {
    // Skip a note pointing at its own verse.
    if (s.homeBookId === bookId && s.homeChapter === chapter && s.homeVerse === verseNum) continue
    if (!s.refs.some((r) => refMatchesVerse(r, bookId, chapter, verseNum))) continue
    if (!out.some((o) => o.bookId === s.homeBookId && o.chapter === s.homeChapter && o.verse === s.homeVerse)) {
      out.push({
        bookId: s.homeBookId,
        chapter: s.homeChapter,
        verse: s.homeVerse,
        sourceNoteTitle: s.title,
        context: '',
      })
    }
  }
  return out
}

/**
 * Flag every verse in a chapter that is referenced by some note (backward direction).
 * Mutates and returns `flags`. Handles single verses, ranges, and whole-chapter refs.
 */
export function flagReciprocalVerses(
  sources: CrossRefSource[],
  bookId: string,
  chapter: number,
  chapterVerseNums: number[],
  flags: Record<number, boolean>,
): Record<number, boolean> {
  for (const s of sources) {
    for (const r of s.refs) {
      if (r.bookId !== bookId || r.chapter !== chapter) continue
      if (r.isChapter || r.verse === 0) {
        for (const vn of chapterVerseNums) flags[vn] = true
      } else if (r.endVerse != null && r.endVerse > r.verse) {
        for (let v = r.verse; v <= r.endVerse; v++) flags[v] = true
      } else {
        flags[r.verse] = true
      }
    }
  }
  return flags
}

// ── Cached loader (renderer-only; uses window.notes) ──────────────────────────

let cache: { token: number; promise: Promise<CrossRefSource[]> } | null = null

/**
 * Load and parse all verse notes into cross-ref sources, cached per noteChangeToken.
 * Concurrent callers for the same token share one fetch.
 */
export function getCrossRefSources(token: number): Promise<CrossRefSource[]> {
  if (!cache || cache.token !== token) {
    cache = {
      token,
      promise: window.notes
        .getNotes(100000, 0)
        .then((notes) => buildCrossRefSources(notes as MinimalNote[]))
        .catch(() => [] as CrossRefSource[]),
    }
  }
  return cache.promise
}
