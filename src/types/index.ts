export type SpaceId = 'scripture' | 'notes' | 'lexicon' | 'youtube' | 'search'

export type ScriptureLayout =
  | 'standard'         // Scripture left | Panel right (tabs)
  | 'panel-bottom'     // Scripture top (full) | Panel bottom (full)
  | 'notes-bottom'     // Scripture top | Notes-only bottom
  | 'lexicon-crossref' // 2×2: Scripture/Notes left | Lexicon/CrossRefs right
  | 'reading'          // Full-width scripture, no panel
  | 'panel-left'       // Panel left | Scripture right
  | 'notes-wide'       // Scripture slim (40%) | Wide panel (60%)
  | 'scripture-wide'   // Wide scripture (65%) | Slim panel (35%)
  | 'compare-notes'    // Compare view top | Notes panel bottom
  | 'study-grid'       // Scripture left | Lexicon above / CrossRefs below (right column)
  | 'scripture-focus'  // Centered max-width scripture, no panel
  | 'notes-right'      // Scripture | Notes-only panel right (no tab strip)
  | 'notes-top'        // Notes above | Scripture below
  | 'triple-col'       // Notes | Scripture | Lexicon — three equal columns
  | 'commentary'       // Wide notes left | Scripture right — 50/50 with no tab strip on notes
  | 'split-bottom'     // Scripture top | Notes left + Lexicon right in bottom row

export type TabType = 'bible' | 'note' | 'lexicon' | 'youtube' | 'search' | 'pdf'

export interface BibleTabState {
  bookId: string
  chapter: number
  endChapter?: number
  verse?: number
  targetVerse?: number
  endVerse?: number
  translation: string
  showStrongs: boolean
  scrollPosition: number
  compareMode?: boolean
  // Compare columns (text/book/chapter), persisted so chapter navigation survives
  // leaving and returning to the tab (which unmounts the panel).
  compareColumns?: Array<{ textId: string; bookId: string; chapter: number }>
  hiddenAnnotations?: string[]
  rightPanelOpen?: boolean
  rightPanelWidth?: number
  bottomPanelHeight?: number
  rightPanelTab?: 'notes' | 'lexicon' | 'crossrefs'
  rightPanelNoteId?: string | null
  rightPanelNoteCursor?: number | null   // cursor offset in the side-panel note editor
  rightPanelNoteFocused?: boolean        // was the side-panel note editor focused when the tab was left?
  rightPanelLexiconEntry?: string | null
  rightPanelVerseFilter?: string | null
  noteBack?: { noteId: string; title: string } | null
  scriptureBack?: { bookId: string; chapter: number; verse?: number; label: string; translation?: string } | null
  searchBack?: { query: string } | null
  searchMode?: boolean
  scriptureSearchQuery?: string
  scriptureLayout?: ScriptureLayout
  // Scripture search view persisted state
  searchTextId?: string
  searchWordMode?: 'all' | 'any' | 'phrase'
  searchTestamentFilter?: string
  searchBookFilter?: string
  searchSortMode?: 'relevance' | 'bookOrder'
  searchScrollTop?: number
}

export interface NoteTabState {
  noteId: string | null
  isNew: boolean
  verseRef?: string
  scrollTop?: number
  cursorPos?: number
}

export interface LexiconTabState {
  strongsNum: string | null
  scrollTop?: number
}

/**
 * Layout of the YouTube tab when a secondary (or tertiary) panel is open.
 *
 *  video-full            — video only, no panel
 *  side-right            — video left 55% | panelA right 45%
 *  side-left             — panelA left 45% | video right 55%
 *  stack-below           — video top 60% / panelA bottom 40%
 *  stack-above           — panelA top 40% / video bottom 60%
 *  wide-panel            — video left 35% | panelA right 65%
 *  wide-video            — video left 65% | panelA right 35%
 *  three-col             — panelA 30% | video 40% | panelB 30%
 *  three-col-wide-video  — panelA 25% | video 50% | panelB 25%
 *  stacked-right         — video left 55% | panelA + panelB stacked right 45%
 *  stacked-left          — panelA + panelB stacked left 45% | video right 55%
 */
export type YouTubeLayout =
  | 'video-full'
  | 'side-right'
  | 'side-left'
  | 'stack-below'
  | 'stack-above'
  | 'wide-panel'
  | 'wide-video'
  | 'three-col'
  | 'three-col-wide-video'
  | 'stacked-right'
  | 'stacked-left'

export interface YouTubePanelState {
  type: 'notes' | 'scripture' | 'lexicon'
  noteId?: string | null
  bookId?: string | null
  chapter?: number | null
  translation?: string | null
  strongsNum?: string | null
}

export interface YouTubeTabState {
  videoId: string | null
  playlistId: string | null
  url?: string
  youtubeLayout?: YouTubeLayout
  panelA?: YouTubePanelState | null
  panelB?: YouTubePanelState | null
}

export interface SearchTabState {
  query: string
  results: SearchResult[]
  scrollTop?: number
}

