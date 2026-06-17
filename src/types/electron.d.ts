import type { Book, Verse, Note, NoteVersion, NoteFolder, LexiconEntry, SearchResult, PdfDoc, PdfHighlight } from './index'

interface BibleAPI {
  queryChapter: (bookId: string, chapter: number, textId?: string) => Promise<Verse[]>
  queryVerse: (bookId: string, chapter: number, verse: number, textId?: string) => Promise<Verse | null>
  searchText: (query: string, textId?: string) => Promise<SearchResult[]>
  getBooks: (textId?: string) => Promise<Book[]>
}

interface NotesAPI {
  createNote: (data: Partial<Note>) => Promise<{ success: boolean; note?: Note; error?: string }>
  updateNote: (id: string, data: Partial<Note>) => Promise<{ success: boolean; error?: string }>
  deleteNote: (id: string) => Promise<{ success: boolean; error?: string }>
  deleteAllNotes: () => Promise<{ success: boolean }>
  deleteByTag: (tag: string) => Promise<{ success: boolean; deleted: number }>
  getNotes: (limit?: number, offset?: number) => Promise<Note[]>
  getVerseNotes: (verseRef: string, textId?: string) => Promise<Note[]>
  getNote: (id: string) => Promise<Note | null>
  getChapterNotes: (bookId: string, chapter: number, textId?: string) => Promise<Note[]>
  getChapterCounts: (bookId: string, chapter: number, textId?: string) => Promise<Record<number, number>>
  searchNotes: (query: string, limit?: number) => Promise<Note[]>
  setNoteFolder: (noteId: string, folderId: string | null) => Promise<{ success: boolean }>
  createNoteVersion: (noteId: string, title: string, content: string, kind?: string) => Promise<{ success: boolean; id?: string; skipped?: boolean }>
  getNoteVersions: (noteId: string) => Promise<NoteVersion[]>
  restoreNoteVersion: (noteId: string, versionId: string) => Promise<{ success: boolean; content?: string; error?: string }>
  getFolders: () => Promise<NoteFolder[]>
  createFolder: (name: string, parentId?: string | null) => Promise<{ success: boolean; id: string }>
  renameFolder: (id: string, name: string) => Promise<{ success: boolean }>
  deleteFolder: (id: string) => Promise<{ success: boolean }>
  deleteFolderDeep: (id: string) => Promise<{ success: boolean }>
  setFolderParent: (id: string, parentId: string | null) => Promise<{ success: boolean; error?: string }>
  listIdioms: () => Promise<Array<{ id: string; term: string; meaning: string; aliases: string[]; autoVariants: boolean }>>
}

type HighlightColor = 'yellow' | 'red' | 'green' | 'blue' | 'purple'
  | 'orange' | 'pink' | 'teal' | 'cyan' | 'indigo'
  | 'lime' | 'amber' | 'rose' | 'violet' | 'sky'

interface HighlightsAPI {
  getChapter: (bookId: string, chapter: number, textId?: string) => Promise<Record<number, Array<{ id: string; color: HighlightColor; startWord: number | null; endWord: number | null; startChar: number | null; endChar: number | null }>>>
  toggle: (params: { bookId: string; chapter: number; verseNum: number; color: HighlightColor; textId?: string; startWord?: number; endWord?: number; startChar?: number; endChar?: number }) => Promise<{ removed?: boolean; updated?: boolean; created?: boolean; id: string; color?: HighlightColor }>
  remove: (bookId: string, chapter: number, verseNum: number, textId?: string) => Promise<{ success: boolean }>
}

interface LexiconAPI {
  getEntry: (strongsNum: string) => Promise<LexiconEntry | null>
  getOccurrences: (strongsNum: string) => Promise<{ book_id: string; chapter: number; verse_num: number; text: string; matchWordIndices: number[] }[]>
  getRelated: (strongsNum: string) => Promise<{ strongsNum: string; lemma: string; transliteration: string; gloss: string }[]>
  search: (query: string, lang: 'H' | 'G' | 'all') => Promise<LexiconEntry[]>
}

interface SettingsAPI {
  get: (key: string) => Promise<unknown>
  set: (key: string, value: unknown) => Promise<{ success: boolean }>
  getAll: () => Promise<Record<string, unknown>>
}

