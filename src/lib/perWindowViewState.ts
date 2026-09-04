// Per-window view state — the slice each synced window owns independently:
// which session / space / tab it's showing, and its panel layout. These used to
// live in the shared `berean-app-state` blob, where multiple synced windows
// clobbered one another's view on the next launch. They're now removed from the
// store's `partialize` and saved/restored here, one localStorage key per window.
//
// Slotting: the FIRST window of a launch (no `?mirrorFrom`) is the "primary"
// slot and persists. Windows spawned from another (`?mirrorFrom=<id>`) are
// ephemeral — they get seeded by the mirror handshake (crossWindowSync.ts) and
// their view is not remembered across a restart, matching how browser "new
// window" copies behave.

import { useAppStore } from '@/store'
import type { AppState } from '@/store'
import type { SpaceId } from '@/types'

interface SavedView {
  currentSessionId: string
  activeSpace: SpaceId
  activeTabId: Record<SpaceId, string | null>
  panelLayout: AppState['panelLayout']
}

const SPACES: SpaceId[] = ['scripture', 'notes', 'lexicon', 'youtube', 'search']

function slotKey(): string | null {
  try {
    const spawned = new URLSearchParams(window.location.search).has('mirrorFrom')
    return spawned ? null : 'berean-window-primary'
  } catch {
    return 'berean-window-primary'
  }
}

/** Clamp each per-space active tab to a tab that still exists in this session. */
function clampActiveTabs(
  wanted: Record<SpaceId, string | null>,
  tabs: Record<SpaceId, { id: string }[]>,
): Record<SpaceId, string | null> {
  const out = {} as Record<SpaceId, string | null>
  for (const sp of SPACES) {
    const id = wanted?.[sp] ?? null
    out[sp] = id && tabs[sp]?.some((t) => t.id === id) ? id : (tabs[sp]?.[0]?.id ?? null)
  }
  return out
}

/** Call once from App.tsx, before initCrossWindowSync(). Returns a teardown. */
export function initPerWindowViewState(): () => void {
  const key = slotKey()

  // ── Restore (persistent slot only) ───────────────────────────────────────
  if (key) {
    try {
      const raw = localStorage.getItem(key)
      if (raw) {
        const saved = JSON.parse(raw) as Partial<SavedView>
        const store = useAppStore.getState()

        if (saved.currentSessionId && saved.currentSessionId !== store.currentSessionId
            && store.sessions.some((s) => s.id === saved.currentSessionId)) {
          // Reuse the tested reconciliation (loads that session's tabs).
          store.switchSession(saved.currentSessionId)
        }

        const after = useAppStore.getState()
        const patch: Partial<AppState> = {}
        if (saved.activeSpace && SPACES.includes(saved.activeSpace)) patch.activeSpace = saved.activeSpace
        if (saved.panelLayout) patch.panelLayout = saved.panelLayout
        if (saved.activeTabId) patch.activeTabId = clampActiveTabs(saved.activeTabId, after.tabs)
        if (Object.keys(patch).length) useAppStore.setState(patch)
      }
    } catch { /* malformed / storage disabled — keep defaults */ }
  }

  // ── Persist on change (persistent slot only) ─────────────────────────────
  if (!key) return () => {}

  let timer: ReturnType<typeof setTimeout> | null = null
  let prev = ''
  const write = () => {
    timer = null
    const s = useAppStore.getState()
    const view: SavedView = {
      currentSessionId: s.currentSessionId,
      activeSpace: s.activeSpace,
      activeTabId: s.activeTabId,
      panelLayout: s.panelLayout,
    }
    const json = JSON.stringify(view)
    if (json === prev) return
    prev = json
    try { localStorage.setItem(key, json) } catch { /* storage disabled/quota */ }
  }

  const unsub = useAppStore.subscribe((s, p) => {
    if (
      s.currentSessionId !== p.currentSessionId ||
      s.activeSpace !== p.activeSpace ||
      s.activeTabId !== p.activeTabId ||
      s.panelLayout !== p.panelLayout
    ) {
      if (timer) clearTimeout(timer)
      timer = setTimeout(write, 250)
    }
  })

  const flush = () => { if (timer) { clearTimeout(timer); write() } }
  window.addEventListener('pagehide', flush)
  window.addEventListener('beforeunload', flush)

  return () => {
    unsub()
    window.removeEventListener('pagehide', flush)
    window.removeEventListener('beforeunload', flush)
    flush()
  }
}
