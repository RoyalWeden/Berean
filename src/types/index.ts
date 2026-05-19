export type SpaceId = 'scripture' | 'notes' | 'lexicon' | 'youtube' | 'search'

export type TabType = 'bible' | 'note' | 'lexicon' | 'youtube' | 'search'

export interface BibleTabState {
  bookId: string
  chapter: number
  verse?: number
  translation: string
  showStrongs: boolean
  scrollPosition: number
}

export interface NoteTabState {
  noteId: string | null
  isNew: boolean
  verseRef?: string
}

export interface LexiconTabState {
  strongsNum: string | null
}

export interface YouTubeTabState {
  videoId: string | null
  playlistId: string | null
  url?: string
}

export interface SearchTabState {
  query: string
  results: SearchResult[]
}

export type TabState =
  | BibleTabState
  | NoteTabState
  | LexiconTabState
  | YouTubeTabState
  | SearchTabState

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
  title: string
  content: string
  verseRef?: string | null
  createdAt: number
  updatedAt: number
  tags: string[]
  color?: string
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
  gloss: string
  definition: string
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

export interface Highlight {
  id: string
  bookId: string
  chapter: number
  verseNum: number
  color: 'yellow' | 'red' | 'green' | 'blue' | 'purple'
  startWord?: number
  endWord?: number
  createdAt: number
}

export type MosaicKey = 'bible-panel' | 'notes-panel' | 'lexicon-panel' | 'youtube-panel' | 'search-panel'

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
