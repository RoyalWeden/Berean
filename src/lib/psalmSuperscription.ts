// Renderer-side extraction of Psalm superscriptions ("To the chief Musician, A Psalm of
// David, when Nathan the prophet came unto him…") into a faint title line ABOVE verse 1,
// so the superscription no longer reads as part of the first verse's body.
//
// Nothing here touches the databases — the curated title data lives in ./psalmTitles.ts
// (KJV/KJVA titles verified against kjv+.bbli; Brenton title-verse counts and inline
// prefixes verified against data/lxx_brenton.db). This module just decides, per chapter,
// what the title line says and how to trim verse 1 so the title isn't shown twice.
//
// Verse numbering is preserved exactly as the DB has it (per the design decision): for a
// Brenton Psalm whose superscription occupies whole leading verses, the body still starts
// at its real verse number (2, or 3 for Ps 50/51/53/59) — those leading rows are just
// folded into the title line instead of rendered as numbered verses.

import {
  PSALM_TITLES_KJV,
  PSALM_TITLE_VERSE_COUNT_BRENTON,
  PSALM_TITLE_PREFIX_BRENTON,
} from './psalmTitles'

/** textIds this applies to. `lxx` === data/lxx_brenton.db (the only LXX text the app serves). */
const KJV_TEXT_IDS = new Set(['kjv', 'kjva'])
const BRENTON_TEXT_IDS = new Set(['lxx'])

export interface PsalmSuperscription {
  /** The faint line rendered above the first body verse. */
  titleLine: string
  /** verse_num of the first real body verse (1 normally; 2 or 3 for Brenton whole-verse titles). */
  firstBodyVerseNum: number
  /** verse_nums that are entirely superscription and must NOT render as their own numbered rows. */
  hiddenVerseNums: ReadonlySet<number>
  /** How to trim verse 1 itself (Brenton inline case, and KJVA tagged text). */
  trim:
    | { kind: 'none' }
    | { kind: 'brenton-inline-prefix'; prefix: string }
    | { kind: 'kjva-tagged-title'; title: string }
}

function normalizeWords(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ')
}

/**
 * What (if anything) to do for `${bookId} ${chapter}` in text `${textId}`. Pure — depends only
 * on the curated constants — so callers can wrap it in a cheap useMemo. Returns null when the
 * chapter has no superscription handling (every non-Psalm, Psalms with no title, unsupported
 * texts). The caller still needs the actual verse rows to fill in `titleLine` for the
 * Brenton whole-verse case (see resolveTitleLine).
 */
export function planPsalmSuperscription(
  textId: string | undefined,
  bookId: string,
  chapter: number,
): PsalmSuperscription | null {
  if (!textId || bookId !== 'PSA') return null

  if (KJV_TEXT_IDS.has(textId)) {
    const title = PSALM_TITLES_KJV[chapter]
    if (!title) return null
    return {
      titleLine: title,
      firstBodyVerseNum: 1,
      hiddenVerseNums: new Set(),
      // kjv.db `text` never carries the title; kjva.db `text_tagged` does — trimming is
      // resolved per verse in trimVerseOneTagged (only matters when Strong's is shown).
      trim: textId === 'kjva' ? { kind: 'kjva-tagged-title', title } : { kind: 'none' },
    }
  }

  if (BRENTON_TEXT_IDS.has(textId)) {
    const wholeCount = PSALM_TITLE_VERSE_COUNT_BRENTON[chapter]
    if (wholeCount && wholeCount > 0) {
      const hidden = new Set<number>()
      for (let v = 1; v <= wholeCount; v++) hidden.add(v)
      return {
        titleLine: '', // filled in from the hidden rows' text by resolveTitleLine
        firstBodyVerseNum: wholeCount + 1,
        hiddenVerseNums: hidden,
        trim: { kind: 'none' },
      }
    }
    const prefix = PSALM_TITLE_PREFIX_BRENTON[chapter]
    if (prefix) {
      return {
        titleLine: prefix,
        firstBodyVerseNum: 1,
        hiddenVerseNums: new Set(),
        trim: { kind: 'brenton-inline-prefix', prefix },
      }
    }
    return null
  }

  return null
}

/**
 * For the Brenton whole-verse case the title line is the concatenation of the hidden rows'
 * own text; everything else already has its titleLine from planPsalmSuperscription. Pass the
 * chapter's verse rows (any shape with verse_num + text).
 */
export function resolveTitleLine(
  plan: PsalmSuperscription,
  verses: ReadonlyArray<{ verse_num: number; text: string }>,
): string {
  if (plan.titleLine) return plan.titleLine
  const parts: string[] = []
  for (const v of verses) {
    if (plan.hiddenVerseNums.has(v.verse_num)) parts.push(v.text.trim())
  }
  return parts.join(' ').replace(/\s+/g, ' ').trim()
}

