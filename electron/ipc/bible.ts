import type { IpcMain } from 'electron'

const PLACEHOLDER_BOOKS = [
  { id: 'GEN', name: 'Genesis', short_name: 'Gen', testament: 'OT', chapters_count: 50 },
  { id: 'EXO', name: 'Exodus', short_name: 'Exo', testament: 'OT', chapters_count: 40 },
  { id: 'LEV', name: 'Leviticus', short_name: 'Lev', testament: 'OT', chapters_count: 27 },
  { id: 'NUM', name: 'Numbers', short_name: 'Num', testament: 'OT', chapters_count: 36 },
  { id: 'DEU', name: 'Deuteronomy', short_name: 'Deu', testament: 'OT', chapters_count: 34 },
  { id: 'JOS', name: 'Joshua', short_name: 'Jos', testament: 'OT', chapters_count: 24 },
  { id: 'JDG', name: 'Judges', short_name: 'Jdg', testament: 'OT', chapters_count: 21 },
  { id: 'RUT', name: 'Ruth', short_name: 'Rut', testament: 'OT', chapters_count: 4 },
  { id: '1SA', name: '1 Samuel', short_name: '1Sa', testament: 'OT', chapters_count: 31 },
  { id: '2SA', name: '2 Samuel', short_name: '2Sa', testament: 'OT', chapters_count: 24 },
  { id: '1KI', name: '1 Kings', short_name: '1Ki', testament: 'OT', chapters_count: 22 },
  { id: '2KI', name: '2 Kings', short_name: '2Ki', testament: 'OT', chapters_count: 25 },
  { id: '1CH', name: '1 Chronicles', short_name: '1Ch', testament: 'OT', chapters_count: 29 },
  { id: '2CH', name: '2 Chronicles', short_name: '2Ch', testament: 'OT', chapters_count: 36 },
  { id: 'EZR', name: 'Ezra', short_name: 'Ezr', testament: 'OT', chapters_count: 10 },
  { id: 'NEH', name: 'Nehemiah', short_name: 'Neh', testament: 'OT', chapters_count: 13 },
  { id: 'JOB', name: 'Job', short_name: 'Job', testament: 'OT', chapters_count: 42 },
  { id: 'PSA', name: 'Psalms', short_name: 'Psa', testament: 'OT', chapters_count: 150 },
  { id: 'PRO', name: 'Proverbs', short_name: 'Pro', testament: 'OT', chapters_count: 31 },
  { id: 'ECC', name: 'Ecclesiastes', short_name: 'Ecc', testament: 'OT', chapters_count: 12 },
  { id: 'SNG', name: 'Song of Solomon', short_name: 'Sng', testament: 'OT', chapters_count: 8 },
  { id: 'ISA', name: 'Isaiah', short_name: 'Isa', testament: 'OT', chapters_count: 66 },
  { id: 'JER', name: 'Jeremiah', short_name: 'Jer', testament: 'OT', chapters_count: 52 },
  { id: 'LAM', name: 'Lamentations', short_name: 'Lam', testament: 'OT', chapters_count: 5 },
  { id: 'EZK', name: 'Ezekiel', short_name: 'Ezk', testament: 'OT', chapters_count: 48 },
  { id: 'DAN', name: 'Daniel', short_name: 'Dan', testament: 'OT', chapters_count: 12 },
  { id: 'HOS', name: 'Hosea', short_name: 'Hos', testament: 'OT', chapters_count: 14 },
  { id: 'JOL', name: 'Joel', short_name: 'Jol', testament: 'OT', chapters_count: 3 },
  { id: 'AMO', name: 'Amos', short_name: 'Amo', testament: 'OT', chapters_count: 9 },
  { id: 'OBA', name: 'Obadiah', short_name: 'Oba', testament: 'OT', chapters_count: 1 },
  { id: 'JON', name: 'Jonah', short_name: 'Jon', testament: 'OT', chapters_count: 4 },
  { id: 'MIC', name: 'Micah', short_name: 'Mic', testament: 'OT', chapters_count: 7 },
  { id: 'NAM', name: 'Nahum', short_name: 'Nam', testament: 'OT', chapters_count: 3 },
  { id: 'HAB', name: 'Habakkuk', short_name: 'Hab', testament: 'OT', chapters_count: 3 },
  { id: 'ZEP', name: 'Zephaniah', short_name: 'Zep', testament: 'OT', chapters_count: 3 },
  { id: 'HAG', name: 'Haggai', short_name: 'Hag', testament: 'OT', chapters_count: 2 },
  { id: 'ZEC', name: 'Zechariah', short_name: 'Zec', testament: 'OT', chapters_count: 14 },
  { id: 'MAL', name: 'Malachi', short_name: 'Mal', testament: 'OT', chapters_count: 4 },
  { id: 'MAT', name: 'Matthew', short_name: 'Mat', testament: 'NT', chapters_count: 28 },
  { id: 'MRK', name: 'Mark', short_name: 'Mrk', testament: 'NT', chapters_count: 16 },
  { id: 'LUK', name: 'Luke', short_name: 'Luk', testament: 'NT', chapters_count: 24 },
  { id: 'JHN', name: 'John', short_name: 'Jhn', testament: 'NT', chapters_count: 21 },
  { id: 'ACT', name: 'Acts', short_name: 'Act', testament: 'NT', chapters_count: 28 },
  { id: 'ROM', name: 'Romans', short_name: 'Rom', testament: 'NT', chapters_count: 16 },
  { id: '1CO', name: '1 Corinthians', short_name: '1Co', testament: 'NT', chapters_count: 16 },
  { id: '2CO', name: '2 Corinthians', short_name: '2Co', testament: 'NT', chapters_count: 13 },
  { id: 'GAL', name: 'Galatians', short_name: 'Gal', testament: 'NT', chapters_count: 6 },
  { id: 'EPH', name: 'Ephesians', short_name: 'Eph', testament: 'NT', chapters_count: 6 },
  { id: 'PHP', name: 'Philippians', short_name: 'Php', testament: 'NT', chapters_count: 4 },
  { id: 'COL', name: 'Colossians', short_name: 'Col', testament: 'NT', chapters_count: 4 },
  { id: '1TH', name: '1 Thessalonians', short_name: '1Th', testament: 'NT', chapters_count: 5 },
  { id: '2TH', name: '2 Thessalonians', short_name: '2Th', testament: 'NT', chapters_count: 3 },
  { id: '1TI', name: '1 Timothy', short_name: '1Ti', testament: 'NT', chapters_count: 6 },
  { id: '2TI', name: '2 Timothy', short_name: '2Ti', testament: 'NT', chapters_count: 4 },
  { id: 'TIT', name: 'Titus', short_name: 'Tit', testament: 'NT', chapters_count: 3 },
  { id: 'PHM', name: 'Philemon', short_name: 'Phm', testament: 'NT', chapters_count: 1 },
  { id: 'HEB', name: 'Hebrews', short_name: 'Heb', testament: 'NT', chapters_count: 13 },
  { id: 'JAS', name: 'James', short_name: 'Jas', testament: 'NT', chapters_count: 5 },
  { id: '1PE', name: '1 Peter', short_name: '1Pe', testament: 'NT', chapters_count: 5 },
  { id: '2PE', name: '2 Peter', short_name: '2Pe', testament: 'NT', chapters_count: 3 },
  { id: '1JN', name: '1 John', short_name: '1Jn', testament: 'NT', chapters_count: 5 },
  { id: '2JN', name: '2 John', short_name: '2Jn', testament: 'NT', chapters_count: 1 },
  { id: '3JN', name: '3 John', short_name: '3Jn', testament: 'NT', chapters_count: 1 },
  { id: 'JUD', name: 'Jude', short_name: 'Jud', testament: 'NT', chapters_count: 1 },
  { id: 'REV', name: 'Revelation', short_name: 'Rev', testament: 'NT', chapters_count: 22 }
]

