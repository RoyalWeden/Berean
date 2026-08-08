import type { IpcMain } from 'electron'
import { app } from 'electron'
import { join } from 'path'
import { existsSync } from 'fs'
import Database from 'better-sqlite3'
import { getTextDb } from '../db/bible'

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

export function registerCrossRefsHandlers(ipcMain: IpcMain): void {
  ipcMain.handle('crossrefs:status', () => {
    const hasData = existsSync(dataPath('cross_references.db'))
    return { hasData, loading: false, error: !hasData }
  })

  ipcMain.handle('crossrefs:getForChapter', (_e, bookId: string, chapter: number) => {
    try {
      const database = openDb()
      if (!database) return { verseRefs: [], error: true }

      const rows = prep(database,
        'SELECT from_vs, to_book, to_ch, to_vs, to_vs_end, votes FROM refs WHERE from_book = ? AND from_ch = ? ORDER BY from_vs ASC, votes DESC'
      ).all(bookId.toUpperCase(), chapter) as Array<{
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

  ipcMain.handle('crossrefs:getTSKeForChapter', (_e, bookId: string, chapter: number) => {
    try {
      const database = openTskeDb()
      if (!database) return { verseRefs: [], error: true }

      const rows = prep(database,
        `SELECT from_vs, heading, is_reciprocal, to_book, to_ch, to_vs, to_vs_end, sort_order, context
         FROM tske_refs
         WHERE from_book = ? AND from_ch = ?
         ORDER BY from_vs ASC, is_reciprocal ASC, rowid ASC`
      ).all(bookId.toUpperCase(), chapter) as Array<{
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

  ipcMain.handle('crossrefs:getForVerse', (_e, bookId: string, chapter: number, verse: number) =>
    getCrossRefsForVerse(bookId, chapter, verse))

  ipcMain.handle('crossrefs:getTSKeForVerse', (_e, bookId: string, chapter: number, verse: number) =>
    getTskeForVerse(bookId, chapter, verse))
}
