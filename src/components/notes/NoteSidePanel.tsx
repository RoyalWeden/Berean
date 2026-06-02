import { useMemo, useState, useRef, useCallback } from 'react'
import { List, Link2, ChevronRight, ChevronLeft, Folder } from 'lucide-react'
import type { Note } from '@/types'

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

// ── Constants ──────────────────────────────────────────────────────────────────

const MIN_WIDTH = 120
const MAX_WIDTH = 360
const DEFAULT_WIDTH = 176   // w-44 equivalent

// ── Component ──────────────────────────────────────────────────────────────────

export default function NoteSidePanel({ content, noteTitle, noteId, allNotes, onNoteClick, folderPath = [] }: Props) {
  const headings = useMemo(() => parseHeadings(content), [content])
  const backlinks = useMemo(() => findBacklinks(noteTitle, allNotes, noteId), [noteTitle, allNotes, noteId])

  const [collapsed, setCollapsed]   = useState(false)
  const [width, setWidth]           = useState(DEFAULT_WIDTH)
  const resizeRef                   = useRef<{ startX: number; startWidth: number } | null>(null)

  function scrollToHeading(text: string) {
    window.dispatchEvent(new CustomEvent('berean:scrollToHeading', { detail: { headingText: text } }))
  }

  function indent(level: number): string {
    return `${(level - 1) * 10}px`
  }

  const hasContent = headings.length > 0 || backlinks.length > 0

  // ── Drag resize ────────────────────────────────────────────────────────────

  const handleResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    resizeRef.current = { startX: e.clientX, startWidth: width }

    function onMove(ev: MouseEvent) {
      if (!resizeRef.current) return
      // Dragging the left edge leftward → makes panel wider (panel is on the right)
      const delta = resizeRef.current.startX - ev.clientX
      const next = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, resizeRef.current.startWidth + delta))
      setWidth(next)
    }

    function onUp() {
      resizeRef.current = null
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [width])

  // ── Collapsed state ─────────────────────────────────────────────────────────

  if (collapsed) {
    return (
      <div
        className="flex-shrink-0 flex flex-col border-l border-[rgb(var(--color-surface-4))] bg-[rgb(var(--color-surface-2))]"
        style={{ width: 24 }}
      >
        <button
          onClick={() => setCollapsed(false)}
          title="Expand side panel"
          className="flex items-center justify-center w-full py-3 text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-text-primary))] transition-colors cursor-pointer"
        >
          <ChevronLeft size={12} />
        </button>
      </div>
    )
  }

  // ── Expanded state ──────────────────────────────────────────────────────────

  return (
    <div
      className="flex-shrink-0 flex flex-row border-l border-[rgb(var(--color-surface-4))] bg-[rgb(var(--color-surface-2))] overflow-hidden text-[11px] relative"
      style={{ width }}
    >
      {/* Drag-resize handle on the left edge */}
      <div
        className="flex-shrink-0 w-1 cursor-col-resize hover:bg-[rgb(var(--color-accent))/30] active:bg-[rgb(var(--color-accent))/50] transition-colors"
        onMouseDown={handleResizeMouseDown}
        title="Drag to resize"
      />

      {/* Main panel content */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        {/* Collapse toggle + title row */}
        <div className="flex items-center gap-1 px-2 pt-2 pb-1 flex-shrink-0">
          <span className="flex-1 text-[9px] font-semibold uppercase tracking-widest text-[rgb(var(--color-text-muted))]">
            Panel
          </span>
          <button
            onClick={() => setCollapsed(true)}
            title="Collapse side panel"
            className="p-0.5 rounded text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-text-primary))] hover:bg-[rgb(var(--color-surface-4))] transition-colors cursor-pointer"
          >
            <ChevronRight size={11} />
          </button>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto min-h-0">
          {/* Folder breadcrumb — where this note is filed */}
          {folderPath.length > 0 && (
            <div className="px-2 pt-1 pb-2">
              <div className="flex items-center gap-1.5 pb-1 text-[9px] font-semibold uppercase tracking-widest text-[rgb(var(--color-text-muted))]">
                <Folder size={9} />
                Folder
              </div>
              <div className="flex items-center flex-wrap gap-0.5 text-[10px] text-[rgb(var(--color-text-secondary))]">
                {folderPath.map((seg, i) => (
                  <span key={i} className="flex items-center gap-0.5">
                    {i > 0 && <ChevronRight size={9} className="text-[rgb(var(--color-text-muted))]" />}
                    <span className="truncate max-w-[120px]">{seg}</span>
                  </span>
                ))}
              </div>
            </div>
          )}
          {/* TOC section */}
          {headings.length > 0 && (
            <div>
              <div className="flex items-center gap-1.5 px-2 pt-1 pb-1 text-[9px] font-semibold uppercase tracking-widest text-[rgb(var(--color-text-muted))] sticky top-0 bg-[rgb(var(--color-surface-2))]">
                <List size={9} />
                Contents
              </div>
              <div className="pb-1">
                {headings.map((h, i) => (
                  <button
                    key={i}
                    onClick={() => scrollToHeading(h.text)}
                    className="block w-full text-left px-2 py-0.5 text-[rgb(var(--color-text-secondary))] hover:text-[rgb(var(--color-text-primary))] hover:bg-[rgb(var(--color-surface-4))] transition-colors cursor-pointer truncate leading-snug"
                    style={{
                      paddingLeft: `calc(8px + ${indent(h.level)})`,
                      fontWeight: h.level === 1 ? 600 : 400,
                      opacity: h.level >= 4 ? 0.65 : 1,
                      fontSize: '10px',
                    }}
                    title={h.text}
                  >
                    {h.text}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Backlinks section */}
          {backlinks.length > 0 && (
            <div>
              <div className="flex items-center gap-1.5 px-2 pt-2 pb-1 text-[9px] font-semibold uppercase tracking-widest text-[rgb(var(--color-text-muted))] sticky top-0 bg-[rgb(var(--color-surface-2))] border-t border-[rgb(var(--color-surface-4))] mt-1">
                <Link2 size={9} />
                Backlinks
              </div>
              <div className="pb-1">
                {backlinks.map((note) => (
                  <button
                    key={note.id}
                    onClick={() => onNoteClick(note)}
                    className="block w-full text-left px-2 py-0.5 text-[rgb(var(--color-text-secondary))] hover:text-[rgb(var(--color-text-primary))] hover:bg-[rgb(var(--color-surface-4))] transition-colors cursor-pointer truncate leading-snug"
                    style={{ fontSize: '10px' }}
                    title={note.title || 'Untitled'}
                  >
                    {note.title || 'Untitled'}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Empty state */}
          {!hasContent && (
            <div className="px-2 pt-3 text-[rgb(var(--color-text-muted))] opacity-50 leading-snug">
              <div className="text-[9px] uppercase tracking-widest mb-1 font-semibold">Contents</div>
              <div style={{ fontSize: '10px' }}>No headings yet</div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
