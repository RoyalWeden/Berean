import React, { useMemo, useState } from 'react'
import { Reorder } from 'framer-motion'
import { X, Pin, Layers, GripVertical, ArrowUpDown, BookOpen, NotepadText, BookMarked, Youtube, Search, FileText, Tags, Archive, Plus, type LucideIcon } from 'lucide-react'
import { singleMove } from './reorderDiff'
import { useAppStore } from '@/store'
import type { SpaceId, Tab } from '@/types'
import { haptic } from '../primitives/haptics'
import { useLongPress } from '../primitives/useLongPress'
import { SESSION_ICONS } from '@/components/shell/Sidebar'

export const SPACE_ORDER: SpaceId[] = ['scripture', 'notes', 'lexicon', 'youtube', 'search']

/** Icon + short kind label for a tab — Scripture, Compare, PDF, Note, Tags, Lexicon, YouTube, Search. */
export function tabKind(t: Tab): { icon: LucideIcon; label: string } {
  if (t.type === 'bible') return { icon: BookOpen, label: (t.state as { compareMode?: boolean }).compareMode ? 'Compare' : 'Scripture' }
  if (t.type === 'pdf') return { icon: FileText, label: 'PDF' }
  if (t.type === 'note') return { icon: NotepadText, label: 'Note' }
  if (t.type === 'tags') return { icon: Tags, label: 'Tags' }
  if (t.type === 'lexicon') return { icon: BookMarked, label: 'Lexicon' }
  if (t.type === 'youtube') return { icon: Youtube, label: 'YouTube' }
  return { icon: Search, label: 'Search' }
}

export function tabTitle(t: Tab): string {
  return t.title || tabKind(t).label
}

/** Every tab of the CURRENT workspace, all types together, in space order then tab order (TEST-022). */
export function workspaceTabs(tabs: Record<SpaceId, Tab[]>): Array<{ space: SpaceId; tab: Tab; index: number }> {
  return SPACE_ORDER.flatMap((space) => (tabs[space] ?? []).map((tab, index) => ({ space, tab, index })))
}

/**
 * Tab cards (TEST-031, fixes TEST-022): opened from the bottom-left control. Every tab of the
 * current workspace as a card — Scripture, notes, lexicon, YouTube and search tabs TOGETHER,
 * because they belong to the same workspace (the old grid showed only the current space's tabs,
 * which read as separate workspaces per type). Tap → switch (any space), × → close, long-press →
 * tab actions; header: workspace switcher, reorder, archived, new tab. A view of the shared
 * tab/session model — no data of its own. No low detent (brief §16).
 */
