// Deterministic word-study resolution (spec §4.2, decision 8): English words, transliterations,
// original-script words and Strong's ids → verified lexicon candidates, grouped by language and
// ranked by attested evidence. Never a single guessed "best" number for an ambiguous word.
//
// Ranking evidence for an English word is how often the KJV actually renders each lemma with that
// word (counted from kjva `text_tagged`). The rendering index deliberately ignores Brenton's LXX
// English: its tag-to-word alignment is offset in places (verified on PSA 22:1), so counts there
// would be false precision.

import { englishKey, parseTaggedText } from './taggedText'
import { parseStrongsIds, parseBareStrongsNumbers, type StrongsLang } from './strongsId'

export interface LexiconEntryLite {
  id: string
  lang: StrongsLang
  lemma: string
  transliteration: string
  /** Strong's KJV-rendering list (`short_def`). */
  gloss: string
  /** Strong's definition (`full_def`). */
  definition: string
  derivation: string
  /** The lexicon file's own count (`occurrence_count`) — its basis differs per lexicon, so it is shown as "per lexicon". */
  lexiconCount: number
}

export type LexicalMatchKind = 'id' | 'kjv-rendering' | 'gloss' | 'transliteration' | 'original-script' | 'verse-token'

export interface LexicalCandidate {
  entry: LexiconEntryLite
  match: LexicalMatchKind
  /** KJV verses where this lemma is rendered by the queried English word (or one of `forms`). */
  kjvRenderingCount: number
  /** The English forms that were counted, e.g. ["mercy", "mercies"]. */
  forms: string[]
  score: number
}

export type LexicalQueryKind = 'id' | 'english' | 'transliteration' | 'original-script' | 'verse'

export interface LexicalResolution {
  query: string
  kind: LexicalQueryKind
  /** All candidates, best first. */
  candidates: LexicalCandidate[]
  hebrew: LexicalCandidate[]
  greek: LexicalCandidate[]
  /** True when more than one distinct lemma is a credible answer. */
  ambiguous: boolean
}

// ── Rendering index ────────────────────────────────────────────────────────────────────────

/** English word (lower-cased) → Strong's id → number of verses where that word carries that tag. */
export type RenderingIndex = Map<string, Map<string, number>>

export function buildRenderingIndex(taggedVerses: Iterable<string | null | undefined>): RenderingIndex {
  const index: RenderingIndex = new Map()
  for (const tagged of taggedVerses) {
    const perVerse = new Set<string>()
    for (const tok of parseTaggedText(tagged)) {
      if (!tok.word || tok.supplied || tok.strongs.length === 0) continue
      const key = englishKey(tok.word)
      for (const id of tok.strongs) {
        const pair = `${key}\u0000${id}`
        if (perVerse.has(pair)) continue
        perVerse.add(pair)
        let row = index.get(key)
        if (!row) { row = new Map(); index.set(key, row) }
        row.set(id, (row.get(id) ?? 0) + 1)
      }
    }
  }
  return index
}

/** Inflected English forms counted for a query word: plural, possessive and KJV verb endings. */
export function englishForms(word: string): string[] {
  const w = englishKey(word.trim())
  const forms = new Set([w, `${w}s`, `${w}es`, `${w}'s`, `${w}eth`, `${w}est`, `${w}ed`, `${w}ing`])
  if (w.endsWith('y') && !/[aeiou]y$/.test(w)) {
    const stem = w.slice(0, -1)
    forms.add(`${stem}ies`); forms.add(`${stem}ied`); forms.add(`${stem}ieth`)
  }
  if (w.endsWith('e')) {
    const stem = w.slice(0, -1)
    forms.add(`${w}d`); forms.add(`${w}th`); forms.add(`${w}st`); forms.add(`${stem}ing`)
  }
  return [...forms]
}

// ── Normalization ──────────────────────────────────────────────────────────────────────────

const HEBREW_POINTS_RE = /[֑-ׇ]/gu
const COMBINING_RE = /\p{M}/gu
const FINAL_FORMS: Record<string, string> = { 'ך': 'כ', 'ם': 'מ', 'ן': 'נ', 'ף': 'פ', 'ץ': 'צ' }

/** Hebrew/Greek word with points, accents and final letter forms removed, lower-cased. */
export function scriptKey(word: string): string {
  return word
    .replace(HEBREW_POINTS_RE, '')
    .normalize('NFD')
    .replace(COMBINING_RE, '')
    .replace(/[ךםןףץ]/gu, (c) => FINAL_FORMS[c])
    .replace(/ς/gu, 'σ')
    .replace(/[^\p{L}]/gu, '')
    .toLowerCase()
}

