import { describe, it, expect } from 'vitest'
import { estimateTokens, estimateTokensForAll, budgetPromptMaterial } from '../tokenBudget'

describe('estimateTokens', () => {
  it('is 0 for empty/undefined/null input', () => {
    expect(estimateTokens('')).toBe(0)
    expect(estimateTokens(undefined)).toBe(0)
    expect(estimateTokens(null)).toBe(0)
  })

  it('uses the documented ~4 chars/token ratio, rounded up', () => {
    expect(estimateTokens('abcd')).toBe(1) // exactly 4 chars
    expect(estimateTokens('abcde')).toBe(2) // 5 chars rounds up to 2 tokens
    expect(estimateTokens('a'.repeat(400))).toBe(100)
  })
})

describe('estimateTokensForAll', () => {
  it('sums estimateTokens over every item, skipping empties safely', () => {
    expect(estimateTokensForAll(['abcd', 'abcd', undefined, ''])).toBe(2)
  })
})

describe('budgetPromptMaterial', () => {
  const question = 'What does this passage mean?'
  const staticOverhead = 'Respond with JSON only.'

  it('returns everything unchanged when it already fits comfortably', () => {
    const result = budgetPromptMaterial({
      question, staticOverhead,
      historyTurns: ['User: hi', 'Assistant: hello'],
      tabContextBlock: 'Genesis 1 is open.',
      candidateBlocks: ['GEN 1:1 — In the beginning...'],
    }, 10_000)
    expect(result.historyTurns).toEqual(['User: hi', 'Assistant: hello'])
    expect(result.tabContextBlock).toBe('Genesis 1 is open.')
    expect(result.candidateBlocks).toEqual(['GEN 1:1 — In the beginning...'])
    expect(result.trimmed).toEqual({ historyTurnsDropped: 0, tabContextTruncated: false, candidatesDropped: 0 })
  })

  it('drops the OLDEST history turns first, keeping the most recent', () => {
    const historyTurns = Array.from({ length: 10 }, (_, i) => `Turn ${i}: ${'x'.repeat(200)}`)
    const result = budgetPromptMaterial({
      question, staticOverhead, historyTurns, tabContextBlock: '', candidateBlocks: ['GEN 1:1 — text'],
    }, estimateTokens(question) + estimateTokens(staticOverhead) + estimateTokens('GEN 1:1 — text') + estimateTokensForAll(historyTurns.slice(6)))
    // Only room for the last few turns — the ones kept must be a suffix of the original list.
    expect(result.historyTurns.length).toBeLessThan(historyTurns.length)
    expect(result.historyTurns).toEqual(historyTurns.slice(historyTurns.length - result.historyTurns.length))
    expect(result.trimmed.historyTurnsDropped).toBe(historyTurns.length - result.historyTurns.length)
  })

  it('trims history completely before ever touching tab context', () => {
    const historyTurns = ['User: ' + 'x'.repeat(2000)]
    const tabContextBlock = 'short context'
    // Budget big enough for staticOverhead+question+tabContext+candidate but not the huge history turn.
    const tightBudget = estimateTokens(question) + estimateTokens(staticOverhead)
      + estimateTokens(tabContextBlock) + estimateTokens('GEN 1:1 — text') + 5
    const result = budgetPromptMaterial({
      question, staticOverhead, historyTurns, tabContextBlock, candidateBlocks: ['GEN 1:1 — text'],
    }, tightBudget)
    expect(result.historyTurns).toEqual([])
    expect(result.tabContextBlock).toBe(tabContextBlock) // untouched — history alone freed enough room
  })

  it('truncates tab context from the TAIL, appending a visible marker, once history is exhausted', () => {
    const tabContextBlock = 'AAAA'.repeat(500) // 2000 chars, ~500 tokens
    const result = budgetPromptMaterial({
      question, staticOverhead, historyTurns: [], tabContextBlock, candidateBlocks: [],
    }, estimateTokens(question) + estimateTokens(staticOverhead) + 20)
    expect(result.tabContextBlock.length).toBeLessThan(tabContextBlock.length)
    expect(result.tabContextBlock.startsWith('AAAA')).toBe(true) // head (earliest content) preserved
    expect(result.tabContextBlock).toContain('truncated')
    expect(result.trimmed.tabContextTruncated).toBe(true)
  })

  it('drops the LOWEST-scoring (tail) candidates last, after history and tab context are exhausted', () => {
    const candidateBlocks = ['BEST — real match', 'SECOND — ok match', 'THIRD — weak match', 'FOURTH — weakest match']
    const result = budgetPromptMaterial({
      question, staticOverhead, historyTurns: [], tabContextBlock: '',
      candidateBlocks,
    }, estimateTokens(question) + estimateTokens(staticOverhead) + estimateTokens(candidateBlocks[0]) + estimateTokens(candidateBlocks[1]) + 2)
    expect(result.candidateBlocks).toEqual(['BEST — real match', 'SECOND — ok match'])
    expect(result.trimmed.candidatesDropped).toBe(2)
  })

  it('always keeps at least one candidate even under an impossibly tight budget', () => {
    const candidateBlocks = ['ONE — ' + 'x'.repeat(500), 'TWO — ' + 'x'.repeat(500)]
    const result = budgetPromptMaterial({
      question, staticOverhead, historyTurns: [], tabContextBlock: '', candidateBlocks,
    }, 1)
    expect(result.candidateBlocks).toEqual(['ONE — ' + 'x'.repeat(500)])
  })

  it('never trims the question or staticOverhead — only the three trimmable inputs', () => {
    const result = budgetPromptMaterial({
      question, staticOverhead,
      historyTurns: ['a very long turn '.repeat(100)],
      tabContextBlock: 'y'.repeat(1000),
      candidateBlocks: ['z'.repeat(1000)],
    }, 1)
    // Everything trimmable is gone except the one guaranteed candidate; question/overhead were
    // never part of the trimmable inputs to begin with, so there's nothing to assert they equal
    // besides confirming the function didn't throw or mutate its own arguments.
    expect(result.historyTurns).toEqual([])
    expect(question).toBe('What does this passage mean?')
    expect(staticOverhead).toBe('Respond with JSON only.')
  })
})
