// Tiny localStorage-backed memory for the Study Trail window (the separate renderer opened
// with ?studyTrail=1). It remembers, across close/reopen: which view was last open (a specific
// trail session, or the merged "Everything" view), the Map/Review toggle, the zoom level, and
// the trail-map scroll position PER view. The Study Trail Zustand store (studyTrailSlice.ts) is
// deliberately NOT persisted, so this is a standalone lightweight store following the same
// dedicated-key + JSON + try/catch idiom as ASK_WHY_SYNC_KEY / VIEWER_FONT_SCALE_SYNC_KEY in
// src/store/index.ts. Every read/write is defensive: SSR-safe, tolerant of a missing or corrupt
// value, and never throws out to the caller.

const STORAGE_KEY = 'berean-study-trail-window'

/** Scroll-map key used for the merged "Everything" view (no session selected). */
export const EVERYTHING_SCROLL_KEY = '__everything__'

export const TRAIL_ZOOM_MIN = 0.5
export const TRAIL_ZOOM_MAX = 3

export interface TrailScrollPos {
  top: number
  left: number
}

export interface TrailHeaderPos {
  x: number
  y: number
}

export interface TrailWindowPrefs {
  /** null = the "Everything" view; a string = that TrailSession is open. */
  selectedId: string | null
  /** 'map' | 'threads' | 'search' — kept as a plain string here so this module doesn't depend on
   *  the component's MainTab union; the consumer narrows it (and maps a stored 'review' from a
   *  previous version back to 'map'). */
  mainTab: string
  zoom: number
  /** Per-view trail-map scroll position, keyed by `selectedId ?? EVERYTHING_SCROLL_KEY`. */
  scroll: Record<string, TrailScrollPos>
  /** Collapsed to a small session-name-only chip. Per feedback the floating map header was
   *  "getting in the way" — this and headerPos below let the user shrink/move it out of the way. */
  headerCollapsed: boolean
  /** User-dragged position (top-left corner, in pixels relative to the map viewport). null means
   *  "no manual position yet" — StudyTrailApp falls back to its own auto left/right placement
   *  (headerSide, computed from live layoutRoom) until the user actually drags it once. */
  headerPos: TrailHeaderPos | null
  /** Session-rail calendar state — per feedback ("remember which view the left thing... was on,
   *  whether on a specific day or specific scroll"). 'month' = the scrolling month list;
   *  'day' = a specific day's timeline (railSelectedDayKey). */
  railView: 'month' | 'day'
  railSelectedDayKey: string | null
}

const DEFAULTS: TrailWindowPrefs = {
  selectedId: null,
  mainTab: 'map',
  zoom: 1,
  scroll: {},
  headerCollapsed: false,
  headerPos: null,
  railView: 'month',
  railSelectedDayKey: null,
}

function clampZoom(z: unknown): number {
  const n = typeof z === 'number' && Number.isFinite(z) ? z : 1
  return Math.min(TRAIL_ZOOM_MAX, Math.max(TRAIL_ZOOM_MIN, n))
}

function sanitizeScroll(raw: unknown): Record<string, TrailScrollPos> {
  const out: Record<string, TrailScrollPos> = {}
  if (!raw || typeof raw !== 'object') return out
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!v || typeof v !== 'object') continue
    const top = (v as Record<string, unknown>).top
    const left = (v as Record<string, unknown>).left
    if (typeof top === 'number' && Number.isFinite(top) && typeof left === 'number' && Number.isFinite(left)) {
      out[k] = { top: Math.max(0, top), left: Math.max(0, left) }
    }
  }
  return out
}

function sanitizeHeaderPos(raw: unknown): TrailHeaderPos | null {
  if (!raw || typeof raw !== 'object') return null
  const x = (raw as Record<string, unknown>).x
  const y = (raw as Record<string, unknown>).y
  if (typeof x === 'number' && Number.isFinite(x) && typeof y === 'number' && Number.isFinite(y)) {
    return { x: Math.max(0, x), y: Math.max(0, y) }
  }
  return null
}

/**
 * Read the stored prefs. Returns `null` when nothing has ever been stored (or the value is
 * unreadable / corrupt) so callers can tell "first run" from "explicitly restored a view".
 * When it returns an object, every field is present and sane.
 */
export function readTrailWindowPrefs(): TrailWindowPrefs | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<TrailWindowPrefs> | null
    if (!parsed || typeof parsed !== 'object') return null
    return {
      selectedId: typeof parsed.selectedId === 'string' ? parsed.selectedId : null,
      mainTab: parsed.mainTab === 'review' ? 'review' : 'map',
      zoom: clampZoom(parsed.zoom),
      scroll: sanitizeScroll(parsed.scroll),
      headerCollapsed: parsed.headerCollapsed === true,
      headerPos: sanitizeHeaderPos(parsed.headerPos),
      railView: parsed.railView === 'day' ? 'day' : 'month',
      railSelectedDayKey: typeof parsed.railSelectedDayKey === 'string' ? parsed.railSelectedDayKey : null,
    }
  } catch {
    return null
  }
}

/** Same as `readTrailWindowPrefs` but always returns an object (defaults when nothing stored). */
export function getTrailWindowPrefs(): TrailWindowPrefs {
  return readTrailWindowPrefs() ?? { ...DEFAULTS, scroll: {} }
}

/** Merge a partial update into the stored prefs (read-modify-write, preserving the scroll map). */
export function setTrailWindowPrefs(patch: Partial<TrailWindowPrefs>): void {
  if (typeof window === 'undefined') return
  try {
    const current = getTrailWindowPrefs()
    const next: TrailWindowPrefs = {
      selectedId: patch.selectedId !== undefined
        ? (typeof patch.selectedId === 'string' ? patch.selectedId : null)
        : current.selectedId,
      mainTab: patch.mainTab !== undefined
        ? (patch.mainTab === 'review' ? 'review' : 'map')
        : current.mainTab,
      zoom: patch.zoom !== undefined ? clampZoom(patch.zoom) : current.zoom,
      scroll: patch.scroll !== undefined ? sanitizeScroll(patch.scroll) : current.scroll,
      headerCollapsed: patch.headerCollapsed !== undefined ? patch.headerCollapsed === true : current.headerCollapsed,
      headerPos: patch.headerPos !== undefined ? sanitizeHeaderPos(patch.headerPos) : current.headerPos,
      railView: patch.railView !== undefined ? (patch.railView === 'day' ? 'day' : 'month') : current.railView,
      railSelectedDayKey: patch.railSelectedDayKey !== undefined
        ? (typeof patch.railSelectedDayKey === 'string' ? patch.railSelectedDayKey : null)
        : current.railSelectedDayKey,
    }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    /* storage disabled / quota / serialization — the window just won't remember this time */
  }
}

/** Read the saved scroll position for one view, or `null` if none is stored. */
export function getTrailScroll(key: string): TrailScrollPos | null {
  const prefs = readTrailWindowPrefs()
  const pos = prefs?.scroll?.[key]
  return pos ? { top: pos.top, left: pos.left } : null
}

/** Save the scroll position for one view (merged into the existing scroll map). */
export function setTrailScroll(key: string, pos: TrailScrollPos): void {
  if (typeof window === 'undefined') return
  if (!key) return
  try {
    const current = getTrailWindowPrefs()
    const top = Number.isFinite(pos.top) ? Math.max(0, pos.top) : 0
    const left = Number.isFinite(pos.left) ? Math.max(0, pos.left) : 0
    setTrailWindowPrefs({ scroll: { ...current.scroll, [key]: { top, left } } })
  } catch {
    /* storage disabled / quota — skip */
  }
}
