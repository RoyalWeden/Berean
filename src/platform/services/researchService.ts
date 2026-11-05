import type { ServiceContext } from './context'
import type { LexiconService } from './lexiconService'
import type { DatabaseAdapter } from '../db/DatabaseAdapter'
import {
  buildRenderingIndex, glossHeadWords, isKjvWord, mergeResolutions, resolveEnglishWord, resolveIds, resolveInVerse, resolveOriginalScript, resolveTransliteration,
  type LexicalResolution, type LexiconEntryLite, type RenderingIndex,
} from '../../lib/research/lexicon'
import { detectLexicalIntent, type LexicalIntent } from '../../lib/research/lexicalIntent'
import { parseTaggedText, tagCoverage } from '../../lib/research/taggedText'
import { candidatesFromResolution, type OccurrenceSummary, type ResearchPayload, type WordTable, type WordTableVerse } from '../../lib/research/payload'
import type { StrongsLang } from '../../lib/research/strongsId'

/**
 * Model-free word-study research (spec §4.2, Phase 1): Strong's ids, English/transliterated/
 * original-script word studies, word-by-word tag tables and occurrence counts — all answered from
 * the bundled databases, on desktop and iPhone alike, with or without any AI model installed.
 *
 * Every Strong's id this returns exists in the lexicon; every count comes from `text_tagged`.
 */

export interface LexicalAnswer {
  intent: LexicalIntent
  resolution?: LexicalResolution
  wordTables: WordTable[]
  occurrences: OccurrenceSummary[]
  /** Factual limitations to show the user (missing data, partial coverage). */
  limitations: string[]
}

/** Texts whose `text_tagged` carry Strong's numbers, by language. `lxx` is Brenton's English with Greek tags. */
const TAGGED_TEXTS: Record<StrongsLang, string[]> = { H: ['kjva'], G: ['kjva', 'lxx'] }

function likeVariants(n: string): string[] {
  return [`%{${n}}%`, `%{${n}|%`, `%|${n}}%`, `%|${n}|%`]
}

