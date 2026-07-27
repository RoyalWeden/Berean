/**
 * Floating-search-only reference parsing for the "book-numbered" and "section-numbered"
 * multi-book editions (Recognitions of Clement, Shepherd of Hermas) — NOT wired into
 * parseRef.ts itself, since parseRef's regex is also the one three note-editor files
 * (noteTextBlocks.ts, NoteEditor.tsx, pm/autocomplete.ts) depend on for verse-block
 * auto-detection, and changing its number-position semantics there risks breaking a
 * heavily-tested, easy-to-regress subsystem for a UX improvement that's specific to
 * typing quick references into the search bar.
 *
 * Recognitions of Clement (RCL1–RCL10) is addressed Book.Chapter.Verse, but typing
 * "Recognitions of Clement 5" read as chapter 5 of Book 1 (parseRef has no concept of
 * a third addressing level beyond its own "Book N" keyword syntax) — reported as wrong;
 * the first bare number after the edition name should mean the BOOK unless something
 * else is explicitly labeled ("book 5 chapter 3").
 *
 * Shepherd of Hermas is addressed by named section (Visions/Mandates/Similitudes) with
 * traditional Vision/Mandate/Similitude N[.sub] numbering that's mapped to the DB's own
 * flat per-book chapter numbers via hermasMap.ts — parseRef only ever produced the flat
 * chapter form ("Hermas 9"); this adds direct support for the traditional form
 * ("Hermas Vision 3", "Hermas Similitude 9.4") so the user doesn't have to know the
 * underlying flat chapter mapping to navigate there.
 */
import { resolveBookToken, isExactBookToken, maxChapterFor, type ParsedRef } from './parseRef'
import { isHermasBook, getHermasSections, type HermasBookId } from './hermasMap'

/** Fast reject before doing any word-splitting/resolveBookToken work — every other
 *  query (the overwhelming majority of keystrokes) should pay nothing for this file
 *  existing. Matches the same prefix vocabulary as parseRef.ts's own RCL/Hermas
 *  BOOK_MAP patterns (rcl/roc/recognitions.../her/hermas/shepherd...). */
const TRIGGER_RE = /^(?:\d\s*)?(?:rcl|roc|rec(?:ognitions|\s*clem)|her(?:mas)?\b|shep(?:herd)?\b)/i

function isRclBook(bookId: string): boolean {
  return /^RCL\d{1,2}$/.test(bookId)
}

// Bare/default RCL tokens that don't themselves name a specific book — only these
// trigger the "first number = book" positional reading. A token that already names
// a SPECIFIC book (e.g. "rcl5", "recognitions book 5", "rcl v") has no remaining
// book-number ambiguity; its own remainder is plain chapter[:verse].
const GENERIC_RCL_TOKENS = new Set(['rcl', 'roc', 'recognitions of clement', 'recog clement', 'rec clem'])

// Bare/default Hermas tokens that don't themselves name a specific Vision/Mandate/Similitude
// book — only these need the remainder to START with a section word ("vision 3", "similitude
// 9.4"). A token that already names a SPECIFIC Hermas book (e.g. "hermas similitudes", "her
// man") has no remaining section-word ambiguity; its remainder is plain
// section[.sub][:verse] — see resolveHermasChapterVerseOnly. Mirrors GENERIC_RCL_TOKENS above.
const GENERIC_HERMAS_TOKENS = new Set(['her', 'hermas', 'shepherd of hermas', 'shep hermas'])

function hermasSectionBookId(word: string): HermasBookId | null {
  const w = word.toLowerCase()
  if (w.startsWith('vis')) return 'HER_VIS'
  if (w.startsWith('man') || w.startsWith('command')) return 'HER_MAN'
  if (w.startsWith('sim') || w.startsWith('parable')) return 'HER_SIM'
  return null
}

function finishRcl(book: number, chapter: number, verse: number | undefined): ParsedRef | null {
  if (!Number.isFinite(book) || book < 1 || book > 10) return null
  const bookId = `RCL${book}`
  if (!Number.isFinite(chapter) || chapter < 1) return null
  const maxCh = maxChapterFor(bookId)
  if (maxCh !== undefined && chapter > maxCh) return null
  if (verse !== undefined && (verse < 1 || verse > 200)) return null
  return { bookId, chapter, verse }
}

