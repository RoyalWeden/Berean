import React, { useMemo, useRef } from 'react'
import { Plus, ChevronUp } from 'lucide-react'
import { useAppStore } from '@/store'
import { haptic } from '../primitives/haptics'
import { workspaceTabs } from '../tabs/TabCardsSheet'
import { useChromeState } from './chromeState'
import { useLiquidGlassControls } from '@/platform/liquidGlass'

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
  const tabsRef = useRef<HTMLButtonElement>(null)
  const plusRef = useRef<HTMLButtonElement>(null)
  const caretRef = useRef<HTMLButtonElement>(null)
  const chrome = useChromeState()

  const step = (dir: 1 | -1) => {
    const i = all.findIndex((e) => e.space === activeSpace && e.tab.id === activeTabId[activeSpace])
    const next = all[i + dir]
    if (!next) { void haptic.warning(); return }
    void haptic.selection()
    useAppStore.getState().setActiveTab(next.space, next.tab.id)
  }

  const pressTabs = () => { void haptic.light(); onTabs() }
  const pressPlus = () => { void haptic.light(); onPlus() }
  const pressCaret = () => { void haptic.light(); onCaret() }

  // Liquid Glass (docs/liquid-glass.md §iOS): with the native bridge these three controls are drawn
  // by UIKit — interactive UIGlassEffect buttons in one UIGlassContainerEffect, ABOVE the web view,
  // so the glass refracts the text scrolling beneath. The web buttons below stay as invisible
  // placeholders (layout, occlusion by sheets, and the fallback everywhere else).
  const { isNative } = useLiquidGlassControls('bottom-nav', [
    { id: 'tabs', ref: tabsRef, symbol: 'square.on.square', label: `Tabs, ${count} open`, badge: String(count), iconSize: 21, onPress: pressTabs },
    { id: 'plus', ref: plusRef, symbol: 'plus', label: 'New tab or search', prominent: true, iconSize: 21, onPress: pressPlus },
    { id: 'caret', ref: caretRef, symbol: 'chevron.up', label: caretLabel, iconSize: 19, onPress: pressCaret },
  ], {
    role: 'navigation',
    collapsed: chrome.overlay ? chrome.collapsed : chrome.pageCollapsed,
    onSwipe: (dir) => step(dir === 'next' ? 1 : -1),
  })

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
      <button ref={tabsRef} type="button" className={`mobile-nav-tabs${isNative('tabs') ? ' is-native-glass' : ''}`} onClick={pressTabs} aria-label={`Tabs, ${count} open`} aria-hidden={isNative('tabs') || undefined} tabIndex={isNative('tabs') ? -1 : undefined}>
        <span className="mobile-nav-tabs-stack" aria-hidden>
          <span className="mobile-nav-tabs-card is-back" />
          <span className="mobile-nav-tabs-card">{count}</span>
        </span>
      </button>
      <button ref={plusRef} type="button" className={`mobile-nav-plus${isNative('plus') ? ' is-native-glass' : ''}`} onClick={pressPlus} aria-label="New tab or search" aria-hidden={isNative('plus') || undefined} tabIndex={isNative('plus') ? -1 : undefined}>
        <Plus size={24} aria-hidden />
      </button>
      <button ref={caretRef} type="button" className={`mobile-nav-caret${isNative('caret') ? ' is-native-glass' : ''}`} onClick={pressCaret} aria-label={caretLabel} aria-hidden={isNative('caret') || undefined} tabIndex={isNative('caret') ? -1 : undefined}>
        <ChevronUp size={24} aria-hidden />
      </button>
    </nav>
  )
}
