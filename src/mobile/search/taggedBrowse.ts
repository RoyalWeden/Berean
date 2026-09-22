import type { VerseTagMember } from '@/types'
import type { ScriptureHit } from '@/lib/scriptureSearch'

/** One chapter to fetch for the tagged-verse browse view: specific verses, or the whole chapter. */
export interface TaggedChapterRef { bookId: string; chapter: number; verses: number[] | 'all' }

/**
 * The chapters (and the verses within them) that the selected tags cover, deduped across
 * members so each chapter is fetched once. Whole-chapter members win over verse lists for
 * the same chapter. Order = first appearance.
 */
export function taggedChapterRefs(members: VerseTagMember[]): TaggedChapterRef[] {
  const byKey = new Map<string, TaggedChapterRef>()
  const keyOf = (bookId: string, chapter: number) => `${bookId}:${chapter}`
  for (const m of members) {
    for (const c of m.wholeChapters) byKey.set(keyOf(c.bookId, c.chapter), { bookId: c.bookId, chapter: c.chapter, verses: 'all' })
    for (const v of m.verses) {
      const k = keyOf(v.bookId, v.chapter)
      const cur = byKey.get(k)
      if (!cur) byKey.set(k, { bookId: v.bookId, chapter: v.chapter, verses: [v.verse] })
      else if (cur.verses !== 'all' && !cur.verses.includes(v.verse)) cur.verses.push(v.verse)
    }
  }
  return [...byKey.values()].map((r) => (r.verses === 'all' ? r : { ...r, verses: [...r.verses].sort((a, b) => a - b) }))
}

/** Desktop shows the first few verses of a whole-chapter member as its preview (TaggedVerseList). */
export const WHOLE_CHAPTER_PREVIEW = 6

/**
 * Verse text for the tagged references, as search hits, so the browse view (tags picked, no
 * query) renders through the same grouped list as real results. One `queryChapter` per chapter.
 */
export async function loadTaggedVerses(members: VerseTagMember[], textId: string,
  queryChapter: (bookId: string, chapter: number, textId: string) => Promise<Array<{ verse_num: number; text: string }>>): Promise<ScriptureHit[]> {
  const out: ScriptureHit[] = []
  for (const r of taggedChapterRefs(members)) {
    let rows: Array<{ verse_num: number; text: string }>
    try { rows = await queryChapter(r.bookId, r.chapter, textId) } catch { continue }
    const picked = r.verses === 'all' ? rows.slice(0, WHOLE_CHAPTER_PREVIEW) : rows.filter((v) => (r.verses as number[]).includes(v.verse_num))
    for (const v of picked) out.push({ book_id: r.bookId, chapter: r.chapter, verse_num: v.verse_num, text: v.text, textId })
  }
  return out
}
