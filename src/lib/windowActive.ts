/**
 * Inactive-window stamp (§85): html[data-inactive] while this BrowserWindow is not key, so chrome
 * dims like every other Mac app (global.css). It only ever DIMS — nothing is hidden by it.
 *
 * Event-driven from two sources so it can never stick (TEST 2026-10-01 audit of "menu buttons
 * sometimes disappear"):
 *   - electron/main.ts forwards focus / blur / show / hide / restore / minimize as app:windowActive;
 *   - the renderer's own window focus / blur and visibilitychange (Chromium fires them for the
 *     BrowserWindow too) — a missed IPC message is corrected by the next DOM event and vice versa.
 * Initialised from document.hasFocus() so a window that opens behind another starts dim.
 * Returns a disposer that removes every listener it added.
 */
export interface WindowActiveDeps {
  html: HTMLElement
  win: Pick<Window, 'addEventListener' | 'removeEventListener'>
  doc: Pick<Document, 'hasFocus' | 'addEventListener' | 'removeEventListener' | 'visibilityState'>
  /** window.app.onWindowActive — may return an unsubscribe (older preloads return nothing). */
  onWindowActive?: (cb: (active: boolean) => void) => (() => void) | void
}

export function applyWindowActive(html: HTMLElement, active: boolean): void {
  if (active) delete html.dataset.inactive
  else html.dataset.inactive = ''
}

export function installWindowActiveStamp({ html, win, doc, onWindowActive }: WindowActiveDeps): () => void {
  applyWindowActive(html, doc.hasFocus())
  const onFocus = () => applyWindowActive(html, true)
  const onBlur = () => applyWindowActive(html, false)
  const onVisibility = () => { if (doc.visibilityState === 'hidden') applyWindowActive(html, false); else applyWindowActive(html, doc.hasFocus()) }
  win.addEventListener('focus', onFocus)
  win.addEventListener('blur', onBlur)
  doc.addEventListener('visibilitychange', onVisibility)
  const unsubscribeIpc = onWindowActive?.((active) => applyWindowActive(html, active))
  return () => {
    win.removeEventListener('focus', onFocus)
    win.removeEventListener('blur', onBlur)
    doc.removeEventListener('visibilitychange', onVisibility)
    if (typeof unsubscribeIpc === 'function') unsubscribeIpc()
  }
}
