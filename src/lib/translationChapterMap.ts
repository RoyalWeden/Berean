/**
 * translationChapterMap.ts
 *
 * Bidirectional chapter-number mapping between KJV and LXX for books where
 * the two traditions use different chapter numbering:
 *   - Psalms: LXX merges KJV 9+10 → LXX 9; also splits/merges at Pss 113-118, 147.
 *   - Jeremiah: massive reordering in the second half of the book.
 *
 * Only chapter-level mapping is implemented (verse-level splits are ignored for
 * navigation purposes — the user lands at the beginning of the mapped chapter).
 */

/** Translation IDs that use LXX chapter numbering */
const LXX_TRANSLATION_IDS = new Set(['lxx'])

/** Translation IDs that use KJV/Hebrew chapter numbering */
const KJV_TRANSLATION_IDS = new Set(['kjva', 'kjv'])

export function isLxxTranslation(textId: string): boolean {
  return LXX_TRANSLATION_IDS.has(textId.toLowerCase())
}

export function isKjvTranslation(textId: string): boolean {
  return KJV_TRANSLATION_IDS.has(textId.toLowerCase())
}

// ── Psalms mapping ────────────────────────────────────────────────────────────
//
// KJV 1–8    = LXX 1–8   (same content, minor verse-count diffs due to superscriptions)
// KJV 9–10   = LXX 9     (merged in LXX)
// KJV 11–113 = LXX 10–112  (KJV = LXX + 1)
// KJV 114–115 = LXX 113  (merged in LXX)
// KJV 116    = LXX 114+115 (split in LXX)
// KJV 117    = LXX 116
// KJV 118    = LXX 117
// KJV 119–146 = LXX 118–145 (KJV = LXX + 1)
// KJV 147    = LXX 146+147 (split in LXX; first half = 146)
// KJV 148–150 = LXX 148–150 (same)
// LXX 151   is a bonus psalm found only in LXX (no KJV equivalent)

function psalmKjvToLxx(kjvChapter: number): number {
  if (kjvChapter <= 8)   return kjvChapter          // 1-8: same
  if (kjvChapter <= 10)  return 9                   // 9,10 → 9 (merged)
  if (kjvChapter <= 113) return kjvChapter - 1      // 11-113 → 10-112
  if (kjvChapter <= 115) return 113                 // 114,115 → 113 (merged)
  if (kjvChapter === 116) return 114                // 116 → 114 (map to first part)
  if (kjvChapter === 117) return 116
  if (kjvChapter === 118) return 117
  if (kjvChapter <= 146) return kjvChapter - 1      // 119-146 → 118-145
  if (kjvChapter === 147) return 146                // 147 → 146 (map to first part)
  return kjvChapter                                 // 148-150: same
}

function psalmLxxToKjv(lxxChapter: number): number {
  if (lxxChapter <= 8)   return lxxChapter          // 1-8: same
  if (lxxChapter === 9)  return 9                   // 9 → 9 (KJV 9+10 merged here)
  if (lxxChapter <= 112) return lxxChapter + 1      // 10-112 → 11-113
  if (lxxChapter === 113) return 114                // 113 → 114 (map to first part of merged)
  if (lxxChapter === 114) return 116                // 114 → 116 part 1
  if (lxxChapter === 115) return 116                // 115 → 116 part 2 (same KJV chapter)
  if (lxxChapter === 116) return 117
  if (lxxChapter === 117) return 118
  if (lxxChapter <= 145) return lxxChapter + 1      // 118-145 → 119-146
  if (lxxChapter === 146) return 147                // 146 → 147 part 1
  if (lxxChapter === 147) return 147                // 147 → 147 part 2 (same KJV chapter)
  return lxxChapter                                 // 148-151: same (151 is LXX-only)
}

// ── Jeremiah mapping ──────────────────────────────────────────────────────────
//
// KJV 1–25  ≈ LXX 1–25 (same chapters, though some verses differ)
// KJV 26–44 → LXX 33–51 (offset +7; KJV 45 also maps to LXX 51)
// KJV 46    → LXX 26
// KJV 47    → LXX 29
// KJV 48    → LXX 31
// KJV 49    → LXX 30
// KJV 50    → LXX 27
// KJV 51    → LXX 28
// KJV 52    → LXX 52

