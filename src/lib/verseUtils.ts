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
export function getAnnotationRanges(textTagged: string | null | undefined, textId: string, plainText?: string): AnnotationRange[] {
  if (!textTagged || (textId !== 'kjva' && textId !== 'lxx')) return []
  const tokens = parseTaggedTokens(textTagged)
  const ranges: AnnotationRange[] = []
  let charPos = 0
  for (const t of tokens) {
    if (tokenHasNoPlainText(t) || !t.word) continue
    let start = charPos
    if (plainText) {
      // Positional accounting (word + single trailing space) drifts whenever the plain text
      // has punctuation-without-space, doubled spaces, a leading ¶, etc. — and once it drifts
      // sub-character it clips a word's last letter out of its own red-letter/italic span
      // ("sometimes the last letter of words won't have the red"). Re-anchor each token to its
      // real position in the plain text instead; fall back to positional on a miss.
      const idx = plainText.indexOf(t.word, charPos)
      if (idx === -1) { charPos = charPos + t.word.length + 1; continue }
      start = idx
    }
    const end = start + t.word.length
    if (t.isRedLetter || t.isItalic) ranges.push({ start, end, isRedLetter: t.isRedLetter, isItalic: t.isItalic })
    charPos = end + 1 // word + trailing space
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

// ── Cosmetic-drift normalization (COMPARISON ONLY — never touches what's rendered
// or highlighted; only how offsets are matched/interpolated between two texts) ──
//
// `text_tagged`-reconstructed display text is rejoined from tokens rather than substituted
// in place on `verse.text`, so it can drift from `verse.text` on pure data-formatting noise
// (a comma the tagging dropped, a curly vs straight apostrophe, stray trailing whitespace)
// even when no word-replacer rule actually changed anything in that verse. Before this
// normalization, that drift alone was enough to knock mapDisplayOffsetToOriginal/
// mapOriginalOffsetToDisplay off their exact `===` fast path and into the word-level LCS
// below, where "void" (display) and "void," (original) — or curly "Lamb’s" and
// straight "Lamb's" — counted as two entirely different words and failed to match at all,
// producing wrong highlight ranges or (via VerseRow's startChar<0/endChar<=startChar guard)
// no selection toolbar at all. Confirmed present in real data: ~9% of KJVA/Revelation verses
// have a token-reconstruction that differs from verse.text only in exactly this way.
const CURLY_SINGLE_QUOTES = /[‘’‚‛′]/g
const CURLY_DOUBLE_QUOTES = /[“”„‟″]/g

/** Unify curly/smart quote variants to their plain ASCII form. Length-preserving. */
function normalizeQuotes(s: string): string {
  return s.replace(CURLY_SINGLE_QUOTES, "'").replace(CURLY_DOUBLE_QUOTES, '"')
}

/** Normalize a WHOLE text for the top-level "are these basically the same text" check:
 *  unify quotes and collapse/trim all whitespace runs to a single space. */
function normalizeForAlign(s: string): string {
  return normalizeQuotes(s).replace(/\s+/g, ' ').trim()
}

/** Normalize a single WORD (no internal whitespace) for LCS word-equality: unify quotes
 *  and drop trailing sentence punctuation, so "void" and "void," (or their curly-quote
 *  equivalents) still count as the same word for alignment purposes. */
function normalizeWordForAlign(w: string): string {
  return normalizeQuotes(w).replace(/[,;:.!?]+$/, '')
}

/** Indices of words common to both sequences, in order (word-level LCS). Word equality is
 *  checked on the COSMETICALLY-NORMALIZED form (see normalizeWordForAlign) so trailing
 *  punctuation or quote-style drift between `text_tagged`-reconstructed text and verse.text
 *  doesn't break alignment — the actual `.text`/`.start` spans stay the real (raw) substrings,
 *  only the equality check is normalized. */
function wordLcsPairs(D: WordSpan[], O: WordSpan[]): Array<[number, number]> {
  const n = D.length, m = O.length
  const dn = D.map((d) => normalizeWordForAlign(d.text))
  const on = O.map((o) => normalizeWordForAlign(o.text))
  // dp[i][j] = LCS length of D[i..] and O[j..]
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = dn[i] === on[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  const pairs: Array<[number, number]> = []
  let i = 0, j = 0
  while (i < n && j < m) {
    if (dn[i] === on[j]) { pairs.push([i, j]); i++; j++ }
    else if (dp[i + 1][j] >= dp[i][j + 1]) i++
    else j++
  }
  return pairs
}

/**
 * Map an offset in `from` to the corresponding offset in `to` when the two strings are equal
 * after normalizeForAlign() — i.e. they differ ONLY in whitespace runs and/or quote-character
 * style, never in actual word content. Walks both strings in lockstep, char by char; a run of
 * whitespace on either side (any length, including a run present on only one side — e.g. a
 * trailing space, or a doubled internal space) is treated as a single alignment step so
 * extra/missing/trailing spaces don't desync the two pointers the way they would under a plain
 * index-for-index walk. This is more precise than the word-level LCS below (which only anchors
 * at word boundaries): it's used for whole-string cosmetic drift where every character otherwise
 * corresponds 1:1, so it can resolve an offset that falls INSIDE a word exactly, not just at its
 * edges. Returns null if content actually diverges (should not happen once the caller has
 * confirmed normalizeForAlign(from) === normalizeForAlign(to); the check exists as a safety net
 * against normalizeForAlign not being a perfect equivalence for degenerate inputs).
 */
function mapOffsetViaCosmeticEquivalence(from: string, to: string, offset: number): number | null {
  const target = Math.max(0, Math.min(offset, from.length))
  let fi = 0, ti = 0
  while (fi < target) {
    const fWs = fi < from.length && /\s/.test(from[fi])
    const tWs = ti < to.length && /\s/.test(to[ti])
    if (fWs || tWs) {
      if (fWs) fi++
      if (tWs) ti++
      continue
    }
    if (fi >= from.length || ti >= to.length) return null
    if (normalizeQuotes(from[fi]) !== normalizeQuotes(to[ti])) return null
    fi++
    ti++
  }
  // `target` may sit inside a whitespace run that only `from` has (e.g. trailing space) —
  // don't advance `ti` past `to`'s own length chasing whitespace that isn't there.
  return Math.max(0, Math.min(ti, to.length))
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
  if (normalizeForAlign(displayText) === normalizeForAlign(originalText)) {
    const mapped = mapOffsetViaCosmeticEquivalence(displayText, originalText, displayOffset)
    if (mapped !== null) return mapped
  }
  const { dBreaks, oBreaks } = buildAlignment(displayText, originalText)
  return interp(dBreaks, oBreaks, displayOffset)
}

/**
 * Map a character offset in the ORIGINAL `verse.text` to the DISPLAYED text.
 * Used to paint stored highlights onto display text that hid annotations / replaced words.
 */
export function mapOriginalOffsetToDisplay(displayText: string, originalText: string, originalOffset: number): number {
  if (displayText === originalText) return Math.max(0, Math.min(originalOffset, displayText.length))
  if (normalizeForAlign(displayText) === normalizeForAlign(originalText)) {
    const mapped = mapOffsetViaCosmeticEquivalence(originalText, displayText, originalOffset)
    if (mapped !== null) return mapped
  }
  const { dBreaks, oBreaks } = buildAlignment(displayText, originalText)
  return interp(oBreaks, dBreaks, originalOffset)
}

// Below this many characters, a verse is short enough to trivially fit a single search-result
// row — no reason to pre-slice it in JS at all; the row's own CSS line-clamp is the only
// truncation that should ever kick in, and only if the text genuinely doesn't fit. Per direct
// feedback ("it should only truncate when it will take up more than the entire line"), the old
// version windowed purely off the matched word's POSITION, with no regard for whether the whole
// verse would already fit — chopping short verses whose match just happened to fall late.
const WINDOW_MIN_CHARS = 160

/** Extracts a 14-word window around the first match index — but only for a verse long enough
 *  that it wouldn't fit a single row anyway (see WINDOW_MIN_CHARS), and only when the match
 *  index actually falls within the verse's own word count. Returns null (no windowing — show
 *  the full verse, truncated by CSS only if needed) when either condition fails. */
export function getWordWindow(
  text: string,
  matchWordIndices?: number[]
): { windowText: string; windowMatchIndices: number[] } | null {
  if (!matchWordIndices?.length) return null
  if (text.length < WINDOW_MIN_CHARS) return null
  const words = text.split(' ').filter(Boolean)
  const firstMatch = matchWordIndices[0]
  // A Strong's-tag word index computed against text_tagged can land past the plain-text word
  // count (text_tagged sometimes carries extra markup tokens text doesn't) — previously this
  // silently produced an out-of-order slice() that collapsed to just "…" with no real text at
  // all. Treat an out-of-range index as "nothing to window," not "window to nothing."
  if (firstMatch < 10 || firstMatch >= words.length) return null

  const BEFORE = 3
  const TOTAL = 14
  const windowStart = Math.max(0, firstMatch - BEFORE)
  const windowEnd = Math.min(words.length, windowStart + TOTAL)
  if (windowStart >= windowEnd) return null
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
