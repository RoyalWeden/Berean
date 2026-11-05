import type { Services } from './index'
import type { AiLookupResponse, AiLookupResult } from '../../types/electron'
import { parseRef, bookName, getTranslationForBook } from '../../lib/parseRef'
import { mentionsExcluded, parseExclusions } from '../../lib/research/exclusions'
import { lexicalPayload } from './researchService'
import { resolveFollowUp, stateFromTurns, type Turn } from '../../lib/research/conversationState'
import { activeCollections, collectionOf, detectQuestionScope, type CollectionId } from '../../lib/research/collections'
import { asksForInterpretation } from '../../lib/research/modePolicy'

/**
 * Ask Berean without any AI model (spec §2.1, decision 6, scenarios 1 and 27): references, word
 * studies, Strong's ids, word tables, occurrence counts, follow-ups and a plain keyword search,
 * all from the bundled databases through the shared services — so it runs the same on an iPhone
 * with no local model as on a Mac without one. The response says it ran model-free
 * (`errorCode: NO_MODEL_INSTALLED`, `partial`) so the reply never claims AI work it didn't do.
 */

export interface ModelFreeOptions {
  history?: Turn[]
  collections?: CollectionId[]
  commentary?: boolean
}

const STOP = new Set(['what', 'where', 'which', 'when', 'who', 'whom', 'why', 'how', 'does', 'did', 'the', 'and', 'for', 'about', 'with', 'from', 'that', 'this', 'these', 'those', 'are', 'was', 'were', 'show', 'find', 'give', 'list', 'tell', 'verses', 'verse', 'passages', 'passage', 'scripture', 'scriptures', 'bible', 'say', 'says', 'said', 'mean', 'means', 'any', 'all', 'some', 'into', 'unto', 'have', 'has', 'can', 'you', 'your', 'please', 'only', 'just'])
const SHOWN = 6

function keywordsOf(question: string): string[] {
  const words = question.toLowerCase().replace(/[^\p{L}\s'-]/gu, ' ').split(/\s+/).filter((w) => w.length >= 3 && !STOP.has(w))
  return [...new Set(words)].slice(0, 6)
}

const result = (textId: string, bookId: string, chapter: number, verse: number, text: string, source: AiLookupResult['source']): AiLookupResult =>
  ({ textId, bookId, bookName: bookName(bookId), chapter, verse, text, source })

export async function modelFreeLookup(services: Services, question: string, opts: ModelFreeOptions = {}): Promise<AiLookupResponse> {
  const followUp = resolveFollowUp(question, stateFromTurns(opts.history ?? []))
  const q = followUp?.question ?? question
  const base: AiLookupResponse = {
    results: [], visibleCount: 0, keywords: [], related: [], errorCode: 'NO_MODEL_INSTALLED', partial: true,
    ...(followUp ? { followUpReason: followUp.reason } : {}),
    ...(opts.commentary === false && asksForInterpretation(question) ? { interpretationOffered: true } : {}),
  }
  const done = (r: AiLookupResponse): AiLookupResponse => {
    const excluded = new Set(followUp?.excludeRefs ?? [])
    let results = r.results.filter((x) => !excluded.has(`${x.bookId} ${x.chapter}:${x.verse}`))
    if (followUp?.limit) results = results.slice(0, followUp.limit)
    const found = results.length > 0 || !!r.strongsCard || (r.research?.candidates.length ?? 0) > 0 || (r.research?.wordTables.length ?? 0) > 0
    return { ...r, results, visibleCount: Math.min(results.length, SHOWN), partial: found }
  }

  // 1. Word studies, Strong's ids, word tables, occurrence counts.
  const lexical = await services.research.answerLexical(q).catch(() => null)
  if (lexical) {
    const research = lexicalPayload(lexical)
    const top = research.candidates[0]
    let results: AiLookupResult[] = []
    if (top && lexical.occurrences.length > 0) {
      const occ = await services.lexicon.getOccurrences(top.id, lexical.occurrences[0].bookId ?? undefined).catch(() => [])
      results = occ.slice(0, SHOWN).map((o) => result(o.text_id, o.book_id, o.chapter, o.verse_num, o.text, 'strongs'))
    }
    return done({
      ...base, research, results,
      ...(top ? { strongsCard: { strongsNum: top.id, lemma: top.lemma, transliteration: top.transliteration, gloss: top.gloss, definition: top.definition, derivation: top.derivation, occurrenceCount: top.lexiconCount } } : {}),
    })
  }

  // 2. A bare reference ("John 3:16", "Psalm 23", "Genesis 1:1 LXX").
  const ref = parseRef(q.trim())
  if (ref) {
    const textId = ref.forcedTranslation === 'LXX' ? 'lxx' : getTranslationForBook(ref.bookId) ?? 'kjva'
    const rows = await services.bible.queryChapter(ref.bookId, ref.chapter, textId).catch(() => [])
    const from = ref.verse ?? 1
    const to = ref.endVerse ?? ref.verse ?? Number.MAX_SAFE_INTEGER
    const results = rows.filter((v) => v.verse_num >= from && v.verse_num <= to).slice(0, 60)
      .map((v) => result(textId, ref.bookId, ref.chapter, v.verse_num, v.text, 'named'))
    if (results.length) return { ...done({ ...base, results }), visibleCount: results.length }
  }

  // 3. Keyword search over the active collections (canonical KJV first).
  const collections = activeCollections(opts.collections, detectQuestionScope(q))
  const excluded = parseExclusions(q, (phrase) => parseRef(`${phrase.replace(/^(?:the\s+book\s+of\s+)/i, '')} 1`)?.bookId ?? null)
  const keywords = keywordsOf(excluded.remainder)
  if (keywords.length === 0) return done(base)
  const query = keywords.join(' ')
  let rows = await services.bible.searchText(query, 'kjva', 'all').catch(() => [])
  if (rows.length < 3) rows = [...rows, ...(await services.bible.searchText(query, 'kjva', 'any').catch(() => []))]
  if (rows.length === 0) {
    // KJV spellings differ from modern ones ("jubile", "shew", "sabbaths"); searching a shortened
    // stem as a prefix finds them without a model. Real verses only — still a literal match.
    const stems = keywords.map((k) => (k.length >= 6 ? k.slice(0, k.length - 2) : k))
    rows = await services.bible.searchText(stems.join(' '), 'kjva', 'any').catch(() => [])
  }
  const seen = new Set<string>()
  const results: AiLookupResult[] = []
  for (const r of rows) {
    const key = `${r.book_id}|${r.chapter}|${r.verse_num}`
    if (seen.has(key) || !collections.includes(collectionOf('kjva', r.book_id))) continue
    if (excluded.bookIds.includes(r.book_id) || mentionsExcluded(r.text, excluded.terms)) continue
    seen.add(key)
    results.push(result('kjva', r.book_id, r.chapter, r.verse_num, r.text, 'keyword'))
    if (results.length >= 12) break
  }
  return done({ ...base, results, keywords })
}
