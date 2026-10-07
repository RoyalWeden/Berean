/**
 * macOS Scripture inspector (Notes / Lexicon / Cross Refs side panel) layout rules.
 *
 * Yield rule (2026-10-03): the inspector ATTACHES (Scripture's scroller ends at the inspector)
 * while Scripture keeps a comfortable reading width; otherwise it floats over Scripture as an
 * overlay. Decided from the width Scripture would actually keep — window minus the sidebar minus
 * the inspector — not from the window alone.
 *
 * No-jump rule (2026-10-04): opening the inspector must not move the text. The reading column is
 * left-anchored and its margins are a share of the whole Scripture PANE (cqi units against
 * .berean-scripture-pane), not of the scroller, so attaching the inspector only changes where the
 * scroller ends. The text re-wraps only when the measure no longer fits beside the inspector
 * (a narrow window, or the inspector dragged out to Expanded).
 *
 * Widths snap magnetically to three sizes while dragging: Compact, Standard (the default, and
 * what double-clicking the divider restores) and Expanded.
 */
export const MIN_READING_WIDTH = 480

export const INSPECTOR_MIN_WIDTH = 260
export const INSPECTOR_STANDARD_WIDTH = 300
export const INSPECTOR_EXPANDED_WIDTH = 420
export const INSPECTOR_MAX_WIDTH = 520
export const INSPECTOR_SNAPS = [INSPECTOR_MIN_WIDTH, INSPECTOR_STANDARD_WIDTH, INSPECTOR_EXPANDED_WIDTH] as const
/** Distance (px) within which a dragged width is pulled onto a snap size. */
export const INSPECTOR_SNAP_RANGE = 14

export function inspectorShouldReflow(windowWidth: number, sidebarSpace: number, inspectorWidth: number): boolean {
  return windowWidth - sidebarSpace - inspectorWidth >= MIN_READING_WIDTH
}

export function clampInspectorWidth(w: number): number {
  return Math.round(Math.max(INSPECTOR_MIN_WIDTH, Math.min(INSPECTOR_MAX_WIDTH, w)))
}

/** Narrowest text block (px) an attached inspector may be dragged to leave Scripture. */
export const MIN_ATTACHED_READING_WIDTH = 400

/** Widest the inspector may be dragged in a pane of `paneWidth` px (never below the minimum). */
export function maxInspectorWidth(paneWidth: number): number {
  return Math.max(INSPECTOR_MIN_WIDTH, Math.min(INSPECTOR_MAX_WIDTH, paneWidth - 14 - MIN_ATTACHED_READING_WIDTH))
}

export function snapInspectorWidth(w: number, max = INSPECTOR_MAX_WIDTH): number {
  const c = Math.min(clampInspectorWidth(w), Math.max(INSPECTOR_MIN_WIDTH, max))
  for (const s of INSPECTOR_SNAPS) if (Math.abs(c - s) <= INSPECTOR_SNAP_RANGE) return s
  return c
}

/** Widest inspector still treated as "standard" for the closed-panel reserve: halfway to Expanded,
 *  so the default (320) and small drags around Standard never move the text. */
export const INSPECTOR_STANDARD_RESERVE_MAX = Math.round((INSPECTOR_STANDARD_WIDTH + INSPECTOR_EXPANDED_WIDTH) / 2)

/** Narrowest text block (px) worth reserving the inspector's width for. */
export const MIN_RESERVED_READING_WIDTH = 600

/**
 * Width (px) the reading column keeps clear for the inspector even while it is CLOSED, so opening
 * it at the user's chosen width never re-wraps the text (Books-like: the page doesn't reflow when a
 * sidebar slides in). 0 when the pane is too narrow to spare it — then opening attaches and the
 * text narrows once, or the inspector overlays (see inspectorShouldReflow).
 */
export function inspectorReserve(paneWidth: number, inspectorWidth: number): number {
  // The reserve is capped at the STANDARD inspector (+ its 14px divider strip): the standard study
  // panel is part of the intended window layout, so opening it never moves the text — but a panel
  // the user dragged out to Expanded must not keep the text narrow while it is CLOSED. Only the
  // width beyond Standard re-wraps Scripture, and only while the panel is open (TEST 2026-10-05).
  const w = Math.min(inspectorWidth, INSPECTOR_STANDARD_RESERVE_MAX + 14)
  return paneWidth - w >= MIN_RESERVED_READING_WIDTH ? w : 0
}
