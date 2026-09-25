import React, { useMemo } from 'react'
import { BookOpen, CornerDownLeft, Hash, Search, type LucideIcon } from 'lucide-react'
import { useAppStore } from '@/store'
import { parseRef, bookName, isStrongsRef } from '@/lib/parseRef'
import { navigateToVerse } from '@/lib/verseNavigation'
import { displayChapter } from '@/lib/chapterNumbering'
import { haptic } from '../primitives/haptics'

/**
 * What a typed query can open — the one vocabulary shared by Floating Search (the plus / ⌘T
 * new-tab sheet) and the caret's current-tab field (⌘L). The SAME destinations are offered for
 * either `target`; only which one is primary and where it lands differ:
 *   'new-tab'     — a reference opens a NEW Scripture tab, text a NEW Search tab (Floating Search,
 *                   unchanged behaviour);
 *   'current-tab' — a reference navigates the CURRENT Scripture tab, text searches in the current
 *                   Search tab (the store's openSearchTab), a Strong's number opens in the Lexicon.
 *
 * API
 *   classifyNewTabQuery(q)                       → what the text means (empty / ref / strongs / text)
 *   destinationSpecs(q, target)                  → pure list of { id, label, subtitle, primary } (tests)
 *   runDestination(id, q, target)                → performs one destination against the store
 *   useDestinationActions(q, target, onDone?)    → specs + icon + run() (onDone runs first: close the sheet)
 *   <DestinationList query target onDone />      → the inset-grouped rows (renders nothing for an empty query)
 *   runPrimaryDestination(q, target, onDone?)    → the Return-key action; false when the query is empty
 */
export type DestinationTarget = 'new-tab' | 'current-tab'

export type QueryMeaning =
  | { kind: 'empty' }
  | { kind: 'ref'; bookId: string; chapter: number; verse?: number; endVerse?: number; label: string }
  | { kind: 'strongs'; num: string }
  | { kind: 'text'; text: string }

/** What a typed query means for the new-tab / current-tab search. */
export function classifyNewTabQuery(q: string): QueryMeaning {
  const t = q.trim()
  if (!t) return { kind: 'empty' }
  if (isStrongsRef(t)) return { kind: 'strongs', num: t.toUpperCase().replace(/\s+/g, '') }
  if (/\p{L}.*\d/u.test(t)) {
    const p = parseRef(t)
    if (p) return { kind: 'ref', bookId: p.bookId, chapter: p.chapter, verse: p.verse, endVerse: p.endVerse, label: `${bookName(p.bookId)} ${displayChapter(p.bookId, p.chapter)}${p.verse ? `:${p.verse}${p.endVerse ? `–${p.endVerse}` : ''}` : ''}` }
  }
  return { kind: 'text', text: t }
}

export type DestinationId =
  | 'ref-new-tab' | 'ref-current-tab'
  | 'strongs-open'
  | 'search-new-tab' | 'search-current-tab'

export interface DestinationSpec {
  id: DestinationId
  label: string
  subtitle?: string
  primary?: boolean
}

const ICON: Record<DestinationId, LucideIcon> = {
  'ref-new-tab': BookOpen, 'ref-current-tab': CornerDownLeft, 'strongs-open': Hash,
  'search-new-tab': Search, 'search-current-tab': Search,
}

/** Pure: the destinations for a query, primary first. */
export function destinationSpecs(query: string, target: DestinationTarget): DestinationSpec[] {
  const q = classifyNewTabQuery(query)
  const newTab = target === 'new-tab'
  switch (q.kind) {
    case 'empty': return []
    case 'ref': return newTab
      ? [
        { id: 'ref-new-tab', label: `Open ${q.label}`, subtitle: 'New Scripture tab', primary: true },
        { id: 'ref-current-tab', label: 'Open in current tab' },
        { id: 'search-new-tab', label: `Search “${query.trim()}”`, subtitle: 'New Search tab' },
      ]
      : [
        { id: 'ref-current-tab', label: `Go to ${q.label}`, subtitle: 'This tab', primary: true },
        { id: 'ref-new-tab', label: 'Open in new tab' },
        { id: 'search-current-tab', label: `Search “${query.trim()}”` },
      ]
    case 'strongs': return [
      { id: 'strongs-open', label: `Open ${q.num}`, subtitle: 'Lexicon', primary: true },
      newTab
        ? { id: 'search-new-tab', label: `Find ${q.num} in Scripture`, subtitle: 'New Search tab' }
        : { id: 'search-current-tab', label: `Find ${q.num} in Scripture` },
    ]
    case 'text': return newTab
      ? [{ id: 'search-new-tab', label: `Search “${q.text}”`, subtitle: 'New Search tab', primary: true }]
      : [
        { id: 'search-current-tab', label: `Search “${q.text}”`, primary: true },
        { id: 'search-new-tab', label: 'Search in new tab' },
      ]
  }
}

