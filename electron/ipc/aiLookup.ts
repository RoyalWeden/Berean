import type { IpcMain } from 'electron'
import { randomUUID } from 'crypto'
import { getBereanDb } from '../db/berean'
import { queryVerse, searchVerses } from './bible'
import { getTextDb } from '../db/bible'
import { getCrossRefsForVerse, getTskeForVerse, getIncomingCrossRefsForVerse, getIncomingTskeForVerse, searchTskeHeadingsByKeywords } from './crossrefs'
import { getLexiconEntry, getLexiconOccurrences, searchLexiconGloss, findByNormalizedTransliteration } from './lexicon'
import { checkOllamaAvailable, runOllamaJson, runOllamaText, DEFAULT_OLLAMA_MODEL, unloadOllamaImmediately, NUM_CTX, NUM_PREDICT_JSON } from '../ollama'
import { searchYoutubeVideos, searchYoutubeTranscripts, type YoutubeVideoSearchResult, type YoutubeTranscriptSearchResult } from './youtube'
import { budgetPromptMaterial } from '../tokenBudget'
// A real, already-existing, actively-maintained reference parser + book-name table — unlike
// normalizeBookName/getWordReplacerVariants elsewhere in this file (deliberately ported, not
// imported, since they're small and this main-process build doesn't otherwise pull from src/),
// this one is large and load-bearing for the whole app's reference handling, so importing it
// directly (rather than porting a copy that could silently drift) is the right call here —
// electron.vite.config.ts's `main` build target already aliases `@` -> `src`, same as the
// renderer, and tsconfig.node.json already has the matching `paths` entry.
import { parseRef, isExactBookToken, type ParsedRef } from '@/lib/parseRef'
import { PSEUDEPIGRAPHA_ARCHAIC_VOCAB } from './archaicVocab'
import { gatherSemanticCandidates } from './semanticCandidates'

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

// 'tske' / 'cross-ref-seed' (TSKE headings + cross_references.db, both used as ACTIVE retrieval
// sources — see searchTskeHeadingCandidates/expandCrossRefNeighbors below) are deliberately
// distinct from the pre-existing 'cross-ref' (which only ever decorates an already-chosen
// result, nested under it via `crossRefOf` — see step 6 of runLookup) — these two instead
// compete for a PRIMARY result slot, same as an 'ai-guess'/'keyword' candidate does.
// 'semantic' (Round — embedding retrieval): a candidate found via the embedding index
// (electron/embeddings.ts), not a literal keyword/phrase match — see gatherSemanticCandidates in
// electron/ipc/semanticCandidates.ts and its call site below. Bypasses scoreCandidates' keyword-
// overlap floor the same way 'ai-guess'/'tske'/'cross-ref-seed' already do (see that function's
// own filter) since a semantic hit is, by definition, often exactly the case where literal
// keyword overlap is low or zero — it's still real, DB-verified text, never fabricated.
export type ResultSource = 'keyword' | 'ai-guess' | 'cross-ref' | 'strongs' | 'quote-source' | 'tske' | 'cross-ref-seed' | 'semantic'

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
  /** Round 11: set when the question was an explicit video request ("find me a video about
   *  X") — searched from the already-synced, allowlisted-channel local library only (see
   *  CLAUDE.md §12), never a live/all-of-YouTube search. Like `notes`, a fundamentally different
   *  shape than a verse result, so its own array. */
  videos?: AiLookupVideoResult[]
}

export interface AiLookupNoteResult {
  id: string
  title: string
  snippet: string
  isIdiom: boolean
  idiomTerm?: string
}

export interface AiLookupVideoResult {
  videoId: string
  title: string
  channelName: string
  thumbnailUrl: string
  /** Set only for a TRANSCRIPT-sourced match (see mergeVideoSearchResults) — the caption
   *  segment's playback position in milliseconds, so the UI can deep-link straight to the
   *  moment the topic is actually discussed instead of the video start. Absent for a plain
   *  title/channel-name match, which has no single "moment" to point to. */
  startMs?: number
  /** Set alongside `startMs` — the real transcript text surrounding the match (FTS5 snippet,
   *  not a summary), so the user can judge relevance before clicking through. */
  snippet?: string
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
  // Round: plan/retrieve/critique loop — the model's own judgement of what SHAPE of thing would
  // actually answer this question, gathered at the same time as (not as an extra call beyond)
  // the existing extraction call, hence "plan" rather than a new prompt. Purely advisory: see
  // decideNotesAreLead and the critique step in runLookup for how it's actually used (as one of
  // several signals, never the sole decider) — never a hard router on its own. Missing/unknown
  // (any value outside AnswerKind, including the field being entirely absent, which happens
  // whenever the model just doesn't produce it) must degrade to EXACTLY today's behavior — every
  // call site that reads this treats an absent/unrecognized value as "no opinion," not as a
  // default choice of any particular kind.
  answerKind?: AnswerKind | null
}

/** The four fundamentally different SHAPES an AI Lookup answer can take — verses (the default,
 *  ordinary case), a user's own notes, a local YouTube video, or a Strong's word card. Shared
 *  between the plan's `answerKind` (AiExtraction, above) and the critique's `leadKind` (see
 *  CritiqueVerdict below) — same vocabulary, gathered at two different points in the pipeline
 *  (before vs after real candidates exist), so the second can be compared against the first. */
export type AnswerKind = 'verses' | 'notes' | 'video' | 'strongs'

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
// Whole-chapter quote-lookup ("what does Matthew 24 quote") ranks every verse with a real hit
// by hit count and shows only the strongest ones — see runQuoteLookup's seed.verse==null branch.
const WHOLE_CHAPTER_QUOTE_CAP = 15

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

/** Strips double/single/typographic-quoted spans from a question before scope/book detection —
 *  a user pasting a verse ("...the house of the idols...") shouldn't have a work name or book
 *  abbreviation THAT HAPPENS TO APPEAR inside the quoted text hijack focus-text/book scoping for
 *  the whole question; only what the user actually SAID about the passage (outside the quote)
 *  should drive scope. Replaces the quoted span with spaces (not removes it) so word boundaries
 *  on either side of the quote stay intact for whatever text detection runs afterward. */
