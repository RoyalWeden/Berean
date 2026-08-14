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
 *
 * ⚠️ NOT actually usable as a query string passed to `window.bible.searchText` —
 * electron/ipc/bible.ts's own `safeFtsQuery`/`cleanWords` were deliberately hardened
 * (see that file's comment) to treat EVERY word in the input as a required token,
 * specifically so a literal "OR" typed by the user can't accidentally flip "All
 * words" mode into "any words" mode. That hardening means the literal " OR " this
 * function inserts is *also* read as just another required search word, not a
 * boolean operator — turning "yeshua OR jesus" into an impossible query requiring
 * the literal words "yeshua", "or", AND "jesus" all in the same verse. Real bug,
 * confirmed: this was silently broken in both Advanced Search and the floating
 * quick search. Kept only as the single-string-expansion primitive still covered
 * by existing tests; real search call sites must use
 * `getWordReplacerSearchVariants` below and issue one search per variant instead.
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
 * Real, working replacement for bidirectional word-replacer search: returns a list
 * of complete, independent query strings to search for and union the results of —
 * the ORIGINAL query plus, for each word-replacer rule that matches, the query with
 * the matched word/phrase SUBSTITUTED (not appended) for its counterpart, so the
 * rest of a multi-word query is preserved on both sides (e.g. "yeshua wept" also
 * searches "jesus wept", not just bare "jesus").
 *
 * Each returned string is a normal, plain query — safe to pass individually to
 * `window.bible.searchText`, unlike `expandQueryForWordReplacer`'s output.
 */
export function getWordReplacerSearchVariants(query: string, rules: WordReplacerRule[]): string[] {
  const trimmed = query.trim()
  if (!trimmed) return [query]
  const lq = trimmed.toLowerCase()
  const variants = new Set<string>([trimmed])

  const sorted = [...rules].filter(r => r.enabled && !r.strongsNum).sort((a, b) =>
    b.replacement.length - a.replacement.length
  )

  const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

  for (const rule of sorted) {
    const lReplacement = rule.replacement.toLowerCase()
    for (const orig of rule.queries) {
      const lOrig = orig.toLowerCase()
      // Replacement wording is in the query (e.g. typed "Yeshua") → also search the
      // DB's original wording (e.g. "Jesus"), substituted in place.
      if (lq.includes(lReplacement)) {
        const re = new RegExp(escapeRe(rule.replacement), 'ig')
        variants.add(trimmed.replace(re, orig))
      }
      // Original wording is in the query (e.g. typed "Jesus") → also search the
      // replacement's own wording, so results display-transform consistently either way.
      if (lq.includes(lOrig)) {
        const re = new RegExp(escapeRe(orig), 'ig')
        variants.add(trimmed.replace(re, rule.replacement))
      }
    }
  }

  return [...variants]
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

interface CompiledWordReplacerRule {
  replacement: string
  matchers: RegExp[]
}

// applyWordReplacer is called PER RESULT ROW / PER VERSE, often several times within a single
// React render pass (e.g. FloatingSearch.tsx builds its result list — up to a dozen+ verse/note
// snippets — inline in the component body, so this runs once per row on every keystroke, not
// just once per debounced search). Re-filtering, re-sorting, and re-compiling a fresh RegExp
// for every rule × every query on EVERY call was real, measurable work duplicated across all of
// those calls even though `rules` itself is the SAME array reference for the whole render pass
// (it only changes when the user edits Word Replacer settings) — reported as the floating
// search's typed characters visibly lagging behind. Cache the sorted/compiled form per `rules`
// array identity so repeat calls with the same rules reference reuse it instead of rebuilding.
const compiledCache = new WeakMap<WordReplacerRule[], CompiledWordReplacerRule[]>()

function getCompiledRules(rules: WordReplacerRule[]): CompiledWordReplacerRule[] {
  const cached = compiledCache.get(rules)
  if (cached) return cached
  // Skip Strong's-number rules — those only apply to KJVA tagged token rendering
  const sorted = [...rules].filter(r => r.enabled && !r.strongsNum).sort((a, b) => {
    const aMax = Math.max(...a.queries.map(q => q.length))
    const bMax = Math.max(...b.queries.map(q => q.length))
    return bMax - aMax
  })
  const compiled = sorted.map((rule) => ({
    replacement: rule.replacement,
    matchers: [...rule.queries]
      .sort((a, b) => b.length - a.length)
      .map((query) => {
        const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        const pattern = rule.wholeWord ? `\\b${escaped}\\b` : escaped
        return new RegExp(pattern, 'gi')
      }),
  }))
  compiledCache.set(rules, compiled)
  return compiled
}

/**
 * Apply word replacer rules to a string.
 * Multi-word / longer queries are sorted first so compound phrases
 * ("jesus christ" → "Yeshua Messiah") match before their sub-phrases ("jesus" → "Yeshua").
 */
export function applyWordReplacer(text: string, rules: WordReplacerRule[]): string {
  let result = text
  for (const rule of getCompiledRules(rules)) {
    for (const matcher of rule.matchers) {
      result = result.replace(matcher, (match) => {
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
