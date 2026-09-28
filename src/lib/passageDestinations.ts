/**
 * Passage-picker destinations (NEW-11 / NEW-11B) — the PURE model behind the iPhone
 * `PassagePicker` (and any other Scripture destination chooser):
 *
 *   • `PASSAGE_COLLECTIONS` — Level 1 of the picker: every text in `TRANSLATIONS`, plus the
 *     KJVA's Apocrypha as its own group, with search aliases derived from the text's label,
 *     edition name and description (+ a few common extra names: "septuagint", "king james").
 *   • `resolvePassageQuery` — what the picker's search field resolves typed text to. It returns
 *     NAVIGATION DESTINATIONS, not a filtered list: "LXX" → the Septuagint collection,
 *     "gen 3:5" → that passage (in the current text when it has the book, else the covering
 *     text via `resolveTextForBook`), "1 cor" → the book 1 Corinthians, "Enoch" → 1 Enoch.
 */
import { TRANSLATIONS, EDITIONS } from './bibleTexts'
import {
  parseRef, resolveBookToken, isExactBookToken, bookName, bookChapterVerseLabel, ALL_BOOKS,
  getTranslationForBook, maxChapterFor, displayBookName,
} from './parseRef'
import { resolveTextForBook, textHasBook } from './textCoverage'

export type CollectionGroup = 'Apocrypha'

export interface PassageCollection {
  /** Stable key: the textId, or `textId:group`. */
  key: string
  textId: string
  /** A testament group inside the text (the KJVA's Apocrypha). */
  group?: CollectionGroup
  /** Full name shown in the collections list. */
  label: string
  /** Short name (sheet titles / back labels). */
  short: string
  subtitle: string
  /** Root list section. */
  section: 'Bible' | 'Other writings'
  /** Lower-case search aliases. */
  aliases: string[]
}

/** Extra names people type for a collection (label, edition name and description are added automatically). */
const EXTRA_ALIASES: Record<string, string[]> = {
  kjva: ['kjv', 'kjva', 'king james', 'king james version', 'authorized version', 'authorised version', 'av'],
  lxx: ['lxx', 'septuagint', 'brenton', 'greek old testament'],
  enoch: ['enoch', '1 enoch', 'book of enoch', 'ethiopic enoch'],
  jubilees: ['jubilees', 'book of jubilees'],
  apoc_elijah: ['apocalypse of elijah'],
  recog_clement: ['recognitions', 'clementine recognitions'],
  hermas: ['hermas', 'shepherd'],
  hermas_taylor: ['taylor'],
  asc_isaiah: ['ascension of isaiah'],
  ep_barnabas: ['barnabas', 'epistle of barnabas'],
  t12p: ['t12p', 'twelve patriarchs', 'testaments of the twelve patriarchs'],
  gad: ['gad the seer', 'words of gad'],
  t_job: ['testament of job'],
  '1clement': ['1 clement', 'first clement', 'clement'],
  apoc_abraham: ['apocalypse of abraham'],
  didache_hoole: ['didache', 'teaching of the twelve apostles'],
  t_jacob: ['testament of jacob'],
  '2baruch': ['2 baruch', 'syriac baruch'],
}

const BIBLE_TEXTS = new Set(['kjva', 'lxx'])

