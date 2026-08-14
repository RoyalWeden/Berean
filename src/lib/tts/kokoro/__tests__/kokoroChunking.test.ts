import { describe, it, expect } from 'vitest'
import { buildLatencyChunks } from '../kokoroChunking'
import { buildChapterSpokenQueue } from '../../extractSpokenText'
import type { Verse } from '@/types'

function verse(num: number, text: string): Verse {
  return { verse_num: num, book_id: 'gen', chapter: 1, text, text_tagged: null as unknown as string }
}

describe('buildLatencyChunks', () => {
  it('the FIRST chunk is capped much smaller than later chunks, for fast playback start', () => {
    const longSentence = Array.from({ length: 40 }, (_, i) => `word${i}`).join(' ') + '.'
    const queue = buildChapterSpokenQueue([verse(1, longSentence)], 'GEN', 1)
    const chunks = buildLatencyChunks(queue, 0)
    expect(chunks.length).toBeGreaterThan(1)
    const firstWordCount = chunks[0].text.split(' ').length
    const secondWordCount = chunks[1].text.split(' ').length
    expect(firstWordCount).toBeLessThan(secondWordCount)
    expect(firstWordCount).toBeLessThanOrEqual(12)
  })

  it('ends a chunk at a real sentence boundary when one falls within range', () => {
    const queue = buildChapterSpokenQueue([verse(1, 'Hi there. This continues on for a while after it.')], 'GEN', 1)
    const chunks = buildLatencyChunks(queue, 0)
    // "Hi there." is short — well under the first-chunk word cap — so it should be its own
    // chunk on its own, not merged with what follows (Kokoro chunking has no short-chunk merge
    // pass — see kokoroChunking.ts's file header for why that's a deliberate difference from
    // webSpeechBackend.ts).
    expect(chunks[0].text).toBe('Hi there.')
  })

  it('spans a sentence across multiple verses when it doesn\'t end at a verse boundary', () => {
    const queue = buildChapterSpokenQueue([verse(1, 'In the beginning'), verse(2, 'God created the heavens.')], 'GEN', 1)
    const chunks = buildLatencyChunks(queue, 0)
    expect(chunks[0].startVerseIndex).toBe(0)
    expect(chunks[0].endVerseIndex).toBe(1)
    expect(chunks[0].text).toBe('In the beginning God created the heavens.')
  })

  it('starting mid-chapter (startIndex > 0) only chunks from that verse forward', () => {
    const queue = buildChapterSpokenQueue([verse(1, 'First verse.'), verse(2, 'Second verse.'), verse(3, 'Third verse.')], 'GEN', 1)
    const chunks = buildLatencyChunks(queue, 1)
    expect(chunks[0].startVerseIndex).toBe(1)
    expect(chunks.every((c) => c.startVerseIndex >= 1)).toBe(true)
  })

  it('a long run with no sentence end anywhere still produces multiple chunks (safety valve)', () => {
    const noPunctuation = Array.from({ length: 100 }, (_, i) => `word${i}`).join(' ')
    const queue = buildChapterSpokenQueue([verse(1, noPunctuation)], 'GEN', 1)
    const chunks = buildLatencyChunks(queue, 0)
    expect(chunks.length).toBeGreaterThan(2)
  })

  it('verseCharOffsets let a local charIndex be recovered back to each verse\'s own coordinate space', () => {
    const queue = buildChapterSpokenQueue([verse(1, 'Alpha beta.'), verse(2, 'Gamma delta.')], 'GEN', 1)
    const chunks = buildLatencyChunks(queue, 0)
    const chunk = chunks[0]
    for (const verseIndex of [chunk.startVerseIndex, chunk.endVerseIndex]) {
      const offset = chunk.verseCharOffsets.get(verseIndex)
      expect(offset).toBeDefined()
      const v = queue[verseIndex]
      for (const word of v.words) {
        const chunkCharIndex = word.charStart + (offset ?? 0)
        expect(chunk.text.slice(chunkCharIndex, chunkCharIndex + word.charLen)).toBe(word.text)
      }
    }
  })

  it('an empty queue produces no chunks', () => {
    expect(buildLatencyChunks([], 0)).toEqual([])
  })
})
