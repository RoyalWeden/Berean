import { useEffect, useRef, useState, useMemo, memo, useDeferredValue, useCallback } from 'react'
import { X, BookOpen, FileText, BookMarked, Youtube, Search, Clock, Layers, Columns2, Trash2, ChevronDown, SlidersHorizontal, ChevronsDownUp, ChevronsUpDown } from 'lucide-react'
import { useAppStore } from '@/store'
import type { HistoryEntry } from '@/types'
import { parseRef } from '@/lib/parseRef'

// ── helpers ────────────────────────────────────────────────────────────────────

// Gap (ms) between consecutive entries that starts a new activity "session".
const SESSION_GAP_MS = 30 * 60 * 1000  // 30 minutes

function formatTime(ts: number): string {
  const d = new Date(ts)
  const h = d.getHours()
  const m = String(d.getMinutes()).padStart(2, '0')
  const ampm = h >= 12 ? 'pm' : 'am'
  return `${h % 12 || 12}:${m} ${ampm}`
}

/** Returns "Today", "Yesterday", or a short date string */
function dayLabel(ts: number): string {
  const now = new Date()
  const d = new Date(ts)
  const todayStr = now.toDateString()
  if (d.toDateString() === todayStr) return 'Today'
  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

/** Compact time-range label for a session, e.g. "3:40 – 4:15 pm" or "3:40 pm". */
function sessionTimeRange(entries: { timestamp: number }[]): string {
  if (entries.length === 0) return ''
  let lo = entries[0].timestamp, hi = lo
  for (let i = 1; i < entries.length; i++) {
    const t = entries[i].timestamp
    if (t < lo) lo = t
    if (t > hi) hi = t
  }
  return lo === hi ? formatTime(lo) : `${formatTime(lo)} – ${formatTime(hi)}`
}

/** Stable target key — same function reference across renders (no closure over mutable state). */
function targetKey(e: HistoryEntry): string {
  return `${e.type}|${e.bookId ?? ''}|${e.chapter ?? ''}|${e.noteId ?? ''}|${e.strongsNum ?? ''}|${e.videoId ?? ''}|${e.query ?? ''}`
}

/** Returns "YYYY-MM-DD" for a timestamp (local time) */
function toDateStr(ts: number): string {
  const d = new Date(ts)
  const y = d.getFullYear()
  const mo = String(d.getMonth() + 1).padStart(2, '0')
  const dy = String(d.getDate()).padStart(2, '0')
  return `${y}-${mo}-${dy}`
}

// ── icon per entry type ────────────────────────────────────────────────────────

type EntryType = HistoryEntry['type']

function EntryIcon({ type, size = 12 }: { type: EntryType; size?: number }) {
  const cls = 'flex-shrink-0'
  switch (type) {
    case 'bible':         return <BookOpen    size={size} className={cls} />
    case 'note':          return <FileText    size={size} className={cls} />
    case 'lexicon':       return <BookMarked  size={size} className={cls} />
    case 'youtube':       return <Youtube     size={size} className={cls} />
    case 'search':        return <Search      size={size} className={cls} />
    case 'strongs-click': return <Layers      size={size} className={cls} />
    case 'compare':       return <Columns2    size={size} className={cls} />
    case 'import':        return <BookMarked  size={size} className={cls} />
  }
}

const TYPE_COLOR: Record<EntryType, string> = {
  bible:          'text-[rgb(var(--color-accent))]',
  note:           'text-emerald-400',
  lexicon:        'text-purple-400',
  youtube:        'text-red-400',
  search:         'text-amber-400',
  'strongs-click':'text-indigo-400',
  compare:        'text-sky-400',
  import:         'text-teal-400',
}

const TYPE_LABEL: Record<EntryType, string> = {
  bible:          'Scripture',
  note:           'Note',
  lexicon:        'Lexicon',
  youtube:        'YouTube',
  search:         'Search',
  'strongs-click':'Strong\'s',
  compare:        'Compare',
  import:         'Import',
}

const ALL_TYPES: EntryType[] = ['bible', 'note', 'lexicon', 'youtube', 'search', 'strongs-click', 'compare', 'import']

// ── navigation ─────────────────────────────────────────────────────────────────

function useNavigate() {
  const store = useAppStore.getState

  return function navigate(entry: HistoryEntry) {
    const s = store()
    switch (entry.type) {
      case 'bible':
      case 'compare': {
        const tab = s.tabs['scripture'].find(t => t.id === s.activeTabId['scripture'])
          ?? s.tabs['scripture'][0]
        if (tab && entry.bookId) {
          s.updateTabState('scripture', tab.id, {
            bookId: entry.bookId,
            chapter: entry.chapter ?? 1,
            scrollPosition: 0,
            targetVerse: undefined,
          })
          s.setActiveSpace('scripture')
        } else if (entry.bookId) {
          s.createTab('bible')
          const fresh = useAppStore.getState()
          const newTab = fresh.tabs['scripture'].find(t => t.id === fresh.activeTabId['scripture'])
          if (newTab) fresh.updateTabState('scripture', newTab.id, { bookId: entry.bookId, chapter: entry.chapter ?? 1, scrollPosition: 0 })
        }
        break
      }
      case 'note': {
        if (entry.noteId) s.requestOpenNote(entry.noteId)
        break
      }
      case 'lexicon':
      case 'strongs-click': {
        // Activate/create the target Lexicon tab BEFORE queuing the entry —
        // openLexiconEntry's pending value gets picked up by whichever
        // Lexicon tab is (or becomes) active, so calling it first, while a
        // DIFFERENT lexicon tab is still the active one, hands the entry to
        // the wrong tab instead of the intended destination.
        if (entry.strongsNum) {
          s.ensureTab('lexicon')
          s.openLexiconEntry(entry.strongsNum)
          s.setActiveSpace('lexicon')
        }
        break
      }
      case 'youtube': {
        if (entry.videoId) s.openYouTubeVideo(entry.videoId, 0)
        break
      }
      case 'search': {
        if (entry.query) s.openSearchTab(entry.query)
        break
      }
    }
    s.closeHistory()
  }
}

// ── Type filter chip ───────────────────────────────────────────────────────────

function TypeChip({ type, active, onClick }: { type: EntryType; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border transition-colors cursor-pointer ${
        active
          ? `${TYPE_COLOR[type]} border-current bg-current/10`
          : 'text-[rgb(var(--color-text-muted))] border-[rgb(var(--color-surface-4))] hover:border-[rgb(var(--color-text-muted))]'
      }`}
    >
      <EntryIcon type={type} size={9} />
      {TYPE_LABEL[type]}
    </button>
  )
}

// ── Session badge ──────────────────────────────────────────────────────────────

function SessionBadge({ name }: { name: string }) {
  return (
    <span className="text-[9px] px-1 py-0.5 rounded bg-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-muted))] font-medium leading-none flex-shrink-0 max-w-[72px] truncate">
      {name}
    </span>
  )
}

// ── Single history item ────────────────────────────────────────────────────────

const HistoryItem = memo(function HistoryItem({
  visits,
  isChained,
  onNavigate,
  onDelete,
}: {
  visits: HistoryEntry[]   // 1+ visits to the same target; visits[0] is the most recent
  isChained: boolean
  onNavigate: (e: HistoryEntry) => void
  onDelete: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const entry = visits[0]
  const repeated = visits.length > 1
  return (
    <div className={`group relative ${isChained ? 'pl-8' : ''}`}>
      {isChained && (
        <div className="absolute left-4 top-0 bottom-0 w-px bg-[rgb(var(--color-surface-4))]" />
      )}
      <div className="flex items-center">
        <button
          onClick={() => onNavigate(entry)}
          className="flex-1 flex items-center gap-2 px-3 py-1.5 text-left hover:bg-[rgb(var(--color-surface-3))] transition-colors cursor-pointer min-w-0 rounded"
        >
          <span className={`${TYPE_COLOR[entry.type]} flex-shrink-0`}>
            <EntryIcon type={entry.type} size={11} />
          </span>
          <span className="flex-1 min-w-0 flex items-baseline gap-1.5">
            <span className="text-xs text-[rgb(var(--color-text-primary))] truncate leading-tight">
              {entry.title}
            </span>
            {entry.translation && (
              <span className="text-[9px] text-[rgb(var(--color-text-muted))] flex-shrink-0">
                {entry.translation.toUpperCase()}
              </span>
            )}
            {/* Verse notes carry their attached passage — surfacing it here
                is what connects a note-opened entry back to the study
                workflow, letting the user jump straight to that verse
                instead of History only ever tracking navigation in
                isolation from what was actually being studied. */}
            {entry.type === 'note' && entry.verseRef && (
              <span
                role="button"
                onClick={(e) => {
                  e.stopPropagation()
                  const parsed = parseRef(entry.verseRef!)
                  if (parsed) onNavigate({ ...entry, type: 'bible', bookId: parsed.bookId, chapter: parsed.chapter })
                }}
                title={`Jump to ${entry.verseRef}`}
                className="text-[9px] text-[rgb(var(--color-accent))] hover:underline flex-shrink-0 cursor-pointer"
              >
                → {entry.verseRef}
              </span>
            )}
          </span>
          {/* Repeat-visit count badge → click toggles the timestamp list */}
          {repeated && (
            <span
              role="button"
              onClick={(e) => { e.stopPropagation(); setOpen(o => !o) }}
              title={`Visited ${visits.length} times — show all`}
              className="flex items-center gap-0.5 text-[9px] text-[rgb(var(--color-text-muted))] bg-[rgb(var(--color-surface-4))] rounded-full px-1.5 py-0.5 flex-shrink-0 cursor-pointer hover:text-[rgb(var(--color-text-primary))]"
            >
              ×{visits.length}
              <ChevronDown size={8} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
            </span>
          )}
          {entry.sessionName && <SessionBadge name={entry.sessionName} />}
          <span className="text-[9px] text-[rgb(var(--color-text-muted))] flex-shrink-0 tabular-nums">
            {formatTime(entry.timestamp)}
          </span>
        </button>
        {/* Per-item delete — shown on hover (removes the whole group) */}
        <button
          onClick={(e) => { e.stopPropagation(); visits.forEach(v => onDelete(v.id)) }}
          title={repeated ? 'Remove all visits' : 'Remove from history'}
          className="flex-shrink-0 p-1 rounded opacity-0 group-hover:opacity-100 transition-opacity text-[rgb(var(--color-text-muted))] hover:text-red-400 cursor-pointer mr-1"
        >
          <X size={10} />
        </button>
      </div>
      {/* Expanded timestamp list for repeated visits */}
      {repeated && open && (
        <div className="ml-9 mr-2 mb-1 border-l border-[rgb(var(--color-surface-4))]">
          {visits.map((v) => (
            <div key={v.id} className="flex items-center group/ts">
              <button
                onClick={() => onNavigate(v)}
                className="flex-1 text-left pl-3 py-0.5 text-[10px] text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-text-primary))] hover:bg-[rgb(var(--color-surface-3))] cursor-pointer rounded tabular-nums"
              >
                {formatTime(v.timestamp)}
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); onDelete(v.id) }}
                title="Remove this visit"
                className="flex-shrink-0 p-1 rounded opacity-0 group-hover/ts:opacity-100 text-[rgb(var(--color-text-muted))] hover:text-red-400 cursor-pointer mr-1"
              >
                <X size={9} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
})

// ── Session block — memo'd to prevent re-render when unrelated state changes ──

const SESSION_ITEM_CAP = 60  // render at most this many items per session initially

type VisitGroup = { key: string; visits: HistoryEntry[] }
type SessionData = { key: string; entries: HistoryEntry[]; items: VisitGroup[]; timeRange: string }

const SessionBlock = memo(function SessionBlock({
  session, multiSession, collapsed, chainedIds, onToggle, onNavigate, onDelete,
}: {
  session: SessionData
  multiSession: boolean
  collapsed: boolean
  chainedIds: Set<string>
  onToggle: (key: string) => void
  onNavigate: (e: HistoryEntry) => void
  onDelete: (id: string) => void
}) {
  const [showAll, setShowAll] = useState(false)
  // Stable derived data — computed once per session render
  const types = useMemo(() => {
    const seen = new Set<EntryType>()
    for (const e of session.entries) seen.add(e.type)
    return Array.from(seen)
  }, [session.entries])

  const visibleItems = !showAll && session.items.length > SESSION_ITEM_CAP
    ? session.items.slice(0, SESSION_ITEM_CAP)
    : session.items
  const hidden = session.items.length - visibleItems.length

  return (
    <div>
      {multiSession && (
        <button
          onClick={() => onToggle(session.key)}
          className="w-full flex items-center gap-2 pl-4 pr-3 py-1 text-[9px] text-[rgb(var(--color-text-muted))] hover:bg-[rgb(var(--color-surface-2))] transition-colors cursor-pointer"
        >
          <ChevronDown size={9} className={`transition-transform opacity-60 ${collapsed ? '-rotate-90' : ''}`} />
          <span className="tabular-nums">{session.timeRange}</span>
          <span className="opacity-50">· {session.entries.length}</span>
          <span className="flex items-center gap-1 ml-auto">
            {types.slice(0, 5).map(t => (
              <span key={t} className={TYPE_COLOR[t]}><EntryIcon type={t} size={9} /></span>
            ))}
          </span>
        </button>
      )}
      {!(multiSession && collapsed) && (
        <div className="py-0.5">
          {visibleItems.map((g) => (
            <HistoryItem
              key={g.key}
              visits={g.visits}
              isChained={g.visits.length === 1 && chainedIds.has(g.visits[0].id)}
              onNavigate={onNavigate}
              onDelete={onDelete}
            />
          ))}
          {hidden > 0 && (
            <button
              onClick={() => setShowAll(true)}
              className="w-full text-center py-1 text-[10px] text-[rgb(var(--color-accent))] hover:bg-[rgb(var(--color-surface-3))] cursor-pointer transition-colors"
            >
              Show {hidden} more in this session
            </button>
          )}
        </div>
      )}
    </div>
  )
})

// ── Main component ─────────────────────────────────────────────────────────────

export default function HistoryModal() {
  const historyOpen      = useAppStore((s) => s.historyOpen)
  const history          = useAppStore((s) => s.history)
  const closeHistory     = useAppStore((s) => s.closeHistory)
  const deleteEntry      = useAppStore((s) => s.deleteHistoryEntry)
  // Persisted collapse memory — days & sessions are collapsed by default; these hold the
  // keys the user has explicitly expanded (survives reopening and app restart).
  const expandedDayList     = useAppStore((s) => s.historyExpandedDays)
  const expandedSessionList = useAppStore((s) => s.historyExpandedSessions)
  const toggleExpandedDay     = useAppStore((s) => s.toggleHistoryExpandedDay)
  const toggleExpandedSession = useAppStore((s) => s.toggleHistoryExpandedSession)
  const setHistoryExpanded    = useAppStore((s) => s.setHistoryExpanded)
  const autoExpandSession     = useAppStore((s) => s.autoExpandHistorySession)
  const loadMoreHistory       = useAppStore((s) => s.loadMoreHistory)
  const historyHasMore        = useAppStore((s) => s.historyHasMore)
  const overlayRef       = useRef<HTMLDivElement>(null)
  const navigate         = useNavigate()

  // ── Filter / sort state ─────────────────────────────────────────────────────
  const [searchQuery, setSearchQuery]     = useState('')
  const [dateFilter, setDateFilter]       = useState('')          // "YYYY-MM-DD" or ""
  const [typeFilters, setTypeFilters]     = useState<Set<EntryType>>(new Set())
  // "Study view" (default on): hides routine chapter-to-chapter Bible reading —
  // by far the noisiest entry type (every chapter change while reading, arrow-
  // key paging, tab restores) — while keeping every deliberate action (notes,
  // lexicon, Strong's clicks, compare, search, imports) visible. This is a
  // simplification layer above the granular per-type chips below, not a
  // replacement for them — a separate toggle keeps its own "N filters active"
  // language from getting confusing when this is on by default.
  const [hideRoutineReading, setHideRoutineReading] = useState(true)
  const [sortNewest, setSortNewest]       = useState(true)
  const [showFilters, setShowFilters]     = useState(false)
  // Days/sessions are collapsed by default; the expanded keys live in the store so the
  // memory persists across reopening and restarts. Collapsed groups render header-only.
  const expandedDays     = useMemo(() => new Set(expandedDayList), [expandedDayList])
  const expandedSessions = useMemo(() => new Set(expandedSessionList), [expandedSessionList])
  const searchRef                         = useRef<HTMLInputElement>(null)

  // Reset filters when modal opens + autofocus search (collapse memory is preserved).
  useEffect(() => {
    if (historyOpen) {
      setSearchQuery('')
      setDateFilter('')
      setTypeFilters(new Set())
      setSortNewest(true)
      setShowFilters(false)
      setTimeout(() => searchRef.current?.focus(), 50)
      // Auto-expand the active/most-recent session (once) so the latest activity is visible.
      const newest = history[0]
      if (newest) {
        const dayKey = toDateStr(newest.timestamp)
        autoExpandSession(dayKey, `${dayKey}@${newest.timestamp}`)
      }
    }
  }, [historyOpen]) // eslint-disable-line react-hooks/exhaustive-deps

  // Escape: clear search first, then close
  useEffect(() => {
    if (!historyOpen) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        if (searchQuery) { setSearchQuery(''); e.stopPropagation() }
        else closeHistory()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [historyOpen, closeHistory, searchQuery])

  // ── Deferred filter inputs so typing doesn't block the UI thread ────────────
  const deferredSearch    = useDeferredValue(searchQuery)
  const deferredDate      = useDeferredValue(dateFilter)
  const deferredTypes     = useDeferredValue(typeFilters)
  const deferredSort      = useDeferredValue(sortNewest)

  // ── Filtered + sorted entries ───────────────────────────────────────────────
  const filtered = useMemo(() => {
    let entries = history  // history is already immutable-ish; avoid spreading unless needed
    if (deferredSearch.trim()) {
      const q = deferredSearch.trim().toLowerCase()
      const typeQ = TYPE_LABEL  // stable reference
      entries = entries.filter(e =>
        e.title.toLowerCase().includes(q) ||
        (e.query && e.query.toLowerCase().includes(q)) ||
        (e.bookId && e.bookId.toLowerCase().includes(q)) ||
        (e.strongsNum && e.strongsNum.toLowerCase().includes(q)) ||
        (e.videoId && e.videoId.toLowerCase().includes(q)) ||
        (e.translation && e.translation.toLowerCase().includes(q)) ||
        (e.sessionName && e.sessionName.toLowerCase().includes(q)) ||
        typeQ[e.type].toLowerCase().includes(q)
      )
    }
    if (deferredDate) entries = entries.filter(e => toDateStr(e.timestamp) === deferredDate)
    if (deferredTypes.size > 0) entries = entries.filter(e => deferredTypes.has(e.type))
    if (hideRoutineReading) entries = entries.filter(e => e.type !== 'bible')
    if (!deferredSort) entries = [...entries].reverse()
    return entries
  }, [history, deferredSearch, deferredDate, deferredTypes, deferredSort, hideRoutineReading])

  // Build day groups, each split into activity "sessions". Also compute chainedIds
  // in the same pass (avoids a second O(n) scan with filteredIds → chainedIds).
  const { dayGroups, chainedIds } = useMemo(() => {
    type VisitGroup = { key: string; visits: HistoryEntry[] }
    type Session = { key: string; entries: HistoryEntry[]; items: VisitGroup[]; timeRange: string }
    type Day = { label: string; key: string; sessions: Session[]; count: number }

    // Build filtered ID set in one pass for chaining lookup below
    const idSet = new Set<string>()
    for (const e of filtered) idSet.add(e.id)

    const chained = new Set<string>()
    const days: Day[] = []

    for (const entry of filtered) {
      if (entry.parentId && idSet.has(entry.parentId)) chained.add(entry.id)

      const dayKey = toDateStr(entry.timestamp)
      let day = days[days.length - 1]
      if (!day || day.key !== dayKey) {
        day = { label: dayLabel(entry.timestamp), key: dayKey, sessions: [], count: 0 }
        days.push(day)
      }
      const lastSession = day.sessions[day.sessions.length - 1]
      const lastEntry = lastSession?.entries[lastSession.entries.length - 1]
      const gap = lastEntry ? Math.abs(lastEntry.timestamp - entry.timestamp) : Infinity
      if (lastSession && gap <= SESSION_GAP_MS) {
        lastSession.entries.push(entry)
      } else {
        day.sessions.push({ key: `${dayKey}@${entry.timestamp}`, entries: [entry], items: [], timeRange: '' })
      }
      day.count++
    }

    // Within each session: collapse repeat visits, compute time range
    for (const day of days) {
      for (const session of day.sessions) {
        session.timeRange = sessionTimeRange(session.entries)
        const byTarget = new Map<string, VisitGroup>()
        const order: VisitGroup[] = []
        for (const e of session.entries) {
          const tk = targetKey(e)
          const existing = byTarget.get(tk)
          if (existing) { existing.visits.push(e) }
          else { const g: VisitGroup = { key: e.id, visits: [e] }; byTarget.set(tk, g); order.push(g) }
        }
        session.items = order
      }
    }
    return { dayGroups: days, chainedIds: chained }
  }, [filtered])

  function toggleType(t: EntryType) {
    setTypeFilters(prev => {
      const next = new Set(prev)
      if (next.has(t)) next.delete(t)
      else next.add(t)
      return next
    })
  }

  // When a search or filter is active, expand everything so every match is visible.
  // Otherwise a group is collapsed unless its key is in the persisted expanded set.
  const filtersActive = !!(searchQuery.trim() || dateFilter || typeFilters.size > 0)
  const isDayCollapsed = (key: string) => !filtersActive && !expandedDays.has(key)
  const isSessionCollapsed = (key: string) => !filtersActive && !expandedSessions.has(key)

  function toggleDay(key: string) { toggleExpandedDay(key) }
  function toggleSession(key: string) { toggleExpandedSession(key) }
  function setAllCollapsed(collapsed: boolean) {
    if (collapsed) {
      setHistoryExpanded([], [])
    } else {
      // Expand every currently-shown day and session.
      const dayKeys = dayGroups.map(d => d.key)
      const sessionKeys = dayGroups.flatMap(d => d.sessions.map(s => s.key))
      setHistoryExpanded(dayKeys, sessionKeys)
    }
  }
  const allCollapsed = expandedDays.size === 0

  if (!historyOpen) return null

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-[200] flex items-start justify-center pt-[8vh]"
      style={{ backgroundColor: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)', pointerEvents: 'all' }}
      onMouseDown={(e) => { if (e.target === overlayRef.current) closeHistory() }}
    >
      <div
        className="w-full max-w-[520px] rounded-shell-lg flex flex-col overflow-hidden border border-[rgb(var(--color-surface-4))] shadow-2xl bg-[rgb(var(--color-surface-1))]"
        style={{ maxHeight: '78vh' }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* ── Header ── */}
        <div className="flex items-center gap-2 px-4 pt-3 pb-2 flex-shrink-0">
          <Clock size={13} className="text-[rgb(var(--color-text-muted))] flex-shrink-0" />
          <span className="text-sm font-semibold text-[rgb(var(--color-text-primary))]">History</span>
          {/* Study vs. All — a coarse, always-visible toggle above the granular
              type chips, since routine Bible chapter navigation otherwise
              drowns out every deliberate action (note opened, Strong's
              looked up, compare toggled, imported, searched). */}
          <div className="flex items-center rounded-full border border-[rgb(var(--color-surface-4))] overflow-hidden text-[9px] font-medium flex-shrink-0">
            <button
              onClick={() => setHideRoutineReading(true)}
              title="Show only deliberate study actions — hides routine chapter-to-chapter reading"
              className={`px-2 py-0.5 cursor-pointer transition-colors ${hideRoutineReading ? 'bg-[rgb(var(--color-accent))/20] text-[rgb(var(--color-accent))]' : 'text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-text-primary))]'}`}
            >
              Study
            </button>
            <button
              onClick={() => setHideRoutineReading(false)}
              title="Show everything, including routine chapter-to-chapter reading"
              className={`px-2 py-0.5 cursor-pointer transition-colors ${!hideRoutineReading ? 'bg-[rgb(var(--color-accent))/20] text-[rgb(var(--color-accent))]' : 'text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-text-primary))]'}`}
            >
              All
            </button>
          </div>
          <span
            className="text-[10px] text-[rgb(var(--color-text-muted))] flex-1"
            title={`Showing ${filtered.length} of ${history.length} entries${history.length >= 500 ? ' (history keeps the most recent 500)' : ''}`}
          >
            {filtersActive || hideRoutineReading ? `${filtered.length} of ${history.length}` : `${history.length} entries`}
          </span>
          <button
            onClick={closeHistory}
            className="p-1 rounded-shell text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-text-primary))] hover:bg-[rgb(var(--color-surface-4))] transition-colors cursor-pointer"
          >
            <X size={13} />
          </button>
        </div>

        {/* ── Search bar — always visible ── */}
        <div className="px-3 pb-2 flex-shrink-0">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[rgb(var(--color-surface-3))] border border-[rgb(var(--color-surface-4))] focus-within:border-[rgb(var(--color-accent))/50] transition-colors">
            <Search size={12} className="text-[rgb(var(--color-text-muted))] flex-shrink-0" />
            <input
              ref={searchRef}
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search history…"
              className="flex-1 text-xs bg-transparent outline-none text-[rgb(var(--color-text-primary))] placeholder:text-[rgb(var(--color-text-muted))]"
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery('')} className="text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-text-primary))] cursor-pointer flex-shrink-0">
                <X size={10} />
              </button>
            )}
            {/* Sort + filter controls inline with search bar */}
            <div className="flex items-center gap-1 border-l border-[rgb(var(--color-surface-4))] pl-2 ml-1 flex-shrink-0">
              <button
                onClick={() => setSortNewest(v => !v)}
                title={sortNewest ? 'Newest first' : 'Oldest first'}
                className="text-[9px] text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-text-primary))] transition-colors cursor-pointer px-1 tabular-nums"
              >
                {sortNewest ? '↓ New' : '↑ Old'}
              </button>
              <button
                onClick={() => setAllCollapsed(!allCollapsed)}
                title={allCollapsed ? 'Expand all days' : 'Collapse all days'}
                disabled={filtersActive}
                className={`p-0.5 rounded transition-colors cursor-pointer text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-text-primary))] disabled:opacity-30 disabled:cursor-default`}
              >
                {allCollapsed ? <ChevronsUpDown size={11} /> : <ChevronsDownUp size={11} />}
              </button>
              <button
                onClick={() => setShowFilters(v => !v)}
                title="Filter by date or type"
                className={`p-0.5 rounded transition-colors cursor-pointer ${
                  showFilters || dateFilter || typeFilters.size > 0
                    ? 'text-[rgb(var(--color-accent))]'
                    : 'text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-text-primary))]'
                }`}
              >
                <SlidersHorizontal size={11} />
              </button>
            </div>
          </div>
        </div>

        {/* Divider */}
        <div className="border-t border-[rgb(var(--color-surface-4))] flex-shrink-0" />

        {/* ── Filter panel ── */}
        {showFilters && (
          <div className="px-4 py-2.5 border-b border-[rgb(var(--color-surface-4))] flex-shrink-0 space-y-2 bg-[rgb(var(--color-surface-2))]">
            {/* Date picker */}
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-[rgb(var(--color-text-muted))] w-9 flex-shrink-0">Date</span>
              <input
                type="date"
                value={dateFilter}
                onChange={(e) => setDateFilter(e.target.value)}
                className="flex-1 text-xs px-2 py-1 rounded-shell bg-[rgb(var(--color-surface-4))] border border-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-primary))] outline-none focus:border-[rgb(var(--color-accent))/50] cursor-pointer"
              />
              {dateFilter && (
                <button
                  onClick={() => setDateFilter('')}
                  className="text-[10px] text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-text-primary))] cursor-pointer px-1"
                >
                  <X size={10} />
                </button>
              )}
            </div>
            {/* Type chips */}
            <div className="flex items-center gap-1 flex-wrap">
              <span className="text-[10px] text-[rgb(var(--color-text-muted))] w-9 flex-shrink-0">Type</span>
              {ALL_TYPES.map(t => (
                <TypeChip key={t} type={t} active={typeFilters.has(t)} onClick={() => toggleType(t)} />
              ))}
              {typeFilters.size > 0 && (
                <button
                  onClick={() => setTypeFilters(new Set())}
                  className="text-[9px] text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-text-primary))] cursor-pointer ml-1"
                >
                  Clear
                </button>
              )}
            </div>
          </div>
        )}

        {/* ── List ── */}
        <div
          className="flex-1 overflow-y-auto min-h-0"
          style={{ transform: 'translateZ(0)', contain: 'paint' }}
          onScroll={(e) => {
            // Lazy-load older pages from SQLite as the user nears the bottom.
            const el = e.currentTarget
            if (historyHasMore && !filtersActive && el.scrollHeight - el.scrollTop - el.clientHeight < 400) {
              loadMoreHistory()
            }
          }}
        >
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-14 gap-2 text-[rgb(var(--color-text-muted))]">
              <Clock size={26} className="opacity-25" />
              <span className="text-sm opacity-50">
                {history.length === 0 ? 'No history yet' : searchQuery ? `No results for "${searchQuery}"` : 'No matches for current filters'}
              </span>
              {history.length === 0 && (
                <span className="text-xs opacity-35 text-center max-w-[260px]">
                  Open scripture, notes, or lexicon entries to start tracking
                </span>
              )}
            </div>
          ) : (
            <div className="py-1">
              {dayGroups.map((day) => {
                const dayCollapsed = isDayCollapsed(day.key)
                return (
                <div key={day.key} style={{ contentVisibility: 'auto', containIntrinsicSize: `auto ${(dayCollapsed ? 0 : day.count * 30 + day.sessions.length * 22) + 24}px` }}>
                  {/* Day header — click to collapse/expand */}
                  <button
                    onClick={() => toggleDay(day.key)}
                    className="sticky top-0 w-full px-3 py-1.5 text-[9px] font-semibold uppercase tracking-wider text-[rgb(var(--color-text-muted))] bg-[rgb(var(--color-surface-1))] border-b border-[rgb(var(--color-surface-4))] z-10 flex items-center gap-2 hover:bg-[rgb(var(--color-surface-2))] transition-colors cursor-pointer"
                  >
                    <ChevronDown size={11} className={`transition-transform ${dayCollapsed ? '-rotate-90' : ''}`} />
                    <span>{day.label}</span>
                    <span className="opacity-50 font-normal normal-case tracking-normal">({day.count})</span>
                    {!dayCollapsed && day.sessions.length > 1 && (
                      <span className="opacity-40 font-normal normal-case tracking-normal ml-auto">{day.sessions.length} sessions</span>
                    )}
                  </button>
                  {/* Sessions */}
                  {!dayCollapsed && day.sessions.map((session) => (
                    <SessionBlock
                      key={session.key}
                      session={session}
                      multiSession={day.sessions.length > 1}
                      collapsed={isSessionCollapsed(session.key)}
                      chainedIds={chainedIds}
                      onToggle={toggleSession}
                      onNavigate={navigate}
                      onDelete={deleteEntry}
                    />
                  ))}
                </div>
                )
              })}
            </div>
          )}
        </div>

        {/* ── Footer ── */}
        {history.length > 0 && (
          <div className="px-4 py-2 border-t border-[rgb(var(--color-surface-4))] flex-shrink-0 flex items-center justify-end gap-1">
            <Trash2 size={10} className="text-[rgb(var(--color-text-muted))] opacity-50" />
            <span className="text-[10px] text-[rgb(var(--color-text-muted))] opacity-50">
              Clear history in Settings → Danger
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
