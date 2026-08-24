// Shared click/Cmd-click/right-click behavior for every chapter and Strong's-number label
// rendered inside the Study Trail window (MapView, EverythingView, ReviewView). This window is
// a separate BrowserWindow/renderer from the main window — a plain in-place navigation or a
// "new tab" both have to reach the REAL main window's store, which window.app.navigateMainToRef
// does by round-tripping through the main process (see electron/main.ts's handler and
// App.tsx's onNavigateToRef listener). Only "open in a floating tab" can be done directly from
// here, since that spawns an entirely new window regardless of which window asked for it.
//
// Click semantics (matches the one existing precedent in the app, LexiconPanel's
// `onNav(target, e.metaKey || e.ctrlKey)`): plain click navigates the main window's active
// tab in place; Cmd/Ctrl+click opens a new tab there instead. Right-click always opens a
// small context menu with the same two options spelled out, plus "Open in floating tab".

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

export function trailRefClick(ref: TrailRef, e: React.MouseEvent): void {
  e.stopPropagation()
  navigateTrailRef(ref, e.metaKey || e.ctrlKey)
}

export function trailRefOpenFloating(ref: TrailRef): void {
  if (ref.kind === 'chapter') {
    window.app.openFloatingTab('bible', { bookId: ref.bookId, chapter: String(ref.chapter), ...(ref.verse != null ? { targetVerse: String(ref.verse) } : {}) })
  } else {
    window.app.openFloatingTab('lexicon', { strongsNum: ref.strongsNum })
  }
}

export function trailRefLabel(ref: TrailRef, bookLabel: (bookId: string) => string): string {
  return ref.kind === 'chapter'
    ? `${bookLabel(ref.bookId)} ${ref.chapter}${ref.verse ? `:${ref.verse}` : ''}`
    : `Strong's ${ref.strongsNum}`
}
