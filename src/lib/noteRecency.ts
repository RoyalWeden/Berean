/**
 * Recency sections for a notes list (NOTES-HOME-003) — the Apple Notes model, deterministic and
 * computed in the device's local time:
 *
 *   Today              the local calendar day of `now` (a date in the future — a skewed clock —
 *                      counts as today)
 *   Previous 7 Days    the 7 calendar days before today  (1 ≤ days ago ≤ 7)
 *   Previous 30 Days   the 23 calendar days before those (8 ≤ days ago ≤ 30)
 *   <Month>            older notes, one section per calendar month, newest month first; the
 *                      year is shown only when it is not the current year ("August",
 *                      "December 2025")
 *
 * A note belongs to exactly one section. "Days ago" counts calendar days (midnight boundaries),
 * not 24-hour periods, so a note from 11 pm yesterday is "Previous 7 Days", not "Today".
 */
export interface RecencySection<T> { id: string; label: string; items: T[] }

const DAY = 24 * 60 * 60 * 1000
const startOfDay = (t: number) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime() }

/** Whole calendar days between the day of `t` and the day of `now` (0 = same day, negative = future). */
export function calendarDaysAgo(t: number, now: number): number {
  return Math.round((startOfDay(now) - startOfDay(t)) / DAY)
}

export function monthLabel(t: number, now: number, locale?: string): string {
  const d = new Date(t)
  const sameYear = d.getFullYear() === new Date(now).getFullYear()
  return d.toLocaleDateString(locale, sameYear ? { month: 'long' } : { month: 'long', year: 'numeric' })
}

export function recencySectionOf(t: number, now: number, locale?: string): { id: string; label: string } {
  const days = calendarDaysAgo(t, now)
  if (days <= 0) return { id: 'today', label: 'Today' }
  if (days <= 7) return { id: 'prev7', label: 'Previous 7 Days' }
  if (days <= 30) return { id: 'prev30', label: 'Previous 30 Days' }
  const d = new Date(t)
  return { id: `m-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, label: monthLabel(t, now, locale) }
}

/** Group items (already sorted newest first by `dateOf`) into recency sections, in order. */
export function groupByRecency<T>(items: readonly T[], dateOf: (item: T) => number, now: number, locale?: string): RecencySection<T>[] {
  const out: RecencySection<T>[] = []
  const byId = new Map<string, RecencySection<T>>()
  for (const item of items) {
    const s = recencySectionOf(dateOf(item), now, locale)
    let sec = byId.get(s.id)
    if (!sec) { sec = { ...s, items: [] }; byId.set(s.id, sec); out.push(sec) }
    sec.items.push(item)
  }
  const rank = (id: string) => (id === 'today' ? 0 : id === 'prev7' ? 1 : id === 'prev30' ? 2 : 3)
  return out.sort((a, b) => rank(a.id) - rank(b.id) || (b.id > a.id ? 1 : b.id < a.id ? -1 : 0))
}

/** The date a list row shows (Apple Notes style): a time today, a weekday within the week, else a short date. */
export function rowDateLabel(t: number, now: number, locale?: string): string {
  const days = calendarDaysAgo(t, now)
  if (days <= 0) return new Date(t).toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' })
  if (days <= 6) return new Date(t).toLocaleDateString(locale, { weekday: 'long' })
  return new Date(t).toLocaleDateString(locale, { year: '2-digit', month: 'numeric', day: 'numeric' })
}