export function stripQuotedSpans(question: string): string {
  return question.replace(/["“][^"”]*["”]|'[^']*'/g, (m) => ' '.repeat(m.length))
}

// Precompiled once at module load, not per call — each entry is [word-boundary RegExp, textId].
// Boundary matching (not bare substring) means an alias only fires when it's a real standalone
// word/phrase in the question, not merely a substring of a longer unrelated word.
const TEXT_ALIAS_PATTERNS: Array<[RegExp, string]> = TEXT_ALIASES.map(([alias, textId]) => {
  const escaped = alias.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return [new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i'), textId]
})

export function detectFocusTextId(question: string): string | null {
  const scoped = stripQuotedSpans(question)
  for (const [re, textId] of TEXT_ALIAS_PATTERNS) {
    if (re.test(scoped)) return textId
  }
  return null
}

/** Round 11: when the question names the focus work AND a chapter number together (e.g.
 *  "jubilees 12", "why does Abraham leave his family in Jubilees 12"), pulls out that chapter
 *  number directly — used to deterministically pin the real chapter instead of depending
 *  entirely on the extraction LLM's own recall (only ~30-50% reliable for non-canonical guesses,
 *  per prior testing). Confirmed root cause of a reported bug: the model's own guess sometimes
 *  missed the exact stated chapter, canonical backfill silently filled the remaining slots
 *  instead, and commentary ended up written about content the user never actually asked about. */
function detectExplicitFocusChapter(question: string, focusWorkName: string): number | null {
  const escaped = focusWorkName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const m = question.match(new RegExp(`${escaped}\\s+(\\d{1,3})\\b`, 'i'))
  return m ? Number(m[1]) : null
}

/** Canonical-book counterpart to detectExplicitFocusChapter above — same "the user named this
 *  exact chapter in the question itself, pin it deterministically instead of trusting the
 *  extraction LLM's recall" reasoning, just for an ordinary Bible book instead of a focus text.
 *  Root-cause fix for a reported bug: a FOLLOW-UP question ("where in Deuteronomy 32 does it talk
 *  about it") got results scoped to neither Deuteronomy nor chapter 32 — detectExplicitFocusChapter
 *  never fires for a canonical book at all (it's only ever called when focusTextId is set, and
 *  detectFocusTextId only recognizes non-canonical works — see TEXT_ALIASES), so a canonical
 *  chapter reference had no deterministic pin of its own. `bookId` is whatever
 *  detectBookInQuestion already resolved (it re-scans the raw question fresh on every call,
 *  including follow-ups, so this works the same on turn 1 or turn 5 of a chat). Tries every real
 *  alias/abbreviation for that book (not just its canonical display name) — a question can
 *  reasonably say "Deut 32" or "Deuteronomy 32" — longest alias first, same "more specific wins"
 *  reasoning detectBookInQuestion itself already uses, so e.g. a short 3-letter abbreviation
 *  doesn't spuriously match ahead of the full name when both would technically work. */
function detectExplicitCanonicalChapter(question: string, bookId: string): number | null {
  const { toId } = getBookMaps(DEFAULT_TEXT_ID)
  const aliases = [...toId.entries()]
    .filter(([, id]) => id === bookId)
    .map(([name]) => name)
    .sort((a, b) => b.length - a.length)
  for (const alias of aliases) {
    const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const m = question.match(new RegExp(`\\b${escaped}\\s+(\\d{1,3})\\b`, 'i'))
    if (m) return Number(m[1])
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

// Book names/abbreviations that double as ordinary English words — a bare mention of one of
// these anywhere in a question ("I need a job", "the boy Dan", "some amount") isn't a reliable
// signal that the user means the BOOK. For these specific names only, detectBookInQuestion below
// additionally requires an explicit cue: either an adjoining chapter number ("Job 5") or an
// explicit "book of"/"in the book of" phrase immediately before it. Every other (unambiguous)
// book name/abbreviation is unaffected — this denylist exists ONLY to suppress false positives
// for names real English also uses as common words/names, not to make book detection stricter
// across the board.
// 'wisdom' added after a LIVE BUG: getBookDetectPatterns indexes every book name in kjva.db,
// which includes the Apocrypha — and Apocrypha has a book literally named "Wisdom" (WIS, the
// Wisdom of Solomon). Before this, "what does the Bible say about wisdom" matched WIS and scoped
// keyword search, Strong's occurrence search, AND notes search (all three read `questionBookId`,
// computed once via detectBookInQuestion — see its call site) to WIS alone, so Proverbs/James/
// Ecclesiastes — where "wisdom" is a major KJV theme — could never be retrieved at all for that
// question. Audited every other book name/short_name actually reachable from DEFAULT_TEXT_ID
// (kjva.db) for the same "common English noun" collision — 'wisdom' was the only miss; every
// other single-word name/short_name in that db (Job, Gad, Dan, Amos, Mark, Acts, Numbers,
// Judges, Kings, Bel, Song, ...) is either already denylisted here or is a proper name unlikely
// to double as an ordinary topical word in a question.
const AMBIGUOUS_BOOK_WORDS = new Set(['job', 'gad', 'dan', 'amos', 'mark', 'acts', 'numbers', 'kings', 'judges', 'wisdom'])

/** Per-text cache of compiled [word-boundary RegExp, bookId, nameLength] triples for
 *  detectBookInQuestion below — built once per textId (book names never change at runtime for a
 *  given text, same reasoning getBookMaps itself already uses) instead of compiling a fresh
 *  RegExp per book name on every single call, which is what this used to do. */
const _bookDetectPatterns = new Map<string, Array<{ re: RegExp; id: string; len: number; ambiguous: boolean }>>()
function getBookDetectPatterns(textId: string): Array<{ re: RegExp; id: string; len: number; ambiguous: boolean }> {
  let patterns = _bookDetectPatterns.get(textId)
  if (patterns) return patterns
  const { toId } = getBookMaps(textId)
  patterns = []
  for (const [name, id] of toId) {
    if (name.length < 3) continue
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const ambiguous = AMBIGUOUS_BOOK_WORDS.has(name.toLowerCase())
    // An ambiguous name additionally requires either a trailing chapter number ("Job 5") or a
    // leading "book of"/"in the book of" cue immediately before it ("the book of Job").
    const re = ambiguous
      ? new RegExp(`(?:\\bbook\\s+of\\s+${escaped}\\b|(^|[^a-z0-9])${escaped}\\s+\\d{1,3}\\b)`, 'i')
      : new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i')
    patterns.push({ re, id, len: name.length, ambiguous })
  }
  _bookDetectPatterns.set(textId, patterns)
  return patterns
}

/** Scans free text (a whole question, not a single book name) for a real canonical book name/
 *  abbreviation mentioned anywhere in it — e.g. "where in Matthew is G5485 used" → "MAT". Used
 *  for Strong's occurrence book-scoping (§Round 11) and, more generally, for constraining
 *  keyword search to a named book/testament. Longest match wins (so "song of solomon" isn't
 *  shadowed by a shorter false match), and matches are word-boundary-checked, not bare substring
 *  — real book names are checked against `getBookMaps`'s own name/abbreviation table, the same
 *  source of truth every other book-name resolution in this file already uses, so nothing new
 *  needs curating here. Names shorter than 3 characters are skipped (too easy to collide with
 *  ordinary English words, e.g. a 2-letter abbreviation). Text inside quotes is ignored (see
 *  stripQuotedSpans) — a pasted verse mentioning a book name shouldn't scope the whole question
 *  to it. A curated handful of names that double as common English words (see
 *  AMBIGUOUS_BOOK_WORDS) require an explicit cue before they count as a match at all. */
export function detectBookInQuestion(question: string): string | null {
  const scoped = stripQuotedSpans(question)
  let best: { id: string; len: number } | null = null
  for (const { re, id, len } of getBookDetectPatterns(DEFAULT_TEXT_ID)) {
    if (re.test(scoped) && (!best || len > best.len)) best = { id, len }
  }
  return best?.id ?? null
}

// Curated, canon-stable book-id groups for named scope phrases the extraction/keyword pipeline
// otherwise has no concept of at all (see detectTestamentInQuestion below) — ids match this DB's
// own `books.id` values exactly (confirmed against kjva.db), so no name resolution is needed.
const GOSPEL_BOOK_IDS = ['MAT', 'MRK', 'LUK', 'JHN']
const PAULINE_BOOK_IDS = ['ROM', '1CO', '2CO', 'GAL', 'EPH', 'PHP', 'COL', '1TH', '2TH', '1TI', '2TI', 'TIT', 'PHM']
const PROPHETS_BOOK_IDS = ['ISA', 'JER', 'LAM', 'EZK', 'DAN', 'HOS', 'JOL', 'AMO', 'OBA', 'JON', 'MIC', 'NAM', 'HAB', 'ZEP', 'HAG', 'ZEC', 'MAL']

// Per-text OT/NT book-id sets, read from the SAME `books.testament` column the Advanced Scripture
// Search UI already filters by (ScriptureSearchView.tsx) — built once per textId, same caching
// reasoning as getBookMaps/getBookDetectPatterns above.
const _testamentBookIds = new Map<string, { OT: string[]; NT: string[] }>()
function getTestamentBookIds(textId: string): { OT: string[]; NT: string[] } {
  let ids = _testamentBookIds.get(textId)
  if (ids) return ids
  ids = { OT: [], NT: [] }
  try {
    const db = getTextDb(textId)
    if (db) {
      const rows = db.prepare("SELECT id, testament FROM books WHERE testament IN ('OT', 'NT')").all() as Array<{ id: string; testament: string }>
      // Filtered again here, not just in the SQL WHERE clause — defensive against any row this
      // query wasn't meant to return (e.g. a testament value that's neither 'OT' nor 'NT').
      for (const r of rows) {
        if (r.testament === 'OT') ids.OT.push(r.id)
        else if (r.testament === 'NT') ids.NT.push(r.id)
      }
    }
  } catch { /* leave empty — a testament phrase just won't scope anything for this text */ }
  _testamentBookIds.set(textId, ids)
  return ids
}

/** Scans free text for a named testament or well-known canonical book GROUP (Gospels, Paul's
 *  epistles, the Prophets) — the same "constrain keyword/semantic search to a book-id list" idea
 *  detectBookInQuestion already provides for a single named book, extended to these coarser but
 *  extremely common ways of naming a scope ("its in the old testament", "one of the gospels").
 *  Returns null when nothing matches; runLookup only applies this when no single book was already
 *  detected (a specific book is strictly more precise than a whole testament/group). */
export function detectTestamentInQuestion(question: string): string[] | null {
  const scoped = stripQuotedSpans(question)
  if (/\bold\s+testament\b/i.test(scoped)) return getTestamentBookIds(DEFAULT_TEXT_ID).OT
  if (/\bnew\s+testament\b/i.test(scoped)) return getTestamentBookIds(DEFAULT_TEXT_ID).NT
  if (/\bgospels?\b/i.test(scoped)) return GOSPEL_BOOK_IDS
  if (/\b(pauline\s+epistles?|paul'?s\s+(epistles?|letters?)|epistles?\s+of\s+paul)\b/i.test(scoped)) return PAULINE_BOOK_IDS
  if (/\b(the\s+)?prophets\b|\bprophetic\s+books\b/i.test(scoped)) return PROPHETS_BOOK_IDS
  return null
}

// Words stripped out (alongside the matched scope phrase itself) when measuring how much
// standalone content a scope-refinement follow-up has — see buildEffectiveQuestion below.
const SCOPE_REFINEMENT_FILLER_RE = /\b(its|it'?s|in|the|try|look|check|search|only|just|maybe|from)\b/gi

/** A short follow-up that's JUST a testament/book-group refinement ("its in the old testament",
 *  "try the gospels") carries the SCOPE for this turn but no topic of its own — the real subject
 *  is still whatever the previous turn asked about. Neither the keyword extraction (told to
 *  answer "the CURRENT question... not [the history]") nor the semantic embedding (which embeds
 *  the raw question text) recovers that on their own, so a bare refinement like this previously
 *  re-ran the WHOLE pipeline against next to nothing, silently dropping the actual topic. Folds
 *  the previous user turn back in whenever the current question, with the matched scope phrase
 *  and ordinary filler words removed, has fewer than 3 words of its own content left. Only called
 *  when a testament/book-group phrase was actually detected this turn — an ordinary follow-up
 *  with no such phrase is left to the existing history-aware extraction prompt as before. */
function buildEffectiveQuestion(question: string, history: ChatHistoryTurn[]): string {
  const stripped = question
    .replace(/\b(old|new)\s+testament\b/i, '')
    .replace(/\bgospels?\b/i, '')
    .replace(/\b(pauline\s+epistles?|paul'?s\s+(epistles?|letters?)|epistles?\s+of\s+paul)\b/i, '')
    .replace(/\b(the\s+)?prophets\b|\bprophetic\s+books\b/i, '')
    .replace(SCOPE_REFINEMENT_FILLER_RE, '')
    .trim()
  if (stripped.split(/\s+/).filter(Boolean).length >= 3) return question // has its own real content
  const lastUserTurn = [...history].reverse().find((t) => t.role === 'user')
  return lastUserTurn ? `${lastUserTurn.content} — ${question}` : question
}

const SPELLED_OUT_NUMBERS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  a: 1, // "give me a place where..." — informal singular
}

/** Parses "give me 2 places", "three verses", "5 occurrences" etc — the requested COUNT of
 *  results, distinct from whether occurrences were requested at all (STRONGS_OCCURRENCES_
 *  REQUESTED_RE). Returns null (use the default) if no explicit count is mentioned. Capped by
 *  the caller, not here — this just parses what was asked. */
function detectRequestedCount(question: string): number | null {
  const m = question.match(/\b(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|a)\b\s+(places?|verses?|times?|occurrences?|references?|instances?|spots?)\b/i)
  if (!m) return null
  const raw = m[1].toLowerCase()
  const n = /^\d+$/.test(raw) ? Number(raw) : SPELLED_OUT_NUMBERS[raw]
  return n && n > 0 ? n : null
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
// "Jesus Christ") are unaffected.
//
// NO LONGER DROPS THE KEYWORD FROM SEARCH. It used to (filterGenericKeywords, above its own
// definition) — but for a question whose only real content word IS one of these ("what does the
// Bible say about love"), that deleted the entire query before search ever ran, reported
// directly as exactly that. Instead this list now feeds the SAME requireSpecificEvidence
// disqualify-from-bonus gate OVERLY_GENERIC_THEMATIC_WORDS already used below — a bare match on
// one of these still finds candidates and still scores, it just can never earn the rarity bonus
// on its own bare-word form, so it counts for less rather than vanishing. Multi-word keywords
// containing one of these words are still completely unaffected, same as before.
const OVERLY_GENERIC_SINGLE_WORDS = new Set([
  'god', 'jesus', 'yeshua', 'christ', 'lord', 'spirit', 'ghost', 'heaven', 'earth', 'love',
  'day', 'days', 'said', 'come', 'man', 'men', 'son', 'sons', 'father', 'king', 'people',
  'israel', 'went', 'saith', 'thing', 'things', 'great', 'good',
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

// Round 11: common moral/theological THEME words — distinct from OVERLY_GENERIC_IN_FOCUS_TEXT's
// narrative PROPER NOUNS (Abraham, Moses, ...) above. A word like "Moses" is rare outside a
// handful of books and, when it matches, genuinely identifies WHERE a passage is; a word like
// "idolatry" recurs constantly, unconnected, across the entire moral-exhortation genre these
// pseudepigrapha/patristic texts largely belong to (Recognitions of Clement, 1 Clement, Hermas,
// Barnabas each condemn idolatry as abstract vice at least once — none of it about Abraham's
// story). Confirmed directly: "idolatry" occurs only 1-2 times even WITHIN each of those
// individual texts, so per-text rarity gating alone can't tell a genuinely on-topic rare match
// (Jubilees' archaic-vocab BRIDGE to "the house of the idols," a specific curated phrase) apart
// from a coincidental bare mention of the same theme word elsewhere. See requireSpecificEvidence
// in keywordOverlapScore below — this list only ever disqualifies a BARE, unbridged match to the
// literal word itself; a text-specific archaic-vocab bridge variant is a different literal
// string and is never affected by this list.
const OVERLY_GENERIC_THEMATIC_WORDS = new Set([
  'idolatry', 'idols', 'idol', 'worship', 'sin', 'sins', 'wickedness', 'evil', 'wicked',
  'righteousness', 'righteous', 'holy', 'holiness', 'transgression', 'iniquity',
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
      // OVERLY_GENERIC_SINGLE_WORDS deliberately does NOT drop the keyword here any more — see
      // its own comment for why: doing so deleted the question's only real search term outright
      // ("what does the Bible say about love" reached search with nothing left to look for,
      // reported directly). It still down-weights via keywordOverlapScore's requireSpecificEvidence
      // gate below (same mechanism OVERLY_GENERIC_THEMATIC_WORDS already uses) — common enough
      // for less, not vanished.
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

function extractionPrompt(question: string, focusWorkName: string | null, history: ChatHistoryTurn[] = [], tabContextBlock = ''): string {
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
${historyBlock}${tabContextBlock}
User question: "${question}"

Respond with ONLY a JSON object of this exact shape:
{
  "keywords": ["short phrase or name", "..."],
  "guesses": [{"book": "Genesis", "chapter": 12, "verse": 1, "endVerse": 3}],
  "strongsNum": "H2580",
  "answerKind": "verses"
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
- "answerKind": your own best judgement of what would actually ANSWER this question — one of
  "verses" (an ordinary Scripture question — the default, use this whenever unsure), "notes" (the
  user is explicitly asking what THEIR OWN notes say, e.g. "what have I written about..."),
  "video" (the user is explicitly asking for a YOUTUBE VIDEO, e.g. "find me a video about..."), or
  "strongs" (the user is asking about a Hebrew/Greek WORD itself, not a passage). This is a
  judgement call, not a search input — get it wrong and the app still checks the real evidence
  before trusting it.
- No explanation, no markdown, JSON only.`
}

// Round 11: rewritten from the ground up after direct feedback that Commentary mode "didn't
// answer the question at all" — the old version was structurally a per-verse captioning/
// relevance-filter task, never actually instructed to answer anything. It also never knew which
// candidates were the FOCUS TEXT the user actually asked about vs. canonical backfill padding
// filling out the display cap (see KEYWORD_BACKFILL_CAP), so a "why does X happen in Jubilees
// 12" question could get commentary written about unrelated Genesis filler with no signal that
// it wasn't the real answer. And it never saw real note content at all, despite the reported
// output "referring to notes" — that language wasn't grounded in anything; it was invented.
function commentaryPrompt(
  question: string,
  verses: AiLookupResult[],
  tabContextBlock = '',
  focusWorkName: string | null = null,
  focusTextId: string | null = null,
  notesAugment: AiLookupNoteResult[] = [],
): string {
  const list = verses.slice(0, 12).map((v) => {
    const isFocusContent = focusTextId ? v.textId === focusTextId : true
    const label = isFocusContent ? '' : ' [related — a different text, not what was specifically asked about]'
    return `${v.bookId} ${v.chapter}:${v.verse}${v.endVerse ? '-' + v.endVerse : ''}${label} — ${v.text}`
  }).join('\n')

  const focusBlock = focusWorkName
    ? `\nThe user specifically asked about **${focusWorkName}** — answer using ITS content below; a
verse marked [related] is a different text and should only support the answer, never replace it.\n`
    : ''

  const notesBlock = notesAugment.length > 0
    ? `\nThe user has their own note(s) that may be relevant — real content, use it only if it
genuinely helps answer the question, never invent a note that isn't listed here:\n${notesAugment.map((n) => `- "${n.title}": ${n.snippet}`).join('\n')}\n`
    : ''

  return `A user asked: "${question}"
${tabContextBlock}${focusBlock}${notesBlock}
Here are candidate verses already found and verified against the actual Bible text (do not add,
remove text from, or renumber any of them):
${list}

Three jobs, in this order:
1. DIRECTLY ANSWER the question in 2-4 sentences, grounded ONLY in the verse text given above (and
   the note content above, if any) — never from outside/general knowledge. A candidate spanning a
   whole passage/chapter has each verse marked inline like "[12:5] text..." — read through ALL of
   it and answer using whichever specific verse(s) actually address what was asked, not just
   whichever part you read last. If the given verses don't actually contain enough to answer it,
   say so plainly instead of filling in the gap.
2. For each verse that's genuinely relevant, write ONE brief caption (max ~15 words) noting how
   it specifically supports the answer — skip this for a verse that's purely [related] padding
   and didn't really contribute.
3. Flag any verse above that is NOT actually relevant to the question (e.g. it only shares a
   generic word, not the actual topic) so it can be dropped from the results.

Respond with ONLY a JSON object of this exact shape:
{
  "summary": "the direct answer from job 1",
  "perVerse": {"GEN 12:1": "..."},
  "irrelevant": ["GEN 12:1", "..."]
}
Keys/entries must be exactly "BOOKID CHAPTER:VERSE" (the start verse only, matching the list
above, without the [related] label). "irrelevant" lists ONLY the ones that don't belong — omit it
or leave empty if all are relevant. JSON only, no markdown.`
}

/** Strips whitespace/punctuation noise for a loose substring comparison — used only to check
 *  whether a model-quoted span plausibly came from a candidate's real DB text, not for anything
 *  display-facing. Collapses runs of whitespace and drops punctuation entirely so "the LORD's"
 *  vs "the LORD’s" or extra/missing spacing around punctuation don't produce a false mismatch. */
function normalizeForQuoteMatch(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim()
}

/** Pulls every double/typographic-quoted span out of a piece of free text — a model claiming to
 *  QUOTE scripture inside its own prose is the highest-confidence place to catch a fabricated or
 *  misquoted verse (see verifyGeneratedText below), since a quote makes a specific, checkable
 *  claim about literal wording rather than a paraphrase. Ignores single-quoted spans — those are
 *  used constantly for ordinary contractions/possessives ("God's", "Yeshua's") and would produce
 *  overwhelming false positives if treated as quotation. */
export function extractQuotedSpans(text: string): string[] {
  const out: string[] = []
  const re = /["“]([^"”]{4,})["”]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) out.push(m[1])
  return out
}

/** Round 13 (defect #6a): deterministic, DB-grounded fact-check of the model's own free-text
 *  output — runs on EVERY commentary call (fast mode included, not gated behind "Deep search"),
 *  and costs no extra model call since it only re-checks output the model already produced.
 *  Two independent checks, both against `candidates` — the REAL, already-DB-verified result set
 *  actually being shown, not just any real verse anywhere:
 *   1. Every scripture reference the text names (via findAllReferencesInText) must resolve to one
 *      of the candidates actually shown — a reference to a verse that was never retrieved is
 *      either a hallucination or, at best, an out-of-scope aside the user has no way to check
 *      against what's on screen. Flagged, not silently dropped from the text (rewriting arbitrary
 *      prose to excise a clause is its own hallucination risk) — callers surface the flag instead.
 *   2. Every quoted span (extractQuotedSpans) must appear, loosely normalized, as a real substring
 *      of SOME candidate's actual DB text — a "quotation" that doesn't match any real candidate
 *      text is a misquote by construction, regardless of whether its cited reference (if any) is
 *      even real. Kept independent of check 1 on purpose: a misquote can attach to a perfectly
 *      real, correctly-cited reference just as easily as to a fabricated one. */
export function verifyGeneratedText(text: string, candidates: AiLookupResult[]): { unverifiedRefs: string[]; unverifiedQuotes: string[] } {
  const unverifiedRefs: string[] = []
  const unverifiedQuotes: string[] = []
  if (!text) return { unverifiedRefs, unverifiedQuotes }

  const candidateVerseKeys = new Set<string>()
  for (const c of candidates) {
    const end = c.endVerse ?? c.verse
    for (let v = c.verse; v <= end; v++) candidateVerseKeys.add(`${c.bookId}|${c.chapter}|${v}`)
  }
  for (const ref of findAllReferencesInText(text)) {
    if (ref.verse == null) continue // a bare book:chapter mention, nothing specific enough to check
    const end = ref.endVerse ?? ref.verse
    let anyMatch = false
    for (let v = ref.verse; v <= end && !anyMatch; v++) {
      if (candidateVerseKeys.has(`${ref.bookId}|${ref.chapter}|${v}`)) anyMatch = true
    }
    if (!anyMatch) unverifiedRefs.push(`${ref.bookId} ${ref.chapter}:${ref.verse}${ref.endVerse ? '-' + ref.endVerse : ''}`)
  }

  const normalizedCandidateTexts = candidates.map((c) => normalizeForQuoteMatch(c.text))
  for (const quote of extractQuotedSpans(text)) {
    const nq = normalizeForQuoteMatch(quote)
    if (!nq) continue
    if (!normalizedCandidateTexts.some((t) => t.includes(nq))) unverifiedQuotes.push(quote)
  }

  return { unverifiedRefs, unverifiedQuotes }
}

/** Appends a short, honest caveat to `summary` when verifyGeneratedText found something it
 *  couldn't confirm against the real candidates — used instead of silently rewriting the model's
 *  prose (which risks mangling otherwise-correct sentences) or silently dropping the whole
 *  summary (which throws away everything that WAS grounded along with the one thing that
 *  wasn't). Kept terse and factual, not alarming — this is expected to fire rarely once the
 *  extraction/ranking fixes upstream are in place, and should read as a normal disclosure, not an
 *  error state. */
export function appendVerificationCaveat(summary: string | undefined, check: { unverifiedRefs: string[]; unverifiedQuotes: string[] }): string | undefined {
  if (!summary) return summary
  const notes: string[] = []
  if (check.unverifiedRefs.length > 0) notes.push(`a reference to ${check.unverifiedRefs.join(', ')} that wasn't among the verses actually retrieved`)
  if (check.unverifiedQuotes.length > 0) notes.push(`a quoted phrase that doesn't match the retrieved text exactly`)
  if (notes.length === 0) return summary
  return `${summary}\n\n(Note: this answer also mentions ${notes.join(' and ')} — worth double-checking against Scripture directly.)`
}

function dedupeKey(r: Pick<AiLookupResult, 'textId' | 'bookId' | 'chapter' | 'verse'>): string {
  return `${r.textId}|${r.bookId}|${r.chapter}|${r.verse}`
}

/** A pointer to the renderer's currently active tab — mirrors AiLookupTabContextRef in
 *  src/types/electron.d.ts. The renderer only ever sends the REFERENCE (bookId/chapter, noteId,
 *  strongsNum, videoId); the real content is always fetched here, server-side, against the real
 *  DB — same "never trust renderer-supplied text" principle as every other candidate in this
 *  pipeline. */
export interface AiLookupTabContextRef {
  type: 'bible' | 'note' | 'lexicon' | 'youtube'
  bookId?: string
  chapter?: number
  translation?: string
  noteId?: string
  strongsNum?: string
  videoId?: string
}

// Keeps a whole chapter/note/entry from blowing the NUM_CTX budget (already tight per
// ollama.ts's own comments — a full extraction+context call needs to fit comfortably). A whole
// Bible chapter is almost always well under this; a long note or video description is truncated
// with a visible marker rather than silently cut.
const TAB_CONTEXT_MAX_CHARS = 4000

function truncateContext(text: string): string {
  return text.length > TAB_CONTEXT_MAX_CHARS ? text.slice(0, TAB_CONTEXT_MAX_CHARS) + ' […truncated]' : text
}

// Token budget for the whole prompt, leaving room for the model's own response — see
// electron/tokenBudget.ts. TAB_CONTEXT_MAX_CHARS above already bounds ONE piece of the prompt in
// isolation, but never against the OTHERS: a near-4000-char chapter pin, a near-cap 12-verse
// commentary candidate list, and 4 history turns can each individually look fine while still
// summing past what NUM_CTX actually holds — this is the real, combined ceiling everything below
// budgets against.
const MAX_PROMPT_TOKENS = NUM_CTX - NUM_PREDICT_JSON

/** Formats one chat history turn the same way extractionPrompt's own historyBlock does — kept as
 *  a standalone function so the budgeting pass below can measure each turn's real prompt-text
 *  size (role label included) before extractionPrompt ever assembles the final string. */
function formatHistoryTurn(h: ChatHistoryTurn): string {
  return `${h.role === 'user' ? 'User' : 'Assistant'}: ${h.content}`
}

/** Budgets chat history + active-tab context against MAX_PROMPT_TOKENS before the extraction
 *  call — the first and, by prompt order, most consequential trimming pass (see
 *  budgetPromptMaterial's documented priority order: history first, then tab context). Measures
 *  the real "static overhead" of the extraction prompt template itself (everything BUT history/
 *  tab-context/question — the JSON-shape instructions, the guess/style rules) by building the
 *  prompt once with both blanked out, so the budget check isn't guessing at the template's own
 *  size. Returns trimmed inputs ready to hand straight to extractionPrompt. */
function budgetForExtraction(question: string, focusWorkName: string | null, history: ChatHistoryTurn[], tabContextBlock: string): { history: ChatHistoryTurn[]; tabContextBlock: string } {
  const overhead = extractionPrompt(question, focusWorkName, [], '')
  const result = budgetPromptMaterial({
    question, staticOverhead: overhead,
    historyTurns: history.map(formatHistoryTurn),
    tabContextBlock, candidateBlocks: [],
  }, MAX_PROMPT_TOKENS)
  return { history: history.slice(result.trimmed.historyTurnsDropped), tabContextBlock: result.tabContextBlock }
}

/** Same one-line format commentaryPrompt itself builds its verse list from — factored out so the
 *  budgeting pass below can measure each candidate's real prompt-text size using the exact same
 *  string commentaryPrompt will actually emit for it. */
function commentaryVerseLine(v: AiLookupResult, focusTextId: string | null): string {
  const isFocusContent = focusTextId ? v.textId === focusTextId : true
  const label = isFocusContent ? '' : ' [related — a different text, not what was specifically asked about]'
  return `${v.bookId} ${v.chapter}:${v.verse}${v.endVerse ? '-' + v.endVerse : ''}${label} — ${v.text}`
}

/** Budgets the candidate verse list against MAX_PROMPT_TOKENS before a commentary call — the
 *  last-priority trim (history and tab context, both already settled by budgetForExtraction
 *  before this ever runs, take precedence — see budgetPromptMaterial's priority order).
 *  `verses` arrives already ranked best-first (the same ordering the existing `.slice(0, 12)`
 *  cap inside commentaryPrompt already assumed), so trimming from the tail here IS trimming the
 *  lowest-scoring candidates, never the ones that actually matter most. Always keeps at least
 *  one candidate if `verses` is non-empty. The pre-existing 12-verse cap inside commentaryPrompt
 *  itself still applies afterward as a hard backstop — this only ever trims further, never wider. */
function budgetCommentaryCandidates(question: string, verses: AiLookupResult[], tabContextBlock: string, focusWorkName: string | null, focusTextId: string | null, notesAugment: AiLookupNoteResult[]): AiLookupResult[] {
  const capped = verses.slice(0, 12)
  const overhead = commentaryPrompt(question, [], tabContextBlock, focusWorkName, focusTextId, notesAugment)
  const result = budgetPromptMaterial({
    question, staticOverhead: overhead,
    historyTurns: [], tabContextBlock: '',
    candidateBlocks: capped.map((v) => commentaryVerseLine(v, focusTextId)),
  }, MAX_PROMPT_TOKENS)
  return capped.slice(0, result.candidateBlocks.length)
}

/** Builds a labeled context block from the active tab, or '' if there's nothing to fetch/it
 *  can't be resolved (never throws — a missing/stale tab reference just means no extra context,
 *  not a failed question). */
function buildTabContextBlock(ref: AiLookupTabContextRef | undefined): string {
  if (!ref) return ''
  try {
    if (ref.type === 'bible' && ref.bookId && ref.chapter) {
      const textId = (ref.translation || DEFAULT_TEXT_ID).toLowerCase()
      const db = getTextDb(textId)
      if (!db) return ''
      const rows = db.prepare('SELECT verse_num, text FROM verses WHERE book_id = ? AND chapter = ? ORDER BY verse_num').all(ref.bookId, ref.chapter) as Array<{ verse_num: number; text: string }>
      if (rows.length === 0) return ''
      const bookName = bookNameFor(ref.bookId, textId)
      const body = rows.map((r) => `${r.verse_num}. ${r.text}`).join(' ')
      return `\nThe user currently has ${bookName} ${ref.chapter} (${textId.toUpperCase()}) open:\n${truncateContext(body)}\n`
    }
    if (ref.type === 'note' && ref.noteId) {
      const row = getBereanDb().prepare('SELECT title, content FROM notes WHERE id = ? AND deleted_at IS NULL').get(ref.noteId) as { title: string; content: string } | undefined
      if (!row) return ''
      return `\nThe user currently has a note open, titled "${row.title || '(untitled)'}":\n${truncateContext(row.content)}\n`
    }
    if (ref.type === 'lexicon' && ref.strongsNum) {
      const entry = getLexiconEntry(ref.strongsNum)
      if (!entry) return ''
      return `\nThe user currently has the lexicon entry for ${ref.strongsNum} (${entry.lemma}, ${entry.transliteration}) open: ${truncateContext(entry.definition || entry.gloss || '')}\n`
    }
    if (ref.type === 'youtube' && ref.videoId) {
      const row = getBereanDb().prepare('SELECT title, channel_name, description FROM youtube_videos WHERE video_id = ?').get(ref.videoId) as { title: string; channel_name: string; description: string } | undefined
      if (!row) return ''
      return `\nThe user currently has a YouTube video open: "${row.title}" (${row.channel_name}).${row.description ? ' Description: ' + truncateContext(row.description) : ''}\n`
    }
  } catch { /* a bad/stale reference just means no context, not a failed question */ }
  return ''
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

/** Result shape of the critique step below — see its own comment for what each field drives. */
export interface CritiqueVerdict {
  answersQuestion?: boolean
  missing?: string[]
  betterKeywords?: string[]
  leadKind?: AnswerKind
}

/** The one cheap, ALWAYS-ON (fast mode included) self-critique call — the "better internal
 *  dialogue" this whole round exists for. Distinct from verificationPrompt above in three ways:
 *  (1) it runs regardless of agentic/"Deep search", not gated behind it; (2) it's capped at ONE
 *  call, never a multi-round loop — verificationPrompt's up-to-3-round loop is unchanged and
 *  still agentic-only; (3) it also sees real note/video titles alongside verse candidates and
 *  reports which SHAPE of material (`leadKind`) should actually lead the answer, not just
 *  whether the verses are satisfactory. Shown material is capped small (5 candidates, titles
 *  only for notes/videos, verse text truncated) specifically because this has to stay CHEAP —
 *  it runs on every single question now, not just Deep search ones. */
function critiquePrompt(
  question: string,
  plan: { keywords: string[]; answerKind?: AnswerKind | null },
  topCandidates: AiLookupResult[],
  noteTitles: string[],
  videoTitles: string[],
): string {
  const candidateList = topCandidates.slice(0, 5)
    .map((c) => `${c.bookName} ${c.chapter}:${c.verse}${c.endVerse ? '-' + c.endVerse : ''} — ${c.text.slice(0, 200)}`)
    .join('\n') || '(none found)'
  const noteList = noteTitles.length > 0 ? noteTitles.map((t) => `- "${t}"`).join('\n') : '(none)'
  const videoList = videoTitles.length > 0 ? videoTitles.map((t) => `- "${t}"`).join('\n') : '(none)'

  return `A user asked: "${question}"

The search plan produced these keywords: ${JSON.stringify(plan.keywords)}${plan.answerKind ? ` (judged ahead of time to be a "${plan.answerKind}"-type question)` : ''}.

Top scripture candidates found so far (real, verified text):
${candidateList}

Matching notes found (titles only):
${noteList}

Matching local YouTube videos found (titles only):
${videoList}

Does this material actually answer the question? Respond with ONLY a JSON object:
{
  "answersQuestion": true|false,
  "missing": ["short phrase describing what's still missing, if anything"],
  "betterKeywords": ["short phrase", "..."],
  "leadKind": "verses"
}
"leadKind" is whichever of "verses", "notes", "video", or "strongs" should actually LEAD the
answer given everything above — not simply whichever list has the most items in it; a single
genuinely on-topic verse beats three unrelated notes. Only include "betterKeywords" (3-6 short
literal phrases likely to appear verbatim in the real text, genuinely different from the ones
already tried above) when "answersQuestion" is false and you have real, different terms worth
trying — omit it otherwise. JSON only, no markdown.`
}

/** Runs the critique call and degrades to `null` on ANY failure (timeout, malformed JSON, Ollama
 *  hiccup, or Ollama simply being unavailable) — same bare-catch-and-degrade convention every
 *  other best-effort call in this file already follows (see e.g. maybeAddCommentary,
 *  the agentic verification loop above). `null` means "no critique opinion," never "critique
 *  says something is wrong" — callers must treat it exactly like an absent/unknown `answerKind`:
 *  fall back to whatever signal or default they'd have used before this feature existed. */
export async function runCritique(
  question: string,
  plan: { keywords: string[]; answerKind?: AnswerKind | null },
  topCandidates: AiLookupResult[],
  noteTitles: string[],
  videoTitles: string[],
  model: string,
): Promise<CritiqueVerdict | null> {
  try {
    return await runOllamaJson<CritiqueVerdict>(critiquePrompt(question, plan, topCandidates, noteTitles, videoTitles), model)
  } catch {
    return null
  }
}

/** Decides whether NOTES should LEAD the answer (hiding the verse-results section entirely — see
 *  `notesAreThePrimaryAnswer`) instead of merely accompanying real scripture results — the fix
 *  for item #2: this used to be "the NOTE_ASK_TRIGGER regex fired," which had no way to tell a
 *  genuine notes-only question apart from one that also happens to have a real, better scripture
 *  answer (that regex is a HINT, not a guarantee — see NOTE_ASK_TRIGGER's own comment). Priority,
 *  most-informed signal first:
 *   1. The critique's own `leadKind` — it's the only signal that has actually SEEN the real verse
 *      candidates and the real note titles side by side, so it's the most grounded opinion
 *      available.
 *   2. The plan's `answerKind` — cheaper, and gathered before any real evidence existed, but
 *      still a real, purpose-built signal rather than a guess.
 *   3. A no-model-signal fallback (Ollama unavailable, extraction failed, or a malformed/failed
 *      critique call — this file's usual degrade-to-something-reasonable path) that's STRICTER
 *      than the old regex-only rule: notes lead only when there's a real note match AND (the
 *      question was an explicit notes-ask OR there's no real verse evidence at all) — a question
 *      that merely mentions "notes" in passing while a real scripture answer also exists no
 *      longer silently loses that scripture answer.
 *  Exported for unit testing — this is the one piece of real decision logic in an otherwise
 *  mechanical wiring job. */
export function decideNotesAreLead(inputs: {
  explicitNoteAsk: boolean
  noteResultsCount: number
  hasVerseEvidence: boolean
  planAnswerKind?: AnswerKind | null
  critiqueLeadKind?: AnswerKind | null
}): boolean {
  if (inputs.noteResultsCount === 0) return false
  if (inputs.critiqueLeadKind) return inputs.critiqueLeadKind === 'notes'
  if (inputs.planAnswerKind) return inputs.planAnswerKind === 'notes'
  return inputs.explicitNoteAsk || !inputs.hasVerseEvidence
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
// Round 11: capped (was unbounded) — every distinct phrase/text-id combination ever queried
// across the whole app session used to stay in memory for the process lifetime regardless of
// whether the AI panel was even open, part of the "reduce idle memory" cleanup this round. A
// real study session realistically touches at most a few hundred distinct phrases; 1000 is a
// generous ceiling that's still small (short strings + numbers), so this is about bounding
// worst-case unbounded growth over a long-running app process, not a meaningful cache-hit-rate
// tradeoff for ordinary use. Simple full-clear-on-cap rather than real LRU eviction — cheap and
// good enough given how rarely this would ever actually fire.
const _PHRASE_RARITY_CACHE_MAX = 1000
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
  if (_phraseRarityCache.size >= _PHRASE_RARITY_CACHE_MAX) _phraseRarityCache.clear()
  _phraseRarityCache.set(key, count)
  return count
}

// Round 11: `requireSpecificEvidence` disqualifies a match that is ONLY a bare, unbridged hit on
// a word from OVERLY_GENERIC_THEMATIC_WORDS — used for guess-evidence checks (any text, since an
// ungrounded guess shouldn't lead on "idolatry" alone regardless of canon) and for NON-CANONICAL
// keyword-sourced scoring specifically when opportunistic (canonical's own topical search, e.g.
// a plain "verses about idolatry" query with no competing guess, must keep working normally — a
// bare thematic word is exactly what that kind of query is legitimately searching for; the
// problem is only ever a coincidental thematic-word mention winning a cross-text competition it
// has no real connection to). A text-specific archaic-vocab BRIDGE variant (a different literal
// string, e.g. "the house of the idols") is never affected — only the bare keyword itself is
// gated. Confirmed directly: this is what actually distinguishes Jubilees' genuine match (always
// via the bridge — the bare word "idolatry" never even occurs in Jubilees' own text) from
// Recognitions of Clement/Hermas/Barnabas's coincidental one (no bridge exists for those texts at
// all, so a bare match is the ONLY path they have).
function keywordOverlapScore(text: string, keywords: string[], wordReplacerRules: WordReplacerRuleLite[] = [], textId?: string, opportunistic = false, requireSpecificEvidence = false): number {
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
  // Archaic-vocab bridge phrases already credited to THIS candidate, across every keyword in
  // this call — not per-keyword. See the mw-desire-death investigation: getArchaicVariants maps
  // a whole LIST of modern synonyms (e.g. `['died', 'death', 'passed away', 'dying']`) onto ONE
  // archaic phrase (`'steal away from his body'`, Testament of Jacob). A question whose extracted
  // keywords are several near-synonymous phrasings of the same idea ("desiring death", "seek
  // death", "cannot find death") ALL contain "death", so all three independently re-trigger the
  // identical archaic phrase against the identical candidate text — and because the outer loop
  // scores each keyword separately, that ONE underlying textual match got counted three times
  // (score 3), enough to outrank a canonical verse that matched literally but only once (score 2).
  // That is not three pieces of evidence; it is one piece of evidence read three times. A literal
  // variant match is NOT deduped the same way — two different keywords each matching their own
  // exact wording in the SAME candidate genuinely are two independent textual hits (e.g. "take no
  // thought" and "be careful for nothing" both appearing is real corroborating evidence), so only
  // the archaic-bridge path — which by design collapses many keyword phrasings onto one fixed
  // string — needs this guard.
  const creditedArchaicPhrases = new Set<string>()
  for (const kw of effectiveKeywords) {
    const bareKeywordLower = kw.trim().toLowerCase()
    const literalVariants = getWordReplacerVariants(kw, wordReplacerRules)
    // Kept as a SEPARATE list (not merged into literalVariants) — see the opportunistic-mode
    // bestBonus gating just below, which trusts these less than a literal/word-replacer match.
    const archaicVariants = textId ? getArchaicVariants(kw, textId, opportunistic) : []
    let bestBonus = false
    let anyHit = false
    for (const v of [...literalVariants, ...archaicVariants]) {
      const isArchaicBridge = !literalVariants.includes(v)
      if (isArchaicBridge && creditedArchaicPhrases.has(v)) continue
      const words = cleanWords(v)
      if (words.length === 0 || !words.every((w) => lower.includes(w.toLowerCase()))) continue
      if (isArchaicBridge) creditedArchaicPhrases.add(v)
      // requireSpecificEvidence is only ever true for a NON-canonical candidate in unfocused/
      // opportunistic mode (see scoreCandidates) — canonical is unaffected by this whole branch
      // regardless of which set the word is in. OVERLY_GENERIC_SINGLE_WORDS joined in here
      // alongside OVERLY_GENERIC_THEMATIC_WORDS: same reasoning, same governed context — a bare,
      // un-bridged match to one of these words on the non-canonical side is exactly the
      // coincidental-bag-of-words failure this gate already exists to block (a bare "love"/
      // "father"/"king" hit shouldn't let a non-canonical text win a tie against canonical any
      // more than a bare "sin"/"evil" hit already can't).
      if (requireSpecificEvidence && words.length === 1 && v.trim().toLowerCase() === bareKeywordLower
        && (OVERLY_GENERIC_THEMATIC_WORDS.has(words[0].toLowerCase()) || OVERLY_GENERIC_SINGLE_WORDS.has(words[0].toLowerCase()))) continue
      anyHit = true
      // Round 12 fix (Team B item lead): this bonus used to be gated off entirely whenever
      // `opportunistic` (the unfocused, all-texts-together branch) was active. That's exactly
      // the one branch where `canonicalMinKeywordScore` (see scoreCandidates) requires a
      // canonical keyword candidate to reach score 2 to survive at all — and a single-keyword
      // rarity bonus was the ONLY way a keyword-source candidate could ever reach 2 from one
      // keyword. With the bonus turned off precisely there, an exact, rare, literal KJV phrase
      // match (e.g. Proverbs 13:20 for "he that walketh with wise men shall be wise") could never
      // clear its own required bar and was silently dropped, while a much larger non-canonical
      // text's bag-of-words coincidence (needing only threshold 1) survived unchallenged.
      // Confirmed directly: th-wisdom's only two candidates were both real exact Proverbs phrase
      // matches, dropped for scoring exactly 1 against a threshold of 2, leaving a single
      // coincidental Enoch hit as the only result. Keeping the bonus available in every mode does
      // not remove any of Round 10.1's canonical-vs-non-canonical protections — those live in
      // `canonicalTieRank`/`canonicalMinKeywordScore`/`requireSpecificEvidence` themselves, not
      // here; a genuinely rare *non-canonical* phrase match benefits from this exact same bonus
      // too, which is correct — rarity is real evidence regardless of which side of the canon it
      // occurs on.
      //
      // Round 12 fix, part 2: the `words.length >= 3` floor here had the identical structural
      // problem for a genuinely rare SINGLE word. "mammon" occurs in exactly 3 KJV verses total
      // (Matt 6:24, Luke 16:13, Luke 16:9) — as rare a literal match as any 3+-word phrase — but
      // being one word meant it could never earn the rarity bonus, so it too was stuck at score 1
      // against canonicalMinKeywordScore's threshold of 2, losing every time to a non-canonical
      // text's unrelated single-word coincidence (which only needed threshold 1). Confirmed
      // directly on st-mammon. `phraseRarityCount` already works correctly on a 1-word list (it's
      // just an FTS phrase query, degenerate case of N=1), so the fix is simply not gating it out
      // — a common single word (the normal case this floor was guarding against) still won't earn
      // the bonus because phraseRarityCount for it will be well above 4 regardless of word count.
      //
      // Round 12 fix, part 3 (regression found via rg-father after part 1): re-running the
      // harness surfaced the EXACT failure part 1's own removed comment had warned about — an
      // archaic-vocab BRIDGE variant (getArchaicVariants; a different, translated/reinterpreted
      // literal string, not the keyword itself) being rare in its OWN small non-canonical corpus
      // let it outscore canonical on "honouring your father and mother": the literal KJV phrase
      // appears 6 times across the whole canon (Exodus, Deuteronomy, Tobit, Matthew, Mark, Luke —
      // genuinely well-attested, not coincidental), so its OWN rarity count is 6 > 4 and it can
      // never earn the bonus, while Jubilees' archaic-vocabulary paraphrase of the same concept
      // is rare purely because Jubilees is a small corpus that just doesn't say it often — that's
      // a weaker, more speculative signal than a literal hit and shouldn't be allowed to outscore
      // one. Fix: keep the bonus for a LITERAL keyword/word-replacer match in every mode (that's
      // what th-wisdom/st-mammon actually needed — kjva has no archaic-vocab rules at all, so
      // canonical candidates only ever reach this via a literal variant anyway), but restore the
      // original `!opportunistic` gate specifically for archaic-BRIDGE variants — the one case
      // the original design was already, correctly, cautious about.
      if (textId && words.length >= 1 && (!isArchaicBridge || !opportunistic) && phraseRarityCount(words, textId) <= 4) bestBonus = true
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
/** `bookId`/`chapter` (Round 12, optional): when the question named an explicit book (and,
 *  narrower, an explicit chapter within it — see detectExplicitCanonicalChapter), a note that IS
 *  anchored to a verse (has a real `verse_ref`) must be anchored to THAT location to stay
 *  eligible — matching pure keyword/title overlap alone is exactly what let a verse note from an
 *  unrelated chapter/book surface as if it were about the chapter actually asked about (the
 *  direct cause of the reported bug — notes search here previously had zero location awareness
 *  at all). A general note (no `verse_ref`) is untouched either way — this only ever excludes a
 *  location-anchored note that's anchored to the WRONG location, never a topical note that isn't
 *  anchored to any verse in the first place. `verse_ref` is stored as "BOOKID.CHAPTER" (a
 *  chapter-level note) or "BOOKID.CHAPTER.VERSE" (a verse-level note) — see notes:getByChapter in
 *  electron/ipc/notes.ts for the same LIKE-prefix pattern this mirrors. */
function searchNotesExplicit(question: string, limit = 8, bookId?: string | null, chapter?: number | null): AiLookupNoteResult[] {
  try {
    const db = getBereanDb()
    const words = cleanWords(question).filter((w) => w.length >= 3 && !GENERIC_NOTE_SEARCH_WORDS.has(w.toLowerCase()))
    if (words.length === 0) return []
    const ftsQ = words.map((w) => `"${w.replace(/"/g, '')}"`).join(' OR ')
    let locationClause = ''
    const locationParams: string[] = []
    if (bookId) {
      if (chapter != null) {
        locationClause = ' AND (n.verse_ref IS NULL OR n.verse_ref = ? OR n.verse_ref LIKE ?)'
        locationParams.push(`${bookId}.${chapter}`, `${bookId}.${chapter}.%`)
      } else {
        locationClause = ' AND (n.verse_ref IS NULL OR n.verse_ref LIKE ?)'
        locationParams.push(`${bookId}.%`)
      }
    }
    const rows = db.prepare(`
      SELECT n.id, n.title, n.content, n.type, n.idiom_term FROM notes_fts f
      JOIN notes n ON n.rowid = f.rowid
      WHERE notes_fts MATCH ? AND n.deleted_at IS NULL${locationClause}
      ORDER BY n.updated_at DESC
      LIMIT ?
    `).all(ftsQ, ...locationParams, limit) as Array<{ id: string; title: string | null; content: string; type: string; idiom_term: string | null }>
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
function searchNotesImplicit(keywords: string[], limit = 3, bookId?: string | null, chapter?: number | null): AiLookupNoteResult[] {
  if (keywords.length === 0) return []
  try {
    const db = getBereanDb()
    const rows = db.prepare(`SELECT id, title, content, type, idiom_term, verse_ref FROM notes WHERE deleted_at IS NULL AND (idiom_term IS NOT NULL OR title != '')`)
      .all() as Array<{ id: string; title: string | null; content: string; type: string; idiom_term: string | null; verse_ref: string | null }>
    const out: AiLookupNoteResult[] = []
    for (const row of rows) {
      // Round 12: same location-scoping rule as searchNotesExplicit above (see its comment) — a
      // verse-anchored note outside the explicitly-named book/chapter doesn't get to win on a
      // bare title/idiom-term keyword match either.
      if (bookId && row.verse_ref) {
        const inScope = chapter != null
          ? row.verse_ref === `${bookId}.${chapter}` || row.verse_ref.startsWith(`${bookId}.${chapter}.`)
          : row.verse_ref.startsWith(`${bookId}.`)
        if (!inScope) continue
      }
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
      // requireSpecificEvidence (Round 11): only for NON-canonical candidates when opportunistic
      // — canonical's own bare-thematic-word matches stay untouched (a plain "verses about
      // idolatry" topical query must keep working normally), while a non-canonical text's ONLY
      // path to a coincidental bare-word win is closed. See the requireSpecificEvidence comment
      // above keywordOverlapScore.
      score: keywordOverlapScore(c.text, keywords, wordReplacerRules, c.textId, preferCanonicalTies, preferCanonicalTies && !CANONICAL_TEXT_IDS.has(c.textId))
        + (notesSignal?.notedKeys.has(dedupeKey(c)) ? 2 : 0)
        + (c.source === 'keyword' && chapterHint?.chaptersByText.get(c.textId)?.has(c.chapter) ? 1 : 0),
    }))
    .filter((s) => {
      if (s.c.source !== 'keyword') return true
      const threshold = canonicalMinKeywordScore !== undefined && CANONICAL_TEXT_IDS.has(s.c.textId) ? canonicalMinKeywordScore : minKeywordScore
      // Deliberately filters on the RAW score, not the density-adjusted one below: this threshold
      // decides what is EVIDENCE ENOUGH TO SHOW AT ALL, and a genuinely relevant multi-verse range
      // must not drop out of the answer purely for being long. Density only decides ORDER.
      return s.score >= threshold
    })
    .sort((a, b) => b.score - a.score || (preferCanonicalTies ? canonicalTieRank(b.c) - canonicalTieRank(a.c) : 0) || a.i - b.i)
    .map((s) => s.c)
}

interface Emit { (status: string): void }
// Speed round: fires once, with the FULL retrieval-stage response, right before the optional
// Commentary pass (a second, ~4s Ollama call) starts — see the call site near the end of
// runLookup and AiLookupAPI['onPartial'] in src/types/electron.d.ts for the full rationale. A
// no-op default so every existing caller (tests, the eval harness) that doesn't pass one keeps
// working unchanged.
interface EmitPartial { (partial: AiLookupResponse): void }

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
  /** Set when a book scope was requested but that number genuinely doesn't occur there (real,
   *  DB-verified absence, not a fetch failure) — surfaced to the user instead of silently
   *  substituting occurrences from some other book. See Round 11. */
  note?: string
  /** True when the user asked for a SPECIFIC count ("give me 2 places") — the final response
   *  should show exactly that (capped) set of real occurrences and nothing else, not pad the
   *  answer with unrelated keyword/guess candidates the general pipeline also happened to find. */
  exactCountRequested?: boolean
}

// A definition-only Strong's question ("what is the greek strongs for grace") shouldn't dump a
// pile of occurrence verses underneath the word card by default — per direct feedback, that's
// noise unless actually asked for. Occurrences only fetch when the question itself asks for
// them: "where"/"which verses"/"occurs"/"appears"/"used in"/"found in".
const STRONGS_OCCURRENCES_REQUESTED_RE = /\b(where|which\s+verses?|occurs?|occurrence|appears?|used\s+in|found\s+in|every\s+place)\b/i

// Team B item 2c: "what does the Hebrew/Greek word for X mean" is a real, common question shape
// that has NO explicit H/G number typed in it — `detectStrongsNumbers` finds nothing, and
// extraction's own `strongsNum` guess is a best-effort model recall that isn't always reliable.
// Gated narrowly (word/name + mean(s/ing)) so this never fires on an ordinary topical/passage
// question — only a genuine definition-of-a-word ask.
//
// Widened (found via testing): the original three alternatives all require "word"/"name" to
// literally appear, but a question can ask exactly the same thing by NAMING the foreign term
// directly instead — "what does agape mean in Greek" never says "word" at all. Confirmed missed:
// st-agape-greek and a mammon-shaped question ("what is mammon in the Bible") both fell through
// to ordinary keyword search, which cannot answer a word-meaning question (search finds VERSES,
// not a lexicon entry). The 4th alternative below adds "X mean(s) in Hebrew/Greek" without
// requiring "word"/"name" — still narrow (needs the language named), so it doesn't spill into
// ordinary topical questions any more than the existing three do. "what is mammon" is
// deliberately left untriggered — "what is X" is too broad a shape (matches ordinary topical
// questions like "what is grace" just as often as word-meaning ones) to add safely; that
// phrasing still gets an answer via the model's own strongsNum guess when it fires, just not
// this deterministic path.
const WORD_MEANING_TRIGGER = /\b(word|name)\b[^.?!]{0,40}\bmeans?\b|\bmeans?\b[^.?!]{0,40}\b(word|name)\b|\bmeaning\s+of\s+(the\s+)?(hebrew|greek)\s+(word|name)\b|\bmeans?\s+in\s+(hebrew|greek)\b/i

/** Strips combining diacritics (NFD-decompose, drop the marks) and non-letters — used to compare
 *  a plain-English keyword ("agape") against a lexicon entry's own academic transliteration
 *  ("agapē", "bᵉrîyth") without needing to hardcode every accent variant. */
function normalizeTransliteration(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]/gi, '').toLowerCase()
}

/** Bridges a topical keyword (e.g. "grace", "torah", "agape", "covenant") to a real Strong's
 *  number — reuses `searchLexiconGloss`, the exact same query the on-demand Lexicon tab's own
 *  search already runs (electron/ipc/lexicon.ts), so this isn't a second, divergent matching
 *  heuristic, just a smarter pick from its results. Two tiers, tried in order:
 *
 *  1. Transliteration match: the keyword IS (once diacritics are stripped) the lexicon entry's
 *     own transliterated word — e.g. "agape" == normalized "agapē" (G26). This is the strongest
 *     possible signal (the keyword literally names the word), and the only tier that can resolve
 *     a bare transliteration at all, since a word like "agape" never appears in an English gloss.
 *  2. Gloss match: the keyword appears as a whole word (not a bare substring — "grace" matching
 *     "disgraceful" would be exactly the noisy coincidence Round 10's OVERLY_GENERIC denylists
 *     elsewhere in this file already exist to avoid) inside the entry's short_def. Multiple
 *     entries commonly share a gloss word ("law" glosses H1881/H1882/H8451 alike) — among those,
 *     picks the entry with the HIGHEST occurrence_count, on the reasoning that the most-attested
 *     word for a shared English gloss is the one a plain "what does the word for X mean" question
 *     actually means (confirmed directly: without this tiebreak, "law"→H1881 (21 occurrences)
 *     instead of the real Torah word H8451 (163) — picking by raw match order, not attestation,
 *     landed on an obscure synonym instead of the word actually being asked about).
 *
 *  `lang` narrows to Hebrew or Greek when the question itself names one. Returns null rather than
 *  guessing when nothing matches cleanly — this only ever ADDS a candidate on top of whatever the
 *  rest of the pipeline already found (see its call site), so a miss here costs nothing. */
// Tier 1: the keyword IS (once diacritics are stripped) the lexicon entry's own transliterated
// word — e.g. "agape" == normalized "agápē" (G26). The strongest possible signal, since the
// keyword literally names the word.
//
// Deliberately does NOT reuse `searchLexiconGloss`'s own results for this check — its
// `transliteration LIKE ?` is a byte-for-byte substring match, and SQLite's LIKE is not
// diacritic-insensitive. Nearly every transliteration in these tables carries an accent or
// macron (Greek "agápē" for G26, Hebrew "bĕrîyth" for H1285), so a plain-ASCII keyword like
// "agape" is never IN searchLexiconGloss's result set for normalizeTransliteration to check —
// confirmed directly, the SQL query itself returns zero rows. findByNormalizedTransliteration
// (lexicon.ts) fixes this by comparing normalized values in JS instead of relying on LIKE.
function bridgeByTransliteration(keyword: string, lang: 'H' | 'G' | 'all'): string | null {
  const kw = keyword.trim().toLowerCase()
  if (!kw || kw.length < 3) return null
  const hit = findByNormalizedTransliteration(normalizeTransliteration(kw), lang, normalizeTransliteration)
  return hit?.strongsId ?? null
}

// Tier 2: the keyword appears as a whole word (not a bare substring — "grace" matching
// "disgraceful" would be the noisy coincidence the OVERLY_GENERIC denylists elsewhere in this
// file already exist to avoid) inside the entry's short_def. Weaker than a transliteration hit —
// a common English word can legitimately appear in several unrelated entries' glosses (H8451
// "torah"'s own short_def is literally "law.", but so is part of H4941 "mishpat"'s much longer
// gloss, "...(manner of) law(-ful)..."), so ties are broken by real-corpus occurrence count as a
// rough popularity signal, not semantic precision — see this tier's call site for why it is only
// ever tried after EVERY keyword's tier-1 chance has already failed.
function bridgeByGloss(keyword: string, lang: 'H' | 'G' | 'all'): string | null {
  const kw = keyword.trim().toLowerCase()
  if (!kw || kw.length < 3) return null
  const results = searchLexiconGloss(kw, lang)
  if (results.length === 0) return null
  const wordBoundary = new RegExp(`\\b${kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i')
  const glossHits = results.filter((r) => wordBoundary.test(r.gloss))
  if (glossHits.length === 0) return null
  // Tie-break by real-corpus occurrence count. TRIED gloss-length-first here on the theory that a
  // tight, single-word gloss ("law.") is a stronger signal than occurrence count — it fixed the
  // "torah" case (see this tier's own header comment) but REGRESSED two already-correct,
  // fixture-verified cases: "grace" started resolving to H8467 (9 occurrences, a marginal word)
  // instead of H2580 (53 occurrences — confirmed the literal {H2580} tag on Gen 6:8's "grace"),
  // and "sabbath" started resolving to H4868 (1 occurrence!) instead of H7676 (57 occurrences —
  // confirmed the literal {H7676} tag on Exod 20:8's "sabbath"). Gloss length is not a reliable
  // proxy for "this is the word people mean" — occurrence count, imperfect as it is, was right
  // more often. Reverted; the "torah" case (H8451's own transliteration is the academic
  // "tôwrâh", not the popular English spelling, so it never gets a tier-1 hit) is left as a
  // known, narrower limitation rather than fixed by breaking the general case.
  glossHits.sort((a, b) => b.occurrences - a.occurrences)
  return glossHits[0].strongsNum
}

// ── TSKE headings + cross_references.db as ACTIVE retrieval sources, not decoration ─────────
//
// Before this, tske_refs.db/cross_references.db were only ever consulted AFTER a primary result
// was already chosen (step 6 of runLookup, below) — nesting 1-2 cross-refs under an already-
// displayed verse. That's real, human-curated data going completely unused for the actual job of
// FINDING a verse in the first place. Two independent additions:
//
//  1. searchTskeHeadingCandidates — TSKE's `heading` column is a genuine topical index ("the
//     fear of the Lord", "a good understanding", ...). A topical question can match a heading
//     directly even when the target verse shares NO literal words with the question at all —
//     complementary to, not a replacement for, the literal-overlap keyword search and the
//     Strong's-gloss bridge above.
//  2. expandCrossRefNeighbors — once ordinary keyword/guess retrieval has already found a real,
//     corroborated anchor verse, cross_references.db's vote-weighted edges can surface a
//     genuinely relevant neighbor that shares no literal words with the QUESTION but IS
//     cross-referenced from a verse that does — widening the candidate pool BEFORE final
//     ranking, not decorating an already-finalized result.
//
// Both feed into `guessCandidates` at their call site in runLookup (own `source` tag — see
// ResultSource) — they compete for a primary slot through the exact same scoring/dedup/merge
// machinery a real 'ai-guess' does, rather than bypassing it with special-cased logic.

// Soft ceiling on how many TSKE-heading-sourced candidates can enter the pool per question — same
// pool-bounding discipline as CANDIDATE_POOL_CAP/KEYWORD_BACKFILL_CAP above. TSKE headings are a
// SUPPLEMENTARY signal (no literal overlap guaranteed), so this stays small — it should never be
// able to outnumber real keyword/guess evidence in the final TOTAL_PRIMARY_CAP-sized answer.
const TSKE_HEADING_CANDIDATE_CAP = 6

/** Turns raw TskeHeadingHit rows (crossrefs.ts) into real, DB-verified verse candidates —
 *  resolves each hit's `to_*` verse against the live kjva DB (never trusts the tske_refs.db
 *  text columns directly, there are none — same "always re-fetch from the real text DB" pattern
 *  every other candidate source in this file follows) and drops any hit that doesn't resolve to
 *  a real verse. Deliberately pulls the `to_*` (cross-referenced) verse, not the `from_*` anchor
 *  the heading is attached to — the anchor itself is a normal literal-overlap candidate that
 *  ordinary keyword search already finds whenever it's genuinely relevant; the `to_*` verses are
 *  the ones a plain literal search has no way to reach. Capped at TSKE_HEADING_CANDIDATE_CAP,
 *  first-match-wins order (searchTskeHeadingsByKeywords already orders by sort_order, TSKE's own
 *  "most relevant first" convention). */
export function searchTskeHeadingCandidates(keywords: string[]): AiLookupResult[] {
  const hits = searchTskeHeadingsByKeywords(keywords)
  const out: AiLookupResult[] = []
  const localSeen = new Set<string>()
  for (const hit of hits) {
    if (out.length >= TSKE_HEADING_CANDIDATE_CAP) break
    const key = `${hit.toBook}|${hit.toCh}|${hit.toVs}`
    if (localSeen.has(key)) continue
    const verse = queryVerse(hit.toBook, hit.toCh, hit.toVs, DEFAULT_TEXT_ID)
    if (!verse) continue
    localSeen.add(key)
    out.push({
      textId: DEFAULT_TEXT_ID, bookId: hit.toBook, bookName: bookNameFor(hit.toBook, DEFAULT_TEXT_ID),
      chapter: hit.toCh, verse: hit.toVs, endVerse: hit.toVsEnd ?? undefined, text: verse.text, source: 'tske',
    })
  }
  return out
}

// A real edge must clear a positive vote floor before it's trusted enough to WIDEN the candidate
// pool — cross_references.db has genuine negative-vote (crowd-flagged-as-wrong) edges (confirmed
// via direct query against the real DB: votes range from -86 to 1278), so picking the top-N BY
// VOTES per anchor without a floor could still surface a net-negative edge for an anchor that
// simply has few recorded cross-references at all. A flat positive floor, not a percentile or
// relative rank, keeps this simple and auditable — see the report for why 20 (not, say, 5 or 50)
// was picked: it's comfortably above the "few stray/noisy votes" range visible in the real data
// (the vast majority of edges cluster near 0) while still admitting plenty of real, well-attested
// classic cross-references (Gen 1:1 -> John 1:1 alone carries 367).
const CROSS_REF_EXPAND_MIN_VOTES = 20
// Depth-1 only (deliberate product judgement call — see report): each anchor contributes at most
// its own 2 highest-voted neighbors (outgoing + incoming combined), and the whole widening pass
// across every anchor is capped at 6 total — the same order of magnitude as
// KEYWORD_BACKFILL_CAP/TSKE_HEADING_CANDIDATE_CAP, so this one supplementary source can't crowd
// out real evidence in the final TOTAL_PRIMARY_CAP-sized answer.
const CROSS_REF_EXPAND_PER_ANCHOR_CAP = 2
const CROSS_REF_EXPAND_TOTAL_CAP = 6

/** Pure ranking/capping step, split out from expandCrossRefNeighbors so it's testable without a
 *  real DB: given one anchor's already-fetched outgoing + incoming cross-reference rows, returns
 *  its top CROSS_REF_EXPAND_PER_ANCHOR_CAP neighbors that clear CROSS_REF_EXPAND_MIN_VOTES,
 *  highest-voted first. A neighbor with no resolved text (a real gap in fetchVerseTexts' source
 *  DB, rare but possible) is dropped rather than shown with an empty body.
 *
 *  Deduped by (bookId,chapter,verse) BEFORE ranking, keeping only the higher-voted of the two
 *  directions when the same verse is recorded both ways — confirmed as a real bug via the
 *  xref-creation-by-faith fixture: cross_references.db records Gen 1:1 -> Jhn 1:1 (367 votes,
 *  outgoing) AND Jhn 1:1 -> Gen 1:1 (333 votes, incoming) as two SEPARATE rows for the same real
 *  edge. Without deduping first, John 1:1 occupied BOTH of Gen 1:1's top-2 slots (367 and its own
 *  333 "duplicate"), silently starving out Heb 11:3 (268 votes) — a real, independently-voted,
 *  genuinely different neighbor — even though it would have easily made the top 2 on its own
 *  merit. */
export function pickTopVotedNeighbors(
  outgoing: Array<{ bookId: string; chapter: number; verse: number; text: string; votes: number }>,
  incoming: Array<{ bookId: string; chapter: number; verse: number; text: string; votes: number }>,
): Array<{ bookId: string; chapter: number; verse: number; text: string; votes: number }> {
  const byVerse = new Map<string, { bookId: string; chapter: number; verse: number; text: string; votes: number }>()
  for (const r of [...outgoing, ...incoming]) {
    if (r.votes < CROSS_REF_EXPAND_MIN_VOTES || !r.text) continue
    const key = `${r.bookId}|${r.chapter}|${r.verse}`
    const existing = byVerse.get(key)
    if (!existing || r.votes > existing.votes) byVerse.set(key, r)
  }
  return [...byVerse.values()]
    .sort((a, b) => b.votes - a.votes)
    .slice(0, CROSS_REF_EXPAND_PER_ANCHOR_CAP)
}

/** Selects up to `cap` already-found candidates strong enough to trust as cross-reference
 *  expansion anchors — real, corroborated evidence (score >= 2, the same "real multi-keyword or
 *  corroborated overlap, not a single generic-word match" bar backfillMinScore already
 *  establishes elsewhere in this file for very similar reasons), not just any candidate that
 *  happened to enter the pool. Pure function of the pool + keywords, split out for direct unit
 *  testing. `opportunistic` mirrors every other keywordOverlapScore call site's own convention:
 *  true (flat +1/keyword) for the unfocused, all-texts-together path, false (rarity-weighted) for
 *  a focus-text/canonical-only question — see keywordOverlapScore's own comment. */
export function selectCrossRefAnchors(
  pool: AiLookupResult[], keywords: string[], wordReplacerRules: WordReplacerRuleLite[], opportunistic: boolean, cap = 2,
): AiLookupResult[] {
  return pool
    .map((c) => ({ c, score: keywordOverlapScore(c.text, keywords, wordReplacerRules, c.textId, opportunistic, false) }))
    .filter((x) => x.score >= 2)
    .sort((a, b) => b.score - a.score)
    .slice(0, cap)
    .map((x) => x.c)
}

/** Orchestrates the DB side of the seed-and-expand widening: for each trusted anchor, fetches its
 *  real outgoing + incoming cross-references (reusing getCrossRefsForVerse/
 *  getIncomingCrossRefsForVerse from crossrefs.ts — same functions the post-hoc decoration step
 *  already uses, not a second divergent query), hands them to the pure pickTopVotedNeighbors
 *  step, and turns the survivors into real candidates. Only ever called with canonical anchors
 *  (cross_references.db is keyed to standard Bible book ids) — see the call site's own filter. */
export function expandCrossRefNeighbors(anchors: AiLookupResult[]): AiLookupResult[] {
  const out: AiLookupResult[] = []
  const localSeen = new Set<string>()
  for (const anchor of anchors) {
    if (out.length >= CROSS_REF_EXPAND_TOTAL_CAP) break
    const outgoing = getCrossRefsForVerse(anchor.bookId, anchor.chapter, anchor.verse).refs
    const incoming = getIncomingCrossRefsForVerse(anchor.bookId, anchor.chapter, anchor.verse).refs
    const neighbors = pickTopVotedNeighbors(outgoing, incoming)
    for (const n of neighbors) {
      if (out.length >= CROSS_REF_EXPAND_TOTAL_CAP) break
      const key = `${n.bookId}|${n.chapter}|${n.verse}`
      if (localSeen.has(key)) continue
      localSeen.add(key)
      out.push({
        textId: anchor.textId, bookId: n.bookId, bookName: bookNameFor(n.bookId, anchor.textId),
        chapter: n.chapter, verse: n.verse, text: n.text, source: 'cross-ref-seed',
      })
    }
  }
  return out
}

// Sane upper bound on an explicitly-requested count ("give me 2 places") — protects against a
// runaway/abusive number while still comfortably covering any real, ordinary request.
const MAX_REQUESTED_OCCURRENCES = 20
const DEFAULT_OCCURRENCES_SHOWN = 6

/** Resolves a list of Strong's numbers (explicit ones detected in the question, plus any the
 *  model itself proposed) into a verified word card (always) and real occurrences (only when
 *  the question actually asked for them — see STRONGS_OCCURRENCES_REQUESTED_RE) — every number
 *  is checked against the real lexicon DB first (getLexiconEntry), so a hallucinated/invalid one
 *  is silently dropped exactly like an unresolvable book/chapter guess is elsewhere in this
 *  file. Verse occurrences come from getLexiconOccurrences, which scans the tagged text directly
 *  (an exact tag match, not a model guess) — the most trustworthy source this pipeline has.
 *  `bookId`/`requestedCount` (Round 11): a book named in the question ("in Matthew") scopes
 *  occurrences to real, DB-verified matches in that book only — a genuine zero-result book
 *  scope sets `note` explaining that, rather than silently showing occurrences from unrelated
 *  books. A requested count ("give me 2 places") overrides the default cap of 6. */
function resolveStrongsNumbers(nums: string[], seen: Set<string>, bookNameForFn: (bookId: string, textId: string) => string, includeOccurrences: boolean, bookId?: string | null, requestedCount?: number | null): StrongsSeedResult {
  const candidates: AiLookupResult[] = []
  let card: AiLookupStrongsCard | undefined
  let note: string | undefined
  const limit = Math.min(requestedCount ?? DEFAULT_OCCURRENCES_SHOWN, MAX_REQUESTED_OCCURRENCES)
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
    const occs = getLexiconOccurrences(num, bookId ?? undefined)
    if (bookId && occs.length === 0) {
      const bookLabel = bookNameForFn(bookId, DEFAULT_TEXT_ID)
      note = `${num} doesn't occur in ${bookLabel} — showing real occurrences elsewhere instead.`
      // Fall back to an UNSCOPED search so the answer still shows something real and useful,
      // just honestly labeled as not being in the book that was actually asked about.
      for (const occ of getLexiconOccurrences(num).slice(0, limit)) {
        const key = `${occ.text_id}|${occ.book_id}|${occ.chapter}|${occ.verse_num}`
        if (seen.has(key)) continue
        seen.add(key)
        candidates.push({
          textId: occ.text_id, bookId: occ.book_id, bookName: bookNameForFn(occ.book_id, occ.text_id),
          chapter: occ.chapter, verse: occ.verse_num, text: occ.text, source: 'strongs',
        })
      }
      continue
    }
    for (const occ of occs.slice(0, limit)) {
      const key = `${occ.text_id}|${occ.book_id}|${occ.chapter}|${occ.verse_num}`
      if (seen.has(key)) continue
      seen.add(key)
      candidates.push({
        textId: occ.text_id, bookId: occ.book_id, bookName: bookNameForFn(occ.book_id, occ.text_id),
        chapter: occ.chapter, verse: occ.verse_num, text: occ.text, source: 'strongs',
      })
    }
  }
  return { candidates, card, note, exactCountRequested: includeOccurrences && requestedCount != null }
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
// misfire into notes-only mode. Round 13: dropped a bare "written about/on" alternative that used
// to be in this list — it matched an ordinary SCRIPTURE question with no mention of "notes" at
// all (e.g. "what is written about the Sabbath" is asking what SCRIPTURE says, not what the user's
// own notes say) and, being a hard router (see runLookup), sent it down the notes-only path with
// zero verses instead of the real answer. Every remaining alternative below names "note(s)"
// explicitly or is an unambiguous first-person writing verb, so this is now a genuine notes-ask
// signal rather than a generic "X was written" phrasing that any scripture question could trip.
// This is still a HINT, not a hard router — see runLookup: if it fires but the notes search
// itself comes back empty, the question falls through to the normal scripture pipeline instead
// of returning a dead end (a wrong hint degrades to "keep going" rather than "zero results").
const NOTE_ASK_TRIGGER = /\b(?:my\s+notes?|notes?\s+(?:have|has)\s+i|did\s+i\s+write|have\s+i\s+written|what\s+notes?|show\s+me\s+my\s+notes?|find\s+my\s+notes?|search\s+my\s+notes?)\b/i

// "Find me a video about X" / "do you have a video on X" / "any videos about X" — an explicit
// ask to search the LOCAL, already-synced YouTube library (allowlisted channels only — see
// CLAUDE.md §12; this deliberately never searches live/all of YouTube). Local, pre-LLM, same
// zero-latency deterministic pattern as the note/quote classifiers above. Also a HINT, not a hard
// router (see runLookup) — a bare mention of "youtube" elsewhere in an otherwise scriptural
// question, or a video-shaped phrasing that just doesn't match anything in the synced library,
// falls through to the normal scripture pipeline instead of dead-ending on zero results.
const YOUTUBE_VIDEO_TRIGGER = /\b(?:find|show|got|have)\b.{0,15}\bvideos?\b|\bvideos?\b.{0,15}\b(?:about|on|regarding|covering|for)\b|\bany\s+videos?\b|\byoutube\b/i

/** Pulls the search topic out of a video-request question — prefers whatever follows "about"/
 *  "on"/"regarding"/"covering"/"for" (the most common real phrasing), falling back to the whole
 *  question with the trigger words themselves stripped out. Best-effort, not exhaustive parsing
 *  — searchYoutubeVideos's own fuzzy/token fallback covers the rest. */
function extractVideoSearchQuery(question: string): string {
  const m = question.match(/\bvideos?\b\s*(?:about|on|regarding|covering|for)\s+(.+)/i)
  if (m) return m[1].replace(/[?.!]+$/, '').trim()
  return question
    .replace(/\b(?:find|show|got|have|any|do\s+you\s+have|me\s+a?|a\s+)\b/gi, ' ')
    .replace(/\bvideos?\b/gi, ' ')
    .replace(/\byoutube\b/gi, ' ')
    .replace(/[?.!]+$/, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Merges a title/channel-name match list (searchYoutubeVideos) with a transcript-content match
 *  list (searchYoutubeTranscripts) into one ranked AiLookupVideoResult[] — the whole reason a
 *  question like "which video talks about the feast days" can find anything at all now, since a
 *  title-only search finds nothing unless the topic happens to be in the video's title (Round
 *  11's original gap this closes). Neither list is treated as strictly better than the other: a
 *  title match is a stronger, more deliberate signal (the creator chose to name the topic), but
 *  a transcript match is real evidence of on-topic CONTENT the title never mentions — so results
 *  are interleaved (title, transcript, title, transcript, ...) rather than one list exhausted
 *  before the other, and deduped by videoId, keeping whichever occurrence came first (a title
 *  match, if the same video appears in both — it's the more specific citation of the two, having
 *  no `startMs`/`snippet` is a fair trade for "the title itself already tells you why it's
 *  relevant"). Exported for unit testing — this is the one piece of real ranking logic in an
 *  otherwise-mechanical DB-query pairing. */
export function mergeVideoSearchResults(
  titleMatches: YoutubeVideoSearchResult[],
  transcriptMatches: YoutubeTranscriptSearchResult[],
  limit = 8,
): AiLookupVideoResult[] {
  const out: AiLookupVideoResult[] = []
  const seen = new Set<string>()
  const titleAsResult = (v: YoutubeVideoSearchResult): AiLookupVideoResult =>
    ({ videoId: v.videoId, title: v.title, channelName: v.channelName, thumbnailUrl: v.thumbnailUrl })
  const transcriptAsResult = (v: YoutubeTranscriptSearchResult): AiLookupVideoResult =>
    ({ videoId: v.videoId, title: v.title, channelName: v.channelName, thumbnailUrl: v.thumbnailUrl, startMs: v.startMs, snippet: v.snippet })
  let ti = 0
  let ci = 0
  while (out.length < limit && (ti < titleMatches.length || ci < transcriptMatches.length)) {
    if (ti < titleMatches.length) {
      const v = titleMatches[ti++]
      if (!seen.has(v.videoId)) { seen.add(v.videoId); out.push(titleAsResult(v)) }
    }
    if (out.length >= limit) break
    if (ci < transcriptMatches.length) {
      const v = transcriptMatches[ci++]
      if (!seen.has(v.videoId)) { seen.add(v.videoId); out.push(transcriptAsResult(v)) }
    }
  }
  return out
}

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
/** Same word-by-word scan as findReferenceInText below, generalized to collect EVERY
 *  reference-shaped match in the text instead of stopping at the first — used by
 *  verifyGeneratedReferences (Round 13, defect #6a) to pull every scripture reference the model's
 *  free-text summary/commentary claims to cite, so each one can be checked against what was
 *  actually retrieved before ever reaching the user. Deduped by resolved book/chapter/verse. */
function findAllReferencesInText(text: string): ParsedRef[] {
  const tokens = text.split(/\s+/)
  const out: ParsedRef[] = []
  const seen = new Set<string>()
  for (let i = 0; i < tokens.length; i++) {
    const numMatch = tokens[i].match(CHAPTER_VERSE_TOKEN_RE)
    if (!numMatch) continue
    let foundForThisToken = false
    for (const windowLen of [1, 2, 3]) {
      if (foundForThisToken) break
      const start = i - windowLen
      if (start < 0) break
      const bookToken = tokens.slice(start, i).join(' ').replace(/[^\w\s]/g, '').trim()
      const candidates = [bookToken]
      if (start > 0) {
        const lead = tokens[start - 1].replace(/[^\w]/g, '')
        if (/^(?:[1-3]|I{1,3})$/i.test(lead)) candidates.unshift(`${lead} ${bookToken}`)
      }
      for (const cand of candidates) {
        if (!cand || !isExactBookToken(cand)) continue
        const candidateRef = `${cand} ${numMatch[1]}${numMatch[2] ? `:${numMatch[2]}${numMatch[3] ? `-${numMatch[3]}` : ''}` : ''}`
        const parsed = parseRef(candidateRef)
        if (parsed) {
          const key = `${parsed.bookId}|${parsed.chapter}|${parsed.verse ?? ''}`
          if (!seen.has(key)) { seen.add(key); out.push(parsed) }
          foundForThisToken = true
          break
        }
      }
    }
  }
  return out
}

function findReferenceInText(question: string): ParsedRef | null {
  return findAllReferencesInText(question)[0] ?? null
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
async function maybeAddCommentary(response: AiLookupResponse, question: string, opts: { commentary: boolean; model?: string }, emitPartial: EmitPartial = () => {}): Promise<AiLookupResponse> {
  if (!opts.commentary) return response
  const primary = response.results.filter((r) => r.source !== 'cross-ref')
  if (primary.length === 0) return response
  // Speed round: same "show real results before the slow Commentary call" fix as the main
  // pipeline's own emitPartial — a bareRef/quote-lookup answer is ALREADY fully resolved at this
  // point, Commentary is the only thing left, and it's a full extra Ollama call.
  emitPartial(response)
  try {
    const model = opts.model || DEFAULT_OLLAMA_MODEL
    // Token budgeting — a whole-chapter reverse-quote lookup (see runQuoteLookup) can produce far
    // more than a handful of primary results, well past commentaryPrompt's own internal 12-verse
    // slice; budgeting first (same priority order as the main pipeline, just with no history/tab
    // context of its own here) keeps this call inside NUM_CTX the same way the main commentary
    // call is budgeted below.
    const promptVerses = budgetCommentaryCandidates(question, primary, '', null, null, [])
    const raw = await runOllamaJson<{ perVerse?: Record<string, string>; irrelevant?: string[]; summary?: string }>(
      commentaryPrompt(question, promptVerses), model
    )
    for (const r of primary) {
      const key = `${r.bookId} ${r.chapter}:${r.verse}`
      // Round 13: drop (not just leave unshown) a per-verse caption whose own text makes a
      // reference or quote claim that doesn't check out against the real candidates — see
      // verifyGeneratedText. A caption is short and single-purpose enough that a failed check
      // means dropping it entirely costs little, unlike the summary (see the caveat approach
      // below) where there's real grounded content worth keeping alongside the flag.
      const caption = raw.perVerse?.[key]
      if (caption) {
        const check = verifyGeneratedText(caption, primary)
        if (check.unverifiedRefs.length === 0 && check.unverifiedQuotes.length === 0) r.commentary = caption
      }
    }
    const summaryCheck = verifyGeneratedText(raw.summary ?? '', primary)
    return { ...response, summary: appendVerificationCaveat(raw.summary, summaryCheck) ?? response.summary }
  } catch {
    return response
  }
}

/** Builds the deterministic answer for a question that IS just a scripture reference (see the
 *  bareRef check in runLookup above) — a single verse, a verse range, a whole chapter, or a
 *  chapter range, always against DEFAULT_TEXT_ID (kjva) since a bare reference has no way to name
 *  a different text. Real, DB-verified text only; returns null (not an empty response) when the
 *  parsed reference doesn't resolve to any real verse, so the caller can fall through to the
 *  normal pipeline instead of dead-ending on e.g. a chapter number past the book's real end.
 *  `mergeAdjacent` folds a verse range or whole chapter into one displayed block, exactly like
 *  every other multi-verse result elsewhere in this file. */
function buildBareReferenceResponse(ref: ParsedRef): AiLookupResponse | null {
  const bookId = ref.bookId
  const rows: AiLookupResult[] = []
  const endChapter = ref.endChapter ?? ref.chapter
  for (let ch = ref.chapter; ch <= endChapter; ch++) {
    // A verse (or verse range) is only ever given together with a SINGLE chapter (parseRef never
    // produces both endChapter and verse/endVerse at once — see its own grammar) — safe to reuse
    // ref.verse/ref.endVerse unconditionally inside this loop for that reason.
    const startV = ref.verse ?? 1
    let endV = ref.endVerse ?? ref.verse
    if (endV == null) {
      const db = getTextDb(DEFAULT_TEXT_ID)
      const maxRow = db?.prepare('SELECT MAX(verse_num) as m FROM verses WHERE book_id = ? AND chapter = ?').get(bookId, ch) as { m: number | null } | undefined
      if (!maxRow?.m) continue
      endV = maxRow.m
    }
    for (let v = startV; v <= endV; v++) {
      const verse = queryVerse(bookId, ch, v, DEFAULT_TEXT_ID)
      if (!verse) continue
      rows.push({
        textId: DEFAULT_TEXT_ID, bookId, bookName: bookNameFor(bookId, DEFAULT_TEXT_ID),
        chapter: ch, verse: v, text: verse.text, source: 'ai-guess',
      })
    }
  }
  if (rows.length === 0) return null
  const results = mergeAdjacent(rows)
  const refLabel = `${bookNameFor(bookId, DEFAULT_TEXT_ID)} ${ref.chapter}` +
    (ref.verse ? `:${ref.verse}${ref.endVerse && ref.endVerse !== ref.verse ? `-${ref.endVerse}` : ''}` : '') +
    (ref.endChapter && ref.endChapter !== ref.chapter ? `-${ref.endChapter}` : '')
  return {
    results, visibleCount: results.length, keywords: [], related: [],
    summary: `${refLabel} — real KJV text, not an AI guess.`,
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

    // Round 12 fix: this used to emit EVERY verse of the chapter that had even one loose
    // cross-reference hit, in plain verse order, uncapped — a long/densely cross-referenced
    // chapter (Matthew 24 has 51 verses, each capped at up to MAX_CROSS_REFS=12 nested hits)
    // could balloon to 400-500+ total results, which is both slow to render and buries the
    // verse with the strongest, most genuine quotation signal deep in verse-number order rather
    // than up front. The summary text already promised "ranked by vote/quotation signal" —
    // gathering every verse's hit count FIRST and sorting by it (most cross-referenced/quoted
    // verse first, ties broken by verse order) makes that literally true, and capping the whole-
    // chapter scope to the strongest WHOLE_CHAPTER_QUOTE_CAP verses keeps the answer focused on
    // real signal instead of dumping the entire chapter.
    const perVerseHits: Array<{ v: number; seedText: string; hits: AiLookupResult[] }> = []
    for (let v = 1; v <= maxVerse; v++) {
      const hits = quoteRefsForVerse(bookId, chapter, v, direction, seen)
      if (hits.length === 0) continue
      const seedVerse = queryVerse(bookId, chapter, v, DEFAULT_TEXT_ID)
      if (!seedVerse) continue
      perVerseHits.push({ v, seedText: seedVerse.text, hits })
    }
    perVerseHits.sort((a, b) => b.hits.length - a.hits.length || a.v - b.v)
    const kept = perVerseHits.slice(0, WHOLE_CHAPTER_QUOTE_CAP)
    const hitVerseCount = perVerseHits.length

    const results: AiLookupResult[] = []
    for (const { v, seedText, hits } of kept) {
      results.push({
        textId: DEFAULT_TEXT_ID, bookId, bookName: bookNameFor(bookId, DEFAULT_TEXT_ID),
        chapter, verse: v, text: seedText, source: 'quote-source',
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
        ? `Real ${direction === 'reverse' ? 'incoming quotations of' : 'outgoing quotations from'} ${bookNameFor(bookId, DEFAULT_TEXT_ID)} ${chapter} — ${kept.length} verse${kept.length === 1 ? '' : 's'} shown${hitVerseCount > kept.length ? ` (strongest ${kept.length} of ${hitVerseCount} with a match)` : ''}, ranked by vote/quotation signal, not an AI guess.`
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
  opts: { commentary: boolean; agentic?: boolean; model?: string; textId?: string; wordReplacerRules?: WordReplacerRuleLite[]; history?: ChatHistoryTurn[]; tabContext?: AiLookupTabContextRef },
  emit: Emit = () => {},
  emitPartial: EmitPartial = () => {},
): Promise<AiLookupResponse> {
  const model = opts.model || DEFAULT_OLLAMA_MODEL
  const wordReplacerRules = opts.wordReplacerRules ?? []
  // Last few turns only — enough for a natural follow-up to resolve against without letting
  // prompt size grow unbounded over a long chat.
  let history = (opts.history ?? []).slice(-4)
  let tabContextBlock = buildTabContextBlock(opts.tabContext)

  // Text-focused search: a question naming a specific work (e.g. "in Jubilees...") searches
  // that text FIRST, then falls back to also searching the default (kjva). Computed before the
  // extraction call since the prompt itself needs to know (to invite a focus-text guess).
  const explicitFocus = opts.textId && opts.textId !== DEFAULT_TEXT_ID ? opts.textId : null
  const focusTextId = explicitFocus ?? detectFocusTextId(question)
  const focusWorkName = focusTextId ? singleBookWorkName(focusTextId) : null

  // Round 11: a canonical book named in the question ("in Matthew...") scopes canonical keyword
  // search to just that book — reuses detectBookInQuestion (also used for Strong's occurrence
  // scoping). Only matters for canonical: every non-canonical text is already single-book, so a
  // book constraint there is a no-op. Only applied when there's NO focus text (a focus-text
  // question searches that work's own book, which already IS single-book) — avoids ever
  // narrowing the deliberately-named non-canonical search down further by accident.
  const questionBookId = !focusTextId ? detectBookInQuestion(question) : null

  // A named testament/book-group ("old testament", "the gospels", "Paul's epistles", "the
  // prophets") scopes canonical keyword/semantic search the same way a single named book does —
  // only checked when no single (more precise) book was already found, and only for canonical
  // text (mirrors questionBookId's own reasoning: every non-canonical text is already single-book).
  const questionTestamentBookIds = !focusTextId && !questionBookId ? detectTestamentInQuestion(question) : null

  // See buildEffectiveQuestion's own comment — recovers the real topic for a bare scope-only
  // follow-up ("its in the old testament") from the previous turn, used only for extraction/
  // semantic search below; `question` itself is left untouched everywhere else (labeling, other
  // detections, etc.).
  const effectiveQuestion = questionTestamentBookIds ? buildEffectiveQuestion(question, history) : question

  // Round 12: the canonical counterpart to the focus-text chapter pin below — see
  // detectExplicitCanonicalChapter's own comment for the bug this fixes. Computed once, up here,
  // so both the notes search (immediately below) and the main verse pipeline further down reuse
  // the same detection rather than re-deriving it.
  const pinnedCanonicalChapter = questionBookId ? detectExplicitCanonicalChapter(question, questionBookId) : null

  // "What notes have I written about X" — a real signal that notes are RELEVANT, no longer a
  // guarantee they're the WHOLE answer. Checked before the extraction call since it's entirely
  // deterministic (no Ollama call) either way. Round 13 fixed the "wrong hint dead-ends on zero
  // results" failure; item #2 of this round fixes a related but distinct problem: even when the
  // hint is RIGHT and a real note is found, the question may ALSO have a real scripture answer —
  // the old code returned here unconditionally once any note was found, silently discarding that
  // scripture answer. Now this only ever COLLECTS the note results and keeps going into the full
  // scripture pipeline below; whether notes end up LEADING the final answer (hiding the verse
  // section) is decided once real evidence exists — see decideNotesAreLead, used near the end of
  // this function, after the plan and critique have both had a chance to weigh in.
  const explicitNoteAsk = NOTE_ASK_TRIGGER.test(question)
  let explicitNoteResults: AiLookupNoteResult[] = []
  if (explicitNoteAsk) {
    emit('Searching your notes…')
    explicitNoteResults = searchNotesExplicit(question, 8, questionBookId, pinnedCanonicalChapter)
  }

  // "Find me a video about X" — same "collect, don't short-circuit" change as the notes trigger
  // just above, and for the identical reason: a video-shaped question can still have a real
  // scripture answer worth showing alongside it. Entirely deterministic search, no Ollama call.
  const explicitVideoAsk = YOUTUBE_VIDEO_TRIGGER.test(question)
  let explicitVideoResults: AiLookupVideoResult[] = []
  if (explicitVideoAsk) {
    emit('Searching your YouTube library…')
    const query = extractVideoSearchQuery(question)
    // Title/channel-name matches (as before) PLUS transcript-content matches (new) — see
    // mergeVideoSearchResults for why neither alone is enough: a topic can be genuinely
    // covered by a video without ever appearing in that video's title.
    const titleMatches: YoutubeVideoSearchResult[] = query ? searchYoutubeVideos(query, 8) : []
    const transcriptMatches: YoutubeTranscriptSearchResult[] = query ? searchYoutubeTranscripts(query, 8) : []
    explicitVideoResults = mergeVideoSearchResults(titleMatches, transcriptMatches, 8)
  }

  // Any early-out below this point (Ollama unavailable, extraction failed, no candidates found)
  // still carries whatever real notes/videos were already found above — item #2's whole point is
  // that a note/video hit should never cost the user a scripture answer, but the reverse holds
  // too: a scripture-side failure must never cost the user a note/video answer that WAS found.
  // No model signal exists yet at any of these early-out points (Ollama is unavailable or never
  // got a chance to run), so decideNotesAreLead falls back to its no-signal heuristic — see its
  // own comment for what that means.
  const empty = (error?: string): AiLookupResponse => ({
    results: [], visibleCount: 0, keywords: [], related: [], error,
    notes: explicitNoteResults.length > 0 ? explicitNoteResults : undefined,
    videos: explicitVideoResults.length > 0 ? explicitVideoResults : undefined,
    notesAreThePrimaryAnswer: decideNotesAreLead({
      explicitNoteAsk, noteResultsCount: explicitNoteResults.length, hasVerseEvidence: false,
    }),
  })

  // Bare reference short-circuit ("Deut 6:4", "John 3:16", "1 Corinthians 13:4-7",
  // "Exodus 20") — a question that IS just a scripture reference and nothing else should return
  // that exact real text instantly, no Ollama call, no keyword search. `parseRef`'s own contract
  // (see its file comment) already requires the ENTIRE input to be just a reference — reused
  // here as exactly the "is this question NOTHING BUT a reference" test needed to avoid
  // hijacking a question that merely CONTAINS one amid other words ("what does John 1:1 quote"
  // still correctly falls through to QUOTE_TRIGGER below; parseRef on that whole string fails).
  //
  // Root-cause fix (Team B, found via ref-deut64/ref-john316/ref-1cor13-range): before this,
  // the ONLY deterministic reference handling was (a) QUOTE_TRIGGER, which requires a trigger
  // word like "quote" and never fires for a bare reference at all, and (b) the canonical-chapter
  // pin further below (detectExplicitCanonicalChapter), which has two separate gaps this closes:
  // it only recognizes book names/short_names literally present in kjva.db's `books` table — an
  // extremely common abbreviation like "Deut" isn't a `books` short_name (only "Deu" is), so
  // "Deut 6:4" resolved NO book at all and returned zero results — while `parseRef`'s own book
  // table (src/lib/parseRef.ts) already lists "deut" as a recognized pattern for exactly this
  // reason; and even when the book DID resolve, that pin only ever anchors at verse 1 of the
  // named chapter (it exists to seed a whole-chapter search, not answer "what does verse N say"),
  // so "John 3:16" and "1 Corinthians 13:4-7" resolved the right CHAPTER but always returned
  // verse 1 of it — never the actual verse asked for.
  const bareRef = parseRef(question.trim())
  if (bareRef) {
    const bareResponse = buildBareReferenceResponse(bareRef)
    if (bareResponse) return await maybeAddCommentary(bareResponse, question, opts, emitPartial)
    // Parsed but didn't resolve to any real verse (e.g. a chapter number past the book's real
    // end) — fall through to the normal pipeline rather than dead-ending on a bad parse.
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
      if (quoteResponse) return await maybeAddCommentary(quoteResponse, question, opts, emitPartial)
      // seedRef parsed but didn't resolve to a real verse (out-of-range chapter etc) — fall
      // through to the normal pipeline rather than dead-ending on a bad parse.
    }
  }

  emit(pick(READING_MESSAGES))
  const { available } = await checkOllamaAvailable()
  if (!available) return empty('ollama-unavailable')

  // Token budgeting (see electron/tokenBudget.ts) — trims oldest history turns first, then the
  // tail of the tab-context block (which, for a pinned Bible chapter, IS the "tail of the pinned
  // chapter" the caller cares about — buildTabContextBlock's 'bible' branch embeds the whole
  // chapter directly into this string), so the extraction call can never silently overflow
  // NUM_CTX. Rebinds `history`/`tabContextBlock` themselves so the SAME trimmed versions are
  // what the final commentary call sees too, later in this function — the priority order is
  // "settle history and tab context once, up front," not "re-decide it per call."
  ;({ history, tabContextBlock } = budgetForExtraction(question, focusWorkName, history, tabContextBlock))

  let extraction: AiExtraction
  try {
    extraction = await runOllamaJson<AiExtraction>(extractionPrompt(effectiveQuestion, focusWorkName, history, tabContextBlock), model)
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
  let strongsNums = [...detectStrongsNumbers(question), ...(extraction.strongsNum ? [extraction.strongsNum.trim().toUpperCase()] : [])]
  // Team B item 2c — the gloss bridge: a genuine "what does the Hebrew/Greek word for X mean"
  // question has no explicit number and can't always rely on the model's own strongsNum guess
  // (see WORD_MEANING_TRIGGER/bridgeKeywordToStrongsNum above). Only tried when nothing else
  // already supplied a number — this never overrides an explicit or model-proposed one, only
  // fills the gap when both are silent. `lang` narrows to whichever language the question itself
  // names, if any.
  if (strongsNums.length === 0 && WORD_MEANING_TRIGGER.test(question)) {
    const lang: 'H' | 'G' | 'all' = /\bhebrew\b/i.test(question) ? 'H' : /\bgreek\b/i.test(question) ? 'G' : 'all'
    // Tier 1 (transliteration) tried across EVERY keyword before tier 2 (gloss) is tried for
    // ANY of them — a transliteration hit is a much stronger signal than a gloss hit (see the
    // two functions' own comments), so a later keyword's exact transliteration match must win
    // over an earlier keyword's merely-plausible gloss coincidence. Confirmed as a real failure
    // otherwise: keywords ["torah","law"] committed to "torah"'s gloss-tier fallback (no
    // transliteration hit — H8451's actual transliteration is "tôwrâh", not the popular English
    // spelling) before ever trying "law", which — via transliteration — resolves nowhere either,
    // so it would have fallen to gloss too; the real problem this ordering fixes is broader: ANY
    // later keyword's transliteration hit must outrank an earlier keyword's gloss guess.
    let bridged: string | null = null
    for (const kw of keywords) { bridged = bridgeByTransliteration(kw, lang); if (bridged) break }
    if (!bridged) for (const kw of keywords) { bridged = bridgeByGloss(kw, lang); if (bridged) break }
    if (bridged) strongsNums = [bridged]
  }
  const strongsSeed = strongsNums.length > 0
    ? resolveStrongsNumbers(strongsNums, seen, bookNameFor, STRONGS_OCCURRENCES_REQUESTED_RE.test(question), detectBookInQuestion(question), detectRequestedCount(question))
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

  // Chapters a guess (or a deterministic pin — see below) named, per text — corroborating
  // evidence for step 5's ranking (see the ChapterHint/"Lever A" comment above scoreCandidates).
  // Hoisted up here (was declared just before the AI-guess loop) so both chapter-pin blocks below
  // can register a chapter into it directly, not just the guess loop further down.
  const guessChaptersByText = new Map<string, Set<number>>()

  // Round 11: deterministic chapter pin (see detectExplicitFocusChapter) — added BEFORE the AI
  // guess loop below, deliberately, so it claims the chapter's dedup key first: `add()`'s dedup
  // is keyed on exact chapter:verse only (not endVerse), so if the model's own guess loop ran
  // FIRST and added a narrower single-verse guess for the same chapter (e.g. just verse 1), this
  // wider, real, DB-verified whole-chapter pin would silently be dropped as a "duplicate" of a
  // strictly worse entry — confirmed directly: this is exactly what happened before reordering.
  // Real, DB-verified text, so it flows through the exact same ranking/commentary machinery as
  // any other guess, just guaranteed present regardless of extraction reliability. Capped at 60
  // verses as a sane backstop against a pathological chapter length — real pseudepigrapha
  // chapters are typically well under that.
  if (focusTextId && focusWorkName) {
    const pinnedChapter = detectExplicitFocusChapter(question, focusWorkName)
    if (pinnedChapter != null) {
      const pinDb = getTextDb(focusTextId)
      const pinBookId = resolveBookId(focusWorkName, focusTextId)
      if (pinDb && pinBookId) {
        const maxRow = pinDb.prepare('SELECT MAX(verse_num) as m FROM verses WHERE book_id = ? AND chapter = ?').get(pinBookId, pinnedChapter) as { m: number | null } | undefined
        if (maxRow?.m) {
          const endV = Math.min(maxRow.m, 60)
          const parts: string[] = []
          // Verse numbers are prefixed inline (not just plain concatenated text) — found via
          // testing: without them, the commentary model tends to anchor on whichever verse it
          // saw LAST (e.g. the "get thee up" instruction near the chapter's end) rather than the
          // actually-relevant one earlier in the same chapter (e.g. the idol-burning at 12:12),
          // even though both are present in the same blob. Explicit verse numbers give it a real
          // handle to cite/reason about specific verses instead of treating the whole chapter as
          // one undifferentiated block.
          for (let v = 1; v <= endV; v++) {
            const verse = queryVerse(pinBookId, pinnedChapter, v, focusTextId)
            if (verse) parts.push(`[${pinnedChapter}:${v}] ${verse.text}`)
          }
          if (parts.length > 0) {
            add(guessCandidates, focusTextId, { book_id: pinBookId, chapter: pinnedChapter, verse_num: 1, verse_end: endV > 1 ? endV : undefined, text: parts.join(' ') }, 'ai-guess')
          }
        }
      }
    }
  }

  // Round 12: the canonical counterpart to the pin above — fixes the reported bug where a
  // follow-up question naming a canonical book+chapter ("where in Deuteronomy 32 does it talk
  // about it") got results scoped to neither, because the pin above only ever fires when
  // focusTextId is set, which detectFocusTextId never sets for an ordinary Bible book (only for
  // non-canonical works — see TEXT_ALIASES). `questionBookId` already re-resolves fresh on every
  // call including follow-ups (detectBookInQuestion just scans the raw question string), so this
  // works the same on turn 1 or a mid-chat follow-up. Deliberately does NOT gate on `focusTextId`
  // being unset a second time — `questionBookId` is already only ever computed when there's no
  // focus text (see its own definition above), so the two are mutually exclusive by construction.
  // Registers the pinned chapter into guessChaptersByText unconditionally (not gated behind a
  // keywordOverlapScore check the way the AI-guess loop's own registration below is) — this
  // chapter isn't a recalled guess that might be wrong, it's the literal chapter number the user
  // typed, resolved against the real DB, so it doesn't need to earn trust the same way.
  if (questionBookId && pinnedCanonicalChapter != null) {
    const pinDb = getTextDb(DEFAULT_TEXT_ID)
    if (pinDb) {
      const maxRow = pinDb.prepare('SELECT MAX(verse_num) as m FROM verses WHERE book_id = ? AND chapter = ?').get(questionBookId, pinnedCanonicalChapter) as { m: number | null } | undefined
      if (maxRow?.m) {
        const endV = Math.min(maxRow.m, 60)
        const parts: string[] = []
        for (let v = 1; v <= endV; v++) {
          const verse = queryVerse(questionBookId, pinnedCanonicalChapter, v, DEFAULT_TEXT_ID)
          if (verse) parts.push(`[${pinnedCanonicalChapter}:${v}] ${verse.text}`)
        }
        if (parts.length > 0) {
          add(guessCandidates, DEFAULT_TEXT_ID, { book_id: questionBookId, chapter: pinnedCanonicalChapter, verse_num: 1, verse_end: endV > 1 ? endV : undefined, text: parts.join(' ') }, 'ai-guess')
          if (!guessChaptersByText.has(DEFAULT_TEXT_ID)) guessChaptersByText.set(DEFAULT_TEXT_ID, new Set())
          guessChaptersByText.get(DEFAULT_TEXT_ID)!.add(pinnedCanonicalChapter)
        }
      }
    }
  }

  // 1. AI direct guesses — a small, fixed budget that can never be starved out by the much
  // larger keyword pool. Allowed against every text in textPasses (Jubilees/Enoch/etc each have
  // a single-book `books` table with ordinary chapter:verse numbering, so a guess resolves the
  // same way a canonical guess does) — resolveBookId naturally only resolves a guess against the
  // text whose own book map actually contains that name, so a "Genesis" guess never matches
  // jubilees.db and vice versa, and a "Jubilees" guess never matches kjva.db.
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
      // automatically.
      // Round 12: no longer restricted to non-canonical texts. Before, a canonical guess never
      // registered here at all — "a canonical guess is already reliable enough to lead outright
      // without needing this extra lever" was true for WHETHER a guess leads, but it left a real
      // gap on the SCORING side: a canonical keyword hit sitting in the exact chapter the model
      // (or, now, the deterministic pin above) already confirmed got no corroboration boost the
      // way a non-canonical one would, so it couldn't out-rank an unrelated but higher-scoring
      // keyword coincidence elsewhere in the canon on a topical/follow-up question. Still gated on
      // real keyword evidence either way, same as the non-canonical case always was, so a wrong/
      // ungrounded canonical guess still can't self-reinforce on nothing but its own chapter
      // number. `opportunistic` (strict archaic-vocab gating) matches whichever branch this
      // guess's text is actually competing in — see the scoreCandidates comment above.
      if (keywordOverlapScore(resolvedText, keywords, wordReplacerRules, textId, !focusTextId) > 0) {
        if (!guessChaptersByText.has(textId)) guessChaptersByText.set(textId, new Set())
        guessChaptersByText.get(textId)!.add(g.chapter)
      }
    }
  }

  // 2. Keyword search via FTS5 — pulled into a closure so the agentic retry (step 2b) can
  // re-run it with a refined keyword list without duplicating this logic. Phrase mode first
  // for every keyword (and every word-replacer variant of it, e.g. "Yeshua" also tries
  // "Jesus" — see getWordReplacerVariants); the loose 'all'-mode (independent prefix-wildcard
  // AND) fallback kicks in PER KEYWORD, independently, when THAT keyword's own phrase search
  // came back empty — not gated on every other keyword also having zero phrase hits. An
  // earlier version gated the fallback on ALL keywords being empty (an all-or-nothing
  // `anyPhraseHits` guard) specifically to avoid flooding the pool with generic-word 'all'-mode
  // noise once one keyword already had real phrase hits — but that meant a genuinely different,
  // specific keyword (e.g. an archaic-translation phrase with zero literal hits) silently never
  // got its own fallback just because an unrelated keyword in the same set happened to match
  // something. Confirmed as a real miss: a 3-keyword set where only the least-relevant keyword
  // had phrase hits suppressed fallback for the other two, which were the ones that actually
  // would have found the right verse. The generic-word-noise risk this guard existed for is now
  // covered by OVERLY_GENERIC_SINGLE_WORDS/OVERLY_GENERIC_IN_FOCUS_TEXT filtering (added later,
  // applied above via filterGenericKeywords) plus the existing per-keyword 6-row slice and
  // overall CANDIDATE_POOL_CAP, so the all-or-nothing gate is no longer needed to contain it.
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
      // Round 11: a book named in the question scopes canonical search to it — reuses the same
      // book-list scoping searchVerses already supports for the regular scripture-search UI
      // (electron/ipc/bible.ts), just never threaded through from here before. A named testament/
      // book-group (questionTestamentBookIds) gets the same treatment when no single book won.
      const bookScope = CANONICAL_TEXT_IDS.has(textId)
        ? (questionBookId ? [questionBookId] : questionTestamentBookIds ?? undefined)
        : undefined
      // Round 12: a chapter named alongside that book (see pinnedCanonicalChapter) narrows the
      // FTS keyword search itself down to just that chapter — not just the pinned candidate added
      // separately above — so keyword-sourced results for the SAME question also stay confined to
      // it, rather than backfilling with keyword hits from other chapters of the same book. Only
      // meaningful together with bookScope (searchVerses ignores a bare chapter with no book
      // scope — see its own comment), so this is naturally undefined whenever bookScope is.
      const chapterScope = bookScope && pinnedCanonicalChapter != null ? pinnedCanonicalChapter : undefined
      // Strict (rarity-gated) archaic-vocab variants when this text is only being searched
      // opportunistically (unfocused — see the getArchaicVariants/keywordOverlapScore comments).
      const phraseResults = kwsForText.map((kw) => {
        const variants = [
          ...getWordReplacerVariants(kw, wordReplacerRules),
          ...getArchaicVariants(kw, textId, !focusTextId),
        ]
        const rows = variants.flatMap((v) => searchVerses(v, textId, 'phrase', bookScope, chapterScope))
        return { variants, rows }
      })
      for (const { variants, rows } of phraseResults) {
        if (out.length >= CANDIDATE_POOL_CAP) break
        const finalRows = rows.length > 0 ? rows : variants.flatMap((v) => searchVerses(v, textId, 'all', bookScope, chapterScope))
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

  // 2c. TSKE heading search (Team C) — a genuinely different SOURCE of candidates, not a
  // rescoring of what keyword search already found: a topical question can match TSKE's own
  // curated heading text even when the target verse shares no literal words with the question at
  // all. Runs regardless of whether guesses/keyword search found anything, since it doesn't
  // depend on either — see searchTskeHeadingCandidates's own comment. Added to guessCandidates
  // (not keywordCandidates) deliberately: scoreCandidates only applies its keyword-overlap
  // relevance FLOOR to `source === 'keyword'` items (see its filter) — a TSKE-sourced candidate
  // is real, human-curated evidence in its own right and shouldn't need to ALSO clear a literal-
  // overlap bar that its whole reason for existing is to bypass.
  for (const c of searchTskeHeadingCandidates(keywords)) {
    const key = dedupeKey(c)
    if (seen.has(key)) continue
    seen.add(key)
    guessCandidates.push(c)
  }

  // 2d. Cross-reference seed-and-expand widening (Team C) — unlike 2c above, this DOES depend on
  // what's already been found: it only widens outward from a real, corroborated anchor (score >=
  // 2 — see selectCrossRefAnchors), never introduces a candidate out of nothing. Anchors are
  // picked from the RAW (pre-merge) guess/keyword pools, before mergeAdjacent below, since a
  // multi-verse merged range doesn't have one single (bookId,chapter,verse) to expand from.
  // `opportunistic` mirrors the same unfocused-vs-focused convention every other
  // keywordOverlapScore call site in this file already follows.
  const crossRefAnchors = selectCrossRefAnchors(
    [...guessCandidates, ...keywordCandidates], keywords, wordReplacerRules, !focusTextId,
  ).filter((c) => CANONICAL_TEXT_IDS.has(c.textId)) // cross_references.db is keyed to canonical book ids only
  for (const c of expandCrossRefNeighbors(crossRefAnchors)) {
    const key = dedupeKey(c)
    if (seen.has(key)) continue
    seen.add(key)
    guessCandidates.push(c)
  }

  // 2e. Semantic (embedding) candidates — a THIRD independent source, alongside 2c/2d above, for
  // the case those two still can't reach: a question phrased in wording that shares no literal
  // overlap with the verse text NOR with any curated TSKE heading (e.g. "anxiety" -> Matthew
  // 6:25's "take no thought", zero shared words either way). Embeds the question against a local
  // Ollama model and does a cosine-similarity scan over a pre-built index (see electron/
  // embeddings.ts) — genuinely best-effort: the index is a dev-machine build artifact that may
  // not exist yet (see scripts/build-embedding-index.js), and Ollama's embedding endpoint may be
  // unavailable, so gatherSemanticCandidates never throws, only ever returns []. Added to
  // guessCandidates for the same reason 2c/2d are — scoreCandidates' keyword-overlap floor only
  // applies to `source === 'keyword'` (see its filter), and a semantic hit's whole reason for
  // existing is to surface exactly the candidates that floor would otherwise reject.
  //
  // No feature-flag guard needed here (2c/2d, above, were temporarily guarded by an env var
  // during their own isolation testing — since removed, both are unconditional now too): this
  // feature already degrades to a no-op by construction whenever the index isn't built or
  // Ollama's embedding endpoint is unavailable (see gatherSemanticCandidates).
  {
    const semanticRefs = await gatherSemanticCandidates(effectiveQuestion, keywordCandidates.map(dedupeKey), seen, {
      restrictToTextId: focusTextId ?? undefined,
      restrictToBookIds: questionBookId ? [questionBookId] : questionTestamentBookIds ?? undefined,
    })
    for (const ref of semanticRefs) {
      const key = dedupeKey({ textId: ref.textId, bookId: ref.bookId, chapter: ref.chapter, verse: ref.verseNum })
      if (seen.has(key)) continue
      const verse = queryVerse(ref.bookId, ref.chapter, ref.verseNum, ref.textId)
      if (!verse) continue // index can drift from the real DB in theory (e.g. rebuilt text) — re-verify, never trust the index's own copy
      seen.add(key)
      guessCandidates.push({
        textId: ref.textId, bookId: ref.bookId, bookName: bookNameFor(ref.bookId, ref.textId),
        chapter: ref.chapter, verse: ref.verseNum, text: verse.text, source: 'semantic',
      })
    }
  }

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
    return { ...empty(), keywords, strongsCard: strongsSeed.card, summary: strongsSeed.note }
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
  // `requireSpecificEvidence=true` (Round 11): a guess must not be able to lead unconditionally
  // on nothing but a bare mention of a generic theme word — confirmed directly: the model
  // guessed 1 Samuel 15:23 ("stubbornness is as iniquity and idolatry") for a question about
  // Abraham leaving his family, and its only "evidence" was that bare word. Applies regardless
  // of canonical/non-canonical — an ungrounded guess in EITHER is equally suspect on this signal
  // alone. "Moses" (a proper noun, not in OVERLY_GENERIC_THEMATIC_WORDS) is unaffected, so the
  // Exodus 20 ten-commandments fix this same function exists for still works.
  function guessHasEvidence(g: AiLookupResult): boolean {
    if (keywordOverlapScore(g.text, keywords, wordReplacerRules, g.textId, false, true) > 0) return true
    const db = getTextDb(g.textId)
    if (!db) return false
    try {
      const rows = db.prepare('SELECT text FROM verses WHERE book_id = ? AND chapter = ?').all(g.bookId, g.chapter) as Array<{ text: string }>
      const wholeChapterText = rows.map((r) => r.text).join(' ')
      return keywordOverlapScore(wholeChapterText, keywords, wordReplacerRules, g.textId, false, true) > 0
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
    // Team C fix (found via harness regression, see report): TSKE/cross-ref-seed candidates are
    // NOT "the model's specific claim" the way an 'ai-guess' is — this structural-lead pathway
    // was built to trust a targeted guess that survives an evidence check, but a TSKE-heading
    // candidate is only IN the pool because its heading text already matched the keyword, which
    // means its own verse text very often ALSO contains that same literal word (that's not a
    // coincidence — it's the whole reason it matched). guessHasEvidence can't tell "the model
    // specifically named this verse" apart from "this verse happens to use the query word too",
    // so a TSKE/cross-ref-seed candidate would otherwise sail through the evidence bar on nothing
    // but a bare keyword coincidence and then jump the ENTIRE literal-keyword-scored pool
    // structurally — confirmed directly: a bare "love" query surfaced five TSKE-sourced "love"
    // verses ahead of every real keyword hit, pushing the fixture's actual expected verse out of
    // the visible top 6 entirely (rg-love-bare, th-love-neighbor). Routed into their own bucket
    // below (`widenGuesses`), kept OUT of `unevidencedGuesses`/`rest`'s scored pool entirely and
    // appended only after `rest` is fully ranked (see below) — not just excluded from the
    // structural evidence bar, since a scored TIE against a real keyword hit still let them win
    // on array-order (they're pushed into guessCandidates before searchKeywords runs, so an
    // equal-score tie-break by insertion index still favored them unfairly). Strictly last means
    // they can only ever fill room real evidence left empty — the "WIDEN, don't out-rank"
    // contract their own call-site comments (above, in runLookup) describe.
    const evidencedGuesses: AiLookupResult[] = []
    const unevidencedGuesses: AiLookupResult[] = []
    const widenGuesses: AiLookupResult[] = []
    for (const g of mergedGuesses) {
      if (g.source === 'tske' || g.source === 'cross-ref-seed') widenGuesses.push(g)
      else (g.source === 'ai-guess' && guessHasEvidence(g) ? evidencedGuesses : unevidencedGuesses).push(g)
    }
    candidates = scoreAndSort(evidencedGuesses, 0, true).slice(0, TOTAL_PRIMARY_CAP)
    if (candidates.length < TOTAL_PRIMARY_CAP) {
      let rest = scoreAndSort([...unevidencedGuesses, ...mergedKeywords], 1, true, 2)
      // Round 13 fallback: canonicalMinKeywordScore=2 is a real corroboration requirement, well
      // justified for a canonical candidate that's actively COMPETING against a non-canonical one
      // on a tie (see that constant's own long comment — a bare "idolatry" hit in an unrelated
      // Pauline epistle should not beat Jubilees' one genuine on-topic match). It was never meant
      // to mean "the primary canon may show ZERO results" — but that's exactly what it did for a
      // single-keyword question with nothing else to corroborate against (a bare "love" match can
      // only ever score 1, since a common word by definition never earns the rarity bonus — see
      // keywordOverlapScore — so it structurally can never reach 2 no matter how the keyword got
      // here). Reported directly: "what does the Bible say about love" returning nothing from the
      // KJV at all, only an unrelated non-canonical hit. If the strict pass left canonical
      // completely empty despite real canonical keyword candidates existing, relax JUST canonical
      // back to the ordinary floor (1, same bar non-canonical already clears) as a fallback — every
      // case where at least one canonical candidate already cleared 2 is completely unaffected by
      // this, since `rest` already has canonical results and the fallback never runs.
      if (!rest.some((c) => CANONICAL_TEXT_IDS.has(c.textId))) {
        const canonicalOnly = mergedKeywords.filter((c) => CANONICAL_TEXT_IDS.has(c.textId))
        if (canonicalOnly.length > 0) {
          const relaxed = scoreAndSort(canonicalOnly, 1, true)
          // Simple concatenation, not another mergeAdjacent pass: `rest` has zero canonical items
          // in this branch by construction (that's the condition that got us here), so there's
          // nothing canonical in it to interleave with — mergeAdjacent operates on raw
          // pre-scored candidates, not on two already-scored/sorted result lists.
          if (relaxed.length > 0) rest = [...rest, ...relaxed]
        }
      }
      const room = TOTAL_PRIMARY_CAP - candidates.length
      candidates = [...candidates, ...rest.slice(0, room)]
    }
    // TSKE/cross-ref-seed widening — appended strictly LAST, after every real guess/keyword
    // candidate has already claimed its slot, and ranked only among each other (never re-mixed
    // into `rest`'s own scoring pass) — see the widenGuesses comment above for why. Only fills
    // genuinely leftover room; a question with 6 real results never shows one of these at all.
    if (candidates.length < TOTAL_PRIMARY_CAP && widenGuesses.length > 0) {
      const widenScored = scoreAndSort(widenGuesses, 0, true)
      const room2 = TOTAL_PRIMARY_CAP - candidates.length
      candidates = [...candidates, ...widenScored.slice(0, room2)]
    }
  }

  // Strong's-sourced results get their own budget on top of the primary cap — an exact tag
  // match is the most trustworthy source this pipeline has (no LLM guess involved in the verse
  // list itself), so it's never crowded out by keyword/guess candidates competing for the same
  // slots. Always led first.
  if (strongsSeed.candidates.length > 0) {
    // Round 11: an explicit count ("give me 2 places") means show exactly that (already capped
    // inside resolveStrongsNumbers) and NOTHING else — padding the answer with unrelated
    // keyword/guess candidates the general pipeline also happened to find would silently ignore
    // what was actually asked for.
    candidates = strongsSeed.exactCountRequested
      ? strongsSeed.candidates
      : [strongsSeed.candidates, candidates.filter((c) => !strongsSeed.candidates.some((sc) => dedupeKey(sc) === dedupeKey(c)))].flat()
  }

  // Implicit notes augmentation — moved up from its old position (right before commentary) so
  // the critique step below can see real note titles alongside real verse candidates. A topical/
  // meaning question ("what does a fox mean in scripture") might have a directly relevant idiom/
  // regular note; surfaced only on a genuine title/idiom-term match (searchNotesImplicit), never
  // loose full-text noise, per the earlier "From your notes" removal (Round 4).
  const notesAugment = searchNotesImplicit(keywords, 3, questionBookId, pinnedCanonicalChapter)

  // Combined note list for both the critique step and the final response — explicit-ask results
  // (searchNotesExplicit, gathered before the extraction call) and implicit topical-match results
  // (searchNotesImplicit, just above) are two different searches over the same table; dedupe by
  // id since a note can legitimately satisfy both.
  const seenNoteIds = new Set<string>()
  const combinedNotes: AiLookupNoteResult[] = []
  for (const n of [...explicitNoteResults, ...notesAugment]) {
    if (seenNoteIds.has(n.id)) continue
    seenNoteIds.add(n.id)
    combinedNotes.push(n)
  }

  // Plan -> retrieve -> critique loop (item #1) — ONE cheap critique call, GATED TO DEEP SEARCH
  // (opts.agentic) as of the speed round. Originally this ran in every mode, including fast —
  // measured directly this round: with a real candidate already found, it came back
  // `{answersQuestion:true, betterKeywords:[]}` (a full extra ~2s Ollama call that changed
  // nothing), and with no candidates it suggested keywords with ZERO real KJV hits, so even the
  // one case where it COULD have helped just wasted the follow-up re-search too. It was meant to
  // be the "cheap" call, but a second sequential Ollama round-trip is never cheap next to a
  // pipeline that's otherwise pure deterministic DB work — it was single-handedly responsible for
  // roughly half of fast mode's total latency. Deep search keeps it: a user who opted into a
  // slower, more thorough search is explicitly asking for exactly this kind of extra scrutiny,
  // and it still catches real gaps often enough there (see betterKeywords fallthrough below) to
  // earn its cost.
  //
  // Cost guard (item #2, unchanged): even in Deep search, skip it when the question is
  // UNAMBIGUOUSLY a library lookup that already succeeded — an explicit video/notes ask where
  // real results were found AND the plan itself already agrees that's the right kind of answer.
  const unambiguousLibraryHit =
    (explicitVideoAsk && explicitVideoResults.length > 0 && extraction.answerKind === 'video') ||
    (explicitNoteAsk && combinedNotes.length > 0 && extraction.answerKind === 'notes')
  let critique: CritiqueVerdict | null = null
  if (opts.agentic && !unambiguousLibraryHit && (candidates.length > 0 || combinedNotes.length > 0 || explicitVideoResults.length > 0)) {
    emit(pick(VERIFY_MESSAGES))
    critique = await runCritique(
      question,
      { keywords, answerKind: extraction.answerKind },
      candidates,
      combinedNotes.map((n) => n.title),
      explicitVideoResults.map((v) => v.title),
      model,
    )
  }

  // If the critique says the current evidence doesn't answer the question and offers real,
  // different keywords, run ONE more keyword search round — a plain DB re-search, NOT another
  // model call — and fold in anything new. Hard-capped to this single round regardless of mode:
  // the existing agentic verificationPrompt loop above already gives Deep search up to 2 of its
  // own refinement rounds; this is deliberately smaller so a fast-mode question only ever pays
  // for one extra MODEL call (the critique itself) — this follow-up round is free by comparison,
  // it just costs a little more DB work.
  if (critique?.answersQuestion === false && critique.betterKeywords && critique.betterKeywords.length > 0) {
    const refined = filterGenericKeywords(critique.betterKeywords.slice(0, 6), false)
    if (refined.length > 0) {
      emit(pick(REFINE_MESSAGES))
      const retryHits = searchKeywords(refined)
      const newHits = retryHits.filter((r) => !seen.has(dedupeKey(r)))
      for (const r of newHits) seen.add(dedupeKey(r))
      if (newHits.length > 0) {
        keywords = [...keywords, ...refined]
        const scoredNew = scoreAndSort(newHits, backfillMinScore, !focusTextId)
        const room = Math.max(0, TOTAL_PRIMARY_CAP - candidates.length)
        if (room > 0) candidates = [...candidates, ...scoredNew.slice(0, room)]
      }
    }
  }

  // Item #2: decide whether notes should LEAD the final answer (hide the verse-results section)
  // instead of merely accompanying it — see decideNotesAreLead for the full priority order.
  // `hasVerseEvidence` is "real, already-scored scripture candidates exist" — the (c) "evidence
  // strength" leg of the decision the plan/critique signals get weighed against.
  const notesAreThePrimaryAnswer = decideNotesAreLead({
    explicitNoteAsk, noteResultsCount: combinedNotes.length, hasVerseEvidence: candidates.length > 0,
    planAnswerKind: extraction.answerKind, critiqueLeadKind: critique?.leadKind,
  })

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
  const notesForResponse = combinedNotes.length > 0 ? combinedNotes : undefined
  const videosForResponse = explicitVideoResults.length > 0 ? explicitVideoResults : undefined

  // Speed round: retrieval is DONE here — every real, DB-verified result the user will ever see
  // already exists in memory. Only remaining below is the optional Commentary pass, a second
  // ~4s Ollama call that writes explanatory prose over these SAME results, never introduces a
  // new reference (see its own comment just below). Emitting now — instead of only at the final
  // `return` — is what lets the panel show real verses immediately instead of sitting on a blank
  // spinner for however much longer Commentary takes. Skipped when Commentary is off, since the
  // final `return` below is reached immediately after and would just be a redundant duplicate
  // send of the identical object.
  if (opts.commentary) {
    emitPartial({
      results, visibleCount, keywords, related, relatedNote, strongsCard: strongsSeed.card,
      notes: notesForResponse, videos: videosForResponse, notesAreThePrimaryAnswer, summary: strongsSeed.note,
    })
  }

  // 7. Optional commentary — a second pass over the ranked, already-verified candidates.
  // The model explains and may flag entries to drop; it never introduces a new reference.
  if (opts.commentary) {
    emit(pick(COMMENTARY_MESSAGES))
    try {
      // Token budgeting (last-priority trim — history/tabContext were already settled up front
      // by budgetForExtraction): only affects what's SENT TO THE MODEL, never what the UI shows
      // — `candidates`/`results` below are untouched, so a verse dropped from the prompt here
      // just ends up with no `commentary` caption, not missing from the answer entirely.
      const promptVerses = budgetCommentaryCandidates(question, candidates, tabContextBlock, focusWorkName, focusTextId, combinedNotes)
      const raw = await runOllamaJson<{ perVerse?: Record<string, string>; irrelevant?: string[]; summary?: string }>(
        commentaryPrompt(question, promptVerses, tabContextBlock, focusWorkName, focusTextId, combinedNotes), model
      )
      const irrelevant = new Set(raw.irrelevant ?? [])
      // Round 13 (defect #6a): deterministic, free, always-on fact-check of the model's own
      // free-text output against the real, already-DB-verified `candidates` — see
      // verifyGeneratedText. Runs in fast mode too (no extra Ollama call, just re-checking output
      // the model already produced), which is the whole point: this is the "fact-checks itself,
      // even in fast mode" layer, distinct from the agentic verificationPrompt loop below (which
      // is a real extra model call, gated to Deep search only).
      for (const r of candidates) {
        const key = `${r.bookId} ${r.chapter}:${r.verse}`
        const caption = raw.perVerse?.[key]
        if (caption) {
          const check = verifyGeneratedText(caption, candidates)
          if (check.unverifiedRefs.length === 0 && check.unverifiedQuotes.length === 0) r.commentary = caption
        }
      }
      const summaryCheck = verifyGeneratedText(raw.summary ?? '', candidates)
      // Only prune if it wouldn't wipe out every primary result — a model that (incorrectly)
      // flags everything as irrelevant shouldn't leave the user with an empty response.
      const pruned = candidates.filter((r) => !irrelevant.has(`${r.bookId} ${r.chapter}:${r.verse}`))
      const finalPrimary = pruned.length > 0 ? pruned : candidates
      const keptKeys = new Set(finalPrimary.map(dedupeKey))
      const finalCrossRefs = crossRefs.filter((cr) => cr.crossRefOf && keptKeys.has(`${cr.textId}|${cr.crossRefOf.bookId}|${cr.crossRefOf.chapter}|${cr.crossRefOf.verse}`))
      return {
        results: [...finalPrimary, ...finalCrossRefs],
        visibleCount: finalPrimary.length,
        keywords, related, relatedNote,
        summary: appendVerificationCaveat(raw.summary, summaryCheck) ?? strongsSeed.note,
        strongsCard: strongsSeed.card, notes: notesForResponse, videos: videosForResponse, notesAreThePrimaryAnswer,
      }
    } catch {
      // Commentary is best-effort — a failed second call shouldn't drop the verified results.
      return {
        results, visibleCount, keywords, related, relatedNote, strongsCard: strongsSeed.card,
        notes: notesForResponse, videos: videosForResponse, notesAreThePrimaryAnswer, summary: strongsSeed.note,
      }
    }
  }

  return {
    results, visibleCount, keywords, related, relatedNote, strongsCard: strongsSeed.card,
    notes: notesForResponse, videos: videosForResponse, notesAreThePrimaryAnswer, summary: strongsSeed.note,
  }
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

  // Round 11: called when the Berean Chat panel closes — an instant, redundant path on top of
  // ollama.ts's own proactive idle-unload timer (which already covers "left the panel open but
  // stopped asking questions"), for the common case of actually closing it.
  ipcMain.handle('ailookup:unloadModel', () => { unloadOllamaImmediately(); return { success: true } })

  ipcMain.handle('ailookup:query', (event, question: string, opts: { commentary: boolean; agentic?: boolean; model?: string; textId?: string; wordReplacerRules?: WordReplacerRuleLite[]; history?: ChatHistoryTurn[]; tabContext?: AiLookupTabContextRef }) =>
    runLookup(question, opts,
      (status) => event.sender.send('ailookup:progress', status),
      (partial) => event.sender.send('ailookup:partial', partial)))

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
