import { getAllNotes, getWarmStartNotes } from '@/lib/notesCache'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { pushNotesListHistory } from './notesHistory'
import { useCaretCommands, fromSheetActions } from '../commands/caretRegistry'
import {
  Plus, CalendarDays, FolderPlus, FolderInput, Pin, PinOff, Trash2, Search, Rows3, ArrowDownUp, FileUp, Printer, X,
  SquarePen, MoreHorizontal, LayoutGrid, List, Filter as FilterIcon, Pencil, ArrowUpRight, SquarePlus, Copy, Share2, CheckSquare, ChevronDown, FolderTree,
} from 'lucide-react'
import type { Note, NoteFolder } from '@/types'
import { useAppStore } from '@/store'
import { dailyNoteToday } from '@/lib/dailyNoteUtils'
import { openDailyNoteInCurrentTab } from '@/lib/dailyNotes'
import { openDestination } from '@/lib/navigation/destination'
import { displayNoteTitle } from '@/lib/noteTitle'
import { useCalendarOverlay } from '../calendar/CalendarOverlay'
import { ensureDailyNoteLocation } from '@/platform/ios/location'
import { Page, IconTap } from '../primitives/Page'
import { useNavigation } from '../navigation/NavigationStack'
import { haptic } from '../primitives/haptics'
import { useActionSheet, ChoiceList, type SheetAction } from '../primitives/ActionSheet'
import { useSheets, type SheetApi } from '../primitives/Sheet'
import { noteIsMovable } from '@/lib/noteMovability'
import { FolderPicker } from './FolderPicker'
import { CaretGoTo } from '../commands/CaretGoTo'
import './notes.css'
import './notesHome.css'
import { NoteEditorPage } from './NoteEditorPage'
import { TrashPage } from './TrashPage'
import PrintPreviewModal from '@/components/notes/PrintPreviewModal'
import { idiomExportEntries } from '@/lib/idiomsExport'
import { parseNoteMarkdownFile } from '@/lib/noteMarkdownFile'
import { useNoteHomeView, noteHomeView, NOTE_GROUPING_OPTIONS, NOTE_SORT_OPTIONS, type NoteGrouping, type NoteSortMode } from './noteGrouping'
import {
  buildFolderTree, findFolderNode, subtreeIds, visibleFolderRows, folderPathLabel, notesAt, systemFolderCounts, locationTitle, parentLocation,
  isSystemLocation, SYSTEM_FOLDERS, NOTE_FILTER_OPTIONS, matchesFilter, folderViewSections, matchFolders, notesHomePrefs, useNotesHomePrefs, sectionCollapse,
  type FolderLocation, type FolderNode, type NoteFilter,
} from './notesHomeModel'
import { NoteListRow, NoteGalleryCard, FolderRow, FolderTreeRows } from './NoteListItems'
import { NotePeek, type PeekAction } from './NotePeek'

/**
 * Notes Home for the phone (NOTES-HOME-001…; redesigned after Apple Notes, 2026-09-28).
 *
 *   Folders home   large "Folders" title · New Folder · Edit; All Notes (undeletable) · Berean's
 *                  system folders (Daily, Verse, e-Sword, BibleGateway — the desktop's virtual
 *                  folders) · your folder tree with counts, nested folders expandable · Trash
 *   Folder view    ‹ back · large title · "N Notes · M Folders" · subfolders (collapsible) ·
 *                  Pinned · Today / Previous 7 Days / Previous 30 Days / months (collapsible) —
 *                  as a list or a gallery of cards
 *   Always         one Notes search (notes + folders) floating at the bottom, with the compose
 *                  button beside it; both ride above the bottom navigation and the keyboard
 *   Edit           select notes → Move · Pin · Share · Delete
 *   Rows           swipe right: Pin; left: Delete (full swipe) · Move; long press: the floating
 *                  preview with Open · Open in New Tab · Pin · Move · Duplicate · Share · Print · Delete
 *
 * The location is the Notes tab's state (`listFolderId`, `listFilter`), so back / forward, the
 * tab card and relaunch restore it (notesHistory). The same `window.notes` data as the desktop.
 */
