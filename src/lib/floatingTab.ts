/**
 * Opens a tab as a floating OS window (desktop). The ONE path for every "Open in Floating Tab"
 * entry point — the tab bar's drag-out / menu row and Floating Search's context menu (TEST-013).
 * Values that are null/undefined are dropped: the main process serialises the state into the
 * window URL, where `undefined` became the literal string "undefined" and the floating window
 * fell back to Genesis 1.
 */
export function floatingTabState(state: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(state)) {
    if (v === null || v === undefined || typeof v === 'function') continue
    // Arrays / objects (search tag filters, hidden annotations…) travel as JSON — the URL
    // otherwise carried them as "[object Object]". decodeFloatingParam reads them back.
    out[k] = typeof v === 'object' ? `${JSON_PREFIX}${JSON.stringify(v)}` : v
  }
  return out
}

const JSON_PREFIX = 'json:'
const NUMERIC_KEYS = new Set(['chapter', 'endChapter', 'verse', 'targetVerse', 'endVerse', 'scrollPosition', 'searchScrollTop', 'searchRestoreSeq', 'page', 'startTime', 'scrollTop'])

/** A floating window's URL param back to the tab-state value it was made from. */
export function decodeFloatingParam(key: string, raw: string): unknown {
  if (raw.startsWith(JSON_PREFIX)) {
    try { return JSON.parse(raw.slice(JSON_PREFIX.length)) } catch { return undefined }
  }
  if (raw === 'true') return true
  if (raw === 'false') return false
  if (NUMERIC_KEYS.has(key)) { const n = Number(raw); return Number.isFinite(n) ? n : undefined }
  return raw
}

export function openFloatingTab(type: string, state: Record<string, unknown>): Promise<unknown> {
  return window.app.openFloatingTab(type, floatingTabState(state))
}
