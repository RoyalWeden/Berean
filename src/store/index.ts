import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { SpaceId, Tab, TabState, TabType, MosaicKey, BibleTabState, HistoryEntry, TabNavEntry, VerseTag } from '@/types'
import type { MosaicNode } from 'react-mosaic-component'
import { clampZoom, adjustZoom, ZOOM_DEFAULT } from '@/lib/zoom'
import { bookName } from '@/lib/parseRef'
import { isHermasBook, clampHermasChapter, hermasVariantForTextId } from '@/lib/hermasMap'
import type { UpdateStatus } from '@/types/electron'
import { ttsEngine, activateKokoroBackend } from '@/lib/tts/ttsEngine'
import { debouncedLocalStorage, readThroughLocalStorage } from '@/lib/debouncedStorage'
import { lexiconTitleFor } from '@/lib/lexiconTitle'
import { recordLexiconConnection } from '@/store/studyTrailSlice'
import { recordNavigation } from '@/lib/verseNavigation'
import { YOUTUBE_LOADING_TITLE, youtubeTitleFor } from '@/lib/youtubeTitle'

// Dedicated, NON-debounced localStorage key for the presenter window's text zoom.
// See setViewerFontScale + the storage-event listener at the bottom of this file: the
// main 'berean-app-state' blob is debounced ~500ms and can also be clobbered by the
// other window's stale full-state snapshot, so the presenter's zoom was silently lost
// when its window closed within the debounce window. Nothing else ever touches this key.
// Defined up here (not next to ASK_WHY_SYNC_KEY) because onRehydrateStorage reads it
// synchronously during create() below — referencing a const declared after create()
// would hit the temporal-dead-zone.
const VIEWER_FONT_SCALE_SYNC_KEY = 'berean-viewer-font-scale'

// The main window is the ONLY owner/writer of the persisted 'berean-app-state'
// blob. Secondary windows (?viewer=1 / ?studyTrail=1 / ?float=1) each build their
// own useAppStore from this same module; letting them write the shared key means
// their stale/default full-state snapshot clobbers real settings on the next
// launch (see readThroughLocalStorage). They still rehydrate from it and get
// live updates via IPC push channels.
const IS_SECONDARY_WINDOW = typeof window !== 'undefined' && (() => {
  try {
    const p = new URLSearchParams(window.location.search)
    return p.get('viewer') === '1' || p.get('studyTrail') === '1' || p.get('float') === '1'
  } catch { return false }
})()

export interface WordReplacerRule {
  id: string
  queries: string[]
  replacement: string
  wholeWord: boolean
  enabled: boolean
  /** When set, this rule matches by Strong's number in KJVA tagged text only.
   *  It is ignored by the plain-text applyWordReplacer. */
  strongsNum?: string
}

/** A verse the user has picked out by clicking its verse number in the reader. Purely
 *  transient UI state (never persisted) — drives the floating multi-verse action bar and,
 *  when the user then navigates elsewhere, seeds the Study Trail connection's "from" context
 *  so the trail records why they jumped. */
export interface SelectedVerseRef {
  bookId: string
  chapter: number
  verse: number
  textId: string
}

export const selectedVerseKey = (r: SelectedVerseRef) =>
  `${r.textId}|${r.bookId}|${r.chapter}|${r.verse}`

// History is loaded/paged in chunks of this size (unlimited total, lazy-loaded).
const HISTORY_PAGE_SIZE = 300

const DEFAULT_WORD_REPLACER_RULES: WordReplacerRule[] = [
  // Strong's-number-based rules (KJVA tagged text only — precise per-word matching)
  { id: 'strongs-h3068', queries: [], strongsNum: 'H3068', replacement: 'Yehovah', wholeWord: false, enabled: true },
  // H3069 (Yᵊhōvih) is the divine name pointed to read "Elohim" — KJV renders it "GOD"
  // (all-caps, e.g. "Lord GOD"). It is YHWH, so it is restored to Yehovah as well.
  { id: 'strongs-h3069', queries: [], strongsNum: 'H3069', replacement: 'Yehovah', wholeWord: false, enabled: true },
  { id: 'strongs-h3050', queries: [], strongsNum: 'H3050', replacement: 'Yah',     wholeWord: false, enabled: true },
  // Text-pattern rules (applied across all texts)
  { id: 'a1c3e5f7', queries: ['elseus'],                             replacement: 'Elisha',        wholeWord: false, enabled: true },
  { id: '3b8e241f', queries: ['elias'],                             replacement: 'Elijah',        wholeWord: false, enabled: true },
  { id: '68d22a2b', queries: ['esaias'],                            replacement: 'Isaiah',        wholeWord: false, enabled: true },
  { id: '7b60a59e', queries: ['osee'],                              replacement: 'Hosea',         wholeWord: false, enabled: true },
  { id: '6630754e', queries: ['christ jesus', 'jesus christ'],      replacement: 'Yeshua Messiah',wholeWord: false, enabled: true },
  { id: 'b9f1e2a3', queries: ['christ'],                            replacement: 'Messiah',        wholeWord: true,  enabled: true },
  { id: '914c4d69', queries: ['obdias'],                            replacement: 'Obadiah',       wholeWord: false, enabled: true },
  { id: 'f0ab3f1a', queries: ['jezekiel'],                          replacement: 'Ezekiel',       wholeWord: false, enabled: true },
  { id: '3954462c', queries: ['jeremias', 'jeremy'],                replacement: 'Jeremiah',      wholeWord: false, enabled: true },
  { id: 'af2b57c0', queries: ['zacharias'],                         replacement: 'Zechariah',     wholeWord: false, enabled: true },
  { id: 'afcc27c7', queries: ['malachias'],                         replacement: 'Malachi',       wholeWord: false, enabled: true },
  { id: 'c35d6066', queries: ['aggæus'],                            replacement: 'Haggai',        wholeWord: false, enabled: true },
  { id: 'd12c8d7d', queries: ['sophonias'],                         replacement: 'Zephaniah',     wholeWord: false, enabled: true },
  { id: 'bfa0e688', queries: ['naum'],                              replacement: 'Nahum',         wholeWord: true,  enabled: true },
  { id: '7e62339f', queries: ['jonas'],                             replacement: 'Jonah',         wholeWord: false, enabled: true },
  { id: '95a42357', queries: ['jesus'],                             replacement: 'Yeshua',        wholeWord: false, enabled: true },
  { id: '864afedc', queries: ['michæas'],                           replacement: 'Micah',         wholeWord: false, enabled: true },
  { id: '41e178e6', queries: ['pharao'],                            replacement: 'Pharaoh',       wholeWord: true,  enabled: true },
  { id: 'b6c9a1a1', queries: ['sem'],                               replacement: 'Shem',          wholeWord: true,  enabled: true },
  { id: '5e6698ce', queries: ['noe'],                               replacement: 'Noah',          wholeWord: true,  enabled: true },
  { id: '75c0acbd', queries: ['ambacum'],                           replacement: 'Habakkuk',      wholeWord: false, enabled: true },
  { id: '5a66cdad', queries: ['josias'],                            replacement: 'Josiah',        wholeWord: false, enabled: true },
]

export function updateMRU(
  list: Array<{ spaceId: SpaceId; tabId: string }>,
  spaceId: SpaceId,
  tabId: string
): Array<{ spaceId: SpaceId; tabId: string }> {
  return [{ spaceId, tabId }, ...list.filter(item => !(item.spaceId === spaceId && item.tabId === tabId))].slice(0, 100)
}

/** Universal new-tab placement rule, shared by createTab and addTab so every "new tab" entry
 *  point in the app places tabs consistently instead of it depending on which of those two
 *  functions the call site happened to use (previously: createTab always inserted after the
 *  active tab, addTab always appended at the end, regardless of the calling gesture's actual
 *  intent — e.g. the SAME double-click-empty-space/Cmd+T entry point produced different
 *  placement for a verse result vs. a lexicon result, purely because of which function each
 *  branch called). 'after-active': Cmd+T, any "+" button, "open in new tab" from within content,
 *  floating-search results — the default, so a new tab always appears directly below the tab it
 *  was opened from (per direct user feedback). 'top' is kept for any call site that explicitly
 *  wants the tab pinned to the top of the (single, cross-space) list. 'end': double-click empty
 *  tab-bar space only. Computes the new
 *  sessionDisplayOrders array — callers still separately append the tab itself to
 *  tabs[spaceId] and set it active. */
export function computeInsertOrder(
  state: { tabs: Record<SpaceId, Tab[]>; sessionDisplayOrders: Record<string, string[]>; currentSessionId: string; activeTabId: Record<SpaceId, string | null>; activeSpace: SpaceId },
  newId: string,
  position: 'top' | 'after-active' | 'end' = 'after-active',
): string[] {
  const allSpaces: SpaceId[] = ['scripture', 'notes', 'lexicon', 'youtube', 'search']
  const allTabsBefore = allSpaces.flatMap((sp) => state.tabs[sp] ?? [])
  const stored = state.sessionDisplayOrders[state.currentSessionId] ?? []
  const liveOrder = [
    ...stored.filter((tid) => allTabsBefore.some((t) => t.id === tid)),
    ...allTabsBefore.filter((t) => !stored.includes(t.id)).map((t) => t.id),
  ]
  let insertAt: number
  if (position === 'top') {
    insertAt = 0
  } else if (position === 'end') {
    insertAt = liveOrder.length
  } else {
    const activeTabIdOverall = state.activeTabId[state.activeSpace]
    const activeIdx = activeTabIdOverall ? liveOrder.indexOf(activeTabIdOverall) : -1
    insertAt = activeIdx === -1 ? liveOrder.length : activeIdx + 1
  }
  const newOrder = [...liveOrder]
  newOrder.splice(insertAt, 0, newId)
  return newOrder
}

export interface ArchivedGroup {
  id: string
  label: string          // e.g. "Gen 1" or "Archive — Jun 5 2025 3:42 PM"
  archivedAt: number     // Date.now()
  tabs: Tab[]            // flat list regardless of space
}

export interface Session {
  id: string
  name: string
  icon?: string  // emoji icon for the session
  tabs: Record<SpaceId, Tab[]>
  activeTabId: Record<SpaceId, string | null>
  tabFilter?: TabType | 'all'   // session-specific tab type filter
}

const TYPE_TO_SPACE: Record<TabType, SpaceId> = {
  bible: 'scripture',
  note: 'notes',
  lexicon: 'lexicon',
  youtube: 'youtube',
  search: 'search',
  pdf: 'scripture',   // PDFs open as tabs within the Scripture space
}

// createTab() below always seeds a brand-new Bible tab's state with a hardcoded GEN/1 default —
// never a position the user actually visited. updateTabState()'s Bible-tab branch used to treat
// that placeholder as a legitimate "origin"
// to seed into tabNavStacks whenever the tab's stack was still empty — which it always is right
// after creation — so a single click that both (a) creates a brand-new Bible tab (via
// ensureTab('bible'), e.g. from a Lexicon occurrence link) AND (b) immediately navigates it
// somewhere real produced TWO history entries instead of one: the fabricated Genesis-1 default,
// then the real destination. Back/forward then walked between those two instead of the tab
// actually having a one-entry history that could return you to wherever you came from. Plain
// module-scoped Set, not reactive/persisted store state — this only ever needs to answer "has
// THIS tab id had a real navigation yet," and deliberately resets to empty on every app start
// (a restored/persisted tab's id was never added here this session, so it's never treated as
// fresh — exactly right, since a restored tab's state IS a real prior position).
const freshlyCreatedBibleTabIds = new Set<string>()

/** Writes `scrollPosition` onto a tab's CURRENT (top) nav-stack entry — used to remember where
 *  the reader was before navigation moves away, so Cmd+[ / Cmd+] can restore it. No-op if the
 *  tab has no stack yet or the scroll is undefined/0. */
function stampNavEntryScroll(get: () => AppState, tabId: string, scrollPosition: number | undefined): void {
  if (!scrollPosition || scrollPosition <= 0) return
  const cur = get().tabNavStacks[tabId]
  if (!cur || cur.idx < 0 || !cur.stack[cur.idx]) return
  cur.stack[cur.idx] = { ...cur.stack[cur.idx], scrollPosition }
}

/** Flush the live panel scroll into tab state (synchronous, via the same event tab-switch uses),
 *  then stamp it onto the tab's current nav-stack entry — so Cmd+[ / Cmd+] can return to it. */
function captureActiveScrollIntoNavEntry(get: () => AppState, tabId: string, spaceId: SpaceId): void {
  if (spaceId !== 'scripture') return
  try { window.dispatchEvent(new CustomEvent('berean:saveScrollBeforeTabChange')) } catch { /* no window (tests) */ }
  const tab = get().tabs[spaceId]?.find((t) => t.id === tabId)
  const sp = (tab?.state as { scrollPosition?: number } | undefined)?.scrollPosition
  stampNavEntryScroll(get, tabId, sp)
}

export interface AppState {
  // Navigation
  activeSpace: SpaceId
  tabs: Record<SpaceId, Tab[]>
  activeTabId: Record<SpaceId, string | null>

  // Panel layout
  panelLayout: MosaicNode<MosaicKey> | null
  sidebarCollapsed: boolean
  /** User-resizable sidebar width in px — clamped to [SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH]
   *  (see Sidebar.tsx's drag handle). Persisted like sidebarCollapsed. */
  sidebarWidth: number

  // UI modals
  searchOpen: boolean
  searchMode: 'current' | 'new'
  // Universal new-tab placement rule (see computeInsertOrder) for whatever tab the floating
  // search's 'new' mode ends up creating (navigate()/goToLexicon() in FloatingSearch.tsx read
  // this) — 'top' for Cmd+T/the search "+" button, 'end' only when opened via
  // double-clicking empty tab-bar space. Both currently funnel through this same openSearch
  // call, so this is how they're told apart on the other end.
  searchNewTabPosition: 'top' | 'after-active' | 'end'
  // 'verses' = the floating search only shows scripture/verse results (no notes/
  // lexicon/YouTube sections) — used by the Scripture tab's "Search scripture"
  // button so it reads as a lightweight version of Advanced Search rather than
  // the app-wide mixed search. Resets to 'all' for the normal Cmd+K/Cmd+T open.
  searchScope: 'all' | 'verses'
  settingsOpen: boolean

  // Cross-panel note communication
  pendingNoteId: string | null
  requestOpenNote: (noteId: string) => void
  clearPendingNote: () => void
  pendingVerseFilter: string | null
  filterNotesByVerse: (verseRef: string) => void
  clearVerseFilter: () => void
  noteChangeToken: number
  bumpNoteToken: () => void
  // Bumped by the shared top bar's presenter button when the active tab is Bible —
  // BiblePanel listens and runs its scroll-sync + explicit content push, since that
  // logic depends on internal scroll refs the top bar has no access to.
  presenterPushToken: number
  bumpPresenterPushToken: () => void
  applyExternalTabSync: (payload: {
    tabs: AppState['tabs']; theme?: string; themePreset?: string; updatedAt?: number
    backgroundAnimationEnabled?: boolean; backgroundAnimationStyle?: AppState['backgroundAnimationStyle']
    backgroundAnimationIntensity?: AppState['backgroundAnimationIntensity']
  }) => void

  // Cross-panel lexicon communication
  pendingLexiconEntry: string | null
  openLexiconEntry: (strongsNum: string, fromNote?: { noteId: string; title: string }, depth?: import('@/types/studyTrail').StrongsDepth) => void
  clearLexiconEntry: () => void
  pendingLexiconSearch: string | null
  requestLexiconSearch: (term: string) => void
  clearLexiconSearch: () => void
  // Carry a query from the floating search bar into the Lexicon SPACE/tab's own
  // search box (distinct from pendingLexiconSearch, which the bible right-panel
  // inline Strong's lookup consumes).
  pendingLexiconSearchTab: string | null
  openLexiconSearchTab: (term: string) => void
  clearLexiconSearchTab: () => void
  // Carry a query into the Notes space's own search box.
  pendingNotesSearchTab: string | null
  openNotesSearchTab: (term: string) => void
  clearNotesSearchTab: () => void
  // Carry a query into the YouTube tab's own search box.
  pendingYouTubeSearch: string | null
  openYouTubeSearchTab: (term: string) => void
  clearYouTubeSearch: () => void

  // Bible right-panel triggers (from VerseRow actions)
  pendingRightPanelNoteId: string | null
  pendingRightPanelVerseFilter: string | null
  pendingRightPanelCrossRefVerse: string | null
  openNoteInBiblePanel: (noteId: string) => void
  filterBiblePanelByVerse: (verseRef: string) => void
  openCrossRefsInBiblePanel: (verseRef: string) => void
  clearRightPanelNote: () => void
  clearRightPanelVerseFilter: () => void
  clearRightPanelCrossRef: () => void

  // Highlight change notifications
  highlightChangeToken: number
  bumpHighlightToken: () => void

  // Verse tags (SQLite-backed; this is a cached copy of window.verseTags.list()).
  verseTags: VerseTag[]
  verseTagChangeToken: number
  setVerseTags: (tags: VerseTag[]) => void
  refreshVerseTags: () => Promise<void>
  bumpVerseTagToken: () => void
  tagManagerOpen: boolean
  openTagManager: () => void
  closeTagManager: () => void

  // Search tab
  pendingSearchQuery: string | null
  openSearchTab: (query: string) => void
  clearSearchQuery: () => void

  // Find bar (Cmd+F / type-anywhere in-panel search)
  findBarOpen: boolean
  findBarQuery: string
  findBarAutoOpen: boolean   // true = opened by typing (auto-dismisses); false = Cmd+F (stays until Esc/X)
  findBarWordMode: 'phrase' | 'all' | 'any'
  openFindBar: (autoOpen?: boolean, seedChar?: string) => void
  closeFindBar: () => void
  setFindBarQuery: (q: string) => void
  setFindBarWordMode: (mode: 'phrase' | 'all' | 'any') => void

  // Active panel tracking — last panel that received a mousedown event
  // Used to route Cmd+F to the correct panel's find bar
  activePanelId: 'bible' | 'notes' | 'lexicon'
  setActivePanelId: (id: 'bible' | 'notes' | 'lexicon') => void

  // YouTube video navigation (from note timestamp links — handles tab creation + space switch)
  pendingYouTubeVideo: { videoId: string; startTime: number } | null
  openYouTubeVideo: (videoId: string, startTime?: number, fromNote?: { noteId: string; title: string }) => void
  openYouTubeVideoInNewTab: (videoId: string, startTime?: number) => void
  openPdf: (pdfId: string, title: string, page?: number) => void
  clearPendingYouTubeVideo: () => void

  // Experimental features — off by default; PDF library/viewer is gated behind this
  // pending a fix for unbounded page-canvas memory growth (see ui-polish-july punch list).
  pdfFeatureEnabled: boolean
  setPdfFeatureEnabled: (v: boolean) => void

  // Cached device geolocation, used only to compute real sunrise for the daily-note
  // "day boundary" (dailyNoteUtils.ts's getDailyNoteAnchorDate/dailyNoteToday).
  // Re-fetched once per app launch (see App.tsx); this cached value is used meanwhile
  // and as a fallback if a fresh fetch fails/is denied. null = never resolved — daily
  // notes fall back to plain midnight-boundary behavior.
  dailyNoteLocation: { lat: number; lon: number } | null
  setDailyNoteLocation: (loc: { lat: number; lon: number } | null) => void

  // YouTube playback preferences
  autoPiP: boolean
  setAutoPiP: (v: boolean) => void
  youtubeIsPlaying: boolean
  setYoutubeIsPlaying: (v: boolean) => void

