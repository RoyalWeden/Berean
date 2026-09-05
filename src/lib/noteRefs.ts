/**
 * Shared utility: extract Bible verse references from note content.
 * Used by BibleRightPanel (cross-ref panel) and VerseRow (hover tooltip).
 */
import { parseRef, AMBIGUOUS_PATTERNS, isExactBookToken } from './parseRef'
import { stripLxxMarker, normalizeRefWhitespace } from './noteTextBlocks'

export interface NoteVerseRef {
  bookId: string
  chapter: number
  verse: number
  /** Last verse of a range, e.g. 22 for "Romans 9:21-22". Undefined for single verses. */
  endVerse?: number
  /** True when the note referenced a whole chapter (no specific verse), e.g. "Genesis 5".
   *  Such a ref should match/indicate every verse in that chapter. */
  isChapter?: boolean
  /** True when the note reference carried a trailing " LXX" marker ("Isaiah 6:4 LXX") —
   *  cross-ref rows built from this entry should resolve against the Septuagint text. */
  lxx?: boolean
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
  // Each book-word component allows an optional trailing digit run (\d*) so fused per-book
  // shorthand ids like "RCL1" (Recognitions of Clement, book 1) are captured as one token —
  // without it, "RCL1 1:1" never matched at all (the required \s+ before the chapter number
  // failed right at the letters/digit boundary). parseRef() still validates the resolved
  // book, so this doesn't introduce new false-positive links.
  // The optional (?:,?\s*Book\s+\d{1,3})? group lets a book-subdivision like "Book 10"
  // (Recognitions of Clement's real 3-level Book.Chapter.Verse addressing) be included
  // in the captured span, so "Recognitions, Book 10 41:8" is handed to parseRef() whole
  // (which resolves the subdivision) instead of the "Book 10" text being dropped/mismatched.
  // The (?!Book\s+\d) lookahead keeps the generic "extra word" repeat from swallowing
  // "Book" as an ordinary book-name word before the explicit group gets a chance — without
  // it, "Recognitions Book 10 41:8" (no comma) matched "Recognitions Book" as the book
  // phrase and silently dropped "41:8" (comma-separated form worked by accident, since a
  // comma isn't part of the ordinary word-repeat's \s+ separator).
  // The trailing `(?:\s*[:.]\s*\d{1,3})?` on the verse-range suffix lets a genuine
  // cross-chapter range ("Isaiah 63:17-64:3") capture its full span — without it this
  // truncated at "63:17-64", silently dropping the trailing ":3" (parseRef, given only
  // the truncated text, then happily accepted it as a bogus same-chapter range instead of
  // failing to match at all — see parseRef.ts's own matching cross-chapter grammar fix).
  // The `(?:\s*,\s*\d{1,3}(?:\s*[-–]\s*\d{1,3})?)*` after the verse-range suffix captures a
  // comma-separated verse list ("Deuteronomy 32:3,6,9-13,23,25") into the same match; each
  // comma segment is split into its own NoteVerseRef in extractRefsFromNote below. The
  // trailing `(?:[ \t]+LXX\b)?` folds an "Isaiah 6:4 LXX" marker into the captured span so
  // the resulting rows can be flagged `lxx` (stripped back off via stripLxxMarker).
  return /\b((?:[1-3]\s+)?[A-Za-z][a-z]*\d*(?:\s+(?:of\s+)?(?!Book\s+\d)[A-Za-z][a-z]*\d*)*(?:,?\s*Book\s+\d{1,3})?,?\s+(?:Chapter\s+)?\d{1,3}(?::\d{1,3}(?:\s*[-–]\s*\d{1,3}(?:\s*[:.]\s*\d{1,3})?)?(?:\s*,\s*\d{1,3}(?:\s*[-–]\s*\d{1,3})?)*)?(?:[ \t]+LXX\b)?)\b|\[\[([^\]]*\d+[:/][^\]]*)\]\]/gi
}

export function extractRefsFromNote(content: string, noteTitle: string): NoteVerseRef[] {
  // Fold nbsp/thin spaces to a plain space (length-preserving, so every `content.indexOf`
  // / slice offset below stays valid) — notes written in the contenteditable editor pick up
  // U+00A0 where a space was typed, which this file's `[ \t]`-based regex would not match.
  content = normalizeRefWhitespace(content)
  const results: NoteVerseRef[] = []
  const seen = new Set<string>()
  const re = makeVerseRefRe()
  let m: RegExpExecArray | null

  while ((m = re.exec(content)) !== null) {
    // Strip wikilink brackets and Obsidian display-text suffix ("[[Rom 9:21-22|potter]]" → "Rom 9:21-22")
    const isWikilink = m[2] != null
    const rawFull = (m[1] ?? m[2] ?? '').trim().replace(/\[\[|\]\]/g, '').replace(/\|.*$/, '')
    if (!rawFull) continue
    // Split off a trailing " LXX" marker ("Isaiah 6:4 LXX") — parsed against the bare ref,
    // then re-flagged on every emitted row below. Wikilink titles are left untouched.
    const { ref: raw, lxx: markerLxx } = isWikilink ? { ref: rawFull, lxx: false } : stripLxxMarker(rawFull)
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
    // NoteVerseRef has no endChapter field — a genuine cross-chapter range ("Isaiah
    // 63:17-64:3") is still correctly PARSED by parseRef (chapter 63, endChapter 64,
    // endVerse 3), but is deliberately NOT widened into a same-chapter 17-3 "range" here
    // (endVerse < verse fails refMatchesVerse's range check, so it safely degrades to
    // matching only the exact start verse, 63:17, rather than silently matching every
    // verse from 17 to 3 in chapter 63 — which is what the OLD truncated-regex bug did).
    // This cross-ref side panel/hover-tooltip feature doesn't need full cross-chapter
    // range matching to be correct on the more important path — the note editor's own
    // inline ref detection/pills (noteTextBlocks.ts, used by the ProseMirror parser and
    // decorations) DOES carry endChapter through end-to-end.
    const isChapter = parsed.verse == null
    const refIsLxx = markerLxx || parsed.forcedTranslation === 'LXX'
    const context = content
      .slice(Math.max(0, m.index - 35), m.index + m[0].length + 35)
      .trim()
      .replace(/\[\[|\]\]/g, '')
    // A comma-separated verse list ("Deuteronomy 32:3,6,9-13,23,25") parses into
    // parsed.verseGroups — emit each segment as its own NoteVerseRef so the cross-ref
    // panel/hover rows cover every verse. A plain single ref has no verseGroups; fall back
    // to the parsed verse/endVerse pair.
    const groups = parsed.verseGroups && parsed.verseGroups.length > 0
      ? parsed.verseGroups
      : [{ verse: parsed.verse ?? 0, endVerse: parsed.endVerse }]
    for (const g of groups) {
      const gVerse = isChapter ? 0 : g.verse
      const gEnd = isChapter ? undefined : g.endVerse
      const key = `${parsed.bookId}.${parsed.chapter}.${isChapter ? 'ch' : gVerse}${gEnd != null ? `-${gEnd}` : ''}${refIsLxx ? '.lxx' : ''}`
      if (seen.has(key)) continue
      seen.add(key)
      results.push({
        bookId: parsed.bookId,
        chapter: parsed.chapter,
        // verse 0 = whole chapter (matches the sidepanel RefLabel/VerseText display convention)
        verse: gVerse,
        endVerse: gEnd,
        isChapter,
        ...(refIsLxx ? { lxx: true } : {}),
        sourceNoteTitle: noteTitle,
        context,
      })
    }
  }
  return results
}
