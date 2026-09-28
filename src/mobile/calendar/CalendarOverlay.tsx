import React, { useCallback, useState } from 'react'
import { dailyNoteToday } from '@/lib/dailyNoteUtils'
import { openDailyNoteInCurrentTab } from '@/lib/dailyNotes'
import { useSheets, type SheetApi } from '../primitives/Sheet'
import { CalendarView } from './CalendarView'

function OverlayBody({ api }: { api: SheetApi }) {
  const today = dailyNoteToday()
  const [month, setMonth] = useState(new Date(today.getFullYear(), today.getMonth(), 1))
  return (
    <CalendarView month={month} onMonth={setMonth} onPick={(date) => { api.close(); void openDailyNoteInCurrentTab(date) }} />
  )
}

/**
 * The CONTEXTUAL calendar (SEP27-CAL-004): a sheet over the current tab — from the top-left
 * switcher's Calendar and from a long press on any Calendar / Today control. It is not a tab and
 * records no history: dismissing it leaves the current tab exactly as it was; choosing a day opens
 * that day's daily note in the current tab (a normal, back-able navigation). The persistent
 * Calendar experience is the Calendar TAB (CalendarTabPage) — same CalendarView, same date index.
 */
export function useCalendarOverlay(): () => void {
  const sheets = useSheets()
  return useCallback(() => {
    sheets.open({ id: 'calendar', title: 'Calendar', detents: [0.62, 0.92], initialDetent: 0, render: (api) => <OverlayBody api={api} /> })
  }, [sheets])
}
