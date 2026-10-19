import { perfSpan } from './perfSpan'
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

/** Characters of note text above which the warm-start snapshot is not written: WebKit (iPhone)
 *  allows ~5 MB of UTF-16 (~2.5 M chars), Chromium (Mac) ~5 M chars. */
const WARM_START_MAX_CHARS = import.meta.env.VITE_PLATFORM === 'ios' ? 2_000_000 : 4_500_000
function rememberNotes(notes: Note[]): void {
  lastKnownNotes = notes
  try {
    // A large library never fits WebKit's ~5 MB localStorage quota: serialising ~8 MB only to have
    // the write rejected cost every note change ~10–20 ms for nothing. Estimate first; when it
    // can't fit, drop the stale snapshot so the next launch doesn't warm-start from old data.
    let est = 0
    for (const n of notes) { est += (n.content?.length ?? 0) + 200; if (est > WARM_START_MAX_CHARS) break }
    if (est > WARM_START_MAX_CHARS) { localStorage.removeItem(STORAGE_KEY); return }
    perfSpan('rememberNotes', () => localStorage.setItem(STORAGE_KEY, JSON.stringify(notes)))
  } catch {
    // Quota exceeded or unavailable — the in-memory warm start still works for this session,
    // just without surviving to the next restart.
  }
}

/** Drop the warm-start notes snapshot, in memory and on disk (Settings → About → Clear cached content). */
export function clearWarmStartNotes(): void {
  lastKnownNotes = null
  try { localStorage.removeItem(STORAGE_KEY) } catch { /* ignore */ }
}

export function getAllNotes(token: number): Promise<Note[]> {
  if (!cache || cache.token !== token) {
    const t0 = performance.now()
    const promise = window.notes.getNotes(100000, 0).catch(() => [] as Note[])
    // Simulator profiling (probe builds only): when each all-notes fetch ran and how long it took.
    if (import.meta.env.VITE_E2E_PROBE === '1') void promise.then((n) => { const w = window as unknown as { __notesFetches?: Array<[number, number, number]> }; (w.__notesFetches ??= []).push([Math.round(t0), Math.round(performance.now() - t0), n.length]) })
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
