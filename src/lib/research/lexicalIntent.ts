// Detects word-study shaped requests deterministically (spec §4.2, §6.2) so they are answered from
// the lexicon before — and independently of — any model. Pure; shared by desktop and iPhone.

import { findReferencesInText } from './references'
import { parseStrongsIds, parseBareStrongsNumbers, type StrongsLang } from './strongsId'
import { hasOriginalScript } from './lexicon'
import { resolveBookToken, isExactBookToken, type ParsedRef } from '../parseRef'

export type LexicalIntentKind =
  | 'strongs-id'        // "G5485", "what does g5485 mean in Titus"
  | 'strongs-compare'   // "compare H2617 and H7356"
  | 'occurrences'       // "every occurrence of G5485", "where is H2617 used in Psalms"
  | 'word-study'        // "the Hebrew word for mercy", "chesed", "חסד", "word study on grace"
  | 'word-table'        // "every word and Strong's number in John 1:1", "word by word Titus 2:11"
  | 'untagged-words'    // "which words in John 3:16 have no Strong's number"

export interface LexicalIntent {
  kind: LexicalIntentKind
  ids: string[]
  /** The English/transliterated/original-script term for a word study. */
  term?: string
  termKind?: 'english' | 'transliteration-or-english' | 'original-script'
  lang: StrongsLang | null
  refs: ParsedRef[]
  /** "LXX"/"Septuagint" named — word tags should come from the Greek LXX, not the KJV. */
  wantsSeptuagint: boolean
  /** A bare term ("chesed", "what is koinonia") — a word study only if it resolves as a
   *  transliteration; an ordinary English word is handed back to topical retrieval. */
  bare?: boolean
  /** A book named without a chapter ("… in Acts", "in 1 John") — scopes occurrences. */
  bookId?: string
}

const COMPARE_RE = /\b(compare|comparison|contrast|difference|differ|distinguish|versus|vs\.?)\b/i
const OCCURRENCE_RE = /\b(occurrences?|occurs?|every\s+(?:place|time|verse)|all\s+(?:the\s+)?(?:places|verses|uses)|where\s+(?:is|does|do|are)\b[^?]*\b(?:used|found|appear|occur)|how\s+many\s+times|used\s+in|appears?\s+in|found\s+in)\b/i
const WORD_TABLE_RE = /\b(word[\s-]+by[\s-]+word|(?:strong'?s\s+)?break(?:down|\s+(?:it\s+)?down)|each\s+word|every\s+word|all\s+(?:the\s+)?words|interlinear|word\s+table|(?:strong'?s|strongs)\s+(?:numbers?|tags?)\s+(?:for|in|of)|(?:numbers?|tags?)\s+for\s+each\s+word)\b/i
const UNTAGGED_RE = /\b(no|without|missing|untagged)\b[^?.]{0,30}\bstrong'?s\b|\buntagged\b|\bnot\s+tagged\b/i

