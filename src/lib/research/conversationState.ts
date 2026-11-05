// Structured conversation state and deterministic follow-up resolution (spec §3.3, §5.4,
// decision 17). Built from BOTH user and assistant turns. A follow-up such as "now only Greek",
// "compare the second one with the first", "show that in the LXX" or "more, but not Exodus 20:12"
// is rewritten into a complete request against the entities the conversation already resolved,
// so it no longer depends on a model guessing what "that" meant.
//
// Pure and shared (desktop + iPhone). The state is derived from turn text, so it also works for
// conversations saved before structured state existed; when a reply carries its own structured
// state (`ResearchState`), that is preferred.

import { findReferencesInText } from './references'
import { parseStrongsIds, type StrongsLang } from './strongsId'
import { detectLexicalIntent } from './lexicalIntent'
import { bookName, resolveBookToken, type ParsedRef } from '../parseRef'

export interface Turn { role: 'user' | 'assistant'; content: string }

export interface ResearchState {
  /** The last user request that stated a topic (not itself a follow-up). */
  topicQuestion?: string
  /** The topical phrase of that request ("refuge" in "only in the Psalms, verses about refuge"). */
  topic?: string
  /** The last word studied ("mercy", "faith") and the language asked about. */
  term?: string
  lang?: StrongsLang | null
  /** Strong's ids in the order the conversation produced them, most recent answer first. */
  strongs: string[]
  /** Verse references shown in the last answer, in order ("second passage" = refs[1]). */
  refs: string[]
  /** Active scope carried by "same restriction". */
  scopePhrase?: string
}

export interface FollowUp {
  /** The complete request to run instead of the literal follow-up text. */
  question: string
  /** Human-readable explanation, shown as "Interpreted as …". */
  reason: string
  /** References not to show again ("five more", "don't include Exodus 20:12 again"). */
  excludeRefs: string[]
  /** Show at most this many results ("give me only 2", "just the best one"). */
  limit?: number
}

const refKey = (r: ParsedRef) => `${r.bookId} ${r.chapter}${r.verse ? `:${r.verse}${r.endVerse ? `-${r.endVerse}` : ''}` : ''}`

const FOLLOW_UP_RE = /^(?:and|now|any|anything|do\s+\S+\s+next|ok(?:ay)?|also|then|what about|how about|same|do the same|more|show|find|give|just|only|try|check|trace|compare|contrast|switch|no,|actually|i meant|where does (?:that|this|it))\b|\b(that|those|these|them|it|(?:have|say|says|read|reads)\s+there|the same|same restriction|again|the (?:first|second|third|last) (?:one|passage|verse|entry))\b/i
const SCOPE_RE = /\b(only\s+(?:in\s+)?(?:the\s+)?(?:psalms|proverbs|gospels|new testament|old testament|torah|prophets|[1-3]?\s?[A-Z][a-z]+)|in\s+the\s+(?:new|old)\s+testament|only\s+new\s+testament|only\s+old\s+testament)\b/i
const TOPIC_RE = /\b(?:verses?|passages?|scriptures?)\s+(?:about|on|regarding|concerning|that\s+mentions?|mentioning)\s+(.+?)(?:[?.!]|$)|\b(?:about|on)\s+(.+?)(?:[?.!]|$)/i
const ORDINALS: Record<string, number> = { first: 0, second: 1, third: 2, fourth: 3, fifth: 4, last: -1 }
const NUMBER_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 }

function topicOf(question: string): string | undefined {
  const m = question.match(TOPIC_RE)
  const t = (m?.[1] ?? m?.[2])?.trim().replace(/,?\s*same restriction$/i, '')
  return t && t.split(/\s+/).length <= 6 ? t : undefined
}

function isFollowUp(question: string): boolean {
  const q = question.trim()
  if (q.split(/\s+/).length > 14) return false
  return FOLLOW_UP_RE.test(q)
}

