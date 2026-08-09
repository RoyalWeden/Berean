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

/** Looks up a single Strong's entry (word/gloss/definition/etc) — exported as a plain function,
 *  not just an IPC handler, so other main-process modules (electron/ipc/aiLookup.ts, verifying
 *  a Strong's number before using it) can reuse it without a second DB-access path. */
export function getLexiconEntry(strongsNum: string): ReturnType<typeof mapEntry> | null {
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
}

export interface LexiconOccurrence {
  book_id: string
  chapter: number
  verse_num: number
  text: string
  text_id: string
  matchWordIndices: number[]
}

/** Finds every real, tag-verified occurrence of a Strong's number in the tagged texts — exported
 *  as a plain function for the same reuse reason as getLexiconEntry above. */
export function getLexiconOccurrences(strongsNum: string): LexiconOccurrence[] {
  const num = strongsNum.trim().toUpperCase()
  try {
      const lexDb = num.startsWith('H') ? getHebrewDb() : num.startsWith('G') ? getGreekDb() : null
      if (!lexDb) { return [] }

      const isGreek = num.startsWith('G')

      // Derive occurrences directly from each text's own verses.text_tagged, rather than from
      // the separate pre-built `occurrences` table in strongs_hebrew.db/strongs_greek.db —
      // confirmed that table has drifted stale relative to the actual tagged text (e.g. H5643:
      // occurrences table has 28 rows, kjva.db's text_tagged actually contains {H5643} in 36
      // verses; G26 in kjva.db alone: 100 vs 104). Scanning text_tagged directly makes each
      // text's own tagged data the single source of truth and self-heals any future drift,
      // instead of needing occurrences regenerated in lockstep with every text re-seed.
      //
      // A tag position can hold multiple pipe-separated numbers (e.g. "{H1697|H1696}"), so a
      // plain `%{H5643}%` LIKE would miss H5643 when it's not alone in the braces — match all
      // four positions a number can appear in within the braces.
      function likeVariants(n: string): string[] {
        return [`%{${n}}%`, `%{${n}|%`, `%|${n}}%`, `%|${n}|%`]
      }

      type RawRow = { text_id: string; book_id: string; chapter: number; verse: number }

      function scanTaggedOccurrences(db: ReturnType<typeof getTextDb>, textId: string, limit: number): RawRow[] {
        if (!db) return []
        const [p1, p2, p3, p4] = likeVariants(num)
        const rows = (db as any).prepare(
          `SELECT book_id, chapter, verse_num as verse FROM verses
           WHERE text_tagged LIKE ? OR text_tagged LIKE ? OR text_tagged LIKE ? OR text_tagged LIKE ?
           ORDER BY book_id, chapter, verse_num LIMIT ?`
        ).all(p1, p2, p3, p4, limit) as Array<{ book_id: string; chapter: number; verse: number }>
        return rows.map((r) => ({ ...r, text_id: textId }))
      }

      const kjva = getTextDb('kjva')
      const lxxDb = getTextDb('lxx')

      // Fetch up to 500 per source so both KJVA and LXX are represented even for
      // frequently-occurring G-numbers. H-numbers are KJVA-only.
      const rawRows: RawRow[] = isGreek
        ? [...scanTaggedOccurrences(kjva, 'kjva', 500), ...scanTaggedOccurrences(lxxDb, 'lxx', 500)]
        : scanTaggedOccurrences(kjva, 'kjva', 1000)

      if (!rawRows.length) return []

      const kjvaVerseStmt = kjva
        ? (kjva as any).prepare('SELECT text, text_tagged FROM verses WHERE book_id = ? AND chapter = ? AND verse_num = ? LIMIT 1')
        : null
      const lxxVerseStmt = lxxDb
        ? (lxxDb as any).prepare('SELECT text, text_tagged FROM verses WHERE book_id = ? AND chapter = ? AND verse_num = ? LIMIT 1')
        : null

      // ── Fallback gloss-word list for when text_tagged is absent ───────────
      const entryRow = (lexDb as any).prepare('SELECT short_def FROM entries WHERE strongs_id = ?').get(num) as { short_def: string } | undefined
      const fallbackWords: string[] = (entryRow?.short_def ?? '')
        .toLowerCase()
        .replace(/\([^)]*\)/g, ' ')
        .replace(/[××+\-]/g, ' ')
        .split(/[,\s]+/)
        .map((w: string) => w.replace(/[^a-z]/g, ''))
        .filter((w: string) => w.length >= 4)

      function findMatchWordIndices(textTagged: string | null, plainText: string): number[] {
        // Split plain text once — used for both the fallback path and phrase expansion
        const plainWords = plainText.split(/\s+/).filter((w) => w.length > 0)

        if (textTagged) {
          // Build a flat array: one tag string per word position (skipping ~ tokens)
          const tagRe = /([!*~]?)([^{}!*~]*)\{([^}]*)\}/g
          const wordTags: string[] = []
          let m: RegExpExecArray | null
          while ((m = tagRe.exec(textTagged)) !== null) {
            if (m[1] === '~') continue          // parenthetical marker, no English word
            wordTags.push(m[3].trim())
          }

          // Find every position where this Strong's number appears
          const matched: number[] = []
          for (let i = 0; i < wordTags.length; i++) {
            if (wordTags[i]) {
              const tagNums = wordTags[i].split('|').map((s: string) => s.trim().toUpperCase())
              if (tagNums.includes(num)) matched.push(i)
            }
          }

          if (matched.length > 0) {
            // ── Step 1: re-anchor any match whose plain-text word doesn't match the
            // gloss but a nearby word (up to 4 positions forward) does.
            // This fixes a systematic LXX tagging pattern where the Strong's number
            // is assigned to the article/possessive BEFORE the actual noun/word
            // (e.g. "his{G646}" then "apostasy,{G846}" — tag is one position early).
            //
            // Strategy (when glossHasContentWords):
            //   a) If matched word already matches a gloss word → keep.
            //   b) If matched word is a common English function word, look forward up to
            //      4 positions for a gloss-word match; if not found, look forward up to 3
            //      positions for the first non-function content word (≥5 chars).
            //   c) Otherwise keep the original position.

            // Short words that are never the "content" word being lexically tagged.
            // Confirmed gap (G1707 in 2Ti 2:4): "with{G1707}" wasn't re-anchored to the
            // actual translated word "entangleth" because "with" wasn't in this set —
            // widened to cover the other common short prepositions/conjunctions/pronouns/
            // auxiliary verbs that show up in the same mistagging pattern.
            const FW = new Set(['the', 'a', 'an', 'his', 'her', 'its', 'our', 'your', 'their', 'my', 'thy', 'thine', 'by', 'in', 'of', 'on', 'at', 'to', 'for', 'or', 'and', 'but', 'yet', 'so', 'if', 'as', 'he', 'she', 'it', 'we', 'us', 'me', 'him', 'be', 'is', 'was', 'are', 'not', 'no', 'do', 'did', 'had', 'who', 'whom', 'its', 'now', 'with', 'from', 'unto', 'upon', 'into', 'than', 'then', 'that', 'this', 'these', 'those', 'them', 'they', 'i', 'you', 'ye', 'thou', 'thee', 'shall', 'will', 'hath', 'have', 'been', 'were', 'am', 'up', 'out', 'over', 'under', 'again', 'also', 'even', 'unto'])

            const reanchored: number[] = []
            const glossHasContentWords = fallbackWords.some((fw) => fw.length >= 5)
            for (const idx of matched) {
              const matchedClean = (plainWords[idx] ?? '').toLowerCase().replace(/[^a-z]/g, '')

              // (a) Correct tag — already matches gloss
              if (fallbackWords.some((fw) => fw === matchedClean)) {
                reanchored.push(idx)
                continue
              }

              // No gloss to pivot on, or matched word is not a function word → keep
              if (!glossHasContentWords || !FW.has(matchedClean)) {
                reanchored.push(idx)
                continue
              }

              // (b) Function word + content gloss → try to find a better nearby word
              let found = false

              // First: gloss-word match forward (handles cases where gloss matches translation)
              for (let d = 1; d <= 4; d++) {
                const j = idx + d
                if (j >= plainWords.length) break
                const w = (plainWords[j] ?? '').toLowerCase().replace(/[^a-z]/g, '')
                if (w.length >= 4 && fallbackWords.some((fw) => fw === w || fw === w + 's' || fw + 's' === w)) {
                  reanchored.push(j); found = true; break
                }
              }

              // Fallback: first forward content word (≥5 chars, not a function word)
              // Handles cases where the gloss paraphrases differently from the English text
              // (e.g. G646 gloss "falling away" but English text has "apostacy")
              if (!found) {
                for (let d = 1; d <= 3; d++) {
                  const j = idx + d
                  if (j >= plainWords.length) break
                  const w = (plainWords[j] ?? '').toLowerCase().replace(/[^a-z]/g, '')
                  if (w.length >= 5 && !FW.has(w)) {
                    reanchored.push(j); found = true; break
                  }
                }
              }

              if (!found) reanchored.push(idx)
            }

            // ── Step 2: phrase expansion — include adjacent empty-tagged words whose
            // plain-text word appears in the gloss (one-Greek-word → multi-word-English).
            const expandedSet = new Set(reanchored)
            if (fallbackWords.length > 0) {
              for (const idx of reanchored) {
                for (const dir of [-1, 1] as const) {
                  let j = idx + dir
                  while (j >= 0 && j < wordTags.length && wordTags[j] === '') {
                    const clean = (plainWords[j] ?? '').toLowerCase().replace(/[^a-z]/g, '')
                    if (clean.length >= 3 && fallbackWords.some((fw) => fw === clean)) {
                      expandedSet.add(j)
                      j += dir
                    } else {
                      break
                    }
                  }
                }
              }
            }
            return Array.from(expandedSet).sort((a, b) => a - b)
          }
        }

        // Fallback: match gloss words against plain-text words
        if (fallbackWords.length > 0 && plainWords.length > 0) {
          const matchIndices: number[] = []
          plainWords.forEach((word, idx) => {
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
        const fromLxx = r.text_id === 'lxx'
        const verseStmt = fromLxx ? lxxVerseStmt : kjvaVerseStmt
        const verseRow = verseStmt
          ? verseStmt.get(r.book_id, r.chapter, r.verse) as { text: string; text_tagged: string | null } | undefined
          : undefined
        return {
          book_id: r.book_id,
          chapter: r.chapter,
          verse_num: r.verse,
          text: verseRow?.text ?? '',
          text_id: r.text_id,
          matchWordIndices: findMatchWordIndices(verseRow?.text_tagged ?? null, verseRow?.text ?? ''),
        }
      })
      return results
    } catch (e) {
      return []
    }
}

