/**
 * Shepherd of Hermas chapter → section mapping.
 *
 * The database stores flat sequential chapter numbers for each of the three
 * Hermas books (HER_VIS, HER_MAN, HER_SIM). The traditional scholarly
 * structure is hierarchical: 5 Visions, 12 Mandates, 10 Similitudes — each
 * with sub-chapters.  This module maps between the two.
 *
 * Database chapter counts:
 *   HER_VIS: 25 chapters  (Visions 1–5)
 *   HER_MAN: 24 chapters  (Mandates 1–12; gap at db-ch 9)
 *   HER_SIM: 65 chapters  (Similitudes 1–10; Sim 7 absent)
 */

export type HermasBookId = 'HER_VIS' | 'HER_MAN' | 'HER_SIM'

export interface HermasSection {
  /** Human-readable section name, e.g. "Vision 3", "Mandate 12", "Similitude 9" */
  sectionName: string
  /** 1-based section number within its type (1–5, 1–12, 1–10) */
  sectionNum: number
  /** Database chapter numbers belonging to this section */
  chapters: number[]
}

// ── Vision map ──────────────────────────────────────────────────────────────
// Vision 1: ch 1-4  | Vision 2: ch 5-8  | Vision 3: ch 9-21
// Vision 4: ch 22-24 | Vision 5: ch 25
const VIS_SECTIONS: HermasSection[] = [
  { sectionName: 'Vision 1',  sectionNum: 1, chapters: [1,2,3,4] },
  { sectionName: 'Vision 2',  sectionNum: 2, chapters: [5,6,7,8] },
  { sectionName: 'Vision 3',  sectionNum: 3, chapters: [9,10,11,12,13,14,15,16,17,18,19,20,21] },
  { sectionName: 'Vision 4',  sectionNum: 4, chapters: [22,23,24] },
  { sectionName: 'Vision 5',  sectionNum: 5, chapters: [25] },
]

// ── Mandate map ─────────────────────────────────────────────────────────────
// DB chapters 1-8, 10-25 (gap at db-ch 9, at the Mandate 4 → Mandate 5 boundary).
// Boundaries verified against the actual text (Roberts-Donaldson):
//   db4  "I have never spoken a true word" → Mandate 3 (truth/lying)
//   db5  "guard your chastity"             → Mandate 4 (chastity/marriage)
//   db10 "Be patient"                      → Mandate 5 (patience/anger)
//   db12 "the first commandment…faith"     → Mandate 6 (the two angels)
//   db14 "Fear the Lord"                   → Mandate 7
//   db15 "self-restraint is twofold"       → Mandate 8
//   db16 "put away doubting"               → Mandate 9
//   db17 "grief, the sister of doubt"      → Mandate 10
//   db19 "a false prophet"                 → Mandate 11
//   db20 "put away wicked desire"          → Mandate 12
const MAN_SECTIONS: HermasSection[] = [
  { sectionName: 'Mandate 1',  sectionNum: 1,  chapters: [1] },
  { sectionName: 'Mandate 2',  sectionNum: 2,  chapters: [2] },
  { sectionName: 'Mandate 3',  sectionNum: 3,  chapters: [3,4] },
  { sectionName: 'Mandate 4',  sectionNum: 4,  chapters: [5,6,7,8] },
  { sectionName: 'Mandate 5',  sectionNum: 5,  chapters: [10,11] },
  { sectionName: 'Mandate 6',  sectionNum: 6,  chapters: [12,13] },
  { sectionName: 'Mandate 7',  sectionNum: 7,  chapters: [14] },
  { sectionName: 'Mandate 8',  sectionNum: 8,  chapters: [15] },
  { sectionName: 'Mandate 9',  sectionNum: 9,  chapters: [16] },
  { sectionName: 'Mandate 10', sectionNum: 10, chapters: [17,18] },
  { sectionName: 'Mandate 11', sectionNum: 11, chapters: [19] },
  { sectionName: 'Mandate 12', sectionNum: 12, chapters: [20,21,22,23,24,25] },
]

// ── Similitude map ──────────────────────────────────────────────────────────
// Similitude 1: ch 1    | Similitude 2: ch 2    | Similitude 3: ch 3
// Similitude 4: ch 4    | Similitude 5: ch 5-11  | Similitude 6: ch 12-17
// Similitude 7: absent  | Similitude 8: ch 18-28 | Similitude 9: ch 29-61
// Similitude 10: ch 62-65
const SIM_SECTIONS: HermasSection[] = [
  { sectionName: 'Similitude 1',  sectionNum: 1,  chapters: [1] },
  { sectionName: 'Similitude 2',  sectionNum: 2,  chapters: [2] },
  { sectionName: 'Similitude 3',  sectionNum: 3,  chapters: [3] },
  { sectionName: 'Similitude 4',  sectionNum: 4,  chapters: [4] },
  { sectionName: 'Similitude 5',  sectionNum: 5,  chapters: [5,6,7,8,9,10,11] },
  { sectionName: 'Similitude 6',  sectionNum: 6,  chapters: [12,13,14,15,16,17] },
  // Similitude 7 is absent from this database
  { sectionName: 'Similitude 8',  sectionNum: 8,  chapters: [18,19,20,21,22,23,24,25,26,27,28] },
  { sectionName: 'Similitude 9',  sectionNum: 9,  chapters: Array.from({ length: 33 }, (_, i) => 29 + i) },
  { sectionName: 'Similitude 10', sectionNum: 10, chapters: [62,63,64,65] },
]