/** Rebuilds research state from the conversation's turns (oldest first). */
export function stateFromTurns(turns: Turn[]): ResearchState {
  const state: ResearchState = { strongs: [], refs: [] }
  for (const t of turns) {
    const text = t.content.replace(/^\((?:my note|the message I am replying to)\)\s*/i, '')
    if (t.role === 'user') {
      if (/\bany testament\b|\bremove (?:the )?(?:restriction|filter)s?\b|\bstart over\b|\bnew topic\b/i.test(text)) state.scopePhrase = undefined
      const scope = text.match(SCOPE_RE)?.[0]
      if (scope) state.scopePhrase = scope
      const lex = detectLexicalIntent(text)
      if (lex?.term) { state.term = lex.term; state.lang = lex.lang }
      if (!isFollowUp(text) || topicOf(text)) {
        const topic = topicOf(text)
        if (topic || lex || findReferencesInText(text).length > 0) { state.topicQuestion = text; state.topic = topic }
        // A short statement with no question shape ("the watchers", a note's line) is its own topic.
        else if (text.split(/\s+/).length <= 10 && !/\?$/.test(text.trim())) { state.topicQuestion = `verses about ${text.trim()}`; state.topic = text.trim() }
      }
      const ids = parseStrongsIds(text).map((m) => m.id)
      if (ids.length) state.strongs = [...ids, ...state.strongs.filter((x) => !ids.includes(x))]
    } else {
      const refs = findReferencesInText(text)
      if (refs.length) state.refs = refs.map(refKey)
      const ids = parseStrongsIds(text).map((m) => m.id)
      if (ids.length) state.strongs = [...ids, ...state.strongs.filter((x) => !ids.includes(x))]
    }
  }
  return state
}

function refsAsText(state: ResearchState, n?: number): string {
  const refs = (n ? state.refs.slice(0, n) : state.refs)
  return refs.map((k) => {
    const [book, cv] = k.split(' ')
    return `${bookName(book)} ${cv}`
  }).join('; ')
}

function ordinalIndex(q: string): number | null {
  const m = q.match(/\b(first|second|third|fourth|fifth|last)\b/i)
  return m ? ORDINALS[m[1].toLowerCase()] : null
}