  // AI Scripture Lookup — floating chat panel UI state. Chat content itself
  // (messages/results) lives in berean.db via window.aiLookup, not here.
  aiLookupPanelOpen: boolean
  setAiLookupPanelOpen: (v: boolean) => void
  aiLookupCommentaryOn: boolean
  setAiLookupCommentaryOn: (v: boolean) => void
  /** "Deep search" — an extra AI verification+retry pass before returning results. Slower,
   *  off by default; see electron/ipc/aiLookup.ts's agentic verification step. */
  aiLookupAgenticOn: boolean
  setAiLookupAgenticOn: (v: boolean) => void
  /** "Use current tab as context" toggle — when on, every question also sends whatever's in the
   *  currently active tab (chapter text, note content, lexicon entry, video title) as extra
   *  context. Independent of, and additive with, inline mentions like "this chapter" in the
   *  message itself (see AiLookupPanel.tsx's TAB_CONTEXT_PHRASES). */
  aiLookupUseTabContext: boolean
  setAiLookupUseTabContext: (v: boolean) => void
  aiLookupPanelPos: { x: number; y: number } | null
  setAiLookupPanelPos: (pos: { x: number; y: number }) => void
  /** User-resized dimensions of the Berean Chat panel — null until the user drags the resize
   *  handle at least once, same lazy-persistence pattern as aiLookupPanelPos. */
  aiLookupPanelSize: { width: number; height: number } | null
  setAiLookupPanelSize: (size: { width: number; height: number }) => void
  aiLookupActiveChatId: string | null
  setAiLookupActiveChatId: (id: string | null) => void
  youtubeNoteBack: { noteId: string; title: string } | null
  setYoutubeNoteBack: (note: { noteId: string; title: string } | null) => void
  lexiconNoteBack: { noteId: string; title: string } | null
  setLexiconNoteBack: (note: { noteId: string; title: string } | null) => void

  // Markdown reference modal
  markdownReferenceOpen: boolean
  openMarkdownReference: () => void
  closeMarkdownReference: () => void

  // Dedicated scripture search tab
  openScriptureSearchTab: (query?: string, opts?: { tagIds?: string[]; matchAll?: boolean; tagNames?: string[] }) => void

  // Note auto-ref settings
  noteVerseRefsEnabled: boolean
  noteLexiconRefsEnabled: boolean
  setNoteVerseRefsEnabled: (v: boolean) => void
  setNoteLexiconRefsEnabled: (v: boolean) => void
  // Auto-format pasted verse blocks into styled blockquotes
  noteScriptureBlock: boolean
  setNoteScriptureBlock: (v: boolean) => void
  // Same auto verse/Strong's block formatting, but for the scripture tab's SIDE-PANEL note
  // editor — kept separate so it can be turned off there independently of the main notes.
  sidePanelScriptureBlock: boolean
  setSidePanelScriptureBlock: (v: boolean) => void
  // Focus/Zen writing mode — hides sidebar/rail/top-bar chrome and centers the active note.
  // Scoped to the tab it was turned on for (noteFocusModeTabId), not a single global flag —
  // switching to a different tab should not keep chrome hidden for tabs that never asked for
  // it. Consumers compare `noteFocusModeTabId === theirOwnTabId` themselves (a selector
  // returning a plain value stays reactive; a getter closure returning the same function
  // reference every render would not re-trigger consumers on state change).
  noteFocusModeTabId: string | null
  toggleNoteFocusMode: (tabId: string) => void
  // ── Transient bottom-right layout signals (NOT persisted) ──────────────────
  // Only so the portaled Study Trail arrival toast (StudyTrailArrivalPrompt) can step out
  // of the way of whatever else is currently pinned to the bottom-right corner: the Bible
  // reader's right-hand panel (shift the toast left by its width) and any open note editor,
  // whose word-count/reading-time footer lives in that same corner (nudge the toast up).
  bibleRightPanelWidth: number
  setBibleRightPanelWidth: (v: number) => void
  noteEditorOpenCount: number
  bumpNoteEditorOpen: (delta: number) => void
  // True while the active scripture tab is in Advanced Search mode — the toast stays pinned
  // to the far-right corner there (that view has its own right-edge jump rail; no dodging).
  bibleSearchTabActive: boolean
  setBibleSearchTabActive: (v: boolean) => void
  // True while a popover opened FROM the verse-selection action bar (tag picker / colour
  // picker) is showing — the bottom-right toast lifts further to clear it.
  verseSelectionMenuOpen: boolean
  setVerseSelectionMenuOpen: (v: boolean) => void
  // True only while the verse-selection action bar is ACTUALLY on screen (published by
  // VerseSelectionBar itself from its own render gate). The Study Trail arrival toast keys
  // its "dodge upward" on this rather than re-deriving it from selectedVersesByTab — the two
  // conditions could drift, leaving the toast lifted while no bar is visible.
  verseSelectionBarOpen: boolean
  setVerseSelectionBarOpen: (v: boolean) => void
  // Strong's number of the lexicon entry currently open in the scripture side panel (when
  // it's open + showing lexicon) — ChapterView persistently highlights every occurrence of it
  // in the chapter so you can see where the word you're studying appears. null = nothing.
  chapterEchoStrongsNum: string | null
  setChapterEchoStrongsNum: (v: string | null) => void
  // Minimum fraction (0..1) of verse text that must match to auto-format a block
  noteScriptureBlockThreshold: number
  setNoteScriptureBlockThreshold: (v: number) => void
  // Auto-convert "--" into an em dash (—) while typing in notes
  autoEmDash: boolean
  setAutoEmDash: (v: boolean) => void
  // Suggest inserting a scripture block when user types a verse ref in notes
  noteVerseBlockSuggest: boolean
  setNoteVerseBlockSuggest: (v: boolean) => void
  // Suggest inserting a Strong's block when user types H/G number in notes
  noteStrongsBlockSuggest: boolean
  setNoteStrongsBlockSuggest: (v: boolean) => void

  // Word replacer
  wordReplacerEnabled: boolean
  wordReplacerRules: WordReplacerRule[]
  setWordReplacerEnabled: (v: boolean) => void
  setWordReplacerRules: (rules: WordReplacerRule[]) => void
  toggleWordReplacerRule: (id: string) => void

  // Study Trail — opt-in "why did you jump chapters?" arrival prompt (separate from the
  // always-available tier-3 "?" badge prompt already on each ambiguous connection). Off by
  // default since it's an interruption; lives here (not in useStudyTrailStore, which isn't
  // persisted) so it's a real Settings-backed preference that syncs across the main window and
  // the separate Study Trail window via the shared localStorage persist, same as
  // wordReplacerEnabled above.
  studyTrailAskChapterJumpReason: boolean
  setStudyTrailAskChapterJumpReason: (v: boolean) => void

  // Print & Export settings
  printMarginPreset: 'none' | 'narrow' | 'normal' | 'wide' | 'custom'
  printCustomMargins: { top: number; right: number; bottom: number; left: number }  // inches
  printPaperSize: 'letter' | 'a4' | 'legal'
  printFontSizePt: number
  printFontFamily: 'system' | 'serif' | 'sansserif'
  printIncludeTitle: boolean
  printIncludeLinkedNotes: boolean
  printColorMode: 'color' | 'grayscale'
  printTheme: import('@/lib/notePreviewRender').PrintThemeId
  pdfDownloadLocation: string  // '' = prompt each time
  setPrintTheme: (v: import('@/lib/notePreviewRender').PrintThemeId) => void
  setPrintMarginPreset: (v: 'none' | 'narrow' | 'normal' | 'wide' | 'custom') => void
  setPrintCustomMargins: (v: { top: number; right: number; bottom: number; left: number }) => void
  setPrintPaperSize: (v: 'letter' | 'a4' | 'legal') => void
  setPrintFontSizePt: (v: number) => void
  setPrintFontFamily: (v: 'system' | 'serif' | 'sansserif') => void
  setPrintIncludeTitle: (v: boolean) => void
  setPrintIncludeLinkedNotes: (v: boolean) => void
  setPrintColorMode: (v: 'color' | 'grayscale') => void
  setPdfDownloadLocation: (v: string) => void

  // Note editor preferences
  defaultNoteEditorMode: 'edit' | 'view'
  setDefaultNoteEditorMode: (m: 'edit' | 'view') => void
  confirmNoteDelete: boolean
  setConfirmNoteDelete: (v: boolean) => void
  noteSpellCheck: boolean
  setNoteSpellCheck: (v: boolean) => void
  autoCopyOnHighlight: boolean
  setAutoCopyOnHighlight: (v: boolean) => void
  noteHeadingDivider: boolean
  setNoteHeadingDivider: (v: boolean) => void
  noteBulletStyle: string
  setNoteBulletStyle: (s: string) => void
  // Notes side panel (folder/contents/backlinks) is a floating trigger + card,
  // same treatment as ScriptureSearchView's "jump to book" rail — pinned keeps
  // the card open persistently; unpinned (the default) auto-hides on
  // mouse-leave, only appearing on hover of the trigger pill.
  noteSidePanelPinned: boolean
  setNoteSidePanelPinned: (v: boolean) => void
  // Curated "look" for the note editor while typing — bundles font/line-height/
  // spacing as one named choice (see pmEditor.css's .pm-look-* rules), quick-
  // access via the dropdown next to the Edit/View toggle rather than the fuller,
  // separate font-family picker already in Settings → Display.
  noteTypingLook: string
  setNoteTypingLook: (s: string) => void

  // Idiom notes
  idiomHighlightEnabled: boolean
  setIdiomHighlightEnabled: (v: boolean) => void
  idiomHoverPreviewEnabled: boolean
  setIdiomHoverPreviewEnabled: (v: boolean) => void

  // Two-finger trackpad swipe to open/close the Bible reading panel's right side panel
  swipePanelGestureEnabled: boolean
  setSwipePanelGestureEnabled: (v: boolean) => void
  idiomCache: Array<{ id: string; term: string; meaning: string; aliases: string[]; autoVariants: boolean }>
  setIdiomCache: (v: Array<{ id: string; term: string; meaning: string; aliases: string[]; autoVariants: boolean }>) => void

  // Viewer window state
  viewerWindowOpen: boolean
  setViewerWindowOpen: (v: boolean) => void
  viewerPaused: boolean
  setViewerPaused: (v: boolean) => void
  viewerLaserEnabled: boolean
  setViewerLaserEnabled: (v: boolean) => void
  viewerSelectionMirror: boolean
  setViewerSelectionMirror: (v: boolean) => void
  viewerSidePanelEnabled: boolean
  setViewerSidePanelEnabled: (v: boolean) => void
  viewerBlank: boolean            // when true the presenter shows the idle "awaiting" screen
  setViewerBlank: (v: boolean) => void
  viewerFontScale: number
  setViewerFontScale: (v: number) => void
  viewerTheme: 'system' | 'light' | 'dark'
  setViewerTheme: (v: 'system' | 'light' | 'dark') => void

  // Scripture display preferences
  showVerseNumbers: boolean
  setShowVerseNumbers: (v: boolean) => void
  showRedLetters: boolean
  setShowRedLetters: (v: boolean) => void
  continuousChapterScroll: boolean
  setContinuousChapterScroll: (v: boolean) => void
  continuousDailyScroll: boolean
  setContinuousDailyScroll: (v: boolean) => void

  // Display preferences
  bibleFontSize: number
  bibleLineHeight: 'compact' | 'comfortable' | 'spacious'
  defaultBibleTranslation: string
  // Which Shepherd-of-Hermas translation to read: 'hermas' (Roberts-Donaldson) or
  // 'hermas_taylor' (Charles Taylor 1903). Applied to getTranslationForBook + hermasMap.
  hermasTranslation: string
  setHermasTranslation: (id: string) => void
  // App-update status — a single global subscription to window.app.onUpdateStatus
  // lives in App.tsx and writes here, so any component (the rail's Settings
  // badge, the Settings modal's Updates section) can read the current state
  // without each mounting its own IPC listener (the preload bridge only
  // supports one active listener at a time — see electron/preload.ts).
  updateStatus: UpdateStatus
  setUpdateStatus: (status: UpdateStatus) => void
  updateLastCheckedAt: number | null

  // Shared reading-content zoom multiplier (1 = 100%); driven by Cmd +/- /0
  // and the rail's zoom control. Applied only within reading panes (Scripture,
  // Lexicon, the Notes/Lexicon/Scripture side panel) — never to the app shell
  // itself, so the sidebar/rail/tab list stay a fixed size regardless of zoom.
  appZoom: number
  setAppZoom: (level: number) => void
  adjustAppZoom: (dir: 1 | -1) => void
  resetAppZoom: () => void
  setBibleFontSize: (size: number) => void
  setBibleLineHeight: (h: 'compact' | 'comfortable' | 'spacious') => void
  setDefaultBibleTranslation: (id: string) => void
  defaultScriptureLayout: import('@/types').ScriptureLayout
  setDefaultScriptureLayout: (layout: import('@/types').ScriptureLayout) => void
  noteTransformLayout: 'right' | 'bottom' | 'left'
  setNoteTransformLayout: (layout: 'right' | 'bottom' | 'left') => void

  // Cross-reference source preference
  crossRefSource: 'tske' | 'classic' | 'notes'
  setCrossRefSource: (s: 'tske' | 'classic' | 'notes') => void

  // Sidebar new-tab button style
  floatingSearchDensity: 'compact' | 'comfortable' | 'spacious'
  setFloatingSearchDensity: (d: 'compact' | 'comfortable' | 'spacious') => void
  defaultYoutubeLayout: import('@/types').YouTubeLayout
  setDefaultYoutubeLayout: (l: import('@/types').YouTubeLayout) => void

  // Theme — base + optional preset overlay
  theme: 'dark' | 'light' | 'system'
  themePreset: string  // '' = default, 'system-accent', or one of the preset class names
  setThemePreset: (preset: string) => void

  // Ambient background animation — see src/lib/themePresets.ts's AnimationStyle/AnimationIntensity
  // comments and ThemePicker.tsx for how these combine with a preset's own curated
  // `animationStyle`. Off by default: a handful of presets carry their own signature animation
  // regardless of this toggle (see ANIMATED_PRESET_IDS) — this is the separate "apply one to ANY
  // theme" switch.
  backgroundAnimationEnabled: boolean
  setBackgroundAnimationEnabled: (v: boolean) => void
  // 'auto' = use the active preset's own curated style if it has one, else 'drift'.
  backgroundAnimationStyle: 'auto' | import('@/lib/themePresets').AnimationStyle
  setBackgroundAnimationStyle: (v: AppState['backgroundAnimationStyle']) => void
  backgroundAnimationIntensity: import('@/lib/themePresets').AnimationIntensity
  setBackgroundAnimationIntensity: (v: AppState['backgroundAnimationIntensity']) => void
  // Live macOS accent color ("r g b" string, matching the other palette fields) — runtime
  // only, not persisted; populated from systemPreferences.getAccentColor() via IPC and kept
  // live via the 'accent-color-changed' event. Backs the 'system-accent' theme preset.
  systemAccentColor: string | null
  setSystemAccentColor: (v: string | null) => void

  // 'throttled' when on battery power or under macOS thermal pressure — runtime only, not
  // persisted; populated via IPC (electron/powerAwareness.ts). Background-polling consumers
  // (YouTubeTab's re-injection/transcript-sync intervals) stretch their cadence when set.
  resourceMode: 'normal' | 'throttled'
  setResourceMode: (v: 'normal' | 'throttled') => void

  // Per-section font families
  scriptureFontFamily: string
  notesFontFamily: string
  uiFontFamily: string
  setScriptureFontFamily: (family: string) => void
  setNotesFontFamily: (family: string) => void
  setUiFontFamily: (family: string) => void

  // Tracks when each tab was last made active; key = "{spaceId}:{tabId}"
  tabLastAccessed: Record<string, number>

  // MRU tab list (most-recently-used order, used by Ctrl+Tab switcher)
  tabMRUList: Array<{ spaceId: SpaceId; tabId: string }>

  // Archived tabs — closed tabs kept for later recovery
  archivedGroups: ArchivedGroup[]
  archiveTab: (spaceId: SpaceId, tabId: string) => void
  archiveAllTabs: (label?: string) => void
  restoreArchivedGroup: (groupId: string) => void
  dismissArchivedGroup: (groupId: string) => void
  clearAllArchivedGroups: () => void

  // Sessions
  sessions: Session[]
  currentSessionId: string
  sessionDisplayOrders: Record<string, string[]>        // keyed by session ID — custom tab display order
  createSession: (name?: string) => void
  switchSession: (id: string) => void
  renameSession: (id: string, name: string) => void
  setSessionIcon: (id: string, icon: string) => void
  deleteSession: (id: string) => void
  moveTabToSession: (spaceId: SpaceId, tabId: string, targetSessionId: string) => void
  reorderTabDisplay: (sessionId: string, fromId: string, toId: string, before: boolean) => void

  // Actions
  setActiveSpace: (space: SpaceId) => void
  /** `position` defaults to 'after-active' (Cmd+T/"+"/"open in new tab" from content) —
   *  pass 'end' only for the double-click-empty-tab-bar-space case. */
  addTab: (tab: Tab, position?: 'top' | 'after-active' | 'end') => void
  createTab: (type: TabType, position?: 'top' | 'after-active' | 'end') => void
  ensureTab: (type: TabType) => void
  closeTab: (spaceId: SpaceId, tabId: string) => void
  closeActiveTab: () => void
  setActiveTab: (spaceId: SpaceId, tabId: string) => void
  activateTab: (tab: Tab) => void
  renameTab: (spaceId: SpaceId, tabId: string, title: string) => void
  reorderTabs: (spaceId: SpaceId, fromIndex: number, toIndex: number) => void
  updateTabState: (spaceId: SpaceId, tabId: string, newState: Partial<TabState>) => void
  updatePanelLayout: (layout: MosaicNode<MosaicKey> | null) => void
  toggleSidebar: () => void
  setSidebarWidth: (width: number) => void
  openSearch: (mode?: 'current' | 'new', scope?: 'all' | 'verses', newTabPosition?: 'top' | 'after-active' | 'end') => void
  closeSearch: () => void

  // Recent search queries (persisted, max 10)
  recentSearchQueries: string[]
  addRecentSearchQuery: (q: string) => void
  openSettings: () => void
  openSettingsToSessions: () => void
  openSettingsToAbout: () => void
  openSettingsToAudio: () => void
  closeSettings: () => void
  toggleSettings: () => void
  setTheme: (theme: 'dark' | 'light' | 'system') => void
  autoCloseTabsAfter: number  // milliseconds; 0 = never
  setAutoCloseTabsAfter: (ms: number) => void

  // History — chronological log of everything the user opens
  // Stored in SQLite (history table); the in-memory array is the UI view.
  history: HistoryEntry[]
  historyOpen: boolean
  historySeenLength: number
  historyLoaded: boolean  // true once the SQLite load completes on mount
  historyHasMore: boolean       // older pages remain in SQLite
  historyLoadingMore: boolean
  loadMoreHistory: () => Promise<void>
  // History collapse memory — days/sessions are collapsed by default; these persist the
  // keys the user has explicitly EXPANDED so the state survives reopening / restart.
  historyExpandedDays: string[]
  historyExpandedSessions: string[]
  historyAutoExpandedKey: string | null   // most-recent session auto-expanded once
  toggleHistoryExpandedDay: (key: string) => void
  toggleHistoryExpandedSession: (key: string) => void
  setHistoryExpanded: (days: string[], sessions: string[]) => void
  autoExpandHistorySession: (dayKey: string, sessionKey: string) => void
  addHistoryEntry: (entry: Omit<HistoryEntry, 'id' | 'timestamp' | 'sessionId' | 'sessionName'>) => void
  setHistory: (entries: HistoryEntry[]) => void
  deleteHistoryEntry: (id: string) => void
  clearHistory: () => void
  openHistory: () => void
  closeHistory: () => void

  // Onboarding
  onboardingOpen: boolean
  onboardingCompleted: boolean
  openOnboarding: () => void
  closeOnboarding: () => void
  completeOnboarding: () => void

