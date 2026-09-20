import { useEffect, useRef, useState, useMemo, memo, useDeferredValue, Fragment, type MouseEvent } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { X, BookOpen, NotepadText, BookMarked, Youtube, Search, Clock, Layers, Columns2, Trash2, ChevronDown, SlidersHorizontal, LayoutGrid, ArrowDownWideNarrow, ArrowUpWideNarrow } from 'lucide-react'
import { useAppStore } from '@/store'
import { recordNavigation } from '@/lib/verseNavigation'
import { IconButton, Toolbar, ListRow, Chip, RefChip, Button, SegmentedControl, SearchField, Select, TextField, SectionHeader, SectionLabel, Badge, cx } from '@/components/ui'
import type { HistoryEntry } from '@/types'
import { parseRef } from '@/lib/parseRef'
import { getAllNotes } from '@/lib/notesCache'
import { ensureYouTubeTitles } from '@/lib/youtubeTitle'
import { cachedLexiconTitle } from '@/lib/lexiconTitle'

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

const ENTRY_ICON: Record<EntryType, typeof BookOpen> = {
  bible: BookOpen,
  note: NotepadText,
  lexicon: BookMarked,
  youtube: Youtube,
  search: Search,
  'strongs-click': Layers,
  compare: Columns2,
  import: BookMarked,
}

function EntryIcon({ type, size = 12 }: { type: EntryType; size?: number }) {
  const Icon = ENTRY_ICON[type]
  return <Icon size={size} className="flex-shrink-0" />
}

// Reuses the highlight-pigment palette (global.css) for categorical distinction — these are
// visual groupings, not status colors, so they draw from the same allowlisted swatch set as
// text highlights/tags rather than forcing 8 categories onto the 4 semantic status tokens.
const TYPE_COLOR: Record<EntryType, string> = {
  bible:          'text-accent',
  note:           'text-[rgb(var(--highlight-green))]',
  lexicon:        'text-[rgb(var(--highlight-purple))]',
  youtube:        'text-[rgb(var(--highlight-red))]',
  search:         'text-[rgb(var(--highlight-amber))]',
  'strongs-click':'text-[rgb(var(--highlight-indigo))]',
  compare:        'text-[rgb(var(--highlight-sky))]',
  import:         'text-[rgb(var(--highlight-teal))]',
}

// Same palette as TYPE_COLOR but as "r g b" triples for Chip's `tint` prop.
const TYPE_TINT: Record<EntryType, string> = {
  bible:          'var(--color-accent)',
  note:           'var(--highlight-green)',
  lexicon:        'var(--highlight-purple)',
  youtube:        'var(--highlight-red)',
  search:         'var(--highlight-amber)',
  'strongs-click':'var(--highlight-indigo)',
  compare:        'var(--highlight-sky)',
  import:         'var(--highlight-teal)',
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
  { key: 'notes',     label: 'Notes',     icon: NotepadText, types: ['note'] },
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
        const priorState = tab?.state as { bookId?: string; chapter?: number; targetVerse?: number } | undefined
        if (tab && entry.bookId) {
          s.updateTabState('scripture', tab.id, {
            bookId: entry.bookId,
            chapter: entry.chapter ?? 1,
            scrollPosition: 0,
            targetVerse: entry.verse,
          })
          s.setActiveSpace('scripture')
        } else if (entry.bookId) {
          s.createTab('bible')
          const fresh = useAppStore.getState()
          const newTab = fresh.tabs['scripture'].find(t => t.id === fresh.activeTabId['scripture'])
          if (newTab) fresh.updateTabState('scripture', newTab.id, { bookId: entry.bookId, chapter: entry.chapter ?? 1, scrollPosition: 0, targetVerse: entry.verse })
        }
        if (entry.bookId) {
          recordNavigation(
            { bookId: priorState?.bookId, chapter: priorState?.chapter, verse: priorState?.targetVerse },
            { bookId: entry.bookId, chapter: entry.chapter ?? 1, verse: entry.verse },
            { kind: 'history-revisit' },
          )
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
        if (entry.searchTagFilter?.length) {
          s.openScriptureSearchTab(entry.query || undefined, { tagNames: entry.searchTagFilter, matchAll: entry.searchTagFilterAll })
        } else if (entry.query) {
          s.openSearchTab(entry.query)
        }
        break
      }
    }
    s.closeHistory()
  }
}

