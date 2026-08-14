/**
 * Read Aloud (TTS) — builds the flat spoken-text string + word-alignment table for a verse
 * or a whole chapter. Pure functions, no React/DOM/Web Speech dependency, so they're testable
 * and reusable from both the orchestration hook (useTTSPlayback.ts) and ttsEngine.ts.
 *
 * Per the "speak everything naturally" decision: bracketed/annotated text (KJV italics, LXX
 * supply words, Enoch restored/uncertain markers, Jubilees date/stanza/bracket markers) is
 * spoken as continuous text — nothing is skipped or paused for. Only true non-English tokens
 * (Strong's-only alignment markers / parenthetical grammatical particles with no English word)
 * are excluded, mirroring VerseRow.tsx's own isParenthetical/isStrongsBracket handling.
 */
import { parseTaggedTokens } from '@/lib/taggedTokens'
import { applyWordReplacer, applyStrongsWordReplacer } from '@/lib/wordReplacer'
import { prepareWordForSpeech } from './textPrep'
import type { Verse } from '@/types'
import type { WordReplacerRule } from '@/store'

export interface SpokenWord {
  text: string
  /** Offset of this word's first character within the verse's flat `spokenText` string. */
  charStart: number
  charLen: number
  /** Index of this word within the verse's own word list (0-based). Used to map an
   *  `onboundary` charIndex back to a word, and to drive VerseRow's word-highlight prop. */
  wordIndex: number
}

export interface SpokenVerse {
  bookId: string
  chapter: number
  verseNum: number
  words: SpokenWord[]
  spokenText: string
}

/**
 * Build the spoken-word alignment for a single verse. Reuses the shared tagged-token parser
 * (taggedTokens.ts) when `verse.text_tagged` is present — same source both VerseRow.tsx and
 * TTS use — and reproduces VerseRow's char-offset accumulation loop (word.length + 1 per
 * token, skipping parenthetical/bracket tokens) so word indices line up with what's rendered.
 * Falls back to a plain `verse.text.split(' ')` for texts without `text_tagged` (Enoch,
 * Jubilees, Apocrypha, etc.), matching VerseRow's own plain-word-split fallback.
 */
