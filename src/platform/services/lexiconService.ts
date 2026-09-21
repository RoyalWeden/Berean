import type { DatabaseAdapter } from '../db/DatabaseAdapter'
import type { ServiceContext } from './context'

/**
 * Strong's lexicon lookups — extracted verbatim from electron/ipc/lexicon.ts (Phase 1/3). The SQL
 * and result shapes are unchanged; only the execution is async through DatabaseAdapter. The
 * electron file keeps synchronous copies of these (@deprecated) for aiLookup.ts/studyTrail.ts.
 */

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
export type LexiconEntry = ReturnType<typeof mapEntry>

export interface LexiconOccurrence {
  book_id: string
  chapter: number
  verse_num: number
  text: string
  text_id: string
  matchWordIndices: number[]
}

export function createLexiconService(ctx: ServiceContext) {
  /** Looks up a single Strong's entry (word/gloss/definition/etc). */
  async function getEntry(strongsNum: string): Promise<LexiconEntry | null> {
    const num = strongsNum.trim().toUpperCase()
    try {
      if (num.startsWith('H')) {
        const db = await ctx.lexiconDb('H')
        const row = await db.get<DbEntry>('SELECT * FROM entries WHERE strongs_id = ?', [num])
        return row ? mapEntry(row) : null
      } else if (num.startsWith('G')) {
        const db = await ctx.lexiconDb('G')
        const row = await db.get<DbEntry>('SELECT * FROM entries WHERE strongs_id = ?', [num])
        return row ? mapEntry(row) : null
      }
      return null
    } catch {
      return null
    }
  }

  /** Finds every real, tag-verified occurrence of a Strong's number in the tagged texts.
   *  `bookId` (optional): scopes results to a single book (e.g. "MAT") — filtered on the
   *  already-fetched rows before the expensive per-row match-index computation below, so a
   *  question like "where in Matthew is G5485 used" only ever shows Matthew occurrences instead
   *  of silently substituting the first N alphabetically (which could be a different book
   *  entirely, or none at all if the number simply doesn't occur there — see aiLookup.ts's
   *  callers for the "not found" handling this makes possible).
   *  `quickLimit` (optional): caps how many rows are scanned per source, instead of the normal
   *  500 (Greek)/1000 (Hebrew) — used for a fast first pass so the panel can render an initial
   *  batch immediately instead of blocking on the full scan-and-match-index-compute pass for a
   *  common word. LexiconPanel.tsx calls this once with a small quickLimit for the instant
   *  render, then again with no limit for the complete set once the panel is already showing
   *  something. */
  async function getOccurrences(strongsNum: string, bookId?: string, quickLimit?: number): Promise<LexiconOccurrence[]> {
    const num = strongsNum.trim().toUpperCase()
    try {
      const lexDb = num.startsWith('H') ? await ctx.lexiconDb('H') : num.startsWith('G') ? await ctx.lexiconDb('G') : null
      if (!lexDb) return []

      const isGreek = num.startsWith('G')

      // Derive occurrences directly from each text's own verses.text_tagged, rather than from
      // the separate pre-built `occurrences` table in strongs_hebrew.db/strongs_greek.db — that
      // table has drifted stale relative to the actual tagged text. Scanning text_tagged directly
      // makes each text's own tagged data the single source of truth.
      //
      // A tag position can hold multiple pipe-separated numbers (e.g. "{H1697|H1696}"), so a
      // plain `%{H5643}%` LIKE would miss H5643 when it's not alone in the braces — match all
      // four positions a number can appear in within the braces.
      function likeVariants(n: string): string[] {
        return [`%{${n}}%`, `%{${n}|%`, `%|${n}}%`, `%|${n}|%`]
      }

      type RawRow = { text_id: string; book_id: string; chapter: number; verse: number }

      // `bookScope` (optional) is pushed straight into the SQL WHERE clause — filtering AFTER
      // the LIMIT used to mean a book-scoped lookup on a common word came back completely empty
      // whenever the first 500/1000 tagged hits (in book_id, chapter, verse_num order) simply
      // never reached the requested book. Filtering in SQL means LIMIT only ever caps the
      // (already book-scoped) result set, not the pre-filter scan.
      async function scanTaggedOccurrences(db: DatabaseAdapter | null, textId: string, limit: number, bookScope?: string): Promise<RawRow[]> {
        if (!db) return []
        const [p1, p2, p3, p4] = likeVariants(num)
        const bookClause = bookScope ? ' AND book_id = ?' : ''
        const params = bookScope ? [p1, p2, p3, p4, bookScope, limit] : [p1, p2, p3, p4, limit]
        const rows = await db.all<{ book_id: string; chapter: number; verse: number }>(
          `SELECT book_id, chapter, verse_num as verse FROM verses
           WHERE (text_tagged LIKE ? OR text_tagged LIKE ? OR text_tagged LIKE ? OR text_tagged LIKE ?)${bookClause}
           ORDER BY book_id, chapter, verse_num LIMIT ?`,
          params,
        )
        return rows.map((r) => ({ ...r, text_id: textId }))
      }

      const kjva = await ctx.textDb('kjva')
      const lxxDb = await ctx.textDb('lxx')
      const bookScope = bookId ? bookId.toUpperCase() : undefined

      // Fetch up to 500 per source so both KJVA and LXX are represented even for
      // frequently-occurring G-numbers. H-numbers are KJVA-only. `quickLimit`, when given,
      // caps this lower for the fast first pass — see this function's own comment.
      const greekLimit = quickLimit ?? 500
      const hebrewLimit = quickLimit ?? 1000
      const rawRows: RawRow[] = isGreek
        ? [...(await scanTaggedOccurrences(kjva, 'kjva', greekLimit, bookScope)), ...(await scanTaggedOccurrences(lxxDb, 'lxx', greekLimit, bookScope))]
        : await scanTaggedOccurrences(kjva, 'kjva', hebrewLimit, bookScope)

      if (!rawRows.length) return []

      // ── Fallback gloss-word list for when text_tagged is absent ───────────
      const entryRow = await lexDb.get<{ short_def: string }>('SELECT short_def FROM entries WHERE strongs_id = ?', [num])
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

      const results = await Promise.all(rawRows.map(async (r) => {
        const fromLxx = r.text_id === 'lxx'
        const verseDb = fromLxx ? lxxDb : kjva
        const verseRow = verseDb
          ? await verseDb.get<{ text: string; text_tagged: string | null }>(
              'SELECT text, text_tagged FROM verses WHERE book_id = ? AND chapter = ? AND verse_num = ? LIMIT 1',
              [r.book_id, r.chapter, r.verse],
            )
          : undefined
        return {
          book_id: r.book_id,
          chapter: r.chapter,
          verse_num: r.verse,
          text: verseRow?.text ?? '',
          text_id: r.text_id,
          matchWordIndices: findMatchWordIndices(verseRow?.text_tagged ?? null, verseRow?.text ?? ''),
        }
      }))
      return results
    } catch {
      return []
    }
  }

  /** Strong's numbers with a matching derivation reference — "related words" list. */
  async function getRelated(strongsNum: string) {
    const num = strongsNum.trim().toUpperCase()
    const q = `%${num}%`
    const sql = `SELECT strongs_id, word, transliteration, short_def FROM entries WHERE derivation LIKE ? AND strongs_id != ? LIMIT 12`
    type Row = Pick<DbEntry, 'strongs_id' | 'word' | 'transliteration' | 'short_def'>
    const results: Row[] = []
    try {
      if (num.startsWith('H')) {
        const db = await ctx.lexiconDb('H')
        results.push(...await db.all<Row>(sql, [q, num]))
      } else if (num.startsWith('G')) {
        const db = await ctx.lexiconDb('G')
        results.push(...await db.all<Row>(sql, [q, num]))
      }
    } catch { /* ignore */ }
    return results.map((r) => ({
      strongsNum: r.strongs_id,
      lemma: r.word ?? '',
      transliteration: r.transliteration ?? '',
      gloss: r.short_def ?? '',
    }))
  }

  /** Gloss/definition search over both lexicons. */
  async function search(query: string, lang: 'H' | 'G' | 'all'): Promise<LexiconEntry[]> {
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
    const results: LexiconEntry[] = []
    try {
      if (lang === 'H' || lang === 'all') {
        const db = await ctx.lexiconDb('H')
        const rows = await db.all<DbEntry>(sql, [q, q, q, q, q, q, q, q, q, q])
        results.push(...rows.map(mapEntry))
      }
      if (lang === 'G' || lang === 'all') {
        const db = await ctx.lexiconDb('G')
        const rows = await db.all<DbEntry>(sql, [q, q, q, q, q, q, q, q, q, q])
        results.push(...rows.map(mapEntry))
      }
    } catch {
      // ignore
    }
    return results
  }

  /**
   * Finds a lexicon entry by transliteration, comparing NORMALIZED (diacritics stripped, e.g.
   * "agápē" -> "agape") rather than via SQL `LIKE` — SQLite's LIKE is not diacritic-insensitive,
   * and nearly every Greek/Hebrew transliteration in these tables carries accents or macrons.
   * Both lexicons are small (low thousands of rows), so this pulls just
   * `strongs_id`/`transliteration` for the whole table and does the normalized comparison in JS,
   * once, per call.
   */
  async function findByNormalizedTransliteration(
    normalizedQuery: string,
    lang: 'H' | 'G' | 'all',
    normalize: (s: string) => string,
  ): Promise<{ strongsId: string; transliteration: string } | null> {
    const dbs = lang === 'all' ? [await ctx.lexiconDb('H'), await ctx.lexiconDb('G')] : [await ctx.lexiconDb(lang)]
    for (const db of dbs) {
      try {
        const rows = await db.all<{ strongs_id: string; transliteration: string }>(
          'SELECT strongs_id, transliteration FROM entries WHERE transliteration IS NOT NULL',
        )
        const hit = rows.find((r) => normalize(r.transliteration) === normalizedQuery)
        if (hit) return { strongsId: hit.strongs_id, transliteration: hit.transliteration }
      } catch { /* ignore — same best-effort convention as search() above */ }
    }
    return null
  }

  return {
    getEntry,
    getOccurrences,
    getRelated,
    search,
    // Aliases matching the desktop-only sync helper names in electron/ipc/lexicon.ts, so a
    // future async conversion of aiLookup.ts/studyTrail.ts can call these by the name it
    // already knows without re-deriving the mapping.
    searchLexiconGloss: search,
    getLexiconOccurrences: getOccurrences,
    findByNormalizedTransliteration,
  }
}

export type LexiconService = ReturnType<typeof createLexiconService>
