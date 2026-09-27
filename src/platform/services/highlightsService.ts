import type { ServiceContext } from './context'

/**
 * Verse highlights — extracted verbatim from electron/ipc/highlights.ts (Phase 1/3).
 */
import type { HighlightColor } from '../../types'
export type { HighlightColor }

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

export interface ChapterHighlight { id: string; color: HighlightColor; startWord: number | null; endWord: number | null; startChar: number | null; endChar: number | null }

export interface ToggleHighlightParams {
  bookId: string; chapter: number; verseNum: number;
  color: HighlightColor; textId?: string;
  startWord?: number; endWord?: number;
  startChar?: number; endChar?: number;
}

export type ToggleHighlightResult =
  | { removed: true; id: string }
  | { updated: true; id: string; color: HighlightColor }
  | { created: true; id: string; color: HighlightColor }

const INSERT_SQL = `
      INSERT INTO highlights (id, text_id, book_id, chapter, verse_num, color, start_word, end_word, start_char, end_char, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `

export function createHighlightsService(ctx: ServiceContext) {
  const db = () => ctx.userDb

  // Returns: Record<verseNum, Array<{ id, color, startWord, endWord, startChar, endChar }>>
  async function getChapter(bookId: string, chapter: number, textId = 'kjva'): Promise<Record<number, ChapterHighlight[]>> {
    const rows = await db().all<DbHighlight>(`
      SELECT id, verse_num, color, start_word, end_word, start_char, end_char, created_at
      FROM highlights
      WHERE text_id = ? AND book_id = ? AND chapter = ?
      ORDER BY verse_num, created_at
    `, [textId, bookId, chapter])

    const byVerse: Record<number, ChapterHighlight[]> = {}
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
  }

  // Toggle: if verse has a highlight at same range and same color → remove; otherwise add/update
  async function toggle(params: ToggleHighlightParams): Promise<ToggleHighlightResult> {
    const { bookId, chapter, verseNum, color, textId = 'kjva', startWord, endWord, startChar, endChar } = params

    const isCharLevel = startChar !== undefined && endChar !== undefined
    const isWordLevel = !isCharLevel && startWord !== undefined && endWord !== undefined

    // Exact-range match: char-level, word-level (start_char IS NULL so a char-level row can't
    // match), or verse-level (both null).
    const existing = isCharLevel
      ? await db().get<{ id: string; color: string }>(`
        SELECT id, color FROM highlights
        WHERE text_id = ? AND book_id = ? AND chapter = ? AND verse_num = ?
          AND start_char = ? AND end_char = ?
        LIMIT 1
      `, [textId, bookId, chapter, verseNum, startChar, endChar])
      : isWordLevel
        ? await db().get<{ id: string; color: string }>(`
        SELECT id, color FROM highlights
        WHERE text_id = ? AND book_id = ? AND chapter = ? AND verse_num = ?
          AND start_word = ? AND end_word = ? AND start_char IS NULL
        LIMIT 1
      `, [textId, bookId, chapter, verseNum, startWord, endWord])
        : await db().get<{ id: string; color: string }>(`
      SELECT id, color FROM highlights
      WHERE text_id = ? AND book_id = ? AND chapter = ? AND verse_num = ?
        AND start_word IS NULL AND start_char IS NULL
      LIMIT 1
    `, [textId, bookId, chapter, verseNum])

    if (existing) {
      if (existing.color === color) {
        await db().run('DELETE FROM highlights WHERE id = ?', [existing.id])
        ctx.events.emit('data:changed', { entity: 'highlight', id: existing.id, op: 'delete' })
        return { removed: true, id: existing.id }
      }
      await db().run('UPDATE highlights SET color = ? WHERE id = ?', [color, existing.id])
      ctx.events.emit('data:changed', { entity: 'highlight', id: existing.id, op: 'upsert' })
      return { updated: true, id: existing.id, color }
    }

    // The id is the highlighted RANGE (DATA-HL-001): the same range highlighted on two devices
    // while apart is one record after sync (the later colour wins), never two stacked rows that
    // un-highlighting would only half remove. Older random-id rows keep their ids.
    const range = isCharLevel ? `c${startChar}-${endChar}` : isWordLevel ? `w${startWord}-${endWord}` : 'v'
    const id = `hl-${textId}-${bookId}-${chapter}-${verseNum}-${range}`
    await db().run(INSERT_SQL, [
      id, textId, bookId, chapter, verseNum, color,
      isWordLevel ? startWord! : null, isWordLevel ? endWord! : null,
      isCharLevel ? startChar! : null, isCharLevel ? endChar! : null,
      ctx.now(),
    ])
    ctx.events.emit('data:changed', { entity: 'highlight', id, op: 'upsert' })
    return { created: true, id, color }
  }

  async function remove(bookId: string, chapter: number, verseNum: number, textId = 'kjva'): Promise<{ success: true }> {
    await db().run(`
      DELETE FROM highlights WHERE text_id = ? AND book_id = ? AND chapter = ? AND verse_num = ?
    `, [textId, bookId, chapter, verseNum])
    ctx.events.emit('data:changed', { entity: 'highlight', op: 'bulk', scope: `${textId}:${bookId}:${chapter}:${verseNum}` })
    return { success: true }
  }

  return { getChapter, toggle, remove }
}

export type HighlightsService = ReturnType<typeof createHighlightsService>
