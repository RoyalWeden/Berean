/**
 * Read Aloud (TTS) — text preparation for individual spoken words: number expansion,
 * abbreviation expansion, and punctuation normalization. Pure, engine-independent (same
 * reasoning as extractSpokenText.ts's file header: usable from any backend, testable without a
 * synthesis engine at all).
 *
 * Deliberately does NOT touch divine-name/word-replacer handling — that happens earlier in
 * extractSpokenText.ts's buildSpokenWords() pipeline (wordReplacer + Strong's word-replacer +
 * the "the Yehovah" blanking fix) and is theologically load-bearing. This module only changes
 * HOW a numeral or abbreviation is voiced, never WHAT is spoken. Applied per-token, after that
 * pipeline, so it sees the already-substituted word.
 *
 * A single call slot in `words[]` (see SpokenWord in extractSpokenText.ts) can hold MULTI-WORD
 * spoken text (e.g. "seven hundred" for "700") without breaking word/verse-highlight alignment
 * — VerseRow's own spokenIndex numbering counts TOKENS, not spoken syllables/words, so expanding
 * one token into several spoken words within the same slot is safe; it's exactly the same
 * invariant the Strong's-replacement blanking fix already relies on.
 */

const ONES = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen',
]
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety']
const ORDINAL_ONES = [
  'zeroth', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth',
  'eleventh', 'twelfth', 'thirteenth', 'fourteenth', 'fifteenth', 'sixteenth', 'seventeenth', 'eighteenth', 'nineteenth',
]
const ORDINAL_TENS = ['', '', 'twentieth', 'thirtieth', 'fortieth', 'fiftieth', 'sixtieth', 'seventieth', 'eightieth', 'ninetieth']
// Scales checked largest-first so numberToWords recurses on the remainder.
const SCALES: Array<[number, string]> = [
  [1_000_000_000, 'billion'],
  [1_000_000, 'million'],
  [1_000, 'thousand'],
]
// Above this, spelling the number out stops being natural-sounding (KJV/LXX/Enoch/Jubilees
// numerals never legitimately go this high — genealogical ages and calendar counts top out in
// the low thousands) and risks producing a nonsense wall of words for something that's probably
// not really a "number to read aloud" (e.g. a Strong's-adjacent stray digit string). Leave it as
// digits rather than guess.
const MAX_EXPANDABLE = 999_999_999_999

/** Spells out an integer 0..MAX_EXPANDABLE as English words. `ordinal` renders the LAST word as
 *  an ordinal ("forty-second" rather than "forty-two") — used for "42nd" etc. */
export function numberToWords(n: number, ordinal = false): string {
  if (n < 0) return `negative ${numberToWords(-n, ordinal)}`
  if (n < 20) return ordinal ? ORDINAL_ONES[n] : ONES[n]
  if (n < 100) {
    const tens = Math.floor(n / 10)
    const rest = n % 10
    if (rest === 0) return ordinal ? ORDINAL_TENS[tens] : TENS[tens]
    return `${TENS[tens]}-${ordinal ? ORDINAL_ONES[rest] : ONES[rest]}`
  }
  if (n < 1000) {
    const hundreds = Math.floor(n / 100)
    const rest = n % 100
    if (rest === 0) return ordinal ? `${ONES[hundreds]} hundredth` : `${ONES[hundreds]} hundred`
    return `${ONES[hundreds]} hundred and ${numberToWords(rest, ordinal)}`
  }
  for (const [scale, name] of SCALES) {
    if (n >= scale) {
      const count = Math.floor(n / scale)
      const rest = n % scale
      const head = `${numberToWords(count)} ${name}`
      if (rest === 0) return ordinal ? `${head}th` : head
      // "and" reads naturally before a sub-100 remainder ("two thousand and five"); a
      // remainder of 100+ already supplies its own internal "and" from the branch above.
      return `${head}${rest < 100 ? ' and ' : ' '}${numberToWords(rest, ordinal)}`
    }
  }
  return String(n)
}

