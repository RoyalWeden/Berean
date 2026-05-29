import type { IpcMain } from 'electron'
import { getBereanDb } from '../db/berean'
import { randomUUID } from 'crypto'

type HighlightColor = 'yellow' | 'red' | 'green' | 'blue' | 'purple'

interface DbHighlight {
  id: string
  verse_num: number
  color: string
  start_word: number | null
  end_word: number | null
  start_char: number | null
  end_char: number | null
  label: string | null
  created_at: number
}

export function registerHighlightHandlers(ipcMain: IpcMain): void {
  // Returns: Record<verseNum, Array<{ id, color, startWord, endWord, startChar, endChar }>>
  ipcMain.handle('highlights:getChapter', (_e, bookId: string, chapter: number, textId = 'kjva') => {
    const db = getBereanDb()
    const rows = db.prepare(`
      SELECT id, verse_num, color, start_word, end_word, start_char, end_char, created_at
      FROM highlights
      WHERE text_id = ? AND book_id = ? AND chapter = ?
      ORDER BY verse_num, created_at
    `).all(textId, bookId, chapter) as DbHighlight[]

    const byVerse: Record<number, Array<{ id: string; color: HighlightColor; startWord: number | null; endWord: number | null; startChar: number | null; endChar: number | null }>> = {}
    for (const row of rows) {
      if (!byVerse[row.verse_num]) byVerse[row.verse_num] = []
      byVerse[row.verse_num].push({
        id: row.id,
        color: row.color as HighlightColor,
        startWord: row.start_word,
        endWord: row.end_word,
        startChar: row.start_char,
        endChar: row.end_char,
      })
    }
    return byVerse
  })

  // Toggle: if verse has a highlight at same range and same color → remove; otherwise add/update
  ipcMain.handle('highlights:toggle', (_e, params: {
    bookId: string; chapter: number; verseNum: number;
    color: HighlightColor; textId?: string;
    startWord?: number; endWord?: number;
    startChar?: number; endChar?: number;
  }) => {
    const { bookId, chapter, verseNum, color, textId = 'kjva', startWord, endWord, startChar, endChar } = params
    const db = getBereanDb()

    const isCharLevel = startChar !== undefined && endChar !== undefined
    const isWordLevel = !isCharLevel && startWord !== undefined && endWord !== undefined

    if (isCharLevel) {
      // Look for an exact char-range match
      const existing = db.prepare(`
        SELECT id, color FROM highlights
        WHERE text_id = ? AND book_id = ? AND chapter = ? AND verse_num = ?
          AND start_char = ? AND end_char = ?
        LIMIT 1
      `).get(textId, bookId, chapter, verseNum, startChar, endChar) as { id: string; color: string } | undefined

      if (existing) {
        if (existing.color === color) {
          db.prepare('DELETE FROM highlights WHERE id = ?').run(existing.id)
          return { removed: true, id: existing.id }
        }
        db.prepare('UPDATE highlights SET color = ? WHERE id = ?').run(color, existing.id)
        return { updated: true, id: existing.id, color }
      }

      const id = randomUUID()
      db.prepare(`
        INSERT INTO highlights (id, text_id, book_id, chapter, verse_num, color, start_word, end_word, start_char, end_char, created_at)
        VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?)
      `).run(id, textId, bookId, chapter, verseNum, color, startChar, endChar, Date.now())
      return { created: true, id, color }
    }

    if (isWordLevel) {
      // Look for an exact word-range match (with start_char IS NULL to avoid matching char-level)
      const existing = db.prepare(`
        SELECT id, color FROM highlights
        WHERE text_id = ? AND book_id = ? AND chapter = ? AND verse_num = ?
          AND start_word = ? AND end_word = ? AND start_char IS NULL
        LIMIT 1
      `).get(textId, bookId, chapter, verseNum, startWord, endWord) as { id: string; color: string } | undefined

      if (existing) {
        if (existing.color === color) {
          db.prepare('DELETE FROM highlights WHERE id = ?').run(existing.id)
          return { removed: true, id: existing.id }
        }
        db.prepare('UPDATE highlights SET color = ? WHERE id = ?').run(color, existing.id)
        return { updated: true, id: existing.id, color }
      }

      const id = randomUUID()
      db.prepare(`
        INSERT INTO highlights (id, text_id, book_id, chapter, verse_num, color, start_word, end_word, start_char, end_char, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?)
      `).run(id, textId, bookId, chapter, verseNum, color, startWord, endWord, Date.now())
      return { created: true, id, color }
    }

    // Verse-level: match on null start/end_word and null start/end_char
    const existing = db.prepare(`
      SELECT id, color FROM highlights
      WHERE text_id = ? AND book_id = ? AND chapter = ? AND verse_num = ?
        AND start_word IS NULL AND start_char IS NULL
      LIMIT 1
    `).get(textId, bookId, chapter, verseNum) as { id: string; color: string } | undefined

    if (existing) {
      if (existing.color === color) {
        db.prepare('DELETE FROM highlights WHERE id = ?').run(existing.id)
        return { removed: true, id: existing.id }
      }
      db.prepare('UPDATE highlights SET color = ? WHERE id = ?').run(color, existing.id)
      return { updated: true, id: existing.id, color }
    }

    const id = randomUUID()
    db.prepare(`
      INSERT INTO highlights (id, text_id, book_id, chapter, verse_num, color, start_word, end_word, start_char, end_char, created_at)
      VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, ?)
    `).run(id, textId, bookId, chapter, verseNum, color, Date.now())
    return { created: true, id, color }
  })

  ipcMain.handle('highlights:remove', (_e, bookId: string, chapter: number, verseNum: number, textId = 'kjva') => {
    const db = getBereanDb()
    db.prepare(`
      DELETE FROM highlights WHERE text_id = ? AND book_id = ? AND chapter = ? AND verse_num = ?
    `).run(textId, bookId, chapter, verseNum)
    return { success: true }
  })
}
