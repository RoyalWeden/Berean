import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { SpaceId, Tab, TabState, TabType, MosaicKey, BibleTabState, HistoryEntry } from '@/types'
import type { MosaicNode } from 'react-mosaic-component'

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
  // Minimum fraction (0..1) of verse text that must match to auto-format a block
  noteScriptureBlockThreshold: number
  setNoteScriptureBlockThreshold: (v: number) => void
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
  setPrintColorMode: (v: 'color' | 'grayscale') => void
  setPdfDownloadLocation: (v: string) => void

  // Note editor preferences
  defaultNoteEditorMode: 'raw' | 'wysiwyg' | 'preview'
  setDefaultNoteEditorMode: (m: 'raw' | 'wysiwyg' | 'preview') => void
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

  // Scripture display preferences
  showVerseNumbers: boolean
  setShowVerseNumbers: (v: boolean) => void
  showRedLetters: boolean
  setShowRedLetters: (v: boolean) => void

  // Display preferences
  bibleFontSize: number
  bibleLineHeight: 'compact' | 'comfortable' | 'spacious'
  defaultBibleTranslation: string
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
  sidebarNewTabIconOnly: boolean
  setSidebarNewTabIconOnly: (v: boolean) => void

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

  // Sessions
  sessions: Session[]
  currentSessionId: string
  sessionTabFilters: Record<string, TabType | 'all'>  // keyed by session ID
  sessionDisplayOrders: Record<string, string[]>        // keyed by session ID — custom tab display order
  createSession: (name?: string) => void
  switchSession: (id: string) => void
  renameSession: (id: string, name: string) => void
  setSessionIcon: (id: string, icon: string) => void
  deleteSession: (id: string) => void
  moveTabToSession: (spaceId: SpaceId, tabId: string, targetSessionId: string) => void
  setSessionTabFilter: (sessionId: string, filter: TabType | 'all') => void
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
  openSettings: () => void
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
      openFindBar: (autoOpen = false, seedChar = '') => set({ findBarOpen: true, findBarAutoOpen: autoOpen, findBarQuery: seedChar }),
      closeFindBar: () => set({ findBarOpen: false, findBarQuery: '', findBarAutoOpen: false }),
      setFindBarQuery: (q) => set({ findBarQuery: q }),
      setFindBarWordMode: (mode) => set({ findBarWordMode: mode }),
      activePanelId: 'bible' as 'bible' | 'notes' | 'lexicon',
      setActivePanelId: (id) => set({ activePanelId: id }),
      bibleFontSize: 16,
      bibleLineHeight: 'comfortable' as const,
      defaultBibleTranslation: 'kjva',
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
      openImportModal: () => set({ settingsOpen: true, settingsInitialSection: 'import', importInitialTab: 'biblegateway' }),
      openImportBibleGateway: () => set({ settingsOpen: true, settingsInitialSection: 'import', importInitialTab: 'biblegateway' }),
      openImportESword: () => set({ settingsOpen: true, settingsInitialSection: 'import', importInitialTab: 'esword' }),
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
      pendingYouTubeVideo: null,
      autoPiP: true,
      youtubeIsPlaying: false,
      youtubeNoteBack: null,
      lexiconNoteBack: null,
      markdownReferenceOpen: false,
      noteVerseRefsEnabled: true,
      noteLexiconRefsEnabled: true,
      noteScriptureBlock: false,
      noteScriptureBlockThreshold: 0.9,
      noteVerseBlockSuggest: true,
      noteStrongsBlockSuggest: true,
      // Print & Export defaults
      printMarginPreset: 'normal' as const,
      printCustomMargins: { top: 1, right: 1, bottom: 1, left: 1 },
      printPaperSize: 'letter' as const,
      printFontSizePt: 12,
      printFontFamily: 'system' as const,
      printIncludeTitle: true,
      printColorMode: 'color' as const,
      printTheme: 'classic' as const,
      pdfDownloadLocation: '',

      defaultNoteEditorMode: 'wysiwyg' as const,
      confirmNoteDelete: false,
      noteSpellCheck: true,
      autoCopyOnHighlight: false,
      noteHeadingDivider: true,
      noteBulletStyle: 'classic',
      showVerseNumbers: true,
      showRedLetters: true,
      wordReplacerEnabled: true,
      wordReplacerRules: DEFAULT_WORD_REPLACER_RULES,

      archivedGroups: [] as ArchivedGroup[],
      sessions: [DEFAULT_SESSION] as Session[],
      currentSessionId: 'default',
      sessionTabFilters: {} as Record<string, TabType | 'all'>,
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

      setSessionTabFilter: (sessionId, filter) =>
        set((s) => ({ sessionTabFilters: { ...s.sessionTabFilters, [sessionId]: filter } })),

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
          tab = { id, spaceId, type, title: 'New Note', state: { noteId: null, isNew: true } }
        } else if (type === 'youtube') {
          tab = { id, spaceId, type, title: 'YouTube', state: { videoId: null, playlistId: null } }
        } else {
          tab = { id, spaceId, type, title: 'Search', state: { query: '', results: [] } }
        }
        const state = get()
        set({
          tabs: { ...state.tabs, [spaceId]: [...state.tabs[spaceId], tab] },
          activeTabId: { ...state.activeTabId, [spaceId]: id },
          activeSpace: spaceId,
          tabMRUList: updateMRU(state.tabMRUList, spaceId, id),
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
          const currentTabs = state.tabs[tab.spaceId]
          const activeId = state.activeTabId[tab.spaceId]
          const activeIdx = activeId ? currentTabs.findIndex((t) => t.id === activeId) : -1
          const insertAt = activeIdx >= 0 ? activeIdx + 1 : currentTabs.length
          const newTabs = [...currentTabs.slice(0, insertAt), tab, ...currentTabs.slice(insertAt)]
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
        // Switch to the most-recently-used remaining tab in this space (skip adjacent fallback)
        const mruActiveId =
          state.tabMRUList
            .filter((m) => m.spaceId === spaceId && m.tabId !== tabId)
            .map((m) => m.tabId)
            .find((id) => newTabs.some((t) => t.id === id))
          ?? newTabs[Math.max(0, idx - 1)]?.id ?? null
        const newActiveId =
          state.activeTabId[spaceId] === tabId
            ? mruActiveId
            : state.activeTabId[spaceId]
        set({
          tabs: { ...state.tabs, [spaceId]: newTabs },
          activeTabId: { ...state.activeTabId, [spaceId]: newActiveId },
          tabMRUList: state.tabMRUList.filter((m) => !(m.spaceId === spaceId && m.tabId === tabId)),
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
        const newActiveId =
          state.tabMRUList
            .filter((m) => m.spaceId === spaceId && m.tabId !== tabId)
            .map((m) => m.tabId)
            .find((id) => newTabs.some((t) => t.id === id))
          ?? newTabs[Math.max(0, idx - 1)]?.id ?? null
        const prunedMRU = state.tabMRUList.filter((m) => !(m.spaceId === spaceId && m.tabId === tabId))
        const newTabsAll = { ...state.tabs, [spaceId]: newTabs }

        // If no tabs remain in this space, switch to the first space that still has tabs
        if (newTabs.length === 0) {
          const spaceOrder: SpaceId[] = ['scripture', 'notes', 'lexicon', 'youtube', 'search']
          const fallbackSpace = spaceOrder.find(s => s !== spaceId && (newTabsAll[s]?.length ?? 0) > 0) ?? spaceId
          const fallbackTabId = newTabsAll[fallbackSpace]?.[0]?.id ?? null
          set({
            tabs: newTabsAll,
            activeTabId: { ...state.activeTabId, [spaceId]: newActiveId },
            activeSpace: fallbackSpace,
            tabMRUList: prunedMRU,
            ...(fallbackTabId ? { activeTabId: { ...state.activeTabId, [spaceId]: newActiveId, [fallbackSpace]: fallbackTabId } } : {}),
          })
        } else {
          set({ tabs: newTabsAll, activeTabId: { ...state.activeTabId, [spaceId]: newActiveId }, tabMRUList: prunedMRU })
        }
      },

      setActiveTab: (spaceId, tabId) => {
        const state = get()
        const key = `${spaceId}:${tabId}`
        set({
          activeTabId: { ...state.activeTabId, [spaceId]: tabId },
          activeSpace: spaceId,
          tabMRUList: updateMRU(state.tabMRUList, spaceId, tabId),
          tabLastAccessed: { ...state.tabLastAccessed, [key]: Date.now() },
        })
      },

      updateTabState: (spaceId, tabId, newState) => {
        const state = get()
        const tabs = state.tabs[spaceId].map((t) =>
          t.id === tabId ? { ...t, state: { ...t.state, ...newState } } : t
        )
        set({ tabs: { ...state.tabs, [spaceId]: tabs } })
      },

      updatePanelLayout: (layout) => set({ panelLayout: layout }),

      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),

      openSearch: (mode = 'current') => {
        window.dispatchEvent(new Event('berean:closeMenus'))
        set({ searchOpen: true, searchMode: mode, findBarOpen: false, findBarQuery: '', findBarAutoOpen: false, settingsOpen: false })
      },
      closeSearch: () => set({ searchOpen: false }),
      requestOpenNote: (noteId) => set({ pendingNoteId: noteId }),
      clearPendingNote: () => set({ pendingNoteId: null }),
      filterNotesByVerse: (verseRef) => set({ pendingVerseFilter: verseRef }),
      clearVerseFilter: () => set({ pendingVerseFilter: null }),
      bumpNoteToken: () => set((s) => ({ noteChangeToken: s.noteChangeToken + 1 })),
      // Apply tab state received from another window (does NOT trigger another broadcast)
      applyExternalTabSync: (payload: { tabs: AppState['tabs']; theme?: string; themePreset?: string }) => {
        const update: Partial<AppState> = { tabs: payload.tabs }
        if (payload.theme !== undefined) update.theme = payload.theme as AppState['theme']
        if (payload.themePreset !== undefined) update.themePreset = payload.themePreset
        set(update)
      },

      openSettings: () => { window.dispatchEvent(new Event('berean:closeMenus')); set({ settingsOpen: true }) },
      closeSettings: () => set({ settingsOpen: false }),
      toggleSettings: () => set((s) => ({ settingsOpen: !s.settingsOpen })),

      openLexiconEntry: (strongsNum, fromNote) => {
        get().addHistoryEntry({ type: 'lexicon', title: strongsNum, strongsNum })
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
        set({
          pendingYouTubeVideo: { videoId, startTime },
          activeSpace: 'youtube',
          activeTabId: { ...fresh.activeTabId, youtube: fresh.tabs['youtube'][0]?.id ?? null },
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
      setPrintColorMode: (v) => set({ printColorMode: v }),
      setPrintTheme: (v) => set({ printTheme: v }),
      setPdfDownloadLocation: (v) => set({ pdfDownloadLocation: v }),

      setNoteVerseRefsEnabled: (v) => set({ noteVerseRefsEnabled: v }),
      setNoteLexiconRefsEnabled: (v) => set({ noteLexiconRefsEnabled: v }),
      setNoteScriptureBlock: (v) => set({ noteScriptureBlock: v }),
      setNoteScriptureBlockThreshold: (v) => set({ noteScriptureBlockThreshold: Math.max(0, Math.min(1, v)) }),
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
      setDefaultNoteEditorMode: (m) => set({ defaultNoteEditorMode: m }),
      setConfirmNoteDelete: (v) => set({ confirmNoteDelete: v }),
      setNoteSpellCheck: (v) => set({ noteSpellCheck: v }),
      setAutoCopyOnHighlight: (v) => set({ autoCopyOnHighlight: v }),
      setNoteHeadingDivider: (v) => set({ noteHeadingDivider: v }),
      setNoteBulletStyle: (s) => set({ noteBulletStyle: s }),
      setShowVerseNumbers: (v) => set({ showVerseNumbers: v }),
      setShowRedLetters: (v) => set({ showRedLetters: v }),

      setWordReplacerEnabled: (v) => set({ wordReplacerEnabled: v }),
      setWordReplacerRules: (rules) => set({ wordReplacerRules: rules }),
      toggleWordReplacerRule: (id) => set((s) => ({
        wordReplacerRules: s.wordReplacerRules.map((r) => r.id === id ? { ...r, enabled: !r.enabled } : r),
      })),

      setTheme: (theme) => set({ theme }),
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
      sidebarNewTabIconOnly: false,
      setSidebarNewTabIconOnly: (v) => set({ sidebarNewTabIconOnly: v }),
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
        bibleLineHeight: state.bibleLineHeight,
        defaultBibleTranslation: state.defaultBibleTranslation,
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
        sessionTabFilters: state.sessionTabFilters,
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
        // NOTE: history is persisted to SQLite (history table), not localStorage.
        // It is loaded on mount in App.tsx via window.history.getAll().
      })
    }
  )
)
