// Storage adapters for zustand's `persist` middleware.
//
// Why this exists: zustand's `persist` (see node_modules/zustand/middleware.js)
// calls `storage.setItem(name, ...)` after EVERY mutation to any persisted key,
// with no "did the persisted slice actually change" check. When `storage` is a
// `createJSONStorage(...)` wrapper, that helper runs `JSON.stringify(state)`
// *synchronously, before* our adapter's `setItem` is even called — so debouncing
// only the `localStorage` write still leaves a full-store stringify on the main
// thread several times per tab switch, on every debounced scroll save, and on
// every spoken word during Read Aloud (setAudioPlayback -> useTTSPlayback.ts),
// plus every non-persisted `bump*Token` / `isNavJumping` toggle.
//
// So these adapters implement zustand's `PersistStorage<S>` interface directly
// (object in, object out — NOT `StateStorage`, which is string-based). That
// hands us the live state OBJECT in `setItem`; we stash it and defer BOTH the
// `JSON.stringify` and the `localStorage.setItem` into the debounced `flush()`.
// A burst of 50 `set()`s then costs one stringify + one write instead of 50.
//
// getItem returns the pending object (already parsed) if a write is still
// in-flight, else parses the on-disk string. Reads are rare (mount-time
// rehydration only).

type StoredValue = { state: unknown; version?: number }

const DEBOUNCE_MS = 500

let pendingKey: string | null = null
let pendingValue: StoredValue | null = null
let hasPending = false
let timer: ReturnType<typeof setTimeout> | null = null

function flush(): void {
  if (timer !== null) {
    clearTimeout(timer)
    timer = null
  }
  if (hasPending && pendingKey !== null && pendingValue !== null) {
    try {
      // The stringify itself is deferred to here — this is the whole point of
      // the adapter. Coalesced bursts pay for it exactly once.
      localStorage.setItem(pendingKey, JSON.stringify(pendingValue))
    } catch {
      // Same failure modes as a plain localStorage.setItem (quota exceeded,
      // storage disabled) — nothing productive to do beyond not crashing.
    }
  }
  pendingKey = null
  pendingValue = null
  hasPending = false
}

// Flush on the way out so the last few hundred ms of state aren't lost on
// quit/reload. Electron closes the BrowserWindow (firing beforeunload) before
// the app process exits, so this covers both app quit and manual reload.
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', flush)
  // `pagehide` and a visibility flip to hidden fire on Chromium teardown paths where
  // `beforeunload` sometimes doesn't (app quit while the window is backgrounded, some
  // auto-update relaunches). All three just call the same idempotent flush().
  window.addEventListener('pagehide', flush)
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush() })
  // Backstop for the case none of the above fire — a hard crash, `kill`, or the OS force-
  // quitting the app. Those skip the normal close path entirely, so a change made within the
  // 500ms debounce window right before one would otherwise be silently lost. Cheap: flush() is a
  // no-op when nothing is pending, so this just re-checks periodically rather than adding real
  // write traffic.
  setInterval(flush, 5000)
}

export const debouncedLocalStorage = {
  getItem: (name: string): StoredValue | null => {
    // If a write to this key is still pending, prefer it over the (stale)
    // on-disk value so a read immediately after a write is consistent.
    if (pendingKey === name && hasPending && pendingValue !== null) return pendingValue
    let raw: string | null = null
    try { raw = localStorage.getItem(name) } catch { return null }
    if (raw === null) return null
    try { return JSON.parse(raw) as StoredValue } catch { return null }
  },
  setItem: (name: string, value: StoredValue): void => {
    pendingKey = name
    pendingValue = value
    hasPending = true
    if (timer !== null) clearTimeout(timer)
    timer = setTimeout(flush, DEBOUNCE_MS)
  },
  removeItem: (name: string): void => {
    if (pendingKey === name) {
      pendingKey = null
      pendingValue = null
      hasPending = false
    }
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
    try { localStorage.removeItem(name) } catch { /* storage disabled — nothing to do */ }
  },
}

// Read-through, write-NOTHING storage for zustand `persist` in the SECONDARY
// windows (presenter/viewer, Study Trail, floating panel). Those windows each
// construct their own `useAppStore` instance from the same module, and every
// one of them was persisting its FULL state snapshot back to the shared
// 'berean-app-state' key — including default values for the ~40 preference
// fields that are never pushed into a secondary window. Whichever window
// flushed last therefore decided what landed on disk, so a setting changed in
// the main window would silently revert to a default on the next launch after
// the viewer/trail window had been opened even once ("settings don't save
// across restarts"). Secondary windows still REHYDRATE from the shared key
// (getItem) and receive live updates through their existing IPC push channels;
// they just no longer own the canonical blob. Anything a secondary window
// genuinely must persist uses its own dedicated key written directly (e.g.
// 'berean-viewer-font-scale', 'berean-ask-why-sync').
export const readThroughLocalStorage = {
  getItem: (name: string): StoredValue | null => {
    let raw: string | null = null
    try { raw = localStorage.getItem(name) } catch { return null }
    if (raw === null) return null
    try { return JSON.parse(raw) as StoredValue } catch { return null }
  },
  setItem: (_name: string, _value: StoredValue): void => { /* intentionally no-op — see comment above */ },
  removeItem: (_name: string): void => { /* intentionally no-op */ },
}
