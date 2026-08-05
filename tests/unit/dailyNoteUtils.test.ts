import { describe, it, expect } from 'vitest'
import { toDateKey, dailyNoteTitle, addDays } from '@/lib/dailyNoteUtils'
import { toDateKey as calendarToDateKey } from '@/components/notes/CalendarWidget'

describe('dailyNoteUtils', () => {
  it('toDateKey formats local YYYY-MM-DD', () => {
    expect(toDateKey(new Date(2026, 0, 5))).toBe('2026-01-05')
    expect(toDateKey(new Date(2026, 11, 31))).toBe('2026-12-31')
  })

  it('dailyNoteTitle wraps toDateKey with the "Daily — " prefix', () => {
    expect(dailyNoteTitle(new Date(2026, 7, 4))).toBe('Daily — 2026-08-04')
  })

  it('addDays offsets without mutating the input', () => {
    const start = new Date(2026, 0, 31)
    const next = addDays(start, 1)
    expect(toDateKey(next)).toBe('2026-02-01')
    expect(toDateKey(start)).toBe('2026-01-31')

    const prev = addDays(start, -1)
    expect(toDateKey(prev)).toBe('2026-01-30')
  })

  // Regression guard: CalendarWidget, NotesPanel, ContinuousDailyScroll, and
  // Sidebar all used to keep their own copies of these helpers "to avoid
  // circular imports." They've since been consolidated onto this module —
  // this test pins CalendarWidget's re-export to the same implementation so a
  // future re-duplication attempt (e.g. reintroducing a local override) is
  // caught immediately rather than silently drifting again.
  it('CalendarWidget re-exports the same toDateKey implementation', () => {
    expect(calendarToDateKey).toBe(toDateKey)
  })
})
