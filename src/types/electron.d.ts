import type { Book, Verse, Note, NoteVersion, NoteFolder, LexiconEntry, SearchResult, PdfDoc, PdfHighlight } from './index'

interface BibleAPI {
  queryChapter: (bookId: string, chapter: number, textId?: string) => Promise<Verse[]>
  queryVerse: (bookId: string, chapter: number, verse: number, textId?: string) => Promise<Verse | null>
  searchText: (query: string, textId?: string, wordMode?: 'all' | 'any' | 'phrase', bookIds?: string[]) => Promise<SearchResult[]>
  getBooks: (textId?: string) => Promise<Book[]>
}

interface NotesAPI {
  createNote: (data: Partial<Note>) => Promise<{ success: boolean; note?: Note; error?: string }>
  // status/icon are widened to accept `null` here (on top of Partial<Note>'s `T | undefined`)
  // — the IPC handler distinguishes "don't touch this field" (undefined, the normal Partial<T>
  // meaning) from "clear it back to none/no icon" (null) by checking `data.X !== undefined`,
  // so callers need a way to explicitly send null rather than just omitting the field.
  updateNote: (id: string, data: Partial<Omit<Note, 'status' | 'icon'>> & { status?: Note['status'] | null; icon?: string | null }) => Promise<{ success: boolean; error?: string }>
  deleteNote: (id: string) => Promise<{ success: boolean; error?: string }>
  // Trash
  restoreNote: (id: string) => Promise<{ success: boolean; error?: string }>
  listTrash: () => Promise<Note[]>
  purgeTrashItem: (id: string) => Promise<{ success: boolean; error?: string }>
  emptyTrash: () => Promise<{ success: boolean; purged: string[] }>
  deleteAllNotes: () => Promise<{ success: boolean }>
  deleteByTag: (tag: string) => Promise<{ success: boolean; deleted: number }>
  getNotes: (limit?: number, offset?: number) => Promise<Note[]>
  getVerseNotes: (verseRef: string, textId?: string) => Promise<Note[]>
  getNote: (id: string) => Promise<Note | null>
  getChapterNotes: (bookId: string, chapter: number, textId?: string) => Promise<Note[]>
  getChapterCounts: (bookId: string, chapter: number, textId?: string) => Promise<Record<number, number>>
  searchNotes: (query: string, limit?: number, mode?: 'all' | 'any' | 'phrase') => Promise<Note[]>
  setNoteFolder: (noteId: string, folderId: string | null) => Promise<{ success: boolean }>
  setNotePinned: (noteId: string, pinned: boolean) => Promise<{ success: boolean }>
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
  // Heading collapse persistence (round 12 item 6) — see headingCollapse.ts's
  // computeHeadingKey for how headingKey is derived.
  getCollapsedHeadings: (noteId: string) => Promise<string[]>
  setHeadingCollapsed: (noteId: string, headingKey: string, collapsed: boolean) => Promise<{ success: boolean }>
  // Thread collapse persistence — see threadCollapse.ts's createThreadCollapsePlugin comment
  // for why this is keyed directly by a thread's own `threadId` attr, unlike headings above.
  getCollapsedThreads: (noteId: string) => Promise<string[]>
  setThreadCollapsed: (noteId: string, threadId: string, collapsed: boolean) => Promise<{ success: boolean }>
  onChanged: (cb: () => void) => void
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
  getOccurrences: (strongsNum: string, quickLimit?: number) => Promise<{ book_id: string; chapter: number; verse_num: number; text: string; text_id?: string; matchWordIndices: number[] }[]>
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
  unwatchVault: () => Promise<{ success: boolean }>
  reconcile: () => Promise<{ success: boolean; updated: number; skipped: number; reason?: string }>
  exportAll: () => Promise<{ success: boolean; notes?: number; highlights?: number; history?: number; pdfs?: number; reason?: string }>
  setAutoExport: (intervalMinutes: number) => Promise<{ success: boolean }>
  importAll: () => Promise<{ success: boolean; notes?: number; highlights?: number; noteVersions?: number; noteFolders?: number; pdfHighlights?: number; workspaces?: number; pdfs?: number; tabState?: string; reason?: string }>
  hasData: () => Promise<boolean>
  onVaultChange: (callback: (event: unknown) => void) => void
}

