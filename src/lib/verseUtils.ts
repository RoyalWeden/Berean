import { applyWordReplacer, applyStrongsWordReplacer } from './wordReplacer'
import type { WordReplacerRule } from '@/store'

// ── Internal token type (for copy/export — no rendering concerns) ──────────────
type SimpleToken = {
  word: string
  strongsNum: string | string[] | null
  isParenthetical: boolean  // ~{H853} — grammatical particle, no English word
  isStrongsBracket: boolean // sup>( sup>) — alignment marker, never rendered as text
}

/** Parse text_tagged into simple tokens. Mirrors parseTaggedTokens in VerseRow but
 *  returns only the fields needed for plain-text output (no charStart, no JSX). */
function parseTaggedForText(tagged: string): SimpleToken[] {
  const tokens: SimpleToken[] = []
  for (let part of tagged.split(' ')) {
    if (!part) continue
    const wasSupWrapped = /^\/sup>|^sup>/i.test(part)
    part = part.replace(/^\/sup>/i, '').replace(/^sup>/i, '')
    if (!part) continue

    // Parenthetical Strong's particle: ~{H853}
    if (part.startsWith('~{') && part.endsWith('}')) {
      const sr = part.slice(2, -1).trim()
      tokens.push({ word: '', strongsNum: sr || null, isParenthetical: true, isStrongsBracket: false })
      continue
    }

    const isRedLetter = part.startsWith('!')
    const afterRed = isRedLetter ? part.slice(1) : part
    const isItalic = afterRed.startsWith('*')
    const raw = isItalic ? afterRed.slice(1) : afterRed
    const braceIdx = raw.lastIndexOf('{')
    if (braceIdx !== -1 && raw.endsWith('}')) {
      const word = raw.slice(0, braceIdx)
      const sr = raw.slice(braceIdx + 1, -1).trim()
      const parts = sr ? sr.split('|') : []
      const strongsNum = parts.length > 1 ? parts : (parts[0] || null)
      const isStrongsBracket = wasSupWrapped && !strongsNum && /^[()[\]]+$/.test(word)
      tokens.push({ word, strongsNum, isParenthetical: false, isStrongsBracket })
    } else {
      tokens.push({ word: raw, strongsNum: null, isParenthetical: false, isStrongsBracket: false })
    }
  }
  return tokens
}

/**
 * Build the display/copy text for a verse, applying all active word replacer rules:
 *  - Text-pattern rules (all texts)
 *  - Strong's-number rules + "the" suppression (KJVA tagged text only)
 *
 * This is the authoritative function for copy operations — it matches what VerseRow renders.
 */
export function buildVerseDisplayText(
  text: string,
  textTagged: string | null | undefined,
  textId: string,
  wordReplacerEnabled: boolean,
  wordReplacerRules: WordReplacerRule[],
): string {
  const shouldReplace = wordReplacerEnabled && wordReplacerRules.length > 0

  // KJVA with tagged data: token-level processing for Strong's-number precision
  if (textId === 'kjva' && textTagged && shouldReplace) {
    const tokens = parseTaggedForText(textTagged)

    // Apply both text-pattern and Strong's-number replacement rules
    const processed = tokens.map(t => {
      if (t.isParenthetical || t.isStrongsBracket) return t
      let word = applyWordReplacer(t.word, wordReplacerRules)
      word = applyStrongsWordReplacer(word, t.strongsNum, wordReplacerRules)
      return { ...t, word }
    })

    // Suppress the definite article "the"/"The" immediately preceding a Strong's-replaced token
    const suppressedIndices = new Set<number>()
    const activeStrongsRules = wordReplacerRules.filter(r => r.enabled && r.strongsNum)
    if (activeStrongsRules.length > 0) {
      processed.forEach((t, i) => {
        if (t.isParenthetical || t.isStrongsBracket || !t.strongsNum) return
        const nums = Array.isArray(t.strongsNum) ? t.strongsNum : [t.strongsNum]
        if (!activeStrongsRules.some(r => nums.includes(r.strongsNum!))) return
        for (let j = i - 1; j >= 0; j--) {
          const prev = processed[j]
          if (prev.isParenthetical || prev.isStrongsBracket) continue
          if (prev.word.replace(/[,;:.!?]+$/, '').toLowerCase() === 'the') suppressedIndices.add(j)
          break
        }
      })
    }

    return processed
      .filter((t, i) => !t.isParenthetical && !t.isStrongsBracket && !suppressedIndices.has(i) && t.word !== '')
      .map(t => t.word)
      .join(' ')
  }

  // All other texts: plain text-pattern replacement only
  return shouldReplace ? applyWordReplacer(text, wordReplacerRules) : text
}

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
