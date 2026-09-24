import React, { useEffect, useMemo, useState } from 'react'
import { useAppStore } from '@/store'
import type { Tab } from '@/types'
import { useHistoryNavigate } from '@/components/shell/HistoryModal'
import { HISTORY_CATEGORIES, HISTORY_TYPE_LABEL, countByCategory, filterHistory, shouldLoadMoreHistory, type HistoryCategory } from '@/lib/historyModel'
import { Page, ListSection, Row } from '../primitives/Page'

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

function HistoryRows({ m, onNavigated }: { m: ReturnType<typeof useHistoryModel>; onNavigated?: () => void }) {
  const navigate = useHistoryNavigate()
  return (
    <ListSection>
      {m.rows.length === 0 && <div className="mobile-empty">{m.history.length === 0 ? 'Nothing yet.' : 'No entries in this category.'}</div>}
      {m.rows.slice(0, 400).map((h) => (
        <Row key={h.id} title={h.title} subtitle={`${HISTORY_TYPE_LABEL[h.type]} · ${new Date(h.timestamp).toLocaleString()}`} onClick={() => { onNavigated?.(); navigate(h) }} />
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
