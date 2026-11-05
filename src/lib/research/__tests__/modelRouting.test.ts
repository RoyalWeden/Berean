import { describe, it, expect } from 'vitest'
import { lexicalQuestionFromModel } from '../modelRouting'

describe('lexicalQuestionFromModel — the model routes, it never supplies a Strong\'s number', () => {
  const hist = [{ role: 'user' as const, content: 'the Greek word for church' }, { role: 'assistant' as const, content: "Strong's G1577 ekklesia" }]

  it('builds a canonical word-study request from term + language', () => {
    expect(lexicalQuestionFromModel({ kind: 'word-study', term: 'peace', lang: 'greek' }, 'what is the Greek for peace', [])).toBe('the Greek word for peace')
    expect(lexicalQuestionFromModel({ kind: 'word-study', term: 'pneuma' }, 'define pneuma', [])).toBe('the word for pneuma')
  })

  it('keeps an id only when it appears in the question or the conversation', () => {
    expect(lexicalQuestionFromModel({ kind: 'occurrences', ids: ['G1577'], book: 'Acts' }, 'is it used in Acts?', hist)).toBe('every occurrence of G1577 in Acts')
    // an id from the model's memory is dropped; with no term there is nothing safe to ask
    expect(lexicalQuestionFromModel({ kind: 'word-study', ids: ['H2580'] }, 'what about grace', [])).toBeNull()
    expect(lexicalQuestionFromModel({ kind: 'compare', ids: ['G25', 'G5368'] }, 'contrast them', [])).toBeNull()
  })

  it('needs a reference for a word table, and returns null for ordinary questions', () => {
    expect(lexicalQuestionFromModel({ kind: 'word-table', ref: 'Genesis 1:3' }, 'interlinear for Genesis 1:3', [])).toBe("every word and Strong's number in Genesis 1:3")
    expect(lexicalQuestionFromModel({ kind: 'word-table' }, 'break it down', [])).toBeNull()
    expect(lexicalQuestionFromModel({ kind: 'none' }, 'verses about grace', [])).toBeNull()
  })
  it('ignores a copied template placeholder', () => {
    expect(lexicalQuestionFromModel({ kind: '<word-study | occurrences | word-table | compare | none>', term: '<the word, or empty>' }, 'verses about grace', [])).toBeNull()
    expect(lexicalQuestionFromModel({ kind: 'word-study', term: '<the word, or empty>', lang: '<hebrew | greek | empty>' }, 'verses about grace', [])).toBeNull()
  })
})

describe('word-question gate (bench p3: K20, S20, B09)', () => {
  it('never routes a verse quote, a topical phrase or an explain request to the lexicon', () => {
    expect(lexicalQuestionFromModel({ kind: 'word-study', term: 'do', lang: 'hebrew' }, 'in one sentence, explain Micah 6:8', [])).toBeNull()
    expect(lexicalQuestionFromModel({ kind: 'word-study', term: 'faith', lang: 'greek' }, 'the just shall live by faith', [])).toBeNull()
    expect(lexicalQuestionFromModel({ kind: 'word-study', term: 'Word', lang: 'greek' }, 'In the beginning was the Word', [])).toBeNull()
    expect(lexicalQuestionFromModel({ kind: 'word-study', term: 'pneuma', lang: 'greek' }, 'where is spirit used in the sense of breath', [])).toBeNull()
  })

  it('still routes questions that are about a word', () => {
    expect(lexicalQuestionFromModel({ kind: 'word-study', term: 'eirene', lang: 'greek' }, 'what is the Greek for peace', [])).toBe('the Greek word for eirene')
    expect(lexicalQuestionFromModel({ kind: 'word-study', term: 'pneuma', lang: 'greek' }, 'define pneuma', [])).toBe('the Greek word for pneuma')
    expect(lexicalQuestionFromModel({ kind: 'word-study', term: 'Yeshua', lang: 'hebrew' }, 'yeshua as a word', [])).toBe('the Hebrew word for Yeshua')
    expect(lexicalQuestionFromModel({ kind: 'word-study', term: 'joy' }, 'look up the lexicon entry for joy', [])).toBe('the word for joy')
  })

  it('routes a short follow-up only when the conversation is already studying a word', () => {
    const hist = [{ role: 'user', content: 'the Greek word for church' }, { role: 'assistant', content: "Strong's G1577 ekklesia" }]
    expect(lexicalQuestionFromModel({ kind: 'occurrences', term: 'ekklesia', lang: 'greek', book: 'Acts' }, 'is it used in Acts?', hist)).toMatch(/^every occurrence of/)
    expect(lexicalQuestionFromModel({ kind: 'occurrences', term: 'ekklesia', lang: 'greek', book: 'Acts' }, 'is it used in Acts?', [])).toBeNull()
  })
})
