import type { Note } from '@/types'

/**
 * Shared, deduplicated "all notes" fetch — mirrors crossRefIndex.ts's own cache pattern.
 *
 * Sidebar.tsx, ShellHeader.tsx, HistoryModal.tsx, NotesPanel.tsx, and crossRefIndex.ts all
 * independently called `window.notes.getNotes(100000, 0)` on every `noteChangeToken` bump —
 * meaning a single keystroke-driven note autosave fanned out into 5+ separate IPC round-trips
 * and 5+ separately-parsed copies of the entire notes table held in memory at once. Since every
 * caller wants the same data for the same token, they can share one in-flight/resolved promise
 * (and therefore one parsed array, referenced — not copied — by every subscriber's local state)
 * instead of each doing the fetch and the parsing themselves.
 */
let cache: { token: number; promise: Promise<Note[]> } | null = null

const STORAGE_KEY = 'berean:notesCache:v1'

// Cross-restart, token-independent warm start. `cache` above is keyed strictly by
// noteChangeToken — correct for freshness, but that strictness means it can't safely be seeded
// from localStorage at a guessed token: App.tsx's startup vault reconcile ("pull in any changes
// made in Octarine while app was closed") fires a vault-change event on almost every launch,
// which bumps noteChangeToken past its default before or shortly after first paint, instantly
// invalidating any token-pinned seed. `lastKnownNotes` intentionally has NO freshness guarantee
// and is never used to answer a real fetch — it exists only so a `useState` initializer has
// SOMETHING real to render on the very first frame instead of [], even if it's a fetch or two
// stale; the real (token-matched) data always supersedes it within a tick or two via getAllNotes().
let lastKnownNotes: Note[] | null = (() => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as Note[]) : null
  } catch {
    return null
  }
})()

function rememberNotes(notes: Note[]): void {
  lastKnownNotes = notes
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(notes))
  } catch {
    // Quota exceeded or unavailable — the in-memory warm start still works for this session,
    // just without surviving to the next restart.
  }
}

export function getAllNotes(token: number): Promise<Note[]> {
  if (!cache || cache.token !== token) {
    const promise = window.notes.getNotes(100000, 0).catch(() => [] as Note[])
    promise.then(rememberNotes)
    cache = { token, promise }
  }
  return cache.promise
}

/**
 * Synchronous, token-independent warm-start read — the last notes list this module has ever
 * seen, from this session OR (via localStorage) a previous one. No freshness guarantee; only
 * for seeding a `useState` initializer so the first frame shows real data instead of an empty
 * flash.
 */
export function getWarmStartNotes(): Note[] | null {
  return lastKnownNotes
}
