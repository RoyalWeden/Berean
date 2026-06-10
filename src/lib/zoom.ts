/**
 * Per-panel zoom helpers. Zoom is a multiplier applied to a panel's base font size
 * (1.0 = 100%). Used by Scripture, Notes, and Lexicon panels (and their side panels),
 * driven by Cmd +/- /0 and toolbar buttons.
 */

export type ZoomContext = 'scripture' | 'notes' | 'lexicon'

export const ZOOM_MIN = 0.5
export const ZOOM_MAX = 3
export const ZOOM_STEP = 0.1
export const ZOOM_DEFAULT = 1

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