/** Everything after the resolved "Recognitions of Clement" edition-name prefix.
 *  Empty remainder returns null (defers to the caller's existing bare-book-name
 *  fallback, which already lands on Book 1 chapter 1 the same way). */
function resolveRclRemainder(rest: string): ParsedRef | null {
  const lower = rest.toLowerCase().trim()
  if (!lower) return null

  // Explicit "book N [chapter M [:V | verse V]]" — keyword-labeled, so position no
  // longer matters; any number NOT introduced by a keyword is ignored rather than
  // guessed at, since at that point the user has opted into being explicit.
  const bookKw = lower.match(/\bbook\s+(\d{1,2})\b/)
  const chKw = lower.match(/\bch(?:apter|\.)?\s+(\d{1,3})\b/)
  const vKw = lower.match(/\bv(?:erse|\.)?\s+(\d{1,3})\b/)
  if (bookKw || chKw || vKw) {
    const book = bookKw ? parseInt(bookKw[1], 10) : undefined
    if (book === undefined) return null
    const chapter = chKw ? parseInt(chKw[1], 10) : 1
    const verse = vKw ? parseInt(vKw[1], 10) : undefined
    return finishRcl(book, chapter, verse)
  }

  // No keywords — bare numbers only. Positional: book [chapter[:verse]] — the
  // book is always the FIRST number when nothing else is labeled, per the reported
  // expectation ("recognitions of clement 5" = Book 5, not chapter 5 of Book 1).
  if (!/^[\d\s:.,-]+$/.test(lower)) return null
  const nums = lower.match(/\d{1,3}/g)
  if (!nums || nums.length < 1 || nums.length > 3) return null
  const book = parseInt(nums[0], 10)
  const chapter = nums[1] ? parseInt(nums[1], 10) : 1
  const verse = nums[2] ? parseInt(nums[2], 10) : undefined
  return finishRcl(book, chapter, verse)
}

/** Remainder for a bookToken that already names a SPECIFIC RCL book (not a generic/
 *  bare edition name) — just chapter[:verse], the same grammar parseRef itself uses. */
function resolveRclChapterVerseOnly(bookId: string, rest: string): ParsedRef | null {
  const lower = rest.toLowerCase().trim()
  if (!lower) return finishRcl(parseInt(bookId.slice(3), 10), 1, undefined)
  const m = lower.match(/^(\d{1,3})(?:\s*[:.]\s*(\d{1,3}))?$/)
  if (!m) return null
  const chapter = parseInt(m[1], 10)
  const verse = m[2] ? parseInt(m[2], 10) : undefined
  return finishRcl(parseInt(bookId.slice(3), 10), chapter, verse)
}

/** Resolve a Vision/Mandate/Similitude section number (plus optional sub-chapter and verse)
 *  to a flat-db (bookId, chapter, verse), shared by resolveHermasRemainder (generic "hermas ..."
 *  token, section word required in the remainder) and resolveHermasChapterVerseOnly (already-
 *  specific "hermas similitudes ..." token, remainder is bare numbers). */
function finishHermas(bookId: HermasBookId, sectionNum: number, subIdx: number | undefined, verse: number | undefined): ParsedRef | null {
  const section = getHermasSections(bookId).find((s) => s.sectionNum === sectionNum)
  if (!section) return null
  const chapter = subIdx !== undefined ? section.chapters[subIdx - 1] : section.chapters[0]
  if (chapter === undefined) return null
  if (verse !== undefined && (verse < 1 || verse > 200)) return null
  return { bookId, chapter, verse }
}

/** Everything after the resolved "Hermas"/"Shepherd of Hermas" edition-name prefix.
 *  Only handles the TRADITIONAL section form ("Vision 3", "Similitude 9.4", "Mandate
 *  5 verse 2") — a remainder with no recognizable section word (including an empty
 *  one, or a bare flat chapter number like "Hermas 9") returns null so the caller
 *  falls through to parseRef's existing flat-db-chapter handling, unchanged. */
