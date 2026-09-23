import { useAppStore, type SelectedVerseRef } from '@/store'

/**
 * Drag from a verse number across other verses to select the whole range (TEST-001) — shared by
 * the desktop reader (mouse) and the iPhone reader (touch/pen) because both render VerseRow.
 *
 * A press on a verse number becomes a drag once the pointer travels > DRAG_SLOP px; from then on
 * the verse under the pointer is hit-tested (`[data-verse-row]` rows carry book/chapter/text
 * attributes) and the store writes the live range into the tab's selection, so every row in the
 * range shows the selected treatment DURING the drag, plus the floating range badge
 * (VerseDragIndicator). Release commits; Escape / pointercancel restore the previous selection.
 * A press without travel stays a click (toggle), exactly as before.
 */
const DRAG_SLOP = 6
const EDGE = 48          // autoscroll band at the top/bottom of the scroller
const EDGE_STEP = 14

let suppressClickUntil = 0
/** VerseRow's badge onClick asks this so the click that ends a drag doesn't toggle the verse. */
export function consumeDragClick(): boolean {
  if (Date.now() < suppressClickUntil) { suppressClickUntil = 0; return true }
  return false
}

export function rowRefFromElement(el: Element | null): SelectedVerseRef | null {
  const row = el?.closest?.('[data-verse-row]') as HTMLElement | null
  if (!row) return null
  const verse = Number(row.dataset.verse)
  const chapter = Number(row.dataset.chapter)
  const bookId = row.dataset.book
  const textId = row.dataset.text
  if (!bookId || !textId || !Number.isFinite(verse) || !Number.isFinite(chapter)) return null
  return { bookId, chapter, verse, textId }
}

function availableVerses(anchorEl: Element | null, ref: SelectedVerseRef): number[] | undefined {
  const root = anchorEl?.closest?.('[data-chapter-root]') ?? document
  const rows = root.querySelectorAll<HTMLElement>(`[data-verse-row][data-book="${ref.bookId}"][data-chapter="${ref.chapter}"][data-text="${ref.textId}"]`)
  if (!rows.length) return undefined
  return Array.from(rows, (r) => Number(r.dataset.verse)).filter(Number.isFinite)
}

export function startVerseDrag(e: React.PointerEvent, tabId: string | null | undefined, anchor: SelectedVerseRef): void {
  if (!tabId) return
  if (e.pointerType === 'mouse' && e.button !== 0) return
  const startX = e.clientX, startY = e.clientY
  const badge = e.currentTarget as HTMLElement
  const pointerId = e.pointerId
  let dragging = false
  let available: number[] | undefined

  const scroller = badge.closest('[data-scroll-root], .mobile-reader-scroll') as HTMLElement | null

  const onMove = (ev: PointerEvent) => {
    if (ev.pointerId !== pointerId) return
    const store = useAppStore.getState()
    if (!dragging) {
      if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < DRAG_SLOP) return
      dragging = true
      available = availableVerses(badge, anchor)
      try { badge.setPointerCapture(pointerId) } catch { /* released already */ }
      document.documentElement.dataset.verseDragging = ''
      store.beginVerseDrag(tabId, anchor, { x: ev.clientX, y: ev.clientY })
    }
    ev.preventDefault()
    // Pointer capture retargets events to the badge — hit-test the point itself.
    const under = document.elementFromPoint(ev.clientX, ev.clientY)
    const ref = rowRefFromElement(under)
    store.updateVerseDrag(ref && ref.bookId === anchor.bookId && ref.chapter === anchor.chapter && ref.textId === anchor.textId ? ref : null, { x: ev.clientX, y: ev.clientY }, available)
    if (scroller) {
      const r = scroller.getBoundingClientRect()
      if (ev.clientY < r.top + EDGE) scroller.scrollTop -= EDGE_STEP
      else if (ev.clientY > r.bottom - EDGE) scroller.scrollTop += EDGE_STEP
    }
  }
  const finish = (commit: boolean) => {
    window.removeEventListener('pointermove', onMove, true)
    window.removeEventListener('pointerup', onUp, true)
    window.removeEventListener('pointercancel', onCancel, true)
    window.removeEventListener('keydown', onKey, true)
    delete document.documentElement.dataset.verseDragging
    try { badge.releasePointerCapture(pointerId) } catch { /* not captured */ }
    if (!dragging) return
    suppressClickUntil = Date.now() + 400
    useAppStore.getState().endVerseDrag(commit)
  }
  const onUp = (ev: PointerEvent) => { if (ev.pointerId === pointerId) finish(true) }
  const onCancel = (ev: PointerEvent) => { if (ev.pointerId === pointerId) finish(false) }
  const onKey = (ev: KeyboardEvent) => { if (ev.key === 'Escape' && dragging) { ev.preventDefault(); ev.stopPropagation(); finish(false) } }
  window.addEventListener('pointermove', onMove, true)
  window.addEventListener('pointerup', onUp, true)
  window.addEventListener('pointercancel', onCancel, true)
  window.addEventListener('keydown', onKey, true)
}
