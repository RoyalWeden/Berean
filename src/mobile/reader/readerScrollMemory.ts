/**
 * Where each Scripture tab was reading on the phone (scroll-state audit, TEST-003 counterpart;
 * T23-003/T23-004): device-local and in-memory for the session (never synced — tabFields
 * LOCAL_FIELDS rule).
 *
 * The position is a VERSE ANCHOR — the top-most visible verse and how far it sits above/below the
 * viewport top — not a raw pixel offset. The same anchor restores the reading position in the
 * paged reader, in continuous scroll, and after a translation switch (where every pixel offset
 * changes), so none of those transitions visibly jumps the reader somewhere else.
 */
export interface ReaderAnchor { chapter: number; verse: number; offset: number }

const mem = new Map<string, { bookId: string; anchor: ReaderAnchor }>()
export const readerScrollMemory = {
  save(tabId: string, bookId: string, anchor: ReaderAnchor) { mem.set(tabId, { bookId, anchor }) },
  /** The remembered anchor for this tab when it is still in `bookId` (and `chapter`, if given). */
  restore(tabId: string, bookId: string, chapter?: number): ReaderAnchor | undefined {
    const m = mem.get(tabId)
    if (!m || m.bookId !== bookId) return undefined
    if (chapter != null && m.anchor.chapter !== chapter) return undefined
    return m.anchor
  },
  forget(tabId: string) { mem.delete(tabId) },
}

/** Top-most verse row visible in `scrollEl`, with its offset from the viewport top (≤ 0 when the
 *  verse starts above it). Rows are ChapterView's `[data-verse-row]` (data-chapter / data-verse). */
export function captureReaderAnchor(scrollEl: HTMLElement): ReaderAnchor | null {
  const top = scrollEl.getBoundingClientRect().top
  const rows = scrollEl.querySelectorAll<HTMLElement>('[data-verse-row]')
  // Rows are laid out top-to-bottom in document order, so the first row whose bottom is below
  // the viewport top is found by BINARY SEARCH — ~log2(n) layout reads per scroll frame instead
  // of one per verse above the viewport (perf pass 2026-10-05: in continuous scroll that was
  // hundreds of getBoundingClientRect calls every frame, deep in a long book).
  let lo = 0, hi = rows.length - 1, hit = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (rows[mid].getBoundingClientRect().bottom > top + 1) { hit = mid; hi = mid - 1 } else lo = mid + 1
  }
  if (hit < 0) return null
  const row = rows[hit]
  const chapter = Number(row.dataset.chapter)
  const verse = Number(row.dataset.verse)
  if (!chapter || !verse) return null
  return { chapter, verse, offset: row.getBoundingClientRect().top - top }
}

/** Scroll `scrollEl` so the anchor's verse sits where it was. False when that verse isn't rendered
 *  (e.g. the other translation has no such verse) — the caller keeps its default position. */
export function applyReaderAnchor(scrollEl: HTMLElement, anchor: ReaderAnchor): boolean {
  const row = scrollEl.querySelector<HTMLElement>(`[data-verse-row][data-chapter="${anchor.chapter}"][data-verse="${anchor.verse}"]`)
  if (!row) return false
  const delta = row.getBoundingClientRect().top - scrollEl.getBoundingClientRect().top - anchor.offset
  scrollEl.scrollTop += delta
  return true
}
