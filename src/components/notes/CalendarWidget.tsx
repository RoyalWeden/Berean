import { useRef, useEffect } from 'react'
import { ChevronLeft, ChevronRight, Undo2 } from 'lucide-react'
import type { Note } from '@/types'

export function toDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

/** Resolve the existing daily/journal note for a given date, if any — same title-parsing
 *  logic CalendarGrid uses to populate its note-dot indicators, exposed so callers (e.g. a
 *  right-click "Delete note" action) can look up the actual Note without re-deriving it. */
export function findDailyNote(notes: Note[], date: Date): Note | undefined {
  const key = toDateKey(date)
  return notes.find(n => {
    const isDaily = n.type === 'daily' || n.type === 'journal' ||
      (n.type === 'general' && !!(n.title?.startsWith('Daily — ') || n.title?.startsWith('Journal — ')))
    if (!isDaily) return false
    const raw = n.title ?? ''
    const dateStr = raw.replace(/^(Daily|Journal) — /, '')
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr === key
    try {
      const d = new Date(dateStr)
      return !isNaN(d.getTime()) && toDateKey(d) === key
    } catch { return false }
  })
}

interface CalendarGridProps {
  date: Date
  notes: Note[]
  onDateChange: (d: Date) => void
  onSelectDate: (d: Date) => void
  /** Slightly smaller type/spacing for the sidebar's inline, narrower placement. */
  compact?: boolean
  /** Date to highlight distinctly from "today" — e.g. the currently active daily note. */
  selectedDate?: Date | null
  /** Right-click a day cell — caller owns the actual menu (open/open-in-new-tab/
   *  open-floating/delete), since those actions need note-opening plumbing this
   *  presentational grid doesn't have. */
  onContextMenu?: (date: Date, x: number, y: number) => void
}

/**
 * The actual month grid — month nav, day headers, day cells (a small dot
 * under days with a daily note, matching the app-wide verse-note indicator),
 * and a "Today" shortcut. No positioning/outside-click behavior of its own,
 * so it can be dropped inline (the sidebar's collapsible Daily Notes
 * section) or wrapped in a floating popover (CalendarWidget below,
 * NotesPanel's header calendar button) without duplicating the date math.
 */
