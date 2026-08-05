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
  // Set alongside targetVerse when navigating in from a scripture search result, so the
  // landed verse can highlight the specific thing that matched — the searched word/phrase
  // (targetVerseQuery/targetVerseWordMode, reusing the same find-in-chapter highlight the
  // Find bar uses) or the specific Strong's-tagged word(s) (targetVerseStrongsWords, word
  // indices — same convention getOccurrences/searchMultiStrongs already use). Cleared
  // together with targetVerse once ChapterView consumes it (onTargetVerseConsumed).
  targetVerseQuery?: string
  targetVerseWordMode?: 'all' | 'any' | 'phrase'
  targetVerseStrongsWords?: number[]
  targetVerseStrongsExtraWords?: string[]
  translation: string
  showStrongs: boolean
  scrollPosition: number
  compareMode?: boolean
  // Compare columns (text/book/chapter + last scroll position), persisted so chapter
  // navigation AND scroll position both survive leaving and returning to the tab (which
  // unmounts the panel). scrollPos is verse-anchored (verseNum + fraction into that row),
  // not a raw pixel scrollTop — matches CompareView.tsx's own sync-scroll encoding, so it
  // still lands correctly even if row heights differ on reload.
  compareColumns?: Array<{ textId: string; bookId: string; chapter: number; scrollPos?: { verseNum: number; frac: number } }>
  // Persisted so a KJV/LXX (or other same-chapter, different-translation) sync-scroll
  // session survives leaving and returning to the tab, same as compareColumns above.
  compareSyncScroll?: boolean
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
  // "Expand all" toggle for the side panel's notes list (whole-snippet vs. truncated preview) —
  // persisted so it survives switching tabs/slots and app restarts instead of resetting to
  // collapsed every time.
  rightPanelExpandAll?: boolean
  rightPanelExpandAllB?: boolean
  // Second side-panel slot — popped out via right-click/drag from slot A (see BiblePanel.tsx's
  // moveTab/closeSlotB). null/undefined = slot B not shown. Slot B is a fully independent
  // BibleRightPanel instance, so it needs its own copy of every "which X is open" field above,
  // not just its own type.
  // rightPanelSlotBTabs is the SET of tab types currently assigned to slot B (a slot can hold
  // more than one, switchable via its own strip) — empty/undefined = slot B not shown.
  // rightPanelSlotB is slot B's currently-ACTIVE tab within that set (must be a member of
  // rightPanelSlotBTabs, or null when the set is empty).
  rightPanelSlotBTabs?: Array<'notes' | 'lexicon' | 'crossrefs'>
  rightPanelSlotB?: 'notes' | 'lexicon' | 'crossrefs' | null
  rightPanelNoteIdB?: string | null
  rightPanelNoteCursorB?: number | null
  rightPanelNoteFocusedB?: boolean
  rightPanelLexiconEntryB?: string | null
  rightPanelVerseFilterB?: string | null
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
  /** Scroll offset of the notes list/browsing view (distinct from `scrollTop`, which is the open-note editor's own scroll). */
  listScrollTop?: number
  /** Epoch ms of the day currently in view in continuous-daily-scroll mode. */
  continuousDailyDate?: number
}

export interface LexiconTabState {
  strongsNum: string | null
  scrollTop?: number
  /** Scroll offset of the SearchView results list (distinct from `scrollTop`, which is the entry-detail view's own scroll). */
  searchScrollTop?: number
  /** Live search-box query/language, restored when returning to the search (non-entry) view. */
  searchQuery?: string
  searchLang?: 'H' | 'G' | 'all'
  lexHistory?: Array<
    | { kind: 'entry'; strongsNum: string }
    | { kind: 'search'; query: string; lang: 'H' | 'G' | 'all' }
  >
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
  /** Scroll offset of the browse/grid video list (the home view, not the player). */
  scrollTop?: number
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
  /** Set when this tab was opened as a one-off "open in new tab" detour from
   *  another tab — lets the back button close this tab and return to that
   *  origin once there's no more in-tab nav history to step back through. */
  originTabId?: string
  originSpaceId?: SpaceId
}

export interface Verse {
  verse_num: number
  text: string
  book_id: string
  chapter: number
  text_tagged?: string   // space-separated tokens: "word{H7225}" or "*word{}" (italic) or "word{}" (no strongs)
  hasNote?: boolean
  hasHighlight?: boolean
  title?: string   // faint section heading rendered above this verse (currently only t12p.db)
}

export interface StrongsWord {
  word: string
  strongsNum: string
  gloss: string
  position: number
}

// Lifecycle-tracking status a note can optionally carry — independent of `color` (purely
// decorative today) and `type`/`folderId` (organizational, not lifecycle). Most notes are
// expected to have no status at all (undefined), not a default one — see defaultNoteStatus
// setting for the opt-in default-on-create behavior.
export type NoteStatus = 'started' | 'in-progress' | 'complete' | 'make-video' | 'archive'

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
  status?: NoteStatus
  folderId?: string | null
  textId?: string   // translation a verse note is attached to ('kjva' | 'lxx' | …)
  idiomTerm?: string
  idiomMeaning?: string
  idiomAliases?: string[]
  idiomAutoVariants?: boolean
  idiomData?: IdiomData
}

/** Structured idiom fields for the reference-book editor + export. */
export interface IdiomData {
  examples?: string[]
  explanation?: string
  compare?: string[]
  verses?: string[]
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
  /** Scripture search query — present when this entry represents "was viewing
   *  Advanced Search results for this query" rather than a specific chapter.
   *  Lets Cmd+[ (navTabBack) from a verse opened out of search results return
   *  to the search itself instead of skipping straight to whatever chapter
   *  was open before the search. */
  query?: string
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
  verse?: number        // bible — the specific verse navigated to, if any (e.g. via search)
  translation?: string  // bible
  noteId?: string       // note
  verseRef?: string     // note — the verse it's attached to, if it's a verse note (links study history back to the passage)
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
