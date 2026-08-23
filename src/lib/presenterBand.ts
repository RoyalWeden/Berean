/**
 * Geometry for the "presenter outline" band drawn in the main Bible panel to show exactly
 * which region of the chapter is visible on the presenter window.
 *
 * The presenter reports, per chapter/zoom, the fraction of content it can show
 * (`visibleFraction`) and each verse's top as a fraction of its scrollable content
 * (`verseFracs`). The main panel combines that with its OWN live scroll position and its
 * OWN verse positions to draw the band — so it's accurate regardless of the two windows'
 * sizes, zoom, or text wrapping, and updates instantly while scrolling.
 *
 * Both windows mirror the same proportional scroll position, so the presenter's visible
 * window in presenter-content fractions is [p·(1−f), p·(1−f)+f], where p is the shared
 * scroll percentage and f is the visible fraction. Each edge fraction is then translated to
 * a main-panel pixel by anchoring on the shared verse numbers.
 */

export interface PresenterVerseEntry {
  v: number
  f: number
}

/**
 * Trailing-space fudge factor (px) added past the last verse's bottom when
 * deriving content height — excludes the small amount of intentional
 * padding below the last verse so a short chapter's outline band doesn't
 * run past where content actually ends. Shared by both windows (previously
 * duplicated as a bare `+ 4` in each) so they can never independently drift
 * out of sync with each other.
 */
export const CONTENT_HEIGHT_PADDING_PX = 4

/**
 * Content height for band geometry: the last verse's measured bottom (plus
 * the shared padding above), clamped to the container's actual scrollHeight
 * — never the raw scrollHeight when it's larger, since empty space below
 * the last verse would otherwise inflate the scrollable region and run the
 * band/virtual-scroll past the real content on short chapters.
 */
export function measureContentHeight(scrollHeight: number, contentBottom: number): number {
  return contentBottom > 0 ? Math.min(scrollHeight, contentBottom + CONTENT_HEIGHT_PADDING_PX) : scrollHeight
}

/**
 * Flat fallback sensitivity (in scroll-percent per px) used when the presenter's own
 * geometry isn't known yet (no viewer window, or it hasn't reported a visible region).
 * Matches the constant the wheel-driven virtual-scroll path always fell back to.
 */
export const FALLBACK_SCROLL_SENSITIVITY = 0.0012

/**
 * Convert a physical scroll amount (px — either a wheel event's `deltaY`, or a delta of the
 * main panel's own `scrollTop` between two scroll events) into a change in the shared
 * proportional scroll percentage `p`, scaled by the PRESENTER's own scrollable range rather
 * than the main panel's.
 *
 * This is the fix for "outline scrolls too fast/jumpy on a chapter that barely overflows the
 * main viewport": naively deriving `p` as `mainScrollTop / mainScrollableRangePx` makes the
 * felt speed in the presenter equal to `presenterScrollableRangePx / mainScrollableRangePx` —
 * which blows up whenever the main panel's own range is small, since the same physical wheel/
 * scroll input always produces a roughly constant number of scrollTop px regardless of how
 * little (or how much) the chapter actually overflows. Deriving sensitivity from the
 * presenter's OWN clientHeight/visibleFraction instead reproduces the same math a real
 * scrollbar uses (percent = deltaPx / scrollableRangePx, where scrollableRangePx =
 * clientHeight * (1-f)/f) — so a given physical scroll amount covers roughly the same
 * felt distance in the presenter no matter how much room the main panel itself has to scroll.
 *
 * Floored so a chapter that barely overflows in the PRESENTER (f→1) doesn't produce a
 * near-infinite (instant-jump-to-end) sensitivity — the floor still lets a deliberate scroll
 * move it, just not on a single wheel tick / scroll event.
 */
export function presenterScrollSensitivity(clientHeight: number | undefined, visibleFraction: number | undefined): number {
  if (!clientHeight || !visibleFraction || visibleFraction <= 0 || visibleFraction >= 1) return FALLBACK_SCROLL_SENSITIVITY
  const scrollableRangePx = Math.max(40, clientHeight * (1 - visibleFraction) / visibleFraction)
  return 1 / scrollableRangePx
}

/** Sort a verseFracs map into ascending-by-fraction entries. */
export function sortVerseFracs(verseFracs: Record<number, number>): PresenterVerseEntry[] {
  return Object.keys(verseFracs)
    .map((k) => ({ v: Number(k), f: verseFracs[Number(k)] }))
    .filter((e) => Number.isFinite(e.v) && Number.isFinite(e.f))
    .sort((a, b) => a.f - b.f)
}

/**
 * Translate a presenter-content fraction `F` (0–1) into a pixel Y in the main panel's
 * content, anchoring on shared verse positions. Outside the verse range (the chapter
 * header above verse 1, or trailing space below the last verse) it interpolates
 * proportionally against the content edges.
 */
