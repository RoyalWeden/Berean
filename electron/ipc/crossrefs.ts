import type { IpcMain } from 'electron'
import { app } from 'electron'
import { join } from 'path'
import { existsSync } from 'fs'
import Database from 'better-sqlite3'
import { getTextDb } from '../db/bible'
import { toCanonicalChapters } from '@/lib/translationChapterMap'

type DB = InstanceType<typeof Database>
let db: DB | null = null
let tskeDb: DB | null = null

function dataPath(filename: string): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'data', filename)
  }
  return join(__dirname, '../../data', filename)
}

function openDb(): DB | null {
  if (db) return db
  const p = dataPath('cross_references.db')
  if (!existsSync(p)) {
    return null
  }
  db = new (Database as any)(p, { readonly: true }) as DB
  return db
}

// tske_refs.db's heading/context columns were seeded with a literal HTML entity
// (`&#x0027;`) in place of every apostrophe (e.g. "king&#x0027;s") rather than a real
// `'` — decode it here so the UI never has to. No other entities were found in these
// columns, so this stays a single targeted replace rather than a general HTML decoder.
function decodeTskeText<T extends string | null>(s: T): T {
  return (s == null ? s : (s.replace(/&#x0027;/gi, "'") as T))
}

function openTskeDb(): DB | null {
  if (tskeDb) return tskeDb
  const p = dataPath('tske_refs.db')
  if (!existsSync(p)) {
    return null
  }
  tskeDb = new (Database as any)(p, { readonly: true }) as DB
  return tskeDb
}

// Scripture cross-references parsed from Charles Taylor's Shepherd-of-Hermas footnotes.
// They live in hermas_taylor.db (the Taylor text DB) because they are keyed to Taylor's
// own versification, and so must only be shown when the Taylor translation is active.
let hermasTaylorDb: DB | null | undefined
function openHermasTaylorDb(): DB | null {
  if (hermasTaylorDb !== undefined) return hermasTaylorDb
  const p = dataPath('hermas_taylor.db')
  hermasTaylorDb = existsSync(p) ? (new (Database as any)(p, { readonly: true }) as DB) : null
  return hermasTaylorDb
}

// Cache compiled statements per DB instance so the per-chapter/per-verse refs
// queries aren't re-compiled on every navigation.
const _stmtCache = new WeakMap<object, Map<string, any>>()
function prep(database: DB, sql: string): any {
  let m = _stmtCache.get(database as unknown as object)
  if (!m) { m = new Map(); _stmtCache.set(database as unknown as object, m) }
  let s = m.get(sql)
  if (!s) { s = (database as any).prepare(sql); m.set(sql, s) }
  return s
}

// Batch-resolve verse texts for a set of (book, chapter, verse) targets in ONE
// query per ~300 rows, replacing the previous per-row `SELECT ... LIMIT 1` loop
// (up to ~150-200 statement executions for a dense chapter). Returns a map keyed
// by "book|chapter|verse" → text.
function fetchVerseTexts(tuples: Array<[string, number, number]>): Map<string, string> {
  const out = new Map<string, string>()
  const kjva = getTextDb('kjva') as DB | null
  if (!kjva || tuples.length === 0) return out

  const uniq = new Map<string, [string, number, number]>()
  for (const t of tuples) {
    const k = `${t[0]}|${t[1]}|${t[2]}`
    if (!uniq.has(k)) uniq.set(k, t)
  }
  const list = Array.from(uniq.values())

  // SQLite's default max host params is 999; 3 per row → chunk at 300 rows.
  const CHUNK = 300
  for (let i = 0; i < list.length; i += CHUNK) {
    const chunk = list.slice(i, i + CHUNK)
    const placeholders = chunk.map(() => '(?,?,?)').join(',')
    const params: unknown[] = []
    for (const [b, c, v] of chunk) params.push(b, c, v)
    const rows = (kjva as any).prepare(
      `SELECT book_id, chapter, verse_num, text FROM verses
       WHERE (book_id, chapter, verse_num) IN (VALUES ${placeholders})`
    ).all(...params) as Array<{ book_id: string; chapter: number; verse_num: number; text: string }>
    for (const r of rows) {
      const k = `${r.book_id}|${r.chapter}|${r.verse_num}`
      if (!out.has(k)) out.set(k, r.text)
    }
  }
  return out
}

// Plain-function versions of the two per-verse lookups below, exported so other
// main-process modules (electron/ipc/aiLookup.ts) can reuse the exact same
// cross_references.db / tske_refs.db access + text-resolution logic instead of
// re-implementing it. The IPC handlers further down just call these.
export function getCrossRefsForVerse(bookId: string, chapter: number, verse: number) {
  try {
    const database = openDb()
    if (!database) return { refs: [], loading: false, error: true }

    const rows = prep(database,
      'SELECT to_book, to_ch, to_vs, to_vs_end, votes FROM refs WHERE from_book = ? AND from_ch = ? AND from_vs = ? ORDER BY votes DESC LIMIT 150'
    ).all(bookId.toUpperCase(), chapter, verse) as Array<{
      to_book: string; to_ch: number; to_vs: number; to_vs_end: number | null; votes: number
    }>

    const texts = fetchVerseTexts(rows.map((r) => [r.to_book, r.to_ch, r.to_vs] as [string, number, number]))

    const refs = rows.map((r) => ({
      bookId: r.to_book,
      chapter: r.to_ch,
      verse: r.to_vs,
      endVerse: r.to_vs_end,
      votes: r.votes,
      text: texts.get(`${r.to_book}|${r.to_ch}|${r.to_vs}`) ?? '',
    }))

    return { refs, loading: false, error: false }
  } catch {
    return { refs: [], loading: false, error: true }
  }
}

export function getTskeForVerse(bookId: string, chapter: number, verse: number) {
  try {
    const database = openTskeDb()
    if (!database) return { groups: [], loading: false, error: true }

    const rows = prep(database,
      `SELECT heading, is_reciprocal, to_book, to_ch, to_vs, to_vs_end, sort_order, context
       FROM tske_refs
       WHERE from_book = ? AND from_ch = ? AND from_vs = ?
       ORDER BY is_reciprocal ASC, rowid ASC`
    ).all(bookId.toUpperCase(), chapter, verse) as Array<{
      heading: string | null; is_reciprocal: number
      to_book: string; to_ch: number; to_vs: number; to_vs_end: number | null
      sort_order: number; context: string | null
    }>

    const texts = fetchVerseTexts(rows.map((r) => [r.to_book, r.to_ch, r.to_vs] as [string, number, number]))

    const groupMap = new Map<string, {
      heading: string | null
      isReciprocal: boolean
      refs: Array<{ bookId: string; chapter: number; verse: number; endVerse: number | null; text: string; context: string | null }>
    }>()
    for (const r of rows) {
      const key = r.is_reciprocal ? '__RECIPROCAL__' : (r.heading ?? '__NONE__')
      if (!groupMap.has(key)) {
        groupMap.set(key, {
          heading: r.is_reciprocal ? null : decodeTskeText(r.heading),
          isReciprocal: r.is_reciprocal === 1,
          refs: [],
        })
      }
      const text = texts.get(`${r.to_book}|${r.to_ch}|${r.to_vs}`) ?? ''
      groupMap.get(key)!.refs.push({
        bookId: r.to_book,
        chapter: r.to_ch,
        verse: r.to_vs,
        endVerse: r.to_vs_end ?? null,
        text,
        context: decodeTskeText(r.context ?? null),
      })
    }

    return { groups: Array.from(groupMap.values()), loading: false, error: false }
  } catch {
    return { groups: [], loading: false, error: true }
  }
}

// ── Reverse direction: "what quotes/references verse X" (incoming), the opposite of
// getCrossRefsForVerse/getTskeForVerse above (which answer "what does verse X quote/reference",
// outgoing). Same tables, same ranking/grouping logic, just querying the `to_*` columns as the
// lookup key and reading the `from_*` columns as the result — the schema has no `from_vs_end`
// column (the FROM side of a row is always a single verse), so these are slightly simpler than
// their outgoing counterparts. Added for aiLookup.ts's reverse quote-lookup ("what verses quote
// Psalm 2:7" / "what quotes Psalm 2").
export function getIncomingCrossRefsForVerse(bookId: string, chapter: number, verse: number) {
  try {
    const database = openDb()
    if (!database) return { refs: [], loading: false, error: true }

    const rows = prep(database,
      'SELECT from_book, from_ch, from_vs, votes FROM refs WHERE to_book = ? AND to_ch = ? AND to_vs = ? ORDER BY votes DESC LIMIT 150'
    ).all(bookId.toUpperCase(), chapter, verse) as Array<{
      from_book: string; from_ch: number; from_vs: number; votes: number
    }>

    const texts = fetchVerseTexts(rows.map((r) => [r.from_book, r.from_ch, r.from_vs] as [string, number, number]))

    const refs = rows.map((r) => ({
      bookId: r.from_book,
      chapter: r.from_ch,
      verse: r.from_vs,
      endVerse: null as number | null,
      votes: r.votes,
      text: texts.get(`${r.from_book}|${r.from_ch}|${r.from_vs}`) ?? '',
    }))

    return { refs, loading: false, error: false }
  } catch {
    return { refs: [], loading: false, error: true }
  }
}

export function getIncomingTskeForVerse(bookId: string, chapter: number, verse: number) {
  try {
    const database = openTskeDb()
    if (!database) return { groups: [], loading: false, error: true }

    const rows = prep(database,
      `SELECT heading, is_reciprocal, from_book, from_ch, from_vs, sort_order, context
       FROM tske_refs
       WHERE to_book = ? AND to_ch = ? AND to_vs = ?
       ORDER BY is_reciprocal ASC, rowid ASC`
    ).all(bookId.toUpperCase(), chapter, verse) as Array<{
      heading: string | null; is_reciprocal: number
      from_book: string; from_ch: number; from_vs: number
      sort_order: number; context: string | null
    }>

    const texts = fetchVerseTexts(rows.map((r) => [r.from_book, r.from_ch, r.from_vs] as [string, number, number]))

    const groupMap = new Map<string, {
      heading: string | null
      isReciprocal: boolean
      refs: Array<{ bookId: string; chapter: number; verse: number; endVerse: number | null; text: string; context: string | null }>
    }>()
    for (const r of rows) {
      const key = r.is_reciprocal ? '__RECIPROCAL__' : (r.heading ?? '__NONE__')
      if (!groupMap.has(key)) {
        groupMap.set(key, {
          heading: r.is_reciprocal ? null : decodeTskeText(r.heading),
          isReciprocal: r.is_reciprocal === 1,
          refs: [],
        })
      }
      const text = texts.get(`${r.from_book}|${r.from_ch}|${r.from_vs}`) ?? ''
      groupMap.get(key)!.refs.push({
        bookId: r.from_book,
        chapter: r.from_ch,
        verse: r.from_vs,
        endVerse: null,
        text,
        context: decodeTskeText(r.context ?? null),
      })
    }

    return { groups: Array.from(groupMap.values()), loading: false, error: false }
  } catch {
    return { groups: [], loading: false, error: true }
  }
}

// ── TSKE heading search: bridges a TOPICAL question to real verses via TSKE's own human-
// curated `heading` column — a genuine topical index ("fear of the Lord", "a good
// understanding", ...) — WITHOUT requiring literal keyword overlap with the target verse's own
// text. See electron/ipc/aiLookup.ts's use of this as a retrieval SOURCE, not the pre-existing
// post-hoc decoration (getTskeForVerse above).
//
// tske_refs.db has no FTS index on `heading` (confirmed via `.schema tske_refs` — only
// idx_tske_from/idx_tske_to exist, neither covers `heading`), so this is a plain `LIKE`
// prefilter — confirmed via direct timing against the real 355k-row table that a single-keyword
// substring scan is ~35ms, comfortably inside this app's retrieval latency budget even across a
// handful of keywords — followed by a JS word-boundary re-check: `LIKE '%do%'` alone would also
// match "wisdom", which a bare substring scan can't tell apart from a real match on the word
// "do" (same discipline as aiLookup.ts's bridgeByGloss).
export interface TskeHeadingHit {
  heading: string
  fromBook: string; fromCh: number; fromVs: number
  toBook: string; toCh: number; toVs: number; toVsEnd: number | null
  sortOrder: number
}

// Reciprocal rows (is_reciprocal = 1) never carry a heading — see getTskeForVerse's own grouping
// (`r.is_reciprocal ? null : heading`) — excluded at the SQL level so the LIKE scan doesn't waste
// time over rows that can never match.
export function searchTskeHeadingsByKeywords(keywords: string[], limitPerKeyword = 60): TskeHeadingHit[] {
  const database = openTskeDb()
  if (!database || keywords.length === 0) return []
  const out: TskeHeadingHit[] = []
  const seenRow = new Set<string>()
  for (const kw of keywords) {
    const trimmed = kw.trim()
    // Same floor as bridgeByTransliteration/bridgeByGloss in aiLookup.ts — a 1-2 letter keyword
    // would match a huge share of headings and contribute nothing but noise.
    if (trimmed.length < 3) continue
    const likeParam = `%${trimmed.replace(/[%_\\]/g, '\\$&')}%`
    const rows = prep(database,
      `SELECT heading, from_book, from_ch, from_vs, to_book, to_ch, to_vs, to_vs_end, sort_order
       FROM tske_refs WHERE is_reciprocal = 0 AND heading LIKE ? ESCAPE '\\' ORDER BY sort_order ASC LIMIT ?`
    ).all(likeParam, limitPerKeyword) as Array<{
      heading: string | null; from_book: string; from_ch: number; from_vs: number
      to_book: string; to_ch: number; to_vs: number; to_vs_end: number | null; sort_order: number
    }>
    const wordBoundary = new RegExp(`\\b${trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i')
    for (const r of rows) {
      if (!r.heading) continue
      const heading = decodeTskeText(r.heading)
      if (!wordBoundary.test(heading)) continue
      const key = `${r.from_book}|${r.from_ch}|${r.from_vs}|${r.to_book}|${r.to_ch}|${r.to_vs}|${r.sort_order}`
      if (seenRow.has(key)) continue
      seenRow.add(key)
      out.push({
        heading,
        fromBook: r.from_book, fromCh: r.from_ch, fromVs: r.from_vs,
        toBook: r.to_book, toCh: r.to_ch, toVs: r.to_vs, toVsEnd: r.to_vs_end,
        sortOrder: r.sort_order,
      })
    }
  }
  return out
}

export function registerCrossRefsHandlers(ipcMain: IpcMain): void {
  ipcMain.handle('crossrefs:status', () => {
    const hasData = existsSync(dataPath('cross_references.db'))
    return { hasData, loading: false, error: !hasData }
  })

  // `textId` (default 'kjva') is the translation currently on screen for `bookId`/`chapter`.
  // cross_references.db is keyed to KJV chapter numbers, so a chapter viewed in LXX numbering
  // must be translated to its KJV-equivalent chapter(s) before querying — `toCanonicalChapters`
  // is a no-op for every book/text this doesn't apply to (see translationChapterMap.ts). An LXX
  // merge chapter (e.g. Psalm 9 = KJV 9+10) maps to TWO KJV chapters, so the query spans both via
  // `from_ch IN (...)` and results from both are grouped together by verse number — see that
  // module's comment on why grouping key collisions there are an accepted simplification.
  ipcMain.handle('crossrefs:getForChapter', (_e, bookId: string, chapter: number, textId = 'kjva') => {
    try {
      const database = openDb()
      if (!database) return { verseRefs: [], error: true }

      const chapters = toCanonicalChapters(bookId, chapter, textId)
      const placeholders = chapters.map(() => '?').join(',')
      const rows = prep(database,
        `SELECT from_vs, to_book, to_ch, to_vs, to_vs_end, votes FROM refs WHERE from_book = ? AND from_ch IN (${placeholders}) ORDER BY from_vs ASC, votes DESC`
      ).all(bookId.toUpperCase(), ...chapters) as Array<{
        from_vs: number; to_book: string; to_ch: number; to_vs: number; to_vs_end: number | null; votes: number
      }>

      const texts = fetchVerseTexts(rows.map((r) => [r.to_book, r.to_ch, r.to_vs] as [string, number, number]))

      // Group by source verse
      const grouped = new Map<number, Array<{ bookId: string; chapter: number; verse: number; endVerse: number | null; votes: number; text: string }>>()
      for (const r of rows) {
        if (!grouped.has(r.from_vs)) grouped.set(r.from_vs, [])
        const text = texts.get(`${r.to_book}|${r.to_ch}|${r.to_vs}`) ?? ''
        grouped.get(r.from_vs)!.push({ bookId: r.to_book, chapter: r.to_ch, verse: r.to_vs, endVerse: r.to_vs_end ?? null, votes: r.votes, text })
      }

      const verseRefs = Array.from(grouped.entries())
        .sort((a, b) => a[0] - b[0])
        .map(([verseNum, refs]) => ({ verseNum, refs }))

      return { verseRefs, error: false }
    } catch (e) {
      return { verseRefs: [], error: true }
    }
  })

  ipcMain.handle('crossrefs:getTSKeForChapter', (_e, bookId: string, chapter: number, textId = 'kjva') => {
    try {
      const database = openTskeDb()
      if (!database) return { verseRefs: [], error: true }

      const chapters = toCanonicalChapters(bookId, chapter, textId)
      const placeholders = chapters.map(() => '?').join(',')
      const rows = prep(database,
        `SELECT from_vs, heading, is_reciprocal, to_book, to_ch, to_vs, to_vs_end, sort_order, context
         FROM tske_refs
         WHERE from_book = ? AND from_ch IN (${placeholders})
         ORDER BY from_vs ASC, is_reciprocal ASC, rowid ASC`
      ).all(bookId.toUpperCase(), ...chapters) as Array<{
        from_vs: number; heading: string | null; is_reciprocal: number
        to_book: string; to_ch: number; to_vs: number; to_vs_end: number | null
        sort_order: number; context: string | null
      }>

      const texts = fetchVerseTexts(rows.map((r) => [r.to_book, r.to_ch, r.to_vs] as [string, number, number]))

      // Group by source verse, then by heading within each verse
      const byVerse = new Map<number, Map<string, { heading: string | null; isReciprocal: boolean; refs: any[] }>>()
      for (const r of rows) {
        if (!byVerse.has(r.from_vs)) byVerse.set(r.from_vs, new Map())
        const verseMap = byVerse.get(r.from_vs)!
        const key = r.is_reciprocal ? '__RECIPROCAL__' : (r.heading ?? '__NONE__')
        if (!verseMap.has(key)) verseMap.set(key, { heading: r.is_reciprocal ? null : decodeTskeText(r.heading), isReciprocal: r.is_reciprocal === 1, refs: [] })
        const text = texts.get(`${r.to_book}|${r.to_ch}|${r.to_vs}`) ?? ''
        verseMap.get(key)!.refs.push({ bookId: r.to_book, chapter: r.to_ch, verse: r.to_vs, endVerse: r.to_vs_end ?? null, text, context: decodeTskeText(r.context ?? null) })
      }

      const verseRefs = Array.from(byVerse.entries())
        .sort((a, b) => a[0] - b[0])
        .map(([verseNum, groupMap]) => ({ verseNum, groups: Array.from(groupMap.values()) }))

      return { verseRefs, error: false }
    } catch (e) {
      return { verseRefs: [], error: true }
    }
  })

  // Taylor Hermas footnote cross-references for a chapter (chapter-level: from_verse = 0).
  ipcMain.handle('crossrefs:getHermasTaylorChapter', (_e, bookId: string, chapter: number) => {
    try {
      const database = openHermasTaylorDb()
      if (!database) return { refs: [], error: true }
      const rows = prep(database,
        'SELECT to_book, to_chapter, to_verse, raw FROM crossrefs WHERE from_book = ? AND from_chapter = ? ORDER BY id ASC'
      ).all(bookId.toUpperCase(), chapter) as Array<{
        to_book: string; to_chapter: number; to_verse: number; raw: string
      }>
      const texts = fetchVerseTexts(rows.map((r) => [r.to_book, r.to_chapter, r.to_verse] as [string, number, number]))
      const refs = rows.map((r) => ({
        bookId: r.to_book, chapter: r.to_chapter, verse: r.to_verse, raw: r.raw,
        text: texts.get(`${r.to_book}|${r.to_chapter}|${r.to_verse}`) ?? '',
      }))
      return { refs, error: false }
    } catch {
      return { refs: [], error: true }
    }
  })

  // `textId` (default 'kjva') maps the on-screen chapter to its KJV-equivalent chapter(s) —
  // see the getForChapter/getTSKeForChapter comment above. For a merge chapter (two KJV
  // chapters), verse numbers are queried as-is against each candidate chapter and the
  // (usually mutually-exclusive) hits are unioned/de-duped; this is the same accepted
  // simplification as the chapter-level handlers, since verse-level splits are not tracked.
  ipcMain.handle('crossrefs:getForVerse', (_e, bookId: string, chapter: number, verse: number, textId = 'kjva') => {
    const chapters = toCanonicalChapters(bookId, chapter, textId)
    if (chapters.length === 1) return getCrossRefsForVerse(bookId, chapters[0], verse)

    const results = chapters.map((ch) => getCrossRefsForVerse(bookId, ch, verse))
    const seen = new Set<string>()
    const refs: ReturnType<typeof getCrossRefsForVerse>['refs'] = []
    for (const res of results) {
      for (const r of res.refs) {
        const key = `${r.bookId}|${r.chapter}|${r.verse}|${r.endVerse ?? ''}`
        if (!seen.has(key)) { seen.add(key); refs.push(r) }
      }
    }
    return { refs, loading: false, error: results.every((r) => r.error) }
  })

  ipcMain.handle('crossrefs:getTSKeForVerse', (_e, bookId: string, chapter: number, verse: number, textId = 'kjva') => {
    const chapters = toCanonicalChapters(bookId, chapter, textId)
    if (chapters.length === 1) return getTskeForVerse(bookId, chapters[0], verse)

    const results = chapters.map((ch) => getTskeForVerse(bookId, ch, verse))
    const groupMap = new Map<string, { heading: string | null; isReciprocal: boolean; refs: ReturnType<typeof getTskeForVerse>['groups'][number]['refs'] }>()
    for (const res of results) {
      for (const g of res.groups) {
        const key = g.isReciprocal ? '__RECIPROCAL__' : (g.heading ?? '__NONE__')
        if (!groupMap.has(key)) groupMap.set(key, { heading: g.heading, isReciprocal: g.isReciprocal, refs: [] })
        const target = groupMap.get(key)!
        for (const r of g.refs) {
          const rKey = `${r.bookId}|${r.chapter}|${r.verse}|${r.endVerse ?? ''}`
          if (!target.refs.some((x) => `${x.bookId}|${x.chapter}|${x.verse}|${x.endVerse ?? ''}` === rKey)) target.refs.push(r)
        }
      }
    }
    return { groups: Array.from(groupMap.values()), loading: false, error: results.every((r) => r.error) }
  })
}
