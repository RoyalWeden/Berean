/**
 * Read Aloud (TTS) — word/verse timestamp estimation for the Kokoro backend.
 *
 * Kokoro (via `kokoro-js`'s public `KokoroTTS`/`stream()` API — see kokoro.worker.ts for what
 * was actually checked before committing to this) does NOT expose forced-alignment word
 * timestamps. A `Kokoro-82M-v1.0-ONNX-timestamped` model variant that DOES exists, but pulling
 * it in would mean a second, larger model download and a different inference path just for
 * this — out of scope for this pass. The documented, honest fallback (per the kickoff brief):
 * measure each synthesized chunk's REAL audio duration (Kokoro always outputs real audio, so
 * this is exact, not guessed) and distribute it across that chunk's characters proportionally.
 * This is strictly better than Web Speech's `onboundary` event, which is Chromium's own
 * best-effort guess with no real audio-duration ground truth behind it at all — but it IS still
 * an approximation (real speech doesn't move through text at a constant char/sec rate — longer
 * words and punctuation pauses skew it), which is why every symbol here says "estimate", not
 * "measure".
 */
import type { SentenceChunk, SpokenVerse, SpokenWord } from '../extractSpokenText'

/** One estimated word-boundary event within a chunk's playback, in the same coordinate space
 *  `useTTSPlayback.ts`/`VerseRow.tsx` already consume via `TTSBackend`'s `onVerseStart`/
 *  `onWordBoundary` callbacks — see ttsBackend.ts. `atSec` is relative to the START of the
 *  chunk's own audio playback, not the whole chapter. */
export interface WordTimingEvent {
  atSec: number
  verseIndex: number
  word: SpokenWord
}

/**
 * Given a chunk (built by buildLatencyChunks) and the chapter's spoken queue (for verse
 * boundaries), distribute `durationSec` of REAL synthesized audio across every word in the
 * chunk proportionally to that word's character span within `chunk.text`. Returns events in
 * playback order, one per word, so the caller can drive a simple "fire the next event once
 * playback time passes its atSec" scheduler (see kokoroBackend.ts).
 */
export function estimateWordTimings(
  chunk: SentenceChunk,
  queue: SpokenVerse[],
  durationSec: number,
): WordTimingEvent[] {
  const totalChars = chunk.text.length
  if (totalChars <= 0 || durationSec <= 0) return []

  const collected: Array<{ chunkCharStart: number; verseIndex: number; word: SpokenWord }> = []
  for (let verseIndex = chunk.startVerseIndex; verseIndex <= chunk.endVerseIndex; verseIndex++) {
    const verse = queue[verseIndex]
    if (!verse) continue
    const offset = chunk.verseCharOffsets.get(verseIndex)
    // A verse with no offset recorded for this chunk means none of its words actually fall
    // within this chunk's [0, totalChars) span (can happen for an empty/blank verse sitting
    // between two spoken ones) — nothing to time for it.
    if (offset === undefined) continue
    for (const word of verse.words) {
      if (!word.text) continue // blanked word-replacer slot (see extractSpokenText.ts) — not spoken
      const chunkCharStart = word.charStart + offset
      if (chunkCharStart < 0 || chunkCharStart >= totalChars) continue
      collected.push({ chunkCharStart, verseIndex, word })
    }
  }
  collected.sort((a, b) => a.chunkCharStart - b.chunkCharStart)

  // ── Weighted, not linear ───────────────────────────────────────────────────
  // The obvious model — `atSec = (charStart / totalChars) * duration` — assumes speech advances
  // through text at a constant characters-per-second rate. It doesn't, and the two places it is
  // most wrong are exactly the places a reader notices:
  //
  //  - PUNCTUATION CONSUMES TIME WITHOUT CONSUMING CHARACTERS. A comma is one character but a
  //    real pause; a full stop is longer still. Under the linear model every word after the
  //    first clause boundary is early, and the error ACCUMULATES along the chunk — so the
  //    highlight drifts further ahead the longer the sentence runs. Heavily-punctuated poetry
  //    (Psalms) is the worst case, which is where mis-highlighting was most visible.
  //  - EVERY WORD HAS A FIXED ONSET COST regardless of length. Purely length-proportional timing
  //    makes short words ("a", "of", "the") far too fast and long ones too slow.
  //
  // So each word is weighted by its length + a flat per-word onset + a pause charge for trailing
  // punctuation, and the duration is distributed across the SUM of those weights. Still an
  // estimate — true forced alignment needs the timestamped model variant (see this file's
  // header) — but it models where the time actually goes instead of assuming it is uniform.
  const WORD_ONSET_WEIGHT = 2.2
  const CLAUSE_PAUSE_WEIGHT = 5
  const SENTENCE_PAUSE_WEIGHT = 11

  function pauseWeightFor(text: string): number {
    if (/[.!?]['")\]]*$/.test(text)) return SENTENCE_PAUSE_WEIGHT
    if (/[,;:]['")\]]*$/.test(text)) return CLAUSE_PAUSE_WEIGHT
    return 0
  }

  const weights = collected.map((c) => c.word.text.length + WORD_ONSET_WEIGHT + pauseWeightFor(c.word.text))
  const totalWeight = weights.reduce((a, b) => a + b, 0)
  if (totalWeight <= 0) return []

  const events: WordTimingEvent[] = []
  let cumulative = 0
  for (let i = 0; i < collected.length; i++) {
    // A word highlights from the moment it STARTS being spoken, so its event fires at the
    // cumulative weight BEFORE it. A trailing pause is charged to the word that precedes it,
    // which is precisely what stops the following word from firing early.
    events.push({ atSec: (cumulative / totalWeight) * durationSec, verseIndex: collected[i].verseIndex, word: collected[i].word })
    cumulative += weights[i]
  }
  return events
}

/**
 * Given a sorted `events` list and the current elapsed playback time within the chunk, returns
 * the index of the LAST event whose `atSec` has already been reached (i.e. every event up to
 * and including it should have already been fired), searching forward from `fromIndex` (the
 * index most recently fired) rather than from the start — playback time only moves forward
 * during normal playback, so this keeps the per-tick scan O(events since last tick) instead of
 * O(all events) for a long chunk polled many times. Returns `fromIndex - 1` (no new events) if
 * nothing new has been reached yet.
 */
export function advanceToTime(events: WordTimingEvent[], currentTimeSec: number, fromIndex: number): number {
  let i = fromIndex
  while (i + 1 < events.length && events[i + 1].atSec <= currentTimeSec) i++
  return i
}