function norm(s: string): string {
  return s.toLowerCase().replace(/[.,;:()’'"]/g, ' ').replace(/\s+/g, ' ').trim()
}

function buildCollections(): PassageCollection[] {
  const out: PassageCollection[] = []
  for (const t of TRANSLATIONS) {
    const edition = EDITIONS.find((e) => e.translations.some((x) => x.id === t.id))
    const multi = (edition?.translations.length ?? 0) > 1
    const tr = edition?.translations.find((x) => x.id === t.id)
    const label = t.id === 'kjva' ? 'King James Version'
      : edition ? (multi ? `${edition.label} (${tr?.label ?? t.label})` : edition.label) : t.label
    const subtitle = t.id === 'kjva' ? 'Old Testament, Apocrypha, New Testament'
      : t.id === 'lxx' ? 'Brenton Septuagint' : t.description
    const aliases = new Set<string>([t.label, t.description, edition?.label ?? '', ...(EXTRA_ALIASES[t.id] ?? [])].map(norm).filter(Boolean))
    out.push({ key: t.id, textId: t.id, label, short: t.id === 'kjva' ? 'KJV' : t.label, subtitle, section: BIBLE_TEXTS.has(t.id) ? 'Bible' : 'Other writings', aliases: [...aliases] })
    if (t.id === 'kjva') {
      out.push({
        key: 'kjva:Apocrypha', textId: 'kjva', group: 'Apocrypha', label: 'Apocrypha', short: 'Apocrypha',
        subtitle: 'KJV Apocrypha (deuterocanonical books)', section: 'Bible',
        aliases: ['apocrypha', 'kjv apocrypha', 'deuterocanon', 'deuterocanonical', 'deuterocanonicals'],
      })
    }
  }
  return out
}

/** Level 1 of the picker, in display order. */
export const PASSAGE_COLLECTIONS: readonly PassageCollection[] = buildCollections()

/** The collection for a text (the whole text, never a group). */
export function collectionForText(textId: string): PassageCollection | undefined {
  const id = textId.toLowerCase()
  return PASSAGE_COLLECTIONS.find((c) => c.textId === id && !c.group)
}

/** Human name of a text for subtitles ("King James Version", "Septuagint (Brenton)"). */
export function collectionLabel(textId: string): string {
  return collectionForText(textId)?.label ?? textId.toUpperCase()
}

/** The only book of a single-book dedicated text (1 Enoch → ENO), else null. Single-book
 *  collections skip the book list and open straight at their chapters. */
export function singleBookOf(textId: string): string | null {
  const id = textId.toLowerCase()
  const ids = ALL_BOOKS.filter((b) => getTranslationForBook(b.id) === id || (id === 'hermas_taylor' && b.id.startsWith('HER_'))).map((b) => b.id)
  return ids.length === 1 ? ids[0] : null
}

/**
 * The name a book is listed under INSIDE its collection: the shared `displayBookName` (arabic
 * numerals, never "I John"), minus a repeated collection prefix — "Recognitions of Clement —
 * Book 3" reads "Book 3" in the Recognitions list, "Shepherd of Hermas — Visions" reads "Visions".
 */
export function bookLabelInCollection(name: string, bookId: string): string {
  const full = displayBookName(name, bookId)
  const m = /^.+?\s+[—–-]\s+(.+)$/.exec(full)
  return m ? m[1] : full
}

// ── Search resolution ──────────────────────────────────────────────────────────────────────

export type PassageDestination =
  | { kind: 'collection'; key: string; textId: string; group?: CollectionGroup; label: string; subtitle?: string }
  | { kind: 'book'; key: string; textId: string; bookId: string; label: string; subtitle?: string }
  | { kind: 'passage'; key: string; textId: string; bookId: string; chapter: number; verse?: number; endVerse?: number; label: string; subtitle?: string }

export interface ResolveOptions {
  /** The text the picker was opened from (passages/books prefer it when it has the book). */
  textId: string
  /** That text's loaded books (names are matched too, so DB-only names are found). */
  books?: ReadonlyArray<{ id: string; name: string }>
  /** Maximum destinations returned. Default 12. */
  limit?: number
  /** The book the user is inside (picker chapter level): a bare "10" / "10:5" means this book. */
  bookId?: string
}

/** Text named anywhere in the query ("Matthew 10 LXX", "lxx gen 3", "John 3 KJV"), and the query
 *  without it (SEP24-007/025): the destination then uses that text's database. */
export function extractTextToken(query: string): { textId: string | null; rest: string } {
  const m = /(?:^|\s)(lxx|septuagint|brenton|kjva?|king james)(?=\s|$)/i.exec(query)
  if (!m) return { textId: null, rest: query }
  const t = m[1].toLowerCase()
  const textId = t === 'lxx' || t === 'septuagint' || t === 'brenton' ? 'lxx' : 'kjva'
  return { textId, rest: (query.slice(0, m.index) + ' ' + query.slice(m.index + m[0].length)).replace(/\s+/g, ' ').trim() }
}

function collectionScore(c: PassageCollection, q: string): number {
  let best = 0
  for (const a of c.aliases) {
    if (a === q) return 100
    if (q.length >= 2 && a.startsWith(q)) best = Math.max(best, 80)
    else if (q.length >= 3 && a.split(' ').some((w) => w.length > 2 && w.startsWith(q))) best = Math.max(best, 60)
  }
  return best
}

function bookScore(name: string, q: string): number {
  const n = norm(name)
  if (n === q) return 96
  if (n.startsWith(q)) return 75
  if (q.length >= 2 && n.split(' ').some((w) => w.startsWith(q))) return 55
  if (q.length >= 3 && n.includes(q)) return 40
  return 0
}

/** Text a navigation to `bookId` should use from `textId` (the current text when it has the book). */
/** Whether `textId` has the book (kjva counts every canonical KJV book). */
function textHasBookOrKjv(textId: string, bookId: string): boolean {
  return textId === 'kjva' ? resolveTextForBook('kjva', bookId) === 'kjva' : textHasBook(textId, bookId)
}

export function textForBook(textId: string, bookId: string): string {
  return resolveTextForBook(textId, bookId) ?? textId.toLowerCase()
}

/**
 * Resolve a typed query into ranked navigation destinations (see the file comment).
 * Order: an exact passage first, then exact collection / book names, then prefix matches.
 */
export function resolvePassageQuery(rawQuery: string, opts: ResolveOptions): PassageDestination[] {
  // A text named in the query ("… LXX") picks that database for the destination.
  const tok = extractTextToken(rawQuery)
  const query = tok.rest || (tok.textId ? rawQuery : rawQuery)
  const q = norm(query)
  const current = opts.textId.toLowerCase()
  const limit = opts.limit ?? 12
  const scored: Array<{ d: PassageDestination; score: number }> = []
  const withText = (bookId: string, fallback: string) =>
    tok.textId && textHasBookOrKjv(tok.textId, bookId) ? tok.textId : fallback

  // 0. Inside a book: "10", "10:5", "10:5-8" — that book's chapter / verse.
  const bare = opts.bookId ? /^(\d{1,3})(?::(\d{1,3})(?:\s*[-–]\s*(\d{1,3}))?)?$/.exec(query.trim()) : null
  if (bare && opts.bookId) {
    const chapter = Number(bare[1]); const verse = bare[2] ? Number(bare[2]) : undefined; const endVerse = bare[3] ? Number(bare[3]) : undefined
    const textId = withText(opts.bookId, current)
    const vl = bookChapterVerseLabel(opts.bookId, chapter, verse)
    return [{ kind: 'passage', key: `p:${textId}:${opts.bookId}:${chapter}:${verse ?? ''}:${endVerse ?? ''}`, textId, bookId: opts.bookId, chapter, verse, endVerse,
      label: verse != null && endVerse != null ? `${vl}–${endVerse}` : vl, subtitle: collectionLabel(textId) }]
  }
  // Only a text named ("LXX") → that collection first.
  if (!q && tok.textId) {
    const c = PASSAGE_COLLECTIONS.find((x) => x.textId === tok.textId && !x.group)
    return c ? [{ kind: 'collection', key: `c:${c.key}`, textId: c.textId, label: c.label, subtitle: c.subtitle }] : []
  }
  if (!q) return []

  // 1. A passage — a book name followed by a number ("gen 3", "1 cor 13", "1 Enoch 5:2").
  if (/\p{L}.*\d/u.test(query)) {
    const ref = parseRef(query.trim())
    if (ref) {
      let textId = textForBook(current, ref.bookId)
      if (ref.forcedTranslation === 'LXX' && textHasBook('lxx', ref.bookId)) textId = 'lxx'
      textId = withText(ref.bookId, textId)
      const verseLabel = bookChapterVerseLabel(ref.bookId, ref.chapter, ref.verse)
      const label = ref.verse != null && ref.endVerse != null ? `${verseLabel}–${ref.endVerse}` : verseLabel
      scored.push({ score: 200, d: { kind: 'passage', key: `p:${textId}:${ref.bookId}:${ref.chapter}:${ref.verse ?? ''}:${ref.endVerse ?? ''}`, textId, bookId: ref.bookId, chapter: ref.chapter, verse: ref.verse, endVerse: ref.endVerse, label, subtitle: collectionLabel(textId) } })
    }
  }

  // 2. Collections ("lxx", "septuagint", "enoch", "apocrypha").
  const collectionHits = new Set<string>()
  for (const c of PASSAGE_COLLECTIONS) {
    const s = collectionScore(c, q)
    if (!s) continue
    collectionHits.add(c.key)
    scored.push({ score: s === 100 ? 100 : s - 2, d: { kind: 'collection', key: `c:${c.key}`, textId: c.textId, group: c.group, label: c.label, subtitle: c.subtitle } })
  }

  // 3. Books ("gen", "1 cor", "john", "maccabees").
  const books = new Map<string, number>()
  const addBook = (id: string, score: number) => { if (score > (books.get(id) ?? 0)) books.set(id, score) }
  if (/\p{L}/u.test(q)) {
    const exact = isExactBookToken(q) ? resolveBookToken(q) : null
    if (exact) addBook(exact, 97)
    for (const b of opts.books ?? []) addBook(b.id, bookScore(displayBookName(b.name, b.id), q))
    for (const b of ALL_BOOKS) {
      if (maxChapterFor(b.id) == null && !getTranslationForBook(b.id)) continue // not in any bundled text
      addBook(b.id, bookScore(b.name, q))
    }
    if (!books.size && !scored.length) {
      const fuzzy = resolveBookToken(q) // misspellings ("genesys")
      if (fuzzy) addBook(fuzzy, 50)
    }
  }
  const currentBooks = new Map((opts.books ?? []).map((b) => [b.id, b.name]))
  for (const [bookId, score] of books) {
    if (!score) continue
    const textId = withText(bookId, currentBooks.has(bookId) ? current : textForBook(current, bookId))
    // A single-book text's book IS its collection ("Enoch" → 1 Enoch once, not twice).
    const coll = collectionForText(textId)
    if (coll && collectionHits.has(coll.key) && singleBookOf(textId) === bookId) continue
    const name = currentBooks.has(bookId) ? displayBookName(currentBooks.get(bookId), bookId) : bookName(bookId)
    scored.push({ score, d: { kind: 'book', key: `b:${textId}:${bookId}`, textId, bookId, label: name, subtitle: collectionLabel(textId) } })
  }

  // Stable sort by score (ties keep insertion order: passage, collections, then canon order).
  const seen = new Set<string>()
  return scored
    .map((x, i) => ({ ...x, i }))
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .map((x) => x.d)
    .filter((d) => (seen.has(d.key) ? false : (seen.add(d.key), true)))
    .slice(0, limit)
}
