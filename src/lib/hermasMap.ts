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
// Chapters 1-8, 10-25 (gap at db-ch 9).
// Mandate 1: ch 1        | Mandate 2: ch 2        | Mandate 3: ch 3
// Mandate 4: ch 4-7      | Mandate 5: ch 8        | Mandate 6: ch 10-11
// Mandate 7: ch 12-13    | Mandate 8: ch 14       | Mandate 9: ch 15
// Mandate 10: ch 16-18   | Mandate 11: ch 19      | Mandate 12: ch 20-25
const MAN_SECTIONS: HermasSection[] = [
  { sectionName: 'Mandate 1',  sectionNum: 1,  chapters: [1] },
  { sectionName: 'Mandate 2',  sectionNum: 2,  chapters: [2] },
  { sectionName: 'Mandate 3',  sectionNum: 3,  chapters: [3] },
  { sectionName: 'Mandate 4',  sectionNum: 4,  chapters: [4,5,6,7] },
  { sectionName: 'Mandate 5',  sectionNum: 5,  chapters: [8] },
  { sectionName: 'Mandate 6',  sectionNum: 6,  chapters: [10,11] },
  { sectionName: 'Mandate 7',  sectionNum: 7,  chapters: [12,13] },
  { sectionName: 'Mandate 8',  sectionNum: 8,  chapters: [14] },
  { sectionName: 'Mandate 9',  sectionNum: 9,  chapters: [15] },
  { sectionName: 'Mandate 10', sectionNum: 10, chapters: [16,17,18] },
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

const BOOK_SECTIONS: Record<HermasBookId, HermasSection[]> = {
  HER_VIS: VIS_SECTIONS,
  HER_MAN: MAN_SECTIONS,
  HER_SIM: SIM_SECTIONS,
}

/** Returns true if bookId is one of the three Hermas books. */
export function isHermasBook(bookId: string): bookId is HermasBookId {
  return bookId === 'HER_VIS' || bookId === 'HER_MAN' || bookId === 'HER_SIM'
}

/** Returns all sections for a Hermas book. */
export function getHermasSections(bookId: HermasBookId): HermasSection[] {
  return BOOK_SECTIONS[bookId]
}

/** Returns the section containing a given flat db-chapter, or null. */
export function getHermasSection(bookId: HermasBookId, chapter: number): HermasSection | null {
  const sections = BOOK_SECTIONS[bookId]
  return sections.find((s) => s.chapters.includes(chapter)) ?? null
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
  for (const section of BOOK_SECTIONS[bookId]) {
    all.push(...section.chapters)
  }
  return all.sort((a, b) => a - b)
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
