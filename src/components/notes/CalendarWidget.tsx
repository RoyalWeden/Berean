import { useRef, useEffect, useState } from 'react'
import * as Tooltip from '@radix-ui/react-tooltip'
import { ChevronLeft, ChevronRight, Undo2, Minimize2, Maximize2 } from 'lucide-react'
import type { Note } from '@/types'
import { useAppStore } from '@/store'
import { zoomedFontSize } from '@/lib/zoom'
import { toDateKey, dailyNoteToday } from '@/lib/dailyNoteUtils'

export { toDateKey }

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
  /** Rendered in the month-nav row, right after the month label — e.g. Sidebar.tsx's
   *  "Today" shortcut (open today's daily note), which used to live in its own separate
   *  header row above this whole grid. Optional: other callers (CalendarWidget's floating
   *  date-picker popover) don't have an equivalent action to offer here. */
  todayAction?: React.ReactNode
}

/**
 * The actual month grid — month nav, day headers, day cells (a small dot
 * under days with a daily note, matching the app-wide verse-note indicator),
 * and a "Today" shortcut. No positioning/outside-click behavior of its own,
 * so it can be dropped inline (the sidebar's collapsible Daily Notes
 * section) or wrapped in a floating popover (CalendarWidget below,
 * NotesPanel's header calendar button) without duplicating the date math.
 */