const JER_KJV_TO_LXX: Record<number, number> = {
  26: 33, 27: 34, 28: 35, 29: 36, 30: 37, 31: 38, 32: 39,
  33: 40, 34: 41, 35: 42, 36: 43, 37: 44, 38: 45, 39: 46,
  40: 47, 41: 48, 42: 49, 43: 50, 44: 51, 45: 51,
  46: 26, 47: 29, 48: 31, 49: 30, 50: 27, 51: 28,
}

const JER_LXX_TO_KJV: Record<number, number> = {
  26: 46, 27: 50, 28: 51, 29: 47, 30: 49, 31: 48,
  33: 26, 34: 27, 35: 28, 36: 29, 37: 30, 38: 31, 39: 32,
  40: 33, 41: 34, 42: 35, 43: 36, 44: 37, 45: 38, 46: 39,
  47: 40, 48: 41, 49: 42, 50: 43, 51: 44,
}

function jerKjvToLxx(kjvChapter: number): number {
  return JER_KJV_TO_LXX[kjvChapter] ?? kjvChapter
}

function jerLxxToKjv(lxxChapter: number): number {
  return JER_LXX_TO_KJV[lxxChapter] ?? lxxChapter
}

// ── Joel mapping ──────────────────────────────────────────────────────────────
//
// The LXX (and Hebrew) split KJV's Joel 2 — KJV 2:28-32 becomes LXX chapter 3,
// pushing KJV 3 to LXX 4. So the LXX has 4 chapters, the KJV has 3.
//   KJV 1 = LXX 1
//   KJV 2 = LXX 2  (KJV 2:1-27)  — and KJV 2:28-32 = LXX 3
//   KJV 3 = LXX 4
const JOL_KJV_TO_LXX: Record<number, number> = { 1: 1, 2: 2, 3: 4 }
const JOL_LXX_TO_KJV: Record<number, number> = { 1: 1, 2: 2, 3: 2, 4: 3 }

// ── Malachi mapping ───────────────────────────────────────────────────────────
//
// The LXX/Hebrew have 3 chapters; the KJV splits the last into 3 and 4
// (KJV 4:1-6 = LXX/Hebrew 3:19-24). So KJV chapter 4 maps onto LXX chapter 3.
const MAL_KJV_TO_LXX: Record<number, number> = { 1: 1, 2: 2, 3: 3, 4: 3 }
const MAL_LXX_TO_KJV: Record<number, number> = { 1: 1, 2: 2, 3: 3 }

const recordMap = (m: Record<number, number>) => (ch: number): number => m[ch] ?? ch

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Map a chapter number when switching FROM one translation TO another.
 * Returns the mapped chapter (1-based), or the original if no mapping applies.
 *
 * @param bookId  The book ID (e.g. 'PSA', 'JER')
 * @param chapter The chapter number in the *source* translation
 * @param fromTextId  The translation being switched away from
 * @param toTextId    The translation being switched to
 */
export function mapChapterOnTranslationSwitch(
  bookId: string,
  chapter: number,
  fromTextId: string,
  toTextId: string,
): number {
  const from = fromTextId.toLowerCase()
  const to = toTextId.toLowerCase()

  // No mapping needed between same-tradition translations
  if (isLxxTranslation(from) === isLxxTranslation(to)) return chapter

  const book = bookId.toUpperCase()

  if (book === 'PSA') {
    if (isKjvTranslation(from) && isLxxTranslation(to)) return psalmKjvToLxx(chapter)
    if (isLxxTranslation(from) && isKjvTranslation(to)) return psalmLxxToKjv(chapter)
  }

  if (book === 'JER') {
    if (isKjvTranslation(from) && isLxxTranslation(to)) return jerKjvToLxx(chapter)
    if (isLxxTranslation(from) && isKjvTranslation(to)) return jerLxxToKjv(chapter)
  }

  if (book === 'JOL') {
    if (isKjvTranslation(from) && isLxxTranslation(to)) return recordMap(JOL_KJV_TO_LXX)(chapter)
    if (isLxxTranslation(from) && isKjvTranslation(to)) return recordMap(JOL_LXX_TO_KJV)(chapter)
  }

  if (book === 'MAL') {
    if (isKjvTranslation(from) && isLxxTranslation(to)) return recordMap(MAL_KJV_TO_LXX)(chapter)
    if (isLxxTranslation(from) && isKjvTranslation(to)) return recordMap(MAL_LXX_TO_KJV)(chapter)
  }

  return chapter
}

