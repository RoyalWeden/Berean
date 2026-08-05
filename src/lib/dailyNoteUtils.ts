// Small, dependency-free date helpers shared by the daily-note UI (NotesPanel,
// CalendarWidget, ContinuousDailyScroll). Kept in their own module — rather than
// defined in one of those components and imported by the others — because
// NotesPanel imports ContinuousDailyScroll, so a component-to-component import
// of these helpers risks a cycle depending on which file "owns" them. A leaf
// lib module has no such risk and keeps all three callers byte-identical by
// construction instead of relying on hand-kept-in-sync copies.

/** "YYYY-MM-DD" in local time (not UTC) for the given date. */
export function toDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

/** The canonical title used for a daily note, e.g. "Daily — 2026-08-05". */
export function dailyNoteTitle(date: Date): string {
  return `Daily — ${toDateKey(date)}`
}

/** Returns a new Date offset by n days (n may be negative). Does not mutate `date`. */
export function addDays(date: Date, n: number): Date {
  const d = new Date(date)
  d.setDate(d.getDate() + n)
  return d
}