/**
 * Brenton inline Psalms: strip the exact superscription prefix off verse 1's plain text,
 * leaving the body. Exact match first (the prefixes were pulled verbatim from the DB); a
 * normalized fallback covers whitespace/quote drift. Returns the original text unchanged if
 * nothing matches, so a data mismatch degrades to "title shown twice" rather than eaten text.
 */
export function trimVerseOneText(text: string, plan: PsalmSuperscription): string {
  if (plan.trim.kind !== 'brenton-inline-prefix') return text
  const { prefix } = plan.trim
  if (text.startsWith(prefix)) return text.slice(prefix.length).replace(/^\s+/, '')
  const np = normalizeWords(prefix)
  const nt = normalizeWords(text)
  if (nt.startsWith(np)) {
    // Walk the raw string counting normalized words until we've consumed the prefix.
    const want = np.split(' ').length
    let seen = 0
    let i = 0
    const isWordChar = (c: string) => /[a-z0-9]/i.test(c)
    while (i < text.length && seen < want) {
      while (i < text.length && !isWordChar(text[i])) i++
      while (i < text.length && isWordChar(text[i])) i++
      seen++
    }
    while (i < text.length && !isWordChar(text[i])) i++
    if (i > 0 && i < text.length) return text.slice(i)
  }
  return text
}

const ARTIFACT_DETAG = new Set(['b>', '/b>', '', '~'])

function detagToken(t: string): string {
  return t.replace(/^[*!]+/, '').replace(/\{[^}]*\}/g, '').trim()
}

/**
 * KJVA `text_tagged` for a titled Psalm's verse 1 is prefixed with the superscription words
 * (each a `word{Hxxxx}` token). Drop exactly the leading tokens that make up the title so the
 * body's Strong's-tagged words render clean and correctly indexed. Tolerant of the 39 Psalms
 * whose tagged prefix is corrupt with stray `b>{}` / `/b>{Hxxxx}` tokens (skipped, not
 * counted). If the leading run doesn't look like the title at all, the tagged text is left
 * untouched (title then shows in both places — safe) rather than risk trimming real verse text.
 */
export function trimVerseOneTagged(textTagged: string, plan: PsalmSuperscription): string {
  const split = splitVerseOneTagged(textTagged, plan)
  return split ? split.body : textTagged
}

/**
 * The other half of the split: the Strong's-tagged tokens that MAKE UP the superscription,
 * pulled off the front of KJVA verse 1's `text_tagged` (with the corrupt `b>` / `/b>`
 * artifact tokens dropped, so they never render as literal words). Returns null when there's
 * no tagged title to extract (kjv plain text, Brenton, non-Psalm, or a prefix that doesn't
 * match the curated title) — the caller then falls back to the plain-text title line.
 */
export function extractVerseOneTaggedTitle(
  textTagged: string | null | undefined,
  plan: PsalmSuperscription,
): string | null {
  if (!textTagged) return null
  const split = splitVerseOneTagged(textTagged, plan)
  return split && split.title ? split.title : null
}

function splitVerseOneTagged(
  textTagged: string,
  plan: PsalmSuperscription,
): { title: string; body: string } | null {
  if (plan.trim.kind !== 'kjva-tagged-title') return null
  const titleWordCount = plan.trim.title.split(/\s+/).filter(Boolean).length
  const tokens = textTagged.split(/\s+/).filter(Boolean)
  if (tokens.length <= titleWordCount) return null

  let words = 0
  let i = 0
  const consumedDetagged: string[] = []
  const titleTokens: string[] = []
  for (; i < tokens.length && words < titleWordCount; i++) {
    const d = detagToken(tokens[i])
    if (ARTIFACT_DETAG.has(d)) continue // stray b> / /b> from the re-seed — drop, don't count
    consumedDetagged.push(d)
    titleTokens.push(tokens[i])
    words++
  }
  // Absorb any trailing pure-artifact tokens that sit right at the title/body seam.
  while (i < tokens.length && ARTIFACT_DETAG.has(detagToken(tokens[i]))) i++

  // Sanity: the words we consumed should read as the title. If they don't, bail out (caller
  // keeps the verse-1 tagged text intact and uses the plain-text title line). Dev builds warn.
  if (normalizeWords(consumedDetagged.join(' ')) !== normalizeWords(plan.trim.title)) {
    if (typeof process !== 'undefined' && process.env?.NODE_ENV !== 'production') {
      // eslint-disable-next-line no-console
      console.warn('[psalmSuperscription] tagged prefix did not match title; leaving verse 1 tagged text as-is', {
        title: plan.trim.title,
        consumed: consumedDetagged.join(' '),
      })
    }
    return null
  }
  return { title: titleTokens.join(' '), body: tokens.slice(i).join(' ') }
}