/**
 * Maps a chapter as displayed in `textId` to its KJV-equivalent chapter(s), for querying
 * translation-agnostic (KJV-keyed) data — user notes, `cross_references.db`, and
 * `tske_refs.db` are all keyed to KJV/Hebrew chapter numbers regardless of which
 * translation is currently on screen.
 *
 * Returns an array because an LXX merge chapter legitimately corresponds to TWO KJV
 * chapters — e.g. LXX Psalm 9 merges KJV Psalms 9 and 10, so content and notes/cross-refs
 * for BOTH KJV chapters need to be pulled in when viewing LXX Psalm 9. Callers should
 * query/union across every entry returned, not just the first.
 *
 * Only Psalms has this offset in Berean's current data (see the module comment above) —
 * every other book, and every non-LXX `textId`, is an identity mapping (`[chapter]`).
 */
export function toCanonicalChapters(bookId: string, chapter: number, textId: string): number[] {
  if (bookId.toUpperCase() !== 'PSA' || !isLxxTranslation(textId)) return [chapter]
  if (chapter === 9) return [9, 10]      // LXX 9 = KJV 9+10 merged
  if (chapter === 113) return [114, 115] // LXX 113 = KJV 114+115 merged
  return [psalmLxxToKjv(chapter)]
}

/**
 * General bidirectional form of `toCanonicalChapters`: maps a chapter as displayed in
 * `fromTextId` to the chapter number(s) it corresponds to in `toTextId`'s own numbering.
 * Used for cross-linking user notes between KJV and LXX (unlike cross-references/TSKe,
 * notes can be created under EITHER numbering system, so the target side isn't always
 * KJV). Returns multiple entries whenever the source chapter spans more than one chapter
 * in the target numbering — an LXX→KJV merge chapter, or a KJV→LXX split chapter.
 *
 *   equivalentChapters(bookId, chapter, textId, 'kjva') === toCanonicalChapters(bookId, chapter, textId)
 */
export function equivalentChapters(
  bookId: string,
  chapter: number,
  fromTextId: string,
  toTextId: string,
): number[] {
  const from = fromTextId.toLowerCase()
  const to = toTextId.toLowerCase()
  if (isLxxTranslation(from) === isLxxTranslation(to)) return [chapter]

  if (bookId.toUpperCase() === 'PSA') {
    if (isLxxTranslation(from) && isKjvTranslation(to)) return toCanonicalChapters(bookId, chapter, fromTextId)
    if (isKjvTranslation(from) && isLxxTranslation(to)) {
      if (chapter === 116) return [114, 115] // KJV 116 splits into LXX 114+115
      if (chapter === 147) return [146, 147] // KJV 147 splits into LXX 146+147
      return [psalmKjvToLxx(chapter)]
    }
  }

  return [mapChapterOnTranslationSwitch(bookId, chapter, fromTextId, toTextId)]
}

