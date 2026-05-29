/** Extracts a 14-word window around the first match index when the match is far from the start.
 *  Returns null when the first match is within the first 10 words (no windowing needed). */
export function getWordWindow(
  text: string,
  matchWordIndices?: number[]
): { windowText: string; windowMatchIndices: number[] } | null {
  if (!matchWordIndices?.length) return null
  const words = text.split(' ').filter(Boolean)
  const firstMatch = matchWordIndices[0]
  if (firstMatch < 10) return null

  const BEFORE = 3
  const TOTAL = 14
  const windowStart = Math.max(0, firstMatch - BEFORE)
  const windowEnd = Math.min(words.length, windowStart + TOTAL)
  const hasPrefix = windowStart > 0
  const hasSuffix = windowEnd < words.length

  const parts: string[] = []
  if (hasPrefix) parts.push('…')
  parts.push(...words.slice(windowStart, windowEnd))
  if (hasSuffix) parts.push('…')

  const windowText = parts.join(' ')
  const prefixOffset = hasPrefix ? 1 : 0
  const windowMatchIndices = matchWordIndices
    .filter((i) => i >= windowStart && i < windowEnd)
    .map((i) => i - windowStart + prefixOffset)

  return { windowText, windowMatchIndices }
}

/** Converts Roman-numeral book prefixes (I/II/III) to Arabic numerals for book-picker search.
 *  E.g. "I Sam" → "1 Sam", "II Cor" → "2 Cor", "III John" → "3 John" */
export function normalizeBookQuery(raw: string): string {
  return raw
    .replace(/^iii\s+/i, '3 ')
    .replace(/^ii\s+/i, '2 ')
    .replace(/^i\s+/i, '1 ')
}

/** Extracts highlight-candidate English keywords from a Strong's `short_def` string.
 *  Strips parenthetical content, special chars, and short words (< 4 chars). */
export function extractGlossWords(shortDef: string): string[] {
  return (shortDef ?? '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[××+\-]/g, ' ')
    .split(/[,\s]+/)
    .map((w: string) => w.replace(/[^a-z]/g, ''))
    .filter((w: string) => w.length >= 4)
}

/** Finds word indices (0-based) in a verse that carry the given Strong's number.
 *  Primary: parses `text_tagged` tokens of the form `word{HXXXX}`.
 *  Fallback: matches `fallbackWords` (gloss keywords) against plain text words. */
export function findMatchWordIndices(
  textTagged: string | null,
  plainText: string,
  strongsNum: string,
  fallbackWords: string[]
): number[] {
  if (textTagged) {
    const tagRe = /\*?([^{}*]+)\{([^}]*)\}/g
    const indices: number[] = []
    let wordIdx = 0
    let m: RegExpExecArray | null
    while ((m = tagRe.exec(textTagged)) !== null) {
      const tag = m[2].trim()
      if (tag && tag.toUpperCase() === strongsNum.toUpperCase()) {
        indices.push(wordIdx)
      }
      wordIdx++
    }
    if (indices.length > 0) return indices
  }

  if (fallbackWords.length > 0 && plainText) {
    const matchIndices: number[] = []
    plainText.split(' ').forEach((word, idx) => {
      const clean = word.toLowerCase().replace(/[^a-z]/g, '')
      if (
        clean.length >= 4 &&
        fallbackWords.some(
          (fw) => fw === clean || fw === clean + 's' || fw + 's' === clean
        )
      ) {
        matchIndices.push(idx)
      }
    })
    return matchIndices
  }

  return []
}
