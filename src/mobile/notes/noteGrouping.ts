import { useSyncExternalStore } from 'react'
import type { Note, NoteFolder } from '@/types'
import { NOTE_STATUSES } from '@/lib/noteStatus'
import { displayNoteTitle } from '@/lib/noteTitle'

/**
 * iPhone presentations of the desktop Notes views (list / folder / board). The phone never hosts
 * the desktop NotesPanel; instead the notes home list can be GROUPED and SORTED from the Notes
 * caret: "By status" is the board (one section per status column, in board order), "By folder"
 * is the folder view (one section per folder, "Parent / Child" labels), "By type" mirrors the
 * filter chips as sections. Pure helpers + a tiny session store (the choice survives the page
 * remounting, like desktop's cachedNotesViewMode).
 */
export type NoteGrouping = 'none' | 'status' | 'folder' | 'type'
export type NoteSortMode = 'modified' | 'created' | 'name'

export const NOTE_GROUPING_OPTIONS: Array<{ id: NoteGrouping; label: string; detail: string }> = [
  { id: 'none', label: 'Recent', detail: 'One list, the way it is sorted' },
  { id: 'status', label: 'By status', detail: 'Started, In Progress, Complete… (the desktop board)' },
  { id: 'folder', label: 'By folder', detail: 'A section per folder' },
  { id: 'type', label: 'By type', detail: 'Scripture, topic, daily, video' },
]
export const NOTE_SORT_OPTIONS: Array<{ id: NoteSortMode; label: string }> = [
  { id: 'modified', label: 'Last edited' },
  { id: 'created', label: 'Date created' },
  { id: 'name', label: 'Title' },
]

export interface NoteGroup { id: string; title: string; notes: Note[] }

export function sortNotes(notes: Note[], sort: NoteSortMode): Note[] {
  const out = [...notes]
  if (sort === 'name') out.sort((a, b) => displayNoteTitle(a.title).localeCompare(displayNoteTitle(b.title), undefined, { sensitivity: 'base' }))
  else if (sort === 'created') out.sort((a, b) => b.createdAt - a.createdAt)
  else out.sort((a, b) => b.updatedAt - a.updatedAt)
  return out
}

function folderPath(f: NoteFolder, folders: NoteFolder[], depth = 0): string {
  const p = f.parentId && depth < 20 ? folders.find((x) => x.id === f.parentId) : null
  return p ? `${folderPath(p, folders, depth + 1)} / ${f.name}` : f.name
}

const typeLabel = (n: Note): [string, string] => {
  if (n.type === 'verse') return ['scripture', 'Scripture']
  if (n.type === 'daily') return ['daily', 'Daily']
  if (n.type === 'video' || (n.tags ?? []).includes('video')) return ['video', 'Video']
  if (n.type === 'idiom') return ['idiom', 'Idioms']
  return ['topic', 'Topic']
}
const TYPE_ORDER = ['scripture', 'topic', 'daily', 'video', 'idiom']

/** Sections for the notes home list. Notes must already be filtered; empty groups are dropped. */
export function groupNotes(notes: Note[], grouping: NoteGrouping, sort: NoteSortMode, folders: NoteFolder[] = []): NoteGroup[] {
  const sorted = sortNotes(notes, sort)
  if (grouping === 'none') return [{ id: 'all', title: 'Recent', notes: sorted }]
  const buckets = new Map<string, NoteGroup>()
  const put = (id: string, title: string, n: Note) => {
    let g = buckets.get(id)
    if (!g) { g = { id, title, notes: [] }; buckets.set(id, g) }
    g.notes.push(n)
  }
  let order: string[]
  if (grouping === 'status') {
    for (const n of sorted) {
      const s = n.status ? NOTE_STATUSES.find((x) => x.id === n.status) : null
      put(s ? s.id : 'none', s ? s.label : 'No status', n)
    }
    order = [...NOTE_STATUSES.map((s) => s.id as string), 'none']
  } else if (grouping === 'folder') {
    for (const n of sorted) {
      const f = n.folderId ? folders.find((x) => x.id === n.folderId) : null
      put(f ? f.id : 'none', f ? folderPath(f, folders) : 'No folder', n)
    }
    const labelled = [...buckets.values()].filter((g) => g.id !== 'none').sort((a, b) => a.title.localeCompare(b.title))
    order = [...labelled.map((g) => g.id), 'none']
  } else {
    for (const n of sorted) { const [id, title] = typeLabel(n); put(id, title, n) }
    order = TYPE_ORDER
  }
  return order.map((id) => buckets.get(id)).filter((g): g is NoteGroup => !!g && g.notes.length > 0)
}

// ── session store for the chosen presentation ──────────────────────────────────────────────
// Persisted on the device (NOTES-HOME-004: the chosen sort / grouping survives relaunch).
const VIEW_KEY = 'berean.notesHome.view.v1'
function readView(): { grouping: NoteGrouping; sort: NoteSortMode } {
  try {
    const raw = JSON.parse(localStorage.getItem(VIEW_KEY) ?? 'null') as { grouping?: string; sort?: string } | null
    return {
      grouping: NOTE_GROUPING_OPTIONS.some((o) => o.id === raw?.grouping) ? raw!.grouping as NoteGrouping : 'none',
      sort: NOTE_SORT_OPTIONS.some((o) => o.id === raw?.sort) ? raw!.sort as NoteSortMode : 'modified',
    }
  } catch { return { grouping: 'none', sort: 'modified' } }
}
let current: { grouping: NoteGrouping; sort: NoteSortMode } = readView()
const listeners = new Set<() => void>()
export const noteHomeView = {
  get: () => current,
  set(patch: Partial<typeof current>) {
    current = { ...current, ...patch }
    try { localStorage.setItem(VIEW_KEY, JSON.stringify(current)) } catch { /* session only */ }
    for (const l of listeners) l()
  },
  subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l) } },
}
export function useNoteHomeView() {
  return useSyncExternalStore(noteHomeView.subscribe, noteHomeView.get, noteHomeView.get)
}
