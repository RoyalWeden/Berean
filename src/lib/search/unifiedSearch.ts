import type { LexiconEntry, Note } from '@/types'
import type { WordReplacerRule } from '@/store'
import type { WordMode } from '@/lib/scriptureHighlight'
import { runScriptureSearch, runStrongsSearch, type ScriptureHit } from '@/lib/scriptureSearch'
import { singleBookOf, type PassageDestination } from '@/lib/passageDestinations'
import { bookName } from '@/lib/parseRef'
import type { Destination } from '@/lib/navigation/destination'
import { parseSearchIntent, type IntentContext, type SearchIntent } from './searchIntent'

/**
 * "Search Berean" — one grouped result set over every searchable source (SRCH-001): the places a
 * query names (Go to), verses in every bundled text (KJV + Apocrypha, LXX, 1 Enoch, Jubilees and
 * the other library texts), Strong's Hebrew / Greek entries, and the user's notes. Built only on
 * the shared services the desktop uses (scriptureSearch / strongsSearch / notes.searchNotes /
 * lexicon.search) — the iPhone plus and caret searches and the Search tab's "All" scope all call
 * this; the tab type a search starts from never narrows it (only `scope` / `filters` do).
 */
export type UnifiedScope = 'all' | 'scripture' | 'notes' | 'lexicon'

export interface UnifiedFilters {
  /** 'all' = every searchable text. A source named in the query overrides it. */
  textId: string | 'all'
  wordMode: WordMode
  /** Individual books (ids); empty = every book. */
  books: string[]
}
export const DEFAULT_UNIFIED_FILTERS: UnifiedFilters = { textId: 'all', wordMode: 'all', books: [] }

export interface GoToItem {
  key: string
  label: string
  subtitle?: string
  kind: 'passage' | 'book' | 'collection' | 'strongs' | 'notes'
  destination: Destination | null
  /** A place still to resolve (a collection's first book is looked up when it is picked). */
  place?: PassageDestination
}

export interface UnifiedResults {
  intent: SearchIntent
  goTo: GoToItem[]
  /** null = not searched for this scope / query. */
  verses: ScriptureHit[] | null
  entries: LexiconEntry[] | null
  notes: Note[] | null
}

export interface UnifiedSearchOptions {
  scope: UnifiedScope
  filters: UnifiedFilters
  context?: IntentContext
  wordReplacerEnabled: boolean
  wordReplacerRules: WordReplacerRule[]
  /** Max notes / lexicon entries fetched (verses are always complete — the caller pages them). */
  limit?: number
}

const includes = (scope: UnifiedScope, s: Exclude<UnifiedScope, 'all'>) => scope === 'all' || scope === s

/** A resolved place as a navigation destination (collections / books open at their start). */
export function placeDestination(p: PassageDestination): Destination | null {
  if (p.kind === 'passage') return { kind: 'passage', bookId: p.bookId, chapter: p.chapter, verse: p.verse, endVerse: p.endVerse, textId: p.textId }
  if (p.kind === 'book') return { kind: 'passage', bookId: p.bookId, chapter: 1, textId: p.textId }
  const single = singleBookOf(p.textId)
  return single ? { kind: 'passage', bookId: single, chapter: 1, textId: p.textId } : null
}

/** A collection's first book (Apocrypha → its first book; LXX → Genesis) — resolved on demand. */
export async function resolvePlace(p: PassageDestination): Promise<Destination | null> {
  const direct = placeDestination(p)
  if (direct) return direct
  try {
    const books = await window.bible.getBooks(p.textId)
    const first = p.kind === 'collection' && p.group ? books.find((b) => b.testament === p.group) : books[0]
    return first ? { kind: 'passage', bookId: first.id, chapter: 1, textId: p.textId } : null
  } catch { return null }
}

/** Pure: the Go-to rows for a parsed query (tests use this directly). */
export function goToItems(intent: SearchIntent, scope: UnifiedScope): GoToItem[] {
  const out: GoToItem[] = []
  if (intent.notesOnly && !intent.text) out.push({ key: 'notes', label: 'Notes', subtitle: 'All your notes', kind: 'notes', destination: null })
  if (includes(scope, 'lexicon')) for (const n of intent.strongs) out.push({ key: `s:${n}`, label: n, subtitle: n.startsWith('H') ? "Strong's Hebrew" : "Strong's Greek", kind: 'strongs', destination: { kind: 'strongs', num: n } })
  if (includes(scope, 'scripture')) {
    for (const p of intent.places) {
      out.push({ key: p.key, label: p.label, subtitle: p.subtitle, kind: p.kind, destination: placeDestination(p), place: p })
    }
  }
  return out
}

export async function runUnifiedSearch(query: string, o: UnifiedSearchOptions): Promise<UnifiedResults> {
  const intent = parseSearchIntent(query, o.context)
  const scope: UnifiedScope = intent.notesOnly ? 'notes' : o.scope
  const goTo = goToItems(intent, scope)
  const text = intent.text
  const wordMode: WordMode = intent.phrase ? 'phrase' : o.filters.wordMode
  const limit = o.limit ?? 200
  const words = text.length >= 2

  const versesP: Promise<ScriptureHit[] | null> = !includes(scope, 'scripture') ? Promise.resolve(null)
    : intent.strongsQuery ? runStrongsSearch(intent.strongsQuery)
    : words ? runScriptureSearch(text, {
      textId: intent.textId ?? o.filters.textId, wordMode,
      bookIds: o.filters.books.length ? o.filters.books : undefined,
      wordReplacerEnabled: o.wordReplacerEnabled, wordReplacerRules: o.wordReplacerRules,
    })
    : Promise.resolve(null)

  const entriesP: Promise<LexiconEntry[] | null> = !includes(scope, 'lexicon') ? Promise.resolve(null)
    : intent.strongs.length ? Promise.all(intent.strongs.map((n) => window.lexicon.getEntry(n).catch(() => null))).then((r) => r.filter((e): e is LexiconEntry => !!e))
    : words && !intent.textId ? window.lexicon.search(text, 'all').then((r) => r.slice(0, limit)).catch(() => [])
    : Promise.resolve(null)

  const notesP: Promise<Note[] | null> = !includes(scope, 'notes') || intent.strongs.length ? Promise.resolve(null)
    : words ? window.notes.searchNotes(text, limit, wordMode).catch(() => [])
    : Promise.resolve(null)

  const [verses, entries, notes] = await Promise.all([versesP.catch(() => []), entriesP, notesP])
  // "strong 430": only the numbers that exist are offered.
  const exists = entries && intent.strongs.length ? new Set(entries.map((e) => e.strongsNum.toUpperCase())) : null
  return {
    intent,
    goTo: exists ? goTo.filter((g) => g.kind !== 'strongs' || exists.has(g.label.toUpperCase())) : goTo,
    verses, entries, notes,
  }
}

/** Short source label for a hit ("LXX", "1 Enoch"; KJV + Apocrypha shows none). */
export function hitSourceLabel(textId: string, labels: ReadonlyArray<{ id: string; label: string }>): string | null {
  if (textId === 'kjva') return null
  return labels.find((t) => t.id === textId)?.label ?? textId
}

/** Book heading for grouped hits. */
export const hitBookName = (bookId: string) => bookName(bookId)
