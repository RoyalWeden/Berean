import React, { useCallback, useEffect, useRef, useState } from 'react'
import { MoreHorizontal, Eye, Pencil } from 'lucide-react'
import type { Note, NoteFolder, NoteVersion } from '@/types'
import { useAppStore } from '@/store'
import NoteEditorPM from '@/components/notes/pm/NoteEditorPM'
import { resolveBookToken, getTranslationForBook, type ParsedRef } from '@/lib/parseRef'
import { navigateToVerse } from '@/lib/verseNavigation'
import { NOTE_STATUSES } from '@/lib/noteStatus'
import { parseRef } from '@/lib/parseRef'
import { copyVerse, copyVerseRef } from '@/lib/verseClipboard'
import { useLongPress } from '../primitives/useLongPress'
import { Page, IconTap, ListSection, Row } from '../primitives/Page'
import { useSheets } from '../primitives/Sheet'
import { useActionSheet } from '../primitives/ActionSheet'
import { useNavigation } from '../navigation/NavigationStack'
import { haptic } from '../primitives/haptics'
import { StrongsSheet } from '../study/StrongsSheet'
import PrintPreviewModal from '@/components/notes/PrintPreviewModal'
import { EMOJI_CATEGORIES, ALL_EMOJI } from '@/lib/emojiList'
import { noteToMarkdownFile, noteFileName } from '@/lib/noteMarkdownFile'

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
  const [printOpen, setPrintOpen] = useState(false)
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
  // Long-press on a scripture / Strong's reference inside the note (R037): the desktop
  // right-click menu's actions (open, copy verse(s), copy reference, open in new tab) as an
  // action sheet. WKWebView fires no `contextmenu` for a press, so the press is detected here.
  const refLongPress = useLongPress((e) => {
    const target = e.target as HTMLElement | null
    const verseEl = target?.closest('.pm-verse-ref, .pm-lxx-ref, .pm-verse-block-ref') as HTMLElement | null
    if (verseEl) {
      const raw = (verseEl.getAttribute('data-ref') || verseEl.textContent || '').trim()
      const isLxx = verseEl.getAttribute('data-lxx') === 'true' || verseEl.classList.contains('pm-lxx-ref')
      const parsed = parseRef(raw.replace(/^(?:lxx|LXX):/i, '').replace(/\s+LXX$/i, '').trim())
      if (!parsed) return
      void haptic.medium()
      const ref = isLxx ? { ...parsed, forcedTranslation: 'LXX' } : parsed
      const textId = isLxx ? 'lxx' : (getTranslationForBook(parsed.bookId) ?? useAppStore.getState().defaultBibleTranslation ?? 'kjva')
      actions('note-ref', raw, [
        { id: 'open', label: 'Open verse', onSelect: () => openVerse(ref) },
        { id: 'copy', label: parsed.endVerse && parsed.verse && parsed.endVerse > parsed.verse ? 'Copy verses' : 'Copy verse', onSelect: () => {
          void (async () => {
            const from = parsed.verse ?? 1, to = parsed.endVerse ?? parsed.verse ?? from
            const refs = Array.from({ length: to - from + 1 }, (_, i) => ({ bookId: parsed.bookId, chapter: parsed.chapter, verse: from + i }))
            const map = await window.bible.queryVerses(refs, textId).catch(() => ({} as Record<string, { text: string }>))
            const text = refs.map((r) => map[`${r.bookId}.${r.chapter}.${r.verse}`]?.text ?? '').filter(Boolean).join(' ')
            if (text) copyVerse(parsed.bookId, parsed.chapter, from, text, isLxx, to > from ? to : undefined)
          })()
        } },
        { id: 'ref', label: 'Copy reference', onSelect: () => copyVerseRef(parsed.bookId, parsed.chapter, parsed.verse ?? 1, isLxx, parsed.endVerse) },
        { id: 'newtab', label: 'Open in new tab', onSelect: () => { const st = useAppStore.getState(); st.createTab('bible'); openVerse(ref) } },
      ])
      return
    }
    const lexEl = target?.closest('.pm-lexicon-ref, .pm-lexicon-block-ref') as HTMLElement | null
    if (lexEl) {
      const id = (lexEl.getAttribute('data-strongs-id') || lexEl.textContent || '').trim().toUpperCase()
      if (!id) return
      void haptic.medium()
      actions('note-strongs', id, [
        { id: 'open', label: "Open Strong's entry", onSelect: () => openLexicon(id) },
        { id: 'copy', label: 'Copy number', onSelect: () => { navigator.clipboard.writeText(id).catch(() => {}) } },
        { id: 'lexicon', label: 'Open in Lexicon space', onSelect: () => { useAppStore.getState().openLexiconEntry(id, { noteId, title: latest.current?.title ?? '' }) } },
      ])
    }
  })
  const openLexicon = useCallback((strongsId: string) => {
    sheets.open({ id: 'strongs', detents: [0.38, 0.92], render: (api) => <StrongsSheet strongsNum={strongsId} api={api} onNavigate={() => setActiveSpace('scripture')} /> })
  }, [sheets, setActiveSpace])

  // A YouTube video tab open (its player stays mounted while this page shows — MobileApp parks
  // the space) → the timestamp action asks the player for its position (berean:requestTimestamp
  // → YouTubeTab → berean:insertTimestamp → NoteEditorPM).
  const ytVideoOpen = useAppStore((s) => { const t = s.tabs.youtube.find((x) => x.id === s.activeTabId.youtube) ?? s.tabs.youtube[0]; return !!(t?.state as { videoId?: string | null } | undefined)?.videoId })
  const openActions = () => {
    const n = latest.current
    if (!n) return
    actions('note-actions', n.title || 'Untitled', [
      { id: 'pin', label: n.pinned ? 'Unpin' : 'Pin', onSelect: () => { window.notes.setNotePinned(n.id, !n.pinned).then(() => { latest.current = { ...n, pinned: !n.pinned }; setNote(latest.current); bumpNoteToken() }) } },
      { id: 'status', label: `Status${n.status ? ` (${NOTE_STATUSES.find((s) => s.id === n.status)?.label ?? n.status})` : ''}…`, onSelect: () => actions('note-status', 'Status', [
        { id: 'none', label: 'No status', onSelect: () => persist({ status: null }) },
        ...NOTE_STATUSES.map((s) => ({ id: s.id, label: s.label, onSelect: () => persist({ status: s.id }) })),
      ]) },
      { id: 'icon', label: n.icon ? `Icon (${n.icon})…` : 'Icon…', onSelect: () => sheets.open({ id: 'note-icon', title: 'Note icon', detents: [0.7, 0.92], render: (api) => <IconPicker current={n.icon ?? null} onPick={(emoji) => { persist({ icon: emoji }); void haptic.light(); api.close() }} /> }) },
      { id: 'folder', label: 'Move to folder…', onSelect: () => sheets.open({ id: 'note-folder', title: 'Folder', detents: [0.6, 0.92], render: (api) => <FolderPicker current={n.folderId ?? null} onPick={(id) => { window.notes.setNoteFolder(n.id, id).then(() => { latest.current = { ...n, folderId: id }; setNote(latest.current); bumpNoteToken(); api.close() }) }} /> }) },
      { id: 'versions', label: 'Version history…', onSelect: () => nav.push(`versions-${n.id}`, <VersionsPage noteId={n.id} onBack={nav.pop} onRestored={(content) => { latest.current = { ...(latest.current ?? n), content }; setNote(latest.current); bumpNoteToken() }} />) },
      ...(ytVideoOpen ? [{ id: 'timestamp', label: 'Insert video timestamp', onSelect: () => { setMode('edit'); window.dispatchEvent(new CustomEvent('berean:requestTimestamp')); void haptic.light() } }] : []),
      { id: 'copy', label: 'Copy as Markdown', onSelect: () => { navigator.clipboard.writeText(`# ${n.title}\n\n${n.content}`).catch(() => {}); void haptic.light() } },
      { id: 'print', label: 'Print / Export PDF…', onSelect: () => setPrintOpen(true) },
      { id: 'share', label: 'Share…', onSelect: () => { void shareNote(n) } },
      { id: 'export-md', label: 'Export Markdown file…', onSelect: () => { void exportNoteFile(n) } },
      { id: 'trash', label: 'Move to trash', destructive: true, onSelect: () => { window.notes.deleteNote(n.id).then(() => { bumpNoteToken(); onBack() }) } },
    ])
  }

  if (note === undefined) return <Page title="Note" onBack={onBack}><div className="mobile-empty">Loading…</div></Page>
  if (note === null) return <Page title="Note" onBack={onBack}><div className="mobile-empty">This note no longer exists.</div></Page>
  return (
    <Page
      noScroll
      onBack={onBack}
      title={<span className="mobile-title-wrap">{note.icon && <span className="mobile-note-icon" aria-hidden>{note.icon}</span>}<input className="mobile-title-input" value={note.title} placeholder="Untitled" aria-label="Note title" onChange={(e) => persist({ title: e.target.value })} /></span>}
      right={<><IconTap icon={mode === 'edit' ? Eye : Pencil} label={mode === 'edit' ? 'View' : 'Edit'} onClick={() => setMode((m) => (m === 'edit' ? 'view' : 'edit'))} /><IconTap icon={MoreHorizontal} label="Note actions" onClick={openActions} /></>}
    >
      {printOpen && <PrintPreviewModal title={note.title || 'Untitled'} content={note.content} notes={notes} onClose={() => setPrintOpen(false)} />}
      <div className="mobile-note-editor" {...refLongPress}>
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

/** R099: the note as a vault-format `.md` file handed to the share sheet (Save to Files, AirDrop, …). */
async function exportNoteFile(n: Note): Promise<void> {
  try {
    const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem')
    const { Share } = await import('@capacitor/share')
    const path = `exports/${noteFileName(n)}`
    const w = await Filesystem.writeFile({ path, directory: Directory.Cache, data: noteToMarkdownFile(n), encoding: Encoding.UTF8, recursive: true })
    await Share.share({ title: n.title || 'Note', files: [w.uri] })
  } catch { /* share cancelled or unavailable */ }
}

/** The desktop NoteIconPicker's emoji set (src/lib/emojiList.ts) as a sheet: search + categories. */
function IconPicker({ current, onPick }: { current: string | null; onPick: (emoji: string | null) => void }) {
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()
  const matches = q ? ALL_EMOJI.filter((e) => e.keywords.some((k) => k.includes(q)) || e.char === q).slice(0, 80) : null
  return (
    <div className="mobile-icon-picker">
      <input className="mobile-search-input" type="search" placeholder="Search emoji" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search emoji" />
      {current && <button type="button" className="mobile-link-button" onClick={() => onPick(null)}>Remove icon {current}</button>}
      {matches ? (
        <div className="mobile-emoji-grid">{matches.map((e) => <button key={e.char} type="button" aria-label={e.keywords[0] ?? e.char} onClick={() => onPick(e.char)}>{e.char}</button>)}</div>
      ) : EMOJI_CATEGORIES.map((c) => (
        <div key={c.label}>
          <div className="mobile-option-label">{c.label}</div>
          <div className="mobile-emoji-grid">{c.emoji.map((e) => <button key={e.char} type="button" aria-label={e.keywords[0] ?? e.char} onClick={() => onPick(e.char)}>{e.char}</button>)}</div>
        </div>
      ))}
    </div>
  )
}
