import type { Note } from '@/types'
import { bookName } from '@/lib/parseRef'
import { displayChapter } from '@/lib/chapterNumbering'
import { extractRefsFromNote, type NoteVerseRef } from '@/lib/noteRefs'
import { getChapterNotesShared, searchNotesShared } from '@/lib/panelDataCache'

export interface VerseNoteRefs { verseNum: number; refs: NoteVerseRef[] }
export interface IndirectNoteMention { note: Note; verses: number[] }
export interface ChapterNoteCrossRefs { byVerse: VerseNoteRefs[]; indirect: IndirectNoteMention[] }

/**
 * "My Notes" cross references for a chapter — the references the user's own notes make
 * (shared by the desktop side panel and the iPhone verse sheet):
 *   1. verse notes attached to a verse of this chapter → every passage those notes mention;
 *   2. verse notes on OTHER verses whose text mentions a verse of this chapter → that note's
 *      verse (and the passages it mentions) as a cross reference of the mentioned verse;
 *   3. general / daily / topic notes that mention the chapter → "indirect" mentions, kept apart
 *      because the connection may be indirect.
 */
export async function loadChapterNoteCrossRefs(bookId: string, chapter: number, textId: string, token: number): Promise<ChapterNoteCrossRefs> {
  const byVerse = new Map<number, NoteVerseRef[]>()
  const indirect: IndirectNoteMention[] = []

  const mergeNoteRefs = (note: Note, verseNum: number) => {
    const extracted = extractRefsFromNote(note.content, note.title || 'Untitled')
    if (extracted.length === 0) return
    if (!byVerse.has(verseNum)) byVerse.set(verseNum, [])
    const existing = byVerse.get(verseNum)!
    for (const ref of extracted) {
      if (ref.bookId === bookId && ref.chapter === chapter && ref.verse === verseNum) continue
      if (!existing.some((r) => r.bookId === ref.bookId && r.chapter === ref.chapter && r.verse === ref.verse)) existing.push(ref)
    }
  }
  const mergeVerseRef = (verseRefStr: string, verseNum: number, sourceTitle: string) => {
    const [nbId, ch, vs] = verseRefStr.split('.')
    const nCh = parseInt(ch ?? '0', 10)
    const nVs = parseInt(vs ?? '0', 10)
    if (!nbId || !nCh || !nVs) return
    if (!byVerse.has(verseNum)) byVerse.set(verseNum, [])
    const arr = byVerse.get(verseNum)!
    if (!arr.some((x) => x.bookId === nbId && x.chapter === nCh && x.verse === nVs)) arr.push({ bookId: nbId, chapter: nCh, verse: nVs, sourceNoteTitle: sourceTitle, context: '' } as NoteVerseRef)
  }

  const verseNotes = await getChapterNotesShared(bookId, chapter, token, textId)
  for (const note of verseNotes) {
    const vn = parseInt((note.verseRef ?? '').split('.')[2] ?? '0', 10)
    if (vn) mergeNoteRefs(note, vn)
  }
  const chapterLabel = `${bookName(bookId)} ${displayChapter(bookId, chapter)}:`
  try {
    const candidates = await searchNotesShared(chapterLabel, 80, token)
    const verseNoteIds = new Set(verseNotes.map((n) => n.id))
    for (const note of candidates) {
      if (verseNoteIds.has(note.id)) continue
      const chapterRefs = extractRefsFromNote(note.content, note.title || '').filter((r) => r.bookId === bookId && r.chapter === chapter)
      if (chapterRefs.length === 0) continue
      if (note.verseRef) {
        for (const r of chapterRefs) {
          mergeVerseRef(note.verseRef, r.verse, note.title || 'Untitled')
          mergeNoteRefs(note, r.verse)
        }
      } else {
        const verses = [...new Set(chapterRefs.map((r) => r.verse).filter((v) => v > 0))].sort((a, b) => a - b)
        if (!indirect.some((x) => x.note.id === note.id)) indirect.push({ note, verses })
      }
    }
  } catch { /* search unavailable: direct refs only */ }

  return {
    byVerse: Array.from(byVerse.entries()).sort((a, b) => a[0] - b[0]).map(([verseNum, refs]) => ({ verseNum, refs })),
    indirect,
  }
}

/** Keep only the given verses (all of them when `verses` is empty) — the selected-verse filter. */
export function filterNoteCrossRefs(data: ChapterNoteCrossRefs, verses: readonly number[]): ChapterNoteCrossRefs {
  if (!verses.length) return data
  const want = new Set(verses)
  return {
    byVerse: data.byVerse.filter((v) => want.has(v.verseNum)),
    indirect: data.indirect.filter((m) => m.verses.some((v) => want.has(v))),
  }
}
