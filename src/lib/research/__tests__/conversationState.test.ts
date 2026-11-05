import { describe, it, expect } from 'vitest'
import { stateFromTurns, resolveFollowUp, type Turn } from '../conversationState'

const u = (content: string): Turn => ({ role: 'user', content })
const a = (content: string): Turn => ({ role: 'assistant', content })
const follow = (turns: Turn[], q: string) => resolveFollowUp(q, stateFromTurns(turns))

describe('stateFromTurns', () => {
  it('collects topic, scope, refs and Strong\'s ids from user AND assistant turns', () => {
    const s = stateFromTurns([u('only in the Psalms, verses about refuge'), a('Passages: Psalms 46:1; Psalms 91:2'), u('what is the Hebrew word for mercy'), a('Strong\'s H2617 — also H7356')])
    expect(s.scopePhrase).toMatch(/only in the Psalms/i)
    expect(s.term).toBe('mercy')
    expect(s.lang).toBe('H')
    expect(s.strongs).toEqual(['H2617', 'H7356'])
    expect(s.refs).toEqual(['PSA 46:1', 'PSA 91:2'])
  })

  it('clears a scope when the user lifts it', () => {
    expect(stateFromTurns([u('only New Testament please: verses on forgiveness'), u('actually, any testament is fine now')]).scopePhrase).toBeUndefined()
  })
})

describe('resolveFollowUp', () => {
  it('leaves stand-alone questions alone', () => {
    expect(follow([u('verses about the sabbath')], 'verses about humility')).toBeNull()
    expect(follow([], 'John 3:16')).toBeNull()
  })

  it('"now only Greek occurrences" keeps the lemma context (scenario 13)', () => {
    const f = follow([u('every occurrence of the word for grace'), a('Strong\'s H2580 · G5485')], 'Now show only Greek occurrences')
    expect(f?.question).toBe('every occurrence of G5485')
  })

  it('"compare the second one with the first" resolves the listed candidates (scenario 14)', () => {
    const f = follow([u('the Hebrew word for mercy'), a('H2617 cheçed · H7356 racham · H2603 chanan')], 'Compare the second one with the first')
    expect(f?.question).toBe('compare H7356 and H2617')
  })

  it('carries a restriction and swaps the topic ("now about joy, same restriction")', () => {
    expect(follow([u('only in the Psalms, verses about refuge'), a('Passages: Psalms 46:1')], 'now about joy, same restriction')?.question)
      .toBe('only in the Psalms, verses about joy')
    expect(follow([u("what is the Strong's number for grace"), a("Strong's G5485")], 'do the same for mercy')?.question)
      .toBe("what is the Strong's number for mercy")
  })

  it('excludes what was already shown, and honours "not X again"', () => {
    const f = follow([u('verses about honoring parents'), a('Passages: Exodus 20:12; Ephesians 6:2')], "more on honoring parents, but don't include Exodus 20:12 again")
    expect(f?.excludeRefs).toEqual(expect.arrayContaining(['EXO 20:12', 'EPH 6:2']))
    expect(follow([u('verses about the sabbath'), a('Passages: Exodus 20:8; Genesis 2:2')], 'find five more')?.excludeRefs).toEqual(['EXO 20:8', 'GEN 2:2'])
  })

  it('limits ("give me only 2", "just the best one")', () => {
    expect(follow([u('verses about the new moon'), a('Passages: Isaiah 66:23')], 'give me only 2')).toMatchObject({ question: 'verses about the new moon', limit: 2 })
    expect(follow([u('verses about the shema'), a('Passages: Deuteronomy 6:4')], 'just the best one')?.limit).toBe(1)
  })

  it('reference follow-ups: LXX, context of the Nth passage, word table for "those verses"', () => {
    expect(follow([u('Genesis 1:1'), a('Passages: Genesis 1:1')], 'show that in the LXX')?.question).toBe('Genesis 1:1 LXX')
    expect(follow([u('verses about salvation by grace'), a('Passages: Romans 6:23; Ephesians 2:8; Titus 3:5')], 'show the context of the second passage')?.question).toBe('Ephesians 2:5-11')
    expect(follow([u('Titus 2:11-12'), a('Passages: Titus 2:11-12')], "show every Strong's number for those verses")?.question).toBe("every word and Strong's number in Titus 2:11-12")
  })

  it('id follow-ups: trace through a book, verify against the word asked about', () => {
    expect(follow([u("Strong's for shepherd in Psalm 23:1"), a("Strong's H7462")], 'trace that Hebrew word through the Psalms')?.question).toBe('every occurrence of H7462 in Psalms')
    expect(follow([u('Greek word for faith'), a('Faith is G26. — Strong\'s G26')], 'check that number against the database')?.question).toBe('G26 and the Greek word for faith')
  })

  it('corpus follow-ups ("now search Jubilees for the same", "and in Enoch?")', () => {
    expect(follow([u('verses about the sabbath'), a('Passages: Exodus 20:8')], 'now search Jubilees for the same')?.question).toBe('verses about the sabbath in Jubilees')
    expect(follow([u('the watchers'), a('Passages: Daniel 4:13')], 'and in Enoch?')?.question).toBe('verses about the watchers in Enoch')
  })

  it('"try again" re-runs the last request', () => {
    expect(follow([u('verses about the jubilee year'), a('Something went wrong')], 'try again')?.question).toBe('verses about the jubilee year')
  })
})

describe('follow-up phrasings found by the 2026-10-28 holdout (recorded in HOLDOUT.lock)', () => {
  it('language follow-ups without "what about"', () => {
    expect(follow([u('the Hebrew word for peace'), a("Strong's H7965 shalowm")], 'and the Greek one?')?.question).toBe('the greek word for peace')
    expect(follow([u('the word for righteousness'), a("Strong's G1343 dikaiosune")], 'I meant the Hebrew word')?.question).toBe('the hebrew word for righteousness')
  })
  it('"where does that word appear in <book>"', () => {
    expect(follow([u('the Greek word for faith'), a("Strong's G4102 pistis")], 'where does that word appear in Romans')?.question).toBe('every occurrence of G4102 in Romans')
  })
})

describe('follow-up phrasings found by holdout3 (consumed)', () => {
  it('"now the Greek" switches the word study language', () => {
    expect(follow([u('the Hebrew word for truth'), a("Strong's H571 emeth")], 'now the Greek')?.question).toBe('the greek word for truth')
  })
  it('"any in Proverbs?" scopes the studied word to a book', () => {
    expect(follow([u('the Hebrew word for wisdom'), a("Strong's H2451 chokmah")], 'any in Proverbs?')?.question).toBe('every occurrence of H2451 in Proverbs')
  })
  it('"do grace next" repeats the request for a new word', () => {
    expect(follow([u('the Greek word for faith'), a("Strong's G4102 pistis")], 'do grace next')?.question).toBe('the Greek word for grace')
  })
  it('"what does the Septuagint have there" reads the last reference in the LXX', () => {
    expect(follow([u('Genesis 1:2'), a('Passages: Genesis 1:2')], 'what does the Septuagint have there')?.question).toBe('Genesis 1:2 LXX')
  })
})