export function CalendarGrid({ date, notes, onDateChange, onSelectDate, compact, selectedDate, onContextMenu, todayAction }: CalendarGridProps) {
  const year = date.getFullYear()
  const month = date.getMonth()
  // Days begin at dawn, not midnight — see dailyNoteUtils.ts's getDailyNoteAnchorDate.
  const today = dailyNoteToday()
  const todayStr = toDateKey(today)
  const selectedStr = selectedDate ? toDateKey(selectedDate) : null
  const isCurrentMonth = year === today.getFullYear() && month === today.getMonth()

  // Collapse to just one week — per direct feedback ("a collapse button that will collapse to
  // just the week... spanning across two months if needed, showing the numbers correctly").
  // Self-contained: `date`/onDateChange stay owned by the caller for MONTH nav; weekAnchor is
  // this component's own state for WEEK nav, so toggling back to month view lands exactly where
  // month nav was left, not wherever the last week happened to be.
  const [weekOnly, setWeekOnly] = useState(false)
  const [weekAnchor, setWeekAnchor] = useState<Date>(() => new Date())

  // Days with daily notes, keyed to how much is actually written that day (content length) —
  // handles both new ISO format (Daily — 2024-01-01) and old localised format
  // (Daily — January 1, 2024 / Journal — ...). The length feeds the heatmap fill below instead
  // of a plain dot: "every day's own square darkens with how much you wrote that day."
  const dailyNoteLength = new Map<string, number>()
  for (const n of notes) {
    const isDaily = n.type === 'daily' || n.type === 'journal' ||
      (n.type === 'general' && !!(n.title?.startsWith('Daily — ') || n.title?.startsWith('Journal — ')))
    if (!isDaily) continue
    const raw = n.title ?? ''
    const dateStr = raw.replace(/^(Daily|Journal) — /, '')
    let key = ''
    // New format: already ISO yyyy-mm-dd
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) key = dateStr
    else {
      try {
        const d = new Date(dateStr)
        if (!isNaN(d.getTime())) key = toDateKey(d)
      } catch { /* ignore */ }
    }
    if (!key) continue
    const len = (n.content ?? '').length
    dailyNoteLength.set(key, Math.max(dailyNoteLength.get(key) ?? 0, len))
  }

  // First day of month and number of days
  const firstDay = new Date(year, month, 1).getDay() // 0=Sun
  const daysInMonth = new Date(year, month + 1, 0).getDate()

  function prevMonth() {
    onDateChange(new Date(year, month - 1, 1))
  }
  function nextMonth() {
    onDateChange(new Date(year, month + 1, 1))
  }

  // The 7 real dates of weekAnchor's own week (Sun-Sat). The Date constructor normalizes an
  // out-of-range day (e.g. day 32) into the next month on its own, so this naturally spans a
  // month boundary with correct numbers on both sides — no special-casing needed.
  const weekStart = new Date(weekAnchor.getFullYear(), weekAnchor.getMonth(), weekAnchor.getDate() - weekAnchor.getDay())
  const weekDates = Array.from({ length: 7 }, (_, i) => new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + i))
  function prevWeek() {
    setWeekAnchor(new Date(weekAnchor.getFullYear(), weekAnchor.getMonth(), weekAnchor.getDate() - 7))
  }
  function nextWeek() {
    setWeekAnchor(new Date(weekAnchor.getFullYear(), weekAnchor.getMonth(), weekAnchor.getDate() + 7))
  }
  const weekIsCurrent = weekDates.some((d) => toDateKey(d) === todayStr)

  // In week view, the label reflects the actual span shown — "Aug 30 – Sep 5" when the week
  // crosses a month boundary, or just "September 2026" when it doesn't (matches month view's
  // own label exactly in that common case, so the nav row doesn't visually jump for no reason).
  const weekSpansMonths = weekDates[0].getMonth() !== weekDates[6].getMonth()
  const crossMonthLabel = weekOnly && weekSpansMonths
    ? `${weekDates[0].toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${weekDates[6].toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
    : null
  // Split into month name + year so a too-narrow row truncates ONLY the month name — per direct
  // feedback, truncating the combined "September 2026" string clipped the YEAR first (ellipsis
  // trims from the end), which is exactly backwards; the year is the more load-bearing half.
  const labelBaseDate = weekOnly ? weekDates[0] : date
  const monthName = labelBaseDate.toLocaleDateString(undefined, { month: 'long' })
  const yearStr = String(labelBaseDate.getFullYear())
  // Sidebar/rail layout (cell sizes, grid gaps, circle/dot dimensions) stays fixed regardless
  // of app zoom — only the text itself scales, via the same zoomedFontSize() used for Bible
  // text, so zooming in makes the calendar legible without resizing the sidebar around it.
  const appZoom = useAppStore((s) => s.appZoom)
  // Bumped slightly (10→10.5, 9→9.5, 8→8.5) alongside the rest of the recent calendar/session
  // styling pass elsewhere in the app — this sidebar widget was the one spot that pass never
  // reached, per direct feedback asking for the same visual refresh here too.
  // Bigger again this round (day numbers: compact 9.5→13, non-compact 11→15) — with the whole
  // grid brought CLOSER together to compensate (tighter margins/gaps below), so the bigger
  // numbers don't grow the widget's own footprint.
  // Month label bumped (10.5→12.5/12→14), then eased back down slightly (→11.5/13) per direct
  // feedback that 12.5 read as a touch too big.
  const monthLabelSize = zoomedFontSize(compact ? 11.5 : 13, appZoom)
  const dayCellSize = zoomedFontSize(compact ? 13 : 15, appZoom)
  const weekdayHeaderSize = zoomedFontSize(compact ? 8.5 : 9, appZoom)
  const weekdayHeaderPad = 'py-0'
  const gridGap = 'gap-y-[2px]'

  // Which cells fall in the week containing TODAY (only meaningful when looking at the current
  // month) — gets a soft full-row accent band per direct feedback ("week band + heatmap,
  // combined"), independent of the heatmap fill on the numbers themselves.
  const todayDow = today.getDay()
  const currentWeekStart = isCurrentMonth ? today.getDate() - todayDow : null

  return (
    <div>
      {/* Month navigation — icon-only, color-only hover (no button-chrome box) so the nav
          arrows sit flush and low-contrast like a native mini-calendar's, not a discrete
          toolbar control. */}
      {/* gap-1 (was gap-2) — per direct feedback, the arrow buttons should sit closer to the
          month label between them rather than floating at arm's length from it. */}
      <div className="flex items-center gap-1 mb-1">
        {/* Month-navigation cluster (< label [jump-to-current] >) — all grouped together
            and left-aligned, not spread across the row. Today is the one thing pushed to
            the far right (via the flex-1 spacer after this cluster, not within it). */}
        {/* Nav arrows/jump-to-current now warm to the ACCENT color on hover (was plain
            muted→primary) — matches the warmer, accent-tinted hover treatment the recent Study
            Trail styling pass gave its own icon buttons, rather than everything staying in flat
            greyscale until clicked. */}
        <button onClick={weekOnly ? prevWeek : prevMonth} className="p-0.5 flex-shrink-0 text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-accent))] transition-colors duration-150 cursor-pointer">
          <ChevronLeft size={compact ? 15 : 17} />
        </button>
        {/* min-w-0 so this is actually allowed to shrink in a flex row — the extra collapse
            button pushed this row tighter than month view ever had to fit in, so the label
            could wrap onto a second line. Month name and year render as two separate spans so
            truncation (ellipsis) only ever eats into the MONTH NAME; the year has its own
            flex-shrink-0 and is never clipped. The week-spanning-months label ("Aug 30 – Sep 5")
            has no year to protect the same way, so it stays one plain truncatable span. */}
        {crossMonthLabel ? (
          <span className="font-medium whitespace-nowrap overflow-hidden text-ellipsis min-w-0 text-[rgb(var(--color-text-primary))]" style={{ fontSize: monthLabelSize }}>{crossMonthLabel}</span>
        ) : (
          <span className="flex items-baseline gap-1 min-w-0">
            <span className="font-medium whitespace-nowrap overflow-hidden text-ellipsis min-w-0 text-[rgb(var(--color-text-primary))]" style={{ fontSize: monthLabelSize }}>{monthName}</span>
            <span className="font-medium whitespace-nowrap flex-shrink-0 text-[rgb(var(--color-text-primary))]" style={{ fontSize: monthLabelSize }}>{yearStr}</span>
          </span>
        )}
        {!(weekOnly ? weekIsCurrent : isCurrentMonth) && (
          <button
            onClick={() => (weekOnly ? setWeekAnchor(new Date()) : onDateChange(new Date()))}
            title={weekOnly ? 'Jump to current week' : 'Jump to current month'}
            className="p-0.5 flex-shrink-0 text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-accent))] transition-colors duration-150 cursor-pointer"
          >
            <Undo2 size={compact ? 13 : 15} />
          </button>
        )}
        <button onClick={weekOnly ? nextWeek : nextMonth} className="p-0.5 flex-shrink-0 text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-accent))] transition-colors duration-150 cursor-pointer">
          <ChevronRight size={compact ? 15 : 17} />
        </button>
        {/* Collapse to just the current week (or expand back to the full month) — per direct
            feedback. weekAnchor resets to today each time it's turned ON, so re-collapsing
            always starts from "this week," not wherever a previous week nav left off. */}
        <button
          onClick={() => { if (!weekOnly) setWeekAnchor(new Date()); setWeekOnly((v) => !v) }}
          title={weekOnly ? 'Show full month' : 'Collapse to this week'}
          className="p-0.5 flex-shrink-0 text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-accent))] transition-colors duration-150 cursor-pointer"
        >
          {weekOnly ? <Maximize2 size={compact ? 12 : 14} /> : <Minimize2 size={compact ? 12 : 14} />}
        </button>
        <span className="flex-1" />
        {/* Today action sits after everything else in this row (per explicit direction:
            "needs to be on the right of everything else in that part of the calendar") —
            a separate, more consequential action (opens/creates a note) than the plain
            month-navigation controls to its left. */}
        {todayAction}
      </div>
      {/* Day headers */}
      <div className="grid grid-cols-7 mb-0.5">
        {['Su','Mo','Tu','We','Th','Fr','Sa'].map(d => (
          <div key={d} className={`text-center ${weekdayHeaderPad} text-[rgb(var(--color-text-muted))] font-medium`} style={{ fontSize: weekdayHeaderSize }}>{d}</div>
        ))}
      </div>
      {/* Day cells — week band + heatmap, combined (per direct feedback, continuing the picked
          direction rather than a fresh redesign): the week containing today gets a soft
          full-row accent band behind it (month view only — redundant once week view IS just
          that one row), and each day's own rounded-square fill darkens with how much was
          actually written that day (dailyNoteLength above) — replacing the old plain circle +
          a separate note-dot underneath, which is gone now that the fill itself carries that
          signal. Today still gets a solid accent fill (not heatmap-scaled) so it never reads as
          ambiguous with a heavily-written past day. Shared between month and week view via
          renderDayCell so the two don't duplicate this whole block. */}
      {(() => {
        function renderDayCell(cellDate: Date, colIdx: number, band: boolean) {
          const dateKey = toDateKey(cellDate)
          const isToday = dateKey === todayStr
          const isSelected = !isToday && dateKey === selectedStr
          const noteLength = dailyNoteLength.get(dateKey) ?? 0
          const hasNote = noteLength > 0
          // Heatmap alpha: scales with content length, capped so a single huge entry doesn't
          // max out and flatten the gradient for everything shorter than it.
          const heatAlpha = hasNote ? Math.min(0.85, 0.16 + Math.min(noteLength / 1500, 1) * 0.5) : 0
          const squareSize = compact ? 'w-[22px] h-[22px]' : 'w-7 h-7'
          return (
            <div
              key={dateKey}
              className={band ? 'bg-[rgb(var(--color-accent))]/[0.09]' : ''}
              style={band ? {
                borderRadius: colIdx === 0 ? '8px 0 0 8px' : colIdx === 6 ? '0 8px 8px 0' : 0,
              } : undefined}
            >
              <Tooltip.Root delayDuration={400}>
                <Tooltip.Trigger asChild>
                  <button
                    onClick={() => onSelectDate(cellDate)}
                    onContextMenu={onContextMenu ? (e) => { e.preventDefault(); onContextMenu(cellDate, e.clientX, e.clientY) } : undefined}
                    className="flex items-center justify-center w-full py-px cursor-pointer group"
                  >
                    {/* group-hover:scale-110 — a small tactile lift on hover, matching the more
                        "pleasurable to interact with" hover feedback the recent styling pass added
                        elsewhere (real focus/hover states instead of a flat color swap only). */}
                    <span
                      className={`flex items-center justify-center ${squareSize} rounded-lg leading-none transition-[filter,background-color,transform] duration-150 group-hover:scale-110
                        ${isToday ? 'bg-[rgb(var(--color-accent))] text-white font-semibold group-hover:brightness-125'
                          : isSelected ? 'text-[rgb(var(--color-text-primary))] ring-1 ring-inset ring-[rgb(var(--color-text-muted))]/40 group-hover:bg-[rgb(var(--color-surface-4))]/60'
                          : 'text-[rgb(var(--color-text-secondary))] font-medium group-hover:bg-[rgb(var(--color-surface-4))]'}`}
                      style={{
                        fontSize: dayCellSize,
                        ...(hasNote && !isToday ? { background: `rgb(var(--color-accent) / ${heatAlpha})`, color: 'rgb(var(--color-text-primary))' } : {}),
                      }}
                    >
                      {cellDate.getDate()}
                    </span>
                  </button>
                </Tooltip.Trigger>
                <Tooltip.Portal>
                  <Tooltip.Content side="top" sideOffset={6} className="z-50 px-2 py-1 rounded text-xs bg-[rgb(var(--color-surface-1))] border border-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-primary))] shadow-lg whitespace-nowrap">
                    {cellDate.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })} Daily Note
                    <Tooltip.Arrow className="fill-[rgb(var(--color-surface-4))]" />
                  </Tooltip.Content>
                </Tooltip.Portal>
              </Tooltip.Root>
            </div>
          )
        }
        return (
          <div className={`grid grid-cols-7 ${gridGap}`}>
            {weekOnly
              ? weekDates.map((d, i) => renderDayCell(d, i, false))
              : (
                <>
                  {Array.from({ length: firstDay }).map((_, i) => <div key={`e${i}`} />)}
                  {Array.from({ length: daysInMonth }).map((_, i) => {
                    const day = i + 1
                    const colIdx = (firstDay + i) % 7
                    const inCurrentWeek = currentWeekStart != null && day >= currentWeekStart && day < currentWeekStart + 7
                    return renderDayCell(new Date(year, month, day), colIdx, inCurrentWeek)
                  })}
                </>
              )}
          </div>
        )
      })()}
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
