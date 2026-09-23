/**
 * Opens a tab as a floating OS window (desktop). The ONE path for every "Open in Floating Tab"
 * entry point — the tab bar's drag-out / menu row and Floating Search's context menu (TEST-013).
 * Values that are null/undefined are dropped: the main process serialises the state into the
 * window URL, where `undefined` became the literal string "undefined" and the floating window
 * fell back to Genesis 1.
 */
export function floatingTabState(state: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(state)) if (v !== null && v !== undefined) out[k] = v
  return out
}

export function openFloatingTab(type: string, state: Record<string, unknown>): Promise<unknown> {
  return window.app.openFloatingTab(type, floatingTabState(state))
}
