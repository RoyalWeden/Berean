import { describe, it, expect } from 'vitest'
import { scanTextReferences, removeNonexistentReferences, nonexistentReferenceNote } from '../outputGuard'

// A tiny stand-in for the real verse table: Genesis has 50 chapters, Job 6 has 30 verses.
const REAL = new Set(['GEN|1|1', 'JHN|3|16', '1JN|4|8', 'JOB|6|30', 'TIT|2|11', 'TIT|2|12', 'TIT|2|13', 'TIT|2|14'])
const exists = (r: { bookId: string; chapter: number; verse: number }) => REAL.has(`${r.bookId}|${r.chapter}|${r.verse}`)

describe('scanTextReferences', () => {
  it('finds references parseRef would reject as out of range', () => {
    const refs = scanTextReferences('As written in Genesis 99:1, and see Job 6:48.')
    expect(refs.map((r) => `${r.bookId} ${r.chapter}:${r.verse}`)).toEqual(['GEN 99:1', 'JOB 6:48'])
    expect(refs[0].raw).toBe('Genesis 99:1')
  })

  it('handles numbered books, ranges and leading words', () => {
    const refs = scanTextReferences('Compare 1 John 4:8 with Titus 2:11-14 here.')
    expect(refs.map((r) => [r.bookId, r.chapter, r.verse, r.endVerse ?? null])).toEqual([['1JN', 4, 8, null], ['TIT', 2, 11, 14]])
  })
})

describe('removeNonexistentReferences', () => {
  it('removes fake references and keeps real ones untouched (benchmark R19, S19)', () => {
    const g = removeNonexistentReferences('Genesis 99:1 says so; John 3:16 is real; Job 6:48 too.', exists)
    expect(g.removed).toEqual(['Genesis 99:1', 'Job 6:48'])
    expect(g.text).toBe('[reference not found] says so; John 3:16 is real; [reference not found] too.')
    expect(nonexistentReferenceNote(g.removed)).toMatch(/Removed 2 references/)
  })

  it('checks both ends of a range', () => {
    expect(removeNonexistentReferences('Titus 2:11-14', exists).removed).toEqual([])
    expect(removeNonexistentReferences('Titus 2:11-19', exists).removed).toEqual(['Titus 2:11-19'])
  })

  it('leaves text without references alone', () => {
    expect(removeNonexistentReferences('No citations here.', exists)).toEqual({ text: 'No citations here.', removed: [] })
  })
})
