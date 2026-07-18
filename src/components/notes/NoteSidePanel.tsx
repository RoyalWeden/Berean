import { useMemo } from 'react'
import { List, Link2, ChevronRight, Folder, PanelRight, Pin } from 'lucide-react'
import type { Note } from '@/types'
import { useAppStore } from '@/store'
import FloatingHoverPanel from '@/components/shell/FloatingHoverPanel'

// ── Heading parsing ────────────────────────────────────────────────────────────

interface Heading {
  level: number   // 1-6
  text: string
}

function parseHeadings(content: string): Heading[] {
  const headings: Heading[] = []
  for (const line of content.split('\n')) {
    const m = line.match(/^(#{1,6})\s+(.+)$/)
    if (m) headings.push({ level: m[1].length, text: m[2].trim() })
  }
  return headings
}

// ── Backlink detection ─────────────────────────────────────────────────────────

function findBacklinks(noteTitle: string, allNotes: Note[], noteId: string): Note[] {
  if (!noteTitle.trim()) return []
  const escaped = noteTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = new RegExp(`\\[\\[${escaped}\\]\\]`, 'i')
  return allNotes.filter(n => n.id !== noteId && pattern.test(n.content ?? ''))
}

// ── Props ──────────────────────────────────────────────────────────────────────

interface Props {
  content: string
  noteTitle: string
  noteId: string
  allNotes: Note[]
  onNoteClick: (note: Note) => void
  folderPath?: string[]
}

const EXPANDED_WIDTH = 320
const EXPANDED_HEIGHT = 440

export default function NoteSidePanel({ content, noteTitle, noteId, allNotes, onNoteClick, folderPath = [] }: Props) {
  const headings = useMemo(() => parseHeadings(content), [content])
  const backlinks = useMemo(() => findBacklinks(noteTitle, allNotes, noteId), [noteTitle, allNotes, noteId])
  const hasContent = headings.length > 0 || backlinks.length > 0

  const pinned    = useAppStore((s) => s.noteSidePanelPinned)
  const setPinned = useAppStore((s) => s.setNoteSidePanelPinned)

  function scrollToHeading(text: string) {
    window.dispatchEvent(new CustomEvent('berean:scrollToHeading', { detail: { headingText: text } }))
  }

  return (
    <FloatingHoverPanel
      expandedWidth={EXPANDED_WIDTH}
      expandedHeight={EXPANDED_HEIGHT}
      pinned={pinned}
      collapsedContent={
        <div className="relative flex items-center justify-center w-full h-full">
          <PanelRight size={12} className="text-[rgb(var(--color-text-muted))]" />
          {pinned && <span className="absolute -top-1.5 -right-1.5 w-2.5 h-2.5 rounded-full bg-[rgb(var(--color-accent))] border border-[rgb(var(--color-surface-2))]" />}
        </div>
      }
      cornerBadge={
        // Pin button — fills solid accent when pinned, otherwise a plain
        // outline, so pinned state reads clearly at a glance. Rendered in
        // FloatingHoverPanel's OUTER (unclipped) layer so it can float
        // partly outside the card's own rounded corner without being cropped.
        <button
          onClick={() => setPinned(!pinned)}
          title={pinned ? 'Unpin — hide when not hovered' : 'Pin — keep this open'}
          className={`absolute -top-2 -right-2 z-10 p-1 rounded-full shadow-md transition-colors cursor-pointer ${
            pinned
              ? 'bg-[rgb(var(--color-accent))] text-white border border-transparent'
              : 'bg-[rgb(var(--color-surface-2))] border border-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-text-primary))]'
          }`}
        >
          <Pin size={11} />
        </button>
      }
    >
      <div className="overflow-y-auto flex-1 px-2.5 py-3 flex flex-col gap-2.5 text-[11px]">
        {folderPath.length > 0 && (
          <div className="rounded-shell-lg border border-[rgb(var(--color-surface-4))] bg-[rgb(var(--color-surface-3))] overflow-hidden">
            <div className="flex items-center gap-1.5 px-2.5 py-1.5 text-[9px] font-semibold uppercase tracking-widest text-[rgb(var(--color-text-muted))]">
              <Folder size={9} />
              Folder
            </div>
            <div className="px-2.5 pb-2">
              <span className="inline-flex items-center gap-1 flex-wrap rounded-full bg-[rgb(var(--color-surface-4))] px-2.5 py-1 text-[10px] text-[rgb(var(--color-text-secondary))]">
                {folderPath.map((seg, i) => (
                  <span key={i} className="flex items-center gap-1">
                    {i > 0 && <ChevronRight size={8} className="text-[rgb(var(--color-text-muted))]" />}
                    <span className="truncate max-w-[110px]">{seg}</span>
                  </span>
                ))}
              </span>
            </div>
          </div>
        )}

        {headings.length > 0 && (
          <div className="rounded-shell-lg border border-[rgb(var(--color-surface-4))] bg-[rgb(var(--color-surface-3))] overflow-hidden">
            <div className="flex items-center gap-1.5 px-2.5 py-1.5 text-[9px] font-semibold uppercase tracking-widest text-[rgb(var(--color-text-muted))]">
              <List size={9} />
              Contents
              <span className="ml-auto rounded-full bg-[rgb(var(--color-surface-4))] px-1.5 py-0 text-[9px] text-[rgb(var(--color-text-secondary))]">{headings.length}</span>
            </div>
            <div className="px-1.5 pb-1.5 flex flex-col gap-0.5">
              {headings.map((h, i) => (
                <button
                  key={i}
                  onClick={() => scrollToHeading(h.text)}
                  className="flex items-center gap-1.5 w-full text-left px-1.5 py-1 rounded-shell text-[rgb(var(--color-text-secondary))] hover:text-[rgb(var(--color-text-primary))] hover:bg-[rgb(var(--color-surface-4))] transition-colors cursor-pointer truncate leading-snug"
                  style={{
                    paddingLeft: `calc(6px + ${(h.level - 1) * 10}px)`,
                    fontWeight: h.level === 1 ? 600 : 400,
                    opacity: h.level >= 4 ? 0.65 : 1,
                    fontSize: '10px',
                  }}
                  title={h.text}
                >
                  <span className="w-[3px] h-[3px] rounded-[1px] bg-[rgb(var(--color-text-muted))] flex-shrink-0" />
                  {h.text}
                </button>
              ))}
            </div>
          </div>
        )}

        {backlinks.length > 0 && (
          <div className="rounded-shell-lg border border-[rgb(var(--color-surface-4))] bg-[rgb(var(--color-surface-3))] overflow-hidden">
            <div className="flex items-center gap-1.5 px-2.5 py-1.5 text-[9px] font-semibold uppercase tracking-widest text-[rgb(var(--color-text-muted))]">
              <Link2 size={9} />
              Backlinks
              <span className="ml-auto rounded-full bg-[rgb(var(--color-surface-4))] px-1.5 py-0 text-[9px] text-[rgb(var(--color-text-secondary))]">{backlinks.length}</span>
            </div>
            <div className="px-1.5 pb-1.5 flex flex-col gap-0.5">
              {backlinks.map((note) => (
                <button
                  key={note.id}
                  onClick={() => onNoteClick(note)}
                  className="flex items-center gap-1.5 w-full text-left px-1.5 py-1 rounded-shell text-[rgb(var(--color-text-secondary))] hover:text-[rgb(var(--color-text-primary))] hover:bg-[rgb(var(--color-surface-4))] transition-colors cursor-pointer truncate leading-snug"
                  style={{ fontSize: '10px' }}
                  title={note.title || 'Untitled'}
                >
                  <span className="w-[3px] h-[3px] rounded-full bg-[rgb(var(--color-text-muted))] flex-shrink-0" />
                  {note.title || 'Untitled'}
                </button>
              ))}
            </div>
          </div>
        )}

        {!hasContent && folderPath.length === 0 && (
          <div className="rounded-shell-lg border border-dashed border-[rgb(var(--color-surface-4))] px-2.5 py-3 text-[rgb(var(--color-text-muted))] opacity-60 leading-snug">
            <div className="text-[9px] uppercase tracking-widest mb-1 font-semibold">Contents</div>
            <div style={{ fontSize: '10px' }}>No headings yet</div>
          </div>
        )}
      </div>
    </FloatingHoverPanel>
  )
}