export function createResearchService(ctx: ServiceContext, deps: { lexicon: LexiconService }) {
  let entriesPromise: Promise<LexiconEntryLite[]> | null = null
  let indexPromise: Promise<RenderingIndex> | null = null

  async function loadLang(lang: StrongsLang): Promise<LexiconEntryLite[]> {
    const db = await ctx.lexiconDb(lang)
    const rows = await db.all<{ strongs_id: string; word: string | null; transliteration: string | null; short_def: string | null; full_def: string | null; derivation: string | null; occurrence_count: number | null }>(
      'SELECT strongs_id, word, transliteration, short_def, full_def, derivation, occurrence_count FROM entries',
    )
    return rows.map((r) => ({
      id: r.strongs_id, lang, lemma: r.word ?? '', transliteration: r.transliteration ?? '', gloss: r.short_def ?? '',
      definition: r.full_def ?? '', derivation: r.derivation ?? '', lexiconCount: r.occurrence_count ?? 0,
    }))
  }

  /** Every lexicon entry (both languages), loaded once per process. */
  function entries(): Promise<LexiconEntryLite[]> {
    if (!entriesPromise) {
      entriesPromise = Promise.all([loadLang('H'), loadLang('G')]).then(([h, g]) => [...h, ...g])
      entriesPromise.catch(() => { entriesPromise = null })
    }
    return entriesPromise
  }

  /** KJV English word → Strong's id → verse count, built once per process from kjva. */
  function renderingIndex(): Promise<RenderingIndex> {
    if (!indexPromise) {
      indexPromise = (async () => {
        const db = await ctx.textDb('kjva')
        if (!db) return new Map()
        const rows = await db.all<{ text_tagged: string | null }>('SELECT text_tagged FROM verses WHERE text_tagged IS NOT NULL')
        return buildRenderingIndex(rows.map((r) => r.text_tagged))
      })()
      indexPromise.catch(() => { indexPromise = null })
    }
    return indexPromise
  }

  async function resolveTerm(term: string, termKind: LexicalIntent['termKind'], lang: StrongsLang | null): Promise<LexicalResolution> {
    const all = await entries()
    if (termKind === 'original-script') return resolveOriginalScript(term, all, { lang })
    const words = term.trim().split(/\s+/)
    const index = await renderingIndex()
    // Multi-word terms ("loving kindness") resolve on their last content word; a two-word KJV
    // rendering is still found because every rendering word is indexed individually.
    const head = words.length === 1 ? term : words[words.length - 1]
    const english = resolveEnglishWord(head, all, index, { lang })
    if (words.length > 1) return english
    // A single word may be a transliteration, a KJV word, or both ("chesed" is H2617's
    // transliteration and the name Chesed in Gen 22:22) — show both readings, transliteration first.
    const translit = resolveTransliteration(term, all, { lang })
    if (translit.candidates.length === 0) return english
    if (english.candidates.length === 0) return translit
    return isKjvWord(term, index) && english.candidates[0].kjvRenderingCount > 20
      ? mergeResolutions(english, translit, { lang })
      : mergeResolutions(translit, english, { lang })
  }

  async function wordTable(bookId: string, chapter: number, verse: number | undefined, endVerse: number | undefined, textId = 'kjva'): Promise<WordTable | null> {
    const db = await ctx.textDb(textId)
    if (!db) return null
    const cols = await db.all<{ name: string }>('PRAGMA table_info(verses)')
    const tagged = cols.some((c) => c.name === 'text_tagged')
    const from = verse ?? 1
    const to = endVerse ?? verse ?? 999
    const rows = await db.all<{ verse_num: number; text: string; text_tagged?: string | null }>(
      `SELECT verse_num, text${tagged ? ', text_tagged' : ''} FROM verses WHERE book_id = ? AND chapter = ? AND verse_num BETWEEN ? AND ? ORDER BY verse_num LIMIT 40`,
      [bookId, chapter, from, to],
    )
    if (rows.length === 0) return null
    const byId = new Map((await entries()).map((e) => [e.id, e]))
    const verses: WordTableVerse[] = rows.map((r) => {
      const tokens = parseTaggedText(r.text_tagged).map((t) => ({
        ...t,
        entries: t.strongs.flatMap((id) => {
          const e = byId.get(id)
          return e ? [{ id, lemma: e.lemma, transliteration: e.transliteration, gloss: e.gloss }] : []
        }),
      }))
      return { verse: r.verse_num, text: r.text, tokens, coverage: tagCoverage(tokens) }
    })
    return { textId, bookId, chapter, verses, untaggedText: !tagged }
  }

  async function countIn(db: DatabaseAdapter | null, textId: string, id: string, bookId?: string) {
    if (!db) return []
    const [p1, p2, p3, p4] = likeVariants(id)
    const scope = bookId ? ' AND book_id = ?' : ''
    const params = bookId ? [p1, p2, p3, p4, bookId] : [p1, p2, p3, p4]
    const rows = await db.all<{ book_id: string; n: number }>(
      `SELECT book_id, COUNT(*) AS n FROM verses
       WHERE (text_tagged LIKE ? OR text_tagged LIKE ? OR text_tagged LIKE ? OR text_tagged LIKE ?)${scope}
       GROUP BY book_id`,
      params,
    )
    return rows.map((r) => ({ textId, bookId: r.book_id, verses: Number(r.n) }))
  }

  /** Exact verse counts for a Strong's id across every text that carries its language's tags. */
  async function occurrenceSummary(id: string, bookId?: string): Promise<OccurrenceSummary> {
    const lang = id[0] as StrongsLang
    const byBook = (await Promise.all(TAGGED_TEXTS[lang].map(async (t) => countIn(await ctx.textDb(t), t, id, bookId)))).flat()
    const totals = TAGGED_TEXTS[lang].map((t) => ({ textId: t, verses: byBook.filter((b) => b.textId === t).reduce((s, b) => s + b.verses, 0) }))
    return { id, totals, byBook, ...(bookId ? { bookId } : {}) }
  }

  /** Answers a word-study shaped question entirely from local data, or returns null when the
   *  question isn't one (topical searches stay with the retrieval pipeline). */
  async function answerLexical(question: string): Promise<LexicalAnswer | null> {
    const intent = detectLexicalIntent(question)
    if (!intent) return null
    const limitations: string[] = []
    const answer: LexicalAnswer = { intent, wordTables: [], occurrences: [], limitations }

    if (intent.kind === 'word-table' || intent.kind === 'untagged-words') {
      if (intent.wantsSeptuagint) {
        limitations.push("Berean's Greek Septuagint word tags aren't available yet, so this table shows the KJV's Strong's tags.")
      }
      for (const ref of intent.refs.slice(0, 3)) {
        const table = await wordTable(ref.bookId, ref.chapter, ref.verse, ref.endVerse)
        if (table) answer.wordTables.push(table)
        else limitations.push(`No verse text was found for ${ref.bookId} ${ref.chapter}${ref.verse ? `:${ref.verse}` : ''}.`)
      }
      return answer
    }

    if (intent.ids.length > 0) {
      answer.resolution = resolveIds(question, await entries())
      const missing = intent.ids.filter((id) => !answer.resolution!.candidates.some((c) => c.entry.id === id))
      for (const id of missing) limitations.push(`${id} isn't in Berean's Strong's lexicon.`)
      if (intent.kind === 'strongs-compare') {
        for (const c of answer.resolution.candidates.slice(0, 4)) answer.occurrences.push(await occurrenceSummary(c.entry.id))
        return answer
      }
      if (intent.kind === 'occurrences' || intent.refs.length > 0 || intent.bookId) {
        for (const c of answer.resolution.candidates.slice(0, 2)) answer.occurrences.push(await occurrenceSummary(c.entry.id, intent.bookId))
      }
      return answer
    }

    if (intent.term && intent.refs.length > 0 && intent.termKind !== 'original-script') {
      // A word study scoped to a verse reads that verse's own tags.
      const ref = intent.refs[0]
      const table = await wordTable(ref.bookId, ref.chapter, ref.verse ?? 1, ref.verse ?? 1)
      const tokens = table?.verses[0]?.tokens ?? []
      const inVerse = resolveInVerse(intent.term, tokens, await entries(), { lang: intent.lang })
      if (inVerse.candidates.length > 0) {
        answer.resolution = inVerse
        if (table) answer.wordTables.push(table)
        return answer
      }
      limitations.push(`"${intent.term}" isn't a tagged word in ${ref.bookId} ${ref.chapter}${ref.verse ? `:${ref.verse}` : ''}; showing lexicon matches instead.`)
    }

    if (intent.term) {
      const resolution = await resolveTerm(intent.term, intent.termKind, intent.lang)
      // A bare single word that resolves to nothing lexical is a topical search, not a word study.
      if (resolution.candidates.length === 0 && intent.termKind !== 'original-script' && !/\bword|strong|hebrew|greek|lexicon/i.test(question)) return null
      // A bare ordinary English word ("grace") is a topical query: hand it back to retrieval.
      if (resolution.kind === 'english' && intent.bare) return null
      answer.resolution = resolution
      if (resolution.candidates.length === 0) limitations.push(`No Strong's entry matches "${intent.term}".`)
      if (intent.kind === 'occurrences') {
        for (const c of resolution.candidates.slice(0, 2)) answer.occurrences.push(await occurrenceSummary(c.entry.id, intent.bookId))
      }
      return answer
    }
    return null
  }

  return { entries, renderingIndex, resolveTerm, wordTable, occurrenceSummary, answerLexical, getEntry: deps.lexicon.getEntry }
}

/** The serializable form of a lexical answer, for the response payload. */
export function lexicalPayload(answer: LexicalAnswer): ResearchPayload {
  const cands = answer.resolution?.candidates ?? []
  let comparison: ResearchPayload['comparison']
  if (answer.intent.kind === 'strongs-compare' && cands.length >= 2) {
    const words = new Map(cands.map((c) => [c.entry.id, new Set(glossHeadWords(c.entry.gloss).filter((w) => w.length > 2))]))
    const sets = [...words.values()]
    const shared = [...sets[0]].filter((w) => sets.every((s) => s.has(w)))
    const only = Object.fromEntries([...words].map(([id, s]) => [id, [...s].filter((w) => !shared.includes(w)).slice(0, 12)]))
    comparison = { shared, only }
  }
  return {
    ...(comparison ? { comparison } : {}),
    kind: answer.intent.kind,
    ...(answer.intent.term ? { term: answer.intent.term } : {}),
    candidates: candidatesFromResolution(answer.resolution),
    ambiguous: answer.resolution?.ambiguous ?? false,
    wordTables: answer.wordTables,
    occurrences: answer.occurrences,
    limitations: answer.limitations,
    method: 'deterministic',
  }
}

export type ResearchService = ReturnType<typeof createResearchService>
