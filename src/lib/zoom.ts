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
 *
 * Applied as `transform: scale()` (NOT CSS `zoom`) on the region's container:
 * `transform` is layout-neutral and 100% predictable, where `zoom`'s box-model
 * behaviour in a flex/percentage context is inconsistent (it left a gap at the
 * right edge). The container is `position: absolute; inset: 0` inside a
 * `position: relative` parent and counter-sized to `100% / READING_REGION_ZOOM`
 * in both axes, so `scale()` from the top-left origin brings it back to exactly
 * the parent's box — filling it edge to edge, never overflowing. Because the
 * scale multiplies the scroll viewport AND its content together, scrolling still
 * reaches every row. It also still compounds with the global app zoom (an
 * ancestor `zoom: appZoom` wrapper), so Cmd +/- keeps working.
 */
export const READING_REGION_ZOOM = 1.1

/** Inline style for the reading-region container: scale up by READING_REGION_ZOOM
 *  and counter-size so the scaled box still fills — not overflows — its parent.
 *  The element must be `position: absolute; inset: 0` inside a `relative` parent. */
export const readingRegionScale = {
  transform: `scale(${READING_REGION_ZOOM})`,
  transformOrigin: 'top left',
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