export function buildSpokenWords(
  verse: Verse,
  wordReplacerRules: WordReplacerRule[] = [],
): { words: SpokenWord[]; spokenText: string } {
  if (verse.text_tagged) {
    const tokens = parseTaggedTokens(verse.text_tagged)

    // Pass 1: replace each spoken token's word (text-pattern rules, then Strong's-number
    // rules — same two-pass order VerseRow.tsx uses, VerseRow.tsx ~884-890), and note which
    // ones were replaced BY a Strong's-number rule specifically (not just any replacement —
    // matches VerseRow's own `activeStrongsRules` check exactly).
    const activeStrongsRules = wordReplacerRules.filter(r => r.enabled && r.strongsNum)
    const replaced: Array<{ word: string; isStrongsReplaced: boolean }> = []
    for (const t of tokens) {
      if (t.isParenthetical || t.isStrongsBracket) continue // no English word — not spoken
      if (!t.word) continue
      let spokenWord = wordReplacerRules.length > 0 ? applyWordReplacer(t.word, wordReplacerRules) : t.word
      spokenWord = applyStrongsWordReplacer(spokenWord, t.strongsNum, wordReplacerRules)
      // Number/abbreviation/punctuation text prep runs LAST, after divine-name substitution —
      // it only ever changes how a word is voiced (numerals, abbreviations, dash/ellipsis
      // punctuation), never which word was substituted in above.
      spokenWord = prepareWordForSpeech(spokenWord)
      let isStrongsReplaced = false
      if (t.strongsNum && activeStrongsRules.length > 0) {
        const nums = Array.isArray(t.strongsNum) ? t.strongsNum : [t.strongsNum]
        isStrongsReplaced = activeStrongsRules.some(r => nums.includes(r.strongsNum!))
      }
      replaced.push({ word: spokenWord, isStrongsReplaced })
    }

    // Pass 2: when a token was replaced by a Strong's rule (e.g. LORD→Yehovah), an
    // immediately preceding bare "the"/"The" reads wrong out loud ("the Yehovah") — exactly
    // the same fix VerseRow.tsx already applies to what's rendered on screen (suppressing that
    // token instead of drawing it). This was missing here entirely: TTS built its spoken text
    // straight from text_tagged with no awareness of that suppression, so Read Aloud kept
    // saying "the Yehovah" out loud even once the screen correctly showed just "Yehovah" —
    // reported as "the word replacer... saying 'the Yehovah'". Blank the preceding word's TEXT
    // (not remove its slot) so wordIndex numbering stays aligned 1:1 with VerseRow's own
    // spokenIndex numbering, which likewise keeps a slot for the suppressed "the" without
    // rendering it — removing the slot here instead would shift every later wordIndex by one
    // and desync word-highlight from what's on screen.
    for (let i = 0; i < replaced.length; i++) {
      if (!replaced[i].isStrongsReplaced) continue
      const prev = replaced[i - 1]
      if (prev && prev.word.replace(/[,;:.!?]+$/, '').toLowerCase() === 'the') prev.word = ''
    }

    // Pass 3: compute char offsets from the (possibly blanked) words — after blanking, not
    // before, so charStart/charLen stay internally consistent with the final `spokenText`.
    const words: SpokenWord[] = []
    const parts: string[] = []
    let charPos = 0
    replaced.forEach(({ word: spokenWord }, wordIndex) => {
      const charStart = charPos
      words.push({ text: spokenWord, charStart, charLen: spokenWord.length, wordIndex })
      parts.push(spokenWord)
      // +1 for the trailing space. Uses the REPLACED (and possibly blanked) word's length,
      // same as VerseRow's own char-offset accumulation does for its display text.
      charPos += spokenWord.length + 1
    })
    return { words, spokenText: parts.join(' ') }
  }

  // Plain-text fallback (same split convention as VerseRow.tsx's `words = verse.text.split(' ')`)
  const raw = verse.text.split(' ')
  const words: SpokenWord[] = []
  let charPos = 0
  raw.forEach((w, i) => {
    if (!w) { charPos += 1; return }
    let spokenWord = wordReplacerRules.length > 0 ? applyWordReplacer(w, wordReplacerRules) : w
    spokenWord = prepareWordForSpeech(spokenWord)
    words.push({ text: spokenWord, charStart: charPos, charLen: spokenWord.length, wordIndex: i })
    charPos += spokenWord.length + 1
  })
  return { words, spokenText: raw.filter(Boolean).join(' ') }
}

/** Maps a chapter's verses into the per-verse spoken queue used by ttsEngine.ts. */
export function buildChapterSpokenQueue(
  verses: Verse[],
  bookId: string,
  chapter: number,
  wordReplacerRules: WordReplacerRule[] = [],
): SpokenVerse[] {
  return verses.map((v) => {
    const { words, spokenText } = buildSpokenWords(v, wordReplacerRules)
    return { bookId, chapter, verseNum: v.verse_num, words, spokenText }
  })
}

/** A chunk of spoken text that spans one or more verses (or a partial verse, when the
 *  safety-valve length cap below splits mid-verse), built at real SENTENCE granularity rather
 *  than verse or whole-chapter granularity. See ttsEngine.ts's file-level doc comment for why:
 *  in short, one utterance per verse sounds choppy (every verse boundary gets an audible
 *  onset/decay transient) and one utterance per chapter both risks a ~15s Chromium auto-cutoff
 *  bug on long chapters AND degrades pacing/naturalness on long inputs generally. Sentence-level
 *  chunking is the natural middle ground: chunk boundaries land where a real pause belongs
 *  (true sentence ends), and chunks stay short by construction. */
