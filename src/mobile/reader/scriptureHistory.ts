import { useSyncExternalStore } from 'react'
import { useAppStore } from '@/store'
import type { HistoryEntry } from '@/types'

/**
 * Scripture-picker search history (PICKER-SEARCH): a small localStorage-backed recency list of
 * text/Strong's queries run from inside the `PassagePicker` sheet — separate from the app-wide
 * History store (which already covers "opened books/chapters/verses" through `bible`/`compare`
 * entries, see historyModel.ts) and separate from the Search tab's own history
 * (src/mobile/search/searchHistory.ts, which is per-tab nav steps for the dedicated Search space,
 * not written here). Mirrors the localStorage pattern readerWidth.ts uses: a module-level cache,
 * a distinct storage key, a `useSyncExternalStore` hook, best-effort reads/writes.
 */
const KEY = 'berean.picker.searchHistory'
const MAX_ENTRIES = 40

export interface PickerSearchEntry {
  id: string
  ts: number
  /** 'strongs' — a Strong's-number query ("H7225"); 'text' — a free-text verse search. */
  kind: 'text' | 'strongs'
  query: string
}

let cache: PickerSearchEntry[] | null = null
const listeners = new Set<() => void>()

function isEntry(v: unknown): v is PickerSearchEntry {
  return !!v && typeof v === 'object'
    && typeof (v as PickerSearchEntry).id === 'string'
    && typeof (v as PickerSearchEntry).ts === 'number'
    && ((v as PickerSearchEntry).kind === 'text' || (v as PickerSearchEntry).kind === 'strongs')
    && typeof (v as PickerSearchEntry).query === 'string'
}

function read(): PickerSearchEntry[] {
  if (cache) return cache
  try {
    const raw = localStorage.getItem(KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    cache = Array.isArray(parsed) ? parsed.filter(isEntry) : []
  } catch { cache = [] }
  return cache
}

function write(entries: PickerSearchEntry[]): void {
  cache = entries
  try { localStorage.setItem(KEY, JSON.stringify(entries)) } catch { /* in-memory only */ }
  listeners.forEach((l) => l())
}

/** Record a search run inside the picker; a repeat of the same (kind, query) just moves to the
 *  front instead of duplicating. No-ops on an empty query. */
export function recordPickerSearch(kind: 'text' | 'strongs', query: string): void {
  const q = query.trim()
  if (!q) return
  const ts = Date.now()
  const rest = read().filter((e) => !(e.kind === kind && e.query.toLowerCase() === q.toLowerCase()))
  write([{ id: `${kind}:${q.toLowerCase()}:${ts}`, ts, kind, query: q }, ...rest].slice(0, MAX_ENTRIES))
}

export function clearPickerSearchHistory(): void { write([]) }

/** Live list of recorded picker searches, most recent first. */
export function usePickerSearchHistory(): PickerSearchEntry[] {
  return useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l) } }, read, read)
}

/** Tests only. */
export function _resetPickerSearchHistory(): void { cache = null; try { localStorage.removeItem(KEY) } catch { /* ignore */ } }

// ── Merged view (visits + picker searches) ──────────────────────────────────────────────────

export type ScriptureHistoryRow =
  | { kind: 'visit'; ts: number; entry: HistoryEntry }
  | { kind: 'text'; ts: number; entry: PickerSearchEntry }
  | { kind: 'strongs'; ts: number; entry: PickerSearchEntry }

const rowKey = (r: ScriptureHistoryRow): string =>
  r.kind === 'visit' ? `visit:${r.entry.id}` : `${r.kind}:${r.entry.query.toLowerCase()}`

/**
 * Scripture-only history for the picker's History view: Scripture reader visits (the app
 * history store's `bible`/`compare` entries — the same ones historyModel.ts's "Scripture"
 * category shows) merged with this module's own text/Strong's search log, deduped and sorted
 * by recency. Deliberately excludes Notes search, YouTube search, Lexicon search, imports, etc.
 * — those are `search`/`note`/`youtube`/`import`/`lexicon` app-history entries, not in this list.
 */
export function buildScriptureHistoryRows(appHistory: readonly HistoryEntry[], picker: readonly PickerSearchEntry[], limit = 60): ScriptureHistoryRow[] {
  const rows: ScriptureHistoryRow[] = []
  for (const e of appHistory) if (e.type === 'bible' || e.type === 'compare') rows.push({ kind: 'visit', ts: e.timestamp, entry: e })
  for (const e of picker) rows.push({ kind: e.kind, ts: e.ts, entry: e })
  const seen = new Set<string>()
  return rows
    .sort((a, b) => b.ts - a.ts)
    .filter((r) => { const k = rowKey(r); if (seen.has(k)) return false; seen.add(k); return true })
    .slice(0, limit)
}

export function useScriptureHistoryRows(limit = 60): ScriptureHistoryRow[] {
  const appHistory = useAppStore((s) => s.history)
  const picker = usePickerSearchHistory()
  return buildScriptureHistoryRows(appHistory, picker, limit)
}
