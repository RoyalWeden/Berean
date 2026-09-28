import type { Note } from '@/types'
import { extractRefsFromNote } from '../noteRefs'
import { buildCrossRefSources, chapterCrossRefSources } from '../crossRefIndex'
import { getAllNotes } from '../notesCache'
import { displayNoteTitle } from '../noteTitle'

/**
 * The ONE structured cross-reference result every iPhone surface renders (XREF-001): the caret's
 * Cross References and My Notes, the verse sheet, the selection bar's sheet, the multi-verse
 * sheet and the study view. Sources stay what they were (TSK/e, Classic, My Notes, plus the
 * Taylor Hermas footnotes); this layer only normalises them into items carrying everything a card
 * needs — the target (single verse, range or whole chapter), the FULL passage text, where it came
 * from, its heading, and whether it is the current verse — so no component reshapes data.
 */
export type XRefSource = 'tske' | 'classic' | 'notes' | 'taylor'

export interface XRefItem {
  /** Target identity (dedupe key): book.chapter.verse[-end][|lxx]; verse 0 = the whole chapter. */
  key: string
  bookId: string
  chapter: number
  verse: number
  endVerse?: number | null
  lxx?: boolean
  source: XRefSource
  /** The full passage text (every verse of a range), once resolved. */
  text?: string
  /** The selected verse(s) this reference belongs to (several when de-duplicated across a selection). */
  fromVerses: number[]
  /** My Notes: the note that makes (or, for a reciprocal, cites) the reference. */
  noteTitle?: string
  /** My Notes, chapter context: 'makes' = a chapter note points here; 'cites' = a note here cites this chapter. */
  noteRole?: 'makes' | 'cites'
  /** The target lies within the current context (the selected verse itself). */
  isCurrent?: boolean
}

export interface XRefSection {
  id: string
  /** TSK/e topic heading, "Reciprocal", "v. 5" for a multi-verse selection, or a source name. */
  heading?: string
  items: XRefItem[]
}

export interface XRefResult {
  sections: XRefSection[]
  /** My Notes: titles of general notes that only mention the verses (no navigable target). */
  mentions: string[]
  total: number
}

export const xrefKey = (r: { bookId: string; chapter: number; verse: number; endVerse?: number | null; lxx?: boolean }) =>
  `${r.bookId}.${r.chapter}.${r.verse}${r.endVerse && r.endVerse !== r.verse ? `-${r.endVerse}` : ''}${r.lxx ? '|lxx' : ''}`

/** The raw per-verse shape the existing sources produce (useVerseCrossRefs). */
export interface RawVerseXRefs {
  verse: number
  groups: Array<{ heading?: string; reciprocal?: boolean; refs: Array<{ bookId: string; chapter: number; verse: number; endVerse?: number | null; text?: string; lxx?: boolean; noteTitle?: string }>; mentions?: string[] }>
}

/**
 * Normalise a verse-context result. One verse: its groups as sections. Several verses: a section per
 * verse ("v. 5") and each target listed ONCE — at its first occurrence, with every verse it belongs to.
 */
export function normalizeVerseXRefs(data: readonly RawVerseXRefs[], source: XRefSource, ctx: { bookId: string; chapter: number; verses: readonly number[] }): XRefResult {
  const multi = ctx.verses.length > 1
  const seen = new Map<string, XRefItem>()
  const sections: XRefSection[] = []
  const mentions = new Set<string>()
  for (const v of data) {
    for (const [gi, g] of v.groups.entries()) {
      for (const m of g.mentions ?? []) mentions.add(m)
      const heading = [multi ? `v. ${v.verse}` : null, g.reciprocal ? 'Reciprocal' : g.heading].filter(Boolean).join(' · ') || undefined
      const items: XRefItem[] = []
      for (const r of g.refs) {
        const key = xrefKey(r)
        const existing = seen.get(key)
        if (existing) { if (!existing.fromVerses.includes(v.verse)) existing.fromVerses.push(v.verse); continue }
        const item: XRefItem = {
          key, bookId: r.bookId, chapter: r.chapter, verse: r.verse, endVerse: r.endVerse ?? null, lxx: r.lxx, source,
          text: r.endVerse && r.endVerse > r.verse ? undefined : (r.text || undefined),
          fromVerses: [v.verse], noteTitle: r.noteTitle,
          isCurrent: r.bookId === ctx.bookId && r.chapter === ctx.chapter && ctx.verses.some((x) => x >= r.verse && x <= (r.endVerse ?? r.verse)),
        }
        seen.set(key, item)
        items.push(item)
      }
      if (items.length) sections.push({ id: `${v.verse}-${gi}`, heading, items })
    }
  }
  return { sections, mentions: [...mentions], total: seen.size }
}

/**
 * CHAPTER context (no verse selected). TSK/e and Classic are keyed per source verse and hold no
 * chapter-level rows (verified against the bundled databases), so the chapter's own cross references
 * are the ones that exist at chapter level:
 *   - My Notes · makes: every Scripture reference made by a note attached to the chapter (verseRef "BOOK.CH")
 *   - My Notes · cites: the verse of every note elsewhere that cites this whole chapter (the former
 *     chapter banner's sources — crossRefIndex.chapterCrossRefSources)
 *   - Taylor: the Taylor translation's chapter footnotes, when reading Hermas (Taylor)
 * Each target once.
 */
