import type { WordReplacerRule } from '@/store'

/**
 * Expand a search query by adding back the ORIGINAL terms for any replacement words
 * the user typed. This makes FTS work correctly when the DB still contains the original
 * words (e.g. "jesus") but the user types the replacement ("yeshua").
 *
 * Example: query="yeshua", rules=[{queries:['jesus'], replacement:'Yeshua'}]
 *   → returns "yeshua OR jesus"  (FTS will find "jesus" records that the UI shows as "Yeshua")
 *
 * Also handles multi-word replacements: "yeshua messiah" expands to include "jesus christ".
 */
export function expandQueryForWordReplacer(query: string, rules: WordReplacerRule[]): string {
  const lq = query.trim().toLowerCase()
  if (!lq) return query

  const extra: string[] = []
  // Sort rules longest-first so compound replacements are checked before single-word ones
  const sorted = [...rules].filter(r => r.enabled).sort((a, b) =>
    b.replacement.length - a.replacement.length
  )

  for (const rule of sorted) {
    const lReplacement = rule.replacement.toLowerCase()
    // Check if any word (or the full replacement phrase) appears in the query
    if (lq.includes(lReplacement) || lReplacement.split(/\s+/).some(w => lq.includes(w))) {
      for (const orig of rule.queries) {
        const lo = orig.toLowerCase()
        if (!lq.includes(lo)) {
          extra.push(orig)
        }
      }
    }
  }

  if (extra.length === 0) return query
  // Build "original_query OR extra1 OR extra2 …" — FTS will match any
  return `${query} OR ${extra.join(' OR ')}`
}

/**
 * Apply word replacer rules to a string.
 * Multi-word / longer queries are sorted first so compound phrases
 * ("jesus christ" → "Yeshua Messiah") match before their sub-phrases ("jesus" → "Yeshua").
 */
export function applyWordReplacer(text: string, rules: WordReplacerRule[]): string {
  const sorted = [...rules].filter(r => r.enabled).sort((a, b) => {
    const aMax = Math.max(...a.queries.map(q => q.length))
    const bMax = Math.max(...b.queries.map(q => q.length))
    return bMax - aMax
  })
  let result = text
  for (const rule of sorted) {
    // Also sort queries within the rule longest-first
    const sortedQueries = [...rule.queries].sort((a, b) => b.length - a.length)
    for (const query of sortedQueries) {
      const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const pattern = rule.wholeWord ? `\\b${escaped}\\b` : escaped
      result = result.replace(new RegExp(pattern, 'gi'), (match) => {
        // Preserve leading capitalisation
        if (match[0] === match[0].toUpperCase() && match[0] !== match[0].toLowerCase()) {
          return rule.replacement.charAt(0).toUpperCase() + rule.replacement.slice(1)
        }
        return rule.replacement
      })
    }
  }
  return result
}