function requestedLimit(q: string): number | undefined {
  if (/\bjust the (?:best|top) one\b|\bonly (?:the )?(?:best|top) one\b/i.test(q)) return 1
  const m = q.match(/\b(?:only|just|give me|show me)\s+(?:the\s+)?(?:top\s+)?(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\b/i)
  if (!m) return undefined
  return /^\d+$/.test(m[1]) ? Number(m[1]) : NUMBER_WORDS[m[1].toLowerCase()]
}

function namedCorpus(q: string): string | null {
  const m = q.match(/\b(?:in|search)\s+(jubilees|enoch|1 enoch|the septuagint|the lxx|lxx|the apocrypha|sirach|tobit|wisdom)\b/i) ?? q.match(/\band in (\w+)\??$/i)
  return m ? m[1].replace(/^the\s+/i, '') : null
}

/** Rewrites a follow-up against the conversation state, or returns null when the question stands on its own. */
export function resolveFollowUp(question: string, state: ResearchState): FollowUp | null {
  const q = question.trim()
  if (!q || !isFollowUp(q)) return null
  const explicitRefs = findReferencesInText(q).map(refKey)
  const lexical = detectLexicalIntent(q)
  const base = state.topicQuestion
  const exclude: string[] = []
  const notAgain = q.match(/\b(?:don'?t|do not|without|not|excluding)\s+(?:include\s+|show\s+)?(.+?)\s+again\b/i)
  if (notAgain) exclude.push(...findReferencesInText(notAgain[1]).map(refKey))

  // "try again" — the same request.
  if (/^(?:please\s+)?try again\b/i.test(q) && base) return { question: base, reason: `Asked again: “${base}”`, excludeRefs: [] }

  // "check that number against the database" — verify the last id against the last word studied.
  if (/\b(check|verify|confirm)\b.*\b(number|id|strong'?s)\b/i.test(q) && state.strongs[0]) {
    const asked = state.term ? ` for ${state.lang === 'G' ? 'the Greek word ' : state.lang === 'H' ? 'the Hebrew word ' : 'the word '}${state.term}` : ''
    return { question: state.term ? `${state.strongs[0]} and the ${state.lang === 'G' ? 'Greek ' : state.lang === 'H' ? 'Hebrew ' : ''}word for ${state.term}` : state.strongs[0], reason: `Checked ${state.strongs[0]}${asked} against the lexicon`, excludeRefs: [] }
  }

  // "show every Strong's number for those verses" — word table for the refs just shown.
  if (/\b(strong'?s|every word|each word|word by word)\b/i.test(q) && /\b(those|these|them|that|it)\b/i.test(q) && state.refs.length) {
    const refs = refsAsText(state, 3)
    return { question: `every word and Strong's number in ${refs}`, reason: `Word by word for ${refs}`, excludeRefs: [] }
  }

  // "what about the Greek?" / "I meant the Hebrew word".
  const langSwitch = q.match(/\b(?:what about|how about|i meant|now only|now|only|and|switch to|in)\s+(?:the\s+)?(greek|hebrew)\b/i) ?? q.match(/^(?:the\s+)?(greek|hebrew)\s+one\??$/i)
  if (langSwitch) {
    const lang = langSwitch[1].toLowerCase()
    if (state.strongs.length && /\boccurrence/i.test(q)) {
      const ids = state.strongs.filter((id) => id.startsWith(lang === 'greek' ? 'G' : 'H'))
      if (ids.length) return { question: `every occurrence of ${ids[0]}`, reason: `${lang === 'greek' ? 'Greek' : 'Hebrew'} occurrences: ${ids[0]}`, excludeRefs: [] }
    }
    if (state.term) return { question: `the ${lang} word for ${state.term}`, reason: `The ${lang} word for “${state.term}”`, excludeRefs: [] }
    if (state.refs.length) {
      const refs = refsAsText(state, 2)
      return { question: `every word and Strong's number in ${refs}`, reason: `The ${lang === 'greek' ? 'Greek' : 'Hebrew'} words in ${refs}`, excludeRefs: [] }
    }
  }

  // "compare the second one with the first" — the ids the last word study listed.
  if (/\b(compare|contrast)\b/i.test(q) && /\b(first|second|third|last)\b/i.test(q) && state.strongs.length >= 2 && !lexical?.ids.length) {
    if (/\bfirst two\b/i.test(q)) return { question: `compare ${state.strongs[0]} and ${state.strongs[1]}`, reason: `Compared ${state.strongs[0]} and ${state.strongs[1]}`, excludeRefs: [] }
    const picks = [...q.matchAll(/\b(first|second|third|fourth|fifth|last)\b/gi)].map((m) => ORDINALS[m[1].toLowerCase()])
      .map((i) => state.strongs.at(i)).filter((x): x is string => !!x)
    if (picks.length >= 2) return { question: `compare ${picks[0]} and ${picks[1]}`, reason: `Compared ${picks[0]} and ${picks[1]}`, excludeRefs: [] }
  }

  // "trace that (Hebrew) word through the Psalms" / "show all occurrences".
  // "any in Proverbs?" — the word just studied, in one book.
  const anyIn = q.match(/^(?:any|anything|some|is it|was it)\b.*\bin\s+(?:the\s+)?([1-3]?\s?[A-Za-z]+)\s*\??$/i)
  if (anyIn && state.strongs[0] && resolveBookToken(anyIn[1])) {
    const bookId = resolveBookToken(anyIn[1])!
    return { question: `every occurrence of ${state.strongs[0]} in ${bookName(bookId)}`, reason: `Occurrences of ${state.strongs[0]} in ${bookName(bookId)}`, excludeRefs: [] }
  }

  if ((/\b(trace|every occurrence|all occurrences|where else|show all occurrences)\b/i.test(q) || /\b(?:every|all)\s+(?:the\s+)?(?:verses?|places?)\s+(?:with|containing|using|that use)\s+(?:it|that|this)\b/i.test(q) || /\bwhere (?:does|is|do) (?:that|this|it)\b.*\b(?:appear|used|occur|found)\b/i.test(q)) && state.strongs[0]) {
    const book = q.match(/\b(?:through|in)\s+(?:the\s+)?([1-3]?\s?[A-Za-z]+)\s*$/i)?.[1]
    const bookId = book ? resolveBookToken(book) : null
    return { question: `every occurrence of ${state.strongs[0]}${bookId ? ` in ${bookName(bookId)}` : ''}`, reason: `Occurrences of ${state.strongs[0]}${bookId ? ` in ${bookName(bookId)}` : ''}`, excludeRefs: [] }
  }

  // "show the context of the second passage" / "the first one".
  const ord = ordinalIndex(q)
  if (ord !== null && /\b(context|passage|verse|one|it)\b/i.test(q) && state.refs.length && !explicitRefs.length) {
    const key = state.refs.at(ord)
    if (key) {
      const [book, cv] = key.split(' ')
      const [ch, v] = cv.split(':').map((x) => Number(x.split('-')[0]))
      const label = `${bookName(book)} ${ch}${v ? `:${v}` : ''}`
      if (/\bcontext\b/i.test(q) && v) return { question: `${bookName(book)} ${ch}:${Math.max(1, v - 3)}-${v + 3}`, reason: `Context of ${label}`, excludeRefs: [] }
      return { question: label, reason: label, excludeRefs: [] }
    }
  }

  // "show that in the LXX" — the last reference in the Septuagint.
  if (/\b(lxx|septuagint)\b/i.test(q) && state.refs[0] && /\b(that|it|this|those|there)\b/i.test(q)) {
    const [book, cv] = state.refs[0].split(' ')
    return { question: `${bookName(book)} ${cv} LXX`, reason: `${bookName(book)} ${cv} in the LXX`, excludeRefs: [] }
  }

  // "now search Jubilees for the same" / "and in Enoch?" / "find that in Jubilees".
  const corpus = namedCorpus(q)
  if (corpus && base && /\b(same|that|this|it|and in|search)\b/i.test(q)) {
    const topic = state.topic ?? base
    return { question: `verses about ${topic} in ${corpus}`, reason: `“${topic}” in ${corpus}`, excludeRefs: [] }
  }

  // "do the same for mercy" / "now about joy, same restriction" / "more on forgiveness".
  const newTopic = (q.match(/^(?:now\s+)?do\s+(.+?)\s+(?:next|now)\b[?.!]?$/i)
    ?? q.match(/\b(?:do the same for|same for|now about|now for|what about|how about|more on|and now)\s+(.+?)(?:,?\s*(?:same restriction|but\b.*))?[?.!]?$/i))?.[1]?.trim()
  if (newTopic && base && !/^(the\s+)?(greek|hebrew|lxx|septuagint)$/i.test(newTopic)) {
    const sameRestriction = /\bsame restriction\b/i.test(q) || /^more on\b/i.test(q)
    const scope = sameRestriction && state.scopePhrase ? `${state.scopePhrase}, ` : ''
    const oldTopic = state.term ?? state.topic
    const rewritten = oldTopic && base.toLowerCase().includes(oldTopic.toLowerCase())
      ? base.replace(new RegExp(oldTopic.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), newTopic)
      : `${scope}verses about ${newTopic}`
    const withScope = scope && !rewritten.toLowerCase().includes(state.scopePhrase!.toLowerCase()) ? `${scope}${rewritten}` : rewritten
    const moreOn = /^more on\b/i.test(q)
    return { question: withScope, reason: `Same request for “${newTopic}”`, excludeRefs: moreOn ? [...new Set([...state.refs, ...exclude])] : exclude }
  }

  // "now just the verses on the same topic" — the topic again, verses only.
  if (/\bsame (?:topic|thing|subject)\b/i.test(q) && base && !/\bsame restriction\b/i.test(q)) {
    const topic = state.topic ?? base
    return { question: state.topic ? `verses about ${state.topic}` : base, reason: `Verses on “${topic}”`, excludeRefs: [] }
  }

  // "find five more" / "show the rest of them" / "more like these" / "give me only 2" / "just the best one".
  const limit = requestedLimit(q)
  if (base && (/\b(more|rest|others|another|again)\b/i.test(q) || limit)) {
    const moreOf = /\b(more|rest|others|another)\b/i.test(q)
    return {
      question: base,
      reason: moreOf ? `More results for “${state.topic ?? base}”` : `“${state.topic ?? base}”, ${limit === 1 ? 'the top result' : `top ${limit}`}`,
      excludeRefs: moreOf ? [...state.refs, ...exclude] : exclude,
      ...(limit && !moreOf ? { limit } : {}),
    }
  }
  return null
}

export function describeFollowUp(f: FollowUp): string {
  return `Interpreted as: ${f.reason}`
}

