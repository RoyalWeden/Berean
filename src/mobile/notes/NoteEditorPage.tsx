import React, { useCallback, useEffect, useRef, useState } from 'react'
import { MoreHorizontal, Eye, Pencil } from 'lucide-react'
import type { Note, NoteFolder, NoteVersion } from '@/types'
import { useAppStore } from '@/store'
import NoteEditorPM from '@/components/notes/pm/NoteEditorPM'
import { resolveBookToken, getTranslationForBook, type ParsedRef } from '@/lib/parseRef'
import { navigateToVerse } from '@/lib/verseNavigation'
import { NOTE_STATUSES } from '@/lib/noteStatus'
import { Page, IconTap, ListSection, Row } from '../primitives/Page'
import { useSheets } from '../primitives/Sheet'
import { useActionSheet } from '../primitives/ActionSheet'
import { useNavigation } from '../navigation/NavigationStack'
import { haptic } from '../primitives/haptics'
import { StrongsSheet } from '../study/StrongsSheet'

const SAVE_DEBOUNCE_MS = 500
const SNAPSHOT_IDLE_MS = 2 * 60 * 1000

/**
 * Note editor page (Phase 13, R084): the shared ProseMirror editor (`NoteEditorPM`) full-screen,
 * with the desktop save semantics — debounced `updateNote`, a version snapshot after two idle
 * minutes and when leaving, `bumpNoteToken` so every other view refreshes — and phone
 * presentation: title in the header, edit/view toggle, actions sheet (pin, status, folder, copy
 * as markdown, versions, share, move to trash). Verse refs navigate the reader, Strong's refs open
 * the Strong's sheet, wikilinks open the note by title.
 */