export function TabCardsSheet({ close, onOpenSessions, onTabActions, onNewTab, onOpenArchive }: {
  close: () => void
  onOpenSessions: () => void
  onTabActions: (space: SpaceId, tabId: string) => void
  onNewTab: () => void
  onOpenArchive: () => void
}) {
  const tabs = useAppStore((s) => s.tabs)
  const activeSpace = useAppStore((s) => s.activeSpace)
  const activeTabId = useAppStore((s) => s.activeTabId)
  const setActiveTab = useAppStore((s) => s.setActiveTab)
  const closeTab = useAppStore((s) => s.closeTab)
  const reorderTabs = useAppStore((s) => s.reorderTabs)
  const session = useAppStore((s) => s.sessions.find((x) => x.id === s.currentSessionId))
  const all = useMemo(() => workspaceTabs(tabs), [tabs])
  const [reordering, setReordering] = useState(false)
  const isActive = (space: SpaceId, id: string) => space === activeSpace && activeTabId[space] === id
  const SessionIcon = (SESSION_ICONS.find((i) => i.name === session?.icon) ?? { Icon: Layers }).Icon

  return (
    <div className="mobile-tab-cards-sheet">
      <div className="mobile-tab-grid-head">
        <button type="button" className="mobile-chip" onClick={onOpenSessions} aria-label={`Workspace: ${session?.name ?? 'Workspace'}. Switch workspace`}>
          <SessionIcon size={16} aria-hidden /> {session?.name ?? 'Workspace'}
        </button>
        <span className="mobile-muted">{all.length} tab{all.length === 1 ? '' : 's'}</span>
        <div className="mobile-tab-grid-head-actions">
          {all.length > 1 && <button type="button" className={`mobile-chip${reordering ? ' is-on' : ''}`} aria-pressed={reordering} onClick={() => setReordering((r) => !r)}><ArrowUpDown size={14} aria-hidden /> {reordering ? 'Done' : 'Reorder'}</button>}
          <button type="button" className="mobile-chip" aria-label="Archived tabs" onClick={onOpenArchive}><Archive size={14} aria-hidden /></button>
        </div>
      </div>
      {all.length === 0 && <div className="mobile-empty">No open tabs in this workspace.</div>}
      {reordering ? (
        // Tab order is per type (the same order the desktop sidebar shows within each space), so
        // reordering happens within each type's run of cards.
        SPACE_ORDER.filter((sp) => (tabs[sp] ?? []).length > 1).map((space) => {
          const ids = tabs[space].map((t) => t.id)
          return (
            <Reorder.Group key={space} axis="y" values={ids} as="ul" className="mobile-tab-reorder"
              onReorder={(next: string[]) => { const mv = singleMove(ids, next); if (mv) { void haptic.selection(); reorderTabs(space, mv.from, mv.to) } }}>
              {tabs[space].map((t) => {
                const K = tabKind(t)
                return (
                  <Reorder.Item key={t.id} value={t.id} as="li" className={`mobile-tab-reorder-row${isActive(space, t.id) ? ' is-active' : ''}`} whileDrag={{ scale: 1.02, boxShadow: '0 8px 24px rgb(0 0 0 / 0.18)' }}>
                    <GripVertical size={18} aria-hidden className="mobile-tab-reorder-grip" />
                    <K.icon size={16} aria-hidden />
                    <span className="mobile-tab-reorder-title">{tabTitle(t)}</span>
                    {t.isPinned && <Pin size={12} aria-label="Pinned" />}
                  </Reorder.Item>
                )
              })}
            </Reorder.Group>
          )
        })
      ) : (
        <div className="mobile-tab-cards">
          {all.map(({ space, tab }) => (
            <TabCard key={tab.id} tab={tab} active={isActive(space, tab.id)}
              onOpen={() => { void haptic.selection(); setActiveTab(space, tab.id); close() }}
              onClose={() => { void haptic.light(); closeTab(space, tab.id) }}
              onLongPress={() => onTabActions(space, tab.id)} />
          ))}
          <button type="button" className="mobile-tab-card is-new" onClick={() => { close(); onNewTab() }} aria-label="New tab">
            <Plus size={22} aria-hidden /><span>New tab</span>
          </button>
        </div>
      )}
    </div>
  )
}

function TabCard({ tab, active, onOpen, onClose, onLongPress }: { tab: Tab; active: boolean; onOpen: () => void; onClose: () => void; onLongPress: () => void }) {
  const lp = useLongPress(() => { void haptic.medium(); onLongPress() })
  const K = tabKind(tab)
  const title = tabTitle(tab)
  return (
    <div className={`mobile-tab-card${active ? ' is-active' : ''}`} {...lp}>
      <button type="button" className="mobile-tab-card-main" onClick={onOpen} aria-current={active ? 'true' : undefined} aria-label={`${K.label}: ${title}${active ? ', current tab' : ''}`}>
        <span className="mobile-tab-card-kind"><K.icon size={14} aria-hidden /> {K.label}</span>
        <span className="mobile-tab-card-title">{tab.isPinned && <Pin size={12} aria-label="Pinned" />} {title}</span>
      </button>
      {!tab.isPinned && (
        <button type="button" className="mobile-tab-card-close" aria-label={`Close ${title}`} onClick={onClose}>
          <X size={16} aria-hidden />
        </button>
      )}
    </div>
  )
}
