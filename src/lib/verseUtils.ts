import { applyWordReplacer, applyStrongsWordReplacer } from './wordReplacer'
import type { WordReplacerRule } from '@/store'
import { parseTaggedTokens, tokenHasNoPlainText } from './taggedTokens'

// ── Internal token type (for copy/export — no rendering concerns) ──────────────
type SimpleToken = {
  word: string
  strongsNum: string | string[] | null
  isParenthetical: boolean  // ~{H853} — grammatical particle, no English word
  isStrongsBracket: boolean // sup>( sup>) — alignment marker, never rendered as text
  isRedLetter: boolean      // !word — words of Yeshua
  isItalic: boolean         // *word — translator-supplied (KJV italics)
}

/** Parse text_tagged into simple tokens. Mirrors parseTaggedTokens in VerseRow but
 *  returns only the fields needed for plain-text / lightweight rendering (no charStart). */
function parseTaggedForText(tagged: string): SimpleToken[] {
  const tokens: SimpleToken[] = []
  for (let part of tagged.split(' ')) {
    if (!part) continue
    const wasSupWrapped = /^\/sup>|^sup>/i.test(part)
    part = part.replace(/^\/sup>/i, '').replace(/^sup>/i, '')
    part = part.replace(/^\/blu>/i, '').replace(/^blu>/i, '')
    // <b>/</b> bold wrappers (seen in some Psalms) lost their '<' — strip the fragments.
    part = part.replace(/<?\/?b>/gi, '')
    if (!part) continue

    // Parenthetical Strong's particle: ~{H853}
    if (part.startsWith('~{') && part.endsWith('}')) {
      const sr = part.slice(2, -1).trim()
      tokens.push({ word: '', strongsNum: sr || null, isParenthetical: true, isStrongsBracket: false, isRedLetter: false, isItalic: false })
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
      tokens.push({ word, strongsNum, isParenthetical: false, isStrongsBracket, isRedLetter, isItalic })
    } else {
      tokens.push({ word: raw, strongsNum: null, isParenthetical: false, isStrongsBracket: false, isRedLetter, isItalic })
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

  // KJVA with tagged data: token-level processing for Strong's-number precision.
  // Guard tokens.length: a truthy-but-tokenless textTagged (e.g. stray whitespace)
  // would otherwise collapse the verse to '' — fall through to the plain-text return.
  const tokens0 = (textId === 'kjva' && textTagged) ? parseTaggedForText(textTagged) : []
  if (textId === 'kjva' && textTagged && shouldReplace && tokens0.length > 0) {
    const tokens = tokens0

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

/** A rendered display token carrying the styling flags needed to show red-letter and
 *  KJV-italic words (used by the presenter view, which renders without Strong's chips). */
export interface DisplayToken {
  word: string
  isRedLetter: boolean
  isItalic: boolean
}

/**
 * Like {@link buildVerseDisplayText} but returns the display tokens (with red-letter /
 * italic flags) instead of a flat string, so callers can render Yeshua's words in red.
 *
 * For KJVA tagged text the tokens are parsed regardless of whether the word replacer is
 * on (so red-letter shows either way); the word replacer + "the"-suppression are applied
 * only when enabled. For all other texts a single token is returned (no red-letter data).
 * `tokens.map(t => t.word).join(' ')` reproduces the display string for KJVA tagged.
 */
export function buildVerseDisplayTokens(
  text: string,
  textTagged: string | null | undefined,
  textId: string,
  wordReplacerEnabled: boolean,
  wordReplacerRules: WordReplacerRule[],
): DisplayToken[] {
  const shouldReplace = wordReplacerEnabled && wordReplacerRules.length > 0

  // Plain path for non-KJVA/non-tagged text, AND as a guard for a truthy-but-tokenless
  // textTagged (e.g. stray whitespace → parseTaggedForText yields []) which would
  // otherwise return an empty token list and render a blank verse.
  const tokens = textId === 'kjva' && textTagged ? parseTaggedForText(textTagged) : []
  if (!(textId === 'kjva' && textTagged) || tokens.length === 0) {
    const out = shouldReplace ? applyWordReplacer(text, wordReplacerRules) : text
    return [{ word: out, isRedLetter: false, isItalic: false }]
  }

  const processed = tokens.map(t => {
    if (t.isParenthetical || t.isStrongsBracket || !shouldReplace) return t
    let word = applyWordReplacer(t.word, wordReplacerRules)
    word = applyStrongsWordReplacer(word, t.strongsNum, wordReplacerRules)
    return { ...t, word }
  })

  // Suppress the definite article preceding a Strong's-replaced divine name ("the Yehovah").
  const suppressedIndices = new Set<number>()
  if (shouldReplace) {
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
  }

  return processed
    .filter((t, i) => !t.isParenthetical && !t.isStrongsBracket && !suppressedIndices.has(i) && t.word !== '')
    .map(t => ({ word: t.word, isRedLetter: t.isRedLetter, isItalic: t.isItalic }))
}

export interface AnnotationRange { start: number; end: number; isRedLetter: boolean; isItalic: boolean }

/**
 * Char ranges (against the plain `verse.text`) for KJV-italic / red-letter (Yeshua's words)
 * tokens in `text_tagged`, for renderers that don't otherwise parse tagged text — e.g.
 * Advanced Scripture Search result rows, which show plain verse.text with query-match
 * marks but previously had no italics/red-letter markup at all (VerseRow's reader view
 * gets these via its own text_tagged rendering path, unrelated to this helper).
 */
export function getAnnotationRanges(textTagged: string | null | undefined, textId: string): AnnotationRange[] {
  if (!textTagged || (textId !== 'kjva' && textId !== 'lxx')) return []
  const tokens = parseTaggedTokens(textTagged)
  const ranges: AnnotationRange[] = []
  let charPos = 0
  for (const t of tokens) {
    if (tokenHasNoPlainText(t)) continue
    const start = charPos
    const end = charPos + t.word.length
    if (t.isRedLetter || t.isItalic) ranges.push({ start, end, isRedLetter: t.isRedLetter, isItalic: t.isItalic })
    charPos = end + 1 // word + trailing space, mirrors VerseRow's charPos accounting
  }
  return ranges
}

// ── Display ⇄ original text offset alignment ──────────────────────────────────
//
// The displayed verse text can differ from the stored `verse.text` in two ways:
//   • word replacer:    a word is substituted ("LORD" → "Yehovah") — 1:1 word count
//   • annotation hiding: words/parentheticals are removed — display has FEWER words
// (and both can apply at once). Highlights are stored against `verse.text`, but
// selections are measured against the displayed text — so we need to translate
// offsets in either direction.
//
// We align the two by their common words (a word-level longest-common-subsequence),
// which handles substitutions AND deletions/insertions. Matched words map 1:1
// (exact), and the changed regions between them are interpolated (approximate, but
// those regions have no well-defined character correspondence anyway).

interface WordSpan { text: string; start: number }

function splitWordSpans(text: string): WordSpan[] {
  const out: WordSpan[] = []
  let pos = 0
  for (const w of text.split(' ')) {
    out.push({ text: w, start: pos })
    pos += w.length + 1 // word + the single joining space
  }
  return out
}

/** Indices of words common to both sequences, in order (word-level LCS). */
function wordLcsPairs(D: WordSpan[], O: WordSpan[]): Array<[number, number]> {
  const n = D.length, m = O.length
  // dp[i][j] = LCS length of D[i..] and O[j..]
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = D[i].text === O[j].text ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  const pairs: Array<[number, number]> = []
  let i = 0, j = 0
  while (i < n && j < m) {
    if (D[i].text === O[j].text) { pairs.push([i, j]); i++; j++ }
    else if (dp[i + 1][j] >= dp[i][j + 1]) i++
    else j++
  }
  return pairs
}

interface Alignment { dBreaks: number[]; oBreaks: number[] }

/** Build monotonic breakpoint arrays anchoring matched-word boundaries. */
function buildAlignment(displayText: string, originalText: string): Alignment {
  const D = splitWordSpans(displayText)
  const O = splitWordSpans(originalText)
  const pairs = wordLcsPairs(D, O)
  const dBreaks: number[] = [0]
  const oBreaks: number[] = [0]
  const push = (dv: number, ov: number) => {
    if (dv > dBreaks[dBreaks.length - 1] && ov >= oBreaks[oBreaks.length - 1]) {
      dBreaks.push(dv)
      oBreaks.push(ov)
    }
  }
  for (const [di, oj] of pairs) {
    push(D[di].start, O[oj].start)                                  // word start anchor
    push(D[di].start + D[di].text.length, O[oj].start + O[oj].text.length) // word end anchor
  }
  push(displayText.length, originalText.length)
  return { dBreaks, oBreaks }
}

/** Piecewise-linear interpolation of `x` from the `from` breakpoints onto `to`. */
function interp(from: number[], to: number[], x: number): number {
  if (x <= from[0]) return to[0]
  const last = from.length - 1
  if (x >= from[last]) return to[last]
  for (let k = 0; k < last; k++) {
    if (x >= from[k] && x <= from[k + 1]) {
      const span = from[k + 1] - from[k]
      if (span === 0) return to[k]
      return Math.round(to[k] + ((x - from[k]) / span) * (to[k + 1] - to[k]))
    }
  }
  return to[last]
}

/**
 * Map a character offset in the DISPLAYED verse text back to `verse.text`.
 * Matched (unchanged) words map exactly; changed regions are interpolated.
 */
export function mapDisplayOffsetToOriginal(displayText: string, originalText: string, displayOffset: number): number {
  if (displayText === originalText) return Math.max(0, Math.min(displayOffset, originalText.length))
  const { dBreaks, oBreaks } = buildAlignment(displayText, originalText)
  return interp(dBreaks, oBreaks, displayOffset)
}

/**
 * Map a character offset in the ORIGINAL `verse.text` to the DISPLAYED text.
 * Used to paint stored highlights onto display text that hid annotations / replaced words.
 */
export function mapOriginalOffsetToDisplay(displayText: string, originalText: string, originalOffset: number): number {
  if (displayText === originalText) return Math.max(0, Math.min(originalOffset, displayText.length))
  const { dBreaks, oBreaks } = buildAlignment(displayText, originalText)
  return interp(oBreaks, dBreaks, originalOffset)
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