export function chapterXRefsFromNotes(notes: ReadonlyArray<Pick<Note, 'id' | 'title' | 'content' | 'verseRef'> & { deletedAt?: number | null }>, bookId: string, chapter: number): XRefResult {
  const live = notes.filter((n) => !n.deletedAt)
  const seen = new Map<string, XRefItem>()
  const makes: XRefItem[] = []
  const cites: XRefItem[] = []
  for (const n of live) {
    if (n.verseRef !== `${bookId}.${chapter}`) continue
    for (const r of extractRefsFromNote(n.content ?? '', n.title || 'Untitled')) {
      if (r.bookId === bookId && r.chapter === chapter && (r.isChapter || r.verse === 0)) continue   // the chapter itself
      const verse = r.isChapter ? 0 : r.verse
      const key = xrefKey({ ...r, verse })
      if (seen.has(key)) continue
      const item: XRefItem = { key, bookId: r.bookId, chapter: r.chapter, verse, endVerse: r.endVerse ?? null, lxx: r.lxx, source: 'notes', fromVerses: [], noteTitle: displayNoteTitle(n.title), noteRole: 'makes' }
      seen.set(key, item); makes.push(item)
    }
  }
  const sources = buildCrossRefSources(live.map((n) => ({ id: n.id, title: n.title ?? null, content: n.content ?? '', verseRef: n.verseRef ?? null })))
  for (const s of chapterCrossRefSources(sources, bookId, chapter)) {
    const key = xrefKey({ bookId: s.homeBookId, chapter: s.homeChapter, verse: s.homeVerse })
    if (seen.has(key)) continue
    const item: XRefItem = { key, bookId: s.homeBookId, chapter: s.homeChapter, verse: s.homeVerse, source: 'notes', fromVerses: [], noteTitle: displayNoteTitle(s.title), noteRole: 'cites' }
    seen.set(key, item); cites.push(item)
  }
  const sections: XRefSection[] = []
  if (makes.length) sections.push({ id: 'makes', heading: 'From notes on this chapter', items: makes })
  if (cites.length) sections.push({ id: 'cites', heading: 'Notes that cite this chapter', items: cites })
  return { sections, mentions: [], total: seen.size }
}

export async function loadChapterXRefs(bookId: string, chapter: number, textId: string, token: number): Promise<XRefResult> {
  const res = chapterXRefsFromNotes(await getAllNotes(token), bookId, chapter)
  if (textId === 'hermas_taylor' && window.crossrefs?.getHermasTaylorChapter) {
    const t = await window.crossrefs.getHermasTaylorChapter(bookId, chapter).catch(() => ({ refs: [] as Array<{ bookId: string; chapter: number; verse: number; text: string }> }))
    const items: XRefItem[] = []
    const keys = new Set(res.sections.flatMap((s) => s.items.map((i) => i.key)))
    for (const r of t.refs) {
      const key = xrefKey(r)
      if (keys.has(key)) continue
      keys.add(key)
      items.push({ key, bookId: r.bookId, chapter: r.chapter, verse: r.verse, source: 'taylor', text: r.text || undefined, fromVerses: [] })
    }
    if (items.length) res.sections.push({ id: 'taylor', heading: 'Taylor’s footnotes', items })
    res.total += items.length
  }
  return res
}

// ── passage text ─────────────────────────────────────────────────────────────────────────────
const textCache = new Map<string, string>()
const MAX_RANGE = 40

/** Verses a target spans (a whole-chapter target: none — the card shows no text for it). */
export function targetVerses(i: Pick<XRefItem, 'bookId' | 'chapter' | 'verse' | 'endVerse'>): Array<{ bookId: string; chapter: number; verse: number }> {
  if (!i.verse) return []
  const end = Math.min(i.endVerse && i.endVerse > i.verse ? i.endVerse : i.verse, i.verse + MAX_RANGE - 1)
  const out = []
  for (let v = i.verse; v <= end; v++) out.push({ bookId: i.bookId, chapter: i.chapter, verse: v })
  return out
}

/**
 * Fill in the full passage text for items that lack it (My Notes refs, ranges), in ONE
 * `bible.queryVerses` call per text (KJVA, and LXX for LXX-marked refs), cached for the session.
 * Offline: the bundled databases. Items that already carry text are returned as they are.
 */
export async function resolveXRefTexts(items: readonly XRefItem[], textFor: (i: XRefItem) => string = (i) => (i.lxx ? 'lxx' : 'kjva')): Promise<XRefItem[]> {
  const missing = new Map<string, Array<{ bookId: string; chapter: number; verse: number }>>()
  for (const i of items) {
    if (i.text || !i.verse) continue
    const t = textFor(i)
    for (const v of targetVerses(i)) {
      if (textCache.has(`${t}|${v.bookId}.${v.chapter}.${v.verse}`)) continue
      const list = missing.get(t) ?? []
      list.push(v); missing.set(t, list)
    }
  }
  for (const [t, refs] of missing) {
    const map = await window.bible.queryVerses(refs, t).catch(() => ({} as Record<string, { text: string }>))
    for (const r of refs) {
      const hit = map[`${r.bookId}.${r.chapter}.${r.verse}`]
      if (hit?.text) textCache.set(`${t}|${r.bookId}.${r.chapter}.${r.verse}`, hit.text)
    }
  }
  return items.map((i) => {
    if (i.text || !i.verse) return i
    const t = textFor(i)
    const text = targetVerses(i).map((v) => textCache.get(`${t}|${v.bookId}.${v.chapter}.${v.verse}`)).filter(Boolean).join(' ')
    return text ? { ...i, text } : i
  })
}

export function __clearXRefTextCache(): void { textCache.clear() }