  // Getting-started task checklist
  tasksVisible: boolean         // panel rendered at all
  tasksMinimized: boolean       // collapsed to chip
  completedTaskIds: string[]    // task ids fully done (kept for compat)
  completedStepIds: string[]    // "taskId:stepId" — per-step completion (persisted)
  verseNoteToken: number        // bumped when a verse note is created via verse popover
  strongsHoverToken: number     // bumped when a Strong's tooltip opens (hover detected)
  versePopoverToken: number     // bumped when the verse number popover opens
  /** Verses picked out via verse-number click, in click order — keyed by the scripture
   *  tab they were selected on, so each tab keeps its own selection and the floating
   *  action bar only shows for the tab you're actually on. Consumed + cleared by
   *  scripture navigation (verseNavigation.ts) to seed the Study Trail "from" context. */
  selectedVersesByTab: Record<string, SelectedVerseRef[]>
  noteEditToken: number         // bumped when note content is meaningfully edited
  tableInsertToken: number      // bumped when a table is inserted via toolbar
  settingsNavToken: number      // bumped when user navigates to a settings section
  floatingTabToken: number      // bumped when a tab is opened in a floating window
  youtubePipToken: number       // bumped when Picture-in-Picture is activated
  vaultSyncToken: number        // bumped when vault sync is enabled in settings
  openTasks: () => void
  closeTasks: () => void
  minimizeTasks: () => void
  unminimizeTasks: () => void
  completeTask: (id: string) => void
  completeStep: (taskId: string, stepId: string) => void
  bumpVerseNoteToken: () => void
  bumpStrongsHoverToken: () => void
  bumpVersePopoverToken: () => void
  /** `tabId` omitted/null → the active scripture tab. */
  toggleVerseSelection: (tabId: string | null | undefined, ref: SelectedVerseRef) => void
  clearVerseSelection: (tabId?: string | null) => void
  remapVerseSelection: (tabId: string | null | undefined, remap: (ref: SelectedVerseRef) => SelectedVerseRef | null) => void
  bumpNoteEditToken: () => void
  bumpTableInsertToken: () => void
  bumpSettingsNavToken: () => void
  bumpFloatingTabToken: () => void
  bumpYoutubePipToken: () => void
  bumpVaultSyncToken: () => void
  resetTasks: () => void

  // Saved workspaces (loaded from SQLite on demand)
  savedWorkspaces: import('@/types/electron').SavedWorkspace[]
  setSavedWorkspaces: (ws: import('@/types/electron').SavedWorkspace[]) => void

  // Import modal (non-persisted)
  importModalOpen: boolean
  importInitialTab: 'biblegateway' | 'esword'
  openImportModal: () => void
  openImportBibleGateway: () => void
  openImportESword: () => void
  closeImportModal: () => void
  settingsInitialSection: string
  // The section the user last manually navigated to inside Settings (as opposed to
  // settingsInitialSection, which is a one-shot override for deep links like "Get more natural
  // voices…" → Audio). Generic open entry points (gear icon, ⌘,) reopen here instead of always
  // resetting to Appearance. Persisted so it also survives an app restart.
  lastSettingsSection: string
  setLastSettingsSection: (section: string) => void
  // Scroll position within each Settings section's content pane, keyed by section id — restored
  // on reopen/section-switch so revisiting a section (or reopening Settings entirely) doesn't
  // reset it to the top.
  settingsSectionScrollTop: Record<string, number>
  setSettingsSectionScrollTop: (section: string, top: number) => void

  // BibleGateway import progress (non-persisted — runtime only)
  bgImportPhase: 'idle' | 'login' | 'fetching' | 'review' | 'saving' | 'done' | 'error'
  bgImportDone: number
  bgImportTotal: number
  bgImportMessage: string
  bgImportReviewNotes: import('@/types/electron').BgImportReviewNote[]
  setBgImportProgress: (p: { phase: 'idle' | 'login' | 'fetching' | 'review' | 'saving' | 'done' | 'error'; done?: number; total?: number; message?: string; reviewNotes?: import('@/types/electron').BgImportReviewNote[] }) => void
  resetBgImport: () => void

  // e-Sword import progress (non-persisted — runtime only)
  eSwordPhase: import('@/types/electron').ESwordPhase
  eSwordDone: number
  eSwordTotal: number
  eSwordMessage: string
  eSwordReviewNotes: import('@/types/electron').ESwordReviewNote[]
  setESwordProgress: (p: { phase: import('@/types/electron').ESwordPhase; done?: number; total?: number; message?: string; reviewNotes?: import('@/types/electron').ESwordReviewNote[] }) => void
  resetESword: () => void

  // Per-tab navigation stacks — back/forward scoped to the active tab only.
  // idx can reach -1 for note/lexicon tabs, representing "the list/search view"
  // (no item open) as a real, back/forward-reachable position rather than a
  // dead end — this is what lets the top bar's nav pill replace each panel's
  // own local Home/Back-to-list buttons.
  tabNavStacks: Record<string, { stack: TabNavEntry[]; idx: number }>
  isNavJumping: boolean
  pushTabNav: (tabId: string, entry: Omit<TabNavEntry, 'id'>) => void
  navTabBack: () => void
  navTabForward: () => void
  goToTabHome: () => void
  resetTabNavHome: (tabId: string) => void
  notesHomeToken: number
  bumpNotesHomeToken: () => void
  lexiconHomeToken: number
  bumpLexiconHomeToken: () => void
  youtubeHomeToken: number
  bumpYouTubeHomeToken: () => void

  // History settings
  tabNavMaxStack: number           // max entries per-tab back/forward stack (default 100)
  historyMaxEntries: number        // max entries kept in the SQLite history log (default 500)
  setTabNavMaxStack: (n: number) => void
  setHistoryMaxEntries: (n: number) => void
  clearAllTabNavStacks: () => void

  // ── Read Aloud (TTS playback) ────────────────────────────────────────────
  // Live playback state — NOT persisted (no playback-position persistence across restarts,
  // per plan). Actions call into the ttsEngine singleton (src/lib/tts/ttsEngine.ts) and
  // mirror its callbacks back into this state; useTTSPlayback.ts (mounted once at App.tsx
  // root) owns the actual orchestration/auto-advance and drives these actions.
  audioPlayback: AudioPlaybackState | null
  setAudioPlayback: (state: AudioPlaybackState | Partial<AudioPlaybackState> | null) => void
  // Bumped whenever startPlaybackFrom is called — useTTSPlayback.ts watches this token
  // (not audioPlayback itself, which it also writes to) to know when a NEW playback request
  // came in vs. its own state mirroring writes.
  audioPlaybackRequestToken: number
  startPlaybackFrom: (bookId: string, chapter: number, verseNum: number, textId: string, endVerse?: number | null) => void
  stopPlayback: () => void
  togglePlayPause: () => void
  skipVerseToken: number
  skipVerseDirection: 'prev' | 'next' | null
  skipVerse: (direction: 'prev' | 'next') => void
  // Absolute seek — the chapter progress bar (AudioPlayer.tsx) dragging to a specific verse.
  seekToken: number
  seekTargetVerseNum: number | null
  seekToVerse: (verseNum: number) => void

  // ── Read Aloud playlists / queue ────────────────────────────────────────
  // A freeform, reorderable queue of chapters to play back to back — replaces the old
  // "chapter-end always advances to the next chapter of the same book" as the ONLY option.
  // Live/runtime, not persisted directly (the queue itself is ephemeral; SAVING it as a named
  // playlist goes through window.playlists, which IS durable — see AudioQueuePopover.tsx).
  // Empty queue = ordinary single-chapter playback, unchanged from before this feature.
  playbackQueue: PlaybackQueueItem[]
  playbackQueueIndex: number          // index of the currently-playing item, -1 = no queue active
  playbackQueueSourcePlaylistId: string | null   // set when this queue was loaded FROM a saved playlist, so "Save" can overwrite it instead of always forking a new one
  playbackQueueSourcePlaylistName: string | null
  setPlaybackQueue: (items: PlaybackQueueItem[], sourcePlaylistId?: string | null, sourcePlaylistName?: string | null) => void
  /** Links the CURRENT queue (items/index untouched) to a saved playlist — used right after a
   *  manual "Save as playlist" so subsequent edits autosave (see useQueueAutosave.ts) without
   *  requiring the queue to be reloaded first. setPlaybackQueue itself isn't reused for this
   *  because it also resets playbackQueueIndex, which would jump an in-progress playback
   *  position back to the start. */
  linkPlaybackQueueToPlaylist: (id: string, name: string) => void
  addToPlaybackQueue: (item: PlaybackQueueItem) => void
  removeFromPlaybackQueue: (index: number) => void
  reorderPlaybackQueue: (fromIndex: number, toIndex: number) => void
  clearPlaybackQueue: () => void
  /** Starts (or resumes) playback at queue[index] and marks it current. */
  playQueueIndex: (index: number) => void

  // Whether the "Playlist queue" popover (AudioQueuePopover.tsx) is open, and where it's
  // currently positioned on screen — persisted (unlike the queue contents themselves) so
  // closing/reopening it, or restarting the app, doesn't reset it back to its default spot
  // every time.
  queuePopoverOpen: boolean
  queuePopoverPos: { x: number; y: number } | null
  setQueuePopoverOpen: (v: boolean) => void
  setQueuePopoverPos: (pos: { x: number; y: number }) => void

  // Study Trail's reason/note popover — same "remember where it was last dragged to" pattern
  // as queuePopoverPos above. null means "not dragged yet, use the default top-right dock."
  reasonPromptPopoverPos: { x: number; y: number } | null
  setReasonPromptPopoverPos: (pos: { x: number; y: number }) => void

  // Read Aloud preferences — persisted like other display settings.
  ttsVoiceURI: string | null
  ttsRate: number
  ttsHighlightWordsEnabled: boolean
  ttsAutoAdvanceEnabled: boolean
  ttsAutoAdvancePauseSec: number
  // Whether starting playback while the floating player is CLOSED (audioPlayback === null)
  // immediately plays audio, or just opens the player at the target position, paused — see
  // startPlaybackFrom's own comment. Doesn't affect resuming/continuing an already-open player
  // (explicit play/pause clicks, auto-advance) — only the "cold open" case.
  ttsAutoplayOnOpen: boolean
  setTTSVoiceURI: (v: string | null) => void
  setTTSRate: (v: number) => void
  setTTSHighlightWordsEnabled: (v: boolean) => void
  setTTSAutoAdvanceEnabled: (v: boolean) => void
  setTTSAutoAdvancePauseSec: (v: number) => void
  setTTSAutoplayOnOpen: (v: boolean) => void

  // Whether the Kokoro voice pack is present and the real backend is live. NOT persisted — it's
  // re-checked via IPC on every launch, since the model files can be deleted externally (or by
  // Settings' own "remove model"). Kokoro is the ONLY engine now (the Web Speech backend was
  // removed — see ttsEngine.ts), so this doubles as "is Read Aloud usable at all": while it's
  // false, ttsEngine delegates to an inert no-op backend rather than a fallback engine.
  kokoroModelReady: boolean
  setKokoroModelReady: (v: boolean) => void
}

/** Live (non-persisted) Read Aloud playback state. `finished` marks a clean stop at the end
 *  of the whole Bible (auto-advance ran out of `getNextChapterRef` results) — distinct from
 *  a user-initiated stop, so the floating player can show a "finished" state briefly instead
 *  of just vanishing. */
export interface AudioPlaybackState {
  isPlaying: boolean
  isPaused: boolean
  textId: string
  bookId: string
  chapter: number
  verse: number
  wordIndex: number | null
  finished: boolean
  // Null = play to the end of the chapter (the default, unchanged behavior). When set, playback
  // stops after this verse instead of continuing through the rest of the chapter — see
  // useTTSPlayback.ts, which truncates the spoken queue to this verse before handing it to
  // ttsEngine, so "chapter end" (auto-advance, onChapterEnd) fires right after it rather than
  // needing the engine itself to understand verse ranges.
  endVerse: number | null
}

/** One entry in the Read Aloud playback queue (see "Read Aloud playlists / queue" below) — a
 *  chapter, or a verse range within/across chapters, to speak as part of a freeform playlist.
 *  playQueueIndex passes startVerse/endVerse straight through to startPlaybackFrom, which
 *  useTTSPlayback.ts uses to truncate the spoken queue right after endVerse (null = play to the
 *  end of the chapter, same as plain single-chapter playback). */
export interface PlaybackQueueItem {
  bookId: string
  chapter: number
  startVerse: number
  endVerse: number | null
  textId: string
  /** Display label (e.g. "Genesis 1", "Psalm 23") — computed once when added to the queue so the
   *  popover doesn't need book-name lookups for a list that mostly just sits there. */
  label: string
}

const DEFAULT_TABS: Record<SpaceId, Tab[]> = {
  scripture: [],
  notes: [],
  lexicon: [],
  youtube: [],
  search: []
}

const DEFAULT_ACTIVE_TAB: Record<SpaceId, string | null> = {
  scripture: null,
  notes: null,
  lexicon: null,
  youtube: null,
  search: null
}

const DEFAULT_SESSION: Session = {
  id: 'default',
  name: 'Session 1',
  tabs: DEFAULT_TABS,
  activeTabId: DEFAULT_ACTIVE_TAB,
}

const DEFAULT_PANEL_LAYOUT: MosaicNode<MosaicKey> = {
  direction: 'row',
  first: 'bible-panel',
  second: 'notes-panel',
  splitPercentage: 58
}


