// Pure math for the notes editor's "cursor-follow scroll while typing" behavior
// (NoteEditorPM.tsx) — kept separate from the ProseMirror wiring so the actual
// threshold logic is unit-testable without a real browser layout (jsdom's
// getBoundingClientRect always returns zeros, so this can't be meaningfully
// exercised through the live EditorView in tests — see this file's test for
// the honest scope of what's covered).
//
// Standard `scroll2cursor`-style technique referenced in ProseMirror community
// discussions: only nudge the scroll position when the caret has actually left
// a "comfortable" buffer near the top/bottom edge of the visible viewport,
// rather than re-centering or scrolling on every keystroke regardless of where
// the caret already is. Mirrors the same "only scroll when out of the
// comfortable zone" shape as ChapterView.tsx's Read Aloud auto-follow effect
// (compare a target rect against a viewport rect, scroll only if it's actually
// outside).

export interface CaretRectLike { top: number; bottom: number }
export interface ViewportRectLike { top: number; bottom: number }
export interface CaretScrollMargins { topMargin: number; bottomMargin: number }

// Small enough that typing anywhere in the comfortable middle of the pane never
// triggers a scroll; large enough that the caret doesn't visually touch the very
// edge of the pane before the view catches up. Judgment call, not derived from
// any spec — tuned to roughly one line-height of breathing room.
export const DEFAULT_CARET_SCROLL_MARGINS: CaretScrollMargins = { topMargin: 12, bottomMargin: 32 }

/**
 * Returns the scrollTop delta needed to bring `caret` back into the comfortable
 * zone of `viewport`, or 0 if it's already comfortably inside. Positive means
 * "scroll down" (increase scrollTop), negative means "scroll up".
 */
export function computeCaretScrollDelta(
  caret: CaretRectLike,
  viewport: ViewportRectLike,
  margins: CaretScrollMargins = DEFAULT_CARET_SCROLL_MARGINS,
): number {
  const comfortableBottom = viewport.bottom - margins.bottomMargin
  if (caret.bottom > comfortableBottom) return caret.bottom - comfortableBottom
  const comfortableTop = viewport.top + margins.topMargin
  if (caret.top < comfortableTop) return -(comfortableTop - caret.top)
  return 0
}
