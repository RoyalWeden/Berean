import { useMemo, useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react'
import { ExternalLink, ArrowUpRight, Clock, Pin, FileText, Printer, ChevronUp, ChevronDown } from 'lucide-react'
import type { Note, NoteFolder } from '@/types'
import { isSystemNote } from '@/lib/noteUtils'
import { noteStatusMeta } from '@/lib/noteStatus'
import NoteEditor from './pm/NoteEditorPM'
import type { FindMode } from './pm/findHighlight'
import { folderPathFor } from './NotesFolderView'
import { Button, IconButton, SectionHeader, EmptyState, ListRow, ControlGroup, Chip } from '@/components/ui'

// ── Small local helpers ───────────────────────────────────────────────────────

function timeAgo(ts: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000))
  if (s < 60) return 'just now'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 7) return `${d}d ago`
  const w = Math.floor(d / 7)
  if (w < 5) return `${w}w ago`
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function fullDate(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

/** [[Title]] references to this note, elsewhere. */
function findBacklinks(noteTitle: string, allNotes: Note[], noteId: string): Note[] {
  if (!noteTitle.trim()) return []
  const escaped = noteTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`\\[\\[${escaped}\\]\\]`, 'i')
  return allNotes.filter((n) => n.id !== noteId && re.test(n.content ?? ''))
}

function byRecent(a: Note, b: Note) { return b.updatedAt - a.updatedAt }

const NOOP = () => {}

// ── Row used in the dashboard / folder lists ──────────────────────────────────

function NoteRow({ note, onPreview, onOpen }: { note: Note; onPreview: (n: Note) => void; onOpen: (n: Note) => void }) {
  const meta = noteStatusMeta(note.status)
  return (
    <ListRow
      flush
      leading={<FileText size={14} />}
      title={note.title?.trim() || 'Untitled'}
      meta={<span className="inline-flex items-center gap-1">
        {meta && <meta.icon size={12} style={{ color: meta.color }} />}
        {timeAgo(note.updatedAt)}
      </span>}
      onClick={() => onPreview(note)}
      onDoubleClick={() => onOpen(note)}
      trailing={<IconButton icon={ArrowUpRight} label="Open in editor" size={20} variant="ghost" onClick={() => onOpen(note)} />}
    />
  )
}

// ── Props ────────────────────────────────────────────────────────────────────

interface Props {
  /** The note currently previewed (single-clicked in the list). Null → folder or dashboard. */
  note: Note | null
  /** The folder currently selected in folder view, when no note is previewed. */
  folder: NoteFolder | null
  allNotes: Note[]
  folders: NoteFolder[]
  onPreview: (note: Note) => void
  onOpen: (note: Note) => void
  onOpenNewTab: (note: Note) => void
  onPrint: (note: Note) => void
  /** Live query from the "Search notes…" box — also highlighted inside the previewed note. */
  searchQuery: string
  searchWordMode: FindMode
}