// Leading/trailing punctuation is peeled off before number-matching and reattached after, so
// "(40)" or "40," expand to "(forty)" / "forty," rather than failing to match at all.
const NUMBER_TOKEN_RE = /^([([{"'‘“]*)(\d{1,3}(?:,\d{3})*|\d+)(st|nd|rd|th)?([)\]}"'’”,;:.!?]*)$/i
const DECIMAL_TOKEN_RE = /^([([{"'‘“]*)(\d+)\.(\d+)([)\]}"'’”,;:.!?]*)$/

/** Expands a single numeral token ("700", "3rd", "3.5") to spoken words, preserving any
 *  surrounding punctuation/brackets. Returns the token unchanged if it isn't a plain numeral
 *  (e.g. a Strong's number like "H7225" — those never reach here since buildSpokenWords skips
 *  Strong's-bracket tokens entirely, but this function stays conservative regardless: anything
 *  with a non-digit, non-punctuation character is left alone). */
export function expandNumbers(token: string): string {
  const decimalMatch = DECIMAL_TOKEN_RE.exec(token)
  if (decimalMatch) {
    const [, prefix, whole, frac, suffix] = decimalMatch
    if (Number(whole) > MAX_EXPANDABLE) return token
    const wholeWords = numberToWords(Number(whole))
    // Decimal digits are read individually ("three point one four"), not as a cardinal number
    // ("three point fourteen") — the standard convention, and the only one that stays correct
    // regardless of leading zeros in the fractional part (".05" vs ".5").
    const fracWords = frac.split('').map((d) => ONES[Number(d)]).join(' ')
    return `${prefix}${wholeWords} point ${fracWords}${suffix}`
  }

  const match = NUMBER_TOKEN_RE.exec(token)
  if (!match) return token
  const [, prefix, digits, ordinalSuffix, suffix] = match
  const n = Number(digits.replace(/,/g, ''))
  if (!Number.isFinite(n) || n > MAX_EXPANDABLE) return token
  return `${prefix}${numberToWords(n, !!ordinalSuffix)}${suffix}`
}

// KJV/LXX/Enoch/Jubilees body text is essentially abbreviation-free, but editorial material
// that ships alongside them (introductions, translators' bracketed notes, cross-reference
// asides) is not — and Read Aloud speaks everything continuously (see extractSpokenText.ts's
// file header: "speak everything naturally"), so an unexpanded "cf." or "etc." gets voiced
// letter-by-letter or skipped oddly by most engines. Keys are matched case-insensitively
// against the token with its own trailing punctuation stripped first; values are inserted with
// the token's original capitalization pattern reapplied (see applyCasing below) so a
// sentence-initial abbreviation still reads as a capitalized word.
const ABBREVIATIONS: Record<string, string> = {
  'mr.': 'mister',
  'mrs.': 'missus',
  'ms.': 'miss',
  'dr.': 'doctor',
  'st.': 'saint',
  'vs.': 'versus',
  'etc.': 'et cetera',
  'e.g.': 'for example',
  'i.e.': 'that is',
  'cf.': 'compare',
  'no.': 'number',
  'ch.': 'chapter',
  'chs.': 'chapters',
  'v.': 'verse',
  'vv.': 'verses',
  'ff.': 'and following',
  'approx.': 'approximately',
}

/** Reapplies `source`'s capitalization pattern to `expansion`'s first letter — the abbreviation
 *  map's values are stored in their "mid-sentence" casing, so a sentence-initial "Dr." (source
 *  starts uppercase) still expands to "Doctor" rather than lowercase "doctor" once it's the
 *  first word spoken. */
function applyCasing(expansion: string, source: string): string {
  if (!expansion || !source) return expansion
  const sourceIsUpper = source[0] === source[0].toUpperCase() && source[0] !== source[0].toLowerCase()
  if (!sourceIsUpper) return expansion
  return expansion[0].toUpperCase() + expansion.slice(1)
}

/** Expands a single abbreviation token, preserving any leading bracket/quote it was wrapped in
 *  and reapplying the token's original capitalization. Returns the token unchanged if it isn't
 *  a recognized abbreviation. */
export function expandAbbreviation(token: string): string {
  const leadingMatch = /^([([{"'‘“]*)(.*)$/.exec(token)
  const prefix = leadingMatch?.[1] ?? ''
  const rest = leadingMatch?.[2] ?? token
  const key = rest.toLowerCase()
  const expansion = ABBREVIATIONS[key]
  if (!expansion) return token
  return `${prefix}${applyCasing(expansion, rest)}`
}

// Characters/sequences most engines either mispronounce outright (reading the glyph name) or
// render with unnatural timing when spoken literally. Each is normalized to a comma, which
// reliably produces a short natural pause in every voice — matching how these marks actually
// function in prose (a dash or ellipsis is functionally a pause, not a word).
const EM_EN_DASH_RE = /[—–]/g
const ELLIPSIS_RE = /(\.\.\.|…)/g
// Repeated terminal punctuation ("!!", "??", "--") collapses to a single mark — some engines
// audibly stutter or pause once per character on a run of identical punctuation.
const REPEATED_PUNCT_RE = /([!?.,;:])\1+/g
// Curly quotes read identically to straight ones by every engine tested, but normalizing them
// avoids any per-voice inconsistency in how the two are tokenized internally.
const CURLY_QUOTES_RE = /[‘’]/g
const CURLY_DQUOTES_RE = /[“”]/g

/** Normalizes punctuation marks a TTS engine is prone to mis-voice, without changing which
 *  words are spoken. Safe to run on every token unconditionally — a token with none of these
 *  marks passes through untouched. */
export function normalizePunctuation(token: string): string {
  return token
    .replace(ELLIPSIS_RE, ',')
    .replace(EM_EN_DASH_RE, ',')
    .replace(REPEATED_PUNCT_RE, '$1')
    .replace(CURLY_QUOTES_RE, "'")
    .replace(CURLY_DQUOTES_RE, '"')
}

// ─── Pronunciation respellings ───────────────────────────────────────────────
//
// Kokoro phonemizes English SPELLING (espeak-ng rules), so the only lever for fixing a
// mispronounced proper noun is to hand it a different spelling that phonemizes the way the word
// should actually sound. This is a SPOKEN-ONLY substitution: the displayed verse text is never
// touched, and neither is the word-replacer's divine-name substitution that produced this token
// in the first place (see extractSpokenText.ts — that step is theologically load-bearing and
// settled; this one only decides how the resulting word is voiced).
//
// Target sound: Yeh-ho-vuh — the "ho" IS wanted; the last syllable is a plain schwa.
//
// Two iterations got here, and both dead ends are worth recording so they aren't retried:
//   1. "Yehovah" as spelled over-articulates the ending into a long "-vah" rhyming with "spa".
//      Respelling it "-vuh" is what produces the schwa. That part was right and stays.
//   2. Dropping the middle h to "Yeovuh" was WRONG. Removing the consonant leaves the vowels
//      adjacent, and espeak reads "eo" as a single diphthong rather than two syllables — which
//      is the "yay-oh-vuh" sound Michael explicitly rejected. The h is not really about being
//      heard as a hard consonant; it is what forces the syllable BREAK and keeps the first
//      vowel short. Removing it merges the syllables. So it stays.
//
// Hyphens are deliberately not used to mark syllables: espeak treats a hyphen as a word
// boundary, so a literal "Yeh-ho-vuh" reads as three separate words ("Yeh. Ho. Vuh.").
//
// NOTE FOR TUNING: this is a phonetic respelling and can only be judged by ear — no test can
// verify it. If it still isn't right, change the ONE value below; everything keys off it. Do NOT
// try removing the h again (see 2 above). Remaining levers are the ending ("-vuh" → "-vah"/"-va")
// and the first vowel ("Yeh" → "Yeh"/"Ye").
const PRONUNCIATION_RESPELLINGS: Record<string, string> = {
  yehovah: 'Yehovuh',
  yehovahs: "Yehovuh's",
  // Default espeak phonemization reads this as three beats ("yeh-SHOO-ah"); the requested sound
  // is a tighter two-beat "Ye-shua" ("YESH-wuh"), collapsing the "-oo-ah" tail into one syllable
  // rather than stretching it into two. Same rule as Yehovah above applies (no hyphens — espeak
  // treats those as word boundaries), so this is a same-word respelling, not a hyphenated one.
  // FIRST ATTEMPT, UNTESTED BY EAR — unlike Yehovah's respelling (already tuned/confirmed), this
  // one hasn't been listened to yet. If it doesn't land right, the lever to adjust is the ending
  // ("-wuh" → "-wa"/"-uh") rather than re-adding the "oo" back in, which reintroduces the
  // three-beat sound this is meant to collapse.
  yeshua: 'Yeshwuh',
  yeshuas: "Yeshwuh's",
}

const RESPELL_TOKEN_RE = /^([([{"'‘“]*)([A-Za-z]+)(?:('s|’s))?([)\]}"'’”,;:.!?]*)$/

/** Applies a pronunciation respelling when one exists for this word, preserving surrounding
 *  punctuation and any possessive. Returns the word unchanged when there is no entry. */
export function applyPronunciation(word: string): string {
  const m = RESPELL_TOKEN_RE.exec(word)
  if (!m) return word
  const [, lead, core, possessive, trail] = m
  const key = (core + (possessive ? 's' : '')).toLowerCase()
  const respelled = PRONUNCIATION_RESPELLINGS[key]
  if (!respelled) return word
  return `${lead}${respelled}${trail}`
}

/** The single entry point extractSpokenText.ts calls per spoken word, after word-replacer/
 *  Strong's substitution has already run. Order matters: abbreviations are checked against the
 *  RAW token first (an abbreviation token like "etc." would otherwise fall through
 *  expandNumbers/normalizePunctuation as an ordinary word and just lose its period), then
 *  numbers (which abbreviations can't be, so no conflict), then punctuation normalization runs
 *  last so it also cleans up anything left in an unexpanded word.
 *
 *  Pronunciation respelling runs FIRST: it keys on the word as the word-replacer left it (which
 *  is where "Yehovah" comes from), so running it after number/abbreviation expansion would risk
 *  matching against a token those steps had already rewritten. */
export function prepareWordForSpeech(word: string): string {
  const spoken = applyPronunciation(word)
  const abbrevExpanded = expandAbbreviation(spoken)
  if (abbrevExpanded !== spoken) return normalizePunctuation(abbrevExpanded)
  const numberExpanded = expandNumbers(spoken)
  if (numberExpanded !== spoken) return normalizePunctuation(numberExpanded)
  return normalizePunctuation(spoken)
}