const BOOK_SECTIONS_RD: Record<HermasBookId, HermasSection[]> = {
  HER_VIS: VIS_SECTIONS,
  HER_MAN: MAN_SECTIONS,
  HER_SIM: SIM_SECTIONS,
}

// ── Taylor map ──────────────────────────────────────────────────────────────
// Charles Taylor (1903–1906) uses finer, sentence-level verse divisions and his
// own chapter boundaries, which differ from Roberts-Donaldson in several places
// (e.g. Mandate 3 is undivided, Mandate 10 has 3 chapters, Similitude 6 has 5)
// and — unlike the RD database — Taylor INCLUDES Similitude 7. The Taylor text DB
// (hermas_taylor.db) is numbered with its own flat sequence, so navigation and
// labels must use this map whenever the Taylor translation is active.
const VIS_SECTIONS_TAYLOR: HermasSection[] = [
  { sectionName: 'Vision 1', sectionNum: 1, chapters: [1,2,3,4] },
  { sectionName: 'Vision 2', sectionNum: 2, chapters: [5,6,7,8] },
  { sectionName: 'Vision 3', sectionNum: 3, chapters: [9,10,11,12,13,14,15,16,17,18,19,20,21] },
  { sectionName: 'Vision 4', sectionNum: 4, chapters: [22,23,24] },
  { sectionName: 'Vision 5', sectionNum: 5, chapters: [25] },
]
const MAN_SECTIONS_TAYLOR: HermasSection[] = [
  { sectionName: 'Mandate 1',  sectionNum: 1,  chapters: [1] },
  { sectionName: 'Mandate 2',  sectionNum: 2,  chapters: [2] },
  { sectionName: 'Mandate 3',  sectionNum: 3,  chapters: [3] },
  { sectionName: 'Mandate 4',  sectionNum: 4,  chapters: [4,5,6,7] },
  { sectionName: 'Mandate 5',  sectionNum: 5,  chapters: [8,9] },
  { sectionName: 'Mandate 6',  sectionNum: 6,  chapters: [10,11] },
  { sectionName: 'Mandate 7',  sectionNum: 7,  chapters: [12] },
  { sectionName: 'Mandate 8',  sectionNum: 8,  chapters: [13] },
  { sectionName: 'Mandate 9',  sectionNum: 9,  chapters: [14] },
  { sectionName: 'Mandate 10', sectionNum: 10, chapters: [15,16,17] },
  { sectionName: 'Mandate 11', sectionNum: 11, chapters: [18] },
  { sectionName: 'Mandate 12', sectionNum: 12, chapters: [19,20,21,22,23,24] },
]
const SIM_SECTIONS_TAYLOR: HermasSection[] = [
  { sectionName: 'Similitude 1',  sectionNum: 1,  chapters: [1] },
  { sectionName: 'Similitude 2',  sectionNum: 2,  chapters: [2] },
  { sectionName: 'Similitude 3',  sectionNum: 3,  chapters: [3] },
  { sectionName: 'Similitude 4',  sectionNum: 4,  chapters: [4] },
  { sectionName: 'Similitude 5',  sectionNum: 5,  chapters: [5,6,7,8,9,10,11] },
  { sectionName: 'Similitude 6',  sectionNum: 6,  chapters: [12,13,14,15,16] },
  { sectionName: 'Similitude 7',  sectionNum: 7,  chapters: [17] },
  { sectionName: 'Similitude 8',  sectionNum: 8,  chapters: [18,19,20,21,22,23,24,25,26,27,28] },
  { sectionName: 'Similitude 9',  sectionNum: 9,  chapters: Array.from({ length: 33 }, (_, i) => 29 + i) },
  { sectionName: 'Similitude 10', sectionNum: 10, chapters: [62,63,64,65] },
]
const BOOK_SECTIONS_TAYLOR: Record<HermasBookId, HermasSection[]> = {
  HER_VIS: VIS_SECTIONS_TAYLOR,
  HER_MAN: MAN_SECTIONS_TAYLOR,
  HER_SIM: SIM_SECTIONS_TAYLOR,
}

export type HermasVariant = 'rd' | 'taylor'

// Module-level active variant. Set from the store (see App.tsx) so the pure
// hermasMap helpers — consumed by many call sites — pick the right section map
// without threading the translation through every signature.
let activeVariant: HermasVariant = 'rd'

