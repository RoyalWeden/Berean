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
    console.warn('[crossrefs] cross_references.db not found at', p)
    return null
  }
  db = new (Database as any)(p, { readonly: true }) as DB
  return db
}

function openTskeDb(): DB | null {
  if (tskeDb) return tskeDb
  const p = dataPath('tske_refs.db')
  if (!existsSync(p)) {
    console.warn('[crossrefs] tske_refs.db not found at', p)
    return null
  }
  tskeDb = new (Database as any)(p, { readonly: true }) as DB
  return tskeDb
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

      const rows = (database as any).prepare(
        'SELECT from_vs, to_book, to_ch, to_vs, to_vs_end, votes FROM refs WHERE from_book = ? AND from_ch = ? ORDER BY from_vs ASC, votes DESC'
      ).all(bookId.toUpperCase(), chapter) as Array<{
        from_vs: number; to_book: string; to_ch: number; to_vs: number; to_vs_end: number | null; votes: number
      }>

      const kjva = getTextDb('kjva')
      const verseStmt = kjva
        ? (kjva as any).prepare('SELECT text FROM verses WHERE book_id = ? AND chapter = ? AND verse_num = ? LIMIT 1')
        : null

      // Group by source verse
      const grouped = new Map<number, Array<{ bookId: string; chapter: number; verse: number; endVerse: number | null; votes: number; text: string }>>()
      for (const r of rows) {
        if (!grouped.has(r.from_vs)) grouped.set(r.from_vs, [])
        const text: string = verseStmt ? ((verseStmt.get(r.to_book, r.to_ch, r.to_vs) as any)?.text ?? '') : ''
        grouped.get(r.from_vs)!.push({ bookId: r.to_book, chapter: r.to_ch, verse: r.to_vs, endVerse: r.to_vs_end ?? null, votes: r.votes, text })
      }

      const verseRefs = Array.from(grouped.entries())
        .sort((a, b) => a[0] - b[0])
        .map(([verseNum, refs]) => ({ verseNum, refs }))

      return { verseRefs, error: false }
    } catch (e) {
      console.error('[crossrefs:getForChapter]', e)
      return { verseRefs: [], error: true }
    }
  })

  ipcMain.handle('crossrefs:getTSKeForChapter', (_e, bookId: string, chapter: number) => {
    try {
      const database = openTskeDb()
      if (!database) return { verseRefs: [], error: true }

      const rows = (database as any).prepare(
        `SELECT from_vs, heading, is_reciprocal, to_book, to_ch, to_vs, to_vs_end, sort_order, context
         FROM tske_refs
         WHERE from_book = ? AND from_ch = ?
         ORDER BY from_vs ASC, is_reciprocal ASC, rowid ASC`
      ).all(bookId.toUpperCase(), chapter) as Array<{
        from_vs: number; heading: string | null; is_reciprocal: number
        to_book: string; to_ch: number; to_vs: number; to_vs_end: number | null
        sort_order: number; context: string | null
      }>

      const kjva = getTextDb('kjva')
      const verseStmt = kjva
        ? (kjva as any).prepare('SELECT text FROM verses WHERE book_id = ? AND chapter = ? AND verse_num = ? LIMIT 1')
        : null

      // Group by source verse, then by heading within each verse
      const byVerse = new Map<number, Map<string, { heading: string | null; isReciprocal: boolean; refs: any[] }>>()
      for (const r of rows) {
        if (!byVerse.has(r.from_vs)) byVerse.set(r.from_vs, new Map())
        const verseMap = byVerse.get(r.from_vs)!
        const key = r.is_reciprocal ? '__RECIPROCAL__' : (r.heading ?? '__NONE__')
        if (!verseMap.has(key)) verseMap.set(key, { heading: r.is_reciprocal ? null : r.heading, isReciprocal: r.is_reciprocal === 1, refs: [] })
        const text: string = verseStmt ? ((verseStmt.get(r.to_book, r.to_ch, r.to_vs) as any)?.text ?? '') : ''
        verseMap.get(key)!.refs.push({ bookId: r.to_book, chapter: r.to_ch, verse: r.to_vs, endVerse: r.to_vs_end ?? null, text, context: r.context ?? null })
      }

      const verseRefs = Array.from(byVerse.entries())
        .sort((a, b) => a[0] - b[0])
        .map(([verseNum, groupMap]) => ({ verseNum, groups: Array.from(groupMap.values()) }))

      return { verseRefs, error: false }
    } catch (e) {
      console.error('[crossrefs:getTSKeForChapter]', e)
      return { verseRefs: [], error: true }
    }
  })

  ipcMain.handle('crossrefs:getForVerse', (_e, bookId: string, chapter: number, verse: number) => {
    try {
      const database = openDb()
      if (!database) return { refs: [], loading: false, error: true }

      const rows = (database as any).prepare(
        'SELECT to_book, to_ch, to_vs, to_vs_end, votes FROM refs WHERE from_book = ? AND from_ch = ? AND from_vs = ? ORDER BY votes DESC LIMIT 150'
      ).all(bookId.toUpperCase(), chapter, verse) as Array<{
        to_book: string; to_ch: number; to_vs: number; to_vs_end: number | null; votes: number
      }>

      const kjva = getTextDb('kjva')
      const verseStmt = kjva
        ? (kjva as any).prepare('SELECT text FROM verses WHERE book_id = ? AND chapter = ? AND verse_num = ? LIMIT 1')
        : null

      const refs = rows.map((r) => {
        const text: string = verseStmt
          ? ((verseStmt.get(r.to_book, r.to_ch, r.to_vs) as any)?.text ?? '')
          : ''
        return {
          bookId: r.to_book,
          chapter: r.to_ch,
          verse: r.to_vs,
          endVerse: r.to_vs_end,
          votes: r.votes,
          text,
        }
      })

      return { refs, loading: false, error: false }
    } catch (e) {
      console.error('[crossrefs:getForVerse]', e)
      return { refs: [], loading: false, error: true }
    }
  })

  ipcMain.handle('crossrefs:getTSKeForVerse', (_e, bookId: string, chapter: number, verse: number) => {
    try {
      const database = openTskeDb()
      if (!database) return { groups: [], loading: false, error: true }

      const rows = (database as any).prepare(
        `SELECT heading, is_reciprocal, to_book, to_ch, to_vs, to_vs_end, sort_order, context
         FROM tske_refs
         WHERE from_book = ? AND from_ch = ? AND from_vs = ?
         ORDER BY is_reciprocal ASC, rowid ASC`
      ).all(bookId.toUpperCase(), chapter, verse) as Array<{
        heading: string | null
        is_reciprocal: number
        to_book: string
        to_ch: number
        to_vs: number
        to_vs_end: number | null
        sort_order: number
        context: string | null
      }>

      const kjva = getTextDb('kjva')
      const verseStmt = kjva
        ? (kjva as any).prepare('SELECT text FROM verses WHERE book_id = ? AND chapter = ? AND verse_num = ? LIMIT 1')
        : null

      // Group by heading (preserving order)
      const groupMap = new Map<string, {
        heading: string | null
        isReciprocal: boolean
        refs: Array<{ bookId: string; chapter: number; verse: number; endVerse: number | null; text: string; context: string | null }>
      }>()

      for (const r of rows) {
        const key = r.is_reciprocal ? '__RECIPROCAL__' : (r.heading ?? '__NONE__')
        if (!groupMap.has(key)) {
          groupMap.set(key, {
            heading: r.is_reciprocal ? null : r.heading,
            isReciprocal: r.is_reciprocal === 1,
            refs: [],
          })
        }
        const text: string = verseStmt
          ? ((verseStmt.get(r.to_book, r.to_ch, r.to_vs) as any)?.text ?? '')
          : ''
        groupMap.get(key)!.refs.push({
          bookId: r.to_book,
          chapter: r.to_ch,
          verse: r.to_vs,
          endVerse: r.to_vs_end ?? null,
          text,
          context: r.context ?? null,
        })
      }

      const groups = Array.from(groupMap.values())
      return { groups, loading: false, error: false }
    } catch (e) {
      console.error('[crossrefs:getTSKeForVerse]', e)
      return { groups: [], loading: false, error: true }
    }
  })
}
