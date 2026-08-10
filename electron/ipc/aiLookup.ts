import type { IpcMain } from 'electron'
import { randomUUID } from 'crypto'
import { getBereanDb } from '../db/berean'
import { queryVerse, searchVerses } from './bible'
import { getTextDb } from '../db/bible'
import { getCrossRefsForVerse, getTskeForVerse, getIncomingCrossRefsForVerse, getIncomingTskeForVerse } from './crossrefs'
import { getLexiconEntry, getLexiconOccurrences } from './lexicon'
import { checkOllamaAvailable, runOllamaJson, runOllamaText, DEFAULT_OLLAMA_MODEL } from '../ollama'
// A real, already-existing, actively-maintained reference parser + book-name table — unlike
// normalizeBookName/getWordReplacerVariants elsewhere in this file (deliberately ported, not
// imported, since they're small and this main-process build doesn't otherwise pull from src/),
// this one is large and load-bearing for the whole app's reference handling, so importing it
// directly (rather than porting a copy that could silently drift) is the right call here —
// electron.vite.config.ts's `main` build target already aliases `@` -> `src`, same as the
// renderer, and tsconfig.node.json already has the matching `paths` entry.
import { parseRef, isExactBookToken, type ParsedRef } from '@/lib/parseRef'
import { PSEUDEPIGRAPHA_ARCHAIC_VOCAB } from './archaicVocab'

// Minimal shape of src/store's WordReplacerRule this file actually needs — deliberately not
// importing the renderer's src/lib/wordReplacer.ts here even though its logic is identical
// (see getWordReplacerVariants below): the main process build doesn't otherwise pull in
// anything from src/, and this keeps it that way rather than risk that cross-boundary import
// resolving differently under electron-vite's main-process bundle than it does in the
// renderer's. The renderer sends rules already filtered to enabled/non-Strong's ones — see
// AiLookupPanel.tsx's call site — so no further filtering happens here.
export interface WordReplacerRuleLite {
  queries: string[]
  replacement: string
}

export type ResultSource = 'keyword' | 'ai-guess' | 'cross-ref' | 'strongs' | 'quote-source'

export interface AiLookupResult {
  textId: string
  bookId: string
  bookName: string
  chapter: number
  verse: number
  endVerse?: number
  text: string
  source: ResultSource
  commentary?: string
  /** True if a verse note already exists at this exact reference — surfaced as a small
   *  "you have a note here" indicator, and counted as a strong relevance signal. */
  noted?: boolean
  /** Only set on `source: 'cross-ref'` results — which primary result they were expanded
   *  from, so the UI can nest them under it instead of listing them as flat, equal-weight
   *  entries. */
  crossRefOf?: { bookId: string; chapter: number; verse: number }
}

export interface AiLookupResponse {
  /** Primary (non-cross-ref) results, ranked, followed by their nested cross-ref results. */
  results: AiLookupResult[]
  /** How many of `results` (counting only primary ones) the UI should show before a
   *  "Show more" button reveals the rest — computed server-side so the UI doesn't have to
   *  guess a good default. */
  visibleCount: number
  /** Extracted search keywords, returned so the UI can highlight matched terms in verse text
   *  without re-deriving them. */
  keywords: string[]
  /** A canonical (KJV/LXX) guess that surfaced alongside a focus-text (pseudepigrapha)
   *  question — shown separately, after the focus text's own results, with `relatedNote`
   *  explaining why: naming a specific work means that work's own content should lead, but a
   *  "this is also/really recorded in Genesis 12:1" pointer is still useful, just not the
   *  headline answer. Empty unless a focus text was in play. */
  related: AiLookupResult[]
  relatedNote?: string
  /** A real, DB-verified Strong's word card — set whenever the question contained (or the model
   *  proposed and we verified) a real Strong's number. Rendered as its own clickable card (opens
   *  the full Lexicon tab), not folded into the verse-results list. */
  strongsCard?: AiLookupStrongsCard
  summary?: string
  error?: string
  /** Real, DB-verified note matches — either the whole answer (an explicit "what notes have I
   *  written about X" question) or a small augmentation alongside verse results (a topical/
   *  meaning question that also happens to match a note's title/idiom-term/verse-ref). Never a
   *  loose full-content match — see computeMatchingNotes. A note has a fundamentally different
   *  shape than a verse (`AiLookupResult`), so this is its own array rather than forcing it into
   *  that type via a fake `source: 'note'`. */
  notes?: AiLookupNoteResult[]
  /** True when `notes` fully answers the question on its own (an explicit note-ask) — the UI
   *  uses this to skip rendering an empty/irrelevant verse-results section entirely, rather than
   *  showing "no matching verses" underneath a perfectly good notes answer. */
  notesAreThePrimaryAnswer?: boolean
}

export interface AiLookupNoteResult {
  id: string
  title: string
  snippet: string
  isIdiom: boolean
  idiomTerm?: string
}

export interface AiLookupStrongsCard {
  strongsNum: string
  lemma: string
  transliteration: string
  /** short_def — the classic "how this word is rendered in the KJV" gloss list. */
  gloss: string
  definition: string
  derivation: string
  occurrenceCount: number
}

interface AiExtraction {
  keywords: string[]
  // `verse` comes back missing/null from the model surprisingly often — a whole-chapter
  // reference ("John 17", "Revelation 12") or a range where it only bothered to give
  // `endVerse` ("chapter 5, endVerse 48" meaning "the whole chapter, up to 48") are both
  // real, observed shapes, not just theoretical — see the runLookup guess-processing loop
  // for how a missing `verse` is normalized instead of crashing the DB query.
  guesses: Array<{ book: string; chapter: number; verse?: number | null; endVerse?: number | null }>
  // A Strong's number the model recalls as relevant for a "what's the word for X" style
  // question — verified against the real lexicon DB before ever being used (see
  // resolveStrongsNumbers), same trust model as a book/chapter guess.
  strongsNum?: string | null
}

/** One prior turn, trimmed down to just what the extraction prompt needs. */
export interface ChatHistoryTurn {
  role: 'user' | 'assistant'
  content: string
}

// Soft ceiling while gathering keyword candidates — purely to bound worst-case work, not a
// "shown" count. Guesses lead the final result (see runLookup step 5); keyword search only
// ever backfills a handful of gaps, so this pool is just the pre-ranking scratch space.
const CANDIDATE_POOL_CAP = 60
// Guesses always lead; keyword search only backfills when there are too few guesses to stand
// on their own, and even then contributes at most KEYWORD_BACKFILL_CAP — a wrong/absent guess
// shouldn't turn into a wall of generic keyword hits either. TOTAL_PRIMARY_CAP is the ceiling
// on the combined primary list (guesses + backfill) shown by default.
const KEYWORD_BACKFILL_CAP = 3
const TOTAL_PRIMARY_CAP = 6
const MAX_CROSS_REFS = 12

// Canonical Bible texts — the only ones cross_references.db/tske_refs.db/notes.verse_ref are
// keyed against, so cross-ref expansion and the notes signal stay restricted to these. AI
// guesses, by contrast, are also allowed against the CURRENT QUESTION's focus text (see
// detectFocusTextId below) even when it's pseudepigrapha — Jubilees/Enoch/etc each have a
// single `books` row with ordinary chapter:verse numbering, so a guess resolves against them
// exactly the same way a canonical guess resolves against kjva's 66 books.
const CANONICAL_TEXT_IDS = new Set(['kjva', 'kjv', 'lxx'])
const DEFAULT_TEXT_ID = 'kjva'

// Every non-canonical text this app ships (mirrors TEXT_FILES in electron/db/bible.ts minus the
// 3 canonical ids above) — Round 10: an UNFOCUSED question (one that never names a specific
// work) now searches all of these ALONGSIDE canonical, not just canonical alone, so a genuinely
// better non-canonical answer (Jubilees, Enoch, etc — any of them, not a hardcoded special case)
// gets a real chance to be ranked as the top result instead of never being searched at all. See
// the unfocused branch of the result-assembly step and the canonical-tie-break sort below.
const ALL_PSEUDEPIGRAPHA_TEXT_IDS = [
  'enoch', 'jubilees', 'apoc_elijah', 'recog_clement', 'hermas', 'hermas_taylor', 'asc_isaiah',
  'ep_barnabas', 't12p', 'gad', 't_job', '1clement', 'apoc_abraham', 'didache_hoole', 't_jacob',
  '2baruch',
]

// Aliases a user might type for a specific work, mapped to its textId (see TEXT_FILES in
// electron/db/bible.ts). Checked longest-first against the raw question so "1 enoch" doesn't
// get shadowed by a shorter, unrelated substring. Deliberately covers the texts most likely to
// come up by name in a lookup question — not exhaustive of every text/alias combination.
// Order matters — detectFocusTextId below returns the FIRST match, in array order, not the
// longest, so a more specific alias must be listed before any shorter alias it also contains
// as a substring (e.g. "hermas taylor" before bare "hermas", "recognitions of clement" before
// bare "clement") or the specific one can never be reached.
const TEXT_ALIASES: Array<[string, string]> = [
  ['book of jubilees', 'jubilees'], ['jubilees', 'jubilees'],
  ['1 enoch', 'enoch'], ['book of enoch', 'enoch'], ['enoch', 'enoch'],
  ['septuagint', 'lxx'], ['brenton', 'lxx'], [' lxx', 'lxx'],
  // Two distinct Hermas translations in this app (hermas.db vs hermas_taylor.db) — the
  // Taylor-specific aliases must be checked first or they'd never be reached, since they all
  // contain the substring "hermas" that the plain aliases below would otherwise match first.
  ['taylor hermas', 'hermas_taylor'], ['hermas taylor', 'hermas_taylor'], ["taylor's hermas", 'hermas_taylor'],
  ['shepherd of hermas', 'hermas'], ['hermas', 'hermas'],
  ['epistle of barnabas', 'ep_barnabas'], ['barnabas', 'ep_barnabas'],
  // "Recognitions" checked before bare "clement" for the same reason as Hermas above.
  ['recognitions of clement', 'recog_clement'], ['recognitions', 'recog_clement'],
  ['first clement', '1clement'], ['1 clement', '1clement'],
  // Bare "clement" defaults to 1 Clement — the far more commonly-referenced of the two works
  // sharing that name, rather than the previous default (Recognitions), which most people
  // wouldn't mean by a bare "Clement" mention.
  ['clement', '1clement'],
  ['testaments of the twelve patriarchs', 't12p'], ['twelve patriarchs', 't12p'],
  // Each patriarch's individual testament is one book WITHIN t12p.db, not its own text — but a
  // real question naming one ("testament of reuben", "testament of levi") never mentions the
  // collective work's name at all, so without these the whole book was undetectable as a focus
  // text — confirmed via battery testing: 0/13 T12P questions matched before this fix, since
  // every one of them names an individual patriarch's testament, never "the twelve patriarchs"
  // itself. The specific book (TREU/TLEV/etc) still resolves normally afterward via
  // resolveBookId once t12p is established as the focus text.
  ['testament of reuben', 't12p'], ['testament of simeon', 't12p'], ['testament of levi', 't12p'],
  ['testament of judah', 't12p'], ['testament of issachar', 't12p'], ['testament of zebulun', 't12p'],
  ['testament of dan', 't12p'], ['testament of naphtali', 't12p'], ['testament of gad', 't12p'],
  ['testament of asher', 't12p'], ['testament of joseph', 't12p'], ['testament of benjamin', 't12p'],
  ['testament of job', 't_job'],
  ['ascension of isaiah', 'asc_isaiah'],
  ['2 baruch', '2baruch'], ['second baruch', '2baruch'],
  ['didache', 'didache_hoole'],
  ['apocalypse of abraham', 'apoc_abraham'],
  ['apocalypse of elijah', 'apoc_elijah'],
  ['testament of jacob', 't_jacob'],
  ['gad the seer', 'gad'],
]

function detectFocusTextId(question: string): string | null {
  const lower = ` ${question.toLowerCase()} `
  for (const [alias, textId] of TEXT_ALIASES) {
    if (lower.includes(alias)) return textId
  }
  return null
}

// Per-text book id<->name maps, built from that text's own `books` table (each text DB —
// including pseudepigrapha — has one). Cached per textId since it never changes at runtime.
const _bookMaps = new Map<string, { toId: Map<string, string>; toName: Map<string, string> }>()
function getBookMaps(textId: string): { toId: Map<string, string>; toName: Map<string, string> } {
  let maps = _bookMaps.get(textId)
  if (maps) return maps
  maps = { toId: new Map(), toName: new Map() }
  try {
    const db = getTextDb(textId)
    if (db) {
      const rows = db.prepare('SELECT id, name, short_name FROM books').all() as Array<{ id: string; name: string; short_name: string }>
      for (const r of rows) {
        maps.toId.set(r.name.toUpperCase(), r.id)
        maps.toId.set(r.short_name.toUpperCase(), r.id)
        // Also index the arabic-numeral form ("1 Samuel") alongside the DB's raw roman-numeral
        // name ("I Samuel") — a guess's "book" field routinely uses modern numbering (it's what
        // the model actually knows the book as), which otherwise silently fails to resolve here
        // even though it's a perfectly valid, common way to name the book.
        const normalized = normalizeBookName(r.name).toUpperCase()
        if (normalized !== r.name.toUpperCase()) maps.toId.set(normalized, r.id)
        maps.toName.set(r.id, r.name)
      }
    }
  } catch { /* leave maps empty — lookups against this text just won't resolve */ }
  _bookMaps.set(textId, maps)
  return maps
}

function resolveBookId(raw: string, textId: string): string | null {
  const upper = raw.trim().toUpperCase()
  const { toId, toName } = getBookMaps(textId)
  if (toName.has(upper)) return upper // already a valid id for this text
  return toId.get(upper) ?? null
}

// Ported from src/lib/parseRef.ts's normalizeBookName (not imported — same cross-process
// reasoning as WordReplacerRuleLite above). The text DBs store book names with roman-numeral
// prefixes ("I Samuel", "II Kings"); the rest of the app already normalizes these to arabic
// numerals for display ("1 Samuel", "2 Kings") — this keeps AI Lookup's results consistent
// with that convention instead of showing the raw DB form.
function normalizeBookName(name: string): string {
  return name.replace(/^III /, '3 ').replace(/^II /, '2 ').replace(/^I /, '1 ')
}

