import type { IpcMain } from 'electron'
import { getHebrewDb, getGreekDb } from '../db/lexicon'
import { getTextDb } from '../db/bible'

interface DbEntry {
  strongs_id: string
  word: string
  transliteration: string
  pronunciation: string
  short_def: string
  full_def: string
  derivation: string
  bdb_def: string
  occurrence_count?: number
}

function mapEntry(row: DbEntry) {
  return {
    strongsNum: row.strongs_id,
    lemma: row.word ?? '',
    transliteration: row.transliteration ?? '',
    pronunciation: row.pronunciation ?? '',
    gloss: row.short_def ?? '',
    definition: row.full_def ?? '',
    derivation: row.derivation ?? '',
    extendedDef: row.bdb_def ?? '',
    occurrences: row.occurrence_count ?? 0,
  }
}

export function registerLexiconHandlers(ipcMain: IpcMain): void {
  ipcMain.handle('lexicon:getEntry', (_e, strongsNum: string) => {
    const num = strongsNum.trim().toUpperCase()
    try {
      if (num.startsWith('H')) {
        const db = getHebrewDb()
        const row = db.prepare('SELECT * FROM entries WHERE strongs_id = ?').get(num) as DbEntry | undefined
        return row ? mapEntry(row) : null
      } else if (num.startsWith('G')) {
        const db = getGreekDb()
        const row = db.prepare('SELECT * FROM entries WHERE strongs_id = ?').get(num) as DbEntry | undefined
        return row ? mapEntry(row) : null
      }
      return null
    } catch {
      return null
    }
  })

  ipcMain.handle('lexicon:getOccurrences', (_e, strongsNum: string) => {
    const num = strongsNum.trim().toUpperCase()
    console.log('[lexicon:getOccurrences] called with:', num)
    try {
      const lexDb = num.startsWith('H') ? getHebrewDb() : num.startsWith('G') ? getGreekDb() : null
      if (!lexDb) { console.log('[lexicon:getOccurrences] no lexDb for', num); return [] }

      // Check table exists
      const tables = (lexDb as any).prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='occurrences'").get()
      if (!tables) { console.log('[lexicon:getOccurrences] no occurrences table'); return [] }

      // Get occurrence refs (limited to first 200 for performance)
      const rawRows = (lexDb as any).prepare(
        'SELECT book_num, chapter, verse FROM occurrences WHERE strongs_id = ? ORDER BY book_num, chapter, verse LIMIT 200'
      ).all(num) as Array<{ book_num: number; chapter: number; verse: number }>
      console.log(`[lexicon:getOccurrences] ${num} → ${rawRows.length} raw rows, first 3:`, rawRows.slice(0, 3))
      if (!rawRows.length) return []

      // Build book_num → book_id map from kjva DB
      const kjva = getTextDb('kjva')
      if (!kjva) {
        console.log('[lexicon:getOccurrences] kjva DB not found — returning book${num} fallback')
        return rawRows.map((r) => ({ book_id: `book${r.book_num}`, chapter: r.chapter, verse_num: r.verse, text: '', matchWordIndices: [] as number[] }))
      }

      const bookMapRows = (kjva as any).prepare('SELECT rowid as book_num, id FROM books ORDER BY rowid').all() as Array<{ id: string; book_num: number }>
      const bookNumToId = new Map<number, string>(bookMapRows.map((b) => [b.book_num, b.id]))

      // Fetch verse texts + tagged text for each occurrence
      const verseStmt = (kjva as any).prepare(
        'SELECT text, text_tagged FROM verses WHERE book_id = ? AND chapter = ? AND verse_num = ? LIMIT 1'
      )

      // Build fallback word list from the lexicon entry's English glosses.
      // Used when text_tagged is absent or doesn't carry the Strong's tag.
      const entryRow = (lexDb as any).prepare('SELECT short_def FROM entries WHERE strongs_id = ?').get(num) as { short_def: string } | undefined
      const fallbackWords: string[] = (entryRow?.short_def ?? '')
        .toLowerCase()
        .replace(/\([^)]*\)/g, ' ')     // strip (parenthetical) content
        .replace(/[××+\-]/g, ' ')  // strip special chars
        .split(/[,\s]+/)
        .map((w: string) => w.replace(/[^a-z]/g, ''))
        .filter((w: string) => w.length >= 4)

      /** Parse text_tagged to find word indices (0-based) that carry the given strongs num.
       *  Falls back to gloss-word matching when text_tagged is absent or the tag is missing. */
      function findMatchWordIndices(textTagged: string | null, plainText: string): number[] {
        if (textTagged) {
          // Matches all token forms: optional prefix (!*~), word (may be empty), strongs in braces
          // Examples: word{H7225}  *word{}  !word{G1063}  ~{H853}  word{H914|H996}
          const tagRe = /([!*~]?)([^{}!*~]*)\{([^}]*)\}/g
          const indices: number[] = []
          let wordIdx = 0
          let m: RegExpExecArray | null
          while ((m = tagRe.exec(textTagged)) !== null) {
            const prefix = m[1]
            // Parenthetical tokens (~{H853}) are grammatical particles with no English word.
            // They should not increment wordIdx (no English word to highlight).
            if (prefix === '~') continue
            const tag = m[3].trim()
            if (tag) {
              // Support multi-Strongs: word{H914|H996} — check if num appears in the list
              const tagNums = tag.split('|').map((s: string) => s.trim().toUpperCase())
              if (tagNums.includes(num)) {
                indices.push(wordIdx)
              }
            }
            wordIdx++
          }
          if (indices.length > 0) return indices
        }

        // Fallback: match fallback gloss words against plain-text words (exact or +s)
        if (fallbackWords.length > 0 && plainText) {
          const matchIndices: number[] = []
          plainText.split(' ').forEach((word, idx) => {
            const clean = word.toLowerCase().replace(/[^a-z]/g, '')
            if (clean.length >= 4 && fallbackWords.some((fw) => fw === clean || fw === clean + 's' || fw + 's' === clean)) {
              matchIndices.push(idx)
            }
          })
          return matchIndices
        }

        return []
      }

      const results = rawRows.map((r) => {
        const bookId = bookNumToId.get(r.book_num) ?? `book${r.book_num}`
        const verseRow = verseStmt.get(bookId, r.chapter, r.verse) as { text: string; text_tagged: string | null } | undefined
        return {
          book_id: bookId,
          chapter: r.chapter,
          verse_num: r.verse,
          text: verseRow?.text ?? '',
          matchWordIndices: findMatchWordIndices(verseRow?.text_tagged ?? null, verseRow?.text ?? ''),
        }
      })
      console.log('[lexicon:getOccurrences] first 2 results:', results.slice(0, 2))
      return results
    } catch (e) {
      console.error('[lexicon:getOccurrences] error', e)
      return []
    }
  })

  ipcMain.handle('lexicon:getRelated', (_e, strongsNum: string) => {
    const num = strongsNum.trim().toUpperCase()
    const q = `%${num}%`
    const sql = `SELECT strongs_id, word, transliteration, short_def FROM entries WHERE derivation LIKE ? AND strongs_id != ? LIMIT 12`
    const results: Pick<DbEntry, 'strongs_id' | 'word' | 'transliteration' | 'short_def'>[] = []
    try {
      if (num.startsWith('H')) {
        results.push(...getHebrewDb().prepare(sql).all(q, num) as typeof results)
      } else if (num.startsWith('G')) {
        results.push(...getGreekDb().prepare(sql).all(q, num) as typeof results)
      }
    } catch { /* ignore */ }
    return results.map((r) => ({
      strongsNum: r.strongs_id,
      lemma: r.word ?? '',
      transliteration: r.transliteration ?? '',
      gloss: r.short_def ?? '',
    }))
  })

  ipcMain.handle('lexicon:search', (_e, query: string, lang: 'H' | 'G' | 'all') => {
    const q = `%${query.trim()}%`
    const sql = `
      SELECT * FROM entries
      WHERE strongs_id LIKE ? OR word LIKE ? OR short_def LIKE ? OR transliteration LIKE ?
      LIMIT 20
    `
    const results: ReturnType<typeof mapEntry>[] = []
    try {
      if (lang === 'H' || lang === 'all') {
        const rows = getHebrewDb().prepare(sql).all(q, q, q, q) as DbEntry[]
        results.push(...rows.map(mapEntry))
      }
      if (lang === 'G' || lang === 'all') {
        const rows = getGreekDb().prepare(sql).all(q, q, q, q) as DbEntry[]
        results.push(...rows.map(mapEntry))
      }
    } catch {
      // ignore
    }
    return results
  })
}
