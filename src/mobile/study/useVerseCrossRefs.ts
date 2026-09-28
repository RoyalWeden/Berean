import { useEffect, useState } from 'react'
import { useAppStore } from '@/store'
import { filterNoteCrossRefs, loadChapterNoteCrossRefs } from '@/lib/notesCrossRefs'
import { displayNoteTitle } from '@/lib/noteTitle'

export type CrossRefSourceId = 'tske' | 'classic' | 'notes'
export interface XRef { bookId: string; chapter: number; verse: number; endVerse?: number | null; text?: string; votes?: number; lxx?: boolean; noteTitle?: string }
/** `mentions`: titles of general notes that mention the verse (My Notes — possibly indirect). */
export interface XRefGroup { heading?: string; reciprocal?: boolean; refs: XRef[]; mentions?: string[] }
/** One selected verse's cross references, in the source's own grouping. */
export interface VerseXRefs { verse: number; groups: XRefGroup[] }

/**
 * Cross references for one or several verses of a chapter from one source (SEP25): TSK/e
 * (grouped by heading), Classic (votes) or My Notes (the references the user's own notes make —
 * the same source as the desktop side panel's "My Notes"). Several verses → one entry per verse,
 * in verse order (the desktop's multi-verse formatting). `null` while loading.
 */
export function useVerseCrossRefs(bookId: string, chapter: number, verses: readonly number[], textId: string, source: CrossRefSourceId): VerseXRefs[] | null {
  const [data, setData] = useState<VerseXRefs[] | null>(null)
  const token = useAppStore((s) => s.noteChangeToken)
  const key = [...verses].sort((a, b) => a - b).join(',')
  useEffect(() => {
    let alive = true
    setData(null)
    const vs = key ? key.split(',').map(Number) : []
    const run = async (): Promise<VerseXRefs[]> => {
      if (source === 'notes') {
        const all = filterNoteCrossRefs(await loadChapterNoteCrossRefs(bookId, chapter, textId, token), vs)
        return vs.map((v) => {
          const direct = all.byVerse.find((x) => x.verseNum === v)?.refs ?? []
          const mentions = all.indirect.filter((m) => m.verses.includes(v))
          const groups: XRefGroup[] = []
          if (direct.length) groups.push({ refs: direct.map((r) => ({ bookId: r.bookId, chapter: r.chapter, verse: r.verse, endVerse: r.endVerse ?? null, lxx: r.lxx, noteTitle: r.sourceNoteTitle })) })
          if (mentions.length) groups.push({ heading: 'Mentioned in', refs: [], mentions: mentions.map((m) => displayNoteTitle(m.note.title)) })
          return { verse: v, groups }
        })
      }
      return Promise.all(vs.map(async (v) => {
        if (source === 'classic') {
          const r = await window.crossrefs.getForVerse(bookId, chapter, v, textId).catch(() => ({ refs: [] as XRef[] }))
          return { verse: v, groups: r.refs.length ? [{ refs: r.refs as XRef[] }] : [] }
        }
        const r = await window.crossrefs.getTSKeForVerse(bookId, chapter, v, textId).catch(() => ({ groups: [] }))
        return { verse: v, groups: r.groups.map((g) => ({ heading: g.heading || undefined, reciprocal: g.isReciprocal, refs: g.refs as XRef[] })) }
      }))
    }
    run().then((d) => { if (alive) setData(d) }).catch(() => { if (alive) setData(vs.map((v) => ({ verse: v, groups: [] }))) })
    return () => { alive = false }
  }, [bookId, chapter, key, textId, source, token])
  return data
}
