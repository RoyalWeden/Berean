/**
 * Tests for cross-ref extraction with chapter-level references, and the
 * verse-text match ratio direction used by the verse-block sensitivity check.
 */
import { describe, it, expect } from 'vitest'
import { extractRefsFromNote, refMatchesVerse } from '../noteRefs'
import { verseTextMatchRatio } from '../../components/notes/NoteEditor'

// ── 1. Chapter-level reference extraction ─────────────────────────────────────

describe('extractRefsFromNote — chapter references', () => {
  it('"Genesis 5" is extracted as a chapter ref (isChapter, verse 0)', () => {
    const refs = extractRefsFromNote('This quotes Genesis 5 about the genealogy', 'Note')
    const gen = refs.find(r => r.bookId === 'GEN')
    expect(gen).toBeTruthy()
    expect(gen!.chapter).toBe(5)
    expect(gen!.isChapter).toBe(true)
    expect(gen!.verse).toBe(0)
  })

  it('"John 3:16" is a verse ref (not chapter)', () => {
    const refs = extractRefsFromNote('See John 3:16 here', 'Note')
    const jhn = refs.find(r => r.bookId === 'JHN')
    expect(jhn!.isChapter).toBeFalsy()
    expect(jhn!.verse).toBe(16)
  })

  it('mixed chapter + verse refs in one note', () => {
    const refs = extractRefsFromNote('Compare Genesis 5 with Romans 8:28', 'Note')
    const gen = refs.find(r => r.bookId === 'GEN')
    const rom = refs.find(r => r.bookId === 'ROM')
    expect(gen!.isChapter).toBe(true)
    expect(rom!.isChapter).toBeFalsy()
    expect(rom!.verse).toBe(28)
  })

  it('numbered-book chapter ref: "1 Kings 8"', () => {
    const refs = extractRefsFromNote('quoting 1 Kings 8 the dedication', 'Note')
    const ref = refs.find(r => r.bookId === '1KI')
    expect(ref).toBeTruthy()
    expect(ref!.chapter).toBe(8)
    expect(ref!.isChapter).toBe(true)
  })
})

// ── 2. refMatchesVerse — chapter ref matches every verse in chapter ──────────

describe('refMatchesVerse', () => {
  const chapterRef = { bookId: 'GEN', chapter: 5, verse: 0, isChapter: true, sourceNoteTitle: '', context: '' }
  const verseRef = { bookId: 'GEN', chapter: 5, verse: 4, isChapter: false, sourceNoteTitle: '', context: '' }

  it('chapter ref matches verse 1 of that chapter', () => {
    expect(refMatchesVerse(chapterRef, 'GEN', 5, 1)).toBe(true)
  })
  it('chapter ref matches verse 32 of that chapter', () => {
    expect(refMatchesVerse(chapterRef, 'GEN', 5, 32)).toBe(true)
  })
  it('chapter ref does NOT match a different chapter', () => {
    expect(refMatchesVerse(chapterRef, 'GEN', 6, 1)).toBe(false)
  })
  it('chapter ref does NOT match a different book', () => {
    expect(refMatchesVerse(chapterRef, 'EXO', 5, 1)).toBe(false)
  })
  it('verse ref matches only its exact verse', () => {
    expect(refMatchesVerse(verseRef, 'GEN', 5, 4)).toBe(true)
    expect(refMatchesVerse(verseRef, 'GEN', 5, 5)).toBe(false)
  })
})

// ── 3. Verse-text match ratio direction (sensitivity bug) ────────────────────
// The verse-block check measures how much of the ACTUAL VERSE is present in the
// typed text: verseTextMatchRatio(actualVerse, typedText).

describe('verseTextMatchRatio — verse-coverage direction', () => {
  // Genesis 1:5 (KJV) — the real verse text
  const GEN_1_5 = 'And God called the light Day, and the darkness he called Night. And the evening and the morning were the first day'

  it('a short comment reusing common words scores LOW (the reported bug)', () => {
    // "the the" — only "the" overlaps; as a fraction of the whole verse this is tiny
    const ratio = verseTextMatchRatio(GEN_1_5, 'the the')
    expect(ratio).toBeLessThan(0.9)
  })

  it('the full actual verse scores 1.0', () => {
    expect(verseTextMatchRatio(GEN_1_5, GEN_1_5)).toBe(1)
  })

  it('most of the verse present scores high', () => {
    const almost = GEN_1_5.split(' ').slice(0, -2).join(' ') // drop last 2 words
    expect(verseTextMatchRatio(GEN_1_5, almost)).toBeGreaterThan(0.8)
  })

  it('a few words of the verse scores below 0.9 threshold', () => {
    expect(verseTextMatchRatio(GEN_1_5, 'And God called the light')).toBeLessThan(0.9)
  })

  it('unrelated commentary scores near 0', () => {
    expect(verseTextMatchRatio(GEN_1_5, 'my own thoughts about creation')).toBeLessThan(0.3)
  })
})