export interface SentenceChunk {
  text: string
  /** Queue index (absolute index into the SpokenVerse[] passed to buildSentenceChunks) -> the
   *  offset to SUBTRACT from a charIndex within `text` to recover that verse's own verse-local
   *  charIndex (i.e. the same coordinate space as that verse's `words[].charStart`). Not simply
   *  "where this verse's text starts in the chunk" when a chunk begins mid-verse (the safety
   *  valve split mid-verse last chunk) — it's computed per-word so the formula
   *  `localCharIndex = chunkCharIndex - verseCharOffsets.get(verseIndex)` still holds even then. */
  verseCharOffsets: Map<number, number>
  startVerseIndex: number
  endVerseIndex: number
}

// Only a true sentence-ender (period/exclamation/question, optionally followed by a closing
// quote/paren/bracket) closes a chunk. Semicolons and colons are NOT full sentence boundaries in
// KJV prose (e.g. Gen 1:2's "...void; and darkness...") — they stay embedded as normal
// punctuation inside a chunk and rely on the engine's own native pause-shaping for them, rather
// than forcing an oversized paragraph-style break at every one.
// Exported for ttsEngine.ts, which reuses it (against a whole chunk's `text`) to tell whether a
// given chunk ended at a real sentence boundary vs. a safety-valve mid-clause cut — that
// distinction drives both the "final lengthening" rate reduction and the inter-chunk pause
// length (see ttsEngine.ts's playChunk()).
export const SENTENCE_END_RE = /[.!?]['")\]]*$/
// Used only by the safety-valve max-length split, to prefer breaking at a natural clause
// boundary (comma/semicolon/colon) over an arbitrary mid-clause word boundary. Exported for
// kokoroChunking.ts, which reuses the same clause-preference logic for its own (differently
// motivated — latency, not cutoff-avoidance) chunk-length cap.
export const CLAUSE_BREAK_RE = /[,;:]['")\]]*$/
// Any chunk shorter than this (in characters) gets merged into the PRECEDING chunk rather than
// spoken as its own isolated utterance — see mergeShortChunks() below. Targets short trailing
// clauses (e.g. a 3-word "a lying tongue." sentence) that sound isolated/clipped when spoken
// alone; research-backed guidance (see Part 1 of the round-11.9 plan) says these read more
// naturally attached to what came before them.
const MIN_CHUNK_CHARS = 24
// Round-11.13: a SEPARATE, purpose-distinct cap from `maxChars` below. `maxChars` exists purely
// to dodge Chromium's ~15s cutoff bug and scales with rate (wall-clock time is what matters
// there). This one exists because long sentences degrade naturalness/pacing on their OWN merits,
// independent of any cutoff risk — community guidance on making synthetic speech sound less
// robotic (multiple TTS-quality writeups, converging on the same number) consistently flags
// sentences over roughly 20-25 words as a source of monotone, rushed-sounding delivery, since
// the engine has to model prosody across the whole thing at once. KJV epistles routinely run
// compound sentences well past that. Deliberately NOT scaled by rate — a long sentence structurally
// reads as flat regardless of how fast/slow it's spoken, unlike the cutoff-bug risk which is
// purely a function of wall-clock duration.
const MAX_CHUNK_WORDS = 24

/**
 * Walks the chapter's spoken queue from `startIndex`, grouping verses' words into chunks that
 * each end at a real sentence boundary — spanning across verse boundaries when a sentence
 * continues past one (the normal KJV pattern), and splitting a single verse across multiple
 * chunks if it contains more than one complete sentence itself.
 *
 * A safety valve caps chunk length so a pathologically long "sentence" (some KJV epistle
 * sentences run for many verses) can't produce a single utterance long enough to risk Chromium's
 * long-utterance auto-cutoff bug or degrade pacing on its own: if a chunk would exceed
 * `maxChars` (cutoff-risk, scales with `rate`) OR `MAX_CHUNK_WORDS` (a flat, rate-independent
 * naturalness cap — see its own doc comment), it's cut instead at the nearest preceding
 * comma/semicolon/colon, or (failing that) at the current word boundary. `rate` scales `maxChars`
 * because a slower rate means more wall-clock time per character — the wall-clock budget, not
 * the character budget, is what actually matters for the cutoff bug, so a slower rate needs a
 * shorter text budget to match.
 */
export function buildSentenceChunks(queue: SpokenVerse[], startIndex: number, rate = 1): SentenceChunk[] {
  // ~13 chars/sec baseline speaking pace × 10s safety margin under the ~15s bug threshold.
  // A reasonable starting estimate tuned during manual testing, not a measured constant for
  // these specific voices.
  const maxChars = Math.max(60, Math.round(13 * 10 * rate))

  type Item = { verseIndex: number; word: SpokenWord }
  const items: Item[] = []
  for (let vi = startIndex; vi < queue.length; vi++) {
    for (const w of queue[vi].words) items.push({ verseIndex: vi, word: w })
  }

  const chunks: SentenceChunk[] = []
  let idx = 0
  while (idx < items.length) {
    const chunkStart = idx
    let chunkEnd = idx // exclusive upper bound, computed below
    let pos = 0
    let wordCount = 0
    while (chunkEnd < items.length) {
      const word = items[chunkEnd].word.text
      pos += (chunkEnd > chunkStart ? 1 : 0) + word.length // separator + word
      wordCount++
      if (SENTENCE_END_RE.test(word)) { chunkEnd++; break }
      if (pos >= maxChars || wordCount >= MAX_CHUNK_WORDS) {
        // Safety valve: prefer cutting at the last clause-break word within this chunk so far;
        // fall back to cutting right here (a plain word boundary) if none exists.
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
  }
  return mergeShortChunks(chunks)
}

/**
 * Post-processing pass over a freshly-built chunk list: any chunk shorter than
 * `MIN_CHUNK_CHARS` gets folded into the chunk immediately BEFORE it (not after — a short
 * trailing clause belongs attached to what preceded it, not spoken alone). The very first chunk
 * of a run can never be merged (there's nothing preceding it to merge into), which is exactly
 * the "skip the first chunk" behavior the round-11.9 plan calls for — it falls out of the loop
 * structure below without special-casing.
 *
 * Merging two chunks means concatenating their `text` with a single-space separator AND
 * re-basing the shorter chunk's `verseCharOffsets` by the preceding chunk's original text
 * length + 1 (the separator) — dropping that bookkeeping would desync word/verse highlighting
 * for any verse whose words end up split across the merge point.
 */
function mergeShortChunks(chunks: SentenceChunk[]): SentenceChunk[] {
  const merged: SentenceChunk[] = []
  for (const chunk of chunks) {
    const prev = merged[merged.length - 1]
    if (prev && chunk.text.length < MIN_CHUNK_CHARS) {
      const rebase = prev.text.length + 1 // preceding chunk's length + the space separator
      for (const [verseIndex, offset] of chunk.verseCharOffsets) {
        // A verse already present in `prev` (i.e. it straddles the merge point) keeps its
        // existing offset — that offset is already correct relative to `prev.text`, which is
        // untouched by the merge (only appended to).
        if (!prev.verseCharOffsets.has(verseIndex)) prev.verseCharOffsets.set(verseIndex, offset + rebase)
      }
      prev.text = `${prev.text} ${chunk.text}`
      prev.endVerseIndex = chunk.endVerseIndex
    } else {
      merged.push({ ...chunk, verseCharOffsets: new Map(chunk.verseCharOffsets) })
    }
  }
  return merged
}

/** Finds the SpokenWord whose [charStart, charStart+charLen) range contains `charIndex`,
 *  falling back to the nearest word by linear scan (Web Speech `onboundary` charIndex values
 *  are not always exact word starts across every voice/platform). Returns null for an empty
 *  word list (e.g. a verse.text_tagged verse consisting only of Strong's alignment markers). */
export function findWordAtCharIndex(words: SpokenWord[], charIndex: number): SpokenWord | null {
  if (words.length === 0) return null
  for (const w of words) {
    if (charIndex >= w.charStart && charIndex < w.charStart + w.charLen) return w
  }
  // Fallback: nearest word start at or before charIndex
  let best: SpokenWord | null = null
  for (const w of words) {
    if (w.charStart <= charIndex && (!best || w.charStart > best.charStart)) best = w
  }
  return best ?? words[0]
}