export function presenterFracToMainY(
  F: number,
  entries: PresenterVerseEntry[],
  tops: Record<number, number>,
  mainH: number,
): number {
  if (entries.length === 0) return F * mainH
  const first = entries[0]
  const last = entries[entries.length - 1]
  const firstTop = tops[first.v] ?? 0
  const lastTop = tops[last.v] ?? mainH
  if (F <= first.f) return first.f > 0 ? (F / first.f) * firstTop : firstTop
  if (F >= last.f) {
    const denom = 1 - last.f
    return denom > 0 ? lastTop + ((F - last.f) / denom) * (mainH - lastTop) : lastTop
  }
  for (let i = 0; i < entries.length - 1; i++) {
    const a = entries[i], b = entries[i + 1]
    if (F >= a.f && F < b.f) {
      const ta = tops[a.v], tb = tops[b.v]
      if (ta == null || tb == null) break
      const span = b.f - a.f
      return span > 0 ? ta + ((F - a.f) / span) * (tb - ta) : ta
    }
  }
  return F * mainH
}

export interface BandInputs {
  /** Presenter clientHeight / scrollHeight (0–1). */
  visibleFraction: number
  /** Presenter verse tops as fractions of presenter content height. */
  verseFracs: Record<number, number>
  /** Main panel verse content-tops (px). */
  mainTops: Record<number, number>
  mainScrollHeight: number
  mainClientHeight: number
  mainScrollTop: number
  /** When the main panel can't scroll (content fits), the virtual scroll percent driving the
   *  presenter via the wheel. Overrides the scrollTop-derived percent. */
  scrollPercentOverride?: number
}

/**
 * Which verse numbers fall (at least partially) within the presenter's
 * visible fraction range [topFrac, botFrac] — lets the main window show a
 * plain "audience sees v.3–7" label using data it's already computing for
 * the band geometry, rather than a new measurement. This is a direct
 * readout of the shared verseFracs, not a fragile derived value, so it
 * stays accurate even in edge cases where the band's own pixel geometry
 * might be slightly approximate (e.g. mid-verse interpolation).
 */
export function visibleVerseRange(entries: PresenterVerseEntry[], topFrac: number, botFrac: number): { first: number | null; last: number | null } {
  if (entries.length === 0) return { first: null, last: null }
  // A verse is "visible" if its fraction-range overlaps [topFrac, botFrac] — its own
  // start is before botFrac, and (for all but the last) its end (the next verse's
  // start) is after topFrac. The very first/last verse in the doc has no such
  // neighbor-bounded end, so treat it as extending to the content edge.
  let first: number | null = null
  let last: number | null = null
  for (let i = 0; i < entries.length; i++) {
    const start = entries[i].f
    const end = i + 1 < entries.length ? entries[i + 1].f : 1
    if (start < botFrac && end > topFrac) {
      if (first === null) first = entries[i].v
      last = entries[i].v
    }
  }
  return { first, last }
}

/** Shallow-equality check for `verseFracs`-shaped records (verse number -> fraction), used to
 *  skip redundant `ViewerVisibleRegion` reports that carry no actual change. */
export function shallowEqualNumberRecord(a: Record<number, number>, b: Record<number, number>): boolean {
  if (a === b) return true
  const aKeys = Object.keys(a)
  const bKeys = Object.keys(b)
  if (aKeys.length !== bKeys.length) return false
  for (const k of aKeys) {
    if (a[k as unknown as number] !== b[k as unknown as number]) return false
  }
  return true
}

/** Compute the outline band {top,height} in main-content px, or null if not drawable. */
export function computePresenterBand(inp: BandInputs): { top: number; height: number; firstVerse: number | null; lastVerse: number | null } | null {
  const { visibleFraction: f, verseFracs, mainTops, mainScrollHeight: mainH, mainClientHeight, mainScrollTop, scrollPercentOverride } = inp
  if (!(f > 0) || mainH <= 0) return null
  const denom = mainH - mainClientHeight
  const p = scrollPercentOverride !== undefined ? scrollPercentOverride : (denom > 0 ? mainScrollTop / denom : 0)
  const topFrac = p * (1 - f)
  const botFrac = Math.min(1, topFrac + f)
  const entries = sortVerseFracs(verseFracs)
  const yTop = presenterFracToMainY(topFrac, entries, mainTops, mainH)
  const yBot = presenterFracToMainY(botFrac, entries, mainTops, mainH)
  const { first, last } = visibleVerseRange(entries, topFrac, botFrac)
  return { top: Math.max(0, yTop), height: Math.max(0, yBot - yTop), firstVerse: first, lastVerse: last }
}