export interface PdfTabState {
  pdfId: string
  title: string
  page?: number          // 1-indexed page to scroll to
  scrollTop?: number
}

export interface PdfDoc {
  id: string
  title: string
  filename: string
  pageCount: number
  fileSize: number
  importedAt: number
}

export interface PdfHighlight {
  id: string
  pdfId: string
  page: number           // 1-indexed
  // Normalised rects (0..1 relative to page width/height) so they survive zoom
  rects: Array<{ x: number; y: number; w: number; h: number }>
  color: string
  text: string           // selected text
  note?: string | null
  createdAt: number
}

export type TabState =
  | BibleTabState
  | NoteTabState
  | LexiconTabState
  | YouTubeTabState
  | SearchTabState
  | PdfTabState

export interface Tab {
  id: string
  spaceId: SpaceId
  type: TabType
  title: string
  state: TabState
  isPinned?: boolean
}

export interface Verse {
  verse_num: number
  text: string
  book_id: string
  chapter: number
  text_tagged?: string   // space-separated tokens: "word{H7225}" or "*word{}" (italic) or "word{}" (no strongs)
  hasNote?: boolean
  hasHighlight?: boolean
}

export interface StrongsWord {
  word: string
  strongsNum: string
  gloss: string
  position: number
}

export interface Note {
  id: string
  type?: string
  title: string
  content: string
  verseRef?: string | null
  createdAt: number
  updatedAt: number
  importedAt?: number
  tags: string[]
  color?: string
  folderId?: string | null
  textId?: string   // translation a verse note is attached to ('kjva' | 'lxx' | …)
  idiomTerm?: string
  idiomMeaning?: string
  idiomAliases?: string[]
  idiomAutoVariants?: boolean
}

/** A snapshot in a note's version history. */
export interface NoteVersion {
  id: string
  noteId: string
  title: string
  content: string
  kind: string       // 'auto' | 'manual' | 'pre-restore'
  createdAt: number
}

export interface NoteFolder {
  id: string
  name: string
  parentId: string | null
  createdAt: number
}

export interface Book {
  id: string
  name: string
  short_name: string
  testament: 'OT' | 'NT' | 'Apocrypha' | 'Pseudepigrapha'
  chapters_count: number
}

export interface LexiconEntry {
  strongsNum: string
  lemma: string
  transliteration: string
  pronunciation: string
  gloss: string
  definition: string
  derivation: string
  extendedDef: string
  occurrences: number
}

export interface SearchResult {
  verseRef: string
  bookId: string
  chapter: number
  verseNum: number
  text: string
  matchStart: number
  matchEnd: number
}

export type HighlightColor =
  | 'yellow' | 'red' | 'green' | 'blue' | 'purple'
  | 'orange' | 'pink' | 'teal' | 'cyan' | 'indigo'
  | 'lime' | 'amber' | 'rose' | 'violet' | 'sky'

export interface Highlight {
  id: string
  bookId: string
  chapter: number
  verseNum: number
  color: HighlightColor
  startWord?: number
  endWord?: number
  createdAt: number
}

export type MosaicKey = 'bible-panel' | 'notes-panel' | 'lexicon-panel' | 'youtube-panel' | 'search-panel'

/** A single entry in a per-tab navigation stack (back/forward within one tab). */
export interface TabNavEntry {
  id: string
  type: TabType
  title: string
  bookId?: string
  chapter?: number
  translation?: string
  noteId?: string
  strongsNum?: string
  videoId?: string
  pdfId?: string
  page?: number
}

/** A single entry in the global back/forward navigation stack (all tab types). */
export interface GlobalNavEntry {
  id: string
  spaceId: SpaceId
  tabId: string
  type: TabType
  title: string
  // bible
  bookId?: string
  chapter?: number
  translation?: string
  // note
  noteId?: string
  // lexicon
  strongsNum?: string
  // pdf
  pdfId?: string
  page?: number
  // youtube
  videoId?: string
}

export interface HistoryEntry {
  id: string
  timestamp: number
  type: 'bible' | 'note' | 'lexicon' | 'youtube' | 'search' | 'strongs-click' | 'compare' | 'import'
  title: string
  // Session context
  sessionId?: string
  sessionName?: string
  // Chain tracking: ID of the parent history entry that led to this one
  parentId?: string
  // Type-specific navigation payload
  bookId?: string       // bible
  chapter?: number      // bible
  translation?: string  // bible
  noteId?: string       // note
  strongsNum?: string   // lexicon / strongs-click
  videoId?: string      // youtube
  query?: string        // search
  // compare: what was open in each column
  compareColumns?: Array<{ textId: string; bookId: string; chapter: number; title: string }>
  // import: summary
  importSource?: string   // 'biblegateway' | 'esword'
  importCount?: number
}

export interface AppSettings {
  theme: 'dark' | 'light'
  defaultText: string
  showStrongs: boolean
  showStrongsTooltips: boolean
  strongsClickOpensTab: boolean
  fontSize: number
  lineHeight: 'compact' | 'comfortable' | 'spacious'
  vaultPath: string
  vaultSync: boolean
}