// ── Single history item ────────────────────────────────────────────────────────

const HistoryItem = memo(function HistoryItem({
  visits,
  onNavigate,
  onDelete,
  noteTitles,
  videoTitles,
  active,
  rowRef,
}: {
  visits: HistoryEntry[]   // 1+ visits to the same target; visits[0] is the most recent
  onNavigate: (e: HistoryEntry) => void
  onDelete: (id: string) => void
  /** Current note id → title, so renamed notes don't show the stale title snapshotted at push time. */
  noteTitles: Map<string, string>
  /** Current video id → title, same reasoning as noteTitles. */
  videoTitles: Map<string, string>
  /** Keyboard-active row (↑/↓ + Enter) — neutral "current" selection, not a persisted state. */
  active?: boolean
  rowRef?: (el: HTMLDivElement | null) => void
}) {
  const [open, setOpen] = useState(false)
  const entry = visits[0]
  const repeated = visits.length > 1
  // Note entries resolve their title live from noteId so a rename is reflected immediately —
  // entry.title stays as a fallback for entries whose note has since been deleted.
  const displayTitle =
    entry.type === 'note' && entry.noteId ? (noteTitles.get(entry.noteId) ?? entry.title)
    : entry.type === 'youtube' && entry.videoId ? (videoTitles.get(entry.videoId) ?? entry.title)
    : entry.type === 'lexicon' && entry.strongsNum ? (cachedLexiconTitle(entry.strongsNum) ?? entry.title)
    : entry.title

  function jumpToVerse(e: MouseEvent) {
    e.stopPropagation()
    const parsed = parseRef(entry.verseRef!)
    // A note's stored verseRef can carry a trailing " LXX" ("Isaiah 66:3 LXX"). parseRef now
    // both accepts that (it used to return null, so the jump did nothing at all) and reports
    // it, so the jump lands in the LXX.
    if (parsed) onNavigate({
      ...entry,
      type: 'bible',
      bookId: parsed.bookId,
      chapter: parsed.chapter,
      translation: parsed.forcedTranslation?.toLowerCase() ?? entry.translation,
    })
  }

  return (
    <div ref={rowRef}>
      <ListRow
        leading={<span className={TYPE_COLOR[entry.type]}><EntryIcon type={entry.type} /></span>}
        title={displayTitle}
        meta={<>{entry.translation && `${entry.translation.toUpperCase()} · `}{formatTime(entry.timestamp)}</>}
        onClick={() => onNavigate(entry)}
        selected={active}
        trailingAlways
        trailing={(
          <>
            {/* Verse notes carry their attached passage — surfacing it here is what connects
                a note-opened entry back to the study workflow, letting the user jump straight
                to that verse instead of History only ever tracking navigation in isolation
                from what was actually being studied. */}
            {entry.type === 'note' && entry.verseRef && (
              <RefChip size="xs" onClick={jumpToVerse} title={`Jump to ${entry.verseRef}`}>
                → {entry.verseRef}
              </RefChip>
            )}
            {/* Session = informational label (Badge text), never a reference chip. */}
            {entry.sessionName && <Badge variant="text" tone="neutral" className="max-w-[72px] truncate normal-case tracking-normal">{entry.sessionName}</Badge>}
            {/* Repeat visits: a count badge + a disclosure button (not a Chip — chips are filters/tokens).
                Accepted raw-button exception: this is a compact inline pill living inside a ListRow's
                trailing slot, not a full-width group header, so `DisclosureRow` (leading chevron,
                mandatory `title`, block-level row) doesn't fit; `IconButton` doesn't fit either since
                the trigger's content is a count Badge + chevron, not a single icon. Keeps its own
                focus-ring + hover/pressed recipe. */}
            {repeated && (
              <button
                type="button"
                aria-expanded={open}
                aria-label={`Visited ${visits.length} times — ${open ? 'hide' : 'show'} all`}
                onClick={(e) => { e.stopPropagation(); setOpen(o => !o) }}
                className="focus-ring inline-flex items-center gap-1 h-5 px-1 rounded-control-sm text-text-secondary hover:bg-lift-2 active:bg-lift-3 transition-colors"
              >
                <Badge variant="count" tone="neutral">{visits.length}</Badge>
                <ChevronDown size={12} strokeWidth={2} className={cx('transition-transform duration-base', open && 'rotate-180')} />
              </button>
            )}
            <IconButton
              icon={X}
              label={repeated ? 'Remove all visits' : 'Remove from history'}
              size={20}
              variant="ghost"
              danger
              onClick={(e) => { e.stopPropagation(); visits.forEach(v => onDelete(v.id)) }}
              className="opacity-0 group-hover/row:opacity-100 group-focus-within/row:opacity-100"
              tooltip={false}
            />
          </>
        )}
      />
      {/* Expanded timestamp list for repeated visits */}
      {repeated && open && (
        <div className="ml-9 mr-2 mb-1 border-l border-separator">
          {visits.map((v) => (
            <ListRow
              key={v.id}
              dense
              indent={12}
              title={formatTime(v.timestamp)}
              titleClassName="tabular-nums text-text-muted"
              onClick={() => onNavigate(v)}
              trailingAlways
              trailing={(
                <IconButton
                  icon={X}
                  label="Remove this visit"
                  size={20}
                  variant="ghost"
                  danger
                  onClick={(e) => { e.stopPropagation(); onDelete(v.id) }}
                  className="opacity-0 group-hover/row:opacity-100"
                  tooltip={false}
                />
              )}
            />
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
  const navigate         = useNavigate()

  // Live note id → title map, so a renamed note shows its current title in History
  // instead of the string snapshotted into the entry when it was originally visited.
  const [noteTitles, setNoteTitles] = useState<Map<string, string>>(new Map())
  // Note id → body content, for deep search (searching "nought" should find a bible/note/
  // lexicon history entry whose underlying content contains that word, not just its title).
  const [noteContents, setNoteContents] = useState<Map<string, string>>(new Map())
  useEffect(() => {
    if (!historyOpen) return
    getAllNotes(noteChangeToken)
      .then((notes) => {
        setNoteTitles(new Map(notes.map((n) => [n.id, n.title ?? ''])))
        setNoteContents(new Map(notes.map((n) => [n.id, n.content ?? ''])))
      })
      .catch(() => {})
  }, [historyOpen, noteChangeToken])

  // Same idea for YouTube: an entry's title is snapshotted when the video is opened,
  // which can be before its metadata has loaded (a "Loading…" placeholder).
  const [videoTitles, setVideoTitles] = useState<Map<string, string>>(new Map())
  useEffect(() => {
    if (!historyOpen) return
    let cancelled = false
    ensureYouTubeTitles()
      .then((titles) => { if (!cancelled) setVideoTitles(titles) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [historyOpen])

  // Bible chapter text and lexicon definitions caches (populated further below, once
  // deferredSearch is declared — see the effect after it) so "deep search" can match
  // history entries against their underlying content, not just their metadata.
  const [chapterTextCache, setChapterTextCache] = useState<Map<string, string>>(new Map())
  const [lexiconDefCache, setLexiconDefCache] = useState<Map<string, string>>(new Map())
  const fetchedChapterKeysRef = useRef<Set<string>>(new Set())
  const fetchedStrongsNumsRef = useRef<Set<string>>(new Set())

  // ── Filter / sort state ─────────────────────────────────────────────────────
  const [searchQuery, setSearchQuery]     = useState('')
  const [dateFilter, setDateFilter]       = useState('')          // "YYYY-MM-DD" or ""
  const [typeFilters, setTypeFilters]     = useState<Set<EntryType>>(new Set())
  const [activeHistoryTab, setActiveHistoryTab] = useState<HistoryTabKey>('all')
  // "Study view" (default on): hides routine chapter-to-chapter Bible reading —
  // by far the noisiest entry type (every chapter change while reading, arrow-
  // key paging, tab restores) — while keeping every deliberate action (notes,
  // lexicon, Strong's clicks, compare, search, imports) visible. Only applies
  // within the dedicated Scripture tab — "All" always shows every visit
  // (including routine reads) so it stays a complete record regardless of
  // this toggle; other tabs never contain 'bible' entries anyway.
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

  // Populate the content caches lazily — only once the user is actively searching (2+
  // chars), and only for entries not already cached — so deep search doesn't pay hundreds
  // of IPC round-trips just from opening History (most sessions never search at all).
  // Cached forever per book/chapter/translation or strongsNum, so repeated searches during
  // the same session are free after the first pass.
  useEffect(() => {
    if (!historyOpen || deferredSearch.trim().length < 2 || history.length === 0) return
    let cancelled = false
    const chapterKeys = new Set<string>()
    const strongsNums = new Set<string>()
    for (const e of history) {
      if ((e.type === 'bible' || e.type === 'compare') && e.bookId && e.chapter) {
        const key = `${e.bookId}:${e.chapter}:${(e.translation ?? 'kjva').toLowerCase()}`
        if (!fetchedChapterKeysRef.current.has(key)) chapterKeys.add(key)
      }
      if ((e.type === 'lexicon' || e.type === 'strongs-click') && e.strongsNum) {
        if (!fetchedStrongsNumsRef.current.has(e.strongsNum)) strongsNums.add(e.strongsNum)
      }
    }
    if (chapterKeys.size === 0 && strongsNums.size === 0) return
    ;(async () => {
      const chapterEntries: [string, string][] = []
      for (const key of chapterKeys) {
        fetchedChapterKeysRef.current.add(key)
        const [bookId, chapterStr, textId] = key.split(':')
        try {
          const verses = await window.bible.queryChapter(bookId, Number(chapterStr), textId)
          chapterEntries.push([key, verses.map((v) => v.text).join(' ')])
        } catch { /* skip on failure */ }
      }
      const lexiconEntries: [string, string][] = []
      for (const num of strongsNums) {
        fetchedStrongsNumsRef.current.add(num)
        try {
          const entry = await window.lexicon.getEntry(num)
          if (entry) {
            lexiconEntries.push([num, [entry.lemma, entry.transliteration, entry.gloss, entry.definition, entry.extendedDef].filter(Boolean).join(' ')])
          }
        } catch { /* skip on failure */ }
      }
      if (cancelled) return
      if (chapterEntries.length) setChapterTextCache((prev) => new Map([...prev, ...chapterEntries]))
      if (lexiconEntries.length) setLexiconDefCache((prev) => new Map([...prev, ...lexiconEntries]))
    })()
    return () => { cancelled = true }
  }, [historyOpen, history, deferredSearch])

  useEffect(() => {
    if (!historyOpen) {
      fetchedChapterKeysRef.current.clear()
      fetchedStrongsNumsRef.current.clear()
    }
  }, [historyOpen])

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
        (e.type === 'note' && e.noteId && noteContents.get(e.noteId)?.toLowerCase().includes(q)) ||
        (e.query && e.query.toLowerCase().includes(q)) ||
        (e.bookId && e.bookId.toLowerCase().includes(q)) ||
        (e.strongsNum && e.strongsNum.toLowerCase().includes(q)) ||
        (e.videoId && e.videoId.toLowerCase().includes(q)) ||
        (e.translation && e.translation.toLowerCase().includes(q)) ||
        (e.sessionName && e.sessionName.toLowerCase().includes(q)) ||
        typeQ[e.type].toLowerCase().includes(q) ||
        // Deep content match — verse text for bible/compare entries, definition/gloss for
        // lexicon/strongs-click entries. Caches are populated lazily above; entries not yet
        // fetched simply don't match yet (no crash, just not found until the fetch lands).
        ((e.type === 'bible' || e.type === 'compare') && e.bookId && e.chapter &&
          chapterTextCache.get(`${e.bookId}:${e.chapter}:${(e.translation ?? 'kjva').toLowerCase()}`)?.toLowerCase().includes(q)) ||
        ((e.type === 'lexicon' || e.type === 'strongs-click') && e.strongsNum &&
          lexiconDefCache.get(e.strongsNum)?.toLowerCase().includes(q))
      )
    }
    if (deferredDate) entries = entries.filter(e => toDateStr(e.timestamp) === deferredDate)
    if (deferredTypes.size > 0) entries = entries.filter(e => deferredTypes.has(e.type))
    // Study-only only ever refines the Scripture tab's own list — "All" must always
    // show every visit (including routine chapter-to-chapter reads) regardless of
    // this toggle's state, since it's the one view meant to be a complete record.
    if (hideRoutineReading && deferredTab === 'scripture') entries = entries.filter(e => e.type !== 'bible')
    return entries
  }, [history, deferredSearch, deferredDate, deferredTypes, hideRoutineReading, deferredTab, noteTitles, noteContents, chapterTextCache, lexiconDefCache])

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

  // ── Keyboard ↑/↓ + Enter over the flat visit-group list ──
  const [activeIdx, setActiveIdx] = useState(0)
  useEffect(() => { setActiveIdx(0) }, [visibleGroups.length, deferredTab, deferredSearch, deferredDate])
  const rowRefs = useRef<Array<HTMLDivElement | null>>([])
  useEffect(() => {
    rowRefs.current[activeIdx]?.scrollIntoView({ block: 'nearest' })
  }, [activeIdx])

  // Trigger rect (rail/toolbar History button) → animation origin, so the sheet grows from
  // wherever it was opened, not always dead-centre.
  const historyTriggerRect = useAppStore((s) => s.historyTriggerRect)
  const transformOrigin = useMemo(() => {
    if (!historyTriggerRect || typeof window === 'undefined') return 'center'
    const cx = historyTriggerRect.x + historyTriggerRect.w / 2
    const pct = Math.max(0, Math.min(100, (cx / window.innerWidth) * 100))
    return `${pct}% top`
  }, [historyTriggerRect, historyOpen])

  return (
    <Dialog.Root open={historyOpen} onOpenChange={(open) => !open && closeHistory()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-critical scrim-light animate-fade-in" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed left-1/2 top-[8vh] -translate-x-1/2 z-critical w-full max-w-[520px] outline-none"
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx((i) => Math.min(i + 1, visibleGroups.length - 1)) }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIdx((i) => Math.max(i - 1, 0)) }
            else if (e.key === 'Enter') {
              const g = visibleGroups[activeIdx]
              if (g) { e.preventDefault(); navigate(g.visits[0]) }
            }
          }}
        >
        {/* Pop animation lives on this INNER wrapper, never on Dialog.Content — Content carries
            the centring `-translate-x-1/2` above, and a CSS animation touching `transform` on
            the same element would fight that translate for its duration (see Sheet.tsx's
            identical comment). transformOrigin follows the trigger that opened History. */}
        <div
          className="material-elevated rounded-sheet flex flex-col overflow-hidden animate-radix-popup-in"
          style={{ maxHeight: '78vh', transformOrigin }}
        >
        {/* ── Header ── */}
        <Toolbar size="md" edge="auto" material="none" className="pt-1">
          <Clock size={14} className="text-text-muted flex-shrink-0" />
          <Dialog.Title className="text-title3 font-semibold text-text-primary">History</Dialog.Title>
          <span
            className="text-meta flex-1 text-right"
            title={`Showing ${filtered.length} of ${history.length} entries${history.length >= 500 ? ' (history keeps the most recent 500)' : ''}`}
          >
            {filtersActive || hideRoutineReading ? `${filtered.length} of ${history.length}` : `${history.length} entries`}
          </span>
          <IconButton icon={X} label="Close" size={24} onClick={closeHistory} tooltip={false} />
        </Toolbar>

        {/* ── Tabs + search + sort + filter — one toolbar row ── */}
        <Toolbar size="md" material="none" edge="bottom">
          <SegmentedControl
            aria-label="Filter by content type"
            value={activeHistoryTab}
            onChange={setActiveHistoryTab}
            options={HISTORY_TABS.map((tab) => ({
              value: tab.key,
              icon: tab.icon ?? undefined,
              title: `${tab.label} · ${tabCounts[tab.key]}`,
            }))}
          />
          <SearchField
            ref={searchRef}
            value={searchQuery}
            onValueChange={setSearchQuery}
            placeholder="Search history…"
            size="sm"
            wrapperClassName="flex-1 min-w-0"
          />
          <Select
            aria-label="Sort order"
            variant="ghost"
            size="sm"
            value={sortNewest ? 'newest' : 'oldest'}
            onChange={(v) => setSortNewest(v === 'newest')}
            options={[
              { value: 'newest', label: 'Newest', icon: ArrowDownWideNarrow },
              { value: 'oldest', label: 'Oldest', icon: ArrowUpWideNarrow },
            ]}
          />
          <IconButton
            icon={SlidersHorizontal}
            label="Filter by date or type"
            size={24}
            active={showFilters || !!dateFilter || typeFilters.size > 0}
            onClick={() => setShowFilters((v) => !v)}
          />
        </Toolbar>

        {/* ── Filter panel ── */}
        {showFilters && (
          <div className="px-4 py-2.5 border-b border-separator flex-shrink-0 space-y-2">
            {/* Study vs. All — only ever refines the Scripture tab's own list; "All"
                always shows every visit regardless of this toggle (see preTabFiltered). */}
            {activeHistoryTab === 'scripture' && (
              <div className="flex items-center gap-2">
                <SectionLabel className="w-10 flex-shrink-0">Reads</SectionLabel>
                <SegmentedControl
                  aria-label="Reading history filter"
                  size="sm"
                  value={hideRoutineReading ? 'study' : 'all'}
                  onChange={(v) => setHideRoutineReading(v === 'study')}
                  options={[
                    { value: 'study', label: 'Study only', title: 'Hide routine chapter-to-chapter reading, keep deliberate actions' },
                    { value: 'all', label: 'All reads', title: 'Show everything, including routine chapter-to-chapter reading' },
                  ]}
                />
              </div>
            )}
            {/* Date picker */}
            <div className="flex items-center gap-2">
              <SectionLabel className="w-10 flex-shrink-0">Date</SectionLabel>
              <TextField
                type="date"
                size="sm"
                value={dateFilter}
                onChange={(e) => setDateFilter(e.target.value)}
                wrapperClassName="flex-1"
                trailing={dateFilter ? (
                  <IconButton icon={X} label="Clear date" size={20} variant="ghost" onClick={() => setDateFilter('')} tooltip={false} />
                ) : undefined}
              />
            </div>
            {/* Type chips */}
            <div className="flex items-center gap-1 flex-wrap">
              <SectionLabel className="w-10 flex-shrink-0">Type</SectionLabel>
              {ALL_TYPES.map(t => (
                <Chip
                  key={t}
                  size="sm"
                  icon={ENTRY_ICON[t]}
                  tint={TYPE_TINT[t]}
                  selected={typeFilters.has(t)}
                  onClick={() => toggleType(t)}
                >
                  {TYPE_LABEL[t]}
                </Chip>
              ))}
              {typeFilters.size > 0 && (
                <Button variant="ghost" size="sm" onClick={() => setTypeFilters(new Set())}>Clear</Button>
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
            <div className="flex flex-col items-center justify-center py-14 gap-2 text-text-quaternary">
              <Clock size={24} />
              <span className="text-subhead text-text-tertiary">
                {history.length === 0 ? 'No history yet' : searchQuery ? `No results for "${searchQuery}"` : 'No matches for current filters'}
              </span>
              {history.length === 0 && (
                <span className="text-footnote text-center max-w-[260px]">
                  Open scripture, notes, or lexicon entries to start tracking
                </span>
              )}
            </div>
          ) : (
            <div className="py-1">
              {visibleGroups.map((g, i) => (
                <Fragment key={g.key}>
                  {g.dayLabelText && (
                    <Toolbar sticky size="sm" edge="none">
                      <SectionHeader flush>{g.dayLabelText}</SectionHeader>
                    </Toolbar>
                  )}
                  <HistoryItem
                    visits={g.visits}
                    onNavigate={navigate}
                    onDelete={deleteEntry}
                    noteTitles={noteTitles}
                    videoTitles={videoTitles}
                    active={i === activeIdx}
                    rowRef={(el) => { rowRefs.current[i] = el }}
                  />
                </Fragment>
              ))}
              {hiddenCount > 0 && (
                <Button variant="ghost" size="sm" className="w-full mt-1" onClick={() => setShowAllFlat(true)}>
                  Show {hiddenCount} more
                </Button>
              )}
            </div>
          )}
        </div>

        {/* ── Footer ── */}
        {history.length > 0 && (
          <div className="px-4 py-2 border-t border-separator flex-shrink-0 flex items-center justify-end gap-1">
            <Trash2 size={10} className="text-text-tertiary" />
            <span className="text-meta">
              Clear history in Settings → Danger
            </span>
          </div>
        )}
        </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