interface PdfAPI {
  import: () => Promise<{ success?: boolean; canceled?: boolean; error?: string; pdf?: PdfDoc }>
  list: () => Promise<PdfDoc[]>
  get: (id: string) => Promise<PdfDoc | null>
  readBytes: (id: string) => Promise<ArrayBuffer | null>
  setPageCount: (id: string, n: number) => Promise<{ success: boolean }>
  rename: (id: string, title: string) => Promise<{ success: boolean }>
  delete: (id: string) => Promise<{ success: boolean }>
  highlightsList: (pdfId: string) => Promise<PdfHighlight[]>
  highlightsAdd: (data: {
    pdfId: string; page: number; rects: Array<{ x: number; y: number; w: number; h: number }>
    color: string; text: string; note?: string | null
  }) => Promise<{ success: boolean; id: string }>
  highlightsRemove: (id: string) => Promise<{ success: boolean }>
  highlightsSetNote: (id: string, note: string) => Promise<{ success: boolean }>
}

interface YouTubeVideoEntry {
  videoId: string
  title: string
  published: string
  channelName: string
  channelHandle: string
  thumbnailUrl: string
  type: 'video' | 'short' | 'live'
  isLiveNow: boolean
  durationSeconds: number
  isStarred: boolean
  description: string
}

interface YouTubeWatchHistoryEntry {
  videoId: string
  positionSeconds: number
  lastWatched: string
  title: string
  channelName: string
  thumbnailUrl: string
}

interface YouTubeSyncProgress {
  done: number
  total: number
  phase: string
}

interface YouTubeAPI {
  loadAll: () => Promise<YouTubeVideoEntry[]>
  refresh: () => Promise<{ added: number; liveUpdated: number }>
  fullSync: () => Promise<{ added?: number; error?: string }>
  clearAll: () => Promise<{ success: boolean }>
  onProgress?: (cb: (p: YouTubeSyncProgress) => void) => void
  toggleStar: (videoId: string) => Promise<{ isStarred: boolean }>
  savePosition: (videoId: string, seconds: number, meta: { title: string; channelName: string; thumbnailUrl: string }) => Promise<void>
  getPosition: (videoId: string) => Promise<number>
  getWatchHistory: () => Promise<YouTubeWatchHistoryEntry[]>
  removeFromHistory: (videoId: string) => Promise<void>
  clearWatchHistory: () => Promise<void>
  fetchDescription: (videoId: string) => Promise<string>
  searchVideos: (query: string, limit?: number) => Promise<Array<{
    videoId: string; title: string; channelName: string
    thumbnailUrl: string; type: string; published: string
  }>>
  fetchTranscripts: (batchSize?: number, workerCount?: number) => Promise<{ fetched: number; skipped: number; errors: number } | { error: string }>
  clearTranscripts: () => Promise<{ success: boolean } | { error: string }>
  getTranscriptStatus: () => Promise<string[]>
  getTranscript: (videoId: string) => Promise<Array<{ startMs: number; durMs: number; text: string }>>
  searchTranscripts: (query: string, videoLimit?: number, perVideoLimit?: number) => Promise<Array<{ videoId: string; snippet: string; startMs: number; matchCount: number; title: string; channelName: string; rank: number }>>
  buildSeed: () => Promise<{ success: boolean; videos?: number; transcripts?: number; segments?: number } | { error: string }>
}

interface VaultAPI {
  syncNote: (noteId: string) => Promise<{ success: boolean; reason?: string }>
  readVaultNote: (title: string) => Promise<string | null>
  watchVault: () => Promise<{ success: boolean; reason?: string }>
  reconcile: () => Promise<{ success: boolean; updated: number; skipped: number; reason?: string }>
  exportAll: () => Promise<{ success: boolean; notes?: number; highlights?: number; history?: number; pdfs?: number; reason?: string }>
  setAutoExport: (intervalMinutes: number) => Promise<{ success: boolean }>
  importAll: () => Promise<{ success: boolean; notes?: number; highlights?: number; noteVersions?: number; noteFolders?: number; pdfHighlights?: number; workspaces?: number; pdfs?: number; tabState?: string; reason?: string }>
  hasData: () => Promise<boolean>
  onVaultChange: (callback: (event: unknown) => void) => void
}