function resolveHermasRemainder(rest: string): ParsedRef | null {
  const lower = rest.toLowerCase().trim()
  if (!lower) return null

  // Sub-chapter (group 3) traditionally needs a dot ("Similitude 9.4"), but a bare space
  // ("Similitude 9 4" / "hermas similitudes 9 10") means the same thing — the Nth chapter
  // within that Vision/Mandate/Similitude — so accept either separator there.
  const m = lower.match(
    /^(vis(?:ions?)?|man(?:dates?)?|commands?|sim(?:ilitudes?)?|parables?)\.?\s*(\d{1,2})(?:[.\s]\s*(\d{1,2}))?(?:\s*[:.]\s*(\d{1,3})|\s+v(?:erse|\.)?\s*(\d{1,3}))?$/
  )
  if (!m) return null

  const bookId = hermasSectionBookId(m[1])
  if (!bookId) return null
  const sectionNum = parseInt(m[2], 10)
  const subIdx = m[3] ? parseInt(m[3], 10) : undefined
  const verse = m[4] ? parseInt(m[4], 10) : m[5] ? parseInt(m[5], 10) : undefined

  return finishHermas(bookId, sectionNum, subIdx, verse)
}

/** Remainder for a bookToken that already names a SPECIFIC Hermas book via its plural alias
 *  ("hermas similitudes", "hermas mandates", ...) — a BARE SINGLE number here is deliberately
 *  left alone (returns null, deferring to parseRef's flat-db-chapter reading — "hermas visions
 *  3" means flat chapter 3, same as any other book alias, not "Vision 3" traditional numbering).
 *  A bare TWO-number form is unambiguous, though ("hermas similitudes 9 10" can't mean
 *  "flat chapter 9, flat verse 10" — Similitude editions are always addressed/discussed by
 *  section, never by a flat verse count) — so exactly that shape is read as
 *  section + sub-chapter (Similitude 9, sub-chapter 10), matching the traditional edition's own
 *  addressing convention. Punctuated forms (dot/colon/"verse") on this plural-alias token are
 *  intentionally left alone too — only the plain "N N" case had an actual reported ambiguity. */
function resolveHermasChapterVerseOnly(bookId: HermasBookId, rest: string): ParsedRef | null {
  const lower = rest.toLowerCase().trim()
  if (!lower) return finishHermas(bookId, 1, undefined, undefined)
  const m = lower.match(/^(\d{1,2})\s+(\d{1,2})$/)
  if (!m) return null
  return finishHermas(bookId, parseInt(m[1], 10), parseInt(m[2], 10), undefined)
}

/**
 * Tries the RCL/Hermas-specific grammar above. Returns null for anything that
 * doesn't look like one of these editions (including a recognized edition name
 * with a remainder neither resolver understands) — callers should fall back to
 * the general-purpose parseRef() in that case.
 */
export function parseMultiBookQuery(input: string): ParsedRef | null {
  const s = input.trim()
  if (!s || !TRIGGER_RE.test(s)) return null

  const words = s.split(/\s+/)
  for (let i = words.length; i >= 1; i--) {
    const bookToken = words.slice(0, i).join(' ')
    // Exact matches only (never resolveBookToken's own prefix/fuzzy tiers) — those
    // looser tiers can accidentally swallow part of a section word into the "book"
    // token at an intermediate word count (e.g. "hermas vision" prefix-matching
    // "Hermas, Visions" before the loop ever tries plain "hermas" alone), which
    // would hand resolveHermasRemainder a mangled remainder it can't parse.
    if (!isExactBookToken(bookToken)) continue
    const bookId = resolveBookToken(bookToken)
    if (!bookId) continue
    const rest = words.slice(i).join(' ')
    if (isRclBook(bookId)) {
      return GENERIC_RCL_TOKENS.has(bookToken.toLowerCase())
        ? resolveRclRemainder(rest)
        : resolveRclChapterVerseOnly(bookId, rest)
    }
    if (isHermasBook(bookId)) {
      return GENERIC_HERMAS_TOKENS.has(bookToken.toLowerCase())
        ? resolveHermasRemainder(rest)
        : resolveHermasChapterVerseOnly(bookId, rest)
    }
    return null
  }
  return null
}
