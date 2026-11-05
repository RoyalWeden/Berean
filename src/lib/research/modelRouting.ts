// Model-assisted request understanding (Phase 3, holdout2 finding): the model reads WHAT is being
// asked about a word; the deterministic research layer answers it. The model never supplies a
// Strong's number — ids are kept only if they appear in the question or the conversation.

import { parseStrongsIds } from './strongsId'
import { stateFromTurns } from './conversationState'

export interface ModelLexicalReading {
  kind?: string
  term?: string | null
  lang?: string | null
  ref?: string | null
  book?: string | null
  ids?: string[] | null
}

/** Turns the model's structured reading of a word question into a canonical request the
 *  deterministic research layer understands. Returns null when there is nothing safe to ask. */
// Words that make a question ABOUT a word. Tested with the term itself removed, so a verse quote
// ("In the beginning was the Word") or a topical phrase ("live by faith") never routes (bench p3:
// K20, S20, B09 were sent to the lexicon on the model's say-so and lost their verses).
const WORD_QUESTION_RE = /\b(words?|terms?|mean(?:s|ing)?|define|definition|lexicon|lemma|strong'?s|hebrew|greek|aramaic|translated|rendered|equivalent|root|morpholog\w*|numbers?|occurrences?|transliterat\w*|interlinear|pars(?:e|ing))\b|["“'][\p{L}'-]{2,30}["”']|[\u0590-\u05FF\u0370-\u03FF\u1F00-\u1FFF]/iu

/** True when the question itself asks about a word — the model may then route it to the lexicon. */
export function looksLikeWordQuestion(question: string, term: string | null | undefined, conversationHasWord: boolean): boolean {
  const t = (term ?? '').trim()
  const rest = t ? question.replace(new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'giu'), ' ') : question
  if (WORD_QUESTION_RE.test(rest)) return true
  // A short follow-up in a conversation already studying a word ("is it used in Acts?").
  return conversationHasWord && question.trim().split(/\s+/).length <= 8
}

export function lexicalQuestionFromModel(lex: ModelLexicalReading, question: string, history: Array<{ content: string }>): string | null {
  const known = new Set(parseStrongsIds([question, ...history.map((h) => h.content)].join(' ')).map((m) => m.id))
  const ids = (lex.ids ?? []).flatMap((x) => parseStrongsIds(String(x)).map((m) => m.id)).filter((id) => known.has(id))
  // A value still holding the template's placeholder text ("<…>") was copied, not answered.
  const clean = (v: string | null | undefined) => (v && !/^\s*</.test(v) ? v : '')
  lex = { ...lex, kind: clean(lex.kind), term: clean(lex.term), lang: clean(lex.lang), ref: clean(lex.ref), book: clean(lex.book) }
  const lang = /^heb/i.test(lex.lang ?? '') ? 'Hebrew ' : /^gre/i.test(lex.lang ?? '') ? 'Greek ' : ''
  // A blank term is filled deterministically: a quoted word in the question, else the word the
  // conversation was already studying. Never from the model's memory.
  const quoted = question.match(/["“']([\p{L}'-]{2,30})["”']/u)?.[1]
  const conv = stateFromTurns(history.map((h) => ({ role: (h as { role?: string }).role === 'assistant' ? 'assistant' : 'user', content: h.content })))
  if (!looksLikeWordQuestion(question, lex.term, Boolean(conv.term) || conv.strongs.length > 0)) return null
  const term = ((lex.term ?? '') || quoted || conv.term || '').replace(/["“”']/g, '').trim().slice(0, 40)
  if (!lex.ids?.length && conv.strongs.length && (lex.kind === 'occurrences' || lex.kind === 'compare')) lex = { ...lex, ids: conv.strongs }
  const ref = (lex.ref ?? '').trim().slice(0, 40)
  const book = (lex.book ?? '').trim().slice(0, 30)
  switch (lex.kind) {
    case 'word-table': return ref ? `every word and Strong's number in ${ref}` : null
    case 'compare': return ids.length >= 2 ? `compare ${ids[0]} and ${ids[1]}` : null
    case 'occurrences':
      if (ids.length) return `every occurrence of ${ids[0]}${book ? ` in ${book}` : ''}`
      return term ? `every occurrence of the ${lang}word for ${term}${book ? ` in ${book}` : ''}` : null
    case 'word-study':
      if (term && !/^[HG]\d+$/i.test(term)) return `the ${lang}word for ${term}${ref ? ` in ${ref}` : ''}`
      return ids.length ? ids[0] : null
    default: return null
  }
}