// Word-study phrasings. Group 1 (or the named group) is the term.
const WORD_STUDY_PATTERNS: RegExp[] = [
  /\bthe\s+(?:hebrew|greek|aramaic)\s+for\s+["“']?([^"”'?.,;]+?)["”']?(?=$|[?.,;]|\s+(?:in|within)\s)/i,
  /\bwhich\s+(?:hebrew|greek|aramaic)\s+word\s+is\s+["“']?([\p{L}-]{2,30})/iu,
  /^["“']?([\p{L}'-]{2,30})["”']?\s+as\s+a\s+word\b/iu,
  /\b(?:hebrew|greek|original|aramaic)\s+(?:words?|nouns?|verbs?|terms?|adjectives?)\s+(?:(?:is|was|that\s+is|which\s+is|used)\s+)?(?:for|meaning|that\s+means?|translated(?:\s+as)?|rendered(?:\s+as)?|glossed(?:\s+as)?|behind)\s+["“']?([^"”'?.,;]+?)["”']?(?=$|[?.,;]|\s+(?:in|within|across|throughout)\s)/i,
  /\b(?:the\s+)?word\s+["“']?([\p{L}'-]{2,30})["”']?\s+(?:is\s+|was\s+)?(?:used|found|appears?|occurs?|means?)\b/iu,
  /\bthe\s+words?\s+(?:for|translated|rendered)\s+["“']?([^"”'?.,;]+?)["”']?(?=$|[?.,;]|\s+(?:in|within)\s)/i,
  /\bstrong'?s(?:\s+number)?\s+for\s+["“']?([^"”'?.,;]+?)["”']?(?=$|[?.,;]|\s+(?:in|within)\s)/i,
  /\bword[\s-]+study\s+(?:on|of|for|about)?\s*["“']?([^"”'?.,;]+?)["”']?(?=$|[?.,;])/i,
  /\bwhat\s+(?:does|is)\s+(?:the\s+(?:hebrew|greek)\s+(?:word\s+)?)?["“']?([\p{L}'-]+)["”']?\s+mean\s+in\s+(?:hebrew|greek)\b/iu,
  /\b(?:hebrew|greek)\s+(?:entries|words|lemmas)\s+(?:whose\s+definitions?\s+mentions?|mentioning|about|related\s+to)\s+["“']?([^"”'?.,;]+?)["”']?(?=$|[?.,;])/i,
  /\b(?:greek|hebrew)\s+words?\s+related\s+to\s+["“']?([^"”'?.,;]+?)["”']?(?=$|[?.,;])/i,
]

function languageOf(text: string): StrongsLang | null {
  const h = /\b(hebrew|aramaic|old\s+testament)\b/i.test(text)
  const g = /\b(greek|new\s+testament|septuagint|lxx)\b/i.test(text)
  return h && !g ? 'H' : g && !h ? 'G' : null
}

/** A single bare token (no spaces) that could be a transliteration ("chesed", "agape"). */
const SINGLE_TOKEN_RE = /^["“']?([\p{L}'-]{2,30})["”']?[?.!]?$/u
/** "what is koinonia" / "what does agape mean" / "define pneuma" / "meaning of shalom". */
const BARE_TERM_RE = /^(?:what\s+is|what'?s|what\s+does|define|meaning\s+of)\s+["“']?([\p{L}'-]{2,30})["”']?(?:\s+mean)?\s*[?.!]?$/iu

/** "… in Acts" / "in 1 John" / "through the Psalms" at the end of a question → book id. */
function trailingBook(q: string): string | undefined {
  const m = q.match(/\b(?:in|through(?:out)?|within)\s+(?:the\s+)?((?:[1-3]\s?)?[A-Za-z]+(?:\s+of\s+[A-Za-z]+)?)\s*[?.!]?$/i)
  if (!m || !isExactBookToken(m[1])) return undefined
  return resolveBookToken(m[1]) ?? undefined
}

export function detectLexicalIntent(question: string): LexicalIntent | null {
  const r = detectLexicalIntentInner(question)
  if (!r) return r
  const bookId = r.refs[0]?.bookId ?? trailingBook(question.trim())
  return bookId ? { ...r, bookId } : r
}

function detectLexicalIntentInner(question: string): LexicalIntent | null {
  const q = question.trim()
  if (!q) return null
  const lang = languageOf(q)
  const refs = findReferencesInText(q)
  const wantsSeptuagint = /\b(septuagint|lxx)\b/i.test(q)
  const typedIds = parseStrongsIds(q).map((m) => m.id)
  const bareIds = typedIds.length === 0 ? parseBareStrongsNumbers(q).map((m) => m.id) : []
  const ids = typedIds.length > 0 ? typedIds : bareIds

  if (refs.length > 0 && (WORD_TABLE_RE.test(q) || UNTAGGED_RE.test(q))) {
    return { kind: UNTAGGED_RE.test(q) ? 'untagged-words' : 'word-table', ids, lang, refs, wantsSeptuagint }
  }
  if (ids.length >= 2 && COMPARE_RE.test(q)) return { kind: 'strongs-compare', ids, lang, refs, wantsSeptuagint }
  if (ids.length > 0) {
    return { kind: OCCURRENCE_RE.test(q) ? 'occurrences' : 'strongs-id', ids, lang, refs, wantsSeptuagint }
  }

  // Original-script input anywhere: "חסד", "what does χάρις mean".
  if (hasOriginalScript(q)) {
    const word = q.match(/[֐-׿Ͱ-Ͽἀ-῿]+/u)?.[0]
    if (word) return { kind: 'word-study', ids: [], term: word, termKind: 'original-script', lang: /[֐-׿]/u.test(word) ? 'H' : 'G', refs, wantsSeptuagint }
  }

  for (const re of WORD_STUDY_PATTERNS) {
    const m = q.match(re)
    const term = m?.[1]?.trim().replace(/^(?:the|a|an)\s+/i, '')
    if (term && term.split(/\s+/).length <= 3) {
      return { kind: OCCURRENCE_RE.test(q) ? 'occurrences' : 'word-study', ids: [], term, termKind: 'transliteration-or-english', lang, refs, wantsSeptuagint }
    }
  }

  // A single bare word ("chesed", "agape"): only a word study when the caller confirms it is not
  // an ordinary KJV English word (a bare "grace" is a topical search, not a lexicon lookup).
  const single = q.match(SINGLE_TOKEN_RE) ?? q.match(BARE_TERM_RE)
  if (single && refs.length === 0) {
    return { kind: 'word-study', ids: [], term: single[1], termKind: 'transliteration-or-english', lang, refs, wantsSeptuagint, bare: true }
  }
  return null
}
