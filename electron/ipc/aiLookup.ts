import type { IpcMain } from 'electron'
import { randomUUID } from 'crypto'
import { getBereanDb } from '../db/berean'
import { queryVerse, searchVerses } from './bible'
import { getTextDb } from '../db/bible'
import { getCrossRefsForVerse, getTskeForVerse } from './crossrefs'
import { checkOllamaAvailable, runOllamaJson, runOllamaText, DEFAULT_OLLAMA_MODEL } from '../ollama'

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

export type ResultSource = 'keyword' | 'ai-guess' | 'cross-ref'

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

function extractionPrompt(question: string, focusWorkName: string | null): string {
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

User question: "${question}"

Respond with ONLY a JSON object of this exact shape:
{
  "keywords": ["short phrase or name", "..."],
  "guesses": [{"book": "Genesis", "chapter": 12, "verse": 1, "endVerse": 3}]
}

Rules:
- "keywords" are matched literally against unmodified text — use the wording the source text
  actually uses (e.g. "Jesus" not "Yeshua", "Holy Ghost" not "Holy Spirit"), even if that
  differs from how the question was phrased. 3-6 short search phrases or proper names (people,
  places, concepts) likely to appear verbatim in the verse text. Prefer specific multi-word
  phrases or names over single generic words (avoid bare words like "God", "love", "earth" —
  they match thousands of unrelated verses).${styleNote}
${guessRule}
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

/** Base relevance score: how many extracted keywords literally appear in the verse text. */
function keywordOverlapScore(text: string, keywords: string[]): number {
  const lower = text.toLowerCase()
  let score = 0
  for (const kw of keywords) {
    const words = cleanWords(kw)
    if (words.length > 0 && words.every((w) => lower.includes(w.toLowerCase()))) score++
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

async function runLookup(question: string, opts: { commentary: boolean; model?: string; textId?: string; wordReplacerRules?: WordReplacerRuleLite[] }): Promise<AiLookupResponse> {
  const model = opts.model || DEFAULT_OLLAMA_MODEL
  const wordReplacerRules = opts.wordReplacerRules ?? []

  // Text-focused search: a question naming a specific work (e.g. "in Jubilees...") searches
  // that text FIRST, then falls back to also searching the default (kjva). Computed before the
  // extraction call since the prompt itself needs to know (to invite a focus-text guess).
  const explicitFocus = opts.textId && opts.textId !== DEFAULT_TEXT_ID ? opts.textId : null
  const focusTextId = explicitFocus ?? detectFocusTextId(question)
  const focusWorkName = focusTextId ? singleBookWorkName(focusTextId) : null

  const { available } = await checkOllamaAvailable()
  if (!available) return { results: [], visibleCount: 0, keywords: [], error: 'ollama-unavailable' }

  let extraction: AiExtraction
  try {
    extraction = await runOllamaJson<AiExtraction>(extractionPrompt(question, focusWorkName), model)
  } catch {
    return { results: [], visibleCount: 0, keywords: [], error: 'ollama-request-failed' }
  }
  const keywords = filterGenericKeywords((extraction.keywords ?? []).slice(0, 6))
  const guesses = (extraction.guesses ?? []).slice(0, 5)

  const seen = new Set<string>()
  const guessCandidates: AiLookupResult[] = []
  const keywordCandidates: AiLookupResult[] = []

  function add(bucket: AiLookupResult[], textId: string, row: { book_id: string; chapter: number; verse_num: number; verse_end?: number; text: string }, source: ResultSource) {
    const r: AiLookupResult = {
      textId, bookId: row.book_id, bookName: bookNameFor(row.book_id, textId),
      chapter: row.chapter, verse: row.verse_num, endVerse: row.verse_end, text: row.text, source,
    }
    const key = dedupeKey(r)
    if (seen.has(key)) return
    seen.add(key)
    bucket.push(r)
  }

  const textPasses = focusTextId && focusTextId !== DEFAULT_TEXT_ID
    ? [focusTextId, DEFAULT_TEXT_ID]
    : [DEFAULT_TEXT_ID]

  for (const textId of textPasses) {
    const db = getTextDb(textId)
    if (!db) continue

    // 1. AI direct guesses go FIRST — a small, fixed budget that can never be starved out by
    // the much larger keyword pool gathered afterward. Allowed for canonical texts AND the
    // current question's focus text (Jubilees/Enoch/etc each have a single-book `books` table
    // with ordinary chapter:verse numbering, so a guess resolves the same way a canonical
    // guess does) — resolveBookId naturally only resolves a guess against the text whose own
    // book map actually contains that name, so a "Genesis" guess never matches jubilees.db and
    // a "Jubilees" guess never matches kjva.db even though both texts are checked here.
    if (CANONICAL_TEXT_IDS.has(textId) || textId === focusTextId) {
      for (const g of guesses) {
        if (guessCandidates.length >= 8) break
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

    // 2. Keyword search via FTS5. Phrase mode first for every keyword (and every word-replacer
    // variant of it, e.g. "Yeshua" also tries "Jesus" — see getWordReplacerVariants); the loose
    // 'all'-mode (independent prefix-wildcard AND) fallback only kicks in if EVERY keyword's
    // phrase search came back empty — a single keyword falling back while others still have
    // real phrase hits is what used to flood the pool with generic-word noise.
    const phraseResults = keywords.map((kw) => {
      const variants = getWordReplacerVariants(kw, wordReplacerRules)
      const rows = variants.flatMap((v) => searchVerses(v, textId, 'phrase'))
      return { kw, variants, rows }
    })
    const anyPhraseHits = phraseResults.some((r) => r.rows.length > 0)
    for (const { variants, rows } of phraseResults) {
      if (keywordCandidates.length >= CANDIDATE_POOL_CAP) break
      const finalRows = rows.length > 0 || !anyPhraseHits
        ? (rows.length > 0 ? rows : variants.flatMap((v) => searchVerses(v, textId, 'all')))
        : []
      for (const row of finalRows.slice(0, 6)) {
        if (keywordCandidates.length >= CANDIDATE_POOL_CAP) break
        add(keywordCandidates, textId, { book_id: row.book_id, chapter: row.chapter, verse_num: row.verse_num, text: row.text }, 'keyword')
      }
    }
  }

  // 3. Merge adjacent verses (same textId/book/chapter, contiguous verse numbers, same
  // source) into displayed ranges — model-independent, so this fires whether or not the
  // AI's own guesses happened to include a range.
  const mergedGuesses = mergeAdjacent(guessCandidates)
  const mergedKeywords = mergeAdjacent(keywordCandidates)
  const allCandidates = [...mergedGuesses, ...mergedKeywords]

  if (allCandidates.length === 0) return { results: [], visibleCount: 0, keywords, error: undefined }

  // 4. Notes signal — boosts ranking, never fabricates a new verse from a loose text match.
  const notesSignal = computeNotesSignal(allCandidates)
  for (const c of allCandidates) {
    const key = dedupeKey(c)
    if (notesSignal.notedKeys.has(key)) c.noted = true
  }

  // 5. CANONICAL guesses LEAD the primary result set unconditionally — validated ~90%+ accurate
  // (Round 3's 37-question batch). A pseudepigrapha (focus-text) guess does NOT get the same
  // free pass: repeated testing on the Jubilees case showed only ~30-50% accuracy there, so
  // instead it's merged into the same keyword-overlap-scored pool as that same text's own
  // keyword hits — it still gets a fair shot (especially now that the archaic-translation hint
  // above gives keyword search a real chance of finding the right verse too), but a wrong guess
  // can no longer automatically bury a correct keyword-found one beneath it. Tried adding a
  // small "is a guess" score nudge here too; reverted after testing showed it let a WRONG,
  // wide whole-chapter guess (a 21-verse concatenated block — much likelier to contain some
  // keyword by sheer size than a single verse) beat a precise, correct single-verse keyword
  // hit. Plain keyword-overlap scoring alone produced the better result in both test runs.
  const scoreAndSort = (items: AiLookupResult[]): AiLookupResult[] =>
    items
      .map((c, i) => ({
        c, i,
        score: keywordOverlapScore(c.text, keywords)
          + (notesSignal.notedKeys.has(dedupeKey(c)) ? 2 : 0),
      }))
      .sort((a, b) => b.score - a.score || a.i - b.i)
      .map((s) => s.c)

  const canonicalGuesses = mergedGuesses.filter((c) => CANONICAL_TEXT_IDS.has(c.textId))
  const focusGuesses = mergedGuesses.filter((c) => !CANONICAL_TEXT_IDS.has(c.textId))

  let candidates = canonicalGuesses.slice(0, TOTAL_PRIMARY_CAP)
  if (candidates.length < TOTAL_PRIMARY_CAP && focusTextId) {
    const focusPool = scoreAndSort([...focusGuesses, ...mergedKeywords.filter((c) => c.textId === focusTextId)])
    const focusRoom = TOTAL_PRIMARY_CAP - candidates.length
    candidates = [...candidates, ...focusPool.slice(0, focusRoom)]
  }
  if (candidates.length < TOTAL_PRIMARY_CAP) {
    const canonicalKeywordScored = scoreAndSort(mergedKeywords.filter((c) => c.textId === DEFAULT_TEXT_ID))
    const room = Math.min(KEYWORD_BACKFILL_CAP, TOTAL_PRIMARY_CAP - candidates.length)
    candidates = [...candidates, ...canonicalKeywordScored.slice(0, room)]
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
        keywords, summary: raw.summary,
      }
    } catch {
      // Commentary is best-effort — a failed second call shouldn't drop the verified results.
      return { results, visibleCount, keywords }
    }
  }

  return { results, visibleCount, keywords }
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
  summary?: string
  createdAt: string
}

export function registerAiLookupHandlers(ipcMain: IpcMain): void {
  ipcMain.handle('ailookup:checkAvailable', () => checkOllamaAvailable())

  ipcMain.handle('ailookup:query', (_e, question: string, opts: { commentary: boolean; model?: string; textId?: string; wordReplacerRules?: WordReplacerRuleLite[] }) =>
    runLookup(question, opts))

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
