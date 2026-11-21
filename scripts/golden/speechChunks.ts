/** Original Kokoro latency chunks, over already-prepared synthetic word queues. */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { buildLatencyChunks } from '../../src/lib/tts/kokoro/kokoroChunking'
import type { SpokenVerse } from '../../src/lib/tts/extractSpokenText'

function queue(verses: string[][]): SpokenVerse[] {
  return verses.map((words, vi) => {
    let position = 0
    const prepared = words.map((text, wordIndex) => {
      const word = { text, wordIndex, charStart: position, charLen: text.length }
      position += text.length + 1
      return word
    })
    return { bookId: 'GEN', chapter: 1, verseNum: vi + 1, words: prepared, spokenText: words.join(' ') }
  })
}

export function buildSpeechChunksGolden(): { name: string; data: unknown } {
  const samples = [
    [], [[]], [['Hi', 'there.', 'This', 'continues.']],
    [['In', 'the', 'beginning'], ['God', 'created', 'the', 'heavens.']],
    [Array.from({ length: 110 }, (_, i) => `word${i}`)],
    [Array.from({ length: 90 }, (_, i) => `word${i}${i % 9 === 4 ? ',' : ''}`)],
    [['One;', 'two:', 'three,', 'four!\"]', 'Five?', 'Six.)']],
    [['α😀', 'é', '', 'word', 'two words', 'ending.'], [], ['Next', 'verse.']],
    [['First', 'verse.'], ['Second', 'verse.'], ['Third', 'verse.']],
    [['one.\n', 'two?\r', 'three!\r\n', 'four.\u2028', 'five.\u2029', 'end.']],
    ...[11, 12, 13, 39, 40, 41, 52, 53].map(length => [
      Array.from({ length }, (_, i) => `term${i}${i === 5 ? ';' : i === 10 ? ':' : ''}`), ['Done.'],
    ]),
  ]
  const cases = samples.flatMap(sample => {
    const verses = queue(sample)
    return Array.from({ length: verses.length + 1 }, (_, startIndex) => ({
      queue: verses.map(v => v.words), startIndex,
      output: buildLatencyChunks(verses, startIndex).map(chunk => ({
        ...chunk, verseCharOffsets: [...chunk.verseCharOffsets.entries()],
      })),
    }))
  })
  const root = resolve(__dirname, '../..')
  const sources = ['src/lib/tts/kokoro/kokoroChunking.ts', 'src/lib/tts/extractSpokenText.ts']
  return { name: 'speech-chunks', data: { format: 1,
    sources: Object.fromEntries(sources.map(path => [path, createHash('sha256').update(readFileSync(resolve(root, path))).digest('hex')])), cases } }
}
