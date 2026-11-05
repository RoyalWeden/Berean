import { describe, it, expect } from 'vitest'
import { asksForInterpretation, stripModelProse } from '../modePolicy'

describe('asksForInterpretation (spec §5.1)', () => {
  it('recognises requests for meaning, significance, application or argument', () => {
    for (const q of [
      'what does this passage mean',
      'What does John 3:16 mean?',
      'what is the significance of the veil tearing',
      'interpret Revelation 13',
      'how should we understand the Sabbath today',
      'why did God harden Pharaoh\'s heart',
      'does this prove grace means obedience',
      'is the law abolished',
      'explain the meaning of the parable of the sower',
    ]) expect(asksForInterpretation(q), q).toBe(true)
  })

  it('leaves factual and lexical questions alone (they are answered as research)', () => {
    for (const q of [
      'verses about the jubilee',
      'what does g5485 mean in Titus?',
      'the Hebrew word for mercy',
      'Compare H2617 and H7356',
      'where is the word chesed used in the Psalms',
      'John 3:16',
      'find verses about loving God by keeping commandments',
    ]) expect(asksForInterpretation(q), q).toBe(false)
  })
})

describe('stripModelProse', () => {
  it('removes per-verse commentary and keeps deterministic summaries only', () => {
    const r = { results: [{ commentary: 'Paul means…' }, {}], summary: 'John 3:16 — real KJV text, not an AI guess.' }
    expect(stripModelProse(r, true)).toEqual({ results: [{ commentary: undefined }, {}], summary: r.summary })
    expect(stripModelProse(r, false).summary).toBeUndefined()
  })
})
