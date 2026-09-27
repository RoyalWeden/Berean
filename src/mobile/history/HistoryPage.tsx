import React, { useEffect, useMemo, useState } from 'react'
import { useAppStore } from '@/store'
import type { HistoryEntry, Tab } from '@/types'
import { useHistoryNavigate } from '@/components/shell/HistoryModal'
import { HISTORY_CATEGORIES, HISTORY_TYPE_LABEL, countByCategory, filterHistory, shouldLoadMoreHistory, type HistoryCategory } from '@/lib/historyModel'
import { bookChapterVerseLabel } from '@/lib/parseRef'
import { openDestination } from '@/lib/navigation/destination'
import { historyDestination } from '@/lib/navigation/historyDestination'
import { Page, ListSection, Row } from '../primitives/Page'
import { useActionSheet } from '../primitives/ActionSheet'
import { haptic } from '../primitives/haptics'
import { historyEntryActions } from '../search/resultActions'
import { LongPressResult, specsToActions, copyText } from '../search/ResultActionSheet'

/**
 * History — shared by three places, one implementation: a page under More, a dedicated History tab
 * (T23-009, its filter kept in the tab), and a view INSIDE a sheet (Search caret → History,
 * NEW-014 — the same sheet changes to History with "‹ Search" at its top). Same categories and
 * filter rules as the desktop History modal (src/lib/historyModel.ts, TEST-002).
 */
function useHistoryModel(tab?: Tab) {
  const history = useAppStore((s) => s.history)
  const hasMore = useAppStore((s) => s.historyHasMore)
  const loadingMore = useAppStore((s) => s.historyLoadingMore)
  const loadMore = useAppStore((s) => s.loadMoreHistory)
  const tabState = tab?.state as { category?: HistoryCategory; studyOnly?: boolean } | undefined
  const [category, setCategoryLocal] = useState<HistoryCategory>(tabState?.category ?? 'all')
  const [studyOnly, setStudyOnlyLocal] = useState(tabState?.studyOnly ?? false)
  const setCategory = (c: HistoryCategory) => { setCategoryLocal(c); if (tab) useAppStore.getState().updateTabState('search', tab.id, { category: c }) }
  const setStudyOnly = (v: boolean) => { setStudyOnlyLocal(v); if (tab) useAppStore.getState().updateTabState('search', tab.id, { studyOnly: v }) }
  const rows = useMemo(() => filterHistory(history, { category, studyOnly: studyOnly && category === 'scripture' }), [history, category, studyOnly])
  const counts = useMemo(() => countByCategory(history), [history])
  useEffect(() => {
    if (category !== 'all' && shouldLoadMoreHistory(rows.length, hasMore, loadingMore)) void loadMore()
  }, [category, rows.length, hasMore, loadingMore, loadMore])
  return { history, hasMore, loadingMore, loadMore, category, setCategory, studyOnly, setStudyOnly, rows, counts }
}

function CategoryChips({ m }: { m: ReturnType<typeof useHistoryModel> }) {
  return (
    <div className="mobile-chip-row mobile-chip-row-scroll" role="tablist" aria-label="History category">
      {HISTORY_CATEGORIES.map((c) => (
        <button key={c.key} type="button" role="tab" aria-selected={m.category === c.key} className={`mobile-chip${m.category === c.key ? ' is-on' : ''}`} onClick={() => m.setCategory(c.key)}>
          {c.label}{c.key !== 'all' && m.counts[c.key] ? ` · ${m.counts[c.key]}` : ''}
        </button>
      ))}
      {m.category === 'scripture' && (
        <button type="button" className={`mobile-chip${m.studyOnly ? ' is-on' : ''}`} aria-pressed={m.studyOnly} onClick={() => m.setStudyOnly(!m.studyOnly)}>Study only</button>
      )}
    </div>
  )
}

/** The tab type a history entry opens in, for "Open in New Tab" (null = no dedicated new tab). */
const NEW_TAB_TYPE: Partial<Record<HistoryEntry['type'], 'bible' | 'note' | 'lexicon' | 'search'>> = {
  bible: 'bible', compare: 'bible', note: 'note', lexicon: 'lexicon', 'strongs-click': 'lexicon', search: 'search',
}

/** Long-press menu for a History row (SEP25): Open is exactly the tap. */
function useHistoryRowActions(onNavigated?: () => void) {
  const navigate = useHistoryNavigate()
  const sheet = useActionSheet()
  // Open = THIS tab (NAV-002): the History tab (or the tab under a History sheet) becomes the
  // entry — ‹ returns. "Open in New Tab" is the long press. It used to reuse the active tab of the
  // entry's space, i.e. a different tab. Entries with no destination form keep the desktop path.
  const open = (h: HistoryEntry, intent: 'current-tab' | 'new-tab' = 'current-tab') => {
    onNavigated?.()
    const d = historyDestination(h)
    if (d) openDestination(d, intent, { origin: { kind: 'history-revisit' } })
    else navigate(h)
  }
  const menu = (h: HistoryEntry) => {
    const s = useAppStore.getState()
    sheet(`history-${h.id}`, h.title, specsToActions(historyEntryActions(h.type), {
      'open': () => open(h),
      'open-new-tab': () => { if (NEW_TAB_TYPE[h.type]) open(h, 'new-tab') },
      'copy-ref': () => copyText(h.bookId ? bookChapterVerseLabel(h.bookId, h.chapter ?? 1, h.verse) : h.title),
      'copy-strongs': () => copyText(h.strongsNum ?? h.title),
      'copy-query': () => copyText(h.query ?? h.title),
      'copy-title': () => copyText(h.title),
      'remove': () => { s.deleteHistoryEntry(h.id); void haptic.medium() },
    }))
  }
  return { open, menu }
}

function HistoryRows({ m, onNavigated }: { m: ReturnType<typeof useHistoryModel>; onNavigated?: () => void }) {
  const actions = useHistoryRowActions(onNavigated)
  return (
    <ListSection>
      {m.rows.length === 0 && <div className="mobile-empty">{m.history.length === 0 ? 'Nothing yet.' : 'No entries in this category.'}</div>}
      {m.rows.slice(0, 400).map((h) => (
        <LongPressResult key={h.id} onLongPress={() => actions.menu(h)}>
          <Row title={h.title} subtitle={`${HISTORY_TYPE_LABEL[h.type]} · ${new Date(h.timestamp).toLocaleString()}`} onClick={() => actions.open(h)} />
        </LongPressResult>
      ))}
      {m.hasMore && <Row title={m.loadingMore ? 'Loading…' : 'Load older history'} onClick={() => void m.loadMore()} />}
    </ListSection>
  )
}

/** History as a page (More → History) or a dedicated History tab (`tab`, no back). */
export function HistoryPage({ onBack, tab }: { onBack?: () => void; tab?: Tab }) {
  const m = useHistoryModel(tab)
  return (
    <Page title="History" onBack={onBack} headerBelow={<CategoryChips m={m} />}>
      <HistoryRows m={m} onNavigated={onBack} />
    </Page>
  )
}

/** History as the body of a sheet view; `onNavigated` closes the sheet. */
export function HistoryView({ onNavigated }: { onNavigated: () => void }) {
  const m = useHistoryModel()
  return (
    <div className="mobile-history-view">
      <CategoryChips m={m} />
      <HistoryRows m={m} onNavigated={onNavigated} />
    </div>
  )
}
