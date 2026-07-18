/**
 * Shared utility: extract Bible verse references from note content.
 * Used by BibleRightPanel (cross-ref panel) and VerseRow (hover tooltip).
 */
import { parseRef, AMBIGUOUS_PATTERNS, isExactBookToken } from './parseRef'

export interface NoteVerseRef {
  bookId: string
  chapter: number
  verse: number
  /** Last verse of a range, e.g. 22 for "Romans 9:21-22". Undefined for single verses. */
  endVerse?: number
  /** True when the note referenced a whole chapter (no specific verse), e.g. "Genesis 5".
   *  Such a ref should match/indicate every verse in that chapter. */
  isChapter?: boolean
  sourceNoteTitle: string
  context: string
}

/** Does a cross-ref point at the given verse?
 *  - Chapter refs (isChapter / verse 0) match every verse in that chapter.
 *  - Range refs (endVerse set) match any verse within [verse, endVerse].
 *  - Single verse refs match only their exact verse. */
export function refMatchesVerse(ref: NoteVerseRef, bookId: string, chapter: number, verseNum: number): boolean {
  if (ref.bookId !== bookId || ref.chapter !== chapter) return false
  if (ref.isChapter || ref.verse === 0) return true
  if (ref.endVerse != null && ref.endVerse > ref.verse) {
    return verseNum >= ref.verse && verseNum <= ref.endVerse
  }
  return ref.verse === verseNum
}

/** Creates a fresh RegExp each call to avoid lastIndex state issues. */
function makeVerseRefRe() {
  // Matches "Gen 1:1", "Genesis 1:1-5", "Romans 9:21–22", "1 Kings 4:3", [[wikilinks]]
  // The verse-range suffix (?:[-–]\d{1,3})? captures end-verse for ranges like "9:21-22".
  return /\b((?:[1-3]\s+)?[A-Za-z][a-z]*(?:\s+(?:of\s+)?[A-Za-z][a-z]*)*\s+\d{1,3}(?::\d{1,3}(?:\s*[-–]\s*\d{1,3})?)?)\b|\[\[([^\]]*\d+[:/][^\]]*)\]\]/gi
}

export function extractRefsFromNote(content: string, noteTitle: string): NoteVerseRef[] {
  const results: NoteVerseRef[] = []
  const seen = new Set<string>()
  const re = makeVerseRefRe()
  let m: RegExpExecArray | null

  while ((m = re.exec(content)) !== null) {
    // Strip wikilink brackets and Obsidian display-text suffix ("[[Rom 9:21-22|potter]]" → "Rom 9:21-22")
    const isWikilink = m[2] != null
    const raw = (m[1] ?? m[2] ?? '').trim().replace(/\[\[|\]\]/g, '').replace(/\|.*$/, '')
    if (!raw) continue
    // The regex can greedily prepend a non-book word ("quotes Genesis 5").
    // Try the full phrase, then drop leading words until parseRef succeeds.
    let parsed = parseRef(raw)
    let matchedCandidate = parsed ? raw : ''
    if (!parsed) {
      const words = raw.split(/\s+/)
      for (let start = 1; start < words.length && !parsed; start++) {
        const candidate = words.slice(start).join(' ')
        parsed = parseRef(candidate)
        if (parsed) matchedCandidate = candidate
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

    // ── Ambiguous-pattern guard (plain-text refs only, not [[wikilinks]]) ─────
    // If the book was matched via a pattern that is also a common English word,
    // abbreviation, or symbol (e.g. "is", "re", "col", "her", "job"), require
    // either: (a) the first character of the book portion is uppercase in the
    // original note content, or (b) the reference contains a colon (chapter:verse).
    // This prevents "is 99% done" → Isaiah or "her 5 children" → Hermas.
    if (!isWikilink) {
      const bookPart = matchedCandidate.replace(/\s*\d[\d:–\-]*$/, '').trimEnd()
      const lastBookToken = bookPart.split(/\s+/).pop()?.toLowerCase().replace(/\.$/, '') ?? ''
      if (AMBIGUOUS_PATTERNS.has(lastBookToken) || !isExactBookToken(bookPart)) {
        const hasColon = matchedCandidate.includes(':')
        // Find first char of the matched candidate in the original content
        const candidateStart = content.indexOf(matchedCandidate, m.index)
        const firstChar = candidateStart >= 0 ? content[candidateStart] : matchedCandidate[0]
        const isCapitalised = /[A-Z]/.test(firstChar ?? '')
        if (!hasColon && !isCapitalised) continue
      }
    }
    const isChapter = parsed.verse == null
    const key = `${parsed.bookId}.${parsed.chapter}.${isChapter ? 'ch' : parsed.verse}${parsed.endVerse != null ? `-${parsed.endVerse}` : ''}`
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
      endVerse: parsed.endVerse,
      isChapter,
      sourceNoteTitle: noteTitle,
      context,
    })
  }
  return results
}
