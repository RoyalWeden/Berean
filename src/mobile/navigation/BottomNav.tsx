import React, { useMemo, useRef } from 'react'
import { Plus, ChevronUp } from 'lucide-react'
import { useAppStore } from '@/store'
import { haptic } from '../primitives/haptics'
import { workspaceTabs } from '../tabs/TabCardsSheet'

/**
 * The iPhone's three persistent navigation controls (TEST-030/031/032/033, brief §25–31), shown on
 * every tab type:
 *   bottom LEFT   — tab cards (count badge on a small stack of cards) → every tab of the workspace
 *   bottom CENTER — plus → new tab / open / search surface
 *   bottom RIGHT  — upward caret → the commands of whatever is on screen
 * A horizontal swipe across the bar steps to the previous / next tab of the workspace (what the old
 * tab pill's swipe did). There is deliberately no fourth global control (no search icon — search
 * lives in the plus surface; the reader's title is its passage navigator).
 */
export function BottomNav({ onTabs, onPlus, onCaret, caretLabel }: { onTabs: () => void; onPlus: () => void; onCaret: () => void; caretLabel: string }) {
  const tabs = useAppStore((s) => s.tabs)
  const activeSpace = useAppStore((s) => s.activeSpace)
  const activeTabId = useAppStore((s) => s.activeTabId)
  // Swiping across the bar steps through the same order the tab cards show (T23-008).
  const stored = useAppStore((s) => s.sessionDisplayOrders[s.currentSessionId])
  const all = useMemo(() => workspaceTabs(tabs, stored), [tabs, stored])
  const count = all.length
  const swipe = useRef<{ x: number; y: number; t: number } | null>(null)

  const step = (dir: 1 | -1) => {
    const i = all.findIndex((e) => e.space === activeSpace && e.tab.id === activeTabId[activeSpace])
    const next = all[i + dir]
    if (!next) { void haptic.warning(); return }
    void haptic.selection()
    useAppStore.getState().setActiveTab(next.space, next.tab.id)
  }

  return (
    <nav
      className="mobile-bottom-nav"
      aria-label="Navigation"
      onPointerDown={(e) => { swipe.current = { x: e.clientX, y: e.clientY, t: Date.now() } }}
      onPointerUp={(e) => {
        const s = swipe.current; swipe.current = null
        if (!s) return
        const dx = e.clientX - s.x, dy = e.clientY - s.y
        if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 2 && Date.now() - s.t < 600) step(dx < 0 ? 1 : -1)
      }}
    >
      <button type="button" className="mobile-nav-tabs" onClick={() => { void haptic.light(); onTabs() }} aria-label={`Tabs, ${count} open`}>
        <span className="mobile-nav-tabs-stack" aria-hidden>
          <span className="mobile-nav-tabs-card is-back" />
          <span className="mobile-nav-tabs-card">{count}</span>
        </span>
      </button>
      <button type="button" className="mobile-nav-plus" onClick={() => { void haptic.light(); onPlus() }} aria-label="New tab or search">
        <Plus size={24} aria-hidden />
      </button>
      <button type="button" className="mobile-nav-caret" onClick={() => { void haptic.light(); onCaret() }} aria-label={caretLabel}>
        <ChevronUp size={24} aria-hidden />
      </button>
    </nav>
  )
}
