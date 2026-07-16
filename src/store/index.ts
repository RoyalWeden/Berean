import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { SpaceId, Tab, TabState, TabType, MosaicKey, BibleTabState, HistoryEntry, TabNavEntry } from '@/types'
import type { MosaicNode } from 'react-mosaic-component'
import { clampZoom, adjustZoom, ZOOM_DEFAULT } from '@/lib/zoom'
import { bookName } from '@/lib/parseRef'
import { isHermasBook, clampHermasChapter, hermasVariantForTextId } from '@/lib/hermasMap'
import type { UpdateStatus } from '@/types/electron'

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

export interface AppState {
  // Navigation
  activeSpace: SpaceId
  tabs: Record<SpaceId, Tab[]>
  activeTabId: Record<SpaceId, string | null>

  // Panel layout
  panelLayout: MosaicNode<MosaicKey> | null
  sidebarCollapsed: boolean

  // UI modals
  searchOpen: boolean
  searchMode: 'current' | 'new'
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
  applyExternalTabSync: (payload: { tabs: AppState['tabs']; theme?: string; themePreset?: string }) => void

  // Cross-panel lexicon communication
  pendingLexiconEntry: string | null
  openLexiconEntry: (strongsNum: string, fromNote?: { noteId: string; title: string }) => void
  clearLexiconEntry: () => void
  pendingLexiconSearch: string | null
  requestLexiconSearch: (term: string) => void
  clearLexiconSearch: () => void

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
  openYouTubeVideoInNewTab: (videoId: string) => void
  openPdf: (pdfId: string, title: string, page?: number) => void
  clearPendingYouTubeVideo: () => void

  // YouTube playback preferences
  autoPiP: boolean
  setAutoPiP: (v: boolean) => void
  youtubeIsPlaying: boolean
  setYoutubeIsPlaying: (v: boolean) => void
  youtubeNoteBack: { noteId: string; title: string } | null
  setYoutubeNoteBack: (note: { noteId: string; title: string } | null) => void
  lexiconNoteBack: { noteId: string; title: string } | null
  setLexiconNoteBack: (note: { noteId: string; title: string } | null) => void

  // Markdown reference modal
  markdownReferenceOpen: boolean
  openMarkdownReference: () => void
  closeMarkdownReference: () => void

  // Dedicated scripture search tab
  openScriptureSearchTab: (query?: string) => void

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
  // A single global flag (not per-tab) since it's about the whole window's chrome, not one
  // note's own state — toggling it while a different tab is active would be surprising.
  noteFocusMode: boolean
  toggleNoteFocusMode: () => void
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

  // Print & Export settings
  printMarginPreset: 'none' | 'narrow' | 'normal' | 'wide' | 'custom'
  printCustomMargins: { top: number; right: number; bottom: number; left: number }  // inches
  printPaperSize: 'letter' | 'a4' | 'legal'
  printFontSizePt: number
  printFontFamily: 'system' | 'serif' | 'sansserif'
  printIncludeTitle: boolean
  printIncludeLinkedNotes: boolean
  printColorMode: 'color' | 'grayscale'
  printTheme: import('@/components/notes/NoteEditor').PrintThemeId
  pdfDownloadLocation: string  // '' = prompt each time
  setPrintTheme: (v: import('@/components/notes/NoteEditor').PrintThemeId) => void
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

  // Idiom notes
  idiomHighlightEnabled: boolean
  setIdiomHighlightEnabled: (v: boolean) => void
  idiomHoverPreviewEnabled: boolean
  setIdiomHoverPreviewEnabled: (v: boolean) => void
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
  themePreset: string  // '' = default, or one of the preset class names
  setThemePreset: (preset: string) => void

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
  addTab: (tab: Tab) => void
  createTab: (type: TabType) => void
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
  openSearch: (mode?: 'current' | 'new') => void
  closeSearch: () => void

