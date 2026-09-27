import React, { useMemo, useRef } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { dailyNoteToday, toDateKey } from '@/lib/dailyNoteUtils'
import { addMonths, monthGrid, monthLabel } from '@/lib/calendarModel'
import { haptic } from '../primitives/haptics'
import { useDailyNoteDates } from './useDailyNoteDates'
import './calendar.css'

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Sabbath']

/**
 * The reusable iPhone calendar (SEP27-CAL-001) — used by the Calendar overlay and the Calendar tab.
 * A native month grid: month title with ‹ ›, a Today shortcut, 44 pt day cells, today ringed, the
 * chosen day filled, one small dot under any day that has a daily note (however many). Horizontal
 * swipes change the month. Days are the daily-note day (it begins at sunrise — dailyNoteToday).
 * Choosing a day calls `onPick` — callers open that day's daily note.
 */
export function CalendarView({ month, onMonth, selectedKey, onPick }: {
  month: Date
  onMonth: (m: Date) => void
  selectedKey?: string | null
  onPick: (date: Date) => void
}) {
  const dates = useDailyNoteDates()
  const weeks = useMemo(() => monthGrid(month), [month])
  const todayKey = toDateKey(dailyNoteToday())
  const swipe = useRef<{ x: number; y: number } | null>(null)
  const step = (n: number) => { void haptic.selection(); onMonth(addMonths(month, n)) }
  const isThisMonth = month.getFullYear() === dailyNoteToday().getFullYear() && month.getMonth() === dailyNoteToday().getMonth()
  return (
    <div className="m-cal"
      onTouchStart={(e) => { const t = e.touches[0]; swipe.current = t ? { x: t.clientX, y: t.clientY } : null }}
      onTouchEnd={(e) => {
        const s = swipe.current; swipe.current = null
        const t = e.changedTouches[0]
        if (!s || !t) return
        const dx = t.clientX - s.x, dy = t.clientY - s.y
        if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) step(dx < 0 ? 1 : -1)
      }}>
      <div className="m-cal-head">
        <h2 className="m-cal-title" aria-live="polite">{monthLabel(month)}</h2>
        {!isThisMonth && <button type="button" className="m-cal-today" onClick={() => { void haptic.selection(); onMonth(new Date(dailyNoteToday().getFullYear(), dailyNoteToday().getMonth(), 1)) }}>Today</button>}
        <button type="button" className="m-cal-nav" aria-label="Previous month" onClick={() => step(-1)}><ChevronLeft size={22} aria-hidden /></button>
        <button type="button" className="m-cal-nav" aria-label="Next month" onClick={() => step(1)}><ChevronRight size={22} aria-hidden /></button>
      </div>
      <div className="m-cal-weekdays" aria-hidden>{WEEKDAYS.map((d, i) => <span key={i}>{d}</span>)}</div>
      <div className="m-cal-grid" role="grid" aria-label={monthLabel(month)}>
        {weeks.map((w, wi) => (
          <div key={wi} className="m-cal-week" role="row">
            {w.map((d) => {
              const hasNote = !!dates?.has(d.key)
              const isToday = d.key === todayKey
              const isSel = d.key === selectedKey
              const label = `${WEEKDAY_NAMES[d.date.getDay()]}, ${d.date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}${isToday ? ', today' : ''}${hasNote ? ', has a daily note' : ''}`
              return (
                <button key={d.key} type="button" role="gridcell" aria-label={label} aria-selected={isSel || undefined}
                  className={`m-cal-day${d.inMonth ? '' : ' is-out'}${isToday ? ' is-today' : ''}${isSel ? ' is-selected' : ''}`}
                  onClick={() => { void haptic.selection(); onPick(d.date) }}>
                  <span className="m-cal-num">{d.date.getDate()}</span>
                  <span className={`m-cal-dot${hasNote ? ' is-on' : ''}`} aria-hidden />
                </button>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}
