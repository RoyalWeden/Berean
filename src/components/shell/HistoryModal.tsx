import { useEffect, useRef, useState, useMemo } from 'react'
import { X, BookOpen, FileText, BookMarked, Youtube, Search, Clock, Layers, Columns2, Trash2, ChevronDown, SlidersHorizontal } from 'lucide-react'
import { useAppStore } from '@/store'
import type { HistoryEntry } from '@/types'

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
        if (entry.strongsNum) s.openLexiconEntry(entry.strongsNum)
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

function HistoryItem({
  entry,
  isChained,
  onNavigate,
  onDelete,
}: {
  entry: HistoryEntry
  isChained: boolean
  onNavigate: (e: HistoryEntry) => void
  onDelete: (id: string) => void
}) {
  return (
    <div
      className={`flex items-center group relative ${isChained ? 'pl-8' : ''}`}
    >
      {isChained && (
        <div className="absolute left-4 top-0 bottom-0 w-px bg-[rgb(var(--color-surface-4))]" />
      )}
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
        </span>
        {entry.sessionName && <SessionBadge name={entry.sessionName} />}
        <span className="text-[9px] text-[rgb(var(--color-text-muted))] flex-shrink-0 tabular-nums">
          {formatTime(entry.timestamp)}
        </span>
      </button>
      {/* Per-item delete — shown on hover */}
      <button
        onClick={(e) => { e.stopPropagation(); onDelete(entry.id) }}
        title="Remove from history"
        className="flex-shrink-0 p-1 rounded opacity-0 group-hover:opacity-100 transition-opacity text-[rgb(var(--color-text-muted))] hover:text-red-400 cursor-pointer mr-1"
      >
        <X size={10} />
      </button>
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function HistoryModal() {
  const historyOpen      = useAppStore((s) => s.historyOpen)
  const history          = useAppStore((s) => s.history)
  const closeHistory     = useAppStore((s) => s.closeHistory)
  const deleteEntry      = useAppStore((s) => s.deleteHistoryEntry)
  const overlayRef       = useRef<HTMLDivElement>(null)
  const navigate         = useNavigate()

  // ── Filter / sort state ─────────────────────────────────────────────────────
  const [searchQuery, setSearchQuery]     = useState('')
  const [dateFilter, setDateFilter]       = useState('')          // "YYYY-MM-DD" or ""
  const [typeFilters, setTypeFilters]     = useState<Set<EntryType>>(new Set())
  const [sortNewest, setSortNewest]       = useState(true)
  const [showFilters, setShowFilters]     = useState(false)
  const searchRef                         = useRef<HTMLInputElement>(null)

  // Reset filters when modal opens + autofocus search
  useEffect(() => {
    if (historyOpen) {
      setSearchQuery('')
      setDateFilter('')
      setTypeFilters(new Set())
      setSortNewest(true)
      setShowFilters(false)
      setTimeout(() => searchRef.current?.focus(), 50)
    }
  }, [historyOpen])

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

  // ── Filtered + sorted entries ───────────────────────────────────────────────
  const filtered = useMemo(() => {
    let entries = [...history]
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase()
      entries = entries.filter(e =>
        e.title.toLowerCase().includes(q) ||
        e.query?.toLowerCase().includes(q) ||
        e.bookId?.toLowerCase().includes(q) ||
        e.strongsNum?.toLowerCase().includes(q) ||
        e.videoId?.toLowerCase().includes(q) ||
        e.translation?.toLowerCase().includes(q) ||
        e.sessionName?.toLowerCase().includes(q) ||
        TYPE_LABEL[e.type].toLowerCase().includes(q)
      )
    }
    if (dateFilter) entries = entries.filter(e => toDateStr(e.timestamp) === dateFilter)
    if (typeFilters.size > 0) entries = entries.filter(e => typeFilters.has(e.type))
    if (!sortNewest) entries = entries.reverse()
    return entries
  }, [history, searchQuery, dateFilter, typeFilters, sortNewest])

  // Build groups (preserve sort order — first entry in group gives the label)
  const groups = useMemo(() => {
    type Group = { label: string; entries: HistoryEntry[] }
    const out: Group[] = []
    for (const entry of filtered) {
      const label = dayLabel(entry.timestamp)
      const last = out[out.length - 1]
      if (last && last.label === label) last.entries.push(entry)
      else out.push({ label, entries: [entry] })
    }
    return out
  }, [filtered])

  // Build a Set of IDs that are chains (have a parentId present in the current filtered set)
  const filteredIds = useMemo(() => new Set(filtered.map(e => e.id)), [filtered])
  const chainedIds  = useMemo(() => new Set(filtered.filter(e => e.parentId && filteredIds.has(e.parentId)).map(e => e.id)), [filtered, filteredIds])

  function toggleType(t: EntryType) {
    setTypeFilters(prev => {
      const next = new Set(prev)
      if (next.has(t)) next.delete(t)
      else next.add(t)
      return next
    })
  }

  if (!historyOpen) return null

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-[200] flex items-start justify-center pt-[8vh]"
      style={{ backgroundColor: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)', pointerEvents: 'all' }}
      onMouseDown={(e) => { if (e.target === overlayRef.current) closeHistory() }}
    >
      <div
        className="w-full max-w-[520px] bg-[rgb(var(--color-surface-1))] border border-[rgb(var(--color-surface-4))] rounded-2xl shadow-2xl flex flex-col overflow-hidden"
        style={{ maxHeight: '78vh' }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* ── Header ── */}
        <div className="flex items-center gap-2 px-4 pt-3 pb-2 flex-shrink-0">
          <Clock size={13} className="text-[rgb(var(--color-text-muted))] flex-shrink-0" />
          <span className="text-sm font-semibold text-[rgb(var(--color-text-primary))]">History</span>
          <span className="text-[10px] text-[rgb(var(--color-text-muted))] flex-1">{filtered.length}/{history.length}</span>
          <button
            onClick={closeHistory}
            className="p-1 rounded-md text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-text-primary))] hover:bg-[rgb(var(--color-surface-4))] transition-colors cursor-pointer"
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
                className="flex-1 text-xs px-2 py-1 rounded-md bg-[rgb(var(--color-surface-4))] border border-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-primary))] outline-none focus:border-[rgb(var(--color-accent))/50] cursor-pointer"
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
        <div className="flex-1 overflow-y-auto min-h-0">
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
              {groups.map((group) => (
                <div key={group.label}>
                  {/* Day header */}
                  <div className="sticky top-0 px-3 py-1 text-[9px] font-semibold uppercase tracking-wider text-[rgb(var(--color-text-muted))] bg-[rgb(var(--color-surface-1))] border-b border-[rgb(var(--color-surface-4))] z-10 flex items-center gap-2">
                    <span>{group.label}</span>
                    <span className="opacity-50 font-normal normal-case tracking-normal">({group.entries.length})</span>
                  </div>
                  {/* Entries */}
                  <div className="py-0.5">
                    {group.entries.map((entry) => (
                      <HistoryItem
                        key={entry.id}
                        entry={entry}
                        isChained={chainedIds.has(entry.id)}
                        onNavigate={navigate}
                        onDelete={deleteEntry}
                      />
                    ))}
                  </div>
                </div>
              ))}
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
