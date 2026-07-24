import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { CalendarClock, Clock, ArrowUpDown, ExternalLink, Monitor, PanelRightOpen } from 'lucide-react'
import type { Note } from '@/types'
import { usePositionedMenu, MenuPositioner } from '@/lib/usePositionedMenu'

type SortMode = 'recency' | 'changes'
type SortDir = 'desc' | 'asc'

const MENU_ITEM = `w-full flex items-center gap-2.5 px-3 py-1.5 text-xs text-left
  text-[rgb(var(--color-text-secondary))] hover:bg-[rgb(var(--color-surface-4))]
  hover:text-[rgb(var(--color-text-primary))] transition-colors cursor-pointer`

interface Props {
  /** "YYYY-MM-DD" date the open daily note represents — notes are matched against this, not
   *  literal "today", so viewing a past daily note shows what was edited on ITS day. */
  dateKey: string
  /** Excluded from the list — this is the daily note itself, already the one open. */
  dailyNoteId: string
  allNotes: Note[]
  onSelect: (note: Note) => void
  onOpenNewTab: (note: Note) => void
  onOpenInFloatingTab: (note: Note) => void
}

export default function DailyNoteEditsSection({ dateKey, dailyNoteId, allNotes, onSelect, onOpenNewTab, onOpenInFloatingTab }: Props) {
  const [sortMode, setSortMode] = useState<SortMode>('recency')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [deltas, setDeltas] = useState<Map<string, number>>(new Map())
  const { menu: ctxMenu, menuRef: ctxMenuRef, openMenu: openCtxMenu, closeMenu: closeCtxMenu } = usePositionedMenu<{ note: Note }>()

  const editedNotes = useMemo(() => {
    return allNotes.filter((n) => {
      if (n.id === dailyNoteId) return false
      const d = new Date(n.updatedAt)
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      return key === dateKey
    })
  }, [allNotes, dailyNoteId, dateKey])

  // Fetch version history for each edited note once, to compute "change size since this day
  // started" — the whole point of the "most/least changes" sort. Re-runs only when the actual
  // set of edited-today note ids changes (not on every keystroke elsewhere in the app).
  const editedIds = useMemo(() => editedNotes.map((n) => n.id).sort().join(','), [editedNotes])
  useEffect(() => {
    if (!editedNotes.length) { setDeltas(new Map()); return }
    let cancelled = false
    const startOfDay = new Date(`${dateKey}T00:00:00`).getTime()
    Promise.all(editedNotes.map(async (n) => {
      try {
        const versions = await window.notes.getNoteVersions(n.id)
        const before = versions
          .filter((v) => v.createdAt < startOfDay)
          .sort((a, b) => b.createdAt - a.createdAt)[0]
        const baselineLen = before ? before.content.length : 0
        return [n.id, n.content.length - baselineLen] as const
      } catch {
        return [n.id, n.content.length] as const
      }
    })).then((pairs) => { if (!cancelled) setDeltas(new Map(pairs)) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editedIds, dateKey])

  const sorted = useMemo(() => {
    const withDelta = editedNotes.map((note) => ({ note, delta: deltas.get(note.id) ?? 0 }))
    withDelta.sort((a, b) => {
      const cmp = sortMode === 'recency'
        ? a.note.updatedAt - b.note.updatedAt
        : Math.abs(a.delta) - Math.abs(b.delta)
      return sortDir === 'desc' ? -cmp : cmp
    })
    return withDelta
  }, [editedNotes, deltas, sortMode, sortDir])

  function cycleSort(mode: SortMode) {
    if (sortMode === mode) {
      setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'))
    } else {
      setSortMode(mode)
      setSortDir('desc')
    }
  }

  if (editedNotes.length === 0) return null

  return (
    <div className="rounded-shell-lg border border-[rgb(var(--color-surface-4))] bg-[rgb(var(--color-surface-3))] overflow-hidden">
      <div className="flex items-center gap-1.5 px-2.5 py-1.5 text-[9px] font-semibold uppercase tracking-widest text-[rgb(var(--color-text-muted))]">
        <CalendarClock size={9} />
        Edited today
        <span className="ml-auto rounded-full bg-[rgb(var(--color-surface-4))] px-1.5 py-0 text-[9px] text-[rgb(var(--color-text-secondary))]">{editedNotes.length}</span>
      </div>
      <div className="flex items-center gap-1 px-2.5 pb-1.5">
        {([['recency', 'Recent', Clock], ['changes', 'Changes', ArrowUpDown]] as const).map(([mode, label, Icon]) => (
          <button
            key={mode}
            onClick={() => cycleSort(mode)}
            title={sortMode === mode ? (sortDir === 'desc' ? `${label}: newest/most first` : `${label}: oldest/least first`) : `Sort by ${label.toLowerCase()}`}
            className={`flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded-full cursor-pointer transition-colors ${
              sortMode === mode
                ? 'bg-[rgb(var(--color-accent))]/16 text-[rgb(var(--color-accent))] font-semibold'
                : 'text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-text-secondary))] hover:bg-[rgb(var(--color-surface-4))]'
            }`}
          >
            <Icon size={9} />
            {label}
            {sortMode === mode && <span className="leading-none">{sortDir === 'desc' ? '↓' : '↑'}</span>}
          </button>
        ))}
      </div>
      <div className="px-1.5 pb-1.5 flex flex-col gap-0.5">
        {sorted.map(({ note, delta }) => (
          <button
            key={note.id}
            onClick={() => onSelect(note)}
            onContextMenu={(e) => { e.preventDefault(); openCtxMenu({ note, x: e.clientX, y: e.clientY }) }}
            className="flex items-center gap-1.5 w-full text-left px-1.5 py-1 rounded-shell text-[rgb(var(--color-text-secondary))] hover:text-[rgb(var(--color-text-primary))] hover:bg-[rgb(var(--color-surface-4))] transition-colors cursor-pointer truncate leading-snug"
            style={{ fontSize: '10px' }}
            title={note.title || 'Untitled'}
          >
            <span className="w-[3px] h-[3px] rounded-full bg-[rgb(var(--color-text-muted))] flex-shrink-0" />
            <span className="flex-1 truncate">{note.title || 'Untitled'}</span>
            {delta !== 0 && (
              <span className={`flex-shrink-0 text-[9px] font-mono ${delta > 0 ? 'text-emerald-500' : 'text-red-400'}`}>
                {delta > 0 ? '+' : ''}{delta}
              </span>
            )}
          </button>
        ))}
      </div>
      {ctxMenu && createPortal(
        <MenuPositioner ref={ctxMenuRef} x={ctxMenu.x} y={ctxMenu.y} className="min-w-[180px] rounded-shell context-menu py-1 overflow-hidden">
          <button className={MENU_ITEM} onClick={() => { onSelect(ctxMenu.note); closeCtxMenu() }}>
            <PanelRightOpen size={13} className="flex-shrink-0" /> Open
          </button>
          <button className={MENU_ITEM} onClick={() => { onOpenNewTab(ctxMenu.note); closeCtxMenu() }}>
            <ExternalLink size={13} className="flex-shrink-0" /> Open in new tab
          </button>
          <button className={MENU_ITEM} onClick={() => { onOpenInFloatingTab(ctxMenu.note); closeCtxMenu() }}>
            <Monitor size={13} className="flex-shrink-0" /> Open in floating tab
          </button>
        </MenuPositioner>,
        document.body
      )}
    </div>
  )
}
