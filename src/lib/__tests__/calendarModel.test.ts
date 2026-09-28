/** SEP27-CAL-001 — the calendar month grid and date keys. */
import { describe, it, expect } from 'vitest'
import { monthGrid, monthKeyOf, monthFromKey, addMonths, dateFromKey } from '@/lib/calendarModel'

describe('calendar model', () => {
  it('September 2026 starts on Tuesday and fills whole weeks', () => {
    const g = monthGrid(new Date(2026, 8, 1))
    expect(g.every((w) => w.length === 7)).toBe(true)
    expect(g[0][2].key).toBe('2026-09-01')          // Tue
    expect(g[0][0].inMonth).toBe(false)             // Aug 30
    const days = g.flat().filter((d) => d.inMonth).map((d) => d.key)
    expect(days).toHaveLength(30)
    expect(days.at(-1)).toBe('2026-09-30')
  })
  it('February of a leap year and a month starting on Sunday', () => {
    expect(monthGrid(new Date(2028, 1, 1)).flat().filter((d) => d.inMonth)).toHaveLength(29)
    const nov = monthGrid(new Date(2026, 10, 1)) // Nov 1 2026 is a Sunday
    expect(nov[0][0].key).toBe('2026-11-01')
  })
  it('month keys, navigation across years, local date parsing', () => {
    expect(monthKeyOf(new Date(2026, 0, 31))).toBe('2026-01')
    expect(monthKeyOf(addMonths(new Date(2026, 0, 1), -1))).toBe('2025-12')
    expect(monthKeyOf(addMonths(new Date(2026, 11, 1), 1))).toBe('2027-01')
    expect(monthKeyOf(monthFromKey('2026-09'))).toBe('2026-09')
    expect(monthKeyOf(monthFromKey('bad', new Date(2026, 4, 9)))).toBe('2026-05')
    const d = dateFromKey('2026-09-26')
    expect([d.getFullYear(), d.getMonth(), d.getDate()]).toEqual([2026, 8, 26])
  })
})
