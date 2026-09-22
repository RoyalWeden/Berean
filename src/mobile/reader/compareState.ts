import type { BibleTabState, Tab, Verse } from '@/types'
import { TRANSLATIONS } from '@/lib/bibleTexts'
import { mapChapterOnTranslationSwitch } from '@/lib/translationChapterMap'
import { bookName } from '@/lib/parseRef'

/**
 * Pure state helpers for the phone Compare page (R088). The tab-state fields are the SAME ones
 * the desktop CompareView / BiblePanel read and write (`compareMode`, `compareColumns`,
 * `compareSyncScroll` — src/types/index.ts), so a compare tab synced from the Mac opens here as
 * the same columns and vice versa. No React, no `window.*` — unit-tested in
 * src/mobile/__tests__/compare-*.test.tsx.
 */
export interface CompareColumn { textId: string; bookId: string; chapter: number; scrollPos?: { verseNum: number; frac: number } }

export const COMPARE_MAX_COLUMNS = 4
export const COMPARE_MIN_COLUMNS = 2

export function translationLabel(textId: string): string {
  return TRANSLATIONS.find((t) => t.id === textId.toLowerCase())?.label ?? textId.toUpperCase()
}

/** The columns a compare tab shows: the persisted ones, or — entering compare from a plain
 *  chapter, as the desktop "Compare translations" does — KJV vs LXX of that reference. */
export function columnsForState(state: BibleTabState): CompareColumn[] {
  // Columns persisted by an earlier build could be bare shells (`[{}, {}]` — the local-state
  // merge bug fixed in tabPersistenceRuntime); anything without a text or book is dropped.
  const valid = (state.compareColumns ?? []).filter((c) => c && typeof c.textId === 'string' && typeof c.bookId === 'string' && Number.isFinite(c.chapter))
  if (valid.length >= COMPARE_MIN_COLUMNS) return valid.map((c) => ({ ...c, textId: c.textId.toLowerCase() }))
  return defaultCompareColumns(state.bookId, state.chapter, (state.translation ?? 'kjva').toLowerCase())
}

export function defaultCompareColumns(bookId: string, chapter: number, sourceTextId: string): CompareColumn[] {
  const src = sourceTextId.toLowerCase()
  const first = src === 'lxx' ? 'lxx' : src
  const second = first === 'lxx' ? 'kjva' : 'lxx'
  // A dedicated-edition text (Enoch, Jubilees…) has no LXX counterpart — pair it with KJVA only
  // when that book exists there is not knowable here; the page drops empty columns' verses gracefully.
  return [
    { textId: first, bookId, chapter },
    { textId: second, bookId, chapter: mapChapterOnTranslationSwitch(bookId, chapter, first, second) },
  ]
}

/** Tab-state patch that turns a scripture tab into a compare tab at a verse (the phone's
 *  "Compare this verse"). `compareSyncScroll` is on: the phone's interleaved layout is inherently
 *  synced, and a same-chapter KJV/LXX pair is exactly what the Mac's toggle is for. */
export function makeCompareTabState(state: BibleTabState, verse?: number): Partial<BibleTabState> {
  return {
    compareMode: true,
    compareColumns: columnsForState({ ...state, compareColumns: undefined }),
    compareSyncScroll: true,
    targetVerse: verse ?? state.targetVerse,
  }
}

/** A brand-new compare tab (leaves the reader tab as it is) for `state` at `verse`. */
export function makeCompareTab(state: BibleTabState, verse?: number, now = Date.now()): Tab {
  const patch = makeCompareTabState(state, verse)
  const cols = patch.compareColumns ?? []
  return {
    id: `bible-compare-${now}`, spaceId: 'scripture', type: 'bible',
    title: compareTitle(cols),
    state: { bookId: state.bookId, chapter: state.chapter, translation: state.translation, showStrongs: state.showStrongs, scrollPosition: 0, ...patch },
  }
}

/** Same rule as BiblePanel's compare title effect: one reference + the translations when every
 *  column shows the same book/chapter, otherwise each column's own reference. */
export function compareTitle(cols: CompareColumn[]): string {
  if (cols.length === 0) return 'Compare'
  const refs = [...new Set(cols.map((c) => `${bookName(c.bookId)} ${c.chapter}`))]
  return refs.length === 1 ? `${refs[0]} ${cols.map((c) => c.textId.toUpperCase()).join(' / ')}` : refs.join(' / ')
}

/** Navigate every column to `bookId`/`chapter` as expressed in `sourceTextId`, remapping the
 *  chapter for columns in the other versification (KJV↔LXX Psalms/Jeremiah…). */
export function navigateColumns(cols: CompareColumn[], bookId: string, chapter: number, sourceTextId: string): CompareColumn[] {
  return cols.map((c) => ({ textId: c.textId, bookId, chapter: mapChapterOnTranslationSwitch(bookId, chapter, sourceTextId, c.textId) }))
}

export function addColumn(cols: CompareColumn[], textId: string): CompareColumn[] {
  if (cols.length >= COMPARE_MAX_COLUMNS || cols.some((c) => c.textId === textId)) return cols
  const last = cols[cols.length - 1]
  return [...cols, { textId, bookId: last.bookId, chapter: mapChapterOnTranslationSwitch(last.bookId, last.chapter, last.textId, textId) }]
}

export function removeColumn(cols: CompareColumn[], index: number): CompareColumn[] {
  return cols.filter((_, i) => i !== index)
}

export function replaceColumnText(cols: CompareColumn[], index: number, textId: string): CompareColumn[] {
  return cols.map((c, i) => i === index ? { textId, bookId: c.bookId, chapter: mapChapterOnTranslationSwitch(c.bookId, c.chapter, c.textId, textId) } : c)
}

/** Translations that can still be added (not already a column). */
export function availableTranslations(cols: CompareColumn[]): typeof TRANSLATIONS {
  const used = new Set(cols.map((c) => c.textId))
  return TRANSLATIONS.filter((t) => !used.has(t.id))
}

export interface CompareRow { verseNum: number; cells: Array<{ textId: string; verse: Verse | null }> }

/** Verse-by-verse interleave: one row per verse number present in ANY column, each column's
 *  verse (or null where that text lacks it — e.g. LXX gaps) under it, in column order. Psalm
 *  superscriptions (verse 0) come first. */
export function interleaveCompareRows(cols: Array<{ textId: string; verses: Verse[] }>): CompareRow[] {
  const nums = new Set<number>()
  for (const c of cols) for (const v of c.verses) nums.add(v.verse_num)
  return [...nums].sort((a, b) => a - b).map((verseNum) => ({
    verseNum,
    cells: cols.map((c) => ({ textId: c.textId, verse: c.verses.find((v) => v.verse_num === verseNum) ?? null })),
  }))
}
