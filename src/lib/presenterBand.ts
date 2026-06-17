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
}

/** Compute the outline band {top,height} in main-content px, or null if not drawable. */
export function computePresenterBand(inp: BandInputs): { top: number; height: number } | null {
  const { visibleFraction: f, verseFracs, mainTops, mainScrollHeight: mainH, mainClientHeight, mainScrollTop } = inp
  if (!(f > 0) || mainH <= 0) return null
  const denom = mainH - mainClientHeight
  const p = denom > 0 ? mainScrollTop / denom : 0
  const topFrac = p * (1 - f)
  const botFrac = Math.min(1, topFrac + f)
  const entries = sortVerseFracs(verseFracs)
  const yTop = presenterFracToMainY(topFrac, entries, mainTops, mainH)
  const yBot = presenterFracToMainY(botFrac, entries, mainTops, mainH)
  return { top: Math.max(0, yTop), height: Math.max(0, yBot - yTop) }
}
