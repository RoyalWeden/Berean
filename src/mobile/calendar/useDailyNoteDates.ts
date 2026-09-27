import { useEffect, useState } from 'react'
import { useAppStore } from '@/store'

/** Latest date index per notes-change token — one query shared by every calendar on screen. */
let cache: { token: number; promise: Promise<Map<string, string>> } | null = null

/** Load (once per notes change) the dates that have a daily note: dateKey → noteId. */
export function loadDailyNoteDates(token: number): Promise<Map<string, string>> {
  if (cache && cache.token === token) return cache.promise
  const promise = (window.notes.getDailyDates?.() ?? Promise.resolve([]))
    .then((rows) => new Map(rows.map((r) => [r.dateKey, r.noteId] as const)))
    .catch(() => new Map<string, string>())
  cache = { token, promise }
  return promise
}

/**
 * Dates that have a daily note, for calendar dots (SEP27-CAL-002): the shared notes service's
 * lightweight `getDailyDates` (titles only — no note bodies), refreshed when notes change, works
 * offline (local database). `null` until the first load.
 */
export function useDailyNoteDates(): Map<string, string> | null {
  const token = useAppStore((s) => s.noteChangeToken)
  const [dates, setDates] = useState<Map<string, string> | null>(null)
  useEffect(() => {
    let alive = true
    void loadDailyNoteDates(token).then((m) => { if (alive) setDates(m) })
    return () => { alive = false }
  }, [token])
  return dates
}