// Guard for applyExternalTabSync (below) — cross-window tab sync previously applied whatever
// any other Berean window last broadcast unconditionally, with no ordering check at all. If a
// second window (e.g. a floating tab, opened via TabBar's "Open in floating tab") broadcasts an
// older snapshot after this window's own more recent local change, that blind overwrite would
// silently revert the local change a moment later. Not a reactive/observable value — it only
// ever needs to gate one function's own logic — so a plain module-level variable, not store
// state, is enough; keeping it out of the store also means it survives independently of
// whatever `set()` calls happen to run.
let lastAppliedTabSyncAt = 0

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      activeSpace: 'scripture' as SpaceId,
      tabs: DEFAULT_TABS,
      activeTabId: DEFAULT_ACTIVE_TAB,
      tabMRUList: [] as Array<{ spaceId: SpaceId; tabId: string }>,
      tabLastAccessed: {} as Record<string, number>,
      panelLayout: DEFAULT_PANEL_LAYOUT,
      sidebarCollapsed: false,
      sidebarWidth: 240,
      searchOpen: false,
      searchMode: 'current' as const,
      searchNewTabPosition: 'top' as const,
      searchScope: 'all' as const,
      settingsOpen: false,
      pendingNoteId: null,
      pendingVerseFilter: null,
      noteChangeToken: 0,
      presenterPushToken: 0,
      pendingLexiconEntry: null,
      pendingLexiconSearch: null,
      pendingLexiconSearchTab: null,
      pendingNotesSearchTab: null,
      pendingYouTubeSearch: null,
      pendingRightPanelNoteId: null,
      pendingRightPanelVerseFilter: null,
      pendingRightPanelCrossRefVerse: null,
      highlightChangeToken: 0,
      verseTags: [] as VerseTag[],
      verseTagChangeToken: 0,
      tagManagerOpen: false,
      pendingSearchQuery: null,
      findBarOpen: false,
      findBarQuery: '',
      findBarAutoOpen: false,
      findBarWordMode: 'phrase' as 'phrase' | 'all' | 'any',
      openFindBar: (autoOpen = false, seedChar = '') => {
        window.dispatchEvent(new CustomEvent('berean:closeMenus'))
        set({ findBarOpen: true, findBarAutoOpen: autoOpen, findBarQuery: seedChar })
      },
      closeFindBar: () => set({ findBarOpen: false, findBarQuery: '', findBarAutoOpen: false }),
      setFindBarQuery: (q) => set({ findBarQuery: q }),
      setFindBarWordMode: (mode) => set({ findBarWordMode: mode }),
      activePanelId: 'bible' as 'bible' | 'notes' | 'lexicon',
      setActivePanelId: (id) => set({ activePanelId: id }),
      updateStatus: { status: 'idle' } as UpdateStatus,
      setUpdateStatus: (status) => set({
        updateStatus: status,
        // Terminal-ish states (not the transient "checking") mark when we
        // last actually heard back from the update feed.
        ...(status.status !== 'checking' ? { updateLastCheckedAt: Date.now() } : {}),
      }),
      updateLastCheckedAt: null,
      bibleFontSize: 16,
      appZoom: ZOOM_DEFAULT,
      bibleLineHeight: 'comfortable' as const,
      defaultBibleTranslation: 'kjva',
      hermasTranslation: 'hermas_taylor',
      setHermasTranslation: (id) => {
        const textId = id === 'hermas_taylor' ? 'hermas_taylor' : 'hermas'
        const variant = hermasVariantForTextId(textId)
        const upper = textId.toUpperCase()
        set((state) => {
          // Live-update any open Hermas bible tabs to the new translation, clamping the
          // chapter to one that's valid in the target db (RD and Taylor differ).
          let changed = false
          const tabs = { ...state.tabs }
          for (const space of Object.keys(tabs) as SpaceId[]) {
            tabs[space] = tabs[space].map((t) => {
              if (t.type !== 'bible') return t
              const st = t.state as BibleTabState
              if (!isHermasBook(st.bookId)) return t
              if ((st.translation ?? '').toLowerCase() === textId) return t
              changed = true
              return { ...t, state: { ...st, translation: upper, chapter: clampHermasChapter(st.bookId, st.chapter, variant) } }
            })
          }
          return { hermasTranslation: textId, tabs: changed ? tabs : state.tabs }
        })
      },
      theme: 'system' as const,
      themePreset: '',
      setThemePreset: (preset) => set({ themePreset: preset }),
      backgroundAnimationEnabled: false,
      setBackgroundAnimationEnabled: (v) => set({ backgroundAnimationEnabled: v }),
      backgroundAnimationStyle: 'auto',
      setBackgroundAnimationStyle: (v) => set({ backgroundAnimationStyle: v }),
      backgroundAnimationIntensity: 'noticeable',
      setBackgroundAnimationIntensity: (v) => set({ backgroundAnimationIntensity: v }),
      systemAccentColor: null,
      setSystemAccentColor: (v) => set({ systemAccentColor: v }),

      resourceMode: 'normal',
      setResourceMode: (v) => set({ resourceMode: v }),
      scriptureFontFamily: 'system',
      notesFontFamily: 'system',
      uiFontFamily: 'system',
      setScriptureFontFamily: (family) => set({ scriptureFontFamily: family }),
      setNotesFontFamily: (family) => set({ notesFontFamily: family }),
      setUiFontFamily: (family) => set({ uiFontFamily: family }),
      autoCloseTabsAfter: 0,
      setAutoCloseTabsAfter: (ms) => set({ autoCloseTabsAfter: ms }),

      history: [] as HistoryEntry[],
      historyOpen: false,
      historySeenLength: 0,
      historyLoaded: false,
      historyHasMore: false,
      historyLoadingMore: false,
      historyExpandedDays: [] as string[],
      historyExpandedSessions: [] as string[],
      historyAutoExpandedKey: null as string | null,
      toggleHistoryExpandedDay: (key) => set((s) => ({
        historyExpandedDays: s.historyExpandedDays.includes(key)
          ? s.historyExpandedDays.filter(k => k !== key)
          : [...s.historyExpandedDays, key],
      })),
      toggleHistoryExpandedSession: (key) => set((s) => ({
        historyExpandedSessions: s.historyExpandedSessions.includes(key)
          ? s.historyExpandedSessions.filter(k => k !== key)
          : [...s.historyExpandedSessions, key],
      })),
      setHistoryExpanded: (days, sessions) => set({ historyExpandedDays: days, historyExpandedSessions: sessions }),
      // Auto-expand the active/most-recent session once. If the user later collapses it,
      // we won't re-expand because historyAutoExpandedKey still matches sessionKey.
      autoExpandHistorySession: (dayKey, sessionKey) => set((s) => {
        if (s.historyAutoExpandedKey === sessionKey) return {}
        return {
          historyAutoExpandedKey: sessionKey,
          historyExpandedDays: s.historyExpandedDays.includes(dayKey) ? s.historyExpandedDays : [...s.historyExpandedDays, dayKey],
          historyExpandedSessions: s.historyExpandedSessions.includes(sessionKey) ? s.historyExpandedSessions : [...s.historyExpandedSessions, sessionKey],
        }
      }),
      addHistoryEntry: (entry) => {
        const state = get()
        const currentSession = state.sessions.find(s => s.id === state.currentSessionId)
        const newEntry: HistoryEntry = {
          ...entry,
          id: `hist-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          timestamp: Date.now(),
          sessionId: state.currentSessionId,
          sessionName: currentSession?.name,
        }
        set((s) => {
          const prev = s.history
          // Skip if the very last entry is identical AND recent (prevents duplicates from
          // re-renders/restores within the same visit). Without the time bound, revisiting the
          // same reference after a long gap (e.g. the app restoring the last-viewed chapter on a
          // fresh launch days later) would be silently dropped, leaving that day missing from
          // history entirely.
          const HISTORY_DEDUP_WINDOW_MS = 5 * 60 * 1000
          const last = prev[0]
          if (last &&
            newEntry.timestamp - last.timestamp < HISTORY_DEDUP_WINDOW_MS &&
            last.type === newEntry.type &&
            last.bookId === newEntry.bookId &&
            last.chapter === newEntry.chapter &&
            last.verse === newEntry.verse &&
            last.noteId === newEntry.noteId &&
            last.strongsNum === newEntry.strongsNum &&
            last.videoId === newEntry.videoId &&
            last.query === newEntry.query &&
            (last.searchTagFilter ?? []).join(',') === (newEntry.searchTagFilter ?? []).join(',') &&
            last.parentId === newEntry.parentId
          ) return {}
          // Capped in memory (full history always lives in SQLite regardless — this only
          // bounds the in-memory copy) — a long single session with a lot of navigation grew
          // this array without limit. Trims from the tail (oldest), including any older pages
          // pulled in via loadMoreHistory; if the user paged deep into history and then keeps
          // navigating past the cap, re-opening the History modal re-pages those back in.
          const HISTORY_MEMORY_CAP = 1000
          const next = [newEntry, ...prev]
          return { history: next.length > HISTORY_MEMORY_CAP ? next.slice(0, HISTORY_MEMORY_CAP) : next }
        })
        // Persist to SQLite (non-blocking), pruning to the user's configured cap
        window.appHistory?.add(newEntry, get().historyMaxEntries).catch(() => {})
      },
      setHistory: (entries) => set({ history: entries, historyLoaded: true, historyHasMore: entries.length >= HISTORY_PAGE_SIZE }),
      loadMoreHistory: async () => {
        const s = get()
        if (s.historyLoadingMore || !s.historyHasMore || s.history.length === 0) return
        set({ historyLoadingMore: true })
        const oldest = s.history[s.history.length - 1]?.timestamp ?? Date.now()
        try {
          const older = await window.appHistory?.getPage(oldest, HISTORY_PAGE_SIZE) ?? []
          set((cur) => ({
            history: [...cur.history, ...older],
            historyHasMore: older.length >= HISTORY_PAGE_SIZE,
            historyLoadingMore: false,
          }))
        } catch {
          set({ historyLoadingMore: false })
        }
      },
      deleteHistoryEntry: (id) => {
        set((s) => ({ history: s.history.filter(e => e.id !== id) }))
        window.appHistory?.delete(id).catch(() => {})
      },
      clearHistory: () => {
        set({ history: [], historyHasMore: false })
        window.appHistory?.clear().catch(() => {})
      },
      openHistory: () => set((s) => ({ historyOpen: !s.historyOpen, historySeenLength: s.history.length })),
      closeHistory: () => set({ historyOpen: false }),

      onboardingOpen: false,
      onboardingCompleted: false,
      openOnboarding: () => set({ onboardingOpen: true }),
      closeOnboarding: () => set({ onboardingOpen: false }),
      completeOnboarding: () => {
        set({ onboardingOpen: false, onboardingCompleted: true, tasksVisible: true, tasksMinimized: false })
        window.settings?.set('onboardingCompleted', true).catch(() => {})
      },

      tasksVisible: false,
      tasksMinimized: false,
      completedTaskIds: [] as string[],
      completedStepIds: [] as string[],
      verseNoteToken: 0,
      strongsHoverToken: 0,
      versePopoverToken: 0,
      selectedVersesByTab: {} as Record<string, SelectedVerseRef[]>,
      noteEditToken: 0,
      tableInsertToken: 0,
      settingsNavToken: 0,
      floatingTabToken: 0,
      youtubePipToken: 0,
      vaultSyncToken: 0,
      openTasks: () => set({ tasksVisible: true, tasksMinimized: false }),
      closeTasks: () => set({ tasksVisible: false }),
      minimizeTasks: () => set({ tasksMinimized: true }),
      unminimizeTasks: () => set({ tasksMinimized: false }),
      completeTask: (id) => set((s) => ({
        completedTaskIds: s.completedTaskIds.includes(id) ? s.completedTaskIds : [...s.completedTaskIds, id],
      })),
      completeStep: (taskId, stepId) => set((s) => {
        const key = `${taskId}:${stepId}`
        return { completedStepIds: s.completedStepIds.includes(key) ? s.completedStepIds : [...s.completedStepIds, key] }
      }),
      bumpVerseNoteToken: () => set((s) => ({ verseNoteToken: s.verseNoteToken + 1 })),
      bumpStrongsHoverToken: () => set((s) => ({ strongsHoverToken: s.strongsHoverToken + 1 })),
      bumpVersePopoverToken: () => set((s) => ({ versePopoverToken: s.versePopoverToken + 1 })),
      toggleVerseSelection: (tabId, ref) => set((s) => {
        const tid = tabId ?? s.activeTabId['scripture']
        if (!tid) return {}
        const key = selectedVerseKey(ref)
        const cur = s.selectedVersesByTab[tid] ?? []
        const next = cur.some((v) => selectedVerseKey(v) === key)
          ? cur.filter((v) => selectedVerseKey(v) !== key)
          : [...cur, ref]
        return { selectedVersesByTab: { ...s.selectedVersesByTab, [tid]: next } }
      }),
      clearVerseSelection: (tabId) => set((s) => {
        const tid = tabId ?? s.activeTabId['scripture']
        if (!tid || !s.selectedVersesByTab[tid]?.length) return {}
        const nextMap = { ...s.selectedVersesByTab }
        delete nextMap[tid]
        return { selectedVersesByTab: nextMap }
      }),
      // Re-point a tab's selected verses onto another translation (KJV↔LXX flip), applying a
      // per-verse chapter/verse remap. Passing null for a verse from `remap` drops it (book
      // absent in the new edition, etc.).
      remapVerseSelection: (tabId, remap) => set((s) => {
        const tid = tabId ?? s.activeTabId['scripture']
        const cur = tid ? s.selectedVersesByTab[tid] : undefined
        if (!tid || !cur?.length) return {}
        const next = cur.map(remap).filter(Boolean) as SelectedVerseRef[]
        return { selectedVersesByTab: { ...s.selectedVersesByTab, [tid]: next } }
      }),
      bumpNoteEditToken: () => set((s) => ({ noteEditToken: s.noteEditToken + 1 })),
      bumpTableInsertToken: () => set((s) => ({ tableInsertToken: s.tableInsertToken + 1 })),
      bumpSettingsNavToken: () => set((s) => ({ settingsNavToken: s.settingsNavToken + 1 })),
      bumpFloatingTabToken: () => set((s) => ({ floatingTabToken: s.floatingTabToken + 1 })),
      bumpYoutubePipToken: () => set((s) => ({ youtubePipToken: s.youtubePipToken + 1 })),
      bumpVaultSyncToken: () => set((s) => ({ vaultSyncToken: s.vaultSyncToken + 1 })),
      resetTasks: () => set({ completedTaskIds: [], completedStepIds: [], tasksVisible: true, tasksMinimized: false }),

      savedWorkspaces: [] as import('@/types/electron').SavedWorkspace[],
      setSavedWorkspaces: (ws) => set({ savedWorkspaces: ws }),

      importModalOpen: false,
      importInitialTab: 'biblegateway' as 'biblegateway' | 'esword',
      openImportModal: () => { window.dispatchEvent(new Event('berean:closeMenus')); set({ settingsOpen: true, settingsInitialSection: 'import', importInitialTab: 'biblegateway' }) },
      openImportBibleGateway: () => { window.dispatchEvent(new Event('berean:closeMenus')); set({ settingsOpen: true, settingsInitialSection: 'import', importInitialTab: 'biblegateway' }) },
      openImportESword: () => { window.dispatchEvent(new Event('berean:closeMenus')); set({ settingsOpen: true, settingsInitialSection: 'import', importInitialTab: 'esword' }) },
      closeImportModal: () => set({ importModalOpen: false }),
      settingsInitialSection: 'appearance',
      lastSettingsSection: 'appearance',
      setLastSettingsSection: (section) => set({ lastSettingsSection: section }),
      settingsSectionScrollTop: {},
      setSettingsSectionScrollTop: (section, top) => set((s) => ({ settingsSectionScrollTop: { ...s.settingsSectionScrollTop, [section]: top } })),

      bgImportPhase: 'idle' as const,
      bgImportDone: 0,
      bgImportTotal: 0,
      bgImportMessage: '',
      bgImportReviewNotes: [],
      setBgImportProgress: (p) => set({
        bgImportPhase: p.phase,
        bgImportDone: p.done ?? 0,
        bgImportTotal: p.total ?? 0,
        bgImportMessage: p.message ?? '',
        ...(p.reviewNotes !== undefined ? { bgImportReviewNotes: p.reviewNotes } : {}),
      }),
      resetBgImport: () => set({ bgImportPhase: 'idle', bgImportDone: 0, bgImportTotal: 0, bgImportMessage: '', bgImportReviewNotes: [] }),

      eSwordPhase: 'idle' as const,
      eSwordDone: 0,
      eSwordTotal: 0,
      eSwordMessage: '',
      eSwordReviewNotes: [],
      setESwordProgress: (p) => set({
        eSwordPhase: p.phase,
        eSwordDone: p.done ?? 0,
        eSwordTotal: p.total ?? 0,
        eSwordMessage: p.message ?? '',
        ...(p.reviewNotes !== undefined ? { eSwordReviewNotes: p.reviewNotes } : {}),
      }),
      resetESword: () => set({ eSwordPhase: 'idle', eSwordDone: 0, eSwordTotal: 0, eSwordMessage: '', eSwordReviewNotes: [] }),

      // ── Per-tab navigation stacks (back/forward scoped to one tab) ─────────
      tabNavStacks: {} as Record<string, { stack: TabNavEntry[]; idx: number }>,
      isNavJumping: false,
      notesHomeToken: 0,
      bumpNotesHomeToken: () => set((s) => ({ notesHomeToken: s.notesHomeToken + 1 })),
      lexiconHomeToken: 0,
      bumpLexiconHomeToken: () => set((s) => ({ lexiconHomeToken: s.lexiconHomeToken + 1 })),
      youtubeHomeToken: 0,
      bumpYouTubeHomeToken: () => set((s) => ({ youtubeHomeToken: s.youtubeHomeToken + 1 })),

      pushTabNav: (tabId, entry) => {
        if (get().isNavJumping) return
        const full: TabNavEntry = {
          id: `tnav-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          ...entry,
        }
        set((s) => {
          const cur = s.tabNavStacks[tabId] ?? { stack: [], idx: -1 }
          const top = cur.stack[cur.idx]
          // Deduplicate: skip if identical to current top
          if (top && top.type === full.type &&
              top.bookId === full.bookId && top.chapter === full.chapter &&
              top.translation === full.translation &&
              top.noteId === full.noteId && top.strongsNum === full.strongsNum &&
              top.videoId === full.videoId &&
              top.pdfId === full.pdfId && top.page === full.page &&
              top.query === full.query) return {}
          const base = cur.stack.slice(0, cur.idx + 1)
          const maxStack = get().tabNavMaxStack ?? 100
          const newStack = [...base, full].slice(-maxStack)
          return { tabNavStacks: { ...s.tabNavStacks, [tabId]: { stack: newStack, idx: newStack.length - 1 } } }
        })
      },

      navTabBack: () => {
        const s = get()
        const activeTabId = s.activeTabId[s.activeSpace]
        if (!activeTabId) return
        const tabStack = s.tabNavStacks[activeTabId]
        if (!tabStack || tabStack.idx < 0) return
        // Note/Lexicon/YouTube tabs can go one step further back than usual, to idx -1 —
        // the list/search/browse view, with nothing open. Other tab types (Bible,
        // Search, PDF) have no equivalent "nothing open" state, so they stop at 0.
        const stackType = tabStack.stack[0]?.type
        const supportsHome = stackType === 'note' || stackType === 'lexicon' || stackType === 'youtube'
        if (tabStack.idx <= (supportsHome ? -1 : 0)) return
        // Remember where the reader is in the entry we're leaving, so Cmd+] forward restores it.
        captureActiveScrollIntoNavEntry(get, activeTabId, s.activeSpace)
        const newIdx = tabStack.idx - 1
        set({ isNavJumping: true, tabNavStacks: { ...s.tabNavStacks, [activeTabId]: { ...tabStack, idx: newIdx } } })
        if (newIdx === -1) {
          if (stackType === 'note') get().bumpNotesHomeToken()
          else if (stackType === 'lexicon') get().bumpLexiconHomeToken()
          else if (stackType === 'youtube') get().bumpYouTubeHomeToken()
          setTimeout(() => set({ isNavJumping: false }), 50)
          return
        }
        const entry = tabStack.stack[newIdx]
        if (entry.query !== undefined) {
          get().updateTabState(s.activeSpace, activeTabId, { searchMode: true, scriptureSearchQuery: entry.query })
        } else if (entry.bookId) {
          // searchMode: false is required here — without it, landing on a bookId
          // entry right after a query entry (i.e. stepping back INTO the reader
          // from search results) updates bookId/chapter invisibly underneath the
          // still-mounted ScriptureSearchView, since BiblePanel gates its render
          // branch purely on tabState.searchMode. Confirmed bug: after visiting
          // an Advanced Search entry once, back/forward looked like dead buttons.
          get().updateTabState(s.activeSpace, activeTabId, {
            bookId: entry.bookId, chapter: entry.chapter ?? 1,
            ...(entry.translation ? { translation: entry.translation } : {}),
            scrollPosition: entry.scrollPosition ?? 0, targetVerse: undefined, searchMode: false,
          })
        } else if (entry.strongsNum) {
          set({ pendingLexiconEntry: entry.strongsNum })
        } else if (entry.noteId) {
          set({ pendingNoteId: entry.noteId })
        } else if (entry.videoId) {
          set({ pendingYouTubeVideo: { videoId: entry.videoId, startTime: 0 } })
        } else if (entry.pdfId && entry.page) {
          window.dispatchEvent(new CustomEvent('berean:pdfGoToPage', { detail: { pdfId: entry.pdfId, page: entry.page } }))
        }
        setTimeout(() => set({ isNavJumping: false }), 50)
      },

      navTabForward: () => {
        const s = get()
        const activeTabId = s.activeTabId[s.activeSpace]
        if (!activeTabId) return
        const tabStack = s.tabNavStacks[activeTabId]
        if (!tabStack || tabStack.idx >= tabStack.stack.length - 1) return
        captureActiveScrollIntoNavEntry(get, activeTabId, s.activeSpace)
        const newIdx = tabStack.idx + 1
        const entry = tabStack.stack[newIdx]
        set({ isNavJumping: true, tabNavStacks: { ...s.tabNavStacks, [activeTabId]: { ...tabStack, idx: newIdx } } })
        if (entry.query !== undefined) {
          get().updateTabState(s.activeSpace, activeTabId, { searchMode: true, scriptureSearchQuery: entry.query })
        } else if (entry.bookId) {
          // searchMode: false — see the matching comment in navTabBack; without it,
          // stepping forward out of a search entry into a bookId entry silently
          // updates the tab underneath the still-mounted ScriptureSearchView.
          get().updateTabState(s.activeSpace, activeTabId, {
            bookId: entry.bookId, chapter: entry.chapter ?? 1,
            ...(entry.translation ? { translation: entry.translation } : {}),
            scrollPosition: entry.scrollPosition ?? 0, targetVerse: undefined, searchMode: false,
          })
        } else if (entry.strongsNum) {
          set({ pendingLexiconEntry: entry.strongsNum })
        } else if (entry.noteId) {
          set({ pendingNoteId: entry.noteId })
        } else if (entry.videoId) {
          set({ pendingYouTubeVideo: { videoId: entry.videoId, startTime: 0 } })
        } else if (entry.pdfId && entry.page) {
          window.dispatchEvent(new CustomEvent('berean:pdfGoToPage', { detail: { pdfId: entry.pdfId, page: entry.page } }))
        }
        setTimeout(() => set({ isNavJumping: false }), 50)
      },

      // Jumps straight to the synthetic idx-(-1) "home" entry (Notes list /
      // Lexicon search) in ONE atomic update.
      //
      // This used to repeat navTabBack() enough times to walk there step by
      // step (mirroring how TopBar.tsx's long-press nav-history dropdown did
      // it inline) — but every intermediate navTabBack() call ALSO sets
      // `pendingNoteId`/`pendingLexiconEntry` for whatever entry it lands on
      // along the way (NotesPanel.tsx/LexiconPanel.tsx watch that field and
      // load the entry), and nothing clears it once the loop moves past that
      // step. So after "arriving home" (idx -1, which bumps notesHomeToken/
      // lexiconHomeToken instead), the STALE pendingNoteId from the
      // second-to-last step was still sitting there — and depending on
      // effect ordering, the note-loading effect could win the race against
      // the home-token effect, landing on that leftover note instead of the
      // list. Jumping directly to -1 skips every intermediate step (and the
      // pendingNoteId churn each one causes) entirely.
      goToTabHome: () => {
        const s = get()
        const activeTabId = s.activeTabId[s.activeSpace]
        if (!activeTabId) return
        const tabStack = s.tabNavStacks[activeTabId]
        if (!tabStack || tabStack.idx < 0) {
          // No usable nav stack (e.g. a note opened directly into its own dedicated tab, which
          // never seeds one) — but if a note IS open in this tab, "home" still means the notes
          // list. Bump the home token so NotesPanel drops back to the list.
          const activeTab = s.tabs[s.activeSpace]?.find((t) => t.id === activeTabId)
          if (activeTab?.type === 'note' && (activeTab.state as { noteId?: string | null }).noteId) {
            get().bumpNotesHomeToken()
          }
          return
        }
        const stackType = tabStack.stack[0]?.type
        // Bible tabs have no equivalent "nothing open" list/search view to jump to (per
        // navTabBack's own comment — Bible/Search/PDF stop at idx 0, they don't get a
        // synthetic -1 state) — so "home" here means the earliest tracked chapter in this
        // tab's OWN history (idx 0), reached in one click instead of repeated Cmd+[.
        if (stackType === 'bible') {
          if (tabStack.idx === 0) return
          const entry = tabStack.stack[0]
          set({ isNavJumping: true, tabNavStacks: { ...s.tabNavStacks, [activeTabId]: { ...tabStack, idx: 0 } } })
          if (entry.bookId) {
            get().updateTabState(s.activeSpace, activeTabId, {
              bookId: entry.bookId, chapter: entry.chapter ?? 1,
              ...(entry.translation ? { translation: entry.translation } : {}),
              scrollPosition: 0, targetVerse: undefined, searchMode: false,
            })
          }
          setTimeout(() => set({ isNavJumping: false }), 50)
          return
        }
        if (stackType !== 'note' && stackType !== 'lexicon' && stackType !== 'youtube') return
        set({ isNavJumping: true, tabNavStacks: { ...s.tabNavStacks, [activeTabId]: { ...tabStack, idx: -1 } } })
        if (stackType === 'note') get().bumpNotesHomeToken()
        else if (stackType === 'lexicon') get().bumpLexiconHomeToken()
        else get().bumpYouTubeHomeToken()
        setTimeout(() => set({ isNavJumping: false }), 50)
      },

      // For panels that can null out their own "active item" state through a
      // path OTHER than the home button (e.g. NotesPanel.tsx deleting the
      // currently-open note) — without this, the nav stack's idx stays
      // stale (still pointing at the now-nonexistent item), so the home
      // icon keeps showing even though the panel is already back at its
      // list/search view, AND clicking it does nothing (goBack()'s own
      // `if (!activeNote) return` guard short-circuits since there's
      // nothing to go back FROM as far as the panel's local state is
      // concerned). Callers update their own local "active item" state to
      // null themselves; this only re-syncs the nav-stack half of that.
      resetTabNavHome: (tabId) => {
        const s = get()
        const tabStack = s.tabNavStacks[tabId]
        if (!tabStack || tabStack.idx < 0) return
        set({ tabNavStacks: { ...s.tabNavStacks, [tabId]: { ...tabStack, idx: -1 } } })
      },

      // History settings
      tabNavMaxStack: 100,
      historyMaxEntries: 500,
      setTabNavMaxStack: (n) => set({ tabNavMaxStack: Math.max(10, Math.min(1000, n)) }),
      setHistoryMaxEntries: (n) => set({ historyMaxEntries: Math.max(50, Math.min(10000, n)) }),
      clearAllTabNavStacks: () => set({ tabNavStacks: {} }),

      // ── Read Aloud (TTS playback) ──────────────────────────────────────────
      // Thin store actions — the actual speechSynthesis orchestration lives in
      // useTTSPlayback.ts (mounted once at App.tsx root), which watches
      // audioPlaybackRequestToken/skipVerseToken and drives the ttsEngine singleton
      // directly (see src/lib/tts/ttsEngine.ts). Keeping the engine calls out of the
      // store avoids importing the Web Speech wrapper into every consumer of this store.
      audioPlayback: null,
      setAudioPlayback: (state) => set((s) => ({
        audioPlayback: state === null
          ? null
          : { ...(s.audioPlayback ?? {
              isPlaying: false, isPaused: false, textId: 'kjva', bookId: 'GEN', chapter: 1, verse: 1, wordIndex: null, finished: false, endVerse: null,
            }), ...state },
      })),
      audioPlaybackRequestToken: 0,
      startPlaybackFrom: (bookId, chapter, verseNum, textId, endVerse = null) => set((s) => ({
        // "Autoplay when player opens" (ttsAutoplayOnOpen) only withholds playback when the
        // floating player is currently closed (audioPlayback === null) — i.e. THIS call is what
        // would open it. If the player is already open (already playing/paused, or mid
        // auto-advance from useTTSPlayback.ts), this is a continuation of an already-open
        // session, not an "open" event, so it always plays regardless of the setting.
        audioPlayback: {
          isPlaying: s.audioPlayback !== null || s.ttsAutoplayOnOpen,
          isPaused: false, textId, bookId, chapter, verse: verseNum, wordIndex: null, finished: false, endVerse,
        },
        audioPlaybackRequestToken: s.audioPlaybackRequestToken + 1,
        // Any DIRECT call to startPlaybackFrom (verse-row "play from here," the player's own
        // controls, etc.) means the user started an ordinary single-chapter play, not a queue
        // advance — clear queue position so handleChapterEnd's auto-advance falls back to plain
        // "next chapter in book" instead of treating a stale queue as still active. playQueueIndex
        // (below) re-asserts the real index right after calling this, so queue playback itself is
        // unaffected.
        playbackQueueIndex: -1,
      })),
      stopPlayback: () => {
        ttsEngine.stop()
        set({ audioPlayback: null })
      },
      togglePlayPause: () => {
        const s = get()
        const ap = s.audioPlayback
        if (!ap) return
        if (ap.isPaused) {
          ttsEngine.resume()
          set({ audioPlayback: { ...ap, isPaused: false } })
        } else {
          ttsEngine.pause()
          set({ audioPlayback: { ...ap, isPaused: true } })
        }
      },
      skipVerseToken: 0,
      skipVerseDirection: null,
      skipVerse: (direction) => set((s) => ({ skipVerseToken: s.skipVerseToken + 1, skipVerseDirection: direction })),
      seekToken: 0,
      seekTargetVerseNum: null,
      seekToVerse: (verseNum) => set((s) => ({ seekToken: s.seekToken + 1, seekTargetVerseNum: verseNum })),

      playbackQueue: [],
      playbackQueueIndex: -1,
      playbackQueueSourcePlaylistId: null,
      playbackQueueSourcePlaylistName: null,
      setPlaybackQueue: (items, sourcePlaylistId = null, sourcePlaylistName = null) => set({
        playbackQueue: items, playbackQueueIndex: items.length > 0 ? 0 : -1,
        playbackQueueSourcePlaylistId: sourcePlaylistId, playbackQueueSourcePlaylistName: sourcePlaylistName,
      }),
      linkPlaybackQueueToPlaylist: (id, name) => set({ playbackQueueSourcePlaylistId: id, playbackQueueSourcePlaylistName: name }),
      addToPlaybackQueue: (item) => set((s) => ({ playbackQueue: [...s.playbackQueue, item] })),
      removeFromPlaybackQueue: (index) => set((s) => {
        const next = s.playbackQueue.filter((_, i) => i !== index)
        // Keep pointing at the same logical item when possible; if the removed item was the one
        // currently playing (or before it), shift the index down so it doesn't skip ahead.
        let nextIndex = s.playbackQueueIndex
        if (index < s.playbackQueueIndex) nextIndex -= 1
        else if (index === s.playbackQueueIndex) nextIndex = Math.min(nextIndex, next.length - 1)
        return { playbackQueue: next, playbackQueueIndex: next.length === 0 ? -1 : nextIndex }
      }),
      reorderPlaybackQueue: (fromIndex, toIndex) => set((s) => {
        const next = [...s.playbackQueue]
        const [moved] = next.splice(fromIndex, 1)
        if (!moved) return {}
        next.splice(toIndex, 0, moved)
        // Keep the "currently playing" pointer on the same actual item as it moves around.
        let nextIndex = s.playbackQueueIndex
        if (s.playbackQueueIndex === fromIndex) nextIndex = toIndex
        else if (fromIndex < s.playbackQueueIndex && toIndex >= s.playbackQueueIndex) nextIndex -= 1
        else if (fromIndex > s.playbackQueueIndex && toIndex <= s.playbackQueueIndex) nextIndex += 1
        return { playbackQueue: next, playbackQueueIndex: nextIndex }
      }),
      clearPlaybackQueue: () => set({ playbackQueue: [], playbackQueueIndex: -1, playbackQueueSourcePlaylistId: null, playbackQueueSourcePlaylistName: null }),
      playQueueIndex: (index) => {
        const s = get()
        const item = s.playbackQueue[index]
        if (!item) return
        s.startPlaybackFrom(item.bookId, item.chapter, item.startVerse, item.textId, item.endVerse)
        // startPlaybackFrom above resets playbackQueueIndex to -1 (see its own comment) — reassert
        // the real index now that the request has gone through.
        set({ playbackQueueIndex: index })
      },

      queuePopoverOpen: false,
      queuePopoverPos: null,
      reasonPromptPopoverPos: null,
      setQueuePopoverOpen: (v) => set({ queuePopoverOpen: v }),
      setQueuePopoverPos: (pos) => set({ queuePopoverPos: pos }),
      setReasonPromptPopoverPos: (pos) => set({ reasonPromptPopoverPos: pos }),

      ttsVoiceURI: null,
      ttsRate: 1,
      ttsHighlightWordsEnabled: true,
      ttsAutoAdvanceEnabled: true,
      ttsAutoAdvancePauseSec: 2,
      ttsAutoplayOnOpen: true,
      setTTSVoiceURI: (v) => { ttsEngine.setVoice(v); set({ ttsVoiceURI: v }) },
      // No debounce (an earlier version of this had one): that existed back when
      // ttsEngine.setRate() restarted the active audio from a verse boundary on every call, so
      // the rate slider's onChange firing on every step crossed during a drag meant several
      // audible restarts back to back. kokoroBackend.ts's setRate() no longer restarts anything
      // at all (see its own doc comment) — it's a live `HTMLAudioElement.playbackRate` retune on
      // whatever's already playing, cheap and side-effect-free — so there's nothing left to
      // debounce against, and debouncing it only left a window where a rate change made mid-drag
      // and a verse seek made moments later could race: the seek would build its new chunk using
      // the ENGINE's still-stale `this.rate` (the debounced call hadn't reached it yet), briefly
      // reading at the OLD speed until the debounce timer finally caught up.
      setTTSRate: (v) => { ttsEngine.setRate(v); set({ ttsRate: v }) },
      setTTSHighlightWordsEnabled: (v) => set({ ttsHighlightWordsEnabled: v }),
      setTTSAutoAdvanceEnabled: (v) => set({ ttsAutoAdvanceEnabled: v }),
      setTTSAutoAdvancePauseSec: (v) => set({ ttsAutoAdvancePauseSec: Math.max(0, Math.min(30, v)) }),
      setTTSAutoplayOnOpen: (v) => set({ ttsAutoplayOnOpen: v }),

      kokoroModelReady: false,
      setKokoroModelReady: (v) => {
        set({ kokoroModelReady: v })
        // No preference to consult any more — with Kokoro the only engine, the pack becoming
        // available IS the signal to activate it.
        if (v) void activateKokoroBackend()
      },

      pdfFeatureEnabled: false,
      setPdfFeatureEnabled: (v) => set({ pdfFeatureEnabled: v }),

      dailyNoteLocation: null,
      setDailyNoteLocation: (loc) => set({ dailyNoteLocation: loc }),

      pendingYouTubeVideo: null,
      autoPiP: true,
      youtubeIsPlaying: false,
      aiLookupPanelOpen: false,
      aiLookupCommentaryOn: false,
      aiLookupAgenticOn: false,
      aiLookupUseTabContext: false,
      aiLookupPanelPos: null,
      aiLookupPanelSize: null,
      aiLookupActiveChatId: null,
      youtubeNoteBack: null,
      lexiconNoteBack: null,
      markdownReferenceOpen: false,
      noteVerseRefsEnabled: true,
      noteLexiconRefsEnabled: true,
      noteScriptureBlock: false,
      sidePanelScriptureBlock: true,
      noteFocusModeTabId: null,
      bibleRightPanelWidth: 0,
      noteEditorOpenCount: 0,
      bibleSearchTabActive: false,
      verseSelectionMenuOpen: false,
      verseSelectionBarOpen: false,
      chapterEchoStrongsNum: null,
      noteScriptureBlockThreshold: 0.9,
      autoEmDash: true,
      noteVerseBlockSuggest: true,
      noteStrongsBlockSuggest: true,
      // Print & Export defaults
      printMarginPreset: 'normal' as const,
      printCustomMargins: { top: 1, right: 1, bottom: 1, left: 1 },
      printPaperSize: 'letter' as const,
      printFontSizePt: 12,
      printFontFamily: 'system' as const,
      printIncludeTitle: true,
      printIncludeLinkedNotes: false,
      printColorMode: 'color' as const,
      printTheme: 'classic' as const,
      pdfDownloadLocation: '',

      defaultNoteEditorMode: 'edit' as const,
      confirmNoteDelete: false,
      noteSpellCheck: true,
      autoCopyOnHighlight: false,
      noteHeadingDivider: true,
      noteSidePanelPinned: false,
      noteBulletStyle: 'classic',
      noteTypingLook: 'default',
      idiomHighlightEnabled: true,
      idiomHoverPreviewEnabled: true,
      swipePanelGestureEnabled: true,
      idiomCache: [] as Array<{ id: string; term: string; meaning: string; aliases: string[]; autoVariants: boolean }>,
      viewerWindowOpen: false,
      viewerPaused: false,
      viewerLaserEnabled: true,
      viewerSelectionMirror: true,
      viewerSidePanelEnabled: true,
      viewerBlank: false,
      viewerFontScale: 1.5,
      viewerTheme: 'system' as const,
      showVerseNumbers: true,
      showRedLetters: true,
      continuousChapterScroll: false,
      continuousDailyScroll: false,
      wordReplacerEnabled: true,
      wordReplacerRules: DEFAULT_WORD_REPLACER_RULES,
      studyTrailAskChapterJumpReason: false,

      archivedGroups: [] as ArchivedGroup[],
      sessions: [DEFAULT_SESSION] as Session[],
      currentSessionId: 'default',
      sessionDisplayOrders: {} as Record<string, string[]>,

      createSession: (name) => {
        const state = get()
        const newId = `session-${Date.now()}`
        // Use total count of all sessions (including current) + 1 for naming
        const allCount = state.sessions.length === 0 ? 1 : state.sessions.length
        const newName = name ?? `Session ${allCount + 1}`
        const newSession: Session = {
          id: newId,
          name: newName,
          tabs: { scripture: [], notes: [], lexicon: [], youtube: [], search: [] },
          activeTabId: { scripture: null, notes: null, lexicon: null, youtube: null, search: null },
        }
        // Save current session state before switching
        const currentSession: Session = {
          id: state.currentSessionId,
          name: state.sessions.find(s => s.id === state.currentSessionId)?.name ?? 'Session 1',
          icon: state.sessions.find(s => s.id === state.currentSessionId)?.icon,
          tabs: state.tabs,
          activeTabId: state.activeTabId,
        }
        const updatedSessions = state.sessions.length === 0
          ? [currentSession, newSession]
          : [...state.sessions.map(s => s.id === state.currentSessionId ? currentSession : s), newSession]
        const defaultTabs: Record<SpaceId, Tab[]> = { scripture: [], notes: [], lexicon: [], youtube: [], search: [] }
        const defaultActiveId: Record<SpaceId, string | null> = { scripture: null, notes: null, lexicon: null, youtube: null, search: null }
        set({ sessions: updatedSessions, currentSessionId: newId, tabs: defaultTabs, activeTabId: defaultActiveId })
      },

      switchSession: (id) => {
        const state = get()
        if (id === state.currentSessionId) return
        // Save current session
        const currentSession: Session = {
          id: state.currentSessionId,
          name: state.sessions.find(s => s.id === state.currentSessionId)?.name ?? 'Session 1',
          icon: state.sessions.find(s => s.id === state.currentSessionId)?.icon,
          tabs: state.tabs,
          activeTabId: state.activeTabId,
        }
        let updatedSessions = state.sessions.length === 0
          ? [currentSession]
          : state.sessions.map(s => s.id === state.currentSessionId ? currentSession : s)
        const target = updatedSessions.find(s => s.id === id)
        if (!target) return
        set({ sessions: updatedSessions, currentSessionId: id, tabs: target.tabs, activeTabId: target.activeTabId })
      },

      renameSession: (id, name) => {
        set(s => ({ sessions: s.sessions.map(ses => ses.id === id ? { ...ses, name } : ses) }))
      },

      setSessionIcon: (id, icon) => {
        set(s => ({ sessions: s.sessions.map(ses => ses.id === id ? { ...ses, icon } : ses) }))
      },

      deleteSession: (id) => {
        const state = get()
        if (state.sessions.length <= 1) return  // keep at least one
        const remaining = state.sessions.filter(s => s.id !== id)
        if (state.currentSessionId === id) {
          const fallback = remaining[0]!
          set({ sessions: remaining, currentSessionId: fallback.id, tabs: fallback.tabs, activeTabId: fallback.activeTabId })
        } else {
          set({ sessions: remaining })
        }
      },

      reorderTabDisplay: (sessionId, fromId, toId, before) => {
        set((s) => {
          const allSpaces: SpaceId[] = ['scripture', 'notes', 'lexicon', 'youtube', 'search']
          const allTabs = allSpaces.flatMap((sp) => s.tabs[sp] ?? [])

          const stored = s.sessionDisplayOrders[sessionId] ?? []

          // Build the live order: start from stored order, drop missing IDs, append new ones
          const current: string[] = [
            ...stored.filter((id) => allTabs.some((t) => t.id === id)),
            ...allTabs.filter((t) => !stored.includes(t.id)).map((t) => t.id),
          ]

          const fromIdx = current.indexOf(fromId)
          const toIdx   = current.indexOf(toId)

          if (fromIdx === -1 || toIdx === -1 || fromId === toId) return {}

          const next = [...current]
          next.splice(fromIdx, 1)
          const insertAt = before ? toIdx : toIdx + 1
          const adjusted = insertAt > fromIdx ? insertAt - 1 : insertAt
          const finalIdx = Math.max(0, Math.min(adjusted, next.length))
          next.splice(finalIdx, 0, fromId)

          return { sessionDisplayOrders: { ...s.sessionDisplayOrders, [sessionId]: next } }
        })
      },

      moveTabToSession: (spaceId, tabId, targetSessionId) => {
        const state = get()
        const tab = state.tabs[spaceId].find(t => t.id === tabId)
        if (!tab) return
        const targetSession = state.sessions.find(s => s.id === targetSessionId)
        if (!targetSession) return
        // Remove from current session tabs
        const newTabs = { ...state.tabs, [spaceId]: state.tabs[spaceId].filter(t => t.id !== tabId) }
        const newActiveId = state.activeTabId[spaceId] === tabId
          ? (newTabs[spaceId][0]?.id ?? null)
          : state.activeTabId[spaceId]
        // Add to target session
        const updatedSessions = state.sessions.map(s =>
          s.id === targetSessionId
            ? { ...s, tabs: { ...s.tabs, [spaceId]: [...s.tabs[spaceId], tab] } }
            : s
        )
        set({ tabs: newTabs, activeTabId: { ...state.activeTabId, [spaceId]: newActiveId }, sessions: updatedSessions })
      },

      setActiveSpace: (space) => set({ activeSpace: space }),

      createTab: (type, position = 'after-active') => {
        const spaceId = TYPE_TO_SPACE[type]
        const id = `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
        let tab: Tab
        if (type === 'bible') {
          const defTranslation = get().defaultBibleTranslation.toUpperCase()
          tab = { id, spaceId, type, title: 'Genesis 1', state: { bookId: 'GEN', chapter: 1, translation: defTranslation, showStrongs: false, scrollPosition: 0 } }
          // See freshlyCreatedBibleTabIds' own comment above — the GEN/1 state just above is a
          // placeholder, not a real visited position, so updateTabState must not seed it into
          // this tab's nav history as an "origin" the first time this tab is actually navigated.
          freshlyCreatedBibleTabIds.add(id)
        } else if (type === 'lexicon') {
          tab = { id, spaceId, type, title: 'Lexicon', state: { strongsNum: null } }
        } else if (type === 'note') {
          tab = { id, spaceId, type, title: 'Notes', state: { noteId: null, isNew: true } }
        } else if (type === 'youtube') {
          tab = { id, spaceId, type, title: 'YouTube', state: { videoId: null, playlistId: null } }
        } else {
          tab = { id, spaceId, type, title: 'Search', state: { query: '', results: [] } }
        }
        const state = get()

        // Insert the new tab into the unified sidebar display order (see computeInsertOrder) —
        // not just appended to its own space's array — without this, a new notes tab lands
        // after the LAST notes tab (wherever that sits in the flattened space-grouped order)
        // instead of next to whatever tab the user was actually looking at.
        const newOrder = computeInsertOrder(state, id, position)

        set({
          tabs: { ...state.tabs, [spaceId]: [...state.tabs[spaceId], tab] },
          activeTabId: { ...state.activeTabId, [spaceId]: id },
          activeSpace: spaceId,
          tabMRUList: updateMRU(state.tabMRUList, spaceId, id),
          sessionDisplayOrders: { ...state.sessionDisplayOrders, [state.currentSessionId]: newOrder },
          // A genuinely NEW note tab must never inherit a leftover
          // pendingNoteId from an earlier, unrelated "open this note"
          // action — NotesPanel.tsx's mount-time effect consumes
          // pendingNoteId unconditionally, so a stale value sitting in the
          // store when this fresh tab mounts would load that old note
          // instead of showing the blank/home state the new tab is meant
          // to have (the same class of cross-tab bug fixed for Lexicon
          // this session, just for the "brand new tab" case specifically).
          ...(type === 'note' ? { pendingNoteId: null } : {}),
        })
      },

      activateTab: (tab) => {
        // Clicking an ALREADY-OPEN scripture tab in the sidebar is real navigation — you moved
        // your attention to a different chapter, same as any other jump — but it never went
        // through navigateToVerse()/recordNavigation() at all, since this is the ONE choke
        // point every tab-switch (sidebar click, keyboard tab-cycling, etc.) funnels through
        // regardless of tab type. Only fires for a genuine SPACE-appropriate switch (scripture
        // space, bible-type tab, actually switching TO a different tab than what was already
        // active) — switching within notes/lexicon/youtube/search isn't a scripture connection.
        if (tab.spaceId === 'scripture' && tab.type === 'bible') {
          const prevState = get()
          const prevTabId = prevState.activeTabId.scripture
          if (prevTabId !== tab.id) {
            const prevTab = prevState.tabs.scripture.find((t) => t.id === prevTabId)
            const prevBs = prevTab?.state as BibleTabState | undefined
            const bs = tab.state as BibleTabState
            // A bible tab currently showing Advanced Scripture Search isn't "a chapter you moved
            // your attention to" — its bookId/chapter is just the last-read (or default Genesis 1)
            // state sitting behind the search view. Recording that as a Study Trail stop produced
            // the reported bogus "genesis 1" node every time the search tab was focused.
            if (bs.bookId && !bs.searchMode) {
              recordNavigation(
                { bookId: prevBs?.bookId, chapter: prevBs?.chapter, verse: prevBs?.verse ?? prevBs?.targetVerse },
                { bookId: bs.bookId, chapter: bs.chapter, verse: bs.verse ?? bs.targetVerse },
                { kind: 'tab-switch' },
              )
            }
          }
        }
        set((s) => ({
          activeTabId: { ...s.activeTabId, [tab.spaceId]: tab.id },
          activeSpace: tab.spaceId,
          tabMRUList: updateMRU(s.tabMRUList, tab.spaceId, tab.id),
        }))
      },

      ensureTab: (type) => {
        const spaceId = TYPE_TO_SPACE[type]
        const state = get()
        if (state.tabs[spaceId].length === 0) {
          get().createTab(type)
        } else {
          const currentId = state.activeTabId[spaceId] ?? state.tabs[spaceId][0].id
          set({
            activeSpace: spaceId,
            activeTabId: { ...state.activeTabId, [spaceId]: currentId },
            tabMRUList: updateMRU(state.tabMRUList, spaceId, currentId),
          })
        }
      },

      renameTab: (spaceId, tabId, title) => {
        // No-op guard: callers are effects that re-run on unrelated state changes
        // (e.g. the YouTube tab's rename effect re-runs whenever the video list
        // object changes), and an unconditional set() would rebuild the whole
        // tabs map — and re-render every tab subscriber — for an identical title.
        const existing = get().tabs[spaceId]?.find((t) => t.id === tabId)
        if (!existing || existing.title === title) return
        set((s) => ({
          tabs: {
            ...s.tabs,
            [spaceId]: s.tabs[spaceId].map((t) => t.id === tabId ? { ...t, title } : t),
          },
        }))
      },

      reorderTabs: (spaceId, fromIndex, toIndex) => {
        set((s) => {
          const arr = [...s.tabs[spaceId]].filter(Boolean)
          if (fromIndex < 0 || fromIndex >= arr.length || toIndex < 0 || toIndex >= arr.length) return {}
          const [moved] = arr.splice(fromIndex, 1)
          arr.splice(toIndex, 0, moved)
          return { tabs: { ...s.tabs, [spaceId]: arr } }
        })
      },

      addTab: (tab, position = 'after-active') => {
        const state = get()
        const existing = state.tabs[tab.spaceId].find((t) => t.id === tab.id)
        if (existing) {
          set({
            activeTabId: { ...state.activeTabId, [tab.spaceId]: tab.id },
            activeSpace: tab.spaceId,
            tabMRUList: updateMRU(state.tabMRUList, tab.spaceId, tab.id),
          })
        } else {
          // Placement in the unified sidebar display order follows the same universal rule as
          // createTab (see computeInsertOrder) — 'after-active' by default (every "open in new
          // tab" call site that constructs its own tab object, e.g. a specific verse/note/video,
          // wants this), 'end' only for the double-click-empty-tab-bar-space case. The raw
          // per-space array itself is still always appended — only sessionDisplayOrders governs
          // VISUAL position (same split createTab already relies on).
          const currentTabs = state.tabs[tab.spaceId]
          const newTabs = [...currentTabs, tab]
          const newOrder = computeInsertOrder(state, tab.id, position)
          set({
            tabs: { ...state.tabs, [tab.spaceId]: newTabs },
            activeTabId: { ...state.activeTabId, [tab.spaceId]: tab.id },
            activeSpace: tab.spaceId,
            tabMRUList: updateMRU(state.tabMRUList, tab.spaceId, tab.id),
            sessionDisplayOrders: { ...state.sessionDisplayOrders, [state.currentSessionId]: newOrder },
          })
        }
      },

      closeTab: (spaceId, tabId) => {
        const state = get()
        const tabs = state.tabs[spaceId]
        const idx = tabs.findIndex((t) => t.id === tabId)
        if (idx === -1) return
        const newTabs = tabs.filter((t) => t.id !== tabId)
        const wasActive = state.activeTabId[spaceId] === tabId
        const newTabsAll = { ...state.tabs, [spaceId]: newTabs }
        const prunedMRU = state.tabMRUList.filter((m) => !(m.spaceId === spaceId && m.tabId === tabId))

        if (!wasActive) {
          set((s) => {
            const { [tabId]: _, ...restNavStacks } = s.tabNavStacks
            const { [tabId]: __, ...restSel } = s.selectedVersesByTab
            return { tabs: newTabsAll, tabMRUList: prunedMRU, tabNavStacks: restNavStacks, selectedVersesByTab: restSel }
          })
          return
        }

        // Closing the ACTIVE tab: fall back to the last tab opened/focused
        // ANYWHERE (any space), not just within this same tab type — matches
        // how a browser's "last active tab" behaves. tabMRUList is already a
        // global-recency list (see updateMRU), so the fix is simply to stop
        // filtering candidates down to `m.spaceId === spaceId` here (the
        // previous bug: closing the active Notes tab always jumped to another
        // Notes tab, even if e.g. a Scripture tab was focused more recently).
        const mruFallback = prunedMRU.find((m) =>
          m.spaceId === spaceId ? newTabs.some((t) => t.id === m.tabId) : (newTabsAll[m.spaceId] ?? []).some((t) => t.id === m.tabId)
        ) ?? null
        const withinSpaceFallbackId = newTabs[Math.max(0, idx - 1)]?.id ?? null

        set((s) => {
          const { [tabId]: _, ...restNavStacks } = s.tabNavStacks
          const { [tabId]: __, ...restSel } = s.selectedVersesByTab
          if (mruFallback && mruFallback.spaceId !== spaceId) {
            return {
              tabs: newTabsAll,
              activeTabId: { ...state.activeTabId, [spaceId]: withinSpaceFallbackId, [mruFallback.spaceId]: mruFallback.tabId },
              activeSpace: mruFallback.spaceId,
              tabMRUList: prunedMRU,
              tabNavStacks: restNavStacks,
              selectedVersesByTab: restSel,
            }
          }
          return {
            tabs: newTabsAll,
            activeTabId: { ...state.activeTabId, [spaceId]: mruFallback?.tabId ?? withinSpaceFallbackId },
            tabMRUList: prunedMRU,
            tabNavStacks: restNavStacks,
            selectedVersesByTab: restSel,
          }
        })
      },

      closeActiveTab: () => {
        const state = get()
        const spaceId = state.activeSpace
        const tabId = state.activeTabId[spaceId]
        if (!tabId) return
        const tabs = state.tabs[spaceId]
        const idx = tabs.findIndex((t) => t.id === tabId)
        if (idx === -1) return
        const newTabs = tabs.filter((t) => t.id !== tabId)
        const prunedMRU = state.tabMRUList.filter((m) => !(m.spaceId === spaceId && m.tabId === tabId))
        const newTabsAll = { ...state.tabs, [spaceId]: newTabs }

        // If no tabs remain in this space, switch to the first space that still has tabs
        if (newTabs.length === 0) {
          const spaceOrder: SpaceId[] = ['scripture', 'notes', 'lexicon', 'youtube', 'search']
          const fallbackSpace = spaceOrder.find(s => s !== spaceId && (newTabsAll[s]?.length ?? 0) > 0) ?? spaceId
          const fallbackTabId = newTabsAll[fallbackSpace]?.[0]?.id ?? null
          set({
            tabs: newTabsAll,
            activeSpace: fallbackSpace,
            tabMRUList: prunedMRU,
            activeTabId: { ...state.activeTabId, [spaceId]: null, ...(fallbackTabId ? { [fallbackSpace]: fallbackTabId } : {}) },
          })
          return
        }

        // Fall back to the last tab opened/focused ANYWHERE (any space), not
        // just the last one within this same tab type — see closeTab's
        // comment above for the bug this fixes.
        const mruFallback = prunedMRU.find((m) =>
          m.spaceId === spaceId ? newTabs.some((t) => t.id === m.tabId) : (newTabsAll[m.spaceId] ?? []).some((t) => t.id === m.tabId)
        ) ?? null
        const withinSpaceFallbackId = newTabs[Math.max(0, idx - 1)]?.id ?? null

        if (mruFallback && mruFallback.spaceId !== spaceId) {
          set({
            tabs: newTabsAll,
            activeTabId: { ...state.activeTabId, [spaceId]: withinSpaceFallbackId, [mruFallback.spaceId]: mruFallback.tabId },
            activeSpace: mruFallback.spaceId,
            tabMRUList: prunedMRU,
          })
        } else {
          set({
            tabs: newTabsAll,
            activeTabId: { ...state.activeTabId, [spaceId]: mruFallback?.tabId ?? withinSpaceFallbackId },
            tabMRUList: prunedMRU,
          })
        }
      },

      setActiveTab: (spaceId, tabId) => {
        const state = get()
        const key = `${spaceId}:${tabId}`
        const prevTabId = state.activeTabId[spaceId]

        // Give the currently-active panel (BiblePanel.tsx, NotesPanel.tsx, YouTubeTab.tsx —
        // whichever is listening) a chance to synchronously flush live view state (scroll
        // position, compare-mode column layout, note cursor, etc.) into this tab's
        // persisted state BEFORE it's no longer the active tab. This used to be the
        // caller's responsibility (dispatching this event by hand right before calling
        // setActiveTab), but only 2 of the 13+ call sites across the app actually did so —
        // every other path (TabSwitcher, history nav, search-result "open tab", floating
        // search, etc.) silently skipped it, so scroll/layout/compare state only survived
        // a tab switch some of the time depending on how you switched. Centralizing it here,
        // as the one place ALL tab switches funnel through, means it now always fires.
        if (prevTabId && prevTabId !== tabId) {
          window.dispatchEvent(new CustomEvent('berean:saveScrollBeforeTabChange'))
        }

        // A scripture tab with Advanced Search open (searchMode: true) now KEEPS that
        // state when you switch away and back — its query/filters/sort/scroll are all
        // persisted per-tab (see BiblePanel's onStateChange), so restoring it shows the
        // same search you left, not a reset to Genesis 1. (Previously searchMode was
        // force-cleared on every switch off such a tab, so re-visiting it fell through to
        // the reader at whatever bookId/chapter the tab last held — usually the default.)
        const tabs = state.tabs[spaceId]

        set({
          tabs: { ...state.tabs, [spaceId]: tabs },
          activeTabId: { ...state.activeTabId, [spaceId]: tabId },
          activeSpace: spaceId,
          tabMRUList: updateMRU(state.tabMRUList, spaceId, tabId),
          tabLastAccessed: { ...state.tabLastAccessed, [key]: Date.now() },
        })
      },

      updateTabState: (spaceId, tabId, newState) => {
        if (!get().isNavJumping) {
          const currentTab = get().tabs[spaceId].find(t => t.id === tabId)
          if (currentTab) {
            const ns = newState as unknown as Record<string, unknown>
            const cur = currentTab.state as unknown as Record<string, unknown>
            if (currentTab.type === 'bible') {
              // A PEEK, not a consume — a scrollPosition-only tick (very common right after a
              // tab is created, e.g. a target-verse scroll effect) must not burn this tab's
              // "fresh" status before the real book/chapter navigation call actually arrives.
              // Only the two branches below that actually USE this for a seed decision also
              // delete it, and only from inside their own `if`, so it's consumed exactly once,
              // on whichever call turns out to be the real first navigation — never on an
              // unrelated update in between. See freshlyCreatedBibleTabIds' own header comment.
              const isFreshlyCreated = freshlyCreatedBibleTabIds.has(tabId)
              const newBookId = ('bookId' in ns ? ns.bookId : cur.bookId) as string | undefined
              const newChapter = ('chapter' in ns ? ns.chapter : cur.chapter) as number | undefined
              // Book or chapter navigation — seed origin then push destination
              if (newBookId && newChapter && (newBookId !== cur.bookId || newChapter !== cur.chapter)) {
                const newTranslation = (('translation' in ns ? ns.translation : cur.translation) as string | undefined) ?? 'KJVA'
                // Seed stack with current position if empty — but only when that current
                // position is real (not this tab's just-created GEN/1 placeholder), otherwise
                // this fabricates a phantom history stop nobody ever actually visited.
                const existing = get().tabNavStacks[tabId]
                if (!existing || existing.stack.length === 0) {
                  const originBookId = cur.bookId as string | undefined
                  const originChapter = cur.chapter as number | undefined
                  if (originBookId && originChapter && !isFreshlyCreated) {
                    get().pushTabNav(tabId, {
                      type: 'bible', title: `${bookName(originBookId)} ${originChapter}`,
                      bookId: originBookId, chapter: originChapter,
                      translation: (cur.translation as string | undefined) ?? 'KJVA',
                    })
                  }
                }
                freshlyCreatedBibleTabIds.delete(tabId)
                // Stamp the entry we're leaving with the scroll offset the panel was last at,
                // so Cmd+[ back to it returns to where the user was reading. cur.scrollPosition
                // is the pre-navigation value (this runs before newState is merged below).
                stampNavEntryScroll(get, tabId, cur.scrollPosition as number | undefined)
                get().pushTabNav(tabId, {
                  type: 'bible', title: `${bookName(newBookId)} ${newChapter}`,
                  bookId: newBookId, chapter: newChapter, translation: newTranslation,
                })
              } else if ('translation' in ns && ns.translation && ns.translation !== cur.translation) {
                // Translation-only change (same book/chapter, different text)
                const bId = cur.bookId as string | undefined
                const ch = cur.chapter as number | undefined
                const existing2 = get().tabNavStacks[tabId]
                if (!existing2 || existing2.stack.length === 0) {
                  if (bId && ch && !isFreshlyCreated) {
                    get().pushTabNav(tabId, {
                      type: 'bible', title: `${bookName(bId)} ${ch}`,
                      bookId: bId, chapter: ch, translation: (cur.translation as string) ?? 'KJVA',
                    })
                  }
                }
                freshlyCreatedBibleTabIds.delete(tabId)
                get().pushTabNav(tabId, {
                  type: 'bible', title: `${bookName(bId ?? 'GEN')} ${ch ?? 1}`,
                  bookId: bId, chapter: ch, translation: ns.translation as string,
                })
              }
              // Compare mode toggle
              if ('compareMode' in ns && Boolean(ns.compareMode) !== Boolean(cur.compareMode)) {
                get().pushTabNav(tabId, {
                  type: 'bible',
                  title: ns.compareMode ? `Compare — ${currentTab.title}` : currentTab.title,
                  bookId: (ns.bookId ?? cur.bookId) as string | undefined,
                  chapter: (ns.chapter ?? cur.chapter) as number | undefined,
                  translation: (ns.translation ?? cur.translation) as string | undefined,
                })
              }
            } else if (currentTab.type === 'note') {
              if ('noteId' in ns && ns.noteId && ns.noteId !== cur.noteId) {
                get().pushTabNav(tabId, { type: 'note', title: currentTab.title, noteId: ns.noteId as string })
              }
            } else if (currentTab.type === 'lexicon') {
              if ('strongsNum' in ns && ns.strongsNum && ns.strongsNum !== cur.strongsNum) {
                get().pushTabNav(tabId, { type: 'lexicon', title: lexiconTitleFor(ns.strongsNum as string), strongsNum: ns.strongsNum as string })
              }
            } else if (currentTab.type === 'youtube') {
              if ('videoId' in ns && ns.videoId && ns.videoId !== cur.videoId) {
                // Must NOT reuse currentTab.title — that's still the PREVIOUS video's
                // title at this point. ShellHeader also live-looks-up the title when it
                // renders history rows, so a cache miss here self-corrects there.
                const vid = ns.videoId as string
                get().pushTabNav(tabId, { type: 'youtube', title: youtubeTitleFor(vid) ?? YOUTUBE_LOADING_TITLE, videoId: vid })
              }
            }
          }
        }
        const state = get()
        const tabs = state.tabs[spaceId].map((t) =>
          t.id === tabId ? { ...t, state: { ...t.state, ...newState } } : t
        )
        set({ tabs: { ...state.tabs, [spaceId]: tabs } })
      },

      updatePanelLayout: (layout) => set({ panelLayout: layout }),

      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      // Bounds (224-250px) mirrored in Sidebar.tsx's own drag-resize handler — kept here too
      // since this setter is also reachable directly (not just via the drag handle).
      setSidebarWidth: (width) => set({ sidebarWidth: Math.max(224, Math.min(250, width)) }),

      recentSearchQueries: [] as string[],
      addRecentSearchQuery: (q) => {
        const trimmed = q.trim()
        if (!trimmed || trimmed.length < 2) return
        set((s) => ({
          recentSearchQueries: [trimmed, ...s.recentSearchQueries.filter((r) => r !== trimmed)].slice(0, 10),
        }))
      },

      openSearch: (mode = 'current', scope = 'all', newTabPosition = 'top') => {
        window.dispatchEvent(new Event('berean:closeMenus'))
        set({ searchOpen: true, searchMode: mode, searchScope: scope, searchNewTabPosition: newTabPosition, findBarOpen: false, findBarQuery: '', findBarAutoOpen: false, settingsOpen: false })
      },
      closeSearch: () => set({ searchOpen: false }),
      requestOpenNote: (noteId) => {
        if (!get().isNavJumping) {
          const tabId = get().activeTabId['notes']
          if (tabId) get().pushTabNav(tabId, { type: 'note', noteId, title: 'Note' })
        }
        set({ pendingNoteId: noteId })
      },
      clearPendingNote: () => set({ pendingNoteId: null }),
      filterNotesByVerse: (verseRef) => set({ pendingVerseFilter: verseRef }),
      clearVerseFilter: () => set({ pendingVerseFilter: null }),
      bumpNoteToken: () => set((s) => ({ noteChangeToken: s.noteChangeToken + 1 })),
      bumpPresenterPushToken: () => set((s) => ({ presenterPushToken: s.presenterPushToken + 1 })),
      // Apply tab state received from another window (does NOT trigger another broadcast).
      // Guarded by `updatedAt` (see lastAppliedTabSyncAt's own comment above) — an older
      // broadcast arriving after a newer local change (or a newer broadcast already applied)
      // is dropped instead of blindly overwriting `tabs`. `updatedAt` is optional only so an
      // old/mismatched build on the other end of the IPC channel can't wedge sync entirely; a
      // payload with no timestamp at all is still applied (previous behavior), just not
      // preferred over one that has it.
      applyExternalTabSync: (payload) => {
        if (payload.updatedAt !== undefined) {
          if (payload.updatedAt <= lastAppliedTabSyncAt) return
          lastAppliedTabSyncAt = payload.updatedAt
        }
        const update: Partial<AppState> = { tabs: payload.tabs }
        if (payload.theme !== undefined) update.theme = payload.theme as AppState['theme']
        if (payload.themePreset !== undefined) update.themePreset = payload.themePreset
        if (payload.backgroundAnimationEnabled !== undefined) update.backgroundAnimationEnabled = payload.backgroundAnimationEnabled
        if (payload.backgroundAnimationStyle !== undefined) update.backgroundAnimationStyle = payload.backgroundAnimationStyle
        if (payload.backgroundAnimationIntensity !== undefined) update.backgroundAnimationIntensity = payload.backgroundAnimationIntensity
        set(update)
      },

      // Reopens to lastSettingsSection (wherever the user last manually navigated inside
      // Settings) rather than a hardcoded 'appearance' — without explicitly setting
      // settingsInitialSection here at all, the generic "open Settings" entry points (gear icon,
      // ⌘,) would keep landing on whatever section a PREVIOUS targeted open (openImportModal,
      // openSettingsToSessions, etc.) last set, since that field is plain persistent store state,
      // never cleared on its own.
      openSettings: () => { window.dispatchEvent(new Event('berean:closeMenus')); set((s) => ({ settingsOpen: true, settingsInitialSection: s.lastSettingsSection })) },
      // "Manage sessions…" (Sidebar.tsx) used to call plain openSettings(),
      // landing on the default Appearance tab instead of the "Manage your
      // data" hub where Sessions/Archived-tabs actually live (SessionsSection.tsx).
      openSettingsToSessions: () => { window.dispatchEvent(new Event('berean:closeMenus')); set({ settingsOpen: true, settingsInitialSection: 'data' }) },
      // Rail's Settings badge (Ribbon.tsx) jumps straight to the About/Updates
      // page when an update is available/ready, instead of the default tab.
      openSettingsToAbout: () => { window.dispatchEvent(new Event('berean:closeMenus')); set({ settingsOpen: true, settingsInitialSection: 'about' }) },
      // AudioPlayer.tsx's "Get more natural voices…" link — jumps straight to the Audio
      // section instead of the default Appearance tab.
      openSettingsToAudio: () => { window.dispatchEvent(new Event('berean:closeMenus')); set({ settingsOpen: true, settingsInitialSection: 'audio' }) },
      closeSettings: () => set({ settingsOpen: false }),
      toggleSettings: () => set((s) => {
        const opening = !s.settingsOpen
        if (opening) window.dispatchEvent(new Event('berean:closeMenus'))
        return { settingsOpen: opening }
      }),

      openLexiconEntry: (strongsNum, fromNote, depth) => {
        // Fuller "G26 — ἀγάπη" title when this entry has been loaded before this
        // session; falls back to the bare number otherwise (see lexiconTitle.ts).
        const lexTitle = lexiconTitleFor(strongsNum)
        get().addHistoryEntry({ type: 'lexicon', title: lexTitle, strongsNum })
        // `depth` lets a caller invoking this from an ALREADY-OPEN entry (a Cmd/Ctrl-click on a
        // related word, opening a new tab) say so — that's a 'related' hop, not a fresh 'click',
        // even though it happens to also open a new tab. Defaults to 'click' for the true
        // first-click-from-scripture case everywhere else this is called.
        recordLexiconConnection(strongsNum, depth ?? 'click')
        if (!get().isNavJumping) {
          const tabId = get().activeTabId['lexicon']
          if (tabId) get().pushTabNav(tabId, { type: 'lexicon', strongsNum, title: lexTitle })
        }
        set({ pendingLexiconEntry: strongsNum, lexiconNoteBack: fromNote ?? null })
      },
      clearLexiconEntry: () => set({ pendingLexiconEntry: null }),
      requestLexiconSearch: (term) => set({ pendingLexiconSearch: term }),
      clearLexiconSearch: () => set({ pendingLexiconSearch: null }),
      openLexiconSearchTab: (term) => {
        get().ensureTab('lexicon')
        get().setActiveSpace('lexicon')
        get().addHistoryEntry({ type: 'search', title: `Lexicon: "${term}"`, query: term })
        set({ pendingLexiconSearchTab: term })
      },
      clearLexiconSearchTab: () => set({ pendingLexiconSearchTab: null }),
      openNotesSearchTab: (term) => {
        get().ensureTab('note')
        get().setActiveSpace('notes')
        get().addHistoryEntry({ type: 'search', title: `Notes: "${term}"`, query: term })
        set({ pendingNotesSearchTab: term })
      },
      clearNotesSearchTab: () => set({ pendingNotesSearchTab: null }),
      openYouTubeSearchTab: (term) => {
        get().ensureTab('youtube')
        get().setActiveSpace('youtube')
        get().addHistoryEntry({ type: 'search', title: `YouTube: "${term}"`, query: term })
        set({ pendingYouTubeSearch: term })
      },
      clearYouTubeSearch: () => set({ pendingYouTubeSearch: null }),
      openNoteInBiblePanel: (noteId) => set({ pendingRightPanelNoteId: noteId }),
      filterBiblePanelByVerse: (verseRef) => set({ pendingRightPanelVerseFilter: verseRef }),
      openCrossRefsInBiblePanel: (verseRef) => set({ pendingRightPanelCrossRefVerse: verseRef }),
      clearRightPanelNote: () => set({ pendingRightPanelNoteId: null }),
      clearRightPanelVerseFilter: () => set({ pendingRightPanelVerseFilter: null }),
      clearRightPanelCrossRef: () => set({ pendingRightPanelCrossRefVerse: null }),
      bumpHighlightToken: () => set((s) => ({ highlightChangeToken: s.highlightChangeToken + 1 })),
      setVerseTags: (tags) => set((s) => ({ verseTags: tags, verseTagChangeToken: s.verseTagChangeToken + 1 })),
      bumpVerseTagToken: () => set((s) => ({ verseTagChangeToken: s.verseTagChangeToken + 1 })),
      refreshVerseTags: async () => {
        try {
          const tags = await window.verseTags.list()
          set((s) => ({ verseTags: tags, verseTagChangeToken: s.verseTagChangeToken + 1 }))
        } catch { /* verseTags bridge not ready (e.g. tests) */ }
      },
      openTagManager: () => set({ tagManagerOpen: true }),
      closeTagManager: () => set({ tagManagerOpen: false }),
      openSearchTab: (query) => {
        get().addHistoryEntry({ type: 'search', title: `"${query}"`, query })
        if (get().tabs['search'].length === 0) get().createTab('search')
        const fresh = get()
        // Prefer the currently active search tab (if it still exists) over always reusing the
        // first one in the array — otherwise a query pushed in while a *different* search tab is
        // active would silently redirect into the wrong tab.
        const activeSearchId = fresh.activeTabId['search']
        const targetId = fresh.tabs['search'].some((t) => t.id === activeSearchId)
          ? activeSearchId
          : fresh.tabs['search'][0]?.id ?? null
        set({ pendingSearchQuery: query, activeSpace: 'search', activeTabId: { ...fresh.activeTabId, search: targetId } })
      },
      clearSearchQuery: () => set({ pendingSearchQuery: null }),

      openYouTubeVideo: (videoId, startTime = 0, fromNote) => {
        // Raw video ids are meaningless as titles — prefer the cached real title,
        // otherwise a loading placeholder that YouTubeTab corrects once metadata lands.
        const ytTitle = videoId ? (youtubeTitleFor(videoId) ?? YOUTUBE_LOADING_TITLE) : 'YouTube'
        get().addHistoryEntry({ type: 'youtube', title: ytTitle, videoId: videoId ?? undefined })
        const state = get()
        if (state.tabs['youtube'].length === 0) get().createTab('youtube')
        const fresh = get()
        const ytTabId = fresh.tabs['youtube'][0]?.id ?? null
        if (!get().isNavJumping && videoId && ytTabId) {
          get().pushTabNav(ytTabId, { type: 'youtube', title: ytTitle, videoId })
        }
        set({
          pendingYouTubeVideo: { videoId, startTime },
          activeSpace: 'youtube',
          activeTabId: { ...fresh.activeTabId, youtube: ytTabId },
          youtubeNoteBack: fromNote ?? null,
        })
      },
      openYouTubeVideoInNewTab: (videoId, startTime = 0) => {
        get().addHistoryEntry({
          type: 'youtube',
          title: videoId ? (youtubeTitleFor(videoId) ?? YOUTUBE_LOADING_TITLE) : 'YouTube',
          videoId: videoId ?? undefined,
        })
        get().createTab('youtube') // creates + activates a fresh youtube tab
        set({ pendingYouTubeVideo: { videoId, startTime }, activeSpace: 'youtube' })
      },
      openPdf: (pdfId, title, page) => {
        const state = get()
        // Reuse an existing tab for the same PDF if one is open
        const existing = state.tabs['scripture'].find(
          (t) => t.type === 'pdf' && (t.state as { pdfId?: string }).pdfId === pdfId
        )
        if (existing) {
          if (!get().isNavJumping) {
            get().pushTabNav(existing.id, { type: 'pdf', title: existing.title, pdfId, page })
          }
          set({
            activeTabId: { ...state.activeTabId, scripture: existing.id },
            activeSpace: 'scripture',
            tabMRUList: updateMRU(state.tabMRUList, 'scripture', existing.id),
          })
          if (page) window.dispatchEvent(new CustomEvent('berean:pdfGoToPage', { detail: { pdfId, page } }))
          return
        }
        const id = `pdf-${pdfId}-${Date.now()}`
        const tab: Tab = { id, spaceId: 'scripture', type: 'pdf', title: title || 'PDF', state: { pdfId, title, page } }
        get().addHistoryEntry({ type: 'import', title: title || 'PDF', importSource: 'pdf' })
        if (!get().isNavJumping) {
          get().pushTabNav(id, { type: 'pdf', title: title || 'PDF', pdfId, page })
        }
        set({
          tabs: { ...state.tabs, scripture: [...state.tabs.scripture, tab] },
          activeTabId: { ...state.activeTabId, scripture: id },
          activeSpace: 'scripture',
          tabMRUList: updateMRU(state.tabMRUList, 'scripture', id),
        })
      },
      clearPendingYouTubeVideo: () => set({ pendingYouTubeVideo: null }),
      setAutoPiP: (v) => set({ autoPiP: v }),
      setYoutubeIsPlaying: (v) => set({ youtubeIsPlaying: v }),
      setAiLookupPanelOpen: (v) => set({ aiLookupPanelOpen: v }),
      setAiLookupCommentaryOn: (v) => set({ aiLookupCommentaryOn: v }),
      setAiLookupAgenticOn: (v) => set({ aiLookupAgenticOn: v }),
      setAiLookupUseTabContext: (v) => set({ aiLookupUseTabContext: v }),
      setAiLookupPanelPos: (pos) => set({ aiLookupPanelPos: pos }),
      setAiLookupPanelSize: (size) => set({ aiLookupPanelSize: size }),
      setAiLookupActiveChatId: (id) => set({ aiLookupActiveChatId: id }),
      setYoutubeNoteBack: (note) => set({ youtubeNoteBack: note }),
      setLexiconNoteBack: (note) => set({ lexiconNoteBack: note }),
      openMarkdownReference: () => set({ markdownReferenceOpen: true }),
      closeMarkdownReference: () => set({ markdownReferenceOpen: false }),

      openScriptureSearchTab: (query?: string, opts?: { tagIds?: string[]; matchAll?: boolean; tagNames?: string[] }) => {
        // Accept tag ids directly, or resolve names (from a history entry) against the live registry.
        const tagIds = opts?.tagIds ?? (opts?.tagNames ?? [])
          .map((n) => get().verseTags.find((t) => t.name.toLowerCase() === n.toLowerCase())?.id)
          .filter((x): x is string => !!x)
        // If a tab already exists scoped to exactly this single tag (and no query), focus it.
        if (tagIds.length === 1 && !query) {
          const existing = get().tabs['scripture'].find((t) => {
            const st = t.state as BibleTabState
            return st?.searchMode && st.searchTagFilter === tagIds[0] && !(st.scriptureSearchQuery ?? '').trim()
          })
          if (existing) {
            set((s) => ({ activeTabId: { ...s.activeTabId, scripture: existing.id }, activeSpace: 'scripture' }))
            return
          }
        }
        const tagNames = opts?.tagNames?.length
          ? opts.tagNames
          : tagIds.map((id) => get().verseTags.find((t) => t.id === id)?.name).filter((x): x is string => !!x)
        if (query || tagIds.length) {
          get().addHistoryEntry({
            type: 'search',
            title: query ? `"${query}"` : (tagNames.length ? `#${tagNames.join(' #')}` : 'Tagged verses'),
            query: query ?? '',
            searchTagFilter: tagNames.length ? tagNames : undefined,
            searchTagFilterAll: opts?.matchAll || undefined,
          })
        }
        const state = get()
        // Always create a fresh tab — never reuse an existing search tab
        const id = `scripture-search-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
        const tab: Tab = {
          id,
          spaceId: 'scripture',
          type: 'bible',
          title: query ? 'Search' : (tagNames[0] ? `#${tagNames[0]}` : 'Tagged'),
          state: {
            bookId: 'GEN',
            chapter: 1,
            translation: state.defaultBibleTranslation.toUpperCase(),
            showStrongs: false,
            scrollPosition: 0,
            searchMode: true,
            scriptureSearchQuery: query ?? '',
            ...(tagIds.length ? { searchTagFilter: tagIds.join(','), searchTagFilterAll: opts?.matchAll || undefined } : {}),
          },
        }
        // Same placement rule as createTab/addTab (see computeInsertOrder) — without this the
        // new tab is appended only to tabs.scripture, never added to sessionDisplayOrders, so
        // the sidebar's orderedTabs falls back to bucketing it at the very end of the tab bar
        // regardless of which tab was active.
        const newOrder = computeInsertOrder(state, id, 'after-active')
        set({
          tabs: { ...state.tabs, scripture: [...state.tabs['scripture'], tab] },
          activeTabId: { ...state.activeTabId, scripture: id },
          activeSpace: 'scripture',
          tabMRUList: updateMRU(state.tabMRUList, 'scripture', id),
          sessionDisplayOrders: { ...state.sessionDisplayOrders, [state.currentSessionId]: newOrder },
        })
      },

      // Print & Export setters
      setPrintMarginPreset: (v) => set({ printMarginPreset: v }),
      setPrintCustomMargins: (v) => set({ printCustomMargins: v }),
      setPrintPaperSize: (v) => set({ printPaperSize: v }),
      setPrintFontSizePt: (v) => set({ printFontSizePt: v }),
      setPrintFontFamily: (v) => set({ printFontFamily: v }),
      setPrintIncludeTitle: (v) => set({ printIncludeTitle: v }),
      setPrintIncludeLinkedNotes: (v) => set({ printIncludeLinkedNotes: v }),
      setPrintColorMode: (v) => set({ printColorMode: v }),
      setPrintTheme: (v) => set({ printTheme: v }),
      setPdfDownloadLocation: (v) => set({ pdfDownloadLocation: v }),

      setNoteVerseRefsEnabled: (v) => set({ noteVerseRefsEnabled: v }),
      setNoteLexiconRefsEnabled: (v) => set({ noteLexiconRefsEnabled: v }),
      setNoteScriptureBlock: (v) => set({ noteScriptureBlock: v }),
      setSidePanelScriptureBlock: (v) => set({ sidePanelScriptureBlock: v }),
      toggleNoteFocusMode: (tabId) => set((s) => ({ noteFocusModeTabId: s.noteFocusModeTabId === tabId ? null : tabId })),
      setBibleRightPanelWidth: (v) => set({ bibleRightPanelWidth: Math.max(0, v) }),
      bumpNoteEditorOpen: (delta) => set((s) => ({ noteEditorOpenCount: Math.max(0, s.noteEditorOpenCount + delta) })),
      setBibleSearchTabActive: (v) => set({ bibleSearchTabActive: v }),
      setVerseSelectionMenuOpen: (v) => set({ verseSelectionMenuOpen: v }),
      setVerseSelectionBarOpen: (v) => set((s) => (s.verseSelectionBarOpen === v ? s : { verseSelectionBarOpen: v })),
      setChapterEchoStrongsNum: (v) => set((s) => (s.chapterEchoStrongsNum === v ? s : { chapterEchoStrongsNum: v })),
      setNoteScriptureBlockThreshold: (v) => set({ noteScriptureBlockThreshold: Math.max(0, Math.min(1, v)) }),
      setAutoEmDash: (v) => set({ autoEmDash: v }),
      setNoteVerseBlockSuggest: (v) => set({ noteVerseBlockSuggest: v }),
      setNoteStrongsBlockSuggest: (v) => set({ noteStrongsBlockSuggest: v }),

      archiveTab: (spaceId, tabId) => {
        const state = get()
        const tab = state.tabs[spaceId].find(t => t.id === tabId)
        if (!tab) return
        const group: ArchivedGroup = {
          id: `arch-${Date.now()}`,
          label: tab.title,
          archivedAt: Date.now(),
          tabs: [tab],
        }
        set({ archivedGroups: [group, ...state.archivedGroups] })
        // Also close the tab
        state.closeTab(spaceId, tabId)
      },

      archiveAllTabs: (label) => {
        const state = get()
        const allTabs: Tab[] = []
        for (const space of Object.values(state.tabs)) {
          allTabs.push(...(space as Tab[]))
        }
        if (allTabs.length === 0) return
        const ts = new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
        const group: ArchivedGroup = {
          id: `arch-${Date.now()}`,
          label: label ?? `Archive — ${ts}`,
          archivedAt: Date.now(),
          tabs: allTabs,
        }
        // Close all tabs in all spaces
        const newTabs: Record<string, Tab[]> = {}
        for (const spaceId of Object.keys(state.tabs)) newTabs[spaceId] = []
        const newActiveId: Record<string, string | null> = {}
        for (const spaceId of Object.keys(state.activeTabId)) newActiveId[spaceId] = null
        set({
          archivedGroups: [group, ...state.archivedGroups],
          tabs: newTabs as typeof state.tabs,
          activeTabId: newActiveId as typeof state.activeTabId,
        })
      },

      restoreArchivedGroup: (groupId) => {
        const state = get()
        const group = state.archivedGroups.find(g => g.id === groupId)
        if (!group) return
        // Re-add each tab to its space
        let newTabs = { ...state.tabs }
        let newActiveId = { ...state.activeTabId }
        for (const tab of group.tabs) {
          const existing = newTabs[tab.spaceId] ?? []
          if (!existing.find(t => t.id === tab.id)) {
            newTabs = { ...newTabs, [tab.spaceId]: [...existing, tab] }
            newActiveId = { ...newActiveId, [tab.spaceId]: tab.id }
          }
        }
        set({
          archivedGroups: state.archivedGroups.filter(g => g.id !== groupId),
          tabs: newTabs,
          activeTabId: newActiveId,
        })
      },

      dismissArchivedGroup: (groupId) =>
        set(s => ({ archivedGroups: s.archivedGroups.filter(g => g.id !== groupId) })),
      clearAllArchivedGroups: () => set({ archivedGroups: [] }),
      setDefaultNoteEditorMode: (m) => set({ defaultNoteEditorMode: m }),
      setConfirmNoteDelete: (v) => set({ confirmNoteDelete: v }),
      setNoteSpellCheck: (v) => set({ noteSpellCheck: v }),
      setAutoCopyOnHighlight: (v) => set({ autoCopyOnHighlight: v }),
      setNoteHeadingDivider: (v) => set({ noteHeadingDivider: v }),
      setNoteSidePanelPinned: (v) => set({ noteSidePanelPinned: v }),
      setNoteBulletStyle: (s) => set({ noteBulletStyle: s }),
      setNoteTypingLook: (s) => set({ noteTypingLook: s }),
      setIdiomHighlightEnabled: (v) => set({ idiomHighlightEnabled: v }),
      setIdiomHoverPreviewEnabled: (v) => set({ idiomHoverPreviewEnabled: v }),
      setSwipePanelGestureEnabled: (v) => set({ swipePanelGestureEnabled: v }),
      setIdiomCache: (v: Array<{ id: string; term: string; meaning: string; aliases: string[]; autoVariants: boolean }>) => set({ idiomCache: v }),
      setViewerWindowOpen: (v) => set(v ? { viewerWindowOpen: true } : { viewerWindowOpen: false, viewerPaused: false, viewerBlank: false }),
      setViewerBlank: (v) => set({ viewerBlank: v }),
      setViewerPaused: (v) => set({ viewerPaused: v }),
      setViewerLaserEnabled: (v) => set({ viewerLaserEnabled: v }),
      setViewerSelectionMirror: (v) => set({ viewerSelectionMirror: v }),
      setViewerSidePanelEnabled: (v) => set({ viewerSidePanelEnabled: v }),
      setViewerFontScale: (v) => {
        set({ viewerFontScale: v })
        // Also write immediately to its OWN dedicated (non-debounced) localStorage key so a
        // presenter-window close (or app quit) within the ~500ms debounce window — or a later
        // full-state flush from the other window carrying a stale copy of this field — can't
        // lose the zoom. Mirrors setStudyTrailAskChapterJumpReason / ASK_WHY_SYNC_KEY.
        try { localStorage.setItem(VIEWER_FONT_SCALE_SYNC_KEY, JSON.stringify(v)) } catch { /* storage disabled/quota — persist path still covers it eventually */ }
      },
      setViewerTheme: (v) => set({ viewerTheme: v }),
      setShowVerseNumbers: (v) => set({ showVerseNumbers: v }),
      setContinuousChapterScroll: (v) => set({ continuousChapterScroll: v }),
      setContinuousDailyScroll: (v) => set({ continuousDailyScroll: v }),
      setShowRedLetters: (v) => set({ showRedLetters: v }),

      setWordReplacerEnabled: (v) => set({ wordReplacerEnabled: v }),
      setWordReplacerRules: (rules) => set({ wordReplacerRules: rules }),
      toggleWordReplacerRule: (id) => set((s) => ({
        wordReplacerRules: s.wordReplacerRules.map((r) => r.id === id ? { ...r, enabled: !r.enabled } : r),
      })),

      setStudyTrailAskChapterJumpReason: (v) => {
        set({ studyTrailAskChapterJumpReason: v })
        // Also written immediately to its OWN dedicated (non-debounced) localStorage key — see
        // the ASK_WHY_SYNC_KEY listener below for why this exists separately from the general
        // CROSS_WINDOW_SYNCED_KEYS/'berean-app-state' path.
        try { localStorage.setItem(ASK_WHY_SYNC_KEY, v ? '1' : '0') } catch { /* storage disabled/quota — live sync just won't fire this time */ }
      },

      setTheme: (theme) => set({ theme }),
      setAppZoom: (level) => set({ appZoom: clampZoom(level) }),
      adjustAppZoom: (dir) => set((s) => ({ appZoom: adjustZoom(s.appZoom, dir) })),
      resetAppZoom: () => set({ appZoom: ZOOM_DEFAULT }),
      setBibleFontSize: (size) => set({ bibleFontSize: size }),
      setBibleLineHeight: (h) => set({ bibleLineHeight: h }),
      setDefaultBibleTranslation: (id) => set({ defaultBibleTranslation: id }),
      defaultScriptureLayout: 'standard' as import('@/types').ScriptureLayout,
      setDefaultScriptureLayout: (layout) => set({ defaultScriptureLayout: layout }),
      noteTransformLayout: 'right' as 'right' | 'bottom' | 'left',
      setNoteTransformLayout: (layout) => set({ noteTransformLayout: layout }),
      crossRefSource: 'tske' as 'tske' | 'classic' | 'notes',
      setCrossRefSource: (s) => set({ crossRefSource: s }),
      floatingSearchDensity: 'compact' as const,
      setFloatingSearchDensity: (d) => set({ floatingSearchDensity: d }),
      defaultYoutubeLayout: 'video-full' as import('@/types').YouTubeLayout,
      setDefaultYoutubeLayout: (l) => set({ defaultYoutubeLayout: l }),
    }),
    {
      name: 'berean-app-state',
      version: 8,
      // Without this, bumping `version` (as every schema change here has) makes zustand's persist
      // middleware discard ALL persisted state on the next load instead of carrying it forward —
      // it only calls migrate() when the on-disk version differs from `version` above, and with
      // no migrate function it just console.errors and falls back to fresh defaults (see
      // zustand/middleware.js: "State loaded from storage couldn't be migrated since no migrate
      // function was provided"). That reset then gets written straight back to disk, permanently
      // losing whatever the user had. This is almost certainly why some settings have appeared to
      // "not save" across an app update. A version bump here should still be reserved for actual
      // breaking shape changes that need a real transform — this default just prevents an
      // accidental wipe on ordinary additive changes (new fields, as most of this store's history
      // has been).
      migrate: (persistedState) => persistedState as Partial<AppState>,
      storage: createJSONStorage(() => (IS_SECONDARY_WINDOW ? readThroughLocalStorage : debouncedLocalStorage)),
      onRehydrateStorage: () => (state) => {
        // Read Aloud (TTS) — the ACTUAL backend activation constructs a Worker, a runtime side
        // effect `persist`'s plain state rehydration can't perform itself, so it's kicked off
        // here. Unconditional now that Kokoro is the only engine: if the pack is on disk, Read
        // Aloud should just work at launch with no preference to consult. `window.ttsModel` is
        // undefined in non-Electron test contexts (hence the `?.`) — there the inert backend
        // stays active, which is correct. Deferred to a promise `.then()` so it runs after
        // `useAppStore` has finished being assigned by the enclosing `create()` call below.
        window.ttsModel?.getStatus().then((status) => {
          useAppStore.getState().setKokoroModelReady(status.ready)
        }).catch(() => { /* leave kokoroModelReady false — Read Aloud stays inert */ })

        // Prefer the dedicated non-debounced viewer-font-scale key when present: the value in
        // the main 'berean-app-state' blob can be stale (debounce loss on a fast window close,
        // or a cross-window full-state clobber), whereas setViewerFontScale writes this key
        // synchronously every time. Runs for BOTH the main and presenter windows (same store).
        if (state) {
          try {
            const raw = localStorage.getItem(VIEWER_FONT_SCALE_SYNC_KEY)
            if (raw != null) {
              const n = JSON.parse(raw) as unknown
              if (typeof n === 'number' && Number.isFinite(n)) state.viewerFontScale = n
            }
          } catch { /* malformed/absent — keep whatever persist rehydrated */ }
        }

        if (!state?.tabs) return

        // Merge any new default word replacer rules (by ID) that are missing from persisted state
        if (Array.isArray(state.wordReplacerRules)) {
          const existingIds = new Set(state.wordReplacerRules.map((r: WordReplacerRule) => r.id))
          const missing = DEFAULT_WORD_REPLACER_RULES.filter(r => !existingIds.has(r.id))
          if (missing.length > 0) {
            // Prepend compound/multi-word rules, append single-word rules
            const multiWord = missing.filter(r => r.queries.some(q => q.includes(' ')))
            const singleWord = missing.filter(r => !r.queries.some(q => q.includes(' ')))
            state.wordReplacerRules = [...multiWord, ...state.wordReplacerRules, ...singleWord]
          }
        }

        const spaces: SpaceId[] = ['scripture', 'notes', 'lexicon', 'youtube', 'search']
        for (const spaceId of spaces) {
          if (Array.isArray(state.tabs[spaceId])) {
            state.tabs[spaceId] = state.tabs[spaceId].filter((t) => t != null && typeof t === 'object')
          }
        }
        // Build the set of all valid (spaceId, tabId) pairs from the persisted tabs.
        const validKeys = new Set<string>()
        for (const spaceId of spaces) {
          for (const tab of (state.tabs[spaceId] ?? [])) {
            validKeys.add(`${spaceId}:${tab.id}`)
          }
        }

        // If we have a persisted MRU list, validate it (drop stale entries for closed tabs)
        // and keep the true MRU order. Only fall back to the sidebar-order rebuild when
        // nothing was persisted (e.g. first launch or old data format).
        const persistedMRU = Array.isArray(state.tabMRUList) ? state.tabMRUList : []
        const validatedMRU = persistedMRU.filter(
          (m) => validKeys.has(`${m.spaceId}:${m.tabId}`)
        )
        const seenInMRU = new Set(validatedMRU.map((m) => `${m.spaceId}:${m.tabId}`))

        // Append any open tabs that are missing from the persisted MRU
        // (e.g. tabs opened externally, or a fresh install with no prior MRU).
        // Active tabs go first within the missing set, then remaining in sidebar order.
        const missing: Array<{ spaceId: SpaceId; tabId: string }> = []
        for (const spaceId of spaces) {
          const spaceTabs = state.tabs[spaceId] ?? []
          const activeId = state.activeTabId?.[spaceId]
          if (activeId && spaceTabs.find((t) => t.id === activeId)) {
            const key = `${spaceId}:${activeId}`
            if (!seenInMRU.has(key)) { missing.push({ spaceId, tabId: activeId }); seenInMRU.add(key) }
          }
          for (const tab of spaceTabs) {
            const key = `${spaceId}:${tab.id}`
            if (!seenInMRU.has(key)) { missing.push({ spaceId, tabId: tab.id }); seenInMRU.add(key) }
          }
        }
        state.tabMRUList = [...validatedMRU, ...missing]
      },
      partialize: (state) => ({
        // NOTE: `activeSpace`, `activeTabId`, `panelLayout` and `currentSessionId`
        // are PER-WINDOW view state and are deliberately NOT persisted in this
        // shared blob — synced peer windows would clobber each other's view on
        // the next launch. They are saved/restored per window by
        // src/lib/perWindowViewState.ts. `tabs` stays here (the current
        // session's tab SET is shared) and is also snapshotted into `sessions`
        // below so a per-window restore can pull fresh tabs for its own session.
        tabs: state.tabs,
        sidebarCollapsed: state.sidebarCollapsed,
        lastSettingsSection: state.lastSettingsSection,
        settingsSectionScrollTop: state.settingsSectionScrollTop,
        sidebarWidth: state.sidebarWidth,
        theme: state.theme,
        bibleFontSize: state.bibleFontSize,
        appZoom: state.appZoom,
        bibleLineHeight: state.bibleLineHeight,
        defaultBibleTranslation: state.defaultBibleTranslation,
        hermasTranslation: state.hermasTranslation,
        autoPiP: state.autoPiP,
        aiLookupCommentaryOn: state.aiLookupCommentaryOn,
        aiLookupAgenticOn: state.aiLookupAgenticOn,
        aiLookupUseTabContext: state.aiLookupUseTabContext,
        aiLookupPanelPos: state.aiLookupPanelPos,
        aiLookupPanelSize: state.aiLookupPanelSize,
        pdfFeatureEnabled: state.pdfFeatureEnabled,
        dailyNoteLocation: state.dailyNoteLocation,
        wordReplacerEnabled: state.wordReplacerEnabled,
        wordReplacerRules: state.wordReplacerRules,
        studyTrailAskChapterJumpReason: state.studyTrailAskChapterJumpReason,
        noteVerseRefsEnabled: state.noteVerseRefsEnabled,
        noteLexiconRefsEnabled: state.noteLexiconRefsEnabled,
        autoEmDash: state.autoEmDash,
        themePreset: state.themePreset,
        backgroundAnimationEnabled: state.backgroundAnimationEnabled,
        backgroundAnimationStyle: state.backgroundAnimationStyle,
        backgroundAnimationIntensity: state.backgroundAnimationIntensity,
        scriptureFontFamily: state.scriptureFontFamily,
        notesFontFamily: state.notesFontFamily,
        noteTypingLook: state.noteTypingLook,
        noteSidePanelPinned: state.noteSidePanelPinned,
        uiFontFamily: state.uiFontFamily,
        autoCloseTabsAfter: state.autoCloseTabsAfter,
        defaultScriptureLayout: state.defaultScriptureLayout,
        noteTransformLayout: state.noteTransformLayout,
        floatingSearchDensity: state.floatingSearchDensity,
        defaultYoutubeLayout: state.defaultYoutubeLayout,
        tabMRUList: state.tabMRUList,
        archivedGroups: state.archivedGroups,
        // Snapshot the live tabs of whichever session this window is currently
        // on back into the sessions array, so `sessions` stays the authoritative
        // per-session tab store on disk (addTab/closeTab only mutate top-level
        // `tabs`). A per-window restore then reads fresh tabs for its own
        // session straight from here.
        sessions: state.sessions.map((s) =>
          s.id === state.currentSessionId
            ? { ...s, tabs: state.tabs, activeTabId: state.activeTabId }
            : s,
        ),
        // currentSessionId: per-window (see note in partialize head)
        sessionDisplayOrders: state.sessionDisplayOrders,
        tasksVisible: state.tasksVisible,
        tasksMinimized: state.tasksMinimized,
        completedTaskIds: state.completedTaskIds,
        completedStepIds: state.completedStepIds,
        historyExpandedDays: state.historyExpandedDays,
        historyExpandedSessions: state.historyExpandedSessions,
        historyAutoExpandedKey: state.historyAutoExpandedKey,
        // Print & Export settings
        printMarginPreset: state.printMarginPreset,
        printCustomMargins: state.printCustomMargins,
        printPaperSize: state.printPaperSize,
        printFontSizePt: state.printFontSizePt,
        printFontFamily: state.printFontFamily,
        printIncludeTitle: state.printIncludeTitle,
        printColorMode: state.printColorMode,
        printTheme: state.printTheme,
        pdfDownloadLocation: state.pdfDownloadLocation,
        idiomHighlightEnabled: state.idiomHighlightEnabled,
        idiomHoverPreviewEnabled: state.idiomHoverPreviewEnabled,
        swipePanelGestureEnabled: state.swipePanelGestureEnabled,
        viewerFontScale: state.viewerFontScale,
        viewerTheme: state.viewerTheme,
        viewerLaserEnabled: state.viewerLaserEnabled,
        viewerSelectionMirror: state.viewerSelectionMirror,
        viewerSidePanelEnabled: state.viewerSidePanelEnabled,
        // Per-tab back/forward nav stacks — persisted so history survives restarts.
        tabNavStacks: state.tabNavStacks,
        tabNavMaxStack: state.tabNavMaxStack,
        historyMaxEntries: state.historyMaxEntries,
        recentSearchQueries: state.recentSearchQueries,
        // Read Aloud (TTS) preferences — playback state itself is NOT persisted (see
        // audioPlayback's own doc comment above): only voice/speed/toggle prefs survive restart.
        ttsVoiceURI: state.ttsVoiceURI,
        ttsRate: state.ttsRate,
        ttsHighlightWordsEnabled: state.ttsHighlightWordsEnabled,
        ttsAutoAdvanceEnabled: state.ttsAutoAdvanceEnabled,
        ttsAutoAdvancePauseSec: state.ttsAutoAdvancePauseSec,
        ttsAutoplayOnOpen: state.ttsAutoplayOnOpen,
        // Queue popover's open/closed state and on-screen position — see their own doc
        // comments above. Unlike audioPlayback/playbackQueue, this is small, harmless UI
        // chrome state, safe (and expected, per the original ask) to survive a restart.
        queuePopoverOpen: state.queuePopoverOpen,
        queuePopoverPos: state.queuePopoverPos,
        reasonPromptPopoverPos: state.reasonPromptPopoverPos,
        // NOTE: history is persisted to SQLite (history table), not localStorage.
        // It is loaded on mount in App.tsx via window.history.getAll().
      })
    }
  )
)

