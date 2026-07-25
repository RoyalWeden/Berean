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

/** Everything after the resolved "Hermas"/"Shepherd of Hermas" edition-name prefix.
 *  Only handles the TRADITIONAL section form ("Vision 3", "Similitude 9.4", "Mandate
 *  5 verse 2") — a remainder with no recognizable section word (including an empty
 *  one, or a bare flat chapter number like "Hermas 9") returns null so the caller
 *  falls through to parseRef's existing flat-db-chapter handling, unchanged. */
function resolveHermasRemainder(rest: string): ParsedRef | null {
  const lower = rest.toLowerCase().trim()
  if (!lower) return null

  const m = lower.match(
    /^(vis(?:ions?)?|man(?:dates?)?|commands?|sim(?:ilitudes?)?|parables?)\.?\s*(\d{1,2})(?:\.(\d{1,2}))?(?:\s*[:.]\s*(\d{1,3})|\s+v(?:erse|\.)?\s*(\d{1,3}))?$/
  )
  if (!m) return null

  const bookId = hermasSectionBookId(m[1])
  if (!bookId) return null
  const sectionNum = parseInt(m[2], 10)
  const subIdx = m[3] ? parseInt(m[3], 10) : undefined
  const verse = m[4] ? parseInt(m[4], 10) : m[5] ? parseInt(m[5], 10) : undefined

  const section = getHermasSections(bookId).find((s) => s.sectionNum === sectionNum)
  if (!section) return null
  const chapter = subIdx !== undefined ? section.chapters[subIdx - 1] : section.chapters[0]
  if (chapter === undefined) return null
  if (verse !== undefined && (verse < 1 || verse > 200)) return null

  return { bookId, chapter, verse }
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
    if (isHermasBook(bookId)) return resolveHermasRemainder(rest)
    return null
  }
  return null
}
