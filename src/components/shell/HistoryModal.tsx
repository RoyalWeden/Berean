import { useEffect, useRef, useState, useMemo, memo, useDeferredValue } from 'react'
import * as Tooltip from '@radix-ui/react-tooltip'
import { X, BookOpen, FileText, BookMarked, Youtube, Search, Clock, Layers, Columns2, Trash2, ChevronDown, SlidersHorizontal, LayoutGrid } from 'lucide-react'
import { useAppStore } from '@/store'
import type { HistoryEntry } from '@/types'
import { parseRef } from '@/lib/parseRef'
import { getAllNotes } from '@/lib/notesCache'

// ── helpers ────────────────────────────────────────────────────────────────────

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

// ── Content-type tabs ──────────────────────────────────────────────────────────
// Groups the raw HistoryEntry types into the tabs the user actually thinks in
// terms of (Scripture, Notes, Lexicon, YouTube, Search) rather than the more
// granular per-type chips this modal used to expose as its only filter. `types:
// null` means "no type filter" (the All tab) — 'import' entries (PDF imports)
// have no dedicated tab since they're rare; they still show up under All.
type HistoryTabKey = 'all' | 'scripture' | 'notes' | 'lexicon' | 'youtube' | 'search'
const HISTORY_TABS: { key: HistoryTabKey; label: string; icon: typeof BookOpen | null; types: EntryType[] | null }[] = [
  { key: 'all',       label: 'All',       icon: LayoutGrid,  types: null },
  { key: 'scripture', label: 'Scripture', icon: BookOpen,    types: ['bible', 'compare'] },
  { key: 'notes',     label: 'Notes',     icon: FileText,    types: ['note'] },
  { key: 'lexicon',   label: 'Lexicon',   icon: BookMarked,  types: ['lexicon', 'strongs-click'] },
  { key: 'youtube',   label: 'YouTube',   icon: Youtube,     types: ['youtube'] },
  { key: 'search',    label: 'Search',    icon: Search,      types: ['search'] },
]

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
  dayLabelText,
  onNavigate,
  onDelete,
  noteTitles,
}: {
  visits: HistoryEntry[]   // 1+ visits to the same target; visits[0] is the most recent
  dayLabelText?: string    // set only on the first row of a new day — lightweight divider, not a collapsible group
  onNavigate: (e: HistoryEntry) => void
  onDelete: (id: string) => void
  /** Current note id → title, so renamed notes don't show the stale title snapshotted at push time. */
  noteTitles: Map<string, string>
}) {
  const [open, setOpen] = useState(false)
  const entry = visits[0]
  const repeated = visits.length > 1
  // Note entries resolve their title live from noteId so a rename is reflected immediately —
  // entry.title stays as a fallback for entries whose note has since been deleted.
  const displayTitle = entry.type === 'note' && entry.noteId ? (noteTitles.get(entry.noteId) ?? entry.title) : entry.title
  return (
    <div className="group relative">
      {dayLabelText && (
        <div className="sticky top-0 z-10 px-3 pt-2 pb-1 text-[9px] font-semibold uppercase tracking-wider text-[rgb(var(--color-text-muted))] bg-[rgb(var(--color-surface-1))]">
          {dayLabelText}
        </div>
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
              {displayTitle}
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

type VisitGroup = { key: string; visits: HistoryEntry[]; dayLabelText?: string }

// ── Main component ─────────────────────────────────────────────────────────────

export default function HistoryModal() {
  const historyOpen      = useAppStore((s) => s.historyOpen)
  const history          = useAppStore((s) => s.history)
  const closeHistory     = useAppStore((s) => s.closeHistory)
  const deleteEntry      = useAppStore((s) => s.deleteHistoryEntry)
  const loadMoreHistory       = useAppStore((s) => s.loadMoreHistory)
  const historyHasMore        = useAppStore((s) => s.historyHasMore)
  const noteChangeToken   = useAppStore((s) => s.noteChangeToken)
  const overlayRef       = useRef<HTMLDivElement>(null)
  const navigate         = useNavigate()

  // Live note id → title map, so a renamed note shows its current title in History
  // instead of the string snapshotted into the entry when it was originally visited.
  const [noteTitles, setNoteTitles] = useState<Map<string, string>>(new Map())
  useEffect(() => {
    if (!historyOpen) return
    getAllNotes(noteChangeToken)
      .then((notes) => setNoteTitles(new Map(notes.map((n) => [n.id, n.title ?? '']))))
      .catch(() => {})
  }, [historyOpen, noteChangeToken])

  // ── Filter / sort state ─────────────────────────────────────────────────────
  const [searchQuery, setSearchQuery]     = useState('')
  const [dateFilter, setDateFilter]       = useState('')          // "YYYY-MM-DD" or ""
  const [typeFilters, setTypeFilters]     = useState<Set<EntryType>>(new Set())
  const [activeHistoryTab, setActiveHistoryTab] = useState<HistoryTabKey>('all')
  // "Study view" (default on): hides routine chapter-to-chapter Bible reading —
  // by far the noisiest entry type (every chapter change while reading, arrow-
  // key paging, tab restores) — while keeping every deliberate action (notes,
  // lexicon, Strong's clicks, compare, search, imports) visible. Only meaningful
  // on the All/Scripture tabs (it's the only tab types that include 'bible'); other
  // tabs are unaffected either way.
  const [hideRoutineReading, setHideRoutineReading] = useState(true)
  const [sortNewest, setSortNewest]       = useState(true)
  const [showFilters, setShowFilters]     = useState(false)
  const searchRef                         = useRef<HTMLInputElement>(null)

  // Reset filters when modal opens + autofocus search.
  useEffect(() => {
    if (historyOpen) {
      setSearchQuery('')
      setDateFilter('')
      setTypeFilters(new Set())
      setActiveHistoryTab('all')
      setSortNewest(true)
      setShowFilters(false)
      setShowAllFlat(false)
      setTimeout(() => searchRef.current?.focus(), 50)
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
  const deferredTab       = useDeferredValue(activeHistoryTab)

  // Every filter EXCEPT the content-type tab — used both as the base for the
  // final `filtered` list and to compute a live count per tab (so switching
  // tabs shows how many entries are actually in each one given the current
  // search/date/chip filters, not the whole unfiltered history).
  const preTabFiltered = useMemo(() => {
    let entries = history  // history is already immutable-ish; avoid spreading unless needed
    if (deferredSearch.trim()) {
      const q = deferredSearch.trim().toLowerCase()
      const typeQ = TYPE_LABEL  // stable reference
      entries = entries.filter(e =>
        e.title.toLowerCase().includes(q) ||
        (e.type === 'note' && e.noteId && noteTitles.get(e.noteId)?.toLowerCase().includes(q)) ||
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
    if (hideRoutineReading && deferredTab !== 'scripture') entries = entries.filter(e => e.type !== 'bible')
    return entries
  }, [history, deferredSearch, deferredDate, deferredTypes, hideRoutineReading, deferredTab, noteTitles])

  const tabCounts = useMemo(() => {
    const counts: Record<HistoryTabKey, number> = { all: preTabFiltered.length, scripture: 0, notes: 0, lexicon: 0, youtube: 0, search: 0 }
    for (const e of preTabFiltered) {
      for (const tab of HISTORY_TABS) {
        if (tab.types && tab.types.includes(e.type)) counts[tab.key]++
      }
    }
    return counts
  }, [preTabFiltered])

  // ── Filtered + sorted entries ───────────────────────────────────────────────
  const filtered = useMemo(() => {
    const activeTypes = HISTORY_TABS.find(t => t.key === deferredTab)?.types ?? null
    let entries = activeTypes ? preTabFiltered.filter(e => activeTypes.includes(e.type)) : preTabFiltered
    if (!deferredSort) entries = [...entries].reverse()
    return entries
  }, [preTabFiltered, deferredTab, deferredSort])

  // Flat list — repeat visits to the same target are still collapsed into one row
  // (click to expand its timestamps), but there's no collapsible day/session
  // hierarchy to click through first; entries just read top-to-bottom in order.
  const FLAT_LIST_CAP = 150
  const [showAllFlat, setShowAllFlat] = useState(false)
  const visitGroups = useMemo(() => {
    const byTarget = new Map<string, VisitGroup>()
    const order: VisitGroup[] = []
    let lastDayKey = ''
    for (const e of filtered) {
      const tk = targetKey(e)
      const existing = byTarget.get(tk)
      if (existing) { existing.visits.push(e); continue }
      const dayKey = toDateStr(e.timestamp)
      const g: VisitGroup = { key: e.id, visits: [e], dayLabelText: dayKey !== lastDayKey ? dayLabel(e.timestamp) : undefined }
      lastDayKey = dayKey
      byTarget.set(tk, g)
      order.push(g)
    }
    return order
  }, [filtered])

  function toggleType(t: EntryType) {
    setTypeFilters(prev => {
      const next = new Set(prev)
      if (next.has(t)) next.delete(t)
      else next.add(t)
      return next
    })
  }

  const filtersActive = !!(searchQuery.trim() || dateFilter || typeFilters.size > 0 || activeHistoryTab !== 'all')
  const visibleGroups = showAllFlat ? visitGroups : visitGroups.slice(0, FLAT_LIST_CAP)
  const hiddenCount = visitGroups.length - visibleGroups.length

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
          <span
            className="text-[10px] text-[rgb(var(--color-text-muted))] flex-1 text-right"
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

        {/* ── Content-type tabs ── */}
        <Tooltip.Provider delayDuration={200}>
          <div className="flex items-center gap-0.5 px-3 pb-2 flex-shrink-0">
            {HISTORY_TABS.map((tab) => {
              const active = activeHistoryTab === tab.key
              const Icon = tab.icon
              const count = tabCounts[tab.key]
              return (
                <Tooltip.Root key={tab.key}>
                  <Tooltip.Trigger asChild>
                    <button
                      onClick={() => setActiveHistoryTab(tab.key)}
                      className={`flex items-center justify-center px-2.5 py-1 rounded-shell text-xs font-medium transition-colors cursor-pointer flex-shrink-0 ${
                        active
                          ? 'bg-[rgb(var(--color-accent))/15] text-[rgb(var(--color-accent))]'
                          : 'text-[rgb(var(--color-text-muted))] hover:bg-[rgb(var(--color-surface-3))] hover:text-[rgb(var(--color-text-primary))]'
                      }`}
                    >
                      {Icon && <Icon size={13} className="flex-shrink-0" />}
                    </button>
                  </Tooltip.Trigger>
                  <Tooltip.Portal>
                    <Tooltip.Content side="bottom" sideOffset={6} className="z-50 flex items-center gap-2 px-2 py-1 rounded text-xs bg-[rgb(var(--color-surface-1))] border border-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-primary))] shadow-lg">
                      {tab.label} · {count}
                      <Tooltip.Arrow className="fill-[rgb(var(--color-surface-4))]" />
                    </Tooltip.Content>
                  </Tooltip.Portal>
                </Tooltip.Root>
              )
            })}
          </div>
        </Tooltip.Provider>

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
            {/* Study vs. All — only meaningful on tabs that can contain routine Bible
                chapter-to-chapter reads (the noisiest entry type by far). */}
            {(activeHistoryTab === 'all' || activeHistoryTab === 'scripture') && (
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-[rgb(var(--color-text-muted))] w-9 flex-shrink-0">Reads</span>
                <div className="flex items-center rounded-full border border-[rgb(var(--color-surface-4))] overflow-hidden text-[9px] font-medium">
                  <button
                    onClick={() => setHideRoutineReading(true)}
                    title="Hide routine chapter-to-chapter reading, keep deliberate actions"
                    className={`px-2 py-0.5 cursor-pointer transition-colors ${hideRoutineReading ? 'bg-[rgb(var(--color-accent))/20] text-[rgb(var(--color-accent))]' : 'text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-text-primary))]'}`}
                  >
                    Study only
                  </button>
                  <button
                    onClick={() => setHideRoutineReading(false)}
                    title="Show everything, including routine chapter-to-chapter reading"
                    className={`px-2 py-0.5 cursor-pointer transition-colors ${!hideRoutineReading ? 'bg-[rgb(var(--color-accent))/20] text-[rgb(var(--color-accent))]' : 'text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-text-primary))]'}`}
                  >
                    All reads
                  </button>
                </div>
              </div>
            )}
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
              {visibleGroups.map((g) => (
                <HistoryItem
                  key={g.key}
                  visits={g.visits}
                  dayLabelText={g.dayLabelText}
                  onNavigate={navigate}
                  onDelete={deleteEntry}
                  noteTitles={noteTitles}
                />
              ))}
              {hiddenCount > 0 && (
                <button
                  onClick={() => setShowAllFlat(true)}
                  className="w-full text-center py-1.5 text-[10px] text-[rgb(var(--color-accent))] hover:bg-[rgb(var(--color-surface-3))] cursor-pointer transition-colors"
                >
                  Show {hiddenCount} more
                </button>
              )}
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
