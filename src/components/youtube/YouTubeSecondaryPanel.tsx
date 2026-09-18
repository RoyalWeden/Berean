/**
 * YouTubeSecondaryPanel — renders panelA or panelB content in a YouTube tab.
 * Each type (notes / scripture / lexicon) is self-contained with its own
 * search / empty state and a back button to return to content selection.
 *
 * Console logging is prefixed with [yt-panel].
 */

import { useState, useEffect, useRef } from 'react'
import { X, ExternalLink, ChevronLeft, ChevronRight, ArrowLeft, Search } from 'lucide-react'
import ChapterView from '@/components/bible/ChapterView'
import NoteEditor from '@/components/notes/pm/NoteEditorPM'
import { useAppStore } from '@/store'
import { getTranslationForBook, normalizeBookName } from '@/lib/parseRef'
import { Button, IconButton, SearchField, Toolbar, ListRow } from '@/components/ui'
import type { YouTubePanelState, Note, LexiconEntry } from '@/types'

// ── Notes panel ──────────────────────────────────────────────────────────────

function NotePanel({ panel, onUpdate, onBack, onClose }: {
  panel: YouTubePanelState; onUpdate: (p: YouTubePanelState) => void; onBack: () => void; onClose?: () => void
}) {
  const noteId = panel.noteId ?? null
  const [note, setNote] = useState<Note | null>(null)
  const [search, setSearch] = useState('')
  const [results, setResults] = useState<Array<{ id: string; title: string }>>([])

  // Load the selected note
  useEffect(() => {
    if (!noteId) { setNote(null); return }
    window.notes.getNote(noteId).then(setNote).catch(() => {})
  }, [noteId])

  // Search / recent when no note selected
  useEffect(() => {
    if (noteId) return
    const q = search.trim()
    const p = q ? window.notes.searchNotes(q, 20) : window.notes.getNotes(20, 0)
    p.then((ns) => setResults(ns.map((n) => ({ id: n.id, title: n.title || 'Untitled' })))).catch(() => {})
  }, [search, noteId])

  function openInTab() {
    if (!noteId) return
    const store = useAppStore.getState()
    // ensureTab first — requestOpenNote's pending value is picked up by
    // whichever Notes tab is active at that moment.
    store.ensureTab('note'); store.requestOpenNote(noteId); store.setActiveSpace('notes')
  }

  // Empty / search state
  if (!noteId) {
    return (
      <div className="flex flex-col h-full overflow-hidden bg-surface-3">
        <PanelHeader title="Notes" onBack={onBack} onClose={onClose} />
        <div className="px-2 py-2 border-b border-separator">
          <SearchField autoFocus value={search} onValueChange={setSearch} placeholder="Search notes…" />
        </div>
        <div className="flex-1 overflow-y-auto p-1">
          {results.map((n) => (
            <ListRow key={n.id} dense title={n.title} onClick={() => { onUpdate({ ...panel, noteId: n.id }) }} />
          ))}
          {results.length === 0 && <div className="text-footnote text-text-muted px-2.5 py-3">No notes found</div>}
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full overflow-hidden bg-surface-3">
      <PanelHeader title={note?.title || 'Untitled'} onBack={onBack} onClose={onClose}
        extra={<IconButton icon={ExternalLink} label="Open in notes tab" size={24} onClick={openInTab} />} />
      <div className="flex-1 overflow-hidden min-h-0">
        {note && (
          <NoteEditor
            content={note.content}
            onChange={() => {}}
            mode="view"
            autoFocus={false}
            onVerseRefClick={(ref) => {
              const store = useAppStore.getState()
              store.ensureTab('bible')
              const scriptureTabId = useAppStore.getState().activeTabId['scripture']
              if (!scriptureTabId) return
              const translationOverride = ref.forcedTranslation ?? getTranslationForBook(ref.bookId)
              useAppStore.getState().updateTabState('scripture', scriptureTabId, {
                bookId: ref.bookId, chapter: ref.chapter, targetVerse: ref.verse, scrollPosition: 0,
                ...(translationOverride ? { translation: translationOverride.toUpperCase() } : {}),
              })
            }}
            onWikilinkClick={(title) => {
              window.notes.getNotes(100000, 0).then((notes) => {
                const target = notes.find((n) => (n.title || 'Untitled').toLowerCase() === title.toLowerCase())
                if (target) { useAppStore.getState().ensureTab('note'); useAppStore.getState().requestOpenNote(target.id) }
              }).catch(() => {})
            }}
            onLexiconRefClick={(strongsId) => {
              const store = useAppStore.getState()
              // ensureTab first — openLexiconEntry's pending value is picked
              // up by whichever Lexicon tab is active at that moment.
              store.ensureTab('lexicon')
              store.openLexiconEntry(strongsId, { noteId: note.id, title: note.title || 'Untitled' })
            }}
          />
        )}
      </div>
    </div>
  )
}

// ── Scripture panel ───────────────────────────────────────────────────────────

function ScripturePanel({ panel, onUpdate, onBack, onClose }: {
  panel: YouTubePanelState; onUpdate: (p: YouTubePanelState) => void; onBack: () => void; onClose?: () => void
}) {
  const defaultTranslation = useAppStore((s) => s.defaultBibleTranslation)
  const hasBook = !!panel.bookId
  const translation = panel.translation ?? defaultTranslation.toUpperCase()
  const [books, setBooks] = useState<{ id: string; name: string; chapters_count: number }[]>([])
  const [bookSearch, setBookSearch] = useState('')

  useEffect(() => {
    window.bible.getBooks(translation.toLowerCase())
      .then((b) => setBooks((b as { id: string; name: string; chapters_count: number }[]).map((bk) => ({ ...bk, name: normalizeBookName(bk.name) }))))
      .catch(() => {})
  }, [translation])

  const currentBook = books.find((b) => b.id === panel.bookId)
  const chapter = panel.chapter ?? 1

  function setChapter(c: number) { onUpdate({ ...panel, chapter: c }) }
  function prevChapter() {
    if (chapter > 1) { setChapter(chapter - 1); return }
    const idx = books.findIndex((b) => b.id === panel.bookId)
    if (idx > 0) { const p = books[idx - 1]; onUpdate({ ...panel, bookId: p.id, chapter: p.chapters_count }) }
  }
  function nextChapter() {
    if (currentBook && chapter < currentBook.chapters_count) { setChapter(chapter + 1); return }
    const idx = books.findIndex((b) => b.id === panel.bookId)
    if (idx < books.length - 1) { const n = books[idx + 1]; onUpdate({ ...panel, bookId: n.id, chapter: 1 }) }
  }
  function openInTab() {
    const store = useAppStore.getState()
    store.createTab('bible')
    const fresh = useAppStore.getState()
    const tabId = fresh.activeTabId['scripture']
    if (tabId) fresh.updateTabState('scripture', tabId, { bookId: panel.bookId ?? 'GEN', chapter, scrollPosition: 0, translation })
    store.setActiveSpace('scripture')
  }

  // Book picker (no book yet)
  if (!hasBook) {
    const filtered = bookSearch ? books.filter((b) => b.name.toLowerCase().includes(bookSearch.toLowerCase())) : books
    return (
      <div className="flex flex-col h-full overflow-hidden bg-surface-3">
        <PanelHeader title="Scripture" onBack={onBack} onClose={onClose} />
        <div className="px-2 py-2 border-b border-separator">
          <SearchField autoFocus value={bookSearch} onValueChange={setBookSearch} placeholder="Search books…" />
        </div>
        <div className="flex-1 overflow-y-auto p-1">
          {filtered.map((b) => (
            <ListRow key={b.id} dense title={b.name} onClick={() => onUpdate({ ...panel, bookId: b.id, chapter: 1, translation })} />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full overflow-hidden bg-surface-3">
      <PanelHeader
        title={`${currentBook?.name ?? panel.bookId} ${chapter}`}
        onBack={onBack} onClose={onClose}
        leftExtra={
          <>
            <IconButton icon={ChevronLeft} label="Previous chapter" size={24} onClick={prevChapter} />
            <IconButton icon={ChevronRight} label="Next chapter" size={24} onClick={nextChapter} />
          </>
        }
        extra={
          <>
            <Button variant="ghost" size="sm" onClick={() => onUpdate({ ...panel, bookId: null })}>Book</Button>
            <IconButton icon={ExternalLink} label="Open in scripture tab" size={24} onClick={openInTab} />
          </>
        } />
      <div className="flex-1 overflow-y-auto min-h-0 text-sm">
        <ChapterView bookId={panel.bookId!} chapter={chapter} showStrongs={false} textId={translation.toLowerCase()} />
      </div>
    </div>
  )
}

// ── Lexicon panel ─────────────────────────────────────────────────────────────

function LexiconPanel({ panel, onUpdate, onBack, onClose }: {
  panel: YouTubePanelState; onUpdate: (p: YouTubePanelState) => void; onBack: () => void; onClose?: () => void
}) {
  const strongsNum = panel.strongsNum ?? null
  const [entry, setEntry] = useState<LexiconEntry | null>(null)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Array<{ strongsNum: string; lemma: string; gloss: string }>>([])

  useEffect(() => {
    if (!strongsNum) { setEntry(null); return }
    window.lexicon.getEntry(strongsNum).then(setEntry).catch(() => {})
  }, [strongsNum])

  useEffect(() => {
    if (strongsNum) return
    if (!query.trim()) { setResults([]); return }
    window.lexicon.search(query, 'all').then((rs) => setResults(rs.slice(0, 30).map((r) => ({ strongsNum: r.strongsNum, lemma: r.lemma, gloss: r.gloss })))).catch(() => {})
  }, [query, strongsNum])

  function openInTab() {
    if (!strongsNum) return
    const store = useAppStore.getState()
    // ensureTab first — openLexiconEntry's pending value is picked up by
    // whichever Lexicon tab is active at that moment.
    store.ensureTab('lexicon')
    store.openLexiconEntry(strongsNum)
    store.setActiveSpace('lexicon')
  }

  if (!strongsNum) {
    return (
      <div className="flex flex-col h-full overflow-hidden bg-surface-3">
        <PanelHeader title="Lexicon" onBack={onBack} onClose={onClose} />
        <div className="px-2 py-2 border-b border-separator">
          <SearchField autoFocus value={query} onValueChange={setQuery} placeholder="H7225, G3056, or keyword…" />
        </div>
        <div className="flex-1 overflow-y-auto p-1">
          {results.map((r) => (
            <ListRow key={r.strongsNum} dense
              title={<><span className="font-semibold text-accent">{r.strongsNum}</span> {r.lemma} — {r.gloss}</>}
              onClick={() => onUpdate({ ...panel, strongsNum: r.strongsNum })}
            />
          ))}
          {query && results.length === 0 && <div className="text-footnote text-text-muted px-2.5 py-3">No results</div>}
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full overflow-hidden bg-surface-3">
      <PanelHeader title={entry ? `${entry.strongsNum} ${entry.lemma}` : 'Lexicon'} onBack={onBack} onClose={onClose}
        extra={
          <>
            <IconButton icon={Search} label="Search again" size={24} onClick={() => onUpdate({ ...panel, strongsNum: null })} />
            <IconButton icon={ExternalLink} label="Open in lexicon tab" size={24} onClick={openInTab} />
          </>
        } />
      <div className="flex-1 overflow-y-auto min-h-0 p-3">
        {entry && (
          <div className="space-y-3">
            <div><span className="text-title2 font-medium text-text-primary font-lemma">{entry.lemma}</span><span className="ml-2 text-footnote text-text-muted">{entry.transliteration}</span></div>
            <div className="text-footnote font-semibold text-accent">{entry.strongsNum}</div>
            <div className="text-subhead text-text-secondary font-medium">{entry.gloss}</div>
            {entry.definition && <div className="text-footnote text-text-secondary leading-relaxed whitespace-pre-wrap">{entry.definition}</div>}
            {entry.derivation && <div className="text-footnote text-text-muted italic">{entry.derivation}</div>}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Shared header ─────────────────────────────────────────────────────────────

function PanelHeader({ title, onBack, onClose, extra, leftExtra }: {
  title: string; onBack: () => void; onClose?: () => void; extra?: React.ReactNode; leftExtra?: React.ReactNode
}) {
  return (
    <Toolbar size="sm">
      <IconButton icon={ArrowLeft} label="Back to panel type" size={24} onClick={onBack} />
      {leftExtra}
      <span className="flex-1 min-w-0 text-footnote font-medium text-text-primary truncate text-center">{title}</span>
      {extra}
      {onClose && <IconButton icon={X} label="Close panel" size={24} danger onClick={onClose} />}
    </Toolbar>
  )
}

// ── Main export ───────────────────────────────────────────────────────────────

interface Props {
  panel: YouTubePanelState
  onUpdate: (p: YouTubePanelState) => void
  onBack: () => void   // return to type picker
  onClose?: () => void
  label?: string
}

export default function YouTubeSecondaryPanel({ panel, onUpdate, onBack, onClose, label = 'panel' }: Props) {
  if (panel.type === 'notes')     return <NotePanel panel={panel} onUpdate={onUpdate} onBack={onBack} onClose={onClose} />
  if (panel.type === 'scripture') {
    // Apply book-specific translation override if the book requires one (e.g. LXX)
    const withTr = panel.translation ? panel : { ...panel, translation: (getTranslationForBook(panel.bookId ?? 'GEN') ?? useAppStore.getState().defaultBibleTranslation).toUpperCase() }
    return <ScripturePanel panel={withTr} onUpdate={onUpdate} onBack={onBack} onClose={onClose} />
  }
  if (panel.type === 'lexicon')   return <LexiconPanel panel={panel} onUpdate={onUpdate} onBack={onBack} onClose={onClose} />
  return null
}
