import type { BibleTabState, Tab } from '@/types'
import { bookName } from '@/lib/parseRef'
import { compareCounterpart } from '@/lib/textCoverage'
import { equivalentChapters } from '@/lib/translationChapterMap'
import { displayChapter } from '@/lib/chapterNumbering'

/**
 * Pure state helpers for the phone Compare page (R088, T23-022…T23-027). Compare is LXX ↔ KJVA
 * only: the left column is the text the user came from, the right its counterpart
 * (`compareCounterpart` — versification-aware). The tab-state fields are the SAME ones the
 * desktop CompareView / BiblePanel read and write (`compareMode`, `compareColumns`,
 * `compareSyncScroll` — src/types/index.ts), so a compare tab synced from the Mac opens here and
 * vice versa; older / Mac states listing other or extra texts are sanitized to the pair.
 * No React, no `window.*` — unit-tested in src/lib/__tests__/compareState.test.ts.
 */
export interface CompareColumn { textId: string; bookId: string; chapter: number; scrollPos?: { verseNum: number; frac: number } }

const isPairText = (id: string) => id === 'lxx' || id === 'kjva' || id === 'kjv'

/** Short column label: "LXX" / "KJV" (never "KJVA+"). */
export function translationLabel(textId: string): string {
  const id = textId.toLowerCase()
  if (id === 'lxx') return 'LXX'
  if (id === 'kjva' || id === 'kjv') return 'KJV'
  return textId.toUpperCase()
}

/** Spoken column name for aria-labels. */
export function translationSpokenName(textId: string): string {
  return textId.toLowerCase() === 'lxx' ? 'Septuagint' : 'King James'
}

/** The compare anchor (left column) a tab state implies: the first persisted LXX/KJV column,
 *  else the tab's own reference and translation. Always returned, even when not comparable. */
export function compareAnchor(state: BibleTabState): CompareColumn {
  // Columns persisted by an earlier build could be bare shells (`[{}, {}]`); drop those.
  const valid = (state.compareColumns ?? []).filter((c) => c && typeof c.textId === 'string' && typeof c.bookId === 'string' && Number.isFinite(c.chapter))
  const first = valid.find((c) => isPairText(c.textId.toLowerCase()))
  if (first) return { textId: first.textId.toLowerCase(), bookId: first.bookId, chapter: first.chapter }
  const t = (state.translation ?? 'kjva').toLowerCase()
  return { textId: isPairText(t) ? t : 'kjva', bookId: state.bookId, chapter: state.chapter }
}

/** The LXX ↔ KJVA pair for `left`, or null when Compare does not apply there. `preferRightChapter`
 *  keeps a persisted right-hand chapter when it is still an equivalent one (KJV Ps 116 ↔ LXX 115). */
export function comparePair(left: CompareColumn, preferRightChapter?: number): [CompareColumn, CompareColumn] | null {
  const cp = compareCounterpart(left.textId, left.bookId, left.chapter)
  if (!cp) return null
  const eq = equivalentChapters(left.bookId, left.chapter, left.textId, cp.textId)
  const chapter = preferRightChapter != null && eq.includes(preferRightChapter) ? preferRightChapter : cp.chapter
  return [{ textId: left.textId, bookId: left.bookId, chapter: left.chapter }, { textId: cp.textId, bookId: left.bookId, chapter }]
}

/** The two columns a compare tab shows, sanitized to the LXX ↔ KJVA pair; null when the state's
 *  reference has no counterpart (e.g. a restored NT compare tab). */
export function columnsForState(state: BibleTabState): [CompareColumn, CompareColumn] | null {
  const left = compareAnchor(state)
  const leftIsLxx = left.textId === 'lxx'
  const right = (state.compareColumns ?? []).find((c) => c && typeof c.textId === 'string' && isPairText(c.textId.toLowerCase())
    && (c.textId.toLowerCase() === 'lxx') !== leftIsLxx && c.bookId === left.bookId && Number.isFinite(c.chapter))
  return comparePair(left, right?.chapter)
}

/** Tab-state patch that turns a scripture tab into a compare tab at a verse (the phone's
 *  "Compare this verse"). Scroll sync is on by default. */
export function makeCompareTabState(state: BibleTabState, verse?: number): Partial<BibleTabState> {
  const base = { ...state, compareColumns: undefined }
  return {
    compareMode: true,
    compareColumns: columnsForState(base) ?? [compareAnchor(base)],
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
  const refs = [...new Set(cols.map((c) => `${bookName(c.bookId)} ${displayChapter(c.bookId, c.chapter)}`))]
  return refs.length === 1 ? `${refs[0]} ${cols.map((c) => c.textId.toUpperCase()).join(' / ')}` : refs.join(' / ')
}

/** Columns after navigating to `bookId` `chapter` (numbered in the left text). Not comparable →
 *  just the left column, so the page shows its empty state yet keeps the user's text. */
export function navigateColumns(left: CompareColumn, bookId: string, chapter: number): CompareColumn[] {
  const next = { textId: left.textId, bookId, chapter }
  return comparePair(next) ?? [next]
}

/** Right column becomes the left and vice versa (each keeps its own chapter). */
export function swapColumns(cols: [CompareColumn, CompareColumn]): [CompareColumn, CompareColumn] {
  return [cols[1], cols[0]]
}

/** The verse on the other side matching `verseNum`: the same number when present, else the
 *  nearest lower one, else the first. `verseNums` must be ascending. */
export function correspondingVerse(verseNums: number[], verseNum: number): number | null {
  if (verseNums.length === 0) return null
  let best: number | null = null
  for (const n of verseNums) { if (n <= verseNum) best = n; else break }
  return best ?? verseNums[0]
}
