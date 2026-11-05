import { describe, it, expect } from 'vitest'
import { detectLexicalIntent } from '../lexicalIntent'

const kind = (q: string) => detectLexicalIntent(q)?.kind ?? null

describe('detectLexicalIntent', () => {
  it('recognises Strong\'s ids, comparisons and occurrence requests', () => {
    expect(kind('G5485')).toBe('strongs-id')
    expect(kind('what does g5485 mean in Titus?')).toBe('strongs-id')
    expect(kind('Compare H2617 and H7356')).toBe('strongs-compare')
    expect(kind('every occurrence of G5485')).toBe('occurrences')
    expect(kind('occurrences of G3056 in John only')).toBe('occurrences')
    expect(detectLexicalIntent('where is H2617 used in Psalms')?.ids).toEqual(['H2617'])
  })

  it('recognises word-by-word and untagged-word requests with a reference', () => {
    expect(kind("Strong's numbers for Genesis 1:1-3")).toBe('word-table')
    expect(kind("word-by-word table with Strong's numbers for Titus 2:11")).toBe('word-table')
    expect(kind("Show every word and Strong's number in John 1:1")).toBe('word-table')
    expect(kind("which words in John 3:16 have no Strong's number")).toBe('untagged-words')
    const lxx = detectLexicalIntent("Strong's numbers in the Greek Septuagint for Genesis 1:1")
    expect(lxx).toMatchObject({ kind: 'word-table', wantsSeptuagint: true })
  })

  it('extracts the term of a word study and its language', () => {
    expect(detectLexicalIntent('the Hebrew word for mercy')).toMatchObject({ kind: 'word-study', term: 'mercy', lang: 'H' })
    expect(detectLexicalIntent('the Greek word for faith')).toMatchObject({ term: 'faith', lang: 'G' })
    expect(detectLexicalIntent("Hebrew word glossed as 'mercy'")).toMatchObject({ term: 'mercy', lang: 'H' })
    expect(detectLexicalIntent("Hebrew words translated 'law'")).toMatchObject({ term: 'law' })
    expect(detectLexicalIntent('the word for holy')).toMatchObject({ term: 'holy', lang: null })
    expect(detectLexicalIntent('what does agape mean in Greek')).toMatchObject({ term: 'agape', lang: 'G' })
    expect(detectLexicalIntent("Hebrew entries whose definition mentions 'covenant'")).toMatchObject({ term: 'covenant', lang: 'H' })
  })

  it('treats original script as a word study', () => {
    expect(detectLexicalIntent('חסד')).toMatchObject({ kind: 'word-study', termKind: 'original-script', lang: 'H' })
    expect(detectLexicalIntent('χάρις')).toMatchObject({ kind: 'word-study', termKind: 'original-script', lang: 'G' })
  })

  it('leaves topical and passage questions to retrieval', () => {
    expect(kind('verses about the jubilee')).toBeNull()
    expect(kind('John 3:16')).toBeNull()
    expect(kind('find verses about loving God by keeping commandments')).toBeNull()
  })

  it('flags a single bare word for a lexicon check (the service decides if it is a transliteration)', () => {
    expect(detectLexicalIntent('chesed')).toMatchObject({ kind: 'word-study', term: 'chesed' })
  })
})

describe('word-study phrasing found by the holdout', () => {
  it('"what Greek word is translated X in <verse>"', () => {
    expect(detectLexicalIntent("what Greek word is translated 'Word' in John 1:1")).toMatchObject({ kind: 'word-study', term: 'Word', lang: 'G' })
  })
})

describe('"the word X used/means" (bench S04)', () => {
  it('reads the named word as the term', () => {
    expect(detectLexicalIntent('where is the word chesed used in the Psalms')).toMatchObject({ kind: 'occurrences', term: 'chesed', bookId: 'PSA' })
    expect(detectLexicalIntent('what the word grace means')).toMatchObject({ kind: 'word-study', term: 'grace' })
    expect(detectLexicalIntent('verses about the word of God')).toBeNull()
  })
})

describe('phrasings found by holdout3 (consumed)', () => {
  it('"Strong\'s breakdown of <ref>" is a word table; "Hebrew noun for X" and "what is X" are word studies', () => {
    expect(kind("give me the Strong's breakdown of Exodus 20:8")).toBe('word-table')
    expect(detectLexicalIntent('tell me the Hebrew noun for heart')).toMatchObject({ kind: 'word-study', term: 'heart', lang: 'H' })
    expect(detectLexicalIntent('what is koinonia')).toMatchObject({ kind: 'word-study', term: 'koinonia', bare: true })
    expect(kind('what is the sabbath about')).toBeNull()
  })

  it('reads phrasings that used to depend on the model routing them', () => {
    for (const [q, term] of [['what is the Greek for peace', 'peace'], ['Greek word used for "light" in John 1', 'light'], ["which Hebrew word is 'remember' in Exodus 20:8", 'remember'], ['yeshua as a word', 'yeshua']]) {
      expect(detectLexicalIntent(q)).toMatchObject({ kind: 'word-study', term })
    }
  })
})
