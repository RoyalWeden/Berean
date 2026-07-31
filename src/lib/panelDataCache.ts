import type { Note } from '@/types'

/**
 * Request-deduplicating caches for the scripture side panel's IPC fetches.
 *
 * The side panel can be split into two slots (A and B), and each slot mounts its own
 * full `BibleRightPanel` instance. Both instances run the same mount/tab-change effects,
 * so when both slots are open on the same book/chapter — the normal case, since slot B is
 * popped out of the same scripture tab — every fetch fired twice: two `getChapterNotes`,
 * two `searchNotes`, two chapter cross-ref queries, two lexicon lookups. That doubled the
 * IPC round-trips and doubled the re-render cascade as each duplicate promise resolved,
 * which is what made expanding the split panel feel laggy.
 *
 * The fix is to cache the in-flight PROMISE (not just its resolved value) keyed by the
 * request parameters, so two callers asking for the same data share one underlying call.
 * Mirrors the existing pattern in notesCache.ts / crossRefIndex.ts.
 *
 * Two cache flavours, because the data has two very different lifetimes:
 *
 *  - **Note data** is mutable. It is keyed by `noteChangeToken` (the same invalidation
 *    signal the panel's effects already depend on), so any note create/edit/delete drops
 *    every cached note promise and both slots refetch. On top of that it carries a short
 *    TTL, so an entry only survives long enough to merge near-simultaneous mounts; a mount
 *    that happens later still hits the DB, preserving today's fetch-fresh-on-mount
 *    behaviour for anything that might ever change without bumping the token.
 *
 *  - **Lexicon and cross-reference data** comes from read-only bundled databases that
 *    cannot change while the app runs, so those entries are kept without a TTL, capped at
 *    a small number of entries with oldest-first eviction so the maps cannot grow forever.
 */

/** How long a note-derived entry may be reused. Long enough to merge two slots mounting
 *  in the same tick (and a quick collapse/expand), short enough that it is never a
 *  meaningful staleness window. */
const NOTE_TTL_MS = 3000

/** Cap for the static (lexicon / cross-ref) maps — plenty for a study session, bounded. */
const STATIC_MAX_ENTRIES = 60

interface NoteEntry {
  token: number
  at: number
  promise: Promise<unknown>
}

const noteCache = new Map<string, NoteEntry>()
let noteCacheToken = -1

/** Shared fetch for note-derived data, invalidated by `noteChangeToken` and by TTL. */
function dedupeNotes<T>(key: string, token: number, fetcher: () => Promise<T>): Promise<T> {
  if (token !== noteCacheToken) {
    noteCache.clear()
    noteCacheToken = token
  }
  const hit = noteCache.get(key)
  if (hit && hit.token === token && Date.now() - hit.at < NOTE_TTL_MS) {
    return hit.promise as Promise<T>
  }
  const promise = fetcher()
  noteCache.set(key, { token, at: Date.now(), promise })
  // A failed fetch must not be remembered — drop it so the next caller retries.
  promise.catch(() => {
    if (noteCache.get(key)?.promise === promise) noteCache.delete(key)
  })
  return promise
}

const staticCache = new Map<string, Promise<unknown>>()

/** Shared fetch for immutable bundled-database data. */
function dedupeStatic<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
  const hit = staticCache.get(key)
  if (hit) return hit as Promise<T>
  const promise = fetcher()
  staticCache.set(key, promise)
  promise.catch(() => {
    if (staticCache.get(key) === promise) staticCache.delete(key)
  })
  while (staticCache.size > STATIC_MAX_ENTRIES) {
    const oldest = staticCache.keys().next()
    if (oldest.done) break
    staticCache.delete(oldest.value)
  }
  return promise
}

// ── Notes ────────────────────────────────────────────────────────────────────

export function getChapterNotesShared(bookId: string, chapter: number, token: number): Promise<Note[]> {
  return dedupeNotes(`chapter:${bookId}:${chapter}`, token, () => window.notes.getChapterNotes(bookId, chapter))
}

export function searchNotesShared(query: string, limit: number, token: number): Promise<Note[]> {
  return dedupeNotes(`search:${limit}:${query}`, token, () => window.notes.searchNotes(query, limit))
}

export function getNotesShared(limit: number, offset: number, token: number): Promise<Note[]> {
  return dedupeNotes(`list:${limit}:${offset}`, token, () => window.notes.getNotes(limit, offset))
}

// ── Lexicon ──────────────────────────────────────────────────────────────────

export function getLexiconEntryShared(strongsNum: string): Promise<any> {
  return dedupeStatic(`lex:entry:${strongsNum}`, () => window.lexicon.getEntry(strongsNum))
}

export function getLexiconRelatedShared(strongsNum: string): Promise<any> {
  return dedupeStatic(`lex:related:${strongsNum}`, () => window.lexicon.getRelated(strongsNum))
}

export function getLexiconOccurrencesShared(strongsNum: string): Promise<any> {
  return dedupeStatic(`lex:occ:${strongsNum}`, () => window.lexicon.getOccurrences(strongsNum))
}

// ── Cross-references ─────────────────────────────────────────────────────────

export function getTSKeForChapterShared(bookId: string, chapter: number): Promise<any> {
  return dedupeStatic(`tske:${bookId}:${chapter}`, () => window.crossrefs.getTSKeForChapter(bookId, chapter))
}

export function getCrossRefsForChapterShared(bookId: string, chapter: number): Promise<any> {
  return dedupeStatic(`xref:${bookId}:${chapter}`, () => window.crossrefs.getForChapter(bookId, chapter))
}

/** Test hook — drops every cached entry. */
export function __resetPanelDataCache() {
  noteCache.clear()
  staticCache.clear()
  noteCacheToken = -1
}
