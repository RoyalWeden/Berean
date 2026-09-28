/** NOTES-HOME-003 — deterministic, mutually exclusive recency sections. */
import { describe, it, expect } from 'vitest'
import { groupByRecency, recencySectionOf, monthLabel, calendarDaysAgo, rowDateLabel } from '../noteRecency'

const now = new Date(2026, 8, 28, 10, 0).getTime()            // Monday 28 Sept 2026, 10:00 local
const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).getTime()

describe('recency sections', () => {
  it('Today / Previous 7 Days / Previous 30 Days / months — each boundary', () => {
    expect(recencySectionOf(at(2026, 9, 28, 0), now).id).toBe('today')
    expect(recencySectionOf(at(2026, 9, 27, 23), now).id).toBe('prev7')     // yesterday 11 pm is not "Today"
    expect(recencySectionOf(at(2026, 9, 21), now).id).toBe('prev7')         // 7 days ago
    expect(recencySectionOf(at(2026, 9, 20), now).id).toBe('prev30')        // 8 days ago
    expect(recencySectionOf(at(2026, 8, 29), now).id).toBe('prev30')        // 30 days ago
    expect(recencySectionOf(at(2026, 8, 28), now)).toEqual({ id: 'm-2026-08', label: 'August' })
    expect(recencySectionOf(at(2025, 12, 5), now)).toEqual({ id: 'm-2025-12', label: 'December 2025' })
    expect(recencySectionOf(at(2026, 10, 3), now).id).toBe('today')         // future (clock skew)
  })

  it('current-year months omit the year; earlier years include it', () => {
    expect(monthLabel(at(2026, 7, 4), now, 'en-US')).toBe('July')
    expect(monthLabel(at(2025, 7, 4), now, 'en-US')).toBe('July 2025')
  })

  it('every note is in exactly one section, sections in order (Today, 7, 30, newest month first)', () => {
    const dates = [at(2026, 9, 28), at(2026, 9, 25), at(2026, 9, 10), at(2026, 7, 3), at(2026, 6, 1), at(2025, 11, 9), at(2026, 9, 28, 8)]
    const sorted = [...dates].sort((a, b) => b - a)
    const secs = groupByRecency(sorted, (t) => t, now, 'en-US')
    expect(secs.map((s) => s.label)).toEqual(['Today', 'Previous 7 Days', 'Previous 30 Days', 'July', 'June', 'November 2025'])
    expect(secs.reduce((n, s) => n + s.items.length, 0)).toBe(dates.length)
    expect(new Set(secs.flatMap((s) => s.items)).size).toBe(dates.length)
  })

  it('calendar days, not 24-hour periods', () => {
    expect(calendarDaysAgo(at(2026, 9, 27, 23), now)).toBe(1)
    expect(calendarDaysAgo(at(2026, 9, 28, 1), now)).toBe(0)
  })

  it('row date: a time today, a weekday this week, a short date otherwise', () => {
    expect(rowDateLabel(at(2026, 9, 28, 9), now, 'en-US')).toMatch(/9:00/)
    expect(rowDateLabel(at(2026, 9, 25), now, 'en-US')).toBe('Friday')
    expect(rowDateLabel(at(2026, 8, 1), now, 'en-US')).toBe('8/1/26')
  })
})
