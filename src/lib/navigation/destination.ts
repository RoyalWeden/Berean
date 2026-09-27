import { useAppStore } from '@/store'
import type { BibleTabState, SearchTabState, Tab, TabType } from '@/types'
import { navigateToVerse, recordNavigation, type NavOrigin } from '@/lib/verseNavigation'
import { resolveTextForBook, chapterForBookSwitch } from '@/lib/textCoverage'

/**
 * WHERE something opens — the one navigation contract (NAV-001, docs/navigation-contract.md).
 *
 * A `Destination` says WHAT to show; a `NavIntent` says WHERE. Every call site states both, so no
 * component guesses (the cause of "things that should change this tab open a new one": every old
 * `open*` / `navigateToVerse` helper silently meant "the active tab of the destination's SPACE,
 * else a new one" — the desktop's per-space model — which on the iPhone, where the current tab is
 * the one on screen, lands in a DIFFERENT tab or creates one whenever the types differ).
 *
 *   'current-tab'   change the tab on screen. Same type → navigate it; different type → the tab
 *                   itself changes type (store transformTab: same place, its history carried,
 *                   ‹ returns). Creates a tab only when there is no tab at all.
 *   'new-tab'       create a tab, then arrive in it (plus, "Open in New Tab", duplicate …).
 *   'existing-tab'  the destination space's active tab, else a new one — the desktop / external
 *                   (deep link, Spotlight, Siri) semantics, kept exactly as they were.
 *
 * Sheets and overlays are PRESENTATIONS, not tab operations: they never call this until the user
 * picks a destination inside them (then with the intent of the surface that presented them).
 */
export type NavIntent = 'current-tab' | 'new-tab' | 'existing-tab'

export type SearchDestinationScope = NonNullable<SearchTabState['scope']>

export type Destination =
  | {
    kind: 'passage'; bookId: string; chapter: number; verse?: number; endVerse?: number | null
    /** The database to show it in ("lxx", "enoch" …); omitted → the shared text-coverage rule. */
    textId?: string
    /** Find-in-verse highlight carried from a search hit. */
    highlight?: { query?: string; wordMode?: BibleTabState['targetVerseWordMode']; strongsWords?: number[] }
    /** Opened from a note (its "← back to note" pill). */
    noteBack?: { noteId: string; title: string } | null
  }
  | { kind: 'note'; noteId: string }
  | { kind: 'strongs'; num: string }
  | { kind: 'search'; query: string; scope?: SearchDestinationScope; filters?: Record<string, unknown> }
  | { kind: 'video'; videoId: string; startTime?: number }

/** The tab type that shows a destination. */
export function destinationTabType(d: Destination): TabType {
  switch (d.kind) {
    case 'passage': return 'bible'
    case 'note': return 'note'
    case 'strongs': return 'lexicon'
    case 'search': return 'search'
    case 'video': return 'youtube'
  }
}

/** The tab on screen (the active tab of the active space). */
export function currentTab(s = useAppStore.getState()): Tab | null {
  return s.tabs[s.activeSpace]?.find((t) => t.id === s.activeTabId[s.activeSpace]) ?? null
}

const defaultOrigin = (d: Destination): NavOrigin =>
  d.kind === 'search' ? { kind: 'search-result', query: d.query } : { kind: 'other' }

/**
 * Open `dest` with an explicit intent. Returns the id of the tab it landed in (null when nothing
 * could be opened). See the file comment for the contract.
 */
export function openDestination(dest: Destination, intent: NavIntent, opts: { origin?: NavOrigin } = {}): string | null {
  const origin = opts.origin ?? defaultOrigin(dest)
  if (intent === 'existing-tab') return openInExistingTab(dest, origin)
  const type = destinationTabType(dest)
  const s = useAppStore.getState()
  let cur = intent === 'new-tab' ? null : currentTab(s)
  if (!cur) { s.createTab(type); cur = currentTab() }
  if (!cur) return null
  if (cur.type === type) return arriveInPlace(cur, dest, origin)
  return arriveByTypeChange(cur, dest, origin)
}

/** The destination's type IS the tab's type: navigate the tab itself. */
function arriveInPlace(tab: Tab, d: Destination, origin: NavOrigin): string {
  const s = useAppStore.getState()
  switch (d.kind) {
    case 'passage':
      // The tab is the active Scripture tab (it is on screen), so navigateToVerse targets it.
      navigateToVerse({ bookId: d.bookId, chapter: d.chapter, verse: d.verse, endVerse: d.endVerse ?? null, origin, noteBack: d.noteBack ?? null, ...(d.textId ? { translationOverride: d.textId.toUpperCase() } : {}) })
      applyHighlight(tab.id, d)
      return tab.id
    case 'note': s.requestOpenNote(d.noteId); return tab.id
    case 'strongs': s.openLexiconEntry(d.num); return tab.id
    case 'search': {
      const patch = searchPatch(d)
      s.pushTabNav(tab.id, { type: 'search', title: searchTitle(d), state: patch as unknown as Record<string, unknown> })
      s.updateTabState('search', tab.id, patch)
      s.renameTab('search', tab.id, searchTitle(d))
      noteSearch(d)
      return tab.id
    }
    case 'video':
      s.pushTabNav(tab.id, { type: 'youtube', title: 'YouTube', videoId: d.videoId })
      useAppStore.setState({ pendingYouTubeVideo: { videoId: d.videoId, startTime: d.startTime ?? 0 } })
      return tab.id
  }
}

