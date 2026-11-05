// Serializable research payload carried on an AI Lookup response (main → renderer, and iPhone's
// in-WebView service → UI). Everything here is verified local data — no model output.

import type { LexicalIntentKind } from './lexicalIntent'
import type { LexicalMatchKind, LexicalResolution } from './lexicon'
import type { TaggedToken, TagCoverage } from './taggedText'
import type { StrongsLang } from './strongsId'

export interface ResearchStrongsCandidate {
  id: string
  lang: StrongsLang
  lemma: string
  transliteration: string
  gloss: string
  definition: string
  derivation: string
  /** The lexicon file's own count; its basis varies by lexicon, so it is labelled "per lexicon". */
  lexiconCount: number
  match: LexicalMatchKind
  /** KJV verses rendering this lemma with the queried English word (`forms`). 0 for non-English matches. */
  kjvRenderingCount: number
  forms: string[]
}

export interface WordTableToken extends TaggedToken {
  entries: Array<{ id: string; lemma: string; transliteration: string; gloss: string }>
}

export interface WordTableVerse {
  verse: number
  text: string
  tokens: WordTableToken[]
  coverage: TagCoverage
}

export interface WordTable {
  textId: string
  bookId: string
  chapter: number
  verses: WordTableVerse[]
  /** The text has no `text_tagged` column at all (pseudepigrapha, plain KJV). */
  untaggedText: boolean
}

export interface OccurrenceSummary {
  id: string
  /** Verses containing the tag, per text, over the whole text (not a scan sample). */
  totals: Array<{ textId: string; verses: number }>
  byBook: Array<{ textId: string; bookId: string; verses: number }>
  bookId?: string
}

export interface ResearchPayload {
  kind: LexicalIntentKind
  /** The word, transliteration or script the user studied, when it wasn't an id. */
  term?: string
  candidates: ResearchStrongsCandidate[]
  ambiguous: boolean
  wordTables: WordTable[]
  occurrences: OccurrenceSummary[]
  /** Factual limitations (missing data, partial coverage) to show with the answer. */
  limitations: string[]
  /** For a Strong's comparison: KJV renderings the entries share, and each one's own (from the
   *  lexicon's rendering lists — attested wording, not an interpretation). */
  comparison?: { shared: string[]; only: Record<string, string[]> }
  method: 'deterministic'
}

export function candidatesFromResolution(res: LexicalResolution | undefined): ResearchStrongsCandidate[] {
  if (!res) return []
  return res.candidates.map((c) => ({
    id: c.entry.id, lang: c.entry.lang, lemma: c.entry.lemma, transliteration: c.entry.transliteration,
    gloss: c.entry.gloss, definition: c.entry.definition, derivation: c.entry.derivation, lexiconCount: c.entry.lexiconCount,
    match: c.match, kjvRenderingCount: c.kjvRenderingCount, forms: c.forms,
  }))
}
