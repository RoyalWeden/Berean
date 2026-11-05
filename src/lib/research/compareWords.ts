// Word-level "Different wording" between two renderings of the same passage (spec §6.1 #7:
// differences highlighted conservatively, no invented textual variants). A word is marked only
// when it appears in one rendering and not at all in the other; nothing is inferred about why.

const WORD_RE = /[\p{L}\p{M}'’-]+/gu

export const normalizeWord = (w: string): string => w.toLowerCase().replace(/^['’-]+|['’-]+$/g, '')

function wordSet(text: string): Set<string> {
  const out = new Set<string>()
  for (const m of text.matchAll(WORD_RE)) {
    const w = normalizeWord(m[0])
    if (w) out.add(w)
  }
  return out
}

/** Words found in `mine` but in none of `theirs`, lowercased and sorted. */
export function wordsOnlyIn(mine: string[], theirs: string[]): string[] {
  const other = wordSet(theirs.join(' '))
  return [...wordSet(mine.join(' '))].filter((w) => !other.has(w)).sort()
}
