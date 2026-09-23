import { useRef, useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, Undo2, Minimize2, Maximize2 } from 'lucide-react'
import type { Note } from '@/types'
import { useAppStore } from '@/store'
import { zoomedFontSize } from '@/lib/zoom'
import { toDateKey, dailyNoteToday } from '@/lib/dailyNoteUtils'
import { IconButton, Tooltip, ControlGroup, Popover, PopoverTrigger, PopoverSurface } from '@/components/ui'
import { useRovingGridNav } from '@/lib/useRovingNav'

export { toDateKey }

const MONTH_ABBRS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * TEST-011 — clicking the "Month Year" label opens this: a year stepper (‹ year › — cheap to
 * click through several years at a time, no need for a long scrollable list for a typical
 * study-note calendar's range) plus a 3×4 month grid, and a Today shortcut. Picking a month
 * calls `onPick` (which both sets the calendar and closes the popover, via Radix's own
 * PopoverClose-on-select-below). `pickerYear` is local, separate from the calendar's own
 * `date` — browsing years in the picker shouldn't move the calendar until a month is actually
 * chosen; it re-seeds from `date` every time the popover mounts (Radix unmounts content when
 * closed by default), so reopening always starts back at the calendar's current year.
 */
/** First year of the 12-year page that contains `year` (2016–2027 for 2026, …). */
export function yearPageStart(year: number): number { return year - (((year % 12) + 12) % 12) }

function MonthYearPicker({ date, onPick }: { date: Date; onPick: (d: Date) => void }) {
  const [pickerYear, setPickerYear] = useState(date.getFullYear())
  // Clicking the year switches the grid to 12 years at a time (‹ › then page by 12), so long
  // jumps are two taps instead of one tap per year (TEST-011).
  const [mode, setMode] = useState<'months' | 'years'>('months')
  const today = dailyNoteToday()
  const pageStart = yearPageStart(pickerYear)
  const step = mode === 'years' ? 12 : 1
  const cell = (selected: boolean, current: boolean) => `focus-ring h-8 rounded-compact text-footnote font-medium transition-colors duration-fast tabular-nums
                ${selected ? 'bg-accent text-white'
                  : current ? 'text-text-primary ring-1 ring-inset ring-accent hover:bg-lift-2'
                  : 'text-text-secondary hover:bg-lift-2'}`
  return (
    <div className="p-2 w-56">
      <div className="flex items-center justify-between mb-2">
        <IconButton icon={ChevronLeft} label={mode === 'years' ? 'Previous 12 years' : 'Previous year'} size={24} onClick={() => setPickerYear((y) => y - step)} />
        <button
          type="button"
          onClick={() => setMode((m) => (m === 'months' ? 'years' : 'months'))}
          aria-label={mode === 'months' ? `${pickerYear}, choose a year` : 'Back to months'}
          className="focus-ring text-subhead font-semibold text-text-primary tabular-nums px-2 py-0.5 rounded-compact hover:bg-lift-2"
        >
          {mode === 'months' ? pickerYear : `${pageStart}–${pageStart + 11}`}
        </button>
        <IconButton icon={ChevronRight} label={mode === 'years' ? 'Next 12 years' : 'Next year'} size={24} onClick={() => setPickerYear((y) => y + step)} />
      </div>
      {mode === 'months' ? (
        <div role="grid" aria-label="Month" className="grid grid-cols-3 gap-1">
          {MONTH_ABBRS.map((label, i) => {
            const isSelected = pickerYear === date.getFullYear() && i === date.getMonth()
            const isCurrent = pickerYear === today.getFullYear() && i === today.getMonth()
            return (
              <button key={label} type="button" role="gridcell" aria-selected={isSelected || undefined}
                onClick={() => onPick(new Date(pickerYear, i, 1))} className={cell(isSelected, isCurrent)}>
                {label}
              </button>
            )
          })}
        </div>
      ) : (
        <div role="grid" aria-label="Year" className="grid grid-cols-3 gap-1">
          {Array.from({ length: 12 }, (_, i) => pageStart + i).map((y) => (
            <button key={y} type="button" role="gridcell" aria-selected={y === pickerYear || undefined}
              onClick={() => { setPickerYear(y); setMode('months') }} className={cell(y === pickerYear, y === today.getFullYear())}>
              {y}
            </button>
          ))}
        </div>
      )}
      <div className="mt-2 pt-2 border-t border-separator flex justify-center">
        <button
          type="button"
          onClick={() => onPick(new Date())}
          className="focus-ring text-caption1 font-medium text-accent hover:brightness-110 px-2 py-1 rounded-compact"
        >
          Today
        </button>
      </div>
    </div>
  )
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
  const gridRovingNav = useRovingGridNav(7)

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

  // TEST-011: the month/year LABEL opens the jump-to-month/year popover — only meaningful in
  // month view (week view shows a date-span label, not a single month, so no picker there).
  const [pickerOpen, setPickerOpen] = useState(false)
  function pickMonth(d: Date) {
    onDateChange(d)
    setPickerOpen(false)
  }

  return (
    <div>
      {/* Month navigation — icon-only, color-only hover (no button-chrome box) so the nav
          arrows sit flush and low-contrast like a native mini-calendar's, not a discrete
          toolbar control. */}
      {/* Back to gap-1/p-0.5 — the earlier scrunch (gap-0.5/p-px) always cramped the icons
          together even when the row had plenty of room to spare. The month-name span (below)
          already truncates on its own when the row is genuinely tight, so the icons don't need
          to sacrifice their own comfortable spacing to make room preemptively — only text
          should give, and only when it actually has to. */}
      <div className="flex items-center gap-1 mb-1">
        {/* Month-navigation cluster (‹ label › [jump-to-current] [week-toggle]) — all grouped
            together and left-aligned, not spread across the row. Today is the one thing pushed
            to the far right (via the flex-1 spacer after this cluster, not within it). The
            chevron-label-chevron trio is ONE grouped toolbar control (macOS-style ‹ Title ›);
            jump-to-current and the week-toggle are separate one-off actions, not part of that
            grouped control, so they stay as their own icon buttons alongside it. */}
        <ControlGroup className="min-w-0 flex-shrink">
          <IconButton
            icon={ChevronLeft}
            label={weekOnly ? 'Previous week' : 'Previous month'}
            size={24}
            onClick={weekOnly ? prevWeek : prevMonth}
          />
          {/* min-w-0 so this is actually allowed to shrink in a flex row — the extra collapse
              button pushed this row tighter than month view ever had to fit in, so the label
              could wrap onto a second line. Month name and year render as two separate spans so
              truncation (ellipsis) only ever eats into the MONTH NAME; the year has its own
              flex-shrink-0 and is never clipped. The week-spanning-months label ("Aug 30 – Sep 5")
              has no year to protect the same way, so it stays one plain truncatable span. */}
          {crossMonthLabel || weekOnly ? (
            // Week view: the label is a date span (or, when the week doesn't cross a month
            // boundary, just plain text) — not a single month, so no month/year picker here.
            <span className="px-1.5 font-semibold whitespace-nowrap overflow-hidden text-ellipsis min-w-0 text-subhead text-text-primary" style={{ fontSize: monthLabelSize }}>{crossMonthLabel ?? `${monthName} ${yearStr}`}</span>
          ) : (
            <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  aria-label={`${monthName} ${yearStr} — jump to month or year`}
                  aria-haspopup="dialog"
                  className="focus-ring flex items-baseline gap-1 min-w-0 px-1.5 rounded-compact hover:bg-lift-2 transition-colors duration-fast"
                >
                  <span className="font-semibold whitespace-nowrap overflow-hidden text-ellipsis min-w-0 text-subhead text-text-primary" style={{ fontSize: monthLabelSize }}>{monthName}</span>
                  <span className="font-semibold whitespace-nowrap flex-shrink-0 text-subhead text-text-muted" style={{ fontSize: monthLabelSize }}>{yearStr}</span>
                </button>
              </PopoverTrigger>
              <PopoverSurface align="start">
                <MonthYearPicker date={date} onPick={pickMonth} />
              </PopoverSurface>
            </Popover>
          )}
          <IconButton
            icon={ChevronRight}
            label={weekOnly ? 'Next week' : 'Next month'}
            size={24}
            onClick={weekOnly ? nextWeek : nextMonth}
          />
        </ControlGroup>
        {!(weekOnly ? weekIsCurrent : isCurrentMonth) && (
          <IconButton
            icon={Undo2}
            label={weekOnly ? 'Jump to current week' : 'Jump to current month'}
            size={24}
            onClick={() => (weekOnly ? setWeekAnchor(new Date()) : onDateChange(new Date()))}
          />
        )}
        {/* Collapse to just the current week (or expand back to the full month) — per direct
            feedback. weekAnchor resets to today each time it's turned ON, so re-collapsing
            always starts from "this week," not wherever a previous week nav left off. */}
        <IconButton
          icon={weekOnly ? Maximize2 : Minimize2}
          label={weekOnly ? 'Show full month' : 'Collapse to this week'}
          size={24}
          onClick={() => { if (!weekOnly) setWeekAnchor(new Date()); setWeekOnly((v) => !v) }}
        />
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
          <div key={d} className={`text-center ${weekdayHeaderPad} text-meta font-medium`} style={{ fontSize: weekdayHeaderSize }}>{d}</div>
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
          // §7.5: selected (the daily note actually open) gets the accent fill — the stronger,
          // "you are here" signal; today gets a ring — a lighter marker that stays visible even
          // when today IS the selected date (the common case: opening today's own daily note),
          // where the fill wins and the ring is redundant with it.
          const isSelected = dateKey === selectedStr
          const noteLength = dailyNoteLength.get(dateKey) ?? 0
          const hasNote = noteLength > 0
          // Heatmap alpha: scales with content length, capped so a single huge entry doesn't
          // max out and flatten the gradient for everything shorter than it.
          const heatAlpha = hasNote ? Math.min(0.85, 0.16 + Math.min(noteLength / 1500, 1) * 0.5) : 0
          // Fixed 22×22 regardless of `compact` — the two sizes had drifted apart for no real
          // reason (compact already used 22px); unifying means one fewer thing zoom/heatmap
          // math has to account for.
          const squareSize = 'w-[22px] h-[22px]'
          return (
            <div
              key={dateKey}
              className={band ? `bg-accent-muted ${colIdx === 0 ? 'rounded-l-control' : colIdx === 6 ? 'rounded-r-control' : ''}` : ''}
            >
              <Tooltip
                delay={400}
                side="top"
                label={`${cellDate.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })} Daily Note`}
              >
                {/* Bespoke — no design-system primitive covers a 22×22 heat-mapped grid cell
                    (IconButton requires an icon; ListRow is a full-width row). Kept as a raw
                    <button>, brought up to the same state contract as the primitives: focus-ring,
                    active:scale, and the shared lift tokens for hover/pressed. */}
                <button
                  role="gridcell"
                  aria-selected={isSelected || undefined}
                  onClick={() => onSelectDate(cellDate)}
                  onContextMenu={onContextMenu ? (e) => { e.preventDefault(); onContextMenu(cellDate, e.clientX, e.clientY) } : undefined}
                  className="focus-ring flex items-center justify-center w-full py-px cursor-pointer group active:scale-[0.98] transition-transform duration-fast"
                >
                  <span
                    className={`flex items-center justify-center ${squareSize} rounded-compact leading-none transition-[filter,background-color] duration-150
                      ${isSelected ? 'bg-accent text-white font-semibold group-hover:brightness-125'
                        : isToday ? 'text-text-primary font-semibold ring-1 ring-inset ring-accent group-hover:bg-lift-2 group-active:bg-lift-3'
                        : 'text-text-secondary font-medium group-hover:bg-lift-2 group-active:bg-lift-3'}`}
                    style={{
                      fontSize: dayCellSize,
                      ...(hasNote && !isSelected ? { background: `rgb(var(--color-accent) / ${heatAlpha})`, color: 'rgb(var(--color-text-primary))' } : {}),
                    }}
                  >
                    {cellDate.getDate()}
                  </span>
                </button>
              </Tooltip>
            </div>
          )
        }
        return (
          <div role="grid" className={`grid grid-cols-7 ${gridGap}`} onKeyDown={gridRovingNav}>
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
      style={{ position: 'fixed', left: anchor.left, top: anchor.top, transform: 'translateX(-100%)', zIndex: 'var(--z-menu)' } as React.CSSProperties}
      className="material-popover rounded-menu p-3 w-64"
    >
      <CalendarGrid date={date} notes={notes} onDateChange={onDateChange} onSelectDate={onSelectDate} />
    </div>
  )
}
