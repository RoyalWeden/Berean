import React, { useCallback, useEffect, useState } from 'react'
import { useCaretCommands, fromSheetActions } from '../commands/caretRegistry'
import { MoreHorizontal, Eye, Pencil, Pin, PinOff, CircleDot, Smile, FolderInput, History, Clock, Copy, Printer, Share2, FileDown, Trash2 } from 'lucide-react'
import type { Note, NoteVersion } from '@/types'
import { useAppStore } from '@/store'
import NoteEditorPM from '@/components/notes/pm/NoteEditorPM'
import { resolveBookToken, getTranslationForBook, type ParsedRef } from '@/lib/parseRef'
import { openDestination, type NavIntent } from '@/lib/navigation/destination'
import { NOTE_STATUSES } from '@/lib/noteStatus'
import { parseRef } from '@/lib/parseRef'
import { copyVerse, copyVerseRef } from '@/lib/verseClipboard'
import { useLongPress } from '../primitives/useLongPress'
import { Page, IconTap, ListSection, Row } from '../primitives/Page'
import { useSheets, type SheetApi } from '../primitives/Sheet'
import { useActionSheet, ChoiceList } from '../primitives/ActionSheet'
import { useNavigation } from '../navigation/NavigationStack'
import { FolderPicker } from './FolderPicker'
import { CaretGoTo } from '../commands/CaretGoTo'
import { noteIsMovable } from '@/lib/noteMovability'
import { haptic } from '../primitives/haptics'
import { StrongsSheet } from '../study/StrongsSheet'
import PrintPreviewModal from '@/components/notes/PrintPreviewModal'
import { EMOJI_CATEGORIES, ALL_EMOJI } from '@/lib/emojiList'
import { noteToMarkdownFile, noteFileName } from '@/lib/noteMarkdownFile'
import { verseRefDisplay } from '@/lib/parseRef'
import { useNoteAutosave } from './useNoteAutosave'
import type { EditorView } from 'prosemirror-view'
import { BarChart3 } from 'lucide-react'
import { computeWordStats } from '@/lib/wordCount'
import { NoteInsertButton } from './NoteInsertButton'
import { renderPhoneSelectionToolbar, noteStatsLine, showVerseContextLine } from './phoneEditorChrome'

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
  const { note, latest, persist, replace, lastSavedAt, editorContent, deferredWhileComposing } = useNoteAutosave(noteId)
  const [notes, setNotes] = useState<Note[]>([])
  const [mode, setMode] = useState<'edit' | 'view'>('edit')
  const [printOpen, setPrintOpen] = useState(false)
  // The live editor (NoteEditorPM onEditorReady) — the + menu runs its commands, the caret reads
  // its statistics. Never used to push content back into the editor.
  const [editorView, setEditorView] = useState<EditorView | null>(null)
  const typingLook = useAppStore((s) => s.noteTypingLook)
  const bumpNoteToken = useAppStore((s) => s.bumpNoteToken)
  const setActiveSpace = useAppStore((s) => s.setActiveSpace)

  useEffect(() => {
    let alive = true
    window.notes.getNotes(500, 0).then((all) => { if (alive) setNotes(all) }).catch(() => {})
    return () => { alive = false }
  }, [noteId])

  // A verse link changes THIS tab (NAV-002): the note tab becomes Scripture with a "← note" pill,
  // and ‹ returns to the note. (It used to jump to — or create — another Scripture tab.)
  const openVerse = useCallback((ref: ParsedRef & { forcedTranslation?: string }, intent: NavIntent = 'current-tab') => {
    const s = useAppStore.getState()
    const translation = ref.forcedTranslation ?? getTranslationForBook(ref.bookId) ?? s.defaultBibleTranslation
    const title = latest.current?.title ?? ''
    openDestination({ kind: 'passage', bookId: ref.bookId, chapter: ref.chapter, verse: ref.verse, endVerse: ref.endVerse ?? null, textId: translation.toLowerCase(), noteBack: { noteId, title } },
      intent, { origin: { kind: 'note-wikilink', noteId, noteTitle: title } })
  }, [noteId])
  const openWikilink = useCallback((title: string) => {
    const target = title.replace(/\|.*$/, '').trim()
    const m = target.match(/^(?:verse\s+notes[/\s]+)?([A-Za-z0-9\s]+)\s*[:.](\d+)(?:[:.](\d+))?/i)
    if (m) { const bookId = resolveBookToken(m[1].trim()); if (bookId) return openVerse({ bookId, chapter: parseInt(m[2]), verse: m[3] ? parseInt(m[3]) : undefined }) }
    // Opening another note is a step of this tab's history (SEP25): the Notes space replaces the
    // editor and records it, so ‹ returns here.
    const found = notes.find((n) => (n.title || '').toLowerCase() === target.toLowerCase())
    if (found) useAppStore.getState().requestOpenNote(found.id)
    else void window.notes.createNote({ type: 'general', title: target, content: '' }).then((r) => { if (r.success && r.note) { bumpNoteToken(); useAppStore.getState().requestOpenNote(r.note.id) } })
  }, [notes, openVerse, bumpNoteToken])
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
        { id: 'newtab', label: 'Open in new tab', onSelect: () => openVerse(ref, 'new-tab') },
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
        { id: 'lexicon', label: 'Open in Lexicon', onSelect: () => { openDestination({ kind: 'strongs', num: id }, 'current-tab') } },
      ])
    }
  })
  const openLexicon = useCallback((strongsId: string) => {
    sheets.open({ id: 'strongs', detents: [0.38, 0.92], render: (api) => <StrongsSheet strongsNum={strongsId} api={api} /> })
  }, [sheets, setActiveSpace])

  // A YouTube video tab open (its player stays mounted while this page shows — MobileApp parks
  // the space) → the timestamp action asks the player for its position (berean:requestTimestamp
  // → YouTubeTab → berean:insertTimestamp → NoteEditorPM).
  const ytVideoOpen = useAppStore((s) => { const t = s.tabs.youtube.find((x) => x.id === s.activeTabId.youtube) ?? s.tabs.youtube[0]; return !!(t?.state as { videoId?: string | null } | undefined)?.videoId })
  const actionList = () => {
    const n = latest.current
    if (!n) return []
    return [
      { id: 'pin', label: n.pinned ? 'Unpin' : 'Pin', icon: n.pinned ? PinOff : Pin, onSelect: () => { window.notes.setNotePinned(n.id, !n.pinned).then(() => { replace({ ...n, pinned: !n.pinned }); bumpNoteToken() }) } },
      // Status, icon and folder open INSIDE the caret ("‹ <note>") — T23-006.
      { id: 'status', label: 'Status', icon: CircleDot, value: n.status ? (NOTE_STATUSES.find((s) => s.id === n.status)?.label ?? n.status) : 'None', onSelect: () => {},
        view: () => ({ title: 'Status', render: (api: SheetApi) => <ChoiceList api={api} value={latest.current?.status ?? 'none'} options={[{ id: 'none', label: 'No status' }, ...NOTE_STATUSES.map((s) => ({ id: s.id, label: s.label }))]} onSelect={(id) => persist({ status: id === 'none' ? null : (id as NonNullable<Note['status']>) })} /> }) },
      { id: 'icon', label: 'Icon', icon: Smile, value: n.icon ?? undefined, onSelect: () => {},
        view: () => ({ title: 'Note icon', render: (api: SheetApi) => <IconPicker current={latest.current?.icon ?? null} onPick={(emoji) => { persist({ icon: emoji }); void haptic.light(); api.pop() }} /> }) },
      // Only notes that live in a user folder can move (T23-030; same rule as desktop).
      ...(noteIsMovable(n) ? [{ id: 'folder', label: 'Move to folder', icon: FolderInput, onSelect: () => {},
        view: () => ({ title: 'Folder', render: (api: SheetApi) => <FolderPicker current={latest.current?.folderId ?? null} onPick={(id) => { window.notes.setNoteFolder(n.id, id).then(() => { replace({ ...(latest.current ?? n), folderId: id }); bumpNoteToken(); api.pop() }) }} /> }) }] : []),
      { id: 'versions', label: 'Version history…', icon: History, onSelect: () => nav.push(`versions-${n.id}`, <VersionsPage noteId={n.id} onBack={nav.pop} onRestored={(content) => { replace({ ...(latest.current ?? n), content }); bumpNoteToken() }} />) },
      ...(ytVideoOpen ? [{ id: 'timestamp', label: 'Insert video timestamp', icon: Clock, onSelect: () => { setMode('edit'); window.dispatchEvent(new CustomEvent('berean:requestTimestamp')); void haptic.light() } }] : []),
      { id: 'copy', label: 'Copy as Markdown', icon: Copy, onSelect: () => { navigator.clipboard.writeText(`# ${n.title}\n\n${n.content}`).catch(() => {}); void haptic.light() } },
      { id: 'print', label: 'Print / Export PDF…', icon: Printer, onSelect: () => setPrintOpen(true) },
      { id: 'share', label: 'Share…', icon: Share2, onSelect: () => { void shareNote(n) } },
      { id: 'export-md', label: 'Export Markdown file…', icon: FileDown, onSelect: () => { void exportNoteFile(n) } },
      { id: 'trash', label: 'Move to trash', icon: Trash2, destructive: true, onSelect: () => { window.notes.deleteNote(n.id).then(() => { bumpNoteToken(); onBack() }) } },
    ]
  }
  // The note's caret (TEST-033): the former "…" note actions, the frequent ones as tiles.
  useCaretCommands(() => ({
    title: latest.current?.title || 'Untitled note',
    subtitle: 'Note',
    // Same header as every caret (SEP24-008): this note / find another, and the tab's ‹ › history.
    location: { label: latest.current?.title || 'Untitled note', placeholder: 'Search Berean', view: () => ({ title: 'Search', render: (a: SheetApi) => <CaretGoTo api={a} /> }) },
    sections: [
      ...fromSheetActions(actionList(), { tiles: ['pin', 'share', 'copy', 'print'], tileLabels: { copy: 'Copy', print: 'Print / PDF', share: 'Share' }, title: 'Note' }),
      // Word count / characters / reading time live here, not on the editor surface (TEST25-NOTES-003).
      { id: 'stats', commands: [{ kind: 'action', id: 'stats', label: 'Statistics', icon: BarChart3, keepOpen: true, run: () => {},
        detail: noteStatsLine(computeWordStats(editorView && !editorView.isDestroyed ? editorView.state.doc.textBetween(0, editorView.state.doc.content.size, '\n', '\n') : latest.current?.content ?? '')) }] },
    ],
  }), note != null)

  if (note === undefined) return <Page title="Note" onBack={onBack}><div className="mobile-empty">Loading…</div></Page>
  if (note === null) return <Page title="Note" onBack={onBack}><div className="mobile-empty">This note no longer exists.</div></Page>
  return (
    <Page
      noScroll
      onBack={onBack}
      title={<span className="mobile-title-wrap">{note.icon && <span className="mobile-note-icon" aria-hidden>{note.icon}</span>}<input className="mobile-title-input" value={note.title} placeholder="Untitled" aria-label="Note title" onChange={(e) => persist({ title: e.target.value })} /></span>}
      right={<><IconTap icon={mode === 'edit' ? Eye : Pencil} label={mode === 'edit' ? 'View' : 'Edit'} onClick={() => setMode((m) => (m === 'edit' ? 'view' : 'edit'))} /></>}
    >
      {printOpen && <PrintPreviewModal title={note.title || 'Untitled'} content={note.content} notes={notes} onClose={() => setPrintOpen(false)} />}
      <div className="mobile-note-editor" {...refLongPress}>
        {note.verseRef && showVerseContextLine(note.title, verseRefDisplay(note.verseRef, note.textId)) && <div className="mobile-note-meta">{verseRefDisplay(note.verseRef, note.textId)}</div>}
        <NoteEditorPM
          content={editorContent}
          noteId={note.id}
          onExternalDeferred={deferredWhileComposing}
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
          chrome="phone"
          renderSelectionToolbar={renderPhoneSelectionToolbar}
          onEditorReady={setEditorView}
        />
        <NoteInsertButton view={editorView} hidden={mode !== 'edit'} />
      </div>
    </Page>
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
