import React from 'react'
import { X, Pin, Layers } from 'lucide-react'
import { useAppStore } from '@/store'
import type { SpaceId } from '@/types'
import { haptic } from '../primitives/haptics'
import { tabTitle } from './TabPill'
import { useLongPress } from '../primitives/useLongPress'

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
  return (
    <div className="mobile-tab-grid">
      <div className="mobile-tab-grid-head">
        <button type="button" className="mobile-chip" onClick={onOpenSessions} aria-label="Switch workspace">
          <Layers size={16} aria-hidden /> {session?.icon ? `${session.icon} ` : ''}{session?.name ?? 'Workspace'}
        </button>
        <span className="mobile-muted">{tabs.length} tab{tabs.length === 1 ? '' : 's'}</span>
      </div>
      {tabs.length === 0 && <div className="mobile-empty">No open tabs in this space.</div>}
      <div className="mobile-tab-cards">
        {tabs.map((t) => (
          <TabCard key={t.id} title={tabTitle(t)} pinned={!!t.isPinned} active={t.id === activeId}
            onOpen={() => { void haptic.selection(); setActiveTab(space, t.id); close() }}
            onClose={() => { void haptic.light(); closeTab(space, t.id) }}
            onLongPress={() => onTabActions(t.id)} />
        ))}
      </div>
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
