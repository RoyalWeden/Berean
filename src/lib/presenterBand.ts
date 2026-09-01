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
 *
 * The floor is a fraction of the presenter's own clientHeight (not a flat 40px, which was
 * still tiny enough that one ~110px wheel notch covered 2–3× the whole range — reported as
 * "the outline scrolling was really weird" on a short chapter like Hosea 6 that the presenter
 * shows almost all of at once). 0.6·clientHeight means the hidden sliver always takes at
 * least ~5–6 deliberate notches to cross, regardless of how little of it is actually hidden.
 */
export const MIN_SCROLLABLE_RANGE_FRACTION = 0.6

export function presenterScrollSensitivity(clientHeight: number | undefined, visibleFraction: number | undefined): number {
  if (!clientHeight || !visibleFraction || visibleFraction <= 0 || visibleFraction >= 1) return FALLBACK_SCROLL_SENSITIVITY
  const scrollableRangePx = Math.max(clientHeight * MIN_SCROLLABLE_RANGE_FRACTION, clientHeight * (1 - visibleFraction) / visibleFraction)
  return 1 / scrollableRangePx
}

export interface CenteredBandInputs {
  /** Presenter scroll percent 0–1 — the gesture-driven target the main panel slaves to. */
  p: number
  /** Fraction of the chapter the presenter currently shows (its visibleFraction, 0–1). */
  f: number
  /** Presenter verse tops sorted ascending by fraction (sortVerseFracs of region.verseFracs). */
  entries: PresenterVerseEntry[]
  /** Main panel verse content-tops (px), keyed by verse number. */
  tops: Record<number, number>
  /** Main panel content height — measureContentHeight() result (last-verse-bottom clamped), px. */
  mainH: number
  /** Main panel viewport height (its scroll container's clientHeight, px). */
  V: number
}

export interface CenteredBandGeometry {
  /** Band top in main-panel CONTENT-space px (before subtracting scrollTop). */
  bandTopContent: number
  /** Band height in px. */
  bandH: number
  /** Main panel's scrollable range, max(0, mainH - V). */
  maxScroll: number
  /** scrollTop that centres the band in the viewport, clamped to [0, maxScroll]. */
  desiredScrollTop: number
}

/**
 * The single shared transform for the centred-outline scroll model: given the gesture-driven
 * presenter percent `p`, return where the outline band sits in main-panel content px AND the
 * `scrollTop` that centres it in the viewport.
 *
 * The band's content-space top/bottom use the EXACT same verse-anchored fractions
 * (`presenterFracToMainY` over `[p·(1−f), p·(1−f)+f]`) that `computePresenterBand` draws with,
 * so the band and the slaved scroll position can never drift apart. `desiredScrollTop` places
 * the band's vertical midpoint on the viewport's vertical midpoint; near the chapter ends the
 * `clamp(…, 0, maxScroll)` engages and the band rides to the edge (top for p→0, bottom for
 * p→1). Symmetric up and down by construction — no ramp, no regime split.
 */
export function presenterCenteredBandGeometry(inp: CenteredBandInputs): CenteredBandGeometry {
  const { entries, tops, mainH, V } = inp
  const p = Math.max(0, Math.min(1, inp.p))
  const f = Math.max(0, Math.min(1, inp.f))
  const topFrac = p * (1 - f)
  const botFrac = Math.min(1, topFrac + f)
  const bandTopContent = presenterFracToMainY(topFrac, entries, tops, mainH)
  const bandBotContent = presenterFracToMainY(botFrac, entries, tops, mainH)
  const bandH = Math.max(0, bandBotContent - bandTopContent)
  const maxScroll = Math.max(0, mainH - V)
  const desiredScrollTop = Math.max(0, Math.min(maxScroll, bandTopContent + bandH / 2 - V / 2))
  return { bandTopContent, bandH, maxScroll, desiredScrollTop }
}

/**
 * Inverse of `presenterCenteredBandGeometry(...).desiredScrollTop`: given a main-panel
 * `scrollTop`, recover the presenter percent `p` that would have produced it. Used to seed the
 * centred-outline model (presenterScrollTarget/CurRef) after a pixel-based scroll restore so the
 * outline band and the presenter land at the right region immediately, without waiting for the
 * next wheel/key gesture.
 *
 * `desiredScrollTop` is monotonic non-decreasing in `p` (see presenterCenteredBand.test.ts), so a
 * plain bisection converges. Endpoints (scrollTop at or past the clamp) map straight to 0 / 1.
 */
export function presenterPercentForScrollTop(scrollTop: number, inp: Omit<CenteredBandInputs, 'p'>): number {
  const maxScroll = Math.max(0, inp.mainH - inp.V)
  if (scrollTop <= 0) return 0
  if (scrollTop >= maxScroll) return 1
  let lo = 0
  let hi = 1
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2
    const d = presenterCenteredBandGeometry({ ...inp, p: mid }).desiredScrollTop
    if (d < scrollTop) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
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
  const entries = sortVerseFracs(verseFracs)
  // Same verse-anchored transform the centred-scroll model slaves scrollTop to, so the band
  // and the scroll position can never drift apart (see presenterCenteredBandGeometry).
  const geo = presenterCenteredBandGeometry({ p, f, entries, tops: mainTops, mainH, V: mainClientHeight })
  const clampedP = Math.max(0, Math.min(1, p))
  const clampedF = Math.max(0, Math.min(1, f))
  const topFrac = clampedP * (1 - clampedF)
  const botFrac = Math.min(1, topFrac + clampedF)
  const { first, last } = visibleVerseRange(entries, topFrac, botFrac)
  return { top: Math.max(0, geo.bandTopContent), height: geo.bandH, firstVerse: first, lastVerse: last }
}