  // Recent search queries (persisted, max 10)
  recentSearchQueries: string[]
  addRecentSearchQuery: (q: string) => void
  openSettings: () => void
  openSettingsToSessions: () => void
  openSettingsToAbout: () => void
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
      searchOpen: false,
      searchMode: 'current' as const,
      settingsOpen: false,
      pendingNoteId: null,
      pendingVerseFilter: null,
      noteChangeToken: 0,
      presenterPushToken: 0,
      pendingLexiconEntry: null,
      pendingLexiconSearch: null,
      pendingRightPanelNoteId: null,
      pendingRightPanelVerseFilter: null,
      pendingRightPanelCrossRefVerse: null,
      highlightChangeToken: 0,
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
          // Skip if the very last entry is identical (prevents duplicates from re-renders)
          const last = prev[0]
          if (last &&
            last.type === newEntry.type &&
            last.bookId === newEntry.bookId &&
            last.chapter === newEntry.chapter &&
            last.noteId === newEntry.noteId &&
            last.strongsNum === newEntry.strongsNum &&
            last.videoId === newEntry.videoId &&
            last.query === newEntry.query &&
            last.parentId === newEntry.parentId
          ) return {}
          // No in-memory cap — history is unbounded; older entries are lazy-loaded.
          return { history: [newEntry, ...prev] }
        })
        // Persist to SQLite (non-blocking)
        window.appHistory?.add(newEntry).catch(() => {})
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
              top.pdfId === full.pdfId && top.page === full.page) return {}
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
        if (entry.bookId) {
          get().updateTabState(s.activeSpace, activeTabId, {
            bookId: entry.bookId, chapter: entry.chapter ?? 1,
            ...(entry.translation ? { translation: entry.translation } : {}),
            scrollPosition: 0, targetVerse: undefined,
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
        const newIdx = tabStack.idx + 1
        const entry = tabStack.stack[newIdx]
        set({ isNavJumping: true, tabNavStacks: { ...s.tabNavStacks, [activeTabId]: { ...tabStack, idx: newIdx } } })
        if (entry.bookId) {
          get().updateTabState(s.activeSpace, activeTabId, {
            bookId: entry.bookId, chapter: entry.chapter ?? 1,
            ...(entry.translation ? { translation: entry.translation } : {}),
            scrollPosition: 0, targetVerse: undefined,
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
        if (!tabStack || tabStack.idx < 0) return
        const stackType = tabStack.stack[0]?.type
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

      pendingYouTubeVideo: null,
      autoPiP: true,
      youtubeIsPlaying: false,
      youtubeNoteBack: null,
      lexiconNoteBack: null,
      markdownReferenceOpen: false,
      noteVerseRefsEnabled: true,
      noteLexiconRefsEnabled: true,
      noteScriptureBlock: false,
      sidePanelScriptureBlock: true,
      noteFocusMode: false,
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
      noteBulletStyle: 'classic',
      idiomHighlightEnabled: true,
      idiomHoverPreviewEnabled: true,
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

      createTab: (type) => {
        const spaceId = TYPE_TO_SPACE[type]
        const id = `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
        let tab: Tab
        if (type === 'bible') {
          const defTranslation = get().defaultBibleTranslation.toUpperCase()
          tab = { id, spaceId, type, title: 'Genesis 1', state: { bookId: 'GEN', chapter: 1, translation: defTranslation, showStrongs: false, scrollPosition: 0 } }
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

        // Insert the new tab right after the currently-active tab in the
        // unified sidebar display order, not just appended to its own space's
        // array — without this, a new notes tab lands after the LAST notes
        // tab (wherever that sits in the flattened space-grouped order)
        // instead of next to whatever tab the user was actually looking at.
        const allSpaces: SpaceId[] = ['scripture', 'notes', 'lexicon', 'youtube', 'search']
        const allTabsBefore = allSpaces.flatMap((sp) => state.tabs[sp] ?? [])
        const stored = state.sessionDisplayOrders[state.currentSessionId] ?? []
        const liveOrder = [
          ...stored.filter((tid) => allTabsBefore.some((t) => t.id === tid)),
          ...allTabsBefore.filter((t) => !stored.includes(t.id)).map((t) => t.id),
        ]
        const activeTabIdOverall = state.activeTabId[state.activeSpace]
        const activeIdx = activeTabIdOverall ? liveOrder.indexOf(activeTabIdOverall) : -1
        const insertAt = activeIdx === -1 ? liveOrder.length : activeIdx + 1
        const newOrder = [...liveOrder]
        newOrder.splice(insertAt, 0, id)

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

      addTab: (tab) => {
        const state = get()
        const existing = state.tabs[tab.spaceId].find((t) => t.id === tab.id)
        if (existing) {
          set({
            activeTabId: { ...state.activeTabId, [tab.spaceId]: tab.id },
            activeSpace: tab.spaceId,
            tabMRUList: updateMRU(state.tabMRUList, tab.spaceId, tab.id),
          })
        } else {
          // Always append at the end of the target space's tab list (same as
          // createTab) — inserting right after whatever tab happened to be
          // last-active in that space put new tabs in an unpredictable middle
          // position, especially when the space wasn't the one currently in view.
          const currentTabs = state.tabs[tab.spaceId]
          const newTabs = [...currentTabs, tab]
          set({
            tabs: { ...state.tabs, [tab.spaceId]: newTabs },
            activeTabId: { ...state.activeTabId, [tab.spaceId]: tab.id },
            activeSpace: tab.spaceId,
            tabMRUList: updateMRU(state.tabMRUList, tab.spaceId, tab.id),
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
            return { tabs: newTabsAll, tabMRUList: prunedMRU, tabNavStacks: restNavStacks }
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
          if (mruFallback && mruFallback.spaceId !== spaceId) {
            return {
              tabs: newTabsAll,
              activeTabId: { ...state.activeTabId, [spaceId]: withinSpaceFallbackId, [mruFallback.spaceId]: mruFallback.tabId },
              activeSpace: mruFallback.spaceId,
              tabMRUList: prunedMRU,
              tabNavStacks: restNavStacks,
            }
          }
          return {
            tabs: newTabsAll,
            activeTabId: { ...state.activeTabId, [spaceId]: mruFallback?.tabId ?? withinSpaceFallbackId },
            tabMRUList: prunedMRU,
            tabNavStacks: restNavStacks,
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

        // When leaving a dynamic scripture search tab (searchMode: true), exit its
        // search mode so re-visiting it shows Bible text and the next search opens fresh.
        // The dedicated tab ('scripture-search-dedicated') is exempt — it always stays as a search.
        let tabs = state.tabs[spaceId]
        if (prevTabId && prevTabId !== tabId && prevTabId !== 'scripture-search-dedicated') {
          const prevTab = tabs.find((t) => t.id === prevTabId)
          // BibleTabState carries searchMode; guard with 'searchMode' in check for the union type
          if (prevTab && 'searchMode' in prevTab.state && prevTab.state.searchMode) {
            tabs = tabs.map((t) =>
              t.id === prevTabId ? { ...t, state: { ...t.state, searchMode: false } } : t
            )
          }
        }

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
              const newBookId = ('bookId' in ns ? ns.bookId : cur.bookId) as string | undefined
              const newChapter = ('chapter' in ns ? ns.chapter : cur.chapter) as number | undefined
              // Book or chapter navigation — seed origin then push destination
              if (newBookId && newChapter && (newBookId !== cur.bookId || newChapter !== cur.chapter)) {
                const newTranslation = (('translation' in ns ? ns.translation : cur.translation) as string | undefined) ?? 'KJVA'
                // Seed stack with current position if empty
                const existing = get().tabNavStacks[tabId]
                if (!existing || existing.stack.length === 0) {
                  const originBookId = cur.bookId as string | undefined
                  const originChapter = cur.chapter as number | undefined
                  if (originBookId && originChapter) {
                    get().pushTabNav(tabId, {
                      type: 'bible', title: `${bookName(originBookId)} ${originChapter}`,
                      bookId: originBookId, chapter: originChapter,
                      translation: (cur.translation as string | undefined) ?? 'KJVA',
                    })
                  }
                }
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
                  if (bId && ch) {
                    get().pushTabNav(tabId, {
                      type: 'bible', title: `${bookName(bId)} ${ch}`,
                      bookId: bId, chapter: ch, translation: (cur.translation as string) ?? 'KJVA',
                    })
                  }
                }
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
                get().pushTabNav(tabId, { type: 'lexicon', title: ns.strongsNum as string, strongsNum: ns.strongsNum as string })
              }
            } else if (currentTab.type === 'youtube') {
              if ('videoId' in ns && ns.videoId && ns.videoId !== cur.videoId) {
                get().pushTabNav(tabId, { type: 'youtube', title: currentTab.title, videoId: ns.videoId as string })
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

      recentSearchQueries: [] as string[],
      addRecentSearchQuery: (q) => {
        const trimmed = q.trim()
        if (!trimmed || trimmed.length < 2) return
        set((s) => ({
          recentSearchQueries: [trimmed, ...s.recentSearchQueries.filter((r) => r !== trimmed)].slice(0, 10),
        }))
      },

      openSearch: (mode = 'current') => {
        window.dispatchEvent(new Event('berean:closeMenus'))
        set({ searchOpen: true, searchMode: mode, findBarOpen: false, findBarQuery: '', findBarAutoOpen: false, settingsOpen: false })
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
      // Apply tab state received from another window (does NOT trigger another broadcast)
      applyExternalTabSync: (payload: { tabs: AppState['tabs']; theme?: string; themePreset?: string }) => {
        const update: Partial<AppState> = { tabs: payload.tabs }
        if (payload.theme !== undefined) update.theme = payload.theme as AppState['theme']
        if (payload.themePreset !== undefined) update.themePreset = payload.themePreset
        set(update)
      },

      // Explicitly resets settingsInitialSection back to 'appearance' —
      // without this, the generic "open Settings" entry points (gear icon,
      // ⌘,) would keep landing on whatever section a PREVIOUS targeted
      // open (openImportModal, openSettingsToSessions, etc.) last set,
      // since that field is plain persistent store state, never cleared on
      // its own.
      openSettings: () => { window.dispatchEvent(new Event('berean:closeMenus')); set({ settingsOpen: true, settingsInitialSection: 'appearance' }) },
      // "Manage sessions…" (Sidebar.tsx) used to call plain openSettings(),
      // landing on the default Appearance tab instead of the "Manage your
      // data" hub where Sessions/Archived-tabs actually live (SessionsSection.tsx).
      openSettingsToSessions: () => { window.dispatchEvent(new Event('berean:closeMenus')); set({ settingsOpen: true, settingsInitialSection: 'data' }) },
      // Rail's Settings badge (Ribbon.tsx) jumps straight to the About/Updates
      // page when an update is available/ready, instead of the default tab.
      openSettingsToAbout: () => { window.dispatchEvent(new Event('berean:closeMenus')); set({ settingsOpen: true, settingsInitialSection: 'about' }) },
      closeSettings: () => set({ settingsOpen: false }),
      toggleSettings: () => set((s) => {
        const opening = !s.settingsOpen
        if (opening) window.dispatchEvent(new Event('berean:closeMenus'))
        return { settingsOpen: opening }
      }),

      openLexiconEntry: (strongsNum, fromNote) => {
        get().addHistoryEntry({ type: 'lexicon', title: strongsNum, strongsNum })
        if (!get().isNavJumping) {
          const tabId = get().activeTabId['lexicon']
          if (tabId) get().pushTabNav(tabId, { type: 'lexicon', strongsNum, title: strongsNum })
        }
        set({ pendingLexiconEntry: strongsNum, lexiconNoteBack: fromNote ?? null })
      },
      clearLexiconEntry: () => set({ pendingLexiconEntry: null }),
      requestLexiconSearch: (term) => set({ pendingLexiconSearch: term }),
      clearLexiconSearch: () => set({ pendingLexiconSearch: null }),
      openNoteInBiblePanel: (noteId) => set({ pendingRightPanelNoteId: noteId }),
      filterBiblePanelByVerse: (verseRef) => set({ pendingRightPanelVerseFilter: verseRef }),
      openCrossRefsInBiblePanel: (verseRef) => set({ pendingRightPanelCrossRefVerse: verseRef }),
      clearRightPanelNote: () => set({ pendingRightPanelNoteId: null }),
      clearRightPanelVerseFilter: () => set({ pendingRightPanelVerseFilter: null }),
      clearRightPanelCrossRef: () => set({ pendingRightPanelCrossRefVerse: null }),
      bumpHighlightToken: () => set((s) => ({ highlightChangeToken: s.highlightChangeToken + 1 })),
      openSearchTab: (query) => {
        get().addHistoryEntry({ type: 'search', title: `"${query}"`, query })
        if (get().tabs['search'].length === 0) get().createTab('search')
        const fresh = get()
        set({ pendingSearchQuery: query, activeSpace: 'search', activeTabId: { ...fresh.activeTabId, search: fresh.tabs['search'][0]?.id ?? null } })
      },
      clearSearchQuery: () => set({ pendingSearchQuery: null }),

      openYouTubeVideo: (videoId, startTime = 0, fromNote) => {
        get().addHistoryEntry({ type: 'youtube', title: videoId ?? 'YouTube', videoId: videoId ?? undefined })
        const state = get()
        if (state.tabs['youtube'].length === 0) get().createTab('youtube')
        const fresh = get()
        const ytTabId = fresh.tabs['youtube'][0]?.id ?? null
        if (!get().isNavJumping && videoId && ytTabId) {
          get().pushTabNav(ytTabId, { type: 'youtube', title: videoId, videoId })
        }
        set({
          pendingYouTubeVideo: { videoId, startTime },
          activeSpace: 'youtube',
          activeTabId: { ...fresh.activeTabId, youtube: ytTabId },
          youtubeNoteBack: fromNote ?? null,
        })
      },
      openYouTubeVideoInNewTab: (videoId) => {
        get().addHistoryEntry({ type: 'youtube', title: videoId ?? 'YouTube', videoId: videoId ?? undefined })
        get().createTab('youtube') // creates + activates a fresh youtube tab
        set({ pendingYouTubeVideo: { videoId, startTime: 0 }, activeSpace: 'youtube' })
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
      setYoutubeNoteBack: (note) => set({ youtubeNoteBack: note }),
      setLexiconNoteBack: (note) => set({ lexiconNoteBack: note }),
      openMarkdownReference: () => set({ markdownReferenceOpen: true }),
      closeMarkdownReference: () => set({ markdownReferenceOpen: false }),

      openScriptureSearchTab: (query?: string) => {
        if (query) get().addHistoryEntry({ type: 'search', title: `"${query}"`, query })
        const state = get()
        // Always create a fresh tab — never reuse an existing search tab
        const id = `scripture-search-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
        const tab: Tab = {
          id,
          spaceId: 'scripture',
          type: 'bible',
          title: 'Search',
          state: {
            bookId: 'GEN',
            chapter: 1,
            translation: state.defaultBibleTranslation.toUpperCase(),
            showStrongs: false,
            scrollPosition: 0,
            searchMode: true,
            scriptureSearchQuery: query ?? '',
          },
        }
        set({
          tabs: { ...state.tabs, scripture: [...state.tabs['scripture'], tab] },
          activeTabId: { ...state.activeTabId, scripture: id },
          activeSpace: 'scripture',
          tabMRUList: updateMRU(state.tabMRUList, 'scripture', id),
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
      toggleNoteFocusMode: () => set((s) => ({ noteFocusMode: !s.noteFocusMode })),
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
      setNoteBulletStyle: (s) => set({ noteBulletStyle: s }),
      setIdiomHighlightEnabled: (v) => set({ idiomHighlightEnabled: v }),
      setIdiomHoverPreviewEnabled: (v) => set({ idiomHoverPreviewEnabled: v }),
      setIdiomCache: (v: Array<{ id: string; term: string; meaning: string; aliases: string[]; autoVariants: boolean }>) => set({ idiomCache: v }),
      setViewerWindowOpen: (v) => set(v ? { viewerWindowOpen: true } : { viewerWindowOpen: false, viewerPaused: false, viewerBlank: false }),
      setViewerBlank: (v) => set({ viewerBlank: v }),
      setViewerPaused: (v) => set({ viewerPaused: v }),
      setViewerLaserEnabled: (v) => set({ viewerLaserEnabled: v }),
      setViewerSelectionMirror: (v) => set({ viewerSelectionMirror: v }),
      setViewerSidePanelEnabled: (v) => set({ viewerSidePanelEnabled: v }),
      setViewerFontScale: (v) => set({ viewerFontScale: v }),
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
      storage: createJSONStorage(() => localStorage),
      onRehydrateStorage: () => (state) => {
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
        activeSpace: state.activeSpace,
        tabs: state.tabs,
        activeTabId: state.activeTabId,
        panelLayout: state.panelLayout,
        sidebarCollapsed: state.sidebarCollapsed,
        theme: state.theme,
        bibleFontSize: state.bibleFontSize,
        appZoom: state.appZoom,
        bibleLineHeight: state.bibleLineHeight,
        defaultBibleTranslation: state.defaultBibleTranslation,
        hermasTranslation: state.hermasTranslation,
        autoPiP: state.autoPiP,
        wordReplacerEnabled: state.wordReplacerEnabled,
        wordReplacerRules: state.wordReplacerRules,
        noteVerseRefsEnabled: state.noteVerseRefsEnabled,
        noteLexiconRefsEnabled: state.noteLexiconRefsEnabled,
        themePreset: state.themePreset,
        scriptureFontFamily: state.scriptureFontFamily,
        notesFontFamily: state.notesFontFamily,
        uiFontFamily: state.uiFontFamily,
        autoCloseTabsAfter: state.autoCloseTabsAfter,
        defaultScriptureLayout: state.defaultScriptureLayout,
        noteTransformLayout: state.noteTransformLayout,
        floatingSearchDensity: state.floatingSearchDensity,
        defaultYoutubeLayout: state.defaultYoutubeLayout,
        tabMRUList: state.tabMRUList,
        archivedGroups: state.archivedGroups,
        sessions: state.sessions,
        currentSessionId: state.currentSessionId,
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
        viewerFontScale: state.viewerFontScale,
        viewerTheme: state.viewerTheme,
        viewerLaserEnabled: state.viewerLaserEnabled,
        viewerSelectionMirror: state.viewerSelectionMirror,
        viewerSidePanelEnabled: state.viewerSidePanelEnabled,
        // Per-tab back/forward nav stacks — persisted so history survives restarts.
        tabNavStacks: state.tabNavStacks,
        tabNavMaxStack: state.tabNavMaxStack,
        historyMaxEntries: state.historyMaxEntries,
        // NOTE: history is persisted to SQLite (history table), not localStorage.
        // It is loaded on mount in App.tsx via window.history.getAll().
      })
    }
  )
)
