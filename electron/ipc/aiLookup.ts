import type { IpcMain } from 'electron'
import { randomUUID } from 'crypto'
import { getBereanDb } from '../db/berean'
import { queryVerse, searchVerses } from './bible'
import { getTextDb } from '../db/bible'
import { getCrossRefsForVerse, getTskeForVerse } from './crossrefs'
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
  /** A short "H430 (Elohim) — God, god-like ones..." gloss line — set whenever the question
   *  contained (or the model proposed and we verified) a real Strong's number. */
  strongsInfo?: string
  summary?: string
  error?: string
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

// Aliases a user might type for a specific work, mapped to its textId (see TEXT_FILES in
// electron/db/bible.ts). Checked longest-first against the raw question so "1 enoch" doesn't
// get shadowed by a shorter, unrelated substring. Deliberately covers the texts most likely to
// come up by name in a lookup question — not exhaustive of every text/alias combination.
const TEXT_ALIASES: Array<[string, string]> = [
  ['book of jubilees', 'jubilees'], ['jubilees', 'jubilees'],
  ['1 enoch', 'enoch'], ['book of enoch', 'enoch'], ['enoch', 'enoch'],
  ['septuagint', 'lxx'], ['brenton', 'lxx'], [' lxx', 'lxx'],
  ['shepherd of hermas', 'hermas'], ['hermas', 'hermas'],
  ['epistle of barnabas', 'ep_barnabas'], ['barnabas', 'ep_barnabas'],
  ['first clement', '1clement'], ['1 clement', '1clement'], ['clement', 'recog_clement'],
  ['testaments of the twelve patriarchs', 't12p'], ['twelve patriarchs', 't12p'],
  ['testament of job', 't_job'],
  ['ascension of isaiah', 'asc_isaiah'],
  ['2 baruch', '2baruch'], ['second baruch', '2baruch'],
  ['didache', 'didache_hoole'],
  ['apocalypse of abraham', 'apoc_abraham'],
  ['testament of jacob', 't_jacob'],
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
])

