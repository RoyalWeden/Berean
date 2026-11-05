// Deterministic word-by-word tokens from a verse's `text_tagged` column (spec §4.2, §6.1 #4).
//
// Format (verified against kjva.db, lxx_brenton.db and lxx.db, 2026-10-28):
//   `beginning{H7225}`   a word and the Strong's number(s) attached to it
//   `{H1697|H1696}`      several numbers on one word, pipe-separated
//   `the{}`              a word with no Strong's number
//   `*was{}`             leading `*` — a KJV supplied (italic) word
//   `!Blessed{G3107}`    leading `!` — red-letter text (words attributed to Yeshua)
//   `~{H853}`            a tagged source word with no English rendering (e.g. the Hebrew object marker)
// Punctuation stays attached to the word (`world,{G2889}`); it is split off here so the table
// shows the word and its punctuation separately without inventing an alignment.

import { normalizeStrongsId } from './strongsId'

export interface TaggedToken {
  /** Position within the verse, 0-based, counting every token including untranslated ones. */
  index: number
  /** The word as displayed, without markers or trailing punctuation. Empty for untranslated tags. */
  word: string
  /** Leading/trailing punctuation that was attached to the word. */
  before: string
  after: string
  /** Canonical Strong's ids on this token (`[]` when the source leaves it untagged). */
  strongs: string[]
  /** The source tags this token as a Strong's word but gives it no English rendering (`~`). */
  untranslated: boolean
  /** KJV italic (translator-supplied) word. */
  supplied: boolean
  /** Red-letter word. */
  redLetter: boolean
}

const TOKEN_RE = /^([!*~]*)(.*?)\{([^}]*)\}$/u
const LEADING_PUNCT_RE = /^[\p{P}\p{S}]+/u
const TRAILING_PUNCT_RE = /[\p{P}\p{S}]+$/u

function splitPunctuation(word: string): { before: string; core: string; after: string } {
  const before = word.match(LEADING_PUNCT_RE)?.[0] ?? ''
  const rest = word.slice(before.length)
  const after = rest.match(TRAILING_PUNCT_RE)?.[0] ?? ''
  return { before, core: rest.slice(0, rest.length - after.length), after }
}

/** Parses `text_tagged`. Returns [] for empty input; tokens without braces are kept as untagged words. */
export function parseTaggedText(tagged: string | null | undefined): TaggedToken[] {
  if (!tagged) return []
  const out: TaggedToken[] = []
  for (const chunk of tagged.split(/\s+/u)) {
    if (!chunk) continue
    const m = chunk.match(TOKEN_RE)
    const markers = m ? m[1] : (chunk.match(/^[!*~]*/u)?.[0] ?? '')
    const rawWord = m ? m[2] : chunk.slice(markers.length)
    const tags = m ? m[3] : ''
    const strongs = tags
      .split('|')
      .map((t) => normalizeStrongsId(t))
      .filter((t): t is string => t !== null)
    const { before, core, after } = splitPunctuation(rawWord)
    const untranslated = markers.includes('~') || (core === '' && strongs.length > 0)
    out.push({
      index: out.length,
      word: core,
      before,
      after,
      strongs,
      untranslated,
      supplied: markers.includes('*'),
      redLetter: markers.includes('!'),
    })
  }
  return out
}

/** Lower-cased word with apostrophes normalized, for English-rendering indexes. */
export function englishKey(word: string): string {
  return word.toLowerCase().replace(/[‘’]/gu, "'")
}

export interface TagCoverage {
  tokens: number
  tagged: number
  untagged: number
}

/** How much of a verse the source actually tags — shown so a sparse table is never mistaken for a complete one. */
export function tagCoverage(tokens: TaggedToken[]): TagCoverage {
  const words = tokens.filter((t) => t.word !== '' || t.untranslated)
  const tagged = words.filter((t) => t.strongs.length > 0).length
  return { tokens: words.length, tagged, untagged: words.length - tagged }
}
