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

  return chapter
}
