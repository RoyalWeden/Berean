/**
 * Shared utility: extract Bible verse references from note content.
 * Used by BibleRightPanel (cross-ref panel) and VerseRow (hover tooltip).
 */
import { parseRef } from './parseRef'

export interface NoteVerseRef {
  bookId: string
  chapter: number
  verse: number
  sourceNoteTitle: string
  context: string
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
    const parsed = parseRef(raw)
    if (!parsed) continue
    const key = `${parsed.bookId}.${parsed.chapter}.${parsed.verse ?? 1}`
    if (seen.has(key)) continue
    seen.add(key)
    const context = content
      .slice(Math.max(0, m.index - 35), m.index + m[0].length + 35)
      .trim()
      .replace(/\[\[|\]\]/g, '')
    results.push({
      bookId: parsed.bookId,
      chapter: parsed.chapter,
      verse: parsed.verse ?? 1,
      sourceNoteTitle: noteTitle,
      context,
    })
  }
  return results
}