const PLACEHOLDER_VERSES: Record<string, Record<number, { verse_num: number; text: string }[]>> = {
  GEN: {
    1: [
      { verse_num: 1, text: 'In the beginning Elohim created the heaven and the earth.' },
      { verse_num: 2, text: 'And the earth was without form, and void; and darkness was upon the face of the deep. And the Spirit of Elohim moved upon the face of the waters.' },
      { verse_num: 3, text: 'And Elohim said, Let there be light: and there was light.' },
      { verse_num: 4, text: 'And Elohim saw the light, that it was good: and Elohim divided the light from the darkness.' },
      { verse_num: 5, text: 'And Elohim called the light Day, and the darkness he called Night. And the evening and the morning were the first day.' }
    ]
  }
}

export function registerBibleHandlers(ipcMain: IpcMain): void {
  ipcMain.handle('bible:getBooks', (_event, _textId?: string) => {
    return PLACEHOLDER_BOOKS
  })

  ipcMain.handle('bible:queryChapter', (_event, bookId: string, chapter: number) => {
    const bookVerses = PLACEHOLDER_VERSES[bookId]
    if (bookVerses && bookVerses[chapter]) {
      return bookVerses[chapter].map((v) => ({ ...v, book_id: bookId, chapter }))
    }
    // Return generic placeholder for any book/chapter not in the map
    return Array.from({ length: 5 }, (_, i) => ({
      verse_num: i + 1,
      text: `[Verse ${i + 1} of ${bookId} ${chapter} — real text loads in Phase 2]`,
      book_id: bookId,
      chapter
    }))
  })

  ipcMain.handle('bible:queryVerse', (_event, bookId: string, chapter: number, verseNum: number) => {
    const bookVerses = PLACEHOLDER_VERSES[bookId]
    if (bookVerses && bookVerses[chapter]) {
      const v = bookVerses[chapter].find((v) => v.verse_num === verseNum)
      if (v) return { ...v, book_id: bookId, chapter }
    }
    return {
      verse_num: verseNum,
      text: `[${bookId} ${chapter}:${verseNum} — real text loads in Phase 2]`,
      book_id: bookId,
      chapter
    }
  })

  ipcMain.handle('bible:searchText', (_event, query: string, _textId?: string) => {
    if (!query.trim()) return []
    return []
  })
}
