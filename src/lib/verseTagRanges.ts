import { bookName } from '@/lib/parseRef'
import type { VerseTagRange } from '@/types'

/** A selected verse (as used by the verse-selection store slice). */
export interface SelRef { bookId: string; chapter: number; verse: number }

/** Group a flat list of selected verses into tag ranges: one entry per (book, chapter),
 *  with contiguous verses collapsed into `{s,e}` spans. Order-stable by book/chapter/verse. */
export function selectionToRanges(sel: SelRef[]): VerseTagRange[] {
  const byChapter = new Map<string, { bookId: string; chapter: number; verses: number[] }>()
  for (const r of sel) {
    const key = `${r.bookId}|${r.chapter}`
    let e = byChapter.get(key)
    if (!e) { e = { bookId: r.bookId, chapter: r.chapter, verses: [] }; byChapter.set(key, e) }
    e.verses.push(r.verse)
  }
  const out: VerseTagRange[] = []
  for (const { bookId, chapter, verses } of byChapter.values()) {
    const nums = [...new Set(verses)].sort((a, b) => a - b)
    const spans: Array<{ s: number; e: number }> = []
    let s = nums[0], prev = nums[0]
    for (let i = 1; i <= nums.length; i++) {
      if (i < nums.length && nums[i] === prev + 1) { prev = nums[i]; continue }
      spans.push({ s, e: prev })
      if (i < nums.length) { s = nums[i]; prev = nums[i] }
    }
    out.push({ bookId, chapter, spans })
  }
  return out
}

/** `[{ bookId, chapter, whole:true }]` — the range list for tagging an entire chapter. */
export function chapterRanges(bookId: string, chapter: number): VerseTagRange[] {
  return [{ bookId, chapter, whole: true }]
}

/** Parse a human verse-span string ("3", "3-4,6", "1, 5-7 , 12") into sorted, merged
 *  `{s,e}` spans. Returns null if nothing valid was found or any segment is malformed —
 *  used by the Tag Manager's "narrow a whole-chapter tag down to specific verses" editor. */
export function parseVerseSpans(input: string): Array<{ s: number; e: number }> | null {
  const raw: Array<{ s: number; e: number }> = []
  for (const seg of input.split(',')) {
    const t = seg.trim()
    if (!t) continue
    const m = t.match(/^(\d{1,3})(?:\s*[-–]\s*(\d{1,3}))?$/)
    if (!m) return null
    const a = parseInt(m[1], 10)
    const b = m[2] ? parseInt(m[2], 10) : a
    if (!Number.isFinite(a) || a < 1 || a > 200) return null
    if (!Number.isFinite(b) || b < 1 || b > 200) return null
    raw.push({ s: Math.min(a, b), e: Math.max(a, b) })
  }
  if (!raw.length) return null
  raw.sort((x, y) => x.s - y.s || x.e - y.e)
  const merged: Array<{ s: number; e: number }> = [raw[0]]
  for (let i = 1; i < raw.length; i++) {
    const last = merged[merged.length - 1]
    if (raw[i].s <= last.e + 1) last.e = Math.max(last.e, raw[i].e)
    else merged.push(raw[i])
  }
  return merged
}

function spansLabel(spans: Array<{ s: number; e: number }>): string {
  return spans.map((sp) => (sp.s === sp.e ? `${sp.s}` : `${sp.s}-${sp.e}`)).join(',')
}

/** Human display label for a member's ranges, e.g. "Deuteronomy 32:3-4,6" or
 *  "Deuteronomy 32 (chapter)" or, for cross-chapter members, "Genesis 1:1-3; Genesis 2:4". */
export function rangesLabel(ranges: VerseTagRange[]): string {
  return ranges
    .map((r) => {
      const name = `${bookName(r.bookId)} ${r.chapter}`
      if (r.whole || !r.spans?.length) return `${name} (chapter)`
      return `${name}:${spansLabel(r.spans)}`
    })
    .join('; ')
}
