import { useAppStore } from '@/store'
import { dailyNoteTitle, toDateKey } from './dailyNoteUtils'

/**
 * Daily-note destinations shared by every calendar and "Today" control (SEP27-CAL-003).
 *
 * A calendar is date NAVIGATION; the daily note is the DESTINATION — choosing a date always opens
 * that day's daily note (created on first open, the same find-or-create the desktop sidebar calendar
 * uses). The "day" is the daily-note day (dailyNoteUtils: it begins at sunrise), so the dates a
 * calendar shows and the notes it opens use one definition.
 */

/** Find (via the lightweight date index, then a title search) or create the daily note for `date`. */
export async function resolveDailyNoteId(date: Date): Promise<string | null> {
  const key = toDateKey(date)
  const title = dailyNoteTitle(date)
  try {
    const hit = (await window.notes.getDailyDates?.())?.find((d) => d.dateKey === key)
    if (hit) return hit.noteId
  } catch { /* fall through */ }
  try {
    const candidates = await window.notes.searchNotes(title, 5)
    const found = candidates.find((n) => n.title === title && n.type === 'daily')
    if (found) return found.id
  } catch { /* fall through to create */ }
  const result = await window.notes.createNote({ title, content: '', type: 'daily' })
  if (result.success && result.note) { useAppStore.getState().bumpNoteToken(); return result.note.id }
  return null
}

/**
 * Open the daily note for `date` in the CURRENT tab: a Notes tab shows it (a step of its history);
 * any other tab — Scripture, a Calendar tab, Search… — becomes that note through transformTab, so
 * ‹ returns to exactly where the user was (the Calendar tab comes back on its month).
 */
export async function openDailyNoteInCurrentTab(date: Date): Promise<string | null> {
  const noteId = await resolveDailyNoteId(date)
  if (!noteId) return null
  const s = useAppStore.getState()
  const space = s.activeSpace
  const tabId = s.activeTabId[space]
  const tab = tabId ? s.tabs[space]?.find((t) => t.id === tabId) : undefined
  if (tab && tab.type !== 'note') {
    // The type change itself records the note as this tab's new step (store typeChangeEntryFor) —
    // only ask the Notes space to show it, without a second history step.
    s.transformTab(tab.id, 'note', { state: { noteId, isNew: false } })
    useAppStore.setState({ pendingNoteId: noteId })
    return noteId
  }
  if (!tab) { s.setActiveSpace('notes'); s.ensureTab('note') } else s.setActiveSpace('notes')
  useAppStore.getState().requestOpenNote(noteId)
  return noteId
}
