import { useEffect, useMemo, useState } from 'react'
import type { CalendarTabState, Note } from '@/types'
import { useAppStore } from '@/store'
import { dailyNoteToday, toDateKey } from '@/lib/dailyNoteUtils'
import { monthFromKey, monthKeyOf } from '@/lib/calendarModel'
import { openDailyNoteInCurrentTab } from '@/lib/dailyNotes'
import { CalendarGrid } from './CalendarWidget'

/**
 * Desktop view of a Calendar TAB (SEP27-CAL-005) — the persistent Calendar experience is created on
 * the iPhone but tab state syncs, so the Mac shows it with its own month grid (CalendarGrid, the
 * sidebar calendar's grid) fed from the same daily-note date index. Choosing a day opens that day's
 * daily note in this tab, exactly as on the phone.
 */
export default function CalendarTabPanel({ tabId }: { tabId: string }) {
  const state = useAppStore((s) => (s.tabs.notes.find((t) => t.id === tabId)?.state ?? {}) as CalendarTabState)
  const token = useAppStore((s) => s.noteChangeToken)
  const [dates, setDates] = useState<Array<{ dateKey: string; noteId: string; length: number }>>([])
  useEffect(() => { window.notes.getDailyDates?.().then(setDates).catch(() => setDates([])) }, [token])
  // CalendarGrid reads daily notes by title / length — give it that much, not whole notes.
  const notes = useMemo(() => dates.map((d) => ({ id: d.noteId, type: 'daily', title: `Daily — ${d.dateKey}`, content: 'x'.repeat(Math.min(d.length, 4000)) }) as unknown as Note), [dates])
  const month = monthFromKey(state.month, dailyNoteToday())
  const selected = state.selected ? new Date(Number(state.selected.slice(0, 4)), Number(state.selected.slice(5, 7)) - 1, Number(state.selected.slice(8, 10))) : null
  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-md mx-auto">
        <CalendarGrid
          date={month}
          notes={notes}
          selectedDate={selected}
          onDateChange={(d) => useAppStore.getState().updateTabState('notes', tabId, { month: monthKeyOf(d) })}
          onSelectDate={(d) => { useAppStore.getState().updateTabState('notes', tabId, { selected: toDateKey(d), month: monthKeyOf(d) }); void openDailyNoteInCurrentTab(d) }}
        />
      </div>
    </div>
  )
}
