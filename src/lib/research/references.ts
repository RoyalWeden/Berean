// Finds Scripture references embedded anywhere in free text (spec §4.1). Shared by desktop and
// iPhone. Ported from electron/ipc/aiLookup.ts's findAllReferencesInText (same word-window scan,
// same `isExactBookToken` gate) so the research layer and the legacy pipeline agree.

import { isExactBookToken, parseRef, type ParsedRef } from '../parseRef'

// A bare "1:1" / "1.1" / "1:1-5" / "1" chapter[:verse[-endVerse]] token, with trailing punctuation.
const CHAPTER_VERSE_TOKEN_RE = /^(\d{1,3})(?:[:.](\d{1,3})(?:[-–](\d{1,3}))?)?[.,!?;:)]?$/

/** Every reference-shaped substring that resolves to a known book, deduped, in text order.
 *  Word-tokenizes and tries the 1–3 words immediately before each chapter[:verse] token
 *  (shortest first) plus a leading "1/2/3/I/II/III", so "what does john 1:1 quote" resolves "john". */
export function findReferencesInText(text: string): ParsedRef[] {
  const tokens = text.split(/\s+/)
  const out: ParsedRef[] = []
  const seen = new Set<string>()
  for (let i = 0; i < tokens.length; i++) {
    const numMatch = tokens[i].match(CHAPTER_VERSE_TOKEN_RE)
    if (!numMatch) continue
    let found = false
    for (const windowLen of [1, 2, 3]) {
      if (found) break
      const start = i - windowLen
      if (start < 0) break
      const bookToken = tokens.slice(start, i).join(' ').replace(/[^\w\s]/g, '').trim()
      const candidates = [bookToken]
      if (start > 0) {
        const lead = tokens[start - 1].replace(/[^\w]/g, '')
        if (/^(?:[1-3]|I{1,3})$/i.test(lead)) candidates.unshift(`${lead} ${bookToken}`)
      }
      for (const cand of candidates) {
        if (!cand || !isExactBookToken(cand)) continue
        const ref = `${cand} ${numMatch[1]}${numMatch[2] ? `:${numMatch[2]}${numMatch[3] ? `-${numMatch[3]}` : ''}` : ''}`
        const parsed = parseRef(ref)
        if (!parsed) continue
        const key = `${parsed.bookId}|${parsed.chapter}|${parsed.verse ?? ''}|${parsed.endVerse ?? ''}`
        if (!seen.has(key)) { seen.add(key); out.push(parsed) }
        found = true
        break
      }
    }
  }
  return out
}
