// Validates Scripture references inside model-written text (spec §9.2, benchmark R19/S19). A
// reference that does not exist in Berean's texts ("Genesis 99:1", "Job 6:48") is removed from
// the prose and reported — never shown as if it were a citation. Shared; the caller supplies the
// existence check (desktop: sync DB; iPhone: async service results gathered beforehand).

import { isExactBookToken, resolveBookToken, getTranslationForBook } from '../parseRef'

export interface TextRefMatch {
  /** Exact text span, for replacement. */
  raw: string
  start: number
  end: number
  bookId: string
  chapter: number
  verse: number
  endVerse?: number
  textId: string
}

const REF_RE = /((?:[1-3]|I{1,3})\s+)?([A-Za-z][A-Za-z.]*(?:\s+(?:of\s+)?[A-Za-z][A-Za-z.]*){0,3})\s+(\d{1,3})[:.](\d{1,3})(?:\s*[-–]\s*(\d{1,3}))?/g

/** Every "Book C:V[-V]" span whose book resolves, including references whose chapter/verse do not
 *  exist (unlike parseRef, which rejects out-of-range chapters and would hide them). */
export function scanTextReferences(text: string): TextRefMatch[] {
  const out: TextRefMatch[] = []
  for (const m of text.matchAll(REF_RE)) {
    const lead = m[1] ?? ''
    const words = m[2].split(/\s+/)
    // Try the shortest trailing book name first ("see Genesis" → "Genesis").
    let found: { bookId: string; startOffset: number } | null = null
    for (let take = 1; take <= words.length && !found; take++) {
      const book = words.slice(words.length - take).join(' ').replace(/\.$/, '')
      for (const cand of [take === words.length && lead ? `${lead.trim()} ${book}` : null, book]) {
        if (!cand || !isExactBookToken(cand)) continue
        const bookId = resolveBookToken(cand)
        if (!bookId) continue
        const prefix = take === words.length ? '' : words.slice(0, words.length - take).join(' ') + ' '
        const usesLead = cand !== book
        const startOffset = (m.index ?? 0) + (usesLead ? 0 : lead.length) + prefix.length
        found = { bookId, startOffset }
        break
      }
    }
    if (!found) continue
    const end = (m.index ?? 0) + m[0].length
    out.push({
      raw: text.slice(found.startOffset, end),
      start: found.startOffset,
      end,
      bookId: found.bookId,
      chapter: Number(m[3]),
      verse: Number(m[4]),
      ...(m[5] ? { endVerse: Number(m[5]) } : {}),
      textId: getTranslationForBook(found.bookId) ?? 'kjva',
    })
  }
  return out
}

export interface GuardResult {
  text: string
  /** References removed because the verse does not exist. */
  removed: string[]
}

/** Removes nonexistent references from model text. `exists` must be a real DB check. */
export function removeNonexistentReferences(text: string, exists: (ref: TextRefMatch) => boolean): GuardResult {
  if (!text) return { text, removed: [] }
  const refs = scanTextReferences(text)
  const removed: string[] = []
  let out = ''
  let cursor = 0
  for (const r of refs) {
    const last = r.endVerse ?? r.verse
    const ok = exists(r) && (r.endVerse == null || exists({ ...r, verse: last }))
    if (ok) continue
    removed.push(r.raw)
    out += text.slice(cursor, r.start) + '[reference not found]'
    cursor = r.end
  }
  out += text.slice(cursor)
  return { text: out, removed }
}

export function nonexistentReferenceNote(removed: string[]): string | null {
  if (removed.length === 0) return null
  // Doesn't name them: repeating a made-up or injected citation would put it in front of the user.
  return removed.length === 1 ? "(Removed a reference that doesn't exist in Berean's texts.)" : `(Removed ${removed.length} references that don't exist in Berean's texts.)`
}
