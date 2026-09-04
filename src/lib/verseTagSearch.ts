import type { VerseTag } from '@/types'

/**
 * Rank verse tags for a floating-search query.
 *
 * `needle` is the already-lowercased, trimmed search text (the part after a
 * leading "#" in tag mode, or the whole keyword query when surfacing tags
 * alongside other results). An empty needle returns every tag (used by "#"
 * alone to list them all).
 *
 * Ordering: exact name match, then prefix match, then by verse count desc, then
 * name asc — so the tag you're most likely after floats to the top.
 */
export function rankVerseTags(tags: readonly VerseTag[], needle: string): VerseTag[] {
  const n = needle.trim().toLowerCase()
  const matched = n ? tags.filter((t) => t.name.toLowerCase().includes(n)) : [...tags]
  return matched.sort((a, b) => {
    const al = a.name.toLowerCase(), bl = b.name.toLowerCase()
    if (n) {
      const ax = al === n, bx = bl === n
      if (ax !== bx) return ax ? -1 : 1
      const ap = al.startsWith(n), bp = bl.startsWith(n)
      if (ap !== bp) return ap ? -1 : 1
    }
    if (a.verseCount !== b.verseCount) return b.verseCount - a.verseCount
    return al.localeCompare(bl)
  })
}
