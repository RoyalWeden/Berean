import * as SunCalc from 'suncalc'
import { useAppStore } from '@/store'

// Small date helpers shared by the daily-note UI (NotesPanel, CalendarWidget,
// ContinuousDailyScroll). Kept in their own module — rather than defined in one of
// those components and imported by the others — because NotesPanel imports
// ContinuousDailyScroll, so a component-to-component import of these helpers risks a
// cycle depending on which file "owns" them. A leaf lib module has no such risk and
// keeps all three callers byte-identical by construction instead of relying on
// hand-kept-in-sync copies.

/** "YYYY-MM-DD" in local time (not UTC) for the given date. */
export function toDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

/** The canonical title used for a daily note, e.g. "Daily — 2026-08-05". */
export function dailyNoteTitle(date: Date): string {
  return `Daily — ${toDateKey(date)}`
}

/** Long display form for a daily note's date, e.g. "Tuesday, August 5, 2026" — used
 *  only where the note is shown to the user (the top bar header); the underlying
 *  title (dailyNoteTitle above) stays untouched everywhere else (DB, tab bar, sidebar,
 *  wikilinks) so nothing that matches/parses that title breaks. `dateKey` is a
 *  "YYYY-MM-DD" string, e.g. from dailyNoteDateKey() in noteUtils.ts. Parsed as
 *  local-time components (not `new Date(dateKey)`, which parses as UTC midnight and
 *  can roll back a day in negative-UTC-offset zones). Saturday is the Sabbath, so its
 *  weekday reads "Sabbath" instead of "Saturday" — substituting the actual computed
 *  weekday token (not a hardcoded "Saturday" string) so this can't false-positive
 *  against anything else in the formatted string. */
export function dailyNoteDisplayTitle(dateKey: string): string {
  const [y, m, d] = dateKey.split('-').map(Number)
  const date = new Date(y, (m ?? 1) - 1, d ?? 1)
  const formatted = date.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
  if (date.getDay() !== 6) return formatted
  const weekday = date.toLocaleDateString('en-US', { weekday: 'long' }) // "Saturday"
  return formatted.replace(weekday, 'Sabbath')
}

/** Returns a new Date offset by n days (n may be negative). Does not mutate `date`. */
export function addDays(date: Date, n: number): Date {
  const d = new Date(date)
  d.setDate(d.getDate() + n)
  return d
}

/** The "daily note day" for `now`, given an optional cached device location. Days
 *  begin at dawn, not midnight: if `now` is before today's real sunrise at `location`,
 *  returns yesterday (the daily note that "began" at the prior sunrise is still
 *  current); otherwise returns `now` unchanged. With no location, or an unresolvable
 *  sunrise (polar day/night — SunCalc returns `null` for `sunrise` at high latitudes),
 *  returns `now` unchanged — i.e. falls back to the plain-midnight boundary. SunCalc's
 *  Date objects are precise UTC instants, so the `now < sunrise` comparison is
 *  timezone-safe; addDays below operates on `now`'s own local calendar-day components,
 *  consistent with toDateKey. */
export function getDailyNoteAnchorDate(now: Date, location: { lat: number; lon: number } | null): Date {
  if (!location) return now
  const { sunrise } = SunCalc.getTimes(now, location.lat, location.lon)
  if (!sunrise) return now
  return now < sunrise ? addDays(now, -1) : now
}

/** Convenience wrapper: getDailyNoteAnchorDate(new Date(), <cached store location>).
 *  Safe to call from plain functions/modules (not just components) since it reads the
 *  store via getState() rather than the useAppStore() hook. This is what every "what
 *  is today, right now" daily-note call site should call instead of `new Date()`. */
export function dailyNoteToday(): Date {
  return getDailyNoteAnchorDate(new Date(), useAppStore.getState().dailyNoteLocation)
}