/** Drops keywords that are a single, overly-generic word — see OVERLY_GENERIC_SINGLE_WORDS. */
function filterGenericKeywords(keywords: string[]): string[] {
  return keywords.filter((kw) => {
    const words = cleanWords(kw)
    return !(words.length === 1 && OVERLY_GENERIC_SINGLE_WORDS.has(words[0].toLowerCase()))
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

function getArchaicVariants(keyword: string, textId: string): string[] {
  const lq = keyword.trim().toLowerCase()
  if (!lq) return []
  const variants: string[] = []
  for (const rule of PSEUDEPIGRAPHA_ARCHAIC_VOCAB) {
    if (!(rule.textIds as string[]).includes(textId)) continue
    const hit = rule.modern.some((phrase) => phrase.toLowerCase().split(/\s+/).every((w) => stemMatches(w, lq)))
    if (hit) variants.push(rule.archaic)
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
  const guessRule = focusWorkName
    ? `- "guesses": 0-5 direct chapter:verse references you recall as relevant. The user is
  specifically asking about **${focusWorkName}** — if you recall a specific passage in
  ${focusWorkName} itself, guess it using "book": "${focusWorkName}" (it has ordinary
  chapter:verse numbering like any Bible book). You may also include KJV/Bible guesses (using
  full English book names) if a related canonical passage comes to mind. "endVerse" is
  optional, only for a real multi-verse range you recall. Omit "guesses" (empty array) if
  unsure — do not fabricate a reference you don't actually recall.`
    : `- "guesses": 0-5 direct verse references you recall as relevant, if any. Use full English
  Bible book names only (not Jubilees/Enoch/etc — ask about a specific work by name if that's
  what the user wants, this question didn't name one). "endVerse" is optional, only include it
  for a real multi-verse range you recall. Omit "guesses" (empty array) if unsure — do not
  fabricate.`

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
 *  through the same way. */
function keywordOverlapScore(text: string, keywords: string[], wordReplacerRules: WordReplacerRuleLite[] = [], textId?: string): number {
  const lower = text.toLowerCase()
  let score = 0
  for (const kw of keywords) {
    const variants = [
      ...getWordReplacerVariants(kw, wordReplacerRules),
      ...(textId ? getArchaicVariants(kw, textId) : []),
    ]
    const hit = variants.some((v) => {
      const words = cleanWords(v)
      return words.length > 0 && words.every((w) => lower.includes(w.toLowerCase()))
    })
    if (hit) score++
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
 *  number let it edge out a correct chapter-12 keyword hit that had NO such freebie. */
interface ChapterHint { textId: string; chapters: Set<number> }

function scoreCandidates(items: AiLookupResult[], keywords: string[], notesSignal?: NotesSignal, wordReplacerRules: WordReplacerRuleLite[] = [], chapterHint?: ChapterHint): AiLookupResult[] {
  return items
    .map((c, i) => ({
      c, i,
      score: keywordOverlapScore(c.text, keywords, wordReplacerRules, c.textId)
        + (notesSignal?.notedKeys.has(dedupeKey(c)) ? 2 : 0)
        + (c.source === 'keyword' && chapterHint?.textId === c.textId && chapterHint.chapters.has(c.chapter) ? 1 : 0),
    }))
    .filter((s) => s.score > 0 || s.c.source !== 'keyword')
    .sort((a, b) => b.score - a.score || a.i - b.i)
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
  info?: string
}

/** Resolves a list of Strong's numbers (explicit ones detected in the question, plus any the
 *  model itself proposed) into verified, real occurrences — every number is checked against
 *  the real lexicon DB first (getLexiconEntry), so a hallucinated/invalid one is silently
 *  dropped exactly like an unresolvable book/chapter guess is elsewhere in this file. Verse
 *  occurrences come from getLexiconOccurrences, which scans the tagged text directly (an exact
 *  tag match, not a model guess) — the most trustworthy source this pipeline has. */
function resolveStrongsNumbers(nums: string[], seen: Set<string>, bookNameForFn: (bookId: string, textId: string) => string): StrongsSeedResult {
  const candidates: AiLookupResult[] = []
  let info: string | undefined
  for (const num of nums.slice(0, 2)) {
    const entry = getLexiconEntry(num)
    if (!entry) continue
    if (!info) {
      const label = entry.transliteration || entry.lemma || entry.strongsNum
      info = `${entry.strongsNum} (${label}) — ${entry.gloss || entry.definition || 'no short definition available'}`
    }
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
  return { candidates, info }
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
function runQuoteLookup(seed: ParsedRef, emit: Emit): AiLookupResponse | null {
  const bookId = seed.bookId
  const chapter = seed.chapter
  const verse = seed.verse ?? 1
  const seedVerse = queryVerse(bookId, chapter, verse, DEFAULT_TEXT_ID)
  if (!seedVerse) return null // not a real verse — fall through to the normal pipeline

  emit(`Looking up what ${bookNameFor(bookId, DEFAULT_TEXT_ID)} ${chapter}:${verse} quotes…`)

  const isSeed = (r: { bookId: string; chapter: number; verse: number }) =>
    r.bookId === bookId && r.chapter === chapter && r.verse === verse

  const seen = new Set<string>()
  const results: AiLookupResult[] = []

  // TSKE first — its `heading` groups by quoted phrase, the closest thing either DB has to an
  // explicit "this is a quotation" signal; non-reciprocal groups are the ones worth leading
  // with (reciprocal ones are looser "also see" associations, not quotation-specific).
  const tske = getTskeForVerse(bookId, chapter, verse)
  for (const group of tske.groups) {
    if (group.isReciprocal) continue
    for (const ref of group.refs) {
      if (results.length >= MAX_CROSS_REFS) break
      if (!ref.text || isSeed(ref)) continue
      const key = `${DEFAULT_TEXT_ID}|${ref.bookId}|${ref.chapter}|${ref.verse}`
      if (seen.has(key)) continue
      seen.add(key)
      results.push({
        textId: DEFAULT_TEXT_ID, bookId: ref.bookId, bookName: bookNameFor(ref.bookId, DEFAULT_TEXT_ID),
        chapter: ref.chapter, verse: ref.verse, endVerse: ref.endVerse ?? undefined, text: ref.text,
        source: 'quote-source',
      })
    }
  }

  // Backfill with the classic cross_references.db table (vote-ranked) if TSKE didn't have
  // enough / anything — still a real, deterministic DB signal, just a looser "related verse"
  // one rather than TSKE's phrase-grouped quotation signal specifically.
  if (results.length < MAX_CROSS_REFS) {
    const classic = getCrossRefsForVerse(bookId, chapter, verse)
    for (const ref of classic.refs) {
      if (results.length >= MAX_CROSS_REFS) break
      if (!ref.text || isSeed(ref)) continue
      const key = `${DEFAULT_TEXT_ID}|${ref.bookId}|${ref.chapter}|${ref.verse}`
      if (seen.has(key)) continue
      seen.add(key)
      results.push({
        textId: DEFAULT_TEXT_ID, bookId: ref.bookId, bookName: bookNameFor(ref.bookId, DEFAULT_TEXT_ID),
        chapter: ref.chapter, verse: ref.verse, endVerse: ref.endVerse ?? undefined, text: ref.text,
        source: 'quote-source',
      })
    }
  }

  // Defensive filter — structurally the seed should never end up in `results` (see comment
  // above), but this costs nothing and guards against a self-referential/reciprocal TSKE row.
  const filtered = results.filter((r) => !isSeed(r))

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
      ? `Real cross-references for ${bookNameFor(bookId, DEFAULT_TEXT_ID)} ${chapter}:${verse}, ranked by vote/quotation signal — not an AI guess.`
      : `${bookNameFor(bookId, DEFAULT_TEXT_ID)} ${chapter}:${verse} has no recorded cross-references in this app's data.`,
  }
}

async function runLookup(
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

  // "What does verse X quote/reference/allude to" — detected locally (trigger phrase + a
  // literal, resolvable reference), entirely deterministic, no Ollama call at all if it fires.
  // Checked before the extraction call so a well-formed quotation question short-circuits the
  // rest of the pipeline outright rather than wastefully running an extraction call whose
  // result would just get thrown away.
  if (QUOTE_TRIGGER.test(question)) {
    const seedRef = findReferenceInText(question)
    if (seedRef) {
      const quoteResponse = runQuoteLookup(seedRef, emit)
      if (quoteResponse) return quoteResponse
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
  let keywords = filterGenericKeywords((extraction.keywords ?? []).slice(0, 6))
  const guesses = (extraction.guesses ?? []).slice(0, 5)

  const seen = new Set<string>()
  const guessCandidates: AiLookupResult[] = []
  let keywordCandidates: AiLookupResult[] = []

  // Strong's numbers — explicit ones typed in the question (e.g. "H430") resolve regardless of
  // anything else; a model-proposed one (from a "what's the word for X" style question) is
  // included too, but only after being verified against the real lexicon DB just like every
  // other AI-proposed reference in this pipeline.
  const strongsNums = [...detectStrongsNumbers(question), ...(extraction.strongsNum ? [extraction.strongsNum.trim().toUpperCase()] : [])]
  const strongsSeed = strongsNums.length > 0 ? resolveStrongsNumbers(strongsNums, seen, bookNameFor) : { candidates: [], info: undefined }

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

  const textPasses = focusTextId && focusTextId !== DEFAULT_TEXT_ID
    ? [focusTextId, DEFAULT_TEXT_ID]
    : [DEFAULT_TEXT_ID]

  // 1. AI direct guesses — a small, fixed budget that can never be starved out by the much
  // larger keyword pool. Allowed for canonical texts AND the current question's focus text
  // (Jubilees/Enoch/etc each have a single-book `books` table with ordinary chapter:verse
  // numbering, so a guess resolves the same way a canonical guess does) — resolveBookId
  // naturally only resolves a guess against the text whose own book map actually contains
  // that name, so a "Genesis" guess never matches jubilees.db and vice versa.
  // Chapters the model's own guess named for the focus text specifically — corroborating
  // evidence for step 5's ranking (see the ChapterHint/"Lever A" comment above scoreCandidates).
  const focusGuessChapters = new Set<number>()
  for (const textId of textPasses) {
    const db = getTextDb(textId)
    if (!db || !(CANONICAL_TEXT_IDS.has(textId) || textId === focusTextId)) continue
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
      if (focusTextId && textId === focusTextId && !CANONICAL_TEXT_IDS.has(textId)) {
        focusGuessChapters.add(g.chapter)
      }
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
      if (endVerse) endVerse = Math.min(endVerse, startVerse + 20)
      if (endVerse) {
        const parts: string[] = []
        for (let v = startVerse; v <= endVerse; v++) {
          const verse = queryVerse(bookId, g.chapter, v, textId)
          if (verse) parts.push(verse.text)
        }
        if (parts.length === 0) continue
        add(guessCandidates, textId, { book_id: bookId, chapter: g.chapter, verse_num: startVerse, verse_end: endVerse, text: parts.join(' ') }, 'ai-guess')
      } else {
        const verse = queryVerse(bookId, g.chapter, startVerse, textId)
        if (!verse) continue
        add(guessCandidates, textId, { book_id: bookId, chapter: g.chapter, verse_num: startVerse, text: verse.text }, 'ai-guess')
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
      const phraseResults = kws.map((kw) => {
        const variants = [
          ...getWordReplacerVariants(kw, wordReplacerRules),
          ...getArchaicVariants(kw, textId),
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
        const refined = filterGenericKeywords(verdict.refinedKeywords.slice(0, 6))
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
    return { ...empty(), keywords, strongsInfo: strongsSeed.info }
  }

  // 4. Notes signal — boosts ranking, never fabricates a new verse from a loose text match.
  const allCandidates = [...strongsSeed.candidates, ...mergedGuesses, ...mergedKeywords]
  const notesSignal = computeNotesSignal(allCandidates)
  for (const c of allCandidates) {
    if (notesSignal.notedKeys.has(dedupeKey(c))) c.noted = true
  }

  const chapterHint: ChapterHint | undefined = focusTextId && focusGuessChapters.size > 0
    ? { textId: focusTextId, chapters: focusGuessChapters }
    : undefined
  const scoreAndSort = (items: AiLookupResult[]): AiLookupResult[] =>
    scoreCandidates(items, keywords, notesSignal, wordReplacerRules, chapterHint)

  // 5. Result assembly. When a focus text is named, ITS OWN content leads — a canonical guess
  // no longer jumps ahead of what was actually asked about (previously it did, which read as
  // "I asked about Jubilees and got a Genesis answer" with no explanation). A canonical guess
  // is instead kept as a separate `related` pointer, shown after the focus results with a
  // one-line note — still visible, just not the headline answer. Without a focus text, this
  // is unchanged from Round 3/4: canonical guesses lead, keyword search only backfills gaps.
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
      const canonicalKeywordScored = scoreAndSort(mergedKeywords.filter((c) => c.textId === DEFAULT_TEXT_ID))
      const room = Math.min(KEYWORD_BACKFILL_CAP, TOTAL_PRIMARY_CAP - candidates.length)
      candidates = [...candidates, ...canonicalKeywordScored.slice(0, room)]
    }
    if (canonicalGuesses.length > 0) {
      related = canonicalGuesses.slice(0, 2)
      const first = related[0]
      relatedNote = `This may also be recorded in the Bible at ${first.bookName} ${first.chapter}:${first.verse}${first.endVerse ? '-' + first.endVerse : ''} — ${focusWorkName}'s retelling may use different wording for the same event.`
    }
  } else {
    candidates = canonicalGuesses.slice(0, TOTAL_PRIMARY_CAP)
    if (candidates.length < TOTAL_PRIMARY_CAP) {
      const canonicalKeywordScored = scoreAndSort(mergedKeywords.filter((c) => c.textId === DEFAULT_TEXT_ID))
      const room = Math.min(KEYWORD_BACKFILL_CAP, TOTAL_PRIMARY_CAP - candidates.length)
      candidates = [...candidates, ...canonicalKeywordScored.slice(0, room)]
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
  if (opts.agentic && candidates.length > 0) {
    emit(pick(PRUNE_MESSAGES))
    try {
      const verdict = await runOllamaJson<{ irrelevant?: string[] }>(relevancePrunePrompt(question, candidates), model)
      const irrelevant = new Set(verdict.irrelevant ?? [])
      if (irrelevant.size > 0) {
        const keyFor = (r: AiLookupResult) => `${r.bookId} ${r.chapter}:${r.verse}`
        const pruned = candidates.filter((r) => r.source === 'strongs' || !irrelevant.has(keyFor(r)))
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
        keywords, related, relatedNote, summary: raw.summary, strongsInfo: strongsSeed.info,
      }
    } catch {
      // Commentary is best-effort — a failed second call shouldn't drop the verified results.
      return { results, visibleCount, keywords, related, relatedNote, strongsInfo: strongsSeed.info }
    }
  }

  return { results, visibleCount, keywords, related, relatedNote, strongsInfo: strongsSeed.info }
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
  strongsInfo?: string
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