/** Set the active Hermas section map. 'taylor' ↔ textId 'hermas_taylor'. */
export function setHermasVariant(variant: HermasVariant): void {
  activeVariant = variant
}

/** Map a textId to the matching section-map variant. */
export function hermasVariantForTextId(textId: string | null | undefined): HermasVariant {
  return textId === 'hermas_taylor' ? 'taylor' : 'rd'
}

function sectionsFor(bookId: HermasBookId): HermasSection[] {
  return (activeVariant === 'taylor' ? BOOK_SECTIONS_TAYLOR : BOOK_SECTIONS_RD)[bookId]
}

/** Returns true if bookId is one of the three Hermas books. */
export function isHermasBook(bookId: string): bookId is HermasBookId {
  return bookId === 'HER_VIS' || bookId === 'HER_MAN' || bookId === 'HER_SIM'
}

/** Returns all sections for a Hermas book (honors the active translation variant). */
export function getHermasSections(bookId: HermasBookId): HermasSection[] {
  return sectionsFor(bookId)
}

/** Returns the section containing a given flat db-chapter, or null. */
export function getHermasSection(bookId: HermasBookId, chapter: number): HermasSection | null {
  return sectionsFor(bookId).find((s) => s.chapters.includes(chapter)) ?? null
}

/**
 * Returns a human-readable label for a db chapter, e.g.:
 *   HER_VIS ch 9  → "Vision 3.1"
 *   HER_MAN ch 4  → "Mandate 4.1"
 *   HER_SIM ch 62 → "Similitude 10.1"
 *
 * If the section has only one chapter the sub-chapter index is omitted:
 *   HER_VIS ch 25 → "Vision 5"
 */
export function getHermasChapterLabel(bookId: HermasBookId, chapter: number): string {
  const section = getHermasSection(bookId, chapter)
  if (!section) return `Chapter ${chapter}`
  if (section.chapters.length === 1) return section.sectionName
  const subIdx = section.chapters.indexOf(chapter) + 1
  return `${section.sectionName}.${subIdx}`
}

/**
 * Short abbreviation for a Hermas chapter, e.g.:
 *   Vision 3.1  → "Vis. 3.1"
 *   Mandate 12  → "Man. 12"
 *   Similitude 9.15 → "Sim. 9.15"
 */
export function getHermasShortLabel(bookId: HermasBookId, chapter: number): string {
  const label = getHermasChapterLabel(bookId, chapter)
  return label
    .replace('Vision', 'Vis.')
    .replace('Mandate', 'Man.')
    .replace('Similitude', 'Sim.')
}

/**
 * Returns the first db-chapter of a section (useful for navigation to a section).
 */
export function getHermasSectionFirstChapter(section: HermasSection): number {
  return section.chapters[0]
}

/**
 * Returns the sorted list of all valid db-chapter numbers for a Hermas book.
 * (Skips any gaps in the db, e.g. HER_MAN ch 9 is absent.)
 */
export function getHermasValidChapters(bookId: HermasBookId): number[] {
  const all: number[] = []
  for (const section of sectionsFor(bookId)) {
    all.push(...section.chapters)
  }
  return all.sort((a, b) => a - b)
}

/** Valid db-chapters for a book under a specific variant (independent of the active one). */
export function getHermasValidChaptersFor(bookId: HermasBookId, variant: HermasVariant): number[] {
  const map = variant === 'taylor' ? BOOK_SECTIONS_TAYLOR : BOOK_SECTIONS_RD
  return map[bookId].flatMap((s) => s.chapters).sort((a, b) => a - b)
}

/**
 * Clamp a flat chapter to one that is valid for the target variant. Used when switching
 * Hermas translations: the RD and Taylor databases have different valid chapter sets
 * (e.g. RD HER_MAN has a gap at ch 9 and runs to 25; Taylor is contiguous 1–24). Keeps
 * the same chapter when valid, otherwise snaps to the nearest valid chapter.
 */
export function clampHermasChapter(bookId: HermasBookId, chapter: number, variant: HermasVariant): number {
  const valid = getHermasValidChaptersFor(bookId, variant)
  if (valid.includes(chapter)) return chapter
  return valid.reduce((best, c) => (Math.abs(c - chapter) < Math.abs(best - chapter) ? c : best), valid[0] ?? 1)
}

/**
 * Returns the previous valid db-chapter for a Hermas book, or null if at the start.
 */
export function getHermasPrevChapter(bookId: HermasBookId, chapter: number): number | null {
  const valid = getHermasValidChapters(bookId)
  const idx = valid.lastIndexOf(chapter)
  if (idx <= 0) return null
  return valid[idx - 1]
}

/**
 * Returns the next valid db-chapter for a Hermas book, or null if at the end.
 */
export function getHermasNextChapter(bookId: HermasBookId, chapter: number): number | null {
  const valid = getHermasValidChapters(bookId)
  const idx = valid.indexOf(chapter)
  if (idx < 0 || idx >= valid.length - 1) return null
  return valid[idx + 1]
}
