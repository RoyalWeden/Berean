import { parseRef } from '@/lib/parseRef'
import { parseMultiStrongsQuery } from '@/lib/strongsSearch'
import { resolvePassageQuery, type PassageDestination } from '@/lib/passageDestinations'

/**
 * What a typed search means — the ONE deterministic query parser shared by every Berean search
 * entry point (desktop Floating Search's source prefixes, the iPhone plus / caret search and the
 * Search tab). No guessing beyond these rules (SRCH-002):
 *
 *   "Matthew 10", "Matthew 10 LXX", "jubilees 23", "1 enoch"  → Go to (passage / book / collection)
 *   "zechariah", "Matthew"                                   → Go to the book AND a word search
 *   "lxx", "enoch", "apocrypha"                              → Go to that text / collection
 *   "H430", "G2316 H430", "strong 430", "strongs 430"        → Strong's entries (+ their verses)
 *   "lxx love", "enoch: watchers", "love lxx"                → word search in that text
 *   "\"love thy neighbour\""                                  → exact phrase
 *   "notes", "my notes", "notes: sabbath"                    → Notes (search only notes)
 *   anything else                                            → a word search everywhere
 *
 * Case never matters and the text is never re-capitalized.
 */


/** Desktop Floating Search's source prefixes (moved here unchanged so both apps share them). */
export const TRANSLATION_PREFIXES: Array<[string[], string]> = [
  [['lxx:', 'lxx ', 'septuagint:', 'septuagint ', 'brenton:', 'brenton '], 'lxx'],
  [['enoch:', 'enoch ', '1 enoch:', '1 enoch '], 'enoch'],
  [['jubilees:', 'jubilees '], 'jubilees'],
  [['hermas:', 'hermas '], 'hermas'],
  [['barnabas:', 'barnabas ', 'ep barnabas:', 'epistle of barnabas '], 'ep_barnabas'],
  [['ascension of isaiah:', 'asc isaiah:', 'asc_isaiah '], 'asc_isaiah'],
  [['recognitions:', 'recog_clement ', 'roc:', 'roc '], 'recog_clement'],
  [['apoc elijah:', 'apocalypse of elijah '], 'apoc_elijah'],
  [['t12p:', 'testaments:', 'twelve patriarchs '], 't12p'],
  [['gad the seer:', 'gad seer:', 'words of gad '], 'gad'],
  [['testament of job:', 'test job:', 'tjob '], 't_job'],
  [['1 clement:', '1clement:', '1clem '], '1clement'],
  [['apoc abraham:', 'apocalypse of abraham '], 'apoc_abraham'],
  [['testament of jacob:', 'test jacob:', 'tjac '], 't_jacob'],
  [['2 baruch:', '2baruch:', 'apocalypse of baruch '], '2baruch'],
]

/** Source prefix of a keyword query ("lxx creation", "enoch: watchers", "isa 28 lxx"); null when
 *  the whole query is itself a reference ("jubilees 17") or names no source. Desktop behaviour. */
export function detectTranslationPrefix(q: string): { textId: string; cleanQuery: string } | null {
  const lower = q.trim().toLowerCase()
  // A space-only prefix (no colon) is ambiguous whenever the book itself is
  // named that way — "jubilees 17", "enoch 5", "hermas 3" are meant as a
  // REFERENCE into that dedicated text, not "search the word '17' within
  // the jubilees translation". If the untouched query already resolves as a
  // real reference on its own, prefer that reading over stripping it down
  // to a query fragment that (as with a bare chapter number) often fails to
  // parse as anything at all. Colon-qualified prefixes ("jubilees:creation")
  // are unambiguous and always meant as a translation-scoped keyword search,
  // so they skip this check.
  if (parseRef(q.trim())) return null
  // Check leading prefix form: "lxx creation", "enoch 1"
  for (const [patterns, id] of TRANSLATION_PREFIXES) {
    for (const pat of patterns) {
      if (lower.startsWith(pat)) {
        return { textId: id, cleanQuery: q.slice(pat.length).trim() }
      }
    }
  }
  // Check trailing qualifier form: "isa 28 lxx", "genesis 1 enoch" (not super common but user reported it)
  const trailingMatch = lower.match(/^(.+)\s+(lxx|enoch|jubilees|septuagint|brenton)$/)
  if (trailingMatch) {
    const qualifier = trailingMatch[2]
    const textId = qualifier === 'septuagint' || qualifier === 'brenton' ? 'lxx' : qualifier
    return { textId, cleanQuery: q.slice(0, q.lastIndexOf(trailingMatch[2])).trim() }
  }
  return null
}

