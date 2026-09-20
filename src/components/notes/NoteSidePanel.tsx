import { useMemo } from 'react'
import { List, Link2, ChevronRight, Folder, PanelRight, PanelRightClose } from 'lucide-react'
import type { Note } from '@/types'
import { useAppStore } from '@/store'
import DailyNoteEditsSection from './DailyNoteEditsSection'
import { dailyNoteDateKey } from '@/lib/noteUtils'
import { SectionLabel, SectionHeader, IconButton, ListRow, Divider, cx } from '@/components/ui'

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
  noteType?: string
  tabId?: string
  allNotes: Note[]
  onNoteClick: (note: Note) => void
  onOpenNewTab?: (note: Note) => void
  onOpenInFloatingTab?: (note: Note) => void
  folderPath?: string[]
}

// Attached-inspector width band — same 260-420 clamp as the Scripture side panel
// (BiblePanel.tsx's `panelSize`); this panel has no drag handle of its own yet, so
// it sits at a fixed width inside that band rather than exposing a resizer.
const PANEL_WIDTH = 320

export default function NoteSidePanel({ content, noteTitle, noteId, noteType, tabId, allNotes, onNoteClick, onOpenNewTab, onOpenInFloatingTab, folderPath = [] }: Props) {
  const headings = useMemo(() => parseHeadings(content), [content])
  const backlinks = useMemo(() => findBacklinks(noteTitle, allNotes, noteId), [noteTitle, allNotes, noteId])
  // Only set for daily/journal notes — drives the "Edited today" section below, matched
  // against THIS note's own date (not necessarily literal today, for a past daily note).
  const dailyDateKey = useMemo(
    () => dailyNoteDateKey({ id: noteId, title: noteTitle, type: noteType } as Note),
    [noteId, noteTitle, noteType]
  )
  const hasEditsToday = useMemo(() => {
    if (!dailyDateKey) return false
    return allNotes.some((n) => {
      if (n.id === noteId) return false
      const d = new Date(n.updatedAt)
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      return key === dailyDateKey
    })
  }, [allNotes, noteId, dailyDateKey])
  const hasContent = headings.length > 0 || backlinks.length > 0 || hasEditsToday

  const pinned    = useAppStore((s) => s.noteSidePanelPinned)
  const setPinned = useAppStore((s) => s.setNoteSidePanelPinned)

  function scrollToHeading(text: string) {
    window.dispatchEvent(new CustomEvent('berean:scrollToHeading', { detail: { headingText: text } }))
  }

  // Collapsed: a thin attached rail (still `material-inspector` — hairline-left, no radius/
  // blur/shadow) with just the toggle. Replaces the old hover-to-expand floating pill —
  // this is now a real dock, so it either takes its width or it doesn't.
  if (!pinned) {
    return (
      <div className="flex-shrink-0 h-full w-7 material-inspector flex flex-col items-center pt-2">
        <IconButton icon={PanelRight} label="Show outline & backlinks" size={24} onClick={() => setPinned(true)} />
      </div>
    )
  }

  return (
    <div className="flex-shrink-0 h-full material-inspector overflow-y-auto flex flex-col" style={{ width: PANEL_WIDTH }}>
      <div className="flex-shrink-0 flex items-center justify-between px-2.5 h-9 border-b border-separator-subtle">
        <SectionLabel>Outline</SectionLabel>
        <IconButton icon={PanelRightClose} label="Hide outline & backlinks" size={24} onClick={() => setPinned(false)} />
      </div>
      <div className="flex-1 overflow-y-auto px-1.5 py-2 flex flex-col gap-3 text-caption">
        {dailyDateKey && onOpenNewTab && onOpenInFloatingTab && (
          <DailyNoteEditsSection
            dateKey={dailyDateKey}
            dailyNoteId={noteId}
            allNotes={allNotes}
            onSelect={onNoteClick}
            onOpenNewTab={onOpenNewTab}
            onOpenInFloatingTab={onOpenInFloatingTab}
          />
        )}
        {folderPath.length > 0 && (
          <div>
            <SectionHeader flush className="px-1">
              <span className="inline-flex items-center gap-1.5"><Folder size={9} /> Folder</span>
            </SectionHeader>
            <div className="px-1 flex items-center gap-1 flex-wrap text-caption2 text-text-secondary">
              {folderPath.map((seg, i) => (
                <span key={i} className="flex items-center gap-1">
                  {i > 0 && <ChevronRight size={8} className="text-text-muted" />}
                  <span className="truncate max-w-[110px]">{seg}</span>
                </span>
              ))}
            </div>
          </div>
        )}

        {headings.length > 0 && (
          <div>
            <SectionHeader flush count={headings.length} className="px-1">
              <span className="inline-flex items-center gap-1.5"><List size={9} /> Contents</span>
            </SectionHeader>
            <div className="flex flex-col gap-0.5">
              {headings.map((h, i) => (
                <ListRow
                  key={i}
                  flush
                  dense
                  indent={8 + (h.level - 1) * 10}
                  onClick={() => scrollToHeading(h.text)}
                  leading={<span className="w-[3px] h-[3px] rounded-[1px] bg-text-muted" />}
                  title={<span className={cx(h.level === 1 ? 'font-semibold' : 'font-normal', h.level >= 4 && 'text-text-tertiary')}>{h.text}</span>}
                  titleSize="caption"
                  buttonProps={{ title: h.text }}
                />
              ))}
            </div>
          </div>
        )}

        {backlinks.length > 0 && (
          <div>
            <SectionHeader flush count={backlinks.length} className="px-1">
              <span className="inline-flex items-center gap-1.5"><Link2 size={9} /> Backlinks</span>
            </SectionHeader>
            <div className="flex flex-col gap-0.5">
              {backlinks.map((note) => (
                <ListRow
                  key={note.id}
                  flush
                  dense
                  onClick={() => onNoteClick(note)}
                  leading={<span className="w-[3px] h-[3px] rounded-full bg-text-muted" />}
                  title={note.title || 'Untitled'}
                  titleSize="caption"
                  buttonProps={{ title: note.title || 'Untitled' }}
                />
              ))}
            </div>
          </div>
        )}

        {!hasContent && folderPath.length === 0 && (
          <div className="px-1">
            <SectionLabel className="mb-1">Contents</SectionLabel>
            <Divider className="mb-2" />
            <div className="text-caption2 text-text-tertiary">No headings yet</div>
          </div>
        )}
      </div>
    </div>
  )
}