export default function NotesHomePanel({
  note, folder, allNotes, folders, onPreview, onOpen, onOpenNewTab, onPrint, searchQuery, searchWordMode,
}: Props) {
  const userNotes = useMemo(() => allNotes.filter((n) => !isSystemNote(n)), [allNotes])
  const recent = useMemo(() => [...userNotes].sort(byRecent).slice(0, 10), [userNotes])
  const pinned = useMemo(() => userNotes.filter((n) => n.pinned).sort(byRecent), [userNotes])
  const inProgress = useMemo(() => userNotes.filter((n) => n.status === 'in-progress').sort(byRecent), [userNotes])

  const backlinks = useMemo(
    () => (note ? findBacklinks(note.title ?? '', allNotes, note.id) : []),
    [note, allNotes],
  )
  const folderPath = useMemo(() => (note ? folderPathFor(note, folders) : []), [note, folders])

  // ── In-preview search — highlight the "Search notes…" query inside the previewed note,
  //    with a match count + up/down nav in the header (jumps to the first match on change). ──
  const previewBodyRef = useRef<HTMLDivElement>(null)
  const [matchCount, setMatchCount] = useState(0)
  const [matchIdx, setMatchIdx] = useState(0)
  const q = searchQuery.trim()

  useEffect(() => {
    if (!note || !q) { setMatchCount(0); setMatchIdx(0); return }
    // The editor remounts per note (key) then applies the query via a prop effect — give it a
    // couple of frames to paint the decorations, then a late re-count for the async content set.
    let raf1 = 0, raf2 = 0
    const recount = () => {
      const marks = previewBodyRef.current?.querySelectorAll('.berean-find-mark')
      setMatchCount(marks ? marks.length : 0)
      setMatchIdx(0)
    }
    raf1 = requestAnimationFrame(() => { raf2 = requestAnimationFrame(recount) })
    const t = setTimeout(recount, 140)
    return () => { cancelAnimationFrame(raf1); cancelAnimationFrame(raf2); clearTimeout(t) }
  }, [note?.id, q, searchWordMode])

  useLayoutEffect(() => {
    const marks = previewBodyRef.current?.querySelectorAll<HTMLElement>('.berean-find-mark')
    if (!marks || marks.length === 0) return
    const idx = Math.min(matchIdx, marks.length - 1)
    marks.forEach((m, i) => m.classList.toggle('berean-find-mark-active', i === idx))
    marks[idx]?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [matchIdx, matchCount])

  const stepMatch = useCallback((dir: 1 | -1) => {
    setMatchIdx((i) => (matchCount === 0 ? 0 : (i + dir + matchCount) % matchCount))
  }, [matchCount])

  const wrap = 'flex min-w-[16rem] flex-1 flex-col overflow-hidden bg-surface-3'

  // ── Note preview — the real editor in read-only ('view') mode, so it renders exactly
  //    like the note does when open, just non-editable. ───────────────────────────────
  if (note) {
    const tags = note.tags ?? []
    return (
      <div className={wrap}>
        <div className="flex-shrink-0 border-b border-separator px-5 py-3">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              {folderPath.length > 0 && (
                <div className="mb-0.5 truncate text-caption2 text-text-muted">
                  {folderPath.join(' / ')}
                </div>
              )}
              <div className="truncate text-title3 font-semibold text-text-primary">
                {note.title?.trim() || 'Untitled'}
              </div>
            </div>
            <Button variant="primary" size="sm" icon={ExternalLink} iconTrailing onClick={() => onOpen(note)}>
              Open in editor
            </Button>
            <ControlGroup>
              <IconButton icon={Printer} label="Print / export PDF" size={28} onClick={() => onPrint(note)} />
              <IconButton icon={ExternalLink} label="Open in new tab" size={28} onClick={() => onOpenNewTab(note)} />
            </ControlGroup>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-caption2 text-text-muted">
            <span>Edited {timeAgo(note.updatedAt)}</span>
            <span>Created {fullDate(note.createdAt)}</span>
            {backlinks.length > 0 && <span>{backlinks.length} backlink{backlinks.length === 1 ? '' : 's'}</span>}
            {tags.map((t) => (
              <Chip key={t} static size="sm">#{t}</Chip>
            ))}
          </div>
          {q && (
            <div className="mt-1.5 flex items-center gap-1.5 text-caption2 text-text-muted">
              <span className="tabular-nums">
                {matchCount === 0 ? 'No matches for' : `${matchIdx + 1} / ${matchCount} ·`}
              </span>
              <span className="max-w-[40%] truncate text-text-secondary">“{q}”</span>
              <span>in this note</span>
              <ControlGroup>
                <IconButton icon={ChevronUp} label="Previous match" size={20} disabled={matchCount === 0} onClick={() => stepMatch(-1)} />
                <IconButton icon={ChevronDown} label="Next match" size={20} disabled={matchCount === 0} onClick={() => stepMatch(1)} />
              </ControlGroup>
            </div>
          )}
        </div>

        <div ref={previewBodyRef} className="flex-1 min-h-0 flex flex-col">
          <NoteEditor
            key={note.id}
            content={note.content}
            noteId={note.id}
            onChange={NOOP}
            mode="view"
            findQuery={q}
            findMode={searchWordMode}
            notes={allNotes}
            onWikilinkClick={(title) => {
              const target = allNotes.find((n) => (n.title || 'Untitled').toLowerCase() === title.toLowerCase())
              if (target) onPreview(target)
            }}
          />
        </div>
      </div>
    )
  }

  // ── Folder context ────────────────────────────────────────────────────────
  if (folder) {
    const inFolder = userNotes.filter((n) => n.folderId === folder.id)
    const fInProgress = inFolder.filter((n) => n.status === 'in-progress').length
    const fRecent = [...inFolder].sort(byRecent).slice(0, 12)
    const fTags = Array.from(new Set(inFolder.flatMap((n) => n.tags ?? []))).slice(0, 12)
    return (
      <div className={wrap}>
        <div className="flex-shrink-0 border-b border-separator px-5 py-3">
          <div className="text-title3 font-semibold text-text-primary">{folder.name}</div>
          <div className="mt-1 flex flex-wrap gap-x-3 text-caption2 text-text-muted">
            <span>{inFolder.length} note{inFolder.length === 1 ? '' : 's'}</span>
            {fInProgress > 0 && <span>{fInProgress} in progress</span>}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-3 py-2">
          {fRecent.length === 0
            ? <EmptyState compact title="No notes in this folder yet." />
            : (
              <>
                <SectionHeader className="pt-3">Recently edited</SectionHeader>
                {fRecent.map((n) => <NoteRow key={n.id} note={n} onPreview={onPreview} onOpen={onOpen} />)}
              </>
            )}
          {fTags.length > 0 && (
            <>
              <SectionHeader className="pt-3">Tags in this folder</SectionHeader>
              <div className="flex flex-wrap gap-1 px-2 py-1">
                {fTags.map((t) => (
                  <Chip key={t} static size="sm">#{t}</Chip>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    )
  }

  // ── Dashboard (nothing selected) — no header/action row, just the lists ──────
  return (
    <div className={wrap}>
      <div className="flex-1 overflow-y-auto px-3 py-2">
        {inProgress.length > 0 && (
          <>
            <SectionHeader className="pt-3" count={inProgress.length}>
              <span className="inline-flex items-center gap-1"><Clock size={10} className="text-info" /> In progress</span>
            </SectionHeader>
            {inProgress.slice(0, 6).map((n) => <NoteRow key={n.id} note={n} onPreview={onPreview} onOpen={onOpen} />)}
          </>
        )}
        {pinned.length > 0 && (
          <>
            <SectionHeader className="pt-3">
              <span className="inline-flex items-center gap-1"><Pin size={10} /> Pinned</span>
            </SectionHeader>
            {pinned.slice(0, 6).map((n) => <NoteRow key={n.id} note={n} onPreview={onPreview} onOpen={onOpen} />)}
          </>
        )}
        <SectionHeader className="pt-3">Recently edited</SectionHeader>
        {recent.length === 0
          ? <EmptyState compact title="No notes yet — create one to get started." />
          : recent.map((n) => <NoteRow key={n.id} note={n} onPreview={onPreview} onOpen={onOpen} />)}
      </div>
    </div>
  )
}