function bookNameFor(bookId: string, textId: string): string {
  return normalizeBookName(getBookMaps(textId).toName.get(bookId) ?? bookId)
}

/** For a single-book work (Jubilees, 1 Enoch, etc. — anything with exactly one row in its own
 *  `books` table), returns that book's display name — used to tell the model which work's name
 *  to use for a focus-text guess (e.g. "Jubilees"), without hardcoding a second name list. */
function singleBookWorkName(textId: string): string | null {
  const names = [...getBookMaps(textId).toName.values()]
  return names.length === 1 ? names[0] : null
}

function cleanWords(q: string): string[] {
  return q.trim().split(/\s+/).filter(Boolean).map(w => w.replace(/[^a-zA-Z0-9']/g, '')).filter(w => w.length >= 1)
}

// Single bare words the model still reaches for occasionally despite being told to prefer
// specific multi-word phrases — a phrase search on a lone word this common doesn't just
// return "too many" hits (that's handled by the candidate cap), it specifically returns the
// WRONG ones: FTS5's bm25 ranking favors short documents for high term-density matches, so a
// bare "Jesus" query ranks tiny verses like "Jesus wept" (John 11:35) at the very top —
// observed empirically surfacing as the exact same handful of irrelevant filler verses across
// many unrelated questions. Multi-word keywords containing these words (e.g. "Jesus wept",
// "Jesus Christ") are unaffected — only a keyword that reduces to a single word from this list
// is dropped before search.
const OVERLY_GENERIC_SINGLE_WORDS = new Set([
  'god', 'jesus', 'yeshua', 'christ', 'lord', 'spirit', 'ghost', 'heaven', 'earth', 'love',
  'day', 'days', 'said', 'come', 'man', 'men', 'son', 'sons', 'father', 'king', 'people',
  'israel', 'said', 'went', 'saith', 'thing', 'things', 'great', 'good',
  // Round 10.1: found via testing — when the model also fails to produce a usable guess (a
  // separate, real extraction-reliability gap, not a ranking problem this list can fix), "given"
  // alone was matching enough scattered non-canonical verses ("X was given...") to win against
  // the real canonical answer purely on count, same failure mode as the other words above.
  'given',
])

// Patriarch/narrative names that are legitimate, specific keywords for ordinary canonical
// search, but provide near-zero discriminating power inside a pseudepigrapha focus text that
// retells the same Genesis-through-Exodus narrative in full (Jubilees, and to a lesser extent
// Enoch/T12P) — these names recur in nearly every chapter there. Found via testing: a bare
// "Abraham" keyword hit was outscoring a precise archaic-vocabulary match purely because it
// numerically matched more (wrong) chapters, contributing directly to a wrong top-ranked guess.
// Applied ONLY when a focus text is active — these are perfectly good keywords everywhere else.
const OVERLY_GENERIC_IN_FOCUS_TEXT = new Set([
  'abraham', 'isaac', 'jacob', 'noah', 'moses', 'family', 'leave', 'wife', 'children',
])

// Common function words a keyword phrase can carry without adding any real discriminating
// content of its own — used only by the multi-word check below, to decide whether a phrase like
// "Abraham's family" is functionally nothing more than the two denylisted names it's built from.
const GENERIC_PHRASE_STOPWORDS = new Set(['the', 'of', 'a', 'an', 'his', 'her', 'their', 'and', 'in', 'to', 'from', 'is', 'was', 'were'])

function stripPossessive(word: string): string {
  return word.replace(/'s$/i, '')
}

/** Drops keywords that are a single, overly-generic word — see OVERLY_GENERIC_SINGLE_WORDS
 *  (always) and OVERLY_GENERIC_IN_FOCUS_TEXT (only when `inFocusText` is true). Also drops a
 *  MULTI-word phrase in focus-text mode if every substantive word in it (ignoring simple
 *  stopwords) is itself in the focus-text denylist — e.g. "Abraham's family" reduces to just
 *  "abraham" + "family", both denylisted, so the phrase carries no more discriminating power
 *  there than the bare words it's made of. Found via testing: the model frequently produces
 *  exactly this shape of phrase, and the old single-word-only check let it straight through.
 *  A phrase with any real content word (e.g. "Abraham's idols") survives untouched. */
function filterGenericKeywords(keywords: string[], inFocusText = false): string[] {
  return keywords.filter((kw) => {
    const words = cleanWords(kw)
    if (words.length === 0) return false
    if (words.length === 1) {
      const w = stripPossessive(words[0].toLowerCase())
      if (OVERLY_GENERIC_SINGLE_WORDS.has(w)) return false
      if (inFocusText && OVERLY_GENERIC_IN_FOCUS_TEXT.has(w)) return false
      return true
    }
    if (inFocusText) {
      const substantive = words.map((w) => stripPossessive(w.toLowerCase())).filter((w) => !GENERIC_PHRASE_STOPWORDS.has(w))
      if (substantive.length > 0 && substantive.every((w) => OVERLY_GENERIC_IN_FOCUS_TEXT.has(w))) return false
    }
    return true
  })
}

/** Expands a keyword into every word-replacer variant worth also searching for — same logic
 *  as src/lib/wordReplacer.ts's getWordReplacerSearchVariants (ported, not imported; see the
 *  WordReplacerRuleLite comment above for why), applied here so keyword search finds a verse
 *  regardless of which side of a replacement pair (e.g. "Jesus"/"Yeshua") the model happened
 *  to use — the extraction prompt already tells it to prefer literal KJV wording, but this
 *  makes that instruction non-load-bearing instead of a silent miss when the model doesn't
 *  comply. Each returned string is a complete, independent query to search and union, not a
 *  single "OR"-joined string (FTS5 in this app treats every word as a required token, so a
 *  literal " OR " would just become another required word — see the ported comment's origin).
 */
function getWordReplacerVariants(keyword: string, rules: WordReplacerRuleLite[]): string[] {
  const trimmed = keyword.trim()
  if (!trimmed || rules.length === 0) return [trimmed]
  const lq = trimmed.toLowerCase()
  const variants = new Set<string>([trimmed])
  const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

  for (const rule of rules) {
    const lReplacement = rule.replacement.toLowerCase()
    for (const orig of rule.queries) {
      const lOrig = orig.toLowerCase()
      if (lq.includes(lReplacement)) {
        variants.add(trimmed.replace(new RegExp(escapeRe(rule.replacement), 'ig'), orig))
      }
      if (lq.includes(lOrig)) {
        variants.add(trimmed.replace(new RegExp(escapeRe(orig), 'ig'), rule.replacement))
      }
    }
  }
  return [...variants]
}

/** Expands a keyword with archaic-translation-era phrase variants (see archaicVocab.ts) when
 *  searching a pseudepigrapha text — a deterministic, code-side lever for the same problem
 *  getWordReplacerVariants solves for user-configured Yeshua/Jesus-style rules: a modern-phrased
 *  keyword (e.g. "idolatry") often has zero literal overlap with these texts' real 1913-era
 *  wording ("the house of the idols"), no matter how the extraction prompt's own soft "phrase it
 *  archaically" instruction is followed on any given call. Gated to pseudepigrapha textIds only
 *  — canonical KJV/LXX text doesn't need this. Substring-match against `modern`, same simple
 *  approach as getWordReplacerVariants, not a full NLP match — good enough for short search
 *  phrases. */
// Stem, not exact-substring, match — the model doesn't reliably produce the SAME inflection of
// a word every call (confirmed empirically: 1 in 6 real extraction calls for the exact same
// question produced "idolatrous" instead of "idolatry" — plain `.includes('idolatry')` misses
// that entirely, silently skipping the archaic-vocab expansion on a random fraction of calls
// for no good reason). A shared 6-character prefix ("idolat" for both "idolatry" and
// "idolatrous") is a simple, effective-enough stem for this use case without pulling in a real
// stemming library for what's still just short search phrases.
function stemMatches(modernWord: string, keywordLower: string): boolean {
  const stem = modernWord.length > 6 ? modernWord.slice(0, 6) : modernWord
  return keywordLower.includes(stem)
}

// Round 10: `strict` gates a multi-word (2+) archaic variant behind phraseRarityCount — only
// used for the new UNFOCUSED, canonical+all-16-non-canonical-together search (see textPasses in
// runLookup and the `opportunistic` flag threaded from there). Left OFF (default) for the
// original, already-validated focus-text/canonical-only paths — unchanged from Round 9.
//
// Why this is needed: several archaic-vocab entries legitimately map a common, general-purpose
// word (e.g. "Yeshua", "peace") to a multi-word title/epithet that recurs constantly throughout
// that text ("the Son of Man" in Enoch, "the Beloved" in the Ascension of Isaiah, "peace and
// concord" in 1 Clement) — perfectly reasonable when a user has already confirmed interest in
// THAT specific work by naming it, but risky once every non-canonical text is searched for EVERY
// unfocained question: "Yeshua"/"Jesus" alone is common enough to appear in countless unrelated
// canonical questions, and would otherwise drag in an irrelevant Enoch/Ascension-of-Isaiah
// passage ahead of the real canonical answer. Confirmed directly: an unfocused control question
// ("where does Yeshua calm the storm", nothing to do with either text) surfaced Enoch's "Son of
// Man" verses and Ascension of Isaiah's "the Beloved" verses ahead of the real canonical
// Matthew/Mark answer, purely through this mechanism, before this gate — a genuinely rare phrase
// (e.g. Jubilees' "the house of the idols", 1 real occurrence) stays eligible either way; a
// recurring epithet (5+, 14+ occurrences) only stays eligible for the focused, already-trusted
// path.
function getArchaicVariants(keyword: string, textId: string, strict = false): string[] {
  const lq = keyword.trim().toLowerCase()
  if (!lq) return []
  const variants: string[] = []
  const seen = new Set<string>()
  const kwWords = cleanWords(lq)
  for (const rule of PSEUDEPIGRAPHA_ARCHAIC_VOCAB) {
    if (!(rule.textIds as string[]).includes(textId)) continue
    const modernHit = rule.modern.some((phrase) => phrase.toLowerCase().split(/\s+/).every((w) => stemMatches(w, lq)))
    // Round 10.1: when NOT strict (the user already named this specific text — a safe,
    // single-text context, same reasoning as the rarity bonus above), ALSO offer this archaic
    // phrase if the keyword is already one of the WORDS inside it (exact word match, not a
    // fuzzy stem) — e.g. keyword "idols" is literally a word within "the house of the idols".
    // This catches a real gap the modern-word bridge above misses entirely: the extraction
    // prompt tells the model to phrase Jubilees/Enoch keywords archaically, and when it complies
    // and produces an already-archaic word directly ("idols", not "idolatry"), that word has no
    // stem-overlap with the RULE's "modern" trigger list at all, so the bridge to the fuller,
    // more specific phrase never fires. Confirmed directly against real production output: the
    // keyword set ["Abraham","idols","graven images"] found 10 scattered "idols" occurrences
    // across all of Jubilees with no path to the one genuinely rare, event-identifying phrase
    // ("the house of the idols", 1 occurrence) that would let the rarity-weighted scoring above
    // correctly single out the right chapter — landing on an unrelated idol-condemnation speech
    // in chapter 21 instead of the actual chapter-12 event. Length-4-plus and exact-word (not
    // substring) matching keeps this precise rather than a fuzzy/coincidental collision.
    const archaicWordHit = !strict && kwWords.some((w) => w.length >= 4 && cleanWords(rule.archaic).some((aw) => aw.toLowerCase() === w))
    if (!modernHit && !archaicWordHit) continue
    if (strict) {
      const words = cleanWords(rule.archaic)
      if (words.length >= 2 && phraseRarityCount(words, textId) > 2) continue
    }
    if (seen.has(rule.archaic)) continue
    seen.add(rule.archaic)
    variants.push(rule.archaic)
  }
  return variants
}

function extractionPrompt(question: string, focusWorkName: string | null, history: ChatHistoryTurn[] = []): string {
  // Recent turns only (caller already caps this — see runLookup) — gives a follow-up question
  // ("what about the chapter after that") something to resolve against, without needing the
  // model to somehow remember anything itself (each call is still a fresh, stateless request).
  const historyBlock = history.length > 0
    ? `\nRecent conversation (for context only — answer the CURRENT question below, not these):\n${history.map((h) => `${h.role === 'user' ? 'User' : 'Assistant'}: ${h.content}`).join('\n')}\n`
    : ''
  // Found via testing: asking for "Yeshua's longest prayer" (John 17) got a guess of
  // {chapter:17, verse:1} with no endVerse — a completely natural way to CITE the passage, but
  // it meant only verse 1 ever displayed instead of the whole prayer. The model isn't wrong to
  // give a starting verse; nothing was telling it a whole discourse needs its real end too.
  const wholePassageRule = `- If the passage you're recalling is a well-known DISCOURSE spanning
  multiple verses (a prayer, sermon, parable, speech, or similar — not a single-verse quote),
  set "endVerse" to where it actually ends, not just its opening verse. Example: Yeshua's high
  priestly prayer is the WHOLE of John 17 — guess {"book":"John","chapter":17,"verse":1,
  "endVerse":26}, not verse 1 alone.`
  const guessRule = focusWorkName
    ? `- "guesses": 0-5 direct chapter:verse references you recall as relevant. The user is
  specifically asking about **${focusWorkName}** — if you recall a specific passage in
  ${focusWorkName} itself, guess it using "book": "${focusWorkName}" (it has ordinary
  chapter:verse numbering like any Bible book). You may also include KJV/Bible guesses (using
  full English book names) if a related canonical passage comes to mind. "endVerse" is
  optional, only for a real multi-verse range you recall. Omit "guesses" (empty array) if
  unsure — do not fabricate a reference you don't actually recall.
${wholePassageRule}`
    : `- "guesses": 0-5 direct verse references you recall as relevant, if any. Use full English
  Bible book names for a canonical passage (e.g. "Genesis", "John"). This question didn't name a
  specific non-canonical work, but if you genuinely recall a relevant passage in a well-known one
  (Jubilees, 1 Enoch, the Didache, etc.) it is ALSO searched this round — guess it using that
  work's own name as "book" (e.g. "book": "Jubilees"; these use ordinary chapter:verse numbering
  too). "endVerse" is optional, only include it for a real multi-verse range you recall. Omit
  "guesses" (empty array) if unsure — do not fabricate a reference you don't actually recall.
${wholePassageRule}`

  // Pseudepigrapha texts in this app are early-20th-century English translations (Jubilees and
  // 1 Enoch are both R.H. Charles, 1913/1917) — archaic, formal wording. A question phrased in
  // modern English ("idolatry") will not literally appear in that translation's actual text
  // (it says "idols"/"graven images"/"molten images" instead) — confirmed directly against
  // jubilees.db: the modern word never matches, but the period phrase "the house of the idols"
  // matches the correct verse exactly. Without this note the model's keywords stay modern and
  // silently fail to match anything in the real text.
  const styleNote = focusWorkName
    ? `\n- ${focusWorkName} is an early-20th-century English translation with archaic, formal
  wording — it will NOT use modern phrasing like "idolatry"; it says things like "idols",
  "graven images", "molten images", "worship". Phrase each keyword the way THIS OLD TRANSLATION
  would actually say it, not a modern paraphrase of the question. Keep each keyword a short
  literal phrase (2-5 words) that could appear verbatim in the text — not a mashed-together
  multi-concept phrase (e.g. "the house of the idols" is useful, "idol worship family house"
  is not, even though both describe the same idea).`
    : ''

  return `You are a Bible search-term extractor for a KJV/LXX/pseudepigrapha study app. A user asked a question about where to find a passage in Scripture. Your ONLY job is to produce search input for a database — do not answer the question yourself, do not add commentary.
${historyBlock}
User question: "${question}"

Respond with ONLY a JSON object of this exact shape:
{
  "keywords": ["short phrase or name", "..."],
  "guesses": [{"book": "Genesis", "chapter": 12, "verse": 1, "endVerse": 3}],
  "strongsNum": "H2580"
}

Rules:
- "keywords" are matched literally against unmodified text — use the wording the source text
  actually uses (e.g. "Jesus" not "Yeshua", "Holy Ghost" not "Holy Spirit"), even if that
  differs from how the question was phrased. 3-6 short search phrases or proper names (people,
  places, concepts) likely to appear verbatim in the verse text. Prefer specific multi-word
  phrases or names over single generic words (avoid bare words like "God", "love", "earth" —
  they match thousands of unrelated verses).${styleNote}
${guessRule}
- "strongsNum": optional. Only if the question is specifically about a Hebrew or Greek WORD or
  its meaning (e.g. "the Hebrew word for grace", "what does agape mean") and you actually recall
  its Strong's number — a single string like "H2580" or "G26". It will be verified against the
  real lexicon before use and silently ignored if wrong, so don't guess wildly; omit it for
  ordinary topic/passage questions.
- No explanation, no markdown, JSON only.`
}

function commentaryPrompt(question: string, verses: AiLookupResult[]): string {
  const list = verses.slice(0, 12).map((v) => `${v.bookId} ${v.chapter}:${v.verse}${v.endVerse ? '-' + v.endVerse : ''} — ${v.text}`).join('\n')
  return `A user asked: "${question}"

Here are candidate verses already found and verified against the actual Bible text (do not add,
remove text from, or renumber any of them):
${list}

Two jobs:
1. For each verse that's genuinely relevant to the question, write ONE brief sentence (max ~20
   words) explaining how it relates. Keep it terse — this is a reference tool, not a sermon.
2. Flag any verse above that is NOT actually relevant to the question (e.g. it only shares a
   generic word, not the actual topic) so it can be dropped from the results.
Then write a 1-2 sentence overall summary.

Respond with ONLY a JSON object of this exact shape:
{
  "perVerse": {"GEN 12:1": "..."},
  "irrelevant": ["GEN 12:1", "..."],
  "summary": "..."
}
Keys/entries must be exactly "BOOKID CHAPTER:VERSE" (the start verse only, matching the list
above). "irrelevant" lists ONLY the ones that don't belong — omit it or leave empty if all are
relevant. JSON only, no markdown.`
}

function dedupeKey(r: Pick<AiLookupResult, 'textId' | 'bookId' | 'chapter' | 'verse'>): string {
  return `${r.textId}|${r.bookId}|${r.chapter}|${r.verse}`
}

/** "Deep search" verification pass — shows the model the candidates already found (real,
 *  verified DB rows) and asks whether they actually answer the question; if not, it can
 *  suggest different search keywords AND/OR (for a pseudepigrapha focus text) a different
 *  chapter to focus on, for the next round of a bounded multi-round loop (see runLookup's
 *  agentic loop — up to 3 total attempts). Every keyword set already tried is listed so the
 *  model doesn't suggest the same one again. It never gets to introduce a reference directly
 *  here — only steer what gets searched/guessed next — so this can't reintroduce
 *  hallucination risk the way letting it just "answer again" would. */
function verificationPrompt(question: string, focusWorkName: string | null, candidates: AiLookupResult[], triedKeywordSets: string[][]): string {
  const list = candidates.slice(0, 8).map((c) => `${c.bookName} ${c.chapter}:${c.verse}${c.endVerse ? '-' + c.endVerse : ''} — ${c.text}`).join('\n')
  const chapterRule = focusWorkName
    ? `\n- "tryChapter": optional. If you think a DIFFERENT ${focusWorkName} chapter than what's
  shown above actually covers this (a chapter number you recall), include it — it'll be pulled
  in and checked for the next round.`
    : ''
  return `A user asked: "${question}"${focusWorkName ? ` (specifically about ${focusWorkName})` : ''}

Keyword sets already tried (don't repeat any of these): ${JSON.stringify(triedKeywordSets)}

Candidate verses found so far (real, verified text):
${list || '(none found)'}

Do these candidates actually answer the question? Respond with ONLY a JSON object:
{
  "satisfied": true|false,
  "refinedKeywords": ["short phrase", "..."]${focusWorkName ? ',\n  "tryChapter": 12' : ''}
}
Only include "refinedKeywords" (3-6 short literal phrases likely to appear verbatim in the
text, same rules as before — genuinely different from every set already tried above) if
"satisfied" is false and you have real, different terms worth trying.${chapterRule}
JSON only, no markdown.`
}

/** Final relevance pass for "deep search" — after the agentic loop settles, asks the model to
 *  flag any candidate in the FINAL set that isn't actually relevant (shares a word but not the
 *  topic, etc), so it can be dropped. Distinct from commentaryPrompt (which also writes
 *  explanatory prose) — this runs regardless of whether Commentary is on, since it's a
 *  relevance check, not commentary. */
function relevancePrunePrompt(question: string, candidates: AiLookupResult[]): string {
  const list = candidates.map((c) => `${c.bookId} ${c.chapter}:${c.verse}${c.endVerse ? '-' + c.endVerse : ''} — ${c.text}`).join('\n')
  return `A user asked: "${question}"

Candidate verses (real, verified text) about to be shown as the answer:
${list}

Flag any that are NOT actually relevant to the question (e.g. only share a generic word, not
the real topic). Respond with ONLY a JSON object:
{ "irrelevant": ["BOOKID CH:VS", "..."] }
Use exactly the "BOOKID CHAPTER:VERSE" form (start verse only) from the list above. Leave the
array empty if all candidates are genuinely relevant — don't flag something just to flag it.
JSON only, no markdown.`
}

/** Merges runs of contiguous verse numbers (same textId/bookId/chapter, same source) into a
 *  single ranged result — the model-independent path to showing verse ranges, since keyword
 *  search naturally returns individual verse rows even when three in a row all matched. */
function mergeAdjacent(items: AiLookupResult[]): AiLookupResult[] {
  const byGroup = new Map<string, AiLookupResult[]>()
  for (const item of items) {
    const key = `${item.textId}|${item.bookId}|${item.chapter}|${item.source}`
    if (!byGroup.has(key)) byGroup.set(key, [])
    byGroup.get(key)!.push(item)
  }
  const merged: AiLookupResult[] = []
  for (const group of byGroup.values()) {
    group.sort((a, b) => a.verse - b.verse)
    let run: AiLookupResult[] = []
    const flush = () => {
      if (run.length === 0) return
      if (run.length === 1) { merged.push(run[0]); run = []; return }
      merged.push({
        ...run[0],
        endVerse: run[run.length - 1].verse,
        text: run.map((r) => r.text).join(' '),
      })
      run = []
    }
    for (const item of group) {
      if (run.length === 0 || item.verse === run[run.length - 1].verse + 1) {
        run.push(item)
      } else {
        flush()
        run.push(item)
      }
    }
    flush()
  }
  return merged
}

/** Scores a candidate's literal overlap with the extracted keywords — but checks EVERY
 *  word-replacer AND archaic-vocabulary (see archaicVocab.ts, only applied when `textId` is
 *  passed) variant of each keyword, not just its literal text. Without this, a candidate that
 *  was only found via a variant (e.g. keyword "Yeshua" found the verse through its "Jesus"
 *  variant, since the underlying KJV text says "Jesus"; or keyword "idolatry" found a Jubilees
 *  verse through its "the house of the idols" archaic variant) would score zero here even
 *  though it's a real match — the exact wording that got it INTO the candidate pool
 *  (searchKeywords already runs every variant through FTS) isn't the same string this was
 *  re-checking against. That mismatch became a real bug once the always-on relevance threshold
 *  started dropping any zero-score keyword-sourced candidate: with word replacer on by default,
 *  most/all matches found through a variant were silently discarded here despite being
 *  genuinely relevant — the archaic-vocab table would hit the identical bug if not threaded
 *  through the same way.
 *
 *  Rarity-weighted (Round 10, `opportunistic = false`, the existing focus-text/canonical path —
 *  unchanged behavior otherwise): a keyword that only matched via a common/short variant scores
 *  1; a keyword whose BEST matching variant is both a substantial phrase (3+ words) AND
 *  genuinely RARE in that text (see phraseRarityCount) scores 2. A literal, uncommon multi-word
 *  phrase match is far less likely to be coincidental than a single generic word landing in
 *  several unrelated verses, so it should outweigh one, not tie with it — confirmed directly: a
 *  real 8-run test on a focused Jubilees question had two thematically-similar chapters (both
 *  containing a bare "idols" hit) tie every time with plain +1 scoring, decided only by
 *  arbitrary insertion order — the correct chapter lost more often than it won; this weighting
 *  landed correctly 8/8.
 *
 *  `opportunistic = true` (the new UNFOCUSED, all-texts-together path — see textPasses in
 *  runLookup): flat +1-per-keyword instead, and getArchaicVariants itself runs in `strict` mode
 *  (rare-phrase-only). Word-count-based scoring alone isn't safe once results from DIFFERENT
 *  texts compete directly against canonical: some archaic-vocab entries map a common word to a
 *  RECURRING epithet (e.g. "Yeshua" -> "the Son of Man" throughout Enoch, "the Beloved"
 *  throughout the Ascension of Isaiah) — rewarding phrase length let an unrelated passage using
 *  one of these outrank the real canonical answer to an unrelated control question ("where does
 *  Yeshua calm the storm"), confirmed directly. Gating variant ELIGIBILITY by rarity (in
 *  getArchaicVariants) rather than just discounting the score bonus is what actually fixes it —
 *  a common epithet is excluded from the search/candidate pool for that text entirely in this
 *  mode, not just scored lower. */
const _phraseRarityCache = new Map<string, number>()
function phraseRarityCount(words: string[], textId: string): number {
  if (words.length === 0) return 0
  const key = `${textId}|${words.join(' ').toLowerCase()}`
  const cached = _phraseRarityCache.get(key)
  if (cached !== undefined) return cached
  const db = getTextDb(textId)
  if (!db) return 0
  let count = 0
  try {
    const ftsQ = `"${words.join(' ').replace(/"/g, '""')}"`
    const row = db.prepare('SELECT COUNT(*) as c FROM verses_fts WHERE verses_fts MATCH ?').get(ftsQ) as { c: number } | undefined
    count = row?.c ?? 0
  } catch { /* malformed FTS query (rare punctuation) — treat as not-rare, no bonus */ count = 999 }
  _phraseRarityCache.set(key, count)
  return count
}

function keywordOverlapScore(text: string, keywords: string[], wordReplacerRules: WordReplacerRuleLite[] = [], textId?: string, opportunistic = false): number {
  const lower = text.toLowerCase()
  // Round 10: the focus-text generic-word denylist (OVERLY_GENERIC_IN_FOCUS_TEXT) is applied
  // HERE, per candidate, based on that candidate's own textId — not once globally before search
  // — since canonical and non-canonical texts are now searched together in the same pass and a
  // word like "Abraham" is a perfectly good discriminating keyword for an ORDINARY canonical
  // search while being nearly meaningless inside a Genesis-retelling pseudepigrapha text.
  //
  // Round 10.1: also applied to CANONICAL scoring when `opportunistic` — found via real
  // production testing that skipping it there let a bare "Abraham" match (present in dozens of
  // unrelated Genesis verses) tie with a genuinely specific non-canonical match, and since
  // canonical wins ties, it won automatically every time regardless of real relevance — the
  // same genericness problem the denylist already exists to solve, just also showing up on the
  // canonical side once canonical and non-canonical compete head-to-head instead of canonical
  // being the only thing ever searched. See filterGenericKeywords.
  const effectiveKeywords = (textId && !CANONICAL_TEXT_IDS.has(textId)) || opportunistic ? filterGenericKeywords(keywords, true) : keywords
  let score = 0
  for (const kw of effectiveKeywords) {
    const variants = [
      ...getWordReplacerVariants(kw, wordReplacerRules),
      ...(textId ? getArchaicVariants(kw, textId, opportunistic) : []),
    ]
    let bestBonus = false
    let anyHit = false
    for (const v of variants) {
      const words = cleanWords(v)
      if (words.length === 0 || !words.every((w) => lower.includes(w.toLowerCase()))) continue
      anyHit = true
      if (!opportunistic && textId && words.length >= 3 && phraseRarityCount(words, textId) <= 4) bestBonus = true
    }
    if (anyHit) score += bestBonus ? 2 : 1
  }
  return score
}

interface NotesSignal {
  notedKeys: Set<string> // dedupeKey() of candidates with an exact verse-note
}

/** Exact-verse-note signal only: if a candidate has a verse note at its own precise reference,
 *  that's a strong, structured "you've already flagged this as relevant" boost. (The former
 *  general-note-surfacing half of this — matching loose note text via notes_fts and showing a
 *  "From your notes" section — was removed as unhelpful per feedback; this exact-match boost is
 *  a different, still-useful signal and is unaffected.) */
function computeNotesSignal(candidates: AiLookupResult[]): NotesSignal {
  const result: NotesSignal = { notedKeys: new Set() }
  const canonical = candidates.filter((c) => CANONICAL_TEXT_IDS.has(c.textId))
  if (canonical.length === 0) return result
  try {
    const db = getBereanDb()
    const uniqRefs = [...new Set(canonical.map((c) => `${c.bookId}.${c.chapter}.${c.verse}`))]
    const placeholders = uniqRefs.map(() => '?').join(',')
    const rows = db.prepare(`SELECT DISTINCT verse_ref FROM notes WHERE verse_ref IN (${placeholders})`).all(...uniqRefs) as Array<{ verse_ref: string }>
    const notedRefs = new Set(rows.map((r) => r.verse_ref))
    for (const c of canonical) {
      if (notedRefs.has(`${c.bookId}.${c.chapter}.${c.verse}`)) result.notedKeys.add(dedupeKey(c))
    }
  } catch { /* notes table unavailable — signal just stays empty */ }
  return result
}

function noteRowToResult(row: { id: string; title: string | null; content: string; type: string; idiom_term: string | null }): AiLookupNoteResult {
  const rawSnippet = (row.content || '').replace(/^---[\s\S]*?---\n?/, '').replace(/[#*`_>~[\]]/g, '').replace(/\n/g, ' ').trim()
  return {
    id: row.id,
    title: row.title || 'Untitled note',
    snippet: rawSnippet.slice(0, 160),
    isIdiom: row.type === 'idiom',
    idiomTerm: row.idiom_term ?? undefined,
  }
}

/** Explicit note-ask ("what notes have I written about X") — notes ARE the answer, so this uses
 *  the same full-text notes_fts search electron/ipc/notes.ts's notes:search handler already
 *  uses (ported here rather than round-tripping through IPC to itself, since this file already
 *  runs in the main process and has direct DB access) — real recall matters more than precision
 *  when the user explicitly asked to search notes. */
function searchNotesExplicit(question: string, limit = 8): AiLookupNoteResult[] {
  try {
    const db = getBereanDb()
    const words = cleanWords(question).filter((w) => w.length >= 3 && !GENERIC_NOTE_SEARCH_WORDS.has(w.toLowerCase()))
    if (words.length === 0) return []
    const ftsQ = words.map((w) => `"${w.replace(/"/g, '')}"`).join(' OR ')
    const rows = db.prepare(`
      SELECT n.id, n.title, n.content, n.type, n.idiom_term FROM notes_fts f
      JOIN notes n ON n.rowid = f.rowid
      WHERE notes_fts MATCH ? AND n.deleted_at IS NULL
      ORDER BY n.updated_at DESC
      LIMIT ?
    `).all(ftsQ, limit) as Array<{ id: string; title: string | null; content: string; type: string; idiom_term: string | null }>
    return rows.map(noteRowToResult)
  } catch {
    return []
  }
}

// Words that would otherwise appear in nearly every "what notes have I written about X" style
// question itself (not the topic being searched for) — stripped before building the FTS query,
// same reasoning as filterGenericKeywords but for the question's own framing words, not the
// topic. Deliberately separate from OVERLY_GENERIC_SINGLE_WORDS (that set is about weak Bible-
// text search terms; this one is about the "notes have I written about" scaffolding).
const GENERIC_NOTE_SEARCH_WORDS = new Set([
  'what', 'have', 'has', 'notes', 'note', 'written', 'wrote', 'about', 'did', 'any', 'anything',
  'show', 'find', 'search', 'for', 'the', 'a', 'an', 'my', 'ive', 'you',
])

/** Implicit augmentation for topical/meaning questions ("what does a fox mean in scripture")
 *  — deliberately much stricter than searchNotesExplicit, per the earlier "From your notes"
 *  removal (Round 4): only a genuine TITLE or idiom-term match counts, never loose full-content
 *  text matching, so this can't repeat that complaint. Checked against the same keywords already
 *  extracted for verse search, not re-derived. */
function searchNotesImplicit(keywords: string[], limit = 3): AiLookupNoteResult[] {
  if (keywords.length === 0) return []
  try {
    const db = getBereanDb()
    const rows = db.prepare(`SELECT id, title, content, type, idiom_term FROM notes WHERE deleted_at IS NULL AND (idiom_term IS NOT NULL OR title != '')`)
      .all() as Array<{ id: string; title: string | null; content: string; type: string; idiom_term: string | null }>
    const out: AiLookupNoteResult[] = []
    for (const row of rows) {
      const title = (row.title || '').toLowerCase()
      const idiomTerm = (row.idiom_term || '').toLowerCase()
      const hit = keywords.some((kw) => {
        const words = cleanWords(kw)
        if (words.length === 0) return false
        return words.every((w) => title.includes(w.toLowerCase())) || (idiomTerm && words.every((w) => idiomTerm.includes(w.toLowerCase())))
      })
      if (hit) out.push(noteRowToResult(row))
      if (out.length >= limit) break
    }
    return out
  } catch {
    return []
  }
}

/** Ranks candidates by keyword overlap (+ a notes boost, when available) — shared by the
 *  primary-result ranking (§5) and the agentic verification preview (§2b), which runs before
 *  the notes signal exists yet, hence the optional param.
 *
 *  Relevance threshold ("don't show results just for the sake of showing results"): a
 *  keyword-SOURCED candidate that scores zero real overlap gets dropped entirely rather than
 *  padded into the list to hit a fixed count — always on, both modes. Guesses/Strong's-sourced
 *  results are exempt: a verified guess is already a targeted, direct answer even when its
 *  wording doesn't literally echo the extracted keywords (the whole reason guesses exist
 *  alongside keyword search), and a Strong's occurrence is relevant by construction (an exact
 *  tag match, not a guess at all). */
/** Deterministic accuracy lever ("Lever A"): a KEYWORD-search hit landing in the SAME chapter
 *  the extraction call already guessed for the focus text is corroborating evidence — the two
 *  independent signals (the model's own recall, and literal text matching) agreeing on a
 *  chapter is a much stronger signal than either alone, especially valuable for pseudepigrapha
 *  where guess accuracy alone is known to be unreliable (~30-50%, prior testing) but a guess
 *  that DOES land the right neighborhood still narrows things down usefully. Not narrowing the
 *  search itself (a wrong guess would then wrongly exclude the right chapter) — just a ranking
 *  boost, so a correct keyword hit outside the guessed chapter can still win on its own merits.
 *  Deliberately restricted to `source === 'keyword'` — a guess candidate's own chapter always
 *  trivially satisfies "matches a guessed chapter" (it IS the guess), so applying this to
 *  guesses too would let a WRONG guess self-reinforce on nothing but matching itself, which is
 *  the opposite of "independent corroboration" and was confirmed, empirically, to make things
 *  worse: a bad guess (e.g. chapter 19) getting a free +1 for agreeing with its own chapter
 *  number let it edge out a correct chapter-12 keyword hit that had NO such freebie.
 *
 *  Round 10 fix: a guess's chapter only ever gets INTO this hint set once the guess itself has
 *  been verified to have real keyword overlap (see the guess-processing loop in runLookup) — an
 *  ungrounded/hallucinated guess no longer gets to lend its chapter's authority to an unrelated
 *  keyword hit elsewhere in that chapter. Directly reproduced and fixed this exact failure: a
 *  hallucinated Jubilees guess (chapter 20, its own text having zero overlap with the extracted
 *  keywords) was letting a coincidental "idols" hit elsewhere in chapter 20 outscore the correct,
 *  verbatim-matching hit in chapter 12 — an 8-run faithful mirror of the pipeline reproduced this
 *  8/8 before the fix, 0/8 after.
 *
 *  Round 10 also generalizes this from a single focus-text to a per-textId map — an unfocused
 *  question now searches canonical and every non-canonical text at once (see textPasses in
 *  runLookup), so a guess's corroboration needs to apply to its OWN text specifically, not just
 *  "the" focus text. */
interface ChapterHint { chaptersByText: Map<string, Set<number>> }

/** True if `a` should be preferred over `b` on an exact score tie — canonical texts win ties
 *  only, never a strictly higher-scoring non-canonical candidate (see Decisions: "canonical
 *  ranked higher if it genuinely is better... because this is typically what's meant"). Used
 *  only for the unfocused, all-texts-searched-together branch of result assembly. */
function canonicalTieRank(c: AiLookupResult): number {
  return CANONICAL_TEXT_IDS.has(c.textId) ? 1 : 0
}

// `preferCanonicalTies` doubles as the "opportunistic" signal into keywordOverlapScore/
// getArchaicVariants — both are true in exactly the same case (the new unfocused,
// all-texts-together branch) and false together everywhere else, so one flag covers both rather
// than threading two parameters with identical values through every call site.
//
// `canonicalMinKeywordScore` (Round 10.1, optional — only set for the unfocused branch): a
// SEPARATE, stricter relevance floor for canonical keyword-sourced candidates specifically,
// applied instead of `minKeywordScore` when set. Found via real production testing that a flat,
// symmetric floor doesn't actually treat the two sides fairly: the 66-book canon is a MUCH
// larger corpus than any single non-canonical text, so a bare single-keyword match has a
// proportionally much higher chance of landing on something real but topically unrelated purely
// by corpus size (confirmed directly: "idolatry" alone — a real, literal KJV word, just one
// Paul happens to use in unrelated epistles — beat Jubilees' single genuine, on-topic match on
// a tie, for a question about Abraham that had nothing to do with 1 Corinthians). Requiring
// canonical to clear a higher bar (2, i.e. real corroboration) before it's even ELIGIBLE to win
// a contested tie, while a smaller non-canonical text can still win on one genuine signal,
// directly addresses that asymmetry — general to every non-canonical text, not tuned to any one
// of them, and doesn't touch the focused-text or canonical-only paths at all.
// Round 10.1: an earlier version of this function gave a guess a scoring BONUS once it cleared
// an evidence bar, to try to keep guesses competitive against literal keyword coincidences
// without unconditionally trusting an ungrounded one. That approach was abandoned — a flat bonus
// can still be numerically outscored by a text that happens to mention several extracted
// keywords in passing while discussing something else entirely (confirmed: Epistle of Barnabas
// referencing "Ten Commandments"/"Moses"/"Mount Sinai" together inside an unrelated Sabbath
// argument outscored a flat bonus, beating the real Exodus 20 guess). The real fix lives one
// level up, in the unfocused branch of runLookup: a guess that clears the evidence bar (see
// guessHasEvidence there) leads STRUCTURALLY, ahead of the whole scored pool, not via a bonus
// inside this scoring function at all — so this function stays a plain, uniform scorer.
function scoreCandidates(items: AiLookupResult[], keywords: string[], notesSignal?: NotesSignal, wordReplacerRules: WordReplacerRuleLite[] = [], chapterHint?: ChapterHint, minKeywordScore = 1, preferCanonicalTies = false, canonicalMinKeywordScore?: number): AiLookupResult[] {
  return items
    .map((c, i) => ({
      c, i,
      score: keywordOverlapScore(c.text, keywords, wordReplacerRules, c.textId, preferCanonicalTies)
        + (notesSignal?.notedKeys.has(dedupeKey(c)) ? 2 : 0)
        + (c.source === 'keyword' && chapterHint?.chaptersByText.get(c.textId)?.has(c.chapter) ? 1 : 0),
    }))
    .filter((s) => {
      if (s.c.source !== 'keyword') return true
      const threshold = canonicalMinKeywordScore !== undefined && CANONICAL_TEXT_IDS.has(s.c.textId) ? canonicalMinKeywordScore : minKeywordScore
      return s.score >= threshold
    })
    .sort((a, b) => b.score - a.score || (preferCanonicalTies ? canonicalTieRank(b.c) - canonicalTieRank(a.c) : 0) || a.i - b.i)
    .map((s) => s.c)
}

interface Emit { (status: string): void }

// Loading-status phrasing — a small pool of tasteful, lightly varied alternates per stage
// (picked at random each call) instead of one identical sentence every time, while still
// literally describing what's actually happening at that moment, never generic filler.
function pick(arr: string[]): string { return arr[Math.floor(Math.random() * arr.length)] }
const READING_MESSAGES = ['Reading your question…', 'Looking at what you asked…', 'Taking a look…']
const searchingMessages = (target: string) => [`Searching ${target}…`, `Looking through ${target}…`, `Combing through ${target}…`]
const VERIFY_MESSAGES = ['Checking these results…', 'Making sure this is on target…', 'Double-checking the results…']
const REFINE_MESSAGES = ['Trying a different search…', 'Taking another pass…', 'Refining the search terms…']
const PRUNE_MESSAGES = ['Double-checking relevance…', 'Trimming anything that doesn’t fit…', 'One more check…']
const RANK_MESSAGES = ['Sorting the results…', 'Putting these in order…', 'Ranking the results…']
const COMMENTARY_MESSAGES = ['Writing brief notes…', 'Adding a little context…', 'Jotting down commentary…']

/** Finds every bare Strong's-number token (H430, G26, case-insensitive, optional space/leading
 *  zeros) anywhere in free text — same normalization as src/lib/strongsSearch.ts's
 *  parseStrongsQuery, adapted to scan a whole sentence instead of requiring the entire input to
 *  be just the number (ported rather than imported — same cross-process reasoning as
 *  normalizeBookName/getWordReplacerVariants above). */
function detectStrongsNumbers(text: string): string[] {
  const re = /\b([HG])\s?0*(\d{1,5})\b/gi
  const found = new Set<string>()
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    found.add(`${m[1].toUpperCase()}${m[2]}`)
  }
  return [...found]
}

interface StrongsSeedResult {
  candidates: AiLookupResult[]
  card?: AiLookupStrongsCard
}

// A definition-only Strong's question ("what is the greek strongs for grace") shouldn't dump a
// pile of occurrence verses underneath the word card by default — per direct feedback, that's
// noise unless actually asked for. Occurrences only fetch when the question itself asks for
// them: "where"/"which verses"/"occurs"/"appears"/"used in"/"found in".
const STRONGS_OCCURRENCES_REQUESTED_RE = /\b(where|which\s+verses?|occurs?|occurrence|appears?|used\s+in|found\s+in|every\s+place)\b/i

/** Resolves a list of Strong's numbers (explicit ones detected in the question, plus any the
 *  model itself proposed) into a verified word card (always) and real occurrences (only when
 *  the question actually asked for them — see STRONGS_OCCURRENCES_REQUESTED_RE) — every number
 *  is checked against the real lexicon DB first (getLexiconEntry), so a hallucinated/invalid one
 *  is silently dropped exactly like an unresolvable book/chapter guess is elsewhere in this
 *  file. Verse occurrences come from getLexiconOccurrences, which scans the tagged text directly
 *  (an exact tag match, not a model guess) — the most trustworthy source this pipeline has. */
function resolveStrongsNumbers(nums: string[], seen: Set<string>, bookNameForFn: (bookId: string, textId: string) => string, includeOccurrences: boolean): StrongsSeedResult {
  const candidates: AiLookupResult[] = []
  let card: AiLookupStrongsCard | undefined
  for (const num of nums.slice(0, 2)) {
    const entry = getLexiconEntry(num)
    if (!entry) continue
    if (!card) {
      card = {
        strongsNum: entry.strongsNum, lemma: entry.lemma, transliteration: entry.transliteration,
        gloss: entry.gloss, definition: entry.definition, derivation: entry.derivation,
        occurrenceCount: entry.occurrences,
      }
    }
    if (!includeOccurrences) continue
    for (const occ of getLexiconOccurrences(num).slice(0, 6)) {
      const key = `${occ.text_id}|${occ.book_id}|${occ.chapter}|${occ.verse_num}`
      if (seen.has(key)) continue
      seen.add(key)
      candidates.push({
        textId: occ.text_id, bookId: occ.book_id, bookName: bookNameForFn(occ.book_id, occ.text_id),
        chapter: occ.chapter, verse: occ.verse_num, text: occ.text, source: 'strongs',
      })
    }
  }
  return { candidates, card }
}

// ── "What does verse X quote" — a deterministic, LLM-free question type ────────────────────
//
// Detection is local and pre-LLM: a trigger-phrase regex plus a literal, resolvable reference
// found in the question text. `parseRef` (src/lib/parseRef.ts) is anchored — it expects its
// ENTIRE input to be just a reference, not one embedded partway through a sentence like "what
// does john 1:1 quote?" — so this scans the question for a reference-shaped substring first,
// then hands JUST that substring to parseRef. Only `isExactBookToken` matches are accepted
// (never parseRef's own fuzzy/prefix tiers) — this is a high-stakes short-circuit that skips
// the entire normal guess/keyword pipeline, so a loose book-name match on an unrelated word in
// the sentence (e.g. "to" prefix-matching "Tobit") would be a real, silent wrong-turn risk that
// isn't worth the small recall gain fuzzy matching would otherwise buy here.
const QUOTE_TRIGGER = /\b(quote|quoting|quotes|quoted|reference|referenc\w*|allud\w*|cit\w*|sourced?\s+from|echo(?:e[sd])?|where\s+(?:is|does).{0,20}(?:from|quoted))\b/i

// Direction matters: "what does John 1:1 quote" (X is the SOURCE, outgoing — existing) is the
// opposite question from "what verses quote Psalm 2" / "where is Psalm 2:7 quoted" (X is the
// TARGET, incoming — new this round). Checked FIRST, before QUOTE_TRIGGER, since these phrasings
// ("what/which/who quote(s)...", passive "is ... quoted") are specific enough to classify
// direction reliably; QUOTE_TRIGGER alone can't tell them apart (both contain "quote"/"quoted").
// Falls back to forward (existing behavior) when this doesn't match but QUOTE_TRIGGER still does.
const REVERSE_QUOTE_TRIGGER = /\b(?:what|which|who)\s+(?:verses?|scriptures?|passages?)?\s*(?:quotes?|references?|cites?|alludes?\s+to)\b|\bis\s+.{0,40}\bquoted\b|\bwhere\s+is\s+.{0,40}\bquoted\b|\bquoted\s+(?:in|by|elsewhere|anywhere)\b|\breferenced\s+(?:in|by)\b/i

// "What notes have I written about X" / "my notes about X" / "did I write anything about X" —
// an explicit ask to search NOTES, not verses. Local, pre-LLM, same zero-latency pattern as the
// quote/Strong's classifiers above. Deliberately requires "notes"/"note" OR a first-person
// writing verb ("I written"/"I write"/"I wrote"/"did I write") — a bare "what about X" shouldn't
// misfire into notes-only mode.
const NOTE_ASK_TRIGGER = /\b(?:my\s+notes?|notes?\s+(?:have|has)\s+i|written\s+(?:about|on)|did\s+i\s+write|have\s+i\s+written|what\s+notes?|show\s+me\s+my\s+notes?|find\s+my\s+notes?|search\s+my\s+notes?)\b/i

// A question naming a well-known discourse ("Yeshua's longest prayer") but whose guess only
// came back as a bare verse 1 (no endVerse — the model gave a starting-point citation, not a
// wrong-length range) is a real, observed failure mode — see the whole-passage extraction-prompt
// rule above, and this regex as its safety net for whenever the prompt rule alone doesn't stick.
const WHOLE_PASSAGE_QUESTION_RE = /\b(prayer|sermon|parable|discourse|speech|whole\s+chapter)\b/i

// Matches a bare "1:1" / "1.1" / "1:1-5" / "1" chapter[:verse[-endVerse]] token, with an
// optional trailing punctuation mark (question mark, comma, etc) stripped.
const CHAPTER_VERSE_TOKEN_RE = /^(\d{1,3})(?:[:.](\d{1,3})(?:[-–](\d{1,3}))?)?[.,!?;:]?$/

/** Scans a free-text question word-by-word for a "Book Chapter[:Verse]"-shaped reference —
 *  `parseRef` (src/lib/parseRef.ts) itself is anchored (expects its ENTIRE input to be just a
 *  reference, not one embedded partway through a sentence), so this finds the candidate
 *  substring first. A single greedy regex over the whole sentence was tried and rejected here:
 *  its lazy book-token group still swallows every preceding word up to the first digit (e.g.
 *  "what does john 1:1" resolves the "book" as "what does john", which fails
 *  `isExactBookToken` and — since regex.exec only advances to the next unmatched position, not
 *  back to try a shorter book-token window at the SAME position — never gets a chance to try
 *  "john" alone). Concretely confirmed: that approach let "what does john 1:1 quote" fall
 *  through to the normal LLM pipeline undetected, which then let John 1:1 itself leak into the
 *  output — exactly the case this feature exists to prevent. Word-tokenizing and trying the
 *  1-3 words immediately before each chapter:verse-shaped token (shortest window first, since
 *  most book names are 1-2 words) avoids that failure mode entirely. */
function findReferenceInText(question: string): ParsedRef | null {
  const tokens = question.split(/\s+/)
  for (let i = 0; i < tokens.length; i++) {
    const numMatch = tokens[i].match(CHAPTER_VERSE_TOKEN_RE)
    if (!numMatch) continue
    for (const windowLen of [1, 2, 3]) {
      const start = i - windowLen
      if (start < 0) break
      const bookToken = tokens.slice(start, i).join(' ').replace(/[^\w\s]/g, '').trim()
      const candidates = [bookToken]
      // Also try prepending one more leading numeral/roman-numeral token (e.g. "1 John",
      // "II Kings") — the digit sits one token further back than the immediate window, since
      // "1"/"john" are two separate tokens. Tried FIRST (unshift, not push): "1 john" must win
      // over the bare "john" it contains, or "what does 1 john 1:1 mean" would silently resolve
      // to John instead of 1 John — a real book is a real book, this can't be left ambiguous.
      if (start > 0) {
        const lead = tokens[start - 1].replace(/[^\w]/g, '')
        if (/^(?:[1-3]|I{1,3})$/i.test(lead)) candidates.unshift(`${lead} ${bookToken}`)
      }
      for (const cand of candidates) {
        if (!cand || !isExactBookToken(cand)) continue
        const candidateRef = `${cand} ${numMatch[1]}${numMatch[2] ? `:${numMatch[2]}${numMatch[3] ? `-${numMatch[3]}` : ''}` : ''}`
        const parsed = parseRef(candidateRef)
        if (parsed) return parsed
      }
    }
  }
  return null
}

/** Handles "what does John 1:1 quote/reference/allude to" style questions entirely
 *  deterministically — no Ollama call at all. The seed verse is resolved+verified locally
 *  (queryVerse), then its real cross_references.db/tske_refs.db links (already exported,
 *  electron/ipc/crossrefs.ts) are pulled DIRECTLY — the one genuinely new call pattern here,
 *  since elsewhere in this file those two functions only ever run over the FINAL ranked primary
 *  result set (step 6 below), never against a literal user-named verse up front. Because
 *  `results` here is built ONLY from the cross-ref/TSKE query output, the seed verse can never
 *  appear in it by construction — not a filter bolted on after, structurally impossible — plus
 *  one defensive filter in case TSKE ever returns a self-referential/reciprocal row. */
/** Pulls real cross-ref/TSKE hits for ONE verse, in the given direction — `forward` = what this
 *  verse quotes/references (outgoing, `getCrossRefsForVerse`/`getTskeForVerse`), `reverse` =
 *  what quotes/references this verse (incoming, `getIncomingCrossRefsForVerse`/
 *  `getIncomingTskeForVerse`). Same TSKE-first-then-classic-backfill logic either direction. */
function quoteRefsForVerse(bookId: string, chapter: number, verse: number, direction: 'forward' | 'reverse', seen: Set<string>): AiLookupResult[] {
  const isSeed = (r: { bookId: string; chapter: number; verse: number }) =>
    r.bookId === bookId && r.chapter === chapter && r.verse === verse
  const out: AiLookupResult[] = []
  const tske = direction === 'forward' ? getTskeForVerse(bookId, chapter, verse) : getIncomingTskeForVerse(bookId, chapter, verse)
  for (const group of tske.groups) {
    if (group.isReciprocal) continue
    for (const ref of group.refs) {
      if (out.length >= MAX_CROSS_REFS) break
      if (!ref.text || isSeed(ref)) continue
      const key = `${DEFAULT_TEXT_ID}|${ref.bookId}|${ref.chapter}|${ref.verse}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push({
        textId: DEFAULT_TEXT_ID, bookId: ref.bookId, bookName: bookNameFor(ref.bookId, DEFAULT_TEXT_ID),
        chapter: ref.chapter, verse: ref.verse, endVerse: ref.endVerse ?? undefined, text: ref.text,
        source: 'quote-source',
      })
    }
  }
  if (out.length < MAX_CROSS_REFS) {
    const classic = direction === 'forward' ? getCrossRefsForVerse(bookId, chapter, verse) : getIncomingCrossRefsForVerse(bookId, chapter, verse)
    for (const ref of classic.refs) {
      if (out.length >= MAX_CROSS_REFS) break
      if (!ref.text || isSeed(ref)) continue
      const key = `${DEFAULT_TEXT_ID}|${ref.bookId}|${ref.chapter}|${ref.verse}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push({
        textId: DEFAULT_TEXT_ID, bookId: ref.bookId, bookName: bookNameFor(ref.bookId, DEFAULT_TEXT_ID),
        chapter: ref.chapter, verse: ref.verse, endVerse: ref.endVerse ?? undefined, text: ref.text,
        source: 'quote-source',
      })
    }
  }
  return out
}

/** Optionally narrates a deterministic quote-lookup answer with the existing commentaryPrompt/
 *  runOllamaJson call — ONLY when Commentary is on (Michael's own existing signal for "I want
 *  AI involved here," per this round's decision, rather than a new toggle). Off by default:
 *  the fixed template `summary` already set on `response` is what shows, no added latency, no
 *  hallucination surface. On: reuses the SAME prompt/call the main pipeline already uses for
 *  its own commentary pass — narrates the primary (non-nested) quote-source verses, replacing
 *  the fixed summary with a real one; per-verse commentary lines and relevance pruning apply
 *  the same way they already do for ordinary guess/keyword results. Best-effort — a failed call
 *  just leaves the deterministic response untouched. */
async function maybeAddCommentary(response: AiLookupResponse, question: string, opts: { commentary: boolean; model?: string }): Promise<AiLookupResponse> {
  if (!opts.commentary) return response
  const primary = response.results.filter((r) => r.source !== 'cross-ref')
  if (primary.length === 0) return response
  try {
    const model = opts.model || DEFAULT_OLLAMA_MODEL
    const raw = await runOllamaJson<{ perVerse?: Record<string, string>; irrelevant?: string[]; summary?: string }>(
      commentaryPrompt(question, primary), model
    )
    for (const r of primary) {
      const key = `${r.bookId} ${r.chapter}:${r.verse}`
      if (raw.perVerse?.[key]) r.commentary = raw.perVerse[key]
    }
    return { ...response, summary: raw.summary ?? response.summary }
  } catch {
    return response
  }
}

/** Handles both "what does John 1:1 quote" (forward) and "what verses quote Psalm 2:7" /
 *  "what verses quote Psalm 2" (reverse, single-verse or whole-chapter) entirely
 *  deterministically — no Ollama call at all. Chapter-scope (no verse in the parsed reference)
 *  builds a PER-VERSE grouped answer: each verse of the chapter that has at least one real hit
 *  becomes its own primary `quote-source` result (the verse itself), with its citing/cited
 *  verses nested under it via the EXISTING `crossRefOf` mechanism `AiLookupPanel.tsx` already
 *  renders as a collapsible "N related" group for ordinary cross-refs — reused here rather than
 *  building new grouping UI. Verses with zero hits are omitted, not padded in. */
function runQuoteLookup(seed: ParsedRef, direction: 'forward' | 'reverse', emit: Emit): AiLookupResponse | null {
  const bookId = seed.bookId
  const chapter = seed.chapter
  const seen = new Set<string>()

  if (seed.verse == null) {
    // Whole-chapter scope — only meaningful (and only reachable) for a bare "Book Chapter"
    // reference with no verse; the caller (runLookup) only takes this path when the trigger is
    // reverse, since "what does a whole chapter quote" isn't a natural question shape, but the
    // grouping logic itself is direction-agnostic so both are supported here regardless.
    const db = getTextDb(DEFAULT_TEXT_ID)
    const maxRow = db?.prepare('SELECT MAX(verse_num) as m FROM verses WHERE book_id = ? AND chapter = ?').get(bookId, chapter) as { m: number | null } | undefined
    const maxVerse = maxRow?.m
    if (!maxVerse) return null
    emit(`Checking every verse of ${bookNameFor(bookId, DEFAULT_TEXT_ID)} ${chapter} for ${direction === 'reverse' ? 'incoming' : 'outgoing'} quotations…`)

    const results: AiLookupResult[] = []
    let hitVerseCount = 0
    for (let v = 1; v <= maxVerse; v++) {
      const hits = quoteRefsForVerse(bookId, chapter, v, direction, seen)
      if (hits.length === 0) continue
      const seedVerse = queryVerse(bookId, chapter, v, DEFAULT_TEXT_ID)
      if (!seedVerse) continue
      hitVerseCount++
      results.push({
        textId: DEFAULT_TEXT_ID, bookId, bookName: bookNameFor(bookId, DEFAULT_TEXT_ID),
        chapter, verse: v, text: seedVerse.text, source: 'quote-source',
      })
      // Nested citing/cited verses get `source: 'cross-ref'` (not 'quote-source') — that's the
      // exact flag AiLookupPanel.tsx's existing render loop already uses to exclude an item from
      // the primary list and instead group it under its `crossRefOf` parent as a collapsible
      // "N related" list, which is the reuse this whole design is built around.
      for (const hit of hits) results.push({ ...hit, source: 'cross-ref', crossRefOf: { bookId, chapter, verse: v } })
    }
    return {
      results,
      visibleCount: results.filter((r) => !r.crossRefOf).length,
      keywords: [],
      related: [],
      summary: hitVerseCount > 0
        ? `Real ${direction === 'reverse' ? 'incoming quotations of' : 'outgoing quotations from'} ${bookNameFor(bookId, DEFAULT_TEXT_ID)} ${chapter} — ${hitVerseCount} verse${hitVerseCount === 1 ? '' : 's'} with a match, ranked by vote/quotation signal, not an AI guess.`
        : `No recorded ${direction === 'reverse' ? 'incoming' : 'outgoing'} cross-references found for any verse in ${bookNameFor(bookId, DEFAULT_TEXT_ID)} ${chapter}.`,
    }
  }

  const verse = seed.verse
  const seedVerse = queryVerse(bookId, chapter, verse, DEFAULT_TEXT_ID)
  if (!seedVerse) return null // not a real verse — fall through to the normal pipeline

  emit(`Looking up what ${direction === 'reverse' ? 'quotes' : bookNameFor(bookId, DEFAULT_TEXT_ID) + ' ' + chapter + ':' + verse + ' quotes'}…`)
  const filtered = quoteRefsForVerse(bookId, chapter, verse, direction, seen)

  // `summary` (not `relatedNote` — that field only renders alongside a non-empty `related`
  // array in the UI, and this branch never populates `related`) renders unconditionally as a
  // small italic line above the results, so it's the right field to explain that this answer
  // came from real cross-reference data, not an AI guess.
  return {
    results: filtered,
    visibleCount: filtered.length,
    keywords: [],
    related: [],
    summary: filtered.length > 0
      ? `Real ${direction === 'reverse' ? 'quotations of' : 'cross-references for'} ${bookNameFor(bookId, DEFAULT_TEXT_ID)} ${chapter}:${verse}, ranked by vote/quotation signal — not an AI guess.`
      : `${bookNameFor(bookId, DEFAULT_TEXT_ID)} ${chapter}:${verse} has no recorded ${direction === 'reverse' ? 'incoming quotations' : 'cross-references'} in this app's data.`,
  }
}

// Exported alongside the other reuse-oriented exports at the bottom of this file — lets a
// headless test harness (or a future in-app entry point) call the real pipeline directly
// without going through IPC.
export async function runLookup(
  question: string,
  opts: { commentary: boolean; agentic?: boolean; model?: string; textId?: string; wordReplacerRules?: WordReplacerRuleLite[]; history?: ChatHistoryTurn[] },
  emit: Emit = () => {},
): Promise<AiLookupResponse> {
  const model = opts.model || DEFAULT_OLLAMA_MODEL
  const wordReplacerRules = opts.wordReplacerRules ?? []
  // Last few turns only — enough for a natural follow-up to resolve against without letting
  // prompt size grow unbounded over a long chat.
  const history = (opts.history ?? []).slice(-4)
  const empty = (error?: string): AiLookupResponse => ({ results: [], visibleCount: 0, keywords: [], related: [], error })

  // Text-focused search: a question naming a specific work (e.g. "in Jubilees...") searches
  // that text FIRST, then falls back to also searching the default (kjva). Computed before the
  // extraction call since the prompt itself needs to know (to invite a focus-text guess).
  const explicitFocus = opts.textId && opts.textId !== DEFAULT_TEXT_ID ? opts.textId : null
  const focusTextId = explicitFocus ?? detectFocusTextId(question)
  const focusWorkName = focusTextId ? singleBookWorkName(focusTextId) : null

  // "What notes have I written about X" — notes ARE the answer, no verse search at all. Checked
  // first (before quote-lookup and the extraction call) since it's the most specific/unambiguous
  // trigger — entirely deterministic, no Ollama call.
  if (NOTE_ASK_TRIGGER.test(question)) {
    emit('Searching your notes…')
    const notes = searchNotesExplicit(question)
    return {
      results: [], visibleCount: 0, keywords: [], related: [], notes, notesAreThePrimaryAnswer: true,
      summary: notes.length > 0
        ? `${notes.length} note${notes.length === 1 ? '' : 's'} found — searched your notes, not Scripture text.`
        : `No matching notes found.`,
    }
  }

  // "What does verse X quote/reference/allude to" — detected locally (trigger phrase + a
  // literal, resolvable reference), entirely deterministic, no Ollama call at all if it fires.
  // Checked before the extraction call so a well-formed quotation question short-circuits the
  // rest of the pipeline outright rather than wastefully running an extraction call whose
  // result would just get thrown away.
  if (QUOTE_TRIGGER.test(question)) {
    const seedRef = findReferenceInText(question)
    if (seedRef) {
      const direction = REVERSE_QUOTE_TRIGGER.test(question) ? 'reverse' : 'forward'
      const quoteResponse = runQuoteLookup(seedRef, direction, emit)
      if (quoteResponse) return await maybeAddCommentary(quoteResponse, question, opts)
      // seedRef parsed but didn't resolve to a real verse (out-of-range chapter etc) — fall
      // through to the normal pipeline rather than dead-ending on a bad parse.
    }
  }

  emit(pick(READING_MESSAGES))
  const { available } = await checkOllamaAvailable()
  if (!available) return empty('ollama-unavailable')

  let extraction: AiExtraction
  try {
    extraction = await runOllamaJson<AiExtraction>(extractionPrompt(question, focusWorkName, history), model)
  } catch {
    return empty('ollama-request-failed')
  }
  // The focus-text-only generic-word denylist is no longer applied here — canonical and
  // non-canonical texts are searched together now (see textPasses below), and a word like
  // "Abraham" is a perfectly good keyword for canonical scoring while being near-meaningless
  // inside a pseudepigrapha text. That distinction is applied PER CANDIDATE, based on its own
  // textId, inside keywordOverlapScore/searchKeywords instead — see filterGenericKeywords.
  let keywords = filterGenericKeywords((extraction.keywords ?? []).slice(0, 6), false)
  const guesses = (extraction.guesses ?? []).slice(0, 5)

  const seen = new Set<string>()
  const guessCandidates: AiLookupResult[] = []
  let keywordCandidates: AiLookupResult[] = []

  // Strong's numbers — explicit ones typed in the question (e.g. "H430") resolve regardless of
  // anything else; a model-proposed one (from a "what's the word for X" style question) is
  // included too, but only after being verified against the real lexicon DB just like every
  // other AI-proposed reference in this pipeline.
  const strongsNums = [...detectStrongsNumbers(question), ...(extraction.strongsNum ? [extraction.strongsNum.trim().toUpperCase()] : [])]
  const strongsSeed = strongsNums.length > 0
    ? resolveStrongsNumbers(strongsNums, seen, bookNameFor, STRONGS_OCCURRENCES_REQUESTED_RE.test(question))
    : { candidates: [], card: undefined }

  function add(bucket: AiLookupResult[], textId: string, row: { book_id: string; chapter: number; verse_num: number; verse_end?: number; text: string }, source: ResultSource) {
    const r: AiLookupResult = {
      textId, bookId: row.book_id, bookName: bookNameFor(row.book_id, textId),
      chapter: row.chapter, verse: row.verse_num, endVerse: row.verse_end, text: row.text, source,
    }
    const key = dedupeKey(r)
    if (seen.has(key)) return
    bucket.push(r)
    seen.add(key)
  }

  // Round 10: an UNFOCUSED question (no specific work named) now searches canonical AND all 16
  // non-canonical texts together, not canonical alone — see Decisions: "canonical and
  // noncanonical should be searched together at the same time". A FOCUSED question is unchanged:
  // that one named work plus canonical, same as before.
  const textPasses = focusTextId && focusTextId !== DEFAULT_TEXT_ID
    ? [focusTextId, DEFAULT_TEXT_ID]
    : [DEFAULT_TEXT_ID, ...ALL_PSEUDEPIGRAPHA_TEXT_IDS]

  // 1. AI direct guesses — a small, fixed budget that can never be starved out by the much
  // larger keyword pool. Allowed against every text in textPasses (Jubilees/Enoch/etc each have
  // a single-book `books` table with ordinary chapter:verse numbering, so a guess resolves the
  // same way a canonical guess does) — resolveBookId naturally only resolves a guess against the
  // text whose own book map actually contains that name, so a "Genesis" guess never matches
  // jubilees.db and vice versa, and a "Jubilees" guess never matches kjva.db.
  // Chapters a guess named, per text — corroborating evidence for step 5's ranking (see the
  // ChapterHint/"Lever A" comment above scoreCandidates). Only populated once a guess is
  // verified to have real keyword overlap with its OWN text (see below) — an ungrounded guess
  // must not get to lend its chapter's authority to an unrelated keyword hit elsewhere in it.
  const guessChaptersByText = new Map<string, Set<number>>()
  for (const textId of textPasses) {
    const db = getTextDb(textId)
    if (!db) continue
    for (const g of guesses) {
      if (guessCandidates.length >= 8) break
      // `chapter` is typed as required, but the model doesn't always comply at runtime (a
      // malformed/incomplete guess object) — found via this round's battery testing: an
      // Enoch guess missing `chapter` reached a DB query as a literal `undefined` bind
      // parameter and crashed the ENTIRE request (better-sqlite3 throws on that, same failure
      // mode `verse` already had a guard for below — `chapter` never did). Skip the guess
      // instead of letting one malformed guess take down the whole response.
      if (typeof g.chapter !== 'number' || !Number.isFinite(g.chapter)) continue
      const bookId = resolveBookId(g.book, textId)
      if (!bookId) continue
      // `verse` comes back missing surprisingly often (a whole-chapter reference like "John
      // 17", or a range given as just chapter+endVerse) — default it to 1 rather than letting
      // `undefined` reach the DB query (better-sqlite3 throws on an undefined bind parameter,
      // which would otherwise crash every guess in the same response, not just this one).
      const startVerse = g.verse ?? 1
      let endVerse = g.endVerse && g.endVerse > startVerse ? g.endVerse : undefined
      // Whole-chapter guess with no endVerse either — look up the chapter's real last verse
      // instead of guessing an arbitrary span. Capped tighter (10, not 20) than a real
      // explicit range below: this fallback case is a total unknown-length guess, and a wide
      // concatenated block of unrelated verses scores artificially well in keyword-overlap
      // ranking purely from its size (observed: a 21-verse fallback span beat a correct,
      // precise single-verse hit on a WRONG guess) — 10 keeps that risk much smaller while
      // still showing a genuinely useful chunk of the chapter's opening.
      if (!endVerse && g.verse == null) {
        const maxRow = db.prepare('SELECT MAX(verse_num) as m FROM verses WHERE book_id = ? AND chapter = ?').get(bookId, g.chapter) as { m: number | null } | undefined
        if (maxRow?.m && maxRow.m > startVerse) endVerse = Math.min(maxRow.m, startVerse + 10)
      }
      // Second, narrower trigger for the same shape of fallback: an explicit verse:1 (not a
      // null/omitted verse), when the question itself names a discourse-shaped passage
      // ("prayer", "sermon", ...) — deliberately gated on the question wording, not applied
      // generally, since blindly widening every verse-1 guess would wrongly expand genuinely
      // single-verse questions (e.g. John 3:16) into unwanted ranges. A canonical guess is
      // already ~90%+ reliable (Round 3), so it gets the chapter's REAL full length (capped at a
      // sane 40, for the rare very-long-chapter case) — the true whole passage, which is the
      // entire point of this fallback firing. A non-canonical guess is far less certain
      // (~30-50%, prior testing), so it reuses the SAME tighter 10-verse cap as the null-verse
      // fallback just above instead — a wrong non-canonical guess can't compound into a large
      // wrong block of displayed text (Round 10: this fallback used to be canonical-only; every
      // non-canonical text is now searched alongside canonical on every question, so it needs
      // its own, more conservative version of the same widening rather than none at all).
      let isWholePassageWiden = false
      if (!endVerse && startVerse === 1 && WHOLE_PASSAGE_QUESTION_RE.test(question)) {
        const maxRow = db.prepare('SELECT MAX(verse_num) as m FROM verses WHERE book_id = ? AND chapter = ?').get(bookId, g.chapter) as { m: number | null } | undefined
        if (maxRow?.m && maxRow.m > startVerse) {
          const cap = CANONICAL_TEXT_IDS.has(textId) ? 40 : 10
          endVerse = Math.min(maxRow.m, startVerse + cap)
          isWholePassageWiden = true
        }
      }
      // The generic +20 clamp below is sized for an AI-EXPLICIT range (a guess the model gave
      // real endVerse digits for) — the whole-passage widen just above already has its own
      // wider, deliberately-reasoned +40 cap, so it's exempt from being clamped back down again.
      if (endVerse && !isWholePassageWiden) endVerse = Math.min(endVerse, startVerse + 20)
      let resolvedText: string | null = null
      if (endVerse) {
        const parts: string[] = []
        for (let v = startVerse; v <= endVerse; v++) {
          const verse = queryVerse(bookId, g.chapter, v, textId)
          if (verse) parts.push(verse.text)
        }
        if (parts.length === 0) continue
        resolvedText = parts.join(' ')
        add(guessCandidates, textId, { book_id: bookId, chapter: g.chapter, verse_num: startVerse, verse_end: endVerse, text: resolvedText }, 'ai-guess')
      } else {
        const verse = queryVerse(bookId, g.chapter, startVerse, textId)
        if (!verse) continue
        resolvedText = verse.text
        add(guessCandidates, textId, { book_id: bookId, chapter: g.chapter, verse_num: startVerse, text: resolvedText }, 'ai-guess')
      }
      // Only let this guess's chapter lend corroboration to sibling keyword hits (Lever A) once
      // the guess itself actually overlaps a real keyword — see the ChapterHint comment above
      // scoreCandidates for why an unverified guess must earn this trust, not receive it
      // automatically. Restricted to non-canonical texts, same as before Round 10 — a canonical
      // guess is already reliable enough to lead outright without needing this extra lever.
      // `opportunistic` (strict archaic-vocab gating) matches whichever branch this guess's text
      // is actually competing in — see the scoreCandidates comment above.
      if (!CANONICAL_TEXT_IDS.has(textId) && keywordOverlapScore(resolvedText, keywords, wordReplacerRules, textId, !focusTextId) > 0) {
        if (!guessChaptersByText.has(textId)) guessChaptersByText.set(textId, new Set())
        guessChaptersByText.get(textId)!.add(g.chapter)
      }
    }
  }

  // 2. Keyword search via FTS5 — pulled into a closure so the agentic retry (step 2b) can
  // re-run it with a refined keyword list without duplicating this logic. Phrase mode first
  // for every keyword (and every word-replacer variant of it, e.g. "Yeshua" also tries
  // "Jesus" — see getWordReplacerVariants); the loose 'all'-mode (independent prefix-wildcard
  // AND) fallback only kicks in if EVERY keyword's phrase search came back empty — a single
  // keyword falling back while others still have real phrase hits is what used to flood the
  // pool with generic-word noise.
  function searchKeywords(kws: string[]): AiLookupResult[] {
    const out: AiLookupResult[] = []
    const localSeen = new Set<string>()
    for (const textId of textPasses) {
      if (!getTextDb(textId)) continue
      // Per-text keyword filtering (Round 10): drop the generic-narrative-name denylist when
      // searching a non-canonical text always, and also for canonical when unfocused (Round
      // 10.1 — see keywordOverlapScore's matching comment for why bare "Abraham"-style canonical
      // matches need the same treatment once canonical is competing head-to-head against
      // non-canonical instead of being the only thing searched). Canonical stays unfiltered only
      // in the FOCUSED branch's own canonical backfill pass — unchanged from Round 9 there.
      const kwsForText = CANONICAL_TEXT_IDS.has(textId) && focusTextId ? kws : filterGenericKeywords(kws, true)
      // Strict (rarity-gated) archaic-vocab variants when this text is only being searched
      // opportunistically (unfocused — see the getArchaicVariants/keywordOverlapScore comments).
      const phraseResults = kwsForText.map((kw) => {
        const variants = [
          ...getWordReplacerVariants(kw, wordReplacerRules),
          ...getArchaicVariants(kw, textId, !focusTextId),
        ]
        const rows = variants.flatMap((v) => searchVerses(v, textId, 'phrase'))
        return { variants, rows }
      })
      const anyPhraseHits = phraseResults.some((r) => r.rows.length > 0)
      for (const { variants, rows } of phraseResults) {
        if (out.length >= CANDIDATE_POOL_CAP) break
        const finalRows = rows.length > 0 || !anyPhraseHits
          ? (rows.length > 0 ? rows : variants.flatMap((v) => searchVerses(v, textId, 'all')))
          : []
        for (const row of finalRows.slice(0, 6)) {
          if (out.length >= CANDIDATE_POOL_CAP) break
          const r: AiLookupResult = {
            textId, bookId: row.book_id, bookName: bookNameFor(row.book_id, textId),
            chapter: row.chapter, verse: row.verse_num, text: row.text, source: 'keyword',
          }
          const key = dedupeKey(r)
          if (localSeen.has(key)) continue
          localSeen.add(key)
          out.push(r)
        }
      }
    }
    return out
  }

  emit(pick(searchingMessages(focusWorkName ?? 'Scripture')))
  keywordCandidates = searchKeywords(keywords)
  // searchKeywords dedupes against itself internally (its own localSeen) but not against the
  // outer `seen` set guesses were added to — merge those keys in now so cross-reference
  // expansion later doesn't re-add a verse that's already showing as a keyword result.
  for (const c of keywordCandidates) seen.add(dedupeKey(c))

  // 3. Merge adjacent verses (same textId/book/chapter, contiguous verse numbers, same
  // source) into displayed ranges — model-independent, so this fires whether or not the
  // AI's own guesses happened to include a range.
  let mergedGuesses = mergeAdjacent(guessCandidates)
  let mergedKeywords = mergeAdjacent(keywordCandidates)

  // 2b. "Deep search" (agentic) verification — a bounded loop, up to 3 total attempts
  // (initial + up to 2 refinement rounds). Each round shows the model its own real, verified
  // candidates and asks if they actually answer the question; if not, it can request different
  // keywords (tracked across rounds so it never repeats a set already tried) and/or, for a
  // pseudepigrapha focus text, suggest a different chapter to check. Stops the moment it's
  // satisfied, or the moment a round makes no real progress (so a stuck model can't burn all 3
  // rounds for nothing). The model still never gets to introduce a reference directly — only
  // steer what gets searched next; every candidate it ever sees was already independently
  // verified against the real DB.
  const triedKeywordSets: string[][] = [keywords]
  if (opts.agentic) {
    const MAX_ROUNDS = 3
    for (let round = 1; round < MAX_ROUNDS; round++) {
      if (mergedGuesses.length === 0 && mergedKeywords.length === 0 && strongsSeed.candidates.length === 0) break
      emit(pick(VERIFY_MESSAGES))
      let verdict: { satisfied?: boolean; refinedKeywords?: string[]; tryChapter?: number }
      try {
        const preview = scoreCandidates([...strongsSeed.candidates, ...mergedGuesses, ...mergedKeywords], keywords, undefined, wordReplacerRules)
        verdict = await runOllamaJson<{ satisfied?: boolean; refinedKeywords?: string[]; tryChapter?: number }>(
          verificationPrompt(question, focusWorkName, preview, triedKeywordSets), model
        )
      } catch {
        break // verification is best-effort — a failed call just stops the loop early
      }
      if (verdict.satisfied !== false) break

      let madeProgress = false

      if (verdict.refinedKeywords && verdict.refinedKeywords.length > 0) {
        const refined = filterGenericKeywords(verdict.refinedKeywords.slice(0, 6), false)
        const alreadyTried = triedKeywordSets.some((set) => set.length === refined.length && set.every((k, i) => k === refined[i]))
        if (refined.length > 0 && !alreadyTried) {
          emit(pick(REFINE_MESSAGES))
          const retryHits = searchKeywords(refined)
          const newHits = retryHits.filter((r) => !seen.has(dedupeKey(r)))
          for (const r of newHits) seen.add(dedupeKey(r))
          keywordCandidates = [...keywordCandidates, ...newHits]
          keywords = [...keywords, ...refined]
          mergedKeywords = mergeAdjacent(keywordCandidates)
          triedKeywordSets.push(refined)
          if (newHits.length > 0) madeProgress = true
        }
      }

      if (focusTextId && focusWorkName && verdict.tryChapter && Number.isInteger(verdict.tryChapter)) {
        const db = getTextDb(focusTextId)
        const bookId = resolveBookId(focusWorkName, focusTextId)
        if (db && bookId) {
          const maxRow = db.prepare('SELECT MAX(verse_num) as m FROM verses WHERE book_id = ? AND chapter = ?').get(bookId, verdict.tryChapter) as { m: number | null } | undefined
          if (maxRow?.m) {
            const endV = Math.min(maxRow.m, 10)
            const parts: string[] = []
            for (let v = 1; v <= endV; v++) {
              const verse = queryVerse(bookId, verdict.tryChapter, v, focusTextId)
              if (verse) parts.push(verse.text)
            }
            const key = `${focusTextId}|${bookId}|${verdict.tryChapter}|1`
            if (parts.length > 0 && !seen.has(key)) {
              seen.add(key)
              guessCandidates.push({
                textId: focusTextId, bookId, bookName: bookNameFor(bookId, focusTextId),
                chapter: verdict.tryChapter, verse: 1, endVerse: endV > 1 ? endV : undefined, text: parts.join(' '), source: 'ai-guess',
              })
              mergedGuesses = mergeAdjacent(guessCandidates)
              madeProgress = true
            }
          }
        }
      }

      if (!madeProgress) break
    }
  }

  if (mergedGuesses.length === 0 && mergedKeywords.length === 0 && strongsSeed.candidates.length === 0) {
    return { ...empty(), keywords, strongsCard: strongsSeed.card }
  }

  // 4. Notes signal — boosts ranking, never fabricates a new verse from a loose text match.
  const allCandidates = [...strongsSeed.candidates, ...mergedGuesses, ...mergedKeywords]
  const notesSignal = computeNotesSignal(allCandidates)
  for (const c of allCandidates) {
    if (notesSignal.notedKeys.has(dedupeKey(c))) c.noted = true
  }

  const chapterHint: ChapterHint | undefined = guessChaptersByText.size > 0
    ? { chaptersByText: guessChaptersByText }
    : undefined
  const scoreAndSort = (items: AiLookupResult[], minKeywordScore = 1, preferCanonicalTies = false, canonicalMinKeywordScore?: number): AiLookupResult[] =>
    scoreCandidates(items, keywords, notesSignal, wordReplacerRules, chapterHint, minKeywordScore, preferCanonicalTies, canonicalMinKeywordScore)
  // Used only by the unfocused branch below, to decide whether a guess has EARNED structural
  // priority. Checks the guess's own text first (cheap, already known); only queries the DB for
  // the guess's full chapter if that comes up empty. A real, targeted DB query — NOT a check
  // against the keyword-search candidate pool — because that pool is capped (≤6 rows per
  // keyword variant per text, earliest-in-the-text first) and a common word like "Moses" (used
  // hundreds of times across the canon) can easily crowd out a real, later occurrence before it
  // ever gets fetched. Confirmed directly: Exodus 20:19-22 (a few verses after the guessed
  // 20:1-17) genuinely says "Moses," but the capped candidate-pool-based check never saw it,
  // since the first 6 "Moses" hits FTS returned were all from earlier chapters — this direct,
  // guess-scoped query doesn't have that blind spot; guesses are capped at ≤8 per question, so
  // the extra DB round-trip here is cheap.
  // `opportunistic=false` here deliberately, even though this whole branch IS the opportunistic
  // one — found via testing that reusing `true` silently applied the generic-keyword denylist
  // (added earlier so bare "Abraham" can't win a false CROSS-TEXT competitive tie) to this
  // check too, stripping "Moses" out and defeating its own purpose: Exodus 20:19-22 genuinely
  // says "Moses," but the filtered check couldn't see it, so Exodus 20 was found to have "no
  // evidence" and lost to Epistle of Barnabas every time regardless of the direct DB query fix.
  // The two checks serve different purposes and should use different rules: the denylist
  // protects the COMPETITIVE scoring pool (where a bare name is too weak a signal to fairly beat
  // a genuinely-scoring non-canonical text); this is a self-contained check of whether ONE
  // guess's own neighborhood is topically consistent with ANY extracted keyword at all, where a
  // name like "Moses" is exactly the kind of real, meaningful corroboration it should be able to
  // use. (For a non-canonical guess, the non-canonical generic-denylist still applies regardless
  // of this flag — see filterGenericKeywords's call sites — so Jubilees-side behavior here is
  // unaffected.)
  function guessHasEvidence(g: AiLookupResult): boolean {
    if (keywordOverlapScore(g.text, keywords, wordReplacerRules, g.textId, false) > 0) return true
    const db = getTextDb(g.textId)
    if (!db) return false
    try {
      const rows = db.prepare('SELECT text FROM verses WHERE book_id = ? AND chapter = ?').all(g.bookId, g.chapter) as Array<{ text: string }>
      const wholeChapterText = rows.map((r) => r.text).join(' ')
      return keywordOverlapScore(wholeChapterText, keywords, wordReplacerRules, g.textId, false) > 0
    } catch {
      return false
    }
  }
  // Backfill-quality gating: a guess (from either the focus text or canonical) is already
  // strong evidence the question is answered — padding it with weak, single-keyword-overlap
  // backfill just adds noise ("too many results", reported directly). Require backfill
  // candidates to score ≥2 (real multi-keyword or corroborated overlap, not a single generic
  // word match) whenever a guess already contributed something; with zero guesses, keyword
  // search is the ONLY signal available, so it keeps the looser default (≥1).
  const backfillMinScore = mergedGuesses.length > 0 ? 2 : 1

  // 5. Result assembly. When a focus text is named, ITS OWN content leads — a canonical guess
  // no longer jumps ahead of what was actually asked about (previously it did, which read as
  // "I asked about Jubilees and got a Genesis answer" with no explanation). A canonical guess
  // is instead kept as a separate `related` pointer, shown after the focus results with a
  // one-line note — still visible, just not the headline answer. This branch is unchanged from
  // Round 5.
  //
  // Without a focus text (Round 10): canonical and every non-canonical text were searched
  // TOGETHER (see textPasses) — their guesses and keyword hits are merged into ONE pool and
  // ranked purely by score, with canonical preferred ONLY on a genuine tie (see
  // canonicalTieRank/preferCanonicalTies) — a non-canonical result that's genuinely a stronger
  // match still wins outright, it just doesn't win a coin-flip against an equally-good canonical
  // one. "Guesses lead, keyword search backfills gaps" is preserved, just pooled across all
  // texts instead of canonical-only.
  emit(pick(RANK_MESSAGES))
  const canonicalGuesses = mergedGuesses.filter((c) => CANONICAL_TEXT_IDS.has(c.textId))
  const focusGuesses = mergedGuesses.filter((c) => !CANONICAL_TEXT_IDS.has(c.textId))

  let candidates: AiLookupResult[]
  let related: AiLookupResult[] = []
  let relatedNote: string | undefined

  if (focusTextId) {
    const focusPool = scoreAndSort([...focusGuesses, ...mergedKeywords.filter((c) => c.textId === focusTextId)])
    candidates = focusPool.slice(0, TOTAL_PRIMARY_CAP)
    if (candidates.length < TOTAL_PRIMARY_CAP) {
      const canonicalKeywordScored = scoreAndSort(mergedKeywords.filter((c) => c.textId === DEFAULT_TEXT_ID), backfillMinScore)
      const room = Math.min(KEYWORD_BACKFILL_CAP, TOTAL_PRIMARY_CAP - candidates.length)
      candidates = [...candidates, ...canonicalKeywordScored.slice(0, room)]
    }
    if (canonicalGuesses.length > 0) {
      related = canonicalGuesses.slice(0, 2)
      const first = related[0]
      relatedNote = `This may also be recorded in the Bible at ${first.bookName} ${first.chapter}:${first.verse}${first.endVerse ? '-' + first.endVerse : ''} — ${focusWorkName}'s retelling may use different wording for the same event.`
    }
  } else {
    // Round 10.1 final design, reached after several rounds of real production testing exposed
    // real problems with simpler versions:
    //
    // 1. A "guess leads, keyword hits only backfill gaps above score ≥2" split (Round 9's
    //    original canonical-only design) silently EXCLUDED a genuinely-scoring Jubilees
    //    candidate whenever a canonical guess ALSO existed — even a totally ungrounded one
    //    (Genesis 12:1, which never mentions idolatry at all) — since nothing else was ever
    //    allowed to compete once any guess existed.
    // 2. Simply merging every guess and keyword hit into ONE pool scored purely by keyword count
    //    broke the older, load-bearing "a guess is a trusted, targeted answer" guarantee: a
    //    literal-word coincidence elsewhere in the (much larger) canonical corpus could outscore
    //    a genuinely correct guess (Psalms 107:29's "he maketh the storm a calm" beating the
    //    real Matthew 8:23-27 guess, since Matthew's actual KJV wording says "tempest").
    // 3. Giving a guess a flat scoring BONUS once it clears an evidence bar (its own text, or
    //    real keyword evidence anywhere else in the same chapter — see guessHasEvidence) fixed
    //    #2, but a flat bonus can still be numerically outscored by a text that happens to
    //    mention several of the extracted keywords in passing while
    //    discussing something else entirely (confirmed: Epistle of Barnabas referencing "Ten
    //    Commandments"/"Moses"/"Mount Sinai" together inside an unrelated Sabbath argument
    //    scored higher than a flat bonus, beating the real Exodus 20 guess).
    //
    // The fix: a guess that clears the evidence bar leads STRUCTURALLY (like the focused/
    // canonical-only branches above), not just via a bonus that can still be outscored. A guess
    // with NO evidence anywhere (own text, or its chapter) does NOT get this — which is exactly
    // what still lets Jubilees win outright over an ungrounded Genesis 12:1 guess. Everything
    // else (non-evidenced guesses alongside every keyword hit, canonical and non-canonical) then
    // competes together for the remaining slots, canonical keyword hits needing the stricter
    // corroboration floor (see canonicalMinKeywordScore comment above scoreCandidates).
    const evidencedGuesses: AiLookupResult[] = []
    const unevidencedGuesses: AiLookupResult[] = []
    for (const g of mergedGuesses) (guessHasEvidence(g) ? evidencedGuesses : unevidencedGuesses).push(g)
    candidates = scoreAndSort(evidencedGuesses, 0, true).slice(0, TOTAL_PRIMARY_CAP)
    if (candidates.length < TOTAL_PRIMARY_CAP) {
      const rest = scoreAndSort([...unevidencedGuesses, ...mergedKeywords], 1, true, 2)
      const room = TOTAL_PRIMARY_CAP - candidates.length
      candidates = [...candidates, ...rest.slice(0, room)]
    }
  }

  // Strong's-sourced results get their own budget on top of the primary cap — an exact tag
  // match is the most trustworthy source this pipeline has (no LLM guess involved in the verse
  // list itself), so it's never crowded out by keyword/guess candidates competing for the same
  // slots. Always led first.
  if (strongsSeed.candidates.length > 0) {
    const nonStrongs = candidates.filter((c) => !strongsSeed.candidates.some((sc) => dedupeKey(sc) === dedupeKey(c)))
    candidates = [...strongsSeed.candidates, ...nonStrongs]
  }

  // 5b. Final agentic relevance prune — after everything else has been decided, one last call
  // reviews the FINAL primary set and flags anything that isn't actually relevant even though
  // it scored non-zero (e.g. shares only a generic word, not the real topic). Never wipes the
  // set down to zero from this alone. Strong's-sourced results are exempt — an exact tag match
  // in the text_tagged column is definitionally on-topic for that Strong's number.
  //
  // The single top-ranked candidate is ALSO exempt — deep search must never do worse than fast
  // search, and this was the exact mechanism that let it: candidates[0] is whatever the
  // deterministic keyword/guess scoring (identical in both modes) already decided was the best
  // answer, so it's exactly what fast mode would have shown as its headline result. Nothing
  // downstream of that ranking is more trustworthy than the ranking itself — an LLM's own
  // after-the-fact relevance judgment on ONE candidate, in a single call, is not a more reliable
  // signal than the deterministic score that put it in first place, and letting it override that
  // is precisely how a Round-7 battery run measured deep mode scoring WORSE than fast mode on
  // the same questions (13/20 vs 16/20 on "quote", 4/10 vs 7/10 on "edge"). The prune may still
  // trim anything ranked below #1.
  if (opts.agentic && candidates.length > 0) {
    emit(pick(PRUNE_MESSAGES))
    try {
      const verdict = await runOllamaJson<{ irrelevant?: string[] }>(relevancePrunePrompt(question, candidates), model)
      const irrelevant = new Set(verdict.irrelevant ?? [])
      if (irrelevant.size > 0) {
        const keyFor = (r: AiLookupResult) => `${r.bookId} ${r.chapter}:${r.verse}`
        const topKey = keyFor(candidates[0])
        const pruned = candidates.filter((r) => r.source === 'strongs' || keyFor(r) === topKey || !irrelevant.has(keyFor(r)))
        if (pruned.length > 0) candidates = pruned
      }
    } catch { /* prune is best-effort — a failed call just skips it */ }
  }

  // 6. Cross-reference expansion — only from the final primary set (not the whole raw
  // candidate pool), and only for canonical-text results, since cross_references.db /
  // tske_refs.db are keyed to standard Bible book ids. Nested under their source verse via
  // `crossRefOf` rather than mixed into the primary list, and collapsed by default in the UI.
  const crossRefs: AiLookupResult[] = []
  for (const seedResult of candidates.filter((r) => CANONICAL_TEXT_IDS.has(r.textId))) {
    if (crossRefs.length >= MAX_CROSS_REFS) break
    const classic = getCrossRefsForVerse(seedResult.bookId, seedResult.chapter, seedResult.verse)
    for (const ref of classic.refs.slice(0, 2)) {
      if (crossRefs.length >= MAX_CROSS_REFS) break
      if (!ref.text) continue
      const key = `${seedResult.textId}|${ref.bookId}|${ref.chapter}|${ref.verse}`
      if (seen.has(key)) continue
      seen.add(key)
      crossRefs.push({
        textId: seedResult.textId, bookId: ref.bookId, bookName: bookNameFor(ref.bookId, seedResult.textId),
        chapter: ref.chapter, verse: ref.verse, text: ref.text, source: 'cross-ref',
        crossRefOf: { bookId: seedResult.bookId, chapter: seedResult.chapter, verse: seedResult.verse },
      })
    }
    const tske = getTskeForVerse(seedResult.bookId, seedResult.chapter, seedResult.verse)
    for (const group of tske.groups.slice(0, 1)) {
      for (const ref of group.refs.slice(0, 1)) {
        if (crossRefs.length >= MAX_CROSS_REFS) break
        if (!ref.text) continue
        const key = `${seedResult.textId}|${ref.bookId}|${ref.chapter}|${ref.verse}`
        if (seen.has(key)) continue
        seen.add(key)
        crossRefs.push({
          textId: seedResult.textId, bookId: ref.bookId, bookName: bookNameFor(ref.bookId, seedResult.textId),
          chapter: ref.chapter, verse: ref.verse, text: ref.text, source: 'cross-ref',
          crossRefOf: { bookId: seedResult.bookId, chapter: seedResult.chapter, verse: seedResult.verse },
        })
      }
    }
  }

  // candidates is already capped at TOTAL_PRIMARY_CAP, so it's short enough to show in full by
  // default — visibleCount just mirrors its length (the UI's "Show more" stays as a resilience
  // path, not something this now-small a list should normally need).
  const visibleCount = candidates.length
  const results = [...candidates, ...crossRefs]

  // Implicit notes augmentation — a topical/meaning question ("what does a fox mean in
  // scripture") might have a directly relevant idiom/regular note; surfaced only on a genuine
  // title/idiom-term match (searchNotesImplicit), never loose full-text noise, per the earlier
  // "From your notes" removal (Round 4).
  const notesAugment = searchNotesImplicit(keywords)

  // 7. Optional commentary — a second pass over the ranked, already-verified candidates.
  // The model explains and may flag entries to drop; it never introduces a new reference.
  if (opts.commentary) {
    emit(pick(COMMENTARY_MESSAGES))
    try {
      const raw = await runOllamaJson<{ perVerse?: Record<string, string>; irrelevant?: string[]; summary?: string }>(
        commentaryPrompt(question, candidates), model
      )
      const irrelevant = new Set(raw.irrelevant ?? [])
      for (const r of candidates) {
        const key = `${r.bookId} ${r.chapter}:${r.verse}`
        if (raw.perVerse?.[key]) r.commentary = raw.perVerse[key]
      }
      // Only prune if it wouldn't wipe out every primary result — a model that (incorrectly)
      // flags everything as irrelevant shouldn't leave the user with an empty response.
      const pruned = candidates.filter((r) => !irrelevant.has(`${r.bookId} ${r.chapter}:${r.verse}`))
      const finalPrimary = pruned.length > 0 ? pruned : candidates
      const keptKeys = new Set(finalPrimary.map(dedupeKey))
      const finalCrossRefs = crossRefs.filter((cr) => cr.crossRefOf && keptKeys.has(`${cr.textId}|${cr.crossRefOf.bookId}|${cr.crossRefOf.chapter}|${cr.crossRefOf.verse}`))
      return {
        results: [...finalPrimary, ...finalCrossRefs],
        visibleCount: finalPrimary.length,
        keywords, related, relatedNote, summary: raw.summary, strongsCard: strongsSeed.card, notes: notesAugment,
      }
    } catch {
      // Commentary is best-effort — a failed second call shouldn't drop the verified results.
      return { results, visibleCount, keywords, related, relatedNote, strongsCard: strongsSeed.card, notes: notesAugment }
    }
  }

  return { results, visibleCount, keywords, related, relatedNote, strongsCard: strongsSeed.card, notes: notesAugment }
}

interface StoredChat {
  id: string
  title: string
  messages: string // JSON
  created_at: string
  updated_at: string
}

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  results?: AiLookupResult[]
  visibleCount?: number
  keywords?: string[]
  related?: AiLookupResult[]
  relatedNote?: string
  summary?: string
  strongsCard?: AiLookupStrongsCard
  notes?: AiLookupNoteResult[]
  notesAreThePrimaryAnswer?: boolean
  createdAt: string
}

export function registerAiLookupHandlers(ipcMain: IpcMain): void {
  ipcMain.handle('ailookup:checkAvailable', () => checkOllamaAvailable())

  ipcMain.handle('ailookup:query', (event, question: string, opts: { commentary: boolean; agentic?: boolean; model?: string; textId?: string; wordReplacerRules?: WordReplacerRuleLite[]; history?: ChatHistoryTurn[] }) =>
    runLookup(question, opts, (status) => event.sender.send('ailookup:progress', status)))

  ipcMain.handle('ailookup:listChats', () => {
    const rows = getBereanDb()
      .prepare('SELECT id, title, created_at, updated_at FROM ai_chats ORDER BY updated_at DESC')
      .all() as Array<{ id: string; title: string; created_at: string; updated_at: string }>
    return rows
  })

  ipcMain.handle('ailookup:getChat', (_e, id: string) => {
    const row = getBereanDb().prepare('SELECT * FROM ai_chats WHERE id = ?').get(id) as StoredChat | undefined
    if (!row) return null
    return { id: row.id, title: row.title, messages: JSON.parse(row.messages) as ChatMessage[], createdAt: row.created_at, updatedAt: row.updated_at }
  })

  ipcMain.handle('ailookup:saveChat', (_e, chat: { id?: string; title: string; messages: ChatMessage[] }) => {
    const db = getBereanDb()
    const now = new Date().toISOString()
    if (chat.id) {
      db.prepare('UPDATE ai_chats SET title = ?, messages = ?, updated_at = ? WHERE id = ?')
        .run(chat.title, JSON.stringify(chat.messages), now, chat.id)
      return { id: chat.id }
    }
    const id = randomUUID()
    db.prepare('INSERT INTO ai_chats (id, title, messages, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run(id, chat.title, JSON.stringify(chat.messages), now, now)
    return { id }
  })

  ipcMain.handle('ailookup:deleteChat', (_e, id: string) => {
    getBereanDb().prepare('DELETE FROM ai_chats WHERE id = ?').run(id)
    return { success: true }
  })
}

// Exported for potential reuse (e.g. a future "explain this verse" entry point
// elsewhere in the app) without going through IPC.
export { runOllamaText }
