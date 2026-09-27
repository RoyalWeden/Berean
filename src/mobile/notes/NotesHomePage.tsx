import React, { useEffect, useMemo, useRef, useState } from 'react'
import { verseRefDisplay } from '@/lib/parseRef'
import { pushNotesListHistory } from './notesHistory'
import { useCaretCommands, fromSheetActions } from '../commands/caretRegistry'
import { Plus, CalendarDays, Folder, FolderPlus, FolderInput, Pin, Trash2, Search, Rows3, ArrowDownUp, FileUp, Printer } from 'lucide-react'
import type { Note, NoteFolder } from '@/types'
import { useAppStore } from '@/store'
import { dailyNoteToday } from '@/lib/dailyNoteUtils'
import { openDailyNoteInCurrentTab } from '@/lib/dailyNotes'
import { useCalendarOverlay } from '../calendar/CalendarOverlay'
import { ensureDailyNoteLocation } from '@/platform/ios/location'
import { stripMarkdownFormatting } from '@/lib/notePreviewText'
import { NOTE_STATUSES } from '@/lib/noteStatus'
import { Page, IconTap, ListSection, Row } from '../primitives/Page'
import { useNavigation } from '../navigation/NavigationStack'
import { haptic } from '../primitives/haptics'
import { useActionSheet, ChoiceList } from '../primitives/ActionSheet'
import { useLongPress } from '../primitives/useLongPress'
import { useSheets, type SheetApi } from '../primitives/Sheet'
import { noteIsMovable } from '@/lib/noteMovability'
import { FolderPicker } from './FolderPicker'
import { NoteFinder } from './NoteFinder'
import './notes.css'
import { NoteEditorPage } from './NoteEditorPage'
import { TrashPage } from './TrashPage'
import PrintPreviewModal from '@/components/notes/PrintPreviewModal'
import { idiomExportEntries } from '@/lib/idiomsExport'
import { parseNoteMarkdownFile } from '@/lib/noteMarkdownFile'
import { groupNotes, useNoteHomeView, noteHomeView, NOTE_GROUPING_OPTIONS, NOTE_SORT_OPTIONS, type NoteGrouping, type NoteSortMode } from './noteGrouping'

type Filter = 'all' | 'scripture' | 'topic' | 'daily' | 'video' | 'pinned'

/**
 * Notes home for the phone (Phase 13, R084/R085): search, type filters, pinned, folders and the
 * recent list — the same `window.notes` data as the desktop NotesHomePanel. Tap → the native
 * editor page. The phone never hosts the desktop NotesPanel: its list / folder / board views are
 * native presentations here — the caret's "Group by" (Recent / By status = the board / By folder
 * = the folder view / By type) and "Sort" (last edited / created / title, as desktop).
 */
