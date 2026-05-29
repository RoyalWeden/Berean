import type { WordReplacerRule } from '@/store'

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
