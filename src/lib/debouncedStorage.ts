// Wraps `localStorage` for zustand's `persist` middleware so that `setItem` is
// debounced instead of writing synchronously on every single `set()` call.
//
// Why this exists: zustand's `persist` (see node_modules/zustand/middleware.js)
// calls `storage.setItem(name, JSON.stringify(state))` after EVERY mutation to
// any persisted key, with no "did the persisted slice actually change" check.
// For berean-app-state that's a full-store JSON.stringify + synchronous
// localStorage write several times per tab switch, on every debounced scroll
// save, and on every spoken word during Read Aloud (setAudioPlayback ->
// useTTSPlayback.ts). Debouncing collapses bursts of those into one write,
// while `flush()` guarantees the last write still lands before the window/app
// actually goes away.
//
// getItem/removeItem pass straight through — only setItem (the expensive,
// bursty side) is debounced. Reads are rare (mount-time rehydration only).

const DEBOUNCE_MS = 500

let pendingKey: string | null = null
let pendingValue: string | null = null
let timer: ReturnType<typeof setTimeout> | null = null

function flush(): void {
  if (timer !== null) {
    clearTimeout(timer)
    timer = null
  }
  if (pendingKey !== null && pendingValue !== null) {
    try {
      localStorage.setItem(pendingKey, pendingValue)
    } catch {
      // Same failure modes as a plain localStorage.setItem (quota exceeded,
      // storage disabled) — nothing productive to do beyond not crashing.
    }
    pendingKey = null
    pendingValue = null
  }
}

// Flush on the way out so the last few hundred ms of state aren't lost on
// quit/reload. Electron closes the BrowserWindow (firing beforeunload) before
// the app process exits, so this covers both app quit and manual reload.
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', flush)
  // Backstop for the case beforeunload never fires — a hard crash, `kill`, or the OS force-
  // quitting the app. Those skip the normal close path entirely, so a change made within the
  // 500ms debounce window right before one would otherwise be silently lost. Cheap: flush() is a
  // no-op when nothing is pending, so this just re-checks periodically rather than adding real
  // write traffic.
  setInterval(flush, 5000)
}

export const debouncedLocalStorage = {
  getItem: (name: string): string | null => {
    // If a write to this key is still pending, prefer it over the (stale)
    // on-disk value so a read immediately after a write is consistent.
    if (pendingKey === name && pendingValue !== null) return pendingValue
    return localStorage.getItem(name)
  },
  setItem: (name: string, value: string): void => {
    pendingKey = name
    pendingValue = value
    if (timer !== null) clearTimeout(timer)
    timer = setTimeout(flush, DEBOUNCE_MS)
  },
  removeItem: (name: string): void => {
    if (pendingKey === name) {
      pendingKey = null
      pendingValue = null
    }
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
    localStorage.removeItem(name)
  },
}
