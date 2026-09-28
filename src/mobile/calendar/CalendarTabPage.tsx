import React from 'react'
import { CalendarCheck } from 'lucide-react'
import type { CalendarTabState, Tab } from '@/types'
import { useAppStore } from '@/store'
import { dailyNoteToday, toDateKey } from '@/lib/dailyNoteUtils'
import { monthFromKey, monthKeyOf, monthLabel } from '@/lib/calendarModel'
import { openDailyNoteInCurrentTab } from '@/lib/dailyNotes'
import { Page, IconTap } from '../primitives/Page'
import { useCaretCommands } from '../commands/caretRegistry'
import { CalendarView } from './CalendarView'

/** A Calendar tab month is a destination of the tab's history (like a chapter). */
function recordMonth(tabId: string, from: string | undefined, to: string) {
  const s = useAppStore.getState()
  if (s.isNavJumping) return
  const step = (m: string) => ({ type: 'calendar' as const, title: `Calendar · ${monthLabel(monthFromKey(m))}`, state: { month: m } })
  if (!s.tabNavStacks[tabId]?.stack.length && from) s.pushTabNav(tabId, step(from))
  s.pushTabNav(tabId, step(to))
}

/**
 * The persistent Calendar experience (SEP27-CAL-005): a real tab (Notes space) whose month and
 * last-chosen day are tab state — kept when you leave and return, copied by Duplicate, synced like
 * other tab state, and each month shown is a step of the tab's history. Choosing a day opens that
 * day's daily note IN THIS TAB (‹ comes back to the calendar on the same month). Transient
 * presentation (sheets, scroll) is never stored.
 */
export function CalendarTabPage({ tab }: { tab: Tab }) {
  const st = (tab.state ?? {}) as CalendarTabState
  const month = monthFromKey(st.month, dailyNoteToday())
  const setMonth = (m: Date) => {
    const key = monthKeyOf(m)
    if (key === st.month) return
    recordMonth(tab.id, st.month ?? monthKeyOf(dailyNoteToday()), key)
    useAppStore.getState().updateTabState('notes', tab.id, { month: key })
  }
  const pick = (date: Date) => {
    useAppStore.getState().updateTabState('notes', tab.id, { selected: toDateKey(date), month: monthKeyOf(date) })
    void openDailyNoteInCurrentTab(date)
  }
  useCaretCommands(() => ({
    title: 'Calendar', subtitle: monthLabel(month),
    sections: [{ id: 'cal', style: 'tiles', commands: [
      { kind: 'action', id: 'today', label: "Today's note", icon: CalendarCheck, run: () => pick(dailyNoteToday()) },
    ] }],
  }))
  return (
    <Page title="Calendar" right={<IconTap icon={CalendarCheck} label="Open today's daily note" onClick={() => pick(dailyNoteToday())} />}>
      <CalendarView month={month} onMonth={setMonth} selectedKey={st.selected ?? null} onPick={pick} />
    </Page>
  )
}
