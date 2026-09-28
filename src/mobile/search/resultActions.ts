/**
 * Which actions a long-pressed Search result offers (SEP24). Pure — SearchPage maps each id to its
 * icon and handler. The vocabulary follows the Scripture verse sheet (Copy reference, Copy verse,
 * Note, Share, Highlight) so a verse long-pressed in Search offers the same words as in the reader.
 * Only actions valid for the result's type are listed; Cancel is always last.
 */
import type { HistoryEntry } from '@/types'

export type SearchResultKind = 'scripture' | 'note' | 'lexicon' | 'recent'

export type SearchResultActionId =
  | 'open' | 'open-new-tab' | 'open-lexicon-tab'
  | 'copy-ref' | 'copy-verse' | 'copy-title' | 'copy-strongs' | 'copy-query'
  | 'share' | 'add-note' | 'highlight'
  | 'search-new-tab'
  | 'remove'
  | 'cancel'

export interface SearchResultActionSpec {
  id: SearchResultActionId
  label: string
  /** Opens a sub-view inside the same sheet (the highlight colours). */
  submenu?: boolean
}

const A = (id: SearchResultActionId, label: string, submenu?: boolean): SearchResultActionSpec => (submenu ? { id, label, submenu } : { id, label })

export function searchResultActions(kind: SearchResultKind, opts: { canShare?: boolean } = {}): SearchResultActionSpec[] {
  const share = opts.canShare === false ? [] : [A('share', 'Share…')]
  switch (kind) {
    case 'scripture': return [
      A('open', 'Open'),
      A('open-new-tab', 'Open in New Tab'),
      A('copy-ref', 'Copy Reference'),
      A('copy-verse', 'Copy Verse'),
      ...share,
      A('add-note', 'Add Note'),
      A('highlight', 'Highlight', true),
      A('cancel', 'Cancel'),
    ]
    case 'note': return [
      A('open', 'Open'),
      A('open-new-tab', 'Open in New Tab'),
      A('copy-title', 'Copy Title'),
      ...share,
      A('cancel', 'Cancel'),
    ]
    case 'lexicon': return [
      A('open', 'Open'),
      A('open-lexicon-tab', 'Open in Lexicon Tab'),
      A('copy-strongs', "Copy Strong's Number"),
      A('cancel', 'Cancel'),
    ]
    case 'recent': return [
      A('open', 'Search'),
      A('search-new-tab', 'Search in New Tab'),
      A('copy-query', 'Copy'),
      A('cancel', 'Cancel'),
    ]
  }
}

/**
 * Long-press on a History row (SEP25): Open (= the tap), Open in New Tab where that type has
 * its own tab kind, the copy that suits the entry, and Remove from History. An import entry has
 * nothing to open. Cancel is always last.
 */
export function historyEntryActions(type: HistoryEntry['type']): SearchResultActionSpec[] {
  const openable = type !== 'import'
  const newTab = type === 'bible' || type === 'compare' || type === 'note' || type === 'lexicon' || type === 'strongs-click' || type === 'search'
  const copy = type === 'bible' || type === 'compare' ? A('copy-ref', 'Copy Reference')
    : type === 'lexicon' || type === 'strongs-click' ? A('copy-strongs', "Copy Strong's Number")
      : type === 'search' ? A('copy-query', 'Copy Search')
        : A('copy-title', 'Copy Title')
  return [
    ...(openable ? [A('open', 'Open')] : []),
    ...(newTab ? [A('open-new-tab', 'Open in New Tab')] : []),
    copy,
    A('remove', 'Remove from History'),
    A('cancel', 'Cancel'),
  ]
}

// ── tab-card preview summary ───────────────────────────────────────────────────────────────
/** A search tab's tiny result snapshot for its tab card (tab state `preview`; LOCAL, never synced). */
export interface SearchPreviewSummary {
  /** The query the summary belongs to (a stale summary for another query is ignored). */
  query: string
  total: number
  lines: Array<{ ref: string; snippet: string }>
}

export const SEARCH_PREVIEW_LINES = 3
const SNIPPET_MAX = 90

const clean = (s: string) => s.replace(/\{[HG]\d+\}/g, '').replace(/\s+/g, ' ').trim()
const clip = (s: string, n = SNIPPET_MAX) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s)

export function buildSearchPreview(query: string, total: number, rows: Array<{ ref: string; text: string }>): SearchPreviewSummary {
  return { query: query.trim(), total, lines: rows.slice(0, SEARCH_PREVIEW_LINES).map((r) => ({ ref: r.ref, snippet: clip(clean(r.text)) })) }
}

export function samePreview(a: SearchPreviewSummary | null | undefined, b: SearchPreviewSummary | null | undefined): boolean {
  if (!a || !b) return a === b
  return a.query === b.query && a.total === b.total && a.lines.length === b.lines.length
    && a.lines.every((l, i) => l.ref === b.lines[i].ref && l.snippet === b.lines[i].snippet)
}
