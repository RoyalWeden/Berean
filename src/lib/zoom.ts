/**
 * Reading-content zoom helpers. One shared multiplier (1.0 = 100%), driven by
 * Cmd +/- /0 and the rail's zoom control. Applied two ways: font-level scaling
 * (via zoomedFontSize below) for the actual Scripture/Lexicon reading text, and
 * CSS `zoom` on TopBar.tsx's content and the Notes/Lexicon/YouTube side panel
 * (see PanelLayout.tsx's ZoomedPanel) so that chrome scales too. The primary
 * sidebar/rail and the main panel-resize layout itself stay a fixed size
 * regardless of zoom — an earlier version applied CSS `zoom` to the ENTIRE app
 * div including the sidebar/rail, which scaled the whole window's layout
 * uniformly (sidebar width, rail icons, everything) and read as jarring; this
 * is a narrower, deliberately scoped version of that same idea. Previously
 * each reading pane also had its own independent zoom level; collapsed to one
 * shared value since zooming "just the lexicon" while everything else stayed
 * the same size was confusing.
 */

export const ZOOM_MIN = 0.5
export const ZOOM_MAX = 3
export const ZOOM_STEP = 0.1
export const ZOOM_DEFAULT = 1

/**
 * Fixed base enlargement for dense list/reference regions whose default type ran
 * noticeably smaller than the Scripture/Notes reading text — the notes-home panel
 * (search bar, folder tree, note list, action bar) and the lexicon entry body.
 * Applied as CSS `zoom` on the region's container so it COMPOUNDS with the global
 * app zoom (`zoom` multiplies through nested elements): the region sits at roughly
 * reading size at 100%, and still grows/shrinks with Cmd +/-. A container using it
 * must counter-scale its own width/height by 1 / READING_REGION_ZOOM (see
 * `readingRegionBox`) so the magnified box still fits its parent exactly rather
 * than overflowing and clipping the bottom of a scroll area.
 */
export const READING_REGION_ZOOM = 1.2

/** Inline style: apply READING_REGION_ZOOM and counter-scale the box so it still
 *  fills — not overflows — its parent. Spread onto the region's container. */
export const readingRegionBox = {
  zoom: READING_REGION_ZOOM,
  width: `${100 / READING_REGION_ZOOM}%`,
  height: `${100 / READING_REGION_ZOOM}%`,
} as const

/** Clamp to [ZOOM_MIN, ZOOM_MAX] and round to 2 decimals (avoids float drift like 1.0000001). */
export function clampZoom(z: number): number {
  if (!Number.isFinite(z)) return ZOOM_DEFAULT
  return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.round(z * 100) / 100))
}

/** One zoom step in/out from the given level (dir = +1 to zoom in, -1 to zoom out). */
export function adjustZoom(z: number, dir: 1 | -1): number {
  return clampZoom(z + dir * ZOOM_STEP)
}

/** "120%" label for the given multiplier. */
export function zoomPercent(z: number): string {
  return `${Math.round(clampZoom(z) * 100)}%`
}

/** Apply a zoom multiplier to a base px size, returning a clamped px font-size. */
export function zoomedFontSize(basePx: number, z: number): number {
  return Math.round(basePx * clampZoom(z) * 10) / 10
}