export function NotesHomePage({ dailyRequest = 0 }: { dailyRequest?: number }) {
  const nav = useNavigation()
  const noteToken = useAppStore((s) => s.noteChangeToken)
  const [notes, setNotes] = useState<Note[]>([])
  const [folders, setFolders] = useState<NoteFolder[]>([])
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Note[] | null>(null)
  // Filter and folder are part of the Notes tab's state (SEP25 per-tab history): changing them
  // is a navigation step of this tab, and back / forward restore them.
  const listState = useAppStore((s) => {
    const t = s.tabs.notes.find((x) => x.id === s.activeTabId.notes)
    return (t?.state ?? {}) as { listFilter?: Filter; listFolderId?: string | null }
  })
  const filter: Filter = listState.listFilter ?? 'all'
  const folderId = listState.listFolderId ?? null
  const setListState = (patch: { listFilter?: Filter; listFolderId?: string | null }) => {
    const s = useAppStore.getState()
    const tid = s.activeTabId.notes
    if (!tid) return
    const next = { listFilter: patch.listFilter ?? filter, listFolderId: patch.listFolderId !== undefined ? patch.listFolderId : folderId }
    if (next.listFilter === filter && next.listFolderId === folderId) return
    pushNotesListHistory(tid, { listFilter: filter, listFolderId: folderId }, folders)
    s.updateTabState('notes', tid, next)
    pushNotesListHistory(tid, next, folders)
  }
  const setFilter = (f: Filter) => setListState({ listFilter: f })
  const setFolderId = (id: string | null) => setListState({ listFolderId: id })

  useEffect(() => {
    window.notes.getNotes(500, 0).then(setNotes).catch(() => setNotes([]))
    window.notes.getFolders().then(setFolders).catch(() => setFolders([]))
  }, [noteToken])
  useEffect(() => {
    const q = query.trim()
    if (!q) { setResults(null); return }
    let alive = true
    const t = setTimeout(() => { window.notes.searchNotes(q, 100).then((r) => { if (alive) setResults(r) }).catch(() => {}) }, 200)
    return () => { alive = false; clearTimeout(t) }
  }, [query, noteToken])

  // Folder management (same `window.notes.*Folder` calls as the desktop folder view): "+" chip →
  // new folder; long-press a folder chip → rename / new subfolder / delete (empty) / delete with
  // notes (confirmed). Nested folders are flattened into "Parent / Child" chips.
  const actions = useActionSheet()
  const sheets = useSheets()
  const refresh = () => useAppStore.getState().bumpNoteToken()
  const folderLabel = (f: NoteFolder): string => { const p = f.parentId ? folders.find((x) => x.id === f.parentId) : null; return p ? `${folderLabel(p)} / ${f.name}` : f.name }
  const newFolder = async (parentId: string | null = null) => {
    const name = prompt(parentId ? 'New subfolder name' : 'New folder name')?.trim()
    if (!name) return
    const r = await window.notes.createFolder(name, parentId).catch(() => null)
    if (r?.success) { void haptic.success(); refresh() }
  }
  const folderActions = (f: NoteFolder) => {
    const count = notes.filter((n) => n.folderId === f.id).length
    const children = folders.filter((x) => x.parentId === f.id).length
    actions(`folder-${f.id}`, folderLabel(f), [
      { id: 'rename', label: 'Rename…', onSelect: () => { const name = prompt('Folder name', f.name)?.trim(); if (name && name !== f.name) window.notes.renameFolder(f.id, name).then(refresh).catch(() => {}) } },
      { id: 'sub', label: 'New subfolder…', onSelect: () => { void newFolder(f.id) } },
      ...(count === 0 && children === 0
        ? [{ id: 'delete', label: 'Delete folder', destructive: true, onSelect: () => { window.notes.deleteFolder(f.id).then(() => { if (folderId === f.id) setFolderId(null); refresh() }).catch(() => {}) } }]
        : [{ id: 'delete-deep', label: `Delete folder and its ${count} note${count === 1 ? '' : 's'}${children ? ' + subfolders' : ''}`, destructive: true, onSelect: () => { if (confirm(`Delete "${f.name}" and everything in it? Notes go to Trash.`)) window.notes.deleteFolderDeep(f.id).then(() => { if (folderId === f.id) setFolderId(null); refresh() }).catch(() => {}) } }]),
    ])
  }

  // Long-press a note row (T23-030): Move… (only for notes a system folder doesn't own — the
  // same rule as the desktop context menu), Delete (soft-delete to Trash, no confirmation —
  // restorable from Trash, matching desktop), Cancel.
  const noteActions = (n: Note) => {
    actions(`note-actions-${n.id}`, n.title || 'Untitled', [
      // Move opens the folder list INSIDE this sheet ("‹ <note>") — NEW-002.
      ...(noteIsMovable(n) ? [{ id: 'move', label: 'Move…', icon: FolderInput, onSelect: () => {}, view: () => ({
        key: 'move', title: 'Move to',
        render: (api: SheetApi) => <FolderPicker current={n.folderId ?? null} onPick={(id) => { window.notes.setNoteFolder(n.id, id).then(() => { void haptic.success(); refresh(); api.close() }).catch(() => api.close()) }} />,
      }) }] : []),
      { id: 'delete', label: 'Delete', icon: Trash2, destructive: true, onSelect: () => { window.notes.deleteNote(n.id).then(() => { void haptic.success(); refresh() }).catch(() => {}) } },
      { id: 'cancel', label: 'Cancel', onSelect: () => {} },
    ])
  }

  // Home "…" menu: import a Markdown file (R099 — vault-format frontmatter or plain Markdown;
  // a file carrying a `berean_id` that already exists updates that note instead of duplicating
  // it), export all idioms to one PDF (desktop's notes-header button), new folder.
  const [idiomsOpen, setIdiomsOpen] = useState(false)
  const hasIdioms = notes.some((n) => n.type === 'idiom')
  const importMarkdown = () => {
    const input = document.createElement('input')
    input.type = 'file'; input.accept = '.md,.markdown,.txt,text/markdown,text/plain'; input.multiple = true; input.style.display = 'none'
    document.body.appendChild(input)
    input.addEventListener('change', async () => {
      const files = Array.from(input.files ?? [])
      input.remove()
      let created = 0, updated = 0
      for (const f of files) {
        const parsed = parseNoteMarkdownFile(await f.text(), f.name.replace(/\.(md|markdown|txt)$/i, ''))
        const existing = parsed.bereanId ? notes.find((n) => n.id === parsed.bereanId) : null
        if (existing) {
          const r = await window.notes.updateNote(existing.id, { title: parsed.title, content: parsed.content, tags: parsed.tags, ...(parsed.icon ? { icon: parsed.icon } : {}), ...(parsed.color ? { color: parsed.color } : {}) }).catch(() => ({ success: false }))
          if (r.success) updated++
        } else {
          const r = await window.notes.createNote({ type: parsed.type, title: parsed.title, content: parsed.content, tags: parsed.tags, ...(parsed.verseRef ? { verseRef: parsed.verseRef } : {}), ...(parsed.icon ? { icon: parsed.icon } : {}), ...(parsed.color ? { color: parsed.color } : {}) }).catch(() => ({ success: false as const }))
          if (r.success) created++
        }
      }
      if (created || updated) { refresh(); void haptic.success() }
      if (files.length) alert(`Imported ${created} new note${created === 1 ? '' : 's'}${updated ? `, updated ${updated}` : ''}.`)
    })
    input.click()
  }
  const homeActionList = () => [
    { id: 'import', label: 'Import Markdown file…', icon: FileUp, onSelect: importMarkdown },
    ...(hasIdioms ? [{ id: 'idioms', label: 'Export all idioms (PDF)…', icon: Printer, onSelect: () => setIdiomsOpen(true) }] : []),
    { id: 'folder', label: 'New folder…', icon: FolderPlus, onSelect: () => { void newFolder(null) } },
  ]
  const view = useNoteHomeView()
  // Notes' caret (TEST-033): new note / today first, then the former "…" menu (moved, not copied).
  useCaretCommands(() => ({
    title: 'Notes',
    location: { label: 'Notes', placeholder: 'Find a note', view: () => ({ title: 'Find a note', render: (a: SheetApi) => <NoteFinder api={a} /> }) },
    sections: [
      { id: 'quick', style: 'tiles', commands: [
        { kind: 'action', id: 'new', label: 'New note', icon: Plus, run: () => { void create({}) } },
        { kind: 'action', id: 'daily', label: 'Today', icon: CalendarDays, run: () => { void openDaily() }, longPress: () => openCalendar() },
      ] },
      // The desktop's list / folder / board views, as native groupings of the home list.
      { id: 'view', title: 'View', commands: [
        { kind: 'view', id: 'group', label: 'Group by', icon: Rows3, value: NOTE_GROUPING_OPTIONS.find((o) => o.id === noteHomeView.get().grouping)?.label,
          view: () => ({ title: 'Group by', render: (api: SheetApi) => <ChoiceList api={api} value={noteHomeView.get().grouping} options={NOTE_GROUPING_OPTIONS} onSelect={(id) => noteHomeView.set({ grouping: id as NoteGrouping })} /> }) },
        { kind: 'view', id: 'sort', label: 'Sort', icon: ArrowDownUp, value: NOTE_SORT_OPTIONS.find((o) => o.id === noteHomeView.get().sort)?.label,
          view: () => ({ title: 'Sort', render: (api: SheetApi) => <ChoiceList api={api} value={noteHomeView.get().sort} options={NOTE_SORT_OPTIONS} onSelect={(id) => noteHomeView.set({ sort: id as NoteSortMode })} /> }) },
      ] },
      ...fromSheetActions(homeActionList(), { title: 'Notes' }),
    ],
  }))

  const user = notes   // every note (verse and daily notes included — they are first-class on the phone)
  const pinned = useMemo(() => user.filter((n) => n.pinned), [user])
  const list = useMemo(() => {
    const base = results ?? user
    return base.filter((n) => {
      if (folderId && n.folderId !== folderId) return false
      switch (filter) {
        case 'scripture': return n.type === 'verse'
        case 'topic': return n.type === 'general' || n.type === 'topic'
        case 'daily': return n.type === 'daily'
        case 'video': return n.type === 'video' || (n.tags ?? []).includes('video')
        case 'pinned': return !!n.pinned
        default: return true
      }
    })
  }, [results, user, filter, folderId])
  // Search results keep one list (relevance → recency); otherwise the chosen grouping / sort.
  const groups = useMemo(() => groupNotes(list, results ? 'none' : view.grouping, view.sort, folders), [list, results, view.grouping, view.sort, folders])

  const open = (note: Note) => nav.push(`note-${note.id}`, <NoteEditorPage noteId={note.id} onBack={nav.pop} />)
  const create = async (data: Partial<Note>) => {
    const r = await window.notes.createNote({ type: 'general', title: '', content: '', ...data })
    if (r.success && r.note) { useAppStore.getState().bumpNoteToken(); void haptic.success(); open(r.note) }
  }
  // Today = today's daily note, through the shared daily-note destination (SEP27-CAL-003): found
  // or created, and opened as a step of this Notes tab's history. Press and hold: the calendar.
  const openDaily = async () => {
    // Sunrise day boundary needs a location fix; the first daily-note open is where iOS asks.
    await ensureDailyNoteLocation({ prompt: true })
    await openDailyNoteInCurrentTab(dailyNoteToday())
  }
  const openCalendar = useCalendarOverlay()
  // `berean:openDailyNote` (desktop sidebar button, ⌘⇧D, the `berean://daily` deep link / App
  // Intent) is received by NotesSpace, which bumps `dailyRequest` once this page is on screen.
  const openDailyRef = useRef(openDaily)
  openDailyRef.current = openDaily
  useEffect(() => { if (dailyRequest > 0) void openDailyRef.current() }, [dailyRequest])

  return (
    <Page
      title="Notes"
      left={<IconTap icon={CalendarDays} label="Today's daily note. Press and hold for the calendar" onClick={() => void openDaily()} onLongPress={openCalendar} />}
      right={<IconTap icon={Plus} label="New note" onClick={() => void create({})} />}
      headerBelow={
        <div className="mobile-search-row">
          <Search size={16} aria-hidden />
          <input className="mobile-search-input" type="search" placeholder="Search notes…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search notes" />
        </div>
      }
    >
      {idiomsOpen && <PrintPreviewModal title="Idioms" content="" idiomEntries={idiomExportEntries(notes)} onClose={() => setIdiomsOpen(false)} />}
      <div className="mobile-chip-row mobile-chip-row-scroll" role="tablist" aria-label="Filter">
        {([['all', 'All'], ['scripture', 'Scripture'], ['topic', 'Topic'], ['daily', 'Daily'], ['video', 'Video'], ['pinned', 'Pinned']] as Array<[Filter, string]>).map(([f, label]) => (
          <button key={f} type="button" role="tab" aria-selected={filter === f} className={`mobile-chip${filter === f ? ' is-on' : ''}`} onClick={() => setFilter(f)}>{label}</button>
        ))}
      </div>
      <div className="mobile-chip-row mobile-chip-row-scroll" aria-label="Folders">
        {folders.length > 0 && <button type="button" className={`mobile-chip${folderId === null ? ' is-on' : ''}`} onClick={() => setFolderId(null)}><Folder size={14} aria-hidden /> All folders</button>}
        {folders.map((f) => (
          <FolderChip key={f.id} label={folderLabel(f)} active={folderId === f.id} onTap={() => setFolderId(folderId === f.id ? null : f.id)} onLongPress={() => folderActions(f)} />
        ))}
        <button type="button" className="mobile-chip" aria-label="New folder" onClick={() => { void newFolder(null) }}><FolderPlus size={14} aria-hidden /> {folders.length ? '' : 'New folder'}</button>
      </div>
      {!results && filter === 'all' && !folderId && pinned.length > 0 && (
        <ListSection title="Pinned">
          {pinned.map((n) => <NoteRow key={n.id} note={n} onOpen={open} onLongPress={noteActions} />)}
        </ListSection>
      )}
      {list.length === 0 ? (
        <ListSection title={results ? '0 results' : 'Recent'}>
          <div className="mobile-empty">{results ? 'No matches.' : 'No notes yet — tap + to write one, or long-press a verse.'}</div>
        </ListSection>
      ) : groups.map((g) => (
        <ListSection key={g.id} title={results ? `${list.length} result${list.length === 1 ? '' : 's'}` : groups.length === 1 && g.id === 'all' ? 'Recent' : `${g.title} · ${g.notes.length}`}>
          {g.notes.slice(0, 300).map((n) => <NoteRow key={n.id} note={n} onOpen={open} onLongPress={noteActions} />)}
        </ListSection>
      ))}
      <ListSection>
        <Row leading={<Trash2 size={18} aria-hidden />} title="Trash" chevron onClick={() => nav.push('trash', <TrashPage onBack={nav.pop} />)} />
      </ListSection>
    </Page>
  )
}

