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

export function getAllNotes(token: number): Promise<Note[]> {
  if (!cache || cache.token !== token) {
    cache = { token, promise: window.notes.getNotes(100000, 0).catch(() => [] as Note[]) }
  }
  return cache.promise
}