export function NotesHomePage({ dailyRequest = 0 }: { dailyRequest?: number }) {
  const nav = useNavigation()
  const noteToken = useAppStore((s) => s.noteChangeToken)
  const [notes, setNotes] = useState<Note[]>(() => getWarmStartNotes() ?? [])
  const [folders, setFolders] = useState<NoteFolder[]>([])
  const [trashCount, setTrashCount] = useState(0)
  const [loaded, setLoaded] = useState(false)
  const listState = useAppStore((s) => {
    const t = s.tabs.notes.find((x) => x.id === s.activeTabId.notes)
    return (t?.state ?? {}) as { listFilter?: NoteFilter; listFolderId?: string | null }
  })
  const filter: NoteFilter = listState.listFilter ?? 'all'
  const loc: FolderLocation = listState.listFolderId ?? null
  const setListState = (patch: { listFilter?: NoteFilter; listFolderId?: string | null }) => {
    const s = useAppStore.getState()
    const tid = s.activeTabId.notes
    if (!tid) return
    const next = { listFilter: patch.listFilter ?? filter, listFolderId: patch.listFolderId !== undefined ? patch.listFolderId : loc }
    if (next.listFilter === filter && next.listFolderId === loc) return
    pushNotesListHistory(tid, { listFilter: filter, listFolderId: loc }, folders)
    s.updateTabState('notes', tid, next)
    pushNotesListHistory(tid, next, folders)
  }
  const go = (to: FolderLocation) => { setEditing(false); setSelected(new Set()); setQuery(''); setListState({ listFolderId: to }) }

  // Performance (TEST 2026-09-29 "lags opening notes / moving between pages"): every autosave
  // bumps noteChangeToken; this list used to refetch + rebuild the whole tree on each one even
  // while a note covered it. Now it loads through the shared notes cache (one fetch per token for
  // every consumer, warm-started) and, while covered by a pushed page, only marks itself stale —
  // it refreshes once when it is visible again.
  const covered = nav.depth > 0
  const loadedToken = useRef<number | null>(null)
  useEffect(() => {
    if (covered || loadedToken.current === noteToken) return
    let alive = true
    void Promise.all([
      getAllNotes(noteToken),
      window.notes.getFolders().catch(() => [] as NoteFolder[]),
      window.notes.listTrash().catch(() => [] as Note[]),
    ]).then(([n, f, t]) => { if (!alive) return; loadedToken.current = noteToken; setNotes(n); setFolders(f); setTrashCount(t.length); setLoaded(true) })
    return () => { alive = false }
  }, [noteToken, covered])
  // A folder that disappeared (deleted here or on another device) → back to the Folders home.
  useEffect(() => {
    if (loaded && loc && loc !== 'all' && !isSystemLocation(loc) && !folders.some((f) => f.id === loc)) go(null)
  }, [loaded, loc, folders]) // eslint-disable-line react-hooks/exhaustive-deps

  const refresh = () => useAppStore.getState().bumpNoteToken()
  const prefs = useNotesHomePrefs()
  const view = useNoteHomeView()
  const now = useMemo(() => Date.now(), [noteToken, loc]) // eslint-disable-line react-hooks/exhaustive-deps
  const tree = useMemo(() => buildFolderTree(folders, notes), [folders, notes])
  const sysCounts = useMemo(() => systemFolderCounts(notes), [notes])
  const expanded = useMemo(() => new Set(prefs.expandedFolders), [prefs.expandedFolders])
  const toggleExpanded = (id: string) => {
    const next = new Set(expanded); if (next.has(id)) next.delete(id); else next.add(id)
    notesHomePrefs.set({ expandedFolders: [...next] })
  }
  const folderName = (id: string | null | undefined) => folderPathLabel(id, folders)

  // ── search: one field, notes + folders, everything (not only this folder) ───────────────────
  const [query, setQuery] = useState('')
  const [searchFocused, setSearchFocused] = useState(false)
  const [results, setResults] = useState<Note[] | null>(null)
  const q = query.trim()
  useEffect(() => {
    if (!q) { setResults(null); return }
    let alive = true
    const t = setTimeout(() => { window.notes.searchNotes(q, 200).then((r) => { if (alive) setResults(r) }).catch(() => { if (alive) setResults([]) }) }, 180)
    return () => { alive = false; clearTimeout(t) }
  }, [q, noteToken])
  const folderHits = useMemo(() => matchFolders(q, folders), [q, folders])
  const searchRef = useRef<HTMLInputElement>(null)
  const searching = searchFocused || !!q
  const cancelSearch = () => { setQuery(''); setSearchFocused(false); searchRef.current?.blur() }

  // ── edit / selection ─────────────────────────────────────────────────────────────────────
  const [editing, setEditing] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const toggleSel = (n: Note) => { void haptic.selection(); setSelected((s) => { const x = new Set(s); if (x.has(n.id)) x.delete(n.id); else x.add(n.id); return x }) }
  const endEdit = () => { setEditing(false); setSelected(new Set()) }
  const selectedNotes = notes.filter((n) => selected.has(n.id))

  // ── actions ──────────────────────────────────────────────────────────────────────────────
  const actions = useActionSheet()
  const sheets = useSheets()
  const open = (note: Note) => nav.push(`note-${note.id}`, <NoteEditorPage noteId={note.id} onBack={nav.pop} />)
  const create = async (data: Partial<Note> = {}) => {
    // A note written inside a user folder is filed there (Apple Notes).
    const folderId = loc && loc !== 'all' && !isSystemLocation(loc) ? loc : undefined
    const r = await window.notes.createNote({ type: 'general', title: '', content: '', ...data })
    if (r.success && r.note) {
      if (folderId) await window.notes.setNoteFolder(r.note.id, folderId).catch(() => {})
      refresh(); void haptic.success(); open(r.note)
    }
  }
  const setPinned = async (ns: Note[], pinned: boolean) => {
    for (const n of ns) await window.notes.setNotePinned(n.id, pinned).catch(() => {})
    void haptic.success(); refresh()
  }
  const trash = async (ns: Note[]) => {
    for (const n of ns) await window.notes.deleteNote(n.id).catch(() => {})
    void haptic.success(); refresh()
  }
  const moveNotes = (ns: Note[], after?: () => void) => {
    const movable = ns.filter(noteIsMovable)
    if (!movable.length) return
    sheets.open({ id: 'notes-move', title: movable.length === 1 ? 'Move Note' : `Move ${movable.length} Notes`, detents: [0.62, 0.92], render: (api) => (
      <FolderPicker current={movable.length === 1 ? movable[0].folderId ?? null : undefined} noneLabel="No folder"
        onPick={async (id) => { for (const n of movable) await window.notes.setNoteFolder(n.id, id).catch(() => {}); void haptic.success(); refresh(); api.close(); after?.() }} />
    ) })
  }
  const shareNotes = async (ns: Note[]) => {
    const text = ns.map((n) => `# ${displayNoteTitle(n.title)}\n\n${n.content ?? ''}`).join('\n\n---\n\n')
    try { const { Share } = await import('@capacitor/share'); await Share.share({ title: ns.length === 1 ? displayNoteTitle(ns[0].title) : `${ns.length} notes`, text }) }
    catch { try { await navigator.clipboard.writeText(text) } catch { /* ignore */ } }
  }
  const duplicate = async (n: Note) => {
    const r = await window.notes.createNote({ type: n.type, title: n.title ? `${n.title} copy` : '', content: n.content ?? '', tags: n.tags ?? [], ...(n.verseRef ? { verseRef: n.verseRef } : {}), ...(n.icon ? { icon: n.icon } : {}), ...(n.color ? { color: n.color } : {}) }).catch(() => null)
    if (r?.success && r.note) { if (n.folderId) await window.notes.setNoteFolder(r.note.id, n.folderId).catch(() => {}); void haptic.success(); refresh() }
  }
  const [printNote, setPrintNote] = useState<Note | null>(null)
  const [peek, setPeek] = useState<{ note: Note; rect: DOMRect } | null>(null)
  const closePeek = useCallback(() => setPeek(null), [])
  const peekActions = (n: Note): PeekAction[] => [
    { id: 'open', label: 'Open', icon: ArrowUpRight, run: () => open(n) },
    { id: 'new-tab', label: 'Open in New Tab', icon: SquarePlus, run: () => openDestination({ kind: 'note', noteId: n.id }, 'new-tab') },
    { id: 'pin', label: n.pinned ? 'Unpin Note' : 'Pin Note', icon: n.pinned ? PinOff : Pin, run: () => { void setPinned([n], !n.pinned) } },
    ...(noteIsMovable(n) ? [{ id: 'move', label: 'Move', icon: FolderInput, run: () => moveNotes([n]) }] : []),
    { id: 'duplicate', label: 'Duplicate', icon: Copy, run: () => { void duplicate(n) } },
    { id: 'share', label: 'Share', icon: Share2, run: () => { void shareNotes([n]) } },
    { id: 'print', label: 'Print / PDF', icon: Printer, run: () => setPrintNote(n) },
    { id: 'delete', label: 'Delete', icon: Trash2, destructive: true, run: () => { void trash([n]) } },
  ]

  // ── folders ──────────────────────────────────────────────────────────────────────────────
  const newFolder = async (parentId: string | null = null) => {
    const name = prompt(parentId ? 'New subfolder name' : 'New folder name')?.trim()
    if (!name) return
    const r = await window.notes.createFolder(name, parentId).catch(() => null)
    if (r?.success) { void haptic.success(); if (parentId && !expanded.has(parentId)) toggleExpanded(parentId); refresh() }
  }
  const renameFolder = (f: NoteFolder) => { const name = prompt('Folder name', f.name)?.trim(); if (name && name !== f.name) window.notes.renameFolder(f.id, name).then(refresh).catch(() => {}) }
  const moveFolder = (node: FolderNode) => {
    const exclude = subtreeIds(node)
    sheets.open({ id: 'folder-move', title: `Move “${node.folder.name}”`, detents: [0.62, 0.92], render: (api) => (
      <FolderPicker current={node.folder.parentId} exclude={exclude} noneLabel="Top level"
        onPick={(id) => { window.notes.setFolderParent(node.folder.id, id).then(() => { void haptic.success(); refresh(); api.close() }).catch(() => api.close()) }} />
    ) })
  }
  const deleteFolder = (node: FolderNode) => {
    const f = node.folder
    const after = () => { if (loc && subtreeIds(node).has(loc)) go(parentLocation(f.id, folders)); refresh() }
    if (node.total === 0 && node.children.length === 0) { window.notes.deleteFolder(f.id).then(after).catch(() => {}); return }
    if (confirm(`Delete “${f.name}”${node.children.length ? ' and its subfolders' : ''}? Its ${node.total} note${node.total === 1 ? '' : 's'} go to Trash.`)) window.notes.deleteFolderDeep(f.id).then(after).catch(() => {})
  }
  const folderActionList = (node: FolderNode): SheetAction[] => [
    { id: 'rename', label: 'Rename…', icon: Pencil, onSelect: () => renameFolder(node.folder) },
    { id: 'sub', label: 'New Subfolder…', icon: FolderPlus, onSelect: () => { void newFolder(node.folder.id) } },
    { id: 'move', label: 'Move…', icon: FolderTree, onSelect: () => moveFolder(node) },
    { id: 'delete', label: node.total || node.children.length ? 'Delete Folder…' : 'Delete Folder', icon: Trash2, destructive: true, onSelect: () => deleteFolder(node) },
  ]
  const folderActions = (node: FolderNode) => actions(`folder-${node.folder.id}`, node.folder.name, folderActionList(node))

  // ── import / idioms (kept from the former "…" menu) ──────────────────────────────────────
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

  // ── daily note ───────────────────────────────────────────────────────────────────────────
  const openDaily = async () => {
    await ensureDailyNoteLocation({ prompt: true })
    await openDailyNoteInCurrentTab(dailyNoteToday())
  }
  const openCalendar = useCalendarOverlay()
  const openDailyRef = useRef(openDaily)
  openDailyRef.current = openDaily
  useEffect(() => { if (dailyRequest > 0) void openDailyRef.current() }, [dailyRequest])

  // ── what this location shows ─────────────────────────────────────────────────────────────
  const userFolderNode = loc && loc !== 'all' && !isSystemLocation(loc) ? findFolderNode(tree, loc) : null
  const here = useMemo(() => notesAt(loc, notes).filter((n) => matchesFilter(n, filter)), [loc, notes, filter])
  const sections = useMemo(() => folderViewSections(here, { sort: view.sort, grouping: view.grouping, folders, now }), [here, view.sort, view.grouping, folders, now])
  const subfolders = userFolderNode?.children ?? []
  const title = locationTitle(loc, folders)
  const [, bumpCollapse] = useState(0)
  const toggleSection = useCallback((id: string) => { sectionCollapse.toggle(loc, id); bumpCollapse((n) => n + 1); void haptic.selection() }, [loc])

  // ── caret (the Notes commands; Today / calendar stay here) ───────────────────────────────
  const viewSection = {
    id: 'view', title: 'View', commands: [
      { kind: 'segmented' as const, id: 'layout', label: 'Layout', icon: LayoutGrid, value: prefs.layout, options: [['list', 'List'], ['gallery', 'Gallery']] as Array<[string, string]>, set: (v: string) => notesHomePrefs.set({ layout: v as 'list' | 'gallery' }) },
      { kind: 'view' as const, id: 'sort', label: 'Sort', icon: ArrowDownUp, value: NOTE_SORT_OPTIONS.find((o) => o.id === view.sort)?.label,
        view: () => ({ title: 'Sort', render: (api: SheetApi) => <ChoiceList api={api} value={noteHomeView.get().sort} options={NOTE_SORT_OPTIONS} onSelect={(id) => noteHomeView.set({ sort: id as NoteSortMode })} /> }) },
      { kind: 'view' as const, id: 'group', label: 'Group by', icon: Rows3, value: view.grouping === 'none' ? 'By date' : NOTE_GROUPING_OPTIONS.find((o) => o.id === view.grouping)?.label,
        view: () => ({ title: 'Group by', render: (api: SheetApi) => <ChoiceList api={api} value={noteHomeView.get().grouping} options={groupingOptions} onSelect={(id) => noteHomeView.set({ grouping: id as NoteGrouping })} /> }) },
      { kind: 'view' as const, id: 'filter', label: 'Show', icon: FilterIcon, value: NOTE_FILTER_OPTIONS.find((o) => o.id === filter)?.label,
        view: () => ({ title: 'Show', render: (api: SheetApi) => <ChoiceList api={api} value={filter} options={NOTE_FILTER_OPTIONS} onSelect={(id) => setListState({ listFilter: id as NoteFilter })} /> }) },
    ],
  }
  useCaretCommands(() => ({
    title: loc ? title : 'Notes',
    location: { label: 'Notes', placeholder: 'Search Berean', view: () => ({ title: 'Search', render: (a: SheetApi) => <CaretGoTo api={a} /> }) },
    sections: [
      { id: 'quick', style: 'tiles', commands: [
        { kind: 'action', id: 'new', label: 'New note', icon: Plus, run: () => { void create() } },
        { kind: 'action', id: 'daily', label: 'Today', icon: CalendarDays, run: () => { void openDaily() }, longPress: () => openCalendar() },
      ] },
      ...(loc ? [viewSection] : []),
      ...(userFolderNode ? fromSheetActions(folderActionList(userFolderNode), { title: 'Folder' }) : []),
      ...fromSheetActions([
        ...(loc ? [{ id: 'select', label: 'Select Notes', icon: CheckSquare, onSelect: () => setEditing(true) }] : []),
        { id: 'folder', label: 'New Folder…', icon: FolderPlus, onSelect: () => { void newFolder(userFolderNode ? userFolderNode.folder.id : null) } },
        { id: 'import', label: 'Import Markdown file…', icon: FileUp, onSelect: importMarkdown },
        ...(hasIdioms ? [{ id: 'idioms', label: 'Export all idioms (PDF)…', icon: Printer, onSelect: () => setIdiomsOpen(true) }] : []),
      ], { title: 'Notes' }),
    ],
  }))

  // ── header ───────────────────────────────────────────────────────────────────────────────
  // The large title scrolls with the content; the small bar title appears once it has gone.
  const largeRef = useRef<HTMLDivElement>(null)
  const [largeVisible, setLargeVisible] = useState(true)
  useEffect(() => {
    const el = largeRef.current
    if (!el || typeof IntersectionObserver === 'undefined') { setLargeVisible(true); return }
    // The glass bar overlays the list, so "scrolled away" means "gone under the bar".
    const bar = el.closest('.mobile-page')?.querySelector(':scope > .mobile-page-header')
    const barH = Math.round(bar?.getBoundingClientRect().height ?? 0)
    const io = new IntersectionObserver(([e]) => setLargeVisible(e.isIntersecting), { threshold: 0, rootMargin: `-${barH}px 0px 0px 0px` })
    io.observe(el)
    return () => io.disconnect()
  }, [loc, searchFocused, query])
  const moreMenu = () => actions('notes-folder-more', title, [
    { id: 'select', label: 'Select Notes', icon: CheckSquare, onSelect: () => setEditing(true) },
    { id: 'layout', label: prefs.layout === 'list' ? 'View as Gallery' : 'View as List', icon: prefs.layout === 'list' ? LayoutGrid : List, onSelect: () => notesHomePrefs.set({ layout: prefs.layout === 'list' ? 'gallery' : 'list' }) },
    { id: 'sort', label: `Sort: ${NOTE_SORT_OPTIONS.find((o) => o.id === view.sort)?.label}`, icon: ArrowDownUp, onSelect: () => {}, view: () => ({ key: 'sort', title: 'Sort', render: (api: SheetApi) => <ChoiceList api={api} closeOnSelect value={view.sort} options={NOTE_SORT_OPTIONS} onSelect={(id) => noteHomeView.set({ sort: id as NoteSortMode })} /> }) },
    { id: 'group', label: `Group: ${view.grouping === 'none' ? 'By date' : NOTE_GROUPING_OPTIONS.find((o) => o.id === view.grouping)?.label}`, icon: Rows3, onSelect: () => {}, view: () => ({ key: 'group', title: 'Group by', render: (api: SheetApi) => <ChoiceList api={api} closeOnSelect value={view.grouping} options={groupingOptions} onSelect={(id) => noteHomeView.set({ grouping: id as NoteGrouping })} /> }) },
    { id: 'filter', label: `Show: ${NOTE_FILTER_OPTIONS.find((o) => o.id === filter)?.label}`, icon: FilterIcon, onSelect: () => {}, view: () => ({ key: 'filter', title: 'Show', render: (api: SheetApi) => <ChoiceList api={api} closeOnSelect value={filter} options={NOTE_FILTER_OPTIONS} onSelect={(id) => setListState({ listFilter: id as NoteFilter })} /> }) },
    ...(userFolderNode ? folderActionList(userFolderNode) : []),
  ])
  const parent = parentLocation(loc, folders)
  const back = loc ? { onBack: () => go(parent), backLabel: locationTitle(parent, folders) } : {}
  const right = editing
    ? <button type="button" className="m-notes-textbtn is-strong" onClick={endEdit}>Done</button>
    : loc
      ? <><button type="button" className="m-notes-textbtn" onClick={() => setEditing(true)}>Edit</button><IconTap icon={MoreHorizontal} label="Folder options" onClick={moreMenu} /></>
      : <><IconTap icon={FolderPlus} label="New Folder" onClick={() => { void newFolder(null) }} /><button type="button" className="m-notes-textbtn" onClick={() => setEditing(true)}>Edit</button></>

  // ── rendering helpers ────────────────────────────────────────────────────────────────────
  const showFolderOnRow = loc === 'all' || isSystemLocation(loc) || searching
  const onPeek = (note: Note, rect: DOMRect) => setPeek({ note, rect })
  const renderNotes = (list: Note[], key: string) => prefs.layout === 'gallery' ? (
    <div className="m-notes-gallery" role="list" key={key}>
      {list.map((n) => <div role="listitem" key={n.id}><NoteGalleryCard note={n} now={now} selecting={editing} selected={selected.has(n.id)} onOpen={open} onToggle={toggleSel} onLongPress={onPeek} /></div>)}
    </div>
  ) : (
    <div className="m-notes-group" role="list" key={key}>
      {list.map((n) => (
        <div role="listitem" key={n.id}>
          <NoteListRow note={n} now={now} folderName={showFolderOnRow ? folderName(n.folderId) : null} selecting={editing} selected={selected.has(n.id)}
            onOpen={open} onToggle={toggleSel} onLongPress={onPeek}
            onPin={(x) => { void setPinned([x], !x.pinned) }} onMove={(x) => moveNotes([x])} onDelete={(x) => { void trash([x]) }} canMove={noteIsMovable(n)} />
        </div>
      ))}
    </div>
  )

  const searchBody = (
    <div className="m-notes-search-results">
      {!q ? <div className="m-notes-hint">Search every note and folder.</div> : (
        <>
          {folderHits.length > 0 && (
            <section className="m-notes-section" aria-label="Folders">
              <h2 className="m-notes-section-title is-static">Folders</h2>
              <div className="m-notes-group" role="list">
                {folderHits.map((f) => { const node = findFolderNode(tree, f.id); return <FolderRow key={f.id} name={folderPathLabel(f.id, folders) ?? f.name} count={node?.total ?? 0} onOpen={() => go(f.id)} /> })}
              </div>
            </section>
          )}
          <section className="m-notes-section" aria-label="Notes">
            <h2 className="m-notes-section-title is-static">{results == null ? 'Notes' : `${results.length} Note${results.length === 1 ? '' : 's'}`}</h2>
            {results == null ? <div className="m-notes-hint">Searching…</div>
              : results.length === 0 ? <div className="m-notes-hint">No notes match “{q}”.</div>
              : renderNotes(results, 'search')}
          </section>
        </>
      )}
    </div>
  )

  const homeBody = (
    <>
      <div className="m-notes-group" role="list" aria-label="Folders">
        <FolderRow kind="all" name="All Notes" count={notes.length} onOpen={() => go('all')} />
        {SYSTEM_FOLDERS.filter((s) => sysCounts[s.key] > 0).map((s) => (
          <FolderRow key={s.key} kind={s.icon as 'daily' | 'verse' | 'import'} name={s.name} count={sysCounts[s.key]} onOpen={() => go(`sys:${s.key}`)} />
        ))}
      </div>
      {tree.length > 0 && (
        <section className="m-notes-section" aria-label="My folders">
          <h2 className="m-notes-section-title is-static">My Folders</h2>
          <div className="m-notes-group" role="list">
            <FolderTreeRows rows={visibleFolderRows(tree, expanded)} expanded={expanded} onToggle={toggleExpanded} onOpen={(id) => go(id)} onLongPress={folderActions}
              trailing={editing ? (n) => <button type="button" className="m-folder-more" aria-label={`${n.folder.name} actions`} onClick={() => folderActions(n)}><MoreHorizontal size={20} aria-hidden /></button> : undefined} />
          </div>
        </section>
      )}
      {loaded && tree.length === 0 && <button type="button" className="m-notes-hint is-button" onClick={() => { void newFolder(null) }}><FolderPlus size={16} aria-hidden /> New Folder</button>}
      <div className="m-notes-group m-notes-trash" role="list">
        <FolderRow kind="trash" name="Trash" count={trashCount} onOpen={() => nav.push('trash', <TrashPage onBack={nav.pop} />)} />
      </div>
    </>
  )

  const folderBody = (
    <>
      {subfolders.length > 0 && (
        <section className="m-notes-section" aria-label="Folders">
          <SectionHeader id="folders" title="Folders" count={subfolders.length} collapsed={sectionCollapse.isCollapsed(loc, 'folders')} onToggle={toggleSection} />
          {!sectionCollapse.isCollapsed(loc, 'folders') && (
            <div className="m-notes-group" role="list">
              {subfolders.map((c) => <FolderRow key={c.folder.id} name={c.folder.name} count={c.total} onOpen={() => go(c.folder.id)} onLongPress={() => folderActions(c)} />)}
            </div>
          )}
        </section>
      )}
      {sections.map((s) => {
        const c = sectionCollapse.isCollapsed(loc, s.id)
        return (
          <section key={s.id} className="m-notes-section" aria-label={s.title}>
            <SectionHeader id={s.id} title={s.title} count={s.notes.length} collapsed={c} onToggle={toggleSection} />
            {!c && renderNotes(s.notes, s.id)}
          </section>
        )
      })}
      {loaded && here.length === 0 && subfolders.length === 0 && (
        <div className="m-notes-empty">
          <div>{filter !== 'all' ? `No ${NOTE_FILTER_OPTIONS.find((o) => o.id === filter)?.label.toLowerCase()} notes here.` : 'No Notes'}</div>
          {!isSystemLocation(loc) && <button type="button" className="m-notes-textbtn is-strong" onClick={() => { void create() }}>New Note</button>}
        </div>
      )}
    </>
  )

  const subtitle = loc ? [`${here.length} Note${here.length === 1 ? '' : 's'}`, subfolders.length ? `${subfolders.length} Folder${subfolders.length === 1 ? '' : 's'}` : null, filter !== 'all' ? NOTE_FILTER_OPTIONS.find((o) => o.id === filter)?.label : null].filter(Boolean).join(' · ') : null
  // The bar's second line (TEST 2026-09-29): the note count centred under the folder name.
  const barCount = loc ? `${here.length} Note${here.length === 1 ? '' : 's'}` : `${notes.length} Note${notes.length === 1 ? '' : 's'}`
  const allSelected = selectedNotes.length > 0 && selectedNotes.every((n) => n.pinned)

  return (
    <Page
      header="glass"
      className={`m-notes-home${editing ? ' is-editing' : ''}${largeVisible && !searching ? ' is-large-title' : ''}`}
      title={largeVisible || searching ? '' : (
        <span className="m-notes-bar-title">
          <span className="m-notes-bar-name">{title}</span>
          {barCount && <span className="m-notes-bar-count">{barCount}</span>}
        </span>
      )}
      {...back}
      left={loc ? undefined : <IconTap icon={CalendarDays} label="Today's daily note. Press and hold for the calendar" onClick={() => void openDaily()} onLongPress={openCalendar} />}
      right={searching ? undefined : right}
      bodyClassName="m-notes-body"
    >
      {idiomsOpen && <PrintPreviewModal title="Idioms" content="" idiomEntries={idiomExportEntries(notes)} onClose={() => setIdiomsOpen(false)} />}
      {printNote && <PrintPreviewModal title={displayNoteTitle(printNote.title)} content={printNote.content} notes={notes} onClose={() => setPrintNote(null)} />}
      {!searching && (
        <div ref={largeRef} className="m-notes-large">
          <h1 className="m-notes-large-title">{title}</h1>
          {subtitle && <div className="m-notes-large-sub">{subtitle}</div>}
        </div>
      )}
      {searching ? searchBody : loc ? folderBody : homeBody}

      {editing && loc ? (
        <div className="m-notes-float m-notes-editbar" role="toolbar" aria-label={`${selected.size} selected`}>
          <button type="button" disabled={!selectedNotes.some(noteIsMovable)} onClick={() => moveNotes(selectedNotes, endEdit)}><FolderInput size={20} aria-hidden /><span>Move</span></button>
          <button type="button" disabled={!selected.size} onClick={() => { void setPinned(selectedNotes, !allSelected).then(endEdit) }}>
            {allSelected ? <PinOff size={20} aria-hidden /> : <Pin size={20} aria-hidden />}<span>{allSelected ? 'Unpin' : 'Pin'}</span>
          </button>
          <span className="m-notes-editbar-count" aria-live="polite">{selected.size ? `${selected.size} Selected` : 'Select Notes'}</span>
          <button type="button" disabled={!selected.size} onClick={() => { void shareNotes(selectedNotes) }}><Share2 size={20} aria-hidden /><span>Share</span></button>
          <button type="button" className="is-destructive" disabled={!selected.size} onClick={() => { void trash(selectedNotes).then(endEdit) }}><Trash2 size={20} aria-hidden /><span>Delete</span></button>
        </div>
      ) : !editing && (
        <div className={`m-notes-float${searching ? ' is-searching' : ''}`}>
          <label className="m-notes-searchfield">
            <Search size={17} aria-hidden />
            <input ref={searchRef} type="search" enterKeyHint="search" placeholder="Search Notes" value={query} aria-label="Search notes and folders"
              onFocus={() => setSearchFocused(true)} onBlur={() => setSearchFocused(false)} onChange={(e) => setQuery(e.target.value)} />
            {query && <button type="button" className="m-notes-search-clear" aria-label="Clear search" onMouseDown={(e) => e.preventDefault()} onClick={() => setQuery('')}><X size={14} aria-hidden /></button>}
          </label>
          {searching
            ? <button type="button" className="m-notes-float-cancel" onMouseDown={(e) => e.preventDefault()} onClick={cancelSearch}>Cancel</button>
            : !isSystemLocation(loc) && <button type="button" className="m-notes-compose" aria-label={userFolderNode ? `New note in ${userFolderNode.folder.name}` : 'New note'} onClick={() => { void create() }}><SquarePen size={22} aria-hidden /></button>}
        </div>
      )}
      {peek && <NotePeek note={peek.note} anchor={peek.rect} actions={peekActions(peek.note)} onOpen={() => open(peek.note)} onClose={closePeek} />}
    </Page>
  )
}

const groupingOptions = NOTE_GROUPING_OPTIONS.map((o) => (o.id === 'none' ? { ...o, label: 'By date', detail: 'Today, Previous 7 Days, months' } : o))

function SectionHeader({ id, title, count, collapsed, onToggle }: { id: string; title: string; count: number; collapsed: boolean; onToggle: (id: string) => void }) {
  return (
    <h2 className="m-notes-section-title">
      <button type="button" aria-expanded={!collapsed} onClick={() => onToggle(id)} aria-label={`${title}, ${count}. ${collapsed ? 'Show' : 'Hide'}`}>
        <span>{title}</span>
        {collapsed && <span className="m-notes-section-count">{count}</span>}
        <ChevronDown size={15} aria-hidden className={`m-notes-section-chevron${collapsed ? ' is-collapsed' : ''}`} />
      </button>
    </h2>
  )
}