// Cross-window LIVE settings sync. Two windows (main + Study Trail) each hold their own
// independent useAppStore instance, both persisted to the SAME 'berean-app-state' localStorage
// key — but persist's rehydration only ever runs ONCE, at each window's own mount. Toggling a
// setting in one already-open window (e.g. the Study Trail window's "Ask why?" title-bar
// button) writes to localStorage fine, but the OTHER already-open window's in-memory store
// never re-reads it — it was silently stale until an app restart. Confirmed the actual cause of
// "i have the toggle on... i still dont see any of the ask why things": the main window (where
// the arrival prompt is mounted, see StudyTrailArrivalPrompt.tsx) never learned the toggle in
// the Study Trail window's title bar had been flipped.
//
// The native `storage` event fires in every OTHER window when localStorage changes (never the
// window that made the write) — exactly the missing piece. debouncedLocalStorage.ts still
// batches the actual disk write up to ~500ms, so this lands with that same small delay, which is
// fine for a settings toggle. Scoped to an explicit allowlist (not a full-state overwrite) so a
// tab/UI-state field mid-edit in one window is never clobbered by a stale snapshot from another.
// v37 — studyTrailAskChapterJumpReason moved OFF this general path (CROSS_WINDOW_SYNCED_KEYS is
// now empty, kept as an array in case another key needs the same treatment later): it was the
// actual cause of "sometimes when i click the ask why toggle it doesnt stay toggled". Root
// cause was debouncedLocalStorage.ts — 'berean-app-state' writes are debounced/coalesced to ONE
// pending write per window (up to 500ms), so if window B does ANY other persisted-state change
// shortly after window A flips this toggle, B's own debounced writer eventually flushes B's
// FULL state snapshot — including B's own still-stale in-memory copy of this one field, since
// B's storage-event handler may not have processed A's change yet — clobbering A's just-written
// value. A boolean this small doesn't need the big-blob's debounce at all: see
// setStudyTrailAskChapterJumpReason above, which now ALSO writes straight to `localStorage`
// (not the debounced wrapper) under its own dedicated key, immediately, every time it changes —
// nothing else ever touches that key, so there's no snapshot for another window to clobber it
// with.
const ASK_WHY_SYNC_KEY = 'berean-ask-why-sync'
const CROSS_WINDOW_SYNCED_KEYS: Array<keyof AppState> = []
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === ASK_WHY_SYNC_KEY) {
      if (e.newValue != null) useAppStore.setState({ studyTrailAskChapterJumpReason: e.newValue === '1' })
      return
    }
    if (e.key === VIEWER_FONT_SCALE_SYNC_KEY) {
      // Presenter window changed its zoom — push it into this window's store so its own
      // later full-state flush can't write a stale value back over the dedicated key.
      if (e.newValue != null) {
        try {
          const n = JSON.parse(e.newValue) as unknown
          if (typeof n === 'number' && Number.isFinite(n)) useAppStore.setState({ viewerFontScale: n })
        } catch { /* ignore malformed */ }
      }
      return
    }
    if (e.key !== 'berean-app-state' || !e.newValue) return
    try {
      const parsed = JSON.parse(e.newValue) as { state?: Partial<AppState> }
      if (!parsed.state) return
      const patch: Partial<AppState> = {}
      for (const key of CROSS_WINDOW_SYNCED_KEYS) {
        if (key in parsed.state) (patch as any)[key] = (parsed.state as any)[key]
      }
      if (Object.keys(patch).length > 0) useAppStore.setState(patch)
    } catch {
      // Malformed/partial localStorage value mid-write — next change will resync.
    }
  })
}
