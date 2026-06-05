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
  // Skip Strong's-number rules — those only apply to tagged KJVA tokens, not FTS queries
  const sorted = [...rules].filter(r => r.enabled && !r.strongsNum).sort((a, b) =>
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
 * Apply Strong's-number-based replacement rules to a single tagged token.
 * Only rules with `strongsNum` set are checked. Returns the replacement string
 * if a match is found, or `word` unchanged if no rule applies.
 *
 * `tokenStrongsNum` may be a single string (e.g. "H3068"), an array of strings
 * (multi-Strong's token, e.g. ["H3068", "H430"]), or null.
 */
export function applyStrongsWordReplacer(
  word: string,
  tokenStrongsNum: string | string[] | null,
  rules: WordReplacerRule[],
): string {
  if (!tokenStrongsNum) return word
  const nums = Array.isArray(tokenStrongsNum) ? tokenStrongsNum : [tokenStrongsNum]
  for (const rule of rules) {
    if (!rule.enabled || !rule.strongsNum) continue
    if (!nums.includes(rule.strongsNum)) continue
    // Preserve possessive suffix ('s/'S) and/or trailing punctuation that was
    // part of the token word (punctuation attaches to the word in text_tagged).
    // e.g. "LORD'S{H3068}"   word="LORD'S"   → "Yehovah's"
    //      "LORD'S.{H3068}"  word="LORD'S."  → "Yehovah's."
    //      "LORD,{H3068}"    word="LORD,"    → "Yehovah,"
    //      "LORD.{H3068}"    word="LORD."    → "Yehovah."
    const m = word.match(/^[A-Za-z]+('[Ss])?([\W]*)$/)
    if (m) {
      const possessive = m[1] ? "'s" : ''
      const trailing   = m[2] ?? ''
      return rule.replacement + possessive + trailing
    }
    return rule.replacement
  }
  return word
}

/**
 * Apply word replacer rules to a string.
 * Multi-word / longer queries are sorted first so compound phrases
 * ("jesus christ" → "Yeshua Messiah") match before their sub-phrases ("jesus" → "Yeshua").
 */
export function applyWordReplacer(text: string, rules: WordReplacerRule[]): string {
  // Skip Strong's-number rules — those only apply to KJVA tagged token rendering
  const sorted = [...rules].filter(r => r.enabled && !r.strongsNum).sort((a, b) => {
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