export function registerLexiconHandlers(ipcMain: IpcMain): void {
  ipcMain.handle('lexicon:getEntry', (_e, strongsNum: string) => getLexiconEntry(strongsNum))

  ipcMain.handle('lexicon:getOccurrences', (_e, strongsNum: string) => getLexiconOccurrences(strongsNum))

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
      WHERE strongs_id LIKE ? OR word LIKE ? OR transliteration LIKE ?
         OR short_def LIKE ? OR full_def LIKE ? OR bdb_def LIKE ?
      ORDER BY
        CASE
          WHEN short_def LIKE ? THEN 0
          WHEN strongs_id LIKE ? OR word LIKE ? OR transliteration LIKE ? THEN 1
          ELSE 2
        END,
        strongs_id
      LIMIT 30
    `
    const results: ReturnType<typeof mapEntry>[] = []
    try {
      if (lang === 'H' || lang === 'all') {
        const rows = getHebrewDb().prepare(sql).all(q, q, q, q, q, q, q, q, q, q) as DbEntry[]
        results.push(...rows.map(mapEntry))
      }
      if (lang === 'G' || lang === 'all') {
        const rows = getGreekDb().prepare(sql).all(q, q, q, q, q, q, q, q, q, q) as DbEntry[]
        results.push(...rows.map(mapEntry))
      }
    } catch {
      // ignore
    }
    return results
  })
}
