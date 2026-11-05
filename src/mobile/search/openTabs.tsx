import React, { useCallback, useMemo } from 'react'
import { Layers } from 'lucide-react'
import { useAppStore } from '@/store'
import type { Destination } from '@/lib/navigation/destination'
import { findOpenTabs, tabsMatchingText, tabShowsDestination, allSessionTabs, type TabMatch, type ResolutionState } from '@/lib/navigation/tabResolution'
import { tabKind, tabTitle } from '../tabs/tabLabels'
import type { UnifiedPick } from './UnifiedResults'
import { LongPressResult } from './ResultActionSheet'

/**
 * Quick Open's awareness of open tabs (QO-002): which results are already in a tab (and where),
 * and the open tabs a typed query names. Derived from the store on demand — no second tab list.
 */
export function useOpenTabIndex() {
  const tabs = useAppStore((s) => s.tabs)
  const sessions = useAppStore((s) => s.sessions)
  const currentSessionId = useAppStore((s) => s.currentSessionId)
  const defaultBibleTranslation = useAppStore((s) => s.defaultBibleTranslation)
  const mru = useAppStore((s) => s.tabMRUList)
  const state: ResolutionState = useMemo(() => ({ tabs, sessions, currentSessionId, defaultBibleTranslation }), [tabs, sessions, currentSessionId, defaultBibleTranslation])
  const prefer = useMemo(() => mru.map((m) => m.tabId), [mru])
  /** The best open tab for a destination: the current session's first, else another session's. */
  const matchOf = useCallback((d: Destination | null): TabMatch | null => (d ? findOpenTabs(d, state, { preferTabIds: prefer })[0] ?? null : null), [state, prefer])
  return { state, matchOf }
}

/** A result's destination when it is known without a lookup (resolvePlace items are not). */
export function syncDestination(p: UnifiedPick): Destination | null {
  switch (p.kind) {
    case 'goto': return p.item.destination ?? null
    case 'verse': return { kind: 'passage', bookId: p.hit.book_id, chapter: p.hit.chapter, verse: p.hit.verse_num, textId: p.hit.textId }
    case 'entry': return { kind: 'strongs', num: p.entry.strongsNum }
    case 'note': return { kind: 'note', noteId: p.note.id }
  }
}

/** The row status for a match: "Open" in this session, the session's name elsewhere. */
export const matchLabel = (m: TabMatch | null): string | undefined => (m ? (m.current ? 'Open' : m.sessionName) : undefined)

const MAX_ROWS = 4

/**
 * Open tabs the query names — by title / kind, or because a Go-to result IS that tab's resource
 * ("rom 13" → the open "Romans 13" tab). Current session first; other sessions name theirs.
 */
export function openTabsFor(query: string, goTo: Destination[], state: ResolutionState): TabMatch[] {
  const seen = new Set<string>()
  const out: TabMatch[] = []
  const add = (m: TabMatch) => { const k = `${m.sessionId}|${m.tab.id}`; if (!seen.has(k)) { seen.add(k); out.push(m) } }
  const all = allSessionTabs(state)
  for (const d of goTo) for (const m of all) if (tabShowsDestination(m.tab, d, state.defaultBibleTranslation)) add(m)
  for (const m of tabsMatchingText(query, state, (t) => `${tabTitle(t)} ${tabKind(t).label}`)) add(m)
  return out.sort((a, b) => Number(b.current) - Number(a.current)).slice(0, MAX_ROWS)
}

export function OpenTabsGroup({ matches, onPick, onLongPick }: { matches: TabMatch[]; onPick: (m: TabMatch) => void; onLongPick: (m: TabMatch) => void }) {
  if (!matches.length) return null
  return (
    <section className="mobile-newtab-section" aria-label="Open tabs">
      <div className="mobile-newtab-section-head"><h3>Open tabs</h3></div>
      <div className="mobile-newtab-list">
        {matches.map((m) => {
          const K = tabKind(m.tab)
          const title = tabTitle(m.tab)
          return (
            <LongPressResult key={`${m.sessionId}|${m.tab.id}`} onLongPress={() => onLongPick(m)}>
              <button type="button" className="mobile-newtab-row m-qo-tab" onClick={() => onPick(m)}
                aria-label={`${title}, ${K.label}, ${m.current ? 'switch to open tab' : `open tab in ${m.sessionName}`}`}>
                <span className="mobile-newtab-row-icon"><K.icon size={18} aria-hidden /></span>
                <span className="mobile-newtab-row-text"><span>{title}</span><small className="m-qo-sub">{K.label}</small></span>
                {m.current
                  ? <span className="m-qo-status">Switch to Tab</span>
                  : <span className="m-qo-status is-elsewhere"><Layers size={12} aria-hidden />{m.sessionName}</span>}
              </button>
            </LongPressResult>
          )
        })}
      </div>
    </section>
  )
}