/** A NEW Search tab (never the current one) with this query (T23-010). */
export function openQueryInNewSearchTab(query: string): void {
  const s = useAppStore.getState()
  s.createTab('search')
  const id = useAppStore.getState().activeTabId.search
  if (id) {
    s.updateTabState('search', id, { query, scope: 'scripture' })
    s.renameTab('search', id, `“${query.trim()}”`)
  }
  s.addRecentSearchQuery(query.trim())
  s.addHistoryEntry({ type: 'search', title: `"${query.trim()}"`, query: query.trim() })
}

/** Perform one destination. `target` only matters for the history origin label. */
export function runDestination(id: DestinationId, query: string, _target: DestinationTarget): void {
  const q = classifyNewTabQuery(query)
  const s = useAppStore.getState()
  switch (id) {
    case 'ref-new-tab':
    case 'ref-current-tab':
      if (q.kind !== 'ref') return
      if (id === 'ref-new-tab') s.createTab('bible')
      navigateToVerse({ bookId: q.bookId, chapter: q.chapter, verse: q.verse, endVerse: q.endVerse, origin: { kind: 'search-result', query } })
      return
    case 'strongs-open':
      if (q.kind === 'strongs') s.openLexiconEntry(q.num)
      return
    case 'search-new-tab': {
      const text = q.kind === 'strongs' ? q.num : query.trim()
      if (text) openQueryInNewSearchTab(text)
      return
    }
    case 'search-current-tab': {
      const text = q.kind === 'strongs' ? q.num : query.trim()
      if (!text) return
      s.addRecentSearchQuery(text)
      s.openSearchTab(text)
      return
    }
  }
}

export interface DestinationAction extends DestinationSpec { icon: LucideIcon; run: () => void }

/** Specs + icons + bound run(); `onDone` (close the sheet / blur the field) runs before each. */
export function useDestinationActions(query: string, target: DestinationTarget, onDone?: () => void): DestinationAction[] {
  return useMemo(() => destinationSpecs(query, target).map((spec) => ({
    ...spec,
    icon: ICON[spec.id],
    run: () => { void haptic.light(); onDone?.(); runDestination(spec.id, query, target) },
  })), [query, target, onDone])
}

/** The Return key: the primary destination. Returns false when there is nothing to do. */
export function runPrimaryDestination(query: string, target: DestinationTarget, onDone?: () => void): boolean {
  const primary = destinationSpecs(query, target).find((d) => d.primary)
  if (!primary) return false
  void haptic.light()
  onDone?.()
  runDestination(primary.id, query, target)
  return true
}

/** The destinations as Floating Search's inset-grouped rows (mobile-newtab-* styles). */
export function DestinationList({ query, target, onDone }: { query: string; target: DestinationTarget; onDone?: () => void }) {
  const actions = useDestinationActions(query, target, onDone)
  if (actions.length === 0) return null
  return (
    <div className="mobile-newtab-list mobile-newtab-section" role="group" aria-label="Open">
      {actions.map((a) => (
        <button key={a.id} type="button" className={`mobile-newtab-row${a.primary ? ' is-primary' : ''}`} onClick={a.run}>
          <span className="mobile-newtab-row-icon"><a.icon size={19} aria-hidden /></span>
          <span className="mobile-newtab-row-text"><span>{a.label}</span>{a.subtitle && <small>{a.subtitle}</small>}</span>
        </button>
      ))}
    </div>
  )
}
