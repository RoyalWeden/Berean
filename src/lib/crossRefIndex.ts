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
import { getAllNotes } from './notesCache'
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
  /** When true, notes that only reference this verse via a whole-chapter ref are excluded.
   *  Use this for the per-verse hover tooltip so chapter-level refs don't appear as noise. */
  excludeChapterRefs = false,
): NoteVerseRef[] {
  const out: NoteVerseRef[] = []
  for (const s of sources) {
    // Skip a note pointing at its own verse.
    if (s.homeBookId === bookId && s.homeChapter === chapter && s.homeVerse === verseNum) continue
    const matchingRefs = s.refs.filter((r) => refMatchesVerse(r, bookId, chapter, verseNum))
    if (matchingRefs.length === 0) continue
    // If excluding chapter refs, require at least one non-chapter match.
    if (excludeChapterRefs && matchingRefs.every((r) => r.isChapter || r.verse === 0)) continue
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

/** Returns the set of source notes that reference a whole chapter (not a specific verse).
 *  Used to build the chapter-level cross-ref banner in ChapterView. */
export function chapterCrossRefSources(
  sources: CrossRefSource[],
  bookId: string,
  chapter: number,
): CrossRefSource[] {
  return sources.filter((s) =>
    s.refs.some((r) => r.bookId === bookId && r.chapter === chapter && (r.isChapter || r.verse === 0))
  )
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
  /** When true, whole-chapter refs are skipped (they are shown in the chapter banner instead). */
  excludeChapterRefs = false,
): Record<number, boolean> {
  for (const s of sources) {
    for (const r of s.refs) {
      if (r.bookId !== bookId || r.chapter !== chapter) continue
      if (r.isChapter || r.verse === 0) {
        if (!excludeChapterRefs) for (const vn of chapterVerseNums) flags[vn] = true
      } else if (r.endVerse != null && r.endVerse > r.verse) {
        for (let v = r.verse; v <= r.endVerse; v++) flags[v] = true
      } else {
        flags[r.verse] = true
      }
    }
  }
  return flags
}

/**
 * Like flagReciprocalVerses but ONLY for whole-chapter references (isChapter / verse === 0).
 * Use this alongside flagReciprocalVerses to distinguish chapter-level cross-refs from
 * verse-specific ones so the UI can display them with different indicators.
 */
export function flagReciprocalChapterRefs(
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
      promise: getAllNotes(token)
        .then((notes) => buildCrossRefSources(notes as MinimalNote[]))
        .catch(() => [] as CrossRefSource[]),
    }
  }
  return cache.promise
}