// ── Books with a divergent LXX chapter count for a more fundamental reason than the simple
// merge/split/offset renumbering above (verified via `sqlite3 data/kjva.db`/
// `data/lxx_brenton.db`: `SELECT book_id, COUNT(DISTINCT chapter) ...` against this app's own
// data) — a different book split, Greek-only additions, or reordered material, not something a
// chapter-number FUNCTION can express. These get a one-line reader note only, never a claimed
// chapter mapping. ──
export const STRUCTURAL_NOTES: Record<string, string> = {
  EZR: "The Septuagint's Ezra (23 chapters) corresponds to the KJV's Ezra (10 chapters) AND Nehemiah (13 chapters) combined into one continuous book — the Greek tradition never separated them.",
  ESG: 'Esther in the Septuagint interleaves several whole passages ("Additions to Esther") that don\'t exist in the Hebrew/KJV text at all, so chapter numbers here don\'t line up with the KJV.',
  BAR: "The KJV Apocrypha's Baruch has 6 chapters, with the Epistle of Jeremiah appended as chapter 6. The Septuagint keeps Baruch and the Epistle of Jeremiah as two separate books, so LXX Baruch chapter 6 doesn't exist — see the Epistle of Jeremiah (LJE) instead.",
  PRO: 'The Septuagint reorders and renumbers a block of chapters in the second half of Proverbs (roughly chapters 24-31) differently from the KJV — chapter numbers there are not a simple one-to-one match.',
  SIR: 'Sirach (Ecclesiasticus) has a long-standing double versification tradition (Greek vs. later editorial numbering) — chapter/verse numbers past the earlier chapters commonly run one behind the KJV Apocrypha edition.',
}

/**
 * Human-readable note for a reader banner, when the current book/chapter/translation is one
 * `mapChapterOnTranslationSwitch` remaps (Psalms/Jeremiah/Joel/Malachi in LXX) or one of
 * STRUCTURAL_NOTES' books — or null when nothing about this reference needs explaining.
 */
export function versificationNote(bookId: string, chapter: number, textId: string): string | null {
  const book = bookId.toUpperCase()
  if (STRUCTURAL_NOTES[book] && isLxxTranslation(textId)) return STRUCTURAL_NOTES[book]
  if (!isLxxTranslation(textId)) return null
  if (book !== 'PSA' && book !== 'JER' && book !== 'JOL' && book !== 'MAL') return null
  const kjvChapter = mapChapterOnTranslationSwitch(book, chapter, textId, 'kjva')
  // MAL chapter 3 is a special case checked below even though it chapter-maps to itself (3→3)
  // — it's the identity range for MOST of the chapter, but verses 19+ are actually KJV
  // Malachi 4, so it still needs its own note despite `kjvChapter === chapter`.
  if (kjvChapter === chapter && book !== 'PSA' && !(book === 'MAL' && chapter === 3)) return null
  if (book === 'PSA') {
    if (chapter === 9) return 'This LXX chapter combines MT/KJV Psalms 9 and 10.'
    if (chapter === 113) return 'This LXX chapter combines MT/KJV Psalms 114 and 115.'
    if (chapter === 114 || chapter === 115) return `This LXX chapter is part of MT/KJV Psalm 116 (${chapter === 114 ? 'verses 1-9' : 'verses 10-19'}).`
    if (chapter === 146 || chapter === 147) return `This LXX chapter is part of MT/KJV Psalm 147 (${chapter === 146 ? 'verses 1-11' : 'verses 12-20'}).`
    if (chapter === 151) return 'Psalm 151 has no Masoretic/KJV counterpart — it survives only in the Septuagint and among the Dead Sea Scrolls.'
    if (kjvChapter === chapter) return null
    return `LXX Psalm ${chapter} = MT/KJV Psalm ${kjvChapter}.`
  }
  if (book === 'JOL') {
    if (chapter === 3) return 'This LXX chapter is MT/KJV Joel 2:28-32.'
    if (kjvChapter === chapter) return null
    return `LXX Joel ${chapter} = MT/KJV Joel ${kjvChapter}.`
  }
  if (book === 'MAL') {
    if (chapter === 3) return 'This LXX chapter includes MT/KJV Malachi 3 and, from verse 19, Malachi 4.'
    return null
  }
  if (kjvChapter === chapter) return null
  return `LXX Jeremiah ${chapter} = MT/KJV Jeremiah ${kjvChapter} — the Septuagint reorders the second half of Jeremiah.`
}
