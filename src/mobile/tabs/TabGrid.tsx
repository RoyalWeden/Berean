import React, { useState } from 'react'
import { Reorder } from 'framer-motion'
import { X, Pin, Layers, GripVertical, ArrowUpDown } from 'lucide-react'
import { singleMove } from './reorderDiff'
import { useAppStore } from '@/store'
import type { SpaceId } from '@/types'
import { haptic } from '../primitives/haptics'
import { tabTitle } from './TabPill'
import { useLongPress } from '../primitives/useLongPress'
import { SESSION_ICONS } from '@/components/shell/Sidebar'

/**
 * Tab grid for one space (R071): every open tab as a card; tap → switch, × → close, long-press →
 * actions. The session (workspace) switcher opens from the header button.
 */
export function TabGrid({ space, close, onOpenSessions, onTabActions }: { space: SpaceId; close: () => void; onOpenSessions: () => void; onTabActions: (tabId: string) => void }) {
  const tabs = useAppStore((s) => s.tabs[space])
  const activeId = useAppStore((s) => s.activeTabId[space])
  const setActiveTab = useAppStore((s) => s.setActiveTab)
  const closeTab = useAppStore((s) => s.closeTab)
  const session = useAppStore((s) => s.sessions.find((x) => x.id === s.currentSessionId))
  const reorderTabs = useAppStore((s) => s.reorderTabs)
  // Drag-to-reorder (R071): "Reorder" switches the grid to a one-column list whose rows drag
  // (framer Reorder, one axis); each drop becomes the same `reorderTabs(space, from, to)` the
  // desktop tab bar uses. Long-press → Move up / down stays for VoiceOver users.
  const [reordering, setReordering] = useState(false)
  const ids = tabs.map((t) => t.id)
  const onReorder = (next: string[]) => { const mv = singleMove(ids, next); if (mv) { void haptic.selection(); reorderTabs(space, mv.from, mv.to) } }
  return (
    <div className="mobile-tab-grid">
      <div className="mobile-tab-grid-head">
        <button type="button" className="mobile-chip" onClick={onOpenSessions} aria-label="Switch workspace">
          {(() => { const I = (SESSION_ICONS.find((i) => i.name === session?.icon) ?? { Icon: Layers }).Icon; return <I size={16} aria-hidden /> })()} {session?.name ?? 'Workspace'}
        </button>
        <span className="mobile-muted">{tabs.length} tab{tabs.length === 1 ? '' : 's'}</span>
        {tabs.length > 1 && <button type="button" className={`mobile-chip${reordering ? ' is-on' : ''}`} aria-pressed={reordering} onClick={() => setReordering((r) => !r)}><ArrowUpDown size={14} aria-hidden /> {reordering ? 'Done' : 'Reorder'}</button>}
      </div>
      {tabs.length === 0 && <div className="mobile-empty">No open tabs in this space.</div>}
      {reordering ? (
        <Reorder.Group axis="y" values={ids} onReorder={onReorder} className="mobile-tab-reorder" as="ul">
          {tabs.map((t) => (
            <Reorder.Item key={t.id} value={t.id} className={`mobile-tab-reorder-row${t.id === activeId ? ' is-active' : ''}`} as="li" whileDrag={{ scale: 1.02, boxShadow: '0 8px 24px rgb(0 0 0 / 0.18)' }}>
              <GripVertical size={18} aria-hidden className="mobile-tab-reorder-grip" />
              <span className="mobile-tab-reorder-title">{tabTitle(t)}</span>
              {t.isPinned && <Pin size={12} aria-label="Pinned" />}
            </Reorder.Item>
          ))}
        </Reorder.Group>
      ) : (
      <div className="mobile-tab-cards">
        {tabs.map((t) => (
          <TabCard key={t.id} title={tabTitle(t)} pinned={!!t.isPinned} active={t.id === activeId}
            onOpen={() => { void haptic.selection(); setActiveTab(space, t.id); close() }}
            onClose={() => { void haptic.light(); closeTab(space, t.id) }}
            onLongPress={() => onTabActions(t.id)} />
        ))}
      </div>
      )}
    </div>
  )
}

function TabCard({ title, pinned, active, onOpen, onClose, onLongPress }: { title: string; pinned: boolean; active: boolean; onOpen: () => void; onClose: () => void; onLongPress: () => void }) {
  const lp = useLongPress(() => { void haptic.medium(); onLongPress() })
  return (
    <div className={`mobile-tab-card${active ? ' is-active' : ''}`} {...lp}>
      <button type="button" className="mobile-tab-card-main" onClick={onOpen} aria-current={active ? 'true' : undefined}>
        {pinned && <Pin size={12} aria-label="Pinned" />}
        <span>{title}</span>
      </button>
      {!pinned && (
        <button type="button" className="mobile-tab-card-close" aria-label={`Close ${title}`} onClick={onClose}>
          <X size={16} aria-hidden />
        </button>
      )}
    </div>
  )
}
