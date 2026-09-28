import type { DatabaseAdapter } from '../db/DatabaseAdapter'
import { placeholders } from '../db/DatabaseAdapter'
import type { ServiceContext } from './context'
import { toCanonicalChapters } from '../../lib/translationChapterMap'

/**
 * Cross references (native cross_references.db, TSKe tske_refs.db, Taylor-Hermas footnotes) —
 * extracted verbatim from electron/ipc/crossrefs.ts (Phase 1/3). The desktop file keeps its
 * synchronous helpers for electron/ipc/aiLookup.ts; the IPC channels delegate here.
 */

export interface CrossRef { bookId: string; chapter: number; verse: number; endVerse: number | null; votes: number; text: string }
export interface TskeRef { bookId: string; chapter: number; verse: number; endVerse: number | null; text: string; context: string | null }
export interface TskeGroup { heading: string | null; isReciprocal: boolean; refs: TskeRef[] }

// tske_refs.db's heading/context columns were seeded with a literal HTML entity
// (`&#x0027;`) in place of every apostrophe (e.g. "king&#x0027;s") rather than a real
// `'` — decode it here so the UI never has to. No other entities were found in these
// columns, so this stays a single targeted replace rather than a general HTML decoder.
export function decodeTskeText<T extends string | null>(s: T): T {
  return (s == null ? s : (s.replace(/&#x0027;/gi, "'") as T))
}

export function createCrossrefsService(ctx: ServiceContext) {
  const openDb = () => ctx.dataDb('cross_references')
  const openTskeDb = () => ctx.dataDb('tske_refs')
  const openHermasTaylorDb = () => ctx.dataDb('hermas_taylor')

  // Batch-resolve verse texts for a set of (book, chapter, verse) targets in ONE
  // query per ~300 rows, replacing the previous per-row `SELECT ... LIMIT 1` loop
  // (up to ~150-200 statement executions for a dense chapter). Returns a map keyed
  // by "book|chapter|verse" → text.
  async function fetchVerseTexts(tuples: Array<[string, number, number]>): Promise<Map<string, string>> {
    const out = new Map<string, string>()
    const kjva = await ctx.textDb('kjva')
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
      const values = chunk.map(() => '(?,?,?)').join(',')
      const params: Array<string | number> = []
      for (const [b, c, v] of chunk) params.push(b, c, v)
      const rows = await kjva.all<{ book_id: string; chapter: number; verse_num: number; text: string }>(
        `SELECT book_id, chapter, verse_num, text FROM verses
       WHERE (book_id, chapter, verse_num) IN (VALUES ${values})`, params)
      for (const r of rows) {
        const k = `${r.book_id}|${r.chapter}|${r.verse_num}`
        if (!out.has(k)) out.set(k, r.text)
      }
    }
    return out
  }

  async function getCrossRefsForVerse(bookId: string, chapter: number, verse: number): Promise<{ refs: CrossRef[]; loading: false; error: boolean }> {
    try {
      const database = await openDb()
      if (!database) return { refs: [], loading: false, error: true }

      const rows = await database.all<{ to_book: string; to_ch: number; to_vs: number; to_vs_end: number | null; votes: number }>(
        'SELECT to_book, to_ch, to_vs, to_vs_end, votes FROM refs WHERE from_book = ? AND from_ch = ? AND from_vs = ? ORDER BY votes DESC LIMIT 150',
        [bookId.toUpperCase(), chapter, verse])

      const texts = await fetchVerseTexts(rows.map((r) => [r.to_book, r.to_ch, r.to_vs] as [string, number, number]))

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

  async function getTskeForVerse(bookId: string, chapter: number, verse: number): Promise<{ groups: TskeGroup[]; loading: false; error: boolean }> {
    try {
      const database = await openTskeDb()
      if (!database) return { groups: [], loading: false, error: true }

      const rows = await database.all<{
        heading: string | null; is_reciprocal: number
        to_book: string; to_ch: number; to_vs: number; to_vs_end: number | null
        sort_order: number; context: string | null
      }>(`SELECT heading, is_reciprocal, to_book, to_ch, to_vs, to_vs_end, sort_order, context
       FROM tske_refs
       WHERE from_book = ? AND from_ch = ? AND from_vs = ?
       ORDER BY is_reciprocal ASC, rowid ASC`, [bookId.toUpperCase(), chapter, verse])

      const texts = await fetchVerseTexts(rows.map((r) => [r.to_book, r.to_ch, r.to_vs] as [string, number, number]))

      const groupMap = new Map<string, TskeGroup>()
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

  async function status(): Promise<{ hasData: boolean; loading: false; error: boolean }> {
    const hasData = (await openDb()) !== null
    return { hasData, loading: false, error: !hasData }
  }

  // `textId` (default 'kjva') is the translation currently on screen for `bookId`/`chapter`.
  // cross_references.db is keyed to KJV chapter numbers, so a chapter viewed in LXX numbering
  // must be translated to its KJV-equivalent chapter(s) before querying — `toCanonicalChapters`
  // is a no-op for every book/text this doesn't apply to (see translationChapterMap.ts). An LXX
  // merge chapter (e.g. Psalm 9 = KJV 9+10) maps to TWO KJV chapters, so the query spans both via
  // `from_ch IN (...)` and results from both are grouped together by verse number — see that
  // module's comment on why grouping key collisions there are an accepted simplification.
  async function getForChapter(bookId: string, chapter: number, textId = 'kjva') {
    try {
      const database = await openDb()
      if (!database) return { verseRefs: [] as Array<{ verseNum: number; refs: CrossRef[] }>, error: true }

      const chapters = toCanonicalChapters(bookId, chapter, textId)
      const rows = await database.all<{ from_vs: number; to_book: string; to_ch: number; to_vs: number; to_vs_end: number | null; votes: number }>(
        `SELECT from_vs, to_book, to_ch, to_vs, to_vs_end, votes FROM refs WHERE from_book = ? AND from_ch IN (${placeholders(chapters.length)}) ORDER BY from_vs ASC, votes DESC`,
        [bookId.toUpperCase(), ...chapters])

      const texts = await fetchVerseTexts(rows.map((r) => [r.to_book, r.to_ch, r.to_vs] as [string, number, number]))

      // Group by source verse
      const grouped = new Map<number, CrossRef[]>()
      for (const r of rows) {
        if (!grouped.has(r.from_vs)) grouped.set(r.from_vs, [])
        const text = texts.get(`${r.to_book}|${r.to_ch}|${r.to_vs}`) ?? ''
        grouped.get(r.from_vs)!.push({ bookId: r.to_book, chapter: r.to_ch, verse: r.to_vs, endVerse: r.to_vs_end ?? null, votes: r.votes, text })
      }

      const verseRefs = Array.from(grouped.entries())
        .sort((a, b) => a[0] - b[0])
        .map(([verseNum, refs]) => ({ verseNum, refs }))

      return { verseRefs, error: false }
    } catch {
      return { verseRefs: [] as Array<{ verseNum: number; refs: CrossRef[] }>, error: true }
    }
  }

  async function getTSKeForChapter(bookId: string, chapter: number, textId = 'kjva') {
    try {
      const database = await openTskeDb()
      if (!database) return { verseRefs: [] as Array<{ verseNum: number; groups: TskeGroup[] }>, error: true }

      const chapters = toCanonicalChapters(bookId, chapter, textId)
      const rows = await database.all<{
        from_vs: number; heading: string | null; is_reciprocal: number
        to_book: string; to_ch: number; to_vs: number; to_vs_end: number | null
        sort_order: number; context: string | null
      }>(`SELECT from_vs, heading, is_reciprocal, to_book, to_ch, to_vs, to_vs_end, sort_order, context
         FROM tske_refs
         WHERE from_book = ? AND from_ch IN (${placeholders(chapters.length)})
         ORDER BY from_vs ASC, is_reciprocal ASC, rowid ASC`, [bookId.toUpperCase(), ...chapters])

      const texts = await fetchVerseTexts(rows.map((r) => [r.to_book, r.to_ch, r.to_vs] as [string, number, number]))

      // Group by source verse, then by heading within each verse
      const byVerse = new Map<number, Map<string, TskeGroup>>()
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
    } catch {
      return { verseRefs: [] as Array<{ verseNum: number; groups: TskeGroup[] }>, error: true }
    }
  }

  // Taylor Hermas footnote cross-references for a chapter (chapter-level: from_verse = 0).
  async function getHermasTaylorChapter(bookId: string, chapter: number) {
    try {
      const database = await openHermasTaylorDb()
      if (!database) return { refs: [] as Array<{ bookId: string; chapter: number; verse: number; raw: string; text: string }>, error: true }
      const rows = await database.all<{ to_book: string; to_chapter: number; to_verse: number; raw: string }>(
        'SELECT to_book, to_chapter, to_verse, raw FROM crossrefs WHERE from_book = ? AND from_chapter = ? ORDER BY id ASC',
        [bookId.toUpperCase(), chapter])
      const texts = await fetchVerseTexts(rows.map((r) => [r.to_book, r.to_chapter, r.to_verse] as [string, number, number]))
      const refs = rows.map((r) => ({
        bookId: r.to_book, chapter: r.to_chapter, verse: r.to_verse, raw: r.raw,
        text: texts.get(`${r.to_book}|${r.to_chapter}|${r.to_verse}`) ?? '',
      }))
      return { refs, error: false }
    } catch {
      return { refs: [] as Array<{ bookId: string; chapter: number; verse: number; raw: string; text: string }>, error: true }
    }
  }

  // `textId` (default 'kjva') maps the on-screen chapter to its KJV-equivalent chapter(s) —
  // see the getForChapter/getTSKeForChapter comment above. For a merge chapter (two KJV
  // chapters), verse numbers are queried as-is against each candidate chapter and the
  // (usually mutually-exclusive) hits are unioned/de-duped; this is the same accepted
  // simplification as the chapter-level handlers, since verse-level splits are not tracked.
  async function getForVerse(bookId: string, chapter: number, verse: number, textId = 'kjva') {
    const chapters = toCanonicalChapters(bookId, chapter, textId)
    if (chapters.length === 1) return getCrossRefsForVerse(bookId, chapters[0], verse)

    const results: Array<{ refs: CrossRef[]; loading: false; error: boolean }> = []
    for (const ch of chapters) results.push(await getCrossRefsForVerse(bookId, ch, verse))
    const seen = new Set<string>()
    const refs: CrossRef[] = []
    for (const res of results) {
      for (const r of res.refs) {
        const key = `${r.bookId}|${r.chapter}|${r.verse}|${r.endVerse ?? ''}`
        if (!seen.has(key)) { seen.add(key); refs.push(r) }
      }
    }
    return { refs, loading: false as const, error: results.every((r) => r.error) }
  }

  async function getTSKeForVerse(bookId: string, chapter: number, verse: number, textId = 'kjva') {
    const chapters = toCanonicalChapters(bookId, chapter, textId)
    if (chapters.length === 1) return getTskeForVerse(bookId, chapters[0], verse)

    const results: Array<{ groups: TskeGroup[]; loading: false; error: boolean }> = []
    for (const ch of chapters) results.push(await getTskeForVerse(bookId, ch, verse))
    const groupMap = new Map<string, TskeGroup>()
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
    return { groups: Array.from(groupMap.values()), loading: false as const, error: results.every((r) => r.error) }
  }

  return { status, getForChapter, getTSKeForChapter, getHermasTaylorChapter, getForVerse, getTSKeForVerse, getCrossRefsForVerse, getTskeForVerse }
}

export type CrossrefsService = ReturnType<typeof createCrossrefsService>
