import type { NoteFolder } from '@/types'
import { useAppStore } from '@/store'

export interface NotesListState { listFilter?: string; listFolderId?: string | null }

const FILTER_LABEL: Record<string, string> = { scripture: 'Scripture', topic: 'Topic', daily: 'Daily', video: 'Video', pinned: 'Pinned' }

/** History title of a Notes-list destination: "Notes", "Notes · Topic", "Notes · Sermons". */
export function notesListTitle(st: NotesListState, folders: readonly NoteFolder[] = []): string {
  const parts = ['Notes']
  if (st.listFilter && st.listFilter !== 'all') parts.push(FILTER_LABEL[st.listFilter] ?? st.listFilter)
  if (st.listFolderId) parts.push(folders.find((f) => f.id === st.listFolderId)?.name ?? 'Folder')
  return parts.join(' · ')
}

/**
 * Record a Notes-list destination (the list with a filter / folder) in the tab's history
 * (SEP25). It is a `home` entry carrying the list state, so ‹ from a note returns to exactly that
 * list, and › from the list returns to the note. Skipped while back / forward is restoring.
 */
export function pushNotesListHistory(tabId: string, st: NotesListState, folders: readonly NoteFolder[] = []): void {
  const s = useAppStore.getState()
  if (s.isNavJumping) return
  s.pushTabNav(tabId, {
    type: 'note', title: notesListTitle(st, folders), home: true,
    state: { listFilter: st.listFilter ?? 'all', listFolderId: st.listFolderId ?? null, noteId: null },
  })
}

/** The list state currently stored on a Notes tab. */
export function currentNotesListState(tabId: string): NotesListState {
  const t = useAppStore.getState().tabs.notes.find((x) => x.id === tabId)
  const st = (t?.state ?? {}) as NotesListState
  return { listFilter: st.listFilter ?? 'all', listFolderId: st.listFolderId ?? null }
}
