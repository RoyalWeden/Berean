// Shared click/Cmd-click/right-click behavior for every chapter and Strong's-number label
// rendered inside the Study Trail window (MapView, EverythingView, ReviewView). This window is
// a separate BrowserWindow/renderer from the main window — a plain in-place navigation or a
// "new tab" both have to reach the REAL main window's store, which window.app.navigateMainToRef
// does by round-tripping through the main process (see electron/main.ts's handler and
// App.tsx's onNavigateToRef listener). Only "open in a floating tab" can be done directly from
// here, since that spawns an entirely new window regardless of which window asked for it.
//
// Click semantics, REVISED per direct feedback: "when clicking through the study trail, the user
// will very rarely want to actually open the verse or whatever from the study trail, so make sure
// that doesn't happen by accident" — and, concretely, "clicking the area expands/collapses,
// cmd-click navigates, clicking the exact bullet selects/highlights (dimming unrelated stops)."
//
// So a PLAIN click no longer navigates anything. Cmd/Ctrl+click navigates the main window's
// active tab in place; Cmd/Ctrl+Shift+click opens a new tab there. Right-click still opens the
// context menu with both options spelled out, plus "Open in floating tab" — that menu is now the
// discoverable path to navigation, since nothing about a bare click reveals it.

export type TrailRef =
  | { kind: 'chapter'; bookId: string; chapter: number; verse?: number }
  | { kind: 'lexicon'; strongsNum: string }

export function navigateTrailRef(ref: TrailRef, newTab: boolean): void {
  if (ref.kind === 'chapter') {
    window.app.navigateMainToRef({ kind: 'chapter', bookId: ref.bookId, chapter: ref.chapter, verse: ref.verse, newTab })
  } else {
    window.app.navigateMainToRef({ kind: 'lexicon', strongsNum: ref.strongsNum, newTab })
  }
}

/** Handles a click on a trail reference label. Returns true if it navigated, so the caller can
 *  skip whatever a plain click means for it (expanding/collapsing the row). */
export function trailRefClick(ref: TrailRef, e: React.MouseEvent): boolean {
  if (!(e.metaKey || e.ctrlKey)) return false
  e.stopPropagation()
  e.preventDefault()
  navigateTrailRef(ref, e.shiftKey)
  return true
}

export function trailRefOpenFloating(ref: TrailRef): void {
  if (ref.kind === 'chapter') {
    window.app.openFloatingTab('bible', { bookId: ref.bookId, chapter: String(ref.chapter), ...(ref.verse != null ? { targetVerse: String(ref.verse) } : {}) })
  } else {
    window.app.openFloatingTab('lexicon', { strongsNum: ref.strongsNum })
  }
}

// `bookChapterLabel` is expected to be `bookChapterVerseLabel` from '@/lib/parseRef' (passed in
// rather than imported directly here, matching how every other trailRefLabel caller already
// threads its own book-name function through) — it already comma-separates a multi-level
// edition's "Book N" from its chapter ("Recognitions, Book 1, 2" for Recognitions of Clement,
// "Hermas, Visions, 4" for Shepherd of Hermas) instead of the bare-space join this used to do,
// which read as an ambiguous run-together "Recognitions, Book 1 2".
export function trailRefLabel(ref: TrailRef, bookChapterLabel: (bookId: string, chapter: number) => string): string {
  return ref.kind === 'chapter'
    ? `${bookChapterLabel(ref.bookId, ref.chapter)}${ref.verse ? `:${ref.verse}` : ''}`
    : `Strong's ${ref.strongsNum}`
}

// Friendly fallback for the "via ..." origin line when a connection has no reasonText (the
// deliberately-never-pre-filled tier-3 case, book-chapter-picker) — reads its tags instead of
// showing raw internal tag strings like "manual" or "cross-ref:tske" verbatim.
const TAG_LABEL: Record<string, string> = {
  manual: 'typed in manually', lexicon: "a Strong's lookup", search: 'a search', note: 'a note',
  'cross-ref:tske': 'a TSKe cross-reference', 'cross-ref:classic': 'a classic cross-reference',
  'cross-ref:notes': 'a cross-reference in a note', 'ai-lookup': 'AI Lookup', popover: 'a verse popover',
  compare: 'Compare', history: 'History', reading: 'reading onward', 'tab-switch': 'switching tabs',
}

export function originDisplayText(conn: { reasonText?: string; reasonTags: string[] }): string {
  if (conn.reasonText) return conn.reasonText
  const tagText = conn.reasonTags.map((t) => TAG_LABEL[t] ?? t).join(', ')
  return tagText || 'navigation'
}
