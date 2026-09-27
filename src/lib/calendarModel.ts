import { toDateKey } from './dailyNoteUtils'

/**
 * Pure month-grid model for Berean's calendars (SEP27-CAL-001) — the iPhone calendar view (overlay
 * and Calendar tab) builds its grid from this; dates use the same local "YYYY-MM-DD" keys as
 * daily-note titles (dailyNoteUtils.toDateKey), so a note dot and a tapped date always agree.
 */
export interface CalendarDay { date: Date; key: string; inMonth: boolean }

/** "YYYY-MM" for a date (the Calendar tab's persisted month). */
export function monthKeyOf(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

/** First day of the month named by "YYYY-MM" (falls back to `fallback` for a bad key). */
export function monthFromKey(key: string | null | undefined, fallback: Date = new Date()): Date {
  const m = /^(\d{4})-(\d{2})$/.exec(key ?? '')
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, 1) : new Date(fallback.getFullYear(), fallback.getMonth(), 1)
}

/** Date for a "YYYY-MM-DD" key, in local time (never `new Date(key)`, which is UTC midnight). */
export function dateFromKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, (m ?? 1) - 1, d ?? 1)
}

/** The month `n` months after `month` (first day). */
export function addMonths(month: Date, n: number): Date {
  return new Date(month.getFullYear(), month.getMonth() + n, 1)
}

/** Whole weeks (Sunday first) covering the month — 4 to 6 rows, days outside the month flagged. */
export function monthGrid(month: Date): CalendarDay[][] {
  const first = new Date(month.getFullYear(), month.getMonth(), 1)
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate()
  const rows = Math.ceil((first.getDay() + daysInMonth) / 7)
  const weeks: CalendarDay[][] = []
  for (let w = 0; w < rows; w++) {
    const week: CalendarDay[] = []
    for (let d = 0; d < 7; d++) {
      const date = new Date(first.getFullYear(), first.getMonth(), 1 - first.getDay() + w * 7 + d)
      week.push({ date, key: toDateKey(date), inMonth: date.getMonth() === first.getMonth() })
    }
    weeks.push(week)
  }
  return weeks
}

/** "September 2026". */
export function monthLabel(month: Date): string {
  return month.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
}
