import { describe, it, expect } from 'vitest'
import { estimateWordTimings, advanceToTime } from '../timestampAlignment'
import { buildLatencyChunks } from '../kokoroChunking'
import { buildChapterSpokenQueue } from '../../extractSpokenText'
import type { Verse } from '@/types'

function verse(num: number, text: string): Verse {
  return { verse_num: num, book_id: 'gen', chapter: 1, text, text_tagged: null as unknown as string }
}

describe('estimateWordTimings', () => {
  it('distributes duration across words proportionally to character position, in ascending order', () => {
    const queue = buildChapterSpokenQueue([verse(1, 'Hi there friend.')], 'GEN', 1)
    const chunk = buildLatencyChunks(queue, 0)[0]
    const events = estimateWordTimings(chunk, queue, 3) // 3 real seconds of audio
    expect(events.map((e) => e.word.text)).toEqual(['Hi', 'there', 'friend.'])
    expect(events[0].atSec).toBe(0) // first word always starts at t=0
    for (let i = 1; i < events.length; i++) expect(events[i].atSec).toBeGreaterThan(events[i - 1].atSec)
    expect(events[events.length - 1].atSec).toBeLessThan(3)
  })

  it('a chunk spanning multiple verses maps each word to its own correct verseIndex', () => {
    const queue = buildChapterSpokenQueue([verse(1, 'In the beginning'), verse(2, 'God created.')], 'GEN', 1)
    const chunk = buildLatencyChunks(queue, 0)[0] // spans both verses (no sentence end until verse 2)
    const events = estimateWordTimings(chunk, queue, 2)
    expect(events.filter((e) => e.verseIndex === 0).map((e) => e.word.text)).toEqual(['In', 'the', 'beginning'])
    expect(events.filter((e) => e.verseIndex === 1).map((e) => e.word.text)).toEqual(['God', 'created.'])
  })

  it('returns no events for zero/negative duration', () => {
    const queue = buildChapterSpokenQueue([verse(1, 'Hello world.')], 'GEN', 1)
    const chunk = buildLatencyChunks(queue, 0)[0]
    expect(estimateWordTimings(chunk, queue, 0)).toEqual([])
    expect(estimateWordTimings(chunk, queue, -1)).toEqual([])
  })

  it('skips blanked (word-replacer-suppressed) words, which have empty text', () => {
    const queue = buildChapterSpokenQueue([verse(1, 'Hello world.')], 'GEN', 1)
    queue[0].words[0].text = '' // simulate a blanked word-replacer slot
    const chunk = buildLatencyChunks(queue, 0)[0]
    const events = estimateWordTimings(chunk, queue, 2)
    expect(events.some((e) => e.word.text === '')).toBe(false)
  })
})

describe('advanceToTime', () => {
  const events = [
    { atSec: 0, verseIndex: 0, word: { text: 'a', charStart: 0, charLen: 1, wordIndex: 0 } },
    { atSec: 0.5, verseIndex: 0, word: { text: 'b', charStart: 2, charLen: 1, wordIndex: 1 } },
    { atSec: 1.2, verseIndex: 1, word: { text: 'c', charStart: 0, charLen: 1, wordIndex: 0 } },
  ]

  it('returns -1 (no events fired) before the first event\'s time', () => {
    expect(advanceToTime(events, -0.1, -1)).toBe(-1)
  })

  it('advances one event at a time as playback time passes each atSec', () => {
    expect(advanceToTime(events, 0.6, -1)).toBe(1)
    expect(advanceToTime(events, 1.5, 1)).toBe(2)
  })

  it('never regresses past the already-fired index when called again with the same/lower time', () => {
    const idx = advanceToTime(events, 0.6, -1)
    expect(advanceToTime(events, 0.3, idx)).toBe(idx)
  })

  it('is a no-op once every event has fired', () => {
    const last = advanceToTime(events, 100, -1)
    expect(advanceToTime(events, 200, last)).toBe(last)
  })
})