interface AppHistoryAPI {
  add: (entry: import('./index').HistoryEntry) => Promise<{ success: boolean }>
  getAll: (limit?: number) => Promise<import('./index').HistoryEntry[]>
  getPage: (beforeTs: number, limit?: number) => Promise<import('./index').HistoryEntry[]>
  delete: (id: string) => Promise<{ success: boolean }>
  clear: () => Promise<{ success: boolean }>
}

export interface SavedWorkspace {
  id: string
  name: string
  created_at: number
}

interface WorkspacesAPI {
  list: () => Promise<SavedWorkspace[]>
  save: (name: string, layoutJson: string, stateJson: string) => Promise<SavedWorkspace>
  load: (id: string) => Promise<(SavedWorkspace & { layout_json: string; state_json: string | null }) | null>
  delete: (id: string) => Promise<{ success: boolean }>
  rename: (id: string, name: string) => Promise<{ success: boolean }>
}

export type UpdateStatusType = 'idle' | 'checking' | 'current' | 'available' | 'downloading' | 'ready' | 'error' | 'mas'

export interface UpdateStatus {
  status: UpdateStatusType
  version?: string
  percent?: number
  message?: string
}

interface AppAPI {
  onCloseTab: (cb: () => void) => void
  onOpenSettings: (cb: () => void) => void
  onMenuAction: (cb: (action: string, payload?: unknown) => void) => void
  openFolderDialog: () => Promise<string | null>
  openExternal: (url: string) => Promise<void>
  isDev?: () => Promise<boolean>
  youTubeSignOut?: () => Promise<{ success: boolean }>
  newWindow: () => Promise<void>
  openFloatingTab: (type: string, state: unknown) => Promise<void>
  printNote: (html: string) => Promise<{ success: boolean }>
  exportNotePDF: (html: string, suggestedName: string, downloadLocation?: string) => Promise<{ success: boolean; canceled?: boolean }>
  broadcastTabState: (payload: unknown) => void
  onTabStateUpdate: (cb: (payload: unknown) => void) => void
  returnFloatTab: (payload: { type: string; state: Record<string, unknown> }) => void
  // Auto-updater (GitHub Releases — disabled for MAS builds)
  getVersion: () => Promise<string>
  isMasBuild: () => Promise<boolean>
  checkForUpdates: () => Promise<void>
  downloadUpdate: () => Promise<void>
  installUpdate: () => void
  onNativeThemeChanged: (cb: (isDark: boolean) => void) => void
  onUpdateStatus: (cb: (status: UpdateStatus) => void) => void
  openViewerWindow: () => Promise<boolean>
  isViewerWindowOpen: () => Promise<boolean>
  pushViewerContent: (payload: unknown) => void
  pushViewerSettings: (settings: unknown) => void
  onViewerVisibleRegion: (cb: (region: ViewerVisibleRegion) => void) => void
  onViewerWindowClosed: (cb: () => void) => void
  onViewerReady: (cb: () => void) => void
}

export interface ViewerVisibleRegion {
  bookId: string
  chapter: number
  /** Fraction of the chapter content currently visible in the presenter (clientHeight/scrollHeight). */
  visibleFraction: number
  /** Map of verse number → that verse's top, as a fraction of the presenter's scrollable
   *  content height. Lets the main window translate the presenter's visible window onto its
   *  OWN verse positions — accurate across different window sizes / zoom / text wrapping.
   *  Sent only on the presenter's load/zoom/resize (not per scroll frame). */
  verseFracs: Record<number, number>
}

export interface ViewerSyncedSettings {
  wordReplacerEnabled: boolean
  wordReplacerRules: unknown[]
  noteScriptureBlock: boolean
  noteScriptureBlockThreshold: number
  idiomHighlightEnabled: boolean
  idiomCache: unknown[]
  theme: 'light' | 'dark' | 'system'
  themePreset: string | null
  crossRefSource: 'tske' | 'classic' | 'notes'
}

interface CrossRefEntry {
  bookId: string
  chapter: number
  verse: number
  endVerse: number | null
  votes: number
  text: string
}

interface CrossRefsResult {
  refs: CrossRefEntry[]
  loading: boolean
  error: boolean
}

export interface TSKeRef {
  bookId: string
  chapter: number
  verse: number
  endVerse: number | null
  text: string
  context: string | null
}

export interface TSKeGroup {
  heading: string | null
  isReciprocal: boolean
  refs: TSKeRef[]
}

