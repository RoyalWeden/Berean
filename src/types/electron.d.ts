import type { Book, Verse, Note, LexiconEntry, SearchResult } from './index'

interface BibleAPI {
  queryChapter: (bookId: string, chapter: number) => Promise<Verse[]>
  queryVerse: (bookId: string, chapter: number, verse: number) => Promise<Verse | null>
  searchText: (query: string, textId?: string) => Promise<SearchResult[]>
  getBooks: (textId?: string) => Promise<Book[]>
}

interface NotesAPI {
  createNote: (data: Partial<Note>) => Promise<{ success: boolean; note?: Note; error?: string }>
  updateNote: (id: string, data: Partial<Note>) => Promise<{ success: boolean; error?: string }>
  deleteNote: (id: string) => Promise<{ success: boolean; error?: string }>
  getNotes: (limit?: number, offset?: number) => Promise<Note[]>
  getVerseNotes: (verseRef: string) => Promise<Note[]>
  getNote: (id: string) => Promise<Note | null>
}

interface LexiconAPI {
  getEntry: (strongsNum: string) => Promise<LexiconEntry | null>
  getOccurrences: (strongsNum: string) => Promise<{ book_id: string; chapter: number; verse_num: number }[]>
}

interface SettingsAPI {
  get: (key: string) => Promise<unknown>
  set: (key: string, value: unknown) => Promise<{ success: boolean }>
  getAll: () => Promise<Record<string, unknown>>
}

interface VaultAPI {
  syncNote: (noteId: string) => Promise<{ success: boolean; reason?: string }>
  readVaultNote: (title: string) => Promise<string | null>
  watchVault: () => Promise<{ success: boolean; reason?: string }>
  onVaultChange: (callback: (event: unknown) => void) => void
}

declare global {
  interface Window {
    bible: BibleAPI
    notes: NotesAPI
    lexicon: LexiconAPI
    settings: SettingsAPI
    vault: VaultAPI
  }
}

export {}