/** The destination needs another tab type: THIS tab becomes it (history carried; ‹ returns). */
function arriveByTypeChange(tab: Tab, d: Destination, origin: NavOrigin): string | null {
  const s = useAppStore.getState()
  switch (d.kind) {
    case 'passage': {
      const chapter = chapterForBookSwitch(d.bookId, d.chapter)
      const translation = (d.textId ?? resolveTextForBook(currentTranslation(), d.bookId) ?? currentTranslation()).toUpperCase()
      const state: Partial<BibleTabState> = {
        bookId: d.bookId, chapter, targetVerse: d.verse, endVerse: d.endVerse ?? undefined, translation, scrollPosition: 0, compareMode: false,
        noteBack: d.noteBack ?? null,
        ...(d.highlight ? { targetVerseQuery: d.highlight.strongsWords ? undefined : d.highlight.query, targetVerseWordMode: d.highlight.wordMode, targetVerseStrongsWords: d.highlight.strongsWords } : {}),
      }
      const id = s.transformTab(tab.id, 'bible', { state: state as Record<string, unknown> })
      recordNavigation({}, { bookId: d.bookId, chapter, verse: d.verse }, origin)
      return id
    }
    case 'note': {
      const id = s.transformTab(tab.id, 'note', { state: { noteId: d.noteId, isNew: false } })
      // The type change recorded the note as this tab's step; only ask the Notes page to show it.
      useAppStore.setState({ pendingNoteId: d.noteId })
      return id
    }
    case 'strongs': {
      const id = s.transformTab(tab.id, 'lexicon', { state: { strongsNum: d.num } })
      s.addHistoryEntry({ type: 'lexicon', title: d.num, strongsNum: d.num })
      useAppStore.setState({ pendingLexiconEntry: d.num, lexiconNoteBack: null })
      return id
    }
    case 'search': {
      const id = s.transformTab(tab.id, 'search', { state: searchPatch(d) as unknown as Record<string, unknown> })
      if (id) useAppStore.getState().renameTab('search', id, searchTitle(d))
      noteSearch(d)
      return id
    }
    case 'video': {
      const id = s.transformTab(tab.id, 'youtube', { state: { videoId: d.videoId } })
      useAppStore.setState({ pendingYouTubeVideo: { videoId: d.videoId, startTime: d.startTime ?? 0 } })
      return id
    }
  }
}

/** Desktop / external semantics: the destination space's active tab, else a new one. */
function openInExistingTab(d: Destination, origin: NavOrigin): string | null {
  const s = useAppStore.getState()
  switch (d.kind) {
    case 'passage':
      navigateToVerse({ bookId: d.bookId, chapter: d.chapter, verse: d.verse, endVerse: d.endVerse ?? null, origin, noteBack: d.noteBack ?? null, ...(d.textId ? { translationOverride: d.textId.toUpperCase() } : {}) })
      { const id = useAppStore.getState().activeTabId.scripture; if (id) applyHighlight(id, d); return id }
    case 'note': s.ensureTab('note'); s.setActiveSpace('notes'); s.requestOpenNote(d.noteId); return useAppStore.getState().activeTabId.notes
    case 'strongs': s.ensureTab('lexicon'); s.setActiveSpace('lexicon'); s.openLexiconEntry(d.num); return useAppStore.getState().activeTabId.lexicon
    case 'search': s.openSearchTab(d.query); return useAppStore.getState().activeTabId.search
    case 'video': s.openYouTubeVideo(d.videoId, d.startTime ?? 0); return useAppStore.getState().activeTabId.youtube
  }
}

function currentTranslation(): string {
  const s = useAppStore.getState()
  const sc = s.tabs.scripture.find((t) => t.id === s.activeTabId.scripture && t.type === 'bible')
  return ((sc?.state as BibleTabState | undefined)?.translation ?? s.defaultBibleTranslation ?? 'kjva').toLowerCase()
}

function applyHighlight(tabId: string, d: Destination) {
  if (d.kind !== 'passage' || !d.highlight) return
  const h = d.highlight
  useAppStore.getState().updateTabState('scripture', tabId, { targetVerseQuery: h.strongsWords ? undefined : h.query, targetVerseWordMode: h.wordMode, targetVerseStrongsWords: h.strongsWords })
}

function searchPatch(d: Extract<Destination, { kind: 'search' }>): Partial<SearchTabState> {
  return { query: d.query, scope: d.scope ?? 'all', ...(d.filters ? { filters: d.filters } : {}) }
}
const searchTitle = (d: Extract<Destination, { kind: 'search' }>) => (d.query.trim() ? `“${d.query.trim()}”` : 'Search')
function noteSearch(d: Extract<Destination, { kind: 'search' }>) {
  const q = d.query.trim()
  if (!q) return
  const s = useAppStore.getState()
  s.addRecentSearchQuery(q)
  s.addHistoryEntry({ type: 'search', title: `"${q}"`, query: q })
}