export function NoteEditorPage({ noteId, onBack }: { noteId: string; onBack: () => void }) {
  const nav = useNavigation()
  const sheets = useSheets()
  const actions = useActionSheet()
  const [note, setNote] = useState<Note | null | undefined>(undefined)
  const [notes, setNotes] = useState<Note[]>([])
  const [mode, setMode] = useState<'edit' | 'view'>('edit')
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const snapshotTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastSnapshot = useRef<string | null>(null)
  const latest = useRef<Note | null>(null)
  const typingLook = useAppStore((s) => s.noteTypingLook)
  const bumpNoteToken = useAppStore((s) => s.bumpNoteToken)
  const setActiveSpace = useAppStore((s) => s.setActiveSpace)

  useEffect(() => {
    let alive = true
    window.notes.getNote(noteId).then((n) => { if (alive) { setNote(n); latest.current = n; lastSnapshot.current = n?.content ?? null } }).catch(() => { if (alive) setNote(null) })
    window.notes.getNotes(500, 0).then((all) => { if (alive) setNotes(all) }).catch(() => {})
    return () => { alive = false }
  }, [noteId])

  const snapshot = useCallback((kind: string) => {
    const n = latest.current
    if (!n || lastSnapshot.current === n.content) return
    lastSnapshot.current = n.content
    window.notes.createNoteVersion(n.id, n.title || '', n.content, kind).catch(() => {})
  }, [])

  type Patch = Partial<Omit<Note, 'status' | 'icon'>> & { status?: Note['status'] | null; icon?: string | null }
  const persist = useCallback((patch: Patch) => {
    const n = latest.current
    if (!n) return
    const updated = { ...n, ...patch, status: patch.status === null ? undefined : (patch.status ?? n.status), icon: patch.icon === null ? undefined : (patch.icon ?? n.icon), updatedAt: Date.now() } as Note
    latest.current = updated
    setNote(updated)
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null
      window.notes.updateNote(n.id, patch).then(() => { setLastSavedAt(Date.now()); bumpNoteToken() }).catch(() => {})
    }, SAVE_DEBOUNCE_MS)
    if ('content' in patch) {
      if (snapshotTimer.current) clearTimeout(snapshotTimer.current)
      snapshotTimer.current = setTimeout(() => snapshot('auto'), SNAPSHOT_IDLE_MS)
    }
  }, [bumpNoteToken, snapshot])

  // Flush on leave / background: never lose the last keystrokes.
  useEffect(() => {
    const flush = () => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current); saveTimer.current = null
        const n = latest.current
        if (n) window.notes.updateNote(n.id, { title: n.title, content: n.content }).then(() => bumpNoteToken()).catch(() => {})
      }
      snapshot('auto')
    }
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', flush)
    return () => { window.removeEventListener('pagehide', flush); document.removeEventListener('visibilitychange', flush); flush(); if (snapshotTimer.current) clearTimeout(snapshotTimer.current) }
  }, [bumpNoteToken, snapshot])

  const openVerse = useCallback((ref: ParsedRef & { forcedTranslation?: string }) => {
    const s = useAppStore.getState()
    s.setActiveSpace('scripture')
    s.ensureTab('bible')
    const tabId = useAppStore.getState().activeTabId.scripture
    const translation = ref.forcedTranslation ?? getTranslationForBook(ref.bookId) ?? s.defaultBibleTranslation
    if (tabId) s.updateTabState('scripture', tabId, { translation: translation.toUpperCase() })
    navigateToVerse({ bookId: ref.bookId, chapter: ref.chapter, verse: ref.verse, endVerse: ref.endVerse ?? null, origin: { kind: 'note-wikilink', noteId, noteTitle: latest.current?.title ?? '' } })
  }, [noteId])
  const openWikilink = useCallback((title: string) => {
    const target = title.replace(/\|.*$/, '').trim()
    const m = target.match(/^(?:verse\s+notes[/\s]+)?([A-Za-z0-9\s]+)\s*[:.](\d+)(?:[:.](\d+))?/i)
    if (m) { const bookId = resolveBookToken(m[1].trim()); if (bookId) return openVerse({ bookId, chapter: parseInt(m[2]), verse: m[3] ? parseInt(m[3]) : undefined }) }
    const found = notes.find((n) => (n.title || '').toLowerCase() === target.toLowerCase())
    if (found) nav.push(`note-${found.id}`, <NoteEditorPage noteId={found.id} onBack={nav.pop} />)
    else void window.notes.createNote({ type: 'general', title: target, content: '' }).then((r) => { if (r.success && r.note) { bumpNoteToken(); nav.push(`note-${r.note.id}`, <NoteEditorPage noteId={r.note.id} onBack={nav.pop} />) } })
  }, [notes, nav, openVerse, bumpNoteToken])
  const openLexicon = useCallback((strongsId: string) => {
    sheets.open({ id: 'strongs', detents: [0.38, 0.92], render: (api) => <StrongsSheet strongsNum={strongsId} api={api} onNavigate={() => setActiveSpace('scripture')} /> })
  }, [sheets, setActiveSpace])

  const openActions = () => {
    const n = latest.current
    if (!n) return
    actions('note-actions', n.title || 'Untitled', [
      { id: 'pin', label: n.pinned ? 'Unpin' : 'Pin', onSelect: () => { window.notes.setNotePinned(n.id, !n.pinned).then(() => { latest.current = { ...n, pinned: !n.pinned }; setNote(latest.current); bumpNoteToken() }) } },
      { id: 'status', label: `Status${n.status ? ` (${NOTE_STATUSES.find((s) => s.id === n.status)?.label ?? n.status})` : ''}…`, onSelect: () => actions('note-status', 'Status', [
        { id: 'none', label: 'No status', onSelect: () => persist({ status: null }) },
        ...NOTE_STATUSES.map((s) => ({ id: s.id, label: s.label, onSelect: () => persist({ status: s.id }) })),
      ]) },
      { id: 'folder', label: 'Move to folder…', onSelect: () => sheets.open({ id: 'note-folder', title: 'Folder', detents: [0.6, 0.92], render: (api) => <FolderPicker current={n.folderId ?? null} onPick={(id) => { window.notes.setNoteFolder(n.id, id).then(() => { latest.current = { ...n, folderId: id }; setNote(latest.current); bumpNoteToken(); api.close() }) }} /> }) },
      { id: 'versions', label: 'Version history…', onSelect: () => nav.push(`versions-${n.id}`, <VersionsPage noteId={n.id} onBack={nav.pop} onRestored={(content) => { latest.current = { ...(latest.current ?? n), content }; setNote(latest.current); bumpNoteToken() }} />) },
      { id: 'copy', label: 'Copy as Markdown', onSelect: () => { navigator.clipboard.writeText(`# ${n.title}\n\n${n.content}`).catch(() => {}); void haptic.light() } },
      { id: 'share', label: 'Share…', onSelect: () => { void shareNote(n) } },
      { id: 'trash', label: 'Move to trash', destructive: true, onSelect: () => { window.notes.deleteNote(n.id).then(() => { bumpNoteToken(); onBack() }) } },
    ])
  }

  if (note === undefined) return <Page title="Note" onBack={onBack}><div className="mobile-empty">Loading…</div></Page>
  if (note === null) return <Page title="Note" onBack={onBack}><div className="mobile-empty">This note no longer exists.</div></Page>
  return (
    <Page
      noScroll
      onBack={onBack}
      title={<input className="mobile-title-input" value={note.title} placeholder="Untitled" aria-label="Note title" onChange={(e) => persist({ title: e.target.value })} />}
      right={<><IconTap icon={mode === 'edit' ? Eye : Pencil} label={mode === 'edit' ? 'View' : 'Edit'} onClick={() => setMode((m) => (m === 'edit' ? 'view' : 'edit'))} /><IconTap icon={MoreHorizontal} label="Note actions" onClick={openActions} /></>}
    >
      <div className="mobile-note-editor">
        {note.verseRef && <div className="mobile-note-meta">{note.verseRef.replace(/\./g, ' ')}{note.textId ? ` · ${note.textId.toUpperCase()}` : ''}</div>}
        <NoteEditorPM
          content={note.content}
          noteId={note.id}
          onChange={(content) => persist({ content })}
          mode={mode}
          typingLook={typingLook}
          notes={notes}
          lastSavedAt={lastSavedAt}
          onWikilinkClick={openWikilink}
          onVerseRefClick={openVerse}
          onLexiconRefClick={openLexicon}
          placeholder="Write…"
          className="mobile-pm"
        />
      </div>
    </Page>
  )
}

