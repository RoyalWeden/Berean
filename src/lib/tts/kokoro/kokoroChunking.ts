/**
 * Read Aloud (TTS) — chunking for the Kokoro neural backend. Deliberately a SEPARATE function
 * from `buildSentenceChunks` in extractSpokenText.ts, not a shared one with different
 * constants: that function's word/char caps exist ONLY to dodge Web Speech's ~15s Chromium
 * auto-cutoff bug (see webSpeechBackend.ts's file header) and to avoid Web Speech's own
 * long-sentence prosody degradation. Kokoro has neither problem — it synthesizes a whole chunk
 * as one real audio buffer, and (per the kickoff brief) handles long-sentence prosody BETTER
 * than a short-chunked one. Reusing the Web Speech caps here would only add unnecessary chunk
 * boundaries, hurting the exact thing Kokoro is good at.
 *
 * What Kokoro chunking IS for: latency and streaming. Synthesizing an entire chapter as one
 * `generate()` call would mean the user hears nothing until the whole chapter is done — this
 * chunks it instead so playback can start after the FIRST small chunk finishes synthesizing,
 * while later (larger) chunks keep synthesizing ahead of playback in the background.
 */
import { SENTENCE_END_RE, CLAUSE_BREAK_RE } from '../extractSpokenText'
import type { SpokenVerse, SentenceChunk } from '../extractSpokenText'

// The very first chunk of a `speakChapter`/`skipToVerse` run is capped much smaller than the
// rest purely so synthesis (and therefore audible playback) starts as fast as possible — the
// user shouldn't wait for a whole paragraph to synthesize before hearing anything. Every
// chunk after it can be larger since by then playback is already underway and synthesis is
// racing ahead of it in the background, not blocking it.
const FIRST_CHUNK_MAX_WORDS = 12
const STREAM_CHUNK_MAX_WORDS = 40

/**
 * Walks the chapter's spoken queue from `startIndex`, grouping verses' words into chunks that
 * each end at a real sentence boundary (same `SENTENCE_END_RE` KJV-aware sentence detector
 * `buildSentenceChunks` uses — semicolons/colons stay embedded, only true sentence-enders
 * close a chunk), with a word-count safety valve so no single chunk is large enough to stall
 * the "start playback fast" goal. The very first chunk gets a much smaller cap than the rest —
 * see FIRST_CHUNK_MAX_WORDS's doc comment.
 */
export function buildLatencyChunks(queue: SpokenVerse[], startIndex: number): SentenceChunk[] {
  type Item = { verseIndex: number; word: SpokenVerse['words'][number] }
  const items: Item[] = []
  for (let vi = startIndex; vi < queue.length; vi++) {
    for (const w of queue[vi].words) items.push({ verseIndex: vi, word: w })
  }

  const chunks: SentenceChunk[] = []
  let idx = 0
  let isFirstChunk = true
  while (idx < items.length) {
    const chunkStart = idx
    let chunkEnd = idx
    let wordCount = 0
    const maxWords = isFirstChunk ? FIRST_CHUNK_MAX_WORDS : STREAM_CHUNK_MAX_WORDS
    while (chunkEnd < items.length) {
      const word = items[chunkEnd].word.text
      wordCount++
      if (SENTENCE_END_RE.test(word)) { chunkEnd++; break }
      if (wordCount >= maxWords) {
        // Prefer cutting at the last clause boundary (comma/semicolon/colon) seen so far in
        // this chunk, same "cut somewhere a pause naturally belongs" preference the Web Speech
        // chunker uses — falls back to the raw word boundary if no clause break exists yet.
        let cut = chunkEnd
        for (let k = chunkEnd; k > chunkStart; k--) {
          if (CLAUSE_BREAK_RE.test(items[k].word.text)) { cut = k; break }
        }
        chunkEnd = cut + 1
        break
      }
      chunkEnd++
    }
    if (chunkEnd <= chunkStart) chunkEnd = chunkStart + 1 // always make progress

    const parts: string[] = []
    const verseCharOffsets = new Map<number, number>()
    let chunkPos = 0
    for (let k = chunkStart; k < chunkEnd; k++) {
      const { verseIndex, word } = items[k]
      if (k > chunkStart) { parts.push(' '); chunkPos += 1 }
      if (!verseCharOffsets.has(verseIndex)) verseCharOffsets.set(verseIndex, chunkPos - word.charStart)
      parts.push(word.text)
      chunkPos += word.text.length
    }
    chunks.push({
      text: parts.join(''),
      verseCharOffsets,
      startVerseIndex: items[chunkStart].verseIndex,
      endVerseIndex: items[chunkEnd - 1].verseIndex,
    })
    idx = chunkEnd
    isFirstChunk = false
  }
  return chunks
}
