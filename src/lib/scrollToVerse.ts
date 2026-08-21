/**
 * Named, shared scroll-into-view presets for "jump to a verse" across the scripture reader.
 *
 * Before this file existed, four call sites (search/reference navigation, the find-bar next/
 * prev, the type-anywhere verse-digit jump, and ContinuousChapterScroll's own programmatic
 * jumps — plus Read Aloud's auto-follow) each independently wrote their own inline
 * `{ behavior, block }` object for what is conceptually the same user intent ("take me to verse
 * X"), and had quietly drifted into 4 different (behavior, block) pairs with no shared
 * convention. That's not all a bug to fix by making everything identical — one of them
 * (search/reference nav) deliberately goes INSTANT specifically because a smooth scroll "can get
 * interrupted/fought by other layout-settling effects" running at the same moment (see
 * ChapterView.tsx's own comment at its scroll-to-verse effect) — but it WAS worth naming each
 * choice once, here, so a future call site reaches for an existing preset instead of writing yet
 * another ad hoc object and drifting further.
 */

/** Search/reference navigation — instant, vertically centered (so the landed verse has context
 *  on both sides, same as a find-bar match — clamped by the browser to whatever scroll range is
 *  actually available near the very top/bottom of a chapter, nothing special needed for that).
 *  Deliberately not SMOOTH: this can fire while other layout-settling effects (cross-ref banner
 *  insertion, Strong's toggle reflow, etc.) are still running, and a smooth scroll gets visibly
 *  fought/interrupted by those in a way an instant snap doesn't — but centering vs. top-aligning
 *  is an unrelated axis from that concern, so this can freely differ from the OLD 'start'
 *  default without reintroducing it. Covers every "jump to a verse from outside the chapter
 *  you're currently reading" entry point at once: search/reference nav (ChapterView.tsx's own
 *  targetVerse effect), and everything that sets targetVerse to get there — lexicon occurrence
 *  clicks, floating search results, and the Advanced Scripture Search tab all funnel through it. */
export const VERSE_JUMP_INSTANT: ScrollIntoViewOptions = { behavior: 'auto', block: 'center' }

/** Find-bar next/prev match, and any other "user is actively navigating one match at a time"
 *  jump — smooth, centered so there's context on both sides of the match. */
export const VERSE_JUMP_ANIMATED_CENTER: ScrollIntoViewOptions = { behavior: 'smooth', block: 'center' }

/** Type-anywhere verse-digit jump, and ContinuousChapterScroll's own chapter-heading jump —
 *  smooth, pinned to the top (these are "go to the start of X," not "center this one match"). */
export const VERSE_JUMP_ANIMATED_START: ScrollIntoViewOptions = { behavior: 'smooth', block: 'start' }

/** Read Aloud auto-follow, scrolling DOWN to keep the currently-spoken verse in view as
 *  playback advances past the bottom of the visible area. Centered (not edge-aligned) so the
 *  active verse settles nearer the vertical middle of the screen — easier to keep eyes on
 *  during playback than a verse parked right at the bottom edge. */
export const VERSE_FOLLOW_DOWN: ScrollIntoViewOptions = { behavior: 'smooth', block: 'center' }

/** Read Aloud auto-follow, scrolling UP (the spoken verse moved above the visible area — e.g.
 *  the user manually scrolled ahead then played backward, or skipped to an earlier verse).
 *  Centered, same reasoning as VERSE_FOLLOW_DOWN above. */
export const VERSE_FOLLOW_UP: ScrollIntoViewOptions = { behavior: 'smooth', block: 'center' }

/** Thin wrapper so call sites read as "scroll this verse into view, using this named preset"
 *  rather than a bare `el?.scrollIntoView(...)` — purely for readability/searchability, no
 *  behavior beyond what `Element.scrollIntoView` already does. */
export function scrollVerseIntoView(el: Element | null | undefined, preset: ScrollIntoViewOptions): void {
  el?.scrollIntoView(preset)
}
