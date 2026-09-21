import React from 'react'
import { motion, type PanInfo } from 'framer-motion'
import { Plus } from 'lucide-react'
import { useAppStore } from '@/store'
import type { SpaceId, Tab } from '@/types'
import { haptic } from '../primitives/haptics'

/**
 * The Arc-style tab pill (R071): shows the active tab of the current space; tap opens the tab
 * grid; a horizontal swipe on the pill switches to the adjacent tab; the "+" opens a new tab of
 * the space's kind.
 */
export function TabPill({ space, onOpenGrid, onNewTab }: { space: SpaceId; onOpenGrid: () => void; onNewTab: () => void }) {
  const tabs = useAppStore((s) => s.tabs[space])
  const activeId = useAppStore((s) => s.activeTabId[space])
  const setActiveTab = useAppStore((s) => s.setActiveTab)
  const active = tabs.find((t) => t.id === activeId) ?? null
  const index = active ? tabs.indexOf(active) : -1

  const swipe = (_: unknown, info: PanInfo) => {
    if (Math.abs(info.offset.x) < 40 && Math.abs(info.velocity.x) < 400) return
    const dir = info.offset.x < 0 ? 1 : -1
    const next = tabs[index + dir]
    if (!next) { void haptic.warning(); return }
    void haptic.selection()
    setActiveTab(space, next.id)
  }

  return (
    <div className="mobile-tab-pill-row">
      <motion.button
        type="button"
        className="mobile-tab-pill"
        drag="x" dragConstraints={{ left: 0, right: 0 }} dragElastic={0.25} dragSnapToOrigin
        onDragEnd={swipe}
        onClick={onOpenGrid}
        aria-label={active ? `Current tab: ${active.title}. ${tabs.length} tabs open. Opens tab grid` : 'Open tab grid'}
      >
        <span className="mobile-tab-pill-count" aria-hidden>{tabs.length}</span>
        <span className="mobile-tab-pill-title">{active ? tabTitle(active) : 'No tab'}</span>
      </motion.button>
      <button type="button" className="mobile-tab-pill-new" aria-label="New tab" onClick={() => { void haptic.light(); onNewTab() }}>
        <Plus size={20} aria-hidden />
      </button>
    </div>
  )
}

export function tabTitle(t: Tab): string {
  return t.title || (t.type === 'bible' ? 'Scripture' : t.type)
}