export function NoteRow({ note, onOpen, onLongPress }: { note: Note; onOpen: (n: Note) => void; onLongPress?: (n: Note) => void }) {
  // Long-press → note actions. useLongPress's capture-phase click handler on the wrapper swallows
  // the click that follows a completed long press, so the note doesn't also open.
  const lp = useLongPress(() => { if (!onLongPress) return; void haptic.medium(); onLongPress(note) })
  const status = note.status ? NOTE_STATUSES.find((s) => s.id === note.status) : null
  const preview = stripMarkdownFormatting(note.content ?? '').replace(/\s+/g, ' ').trim().slice(0, 100)
  const row = (
    <Row
      leading={<span className="mobile-note-icon" aria-hidden>{note.icon ?? (note.type === 'verse' ? '📖' : note.type === 'daily' ? '📅' : '📝')}</span>}
      title={<>{note.pinned && <Pin size={12} aria-label="Pinned" />} {note.title || 'Untitled'}</>}
      subtitle={<>{note.verseRef ? `${verseRefDisplay(note.verseRef, note.textId)} · ` : ''}{status ? `${status.label} · ` : ''}{preview || new Date(note.updatedAt).toLocaleDateString()}</>}
      chevron
      onClick={() => onOpen(note)}
    />
  )
  if (!onLongPress) return row
  return <div className="notes-row-lp" {...lp} onContextMenu={(e) => e.preventDefault()}>{row}</div>
}

/** A folder filter chip: tap filters, long-press opens the folder's actions. */
function FolderChip({ label, active, onTap, onLongPress }: { label: string; active: boolean; onTap: () => void; onLongPress: () => void }) {
  const lp = useLongPress(() => { void haptic.medium(); onLongPress() })
  return <button type="button" className={`mobile-chip${active ? ' is-on' : ''}`} {...lp} onClick={onTap}><Folder size={14} aria-hidden /> {label}</button>
}
