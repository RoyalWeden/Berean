/**
 * Shared utility: extract Bible verse references from note content.
 * Used by BibleRightPanel (cross-ref panel) and VerseRow (hover tooltip).
 */
import { parseRef } from './parseRef'

export interface NoteVerseRef {
  bookId: string
  chapter: number
  verse: number
  /** True when the note referenced a whole chapter (no specific verse), e.g. "Genesis 5".
   *  Such a ref should match/indicate every verse in that chapter. */
  isChapter?: boolean
  sourceNoteTitle: string
  context: string
}

/** Does a cross-ref point at the given verse? A chapter-level ref matches any verse in its chapter.
 *  Chapter refs are stored with verse === 0 (matching the sidepanel display convention). */
export function refMatchesVerse(ref: NoteVerseRef, bookId: string, chapter: number, verseNum: number): boolean {
  if (ref.bookId !== bookId || ref.chapter !== chapter) return false
  return ref.isChapter || ref.verse === 0 || ref.verse === verseNum
}

/** Creates a fresh RegExp each call to avoid lastIndex state issues. */
function makeVerseRefRe() {
  // Matches things like "Gen 1:1", "genesis 1:1", "1 Kings 4:3", as well as [[wikilinks]]
  return /\b((?:[1-3]\s+)?[A-Za-z][a-z]*(?:\s+(?:of\s+)?[A-Za-z][a-z]*)*\s+\d{1,3}(?::\d{1,3})?)\b|\[\[([^\]]*\d+[:/][^\]]*)\]\]/gi
}

export function extractRefsFromNote(content: string, noteTitle: string): NoteVerseRef[] {
  const results: NoteVerseRef[] = []
  const seen = new Set<string>()
  const re = makeVerseRefRe()
  let m: RegExpExecArray | null

  while ((m = re.exec(content)) !== null) {
    const raw = (m[1] ?? m[2] ?? '').trim().replace(/\[\[|\]\]/g, '')
    if (!raw) continue
    // The regex can greedily prepend a non-book word ("quotes Genesis 5").
    // Try the full phrase, then drop leading words until parseRef succeeds.
    let parsed = parseRef(raw)
    if (!parsed) {
      const words = raw.split(/\s+/)
      for (let start = 1; start < words.length && !parsed; start++) {
        parsed = parseRef(words.slice(start).join(' '))
      }
    }
    if (!parsed) {
      // The regex may have swallowed a digit belonging to a following numbered
      // book, e.g. "quoting 1 Kings 8" matches "quoting 1" and eats the "1".
      // Rewind lastIndex past the first word so "1 Kings 8" gets a fresh match.
      const firstWord = raw.split(/\s+/)[0]
      const wordIdx = m.index + (m[0].indexOf(firstWord) >= 0 ? m[0].indexOf(firstWord) : 0)
      const rewind = wordIdx + firstWord.length
      if (rewind > m.index && rewind > re.lastIndex - m[0].length) re.lastIndex = rewind
      continue
    }
    const isChapter = parsed.verse == null
    const key = `${parsed.bookId}.${parsed.chapter}.${isChapter ? 'ch' : parsed.verse}`
    if (seen.has(key)) continue
    seen.add(key)
    const context = content
      .slice(Math.max(0, m.index - 35), m.index + m[0].length + 35)
      .trim()
      .replace(/\[\[|\]\]/g, '')
    results.push({
      bookId: parsed.bookId,
      chapter: parsed.chapter,
      // verse 0 = whole chapter (matches the sidepanel RefLabel/VerseText display convention)
      verse: parsed.verse ?? 0,
      isChapter,
      sourceNoteTitle: noteTitle,
      context,
    })
  }
  return results
}
