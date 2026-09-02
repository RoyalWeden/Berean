import { useMemo } from 'react'
import { FilePlus, CalendarPlus, ExternalLink, ArrowUpRight, Clock, Pin, FileText } from 'lucide-react'
import type { Note, NoteFolder } from '@/types'
import { isSystemNote } from '@/lib/noteUtils'
import { noteStatusMeta } from '@/lib/noteStatus'
import { renderPreviewContent } from '@/lib/notePreviewRender'
import { folderPathFor } from './NotesFolderView'

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

// ── Row used in every list on this panel ──────────────────────────────────────

function NoteRow({ note, onPreview, onOpen }: { note: Note; onPreview: (n: Note) => void; onOpen: (n: Note) => void }) {
  const meta = noteStatusMeta(note.status)
  return (
    <button
      onClick={() => onPreview(note)}
      onDoubleClick={() => onOpen(note)}
      className="group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-[rgb(var(--color-surface-4))] transition-colors cursor-pointer"
    >
      <FileText size={13} className="flex-shrink-0 text-[rgb(var(--color-text-muted))]" />
      <span className="min-w-0 flex-1 truncate text-[13px] text-[rgb(var(--color-text-primary))]">
        {note.title?.trim() || 'Untitled'}
      </span>
      {meta && <meta.icon size={11} className="flex-shrink-0" style={{ color: meta.color }} />}
      <span className="flex-shrink-0 text-[10px] text-[rgb(var(--color-text-muted))] tabular-nums">{timeAgo(note.updatedAt)}</span>
      <ArrowUpRight
        size={12}
        onClick={(e) => { e.stopPropagation(); onOpen(note) }}
        className="flex-shrink-0 opacity-0 group-hover:opacity-100 text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-text-primary))] transition-opacity"
      />
    </button>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-2 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-wide text-[rgb(var(--color-text-muted))]">
      {children}
    </div>
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
  onCreateNote: () => void
  onCreateDaily: () => void
}

export default function NotesHomePanel({
  note, folder, allNotes, folders, onPreview, onOpen, onOpenNewTab, onCreateNote, onCreateDaily,
}: Props) {
  const userNotes = useMemo(() => allNotes.filter((n) => !isSystemNote(n)), [allNotes])
  const recent = useMemo(() => [...userNotes].sort(byRecent).slice(0, 8), [userNotes])
  const pinned = useMemo(() => userNotes.filter((n) => n.pinned).sort(byRecent), [userNotes])
  const inProgress = useMemo(() => userNotes.filter((n) => n.status === 'in-progress').sort(byRecent), [userNotes])

  const backlinks = useMemo(
    () => (note ? findBacklinks(note.title ?? '', allNotes, note.id) : []),
    [note, allNotes],
  )
  const folderPath = useMemo(() => (note ? folderPathFor(note, folders) : []), [note, folders])
  // renderPreviewContent runs marked + several regex passes — memo so scrolling the list
  // (which re-renders this panel) doesn't re-parse the whole note body each time.
  const previewHtml = useMemo(
    () => (note?.content?.trim() ? renderPreviewContent(note.content) : ''),
    [note?.id, note?.content],
  )

  // No left border here — the list column to our left already draws a right border.
  const wrap = 'flex min-w-0 flex-1 flex-col overflow-hidden bg-[rgb(var(--color-surface-3))]'

  // ── Note preview ───────────────────────────────────────────────────────────
  if (note) {
    const tags = note.tags ?? []
    return (
      <div className={wrap}>
        <div className="flex-shrink-0 border-b border-[rgb(var(--color-surface-4))] px-5 py-3">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              {folderPath.length > 0 && (
                <div className="mb-0.5 truncate text-[10px] text-[rgb(var(--color-text-muted))]">
                  {folderPath.join(' / ')}
                </div>
              )}
              <div className="truncate text-[15px] font-semibold text-[rgb(var(--color-text-primary))]">
                {note.title?.trim() || 'Untitled'}
              </div>
            </div>
            <button
              onClick={() => onOpen(note)}
              className="flex flex-shrink-0 items-center gap-1 rounded-md bg-[rgb(var(--color-accent))/15] px-2 py-1 text-[11px] font-medium text-[rgb(var(--color-accent))] hover:bg-[rgb(var(--color-accent))/25] cursor-pointer transition-colors"
            >
              Open in editor <ArrowUpRight size={12} />
            </button>
            <button
              onClick={() => onOpenNewTab(note)}
              title="Open in new tab"
              className="flex-shrink-0 rounded-md p-1 text-[rgb(var(--color-text-muted))] hover:bg-[rgb(var(--color-surface-4))] hover:text-[rgb(var(--color-text-primary))] cursor-pointer transition-colors"
            >
              <ExternalLink size={13} />
            </button>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-[rgb(var(--color-text-muted))]">
            <span>Edited {timeAgo(note.updatedAt)}</span>
            <span>Created {fullDate(note.createdAt)}</span>
            {backlinks.length > 0 && <span>{backlinks.length} backlink{backlinks.length === 1 ? '' : 's'}</span>}
            {tags.map((t) => (
              <span key={t} className="rounded bg-[rgb(var(--color-surface-4))] px-1.5 py-0.5 text-[rgb(var(--color-text-secondary))]">#{t}</span>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {previewHtml
            ? <div className="berean-preview-prose" dangerouslySetInnerHTML={{ __html: previewHtml }} />
            : <div className="text-[13px] italic text-[rgb(var(--color-text-muted))]">This note is empty.</div>}

          {backlinks.length > 0 && (
            <div className="mt-6 border-t border-[rgb(var(--color-surface-4))] pt-3">
              <SectionLabel>Linked from</SectionLabel>
              {backlinks.slice(0, 8).map((n) => (
                <NoteRow key={n.id} note={n} onPreview={onPreview} onOpen={onOpen} />
              ))}
            </div>
          )}
        </div>
      </div>
    )
  }

  // ── Folder context ────────────────────────────────────────────────────────
  if (folder) {
    const inFolder = userNotes.filter((n) => n.folderId === folder.id)
    const fInProgress = inFolder.filter((n) => n.status === 'in-progress').length
    const fRecent = [...inFolder].sort(byRecent).slice(0, 10)
    const fTags = Array.from(new Set(inFolder.flatMap((n) => n.tags ?? []))).slice(0, 12)
    return (
      <div className={wrap}>
        <div className="flex-shrink-0 border-b border-[rgb(var(--color-surface-4))] px-5 py-3">
          <div className="text-[15px] font-semibold text-[rgb(var(--color-text-primary))]">{folder.name}</div>
          <div className="mt-1 flex flex-wrap gap-x-3 text-[10px] text-[rgb(var(--color-text-muted))]">
            <span>{inFolder.length} note{inFolder.length === 1 ? '' : 's'}</span>
            {fInProgress > 0 && <span>{fInProgress} in progress</span>}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-3 py-2">
          {fRecent.length === 0
            ? <div className="px-2 py-4 text-[13px] italic text-[rgb(var(--color-text-muted))]">No notes in this folder yet.</div>
            : (
              <>
                <SectionLabel>Recently edited</SectionLabel>
                {fRecent.map((n) => <NoteRow key={n.id} note={n} onPreview={onPreview} onOpen={onOpen} />)}
              </>
            )}
          {fTags.length > 0 && (
            <>
              <SectionLabel>Tags in this folder</SectionLabel>
              <div className="flex flex-wrap gap-1 px-2 py-1">
                {fTags.map((t) => (
                  <span key={t} className="rounded bg-[rgb(var(--color-surface-4))] px-1.5 py-0.5 text-[10px] text-[rgb(var(--color-text-secondary))]">#{t}</span>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    )
  }

  // ── Dashboard (nothing selected) ──────────────────────────────────────────
  return (
    <div className={wrap}>
      <div className="flex flex-shrink-0 items-center gap-2 border-b border-[rgb(var(--color-surface-4))] px-5 py-3">
        <button
          onClick={onCreateNote}
          className="flex items-center gap-1.5 rounded-md bg-[rgb(var(--color-accent))/15] px-2.5 py-1.5 text-[12px] font-medium text-[rgb(var(--color-accent))] hover:bg-[rgb(var(--color-accent))/25] cursor-pointer transition-colors"
        >
          <FilePlus size={13} /> New note
        </button>
        <button
          onClick={onCreateDaily}
          className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12px] text-[rgb(var(--color-text-secondary))] hover:bg-[rgb(var(--color-surface-4))] hover:text-[rgb(var(--color-text-primary))] cursor-pointer transition-colors"
        >
          <CalendarPlus size={13} /> Today's note
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-3 py-2">
        {inProgress.length > 0 && (
          <>
            <SectionLabel><span className="inline-flex items-center gap-1"><Clock size={10} className="text-[#60a5fa]" /> In progress · {inProgress.length}</span></SectionLabel>
            {inProgress.slice(0, 6).map((n) => <NoteRow key={n.id} note={n} onPreview={onPreview} onOpen={onOpen} />)}
          </>
        )}
        {pinned.length > 0 && (
          <>
            <SectionLabel><span className="inline-flex items-center gap-1"><Pin size={10} /> Pinned</span></SectionLabel>
            {pinned.slice(0, 6).map((n) => <NoteRow key={n.id} note={n} onPreview={onPreview} onOpen={onOpen} />)}
          </>
        )}
        <SectionLabel>Recently edited</SectionLabel>
        {recent.length === 0
          ? <div className="px-2 py-4 text-[13px] italic text-[rgb(var(--color-text-muted))]">No notes yet — create one to get started.</div>
          : recent.map((n) => <NoteRow key={n.id} note={n} onPreview={onPreview} onOpen={onOpen} />)}
      </div>
    </div>
  )
}