function FolderPicker({ current, onPick }: { current: string | null; onPick: (id: string | null) => void }) {
  const [folders, setFolders] = useState<NoteFolder[]>([])
  useEffect(() => { window.notes.getFolders().then(setFolders).catch(() => setFolders([])) }, [])
  return (
    <ListSection>
      <Row title="No folder" right={current === null ? '✓' : undefined} onClick={() => onPick(null)} />
      {folders.map((f) => <Row key={f.id} title={f.name} right={current === f.id ? '✓' : undefined} onClick={() => onPick(f.id)} />)}
    </ListSection>
  )
}

function VersionsPage({ noteId, onBack, onRestored }: { noteId: string; onBack: () => void; onRestored: (content: string) => void }) {
  const [versions, setVersions] = useState<NoteVersion[]>([])
  useEffect(() => { window.notes.getNoteVersions(noteId).then(setVersions).catch(() => setVersions([])) }, [noteId])
  return (
    <Page title="Versions" onBack={onBack}>
      <ListSection>
        {versions.length === 0 && <div className="mobile-empty">No saved versions yet.</div>}
        {versions.map((v) => (
          <Row key={v.id} title={`${new Date(v.createdAt).toLocaleString()}`} subtitle={`${v.kind === 'conflict' ? 'Sync conflict copy · ' : v.kind === 'manual' ? 'Manual · ' : ''}${v.content.replace(/\s+/g, ' ').trim().slice(0, 80)}`} chevron
            onClick={() => { if (confirm('Restore this version? The current text is kept as a version.')) window.notes.restoreNoteVersion(noteId, v.id).then((r) => { if (r.success && typeof r.content === 'string') { onRestored(r.content); onBack() } }) }} />
        ))}
      </ListSection>
    </Page>
  )
}

async function shareNote(n: Note): Promise<void> {
  const text = `# ${n.title}\n\n${n.content}`
  try {
    const { Share } = await import('@capacitor/share')
    await Share.share({ title: n.title || 'Note', text })
  } catch {
    try { await navigator.clipboard.writeText(text) } catch { /* ignore */ }
  }
}