export function hasOriginalScript(text: string): boolean {
  return /[֐-׿Ͱ-Ͽἀ-῿]/u.test(text)
}

/** Exact transliteration key: diacritics and punctuation stripped (`agápē` → `agape`). */
export function translitKey(s: string): string {
  return s.replace(/ç/gu, 's').replace(/Ç/gu, 'S').normalize('NFD').replace(COMBINING_RE, '').replace(/[^a-z]/giu, '').toLowerCase()
}

/** Looser transliteration key for popular spellings (`tôwrâh` ~ `torah`, `bĕrîyth` ~ `berith`). */
export function looseTranslitKey(s: string): string {
  return translitKey(s)
    .replace(/kh/g, 'ch')
    .replace(/ow/g, 'o').replace(/uw/g, 'u').replace(/iy/g, 'i')
    .replace(/([aeiou])h$/g, '$1')
    .replace(/(.)\1+/g, '$1')
}

// ── Resolution ─────────────────────────────────────────────────────────────────────────────

/** Splits a Strong's KJV-rendering list into head words: `(great, tender) mercy` → `mercy`. */
export function glossHeadWords(gloss: string): string[] {
  const words = new Set<string>()
  const withoutParens = gloss.replace(/\([^)]*\)/g, ' ')
  for (const part of withoutParens.split(/[,;.]/)) {
    const cleaned = part.replace(/[×+]/g, ' ').replace(/-\s*$/g, '').trim().toLowerCase()
    if (!cleaned) continue
    for (const w of cleaned.split(/\s+/)) {
      const core = w.replace(/^[^a-z']+|[^a-z']+$/g, '')
      if (core) words.add(core)
    }
  }
  return [...words]
}

const STOP_WORDS = new Set(['the', 'a', 'an', 'of', 'to', 'and', 'in', 'be', 'is', 'for', 'with', 'on', 'by', 'as', 'at', 'or', 'that', 'it', 'he', 'his', 'not', 'him', 'they', 'them', 'shall', 'unto', 'all', 'i', 'my', 'me', 'thou', 'thee', 'ye', 'you'])

export interface ResolveOptions {
  /** Restrict to one language when the question names it. */
  lang?: StrongsLang | null
  /** Drop English candidates whose KJV count is below this share of the leader's (default 0.02). */
  minShare?: number
  maxCandidates?: number
}

function finish(query: string, kind: LexicalQueryKind, candidates: LexicalCandidate[], opts: ResolveOptions): LexicalResolution {
  const max = opts.maxCandidates ?? 12
  const sorted = candidates
    .filter((c) => !opts.lang || c.entry.lang === opts.lang)
    .sort((a, b) => b.score - a.score || b.entry.lexiconCount - a.entry.lexiconCount || a.entry.id.localeCompare(b.entry.id))
    .slice(0, max)
  return {
    query,
    kind,
    candidates: sorted,
    hebrew: sorted.filter((c) => c.entry.lang === 'H'),
    greek: sorted.filter((c) => c.entry.lang === 'G'),
    ambiguous: new Set(sorted.map((c) => c.entry.id)).size > 1,
  }
}

/** Resolves a single English word to every lemma the KJV renders with it, plus gloss-only matches. */
export function resolveEnglishWord(word: string, entries: LexiconEntryLite[], index: RenderingIndex, opts: ResolveOptions = {}): LexicalResolution {
  const key = englishKey(word.trim())
  const forms = englishForms(key)
  const byId = new Map(entries.map((e) => [e.id, e]))
  const counts = new Map<string, { n: number; forms: Set<string> }>()
  for (const f of forms) {
    const row = index.get(f)
    if (!row) continue
    for (const [id, n] of row) {
      const c = counts.get(id) ?? { n: 0, forms: new Set<string>() }
      c.n += n
      c.forms.add(f)
      counts.set(id, c)
    }
  }
  const top = Math.max(0, ...[...counts.values()].map((c) => c.n))
  const minShare = opts.minShare ?? 0.02
  const out: LexicalCandidate[] = []
  for (const [id, c] of counts) {
    const entry = byId.get(id)
    if (!entry) continue
    if (c.n < Math.max(1, top * minShare)) continue
    out.push({ entry, match: 'kjv-rendering', kjvRenderingCount: c.n, forms: [...c.forms].sort(), score: 1000 + c.n })
  }
  // Gloss-only matches: a lemma whose Strong's rendering list names the word but whose KJV tag
  // count is zero (LXX-only Greek words, or a tagging gap). Ranked below every counted lemma.
  if (!STOP_WORDS.has(key)) {
    const seen = new Set(out.map((c) => c.entry.id))
    for (const e of entries) {
      if (seen.has(e.id)) continue
      if (!glossHeadWords(e.gloss).includes(key)) continue
      out.push({ entry: e, match: 'gloss', kjvRenderingCount: 0, forms: [], score: Math.min(999, e.lexiconCount) })
    }
  }
  return finish(word, 'english', out, opts)
}

