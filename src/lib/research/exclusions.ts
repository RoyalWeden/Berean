// "…but not human rulers", "…, not from Romans" (spec scenario 7). The clause is taken out of the
// question before searching (otherwise "Romans" would SCOPE the search to Romans) and applied to
// the results as a filter. Pure; shared by desktop and iPhone.

export interface QuestionExclusions {
  /** The question without the clause. */
  remainder: string
  /** Lower-case words a result must not contain. */
  terms: string[]
  /** Book ids, or text ids for single-work texts such as Enoch. */
  bookIds: string[]
}

const NONE = (question: string): QuestionExclusions => ({ remainder: question, terms: [], bookIds: [] })

// Only a request for verses can carry a word exclusion: "persecuted, but not forsaken" and "except
// a man be born again" are Scripture to find, not filters.
const ASKS_FOR_VERSES_RE = /\b(?:verses?|passages?|scriptures?|find|show|list)\b/i
const CLAUSE_RE = /[,;]?\s*\b(?:but\s+not|and\s+not|not\s+including|excluding|except\s+for|other\s+than|leaving\s+out|leave\s+out)\s+([^,.;?!]+)/i
const BOOK_CLAUSE_RE = /[,;]?\s*\b(?:(?:but|and)\s+)?not\s+(?:from|in)\s+((?:the\s+book\s+of\s+)?[^,.;?!]+)/i

const FILLER = new Set(['the', 'a', 'an', 'of', 'to', 'from', 'in', 'about', 'on', 'book', 'any', 'those', 'that', 'mention', 'mentioning', 'verses', 'passages'])

export function parseExclusions(question: string, resolveBook: (phrase: string) => string | null): QuestionExclusions {
  const bookClause = question.match(BOOK_CLAUSE_RE)
  if (bookClause) {
    const book = resolveBook(bookClause[1])
    if (book) return { remainder: question.replace(bookClause[0], '').trim(), terms: [], bookIds: [book] }
  }
  if (!ASKS_FOR_VERSES_RE.test(question)) return NONE(question)
  const clause = question.match(CLAUSE_RE)
  if (!clause) return NONE(question)
  const remainder = question.replace(clause[0], '').trim()
  const book = resolveBook(clause[1])
  if (book) return { remainder, terms: [], bookIds: [book] }
  const terms = (clause[1].toLowerCase().match(/[\p{L}']+/gu) ?? []).filter((w) => w.length > 2 && !FILLER.has(w))
  return terms.length > 0 ? { remainder, terms, bookIds: [] } : NONE(question)
}

/** Whole-word match, tolerant of a plural on either side ("rulers" also excludes "ruler"). */
export function mentionsExcluded(text: string, terms: readonly string[]): boolean {
  const words = new Set(text.toLowerCase().match(/[\p{L}']+/gu) ?? [])
  return terms.some((t) => words.has(t) || words.has(`${t}s`) || (t.endsWith('s') && words.has(t.slice(0, -1))))
}