interface AppHistoryAPI {
  add: (entry: import('./index').HistoryEntry, maxEntries?: number) => Promise<{ success: boolean }>
  getAll: (limit?: number) => Promise<import('./index').HistoryEntry[]>
  getPage: (beforeTs: number, limit?: number) => Promise<import('./index').HistoryEntry[]>
  delete: (id: string) => Promise<{ success: boolean }>
  clear: () => Promise<{ success: boolean }>
}

interface StudyTrailAPI {
  startSession: (name: string) => Promise<import('./studyTrail').TrailSession>
  pauseSession: (trailSessionId: string) => Promise<{ success: boolean }>
  resumeSession: (trailSessionId: string) => Promise<{ success: boolean }>
  renameSession: (trailSessionId: string, name: string) => Promise<{ success: boolean }>
  listSessions: () => Promise<import('./studyTrail').TrailSession[]>
  getSession: (trailSessionId: string) => Promise<import('./studyTrail').TrailSessionDetail | null>
  addNode: (node: { trailSessionId: string; bookId: string; chapter: number; orderIndex: number; originLabel?: string }) => Promise<import('./studyTrail').TrailNode>
  updateNodeSubnote: (nodeId: string, subnote: string) => Promise<{ success: boolean }>
  addConnection: (conn: {
    trailSessionId: string; fromNodeId: string; toKind: import('./studyTrail').ConnectionKind
    toBookId?: string; toChapter?: number; toVerse?: number
    toStrongsNum?: string; toNoteId?: string; toVideoId?: string
    clarityTier: import('./studyTrail').ClarityTier; reasonText?: string; reasonTags?: string[]
    weight?: import('./studyTrail').ConnectionWeight; strongsDepth?: import('./studyTrail').StrongsDepth
  }) => Promise<import('./studyTrail').TrailConnection>
  markGlance: (connectionId: string) => Promise<{ success: boolean }>
  updateConnectionReason: (connectionId: string, update: { reasonText?: string; reasonTags?: string[]; versePinFrom?: number; versePinTo?: number }) => Promise<{ success: boolean }>
  dismissPrompt: (connectionId: string) => Promise<{ success: boolean }>
  updateRecap: (trailSessionId: string, recapText: string) => Promise<{ success: boolean }>
  getBacklinks: (bookId: string, chapter: number, excludeSessionId: string) => Promise<import('./studyTrail').TrailConnectionWithSession[]>
  search: (query: string) => Promise<import('./studyTrail').TrailConnectionWithSession[]>
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

export interface PlaylistItem {
  id: string
  position: number
  bookId: string
  chapter: number
  startVerse: number
  endVerse: number | null
  textId: string
}

export interface SavedPlaylist {
  id: string
  name: string
  createdAt: number
  updatedAt: number
  items: PlaylistItem[]
}

export interface PlaylistItemInput {
  bookId: string
  chapter: number
  startVerse?: number
  endVerse?: number | null
  textId: string
}

interface PlaylistsAPI {
  list: () => Promise<SavedPlaylist[]>
  save: (name: string, items: PlaylistItemInput[], existingId?: string) => Promise<SavedPlaylist>
  rename: (id: string, name: string) => Promise<{ success: boolean }>
  delete: (id: string) => Promise<{ success: boolean }>
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
  // Optional — a preload.ts change needs a full Electron restart (not just a Vite
  // HMR renderer reload) to take effect, so callers should tolerate this being
  // briefly absent rather than crash on it (see the call site in BiblePanel.tsx).
  onTrackpadSwipeBegin?: (cb: () => void) => void
  onTrackpadSwipeEnd?: (cb: () => void) => void
  onMenuAction: (cb: (action: string, payload?: unknown) => void) => void
  openFolderDialog: () => Promise<string | null>
  openExternal: (url: string) => Promise<void>
  isDev?: () => Promise<boolean>
  youTubeSignOut?: () => Promise<{ success: boolean }>
  newWindow: () => Promise<void>
  moveWindowBy: (dx: number, dy: number) => void
  openFloatingTab: (type: string, state: unknown) => Promise<void>
  printNote: (html: string, pageSize?: string) => Promise<{ success: boolean }>
  exportNotePDF: (html: string, suggestedName: string, downloadLocation?: string, pageSize?: string) => Promise<{ success: boolean; canceled?: boolean }>
  renderPreviewPDF: (html: string, pageSize?: string) => Promise<ArrayBuffer>
  broadcastTabState: (payload: unknown) => void
  onTabStateUpdate: (cb: (payload: unknown) => void) => void
  broadcastAudioState: (payload: unknown) => void
  onAudioStateUpdate: (cb: (payload: unknown) => void) => void
  returnFloatTab: (payload: { type: string; state: Record<string, unknown> }) => void
  // Auto-updater (GitHub Releases — disabled for MAS builds)
  getVersion: () => Promise<string>
  isMasBuild: () => Promise<boolean>
  checkForUpdates: () => Promise<void>
  downloadUpdate: () => Promise<void>
  installUpdate: () => void
  onNativeThemeChanged: (cb: (isDark: boolean) => void) => void
  getAccentColor: () => Promise<string | null>
  onAccentColorChanged: (cb: (rgb: string | null) => void) => void
  getResourceMode: () => Promise<'normal' | 'throttled'>
  onResourceModeChanged: (cb: (mode: 'normal' | 'throttled') => void) => void
  onUpdateStatus: (cb: (status: UpdateStatus) => void) => void
  openViewerWindow: () => Promise<boolean>
  closeViewerWindow: () => Promise<boolean>
  isViewerWindowOpen: () => Promise<boolean>
  pushViewerContent: (payload: unknown) => void
  pushViewerSettings: (settings: unknown) => void
  pushViewerOverlay: (payload: ViewerOverlay) => void
  onViewerVisibleRegion: (cb: (region: ViewerVisibleRegion) => void) => void
  onViewerWindowClosed: (cb: () => void) => void
  onViewerReady: (cb: () => void) => void
  /** Ask the presenter to re-report its visible region even if its content hasn't changed —
   *  used after unpausing / "Re-sync now" so a stale region (from tab switches that happened
   *  while paused) can't silently block the outline band forever. */
  requestViewerVisibleRegion: () => void
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
  /** Presenter's own scroll-container clientHeight (px) at report time — lets the main
   *  window's virtual-scroll wheel handler (used when the main panel itself has nothing to
   *  scroll) convert wheel px into a fraction using the presenter's REAL scrollable range
   *  (clientHeight * (1-f)/f), instead of a flat sensitivity constant unrelated to how
   *  zoomed in the presenter actually is. */
  clientHeight?: number
  /** Present only for compare-view columns — which column reported this region. */
  colIndex?: number
}

/** Ephemeral overlays mirrored to the presenter: the user's text selection and a laser
 *  pointer tracking the cursor. Offsets are display-char offsets within a verse (which match
 *  between the two windows when Strong's numbers are hidden — the presentation default).
 *  A field set to `undefined` means "unchanged"; `null` means "clear". */
export interface ViewerOverlay {
  bookId: string
  chapter: number
  selection?: { verseNum: number; startChar: number; endChar: number }[] | null
  // Laser anchor: a precise char offset when the cursor is over text (accurate across the two
  // windows' wrapping), or a verse-relative xFrac/yFrac fallback when over a margin/gap.
  laser?: { verseNum: number; charOffset?: number; dxFrac?: number; dyFrac?: number; xFrac?: number; yFrac?: number } | null
  // Tell the presenter to scroll a verse into center view (used by the find bar). `nonce`
  // forces a re-scroll even when the same verse is targeted repeatedly.
  scrollTo?: { verseNum: number; nonce: number } | null
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
  viewerSidePanelEnabled: boolean
  noteChangeToken: number
  highlightChangeToken: number
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

interface HermasTaylorRef {
  bookId: string
  chapter: number
  verse: number
  raw: string
  text: string
}

interface CrossRefsAPI {
  getForVerse: (bookId: string, chapter: number, verse: number, textId?: string) => Promise<CrossRefsResult>
  getTSKeForVerse: (bookId: string, chapter: number, verse: number, textId?: string) => Promise<TSKeResult>
  getForChapter: (bookId: string, chapter: number, textId?: string) => Promise<{ verseRefs: ChapterCrossRefEntry[]; error: boolean }>
  getTSKeForChapter: (bookId: string, chapter: number, textId?: string) => Promise<{ verseRefs: ChapterTSKeEntry[]; error: boolean }>
  getHermasTaylorChapter: (bookId: string, chapter: number) => Promise<{ refs: HermasTaylorRef[]; error: boolean }>
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

export type AiLookupResultSource = 'keyword' | 'ai-guess' | 'cross-ref' | 'strongs' | 'quote-source' | 'tske' | 'cross-ref-seed'

export interface AiLookupResult {
  textId: string
  bookId: string
  bookName: string
  chapter: number
  verse: number
  endVerse?: number
  text: string
  source: AiLookupResultSource
  commentary?: string
  /** True if a verse note already exists at this exact reference. */
  noted?: boolean
  /** Only set on `source: 'cross-ref'` results — which primary result they were expanded
   *  from, so the UI can nest them under it instead of listing them as flat entries. */
  crossRefOf?: { bookId: string; chapter: number; verse: number }
}

export interface AiLookupNoteResult {
  id: string
  title: string
  snippet: string
  isIdiom: boolean
  idiomTerm?: string
}

/** Round 11: a video found via "find me a video about X" — searched from the local,
 *  already-synced, allowlisted-channel library only (see CLAUDE.md §12). */
export interface AiLookupVideoResult {
  videoId: string
  title: string
  channelName: string
  thumbnailUrl: string
  /** Set only for a transcript-content match — the caption segment's playback position in
   *  milliseconds, so the panel can deep-link straight to the moment the topic is discussed. */
  startMs?: number
  /** Set alongside `startMs` — the real transcript text surrounding the match. */
  snippet?: string
}

export interface AiLookupStrongsCard {
  strongsNum: string
  lemma: string
  transliteration: string
  /** short_def — the classic "how this word is rendered in the KJV" gloss list. */
  gloss: string
  definition: string
  derivation: string
  occurrenceCount: number
}

export interface AiLookupResponse {
  results: AiLookupResult[]
  /** How many of `results` (counting only primary, non-cross-ref ones) to show before a
   *  "Show more" button reveals the rest. */
  visibleCount: number
  /** Extracted search keywords, for highlighting matched terms in verse text. */
  keywords: string[]
  /** A canonical guess that surfaced alongside a focus-text question — shown separately,
   *  after the focus text's own results, with `relatedNote` explaining why. */
  related: AiLookupResult[]
  relatedNote?: string
  /** A real, DB-verified Strong's word card — set whenever the question contained (or the AI
   *  proposed and it was verified to be) a real Strong's number. */
  strongsCard?: AiLookupStrongsCard
  summary?: string
  error?: string
  /** Real, DB-verified note matches — either the whole answer (an explicit note-ask) or a small
   *  augmentation alongside verse results. */
  notes?: AiLookupNoteResult[]
  /** True when `notes` fully answers the question on its own — the UI skips the verse-results
   *  section entirely in that case. */
  notesAreThePrimaryAnswer?: boolean
  /** Set when the question was an explicit video request — see AiLookupVideoResult. */
  videos?: AiLookupVideoResult[]
}

export interface AiLookupChatSummary {
  id: string
  title: string
  created_at: string
  updated_at: string
}

export interface AiLookupChatMessage {
  role: 'user' | 'assistant'
  content: string
  results?: AiLookupResult[]
  visibleCount?: number
  keywords?: string[]
  related?: AiLookupResult[]
  relatedNote?: string
  summary?: string
  strongsCard?: AiLookupStrongsCard
  notes?: AiLookupNoteResult[]
  notesAreThePrimaryAnswer?: boolean
  videos?: AiLookupVideoResult[]
  createdAt: string
  /** True only while this message is still being filled in by the live pipeline — set on the
   *  placeholder AiLookupPanel appends when a question is sent, and kept on any partial that
   *  lands before the final response replaces it. Purely transient UI state: it is stripped
   *  before a chat is persisted (see AiLookupPanel's `persist`), so a reloaded chat can never
   *  contain a message stuck pending. */
  pending?: boolean
}

export interface AiLookupChat {
  id: string
  title: string
  messages: AiLookupChatMessage[]
  createdAt: string
  updatedAt: string
}

/** A lightweight pointer to the renderer's currently active tab — the main process fetches the
 *  REAL content server-side from just this reference (never trusts renderer-supplied text), same
 *  DB-verified-only principle as every other candidate this pipeline ever shows. */
export interface AiLookupTabContextRef {
  type: 'bible' | 'note' | 'lexicon' | 'youtube'
  bookId?: string
  chapter?: number
  translation?: string
  noteId?: string
  strongsNum?: string
  videoId?: string
}

interface AiLookupAPI {
  checkAvailable: () => Promise<{ available: boolean; models: string[] }>
  /** Proactively unloads the local Ollama model right away — call when the chat panel closes.
   *  Redundant with the main process's own idle-unload timer (which fires a couple minutes
   *  after the last question regardless of panel state); this just makes closing feel instant. */
  unloadModel: () => Promise<{ success: boolean }>
  query: (question: string, opts: {
    commentary: boolean
    /** "Deep search" — an extra verification pass that checks whether the initial results
     *  actually answer the question and, if not, retries once with different search terms.
     *  Slower (one to two extra Ollama calls); off by default. */
    agentic?: boolean
    model?: string; textId?: string
    /** Enabled, non-Strong's word-replacer rules — so keyword search also tries the DB's
     *  original wording (e.g. "Jesus") when the model used the app's preferred wording
     *  (e.g. "Yeshua"), or vice versa. Pass only `{ queries, replacement }` pairs. */
    wordReplacerRules?: Array<{ queries: string[]; replacement: string }>
    /** Recent chat turns (role + content only), so a natural follow-up like "what about the
     *  next chapter" has something to resolve against. Capped to the last few turns by the
     *  caller — the main process caps further before it ever reaches the model. */
    history?: Array<{ role: 'user' | 'assistant'; content: string }>
    /** Sent when the "use current tab as context" toggle is on, or an inline mention like "this
     *  chapter" was detected — see AiLookupTabContextRef. */
    tabContext?: AiLookupTabContextRef
  }) => Promise<AiLookupResponse>
  listChats: () => Promise<AiLookupChatSummary[]>
  getChat: (id: string) => Promise<AiLookupChat | null>
  saveChat: (chat: { id?: string; title: string; messages: AiLookupChatMessage[] }) => Promise<{ id: string }>
  deleteChat: (id: string) => Promise<{ success: boolean }>
  /** Live status text during a single query() call (e.g. "Searching Jubilees…") — call once,
   *  not per-query; same removeAllListeners-then-on pattern as the other progress bridges. */
  onProgress: (cb: (status: string) => void) => void
  /** Speed round: fires ONCE per query(), as soon as retrieval finishes — before the optional
   *  Commentary pass (a second, ~4s Ollama call) even starts. Carries the SAME shape query()'s
   *  eventual resolved value does, just without `summary`/per-verse `commentary` filled in yet
   *  (identical to the final response when Commentary is off, since there's nothing left to
   *  wait for in that case — the caller can safely treat every partial as "good enough to show
   *  now, may still be refined"). The panel must never sit on a blank spinner while real,
   *  already-verified results are sitting in memory waiting on a slower model call — see
   *  electron/ipc/aiLookup.ts's `emitPartial` call site for where this fires. Call once, same
   *  removeAllListeners-then-on pattern as onProgress above. */
  onPartial: (cb: (partial: AiLookupResponse) => void) => void
}

/** Read Aloud (TTS) — Kokoro model download bridge (electron/ipc/ttsModel.ts). Mirrors the
 *  eSwordImport bridge's start/cancel/onProgress shape (see below), the closest existing
 *  precedent for a long-running, cancellable, progress-reporting main-process job. */
interface TTSModelAPI {
  // `needsRuntimeFile`: true when a pack downloaded before the ORT WASM runtime file was added to
  // the manifest is otherwise complete — see ttsModelManifest.ts's `computeStatus`. Callers should
  // fetch just that file via `downloadRuntimeFile()` rather than re-running `download()`.
  getStatus: () => Promise<{ ready: boolean; fileCount: number; needsRuntimeFile: boolean }>
  download: () => Promise<{ success: true } | { success: false; error: string }>
  /** Upgrade path for an existing pack missing only the ORT runtime file (see `needsRuntimeFile`
   *  above) — fetches ~21.6MB instead of re-downloading the whole ~125MB pack. */
  downloadRuntimeFile: () => Promise<{ success: true } | { success: false; error: string }>
  cancelDownload: () => Promise<boolean>
  clearModelCache: () => Promise<{ success: boolean; error?: string }>
  getModelId: () => Promise<string>
  onDownloadProgress: (cb: (p: { receivedBytes: number; totalBytes: number }) => void) => void
  onDownloadVerifying: (cb: () => void) => void
}

/** Read Aloud (TTS) — synthesized-audio cache bridge (electron/ipc/ttsAudioCache.ts). `get`
 *  returns null on a cache miss; `put`'s `data` is a raw WAV ArrayBuffer. */
interface TTSAudioCacheAPI {
  get: (key: string) => Promise<ArrayBuffer | null>
  put: (key: string, data: ArrayBuffer) => Promise<boolean>
  clear: () => Promise<boolean>
  stats: () => Promise<{ entryCount: number; totalBytes: number; capBytes: number }>
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
    aiLookup: AiLookupAPI
    app: AppAPI
    bgImport: BgImportAPI
    eSwordImport: ESwordImportAPI
    appHistory: AppHistoryAPI
    studyTrail: StudyTrailAPI
    workspaces: WorkspacesAPI
    playlists: PlaylistsAPI
    ttsModel: TTSModelAPI
    ttsAudioCache: TTSAudioCacheAPI
    viewer: {
      onContent: (cb: (payload: unknown) => void) => void
      onSettings: (cb: (settings: ViewerSyncedSettings) => void) => void
      onOverlay: (cb: (payload: ViewerOverlay) => void) => void
      reportVisibleRegion: (region: ViewerVisibleRegion) => void
      onRequestVisibleRegion: (cb: () => void) => void
      signalReady: () => void
    }
    // Platform string injected by preload for renderer-side platform detection
    __berean_platform: NodeJS.Platform

    // Custom frameless window controls (Windows), also reused by the note
    // editor's Focus-mode floating toolbar on any platform.
    windowControls: {
      minimize: () => void
      maximize: () => void
      close: () => void
      isMaximized: () => Promise<boolean>
      onMaximizeChange: (cb: (isMax: boolean) => void) => void
      setButtonsVisible: (visible: boolean) => void
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