export function resolveTransliteration(word: string, entries: LexiconEntryLite[], opts: ResolveOptions = {}): LexicalResolution {
  const exact = translitKey(word)
  const loose = looseTranslitKey(word)
  const out: LexicalCandidate[] = []
  if (exact) {
    for (const e of entries) {
      const t = translitKey(e.transliteration)
      if (t === exact) out.push({ entry: e, match: 'transliteration', kjvRenderingCount: 0, forms: [], score: 2000 + e.lexiconCount })
      else if (looseTranslitKey(e.transliteration) === loose) out.push({ entry: e, match: 'transliteration', kjvRenderingCount: 0, forms: [], score: 1000 + e.lexiconCount })
    }
  }
  return finish(word, 'transliteration', out, opts)
}

export function resolveOriginalScript(word: string, entries: LexiconEntryLite[], opts: ResolveOptions = {}): LexicalResolution {
  const key = scriptKey(word)
  const out: LexicalCandidate[] = []
  if (key) {
    for (const e of entries) {
      if (scriptKey(e.lemma) === key) out.push({ entry: e, match: 'original-script', kjvRenderingCount: 0, forms: [], score: 1000 + e.lexiconCount })
    }
  }
  return finish(word, 'original-script', out, opts)
}

export function resolveIds(text: string, entries: LexiconEntryLite[]): LexicalResolution {
  const byId = new Map(entries.map((e) => [e.id, e]))
  const ids = parseStrongsIds(text)
  const matches = ids.length > 0 ? ids : parseBareStrongsNumbers(text)
  const out: LexicalCandidate[] = []
  matches.forEach((m, i) => {
    const entry = byId.get(m.id)
    if (entry) out.push({ entry, match: 'id', kjvRenderingCount: 0, forms: [], score: 10000 - i })
  })
  // Keep the typed order; ambiguity only arises from a bare number resolving in both lexicons.
  const res = finish(text, 'id', out, { maxCandidates: 8 })
  return { ...res, ambiguous: ids.length === 0 && res.candidates.length > 1 }
}

/** The lemmas behind specific English words in one verse ("the Greek word behind 'born again' in
 *  John 3:3"): read straight from that verse's tags, in word order — the verse decides, not a
 *  dictionary-wide guess. */
export function resolveInVerse(term: string, tokens: Array<{ word: string; strongs: string[] }>, entries: LexiconEntryLite[], opts: ResolveOptions = {}): LexicalResolution {
  const wanted = new Set(term.toLowerCase().split(/\s+/).flatMap((w) => englishForms(w.replace(/[^\p{L}'-]/gu, ''))))
  const byId = new Map(entries.map((e) => [e.id, e]))
  const out: LexicalCandidate[] = []
  const seen = new Set<string>()
  tokens.forEach((t, i) => {
    if (!wanted.has(englishKey(t.word))) return
    for (const id of t.strongs) {
      const entry = byId.get(id)
      if (!entry || seen.has(id)) continue
      seen.add(id)
      out.push({ entry, match: 'verse-token', kjvRenderingCount: 0, forms: [englishKey(t.word)], score: 5000 - i })
    }
  })
  return finish(term, 'verse', out, opts)
}

/** Combines two resolutions of the same term (a word can be both a transliteration and a KJV
 *  word — "Chesed" is a name in Gen 22:22 and the transliteration of H2617). Higher score wins per id. */
export function mergeResolutions(primary: LexicalResolution, secondary: LexicalResolution, opts: ResolveOptions = {}): LexicalResolution {
  const best = new Map<string, LexicalCandidate>()
  for (const c of [...primary.candidates, ...secondary.candidates]) {
    const prev = best.get(c.entry.id)
    if (!prev || c.score > prev.score) best.set(c.entry.id, c)
  }
  return finish(primary.query, primary.kind, [...best.values()], opts)
}

/** True when the English word is a KJV word (has any rendering), i.e. not a bare transliteration. */
export function isKjvWord(word: string, index: RenderingIndex): boolean {
  return englishForms(word).some((f) => index.has(f))
}