/** A source named on its own ("lxx", "septuagint", "1 enoch", "jubilees") — its text id. */
export function bareSourceToken(q: string): string | null {
  const lower = q.trim().toLowerCase()
  for (const [patterns, id] of TRANSLATION_PREFIXES) {
    for (const pat of patterns) if (pat.replace(/[:\s]+$/, '') === lower) return id
  }
  return null
}

export interface SearchIntent {
  /** The query as typed (trimmed). */
  raw: string
  /** Words to full-text search ('' = none — the query was a destination). */
  text: string
  phrase: boolean
  /** A source the query names: the word search runs in that text only. */
  textId: string | null
  /** Strong's numbers the query names ("strong 430" → both H430 and G430). */
  strongs: string[]
  /** The query is a Strong's search ("H430 jacob" → verses carrying H430 with the word jacob). */
  strongsQuery: string | null
  /** "notes …" / "my notes …": search notes only. */
  notesOnly: boolean
  /** Places the query names (passages, books, collections), best first. */
  places: PassageDestination[]
}

export interface IntentContext {
  /** The text of the tab the search started from (a bare book prefers it). */
  textId?: string
  /** The book the user is in: a bare "10" / "10:5" means this book. */
  bookId?: string
}

const EMPTY: SearchIntent = { raw: '', text: '', phrase: false, textId: null, strongs: [], strongsQuery: null, notesOnly: false, places: [] }

export function parseSearchIntent(query: string, ctx: IntentContext = {}): SearchIntent {
  const raw = query.trim()
  if (!raw) return EMPTY
  // Notes: "notes", "my notes", "notes: sabbath", "my notes sabbath".
  const notes = /^(?:my\s+)?notes?(?::|\s+|$)(.*)$/i.exec(raw)
  if (notes) return { ...EMPTY, raw, text: notes[1].trim(), notesOnly: true }
  // Strong's: "strong 430" / "strong's 430" / "strongs #430" → Hebrew and Greek; "H430", "G26 H430", "H430 jacob".
  const bare = /^strong(?:'?s)?\s*#?\s*(\d{1,5})$/i.exec(raw)
  if (bare) return { ...EMPTY, raw, strongs: [`H${Number(bare[1])}`, `G${Number(bare[1])}`] }
  const multi = parseMultiStrongsQuery(raw)
  if (multi) return { ...EMPTY, raw, strongs: multi.strongsNums, strongsQuery: raw }
  // Exact phrase in quotes.
  const quoted = /^["“”](.+?)["“”]$/.exec(raw)
  if (quoted) return { ...EMPTY, raw, text: quoted[1].trim(), phrase: true }
  // A source on its own → that text.
  const source = bareSourceToken(raw)
  const places = resolvePassageQuery(raw, { textId: ctx.textId ?? 'kjva', bookId: ctx.bookId, limit: 4 })
  if (source) return { ...EMPTY, raw, textId: source, places }
  // A reference ("Matthew 10", "jubilees 23", "Matthew 10 LXX") is a destination, not words.
  const isRef = places[0]?.kind === 'passage' && (!!parseRef(raw) || /\d/.test(raw))
  if (isRef) return { ...EMPTY, raw, places }
  // "lxx love" / "enoch: watchers" / "love lxx" → words in that text.
  const pre = detectTranslationPrefix(raw)
  if (pre && pre.cleanQuery) return { ...EMPTY, raw, text: pre.cleanQuery, textId: pre.textId, places: places.filter((p) => p.kind !== 'passage') }
  return { ...EMPTY, raw, text: raw, places }
}