export function CalendarGrid({ date, notes, onDateChange, onSelectDate, compact, selectedDate, onContextMenu }: CalendarGridProps) {
  const year = date.getFullYear()
  const month = date.getMonth()
  const today = new Date()
  const todayStr = toDateKey(today)
  const selectedStr = selectedDate ? toDateKey(selectedDate) : null
  const isCurrentMonth = year === today.getFullYear() && month === today.getMonth()

  // Days with daily notes — handle both new ISO format (Daily — 2024-01-01)
  // and old localised format (Daily — January 1, 2024 / Journal — ...)
  const dailyDates = new Set(
    notes
      .filter(n =>
        n.type === 'daily' || n.type === 'journal' ||
        (n.type === 'general' && !!(n.title?.startsWith('Daily — ') || n.title?.startsWith('Journal — ')))
      )
      .map(n => {
        const raw = n.title ?? ''
        const dateStr = raw.replace(/^(Daily|Journal) — /, '')
        // New format: already ISO yyyy-mm-dd
        if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr
        // Old locale format: try to parse
        try {
          const d = new Date(dateStr)
          if (!isNaN(d.getTime())) {
            return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
          }
        } catch { /* ignore */ }
        return ''
      })
      .filter(Boolean)
  )

  // First day of month and number of days
  const firstDay = new Date(year, month, 1).getDay() // 0=Sun
  const daysInMonth = new Date(year, month + 1, 0).getDate()

  function prevMonth() {
    onDateChange(new Date(year, month - 1, 1))
  }
  function nextMonth() {
    onDateChange(new Date(year, month + 1, 1))
  }

  const monthLabel = date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
  const dayCellText = compact ? 'text-[10px]' : 'text-[11px]'

  return (
    <div>
      {/* Month navigation — icon-only, color-only hover (no button-chrome box) so the nav
          arrows sit flush and low-contrast like a native mini-calendar's, not a discrete
          toolbar control. */}
      <div className="flex items-center gap-2 mb-2">
        <button onClick={prevMonth} className="p-0.5 text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-text-primary))] transition-colors cursor-pointer">
          <ChevronLeft size={14} />
        </button>
        <span className="flex-1 text-center text-xs font-medium text-[rgb(var(--color-text-primary))]">{monthLabel}</span>
        {!isCurrentMonth && (
          <button
            onClick={() => onDateChange(new Date())}
            title="Jump to current month"
            className="p-0.5 text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-text-primary))] transition-colors cursor-pointer"
          >
            <Undo2 size={12} />
          </button>
        )}
        <button onClick={nextMonth} className="p-0.5 text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-text-primary))] transition-colors cursor-pointer">
          <ChevronRight size={14} />
        </button>
      </div>
      {/* Day headers */}
      <div className="grid grid-cols-7 mb-1">
        {['Su','Mo','Tu','We','Th','Fr','Sa'].map(d => (
          <div key={d} className="text-center text-[9px] text-[rgb(var(--color-text-muted))] font-medium py-0.5">{d}</div>
        ))}
      </div>
      {/* Day cells — each cell is a column (number + note-dot slot below it, naturally a
          rectangle), but the today/selected highlight lives on a small fixed-size CIRCLE around
          just the digit, matching how macOS's own mini-calendar marks dates, rather than a
          rounded-rect chip stretched across the whole (non-square) cell. Today gets a solid
          filled circle (the same bg-accent + text-white treatment used for the equivalent
          "selected day" state in BookChapterPicker.tsx's own date grid) so it reads as
          unambiguously "the true today" — selected is deliberately lighter (a ring only, no
          fill, no bold) so it doesn't compete with today for visual weight. */}
      <div className="grid grid-cols-7 gap-0.5">
        {Array.from({ length: firstDay }).map((_, i) => <div key={`e${i}`} />)}
        {Array.from({ length: daysInMonth }).map((_, i) => {
          const day = i + 1
          const dateKey = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
          const isToday = dateKey === todayStr
          const isSelected = !isToday && dateKey === selectedStr
          const hasNote = dailyDates.has(dateKey)
          const circleSize = compact ? 'w-[20px] h-[20px]' : 'w-6 h-6'
          return (
            <button
              key={day}
              onClick={() => onSelectDate(new Date(year, month, day))}
              onContextMenu={onContextMenu ? (e) => { e.preventDefault(); onContextMenu(new Date(year, month, day), e.clientX, e.clientY) } : undefined}
              className="flex flex-col items-center justify-center gap-0.5 cursor-pointer group"
            >
              <span className={`flex items-center justify-center ${circleSize} ${dayCellText} rounded-full leading-none transition-colors
                ${isToday ? 'bg-[rgb(var(--color-accent))] text-white font-semibold'
                  : isSelected ? 'text-[rgb(var(--color-text-primary))] ring-1 ring-inset ring-[rgb(var(--color-text-muted))]/40'
                  : 'text-[rgb(var(--color-text-secondary))] group-hover:bg-[rgb(var(--color-surface-4))]'}`}
              >
                {day}
              </span>
              {/* Reserved-height row below the circle (not absolutely positioned/overlapping)
                  so the indicator can never be clipped by a neighboring row or an ancestor's
                  overflow. */}
              <span className="h-[5px] flex items-center justify-center leading-none">
                {hasNote && <span className="w-[4px] h-[4px] rounded-full bg-[rgb(var(--color-accent))]" />}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

interface CalendarWidgetProps {
  date: Date
  notes: Note[]
  anchor: { left: number; top: number }
  onDateChange: (d: Date) => void
  onSelectDate: (d: Date) => void
  onClose: () => void
}

/**
 * Floating popover wrapper around CalendarGrid — used by NotesPanel's own
 * header calendar button, portaled at a computed fixed anchor (TopBar's
 * overflow-hidden slot clips an absolutely-positioned popover here).
 */
export default function CalendarWidget({ date, notes, anchor, onDateChange, onSelectDate, onClose }: CalendarWidgetProps) {
  // Close on outside click — skip if the click was on the calendar toggle button itself
  // (the button carries data-calendar-toggle so we don't fight its own toggle handler)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    function handle(e: MouseEvent) {
      const target = e.target as HTMLElement
      if (target.closest('[data-calendar-toggle]')) return
      if (ref.current && !ref.current.contains(target)) onClose()
    }
    window.addEventListener('mousedown', handle, true)
    return () => window.removeEventListener('mousedown', handle, true)
  }, [onClose])

  return (
    <div
      ref={ref}
      style={{ position: 'fixed', left: anchor.left, top: anchor.top, transform: 'translateX(-100%)', zIndex: 9999 }}
      className="glass-panel-modal rounded-shell-lg p-3 w-64"
    >
      <CalendarGrid date={date} notes={notes} onDateChange={onDateChange} onSelectDate={onSelectDate} />
    </div>
  )
}