interface TSKeResult {
  groups: TSKeGroup[]
  loading: boolean
  error: boolean
}

export interface ChapterCrossRefEntry {
  verseNum: number
  refs: CrossRefEntry[]
}

export interface ChapterTSKeEntry {
  verseNum: number
  groups: TSKeGroup[]
}

interface CrossRefsAPI {
  getForVerse: (bookId: string, chapter: number, verse: number) => Promise<CrossRefsResult>
  getTSKeForVerse: (bookId: string, chapter: number, verse: number) => Promise<TSKeResult>
  getForChapter: (bookId: string, chapter: number) => Promise<{ verseRefs: ChapterCrossRefEntry[]; error: boolean }>
  getTSKeForChapter: (bookId: string, chapter: number) => Promise<{ verseRefs: ChapterTSKeEntry[]; error: boolean }>
  status: () => Promise<{ hasData: boolean; loading: boolean; error: boolean }>
}

export type ESwordPhase = 'idle' | 'reading' | 'review' | 'saving' | 'done' | 'error'

export interface ESwordReviewNote {
  id: string
  type: 'verse' | 'topic' | 'daily'
  title: string
  passage?: string
  body: string
  createdAt: number
  status: 'new' | 'updated' | 'duplicate'
  existingId?: string
}

export interface ESwordProgress {
  phase: ESwordPhase
  done: number
  total: number
  message: string
  reviewNotes?: ESwordReviewNote[]
}

interface ESwordImportAPI {
  detectFolder: () => Promise<string | null>
  start: (opts: { folder: string; study: boolean; topics: boolean; journal: boolean }) => Promise<{ success: boolean; error?: string }>
  importSelected: (notes: ESwordReviewNote[]) => Promise<{ success: boolean; imported?: number; updated?: number; error?: string }>
  cancel: () => Promise<void>
  onProgress: (cb: (p: ESwordProgress) => void) => void
}

export type BgImportPhase = 'login' | 'fetching' | 'review' | 'saving' | 'done' | 'error'

export interface BgImportReviewNote {
  id: string
  passage: string
  body: string
  color: string
  createdAt: number
  updatedAt: number
  status: 'new' | 'updated' | 'duplicate'
  existingId?: string
}

export interface BgImportProgress {
  phase: BgImportPhase
  done: number
  total: number
  message: string
  reviewNotes?: BgImportReviewNote[]
}

interface BgImportAPI {
  start: (credentials: { username: string; password: string }) => Promise<{ success: boolean; error?: string }>
  importSelected: (notes: BgImportReviewNote[]) => Promise<{ success: boolean; imported?: number; updated?: number; error?: string }>
  cancel: () => Promise<void>
  clearSession: () => Promise<{ success: boolean }>
  debugOpen: () => Promise<{ success: boolean }>
  onProgress: (cb: (p: BgImportProgress) => void) => void
}

declare global {
  interface Window {
    bible: BibleAPI
    notes: NotesAPI
    highlights: HighlightsAPI
    lexicon: LexiconAPI
    settings: SettingsAPI
    pdf: PdfAPI
    vault: VaultAPI
    youtube: YouTubeAPI
    crossrefs: CrossRefsAPI
    app: AppAPI
    bgImport: BgImportAPI
    eSwordImport: ESwordImportAPI
    appHistory: AppHistoryAPI
    workspaces: WorkspacesAPI
    viewer: {
      onContent: (cb: (payload: unknown) => void) => void
      onSettings: (cb: (settings: ViewerSyncedSettings) => void) => void
      reportVisibleRegion: (region: ViewerVisibleRegion) => void
      signalReady: () => void
    }
    // Platform string injected by preload for renderer-side platform detection
    __berean_platform: NodeJS.Platform

    // Custom frameless window controls (Windows only)
    windowControls: {
      minimize: () => void
      maximize: () => void
      close: () => void
      isMaximized: () => Promise<boolean>
      onMaximizeChange: (cb: (isMax: boolean) => void) => void
    }
  }

  // Electron <webview> tag
  namespace JSX {
    interface IntrinsicElements {
      webview: React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
        src?: string
        partition?: string
        allowpopups?: boolean | string
        nodeintegration?: boolean | string
        webpreferences?: string
        style?: React.CSSProperties
        ref?: React.Ref<HTMLElement>
      }
    }
  }
}

export {}
